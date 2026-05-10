'use client';

import { useState, useEffect, useCallback } from 'react';

// ─── Tipos ────────────────────────────────────────────────────
interface ItemProgramacao {
  id: string;
  data: string;
  horario: string | null;
  titulo: string;
  descricao: string | null;
  palestrante: string | null;
  local: string | null;
  ordem: number;
}

interface FormItem {
  data: string;
  horario: string;
  titulo: string;
  descricao: string;
  palestrante: string;
  local: string;
  ordem: string;
}

const FORM_VAZIO: FormItem = {
  data: '', horario: '', titulo: '', descricao: '', palestrante: '', local: '', ordem: '0',
};

const fmtData = (d: string) => {
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y}`;
};

const fmtHora = (h: string | null) => (h ? h.slice(0, 5) : '');

// ─── Componente ───────────────────────────────────────────────
export default function TabProgramacao({
  eventoId,
  podeEditar,
}: {
  eventoId: string;
  podeEditar: boolean;
}) {
  const [itens,      setItens]      = useState<ItemProgramacao[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [form,       setForm]       = useState<FormItem>(FORM_VAZIO);
  const [editando,   setEditando]   = useState<string | null>(null); // id do item em edição
  const [salvando,   setSalvando]   = useState(false);
  const [msg,        setMsg]        = useState('');
  const [showForm,   setShowForm]   = useState(false);

  // ── Carrega programação ─────────────────────────────────────
  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/eventos/${eventoId}/programacao`);
      const json = await res.json();
      setItens(json.programacao ?? []);
    } catch {
      setItens([]);
    } finally {
      setLoading(false);
    }
  }, [eventoId]);

  useEffect(() => { carregar(); }, [carregar]);

  // ── Submete (cria ou edita) ──────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.titulo.trim() || !form.data) {
      setMsg('❌ Data e título são obrigatórios.');
      return;
    }
    setSalvando(true);
    setMsg('');
    try {
      const url = editando
        ? `/api/eventos/${eventoId}/programacao/${editando}`
        : `/api/eventos/${eventoId}/programacao`;
      const method = editando ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data:       form.data,
          horario:    form.horario || null,
          titulo:     form.titulo.trim(),
          descricao:  form.descricao.trim() || null,
          palestrante: form.palestrante.trim() || null,
          local:      form.local.trim() || null,
          ordem:      parseInt(form.ordem) || 0,
        }),
      });
      if (!res.ok) {
        const j = await res.json();
        setMsg('❌ ' + (j.error ?? 'Erro ao salvar.'));
      } else {
        setMsg('✅ Salvo com sucesso!');
        setForm(FORM_VAZIO);
        setEditando(null);
        setShowForm(false);
        await carregar();
        setTimeout(() => setMsg(''), 3000);
      }
    } catch {
      setMsg('❌ Erro de conexão.');
    } finally {
      setSalvando(false);
    }
  }

  // ── Edita item ───────────────────────────────────────────────
  function iniciarEdicao(item: ItemProgramacao) {
    setEditando(item.id);
    setForm({
      data:        item.data,
      horario:     item.horario ?? '',
      titulo:      item.titulo,
      descricao:   item.descricao ?? '',
      palestrante: item.palestrante ?? '',
      local:       item.local ?? '',
      ordem:       String(item.ordem),
    });
    setShowForm(true);
    setMsg('');
  }

  // ── Exclui item ──────────────────────────────────────────────
  async function excluir(id: string, titulo: string) {
    if (!confirm(`Excluir "${titulo}"?`)) return;
    const res = await fetch(`/api/eventos/${eventoId}/programacao/${id}`, { method: 'DELETE' });
    if (res.ok) {
      setItens(prev => prev.filter(i => i.id !== id));
      setMsg('✅ Item excluído.');
      setTimeout(() => setMsg(''), 3000);
    } else {
      setMsg('❌ Erro ao excluir.');
    }
  }

  // ── Cancela form ─────────────────────────────────────────────
  function cancelar() {
    setForm(FORM_VAZIO);
    setEditando(null);
    setShowForm(false);
    setMsg('');
  }

  // ── Agrupa por data ──────────────────────────────────────────
  const porDia = itens.reduce<Map<string, ItemProgramacao[]>>((acc, item) => {
    if (!acc.has(item.data)) acc.set(item.data, []);
    acc.get(item.data)!.push(item);
    return acc;
  }, new Map());

  // ─── Render ───────────────────────────────────────────────────
  return (
    <div className="space-y-6">

      {/* Cabeçalho */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-lg font-bold text-[#123b63]">📋 Programação do Evento</h3>
          <p className="text-sm text-gray-500">
            {itens.length === 0 ? 'Nenhum item cadastrado.' : `${itens.length} ite${itens.length !== 1 ? 'ns' : 'm'} cadastrado${itens.length !== 1 ? 's' : ''}.`}
          </p>
        </div>
        {podeEditar && !showForm && (
          <button
            onClick={() => { setShowForm(true); setEditando(null); setForm(FORM_VAZIO); }}
            className="bg-[#123b63] hover:bg-[#0f2a45] text-white px-5 py-2.5 rounded-xl text-sm font-bold transition flex items-center gap-2"
          >
            ➕ Adicionar item
          </button>
        )}
      </div>

      {/* Mensagem global */}
      {msg && (
        <div className={`px-4 py-3 rounded-xl text-sm font-semibold ${msg.startsWith('✅') ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          {msg}
        </div>
      )}

      {/* Formulário */}
      {podeEditar && showForm && (
        <div className="bg-blue-50 border border-blue-200 rounded-2xl p-5">
          <h4 className="font-bold text-[#123b63] mb-4 text-sm">
            {editando ? '✏️ Editar item' : '➕ Novo item de programação'}
          </h4>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Data */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Data *</label>
                <input
                  type="date"
                  value={form.data}
                  onChange={e => setForm(f => ({ ...f, data: e.target.value }))}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#123b63]/30"
                  required
                />
              </div>
              {/* Horário */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Horário</label>
                <input
                  type="time"
                  value={form.horario}
                  onChange={e => setForm(f => ({ ...f, horario: e.target.value }))}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#123b63]/30"
                />
              </div>
            </div>

            {/* Título */}
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Título *</label>
              <input
                type="text"
                value={form.titulo}
                onChange={e => setForm(f => ({ ...f, titulo: e.target.value }))}
                placeholder="Ex: Culto de Abertura, Palestra sobre Missões..."
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#123b63]/30"
                required
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Palestrante */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Palestrante / Responsável</label>
                <input
                  type="text"
                  value={form.palestrante}
                  onChange={e => setForm(f => ({ ...f, palestrante: e.target.value }))}
                  placeholder="Nome do palestrante"
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#123b63]/30"
                />
              </div>
              {/* Local */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Local / Sala</label>
                <input
                  type="text"
                  value={form.local}
                  onChange={e => setForm(f => ({ ...f, local: e.target.value }))}
                  placeholder="Ex: Auditório Principal"
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#123b63]/30"
                />
              </div>
            </div>

            {/* Descrição */}
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Descrição / Observações</label>
              <textarea
                value={form.descricao}
                onChange={e => setForm(f => ({ ...f, descricao: e.target.value }))}
                placeholder="Detalhes adicionais sobre esta atividade..."
                rows={2}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#123b63]/30 resize-none"
              />
            </div>

            {/* Ordem */}
            <div className="w-32">
              <label className="block text-xs font-semibold text-gray-600 mb-1">Ordem (dentro do dia)</label>
              <input
                type="number"
                min={0}
                value={form.ordem}
                onChange={e => setForm(f => ({ ...f, ordem: e.target.value }))}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#123b63]/30"
              />
            </div>

            {/* Botões */}
            <div className="flex gap-3 pt-1">
              <button
                type="submit"
                disabled={salvando}
                className="bg-[#123b63] hover:bg-[#0f2a45] text-white px-6 py-2.5 rounded-xl text-sm font-bold transition disabled:opacity-50"
              >
                {salvando ? 'Salvando...' : editando ? '✅ Salvar alterações' : '✅ Adicionar'}
              </button>
              <button
                type="button"
                onClick={cancelar}
                className="border border-gray-300 text-gray-600 px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-gray-50 transition"
              >
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Lista de itens */}
      {loading ? (
        <div className="text-center py-12 text-gray-400 text-sm">Carregando programação...</div>
      ) : itens.length === 0 ? (
        <div className="text-center py-12 border-2 border-dashed border-gray-200 rounded-2xl">
          <p className="text-3xl mb-3">📋</p>
          <p className="text-gray-500 font-semibold">Nenhum item cadastrado ainda.</p>
          {podeEditar && (
            <p className="text-gray-400 text-sm mt-1">Clique em &ldquo;Adicionar item&rdquo; para começar.</p>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {Array.from(porDia.entries()).map(([dia, itensDia]) => (
            <div key={dia}>
              {/* Cabeçalho do dia */}
              <div className="flex items-center gap-3 mb-3">
                <div className="h-px flex-1 bg-gray-200" />
                <span className="bg-[#123b63] text-white text-xs font-bold px-3 py-1 rounded-full">
                  📅 {fmtData(dia)}
                </span>
                <div className="h-px flex-1 bg-gray-200" />
              </div>

              {/* Itens do dia */}
              <div className="space-y-2">
                {itensDia.map(item => (
                  <div
                    key={item.id}
                    className={`flex items-start gap-4 bg-white border rounded-xl p-4 transition ${editando === item.id ? 'border-blue-300 ring-2 ring-blue-100' : 'border-gray-200 hover:border-gray-300'}`}
                  >
                    {/* Horário */}
                    <div className="w-14 flex-shrink-0 text-center">
                      {item.horario ? (
                        <span className="text-sm font-bold text-[#123b63]">{fmtHora(item.horario)}</span>
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </div>

                    {/* Conteúdo */}
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-gray-800 text-sm">{item.titulo}</p>
                      {item.palestrante && (
                        <p className="text-xs text-gray-500 mt-0.5">👤 {item.palestrante}</p>
                      )}
                      {item.local && (
                        <p className="text-xs text-gray-400 mt-0.5">📍 {item.local}</p>
                      )}
                      {item.descricao && (
                        <p className="text-xs text-gray-400 mt-1 leading-relaxed">{item.descricao}</p>
                      )}
                    </div>

                    {/* Ações */}
                    {podeEditar && (
                      <div className="flex gap-2 flex-shrink-0">
                        <button
                          onClick={() => iniciarEdicao(item)}
                          className="text-xs text-[#123b63] hover:underline font-semibold"
                        >
                          Editar
                        </button>
                        <button
                          onClick={() => excluir(item.id, item.titulo)}
                          className="text-xs text-red-500 hover:underline font-semibold"
                        >
                          Excluir
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
