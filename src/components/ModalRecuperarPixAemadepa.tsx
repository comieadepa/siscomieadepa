'use client';

import { useState, useCallback } from 'react';
import {
  X,
  RefreshCw,
  Copy,
  Check,
  Phone,
  MessageCircle,
  AlertCircle,
  Clock,
  CheckCircle2,
  QrCode,
  Info,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { authenticatedFetch } from '@/lib/api-client';

/** Dados completos retornados pela API GET /api/v1/secretaria/aemadepa/pedidos/[id]/pix */
export interface DadosPixRecuperado {
  bloqueado: boolean;
  motivoBloqueio?: string | null;
  statusLocal: string;
  statusAsaas?: string | null;
  vencimentoAsaas?: string | null;
  pixCopiaECola?: string | null;
  pixQrCodeBase64?: string | null;
  invoiceUrl?: string | null;
  pagoEm?: string | null;
  associada: {
    nome: string;
    cpf: string;
    fone: string | null;
    fotoUrl: string | null;
    email: string | null;
    numeroAemadepa: string;
  };
  ministro: {
    nome: string;
    matricula: string;
    campo: string;
  };
  pedido: {
    id: string;
    via: number;
    valor: number;
    solicitadoEm: string;
  };
}

interface ModalRecuperarPixAemadepaProps {
  pedidoId: string;
  nomeAssociada: string;
  onFechar: () => void;
}

function normalizarTelefoneWhatsApp(fone: string | null | undefined): string | null {
  if (!fone) return null;
  const digits = fone.replace(/\D/g, '');
  if (digits.length === 0) return null;
  // Adiciona DDI Brasil (55) se não presente
  if (digits.startsWith('55') && digits.length >= 12) return digits;
  if (digits.length === 11 || digits.length === 10) return `55${digits}`;
  if (digits.length >= 12) return digits;
  return null;
}

function formatarValor(valor: number): string {
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    aguardando_pagamento: 'Aguardando PIX',
    processando_cobranca: 'Processando Cobrança',
    pago: 'Pago',
    em_impressao: 'Em Impressão',
    impressa: 'Impressa',
    entregue: 'Entregue',
    cancelada: 'Cancelada',
    PENDING: 'Pendente',
    AWAITING_RISK_ANALYSIS: 'Em Análise',
    CONFIRMED: 'Confirmado',
    RECEIVED: 'Recebido',
    OVERDUE: 'Vencido',
    REFUNDED: 'Estornado',
    DELETED: 'Cancelado',
    CANCELLED: 'Cancelado',
  };
  return map[status] || status;
}

export default function ModalRecuperarPixAemadepa({
  pedidoId,
  nomeAssociada,
  onFechar,
}: ModalRecuperarPixAemadepaProps) {
  const [loading, setLoading] = useState(false);
  const [dados, setDados] = useState<DadosPixRecuperado | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [msgCopiada, setMsgCopiada] = useState(false);
  const [carregouUmaVez, setCarregouUmaVez] = useState(false);

  const recuperarPix = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    setErro(null);
    try {
      const res = await authenticatedFetch(`/api/v1/secretaria/aemadepa/pedidos/${pedidoId}/pix`);
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error || 'Erro ao consultar dados do PIX.');
      }
      setDados(data);
      setCarregouUmaVez(true);
    } catch (err: any) {
      setErro(err.message || 'Erro inesperado ao recuperar o PIX.');
    } finally {
      setLoading(false);
    }
  }, [loading, pedidoId]);

  // Carrega automaticamente ao montar (apenas 1 vez)
  if (!carregouUmaVez && !loading && !erro) {
    void recuperarPix();
  }

  const copiarPix = async () => {
    if (!dados?.pixCopiaECola) return;
    try {
      await navigator.clipboard.writeText(dados.pixCopiaECola);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 3000);
    } catch {
      // fallback execCommand
      const textarea = document.createElement('textarea');
      textarea.value = dados.pixCopiaECola;
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 3000);
    }
  };

  const montarMensagemWhatsApp = (): string | null => {
    if (!dados?.pixCopiaECola) return null;
    const nome = dados.associada.nome;
    const valor = formatarValor(dados.pedido.valor);
    const pix = dados.pixCopiaECola;
    return (
      `Olá, ${nome}! 😊\n\n` +
      `Sua solicitação de carteirinha AEMADEPA está aguardando pagamento.\n\n` +
      `💳 *Carteirinha AEMADEPA — ${dados.pedido.via}ª Via*\n` +
      `💰 *Valor:* ${valor}\n\n` +
      `📱 *PIX Copia e Cola:*\n${pix}\n\n` +
      `Após o pagamento, sua carteirinha será processada pela Secretaria da COMIEADEPA. ✝️`
    );
  };

  const abrirWhatsApp = () => {
    if (!dados) return;
    const foneNorm = normalizarTelefoneWhatsApp(dados.associada.fone);
    const mensagem = montarMensagemWhatsApp();
    if (!mensagem) return;

    const urlMsg = `https://wa.me/${foneNorm || ''}?text=${encodeURIComponent(mensagem)}`;
    window.open(urlMsg, '_blank', 'noopener,noreferrer');
  };

  const copiarMensagemWhatsApp = async () => {
    const msg = montarMensagemWhatsApp();
    if (!msg) return;
    try {
      await navigator.clipboard.writeText(msg);
      setMsgCopiada(true);
      setTimeout(() => setMsgCopiada(false), 3000);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = msg;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setMsgCopiada(true);
      setTimeout(() => setMsgCopiada(false), 3000);
    }
  };

  const foneNormValido = dados ? normalizarTelefoneWhatsApp(dados.associada.fone) : null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-4" onClick={(e) => e.target === e.currentTarget && onFechar()}>
      <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between p-5 pb-4 border-b border-gray-100">
          <div className="flex items-center gap-2.5 text-amber-700">
            <QrCode className="w-5 h-5" />
            <div>
              <h3 className="font-extrabold text-base text-gray-900">Recuperar PIX da Carteirinha</h3>
              <p className="text-xs text-gray-500 font-normal">{nomeAssociada}</p>
            </div>
          </div>
          <button onClick={onFechar} className="text-gray-400 hover:text-gray-600 cursor-pointer transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Loading */}
          {loading && !dados && (
            <div className="flex flex-col items-center justify-center py-10 text-gray-500 gap-3">
              <RefreshCw className="w-8 h-8 animate-spin text-amber-500" />
              <p className="text-sm font-medium">Consultando dados financeiros no ASAAS...</p>
            </div>
          )}

          {/* Erro */}
          {erro && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3 text-red-700">
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold text-sm">Erro ao recuperar PIX</p>
                <p className="text-xs mt-0.5">{erro}</p>
              </div>
            </div>
          )}

          {/* Dados carregados */}
          {dados && (
            <>
              {/* Dados da Associada e Ministro */}
              <div className="bg-gray-50 rounded-xl border border-gray-200 p-3.5 text-xs text-gray-700 space-y-1.5">
                <div className="flex items-center gap-2">
                  {dados.associada.fotoUrl && (
                    <img src={dados.associada.fotoUrl} alt="" className="w-10 h-10 rounded-full object-cover border border-rose-200" />
                  )}
                  <div>
                    <p><strong>Associada:</strong> {dados.associada.nome}</p>
                    <p><strong>Ministro:</strong> {dados.ministro.nome} {dados.ministro.matricula ? `(${dados.ministro.matricula})` : ''}</p>
                    {dados.ministro.campo && <p><strong>Campo:</strong> {dados.ministro.campo}</p>}
                    <p><strong>{dados.pedido.via}ª Via</strong> — {formatarValor(dados.pedido.valor)}</p>
                  </div>
                </div>
              </div>

              {/* Status do Pedido */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold ${
                  dados.statusLocal === 'aguardando_pagamento' ? 'bg-amber-100 text-amber-800' :
                  dados.statusLocal === 'pago' ? 'bg-emerald-100 text-emerald-800' :
                  dados.statusLocal === 'cancelada' ? 'bg-gray-100 text-gray-700' :
                  'bg-blue-100 text-blue-800'
                }`}>
                  {dados.statusLocal === 'aguardando_pagamento'
                    ? <Clock className="w-3 h-3" />
                    : dados.statusLocal === 'pago'
                    ? <CheckCircle2 className="w-3 h-3" />
                    : <Info className="w-3 h-3" />
                  }
                  {statusLabel(dados.statusLocal)}
                </span>
                {dados.statusAsaas && (
                  <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-700">
                    ASAAS: {statusLabel(dados.statusAsaas)}
                  </span>
                )}
                {dados.vencimentoAsaas && (
                  <span className="text-xs text-gray-500">
                    Venc.: {new Date(dados.vencimentoAsaas).toLocaleDateString('pt-BR')}
                  </span>
                )}
              </div>

              {/* Bloqueio: PIX inválido ou sem ação disponível */}
              {dados.bloqueado && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3 text-amber-800">
                  <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-amber-600" />
                  <div>
                    <p className="font-bold text-sm">PIX indisponível para envio</p>
                    <p className="text-xs mt-1">{dados.motivoBloqueio}</p>
                  </div>
                </div>
              )}

              {/* QR Code e PIX copia e cola (somente se não bloqueado) */}
              {!dados.bloqueado && dados.pixCopiaECola && (
                <div className="space-y-4">
                  {/* QR Code */}
                  <div className="flex flex-col items-center gap-3 p-4 bg-white border border-gray-200 rounded-xl">
                    {dados.pixQrCodeBase64 ? (
                      /* Exibe imagem base64 retornada pelo ASAAS */
                      dados.pixQrCodeBase64.startsWith('data:') || dados.pixQrCodeBase64.startsWith('http') ? (
                        <img
                          src={dados.pixQrCodeBase64}
                          alt="QR Code PIX"
                          className="w-48 h-48 object-contain rounded-lg"
                        />
                      ) : (
                        <img
                          src={`data:image/png;base64,${dados.pixQrCodeBase64}`}
                          alt="QR Code PIX"
                          className="w-48 h-48 object-contain rounded-lg"
                        />
                      )
                    ) : (
                      /* Fallback: renderiza localmente com qrcode.react */
                      <div className="p-2 bg-white rounded-lg shadow-sm border border-gray-100">
                        <QRCodeSVG
                          value={dados.pixCopiaECola}
                          size={192}
                          level="M"
                        />
                      </div>
                    )}
                    <p className="text-xs text-gray-500 text-center">
                      Leia o QR Code no app do banco ou use o código abaixo
                    </p>
                  </div>

                  {/* PIX Copia e Cola */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-gray-700 uppercase tracking-wide">
                      Código PIX Copia e Cola
                    </label>
                    <div className="flex items-stretch gap-2">
                      <input
                        type="text"
                        readOnly
                        value={dados.pixCopiaECola}
                        className="flex-1 text-xs font-mono bg-gray-50 border border-gray-300 rounded-lg px-3 py-2 text-gray-800 select-all min-w-0"
                        onClick={(e) => (e.target as HTMLInputElement).select()}
                      />
                      <button
                        type="button"
                        onClick={copiarPix}
                        className={`px-3.5 py-2 text-white text-xs font-bold rounded-lg flex items-center gap-1.5 shrink-0 transition cursor-pointer ${
                          copiado ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-amber-500 hover:bg-amber-600'
                        }`}
                      >
                        {copiado ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                        <span>{copiado ? 'Copiado!' : 'Copiar PIX'}</span>
                      </button>
                    </div>
                  </div>

                  {/* WhatsApp */}
                  <div className="space-y-2.5 pt-1 border-t border-gray-100">
                    <p className="text-xs font-bold text-gray-700 uppercase tracking-wide">
                      Enviar pelo WhatsApp
                    </p>

                    {foneNormValido ? (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 text-xs text-gray-600 bg-green-50 border border-green-200 rounded-lg p-2.5">
                          <Phone className="w-4 h-4 text-green-600 shrink-0" />
                          <span>
                            Telefone: <strong className="text-green-800">{dados.associada.fone}</strong>
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={abrirWhatsApp}
                          className="w-full py-2.5 px-4 bg-green-600 hover:bg-green-700 text-white font-bold text-sm rounded-xl flex items-center justify-center gap-2 transition cursor-pointer shadow-sm"
                        >
                          <MessageCircle className="w-4 h-4" />
                          <span>Enviar PIX pelo WhatsApp</span>
                        </button>
                        <p className="text-xs text-gray-500 text-center">
                          Abrirá o WhatsApp com mensagem pronta — você confirma o envio
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
                          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-500" />
                          <span>
                            Nenhum telefone válido cadastrado para esta associada.
                            Copie a mensagem abaixo e envie manualmente.
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={copiarMensagemWhatsApp}
                          className={`w-full py-2.5 px-4 font-bold text-sm rounded-xl flex items-center justify-center gap-2 transition cursor-pointer ${
                            msgCopiada
                              ? 'bg-emerald-600 text-white'
                              : 'bg-gray-100 hover:bg-gray-200 text-gray-700 border border-gray-300'
                          }`}
                        >
                          {msgCopiada ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                          <span>{msgCopiada ? 'Mensagem Copiada!' : 'Copiar Mensagem WhatsApp'}</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 p-5 pt-3 border-t border-gray-100">
          <button
            type="button"
            onClick={() => void recuperarPix()}
            disabled={loading}
            className="px-4 py-2 bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 font-bold text-xs rounded-lg flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Recarregar</span>
          </button>
          <button
            type="button"
            onClick={onFechar}
            className="px-5 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold text-xs rounded-lg transition cursor-pointer"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
