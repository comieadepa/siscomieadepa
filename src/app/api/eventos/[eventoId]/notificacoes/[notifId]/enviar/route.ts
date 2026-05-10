import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { sendEmail } from '@/services/email';
import { sendWhatsApp } from '@/services/whatsapp';

// POST /api/eventos/[eventoId]/notificacoes/[notifId]/enviar
// Processa (re)envio de uma notificação específica
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ eventoId: string; notifId: string }> }
) {
  const { eventoId, notifId } = await params;
  const supabase = createServerClient();

  // 1. Busca a notificação
  const { data: notif, error: findErr } = await supabase
    .from('evento_notificacoes')
    .select(`
      *,
      evento_inscricoes!inner ( nome_inscrito, email, whatsapp )
    `)
    .eq('id', notifId)
    .eq('evento_id', eventoId)
    .single();

  if (findErr || !notif) {
    return NextResponse.json({ error: 'Notificação não encontrada.' }, { status: 404 });
  }

  const inscricao = notif.evento_inscricoes as {
    nome_inscrito: string;
    email: string | null;
    whatsapp: string | null;
  };

  let resultado: { sucesso: boolean; erro?: string; messageId?: string };

  // 2. Despacha conforme tipo
  if (notif.tipo === 'email') {
    if (!inscricao.email) {
      return NextResponse.json({ error: 'Inscrito não possui e-mail cadastrado.' }, { status: 422 });
    }
    resultado = await sendEmail({
      para:             inscricao.email,
      assunto:          notif.assunto ?? notif.mensagem.slice(0, 80),
      mensagem:         notif.mensagem,
      nomeDestinatario: inscricao.nome_inscrito,
    });
  } else if (notif.tipo === 'whatsapp') {
    if (!inscricao.whatsapp) {
      return NextResponse.json({ error: 'Inscrito não possui WhatsApp cadastrado.' }, { status: 422 });
    }
    resultado = await sendWhatsApp({
      para:     inscricao.whatsapp,
      mensagem: notif.mensagem,
    });
  } else {
    return NextResponse.json({ error: 'Tipo de notificação inválido.' }, { status: 400 });
  }

  // 3. Atualiza status na fila
  const { error: updErr } = await supabase
    .from('evento_notificacoes')
    .update({
      status:     resultado.sucesso ? 'enviado' : 'erro',
      enviado_em: resultado.sucesso ? new Date().toISOString() : null,
      erro:       resultado.sucesso ? null : resultado.erro,
    })
    .eq('id', notifId);

  if (updErr) {
    console.error('[NOTIF ENVIAR] Erro ao atualizar status:', updErr.message);
  }

  if (!resultado.sucesso) {
    return NextResponse.json({ error: resultado.erro }, { status: 500 });
  }

  return NextResponse.json({ sucesso: true, messageId: resultado.messageId });
}
