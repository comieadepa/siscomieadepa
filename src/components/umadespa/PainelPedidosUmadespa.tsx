import { useState, useEffect } from 'react';
import dynamicImport from 'next/dynamic';
import {
  Printer,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Filter,
  QrCode,
  FileText,
} from 'lucide-react';

const ModalPixUmadespa = dynamicImport(
  () => import('@/components/umadespa/ModalPixUmadespa').then((m) => m.ModalPixUmadespa),
  { ssr: false }
);

interface PedidoItem {
  id: string;
  via: number;
  valor: number;
  status: string;
  solicitado_em: string;
  pago_em?: string | null;
  impresso_em?: string | null;
  entregue_em?: string | null;
  observacoes?: string | null;
  associado?: {
    id: string;
    nome: string;
    cpf: string;
    fone?: string | null;
    funcao: string;
    is_lideranca: boolean;
    campo?: { nome: string } | null;
    supervisao?: { nome: string } | null;
  } | null;
}

export function PainelPedidosUmadespa() {
  const [pedidos, setPedidos] = useState<PedidoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFiltro, setStatusFiltro] = useState('todos');
  const [processandoId, setProcessandoId] = useState<string | null>(null);
  const [pedidoPixSelecionado, setPedidoPixSelecionado] = useState<PedidoItem | null>(null);

  const carregarPedidos = async () => {
    setLoading(true);
    try {
      const url =
        statusFiltro === 'todos'
          ? '/api/v1/secretaria/umadespa/pedidos'
          : `/api/v1/secretaria/umadespa/pedidos?status=${statusFiltro}`;

      const res = await fetch(url);
      const json = await res.json();
      if (res.ok) {
        setPedidos(json.data || []);
      }
    } catch (err) {
      console.error('Erro ao buscar pedidos:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    carregarPedidos();
  }, [statusFiltro]);

  const handleAtualizarStatus = async (id: string, novoStatus: string) => {
    setProcessandoId(id);
    try {
      const res = await fetch('/api/v1/secretaria/umadespa/pedidos', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status: novoStatus }),
      });

      if (res.ok) {
        await carregarPedidos();
      }
    } catch (err) {
      console.error('Erro ao atualizar status do pedido:', err);
    } finally {
      setProcessandoId(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Barra de Filtro de Status */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-slate-700 dark:text-slate-300" />
          <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase">
            Filtrar por Status:
          </span>
          <select
            value={statusFiltro}
            onChange={(e) => setStatusFiltro(e.target.value)}
            className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            <option value="todos">Todos os Pedidos</option>
            <option value="aguardando_pagamento">Aguardando Pagamento</option>
            <option value="pago">Pago (Aguardando Impressão)</option>
            <option value="em_impressao">Em Impressão</option>
            <option value="impressa">Impressa</option>
            <option value="entregue">Entregue</option>
            <option value="cancelada">Cancelada</option>
          </select>
        </div>

        <button
          type="button"
          onClick={carregarPedidos}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Atualizar Fila
        </button>
      </div>

      {/* Tabela de Pedidos */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 text-center">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-emerald-500 border-t-transparent" />
            <p className="mt-3 text-xs text-slate-700 dark:text-slate-300">Carregando solicitações de carteirinhas...</p>
          </div>
        ) : pedidos.length === 0 ? (
          <div className="p-12 text-center text-slate-700 dark:text-slate-300 text-sm">
            Nenhum pedido encontrado para o status selecionado.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-600 dark:text-slate-300">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-xs font-semibold uppercase text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="px-4 py-3">Jovem / Associado</th>
                  <th className="px-4 py-3">Via / Taxa</th>
                  <th className="px-4 py-3">Data Solicitação</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Avançar Fila Operacional</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {pedidos.map((ped) => (
                  <tr key={ped.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-slate-900 dark:text-slate-100">
                        {ped.associado?.nome || 'Associado não identificado'}
                      </p>
                      <p className="text-xs text-slate-700 dark:text-slate-300">
                        CPF: {ped.associado?.cpf} | {ped.associado?.campo?.nome || 'Sem Campo'}
                      </p>
                    </td>

                    <td className="px-4 py-3">
                      <span className="font-medium text-slate-800 dark:text-slate-200">
                        {ped.via}ª Via
                      </span>
                      <p className="text-xs text-slate-700 dark:text-slate-300">
                        R$ {Number(ped.valor).toFixed(2).replace('.', ',')}
                      </p>
                    </td>

                    <td className="px-4 py-3 text-xs text-slate-700 dark:text-slate-300">
                      {new Date(ped.solicitado_em).toLocaleDateString('pt-BR', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>

                    <td className="px-4 py-3">
                      <span className="inline-block px-2.5 py-1 rounded-full text-xs font-semibold uppercase bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                        {ped.status.replace(/_/g, ' ')}
                      </span>
                    </td>

                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {ped.status === 'aguardando_pagamento' && (
                          <button
                            type="button"
                            onClick={() => setPedidoPixSelecionado(ped)}
                            className="px-2.5 py-1 text-xs font-medium rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs inline-flex items-center gap-1"
                          >
                            <QrCode className="w-3.5 h-3.5" />
                            PIX / Cobrança
                          </button>
                        )}

                        {['pago', 'em_impressao', 'impressa', 'entregue'].includes(ped.status) && (
                          <a
                            href={`/api/v1/secretaria/umadespa/pedidos/${ped.id}/recibo`}
                            target="_blank"
                            rel="noreferrer"
                            title="Comprovante de Pagamento"
                            className="p-1 rounded-lg text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/40"
                          >
                            <FileText className="w-4 h-4" />
                          </a>
                        )}

                        {ped.status === 'pago' && (
                          <button
                            type="button"
                            disabled={processandoId === ped.id}
                            onClick={() => handleAtualizarStatus(ped.id, 'em_impressao')}
                            className="px-2.5 py-1 text-xs font-medium rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs disabled:opacity-50 inline-flex items-center gap-1"
                          >
                            <Printer className="w-3.5 h-3.5" />
                            Iniciar Impressão
                          </button>
                        )}

                        {ped.status === 'em_impressao' && (
                          <button
                            type="button"
                            disabled={processandoId === ped.id}
                            onClick={() => handleAtualizarStatus(ped.id, 'impressa')}
                            className="px-2.5 py-1 text-xs font-medium rounded-lg bg-purple-600 hover:bg-purple-700 text-white shadow-xs disabled:opacity-50"
                          >
                            Marcar como Impressa
                          </button>
                        )}

                        {ped.status === 'impressa' && (
                          <button
                            type="button"
                            disabled={processandoId === ped.id}
                            onClick={() => handleAtualizarStatus(ped.id, 'entregue')}
                            className="px-2.5 py-1 text-xs font-medium rounded-lg bg-teal-600 hover:bg-teal-700 text-white shadow-xs disabled:opacity-50 inline-flex items-center gap-1"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Registrar Entrega
                          </button>
                        )}

                        {ped.status !== 'entregue' && ped.status !== 'cancelada' && (
                          <button
                            type="button"
                            disabled={processandoId === ped.id}
                            onClick={() => handleAtualizarStatus(ped.id, 'cancelada')}
                            title="Cancelar Pedido"
                            className="p-1 rounded-lg text-slate-700 hover:text-red-600 dark:hover:text-red-400"
                          >
                            <XCircle className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal PIX / Baixa Manual sob demanda */}
      {pedidoPixSelecionado && (
        <ModalPixUmadespa
          pedidoId={pedidoPixSelecionado.id}
          associadoNome={pedidoPixSelecionado.associado?.nome || 'Jovem'}
          via={pedidoPixSelecionado.via}
          valor={pedidoPixSelecionado.valor}
          status={pedidoPixSelecionado.status}
          onClose={() => setPedidoPixSelecionado(null)}
          onPagamentoConfirmado={() => carregarPedidos()}
        />
      )}
    </div>
  );
}
