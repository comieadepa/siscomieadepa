import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, createServerClientFromRequest } from '@/lib/supabase-server';
import {
  canAccessModule,
  hasRole,
  normalizeRole,
  type CanonicalRole,
  type ModuleKey,
} from '@/lib/auth/roles';
import { requireEventoAccess } from '@/lib/evento-guard';

export type AuthContext = {
  supabase: ReturnType<typeof createServerClientFromRequest>;
  user: NonNullable<Awaited<ReturnType<ReturnType<typeof createServerClientFromRequest>['auth']['getUser']>>['data']['user']>;
  userId: string;
  role: CanonicalRole | null;
  rawRole: string | null;
};

async function resolveRoleFromDb(userId: string): Promise<string | null> {
  const admin = createServerClient();
  const { data } = await admin
    .from('users')
    .select('role')
    .eq('id', userId)
    .maybeSingle();
  return data?.role ? String(data.role) : null;
}

function extractRawRole(user: AuthContext['user']): string | null {
  const meta = user.user_metadata || {};
  const raw = (meta.nivel || meta.role || user.app_metadata?.role) as string | undefined;
  return raw ? String(raw) : null;
}

export async function requireUser(
  request: NextRequest
): Promise<{ ok: true; ctx: AuthContext } | { ok: false; response: NextResponse }> {
  const supabase = createServerClientFromRequest(request);
  const { data } = await supabase.auth.getUser();
  if (!data?.user) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }

  const rawMetaRole = extractRawRole(data.user);
  const normalizedMeta = normalizeRole(rawMetaRole);

  let rawRole = rawMetaRole;
  let role = normalizedMeta;

  if (!role) {
    const dbRole = await resolveRoleFromDb(data.user.id);
    rawRole = dbRole;
    role = normalizeRole(dbRole);
  }

  return {
    ok: true,
    ctx: {
      supabase,
      user: data.user,
      userId: data.user.id,
      role,
      rawRole: rawRole || null,
    },
  };
}

export async function requireRole(
  request: NextRequest,
  allowedRoles: CanonicalRole | readonly CanonicalRole[]
): Promise<{ ok: true; ctx: AuthContext } | { ok: false; response: NextResponse }> {
  const auth = await requireUser(request);
  if (!auth.ok) return auth;

  if (!hasRole(auth.ctx.role, allowedRoles)) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    };
  }

  return auth;
}

export async function requireModuleAccess(
  request: NextRequest,
  moduleKey: ModuleKey
): Promise<{ ok: true; ctx: AuthContext } | { ok: false; response: NextResponse }> {
  const auth = await requireUser(request);
  if (!auth.ok) return auth;

  if (!canAccessModule(auth.ctx.role, moduleKey)) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    };
  }

  return auth;
}

export async function requireEventAccess(request: NextRequest, eventoId: string) {
  return requireEventoAccess(request, eventoId);
}
