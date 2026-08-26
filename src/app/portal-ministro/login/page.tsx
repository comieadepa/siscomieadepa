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
  Smartphone,
  RotateCw,
} from 'lucide-react';

type Stage =
  | 'cpf'
  | 'first_access_date'
  | 'first_access_code'
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
  const [codigoOtp, setCodigoOtp] = useState('');
  const [canalOtp, setCanalOtp] = useState<'email' | 'whatsapp' | ''>('');
  const [destinoOtpMascarado, setDestinoOtpMascarado] = useState('');

  const [senha, setSenha] = useState('');
  const [senhaConfirm, setSenhaConfirm] = useState('');
  const [showSenha, setShowSenha] = useState(false);
  const [showSenhaConfirm, setShowSenhaConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [reenviandoOtp, setReenviandoOtp] = useState(false);
  const [erro, setErro] = useState('');
  const [emailMascarado, setEmailMascarado] = useState('');

  const cpfLimpo = cpf.replace(/\D/g, '');

  // Validações em tempo real de requisitos de senha
  const hasMinLen = senha.length >= 6;
  const hasLetter = /[a-zA-Z]/.test(senha);
  const hasNumber = /[0-9]/.test(senha);
  const isSenhaValid = hasMinLen && hasLetter && hasNumber;
  const senhasCoincidem = senha.length > 0 && senhaConfirm.length > 0 && senha === senhaConfirm;

  // Etapa 1: verificar CPF
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

  // Etapa 2A: Validar data de nascimento e solicitar código OTP 2FA
  const handleRequestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro('');

    if (!dataNascimento) {
      setErro('Informe sua data de nascimento para confirmação.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/portal-ministro/auth/first-access/request-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cpf: cpfLimpo,
          data_nascimento: dataNascimento,
        }),
      });
      const json = await res.json();

      if (!res.ok) {
        setErro(json.error || 'Erro ao validar dados.');
        setLoading(false);
        return;
      }

      setCanalOtp(json.canal || 'email');
      setDestinoOtpMascarado(json.destinoMascarado || '');
      setStage('first_access_code');
    } catch {
      setErro('Erro de conexão com o servidor. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  // Reenviar código OTP
  const handleResendOtp = async () => {
    setErro('');
    setReenviandoOtp(true);
    try {
      const res = await fetch('/api/portal-ministro/auth/first-access/request-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cpf: cpfLimpo,
          data_nascimento: dataNascimento,
        }),
      });
      const json = await res.json();

      if (!res.ok) {
        setErro(json.error || 'Erro ao reenviar código.');
        return;
      }

      setDestinoOtpMascarado(json.destinoMascarado || '');
    } catch {
      setErro('Erro de conexão. Tente novamente.');
    } finally {
      setReenviandoOtp(false);
    }
  };

  // Etapa 2B: Confirmar código OTP e criar senha (1º Acesso)
  const handleVerifyOtpAndCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro('');

    const codigoLimpo = codigoOtp.replace(/\D/g, '');
    if (!codigoLimpo || codigoLimpo.length !== 6) {
      setErro('Digite o código de confirmação de 6 dígitos.');
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
          codigo: codigoLimpo,
          senha,
          senhaConfirm,
        }),
      });
      const json = await res.json();

      if (!res.ok) {
        setErro(json.error || 'Erro ao confirmar código e criar senha.');
        setLoading(false);
        return;
      }

      window.location.href = '/portal-ministro/dashboard';
    } catch {
      setErro('Erro de conexão com o servidor. Tente novamente.');
      setLoading(false);
    }
  };

  // Login com senha existente
  const handleLoginPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro('');

    if (!senha) {
      setErro('Digite sua senha para entrar.');
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
    setErro('');
    setSenha('');
    setSenhaConfirm('');
    setDataNascimento('');
    setCodigoOtp('');
    setNomeMinistro('');
    setEmailMascarado('');
    setDestinoOtpMascarado('');
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#0D2B4E] via-[#123b63] to-[#1a4a7a] px-4 py-8">
      <div className="w-full max-w-md">
        
        {/* Cabeçalho com Logo Institucional */}
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

          {/* ── ETAPA 1: Identificação por CPF ── */}
          {stage === 'cpf' && (
            <div>
              <div className="mb-6">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 text-[#0D2B4E] text-xs font-semibold mb-3 border border-blue-100">
                  <ShieldCheck size={14} className="text-[#0D2B4E]" />
                  Acesso Restrito ao Ministro
                </div>
                <h2 className="text-xl font-bold text-gray-900 leading-tight">
                  Identificação
                </h2>
                <p className="text-gray-500 text-xs mt-1">
                  Digite seu CPF cadastrado para acessar o portal.
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

          {/* ── ETAPA 2A: 1º Acesso - Confirmação de Data de Nascimento ── */}
          {stage === 'first_access_date' && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <button
                  onClick={handleResetToCpf}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-[#0D2B4E] transition-colors"
                >
                  <ArrowLeft size={14} /> Trocar CPF
                </button>
                <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200">
                  1º Acesso
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

              <h2 className="text-lg font-bold text-gray-900 mb-1">
                Confirme seus Dados
              </h2>
              <p className="text-gray-500 text-xs mb-5">
                Informe sua data de nascimento cadastrada para enviarmos um código de segurança.
              </p>

              <form onSubmit={handleRequestOtp} className="space-y-5">
                <div>
                  <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">
                    Data de Nascimento
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
                      <span>Validando e enviando código...</span>
                    </>
                  ) : (
                    'Confirmar e Enviar Código'
                  )}
                </button>
              </form>
            </div>
          )}

          {/* ── ETAPA 2B: 1º Acesso - Digitar Código OTP 2FA + Criar Senha ── */}
          {stage === 'first_access_code' && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <button
                  onClick={() => {
                    setStage('first_access_date');
                    setErro('');
                    setCodigoOtp('');
                  }}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-[#0D2B4E] transition-colors"
                >
                  <ArrowLeft size={14} /> Voltar
                </button>
                <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-800 border border-blue-200">
                  2FA · Código Enviado
                </span>
              </div>

              {/* Informação do Destino do Código */}
              <div className="bg-blue-50/90 border border-blue-200 rounded-2xl p-3.5 mb-5 flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-[#0D2B4E] text-white flex items-center justify-center flex-shrink-0 shadow-sm mt-0.5">
                  {canalOtp === 'whatsapp' ? <Smartphone size={18} /> : <Mail size={18} />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-gray-600 leading-tight">
                    Enviamos um código de 6 dígitos via{' '}
                    <strong>{canalOtp === 'whatsapp' ? 'WhatsApp' : 'E-mail'}</strong> para:
                  </p>
                  <p className="text-xs font-mono font-bold text-[#0D2B4E] mt-0.5 truncate">
                    {destinoOtpMascarado}
                  </p>
                </div>
              </div>

              <form onSubmit={handleVerifyOtpAndCreate} className="space-y-4">
                {/* Campo Código OTP */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-bold text-gray-700 uppercase tracking-wider">
                      Código de 6 Dígitos
                    </label>
                    <button
                      type="button"
                      onClick={handleResendOtp}
                      disabled={reenviandoOtp}
                      className="text-xs font-semibold text-[#0D2B4E] hover:text-[#1a4a7a] hover:underline flex items-center gap-1 disabled:opacity-50"
                    >
                      <RotateCw size={11} className={reenviandoOtp ? 'animate-spin' : ''} />
                      {reenviandoOtp ? 'Reenviando...' : 'Reenviar código'}
                    </button>
                  </div>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="000000"
                    value={codigoOtp}
                    onChange={(e) => setCodigoOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    autoFocus
                    className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-center text-xl font-mono tracking-widest text-gray-900 font-bold focus:outline-none focus:ring-2 focus:ring-[#0D2B4E] focus:border-[#0D2B4E] transition-all bg-gray-50/50 hover:bg-white"
                    required
                  />
                </div>

                {/* Nova Senha */}
                <div>
                  <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">
                    Criar Nova Senha
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
                      <span>Validando e criando acesso...</span>
                    </>
                  ) : (
                    'Confirmar Código e Criar Acesso'
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
            <div className="text-center py-2 animate-fadeIn">
              <div className="w-14 h-14 bg-blue-100 text-[#0D2B4E] rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-sm">
                <Mail size={30} />
              </div>
              <h2 className="text-xl font-bold text-gray-900 mb-1">Instruções Enviadas!</h2>
              <p className="text-xs text-gray-600 mb-4 leading-relaxed">
                Se o CPF informado estiver cadastrado e possuir um e-mail válido, enviamos o link para:
              </p>

              {emailMascarado ? (
                <div className="bg-blue-50/80 border border-blue-200 rounded-xl p-3 mb-5">
                  <p className="text-xs font-mono font-bold text-[#0D2B4E]">
                    {emailMascarado}
                  </p>
                </div>
              ) : (
                <div className="bg-blue-50/80 border border-blue-200 rounded-xl p-3 mb-5">
                  <p className="text-xs text-gray-600">
                    O e-mail cadastrado junto à Secretaria da COMIEADEPA.
                  </p>
                </div>
              )}

              <p className="text-[11px] text-gray-400 mb-6 leading-relaxed">
                O link é válido por <strong>15 minutos</strong>. Verifique sua caixa de entrada e a pasta de spam.
              </p>

              <button
                type="button"
                onClick={handleResetToCpf}
                className="w-full bg-[#0D2B4E] hover:bg-[#163f6d] text-white font-bold py-3.5 rounded-xl shadow-lg shadow-[#0D2B4E]/20 transition-all text-sm"
              >
                Voltar para o Login
              </button>
            </div>
          )}

          {/* Rodapé Interno do Card */}
          <div className="mt-6 pt-4 border-t border-gray-100 text-center">
            <p className="text-xs text-gray-400">
              Dúvidas ou dificuldades de acesso?{' '}
              <span className="font-semibold text-gray-600 block sm:inline">
                Procure a Secretaria Geral
              </span>
            </p>
          </div>

        </div>

        {/* Rodapé Externo da Página */}
        <div className="text-center mt-6">
          <p className="text-xs text-blue-200/60 font-medium">
            COMIEADEPA &copy; {new Date().getFullYear()} · Todos os direitos reservados
          </p>
        </div>

      </div>
    </div>
  );
}
