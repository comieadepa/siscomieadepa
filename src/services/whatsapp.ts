/**
 * Serviço de envio de WhatsApp — Módulo Eventos
 *
 * Arquitetura preparada para integração futura com:
 * - Z-API (https://z-api.io)
 * - Evolution API (self-hosted)
 * - Twilio WhatsApp
 *
 * NÃO enviar mensagens reais ainda.
 * SIMULATE_WHATSAPP = true bloqueia envio e apenas loga.
 *
 * Para ativar: trocar para false e configurar provider.
 */

const SIMULATE_WHATSAPP = true; // Mude para false quando pronto para produção

// ── Tipos de provider suportados (extensível) ──────────────
type WhatsAppProvider = 'zapi' | 'evolution' | 'twilio' | 'simulate';

export interface WhatsAppPayload {
  para:      string; // número com DDD: 91999999999 (sem + ou espaços)
  mensagem:  string;
  tipo?:     'text' | 'template'; // extensível para templates do Meta
}

export interface WhatsAppResult {
  sucesso:    boolean;
  provider:   WhatsAppProvider;
  messageId?: string;
  erro?:      string;
}

/**
 * Normaliza número de telefone para formato E.164 sem +.
 * Entrada: (91) 9 9999-9999, +55 91 99999-9999, etc.
 * Saída:   5591999999999
 */
export function normalizarTelefone(tel: string): string {
  const digits = tel.replace(/\D/g, '');
  // Já tem DDI Brasil (55)
  if (digits.startsWith('55') && digits.length >= 12) return digits;
  // Adiciona DDI Brasil
  return '55' + digits;
}

/**
 * Monta o payload específico para Z-API.
 */
function buildZApiPayload(numero: string, mensagem: string) {
  return {
    phone:   numero,
    message: mensagem,
  };
}

/**
 * Envia mensagem WhatsApp.
 * Em modo simulação apenas loga e retorna sucesso.
 */
export async function sendWhatsApp(payload: WhatsAppPayload): Promise<WhatsAppResult> {
  const numero = normalizarTelefone(payload.para);

  if (SIMULATE_WHATSAPP) {
    console.log('[WHATSAPP SERVICE] Simulação — seria enviado para:', numero, '| Mensagem:', payload.mensagem.slice(0, 80) + '...');
    return { sucesso: true, provider: 'simulate', messageId: `sim_wa_${Date.now()}` };
  }

  const provider = (process.env.WHATSAPP_PROVIDER ?? 'zapi') as WhatsAppProvider;

  // ── Z-API ───────────────────────────────────────────────────
  if (provider === 'zapi') {
    const instanceId = process.env.ZAPI_INSTANCE_ID;
    const token      = process.env.ZAPI_TOKEN;
    const clientToken= process.env.ZAPI_CLIENT_TOKEN;

    if (!instanceId || !token) {
      return { sucesso: false, provider, erro: 'ZAPI_INSTANCE_ID ou ZAPI_TOKEN não configurados.' };
    }

    try {
      const res = await fetch(`https://api.z-api.io/instances/${instanceId}/token/${token}/send-text`, {
        method:  'POST',
        headers: {
          'Content-Type':    'application/json',
          'Client-Token':    clientToken ?? '',
        },
        body: JSON.stringify(buildZApiPayload(numero, payload.mensagem)),
      });

      if (!res.ok) {
        const err = await res.text();
        return { sucesso: false, provider, erro: err };
      }

      const json = await res.json();
      return { sucesso: true, provider, messageId: json.messageId ?? json.id };

    } catch (err: unknown) {
      return { sucesso: false, provider, erro: err instanceof Error ? err.message : String(err) };
    }
  }

  // ── Twilio ──────────────────────────────────────────────────
  if (provider === 'twilio') {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken  = process.env.TWILIO_AUTH_TOKEN;
    const from       = process.env.TWILIO_WHATSAPP_FROM ?? 'whatsapp:+14155238886';

    if (!accountSid || !authToken) {
      return { sucesso: false, provider, erro: 'Twilio não configurado.' };
    }

    try {
      const body = new URLSearchParams({
        From: from,
        To:   `whatsapp:+${numero}`,
        Body: payload.mensagem,
      });

      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
        method:  'POST',
        headers: {
          'Authorization': 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
          'Content-Type':  'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      });

      if (!res.ok) {
        const err = await res.text();
        return { sucesso: false, provider, erro: err };
      }

      const json = await res.json();
      return { sucesso: true, provider, messageId: json.sid };

    } catch (err: unknown) {
      return { sucesso: false, provider, erro: err instanceof Error ? err.message : String(err) };
    }
  }

  return { sucesso: false, provider, erro: 'Provider WhatsApp não configurado.' };
}
