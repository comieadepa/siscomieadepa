import { NextRequest, NextResponse } from 'next/server';
import type { User } from '@supabase/supabase-js';
import bcrypt from 'bcrypt';
import { randomInt } from 'crypto';
import { requireEventoAccess } from '@/lib/evento-guard';
import { logDB } from '@/lib/audit';
import { enviarEmailAcessoEquipe, getRequestOrigin } from '@/lib/evento-equipe-email';

type FuncaoEquipe = 'operador' | 'checkin' | 'hospedagem' | 'checkin_hospedagem';

type EquipeRow = {
  id: string;
  evento_id: string;
  nome: string | null;
  email: string;
  tipo: FuncaoEquipe;
  ativo: boolean;
  senha_hash: string | null;
  convite_token?: string | null;
};

function normalizarFuncao(raw?: string | null): FuncaoEquipe {
  if (raw === 'operador') return 'operador';
  if (raw === 'hospedagem') return 'hospedagem';
  if (raw === 'checkin_hospedagem') return 'checkin_hospedagem';
  return 'checkin';
}

function exigeSenha(funcao: FuncaoEquipe): boolean {
  return funcao === 'operador' || funcao === 'hospedagem';
}

function isFuncaoCheckinSemSenha(funcao: FuncaoEquipe): boolean {
  return funcao === 'checkin' || funcao === 'checkin_hospedagem';
}

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
      .in('tipo', ['checkin', 'checkin_hospedagem'])
      .eq('convite_token', codigo)
      .maybeSingle();
    if (!data) return codigo;
  }
  throw new Error('Falha ao gerar codigo de acesso.');
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
  if (exigeSenha(funcao) && senha.length < 8) {
    return NextResponse.json({ error: 'Senha deve ter no minimo 8 caracteres.' }, { status: 400 });
  }

  if (guard.ctx.evento.status && guard.ctx.evento.status !== 'programado') {
    return NextResponse.json({ error: 'Evento encerrado ou cancelado.' }, { status: 403 });
  }

  const supabase = guard.ctx.supabaseAdmin;

  const { data: eventoInfo } = await supabase
    .from('eventos')
    .select('nome,data_fim')
    .eq('id', eventoId)
    .single();

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
  const senhaHash = exigeSenha(funcao) ? await bcrypt.hash(senha, 10) : null;
  const codigoAcesso = isFuncaoCheckinSemSenha(funcao) ? await gerarCodigoEquipe(supabase, eventoId) : null;
  const conviteExpiraEm = isFuncaoCheckinSemSenha(funcao)
    ? calcExpiraEm((eventoInfo as { data_fim?: string | null } | null)?.data_fim ?? null)
    : null;

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
        convite_token: codigoAcesso,
        convite_expira_em: conviteExpiraEm,
        criado_por: guard.ctx.user.id,
        atualizado_em: now,
      },
    ])
    .select('id')
    .single();

  if (insertError || !novoRegistro) {
    const msg = insertError?.message ?? 'Insert retornou vazio';
    console.error('[equipe/POST] insertError:', msg, insertError?.details, insertError?.hint);
    return NextResponse.json({ error: 'Erro ao cadastrar membro.', detail: msg }, { status: 500 });
  }

  if (exigeSenha(funcao)) {
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
        return NextResponse.json({ error: 'Erro ao criar usuario da equipe.' }, { status: 500 });
      }
      await supabase.from('usuario_eventos').upsert(
        { user_id: newUser.user.id, evento_id: eventoId, permissao: funcao },
        { onConflict: 'user_id,evento_id' }
      );
    } else {
      if (senha) {
        await supabase.auth.admin.updateUserById(user.id, { password: senha });
      }
      await supabase.from('usuario_eventos').upsert(
        { user_id: user.id, evento_id: eventoId, permissao: funcao },
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

  const emailResult = await enviarEmailAcessoEquipe({
    para: email,
    nome,
    eventoNome: (eventoInfo as { nome?: string } | null)?.nome || 'evento',
    eventoId,
    funcao,
    origin: getRequestOrigin(request),
    senha: exigeSenha(funcao) ? senha : undefined,
    codigo: isFuncaoCheckinSemSenha(funcao) ? (codigoAcesso ?? undefined) : undefined,
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
    .select('id,evento_id,nome,email,tipo,ativo,senha_hash,convite_token')
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

  if (exigeSenha(funcao)) {
    if (senha && senha.length < 8) {
      return NextResponse.json({ error: 'Senha deve ter no minimo 8 caracteres.' }, { status: 400 });
    }
    if (!senha && !row.senha_hash) {
      return NextResponse.json({ error: 'Defina uma senha para esta funcao.' }, { status: 400 });
    }
  }

  if (exigeSenha(funcao)) {
    const user = await encontrarUsuarioPorEmail(supabase, email);
    if (!user && !senha) {
      return NextResponse.json({ error: 'Senha obrigatoria para criar o usuario desta funcao.' }, { status: 400 });
    }
    if (!user && senha) {
      const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
        email,
        password: senha,
        email_confirm: true,
        user_metadata: { nivel: 'inscricao' },
      });
      if (createError || !newUser?.user) {
        return NextResponse.json({ error: 'Erro ao criar usuario da equipe.' }, { status: 500 });
      }
      await supabase.from('usuario_eventos').upsert(
        { user_id: newUser.user.id, evento_id: eventoId, permissao: funcao },
        { onConflict: 'user_id,evento_id' }
      );
    }
    if (user) {
      if (senha) {
        await supabase.auth.admin.updateUserById(user.id, { password: senha });
      }
      await supabase.from('usuario_eventos').upsert(
        { user_id: user.id, evento_id: eventoId, permissao: funcao },
        { onConflict: 'user_id,evento_id' }
      );
    }
  }

  if (isFuncaoCheckinSemSenha(funcao) && (row.tipo === 'operador' || row.tipo === 'hospedagem')) {
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
  const { data: eventoInfoPatch } = await supabase
    .from('eventos')
    .select('data_fim')
    .eq('id', eventoId)
    .single();
  const deveTerSenha = exigeSenha(funcao);
  const codigoAcesso = isFuncaoCheckinSemSenha(funcao)
    ? (row.tipo === funcao && row.convite_token ? row.convite_token : await gerarCodigoEquipe(supabase, eventoId))
    : null;
  const conviteExpiraEm = isFuncaoCheckinSemSenha(funcao)
    ? calcExpiraEm((eventoInfoPatch as { data_fim?: string | null } | null)?.data_fim ?? null)
    : null;

  const { error: updError } = await supabase
    .from('evento_equipe')
    .update({
      nome,
      email,
      tipo: funcao,
      ativo,
      senha_hash: deveTerSenha ? senhaHash : null,
      convite_token: isFuncaoCheckinSemSenha(funcao) ? codigoAcesso : null,
      convite_expira_em: isFuncaoCheckinSemSenha(funcao) ? conviteExpiraEm : null,
      atualizado_em: now,
    })
    .eq('id', equipeId)
    .eq('evento_id', eventoId);

  if (updError) {
    return NextResponse.json({ error: 'Erro ao atualizar membro.' }, { status: 500 });
  }

  if (exigeSenha(funcao) && senha) {
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

  if (row.tipo === 'operador' || row.tipo === 'hospedagem') {
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
