import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { requireEventoAccess } from '@/lib/evento-guard';
import { sendEmail } from '@/services/email';
import { buildUrl, getPublicBaseUrl } from '@/lib/urls';

type EventoRow = {
  id: string;
  nome: string;
  status: 'programado' | 'realizado' | 'cancelado';
  data_fim: string | null;
};

type EquipeRow = {
  id: string;
  evento_id: string;
  email: string;
  tipo: 'admin' | 'checkin';
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

  const guard = await requireEventoAccess(request, eventoId);
  if (!guard.ok) return guard.response;
  if (!guard.ctx.perms.podeCriarEquipe) {
    return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
  }

  let body: { email?: string; tipo?: string; equipe_id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body invalido.' }, { status: 400 });
  }

  const email = (body.email || '').trim().toLowerCase();
  const tipo = body.tipo === 'admin' ? 'admin' : 'checkin';
  const equipeId = (body.equipe_id || '').trim();

  if (!equipeId && !email) {
    return NextResponse.json({ error: 'E-mail obrigatorio.' }, { status: 400 });
  }

  const supabase = guard.ctx.supabaseAdmin;

  const { data: evento } = await supabase
    .from('eventos')
    .select('id,nome,status,data_fim')
    .eq('id', eventoId)
    .single();

  if (!evento) {
    return NextResponse.json({ error: 'Evento nao encontrado.' }, { status: 404 });
  }

  if ((evento as EventoRow).status !== 'programado') {
    return NextResponse.json({ error: 'Evento encerrado ou cancelado.' }, { status: 422 });
  }

  let equipe: EquipeRow | null = null;

  if (equipeId) {
    const { data } = await supabase
      .from('evento_equipe')
      .select('id,evento_id,email,tipo')
      .eq('id', equipeId)
      .eq('evento_id', eventoId)
      .single();
    equipe = (data as EquipeRow) || null;
    if (!equipe) {
      return NextResponse.json({ error: 'Equipe nao encontrada.' }, { status: 404 });
    }
  } else if (email) {
    const { data } = await supabase
      .from('evento_equipe')
      .select('id,evento_id,email,tipo')
      .eq('evento_id', eventoId)
      .eq('email', email)
      .maybeSingle();
    equipe = (data as EquipeRow) || null;
  }

  const token = randomBytes(32).toString('hex');
  const expiraEm = calcExpiraEm((evento as EventoRow).data_fim);
  if (new Date(expiraEm).getTime() < Date.now()) {
    return NextResponse.json({ error: 'Convite expirado.' }, { status: 422 });
  }

  let equipeIdFinal = equipe?.id || '';

  if (equipe) {
    const { error } = await supabase
      .from('evento_equipe')
      .update({
        email: email || equipe.email,
        tipo,
        ativo: true,
        convite_token: token,
        convite_expira_em: expiraEm,
        convite_usado_em: null,
      })
      .eq('id', equipe.id);
    if (error) {
      return NextResponse.json({ error: 'Erro ao atualizar convite.' }, { status: 500 });
    }
    equipeIdFinal = equipe.id;
  } else {
    const { data, error } = await supabase
      .from('evento_equipe')
      .insert([{
        evento_id: eventoId,
        email,
        tipo,
        ativo: true,
        convite_token: token,
        convite_expira_em: expiraEm,
      }])
      .select('id')
      .single();
    if (error) {
      return NextResponse.json({ error: 'Erro ao criar convite.' }, { status: 500 });
    }
    equipeIdFinal = (data as { id: string } | null)?.id || '';
  }

  const baseUrl = getPublicBaseUrl({ request });
  const link = buildLink(baseUrl, token);

  const assunto = `Convite de acesso - ${(evento as EventoRow).nome}`;
  const mensagem = `Ola!\n\nVoce recebeu um convite de acesso ao evento ${(evento as EventoRow).nome}.\n\nAcesse pelo link:\n${link}\n\nEste link expira automaticamente apos o encerramento do evento ou em 48h apos a data final.`;

  const targetEmail = email || equipe?.email || '';
  if (!targetEmail) {
    return NextResponse.json({ error: 'E-mail do convite nao encontrado.' }, { status: 400 });
  }

  const resultado = await sendEmail({
    para: targetEmail,
    assunto,
    mensagem,
    fromEmail: 'naoresponda@siscomieadepa.org',
  });

  if (!resultado.sucesso) {
    return NextResponse.json({ error: resultado.erro || 'Falha ao enviar e-mail.' }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    link,
    simulado: resultado.provider === 'simulate',
    expira_em: expiraEm,
    equipe_id: equipeIdFinal || undefined,
  });
}
