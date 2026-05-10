import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, createServerClientFromCookies } from '@/lib/supabase-server';

// GET /api/eventos/[eventoId]/certificado-config
// Público — necessário para página de download de certificado
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('evento_certificado_config')
    .select('*')
    .eq('evento_id', eventoId)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ config: data ?? null });
}

// POST /api/eventos/[eventoId]/certificado-config  — upsert
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;
  // ── Auth: somente usuários autenticados ──
  const userClient = await createServerClientFromCookies();
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });

  const body = await req.json();
  const {
    arte_url, texto_corpo, rodape_texto,
    assinatura_nome, assinatura_cargo,
    orientacao, fonte_tamanho,
  } = body;

  if (!texto_corpo) {
    return NextResponse.json({ error: 'Texto do certificado é obrigatório.' }, { status: 400 });
  }

  const supabase = createServerClient();

  const payload = {
    evento_id:        eventoId,
    arte_url:         arte_url?.trim() || null,
    texto_corpo:      String(texto_corpo).trim(),
    rodape_texto:     rodape_texto?.trim() || null,
    assinatura_nome:  assinatura_nome?.trim() || null,
    assinatura_cargo: assinatura_cargo?.trim() || null,
    orientacao:       orientacao === 'portrait' ? 'portrait' : 'landscape',
    fonte_tamanho:    Number(fonte_tamanho) || 14,
    updated_at:       new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('evento_certificado_config')
    .upsert(payload, { onConflict: 'evento_id' })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ config: data });
}
