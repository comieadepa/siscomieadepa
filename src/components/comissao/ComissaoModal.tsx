'use client';

import { useState, useEffect } from 'react';
import { Comissao, ComissaoInput } from '@/types/comissao';
import { X, Check, AlertCircle } from 'lucide-react';

interface ComissaoModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  comissaoToEdit?: Comissao | null;
}

export default function ComissaoModal({
  isOpen,
  onClose,
  onSuccess,
  comissaoToEdit,
}: ComissaoModalProps) {
  const isEditing = !!comissaoToEdit;

  const currentYear = new Date().getFullYear();

  const [formData, setFormData] = useState<ComissaoInput>({
    nome: '',
    sigla: '',
    finalidade: '',
    tipo: 'permanente',
    status: 'ativa',
    ato_nomeacao: '',
    data_inicio: new Date().toISOString().split('T')[0],
    ano_referencia: currentYear,
    observacoes: '',
  });

  const [eventos, setEventos] = useState<Array<{ id: string; nome: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Inicializar dados ao abrir modal
  useEffect(() => {
    if (isOpen) {
      setError(null);
      if (comissaoToEdit) {
        setFormData({
          nome: comissaoToEdit.nome || '',
          sigla: comissaoToEdit.sigla || '',
          finalidade: comissaoToEdit.finalidade || '',
          tipo: comissaoToEdit.tipo || 'permanente',
          status: comissaoToEdit.status || 'ativa',
          ato_nomeacao: comissaoToEdit.ato_nomeacao || '',
          data_inicio: comissaoToEdit.data_inicio || new Date().toISOString().split('T')[0],
          ano_referencia: comissaoToEdit.ano_referencia || currentYear,
          evento_id: comissaoToEdit.evento_id || '',
          observacoes: comissaoToEdit.observacoes || '',
        });
      } else {
        setFormData({
          nome: '',
          sigla: '',
          finalidade: '',
          tipo: 'permanente',
          status: 'ativa',
          ato_nomeacao: '',
          data_inicio: new Date().toISOString().split('T')[0],
          ano_referencia: currentYear,
          evento_id: '',
          observacoes: '',
        });
      }

      // Buscar eventos disponíveis para vínculo opcional
      fetch('/api/v1/eventos')
        .then((res) => (res.ok ? res.json() : []))
        .then((data) => {
          if (Array.isArray(data)) {
            setEventos(data);
          } else if (data && Array.isArray(data.eventos)) {
            setEventos(data.eventos);
          }
        })
        .catch(() => setEventos([]));
    }
  }, [isOpen, comissaoToEdit, currentYear]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!formData.nome.trim()) {
      setError('O nome da comissão é obrigatório.');
      return;
    }
    if (!formData.finalidade.trim()) {
      setError('A finalidade da comissão é obrigatória.');
      return;
    }
    if (!formData.data_inicio) {
      setError('A data de início é obrigatória.');
      return;
    }

    try {
      setLoading(true);

      const url = isEditing
        ? `/api/v1/comissoes/${comissaoToEdit.id}`
        : '/api/v1/comissoes';
      const method = isEditing ? 'PUT' : 'POST';

      const payload = {
        ...formData,
        evento_id: formData.evento_id ? formData.evento_id : null,
      };

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const result = await res.json();

      if (!res.ok) {
        throw new Error(result.error || 'Erro ao salvar comissão.');
      }

      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Erro inesperado.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black bg-opacity-50 flex items-center justify-center p-4">
      <div className="relative bg-white rounded-xl shadow-2xl max-w-2xl w-full overflow-hidden border border-gray-100 animate-fadeIn">
        {/* Cabeçalho */}
        <div className="bg-[#123b63] text-white px-6 py-4 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold">
              {isEditing ? 'Editar Comissão' : 'Cadastrar Nova Comissão'}
            </h3>
            <p className="text-xs text-blue-200 mt-0.5">
              Defina os dados institucionais, vigência e ato de nomeação
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-white hover:text-gray-200 transition p-1 rounded-lg hover:bg-white/10"
            title="Fechar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Formulário */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="bg-red-50 border-l-4 border-red-500 p-3 rounded flex items-center gap-3 text-red-700 text-sm">
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1">
                Nome da Comissão *
              </label>
              <input
                type="text"
                required
                value={formData.nome}
                onChange={(e) => setFormData({ ...formData, nome: e.target.value })}
                placeholder="Ex: Comissão de Ética e Disciplina Ministerial"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-[#123b63] focus:border-transparent outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1">
                Sigla (Opcional)
              </label>
              <input
                type="text"
                value={formData.sigla || ''}
                onChange={(e) => setFormData({ ...formData, sigla: e.target.value })}
                placeholder="Ex: CEDM"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-[#123b63] focus:border-transparent outline-none uppercase"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1">
              Finalidade / Mandato Institucional *
            </label>
            <textarea
              required
              rows={2}
              value={formData.finalidade}
              onChange={(e) => setFormData({ ...formData, finalidade: e.target.value })}
              placeholder="Descreva a finalidade, atribuições e competências desta comissão..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-[#123b63] focus:border-transparent outline-none"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1">
                Tipo
              </label>
              <select
                value={formData.tipo}
                onChange={(e) => setFormData({ ...formData, tipo: e.target.value as any })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-[#123b63] focus:border-transparent outline-none bg-white"
              >
                <option value="permanente">Permanente</option>
                <option value="temporaria">Temporária</option>
                <option value="especial">Especial</option>
                <option value="ago">AGO / Específica</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1">
                Situação
              </label>
              <select
                value={formData.status}
                onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-[#123b63] focus:border-transparent outline-none bg-white"
              >
                <option value="ativa">Ativa</option>
                <option value="inativa">Inativa</option>
                <option value="concluida">Concluída</option>
                <option value="suspensa">Suspensa</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1">
                Ano de Referência
              </label>
              <input
                type="number"
                value={formData.ano_referencia}
                onChange={(e) => setFormData({ ...formData, ano_referencia: Number(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-[#123b63] focus:border-transparent outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1">
                Data de Início / Posse *
              </label>
              <input
                type="date"
                required
                value={formData.data_inicio}
                onChange={(e) => setFormData({ ...formData, data_inicio: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-[#123b63] focus:border-transparent outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1">
                Ato de Nomeação / Portaria
              </label>
              <input
                type="text"
                value={formData.ato_nomeacao || ''}
                onChange={(e) => setFormData({ ...formData, ato_nomeacao: e.target.value })}
                placeholder="Ex: Portaria nº 012/2026"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-[#123b63] focus:border-transparent outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1">
                Vínculo a Evento / AGO
              </label>
              <select
                value={formData.evento_id || ''}
                onChange={(e) => setFormData({ ...formData, evento_id: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-[#123b63] focus:border-transparent outline-none bg-white"
              >
                <option value="">Nenhum vínculo específico</option>
                {eventos.map((ev) => (
                  <option key={ev.id} value={ev.id}>
                    {ev.nome}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1">
              Observações Administrativas (Opcional)
            </label>
            <input
              type="text"
              value={formData.observacoes || ''}
              onChange={(e) => setFormData({ ...formData, observacoes: e.target.value })}
              placeholder="Notas internas da secretaria geral..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-[#123b63] focus:border-transparent outline-none"
            />
          </div>

          {/* Botões */}
          <div className="pt-4 border-t border-gray-100 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm hover:bg-gray-50 transition font-medium"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-6 py-2 bg-[#123b63] text-white rounded-lg text-sm hover:bg-[#0d2a47] transition font-semibold flex items-center gap-2 shadow-sm disabled:opacity-50"
            >
              {loading ? (
                <>Salvando...</>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  {isEditing ? 'Atualizar Comissão' : 'Cadastrar Comissão'}
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
