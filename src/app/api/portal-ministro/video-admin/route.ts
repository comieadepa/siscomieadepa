/**
 * GET/PUT /api/portal-ministro/video-admin
 * Gerencia configuração do vídeo "Palavra do Presidente".
 * Requer autenticação admin (super/administrador).
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { requireRole } from '@/lib/auth/require-auth';

const ALLOWED_ROLES = ['super', 'administrador'] as const;

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, ALLOWED_ROLES);
  if (!auth.ok) return auth.response;

  const supabase = createServerClient();
  const { data } = await supabase
    .from('portal_video_config')
    .select('*')
    .maybeSingle();

  return NextResponse.json({ data: data || null });
}

export async function PUT(request: NextRequest) {
  const auth = await requireRole(request, ALLOWED_ROLES);
  if (!auth.ok) return auth.response;

  const body = await request.json();
  const { titulo, descricao, url_video, ativo } = body;

  if (typeof ativo !== 'undefined' && typeof ativo !== 'boolean') {
    return NextResponse.json({ error: 'ativo deve ser boolean.' }, { status: 400 });
  }

  const supabase = createServerClient();

  const updateData: Record<string, any> = { updated_at: new Date().toISOString() };
  if (titulo !== undefined) updateData.titulo = titulo;
  if (descricao !== undefined) updateData.descricao = descricao;
  if (url_video !== undefined) updateData.url_video = url_video;
  if (ativo !== undefined) updateData.ativo = ativo;

  // Upsert com o registro único
  const { data: existing } = await supabase.from('portal_video_config').select('id').maybeSingle();

  let error;
  if (existing) {
    ({ error } = await supabase
      .from('portal_video_config')
      .update(updateData)
      .eq('id', existing.id));
  } else {
    ({ error } = await supabase.from('portal_video_config').insert({
      titulo: titulo || 'Palavra do Presidente',
      descricao: descricao || null,
      url_video: url_video || null,
      ativo: ativo ?? false,
    }));
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
