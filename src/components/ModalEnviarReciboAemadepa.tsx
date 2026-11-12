'use client';

import { useState } from 'react';
import {
  X,
  Mail,
  RefreshCw,
  Check,
  AlertCircle,
  Send,
} from 'lucide-react';
import { authenticatedFetch } from '@/lib/api-client';

interface ModalEnviarReciboAemadepaProps {
  pedidoId: string;
  nomeAssociada: string;
  emailPadrao?: string | null;
  via: number;
  valor: number;
  onFechar: () => void;
  onEnviadoSucesso?: (destinatario: string) => void;
}

export default function ModalEnviarReciboAemadepa({
  pedidoId,
  nomeAssociada,
  emailPadrao,
  via,
  valor,
  onFechar,
  onEnviadoSucesso,
}: ModalEnviarReciboAemadepaProps) {
  const [emailDestino, setEmailDestino] = useState(emailPadrao || '');
  const [enviando, setEnviando] = useState(false);
  const [sucessoMsg, setSucessoMsg] = useState<string | null>(null);
  const [erroMsg, setErroMsg] = useState<string | null>(null);

  const enviarRecibo = async (e: React.FormEvent) => {
    e.preventDefault();
    const dest = emailDestino.trim().toLowerCase();
    if (!dest || !dest.includes('@') || !dest.includes('.')) {
      setErroMsg('Informe um endereço de e-mail válido para receber o recibo.');
      return;
    }

    setEnviando(true);
    setErroMsg(null);
    setSucessoMsg(null);

    try {
      const res = await authenticatedFetch(
        `/api/v1/secretaria/aemadepa/pedidos/${pedidoId}/recibo`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ emailDestino: dest }),
        }
      );

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(data?.error || 'Erro ao disparar envio do recibo.');
      }

      setSucessoMsg(data?.mensagem || `Recibo enviado com sucesso para ${dest}!`);
      if (onEnviadoSucesso) {
        onEnviadoSucesso(dest);
      }
    } catch (err: any) {
      setErroMsg(err.message || 'Falha na comunicação com o servidor de e-mail.');
    } finally {
      setEnviando(false);
    }
  };

  const valorFormatado = Number(valor || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-4"
      onClick={(e) => e.target === e.currentTarget && onFechar()}
    >
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 space-y-4 animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-gray-100">
          <div className="flex items-center gap-2.5 text-rose-700">
            <div className="w-8 h-8 rounded-lg bg-rose-100 flex items-center justify-center">
              <Mail className="w-4 h-4 text-rose-700" />
            </div>
            <div>
              <h3 className="font-extrabold text-base text-gray-900">Enviar Recibo por E-mail</h3>
              <p className="text-xs text-gray-500 font-normal">Recibo Institucional Oficial AEMADEPA</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onFechar}
            className="text-gray-400 hover:text-gray-600 cursor-pointer transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Resumo do Pedido */}
        <div className="bg-rose-50/60 border border-rose-200 rounded-xl p-3.5 text-xs text-rose-950 space-y-1">
          <p>
            <strong>Associada:</strong> {nomeAssociada}
          </p>
          <p>
            <strong>Credencial:</strong> {via}ª Via • <strong>Valor Pago:</strong> {valorFormatado}
          </p>
          <p className="text-[11px] text-rose-700">
            O recibo será gerado em formato PDF oficial com a logomarca da AEMADEPA e enviado em anexo.
          </p>
        </div>

        {/* Feedback de Sucesso */}
        {sucessoMsg && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3.5 text-xs text-emerald-800 flex items-start gap-2.5">
            <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-bold">E-mail enviado!</p>
              <p className="mt-0.5">{sucessoMsg}</p>
            </div>
          </div>
        )}

        {/* Feedback de Erro */}
        {erroMsg && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-3.5 text-xs text-red-800 flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-bold">Não foi possível enviar</p>
              <p className="mt-0.5">{erroMsg}</p>
            </div>
          </div>
        )}

        {/* Formulário de Envio */}
        {!sucessoMsg && (
          <form onSubmit={enviarRecibo} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-gray-700 uppercase tracking-wide">
                Destinatário do Recibo (E-mail):
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="email"
                  required
                  value={emailDestino}
                  onChange={(e) => setEmailDestino(e.target.value)}
                  placeholder="exemplo@email.com"
                  className="w-full pl-9 pr-3.5 py-2.5 text-xs rounded-xl border border-gray-300 focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 transition"
                  disabled={enviando}
                  autoFocus
                />
              </div>
              <p className="text-[11px] text-gray-500">
                Você pode confirmar o e-mail cadastrado ou digitar outro para reenvio.
              </p>
            </div>

            <div className="pt-2 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onFechar}
                disabled={enviando}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold text-xs rounded-xl transition cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={enviando}
                className="px-4 py-2 bg-gradient-to-r from-rose-600 to-pink-700 hover:from-rose-700 hover:to-pink-800 text-white font-bold text-xs rounded-xl shadow-sm transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {enviando ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Enviando Recibo...</span>
                  </>
                ) : (
                  <>
                    <Send className="w-3.5 h-3.5" />
                    <span>Confirmar Envio</span>
                  </>
                )}
              </button>
            </div>
          </form>
        )}

        {sucessoMsg && (
          <div className="pt-2 flex justify-end">
            <button
              type="button"
              onClick={onFechar}
              className="px-5 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 font-bold text-xs rounded-xl cursor-pointer"
            >
              Fechar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
