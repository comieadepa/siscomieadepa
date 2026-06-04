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
    .select('id, unique_id, name, matricula, cargo_ministerial, tipo_sanguineo, data_nascimento, foto_url, custom_fields, status, cred_validade, orden_pastor_data, ev_consagrado_data, cons_missionario_data, ev_autorizado_data')
    .eq('unique_id', uid)
    .maybeSingle();

  if (byUniqueId.data) {
    data = byUniqueId.data;
  } else {
    // Fallback 1: UUID completo com hífens (ex: 550e8400-e29b-41d4-a716-446655440000)
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uid);
    // Fallback 2: stableUniqueId — front-end deriva 16 chars HEX do UUID quando unique_id é NULL
    //   formula: UPPER(id.replace(/-/g,'').slice(0,16))
    //   ex: UUID 550e8400-e29b-41d4-... → '550E8400E29B41D4'
    const isHex16 = /^[0-9a-f]{16}$/i.test(uid);

    if (isUuid) {
      const byId = await supabaseAdmin
        .from('members')
        .select('id, unique_id, name, matricula, cargo_ministerial, tipo_sanguineo, data_nascimento, foto_url, custom_fields, status, cred_validade, orden_pastor_data, ev_consagrado_data, cons_missionario_data, ev_autorizado_data')
        .eq('id', uid)
        .maybeSingle();
      data = byId.data;
      error = byId.error;
    } else if (isHex16) {
      // Reconstrói o prefixo do UUID (primeiros 16 chars sem hífens → 8-4-4)
      const uuidPrefix = `${uid.slice(0,8)}-${uid.slice(8,12)}-${uid.slice(12,16)}`;
      const byHex = await supabaseAdmin
        .from('members')
        .select('id, unique_id, name, matricula, cargo_ministerial, tipo_sanguineo, data_nascimento, foto_url, custom_fields, status, cred_validade, orden_pastor_data, ev_consagrado_data, cons_missionario_data, ev_autorizado_data')
        .ilike('id', `${uuidPrefix}%`)
        .maybeSingle();
      data = byHex.data;
      error = byHex.error;
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
  // data_consagracao não é coluna de members; lê dos campos específicos de cargo ou custom_fields
  const cargo = String(data.cargo_ministerial || cf.cargoMinisterial || '');
  const cargoNorm = cargo.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const dataConsagracao =
    cargoNorm === 'pastor'
      ? data.orden_pastor_data || cf.ordenPastorData || cf.dataConsagracao || ''
      : cargoNorm === 'missionario' || cargoNorm === 'missionaria'
      ? data.cons_missionario_data || cf.consMissionarioData || cf.dataConsagracao || ''
      : cargoNorm === 'evangelista'
      ? data.ev_consagrado_data || cf.evConsagradoData || cf.dataConsagracao || ''
      : data.ev_autorizado_data || data.ev_consagrado_data || cf.dataConsagracao || '';

  return NextResponse.json({
    id: data.id,
    uniqueId: data.unique_id,
    nome: String(data.name || ''),
    matricula: String(data.matricula || cf.matricula || ''),
    cargo: String(cargo),
    tipoSanguineo: String(data.tipo_sanguineo || cf.tipoSanguineo || ''),
    dataNascimento: String(data.data_nascimento || cf.dataNascimento || ''),
    dataConsagracao: String(dataConsagracao),
    dataValidade: String(data.cred_validade || cf.dataValidadeCredencial || cf.validade || ''),
    fotoUrl: data.foto_url || cf.fotoUrl || null,
    supervisao: String(cf.supervisao || ''),
    campo: String(cf.campo || ''),
    congregacao: String(cf.congregacao || ''),
    status: data.status,
  });
}
