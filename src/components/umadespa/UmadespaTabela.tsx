import {
  Shield,
  Edit,
  CreditCard,
  UserCheck,
  ChevronLeft,
  ChevronRight,
  Phone,
  FileText,
} from 'lucide-react';

interface AssociadoItem {
  id: string;
  nome: string;
  cpf: string;
  data_nascimento: string;
  sexo: string;
  fone?: string | null;
  foto_url?: string | null;
  funcao: string;
  is_lideranca: boolean;
  cargo_detalhe?: string | null;
  status: string;
  menor_idade: boolean;
  supervisao?: { id: string; nome: string } | null;
  campo?: { id: string; nome: string } | null;
  congregacao?: { id: string; nome: string } | null;
  carteirinha_atual?: {
    id: string;
    via: number;
    status: string;
    valor: number;
  } | null;
}

interface UmadespaTabelaProps {
  associados: AssociadoItem[];
  loading: boolean;
  page: number;
  totalPages: number;
  total: number;
  onPageChange: (newPage: number) => void;
  onEditar: (item: AssociadoItem) => void;
  onGerenciarLideranca: (item: AssociadoItem) => void;
  onSolicitarCarteirinha: (item: AssociadoItem) => void;
  onVisualizarFicha?: (item: AssociadoItem) => void;
  onVisualizarCartao?: (item: AssociadoItem) => void;
}

function formatCpf(cpf: string): string {
  const digits = (cpf || '').replace(/\D/g, '');
  if (digits.length !== 11) return cpf;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

export function UmadespaTabela({
  associados,
  loading,
  page,
  totalPages,
  total,
  onPageChange,
  onEditar,
  onGerenciarLideranca,
  onSolicitarCarteirinha,
  onVisualizarFicha,
  onVisualizarCartao,
}: UmadespaTabelaProps) {
  if (loading) {
    return (
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-12 text-center">
        <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-emerald-500 border-t-transparent" />
        <p className="mt-3 text-sm text-slate-700 dark:text-slate-300">Carregando associados da juventude...</p>
      </div>
    );
  }

  if (associados.length === 0) {
    return (
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-12 text-center">
        <p className="text-slate-700 dark:text-slate-300 font-medium">Nenhum associado encontrado.</p>
        <p className="text-xs text-slate-700 dark:text-slate-300 mt-1">Ajuste os filtros de busca ou cadastre um novo membro.</p>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm text-slate-600 dark:text-slate-300">
          <thead className="bg-slate-50 dark:bg-slate-800/60 text-xs font-semibold uppercase text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-800">
            <tr>
              <th className="px-4 py-3">Jovem / Membro</th>
              <th className="px-4 py-3">Vínculo Eclesiástico</th>
              <th className="px-4 py-3">Função / Liderança</th>
              <th className="px-4 py-3">Carteirinha</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {associados.map((item) => {
              const statusColors: Record<string, string> = {
                ativo: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
                pendente: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border-amber-200 dark:border-amber-800',
                inativo: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 border-slate-200 dark:border-slate-700',
                regularizacao: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300 border-red-200 dark:border-red-800',
              };

              const statusCarteirinhaColors: Record<string, string> = {
                aguardando_pagamento: 'text-amber-600 bg-amber-50 dark:bg-amber-950/30',
                pago: 'text-blue-600 bg-blue-50 dark:bg-blue-950/30',
                em_impressao: 'text-indigo-600 bg-indigo-50 dark:bg-indigo-950/30',
                impressa: 'text-purple-600 bg-purple-50 dark:bg-purple-950/30',
                entregue: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30',
                cancelada: 'text-red-600 bg-red-50 dark:bg-red-950/30',
              };

              return (
                <tr key={item.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors">
                  {/* Nome e Dados */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {item.foto_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={item.foto_url}
                          alt={item.nome}
                          className="w-10 h-10 rounded-full object-cover border border-slate-200 dark:border-slate-700"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 flex items-center justify-center font-bold text-sm">
                          {item.nome.charAt(0)}
                        </div>
                      )}
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-900 dark:text-slate-100">
                            {item.nome}
                          </span>
                          {item.menor_idade && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
                              Menor
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-700 dark:text-slate-300 flex items-center gap-2 mt-0.5">
                          <span>CPF: {formatCpf(item.cpf)}</span>
                          {item.fone && (
                            <>
                              <span>•</span>
                              <span className="flex items-center gap-1">
                                <Phone className="w-3 h-3 text-slate-700 dark:text-slate-300" />
                                {item.fone}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </td>

                  {/* Vínculo Eclesiástico */}
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-800 dark:text-slate-200">
                      {item.campo?.nome || 'Campo não vinculado'}
                    </p>
                    <p className="text-xs text-slate-700 dark:text-slate-300">
                      {item.supervisao?.nome ? `Sup.: ${item.supervisao.nome}` : ''}
                      {item.congregacao?.nome ? ` | Cong.: ${item.congregacao.nome}` : ''}
                    </p>
                  </td>

                  {/* Função / Liderança */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      {item.is_lideranca ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                          <Shield className="w-3.5 h-3.5" />
                          {item.funcao}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-600 dark:text-slate-400 font-medium">
                          {item.funcao}
                        </span>
                      )}
                    </div>
                    {item.cargo_detalhe && (
                      <p className="text-xs text-slate-700 dark:text-slate-300 mt-0.5 italic">{item.cargo_detalhe}</p>
                    )}
                  </td>

                  {/* Carteirinha */}
                  <td className="px-4 py-3">
                    {item.carteirinha_atual ? (
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-xs font-medium uppercase ${
                          statusCarteirinhaColors[item.carteirinha_atual.status] || 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        {item.carteirinha_atual.status.replace(/_/g, ' ')} (v{item.carteirinha_atual.via})
                      </span>
                    ) : (
                      <span className="text-xs text-slate-700 dark:text-slate-300">Nenhum pedido</span>
                    )}
                  </td>

                  {/* Status Cadastral */}
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border capitalize ${
                        statusColors[item.status] || 'bg-slate-100 text-slate-700'
                      }`}
                    >
                      {item.status}
                    </span>
                  </td>

                  {/* Ações */}
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      {onVisualizarFicha && (
                        <button
                          type="button"
                          onClick={() => onVisualizarFicha(item)}
                          title="Ficha Cadastral (Impressão)"
                          className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition-colors"
                        >
                          <FileText className="w-4 h-4" />
                        </button>
                      )}

                      {onVisualizarCartao && (
                        <button
                          type="button"
                          onClick={() => onVisualizarCartao(item)}
                          title="Credencial PVC (Frente e Verso)"
                          className="p-1.5 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 transition-colors"
                        >
                          <CreditCard className="w-4 h-4" />
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => onGerenciarLideranca(item)}
                        title="Atribuir Liderança / Mudar Função"
                        className="p-1.5 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 transition-colors"
                      >
                        <UserCheck className="w-4 h-4" />
                      </button>

                      <button
                        type="button"
                        onClick={() => onSolicitarCarteirinha(item)}
                        title="Emitir Pedido de Carteirinha"
                        className="p-1.5 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-950/40 text-blue-600 dark:text-blue-400 transition-colors"
                      >
                        <CreditCard className="w-4 h-4" />
                      </button>

                      <button
                        type="button"
                        onClick={() => onEditar(item)}
                        title="Editar Dados Cadastrais"
                        className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition-colors"
                      >
                        <Edit className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Paginação */}
      <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs text-slate-700 dark:text-slate-300">
        <div>
          Mostrando {associados.length} de {total} registros
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
            className="p-1.5 rounded border border-slate-200 dark:border-slate-700 disabled:opacity-40 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span>
            Página {page} de {Math.max(1, totalPages)}
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
            className="p-1.5 rounded border border-slate-200 dark:border-slate-700 disabled:opacity-40 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
