'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase-client';

type ConviteInfo = {
  email: string;
  eventoId: string;
  eventoNome: string;
  tipo: 'admin' | 'checkin';
};

export default function ConviteOperadorPage() {
  const router = useRouter();
  const search = useSearchParams();
  const token = decodeURIComponent(search?.get('token') || '');

  const [info, setInfo] = useState<ConviteInfo | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  const [senha, setSenha] = useState('');
  const [confirmarSenha, setConfirmarSenha] = useState('');
  const [enviando, setEnviando] = useState(false);

  // Carrega info do convite sem consumi-lo
  useEffect(() => {
    if (!token) {
      setErro('Token ausente.');
      setCarregando(false);
      return;
    }

    let cancelled = false;

    async function carregar() {
      try {
        const res = await fetch(`/api/eventos/equipe/convite-info?token=${encodeURIComponent(token)}`);
        const json = await res.json();
        if (!res.ok) {
          if (!cancelled) setErro(json.error || 'Convite inválido.');
          return;
        }
        if (json.tipo !== 'admin') {
          if (!cancelled) setErro('Este link é para Check-in. Use o link enviado por e-mail para check-in.');
          return;
        }
        if (!cancelled) setInfo(json as ConviteInfo);
      } catch {
        if (!cancelled) setErro('Erro ao carregar convite.');
      } finally {
        if (!cancelled) setCarregando(false);
      }
    }

    carregar();
    return () => { cancelled = true; };
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);

    if (senha.length < 8) {
      setErro('A senha deve ter no mínimo 8 caracteres.');
      return;
    }
    if (senha !== confirmarSenha) {
      setErro('As senhas não coincidem.');
      return;
    }

    setEnviando(true);
    try {
      // Confirma convite e cria/vincula usuário
      const res = await fetch('/api/eventos/equipe/confirmar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, senha }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErro(json.error || 'Erro ao confirmar acesso.');
        setEnviando(false);
        return;
      }

      // Faz login com a senha definida
      const supabase = createClient();
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: json.email,
        password: senha,
      });

      if (authError) {
        // Usuário existente que entrou com senha errada — já foi vinculado ao evento
        setErro('Senha incorreta para esta conta. Tente novamente com sua senha cadastrada.');
        setEnviando(false);
        return;
      }

      // Redireciona para a página do evento no painel
      router.replace(`/eventos/${json.eventoId}`);
    } catch {
      setErro('Erro inesperado. Tente novamente.');
      setEnviando(false);
    }
  }

  // Loading state
  if (carregando) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center px-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 max-w-md w-full text-center">
          <div className="text-3xl mb-3">🔐</div>
          <h1 className="text-lg font-bold text-[#123b63] mb-2">Acesso de Operador</h1>
          <p className="text-sm text-gray-500">Carregando convite... aguarde.</p>
        </div>
      </div>
    );
  }

  // Erro sem info (token inválido, etc.)
  if (!info) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center px-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 max-w-md w-full text-center">
          <div className="text-3xl mb-3">⛔</div>
          <h1 className="text-lg font-bold text-[#123b63] mb-2">Link inválido</h1>
          <p className="text-sm text-red-600">{erro}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4 py-8">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 max-w-md w-full">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="text-3xl mb-2">🔐</div>
          <h1 className="text-xl font-bold text-[#0D2B4E]">Criar acesso de Operador</h1>
          <p className="text-sm text-gray-500 mt-1">{info.eventoNome}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* E-mail (somente leitura) */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              E-mail
            </label>
            <input
              type="email"
              value={info.email}
              disabled
              className="w-full px-3 py-2 border border-gray-200 rounded-lg bg-gray-50 text-gray-500 text-sm cursor-not-allowed"
            />
          </div>

          {/* Nova senha */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Senha <span className="text-gray-400 font-normal">(mín. 8 caracteres)</span>
            </label>
            <input
              type="password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              placeholder="Digite uma senha"
              autoComplete="new-password"
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#0D2B4E]/30 focus:border-[#0D2B4E]"
            />
          </div>

          {/* Confirmar senha */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Confirmar senha
            </label>
            <input
              type="password"
              value={confirmarSenha}
              onChange={(e) => setConfirmarSenha(e.target.value)}
              placeholder="Confirme a senha"
              autoComplete="new-password"
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#0D2B4E]/30 focus:border-[#0D2B4E]"
            />
          </div>

          {/* Erro */}
          {erro && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {erro}
            </p>
          )}

          {/* Aviso usuário existente */}
          <p className="text-xs text-gray-400">
            Se você já tem conta no sistema, use sua senha cadastrada.
          </p>

          <button
            type="submit"
            disabled={enviando}
            className="w-full bg-[#0D2B4E] text-white py-2.5 px-4 rounded-lg font-semibold text-sm hover:bg-[#1a4a7a] transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {enviando ? 'Criando acesso...' : 'Criar acesso e entrar'}
          </button>
        </form>
      </div>
    </div>
  );
}
