import { sendEmail } from '@/services/email';
import { gerarReciboAemadepaPdf, DadosReciboAemadepa } from './recibo-pdf';

export interface EnviarReciboResult {
  sucesso: boolean;
  messageId?: string;
  erro?: string;
  destinatario: string;
  numeroRecibo: string;
}

/**
 * Dispara e-mail com o recibo institucional da AEMADEPA em anexo PDF via Resend
 * Reutiliza a infraestrutura de envio existente sem expor chaves ou alterar credenciais.
 */
export async function enviarReciboAemadepaEmail(
  dados: DadosReciboAemadepa,
  destinatarioCustomizado?: string | null
): Promise<EnviarReciboResult> {
  const emailDestino = (destinatarioCustomizado || dados.associada.email || '').trim().toLowerCase();

  if (!emailDestino || !emailDestino.includes('@') || !emailDestino.includes('.')) {
    return {
      sucesso: false,
      erro: 'E-mail de destino ausente ou inválido.',
      destinatario: emailDestino || 'indefinido',
      numeroRecibo: dados.numeroRecibo,
    };
  }

  try {
    // 1. Gera o PDF do recibo em Base64
    const { base64, filename } = await gerarReciboAemadepaPdf(dados);

    // 2. Prepara mensagem amigável no padrão institucional
    const valorFormatado = Number(dados.valorPago || 0).toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    });

    const mensagemTexto =
      `Prezada ${dados.associada.nome},\n\n` +
      `Confirmamos o recebimento e a quitação da taxa referente à ${dados.viaCredencial}ª Via da sua Carteirinha Oficial da AEMADEPA.\n\n` +
      `Recibo Oficial Nº: ${dados.numeroRecibo}\n` +
      `Valor Quitado: ${valorFormatado}\n` +
      `Ministro Vinculado: ${dados.ministro.nome}\n` +
      `Data de Efetivação: ${new Date(dados.dataPagamento).toLocaleDateString('pt-BR')}\n\n` +
      `O seu comprovante oficial institucional segue em anexo a este e-mail no formato PDF.\n` +
      `Sua credencial física já foi encaminhada para a fila de confecção da Secretaria Geral da COMIEADEPA.\n\n` +
      `Atenciosamente,\n` +
      `Secretaria Geral — AEMADEPA / COMIEADEPA`;

    const htmlCustomizado = `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#fdf2f8;font-family:'Segoe UI',Arial,sans-serif;color:#1f2937;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#fdf2f8;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 14px rgba(136,19,55,0.08);border:1px solid #fbcfe8;">
        <!-- Topo Institucional -->
        <tr>
          <td style="background:linear-gradient(135deg, #881337 0%, #be185d 100%);padding:28px 32px;text-align:center;">
            <p style="margin:0;font-size:20px;font-weight:bold;color:#ffffff;letter-spacing:1px;">AEMADEPA</p>
            <p style="margin:4px 0 0;font-size:11px;color:#fce7f3;letter-spacing:1.5px;text-transform:uppercase;">
              Associação de Esposas de Ministros da COMIEADEPA
            </p>
          </td>
        </tr>
        <!-- Corpo -->
        <tr>
          <td style="padding:32px;">
            <h2 style="margin:0 0 16px;color:#881337;font-size:18px;">Pagamento Confirmado!</h2>
            <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#374151;">
              Olá, <strong>${dados.associada.nome}</strong>! Paz do Senhor.
            </p>
            <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#374151;">
              Confirmamos a quitação da taxa referente à confecção da <strong>${dados.viaCredencial}ª Via da sua Carteirinha Oficial AEMADEPA</strong>.
            </p>

            <table width="100%" style="background:#fff1f2;border:1px solid #fecdd3;border-radius:12px;padding:16px;margin-bottom:24px;">
              <tr>
                <td style="font-size:13px;line-height:1.8;">
                  <strong>Recibo Nº:</strong> ${dados.numeroRecibo}<br>
                  <strong>Valor Pago:</strong> <span style="color:#9f1239;font-weight:bold;font-size:15px;">${valorFormatado}</span><br>
                  <strong>Ministro Vinculado:</strong> ${dados.ministro.nome}<br>
                  <strong>Data do Pagamento:</strong> ${new Date(dados.dataPagamento).toLocaleDateString('pt-BR')}
                </td>
              </tr>
            </table>

            <p style="margin:0 0 12px;font-size:13px;line-height:1.6;color:#4b5563;">
              📎 <strong>Anexo:</strong> O Recibo Institucional oficial em PDF foi anexado a esta mensagem para seu controle e arquivo.
            </p>
            <p style="margin:0;font-size:13px;line-height:1.6;color:#4b5563;">
              Sua credencial física já se encontra autorizada na fila de produção da Secretaria Geral da COMIEADEPA.
            </p>
          </td>
        </tr>
        <!-- Rodapé -->
        <tr>
          <td style="background:#fff1f2;padding:20px 32px;border-top:1px solid #fbcfe8;text-align:center;">
            <p style="margin:0;font-size:11px;color:#9f1239;">
              © ${new Date().getFullYear()} AEMADEPA — COMIEADEPA • Mensagem gerada automaticamente pelo SISCOMIEADEPA
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

    // 3. Disparo via serviço central de e-mail (Resend)
    const result = await sendEmail({
      para: emailDestino,
      assunto: `Recibo Oficial AEMADEPA Nº ${dados.numeroRecibo} — Pagamento Confirmado`,
      mensagem: mensagemTexto,
      html: htmlCustomizado,
      fromName: 'AEMADEPA / COMIEADEPA',
      fromEmail: 'naoresponda@siscomieadepa.org',
      idempotencyKey: `recibo_aemadepa_${dados.solicitacaoId}_${Date.now()}`,
      attachments: [
        {
          filename,
          content: base64,
          contentType: 'application/pdf',
        },
      ],
    });

    return {
      sucesso: result.sucesso,
      messageId: result.messageId,
      erro: result.erro,
      destinatario: emailDestino,
      numeroRecibo: dados.numeroRecibo,
    };
  } catch (err: any) {
    console.error('[ENVIO RECIBO AEMADEPA] Erro:', err);
    return {
      sucesso: false,
      erro: err.message || 'Falha ao processar envio do recibo.',
      destinatario: emailDestino,
      numeroRecibo: dados.numeroRecibo,
    };
  }
}
