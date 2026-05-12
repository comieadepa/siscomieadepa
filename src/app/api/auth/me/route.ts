import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { normalizeRole } from '@/lib/auth/roles';

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
  const metaNormalized = normalizeRole(metaNivel);
  if (metaNormalized) {
    if (metaNivel && metaNormalized !== metaNivel) {
      await admin.auth.admin.updateUserById(user.id, {
        user_metadata: { ...user.user_metadata, nivel: metaNormalized },
      });
    }
    return NextResponse.json({ nivel: metaNormalized, userId: user.id });
  }

  // Lê role de public.users via admin (ignora RLS)
  const { data: row } = await admin
    .from('users')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();

  const role = row?.role ? String(row.role) : null;
  const normalized = normalizeRole(role);

  if (normalized) {
    // Sincroniza automaticamente no user_metadata para próximas chamadas
    await admin.auth.admin.updateUserById(user.id, {
      user_metadata: { ...user.user_metadata, nivel: normalized },
    });
    return NextResponse.json({ nivel: normalized, userId: user.id });
  }

  return NextResponse.json({ nivel: null, userId: user.id });
}
