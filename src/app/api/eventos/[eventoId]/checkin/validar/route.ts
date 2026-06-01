import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';

type EventoRow = {
  id: string;
  nome: string;
  slug: string | null;
  departamento: string | null;
  data_inicio: string | null;
  status: 'programado' | 'realizado' | 'cancelado';
  data_fim: string | null;
  checkin_ativo: boolean | null;
};

type EquipeRow = {
  id: string;
  evento_id: string;
  tipo: 'operador' | 'checkin' | 'hospedagem' | 'checkin_hospedagem';
  ativo: boolean;
};

function endOfDayUtc(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1, 23, 59, 59, 999));
}

function calcExpiraEm(dataFim: string | null): string | null {
  if (!dataFim) return null;
  const base = endOfDayUtc(dataFim);
  const exp = new Date(base.getTime() + 48 * 60 * 60 * 1000);
  return exp.toISOString();
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;
  let body: { equipe_id?: string; area?: 'checkin' | 'hospedagem_checkin' };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body invalido.' }, { status: 400 });
  }

  const equipeId = (body.equipe_id || '').trim();
  const area = body.area === 'hospedagem_checkin' ? 'hospedagem_checkin' : 'checkin';
  if (!equipeId) {
    return NextResponse.json({ error: 'Equipe obrigatoria.' }, { status: 400 });
  }

  const supabase = createServerClient();

  const { data: equipe } = await supabase
    .from('evento_equipe')
    .select('id,evento_id,tipo,ativo')
    .eq('id', equipeId)
    .eq('evento_id', eventoId)
    .single();

  if (!equipe) {
    return NextResponse.json({ error: 'Equipe nao encontrada.' }, { status: 404 });
  }

  const equipeRow = equipe as EquipeRow;

  if (!equipeRow.ativo) {
    return NextResponse.json({ error: 'Acesso encerrado.' }, { status: 403 });
  }

  const tipoPermitido = area === 'hospedagem_checkin'
    ? (equipeRow.tipo === 'checkin_hospedagem' || equipeRow.tipo === 'hospedagem' || equipeRow.tipo === 'operador')
    : (equipeRow.tipo === 'checkin' || equipeRow.tipo === 'operador');

  if (!tipoPermitido) {
    return NextResponse.json({ error: 'Tipo nao autorizado.' }, { status: 403 });
  }

  const { data: evento } = await supabase
    .from('eventos')
    .select('id,nome,slug,departamento,data_inicio,data_fim,status,checkin_ativo')
    .eq('id', eventoId)
    .single();

  if (!evento) {
    return NextResponse.json({ error: 'Evento nao encontrado.' }, { status: 404 });
  }

  const evRow = evento as EventoRow;
  if (evRow.status !== 'programado') {
    return NextResponse.json({ error: 'Evento encerrado ou cancelado.' }, { status: 403 });
  }

  if (evRow.checkin_ativo !== true) {
    return NextResponse.json({ error: 'Check-in desativado.' }, { status: 403 });
  }

  const expiraEm = calcExpiraEm(evRow.data_fim);
  return NextResponse.json({
    ok: true,
    expira_em: expiraEm,
    evento: {
      id: evRow.id,
      nome: evRow.nome,
      slug: evRow.slug,
      departamento: evRow.departamento,
      data_inicio: evRow.data_inicio,
      data_fim: evRow.data_fim,
      status: evRow.status,
      checkin_ativo: evRow.checkin_ativo,
    },
  });
}
