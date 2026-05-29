/**
 * POST /api/portal-ministro/impressao/solicitar
 * Cria solicitação de impressão de credencial e cobrança no ASAAS (R$20,00).
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { getMinistroSession, unauthorizedResponse } from '@/lib/ministro-session';
import { createAsaasPayment, createAsaasCustomer } from '@/lib/asaas';
import { logDB } from '@/lib/audit';

const VALOR_IMPRESSAO = 20.0; // R$ 20,00
const VALOR_CENTAVOS = 2000;

function fmtDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function POST(request: NextRequest) {
  const session = await getMinistroSession(request);
  if (!session) return unauthorizedResponse();

  const supabase = createServerClient();

  // Busca dados do ministro
  const { data: ministro, error: mErr } = await supabase
    .from('members')
    .select('id, name, cpf, email, status')
    .eq('id', session.ministroId)
    .maybeSingle();

  if (mErr || !ministro) {
    return NextResponse.json({ error: 'Ministro não encontrado.' }, { status: 404 });
  }

  if (ministro.status !== 'active') {
    return NextResponse.json(
      { error: 'Ministro não está ativo. Contate a secretaria.' },
      { status: 403 },
    );
  }

  // Verifica se já há solicitação pendente de pagamento ou paga aguardando impressão
  const { data: pendente } = await supabase
    .from('credencial_impressoes_solicitacoes')
    .select('id, status')
    .eq('ministro_id', session.ministroId)
    .in('status', ['aguardando_pagamento', 'pago_pendente_impressao'])
    .maybeSingle();

  if (pendente) {
    return NextResponse.json(
      { error: 'Já existe uma solicitação em andamento.', solicitacaoId: pendente.id, status: pendente.status },
      { status: 409 },
    );
  }

  // Cria a solicitação no banco (status inicial: aguardando_pagamento)
  const { data: solicitacao, error: sErr } = await supabase
    .from('credencial_impressoes_solicitacoes')
    .insert({
      ministro_id: session.ministroId,
      valor_centavos: VALOR_CENTAVOS,
      status: 'aguardando_pagamento',
    })
    .select('id')
    .single();

  if (sErr || !solicitacao) {
    console.error('[impressao/solicitar] Erro ao criar solicitação:', sErr?.message);
    return NextResponse.json({ error: 'Erro ao criar solicitação.' }, { status: 500 });
  }

  const externalReference = `credencial_impressao:${solicitacao.id}`;

  try {
    // Cria ou obtém cliente ASAAS
    const cleanCpf = (ministro.cpf || '').replace(/\D/g, '');
    const email = ministro.email || `ministro-${session.ministroId}@siscomieadepa.local`;

    const customer = await createAsaasCustomer({
      name: ministro.name,
      email,
      cpfCnpj: cleanCpf || null,
    });

    const dueDate = fmtDate(new Date(Date.now() + 3 * 86400 * 1000)); // 3 dias

    const payment = await createAsaasPayment({
      customer: customer.id,
      value: VALOR_IMPRESSAO,
      dueDate,
      description: 'Taxa de impressão de credencial ministerial',
      billingType: 'UNDEFINED', // permite boleto/pix/cartão
      externalReference,
    });

    // Atualiza solicitação com dados do ASAAS
    await supabase
      .from('credencial_impressoes_solicitacoes')
      .update({
        asaas_payment_id: payment.id,
        asaas_customer_id: customer.id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', solicitacao.id);

    void logDB({
      acao: 'criar',
      modulo: 'portal_ministro',
      entidade: 'credencial_impressao',
      entidadeId: solicitacao.id,
      descricao: `Solicitação de impressão criada para ${ministro.name}`,
      status: 'sucesso',
      detalhes: { asaasPaymentId: payment.id, valor: VALOR_IMPRESSAO },
    });

    return NextResponse.json({
      ok: true,
      solicitacaoId: solicitacao.id,
      asaasPaymentId: payment.id,
      linkPagamento: payment.invoiceUrl || payment.bankSlipUrl || null,
      pixCopiaECola: payment.pixTransaction?.payload || null,
      dueDate,
    });
  } catch (err: any) {
    console.error('[impressao/solicitar] Erro ASAAS:', err.message);

    // Cancela solicitação em caso de falha do ASAAS
    await supabase
      .from('credencial_impressoes_solicitacoes')
      .update({ status: 'cancelado', cancelado_em: new Date().toISOString() })
      .eq('id', solicitacao.id);

    return NextResponse.json(
      { error: `Erro ao gerar cobrança: ${err.message}` },
      { status: 502 },
    );
  }
}
