'use client';

import { useEffect, useState } from 'react';
import { History } from 'lucide-react';

interface HistoricoItem {
  id: string;
  tipo: string;
  tipoLabel: string;
  titulo: string | null;
  descricao: string;
  ocorrencia: string;
  criadoEm: string;
}

const TIPO_COLOR: Record<string, string> = {
  credencial_emitida:        'bg-blue-500',
  carta_emitida:             'bg-green-500',
  progressao_ministerial:    'bg-purple-500',
  consagracao:               'bg-yellow-500',
  apresentacao:              'bg-teal-500',
  deliberacao_comissao:      'bg-orange-500',
  assumiu_pastor_presidente: 'bg-red-500',
  transferencia:             'bg-indigo-500',
  mudanca_de_campo:          'bg-cyan-500',
  jubilacao:                 'bg-amber-500',
  reativacao:                'bg-emerald-500',
  desligamento:              'bg-rose-600',
};

const fmtDate = (v: string | null) => {
  if (!v) return '—';
  const d = new Date(v);
  if (isNaN(d.getTime())) return v;
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
};

export default function HistoricoPage() {
  const [itens, setItens] = useState<HistoricoItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/portal-ministro/historico')
      .then((r) => r.json())
      .then((d) => { setItens(d.data || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <History size={24} className="text-[#0D2B4E]" />
        <h1 className="text-2xl font-bold text-gray-900">Histórico Ministerial</h1>
      </div>

      {loading && <div className="text-gray-500">Carregando...</div>}

      {!loading && itens.length === 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center text-gray-400">
          <History size={40} className="mx-auto mb-3 opacity-30" />
          <p>Nenhum registro ministerial encontrado.</p>
        </div>
      )}

      {!loading && itens.length > 0 && (() => {
        const byYear: Record<number, HistoricoItem[]> = {};
        itens.forEach((item) => {
          const year = new Date(item.ocorrencia).getFullYear();
          if (!byYear[year]) byYear[year] = [];
          byYear[year].push(item);
        });
        const years = Object.keys(byYear).map(Number).sort((a, b) => b - a);

        return (
          <div className="space-y-8">
            {years.map((year) => (
              <div key={year}>
                {/* Cabeçalho do ano */}
                <div className="flex items-center gap-3 mb-4">
                  <span className="text-2xl font-bold text-[#0D2B4E]">{year}</span>
                  <div className="flex-1 h-px bg-gray-200" />
                </div>

                {/* Itens do ano */}
                <div className="relative">
                  <div className="absolute left-5 top-0 bottom-0 w-0.5 bg-gray-200" />
                  <div className="space-y-4">
                    {byYear[year].map((item) => {
                      const dotColor = TIPO_COLOR[item.tipo] || 'bg-gray-400';
                      return (
                        <div key={item.id} className="flex gap-4 pl-12 relative">
                          <div
                            className={`absolute left-3.5 top-3 w-3 h-3 rounded-full ${dotColor} border-2 border-white shadow`}
                          />
                          <div className="flex-1 bg-white rounded-xl border border-gray-100 shadow-sm px-5 py-4">
                            <div className="flex flex-wrap items-center gap-2 mb-1">
                              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full text-white ${dotColor}`}>
                                {item.tipoLabel}
                              </span>
                              <span className="text-xs text-gray-400">{fmtDate(item.ocorrencia)}</span>
                            </div>
                            {item.titulo && <p className="font-semibold text-gray-800 text-sm">{item.titulo}</p>}
                            <p className="text-sm text-gray-600 mt-0.5">{item.descricao}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        );
      })()}
    </div>
  );
}
