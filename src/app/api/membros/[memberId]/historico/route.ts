import { NextRequest, NextResponse } from 'next/server';
import { createServerClientFromRequest, createServerClient } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

/** GET /api/membros/[memberId]/historico */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ memberId: string }> },
) {
  try {
    const supabase = createServerClientFromRequest(request);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

    const { memberId } = await params;
    const db = createServerClient();

    const { data, error } = await db
      .from('member_history')
      .select('*')
      .eq('member_id', memberId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return NextResponse.json({ history: data });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[GET /api/membros/[memberId]/historico]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** POST /api/membros/[memberId]/historico */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ memberId: string }> },
) {
  try {
    const supabase = createServerClientFromRequest(request);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

    const { memberId } = await params;
    const body = await request.json();
    const { tipo, titulo, descricao, usuario_nome, ocorrencia, origem, referencia_id } = body;

    if (!tipo || !descricao) {
      return NextResponse.json({ error: 'tipo e descricao são obrigatórios' }, { status: 400 });
    }

    const db = createServerClient();

    // Evitar duplicata de registro automático
    if (origem && referencia_id) {
      const { data: existing } = await db
        .from('member_history')
        .select('id')
        .eq('member_id', memberId)
        .eq('origem', origem)
        .eq('referencia_id', referencia_id)
        .maybeSingle();

      if (existing?.id) {
        return NextResponse.json({ entry: existing, duplicate: true }, { status: 200 });
      }
    }

    const { data, error } = await db
      .from('member_history')
      .insert({
        member_id: memberId,
        tipo,
        titulo: titulo || null,
        descricao,
        usuario_nome: usuario_nome || null,
        usuario_id: user.id,
        ocorrencia: ocorrencia || new Date().toISOString().split('T')[0],
        origem: origem || null,
        referencia_id: referencia_id || null,
      })
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ entry: data }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[POST /api/membros/[memberId]/historico]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
