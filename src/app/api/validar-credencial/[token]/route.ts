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

  const { data: ministro, error: mErr } = await supabase
    .from('members')
    .select('id, name, matricula, cargo_ministerial, status, cred_validade, foto_url, custom_fields')
    .eq('id', qr.ministro_id)
    .maybeSingle();

  if (mErr || !ministro) {
    return NextResponse.json(
      { valid: false, error: 'Ministro não encontrado.' },
      { status: 404 },
    );
  }

  const cf = (ministro.custom_fields && typeof ministro.custom_fields === 'object')
    ? (ministro.custom_fields as Record<string, any>)
    : {};

  const validadeStr = (ministro.cred_validade || cf.dataValidadeCredencial || cf.validade || null) as string | null;
  const validade = validadeStr ? new Date(validadeStr) : null;
  const hoje = new Date();

  const isAtivo = ministro.status === 'active';
  const statusCredencial: 'ativa' | 'vencida' | 'pendente' = validade
    ? validade >= hoje
      ? isAtivo ? 'ativa' : 'vencida'
      : 'vencida'
    : 'pendente';

  return NextResponse.json({
    valid: statusCredencial === 'ativa' && isAtivo,
    statusCredencial,
    nome: ministro.name,
    matricula: ministro.matricula || cf.matricula || null,
    cargo: ministro.cargo_ministerial || cf.cargoMinisterial || null,
    statusMembro: ministro.status,
    dataValidade: validadeStr,
    fotoUrl: ministro.foto_url || cf.fotoUrl || null,
  });
}
