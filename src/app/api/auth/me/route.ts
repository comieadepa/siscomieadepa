import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';

// Retorna o nivel do usuário autenticado, lendo public.users via admin client (bypassa RLS).
// Se user_metadata.nivel já estiver preenchido, usa-o diretamente.
// Caso contrário, lê public.users.role e sincroniza no user_metadata automaticamente.
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('Authorization') || request.headers.get('authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const admin = createServerClient();

  // Valida token e obtém usuário
  const { data: authData, error: authError } = await admin.auth.getUser(token);
  if (authError || !authData?.user) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const user = authData.user;

  // Se já tem nivel no metadata, retorna direto
  const metaNivel = user.user_metadata?.nivel as string | undefined;
  if (metaNivel) {
    return NextResponse.json({ nivel: metaNivel });
  }

  // Lê role de public.users via admin (ignora RLS)
  const { data: row } = await admin
    .from('users')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();

  const role = row?.role ? String(row.role) : null;

  if (role) {
    // Sincroniza automaticamente no user_metadata para próximas chamadas
    await admin.auth.admin.updateUserById(user.id, {
      user_metadata: { ...user.user_metadata, nivel: role },
    });
    return NextResponse.json({ nivel: role });
  }

  return NextResponse.json({ nivel: null });
}
