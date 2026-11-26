'use client';

import { useState, useEffect, useCallback } from 'react';
import { FileText, Upload, Download, Trash2, CheckCircle2, Clock, Eye, Edit3, Send, AlertCircle } from 'lucide-react';

interface PlenariaItem {
  evento_id: string;
  plenaria_key: 'ministros' | 'aemadepa' | 'umadespa';
  plenaria_nome: string;
  status: 'sem_programacao' | 'rascunho' | 'publicada';
  arquivo_nome: string | null;
  arquivo_url: string | null;
  arquivo_tamanho: number | null;
  texto_extraido: string;
  publicado_em: string | null;
  updated_at: string | null;
}

const PLENARIAS_PADRAO: Array<{ key: 'ministros' | 'aemadepa' | 'umadespa'; nome: string }> = [
  { key: 'ministros', nome: 'Plenária dos Ministros' },
  { key: 'aemadepa', nome: 'Plenária da AEMADEPA' },
  { key: 'umadespa', nome: 'Plenária da Juventude — UMADESPA' },
];

function formatBytes(bytes: number | null) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDateTime(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function ProgramacaoOficialAgoSection({ eventoId }: { eventoId?: string | null }) {
  const [plenarias, setPlenarias] = useState<PlenariaItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draftTexto, setDraftTexto] = useState<Record<string, string>>({});

  const carregar = useCallback(async () => {
    if (!eventoId) return;
    setLoading(true);
    setErro(null);
    try {
      const res = await fetch(`/api/eventos/${eventoId}/programacao-oficial`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Erro ao carregar programações');
      setPlenarias(data.plenarias ?? []);
      const drafts: Record<string, string> = {};
      for (const p of data.plenarias ?? []) {
        drafts[p.plenaria_key] = p.texto_extraido || '';
      }
      setDraftTexto(drafts);
    } catch (e: any) {
      setErro(e?.message || 'Erro ao carregar programações');
    } finally {
      setLoading(false);
    }
  }, [eventoId]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function handleUpload(plenariaKey: string, file: File) {
    if (!eventoId) return;
    setBusyKey(plenariaKey);
    setErro(null);
    setSucesso(null);
    try {
      const formData = new FormData();
      formData.append('plenaria_key', plenariaKey);
      formData.append('file', file);
      const res = await fetch(`/api/eventos/${eventoId}/programacao-oficial`, {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Falha no upload do PDF');
      setSucesso('PDF enviado e texto extraído com sucesso como rascunho.');
      await carregar();
    } catch (e: any) {
      setErro(e?.message || 'Erro ao enviar PDF');
    } finally {
      setBusyKey(null);
    }
  }

  async function handleSalvarTexto(plenariaKey: string, status?: 'rascunho' | 'publicada') {
    if (!eventoId) return;
    setBusyKey(plenariaKey);
    setErro(null);
    setSucesso(null);
    try {
      const res = await fetch(`/api/eventos/${eventoId}/programacao-oficial`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plenaria_key: plenariaKey,
          texto_extraido: draftTexto[plenariaKey] ?? '',
          ...(status ? { status } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Erro ao salvar programação');
      setEditingKey(null);
      setSucesso(
        status === 'publicada'
          ? 'Programação publicada! A base de conhecimento da Sara foi atualizada.'
          : 'Texto da programação salvo com sucesso.'
      );
      await carregar();
    } catch (e: any) {
      setErro(e?.message || 'Erro ao salvar programação');
    } finally {
      setBusyKey(null);
    }
  }

  async function handleRemover(plenariaKey: string) {
    if (!eventoId) return;
    if (!confirm('Deseja realmente remover o PDF e o texto extraído desta plenária?')) return;
    setBusyKey(plenariaKey);
    setErro(null);
    setSucesso(null);
    try {
      const res = await fetch(
        `/api/eventos/${eventoId}/programacao-oficial?plenaria_key=${encodeURIComponent(plenariaKey)}`,
        { method: 'DELETE' }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Erro ao remover programação');
      setSucesso('Programação removida com sucesso.');
      await carregar();
    } catch (e: any) {
      setErro(e?.message || 'Erro ao remover programação');
    } finally {
      setBusyKey(null);
    }
  }

  const lista = plenarias.length > 0
    ? plenarias
    : PLENARIAS_PADRAO.map(p => ({
        evento_id: eventoId || '',
        plenaria_key: p.key,
        plenaria_nome: p.nome,
        status: 'sem_programacao' as const,
        arquivo_nome: null,
        arquivo_url: null,
        arquivo_tamanho: null,
        texto_extraido: '',
        publicado_em: null,
        updated_at: null,
      }));

  return (
    <div className="rounded-2xl border border-[#D4AF37]/40 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
        <div>
          <h2 className="text-lg font-bold text-[#0D2B4E] flex items-center gap-2">
            <FileText className="h-5 w-5 text-[#D4AF37]" />
            Programação Oficial da AGO
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Envie o PDF oficial de cada plenária. O texto extraído e publicado alimenta diretamente a assistente Sara.
          </p>
        </div>
      </div>

      {!eventoId ? (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 flex items-center gap-2.5">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>Salve o evento AGO primeiro para liberar o envio e publicação dos PDFs de cada plenária.</span>
        </div>
      ) : null}

      {erro ? (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-medium text-red-700">
          {erro}
        </div>
      ) : null}

      {sucesso ? (
        <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-medium text-emerald-700">
          {sucesso}
        </div>
      ) : null}

      <div className="mt-5 grid gap-5 md:grid-cols-3">
        {lista.map(item => {
          const isBusy = busyKey === item.plenaria_key;
          const isEditing = editingKey === item.plenaria_key;
          const badge =
            item.status === 'publicada'
              ? { label: 'Publicada', cls: 'bg-emerald-100 text-emerald-800 border-emerald-200', icon: CheckCircle2 }
              : item.status === 'rascunho'
              ? { label: 'Rascunho', cls: 'bg-amber-100 text-amber-800 border-amber-200', icon: Clock }
              : { label: 'Sem programação', cls: 'bg-slate-100 text-slate-600 border-slate-200', icon: FileText };
          const BadgeIcon = badge.icon;

          return (
            <div
              key={item.plenaria_key}
              className="flex flex-col rounded-2xl border border-slate-200 bg-slate-50/50 p-4 transition hover:border-[#0D2B4E]/30"
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-sm font-bold text-[#0D2B4E] leading-snug">{item.plenaria_nome}</h3>
                <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold shrink-0 ${badge.cls}`}>
                  <BadgeIcon className="h-3 w-3" />
                  {badge.label}
                </span>
              </div>

              <div className="mt-2 text-[11px] text-slate-500">
                Última atualização: <span className="font-medium text-slate-700">{formatDateTime(item.updated_at)}</span>
              </div>

              {item.arquivo_nome ? (
                <div className="mt-3 rounded-xl border border-slate-200 bg-white p-2.5 text-xs">
                  <div className="font-medium text-slate-800 truncate" title={item.arquivo_nome}>
                    {item.arquivo_nome}
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5">{formatBytes(item.arquivo_tamanho)}</div>
                </div>
              ) : null}

              {eventoId ? (
                <div className="mt-4 flex flex-col gap-2">
                  <label className="inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-[#0D2B4E]/30 bg-white px-3 py-2 text-xs font-semibold text-[#0D2B4E] hover:bg-slate-50 transition">
                    <Upload className="h-3.5 w-3.5" />
                    <span>{isBusy ? 'Processando...' : item.arquivo_nome ? 'Substituir PDF' : 'Enviar PDF'}</span>
                    <input
                      type="file"
                      accept="application/pdf,.pdf"
                      disabled={isBusy || loading}
                      className="hidden"
                      onChange={e => {
                        const f = e.target.files?.[0];
                        if (f) handleUpload(item.plenaria_key, f);
                        e.currentTarget.value = '';
                      }}
                    />
                  </label>

                  {item.status !== 'sem_programacao' ? (
                    <>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setEditingKey(isEditing ? null : item.plenaria_key)}
                          className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          {isEditing ? <Eye className="h-3.5 w-3.5" /> : <Edit3 className="h-3.5 w-3.5" />}
                          {isEditing ? 'Fechar texto' : 'Ver / Editar'}
                        </button>
                        {item.arquivo_url ? (
                          <a
                            href={item.arquivo_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                            title="Baixar PDF"
                          >
                            <Download className="h-3.5 w-3.5" />
                          </a>
                        ) : null}
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleRemover(item.plenaria_key)}
                          className="inline-flex items-center justify-center rounded-xl border border-red-200 bg-white px-2.5 py-2 text-xs font-semibold text-red-600 hover:bg-red-50"
                          title="Remover documento"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>

                      {isEditing ? (
                        <div className="mt-2 space-y-2">
                          <textarea
                            rows={7}
                            value={draftTexto[item.plenaria_key] ?? ''}
                            onChange={e =>
                              setDraftTexto(prev => ({ ...prev, [item.plenaria_key]: e.target.value }))
                            }
                            className="w-full rounded-xl border border-slate-300 bg-white p-2.5 text-xs text-slate-800 focus:border-[#0D2B4E] focus:outline-none"
                          />
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => handleSalvarTexto(item.plenaria_key)}
                            className="w-full rounded-xl bg-slate-800 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-900"
                          >
                            Salvar texto
                          </button>
                        </div>
                      ) : null}

                      {item.status !== 'publicada' ? (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleSalvarTexto(item.plenaria_key, 'publicada')}
                          className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#0D2B4E] px-3 py-2 text-xs font-semibold text-white hover:bg-[#123b63] transition"
                        >
                          <Send className="h-3.5 w-3.5 text-[#D4AF37]" />
                          Publicar Programação
                        </button>
                      ) : null}
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
