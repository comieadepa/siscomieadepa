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
    const { tipo, descricao, usuario_nome, ocorrencia } = body;

    if (!tipo || !descricao) {
      return NextResponse.json({ error: 'tipo e descricao são obrigatórios' }, { status: 400 });
    }

    const db = createServerClient();
    const { data, error } = await db
      .from('member_history')
      .insert({
        member_id: memberId,
        tipo,
        descricao,
        usuario_nome: usuario_nome || null,
        usuario_id: user.id,
        ocorrencia: ocorrencia || new Date().toISOString().split('T')[0],
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
