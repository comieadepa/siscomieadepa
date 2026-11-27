import { NextRequest, NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/auth/require-auth';
import { createServerClient } from '@/lib/supabase-server';
import { logDB } from '@/lib/audit';
import {
  getOrCreateAsaasCustomerForUmadespa,
  findAsaasPaymentByExternalReferenceUmadespa,
  createUmadespaPixCharge,
} from '@/lib/umadespa/carteirinha-service';

/**
 * POST /api/v1/secretaria/umadespa/pedidos/[id]/pix
 * Gera ou recupera a cobrança PIX ASAAS com externalReference='umadespa_carteirinha:<id>'
 * Valor congelado da solicitação, bloqueando se não houver taxa configurada (> 0).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireModuleAccess(request, 'umadespa');
    if (!auth.ok) return auth.response;

    const { id: solicitacaoId } = await params;
    if (!solicitacaoId) {
      return NextResponse.json({ error: 'ID da solicitação não informado.' }, { status: 400 });
    }

    const supabase = createServerClient();

    // 1. Busca solicitação
    const { data: sol, error: solErr } = await supabase
      .from('umadespa_carteirinhas_solicitacoes')
      .select('*, associado:umadespa_associados(*)')
      .eq('id', solicitacaoId)
      .maybeSingle();

    if (solErr || !sol) {
      return NextResponse.json({ error: 'Solicitação de carteirinha não localizada.' }, { status: 404 });
    }

    if (['pago', 'em_impressao', 'impressa', 'entregue'].includes(sol.status)) {
      return NextResponse.json(
        { error: `Esta solicitação já se encontra quitada (status: ${sol.status}). Não é possível gerar nova cobrança.` },
        { status: 409 }
      );
    }

    if (sol.status === 'cancelada') {
      return NextResponse.json({ error: 'Esta solicitação foi cancelada.' }, { status: 409 });
    }

    const valorSolicitacao = Number(sol.valor || 0);
    if (valorSolicitacao <= 0) {
      return NextResponse.json(
        { error: 'Não há taxa configurada para esta solicitação (valor R$ 0,00). Ajuste as configurações antes de gerar cobrança.' },
        { status: 422 }
      );
    }

    const associado = sol.associado;
    if (!associado) {
      return NextResponse.json({ error: 'Associado vinculado à solicitação não encontrado.' }, { status: 404 });
    }

    // 2. Se já possui asaas_payment_id e pix_copia_cola no banco, retorna cache
    if (sol.asaas_payment_id && sol.pix_copia_cola) {
      return NextResponse.json({
        data: {
          paymentId: sol.asaas_payment_id,
          customerId: sol.asaas_customer_id,
          pixQrCode: sol.pix_qr_code_url,
          pixCopiaECola: sol.pix_copia_cola,
          invoiceUrl: sol.invoice_url,
          value: valorSolicitacao,
          status: sol.status,
        },
      });
    }

    // 3. Verifica idempotência no ASAAS por externalReference
    const cobrancaExistente = await findAsaasPaymentByExternalReferenceUmadespa(sol.id);
    if (cobrancaExistente) {
      await supabase
        .from('umadespa_carteirinhas_solicitacoes')
        .update({
          asaas_payment_id: cobrancaExistente.paymentId,
          asaas_customer_id: cobrancaExistente.customerId,
          pix_copia_cola: cobrancaExistente.pixCopiaECola,
          pix_qr_code_url: cobrancaExistente.pixQrCode,
          invoice_url: cobrancaExistente.invoiceUrl,
          updated_at: new Date().toISOString(),
        })
        .eq('id', sol.id);

      return NextResponse.json({ data: cobrancaExistente, reconciliada: true });
    }

    // 4. Cria cliente ASAAS
    const customerId = await getOrCreateAsaasCustomerForUmadespa({
      nome: associado.nome,
      cpf: associado.cpf,
      email: associado.email,
      fone: associado.fone,
    });

    // 5. Cria cobrança PIX
    const novaCobranca = await createUmadespaPixCharge({
      customerId,
      solicitacaoId: sol.id,
      valor: valorSolicitacao,
      via: sol.via,
      nomeAssociado: associado.nome,
    });

    // 6. Atualiza solicitação no banco com os dados do PIX
    await supabase
      .from('umadespa_carteirinhas_solicitacoes')
      .update({
        asaas_payment_id: novaCobranca.paymentId,
        asaas_customer_id: customerId,
        pix_copia_cola: novaCobranca.pixCopiaECola,
        pix_qr_code_url: novaCobranca.pixQrCode,
        invoice_url: novaCobranca.invoiceUrl,
        updated_at: new Date().toISOString(),
      })
      .eq('id', sol.id);

    void logDB({
      acao: 'criar_cobranca_pix',
      modulo: 'secretaria',
      entidade: 'umadespa_carteirinhas_solicitacoes',
      entidadeId: sol.id,
      descricao: `Cobrança PIX gerada no ASAAS para ${associado.nome} (UMADESPA ${sol.via}ª via, R$ ${valorSolicitacao.toFixed(2)})`,
      status: 'sucesso',
      detalhes: {
        solicitacaoId: sol.id,
        associadoId: associado.id,
        valor: valorSolicitacao,
        paymentId: novaCobranca.paymentId,
      },
    });

    return NextResponse.json({ data: novaCobranca });
  } catch (err: any) {
    console.error('[UMADESPA PIX ROUTE] Erro ao gerar PIX:', err);
    return NextResponse.json({ error: err.message || 'Erro ao gerar cobrança PIX' }, { status: 500 });
  }
}

/**
 * GET /api/v1/secretaria/umadespa/pedidos/[id]/pix
 * Consulta status e dados atuais do PIX
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireModuleAccess(request, 'umadespa');
    if (!auth.ok) return auth.response;

    const { id: solicitacaoId } = await params;
    const supabase = createServerClient();

    const { data: sol, error } = await supabase
      .from('umadespa_carteirinhas_solicitacoes')
      .select('*, associado:umadespa_associados(id, nome, cpf)')
      .eq('id', solicitacaoId)
      .maybeSingle();

    if (error || !sol) {
      return NextResponse.json({ error: 'Solicitação não localizada.' }, { status: 404 });
    }

    return NextResponse.json({
      data: {
        solicitacaoId: sol.id,
        status: sol.status,
        formaPagamento: sol.forma_pagamento,
        valor: sol.valor,
        via: sol.via,
        pagoEm: sol.pago_em,
        asaasPaymentId: sol.asaas_payment_id,
        pixQrCode: sol.pix_qr_code_url,
        pixCopiaECola: sol.pix_copia_cola,
        invoiceUrl: sol.invoice_url,
        associado: sol.associado,
      },
    });
  } catch (err: any) {
    console.error('[UMADESPA PIX GET ROUTE] Erro:', err);
    return NextResponse.json({ error: 'Erro ao consultar PIX' }, { status: 500 });
  }
}
