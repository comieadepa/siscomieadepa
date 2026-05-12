import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { getOrCreateMemberFolder, listMemberFiles, uploadFileToDrive } from '@/lib/google-drive';
import { requireUser } from '@/lib/auth/require-auth';
import { hasRole } from '@/lib/auth/roles';

export const dynamic = 'force-dynamic';

const DOCUMENTOS_ROLES = ['super', 'administrador'] as const;

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
  memberId?: string
): Promise<DocumentAccessResult> {
  const auth = await requireUser(request);
  if (!auth.ok) return auth;

  const isAdmin = hasRole(auth.ctx.role, DOCUMENTOS_ROLES);
  if (!memberId) {
    if (!isAdmin) {
      return { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
    }
    return auth;
  }

  const ownerId = await resolveOwnerId(memberId);
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
    const memberId = searchParams.get('memberId');
    const memberName = searchParams.get('memberName') || '';
    const matricula = searchParams.get('matricula') || '';

    if (!memberId) {
      return NextResponse.json({ error: 'memberId obrigatório' }, { status: 400 });
    }

    const auth = await requireDocumentAccess(request, memberId);
    if (!auth.ok) return auth.response;

    const files = await listMemberFiles(memberId, memberName, matricula);
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
    const memberId = formData.get('memberId') as string;
    const memberName = (formData.get('memberName') as string) || '';
    const matricula = (formData.get('matricula') as string) || '';
    const tipoDocumento = (formData.get('tipoDocumento') as string) || '';

    if (!file || !memberId) {
      return NextResponse.json({ error: 'file e memberId são obrigatórios' }, { status: 400 });
    }

    const auth = await requireDocumentAccess(request, memberId);
    if (!auth.ok) return auth.response;

    const folderId = await getOrCreateMemberFolder(memberId, memberName, matricula);
    const buffer = Buffer.from(await file.arrayBuffer());
    const fileName = tipoDocumento ? `[${tipoDocumento}] ${file.name}` : file.name;

    const result = await uploadFileToDrive(folderId, fileName, file.type, buffer);

    // Auto-log no histórico do ministro
    try {
      const db = createServerClient();
      await db.from('member_history').insert({
        member_id: memberId,
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
