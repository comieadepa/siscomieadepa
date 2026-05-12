import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';

type EventoRow = {
  id: string;
  status: 'programado' | 'realizado' | 'cancelado';
  data_fim: string | null;
};

type EquipeRow = {
  id: string;
  evento_id: string;
  tipo: 'admin' | 'checkin';
  ativo: boolean;
  convite_expira_em: string | null;
  convite_usado_em: string | null;
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

export async function POST(request: NextRequest) {
  let body: { token?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body invalido.' }, { status: 400 });
  }

  const token = (body.token || '').trim();
  if (!token) {
    return NextResponse.json({ error: 'Token obrigatorio.' }, { status: 400 });
  }

  const supabase = createServerClient();

  const { data: equipe } = await supabase
    .from('evento_equipe')
    .select('id,evento_id,tipo,ativo,convite_expira_em,convite_usado_em')
    .eq('convite_token', token)
    .single();

  if (!equipe) {
    return NextResponse.json({ error: 'Token invalido.' }, { status: 404 });
  }

  const equipeRow = equipe as EquipeRow;

  if (!equipeRow.ativo) {
    return NextResponse.json({ error: 'Convite revogado.' }, { status: 403 });
  }

  const { data: evento } = await supabase
    .from('eventos')
    .select('id,status,data_fim')
    .eq('id', equipeRow.evento_id)
    .single();

  if (!evento) {
    return NextResponse.json({ error: 'Evento nao encontrado.' }, { status: 404 });
  }

  const evRow = evento as EventoRow;
  if (evRow.status !== 'programado') {
    return NextResponse.json({ error: 'Evento encerrado ou cancelado.' }, { status: 403 });
  }

  const now = new Date();
  const expiraCalculada = calcExpiraEm(evRow.data_fim);
  const expiraEm = equipeRow.convite_expira_em || expiraCalculada;

  if (expiraEm && new Date(expiraEm).getTime() < now.getTime()) {
    return NextResponse.json({ error: 'Convite expirado.' }, { status: 403 });
  }

  await supabase
    .from('evento_equipe')
    .update({
      convite_usado_em: equipeRow.convite_usado_em || now.toISOString(),
      ultimo_acesso_em: now.toISOString(),
      convite_expira_em: expiraEm,
    })
    .eq('id', equipeRow.id);

  return NextResponse.json({
    ok: true,
    evento_id: equipeRow.evento_id,
    equipe_id: equipeRow.id,
    tipo: equipeRow.tipo,
    expira_em: expiraEm,
  });
}
