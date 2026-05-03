'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase-client';

interface HistoryEntry {
  id: string;
  tipo: string;
  descricao: string;
  usuario_nome?: string;
  ocorrencia: string;
  created_at: string;
}

interface HistoricoMinistroProps {
  memberId: string;
  memberName: string;
  matricula: string;
  onClose: () => void;
}

const TIPOS_ACAO = [
  'Manual',
  'Credencial emitida',
  'Carta de Mudança emitida',
  'Carta de Recomendação emitida',
  'Documento adicionado',
  'Status alterado',
  'Dados atualizados',
  'Ordenação registrada',
  'Ocorrência disciplinar',
  'Outro',
];

const TIPO_COLORS: Record<string, string> = {
  'Manual': 'bg-gray-100 text-gray-700',
  'Credencial emitida': 'bg-blue-100 text-blue-700',
  'Carta de Mudança emitida': 'bg-green-100 text-green-700',
  'Carta de Recomendação emitida': 'bg-teal-100 text-teal-700',
  'Documento adicionado': 'bg-indigo-100 text-indigo-700',
  'Status alterado': 'bg-amber-100 text-amber-700',
  'Dados atualizados': 'bg-purple-100 text-purple-700',
  'Ordenação registrada': 'bg-yellow-100 text-yellow-800',
  'Ocorrência disciplinar': 'bg-red-100 text-red-700',
  'Outro': 'bg-slate-100 text-slate-700',
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

function fmtDatetime(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export default function HistoricoMinistro({ memberId, memberName, matricula, onClose }: HistoricoMinistroProps) {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // form novo registro
  const [showForm, setShowForm] = useState(false);
  const [tipo, setTipo] = useState(TIPOS_ACAO[0]);
  const [descricao, setDescricao] = useState('');
  const [ocorrencia, setOcorrencia] = useState(new Date().toISOString().split('T')[0]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const getAuthHeader = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token || '';
    return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  }, []);

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

  const handleSave = async () => {
    if (!descricao.trim()) { setSaveError('Descrição obrigatória.'); return; }
    setSaving(true);
    setSaveError('');
    try {
      const headers = await getAuthHeader();
      const res = await fetch(`/api/membros/${memberId}/historico`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ tipo, descricao: descricao.trim(), ocorrencia }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Erro ao salvar');
      setDescricao('');
      setTipo(TIPOS_ACAO[0]);
      setOcorrencia(new Date().toISOString().split('T')[0]);
      setShowForm(false);
      await fetchHistory();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[90vh]">

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
          <button onClick={onClose} className="text-white hover:text-gray-300 text-2xl leading-none">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">

          {/* Botão novo registro */}
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

          {/* Formulário de novo registro */}
          {showForm && (
            <div className="border border-blue-200 bg-blue-50 rounded-xl p-4 space-y-3">
              <h3 className="text-sm font-bold text-[#0D2B4E]">Novo Registro Manual</h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-gray-600 mb-1 block">Tipo de ação</label>
                  <select
                    value={tipo}
                    onChange={e => setTipo(e.target.value)}
                    className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#0D2B4E]"
                  >
                    {TIPOS_ACAO.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600 mb-1 block">Data da ocorrência</label>
                  <input
                    type="date"
                    value={ocorrencia}
                    onChange={e => setOcorrencia(e.target.value)}
                    className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#0D2B4E]"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-600 mb-1 block">Descrição</label>
                <textarea
                  value={descricao}
                  onChange={e => setDescricao(e.target.value)}
                  placeholder="Descreva a atividade ou observação..."
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

          {/* Lista de histórico */}
          {loading ? (
            <div className="space-y-2">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-16 bg-gray-100 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : error ? (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">{error}</div>
          ) : history.length === 0 ? (
            <div className="text-center py-10 text-gray-400">
              <svg className="w-10 h-10 mx-auto mb-2 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-sm">Nenhum registro no histórico.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {history.map(entry => (
                <div key={entry.id} className="flex gap-3 items-start p-3 bg-gray-50 border border-gray-200 rounded-lg hover:bg-white transition">
                  {/* Linha vertical / ícone */}
                  <div className="flex-shrink-0 mt-0.5">
                    <div className="w-8 h-8 rounded-full bg-[#0D2B4E]/10 flex items-center justify-center">
                      <svg className="w-4 h-4 text-[#0D2B4E]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-0.5">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${TIPO_COLORS[entry.tipo] || 'bg-gray-100 text-gray-700'}`}>
                        {entry.tipo}
                      </span>
                      <span className="text-xs text-gray-500">{fmtDate(entry.ocorrencia)}</span>
                    </div>
                    <p className="text-sm text-gray-800">{entry.descricao}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      Registrado em {fmtDatetime(entry.created_at)}
                      {entry.usuario_nome ? ` · ${entry.usuario_nome}` : ''}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
