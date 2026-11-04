import crypto from 'node:crypto';

/**
 * Cria token HMAC assinado garantindo integridade e expiração (15 minutos)
 */
export function signAemadepaToken(ministroId: string, operacao: 'primeiro_cadastro' | 'edicao_esposa'): string {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY || 'siscomieadepa-aemadepa-hmac-secret-salt-2026';
  const expiresAt = Date.now() + 15 * 60 * 1000; // 15 minutos
  const payload = JSON.stringify({ ministroId, operacao, exp: expiresAt });
  const payloadBase64 = Buffer.from(payload, 'utf8').toString('base64url');
  const hmac = crypto.createHmac('sha256', secret).update(payloadBase64).digest('base64url');
  return `${payloadBase64}.${hmac}`;
}

export function verifyAemadepaToken(token: string, ministroId: string): { valid: boolean; operacao?: string } {
  if (!token || typeof token !== 'string') return { valid: false };
  const parts = token.split('.');
  if (parts.length !== 2) return { valid: false };

  const [payloadBase64, signature] = parts;
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY || 'siscomieadepa-aemadepa-hmac-secret-salt-2026';
  const expectedHmac = crypto.createHmac('sha256', secret).update(payloadBase64).digest('base64url');

  if (signature !== expectedHmac) return { valid: false };

  try {
    const payloadStr = Buffer.from(payloadBase64, 'base64url').toString('utf8');
    const payload = JSON.parse(payloadStr);

    if (payload.ministroId !== ministroId) return { valid: false };
    if (!payload.exp || Date.now() > payload.exp) return { valid: false };

    return { valid: true, operacao: payload.operacao };
  } catch {
    return { valid: false };
  }
}
