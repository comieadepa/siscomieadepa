import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { requireEventoAccess } from '@/lib/evento-guard';
import { sendEmail } from '@/services/email';
import { buildUrl, getAppBaseUrl, getPublicBaseUrl } from '@/lib/urls';

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

function buildLink(baseUrl: string, path: string, token: string): string {
  return buildUrl(baseUrl, `${path}?token=${token}`);
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
  const tipo = (body.tipo === 'admin' || body.tipo === 'operador') ? 'admin' : 'checkin';
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

  // Operador usa o painel principal (APP_URL); checkin usa o domínio público de eventos
  const link = tipo === 'admin'
    ? buildLink(getAppBaseUrl({ request }), '/eventos/equipe/convite', encodeURIComponent(token))
    : buildLink(getPublicBaseUrl({ request }), '/eventos/equipe/acesso', encodeURIComponent(token));

  const assunto = `Convite de acesso - ${(evento as EventoRow).nome}`;
  const tipoLabel = tipo === 'admin' ? 'Operador' : 'Check-in';
  const tipoDescricao = tipo === 'admin'
    ? 'Como <strong>Operador</strong> você poderá gerenciar inscrições e controlar o acesso ao evento.'
    : 'Como <strong>Check-in</strong> você poderá realizar a entrada dos participantes no evento.';
  const mensagem = `Ola!\n\nVoce recebeu um convite de acesso (${tipoLabel}) ao evento: ${(evento as EventoRow).nome}.\n\nAcesse pelo link abaixo:\n${link}\n\nEste link e de uso unico e expira automaticamente apos o encerramento do evento.\n\nSe nao reconhece este convite, ignore este e-mail.`;
  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f7fa;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f7fa;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);">
        <tr>
          <td style="background:#0D2B4E;padding:28px 32px;text-align:center;">
            <p style="margin:0;font-size:22px;font-weight:bold;color:#fff;letter-spacing:1px;">SISCOMIEADEPA</p>
            <p style="margin:4px 0 0;font-size:12px;color:#a0bcd4;letter-spacing:2px;text-transform:uppercase;">Assembleia de Deus no Pará</p>
          </td>
        </tr>
        <tr>
          <td style="padding:32px 32px 8px;">
            <p style="margin:0 0 12px 0;font-size:15px;color:#374151;">Olá!</p>
            <p style="margin:0 0 12px 0;font-size:15px;color:#374151;">Você recebeu um convite de acesso como <strong>${tipoLabel}</strong> ao evento:</p>
            <p style="margin:0 0 12px 0;font-size:17px;font-weight:bold;color:#0D2B4E;">${(evento as EventoRow).nome}</p>
            <p style="margin:0 0 24px 0;font-size:14px;color:#6b7280;">${tipoDescricao}</p>
            <table cellpadding="0" cellspacing="0" style="margin:0 auto 24px;">
              <tr>
                <td align="center" style="background:#0D2B4E;border-radius:8px;padding:14px 32px;">
                  <a href="${link}" style="color:#ffffff;font-size:16px;font-weight:bold;text-decoration:none;display:block;">Acessar Evento</a>
                </td>
              </tr>
            </table>
            <p style="margin:0 0 8px 0;font-size:12px;color:#9ca3af;">Se o botão não funcionar, copie e cole este link no navegador:</p>
            <p style="margin:0 0 24px 0;font-size:11px;color:#6b7280;word-break:break-all;">${link}</p>
          </td>
        </tr>
        <tr>
          <td style="background:#f8f9fa;padding:20px 32px;border-top:1px solid #e5e7eb;">
            <p style="margin:0;font-size:11px;color:#9ca3af;text-align:center;">
              Este link é de uso único e expira automaticamente após o encerramento do evento.<br>
              Se não reconhece este convite, ignore este e-mail.<br><br>
              Mensagem automática do sistema SISCOMIEADEPA — não responda.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const targetEmail = email || equipe?.email || '';
  if (!targetEmail) {
    return NextResponse.json({ error: 'E-mail do convite nao encontrado.' }, { status: 400 });
  }

  const resultado = await sendEmail({
    para: targetEmail,
    assunto,
    mensagem,
    html,
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
