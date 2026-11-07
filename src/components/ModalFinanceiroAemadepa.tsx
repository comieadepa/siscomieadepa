'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  X,
  DollarSign,
  QrCode,
  Banknote,
  Gift,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Copy,
  Check,
  RotateCcw,
  Printer,
  History,
  ShieldCheck,
  Loader2,
  FileText,
} from 'lucide-react';
import { authenticatedFetch } from '@/lib/api-client';
import { QRCodeSVG } from 'qrcode.react';

interface SolicitacaoItem {
  id: string;
  via: number;
  valor: number;
  status: string;
  forma_pagamento?: string;
  motivo_cortesia?: string | null;
  pix_copia_cola?: string | null;
  pix_qr_code_url?: string | null;
  solicitado_em?: string;
  pago_em?: string | null;
  impresso_em?: string | null;
  entregue_em?: string | null;
  created_at?: string;
}

interface ImpressaoItem {
  id: string;
  via: number;
  tipo: string;
  motivo_reimpressao?: string | null;
  impresso_em: string;
}

interface ModalFinanceiroAemadepaProps {
  associadaId: string;
  associadaNome: string;
  associadaCpf: string;
  ministroNome: string;
  temFoto: boolean;
  onClose: () => void;
  onAtualizarStatus?: () => void;
  onAbrirCredencial?: () => void;
}

export default function ModalFinanceiroAemadepa({
  associadaId,
  associadaNome,
  associadaCpf,
  ministroNome,
  temFoto,
  onClose,
  onAtualizarStatus,
  onAbrirCredencial,
}: ModalFinanceiroAemadepaProps) {
  const [tab, setTab] = useState<'status' | 'pix' | 'avista' | 'cortesia' | 'historico'>('status');
  const [loading, setLoading] = useState(true);
  const [processando, setProcessando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [sucessoMsg, setSucessoMsg] = useState<string | null>(null);

  // Dados carregados do backend
  const [solicitacaoAtiva, setSolicitacaoAtiva] = useState<SolicitacaoItem | null>(null);
  const [historicoSolicitacoes, setHistoricoSolicitacoes] = useState<SolicitacaoItem[]>([]);
  const [historicoImpressoes, setHistoricoImpressoes] = useState<ImpressaoItem[]>([]);
  const [elegibilidade, setElegibilidade] = useState<{
    temFoto: boolean;
    regularizada: boolean;
    podeImprimirCredencial: boolean;
    motivoBloqueio: string | null;
  }>({
    temFoto: false,
    regularizada: false,
    podeImprimirCredencial: false,
    motivoBloqueio: null,
  });

  // Campos de formulários
  const [justificativaCortesia, setJustificativaCortesia] = useState('');
  const [motivoReimpressao, setMotivoReimpressao] = useState('');
  const [copiado, setCopiado] = useState(false);
  const [mostrarModalReimpressao, setMostrarModalReimpressao] = useState(false);

  // Carrega status financeiro completo da associada
  const carregarDadosFinanceiros = useCallback(async () => {
    setLoading(true);
    setErro(null);
    try {
      const res = await authenticatedFetch(`/api/v1/aemadepa/financeiro?associadaId=${associadaId}`);
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(data?.error || 'Erro ao carregar dados financeiros');
      }

      setSolicitacaoAtiva(data.solicitacaoAtiva);
      setHistoricoSolicitacoes(data.historicoSolicitacoes || []);
      setHistoricoImpressoes(data.historicoImpressoes || []);
      setElegibilidade(data.elegibilidadeCredencial || {
        temFoto: false,
        regularizada: false,
        podeImprimirCredencial: false,
        motivoBloqueio: null,
      });

      // Se não houver solicitação ou estiver pendente, direciona aba apropriada
      if (!data.solicitacaoAtiva || data.solicitacaoAtiva.status === 'aguardando_pagamento') {
        if (data.solicitacaoAtiva?.pix_copia_cola) {
          setTab('pix');
        }
      }
    } catch (err: any) {
      setErro(err.message);
    } finally {
      setLoading(false);
    }
  }, [associadaId]);

  useEffect(() => {
    void carregarDadosFinanceiros();
  }, [carregarDadosFinanceiros]);

  // Ação: Gerar Cobrança PIX
  const handleGerarPix = async () => {
    setProcessando(true);
    setErro(null);
    setSucessoMsg(null);
    try {
      const res = await authenticatedFetch('/api/v1/aemadepa/financeiro/pix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ associadaId }),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(data?.error || 'Erro ao gerar cobrança PIX');
      }

      setSucessoMsg('Cobrança PIX gerada com sucesso.');
      await carregarDadosFinanceiros();
      setTab('pix');
    } catch (err: any) {
      setErro(err.message);
    } finally {
      setProcessando(false);
    }
  };

  // Ação: Confirmar Pagamento À Vista (R$ 20,00)
  const handleConfirmarAVista = async () => {
    if (!confirm(`Confirma o recebimento de R$ 20,00 em dinheiro/balcão para a carteirinha de ${associadaNome}?`)) {
      return;
    }

    setProcessando(true);
    setErro(null);
    setSucessoMsg(null);
    try {
      const res = await authenticatedFetch('/api/v1/aemadepa/financeiro', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao: 'a_vista', associadaId }),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(data?.error || 'Erro ao registrar pagamento à vista');
      }

      setSucessoMsg(data.mensagem || 'Pagamento à vista confirmado com sucesso.');
      await carregarDadosFinanceiros();
      setTab('status');
      onAtualizarStatus?.();
    } catch (err: any) {
      setErro(err.message);
    } finally {
      setProcessando(false);
    }
  };

  // Ação: Conceder Cortesia (R$ 0,00)
  const handleConcederCortesia = async () => {
    const motivo = justificativaCortesia.trim();
    if (motivo.length < 5) {
      setErro('A justificativa da cortesia é obrigatória e deve ter pelo menos 5 caracteres.');
      return;
    }

    setProcessando(true);
    setErro(null);
    setSucessoMsg(null);
    try {
      const res = await authenticatedFetch('/api/v1/aemadepa/financeiro', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao: 'cortesia', associadaId, justificativa: motivo }),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(data?.error || 'Erro ao conceder cortesia');
      }

      setSucessoMsg('Cortesia concedida e registrada na trilha auditável.');
      setJustificativaCortesia('');
      await carregarDadosFinanceiros();
      setTab('status');
      onAtualizarStatus?.();
    } catch (err: any) {
      setErro(err.message);
    } finally {
      setProcessando(false);
    }
  };

  // Ação: Solicitar Segunda Via (Inicia novo ciclo)
  const handleSolicitarSegundaVia = async () => {
    if (!confirm(`Deseja iniciar um novo ciclo financeiro para gerar a Segunda Via da credencial de ${associadaNome}?`)) {
      return;
    }

    setProcessando(true);
    setErro(null);
    setSucessoMsg(null);
    try {
      const res = await authenticatedFetch('/api/v1/aemadepa/financeiro', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao: 'segunda_via', associadaId }),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(data?.error || 'Erro ao iniciar segunda via');
      }

      setSucessoMsg(data.mensagem || 'Nova via iniciada com sucesso.');
      await carregarDadosFinanceiros();
      setTab('status');
      onAtualizarStatus?.();
    } catch (err: any) {
      setErro(err.message);
    } finally {
      setProcessando(false);
    }
  };

  // Ação: Registrar Reimpressão (mesma via, sem custo, motivo obrigatório)
  const handleConfirmarReimpressao = async () => {
    const motivo = motivoReimpressao.trim();
    if (motivo.length < 5) {
      setErro('O motivo da reimpressão é obrigatório (mínimo de 5 caracteres).');
      return;
    }

    if (!solicitacaoAtiva) return;

    setProcessando(true);
    setErro(null);
    try {
      const res = await authenticatedFetch('/api/v1/secretaria/aemadepa/pedidos', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: solicitacaoAtiva.id,
          novoStatus: 'impressa',
          tipoImpressao: 'reimpressao',
          motivoReimpressao: motivo,
        }),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(data?.error || 'Erro ao registrar reimpressão');
      }

      setSucessoMsg('Reimpressão registrada com sucesso no histórico auditável.');
      setMostrarModalReimpressao(false);
      setMotivoReimpressao('');
      await carregarDadosFinanceiros();
      onAtualizarStatus?.();
    } catch (err: any) {
      setErro(err.message);
    } finally {
      setProcessando(false);
    }
  };

  // Ação: Confirmar Impressão Física Realizada
  const handleConfirmarImpressaoFisica = async () => {
    if (!solicitacaoAtiva) return;

    setProcessando(true);
    setErro(null);
    try {
      const res = await authenticatedFetch('/api/v1/secretaria/aemadepa/pedidos', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: solicitacaoAtiva.id,
          novoStatus: 'impressa',
          tipoImpressao: 'primeira_impressao',
        }),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(data?.error || 'Erro ao confirmar impressão física');
      }

      setSucessoMsg('Impressão física confirmada e registrada na auditoria.');
      await carregarDadosFinanceiros();
      onAtualizarStatus?.();
    } catch (err: any) {
      setErro(err.message);
    } finally {
      setProcessando(false);
    }
  };

  const copiarPix = () => {
    if (solicitacaoAtiva?.pix_copia_cola) {
      navigator.clipboard.writeText(solicitacaoAtiva.pix_copia_cola);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-200">
        {/* Topo do Modal */}
        <div className="bg-gradient-to-r from-emerald-800 via-teal-800 to-emerald-900 text-white px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center backdrop-blur-xs">
              <DollarSign className="w-6 h-6 text-emerald-300" />
            </div>
            <div>
              <h2 className="text-base font-extrabold tracking-tight">Financeiro & Credencial AEMADEPA</h2>
              <p className="text-xs text-emerald-200">
                {associadaNome} • CPF: {associadaCpf || '—'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-white/70 hover:text-white p-1 rounded-lg hover:bg-white/10 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Notificações e Avisos */}
        {erro && (
          <div className="mx-6 mt-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
            <span>{erro}</span>
          </div>
        )}

        {sucessoMsg && (
          <div className="mx-6 mt-4 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
            <span>{sucessoMsg}</span>
          </div>
        )}

        {/* Navegação por Abas */}
        <div className="flex border-b border-gray-200 px-6 pt-3 bg-gray-50 text-xs font-semibold">
          <button
            onClick={() => setTab('status')}
            className={`pb-2.5 px-3 border-b-2 transition flex items-center gap-1.5 cursor-pointer ${
              tab === 'status'
                ? 'border-emerald-600 text-emerald-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Situação Atual</span>
          </button>

          <button
            onClick={() => setTab('pix')}
            className={`pb-2.5 px-3 border-b-2 transition flex items-center gap-1.5 cursor-pointer ${
              tab === 'pix'
                ? 'border-emerald-600 text-emerald-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <QrCode className="w-3.5 h-3.5" />
            <span>PIX ASAAS (R$ 20)</span>
          </button>

          <button
            onClick={() => setTab('avista')}
            className={`pb-2.5 px-3 border-b-2 transition flex items-center gap-1.5 cursor-pointer ${
              tab === 'avista'
                ? 'border-emerald-600 text-emerald-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <Banknote className="w-3.5 h-3.5" />
            <span>À Vista (R$ 20)</span>
          </button>

          <button
            onClick={() => setTab('cortesia')}
            className={`pb-2.5 px-3 border-b-2 transition flex items-center gap-1.5 cursor-pointer ${
              tab === 'cortesia'
                ? 'border-emerald-600 text-emerald-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <Gift className="w-3.5 h-3.5" />
            <span>Cortesia (R$ 0)</span>
          </button>

          <button
            onClick={() => setTab('historico')}
            className={`pb-2.5 px-3 border-b-2 transition flex items-center gap-1.5 cursor-pointer ${
              tab === 'historico'
                ? 'border-emerald-600 text-emerald-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            <span>Histórico ({historicoSolicitacoes.length})</span>
          </button>
        </div>

        {/* Corpo do Modal */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1">
          {loading ? (
            <div className="py-12 flex flex-col items-center justify-center gap-2 text-gray-400">
              <Loader2 className="w-8 h-8 animate-spin text-emerald-600" />
              <p className="text-xs">Consultando dados financeiros e auditoria...</p>
            </div>
          ) : (
            <>
              {/* ABA 1: SITUAÇÃO ATUAL E CONTROLES OPERACIONAIS */}
              {tab === 'status' && (
                <div className="space-y-4">
                  {/* Cartão de Status */}
                  <div className="p-4 rounded-xl border border-gray-200 bg-gray-50/70 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-gray-600 uppercase tracking-wider">
                          Via Ativa:
                        </span>
                        <span className="px-2 py-0.5 bg-purple-100 text-purple-800 text-xs font-extrabold rounded-md border border-purple-200">
                          {solicitacaoAtiva ? `${solicitacaoAtiva.via}ª Via` : '1ª Via (Não iniciada)'}
                        </span>
                      </div>

                      {solicitacaoAtiva?.status ? (
                        <span
                          className={`px-3 py-1 text-xs font-bold rounded-full inline-flex items-center gap-1.5 ${
                            ['pago', 'em_impressao', 'impressa', 'entregue'].includes(solicitacaoAtiva.status)
                              ? 'bg-emerald-100 text-emerald-800'
                              : solicitacaoAtiva.status === 'aguardando_pagamento'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-gray-100 text-gray-800'
                          }`}
                        >
                          {['pago', 'em_impressao', 'impressa', 'entregue'].includes(solicitacaoAtiva.status) ? (
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                          ) : (
                            <Clock className="w-3.5 h-3.5 text-amber-600" />
                          )}
                          <span className="capitalize">
                            {solicitacaoAtiva.status.replace(/_/g, ' ')}
                          </span>
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400 font-medium">Sem pedido em andamento</span>
                      )}
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 text-xs border-t border-gray-200/80">
                      <div>
                        <p className="text-gray-400">Modalidade:</p>
                        <p className="font-bold text-gray-800 capitalize">
                          {solicitacaoAtiva?.forma_pagamento ? solicitacaoAtiva.forma_pagamento.replace('_', ' ') : '—'}
                        </p>
                      </div>
                      <div>
                        <p className="text-gray-400">Valor Cobrado:</p>
                        <p className="font-bold text-gray-800">
                          {solicitacaoAtiva ? `R$ ${Number(solicitacaoAtiva.valor).toFixed(2)}` : 'R$ 20,00'}
                        </p>
                      </div>
                      <div>
                        <p className="text-gray-400">Data Quitação:</p>
                        <p className="font-bold text-gray-800">
                          {solicitacaoAtiva?.pago_em ? new Date(solicitacaoAtiva.pago_em).toLocaleDateString('pt-BR') : 'Pendente'}
                        </p>
                      </div>
                      <div>
                        <p className="text-gray-400">Foto 3x4:</p>
                        <p className={`font-bold ${temFoto ? 'text-emerald-700' : 'text-rose-700'}`}>
                          {temFoto ? 'Cadastrada' : 'Ausente'}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Painel de Ações de Liberação de Credencial */}
                  <div className="p-4 rounded-xl border border-emerald-200 bg-emerald-50/50 space-y-3">
                    <h3 className="text-xs font-bold text-emerald-900 uppercase tracking-wide flex items-center gap-1.5">
                      <Printer className="w-4 h-4 text-emerald-700" />
                      <span>Emissão e Controle Físico de Credencial</span>
                    </h3>

                    {elegibilidade.podeImprimirCredencial ? (
                      <div className="space-y-3">
                        <p className="text-xs text-emerald-800">
                          ✓ Foto cadastrada e quitação financeira confirmada. A credencial está pronta para emissão.
                        </p>

                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          {/* Abrir Modal de Impressão / Prévia */}
                          <button
                            type="button"
                            onClick={() => {
                              onClose();
                              onAbrirCredencial?.();
                            }}
                            className="px-3.5 py-2 bg-purple-700 hover:bg-purple-800 text-white rounded-lg text-xs font-bold transition flex items-center gap-1.5 shadow-xs cursor-pointer"
                          >
                            <Printer className="w-4 h-4" />
                            <span>Abrir / Baixar Credencial</span>
                          </button>

                          {/* Confirmar Impressão Física Realizada */}
                          {solicitacaoAtiva?.status !== 'impressa' && solicitacaoAtiva?.status !== 'entregue' && (
                            <button
                              type="button"
                              onClick={handleConfirmarImpressaoFisica}
                              disabled={processando}
                              className="px-3.5 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-xs font-bold transition flex items-center gap-1.5 shadow-xs cursor-pointer disabled:opacity-50"
                            >
                              <CheckCircle2 className="w-4 h-4" />
                              <span>Confirmar Impressão Física</span>
                            </button>
                          )}

                          {/* Se já foi impressa ou entregue: oferecer Reimpressão ou Segunda Via */}
                          {(solicitacaoAtiva?.status === 'impressa' || solicitacaoAtiva?.status === 'entregue') && (
                            <>
                              <button
                                type="button"
                                onClick={() => setMostrarModalReimpressao(true)}
                                className="px-3.5 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold transition flex items-center gap-1.5 shadow-xs cursor-pointer"
                              >
                                <RotateCcw className="w-4 h-4" />
                                <span>Reimprimir Mesma Via (Sem Custo)</span>
                              </button>

                              {solicitacaoAtiva?.status === 'entregue' && (
                                <button
                                  type="button"
                                  onClick={handleSolicitarSegundaVia}
                                  disabled={processando}
                                  className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition flex items-center gap-1.5 shadow-xs cursor-pointer"
                                >
                                  <DollarSign className="w-4 h-4" />
                                  <span>Iniciar Segunda Via (Novo Ciclo)</span>
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900 flex items-start gap-2">
                          <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                          <div>
                            <p className="font-bold">Emissão de Credencial Bloqueada</p>
                            <p>{elegibilidade.motivoBloqueio || 'Regularize a situação financeira ou cadastre a foto para liberar a credencial.'}</p>
                          </div>
                        </div>

                        {!solicitacaoAtiva?.pago_em && (
                          <div className="flex items-center gap-2 pt-2">
                            <button
                              type="button"
                              onClick={() => setTab('pix')}
                              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition cursor-pointer"
                            >
                              Pagar com PIX
                            </button>
                            <button
                              type="button"
                              onClick={() => setTab('avista')}
                              className="px-3 py-1.5 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-xs font-bold transition cursor-pointer"
                            >
                              Registrar À Vista
                            </button>
                            <button
                              type="button"
                              onClick={() => setTab('cortesia')}
                              className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold transition cursor-pointer"
                            >
                              Conceder Cortesia
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ABA 2: PIX VIA ASAAS */}
              {tab === 'pix' && (
                <div className="space-y-4">
                  {solicitacaoAtiva?.pix_copia_cola ? (
                    <div className="flex flex-col sm:flex-row items-center gap-5 p-4 bg-gray-50 border border-gray-200 rounded-xl">
                      {/* Renderização do QR Code PIX com suporte a Data-URI, Base64 cru e QRCodeSVG a partir do Copia e Cola */}
                      <div className="p-2.5 bg-white rounded-xl border border-gray-300 shadow-sm shrink-0 flex items-center justify-center min-w-[160px] min-h-[160px]">
                        {solicitacaoAtiva.pix_qr_code_url ? (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img
                            src={
                              solicitacaoAtiva.pix_qr_code_url.startsWith('data:')
                                ? solicitacaoAtiva.pix_qr_code_url
                                : `data:image/png;base64,${solicitacaoAtiva.pix_qr_code_url}`
                            }
                            alt="QR Code PIX"
                            className="w-36 h-36 object-contain"
                          />
                        ) : solicitacaoAtiva.pix_copia_cola ? (
                          <QRCodeSVG
                            value={solicitacaoAtiva.pix_copia_cola}
                            size={144}
                            level="M"
                            className="w-36 h-36"
                          />
                        ) : (
                          <div className="w-36 h-36 flex flex-col items-center justify-center text-gray-400 text-[11px] text-center p-2">
                            <QrCode className="w-8 h-8 mb-1 text-gray-300" />
                            <span>QR Code Indisponível</span>
                          </div>
                        )}
                      </div>

                      <div className="flex-1 space-y-2 text-xs">
                        <p className="font-bold text-gray-800">PIX ASAAS — Valor: R$ 20,00</p>
                        <p className="text-gray-500">
                          Apresente o QR Code acima para leitura no app do banco ou copie o código Copia e Cola abaixo.
                        </p>

                        <div className="space-y-1">
                          <label className="text-[11px] font-semibold text-gray-600">Código Copia e Cola:</label>
                          <div className="flex items-center gap-1.5">
                            <input
                              type="text"
                              readOnly
                              value={solicitacaoAtiva.pix_copia_cola}
                              className="w-full text-xs bg-white border border-gray-300 rounded-lg px-2.5 py-1.5 font-mono text-gray-700 select-all"
                            />
                            <button
                              type="button"
                              onClick={copiarPix}
                              className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-xs font-bold transition flex items-center gap-1 cursor-pointer shrink-0"
                            >
                              {copiado ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                              <span>{copiado ? 'Copiado' : 'Copiar'}</span>
                            </button>
                          </div>
                        </div>

                        <p className="text-[11px] text-gray-400 italic pt-1">
                          * A baixa é processada automaticamente via Webhook ASAAS assim que o pagamento for concluído.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-8 space-y-3">
                      <QrCode className="w-12 h-12 text-emerald-600 mx-auto opacity-60" />
                      <div>
                        <h4 className="font-bold text-gray-800 text-sm">Gerar Cobrança PIX Oficial</h4>
                        <p className="text-xs text-gray-500 max-w-md mx-auto">
                          Gera a cobrança de R$ 20,00 integrada ao ASAAS oficial da convenção com QR Code dinâmico.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={handleGerarPix}
                        disabled={processando || !temFoto}
                        className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition inline-flex items-center gap-2 cursor-pointer shadow-xs"
                      >
                        {processando ? <Loader2 className="w-4 h-4 animate-spin" /> : <QrCode className="w-4 h-4" />}
                        <span>Gerar PIX R$ 20,00</span>
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* ABA 3: PAGAMENTO À VISTA */}
              {tab === 'avista' && (
                <div className="space-y-4">
                  <div className="p-4 bg-teal-50 border border-teal-200 rounded-xl space-y-2 text-xs text-teal-900">
                    <p className="font-bold flex items-center gap-1.5 text-sm">
                      <Banknote className="w-4 h-4 text-teal-700" />
                      <span>Quitação Presencial / Dinheiro em Espécie (R$ 20,00)</span>
                    </p>
                    <p>
                      Utilize esta opção quando a associada efetuar o pagamento diretamente na tesouraria ou balcão da secretaria.
                    </p>
                    <p className="text-[11px] text-teal-700 font-semibold">
                      * O seu usuário e a data/hora serão registrados compulsóriamente na trilha de auditoria fiscal.
                    </p>
                  </div>

                  <div className="pt-2 flex justify-end">
                    <button
                      type="button"
                      onClick={handleConfirmarAVista}
                      disabled={processando || !temFoto || Boolean(solicitacaoAtiva?.pago_em)}
                      className="px-4 py-2.5 bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition flex items-center gap-2 shadow-xs cursor-pointer"
                    >
                      {processando ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                      <span>Confirmar Recebimento R$ 20,00</span>
                    </button>
                  </div>
                </div>
              )}

              {/* ABA 4: CORTESIA */}
              {tab === 'cortesia' && (
                <div className="space-y-4">
                  <div className="p-4 bg-indigo-50 border border-indigo-200 rounded-xl space-y-2 text-xs text-indigo-900">
                    <p className="font-bold flex items-center gap-1.5 text-sm">
                      <Gift className="w-4 h-4 text-indigo-700" />
                      <span>Concessão de Cortesia (R$ 0,00)</span>
                    </p>
                    <p>
                      A concessão de cortesia isenta a cobrança financeira, mas exige justificativa formal auditável para aprovação pela diretoria/convenção.
                    </p>
                    <p className="text-[11px] text-indigo-700 font-semibold">
                      * Cortesias não compõem a receita financeira e ficam registradas em relatório de controle.
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-gray-700">
                      Justificativa Obrigatória da Isenção:
                    </label>
                    <textarea
                      rows={3}
                      value={justificativaCortesia}
                      onChange={(e) => setJustificativaCortesia(e.target.value)}
                      placeholder="Ex: Esposa de Ministro Jubilado / Cortesia autorizada pela Diretoria da AEMADEPA"
                      className="w-full text-xs border border-gray-300 rounded-xl p-3 text-gray-800"
                    />
                  </div>

                  <div className="pt-2 flex justify-end">
                    <button
                      type="button"
                      onClick={handleConcederCortesia}
                      disabled={processando || !temFoto || justificativaCortesia.trim().length < 5}
                      className="px-4 py-2.5 bg-indigo-700 hover:bg-indigo-800 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition flex items-center gap-2 shadow-xs cursor-pointer"
                    >
                      {processando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Gift className="w-4 h-4" />}
                      <span>Conceder e Registrar Cortesia</span>
                    </button>
                  </div>
                </div>
              )}

              {/* ABA 5: HISTÓRICO AUDITÁVEL */}
              {tab === 'historico' && (
                <div className="space-y-4 text-xs">
                  <h4 className="font-bold text-gray-800 flex items-center gap-1.5">
                    <FileText className="w-4 h-4 text-gray-500" />
                    <span>Trilha de Auditoria de Emissões e Pagamentos</span>
                  </h4>

                  {historicoSolicitacoes.length === 0 ? (
                    <p className="text-gray-400 italic py-4 text-center">Nenhum evento registrado ainda.</p>
                  ) : (
                    <div className="space-y-2">
                      {historicoSolicitacoes.map((s) => (
                        <div
                          key={s.id}
                          className="p-3 bg-gray-50 border border-gray-200 rounded-xl flex items-center justify-between"
                        >
                          <div>
                            <p className="font-bold text-gray-800">
                              {s.via}ª Via • R$ {Number(s.valor).toFixed(2)} ({s.forma_pagamento || 'pix'})
                            </p>
                            <p className="text-[11px] text-gray-500">
                              Solicitado: {s.solicitado_em ? new Date(s.solicitado_em).toLocaleDateString('pt-BR') : '—'}
                              {s.pago_em && ` • Quitado: ${new Date(s.pago_em).toLocaleDateString('pt-BR')}`}
                            </p>
                            {s.motivo_cortesia && (
                              <p className="text-[11px] text-indigo-700 italic">
                                Justificativa Cortesia: {s.motivo_cortesia}
                              </p>
                            )}
                          </div>

                          <span className="px-2.5 py-1 text-[11px] font-bold rounded-full bg-white border border-gray-200 uppercase text-gray-700">
                            {s.status.replace(/_/g, ' ')}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Histórico de Impressões / Reimpressões */}
                  {historicoImpressoes.length > 0 && (
                    <div className="pt-3 border-t border-gray-200 space-y-2">
                      <h4 className="font-bold text-gray-700">Eventos de Impressão Física</h4>
                      <div className="space-y-1.5">
                        {historicoImpressoes.map((imp) => (
                          <div
                            key={imp.id}
                            className="p-2.5 bg-purple-50/60 border border-purple-100 rounded-lg text-[11px] flex items-center justify-between"
                          >
                            <div>
                              <p className="font-semibold text-purple-900">
                                {imp.tipo === 'reimpressao' ? 'Reimpressão' : 'Primeira Impressão'} • {imp.via}ª Via
                              </p>
                              {imp.motivo_reimpressao && (
                                <p className="text-gray-600">Motivo: {imp.motivo_reimpressao}</p>
                              )}
                            </div>
                            <span className="text-gray-400">
                              {new Date(imp.impresso_em).toLocaleString('pt-BR')}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Rodapé do Modal */}
        <div className="px-6 py-3.5 bg-gray-50 border-t border-gray-200 flex items-center justify-between text-xs">
          <span className="text-gray-500">Pastor: {ministroNome}</span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold rounded-lg transition cursor-pointer"
          >
            Fechar
          </button>
        </div>
      </div>

      {/* Modal Secundário: Confirmação de Reimpressão com Motivo Mandatório */}
      {mostrarModalReimpressao && (
        <div className="fixed inset-0 bg-black/70 z-60 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-5 space-y-3 shadow-2xl animate-in zoom-in-95">
            <h3 className="font-bold text-sm text-gray-900 flex items-center gap-1.5">
              <RotateCcw className="w-4 h-4 text-amber-600" />
              <span>Reimpressão da Mesma Via (Sem Custo)</span>
            </h3>
            <p className="text-xs text-gray-600">
              Informe o motivo operacional para reimprimir a credencial de {associadaNome} (ex: falha mecânica, erro de laminação ou perda antes da entrega).
            </p>

            <div className="space-y-1">
              <label className="text-[11px] font-bold text-gray-700">Motivo (mínimo 5 caracteres):</label>
              <textarea
                rows={2}
                value={motivoReimpressao}
                onChange={(e) => setMotivoReimpressao(e.target.value)}
                placeholder="Ex: Cartão danificado durante laminação térmica"
                className="w-full text-xs border border-gray-300 rounded-lg p-2 text-gray-800"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setMostrarModalReimpressao(false)}
                className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold text-xs rounded-lg cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmarReimpressao}
                disabled={processando || motivoReimpressao.trim().length < 5}
                className="px-4 py-1.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-bold text-xs rounded-lg transition cursor-pointer flex items-center gap-1"
              >
                {processando && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Confirmar Reimpressão</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
