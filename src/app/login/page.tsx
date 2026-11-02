'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase-client';
import NotificationModal from '@/components/NotificationModal';

export default function LoginPage() {
  const router = useRouter();
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [loginErrorModal, setLoginErrorModal] = useState(false);

  const limparSessaoInvalida = async () => {
    const supabase = supabaseRef.current ?? createClient();
    supabaseRef.current = supabase;
    const { error: sessError } = await supabase.auth.getSession();
    const msg = sessError?.message || '';
    if (msg.toLowerCase().includes('refresh token')) {
      await supabase.auth.signOut({ scope: 'local' });
      try {
        for (const key of Object.keys(localStorage)) {
          if (key.includes('supabase.auth') || key.includes('-auth-token') || key.startsWith('sb-')) {
            localStorage.removeItem(key);
          }
        }
        for (const key of Object.keys(sessionStorage)) {
          if (key.includes('supabase.auth') || key.includes('-auth-token') || key.startsWith('sb-')) {
            sessionStorage.removeItem(key);
          }
        }
      } catch {
        // ignora falha ao limpar storage
      }
      setError('Sessao expirada. Faça login novamente.');
    }
  };

  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(''), 4000);
      return () => clearTimeout(timer);
    }
  }, [error]);

  useEffect(() => {
    void limparSessaoInvalida();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      if (!email || !password) {
        setError('Por favor, preencha todos os campos');
        setLoading(false);
        return;
      }

      if (!supabaseRef.current) {
        supabaseRef.current = createClient();
      }

      if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
        setError('Aplicacao nao configurada. Contate o administrador.');
        setLoading(false);
        return;
      }

      const { data: authData, error: authError } = await supabaseRef.current.auth.signInWithPassword({
        email,
        password,
      });

      if (!authError && authData?.user) {
        const rawRole = authData.user.user_metadata?.nivel || authData.user.user_metadata?.role || authData.user.app_metadata?.role;
        const normalizedRole = typeof rawRole === 'string' ? rawRole.toLowerCase().trim() : '';
        const isOfficialUser = ['super', 'administrador', 'super_admin', 'superadmin', 'admin', 'administrator', 'cgadb', 'comissao', 'inscricao', 'financeiro'].includes(normalizedRole);
        const nivel = (authData.user.user_metadata?.nivel || normalizedRole) as string | undefined;

        // Permitir se for usuário oficial (inscricao, cgadb, financeiro, admin, super) OU se estiver cadastrado na tabela de usuários do CRM
        if (!isOfficialUser) {
          const { data: dbUser, error: dbUserError } = await supabaseRef.current
            .from('users')
            .select('role, is_active')
            .eq('id', authData.user.id)
            .maybeSingle();

          if (dbUserError || !dbUser || dbUser.is_active === false) {
            // Se não for do nível de inscrição oficial e não estiver no CRM, rejeita
            await supabaseRef.current.auth.signOut();
            setError('Acesso restrito. Este painel é exclusivo para administradores da Convenção. Operadores de eventos devem utilizar o link de acesso específico da sua equipe.');
            setLoading(false);
            return;
          }
        }

        // Registrar log de login
        try {
          await fetch('/api/v1/audit-logs', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${authData.session?.access_token ?? ''}`,
            },
            body: JSON.stringify({
              acao: 'login',
              modulo: 'auth',
              descricao: `Login realizado por ${authData.user.email}`,
              usuario_email: authData.user.email,
              status: 'sucesso',
            }),
          });
        } catch {
          // silencioso: não impede o login
        }
        // Redireciona conforme o nível do usuário
        const destino =
          nivel === 'inscricao' ? '/eventos' :
          nivel === 'cgadb'     ? '/secretaria/cgadb' :
          nivel === 'financeiro'? '/financeiro' :
          '/dashboard';
        router.push(destino);
        return;
      }

      setLoginErrorModal(true);
      setLoading(false);
    } catch (err) {
      console.error('[LOGIN] Erro geral:', err);
      setError('Erro ao fazer login. Verifique a conexao e tente novamente.');
      setLoading(false);
    }
  };

  return (
    <>
      <style>{`
        .login-root {
          min-height: 100svh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 16px;
          background-image: url('/img/bg_login.png');
          background-size: cover;
          background-position: center center;
          background-repeat: no-repeat;
          position: relative;
        }
        /* Garante o rodapé sempre visível */
        .login-footer {
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          text-align: center;
          padding: 10px 16px 12px;
          background: linear-gradient(to top, rgba(0,0,0,0.55) 0%, transparent 100%);
        }
        .login-card {
          width: 100%;
          max-width: 370px;
          background: #ffffff;
          border-radius: 20px;
          padding: 36px 32px 28px;
          box-shadow: 0 8px 48px rgba(0,0,0,0.35), 0 0 0 1.5px rgba(201,151,44,0.45);
          display: flex;
          flex-direction: column;
          align-items: center;
          position: relative;
          z-index: 10;
        }
        /* Golden top accent line */
        .login-card::before {
          content: '';
          position: absolute;
          top: 0;
          left: 20px;
          right: 20px;
          height: 3px;
          background: linear-gradient(90deg, transparent, #c9972c, #e0b84a, #c9972c, transparent);
          border-radius: 0 0 3px 3px;
        }
        .login-logo {
          max-width: 200px;
          width: 100%;
          height: auto;
          object-fit: contain;
          margin-bottom: 6px;
        }
        .login-subtitle {
          font-size: 0.72rem;
          color: #6b7280;
          letter-spacing: 0.04em;
          margin-bottom: 16px;
          text-align: center;
        }
        .login-title {
          font-weight: 800;
          font-size: 1.05rem;
          letter-spacing: 0.08em;
          color: #1e3659;
          text-align: center;
          margin-bottom: 20px;
        }
        .login-input-wrap {
          display: flex;
          align-items: center;
          border: 1.5px solid #d1d5db;
          border-radius: 10px;
          overflow: hidden;
          height: 48px;
          width: 100%;
          margin-bottom: 12px;
          transition: border-color 0.2s;
          background: #fff;
        }
        .login-input-wrap:focus-within {
          border-color: #c9972c;
          box-shadow: 0 0 0 3px rgba(201,151,44,0.12);
        }
        .login-input-icon {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 44px;
          height: 100%;
          flex-shrink: 0;
        }
        .login-input {
          flex: 1;
          border: none;
          outline: none;
          font-size: 0.93rem;
          color: #374151;
          background: transparent;
          height: 100%;
          padding-right: 12px;
        }
        .login-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          width: 100%;
          margin-bottom: 18px;
        }
        .login-remember {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 0.80rem;
          color: #6b7280;
          cursor: pointer;
          user-select: none;
        }
        .login-remember input[type="checkbox"] {
          width: 15px;
          height: 15px;
          accent-color: #1e3659;
          cursor: pointer;
        }
        .login-forgot {
          font-size: 0.80rem;
          color: #1e3659;
          background: none;
          border: none;
          cursor: pointer;
          text-decoration: underline;
          text-underline-offset: 2px;
        }
        .login-btn {
          width: 100%;
          height: 48px;
          background: linear-gradient(135deg, #b8830c 0%, #d4a017 40%, #e8c547 100%);
          color: #fff;
          border: none;
          border-radius: 10px;
          font-size: 0.97rem;
          font-weight: 800;
          letter-spacing: 0.18em;
          cursor: pointer;
          box-shadow: 0 4px 16px rgba(180,130,20,0.4);
          transition: opacity 0.2s, transform 0.1s;
        }
        .login-btn:hover:not(:disabled) {
          opacity: 0.93;
          transform: translateY(-1px);
        }
        .login-btn:active:not(:disabled) {
          transform: translateY(0);
        }
        .login-btn:disabled {
          cursor: not-allowed;
          opacity: 0.65;
        }
        .login-links {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-top: 18px;
          font-size: 0.80rem;
          color: #6b7280;
        }
        .login-links button {
          background: none;
          border: none;
          cursor: pointer;
          color: #1e3659;
          text-decoration: underline;
          text-underline-offset: 2px;
          font-size: 0.80rem;
        }
        .login-links span {
          color: #d1d5db;
        }
        .login-error {
          margin-bottom: 12px;
          width: 100%;
          padding: 10px 12px;
          background: #fef2f2;
          border: 1px solid #fecaca;
          border-radius: 8px;
          color: #b91c1c;
          font-size: 0.82rem;
          text-align: center;
          line-height: 1.4;
        }
        /* ── Responsividade ─────────────────────────────────────── */
        @media (max-width: 480px) {
          .login-card {
            padding: 28px 20px 22px;
            border-radius: 16px;
          }
          .login-logo {
            max-width: 170px;
          }
          .login-title {
            font-size: 0.97rem;
          }
        }
        /* Paisagem em celular: card menor para caber na tela */
        @media (max-height: 520px) and (orientation: landscape) {
          .login-root {
            align-items: flex-start;
            padding: 8px 16px 40px;
          }
          .login-card {
            padding: 18px 24px 16px;
            max-width: 340px;
          }
          .login-logo {
            max-width: 130px;
            margin-bottom: 2px;
          }
          .login-subtitle { margin-bottom: 8px; }
          .login-title { font-size: 0.88rem; margin-bottom: 10px; }
          .login-input-wrap { height: 40px; margin-bottom: 8px; }
          .login-row { margin-bottom: 10px; }
          .login-btn { height: 40px; }
          .login-links { margin-top: 10px; }
        }
      `}</style>

      <div className="login-root">
        <NotificationModal
          isOpen={loginErrorModal}
          type="error"
          title="Credenciais incorretas"
          message="Email ou senha incorretos. Verifique seus dados e tente novamente."
          onClose={() => setLoginErrorModal(false)}
          showButton={true}
          autoClose={3500}
        />

        {/* Card de Login */}
        <div className="login-card">
          {/* Logomarca */}
          <img
            src="/img/logo_login.png"
            alt="SISCOMIEADEPA"
            className="login-logo"
          />

          <p className="login-subtitle">Sistema Integrado de Gestão Convencional</p>

          <h2 className="login-title">ACESSO AO SISTEMA</h2>

          <form onSubmit={handleSubmit} style={{ width: '100%' }}>
            {error && <div className="login-error">{error}</div>}

            {/* Campo E-mail */}
            <div className="login-input-wrap">
              <div className="login-input-icon">
                <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#1e3659" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect width="20" height="16" x="2" y="4" rx="2"/>
                  <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
                </svg>
              </div>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="E-mail"
                autoComplete="email"
                className="login-input"
              />
            </div>

            {/* Campo Senha */}
            <div className="login-input-wrap">
              <div className="login-input-icon">
                <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#1e3659" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect width="18" height="11" x="3" y="11" rx="2" ry="2"/>
                  <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                </svg>
              </div>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Senha"
                autoComplete="current-password"
                className="login-input"
              />
            </div>

            {/* Lembrar-me + Esqueceu a senha */}
            <div className="login-row">
              <label className="login-remember">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                />
                Lembrar-me
              </label>
              <button
                type="button"
                className="login-forgot"
                onClick={() => router.push('/validar-senha')}
              >
                Esqueceu a senha?
              </button>
            </div>

            {/* Botão Entrar */}
            <button type="submit" disabled={loading} className="login-btn">
              {loading ? 'ENTRANDO...' : 'ENTRAR'}
            </button>
          </form>

          {/* Links do rodapé do card */}
          <div className="login-links">
            <button type="button" onClick={() => router.push('/validar-senha')}>
              Esqueceu a senha?
            </button>
            <span>|</span>
            <button type="button" onClick={() => router.push('/pre-cadastro')}>
              Criar conta
            </button>
          </div>
        </div>

        {/* Rodapé da página */}
        <div className="login-footer">
          <p style={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.85)', fontWeight: 600, marginBottom: '2px' }}>
            SISCOMIEADEPA &ndash; Sistema Integrado de Gestão Convencional &ndash; Ver 1.0
          </p>
          <p style={{ fontSize: '0.66rem', color: 'rgba(255,255,255,0.65)' }}>
            Desenvolvido por: Alcântara Sistemas LTDA
          </p>
        </div>
      </div>
    </>
  );
}
