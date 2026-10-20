import { NextRequest, NextResponse } from 'next/server';
import { requireEventoPermission } from '@/lib/evento-guard';

type EventoRow = {
  id: string;
  nome: string;
  data_inicio: string;
  data_fim: string;
};

type LocalRow = {
  id: string;
  evento_id: string;
  tipo: string;
  nome: string;
  descricao?: string | null;
  ativo: boolean;
  ordem?: number | null;
};

type ConsumoRow = {
  id: string;
  data_hora: string;
  local_id: string | null;
  tipo_consumo?: string | null;
};

export interface DiaRefeicao {
  data: string;
  dia_mes: string;
  dia_semana: string;
  total: number;
  status: 'hoje' | 'passado' | 'futuro';
  percentual: number;
}

export interface RestauranteControle {
  id: string;
  nome: string;
  ativo: boolean;
  total_hoje: number;
  total_ontem: number;
  total_acumulado: number;
  percentual: number;
  max_dia: number;
  dias: DiaRefeicao[];
}

const formatterBelem = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Belem',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function toBelemDate(isoStr: string | null | undefined): string {
  if (!isoStr) return '';
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return isoStr.slice(0, 10);
    return formatterBelem.format(d);
  } catch {
    return String(isoStr).slice(0, 10);
  }
}

function getDatesInRange(startStr: string, endStr: string): string[] {
  const dates: string[] = [];
  try {
    const [sY, sM, sD] = startStr.split('-').map(Number);
    const [eY, eM, eD] = endStr.split('-').map(Number);
    const current = new Date(Date.UTC(sY, sM - 1, sD, 12, 0, 0));
    const end = new Date(Date.UTC(eY, eM - 1, eD, 12, 0, 0));

    let count = 0;
    while (current <= end && count < 60) {
      dates.push(current.toISOString().slice(0, 10));
      current.setUTCDate(current.getUTCDate() + 1);
      count++;
    }
  } catch {
    if (startStr) dates.push(startStr);
  }
  return dates.length > 0 ? dates : [startStr];
}

const DIAS_SEMANA_ABREV = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function buildDiasCalendar(
  rows: ConsumoRow[],
  todasAsDatas: string[],
  hojeBelem: string,
): { dias: DiaRefeicao[]; maxDia: number } {
  const mapDia = new Map<string, number>();
  for (const c of rows) {
    const dia = toBelemDate(c.data_hora);
    if (!dia) continue;
    mapDia.set(dia, (mapDia.get(dia) ?? 0) + 1);
  }

  let maxDia = 0;
  const dias: DiaRefeicao[] = todasAsDatas.map(dataStr => {
    const total = mapDia.get(dataStr) ?? 0;
    if (total > maxDia) maxDia = total;

    let diaMes = dataStr.slice(5).replace('-', '/');
    let diaSemana = '';

    try {
      const [y, m, d] = dataStr.split('-').map(Number);
      const dt = new Date(y, m - 1, d);
      diaMes = `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
      diaSemana = DIAS_SEMANA_ABREV[dt.getDay()] || '';
    } catch {
      // Fallback
    }

    let status: 'hoje' | 'passado' | 'futuro' = 'passado';
    if (dataStr === hojeBelem) {
      status = 'hoje';
    } else if (dataStr > hojeBelem) {
      status = 'futuro';
    }

    return {
      data: dataStr,
      dia_mes: diaMes,
      dia_semana: diaSemana,
      total,
      status,
      percentual: 0,
    };
  });

  const baseMax = Math.max(maxDia, 1);
  for (const d of dias) {
    d.percentual = d.total > 0 ? Math.round((d.total / baseMax) * 100) : 0;
  }

  return { dias, maxDia };
}

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

  // 1. Validação de permissões e isolamento por evento no backend
  const guard = await requireEventoPermission(req, eventoId, 'refeitorio');
  if (!guard.ok) return guard.response;
  const supabase = guard.ctx.supabaseAdmin;

  const { searchParams } = new URL(req.url);
  const localIdParam = (searchParams.get('local_id') || '').trim();

  // 2. Consulta dados do evento
  const { data: eventoData, error: evErr } = await supabase
    .from('eventos')
    .select('id, nome, data_inicio, data_fim')
    .eq('id', eventoId)
    .single();

  if (evErr || !eventoData) {
    return NextResponse.json({ error: 'Evento não encontrado.' }, { status: 404 });
  }

  const evento = eventoData as EventoRow;

  // 3. Consulta TODOS os restaurantes cadastrados no evento (inclusive inativos para histórico)
  const { data: locaisData, error: locErr } = await supabase
    .from('evento_locais_checkin')
    .select('id, evento_id, tipo, nome, descricao, ativo, ordem')
    .eq('evento_id', eventoId)
    .eq('tipo', 'refeitorio')
    .order('ordem', { ascending: true })
    .order('nome', { ascending: true });

  if (locErr) {
    console.error('Erro ao consultar locais de refeitorio:', locErr);
  }

  const locaisRestaurante = (locaisData as LocalRow[]) || [];
  const mapaLocais = new Map<string, LocalRow>();
  for (const loc of locaisRestaurante) {
    mapaLocais.set(loc.id, loc);
  }

  // 4. Consulta registros oficiais de refeição em evento_refeicoes_consumo
  let consumosRaw: ConsumoRow[] = [];
  try {
    consumosRaw = await fetchAll<ConsumoRow>((f, t) =>
      supabase
        .from('evento_refeicoes_consumo')
        .select('id, data_hora, local_id, tipo_consumo')
        .eq('evento_id', eventoId)
        .range(f, t) as unknown as PromiseLike<{ data: ConsumoRow[] | null; error: unknown }>
    );
  } catch (err) {
    console.error('Erro ao consultar refeicoes_consumo:', err);
    return NextResponse.json({ error: 'Erro ao consultar consumo de refeições.' }, { status: 500 });
  }

  // Filtra exclusivamente registros oficiais de refeição (tipo_consumo === 'refeicao' ou legado sem tipo)
  const consumos = consumosRaw.filter(c => !c.tipo_consumo || c.tipo_consumo === 'refeicao');

  // 5. Determina datas de referência no fuso de Belém (UTC-3)
  const now = new Date();
  const hojeBelem = formatterBelem.format(now);
  const ontemDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const ontemBelem = formatterBelem.format(ontemDate);

  // 6. Constrói calendário com todas as datas do evento e datas registradas
  const datasOficiais = getDatesInRange(evento.data_inicio, evento.data_fim);
  const todasAsDatasSet = new Set<string>([...datasOficiais]);
  for (const c of consumos) {
    const d = toBelemDate(c.data_hora);
    if (d) todasAsDatasSet.add(d);
  }
  const todasAsDatas = [...todasAsDatasSet].sort((a, b) => a.localeCompare(b));

  // 7. Agrupa consumos por restaurante e separa registros legados sem local_id
  const consumosPorLocal = new Map<string, ConsumoRow[]>();
  for (const loc of locaisRestaurante) {
    consumosPorLocal.set(loc.id, []);
  }
  const consumosSemLocal: ConsumoRow[] = [];

  for (const c of consumos) {
    if (c.local_id && mapaLocais.has(c.local_id)) {
      consumosPorLocal.get(c.local_id)!.push(c);
    } else {
      // Registros com local_id NULL ou local não encontrado no cadastro
      consumosSemLocal.push(c);
    }
  }

  const totalGeralEvento = consumos.length;

  // 8. Constrói resumo individual de cada restaurante
  const restaurantes: RestauranteControle[] = locaisRestaurante.map(local => {
    const rows = consumosPorLocal.get(local.id) || [];
    const { dias: diasLoc, maxDia: maxDiaLoc } = buildDiasCalendar(rows, todasAsDatas, hojeBelem);

    let totalHojeLoc = 0;
    let totalOntemLoc = 0;
    for (const r of rows) {
      const dia = toBelemDate(r.data_hora);
      if (dia === hojeBelem) totalHojeLoc++;
      else if (dia === ontemBelem) totalOntemLoc++;
    }

    return {
      id: local.id,
      nome: local.nome,
      ativo: Boolean(local.ativo),
      total_hoje: totalHojeLoc,
      total_ontem: totalOntemLoc,
      total_acumulado: rows.length,
      percentual: totalGeralEvento > 0 ? Math.round((rows.length / totalGeralEvento) * 100) : 0,
      max_dia: maxDiaLoc,
      dias: diasLoc,
    };
  });

  // Trata registros legados com local_id NULL como 'Local não especificado'
  if (consumosSemLocal.length > 0) {
    const { dias: diasSemLoc, maxDia: maxDiaSemLoc } = buildDiasCalendar(
      consumosSemLocal,
      todasAsDatas,
      hojeBelem,
    );
    let totalHojeSemLoc = 0;
    let totalOntemSemLoc = 0;
    for (const r of consumosSemLocal) {
      const dia = toBelemDate(r.data_hora);
      if (dia === hojeBelem) totalHojeSemLoc++;
      else if (dia === ontemBelem) totalOntemSemLoc++;
    }

    restaurantes.push({
      id: '__sem_local__',
      nome: 'Local não especificado',
      ativo: false,
      total_hoje: totalHojeSemLoc,
      total_ontem: totalOntemSemLoc,
      total_acumulado: consumosSemLocal.length,
      percentual: totalGeralEvento > 0 ? Math.round((consumosSemLocal.length / totalGeralEvento) * 100) : 0,
      max_dia: maxDiaSemLoc,
      dias: diasSemLoc,
    });
  }

  // 9. Aplica filtro de restaurante para os indicadores da raiz
  let consumosEscopo = consumos;
  if (localIdParam && localIdParam !== 'todos') {
    if (localIdParam === '__sem_local__') {
      consumosEscopo = consumosSemLocal;
    } else if (mapaLocais.has(localIdParam)) {
      consumosEscopo = consumosPorLocal.get(localIdParam) || [];
    }
  }

  const { dias: diasEscopo, maxDia: maxDiaEscopo } = buildDiasCalendar(
    consumosEscopo,
    todasAsDatas,
    hojeBelem,
  );

  let totalHojeEscopo = 0;
  let totalOntemEscopo = 0;
  for (const r of consumosEscopo) {
    const dia = toBelemDate(r.data_hora);
    if (dia === hojeBelem) totalHojeEscopo++;
    else if (dia === ontemBelem) totalOntemEscopo++;
  }

  // 10. Retorno completo garantindo compatibilidade de contrato existente
  return NextResponse.json({
    ok: true,
    evento: {
      id: evento.id,
      nome: evento.nome,
      data_inicio: evento.data_inicio,
      data_fim: evento.data_fim,
    },
    hoje: hojeBelem,
    ontem: ontemBelem,
    filtro_local_id: localIdParam || 'todos',
    total_hoje: totalHojeEscopo,
    total_ontem: totalOntemEscopo,
    total_acumulado: consumosEscopo.length,
    total_geral_evento: totalGeralEvento,
    max_dia: maxDiaEscopo,
    dias: diasEscopo,
    restaurantes,
    tem_registros_sem_local: consumosSemLocal.length > 0,
    tem_subcategorias: false,
    gerado_em: new Date().toISOString(),
  });
}
