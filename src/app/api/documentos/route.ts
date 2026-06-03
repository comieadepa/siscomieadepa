import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { listMemberFiles, uploadDocumentoDrive } from '@/lib/google-drive';
import { requireModuleAccess, requireUser } from '@/lib/auth/require-auth';
import { hasRole } from '@/lib/auth/roles';

export const dynamic = 'force-dynamic';

const DOCUMENTOS_ROLES = ['super', 'administrador'] as const;
type DocumentoEntityType = 'ministro' | 'candidato_consagracao';

type DocumentAccessResult = Awaited<ReturnType<typeof requireUser>>;

async function resolveOwnerId(memberId: string): Promise<string | null> {
  const admin = createServerClient();
  const { data } = await admin
    .from('members')
    .select('*')
    .eq('id', memberId)
    .maybeSingle();

  const row = data as Record<string, any> | null;
  if (!row) return null;
  return (
    row.user_id ||
    row.auth_user_id ||
    row.owner_id ||
    row.usuario_id ||
    null
  );
}

async function requireDocumentAccess(
  request: NextRequest,
  opts: { entityType: DocumentoEntityType; entityId: string }
): Promise<DocumentAccessResult> {
  if (opts.entityType === 'candidato_consagracao') {
    const authModule = await requireModuleAccess(request, 'secretaria');
    if (authModule.ok) return authModule;

    const auth = await requireUser(request);
    if (!auth.ok) return auth;
    const normalizedRaw = String(auth.ctx.rawRole || '').toLowerCase();
    if (normalizedRaw === 'consagracao_admin') {
      return auth;
    }

    return authModule;
  }

  const auth = await requireUser(request);
  if (!auth.ok) return auth;

  const isAdmin = hasRole(auth.ctx.role, DOCUMENTOS_ROLES);
  const ownerId = await resolveOwnerId(opts.entityId);
  const isOwner = ownerId && ownerId === auth.ctx.user.id;

  if (!isAdmin && !isOwner) {
    return { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }

  return auth;
}

/** GET /api/documentos?memberId=&memberName=&matricula= */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const entityType = (searchParams.get('entityType') || 'ministro') as DocumentoEntityType;
    const entityId = searchParams.get('entityId') || searchParams.get('memberId');
    const memberName = searchParams.get('memberName') || searchParams.get('entityName') || '';
    const matricula = searchParams.get('matricula') || '';

    if (!entityId) {
      return NextResponse.json({ error: 'entityId obrigatório' }, { status: 400 });
    }

    const auth = await requireDocumentAccess(request, { entityType, entityId });
    if (!auth.ok) return auth.response;

    if (entityType === 'candidato_consagracao') {
      const db = createServerClient();
      const { data, error } = await db
        .from('candidato_documentos')
        .select('id, tipo_documento, nome_arquivo, drive_file_id, drive_url, mime_type, tamanho, created_at')
        .eq('candidato_id', entityId)
        .order('created_at', { ascending: false });

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      const files = (data || []).map((row: any) => ({
        id: row.drive_file_id,
        name: row.nome_arquivo,
        mimeType: row.mime_type,
        size: row.tamanho != null ? String(row.tamanho) : undefined,
        createdTime: row.created_at,
        webViewLink: row.drive_url,
      }));

      return NextResponse.json({ files });
    }

    const files = await listMemberFiles(entityId, memberName, matricula);
    return NextResponse.json({ files });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === 'Unauthorized') return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 });
    console.error('[GET /api/documentos]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** POST /api/documentos  (multipart/form-data) */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();

    const file = formData.get('file') as File | null;
    const entityType = ((formData.get('entityType') as string) || 'ministro') as DocumentoEntityType;
    const entityId = (formData.get('entityId') as string) || (formData.get('memberId') as string);
    const entityName = ((formData.get('entityName') as string) || (formData.get('memberName') as string) || '').trim();
    const memberName = entityName;
    const matricula = (formData.get('matricula') as string) || '';
    const tipoDocumento = (formData.get('tipoDocumento') as string) || '';
    const ano = (formData.get('ano') as string) || '';

    if (!file || !entityId) {
      return NextResponse.json({ error: 'file e entityId são obrigatórios' }, { status: 400 });
    }

    const auth = await requireDocumentAccess(request, { entityType, entityId });
    if (!auth.ok) return auth.response;

    const buffer = Buffer.from(await file.arrayBuffer());
    const originalFileName = file.name;

    const result = await uploadDocumentoDrive({
      entidadeTipo: entityType,
      entidadeId: entityId,
      entidadeNome: memberName,
      tipoDocumento,
      fileName: originalFileName,
      mimeType: file.type,
      fileBuffer: buffer,
      matricula,
      ano,
    });

    const fileName = result.name || (tipoDocumento ? `[${tipoDocumento}] ${originalFileName}` : originalFileName);

    if (entityType === 'candidato_consagracao') {
      const db = createServerClient();
      const { error } = await db.from('candidato_documentos').insert({
        candidato_id: entityId,
        tipo_documento: tipoDocumento || 'Outros',
        nome_arquivo: fileName,
        drive_file_id: result.id,
        drive_url: result.webViewLink || null,
        mime_type: result.mimeType || file.type || null,
        tamanho: result.size ? Number(result.size) : null,
        uploaded_by: auth.ctx.user.id,
      });

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({ success: true, file: result });
    }

    // Auto-log no histórico do ministro
    try {
      const db = createServerClient();
      await db.from('member_history').insert({
        member_id: entityId,
        tipo: 'Documento adicionado',
        descricao: `Documento "${fileName}" enviado para o Google Drive.`,
        usuario_id: auth.ctx.user.id,
        ocorrencia: new Date().toISOString().split('T')[0],
      });
    } catch {
      // nao bloqueia o upload se o log falhar
    }

    return NextResponse.json({ success: true, file: result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === 'Unauthorized') return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 });
    console.error('[POST /api/documentos]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
