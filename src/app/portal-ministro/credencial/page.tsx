'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { IdCard, CheckCircle2, AlertCircle, Clock, ExternalLink } from 'lucide-react';

interface CredencialData {
  statusCredencial: 'ativa' | 'vencida' | 'pendente';
  dataValidade: string | null;
  dataEmissao: string | null;
  uniqueId: string | null;
  credencialUrl: string | null;
}

const fmtDate = (v: string | null) => {
  if (!v) return '—';
  const d = new Date(v + 'T00:00:00');
  return d.toLocaleDateString('pt-BR');
};

export default function CredencialPage() {
  const [data, setData] = useState<CredencialData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/portal-ministro/credencial')
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-gray-500 p-6">Carregando...</div>;

  const status = data?.statusCredencial;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <IdCard size={24} className="text-[#0D2B4E]" />
        <h1 className="text-2xl font-bold text-gray-900">Minha Credencial</h1>
      </div>

      {/* Status card */}
      <div className={`rounded-2xl border p-6 ${
        status === 'ativa'
          ? 'bg-green-50 border-green-200'
          : status === 'vencida'
          ? 'bg-red-50 border-red-200'
          : 'bg-yellow-50 border-yellow-200'
      }`}>
        <div className="flex items-center gap-3 mb-4">
          {status === 'ativa' && <CheckCircle2 size={24} className="text-green-600" />}
          {status === 'vencida' && <AlertCircle size={24} className="text-red-600" />}
          {status === 'pendente' && <Clock size={24} className="text-yellow-600" />}
          <div>
            <p className="font-bold text-lg text-gray-900">
              {status === 'ativa' && 'Credencial ativa'}
              {status === 'vencida' && 'Credencial vencida'}
              {status === 'pendente' && 'Credencial pendente'}
            </p>
            <p className="text-sm text-gray-600">
              {status === 'ativa' && `Válida até ${fmtDate(data?.dataValidade || null)}`}
              {status === 'vencida' && `Venceu em ${fmtDate(data?.dataValidade || null)}`}
              {status === 'pendente' && 'Nenhuma credencial emitida ainda.'}
            </p>
          </div>
        </div>

        {data?.dataEmissao && (
          <p className="text-sm text-gray-500">Emitida em: {fmtDate(data.dataEmissao)}</p>
        )}

        {status === 'ativa' && data?.credencialUrl && (
          <a
            href={data.credencialUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white font-semibold px-5 py-2.5 rounded-lg transition-colors"
          >
            <ExternalLink size={16} />
            Acessar Credencial Digital
          </a>
        )}

        {status === 'vencida' && (
          <div className="mt-4 bg-white border border-red-200 rounded-xl p-4">
            <p className="text-sm font-semibold text-red-700 mb-1">Como regularizar?</p>
            <p className="text-sm text-gray-600">
              Entre em contato com a secretaria da sua supervisão para renovar a credencial.
              Após a renovação, ela será exibida aqui automaticamente.
            </p>
          </div>
        )}
      </div>

      {/* Solicitar impressão */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <h2 className="font-semibold text-gray-800 mb-2">Precisa de credencial impressa?</h2>
        <p className="text-sm text-gray-500 mb-4">
          Solicite a impressão física da credencial. Será gerada uma cobrança de R$ 20,00 via ASAAS.
        </p>
        <Link
          href="/portal-ministro/impressao"
          className="inline-flex items-center gap-2 bg-[#0D2B4E] hover:bg-[#1a4a7a] text-white font-semibold px-5 py-2.5 rounded-lg transition-colors text-sm"
        >
          Solicitar impressão da credencial
        </Link>
      </div>
    </div>
  );
}
