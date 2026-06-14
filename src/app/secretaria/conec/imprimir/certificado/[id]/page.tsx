'use client';

import { useEffect, useState, Suspense } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase-client';
import { formatCnpj } from '@/lib/mascaras';
import { Printer, ArrowLeft, Lock } from 'lucide-react';

function CertificadoContent() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  
  const id = params.id as string; // credenciamentoId
  const debug = searchParams?.get('debug') === '1';
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
    : new Date(credenciamento.data_inicio).toLocaleDateString('pt-BR');

  const dataFimFormatada = new Date(credenciamento.data_fim).toLocaleDateString('pt-BR');

  // Estilo debug temporário para calibrar posicionamento absoluto
  const debugBorder = debug ? 'border-2 border-red-500 bg-red-100/10' : '';

  return (
    <div className="min-h-screen bg-gray-100 py-12 px-4 flex flex-col items-center justify-center print:bg-white print:p-0 print:min-h-0 print:h-screen print:justify-center">
      {/* Estilos CSS Nativos de Impressão */}
      <style jsx global>{`
        @media print {
          @page {
            size: A4 landscape;
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
            width: 1123px !important;
            height: 794px !important;
            border: 0 !important;
            box-shadow: none !important;
            border-radius: 0 !important;
            margin: 0 !important;
            transform: none !important;
          }
        }
      `}</style>

      {/* Barra de Ações (Oculta na impressão) */}
      <div className="w-full max-w-[1123px] mb-6 flex items-center justify-between print:hidden no-print">
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

      {/* Diploma em Paisagem (A4 Proportional: 1123px x 794px) */}
      <div
        className="print-container relative w-[1123px] h-[794px] bg-white border border-gray-300 rounded-lg shadow-2xl overflow-hidden bg-cover bg-no-repeat bg-center select-none"
        style={{ backgroundImage: "url('/img/cert_credenciamento.jpg')" }}
      >
        {/* Nome da Instituição */}
        <div
          className={`absolute ${debugBorder} flex items-center justify-center`}
          style={{
            top: '49%',
            left: '15%',
            width: '70%',
            height: '4.5%',
          }}
        >
          <span className="text-[26px] font-bold text-gray-900 uppercase tracking-wide font-sans leading-none">
            {instituicao.nome_instituicao}
          </span>
        </div>

        {/* CNPJ */}
        <div
          className={`absolute ${debugBorder} flex items-center justify-center`}
          style={{
            top: '54%',
            left: '35%',
            width: '30%',
            height: '3%',
          }}
        >
          <span className="text-[14px] text-gray-800 font-sans font-medium">
            {formatCnpj(instituicao.cnpj)}
          </span>
        </div>

        {/* Registro nº */}
        <div
          className={`absolute ${debugBorder} flex items-center justify-start`}
          style={{
            top: '80%',
            left: '15%',
            width: '20%',
            height: '3%',
          }}
        >
          <span className="text-[14px] text-gray-800 font-sans font-bold">
            {credenciamento.numero_registro}
          </span>
        </div>

        {/* Data de credenciamento */}
        <div
          className={`absolute ${debugBorder} flex items-center justify-start`}
          style={{
            top: '83%',
            left: '15%',
            width: '25%',
            height: '3%',
          }}
        >
          <span className="text-[14px] text-gray-800 font-sans font-bold">
            {dataEmissaoFormatada}
          </span>
        </div>

        {/* Validade */}
        <div
          className={`absolute ${debugBorder} flex items-center justify-start`}
          style={{
            top: '86%',
            left: '15%',
            width: '20%',
            height: '3%',
          }}
        >
          <span className="text-[14px] text-gray-800 font-sans font-bold">
            {dataFimFormatada}
          </span>
        </div>

      </div>
    </div>
  );
}

export default function ImprimirCertificadoPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center bg-gray-50"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600" /></div>}>
      <CertificadoContent />
    </Suspense>
  );
}
