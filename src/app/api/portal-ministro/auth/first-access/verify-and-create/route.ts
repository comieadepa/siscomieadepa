/**
 * POST /api/portal-ministro/auth/first-access/verify-and-create
 * Valida os dados de identificação (CPF + Data de Nascimento), salva o e-mail de recuperação
 * no cadastro do ministro e cria sua senha com hash bcrypt.
 * Inicia a sessão autenticada com cookie ministro_token.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { setSessionCookie, SESSION_DURATION_HOURS } from '@/lib/ministro-session';
import { checkRateLimit } from '@/lib/rate-limit';
import { logDB } from '@/lib/audit';
import bcrypt from 'bcrypt';

const RATE_LIMIT_ATTEMPTS = 5;
const RATE_LIMIT_WINDOW_MS = 60_000;

const cleanCpf = (v: string) => v.replace(/\D/g, '');

function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]?.trim() || 'unknown';
  return request.headers.get('x-real-ip') || 'unknown';
}

async function criarSessao(supabase: ReturnType<typeof createServerClient>, ministroId: string) {
  const expiresAt = new Date(Date.now() + SESSION_DURATION_HOURS * 3600 * 1000).toISOString();
  const { data: session, error } = await supabase
    .from('ministro_portal_sessions')
    .insert({ ministro_id: ministroId, expires_at: expiresAt })
    .select('token')
    .single();
  if (error || !session) return null;
  return session.token as string;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const cpf = cleanCpf(String(body?.cpf || ''));
    const dataNascimento = String(body?.data_nascimento || '').trim();
    const email = String(body?.email || '').trim().toLowerCase();
    const senha = String(body?.senha || '');
    const senhaConfirm = String(body?.senhaConfirm || '');

    if (!cpf || cpf.length !== 11) {
      return NextResponse.json({ error: 'CPF inválido.' }, { status: 400 });
    }

    if (!dataNascimento || !/^\d{4}-\d{2}-\d{2}$/.test(dataNascimento)) {
      return NextResponse.json({ error: 'Data de nascimento inválida.' }, { status: 400 });
    }

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'Informe um e-mail de recuperação válido.' }, { status: 400 });
    }

    const ip = getClientIp(request);
    const rate = checkRateLimit({
      key: `portal-ministro:fa-create:${ip}:${cpf}`,
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

    // Validações da nova senha
    const hasMinLen = senha.length >= 6;
    const hasLetter = /[a-zA-Z]/.test(senha);
    const hasNumber = /[0-9]/.test(senha);

    if (!hasMinLen || !hasLetter || !hasNumber) {
      return NextResponse.json(
        { error: 'A senha deve conter no mínimo 6 caracteres, pelo menos 1 letra e 1 número.' },
        { status: 400 },
      );
    }

    if (senha !== senhaConfirm) {
      return NextResponse.json({ error: 'As senhas digitadas não coincidem.' }, { status: 400 });
    }

    const supabase = createServerClient();

    // Busca ministro ativo
    const { data: ministro, error: mErr } = await supabase
      .from('members')
      .select('id, name, cpf, data_nascimento, status, email, custom_fields')
      .eq('cpf', cpf)
      .maybeSingle();

    if (mErr || !ministro) {
      return NextResponse.json({ error: 'Cadastro ministerial não encontrado.' }, { status: 404 });
    }

    if (ministro.status !== 'active') {
      return NextResponse.json({ error: 'Acesso não disponível. Procure a Secretaria.' }, { status: 403 });
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

    // Valida data de nascimento
    const cf = (ministro.custom_fields && typeof ministro.custom_fields === 'object')
      ? (ministro.custom_fields as Record<string, any>)
      : {};

    const rawBirthDate = ministro.data_nascimento || cf.dataNascimento || cf.data_nascimento || '';
    const dbDate = String(rawBirthDate).trim().slice(0, 10);

    if (dbDate !== dataNascimento) {
      return NextResponse.json({ error: 'Data de nascimento incorreta.' }, { status: 401 });
    }

    // Atualiza o e-mail de recuperação no cadastro do ministro (members)
    const updatedCustomFields = {
      ...cf,
      email,
    };

    const { error: updateMemberErr } = await supabase
      .from('members')
      .update({
        email,
        custom_fields: updatedCustomFields,
      })
      .eq('id', ministro.id);

    if (updateMemberErr) {
      console.error('[first-access] Erro ao atualizar e-mail do ministro:', updateMemberErr.message);
    }

    // Hashing da senha com bcrypt
    const agora = new Date().toISOString();
    const senhaHash = await bcrypt.hash(senha, 10);

    const { error: insertAccErr } = await supabase
      .from('ministro_portal_accounts')
      .upsert({
        ministro_id: ministro.id,
        senha_hash: senhaHash,
        updated_at: agora,
      }, { onConflict: 'ministro_id' });

    if (insertAccErr) {
      console.error('[first-access] Erro ao cadastrar senha:', insertAccErr.message);
      return NextResponse.json({ error: 'Erro ao criar senha de acesso.' }, { status: 500 });
    }

    // Cria sessão autenticada de 24h
    const token = await criarSessao(supabase, ministro.id);
    if (!token) {
      return NextResponse.json({ error: 'Erro ao inicializar sessão de acesso.' }, { status: 500 });
    }

    void logDB({
      acao: 'primeiro_acesso_concluido',
      modulo: 'portal_ministro',
      entidade: 'ministro',
      entidadeId: ministro.id,
      descricao: `Primeiro acesso concluído e senha cadastrada com sucesso: ${ministro.name}`,
      status: 'sucesso',
    });

    const res = NextResponse.json({
      ok: true,
      nome: ministro.name,
      message: 'Acesso criado com sucesso!',
    });

    return setSessionCookie(res, token);
  } catch (err) {
    console.error('[first-access/verify-and-create] Erro inesperado:', err);
    return NextResponse.json({ error: 'Erro interno no servidor.' }, { status: 500 });
  }
}
