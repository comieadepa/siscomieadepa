'use client';

import { useState } from 'react';
import {
  FileText,
  Download,
  Printer,
  X,
  Loader2,
  CheckCircle2,
  Users,
  Utensils,
  Home,
  DollarSign,
  TrendingUp,
} from 'lucide-react';
import {
  gerarRelatorioExecutivoPDF,
  type DashboardExecutivoData,
  type TipoRelatorioExecutivo,
} from '@/lib/relatorio-executivo-pdf';

interface ModalRelatorioExecutivoPDFProps {
  eventoId: string;
  isOpen: boolean;
  onClose: () => void;
}

const OPCOES_RELATORIO: Array<{
  id: TipoRelatorioExecutivo;
  titulo: string;
  descricao: string;
  icon: any;
  destaque?: boolean;
}> = [
  {
    id: 'completo',
    titulo: 'Relatório Executivo Completo',
    descricao: 'Documento oficial consolidado (Resumo, Inscrições, Plenárias, Refeitório, Hospedagem e Financeiro).',
    icon: FileText,
    destaque: true,
  },
  {
    id: 'resumo',
    titulo: 'Síntese Executiva & Inscrições',
    descricao: 'Indicadores-chave consolidados, representatividade ministerial e metas do evento.',
    icon: TrendingUp,
  },
  {
    id: 'inscricoes',
    titulo: 'Inscrições por Categoria',
    descricao: 'Distribuição detalhada por categoria funcional (Pastores, Esposas, Juventude e Apoio).',
    icon: Users,
  },
  {
    id: 'presenca',
    titulo: 'Presença & Sessões de Plenária',
    descricao: 'Frequência detalhada por dia de plenária e representatividade por supervisão regional.',
    icon: CheckCircle2,
  },
  {
    id: 'alimentacao',
    titulo: 'Alimentação & Refeitório',
    descricao: 'Consumo real de refeições por data e pontos de distribuição do evento.',
    icon: Utensils,
  },
  {
    id: 'hospedagem',
    titulo: 'Hospedagem & Pavilhões',
    descricao: 'Ocupação de leitos por pavilhão/alojamento, check-ins e taxa de ocupação.',
    icon: Home,
  },
  {
    id: 'financeiro',
    titulo: 'Demonstrativo Financeiro',
    descricao: 'Total arrecadado, ticket médio, isenções oficiais e distribuição por meio de pagamento.',
    icon: DollarSign,
  },
];

export default function ModalRelatorioExecutivoPDF({
  eventoId,
  isOpen,
  onClose,
}: ModalRelatorioExecutivoPDFProps) {
  const [tipoSelecionado, setTipoSelecionado] = useState<TipoRelatorioExecutivo>('completo');
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  if (!isOpen) return null;

  async function handleEmitir(acao: 'imprimir' | 'download') {
    setGerando(true);
    setErro(null);
    try {
      // 1. Busca os dados consolidados do backend
      const res = await fetch(`/api/eventos/${eventoId}/dashboard-executivo`);
      if (!res.ok) {
        throw new Error('Falha ao carregar dados consolidados do evento.');
      }
      const data: DashboardExecutivoData = await res.json();

      // 2. Gera o PDF oficial com jsPDF + autotable
      const doc = await gerarRelatorioExecutivoPDF(data, tipoSelecionado);

      const nomeLimpo = (data.evento.nome || 'AGO')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '_')
        .replace(/_+/g, '_');
      const filename = `relatorio_executivo_${tipoSelecionado}_${nomeLimpo}.pdf`;

      if (acao === 'download') {
        doc.save(filename);
      } else {
        // Abre na visualização nativa para impressão rápida
        const blob = doc.output('blob');
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank');
      }
    } catch (err: any) {
      console.error('Erro ao gerar relatório executivo PDF:', err);
      setErro(err?.message || 'Erro inesperado ao gerar o relatório oficial.');
    } finally {
      setGerando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl border border-gray-200 w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header do Modal */}
        <div className="bg-gradient-to-r from-[#0D2B4E] to-[#123b63] p-5 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center text-xl">
              🏛️
            </div>
            <div>
              <h2 className="text-base font-black tracking-wide">Emissão de Relatório Executivo Oficial</h2>
              <p className="text-xs text-blue-200">Padrão institucional COMIEADEPA para presidência e reuniões ministeriais</p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={gerando}
            className="p-1.5 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Corpo: Seleção de Relatório */}
        <div className="p-6 overflow-y-auto space-y-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            Selecione o formato do documento desejado:
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {OPCOES_RELATORIO.map((op) => {
              const Icon = op.icon;
              const isSelected = tipoSelecionado === op.id;
              return (
                <button
                  key={op.id}
                  type="button"
                  onClick={() => setTipoSelecionado(op.id)}
                  disabled={gerando}
                  className={`text-left p-3.5 rounded-xl border transition flex items-start gap-3 ${
                    isSelected
                      ? 'border-[#0D2B4E] bg-blue-50/70 shadow-sm ring-2 ring-[#0D2B4E]/20'
                      : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                  } ${op.destaque ? 'sm:col-span-2' : ''}`}
                >
                  <div
                    className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
                      isSelected
                        ? 'bg-[#0D2B4E] text-white'
                        : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className={`text-xs font-bold leading-tight ${isSelected ? 'text-[#0D2B4E]' : 'text-gray-800'}`}>
                        {op.titulo}
                      </p>
                      {op.destaque && (
                        <span className="px-1.5 py-0.5 text-[9px] font-black uppercase rounded bg-amber-100 text-amber-800">
                          Recomendado
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-gray-500 mt-1 leading-snug">
                      {op.descricao}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>

          {erro && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs flex items-center gap-2">
              <span className="font-bold">Atenção:</span> {erro}
            </div>
          )}

          {/* Destaque Metodológico */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-[11px] text-slate-600 space-y-1">
            <p className="font-bold text-slate-700">Garantia Institucional de Dados:</p>
            <p>
              • Diferencia rigorosamente participantes únicos auditados de leituras brutas de scanner.
            </p>
            <p>
              • Registros sem local de credenciamento/refeitório permanecem discriminados como "Legado / Não especificado".
            </p>
            <p>
              • Layout formatado para folha A4 com brasão oficial, paginação contínua e critérios explicativos.
            </p>
          </div>
        </div>

        {/* Footer com Botões de Ação */}
        <div className="p-4 bg-gray-50 border-t border-gray-200 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={gerando}
            className="px-4 py-2 text-xs font-bold text-gray-600 hover:text-gray-800 transition"
          >
            Cancelar
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleEmitir('imprimir')}
              disabled={gerando}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-xl border border-gray-300 bg-white text-gray-700 hover:bg-gray-100 transition shadow-sm disabled:opacity-50"
            >
              {gerando ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Printer className="w-3.5 h-3.5 text-gray-600" />
              )}
              Visualizar / Imprimir
            </button>

            <button
              type="button"
              onClick={() => handleEmitir('download')}
              disabled={gerando}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-xl bg-[#0D2B4E] text-white hover:bg-[#0a1e38] transition shadow-sm disabled:opacity-50"
            >
              {gerando ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Download className="w-3.5 h-3.5" />
              )}
              Baixar Relatório (PDF)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
