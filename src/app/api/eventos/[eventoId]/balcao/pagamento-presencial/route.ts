import { NextRequest, NextResponse } from 'next/server';
import { requireEventoPermission } from '@/lib/evento-guard';
import { alocarLeitoParaInscricao } from '@/lib/hospedagem-alocacao-automatica';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;

  // Utilizar o guard padrão do sistema para validar permissão
  const guard = await requireEventoPermission(request, eventoId, 'inscricoes');
  if (!guard.ok) {
    return guard.response;
  }

  const supabase = guard.ctx.supabaseAdmin;
  const { user, equipe } = guard.ctx;

  // Ler payload
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

  // Validar se inscrição pertence ao evento
  const { data: ins, error: insErr } = await supabase
    .from('evento_inscricoes')
    .select('*')
    .eq('id', inscricao_id)
    .eq('evento_id', eventoId)
    .maybeSingle();

  if (insErr || !ins) {
    return NextResponse.json({ error: 'Inscrição não localizada para este evento.' }, { status: 404 });
  }

  // Validar status pendente
  if (ins.status_pagamento === 'pago' || ins.status_pagamento === 'isento') {
    return NextResponse.json({ error: 'Esta inscrição já está paga ou isenta.' }, { status: 400 });
  }

  // Validar se inscrição pertence a um lote
  if (ins.lote_id) {
    return NextResponse.json({ error: 'Pagamento presencial de lotes não é suportado nesta etapa. Marcar individualmente apenas inscrições sem lote.' }, { status: 400 });
  }

  // Validar formas de pagamento
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

  // Definir informações do operador e sessão do caixa
  let operadorId: string | null = null;
  let operadorNome = 'Administrador';
  let caixaSessaoId: string | null = null;

  if (equipe) {
    // É um operador local da equipe do evento
    operadorId = equipe.id;
    
    // Buscar o nome completo na tabela evento_equipe se necessário, ou usar o e-mail/nome do guard
    const { data: eqData } = await supabase
      .from('evento_equipe')
      .select('nome, email')
      .eq('id', equipe.id)
      .maybeSingle();

    operadorNome = eqData?.nome || eqData?.email || 'Operador';

    // Buscar ou autoabrir sessão de caixa para operadores locais
    let { data: sessao } = await supabase
      .from('evento_caixa_sessoes')
      .select('*')
      .eq('evento_id', eventoId)
      .eq('operador_id', equipe.id)
      .eq('status', 'aberto')
      .maybeSingle();

    if (!sessao) {
      const { data: novaSessao, error: insertError } = await supabase
        .from('evento_caixa_sessoes')
        .insert({
          evento_id: eventoId,
          operador_id: equipe.id,
          operador_nome: operadorNome,
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
    caixaSessaoId = sessao.id;
  } else if (user) {
    // É um administrador global do CRM ou inscrição
    const { data: crmUser } = await supabase
      .from('users')
      .select('nome')
      .eq('id', user.id)
      .maybeSingle();

    operadorNome = crmUser?.nome || user.user_metadata?.nome || user.email || 'Administrador';
    // Admins globais não possuem sessão de caixa física vinculada a evento_equipe
  }

  // Atualizar inscrição
  const statusDestino = formaNormalizada === 'isento' ? 'isento' : 'pago';
  const obsAudit = `Pagamento presencial efetivado no balcão por ${operadorNome} via ${formaNormalizada}. ${observacao || ''}`.trim();

  const { data: inscricaoAtualizada, error: updateError } = await supabase
    .from('evento_inscricoes')
    .update({
      status_pagamento: statusDestino,
      forma_pagamento: formaNormalizada,
      valor_pago: valorNum,
      operador_id: operadorId,
      operador_nome: operadorNome,
      caixa_sessao_id: caixaSessaoId,
      origem: 'balcao',
      observacoes: ins.observacoes ? `${ins.observacoes}\n${obsAudit}` : obsAudit
    })
    .eq('id', inscricao_id)
    .select('*')
    .single();

  if (updateError) {
    return NextResponse.json({ error: 'Erro ao registrar pagamento: ' + updateError.message }, { status: 500 });
  }

  // Executar autoalocacao de hospedagem se habilitado
  try {
    await alocarLeitoParaInscricao(supabase, inscricao_id);
  } catch (alocError) {
    console.error('Erro na alocação automática de leito:', alocError);
  }

  return NextResponse.json({ ok: true, inscricao: inscricaoAtualizada });
}
