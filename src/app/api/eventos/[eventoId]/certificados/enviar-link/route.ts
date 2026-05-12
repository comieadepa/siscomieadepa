import { NextRequest, NextResponse } from 'next/server';
import { requireEventoAccess } from '@/lib/evento-guard';
import { sendEmail } from '@/services/email';
import { buildUrl, getPublicBaseUrl } from '@/lib/urls';

// POST /api/eventos/[eventoId]/certificados/enviar-link
// Envia (ou reenvia) o link do certificado por e-mail para uma inscrição.
// Body: { inscricao_id: string; reenviar?: boolean }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;

  // Auth
  const guard = await requireEventoAccess(req, eventoId);
  if (!guard.ok) return guard.response;
  if (!guard.ctx.perms.podeCertificados) {
    return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
  }

  let body: { inscricao_id: string; reenviar?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body inválido.' }, { status: 400 });
  }

  const { inscricao_id, reenviar = false } = body;
  if (!inscricao_id) {
    return NextResponse.json({ error: 'inscricao_id obrigatório.' }, { status: 400 });
  }

  const supabase = guard.ctx.supabaseAdmin;

  // Busca evento
  const { data: evento } = await supabase
    .from('eventos')
    .select('id, nome, gerar_certificado, data_fim, data_inicio, suporte_nome, suporte_whatsapp')
    .eq('id', eventoId)
    .single();

  if (!evento) return NextResponse.json({ error: 'Evento não encontrado.' }, { status: 404 });
  if (!evento.gerar_certificado) {
    return NextResponse.json({ error: 'Este evento não emite certificados.' }, { status: 400 });
  }

  // Busca inscrição
  const { data: inscricao } = await supabase
    .from('evento_inscricoes')
    .select('id, nome_inscrito, email, qr_code, status_pagamento, checkin_realizado')
    .eq('id', inscricao_id)
    .eq('evento_id', eventoId)
    .single();

  if (!inscricao) return NextResponse.json({ error: 'Inscrição não encontrada.' }, { status: 404 });

  // Validações de elegibilidade
  if (!['pago', 'isento'].includes(inscricao.status_pagamento)) {
    return NextResponse.json({
      error: 'Pagamento não confirmado — certificado não disponível.',
      motivo: 'pagamento_pendente',
    }, { status: 422 });
  }
  if (!inscricao.checkin_realizado) {
    return NextResponse.json({
      error: 'Check-in não realizado — certificado não disponível.',
      motivo: 'checkin_nao_realizado',
    }, { status: 422 });
  }
  if (!inscricao.email) {
    return NextResponse.json({
      error: 'Inscrito não possui e-mail cadastrado.',
      motivo: 'sem_email',
    }, { status: 422 });
  }
  if (!inscricao.qr_code) {
    return NextResponse.json({
      error: 'Código QR não gerado para esta inscrição.',
      motivo: 'sem_qr_code',
    }, { status: 422 });
  }

  // Deduplicação: verifica se já foi enviado (a não ser que reenviar=true)
  if (!reenviar) {
    const { data: jaEnviado } = await supabase
      .from('evento_notificacoes')
      .select('id, status')
      .eq('evento_id', eventoId)
      .eq('inscricao_id', inscricao_id)
      .eq('gatilho', 'certificado_link')
      .eq('tipo', 'email')
      .eq('status', 'enviado')
      .maybeSingle();

    if (jaEnviado) {
      return NextResponse.json({
        ok: false,
        jaEnviado: true,
        message: 'Link do certificado já enviado para este inscrito.',
      });
    }
  }

  // Monta link e e-mail
  const baseUrl = getPublicBaseUrl({ request: req });
  const linkCertificado = buildUrl(baseUrl, `/certificado/${inscricao.qr_code}`);

  const dataFimStr = evento.data_fim ?? evento.data_inicio;
  const dataFim = new Date(`${dataFimStr}T23:59:59-03:00`);
  const prazo = new Date(dataFim.getTime() + 48 * 60 * 60 * 1000);
  const prazoFmt = prazo.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Belem' });

  const suporteTexto = (evento.suporte_nome || evento.suporte_whatsapp)
    ? `\n\nSuporte: ${[evento.suporte_nome, evento.suporte_whatsapp].filter(Boolean).join(' — ')}`
    : '';

  const mensagem = `Olá, ${inscricao.nome_inscrito}!

Sua participação no evento "${evento.nome}" foi confirmada com sucesso.

Acesse o link abaixo para visualizar e imprimir seu certificado:

${linkCertificado}

Este certificado estará disponível para emissão online até ${prazoFmt}.
Após esse prazo, entre em contato com a organização para solicitar uma nova emissão.${suporteTexto}`;

  const assunto = `🎓 Seu certificado — ${evento.nome}`;

  // Cria registro na fila de notificações
  const { data: notif, error: notifErr } = await supabase
    .from('evento_notificacoes')
    .insert([{
      evento_id:    eventoId,
      inscricao_id: inscricao_id,
      tipo:         'email',
      status:       'pendente',
      gatilho:      'certificado_link',
      assunto,
      mensagem,
    }])
    .select('id')
    .single();

  if (notifErr || !notif) {
    console.error('[CERT LINK] Erro ao criar notificação:', notifErr?.message);
    return NextResponse.json({ error: 'Erro ao registrar envio.' }, { status: 500 });
  }

  // Envia e-mail
  const resultado = await sendEmail({
    para:             inscricao.email,
    assunto,
    mensagem,
    nomeDestinatario: inscricao.nome_inscrito,
    fromEmail: 'certificados@siscomieadepa.org',
  });

  // Atualiza status da notificação
  await supabase
    .from('evento_notificacoes')
    .update({
      status:     resultado.sucesso ? 'enviado' : 'erro',
      enviado_em: resultado.sucesso ? new Date().toISOString() : null,
      erro:       resultado.sucesso ? null : resultado.erro,
    })
    .eq('id', notif.id);

  // Marca certificado_enviado na inscrição
  if (resultado.sucesso) {
    await supabase
      .from('evento_inscricoes')
      .update({ certificado_enviado: true })
      .eq('id', inscricao_id);
  }

  if (!resultado.sucesso) {
    return NextResponse.json({ error: resultado.erro }, { status: 500 });
  }

  return NextResponse.json({ ok: true, link: linkCertificado });
}
