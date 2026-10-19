'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Users,
  Utensils,
  Search,
  RefreshCw,
  Download,
  Printer,
  MapPin,
  Clock,
  AlertCircle,
} from 'lucide-react';

interface LocalItem {
  id: string;
  nome: string;
  ativo: boolean;
}

interface PresencaRow {
  id: string;
  created_at: string;
  horario_belem: string;
  data_plenaria: string;
  sessao: string | null;
  local_id: string | null;
  local_nome: string;
  local_ativo: boolean | null;
  operador: string;
  inscricao_id: string;
  nome_inscrito: string;
  cpf: string | null;
  tipo_inscricao: string;
  matricula: string | null;
  supervisao_id: string | null;
  campo_id: string | null;
}

interface ConsumoRow {
  id: string;
  data_hora: string;
  horario_belem: string;
  dia_belem: string;
  local_id: string | null;
  local_nome: string;
  local_ativo: boolean | null;
  saldo_antes: number;
  saldo_depois: number;
  inscricao_id: string;
  nome_inscrito: string;
  cpf: string | null;
  tipo_inscricao: string;
  matricula: string | null;
  supervisao_id: string | null;
  campo_id: string | null;
}

interface RelatorioPlenariasResponse {
  ok: boolean;
  totais: {
    total_presencas: number;
    participantes_unicos: number;
  };
  filtros_disponiveis: {
    locais: LocalItem[];
    tem_registros_sem_local: boolean;
    datas: string[];
    sessoes: string[];
  };
  distribuicao_locais: Array<{ id: string; nome: string; ativo: boolean | null; total: number }>;
  distribuicao_sessoes: Array<{ sessao: string; total: number }>;
  distribuicao_datas: Array<{ data: string; total: number }>;
  registros: PresencaRow[];
}

interface RelatorioRestaurantesResponse {
  ok: boolean;
  totais: {
    total_refeicoes: number;
    total_hoje: number;
    participantes_atendidos: number;
  };
  filtros_disponiveis: {
    locais: LocalItem[];
    tem_registros_sem_local: boolean;
    datas: string[];
  };
  consumo_por_dia: Array<{ data: string; dia_formatado: string; total: number; percentual: number }>;
  distribuicao_restaurantes: Array<{ id: string; nome: string; ativo: boolean | null; total: number; percentual: number }>;
  registros: ConsumoRow[];
}

function baixarCSV(nomeArq: string, colunas: string[], linhas: (string | number | null | undefined)[][]) {
  const esc = (v: string | number | null | undefined) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [colunas.map(esc).join(','), ...linhas.map(r => r.map(esc).join(','))].join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nomeArq;
  a.click();
  URL.revokeObjectURL(url);
}

export function RelatorioPresencasPlenaria({
  eventoId,
  nomeSup,
  nomeCampo,
}: {
  eventoId: string;
  nomeSup: (id: string | null) => string;
  nomeCampo: (id: string | null) => string;
}) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<RelatorioPlenariasResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Filtros
  const [filtroLocal, setFiltroLocal] = useState('');
  const [filtroData, setFiltroData] = useState('');
  const [filtroSessao, setFiltroSessao] = useState('');
  const [buscaNome, setBuscaNome] = useState('');

  // Paginação
  const [pagina, setPagina] = useState(1);
  const itensPorPagina = 25;

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const p = new URLSearchParams({ visao: 'plenarias' });
      if (filtroLocal) p.set('local_id', filtroLocal);
      if (filtroData) p.set('data', filtroData);
      if (filtroSessao) p.set('sessao', filtroSessao);

      const res = await fetch(`/api/eventos/${eventoId}/relatorios-locais?${p.toString()}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        throw new Error(json.error || 'Erro ao carregar dados do relatório de plenárias.');
      }
      setData(json);
      setPagina(1);
    } catch (err: any) {
      setError(err.message || 'Falha na comunicação com o servidor.');
    } finally {
      setLoading(false);
    }
  }, [eventoId, filtroLocal, filtroData, filtroSessao]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const registrosFiltrados = useMemo(() => {
    if (!data?.registros) return [];
    let list = data.registros;
    if (buscaNome.trim()) {
      const q = buscaNome.trim().toLowerCase();
      const qCpf = q.replace(/\D/g, '');
      list = list.filter(r =>
        r.nome_inscrito.toLowerCase().includes(q) ||
        (r.cpf && r.cpf.includes(qCpf || q)) ||
        (r.matricula && r.matricula.toLowerCase().includes(q))
      );
    }
    return list;
  }, [data?.registros, buscaNome]);

  const totalPaginas = Math.ceil(registrosFiltrados.length / itensPorPagina) || 1;
  const paginados = useMemo(() => {
    const inicio = (pagina - 1) * itensPorPagina;
    return registrosFiltrados.slice(inicio, inicio + itensPorPagina);
  }, [registrosFiltrados, pagina]);

  const handleExportCSV = () => {
    if (!registrosFiltrados.length) return;
    const colunas = [
      '#',
      'Horário Registro (Belém)',
      'Data Plenária',
      'Sessão',
      'Plenária / Local',
      'Status Local',
      'Nome Participante',
      'CPF',
      'Categoria / Cargo',
      'Supervisão',
      'Campo',
      'Operador Registro',
    ];
    const linhas = registrosFiltrados.map((r, idx) => [
      idx + 1,
      r.horario_belem,
      r.data_plenaria,
      r.sessao || 'Sessão Única',
      r.local_nome,
      r.local_ativo === true ? 'Ativo' : r.local_ativo === false ? 'Inativo' : '-',
      r.nome_inscrito,
      r.cpf || '-',
      r.tipo_inscricao,
      nomeSup(r.supervisao_id),
      nomeCampo(r.campo_id),
      r.operador,
    ]);
    const dStr = new Date().toISOString().slice(0, 10);
    baixarCSV(`relatorio_presencas_plenaria_${dStr}.csv`, colunas, linhas);
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-4">
      {/* Barra de Filtros */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">
            Plenária
          </label>
          <select
            value={filtroLocal}
            onChange={e => setFiltroLocal(e.target.value)}
            className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#123b63] min-w-[170px]"
          >
            <option value="">Todas as plenárias</option>
            {data?.filtros_disponiveis.locais.map(loc => (
              <option key={loc.id} value={loc.id}>
                {loc.nome} {!loc.ativo ? '(Inativo)' : ''}
              </option>
            ))}
            {data?.filtros_disponiveis.tem_registros_sem_local && (
              <option value="__sem_local__">Local não especificado (Legado)</option>
            )}
          </select>
        </div>

        <div>
          <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">
            Data
          </label>
          <select
            value={filtroData}
            onChange={e => setFiltroData(e.target.value)}
            className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#123b63] min-w-[130px]"
          >
            <option value="">Todas as datas</option>
            {data?.filtros_disponiveis.datas.map(d => (
              <option key={d} value={d}>
                {d.split('-').reverse().join('/')}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">
            Sessão
          </label>
          <select
            value={filtroSessao}
            onChange={e => setFiltroSessao(e.target.value)}
            className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#123b63] min-w-[130px]"
          >
            <option value="">Todas as sessões</option>
            {data?.filtros_disponiveis.sessoes.map(s => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        <div className="flex-1 min-w-[180px]">
          <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">
            Buscar participante
          </label>
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-2.5" />
            <input
              type="text"
              placeholder="Nome ou CPF..."
              value={buscaNome}
              onChange={e => setBuscaNome(e.target.value)}
              className="w-full border border-gray-200 rounded-lg pl-8 pr-3 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#123b63]"
            />
          </div>
        </div>

        {(filtroLocal || filtroData || filtroSessao || buscaNome) && (
          <button
            onClick={() => {
              setFiltroLocal('');
              setFiltroData('');
              setFiltroSessao('');
              setBuscaNome('');
            }}
            className="text-xs text-red-600 hover:text-red-800 font-semibold underline self-center mb-1"
          >
            Limpar filtros
          </button>
        )}

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => void fetchData()}
            disabled={loading}
            className="p-1.5 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 transition"
            title="Atualizar dados"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-[#123b63]' : ''}`} />
          </button>
          <button
            onClick={handleExportCSV}
            disabled={!registrosFiltrados.length}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 rounded-lg text-xs font-semibold text-gray-700 hover:bg-gray-50 transition disabled:opacity-40"
          >
            <Download className="w-3.5 h-3.5 text-emerald-600" />
            <span>CSV</span>
          </button>
          <button
            onClick={handlePrint}
            disabled={!registrosFiltrados.length}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#123b63] text-white rounded-lg text-xs font-semibold hover:bg-[#0f2a45] transition disabled:opacity-40"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>Imprimir</span>
          </button>
        </div>
      </div>

      {/* Indicadores */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-blue-900 uppercase tracking-wider">Total de Presenças</span>
            <Users className="w-5 h-5 text-blue-600" />
          </div>
          <p className="text-3xl font-black text-blue-900 mt-2">{data?.totais.total_presencas ?? 0}</p>
          <span className="text-[11px] text-blue-700 mt-1 block">Registros efetivos de plenária</span>
        </div>

        <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-emerald-900 uppercase tracking-wider">Participantes Únicos</span>
            <Users className="w-5 h-5 text-emerald-600" />
          </div>
          <p className="text-3xl font-black text-emerald-900 mt-2">{data?.totais.participantes_unicos ?? 0}</p>
          <span className="text-[11px] text-emerald-700 mt-1 block">Inscritos distintos com presença</span>
        </div>

        <div className="bg-slate-50 border border-slate-100 rounded-xl p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">Locais Mapeados</span>
            <MapPin className="w-5 h-5 text-slate-500" />
          </div>
          <p className="text-3xl font-black text-slate-900 mt-2">{data?.distribuicao_locais.length ?? 0}</p>
          <span className="text-[11px] text-slate-500 mt-1 block">Plenárias ativas e históricas</span>
        </div>
      </div>

      {/* Distribuição por Plenária */}
      {data && data.distribuicao_locais.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
          <h4 className="text-xs font-bold text-gray-700 uppercase tracking-wider mb-3">
            Distribuição por Plenária
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {data.distribuicao_locais.map(item => {
              const perc = data.totais.total_presencas > 0 ? Math.round((item.total / data.totais.total_presencas) * 100) : 0;
              return (
                <div
                  key={item.id}
                  onClick={() => setFiltroLocal(filtroLocal === item.id ? '' : item.id)}
                  className={`border rounded-xl p-3 cursor-pointer transition ${
                    filtroLocal === item.id
                      ? 'border-[#123b63] bg-blue-50/50 shadow-sm'
                      : 'border-gray-100 hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-xs font-bold text-gray-800 flex items-center gap-1.5">
                        <span>{item.nome}</span>
                        {item.ativo === false && (
                          <span className="text-[9px] bg-red-100 text-red-700 px-1.5 py-0.2 rounded font-bold">
                            Inativa
                          </span>
                        )}
                      </p>
                      <p className="text-[11px] text-gray-500 mt-0.5">{item.total} presenças ({perc}%)</p>
                    </div>
                    <span className="text-sm font-black text-[#123b63]">{item.total}</span>
                  </div>
                  <div className="w-full h-1.5 bg-gray-100 rounded-full mt-2 overflow-hidden">
                    <div className="h-full bg-blue-600 rounded-full transition-all" style={{ width: `${perc}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Tabela de Presenças */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-gray-800">Registros de Presença</h3>
            <p className="text-xs text-gray-400">
              {registrosFiltrados.length} presenças listadas
            </p>
          </div>
        </div>

        {loading ? (
          <div className="py-12 text-center text-gray-400 text-xs">
            <div className="w-6 h-6 border-2 border-[#123b63] border-t-transparent rounded-full animate-spin mx-auto mb-2" />
            Carregando presenças por plenária...
          </div>
        ) : error ? (
          <div className="p-8 text-center text-red-600 text-xs">
            <AlertCircle className="w-6 h-6 mx-auto mb-2 text-red-500" />
            {error}
          </div>
        ) : registrosFiltrados.length === 0 ? (
          <div className="py-12 text-center text-gray-400 text-xs">
            Nenhuma presença localizada para os filtros selecionados.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-50 border-b border-gray-100 text-gray-500 font-semibold uppercase tracking-wider">
                <tr>
                  <th className="py-2.5 px-3 w-10 text-center">#</th>
                  <th className="py-2.5 px-3">Horário (Belém)</th>
                  <th className="py-2.5 px-3">Data / Sessão</th>
                  <th className="py-2.5 px-3">Plenária / Setor</th>
                  <th className="py-2.5 px-3">Participante</th>
                  <th className="py-2.5 px-3">CPF</th>
                  <th className="py-2.5 px-3">Supervisão / Campo</th>
                  <th className="py-2.5 px-3">Operador</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {paginados.map((r, idx) => (
                  <tr key={r.id} className="hover:bg-gray-50/70 transition">
                    <td className="py-2.5 px-3 text-center text-gray-400">
                      {(pagina - 1) * itensPorPagina + idx + 1}
                    </td>
                    <td className="py-2.5 px-3 font-medium text-gray-800 whitespace-nowrap">
                      {r.horario_belem}
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <span className="font-semibold text-gray-700">
                        {r.data_plenaria.split('-').reverse().join('/')}
                      </span>
                      {r.sessao && (
                        <span className="ml-1.5 px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 text-[10px] font-bold">
                          {r.sessao}
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3">
                      <span className={`inline-flex items-center gap-1 font-semibold ${
                        r.local_ativo === false ? 'text-red-700' : 'text-gray-900'
                      }`}>
                        🏛️ {r.local_nome}
                      </span>
                      {r.local_ativo === false && (
                        <span className="ml-1 text-[9px] bg-red-100 text-red-700 px-1 rounded font-bold">
                          inativo
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 font-bold text-gray-900 uppercase">
                      {r.nome_inscrito}
                    </td>
                    <td className="py-2.5 px-3 text-gray-500 whitespace-nowrap">
                      {r.cpf || '-'}
                    </td>
                    <td className="py-2.5 px-3 text-gray-600 truncate max-w-[200px]">
                      {nomeSup(r.supervisao_id)} · {nomeCampo(r.campo_id)}
                    </td>
                    <td className="py-2.5 px-3 text-gray-500 truncate max-w-[120px]">
                      {r.operador}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Paginação */}
        {totalPaginas > 1 && (
          <div className="p-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500">
            <span>
              Página <strong>{pagina}</strong> de <strong>{totalPaginas}</strong>
            </span>
            <div className="flex gap-1">
              <button
                onClick={() => setPagina(p => Math.max(1, p - 1))}
                disabled={pagina === 1}
                className="px-2.5 py-1 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40 transition"
              >
                ‹ Anterior
              </button>
              <button
                onClick={() => setPagina(p => Math.min(totalPaginas, p + 1))}
                disabled={pagina === totalPaginas}
                className="px-2.5 py-1 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40 transition"
              >
                Próxima ›
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function RelatorioConsumoRestaurante({
  eventoId,
  nomeSup,
  nomeCampo,
}: {
  eventoId: string;
  nomeSup: (id: string | null) => string;
  nomeCampo: (id: string | null) => string;
}) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<RelatorioRestaurantesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Filtros
  const [filtroLocal, setFiltroLocal] = useState('');
  const [filtroData, setFiltroData] = useState('');
  const [buscaNome, setBuscaNome] = useState('');

  // Paginação
  const [pagina, setPagina] = useState(1);
  const itensPorPagina = 25;

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const p = new URLSearchParams({ visao: 'restaurantes' });
      if (filtroLocal) p.set('local_id', filtroLocal);
      if (filtroData) p.set('data', filtroData);

      const res = await fetch(`/api/eventos/${eventoId}/relatorios-locais?${p.toString()}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        throw new Error(json.error || 'Erro ao carregar dados do relatório de restaurantes.');
      }
      setData(json);
      setPagina(1);
    } catch (err: any) {
      setError(err.message || 'Falha na comunicação com o servidor.');
    } finally {
      setLoading(false);
    }
  }, [eventoId, filtroLocal, filtroData]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const registrosFiltrados = useMemo(() => {
    if (!data?.registros) return [];
    let list = data.registros;
    if (buscaNome.trim()) {
      const q = buscaNome.trim().toLowerCase();
      const qCpf = q.replace(/\D/g, '');
      list = list.filter(r =>
        r.nome_inscrito.toLowerCase().includes(q) ||
        (r.cpf && r.cpf.includes(qCpf || q)) ||
        (r.matricula && r.matricula.toLowerCase().includes(q))
      );
    }
    return list;
  }, [data?.registros, buscaNome]);

  const totalPaginas = Math.ceil(registrosFiltrados.length / itensPorPagina) || 1;
  const paginados = useMemo(() => {
    const inicio = (pagina - 1) * itensPorPagina;
    return registrosFiltrados.slice(inicio, inicio + itensPorPagina);
  }, [registrosFiltrados, pagina]);

  const handleExportCSV = () => {
    if (!registrosFiltrados.length) return;
    const colunas = [
      '#',
      'Data e Hora (Belém)',
      'Restaurante / Ponto de Alimentação',
      'Status Local',
      'Nome Participante',
      'CPF',
      'Categoria / Cargo',
      'Supervisão',
      'Campo',
      'Saldo Antes',
      'Saldo Depois',
    ];
    const linhas = registrosFiltrados.map((r, idx) => [
      idx + 1,
      r.horario_belem,
      r.local_nome,
      r.local_ativo === true ? 'Ativo' : r.local_ativo === false ? 'Inativo' : '-',
      r.nome_inscrito,
      r.cpf || '-',
      r.tipo_inscricao,
      nomeSup(r.supervisao_id),
      nomeCampo(r.campo_id),
      r.saldo_antes,
      r.saldo_depois,
    ]);
    const dStr = new Date().toISOString().slice(0, 10);
    baixarCSV(`relatorio_consumo_restaurantes_${dStr}.csv`, colunas, linhas);
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-4">
      {/* Barra de Filtros */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">
            Restaurante / Refeitório
          </label>
          <select
            value={filtroLocal}
            onChange={e => setFiltroLocal(e.target.value)}
            className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#123b63] min-w-[180px]"
          >
            <option value="">Todos os restaurantes</option>
            {data?.filtros_disponiveis.locais.map(loc => (
              <option key={loc.id} value={loc.id}>
                {loc.nome} {!loc.ativo ? '(Inativo)' : ''}
              </option>
            ))}
            {data?.filtros_disponiveis.tem_registros_sem_local && (
              <option value="__sem_local__">Local não especificado (Legado)</option>
            )}
          </select>
        </div>

        <div>
          <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">
            Data
          </label>
          <select
            value={filtroData}
            onChange={e => setFiltroData(e.target.value)}
            className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#123b63] min-w-[140px]"
          >
            <option value="">Todo o período</option>
            {data?.filtros_disponiveis.datas.map(d => (
              <option key={d} value={d}>
                {d.split('-').reverse().join('/')}
              </option>
            ))}
          </select>
        </div>

        <div className="flex-1 min-w-[180px]">
          <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">
            Buscar participante
          </label>
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-2.5" />
            <input
              type="text"
              placeholder="Nome ou CPF..."
              value={buscaNome}
              onChange={e => setBuscaNome(e.target.value)}
              className="w-full border border-gray-200 rounded-lg pl-8 pr-3 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#123b63]"
            />
          </div>
        </div>

        {(filtroLocal || filtroData || buscaNome) && (
          <button
            onClick={() => {
              setFiltroLocal('');
              setFiltroData('');
              setBuscaNome('');
            }}
            className="text-xs text-red-600 hover:text-red-800 font-semibold underline self-center mb-1"
          >
            Limpar filtros
          </button>
        )}

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => void fetchData()}
            disabled={loading}
            className="p-1.5 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 transition"
            title="Atualizar dados"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-[#123b63]' : ''}`} />
          </button>
          <button
            onClick={handleExportCSV}
            disabled={!registrosFiltrados.length}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 rounded-lg text-xs font-semibold text-gray-700 hover:bg-gray-50 transition disabled:opacity-40"
          >
            <Download className="w-3.5 h-3.5 text-emerald-600" />
            <span>CSV</span>
          </button>
          <button
            onClick={handlePrint}
            disabled={!registrosFiltrados.length}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#123b63] text-white rounded-lg text-xs font-semibold hover:bg-[#0f2a45] transition disabled:opacity-40"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>Imprimir</span>
          </button>
        </div>
      </div>

      {/* Indicadores */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-orange-50 border border-orange-100 rounded-xl p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-orange-900 uppercase tracking-wider">Total de Refeições</span>
            <Utensils className="w-5 h-5 text-orange-600" />
          </div>
          <p className="text-3xl font-black text-orange-900 mt-2">{data?.totais.total_refeicoes ?? 0}</p>
          <span className="text-[11px] text-orange-700 mt-1 block">Consumos oficiais registrados</span>
        </div>

        <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-emerald-900 uppercase tracking-wider">Refeições Hoje</span>
            <Clock className="w-5 h-5 text-emerald-600" />
          </div>
          <p className="text-3xl font-black text-emerald-900 mt-2">{data?.totais.total_hoje ?? 0}</p>
          <span className="text-[11px] text-emerald-700 mt-1 block">Fuso de Belém (America/Belem)</span>
        </div>

        <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-blue-900 uppercase tracking-wider">Participantes Atendidos</span>
            <Users className="w-5 h-5 text-blue-600" />
          </div>
          <p className="text-3xl font-black text-blue-900 mt-2">{data?.totais.participantes_atendidos ?? 0}</p>
          <span className="text-[11px] text-blue-700 mt-1 block">Inscritos distintos com refeição</span>
        </div>
      </div>

      {/* Gráfico / Distribuição por Dia e por Restaurante */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Consumo por Dia */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
          <h4 className="text-xs font-bold text-gray-700 uppercase tracking-wider mb-3">
            Consumo por Dia (America/Belem)
          </h4>
          {data?.consumo_por_dia && data.consumo_por_dia.length > 0 ? (
            <div className="space-y-2.5">
              {data.consumo_por_dia.map(d => (
                <div key={d.data} className="flex items-center gap-3">
                  <span className="w-24 text-xs font-bold text-gray-700 shrink-0">
                    {d.dia_formatado}
                  </span>
                  <div className="flex-1 h-3.5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-orange-500 rounded-full transition-all"
                      style={{ width: `${Math.max(d.percentual, 5)}%` }}
                    />
                  </div>
                  <span className="w-16 text-right text-xs font-black text-gray-800 shrink-0">
                    {d.total}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-gray-400 py-4 text-center">Nenhum consumo diário registrado.</p>
          )}
        </div>

        {/* Distribuição por Restaurante */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
          <h4 className="text-xs font-bold text-gray-700 uppercase tracking-wider mb-3">
            Distribuição por Restaurante
          </h4>
          {data?.distribuicao_restaurantes && data.distribuicao_restaurantes.length > 0 ? (
            <div className="space-y-2.5">
              {data.distribuicao_restaurantes.map(r => (
                <div key={r.id} className="flex items-center gap-3">
                  <span className="w-36 text-xs font-bold text-gray-700 truncate shrink-0" title={r.nome}>
                    {r.nome}
                    {r.ativo === false && <span className="text-[9px] text-red-600 ml-1">(Inat.)</span>}
                  </span>
                  <div className="flex-1 h-3.5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 rounded-full transition-all"
                      style={{ width: `${Math.max(r.percentual, 5)}%` }}
                    />
                  </div>
                  <span className="w-16 text-right text-xs font-black text-gray-800 shrink-0">
                    {r.total} <span className="text-[10px] text-gray-400 font-normal">({r.percentual}%)</span>
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-gray-400 py-4 text-center">Nenhum restaurante com registros.</p>
          )}
        </div>
      </div>

      {/* Tabela de Consumos */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-gray-800">Registros de Consumo</h3>
            <p className="text-xs text-gray-400">
              {registrosFiltrados.length} refeições listadas
            </p>
          </div>
        </div>

        {loading ? (
          <div className="py-12 text-center text-gray-400 text-xs">
            <div className="w-6 h-6 border-2 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
            Carregando consumo por restaurante...
          </div>
        ) : error ? (
          <div className="p-8 text-center text-red-600 text-xs">
            <AlertCircle className="w-6 h-6 mx-auto mb-2 text-red-500" />
            {error}
          </div>
        ) : registrosFiltrados.length === 0 ? (
          <div className="py-12 text-center text-gray-400 text-xs">
            Nenhuma refeição localizada para os filtros selecionados.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-50 border-b border-gray-100 text-gray-500 font-semibold uppercase tracking-wider">
                <tr>
                  <th className="py-2.5 px-3 w-10 text-center">#</th>
                  <th className="py-2.5 px-3">Data e Hora (Belém)</th>
                  <th className="py-2.5 px-3">Restaurante / Refeitório</th>
                  <th className="py-2.5 px-3">Participante</th>
                  <th className="py-2.5 px-3">CPF</th>
                  <th className="py-2.5 px-3">Supervisão / Campo</th>
                  <th className="py-2.5 px-3 text-center">Saldo Antes</th>
                  <th className="py-2.5 px-3 text-center">Saldo Depois</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {paginados.map((r, idx) => (
                  <tr key={r.id} className="hover:bg-gray-50/70 transition">
                    <td className="py-2.5 px-3 text-center text-gray-400">
                      {(pagina - 1) * itensPorPagina + idx + 1}
                    </td>
                    <td className="py-2.5 px-3 font-medium text-gray-800 whitespace-nowrap">
                      {r.horario_belem}
                    </td>
                    <td className="py-2.5 px-3">
                      <span className={`inline-flex items-center gap-1 font-semibold ${
                        r.local_ativo === false ? 'text-red-700' : 'text-gray-900'
                      }`}>
                        🍽️ {r.local_nome}
                      </span>
                      {r.local_ativo === false && (
                        <span className="ml-1 text-[9px] bg-red-100 text-red-700 px-1 rounded font-bold">
                          inativo
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 font-bold text-gray-900 uppercase">
                      {r.nome_inscrito}
                    </td>
                    <td className="py-2.5 px-3 text-gray-500 whitespace-nowrap">
                      {r.cpf || '-'}
                    </td>
                    <td className="py-2.5 px-3 text-gray-600 truncate max-w-[200px]">
                      {nomeSup(r.supervisao_id)} · {nomeCampo(r.campo_id)}
                    </td>
                    <td className="py-2.5 px-3 text-center text-gray-500 font-semibold">
                      {r.saldo_antes}
                    </td>
                    <td className="py-2.5 px-3 text-center font-bold text-emerald-700">
                      {r.saldo_depois}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Paginação */}
        {totalPaginas > 1 && (
          <div className="p-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500">
            <span>
              Página <strong>{pagina}</strong> de <strong>{totalPaginas}</strong>
            </span>
            <div className="flex gap-1">
              <button
                onClick={() => setPagina(p => Math.max(1, p - 1))}
                disabled={pagina === 1}
                className="px-2.5 py-1 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40 transition"
              >
                ‹ Anterior
              </button>
              <button
                onClick={() => setPagina(p => Math.min(totalPaginas, p + 1))}
                disabled={pagina === totalPaginas}
                className="px-2.5 py-1 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40 transition"
              >
                Próxima ›
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
