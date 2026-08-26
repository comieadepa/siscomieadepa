/**
 * POST /api/portal-ministro/auth/first-access/request-code
 * Valida CPF + Data de Nascimento no 1º Acesso e envia código de 6 dígitos (2FA OTP)
 * para o e-mail cadastrado (prioritário) ou WhatsApp.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { checkRateLimit } from '@/lib/rate-limit';
import { sendEmail } from '@/services/email';
import { sendWhatsApp, normalizarTelefone } from '@/services/whatsapp';

const RATE_LIMIT_ATTEMPTS = 5;
const RATE_LIMIT_WINDOW_MS = 60_000;
const CODE_EXPIRATION_MINUTES = 15;

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

function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 10) return phone;
  const ddd = digits.slice(0, 2);
  const last4 = digits.slice(-4);
  return `(${ddd}) *****-${last4}`;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const cpf = cleanCpf(String(body?.cpf || ''));
    const dataNascimento = String(body?.data_nascimento || '').trim();

    if (!cpf || cpf.length !== 11) {
      return NextResponse.json({ error: 'CPF inválido.' }, { status: 400 });
    }

    if (!dataNascimento || !/^\d{4}-\d{2}-\d{2}$/.test(dataNascimento)) {
      return NextResponse.json({ error: 'Data de nascimento inválida.' }, { status: 400 });
    }

    const ip = getClientIp(request);
    const rate = checkRateLimit({
      key: `portal-ministro:fa-request-code:${ip}:${cpf}`,
      limit: RATE_LIMIT_ATTEMPTS,
      windowMs: RATE_LIMIT_WINDOW_MS,
    });

    if (!rate.allowed) {
      return NextResponse.json(
        { error: 'Muitas tentativas. Aguarde um minuto antes de solicitar novo código.' },
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
    const { data: ministro, error: mErr } = await supabase
      .from('members')
      .select('id, name, cpf, data_nascimento, status, email, phone, celular, whatsapp, custom_fields')
      .eq('cpf', cpf)
      .maybeSingle();

    if (mErr || !ministro) {
      return NextResponse.json(
        { error: 'CPF não encontrado no cadastro ministerial.' },
        { status: 404 },
      );
    }

    if (ministro.status !== 'active') {
      return NextResponse.json(
        { error: 'Seu acesso não está disponível. Procure a Secretaria.' },
        { status: 403 },
      );
    }

    // Verifica se já tem conta criada
    const { data: existingAccount } = await supabase
      .from('ministro_portal_accounts')
      .select('ministro_id')
      .eq('ministro_id', ministro.id)
      .maybeSingle();

    if (existingAccount) {
      return NextResponse.json(
        { error: 'Conta já cadastrada. Por favor, utilize seu login e senha.' },
        { status: 409 },
      );
    }

    // Valida data de nascimento com fallback
    const cf = (ministro.custom_fields && typeof ministro.custom_fields === 'object')
      ? (ministro.custom_fields as Record<string, any>)
      : {};

    const rawBirthDate = ministro.data_nascimento || cf.dataNascimento || cf.data_nascimento || '';
    const dbDate = String(rawBirthDate).trim().slice(0, 10);

    if (dbDate !== dataNascimento) {
      return NextResponse.json({ error: 'Data de nascimento incorreta.' }, { status: 401 });
    }

    // Identifica o melhor canal de envio (1º E-mail, 2º WhatsApp/Celular)
    const emailDestino = String(ministro.email || cf.email || '').trim();
    const celularDestino = String(ministro.celular || ministro.whatsapp || ministro.phone || cf.celular || cf.whatsapp || cf.telefone || '').trim();

    let canal: 'email' | 'whatsapp' | null = null;
    let destino = '';
    let destinoMascarado = '';

    if (emailDestino && emailDestino.includes('@')) {
      canal = 'email';
      destino = emailDestino;
      destinoMascarado = maskEmail(emailDestino);
    } else if (celularDestino && celularDestino.replace(/\D/g, '').length >= 10) {
      canal = 'whatsapp';
      destino = celularDestino;
      destinoMascarado = maskPhone(celularDestino);
    } else {
      return NextResponse.json(
        {
          error: 'Nenhum canal de contato (e-mail ou celular) cadastrado. Entre em contato com a Secretaria Geral para atualizar seu cadastro.',
        },
        { status: 422 },
      );
    }

    // Invalida códigos anteriores não usados deste ministro
    await supabase
      .from('ministro_portal_first_access_codes')
      .update({ used: true, used_at: new Date().toISOString() })
      .eq('ministro_id', ministro.id)
      .eq('used', false);

    // Gera código numérico de 6 dígitos
    const codigo = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + CODE_EXPIRATION_MINUTES * 60 * 1000).toISOString();

    const { error: insertErr } = await supabase
      .from('ministro_portal_first_access_codes')
      .insert({
        ministro_id: ministro.id,
        codigo,
        canal,
        destino,
        tentativas: 0,
        used: false,
        expires_at: expiresAt,
        ip_requested: ip,
      });

    if (insertErr) {
      console.error('[first-access/request-code] Erro ao gravar código:', insertErr.message);
      return NextResponse.json({ error: 'Erro ao gerar código de confirmação.' }, { status: 500 });
    }

    // Envia o código pelo canal determinado
    if (canal === 'email') {
      const htmlMensagem = `
        <div style="font-family: Arial, sans-serif; color: #1f2937; line-height: 1.6;">
          <p style="font-size: 16px; margin-bottom: 16px;">Prezado(a) <strong>${ministro.name}</strong>,</p>
          <p style="margin-bottom: 16px;">
            Você está realizando o seu primeiro acesso ao <strong>Portal do Ministro SISCOMIEADEPA</strong>.
          </p>
          <p style="margin-bottom: 24px;">
            Seu código de confirmação para criação de senha é:
          </p>
          <div style="text-align: center; margin: 28px 0;">
            <div style="display: inline-block; background-color: #f1f5f9; border: 2px dashed #0D2B4E; padding: 14px 32px; font-size: 28px; font-weight: bold; letter-spacing: 8px; color: #0D2B4E; border-radius: 12px;">
              ${codigo}
            </div>
          </div>
          <p style="font-size: 13px; color: #6b7280; text-align: center; margin-bottom: 24px;">
            Este código é de uso único e expira em <strong>${CODE_EXPIRATION_MINUTES} minutos</strong>.
          </p>
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
          <p style="font-size: 12px; color: #9ca3af; margin: 0;">
            Se você não iniciou este primeiro acesso, entre em contato imediatamente com a Secretaria Geral.
          </p>
        </div>
      `;

      await sendEmail({
        para: destino,
        assunto: `Seu código de acesso ao Portal do Ministro: ${codigo}`,
        mensagem: `Olá ${ministro.name}, seu código de confirmação do Portal do Ministro é ${codigo}. Válido por 15 minutos.`,
        html: htmlMensagem,
        nomeDestinatario: ministro.name,
      });
    } else if (canal === 'whatsapp') {
      const numNorm = normalizarTelefone(destino);
      const mensagem = `Olá *${ministro.name}*, seu código de confirmação para o primeiro acesso ao *Portal do Ministro COMIEADEPA* é: *${codigo}*\n\nEste código é válido por 15 minutos.`;

      await sendWhatsApp({
        para: numNorm,
        mensagem,
      });
    }

    return NextResponse.json({
      ok: true,
      canal,
      destinoMascarado,
      message: `Código de confirmação enviado para ${destinoMascarado}.`,
    });
  } catch (err) {
    console.error('[first-access/request-code] Erro inesperado:', err);
    return NextResponse.json({ error: 'Erro interno no servidor.' }, { status: 500 });
  }
}
