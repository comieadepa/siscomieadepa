import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';

type EquipeRow = {
  id: string;
  evento_id: string;
  email: string;
  tipo: 'admin' | 'checkin';
  ativo: boolean;
  convite_expira_em: string | null;
  convite_usado_em: string | null;
};

// POST /api/eventos/equipe/confirmar
// Valida token de convite de OPERADOR, cria (ou encontra) usuário Supabase,
// vincula ao evento em usuario_eventos e consome o token.
export async function POST(request: NextRequest) {
  let body: { token?: string; senha?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body invalido.' }, { status: 400 });
  }

  const token = decodeURIComponent((body.token || '').trim());
  const senha = (body.senha || '').trim();

  if (!token) {
    return NextResponse.json({ error: 'Token obrigatorio.' }, { status: 400 });
  }
  if (!senha || senha.length < 8) {
    return NextResponse.json({ error: 'Senha deve ter no minimo 8 caracteres.' }, { status: 400 });
  }

  const supabase = createServerClient();

  // Busca e valida o token
  const { data: equipe, error: equipeError } = await supabase
    .from('evento_equipe')
    .select('id,evento_id,email,tipo,ativo,convite_expira_em,convite_usado_em')
    .eq('convite_token', token)
    .maybeSingle();

  if (equipeError) {
    console.error('[confirmar] Erro ao buscar token:', equipeError.message, equipeError.code);
    if (equipeError.code === 'PGRST204') {
      return NextResponse.json({ error: 'Configuracao do banco desatualizada.' }, { status: 500 });
    }
    return NextResponse.json({ error: 'Erro interno ao validar convite.' }, { status: 500 });
  }

  if (!equipe) {
    return NextResponse.json({ error: 'Token invalido ou ja utilizado.' }, { status: 404 });
  }

  const row = equipe as EquipeRow;

  if (!row.ativo) {
    return NextResponse.json({ error: 'Convite revogado.' }, { status: 403 });
  }

  // Apenas tokens de operador (tipo='admin') passam por este fluxo
  if (row.tipo !== 'admin') {
    return NextResponse.json({ error: 'Este link e apenas para Check-in. Use o link correto enviado por e-mail.' }, { status: 400 });
  }

  if (row.convite_expira_em && new Date(row.convite_expira_em).getTime() < Date.now()) {
    return NextResponse.json({ error: 'Convite expirado.' }, { status: 403 });
  }

  // Verifica se o evento ainda está ativo
  const { data: evento } = await supabase
    .from('eventos')
    .select('id,status')
    .eq('id', row.evento_id)
    .single();

  if (!evento || (evento as { status: string }).status !== 'programado') {
    return NextResponse.json({ error: 'Evento encerrado ou cancelado.' }, { status: 403 });
  }

  const email = row.email.toLowerCase();

  // Verifica se já existe usuário Supabase com este e-mail
  let userId: string | null = null;
  let isNewUser = false;

  // Busca em páginas até encontrar (ou esgotar)
  let page = 1;
  let found = false;
  while (!found) {
    const { data: listData, error: listError } = await supabase.auth.admin.listUsers({
      page,
      perPage: 1000,
    });
    if (listError || !listData?.users?.length) break;
    const match = listData.users.find((u) => u.email?.toLowerCase() === email);
    if (match) {
      userId = match.id;
      found = true;
      break;
    }
    if (listData.users.length < 1000) break; // última página
    page++;
  }

  if (!userId) {
    // Cria novo usuário com a senha fornecida
    const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
      email,
      password: senha,
      email_confirm: true,
      user_metadata: { nivel: 'inscricao' },
    });
    if (createError) {
      console.error('[confirmar] Erro ao criar usuario:', createError.message);
      return NextResponse.json({ error: 'Erro ao criar acesso. Tente novamente.' }, { status: 500 });
    }
    userId = newUser.user.id;
    isNewUser = true;
  }

  // Vincula usuário ao evento com permissão operador
  const { error: upsertError } = await supabase
    .from('usuario_eventos')
    .upsert(
      { user_id: userId, evento_id: row.evento_id, permissao: 'operador' },
      { onConflict: 'user_id,evento_id' }
    );

  if (upsertError) {
    console.error('[confirmar] Erro ao vincular usuario_eventos:', upsertError.message);
    return NextResponse.json({ error: 'Erro ao vincular acesso ao evento.' }, { status: 500 });
  }

  // Consome o token (uso único)
  const now = new Date().toISOString();
  await supabase
    .from('evento_equipe')
    .update({
      convite_token: null,
      convite_usado_em: row.convite_usado_em || now,
      ultimo_acesso_em: now,
    })
    .eq('id', row.id);

  return NextResponse.json({
    ok: true,
    email,
    eventoId: row.evento_id,
    isNewUser,
  });
}
