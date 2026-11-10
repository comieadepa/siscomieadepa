import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { requireModuleAccess } from '@/lib/auth/require-auth';
import { cleanCpf, isValidCpf } from '@/lib/cpf';
import {
  getOrCreateAsaasCustomerForAemadepa,
  createAemadepaPixCharge,
  findAsaasPaymentByExternalReference,
} from '@/lib/aemadepa/carteirinha-service';
import { getAsaasPixQrCode } from '@/lib/asaas';
import { VALOR_CARTEIRINHA_AEMADEPA } from '@/lib/aemadepa/constants';
import { logDB } from '@/lib/audit';

/**
 * POST /api/v1/aemadepa/financeiro/pix
 * Gera ou recupera cobrança PIX ASAAS de R$ 20,00 para uma associada via Painel Administrativo.
 * Aplica todas as travas de resiliência, idempotência e integridade do ASAAS.
 */
export async function POST(request: NextRequest) {
  const auth = await requireModuleAccess(request, 'aemadepa');
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json().catch(() => null);
    if (!body || !body.associadaId) {
      return NextResponse.json({ error: 'Associada não informada.' }, { status: 400 });
    }

    const { associadaId } = body;
    const supabase = createServerClient();

    // 1. Localiza a associada
    const { data: associada, error: assocErr } = await supabase
      .from('aemadepa_associadas')
      .select('id, ministro_id, nome, cpf, data_nascimento, fone, email, foto_url')
      .eq('id', associadaId)
      .maybeSingle();

    if (assocErr || !associada) {
      return NextResponse.json({ error: 'Cadastro de associada não localizado.' }, { status: 404 });
    }

    if (!associada.foto_url || associada.foto_url.trim().length === 0) {
      return NextResponse.json(
        { error: 'Não é possível gerar cobrança para associada sem foto 3x4 cadastrada.' },
        { status: 422 }
      );
    }

    const cpfLimpo = cleanCpf(associada.cpf);
    if (!cpfLimpo || cpfLimpo.length !== 11 || !isValidCpf(cpfLimpo)) {
      return NextResponse.json(
        { error: 'O CPF da associada está ausente ou é inválido. Por favor, regularize os dados cadastrais antes de gerar a cobrança PIX.' },
        { status: 422 }
      );
    }

    // 2. Busca solicitação ativa existente
    const { data: solicitacaoExistente, error: getErr } = await supabase
      .from('aemadepa_carteirinhas_solicitacoes')
      .select('*')
      .eq('associada_id', associadaId)
      .in('status', ['processando_cobranca', 'aguardando_pagamento', 'pago', 'em_impressao', 'impressa'])
      .maybeSingle();

    if (getErr) {
      return NextResponse.json({ error: getErr.message }, { status: 500 });
    }

    // Se já estiver paga, retorna o status existente sem recriar cobrança
    if (solicitacaoExistente && ['pago', 'em_impressao', 'impressa', 'entregue'].includes(solicitacaoExistente.status)) {
      return NextResponse.json({
        sucesso: true,
        jaPago: true,
        solicitacao: solicitacaoExistente,
      });
    }

    // Se já houver cobrança ativa gerada com QR Code, reutiliza
    if (solicitacaoExistente && solicitacaoExistente.pix_copia_cola && solicitacaoExistente.status === 'aguardando_pagamento') {
      return NextResponse.json({
        sucesso: true,
        reutilizado: true,
        solicitacao: solicitacaoExistente,
      });
    }

    // Caso não exista solicitação aberta, cria uma solicitação em estado inicial ou aproveita a existente
    let solicitacao = solicitacaoExistente;
    const agora = new Date().toISOString();

    if (!solicitacao) {
      const { data: maxViaData } = await supabase
        .from('aemadepa_carteirinhas_solicitacoes')
        .select('via')
        .eq('associada_id', associadaId)
        .order('via', { ascending: false })
        .limit(1)
        .maybeSingle();

      const proximaVia = (maxViaData?.via || 0) + 1;
      const idempotencyKey = `cart:${associadaId}:v${proximaVia}:admin:${Date.now()}`;

      const { data: nova, error: insErr } = await supabase
        .from('aemadepa_carteirinhas_solicitacoes')
        .insert({
          associada_id: associadaId,
          ministro_id: associada.ministro_id,
          valor: VALOR_CARTEIRINHA_AEMADEPA,
          via: proximaVia,
          forma_pagamento: 'pix_asaas',
          idempotency_key: idempotencyKey,
          status: 'processando_cobranca',
          solicitado_em: agora,
          observacoes: '[Painel Admin] Início da solicitação de carteirinha via PIX.',
        })
        .select()
        .single();

      if (insErr) {
        return NextResponse.json({ error: insErr.message }, { status: 500 });
      }
      solicitacao = nova;
    }

    // 3. Integração com Gateway ASAAS
    const externalReference = `aemadepa_carteirinha:${solicitacao.id}`;
    let paymentId = solicitacao.asaas_payment_id;
    let customerId = solicitacao.asaas_customer_id;
    let pixCopiaCola = solicitacao.pix_copia_cola;
    let pixQrCodeUrl = solicitacao.pix_qr_code_url;
    let invoiceUrl = solicitacao.invoice_url;

    // Se ainda não tinha cobrança emitida, busca reconciliação ou gera nova
    if (!paymentId) {
      const cobrancaExistente = await findAsaasPaymentByExternalReference(externalReference);
      if (cobrancaExistente?.paymentId) {
        paymentId = cobrancaExistente.paymentId;
        customerId = cobrancaExistente.customerId;
        invoiceUrl = cobrancaExistente.invoiceUrl || null;
      } else {
        customerId = await getOrCreateAsaasCustomerForAemadepa({
          nome: associada.nome,
          cpf: associada.cpf,
          email: associada.email,
          fone: associada.fone,
        });

        const charge = await createAemadepaPixCharge({
          customerId,
          solicitacaoId: solicitacao.id,
          via: solicitacao.via,
          descricao: `AEMADEPA — Carteirinha ${solicitacao.via}ª Via: ${associada.nome}`,
        });

        paymentId = charge.paymentId;
        invoiceUrl = charge.invoiceUrl;
      }
    }

    // Busca o QR Code do PIX
    if (paymentId && !pixCopiaCola) {
      const qrData = await getAsaasPixQrCode(paymentId);
      pixCopiaCola = qrData?.payload || null;
      pixQrCodeUrl = qrData?.encodedImage ? `data:image/png;base64,${qrData.encodedImage}` : null;
    }

    // Atualiza solicitação para aguardando_pagamento com dados do PIX
    const { data: solicitacaoFinal, error: updErr } = await supabase
      .from('aemadepa_carteirinhas_solicitacoes')
      .update({
        status: 'aguardando_pagamento',
        asaas_payment_id: paymentId,
        asaas_customer_id: customerId,
        pix_copia_cola: pixCopiaCola,
        pix_qr_code_url: pixQrCodeUrl,
        invoice_url: invoiceUrl,
        updated_at: new Date().toISOString(),
      })
      .eq('id', solicitacao.id)
      .select()
      .single();

    if (updErr) {
      return NextResponse.json({ error: updErr.message }, { status: 500 });
    }

    void logDB({
      acao: 'gerar_cobranca_pix',
      modulo: 'secretaria',
      entidade: 'aemadepa_carteirinhas_solicitacoes',
      entidadeId: solicitacao.id,
      descricao: `Cobrança PIX gerada via painel para ${associada.nome} (${solicitacao.via}ª via)`,
      status: 'sucesso',
      detalhes: { associadaId, paymentId, valor: Number(solicitacaoFinal.valor || VALOR_CARTEIRINHA_AEMADEPA) },
    });

    return NextResponse.json({
      sucesso: true,
      solicitacao: solicitacaoFinal,
    });
  } catch (err: any) {
    console.error('[AEMADEPA FINANCEIRO PIX] Erro:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
