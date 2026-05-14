'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { ShieldCheck, ChevronLeft, ChevronRight, RefreshCw, Search, X, ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react';
import PageLayout from '@/components/PageLayout';
import AccessRestricted from '@/components/AccessRestricted';
import { createClient } from '@/lib/supabase-client';
import { useRequireSupabaseAuth } from '@/hooks/useRequireSupabaseAuth';
import { useUserRole } from '@/hooks/useUserRole';
import { canAccessModule } from '@/lib/auth/roles';
import { useAuditLog } from '@/hooks/useAuditLog';

// ─── Tipos ────────────────────────────────────────────────────────────────────
type LogItem = {
  id: string;
  user_id: string | null;
  usuario_email: string | null;
  acao: string | null;
  modulo: string | null;
  area: string | null;
  descricao: string | null;
  status: string;
  created_at: string;
  tabela_afetada: string | null;
  dados_anteriores: Record<string, unknown> | null;
  dados_novos: Record<string, unknown> | null;
  mensagem_erro: string | null;
  ip_address: string | null;
  user_agent: string | null;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
const TODAS_ACOES = [
  'criar_lancamento',
  'editar_lancamento',
  'excluir_lancamento',
  'imprimir_recibo',
  'imprimir_relatorio',
  'exportar_csv',
  'visualizar_historico',
  'visualizar_auditoria',
] as const;

const ACAO_LABEL: Record<string, string> = {
  criar_lancamento: 'Criação de Lançamento',
  editar_lancamento: 'Edição de Lançamento',
  excluir_lancamento: 'Exclusão de Lançamento',
  imprimir_recibo: 'Impressão de Recibo',
  imprimir_relatorio: 'Impressão de Relatorio',
  exportar_csv: 'Exportação CSV',
  visualizar_historico: 'Visualização do Histórico',
  visualizar_auditoria: 'Visualização da Auditoria',
};

const ACAO_COR: Record<string, string> = {
  criar_lancamento: 'bg-emerald-100 text-emerald-700',
  editar_lancamento: 'bg-blue-100 text-blue-700',
  excluir_lancamento: 'bg-red-100 text-red-700',
  imprimir_recibo: 'bg-indigo-100 text-indigo-700',
  imprimir_relatorio: 'bg-sky-100 text-sky-700',
  exportar_csv: 'bg-purple-100 text-purple-700',
  visualizar_historico: 'bg-gray-100 text-gray-600',
  visualizar_auditoria: 'bg-gray-100 text-gray-600',
};

const STATUS_COR: Record<string, string> = {
  sucesso: 'bg-emerald-100 text-emerald-700',
  erro: 'bg-red-100 text-red-700',
  aviso: 'bg-amber-100 text-amber-700',
};

const PERIODO_DIAS: Record<string, number | null> = {
  hoje: 0, '7dias': 7, '30dias': 30, '90dias': 90, todos: null,
};

const PAGE_SIZE = 30;

function fmtData(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function JsonBlock({ label, data, variant = 'neutral' }: { label: string; data: Record<string, unknown>; variant?: 'neutral' | 'antes' | 'depois' }) {
  const styles: Record<string, string> = {
    neutral: 'bg-gray-50 border-gray-100 text-gray-600',
    antes: 'bg-amber-50 border-amber-100 text-amber-800',
    depois: 'bg-emerald-50 border-emerald-100 text-emerald-800',
  };
  return (
    <div>
      <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">{label}</p>
      <pre className={`rounded-lg p-3 text-[10px] overflow-auto max-h-48 border ${styles[variant]}`}>
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────
export default function FinanceiroAuditoriaPage() {
  const supabase = createClient();
  const { loading: authLoading } = useRequireSupabaseAuth();
  const { role, loading: roleLoading } = useUserRole();
  const { registrarAcao } = useAuditLog();

  const [logs, setLogs] = useState<LogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState('');
  const [page, setPage] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const loggedView = useRef(false);

  // Filtros
  const [filtroAcao, setFiltroAcao] = useState('todos');
  const [filtroStatus, setFiltroStatus] = useState('todos');
  const [filtroPeriodo, setFiltroPeriodo] = useState('30dias');
  const [filtroUsuario, setFiltroUsuario] = useState('');
  const [filtroTabela, setFiltroTabela] = useState('');

  const podeAcessar = canAccessModule(role, 'auditoria');

  const carregarLogs = useCallback(async () => {
    try {
      setLoading(true);
      setErro('');
      setPage(0);

      let query = supabase
        .from('audit_logs')
        .select('id, user_id, usuario_email, acao, modulo, area, descricao, status, created_at, tabela_afetada, dados_anteriores, dados_novos, mensagem_erro, ip_address, user_agent')
        .eq('modulo', 'financeiro')
        .order('created_at', { ascending: false })
        .limit(1000);

      if (filtroAcao !== 'todos') query = query.eq('acao', filtroAcao);
      if (filtroStatus !== 'todos') query = query.eq('status', filtroStatus);
      if (filtroUsuario.trim()) query = query.ilike('usuario_email', `%${filtroUsuario.trim()}%`);
      if (filtroTabela.trim()) query = query.ilike('tabela_afetada', `%${filtroTabela.trim()}%`);

      const dias = PERIODO_DIAS[filtroPeriodo];
      if (dias !== null) {
        const d = new Date();
        if (dias === 0) d.setHours(0, 0, 0, 0);
        else d.setDate(d.getDate() - dias);
        query = query.gte('created_at', d.toISOString());
      }

      const { data, error } = await query;
      if (error) { setErro(error.message); return; }
      setLogs(data ?? []);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro inesperado');
    } finally {
      setLoading(false);
    }
  }, [supabase, filtroAcao, filtroStatus, filtroPeriodo, filtroUsuario, filtroTabela]);

  useEffect(() => {
    if (!authLoading && !roleLoading && podeAcessar) {
      carregarLogs();
    }
  }, [authLoading, roleLoading, podeAcessar, carregarLogs]);

  useEffect(() => {
    if (authLoading || roleLoading || !podeAcessar || loggedView.current) return;
    loggedView.current = true;
    void registrarAcao({
      acao: 'visualizar_auditoria',
      modulo: 'financeiro',
      descricao: 'Visualizou auditoria financeira',
    });
  }, [authLoading, roleLoading, podeAcessar, registrarAcao]);

  // Filtro local
  const logsFiltrados = busca.trim()
    ? logs.filter(l =>
        (l.descricao ?? '').toLowerCase().includes(busca.toLowerCase()) ||
        (l.usuario_email ?? '').toLowerCase().includes(busca.toLowerCase()) ||
        (l.tabela_afetada ?? '').toLowerCase().includes(busca.toLowerCase()) ||
        (l.ip_address ?? '').includes(busca)
      )
    : logs;

  const totalPages = Math.ceil(logsFiltrados.length / PAGE_SIZE);
  const paginated = logsFiltrados.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  // Estatísticas rápidas
  const totalErros = logs.filter(l => l.status === 'erro').length;
  const totalSucesso = logs.filter(l => l.status === 'sucesso').length;

  // ── Guards ──────────────────────────────────────────────────────────────────
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

  return (
    <PageLayout title="Financeiro" description="Auditoria do módulo financeiro" activeMenu="financeiro">
      <div className="w-full max-w-7xl mx-auto space-y-6">

        {/* ── Navegação ─────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-widest text-gray-400 mr-2">Módulo Financeiro</span>
          <Link href="/financeiro"
            className="px-4 py-1.5 rounded-full text-xs font-semibold border border-gray-300 text-gray-600 hover:bg-gray-50 transition">
            Dashboard
          </Link>
          <Link href="/financeiro/lancamentos"
            className="px-4 py-1.5 rounded-full text-xs font-semibold border border-gray-300 text-gray-600 hover:bg-gray-50 transition">
            Contribuição Estatutária
          </Link>
          <Link href="/financeiro/historico"
            className="px-4 py-1.5 rounded-full text-xs font-semibold border border-gray-300 text-gray-600 hover:bg-gray-50 transition">
            Histórico
          </Link>
          <span className="px-4 py-1.5 rounded-full text-xs font-semibold bg-[#123b63] text-white shadow-sm">
            Auditoria
          </span>
        </div>

        {/* ── Cabeçalho + Stats ─────────────────────────────────────── */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <ShieldCheck size={20} className="text-[#123b63]" />
              <h1 className="text-2xl font-bold text-[#123b63]">Auditoria Financeira</h1>
            </div>
            <p className="text-sm text-gray-500 mt-0.5">Rastreamento técnico completo de operações no módulo financeiro</p>
          </div>
          <button onClick={carregarLogs} disabled={loading}
            title="Atualizar auditoria"
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#123b63] text-white text-xs font-semibold hover:bg-[#0d2b4e] transition disabled:opacity-60">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Atualizar
          </button>
        </div>

        {/* Cards de resumo */}
        {!loading && logs.length > 0 && (
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
              <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">Total de Eventos</p>
              <p className="text-2xl font-bold text-[#123b63]">{logsFiltrados.length}</p>
            </div>
            <div className="bg-white rounded-xl border border-emerald-100 shadow-sm p-4">
              <p className="text-[10px] font-bold text-emerald-400 uppercase mb-1">Operações com Sucesso</p>
              <p className="text-2xl font-bold text-emerald-600">{totalSucesso}</p>
            </div>
            <div className={`rounded-xl border shadow-sm p-4 ${totalErros > 0 ? 'bg-red-50 border-red-100' : 'bg-white border-gray-100'}`}>
              <p className={`text-[10px] font-bold uppercase mb-1 ${totalErros > 0 ? 'text-red-400' : 'text-gray-400'}`}>Erros Registrados</p>
              <div className="flex items-center gap-2">
                <p className={`text-2xl font-bold ${totalErros > 0 ? 'text-red-600' : 'text-gray-400'}`}>{totalErros}</p>
                {totalErros > 0 && <AlertTriangle size={16} className="text-red-500" />}
              </div>
            </div>
          </div>
        )}

        {/* ── Filtros ───────────────────────────────────────────────── */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <label className="text-xs font-bold text-gray-500 uppercase block mb-1">Período</label>
              <select value={filtroPeriodo} onChange={e => setFiltroPeriodo(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-xs font-semibold text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white">
                <option value="hoje">Hoje</option>
                <option value="7dias">Últimos 7 dias</option>
                <option value="30dias">Últimos 30 dias</option>
                <option value="90dias">Últimos 90 dias</option>
                <option value="todos">Todos</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-bold text-gray-500 uppercase block mb-1">Ação</label>
              <select value={filtroAcao} onChange={e => setFiltroAcao(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-xs font-semibold text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white">
                <option value="todos">Todas</option>
                {TODAS_ACOES.map(a => (
                  <option key={a} value={a}>{ACAO_LABEL[a] ?? a}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-bold text-gray-500 uppercase block mb-1">Status</label>
              <select value={filtroStatus} onChange={e => setFiltroStatus(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-xs font-semibold text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white">
                <option value="todos">Todos</option>
                <option value="sucesso">Sucesso</option>
                <option value="erro">Erro</option>
                <option value="aviso">Aviso</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-bold text-gray-500 uppercase block mb-1">Usuário</label>
              <input type="text" placeholder="E-mail" value={filtroUsuario}
                onChange={e => setFiltroUsuario(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-300 w-40" />
            </div>
            <div>
              <label className="text-xs font-bold text-gray-500 uppercase block mb-1">Tabela</label>
              <input type="text" placeholder="Ex: contribuicoes..." value={filtroTabela}
                onChange={e => setFiltroTabela(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-300 w-44" />
            </div>
            <div className="flex-1 min-w-44">
              <label className="text-xs font-bold text-gray-500 uppercase block mb-1">Busca geral</label>
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input type="text" placeholder="Descrição, IP..." value={busca}
                  onChange={e => setBusca(e.target.value)}
                  className="border border-gray-300 rounded-lg pl-8 pr-8 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-300 w-full" />
                {busca && (
                  <button onClick={() => setBusca('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                    <X size={12} />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── Tabela técnica ────────────────────────────────────────── */}
        {erro && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">{erro}</div>
        )}

        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
            <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">
              {loading ? 'Carregando...' : `${logsFiltrados.length} evento${logsFiltrados.length !== 1 ? 's' : ''}`}
            </span>
            {totalPages > 1 && (
              <div className="flex items-center gap-2 text-xs font-semibold text-gray-600">
                <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                  className="p-1 rounded hover:bg-gray-100 disabled:opacity-40"><ChevronLeft size={14} /></button>
                <span>Pág. {page + 1} / {totalPages}</span>
                <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
                  className="p-1 rounded hover:bg-gray-100 disabled:opacity-40"><ChevronRight size={14} /></button>
              </div>
            )}
          </div>

          {loading ? (
            <div className="divide-y divide-gray-50 animate-pulse">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="px-5 py-3 flex gap-4">
                  <div className="h-3 bg-gray-100 rounded w-28" />
                  <div className="h-3 bg-gray-100 rounded w-20" />
                  <div className="h-3 bg-gray-100 rounded flex-1" />
                  <div className="h-3 bg-gray-100 rounded w-32" />
                  <div className="h-3 bg-gray-100 rounded w-20" />
                </div>
              ))}
            </div>
          ) : paginated.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-gray-400">
              <ShieldCheck size={36} className="opacity-30" />
              <p className="text-sm font-semibold">Nenhum evento encontrado</p>
              <p className="text-xs">Tente ajustar os filtros</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {paginated.map((log) => {
                const isExpanded = expandedId === log.id;
                const acaoCor = ACAO_COR[log.acao ?? ''] ?? 'bg-gray-100 text-gray-600';
                const statusCor = STATUS_COR[log.status] ?? 'bg-gray-100 text-gray-600';
                const temDetalhes = log.dados_anteriores || log.dados_novos || log.mensagem_erro || log.user_agent;

                return (
                  <div key={log.id} className={`hover:bg-gray-50/50 transition-colors ${log.status === 'erro' ? 'border-l-2 border-red-300' : ''}`}>
                    <div
                      className={`px-5 py-3 flex flex-wrap items-start gap-3 ${temDetalhes ? 'cursor-pointer' : ''}`}
                      onClick={() => temDetalhes && setExpandedId(isExpanded ? null : log.id)}
                    >
                      {/* Badges ação + status */}
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${acaoCor}`}>
                          {ACAO_LABEL[log.acao ?? ''] ?? log.acao ?? '—'}
                        </span>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${statusCor}`}>
                          {log.status}
                        </span>
                      </div>

                      {/* Descrição + metadados */}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-gray-800 truncate">{log.descricao ?? '(sem descrição)'}</p>
                        <div className="flex flex-wrap gap-3 mt-0.5">
                          <span className="text-[10px] text-gray-400 font-mono">{log.usuario_email ?? 'sistema'}</span>
                          {log.user_id && (
                            <span className="text-[10px] text-gray-300 font-mono">uid:{log.user_id.slice(0, 8)}…</span>
                          )}
                          {log.tabela_afetada && (
                            <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded font-mono">{log.tabela_afetada}</span>
                          )}
                          {log.ip_address && (
                            <span className="text-[10px] text-gray-400 font-mono">IP: {log.ip_address}</span>
                          )}
                        </div>
                      </div>

                      {/* Timestamp */}
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-[10px] text-gray-400 font-mono">{fmtData(log.created_at)}</span>
                        {temDetalhes && (
                          isExpanded
                            ? <ChevronUp size={13} className="text-gray-400" />
                            : <ChevronDown size={13} className="text-gray-400" />
                        )}
                      </div>
                    </div>

                    {/* Painel técnico expandido */}
                    {isExpanded && temDetalhes && (
                      <div className="px-5 pb-4 space-y-3 border-t border-gray-50">
                        {(log.dados_anteriores || log.dados_novos) && (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-3">
                            {log.dados_anteriores && (
                              <JsonBlock label="Estado Anterior" data={log.dados_anteriores} variant="antes" />
                            )}
                            {log.dados_novos && (
                              <JsonBlock label="Estado Novo" data={log.dados_novos} variant="depois" />
                            )}
                          </div>
                        )}
                        {log.mensagem_erro && (
                          <div className="pt-1">
                            <p className="text-[10px] font-bold text-red-400 uppercase mb-1">Stack / Mensagem de Erro</p>
                            <p className="bg-red-50 rounded-lg p-3 text-[10px] text-red-700 border border-red-100 font-mono whitespace-pre-wrap">{log.mensagem_erro}</p>
                          </div>
                        )}
                        {log.user_agent && (
                          <div className="pt-1">
                            <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">User Agent</p>
                            <p className="bg-gray-50 rounded-lg p-3 text-[10px] text-gray-500 border border-gray-100 font-mono break-all">{log.user_agent}</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {totalPages > 1 && !loading && paginated.length > 0 && (
            <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between">
              <span className="text-xs text-gray-400">Exibindo {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, logsFiltrados.length)} de {logsFiltrados.length}</span>
              <div className="flex items-center gap-2 text-xs font-semibold text-gray-600">
                <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-40 transition">
                  <ChevronLeft size={13} /> Anterior
                </button>
                <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-40 transition">
                  Próxima <ChevronRight size={13} />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </PageLayout>
  );
}
