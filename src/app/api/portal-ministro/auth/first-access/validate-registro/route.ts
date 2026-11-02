/**
 * POST /api/portal-ministro/auth/first-access/validate-registro
 * Valida o primeiro acesso do ministro com CPF + Registro Convencional (ou Matrícula).
 * Se o ministro possuir e-mail previamente confiável cadastrado na Secretaria:
 *   - Gera token único seguro de 15 minutos
 *   - Envia link de confirmação para o e-mail previamente cadastrado
 *   - Retorna { hasTrustedEmail: true, emailMascarado }
 * Se o ministro NÃO possuir e-mail previamente confiável:
 *   - Não permite assumir com e-mail arbitrário
 *   - Retorna { hasTrustedEmail: false, requerSecretaria: true, message: '...' }
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { consumeDistributedRateLimit } from '@/lib/rate-limit-distributed';
import { sendEmail } from '@/services/email';
import crypto from 'crypto';

const RATE_LIMIT_ATTEMPTS = 5;
const RATE_LIMIT_WINDOW_MS = 60_000;
const FIRST_ACCESS_EXPIRATION_MINUTES = 15;

const cleanCpf = (v: string) => v.replace(/\D/g, '');
const cleanRegistro = (v: string) => v.trim().replace(/^0+/, ''); // remove zeros à esquerda para comparação resiliente

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
    const cpf = cleanCpf(String(body?.cpf || ''));
    const registroInformado = String(body?.registro || body?.matricula || '').trim();

    if (!cpf || cpf.length !== 11) {
      return NextResponse.json({ error: 'CPF inválido.' }, { status: 400 });
    }

    if (!registroInformado) {
      return NextResponse.json({ error: 'Informe seu Registro Convencional ou Matrícula.' }, { status: 400 });
    }

    const ip = getClientIp(request);
    const rate = await consumeDistributedRateLimit({
      key: `portal-ministro:first-access-val-reg:${ip}:${cpf}`,
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

    // 1. Busca cadastro do ministro
    const { data: ministro, error: mErr } = await supabase
      .from('members')
      .select('id, name, cpf, matricula, registro_comieadepa, status, email, custom_fields')
      .eq('cpf', cpf)
      .maybeSingle();

    if (mErr || !ministro) {
      return NextResponse.json({ error: 'Cadastro ministerial não encontrado com o CPF informado.' }, { status: 404 });
    }

    if (ministro.status !== 'active') {
      return NextResponse.json(
        { error: 'Seu acesso não está disponível. Procure a Secretaria Geral.' },
        { status: 403 },
      );
    }

    // 2. Verifica se já possui conta cadastrada
    const { data: existingAccount } = await supabase
      .from('ministro_portal_accounts')
      .select('ministro_id')
      .eq('ministro_id', ministro.id)
      .maybeSingle();

    if (existingAccount) {
      return NextResponse.json(
        { error: 'Conta já cadastrada. Por favor, utilize a tela de login com sua senha.' },
        { status: 409 },
      );
    }

    // 3. Validação do Registro Convencional / Matrícula
    const cf = (ministro.custom_fields && typeof ministro.custom_fields === 'object')
      ? (ministro.custom_fields as Record<string, any>)
      : {};

    const reg1 = cleanRegistro(String(ministro.registro_comieadepa || ''));
    const reg2 = cleanRegistro(String(ministro.matricula || ''));
    const reg3 = cleanRegistro(String(cf.registro_comieadepa || cf.matricula || ''));
    const regInfo = cleanRegistro(registroInformado);

    const registroConfere =
      (reg1 && reg1 === regInfo) ||
      (reg2 && reg2 === regInfo) ||
      (reg3 && reg3 === regInfo);

    if (!registroConfere) {
      return NextResponse.json(
        { error: 'Registro Convencional ou Matrícula incorreto para este CPF.' },
        { status: 401 },
      );
    }

    // 4. Verificação de e-mail confiável previamente cadastrado na Secretaria
    const rawEmail = String(ministro.email || cf.email || '').trim().toLowerCase();
    const isEmailValido =
      rawEmail &&
      rawEmail.includes('@') &&
      !rawEmail.includes(' ') &&
      !rawEmail.includes('desligado') &&
      !rawEmail.includes('falecido');

    if (!isEmailValido) {
      return NextResponse.json({
        hasTrustedEmail: false,
        requerSecretaria: true,
        nome: ministro.name,
        error: 'Você não possui um e-mail previamente homologado em seu cadastro convencional. Para garantir sua segurança e integridade, procure a Secretaria Geral para atualização antes de ativar o aplicativo.',
      }, { status: 422 });
    }

    // 5. Invalida tokens anteriores não utilizados deste ministro
    await supabase
      .from('ministro_portal_password_resets')
      .update({ used: true, used_at: new Date().toISOString() })
      .eq('ministro_id', ministro.id)
      .eq('used', false);

    // 6. Gera token único seguro de 15 minutos
    const rawToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + FIRST_ACCESS_EXPIRATION_MINUTES * 60 * 1000).toISOString();

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
      console.error('[validate-registro] Erro ao criar token de ativação:', insertErr.message);
      return NextResponse.json({ error: 'Erro ao gerar link de ativação segura.' }, { status: 500 });
    }

    // 7. Dispara e-mail com link de confirmação única
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || '';
    const confirmUrl = `${baseUrl}/portal-ministro/redefinir-senha?token=${rawToken}&origem=primeiro-acesso`;

    const htmlMensagem = `
      <div style="font-family: Arial, sans-serif; color: #1f2937; line-height: 1.6;">
        <p style="font-size: 16px; margin-bottom: 16px;">Prezado(a) <strong>${ministro.name}</strong>,</p>
        <p style="margin-bottom: 16px;">
          Identificamos sua solicitação de <strong>Primeiro Acesso</strong> ao <strong>Aplicativo do Ministro SISCOMIEADEPA</strong>.
        </p>
        <p style="margin-bottom: 24px;">
          Para validar com segurança a titularidade do seu cadastro e criar sua senha definitiva, clique no botão abaixo. Este link é de uso único e expira em <strong>${FIRST_ACCESS_EXPIRATION_MINUTES} minutos</strong>:
        </p>
        <div style="text-align: center; margin: 32px 0;">
          <a href="${confirmUrl}" style="background-color: #0D2B4E; color: #ffffff; padding: 14px 28px; font-weight: bold; text-decoration: none; border-radius: 8px; font-size: 15px; display: inline-block; box-shadow: 0 4px 12px rgba(13,43,78,0.25);">
            Confirmar e Criar Minha Senha
          </a>
        </div>
        <p style="font-size: 12px; color: #6b7280; word-break: break-all; margin-top: 24px;">
          Ou copie e cole o link no seu navegador:<br/>
          <a href="${confirmUrl}" style="color: #0D2B4E;">${confirmUrl}</a>
        </p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
        <p style="font-size: 12px; color: #9ca3af; margin: 0;">
          Se você não solicitou este primeiro acesso, não compartilhe este link. Seu cadastro permanece protegido.
        </p>
      </div>
    `;

    await sendEmail({
      para: rawEmail,
      assunto: 'Ativação de Primeiro Acesso — Aplicativo do Ministro COMIEADEPA',
      mensagem: `Olá ${ministro.name}, acesse o link para criar sua senha de acesso: ${confirmUrl}`,
      html: htmlMensagem,
      nomeDestinatario: ministro.name,
    });

    const emailMascarado = maskEmail(rawEmail);

    return NextResponse.json({
      ok: true,
      hasTrustedEmail: true,
      nome: ministro.name,
      emailMascarado,
      message: `Enviamos um link de confirmação única para o seu e-mail cadastrado (${emailMascarado}). Acesse sua caixa de entrada para criar sua senha de acesso.`,
    });
  } catch (err) {
    console.error('[validate-registro] Erro inesperado:', err);
    return NextResponse.json({ error: 'Erro interno ao processar validação.' }, { status: 500 });
  }
}
