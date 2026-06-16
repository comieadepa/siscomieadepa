'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase-client';
import { clearEquipeSession, setEquipeSession } from '@/lib/equipe-session';
import type { EquipeSession } from '@/lib/equipe-session';

export default function OperadorLoginPage() {
  const params = useParams();
  const eventoId = params?.id as string;
  const router = useRouter();
  const supabase = createClient();

  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [nomeEvento, setNomeEvento] = useState('');

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
        body: JSON.stringify({ email: email.trim(), senha: senha.trim() }),
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
        tipo: 'operador',
        expiraEm,
      };
      setEquipeSession(sessao);

      const { error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password: senha.trim(),
      });

      if (authError) {
        clearEquipeSession();
        setErro('Não foi possível autenticar. Contate o administrador.');
        return;
      }

      router.replace(`/eventos/${eventoId}/balcao`);
    } catch {
      setErro('Erro ao acessar o evento.');
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div className="min-h-screen w-full flex flex-col md:flex-row bg-[#0a2040] text-white">
      {/* Lado Esquerdo - Área Institucional Lateral (Apenas Desktop) */}
      <div className="hidden md:flex md:w-1/2 bg-gradient-to-br from-[#0D2B4E] to-[#051120] flex-col justify-between p-12 relative overflow-hidden border-r border-white/10">
        {/* Detalhe de fundo */}
        <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-blue-900/30 via-transparent to-transparent pointer-events-none" />
        
        {/* Cabeçalho do lado esquerdo */}
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 bg-[#F39C12] rounded-lg flex items-center justify-center font-bold text-white shadow-lg text-lg">
            C
          </div>
          <div>
            <span className="font-extrabold text-sm uppercase tracking-wider block">COMIEADEPA</span>
            <span className="text-xs text-white/50 block">Painel Administrativo</span>
          </div>
        </div>

        {/* Centro do lado esquerdo */}
        <div className="my-auto max-w-lg space-y-6 relative z-10">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#F39C12]/15 text-[#F39C12] text-xs font-bold border border-[#F39C12]/20">
            🛡️ Ambiente Seguro
          </div>
          
          <h1 className="text-4xl font-black leading-tight bg-gradient-to-r from-white via-white to-gray-300 bg-clip-text text-transparent">
            {nomeEvento || 'Carregando evento...'}
          </h1>
          
          <p className="text-white/70 text-lg leading-relaxed font-light">
            Controle operacional de inscrições presenciais, caixa e atendimento integrado ao evento.
          </p>
        </div>

        {/* Rodapé do lado esquerdo */}
        <div className="text-xs text-white/40 font-medium">
          SISCOMIEADPA &bull; Sistema oficial de eventos
        </div>
      </div>

      {/* Lado Direito - Card Principal de Login */}
      <div className="flex-1 flex flex-col justify-center items-center p-6 sm:p-12 relative">
        <div className="w-full max-w-md bg-[#0D2B4E]/40 border border-white/10 p-8 sm:p-10 rounded-3xl shadow-2xl backdrop-blur-md">
          {/* Logo/Badge responsiva mobile */}
          <div className="md:hidden flex flex-col items-center mb-6">
            <div className="h-12 w-12 bg-[#F39C12] rounded-xl flex items-center justify-center font-bold text-white shadow-lg text-xl mb-3">
              C
            </div>
            <span className="text-xs text-white/40 uppercase tracking-widest font-semibold mb-2">COMIEADEPA</span>
            {nomeEvento && (
              <span className="text-sm font-bold text-center px-4 text-[#F39C12] bg-[#F39C12]/10 py-1 rounded-full border border-[#F39C12]/15">
                {nomeEvento}
              </span>
            )}
          </div>

          <div className="text-center md:text-left mb-8">
            <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">Portal do Operador</h2>
            <p className="text-white/60 text-xs sm:text-sm mt-2 font-medium">
              Acesso restrito à equipe credenciada do evento
            </p>
          </div>

          {/* Alerta de erro */}
          {erro && (
            <div className="mb-6 bg-red-500/20 border border-red-500/30 text-red-200 text-xs sm:text-sm rounded-xl px-4 py-3 font-semibold flex items-start gap-2.5 animate-pulse">
              <span className="text-base select-none">⚠️</span>
              <div className="flex-1">{erro}</div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-xs font-semibold text-white/70 mb-2 uppercase tracking-wider">
                E-mail
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="nome@email.com"
                className="w-full border border-white/10 rounded-xl px-4 py-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#F39C12] bg-[#1a3050]/55 text-white placeholder-white/30 transition-all"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-white/70 mb-2 uppercase tracking-wider">
                Senha
              </label>
              <input
                type="password"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                placeholder="••••••••"
                className="w-full border border-white/10 rounded-xl px-4 py-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#F39C12] bg-[#1a3050]/55 text-white placeholder-white/30 transition-all"
                required
              />
            </div>

            <button
              type="submit"
              disabled={carregando}
              className="w-full bg-[#F39C12] hover:bg-[#e08e0b] disabled:opacity-55 disabled:hover:bg-[#F39C12] text-slate-950 font-bold py-4 rounded-xl text-sm transition-all shadow-lg shadow-[#F39C12]/15 flex items-center justify-center gap-2.5"
            >
              {carregando ? (
                <>
                  <div className="w-4 h-4 border-2 border-slate-950/20 border-t-slate-950 rounded-full animate-spin" />
                  <span>Autenticando...</span>
                </>
              ) : (
                'Entrar no Balcão'
              )}
            </button>
          </form>
        </div>

        {/* Rodapé visível em mobile */}
        <div className="md:hidden mt-8 text-center text-xs text-white/30 font-medium">
          SISCOMIEADEPA &bull; Sistema oficial de eventos
        </div>
      </div>
    </div>
  );
}
