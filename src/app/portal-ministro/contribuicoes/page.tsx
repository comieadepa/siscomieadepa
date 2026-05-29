'use client';

import { useEffect, useState } from 'react';
import { DollarSign, CheckCircle2, AlertCircle } from 'lucide-react';

interface Contribuicao {
  id: string;
  mes: number;
  mesLabel: string;
  ano: number;
  valor: number;
  formaPagamento: string;
  criadoEm: string;
  campoNome: string;
}

interface ContribuicoesData {
  data: Contribuicao[];
  statusMesAtual: 'pago' | 'em_aberto' | null;
  mesAtual: number;
  anoAtual: number;
  campoNome: string;
}

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const MESES = ['', 'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
               'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

export default function ContribuicoesPage() {
  const [dados, setDados] = useState<ContribuicoesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    fetch('/api/portal-ministro/contribuicoes')
      .then(async (r) => {
        if (r.status === 403) { setForbidden(true); setLoading(false); return; }
        const d = await r.json();
        setDados(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-gray-500 p-6">Carregando...</div>;

  if (forbidden) {
    return (
      <div className="max-w-lg mx-auto mt-16 text-center">
        <AlertCircle size={40} className="mx-auto mb-3 text-gray-400" />
        <p className="text-gray-500">Esta área é exclusiva para Pastores Presidentes.</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <DollarSign size={24} className="text-[#0D2B4E]" />
        <h1 className="text-2xl font-bold text-gray-900">Contribuição Estatutária</h1>
      </div>

      {dados?.campoNome && (
        <p className="text-sm text-gray-500">Campo: <strong>{dados.campoNome}</strong></p>
      )}

      {/* Status mês atual */}
      {dados?.statusMesAtual && (
        <div className={`rounded-2xl border p-5 flex items-center gap-4 ${
          dados.statusMesAtual === 'pago'
            ? 'bg-green-50 border-green-200'
            : 'bg-yellow-50 border-yellow-200'
        }`}>
          {dados.statusMesAtual === 'pago'
            ? <CheckCircle2 size={28} className="text-green-600 flex-shrink-0" />
            : <AlertCircle size={28} className="text-yellow-600 flex-shrink-0" />}
          <div>
            <p className="font-semibold text-gray-800">
              {MESES[dados.mesAtual]}/{dados.anoAtual} —{' '}
              {dados.statusMesAtual === 'pago' ? 'Pago' : 'Em aberto'}
            </p>
            <p className="text-sm text-gray-600">
              {dados.statusMesAtual === 'pago'
                ? 'Contribuição do mês atual registrada.'
                : 'A contribuição do mês atual ainda não foi registrada. Contate a secretaria.'}
            </p>
          </div>
        </div>
      )}

      {/* Histórico */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-800">Histórico de pagamentos</h2>
        </div>

        {!dados?.data.length ? (
          <div className="px-5 py-10 text-center text-gray-400">
            Nenhum pagamento registrado.
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {dados.data.map((c) => (
              <div key={c.id} className="px-5 py-3 flex items-center justify-between gap-4">
                <div>
                  <p className="font-medium text-gray-800 text-sm">
                    {c.mesLabel} / {c.ano}
                  </p>
                  <p className="text-xs text-gray-400">{c.formaPagamento}</p>
                </div>
                <div className="text-right">
                  <p className="font-semibold text-green-700 text-sm">{fmt(c.valor)}</p>
                  <CheckCircle2 size={14} className="text-green-500 inline ml-1" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
