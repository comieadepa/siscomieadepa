/**
 * GET /api/portal-ministro/credencial/qr-token
 * Retorna (ou cria) um token de validação para o QR Code da credencial.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { getMinistroSession, unauthorizedResponse } from '@/lib/ministro-session';
import { randomBytes } from 'crypto';

export async function GET(request: NextRequest) {
  const session = await getMinistroSession(request);
  if (!session) return unauthorizedResponse();

  const supabase = createServerClient();

  // Busca token válido existente
  const { data: existing } = await supabase
    .from('credencial_qr_tokens')
    .select('token, expires_at')
    .eq('ministro_id', session.ministroId)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ token: existing.token });
  }

  // Cria novo token aleatório (48 hex chars = 24 bytes = 192 bits de entropia)
  const token = randomBytes(24).toString('hex');
  const expiresAt = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();

  const { error } = await supabase
    .from('credencial_qr_tokens')
    .insert({ ministro_id: session.ministroId, token, expires_at: expiresAt });

  if (error) {
    console.error('[qr-token]', error.message);
    return NextResponse.json({ error: 'Erro ao gerar token.' }, { status: 500 });
  }

  return NextResponse.json({ token });
}
