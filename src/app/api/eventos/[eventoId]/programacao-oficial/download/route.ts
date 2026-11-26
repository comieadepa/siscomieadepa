import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, createServerClientFromCookies } from '@/lib/supabase-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BUCKET = 'eventos-programacoes';

// GET /api/eventos/[eventoId]/programacao-oficial/download?plenaria_key=...
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ eventoId: string }> }
) {
  try {
    const { eventoId } = await context.params;
    const plenariaKey = req.nextUrl.searchParams.get('plenaria_key') ?? '';
    if (!['ministros', 'aemadepa', 'umadespa'].includes(plenariaKey)) {
      return NextResponse.json({ error: 'Plenária inválida.' }, { status: 400 });
    }

    const userClient = await createServerClientFromCookies();
    const { data: { user } } = await userClient.auth.getUser();
    const isAdmin = !!user;

    const supabase = createServerClient();
    const { data: prog, error } = await supabase
      .from('evento_programacoes_oficiais')
      .select('arquivo_path, arquivo_nome, status')
      .eq('evento_id', eventoId)
      .eq('plenaria_key', plenariaKey)
      .maybeSingle();

    if (error || !prog || !prog.arquivo_path) {
      return NextResponse.json({ error: 'Documento não encontrado.' }, { status: 404 });
    }

    // Impede acesso público aos PDFs em rascunho
    if (!isAdmin && prog.status !== 'publicada') {
      return NextResponse.json({ error: 'Programação ainda não publicada.' }, { status: 403 });
    }

    const { data: signed, error: signErr } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(prog.arquivo_path, 300, {
        download: prog.arquivo_nome || `${plenariaKey}.pdf`,
      });

    if (signErr || !signed?.signedUrl) {
      return NextResponse.json({ error: 'Não foi possível gerar link de download.' }, { status: 500 });
    }

    return NextResponse.redirect(signed.signedUrl);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Erro ao baixar documento' }, { status: 500 });
  }
}
