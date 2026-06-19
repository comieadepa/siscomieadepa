import { NextRequest, NextResponse } from 'next/server';
import { requireEventoPermission } from '@/lib/evento-guard';
import { sendEmail } from '@/services/email';
import { parseEventoTemplate } from '@/lib/evento-template';

type EventoRow = {
  id: string;
  nome: string;
  mensagem_confirmacao: string | null;
  link_whatsapp: string | null;
  local: string | null;
  data_inicio: string | null;
  data_fim: string | null;
};

type InscricaoRow = {
  id: string;
  nome_inscrito: string;
  email: string | null;
  status_pagamento: string;
  qr_code: string | null;
  invoice_url: string | null;
  pix_copia_cola: string | null;
  valor_final: number | null;
  asaas_due_date: string | null;
};

function fmtData(d: string | null): string {
  if (!d) return '';
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y}`;
}

function fmtMoeda(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function buildConfirmacaoEmail(evento: EventoRow, inscricao: InscricaoRow) {
  const isIsento = inscricao.status_pagamento === 'isento';
  const finalNome = (evento.nome || '').toUpperCase().includes('UMADESPA') ? 'CONGRESSO UMADESPA 2026 - BELÉM' : (evento.nome || '');
  const assunto = `Inscricao confirmada - ${finalNome}`;
  const vars = {
    // Campos planos legado
    NOME: inscricao.nome_inscrito,
    EVENTO: finalNome,
    NOME_DO_EVENTO: finalNome,
    LINK_GRUPO: evento.link_whatsapp ?? '',
    LINK_WHATSAPP: evento.link_whatsapp ?? '',
    QR_CODE: inscricao.qr_code ?? '',
    CODIGO_CHECKIN: inscricao.qr_code ?? '',
    STATUS_PAGAMENTO: inscricao.status_pagamento,
    LOCAL: evento.local ?? '',
    LOCAL_EVENTO: evento.local ?? '',
    DATA_EVENTO: fmtData(evento.data_inicio),

    // Objetos estruturados
    evento: {
      nome: finalNome,
      link_whatsapp: evento.link_whatsapp,
      local: evento.local,
      data_inicio: evento.data_inicio,
      data_fim: evento.data_fim,
    },
    inscricao: {
      nome: inscricao.nome_inscrito,
      nome_inscrito: inscricao.nome_inscrito,
      qr_code: inscricao.qr_code,
      codigo_checkin: inscricao.qr_code,
      status_pagamento: inscricao.status_pagamento,
    }
  };

  let mensagem = `Ola, ${inscricao.nome_inscrito}!\n\n`;
  if (isIsento) {
    mensagem += `Sua inscricao para o evento *${finalNome}* foi confirmada.`;
  } else {
    mensagem += `Seu pagamento para o evento *${finalNome}* foi confirmado.`;
  }
  mensagem += `\n\nCodigo de check-in: ${inscricao.qr_code ?? '-'}`;

  if (evento.mensagem_confirmacao) {
    mensagem += `\n\n${parseEventoTemplate(evento.mensagem_confirmacao, vars)}`;
  }
  if (evento.link_whatsapp) {
    mensagem += `\n\nGrupo do WhatsApp: ${evento.link_whatsapp}`;
  }

  return { assunto, mensagem };
}

function buildSegundaViaEmail(evento: EventoRow, inscricao: InscricaoRow) {
  const invoiceUrl = inscricao.invoice_url;
  const pixCopia = inscricao.pix_copia_cola;
  const valorFinal = inscricao.valor_final ?? 0;
  const vencimento = inscricao.asaas_due_date;

  if (!pixCopia && !invoiceUrl) {
    return null;
  }

  const assunto = `Segunda via de pagamento - ${evento.nome}`;
  let mensagem = `Segunda via - *${evento.nome}*`;
  mensagem += `\nStatus: Pendente`;
  if (valorFinal > 0) {
    mensagem += `\nValor: ${fmtMoeda(valorFinal)}`;
  }
  if (vencimento) {
    mensagem += `\nVencimento: ${fmtData(vencimento)}`;
  }
  if (pixCopia) {
    mensagem += `\n\nPIX Copia e Cola:\n${pixCopia}`;
  }
  if (invoiceUrl) {
    mensagem += `\n\nLink de pagamento (PIX, boleto, cartao):\n${invoiceUrl}`;
  }

  return { assunto, mensagem };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;

  const guard = await requireEventoPermission(request, eventoId, 'comunicacao');
  if (!guard.ok) return guard.response;

  let body: { inscricao_id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body invalido.' }, { status: 400 });
  }

  const inscricaoId = body?.inscricao_id;
  if (!inscricaoId) {
    return NextResponse.json({ error: 'inscricao_id obrigatorio.' }, { status: 400 });
  }

  const supabase = guard.ctx.supabaseAdmin;

  const { data: evento } = await supabase
    .from('eventos')
    .select('id,nome,mensagem_confirmacao,link_whatsapp,local,data_inicio,data_fim')
    .eq('id', eventoId)
    .single();

  if (!evento) {
    return NextResponse.json({ error: 'Evento nao encontrado.' }, { status: 404 });
  }

  const { data: inscricao } = await supabase
    .from('evento_inscricoes')
    .select('id,nome_inscrito,email,status_pagamento,qr_code,invoice_url,pix_copia_cola,valor_final,asaas_due_date')
    .eq('id', inscricaoId)
    .eq('evento_id', eventoId)
    .single();

  if (!inscricao) {
    return NextResponse.json({ error: 'Inscricao nao encontrada.' }, { status: 404 });
  }

  if (!inscricao.email) {
    return NextResponse.json({ error: 'Inscrito nao possui e-mail cadastrado.' }, { status: 422 });
  }

  const status = inscricao.status_pagamento;
  let payload: { assunto: string; mensagem: string } | null = null;

  if (status === 'pago' || status === 'isento') {
    payload = buildConfirmacaoEmail(evento as EventoRow, inscricao as InscricaoRow);
  } else if (status === 'pendente') {
    payload = buildSegundaViaEmail(evento as EventoRow, inscricao as InscricaoRow);
    if (!payload) {
      return NextResponse.json({ error: 'Dados de pagamento nao encontrados.' }, { status: 422 });
    }
  } else {
    return NextResponse.json({ error: `Status de pagamento invalido: ${status}.` }, { status: 422 });
  }

  const { data: notif, error: notifErr } = await supabase
    .from('evento_notificacoes')
    .upsert({
      evento_id: eventoId,
      inscricao_id: inscricaoId,
      tipo: 'email',
      gatilho: 'manual',
      status: 'pendente',
      assunto: payload.assunto,
      mensagem: payload.mensagem,
    }, { onConflict: 'inscricao_id,tipo,gatilho' })
    .select('id')
    .single();

  if (notifErr || !notif) {
    return NextResponse.json({ error: 'Erro ao registrar envio.' }, { status: 500 });
  }

  const resultado = await sendEmail({
    para: inscricao.email,
    assunto: payload.assunto,
    mensagem: payload.mensagem,
    nomeDestinatario: inscricao.nome_inscrito,
    fromEmail: 'inscricoes@siscomieadepa.org',
  });

  await supabase
    .from('evento_notificacoes')
    .update({
      status: resultado.sucesso ? 'enviado' : 'erro',
      enviado_em: resultado.sucesso ? new Date().toISOString() : null,
      erro: resultado.sucesso ? null : resultado.erro,
    })
    .eq('id', notif.id);

  if (!resultado.sucesso) {
    return NextResponse.json({ error: resultado.erro ?? 'Falha ao enviar e-mail.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
