import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { requireModuleAccess } from '@/lib/auth/require-auth';
import { buildCartaTexto, type CartaDados, type CartaTipo } from '@/lib/cartas/templates';

const TIPOS_VALIDOS = new Set<CartaTipo>([
  'requerimento_cgadb',
  'carta_recomendacao',
  'carta_mudanca',
]);

const STATUS_VALIDO = new Set(['emitida', 'pendente', 'cancelada']);

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireModuleAccess(request, 'secretaria');
  if (!auth.ok) return auth.response;

  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'ID invalido.' }, { status: 400 });

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('cartas_ministeriais')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Carta nao encontrada.' }, { status: 404 });

  return NextResponse.json({ data });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireModuleAccess(request, 'secretaria');
  if (!auth.ok) return auth.response;

  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'ID invalido.' }, { status: 400 });

  const body = await request.json().catch(() => null as any);
  const action = String(body?.action || '').toLowerCase();

  const supabase = createServerClient();

  if (action === 'cancelar') {
    const motivo = String(body?.motivo || '').trim();
    if (!motivo) {
      return NextResponse.json({ error: 'Informe o motivo do cancelamento.' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('cartas_ministeriais')
      .update({
        status: 'cancelada',
        cancelado_por: auth.ctx.user.id,
        cancelado_em: new Date().toISOString(),
        motivo_cancelamento: motivo,
      })
      .eq('id', id)
      .select('id,numero,status')
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ data });
  }

  if (action === 'emitir') {
    const tipo = body?.tipo && TIPOS_VALIDOS.has(body.tipo) ? (body.tipo as CartaTipo) : null;
    const dados = (body?.dados || {}) as CartaDados;

    if (!tipo) {
      return NextResponse.json({ error: 'Tipo de carta invalido.' }, { status: 400 });
    }

    const textoInfo = buildCartaTexto(tipo, dados);

    const { data, error } = await supabase
      .from('cartas_ministeriais')
      .update({
        status: 'emitida',
        emitido_em: new Date().toISOString(),
        emitido_por: auth.ctx.user.id,
        emitido_por_nome: auth.ctx.user.user_metadata?.nome || auth.ctx.user.user_metadata?.name || null,
        emitido_por_email: auth.ctx.user.email || null,
        texto_final: textoInfo.texto,
        dados_json: dados,
      })
      .eq('id', id)
      .select('id,numero,tipo,ministro_nome,matricula,emitido_em,emitido_por_email,status,texto_final,dados_json')
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ data, titulo: textoInfo.titulo, validade: textoInfo.validade || null });
  }

  if (action === 'atualizar_status') {
    const status = String(body?.status || '');
    if (!STATUS_VALIDO.has(status)) {
      return NextResponse.json({ error: 'Status invalido.' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('cartas_ministeriais')
      .update({ status })
      .eq('id', id)
      .select('id,numero,status')
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ data });
  }

  return NextResponse.json({ error: 'Acao invalida.' }, { status: 400 });
}
