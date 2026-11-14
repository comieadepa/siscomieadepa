/**
 * POST /api/portal-ministro/auth/first-access/register
 * Etapa 2 do Primeiro Acesso:
 * Recebe CPF + Data de Nascimento + E-mail + Senha.
 * Revalida o cadastro oficial no servidor.
 * Impede que outro ministro use o mesmo e-mail caso já esteja confirmado em outra conta.
 * Grava a conta como PENDENTE (email_confirmed = false) com hash seguro (bcrypt).
 * Gera token criptográfico único (64 hex chars) com expiração de 24 horas.
 * Envia e-mail institucional via Resend com botão "Confirmar meu e-mail".
 * Garante que falha no envio ou simulação do Resend NÃO ative a conta indevidamente.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { consumeDistributedRateLimit } from '@/lib/rate-limit-distributed';
import { sendEmail } from '@/services/email';
import { logDB } from '@/lib/audit';
import bcrypt from 'bcrypt';
import crypto from 'crypto';

const RATE_LIMIT_ATTEMPTS = 5;
const RATE_LIMIT_WINDOW_MS = 60_000;
const CONFIRMATION_EXPIRATION_HOURS = 24;

const cleanCpf = (v: string) => v.replace(/\D/g, '');

function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]?.trim() || 'unknown';
  return request.headers.get('x-real-ip') || 'unknown';
}

function normalizeDate(raw: string): string {
  const trimmed = raw.trim();
  if (/^\d{2}[/-]\d{2}[/-]\d{4}$/.test(trimmed)) {
    const parts = trimmed.split(/[/-]/);
    return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  return trimmed;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const rawCpf = String(body?.cpf || '').trim();
    const rawBirthDate = String(body?.dataNascimento || body?.birthDate || '').trim();
    const rawEmail = String(body?.email || '').trim().toLowerCase();
    const senha = String(body?.senha || '');
    const senhaConfirm = String(body?.senhaConfirm || '');

    const cleanCpfValue = cleanCpf(rawCpf);

    if (!cleanCpfValue || cleanCpfValue.length !== 11) {
      return NextResponse.json({ error: 'CPF inválido.' }, { status: 400 });
    }

    if (!rawBirthDate) {
      return NextResponse.json({ error: 'Data de nascimento obrigatória.' }, { status: 400 });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!rawEmail || !emailRegex.test(rawEmail)) {
      return NextResponse.json({ error: 'Informe um endereço de e-mail válido.' }, { status: 400 });
    }

    // Validação de força de senha
    const hasMinLen = senha.length >= 6;
    const hasLetter = /[a-zA-Z]/.test(senha);
    const hasNumber = /[0-9]/.test(senha);

    if (!hasMinLen || !hasLetter || !hasNumber) {
      return NextResponse.json(
        { error: 'A senha deve conter no mínimo 6 caracteres, incluindo pelo menos 1 letra e 1 número.' },
        { status: 400 },
      );
    }

    if (senha !== senhaConfirm) {
      return NextResponse.json({ error: 'A confirmação de senha não confere.' }, { status: 400 });
    }

    const ip = getClientIp(request);
    const rate = await consumeDistributedRateLimit({
      key: `portal-ministro:first-access-register:${ip}:${cleanCpfValue}`,
      limit: RATE_LIMIT_ATTEMPTS,
      windowMs: RATE_LIMIT_WINDOW_MS,
    });

    if (!rate.allowed) {
      return NextResponse.json(
        { error: 'Muitas tentativas. Por favor, aguarde um minuto antes de tentar novamente.' },
        {
          status: 429,
          headers: { 'Retry-After': String(rate.retryAfterSeconds) },
        },
      );
    }

    const supabase = createServerClient();
    const normalizedBirthDate = normalizeDate(rawBirthDate);

    // 1. Validação estrita do ministro no cadastro
    const { data: ministro, error: mErr } = await supabase
      .from('members')
      .select('id, name, cpf, data_nascimento, status')
      .eq('cpf', cleanCpfValue)
      .maybeSingle();

    if (mErr || !ministro) {
      return NextResponse.json(
        { error: 'Cadastro ministerial não localizado. Procure a Secretaria Geral.' },
        { status: 404 },
      );
    }

    if (ministro.status !== 'active') {
      return NextResponse.json(
        { error: 'Seu cadastro não está ativo para acesso. Procure a Secretaria Geral.' },
        { status: 403 },
      );
    }

    const dbBirthDate = ministro.data_nascimento ? String(ministro.data_nascimento).slice(0, 10) : '';
    if (!dbBirthDate || dbBirthDate !== normalizedBirthDate) {
      return NextResponse.json(
        { error: 'Dados divergentes do cadastro oficial da Convenção.' },
        { status: 401 },
      );
    }

    // 2. Proteção contra sobrescrita de conta existente
    const { data: existingAccount } = await supabase
      .from('ministro_portal_accounts')
      .select('ministro_id, email_confirmed, email')
      .eq('ministro_id', ministro.id)
      .maybeSingle();

    if (existingAccount && existingAccount.email_confirmed !== false) {
      return NextResponse.json(
        { error: 'Este ministro já possui uma conta ativa. Use a recuperação de senha.' },
        { status: 409 },
      );
    }

    // 3. Verifica se este e-mail já está sendo utilizado por outro ministro já confirmado
    const { data: emailOwner } = await supabase
      .from('ministro_portal_accounts')
      .select('ministro_id')
      .ilike('email', rawEmail)
      .eq('email_confirmed', true)
      .maybeSingle();

    if (emailOwner && emailOwner.ministro_id !== ministro.id) {
      return NextResponse.json(
        { error: 'Este endereço de e-mail já está em uso por outro cadastro na Convenção.' },
        { status: 409 },
      );
    }

    // 4. Gera hash da senha e token seguro
    const senhaHash = await bcrypt.hash(senha, 10);
    const confirmationToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + CONFIRMATION_EXPIRATION_HOURS * 3600 * 1000).toISOString();
    const agora = new Date().toISOString();

    // 5. Salva a conta como PENDENTE (email_confirmed = false)
    const { error: accErr } = await supabase
      .from('ministro_portal_accounts')
      .upsert({
        ministro_id: ministro.id,
        senha_hash: senhaHash,
        email: rawEmail,
        email_confirmed: false,
        confirmation_token: confirmationToken,
        confirmation_expires_at: expiresAt,
        updated_at: agora,
      }, { onConflict: 'ministro_id' });

    if (accErr) {
      console.error('[first-access/register] Erro ao gravar conta pendente:', accErr.message);
      return NextResponse.json({ error: 'Erro ao registrar cadastro. Tente novamente.' }, { status: 500 });
    }

    // 6. Monta URL de ativação e envia e-mail via Resend
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || '';
    const confirmationUrl = `${baseUrl}/portal-ministro/confirmar-email?token=${confirmationToken}`;

    const htmlMensagem = `
      <div style="font-family: Arial, sans-serif; color: #1f2937; line-height: 1.6; max-width: 580px; margin: 0 auto;">
        <div style="text-align: center; margin-bottom: 24px;">
          <h2 style="color: #0D2B4E; margin: 0; font-size: 22px;">Ativação do Aplicativo do Ministro</h2>
          <p style="color: #6b7280; font-size: 13px; margin: 4px 0 0 0; text-transform: uppercase; letter-spacing: 1px;">SISCOMIEADEPA</p>
        </div>
        <p style="font-size: 15px; margin-bottom: 16px;">Prezado(a) Ministro(a) <strong>${ministro.name}</strong>,</p>
        <p style="margin-bottom: 16px;">
          Seu pré-cadastro de acesso ao <strong>Aplicativo do Ministro</strong> foi recebido com sucesso.
        </p>
        <p style="margin-bottom: 24px;">
          Para ativar sua conta e liberar seu acesso com segurança, confirme a titularidade deste e-mail clicando no botão abaixo:
        </p>
        <div style="text-align: center; margin: 32px 0;">
          <a href="${confirmationUrl}" style="background-color: #0D2B4E; color: #ffffff; padding: 14px 28px; font-weight: bold; text-decoration: none; border-radius: 8px; font-size: 15px; display: inline-block; box-shadow: 0 4px 12px rgba(13,43,78,0.25);">
            Confirmar meu e-mail
          </a>
        </div>
        <p style="font-size: 12px; color: #6b7280; word-break: break-all; margin-top: 24px;">
          Se preferir, copie e cole este link em seu navegador:<br/>
          <a href="${confirmationUrl}" style="color: #0D2B4E;">${confirmationUrl}</a>
        </p>
        <p style="font-size: 12px; color: #9ca3af; margin-top: 20px;">
          Este link é de uso único e expira em <strong>24 horas</strong>. Sua conta permanecerá inativa até a validação deste link.
        </p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
        <p style="font-size: 11px; color: #9ca3af; text-align: center; margin: 0;">
          Se você não solicitou este cadastro, desconsidere esta mensagem. Sua conta não será ativada sem a confirmação.
        </p>
      </div>
    `;

    const emailResult = await sendEmail({
      para: rawEmail,
      assunto: 'Confirme seu e-mail — Aplicativo do Ministro COMIEADEPA',
      mensagem: `Olá ${ministro.name}, confirme seu e-mail para ativar seu acesso no Aplicativo do Ministro: ${confirmationUrl}`,
      html: htmlMensagem,
      nomeDestinatario: ministro.name,
    });

    if (!emailResult.sucesso && emailResult.provider !== 'simulate') {
      console.error('[first-access/register] Falha no Resend ao enviar confirmação:', emailResult.erro);
      return NextResponse.json(
        { error: 'Não foi possível enviar o e-mail de confirmação. Por favor, tente novamente ou procure a Secretaria Geral.' },
        { status: 502 },
      );
    }

    void logDB({
      acao: 'primeiro_acesso_solicitado',
      modulo: 'portal_ministro',
      entidade: 'ministro',
      entidadeId: ministro.id,
      descricao: `Pré-cadastro realizado com envio de link de confirmação para ${rawEmail}`,
      status: 'sucesso',
    });

    return NextResponse.json({
      ok: true,
      message: 'Cadastro registrado com sucesso! Enviamos um link de confirmação para o seu e-mail. Acesse sua caixa de entrada e clique no botão para ativar seu acesso.',
      email: rawEmail,
    });
  } catch (err) {
    console.error('[first-access/register] Erro inesperado:', err);
    return NextResponse.json({ error: 'Erro interno ao processar cadastro.' }, { status: 500 });
  }
}
