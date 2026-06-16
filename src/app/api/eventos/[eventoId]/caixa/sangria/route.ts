import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;
  const supabase = createServerClient();

  // 1. Identificar operador logado (sessão operacional/equipe atual)
  let equipeId = request.headers.get('x-evento-equipe-id');
  let equipeUser: any = null;

  if (equipeId) {
    const { data } = await supabase
      .from('evento_equipe')
      .select('id, nome, email, ativo')
      .eq('id', equipeId)
      .eq('evento_id', eventoId)
      .eq('ativo', true)
      .maybeSingle();
    equipeUser = data;
  }

  if (!equipeUser) {
    const { data: { user } } = await supabase.auth.getUser();
    if (user && user.email) {
      const { data } = await supabase
        .from('evento_equipe')
        .select('id, nome, email, ativo')
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

  // 2. Ler payload do request body
  let body: any;
  try {
    body = await request.json();
  } catch (err) {
    return NextResponse.json({ error: 'Payload inválido.' }, { status: 400 });
  }

  const {
    caixa_sessao_id,
    operador_id,
    valor,
    forma_pagamento = 'dinheiro',
    observacao,
    retirado_por,
    recebido_por
  } = body;

  // 3. Validações básicas
  if (!caixa_sessao_id) {
    return NextResponse.json({ error: 'Sessão de caixa não informada.' }, { status: 400 });
  }

  const valorNum = Number(valor);
  if (isNaN(valorNum) || valorNum <= 0) {
    return NextResponse.json({ error: 'Valor da sangria precisa ser maior que zero.' }, { status: 400 });
  }

  if (forma_pagamento !== 'dinheiro') {
    return NextResponse.json({ error: 'Forma de pagamento aceita é apenas dinheiro nesta etapa.' }, { status: 400 });
  }

  if (!retirado_por || !retirado_por.trim()) {
    return NextResponse.json({ error: 'Campo Retirado por é obrigatório.' }, { status: 400 });
  }

  if (!recebido_por || !recebido_por.trim()) {
    return NextResponse.json({ error: 'Campo Recebido por é obrigatório.' }, { status: 400 });
  }

  // 4. Segurança: Se houver divergência entre o operador_id do body e o operador da sessão ativa, rejeitar.
  if (operador_id && operador_id !== equipeUser.id) {
    return NextResponse.json({ error: 'Divergência de operador identificada. Ação rejeitada.' }, { status: 403 });
  }

  // 5. Validar se o caixa_sessao_id informado pertence ao evento, ao operador autenticado e está aberto
  const { data: sessao, error: sessaoErr } = await supabase
    .from('evento_caixa_sessoes')
    .select('*')
    .eq('id', caixa_sessao_id)
    .eq('evento_id', eventoId)
    .eq('operador_id', equipeUser.id)
    .maybeSingle();

  if (sessaoErr || !sessao) {
    return NextResponse.json({ error: 'Sessão de caixa não encontrada ou não pertence a este operador.' }, { status: 403 });
  }

  if (sessao.status !== 'aberto') {
    return NextResponse.json({ error: 'Não é possível realizar sangria em um caixa fechado/conferido.' }, { status: 400 });
  }

  // 6. Inserir a sangria com status = 'registrada'
  const { data: novaSangria, error: insertError } = await supabase
    .from('evento_caixa_sangrias')
    .insert({
      evento_id: eventoId,
      caixa_sessao_id: sessao.id,
      operador_id: equipeUser.id,
      valor: valorNum,
      forma_pagamento: 'dinheiro',
      observacao: observacao || null,
      retirado_por: retirado_por.trim(),
      recebido_por: recebido_por.trim(),
      status: 'registrada'
    })
    .select('*')
    .single();

  if (insertError) {
    return NextResponse.json({ error: 'Erro ao registrar sangria: ' + insertError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, sangria: novaSangria });
}
