import { SupabaseClient } from '@supabase/supabase-js';
import { cleanCpf } from '@/lib/cpf';
import { logDB } from '@/lib/audit';

export interface VerificacaoDuplicidadeResultado {
  permitido: boolean;
  statusHttp?: number;
  codigoErro?: string;
  mensagem?: string;
  inscricaoExistenteId?: string;
  possuiEquipeApoio?: boolean;
  possuiInscricaoPagante?: boolean;
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
 * Determina se o tipo de inscrição corresponde a Equipe de Apoio
 */
export function ehTipoEquipeApoio(tipo: string | null | undefined): boolean {
  if (!tipo) return false;
  const t = tipo.trim().toUpperCase();
  return t.includes('EQUIPE DE APOIO') || t === 'EQUIPE' || t === 'APOIO';
}

/**
 * Verifica se já existe uma inscrição confirmada (pago ou isento) para o mesmo CPF no evento.
 * Conforme a REGRA DEFINITIVA com a EXCEÇÃO DA 126ª AGO:
 * - O mesmo CPF pode ter múltiplas tentativas de inscrição pendentes, abandonadas ou não pagas.
 * - Regra de Duplicidade Cruzada Autorizada na 126ª AGO:
 *     Um integrante da Equipe de Apoio (inscrição isenta) pode realizar uma segunda inscrição
 *     paga para participar das plenárias, e vice-versa.
 *     - Bloqueia duplicidade dentro da mesma categoria (não permite 2 Equipes de Apoio nem 2 Inscrições Regulares).
 *     - Permite exatamente uma de Equipe de Apoio + uma Regular Pagante no mesmo CPF.
 */
export async function verificarInscricaoConfirmadaPorCpf(
  supabase: SupabaseClient,
  eventoId: string,
  cpf: string | null | undefined,
  tipoNovo?: string | null | undefined
): Promise<VerificacaoDuplicidadeResultado> {
  const cpfNorm = normalizarCpfInscricao(cpf);
  if (!cpfNorm || !eventoId) {
    return { permitido: true };
  }

  // 1. Busca inscrições existentes com variantes de CPF (formatado ou limpo)
  const cpfFormatado = cpfNorm.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  const { data: existentes, error } = await supabase
    .from('evento_inscricoes')
    .select('id, status_pagamento, nome_inscrito, cpf, tipo_inscricao, valor_final')
    .eq('evento_id', eventoId)
    .in('cpf', [cpfNorm, cpfFormatado])
    .in('status_pagamento', ['pago', 'isento']);

  if (!error && existentes && existentes.length > 0) {
    const isNovoEquipe = ehTipoEquipeApoio(tipoNovo);

    // Identifica se já tem inscrição confirmada de Equipe de Apoio e/ou Pagante/Regular
    const existenteEquipe = existentes.find(i => ehTipoEquipeApoio(i.tipo_inscricao));
    const existenteRegular = existentes.find(i => !ehTipoEquipeApoio(i.tipo_inscricao));

    // Se informou o tipo da nova inscrição:
    if (tipoNovo !== undefined && tipoNovo !== null) {
      if (isNovoEquipe) {
        // Tentando criar Equipe de Apoio:
        if (existenteEquipe) {
          return {
            permitido: false,
            statusHttp: 409,
            codigoErro: 'DUPLICIDADE_EQUIPE_APOIO',
            mensagem: 'Este CPF já possui uma inscrição confirmada como Equipe de Apoio neste evento.',
            inscricaoExistenteId: existenteEquipe.id,
            possuiEquipeApoio: true,
            possuiInscricaoPagante: !!existenteRegular,
          };
        }
        // Já tem regular, mas é novo Equipe de Apoio -> Permitido pela exceção!
        return {
          permitido: true,
          possuiEquipeApoio: false,
          possuiInscricaoPagante: true,
          inscricaoExistenteId: existenteRegular?.id,
        };
      } else {
        // Tentando criar Inscrição Regular (Pagante):
        if (existenteRegular) {
          return {
            permitido: false,
            statusHttp: 409,
            codigoErro: 'INSCRICAO_JA_CONFIRMADA',
            mensagem: MSG_INSCRICAO_CONFIRMADA,
            inscricaoExistenteId: existenteRegular.id,
            possuiEquipeApoio: !!existenteEquipe,
            possuiInscricaoPagante: true,
          };
        }
        // Tem existente Equipe de Apoio, mas não tem Regular -> Permitido pela exceção!
        if (existenteEquipe) {
          return {
            permitido: true,
            possuiEquipeApoio: true,
            possuiInscricaoPagante: false,
            inscricaoExistenteId: existenteEquipe.id,
          };
        }
      }
    }

    // Se tipoNovo não foi informado (chamada genérica de verificação):
    // Se só tem Equipe de Apoio existente, sinaliza que possui Equipe de Apoio
    const jaConfirmada = existentes[0];
    return {
      permitido: false,
      statusHttp: 409,
      codigoErro: 'INSCRICAO_JA_CONFIRMADA',
      mensagem: MSG_INSCRICAO_CONFIRMADA,
      inscricaoExistenteId: jaConfirmada.id,
      possuiEquipeApoio: !!existenteEquipe,
      possuiInscricaoPagante: !!existenteRegular,
    };
  }

  return { permitido: true };
}

/**
 * Validação de integridade atômica para confirmação financeira (Webhook Asaas e Baixas).
 * Quando um pagamento é recebido:
 * - Nunca ignora o pagamento.
 * - Verifica atomicamente se já existe OUTRA inscrição confirmada para o mesmo CPF + evento na mesma modalidade
 *   (permite a convivência de 1 Equipe de Apoio + 1 Pagante).
 * - Se já existir outra confirmada da mesma categoria:
 *     1. Registra a ocorrência para auditoria e estorno financeiro.
 *     2. NÃO altera a inscrição já confirmada.
 *     3. NÃO confirma uma segunda inscrição da mesma categoria como 'pago'.
 *     4. Retorna status 'duplicado_para_estorno'.
 */
export async function validarConfirmacaoPagamentoCpf(
  supabase: SupabaseClient,
  params: {
    eventoId: string;
    inscricaoId: string;
    cpf: string | null | undefined;
    tipoInscricao?: string | null;
    asaasPaymentId?: string | null;
    valorRecebido?: number;
  }
): Promise<{
  podeConfirmar: boolean;
  motivo: string;
  inscricaoPrincipalId?: string;
}> {
  const { eventoId, inscricaoId, cpf, tipoInscricao, asaasPaymentId, valorRecebido } = params;
  const cpfNorm = normalizarCpfInscricao(cpf);

  if (!cpfNorm) {
    return { podeConfirmar: true, motivo: 'Inscrição sem CPF cadastrado' };
  }

  const cpfFormatado = cpfNorm.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');

  // Busca se JÁ EXISTE OUTRA inscrição confirmada com este mesmo CPF no evento
  const { data: confirmadas, error } = await supabase
    .from('evento_inscricoes')
    .select('id, nome_inscrito, status_pagamento, asaas_payment_id, tipo_inscricao')
    .eq('evento_id', eventoId)
    .neq('id', inscricaoId)
    .in('cpf', [cpfNorm, cpfFormatado])
    .in('status_pagamento', ['pago', 'isento']);

  if (!error && confirmadas && confirmadas.length > 0) {
    const isNovoEquipe = ehTipoEquipeApoio(tipoInscricao);

    // Se a nova inscrição que está sendo paga for regular,
    // verifica se as confirmadas contêm outra REGULAR. Se só tiver Equipe de Apoio, PODE confirmar!
    const outraMesmaCategoria = confirmadas.find(c => {
      const cEquipe = ehTipoEquipeApoio(c.tipo_inscricao);
      return isNovoEquipe ? cEquipe : !cEquipe;
    });

    if (outraMesmaCategoria) {
      const principal = outraMesmaCategoria;
      // Registra a ocorrência para auditoria financeira imediata e posterior estorno
      const descricao = `[PAGAMENTO_DUPLICADO_SUSPEITO] Recebido pagamento ${asaasPaymentId ?? 'N/A'} (R$ ${valorRecebido ?? 0}) para a inscrição ${inscricaoId}, porém o CPF ${cpfNorm} já possui a inscrição confirmada ${principal.id} (${principal.status_pagamento.toUpperCase()}, cobrança ${principal.asaas_payment_id ?? 'N/A'}, tipo: ${principal.tipo_inscricao}). Necessário estorno ou análise manual da secretaria.`;

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
          tipoPrincipal: principal.tipo_inscricao,
          tipoNovo: tipoInscricao,
        },
      });

      return {
        podeConfirmar: false,
        motivo: descricao,
        inscricaoPrincipalId: principal.id,
      };
    }
  }

  return { podeConfirmar: true, motivo: 'CPF apto para confirmação' };
}
