'use client';

import { useState } from 'react';
import Image from 'next/image';
import {
  Eye,
  EyeOff,
  ArrowLeft,
  Check,
  AlertCircle,
  ShieldCheck,
  UserCheck,
  Mail,
  Lock,
  Calendar,
  CheckCircle2,
} from 'lucide-react';

type Stage =
  | 'cpf'
  | 'first_access_date'
  | 'first_access_create'
  | 'password'
  | 'forgot_password'
  | 'forgot_sent';

function maskCpf(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

export default function PortalMinistroLoginPage() {
  const [stage, setStage] = useState<Stage>('cpf');
  const [cpf, setCpf] = useState('');
  const [nomeMinistro, setNomeMinistro] = useState('');
  const [dataNascimento, setDataNascimento] = useState('');
  const [emailRecuperacao, setEmailRecuperacao] = useState('');

  const [senha, setSenha] = useState('');
  const [senhaConfirm, setSenhaConfirm] = useState('');
  const [showSenha, setShowSenha] = useState(false);
  const [showSenhaConfirm, setShowSenhaConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState('');
  const [emailMascarado, setEmailMascarado] = useState('');

  const cpfLimpo = cpf.replace(/\D/g, '');

  // Validações em tempo real de requisitos de senha
  const hasMinLen = senha.length >= 6;
  const hasLetter = /[a-zA-Z]/.test(senha);
  const hasNumber = /[0-9]/.test(senha);
  const isSenhaValid = hasMinLen && hasLetter && hasNumber;
  const senhasCoincidem = senha.length > 0 && senhaConfirm.length > 0 && senha === senhaConfirm;

  // Etapa 1: Verificar CPF
  const handleCheckCpf = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro('');
    if (cpfLimpo.length !== 11) {
      setErro('Digite um CPF válido com 11 dígitos.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/portal-ministro/auth/check-cpf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cpf: cpfLimpo }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErro(json.error || 'CPF não encontrado no cadastro ministerial.');
        return;
      }
      setNomeMinistro(json.nome || '');
      setStage(json.hasPassword ? 'password' : 'first_access_date');
    } catch {
      setErro('Erro de conexão com o servidor. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  // Etapa 2A (1º Acesso - Passo 1): Validar Data de Nascimento
  const handleValidateBirthdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro('');

    if (!dataNascimento) {
      setErro('Informe sua data de nascimento para confirmação.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/portal-ministro/auth/first-access/validate-birthdate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cpf: cpfLimpo,
          data_nascimento: dataNascimento,
        }),
      });
      const json = await res.json();

      if (!res.ok) {
        setErro(json.error || 'Data de nascimento incorreta.');
        setLoading(false);
        return;
      }

      if (json.emailSugerido && !emailRecuperacao) {
        setEmailRecuperacao(json.emailSugerido);
      }

      setStage('first_access_create');
    } catch {
      setErro('Erro de conexão com o servidor. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  // Etapa 2B (1º Acesso - Passo 2): Criar Senha e Salvar E-mail
  const handleFirstAccessCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro('');

    const emailLimpo = emailRecuperacao.trim();
    if (!emailLimpo || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailLimpo)) {
      setErro('Informe um e-mail de recuperação válido.');
      return;
    }

    if (!isSenhaValid) {
      setErro('A nova senha deve atender a todos os requisitos de segurança.');
      return;
    }

    if (senha !== senhaConfirm) {
      setErro('As senhas digitadas não coincidem.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/portal-ministro/auth/first-access/verify-and-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cpf: cpfLimpo,
          data_nascimento: dataNascimento,
          email: emailLimpo,
          senha,
          senhaConfirm,
        }),
      });
      const json = await res.json();

      if (!res.ok) {
        setErro(json.error || 'Erro ao cadastrar senha de acesso.');
        setLoading(false);
        return;
      }

      window.location.href = '/portal-ministro/dashboard';
    } catch {
      setErro('Erro de conexão com o servidor. Tente novamente.');
      setLoading(false);
    }
  };

  // Etapa 3: Login com Senha Existente
  const handleLoginPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro('');
    if (!senha) {
      setErro('Digite sua senha.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/portal-ministro/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cpf: cpfLimpo,
          tipo: 'senha',
          senha,
        }),
      });
      const json = await res.json();

      if (!res.ok) {
        setErro(json.error || 'Erro ao realizar login.');
        setLoading(false);
        return;
      }

      window.location.href = '/portal-ministro/dashboard';
    } catch {
      setErro('Erro de conexão. Verifique sua internet e tente novamente.');
      setLoading(false);
    }
  };

  // Solicitar recuperação de senha
  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro('');
    if (cpfLimpo.length !== 11) {
      setErro('Digite um CPF válido com 11 dígitos.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/portal-ministro/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cpf: cpfLimpo }),
      });
      const json = await res.json();

      if (!res.ok) {
        setErro(json.error || 'Erro ao solicitar recuperação de senha.');
        setLoading(false);
        return;
      }

      setEmailMascarado(json.emailMascarado || '');
      setStage('forgot_sent');
    } catch {
      setErro('Erro de conexão com o servidor. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  const handleResetToCpf = () => {
    setStage('cpf');
    setSenha('');
    setSenhaConfirm('');
    setDataNascimento('');
    setEmailRecuperacao('');
    setErro('');
    setNomeMinistro('');
    setEmailMascarado('');
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#0D2B4E] via-[#123b63] to-[#1a4a7a] px-4 py-8 relative overflow-hidden">
      
      {/* Elementos Decorativos de Fundo */}
      <div className="absolute -top-32 -left-32 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-32 -right-32 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />

      <div className="w-full max-w-md relative z-10">

        {/* Logo & Título Institucional */}
        <div className="text-center mb-6">
          <div className="inline-block p-1 rounded-2xl bg-white/10 backdrop-blur-md border border-white/20 shadow-2xl mb-3">
            <Image
              src="/img/logo_comieadepa.png"
              alt="COMIEADEPA"
              width={100}
              height={100}
              className="drop-shadow-lg"
              style={{ width: '100px', height: 'auto' }}
              priority
            />
          </div>
          <h1 className="text-white text-2xl font-extrabold tracking-tight">
            Portal do Ministro
          </h1>
          <p className="text-blue-200/90 text-xs uppercase tracking-widest mt-1 font-semibold">
            COMIEADEPA · Convenção Estadual
          </p>
        </div>

        {/* Card Principal */}
        <div className="bg-white rounded-3xl shadow-2xl p-7 sm:p-8 border border-white/20 relative backdrop-blur-sm transition-all duration-300">

          {/* ── ETAPA 1: Identificação por CPF ── */}
          {stage === 'cpf' && (
            <div>
              <div className="mb-6">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 text-[#0D2B4E] text-xs font-semibold mb-3 border border-blue-100">
                  <ShieldCheck size={14} className="text-[#0D2B4E]" />
                  Acesso Restrito ao Ministro
                </div>
                <h2 className="text-xl font-bold text-gray-900 leading-tight">
                  Identifique-se para entrar
                </h2>
                <p className="text-gray-500 text-xs mt-1 leading-relaxed">
                  Digite seu CPF cadastrado na COMIEADEPA para continuar.
                </p>
              </div>

              <form onSubmit={handleCheckCpf} className="space-y-5">
                <div>
                  <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">
                    CPF
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="000.000.000-00"
                    value={cpf}
                    onChange={(e) => setCpf(maskCpf(e.target.value))}
                    autoFocus
                    className="w-full border border-gray-300 rounded-xl px-4 py-3 text-base text-gray-900 font-medium focus:outline-none focus:ring-2 focus:ring-[#0D2B4E] focus:border-[#0D2B4E] transition-all bg-gray-50/50 hover:bg-white"
                    required
                  />
                </div>

                {erro && (
                  <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-xs flex items-start gap-2">
                    <AlertCircle size={16} className="text-red-600 flex-shrink-0 mt-0.5" />
                    <span>{erro}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-[#0D2B4E] hover:bg-[#163f6d] text-white font-bold py-3.5 rounded-xl shadow-lg shadow-[#0D2B4E]/20 transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-sm tracking-wide"
                >
                  {loading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      <span>Verificando cadastro...</span>
                    </>
                  ) : (
                    'Continuar'
                  )}
                </button>
              </form>
            </div>
          )}

          {/* ── ETAPA 2A: 1º Acesso - Passo 1: Confirmação de Identidade (Apenas Data de Nascimento) ── */}
          {stage === 'first_access_date' && (
            <div className="transition-opacity duration-300">
              <div className="flex items-center justify-between mb-4">
                <button
                  onClick={handleResetToCpf}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-[#0D2B4E] transition-colors"
                >
                  <ArrowLeft size={14} /> Trocar CPF
                </button>
                <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200">
                  1º Acesso · Passo 1 de 2
                </span>
              </div>

              {/* Identificação do Ministro */}
              <div className="bg-blue-50/80 border border-blue-100 rounded-2xl p-3.5 mb-5 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#0D2B4E] text-white font-bold flex items-center justify-center text-base flex-shrink-0 shadow-sm">
                  {nomeMinistro ? nomeMinistro.charAt(0).toUpperCase() : <UserCheck size={18} />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-gray-500 font-medium leading-none">Ministro localizado</p>
                  <p className="text-sm font-bold text-[#0D2B4E] truncate mt-1">
                    {nomeMinistro}
                  </p>
                  <p className="text-[11px] text-gray-400 font-mono mt-0.5">
                    CPF: {maskCpf(cpf)}
                  </p>
                </div>
              </div>

              <div className="mb-5">
                <h2 className="text-lg font-bold text-gray-900 leading-tight">
                  Confirme sua Identidade
                </h2>
                <p className="text-gray-500 text-xs mt-1">
                  Para sua segurança, informe sua data de nascimento cadastrada na convenção.
                </p>
              </div>

              <form onSubmit={handleValidateBirthdate} className="space-y-5">
                <div>
                  <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">
                    <span className="flex items-center gap-1.5">
                      <Calendar size={14} className="text-[#0D2B4E]" />
                      Data de Nascimento
                    </span>
                  </label>
                  <input
                    type="date"
                    value={dataNascimento}
                    onChange={(e) => setDataNascimento(e.target.value)}
                    autoFocus
                    className="w-full border border-gray-300 rounded-xl px-4 py-3 text-base text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#0D2B4E] focus:border-[#0D2B4E] transition-all bg-gray-50/50 hover:bg-white font-medium"
                    required
                  />
                </div>

                {erro && (
                  <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-xs flex items-start gap-2">
                    <AlertCircle size={16} className="text-red-600 flex-shrink-0 mt-0.5" />
                    <span>{erro}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-[#0D2B4E] hover:bg-[#163f6d] text-white font-bold py-3.5 rounded-xl shadow-lg shadow-[#0D2B4E]/20 transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-sm tracking-wide"
                >
                  {loading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      <span>Validando dados...</span>
                    </>
                  ) : (
                    'Confirmar Data de Nascimento'
                  )}
                </button>
              </form>
            </div>
          )}

          {/* ── ETAPA 2B: 1º Acesso - Passo 2: Criação do Acesso (E-mail + Senha) ── */}
          {stage === 'first_access_create' && (
            <div className="animate-fadeIn transition-opacity duration-300">
              <div className="flex items-center justify-between mb-4">
                <button
                  onClick={() => {
                    setStage('first_access_date');
                    setErro('');
                  }}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-[#0D2B4E] transition-colors"
                >
                  <ArrowLeft size={14} /> Voltar
                </button>
                <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200 flex items-center gap-1">
                  <CheckCircle2 size={12} className="text-emerald-600" />
                  Identidade Confirmada · Passo 2 de 2
                </span>
              </div>

              {/* Identificação do Ministro */}
              <div className="bg-blue-50/80 border border-blue-100 rounded-2xl p-3.5 mb-5 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#0D2B4E] text-white font-bold flex items-center justify-center text-base flex-shrink-0 shadow-sm">
                  {nomeMinistro ? nomeMinistro.charAt(0).toUpperCase() : <UserCheck size={18} />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-gray-500 font-medium leading-none">Ministro</p>
                  <p className="text-sm font-bold text-[#0D2B4E] truncate mt-1">
                    {nomeMinistro}
                  </p>
                  <p className="text-[11px] text-gray-400 font-mono mt-0.5">
                    CPF: {maskCpf(cpf)}
                  </p>
                </div>
              </div>

              <div className="mb-4">
                <h2 className="text-lg font-bold text-gray-900 leading-tight">
                  Cadastre sua Senha de Acesso
                </h2>
                <p className="text-gray-500 text-xs mt-1">
                  Defina seu e-mail de recuperação e crie sua senha de acesso ao portal.
                </p>
              </div>

              <form onSubmit={handleFirstAccessCreate} className="space-y-4">
                {/* E-mail de Recuperação */}
                <div>
                  <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">
                    <span className="flex items-center gap-1">
                      <Mail size={13} className="text-[#0D2B4E]" />
                      E-mail de Recuperação (Obrigatório)
                    </span>
                  </label>
                  <input
                    type="email"
                    placeholder="seuemail@exemplo.com"
                    value={emailRecuperacao}
                    onChange={(e) => setEmailRecuperacao(e.target.value)}
                    autoFocus
                    className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#0D2B4E] focus:border-[#0D2B4E] transition-all bg-gray-50/50 hover:bg-white font-medium"
                    required
                  />
                  <p className="text-[10px] text-gray-400 mt-1">
                    Utilizado exclusivamente caso precise redefinir sua senha no futuro.
                  </p>
                </div>

                {/* Nova Senha */}
                <div>
                  <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">
                    <span className="flex items-center gap-1">
                      <Lock size={13} className="text-[#0D2B4E]" />
                      Nova Senha
                    </span>
                  </label>
                  <div className="relative">
                    <input
                      type={showSenha ? 'text' : 'password'}
                      value={senha}
                      onChange={(e) => setSenha(e.target.value)}
                      placeholder="Digite sua senha"
                      className="w-full border border-gray-300 rounded-xl px-4 py-2.5 pr-11 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#0D2B4E] focus:border-[#0D2B4E] transition-all bg-gray-50/50 hover:bg-white"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowSenha(!showSenha)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-1"
                      aria-label={showSenha ? 'Ocultar senha' : 'Ver senha'}
                    >
                      {showSenha ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                {/* Checklist Visual de Requisitos de Senha */}
                <div className="bg-gray-50 rounded-xl p-3 border border-gray-100 space-y-1.5">
                  <p className="text-[11px] font-bold text-gray-600 uppercase tracking-wider mb-1">
                    Requisitos da senha:
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5 text-xs">
                    <div className={`flex items-center gap-1.5 ${hasMinLen ? 'text-green-700 font-semibold' : 'text-gray-400'}`}>
                      <div className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] ${hasMinLen ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-400'}`}>
                        {hasMinLen ? <Check size={11} /> : '•'}
                      </div>
                      <span className="text-[11px]">6+ dígitos</span>
                    </div>
                    <div className={`flex items-center gap-1.5 ${hasLetter ? 'text-green-700 font-semibold' : 'text-gray-400'}`}>
                      <div className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] ${hasLetter ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-400'}`}>
                        {hasLetter ? <Check size={11} /> : '•'}
                      </div>
                      <span className="text-[11px]">1 letra</span>
                    </div>
                    <div className={`flex items-center gap-1.5 ${hasNumber ? 'text-green-700 font-semibold' : 'text-gray-400'}`}>
                      <div className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] ${hasNumber ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-400'}`}>
                        {hasNumber ? <Check size={11} /> : '•'}
                      </div>
                      <span className="text-[11px]">1 número</span>
                    </div>
                  </div>
                </div>

                {/* Confirmar Nova Senha */}
                <div>
                  <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">
                    Confirmar Nova Senha
                  </label>
                  <div className="relative">
                    <input
                      type={showSenhaConfirm ? 'text' : 'password'}
                      value={senhaConfirm}
                      onChange={(e) => setSenhaConfirm(e.target.value)}
                      placeholder="Repita a senha digitada"
                      className={`w-full border rounded-xl px-4 py-2.5 pr-11 text-sm text-gray-800 focus:outline-none focus:ring-2 transition-all bg-gray-50/50 hover:bg-white ${
                        senhaConfirm.length > 0
                          ? senhasCoincidem
                            ? 'border-green-400 focus:ring-green-500'
                            : 'border-red-400 focus:ring-red-500'
                          : 'border-gray-300 focus:ring-[#0D2B4E]'
                      }`}
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowSenhaConfirm(!showSenhaConfirm)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-1"
                      aria-label={showSenhaConfirm ? 'Ocultar senha' : 'Ver senha'}
                    >
                      {showSenhaConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  {senhaConfirm.length > 0 && !senhasCoincidem && (
                    <p className="text-[11px] text-red-600 mt-1 font-medium">As senhas não coincidem.</p>
                  )}
                </div>

                {erro && (
                  <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-xs flex items-start gap-2">
                    <AlertCircle size={16} className="text-red-600 flex-shrink-0 mt-0.5" />
                    <span>{erro}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-[#0D2B4E] hover:bg-[#163f6d] text-white font-bold py-3.5 rounded-xl shadow-lg shadow-[#0D2B4E]/20 transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-sm tracking-wide mt-2"
                >
                  {loading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      <span>Criando acesso e entrando...</span>
                    </>
                  ) : (
                    'Criar Senha e Acessar o Portal'
                  )}
                </button>
              </form>
            </div>
          )}

          {/* ── ETAPA 3: Login com Senha Existente ── */}
          {stage === 'password' && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <button
                  onClick={handleResetToCpf}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-[#0D2B4E] transition-colors"
                >
                  <ArrowLeft size={14} /> Trocar CPF
                </button>
                <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-green-100 text-green-800 border border-green-200">
                  Ministro Cadastrado
                </span>
              </div>

              {/* Cartão de Boas-Vindas com Nome do Ministro */}
              <div className="bg-gradient-to-r from-blue-50 to-indigo-50/50 border border-blue-100 rounded-2xl p-4 mb-5 flex items-center gap-3.5">
                <div className="w-11 h-11 rounded-2xl bg-[#0D2B4E] text-white font-bold flex items-center justify-center text-lg flex-shrink-0 shadow-md">
                  {nomeMinistro ? nomeMinistro.charAt(0).toUpperCase() : <UserCheck size={20} />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-gray-500 font-medium leading-none">
                    Bem-vindo de volta!
                  </p>
                  <p className="text-sm font-extrabold text-[#0D2B4E] truncate mt-1">
                    {nomeMinistro || 'Ministro'}
                  </p>
                  <p className="text-[11px] text-gray-400 font-mono mt-0.5">
                    CPF: {maskCpf(cpf)}
                  </p>
                </div>
              </div>

              <h2 className="text-lg font-bold text-gray-900 mb-1">
                Digite sua senha
              </h2>
              <p className="text-gray-500 text-xs mb-5">
                Insira sua senha cadastrada para entrar no portal.
              </p>

              <form onSubmit={handleLoginPassword} className="space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-bold text-gray-700 uppercase tracking-wider">
                      Senha
                    </label>
                    
                    <button
                      type="button"
                      onClick={() => {
                        setErro('');
                        setStage('forgot_password');
                      }}
                      className="text-xs font-semibold text-[#0D2B4E] hover:text-[#1a4a7a] hover:underline transition-colors focus:outline-none focus:ring-1 focus:ring-[#0D2B4E] rounded px-1"
                    >
                      Esqueci minha senha?
                    </button>
                  </div>

                  <div className="relative">
                    <input
                      type={showSenha ? 'text' : 'password'}
                      value={senha}
                      onChange={(e) => setSenha(e.target.value)}
                      autoFocus
                      placeholder="Sua senha de acesso"
                      className="w-full border border-gray-300 rounded-xl px-4 py-3 pr-11 text-base text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#0D2B4E] focus:border-[#0D2B4E] transition-all bg-gray-50/50 hover:bg-white"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowSenha(!showSenha)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-1.5"
                      aria-label={showSenha ? 'Ocultar senha' : 'Ver senha'}
                    >
                      {showSenha ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>

                  <div className="flex justify-end mt-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setErro('');
                        setStage('forgot_password');
                      }}
                      className="text-[11px] font-medium text-gray-500 hover:text-[#0D2B4E] hover:underline transition-colors"
                    >
                      Problemas com a senha? <span className="font-bold text-[#0D2B4E]">Recuperar acesso</span>
                    </button>
                  </div>
                </div>

                {erro && (
                  <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-xs flex items-start gap-2">
                    <AlertCircle size={16} className="text-red-600 flex-shrink-0 mt-0.5" />
                    <span>{erro}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-[#0D2B4E] hover:bg-[#163f6d] text-white font-bold py-3.5 rounded-xl shadow-lg shadow-[#0D2B4E]/20 transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-sm tracking-wide mt-2"
                >
                  {loading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      <span>Autenticando...</span>
                    </>
                  ) : (
                    'Entrar no Portal'
                  )}
                </button>
              </form>
            </div>
          )}

          {/* ── ETAPA 4: Solicitar Esqueci Minha Senha ── */}
          {stage === 'forgot_password' && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <button
                  onClick={() => {
                    setErro('');
                    setStage(nomeMinistro ? 'password' : 'cpf');
                  }}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-[#0D2B4E] transition-colors"
                >
                  <ArrowLeft size={14} /> Voltar
                </button>
                <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-800 border border-blue-200">
                  Recuperação
                </span>
              </div>

              {/* Identificação do Ministro quando já temos o CPF */}
              {nomeMinistro && cpfLimpo.length === 11 ? (
                <div className="bg-blue-50/80 border border-blue-100 rounded-2xl p-3.5 mb-5 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[#0D2B4E] text-white font-bold flex items-center justify-center text-base flex-shrink-0 shadow-sm">
                    {nomeMinistro.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-gray-500 font-medium leading-none">Ministro</p>
                    <p className="text-sm font-bold text-[#0D2B4E] truncate mt-1">
                      {nomeMinistro}
                    </p>
                    <p className="text-[11px] text-gray-400 font-mono mt-0.5">
                      CPF: {maskCpf(cpf)}
                    </p>
                  </div>
                </div>
              ) : null}

              <div className="mb-5">
                <h2 className="text-xl font-bold text-gray-900 leading-tight">
                  Recuperar Senha
                </h2>
                <p className="text-gray-500 text-xs mt-1 leading-relaxed">
                  {nomeMinistro && cpfLimpo.length === 11
                    ? 'Enviaremos um link de recuperação exclusivo para o e-mail cadastrado na convenção para o seu CPF.'
                    : 'Informe seu CPF. Enviaremos um link de recuperação exclusivo para o e-mail cadastrado na convenção.'}
                </p>
              </div>

              <form onSubmit={handleForgotPassword} className="space-y-5">
                {(!nomeMinistro || cpfLimpo.length !== 11) && (
                  <div>
                    <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">
                      CPF
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      autoComplete="off"
                      placeholder="000.000.000-00"
                      value={cpf}
                      onChange={(e) => setCpf(maskCpf(e.target.value))}
                      autoFocus
                      className="w-full border border-gray-300 rounded-xl px-4 py-3 text-base text-gray-900 font-medium focus:outline-none focus:ring-2 focus:ring-[#0D2B4E] focus:border-[#0D2B4E] transition-all bg-gray-50/50 hover:bg-white"
                      required
                    />
                  </div>
                )}

                {erro && (
                  <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-xs flex items-start gap-2">
                    <AlertCircle size={16} className="text-red-600 flex-shrink-0 mt-0.5" />
                    <span>{erro}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-[#0D2B4E] hover:bg-[#163f6d] text-white font-bold py-3.5 rounded-xl shadow-lg shadow-[#0D2B4E]/20 transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-sm tracking-wide"
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
          )}

          {/* ── ETAPA 5: Confirmação de Envio do E-mail de Recuperação ── */}
          {stage === 'forgot_sent' && (
            <div className="text-center py-2">
              <div className="w-14 h-14 bg-green-100 text-green-700 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-inner">
                <Mail size={28} />
              </div>

              <h2 className="text-xl font-bold text-gray-900 mb-2">
                Instruções Enviadas!
              </h2>

              <p className="text-gray-600 text-xs leading-relaxed mb-4">
                Se os dados informados estiverem corretos, enviamos um link para redefinição de senha para o e-mail cadastrado:
              </p>

              {emailMascarado ? (
                <div className="bg-gray-50 border border-gray-200 rounded-xl py-2.5 px-4 mb-6 inline-block">
                  <span className="font-mono text-sm font-bold text-[#0D2B4E]">
                    {emailMascarado}
                  </span>
                </div>
              ) : (
                <div className="mb-6" />
              )}

              <p className="text-[11px] text-gray-400 mb-6">
                O link é válido por <strong>15 minutos</strong>. Verifique sua caixa de entrada e a pasta de spam.
              </p>

              <button
                type="button"
                onClick={handleResetToCpf}
                className="w-full bg-[#0D2B4E] hover:bg-[#163f6d] text-white font-bold py-3.5 rounded-xl transition-all text-sm shadow-md"
              >
                Voltar para o Início
              </button>
            </div>
          )}

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
