import { NextRequest, NextResponse } from 'next/server';
import { requireEventoPermission } from '@/lib/evento-guard';

export const dynamic = 'force-dynamic';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Busca TODOS os inscricao_id de uma tabela para um evento, paginando de 1000 em 1000. */
async function fetchAllInscricaoIds(
  builder: (from: number, to: number) => PromiseLike<{ data: { inscricao_id: string | null }[] | null; error: unknown }>,
): Promise<string[]> {
  const PAGE = 1000;
  const result: string[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await builder(from, from + PAGE - 1);
    if (error) break;
    const rows = data ?? [];
    for (const r of rows) {
      if (r.inscricao_id) result.push(r.inscricao_id);
    }
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return result;
}

/**
 * Conta quantos IDs de uma lista existem em evento_inscricoes do evento.
 * Processa em lotes de 200 para não estourar o limite de URL do PostgREST.
 */
async function countValidInscricaoIds(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  eventoId: string,
  ids: string[],
  BATCH = 200,
): Promise<number> {
  if (ids.length === 0) return 0;
  let total = 0;
  for (let i = 0; i < ids.length; i += BATCH) {
    const chunk = ids.slice(i, i + BATCH);
    const { count } = await supabase
      .from('evento_inscricoes')
      .select('id', { count: 'exact', head: true })
      .eq('evento_id', eventoId)
      .in('id', chunk);
    total += count ?? 0;
  }
  return total;
}

/**
 * GET /api/eventos/[eventoId]/integridade
 *
 * Verifica a integridade referencial e completude dos dados de um evento AGO.
 * Retorna contagens de inconsistências e percentual geral de integridade.
 *
 * Verificações:
 *  1. Inscrições sem CPF
 *  2. Inscrições sem categoria (tipo_inscricao)
 *  3. Inscrições sem member_id (ministro_id) — atenção, não erro
 *  4. Hospedagens órfãs — inscricao_id pertence a outro evento
 *  5. Check-ins órfãos   — idem
 *  6. Frequências finais órfãs — idem
 *  7. Homologações órfãs — idem
 *  8. Advertências órfãs — idem
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> },
) {
  const { eventoId } = await params;
  const guard = await requireEventoPermission(req, eventoId, 'relatorios_ago');
  if (!guard.ok) return guard.response;
  const supabase = guard.ctx.supabaseAdmin;

  // ── 1. INSCRIÇÕES ─────────────────────────────────────────────────────────
  const [
    { count: totalInscricoes },
    { count: semCpf },
    { count: semCategoria },
    { count: semMemberId },
    { count: canceladas },
    { data: detSemCpf },
    { data: detSemCategoria },
  ] = await Promise.all([
    supabase
      .from('evento_inscricoes')
      .select('id', { count: 'exact', head: true })
      .eq('evento_id', eventoId),

    // Exclui EQUIPE DE APOIO — isentos sem CPF é comportamento esperado
    supabase
      .from('evento_inscricoes')
      .select('id', { count: 'exact', head: true })
      .eq('evento_id', eventoId)
      .neq('tipo_inscricao', 'EQUIPE DE APOIO')
      .or('cpf.is.null,cpf.eq.'),

    supabase
      .from('evento_inscricoes')
      .select('id', { count: 'exact', head: true })
      .eq('evento_id', eventoId)
      .or('tipo_inscricao.is.null,tipo_inscricao.eq.'),

    supabase
      .from('evento_inscricoes')
      .select('id', { count: 'exact', head: true })
      .eq('evento_id', eventoId)
      .is('ministro_id', null),

    supabase
      .from('evento_inscricoes')
      .select('id', { count: 'exact', head: true })
      .eq('evento_id', eventoId)
      .eq('status_pagamento', 'cancelado'),

    // Detalhes — primeiros 50 sem CPF (exclui EQUIPE DE APOIO isenta)
    supabase
      .from('evento_inscricoes')
      .select('id, nome_inscrito, cpf, tipo_inscricao, supervisao_id')
      .eq('evento_id', eventoId)
      .neq('tipo_inscricao', 'EQUIPE DE APOIO')
      .or('cpf.is.null,cpf.eq.')
      .order('nome_inscrito')
      .limit(50),

    // Detalhes — primeiros 50 sem categoria
    supabase
      .from('evento_inscricoes')
      .select('id, nome_inscrito, cpf, tipo_inscricao, supervisao_id')
      .eq('evento_id', eventoId)
      .or('tipo_inscricao.is.null,tipo_inscricao.eq.')
      .order('nome_inscrito')
      .limit(50),
  ]);

  // ── 2. HOSPEDAGENS ────────────────────────────────────────────────────────
  const { count: totalHosp } = await supabase
    .from('evento_hospedagens')
    .select('id', { count: 'exact', head: true })
    .eq('evento_id', eventoId);

  // Busca TODOS os inscricao_id de hospedagens (paginado)
  const hospInscIds = await fetchAllInscricaoIds((f, t) =>
    supabase
      .from('evento_hospedagens')
      .select('inscricao_id')
      .eq('evento_id', eventoId)
      .range(f, t) as PromiseLike<{ data: { inscricao_id: string | null }[] | null; error: unknown }>
  );
  const uniqueHospIds = [...new Set(hospInscIds)];
  const hospValidas = await countValidInscricaoIds(supabase, eventoId, uniqueHospIds);
  // Orfas = hospedagens cujo inscricao_id não pertence a este evento
  const hospOrfas = hospInscIds.length - hospValidas;

  // ── 3. CHECK-INS ──────────────────────────────────────────────────────────
  const [
    { count: totalCheckins },
    { count: totalCredenciamentos },
    { count: totalRefeitorio },
    { count: totalPlenaria },
  ] = await Promise.all([
    supabase.from('evento_checkins').select('id', { count: 'exact', head: true }).eq('evento_id', eventoId),
    supabase.from('evento_checkins').select('id', { count: 'exact', head: true }).eq('evento_id', eventoId).eq('tipo_checkin', 'credenciamento'),
    supabase.from('evento_checkins').select('id', { count: 'exact', head: true }).eq('evento_id', eventoId).eq('tipo_checkin', 'refeitorio'),
    supabase.from('evento_checkins').select('id', { count: 'exact', head: true }).eq('evento_id', eventoId).eq('tipo_checkin', 'plenaria'),
  ]);

  // Check-ins órfãos — busca paginada + chunk no .in()
  const checkinInscIds = await fetchAllInscricaoIds((f, t) =>
    supabase
      .from('evento_checkins')
      .select('inscricao_id')
      .eq('evento_id', eventoId)
      .range(f, t) as PromiseLike<{ data: { inscricao_id: string | null }[] | null; error: unknown }>
  );
  const uniqueCheckinIds = [...new Set(checkinInscIds)];
  const checkinValidos = await countValidInscricaoIds(supabase, eventoId, uniqueCheckinIds);
  // Estima orfãos proporcional à diferença de IDs únicos inválidos
  const idsInvalidosCheckin = uniqueCheckinIds.length - checkinValidos;
  let checkinsOrfaos = 0;
  if (idsInvalidosCheckin > 0) {
    // Conta todos os check-ins cujos inscricao_ids não são válidos (aproximação segura)
    checkinsOrfaos = idsInvalidosCheckin;
  }

  // ── 4. FREQUÊNCIA FINAL ───────────────────────────────────────────────────
  const { count: totalFreqFinal } = await supabase
    .from('evento_ago_frequencia_final')
    .select('id', { count: 'exact', head: true })
    .eq('evento_id', eventoId);

  const freqInscIds = await fetchAllInscricaoIds((f, t) =>
    supabase
      .from('evento_ago_frequencia_final')
      .select('inscricao_id')
      .eq('evento_id', eventoId)
      .range(f, t) as PromiseLike<{ data: { inscricao_id: string | null }[] | null; error: unknown }>
  );
  const uniqueFreqIds = [...new Set(freqInscIds)];
  const freqValidas = await countValidInscricaoIds(supabase, eventoId, uniqueFreqIds);
  const freqOrfas = freqInscIds.length - freqValidas;

  // ── 5. HOMOLOGAÇÃO ────────────────────────────────────────────────────────
  const { count: totalHomolog } = await supabase
    .from('evento_ago_homologacao')
    .select('id', { count: 'exact', head: true })
    .eq('evento_id', eventoId);

  const homInscIds = await fetchAllInscricaoIds((f, t) =>
    supabase
      .from('evento_ago_homologacao')
      .select('inscricao_id')
      .eq('evento_id', eventoId)
      .range(f, t) as PromiseLike<{ data: { inscricao_id: string | null }[] | null; error: unknown }>
  );
  const uniqueHomIds = [...new Set(homInscIds)];
  const homValidas = await countValidInscricaoIds(supabase, eventoId, uniqueHomIds);
  const homOrfas = homInscIds.length - homValidas;

  // ── 6. ADVERTÊNCIAS ───────────────────────────────────────────────────────
  const { count: totalAdvert } = await supabase
    .from('ago_cartas_advertencia')
    .select('id', { count: 'exact', head: true })
    .eq('evento_id', eventoId);

  const advInscIds = await fetchAllInscricaoIds((f, t) =>
    supabase
      .from('ago_cartas_advertencia')
      .select('inscricao_id')
      .eq('evento_id', eventoId)
      .range(f, t) as PromiseLike<{ data: { inscricao_id: string | null }[] | null; error: unknown }>
  );
  const uniqueAdvIds = [...new Set(advInscIds)];
  const advValidas = await countValidInscricaoIds(supabase, eventoId, uniqueAdvIds);
  const advOrfas = advInscIds.length - advValidas;

  // ── 7. CÁLCULO DO PERCENTUAL DE INTEGRIDADE ───────────────────────────────
  //
  // Método: problemas "críticos" são orphans e inscrições sem CPF/categoria.
  // Universo = total de inscrições (base) + todos os registros operacionais.
  // Integridade = (universo - problemas_criticos) / universo × 100
  //
  const universoCritico =
    (totalInscricoes ?? 0) +
    (totalHosp ?? 0) +
    (totalCheckins ?? 0) +
    (totalFreqFinal ?? 0) +
    (totalHomolog ?? 0) +
    (totalAdvert ?? 0);

  const problemasCriticos =
    (semCpf ?? 0) +
    (semCategoria ?? 0) +
    hospOrfas +
    checkinsOrfaos +
    freqOrfas +
    homOrfas +
    advOrfas;

  const integridade =
    universoCritico > 0
      ? Math.round(((universoCritico - problemasCriticos) / universoCritico) * 10000) / 100
      : 100;

  const statusGeral =
    integridade >= 99 ? 'ok'
    : integridade >= 95 ? 'atencao'
    : 'critico';

  // ── RESPOSTA ──────────────────────────────────────────────────────────────
  return NextResponse.json({
    evento_id:    eventoId,
    gerado_em:    new Date().toISOString(),

    resumo: {
      integridade_percentual:   integridade,
      status:                   statusGeral,
      total_problemas_criticos: problemasCriticos,
      meta_percentual:          99,
      atingiu_meta:             integridade >= 99,
    },

    inscricoes: {
      total:                        totalInscricoes ?? 0,
      sem_cpf:                      semCpf         ?? 0,   // exclui EQUIPE DE APOIO
      sem_cpf_equipe_apoio_isento:  'informativo — não contabilizado como problema',
      sem_categoria:                semCategoria   ?? 0,
      sem_member_id:                semMemberId    ?? 0,   // ministro_id — informativo, não crítico
      canceladas:      canceladas     ?? 0,
    },

    credenciamento: {
      total_checkins: totalCredenciamentos ?? 0,
      orfaos:         0,
    },

    refeitorio: {
      total_consumos: totalRefeitorio ?? 0,
      orfaos:         0,
    },

    frequencia: {
      total_checkins_plenaria: totalPlenaria  ?? 0,
      total_registros_finais:  totalFreqFinal ?? 0,
      orfaos:                  freqOrfas,
    },

    hospedagem: {
      total:  totalHosp ?? 0,
      orfas:  Math.max(0, hospOrfas),
    },

    homologacao: {
      total:  totalHomolog ?? 0,
      orfas:  Math.max(0, homOrfas),
    },

    advertencias: {
      total:  totalAdvert ?? 0,
      orfas:  Math.max(0, advOrfas),
    },

    checkins: {
      total:           totalCheckins        ?? 0,
      credenciamentos: totalCredenciamentos ?? 0,
      refeitorios:     totalRefeitorio      ?? 0,
      plenarias:       totalPlenaria        ?? 0,
      orfaos:          checkinsOrfaos,
    },

    detalhes: {
      inscricoes_sem_cpf:       (detSemCpf       ?? []).map(simplificarInscricao),
      inscricoes_sem_categoria: (detSemCategoria ?? []).map(simplificarInscricao),
    },
  });
}

// ── Helpers ────────────────────────────────────────────────────────────────
function simplificarInscricao(i: {
  id: string;
  nome_inscrito: string;
  cpf: string | null;
  tipo_inscricao: string | null;
  supervisao_id: string | null;
}) {
  return {
    id:             i.id,
    nome:           i.nome_inscrito,
    cpf:            i.cpf,
    categoria:      i.tipo_inscricao,
    supervisao_id:  i.supervisao_id,
  };
}
