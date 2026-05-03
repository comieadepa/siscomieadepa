import { NextRequest, NextResponse } from 'next/server';
import { createServerClientFromRequest, createServerClient } from '@/lib/supabase-server';
import { getOrCreateMemberFolder, listMemberFiles, uploadFileToDrive } from '@/lib/google-drive';

export const dynamic = 'force-dynamic';

async function requireAuth(request: NextRequest) {
  const supabase = createServerClientFromRequest(request);
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error('Unauthorized');
  return data.user;
}

/** GET /api/documentos?memberId=&memberName=&matricula= */
export async function GET(request: NextRequest) {
  try {
    await requireAuth(request);
    const { searchParams } = new URL(request.url);
    const memberId = searchParams.get('memberId');
    const memberName = searchParams.get('memberName') || '';
    const matricula = searchParams.get('matricula') || '';

    if (!memberId) {
      return NextResponse.json({ error: 'memberId obrigatório' }, { status: 400 });
    }

    const files = await listMemberFiles(memberId, memberName, matricula);
    return NextResponse.json({ files });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === 'Unauthorized') return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    console.error('[GET /api/documentos]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** POST /api/documentos  (multipart/form-data) */
export async function POST(request: NextRequest) {
  try {
    await requireAuth(request);
    const formData = await request.formData();

    const file = formData.get('file') as File | null;
    const memberId = formData.get('memberId') as string;
    const memberName = (formData.get('memberName') as string) || '';
    const matricula = (formData.get('matricula') as string) || '';
    const tipoDocumento = (formData.get('tipoDocumento') as string) || '';

    if (!file || !memberId) {
      return NextResponse.json({ error: 'file e memberId são obrigatórios' }, { status: 400 });
    }

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
        usuario_id: (await createServerClientFromRequest(request).auth.getUser()).data.user?.id ?? null,
        ocorrencia: new Date().toISOString().split('T')[0],
      });
    } catch { /* não bloqueia o upload se o log falhar */ }

    return NextResponse.json({ success: true, file: result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === 'Unauthorized') return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    console.error('[POST /api/documentos]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
