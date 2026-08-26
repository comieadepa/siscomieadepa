/**
 * POST /api/portal-ministro/auth/first-access/verify-and-create
 * Valida o código de 6 dígitos (2FA OTP) enviado ao ministro e cria sua senha com hash bcrypt.
 * Invalida o código imediatamente e inicia a sessão autenticada.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { setSessionCookie, SESSION_DURATION_HOURS } from '@/lib/ministro-session';
import { checkRateLimit } from '@/lib/rate-limit';
import { logDB } from '@/lib/audit';
import bcrypt from 'bcrypt';

const RATE_LIMIT_ATTEMPTS = 5;
const RATE_LIMIT_WINDOW_MS = 60_000;
const MAX_CODE_ATTEMPTS = 5;

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
    const codigo = String(body?.codigo || '').trim();
    const senha = String(body?.senha || '');
    const senhaConfirm = String(body?.senhaConfirm || '');

    if (!cpf || cpf.length !== 11) {
      return NextResponse.json({ error: 'CPF inválido.' }, { status: 400 });
    }

    if (!codigo || codigo.length !== 6) {
      return NextResponse.json({ error: 'Código de confirmação de 6 dígitos é obrigatório.' }, { status: 400 });
    }

    const ip = getClientIp(request);
    const rate = checkRateLimit({
      key: `portal-ministro:fa-verify:${ip}:${cpf}`,
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

    // Busca ministro
    const { data: ministro, error: mErr } = await supabase
      .from('members')
      .select('id, name, cpf, data_nascimento, status, custom_fields')
      .eq('cpf', cpf)
      .maybeSingle();

    if (mErr || !ministro) {
      return NextResponse.json({ error: 'Cadastro ministerial não encontrado.' }, { status: 404 });
    }

    if (ministro.status !== 'active') {
      return NextResponse.json({ error: 'Acesso não disponível. Procure a Secretaria.' }, { status: 403 });
    }

    // Valida data de nascimento
    const cf = (ministro.custom_fields && typeof ministro.custom_fields === 'object')
      ? (ministro.custom_fields as Record<string, any>)
      : {};

    const rawBirthDate = ministro.data_nascimento || cf.dataNascimento || cf.data_nascimento || '';
    const dbDate = String(rawBirthDate).trim().slice(0, 10);

    if (dbDate !== dataNascimento) {
      return NextResponse.json({ error: 'Dados de identificação divergentes.' }, { status: 401 });
    }

    // Busca o código ativo mais recente
    const agora = new Date().toISOString();
    const { data: activeCode, error: codeErr } = await supabase
      .from('ministro_portal_first_access_codes')
      .select('id, codigo, tentativas, expires_at, used')
      .eq('ministro_id', ministro.id)
      .eq('used', false)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (codeErr || !activeCode) {
      return NextResponse.json(
        { error: 'Nenhum código ativo encontrado. Solicite o envio de um novo código.' },
        { status: 400 },
      );
    }

    if (new Date(activeCode.expires_at) <= new Date(agora)) {
      return NextResponse.json(
        { error: 'O código de confirmação expirou (validade: 15 minutos). Solicite um novo código.' },
        { status: 410 },
      );
    }

    // Incrementa tentativas e previne brute-force no OTP
    const novasTentativas = (activeCode.tentativas || 0) + 1;
    if (novasTentativas > MAX_CODE_ATTEMPTS) {
      await supabase
        .from('ministro_portal_first_access_codes')
        .update({ used: true, used_at: agora, tentativas: novasTentativas })
        .eq('id', activeCode.id);

      return NextResponse.json(
        { error: 'Limite de tentativas excedido para este código. Solicite um novo código de confirmação.' },
        { status: 429 },
      );
    }

    await supabase
      .from('ministro_portal_first_access_codes')
      .update({ tentativas: novasTentativas })
      .eq('id', activeCode.id);

    if (activeCode.codigo.trim() !== codigo) {
      return NextResponse.json(
        { error: 'Código de confirmação incorreto. Verifique o número recebido.' },
        { status: 401 },
      );
    }

    // Código correto: invalida o código imediatamente
    await supabase
      .from('ministro_portal_first_access_codes')
      .update({ used: true, used_at: agora })
      .eq('id', activeCode.id);

    // Hashing da senha com bcrypt
    const senhaHash = await bcrypt.hash(senha, 10);

    const { error: insertAccErr } = await supabase
      .from('ministro_portal_accounts')
      .upsert({
        ministro_id: ministro.id,
        senha_hash: senhaHash,
        updated_at: agora,
      }, { onConflict: 'ministro_id' });

    if (insertAccErr) {
      console.error('[first-access/verify-and-create] Erro ao cadastrar senha:', insertAccErr.message);
      return NextResponse.json({ error: 'Erro ao criar senha de acesso.' }, { status: 500 });
    }

    // Cria sessão autenticada de 24h
    const token = await criarSessao(supabase, ministro.id);
    if (!token) {
      return NextResponse.json({ error: 'Erro ao inicializar sessão de acesso.' }, { status: 500 });
    }

    void logDB({
      acao: 'primeiro_acesso_2fa_concluido',
      modulo: 'portal_ministro',
      entidade: 'ministro',
      entidadeId: ministro.id,
      descricao: `Primeiro acesso com autenticação 2FA concluído com sucesso: ${ministro.name}`,
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
