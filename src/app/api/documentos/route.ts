import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { listDocumentosDrive, uploadDocumentoDrive, DocumentoEntidadeTipo, initiateResumableUpload } from '@/lib/google-drive';
import { requireUser } from '@/lib/auth/require-auth';
import { optimizePdf } from '@/services/pdfOptimizer';

export const dynamic = 'force-dynamic';

const DOCUMENTOS_ROLES = ['super', 'administrador'] as const;

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
  memberId: string,
): Promise<{ ok: boolean; response?: NextResponse; ctx?: import('@/lib/auth/require-auth').AuthContext }> {
  const userContext = await requireUser(request);
  if (!userContext.ok) {
    return {
      ok: false,
      response: userContext.response,
    };
  }

  const role = userContext.ctx.role;
  const isInternal = role && DOCUMENTOS_ROLES.includes(role as any);
  if (isInternal) {
    return { ok: true, ctx: userContext.ctx };
  }

  const ownerId = await resolveOwnerId(memberId);
  const isOwner = ownerId && ownerId === userContext.ctx.user.id;
  if (isOwner) {
    return { ok: true, ctx: userContext.ctx };
  }

  return {
    ok: false,
    response: NextResponse.json({ error: 'Acesso negado' }, { status: 403 }),
  };
}

/** GET /api/documentos?memberId=&memberName=&matricula= */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const entityType = (searchParams.get('entityType') as DocumentoEntidadeTipo) || 'ministro';
    const entityId = searchParams.get('entityId') || searchParams.get('memberId');
    const entityName = searchParams.get('entityName') || searchParams.get('memberName') || '';
    const matricula = searchParams.get('matricula') || '';
    const ano = searchParams.get('ano') || undefined;

    if (!entityId) {
      return NextResponse.json({ error: 'entityId e obrigatorio' }, { status: 400 });
    }

    const auth = await requireDocumentAccess(request, entityId);
    if (!auth.ok) return auth.response;

    const files = await listDocumentosDrive(entityType, entityId, entityName, matricula, ano);
    return NextResponse.json({ success: true, files });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === 'Unauthorized') return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 });
    console.error('[GET /api/documentos]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** POST /api/documentos  (multipart/form-data ou JSON de ações) */
export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get('content-type') || '';
    
    // Suporte para fluxo direto sem gargalo de tamanho usando JSON
    if (contentType.includes('application/json')) {
      const body = await request.json();
      const { action } = body;

      if (action === 'initiate') {
        const {
          entityType,
          entityId,
          entityName,
          tipoDocumento,
          fileName,
          mimeType,
          fileSize,
          matricula,
          ano,
        } = body;

        if (!entityId || !fileName || !mimeType || !fileSize) {
          return NextResponse.json({ success: false, error: 'Campos obrigatórios ausentes para iniciar o upload.' }, { status: 400 });
        }

        const auth = await requireDocumentAccess(request, entityId);
        if (!auth.ok) return auth.response;

        const initResult = await initiateResumableUpload({
          entidadeTipo: entityType || 'ministro',
          entidadeId: entityId,
          entidadeNome: entityName || '',
          tipoDocumento,
          fileName,
          mimeType,
          fileSize,
          matricula,
          ano,
        });

        return NextResponse.json({
          success: true,
          uploadUrl: initResult.uploadUrl,
          folderId: initResult.folderId,
          fileName: initResult.fileName,
        });
      }

      if (action === 'metadata') {
        const {
          entityId,
          fileName,
          fileSize,
          originalSize,
          optimizedSize,
          reductionPercentage,
          optimized,
        } = body;

        if (!entityId) {
          return NextResponse.json({ success: false, error: 'entityId é obrigatório para salvar metadados.' }, { status: 400 });
        }

        const auth = await requireDocumentAccess(request, entityId);
        if (!auth.ok) return auth.response;

        // Auto-log no histórico do ministro/candidato
        try {
          const db = createServerClient();
          let logDesc = `Documento "${fileName}" enviado para o Google Drive.`;
          if (optimized) {
            logDesc += ` (Otimizado no navegador: de ${(originalSize / 1024).toFixed(1)} KB para ${(optimizedSize / 1024).toFixed(1)} KB, -${reductionPercentage}%)`;
          }
          await db.from('member_history').insert({
            member_id: entityId,
            tipo: 'Documento adicionado',
            descricao: logDesc,
            usuario_id: auth.ctx!.user.id,
            ocorrencia: new Date().toISOString().split('T')[0],
            arquivo_original_bytes: originalSize || fileSize,
            arquivo_otimizado_bytes: optimizedSize || fileSize,
            percentual_reducao: reductionPercentage || 0,
            processado_em: new Date().toISOString()
          } as any);
        } catch (err) {
          console.error('Erro ao salvar no historico:', err);
        }

        return NextResponse.json({
          success: true,
        });
      }

      return NextResponse.json({ success: false, error: 'Ação desconhecida.' }, { status: 400 });
    }

    // Fallback legado
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const memberId = formData.get('memberId') as string;
    const memberName = (formData.get('memberName') as string) || '';
    const matricula = (formData.get('matricula') as string) || '';
    const tipoDocumento = (formData.get('tipoDocumento') as string) || '';

    const entityType = (formData.get('entityType') as DocumentoEntidadeTipo) || 'ministro';
    const entityId = (formData.get('entityId') as string) || memberId;
    const entityName = (formData.get('entityName') as string) || memberName;
    const anoReferencia = (formData.get('ano') as string) || undefined;

    if (!file || !entityId) {
      return NextResponse.json({ success: false, error: 'file e id são obrigatórios' }, { status: 400 });
    }

    const auth = await requireDocumentAccess(request, entityId);
    if (!auth.ok) return auth.response;

    const buffer = Buffer.from(await file.arrayBuffer());
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

    const result = await uploadDocumentoDrive({
      entidadeTipo: entityType,
      entidadeId: entityId,
      entidadeNome: entityName,
      tipoDocumento: tipoDocumento,
      fileName: file.name,
      mimeType: file.type,
      fileBuffer: finalBuffer,
      matricula: matricula,
      ano: anoReferencia,
    });

    try {
      const db = createServerClient();
      let logDesc = `Documento "${result.name}" enviado para o Google Drive.`;
      if (optimized) {
        logDesc += ` (PDF Otimizado: de ${(originalSize / 1024).toFixed(1)} KB para ${(optimizedSize / 1024).toFixed(1)} KB, -${reductionPercentage}%)`;
      }
      await db.from('member_history').insert({
        member_id: entityId,
        tipo: 'Documento adicionado',
        descricao: logDesc,
        usuario_id: auth.ctx!.user.id,
        ocorrencia: new Date().toISOString().split('T')[0],
        arquivo_original_bytes: originalSize,
        arquivo_otimizado_bytes: optimizedSize,
        percentual_reducao: reductionPercentage,
        processado_em: new Date().toISOString()
      } as any);
    } catch (err) {
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
