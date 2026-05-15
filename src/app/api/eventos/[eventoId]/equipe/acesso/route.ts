import { NextRequest, NextResponse } from 'next/server';
import { requireEventoAccess } from '@/lib/evento-guard';
import { logDB } from '@/lib/audit';
import { enviarEmailAcessoEquipe, getRequestOrigin, type FuncaoEquipeEvento } from '@/lib/evento-equipe-email';

type EquipeRow = {
  id: string;
  nome: string | null;
  email: string;
  tipo: FuncaoEquipeEvento;
  ativo: boolean;
};

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
    .select('id,nome,email,tipo,ativo')
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
    .select('nome')
    .eq('id', eventoId)
    .single();

  const result = await enviarEmailAcessoEquipe({
    para: row.email,
    nome: row.nome || row.email,
    eventoNome: (evento as { nome?: string } | null)?.nome || 'evento',
    eventoId,
    funcao: row.tipo,
    origin: getRequestOrigin(request),
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
