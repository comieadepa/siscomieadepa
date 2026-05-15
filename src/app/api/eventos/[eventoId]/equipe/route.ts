import { NextRequest, NextResponse } from 'next/server';
import type { User } from '@supabase/supabase-js';
import bcrypt from 'bcrypt';
import { requireEventoAccess } from '@/lib/evento-guard';
import { logDB } from '@/lib/audit';
import { enviarEmailAcessoEquipe, getRequestOrigin } from '@/lib/evento-equipe-email';

type FuncaoEquipe = 'operador' | 'checkin';

type EquipeRow = {
  id: string;
  evento_id: string;
  nome: string | null;
  email: string;
  tipo: FuncaoEquipe;
  ativo: boolean;
  senha_hash: string | null;
};

function normalizarFuncao(raw?: string | null): FuncaoEquipe {
  return raw === 'operador' ? 'operador' : 'checkin';
}

async function encontrarUsuarioPorEmail(supabase: any, email: string): Promise<User | null> {
  let page = 1;
  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    const users = (data?.users || []) as User[];
    if (error || users.length === 0) return null;
    const match = users.find((u) => u.email?.toLowerCase() === email);
    if (match) return match;
    if (users.length < 1000) return null;
    page += 1;
  }
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

  let body: { nome?: string; email?: string; funcao?: string; senha?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body invalido.' }, { status: 400 });
  }

  const nome = (body.nome || '').trim();
  const email = (body.email || '').trim().toLowerCase();
  const funcao = normalizarFuncao(body.funcao);
  const senha = (body.senha || '').trim();

  if (!nome) return NextResponse.json({ error: 'Nome obrigatorio.' }, { status: 400 });
  if (!email) return NextResponse.json({ error: 'E-mail obrigatorio.' }, { status: 400 });
  if (funcao === 'operador' && senha.length < 8) {
    return NextResponse.json({ error: 'Senha deve ter no minimo 8 caracteres.' }, { status: 400 });
  }

  if (guard.ctx.evento.status && guard.ctx.evento.status !== 'programado') {
    return NextResponse.json({ error: 'Evento encerrado ou cancelado.' }, { status: 403 });
  }

  const supabase = guard.ctx.supabaseAdmin;

  const { data: existente } = await supabase
    .from('evento_equipe')
    .select('id')
    .eq('evento_id', eventoId)
    .eq('email', email)
    .maybeSingle();

  if (existente) {
    return NextResponse.json({ error: 'E-mail ja cadastrado neste evento.' }, { status: 409 });
  }

  if (funcao === 'operador') {
    const { data: outroEvento } = await supabase
      .from('evento_equipe')
      .select('id,evento_id')
      .eq('email', email)
      .eq('tipo', 'operador')
      .limit(1);

    if (outroEvento && outroEvento.length > 0) {
      return NextResponse.json({ error: 'E-mail ja cadastrado como operador em outro evento.' }, { status: 409 });
    }
  }

  const now = new Date().toISOString();
  const senhaHash = funcao === 'operador' ? await bcrypt.hash(senha, 10) : null;

  const { data: novoRegistro, error: insertError } = await supabase
    .from('evento_equipe')
    .insert([
      {
        evento_id: eventoId,
        nome,
        email,
        tipo: funcao,
        ativo: true,
        senha_hash: senhaHash,
        criado_por: guard.ctx.user.id,
        atualizado_em: now,
      },
    ])
    .select('id')
    .single();

  if (insertError || !novoRegistro) {
    return NextResponse.json({ error: 'Erro ao cadastrar membro.' }, { status: 500 });
  }

  if (funcao === 'operador') {
    const user = await encontrarUsuarioPorEmail(supabase, email);
    if (!user) {
      const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
        email,
        password: senha,
        email_confirm: true,
        user_metadata: { nivel: 'inscricao' },
      });
      if (createError || !newUser?.user) {
        await supabase.from('evento_equipe').delete().eq('id', novoRegistro.id);
        return NextResponse.json({ error: 'Erro ao criar usuario do operador.' }, { status: 500 });
      }
      await supabase.from('usuario_eventos').upsert(
        { user_id: newUser.user.id, evento_id: eventoId, permissao: 'operador' },
        { onConflict: 'user_id,evento_id' }
      );
    } else {
      await supabase.auth.admin.updateUserById(user.id, { password: senha });
      await supabase.from('usuario_eventos').upsert(
        { user_id: user.id, evento_id: eventoId, permissao: 'operador' },
        { onConflict: 'user_id,evento_id' }
      );
    }
  }

  void logDB({
    acao: 'cadastrar_membro_equipe',
    modulo: 'eventos',
    entidade: 'evento_equipe',
    descricao: 'Membro de equipe cadastrado.',
    status: 'sucesso',
    detalhes: { eventoId, equipeId: novoRegistro.id, email, funcao },
    request,
  });

  const { data: eventoEmail } = await supabase
    .from('eventos')
    .select('nome')
    .eq('id', eventoId)
    .single();

  const emailResult = await enviarEmailAcessoEquipe({
    para: email,
    nome,
    eventoNome: (eventoEmail as { nome?: string } | null)?.nome || 'evento',
    eventoId,
    funcao,
    origin: getRequestOrigin(request),
    senha: funcao === 'operador' ? senha : undefined,
  });

  void logDB({
    acao: 'enviar_acesso_equipe',
    modulo: 'eventos',
    entidade: 'evento_equipe',
    entidadeId: novoRegistro.id,
    descricao: emailResult.sucesso ? 'Acesso de equipe enviado por e-mail.' : 'Falha ao enviar acesso de equipe por e-mail.',
    status: emailResult.sucesso ? 'sucesso' : 'erro',
    detalhes: { eventoId, equipeId: novoRegistro.id, email, funcao, provider: emailResult.provider },
    mensagemErro: emailResult.erro,
    request,
  });

  return NextResponse.json({ ok: true, id: novoRegistro.id, email_enviado: emailResult.sucesso });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;
  const guard = await requireEventoAccess(request, eventoId);
  if (!guard.ok) return guard.response;
  if (!guard.ctx.perms.podeCriarEquipe) {
    return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
  }

  let body: { equipe_id?: string; nome?: string; email?: string; funcao?: string; ativo?: boolean; senha?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body invalido.' }, { status: 400 });
  }

  const equipeId = (body.equipe_id || '').trim();
  if (!equipeId) return NextResponse.json({ error: 'equipe_id obrigatorio.' }, { status: 400 });

  const supabase = guard.ctx.supabaseAdmin;
  const { data: existente } = await supabase
    .from('evento_equipe')
    .select('id,evento_id,nome,email,tipo,ativo,senha_hash')
    .eq('id', equipeId)
    .eq('evento_id', eventoId)
    .single();

  if (!existente) {
    return NextResponse.json({ error: 'Membro nao encontrado.' }, { status: 404 });
  }

  const row = existente as EquipeRow;
  const nome = (body.nome ?? row.nome ?? '').trim();
  const email = (body.email ?? row.email ?? '').trim().toLowerCase();
  const funcao = body.funcao ? normalizarFuncao(body.funcao) : row.tipo;
  const ativo = typeof body.ativo === 'boolean' ? body.ativo : row.ativo;
  const senha = (body.senha || '').trim();

  if (!nome) return NextResponse.json({ error: 'Nome obrigatorio.' }, { status: 400 });
  if (!email) return NextResponse.json({ error: 'E-mail obrigatorio.' }, { status: 400 });

  if (email !== row.email) {
    const { data: duplicado } = await supabase
      .from('evento_equipe')
      .select('id')
      .eq('evento_id', eventoId)
      .eq('email', email)
      .maybeSingle();
    if (duplicado) {
      return NextResponse.json({ error: 'E-mail ja cadastrado neste evento.' }, { status: 409 });
    }
  }

  if (funcao === 'operador' && email !== row.email) {
    const { data: outroEvento } = await supabase
      .from('evento_equipe')
      .select('id,evento_id')
      .eq('email', email)
      .eq('tipo', 'operador')
      .limit(1);

    if (outroEvento && outroEvento.length > 0) {
      return NextResponse.json({ error: 'E-mail ja cadastrado como operador em outro evento.' }, { status: 409 });
    }
  }

  if (funcao === 'operador') {
    if (senha && senha.length < 8) {
      return NextResponse.json({ error: 'Senha deve ter no minimo 8 caracteres.' }, { status: 400 });
    }
    if (!senha && !row.senha_hash) {
      return NextResponse.json({ error: 'Defina uma senha para operador.' }, { status: 400 });
    }
  }

  if (funcao === 'operador') {
    const user = await encontrarUsuarioPorEmail(supabase, email);
    if (!user && !senha) {
      return NextResponse.json({ error: 'Senha obrigatoria para criar o usuario do operador.' }, { status: 400 });
    }
    if (!user && senha) {
      const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
        email,
        password: senha,
        email_confirm: true,
        user_metadata: { nivel: 'inscricao' },
      });
      if (createError || !newUser?.user) {
        return NextResponse.json({ error: 'Erro ao criar usuario do operador.' }, { status: 500 });
      }
      await supabase.from('usuario_eventos').upsert(
        { user_id: newUser.user.id, evento_id: eventoId, permissao: 'operador' },
        { onConflict: 'user_id,evento_id' }
      );
    }
    if (user && senha) {
      await supabase.auth.admin.updateUserById(user.id, { password: senha });
      await supabase.from('usuario_eventos').upsert(
        { user_id: user.id, evento_id: eventoId, permissao: 'operador' },
        { onConflict: 'user_id,evento_id' }
      );
    }
  }

  if (funcao === 'checkin' && row.tipo === 'operador') {
    const user = await encontrarUsuarioPorEmail(supabase, email);
    if (user) {
      await supabase
        .from('usuario_eventos')
        .delete()
        .eq('user_id', user.id)
        .eq('evento_id', eventoId);
    }
  }

  const now = new Date().toISOString();
  const senhaHash = senha ? await bcrypt.hash(senha, 10) : row.senha_hash;

  const { error: updError } = await supabase
    .from('evento_equipe')
    .update({
      nome,
      email,
      tipo: funcao,
      ativo,
      senha_hash: funcao === 'operador' ? senhaHash : null,
      atualizado_em: now,
    })
    .eq('id', equipeId)
    .eq('evento_id', eventoId);

  if (updError) {
    return NextResponse.json({ error: 'Erro ao atualizar membro.' }, { status: 500 });
  }

  if (funcao === 'operador' && senha) {
    const { data: eventoEmail } = await supabase
      .from('eventos')
      .select('nome')
      .eq('id', eventoId)
      .single();

    const emailResult = await enviarEmailAcessoEquipe({
      para: email,
      nome,
      eventoNome: (eventoEmail as { nome?: string } | null)?.nome || 'evento',
      eventoId,
      funcao,
      origin: getRequestOrigin(request),
      senha,
      redefinicao: true,
    });

    void logDB({
      acao: 'enviar_acesso_equipe',
      modulo: 'eventos',
      entidade: 'evento_equipe',
      entidadeId: equipeId,
      descricao: emailResult.sucesso ? 'Acesso de operador enviado apos redefinicao de senha.' : 'Falha ao enviar acesso apos redefinicao de senha.',
      status: emailResult.sucesso ? 'sucesso' : 'erro',
      detalhes: { eventoId, equipeId, email, funcao, provider: emailResult.provider, redefinicao: true },
      mensagemErro: emailResult.erro,
      request,
    });
  }

  if (row.ativo && !ativo) {
    void logDB({
      acao: 'desativar_membro_equipe',
      modulo: 'eventos',
      entidade: 'evento_equipe',
      descricao: 'Membro de equipe desativado.',
      status: 'sucesso',
      detalhes: { eventoId, equipeId, email },
      request,
    });
  } else {
    void logDB({
      acao: 'editar_membro_equipe',
      modulo: 'eventos',
      entidade: 'evento_equipe',
      descricao: 'Membro de equipe atualizado.',
      status: 'sucesso',
      detalhes: { eventoId, equipeId, email, funcao, ativo },
      request,
    });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
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
  const { data: existente } = await supabase
    .from('evento_equipe')
    .select('id,email,tipo')
    .eq('id', equipeId)
    .eq('evento_id', eventoId)
    .single();

  if (!existente) {
    return NextResponse.json({ error: 'Membro nao encontrado.' }, { status: 404 });
  }

  const row = existente as Pick<EquipeRow, 'id' | 'email' | 'tipo'>;

  await supabase.from('evento_equipe').delete().eq('id', equipeId).eq('evento_id', eventoId);

  if (row.tipo === 'operador') {
    const user = await encontrarUsuarioPorEmail(supabase, row.email);
    if (user) {
      await supabase
        .from('usuario_eventos')
        .delete()
        .eq('user_id', user.id)
        .eq('evento_id', eventoId);
    }
  }

  void logDB({
    acao: 'desativar_membro_equipe',
    modulo: 'eventos',
    entidade: 'evento_equipe',
    descricao: 'Membro de equipe removido.',
    status: 'sucesso',
    detalhes: { eventoId, equipeId, email: row.email, removido: true },
    request,
  });

  return NextResponse.json({ ok: true });
}
