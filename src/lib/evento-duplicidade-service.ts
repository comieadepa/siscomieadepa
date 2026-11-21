import { SupabaseClient } from '@supabase/supabase-js';
import { cleanCpf } from '@/lib/cpf';
import { logDB } from '@/lib/audit';

export interface VerificacaoDuplicidadeResultado {
  permitido: boolean;
  statusHttp?: number;
  codigoErro?: string;
  mensagem?: string;
  inscricaoExistenteId?: string;
}

export const MSG_INSCRICAO_CONFIRMADA = 'Já existe uma inscrição confirmada para este CPF neste evento.';

/**
 * Normaliza o CPF para exatamente 11 dígitos numéricos
 */
export function normalizarCpfInscricao(cpf: string | null | undefined): string | null {
  const digits = cleanCpf(cpf);
  return digits.length === 11 ? digits : null;
}

/**
 * Verifica se já existe uma inscrição confirmada (pago ou isento) para o mesmo CPF no evento.
 * Conforme a REGRA DEFINITIVA:
 * - O mesmo CPF pode ter múltiplas tentativas de inscrição pendentes, abandonadas ou não pagas.
 * - Somente se houver uma inscrição com status 'pago' ou 'isento', novas tentativas são bloqueadas.
 */
export async function verificarInscricaoConfirmadaPorCpf(
  supabase: SupabaseClient,
  eventoId: string,
  cpf: string | null | undefined
): Promise<VerificacaoDuplicidadeResultado> {
  const cpfNorm = normalizarCpfInscricao(cpf);
  if (!cpfNorm || !eventoId) {
    return { permitido: true };
  }

  // 1. Busca inscrições existentes com variantes de CPF (formatado ou limpo)
  const cpfFormatado = cpfNorm.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  const { data: existentes, error } = await supabase
    .from('evento_inscricoes')
    .select('id, status_pagamento, nome_inscrito, cpf')
    .eq('evento_id', eventoId)
    .in('cpf', [cpfNorm, cpfFormatado])
    .in('status_pagamento', ['pago', 'isento']);

  if (!error && existentes && existentes.length > 0) {
    const jaConfirmada = existentes[0];
    return {
      permitido: false,
      statusHttp: 409,
      codigoErro: 'INSCRICAO_JA_CONFIRMADA',
      mensagem: MSG_INSCRICAO_CONFIRMADA,
      inscricaoExistenteId: jaConfirmada.id,
    };
  }

  return { permitido: true };
}

/**
 * Validação de integridade atômica para confirmação financeira (Webhook Asaas e Baixas).
 * Quando um pagamento é recebido:
 * - Nunca ignora o pagamento.
 * - Verifica atomicamente se já existe OUTRA inscrição confirmada para o mesmo CPF + evento.
 * - Se já existir outra confirmada:
 *     1. Registra a ocorrência para auditoria e estorno financeiro.
 *     2. NÃO altera a inscrição já confirmada.
 *     3. NÃO confirma uma segunda inscrição como 'pago'.
 *     4. Retorna status 'duplicado_para_estorno'.
 */
export async function validarConfirmacaoPagamentoCpf(
  supabase: SupabaseClient,
  params: {
    eventoId: string;
    inscricaoId: string;
    cpf: string | null | undefined;
    asaasPaymentId?: string | null;
    valorRecebido?: number;
  }
): Promise<{
  podeConfirmar: boolean;
  motivo: string;
  inscricaoPrincipalId?: string;
}> {
  const { eventoId, inscricaoId, cpf, asaasPaymentId, valorRecebido } = params;
  const cpfNorm = normalizarCpfInscricao(cpf);

  if (!cpfNorm) {
    return { podeConfirmar: true, motivo: 'Inscrição sem CPF cadastrado' };
  }

  const cpfFormatado = cpfNorm.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');

  // Busca se JÁ EXISTE OUTRA inscrição confirmada com este mesmo CPF no evento
  const { data: confirmadas, error } = await supabase
    .from('evento_inscricoes')
    .select('id, nome_inscrito, status_pagamento, asaas_payment_id')
    .eq('evento_id', eventoId)
    .neq('id', inscricaoId)
    .in('cpf', [cpfNorm, cpfFormatado])
    .in('status_pagamento', ['pago', 'isento']);

  if (!error && confirmadas && confirmadas.length > 0) {
    const principal = confirmadas[0];

    // Registra a ocorrência para auditoria financeira imediata e posterior estorno
    const descricao = `[PAGAMENTO_DUPLICADO_SUSPEITO] Recebido pagamento ${asaasPaymentId ?? 'N/A'} (R$ ${valorRecebido ?? 0}) para a inscrição ${inscricaoId}, porém o CPF ${cpfNorm} já possui a inscrição confirmada ${principal.id} (${principal.status_pagamento.toUpperCase()}, cobrança ${principal.asaas_payment_id ?? 'N/A'}). Necessário estorno ou análise manual da secretaria.`;

    console.warn(`[ANTI-DUPLICIDADE] ${descricao}`);

    await logDB({
      acao: 'ocorrencia_pagamento_duplicado',
      modulo: 'eventos',
      entidade: 'evento_inscricoes',
      entidadeId: inscricaoId,
      descricao,
      detalhes: {
        inscricaoId,
        cpf: cpfNorm,
        eventoId,
        asaasPaymentId,
        valorRecebido,
        inscricaoPrincipalId: principal.id,
        statusPrincipal: principal.status_pagamento,
      },
    });

    return {
      podeConfirmar: false,
      motivo: descricao,
      inscricaoPrincipalId: principal.id,
    };
  }

  return { podeConfirmar: true, motivo: 'CPF apto para confirmação' };
}
