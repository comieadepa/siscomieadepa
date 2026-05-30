'use client';

import { useEffect, useState, useCallback } from 'react';
import PageLayout from '@/components/PageLayout';
import { authenticatedFetch } from '@/lib/api-client';
import { Printer, Eye, RefreshCw, Truck, Package } from 'lucide-react';

interface ImpressaoItem {
  id: string;
  ministroId: string;
  ministroNome: string;
  matricula: string;
  campo: string;
  supervisao: string;
  uniqueId: string | null;
  status: string;
  statusLabel: string;
  valor: number;
  asaasPaymentId: string | null;
  solicitadoEm: string;
  pagoEm: string | null;
  impresso_em: string | null;
  entregueEm: string | null;
}

const STATUS_COLOR: Record<string, string> = {
  aguardando_pagamento: 'bg-yellow-100 text-yellow-800',
  pago_pendente_impressao: 'bg-blue-100 text-blue-800',
  em_impressao: 'bg-indigo-100 text-indigo-800',
  impresso: 'bg-purple-100 text-purple-800',
  entregue: 'bg-green-100 text-green-800',
  cancelado: 'bg-gray-100 text-gray-600',
};

const fmtDate = (v: string | null) => {
  if (!v) return '—';
  return new Date(v).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const STATUS_TABS = [
  { key: 'pago_pendente_impressao,em_impressao,impresso', label: 'Pendentes' },
  { key: 'entregue', label: 'Entregues' },
  { key: 'cancelado', label: 'Cancelados' },
  { key: '', label: 'Todos' },
];

export default function ImpressoesCredenciaisPage() {
  const [items, setItems] = useState<ImpressaoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusTab, setStatusTab] = useState('pago_pendente_impressao,em_impressao,impresso');
  const [atualizando, setAtualizando] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    const statuses = statusTab ? statusTab.split(',') : [];
    const params = new URLSearchParams();
    // Se múltiplos status, busca todos e filtra no cliente
    if (statuses.length === 1) params.set('status', statuses[0]);
    const res = await authenticatedFetch(`/api/secretaria/impressoes-credenciais?${params}`);
    const data = await res.json();
    let rows: ImpressaoItem[] = data.data || [];
    if (statuses.length > 1) {
      rows = rows.filter((r) => statuses.includes(r.status));
    }
    setItems(rows);
    setLoading(false);
  }, [statusTab]);

  useEffect(() => { void carregar(); }, [carregar]);

  const atualizarStatus = async (id: string, novoStatus: string) => {
    setAtualizando(id);
    setMsg(null);
    try {
      const res = await authenticatedFetch(`/api/secretaria/impressoes-credenciais/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: novoStatus }),
      });
      const json = await res.json();
      if (!res.ok) {
        setMsg({ type: 'error', text: json.error || 'Erro ao atualizar.' });
      } else {
        setMsg({ type: 'success', text: 'Status atualizado com sucesso.' });
        void carregar();
      }
    } catch {
      setMsg({ type: 'error', text: 'Erro de conexão.' });
    } finally {
      setAtualizando(null);
    }
  };

  return (
    <PageLayout
      title="Impressões de Credenciais"
      description="Fila de solicitações de impressão enviadas pelo Portal do Ministro"
      activeMenu="secretaria"
    >
      <div className="space-y-4">
        {/* Abas */}
        <div className="flex gap-1 bg-white rounded-xl border border-gray-200 p-1 w-fit">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setStatusTab(tab.key)}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                statusTab === tab.key
                  ? 'bg-[#0D2B4E] text-white'
                  : 'text-gray-600 hover:text-[#0D2B4E]'
              }`}
            >
              {tab.label}
            </button>
          ))}
          <button
            onClick={carregar}
            title="Atualizar"
            className="ml-1 px-3 py-2 text-gray-400 hover:text-[#0D2B4E] transition-colors"
          >
            <RefreshCw size={16} />
          </button>
        </div>

        {msg && (
          <div className={`rounded-lg px-4 py-3 text-sm ${
            msg.type === 'success'
              ? 'bg-green-50 border border-green-200 text-green-700'
              : 'bg-red-50 border border-red-200 text-red-700'
          }`}>
            {msg.text}
          </div>
        )}

        {loading ? (
          <div className="text-gray-500 py-8 text-center">Carregando...</div>
        ) : items.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 py-16 text-center">
            <Printer size={40} className="mx-auto mb-3 text-gray-300" />
            <p className="text-gray-400">Nenhuma solicitação neste filtro.</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50 text-left">
                  <th className="px-5 py-3 text-gray-500 font-semibold">Ministro</th>
                  <th className="px-5 py-3 text-gray-500 font-semibold hidden md:table-cell">Campo / Supervisão</th>
                  <th className="px-5 py-3 text-gray-500 font-semibold hidden lg:table-cell">Solicitado</th>
                  <th className="px-5 py-3 text-gray-500 font-semibold">Status</th>
                  <th className="px-5 py-3 text-gray-500 font-semibold">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {items.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-5 py-3">
                      <p className="font-medium text-gray-800">{item.ministroNome}</p>
                      <p className="text-xs text-gray-400">{item.matricula}</p>
                    </td>
                    <td className="px-5 py-3 hidden md:table-cell text-gray-600 text-xs">
                      <p>{item.campo}</p>
                      <p className="text-gray-400">{item.supervisao}</p>
                    </td>
                    <td className="px-5 py-3 hidden lg:table-cell text-gray-500 text-xs">
                      {fmtDate(item.solicitadoEm)}
                      {item.pagoEm && <p className="text-gray-400">Pago: {fmtDate(item.pagoEm)}</p>}
                    </td>
                    <td className="px-5 py-3">
                      <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${STATUS_COLOR[item.status] || 'bg-gray-100 text-gray-600'}`}>
                        {item.statusLabel}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        {item.uniqueId && (
                          <a
                            href={`/credencial/${item.uniqueId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Ver credencial"
                            className="p-1.5 text-gray-400 hover:text-[#0D2B4E] transition-colors"
                          >
                            <Eye size={16} />
                          </a>
                        )}
                        {item.status === 'pago_pendente_impressao' && (
                          <button
                            onClick={() => atualizarStatus(item.id, 'em_impressao')}
                            disabled={atualizando === item.id}
                            title="Iniciar impressão"
                            className="inline-flex items-center gap-1 text-xs px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors disabled:opacity-60"
                          >
                            <Package size={13} />
                            Em Impressão
                          </button>
                        )}
                        {item.status === 'em_impressao' && (
                          <button
                            onClick={() => atualizarStatus(item.id, 'impresso')}
                            disabled={atualizando === item.id}
                            title="Marcar como impresso"
                            className="inline-flex items-center gap-1 text-xs px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors disabled:opacity-60"
                          >
                            <Printer size={13} />
                            Impresso
                          </button>
                        )}
                        {item.status === 'impresso' && (
                          <button
                            onClick={() => atualizarStatus(item.id, 'entregue')}
                            disabled={atualizando === item.id}
                            title="Marcar como entregue"
                            className="inline-flex items-center gap-1 text-xs px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors disabled:opacity-60"
                          >
                            <Truck size={13} />
                            Entregue
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
    </PageLayout>
  );
}
