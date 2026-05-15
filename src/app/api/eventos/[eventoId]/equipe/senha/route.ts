import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcrypt';
import { requireEventoAccess } from '@/lib/evento-guard';
import { logDB } from '@/lib/audit';
import { enviarEmailAcessoEquipe, getRequestOrigin } from '@/lib/evento-equipe-email';

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

  let body: { equipe_id?: string; senha?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body invalido.' }, { status: 400 });
  }

  const equipeId = (body.equipe_id || '').trim();
  const senha = (body.senha || '').trim();

  if (!equipeId) return NextResponse.json({ error: 'equipe_id obrigatorio.' }, { status: 400 });
  if (senha.length < 8) return NextResponse.json({ error: 'Senha deve ter no minimo 8 caracteres.' }, { status: 400 });

  const supabase = guard.ctx.supabaseAdmin;
  const { data: equipe } = await supabase
    .from('evento_equipe')
    .select('id,nome,email,tipo')
    .eq('id', equipeId)
    .eq('evento_id', eventoId)
    .single();

  if (!equipe) {
    return NextResponse.json({ error: 'Membro nao encontrado.' }, { status: 404 });
  }

  if ((equipe as { tipo: string }).tipo !== 'operador') {
    return NextResponse.json({ error: 'Apenas operadores possuem senha.' }, { status: 400 });
  }

  const senhaHash = await bcrypt.hash(senha, 10);
  const now = new Date().toISOString();

  await supabase
    .from('evento_equipe')
    .update({ senha_hash: senhaHash, atualizado_em: now })
    .eq('id', equipeId)
    .eq('evento_id', eventoId);

  const email = (equipe as { email: string }).email;
  let page = 1;
  let userId: string | null = null;
  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error || !data?.users?.length) break;
    const match = data.users.find((u) => u.email?.toLowerCase() === email);
    if (match) { userId = match.id; break; }
    if (data.users.length < 1000) break;
    page += 1;
  }

  if (userId) {
    await supabase.auth.admin.updateUserById(userId, { password: senha });
  }

  const { data: evento } = await supabase
    .from('eventos')
    .select('nome')
    .eq('id', eventoId)
    .single();

  const emailResult = await enviarEmailAcessoEquipe({
    para: email,
    nome: (equipe as { nome?: string | null }).nome || email,
    eventoNome: (evento as { nome?: string } | null)?.nome || 'evento',
    eventoId,
    funcao: 'operador',
    origin: getRequestOrigin(request),
    senha,
    redefinicao: true,
  });

  void logDB({
    acao: 'editar_membro_equipe',
    modulo: 'eventos',
    entidade: 'evento_equipe',
    descricao: 'Senha do operador redefinida.',
    status: 'sucesso',
    detalhes: { eventoId, equipeId, email },
    request,
  });

  void logDB({
    acao: 'enviar_acesso_equipe',
    modulo: 'eventos',
    entidade: 'evento_equipe',
    entidadeId: equipeId,
    descricao: emailResult.sucesso ? 'Acesso de operador enviado apos redefinicao de senha.' : 'Falha ao enviar acesso apos redefinicao de senha.',
    status: emailResult.sucesso ? 'sucesso' : 'erro',
    detalhes: { eventoId, equipeId, email, funcao: 'operador', provider: emailResult.provider, redefinicao: true },
    mensagemErro: emailResult.erro,
    request,
  });

  return NextResponse.json({ ok: true, email_enviado: emailResult.sucesso });
}
