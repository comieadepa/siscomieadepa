import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { createServerClient, createServerClientFromCookies, createServerClientFromRequest } from '@/lib/supabase-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BUCKET = 'eventos-programacoes';
const MAX_PDF_BYTES = 4 * 1024 * 1024; // 4MB (compatível com limite serverless da Vercel)

export const PLENARIAS_OFICIAIS = [
  { key: 'ministros', nome: 'Plenária dos Ministros' },
  { key: 'aemadepa', nome: 'Plenária da AEMADEPA' },
  { key: 'umadespa', nome: 'Plenária da Juventude — UMADESPA' },
] as const;

type PlenariaKey = (typeof PLENARIAS_OFICIAIS)[number]['key'];

function isPlenariaValida(key: string): key is PlenariaKey {
  return PLENARIAS_OFICIAIS.some(p => p.key === key);
}

function getPlenariaNome(key: PlenariaKey): string {
  return PLENARIAS_OFICIAIS.find(p => p.key === key)?.nome ?? key;
}

async function ensureBucket(supabaseAdmin: any) {
  try {
    const { data, error } = await supabaseAdmin.storage.listBuckets();
    if (error) return;
    const exists = Array.isArray(data) && data.some((b: any) => b?.name === BUCKET);
    if (exists) return;
    await supabaseAdmin.storage.createBucket(BUCKET, {
      public: true,
      fileSizeLimit: String(MAX_PDF_BYTES),
      allowedMimeTypes: ['application/pdf'],
    });
  } catch {
    // best-effort
  }
}

async function extrairTextoPdf(buffer: Buffer): Promise<string> {
  const { extractText } = await import('unpdf');
  const res = await extractText(new Uint8Array(buffer), { mergePages: true });
  const textoFinal = String(res?.text ?? '');

  return textoFinal
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// GET /api/eventos/[eventoId]/programacao-oficial
export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ eventoId: string }> }
) {
  try {
    const { eventoId } = await context.params;
    const userClient = await createServerClientFromCookies();
    const { data: { user } } = await userClient.auth.getUser();
    const isAdmin = !!user;

    const supabase = createServerClient();
    let query = supabase
      .from('evento_programacoes_oficiais')
      .select('*')
      .eq('evento_id', eventoId);

    if (!isAdmin) {
      query = query.eq('status', 'publicada');
    }

    const { data: rows, error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const byKey = new Map((rows ?? []).map((r: any) => [r.plenaria_key, r]));
    const plenarias = PLENARIAS_OFICIAIS.map(p => {
      const row = byKey.get(p.key);
      if (!row) {
        return {
          evento_id: eventoId,
          plenaria_key: p.key,
          plenaria_nome: p.nome,
          status: 'sem_programacao',
          arquivo_nome: null,
          arquivo_url: null,
          arquivo_tamanho: null,
          texto_extraido: '',
          publicado_em: null,
          updated_at: null,
        };
      }
      return {
        ...row,
        arquivo_url: row.arquivo_path
          ? `/api/eventos/${eventoId}/programacao-oficial/download?plenaria_key=${p.key}`
          : null,
      };
    });

    return NextResponse.json({ plenarias });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Erro ao consultar programações' }, { status: 500 });
  }
}

// POST /api/eventos/[eventoId]/programacao-oficial
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ eventoId: string }> }
) {
  try {
    const { eventoId } = await context.params;
    let user = null;
    const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
    if (authHeader) {
      const clientFromReq = createServerClientFromRequest(req);
      const { data } = await clientFromReq.auth.getUser();
      user = data.user;
    }
    if (!user) {
      const userClient = await createServerClientFromCookies();
      const { data } = await userClient.auth.getUser();
      user = data.user;
    }
    if (!user) {
      return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
    }

    const supabase = createServerClient();
    const contentType = req.headers.get('content-type') || '';

    // 1. Upload de PDF + Extração automática
    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      const plenariaKey = String(formData.get('plenaria_key') ?? '').trim();
      const file = formData.get('file') as File | null;
      const publicar = String(formData.get('publicar') ?? 'false') === 'true';

      if (!isPlenariaValida(plenariaKey)) {
        return NextResponse.json({ error: 'Plenária inválida.' }, { status: 400 });
      }
      if (!file) {
        return NextResponse.json({ error: 'Arquivo PDF não enviado.' }, { status: 400 });
      }
      if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
        return NextResponse.json({ error: 'Formato inválido. Envie apenas arquivos PDF.' }, { status: 400 });
      }
      if (file.size <= 0 || file.size > MAX_PDF_BYTES) {
        return NextResponse.json({ error: 'Tamanho inválido. O PDF deve ter até 4MB.' }, { status: 400 });
      }

      // Garante exclusividade para eventos AGO
      const { data: evCheck } = await supabase
        .from('eventos')
        .select('id, departamento')
        .eq('id', eventoId)
        .maybeSingle();
      if (!evCheck || evCheck.departamento !== 'AGO') {
        return NextResponse.json({ error: 'Programação Oficial disponível apenas para eventos do tipo AGO.' }, { status: 400 });
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      // Validação de assinatura mágica %PDF-
      if (buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
        return NextResponse.json({ error: 'O arquivo enviado não é um PDF válido.' }, { status: 400 });
      }

      let textoExtraido = '';
      try {
        textoExtraido = await extrairTextoPdf(buffer);
      } catch (pdfErr: any) {
        return NextResponse.json(
          { error: `Não foi possível extrair texto do PDF: ${pdfErr?.message || 'arquivo corrompido ou protegido'}` },
          { status: 422 }
        );
      }

      if (!textoExtraido || textoExtraido.length < 10) {
        return NextResponse.json(
          { error: 'O PDF não contém texto selecionável suficiente para extração. Verifique se não é apenas uma imagem escaneada.' },
          { status: 422 }
        );
      }

      await ensureBucket(supabase);

      // Busca registro anterior (para preservar status publicado se já estiver publicada e só remover arquivo antigo após sucesso)
      const { data: anterior } = await supabase
        .from('evento_programacoes_oficiais')
        .select('arquivo_path, status, publicado_em')
        .eq('evento_id', eventoId)
        .eq('plenaria_key', plenariaKey)
        .maybeSingle();

      const storagePath = `${eventoId}/${plenariaKey}/${Date.now()}-${randomUUID()}.pdf`;
      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(storagePath, buffer, { contentType: 'application/pdf', upsert: true });

      if (uploadError) {
        return NextResponse.json({ error: uploadError.message }, { status: 400 });
      }

      const { data: publicData } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
      const nowIso = new Date().toISOString();
      const jaPublicada = anterior?.status === 'publicada';
      const novoStatus = publicar || jaPublicada ? 'publicada' : 'rascunho';

      const { data: saved, error: upsertErr } = await supabase
        .from('evento_programacoes_oficiais')
        .upsert(
          {
            evento_id: eventoId,
            plenaria_key: plenariaKey,
            plenaria_nome: getPlenariaNome(plenariaKey),
            status: novoStatus,
            arquivo_nome: file.name,
            arquivo_path: storagePath,
            arquivo_url: publicData?.publicUrl ?? null,
            arquivo_tamanho: file.size,
            texto_extraido: textoExtraido,
            atualizado_por: user.id,
            publicado_em: publicar ? nowIso : (anterior?.publicado_em ?? null),
            updated_at: nowIso,
          },
          { onConflict: 'evento_id,plenaria_key' }
        )
        .select('*')
        .single();

      if (upsertErr) {
        await supabase.storage.from(BUCKET).remove([storagePath]).catch(() => null);
        return NextResponse.json({ error: upsertErr.message }, { status: 500 });
      }

      if (anterior?.arquivo_path && anterior.arquivo_path !== storagePath) {
        await supabase.storage.from(BUCKET).remove([anterior.arquivo_path]).catch(() => null);
      }

      return NextResponse.json({ programacao: saved });
    }

    // 2. Edição de texto extraído / publicação via JSON
    const body = await req.json();
    const plenariaKey = String(body?.plenaria_key ?? '').trim();
    if (!isPlenariaValida(plenariaKey)) {
      return NextResponse.json({ error: 'Plenária inválida.' }, { status: 400 });
    }

    const statusReq = body?.status as string | undefined;
    const textoReq = typeof body?.texto_extraido === 'string' ? body.texto_extraido.trim() : undefined;
    const nowIso = new Date().toISOString();

    const updatePayload: Record<string, unknown> = {
      evento_id: eventoId,
      plenaria_key: plenariaKey,
      plenaria_nome: getPlenariaNome(plenariaKey),
      atualizado_por: user.id,
      updated_at: nowIso,
    };

    if (textoReq !== undefined) {
      updatePayload.texto_extraido = textoReq;
    }
    if (statusReq && ['rascunho', 'publicada'].includes(statusReq)) {
      updatePayload.status = statusReq;
      if (statusReq === 'publicada') {
        updatePayload.publicado_em = nowIso;
      }
    }

    const { data: saved, error: upsertErr } = await supabase
      .from('evento_programacoes_oficiais')
      .upsert(updatePayload, { onConflict: 'evento_id,plenaria_key' })
      .select('*')
      .single();

    if (upsertErr) {
      return NextResponse.json({ error: upsertErr.message }, { status: 500 });
    }

    return NextResponse.json({ programacao: saved });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Erro ao salvar programação' }, { status: 500 });
  }
}

// DELETE /api/eventos/[eventoId]/programacao-oficial?plenaria_key=...
export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ eventoId: string }> }
) {
  try {
    const { eventoId } = await context.params;
    let user = null;
    const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
    if (authHeader) {
      const clientFromReq = createServerClientFromRequest(req);
      const { data } = await clientFromReq.auth.getUser();
      user = data.user;
    }
    if (!user) {
      const userClient = await createServerClientFromCookies();
      const { data } = await userClient.auth.getUser();
      user = data.user;
    }
    if (!user) {
      return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
    }

    const plenariaKey = req.nextUrl.searchParams.get('plenaria_key') ?? '';
    if (!isPlenariaValida(plenariaKey)) {
      return NextResponse.json({ error: 'Plenária inválida.' }, { status: 400 });
    }

    const supabase = createServerClient();
    const { data: atual } = await supabase
      .from('evento_programacoes_oficiais')
      .select('arquivo_path')
      .eq('evento_id', eventoId)
      .eq('plenaria_key', plenariaKey)
      .maybeSingle();

    if (atual?.arquivo_path) {
      await supabase.storage.from(BUCKET).remove([atual.arquivo_path]).catch(() => null);
    }

    const { error: delErr } = await supabase
      .from('evento_programacoes_oficiais')
      .delete()
      .eq('evento_id', eventoId)
      .eq('plenaria_key', plenariaKey);

    if (delErr) {
      return NextResponse.json({ error: delErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Erro ao remover programação' }, { status: 500 });
  }
}
