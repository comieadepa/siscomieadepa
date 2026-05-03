import { NextRequest, NextResponse } from 'next/server';
import { createServerClientFromRequest } from '@/lib/supabase-server';
import { deleteFileFromDrive, getDriveStream } from '@/lib/google-drive';

export const dynamic = 'force-dynamic';

async function requireAuth(request: NextRequest) {
  const supabase = createServerClientFromRequest(request);
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error('Unauthorized');
  return data.user;
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
    await requireAuth(request);
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
    if (msg === 'Unauthorized') return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
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
    await requireAuth(request);
    const { fileId } = await params;

    if (!fileId) {
      return NextResponse.json({ error: 'fileId obrigatório' }, { status: 400 });
    }

    await deleteFileFromDrive(fileId);
    return NextResponse.json({ success: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === 'Unauthorized') return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    console.error('[DELETE /api/documentos/[fileId]]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
