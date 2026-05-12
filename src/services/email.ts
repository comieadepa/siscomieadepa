/**
 * Serviço de envio de e-mail — Módulo Eventos
 *
 * Provider: Resend (já configurado no projeto via RESEND_API_KEY)
 * NÃO iniciar envio real até configurar templates e validar domínio.
 *
 * Para ativar: trocar SIMULATE_EMAIL para false e descomentar o bloco Resend.
 */

// Para simular envio: defina SIMULATE_EMAIL=true nas variáveis de ambiente
const SIMULATE_EMAIL = process.env.SIMULATE_EMAIL === 'true';

export interface EmailPayload {
  para:     string;         // e-mail do destinatário
  assunto:  string;
  mensagem: string;         // texto puro (será convertido para HTML)
  nomeDestinatario?: string;
  html?:    string;         // HTML opcional para templates customizados
  fromName?: string;
  fromEmail?: string;
  from?: string;
}

export interface EmailResult {
  sucesso:    boolean;
  provider?:  string;
  messageId?: string;
  erro?:      string;
}

/**
 * Renderiza o HTML institucional do e-mail.
 * Estilo simples, compatível com a maioria dos clientes de e-mail.
 */
function renderHtml(payload: EmailPayload): string {
  const paragrafos = payload.mensagem
    .split('\n')
    .map(linha => linha.trim() ? `<p style="margin:0 0 10px 0;line-height:1.6;">${linha}</p>` : '<br/>')
    .join('');

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f7fa;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f7fa;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);">
        <!-- Header -->
        <tr>
          <td style="background:#0D2B4E;padding:28px 32px;text-align:center;">
            <p style="margin:0;font-size:22px;font-weight:bold;color:#fff;letter-spacing:1px;">SISCOMIEADEPA</p>
            <p style="margin:4px 0 0;font-size:12px;color:#a0bcd4;letter-spacing:2px;text-transform:uppercase;">Assembleia de Deus no Pará</p>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:32px 32px 24px;">
            <p style="margin:0 0 20px 0;font-size:15px;color:#374151;">${paragrafos}</p>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="background:#f8f9fa;padding:20px 32px;border-top:1px solid #e5e7eb;">
            <p style="margin:0;font-size:11px;color:#9ca3af;text-align:center;">
              Esta é uma mensagem automática do sistema SISCOMIEADEPA.<br>
              Não responda a este e-mail.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/**
 * Envia um e-mail via Resend.
 * Em modo simulação apenas loga e retorna sucesso.
 */
export async function sendEmail(payload: EmailPayload): Promise<EmailResult> {
  if (SIMULATE_EMAIL) {
    console.log('[EMAIL SERVICE] Simulação — seria enviado para:', payload.para, '| Assunto:', payload.assunto);
    return { sucesso: true, provider: 'simulate', messageId: `sim_${Date.now()}` };
  }

  // ── Envio real via Resend ───────────────────────────────────
  try {
    const fromEmail = payload.fromEmail || process.env.RESEND_FROM_EMAIL || 'naoresponda@siscomieadepa.org';
    const fromName = payload.fromName || process.env.RESEND_FROM_NAME || 'SISCOMIEADEPA';
    const from = payload.from || process.env.RESEND_FROM || `${fromName} <${fromEmail}>`;
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        from,
        to:      [payload.para],
        subject: payload.assunto,
        html:    payload.html ?? renderHtml(payload),
        text:    payload.mensagem,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      return { sucesso: false, provider: 'resend', erro: err };
    }

    const json = await res.json();
    return { sucesso: true, provider: 'resend', messageId: json.id };

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { sucesso: false, provider: 'resend', erro: msg };
  }
}
