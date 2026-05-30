'use client';

import { useEffect, useState } from 'react';
import { Printer, CheckCircle2, AlertCircle, Clock, ExternalLink } from 'lucide-react';

interface Solicitacao {
  id: string;
  status: string;
  statusLabel: string;
  valor: number;
  solicitadoEm: string;
  pagoEm: string | null;
  impresso_em: string | null;
  entregueEm: string | null;
}

interface SolicitarResult {
  ok?: boolean;
  error?: string;
  solicitacaoId?: string;
  linkPagamento?: string | null;
  pixCopiaECola?: string | null;
  dueDate?: string;
  status?: string; // quando já há pendência
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
  return new Date(v).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
};

export default function ImpressaoPage() {
  const [solicitacoes, setSolicitacoes] = useState<Solicitacao[]>([]);
  const [loading, setLoading] = useState(true);
  const [solicitando, setSolicitando] = useState(false);
  const [resultado, setResultado] = useState<SolicitarResult | null>(null);
  const [erro, setErro] = useState('');

  const carregarSolicitacoes = () => {
    fetch('/api/portal-ministro/impressao/minhas')
      .then((r) => r.json())
      .then((d) => { setSolicitacoes(d.data || []); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => { carregarSolicitacoes(); }, []);

  const handleSolicitar = async () => {
    setErro('');
    setSolicitando(true);
    setResultado(null);

    try {
      const res = await fetch('/api/portal-ministro/impressao/solicitar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const json: SolicitarResult = await res.json();

      if (res.status === 409) {
        setErro(json.error || 'Já existe uma solicitação em andamento.');
        setSolicitando(false);
        return;
      }
      if (!res.ok) {
        setErro(json.error || 'Erro ao solicitar impressão.');
        setSolicitando(false);
        return;
      }

      setResultado(json);
      carregarSolicitacoes();
    } catch {
      setErro('Erro de conexão. Tente novamente.');
    } finally {
      setSolicitando(false);
    }
  };

  const temPendente = solicitacoes.some((s) =>
    ['aguardando_pagamento', 'pago_pendente_impressao', 'em_impressao'].includes(s.status)
  );

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Printer size={24} className="text-[#0D2B4E]" />
        <h1 className="text-2xl font-bold text-gray-900">Solicitar Impressão da Credencial</h1>
      </div>

      {/* Info */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <h2 className="font-semibold text-gray-800 mb-2">Como funciona?</h2>
        <ul className="text-sm text-gray-600 space-y-1 list-disc list-inside mb-5">
          <li>Uma cobrança de <strong>R$ 20,00</strong> será gerada via ASAAS.</li>
          <li>Após o pagamento confirmado, a secretaria imprime a credencial.</li>
          <li>Você será avisado quando a credencial estiver disponível para retirada.</li>
        </ul>

        {!temPendente && (
          <button
            onClick={handleSolicitar}
            disabled={solicitando}
            className="inline-flex items-center gap-2 bg-[#0D2B4E] hover:bg-[#1a4a7a] text-white font-semibold px-6 py-3 rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <Printer size={16} />
            {solicitando ? 'Gerando cobrança...' : 'Solicitar impressão (R$ 20,00)'}
          </button>
        )}

        {temPendente && (
          <div className="flex items-center gap-2 text-sm text-yellow-700 bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-3">
            <Clock size={16} />
            Você já tem uma solicitação em andamento.
          </div>
        )}

        {erro && (
          <div className="mt-3 flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
            <AlertCircle size={16} />
            {erro}
          </div>
        )}

        {/* Resultado da solicitação */}
        {resultado?.ok && (
          <div className="mt-4 bg-green-50 border border-green-200 rounded-xl p-5">
            <div className="flex items-center gap-2 text-green-700 font-semibold mb-3">
              <CheckCircle2 size={18} />
              Solicitação criada com sucesso!
            </div>
            <p className="text-sm text-gray-600 mb-3">
              Vencimento: <strong>{resultado.dueDate}</strong>. Pague para confirmar a impressão.
            </p>
            {resultado.linkPagamento && (
              <a
                href={resultado.linkPagamento}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white font-semibold px-5 py-2.5 rounded-lg transition-colors text-sm"
              >
                <ExternalLink size={15} />
                Pagar agora
              </a>
            )}
            {resultado.pixCopiaECola && (
              <div className="mt-3">
                <p className="text-xs text-gray-500 mb-1">PIX Copia e Cola:</p>
                <code className="block bg-white border border-gray-200 rounded p-2 text-xs break-all">
                  {resultado.pixCopiaECola}
                </code>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Histórico de solicitações */}
      {!loading && solicitacoes.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-800">Minhas solicitações</h2>
          </div>
          <div className="divide-y divide-gray-50">
            {solicitacoes.map((s) => (
              <div key={s.id} className="px-5 py-4 flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm text-gray-500">
                    Solicitado em {fmtDate(s.solicitadoEm)}
                  </p>
                  {s.pagoEm && (
                    <p className="text-xs text-gray-400">Pago em {fmtDate(s.pagoEm)}</p>
                  )}
                  {s.entregueEm && (
                    <p className="text-xs text-gray-400">Entregue em {fmtDate(s.entregueEm)}</p>
                  )}
                </div>
                <span className={`text-xs font-semibold px-3 py-1 rounded-full ${STATUS_COLOR[s.status] || 'bg-gray-100 text-gray-600'}`}>
                  {s.statusLabel}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
