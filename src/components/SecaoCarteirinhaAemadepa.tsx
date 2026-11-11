'use client';

import { useState } from 'react';
import { CreditCard, Copy, Check, AlertCircle, RefreshCw, Sparkles, CheckCircle2 } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { VALOR_CARTEIRINHA_AEMADEPA_FORMATADO } from '@/lib/aemadepa/constants';

interface SolicitacaoData {
  id: string;
  via: number;
  status: string;
  valor: number;
  pix_copia_cola: string | null;
  pix_qr_code: string | null;
  invoice_url: string | null;
  solicitado_em?: string;
  pago_em?: string | null;
}

interface ElegibilidadeData {
  podeSolicitar: boolean;
  tipoVia: 'primeira_via' | 'segunda_via';
  motivoBloqueio: string | null;
}

interface SecaoCarteirinhaAemadepaProps {
  ministroId: string;
  associadaId?: string | null;
  token: string | null;
  dadosEsposaPreenchidos: {
    nome: string;
    cpf: string;
    dataNascimento: string;
    fotoUrl: string | null;
  };
  solicitacaoInicial?: SolicitacaoData | null;
  elegibilidadeInicial?: ElegibilidadeData | null;
  onSolicitacaoCriada?: (solicitacao: SolicitacaoData) => void;
  onGarantirCadastroSalvo?: () => Promise<string | null>;
}

export default function SecaoCarteirinhaAemadepa({
  ministroId,
  associadaId,
  token,
  dadosEsposaPreenchidos,
  solicitacaoInicial,
  elegibilidadeInicial,
  onSolicitacaoCriada,
  onGarantirCadastroSalvo,
}: SecaoCarteirinhaAemadepaProps) {
  const [solicitacao, setSolicitacao] = useState<SolicitacaoData | null>(solicitacaoInicial || null);
  const elegibilidade =
    elegibilidadeInicial || { podeSolicitar: true, tipoVia: 'primeira_via', motivoBloqueio: null };
  const [carregando, setCarregando] = useState(false);
  const [confirmadoCheckbox, setConfirmadoCheckbox] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const temFoto = Boolean(dadosEsposaPreenchidos.fotoUrl && dadosEsposaPreenchidos.fotoUrl.trim().length > 0);
  const temNome = Boolean(dadosEsposaPreenchidos.nome && dadosEsposaPreenchidos.nome.trim().length >= 3);
  const temCpf = Boolean(dadosEsposaPreenchidos.cpf && dadosEsposaPreenchidos.cpf.replace(/\D/g, '').length === 11);
  const temNasc = Boolean(dadosEsposaPreenchidos.dataNascimento);
  const cadastroCompleto = temFoto && temNome && temCpf && temNasc;

  const solicitarCarteirinha = async () => {
    if (!token) {
      setErro('Sessão expirada. Por favor, revalide seus dados no início da página.');
      return;
    }

    if (!cadastroCompleto) {
      setErro('Para solicitar a carteirinha, complete o preenchimento de todos os dados e envie a foto 3x4.');
      return;
    }

    setCarregando(true);
    setErro(null);

    try {
      let idFinalAssociada = associadaId || null;

      // Se for primeiro cadastro ou associadaId ainda não conhecido e houver callback de salvamento prévio:
      if (!idFinalAssociada && onGarantirCadastroSalvo) {
        idFinalAssociada = await onGarantirCadastroSalvo();
        if (!idFinalAssociada) {
          throw new Error('Não foi possível confirmar o salvamento do cadastro da associada antes de gerar a carteirinha.');
        }
      }

      const res = await fetch('/api/public/aemadepa/carteirinha', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-aemadepa-token': token,
        },
        body: JSON.stringify({
          ministroId,
          associadaId: idFinalAssociada,
          confirmacao: true,
        }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(data?.error || 'Erro ao gerar solicitação de carteirinha.');
      }

      if (data?.solicitacao) {
        setSolicitacao(data.solicitacao);
        if (onSolicitacaoCriada) {
          onSolicitacaoCriada(data.solicitacao);
        }
      }
    } catch (err: any) {
      setErro(err.message || 'Erro inesperado na solicitação.');
    } finally {
      setCarregando(false);
    }
  };

  const copiarPix = () => {
    if (!solicitacao?.pix_copia_cola) return;
    navigator.clipboard.writeText(solicitacao.pix_copia_cola);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 3000);
  };

  return (
    <div className="bg-gradient-to-br from-rose-50/80 via-white to-pink-50/50 rounded-2xl border-2 border-rose-200 p-5 sm:p-6 shadow-sm space-y-5">
      {/* Cabeçalho da Seção */}
      <div className="flex items-start sm:items-center justify-between gap-3 pb-4 border-b border-rose-100">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-rose-600 to-pink-600 text-white flex items-center justify-center shadow-md">
            <CreditCard className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base sm:text-lg font-black text-gray-900">
                Carteirinha Oficial AEMADEPA
              </h3>
              <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-rose-100 text-rose-800">
                Facultativa
              </span>
            </div>
            <p className="text-xs text-gray-500">
              Taxa de emissão física com acabamento especial e identificação oficial: <strong>{VALOR_CARTEIRINHA_AEMADEPA_FORMATADO}</strong>
            </p>
          </div>
        </div>
      </div>

      {erro && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-xs sm:text-sm p-3.5 rounded-xl flex items-center gap-2.5">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{erro}</span>
        </div>
      )}

      {/* Caso 1: Pedido Aberto ou em Andamento */}
      {solicitacao ? (
        <div className="space-y-4 animate-in fade-in duration-300">
          <div className="bg-white rounded-xl border border-rose-200 p-4 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase text-gray-500 tracking-wider">
                  {solicitacao.via}ª Via da Carteirinha
                </span>
                <span
                  className={`px-2.5 py-0.5 rounded-full text-xs font-extrabold ${
                    solicitacao.status === 'pago'
                      ? 'bg-emerald-100 text-emerald-800'
                      : solicitacao.status === 'em_impressao' || solicitacao.status === 'impressa'
                      ? 'bg-blue-100 text-blue-800'
                      : solicitacao.status === 'processando_cobranca'
                      ? 'bg-purple-100 text-purple-800'
                      : 'bg-amber-100 text-amber-800'
                  }`}
                >
                  {solicitacao.status === 'aguardando_pagamento' && 'Aguardando Pagamento PIX'}
                  {solicitacao.status === 'processando_cobranca' && 'Em Conciliação Financeira'}
                  {solicitacao.status === 'pago' && 'Pago — Fila de Impressão'}
                  {solicitacao.status === 'em_impressao' && 'Em Impressão'}
                  {solicitacao.status === 'impressa' && 'Impressa — Pronta para Retirada'}
                  {solicitacao.status === 'entregue' && 'Entregue'}
                </span>
              </div>
              <span className="text-sm font-black text-rose-700">R$ {solicitacao.valor.toFixed(2)}</span>
            </div>

            {/* Se estiver aguardando pagamento: exibe PIX */}
            {solicitacao.status === 'aguardando_pagamento' && (
              <div className="space-y-4 pt-2">
                <p className="text-xs text-gray-600">
                  Escaneie o QR Code abaixo pelo aplicativo do seu banco ou use a chave Copia e Cola para efetuar o pagamento.
                </p>

                <div className="flex justify-center p-3 bg-rose-50/50 rounded-xl border border-rose-100">
                  {solicitacao.pix_qr_code ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={
                        solicitacao.pix_qr_code.startsWith('data:')
                          ? solicitacao.pix_qr_code
                          : `data:image/png;base64,${solicitacao.pix_qr_code}`
                      }
                      alt="QR Code PIX AEMADEPA"
                      className="w-48 h-48 object-contain rounded-lg shadow-sm"
                    />
                  ) : solicitacao.pix_copia_cola ? (
                    <div className="p-3 bg-white rounded-lg shadow-sm">
                      <QRCodeSVG
                        value={solicitacao.pix_copia_cola}
                        size={192}
                        level="M"
                        className="w-48 h-48"
                      />
                    </div>
                  ) : null}
                </div>

                {solicitacao.pix_copia_cola && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-gray-700">Código PIX Copia e Cola:</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        readOnly
                        value={solicitacao.pix_copia_cola}
                        className="w-full text-xs font-mono bg-gray-50 border border-gray-300 rounded-lg px-3 py-2 text-gray-800 select-all"
                      />
                      <button
                        type="button"
                        onClick={copiarPix}
                        className="px-3.5 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-lg flex items-center gap-1.5 shrink-0 transition cursor-pointer"
                      >
                        {copiado ? <Check className="w-4 h-4 text-emerald-300" /> : <Copy className="w-4 h-4" />}
                        <span>{copiado ? 'Copiado!' : 'Copiar'}</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Se estiver em conciliação financeira: mensagem clara sem induzir duplicidade */}
            {solicitacao.status === 'processando_cobranca' && (
              <div className="p-3.5 bg-purple-50 rounded-xl border border-purple-200 text-xs text-purple-900 space-y-1.5">
                <div className="flex items-center gap-2 font-bold text-purple-800">
                  <RefreshCw className="w-4 h-4 animate-spin text-purple-600 shrink-0" />
                  <span>Solicitação em Conciliação com o Banco</span>
                </div>
                <p>
                  Sua solicitação está sendo verificada junto ao gateway de pagamentos para garantir que não haja cobranças repetidas.
                  Por favor, aguarde alguns minutos ou recarregue a página. Não é necessário abrir outro pedido.
                </p>
              </div>
            )}

            {/* Se já estiver pago: mensagem informativa */}
            {['pago', 'em_impressao', 'impressa', 'entregue'].includes(solicitacao.status) && (
              <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200 text-xs text-emerald-900 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>
                  Pagamento confirmado! Sua carteirinha está sendo preparada pela Secretaria da COMIEADEPA.
                </span>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Caso 2: Nenhuma solicitação ativa (Opção de Solicitar) */
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-rose-100 p-4 text-xs text-gray-600 space-y-2">
            <p>
              A carteirinha física da AEMADEPA é emitida mediante taxa única de <strong>{VALOR_CARTEIRINHA_AEMADEPA_FORMATADO}</strong>, destinada aos custos operacionais e confecção do cartão institucional com chip/QR Code.
            </p>
            {!cadastroCompleto && (
              <p className="text-amber-700 font-semibold flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                Para habilitar a solicitação, certifique-se de que a foto 3x4 e todos os dados foram salvos.
              </p>
            )}
          </div>

          <div className="flex items-start gap-2.5">
            <input
              type="checkbox"
              id="confirmar-solicitacao-cart"
              checked={confirmadoCheckbox}
              onChange={(e) => setConfirmadoCheckbox(e.target.checked)}
              disabled={!cadastroCompleto || carregando}
              className="mt-0.5 rounded text-rose-600 focus:ring-rose-500 w-4 h-4 cursor-pointer"
            />
            <label
              htmlFor="confirmar-solicitacao-cart"
              className="text-xs text-gray-700 font-medium cursor-pointer"
            >
              Desejo solicitar a emissão da carteirinha oficial da AEMADEPA no valor de <strong>{VALOR_CARTEIRINHA_AEMADEPA_FORMATADO}</strong> via PIX.
            </label>
          </div>

          <button
            type="button"
            onClick={solicitarCarteirinha}
            disabled={!confirmadoCheckbox || !cadastroCompleto || carregando}
            className="w-full py-3.5 px-4 bg-gradient-to-r from-rose-600 to-pink-700 hover:from-rose-700 hover:to-pink-800 text-white font-bold text-sm rounded-xl shadow-md transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {carregando ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Gerando Cobrança PIX...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                <span>
                  {elegibilidade.tipoVia === 'segunda_via'
                    ? `Solicitar Segunda Via — ${VALOR_CARTEIRINHA_AEMADEPA_FORMATADO}`
                    : `Solicitar Carteirinha — ${VALOR_CARTEIRINHA_AEMADEPA_FORMATADO}`}
                </span>
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
