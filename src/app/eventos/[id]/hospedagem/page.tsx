'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase-client';
import { clearEquipeSession, getEquipeSession, setEquipeSession } from '@/lib/equipe-session';
import { getDefaultEventoPath } from '@/lib/eventos/evento-permissions';
import type { EquipeSession } from '@/lib/equipe-session';

/**
 * Gate de acesso para o app de Hospedagem (Admin).
 * Exige E-mail e Senha para operar a área de hospedagem.
 * Autentica no Supabase para prover acesso administrativo.
 */
export default function HospedagemLoginPage() {
  const params = useParams();
  const eventoId = params?.id as string;
  const router = useRouter();
  const supabase = createClient();

  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [verificandoSessao, setVerificandoSessao] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [nomeEvento, setNomeEvento] = useState('');

  // Busca o nome do evento ao carregar a página
  useEffect(() => {
    if (!eventoId) return;
    async function obterEvento() {
      const { data } = await supabase
        .from('eventos')
        .select('nome')
        .eq('id', eventoId)
        .single();
      if (data) setNomeEvento(data.nome);
    }
    obterEvento();
  }, [eventoId, supabase]);

  // Se já houver sessão ativa válida para a hospedagem admin, redireciona direto para o painel
  useEffect(() => {
    if (!eventoId) { setVerificandoSessao(false); return; }
    const sess = getEquipeSession();
    if (
      sess &&
      sess.eventoId === eventoId &&
      sess.tipo === 'hospedagem'
    ) {
      router.replace(getDefaultEventoPath(eventoId, 'hospedagem'));
    } else {
      setVerificandoSessao(false);
    }
  }, [eventoId, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    const emailTrimmed = email.trim().toLowerCase();
    const senhaTrimmed = senha.trim();

    if (!emailTrimmed || !senhaTrimmed) {
      setErro('Informe o e-mail e a senha cadastrados na equipe.');
      return;
    }

    setCarregando(true);
    try {
      // 1. Validação no endpoint de equipe
      const res = await fetch(`/api/eventos/${eventoId}/equipe/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailTrimmed, senha: senhaTrimmed, funcao: 'hospedagem' }),
      });
      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        setErro(json.error || 'Acesso não autorizado para esta função de hospedagem.');
        return;
      }

      // 2. Autenticação no Supabase (necessário para persistência e permissão RLS)
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: emailTrimmed,
        password: senhaTrimmed,
      });

      if (authError) {
        setErro('Credenciais incorretas ou operador não cadastrado no Supabase.');
        return;
      }

      // 3. Salvar sessão de equipe e redirecionar
      const expiraEm = json.expira_em || new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
      const sessao: EquipeSession = {
        eventoId,
        equipeId: json.equipe_id,
        tipo: 'hospedagem',
        expiraEm,
        email: emailTrimmed,
        nome: json.nome ?? undefined,
      };
      setEquipeSession(sessao);

      router.replace(getDefaultEventoPath(eventoId, 'hospedagem'));
    } catch {
      setErro('Erro ao processar login. Tente novamente.');
    } finally {
      setCarregando(false);
    }
  }

  if (verificandoSessao) {
    return (
      <div className="min-h-screen bg-[#0D2B4E] flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-white border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0D2B4E] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
        {/* Cabeçalho */}
        <div className="bg-[#0D2B4E] px-6 py-5 text-center">
          <div className="text-4xl mb-2">🏠</div>
          <h1 className="text-white font-black text-xl tracking-tight">Hospedagem (Admin)</h1>
          {nomeEvento && <p className="text-white/70 text-xs mt-1 uppercase tracking-wider font-semibold">{nomeEvento}</p>}
        </div>

        {/* Formulário */}
        <div className="px-6 py-6">
          <p className="text-sm text-gray-600 text-center mb-5">
            Entre com e-mail e senha da equipe para gerenciar a área de hospedagem.
          </p>

          {erro && (
            <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3 font-medium">
              {erro}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email-hospedagem-admin" className="block text-sm font-semibold text-gray-700 mb-1">
                E-mail
              </label>
              <input
                id="email-hospedagem-admin"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="seu-email@exemplo.com"
                autoComplete="email"
                className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#0D2B4E]/40 focus:border-[#0D2B4E]"
                required
              />
            </div>

            <div>
              <label htmlFor="senha-hospedagem-admin" className="block text-sm font-semibold text-gray-700 mb-1">
                Senha
              </label>
              <input
                id="senha-hospedagem-admin"
                type="password"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#0D2B4E]/40 focus:border-[#0D2B4E]"
                required
              />
            </div>

            <button
              type="submit"
              disabled={carregando}
              className="w-full bg-[#0D2B4E] text-white px-4 py-3.5 rounded-xl text-sm font-bold hover:bg-[#0a1e38] transition disabled:opacity-50 tracking-wide"
            >
              {carregando ? 'Autenticando...' : '🔐 Acessar Painel de Hospedagem'}
            </button>
          </form>

          <button
            type="button"
            onClick={() => { clearEquipeSession(); router.push('/eventos'); }}
            className="w-full mt-3 text-sm text-gray-400 hover:text-gray-600 py-2 transition"
          >
            ← Voltar
          </button>
        </div>

        <div className="px-6 pb-5 text-center">
          <p className="text-xs text-gray-400">
            Acesso exclusivo para administradores e operadores da área de hospedagem do evento.
          </p>
        </div>
      </div>
    </div>
  );
}
