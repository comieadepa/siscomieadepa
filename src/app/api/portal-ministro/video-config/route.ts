/**
 * GET /api/portal-ministro/video-config
 * Retorna a configuração do vídeo "Palavra do Presidente".
 * Rota pública — não requer autenticação.
 */

import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';

export async function GET() {
  const supabase = createServerClient();
  const { data } = await supabase
    .from('portal_video_config')
    .select('titulo, descricao, url_video, ativo')
    .maybeSingle();

  return NextResponse.json({
    titulo: data?.titulo || 'Palavra do Presidente',
    descricao: data?.descricao || null,
    urlVideo: (data?.ativo && data?.url_video) ? data.url_video : null,
    ativo: !!data?.ativo,
  });
}
