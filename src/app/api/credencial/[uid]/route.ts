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

  // Tenta primeiro por unique_id, depois por id (UUID) como fallback
  // (cartões impressos antes de unique_id ser preenchido usam o UUID como QR)
  let data: any = null;
  let error: any = null;

  const byUniqueId = await supabaseAdmin
    .from('members')
    .select('id, unique_id, name, matricula, cargo_ministerial, tipo_sanguineo, data_nascimento, foto_url, custom_fields, status, data_validade_credencial, data_consagracao, orden_pastor_data, ev_consagrado_data, cons_missionario_data, ev_autorizado_data')
    .eq('unique_id', uid)
    .maybeSingle();

  if (byUniqueId.data) {
    data = byUniqueId.data;
  } else {
    // Tenta por UUID (id) — válido apenas se o uid tiver formato de UUID
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uid);
    if (isUuid) {
      const byId = await supabaseAdmin
        .from('members')
        .select('id, unique_id, name, matricula, cargo_ministerial, tipo_sanguineo, data_nascimento, foto_url, custom_fields, status, data_validade_credencial, data_consagracao, orden_pastor_data, ev_consagrado_data, cons_missionario_data, ev_autorizado_data')
        .eq('id', uid)
        .maybeSingle();
      data = byId.data;
      error = byId.error;
    } else {
      error = byUniqueId.error;
    }
  }

  if (error || !data) {
    return NextResponse.json({ error: 'Ministro não encontrado' }, { status: 404 });
  }

  if (data.status === 'inactive' || data.status === 'deceased') {
    return NextResponse.json({ error: 'Credencial inativa' }, { status: 403 });
  }

  const cf = (data.custom_fields && typeof data.custom_fields === 'object') ? data.custom_fields as Record<string, any> : {};

  // Seleciona a data de consagração correta conforme o cargo
  const cargo = String(data.cargo_ministerial || cf.cargoMinisterial || '');
  const cargoNorm = cargo.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const dataConsagracao =
    cargoNorm === 'pastor'
      ? data.orden_pastor_data || data.data_consagracao || cf.dataConsagracao || ''
      : cargoNorm === 'missionario' || cargoNorm === 'missionaria'
      ? data.cons_missionario_data || data.data_consagracao || cf.dataConsagracao || ''
      : cargoNorm === 'evangelista'
      ? data.ev_consagrado_data || data.data_consagracao || cf.dataConsagracao || ''
      : data.ev_autorizado_data || data.ev_consagrado_data || data.data_consagracao || cf.dataConsagracao || '';

  return NextResponse.json({
    id: data.id,
    uniqueId: data.unique_id,
    nome: String(data.name || ''),
    matricula: String(data.matricula || cf.matricula || ''),
    cargo: String(cargo),
    tipoSanguineo: String(data.tipo_sanguineo || cf.tipoSanguineo || ''),
    dataNascimento: String(data.data_nascimento || cf.dataNascimento || ''),
    dataConsagracao: String(dataConsagracao),
    dataValidade: String(data.data_validade_credencial || cf.dataValidadeCredencial || cf.validade || ''),
    fotoUrl: data.foto_url || cf.fotoUrl || null,
    supervisao: String(cf.supervisao || ''),
    campo: String(cf.campo || ''),
    congregacao: String(cf.congregacao || ''),
    status: data.status,
  });
}
