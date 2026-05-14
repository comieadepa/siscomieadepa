'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Clock,
  DollarSign,
  TrendingDown,
  Users,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  CartesianGrid,
  Legend,
} from 'recharts';
import PageLayout from '@/components/PageLayout';
import AccessRestricted from '@/components/AccessRestricted';
import { useRequireSupabaseAuth } from '@/hooks/useRequireSupabaseAuth';
import { useUserRole } from '@/hooks/useUserRole';
import { canAccessModule } from '@/lib/auth/roles';
import { createClient } from '@/lib/supabase-client';

type Kpis = {
  totalMinistros: number;
  ministrosComDebito: number;
  ministrosSemDebito: number;
  totalDebitoGeral: number;
  inadimplencia: number;
  totalNaoRegistrado: number;
  totalMinistrosRegistrados: number;
};

type SituacaoItem = { label: string; value: number };

type PorAnoItem = { ano: number; totalDevedores: number; totalValor: number };

type SupervisaoItem = {
  supervisao: string;
  totalDevedores: number;
  totalValor: number;
  percentual: number;
};

type MaiorDebito = {
  nome: string;
  supervisao: string;
  anos: number[];
  total: number;
  status: string;
  registro: string | null;
};

type Alertas = {
  maiorDebito: { nome: string; total: number; supervisao: string; anos: number[] } | null;
  supervisaoMaiorDebito: { supervisao: string; total: number; totalDevedores: number } | null;
  debitosAntigos: number;
  naoRegistrados: number;
  ultimaAtualizacao: string | null;
};

type DashboardData = {
  kpis: Kpis;
  situacao: SituacaoItem[];
  porAno: PorAnoItem[];
  porSupervisao: SupervisaoItem[];
  maioresDebitos: MaiorDebito[];
  supervisoesCriticas: SupervisaoItem[];
  alertas: Alertas;
};

const CORES_SITUACAO = ['#dc2626', '#16a34a', '#f59e0b'];
const COR_PRINCIPAL = '#123b63';

const fmtCurrency = (value: number) =>
  Number.isFinite(value)
    ? value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
    : 'R$ 0,00';

const fmtCurrencyShort = (value: number) => {
  if (!Number.isFinite(value)) return 'R$ 0';
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `R$ ${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `R$ ${(value / 1_000).toFixed(0)}K`;
  return `R$ ${value.toFixed(0)}`;
};

const fmtNumber = (value: number) =>
  Number.isFinite(value) ? value.toLocaleString('pt-BR') : '0';

const fmtPercent = (value: number) =>
  Number.isFinite(value) ? `${value.toFixed(1)}%` : '0%';

const fmtDateTime = (value: string | null) => {
  if (!value) return 'Nao informado';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 'Nao informado';
  return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
};

const getStatusStyle = (status: string) => {
  const s = status.toLowerCase();
  if (s.includes('pago') || s.includes('quit')) return 'bg-emerald-100 text-emerald-700';
  if (s.includes('atras') || s.includes('venc')) return 'bg-red-100 text-red-700';
  if (s.includes('pend') || s.includes('aberto')) return 'bg-amber-100 text-amber-700';
  return 'bg-gray-100 text-gray-600';
};

function KpiCard({
  icon: Icon,
  label,
  value,
  helper,
  color = COR_PRINCIPAL,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  helper?: string;
  color?: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{label}</span>
        <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${color}18` }}>
          <Icon size={18} style={{ color }} />
        </div>
      </div>
      <div className="mt-3">
        <p className="text-2xl font-bold text-gray-800 leading-tight">{value}</p>
        {helper && <p className="text-xs text-gray-400 mt-1">{helper}</p>}
      </div>
    </div>
  );
}

function TooltipAno({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value: number; payload: PorAnoItem }>;
  label?: string | number;
}) {
  if (!active || !payload?.length) return null;
  const entry = payload[0].payload;
  return (
    <div className="bg-white border border-gray-200 shadow-lg rounded-lg px-3 py-2 text-xs">
      <p className="font-bold text-gray-700 mb-1">Ano {label}</p>
      <p className="text-gray-600">Total: {fmtCurrency(entry.totalValor)}</p>
      <p className="text-gray-600">Devedores: {fmtNumber(entry.totalDevedores)}</p>
    </div>
  );
}

function TooltipSituacao({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number }>
}) {
  if (!active || !payload?.length) return null;
  const item = payload[0];
  return (
    <div className="bg-white border border-gray-200 shadow-lg rounded-lg px-3 py-2 text-xs">
      <p className="font-bold text-gray-700 mb-1">{item.name}</p>
      <p className="text-gray-600">{fmtNumber(item.value)}</p>
    </div>
  );
}

export default function CgadbDashboard() {
  const { loading: authLoading } = useRequireSupabaseAuth();
  const { role, loading: roleLoading } = useUserRole();
  const supabase = createClient();
  const podeAcessar = canAccessModule(role, 'cgadb');
  const anoLimite = new Date().getFullYear() - 2;

  const [data, setData] = useState<DashboardData | null>(null);
  const [loadingData, setLoadingData] = useState(true);
  const [reloading, setReloading] = useState(false);
  const [erro, setErro] = useState('');
  const initialLoaded = useRef(false);

  const getToken = useCallback(async () => {
    const { data: s } = await supabase.auth.getSession();
    return s.session?.access_token ?? '';
  }, [supabase]);

  const loadDashboard = useCallback(async (isReload = false) => {
    if (isReload) setReloading(true);
    else {
      setLoadingData(true);
      setData(null);
    }
    setErro('');
    try {
      const token = await getToken();
      const res = await fetch('/api/secretaria/cgadb/dashboard', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok) {
        setErro(json.error ?? 'Erro ao carregar dashboard.');
        setData(null);
      } else {
        setData(json as DashboardData);
      }
    } catch {
      setErro('Falha de conexao. Verifique sua internet e tente novamente.');
    } finally {
      setLoadingData(false);
      setReloading(false);
    }
  }, [getToken]);

  useEffect(() => {
    if (!authLoading && !roleLoading && podeAcessar) {
      initialLoaded.current = true;
      loadDashboard(false);
    }
  }, [authLoading, roleLoading, podeAcessar, loadDashboard]);

  if (authLoading || roleLoading) {
    return (
      <PageLayout title="CGADB" description="" activeMenu="cgadb-dashboard">
        <div className="flex items-center justify-center py-20 text-gray-400 text-sm">Carregando...</div>
      </PageLayout>
    );
  }

  if (!podeAcessar) {
    return (
      <PageLayout title="CGADB" description="" activeMenu="cgadb-dashboard">
        <AccessRestricted message="Voce nao tem permissao para acessar o modulo CGADB." />
      </PageLayout>
    );
  }

  const k = data?.kpis;
  const alertas = data?.alertas;

  return (
    <PageLayout title="CGADB" description="Dashboard de debitos e situacao ministerial" activeMenu="cgadb-dashboard">
      {reloading && (
        <div className="fixed inset-0 z-40 bg-white/40 backdrop-blur-[1px] flex items-start justify-center pt-24 pointer-events-none">
          <div className="bg-white shadow-lg rounded-xl px-5 py-3 flex items-center gap-2 text-sm font-semibold text-[#123b63] border border-blue-100">
            <svg className="animate-spin w-4 h-4 text-[#123b63]" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
            </svg>
            Atualizando dados...
          </div>
        </div>
      )}

      <div className="w-full max-w-7xl mx-auto space-y-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-widest text-gray-400 mr-2">Modulo CGADB</span>
          <span className="px-4 py-1.5 rounded-full text-xs font-semibold bg-[#123b63] text-white shadow-sm">Dashboard</span>
          <Link
            href="/secretaria/cgadb/debitos"
            className="px-4 py-1.5 rounded-full text-xs font-semibold border border-gray-300 text-gray-600 hover:bg-gray-50 transition"
          >
            Debitos
          </Link>
          <Link
            href="/secretaria/cgadb/debitos?tab=ministros"
            className="px-4 py-1.5 rounded-full text-xs font-semibold border border-gray-300 text-gray-600 hover:bg-gray-50 transition"
          >
            Ministros
          </Link>
        </div>

        <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-[#0d2b4e] via-[#123b63] to-[#1a5f9e] text-white p-6">
          <div className="absolute -top-10 -right-12 w-44 h-44 bg-white/10 rounded-full blur-2xl" />
          <div className="absolute -bottom-16 left-6 w-52 h-52 bg-white/10 rounded-full blur-2xl" />
          <div className="relative flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-white/70">Radar CGADB</p>
              <h2 className="text-2xl md:text-3xl font-bold">Monitoramento de debitos e registros</h2>
              <p className="text-sm text-white/80 mt-1">Atualizacao: {fmtDateTime(alertas?.ultimaAtualizacao ?? null)}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => loadDashboard(true)}
                disabled={reloading}
                className="px-4 py-2 rounded-lg bg-white text-[#123b63] text-xs font-semibold hover:bg-white/90 transition disabled:opacity-60"
              >
                {reloading ? 'Atualizando...' : 'Atualizar dados'}
              </button>
              <Link
                href="/secretaria/cgadb/debitos"
                className="px-4 py-2 rounded-lg bg-white/10 border border-white/20 text-white text-xs font-semibold hover:bg-white/20 transition"
              >
                Abrir debitos
              </Link>
            </div>
          </div>

          <div className="relative mt-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-white/10 border border-white/15 rounded-xl px-4 py-3">
              <p className="text-xs text-white/70">Inadimplencia</p>
              <p className="text-lg font-bold">{fmtPercent(k?.inadimplencia ?? 0)}</p>
            </div>
            <div className="bg-white/10 border border-white/15 rounded-xl px-4 py-3">
              <p className="text-xs text-white/70">Total devido</p>
              <p className="text-lg font-bold">{fmtCurrencyShort(k?.totalDebitoGeral ?? 0)}</p>
            </div>
            <div className="bg-white/10 border border-white/15 rounded-xl px-4 py-3">
              <p className="text-xs text-white/70">Nao registrados</p>
              <p className="text-lg font-bold">{fmtNumber(k?.totalNaoRegistrado ?? 0)}</p>
            </div>
            <div className="bg-white/10 border border-white/15 rounded-xl px-4 py-3">
              <p className="text-xs text-white/70">Ministros ativos</p>
              <p className="text-lg font-bold">{fmtNumber(k?.totalMinistros ?? 0)}</p>
            </div>
          </div>
        </div>

        {erro && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-4 flex items-start gap-3">
            <AlertTriangle size={18} className="text-red-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-bold text-red-700">Erro ao carregar dashboard</p>
              <p className="text-sm text-red-600 mt-0.5">{erro}</p>
              <button
                onClick={() => loadDashboard(false)}
                className="mt-2 text-xs font-semibold text-red-700 underline hover:no-underline"
              >
                Tentar novamente
              </button>
            </div>
          </div>
        )}

        {loadingData ? (
          <div className="space-y-6 animate-pulse">
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="bg-white rounded-xl border border-gray-100 p-4 h-28">
                  <div className="h-2.5 bg-gray-100 rounded w-3/4 mb-4" />
                  <div className="h-7 bg-gray-200 rounded w-1/2 mb-2" />
                  <div className="h-2 bg-gray-100 rounded w-2/3" />
                </div>
              ))}
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="lg:col-span-2 bg-white rounded-xl border border-gray-100 p-5 h-[300px]" />
              <div className="bg-white rounded-xl border border-gray-100 p-5 h-[300px]" />
            </div>
            <div className="bg-white rounded-xl border border-gray-100 p-5 h-[260px]" />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
              <KpiCard
                icon={Users}
                label="Ministros ativos"
                value={fmtNumber(k?.totalMinistros ?? 0)}
                helper={`Registrados: ${fmtNumber(k?.totalMinistrosRegistrados ?? 0)}`}
              />
              <KpiCard
                icon={AlertTriangle}
                label="Com debito"
                value={fmtNumber(k?.ministrosComDebito ?? 0)}
                helper="Debitos em aberto"
                color="#dc2626"
              />
              <KpiCard
                icon={CheckCircle2}
                label="Sem debito"
                value={fmtNumber(k?.ministrosSemDebito ?? 0)}
                helper="Regularizados"
                color="#16a34a"
              />
              <KpiCard
                icon={DollarSign}
                label="Total devido"
                value={fmtCurrencyShort(k?.totalDebitoGeral ?? 0)}
                helper="Somatorio geral"
              />
              <KpiCard
                icon={TrendingDown}
                label="Inadimplencia"
                value={fmtPercent(k?.inadimplencia ?? 0)}
                helper="Sobre o total"
                color="#f59e0b"
              />
              <KpiCard
                icon={BarChart3}
                label="Nao registrados"
                value={fmtNumber(k?.totalNaoRegistrado ?? 0)}
                helper="Sem CGADB"
                color="#7c3aed"
              />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="lg:col-span-2 bg-white rounded-xl border border-gray-100 p-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-sm font-bold text-gray-800">Debitos por ano</h3>
                    <p className="text-xs text-gray-500">Evolucao de valores e devedores</p>
                  </div>
                </div>
                {data?.porAno?.length ? (
                  <div className="h-[260px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={data.porAno} margin={{ left: 10, right: 20, top: 10, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis dataKey="ano" tick={{ fill: '#64748b', fontSize: 11 }} />
                        <YAxis
                          tickFormatter={(v) => fmtCurrencyShort(Number(v))}
                          tick={{ fill: '#64748b', fontSize: 11 }}
                        />
                        <Tooltip content={<TooltipAno />} />
                        <Bar dataKey="totalValor" name="Total" fill={COR_PRINCIPAL} radius={[6, 6, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-[260px] text-sm text-gray-400">
                    Sem dados para exibir
                  </div>
                )}
              </div>

              <div className="bg-white rounded-xl border border-gray-100 p-5">
                <div className="mb-4">
                  <h3 className="text-sm font-bold text-gray-800">Situacao dos ministros</h3>
                  <p className="text-xs text-gray-500">Distribuicao geral</p>
                </div>
                {data?.situacao?.length ? (
                  <div className="h-[260px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={data.situacao}
                          dataKey="value"
                          nameKey="label"
                          innerRadius={55}
                          outerRadius={90}
                          paddingAngle={3}
                        >
                          {data.situacao.map((_, index) => (
                            <Cell key={`cell-${index}`} fill={CORES_SITUACAO[index % CORES_SITUACAO.length]} />
                          ))}
                        </Pie>
                        <Tooltip content={<TooltipSituacao />} />
                        <Legend verticalAlign="bottom" height={36} iconType="circle" />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-[260px] text-sm text-gray-400">
                    Sem dados para exibir
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="lg:col-span-2 bg-white rounded-xl border border-gray-100 p-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-sm font-bold text-gray-800">Supervisoes criticas</h3>
                    <p className="text-xs text-gray-500">Maior concentracao de debitos</p>
                  </div>
                  <span className="text-xs text-gray-400">Top 10</span>
                </div>
                {data?.supervisoesCriticas?.length ? (
                  <div className="space-y-3">
                    {data.supervisoesCriticas.map((item, idx) => {
                      const percentual = Number.isFinite(item.percentual) ? item.percentual : 0;
                      return (
                        <div key={`${item.supervisao}-${idx}`}>
                          <div className="flex items-center justify-between text-sm">
                            <span className="font-semibold text-gray-700">{item.supervisao}</span>
                            <span className="text-gray-500">{fmtCurrencyShort(item.totalValor)}</span>
                          </div>
                          <div className="mt-1 h-2 rounded-full bg-gray-100 overflow-hidden">
                            <div
                              className="h-2 rounded-full bg-[#123b63]"
                              style={{ width: `${Math.min(100, percentual)}%` }}
                            />
                          </div>
                          <div className="mt-1 text-xs text-gray-400">
                            {fmtNumber(item.totalDevedores)} ministro(s) | {percentual.toFixed(1)}%
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-[200px] text-sm text-gray-400">
                    Sem supervisoes com debitos
                  </div>
                )}
              </div>

              <div className="bg-white rounded-xl border border-gray-100 p-5">
                <div className="mb-4">
                  <h3 className="text-sm font-bold text-gray-800">Alertas do periodo</h3>
                  <p className="text-xs text-gray-500">Foco imediato de atuacao</p>
                </div>
                <div className="space-y-3">
                  <div className="p-3 rounded-xl bg-red-50 border border-red-100">
                    <div className="flex items-center gap-2 text-sm font-semibold text-red-700">
                      <AlertTriangle size={16} /> Maior debito
                    </div>
                    <p className="text-xs text-red-600 mt-1">
                      {alertas?.maiorDebito
                        ? `${alertas.maiorDebito.nome} - ${fmtCurrencyShort(alertas.maiorDebito.total)}`
                        : 'Nenhum debito registrado'}
                    </p>
                    {alertas?.maiorDebito?.supervisao && (
                      <p className="text-[11px] text-red-500 mt-1">Supervisao: {alertas.maiorDebito.supervisao}</p>
                    )}
                  </div>
                  <div className="p-3 rounded-xl bg-amber-50 border border-amber-100">
                    <div className="flex items-center gap-2 text-sm font-semibold text-amber-700">
                      <Clock size={16} /> Debitos antigos
                    </div>
                    <p className="text-xs text-amber-600 mt-1">
                      {fmtNumber(alertas?.debitosAntigos ?? 0)} ministro(s) com debitos ate {anoLimite}
                    </p>
                  </div>
                  <div className="p-3 rounded-xl bg-blue-50 border border-blue-100">
                    <div className="flex items-center gap-2 text-sm font-semibold text-blue-700">
                      <Users size={16} /> Nao registrados
                    </div>
                    <p className="text-xs text-blue-600 mt-1">
                      {fmtNumber(alertas?.naoRegistrados ?? 0)} ministro(s) sem CGADB
                    </p>
                    <Link
                      href="/secretaria/cgadb/debitos?tab=ministros&naoRegistrados=1"
                      className="text-[11px] text-blue-600 underline mt-1 inline-block"
                    >
                      Revisar nao registrados
                    </Link>
                  </div>
                  <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-100">
                    <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700">
                      <CheckCircle2 size={16} /> Supervisao critica
                    </div>
                    <p className="text-xs text-emerald-600 mt-1">
                      {alertas?.supervisaoMaiorDebito
                        ? `${alertas.supervisaoMaiorDebito.supervisao} (${fmtCurrencyShort(alertas.supervisaoMaiorDebito.total)})`
                        : 'Nenhuma supervisao com debitos'}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
              <div className="xl:col-span-2 bg-white rounded-xl border border-gray-100 p-5 overflow-x-auto">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-sm font-bold text-gray-800">Maiores debitos</h3>
                    <p className="text-xs text-gray-500">Top 10 ministros com maior saldo</p>
                  </div>
                  <Link
                    href="/secretaria/cgadb/debitos?tab=ministros"
                    className="text-xs font-semibold text-blue-600 hover:underline"
                  >
                    Ver lista completa
                  </Link>
                </div>
                {data?.maioresDebitos?.length ? (
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase text-gray-500 border-b">
                        <th className="py-2 pr-4">Ministro</th>
                        <th className="py-2 pr-4">Supervisao</th>
                        <th className="py-2 pr-4">Anos</th>
                        <th className="py-2 pr-4">Total</th>
                        <th className="py-2 pr-4">Status</th>
                        <th className="py-2">Registro</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.maioresDebitos.map((item, idx) => (
                        <tr key={`${item.nome}-${idx}`} className="border-b last:border-b-0">
                          <td className="py-2 pr-4 font-semibold text-gray-700">{item.nome}</td>
                          <td className="py-2 pr-4 text-gray-500">{item.supervisao}</td>
                          <td className="py-2 pr-4 text-gray-500">
                            {item.anos?.length ? item.anos.join(', ') : '-'}
                          </td>
                          <td className="py-2 pr-4 font-semibold text-gray-700">{fmtCurrencyShort(item.total)}</td>
                          <td className="py-2 pr-4">
                            <span className={`text-[11px] font-semibold px-2 py-1 rounded-full ${getStatusStyle(item.status)}`}>
                              {item.status || '-'}
                            </span>
                          </td>
                          <td className="py-2 text-gray-500">{item.registro || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="flex items-center justify-center h-[180px] text-sm text-gray-400">
                    Nenhum debito registrado
                  </div>
                )}
              </div>

              <div className="bg-white rounded-xl border border-gray-100 p-5">
                <div className="mb-4">
                  <h3 className="text-sm font-bold text-gray-800">Acoes rapidas</h3>
                  <p className="text-xs text-gray-500">Fluxos principais do modulo</p>
                </div>
                <div className="space-y-2">
                  <Link
                    href="/secretaria/cgadb/debitos"
                    className="w-full inline-flex items-center justify-between px-4 py-3 rounded-lg border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                  >
                    Conferir debitos
                    <span className="text-xs text-gray-400">Ctrl</span>
                  </Link>
                  <Link
                    href="/secretaria/cgadb/debitos?tab=ministros"
                    className="w-full inline-flex items-center justify-between px-4 py-3 rounded-lg border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                  >
                    Lista de ministros
                    <span className="text-xs text-gray-400">Lista</span>
                  </Link>
                  <Link
                    href="/secretaria/cgadb/debitos?tab=ministros&naoRegistrados=1"
                    className="w-full inline-flex items-center justify-between px-4 py-3 rounded-lg border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                  >
                    Nao registrados
                    <span className="text-xs text-gray-400">Foco</span>
                  </Link>
                </div>
                <div className="mt-4 rounded-xl bg-gray-50 border border-gray-200 p-4 text-xs text-gray-500">
                  <p className="font-semibold text-gray-700 mb-1">Observacao</p>
                  <p>
                    Use os filtros na tela de debitos para detalhar anos, status e campos com pendencias.
                  </p>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </PageLayout>
  );
}
