import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, createServerClientFromCookies } from '@/lib/supabase-server';
import { normalizeEventoRole, resolveEventoPermissoes, type EventoRole } from '@/lib/evento-permissions';
import { normalizeRole } from '@/lib/auth/roles';
import { createOrFindAsaasCustomer, createEventoPayment } from '@/lib/asaas';
import { sendEmail } from '@/services/email';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ inscricaoId: string }> }
) {
  const { inscricaoId } = await params;

  if (!inscricaoId) {
    return NextResponse.json({ error: 'inscricaoId ausente' }, { status: 400 });
  }

  // 1. Autenticar usuário
  const userClient = await createServerClientFromCookies();
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
  }

  const supabaseAdmin = createServerClient();

  // 2. Obter inscrição e detalhes do evento
  const { data: ins, error: insError } = await supabaseAdmin
    .from('evento_inscricoes')
    .select('id, evento_id, status_pagamento, valor_pago, valor_original, valor_final, tipo_inscricao, nome_inscrito, email, whatsapp, cpf, observacoes, eventos(nome)')
    .eq('id', inscricaoId)
    .single();

  if (insError || !ins) {
    return NextResponse.json({ error: 'Inscrição não encontrada' }, { status: 404 });
  }

  const evento = ins.eventos as any;

  // 3. Validação: Apenas inscrições pagas
  if (ins.status_pagamento !== 'pago' && ins.status_pagamento !== 'pendente_complemento') {
    return NextResponse.json({ error: 'Apenas inscrições pagas podem gerar cobrança complementar.' }, { status: 400 });
  }

  // 4. Verificar permissão
  const nivelRaw = (user.user_metadata?.nivel as string | undefined) ?? '';
  const nivel = normalizeRole(nivelRaw);
  const departamento = (user.user_metadata?.subcategoria as string | undefined) ?? '';
  const isGlobal = nivel === 'super' || nivel === 'administrador';
  const isDeptAdmin = nivel === 'inscricao' && !!departamento;

  let permissao: EventoRole | null = null;
  if (isGlobal || isDeptAdmin) {
    permissao = 'admin_evento';
  } else {
    const { data: vinculo } = await supabaseAdmin
      .from('usuario_eventos')
      .select('permissao')
      .eq('user_id', user.id)
      .eq('evento_id', ins.evento_id)
      .maybeSingle();
    permissao = normalizeEventoRole((vinculo as any)?.permissao ?? null);
  }

  if (!permissao) {
    return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
  }

  const perms = resolveEventoPermissoes({ perm: permissao, isGlobal, isDeptAdmin });
  if (!perms.podeEditarEvento) {
    return NextResponse.json({ error: 'Sem permissão para editar este evento.' }, { status: 403 });
  }

  // 5. Parse do body
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body inválido' }, { status: 400 });
  }

  const { tipo_inscricao, valor_novo } = body;
  if (!tipo_inscricao || typeof valor_novo !== 'number') {
    return NextResponse.json({ error: 'Campos tipo_inscricao e valor_novo são obrigatórios' }, { status: 400 });
  }

  const valorPagoAtual = ins.valor_pago ?? ins.valor_final ?? 0;
  const diferenca = valor_novo - valorPagoAtual;

  if (diferenca <= 0) {
    return NextResponse.json({ error: 'Novo valor deve ser maior que o valor atualmente pago.' }, { status: 400 });
  }

  // 6. Verificar se já existe complemento pendente
  const { data: existingComplement } = await supabaseAdmin
    .from('evento_ordens_pagamento')
    .select('*')
    .eq('inscricao_id', inscricaoId)
    .eq('tipo_ordem', 'complemento')
    .eq('status', 'pendente')
    .maybeSingle();

  if (existingComplement) {
    return NextResponse.json({
      success: true,
      duplicado: true,
      ordem: existingComplement,
      message: 'Já existe uma cobrança complementar pendente para esta inscrição.'
    });
  }

  // 7. Gerar cobrança ASAAS
  let asaasPayment;
  try {
    const customerId = await createOrFindAsaasCustomer({
      nome: ins.nome_inscrito,
      email: ins.email,
      cpf: ins.cpf,
      whatsapp: ins.whatsapp
    });

    // Formata a data de vencimento (ex: 3 dias a partir de hoje)
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 3);
    const dueDateStr = `${dueDate.getFullYear()}-${String(dueDate.getMonth() + 1).padStart(2, '0')}-${String(dueDate.getDate()).padStart(2, '0')}`;

    asaasPayment = await createEventoPayment({
      customerId,
      value: diferenca,
      dueDate: dueDateStr,
      description: `Diferença de Alteração de Categoria — ${evento?.nome || ''}`,
      externalReference: `complemento:${inscricaoId}`
    });
  } catch (err: any) {
    return NextResponse.json({ error: `Falha ao gerar cobrança no ASAAS: ${err.message}` }, { status: 500 });
  }

  // 8. Salvar em evento_ordens_pagamento
  const metadata = {
    tipo_anterior: ins.tipo_inscricao,
    tipo_novo: tipo_inscricao,
    valor_anterior: valorPagoAtual,
    valor_novo: valor_novo
  };

  const { data: novaOrdem, error: insertError } = await supabaseAdmin
    .from('evento_ordens_pagamento')
    .insert({
      inscricao_id: inscricaoId,
      evento_id: ins.evento_id,
      tipo_ordem: 'complemento',
      valor: diferenca,
      status: 'pendente',
      asaas_payment_id: asaasPayment.id,
      invoice_url: asaasPayment.invoiceUrl,
      pix_copia_cola: asaasPayment.pixCopiaECola,
      pix_qr_code: asaasPayment.pixQrCode,
      descricao: `Diferença de categoria: ${ins.tipo_inscricao} -> ${tipo_inscricao}`,
      metadata
    })
    .select('*')
    .single();

  if (insertError) {
    return NextResponse.json({ error: `Falha ao salvar ordem: ${insertError.message}` }, { status: 500 });
  }

  // 9. Atualizar status da inscrição e observação de auditoria
  const dataHora = new Date().toLocaleString('pt-BR');
  const logMessage = `[${dataHora}] Categoria alterada de "${ins.tipo_inscricao}" para "${tipo_inscricao}". Valor total: R$ ${valor_novo.toFixed(2)}. Diferença de R$ ${diferenca.toFixed(2)} pendente de pagamento complementar.`;
  const obsFinal = ins.observacoes ? `${ins.observacoes}\n${logMessage}` : logMessage;

  const { error: updateError } = await supabaseAdmin
    .from('evento_inscricoes')
    .update({
      status_pagamento: 'pendente_complemento',
      tipo_inscricao,
      valor_final: valor_novo,
      observacoes: obsFinal
    })
    .eq('id', inscricaoId);

  if (updateError) {
    return NextResponse.json({ error: `Falha ao atualizar inscrição: ${updateError.message}` }, { status: 500 });
  }

  // 10. Enviar e-mail
  if (ins.email && ins.email.includes('@')) {
    const formatMoeda = (val: number) => `R$ ${val.toFixed(2).replace('.', ',')}`;
    const emailSubject = `Pagamento Complementar — Alteração de Inscrição: ${evento?.nome || ''}`;
    const emailMessage = `Olá, ${ins.nome_inscrito}.\n\n` +
      `Sua inscrição para o evento "${evento?.nome || ''}" foi atualizada pelo administrador.\n\n` +
      `Detalhes da alteração:\n` +
      `- Categoria anterior: ${ins.tipo_inscricao || 'Nenhuma'}\n` +
      `- Nova categoria: ${tipo_inscricao}\n` +
      `- Valor já pago: ${formatMoeda(valorPagoAtual)}\n` +
      `- Diferença a pagar: ${formatMoeda(diferenca)}\n\n` +
      `Para concluir a alteração e validar sua inscrição na nova categoria, efetue o pagamento da diferença de ${formatMoeda(diferenca)} através do link abaixo:\n\n` +
      `${asaasPayment.invoiceUrl}\n\n` +
      `Caso tenha dúvidas, entre em contato com a organização do evento.\n\n` +
      `Atenciosamente,\n` +
      `SISCOMIEADEPA`;

    await sendEmail({
      para: ins.email,
      assunto: emailSubject,
      mensagem: emailMessage
    }).catch(err => {
      console.error('[COMPLEMENTO] Erro ao enviar e-mail:', err);
    });
  }

  return NextResponse.json({
    success: true,
    ordem: novaOrdem
  });
}
