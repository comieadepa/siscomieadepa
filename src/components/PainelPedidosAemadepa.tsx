'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Printer,
  RefreshCw,
  Search,
  CheckCircle2,
  Clock,
  Truck,
  DollarSign,
  X,
  Check,
  QrCode,
  Download,
  Mail,
  RotateCcw,
  FileText,
} from 'lucide-react';
import { authenticatedFetch } from '@/lib/api-client';
import ModalRecuperarPixAemadepa from '@/components/ModalRecuperarPixAemadepa';
import ModalEnviarReciboAemadepa from '@/components/ModalEnviarReciboAemadepa';
import { gerarRelatorioPedidosCarteirinhaPDF } from '@/lib/aemadepa/relatorio-pedidos-pdf';

export interface PedidoCarteirinhaItem {
  id: string;
  associadaId: string;
  ministroId: string;
  valor: number;
  via: number;
  status: string;
  asaasPaymentId: string | null;
  solicitadoEm: string;
  pagoEm: string | null;
  impressoEm: string | null;
  entregueEm: string | null;
  entreguePara: string | null;
  observacoes: string | null;
  associada: {
    id: string;
    uniqueId?: string;
    nomeEsposa: string;
    cpfEsposa: string;
    rgEsposa: string;
    orgaoEmissorEsposa: string;
    dataNascimentoEsposa: string;
    nacionalidadeEsposa: string;
    naturalidadeEsposa: string;
    nomePaiEsposa: string;
    nomeMaeEsposa: string;
    tituloEleitoralEsposa: string;
    foneEsposa: string;
    emailEsposa: string;
    tipoSanguineoEsposa: string;
    fotoEsposaUrl: string | null;
    numeroAemadepa: string;
    ministroNome: string;
    ministroMatricula: string;
    ministroCpf: string;
    cargoMinisterial: string;
    campo: string;
    supervisao: string;
  };
}

interface ResumoFinanceiro {
  totalPedidos: number;
  pedidosPagos: number;
  totalArrecadado: number;
  aguardandoPagamento: number;
  emFilaImpressao: number;
  impressos: number;
  entregues: number;
}

interface PainelPedidosAemadepaProps {
  onImprimirCarteirinha: (
    associada: PedidoCarteirinhaItem['associada'],
    pedido?: { id: string; status: string }
  ) => void;
}

export default function PainelPedidosAemadepa({
  onImprimirCarteirinha,
}: PainelPedidosAemadepaProps) {
  const [pedidos, setPedidos] = useState<PedidoCarteirinhaItem[]>([]);
  const [resumo, setResumo] = useState<ResumoFinanceiro>({
    totalPedidos: 0,
    pedidosPagos: 0,
    totalArrecadado: 0,
    aguardandoPagamento: 0,
    emFilaImpressao: 0,
    impressos: 0,
    entregues: 0,
  });
  const [loading, setLoading] = useState(true);
  const [statusFiltro, setStatusFiltro] = useState<string>('todos');
  const [busca, setBusca] = useState('');
  const [paginaAtual, setPaginaAtual] = useState(1);
  const ITENS_POR_PAGINA = 15;
  const [gerandoPdf, setGerandoPdf] = useState(false);
  const [atualizandoId, setAtualizandoId] = useState<string | null>(null);
  const [modalEntregaPedido, setModalEntregaPedido] = useState<PedidoCarteirinhaItem | null>(null);
  const [entregueParaNome, setEntregueParaNome] = useState('');
  const [modalRecuperarPix, setModalRecuperarPix] = useState<PedidoCarteirinhaItem | null>(null);
  const [modalEnviarRecibo, setModalEnviarRecibo] = useState<PedidoCarteirinhaItem | null>(null);
  const [baixandoReciboId, setBaixandoReciboId] = useState<string | null>(null);

  const carregarPedidos = useCallback(async () => {
    setLoading(true);
    try {
      const url =
        statusFiltro === 'todos'
          ? '/api/v1/secretaria/aemadepa/pedidos'
          : `/api/v1/secretaria/aemadepa/pedidos?status=${statusFiltro}`;
      const res = await authenticatedFetch(url);
      const data = await res.json().catch(() => null);

      if (res.ok && data?.pedidos) {
        setPedidos(data.pedidos);
        if (data.resumo) setResumo(data.resumo);
      }
    } catch (err) {
      console.error('Erro ao buscar pedidos:', err);
    } finally {
      setLoading(false);
    }
  }, [statusFiltro]);

  useEffect(() => {
    void carregarPedidos();
  }, [carregarPedidos]);

  const atualizarStatus = async (
    id: string,
    novoStatus: string,
    entreguePara?: string
  ) => {
    setAtualizandoId(id);
    try {
      const res = await authenticatedFetch('/api/v1/secretaria/aemadepa/pedidos', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          novoStatus,
          entreguePara,
        }),
      });

      if (res.ok) {
        void carregarPedidos();
        setModalEntregaPedido(null);
      }
    } catch (err) {
      console.error('Erro ao atualizar status do pedido:', err);
    } finally {
      setAtualizandoId(null);
    }
  };

  const baixarRecibo = async (pedido: PedidoCarteirinhaItem) => {
    if (baixandoReciboId) return;
    setBaixandoReciboId(pedido.id);
    try {
      const res = await authenticatedFetch(`/api/v1/secretaria/aemadepa/pedidos/${pedido.id}/recibo`);
      if (!res.ok) {
        const erroJson = await res.json().catch(() => null);
        throw new Error(erroJson?.error || 'Erro ao gerar recibo para download.');
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Recibo_AEMADEPA_${pedido.associada.nomeEsposa.replace(/\s+/g, '_')}_Via${pedido.via}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err: any) {
      console.error('Erro ao baixar recibo:', err);
      alert(err.message || 'Não foi possível baixar o recibo.');
    } finally {
      setBaixandoReciboId(null);
    }
  };

  const pedidosFiltrados = pedidos.filter((p) => {
    if (!busca) return true;
    const termo = busca.toLowerCase();
    return (
      p.associada.nomeEsposa.toLowerCase().includes(termo) ||
      p.associada.ministroNome.toLowerCase().includes(termo) ||
      p.associada.ministroMatricula.toLowerCase().includes(termo) ||
      p.associada.campo.toLowerCase().includes(termo)
    );
  });

  // Paginação de exatamente 15 registros por página
  const totalPaginas = Math.ceil(pedidosFiltrados.length / ITENS_POR_PAGINA) || 1;
  const paginaSegura = Math.min(paginaAtual, totalPaginas);
  const pedidosPaginados = pedidosFiltrados.slice(
    (paginaSegura - 1) * ITENS_POR_PAGINA,
    paginaSegura * ITENS_POR_PAGINA
  );

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Cards de Métricas Financeiras e Operacionais */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl p-5 shadow-sm border border-emerald-100 flex items-center justify-between">
          <div>
            <p className="text-xs font-bold text-emerald-600 uppercase tracking-wider">Total Arrecadado</p>
            <p className="text-2xl font-black text-emerald-700 mt-1">
              R$ {resumo.totalArrecadado.toFixed(2)}
            </p>
            <p className="text-xs text-gray-500 mt-0.5">{resumo.pedidosPagos} pagamentos confirmados</p>
          </div>
          <div className="w-12 h-12 bg-emerald-50 rounded-xl flex items-center justify-center text-emerald-600 shadow-inner">
            <DollarSign className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-white rounded-xl p-5 shadow-sm border border-blue-100 flex items-center justify-between">
          <div>
            <p className="text-xs font-bold text-blue-600 uppercase tracking-wider">Fila de Impressão</p>
            <p className="text-2xl font-black text-blue-700 mt-1">{resumo.emFilaImpressao}</p>
            <p className="text-xs text-gray-500 mt-0.5">Pagas prontas para imprimir</p>
          </div>
          <div className="w-12 h-12 bg-blue-50 rounded-xl flex items-center justify-center text-blue-600 shadow-inner">
            <Printer className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-white rounded-xl p-5 shadow-sm border border-purple-100 flex items-center justify-between">
          <div>
            <p className="text-xs font-bold text-purple-600 uppercase tracking-wider">Cartões Impressos</p>
            <p className="text-2xl font-black text-purple-700 mt-1">{resumo.impressos}</p>
            <p className="text-xs text-gray-500 mt-0.5">Aguardando entrega/retirada</p>
          </div>
          <div className="w-12 h-12 bg-purple-50 rounded-xl flex items-center justify-center text-purple-600 shadow-inner">
            <CheckCircle2 className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-white rounded-xl p-5 shadow-sm border border-amber-100 flex items-center justify-between">
          <div>
            <p className="text-xs font-bold text-amber-600 uppercase tracking-wider">Aguardando PIX</p>
            <p className="text-2xl font-black text-amber-700 mt-1">{resumo.aguardandoPagamento}</p>
            <p className="text-xs text-gray-500 mt-0.5">Cobranças geradas</p>
          </div>
          <div className="w-12 h-12 bg-amber-50 rounded-xl flex items-center justify-center text-amber-600 shadow-inner">
            <Clock className="w-6 h-6" />
          </div>
        </div>
      </div>

      {/* Barra de Filtros e Pesquisa */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 space-y-3">
        <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={busca}
              onChange={(e) => {
                setBusca(e.target.value);
                setPaginaAtual(1);
              }}
              placeholder="Buscar por associada, pastor, matrícula ou campo..."
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-rose-500"
            />
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={statusFiltro}
              onChange={(e) => {
                setStatusFiltro(e.target.value);
                setPaginaAtual(1);
              }}
              className="border border-gray-300 rounded-lg text-xs font-bold px-3 py-2 bg-white text-gray-700"
            >
              <option value="todos">Todos os Pedidos</option>
              <option value="pago,em_impressao">Fila de Impressão (Pagas)</option>
              <option value="impressa">Impressas (Prontas)</option>
              <option value="entregue">Entregues</option>
              <option value="aguardando_pagamento">Aguardando PIX</option>
              <option value="cancelada">Canceladas</option>
            </select>

            {/* Botão Limpar Filtros */}
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                setBusca('');
                setStatusFiltro('todos');
                setPaginaAtual(1);
              }}
              disabled={!busca && statusFiltro === 'todos'}
              className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold text-xs rounded-lg transition flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              title="Restaurar todos os filtros da fila de pedidos"
            >
              <RotateCcw className="w-3.5 h-3.5 text-gray-500" />
              <span>Limpar</span>
            </button>

            {/* Botão Gerar PDF Operacional da Fila de Solicitações */}
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                if (gerandoPdf || pedidosFiltrados.length === 0) return;
                setGerandoPdf(true);
                try {
                  const itensRelatorio = pedidosFiltrados.map((p) => ({
                    id: p.id,
                    associadaNome: p.associada.nomeEsposa,
                    associadaMatricula: p.associada.numeroAemadepa || null,
                    ministroNome: p.associada.ministroNome,
                    ministroMatricula: p.associada.ministroMatricula || null,
                    campo: p.associada.campo || null,
                    via: p.via,
                    valor: p.valor,
                    status: p.status,
                    pagoEm: p.pagoEm,
                    solicitadoEm: p.solicitadoEm,
                    impressoEm: p.impressoEm,
                    entregueEm: p.entregueEm,
                    entreguePara: p.entreguePara,
                  }));

                  gerarRelatorioPedidosCarteirinhaPDF(itensRelatorio, {
                    busca,
                    status: statusFiltro,
                  });
                } catch (err) {
                  console.error('Erro ao gerar relatório PDF de pedidos:', err);
                } finally {
                  setGerandoPdf(false);
                }
              }}
              disabled={gerandoPdf || pedidosFiltrados.length === 0}
              className="px-3.5 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-lg transition shadow-xs flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              title="Gerar e baixar relatório oficial em PDF com todos os pedidos filtrados"
            >
              <FileText className={`w-3.5 h-3.5 ${gerandoPdf ? 'animate-bounce' : ''}`} />
              <span>{gerandoPdf ? 'Gerando...' : 'Gerar PDF'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Tabela de Pedidos */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-gray-600 font-extrabold uppercase tracking-wider">
                <th className="py-3 px-4">Associada (Esposa)</th>
                <th className="py-3 px-4">Pastor Vinculado</th>
                <th className="py-3 px-4">Via / Valor</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Data Pagamento</th>
                <th className="py-3 px-4 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-gray-500">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto text-rose-600 mb-2" />
                    Carregando pedidos de carteirinhas...
                  </td>
                </tr>
              ) : pedidosFiltrados.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-gray-500">
                    Nenhum pedido encontrado para os filtros selecionados.
                  </td>
                </tr>
              ) : (
                pedidosPaginados.map((p) => {
                  const podeImprimir = ['pago', 'em_impressao', 'impressa', 'entregue'].includes(p.status);
                  return (
                    <tr key={p.id} className="hover:bg-rose-50/40 transition">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          {p.associada.fotoEsposaUrl ? (
                            <img
                              src={p.associada.fotoEsposaUrl}
                              alt=""
                              className="w-9 h-9 rounded-full object-cover border border-rose-200 shadow-xs"
                            />
                          ) : (
                            <div className="w-9 h-9 rounded-full bg-rose-100 text-rose-600 font-bold flex items-center justify-center text-xs">
                              {p.associada.nomeEsposa.slice(0, 2).toUpperCase()}
                            </div>
                          )}
                          <div>
                            <p className="font-bold text-gray-900 text-sm">{p.associada.nomeEsposa}</p>
                            <p className="text-gray-500 font-mono">{p.associada.cpfEsposa}</p>
                          </div>
                        </div>
                      </td>

                      <td className="py-3 px-4">
                        <p className="font-semibold text-gray-800">{p.associada.ministroNome}</p>
                        <p className="text-gray-500">
                          Mat: <strong>{p.associada.ministroMatricula || '—'}</strong> • {p.associada.campo}
                        </p>
                      </td>

                      <td className="py-3 px-4">
                        <span className="font-bold text-gray-700">{p.via}ª Via</span>
                        <p className="font-black text-rose-700 text-sm">R$ {p.valor.toFixed(2)}</p>
                      </td>

                      <td className="py-3 px-4">
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold ${
                            p.status === 'pago'
                              ? 'bg-blue-100 text-blue-800'
                              : p.status === 'em_impressao'
                              ? 'bg-indigo-100 text-indigo-800'
                              : p.status === 'impressa'
                              ? 'bg-purple-100 text-purple-800'
                              : p.status === 'entregue'
                              ? 'bg-emerald-100 text-emerald-800'
                              : p.status === 'cancelada'
                              ? 'bg-gray-100 text-gray-600'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {p.status === 'aguardando_pagamento' && 'Aguardando PIX'}
                          {p.status === 'pago' && 'Pago (Fila)'}
                          {p.status === 'em_impressao' && 'Em Impressão'}
                          {p.status === 'impressa' && 'Impressa'}
                          {p.status === 'entregue' && 'Entregue'}
                          {p.status === 'cancelada' && 'Cancelada'}
                        </span>
                      </td>

                      <td className="py-3 px-4 text-gray-600">
                        {p.pagoEm ? new Date(p.pagoEm).toLocaleDateString('pt-BR') : '—'}
                      </td>

                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* Botão Recuperar PIX para solicitações com status Aguardando PIX */}
                          {['aguardando_pagamento', 'processando_cobranca'].includes(p.status) && (
                            <button
                              type="button"
                              onClick={() => setModalRecuperarPix(p)}
                              className="px-2.5 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 rounded-lg text-xs font-bold flex items-center gap-1.5 transition cursor-pointer shadow-2xs"
                              title="Recuperar dados do PIX e QR Code para pagamento"
                            >
                              <QrCode className="w-3.5 h-3.5 text-amber-600" />
                              <span>Recuperar PIX</span>
                            </button>
                          )}

                          {/* Botão de Impressão integrado ao CartaoAemadepa existente */}
                          <button
                            type="button"
                            onClick={() => onImprimirCarteirinha(p.associada, { id: p.id, status: p.status })}
                            disabled={!podeImprimir}
                            className="p-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-lg transition title='Imprimir Carteirinha' disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                            title={podeImprimir ? 'Imprimir Carteirinha AEMADEPA' : 'Aguardando pagamento'}
                          >
                            <Printer className="w-4 h-4" />
                          </button>

                          {/* Botões de Recibo Institucional (Apenas para solicitações pagas/confirmadas) */}
                          {podeImprimir && (
                            <>
                              <button
                                type="button"
                                onClick={() => void baixarRecibo(p)}
                                disabled={baixandoReciboId === p.id}
                                className="p-1.5 bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1 shadow-2xs"
                                title="Baixar Recibo Oficial em PDF"
                              >
                                <Download className={`w-3.5 h-3.5 text-slate-600 ${baixandoReciboId === p.id ? 'animate-bounce' : ''}`} />
                                <span className="hidden sm:inline">Recibo</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => setModalEnviarRecibo(p)}
                                className="p-1.5 bg-pink-50 hover:bg-pink-100 text-pink-700 border border-pink-200 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1 shadow-2xs"
                                title="Enviar Recibo por E-mail (Resend)"
                              >
                                <Mail className="w-3.5 h-3.5 text-pink-600" />
                                <span className="hidden sm:inline">Enviar</span>
                              </button>
                            </>
                          )}

                          {/* Botão de Registro de Entrega (Apenas após a carteirinha estar impressa) */}
                          {p.status === 'impressa' && (
                            <button
                              type="button"
                              onClick={() => {
                                setModalEntregaPedido(p);
                                setEntregueParaNome(p.associada.ministroNome);
                              }}
                              className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold flex items-center gap-1 transition cursor-pointer"
                              title="Registrar entrega física da carteirinha"
                            >
                              <Truck className="w-3.5 h-3.5" />
                              <span>Entregar</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Paginação da Fila de Pedidos (Exatamente 15 por página) */}
        <div className="px-5 py-3.5 border-t border-gray-200 bg-gray-50 flex items-center justify-between text-xs text-gray-600">
          <div>
            Mostrando {pedidosFiltrados.length === 0 ? 0 : (paginaSegura - 1) * ITENS_POR_PAGINA + 1} até{' '}
            {Math.min(paginaSegura * ITENS_POR_PAGINA, pedidosFiltrados.length)} de{' '}
            {pedidosFiltrados.length} solicitação(ões)
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                setPaginaAtual((p) => Math.max(1, p - 1));
              }}
              disabled={paginaSegura <= 1}
              className="px-3 py-1.5 rounded-md border border-gray-300 bg-white hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
            >
              Anterior
            </button>
            <span className="px-3 py-1 font-semibold text-gray-700">
              {paginaSegura} / {totalPaginas}
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                setPaginaAtual((p) => Math.min(totalPaginas, p + 1));
              }}
              disabled={paginaSegura >= totalPaginas}
              className="px-3 py-1.5 rounded-md border border-gray-300 bg-white hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
            >
              Próxima
            </button>
          </div>
        </div>
      </div>

      {/* Modal de Registro de Entrega */}
      {modalEntregaPedido && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 space-y-4 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between pb-3 border-b border-gray-100">
              <div className="flex items-center gap-2.5 text-emerald-700">
                <Truck className="w-5 h-5" />
                <h3 className="font-extrabold text-base">Registrar Entrega da Carteirinha</h3>
              </div>
              <button
                onClick={() => setModalEntregaPedido(null)}
                className="text-gray-400 hover:text-gray-600 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="text-xs text-gray-600 space-y-1.5 bg-gray-50 p-3.5 rounded-xl border border-gray-200">
              <p><strong>Associada:</strong> {modalEntregaPedido.associada.nomeEsposa}</p>
              <p><strong>Pastor:</strong> {modalEntregaPedido.associada.ministroNome}</p>
              <p><strong>Via:</strong> {modalEntregaPedido.via}ª Via</p>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-gray-700">Entregue para quem?</label>
              <input
                type="text"
                value={entregueParaNome}
                onChange={(e) => setEntregueParaNome(e.target.value)}
                placeholder="Ex: Pastor, Esposa ou Representante da Região"
                className="w-full text-xs border border-gray-300 rounded-lg px-3 py-2 text-gray-800"
              />
            </div>

            <div className="pt-2 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setModalEntregaPedido(null)}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold text-xs rounded-lg cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() =>
                  atualizarStatus(modalEntregaPedido.id, 'entregue', entregueParaNome)
                }
                disabled={atualizandoId === modalEntregaPedido.id}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-lg flex items-center gap-1.5 shadow-sm cursor-pointer"
              >
                <Check className="w-4 h-4" />
                <span>Confirmar Entrega</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Recuperação de PIX */}
      {modalRecuperarPix && (
        <ModalRecuperarPixAemadepa
          pedidoId={modalRecuperarPix.id}
          nomeAssociada={modalRecuperarPix.associada.nomeEsposa}
          onFechar={() => setModalRecuperarPix(null)}
        />
      )}

      {/* Modal de Envio de Recibo por E-mail */}
      {modalEnviarRecibo && (
        <ModalEnviarReciboAemadepa
          pedidoId={modalEnviarRecibo.id}
          nomeAssociada={modalEnviarRecibo.associada.nomeEsposa}
          emailPadrao={modalEnviarRecibo.associada.emailEsposa}
          via={modalEnviarRecibo.via}
          valor={modalEnviarRecibo.valor}
          onFechar={() => setModalEnviarRecibo(null)}
          onEnviadoSucesso={() => {
            void carregarPedidos();
          }}
        />
      )}
    </div>
  );
}
