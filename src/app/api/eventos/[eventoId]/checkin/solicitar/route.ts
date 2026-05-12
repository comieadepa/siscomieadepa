import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { createServerClient } from '@/lib/supabase-server';
import { sendEmail } from '@/services/email';
import { buildUrl, getPublicBaseUrl } from '@/lib/urls';

type EventoRow = {
  id: string;
  nome: string;
  status: 'programado' | 'realizado' | 'cancelado';
  data_fim: string | null;
};

function endOfDayUtc(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1, 23, 59, 59, 999));
}

function calcExpiraEm(dataFim: string | null): string {
  const base = dataFim ? endOfDayUtc(dataFim) : new Date();
  const exp = new Date(base.getTime() + 48 * 60 * 60 * 1000);
  return exp.toISOString();
}

function buildLink(baseUrl: string, token: string): string {
  return buildUrl(baseUrl, `/eventos/equipe/acesso?token=${token}`);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;
  let body: { email?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body invalido.' }, { status: 400 });
  }

  const email = (body.email || '').trim().toLowerCase();
  if (!email) {
    return NextResponse.json({ error: 'E-mail obrigatorio.' }, { status: 400 });
  }

  const supabase = createServerClient();

  const { data: evento } = await supabase
    .from('eventos')
    .select('id,nome,status,data_fim,checkin_ativo')
    .eq('id', eventoId)
    .single();

  if (!evento) {
    return NextResponse.json({ error: 'Evento nao encontrado.' }, { status: 404 });
  }

  if ((evento as EventoRow).status !== 'programado') {
    return NextResponse.json({ error: 'Evento encerrado ou cancelado.' }, { status: 403 });
  }

  if ((evento as EventoRow & { checkin_ativo?: boolean | null }).checkin_ativo !== true) {
    return NextResponse.json({ error: 'Check-in desativado.' }, { status: 403 });
  }

  const { data: equipe } = await supabase
    .from('evento_equipe')
    .select('id,email,tipo,ativo')
    .eq('evento_id', eventoId)
    .eq('email', email)
    .in('tipo', ['checkin', 'admin'])
    .maybeSingle();

  if (!equipe || equipe.ativo !== true) {
    return NextResponse.json({ error: 'E-mail nao autorizado para check-in.' }, { status: 403 });
  }

  const token = randomBytes(32).toString('hex');
  const expiraEm = calcExpiraEm((evento as EventoRow).data_fim);
  if (new Date(expiraEm).getTime() < Date.now()) {
    return NextResponse.json({ error: 'Convite expirado.' }, { status: 422 });
  }

  const { error: updError } = await supabase
    .from('evento_equipe')
    .update({
      convite_token: token,
      convite_expira_em: expiraEm,
      convite_usado_em: null,
      ativo: true,
    })
    .eq('id', equipe.id);

  if (updError) {
    return NextResponse.json({ error: 'Erro ao gerar acesso.' }, { status: 500 });
  }

  const baseUrl = getPublicBaseUrl({ request });
  const link = buildLink(baseUrl, token);

  const assunto = `Acesso ao check-in - ${(evento as EventoRow).nome}`;
  const mensagem = `Ola!\n\nVoce solicitou acesso ao check-in do evento ${(evento as EventoRow).nome}.\n\nAcesse pelo link:\n${link}\n\nEste link expira automaticamente apos o encerramento do evento ou em 48h apos a data final.`;

  const resultado = await sendEmail({
    para: email,
    assunto,
    mensagem,
    fromEmail: 'naoresponda@siscomieadepa.org',
  });

  if (!resultado.sucesso) {
    return NextResponse.json({ error: resultado.erro || 'Falha ao enviar e-mail.' }, { status: 500 });
  }

  const simulado = resultado.provider === 'simulate';

  return NextResponse.json({
    ok: true,
    simulado,
    link: simulado ? link : undefined,
    expira_em: expiraEm,
  });
}
