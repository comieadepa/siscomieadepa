/**
 * POST /api/portal-ministro/auth/forgot-password
 * Solicita redefinição de senha para ministro via e-mail previamente homologado na Secretaria.
 * Aceita CPF ou E-mail.
 * Gera token temporário de uso único (15 minutos) e envia e-mail institucional.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { consumeDistributedRateLimit } from '@/lib/rate-limit-distributed';
import { sendEmail } from '@/services/email';
import crypto from 'crypto';

const RATE_LIMIT_ATTEMPTS = 5;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RESET_TOKEN_EXPIRATION_MINUTES = 15;

const cleanCpf = (v: string) => v.replace(/\D/g, '');

function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]?.trim() || 'unknown';
  return request.headers.get('x-real-ip') || 'unknown';
}

function maskEmail(email: string): string {
  const trimmed = (email || '').trim();
  if (!trimmed || !trimmed.includes('@')) return '';
  const [user, domain] = trimmed.split('@');
  if (user.length <= 2) {
    return `${user[0]}***@${domain}`;
  }
  const first = user[0];
  const last = user[user.length - 1];
  return `${first}***${last}@${domain}`;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const rawIdentificador = String(body?.identificador || body?.email || body?.cpf || '').trim();
    const cleanIdentificador = cleanCpf(rawIdentificador);
    const isEmail = rawIdentificador.includes('@');

    if (!rawIdentificador) {
      return NextResponse.json({ error: 'Informe seu CPF ou E-mail.' }, { status: 400 });
    }

    if (!isEmail && cleanIdentificador.length !== 11) {
      return NextResponse.json({ error: 'CPF inválido.' }, { status: 400 });
    }

    const ip = getClientIp(request);
    const rateKey = isEmail
      ? `portal-ministro:forgot-password:${ip}:${rawIdentificador.toLowerCase()}`
      : `portal-ministro:forgot-password:${ip}:${cleanIdentificador}`;

    const rate = await consumeDistributedRateLimit({
      key: rateKey,
      limit: RATE_LIMIT_ATTEMPTS,
      windowMs: RATE_LIMIT_WINDOW_MS,
    });

    if (!rate.allowed) {
      return NextResponse.json(
        { error: 'Muitas tentativas. Aguarde um minuto antes de tentar novamente.' },
        {
          status: 429,
          headers: {
            'Retry-After': String(rate.retryAfterSeconds),
          },
        },
      );
    }

    const supabase = createServerClient();

    // Busca ministro ativo
    let query = supabase
      .from('members')
      .select('id, name, email, cpf, status, custom_fields')
      .in('status', ['active']);

    if (isEmail) {
      query = query.ilike('email', rawIdentificador.toLowerCase());
    } else {
      query = query.eq('cpf', cleanIdentificador);
    }

    const { data: ministros, error: mErr } = await query;

    if (mErr) {
      console.error('[forgot-password] Erro ao buscar ministro:', mErr.message);
      return NextResponse.json({ error: 'Erro interno ao processar solicitação.' }, { status: 500 });
    }

    // Se houver mais de um registro ativo com o mesmo e-mail (caso raro em cadastros legados)
    if (ministros && ministros.length > 1) {
      return NextResponse.json({
        ok: false,
        error: 'Mais de um cadastro localizado para este e-mail. Por favor, solicite a recuperação utilizando seu CPF.',
      }, { status: 409 });
    }

    const ministro = ministros?.[0] || null;

    const cf = (ministro?.custom_fields && typeof ministro.custom_fields === 'object')
      ? (ministro.custom_fields as Record<string, any>)
      : {};
    const emailDestino = String(ministro?.email || cf.email || '').trim().toLowerCase();

    const isEmailValido =
      emailDestino &&
      emailDestino.includes('@') &&
      !emailDestino.includes(' ') &&
      !emailDestino.includes('desligado') &&
      !emailDestino.includes('falecido');

    // Prevenção de enumeração: se não existir, estiver inativo ou sem e-mail confiável
    if (!ministro || ministro.status !== 'active' || !isEmailValido) {
      return NextResponse.json({
        ok: true,
        emailMascarado: null,
        message: 'Se o dado informado estiver cadastrado e possuir e-mail válido homologado pela Secretaria Geral, as instruções de recuperação foram enviadas.',
      });
    }

    // Invalida tokens anteriores não utilizados deste ministro
    await supabase
      .from('ministro_portal_password_resets')
      .update({ used: true, used_at: new Date().toISOString() })
      .eq('ministro_id', ministro.id)
      .eq('used', false);

    // Gera token criptograficamente seguro de uso único
    const rawToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + RESET_TOKEN_EXPIRATION_MINUTES * 60 * 1000).toISOString();

    const { error: insertErr } = await supabase
      .from('ministro_portal_password_resets')
      .insert({
        ministro_id: ministro.id,
        token: rawToken,
        expires_at: expiresAt,
        used: false,
        ip_requested: ip,
      });

    if (insertErr) {
      console.error('[forgot-password] Erro ao criar token de recuperação:', insertErr.message);
      return NextResponse.json({ error: 'Erro ao gerar link de recuperação.' }, { status: 500 });
    }

    // Monta URL de recuperação
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || '';
    const resetUrl = `${baseUrl}/portal-ministro/redefinir-senha?token=${rawToken}`;

    const htmlMensagem = `
      <div style="font-family: Arial, sans-serif; color: #1f2937; line-height: 1.6;">
        <p style="font-size: 16px; margin-bottom: 16px;">Prezado(a) <strong>${ministro.name}</strong>,</p>
        <p style="margin-bottom: 16px;">
          Recebemos uma solicitação para redefinir a sua senha de acesso ao <strong>Portal / Aplicativo do Ministro SISCOMIEADEPA</strong>.
        </p>
        <p style="margin-bottom: 24px;">
          Para cadastrar uma nova senha, clique no botão abaixo ou utilize o link. Este link é de uso único e expira em <strong>${RESET_TOKEN_EXPIRATION_MINUTES} minutos</strong>:
        </p>
        <div style="text-align: center; margin: 32px 0;">
          <a href="${resetUrl}" style="background-color: #0D2B4E; color: #ffffff; padding: 14px 28px; font-weight: bold; text-decoration: none; border-radius: 8px; font-size: 15px; display: inline-block; box-shadow: 0 4px 12px rgba(13,43,78,0.25);">
            Redefinir Minha Senha
          </a>
        </div>
        <p style="font-size: 12px; color: #6b7280; word-break: break-all; margin-top: 24px;">
          Ou copie e cole o link no seu navegador:<br/>
          <a href="${resetUrl}" style="color: #0D2B4E;">${resetUrl}</a>
        </p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
        <p style="font-size: 12px; color: #9ca3af; margin: 0;">
          Se você não solicitou a alteração de senha, ignore este e-mail. Seu acesso continuará seguro.
        </p>
      </div>
    `;

    await sendEmail({
      para: emailDestino,
      assunto: 'Recuperação de Senha — Portal do Ministro COMIEADEPA',
      mensagem: `Olá ${ministro.name}, acesse o link para redefinir sua senha: ${resetUrl}`,
      html: htmlMensagem,
      nomeDestinatario: ministro.name,
    });

    const emailMascarado = maskEmail(emailDestino);

    return NextResponse.json({
      ok: true,
      emailMascarado,
      message: `Enviamos as instruções de recuperação para o e-mail previamente cadastrado (${emailMascarado}).`,
    });
  } catch (err) {
    console.error('[forgot-password] Erro inesperado:', err);
    return NextResponse.json({ error: 'Erro interno no servidor.' }, { status: 500 });
  }
}
