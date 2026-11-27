import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { identificarOperadorCaixa } from '@/lib/eventos/operador-caixa';

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
  const supabase = createServerClient();

  // 1. Identificar operador logado (suporta equipe operacional e acesso administrativo SUPER/ADMIN)
  const operador = await identificarOperadorCaixa(request, eventoId);
  if (!operador) {
    return NextResponse.json({ error: 'Operador não identificado ou inativo.' }, { status: 403 });
  }

  const equipeUser = {
    id: operador.equipeId,
    nome: operador.nome,
    email: operador.email,
  };

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
