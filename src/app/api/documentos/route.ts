import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { getOrCreateMemberFolder, listMemberFiles, uploadFileToDrive } from '@/lib/google-drive';
import { requireUser } from '@/lib/auth/require-auth';
import { hasRole } from '@/lib/auth/roles';
import { optimizePdf } from '@/services/pdfOptimizer';

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
    // Validar por content-length para evitar carregar arquivo gigante na memória
    const contentLength = Number(request.headers.get('content-length') || '0');
    if (contentLength > 100 * 1024 * 1024) {
      return NextResponse.json(
        { success: false, error: 'Arquivo excede o limite de 100 MB.' },
        { status: 413 }
      );
    }

    // TODO: Suportar uploads em chunks/resumable no Google Drive para arquivos acima de 100 MB se necessário no futuro.

    const formData = await request.formData();

    const file = formData.get('file') as File | null;
    const memberId = formData.get('memberId') as string;
    const memberName = (formData.get('memberName') as string) || '';
    const matricula = (formData.get('matricula') as string) || '';
    const tipoDocumento = (formData.get('tipoDocumento') as string) || '';

    if (!file || !memberId) {
      return NextResponse.json({ success: false, error: 'file e memberId são obrigatórios' }, { status: 400 });
    }

    if (file.size > 100 * 1024 * 1024) {
      return NextResponse.json(
        { success: false, error: 'Arquivo excede o limite de 100 MB.' },
        { status: 413 }
      );
    }

    const auth = await requireDocumentAccess(request, memberId);
    if (!auth.ok) return auth.response;

    const folderId = await getOrCreateMemberFolder(memberId, memberName, matricula);
    const buffer = Buffer.from(await file.arrayBuffer());
    const fileName = tipoDocumento ? `[${tipoDocumento}] ${file.name}` : file.name;

    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    let finalBuffer: any = buffer;
    let originalSize = buffer.length;
    let optimizedSize = buffer.length;
    let reductionPercentage = 0;
    let optimized = false;

    if (isPdf) {
      const optResult = await optimizePdf(buffer);
      if (optResult.success) {
        finalBuffer = Buffer.from(optResult.optimizedBuffer);
        originalSize = optResult.originalSize;
        optimizedSize = optResult.optimizedSize;
        reductionPercentage = optResult.reductionPercentage;
        optimized = true;
      }
    }

    const result = await uploadFileToDrive(folderId, fileName, file.type, finalBuffer);

    // Auto-log no histórico do ministro
    try {
      const db = createServerClient();
      let logDesc = `Documento "${fileName}" enviado para o Google Drive.`;
      if (optimized) {
        logDesc += ` (PDF Otimizado: de ${(originalSize / 1024).toFixed(1)} KB para ${(optimizedSize / 1024).toFixed(1)} KB, -${reductionPercentage}%)`;
      }
      await db.from('member_history').insert({
        member_id: memberId,
        tipo: 'Documento adicionado',
        descricao: logDesc,
        usuario_id: auth.ctx.user.id,
        ocorrencia: new Date().toISOString().split('T')[0],
        // Também adicionamos os metadados opcionais para que fiquem gravados
        arquivo_original_bytes: originalSize,
        arquivo_otimizado_bytes: optimizedSize,
        percentual_reducao: reductionPercentage,
        processado_em: new Date().toISOString()
      } as any);
    } catch (err) {
      // nao bloqueia o upload se o log falhar
      console.error('Erro ao salvar no historico:', err);
    }

    return NextResponse.json({
      success: true,
      file: result,
      originalSize,
      optimizedSize,
      reductionPercentage,
      optimized
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === 'Unauthorized') return NextResponse.json({ success: false, error: 'Nao autorizado' }, { status: 401 });
    console.error('[POST /api/documentos]', msg);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
