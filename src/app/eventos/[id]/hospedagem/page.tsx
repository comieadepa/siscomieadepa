'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase-client';
import { setEquipeSession } from '@/lib/equipe-session';
import { getDefaultEventoPath } from '@/lib/eventos/evento-permissions';
import type { EquipeSession } from '@/lib/equipe-session';

export default function HospedagemLoginPage() {
  const params = useParams();
  const eventoId = params?.id as string;
  const router = useRouter();
  const supabase = createClient();

  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    if (!email.trim() || !senha.trim()) {
      setErro('Informe e-mail e senha.');
      return;
    }

    setCarregando(true);
    try {
      const res = await fetch(`/api/eventos/${eventoId}/equipe/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), senha: senha.trim(), funcao: 'hospedagem' }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErro(json.error || 'Erro ao validar acesso.');
        return;
      }

      const expiraEm = json.expira_em || new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
      const sessao: EquipeSession = {
        eventoId,
        equipeId: json.equipe_id,
        tipo: 'hospedagem',
        expiraEm,
      };

      const { error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password: senha.trim(),
      });
      if (authError) {
        setErro('Nao foi possivel autenticar. Contate o administrador.');
        return;
      }

      setEquipeSession(sessao);
      router.replace(getDefaultEventoPath(eventoId, 'hospedagem'));
    } catch {
      setErro('Erro ao acessar a área de hospedagem.');
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 max-w-md w-full">
        <div className="text-center mb-6">
          <h1 className="text-xl font-bold text-[#0D2B4E]">Acesso da Hospedagem</h1>
          <p className="text-sm text-gray-500 mt-1">Entre com e-mail e senha da equipe do evento.</p>
        </div>

        {erro && (
          <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {erro}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">E-mail</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#0D2B4E]/30 focus:border-[#0D2B4E]"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Senha</label>
            <input
              type="password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#0D2B4E]/30 focus:border-[#0D2B4E]"
              required
            />
          </div>
          <button
            type="submit"
            disabled={carregando}
            className="w-full bg-[#123b63] text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-[#0f2a45] transition disabled:opacity-50"
          >
            {carregando ? 'Entrando...' : 'Acessar hospedagem'}
          </button>
        </form>
      </div>
    </div>
  );
}
