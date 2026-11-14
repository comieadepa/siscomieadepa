'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import {
  CheckCircle2,
  AlertCircle,
  ShieldCheck,
  ArrowRight,
} from 'lucide-react';

function ConfirmarEmailContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token') || '';

  const [verificando, setVerificando] = useState(true);
  const [sucesso, setSucesso] = useState(false);
  const [erro, setErro] = useState('');

  useEffect(() => {
    if (!token) {
      setVerificando(false);
      setErro('Nenhum link de confirmação informado. Por favor, utilize o link recebido em seu e-mail.');
      return;
    }

    async function validarConfirmacao() {
      try {
        const res = await fetch('/api/portal-ministro/auth/confirm-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });

        const data = await res.json();
        if (res.ok) {
          setSucesso(true);
        } else {
          setErro(data.error || 'Link de confirmação inválido ou expirado.');
        }
      } catch {
        setErro('Erro de conexão ao validar confirmação. Verifique sua internet e tente novamente.');
      } finally {
        setVerificando(false);
      }
    }

    validarConfirmacao();
  }, [token]);

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
            SISCOMIEADEPA · Ativação de Cadastro
          </p>
        </div>

        {/* Card Principal */}
        <div className="bg-white rounded-3xl shadow-2xl p-7 sm:p-8 border border-white/20 relative backdrop-blur-sm">

          {/* 1. Em Processamento */}
          {verificando && (
            <div className="text-center py-8">
              <div className="w-12 h-12 border-4 border-[#0D2B4E]/20 border-t-[#0D2B4E] rounded-full animate-spin mx-auto mb-4" />
              <p className="text-base font-bold text-gray-800">Validando seu e-mail...</p>
              <p className="text-xs text-gray-400 mt-1">Aguarde alguns instantes.</p>
            </div>
          )}

          {/* 2. Sucesso */}
          {!verificando && sucesso && (
            <div className="text-center py-4 space-y-4">
              <div className="w-16 h-16 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center mx-auto shadow-inner">
                <CheckCircle2 size={36} />
              </div>
              <div>
                <h3 className="text-xl font-bold text-gray-900">E-mail Confirmado!</h3>
                <p className="text-sm text-gray-600 mt-2 leading-relaxed">
                  Sua conta no <strong>Aplicativo do Ministro</strong> foi ativada com sucesso. Você já pode acessar usando seu e-mail e a senha cadastrada.
                </p>
              </div>

              <div className="pt-4">
                <Link
                  href="/portal-ministro/login?msg=email_confirmado"
                  className="w-full bg-[#0D2B4E] hover:bg-[#163f6d] text-white font-bold py-3.5 px-4 rounded-xl shadow-lg shadow-[#0D2B4E]/20 transition-all flex items-center justify-center gap-2 text-sm"
                >
                  <span>Ir para o Login</span>
                  <ArrowRight size={16} />
                </Link>
              </div>
            </div>
          )}

          {/* 3. Erro */}
          {!verificando && !sucesso && (
            <div className="text-center py-4 space-y-4">
              <div className="w-16 h-16 bg-red-50 text-red-600 rounded-full flex items-center justify-center mx-auto shadow-inner">
                <AlertCircle size={36} />
              </div>
              <div>
                <h3 className="text-xl font-bold text-gray-900">Não foi possível confirmar</h3>
                <p className="text-sm text-red-600 mt-2 leading-relaxed font-medium">
                  {erro}
                </p>
                <p className="text-xs text-gray-500 mt-2">
                  Se o link expirou, faça novamente o Primeiro Acesso para receber um novo link de confirmação.
                </p>
              </div>

              <div className="pt-4 space-y-2">
                <Link
                  href="/portal-ministro/login?modo=primeiro-acesso"
                  className="w-full bg-[#0D2B4E] hover:bg-[#163f6d] text-white font-bold py-3 px-4 rounded-xl transition-all block text-sm text-center"
                >
                  Novo Primeiro Acesso
                </Link>
                <Link
                  href="/portal-ministro/login"
                  className="w-full bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold py-2.5 px-4 rounded-xl transition-all block text-xs text-center"
                >
                  Voltar ao Login
                </Link>
              </div>
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

export default function ConfirmarEmailPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#0D2B4E] via-[#123b63] to-[#1a4a7a]">
          <div className="w-8 h-8 border-3 border-white/30 border-t-white rounded-full animate-spin" />
        </div>
      }
    >
      <ConfirmarEmailContent />
    </Suspense>
  );
}
