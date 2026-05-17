import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { logDB } from '@/lib/audit';

type EventoRow = {
  id: string;
  nome: string;
  status: 'programado' | 'realizado' | 'cancelado';
  data_fim: string | null;
  checkin_ativo?: boolean | null;
};

type EquipeRow = {
  id: string;
  evento_id: string;
  email: string;
  tipo: 'operador' | 'checkin';
  ativo: boolean;
  convite_token?: string | null;
  convite_expira_em?: string | null;
};

function endOfDayUtc(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1, 23, 59, 59, 999));
}

function calcExpiraEm(dataFim: string | null): string {
  const base = dataFim ? endOfDayUtc(dataFim) : new Date();
  const exp = new Date(base.getTime() + 48 * 60 * 60 * 1000);
  return exp.toISOString();
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;
  let body: { email?: string; codigo?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body invalido.' }, { status: 400 });
  }

  const codigoRaw = (body.codigo || '').trim();
  const email = (body.email || '').trim().toLowerCase();
  const codigo = codigoRaw.replace(/\s+/g, '');
  if (!codigo && !email) {
    return NextResponse.json({ error: 'Codigo obrigatorio.' }, { status: 400 });
  }
  if (codigo && !/^\d{4}$/.test(codigo)) {
    return NextResponse.json({ error: 'Codigo invalido.' }, { status: 400 });
  }

  const supabase = createServerClient();

  const { data: evento } = await supabase
    .from('eventos')
    .select('id,nome,status,data_fim,checkin_ativo')
    .eq('id', eventoId)
    .single();

  if (!evento) {
    return NextResponse.json({ error: 'Evento nao encontrado.' }, { status: 404 });
  }

  if ((evento as EventoRow).status !== 'programado') {
    return NextResponse.json({ error: 'Evento encerrado ou cancelado.' }, { status: 403 });
  }

  if ((evento as EventoRow).checkin_ativo !== true) {
    return NextResponse.json({ error: 'Check-in desativado.' }, { status: 403 });
  }

  const equipeQuery = supabase
    .from('evento_equipe')
    .select('id,evento_id,email,tipo,ativo,convite_token,convite_expira_em')
    .eq('evento_id', eventoId)
    .eq('tipo', 'checkin');

  const { data: equipe } = codigo
    ? await equipeQuery.eq('convite_token', codigo).maybeSingle()
    : await equipeQuery.eq('email', email).maybeSingle();

  if (!equipe || equipe.ativo !== true) {
    void logDB({
      acao: 'acesso_checkin_negado',
      modulo: 'eventos',
      entidade: 'evento_equipe',
      descricao: codigo ? 'Acesso ao check-in negado por codigo invalido.' : 'Acesso ao check-in negado por e-mail nao cadastrado.',
      status: 'erro',
      detalhes: { eventoId, email },
      request,
    });
    return NextResponse.json({ error: codigo ? 'Codigo nao autorizado para check-in.' : 'E-mail nao autorizado para check-in.' }, { status: 403 });
  }

  const equipeRow = equipe as EquipeRow;
  if (equipeRow.convite_expira_em && new Date(equipeRow.convite_expira_em) < new Date()) {
    return NextResponse.json({ error: 'Codigo expirado.' }, { status: 403 });
  }
  const now = new Date().toISOString();
  const expiraEm = calcExpiraEm((evento as EventoRow).data_fim);

  const { error: updError } = await supabase
    .from('evento_equipe')
    .update({
      ultimo_acesso_em: now,
      atualizado_em: now,
      convite_usado_em: now,
    })
    .eq('id', equipe.id);

  if (updError) {
    return NextResponse.json({ error: 'Erro ao registrar acesso.' }, { status: 500 });
  }

  void logDB({
    acao: 'acesso_checkin_liberado',
    modulo: 'eventos',
    entidade: 'evento_equipe',
    descricao: 'Acesso ao check-in liberado por e-mail.',
    status: 'sucesso',
    detalhes: { eventoId, email, equipeId: (equipe as EquipeRow).id },
    request,
  });

  return NextResponse.json({
    ok: true,
    equipe_id: (equipe as EquipeRow).id,
    expira_em: expiraEm,
  });
}
