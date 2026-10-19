import { NextRequest, NextResponse } from 'next/server';
import { requireEventoPermission } from '@/lib/evento-guard';

type EventoRow = {
  id: string;
  nome: string;
  data_inicio: string;
  data_fim: string;
};

type ConsumoRow = {
  id: string;
  data_hora: string;
};

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

  // 3. Consulta registros oficiais de refeição em evento_refeicoes_consumo
  let consumos: ConsumoRow[] = [];
  try {
    consumos = await fetchAll<ConsumoRow>((f, t) =>
      supabase
        .from('evento_refeicoes_consumo')
        .select('id, data_hora')
        .eq('evento_id', eventoId)
        .range(f, t) as unknown as PromiseLike<{ data: ConsumoRow[] | null; error: unknown }>
    );
  } catch (err) {
    console.error('Erro ao consultar refeicoes_consumo:', err);
    return NextResponse.json({ error: 'Erro ao consultar consumo de refeições.' }, { status: 500 });
  }

  // 4. Determina datas de referência no fuso de Belém (UTC-3)
  const now = new Date();
  const hojeBelem = formatterBelem.format(now);
  const ontemDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const ontemBelem = formatterBelem.format(ontemDate);

  // 5. Agrega consumos por dia local
  const refiDiaMap = new Map<string, number>();
  let totalHoje = 0;
  let totalOntem = 0;

  for (const c of consumos) {
    const diaLocal = toBelemDate(c.data_hora);
    if (!diaLocal) continue;

    refiDiaMap.set(diaLocal, (refiDiaMap.get(diaLocal) ?? 0) + 1);

    if (diaLocal === hojeBelem) {
      totalHoje++;
    } else if (diaLocal === ontemBelem) {
      totalOntem++;
    }
  }

  // 6. Constrói o calendário do evento
  const datasOficiais = getDatesInRange(evento.data_inicio, evento.data_fim);
  const todasAsDatasSet = new Set([...datasOficiais, ...refiDiaMap.keys()]);
  const todasAsDatas = [...todasAsDatasSet].sort((a, b) => a.localeCompare(b));

  let maxDia = 0;
  const dias = todasAsDatas.map(dataStr => {
    const total = refiDiaMap.get(dataStr) ?? 0;
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

  // Calcula percentual relativo ao dia de maior consumo para a barra de progresso
  const baseMax = Math.max(maxDia, 1);
  for (const d of dias) {
    d.percentual = d.total > 0 ? Math.round((d.total / baseMax) * 100) : 0;
  }

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
    total_hoje: totalHoje,
    total_ontem: totalOntem,
    total_acumulado: consumos.length,
    max_dia: maxDia,
    dias,
    tem_subcategorias: false,
    gerado_em: new Date().toISOString(),
  });
}
