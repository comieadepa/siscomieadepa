'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import PageLayout from '@/components/PageLayout';
import { useRequireSupabaseAuth } from '@/hooks/useRequireSupabaseAuth';
import { useEventosPerfil } from '@/hooks/useEventosPerfil';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  LineChart, Line, ResponsiveContainer, Cell,
} from 'recharts';

// ─── Tipos ────────────────────────────────────────────────────
interface Resumo {
  total_eventos: number; eventos_ativos: number; eventos_encerrados: number;
  inscricoes_totais: number; presentes_totais: number; pendentes_pagamento: number;
  valor_arrecadado: number; certificados_emitidos: number;
}
interface DeptStats {
  dept: string; total_eventos: number; inscritos: number; presentes: number;
  arrecadacao: number; hospedagem: number; pendencias: number;
}
interface EventoAtivo {
  id: string; nome: string; slug: string; departamento: string;
  banner_url: string | null; data_inicio: string; data_fim: string;
  total_inscritos: number; presentes: number; arrecadacao: number;
  pct_presenca: number; limite_vagas: number | null;
  limite_hospedagem: number | null; hospedagem_usada: number;
}
interface Alerta {
  tipo: string; mensagem: string; nivel: 'danger' | 'warning' | 'info';
  evento_id?: string; evento_nome?: string;
}
interface EvolucaoDia { data: string; inscricoes: number; }

interface DashboardData {
  resumo: Resumo;
  por_departamento: DeptStats[];
  eventos_ativos: EventoAtivo[];
  alertas: Alerta[];
  evolucao_diaria: EvolucaoDia[];
}

// ─── Constantes ───────────────────────────────────────────────
const ANO_ATUAL = new Date().getFullYear();
const ANOS = Array.from({ length: 4 }, (_, i) => ANO_ATUAL - i);
const DEPTS = ['', 'AGO', 'UMADESPA', 'COADESPA', 'SEIADEPA', 'AVULSO'];
const STATUS_OPT = [
  { value: '',           label: 'Todos os status' },
  { value: 'programado', label: 'Programados' },
  { value: 'realizado',  label: 'Realizados' },
  { value: 'cancelado',  label: 'Cancelados' },
];
const DEPT_CORES: Record<string, string> = {
  AGO:      '#123b63',
  UMADESPA: '#8B5CF6',
  COADESPA: '#10B981',
  SEIADEPA: '#F59E0B',
  AVULSO:   '#6B7280',
};

// ─── Helpers ─────────────────────────────────────────────────
const fmtMoeda = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtData  = (d: string) => {
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y}`;
};
const fmtDiaAbrev = (d: string) => {
  const [, m, day] = d.split('-');
  return `${day}/${m}`;
};

// ─── Componente principal ─────────────────────────────────────
export default function EventosDashboardPage() {
  const { loading: authLoading } = useRequireSupabaseAuth();
  const perfil = useEventosPerfil();
  const router = useRouter();

  const [data,       setData]       = useState<DashboardData | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [erro,       setErro]       = useState('');
  const [filtroAno,  setFiltroAno]  = useState(String(ANO_ATUAL));
  const [filtroDept, setFiltroDept] = useState('');
  const [filtroSt,   setFiltroSt]   = useState('');
  const [ultimaAtual, setUltimaAtual] = useState<Date | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Buscar dados ────────────────────────────────────────────
  const buscar = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    setErro('');
    try {
      const qs = new URLSearchParams({ ano: filtroAno, departamento: filtroDept, status: filtroSt });
      const res = await fetch(`/api/eventos/dashboard?${qs}`);
      if (res.status === 403) { setErro('acesso_negado'); return; }
      if (!res.ok) throw new Error('Falha ao carregar dados.');
      const json = await res.json();
      setData(json);
      setUltimaAtual(new Date());
    } catch (e) {
      setErro(String(e));
    } finally {
      setLoading(false);
    }
  }, [filtroAno, filtroDept, filtroSt]);

  // ── Carrega na montagem e ao mudar filtros ──────────────────
  useEffect(() => {
    if (!authLoading && !perfil.loading) {
      buscar();
    }
  }, [buscar, authLoading, perfil.loading]);

  // ── Auto-refresh a cada 30s ─────────────────────────────────
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (!autoRefresh) return;
    timerRef.current = setInterval(() => buscar(false), 30_000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [autoRefresh, buscar]);

  // ── Acesso negado ───────────────────────────────────────────
  if (!authLoading && !perfil.loading && !perfil.isGlobal) {
    return (
      <PageLayout title="Acesso Negado" description="" activeMenu="eventos">
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mb-4">
            <span className="text-4xl">🔒</span>
          </div>
          <h2 className="text-xl font-bold text-gray-700 mb-2">Acesso restrito</h2>
          <p className="text-gray-400 text-sm max-w-sm">
            O Dashboard Geral é acessível apenas para administradores globais do sistema.
          </p>
          <button onClick={() => router.push('/eventos')}
            className="mt-6 bg-[#123b63] text-white px-5 py-2.5 rounded-xl text-sm font-bold hover:bg-[#0f2a45] transition">
            ← Voltar para Eventos
          </button>
        </div>
      </PageLayout>
    );
  }

  // ── Erro de acesso negado vindo da API ──────────────────────
  if (erro === 'acesso_negado') {
    return (
      <PageLayout title="Dashboard Eventos" description="" activeMenu="eventos">
        <div className="text-center py-24 text-red-500 font-semibold">
          🔒 Sem permissão para acessar este painel.
        </div>
      </PageLayout>
    );
  }

  // ── Exportar CSV ────────────────────────────────────────────
  function exportarCSV() {
    if (!data) return;
    const rows: string[] = ['Departamento,Eventos,Inscritos,Presentes,Arrecadação,Hospedagem,Pendências'];
    for (const d of data.por_departamento) {
      rows.push(`${d.dept},${d.total_eventos},${d.inscritos},${d.presentes},${d.arrecadacao.toFixed(2)},${d.hospedagem},${d.pendencias}`);
    }
    const csv = rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `dashboard-eventos-${filtroAno}.csv`;
    a.click();
  }

  function exportarFinanceiro() {
    if (!data) return;
    const rows: string[] = ['Evento,Departamento,Inscritos,Presentes,Arrecadação,% Presença'];
    for (const e of data.eventos_ativos) {
      rows.push(`"${e.nome}",${e.departamento},${e.total_inscritos},${e.presentes},${e.arrecadacao.toFixed(2)},${e.pct_presenca}%`);
    }
    const csv = rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `financeiro-eventos-${filtroAno}.csv`;
    a.click();
  }

  // ─── Render ────────────────────────────────────────────────
  return (
    <PageLayout
      title="Dashboard de Eventos"
      description="Visão executiva geral — todos os departamentos"
      activeMenu="eventos"
    >
      <div className="space-y-8 pb-10">

        {/* ══ BARRA SUPERIOR: filtros + ações ══════════════════ */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm px-5 py-4 flex flex-wrap items-center gap-3">
          {/* Filtros */}
          <div className="flex flex-wrap gap-2 flex-1">
            <select value={filtroAno} onChange={e => setFiltroAno(e.target.value)}
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#123b63]/30 bg-white">
              {ANOS.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
            <select value={filtroDept} onChange={e => setFiltroDept(e.target.value)}
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#123b63]/30 bg-white">
              <option value="">Todos os departamentos</option>
              {DEPTS.slice(1).map(d => <option key={d} value={d}>{d}</option>)}
            </select>
            <select value={filtroSt} onChange={e => setFiltroSt(e.target.value)}
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#123b63]/30 bg-white">
              {STATUS_OPT.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          {/* Ações */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Auto-refresh badge */}
            <button onClick={() => setAutoRefresh(a => !a)}
              className={`text-xs px-3 py-1.5 rounded-lg font-semibold border transition ${autoRefresh ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-gray-50 border-gray-200 text-gray-400'}`}>
              {autoRefresh ? '🔄 Live' : '⏸ Parado'}
            </button>
            {ultimaAtual && (
              <span className="text-xs text-gray-400">
                Atualizado: {ultimaAtual.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            )}
            <button onClick={() => buscar(true)}
              disabled={loading}
              className="text-xs bg-[#123b63] text-white px-3 py-1.5 rounded-lg font-bold hover:bg-[#0f2a45] transition disabled:opacity-50">
              {loading ? '...' : '↺ Atualizar'}
            </button>
            <button onClick={exportarCSV} disabled={!data}
              className="text-xs border border-gray-200 text-gray-600 px-3 py-1.5 rounded-lg font-semibold hover:border-gray-300 hover:bg-gray-50 transition disabled:opacity-40">
              📥 Resumo CSV
            </button>
            <button onClick={exportarFinanceiro} disabled={!data}
              className="text-xs border border-gray-200 text-gray-600 px-3 py-1.5 rounded-lg font-semibold hover:border-gray-300 hover:bg-gray-50 transition disabled:opacity-40">
              💰 Financeiro CSV
            </button>
          </div>
        </div>

        {/* ── Loading inicial ─────────────────────────────────── */}
        {loading && !data && (
          <div className="text-center py-20 text-gray-400">
            <div className="w-10 h-10 border-4 border-[#123b63]/20 border-t-[#123b63] rounded-full animate-spin mx-auto mb-3" />
            <p className="text-sm">Carregando dados...</p>
          </div>
        )}

        {data && (
          <>
            {/* ══ 1. RESUMO GERAL ══════════════════════════════ */}
            <section>
              <SectionTitle>📊 Resumo Geral</SectionTitle>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <SummaryCard label="Total de Eventos"      value={data.resumo.total_eventos}        icon="📅" cor="blue"    />
                <SummaryCard label="Eventos Ativos"        value={data.resumo.eventos_ativos}       icon="✅" cor="emerald" />
                <SummaryCard label="Eventos Encerrados"    value={data.resumo.eventos_encerrados}   icon="🏁" cor="gray"   />
                <SummaryCard label="Inscrições Totais"     value={data.resumo.inscricoes_totais}    icon="👥" cor="blue"   />
                <SummaryCard label="Presentes"             value={data.resumo.presentes_totais}     icon="✔️" cor="emerald" />
                <SummaryCard label="Pendentes Pagamento"   value={data.resumo.pendentes_pagamento}  icon="⏳" cor="amber"  />
                <SummaryCard label="Certificados Emitidos" value={data.resumo.certificados_emitidos} icon="🎓" cor="purple" />
                <SummaryCard
                  label="Valor Arrecadado"
                  value={fmtMoeda(data.resumo.valor_arrecadado)}
                  icon="💰" cor="emerald" isText
                />
              </div>
            </section>

            {/* ══ 2. ALERTAS OPERACIONAIS ══════════════════════ */}
            {data.alertas.length > 0 && (
              <section>
                <SectionTitle>🚨 Alertas Operacionais</SectionTitle>
                <div className="space-y-2">
                  {data.alertas.map((a, idx) => (
                    <AlertaCard key={idx} alerta={a} onVerEvento={id => router.push(`/eventos/${id}`)} />
                  ))}
                </div>
              </section>
            )}

            {/* ══ 3. EVENTOS EM ANDAMENTO ══════════════════════ */}
            {data.eventos_ativos.length > 0 && (
              <section>
                <SectionTitle>🟢 Eventos em Andamento ({data.eventos_ativos.length})</SectionTitle>
                <div className="space-y-3">
                  {data.eventos_ativos.map(ev => (
                    <EventoAtivoCard key={ev.id} evento={ev} onAbrir={id => router.push(`/eventos/${id}`)} />
                  ))}
                </div>
              </section>
            )}

            {/* ══ 4. POR DEPARTAMENTO ══════════════════════════ */}
            <section>
              <SectionTitle>🏢 Por Departamento</SectionTitle>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                {data.por_departamento.map(d => (
                  <DeptCard key={d.dept} dept={d} />
                ))}
              </div>
            </section>

            {/* ══ 5. GRÁFICOS ══════════════════════════════════ */}
            <section>
              <SectionTitle>📈 Gráficos</SectionTitle>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

                {/* Inscrições por departamento */}
                <ChartCard title="Inscrições por Departamento">
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={data.por_departamento} margin={{ top: 4, right: 12, left: 0, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="dept" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                      <Tooltip formatter={(v: number | undefined) => [v, 'Inscritos']} />
                      <Bar dataKey="inscritos" radius={[4, 4, 0, 0]}>
                        {data.por_departamento.map(d => (
                          <Cell key={d.dept} fill={DEPT_CORES[d.dept] ?? '#6B7280'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </ChartCard>

                {/* Arrecadação por departamento */}
                <ChartCard title="Arrecadação por Departamento (R$)">
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={data.por_departamento} margin={{ top: 4, right: 12, left: 0, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="dept" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `R$${(v / 1000).toFixed(0)}k`} />
                      <Tooltip formatter={(v: number | undefined) => [fmtMoeda(v ?? 0), 'Arrecadado']} />
                      <Bar dataKey="arrecadacao" radius={[4, 4, 0, 0]}>
                        {data.por_departamento.map(d => (
                          <Cell key={d.dept} fill={DEPT_CORES[d.dept] ?? '#6B7280'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </ChartCard>

                {/* Evolução diária — largura total */}
                <div className="lg:col-span-2">
                  <ChartCard title="Evolução Diária de Inscrições (últimos 30 dias)">
                    <ResponsiveContainer width="100%" height={200}>
                      <LineChart data={data.evolucao_diaria} margin={{ top: 4, right: 12, left: 0, bottom: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="data" tickFormatter={fmtDiaAbrev}
                          tick={{ fontSize: 10 }} interval={4} />
                        <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                        <Tooltip
                          labelFormatter={(l: string) => fmtData(l)}
                          formatter={(v: number | undefined) => [v, 'Inscrições']}
                        />
                        <Line type="monotone" dataKey="inscricoes"
                          stroke="#123b63" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </ChartCard>
                </div>
              </div>
            </section>
          </>
        )}
      </div>
    </PageLayout>
  );
}

// ══════════════════════════════════════════════════════════════
// SUBCOMPONENTES
// ══════════════════════════════════════════════════════════════

// ── Título de seção ──────────────────────────────────────────
function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-base font-bold text-[#123b63] mb-3 flex items-center gap-2">{children}</h2>
  );
}

// ── Summary Card ─────────────────────────────────────────────
const CARD_CORES: Record<string, string> = {
  blue:    'bg-blue-50 border-blue-200 text-blue-800',
  emerald: 'bg-emerald-50 border-emerald-200 text-emerald-800',
  amber:   'bg-amber-50 border-amber-200 text-amber-800',
  gray:    'bg-gray-50 border-gray-200 text-gray-700',
  purple:  'bg-purple-50 border-purple-200 text-purple-800',
};

function SummaryCard({
  label, value, icon, cor, isText
}: { label: string; value: number | string; icon: string; cor: string; isText?: boolean }) {
  return (
    <div className={`border rounded-2xl p-4 flex flex-col gap-1 shadow-sm ${CARD_CORES[cor] ?? CARD_CORES.gray}`}>
      <span className="text-xl">{icon}</span>
      <span className={`font-black leading-tight ${isText ? 'text-lg' : 'text-2xl'}`}>{value}</span>
      <span className="text-xs font-semibold opacity-70">{label}</span>
    </div>
  );
}

// ── Alerta Card ──────────────────────────────────────────────
const ALERTA_CFG: Record<string, { bg: string; border: string; badge: string; icon: string }> = {
  danger:  { bg: 'bg-red-50',    border: 'border-red-200',    badge: 'bg-red-600 text-white',    icon: '🔴' },
  warning: { bg: 'bg-amber-50',  border: 'border-amber-200',  badge: 'bg-amber-500 text-white',  icon: '🟡' },
  info:    { bg: 'bg-blue-50',   border: 'border-blue-200',   badge: 'bg-blue-500 text-white',   icon: '🔵' },
};
const ALERTA_TIPO_LABEL: Record<string, string> = {
  hospedagem_lotada:     'Hospedagem Lotada',
  vagas_acabando:        'Vagas Acabando',
  pendentes:             'Pagamentos Pendentes',
  sem_checkin:           'Sem Check-in',
  certificados_pendentes: 'Certificados Pendentes',
};

function AlertaCard({ alerta, onVerEvento }: { alerta: Alerta; onVerEvento: (id: string) => void }) {
  const cfg = ALERTA_CFG[alerta.nivel] ?? ALERTA_CFG.info;
  return (
    <div className={`flex items-start gap-3 ${cfg.bg} border ${cfg.border} rounded-xl px-4 py-3`}>
      <span className="text-lg flex-shrink-0 mt-0.5">{cfg.icon}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${cfg.badge}`}>
            {ALERTA_TIPO_LABEL[alerta.tipo] ?? alerta.tipo}
          </span>
          {alerta.evento_nome && (
            <span className="text-xs text-gray-600 font-semibold truncate">{alerta.evento_nome}</span>
          )}
        </div>
        <p className="text-sm text-gray-700 mt-0.5">{alerta.mensagem}</p>
      </div>
      {alerta.evento_id && (
        <button
          onClick={() => onVerEvento(alerta.evento_id!)}
          className="flex-shrink-0 text-xs font-bold text-[#123b63] hover:underline whitespace-nowrap">
          Ver →
        </button>
      )}
    </div>
  );
}

// ── Evento Ativo Card ────────────────────────────────────────
const DEPT_BADGE: Record<string, string> = {
  AGO:      'bg-blue-100 text-blue-800',
  UMADESPA: 'bg-purple-100 text-purple-800',
  COADESPA: 'bg-emerald-100 text-emerald-800',
  SEIADEPA: 'bg-amber-100 text-amber-800',
  AVULSO:   'bg-gray-100 text-gray-700',
};

function EventoAtivoCard({ evento, onAbrir }: { evento: EventoAtivo; onAbrir: (id: string) => void }) {
  const pct = evento.pct_presenca;
  const pctCor = pct >= 70 ? 'bg-emerald-500' : pct >= 40 ? 'bg-amber-400' : 'bg-gray-300';

  return (
    <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden flex flex-col sm:flex-row gap-0">
      {/* Banner */}
      <div className="sm:w-32 h-24 sm:h-auto flex-shrink-0 bg-gradient-to-br from-[#0D2B4E] to-[#123b63] relative">
        {evento.banner_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={evento.banner_url} alt={evento.nome}
            className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span className="text-white/30 text-4xl">📅</span>
          </div>
        )}
      </div>

      {/* Dados */}
      <div className="flex-1 px-4 py-3 flex flex-col gap-2">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div>
            <p className="font-bold text-gray-800 text-sm leading-tight">{evento.nome}</p>
            <p className="text-xs text-gray-400 mt-0.5">
              📅 {fmtData(evento.data_inicio)} – {fmtData(evento.data_fim)}
            </p>
          </div>
          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${DEPT_BADGE[evento.departamento] ?? DEPT_BADGE.AVULSO}`}>
            {evento.departamento}
          </span>
        </div>

        {/* Stats em linha */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <MiniStat label="Inscritos"   value={String(evento.total_inscritos)} />
          <MiniStat label="Presentes"   value={String(evento.presentes)} />
          <MiniStat label="Arrecadado"  value={fmtMoeda(evento.arrecadacao)} />
          <MiniStat label="Hospedagem"  value={`${evento.hospedagem_usada}${evento.limite_hospedagem ? `/${evento.limite_hospedagem}` : ''}`} />
        </div>

        {/* Barra de presença */}
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div className={`h-full rounded-full transition-all ${pctCor}`} style={{ width: `${pct}%` }} />
          </div>
          <span className="text-[11px] text-gray-500 font-semibold whitespace-nowrap">{pct}% presença</span>
        </div>
      </div>

      {/* Botões */}
      <div className="flex sm:flex-col gap-2 px-3 py-3 border-t sm:border-t-0 sm:border-l border-gray-100 justify-end sm:justify-center">
        <button onClick={() => onAbrir(evento.id)}
          className="text-xs bg-[#123b63] hover:bg-[#0f2a45] text-white px-3 py-1.5 rounded-lg font-bold transition whitespace-nowrap">
          Gerenciar
        </button>
        <button onClick={() => window.open(`/display/${evento.slug}`, '_blank')}
          className="text-xs border border-gray-200 text-gray-600 hover:bg-gray-50 px-3 py-1.5 rounded-lg font-bold transition whitespace-nowrap">
          📺 Display
        </button>
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide">{label}</p>
      <p className="text-sm font-bold text-gray-700 truncate">{value}</p>
    </div>
  );
}

// ── Dept Card ────────────────────────────────────────────────
function DeptCard({ dept }: { dept: DeptStats }) {
  const cor = DEPT_CORES[dept.dept] ?? '#6B7280';
  const presencaPct = dept.inscritos > 0 ? Math.round((dept.presentes / dept.inscritos) * 100) : 0;

  return (
    <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
      {/* Header colorido */}
      <div className="px-4 py-3 flex items-center justify-between" style={{ backgroundColor: cor }}>
        <span className="font-black text-white text-base">{dept.dept}</span>
        <span className="text-white/70 text-xs font-semibold">
          {dept.total_eventos} evento{dept.total_eventos !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="px-4 py-3 space-y-2.5">
        <div className="grid grid-cols-3 gap-2">
          <DeptStatItem label="Inscritos"  value={dept.inscritos} />
          <DeptStatItem label="Presentes"  value={dept.presentes} />
          <DeptStatItem label="Pendências" value={dept.pendencias} alert={dept.pendencias > 10} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <DeptStatItem label="Hospedagem" value={dept.hospedagem} />
          <DeptStatItem label="Arrecadado" value={fmtMoeda(dept.arrecadacao)} isText />
        </div>
        {/* Barra de presença */}
        <div className="flex items-center gap-2 pt-1">
          <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${presencaPct}%`, backgroundColor: cor }}
            />
          </div>
          <span className="text-[11px] text-gray-400 font-semibold">{presencaPct}%</span>
        </div>
      </div>
    </div>
  );
}

function DeptStatItem({ label, value, alert, isText }: {
  label: string; value: number | string; alert?: boolean; isText?: boolean;
}) {
  return (
    <div>
      <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide">{label}</p>
      <p className={`font-bold ${isText ? 'text-xs' : 'text-base'} ${alert ? 'text-amber-600' : 'text-gray-800'} leading-tight`}>
        {value}
        {alert && <span className="ml-1 text-amber-400 text-xs">⚠️</span>}
      </p>
    </div>
  );
}

// ── Chart Card ───────────────────────────────────────────────
function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-5">
      <p className="text-sm font-bold text-gray-600 mb-4">{title}</p>
      {children}
    </div>
  );
}
