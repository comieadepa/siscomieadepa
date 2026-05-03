/**
 * API pública — Busca dados do ministro pelo unique_id para exibir credencial digital.
 * GET /api/credencial/[uid]
 * Não requer autenticação — o unique_id é o "token" de acesso.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ uid: string }> }
) {
  const { uid: uidRaw } = await params;
  const uid = uidRaw?.trim();
  if (!uid || uid.length < 8) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('members')
    .select('id, unique_id, name, matricula, cargo_ministerial, tipo_sanguineo, data_nascimento, foto_url, custom_fields, status, data_validade_credencial, data_consagracao')
    .eq('unique_id', uid)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: 'Ministro não encontrado' }, { status: 404 });
  }

  if (data.status === 'inactive' || data.status === 'deceased') {
    return NextResponse.json({ error: 'Credencial inativa' }, { status: 403 });
  }

  const cf = (data.custom_fields && typeof data.custom_fields === 'object') ? data.custom_fields as Record<string, any> : {};

  return NextResponse.json({
    id: data.id,
    uniqueId: data.unique_id,
    nome: String(data.name || ''),
    matricula: String(data.matricula || cf.matricula || ''),
    cargo: String(data.cargo_ministerial || cf.cargoMinisterial || cf.cargo_ministerial || ''),
    tipoSanguineo: String(data.tipo_sanguineo || cf.tipoSanguineo || ''),
    dataNascimento: String(data.data_nascimento || cf.dataNascimento || ''),
    dataConsagracao: String(data.data_consagracao || cf.dataConsagracao || ''),
    dataValidade: String(data.data_validade_credencial || cf.dataValidadeCredencial || cf.validade || ''),
    fotoUrl: data.foto_url || cf.fotoUrl || null,
    supervisao: String(cf.supervisao || ''),
    campo: String(cf.campo || ''),
    congregacao: String(cf.congregacao || ''),
    status: data.status,
  });
}
