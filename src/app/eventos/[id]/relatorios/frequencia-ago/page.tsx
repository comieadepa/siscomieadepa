'use client';

import { useEffect, useState, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useRequireSupabaseAuth } from '@/hooks/useRequireSupabaseAuth';
import PrintLetterhead from '@/components/print/PrintLetterhead';

// ─── Tipos ───────────────────────────────────────────────────
interface InscritoFrequencia {
  inscricao_id: string;
  nome: string;
  tipo_inscricao: string | null;
  supervisao: string | null;
  campo: string | null;
  dias_esperados: number;
  dias_presentes: number;
  dias_ausentes: number;
  percentual: number;
  status: 'regular' | 'ausente_parcial' | 'ausente_total' | 'sem_plenaria_configurada';
}

interface FrequenciaData {
  evento_id: string;
  evento_nome?: string;
  evento_data_inicio?: string;
  evento_data_fim?: string;
  evento_cidade?: string | null;
  evento_local?: string | null;
  plenarias_datas: string[];
  total_inscritos: number;
  inscritos: InscritoFrequencia[];
}

const STATUS_LABELS: Record<string, string> = {
  regular: 'Regular',
  ausente_parcial: 'Ausente Parcial',
  ausente_total: 'Ausente Total',
  sem_plenaria_configurada: 'Sem Plenária Config.',
};

const STATUS_BADGE: Record<string, string> = {
  regular: 'bg-green-100 text-green-700 border border-green-300',
  ausente_parcial: 'bg-yellow-100 text-yellow-700 border border-yellow-300',
  ausente_total: 'bg-red-100 text-red-700 border border-red-300',
  sem_plenaria_configurada: 'bg-gray-100 text-gray-500 border border-gray-300',
};

// ─── Componente ──────────────────────────────────────────────
export default function FrequenciaAgoPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { loading: authLoading } = useRequireSupabaseAuth();

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<FrequenciaData | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  // Filtros
  const [filtroSupervisao, setFiltroSupervisao] = useState('');
  const [filtroCampo, setFiltroCampo] = useState('');
  const [filtroCategoria, setFiltroCategoria] = useState('');
  const [filtroStatus, setFiltroStatus] = useState('');

  useEffect(() => {
    if (authLoading) return;
    async function load() {
      setLoading(true);
      try {
        const res = await fetch(`/api/eventos/${id}/frequencia-ago`);
        if (!res.ok) throw new Error((await res.json()).error ?? 'Erro ao carregar');
        setData(await res.json());
      } catch (e: unknown) {
        setErro(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [id, authLoading]);

  // Listas únicas para os filtros
  const supervisoesUnicas = useMemo(() => [...new Set((data?.inscritos ?? []).map(i => i.supervisao).filter(Boolean))].sort() as string[], [data]);
  const camposUnicos = useMemo(() => [...new Set((data?.inscritos ?? []).map(i => i.campo).filter(Boolean))].sort() as string[], [data]);
  const categoriasUnicas = useMemo(() => [...new Set((data?.inscritos ?? []).map(i => i.tipo_inscricao).filter(Boolean))].sort() as string[], [data]);

  const inscritos = useMemo(() => {
    if (!data) return [];
    return data.inscritos.filter(i => {
      if (filtroSupervisao && i.supervisao !== filtroSupervisao) return false;
      if (filtroCampo && i.campo !== filtroCampo) return false;
      if (filtroCategoria && i.tipo_inscricao !== filtroCategoria) return false;
      if (filtroStatus && i.status !== filtroStatus) return false;
      return true;
    });
  }, [data, filtroSupervisao, filtroCampo, filtroCategoria, filtroStatus]);

  function exportarCSV() {
    if (!inscritos.length) return;
    const header = ['Nome', 'Supervisão', 'Campo', 'Categoria', 'Dias Esperados', 'Dias Presentes', 'Ausentes', '% Presença', 'Status'];
    const rows = inscritos.map(i => [
      i.nome,
      i.supervisao ?? '-',
      i.campo ?? '-',
      i.tipo_inscricao ?? '-',
      i.dias_esperados,
      i.dias_presentes,
      i.dias_ausentes,
      `${i.percentual}%`,
      STATUS_LABELS[i.status] ?? i.status,
    ]);
    const csv = [header, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `frequencia-ago-${id}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (loading || authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-500 text-sm">Carregando relatório...</p>
      </div>
    );
  }

  if (erro) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-white rounded-xl shadow p-8 max-w-md text-center">
          <p className="text-red-600 font-semibold mb-4">{erro}</p>
          <button onClick={() => router.back()} className="text-[#123b63] underline text-sm">Voltar</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="print:hidden bg-[#123b63] text-white px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="text-white/70 hover:text-white text-xl leading-none">‹</button>
          <div>
            <h1 className="font-bold text-lg">Frequência AGO</h1>
            <p className="text-white/60 text-xs">
              {data?.plenarias_datas?.length
                ? `${data.plenarias_datas.length} plenária(s) configurada(s)`
                : 'Nenhuma plenária configurada'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={exportarCSV}
            className="bg-emerald-500 hover:bg-emerald-400 text-white text-xs font-bold px-4 py-2 rounded-lg transition"
          >
            ⬇️ CSV
          </button>
          <button
            onClick={() => window.print()}
            className="bg-white/20 hover:bg-white/30 text-white text-xs font-bold px-4 py-2 rounded-lg transition"
          >
            🖨️ Imprimir
          </button>
        </div>
      </div>

      <div className="print-page p-6 max-w-7xl mx-auto">
        <div className="hidden print:block mb-4">
          <PrintLetterhead
            reportTitle="Relatório de Frequência AGO"
            eventName={data?.evento_nome ?? null}
            periodText={data?.evento_data_inicio ? `${new Date(data.evento_data_inicio + 'T00:00:00').toLocaleDateString('pt-BR')} a ${new Date((data.evento_data_fim ?? data.evento_data_inicio) + 'T00:00:00').toLocaleDateString('pt-BR')}` : null}
            locationText={data?.evento_local || data?.evento_cidade ? [data?.evento_local, data?.evento_cidade].filter(Boolean).join(' - ') : null}
            issuedAtText={new Date().toLocaleDateString('pt-BR')}
            totalRecords={inscritos.length}
          />
        </div>

        {/* Datas das plenárias */}
        {data?.plenarias_datas && data.plenarias_datas.length > 0 && (
          <div className="print:mb-3 bg-blue-50 border border-blue-200 rounded-xl p-4 mb-5 flex flex-wrap gap-2 items-center">
            <span className="text-xs font-semibold text-blue-700 mr-1">Plenárias:</span>
            {data.plenarias_datas.map(d => (
              <span key={d} className="text-xs bg-blue-100 text-blue-700 border border-blue-300 px-2 py-0.5 rounded-full">
                {new Date(d + 'T00:00:00').toLocaleDateString('pt-BR')}
              </span>
            ))}
          </div>
        )}

        {/* Filtros */}
        <div className="print:hidden bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-5 flex flex-wrap gap-3">
          <select
            value={filtroSupervisao}
            onChange={e => setFiltroSupervisao(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#123b63] bg-white"
          >
            <option value="">Todas as supervisões</option>
            {supervisoesUnicas.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select
            value={filtroCampo}
            onChange={e => setFiltroCampo(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#123b63] bg-white"
          >
            <option value="">Todos os campos</option>
            {camposUnicos.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select
            value={filtroCategoria}
            onChange={e => setFiltroCategoria(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#123b63] bg-white"
          >
            <option value="">Todas as categorias</option>
            {categoriasUnicas.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select
            value={filtroStatus}
            onChange={e => setFiltroStatus(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#123b63] bg-white"
          >
            <option value="">Todos os status</option>
            {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          {(filtroSupervisao || filtroCampo || filtroCategoria || filtroStatus) && (
            <button
              onClick={() => { setFiltroSupervisao(''); setFiltroCampo(''); setFiltroCategoria(''); setFiltroStatus(''); }}
              className="text-xs text-gray-500 underline hover:no-underline"
            >
              Limpar filtros
            </button>
          )}
          <span className="ml-auto text-xs text-gray-400 self-center">
            {inscritos.length} de {data?.total_inscritos ?? 0} inscritos
          </span>
        </div>

        {/* Tabela */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden print:shadow-none print:rounded-none print:border-gray-300">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs font-semibold text-gray-500 uppercase">
                <tr>
                  <th className="px-4 py-3 text-left">Nome</th>
                  <th className="px-4 py-3 text-left">Supervisão</th>
                  <th className="px-4 py-3 text-left">Campo</th>
                  <th className="px-4 py-3 text-left">Categoria</th>
                  <th className="px-4 py-3 text-center">Esperados</th>
                  <th className="px-4 py-3 text-center">Presentes</th>
                  <th className="px-4 py-3 text-center">Ausentes</th>
                  <th className="px-4 py-3 text-center">%</th>
                  <th className="px-4 py-3 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {inscritos.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-10 text-center text-gray-400 text-sm">
                      Nenhum inscrito encontrado com os filtros aplicados.
                    </td>
                  </tr>
                ) : inscritos.map(inscrito => (
                  <tr key={inscrito.inscricao_id} className="hover:bg-gray-50 transition">
                    <td className="px-4 py-3 font-medium text-gray-800">{inscrito.nome}</td>
                    <td className="px-4 py-3 text-gray-600">{inscrito.supervisao ?? '-'}</td>
                    <td className="px-4 py-3 text-gray-600">{inscrito.campo ?? '-'}</td>
                    <td className="px-4 py-3 text-gray-600">{inscrito.tipo_inscricao ?? '-'}</td>
                    <td className="px-4 py-3 text-center text-gray-700">{inscrito.dias_esperados}</td>
                    <td className="px-4 py-3 text-center font-semibold text-green-700">{inscrito.dias_presentes}</td>
                    <td className="px-4 py-3 text-center font-semibold text-red-600">{inscrito.dias_ausentes}</td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <div className="w-16 bg-gray-200 rounded-full h-1.5">
                          <div
                            className="h-1.5 rounded-full"
                            style={{
                              width: `${inscrito.percentual}%`,
                              backgroundColor: inscrito.percentual >= 80 ? '#16a34a' : inscrito.percentual >= 50 ? '#ca8a04' : '#dc2626',
                            }}
                          />
                        </div>
                        <span className="text-xs text-gray-600">{inscrito.percentual}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_BADGE[inscrito.status] ?? ''}`}>
                        {STATUS_LABELS[inscrito.status] ?? inscrito.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <style jsx global>{`
        @media print {
          @page {
            size: A4 portrait;
            margin: 10mm;
          }
          body {
            background: white !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .print-page {
            width: 210mm;
            min-height: 297mm;
            max-width: none;
            margin: 0 auto;
            padding: 12mm;
            background: white;
          }
          .print-page table,
          .print-page tr,
          .print-page td,
          .print-page th,
          .print-page .rounded-xl {
            break-inside: avoid;
            page-break-inside: avoid;
          }
        }
      `}</style>
    </div>
  );
}
