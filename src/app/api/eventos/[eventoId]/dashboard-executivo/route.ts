import { NextRequest, NextResponse } from 'next/server';
import { requireEventoPermission } from '@/lib/evento-guard';

export const dynamic = 'force-dynamic';

// ── Row types para evitar GenericStringError do Supabase ─────────────────────
type EventoRow = {
  id: string; nome: string; status: string;
  configuracoes_ago: Record<string, unknown> | null;
  data_inicio: string | null; data_fim: string | null;
};
type InscricaoRow = {
  id: string; nome_inscrito: string; cpf: string | null;
  tipo_inscricao: string | null; supervisao_id: string | null; campo_id: string | null;
  status_pagamento: string | null; checkin_realizado: boolean | null;
  alimentacao: boolean | null;
  refeicoes_utilizadas: number | null; refeicoes_total: number | null;
  quantidade_refeicoes_total: number | null;
  quantidade_refeicoes_usadas: number | null;
  quantidade_refeicoes_saldo: number | null;
  ministro_snapshot: Record<string, unknown> | null; hospedagem: boolean | null;
};
type CheckinRow    = { id: string; inscricao_id: string | null; tipo_checkin: string | null; data_plenaria: string | null; created_at: string; };
type RefeicaoConsumoRow = { inscricao_id: string | null; data_hora: string; saldo_antes: number | null; saldo_depois: number | null; };
type HospRow       = { id: string; inscricao_id: string | null; status: string | null; tipo_cama: string | null; numero_cama: number | null; checkin_at: string | null; };
type AdvertRow     = { id: string; inscricao_id: string | null; status: string | null; };
type SupervisaoRow = { id: string; nome: string; };
type CampoRow      = { id: string; nome: string; supervisao_id: string; };
type AlojRow       = { id: string; total_vagas: number; ativo: boolean; };

/**
 * GET /api/eventos/[eventoId]/dashboard-executivo
 *
 * Painel executivo AGO — retorna todos os dados consolidados em uma única requisição.
 * As queries são paralelizadas ao máximo; o processamento é feito em memória.
 */
/** Busca todos os registros de uma tabela paginando de 1000 em 1000. */
async function fetchAll<T>(
  builder: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const PAGE = 1000;
  const result: T[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await builder(from, from + PAGE - 1);
    if (error) throw error;
    const rows = data ?? [];
    result.push(...rows);
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return result;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> },
) {
  const { eventoId } = await params;
  const guard = await requireEventoPermission(req, eventoId, 'dashboard_executivo');
  if (!guard.ok) return guard.response;
  const supabase = guard.ctx.supabaseAdmin;

  // ── Batch 1 — todas as queries base em paralelo ───────────────────────
  const [
    eventoRes,
    inscricoesRes,
    checkinsRes,
    consumoRefeicoesRes,
    hospRes,
    advertRes,
    supRes,
    camposRes,
    alojRes,
    semCpfRes,
    semCatRes,
  ] = await Promise.all([
    supabase
      .from('eventos')
      .select('id, nome, status, configuracoes_ago, data_inicio, data_fim')
      .eq('id', eventoId)
      .single(),

    fetchAll<InscricaoRow>((f, t) =>
      supabase
        .from('evento_inscricoes')
        .select(
          'id, nome_inscrito, cpf, tipo_inscricao, supervisao_id, campo_id, ' +
          'status_pagamento, checkin_realizado, alimentacao, refeicoes_utilizadas, refeicoes_total, ' +
          'quantidade_refeicoes_total, quantidade_refeicoes_usadas, quantidade_refeicoes_saldo, ' +
          'ministro_snapshot, hospedagem',
        )
        .eq('evento_id', eventoId)
        .neq('status_pagamento', 'cancelado')
        .range(f, t) as unknown as PromiseLike<{ data: InscricaoRow[] | null; error: unknown }>
    ),

    fetchAll<CheckinRow>((f, t) =>
      supabase
        .from('evento_checkins')
        .select('id, inscricao_id, tipo_checkin, data_plenaria, created_at')
        .eq('evento_id', eventoId)
        .range(f, t) as unknown as PromiseLike<{ data: CheckinRow[] | null; error: unknown }>
    ),

    fetchAll<RefeicaoConsumoRow>((f, t) =>
      supabase
        .from('evento_refeicoes_consumo')
        .select('inscricao_id,data_hora,saldo_antes,saldo_depois')
        .eq('evento_id', eventoId)
        .range(f, t) as unknown as PromiseLike<{ data: RefeicaoConsumoRow[] | null; error: unknown }>
    ),

    fetchAll<HospRow>((f, t) =>
      supabase
        .from('evento_hospedagens')
        .select('id, inscricao_id, status, tipo_cama, numero_cama, checkin_at')
        .eq('evento_id', eventoId)
        .range(f, t) as unknown as PromiseLike<{ data: HospRow[] | null; error: unknown }>
    ),

    supabase
      .from('ago_cartas_advertencia')
      .select('id, inscricao_id, status')
      .eq('evento_id', eventoId),

    supabase
      .from('supervisoes')
      .select('id, nome')
      .eq('is_active', true)
      .order('nome'),

    supabase
      .from('campos')
      .select('id, nome, supervisao_id')
      .eq('is_active', true)
      .order('nome'),

    supabase
      .from('evento_alojamentos')
      .select('id, total_vagas, ativo')
      .eq('evento_id', eventoId)
      .eq('ativo', true),

    // Integridade rápida
    supabase
      .from('evento_inscricoes')
      .select('id', { count: 'exact', head: true })
      .eq('evento_id', eventoId)
      .neq('status_pagamento', 'cancelado')
      .or('cpf.is.null,cpf.eq.'),

    supabase
      .from('evento_inscricoes')
      .select('id', { count: 'exact', head: true })
      .eq('evento_id', eventoId)
      .neq('status_pagamento', 'cancelado')
      .or('tipo_inscricao.is.null,tipo_inscricao.eq.'),
  ]);

  if (!eventoRes.data) {
    return NextResponse.json({ error: 'Evento não encontrado.' }, { status: 404 });
  }

  const evento           = eventoRes.data as unknown as EventoRow;
  // fetchAll já retorna arrays tipados — sem necessidade de cast extra
  const inscricoes       = inscricoesRes      as InscricaoRow[];
  const checkins         = checkinsRes        as CheckinRow[];
  const consumosRefeicoes= consumoRefeicoesRes as RefeicaoConsumoRow[];
  const hospedagens      = hospRes            as HospRow[];
  const inscricaoById    = new Map(inscricoes.map(i => [i.id, i]));
  const advertencias     = (advertRes.data    ?? []) as unknown as AdvertRow[];
  const supervisoes      = (supRes.data       ?? []) as unknown as SupervisaoRow[];
  const campos           = (camposRes.data    ?? []) as unknown as CampoRow[];
  const alojamentos      = (alojRes.data      ?? []) as unknown as AlojRow[];

  // ── Config do evento ──────────────────────────────────────────────────
  const cfg = (evento.configuracoes_ago ?? {}) as Record<string, unknown>;
  const configPlenarias = Array.isArray(cfg.plenarias_datas)
    ? (cfg.plenarias_datas as string[]) : [];

  let plenariasDatas = configPlenarias;
  if (plenariasDatas.length === 0) {
    const datasUnicas = new Set<string>();
    for (const c of checkins) {
      if (c.tipo_checkin === 'plenaria' && c.data_plenaria) {
        datasUnicas.add(c.data_plenaria);
      }
    }
    plenariasDatas = Array.from(datasUnicas).sort();
  }
  const totalPlenarias = plenariasDatas.length;

  // ── Mapas de lookup ───────────────────────────────────────────────────
  const supMap   = new Map(supervisoes.map(s => [s.id, s.nome as string]));
  const campoMap = new Map(campos.map(c => [c.id, { nome: c.nome as string, supervisao_id: c.supervisao_id as string }]));

  // ── Categorizar checkins ──────────────────────────────────────────────
  const plenCheckins = checkins.filter(c => c.tipo_checkin === 'plenaria');

  // Presenças por inscrição
  const presencaMap = new Map<string, Set<string>>();
  for (const c of plenCheckins) {
    if (!c.inscricao_id) continue;
    if (!presencaMap.has(c.inscricao_id)) presencaMap.set(c.inscricao_id, new Set());
    if (c.data_plenaria) presencaMap.get(c.inscricao_id)!.add(c.data_plenaria as string);
  }

  // Hospedagem por inscrição
  const hospMap = new Map(hospedagens.map(h => [h.inscricao_id as string, h]));

  // Advertências por inscrição
  const advertMap = new Map<string, string[]>();
  for (const a of advertencias) {
    if (!a.inscricao_id) continue;
    if (!advertMap.has(a.inscricao_id)) advertMap.set(a.inscricao_id, []);
    advertMap.get(a.inscricao_id)!.push(a.status as string);
  }

  // ── CARDS EXECUTIVOS ─────────────────────────────────────────────────
  const hoje = new Date().toISOString().slice(0, 10);

  const pagos        = inscricoes.filter(i => i.status_pagamento === 'pago' || i.status_pagamento === 'isento').length;
  const credenciados = inscricoes.filter(i => i.checkin_realizado).length;
  const hospedados   = hospedagens.filter(h =>
    ['confirmada', 'alocada', 'checkin_realizado'].includes(h.status as string),
  ).length;

  const presentesHoje = new Set(
    plenCheckins
      .filter(c => c.data_plenaria === hoje)
      .map(c => c.inscricao_id),
  ).size;

  let refeicoesConsumidas = 0, refeicoesTotal = 0;
  let somaFreq = 0;
  for (const i of inscricoes) {
    const totalInsc = i.quantidade_refeicoes_total ?? i.refeicoes_total ?? 0;
    const usadasInsc = i.quantidade_refeicoes_usadas ?? i.refeicoes_utilizadas ?? 0;
    refeicoesConsumidas += usadasInsc;
    refeicoesTotal += totalInsc;
    const presencas = presencaMap.get(i.id)?.size ?? 0;
    somaFreq += totalPlenarias > 0 ? (presencas / totalPlenarias) * 100 : 0;
  }
  const frequenciaMedia = (inscricoes.length > 0 && totalPlenarias > 0)
    ? Math.round((somaFreq / inscricoes.length) * 100) / 100 : null;

  const advertPendentes = advertencias.filter(a => a.status !== 'cancelada').length;

  const cards = {
    inscritos:              inscricoes.length,
    pagos,
    credenciados,
    hospedados,
    presentes_hoje:         presentesHoje,
    frequencia_media:       frequenciaMedia,
    refeicoes_consumidas:   refeicoesConsumidas,
    refeicoes_total:        refeicoesTotal,
    advertencias_pendentes: advertPendentes,
  };

  // ── INTEGRIDADE RESUMO ───────────────────────────────────────────────
  const semCpf      = semCpfRes.count  ?? 0;
  const semCategoria= semCatRes.count  ?? 0;
  const totalProbs  = semCpf + semCategoria;
  const universo    = inscricoes.length;
  const percInteg   = universo > 0
    ? Math.round(((universo - totalProbs) / universo) * 10000) / 100 : 100;

  const integridade = {
    percentual:     percInteg,
    status:         percInteg >= 99 ? 'ok' : percInteg >= 95 ? 'atencao' : 'critico',
    sem_cpf:        semCpf,
    sem_categoria:  semCategoria,
    total_problemas: totalProbs,
    atingiu_meta:   percInteg >= 99,
  };

  // ── MATRIZ OPERACIONAL ───────────────────────────────────────────────
  const matriz = inscricoes.map(i => {
    const hosp     = hospMap.get(i.id);
    const presencas= presencaMap.get(i.id)?.size ?? 0;
    const perc     = totalPlenarias > 0 ? Math.round((presencas / totalPlenarias) * 10000) / 100 : null;
    return {
      id:               i.id,
      nome:             i.nome_inscrito,
      cpf:              i.cpf,
      categoria:        i.tipo_inscricao,
      supervisao_id:    i.supervisao_id,
      campo_id:         i.campo_id,
      supervisao_nome:  supMap.get((i.supervisao_id as string) ?? '')  ?? null,
      campo_nome:       campoMap.get((i.campo_id as string) ?? '')?.nome ?? null,
      pago:             i.status_pagamento === 'pago' || i.status_pagamento === 'isento',
      status_pagamento: i.status_pagamento,
      credenciado:      !!(i.checkin_realizado),
      hospedagem_status: hosp?.status ?? (i.hospedagem ? 'solicitada' : 'nao'),
      refeicoes_utilizadas: i.quantidade_refeicoes_usadas ?? i.refeicoes_utilizadas ?? 0,
      refeicoes_total: i.quantidade_refeicoes_total ?? i.refeicoes_total ?? 0,
      presencas_plenaria:   presencas,
      total_plenarias:      totalPlenarias,
      percentual_frequencia: perc,
    };
  });

  // ── POR CATEGORIA ────────────────────────────────────────────────────
  const catMap = new Map<string, { inscritos: number; credenciados: number; presentes: number; somaFreq: number }>();
  for (const i of inscricoes) {
    const cat = (i.tipo_inscricao as string) ?? '(sem categoria)';
    if (!catMap.has(cat)) catMap.set(cat, { inscritos: 0, credenciados: 0, presentes: 0, somaFreq: 0 });
    const c = catMap.get(cat)!;
    c.inscritos++;
    if (i.checkin_realizado) c.credenciados++;
    const presencas = presencaMap.get(i.id)?.size ?? 0;
    if (presencas > 0) c.presentes++;
    c.somaFreq += totalPlenarias > 0 ? (presencas / totalPlenarias) * 100 : 0;
  }
  const por_categoria = [...catMap.entries()]
    .map(([cat, v]) => ({
      categoria:       cat,
      inscritos:       v.inscritos,
      credenciados:    v.credenciados,
      presentes:       v.presentes,
      frequencia_media: v.inscritos > 0 && totalPlenarias > 0
        ? Math.round((v.somaFreq / v.inscritos) * 100) / 100 : null,
    }))
    .sort((a, b) => b.inscritos - a.inscritos);

  // ── POR SUPERVISÃO ───────────────────────────────────────────────────
  const supStatMap = new Map<string, { nome: string; inscritos: number; credenciados: number; presentes: number; somaFreq: number }>();
  for (const i of inscricoes) {
    const sid  = (i.supervisao_id as string) ?? '__sem';
    const nome = supMap.get(i.supervisao_id as string ?? '') ?? '(sem supervisão)';
    if (!supStatMap.has(sid)) supStatMap.set(sid, { nome, inscritos: 0, credenciados: 0, presentes: 0, somaFreq: 0 });
    const c = supStatMap.get(sid)!;
    c.inscritos++;
    if (i.checkin_realizado) c.credenciados++;
    const presencas = presencaMap.get(i.id)?.size ?? 0;
    if (presencas > 0) c.presentes++;
    c.somaFreq += totalPlenarias > 0 ? (presencas / totalPlenarias) * 100 : 0;
  }
  const por_supervisao = [...supStatMap.entries()]
    .map(([id, v]) => ({
      id, nome: v.nome,
      inscritos:       v.inscritos,
      credenciados:    v.credenciados,
      presentes:       v.presentes,
      frequencia_media: v.inscritos > 0 && totalPlenarias > 0
        ? Math.round((v.somaFreq / v.inscritos) * 100) / 100 : null,
    }))
    .sort((a, b) => b.inscritos - a.inscritos);

  // ── POR CAMPO ────────────────────────────────────────────────────────
  const campoStatMap = new Map<string, {
    nome: string; supervisao_nome: string;
    inscritos: number; hospedados: number; somaFreq: number;
    pastor_presidente: string | null;
  }>();
  for (const i of inscricoes) {
    const cid      = (i.campo_id as string) ?? '__sem';
    const ci       = campoMap.get(i.campo_id as string ?? '');
    const nome     = ci?.nome ?? '(sem campo)';
    const supNome  = supMap.get(ci?.supervisao_id ?? '') ?? '';
    if (!campoStatMap.has(cid)) {
      campoStatMap.set(cid, { nome, supervisao_nome: supNome, inscritos: 0, hospedados: 0, somaFreq: 0, pastor_presidente: null });
    }
    const c = campoStatMap.get(cid)!;
    c.inscritos++;
    const hosp = hospMap.get(i.id);
    if (hosp && ['confirmada', 'alocada', 'checkin_realizado'].includes(hosp.status as string)) c.hospedados++;
    const presencas = presencaMap.get(i.id)?.size ?? 0;
    c.somaFreq += totalPlenarias > 0 ? (presencas / totalPlenarias) * 100 : 0;
    if (i.tipo_inscricao === 'Pastor Presidente' && !c.pastor_presidente) {
      c.pastor_presidente = i.nome_inscrito as string;
    }
  }
  const por_campo = [...campoStatMap.entries()]
    .map(([id, v]) => ({
      id, nome: v.nome, supervisao_nome: v.supervisao_nome,
      inscritos:       v.inscritos,
      hospedados:      v.hospedados,
      pastor_presidente: v.pastor_presidente,
      frequencia_media: v.inscritos > 0 && totalPlenarias > 0
        ? Math.round((v.somaFreq / v.inscritos) * 100) / 100 : null,
    }))
    .sort((a, b) => b.inscritos - a.inscritos);

  // ── HOSPEDAGEM SUMMARY ───────────────────────────────────────────────
  const hospedagem_stats = {
    capacidade_total:   alojamentos.reduce((s, a) => s + (a.total_vagas as number), 0),
    solicitados:        inscricoes.filter(i => i.hospedagem).length,
    confirmados:        hospedagens.filter(h => h.status === 'confirmada' || h.status === 'alocada').length,
    checkin_realizado:  hospedagens.filter(h => h.status === 'checkin_realizado').length,
    checkout_realizado: hospedagens.filter(h => h.status === 'checkout_realizado').length,
    ausentes:           hospedagens.filter(h =>
      (h.status === 'confirmada' || h.status === 'alocada') && !h.checkin_at,
    ).length,
    lista_espera:       hospedagens.filter(h => h.status === 'lista_espera').length,
  };

  // ── REFEITÓRIO POR DIA ───────────────────────────────────────────────
  const refiDiaMap = new Map<string, number>();
  for (const c of consumosRefeicoes) {
    const dia = (c.data_hora as string).slice(0, 10);
    refiDiaMap.set(dia, (refiDiaMap.get(dia) ?? 0) + 1);
  }
  const refeitorio_por_dia = [...refiDiaMap.entries()]
    .map(([data, total]) => ({ data, total }))
    .sort((a, b) => a.data.localeCompare(b.data));

  // ── RELATÓRIO DE ALIMENTAÇÃO ─────────────────────────────────────────
  const ultimoConsumoMap = new Map<string, string>();
  for (const consumo of consumosRefeicoes) {
    if (!consumo.inscricao_id) continue;
    const atual = ultimoConsumoMap.get(consumo.inscricao_id);
    if (!atual || consumo.data_hora > atual) {
      ultimoConsumoMap.set(consumo.inscricao_id, consumo.data_hora);
    }
  }

  const consumoCategoriaMap = new Map<string, number>();
  for (const consumo of consumosRefeicoes) {
    if (!consumo.inscricao_id) continue;
    const ins = inscricaoById.get(consumo.inscricao_id);
    if (!ins) continue;
    const categoria = ins.tipo_inscricao || '(sem categoria)';
    consumoCategoriaMap.set(categoria, (consumoCategoriaMap.get(categoria) ?? 0) + 1);
  }

  let totalComAlimentacao = 0;
  let refeicoesPrevistas = 0;
  let refeicoesUsadas = 0;
  let refeicoesSaldo = 0;
  const tabelaAlimentacao = inscricoes.map(i => {
    const total = i.quantidade_refeicoes_total ?? i.refeicoes_total ?? 0;
    const usadas = i.quantidade_refeicoes_usadas ?? i.refeicoes_utilizadas ?? 0;
    const saldo = i.quantidade_refeicoes_saldo ?? Math.max(0, total - usadas);
    const inclui = !!i.alimentacao;
    if (inclui) totalComAlimentacao += 1;
    refeicoesPrevistas += total;
    refeicoesUsadas += usadas;
    refeicoesSaldo += saldo;
    return {
      inscricao_id: i.id,
      nome: i.nome_inscrito,
      categoria: i.tipo_inscricao || '(sem categoria)',
      inclui_alimentacao: inclui,
      total_refeicoes: total,
      consumidas: usadas,
      saldo,
      ultimo_consumo: ultimoConsumoMap.get(i.id) ?? null,
    };
  });

  const consumoPorCategoria = [...consumoCategoriaMap.entries()]
    .map(([categoria, consumidas]) => ({ categoria, consumidas }))
    .sort((a, b) => b.consumidas - a.consumidas);

  const relatorio_alimentacao = {
    indicadores: {
      total_inscritos_com_alimentacao: totalComAlimentacao,
      refeicoes_previstas: refeicoesPrevistas,
      refeicoes_consumidas: refeicoesUsadas,
      saldo_restante: refeicoesSaldo,
    },
    consumo_por_dia: refeitorio_por_dia,
    consumo_por_categoria: consumoPorCategoria,
    tabela: tabelaAlimentacao,
  };

  // ── FREQUÊNCIA POR PLENÁRIA ──────────────────────────────────────────
  const plenDiaMap = new Map<string, Set<string>>();
  for (const c of plenCheckins) {
    if (!c.data_plenaria || !c.inscricao_id) continue;
    if (!plenDiaMap.has(c.data_plenaria as string)) plenDiaMap.set(c.data_plenaria as string, new Set());
    plenDiaMap.get(c.data_plenaria as string)!.add(c.inscricao_id as string);
  }
  const frequencia_por_plenaria: { data: string; label: string; presentes: number; total: number }[] = [];
  const datasComPlenaria = new Set([...plenariasDatas, ...plenDiaMap.keys()]);
  let diaIdx = 1;
  for (const data of [...datasComPlenaria].sort()) {
    const configIdx = plenariasDatas.indexOf(data);
    frequencia_por_plenaria.push({
      data,
      label:    configIdx >= 0 ? `Dia ${configIdx + 1}` : `Extra (${data})`,
      presentes: plenDiaMap.get(data)?.size ?? 0,
      total:    inscricoes.length,
    });
    diaIdx++;
  }

  // ── ADVERTÊNCIAS ────────────────────────────────────────────────────
  const advertencias_stats = {
    total:     advertencias.length,
    rascunho:  advertencias.filter(a => a.status === 'rascunho').length,
    enviadas:  advertencias.filter(a => a.status === 'enviada').length,
    canceladas:advertencias.filter(a => a.status === 'cancelada').length,
  };

  const LIMIAR_ADVERT = 75;
  const advertencias_elegiveis = inscricoes
    .filter(i => {
      const presencas = presencaMap.get(i.id)?.size ?? 0;
      const perc = totalPlenarias > 0 ? (presencas / totalPlenarias) * 100 : 100;
      return perc < LIMIAR_ADVERT && !advertMap.has(i.id);
    })
    .map(i => {
      const presencas = presencaMap.get(i.id)?.size ?? 0;
      return {
        id:              i.id,
        nome:            i.nome_inscrito,
        categoria:       i.tipo_inscricao,
        supervisao_nome: supMap.get((i.supervisao_id as string) ?? '') ?? null,
        campo_nome:      campoMap.get((i.campo_id as string) ?? '')?.nome ?? null,
        presencas,
        total_plenarias: totalPlenarias,
        percentual:      totalPlenarias > 0
          ? Math.round((presencas / totalPlenarias) * 10000) / 100 : 0,
      };
    })
    .sort((a, b) => a.percentual - b.percentual);

  // ── CAMPO MISSIONÁRIO ────────────────────────────────────────────────
  let totalCampoMiss = 0, totalEconomia = 0;
  for (const i of inscricoes) {
    const snap = i.ministro_snapshot as Record<string, unknown> | null;
    if (snap?.is_campo_missionario === true) {
      totalCampoMiss++;
      const normal    = (snap.valor_normal     as number | null) ?? 0;
      const subsidio  = (snap.valor_subsidiado as number | null) ?? 0;
      totalEconomia  += Math.max(0, normal - subsidio);
    }
  }
  const campo_missionario = {
    total:          totalCampoMiss,
    subsidiados:    totalCampoMiss,
    economia_total: Math.round(totalEconomia * 100) / 100,
  };

  // ── RESPOSTA ─────────────────────────────────────────────────────────
  return NextResponse.json({
    evento_id: eventoId,
    gerado_em: new Date().toISOString(),
    evento: {
      id:           evento.id,
      nome:         evento.nome,
      status:       evento.status,
      data_inicio:  evento.data_inicio,
      data_fim:     evento.data_fim,
      plenarias_datas: plenariasDatas,
    },
    cards,
    integridade,
    matriz,
    por_categoria,
    por_supervisao,
    por_campo,
    hospedagem: hospedagem_stats,
    refeitorio_por_dia,
    frequencia_por_plenaria,
    advertencias: advertencias_stats,
    advertencias_elegiveis,
    campo_missionario,
    relatorio_alimentacao,
  });
}
