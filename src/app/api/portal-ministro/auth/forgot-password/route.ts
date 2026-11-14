/**
 * POST /api/portal-ministro/auth/forgot-password
 * Solicita redefinição de senha para ministro via e-mail.
 * Aceita E-mail como entrada principal (ou CPF para auxílio na busca).
 * Gera token temporário de uso único (15 minutos) e envia e-mail institucional via Resend.
 * Prevenção de enumeração: sempre retorna sucesso aparente com mensagem segura.
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
    const rawIdentificador = String(body?.email || body?.identificador || '').trim().toLowerCase();
    const isEmail = rawIdentificador.includes('@');
    const cleanIdentificador = cleanCpf(rawIdentificador);

    if (!rawIdentificador) {
      return NextResponse.json({ error: 'Informe seu e-mail cadastrado.' }, { status: 400 });
    }

    const ip = getClientIp(request);
    const rateKey = `portal-ministro:forgot-password:${ip}:${rawIdentificador}`;

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
          headers: { 'Retry-After': String(rate.retryAfterSeconds) },
        },
      );
    }

    const supabase = createServerClient();

    // 1. Busca ministro ativo pelo e-mail (ou CPF)
    let ministroId: string | null = null;
    let ministroNome: string = 'Ministro';
    let emailDestino: string = '';

    if (isEmail) {
      // Busca em accounts primeiro
      const { data: acc } = await supabase
        .from('ministro_portal_accounts')
        .select('ministro_id, email, email_confirmed')
        .ilike('email', rawIdentificador)
        .eq('email_confirmed', true)
        .maybeSingle();

      if (acc) {
        ministroId = acc.ministro_id;
        emailDestino = acc.email || rawIdentificador;
      } else {
        // Fallback em members
        const { data: member } = await supabase
          .from('members')
          .select('id, name, email, status')
          .ilike('email', rawIdentificador)
          .eq('status', 'active')
          .maybeSingle();

        if (member) {
          ministroId = member.id;
          ministroNome = member.name;
          emailDestino = member.email || rawIdentificador;
        }
      }
    } else if (cleanIdentificador.length === 11) {
      const { data: member } = await supabase
        .from('members')
        .select('id, name, email, status')
        .eq('cpf', cleanIdentificador)
        .eq('status', 'active')
        .maybeSingle();

      if (member) {
        ministroId = member.id;
        ministroNome = member.name;
        emailDestino = member.email || '';
      }
    }

    // Se encontrou ministroId, busca nome atualizado caso ainda esteja genérico
    if (ministroId && ministroNome === 'Ministro') {
      const { data: m } = await supabase
        .from('members')
        .select('name, status')
        .eq('id', ministroId)
        .maybeSingle();
      if (m && m.status === 'active') {
        ministroNome = m.name;
      } else if (m && m.status !== 'active') {
        ministroId = null; // Inativo: não envia link
      }
    }

    // Prevenção de enumeração: sempre responde mensagem genérica
    if (!ministroId || !emailDestino || !emailDestino.includes('@')) {
      return NextResponse.json({
        ok: true,
        message: 'Se o e-mail informado estiver cadastrado e ativo, enviamos as instruções para a redefinição de senha.',
      });
    }

    // 2. Invalida tokens anteriores não utilizados deste ministro
    await supabase
      .from('ministro_portal_password_resets')
      .update({ used: true, used_at: new Date().toISOString() })
      .eq('ministro_id', ministroId)
      .eq('used', false);

    // 3. Gera token seguro de 15 minutos
    const rawToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + RESET_TOKEN_EXPIRATION_MINUTES * 60 * 1000).toISOString();

    const { error: insertErr } = await supabase
      .from('ministro_portal_password_resets')
      .insert({
        ministro_id: ministroId,
        token: rawToken,
        expires_at: expiresAt,
        used: false,
        ip_requested: ip,
      });

    if (insertErr) {
      console.error('[forgot-password] Erro ao criar token de recuperação:', insertErr.message);
      return NextResponse.json({ error: 'Erro ao gerar link de recuperação.' }, { status: 500 });
    }

    // 4. Monta URL e despacha e-mail via Resend
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || '';
    const resetUrl = `${baseUrl}/portal-ministro/redefinir-senha?token=${rawToken}`;

    const htmlMensagem = `
      <div style="font-family: Arial, sans-serif; color: #1f2937; line-height: 1.6; max-width: 580px; margin: 0 auto;">
        <div style="text-align: center; margin-bottom: 24px;">
          <h2 style="color: #0D2B4E; margin: 0; font-size: 22px;">Recuperação de Senha</h2>
          <p style="color: #6b7280; font-size: 13px; margin: 4px 0 0 0; text-transform: uppercase; letter-spacing: 1px;">SISCOMIEADEPA</p>
        </div>
        <p style="font-size: 15px; margin-bottom: 16px;">Prezado(a) Ministro(a) <strong>${ministroNome}</strong>,</p>
        <p style="margin-bottom: 16px;">
          Recebemos uma solicitação para redefinir a sua senha de acesso ao <strong>Aplicativo do Ministro SISCOMIEADEPA</strong>.
        </p>
        <p style="margin-bottom: 24px;">
          Para cadastrar uma nova senha com segurança, clique no botão abaixo. Este link é de uso único e expira em <strong>${RESET_TOKEN_EXPIRATION_MINUTES} minutos</strong>:
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
        <p style="font-size: 11px; color: #9ca3af; text-align: center; margin: 0;">
          Se você não solicitou a alteração de senha, ignore este e-mail. Seu acesso continuará seguro.
        </p>
      </div>
    `;

    await sendEmail({
      para: emailDestino,
      assunto: 'Recuperação de Senha — Aplicativo do Ministro COMIEADEPA',
      mensagem: `Olá ${ministroNome}, acesse o link para redefinir sua senha: ${resetUrl}`,
      html: htmlMensagem,
      nomeDestinatario: ministroNome,
    });

    const emailMascarado = maskEmail(emailDestino);

    return NextResponse.json({
      ok: true,
      emailMascarado,
      message: `Se o e-mail informado estiver cadastrado, enviamos as instruções de recuperação para ${emailMascarado}.`,
    });
  } catch (err) {
    console.error('[forgot-password] Erro inesperado:', err);
    return NextResponse.json({ error: 'Erro interno no servidor.' }, { status: 500 });
  }
}
