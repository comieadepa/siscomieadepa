import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  return handleSessaoAtiva(request, params);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  return handleSessaoAtiva(request, params);
}

async function handleSessaoAtiva(
  request: NextRequest,
  paramsPromise: Promise<{ eventoId: string }>
) {
  const { eventoId } = await paramsPromise;
  const { searchParams } = new URL(request.url);
  const supabase = createServerClient();

  // 1. Identificar operador/equipe
  let equipeId = searchParams.get('equipeId') || searchParams.get('equipe_id') || request.headers.get('x-evento-equipe-id');

  // Se for POST, tentar ler também do body
  if (!equipeId && request.method === 'POST') {
    try {
      const body = await request.clone().json();
      equipeId = body.equipeId || body.equipe_id;
    } catch {}
  }

  let equipeUser: any = null;

  if (equipeId) {
    const { data } = await supabase
      .from('evento_equipe')
      .select('id, nome, email, ativo, tipo')
      .eq('id', equipeId)
      .eq('evento_id', eventoId)
      .eq('ativo', true)
      .maybeSingle();
    equipeUser = data;
  }

  // 2. Se não encontrou por equipeId, tentar identificar pelo usuário logado no Supabase
  if (!equipeUser) {
    const { data: { user } } = await supabase.auth.getUser();
    if (user && user.email) {
      const { data } = await supabase
        .from('evento_equipe')
        .select('id, nome, email, ativo, tipo')
        .eq('evento_id', eventoId)
        .eq('email', user.email)
        .eq('ativo', true)
        .maybeSingle();
      equipeUser = data;
    }
  }

  if (!equipeUser) {
    return NextResponse.json({ error: 'Operador não identificado ou inativo.' }, { status: 403 });
  }

  // 3. Buscar sessão de caixa aberta para este operador e evento
  const { data: sessaoExistente } = await supabase
    .from('evento_caixa_sessoes')
    .select('*')
    .eq('evento_id', eventoId)
    .eq('operador_id', equipeUser.id)
    .eq('status', 'aberto')
    .maybeSingle();

  if (sessaoExistente) {
    return NextResponse.json({ ok: true, sessao: sessaoExistente });
  }

  // 4. Se não existe, criar automaticamente nova sessão aberta
  const { data: novaSessao, error: insertError } = await supabase
    .from('evento_caixa_sessoes')
    .insert({
      evento_id: eventoId,
      operador_id: equipeUser.id,
      operador_nome: equipeUser.nome || equipeUser.email,
      status: 'aberto',
      data_abertura: new Date().toISOString()
    })
    .select('*')
    .single();

  if (insertError) {
    return NextResponse.json({ error: 'Erro ao criar sessão de caixa: ' + insertError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, sessao: novaSessao });
}
