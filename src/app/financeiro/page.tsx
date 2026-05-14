'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import {
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import {
  TrendingUp, TrendingDown, DollarSign, Users, Building2,
  BarChart2, FileText, AlertTriangle, CheckCircle2, Clock,
  PlusCircle, Printer, Download, History, ArrowRight,
} from 'lucide-react';
import PageLayout from '@/components/PageLayout';
import AccessRestricted from '@/components/AccessRestricted';
import { createClient } from '@/lib/supabase-client';
import { useRequireSupabaseAuth } from '@/hooks/useRequireSupabaseAuth';
import { useUserRole } from '@/hooks/useUserRole';
import { canAccessModule } from '@/lib/auth/roles';
import { useAuditLog } from '@/hooks/useAuditLog';

// ─── Tipos ────────────────────────────────────────────────────────────────────
interface KPIs {
  totalAno: number; totalMes: number;
  totalAnoAnterior: number; totalMesAnterior: number;
  totalCampos: number; totalSupervisoes: number;
  mediaMonsal: number; totalRegistros: number;
  mesAtual: number; anoAtual: number;
}
interface MesData   { mes: number; label: string; total: number; totalAnterior: number; }
interface FormaData { forma: string; total: number; count: number; }
interface SupData   { nome: string; total: number; count: number; }
interface Recente {
  id: string; campo_nome: string; supervisao_nome: string;
  pastor_nome?: string | null; mes: number; ano: number;
  valor: number; forma_pagamento: string; created_at: string;
}
interface Inadimplentes {
  campos: string[]; supervisoes: string[];
  maiorContribuicaoMes: Recente | null;
}
interface DashData {
  kpis: KPIs; porMes: MesData[]; porForma: FormaData[];
  porSupervisao: SupData[]; recentes: Recente[];
  inadimplentes: Inadimplentes;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const MESES_FULL = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                    'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

const fmt = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const fmtShort = (v: number) =>
  v >= 1_000_000 ? `R$ ${(v / 1_000_000).toFixed(1)}M`
  : v >= 1_000   ? `R$ ${(v / 1_000).toFixed(1)}K`
  : fmt(v);

const pct = (atual: number, anterior: number): number | null => {
  if (anterior === 0) return null;
  return ((atual - anterior) / anterior) * 100;
};

const CORES_FORMA = ['#123b63','#F39C12','#27ae60','#e74c3c','#8e44ad','#2980b9'];
const COR_BAR_ATUAL    = '#123b63';
const COR_BAR_ANTERIOR = '#94a3b8';

// ─── Tooltip customizado ──────────────────────────────────────────────────────
const TooltipMoeda = ({ active, payload, label }: { active?: boolean; payload?: Array<{dataKey: string; color: string; name: string; value: number}>; label?: string }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-200 shadow-lg rounded-lg px-3 py-2 text-xs">
      <p className="font-bold text-gray-700 mb-1">{label}</p>
      {payload.map((p) => (
        <p key={p.dataKey} style={{ color: p.color }}>
          {p.name}: {fmt(p.value)}
        </p>
      ))}
    </div>
  );
};

// ─── KPI Card ─────────────────────────────────────────────────────────────────
function KpiCard({
  icon: Icon, label, value, sub, delta, cor = '#123b63',
}: {
  icon: React.ElementType; label: string; value: string;
  sub?: string; delta?: number | null; cor?: string;
}) {
  const positivo = delta !== null && delta !== undefined && delta >= 0;
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 flex flex-col gap-3 hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{label}</span>
        <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${cor}18` }}>
          <Icon size={18} style={{ color: cor }} />
        </div>
      </div>
      <div>
        <p className="text-2xl font-bold text-gray-800 leading-tight">{value}</p>
        {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
      </div>
      {delta !== null && delta !== undefined && (
        <div className={`flex items-center gap-1 text-xs font-semibold ${positivo ? 'text-emerald-600' : 'text-red-500'}`}>
          {positivo ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
          {Math.abs(delta).toFixed(1)}% vs ano anterior
        </div>
      )}
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────
export default function FinanceiroDashboard() {
  const { loading: authLoading } = useRequireSupabaseAuth();
  const { role, loading: roleLoading } = useUserRole();
  const supabase = createClient();
  const anoAtual = new Date().getFullYear();
  const { registrarAcao } = useAuditLog();

  const podeAcessar = canAccessModule(role, 'financeiro');

  const [ano, setAno]           = useState(anoAtual);
  const [data, setData]         = useState<DashData | null>(null);
  const [loadingData, setLoadingData] = useState(true);
  const [reloading, setReloading]     = useState(false);
  const [erro, setErro]         = useState('');
  const [acaoMsg, setAcaoMsg]   = useState<{ type: 'sucesso' | 'erro'; text: string } | null>(null);
  // ref para saber se a carga inicial já aconteceu
  const initialLoaded = useRef(false);

  const getToken = useCallback(async () => {
    const { data: s } = await supabase.auth.getSession();
    return s.session?.access_token ?? '';
  }, [supabase]);

  const imprimirRelatorio = useCallback(async () => {
    if (!data) return;
    const k = data.kpis;
    const dataEmissao = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
    const linhasTabela = data.porMes.map(m =>
      `<tr><td>${m.label}</td><td>R$ ${m.total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td><td>R$ ${m.totalAnterior.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td></tr>`
    ).join('');
    const linhasRecentes = data.recentes.map(r =>
      `<tr><td>${r.campo_nome}</td><td>${r.supervisao_nome || '—'}</td><td>${MESES_FULL[r.mes - 1]}/${r.ano}</td><td>R$ ${Number(r.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td><td>${r.forma_pagamento}</td></tr>`
    ).join('');
    const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Relatório Financeiro ${ano}</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:11px;color:#333;padding:30px}header{border-bottom:3px solid #123b63;padding-bottom:16px;margin-bottom:20px;display:flex;align-items:center;gap:20px}.logo-box{width:70px;height:70px;background:#123b63;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#F39C12;font-weight:bold;font-size:9px;text-align:center;padding:4px}.org{flex:1}.org h1{font-size:18px;font-weight:bold;color:#123b63}.org p{font-size:10px;color:#666;margin-top:2px}.badge{background:#F39C12;color:#fff;padding:4px 12px;border-radius:20px;font-size:10px;font-weight:bold;align-self:flex-start}h2{font-size:13px;font-weight:bold;color:#123b63;margin:20px 0 10px;border-bottom:1px solid #e2e8f0;padding-bottom:4px}.kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:8px}.kpi{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px}.kpi label{font-size:9px;font-weight:bold;text-transform:uppercase;color:#94a3b8}.kpi span{display:block;font-size:16px;font-weight:bold;color:#123b63;margin-top:4px}table{width:100%;border-collapse:collapse;margin-bottom:16px}th{background:#123b63;color:#fff;font-size:10px;padding:6px 8px;text-align:left}td{padding:5px 8px;border-bottom:1px solid #f1f5f9;font-size:10px}tr:nth-child(even) td{background:#f8fafc}footer{margin-top:24px;border-top:1px solid #e2e8f0;padding-top:10px;font-size:9px;color:#94a3b8;text-align:center}@media print{button{display:none}}</style></head><body><header><div class="logo-box">COMIEADEPA</div><div class="org"><h1>COMIEADEPA</h1><p>Convenção das Assembleias de Deus no Estado do Pará</p><p>Relatório Financeiro — Contribuições Estatutárias</p></div><div class="badge">Ano ${ano}</div></header><h2>Indicadores do Ano</h2><div class="kpis"><div class="kpi"><label>Total Arrecadado ${ano}</label><span>R$ ${k.totalAno.toLocaleString('pt-BR',{minimumFractionDigits:2})}</span></div><div class="kpi"><label>Campos Contribuintes</label><span>${k.totalCampos}</span></div><div class="kpi"><label>Supervisões Ativas</label><span>${k.totalSupervisoes}</span></div><div class="kpi"><label>Média Mensal</label><span>R$ ${k.mediaMonsal.toLocaleString('pt-BR',{minimumFractionDigits:2})}</span></div><div class="kpi"><label>Total de Registros</label><span>${k.totalRegistros}</span></div><div class="kpi"><label>Total Anterior (${ano - 1})</label><span>R$ ${k.totalAnoAnterior.toLocaleString('pt-BR',{minimumFractionDigits:2})}</span></div></div><h2>Arrecadação por Mês — ${ano} vs ${ano - 1}</h2><table><thead><tr><th>Mês</th><th>Total ${ano}</th><th>Total ${ano - 1}</th></tr></thead><tbody>${linhasTabela}</tbody></table><h2>Últimos Lançamentos</h2><table><thead><tr><th>Campo</th><th>Supervisão</th><th>Mês/Ano</th><th>Valor</th><th>Forma</th></tr></thead><tbody>${linhasRecentes}</tbody></table><footer>Gerado em ${dataEmissao} | COMIEADEPA — Sistema de Gestão</footer><script>window.onload=function(){window.print();}<\/script></body></html>`;
    const w = window.open('', '_blank', 'width=900,height=700');
    if (!w) {
      setAcaoMsg({ type: 'erro', text: 'Não foi possível abrir a janela de impressão. Verifique o bloqueador de pop-ups.' });
      return;
    }
    w.document.write(html);
    w.document.close();
    setAcaoMsg({ type: 'sucesso', text: 'Relatório enviado para impressão.' });
    void registrarAcao({
      acao: 'imprimir_relatorio',
      modulo: 'financeiro',
      descricao: `Impressão de relatório financeiro — ano ${ano}`,
      dados_novos: { ano, totalRegistros: k.totalRegistros },
    });
  }, [data, ano, registrarAcao]);

  const exportarCSV = useCallback(async () => {
    if (!data) return;
    try {
      const token = await getToken();
      const res = await fetch(`/api/financeiro/contribuicoes?ano=${ano}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok) {
        setAcaoMsg({ type: 'erro', text: `Erro ao exportar CSV: ${json.error ?? 'Falha desconhecida'}` });
        return;
      }
      const rows: unknown[] = json.data ?? [];
      const header = ['Ano','Mês','Supervisão','Campo','Pastor Presidente','Forma Pagamento','Valor','Data Registro'];
      const linhas = rows.map((r: unknown) => {
        const c = r as Record<string, unknown>;
        const mes = Number(c.mes);
        const valor = Number(c.valor ?? 0).toFixed(2).replace('.', ',');
        const data_reg = c.created_at ? new Date(c.created_at as string).toLocaleDateString('pt-BR') : '';
        return [c.ano, mes, c.supervisao_nome ?? '', c.campo_nome ?? '', c.pastor_nome ?? '', c.forma_pagamento ?? '', valor, data_reg]
          .map(v => `"${String(v).replace(/"/g, '""')}"`).join(';');
      });
      const csv = '\uFEFF' + [header.join(';'), ...linhas].join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `financeiro-comieadepa-${ano}.csv`;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a); URL.revokeObjectURL(url);
      setAcaoMsg({ type: 'sucesso', text: `CSV exportado com ${rows.length} registro(s).` });
      void registrarAcao({
        acao: 'exportar_csv',
        modulo: 'financeiro',
        descricao: `Exportação CSV — ${rows.length} registros — ano ${ano}`,
        dados_novos: { ano, totalRegistros: rows.length },
      });
    } catch {
      setAcaoMsg({ type: 'erro', text: 'Erro inesperado ao exportar CSV.' });
    }
  }, [data, ano, getToken, registrarAcao]);

  const loadDash = useCallback(async (isReload = false) => {
    if (isReload) { setReloading(true); }
    else { setLoadingData(true); setData(null); }
    setErro('');
    try {
      const token = await getToken();
      const res = await fetch(`/api/financeiro/dashboard?ano=${ano}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok) { setErro(json.error ?? 'Erro ao carregar dashboard.'); setData(null); }
      else setData(json as DashData);
    } catch {
      setErro('Falha de conexão. Verifique sua internet e tente novamente.');
    } finally {
      setLoadingData(false);
      setReloading(false);
    }
  }, [ano, getToken]);

  // Carga inicial após autenticação
  useEffect(() => {
    if (!authLoading && !roleLoading && podeAcessar) {
      initialLoaded.current = true;
      loadDash(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, roleLoading, podeAcessar]);

  // Reload ao trocar ano (apenas após carga inicial)
  useEffect(() => {
    if (initialLoaded.current) loadDash(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ano]);

  useEffect(() => {
    if (!acaoMsg) return;
    const t = setTimeout(() => setAcaoMsg(null), 4000);
    return () => clearTimeout(t);
  }, [acaoMsg]);

  // ── Guards ────────────────────────────────────────────────────────────
  if (authLoading || roleLoading) {
    return (
      <PageLayout title="Financeiro" description="" activeMenu="financeiro">
        <div className="flex items-center justify-center py-20 text-gray-400 text-sm">Carregando...</div>
      </PageLayout>
    );
  }
  if (!podeAcessar) {
    return (
      <PageLayout title="Financeiro" description="" activeMenu="financeiro">
        <AccessRestricted message="Você não tem permissão para acessar o módulo financeiro." />
      </PageLayout>
    );
  }

  const k = data?.kpis;

  return (
    <PageLayout title="Financeiro" description="Dashboard financeiro da organização" activeMenu="financeiro">
      {/* Overlay de reload suave */}
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

        {/* ── Navegação do módulo ──────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-widest text-gray-400 mr-2">Módulo Financeiro</span>
          <Link href="/financeiro"
            className="px-4 py-1.5 rounded-full text-xs font-semibold bg-[#123b63] text-white shadow-sm">
            Dashboard
          </Link>
          <Link href="/financeiro/lancamentos"
            className="px-4 py-1.5 rounded-full text-xs font-semibold border border-gray-300 text-gray-600 hover:bg-gray-50 transition">
            Contribuição Estatutária
          </Link>
        </div>

        {/* ── Cabeçalho + seletor de ano ───────────────────────────────── */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-[#123b63]">Dashboard Financeiro</h1>
            <p className="text-sm text-gray-500 mt-0.5">Visão executiva de arrecadação e desempenho</p>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-bold text-gray-500 uppercase">Ano</label>
            <select
              value={ano}
              onChange={e => setAno(Number(e.target.value))}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm font-semibold text-[#123b63] focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white"
            >
              {Array.from({ length: 6 }, (_, i) => anoAtual - i).map(a => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
            <button onClick={() => loadDash(true)}
              disabled={reloading}
              title="Atualizar dados do dashboard"
              className="px-3 py-1.5 rounded-lg bg-[#123b63] text-white text-xs font-semibold hover:bg-[#0d2b4e] transition disabled:opacity-60">
              {reloading ? 'Atualizando...' : 'Atualizar'}
            </button>
          </div>
        </div>

        {erro && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-4 flex items-start gap-3">
            <AlertTriangle size={18} className="text-red-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-bold text-red-700">Erro ao carregar dashboard</p>
              <p className="text-sm text-red-600 mt-0.5">{erro}</p>
              <button onClick={() => loadDash(false)}
                className="mt-2 text-xs font-semibold text-red-700 underline hover:no-underline">
                Tentar novamente
              </button>
            </div>
          </div>
        )}

        {acaoMsg && (
          <div className={`rounded-xl px-4 py-3 text-sm font-semibold border ${
            acaoMsg.type === 'sucesso'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
              : 'bg-red-50 border-red-200 text-red-700'
          }`}>
            {acaoMsg.text}
          </div>
        )}

        {loadingData ? (
          /* ─── Skeleton completo ─────────────────────────────────────── */
          <div className="space-y-6 animate-pulse">
            {/* KPI Cards */}
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="bg-white rounded-xl border border-gray-100 p-4 h-32">
                  <div className="h-2.5 bg-gray-100 rounded w-3/4 mb-4" />
                  <div className="h-7 bg-gray-200 rounded w-1/2 mb-2" />
                  <div className="h-2 bg-gray-100 rounded w-2/3" />
                </div>
              ))}
            </div>
            {/* Charts row 1 */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="lg:col-span-2 bg-white rounded-xl border border-gray-100 p-5 h-[310px]">
                <div className="h-3 bg-gray-100 rounded w-1/3 mb-6" />
                <div className="flex items-end gap-2 h-48 px-2">
                  {Array.from({ length: 12 }).map((_, i) => (
                    <div key={i} className="flex-1 flex flex-col gap-1 items-center justify-end">
                      <div className="w-full bg-gray-100 rounded-t" style={{ height: `${30 + Math.random() * 70}%` }} />
                      <div className="h-2 bg-gray-100 rounded w-full" />
                    </div>
                  ))}
                </div>
              </div>
              <div className="bg-white rounded-xl border border-gray-100 p-5 h-[310px]">
                <div className="h-3 bg-gray-100 rounded w-1/2 mb-6" />
                <div className="mx-auto w-32 h-32 rounded-full bg-gray-100 border-[18px] border-gray-200" />
                <div className="mt-4 space-y-2">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="flex justify-between">
                      <div className="h-2.5 bg-gray-100 rounded w-2/3" />
                      <div className="h-2.5 bg-gray-100 rounded w-1/6" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
            {/* Charts row 2 */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="lg:col-span-2 bg-white rounded-xl border border-gray-100 p-5 h-64">
                <div className="h-3 bg-gray-100 rounded w-1/3 mb-6" />
                <div className="space-y-3">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <div className="h-2.5 bg-gray-100 rounded w-24 flex-shrink-0" />
                      <div className="h-4 bg-gray-200 rounded flex-1" style={{ maxWidth: `${40 + i * 10}%` }} />
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-4">
                <div className="bg-gray-200 rounded-xl h-28" />
                <div className="bg-white rounded-xl border border-gray-100 p-4 flex-1 h-32">
                  <div className="h-3 bg-gray-100 rounded w-1/2 mb-4" />
                  <div className="space-y-2">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <div key={i} className="h-2.5 bg-gray-100 rounded w-5/6" />
                    ))}
                  </div>
                </div>
              </div>
            </div>
            {/* Table skeleton */}
            <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100">
                <div className="h-3 bg-gray-100 rounded w-1/4" />
              </div>
              <div className="divide-y divide-gray-50">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="px-5 py-3 flex gap-4">
                    <div className="h-3 bg-gray-100 rounded flex-1" />
                    <div className="h-3 bg-gray-100 rounded w-24" />
                    <div className="h-3 bg-gray-100 rounded w-16" />
                    <div className="h-3 bg-gray-200 rounded w-20" />
                    <div className="h-3 bg-gray-100 rounded w-16" />
                    <div className="h-3 bg-gray-100 rounded w-20" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : !data ? (
          /* ─── Estado vazio ──────────────────────────────────────────── */
          !erro && (
            <div className="flex flex-col items-center justify-center py-20 gap-4 text-gray-400">
              <BarChart2 size={48} className="opacity-30" />
              <p className="text-base font-semibold">Nenhum dado disponível para {ano}</p>
              <p className="text-sm">Não há lançamentos financeiros registrados neste período.</p>
              <Link href="/financeiro/lancamentos"
                className="mt-2 flex items-center gap-2 px-5 py-2 rounded-lg bg-[#123b63] text-white text-sm font-semibold hover:bg-[#0d2b4e] transition">
                <PlusCircle size={15} /> Registrar primeiro lançamento
              </Link>
            </div>
          )
        ) : (
          <>
            {/* ════════════════════════════════════════════════════════════
                KPI CARDS
            ════════════════════════════════════════════════════════════ */}
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
              <KpiCard
                icon={DollarSign} label="Total no Ano" cor="#123b63"
                value={fmtShort(k!.totalAno)}
                sub={`Ano ${k!.anoAtual}`}
                delta={pct(k!.totalAno, k!.totalAnoAnterior)}
              />
              <KpiCard
                icon={TrendingUp} label={`Total em ${MESES_FULL[k!.mesAtual - 1]}`} cor="#27ae60"
                value={fmtShort(k!.totalMes)}
                sub="Mês atual"
                delta={pct(k!.totalMes, k!.totalMesAnterior)}
              />
              <KpiCard
                icon={Building2} label="Campos Contribuintes" cor="#8e44ad"
                value={String(k!.totalCampos)}
                sub="campos ativos"
              />
              <KpiCard
                icon={Users} label="Supervisões Ativas" cor="#F39C12"
                value={String(k!.totalSupervisoes)}
                sub="supervisões"
              />
              <KpiCard
                icon={BarChart2} label="Média Mensal" cor="#2980b9"
                value={fmtShort(k!.mediaMonsal)}
                sub="por mês arrecadado"
              />
              <KpiCard
                icon={FileText} label="Total de Registros" cor="#e74c3c"
                value={String(k!.totalRegistros)}
                sub={`lançamentos em ${k!.anoAtual}`}
              />
            </div>

            {/* ════════════════════════════════════════════════════════════
                GRÁFICOS — linha 1
            ════════════════════════════════════════════════════════════ */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

              {/* Gráfico 1 — Arrecadação mensal */}
              <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-gray-100 p-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="font-bold text-gray-800 text-sm">Arrecadação Mensal</h2>
                    <p className="text-xs text-gray-400">{ano} vs {ano - 1}</p>
                  </div>
                  <BarChart2 size={16} className="text-gray-300" />
                </div>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={data.porMes} barSize={10} barGap={2}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                    <YAxis tickFormatter={v => fmtShort(v)} tick={{ fontSize: 9, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={60} />
                    <Tooltip content={<TooltipMoeda />} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    <Bar dataKey="totalAnterior" name={String(ano - 1)} fill={COR_BAR_ANTERIOR} radius={[3, 3, 0, 0]} />
                    <Bar dataKey="total"         name={String(ano)}     fill={COR_BAR_ATUAL}    radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Gráfico 2 — Formas de pagamento */}
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="font-bold text-gray-800 text-sm">Formas de Pagamento</h2>
                    <p className="text-xs text-gray-400">Distribuição por método</p>
                  </div>
                </div>
                {data.porForma.length === 0 ? (
                  <div className="flex items-center justify-center h-48 text-sm text-gray-400">Sem dados</div>
                ) : (
                  <>
                    <ResponsiveContainer width="100%" height={180}>
                      <PieChart>
                        <Pie
                          // eslint-disable-next-line @typescript-eslint/no-explicit-any
                          data={data.porForma as any[]} dataKey="total" nameKey="forma"
                          cx="50%" cy="50%" innerRadius={45} outerRadius={75}
                          paddingAngle={3}
                        >
                          {data.porForma.map((_, i) => (
                            <Cell key={i} fill={CORES_FORMA[i % CORES_FORMA.length]} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(v) => fmt(Number(v))} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="mt-2 space-y-1">
                      {data.porForma.map((f, i) => {
                        const perc = k!.totalAno > 0 ? (f.total / k!.totalAno) * 100 : 0;
                        return (
                          <div key={f.forma} className="flex items-center justify-between text-xs">
                            <div className="flex items-center gap-1.5">
                              <span className="w-2.5 h-2.5 rounded-full inline-block flex-shrink-0"
                                style={{ backgroundColor: CORES_FORMA[i % CORES_FORMA.length] }} />
                              <span className="text-gray-600 truncate max-w-[90px]">{f.forma}</span>
                            </div>
                            <span className="font-semibold text-gray-700">{perc.toFixed(1)}%</span>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* ════════════════════════════════════════════════════════════
                GRÁFICOS — linha 2 + ALERTAS
            ════════════════════════════════════════════════════════════ */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

              {/* Gráfico 3 — Top supervisões */}
              <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-gray-100 p-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="font-bold text-gray-800 text-sm">Arrecadação por Supervisão</h2>
                    <p className="text-xs text-gray-400">Top supervisões em {ano}</p>
                  </div>
                </div>
                {data.porSupervisao.length === 0 ? (
                  <div className="flex items-center justify-center h-48 text-sm text-gray-400">Sem dados</div>
                ) : (
                  <ResponsiveContainer width="100%" height={Math.max(160, data.porSupervisao.length * 32)}>
                    <BarChart
                      data={data.porSupervisao} layout="vertical" barSize={14}
                      margin={{ left: 8, right: 12 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                      <XAxis type="number" tickFormatter={v => fmtShort(v)} tick={{ fontSize: 9, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                      <YAxis dataKey="nome" type="category" tick={{ fontSize: 10, fill: '#374151' }} axisLine={false} tickLine={false} width={120} />
                      <Tooltip content={<TooltipMoeda />} />
                      <Bar dataKey="total" name="Total" fill={COR_BAR_ATUAL} radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>

              {/* Alertas e indicadores */}
              <div className="flex flex-col gap-4">

                {/* Maior contribuição do mês */}
                {data.inadimplentes.maiorContribuicaoMes && (
                  <div className="bg-gradient-to-br from-[#123b63] to-[#1a4f85] rounded-xl p-4 text-white">
                    <div className="flex items-center gap-2 mb-2">
                      <CheckCircle2 size={16} className="text-[#F39C12]" />
                      <span className="text-xs font-bold uppercase tracking-wide opacity-80">
                        Maior contribuição — {MESES_FULL[k!.mesAtual - 1]}
                      </span>
                    </div>
                    <p className="font-bold text-lg leading-tight">
                      {data.inadimplentes.maiorContribuicaoMes.campo_nome}
                    </p>
                    <p className="text-[#F39C12] font-bold text-xl mt-1">
                      {fmt(data.inadimplentes.maiorContribuicaoMes.valor)}
                    </p>
                    <p className="text-xs opacity-60 mt-1">
                      {data.inadimplentes.maiorContribuicaoMes.supervisao_nome}
                    </p>
                  </div>
                )}

                {/* Campos sem contribuição no mês */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 flex-1">
                  <div className="flex items-center gap-2 mb-3">
                    <AlertTriangle size={15} className="text-amber-500" />
                    <span className="text-xs font-bold text-gray-700 uppercase tracking-wide">
                      Pendências — {MESES_FULL[k!.mesAtual - 1]}
                    </span>
                  </div>
                  {data.inadimplentes.campos.length === 0 ? (
                    <div className="flex items-center gap-1.5 text-xs text-emerald-600 font-semibold">
                      <CheckCircle2 size={13} /> Todos os campos contribuíram!
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {data.inadimplentes.campos.slice(0, 6).map(c => (
                        <div key={c} className="flex items-center gap-1.5 text-xs text-gray-600">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />
                          <span className="truncate">{c}</span>
                        </div>
                      ))}
                      {data.inadimplentes.campos.length > 6 && (
                        <p className="text-xs text-gray-400 pt-1">
                          + {data.inadimplentes.campos.length - 6} outros
                        </p>
                      )}
                    </div>
                  )}
                  {data.inadimplentes.supervisoes.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-gray-100">
                      <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">Supervisões sem lançamento</p>
                      {data.inadimplentes.supervisoes.map(s => (
                        <div key={s} className="flex items-center gap-1.5 text-xs text-gray-500">
                          <span className="w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0" />
                          {s}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* ════════════════════════════════════════════════════════════
                ÚLTIMOS LANÇAMENTOS
            ════════════════════════════════════════════════════════════ */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="px-5 py-4 flex items-center justify-between border-b border-gray-100">
                <div className="flex items-center gap-2">
                  <Clock size={15} className="text-[#123b63]" />
                  <h2 className="font-bold text-gray-800 text-sm">Últimos Lançamentos</h2>
                </div>
                <Link href="/financeiro/lancamentos"
                  className="flex items-center gap-1 text-xs font-semibold text-[#123b63] hover:underline">
                  Ver todos <ArrowRight size={12} />
                </Link>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50 text-gray-500">
                      <th className="px-4 py-2.5 text-left font-semibold uppercase tracking-wide">Campo</th>
                      <th className="px-4 py-2.5 text-left font-semibold uppercase tracking-wide">Supervisão</th>
                      <th className="px-4 py-2.5 text-left font-semibold uppercase tracking-wide">Mês/Ano</th>
                      <th className="px-4 py-2.5 text-right font-semibold uppercase tracking-wide">Valor</th>
                      <th className="px-4 py-2.5 text-left font-semibold uppercase tracking-wide">Forma</th>
                      <th className="px-4 py-2.5 text-left font-semibold uppercase tracking-wide">Data</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recentes.length === 0 && (
                      <tr>
                        <td colSpan={6} className="text-center text-gray-400 py-8">Nenhum lançamento encontrado</td>
                      </tr>
                    )}
                    {data.recentes.map((r, i) => (
                      <tr key={r.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}>
                        <td className="px-4 py-2.5 font-semibold text-gray-800">{r.campo_nome}</td>
                        <td className="px-4 py-2.5 text-gray-500">{r.supervisao_nome || '—'}</td>
                        <td className="px-4 py-2.5 text-gray-600">{MESES_FULL[r.mes - 1].slice(0,3)}/{r.ano}</td>
                        <td className="px-4 py-2.5 text-right font-bold text-[#123b63]">{fmt(r.valor)}</td>
                        <td className="px-4 py-2.5">
                          <span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-semibold">
                            {r.forma_pagamento}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-gray-400">
                          {new Date(r.created_at).toLocaleDateString('pt-BR')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* ════════════════════════════════════════════════════════════
                ATALHOS RÁPIDOS
            ════════════════════════════════════════════════════════════ */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
              <h2 className="font-bold text-gray-700 text-sm mb-4 uppercase tracking-wide">Atalhos Rápidos</h2>
              <div className="flex flex-wrap gap-3">
                <Link href="/financeiro/lancamentos"
                  title="Criar novo lançamento"
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#123b63] text-white text-xs font-semibold hover:bg-[#0d2b4e] transition">
                  <PlusCircle size={14} /> Novo Lançamento
                </Link>
                <button onClick={imprimirRelatorio}
                  title="Imprimir relatório anual"
                  className="flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-xs font-semibold hover:bg-gray-50 transition">
                  <Printer size={14} /> Imprimir Relatório
                </button>
                <button onClick={exportarCSV}
                  title="Exportar CSV do ano selecionado"
                  className="flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-xs font-semibold hover:bg-gray-50 transition">
                  <Download size={14} /> Exportar CSV
                </button>
                <Link href="/financeiro/historico"
                  title="Ver histórico financeiro"
                  className="flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-xs font-semibold hover:bg-gray-50 transition">
                  <History size={14} /> Histórico
                </Link>
                <Link href="/financeiro/auditoria"
                  title="Abrir auditoria financeira"
                  className="flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-xs font-semibold hover:bg-gray-50 transition">
                  <FileText size={14} /> Auditoria
                </Link>
              </div>
            </div>
          </>
        )}
      </div>
    </PageLayout>
  );
}
