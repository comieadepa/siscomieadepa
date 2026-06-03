import { NextRequest, NextResponse } from 'next/server';
import { deleteFileFromDrive, getDriveStream } from '@/lib/google-drive';
import { requireUser } from '@/lib/auth/require-auth';
import { canAccessModule, hasRole } from '@/lib/auth/roles';
import { createServerClient } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

const DOCUMENTOS_ROLES = ['super', 'administrador'] as const;

async function requireDriveFileAccess(request: NextRequest) {
  const auth = await requireUser(request);
  if (!auth.ok) return auth;

  const isAdmin = hasRole(auth.ctx.role, DOCUMENTOS_ROLES);
  const secretariaAccess = canAccessModule(auth.ctx.role, 'secretaria');
  const rawRole = String(auth.ctx.rawRole || '').toLowerCase();
  const isConsagracaoAdmin = rawRole === 'consagracao_admin';

  if (!isAdmin && !secretariaAccess && !isConsagracaoAdmin) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    };
  }

  return auth;
}

/**
 * GET /api/documentos/[fileId]
 * Streaming proxy — não armazena nada, só passa o conteúdo do Drive para o browser.
 * PDFs e imagens abrem nativamente no browser.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ fileId: string }> },
) {
  try {
    const auth = await requireDriveFileAccess(request);
    if (!auth.ok) return auth.response;
    const { fileId } = await params;

    if (!fileId) {
      return NextResponse.json({ error: 'fileId obrigatório' }, { status: 400 });
    }

    const { stream, mimeType, fileName } = await getDriveStream(fileId);

    const headers: Record<string, string> = {
      'Content-Type': mimeType,
      'Cache-Control': 'private, max-age=300',
    };

    // inline: abre no browser (PDF/imagem); attachment: força download para outros tipos
    const isViewable = mimeType.startsWith('image/') || mimeType === 'application/pdf';
    const disposition = isViewable
      ? `inline; filename="${encodeURIComponent(fileName)}"`
      : `attachment; filename="${encodeURIComponent(fileName)}"`;
    headers['Content-Disposition'] = disposition;

    return new NextResponse(stream as unknown as ReadableStream, { headers });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === 'Unauthorized') return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 });
    console.error('[GET /api/documentos/[fileId]]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** DELETE /api/documentos/[fileId] */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ fileId: string }> },
) {
  try {
    const auth = await requireDriveFileAccess(request);
    if (!auth.ok) return auth.response;
    const { fileId } = await params;
    const { searchParams } = new URL(request.url);
    const entityType = searchParams.get('entityType') || 'ministro';
    const entityId = searchParams.get('entityId') || '';

    if (!fileId) {
      return NextResponse.json({ error: 'fileId obrigatório' }, { status: 400 });
    }

    await deleteFileFromDrive(fileId);

    if (entityType === 'candidato_consagracao') {
      const db = createServerClient();
      let query = db.from('candidato_documentos').delete().eq('drive_file_id', fileId);
      if (entityId) query = query.eq('candidato_id', entityId);
      await query;
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === 'Unauthorized') return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 });
    console.error('[DELETE /api/documentos/[fileId]]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
