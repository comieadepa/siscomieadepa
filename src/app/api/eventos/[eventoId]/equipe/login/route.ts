import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcrypt';
import { createServerClient } from '@/lib/supabase-server';
import { logDB } from '@/lib/audit';

type EventoRow = {
  id: string;
  status: 'programado' | 'realizado' | 'cancelado';
  data_fim: string | null;
};

type EquipeRow = {
  id: string;
  evento_id: string;
  email: string;
  tipo: 'operador' | 'checkin' | 'hospedagem' | 'checkin_hospedagem';
  ativo: boolean;
  senha_hash: string | null;
};

function acaoLoginPorTipo(tipo: EquipeRow['tipo']): 'login_operador_evento' | 'login_hospedagem_evento' {
  return tipo === 'hospedagem' ? 'login_hospedagem_evento' : 'login_operador_evento';
}

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

  let body: { email?: string; senha?: string; funcao?: 'operador' | 'hospedagem' };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body invalido.' }, { status: 400 });
  }

  const email = (body.email || '').trim().toLowerCase();
  const senha = (body.senha || '').trim();
  const funcao = body.funcao === 'hospedagem' ? 'hospedagem' : 'operador';

  if (!email) return NextResponse.json({ error: 'E-mail obrigatorio.' }, { status: 400 });
  if (!senha) return NextResponse.json({ error: 'Senha obrigatoria.' }, { status: 400 });

  const supabase = createServerClient();

  const { data: evento } = await supabase
    .from('eventos')
    .select('id,status,data_fim')
    .eq('id', eventoId)
    .single();

  if (!evento) {
    return NextResponse.json({ error: 'Evento nao encontrado.' }, { status: 404 });
  }

  if ((evento as EventoRow).status !== 'programado') {
    return NextResponse.json({ error: 'Evento encerrado ou cancelado.' }, { status: 403 });
  }

  const { data: equipe } = await supabase
    .from('evento_equipe')
    .select('id,evento_id,email,tipo,ativo,senha_hash')
    .eq('evento_id', eventoId)
    .eq('email', email)
    .eq('tipo', funcao)
    .maybeSingle();

  if (!equipe || (equipe as EquipeRow).ativo !== true) {
    void logDB({
      acao: acaoLoginPorTipo(funcao),
      modulo: 'eventos',
      entidade: 'evento_equipe',
      descricao: 'Tentativa de login com equipe nao encontrada ou inativa.',
      status: 'erro',
      detalhes: { eventoId, email },
      request,
    });
    return NextResponse.json({ error: 'Membro da equipe nao encontrado ou inativo.' }, { status: 403 });
  }

  const row = equipe as EquipeRow;
  if (!row.senha_hash) {
    void logDB({
      acao: acaoLoginPorTipo(row.tipo),
      modulo: 'eventos',
      entidade: 'evento_equipe',
      descricao: 'Equipe sem senha cadastrada.',
      status: 'erro',
      detalhes: { eventoId, email, equipeId: row.id },
      request,
    });
    return NextResponse.json({ error: 'Senha nao cadastrada para esta funcao.' }, { status: 403 });
  }

  const ok = await bcrypt.compare(senha, row.senha_hash);
  if (!ok) {
    void logDB({
      acao: acaoLoginPorTipo(row.tipo),
      modulo: 'eventos',
      entidade: 'evento_equipe',
      descricao: 'Senha invalida para equipe.',
      status: 'erro',
      detalhes: { eventoId, email, equipeId: row.id },
      request,
    });
    return NextResponse.json({ error: 'Senha invalida.' }, { status: 403 });
  }

  const now = new Date().toISOString();
  await supabase
    .from('evento_equipe')
    .update({ ultimo_acesso_em: now, atualizado_em: now })
    .eq('id', row.id);

  void logDB({
    acao: acaoLoginPorTipo(row.tipo),
    modulo: 'eventos',
    entidade: 'evento_equipe',
    descricao: 'Login de equipe autorizado.',
    status: 'sucesso',
    detalhes: { eventoId, email, equipeId: row.id },
    request,
  });

  return NextResponse.json({
    ok: true,
    equipe_id: row.id,
    expira_em: calcExpiraEm((evento as EventoRow).data_fim),
  });
}
