import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { requireEventoAccess } from '@/lib/evento-guard';

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
  const guard = await requireEventoAccess(req, eventoId);
  if (!guard.ok) return guard.response;
  if (!guard.ctx.perms.podeEditarEvento) {
    return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
  }

  const body = await req.json();
  const {
    arte_url, background_url, texto_corpo, rodape_texto,
    assinatura_nome, assinatura_cargo,
    orientacao, fonte_tamanho,
    elementos_json,
  } = body;

  // texto_corpo is optional when using elementos_json editor
  const textoFinal = texto_corpo?.trim() || 'Certificamos que {NOME} participou do evento {EVENTO}, realizado em {DATA_EVENTO}.';

  const supabase = guard.ctx.supabaseAdmin;

  const payload: Record<string, unknown> = {
    evento_id:        eventoId,
    arte_url:         arte_url?.trim() || background_url?.trim() || null,
    background_url:   background_url?.trim() || arte_url?.trim() || null,
    texto_corpo:      textoFinal,
    rodape_texto:     rodape_texto?.trim() || null,
    assinatura_nome:  assinatura_nome?.trim() || null,
    assinatura_cargo: assinatura_cargo?.trim() || null,
    orientacao:       orientacao === 'portrait' ? 'portrait' : 'landscape',
    fonte_tamanho:    Number(fonte_tamanho) || 14,
    elementos_json:   elementos_json ?? null,
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
