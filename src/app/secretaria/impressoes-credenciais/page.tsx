'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import PageLayout from '@/components/PageLayout';
import { authenticatedFetch } from '@/lib/api-client';
import {
  Printer,
  RefreshCw,
  Truck,
  Package,
  Clock,
  CheckCircle2,
  XCircle,
  Search,
  FilterX,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

interface ImpressaoItem {
  id: string;
  ministroId: string;
  ministroNome: string;
  cpf?: string | null;
  matricula: string;
  campo: string;
  supervisao: string;
  uniqueId: string | null;
  status: string;
  statusLabel: string;
  valor: number;
  asaasPaymentId: string | null;
  solicitadoEm: string;
  pagoEm: string | null;
  impresso_em: string | null;
  entregueEm: string | null;
}

const STATUS_COLOR: Record<string, string> = {
  aguardando_pagamento: 'bg-amber-50 text-amber-800 border-amber-200',
  pago_pendente_impressao: 'bg-blue-50 text-blue-800 border-blue-200',
  em_impressao: 'bg-indigo-50 text-indigo-800 border-indigo-200',
  impresso: 'bg-purple-50 text-purple-800 border-purple-200',
  entregue: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  cancelado: 'bg-slate-100 text-slate-600 border-slate-200',
};

const STATUS_OPTIONS = [
  { value: '', label: 'Todos os status' },
  { value: 'pago_pendente_impressao', label: 'Aguardando impressão' },
  { value: 'em_impressao', label: 'Em impressão' },
  { value: 'impresso', label: 'Impresso' },
  { value: 'entregue', label: 'Entregues' },
  { value: 'cancelado', label: 'Canceladas' },
  { value: 'aguardando_pagamento', label: 'Aguardando pagamento' },
];

const fmtDate = (v: string | null) => {
  if (!v) return '—';
  return new Date(v).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

export default function ImpressoesCredenciaisPage() {
  const [allItems, setAllItems] = useState<ImpressaoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [atualizando, setAtualizando] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Filtros
  const [busca, setBusca] = useState('');
  const [filtroCampo, setFiltroCampo] = useState('');
  const [filtroSupervisao, setFiltroSupervisao] = useState('');
  const [filtroStatus, setFiltroStatus] = useState('');
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');

  // Ordenação e paginação
  const [ordemData, setOrdemData] = useState<'desc' | 'asc'>('desc');
  const [pagina, setPagina] = useState(1);
  const [porPagina, setPorPagina] = useState(25);

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authenticatedFetch('/api/secretaria/impressoes-credenciais');
      const data = await res.json();
      setAllItems(Array.isArray(data?.data) ? data.data : []);
    } catch {
      setMsg({ type: 'error', text: 'Não foi possível carregar as solicitações de impressão.' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // Resetar para página 1 sempre que filtros ou ordenação mudarem
  useEffect(() => {
    setPagina(1);
  }, [busca, filtroCampo, filtroSupervisao, filtroStatus, dataInicio, dataFim, ordemData, porPagina]);

  const atualizarStatus = async (id: string, novoStatus: string) => {
    setAtualizando(id);
    setMsg(null);
    try {
      const res = await authenticatedFetch(`/api/secretaria/impressoes-credenciais/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: novoStatus }),
      });
      const json = await res.json();
      if (!res.ok) {
        setMsg({ type: 'error', text: json.error || 'Erro ao atualizar.' });
      } else {
        setMsg({ type: 'success', text: 'Status atualizado com sucesso.' });
        void carregar();
      }
    } catch {
      setMsg({ type: 'error', text: 'Erro de conexão.' });
    } finally {
      setAtualizando(null);
    }
  };

  // Indicadores reais
  const indicadores = useMemo(() => {
    let aguardando = 0;
    let emImpressao = 0;
    let entregues = 0;
    let canceladas = 0;
    for (const item of allItems) {
      if (item.status === 'pago_pendente_impressao') aguardando++;
      else if (item.status === 'em_impressao') emImpressao++;
      else if (item.status === 'entregue') entregues++;
      else if (item.status === 'cancelado') canceladas++;
    }
    return { aguardando, emImpressao, entregues, canceladas };
  }, [allItems]);

  // Opções dinâmicas de campo e supervisão
  const camposDisponiveis = useMemo(
    () => Array.from(new Set(allItems.map(i => i.campo).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [allItems]
  );
  const supervisoesDisponiveis = useMemo(
    () => Array.from(new Set(allItems.map(i => i.supervisao).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [allItems]
  );

  // Filtragem e ordenação
  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const qDigits = busca.replace(/\D/g, '');

    const rows = allItems.filter(item => {
      if (filtroStatus && item.status !== filtroStatus) return false;
      if (filtroCampo && item.campo !== filtroCampo) return false;
      if (filtroSupervisao && item.supervisao !== filtroSupervisao) return false;

      if (dataInicio || dataFim) {
        const dtStr = item.solicitadoEm ? item.solicitadoEm.slice(0, 10) : '';
        if (dataInicio && dtStr < dataInicio) return false;
        if (dataFim && dtStr > dataFim) return false;
      }

      if (q) {
        const nomeOk = item.ministroNome?.toLowerCase().includes(q);
        const matOk = item.matricula?.toLowerCase().includes(q);
        const cpfDigits = String(item.cpf ?? '').replace(/\D/g, '');
        const cpfOk = qDigits ? cpfDigits.includes(qDigits) : false;
        if (!nomeOk && !matOk && !cpfOk) return false;
      }

      return true;
    });

    rows.sort((a, b) => {
      const ta = a.solicitadoEm ? new Date(a.solicitadoEm).getTime() : 0;
      const tb = b.solicitadoEm ? new Date(b.solicitadoEm).getTime() : 0;
      return ordemData === 'desc' ? tb - ta : ta - tb;
    });

    return rows;
  }, [allItems, busca, filtroCampo, filtroSupervisao, filtroStatus, dataInicio, dataFim, ordemData]);

  const totalPaginas = Math.max(1, Math.ceil(filtrados.length / porPagina));
  const paginaAtual = Math.min(pagina, totalPaginas);
  const inicioIdx = (paginaAtual - 1) * porPagina;
  const paginados = filtrados.slice(inicioIdx, inicioIdx + porPagina);

  const temFiltroAtivo = Boolean(busca || filtroCampo || filtroSupervisao || filtroStatus || dataInicio || dataFim);

  const limparFiltros = () => {
    setBusca('');
    setFiltroCampo('');
    setFiltroSupervisao('');
    setFiltroStatus('');
    setDataInicio('');
    setDataFim('');
  };

  return (
    <PageLayout
      title="Impressões de Credenciais"
      description="Gestão institucional da fila de impressão e entrega de credenciais ministeriais"
      activeMenu="secretaria"
    >
      <div className="space-y-6">
        {/* Cabeçalho Institucional */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 shadow-sm flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#0D2B4E] text-[#D4AF37] shadow-sm">
              <Printer className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-lg sm:text-xl font-bold text-[#0D2B4E]">Central de Impressões de Credenciais</h1>
              <p className="text-xs sm:text-sm text-slate-500">
                Acompanhe solicitações, controle o fluxo de impressão e registre entregas aos ministros.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void carregar()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-[#0D2B4E] shadow-xs transition hover:bg-slate-50 disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Atualizar listagem
          </button>
        </div>

        {/* Cards de Indicadores Reais */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <button
            type="button"
            onClick={() => setFiltroStatus(filtroStatus === 'pago_pendente_impressao' ? '' : 'pago_pendente_impressao')}
            className={`text-left rounded-2xl border p-4 shadow-xs transition hover:shadow-md ${
              filtroStatus === 'pago_pendente_impressao'
                ? 'border-blue-400 bg-blue-50/70 ring-1 ring-blue-300'
                : 'border-slate-200 bg-white'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Aguardando impressão</span>
              <span className="rounded-lg bg-blue-100 p-2 text-blue-700">
                <Clock className="h-4 w-4" />
              </span>
            </div>
            <div className="mt-2 text-2xl font-bold text-[#0D2B4E]">{indicadores.aguardando}</div>
          </button>

          <button
            type="button"
            onClick={() => setFiltroStatus(filtroStatus === 'em_impressao' ? '' : 'em_impressao')}
            className={`text-left rounded-2xl border p-4 shadow-xs transition hover:shadow-md ${
              filtroStatus === 'em_impressao'
                ? 'border-indigo-400 bg-indigo-50/70 ring-1 ring-indigo-300'
                : 'border-slate-200 bg-white'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Em impressão</span>
              <span className="rounded-lg bg-indigo-100 p-2 text-indigo-700">
                <Package className="h-4 w-4" />
              </span>
            </div>
            <div className="mt-2 text-2xl font-bold text-[#0D2B4E]">{indicadores.emImpressao}</div>
          </button>

          <button
            type="button"
            onClick={() => setFiltroStatus(filtroStatus === 'entregue' ? '' : 'entregue')}
            className={`text-left rounded-2xl border p-4 shadow-xs transition hover:shadow-md ${
              filtroStatus === 'entregue'
                ? 'border-emerald-400 bg-emerald-50/70 ring-1 ring-emerald-300'
                : 'border-slate-200 bg-white'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Entregues</span>
              <span className="rounded-lg bg-emerald-100 p-2 text-emerald-700">
                <CheckCircle2 className="h-4 w-4" />
              </span>
            </div>
            <div className="mt-2 text-2xl font-bold text-[#0D2B4E]">{indicadores.entregues}</div>
          </button>

          <button
            type="button"
            onClick={() => setFiltroStatus(filtroStatus === 'cancelado' ? '' : 'cancelado')}
            className={`text-left rounded-2xl border p-4 shadow-xs transition hover:shadow-md ${
              filtroStatus === 'cancelado'
                ? 'border-slate-400 bg-slate-100 ring-1 ring-slate-300'
                : 'border-slate-200 bg-white'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Canceladas</span>
              <span className="rounded-lg bg-slate-100 p-2 text-slate-600">
                <XCircle className="h-4 w-4" />
              </span>
            </div>
            <div className="mt-2 text-2xl font-bold text-[#0D2B4E]">{indicadores.canceladas}</div>
          </button>
        </div>

        {/* Área de Filtros */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
            <div className="lg:col-span-2">
              <label className="block text-xs font-semibold text-slate-600 mb-1">Buscar ministro (Nome, CPF ou Matrícula)</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <input
                  type="text"
                  value={busca}
                  onChange={e => setBusca(e.target.value)}
                  placeholder="Digite nome, CPF ou matrícula..."
                  className="w-full rounded-xl border border-slate-200 pl-9 pr-3 py-2 text-sm focus:border-[#0D2B4E] focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Status</label>
              <select
                value={filtroStatus}
                onChange={e => setFiltroStatus(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm bg-white focus:border-[#0D2B4E] focus:outline-none"
              >
                {STATUS_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Campo Ministerial</label>
              <select
                value={filtroCampo}
                onChange={e => setFiltroCampo(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm bg-white focus:border-[#0D2B4E] focus:outline-none"
              >
                <option value="">Todos os campos</option>
                {camposDisponiveis.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Supervisão</label>
              <select
                value={filtroSupervisao}
                onChange={e => setFiltroSupervisao(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm bg-white focus:border-[#0D2B4E] focus:outline-none"
              >
                <option value="">Todas as supervisões</option>
                {supervisoesDisponiveis.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Solicitado de</label>
              <input
                type="date"
                value={dataInicio}
                onChange={e => setDataInicio(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-[#0D2B4E] focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Até</label>
              <input
                type="date"
                value={dataFim}
                onChange={e => setDataFim(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-[#0D2B4E] focus:outline-none"
              />
            </div>

            <div className="flex items-end">
              <button
                type="button"
                onClick={limparFiltros}
                disabled={!temFiltroAtivo}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-40 transition"
              >
                <FilterX className="h-4 w-4" />
                Limpar filtros
              </button>
            </div>
          </div>
        </div>

        {msg && (
          <div className={`rounded-xl px-4 py-3 text-sm font-medium ${
            msg.type === 'success'
              ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
              : 'bg-red-50 border border-red-200 text-red-700'
          }`}>
            {msg.text}
          </div>
        )}

        {/* Listagem Profissional */}
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="border-b border-slate-100 px-5 py-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-[#0D2B4E]">Solicitações Registradas</h2>
              <p className="text-xs text-slate-500">
                {filtrados.length} {filtrados.length === 1 ? 'registro encontrado' : 'registros encontrados'}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={() => setOrdemData(o => (o === 'desc' ? 'asc' : 'desc'))}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                <ArrowUpDown className="h-3.5 w-3.5 text-[#0D2B4E]" />
                {ordemData === 'desc' ? 'Mais recentes primeiro' : 'Mais antigas primeiro'}
              </button>

              <select
                value={porPagina}
                onChange={e => setPorPagina(Number(e.target.value))}
                aria-label="Registros por página"
                className="rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 focus:border-[#0D2B4E] focus:outline-none"
              >
                {[10, 25, 50, 100].map(n => (
                  <option key={n} value={n}>{n} por página</option>
                ))}
              </select>
            </div>
          </div>

          {loading ? (
            <div className="py-16 text-center text-sm text-slate-500">
              <RefreshCw className="mx-auto mb-3 h-7 w-7 animate-spin text-[#0D2B4E]/50" />
              Carregando solicitações de credenciais...
            </div>
          ) : paginados.length === 0 ? (
            <div className="py-16 text-center px-4">
              <Printer size={40} className="mx-auto mb-3 text-slate-300" />
              <p className="text-sm font-medium text-slate-600">Nenhuma solicitação encontrada para os filtros aplicados.</p>
              {temFiltroAtivo ? (
                <button
                  type="button"
                  onClick={limparFiltros}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-[#0D2B4E] px-4 py-2 text-xs font-semibold text-white hover:bg-[#123b63]"
                >
                  <FilterX className="h-3.5 w-3.5" />
                  Limpar filtros
                </button>
              ) : null}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/80 text-left text-xs uppercase tracking-wider text-slate-500">
                    <th className="px-5 py-3 font-semibold">Ministro</th>
                    <th className="px-5 py-3 font-semibold hidden md:table-cell">Campo / Supervisão</th>
                    <th className="px-5 py-3 font-semibold hidden lg:table-cell">Datas</th>
                    <th className="px-5 py-3 font-semibold">Status</th>
                    <th className="px-5 py-3 font-semibold text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {paginados.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="px-5 py-3.5">
                        <p className="font-semibold text-slate-900">{item.ministroNome}</p>
                        <p className="text-xs text-slate-500">
                          Matrícula: {item.matricula || '—'}
                          {item.cpf ? ` · CPF: ${item.cpf}` : ''}
                        </p>
                      </td>
                      <td className="px-5 py-3.5 hidden md:table-cell text-xs text-slate-600">
                        <p className="font-medium text-slate-800">{item.campo || '—'}</p>
                        <p className="text-slate-400">{item.supervisao || '—'}</p>
                      </td>
                      <td className="px-5 py-3.5 hidden lg:table-cell text-xs text-slate-600 space-y-0.5">
                        <p>Solicitado: <span className="font-medium text-slate-800">{fmtDate(item.solicitadoEm)}</span></p>
                        {item.pagoEm && <p className="text-slate-400">Pago: {fmtDate(item.pagoEm)}</p>}
                        {item.impresso_em && <p className="text-slate-400">Impresso: {fmtDate(item.impresso_em)}</p>}
                        {item.entregueEm && <p className="text-emerald-600 font-medium">Entregue: {fmtDate(item.entregueEm)}</p>}
                      </td>
                      <td className="px-5 py-3.5">
                        <span className={`inline-flex items-center text-xs font-semibold px-2.5 py-1 rounded-full border ${STATUS_COLOR[item.status] || 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                          {item.statusLabel}
                        </span>
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center justify-end gap-2">
                          {item.status === 'pago_pendente_impressao' && (
                            <button
                              type="button"
                              onClick={() => atualizarStatus(item.id, 'em_impressao')}
                              disabled={atualizando === item.id}
                              title="Iniciar impressão"
                              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors disabled:opacity-60"
                            >
                              <Package size={13} />
                              Em Impressão
                            </button>
                          )}
                          {item.status === 'em_impressao' && (
                            <button
                              type="button"
                              onClick={() => atualizarStatus(item.id, 'impresso')}
                              disabled={atualizando === item.id}
                              title="Marcar como impresso"
                              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors disabled:opacity-60"
                            >
                              <Printer size={13} />
                              Impresso
                            </button>
                          )}
                          {item.status === 'impresso' && (
                            <button
                              type="button"
                              onClick={() => atualizarStatus(item.id, 'entregue')}
                              disabled={atualizando === item.id}
                              title="Marcar como entregue"
                              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors disabled:opacity-60"
                            >
                              <Truck size={13} />
                              Entregue
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Paginação */}
          {!loading && filtrados.length > 0 && (
            <div className="border-t border-slate-100 bg-slate-50/50 px-5 py-3.5 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600">
              <span>
                Mostrando <strong>{inicioIdx + 1}</strong> a <strong>{Math.min(inicioIdx + porPagina, filtrados.length)}</strong> de <strong>{filtrados.length}</strong> registros
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setPagina(p => Math.max(1, p - 1))}
                  disabled={paginaAtual <= 1}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  Anterior
                </button>
                <span className="px-2 font-semibold text-[#0D2B4E]">
                  Página {paginaAtual} de {totalPaginas}
                </span>
                <button
                  type="button"
                  onClick={() => setPagina(p => Math.min(totalPaginas, p + 1))}
                  disabled={paginaAtual >= totalPaginas}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                >
                  Próxima
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </PageLayout>
  );
}
