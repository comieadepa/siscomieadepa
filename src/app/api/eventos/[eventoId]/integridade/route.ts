import { NextRequest, NextResponse } from 'next/server';
import { requireEventoAccess } from '@/lib/evento-guard';

export const dynamic = 'force-dynamic';

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
  const guard = await requireEventoAccess(req, eventoId);
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

    supabase
      .from('evento_inscricoes')
      .select('id', { count: 'exact', head: true })
      .eq('evento_id', eventoId)
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

    // Detalhes — primeiros 50 sem CPF
    supabase
      .from('evento_inscricoes')
      .select('id, nome_inscrito, cpf, tipo_inscricao, supervisao_id')
      .eq('evento_id', eventoId)
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

  // Hospedagens cujo inscricao_id NÃO pertence a este evento (contaminação cruzada)
  const { data: hospOrfasRows } = await supabase
    .from('evento_hospedagens')
    .select('id, inscricao_id')
    .eq('evento_id', eventoId);

  const hospInscIds = (hospOrfasRows ?? []).map(r => r.inscricao_id as string);
  let hospOrfas = 0;
  if (hospInscIds.length > 0) {
    const { count: hospValidas } = await supabase
      .from('evento_inscricoes')
      .select('id', { count: 'exact', head: true })
      .eq('evento_id', eventoId)
      .in('id', hospInscIds);
    hospOrfas = hospInscIds.length - (hospValidas ?? 0);
  }

  // ── 3. CHECK-INS ──────────────────────────────────────────────────────────
  const { count: totalCheckins } = await supabase
    .from('evento_checkins')
    .select('id', { count: 'exact', head: true })
    .eq('evento_id', eventoId);

  const { count: totalCredenciamentos } = await supabase
    .from('evento_checkins')
    .select('id', { count: 'exact', head: true })
    .eq('evento_id', eventoId)
    .eq('tipo_checkin', 'credenciamento');

  const { count: totalRefeitorio } = await supabase
    .from('evento_checkins')
    .select('id', { count: 'exact', head: true })
    .eq('evento_id', eventoId)
    .eq('tipo_checkin', 'refeitorio');

  const { count: totalPlenaria } = await supabase
    .from('evento_checkins')
    .select('id', { count: 'exact', head: true })
    .eq('evento_id', eventoId)
    .eq('tipo_checkin', 'plenaria');

  // Check-ins órfãos (inscricao_id de outro evento)
  const { data: checkinRows } = await supabase
    .from('evento_checkins')
    .select('inscricao_id')
    .eq('evento_id', eventoId);

  const checkinIds = [...new Set((checkinRows ?? []).map(r => r.inscricao_id as string))];
  let checkinsOrfaos = 0;
  if (checkinIds.length > 0) {
    const { count: cValid } = await supabase
      .from('evento_inscricoes')
      .select('id', { count: 'exact', head: true })
      .eq('evento_id', eventoId)
      .in('id', checkinIds);
    // Checkins únicos por inscricao — todos os checkins cujo inscricao_id não é válido
    const validSet = cValid ?? 0;
    if (validSet < checkinIds.length) {
      const { count: invalid } = await supabase
        .from('evento_checkins')
        .select('id', { count: 'exact', head: true })
        .eq('evento_id', eventoId)
        .not('inscricao_id', 'in', `(${checkinIds.join(',')})`);
      checkinsOrfaos = invalid ?? 0;
    }
  }

  // ── 4. FREQUÊNCIA FINAL ───────────────────────────────────────────────────
  const { count: totalFreqFinal } = await supabase
    .from('evento_ago_frequencia_final')
    .select('id', { count: 'exact', head: true })
    .eq('evento_id', eventoId);

  const { data: freqRows } = await supabase
    .from('evento_ago_frequencia_final')
    .select('inscricao_id')
    .eq('evento_id', eventoId);

  const freqIds = (freqRows ?? []).map(r => r.inscricao_id as string);
  let freqOrfas = 0;
  if (freqIds.length > 0) {
    const { count: fValid } = await supabase
      .from('evento_inscricoes')
      .select('id', { count: 'exact', head: true })
      .eq('evento_id', eventoId)
      .in('id', freqIds);
    freqOrfas = freqIds.length - (fValid ?? 0);
  }

  // ── 5. HOMOLOGAÇÃO ────────────────────────────────────────────────────────
  const { count: totalHomolog } = await supabase
    .from('evento_ago_homologacao')
    .select('id', { count: 'exact', head: true })
    .eq('evento_id', eventoId);

  const { data: homRows } = await supabase
    .from('evento_ago_homologacao')
    .select('inscricao_id')
    .eq('evento_id', eventoId);

  const homIds = (homRows ?? []).map(r => r.inscricao_id as string);
  let homOrfas = 0;
  if (homIds.length > 0) {
    const { count: hValid } = await supabase
      .from('evento_inscricoes')
      .select('id', { count: 'exact', head: true })
      .eq('evento_id', eventoId)
      .in('id', homIds);
    homOrfas = homIds.length - (hValid ?? 0);
  }

  // ── 6. ADVERTÊNCIAS ───────────────────────────────────────────────────────
  const { count: totalAdvert } = await supabase
    .from('ago_cartas_advertencia')
    .select('id', { count: 'exact', head: true })
    .eq('evento_id', eventoId);

  const { data: advRows } = await supabase
    .from('ago_cartas_advertencia')
    .select('inscricao_id')
    .eq('evento_id', eventoId);

  const advIds = (advRows ?? []).map(r => r.inscricao_id as string);
  let advOrfas = 0;
  if (advIds.length > 0) {
    const { count: aValid } = await supabase
      .from('evento_inscricoes')
      .select('id', { count: 'exact', head: true })
      .eq('evento_id', eventoId)
      .in('id', advIds);
    advOrfas = advIds.length - (aValid ?? 0);
  }

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
      integridade_percentual: integridade,
      status:                 statusGeral,
      total_problemas_criticos: problemasCriticos,
      meta_percentual:        99,
      atingiu_meta:           integridade >= 99,
    },

    inscricoes: {
      total:           totalInscricoes ?? 0,
      sem_cpf:         semCpf         ?? 0,
      sem_categoria:   semCategoria   ?? 0,
      sem_member_id:   semMemberId    ?? 0,   // ministro_id — atenção, não crítico
      canceladas:      canceladas     ?? 0,
    },

    credenciamento: {
      total_checkins:       totalCredenciamentos ?? 0,
      orfaos:               0,   // calculado em bloco com checkins gerais abaixo
    },

    refeitorio: {
      total_consumos: totalRefeitorio ?? 0,
      orfaos:         0,
    },

    frequencia: {
      total_checkins_plenaria: totalPlenaria   ?? 0,
      total_registros_finais:  totalFreqFinal  ?? 0,
      orfaos:                  freqOrfas,
    },

    hospedagem: {
      total:  totalHosp ?? 0,
      orfas:  hospOrfas,
    },

    homologacao: {
      total:  totalHomolog ?? 0,
      orfas:  homOrfas,
    },

    advertencias: {
      total:  totalAdvert ?? 0,
      orfas:  advOrfas,
    },

    checkins: {
      total:              totalCheckins          ?? 0,
      credenciamentos:    totalCredenciamentos   ?? 0,
      refeitorios:        totalRefeitorio        ?? 0,
      plenarias:          totalPlenaria          ?? 0,
      orfaos:             checkinsOrfaos,
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
