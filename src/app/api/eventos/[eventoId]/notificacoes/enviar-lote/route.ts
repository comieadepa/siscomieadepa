import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { sendEmail } from '@/services/email';
import { sendWhatsApp } from '@/services/whatsapp';

// POST /api/eventos/[eventoId]/notificacoes/enviar-lote
// Body: { ids: string[] }  — envia múltiplas notificações em lote (máx 50)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;
  const body = await request.json();
  const ids: string[] = Array.isArray(body?.ids) ? body.ids.slice(0, 50) : [];

  if (ids.length === 0) {
    return NextResponse.json({ error: 'Informe ao menos um ID.' }, { status: 400 });
  }

  const supabase = createServerClient();

  const { data: notifs, error } = await supabase
    .from('evento_notificacoes')
    .select(`
      id, tipo, assunto, mensagem,
      evento_inscricoes!inner ( nome_inscrito, email, whatsapp )
    `)
    .eq('evento_id', eventoId)
    .in('id', ids);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const resultados: { id: string; sucesso: boolean; erro?: string }[] = [];

  for (const notif of notifs ?? []) {
    const insc = notif.evento_inscricoes as unknown as {
      nome_inscrito: string;
      email: string | null;
      whatsapp: string | null;
    };

    let res: { sucesso: boolean; erro?: string };

    if (notif.tipo === 'email' && insc.email) {
      res = await sendEmail({
        para:             insc.email,
        assunto:          notif.assunto ?? '',
        mensagem:         notif.mensagem,
        nomeDestinatario: insc.nome_inscrito,
      });
    } else if (notif.tipo === 'whatsapp' && insc.whatsapp) {
      res = await sendWhatsApp({ para: insc.whatsapp, mensagem: notif.mensagem });
    } else {
      res = { sucesso: false, erro: 'Destinatário sem contato cadastrado.' };
    }

    // Atualiza status
    await supabase
      .from('evento_notificacoes')
      .update({
        status:     res.sucesso ? 'enviado' : 'erro',
        enviado_em: res.sucesso ? new Date().toISOString() : null,
        erro:       res.sucesso ? null : res.erro,
      })
      .eq('id', notif.id);

    resultados.push({ id: notif.id, ...res });
  }

  const enviados = resultados.filter(r => r.sucesso).length;
  const erros    = resultados.filter(r => !r.sucesso).length;

  return NextResponse.json({ enviados, erros, resultados });
}
