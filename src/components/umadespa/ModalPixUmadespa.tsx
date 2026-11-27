'use client';

import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  X,
  Copy,
  Check,
  ExternalLink,
  QrCode,
  AlertCircle,
  FileText,
  DollarSign,
  Loader2,
} from 'lucide-react';

interface ModalPixUmadespaProps {
  pedidoId: string;
  associadoNome: string;
  via: number;
  valor: number;
  status: string;
  onClose: () => void;
  onPagamentoConfirmado?: () => void;
}

export function ModalPixUmadespa({
  pedidoId,
  associadoNome,
  via,
  valor,
  status: statusInicial,
  onClose,
  onPagamentoConfirmado,
}: ModalPixUmadespaProps) {
  const [loading, setLoading] = useState(false);
  const [pixData, setPixData] = useState<{
    pixCopiaECola?: string | null;
    pixQrCode?: string | null;
    invoiceUrl?: string | null;
    status: string;
  } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [baixandoManual, setBaixandoManual] = useState(false);
  const [modalidadeManual, setModalidadeManual] = useState<'a_vista' | 'cortesia'>('a_vista');
  const [justificativaCortesia, setJustificativaCortesia] = useState('');

  const gerarOuConsultarPix = async () => {
    setLoading(true);
    setErro(null);
    try {
      const res = await fetch(`/api/v1/secretaria/umadespa/pedidos/${pedidoId}/pix`, {
        method: 'POST',
      });
      const json = await res.json();
      if (!res.ok) {
        setErro(json.error || 'Erro ao comunicar com o gateway PIX.');
        return;
      }
      setPixData(json.data);
    } catch {
      setErro('Erro de conexão com o servidor.');
    } finally {
      setLoading(false);
    }
  };

  const handleCopiar = () => {
    if (!pixData?.pixCopiaECola) return;
    navigator.clipboard.writeText(pixData.pixCopiaECola);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2500);
  };

  const handleBaixaManual = async () => {
    if (modalidadeManual === 'cortesia' && justificativaCortesia.trim().length < 5) {
      alert('Informe uma justificativa para a cortesia (mínimo 5 caracteres).');
      return;
    }

    setBaixandoManual(true);
    try {
      const res = await fetch('/api/v1/secretaria/umadespa/pedidos', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: pedidoId,
          status: 'pago',
          forma_pagamento: modalidadeManual,
          justificativa_cortesia: modalidadeManual === 'cortesia' ? justificativaCortesia : null,
        }),
      });
      const json = await res.json();
      if (res.ok) {
        alert(modalidadeManual === 'cortesia' ? 'Cortesia registrada com sucesso!' : 'Pagamento à vista confirmado com sucesso!');
        if (onPagamentoConfirmado) onPagamentoConfirmado();
        onClose();
      } else {
        alert(json.error || 'Falha ao processar baixa manual.');
      }
    } catch {
      alert('Erro de conexão ao processar baixa.');
    } finally {
      setBaixandoManual(false);
    }
  };

  const estaPago = ['pago', 'em_impressao', 'impressa', 'entregue'].includes(pixData?.status || statusInicial);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-lg w-full overflow-hidden flex flex-col max-h-[90vh]">
        {/* Topo Modal */}
        <div className="bg-gradient-to-r from-emerald-800 to-teal-900 text-white p-5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <QrCode className="w-5 h-5 text-emerald-300" />
            <div>
              <h3 className="font-bold text-base tracking-tight">Cobrança PIX Oficial — UMADESPA</h3>
              <p className="text-xs text-emerald-100/80">
                {associadoNome} • {via}ª Via
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-white/20 text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Conteúdo */}
        <div className="p-6 overflow-y-auto space-y-5">
          {/* Informações da Taxa */}
          <div className="flex items-center justify-between p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60">
            <div>
              <span className="text-[11px] font-bold text-emerald-800 dark:text-emerald-300 uppercase block">
                Valor Congelado da Solicitação
              </span>
              <span className="text-2xl font-black text-emerald-950 dark:text-emerald-100">
                R$ {Number(valor).toFixed(2).replace('.', ',')}
              </span>
            </div>
            <div className="text-right">
              <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase block">
                Status Atual
              </span>
              <span className="inline-block px-2.5 py-1 rounded-full text-xs font-bold uppercase bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700">
                {(pixData?.status || statusInicial).replace(/_/g, ' ')}
              </span>
            </div>
          </div>

          {estaPago ? (
            <div className="p-6 text-center rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 space-y-3">
              <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto">
                <Check className="w-6 h-6 stroke-[3]" />
              </div>
              <h4 className="font-bold text-emerald-900 dark:text-emerald-100 text-base">
                Pagamento Confirmado
              </h4>
              <p className="text-xs text-emerald-700 dark:text-emerald-300">
                Esta credencial já foi quitada e autorizada para a fila de impressão.
              </p>
              <a
                href={`/api/v1/secretaria/umadespa/pedidos/${pedidoId}/recibo`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition-colors mt-2"
              >
                <FileText className="w-4 h-4" />
                Baixar Comprovante Oficial (PDF)
              </a>
            </div>
          ) : (
            <>
              {erro && (
                <div className="flex items-center gap-2 p-3.5 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-xs">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{erro}</span>
                </div>
              )}

              {!pixData && !loading && (
                <div className="text-center py-4">
                  <p className="text-xs text-slate-700 dark:text-slate-300 mb-4">
                    Gere o QR Code PIX oficial ASAAS exclusivo para esta solicitação.
                  </p>
                  <button
                    type="button"
                    onClick={gerarOuConsultarPix}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition-all"
                  >
                    <QrCode className="w-4 h-4" />
                    Gerar Cobrança PIX ASAAS
                  </button>
                </div>
              )}

              {loading && (
                <div className="text-center py-8">
                  <Loader2 className="w-8 h-8 animate-spin text-emerald-600 mx-auto" />
                  <p className="text-xs font-semibold text-slate-700 dark:text-slate-300 mt-2">
                    Comunicando com o ASAAS...
                  </p>
                </div>
              )}

              {pixData && !loading && (
                <div className="space-y-4">
                  {/* QR Code Renderizado */}
                  <div className="p-4 bg-white dark:bg-white rounded-2xl border border-slate-200 shadow-xs flex flex-col items-center justify-center max-w-[240px] mx-auto">
                    {pixData.pixQrCode ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={`data:image/png;base64,${pixData.pixQrCode}`}
                        alt="PIX QR Code"
                        className="w-48 h-48 object-contain"
                      />
                    ) : pixData.pixCopiaECola ? (
                      <QRCodeSVG value={pixData.pixCopiaECola} size={190} level="M" />
                    ) : (
                      <div className="w-48 h-48 flex items-center justify-center text-xs text-slate-700 text-center">
                        QR Code indisponível no momento
                      </div>
                    )}
                  </div>

                  {/* PIX Copia e Cola */}
                  {pixData.pixCopiaECola && (
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase block">
                        PIX Copia e Cola
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          readOnly
                          value={pixData.pixCopiaECola}
                          className="flex-1 text-xs px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-200 font-mono truncate"
                        />
                        <button
                          type="button"
                          onClick={handleCopiar}
                          className="inline-flex items-center gap-1 px-3 py-2 text-xs font-bold rounded-xl bg-slate-800 hover:bg-slate-700 text-white transition-colors shrink-0"
                        >
                          {copiado ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                          {copiado ? 'Copiado!' : 'Copiar'}
                        </button>
                      </div>
                    </div>
                  )}

                  {pixData.invoiceUrl && (
                    <div className="text-center">
                      <a
                        href={pixData.invoiceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 hover:text-emerald-700 underline"
                      >
                        Abrir fatura completa no ASAAS <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </div>
                  )}
                </div>
              )}

              {/* Seção de Baixa Manual Administrativa */}
              <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-3">
                <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase block">
                  Baixa Manual Administrativa (Auditada)
                </span>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <label className="flex items-center gap-2 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <input
                      type="radio"
                      name="modalidade"
                      checked={modalidadeManual === 'a_vista'}
                      onChange={() => setModalidadeManual('a_vista')}
                      className="text-emerald-600 focus:ring-emerald-500"
                    />
                    <span className="font-semibold text-slate-800 dark:text-slate-200">À Vista (Dinheiro/Balcão)</span>
                  </label>

                  <label className="flex items-center gap-2 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <input
                      type="radio"
                      name="modalidade"
                      checked={modalidadeManual === 'cortesia'}
                      onChange={() => setModalidadeManual('cortesia')}
                      className="text-emerald-600 focus:ring-emerald-500"
                    />
                    <span className="font-semibold text-slate-800 dark:text-slate-200">Isenção / Cortesia</span>
                  </label>
                </div>

                {modalidadeManual === 'cortesia' && (
                  <div>
                    <input
                      type="text"
                      placeholder="Justificativa obrigatória da isenção..."
                      value={justificativaCortesia}
                      onChange={(e) => setJustificativaCortesia(e.target.value)}
                      className="w-full text-xs px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                )}

                <button
                  type="button"
                  disabled={baixandoManual}
                  onClick={handleBaixaManual}
                  className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-bold rounded-xl bg-slate-800 hover:bg-slate-700 text-white transition-all disabled:opacity-50"
                >
                  <DollarSign className="w-4 h-4 text-emerald-400" />
                  {baixandoManual ? 'Processando baixa...' : 'Confirmar Baixa Manual'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
