/**
 * API pública — Busca dados do ministro pelo unique_id para exibir credencial digital.
 * GET /api/credencial/[uid]
 * GET /api/credencial/[uid]?debug=1  → retorna diagnóstico completo (remover em produção)
 * Não requer autenticação — o unique_id é o "token" de acesso.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const SELECT_COLS = 'id, unique_id, name, matricula, cargo_ministerial, tipo_sanguineo, data_nascimento, foto_url, custom_fields, status, cred_validade, orden_pastor_data, ev_consagrado_data, cons_missionario_data, ev_autorizado_data, rg, cpf, naturalidade, numero_cgadb, nome_pai, nome_mae';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ uid: string }> }
) {
  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const { uid: uidRaw } = await params;
  const uid = uidRaw?.trim();
  const isDebug = req.nextUrl.searchParams.get('debug') === '1';

  if (!uid || uid.length < 8) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 400 });
  }

  // Classificação do código recebido para escolher a estratégia de busca
  const isUuid    = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uid);
  const isHex16   = /^[0-9a-f]{16}$/i.test(uid);
  // Código legado Bubble: {timestamp_ms}x{dígitos}  ex: 1732376890397x648561853352979600
  const isBubble  = /^\d{10,}x\d+$/.test(uid);

  let data: any = null;
  const log: Array<{ estrategia: string; encontrado: boolean; erro?: string }> = [];

  // ─── Estratégia 1: coluna unique_id (todos os tipos) ─────────────────────
  {
    const r = await supabaseAdmin.from('members').select(SELECT_COLS).eq('unique_id', uid).maybeSingle();
    log.push({ estrategia: 'unique_id = uid', encontrado: !!r.data, erro: r.error?.message });
    if (r.data) data = r.data;
  }

  // ─── Estratégia 2: UUID completo por id ──────────────────────────────────
  if (!data && isUuid) {
    const r = await supabaseAdmin.from('members').select(SELECT_COLS).eq('id', uid).maybeSingle();
    log.push({ estrategia: 'id = uid (UUID)', encontrado: !!r.data, erro: r.error?.message });
    if (r.data) data = r.data;
  }

  // ─── Estratégia 3: stableUniqueId HEX-16 derivado do UUID ────────────────
  if (!data && isHex16) {
    const uuidPrefix = `${uid.slice(0,8)}-${uid.slice(8,12)}-${uid.slice(12,16)}`;
    const r = await supabaseAdmin.from('members').select(SELECT_COLS).ilike('id', `${uuidPrefix}%`).maybeSingle();
    log.push({ estrategia: `id ilike '${uuidPrefix}%' (hex16)`, encontrado: !!r.data, erro: r.error?.message });
    if (r.data) data = r.data;
  }

  // ─── Estratégias 4-7: Bubble / legado — busca em custom_fields ───────────
  if (!data && isBubble) {
    // 4a: custom_fields->>'uniqueId' (camelCase — importação padrão do Bubble)
    {
      const r = await supabaseAdmin.from('members').select(SELECT_COLS)
        .filter('custom_fields->>uniqueId', 'eq', uid).maybeSingle();
      log.push({ estrategia: "custom_fields->>'uniqueId' (camelCase)", encontrado: !!r.data, erro: r.error?.message });
      if (r.data) data = r.data;
    }

    // 4b: custom_fields->>'unique_id' (snake_case)
    if (!data) {
      const r = await supabaseAdmin.from('members').select(SELECT_COLS)
        .filter('custom_fields->>unique_id', 'eq', uid).maybeSingle();
      log.push({ estrategia: "custom_fields->>'unique_id' (snake_case)", encontrado: !!r.data, erro: r.error?.message });
      if (r.data) data = r.data;
    }

    // 4c: custom_fields->>'bubbleId'
    if (!data) {
      const r = await supabaseAdmin.from('members').select(SELECT_COLS)
        .filter('custom_fields->>bubbleId', 'eq', uid).maybeSingle();
      log.push({ estrategia: "custom_fields->>'bubbleId'", encontrado: !!r.data, erro: r.error?.message });
      if (r.data) data = r.data;
    }

    // 4d: busca ampla — qualquer chave no JSONB que contenha o código
    //     (último recurso; cobre qualquer nome de campo que possa ter sido usado)
    if (!data) {
      const r = await supabaseAdmin.from('members').select(SELECT_COLS)
        .filter('custom_fields::text', 'ilike', `%${uid}%`).maybeSingle();
      log.push({ estrategia: 'custom_fields::text ilike (busca ampla)', encontrado: !!r.data, erro: r.error?.message });
      if (r.data) data = r.data;
    }
  }

  // ─── Debug: retorna diagnóstico completo ─────────────────────────────────
  if (isDebug) {
    return NextResponse.json({
      uid_recebido: uid,
      comprimento: uid.length,
      tipo_detectado: isUuid ? 'UUID' : isHex16 ? 'HEX16' : isBubble ? 'BUBBLE_LEGACY' : 'DESCONHECIDO',
      encontrado: !!data,
      membro_id: data?.id ?? null,
      membro_nome: data?.name ?? null,
      unique_id_no_banco: data?.unique_id ?? null,
      custom_fields_uniqueId: (data?.custom_fields as any)?.uniqueId ?? null,
      estrategias: log,
    });
  }

  if (!data) {
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

  const filiacao = data.filiacao || data.nome_pai || data.nome_mae
    ? [data.nome_pai, data.nome_mae].filter(Boolean).join(' / ') || data.filiacao || ''
    : cf.filiacao || cf.nomePai || cf.nomeMae
    ? [cf.nomePai, cf.nomeMae].filter(Boolean).join(' / ') || cf.filiacao || ''
    : '';

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
    // Campos do verso
    rg: String(data.rg || cf.rg || cf.numeroRg || cf.documentoRg || ''),
    cpf: String(data.cpf || cf.cpf || ''),
    naturalidade: String(data.naturalidade || cf.naturalidade || cf.cidadeNascimento || ''),
    registroCgadb: String(data.numero_cgadb || cf.registroCgadb || cf.cgadb || cf.numeroCgadb || ''),
    filiacao: String(filiacao),
  });
}
