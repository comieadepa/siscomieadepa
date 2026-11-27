import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import {
  verifyUmadespaToken,
  prepararSolicitacaoCarteirinha,
  getOrCreateAsaasCustomerForUmadespa,
  createUmadespaPixCharge,
  findAsaasPaymentByExternalReferenceUmadespa,
} from '@/lib/umadespa';
import { logDB } from '@/lib/audit';

/**
 * POST /api/public/umadespa/carteirinha
 * Solicita a emissão da carteirinha física do jovem e gera cobrança PIX ASAAS de forma pública e segura.
 * Autenticação via token HMAC temporário ('x-umadespa-token' ou body.token).
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: 'Parâmetros inválidos.' }, { status: 400 });
    }

    const { associadoId, confirmacao } = body;
    const token = request.headers.get('x-umadespa-token') || body.token;

    if (!associadoId) {
      return NextResponse.json({ error: 'Associado não informado.' }, { status: 400 });
    }

    if (!confirmacao) {
      return NextResponse.json(
        { error: 'A solicitação de carteirinha exige confirmação explícita do jovem ou responsável.' },
        { status: 400 }
      );
    }

    // 1. Validação de autenticação HMAC
    const authResult = verifyUmadespaToken(token, associadoId);
    if (!authResult.valid) {
      return NextResponse.json(
        { error: 'Sessão expirada ou não autorizada. Valide seus dados novamente no início.' },
        { status: 401 }
      );
    }

    const supabase = createServerClient();

    // 2. Localiza o associado e checa requisitos cadastrais mínimos
    const { data: associado, error: assocErr } = await supabase
      .from('umadespa_associados')
      .select('id, nome, cpf, data_nascimento, fone, email, foto_url, status, menor_idade, responsavel_termo_aceite')
      .eq('id', associadoId)
      .maybeSingle();

    if (assocErr || !associado) {
      return NextResponse.json({ error: 'Cadastro do associado não encontrado.' }, { status: 404 });
    }

    if (!associado.foto_url || associado.foto_url.trim().length === 0) {
      return NextResponse.json(
        { error: 'É necessário anexar uma foto oficial 3x4 antes de solicitar a carteirinha.' },
        { status: 422 }
      );
    }

    if (associado.menor_idade && !associado.responsavel_termo_aceite) {
      return NextResponse.json(
        { error: 'Para menores de idade, o aceite do termo de autorização pelo responsável é obrigatório.' },
        { status: 422 }
      );
    }

    // 3. Prepara a solicitação de carteirinha de forma idempotente
    const preparacao = await prepararSolicitacaoCarteirinha({
      associadoId: associado.id,
      observacoes: 'Solicitação gerada via portal público UMADESPA',
    });

    if (preparacao.erro || !preparacao.solicitacao) {
      return NextResponse.json({ error: preparacao.erro || 'Erro ao processar solicitação.' }, { status: 400 });
    }

    const sol = preparacao.solicitacao;
    const valorSolicitacao = Number(sol.valor || 0);

    // 4. Se a solicitação já está paga, retorna o status diretamente
    if (['pago', 'em_impressao', 'impressa', 'entregue'].includes(sol.status)) {
      return NextResponse.json({
        success: true,
        reutilizada: preparacao.reutilizada,
        solicitacao: {
          id: sol.id,
          via: sol.via,
          valor: valorSolicitacao,
          status: sol.status,
          pago_em: sol.pago_em,
        },
        pix: null,
        mensagem: 'Sua credencial já foi quitada e está em processamento para impressão.',
      });
    }

    // 5. Se já possui PIX gravado no banco, retorna imediatamente
    let pixData: {
      paymentId: string;
      pixQrCode: string | null;
      pixCopiaECola: string | null;
      invoiceUrl: string | null;
      status: string;
    } | null = null;

    if (sol.asaas_payment_id && sol.pix_copia_cola) {
      pixData = {
        paymentId: sol.asaas_payment_id,
        pixQrCode: sol.pix_qr_code_url || null,
        pixCopiaECola: sol.pix_copia_cola,
        invoiceUrl: sol.invoice_url || null,
        status: sol.status,
      };
    } else if (valorSolicitacao > 0) {
      // 6. Tenta reconciliar com o ASAAS ou gerar cobrança
      try {
        let cobranca = await findAsaasPaymentByExternalReferenceUmadespa(sol.id);
        if (!cobranca) {
          const customerId = await getOrCreateAsaasCustomerForUmadespa({
            nome: associado.nome,
            cpf: associado.cpf,
            email: associado.email,
            fone: associado.fone,
          });

          cobranca = await createUmadespaPixCharge({
            customerId,
            solicitacaoId: sol.id,
            valor: valorSolicitacao,
            via: sol.via,
            nomeAssociado: associado.nome,
          });
        }

        if (cobranca) {
          await supabase
            .from('umadespa_carteirinhas_solicitacoes')
            .update({
              asaas_payment_id: cobranca.paymentId,
              asaas_customer_id: cobranca.customerId,
              pix_copia_cola: cobranca.pixCopiaECola,
              pix_qr_code_url: cobranca.pixQrCode,
              invoice_url: cobranca.invoiceUrl,
              updated_at: new Date().toISOString(),
            })
            .eq('id', sol.id);

          pixData = {
            paymentId: cobranca.paymentId,
            pixQrCode: cobranca.pixQrCode,
            pixCopiaECola: cobranca.pixCopiaECola,
            invoiceUrl: cobranca.invoiceUrl,
            status: cobranca.status,
          };

          void logDB({
            acao: 'criar_cobranca_pix',
            modulo: 'secretaria',
            entidade: 'umadespa_carteirinhas_solicitacoes',
            entidadeId: sol.id,
            descricao: `PIX público gerado no ASAAS para ${associado.nome} (UMADESPA ${sol.via}ª via)`,
            status: 'sucesso',
            detalhes: { solicitacaoId: sol.id, valor: valorSolicitacao, paymentId: cobranca.paymentId },
          });
        }
      } catch (asaasErr: any) {
        console.warn('[UMADESPA PUBLIC CARTEIRINHA] Falha na integração ASAAS:', asaasErr.message);
        // Não quebra a criação da solicitação caso o gateway falhe momentaneamente
      }
    }

    return NextResponse.json({
      success: true,
      reutilizada: preparacao.reutilizada,
      solicitacao: {
        id: sol.id,
        via: sol.via,
        valor: valorSolicitacao,
        validade_meses: sol.validade_meses,
        validade_data: sol.validade_data,
        status: sol.status,
        solicitado_em: sol.solicitado_em,
      },
      pix: pixData,
      mensagem: preparacao.reutilizada
        ? 'Você já possui uma solicitação em andamento.'
        : 'Solicitação de carteirinha registrada com sucesso!',
    });
  } catch (err: any) {
    console.error('[UMADESPA PUBLIC CARTEIRINHA] Erro fatal:', err);
    return NextResponse.json({ error: 'Erro interno ao processar carteirinha.' }, { status: 500 });
  }
}

/**
 * GET /api/public/umadespa/carteirinha?associadoId=...
 * Permite ao jovem consultar o status do seu pedido e dados PIX de forma pública autenticada via token HMAC.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const associadoId = searchParams.get('associadoId');
    const token = request.headers.get('x-umadespa-token') || searchParams.get('token');

    if (!associadoId) {
      return NextResponse.json({ error: 'associadoId não informado.' }, { status: 400 });
    }

    if (!token) {
      return NextResponse.json({ error: 'Token de autorização não fornecido.' }, { status: 401 });
    }

    const authResult = verifyUmadespaToken(token, associadoId);
    if (!authResult.valid) {
      return NextResponse.json({ error: 'Sessão expirada ou não autorizada.' }, { status: 401 });
    }

    const supabase = createServerClient();

    const { data: pedidos, error } = await supabase
      .from('umadespa_carteirinhas_solicitacoes')
      .select('id, via, status, valor, pix_copia_cola, pix_qr_code_url, invoice_url, solicitado_em, pago_em, impresso_em, entregue_em')
      .eq('associado_id', associadoId)
      .order('via', { ascending: false });

    if (error) {
      return NextResponse.json({ error: 'Erro ao consultar solicitações.' }, { status: 500 });
    }

    const pedidoAtivo = pedidos?.find((p) =>
      ['processando_pagamento', 'aguardando_pagamento', 'pago', 'em_impressao', 'impressa'].includes(p.status)
    );
    const ultimoPedido = pedidos && pedidos.length > 0 ? pedidos[0] : null;

    return NextResponse.json({
      success: true,
      pedidoAtivo: pedidoAtivo || null,
      ultimoPedido: ultimoPedido || null,
      podeSolicitarSegundaVia: !pedidoAtivo && ultimoPedido !== null && ['entregue', 'cancelada'].includes(ultimoPedido.status),
      podeSolicitarPrimeiraVia: !pedidoAtivo && !ultimoPedido,
    });
  } catch (err: any) {
    console.error('[UMADESPA PUBLIC CARTEIRINHA GET] Erro:', err);
    return NextResponse.json({ error: 'Erro interno ao consultar carteirinha.' }, { status: 500 });
  }
}
