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

  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(''), 4000);
      return () => clearTimeout(timer);
    }
  }, [error]);

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
        router.push('/dashboard');
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
    <div
      className="min-h-screen flex items-center justify-center px-4 py-8"
      style={{
        backgroundImage: "url('/img/bg_site.png')",
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
      }}
    >
      <NotificationModal
        isOpen={loginErrorModal}
        type="error"
        title="Credenciais incorretas"
        message="Email ou senha incorretos. Verifique seus dados e tente novamente."
        onClose={() => setLoginErrorModal(false)}
        showButton={true}
        autoClose={3500}
      />

      {/* Card branco */}
      <div
        className="w-full bg-white flex flex-col items-center"
        style={{
          maxWidth: '360px',
          borderRadius: '24px',
          padding: '36px 32px 28px',
          boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
        }}
      >
        {/* Logo */}
        <img
          src="/img/logo_comieadepa.png"
          alt="COMIEADEPA"
          style={{ height: '120px', objectFit: 'contain', marginBottom: '20px' }}
        />

        {/* Titulo */}
        <h2
          className="font-bold text-center mb-6"
          style={{ color: '#1e3659', fontSize: '1.25rem', letterSpacing: '0.03em' }}
        >
          ACESSO AO SISTEMA
        </h2>

        <form onSubmit={handleSubmit} className="w-full">
          {error && (
            <div
              className="mb-4 text-center text-sm font-medium"
              style={{ color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '10px 12px' }}
            >
              {error}
            </div>
          )}

          {/* Campo Email */}
          <div
            className="flex items-center mb-3"
            style={{ border: '1.5px solid #d1d5db', borderRadius: '10px', overflow: 'hidden', height: '48px' }}
          >
            <div className="flex items-center justify-center" style={{ width: '46px', height: '100%' }}>
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1e3659" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
              style={{ flex: 1, border: 'none', outline: 'none', fontSize: '0.95rem', color: '#374151', background: 'transparent', height: '100%', paddingRight: '12px' }}
            />
          </div>

          {/* Campo Senha */}
          <div
            className="flex items-center mb-4"
            style={{ border: '1.5px solid #d1d5db', borderRadius: '10px', overflow: 'hidden', height: '48px' }}
          >
            <div className="flex items-center justify-center" style={{ width: '46px', height: '100%' }}>
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1e3659" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
              style={{ flex: 1, border: 'none', outline: 'none', fontSize: '0.95rem', color: '#374151', background: 'transparent', height: '100%', paddingRight: '12px' }}
            />
          </div>

          {/* Lembrar-me + Esqueceu */}
          <div className="flex items-center justify-between mb-5">
            <label className="flex items-center gap-2 cursor-pointer select-none" style={{ fontSize: '0.82rem', color: '#6b7280' }}>
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                style={{ width: '15px', height: '15px', accentColor: '#1e3659', cursor: 'pointer' }}
              />
              Lembrar-me
            </label>
            <button
              type="button"
              onClick={() => router.push('/validar-senha')}
              style={{ fontSize: '0.82rem', color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
            >
              Esqueceu a senha?
            </button>
          </div>

          {/* Botao Entrar */}
          <button
            type="submit"
            disabled={loading}
            className="w-full font-bold tracking-widest transition-opacity"
            style={{
              background: 'linear-gradient(135deg, #c9972c 0%, #e0b84a 100%)',
              color: '#fff',
              border: 'none',
              borderRadius: '10px',
              height: '48px',
              fontSize: '1rem',
              letterSpacing: '0.15em',
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.7 : 1,
              boxShadow: '0 4px 14px rgba(201,151,44,0.4)',
            }}
          >
            {loading ? 'ENTRANDO...' : 'ENTRAR'}
          </button>
        </form>

        {/* Links rodape do card */}
        <div className="flex items-center gap-2 mt-5" style={{ fontSize: '0.82rem', color: '#6b7280' }}>
          <button
            type="button"
            onClick={() => router.push('/validar-senha')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', textDecoration: 'underline' }}
          >
            Esqueceu a senha?
          </button>
          <span style={{ color: '#d1d5db' }}>|</span>
          <button
            type="button"
            onClick={() => router.push('/pre-cadastro')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', textDecoration: 'underline' }}
          >
            Criar conta
          </button>
        </div>
      </div>

      {/* Rodape da pagina */}
      <div className="absolute bottom-4 left-0 right-0 text-center px-4">
        <p className="font-bold" style={{ fontSize: '0.7rem', color: '#7c2d12' }}>
          SISCOMIEADEPA &ndash; Sistema Integrado de Gestao Convencional &ndash; Ver 1.0
        </p>
        <p style={{ fontSize: '0.7rem', color: '#44403c' }}>
          Desenvolvido por: Alc&acirc;ntara Sistemas LTDA
        </p>
      </div>
    </div>
  );
}
