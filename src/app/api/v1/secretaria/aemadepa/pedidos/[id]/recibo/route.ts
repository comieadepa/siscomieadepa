/**
 * GET /api/v1/secretaria/aemadepa/pedidos/[id]/recibo
 * Baixa o recibo oficial em PDF de uma solicitação de carteirinha AEMADEPA paga.
 *
 * POST /api/v1/secretaria/aemadepa/pedidos/[id]/recibo
 * Envia o recibo oficial em PDF por e-mail via Resend, permitindo destinatário customizado.
 *
 * Restrições e Segurança:
 * - Acesso restrito a operadores autorizados no módulo 'aemadepa' (requireModuleAccess).
 * - Bloqueio estrito se o pagamento não estiver confirmado.
 * - Registro em auditoria (logDB) e observações da solicitação para rastreabilidade de reenvios.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/auth/require-auth';
import { createServerClient } from '@/lib/supabase-server';
import { logDB } from '@/lib/audit';
import { obterDadosReciboAemadepa } from '@/lib/aemadepa/recibo-service';
import { gerarReciboAemadepaPdf } from '@/lib/aemadepa/recibo-pdf';
import { enviarReciboAemadepaEmail } from '@/lib/aemadepa/recibo-email-service';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireModuleAccess(request, 'aemadepa');
  if (!auth.ok) return auth.response;

  const { id: solicitacaoId } = await params;
  if (!solicitacaoId) {
    return NextResponse.json({ error: 'ID da solicitação não informado.' }, { status: 400 });
  }

  const { ok, dados, erro, codigoHttp } = await obterDadosReciboAemadepa(solicitacaoId);
  if (!ok || !dados) {
    return NextResponse.json({ error: erro || 'Erro ao carregar dados do recibo.' }, { status: codigoHttp || 400 });
  }

  try {
    const { base64, filename } = await gerarReciboAemadepaPdf(dados);
    const pdfBuffer = Buffer.from(base64, 'base64');

    void logDB({
      acao: 'visualizar',
      modulo: 'secretaria',
      entidade: 'aemadepa_recibo',
      entidadeId: solicitacaoId,
      descricao: `Download do recibo institucional ${dados.numeroRecibo} (${dados.associada.nome})`,
      status: 'sucesso',
      detalhes: {
        solicitacaoId,
        numeroRecibo: dados.numeroRecibo,
        operadorId: auth.ctx?.userId,
      },
    });

    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store, max-age=0',
      },
    });
  } catch (pdfErr: any) {
    console.error('[RECIBO AEMADEPA GET] Falha ao gerar PDF:', pdfErr);
    return NextResponse.json({ error: 'Erro ao gerar o arquivo PDF do recibo.' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireModuleAccess(request, 'aemadepa');
  if (!auth.ok) return auth.response;

  const { id: solicitacaoId } = await params;
  if (!solicitacaoId) {
    return NextResponse.json({ error: 'ID da solicitação não informado.' }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const emailDestino = body?.emailDestino ? String(body.emailDestino).trim() : null;

  const { ok, dados, erro, codigoHttp } = await obterDadosReciboAemadepa(solicitacaoId);
  if (!ok || !dados) {
    return NextResponse.json({ error: erro || 'Erro ao carregar dados do recibo.' }, { status: codigoHttp || 400 });
  }

  try {
    const resEnvio = await enviarReciboAemadepaEmail(dados, emailDestino);

    // Registra a tentativa de envio nas observações do pedido para histórico
    const supabase = createServerClient();
    const dataHoraStr = new Date().toLocaleString('pt-BR', { timeZone: 'America/Belem' });
    const statusMsg = resEnvio.sucesso
      ? `[Recibo Enviado em ${dataHoraStr}] Nº ${dados.numeroRecibo} para ${resEnvio.destinatario} (MessageID: ${resEnvio.messageId || 'simulado'})`
      : `[Tentativa de Envio em ${dataHoraStr}] Falha ao enviar para ${resEnvio.destinatario}: ${resEnvio.erro}`;

    const { data: solAtual } = await supabase
      .from('aemadepa_carteirinhas_solicitacoes')
      .select('observacoes')
      .eq('id', solicitacaoId)
      .maybeSingle();

    const novasObservacoes = solAtual?.observacoes
      ? `${solAtual.observacoes}\n${statusMsg}`
      : statusMsg;

    await supabase
      .from('aemadepa_carteirinhas_solicitacoes')
      .update({
        observacoes: novasObservacoes,
        updated_at: new Date().toISOString(),
      })
      .eq('id', solicitacaoId);

    void logDB({
      acao: 'enviar_email',
      modulo: 'secretaria',
      entidade: 'aemadepa_recibo',
      entidadeId: solicitacaoId,
      descricao: resEnvio.sucesso
        ? `Recibo institucional ${dados.numeroRecibo} enviado por e-mail para ${resEnvio.destinatario}`
        : `Falha ao enviar recibo ${dados.numeroRecibo} para ${resEnvio.destinatario}`,
      status: resEnvio.sucesso ? 'sucesso' : 'erro',
      detalhes: {
        solicitacaoId,
        numeroRecibo: dados.numeroRecibo,
        destinatario: resEnvio.destinatario,
        messageId: resEnvio.messageId,
        erro: resEnvio.erro,
        operadorId: auth.ctx?.userId,
      },
    });

    if (!resEnvio.sucesso) {
      return NextResponse.json(
        {
          sucesso: false,
          error: resEnvio.erro || 'Não foi possível enviar o e-mail.',
          destinatario: resEnvio.destinatario,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      sucesso: true,
      mensagem: `Recibo ${dados.numeroRecibo} enviado com sucesso para ${resEnvio.destinatario}!`,
      messageId: resEnvio.messageId,
      destinatario: resEnvio.destinatario,
      numeroRecibo: dados.numeroRecibo,
    });
  } catch (err: any) {
    console.error('[RECIBO AEMADEPA POST] Falha no envio do e-mail:', err);
    return NextResponse.json({ error: err.message || 'Erro interno ao disparar envio do recibo.' }, { status: 500 });
  }
}
