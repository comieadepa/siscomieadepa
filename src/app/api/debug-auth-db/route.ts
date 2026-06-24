import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get('secret');

  // Proteção simples por token para evitar acesso público
  if (secret !== 'Siren001001') {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const info = {
    supabaseUrl: supabaseUrl ? `${supabaseUrl.substring(0, 15)}...` : 'undefined',
    hasServiceRoleKey: !!serviceRoleKey,
    serviceRoleKeyLength: serviceRoleKey ? serviceRoleKey.length : 0,
    serviceRoleKeyPrefix: serviceRoleKey ? serviceRoleKey.substring(0, 10) : 'undefined',
    hasAnonKey: !!anonKey,
    anonKeyLength: anonKey ? anonKey.length : 0,
    anonKeyPrefix: anonKey ? anonKey.substring(0, 10) : 'undefined',
  };

  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({
      message: 'Variáveis de ambiente ausentes no servidor',
      info
    }, { status: 500 });
  }

  try {
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      }
    });

    // 1. Tentar listar usuários do Auth do Supabase
    let authUsersList: any[] = [];
    let authErrorMsg = null;
    try {
      const { data: { users }, error: authError } = await supabase.auth.admin.listUsers();
      if (authError) {
        authErrorMsg = authError.message;
      } else {
        authUsersList = users.map(u => ({
          id: u.id,
          email: u.email,
          created_at: u.created_at,
          last_sign_in: u.last_sign_in_at,
          confirmed: !!u.email_confirmed_at
        }));
      }
    } catch (e: any) {
      authErrorMsg = e.message || 'Erro desconhecido ao listar auth.users';
    }

    // 2. Tentar ler a tabela public.usuarios
    let dbUsersList: any[] = [];
    let dbErrorMsg = null;
    try {
      const { data, error } = await supabase
        .from('usuarios')
        .select('id, email, nome, nivel, ativo')
        .limit(10);
      if (error) {
        dbErrorMsg = error.message;
      } else {
        dbUsersList = data || [];
      }
    } catch (e: any) {
      dbErrorMsg = e.message || 'Erro desconhecido ao ler public.usuarios';
    }

    return NextResponse.json({
      success: true,
      envInfo: info,
      authUsers: {
        count: authUsersList.length,
        users: authUsersList,
        error: authErrorMsg
      },
      dbUsers: {
        count: dbUsersList.length,
        users: dbUsersList,
        error: dbErrorMsg
      }
    });

  } catch (err: any) {
    return NextResponse.json({
      success: false,
      error: err.message || 'Erro geral na execução do endpoint',
      envInfo: info
    }, { status: 500 });
  }
}
