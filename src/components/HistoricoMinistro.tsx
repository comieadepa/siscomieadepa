'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase-client';

// ─── Tipos ──────────────────────────────────────────────────────────────────

interface HistoryEntry {
  id: string;
  tipo: string;
  titulo?: string | null;
  descricao: string;
  usuario_nome?: string | null;
  ocorrencia: string;
  created_at: string;
  origem?: string | null;
  referencia_id?: string | null;
}

export interface HistoricoMinistroProps {
  memberId: string;
  memberName: string;
  matricula: string;
  cargo?: string;
  cpf?: string;
  campo?: string;
  supervisao?: string;
  onClose: () => void;
}

// ─── Metadados de tipos ──────────────────────────────────────────────────────

interface TipoMeta { label: string; dot: string; badge: string }

const TIPO_META: Record<string, TipoMeta> = {
  credencial_emitida:        { label: 'Credencial emitida',            dot: 'bg-blue-500',    badge: 'bg-blue-100 text-blue-800' },
  carta_emitida:             { label: 'Carta ministerial',             dot: 'bg-green-500',   badge: 'bg-green-100 text-green-800' },
  progressao_ministerial:    { label: 'Progressão ministerial',        dot: 'bg-purple-500',  badge: 'bg-purple-100 text-purple-800' },
  consagracao:               { label: 'Consagração / Ordenação',       dot: 'bg-yellow-500',  badge: 'bg-yellow-100 text-yellow-900' },
  apresentacao:              { label: 'Apresentação ministerial',      dot: 'bg-teal-500',    badge: 'bg-teal-100 text-teal-800' },
  deliberacao_comissao:      { label: 'Deliberação em comissão',       dot: 'bg-orange-500',  badge: 'bg-orange-100 text-orange-800' },
  assumiu_pastor_presidente: { label: 'Assumiu como Pastor Presidente',dot: 'bg-red-500',     badge: 'bg-red-100 text-red-800' },
  transferencia:             { label: 'Transferência ministerial',     dot: 'bg-indigo-500',  badge: 'bg-indigo-100 text-indigo-800' },
  mudanca_de_campo:          { label: 'Mudança de campo',              dot: 'bg-cyan-500',    badge: 'bg-cyan-100 text-cyan-800' },
  jubilacao:                 { label: 'Jubilação',                     dot: 'bg-amber-500',   badge: 'bg-amber-100 text-amber-800' },
  reativacao:                { label: 'Reativação',                    dot: 'bg-emerald-500', badge: 'bg-emerald-100 text-emerald-800' },
  desligamento:              { label: 'Desligamento',                  dot: 'bg-rose-600',    badge: 'bg-rose-100 text-rose-900' },
  observacao_manual:         { label: 'Observação manual',             dot: 'bg-gray-400',    badge: 'bg-gray-100 text-gray-700' },
  // legado
  Manual:                          { label: 'Manual',                       dot: 'bg-gray-400',    badge: 'bg-gray-100 text-gray-700' },
  'Credencial emitida':            { label: 'Credencial emitida',           dot: 'bg-blue-500',    badge: 'bg-blue-100 text-blue-800' },
  'Carta de Mudança emitida':      { label: 'Carta de Mudança',             dot: 'bg-green-500',   badge: 'bg-green-100 text-green-800' },
  'Carta de Recomendação emitida': { label: 'Carta de Recomendação',        dot: 'bg-teal-500',    badge: 'bg-teal-100 text-teal-800' },
  'Documento adicionado':          { label: 'Documento adicionado',         dot: 'bg-indigo-400',  badge: 'bg-indigo-100 text-indigo-800' },
  'Status alterado':               { label: 'Status alterado',              dot: 'bg-amber-500',   badge: 'bg-amber-100 text-amber-800' },
  'Dados atualizados':             { label: 'Dados atualizados',            dot: 'bg-purple-400',  badge: 'bg-purple-100 text-purple-800' },
  'Ordenação registrada':          { label: 'Ordenação registrada',         dot: 'bg-yellow-500',  badge: 'bg-yellow-100 text-yellow-900' },
  'Ocorrência disciplinar':        { label: 'Ocorrência disciplinar',       dot: 'bg-red-500',     badge: 'bg-red-100 text-red-800' },
  Outro:                           { label: 'Outro',                        dot: 'bg-slate-400',   badge: 'bg-slate-100 text-slate-700' },
};

function getTipoMeta(tipo: string): TipoMeta {
  return TIPO_META[tipo] ?? { label: tipo, dot: 'bg-gray-400', badge: 'bg-gray-100 text-gray-700' };
}

const TIPOS_FORM = [
  { value: 'observacao_manual',         label: 'Observação manual' },
  { value: 'progressao_ministerial',    label: 'Progressão ministerial' },
  { value: 'consagracao',               label: 'Consagração / Ordenação' },
  { value: 'apresentacao',              label: 'Apresentação ministerial' },
  { value: 'deliberacao_comissao',      label: 'Deliberação em comissão' },
  { value: 'assumiu_pastor_presidente', label: 'Assumiu como Pastor Presidente' },
  { value: 'transferencia',             label: 'Transferência ministerial' },
  { value: 'mudanca_de_campo',          label: 'Mudança de campo' },
  { value: 'jubilacao',                 label: 'Jubilação' },
  { value: 'reativacao',                label: 'Reativação' },
  { value: 'desligamento',              label: 'Desligamento' },
];

const ORIGENS_LABEL: Record<string, string> = {
  credencial:  'Automático · Credencial',
  carta:       'Automático · Carta',
  consagracao: 'Automático · Consagração',
  progressao:  'Automático · Progressão',
  sistema:     'Automático · Sistema',
  manual:      'Manual',
};

// ─── Utilitários ─────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  if (!iso) return '—';
  const d = iso.length === 10 ? new Date(iso + 'T00:00:00') : new Date(iso);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function fmtDatetime(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function origemBadge(origem?: string | null) {
  if (!origem) return null;
  const label = ORIGENS_LABEL[origem] ?? `Automático · ${origem}`;
  return { label, isAuto: origem !== 'manual' };
}

// ─── Componente principal ────────────────────────────────────────────────────

export default function HistoricoMinistro({
  memberId,
  memberName,
  matricula,
  cargo,
  cpf,
  campo,
  supervisao,
  onClose,
}: HistoricoMinistroProps) {
  const [history, setHistory]   = useState<HistoryEntry[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');

  // Filtros
  const [filterTipo,  setFilterTipo]  = useState('');
  const [filterBusca, setFilterBusca] = useState('');
  const [filterFrom,  setFilterFrom]  = useState('');
  const [filterTo,    setFilterTo]    = useState('');

  // Formulário
  const [showForm,    setShowForm]    = useState(false);
  const [fTipo,       setFTipo]       = useState(TIPOS_FORM[0].value);
  const [fTitulo,     setFTitulo]     = useState('');
  const [fDescricao,  setFDescricao]  = useState('');
  const [fOcorrencia, setFOcorrencia] = useState(new Date().toISOString().split('T')[0]);
  const [saving,      setSaving]      = useState(false);
  const [saveError,   setSaveError]   = useState('');

  // ─── Auth ─────────────────────────────────────────────────────────────────

  const getAuthHeader = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token || '';
    return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  }, []);

  // ─── Fetch ────────────────────────────────────────────────────────────────

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const headers = await getAuthHeader();
      const res = await fetch(`/api/membros/${memberId}/historico`, { headers });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Erro ao carregar histórico');
      setHistory(json.history || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [memberId, getAuthHeader]);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  // ─── Filtro client-side ───────────────────────────────────────────────────

  const filtered = useMemo(() => {
    return history.filter(entry => {
      if (filterTipo && entry.tipo !== filterTipo) return false;
      if (filterBusca) {
        const busca = filterBusca.toLowerCase();
        if (![entry.titulo, entry.descricao, entry.usuario_nome].join(' ').toLowerCase().includes(busca)) return false;
      }
      if (filterFrom && entry.ocorrencia < filterFrom) return false;
      if (filterTo   && entry.ocorrencia > filterTo)   return false;
      return true;
    });
  }, [history, filterTipo, filterBusca, filterFrom, filterTo]);

  const hasFilters = !!(filterTipo || filterBusca || filterFrom || filterTo);

  // ─── Salvar registro manual ───────────────────────────────────────────────

  const handleSave = async () => {
    if (!fDescricao.trim()) { setSaveError('Descrição obrigatória.'); return; }
    setSaving(true);
    setSaveError('');
    try {
      const headers = await getAuthHeader();
      const res = await fetch(`/api/membros/${memberId}/historico`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          tipo: fTipo,
          titulo: fTitulo.trim() || getTipoMeta(fTipo).label,
          descricao: fDescricao.trim(),
          ocorrencia: fOcorrencia,
          origem: null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Erro ao salvar');
      setFDescricao('');
      setFTitulo('');
      setFTipo(TIPOS_FORM[0].value);
      setFOcorrencia(new Date().toISOString().split('T')[0]);
      setShowForm(false);
      await fetchHistory();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  // ─── Impressão ────────────────────────────────────────────────────────────

  const handlePrint = () => window.print();
  const emissaoStr  = fmtDatetime(new Date().toISOString());
  const printRecords = filtered.length > 0 || hasFilters ? filtered : history;

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <>
      {/* CSS de impressão A4 */}
      <style>{`
        @media print {
          @page { size: A4; margin: 1.5cm; }
          body > * { visibility: hidden; }
          #hist-print-area, #hist-print-area * { visibility: visible; }
          #hist-print-area { position: absolute; top: 0; left: 0; width: 100%; }
        }
      `}</style>

      {/* ── Modal de tela ─────────────────────────────────────────────────── */}
      <div className="fixed inset-0 bg-black/60 flex items-start justify-center z-50 p-4 overflow-y-auto">
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl flex flex-col my-6">

          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 bg-gradient-to-r from-[#0D2B4E] to-[#1a4a7a] rounded-t-xl flex-shrink-0">
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Histórico do Ministro
              </h2>
              <p className="text-xs text-blue-200 mt-0.5">{matricula} — {memberName}</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handlePrint}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white text-xs font-medium rounded-md border border-white/20 transition"
                title="Imprimir ficha de histórico ministerial"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                </svg>
                Imprimir
              </button>
              <button onClick={onClose} className="text-white hover:text-gray-300 text-2xl leading-none ml-1">✕</button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-4 max-h-[80vh]">

            {/* Barra de ações */}
            <div className="flex flex-wrap items-center gap-2">
              {!showForm && (
                <button
                  onClick={() => setShowForm(true)}
                  className="flex items-center gap-2 px-4 py-2 bg-[#0D2B4E] hover:bg-[#1a4a7a] text-white text-sm font-semibold rounded-md transition"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Novo Registro
                </button>
              )}
              <span className="ml-auto text-xs text-gray-400">
                {filtered.length} {filtered.length === 1 ? 'registro' : 'registros'}
                {hasFilters ? ' (filtrado)' : ''}
              </span>
            </div>

            {/* Formulário de novo registro */}
            {showForm && (
              <div className="border border-blue-200 bg-blue-50 rounded-xl p-4 space-y-3">
                <h3 className="text-sm font-bold text-[#0D2B4E]">Novo Registro Manual</h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-gray-600 mb-1 block">Tipo</label>
                    <select
                      value={fTipo}
                      onChange={e => setFTipo(e.target.value)}
                      className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#0D2B4E]"
                    >
                      {TIPOS_FORM.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-600 mb-1 block">Data do fato</label>
                    <input
                      type="date"
                      value={fOcorrencia}
                      onChange={e => setFOcorrencia(e.target.value)}
                      className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#0D2B4E]"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-gray-600 mb-1 block">Título <span className="text-gray-400 font-normal">(opcional)</span></label>
                  <input
                    type="text"
                    value={fTitulo}
                    onChange={e => setFTitulo(e.target.value)}
                    placeholder={getTipoMeta(fTipo).label}
                    maxLength={200}
                    className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#0D2B4E]"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-gray-600 mb-1 block">Descrição <span className="text-red-500">*</span></label>
                  <textarea
                    value={fDescricao}
                    onChange={e => setFDescricao(e.target.value)}
                    placeholder="Descreva o fato ministerial..."
                    rows={3}
                    className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#0D2B4E] resize-none"
                  />
                </div>

                {saveError && <p className="text-xs text-red-600">{saveError}</p>}

                <div className="flex gap-2 justify-end">
                  <button
                    onClick={() => { setShowForm(false); setSaveError(''); }}
                    className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-md transition"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="px-4 py-2 bg-[#0D2B4E] hover:bg-[#1a4a7a] disabled:opacity-60 text-white text-sm font-semibold rounded-md transition"
                  >
                    {saving ? 'Salvando...' : 'Salvar'}
                  </button>
                </div>
              </div>
            )}

            {/* Filtros */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-gray-50 border border-gray-200 rounded-lg p-3">
              <input
                type="search"
                value={filterBusca}
                onChange={e => setFilterBusca(e.target.value)}
                placeholder="Buscar..."
                className="col-span-2 sm:col-span-1 text-xs border border-gray-300 rounded-md px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-[#0D2B4E]"
              />
              <select
                value={filterTipo}
                onChange={e => setFilterTipo(e.target.value)}
                className="text-xs border border-gray-300 rounded-md px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-[#0D2B4E]"
              >
                <option value="">Todos os tipos</option>
                {[
                  ...TIPOS_FORM,
                  { value: 'credencial_emitida', label: 'Credencial emitida' },
                  { value: 'carta_emitida',      label: 'Carta ministerial' },
                ].map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              <input
                type="date"
                value={filterFrom}
                onChange={e => setFilterFrom(e.target.value)}
                title="A partir de"
                className="text-xs border border-gray-300 rounded-md px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-[#0D2B4E]"
              />
              <div className="flex items-center gap-1">
                <input
                  type="date"
                  value={filterTo}
                  onChange={e => setFilterTo(e.target.value)}
                  title="Até"
                  className="flex-1 text-xs border border-gray-300 rounded-md px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-[#0D2B4E]"
                />
                {hasFilters && (
                  <button
                    onClick={() => { setFilterTipo(''); setFilterBusca(''); setFilterFrom(''); setFilterTo(''); }}
                    className="text-xs text-gray-400 hover:text-red-600 px-1 rounded transition"
                    title="Limpar filtros"
                  >✕</button>
                )}
              </div>
            </div>

            {/* Timeline */}
            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3].map(i => (
                  <div key={i} className="flex gap-3">
                    <div className="flex flex-col items-center gap-1">
                      <div className="w-3 h-3 rounded-full bg-gray-200 animate-pulse mt-1" />
                      <div className="w-0.5 h-12 bg-gray-100" />
                    </div>
                    <div className="flex-1 h-16 bg-gray-100 rounded-lg animate-pulse" />
                  </div>
                ))}
              </div>
            ) : error ? (
              <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-4">
                <p className="font-medium">Erro ao carregar histórico</p>
                <p className="mt-1 text-xs">{error}</p>
                <button onClick={fetchHistory} className="mt-2 text-xs underline">Tentar novamente</button>
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-12 text-gray-400">
                <svg className="w-10 h-10 mx-auto mb-2 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-sm">
                  {hasFilters ? 'Nenhum registro para os filtros aplicados.' : 'Nenhum registro no histórico.'}
                </p>
              </div>
            ) : (
              <div>
                {filtered.map((entry, idx) => {
                  const meta   = getTipoMeta(entry.tipo);
                  const orig   = origemBadge(entry.origem);
                  const titulo = entry.titulo || meta.label;
                  const isLast = idx === filtered.length - 1;

                  return (
                    <div key={entry.id} className="flex gap-3">
                      {/* Linha do tempo */}
                      <div className="flex flex-col items-center flex-shrink-0">
                        <div className={`w-3 h-3 rounded-full mt-1.5 ${meta.dot}`} />
                        {!isLast && <div className="w-0.5 flex-1 bg-gray-200 mt-1" />}
                      </div>

                      {/* Conteúdo */}
                      <div className="flex-1 min-w-0 pb-3">
                        <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 hover:bg-white transition">
                          <div className="flex flex-wrap items-center gap-1.5 mb-1">
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${meta.badge}`}>
                              {meta.label}
                            </span>
                            {orig && (
                              <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">
                                {orig.label}
                              </span>
                            )}
                            <span className="text-xs text-gray-500 ml-auto">{fmtDate(entry.ocorrencia)}</span>
                          </div>
                          {titulo !== meta.label && (
                            <p className="text-sm font-semibold text-gray-800 mb-0.5">{titulo}</p>
                          )}
                          <p className="text-sm text-gray-700 leading-snug">{entry.descricao}</p>
                          <p className="text-xs text-gray-400 mt-1">
                            Registrado em {fmtDatetime(entry.created_at)}
                            {entry.usuario_nome ? ` · ${entry.usuario_nome}` : ''}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Área de impressão A4 (visível apenas no print) ────────────────── */}
      <div id="hist-print-area" style={{ display: 'none' }}>
        {/* Cabeçalho institucional */}
        <div style={{ borderBottom: '2px solid #0D2B4E', paddingBottom: '10px', marginBottom: '16px', textAlign: 'center' }}>
          <p style={{ fontSize: '10px', fontWeight: 600, color: '#6b7280', letterSpacing: '0.1em', textTransform: 'uppercase', margin: 0 }}>
            COMIEADEPA — Convenção de Ministros das Assembleias de Deus do Estado do Pará
          </p>
          <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#0D2B4E', margin: '4px 0 2px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Histórico Ministerial
          </h1>
          <p style={{ fontSize: '9px', color: '#9ca3af', margin: 0 }}>SISCOMIEADEPA · Sistema de Gestão Ministerial</p>
        </div>

        {/* Dados do ministro */}
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px', marginBottom: '16px' }}>
          <tbody>
            <tr style={{ background: '#f0f4fa' }}>
              <td style={{ border: '1px solid #d1d5db', padding: '4px 8px', fontWeight: 700, width: '15%' }}>Ministro</td>
              <td style={{ border: '1px solid #d1d5db', padding: '4px 8px', fontWeight: 600, width: '35%' }}>{memberName}</td>
              <td style={{ border: '1px solid #d1d5db', padding: '4px 8px', fontWeight: 700, width: '15%' }}>Matrícula</td>
              <td style={{ border: '1px solid #d1d5db', padding: '4px 8px', width: '35%' }}>{matricula}</td>
            </tr>
            {(cpf || cargo) && (
              <tr>
                <td style={{ border: '1px solid #d1d5db', padding: '4px 8px', fontWeight: 700 }}>CPF</td>
                <td style={{ border: '1px solid #d1d5db', padding: '4px 8px' }}>{cpf || '—'}</td>
                <td style={{ border: '1px solid #d1d5db', padding: '4px 8px', fontWeight: 700 }}>Cargo</td>
                <td style={{ border: '1px solid #d1d5db', padding: '4px 8px' }}>{cargo || '—'}</td>
              </tr>
            )}
            {(campo || supervisao) && (
              <tr style={{ background: '#f9fafb' }}>
                <td style={{ border: '1px solid #d1d5db', padding: '4px 8px', fontWeight: 700 }}>Campo</td>
                <td style={{ border: '1px solid #d1d5db', padding: '4px 8px' }}>{campo || '—'}</td>
                <td style={{ border: '1px solid #d1d5db', padding: '4px 8px', fontWeight: 700 }}>Supervisão</td>
                <td style={{ border: '1px solid #d1d5db', padding: '4px 8px' }}>{supervisao || '—'}</td>
              </tr>
            )}
          </tbody>
        </table>

        {/* Registros */}
        <h2 style={{ fontSize: '11px', fontWeight: 700, color: '#0D2B4E', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #d1d5db', paddingBottom: '4px', marginBottom: '8px' }}>
          Registros ({printRecords.length} {printRecords.length === 1 ? 'item' : 'itens'})
        </h2>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '10px', marginBottom: '24px' }}>
          <thead>
            <tr style={{ background: '#0D2B4E', color: '#ffffff' }}>
              <th style={{ border: '1px solid #374151', padding: '5px 6px', textAlign: 'left', width: '5%' }}>#</th>
              <th style={{ border: '1px solid #374151', padding: '5px 6px', textAlign: 'left', width: '10%' }}>Data</th>
              <th style={{ border: '1px solid #374151', padding: '5px 6px', textAlign: 'left', width: '20%' }}>Tipo</th>
              <th style={{ border: '1px solid #374151', padding: '5px 6px', textAlign: 'left' }}>Título / Descrição</th>
              <th style={{ border: '1px solid #374151', padding: '5px 6px', textAlign: 'left', width: '16%' }}>Origem</th>
              <th style={{ border: '1px solid #374151', padding: '5px 6px', textAlign: 'left', width: '14%' }}>Registrado por</th>
            </tr>
          </thead>
          <tbody>
            {printRecords.map((entry, idx) => {
              const meta   = getTipoMeta(entry.tipo);
              const titulo = entry.titulo || meta.label;
              const orig   = origemBadge(entry.origem);
              return (
                <tr key={entry.id} style={{ background: idx % 2 === 0 ? '#ffffff' : '#f9fafb' }}>
                  <td style={{ border: '1px solid #e5e7eb', padding: '4px 6px', textAlign: 'center', color: '#6b7280' }}>{idx + 1}</td>
                  <td style={{ border: '1px solid #e5e7eb', padding: '4px 6px' }}>{fmtDate(entry.ocorrencia)}</td>
                  <td style={{ border: '1px solid #e5e7eb', padding: '4px 6px', fontWeight: 500 }}>{meta.label}</td>
                  <td style={{ border: '1px solid #e5e7eb', padding: '4px 6px' }}>
                    {titulo !== meta.label && <strong>{titulo} — </strong>}
                    {entry.descricao}
                  </td>
                  <td style={{ border: '1px solid #e5e7eb', padding: '4px 6px', color: '#6b7280' }}>{orig?.label ?? '—'}</td>
                  <td style={{ border: '1px solid #e5e7eb', padding: '4px 6px', color: '#6b7280' }}>{entry.usuario_nome || '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Assinaturas */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '64px', marginBottom: '24px', marginTop: '32px' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ borderTop: '1px solid #6b7280', paddingTop: '4px', fontSize: '10px', color: '#6b7280' }}>Secretário(a) Geral</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ borderTop: '1px solid #6b7280', paddingTop: '4px', fontSize: '10px', color: '#6b7280' }}>Presidente da Comissão</div>
          </div>
        </div>

        {/* Rodapé */}
        <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: '6px', textAlign: 'center', fontSize: '9px', color: '#9ca3af' }}>
          Documento emitido em {emissaoStr} · SISCOMIEADEPA — Sistema de Gestão Ministerial da COMIEADEPA
        </div>
      </div>
    </>
  );
}
