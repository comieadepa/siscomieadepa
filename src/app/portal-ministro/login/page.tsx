'use client';

import { useState, Suspense, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import Image from 'next/image';
import {
  Eye,
  EyeOff,
  AlertCircle,
  ShieldCheck,
  CheckCircle2,
  Mail,
  Lock,
  ArrowRight,
  UserCheck,
  Calendar,
  CreditCard,
  ArrowLeft,
} from 'lucide-react';
import './login.css';

type Mode = 'login' | 'primeiro_acesso' | 'recuperar_senha';

function maskCpf(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

function PortalMinistroLoginForm() {
  const searchParams = useSearchParams();
  const redirectParam = searchParams?.get('redirect');
  const msgParam = searchParams?.get('msg');
  const modoParam = searchParams?.get('modo');

  const targetDestination = redirectParam && redirectParam.startsWith('/') ? redirectParam : '/app';

  const [mode, setMode] = useState<Mode>('login');

  // Estado Login
  const [emailLogin, setEmailLogin] = useState('');
  const [senhaLogin, setSenhaLogin] = useState('');
  const [showSenhaLogin, setShowSenhaLogin] = useState(false);

  // Estado Primeiro Acesso (Etapa 1: Validação de Identidade)
  const [paCpf, setPaCpf] = useState('');
  const [paDataNasc, setPaDataNasc] = useState('');
  const [paNomeMinistro, setPaNomeMinistro] = useState('');
  const [paEtapa, setPaEtapa] = useState<'validacao' | 'cadastro' | 'sucesso_envio'>('validacao');

  // Estado Primeiro Acesso (Etapa 2: Definição de E-mail e Senha)
  const [paEmail, setPaEmail] = useState('');
  const [paSenha, setPaSenha] = useState('');
  const [paSenhaConfirm, setPaSenhaConfirm] = useState('');
  const [showPaSenha, setShowPaSenha] = useState(false);
  const [showPaSenhaConfirm, setShowPaSenhaConfirm] = useState(false);

  // Estado Recuperação de Senha
  const [recupEmail, setRecupEmail] = useState('');
  const [recupSucesso, setRecupSucesso] = useState(false);

  // Estados Globais
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');

  useEffect(() => {
    if (msgParam === 'email_confirmado') {
      setAviso('E-mail confirmado com sucesso! Entre com seu e-mail e senha.');
    }
    if (modoParam === 'primeiro-acesso') {
      setMode('primeiro_acesso');
    }
  }, [msgParam, modoParam]);

  // Limpa erros ao alternar de aba/modo
  const alternarModo = (novoModo: Mode) => {
    setErro('');
    setAviso('');
    setMode(novoModo);
    if (novoModo === 'primeiro_acesso') {
      setPaEtapa('validacao');
    }
    if (novoModo === 'recuperar_senha') {
      setRecupSucesso(false);
    }
  };

  // 1. SUBMISSÃO DE LOGIN (E-MAIL + SENHA)
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro('');
    setAviso('');

    const emailLimpo = emailLogin.trim().toLowerCase();
    if (!emailLimpo || !emailLimpo.includes('@')) {
      setErro('Informe um endereço de e-mail válido.');
      return;
    }

    if (!senhaLogin) {
      setErro('Informe sua senha de acesso.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/portal-ministro/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: emailLimpo,
          senha: senhaLogin,
        }),
      });

      const json = await res.json();

      if (!res.ok) {
        setErro(json.error || 'Erro ao realizar login.');
        setLoading(false);
        return;
      }

      window.location.href = targetDestination;
    } catch {
      setErro('Erro de conexão com o servidor. Tente novamente.');
      setLoading(false);
    }
  };

  // 2. PRIMEIRO ACESSO — ETAPA 1: VALIDAR CPF E DATA DE NASCIMENTO
  const handleValidarIdentidade = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro('');

    const cpfLimpo = paCpf.replace(/\D/g, '');
    if (cpfLimpo.length !== 11) {
      setErro('Informe um CPF válido com 11 dígitos.');
      return;
    }

    if (!paDataNasc) {
      setErro('Informe sua data de nascimento.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/portal-ministro/auth/first-access/validate-cpf-birthdate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cpf: cpfLimpo,
          dataNascimento: paDataNasc,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        setErro(json.error || 'Dados não localizados ou divergentes do cadastro oficial.');
        setLoading(false);
        return;
      }

      setPaNomeMinistro(json.nome || 'Ministro');
      setPaEmail(json.emailSugerido || '');
      setPaEtapa('cadastro');
    } catch {
      setErro('Erro de conexão ao validar dados. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  // 2. PRIMEIRO ACESSO — ETAPA 2: REGISTRAR E-MAIL E SENHA
  const handleRegistrarConta = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro('');

    const emailLimpo = paEmail.trim().toLowerCase();
    if (!emailLimpo || !emailLimpo.includes('@')) {
      setErro('Informe um endereço de e-mail válido.');
      return;
    }

    const hasMinLen = paSenha.length >= 6;
    const hasLetter = /[a-zA-Z]/.test(paSenha);
    const hasNumber = /[0-9]/.test(paSenha);

    if (!hasMinLen || !hasLetter || !hasNumber) {
      setErro('A senha deve ter no mínimo 6 caracteres, com pelo menos 1 letra e 1 número.');
      return;
    }

    if (paSenha !== paSenhaConfirm) {
      setErro('As senhas não coincidem.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/portal-ministro/auth/first-access/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cpf: paCpf.replace(/\D/g, ''),
          dataNascimento: paDataNasc,
          email: emailLimpo,
          senha: paSenha,
          senhaConfirm: paSenhaConfirm,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        setErro(json.error || 'Erro ao registrar cadastro.');
        setLoading(false);
        return;
      }

      setPaEtapa('sucesso_envio');
    } catch {
      setErro('Erro ao processar ativação de conta. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  // 3. RECUPERAÇÃO DE SENHA
  const handleRecuperarSenha = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro('');

    const emailLimpo = recupEmail.trim().toLowerCase();
    if (!emailLimpo || !emailLimpo.includes('@')) {
      setErro('Informe o seu e-mail cadastrado.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/portal-ministro/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailLimpo }),
      });

      const json = await res.json();
      if (!res.ok) {
        setErro(json.error || 'Erro ao processar solicitação.');
        setLoading(false);
        return;
      }

      setRecupSucesso(true);
    } catch {
      setErro('Erro de conexão com o servidor. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#0D2B4E] via-[#123b63] to-[#1a4a7a] px-4 py-8">
      <div className="w-full max-w-md">
        
        {/* Topo / Logo */}
        <div className="text-center mb-6">
          <Image
            src="/img/logo_comieadepa.png"
            alt="COMIEADEPA"
            width={110}
            height={110}
            className="mx-auto mb-3 drop-shadow-xl"
            style={{ width: '110px', height: 'auto' }}
            priority
          />
          <h1 className="text-white text-2xl font-extrabold tracking-tight">
            Portal do Ministro
          </h1>
          <p className="text-blue-200 text-xs uppercase tracking-widest mt-1 font-medium">
            SISCOMIEADEPA · Convenção Estadual
          </p>
        </div>

        {/* Card Principal */}
        <div className="bg-white rounded-3xl shadow-2xl p-7 sm:p-8 border border-white/20 relative backdrop-blur-sm">

          {/* Banner de Aviso Positivo */}
          {aviso && (
            <div className="mb-5 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-2xl p-3.5 text-xs flex items-center gap-2.5">
              <CheckCircle2 size={18} className="text-emerald-600 flex-shrink-0" />
              <span>{aviso}</span>
            </div>
          )}

          {/* Banner de Erro */}
          {erro && (
            <div className="mb-5 bg-red-50 border border-red-200 text-red-700 rounded-2xl p-3.5 text-xs flex items-center gap-2.5">
              <AlertCircle size={18} className="text-red-600 flex-shrink-0" />
              <span>{erro}</span>
            </div>
          )}

          {/* ========================================================================= */}
          {/* MODO 1: LOGIN HABITUAL (E-MAIL + SENHA) */}
          {/* ========================================================================= */}
          {mode === 'login' && (
            <div>
              <div className="mb-6">
                <h2 className="text-lg font-bold text-gray-900">Acesse sua conta</h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  Informe seu e-mail e senha para entrar no aplicativo.
                </p>
              </div>

              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">
                    E-mail
                  </label>
                  <div className="relative">
                    <input
                      type="email"
                      value={emailLogin}
                      onChange={(e) => setEmailLogin(e.target.value)}
                      placeholder="seu.email@exemplo.com"
                      className="w-full border border-gray-300 rounded-xl px-4 py-3 pl-11 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#0D2B4E] transition-all bg-gray-50/50 hover:bg-white"
                      required
                      autoComplete="username"
                    />
                    <Mail size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-bold text-gray-700 uppercase tracking-wider">
                      Senha
                    </label>
                    <button
                      type="button"
                      onClick={() => alternarModo('recuperar_senha')}
                      className="text-xs text-[#0D2B4E] hover:underline font-semibold"
                    >
                      Esqueci minha senha
                    </button>
                  </div>
                  <div className="relative">
                    <input
                      type={showSenhaLogin ? 'text' : 'password'}
                      value={senhaLogin}
                      onChange={(e) => setSenhaLogin(e.target.value)}
                      placeholder="••••••••"
                      className="w-full border border-gray-300 rounded-xl px-4 py-3 pl-11 pr-11 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#0D2B4E] transition-all bg-gray-50/50 hover:bg-white"
                      required
                      autoComplete="current-password"
                    />
                    <Lock size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                    <button
                      type="button"
                      onClick={() => setShowSenhaLogin(!showSenhaLogin)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-1"
                      aria-label={showSenhaLogin ? 'Ocultar senha' : 'Ver senha'}
                    >
                      {showSenhaLogin ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-[#0D2B4E] hover:bg-[#163f6d] text-white font-bold py-3.5 rounded-xl shadow-lg shadow-[#0D2B4E]/20 transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-sm tracking-wide mt-2"
                >
                  {loading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      <span>Entrando...</span>
                    </>
                  ) : (
                    <>
                      <span>Entrar no Aplicativo</span>
                      <ArrowRight size={16} />
                    </>
                  )}
                </button>
              </form>

              <div className="mt-6 pt-5 border-t border-gray-100 text-center">
                <p className="text-xs text-gray-600">
                  Ainda não tem acesso?{' '}
                  <button
                    type="button"
                    onClick={() => alternarModo('primeiro_acesso')}
                    className="text-[#0D2B4E] font-bold hover:underline"
                  >
                    Cadastre-se
                  </button>
                </p>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* MODO 2: PRIMEIRO ACESSO (CADASTRE-SE) */}
          {/* ========================================================================= */}
          {mode === 'primeiro_acesso' && (
            <div>
              {/* ETAPA 1: VALIDAR CPF E DATA DE NASCIMENTO */}
              {paEtapa === 'validacao' && (
                <div>
                  <button
                    type="button"
                    onClick={() => alternarModo('login')}
                    className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-800 font-semibold mb-4"
                  >
                    <ArrowLeft size={14} />
                    <span>Voltar ao login</span>
                  </button>

                  <div className="mb-5">
                    <h2 className="text-lg font-bold text-gray-900">Primeiro Acesso</h2>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Informe seu CPF e data de nascimento cadastrados na Secretaria Geral.
                    </p>
                  </div>

                  <form onSubmit={handleValidarIdentidade} className="space-y-4">
                    <div>
                      <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">
                        CPF do Ministro
                      </label>
                      <div className="relative">
                        <input
                          type="text"
                          value={paCpf}
                          onChange={(e) => setPaCpf(maskCpf(e.target.value))}
                          placeholder="000.000.000-00"
                          maxLength={14}
                          className="w-full border border-gray-300 rounded-xl px-4 py-3 pl-11 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#0D2B4E] transition-all bg-gray-50/50 hover:bg-white"
                          required
                        />
                        <CreditCard size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">
                        Data de Nascimento
                      </label>
                      <div className="relative">
                        <input
                          type="date"
                          value={paDataNasc}
                          onChange={(e) => setPaDataNasc(e.target.value)}
                          className="w-full border border-gray-300 rounded-xl px-4 py-3 pl-11 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#0D2B4E] transition-all bg-gray-50/50 hover:bg-white"
                          required
                        />
                        <Calendar size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full bg-[#0D2B4E] hover:bg-[#163f6d] text-white font-bold py-3.5 rounded-xl shadow-lg shadow-[#0D2B4E]/20 transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-sm tracking-wide mt-2"
                    >
                      {loading ? (
                        <>
                          <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          <span>Consultando cadastro...</span>
                        </>
                      ) : (
                        <>
                          <span>Continuar</span>
                          <ArrowRight size={16} />
                        </>
                      )}
                    </button>
                  </form>
                </div>
              )}

              {/* ETAPA 2: DEFINIR E-MAIL E SENHA */}
              {paEtapa === 'cadastro' && (
                <div>
                  <div className="mb-4 bg-blue-50 border border-blue-200 rounded-2xl p-3 text-xs text-[#0D2B4E] flex items-center gap-2">
                    <UserCheck size={18} className="text-[#0D2B4E] flex-shrink-0" />
                    <div>
                      <p className="font-bold text-gray-900">{paNomeMinistro}</p>
                      <p className="text-[11px] text-gray-600">Cadastro oficial verificado com sucesso.</p>
                    </div>
                  </div>

                  <div className="mb-5">
                    <h2 className="text-base font-bold text-gray-900">Defina seu acesso</h2>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Informe o e-mail que você usa e crie sua senha de acesso.
                    </p>
                  </div>

                  <form onSubmit={handleRegistrarConta} className="space-y-3.5">
                    <div>
                      <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">
                        Seu E-mail
                      </label>
                      <div className="relative">
                        <input
                          type="email"
                          value={paEmail}
                          onChange={(e) => setPaEmail(e.target.value)}
                          placeholder="seu.email@exemplo.com"
                          className="w-full border border-gray-300 rounded-xl px-4 py-2.5 pl-10 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#0D2B4E] transition-all bg-gray-50/50 hover:bg-white"
                          required
                        />
                        <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                      </div>
                      <p className="text-[11px] text-gray-500 mt-1">
                        Você receberá um link neste e-mail para ativar a sua conta.
                      </p>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">
                        Criar Senha
                      </label>
                      <div className="relative">
                        <input
                          type={showPaSenha ? 'text' : 'password'}
                          value={paSenha}
                          onChange={(e) => setPaSenha(e.target.value)}
                          placeholder="Mínimo de 6 caracteres com letras e números"
                          className="w-full border border-gray-300 rounded-xl px-4 py-2.5 pl-10 pr-10 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#0D2B4E] transition-all bg-gray-50/50 hover:bg-white"
                          required
                        />
                        <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                        <button
                          type="button"
                          onClick={() => setShowPaSenha(!showPaSenha)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-1"
                        >
                          {showPaSenha ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">
                        Confirmar Senha
                      </label>
                      <div className="relative">
                        <input
                          type={showPaSenhaConfirm ? 'text' : 'password'}
                          value={paSenhaConfirm}
                          onChange={(e) => setPaSenhaConfirm(e.target.value)}
                          placeholder="Repita a senha criada"
                          className="w-full border border-gray-300 rounded-xl px-4 py-2.5 pl-10 pr-10 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#0D2B4E] transition-all bg-gray-50/50 hover:bg-white"
                          required
                        />
                        <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                        <button
                          type="button"
                          onClick={() => setShowPaSenhaConfirm(!showPaSenhaConfirm)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-1"
                        >
                          {showPaSenhaConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full bg-[#0D2B4E] hover:bg-[#163f6d] text-white font-bold py-3.5 rounded-xl shadow-lg shadow-[#0D2B4E]/20 transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-sm tracking-wide mt-2"
                    >
                      {loading ? (
                        <>
                          <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          <span>Enviando confirmação...</span>
                        </>
                      ) : (
                        'Cadastrar e Enviar Confirmação'
                      )}
                    </button>
                  </form>
                </div>
              )}

              {/* ETAPA 3: SUCESSO DO ENVIO */}
              {paEtapa === 'sucesso_envio' && (
                <div className="text-center py-4 space-y-4">
                  <div className="w-16 h-16 bg-blue-50 text-[#0D2B4E] rounded-full flex items-center justify-center mx-auto shadow-inner">
                    <Mail size={32} />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-gray-900">Confirme seu E-mail</h3>
                    <p className="text-sm text-gray-600 mt-2 leading-relaxed">
                      Enviamos um e-mail de ativação para <strong>{paEmail}</strong>.
                    </p>
                    <p className="text-xs text-gray-500 mt-2">
                      Abra a sua caixa de entrada e clique no botão <strong>Confirmar meu e-mail</strong> para ativar seu acesso.
                    </p>
                  </div>

                  <div className="pt-3">
                    <button
                      type="button"
                      onClick={() => alternarModo('login')}
                      className="w-full bg-[#0D2B4E] hover:bg-[#163f6d] text-white font-bold py-3 px-4 rounded-xl text-sm transition-all"
                    >
                      Voltar para a tela de Login
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ========================================================================= */}
          {/* MODO 3: RECUPERAR SENHA */}
          {/* ========================================================================= */}
          {mode === 'recuperar_senha' && (
            <div>
              <button
                type="button"
                onClick={() => alternarModo('login')}
                className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-800 font-semibold mb-4"
              >
                <ArrowLeft size={14} />
                <span>Voltar ao login</span>
              </button>

              {!recupSucesso ? (
                <div>
                  <div className="mb-5">
                    <h2 className="text-lg font-bold text-gray-900">Recuperação de Senha</h2>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Informe o e-mail cadastrado na sua conta para enviarmos as instruções.
                    </p>
                  </div>

                  <form onSubmit={handleRecuperarSenha} className="space-y-4">
                    <div>
                      <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">
                        E-mail Cadastrado
                      </label>
                      <div className="relative">
                        <input
                          type="email"
                          value={recupEmail}
                          onChange={(e) => setRecupEmail(e.target.value)}
                          placeholder="seu.email@exemplo.com"
                          className="w-full border border-gray-300 rounded-xl px-4 py-3 pl-11 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#0D2B4E] transition-all bg-gray-50/50 hover:bg-white"
                          required
                        />
                        <Mail size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full bg-[#0D2B4E] hover:bg-[#163f6d] text-white font-bold py-3.5 rounded-xl shadow-lg shadow-[#0D2B4E]/20 transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-sm tracking-wide mt-2"
                    >
                      {loading ? (
                        <>
                          <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          <span>Enviando link...</span>
                        </>
                      ) : (
                        'Enviar Link de Recuperação'
                      )}
                    </button>
                  </form>
                </div>
              ) : (
                <div className="text-center py-4 space-y-4">
                  <div className="w-16 h-16 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center mx-auto shadow-inner">
                    <CheckCircle2 size={36} />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-gray-900">Instruções Enviadas!</h3>
                    <p className="text-sm text-gray-600 mt-2 leading-relaxed">
                      Se o e-mail <strong>{recupEmail}</strong> estiver cadastrado, enviamos um link para redefinição de sua senha.
                    </p>
                    <p className="text-xs text-gray-500 mt-2">
                      Verifique sua caixa de entrada e pasta de spam. O link é válido por 15 minutos.
                    </p>
                  </div>

                  <div className="pt-3">
                    <button
                      type="button"
                      onClick={() => alternarModo('login')}
                      className="w-full bg-[#0D2B4E] hover:bg-[#163f6d] text-white font-bold py-3 px-4 rounded-xl text-sm transition-all"
                    >
                      Voltar ao Login
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Rodapé de Segurança */}
          <div className="mt-6 pt-4 border-t border-gray-100 flex items-center justify-center gap-1.5 text-gray-400 text-[11px]">
            <ShieldCheck size={14} className="text-[#0D2B4E]" />
            <span>Ambiente Seguro · COMIEADEPA Oficial</span>
          </div>

        </div>

        {/* Rodapé Externo */}
        <div className="text-center mt-6">
          <p className="text-xs text-blue-200/60 font-medium">
            COMIEADEPA &copy; {new Date().getFullYear()} · Todos os direitos reservados
          </p>
        </div>

      </div>
    </div>
  );
}

export default function PortalMinistroLoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#0D2B4E] via-[#123b63] to-[#1a4a7a]">
          <div className="w-8 h-8 border-3 border-white/30 border-t-white rounded-full animate-spin" />
        </div>
      }
    >
      <PortalMinistroLoginForm />
    </Suspense>
  );
}
