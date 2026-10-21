import { NextRequest, NextResponse } from 'next/server';
import { requireEventoPermission } from '@/lib/evento-guard';

// GET /api/eventos/[eventoId]/relatorios-ago
// Retorna estatísticas consolidadas para o painel de Relatórios AGO
async function fetchAllRows<T>(
  queryBuilder: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>
): Promise<T[]> {
  const PAGE = 1000;
  const result: T[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await queryBuilder(from, from + PAGE - 1);
    if (error) throw error;
    const rows = data ?? [];
    result.push(...rows);
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return result;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;
  const guard = await requireEventoPermission(request, eventoId, 'relatorios_ago');
  if (!guard.ok) return guard.response;

  const supabase = guard.ctx.supabaseAdmin;

  // Busca dados do evento
  const { data: evento } = await supabase
    .from('eventos')
    .select('id, status, encerrado_em, configuracoes_ago')
    .eq('id', eventoId)
    .single();

  if (!evento) return NextResponse.json({ error: 'Evento não encontrado.' }, { status: 404 });

  // Total de inscritos ativos
  const { count: totalInscritos } = await supabase
    .from('evento_inscricoes')
    .select('id', { count: 'exact', head: true })
    .eq('evento_id', eventoId)
    .neq('status_pagamento', 'cancelado');

  // Busca check-ins paginados para totalizar participantes comprovados
  let checkinsAll: Array<{ inscricao_id: string; tipo_checkin: string; data_plenaria: string | null }> = [];
  try {
    checkinsAll = await fetchAllRows(async (from, to) => {
      return supabase
        .from('evento_checkins')
        .select('inscricao_id, tipo_checkin, data_plenaria')
        .eq('evento_id', eventoId)
        .range(from, to);
    });
  } catch (err) {
    console.warn('Erro ao buscar check-ins completos para indicadores AGO:', err);
  }

  const credenciadosSet = new Set<string>();
  const presencaPlenariaSet = new Set<string>();
  for (const ck of checkinsAll) {
    if (!ck.inscricao_id) continue;
    credenciadosSet.add(ck.inscricao_id);
    if (ck.tipo_checkin === 'plenaria') presencaPlenariaSet.add(ck.inscricao_id);
  }

  // Total credenciados: se evento_inscricoes possui checkin_realizado usa contagem, senão participantes com check-in registrado
  const { count: countFlagCredenciados } = await supabase
    .from('evento_inscricoes')
    .select('id', { count: 'exact', head: true })
    .eq('evento_id', eventoId)
    .eq('checkin_realizado', true)
    .neq('status_pagamento', 'cancelado');

  const totalCredenciados = Math.max(countFlagCredenciados ?? 0, credenciadosSet.size);
  const inscricosComPresenca = presencaPlenariaSet.size;

  // Refeições consumidas e restantes (paginado)
  let refeicoes: any[] = [];
  try {
    refeicoes = await fetchAllRows(async (from, to) => {
      return supabase
        .from('evento_inscricoes')
        .select('alimentacao, refeicoes_total, refeicoes_utilizadas, quantidade_refeicoes_total, quantidade_refeicoes_usadas, quantidade_refeicoes_saldo')
        .eq('evento_id', eventoId)
        .neq('status_pagamento', 'cancelado')
        .range(from, to);
    });
  } catch (err) {
    console.warn('Erro ao buscar refeições paginadas:', err);
  }

  let refeicoesConsumidas = 0;
  let refeicoesPrevistas  = 0;
  let refeicoesRestantes  = 0;
  let totalComAlimentacao = 0;
  for (const r of refeicoes ?? []) {
    const previstas = r.quantidade_refeicoes_total ?? r.refeicoes_total ?? 0;
    const consumidas = r.quantidade_refeicoes_usadas ?? r.refeicoes_utilizadas ?? 0;
    const saldo = r.quantidade_refeicoes_saldo ?? Math.max(0, previstas - consumidas);
    if (r.alimentacao === true) totalComAlimentacao++;
    refeicoesPrevistas += previstas;
    refeicoesConsumidas += consumidas;
    refeicoesRestantes += saldo;
  }

  // Frequência média (se evento encerrado, usa tabela consolidada; caso contrário, calcula)
  let frequenciaMedia: number | null = null;
  let totalAusentesConsolidado: number | null = null;

  if (evento.status === 'encerrado') {
    const { data: freqFinal } = await supabase
      .from('evento_ago_frequencia_final')
      .select('percentual_frequencia')
      .eq('evento_id', eventoId);

    if (freqFinal && freqFinal.length > 0) {
      const soma = freqFinal.reduce((a, r) => a + (r.percentual_frequencia ?? 0), 0);
      frequenciaMedia = Math.round((soma / freqFinal.length) * 100) / 100;
    }

    const { count: ausentes } = await supabase
      .from('evento_ago_ausentes')
      .select('id', { count: 'exact', head: true })
      .eq('evento_id', eventoId);
    totalAusentesConsolidado = ausentes ?? 0;
  } else {
    // Calcula frequência em tempo real com base nos check-ins
    const { data: allCheckins } = await supabase
      .from('evento_checkins')
      .select('inscricao_id, data_plenaria, tipo_checkin')
      .eq('tipo_checkin', 'plenaria')
      .eq('evento_id', eventoId);

    const cfg = (evento.configuracoes_ago ?? {}) as Record<string, unknown>;
    const configPlenarias = Array.isArray(cfg.plenarias_datas) ? (cfg.plenarias_datas as string[]) : [];

    let plenariasDatas = configPlenarias;
    if (plenariasDatas.length === 0) {
      const datasUnicas = new Set<string>();
      for (const ck of allCheckins ?? []) {
        if (ck.tipo_checkin === 'plenaria' && ck.data_plenaria) {
          datasUnicas.add(ck.data_plenaria);
        }
      }
      plenariasDatas = Array.from(datasUnicas).sort();
    }
    const totalPlenarias = plenariasDatas.length;

    if (totalPlenarias > 0 && (totalInscritos ?? 0) > 0) {
      const presencasPorInscricao = new Map<string, Set<string>>();
      for (const ck of allCheckins ?? []) {
        if (!ck.inscricao_id || !ck.data_plenaria) continue;
        if (!presencasPorInscricao.has(ck.inscricao_id)) presencasPorInscricao.set(ck.inscricao_id, new Set());
        presencasPorInscricao.get(ck.inscricao_id)!.add(ck.data_plenaria);
      }

      const { data: inscIds } = await supabase
        .from('evento_inscricoes')
        .select('id')
        .eq('evento_id', eventoId)
        .neq('status_pagamento', 'cancelado');

      let somaPercentual = 0;
      let countAusentes  = 0;
      for (const i of inscIds ?? []) {
        const presencas  = presencasPorInscricao.get(i.id)?.size ?? 0;
        const percentual = Math.round((presencas / totalPlenarias) * 10000) / 100;
        somaPercentual  += percentual;
        if (percentual < 100) countAusentes++;
      }

      const n = (inscIds ?? []).length;
      if (n > 0) frequenciaMedia = Math.round((somaPercentual / n) * 100) / 100;
      totalAusentesConsolidado = countAusentes;
    }
  }

  const incs = totalInscritos ?? 0;
  void incs; // used in total_ausentes_plenaria below

  // Contagem de inscritos de Campos Missionários
  const { data: inscricoesMissionario } = await supabase
    .from('evento_inscricoes')
    .select('ministro_snapshot')
    .eq('evento_id', eventoId)
    .neq('status_pagamento', 'cancelado');

  let totalCampoMissionario = 0;
  for (const ins of inscricoesMissionario ?? []) {
    const snap = ins.ministro_snapshot as Record<string, unknown> | null;
    if (snap?.is_campo_missionario === true) totalCampoMissionario++;
  }

  return NextResponse.json({
    status_evento: evento.status,
    encerrado_em:  evento.encerrado_em ?? null,
    total_inscritos:      totalInscritos      ?? 0,
    total_credenciados:   totalCredenciados   ?? 0,
    total_presentes:      inscricosComPresenca,
    total_ausentes_plenaria: Math.max(0, (totalInscritos ?? 0) - inscricosComPresenca),
    frequencia_media:     frequenciaMedia,
    total_ausentes_consolidado: totalAusentesConsolidado,
    total_inscritos_com_alimentacao: totalComAlimentacao,
    refeicoes_previstas: refeicoesPrevistas,
    refeicoes_consumidas: refeicoesConsumidas,
    refeicoes_restantes:  refeicoesRestantes,
    total_campo_missionario: totalCampoMissionario,
  });
}
