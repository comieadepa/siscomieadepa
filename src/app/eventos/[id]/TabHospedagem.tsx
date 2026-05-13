'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase-client';

// ─── Interfaces ──────────────────────────────────────────────────────────────
interface Evento {
  id: string; nome: string; departamento: string;
  data_inicio: string; data_fim: string;
  permite_hospedagem: boolean;
}

interface Supervisao { id: string; nome: string; }
interface Campo      { id: string; nome: string; supervisao_id: string; }

interface Alojamento {
  id: string;
  evento_id: string;
  nome: string;
  publico: 'feminino' | 'presidentes' | 'jubilados' | 'masculino_geral' | 'misto';
  sexo: 'M' | 'F' | null;
  total_vagas: number;
  camas_inferiores: number;
  camas_superiores: number;
  ativo: boolean;
  vagas_livres?: number;
  inferiores_livres?: number;
  superiores_livres?: number;
}

interface Hospedagem {
  id: string;
  inscricao_id: string;
  alojamento_id: string | null;
  status: 'solicitada' | 'confirmada' | 'lista_espera' | 'recusada';
  prioridade: number;
  necessidade_especial: boolean;
  descricao_necessidade: string | null;
  cama_inferior: boolean;
  tipo_cama: 'inferior' | 'superior' | null;
  numero_cama: string | null;
  observacoes: string | null;
  alocacao_automatica: boolean;
  // joins
  nome_inscrito?: string;
  cpf?: string | null;
  sexo?: string | null;
  supervisao_id?: string | null;
  campo_id?: string | null;
  data_nascimento?: string | null;
  alojamento_nome?: string | null;
}

// ─── Helpers ────────────────────────────────────────────────────────────────
const STATUS_HOSP_CFG: Record<string, { label: string; cls: string }> = {
  solicitada:   { label: 'Solicitada',   cls: 'bg-yellow-100 text-yellow-700' },
  confirmada:   { label: 'Confirmada',   cls: 'bg-emerald-100 text-emerald-700' },
  lista_espera: { label: 'Lista Espera', cls: 'bg-orange-100 text-orange-700' },
  recusada:     { label: 'Recusada',     cls: 'bg-red-100 text-red-700' },
};


function baixarCSV(nomeArq: string, colunas: string[], linhas: (string | number | null | undefined)[][]) {
  const esc = (v: string | number | null | undefined) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [colunas.map(esc).join(','), ...linhas.map(r => r.map(esc).join(','))].join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a'); a.href = url; a.download = nomeArq; a.click();
  URL.revokeObjectURL(url);
}

const inputCls = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#123b63] bg-white';
const labelCls = 'block text-xs font-semibold text-gray-600 mb-1';
const thCls = 'text-left text-xs font-semibold text-gray-500 uppercase tracking-wide py-2.5 px-3 bg-gray-50 whitespace-nowrap';
const tdCls = 'py-2.5 px-3 text-sm text-gray-700 border-t border-gray-50 whitespace-nowrap';

// ─── Sub-aba ────────────────────────────────────────────────────────────────
type SubAba = 'hospedagens' | 'alojamentos' | 'relatorios';

// ════════════════════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL
// ════════════════════════════════════════════════════════════════════════════
export default function TabHospedagem({
  eventoId,
  evento: _evento,
  supervisoes,
  campos: _campos,
  nomeSup,
  nomeCampo,
  supabase: _supabase,
}: {
  eventoId: string;
  evento: Evento;
  supervisoes: Supervisao[];
  campos: Campo[];
  nomeSup: (id: string | null) => string;
  nomeCampo: (id: string | null) => string;
  supabase: ReturnType<typeof createClient>;
}) {
  const [subAba, setSubAba] = useState<SubAba>('hospedagens');

  const [alojamentos,     setAlojamentos]     = useState<Alojamento[]>([]);
  const [hospedagens,     setHospedagens]     = useState<Hospedagem[]>([]);
  const [loadingAloj,     setLoadingAloj]     = useState(true);
  const [loadingHosp,     setLoadingHosp]     = useState(true);
  const [autoalocando,    setAutoalocando]    = useState(false);
  const [autoalocResult,  setAutoalocResult]  = useState<{ alocadas: number; listaEspera: number; erros: number } | null>(null);

  // Filtros hospedagens
  const [filtroStatus,  setFiltroStatus]  = useState('');
  const [filtroAloj,    setFiltroAloj]    = useState('');
  const [filtroSexo,    setFiltroSexo]    = useState('');
  const [filtroSup,     setFiltroSup]     = useState('');
  const [filtroNecEsp,  setFiltroNecEsp]  = useState('');
  const [filtroCamaInf, setFiltroCamaInf] = useState('');

  // Modal edição
  const [editando, setEditando] = useState<Hospedagem | null>(null);
  const [editForm, setEditForm] = useState<{
    alojamento_id: string;
    tipo_cama: string;
    numero_cama: string;
    status: string;
    observacoes: string;
  } | null>(null);
  const [salvandoEdit, setSalvandoEdit] = useState(false);
  const [erroEdit,    setErroEdit]    = useState<string | null>(null);
  const [quickErro,   setQuickErro]   = useState<string | null>(null);
  const [salvandoId,  setSalvandoId]  = useState<string | null>(null);

  // ── Fetch ──────────────────────────────────────────────────
  const fetchAlojamentos = useCallback(async () => {
    setLoadingAloj(true);
    const res = await fetch(`/api/eventos/${eventoId}/alojamentos`);
    const json = await res.json();
    setAlojamentos(json.alojamentos ?? []);
    setLoadingAloj(false);
  }, [eventoId]);

  const fetchHospedagens = useCallback(async () => {
    setLoadingHosp(true);
    const res = await fetch(`/api/eventos/${eventoId}/hospedagens`);
    const json = await res.json();
    setHospedagens(json.hospedagens ?? []);
    setLoadingHosp(false);
  }, [eventoId]);

  useEffect(() => {
    fetchAlojamentos();
    fetchHospedagens();
  }, [fetchAlojamentos, fetchHospedagens]);

  // ── Autoalocar ─────────────────────────────────────────────
  async function autoalocar() {
    if (!confirm('Executar alocação automática para todas as hospedagens solicitadas?')) return;
    setAutoalocando(true);
    setAutoalocResult(null);
    try {
      const res = await fetch(`/api/eventos/${eventoId}/hospedagens/alocar`, { method: 'POST' });
      const json = await res.json();
      setAutoalocResult({ alocadas: json.confirmados ?? 0, listaEspera: json.lista_espera ?? 0, erros: 0 });
      fetchHospedagens();
    } catch {
      setAutoalocResult({ alocadas: 0, listaEspera: 0, erros: 1 });
    } finally {
      setAutoalocando(false);
    }
  }

  // ── Filtros hospedagens ────────────────────────────────────
  const hospFiltradas = useMemo(() => {
    let list = hospedagens;
    if (filtroStatus)  list = list.filter(h => h.status === filtroStatus);
    if (filtroAloj)    list = list.filter(h => h.alojamento_id === filtroAloj);
    if (filtroSexo)    list = list.filter(h => h.sexo === filtroSexo);
    if (filtroSup)     list = list.filter(h => h.supervisao_id === filtroSup);
    if (filtroNecEsp === '1') list = list.filter(h => h.necessidade_especial);
    if (filtroNecEsp === '0') list = list.filter(h => !h.necessidade_especial);
    if (filtroCamaInf === '1') list = list.filter(h => h.cama_inferior);
    if (filtroCamaInf === '0') list = list.filter(h => !h.cama_inferior);
    return list;
  }, [hospedagens, filtroStatus, filtroAloj, filtroSexo, filtroSup, filtroNecEsp, filtroCamaInf]);

  // ── Stats ──────────────────────────────────────────────────
  const stats = useMemo(() => ({
    total:       hospedagens.length,
    solicitadas: hospedagens.filter(h => h.status === 'solicitada').length,
    confirmadas: hospedagens.filter(h => h.status === 'confirmada').length,
    listaEspera: hospedagens.filter(h => h.status === 'lista_espera').length,
    necEsp:      hospedagens.filter(h => h.necessidade_especial).length,
    camaInf:     hospedagens.filter(h => h.cama_inferior).length,
    vagasDisp:   alojamentos.filter(a => a.ativo).reduce((sum, a) => sum + (a.vagas_livres ?? 0), 0),
  }), [hospedagens, alojamentos]);

  // ── Abrir modal edição ─────────────────────────────────────
  function abrirEdicao(h: Hospedagem) {
    setEditando(h);
    setEditForm({
      alojamento_id: h.alojamento_id ?? '',
      tipo_cama:     h.tipo_cama     ?? '',
      numero_cama:   h.numero_cama   ?? '',
      status:        h.status,
      observacoes:   h.observacoes   ?? '',
    });
    setErroEdit(null);
  }

  async function salvarEdicao() {
    if (!editando || !editForm) return;
    setSalvandoEdit(true);
    setErroEdit(null);
    try {
      const res = await fetch(`/api/eventos/${eventoId}/hospedagens`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id:                  editando.id,
          alojamento_id:       editForm.alojamento_id || null,
          tipo_cama:           editForm.tipo_cama     || null,
          numero_cama:         editForm.numero_cama   || null,
          status:              editForm.status,
          observacoes:         editForm.observacoes   || null,
          alocacao_automatica: false,
        }),
      });
      if (!res.ok) { const j = await res.json(); throw new Error(j.error ?? 'Erro'); }
      setEditando(null);
      fetchHospedagens();
    } catch (err) {
      setErroEdit(err instanceof Error ? err.message : 'Erro ao salvar');
    } finally {
      setSalvandoEdit(false);
    }
  }
  // ── Ações rápidas ───────────────────────────────────────────
  async function acaoRapida(h: Hospedagem, novoStatus: string) {
    if (novoStatus === 'confirmada' && !h.alojamento_id) {
      setQuickErro('Defina um alojamento antes de confirmar (use ✏️ Editar).');
      return;
    }
    setSalvandoId(h.id);
    setQuickErro(null);
    try {
      const res = await fetch(`/api/eventos/${eventoId}/hospedagens`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: h.id, status: novoStatus }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Erro');
      fetchHospedagens();
    } catch (err) {
      setQuickErro(err instanceof Error ? err.message : 'Erro ao atualizar');
    } finally {
      setSalvandoId(null);
    }
  }

  async function removerHospedagem(h: Hospedagem) {
    if (!confirm(`Remover hospedagem de "${h.nome_inscrito ?? 'participante'}"? Esta ação não pode ser desfeita.`)) return;
    setSalvandoId(h.id);
    setQuickErro(null);
    try {
      const res = await fetch(`/api/eventos/${eventoId}/hospedagens?id=${h.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Erro');
      fetchHospedagens();
    } catch (err) {
      setQuickErro(err instanceof Error ? err.message : 'Erro ao remover');
    } finally {
      setSalvandoId(null);
    }
  }
  // ── Exportar CSV ───────────────────────────────────────────
  function exportarCSV(lista: Hospedagem[], nome: string) {
    baixarCSV(`hospedagem_${nome}_${eventoId}.csv`,
      ['Nome', 'CPF', 'Sexo', 'Supervisão', 'Campo', 'Alojamento', 'Nº Leito', 'Tipo Cama', 'Status', 'Prioridade', 'Nec. Especial', 'Cama Inferior', 'Observações'],
      lista.map(h => [
        h.nome_inscrito, h.cpf, h.sexo,
        nomeSup(h.supervisao_id ?? null),
        nomeCampo(h.campo_id ?? null),
        h.alojamento_nome,
        h.numero_cama,
        h.tipo_cama,
        h.status,
        h.prioridade,
        h.necessidade_especial ? 'Sim' : 'Não',
        h.cama_inferior ? 'Sim' : 'Não',
        h.observacoes,
      ])
    );
  }

  return (
    <div className="space-y-5">

      {/* ── Sub-abas ──────────────────────────────────────────── */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-full overflow-x-auto">
        {([
          { id: 'hospedagens', label: '🛏️ Alocações' },
          { id: 'alojamentos', label: '🏠 Alojamentos' },
          { id: 'relatorios',  label: '📊 Relatórios' },
        ] as { id: SubAba; label: string }[]).map(t => (
          <button key={t.id} onClick={() => setSubAba(t.id)}
            className={`px-4 py-2 rounded-lg text-xs font-semibold transition whitespace-nowrap flex-shrink-0 ${
              subAba === t.id ? 'bg-white text-[#123b63] shadow-sm' : 'text-gray-500 hover:text-gray-800'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Cards de resumo ───────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-3">
        {[
          { label: 'Total',        value: stats.total,       cor: 'text-[#123b63]' },
          { label: 'Solicitadas',  value: stats.solicitadas, cor: 'text-yellow-600' },
          { label: 'Confirmadas',  value: stats.confirmadas, cor: 'text-emerald-600' },
          { label: 'Lista Espera', value: stats.listaEspera, cor: 'text-orange-600' },
          { label: 'Nec. Especial',value: stats.necEsp,      cor: 'text-purple-600' },
          { label: 'Cama Inferior',value: stats.camaInf,     cor: 'text-sky-600' },
          { label: 'Vagas Livres', value: stats.vagasDisp,   cor: 'text-teal-600' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl border border-gray-100 shadow-sm p-3 text-center">
            <p className={`text-xl font-black ${s.cor}`}>{s.value}</p>
            <p className="text-[10px] text-gray-400 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* ── Resultado autoalocação ────────────────────────────── */}
      {autoalocResult && (
        <div className={`rounded-xl px-5 py-3 flex items-center gap-3 border text-sm font-semibold ${
          autoalocResult.erros > 0 ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-emerald-50 border-emerald-200 text-emerald-800'
        }`}>
          ✅ Autoalocação concluída: {autoalocResult.alocadas} alocadas · {autoalocResult.listaEspera} lista espera · {autoalocResult.erros} erros
          <button onClick={() => setAutoalocResult(null)} className="ml-auto text-gray-400 hover:text-gray-600">✕</button>
        </div>
      )}
      {/* ── Erro de ação rápida ───────────────────────────── */}
      {quickErro && (
        <div className="rounded-xl px-5 py-3 flex items-center gap-3 border bg-red-50 border-red-200 text-red-700 text-sm font-semibold">
          ⚠️ {quickErro}
          <button onClick={() => setQuickErro(null)} className="ml-auto text-red-400 hover:text-red-600">✕</button>
        </div>
      )}
      {/* ════════════ SUB-ABA: ALOCAÇÕES ════════════════════════ */}
      {subAba === 'hospedagens' && (
        <div className="space-y-4">

          {/* Botão autoalocar + filtros */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex flex-wrap gap-3 items-end">
            <button
              onClick={autoalocar}
              disabled={autoalocando || stats.solicitadas === 0}
              className="w-full sm:w-auto flex items-center gap-2 bg-[#0D2B4E] text-white px-5 py-2.5 rounded-xl text-sm font-bold hover:bg-[#0a1e38] transition disabled:opacity-50"
            >
              {autoalocando ? '⏳ Alocando...' : '🤖 Autoalocar'}
            </button>

            <div className="flex flex-wrap gap-2 flex-1 min-w-0">
              <select value={filtroStatus} onChange={e => setFiltroStatus(e.target.value)}
                className="w-full sm:w-auto border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#123b63]">
                <option value="">Todos os status</option>
                <option value="solicitada">Solicitada</option>
                <option value="confirmada">Confirmada</option>
                <option value="lista_espera">Lista Espera</option>
                <option value="recusada">Recusada</option>
              </select>

              <select value={filtroAloj} onChange={e => setFiltroAloj(e.target.value)}
                className="w-full sm:w-auto border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#123b63]">
                <option value="">Todos os alojamentos</option>
                {alojamentos.map(a => <option key={a.id} value={a.id}>{a.nome}</option>)}
              </select>

              <select value={filtroSexo} onChange={e => setFiltroSexo(e.target.value)}
                className="w-full sm:w-auto border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#123b63]">
                <option value="">Ambos os sexos</option>
                <option value="M">Masculino</option>
                <option value="F">Feminino</option>
              </select>

              <select value={filtroSup} onChange={e => setFiltroSup(e.target.value)}
                className="w-full sm:w-auto border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#123b63]">
                <option value="">Toda supervisão</option>
                {supervisoes.map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}
              </select>

              <select value={filtroNecEsp} onChange={e => setFiltroNecEsp(e.target.value)}
                className="w-full sm:w-auto border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#123b63]">
                <option value="">Nec. especial?</option>
                <option value="1">Sim</option>
                <option value="0">Não</option>
              </select>

              <select value={filtroCamaInf} onChange={e => setFiltroCamaInf(e.target.value)}
                className="w-full sm:w-auto border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#123b63]">
                <option value="">Cama inferior?</option>
                <option value="1">Sim</option>
                <option value="0">Não</option>
              </select>
            </div>

            <button onClick={() => exportarCSV(hospFiltradas, 'geral')}
              className="w-full sm:w-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-semibold text-gray-700 hover:bg-gray-50 transition">
              📥 CSV
            </button>
          </div>

          {/* Tabela hospedagens */}
          {loadingHosp ? (
            <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="bg-white rounded-xl h-12 animate-pulse" />)}</div>
          ) : hospFiltradas.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
              <span className="text-4xl mb-3 block">🛏️</span>
              <p className="text-gray-500 font-medium">Nenhuma hospedagem encontrada</p>
              <p className="text-xs text-gray-400 mt-1">Ajuste os filtros ou aguarde inscrições com hospedagem.</p>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
              <table className="w-full min-w-[980px] text-sm">
                <thead>
                  <tr>
                    <th className={thCls}>Nome</th>
                    <th className={thCls}>Supervisão</th>
                    <th className={thCls}>Alojamento</th>
                    <th className={thCls}>Leito</th>
                    <th className={thCls}>Tipo Cama</th>
                    <th className={thCls}>Status</th>
                    <th className={thCls + ' text-right'}>Prior.</th>
                    <th className={thCls + ' text-center'}>🦽</th>
                    <th className={thCls}>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {hospFiltradas.map(h => {
                    const stCfg = STATUS_HOSP_CFG[h.status] ?? STATUS_HOSP_CFG.solicitada;
                    const carregando = salvandoId === h.id;
                    return (
                      <tr key={h.id} className={`border-t border-gray-50 hover:bg-gray-50 transition ${carregando ? 'opacity-60' : ''}`}>
                        <td className={tdCls + ' font-medium text-gray-900'}>{h.nome_inscrito ?? '-'}</td>
                        <td className={tdCls + ' text-xs text-gray-500'}>{nomeSup(h.supervisao_id ?? null)}</td>
                        <td className={tdCls}>{h.alojamento_nome ?? <span className="text-gray-400 italic">Não alocado</span>}</td>
                        <td className={tdCls + ' font-mono text-xs font-semibold'}>{h.numero_cama ?? <span className="text-gray-300">—</span>}</td>
                        <td className={tdCls}>
                          {h.tipo_cama ? (
                            <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                              h.tipo_cama === 'inferior' ? 'bg-sky-100 text-sky-700' : 'bg-gray-100 text-gray-600'
                            }`}>
                              {h.tipo_cama === 'inferior' ? '⬇ Inf.' : '⬆ Sup.'}
                            </span>
                          ) : <span className="text-gray-300">—</span>}
                        </td>
                        <td className={tdCls}>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${stCfg.cls}`}>{stCfg.label}</span>
                        </td>
                        <td className={tdCls + ' text-right font-mono text-xs'}>{h.prioridade}</td>
                        <td className={tdCls + ' text-center'}>
                          {h.necessidade_especial ? (
                            <span title={h.descricao_necessidade ?? ''} className="cursor-help">🦽</span>
                          ) : '—'}
                        </td>
                        <td className={tdCls}>
                          <div className="flex gap-1 items-center">
                            {h.status !== 'confirmada' && (
                              <button
                                onClick={() => acaoRapida(h, 'confirmada')}
                                disabled={carregando}
                                title="Confirmar hospedagem"
                                className="text-xs px-2 py-1 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition disabled:opacity-40">
                                ✅
                              </button>
                            )}
                            {h.status !== 'lista_espera' && (
                              <button
                                onClick={() => acaoRapida(h, 'lista_espera')}
                                disabled={carregando}
                                title="Mover para lista de espera"
                                className="text-xs px-2 py-1 rounded-lg bg-orange-500 text-white hover:bg-orange-600 transition disabled:opacity-40">
                                ⏳
                              </button>
                            )}
                            <button
                              onClick={() => abrirEdicao(h)}
                              disabled={carregando}
                              title="Editar leito e dados"
                              className="text-xs px-2 py-1 rounded-lg bg-[#123b63] text-white hover:bg-[#0f2a45] transition disabled:opacity-40">
                              ✏️
                            </button>
                            <button
                              onClick={() => removerHospedagem(h)}
                              disabled={carregando}
                              title="Remover hospedagem"
                              className="text-xs px-2 py-1 rounded-lg bg-red-500 text-white hover:bg-red-600 transition disabled:opacity-40">
                              🗑️
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ════════════ SUB-ABA: ALOJAMENTOS ══════════════════════ */}
      {subAba === 'alojamentos' && (
        <SecaoAlojamentos
          eventoId={eventoId}
          alojamentos={alojamentos}
          loading={loadingAloj}
          onRefresh={fetchAlojamentos}
        />
      )}

      {/* ════════════ SUB-ABA: RELATÓRIOS ══════════════════════ */}
      {subAba === 'relatorios' && (
        <SecaoRelatorios
          hospedagens={hospedagens}
          alojamentos={alojamentos}
          nomeSup={nomeSup}
          nomeCampo={nomeCampo}
          eventoId={eventoId}
          exportarCSV={exportarCSV}
        />
      )}

      {/* ════════════ MODAL EDIÇÃO ══════════════════════════════ */}
      {editando && editForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setEditando(null)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-5">
              <div>
                <h3 className="font-bold text-[#123b63] text-base">✏️ Editar Hospedagem</h3>
                <p className="text-xs text-gray-500 mt-0.5">{editando.nome_inscrito}</p>
              </div>
              <button onClick={() => setEditando(null)} className="text-gray-400 hover:text-gray-700 text-xl font-bold leading-none">×</button>
            </div>

            {erroEdit && (
              <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg text-sm">{erroEdit}</div>
            )}

            <div className="space-y-4">
              <div>
                <label className={labelCls}>Alojamento</label>
                <select
                  value={editForm.alojamento_id}
                  onChange={e => setEditForm(f => f ? { ...f, alojamento_id: e.target.value } : f)}
                  className={inputCls}
                >
                  <option value="">Sem alojamento</option>
                  {alojamentos.filter(a => a.ativo).map(a => (
                    <option key={a.id} value={a.id}>
                      {a.nome} ({a.sexo === 'M' ? 'Masc' : a.sexo === 'F' ? 'Fem' : 'Misto'}) — {a.vagas_livres ?? 0}/{a.total_vagas} livres
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className={labelCls}>Tipo de Cama</label>
                <select
                  value={editForm.tipo_cama}
                  onChange={e => setEditForm(f => f ? { ...f, tipo_cama: e.target.value } : f)}
                  className={inputCls}
                >
                  <option value="">Não definido</option>
                  <option value="inferior">⬇ Inferior</option>
                  <option value="superior">⬆ Superior</option>
                </select>
              </div>

              <div>
                <label className={labelCls}>Número do leito</label>
                <input
                  type="text"
                  value={editForm.numero_cama}
                  onChange={e => setEditForm(f => f ? { ...f, numero_cama: e.target.value } : f)}
                  placeholder="Ex: 01, A-12, 120"
                  maxLength={20}
                  className={inputCls}
                />
              </div>

              <div>
                <label className={labelCls}>Status</label>
                <select
                  value={editForm.status}
                  onChange={e => setEditForm(f => f ? { ...f, status: e.target.value } : f)}
                  className={inputCls}
                >
                  <option value="solicitada">Solicitada</option>
                  <option value="confirmada">Confirmada</option>
                  <option value="lista_espera">Lista de Espera</option>
                  <option value="recusada">Recusada</option>
                </select>
              </div>

              <div>
                <label className={labelCls}>Observações</label>
                <textarea
                  value={editForm.observacoes}
                  onChange={e => setEditForm(f => f ? { ...f, observacoes: e.target.value } : f)}
                  rows={3}
                  className={inputCls + ' resize-y'}
                />
              </div>

              {/* Info prioridade e nec. especial */}
              <div className="bg-gray-50 rounded-lg px-4 py-3 text-xs text-gray-600 space-y-1">
                <p><span className="font-semibold">Prioridade calculada:</span> {editando.prioridade}</p>
                {editando.necessidade_especial && (
                  <p><span className="font-semibold">🦽 Necessidade especial:</span> {editando.descricao_necessidade}</p>
                )}
                {editando.cama_inferior && (
                  <p>⬇ Solicitou cama inferior</p>
                )}
                <p><span className="font-semibold">Alocação automática:</span> {editando.alocacao_automatica ? 'Sim' : 'Não (manual)'}</p>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button onClick={() => setEditando(null)}
                className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition">
                Cancelar
              </button>
              <button onClick={salvarEdicao} disabled={salvandoEdit}
                className="flex-1 px-4 py-2.5 rounded-xl bg-[#123b63] text-white text-sm font-bold hover:bg-[#0f2a45] transition disabled:opacity-50">
                {salvandoEdit ? 'Salvando...' : '✅ Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// SEÇÃO: GERENCIAR ALOJAMENTOS
// ════════════════════════════════════════════════════════════════════════════
function SecaoAlojamentos({
  eventoId,
  alojamentos,
  loading,
  onRefresh,
}: {
  eventoId: string;
  alojamentos: Alojamento[];
  loading: boolean;
  onRefresh: () => void;
}) {
  const [form, setForm] = useState({
    nome: '', publico: 'masculino_geral' as string, total_vagas: '20',
    camas_inferiores: '10', camas_superiores: '10',
  });
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);

  async function criarAlojamento(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    if (!form.nome.trim()) return setErro('Nome obrigatório.');
    setSalvando(true);
    try {
      const res = await fetch(`/api/eventos/${eventoId}/alojamentos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome: form.nome.trim(),
          publico: form.publico,
          sexo: form.publico === 'feminino' ? 'F' : form.publico === 'misto' ? null : 'M',
          total_vagas: parseInt(form.total_vagas) || 0,
          camas_inferiores: parseInt(form.camas_inferiores) || 0,
          camas_superiores: parseInt(form.camas_superiores) || 0,
        }),
      });
      if (!res.ok) { const j = await res.json(); throw new Error(j.error ?? 'Erro'); }
      setSucesso(`Alojamento "${form.nome}" criado com sucesso!`);
      setForm({ nome: '', publico: 'masculino_geral', total_vagas: '20', camas_inferiores: '10', camas_superiores: '10' });
      onRefresh();
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao criar');
    } finally {
      setSalvando(false);
    }
  }

  async function toggleAtivo(aloj: Alojamento) {
    await fetch(`/api/eventos/${eventoId}/alojamentos`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: aloj.id, ativo: !aloj.ativo }),
    });
    onRefresh();
  }

  return (
    <div className="space-y-5">
      {/* Formulário criar alojamento */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
        <h3 className="font-bold text-[#123b63] mb-4">➕ Novo Alojamento</h3>
        {erro && <div className="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</div>}
        {sucesso && <div className="mb-3 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">{sucesso}</div>}
        <form onSubmit={criarAlojamento}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div className="md:col-span-3">
              <label className={labelCls}>Nome do alojamento *</label>
              <input type="text" value={form.nome} onChange={e => setForm(f => ({ ...f, nome: e.target.value }))}
                placeholder="Ex: Bloco A — Masculino" className={inputCls} required />
            </div>
            <div>
              <label className={labelCls}>Público</label>
              <select value={form.publico} onChange={e => setForm(f => ({ ...f, publico: e.target.value }))} className={inputCls}>
                <option value="masculino_geral">👨 Masculino (Geral)</option>
                <option value="feminino">👩 Feminino</option>
                <option value="presidentes">👨 Presidentes</option>
                <option value="jubilados">👨 Jubilados</option>
                <option value="misto">👥 Misto</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Total de vagas</label>
              <input type="number" min="1" value={form.total_vagas}
                onChange={e => setForm(f => ({ ...f, total_vagas: e.target.value }))} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Camas inferiores</label>
              <input type="number" min="0" value={form.camas_inferiores}
                onChange={e => setForm(f => ({ ...f, camas_inferiores: e.target.value }))} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Camas superiores</label>
              <input type="number" min="0" value={form.camas_superiores}
                onChange={e => setForm(f => ({ ...f, camas_superiores: e.target.value }))} className={inputCls} />
            </div>
          </div>
          <button type="submit" disabled={salvando}
            className="bg-[#123b63] text-white px-6 py-2.5 rounded-lg text-sm font-semibold hover:bg-[#0f2a45] transition disabled:opacity-50">
            {salvando ? 'Criando...' : '✅ Criar Alojamento'}
          </button>
        </form>
      </div>

      {/* Lista de alojamentos */}
      {loading ? (
        <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="bg-white rounded-xl h-16 animate-pulse" />)}</div>
      ) : alojamentos.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
          <span className="text-4xl mb-3 block">🏠</span>
          <p className="text-gray-500 font-medium">Nenhum alojamento cadastrado</p>
          <p className="text-xs text-gray-400 mt-1">Adicione alojamentos acima para começar a alocar participantes.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {alojamentos.map(aloj => {
            const vagsLivres = aloj.vagas_livres ?? 0;
            const ocupados   = aloj.total_vagas - vagsLivres;
            const pct = aloj.total_vagas > 0 ? Math.round((ocupados / aloj.total_vagas) * 100) : 0;
            const cor = pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-orange-500' : 'bg-emerald-500';
            const PUBLICO_LABEL: Record<string, string> = {
              feminino: '👩 Feminino', masculino_geral: '👨 Masculino (Geral)',
              presidentes: '👨 Presidentes', jubilados: '👨 Jubilados', misto: '👥 Misto',
            };
            return (
              <div key={aloj.id} className={`bg-white rounded-xl border shadow-sm p-5 ${!aloj.ativo ? 'opacity-60' : 'border-gray-200'}`}>
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h4 className="font-bold text-gray-900 text-sm">{aloj.nome}</h4>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {PUBLICO_LABEL[aloj.publico] ?? aloj.publico} · {aloj.total_vagas} vagas
                    </p>
                  </div>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${aloj.ativo ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                    {aloj.ativo ? 'Ativo' : 'Inativo'}
                  </span>
                </div>

                {/* Barra de ocupação */}
                <div className="mb-3">
                  <div className="flex justify-between text-xs text-gray-500 mb-1">
                    <span>{ocupados}/{aloj.total_vagas} ocupados</span>
                    <span className={pct >= 100 ? 'text-red-600 font-bold' : ''}>{pct}%</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${cor}`} style={{ width: `${Math.min(100, pct)}%` }} />
                  </div>
                </div>

                <div className="flex gap-1.5 text-xs text-gray-500 mb-3">
                  <span className="bg-sky-50 text-sky-700 px-2 py-0.5 rounded-full">⬇ {aloj.camas_inferiores} inf.</span>
                  <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">⬆ {aloj.camas_superiores} sup.</span>
                </div>

                <button onClick={() => toggleAtivo(aloj)}
                  className="w-full text-xs py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition font-semibold">
                  {aloj.ativo ? 'Desativar' : 'Ativar'}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// SEÇÃO: RELATÓRIOS DE HOSPEDAGEM
// ════════════════════════════════════════════════════════════════════════════
type RelHospTipo = 'geral' | 'por_alojamento' | 'masculino' | 'feminino' | 'nec_especial' | 'cama_inferior' | 'lista_espera';

function SecaoRelatorios({
  hospedagens,
  alojamentos,
  nomeSup: _nomeSup,
  nomeCampo: _nomeCampo,
  eventoId,
  exportarCSV,
}: {
  hospedagens: Hospedagem[];
  alojamentos: Alojamento[];
  nomeSup: (id: string | null) => string;
  nomeCampo: (id: string | null) => string;
  eventoId: string;
  exportarCSV: (lista: Hospedagem[], nome: string) => void;
}) {
  const [relTipo, setRelTipo] = useState<RelHospTipo>('geral');
  const [filtroAloj, setFiltroAloj] = useState('');

  const REL_TABS: { id: RelHospTipo; label: string; icon: string }[] = [
    { id: 'geral',         label: 'Geral',          icon: '📋' },
    { id: 'por_alojamento',label: 'Por Alojamento', icon: '🏠' },
    { id: 'masculino',     label: 'Masculino',      icon: '👨' },
    { id: 'feminino',      label: 'Feminino',       icon: '👩' },
    { id: 'nec_especial',  label: 'Nec. Especial',  icon: '🦽' },
    { id: 'cama_inferior', label: 'Cama Inferior',  icon: '⬇' },
    { id: 'lista_espera',  label: 'Lista Espera',   icon: '⏳' },
  ];

  const lista = useMemo(() => {
    let l = hospedagens;
    if (relTipo === 'masculino')     l = l.filter(h => h.sexo === 'M');
    if (relTipo === 'feminino')      l = l.filter(h => h.sexo === 'F');
    if (relTipo === 'nec_especial')  l = l.filter(h => h.necessidade_especial);
    if (relTipo === 'cama_inferior') l = l.filter(h => h.cama_inferior);
    if (relTipo === 'lista_espera')  l = l.filter(h => h.status === 'lista_espera');
    if (relTipo === 'por_alojamento' && filtroAloj) l = l.filter(h => h.alojamento_id === filtroAloj);
    return l;
  }, [hospedagens, relTipo, filtroAloj]);

  const porAlojamento = useMemo(() => {
    const map = new Map<string, { nome: string; total: number; confirmadas: number; lista_espera: number }>();
    hospedagens.forEach(h => {
      const k = h.alojamento_id ?? '__sem__';
      const nome = h.alojamento_nome ?? 'Sem alojamento';
      const cur = map.get(k) ?? { nome, total: 0, confirmadas: 0, lista_espera: 0 };
      cur.total++;
      if (h.status === 'confirmada')   cur.confirmadas++;
      if (h.status === 'lista_espera') cur.lista_espera++;
      map.set(k, cur);
    });
    return Array.from(map.values()).sort((a, b) => a.nome.localeCompare(b.nome));
  }, [hospedagens]);

  function imprimir() {
    const params = new URLSearchParams({
      tipo: 'hospedagem',
      rel: relTipo,
      ...(filtroAloj ? { aloj: filtroAloj } : {}),
    });
    window.open(`/eventos/${eventoId}/relatorios/print?${params}`, '_blank', 'width=960,height=720');
  }

  const thR = 'text-left text-xs font-semibold text-gray-500 uppercase tracking-wide py-2.5 px-3 bg-gray-50 whitespace-nowrap';
  const tdR = 'py-2.5 px-3 text-sm text-gray-700 border-t border-gray-50 whitespace-nowrap';
  const tdN = `${tdR} text-right tabular-nums`;

  return (
    <div className="space-y-4">
      {/* Sub-tabs relatório */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 overflow-x-auto">
        {REL_TABS.map(t => (
          <button key={t.id} onClick={() => setRelTipo(t.id)}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition whitespace-nowrap flex-shrink-0 ${
              relTipo === t.id ? 'bg-white text-[#123b63] shadow-sm' : 'text-gray-500 hover:text-gray-800'
            }`}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* Ações + filtro alojamento */}
      <div className="flex flex-wrap gap-3 items-center">
        {relTipo === 'por_alojamento' && (
          <select value={filtroAloj} onChange={e => setFiltroAloj(e.target.value)}
            className="w-full sm:w-auto border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#123b63]">
            <option value="">Todos os alojamentos</option>
            {alojamentos.map(a => <option key={a.id} value={a.id}>{a.nome}</option>)}
          </select>
        )}
        <div className="ml-auto flex flex-wrap gap-2">
          <button onClick={() => exportarCSV(lista, relTipo)}
            className="w-full sm:w-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-semibold text-gray-700 hover:bg-gray-50 transition">
            📥 CSV
          </button>
          <button onClick={imprimir}
            className="w-full sm:w-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#123b63] text-white text-xs font-semibold hover:bg-[#0f2a45] transition">
            🖨️ Imprimir
          </button>
        </div>
      </div>

      <p className="text-xs text-gray-400">{lista.length} registro(s)</p>

      {/* ── POR ALOJAMENTO (resumo) ─────── */}
      {relTipo === 'por_alojamento' && !filtroAloj && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
          <table className="w-full min-w-[720px]">
            <thead><tr>
              <th className={thR}>Alojamento</th>
              <th className={thR + ' text-right'}>Total</th>
              <th className={thR + ' text-right'}>Confirmados</th>
              <th className={thR + ' text-right'}>Lista Espera</th>
            </tr></thead>
            <tbody>
              {porAlojamento.map(r => (
                <tr key={r.nome} className="hover:bg-gray-50 transition">
                  <td className={tdR + ' font-medium'}>{r.nome}</td>
                  <td className={tdN}>{r.total}</td>
                  <td className={tdN + ' text-emerald-700'}>{r.confirmadas}</td>
                  <td className={tdN + ' text-orange-700'}>{r.lista_espera}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── LISTA DETALHADA ─────────────── */}
      {(relTipo !== 'por_alojamento' || filtroAloj) && (
        lista.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
            <p className="text-gray-500">Nenhum registro neste relatório.</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
            <table className="w-full min-w-[900px]">
              <thead><tr>
                <th className={thR}>#</th>
                <th className={thR}>Nome</th>
                <th className={thR}>Alojamento</th>
                <th className={thR}>Leito</th>
                <th className={thR}>Tipo Cama</th>
                <th className={thR}>Status</th>
                <th className={thR + ' text-center'}>🦽</th>
                <th className={thR}>Obs.</th>
              </tr></thead>
              <tbody>
                {lista.map((h, idx) => {
                  const stCfg = STATUS_HOSP_CFG[h.status] ?? STATUS_HOSP_CFG.solicitada;
                  return (
                    <tr key={h.id} className="hover:bg-gray-50 transition">
                      <td className={tdR + ' text-gray-400'}>{idx + 1}</td>
                      <td className={tdR + ' font-medium text-gray-900'}>{h.nome_inscrito}</td>
                      <td className={tdR}>{h.alojamento_nome ?? <span className="text-gray-400 italic">—</span>}</td>
                      <td className={tdR + ' font-mono text-xs font-semibold'}>{h.numero_cama ?? '—'}</td>
                      <td className={tdR}>
                        {h.tipo_cama ? (
                          <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                            h.tipo_cama === 'inferior' ? 'bg-sky-100 text-sky-700' : 'bg-gray-100 text-gray-600'
                          }`}>
                            {h.tipo_cama === 'inferior' ? '⬇ Inf.' : '⬆ Sup.'}
                          </span>
                        ) : '—'}
                      </td>
                      <td className={tdR}>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${stCfg.cls}`}>{stCfg.label}</span>
                      </td>
                      <td className={tdR + ' text-center'}>
                        {h.necessidade_especial ? (
                          <span title={h.descricao_necessidade ?? ''} className="cursor-help text-sm">🦽</span>
                        ) : '—'}
                      </td>
                      <td className={tdR + ' max-w-[220px] truncate text-xs text-gray-500'}>{h.observacoes ?? '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
}
