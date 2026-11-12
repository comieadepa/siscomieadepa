import { createServerClient } from '@/lib/supabase-server';
import { DadosReciboAemadepa } from './recibo-pdf';

/**
 * Monta os dados completos do recibo AEMADEPA a partir de uma solicitação paga no banco
 * Valida se o pagamento está efetivamente confirmado antes de permitir a emissão.
 */
export async function obterDadosReciboAemadepa(solicitacaoId: string): Promise<{
  ok: boolean;
  dados?: DadosReciboAemadepa;
  erro?: string;
  codigoHttp?: number;
}> {
  const supabase = createServerClient();

  const { data: sol, error: solErr } = await supabase
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
      pago_em,
      solicitado_em,
      observacoes
    `)
    .eq('id', solicitacaoId)
    .maybeSingle();

  if (solErr || !sol) {
    return { ok: false, erro: 'Solicitação de carteirinha não encontrada.', codigoHttp: 404 };
  }

  // Validação: somente permite recibo para solicitações com pagamento confirmado
  const statusPagos = ['pago', 'em_impressao', 'impressa', 'entregue'];
  const estaPago = Boolean(sol.pago_em || statusPagos.includes(sol.status));

  if (!estaPago) {
    return {
      ok: false,
      erro: `Não é possível emitir recibo para uma solicitação com status '${sol.status}'. O pagamento ainda não foi confirmado.`,
      codigoHttp: 422,
    };
  }

  // Busca dados da associada e do ministro vinculado
  const [{ data: assoc }, { data: ministro }] = await Promise.all([
    supabase
      .from('aemadepa_associadas')
      .select('id, nome, cpf, rg, orgao_emissor, fone, email, numero_aemadepa')
      .eq('id', sol.associada_id)
      .maybeSingle(),
    supabase
      .from('members')
      .select('id, name, matricula, custom_fields')
      .eq('id', sol.ministro_id)
      .maybeSingle(),
  ]);

  const cfMin = ministro?.custom_fields && typeof ministro.custom_fields === 'object'
    ? (ministro.custom_fields as Record<string, any>)
    : {};

  // Formata o número único do recibo determinístico
  const dataRef = sol.pago_em ? new Date(sol.pago_em) : new Date(sol.solicitado_em || Date.now());
  const ano = isNaN(dataRef.getFullYear()) ? new Date().getFullYear() : dataRef.getFullYear();
  const idSufixo = String(sol.id || '').replace(/-/g, '').slice(-6).toUpperCase();
  const numeroRecibo = `REC-AEMADEPA-${ano}-${idSufixo}`;

  const dados: DadosReciboAemadepa = {
    numeroRecibo,
    solicitacaoId: sol.id,
    dataPagamento: sol.pago_em || sol.solicitado_em || new Date().toISOString(),
    valorPago: Number(sol.valor || 0),
    formaPagamento: sol.forma_pagamento || 'pix_asaas',
    transacaoId: sol.asaas_payment_id || null,
    viaCredencial: Number(sol.via || 1),
    associada: {
      nome: assoc?.nome || '—',
      cpf: assoc?.cpf || '—',
      rg: assoc?.rg ? `${assoc.rg}${assoc.orgao_emissor ? ` / ${assoc.orgao_emissor}` : ''}` : null,
      numeroAemadepa: assoc?.numero_aemadepa || cfMin.numero_aemadepa || null,
      fone: assoc?.fone || null,
      email: assoc?.email || null,
    },
    ministro: {
      nome: ministro?.name || cfMin.nome || '—',
      matricula: ministro?.matricula || cfMin.matricula || null,
      campo: cfMin.campo || null,
      supervisao: cfMin.supervisao || null,
      cargo: cfMin.cargo || cfMin.funcao || 'Pastor',
    },
  };

  return { ok: true, dados };
}
