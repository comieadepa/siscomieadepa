import { NextRequest, NextResponse } from 'next/server';
import { randomInt } from 'crypto';
import { requireEventoAccess } from '@/lib/evento-guard';
import { logDB } from '@/lib/audit';
import { enviarEmailAcessoEquipe, getRequestOrigin, type FuncaoEquipeEvento } from '@/lib/evento-equipe-email';

type EquipeRow = {
  id: string;
  nome: string | null;
  email: string;
  tipo: FuncaoEquipeEvento;
  ativo: boolean;
  convite_token?: string | null;
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

async function gerarCodigoEquipe(supabase: any, eventoId: string): Promise<string> {
  for (let i = 0; i < 8; i += 1) {
    const codigo = randomInt(0, 10000).toString().padStart(4, '0');
    const { data } = await supabase
      .from('evento_equipe')
      .select('id')
      .eq('evento_id', eventoId)
      .eq('tipo', 'checkin')
      .eq('convite_token', codigo)
      .maybeSingle();
    if (!data) return codigo;
  }
  throw new Error('Falha ao gerar codigo de acesso.');
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;
  const guard = await requireEventoAccess(request, eventoId);
  if (!guard.ok) return guard.response;
  if (!guard.ctx.perms.podeCriarEquipe) {
    return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
  }

  let body: { equipe_id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body invalido.' }, { status: 400 });
  }

  const equipeId = (body.equipe_id || '').trim();
  if (!equipeId) return NextResponse.json({ error: 'equipe_id obrigatorio.' }, { status: 400 });

  const supabase = guard.ctx.supabaseAdmin;
  const { data: equipe } = await supabase
    .from('evento_equipe')
    .select('id,nome,email,tipo,ativo,convite_token')
    .eq('id', equipeId)
    .eq('evento_id', eventoId)
    .single();

  if (!equipe) {
    return NextResponse.json({ error: 'Membro nao encontrado.' }, { status: 404 });
  }

  const row = equipe as EquipeRow;
  if (!row.ativo) {
    return NextResponse.json({ error: 'Membro inativo. Reative antes de reenviar o acesso.' }, { status: 400 });
  }

  const { data: evento } = await supabase
    .from('eventos')
    .select('nome,data_fim')
    .eq('id', eventoId)
    .single();

  let codigo = (row.convite_token || '').trim();
  if (row.tipo === 'checkin' && !codigo) {
    codigo = await gerarCodigoEquipe(supabase, eventoId);
    const conviteExpiraEm = calcExpiraEm((evento as { data_fim?: string | null } | null)?.data_fim ?? null);
    await supabase
      .from('evento_equipe')
      .update({ convite_token: codigo, convite_expira_em: conviteExpiraEm })
      .eq('id', row.id);
  }

  const result = await enviarEmailAcessoEquipe({
    para: row.email,
    nome: row.nome || row.email,
    eventoNome: (evento as { nome?: string } | null)?.nome || 'evento',
    eventoId,
    funcao: row.tipo,
    origin: getRequestOrigin(request),
    codigo: row.tipo === 'checkin' ? (codigo || undefined) : undefined,
  });

  void logDB({
    acao: 'reenviar_acesso_equipe',
    modulo: 'eventos',
    entidade: 'evento_equipe',
    entidadeId: row.id,
    descricao: result.sucesso ? 'Acesso de equipe reenviado por e-mail.' : 'Falha ao reenviar acesso de equipe por e-mail.',
    status: result.sucesso ? 'sucesso' : 'erro',
    detalhes: { eventoId, equipeId: row.id, email: row.email, funcao: row.tipo, provider: result.provider },
    mensagemErro: result.erro,
    request,
  });

  if (!result.sucesso) {
    return NextResponse.json({ error: 'Nao foi possivel enviar o e-mail de acesso.' }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
