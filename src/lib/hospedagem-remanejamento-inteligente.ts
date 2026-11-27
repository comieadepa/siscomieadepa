/**
 * Módulo de Regularização e Remanejamento Inteligente da Paridade dos Leitos
 * 126ª AGO DA COMIEADEPA
 *
 * REGRAS INVIOLÁVEIS:
 * 1. Prioridade Absoluta: Nenhum hóspede com direito à cama inferior (idade >= 60, comorbidade,
 *    necessidade física) pode ser movido para cama superior.
 * 2. Proteção de Check-in: Hóspedes com check-in já realizado são estritamente INTOCÁVEIS.
 * 3. Paridade Física: Ímpar = Superior | Par = Inferior.
 * 4. Preservação de Colchonetes: Isentos da regra de paridade de beliches.
 * 5. Ordem de Preenchimento: Prioriza leitos livres compatíveis antes de realizar permutas.
 * 6. Concorrência: Execução atômica com transação e verificação em tempo real de ocupação.
 */

import { SupabaseClient } from '@supabase/supabase-js';

export interface ResultadoPlanoRemanejamento {
  alojamentoId: string;
  alojamentoNome: string;
  totalAlocados: number;
  totalPrioritarios: number;
  totalNaoPrioritarios: number;
  totalCheckinsProtegidos: number;
  acoes: AcaoRemanejamento[];
  saldoLeitosInferioresLivres: number;
  viavel: boolean;
  mensagem: string;
}

export interface AcaoRemanejamento {
  tipo: 'LEITO_LIVRE' | 'PERMUTA';
  inscricaoIdPrioritario: string;
  nomePrioritario: string;
  leitoOrigemPrioritario: string;
  leitoDestinoPrioritario: string;
  inscricaoIdNaoPrioritario?: string;
  nomeNaoPrioritario?: string;
  leitoOrigemNaoPrioritario?: string;
  leitoDestinoNaoPrioritario?: string;
  motivo: string;
}

function calcularIdade(dataNasc?: string | null): number | null {
  if (!dataNasc) return null;
  const hoje = new Date();
  const nasc = new Date(dataNasc);
  if (isNaN(nasc.getTime())) return null;
  let idade = hoje.getFullYear() - nasc.getFullYear();
  const m = hoje.getMonth() - nasc.getMonth();
  if (m < 0 || (m === 0 && hoje.getDate() < nasc.getDate())) {
    idade--;
  }
  return idade;
}

function isPar(n: number): boolean {
  return n % 2 === 0;
}

/**
 * Gera a simulação somente leitura do plano de remanejamento inteligente
 * Não altera nada no banco de dados.
 */
export async function simularPlanoRemanejamento(
  supabase: SupabaseClient,
  eventoId: string
): Promise<ResultadoPlanoRemanejamento[]> {
  // 1. Buscar alojamentos da 126ª AGO
  const { data: alojamentos, error: errAloj } = await supabase
    .from('evento_alojamentos')
    .select('id, nome, total_vagas, camas_inferiores, camas_superiores, colchonetes')
    .eq('evento_id', eventoId);

  if (errAloj || !alojamentos) {
    throw new Error(`Erro ao buscar alojamentos: ${errAloj?.message}`);
  }

  // 2. Buscar todas as hospedagens alocadas
  const { data: hospedagens, error: errHosp } = await supabase
    .from('evento_hospedagens')
    .select(`
      id, inscricao_id, alojamento_id, numero_cama, tipo_cama, status,
      cama_inferior, prioridade, necessidade_especial, descricao_necessidade,
      checkin_at
    `)
    .eq('evento_id', eventoId)
    .not('alojamento_id', 'is', null);

  if (errHosp || !hospedagens) {
    throw new Error(`Erro ao buscar hospedagens: ${errHosp?.message}`);
  }

  // 3. Buscar dados dos inscritos
  const inscricaoIds = hospedagens.map((h: any) => h.inscricao_id).filter(Boolean);
  const { data: inscricoes } = await supabase
    .from('evento_inscricoes')
    .select(`
      id, nome_inscrito, cpf, tipo_inscricao, data_nascimento,
      hosp_necessidade_especial, hosp_possui_comorbidade, hosp_cama_inferior,
      ministro_snapshot
    `)
    .in('id', inscricaoIds);

  const mapInscricao = new Map<string, any>();
  (inscricoes || []).forEach((i: any) => mapInscricao.set(i.id, i));

  const resultados: ResultadoPlanoRemanejamento[] = [];

  for (const aloj of alojamentos) {
    const nomeUpper = aloj.nome.toUpperCase();
    const usaParidade = nomeUpper.includes('ROSA') ||
                        nomeUpper.includes('AZUL') ||
                        nomeUpper.includes('NOVO') ||
                        nomeUpper.includes('AAME') ||
                        nomeUpper.includes('MÁRIO') ||
                        nomeUpper.includes('MARIO');

    const alocs = hospedagens.filter((h: any) => h.alojamento_id === aloj.id);

    // Mapear hóspedes
    const prioritariosPrejudicados: any[] = [];
    const naoPrioritariosEmParSemCheckin: any[] = [];
    let checkinCount = 0;
    let totalPrioritarios = 0;
    let totalNaoPrioritarios = 0;

    const leitosOcupadosSet = new Set<string>();

    for (const h of alocs) {
      const numInt = parseInt(h.numero_cama, 10);
      const ins = mapInscricao.get(h.inscricao_id);
      const dataNasc = ins?.data_nascimento || ins?.ministro_snapshot?.data_nascimento;
      const idade = calcularIdade(dataNasc);
      const temComorbidade = Boolean(
        h.necessidade_especial ||
        ins?.hosp_necessidade_especial ||
        ins?.hosp_possui_comorbidade
      );
      const solicitouCamaInf = Boolean(h.cama_inferior || ins?.hosp_cama_inferior);
      const idoso = idade !== null && idade >= 60;
      const temDireitoInferior = idoso || temComorbidade || (h.prioridade >= 100) || (solicitouCamaInf && h.prioridade >= 50);
      const ehCheckin = Boolean(h.checkin_at);

      if (ehCheckin) checkinCount++;
      if (temDireitoInferior) totalPrioritarios++;
      else totalNaoPrioritarios++;

      if (h.numero_cama) {
        leitosOcupadosSet.add(h.numero_cama.padStart(3, '0'));
        leitosOcupadosSet.add(parseInt(h.numero_cama, 10).toString());
      }

      if (ehCheckin) {
        // Intocável
        continue;
      }

      if (usaParidade && !isNaN(numInt)) {
        if (temDireitoInferior && !isPar(numInt)) {
          // Prioritário em cama ímpar (superior): precisa de cama par (inferior)
          prioritariosPrejudicados.push({
            hospId: h.id,
            inscricaoId: h.inscricao_id,
            nome: ins?.nome_inscrito || 'Inscrito',
            leitoAtual: h.numero_cama,
            numAtual: numInt,
            prioridade: h.prioridade,
            idade,
            temComorbidade,
          });
        } else if (!temDireitoInferior && isPar(numInt)) {
          // Não-prioritário em cama par: disponível para troca
          naoPrioritariosEmParSemCheckin.push({
            hospId: h.id,
            inscricaoId: h.inscricao_id,
            nome: ins?.nome_inscrito || 'Inscrito',
            leitoAtual: h.numero_cama,
            numAtual: numInt,
            prioridade: h.prioridade,
            idade,
          });
        }
      }
    }

    // Leitos pares livres (sem ocupante em evento_hospedagens nem leitos ocupados)
    const paresLivres: string[] = [];
    const totalVagas = aloj.total_vagas;
    for (let i = 2; i <= totalVagas; i += 2) {
      const numPadded = i.toString().padStart(3, '0');
      const numStr = i.toString();
      if (!leitosOcupadosSet.has(numPadded) && !leitosOcupadosSet.has(numStr)) {
        paresLivres.push(numPadded);
      }
    }

    const acoes: AcaoRemanejamento[] = [];

    // FASE 2.1: Alocar Prioritários em Leitos Pares Livres Disponíveis (sem precisar mexer em ninguém)
    for (let pIdx = prioritariosPrejudicados.length - 1; pIdx >= 0; pIdx--) {
      if (paresLivres.length > 0) {
        const prioritario = prioritariosPrejudicados[pIdx];
        const novoLeitoPar = paresLivres.shift()!;
        acoes.push({
          tipo: 'LEITO_LIVRE',
          inscricaoIdPrioritario: prioritario.inscricaoId,
          nomePrioritario: prioritario.nome,
          leitoOrigemPrioritario: prioritario.leitoAtual,
          leitoDestinoPrioritario: novoLeitoPar,
          motivo: `Hóspede prioritário (idade/comorbidade) remanejado para leito inferior par livre ${novoLeitoPar}`,
        });
        prioritariosPrejudicados.splice(pIdx, 1);
      }
    }

    // FASE 2.2: Para os prioritários restantes, realizar Permuta Elegante com Não-Prioritário em Par
    while (prioritariosPrejudicados.length > 0 && naoPrioritariosEmParSemCheckin.length > 0) {
      const prioritario = prioritariosPrejudicados.shift()!;
      const naoPrioritario = naoPrioritariosEmParSemCheckin.shift()!;

      acoes.push({
        tipo: 'PERMUTA',
        inscricaoIdPrioritario: prioritario.inscricaoId,
        nomePrioritario: prioritario.nome,
        leitoOrigemPrioritario: prioritario.leitoAtual,
        leitoDestinoPrioritario: naoPrioritario.leitoAtual,
        inscricaoIdNaoPrioritario: naoPrioritario.inscricaoId,
        nomeNaoPrioritario: naoPrioritario.nome,
        leitoOrigemNaoPrioritario: naoPrioritario.leitoAtual,
        leitoDestinoNaoPrioritario: prioritario.leitoAtual,
        motivo: `Permuta Direta: Prioritário assume cama inferior par ${naoPrioritario.leitoAtual}; Não-prioritário assume cama superior ímpar ${prioritario.leitoAtual}`,
      });
    }

    const saldoInferiores = aloj.camas_inferiores - totalPrioritarios;
    const viavel = prioritariosPrejudicados.length === 0;

    resultados.push({
      alojamentoId: aloj.id,
      alojamentoNome: aloj.nome,
      totalAlocados: alocs.length,
      totalPrioritarios,
      totalNaoPrioritarios,
      totalCheckinsProtegidos: checkinCount,
      acoes,
      saldoLeitosInferioresLivres: saldoInferiores,
      viavel,
      mensagem: viavel
        ? `Remanejamento 100% viável: ${acoes.length} ações planejadas. Nenhum prioritário desatendido.`
        : `Atenção: ${prioritariosPrejudicados.length} prioritários restaram sem leito inferior par disponível.`,
    });
  }

  return resultados;
}
