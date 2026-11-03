'use client';

import { useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
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
  UserRound,
  ArrowRight,
  KeyRound,
  Smartphone,
  Layers,
  Lock,
} from 'lucide-react';
import './login.css';

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

function PortalMinistroLoginForm() {
  const searchParams = useSearchParams();
  const redirectParam = searchParams?.get('redirect');
  const targetDestination = redirectParam && redirectParam.startsWith('/') ? redirectParam : '/app';

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

      window.location.href = targetDestination;
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
    <div className="app-login-viewport font-sans selection:bg-amber-400 selection:text-blue-950">
      <div className="app-login-container">
        
        {/* Background oficial /img/login_app.png */}
        <div className="app-login-bg" aria-hidden="true" />

        {/* Área rolável com safe area e espaçamento dinâmico */}
        <div
          className="app-login-scroll"
          style={{
            paddingTop: 'calc(env(safe-area-inset-top, 0px) + 24px)',
            paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 24px)',
          }}
        >

          {/* ── 3. IDENTIDADE E LOGOMARCA ── */}
          <div className="flex flex-col items-center text-center w-full mb-6">
            {/* Escudo Oficial COMIEADEPA com efeito pulse suave e brilho discreto */}
            <div className="w-[84px] sm:w-[94px] h-auto flex items-center justify-center mb-3">
              <div className="app-logo-pulse">
                <Image
                  src="/img/logo_comieadepa.png"
                  alt="Escudo COMIEADEPA"
                  width={94}
                  height={108}
                  priority
                  className="object-contain w-full h-auto"
                />
              </div>
            </div>

            {/* Bloco de Título com Acento Dourado */}
            <div className="relative flex items-center justify-center">
              {/* Acento vertical dourado: largura 5px, altura 70px, raio 4px, cor #E5B84C */}
              <div
                className="w-[5px] h-[64px] sm:h-[70px] rounded-[4px] absolute -left-5 sm:-left-6 shadow-sm"
                style={{ backgroundColor: '#E5B84C' }}
                aria-hidden="true"
              />

              <div className="flex flex-col items-center">
                <span
                  className="text-white text-[27px] sm:text-[29px] font-[750] leading-[32px] sm:leading-[34px] tracking-tight drop-shadow-[0_2px_6px_rgba(0,20,50,0.25)]"
                >
                  Aplicativo do
                </span>
                <span
                  className="text-white text-[39px] sm:text-[43px] font-[850] leading-[42px] sm:leading-[46px] tracking-tight drop-shadow-[0_2px_8px_rgba(0,20,50,0.30)]"
                >
                  Ministro
                </span>
              </div>
            </div>

            {/* Subtítulo institucional */}
            <p className="text-[#E9F2FF] text-[11.5px] sm:text-[12.5px] font-[600] tracking-[1.5px] uppercase mt-2.5 drop-shadow-[0_1px_3px_rgba(0,0,0,0.4)]">
              COMIEADEPA • CONVENÇÃO ESTADUAL
            </p>
          </div>

          {/* ── 4. CARD DE LOGIN PRINCIPAL ── */}
          <div className="app-login-card p-[22px_18px_24px] sm:p-[24px_22px_26px] mb-6">

            {/* Faixa decorativa dourada inferior */}
            <div className="app-login-card-gold-bar" aria-hidden="true" />

            {/* ── ETAPA 1: Identificação (CPF ou E-mail) ── */}
            {stage === 'identificacao' && (
              <div className="flex flex-col items-center text-center">
                
                {/* 5. Selo de Acesso */}
                <div className="app-login-badge mb-5">
                  <Lock size={15} strokeWidth={2.5} className="text-[#142A45]" />
                  <span>Acesso Restrito ao Ministro</span>
                </div>

                {/* 6. Título e Instrução */}
                <h2 className="text-[20px] sm:text-[21px] font-[800] text-[#101828] leading-[26px] sm:leading-[27px]">
                  Identifique-se para entrar
                </h2>
                <p className="text-[12.5px] sm:text-[13px] text-[#4B5D73] leading-[18px] sm:leading-[19px] mt-2 mb-5">
                  Informe seu CPF ou E-mail cadastrado na convenção.
                </p>

                {/* 7. Formulário de Identificação */}
                <form onSubmit={handleCheckIdentificador} className="w-full text-left">
                  <div className="relative w-full">
                    <div className="absolute left-[16px] top-1/2 -translate-y-1/2 text-[#728198] pointer-events-none flex items-center">
                      <UserRound size={21} strokeWidth={2.2} />
                    </div>
                    <input
                      type="text"
                      autoComplete="username"
                      placeholder="CPF ou E-mail"
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
                      className="w-full h-[54px] sm:h-[56px] rounded-[14px] border-[1.5px] border-[#A7B8CE] bg-[rgba(255,255,255,0.88)] pl-[48px] pr-[14px] text-[16px] text-[#142A45] font-medium placeholder-[#728198] focus:outline-none focus:border-[#1473BD] focus:ring-[3px] focus:ring-[rgba(20,115,189,0.12)] transition-all"
                      required
                    />
                  </div>

                  {erro && (
                    <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-3.5 py-2.5 text-xs flex items-start gap-2 mt-3">
                      <AlertCircle size={15} className="text-red-600 flex-shrink-0 mt-0.5" />
                      <span className="leading-snug">{erro}</span>
                    </div>
                  )}

                  {/* 8. Botão Principal 'Entrar' / 'Continuar' */}
                  <button
                    type="submit"
                    disabled={loading}
                    className="app-login-btn-primary mt-[18px]"
                  >
                    {loading ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        <span>Consultando...</span>
                      </>
                    ) : (
                      <>
                        <span>Entrar</span>
                        <ArrowRight size={20} strokeWidth={2.4} />
                      </>
                    )}
                  </button>

                  {/* 9. Links Auxiliares */}
                  <div className="flex flex-col items-center mt-[18px] gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setErro('');
                        setStage('forgot_password');
                      }}
                      className="min-h-[44px] inline-flex items-center justify-center gap-1.5 text-[12.5px] sm:text-[13px] font-[650] text-[#07559C] hover:text-[#053866] hover:underline transition-colors"
                    >
                      <KeyRound size={16} strokeWidth={2.2} />
                      <span>Esqueceu seus dados de acesso?</span>
                    </button>
                  </div>
                </form>

              </div>
            )}

            {/* ── ETAPA 2: 1º Acesso - Confirmação de Titularidade (Registro) ── */}
            {stage === 'first_access_registro' && (
              <div className="flex flex-col text-left">
                <div className="flex items-center justify-between mb-3.5">
                  <button
                    onClick={handleResetToInicio}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-[#07376B] transition-colors min-h-[36px]"
                  >
                    <ArrowLeft size={14} /> Voltar
                  </button>
                  <span className="text-[10.5px] font-bold px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200">
                    Primeiro Acesso
                  </span>
                </div>

                <div className="bg-blue-50/90 border border-blue-100 rounded-xl p-3 mb-4 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-[#07376B] text-white font-bold flex items-center justify-center text-sm flex-shrink-0 shadow-sm">
                    {nomeMinistro ? nomeMinistro.charAt(0).toUpperCase() : <UserCheck size={16} />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] text-gray-500 font-medium leading-none">Ministro localizado</p>
                    <p className="text-xs font-bold text-[#07376B] truncate mt-1">
                      {nomeMinistro}
                    </p>
                    {cpfMinistro && (
                      <p className="text-[10.5px] text-gray-400 font-mono mt-0.5">
                        CPF: {maskCpf(cpfMinistro)}
                      </p>
                    )}
                  </div>
                </div>

                <h3 className="text-base font-bold text-gray-900 leading-snug">
                  Confirme sua Titularidade
                </h3>
                <p className="text-gray-500 text-xs mt-1 mb-4 leading-relaxed">
                  Digite seu <strong>Registro Convencional</strong> (ou Matrícula oficial) constante em sua credencial ministerial.
                </p>

                <form onSubmit={handleValidateRegistro} className="space-y-4">
                  <div className="relative">
                    <div className="absolute left-[14px] top-1/2 -translate-y-1/2 text-[#728198] pointer-events-none">
                      <FileBadge size={19} />
                    </div>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={registroConvencional}
                      onChange={(e) => setRegistroConvencional(e.target.value)}
                      autoFocus
                      placeholder="Ex: 3751"
                      className="w-full h-[52px] rounded-xl border border-gray-300 pl-11 pr-3 text-base text-gray-900 focus:outline-none focus:border-[#006DB5] focus:ring-2 focus:ring-blue-100 transition-all font-medium bg-white"
                      required
                    />
                  </div>

                  {erro && (
                    <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-2.5 text-xs flex items-start gap-2">
                      <AlertCircle size={15} className="text-red-600 flex-shrink-0 mt-0.5" />
                      <span>{erro}</span>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={loading}
                    className="app-login-btn-primary"
                  >
                    {loading ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        <span>Validando...</span>
                      </>
                    ) : (
                      <>
                        <span>Confirmar e Ativar</span>
                        <ArrowRight size={18} />
                      </>
                    )}
                  </button>
                </form>
              </div>
            )}

            {/* ── ETAPA 2A: Link Enviado com Sucesso ── */}
            {stage === 'first_access_sent' && (
              <div className="text-center py-2">
                <div className="w-12 h-12 bg-emerald-100 text-emerald-700 rounded-2xl flex items-center justify-center mx-auto mb-3 shadow-sm">
                  <CheckCircle2 size={26} />
                </div>

                <h3 className="text-base font-bold text-gray-900 mb-1.5">
                  Link de Ativação Enviado!
                </h3>

                <p className="text-gray-600 text-xs leading-relaxed mb-3">
                  Enviamos um link de uso único e temporário para seu e-mail previamente cadastrado:
                </p>

                {emailMascarado && (
                  <div className="bg-gray-50 border border-gray-200 rounded-lg py-1.5 px-3 mb-4 inline-block">
                    <span className="font-mono text-xs font-bold text-[#07376B]">
                      {emailMascarado}
                    </span>
                  </div>
                )}

                <p className="text-[11px] text-gray-400 mb-5">
                  O link expira em 15 minutos. Verifique sua caixa de entrada para criar sua senha.
                </p>

                <button
                  type="button"
                  onClick={handleResetToInicio}
                  className="app-login-btn-primary"
                >
                  Voltar ao Início
                </button>
              </div>
            )}

            {/* ── ETAPA 2B: Sem E-mail Homologado ── */}
            {stage === 'first_access_sem_email' && (
              <div className="text-center py-2">
                <div className="w-12 h-12 bg-amber-100 text-amber-800 rounded-2xl flex items-center justify-center mx-auto mb-3 shadow-sm">
                  <PhoneCall size={24} />
                </div>

                <h3 className="text-base font-bold text-gray-900 mb-1.5">
                  Atualização Necessária
                </h3>

                <p className="text-gray-600 text-xs leading-relaxed mb-3">
                  Para segurança do seu acesso, procure a Secretaria Geral da COMIEADEPA para cadastrar e homologar seu e-mail institucional.
                </p>

                <button
                  type="button"
                  onClick={handleResetToInicio}
                  className="app-login-btn-primary mt-2"
                >
                  Entendi, Voltar
                </button>
              </div>
            )}

            {/* ── ETAPA 3: Login com Senha ── */}
            {stage === 'password' && (
              <div className="flex flex-col text-left">
                <div className="flex items-center justify-between mb-3.5">
                  <button
                    onClick={handleResetToInicio}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-[#07376B] transition-colors min-h-[36px]"
                  >
                    <ArrowLeft size={14} /> Voltar
                  </button>
                  <span className="text-[10.5px] font-bold px-2.5 py-0.5 rounded-full bg-green-100 text-green-800 border border-green-200">
                    Ministro Cadastrado
                  </span>
                </div>

                <div className="bg-blue-50/90 border border-blue-100 rounded-xl p-3 mb-4 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-[#07376B] text-white font-bold flex items-center justify-center text-sm flex-shrink-0 shadow-sm">
                    {nomeMinistro ? nomeMinistro.charAt(0).toUpperCase() : <UserCheck size={16} />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] text-gray-500 font-medium leading-none">Bem-vindo(a)</p>
                    <p className="text-xs font-bold text-[#07376B] truncate mt-1">
                      {nomeMinistro || 'Ministro'}
                    </p>
                    {cpfMinistro && (
                      <p className="text-[10.5px] text-gray-400 font-mono mt-0.5">
                        CPF: {maskCpf(cpfMinistro)}
                      </p>
                    )}
                  </div>
                </div>

                <h3 className="text-base font-bold text-gray-900 leading-snug">
                  Digite sua senha
                </h3>
                <p className="text-gray-500 text-xs mt-1 mb-4">
                  Insira sua senha de acesso para continuar.
                </p>

                <form onSubmit={handleLoginPassword} className="space-y-4">
                  <div>
                    <div className="relative">
                      <input
                        type={showSenha ? 'text' : 'password'}
                        value={senha}
                        onChange={(e) => setSenha(e.target.value)}
                        autoFocus
                        placeholder="Sua senha de acesso"
                        className="w-full h-[52px] rounded-xl border border-gray-300 px-4 pr-11 text-base text-gray-900 focus:outline-none focus:border-[#006DB5] focus:ring-2 focus:ring-blue-100 transition-all font-medium bg-white"
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowSenha(!showSenha)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-2 min-h-[44px] min-w-[44px] flex items-center justify-center"
                        aria-label={showSenha ? 'Ocultar senha' : 'Ver senha'}
                      >
                        {showSenha ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </div>

                    <div className="flex justify-end mt-2">
                      <button
                        type="button"
                        onClick={() => {
                          setErro('');
                          setStage('forgot_password');
                        }}
                        className="text-xs font-semibold text-[#07559C] hover:underline min-h-[36px] flex items-center"
                      >
                        Esqueceu sua senha?
                      </button>
                    </div>
                  </div>

                  {erro && (
                    <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-2.5 text-xs flex items-start gap-2">
                      <AlertCircle size={15} className="text-red-600 flex-shrink-0 mt-0.5" />
                      <span>{erro}</span>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={loading}
                    className="app-login-btn-primary"
                  >
                    {loading ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        <span>Entrando...</span>
                      </>
                    ) : (
                      <>
                        <span>Entrar no Aplicativo</span>
                        <ArrowRight size={18} />
                      </>
                    )}
                  </button>
                </form>
              </div>
            )}

            {/* ── ETAPA 4: Recuperação de Senha ── */}
            {stage === 'forgot_password' && (
              <div className="flex flex-col text-left">
                <div className="flex items-center justify-between mb-3.5">
                  <button
                    onClick={() => {
                      setErro('');
                      setStage(nomeMinistro ? 'password' : 'identificacao');
                    }}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-[#07376B] transition-colors min-h-[36px]"
                  >
                    <ArrowLeft size={14} /> Voltar
                  </button>
                  <span className="text-[10.5px] font-bold px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-800 border border-blue-200">
                    Recuperação
                  </span>
                </div>

                <h3 className="text-base font-bold text-gray-900 leading-snug">
                  Recuperar Senha
                </h3>
                <p className="text-gray-500 text-xs mt-1 mb-4 leading-relaxed">
                  Enviaremos instruções seguras para redefinição de senha ao seu e-mail cadastrado.
                </p>

                <form onSubmit={handleForgotPassword} className="space-y-4">
                  {!nomeMinistro && (
                    <div className="relative">
                      <div className="absolute left-[14px] top-1/2 -translate-y-1/2 text-[#728198] pointer-events-none">
                        <UserRound size={19} />
                      </div>
                      <input
                        type="text"
                        placeholder="CPF ou E-mail cadastrado"
                        value={identificador}
                        onChange={(e) => setIdentificador(e.target.value)}
                        autoFocus
                        className="w-full h-[52px] rounded-xl border border-gray-300 pl-11 pr-3 text-base text-gray-900 focus:outline-none focus:border-[#006DB5] focus:ring-2 focus:ring-blue-100 transition-all font-medium bg-white"
                        required
                      />
                    </div>
                  )}

                  {erro && (
                    <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-2.5 text-xs flex items-start gap-2">
                      <AlertCircle size={15} className="text-red-600 flex-shrink-0 mt-0.5" />
                      <span>{erro}</span>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={loading}
                    className="app-login-btn-primary"
                  >
                    {loading ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        <span>Enviando link...</span>
                      </>
                    ) : (
                      <>
                        <span>Enviar Link de Recuperação</span>
                        <ArrowRight size={18} />
                      </>
                    )}
                  </button>
                </form>
              </div>
            )}

            {/* ── ETAPA 5: Instruções de Recuperação Enviadas ── */}
            {stage === 'forgot_sent' && (
              <div className="text-center py-2">
                <div className="w-12 h-12 bg-blue-100 text-blue-700 rounded-2xl flex items-center justify-center mx-auto mb-3 shadow-sm">
                  <Mail size={24} />
                </div>

                <h3 className="text-base font-bold text-gray-900 mb-1.5">
                  Instruções Enviadas!
                </h3>

                <p className="text-gray-600 text-xs leading-relaxed mb-3">
                  Se os dados estiverem cadastrados, você receberá um link seguro de redefinição:
                </p>

                {emailMascarado && (
                  <div className="bg-gray-50 border border-gray-200 rounded-lg py-1.5 px-3 mb-4 inline-block">
                    <span className="font-mono text-xs font-bold text-[#07376B]">
                      {emailMascarado}
                    </span>
                  </div>
                )}

                <p className="text-[11px] text-gray-400 mb-5">
                  Válido por 15 minutos. Verifique sua caixa de entrada e pasta de spam.
                </p>

                <button
                  type="button"
                  onClick={handleResetToInicio}
                  className="app-login-btn-primary"
                >
                  Voltar ao Início
                </button>
              </div>
            )}

          </div>

          {/* ── 10. BENEFÍCIOS INSTITUCIONAIS (3 Colunas) ── */}
          <div className="w-full max-w-[354px] px-[20px] mt-2 mb-4">
            <div className="grid grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-[12px] text-center">
              
              {/* Coluna 1: Acesso Seguro */}
              <div className="flex flex-col items-center justify-center min-w-0">
                <ShieldCheck size={28} strokeWidth={2.2} className="text-[#F0C35E] drop-shadow-sm flex-shrink-0" />
                <div className="mt-[10px] text-[12px] font-[500] leading-[16px] text-white drop-shadow-sm text-center">
                  <span className="block truncate">Acesso</span>
                  <span className="block truncate">Seguro</span>
                </div>
              </div>

              {/* Separador vertical 1 (altura 42px) */}
              <div className="w-[1px] h-[42px] bg-white/25 flex-shrink-0" aria-hidden="true" />

              {/* Coluna 2: Experiência em App */}
              <div className="flex flex-col items-center justify-center min-w-0">
                <Smartphone size={28} strokeWidth={2.2} className="text-[#F0C35E] drop-shadow-sm flex-shrink-0" />
                <div className="mt-[10px] text-[12px] font-[500] leading-[16px] text-white drop-shadow-sm text-center">
                  <span className="block truncate">Experiência</span>
                  <span className="block truncate">em App</span>
                </div>
              </div>

              {/* Separador vertical 2 (altura 42px) */}
              <div className="w-[1px] h-[42px] bg-white/25 flex-shrink-0" aria-hidden="true" />

              {/* Coluna 3: Serviços Ministeriais */}
              <div className="flex flex-col items-center justify-center min-w-0">
                <Layers size={28} strokeWidth={2.2} className="text-[#F0C35E] drop-shadow-sm flex-shrink-0" />
                <div className="mt-[10px] text-[12px] font-[500] leading-[16px] text-white drop-shadow-sm text-center">
                  <span className="block truncate">Serviços</span>
                  <span className="block truncate">Ministeriais</span>
                </div>
              </div>

            </div>
          </div>

          {/* ── 11. RODAPÉ INSTITUCIONAL ── */}
          {/* Deslocado para a região azul-escura com distância visual >= 35px da faixa luminosa (+8px adicionais) */}
          <footer
            className="text-center w-full mt-[48px]"
            style={{
              paddingBottom: 'max(20px, env(safe-area-inset-bottom, 0px))',
            }}
          >
            <p className="text-[#EAF2FF] text-[11px] font-normal leading-[16px] tracking-wide drop-shadow-sm">
              COMIEADEPA &copy; {new Date().getFullYear()} • Todos os direitos reservados
            </p>
          </footer>

        </div>

      </div>
    </div>
  );
}

export default function PortalMinistroLoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-[#051A33]">
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-amber-400/20 border-t-amber-400 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-white/70 text-xs font-semibold tracking-wide">Iniciando Aplicativo...</p>
        </div>
      </div>
    }>
      <PortalMinistroLoginForm />
    </Suspense>
  );
}
