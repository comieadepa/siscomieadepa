import { Search, RotateCcw } from 'lucide-react';

interface UmadespaFiltrosProps {
  busca: string;
  onBuscaChange: (v: string) => void;
  status: string;
  onStatusChange: (v: string) => void;
  lideranca: string;
  onLiderancaChange: (v: string) => void;
  supervisoes: Array<{ id: string; nome: string }>;
  supervisaoId: string;
  onSupervisaoChange: (v: string) => void;
  campos: Array<{ id: string; nome: string; supervisao_id?: string }>;
  campoId: string;
  onCampoChange: (v: string) => void;
  onLimparFiltros: () => void;
}

export function UmadespaFiltros({
  busca,
  onBuscaChange,
  status,
  onStatusChange,
  lideranca,
  onLiderancaChange,
  supervisoes,
  supervisaoId,
  onSupervisaoChange,
  campos,
  campoId,
  onCampoChange,
  onLimparFiltros,
}: UmadespaFiltrosProps) {
  // Filtra campos pela supervisão selecionada, se houver
  const camposFiltrados = supervisaoId
    ? campos.filter((c) => c.supervisao_id === supervisaoId)
    : campos;

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl p-4 border border-slate-200 dark:border-slate-800 shadow-sm space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
        {/* Campo de Busca */}
        <div className="md:col-span-4 relative">
          <Search className="w-4 h-4 text-slate-700 dark:text-slate-300 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Buscar por nome ou CPF..."
            value={busca}
            onChange={(e) => onBuscaChange(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-700 dark:placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>

        {/* Filtro de Liderança */}
        <div className="md:col-span-2">
          <select
            value={lideranca}
            onChange={(e) => onLiderancaChange(e.target.value)}
            className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            <option value="todos">Função: Todas</option>
            <option value="true">Apenas Liderança</option>
            <option value="false">Apenas Membros</option>
          </select>
        </div>

        {/* Filtro de Supervisão */}
        <div className="md:col-span-2">
          <select
            value={supervisaoId}
            onChange={(e) => {
              onSupervisaoChange(e.target.value);
              onCampoChange(''); // Reseta campo ao trocar supervisão
            }}
            className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            <option value="">Supervisão: Todas</option>
            {supervisoes.map((sup) => (
              <option key={sup.id} value={sup.id}>
                {sup.nome}
              </option>
            ))}
          </select>
        </div>

        {/* Filtro de Campo */}
        <div className="md:col-span-2">
          <select
            value={campoId}
            onChange={(e) => onCampoChange(e.target.value)}
            className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            <option value="">Campo: Todos</option>
            {camposFiltrados.map((cmp) => (
              <option key={cmp.id} value={cmp.id}>
                {cmp.nome}
              </option>
            ))}
          </select>
        </div>

        {/* Filtro de Status */}
        <div className="md:col-span-1">
          <select
            value={status}
            onChange={(e) => onStatusChange(e.target.value)}
            className="w-full px-2 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            <option value="todos">Status</option>
            <option value="ativo">Ativo</option>
            <option value="pendente">Pendente</option>
            <option value="inativo">Inativo</option>
            <option value="regularizacao">Regularização</option>
          </select>
        </div>

        {/* Botão Limpar Filtros */}
        <div className="md:col-span-1 flex items-center justify-end">
          <button
            type="button"
            onClick={onLimparFiltros}
            title="Limpar todos os filtros"
            className="w-full h-full flex items-center justify-center p-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 transition-colors"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
