/**
 * GET /api/validar-credencial/[token]
 * Rota pública — valida token de QR Code e retorna dados da credencial.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  if (!token || token.length < 10) {
    return NextResponse.json({ valid: false, error: 'Token inválido.' }, { status: 400 });
  }

  const supabase = createServerClient();

  const { data: qr } = await supabase
    .from('credencial_qr_tokens')
    .select('ministro_id, expires_at')
    .eq('token', token)
    .maybeSingle();

  if (!qr) {
    return NextResponse.json(
      { valid: false, error: 'Token não encontrado.' },
      { status: 404 },
    );
  }

  if (new Date(qr.expires_at) < new Date()) {
    return NextResponse.json(
      { valid: false, error: 'Token expirado.' },
      { status: 410 },
    );
  }

  const { data: ministro } = await supabase
    .from('members')
    .select('id, name, matricula, cargo_ministerial, status, data_validade_credencial, foto_url')
    .eq('id', qr.ministro_id)
    .maybeSingle();

  if (!ministro) {
    return NextResponse.json(
      { valid: false, error: 'Ministro não encontrado.' },
      { status: 404 },
    );
  }

  const hoje = new Date();
  const validade = ministro.data_validade_credencial
    ? new Date(ministro.data_validade_credencial as string)
    : null;

  const statusCredencial: 'ativa' | 'vencida' | 'pendente' = validade
    ? validade >= hoje
      ? 'ativa'
      : 'vencida'
    : 'pendente';

  return NextResponse.json({
    valid: statusCredencial === 'ativa',
    statusCredencial,
    nome: ministro.name,
    matricula: ministro.matricula,
    cargo: ministro.cargo_ministerial,
    statusMembro: ministro.status,
    dataValidade: ministro.data_validade_credencial,
    fotoUrl: ministro.foto_url,
  });
}
