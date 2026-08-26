'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import {
  Eye,
  EyeOff,
  Check,
  AlertCircle,
  ShieldCheck,
  ArrowRight,
  CheckCircle2,
} from 'lucide-react';

function RedefinirSenhaContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token') || '';

  const [verificando, setVerificando] = useState(true);
  const [tokenValido, setTokenValido] = useState(false);
  const [nomeMinistro, setNomeMinistro] = useState('');
  const [tokenErro, setTokenErro] = useState('');

  const [senha, setSenha] = useState('');
  const [senhaConfirm, setSenhaConfirm] = useState('');
  const [showSenha, setShowSenha] = useState(false);
  const [showSenhaConfirm, setShowSenhaConfirm] = useState(false);
  const [submetendo, setSubmetendo] = useState(false);
  const [formErro, setFormErro] = useState('');
  const [sucesso, setSucesso] = useState(false);

  // Validação em tempo real
  const hasMinLen = senha.length >= 6;
  const hasLetter = /[a-zA-Z]/.test(senha);
  const hasNumber = /[0-9]/.test(senha);
  const isSenhaValid = hasMinLen && hasLetter && hasNumber;
  const senhasCoincidem = senha.length > 0 && senhaConfirm.length > 0 && senha === senhaConfirm;

  useEffect(() => {
    if (!token) {
      setVerificando(false);
      setTokenValido(false);
      setTokenErro('Nenhum link de recuperação informado. Por favor, solicite a redefinição pelo portal.');
      return;
    }

    async function verificarToken() {
      try {
        const res = await fetch(`/api/portal-ministro/auth/verify-reset-token?token=${encodeURIComponent(token)}`);
        const data = await res.json();

        if (res.ok && data.valid) {
          setTokenValido(true);
          setNomeMinistro(data.nomeMinistro || '');
        } else {
          setTokenValido(false);
          setTokenErro(data.error || 'Link de recuperação inválido ou expirado.');
        }
      } catch {
        setTokenValido(false);
        setTokenErro('Erro ao verificar link de recuperação. Verifique sua conexão.');
      } finally {
        setVerificando(false);
      }
    }

    verificarToken();
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormErro('');

    if (!isSenhaValid) {
      setFormErro('A senha deve atender a todos os requisitos de segurança.');
      return;
    }

    if (!senhasCoincidem) {
      setFormErro('As senhas digitadas não coincidem.');
      return;
    }

    setSubmetendo(true);
    try {
      const res = await fetch('/api/portal-ministro/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          senha,
          senhaConfirm,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setFormErro(data.error || 'Erro ao redefinir senha.');
        setSubmetendo(false);
        return;
      }

      setSucesso(true);
    } catch {
      setFormErro('Erro de conexão ao salvar nova senha. Tente novamente.');
      setSubmetendo(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#0D2B4E] via-[#123b63] to-[#1a4a7a] px-4 py-8">
      <div className="w-full max-w-md">
        
        {/* Logo */}
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
            SISCOMIEADEPA · Recuperação de Acesso
          </p>
        </div>

        {/* Card Principal */}
        <div className="bg-white rounded-3xl shadow-2xl p-7 sm:p-8 border border-white/20 relative backdrop-blur-sm">

          {/* 1. Verificando Token */}
          {verificando && (
            <div className="text-center py-8">
              <div className="w-10 h-10 border-3 border-[#0D2B4E]/30 border-t-[#0D2B4E] rounded-full animate-spin mx-auto mb-4" />
              <p className="text-sm font-semibold text-gray-700">Validando link de recuperação...</p>
              <p className="text-xs text-gray-400 mt-1">Aguarde alguns segundos.</p>
            </div>
          )}

          {/* 2. Token Inválido ou Expirado */}
          {!verificando && !tokenValido && (
            <div className="text-center py-4">
              <div className="w-14 h-14 bg-red-100 text-red-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <AlertCircle size={28} />
              </div>
              <h2 className="text-lg font-bold text-gray-900 mb-2">Link Indisponível</h2>
              <p className="text-xs text-gray-600 mb-6 leading-relaxed">
                {tokenErro || 'Este link de recuperação é inválido, expirou ou já foi utilizado.'}
              </p>
              <Link
                href="/portal-ministro/login"
                className="w-full inline-flex items-center justify-center gap-2 bg-[#0D2B4E] hover:bg-[#163f6d] text-white font-bold py-3.5 rounded-xl transition-colors text-sm shadow-md"
              >
                Voltar ao Login / Solicitar Novo Link
              </Link>
            </div>
          )}

          {/* 3. Sucesso na Redefinição */}
          {!verificando && tokenValido && sucesso && (
            <div className="text-center py-4 animate-fadeIn">
              <div className="w-14 h-14 bg-green-100 text-green-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 size={32} />
              </div>
              <h2 className="text-xl font-bold text-gray-900 mb-1">Senha Atualizada!</h2>
              <p className="text-xs text-gray-600 mb-6 leading-relaxed">
                Sua nova senha de acesso foi cadastrada com sucesso. Você já pode fazer login no portal.
              </p>
              <Link
                href="/portal-ministro/login"
                className="w-full inline-flex items-center justify-center gap-2 bg-[#0D2B4E] hover:bg-[#163f6d] text-white font-bold py-3.5 rounded-xl transition-all text-sm shadow-lg shadow-[#0D2B4E]/20"
              >
                <span>Acessar o Portal</span>
                <ArrowRight size={16} />
              </Link>
            </div>
          )}

          {/* 4. Formulário de Nova Senha */}
          {!verificando && tokenValido && !sucesso && (
            <div>
              <div className="mb-4">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 text-[#0D2B4E] text-xs font-semibold mb-3 border border-blue-100">
                  <ShieldCheck size={14} className="text-[#0D2B4E]" />
                  Link Validado com Sucesso
                </div>
                
                {nomeMinistro && (
                  <div className="bg-blue-50/80 border border-blue-100 rounded-2xl p-3.5 mb-4 flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-[#0D2B4E] text-white font-bold flex items-center justify-center text-base flex-shrink-0">
                      {nomeMinistro.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-gray-500 font-medium leading-none">Redefinindo acesso para</p>
                      <p className="text-sm font-bold text-[#0D2B4E] truncate mt-1">
                        {nomeMinistro}
                      </p>
                    </div>
                  </div>
                )}

                <h2 className="text-lg font-bold text-gray-900 leading-tight">
                  Cadastrar Nova Senha
                </h2>
                <p className="text-gray-500 text-xs mt-1">
                  Crie uma senha segura para o seu acesso convencional.
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">
                    Nova Senha
                  </label>
                  <div className="relative">
                    <input
                      type={showSenha ? 'text' : 'password'}
                      value={senha}
                      onChange={(e) => setSenha(e.target.value)}
                      placeholder="Digite sua nova senha"
                      autoFocus
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

                {formErro && (
                  <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-xs flex items-start gap-2">
                    <AlertCircle size={16} className="text-red-600 flex-shrink-0 mt-0.5" />
                    <span>{formErro}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={submetendo}
                  className="w-full bg-[#0D2B4E] hover:bg-[#163f6d] text-white font-bold py-3.5 rounded-xl shadow-lg shadow-[#0D2B4E]/20 transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-sm tracking-wide mt-2"
                >
                  {submetendo ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      <span>Salvando nova senha...</span>
                    </>
                  ) : (
                    'Salvar Nova Senha'
                  )}
                </button>
              </form>
            </div>
          )}

          {/* Rodapé Interno */}
          <div className="mt-6 pt-4 border-t border-gray-100 text-center">
            <Link
              href="/portal-ministro/login"
              className="text-xs text-[#0D2B4E] hover:text-[#163f6d] font-semibold hover:underline"
            >
              ← Voltar para a tela de Login
            </Link>
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

export default function RedefinirSenhaPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#0D2B4E] via-[#123b63] to-[#1a4a7a]">
          <div className="w-8 h-8 border-3 border-white/30 border-t-white rounded-full animate-spin" />
        </div>
      }
    >
      <RedefinirSenhaContent />
    </Suspense>
  );
}
