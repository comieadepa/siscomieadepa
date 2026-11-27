import React, { useState } from 'react';
import { X, Shield, AlertCircle } from 'lucide-react';
import { FUNCOES_UMADESPA } from '@/lib/umadespa/constants';

interface ModalLiderancaProps {
  associado: {
    id: string;
    nome: string;
    funcao: string;
    is_lideranca: boolean;
    cargo_detalhe?: string | null;
  } | null;
  isOpen: boolean;
  onClose: () => void;
  onSalvo: () => void;
}

export function ModalLiderancaUmadespa({
  associado,
  isOpen,
  onClose,
  onSalvo,
}: ModalLiderancaProps) {
  const [funcao, setFuncao] = useState(associado?.funcao || 'Membro');
  const [isLideranca, setIsLideranca] = useState(associado?.is_lideranca || false);
  const [cargoDetalhe, setCargoDetalhe] = useState(associado?.cargo_detalhe || '');
  const [motivo, setMotivo] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  if (!isOpen || !associado) return null;

  const handleSalvar = async (e: React.FormEvent) => {
    e.preventDefault();
    setSalvando(true);
    setErro(null);

    try {
      const res = await fetch(`/api/v1/secretaria/umadespa/associados/${associado.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          funcao,
          is_lideranca: isLideranca,
          cargo_detalhe: cargoDetalhe.trim() || null,
          motivo_mudanca_funcao: motivo.trim() || 'Atribuição de liderança via painel administrativo',
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Erro ao atualizar liderança.');
      }

      onSalvo();
      onClose();
    } catch (err: any) {
      setErro(err.message || 'Falha ao salvar liderança.');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-lg w-full p-6 border border-slate-200 dark:border-slate-800 shadow-xl relative animate-in fade-in zoom-in-95 duration-150">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 text-slate-700 dark:text-slate-300 hover:text-slate-600 dark:hover:text-slate-200 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 flex items-center justify-center">
            <Shield className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">
              Gestão de Liderança
            </h3>
            <p className="text-xs text-slate-700 dark:text-slate-300">
              {associado.nome}
            </p>
          </div>
        </div>

        {erro && (
          <div className="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{erro}</span>
          </div>
        )}

        <form onSubmit={handleSalvar} className="space-y-4 text-sm">
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Função Eclesiástica na Mocidade
            </label>
            <select
              value={funcao}
              onChange={(e) => {
                const f = e.target.value;
                setFuncao(f);
                // Marca liderança automaticamente para funções de liderança
                setIsLideranca(f !== 'Membro');
              }}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              {FUNCOES_UMADESPA.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <input
              type="checkbox"
              id="is_lideranca_check"
              checked={isLideranca}
              onChange={(e) => setIsLideranca(e.target.checked)}
              className="w-4 h-4 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500"
            />
            <label htmlFor="is_lideranca_check" className="text-xs font-medium text-slate-700 dark:text-slate-300">
              Classificar formalmente como Liderança (aparece com destaque no crachá e relatórios)
            </label>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Detalhe do Cargo / Área de Atuação (Opcional)
            </label>
            <input
              type="text"
              placeholder="ex: Coordenador de Louvor, Regente, Mídia e Comunicação"
              value={cargoDetalhe}
              onChange={(e) => setCargoDetalhe(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Motivo da Alteração (Auditoria Interna)
            </label>
            <textarea
              rows={2}
              placeholder="Descreva a ata, eleição ou deliberação pastoral..."
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              disabled={salvando}
              className="px-4 py-2 text-xs font-medium rounded-lg text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={salvando}
              className="px-4 py-2 text-xs font-medium rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm disabled:opacity-50"
            >
              {salvando ? 'Salvando...' : 'Confirmar Liderança'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
