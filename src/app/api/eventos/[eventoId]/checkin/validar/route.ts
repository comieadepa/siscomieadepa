import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';

type EventoRow = {
  id: string;
  status: 'programado' | 'realizado' | 'cancelado';
  data_fim: string | null;
  checkin_ativo: boolean | null;
};

type EquipeRow = {
  id: string;
  evento_id: string;
  tipo: 'admin' | 'checkin';
  ativo: boolean;
  convite_expira_em: string | null;
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
  let body: { equipe_id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body invalido.' }, { status: 400 });
  }

  const equipeId = (body.equipe_id || '').trim();
  if (!equipeId) {
    return NextResponse.json({ error: 'Equipe obrigatoria.' }, { status: 400 });
  }

  const supabase = createServerClient();

  const { data: equipe } = await supabase
    .from('evento_equipe')
    .select('id,evento_id,tipo,ativo,convite_expira_em')
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

  if (equipeRow.tipo !== 'checkin' && equipeRow.tipo !== 'admin') {
    return NextResponse.json({ error: 'Tipo nao autorizado.' }, { status: 403 });
  }

  const { data: evento } = await supabase
    .from('eventos')
    .select('id,status,data_fim,checkin_ativo')
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

  const expiraEm = equipeRow.convite_expira_em || calcExpiraEm(evRow.data_fim);
  if (expiraEm && new Date(expiraEm).getTime() < Date.now()) {
    return NextResponse.json({ error: 'Convite expirado.' }, { status: 403 });
  }

  return NextResponse.json({ ok: true, expira_em: expiraEm });
}
