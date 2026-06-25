'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { clearEquipeSession, getEquipeSession, setEquipeSession } from '@/lib/equipe-session';
import type { EquipeSession } from '@/lib/equipe-session';

/**
 * Gate de acesso para o app de Hospedagem.
 * Exige apenas o e-mail cadastrado na equipe — sem senha.
 * Se já houver sessão de equipe válida (hospedagem), redireciona para /hospedagem/checkin.
 */
export default function HospedagemLoginPage() {
  const params = useParams();
  const eventoId = params?.id as string;
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [verificandoSessao, setVerificandoSessao] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  // Verifica se já existe sessão válida e redireciona
  useEffect(() => {
    if (!eventoId) { setVerificandoSessao(false); return; }
    const sess = getEquipeSession();
    if (
      sess &&
      sess.eventoId === eventoId &&
      (sess.tipo === 'hospedagem' || sess.tipo === 'checkin_hospedagem' || sess.tipo === 'operador')
    ) {
      router.replace(`/eventos/${eventoId}/hospedagem/checkin`);
    } else {
      setVerificandoSessao(false);
    }
  }, [eventoId, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    const emailTrimmed = email.trim().toLowerCase();
    if (!emailTrimmed) {
      setErro('Informe o e-mail cadastrado na equipe do evento.');
      return;
    }
    if (!/\S+@\S+\.\S+/.test(emailTrimmed)) {
      setErro('E-mail inválido.');
      return;
    }

    setCarregando(true);
    try {
      const res = await fetch(`/api/eventos/${eventoId}/equipe/acesso-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailTrimmed, funcao: 'hospedagem' }),
      });
      const json = await res.json();

      if (!res.ok) {
        setErro(json.error || 'E-mail não autorizado para este evento.');
        return;
      }

      const sessao: EquipeSession = {
        eventoId,
        equipeId: json.equipe_id,
        tipo: (json.tipo as EquipeSession['tipo']) ?? 'hospedagem',
        expiraEm: json.expira_em || new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
        email: emailTrimmed,
        nome: json.nome ?? undefined,
      };
      setEquipeSession(sessao);
      router.replace(`/eventos/${eventoId}/hospedagem/checkin`);
    } catch {
      setErro('Erro ao validar acesso. Tente novamente.');
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
          <h1 className="text-white font-black text-xl tracking-tight">Hospedagem</h1>
          <p className="text-white/60 text-sm mt-1">App de Check-in de Hospedagem</p>
        </div>

        {/* Formulário */}
        <div className="px-6 py-6">
          <p className="text-sm text-gray-600 text-center mb-5">
            Informe o e-mail cadastrado na equipe do evento para acessar.
          </p>

          {erro && (
            <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3 font-medium">
              {erro}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email-hospedagem" className="block text-sm font-semibold text-gray-700 mb-1">
                E-mail da equipe
              </label>
              <input
                id="email-hospedagem"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="seu-email@exemplo.com"
                autoComplete="email"
                autoFocus
                className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#0D2B4E]/40 focus:border-[#0D2B4E]"
                required
              />
            </div>

            <button
              type="submit"
              disabled={carregando}
              className="w-full bg-[#0D2B4E] text-white px-4 py-3.5 rounded-xl text-sm font-bold hover:bg-[#0a1e38] transition disabled:opacity-50 tracking-wide"
            >
              {carregando ? 'Validando...' : '🔐 Acessar App de Hospedagem'}
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
            O link por si só não libera o acesso. É necessário confirmar o e-mail cadastrado.
          </p>
        </div>
      </div>
    </div>
  );
}
