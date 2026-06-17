import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { alocarLeitoParaInscricao } from '@/lib/hospedagem-alocacao-automatica';

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

  // 2. Ler payload
  let body: any;
  try {
    body = await request.json();
  } catch (err) {
    return NextResponse.json({ error: 'Payload inválido.' }, { status: 400 });
  }

  const { inscricao_id, forma_pagamento, valor_pago, observacao } = body;

  if (!inscricao_id) {
    return NextResponse.json({ error: 'ID da inscrição não informado.' }, { status: 400 });
  }

  // 3. Validar se inscrição pertence ao evento
  const { data: ins, error: insErr } = await supabase
    .from('evento_inscricoes')
    .select('*')
    .eq('id', inscricao_id)
    .eq('evento_id', eventoId)
    .maybeSingle();

  if (insErr || !ins) {
    return NextResponse.json({ error: 'Inscrição não localizada para este evento.' }, { status: 404 });
  }

  // 4. Validar status pendente
  if (ins.status_pagamento === 'pago' || ins.status_pagamento === 'isento') {
    return NextResponse.json({ error: 'Esta inscrição já está paga ou isenta.' }, { status: 400 });
  }

  // 5. Validar se inscrição pertence a um lote
  if (ins.lote_id) {
    return NextResponse.json({ error: 'Pagamento presencial de lotes não é suportado nesta etapa. Marcar individualmente apenas inscrições sem lote.' }, { status: 400 });
  }

  // 6. Validar formas de pagamento
  const formasValidas = ['dinheiro', 'pix', 'debito', 'credito', 'isento'];
  const formaNormalizada = String(forma_pagamento || '').toLowerCase().trim();
  if (!formasValidas.includes(formaNormalizada)) {
    return NextResponse.json({ error: 'Forma de pagamento inválida.' }, { status: 400 });
  }

  const valorNum = Number(valor_pago);
  if (formaNormalizada === 'isento') {
    if (valorNum !== 0) {
      return NextResponse.json({ error: 'Inscrição isenta deve ter valor pago igual a zero.' }, { status: 400 });
    }
  } else {
    if (isNaN(valorNum) || valorNum <= 0) {
      return NextResponse.json({ error: 'Valor pago precisa ser maior que zero.' }, { status: 400 });
    }
  }

  // 7. Buscar ou autoabrir sessão de caixa
  let { data: sessao } = await supabase
    .from('evento_caixa_sessoes')
    .select('*')
    .eq('evento_id', eventoId)
    .eq('operador_id', equipeUser.id)
    .eq('status', 'aberto')
    .maybeSingle();

  if (!sessao) {
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
      return NextResponse.json({ error: 'Erro ao abrir sessão de caixa operacional automaticamente.' }, { status: 500 });
    }
    sessao = novaSessao;
  }

  // 8. Atualizar inscrição
  const statusDestino = formaNormalizada === 'isento' ? 'isento' : 'pago';
  const obsAudit = `Pagamento presencial efetivado no balcão por ${equipeUser.nome || equipeUser.email} via ${formaNormalizada}. ${observacao || ''}`.trim();

  const { data: inscricaoAtualizada, error: updateError } = await supabase
    .from('evento_inscricoes')
    .update({
      status_pagamento: statusDestino,
      forma_pagamento: formaNormalizada,
      valor_pago: valorNum,
      operador_id: equipeUser.id,
      operador_nome: equipeUser.nome || equipeUser.email,
      caixa_sessao_id: sessao.id,
      origem: 'balcao',
      observacoes: ins.observacoes ? `${ins.observacoes}\n${obsAudit}` : obsAudit
    })
    .eq('id', inscricao_id)
    .select('*')
    .single();

  if (updateError) {
    return NextResponse.json({ error: 'Erro ao registrar pagamento: ' + updateError.message }, { status: 500 });
  }

  // 9. Executar autoalocacao de hospedagem se habilitado
  try {
    await alocarLeitoParaInscricao(supabase, inscricao_id);
  } catch (alocError) {
    console.error('Erro na alocação automática de leito:', alocError);
  }

  return NextResponse.json({ ok: true, inscricao: inscricaoAtualizada });
}
