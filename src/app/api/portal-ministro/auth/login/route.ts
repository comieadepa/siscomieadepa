/**
 * POST /api/portal-ministro/auth/login
 * Suporta dois fluxos:
 *   tipo='primeiro_acesso' — valida CPF + data_nascimento e cria senha (bcrypt)
 *   tipo='senha'           — valida CPF + senha com bcrypt.compare
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { setSessionCookie, SESSION_DURATION_HOURS } from '@/lib/ministro-session';
import { logDB } from '@/lib/audit';
import bcrypt from 'bcrypt';

const cleanCpf = (v: string) => v.replace(/\D/g, '');

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
    const tipo: string = String(body?.tipo || 'senha');
    const cpf = cleanCpf(String(body?.cpf || ''));

    if (!cpf || cpf.length !== 11) {
      return NextResponse.json({ error: 'CPF inválido.' }, { status: 400 });
    }

    const supabase = createServerClient();

    const { data: ministro, error: memberError } = await supabase
      .from('members')
      .select('id, name, cpf, data_nascimento, status, cargo_ministerial, pastor_presidente')
      .eq('cpf', cpf)
      .in('status', ['active'])
      .maybeSingle();

    if (memberError) {
      console.error('[portal-ministro/login]', memberError.message);
      return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
    }

    if (!ministro) {
      return NextResponse.json({ error: 'CPF não encontrado no cadastro ministerial.' }, { status: 401 });
    }

    if (ministro.status !== 'active') {
      return NextResponse.json(
        { error: 'Seu acesso não está disponível. Procure a Secretaria.' },
        { status: 403 },
      );
    }

    // ── Primeiro acesso: criar senha ──────────────────────────────────────
    if (tipo === 'primeiro_acesso') {
      const dataNascimento = String(body?.data_nascimento || '').trim();
      const senha = String(body?.senha || '');

      if (!dataNascimento || !/^\d{4}-\d{2}-\d{2}$/.test(dataNascimento)) {
        return NextResponse.json({ error: 'Data de nascimento inválida.' }, { status: 400 });
      }
      if (!senha || senha.length < 6) {
        return NextResponse.json(
          { error: 'A senha deve ter pelo menos 6 caracteres.' },
          { status: 400 },
        );
      }

      const dbDate = String(ministro.data_nascimento || '').slice(0, 10);
      if (dbDate !== dataNascimento) {
        return NextResponse.json({ error: 'Data de nascimento incorreta.' }, { status: 401 });
      // Note: message is intentionally generic to avoid user enumeration on birth date
      }

      // Verifica se já existe conta
      const { data: existingAccount } = await supabase
        .from('ministro_portal_accounts')
        .select('ministro_id')
        .eq('ministro_id', ministro.id)
        .maybeSingle();

      if (existingAccount) {
        return NextResponse.json(
          { error: 'Conta já criada. Use seu login e senha.' },
          { status: 409 },
        );
      }

      const senhaHash = await bcrypt.hash(senha, 10);
      const { error: insertErr } = await supabase
        .from('ministro_portal_accounts')
        .insert({ ministro_id: ministro.id, senha_hash: senhaHash });

      if (insertErr) {
        console.error('[portal-ministro/login/primeiro_acesso]', insertErr.message);
        return NextResponse.json({ error: 'Erro ao criar conta.' }, { status: 500 });
      }

      const token = await criarSessao(supabase, ministro.id);
      if (!token) return NextResponse.json({ error: 'Erro ao criar sessão.' }, { status: 500 });

      void logDB({
        acao: 'primeiro_acesso',
        modulo: 'portal_ministro',
        entidade: 'ministro',
        entidadeId: ministro.id,
        descricao: `Primeiro acesso ao portal: ${ministro.name}`,
        status: 'sucesso',
      });

      const res = NextResponse.json({ ok: true, nome: ministro.name });
      return setSessionCookie(res, token);
    }

    // ── Login com senha ───────────────────────────────────────────────────
    const senha = String(body?.senha || '');
    if (!senha) {
      return NextResponse.json({ error: 'Senha obrigatória.' }, { status: 400 });
    }

    const { data: account } = await supabase
      .from('ministro_portal_accounts')
      .select('senha_hash')
      .eq('ministro_id', ministro.id)
      .maybeSingle();

    if (!account) {
      return NextResponse.json(
        { error: 'Nenhuma senha cadastrada. Faça o primeiro acesso.' },
        { status: 401 },
      );
    }

    const match = await bcrypt.compare(senha, account.senha_hash);
    if (!match) {
      return NextResponse.json({ error: 'Senha incorreta.' }, { status: 401 });
    }

    const token = await criarSessao(supabase, ministro.id);
    if (!token) return NextResponse.json({ error: 'Erro ao criar sessão.' }, { status: 500 });

    void logDB({
      acao: 'login',
      modulo: 'portal_ministro',
      entidade: 'ministro',
      entidadeId: ministro.id,
      descricao: `Login no portal do ministro: ${ministro.name}`,
      status: 'sucesso',
    });

    const res = NextResponse.json({ ok: true, nome: ministro.name });
    return setSessionCookie(res, token);
  } catch (err: unknown) {
    console.error('[portal-ministro/login] Erro inesperado:', err);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}
