/**
 * GET /api/v1/secretaria/aemadepa/pedidos/[id]/pix
 *
 * Recupera os dados financeiros e do QR Code PIX de uma solicitação de carteirinha AEMADEPA
 * diretamente do ASAAS, via asaas_payment_id persistido na tabela aemadepa_carteirinhas_solicitacoes.
 *
 * Restrições de Segurança:
 * - Acesso restrito a operadores autorizados no módulo 'aemadepa' (requireModuleAccess).
 * - Não expõe chave ASAAS, customer_id interno, nem qualquer credencial ao cliente.
 * - Não gera nova cobrança nem altera status do pedido.
 * - Se a cobrança estiver paga, vencida, cancelada ou sem PIX utilizável,
 *   retorna o status real com sinalização clara para bloqueio na UI.
 * - Prioriza dados já cacheados no banco (pix_copia_cola, pix_qr_code_url) para evitar
 *   consultas ASAAS desnecessárias quando o PIX ainda é válido (aguardando_pagamento).
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { requireModuleAccess } from '@/lib/auth/require-auth';
import { getAsaasPayment, getAsaasPixQrCode } from '@/lib/asaas';

/** Status ASAAS que indicam que o PIX ainda pode ser pago */
const STATUS_PIX_VALIDO_ASAAS = ['PENDING', 'AWAITING_RISK_ANALYSIS'];

/** Status do banco (solicitacao) que indicam aguardando pagamento */
const STATUS_AGUARDANDO_LOCAL = ['aguardando_pagamento', 'processando_cobranca'];

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireModuleAccess(request, 'aemadepa');
  if (!auth.ok) return auth.response;

  const { id: solicitacaoId } = await params;
  if (!solicitacaoId || typeof solicitacaoId !== 'string') {
    return NextResponse.json({ error: 'ID da solicitação inválido.' }, { status: 400 });
  }

  const supabase = createServerClient();

  try {
    // 1. Busca a solicitação e dados da associada vinculados no banco (fonte de verdade)
    const { data: solicitacao, error: solErr } = await supabase
      .from('aemadepa_carteirinhas_solicitacoes')
      .select(`
        id,
        associada_id,
        ministro_id,
        valor,
        via,
        status,
        forma_pagamento,
        asaas_payment_id,
        pix_copia_cola,
        pix_qr_code_url,
        invoice_url,
        solicitado_em,
        pago_em,
        observacoes
      `)
      .eq('id', solicitacaoId)
      .maybeSingle();

    if (solErr || !solicitacao) {
      return NextResponse.json({ error: 'Solicitação de carteirinha não localizada.' }, { status: 404 });
    }

    // 2. Busca dados da associada e do ministro vinculado para exibição no modal
    const [{ data: associada }, { data: ministro }] = await Promise.all([
      supabase
        .from('aemadepa_associadas')
        .select('id, nome, cpf, fone, fotoUrl:foto_url, email, numero_aemadepa')
        .eq('id', solicitacao.associada_id)
        .maybeSingle(),
      supabase
        .from('members')
        .select('id, name, matricula, custom_fields')
        .eq('id', solicitacao.ministro_id)
        .maybeSingle(),
    ]);

    const cfMin = (ministro?.custom_fields && typeof ministro.custom_fields === 'object')
      ? ministro.custom_fields as Record<string, any>
      : {};

    const nomeMinistro = ministro?.name || cfMin.nome || '—';
    const matriculaMinistro = ministro?.matricula || cfMin.matricula || '';
    const campoMinistro = cfMin.campo || '';

    // 3. Determinar se o PIX ainda pode ser reenviado/exibido
    const statusLocal = solicitacao.status;
    const aguardandoPagamento = STATUS_AGUARDANDO_LOCAL.includes(statusLocal);
    const formaPagamento = solicitacao.forma_pagamento || 'pix_asaas';
    const ehPix = formaPagamento === 'pix_asaas';

    // Se não for cobrança PIX (ex: a_vista, cortesia), não há PIX para recuperar
    if (!ehPix) {
      return NextResponse.json({
        bloqueado: true,
        motivoBloqueio: `Esta solicitação utiliza forma de pagamento "${formaPagamento}" — não há cobrança PIX associada.`,
        statusLocal,
        associada: {
          nome: associada?.nome || '—',
          cpf: associada?.cpf || '—',
          fone: associada?.fone || null,
          fotoUrl: associada?.fotoUrl || null,
          numeroAemadepa: associada?.numero_aemadepa || '',
        },
        ministro: { nome: nomeMinistro, matricula: matriculaMinistro, campo: campoMinistro },
        pedido: { via: solicitacao.via, valor: Number(solicitacao.valor), solicitadoEm: solicitacao.solicitado_em },
      });
    }

    // 4. Se já pago, cancelado ou entregue: bloquear reenvio mas exibir status
    if (!aguardandoPagamento) {
      const motivoMap: Record<string, string> = {
        pago: 'Esta solicitação já foi paga. O PIX não está mais ativo.',
        em_impressao: 'Pagamento confirmado — carteirinha em processo de impressão.',
        impressa: 'Carteirinha já impressa e aguardando entrega.',
        entregue: 'Carteirinha já entregue à associada.',
        cancelada: 'Esta solicitação foi cancelada.',
        processando_cobranca: 'Solicitação em conciliação financeira. Aguarde alguns instantes.',
      };
      const motivoBloqueio = motivoMap[statusLocal] || `Status atual: ${statusLocal}`;

      return NextResponse.json({
        bloqueado: true,
        motivoBloqueio,
        statusLocal,
        statusAsaas: null,
        pagoEm: solicitacao.pago_em || null,
        associada: {
          nome: associada?.nome || '—',
          cpf: associada?.cpf || '—',
          fone: associada?.fone || null,
          fotoUrl: associada?.fotoUrl || null,
          numeroAemadepa: associada?.numero_aemadepa || '',
        },
        ministro: { nome: nomeMinistro, matricula: matriculaMinistro, campo: campoMinistro },
        pedido: { via: solicitacao.via, valor: Number(solicitacao.valor), solicitadoEm: solicitacao.solicitado_em },
      });
    }

    // 5. Recuperação do PIX — prioriza cache local para evitar consultas ASAAS desnecessárias
    let pixCopiaECola: string | null = solicitacao.pix_copia_cola || null;
    let pixQrCode: string | null = solicitacao.pix_qr_code_url || null;
    let statusAsaas: string | null = null;
    let vencimentoAsaas: string | null = null;
    let valorAsaas: number | null = null;
    let pixExpirado = false;
    let asaasFalhou = false;

    if (!solicitacao.asaas_payment_id) {
      // Sem payment_id: cobrança nunca foi efetivada no ASAAS
      return NextResponse.json({
        bloqueado: true,
        motivoBloqueio: 'Não há cobrança ASAAS registrada para este pedido. Contate a Secretaria.',
        statusLocal,
        associada: {
          nome: associada?.nome || '—',
          cpf: associada?.cpf || '—',
          fone: associada?.fone || null,
          fotoUrl: associada?.fotoUrl || null,
          numeroAemadepa: associada?.numero_aemadepa || '',
        },
        ministro: { nome: nomeMinistro, matricula: matriculaMinistro, campo: campoMinistro },
        pedido: { via: solicitacao.via, valor: Number(solicitacao.valor), solicitadoEm: solicitacao.solicitado_em },
      });
    }

    // 6. Consulta status atual no ASAAS
    try {
      const paymentData = await getAsaasPayment(solicitacao.asaas_payment_id);
      statusAsaas = paymentData?.status || null;
      vencimentoAsaas = paymentData?.dueDate || null;
      valorAsaas = typeof paymentData?.value === 'number' ? paymentData.value : null;

      // Verifica se o PIX ainda está ativo no gateway
      if (statusAsaas && !STATUS_PIX_VALIDO_ASAAS.includes(statusAsaas)) {
        pixExpirado = true;
      }

      // Se o PIX não foi cacheado localmente ou queremos dados frescos do gateway
      if (!pixCopiaECola && !pixExpirado) {
        const pixData = await getAsaasPixQrCode(solicitacao.asaas_payment_id);
        pixCopiaECola = pixData.payload || null;
        pixQrCode = pixData.encodedImage || null;

        // Atualiza cache no banco de forma resiliente (best-effort)
        if (pixCopiaECola || pixQrCode) {
          try {
            await supabase
              .from('aemadepa_carteirinhas_solicitacoes')
              .update({
                pix_copia_cola: pixCopiaECola,
                pix_qr_code_url: pixQrCode,
                updated_at: new Date().toISOString(),
              })
              .eq('id', solicitacaoId);
          } catch (cacheErr: any) {
            console.warn('[PIX ADMIN] Erro ao atualizar cache PIX:', cacheErr?.message);
          }
        }
      }
    } catch (asaasErr: any) {
      console.error('[PIX ADMIN AEMADEPA] Falha ao consultar ASAAS:', asaasErr?.message);
      asaasFalhou = true;
      // Mantém dados locais se disponíveis; não falha a requisição
    }

    // 7. Se o PIX expirou no gateway
    if (pixExpirado) {
      return NextResponse.json({
        bloqueado: true,
        motivoBloqueio: `A cobrança PIX está com status "${statusAsaas}" no gateway — não é mais válida para pagamento. Contate a Secretaria para regularização.`,
        statusLocal,
        statusAsaas,
        vencimentoAsaas,
        associada: {
          nome: associada?.nome || '—',
          cpf: associada?.cpf || '—',
          fone: associada?.fone || null,
          fotoUrl: associada?.fotoUrl || null,
          numeroAemadepa: associada?.numero_aemadepa || '',
        },
        ministro: { nome: nomeMinistro, matricula: matriculaMinistro, campo: campoMinistro },
        pedido: { via: solicitacao.via, valor: Number(solicitacao.valor), solicitadoEm: solicitacao.solicitado_em },
      });
    }

    // 8. Se não há dados PIX disponíveis (nem cache local, nem ASAAS)
    if (!pixCopiaECola) {
      return NextResponse.json({
        bloqueado: true,
        motivoBloqueio: asaasFalhou
          ? 'O gateway de pagamentos não respondeu no momento. Tente novamente em instantes.'
          : 'Os dados PIX ainda não estão disponíveis para este pedido. O QR Code pode estar sendo gerado pelo ASAAS.',
        statusLocal,
        statusAsaas,
        associada: {
          nome: associada?.nome || '—',
          cpf: associada?.cpf || '—',
          fone: associada?.fone || null,
          fotoUrl: associada?.fotoUrl || null,
          numeroAemadepa: associada?.numero_aemadepa || '',
        },
        ministro: { nome: nomeMinistro, matricula: matriculaMinistro, campo: campoMinistro },
        pedido: { via: solicitacao.via, valor: Number(solicitacao.valor), solicitadoEm: solicitacao.solicitado_em },
      });
    }

    // 9. Sucesso — retorna dados do PIX sem expor credenciais ASAAS
    return NextResponse.json({
      bloqueado: false,
      statusLocal,
      statusAsaas,
      vencimentoAsaas,
      pixCopiaECola,
      pixQrCodeBase64: pixQrCode || null, // base64 encodedImage do ASAAS ou URL do bucket
      invoiceUrl: solicitacao.invoice_url || null,
      associada: {
        nome: associada?.nome || '—',
        cpf: associada?.cpf || '—',
        fone: associada?.fone || null,
        fotoUrl: associada?.fotoUrl || null,
        email: associada?.email || null,
        numeroAemadepa: associada?.numero_aemadepa || '',
      },
      ministro: {
        nome: nomeMinistro,
        matricula: matriculaMinistro,
        campo: campoMinistro,
      },
      pedido: {
        id: solicitacao.id,
        via: solicitacao.via,
        valor: valorAsaas ?? Number(solicitacao.valor),
        solicitadoEm: solicitacao.solicitado_em,
      },
    });
  } catch (err: any) {
    console.error('[PIX ADMIN AEMADEPA] Erro geral na rota:', err?.message);
    return NextResponse.json({ error: 'Erro interno ao recuperar dados do PIX.' }, { status: 500 });
  }
}
