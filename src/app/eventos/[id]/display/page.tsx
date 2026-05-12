'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase-client';
import { useRequireSupabaseAuth } from '@/hooks/useRequireSupabaseAuth';
import { useEventosPerfil } from '@/hooks/useEventosPerfil';

// ─── Tipos ───────────────────────────────────────────────────
interface Evento {
  id: string; nome: string; departamento: string;
  data_inicio: string; data_fim: string;
  local: string | null; cidade: string | null;
  banner_url: string | null;
  publico_alvo: string | null;
  limite_vagas: number | null;
  status: string;
}

interface Inscricao {
  id: string;
  nome_inscrito: string;
  supervisao_id: string | null;
  campo_id: string | null;
  checkin_realizado: boolean;
  checkin_at: string | null;
  status_pagamento: string;
  publico_alvo_custom?: string | null; // campo futuro
}

interface Supervisao { id: string; nome: string; }

// ─── Helpers ─────────────────────────────────────────────────
const fmtData = (d: string | null) => {
  if (!d) return '';
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y}`;
};

const fmtHora = (d: string | null) => {
  if (!d) return '';
  return new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
};

const DEPTO_COLORS: Record<string, string> = {
  AGO:      '#0D2B4E',
  UMADESPA: '#7D6608',
  COADESPA: '#1A5632',
  SEIADEPA: '#6C1B3C',
  AVULSO:   '#2C3E50',
};

function getBgColor(depto: string): string {
  for (const key of Object.keys(DEPTO_COLORS)) {
    if (depto.toUpperCase().includes(key)) return DEPTO_COLORS[key];
  }
  return DEPTO_COLORS.AVULSO;
}

// ─── Componente principal ─────────────────────────────────────
export default function DisplayPage() {
  const { loading: authLoading } = useRequireSupabaseAuth();
  const perfil  = useEventosPerfil();
  const router  = useRouter();
  const params  = useParams();
  const id      = params?.id as string;
  const supabase = useMemo(() => createClient(), []);

  const [evento,      setEvento]      = useState<Evento | null>(null);
  const [inscricoes,  setInscricoes]  = useState<Inscricao[]>([]);
  const [supervisoes, setSupervisoes] = useState<Supervisao[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [acesso,      setAcesso]      = useState<'ok' | 'negado' | 'carregando'>('carregando');
  const [agora,       setAgora]       = useState(new Date());
  const [ultimaAtu,   setUltimaAtu]   = useState<Date | null>(null);
  const [realtimeOn,  setRealtimeOn]  = useState(false);

  // ── Clock ────────────────────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => setAgora(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // ── Carrega dados base ───────────────────────────────────
  const fetchTudo = useCallback(async () => {
    if (!id) return;
    const [evRes, inRes, supRes] = await Promise.all([
      supabase.from('eventos').select('id,nome,departamento,data_inicio,data_fim,local,cidade,banner_url,publico_alvo,limite_vagas,status').eq('id', id).single(),
      supabase.from('evento_inscricoes').select('id,nome_inscrito,supervisao_id,campo_id,checkin_realizado,checkin_at,status_pagamento').eq('evento_id', id).order('checkin_at', { ascending: false, nullsFirst: false }),
      supabase.from('supervisoes').select('id,nome').order('nome'),
    ]);
    if (evRes.data)  setEvento(evRes.data as Evento);
    if (inRes.data)  setInscricoes(inRes.data as Inscricao[]);
    if (supRes.data) setSupervisoes(supRes.data as Supervisao[]);
    setUltimaAtu(new Date());
    setLoading(false);
  }, [id, supabase]);

  // ── Validação de acesso ──────────────────────────────────
  useEffect(() => {
    if (authLoading || perfil.loading) return;
    if (perfil.isGlobal) { setAcesso('ok'); fetchTudo(); return; }
    if (id && perfil.podeAcessarEvento(id)) {
      const perm = perfil.permissaoParaEvento(id);
      if (perm === 'checkin') {
        setAcesso('negado');
        setLoading(false);
        return;
      }
      setAcesso('ok');
      fetchTudo();
      return;
    }
    setAcesso('negado');
    setLoading(false);
  }, [authLoading, perfil.loading, perfil.isGlobal, id, fetchTudo, perfil]);

  // ── Supabase Realtime ────────────────────────────────────
  useEffect(() => {
    if (acesso !== 'ok' || !id) return;

    const channel = supabase
      .channel(`display-${id}`)
      .on('postgres_changes', {
        event:  '*',
        schema: 'public',
        table:  'evento_inscricoes',
        filter: `evento_id=eq.${id}`,
      }, () => {
        fetchTudo();
      })
      .subscribe((status: string) => {
        setRealtimeOn(status === 'SUBSCRIBED');
      });

    return () => { supabase.removeChannel(channel); };
  }, [acesso, id, supabase, fetchTudo]);

  // ── Polling fallback (5s) quando realtime não está ativo ─
  useEffect(() => {
    if (acesso !== 'ok' || realtimeOn) return;
    const t = setInterval(fetchTudo, 5000);
    return () => clearInterval(t);
  }, [acesso, realtimeOn, fetchTudo]);

  // ── Métricas ─────────────────────────────────────────────
  const metricas = useMemo(() => {
    const total     = inscricoes.length;
    const presentes = inscricoes.filter(i => i.checkin_realizado).length;
    const ausentes  = total - presentes;
    const pct       = total > 0 ? Math.round((presentes / total) * 100) : 0;

    // Últimos 8 check-ins
    const ultimosCheckins = inscricoes
      .filter(i => i.checkin_realizado && i.checkin_at)
      .sort((a, b) => new Date(b.checkin_at!).getTime() - new Date(a.checkin_at!).getTime())
      .slice(0, 8);

    // Por supervisão (top 5)
    const porSup: Record<string, number> = {};
    inscricoes.filter(i => i.checkin_realizado).forEach(i => {
      const nome = supervisoes.find(s => s.id === i.supervisao_id)?.nome ?? 'Outros';
      porSup[nome] = (porSup[nome] ?? 0) + 1;
    });
    const topSups = Object.entries(porSup)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    return { total, presentes, ausentes, pct, ultimosCheckins, topSups };
  }, [inscricoes, supervisoes]);

  // ── Telas de carregamento/erro ───────────────────────────
  if (authLoading || perfil.loading || loading) {
    return (
      <div className="min-h-screen bg-[#0D2B4E] flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-white/30 border-t-white rounded-full animate-spin mx-auto mb-6" />
          <p className="text-white/70 text-xl font-semibold">Carregando display…</p>
        </div>
      </div>
    );
  }

  if (acesso === 'negado') {
    return (
      <div className="min-h-screen bg-[#0D2B4E] flex items-center justify-center">
        <div className="text-center px-8">
          <span className="text-7xl block mb-6">🔒</span>
          <p className="text-white font-bold text-2xl mb-3">Acesso não autorizado</p>
          <p className="text-white/60 mb-8">Você não tem permissão para visualizar este display.</p>
          <button onClick={() => router.push('/eventos')}
            className="bg-white/10 hover:bg-white/20 text-white px-8 py-3 rounded-xl font-semibold transition">
            ← Voltar para Eventos
          </button>
        </div>
      </div>
    );
  }

  if (!evento) return null;

  const bgColor = getBgColor(evento.departamento);
  const pctBar  = Math.min(metricas.pct, 100);

  return (
    <div
      className="min-h-screen flex flex-col select-none overflow-hidden"
      style={{ background: `linear-gradient(135deg, ${bgColor} 0%, #0a1628 100%)` }}
    >
      {/* ── STATUS BAR ───────────────────────────────────────── */}
      <div className="flex items-center justify-between px-6 py-2 bg-black/20 backdrop-blur-sm text-white/60 text-xs font-mono">
        <span>SISCOMIEADEPA · Display Ao Vivo</span>
        <span className="flex items-center gap-2">
          <span className={`inline-block w-2 h-2 rounded-full ${realtimeOn ? 'bg-emerald-400 animate-pulse' : 'bg-yellow-400'}`} />
          {realtimeOn ? 'Realtime' : 'Polling 5s'}
          {ultimaAtu && <span className="ml-2 opacity-60">· Atualizado {fmtHora(ultimaAtu.toISOString())}</span>}
        </span>
        <span className="text-white font-bold text-sm tabular-nums">
          {agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </span>
      </div>

      {/* ── HEADER DO EVENTO ──────────────────────────────────── */}
      <div className="px-8 pt-6 pb-4 flex items-center gap-6">
        {/* Banner */}
        {evento.banner_url ? (
          <div className="w-20 h-20 rounded-2xl overflow-hidden flex-shrink-0 shadow-lg border-2 border-white/20">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={evento.banner_url} alt={evento.nome} className="w-full h-full object-cover" />
          </div>
        ) : (
          <div className="w-20 h-20 rounded-2xl bg-white/10 flex items-center justify-center flex-shrink-0 text-4xl border-2 border-white/20">
            📅
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-1">
            <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-[#F39C12] text-white uppercase tracking-wider">
              {evento.departamento}
            </span>
            <span className="text-xs text-white/50 font-mono">
              {fmtData(evento.data_inicio)} → {fmtData(evento.data_fim)}
            </span>
            {(evento.local || evento.cidade) && (
              <span className="text-xs text-white/50">
                📍 {[evento.local, evento.cidade].filter(Boolean).join(', ')}
              </span>
            )}
          </div>
          <h1 className="text-3xl font-black text-white leading-tight truncate drop-shadow-lg">
            {evento.nome}
          </h1>
        </div>

        {/* Logo SISCOMIEADEPA */}
        <div className="flex-shrink-0 text-right hidden md:block">
          <p className="text-white/80 font-black text-lg tracking-widest">SISCOMIEADEPA</p>
          <p className="text-white/40 text-xs tracking-widest uppercase">Assembleia de Deus no Pará</p>
        </div>
      </div>

      {/* ── CORPO PRINCIPAL ───────────────────────────────────── */}
      <div className="flex-1 px-8 pb-6 grid grid-cols-12 gap-5 overflow-hidden">

        {/* ── MÉTRICAS PRINCIPAIS (coluna esquerda) ────────────── */}
        <div className="col-span-12 lg:col-span-8 flex flex-col gap-5">

          {/* Cards de números grandes */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {/* Total inscritos */}
            <div className="rounded-2xl bg-white/10 backdrop-blur-sm border border-white/10 p-5 flex flex-col items-center justify-center text-center shadow-xl">
              <span className="text-5xl font-black text-white tabular-nums drop-shadow-lg leading-none">
                {metricas.total}
              </span>
              <span className="text-white/60 text-sm font-semibold mt-2 uppercase tracking-widest">Inscritos</span>
            </div>

            {/* Presentes */}
            <div className="rounded-2xl bg-emerald-500/20 backdrop-blur-sm border border-emerald-400/30 p-5 flex flex-col items-center justify-center text-center shadow-xl">
              <span className="text-5xl font-black text-emerald-300 tabular-nums drop-shadow-lg leading-none">
                {metricas.presentes}
              </span>
              <span className="text-emerald-300/80 text-sm font-semibold mt-2 uppercase tracking-widest">Presentes</span>
            </div>

            {/* Ausentes */}
            <div className="rounded-2xl bg-red-500/15 backdrop-blur-sm border border-red-400/20 p-5 flex flex-col items-center justify-center text-center shadow-xl">
              <span className="text-5xl font-black text-red-300 tabular-nums drop-shadow-lg leading-none">
                {metricas.ausentes}
              </span>
              <span className="text-red-300/80 text-sm font-semibold mt-2 uppercase tracking-widest">Ausentes</span>
            </div>

            {/* Percentual */}
            <div className="rounded-2xl bg-[#F39C12]/20 backdrop-blur-sm border border-[#F39C12]/30 p-5 flex flex-col items-center justify-center text-center shadow-xl">
              <span className="text-5xl font-black text-[#F39C12] tabular-nums drop-shadow-lg leading-none">
                {metricas.pct}%
              </span>
              <span className="text-[#F39C12]/80 text-sm font-semibold mt-2 uppercase tracking-widest">Presença</span>
            </div>
          </div>

          {/* Barra de progresso de presença */}
          <div className="rounded-2xl bg-white/10 backdrop-blur-sm border border-white/10 p-5 shadow-xl">
            <div className="flex items-center justify-between mb-3">
              <span className="text-white/70 text-sm font-semibold uppercase tracking-wider">Progresso de Presença</span>
              <span className="text-white font-black text-lg">{metricas.presentes} / {metricas.total}</span>
            </div>
            <div className="w-full bg-white/10 rounded-full h-6 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{
                  width: `${pctBar}%`,
                  background: pctBar >= 75
                    ? 'linear-gradient(90deg, #10b981, #34d399)'
                    : pctBar >= 50
                    ? 'linear-gradient(90deg, #F39C12, #f59e0b)'
                    : 'linear-gradient(90deg, #ef4444, #f87171)',
                }}
              />
            </div>
            {evento.limite_vagas && (
              <p className="text-white/40 text-xs mt-2 text-right">
                Limite: {evento.limite_vagas} vagas
              </p>
            )}
          </div>

          {/* Top supervisões com presença */}
          {metricas.topSups.length > 0 && (
            <div className="rounded-2xl bg-white/10 backdrop-blur-sm border border-white/10 p-5 shadow-xl flex-1">
              <p className="text-white/70 text-sm font-semibold uppercase tracking-wider mb-4">
                🗂️ Presenças por Supervisão
              </p>
              <div className="space-y-3">
                {metricas.topSups.map(([sup, qt]) => {
                  const maxQt = metricas.topSups[0]?.[1] ?? 1;
                  const pctSup = Math.round((qt / maxQt) * 100);
                  return (
                    <div key={sup}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-white text-sm font-semibold truncate flex-1 mr-3">{sup}</span>
                        <span className="text-white/80 font-black text-base tabular-nums flex-shrink-0">{qt}</span>
                      </div>
                      <div className="w-full bg-white/10 rounded-full h-2">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-[#F39C12] to-[#f59e0b] transition-all duration-500"
                          style={{ width: `${pctSup}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* ── ÚLTIMOS CHECK-INS (coluna direita) ────────────────── */}
        <div className="col-span-12 lg:col-span-4 flex flex-col">
          <div className="rounded-2xl bg-white/10 backdrop-blur-sm border border-white/10 p-5 shadow-xl flex-1">
            <div className="flex items-center gap-2 mb-4">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <p className="text-white/70 text-sm font-semibold uppercase tracking-wider">
                Últimos Check-ins
              </p>
            </div>

            {metricas.ultimosCheckins.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 text-white/30">
                <span className="text-4xl mb-3">📭</span>
                <p className="text-sm">Aguardando check-ins…</p>
              </div>
            ) : (
              <div className="space-y-2 overflow-y-auto max-h-[50vh]">
                {metricas.ultimosCheckins.map((ins, idx) => (
                  <div
                    key={ins.id}
                    className={`flex items-center gap-3 rounded-xl px-3 py-2.5 transition-all ${
                      idx === 0
                        ? 'bg-emerald-500/25 border border-emerald-400/40 shadow-lg'
                        : 'bg-white/5 border border-white/5'
                    }`}
                  >
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 font-bold text-sm ${
                      idx === 0 ? 'bg-emerald-400 text-emerald-900' : 'bg-white/15 text-white/70'
                    }`}>
                      {idx === 0 ? '✓' : String(idx + 1)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`font-semibold truncate text-sm ${idx === 0 ? 'text-white' : 'text-white/80'}`}>
                        {ins.nome_inscrito}
                      </p>
                      {ins.checkin_at && (
                        <p className="text-white/40 text-xs tabular-nums">
                          {fmtHora(ins.checkin_at)}
                        </p>
                      )}
                    </div>
                    {idx === 0 && (
                      <span className="flex-shrink-0 text-xs font-bold text-emerald-300 bg-emerald-400/20 px-2 py-0.5 rounded-full">
                        AGORA
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── RODAPÉ ───────────────────────────────────────────────── */}
      <div className="px-8 py-3 bg-black/20 backdrop-blur-sm flex items-center justify-between">
        <p className="text-white/30 text-xs">
          {fmtData(evento.data_inicio)} → {fmtData(evento.data_fim)}
          {(evento.local || evento.cidade) && ` · ${[evento.local, evento.cidade].filter(Boolean).join(', ')}`}
        </p>
        <p className="text-white/20 text-xs font-mono">
          {agora.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}
        </p>
      </div>
    </div>
  );
}
