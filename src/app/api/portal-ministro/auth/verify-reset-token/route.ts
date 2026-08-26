/**
 * GET /api/portal-ministro/auth/verify-reset-token
 * Valida se um token de recuperação de senha é autêntico, não foi utilizado e não expirou.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { checkRateLimit } from '@/lib/rate-limit';

const RATE_LIMIT_ATTEMPTS = 15;
const RATE_LIMIT_WINDOW_MS = 60_000;

function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]?.trim() || 'unknown';
  return request.headers.get('x-real-ip') || 'unknown';
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const token = (searchParams.get('token') || '').trim();

    if (!token) {
      return NextResponse.json({ valid: false, error: 'Token não fornecido.' }, { status: 400 });
    }

    const ip = getClientIp(request);
    const rate = checkRateLimit({
      key: `portal-ministro:verify-token:${ip}`,
      limit: RATE_LIMIT_ATTEMPTS,
      windowMs: RATE_LIMIT_WINDOW_MS,
    });

    if (!rate.allowed) {
      return NextResponse.json(
        { valid: false, error: 'Muitas requisições. Aguarde um momento.' },
        { status: 429 },
      );
    }

    const supabase = createServerClient();
    const agora = new Date().toISOString();

    const { data: resetRecord, error: resetErr } = await supabase
      .from('ministro_portal_password_resets')
      .select('id, ministro_id, expires_at, used')
      .eq('token', token)
      .maybeSingle();

    if (resetErr || !resetRecord) {
      return NextResponse.json(
        { valid: false, error: 'Link de recuperação inválido ou inexistente.' },
        { status: 404 },
      );
    }

    if (resetRecord.used) {
      return NextResponse.json(
        { valid: false, error: 'Este link de recuperação já foi utilizado.' },
        { status: 410 },
      );
    }

    if (new Date(resetRecord.expires_at) <= new Date(agora)) {
      return NextResponse.json(
        { valid: false, error: 'Este link de recuperação expirou. Solicite um novo link.' },
        { status: 410 },
      );
    }

    // Busca nome do ministro
    const { data: ministro } = await supabase
      .from('members')
      .select('name')
      .eq('id', resetRecord.ministro_id)
      .maybeSingle();

    return NextResponse.json({
      valid: true,
      nomeMinistro: ministro?.name || 'Ministro',
    });
  } catch (err) {
    console.error('[verify-reset-token]', err);
    return NextResponse.json({ valid: false, error: 'Erro interno ao validar link.' }, { status: 500 });
  }
}
