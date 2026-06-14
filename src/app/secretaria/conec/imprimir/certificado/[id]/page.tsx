'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase-client';
import { formatCnpj } from '@/lib/mascaras';
import { Printer, ArrowLeft, Lock } from 'lucide-react';

export default function ImprimirCertificadoPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string; // credenciamentoId
  const supabase = createClient();

  const [credenciamento, setCredenciamento] = useState<any>(null);
  const [instituicao, setInstituicao] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchDados = async () => {
      try {
        // Buscar o credenciamento
        const { data: cred, error: credError } = await supabase
          .from('conec_credenciamentos')
          .select('*')
          .eq('id', id)
          .is('deleted_at', null)
          .single();

        if (credError || !cred) {
          throw new Error('Credenciamento não encontrado.');
        }
        setCredenciamento(cred);

        // Buscar a instituição
        const { data: inst, error: instError } = await supabase
          .from('conec_instituicoes')
          .select('*')
          .eq('id', cred.instituicao_id)
          .is('deleted_at', null)
          .single();

        if (instError || !inst) {
          throw new Error('Instituição associada ao credenciamento não encontrada.');
        }
        setInstituicao(inst);

      } catch (err: any) {
        console.error(err);
        setError(err.message || 'Erro ao carregar dados do certificado.');
      } finally {
        setLoading(false);
      }
    };

    if (id) fetchDados();
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600" />
      </div>
    );
  }

  // Regra de Bloqueio Obrigatória
  const isLocked = !credenciamento ||
                   credenciamento.status_pagamento !== 'pago' ||
                   credenciamento.status_credenciamento !== 'ativo';

  if (error || !credenciamento || !instituicao || isLocked) {
    const errorMsg = error || (isLocked
      ? 'Certificado disponível somente após confirmação do pagamento e ativação do credenciamento.'
      : 'Credenciamento inválido.');

    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-4">
        <div className="bg-amber-50 border border-amber-200 text-amber-900 p-8 rounded-lg max-w-md text-center shadow-lg">
          <Lock className="w-12 h-12 text-amber-600 mx-auto mb-4" />
          <h2 className="text-xl font-bold mb-3">Acesso Bloqueado</h2>
          <p className="text-sm text-amber-800 leading-relaxed">{errorMsg}</p>
          <button
            onClick={() => router.back()}
            className="mt-6 px-5 py-2.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-sm font-semibold transition"
          >
            Voltar
          </button>
        </div>
      </div>
    );
  }

  // Datas Formatadas
  const dataEmissaoFormatada = credenciamento.data_emissao
    ? new Date(credenciamento.data_emissao).toLocaleDateString('pt-BR')
    : new Date().toLocaleDateString('pt-BR');

  const dataFimFormatada = new Date(credenciamento.data_fim).toLocaleDateString('pt-BR');

  return (
    <div className="min-h-screen bg-gray-100 py-12 px-4 flex flex-col items-center justify-center print:bg-white print:p-0 print:min-h-0 print:h-screen print:justify-center">
      {/* Estilos CSS Nativos de Impressão */}
      <style jsx global>{`
        @media print {
          @page {
            size: landscape;
            margin: 0;
          }
          body {
            margin: 0;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .no-print {
            display: none !important;
          }
          .print-container {
            width: 297mm !important;
            height: 210mm !important;
            border: 0 !important;
            box-shadow: none !important;
            border-radius: 0 !important;
            margin: 0 !important;
            transform: none !important;
          }
        }
      `}</style>

      {/* Barra de Ações (Oculta na impressão) */}
      <div className="w-full max-w-[1122px] mb-6 flex items-center justify-between print:hidden no-print">
        <button
          onClick={() => router.back()}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-900 font-semibold text-sm transition"
        >
          <ArrowLeft className="w-4 h-4" />
          Voltar para listagem
        </button>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-2 bg-teal-600 hover:bg-teal-700 text-white font-semibold px-5 py-2.5 rounded-lg text-sm transition shadow-md"
        >
          <Printer className="w-4 h-4" />
          Imprimir Certificado
        </button>
      </div>

      {/* Diploma em Paisagem (A4 Proportional: 1122px x 793px) */}
      <div
        className="print-container relative w-[1122px] h-[793px] bg-white border border-gray-300 rounded-lg shadow-2xl overflow-hidden bg-cover bg-no-repeat bg-center select-none"
        style={{ backgroundImage: "url('/img/cert_credenciamento.jpg')" }}
      >
        {/* Nome da Instituição - Centralizado após 'CERTIFICA QUE A INSTITUIÇÃO' */}
        <div className="absolute top-[41%] left-1/2 -translate-x-1/2 w-[85%] text-center">
          <h2 className="text-3xl font-extrabold text-teal-950 uppercase tracking-wide font-sans leading-snug drop-shadow-sm">
            {instituicao.nome_instituicao}
          </h2>
          <p className="text-sm font-semibold text-gray-600 tracking-wider mt-1.5">
            CNPJ: {formatCnpj(instituicao.cnpj)}
          </p>
        </div>

        {/* Dados do Credenciamento */}
        <div className="absolute bottom-[28%] left-1/2 -translate-x-1/2 w-[70%] flex justify-between text-center text-teal-950 text-sm font-bold tracking-wider uppercase font-sans">
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] text-gray-500 font-medium">Registro do Conselho</span>
            <span>Nº {credenciamento.numero_registro}</span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] text-gray-500 font-medium">Data de Emissão</span>
            <span>{dataEmissaoFormatada}</span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] text-gray-500 font-medium">Válido até</span>
            <span>{dataFimFormatada}</span>
          </div>
        </div>

        {/* Assinaturas Oficiais */}
        <div className="absolute bottom-[11%] left-1/2 -translate-x-1/2 w-[80%] flex justify-around text-center text-gray-800 font-sans">
          <div className="flex flex-col items-center">
            <div className="w-64 border-t border-gray-400/80 mb-1"></div>
            <span className="text-[11px] font-extrabold text-teal-950 uppercase tracking-wide">
              Pr. Francisco de Assis da Silva Alcântara
            </span>
            <span className="text-[9px] text-gray-500 uppercase tracking-widest font-semibold mt-0.5">
              Secretário do CONEC
            </span>
          </div>
          
          <div className="flex flex-col items-center">
            <div className="w-64 border-t border-gray-400/80 mb-1"></div>
            <span className="text-[11px] font-extrabold text-teal-950 uppercase tracking-wide">
              Pr. Jesanias Calderaro Pereira
            </span>
            <span className="text-[9px] text-gray-500 uppercase tracking-widest font-semibold mt-0.5">
              Presidente do CONEC
            </span>
          </div>
        </div>

        {/* Ano Referência no Selo (Canto Inferior Direito) */}
        {credenciamento.ano_referencia && (
          <div className="absolute bottom-[23%] right-[8%] w-16 h-16 flex items-center justify-center pointer-events-none">
            <span className="text-lg font-extrabold text-teal-800/20 font-serif rotate-[15deg]">
              {credenciamento.ano_referencia}
            </span>
          </div>
        )}

      </div>
    </div>
  );
}
