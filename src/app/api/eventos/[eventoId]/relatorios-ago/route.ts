import { NextRequest, NextResponse } from 'next/server';
import { requireEventoPermission } from '@/lib/evento-guard';

// GET /api/eventos/[eventoId]/relatorios-ago
// Retorna estatísticas consolidadas para o painel de Relatórios AGO
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

  // Total credenciados (checkin_realizado = true)
  const { count: totalCredenciados } = await supabase
    .from('evento_inscricoes')
    .select('id', { count: 'exact', head: true })
    .eq('evento_id', eventoId)
    .eq('checkin_realizado', true)
    .neq('status_pagamento', 'cancelado');

  // Total com pelo menos 1 presença em plenária
  const { data: comPresenca } = await supabase
    .from('evento_checkins')
    .select('inscricao_id')
    .eq('tipo_checkin', 'plenaria')
    .eq('evento_id', eventoId);

  const inscricosComPresenca = new Set((comPresenca ?? []).map(c => c.inscricao_id)).size;

  // Refeições consumidas e restantes
  const { data: refeicoes } = await supabase
    .from('evento_inscricoes')
    .select('alimentacao, refeicoes_total, refeicoes_utilizadas, quantidade_refeicoes_total, quantidade_refeicoes_usadas, quantidade_refeicoes_saldo')
    .eq('evento_id', eventoId)
    .neq('status_pagamento', 'cancelado');

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
