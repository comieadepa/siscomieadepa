'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import PageLayout from '@/components/PageLayout';
import { useRequireSupabaseAuth } from '@/hooks/useRequireSupabaseAuth';
import { useEventosPerfil } from '@/hooks/useEventosPerfil';
import { createClient } from '@/lib/supabase-client';
import { buildUrl, getPublicBaseUrl } from '@/lib/urls';

// ─── Tipos ───────────────────────────────────────────────────
interface Supervisao { id: string; nome: string; }
interface Campo      { id: string; nome: string; supervisao_id: string; }

interface Evento {
  id: string;
  nome: string;
  slug: string;
  departamento: string;
  descricao: string | null;
  data_inicio: string;
  data_fim: string;
  local: string | null;
  cidade: string | null;
  supervisao_id: string | null;
  campo_id: string | null;
  banner_url: string | null;
  valor_inscricao: number;
  status: 'programado' | 'realizado' | 'cancelado';
  inscricoes_abertas: boolean;
  limite_vagas: number | null;
  publico_alvo: string | null;
  created_at: string;
}

interface InscricaoResumo {
  evento_id: string;
  status_pagamento: string;
  valor_pago: number;
}

interface EventoComStats extends Evento {
  total_inscritos: number;
  total_pagos: number;
  valor_arrecadado: number;
  nome_supervisao: string | null;
  nome_campo: string | null;
}

const DEPARTAMENTOS = ['AGO', 'COADESPA', 'UMADESPA', 'SEIADEPA', 'AVULSO'];

const STATUS_CONFIG = {
  programado: { label: 'Programado', bg: 'bg-blue-100',  text: 'text-blue-700',  dot: 'bg-blue-500'  },
  realizado:  { label: 'Realizado',  bg: 'bg-green-100', text: 'text-green-700', dot: 'bg-green-500' },
  cancelado:  { label: 'Cancelado',  bg: 'bg-red-100',   text: 'text-red-700',   dot: 'bg-red-500'   },
};

function fmtData(d: string) {
  if (!d) return '';
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y}`;
}

function fmtMoeda(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// ─── Componente principal ─────────────────────────────────────
export default function EventosPage() {
  const { loading: authLoading } = useRequireSupabaseAuth();
  const perfil = useEventosPerfil();
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [eventos,     setEventos]     = useState<Evento[]>([]);
  const [inscricoes,  setInscricoes]  = useState<InscricaoResumo[]>([]);
  const [supervisoes, setSupervisoes] = useState<Supervisao[]>([]);
  const [campos,      setCampos]      = useState<Campo[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [activeTab,   setActiveTab]   = useState<'programado' | 'realizado' | 'cancelado'>('programado');

  const [busca,       setBusca]       = useState('');
  const [filtroDept,  setFiltroDept]  = useState('');
  const [filtroAno,   setFiltroAno]   = useState('');
  const [filtroSup,   setFiltroSup]   = useState('');
  const [filtroCampo, setFiltroCampo] = useState('');

  // Para isDeptAdmin, trava o filtro de departamento
  useEffect(() => {
    if (!perfil.loading && perfil.isDeptAdmin && perfil.departamentoUsuario) {
      setFiltroDept(perfil.departamentoUsuario);
    }
  }, [perfil.loading, perfil.isDeptAdmin, perfil.departamentoUsuario]);

  const isReady = !authLoading && !perfil.loading;

  useEffect(() => {
    if (!isReady) return;
    (async () => {
      setLoadingData(true);
      try {
        // Busca eventos: filtra pelo dept (isDeptAdmin) ou IDs acessíveis (vinculados)
        let evQuery = supabase.from('eventos').select('*').order('data_inicio', { ascending: false });
        if (perfil.isDeptAdmin && perfil.departamentoUsuario) {
          // Admin de departamento: vê todos os eventos do próprio dept
          evQuery = evQuery.eq('departamento', perfil.departamentoUsuario);
        } else if (!perfil.isGlobal && perfil.eventoIds !== null) {
          if (perfil.eventoIds.length === 0) {
            setEventos([]);
            setInscricoes([]);
            setLoadingData(false);
            return;
          }
          evQuery = evQuery.in('id', perfil.eventoIds);
        }

        const [evRes, supRes, camRes] = await Promise.all([
          evQuery,
          supabase.from('supervisoes').select('id, nome').order('nome'),
          supabase.from('campos').select('id, nome, supervisao_id').order('nome'),
        ]);

        const evs = (evRes.data as Evento[]) || [];
        setEventos(evs);
        setSupervisoes((supRes.data as Supervisao[]) || []);
        setCampos((camRes.data as Campo[]) || []);

        // Carrega inscrições apenas dos eventos acessíveis
        if (evs.length > 0) {
          const ids = evs.map(e => e.id);
          const { data: inData } = await supabase
            .from('evento_inscricoes')
            .select('evento_id, status_pagamento, valor_pago')
            .in('evento_id', ids);
          setInscricoes((inData as InscricaoResumo[]) || []);
        } else {
          setInscricoes([]);
        }
      } finally {
        setLoadingData(false);
      }
    })();
  }, [isReady, perfil.isGlobal, perfil.eventoIds, supabase]);

  const eventosComStats = useMemo<EventoComStats[]>(() => {
    return eventos.map(ev => {
      const ins   = inscricoes.filter(i => i.evento_id === ev.id);
      const pagos = ins.filter(i => i.status_pagamento === 'pago');
      const sup   = supervisoes.find(s => s.id === ev.supervisao_id);
      const campo = campos.find(c => c.id === ev.campo_id);
      return {
        ...ev,
        total_inscritos:  ins.length,
        total_pagos:      pagos.length,
        valor_arrecadado: pagos.reduce((acc, i) => acc + (i.valor_pago || 0), 0),
        nome_supervisao:  sup?.nome   ?? null,
        nome_campo:       campo?.nome ?? null,
      };
    });
  }, [eventos, inscricoes, supervisoes, campos]);

  const summary = useMemo(() => ({
    programados: eventos.filter(e => e.status === 'programado').length,
    realizados:  eventos.filter(e => e.status === 'realizado').length,
    cancelados:  eventos.filter(e => e.status === 'cancelado').length,
    pagas:       inscricoes.filter(i => i.status_pagamento === 'pago').length,
    pendentes:   inscricoes.filter(i => i.status_pagamento === 'pendente').length,
    valorTotal:  inscricoes.filter(i => i.status_pagamento === 'pago').reduce((a, i) => a + (i.valor_pago || 0), 0),
  }), [eventos, inscricoes]);

  const anos = useMemo(() => {
    const set = new Set(eventos.map(e => e.data_inicio?.slice(0, 4)).filter(Boolean));
    return Array.from(set).sort((a, b) => Number(b) - Number(a));
  }, [eventos]);

  const camposFiltrados = useMemo(() =>
    filtroSup ? campos.filter(c => c.supervisao_id === filtroSup) : campos,
    [campos, filtroSup]
  );

  const eventosFiltrados = useMemo(() => {
    return eventosComStats.filter(ev => {
      if (ev.status !== activeTab) return false;
      if (busca && !ev.nome.toLowerCase().includes(busca.toLowerCase())) return false;
      if (filtroDept && ev.departamento !== filtroDept) return false;
      if (filtroAno  && !ev.data_inicio.startsWith(filtroAno)) return false;
      if (filtroSup  && ev.supervisao_id !== filtroSup) return false;
      if (filtroCampo && ev.campo_id !== filtroCampo) return false;
      return true;
    });
  }, [eventosComStats, activeTab, busca, filtroDept, filtroAno, filtroSup, filtroCampo]);

  function handleFiltroSup(v: string) {
    setFiltroSup(v);
    setFiltroCampo('');
  }

  if (authLoading || perfil.loading) return <div className="p-8 text-gray-500">Carregando...</div>;

  // ── Dashboard simplificada para perfil checkin ───────────
  if (perfil.somenteCheckin) {
    return (
      <PageLayout title="Eventos" description="Seus eventos de check-in" activeMenu="eventos">
        {loadingData ? (
          <LoadingCards />
        ) : eventos.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-12 text-center">
            <span className="text-5xl mb-4 block">📋</span>
            <p className="text-gray-600 font-semibold">Nenhum evento vinculado a você ainda.</p>
            <p className="text-sm text-gray-400 mt-1">Entre em contato com o administrador do sistema.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {eventos.map(ev => (
              <div key={ev.id} className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-[#123b63]/10 text-[#123b63]">{ev.departamento}</span>
                  </div>
                  <p className="font-bold text-gray-900">{ev.nome}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    📅 {fmtData(ev.data_inicio)} → {fmtData(ev.data_fim)}
                    {ev.local && <> &nbsp;·&nbsp; 📍{ev.local}</>}
                  </p>
                </div>
                <button
                  onClick={() => router.push(`/eventos/${ev.id}/checkin`)}
                  className="whitespace-nowrap bg-[#123b63] text-white px-6 py-2.5 rounded-lg text-sm font-bold hover:bg-[#0f2a45] transition flex items-center gap-2"
                >
                  ✅ Abrir Check-in
                </button>
              </div>
            ))}
          </div>
        )}
      </PageLayout>
    );
  }

  return (
    <PageLayout
      title="Eventos"
      description={perfil.isGlobal ? 'Gerenciamento de eventos e inscrições' : 'Seus eventos'}
      activeMenu="eventos"
    >

      {/* ── Summary Cards ──────────────────────────────────── */}
      {loadingData ? (
        <LoadingCards />
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4 mb-8">
          <SummaryCard label="Programados"      value={summary.programados} color="border-blue-500"    textColor="text-[#123b63]"   icon="📅" />
          <SummaryCard label="Realizados"       value={summary.realizados}  color="border-green-500"   textColor="text-green-700"   icon="✅" />
          <SummaryCard label="Cancelados"       value={summary.cancelados}  color="border-red-400"     textColor="text-red-600"     icon="❌" />
          <SummaryCard label="Inscrições Pagas" value={summary.pagas}       color="border-emerald-500" textColor="text-emerald-700" icon="💳" />
          <SummaryCard label="Pendentes"        value={summary.pendentes}   color="border-yellow-500"  textColor="text-yellow-700"  icon="⏳" />
          {perfil.podeVerFinanceiro && (
            <SummaryCard label="Arrecadado" value={fmtMoeda(summary.valorTotal)} color="border-[#F39C12]" textColor="text-[#F39C12]" icon="💰" small />
          )}
        </div>
      )}

      {/* ── Filtros + Novo Evento ──────────────────────────── */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 mb-6 p-4">
        <div className="flex flex-col lg:flex-row gap-3">
          <div className="flex-1">
            <input
              type="text"
              placeholder="🔍  Buscar evento..."
              value={busca}
              onChange={e => setBusca(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#123b63]"
            />
          </div>
          {/* Filtros de departamento/supervisão apenas para admin global */}
          {perfil.isGlobal && (
            <>
              <select value={filtroDept} onChange={e => setFiltroDept(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#123b63] bg-white">
                <option value="">Todos os departamentos</option>
                {DEPARTAMENTOS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
              <select value={filtroAno} onChange={e => setFiltroAno(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#123b63] bg-white">
                <option value="">Todos os anos</option>
                {anos.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
              <select value={filtroSup} onChange={e => handleFiltroSup(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#123b63] bg-white">
                <option value="">Todas as supervisões</option>
                {supervisoes.map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}
              </select>
              <select value={filtroCampo} onChange={e => setFiltroCampo(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#123b63] bg-white">
                <option value="">Todos os campos</option>
                {camposFiltrados.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </>
          )}
          {/* isDeptAdmin: exibe departamento travado */}
          {perfil.isDeptAdmin && perfil.departamentoUsuario && (
            <span className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border border-[#123b63]/30 bg-[#123b63]/5 text-[#123b63] font-semibold">
              🏷️ {perfil.departamentoUsuario}
            </span>
          )}
          {/* Filtro de ano disponível para não-admin-global */}
          {!perfil.isGlobal && !perfil.isDeptAdmin && (
            <select value={filtroAno} onChange={e => setFiltroAno(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#123b63] bg-white">
              <option value="">Todos os anos</option>
              {anos.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          )}
          {perfil.podeNovoEvento && (
            <button
              onClick={() => router.push('/eventos/novo')}
              className="whitespace-nowrap bg-[#123b63] text-white px-5 py-2 rounded-lg text-sm font-semibold hover:bg-[#0f2a45] transition flex items-center gap-2"
            >
              <span className="text-[#F39C12] font-bold">+</span> Novo Evento
            </button>
          )}
          <button
            onClick={() => window.open(buildUrl(getPublicBaseUrl(), '/eventos-publicos'), '_blank')}
            className="whitespace-nowrap bg-white text-[#123b63] px-5 py-2 rounded-lg text-sm font-semibold border border-[#123b63]/30 hover:bg-[#123b63]/5 transition flex items-center gap-2"
          >
            🌐 Portal publico
          </button>
        </div>
      </div>

      {/* ── Abas ───────────────────────────────────────────── */}
      <div className="mb-6 border-b border-gray-300">
        <div className="flex">
          {([
            { id: 'programado' as const, label: 'Programados', icon: '📅', count: summary.programados },
            { id: 'realizado'  as const, label: 'Realizados',  icon: '✅', count: summary.realizados  },
            { id: 'cancelado'  as const, label: 'Cancelados',  icon: '❌', count: summary.cancelados  },
          ]).map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-6 py-3 text-sm font-semibold border-b-2 transition ${
                activeTab === tab.id
                  ? 'border-[#123b63] text-[#123b63]'
                  : 'border-transparent text-gray-500 hover:text-gray-800 hover:border-gray-300'
              }`}
            >
              <span>{tab.icon}</span>
              {tab.label}
              <span className={`ml-1 text-xs px-1.5 py-0.5 rounded-full font-bold ${
                activeTab === tab.id ? 'bg-[#123b63] text-white' : 'bg-gray-200 text-gray-600'
              }`}>
                {tab.count}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Lista de eventos ───────────────────────────────── */}
      {loadingData ? (
        <div className="space-y-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 animate-pulse">
              <div className="flex gap-6">
                <div className="w-28 h-20 bg-gray-200 rounded-lg flex-shrink-0" />
                <div className="flex-1 space-y-3">
                  <div className="h-5 bg-gray-200 rounded w-2/3" />
                  <div className="h-3 bg-gray-200 rounded w-1/3" />
                  <div className="h-3 bg-gray-200 rounded w-1/2" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : eventosFiltrados.length === 0 ? (
        <EmptyState
          tab={activeTab}
          temFiltro={!!(busca || filtroDept || filtroAno || filtroSup || filtroCampo)}
          podeNovoEvento={perfil.podeNovoEvento}
          onNovo={() => router.push('/eventos/novo')}
        />
      ) : (
        <div className="space-y-4">
          {eventosFiltrados.map(ev => (
            <EventoCard
              key={ev.id}
              evento={ev}
              podeVerFinanceiro={perfil.podeVerFinanceiro}
              onGerenciar={() => router.push(`/eventos/${ev.id}`)}
            />
          ))}
        </div>
      )}

    </PageLayout>
  );
}

// ─── SummaryCard ─────────────────────────────────────────────
function SummaryCard({ label, value, color, textColor, icon, small = false }: {
  label: string; value: number | string; color: string;
  textColor: string; icon: string; small?: boolean;
}) {
  return (
    <div className={`bg-white rounded-xl p-4 shadow-sm border-l-4 ${color}`}>
      <div className="flex items-center justify-between mb-2">
        <p className="text-gray-500 text-xs font-medium leading-tight">{label}</p>
        <span className="text-lg">{icon}</span>
      </div>
      <p className={`font-bold ${textColor} ${small ? 'text-base' : 'text-2xl'}`}>{value}</p>
    </div>
  );
}

// ─── EventoCard ───────────────────────────────────────────────
function EventoCard({ evento, podeVerFinanceiro, onGerenciar }: {
  evento: EventoComStats;
  podeVerFinanceiro: boolean;
  onGerenciar: () => void;
}) {
  const cfg = STATUS_CONFIG[evento.status] ?? STATUS_CONFIG.programado;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-shadow">
      <div className="flex flex-col sm:flex-row">

        {/* Banner */}
        <div className="sm:w-36 sm:flex-shrink-0 bg-gray-100 flex items-center justify-center min-h-[96px]">
          {evento.banner_url ? (
            <img src={evento.banner_url} alt={evento.nome} className="w-full h-full object-cover" />
          ) : (
            <span className="text-4xl select-none">📅</span>
          )}
        </div>

        {/* Conteúdo */}
        <div className="flex-1 p-5">
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold ${cfg.bg} ${cfg.text}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                  {cfg.label}
                </span>
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#123b63]/10 text-[#123b63]">
                  {evento.departamento}
                </span>
                {evento.inscricoes_abertas && (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700">
                    Inscrições abertas
                  </span>
                )}
              </div>

              <h3 className="text-base font-bold text-gray-900 truncate mb-1">{evento.nome}</h3>

              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                <span>📅 {fmtData(evento.data_inicio)} → {fmtData(evento.data_fim)}</span>
                {(evento.local || evento.cidade) && (
                  <span>📍 {[evento.local, evento.cidade].filter(Boolean).join(' — ')}</span>
                )}
                {evento.nome_supervisao && <span>🗂️ {evento.nome_supervisao}</span>}
                {evento.nome_campo      && <span>⛪ {evento.nome_campo}</span>}
                {evento.publico_alvo    && <span>👥 {evento.publico_alvo}</span>}
              </div>
            </div>

            {/* Stats */}
            <div className="flex sm:flex-col gap-4 sm:gap-2 sm:items-end sm:text-right flex-shrink-0">
              <StatBadge label="Inscritos"  value={evento.total_inscritos}  color="text-[#123b63]"    />
              <StatBadge label="Pagos"      value={evento.total_pagos}      color="text-emerald-600"  />
              {podeVerFinanceiro && (
                <StatBadge label="Arrecadado" value={fmtMoeda(evento.valor_arrecadado)} color="text-[#F39C12]" small />
              )}
            </div>
          </div>

          {/* Botões */}
          <div className="flex flex-wrap gap-2 mt-4 pt-3 border-t border-gray-100">
            <ActionBtn label="Gerenciar" icon="⚙️" onClick={onGerenciar} primary tooltip="Abrir painel completo do evento" />
            <ActionBtn label="Pág. Pública" icon="🌐" onClick={() => window.open(buildUrl(getPublicBaseUrl(), `/inscricao/${evento.slug}`), '_blank')} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Auxiliares ──────────────────────────────────────────────
function StatBadge({ label, value, color, small = false }: {
  label: string; value: number | string; color: string; small?: boolean;
}) {
  return (
    <div className="text-center sm:text-right">
      <p className="text-gray-400 text-xs">{label}</p>
      <p className={`font-bold ${color} ${small ? 'text-sm' : 'text-lg'}`}>{value}</p>
    </div>
  );
}

function ActionBtn({ label, icon, onClick, primary = false, disabled = false, tooltip }: {
  label: string; icon: string; onClick: () => void; primary?: boolean; disabled?: boolean; tooltip?: string;
}) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      title={tooltip}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
        disabled
          ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
          : primary
          ? 'bg-[#123b63] text-white hover:bg-[#0f2a45]'
          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
      }`}
    >
      <span>{icon}</span>{label}
    </button>
  );
}

function EmptyState({ tab, temFiltro, podeNovoEvento, onNovo }: {
  tab: string; temFiltro: boolean; podeNovoEvento: boolean; onNovo: () => void;
}) {
  const msgs: Record<string, { icon: string; title: string; desc: string }> = {
    programado: { icon: '📅', title: 'Nenhum evento programado', desc: 'Crie o primeiro evento.' },
    realizado:  { icon: '✅', title: 'Nenhum evento realizado',  desc: 'Eventos concluídos aparecerão aqui.' },
    cancelado:  { icon: '❌', title: 'Nenhum evento cancelado',  desc: 'Eventos cancelados aparecerão aqui.' },
  };
  const m = msgs[tab] ?? msgs.programado;
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 py-16 flex flex-col items-center justify-center text-center">
      <span className="text-6xl mb-4">{m.icon}</span>
      <p className="text-lg font-semibold text-gray-700 mb-1">
        {temFiltro ? 'Nenhum resultado para os filtros aplicados' : m.title}
      </p>
      <p className="text-sm text-gray-500 mb-6">
        {temFiltro ? 'Tente ajustar os filtros acima.' : m.desc}
      </p>
      {!temFiltro && tab === 'programado' && podeNovoEvento && (
        <button
          onClick={onNovo}
          className="bg-[#123b63] text-white px-6 py-2.5 rounded-lg text-sm font-semibold hover:bg-[#0f2a45] transition"
        >
          + Novo Evento
        </button>
      )}
    </div>
  );
}

function LoadingCards() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4 mb-8">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="bg-white rounded-xl p-5 shadow-sm border border-gray-100 animate-pulse">
          <div className="h-3 bg-gray-200 rounded w-3/4 mb-3" />
          <div className="h-8 bg-gray-200 rounded w-1/2" />
        </div>
      ))}
    </div>
  );
}
