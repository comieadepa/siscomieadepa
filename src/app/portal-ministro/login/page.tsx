'use client';

import { useState } from 'react';
import Image from 'next/image';
import {
  Eye,
  EyeOff,
  ArrowLeft,
  AlertCircle,
  ShieldCheck,
  UserCheck,
  Mail,
  FileBadge,
  CheckCircle2,
  PhoneCall,
} from 'lucide-react';

type Stage =
  | 'identificacao'
  | 'first_access_registro'
  | 'first_access_sent'
  | 'first_access_sem_email'
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
  const [stage, setStage] = useState<Stage>('identificacao');
  const [identificador, setIdentificador] = useState('');
  const [cpfMinistro, setCpfMinistro] = useState('');
  const [nomeMinistro, setNomeMinistro] = useState('');
  const [registroConvencional, setRegistroConvencional] = useState('');

  const [senha, setSenha] = useState('');
  const [showSenha, setShowSenha] = useState(false);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState('');
  const [emailMascarado, setEmailMascarado] = useState('');

  // Identificação inicial por CPF ou E-mail
  const handleCheckIdentificador = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro('');
    const idLimpo = identificador.trim();
    if (!idLimpo) {
      setErro('Informe seu CPF ou E-mail cadastrado na COMIEADEPA.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/portal-ministro/auth/check-cpf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identificador: idLimpo }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErro(json.error || 'Cadastro não localizado. Procure a Secretaria Geral.');
        return;
      }

      setNomeMinistro(json.nome || '');
      setCpfMinistro(json.cpf || (json.identificadorTipo === 'cpf' ? idLimpo.replace(/\D/g, '') : ''));

      if (json.hasPassword) {
        setStage('password');
      } else {
        setStage('first_access_registro');
      }
    } catch {
      setErro('Erro de conexão com o servidor. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  // 1º Acesso: Validação com CPF + Registro Convencional e Envio de Link Único
  const handleValidateRegistro = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro('');

    const reg = registroConvencional.trim();
    if (!reg) {
      setErro('Informe o seu Registro Convencional ou Matrícula.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/portal-ministro/auth/first-access/validate-registro', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cpf: cpfMinistro,
          registro: reg,
        }),
      });
      const json = await res.json();

      if (!res.ok) {
        if (json.requerSecretaria) {
          setErro(json.error);
          setStage('first_access_sem_email');
          return;
        }
        setErro(json.error || 'Registro Convencional ou Matrícula incorreto.');
        return;
      }

      setEmailMascarado(json.emailMascarado || '');
      setStage('first_access_sent');
    } catch {
      setErro('Erro de conexão com o servidor. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  // Login com Senha Existente
  const handleLoginPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro('');
    if (!senha) {
      setErro('Digite sua senha de acesso.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/portal-ministro/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identificador: identificador.trim() || cpfMinistro,
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
    const idParaEnvio = identificador.trim() || cpfMinistro;

    if (!idParaEnvio) {
      setErro('Informe seu CPF ou E-mail cadastrado.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/portal-ministro/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identificador: idParaEnvio }),
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

  const handleResetToInicio = () => {
    setStage('identificacao');
    setIdentificador('');
    setCpfMinistro('');
    setNomeMinistro('');
    setRegistroConvencional('');
    setSenha('');
    setErro('');
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
            Aplicativo do Ministro
          </h1>
          <p className="text-blue-200/90 text-xs uppercase tracking-widest mt-1 font-semibold">
            COMIEADEPA · Convenção Estadual
          </p>
        </div>

        {/* Card Principal */}
        <div className="bg-white rounded-3xl shadow-2xl p-7 sm:p-8 border border-white/20 relative backdrop-blur-sm transition-all duration-300">

          {/* ── ETAPA 1: Identificação (CPF ou E-mail) ── */}
          {stage === 'identificacao' && (
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
                  Informe seu CPF ou E-mail cadastrado na convenção.
                </p>
              </div>

              <form onSubmit={handleCheckIdentificador} className="space-y-5">
                <div>
                  <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">
                    CPF ou E-mail
                  </label>
                  <input
                    type="text"
                    autoComplete="username"
                    placeholder="000.000.000-00 ou seuemail@exemplo.com"
                    value={identificador}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (!val.includes('@') && /^\d+$/.test(val.replace(/\D/g, '')) && val.length <= 14) {
                        setIdentificador(maskCpf(val));
                      } else {
                        setIdentificador(val);
                      }
                    }}
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
                      <span>Consultando cadastro...</span>
                    </>
                  ) : (
                    'Continuar'
                  )}
                </button>
              </form>
            </div>
          )}

          {/* ── ETAPA 2: 1º Acesso - Validação de Titularidade com Registro Convencional ── */}
          {stage === 'first_access_registro' && (
            <div className="transition-opacity duration-300">
              <div className="flex items-center justify-between mb-4">
                <button
                  onClick={handleResetToInicio}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-[#0D2B4E] transition-colors"
                >
                  <ArrowLeft size={14} /> Voltar
                </button>
                <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200">
                  Primeiro Acesso
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
                  {cpfMinistro && (
                    <p className="text-[11px] text-gray-400 font-mono mt-0.5">
                      CPF: {maskCpf(cpfMinistro)}
                    </p>
                  )}
                </div>
              </div>

              <div className="mb-5">
                <h2 className="text-lg font-bold text-gray-900 leading-tight">
                  Confirme a Titularidade
                </h2>
                <p className="text-gray-500 text-xs mt-1 leading-relaxed">
                  Para sua segurança contra assunção indevida de contas, digite o seu <strong>Registro Convencional</strong> (ou Matrícula oficial) que consta em sua credencial.
                </p>
              </div>

              <form onSubmit={handleValidateRegistro} className="space-y-5">
                <div>
                  <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">
                    <span className="flex items-center gap-1.5">
                      <FileBadge size={14} className="text-[#0D2B4E]" />
                      Registro Convencional / Matrícula
                    </span>
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={registroConvencional}
                    onChange={(e) => setRegistroConvencional(e.target.value)}
                    autoFocus
                    placeholder="Ex: 3751"
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
                      <span>Validando registro e enviando confirmação...</span>
                    </>
                  ) : (
                    'Confirmar e Enviar Link de Ativação'
                  )}
                </button>
              </form>
            </div>
          )}

          {/* ── ETAPA 2A: Link de Confirmação Única Enviado com Sucesso ── */}
          {stage === 'first_access_sent' && (
            <div className="text-center py-2">
              <div className="w-14 h-14 bg-emerald-100 text-emerald-700 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-inner">
                <CheckCircle2 size={30} />
              </div>

              <h2 className="text-xl font-bold text-gray-900 mb-2">
                Link de Ativação Enviado!
              </h2>

              <p className="text-gray-600 text-xs leading-relaxed mb-4">
                Identificamos seu e-mail previamente homologado na Secretaria Geral e enviamos um link de uso único para você definir sua senha de acesso com total segurança:
              </p>

              {emailMascarado && (
                <div className="bg-gray-50 border border-gray-200 rounded-xl py-2.5 px-4 mb-6 inline-block">
                  <span className="font-mono text-sm font-bold text-[#0D2B4E]">
                    {emailMascarado}
                  </span>
                </div>
              )}

              <p className="text-[11px] text-gray-400 mb-6">
                O link expira em <strong>15 minutos</strong> e só pode ser utilizado uma vez. Acesse sua caixa de entrada para criar sua senha.
              </p>

              <button
                type="button"
                onClick={handleResetToInicio}
                className="w-full bg-[#0D2B4E] hover:bg-[#163f6d] text-white font-bold py-3.5 rounded-xl transition-all text-sm shadow-md"
              >
                Voltar para o Início
              </button>
            </div>
          )}

          {/* ── ETAPA 2B: Ministro sem E-mail Confiável (Exige Secretaria Geral) ── */}
          {stage === 'first_access_sem_email' && (
            <div className="text-center py-2">
              <div className="w-14 h-14 bg-amber-100 text-amber-800 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-inner">
                <PhoneCall size={28} />
              </div>

              <h2 className="text-lg font-bold text-gray-900 mb-2">
                Atualização na Secretaria Necessária
              </h2>

              <p className="text-gray-600 text-xs leading-relaxed mb-4">
                Por diretriz de integridade e segurança do <strong>Aplicativo do Ministro</strong>, a ativação exige um e-mail previamente homologado na convenção.
              </p>

              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-left text-xs text-amber-900 mb-6 space-y-2">
                <p className="font-semibold text-amber-950">Como proceder:</p>
                <p>1. Entre em contato com a <strong>Secretaria Geral da COMIEADEPA</strong>.</p>
                <p>2. Solicite a atualização e homologação oficial do seu endereço de e-mail institucional.</p>
                <p>3. Assim que homologado, retorne aqui para concluir seu primeiro acesso imediatamente.</p>
              </div>

              <button
                type="button"
                onClick={handleResetToInicio}
                className="w-full bg-[#0D2B4E] hover:bg-[#163f6d] text-white font-bold py-3.5 rounded-xl transition-all text-sm shadow-md"
              >
                Voltar ao Início
              </button>
            </div>
          )}

          {/* ── ETAPA 3: Login com Senha Existente ── */}
          {stage === 'password' && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <button
                  onClick={handleResetToInicio}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-[#0D2B4E] transition-colors"
                >
                  <ArrowLeft size={14} /> Voltar
                </button>
                <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-green-100 text-green-800 border border-green-200">
                  Ministro Cadastrado
                </span>
              </div>

              {/* Cartão de Boas-Vindas */}
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
                  {cpfMinistro && (
                    <p className="text-[11px] text-gray-400 font-mono mt-0.5">
                      CPF: {maskCpf(cpfMinistro)}
                    </p>
                  )}
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
                    'Entrar no Aplicativo'
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
                    setStage(nomeMinistro ? 'password' : 'identificacao');
                  }}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-[#0D2B4E] transition-colors"
                >
                  <ArrowLeft size={14} /> Voltar
                </button>
                <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-800 border border-blue-200">
                  Recuperação
                </span>
              </div>

              {/* Identificação do Ministro quando já temos */}
              {nomeMinistro && (
                <div className="bg-blue-50/80 border border-blue-100 rounded-2xl p-3.5 mb-5 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[#0D2B4E] text-white font-bold flex items-center justify-center text-base flex-shrink-0 shadow-sm">
                    {nomeMinistro.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-gray-500 font-medium leading-none">Ministro</p>
                    <p className="text-sm font-bold text-[#0D2B4E] truncate mt-1">
                      {nomeMinistro}
                    </p>
                    {cpfMinistro && (
                      <p className="text-[11px] text-gray-400 font-mono mt-0.5">
                        CPF: {maskCpf(cpfMinistro)}
                      </p>
                    )}
                  </div>
                </div>
              )}

              <div className="mb-5">
                <h2 className="text-xl font-bold text-gray-900 leading-tight">
                  Recuperar Senha
                </h2>
                <p className="text-gray-500 text-xs mt-1 leading-relaxed">
                  Enviaremos um link de recuperação exclusivo para o e-mail previamente homologado na convenção.
                </p>
              </div>

              <form onSubmit={handleForgotPassword} className="space-y-5">
                {!nomeMinistro && (
                  <div>
                    <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">
                      CPF ou E-mail
                    </label>
                    <input
                      type="text"
                      placeholder="000.000.000-00 ou seuemail@exemplo.com"
                      value={identificador}
                      onChange={(e) => setIdentificador(e.target.value)}
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
                Se os dados informados estiverem corretos, enviamos um link para redefinição de senha para o e-mail previamente cadastrado:
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
                onClick={handleResetToInicio}
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
