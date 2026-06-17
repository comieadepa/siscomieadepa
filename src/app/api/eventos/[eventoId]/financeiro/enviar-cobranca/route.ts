import { NextRequest, NextResponse } from 'next/server';
import { requireEventoPermission } from '@/lib/evento-guard';
import { sendEmail } from '@/services/email';
import {
  createOrFindAsaasCustomer,
  createEventoPayment,
  getAsaasPayment,
} from '@/lib/asaas';
import { logDB } from '@/lib/audit';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;

  // Requer permissão da área financeira
  const guard = await requireEventoPermission(request, eventoId, 'financeiro');
  if (!guard.ok) return guard.response;

  let body: { inscricao_id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body inválido.' }, { status: 400 });
  }

  const inscricaoId = body?.inscricao_id;
  if (!inscricaoId) {
    return NextResponse.json({ error: 'inscricao_id obrigatório.' }, { status: 400 });
  }

  const supabase = guard.ctx.supabaseAdmin;

  // 1. Buscar inscrição e evento
  const { data: evento } = await supabase
    .from('eventos')
    .select('id, nome')
    .eq('id', eventoId)
    .single();

  if (!evento) {
    return NextResponse.json({ error: 'Evento não encontrado.' }, { status: 404 });
  }

  const { data: inscricao } = await supabase
    .from('evento_inscricoes')
    .select('id, nome_inscrito, email, cpf, whatsapp, status_pagamento, valor_final, asaas_payment_id, invoice_url, pix_copia_cola, pix_qr_code, asaas_due_date, observacoes')
    .eq('id', inscricaoId)
    .eq('evento_id', eventoId)
    .single();

  // 2. Validar que inscrição pertence ao evento
  if (!inscricao) {
    return NextResponse.json({ error: 'Inscrição não encontrada.' }, { status: 404 });
  }

  // 3. Bloquear se status_pagamento já for pago ou isento
  if (inscricao.status_pagamento === 'pago') {
    return NextResponse.json({ error: 'Não é possível enviar cobrança para inscrição já paga.' }, { status: 400 });
  }
  if (inscricao.status_pagamento === 'isento') {
    return NextResponse.json({ error: 'Não é possível enviar cobrança para inscrição isenta/cortesia.' }, { status: 400 });
  }

  // Validar se e-mail está presente
  if (!inscricao.email || !inscricao.email.trim()) {
    return NextResponse.json({ error: 'Inscrito não possui e-mail cadastrado.' }, { status: 400 });
  }

  // 4. Verificar se existe cobrança ASAAS atual e se ela ainda está válida
  let asaasValida = false;
  let tipoCob: 'reutilizada' | 'nova' = 'reutilizada';
  let invoiceUrl = inscricao.invoice_url;
  let asaasPaymentId = inscricao.asaas_payment_id;
  let pixCopiaCola = inscricao.pix_copia_cola;
  let pixQrCode = inscricao.pix_qr_code;
  let asaasDueDate = inscricao.asaas_due_date;

  const hojeStr = new Date().toISOString().slice(0, 10);

  if (asaasPaymentId && invoiceUrl && asaasDueDate) {
    if (asaasDueDate >= hojeStr) {
      try {
        const payment = await getAsaasPayment(asaasPaymentId);
        if (payment.status !== 'OVERDUE' && payment.status !== 'CANCELED') {
          asaasValida = true;
        }
      } catch (err) {
        console.warn('[ENVIAR COBRANCA] Erro ao verificar status no ASAAS, considerando válida por causa do vencimento:', err);
        asaasValida = true;
      }
    }
  }

  // 6. Se não estiver válida ou não existir, gera nova cobrança
  if (!asaasValida) {
    tipoCob = 'nova';
    try {
      const cleanCpfValue = inscricao.cpf ? inscricao.cpf.replace(/\D/g, '') : null;
      if (!cleanCpfValue) {
        return NextResponse.json({ error: 'CPF do pagador é obrigatório para gerar nova cobrança ASAAS.' }, { status: 400 });
      }

      const customerId = await createOrFindAsaasCustomer({
        nome: inscricao.nome_inscrito,
        email: inscricao.email,
        cpf: cleanCpfValue,
        whatsapp: inscricao.whatsapp,
      });

      // Vencimento de 3 dias a partir de hoje
      const d = new Date();
      d.setDate(d.getDate() + 3);
      const newDueDate = d.toISOString().slice(0, 10);

      const paymentResult = await createEventoPayment({
        customerId,
        value: inscricao.valor_final ?? 0,
        dueDate: newDueDate,
        description: `Inscrição — ${evento.nome}`,
        externalReference: inscricao.id,
      });

      invoiceUrl = paymentResult.invoiceUrl;
      asaasPaymentId = paymentResult.id;
      pixCopiaCola = paymentResult.pixCopiaECola;
      pixQrCode = paymentResult.pixQrCode;
      asaasDueDate = newDueDate;

      // Atualizar na inscrição
      await supabase
        .from('evento_inscricoes')
        .update({
          asaas_payment_id: asaasPaymentId,
          invoice_url: invoiceUrl,
          pix_copia_cola: pixCopiaCola,
          pix_qr_code: pixQrCode,
          asaas_due_date: asaasDueDate,
        })
        .eq('id', inscricao.id);

    } catch (err: any) {
      console.error('[ENVIAR COBRANCA] Erro ao gerar nova cobrança no ASAAS:', err);
      return NextResponse.json({ error: `Falha ao gerar cobrança no ASAAS: ${err.message || err}` }, { status: 500 });
    }
  }

  // 7. Enviar e-mail ao inscrito usando helper existente
  const valorFormatado = (inscricao.valor_final ?? 0).toFixed(2).replace('.', ',');
  const assunto = `2ª Via de Pagamento — ${evento.nome}`;

  let corpoEmail = `Olá, ${inscricao.nome_inscrito}.\n\n` +
    `Sua inscrição no evento ${evento.nome} possui uma pendência financeira.\n\n` +
    `Valor:\n` +
    `R$ ${valorFormatado}\n\n` +
    `Clique no link abaixo para realizar o pagamento:\n\n` +
    `${invoiceUrl}`;

  if (pixCopiaCola) {
    corpoEmail += `\n\nSe preferir, utilize o PIX Copia e Cola:\n\n${pixCopiaCola}`;
  }

  corpoEmail += `\n\nAtenciosamente,\nCOMIEADEPA`;

  // Registra notificação no banco de dados para histórico
  const { data: notif } = await supabase
    .from('evento_notificacoes')
    .upsert({
      evento_id: eventoId,
      inscricao_id: inscricaoId,
      tipo: 'email',
      gatilho: 'manual',
      status: 'pendente',
      assunto: assunto,
      mensagem: corpoEmail,
    }, { onConflict: 'inscricao_id,tipo,gatilho' })
    .select('id')
    .single();

  const emailResult = await sendEmail({
    para: inscricao.email,
    assunto: assunto,
    mensagem: corpoEmail,
    nomeDestinatario: inscricao.nome_inscrito,
    fromEmail: 'inscricoes@siscomieadepa.org',
  });

  if (notif?.id) {
    await supabase
      .from('evento_notificacoes')
      .update({
        status: emailResult.sucesso ? 'enviado' : 'erro',
        enviado_em: emailResult.sucesso ? new Date().toISOString() : null,
        erro: emailResult.sucesso ? null : (emailResult.erro || 'Falha no envio do e-mail'),
      })
      .eq('id', notif.id);
  }

  // 8. Registrar observação/auditoria
  const dataHojeStr = new Date().toLocaleString('pt-BR', { timeZone: 'America/Belem' });
  const logMsg = `Cobrança enviada por e-mail em ${dataHojeStr}. ${tipoCob === 'reutilizada' ? 'Reutilizada cobrança atual.' : 'Gerada nova cobrança.'}`;
  const novasObservacoes = inscricao.observacoes ? `${inscricao.observacoes}\n${logMsg}` : logMsg;

  await supabase
    .from('evento_inscricoes')
    .update({ observacoes: novasObservacoes })
    .eq('id', inscricao.id);

  void logDB({
    userId: guard.ctx.user?.id,
    userEmail: guard.ctx.user?.email ?? undefined,
    acao: 'enviar_cobranca',
    modulo: 'financeiro',
    entidade: 'evento_inscricoes',
    entidadeId: inscricaoId,
    descricao: `Cobrança enviada por e-mail em ${dataHojeStr}. ${tipoCob === 'reutilizada' ? 'Reutilizada' : 'Gerada nova'} cobrança. URL: ${invoiceUrl}`,
    status: emailResult.sucesso ? 'sucesso' : 'aviso',
    mensagemErro: emailResult.sucesso ? undefined : (emailResult.erro || 'E-mail falhou'),
  });

  if (!emailResult.sucesso) {
    // Se e-mail falhar, não apagar cobrança gerada; retornar aviso
    return NextResponse.json({
      success: true,
      emailWarning: true,
      tipo: tipoCob,
      invoice_url: invoiceUrl,
      vencimento: asaasDueDate,
      message: 'Cobrança gerada com sucesso, mas o envio do e-mail falhou.',
    });
  }

  return NextResponse.json({
    success: true,
    tipo: tipoCob,
    invoice_url: invoiceUrl,
    vencimento: asaasDueDate,
  });
}
