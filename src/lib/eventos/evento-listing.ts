export type EventoStatusVisual = 'programado' | 'realizado' | 'cancelado';

type EventoComStatusData = {
  status?: string | null;
  data_fim?: string | null;
};

type EventoComDatasDept = {
  departamento?: string | null;
  data_inicio?: string | null;
  data_fim?: string | null;
  status?: string | null;
  nome?: string | null;
};

function toIsoDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeDateOnly(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const asDate = new Date(trimmed);
  if (Number.isNaN(asDate.getTime())) return null;
  return toIsoDateString(asDate);
}

function normalizeDepartamento(departamento: string | null | undefined): string {
  return String(departamento ?? '').trim().toUpperCase();
}

export function getEventoPrioridade(departamento: string | null | undefined): number {
  const dept = normalizeDepartamento(departamento);
  if (dept === 'AGO') return 1;
  if (dept === 'UMADESPA') return 2;
  if (dept === 'COADESPA') return 3;
  if (dept === 'SEIADEPA') return 4;
  if (dept === 'AVULSO' || dept === 'AVULSOS') return 5;
  return 99;
}

export function resolveEventoStatusVisual(
  evento: EventoComStatusData,
  referenceDate: Date = new Date(),
): EventoStatusVisual {
  const status = String(evento.status ?? '').trim().toLowerCase();
  if (status === 'cancelado') return 'cancelado';

  const dataFim = normalizeDateOnly(evento.data_fim ?? null);
  const hoje = toIsoDateString(referenceDate);

  if (dataFim && dataFim < hoje) {
    return 'realizado';
  }

  if (!dataFim && status === 'realizado') {
    return 'realizado';
  }

  return 'programado';
}

function compareDateAsc(a: string | null | undefined, b: string | null | undefined): number {
  const aDate = normalizeDateOnly(a) ?? '9999-12-31';
  const bDate = normalizeDateOnly(b) ?? '9999-12-31';
  return aDate.localeCompare(bDate);
}

function compareDateDesc(a: string | null | undefined, b: string | null | undefined): number {
  const aDate = normalizeDateOnly(a) ?? '0000-01-01';
  const bDate = normalizeDateOnly(b) ?? '0000-01-01';
  return bDate.localeCompare(aDate);
}

export function compareEventosPorPrioridade(
  a: EventoComDatasDept,
  b: EventoComDatasDept,
  referenceDate: Date = new Date(),
): number {
  const prioridade = getEventoPrioridade(a.departamento) - getEventoPrioridade(b.departamento);
  if (prioridade !== 0) return prioridade;

  const statusA = resolveEventoStatusVisual(a, referenceDate);
  const statusB = resolveEventoStatusVisual(b, referenceDate);

  if (statusA === 'realizado' && statusB === 'realizado') {
    const byFimDesc = compareDateDesc(a.data_fim, b.data_fim);
    if (byFimDesc !== 0) return byFimDesc;
  } else {
    const byInicioAsc = compareDateAsc(a.data_inicio, b.data_inicio);
    if (byInicioAsc !== 0) return byInicioAsc;
  }

  return String(a.nome ?? '').localeCompare(String(b.nome ?? ''), 'pt-BR');
}

export function isEventoInscricaoPublicaDisponivel(
  evento: EventoComStatusData & { inscricoes_abertas?: boolean | null },
  referenceDate: Date = new Date(),
): boolean {
  return !!evento.inscricoes_abertas && resolveEventoStatusVisual(evento, referenceDate) === 'programado';
}
