import { useState } from 'react';
import { CreditCard, CheckCircle2, Clock, AlertCircle } from 'lucide-react';
import { VALOR_PADRAO_CARTEIRINHA_UMADESPA_FORMATADO } from '@/lib/umadespa/constants';

interface SecaoCarteirinhaProps {
  associadoId: string;
  token: string;
  temFoto: boolean;
  menorIdade: boolean;
  responsavelTermo: boolean;
  carteirinhaAtual?: any | null;
  onSolicitacaoConcluida: (solicitacao: any) => void;
}

export function SecaoCarteirinhaPublicaUmadespa({
  associadoId,
  token,
  temFoto,
  menorIdade,
  responsavelTermo,
  carteirinhaAtual,
  onSolicitacaoConcluida,
}: SecaoCarteirinhaProps) {
  const [solicitando, setSolicitando] = useState(false);
  const [confirmacao, setConfirmacao] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const podeSolicitar = temFoto && (!menorIdade || responsavelTermo);

  const handleSolicitar = async () => {
    if (!confirmacao) {
      setErro('Por favor, confirme que os dados estão corretos antes de emitir a solicitação.');
      return;
    }

    setSolicitando(true);
    setErro(null);

    try {
      const res = await fetch('/api/public/umadespa/carteirinha', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-umadespa-token': token,
        },
        body: JSON.stringify({
          associadoId,
          confirmacao: true,
          token,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Erro ao processar solicitação da carteirinha.');
      }

      onSolicitacaoConcluida(json.solicitacao);
    } catch (err: any) {
      setErro(err.message || 'Falha ao solicitar carteirinha.');
    } finally {
      setSolicitando(false);
    }
  };

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm space-y-4">
      <div className="flex items-center gap-3 pb-3 border-b border-slate-200 dark:border-slate-800">
        <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 flex items-center justify-center">
          <CreditCard className="w-5 h-5" />
        </div>
        <div>
          <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
            Credencial Oficial UMADESPA
          </h3>
          <p className="text-xs text-slate-700 dark:text-slate-300">
            Documento em PVC de identificação da mocidade e obreiros jovens no Estado do Pará.
          </p>
        </div>
      </div>

      {erro && (
        <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{erro}</span>
        </div>
      )}

      {/* Caso já possua pedido ativo */}
      {carteirinhaAtual && (
        <div className="p-4 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 space-y-2">
          <div className="flex items-center gap-2 text-emerald-800 dark:text-emerald-300 font-semibold text-xs uppercase tracking-wider">
            <CheckCircle2 className="w-4 h-4" />
            Solicitação Cadastrada no Sistema
          </div>
          <div className="text-xs text-slate-700 dark:text-slate-300 space-y-1">
            <p>
              <strong>Via:</strong> {carteirinhaAtual.via}ª Via
            </p>
            <p>
              <strong>Status Operacional:</strong>{' '}
              <span className="uppercase font-medium text-emerald-700 dark:text-emerald-300">
                {carteirinhaAtual.status.replace(/_/g, ' ')}
              </span>
            </p>
            <p>
              <strong>Valor da Taxa:</strong> R$ {Number(carteirinhaAtual.valor || 25).toFixed(2).replace('.', ',')}
            </p>
          </div>
          <div className="mt-3 p-3 rounded-lg bg-white dark:bg-slate-800 border border-emerald-200 dark:border-emerald-700/60 text-xs text-slate-700 dark:text-slate-300 flex items-center gap-2">
            <Clock className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>
              Sua solicitação está na fila operacional da Secretaria da UMADESPA. Dirija-se à liderança do seu campo ou secretaria da convenção para a retirada e validação.
            </span>
          </div>
        </div>
      )}

      {/* Caso ainda não tenha pedido gerado */}
      {!carteirinhaAtual && (
        <div className="space-y-4">
          <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700/60 text-xs text-slate-700 dark:text-slate-300 space-y-2">
            <p className="font-semibold text-slate-800 dark:text-slate-200">
              Informações sobre a Emissão:
            </p>
            <ul className="list-disc list-inside space-y-1">
              <li>Taxa de emissão padrão: <strong>{VALOR_PADRAO_CARTEIRINHA_UMADESPA_FORMATADO}</strong></li>
              <li>Validade institucional de 2 anos (24 meses)</li>
              <li>Impressão em PVC térmico com brasão e QR Code de autenticidade</li>
            </ul>
          </div>

          {!temFoto && (
            <p className="text-xs text-amber-600 dark:text-amber-400 font-medium">
              * Anexe sua foto 3x4 oficial no formulário acima antes de solicitar a carteirinha.
            </p>
          )}

          <div className="flex items-center gap-2 pt-2">
            <input
              type="checkbox"
              id="confirmacao_carteirinha"
              checked={confirmacao}
              disabled={!podeSolicitar}
              onChange={(e) => setConfirmacao(e.target.checked)}
              className="w-4 h-4 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500 disabled:opacity-50"
            />
            <label
              htmlFor="confirmacao_carteirinha"
              className="text-xs text-slate-700 dark:text-slate-300 font-medium cursor-pointer"
            >
              Declaro que os dados fornecidos conferem com meus documentos pessoais e solicito a confecção da credencial.
            </label>
          </div>

          <button
            type="button"
            disabled={!podeSolicitar || !confirmacao || solicitando}
            onClick={handleSolicitar}
            className="w-full py-2.5 px-4 rounded-xl text-xs font-bold uppercase tracking-wider text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 transition-all shadow-sm flex items-center justify-center gap-2"
          >
            {solicitando ? 'Registrando Solicitação...' : 'Confirmar Solicitação de Carteirinha'}
          </button>
        </div>
      )}
    </div>
  );
}
