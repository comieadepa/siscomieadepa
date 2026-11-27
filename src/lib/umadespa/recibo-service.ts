import { createServerClient } from '@/lib/supabase-server';
import { DadosReciboUmadespa } from './recibo-pdf';

/**
 * Monta os dados completos do recibo UMADESPA a partir de uma solicitação paga no banco.
 * Valida se o pagamento está efetivamente confirmado antes de permitir a emissão.
 */
export async function obterDadosReciboUmadespa(solicitacaoId: string): Promise<{
  ok: boolean;
  dados?: DadosReciboUmadespa;
  erro?: string;
  codigoHttp?: number;
}> {
  const supabase = createServerClient();

  const { data: sol, error: solErr } = await supabase
    .from('umadespa_carteirinhas_solicitacoes')
    .select(`
      id,
      associado_id,
      via,
      valor,
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
    return { ok: false, erro: 'Solicitação de carteirinha UMADESPA não encontrada.', codigoHttp: 404 };
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

  // Busca dados do associado vinculado
  const { data: assoc, error: assocErr } = await supabase
    .from('umadespa_associados')
    .select(`
      id,
      nome,
      cpf,
      rg,
      orgao_emissor,
      fone,
      email,
      numero_umadespa,
      funcao,
      is_lideranca,
      menor_idade,
      responsavel_nome,
      supervisao:supervisoes(nome),
      campo:campos(nome),
      congregacao:congregacoes(nome)
    `)
    .eq('id', sol.associado_id)
    .maybeSingle();

  if (assocErr || !assoc) {
    return { ok: false, erro: 'Associado vinculado à solicitação não encontrado.', codigoHttp: 404 };
  }

  // Formata o número único do recibo determinístico
  const dataRef = sol.pago_em ? new Date(sol.pago_em) : new Date(sol.solicitado_em || Date.now());
  const ano = isNaN(dataRef.getFullYear()) ? new Date().getFullYear() : dataRef.getFullYear();
  const idSufixo = String(sol.id || '').replace(/-/g, '').slice(-6).toUpperCase();
  const numeroRecibo = `REC-UMADESPA-${ano}-${idSufixo}`;

  const dados: DadosReciboUmadespa = {
    numeroRecibo,
    solicitacaoId: sol.id,
    dataPagamento: sol.pago_em || sol.solicitado_em || new Date().toISOString(),
    valorPago: Number(sol.valor || 0),
    formaPagamento: sol.forma_pagamento || 'pix_asaas',
    transacaoId: sol.asaas_payment_id || null,
    viaCredencial: Number(sol.via || 1),
    associado: {
      nome: assoc.nome || '—',
      cpf: assoc.cpf || '—',
      rg: assoc.rg ? `${assoc.rg}${assoc.orgao_emissor ? ` / ${assoc.orgao_emissor}` : ''}` : null,
      numeroUmadespa: assoc.numero_umadespa || null,
      fone: assoc.fone || null,
      email: assoc.email || null,
      funcao: assoc.funcao || 'Membro',
      supervisao: (assoc.supervisao as any)?.nome || 'COMIEADEPA',
      campo: (assoc.campo as any)?.nome || '—',
      congregacao: (assoc.congregacao as any)?.nome || null,
      menorIdade: Boolean(assoc.menor_idade),
      responsavelNome: assoc.responsavel_nome || null,
    },
  };

  return { ok: true, dados };
}
