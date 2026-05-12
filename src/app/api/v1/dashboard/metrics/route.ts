import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { requireRole } from '@/lib/auth/require-auth';

const METRICS_ROLES = ['super', 'administrador', 'comissao', 'inscricao', 'financeiro', 'cgadb'] as const;

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, METRICS_ROLES);
  if (!auth.ok) return auth.response;

  const supabase = createServerClient();

  const [supRes, camRes, candRes, actRes] = await Promise.all([
    supabase.from('supervisoes').select('id', { count: 'exact', head: true }).eq('is_active', true),
    supabase.from('campos').select('id', { count: 'exact', head: true }).eq('is_active', true),
    supabase.from('members').select('id', { count: 'exact', head: true }).eq('status', 'candidate'),
    supabase.from('members').select('id', { count: 'exact', head: true }).eq('status', 'active'),
  ]);

  if (supRes.error) {
    return NextResponse.json({ error: supRes.error.message }, { status: 500 });
  }
  if (camRes.error) {
    return NextResponse.json({ error: camRes.error.message }, { status: 500 });
  }
  if (candRes.error) {
    return NextResponse.json({ error: candRes.error.message }, { status: 500 });
  }
  if (actRes.error) {
    return NextResponse.json({ error: actRes.error.message }, { status: 500 });
  }

  return NextResponse.json({
    supervisoes: supRes.count ?? 0,
    campos: camRes.count ?? 0,
    candidatos: candRes.count ?? 0,
    ministros: actRes.count ?? 0,
  });
}
