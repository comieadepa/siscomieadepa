'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase-client';
import { formatCnpj } from '@/lib/mascaras';
import { Printer, ArrowLeft } from 'lucide-react';

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
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (error || !credenciamento || !instituicao) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-4">
        <div className="bg-red-50 border border-red-200 text-red-700 p-6 rounded-lg max-w-md text-center">
          <h2 className="text-lg font-bold mb-2">Erro</h2>
          <p>{error || 'Credenciamento inválido.'}</p>
          <button
            onClick={() => router.back()}
            className="mt-4 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-semibold transition"
          >
            Voltar
          </button>
        </div>
      </div>
    );
  }

  const dataEmissaoFormatada = credenciamento.data_emissao
    ? new Date(credenciamento.data_emissao).toLocaleDateString('pt-BR')
    : new Date().toLocaleDateString('pt-BR');

  const dataInicioFormatada = new Date(credenciamento.data_inicio).toLocaleDateString('pt-BR');
  const dataFimFormatada = new Date(credenciamento.data_fim).toLocaleDateString('pt-BR');

  return (
    <div className="min-h-screen bg-gray-100 py-12 px-4 flex flex-col items-center justify-center print:bg-white print:p-0 print:min-h-0 print:h-screen print:justify-center">
      {/* Barra de Ações (Oculta na impressão) */}
      <div className="w-full max-w-4xl mb-6 flex items-center justify-between print:hidden">
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

      {/* Conteúdo do Certificado (Layout Diploma em Paisagem) */}
      <div className="w-full max-w-4xl aspect-[1.414/1] bg-white border-[16px] border-double border-teal-800 rounded-lg shadow-2xl p-12 flex flex-col justify-between text-center relative overflow-hidden print:shadow-none print:border-[12px] print:p-8 print:max-w-full print:h-[90vh]">
        
        {/* Marca d'água de fundo */}
        <div className="absolute inset-0 flex items-center justify-center opacity-[0.03] pointer-events-none select-none">
          <span className="text-[240px]">🎓</span>
        </div>

        {/* Topo / Cabeçalho */}
        <div className="flex flex-col items-center">
          <span className="text-4xl mb-1 text-teal-800">🎓</span>
          <h2 className="text-lg font-bold text-gray-500 uppercase tracking-widest">COMIEADEPA</h2>
          <h1 className="text-xl font-extrabold text-teal-900 uppercase tracking-wider mt-0.5">
            CONSELHO DE EDUCAÇÃO CRISTÃ — CONEC
          </h1>
          <div className="w-24 h-0.5 bg-teal-600 my-3"></div>
        </div>

        {/* Corpo / Texto Principal */}
        <div className="my-auto px-6">
          <h2 className="text-2xl font-serif italic text-teal-800 mb-6">Certificado de Credenciamento</h2>
          
          <p className="text-base leading-relaxed text-gray-700 max-w-2xl mx-auto font-sans">
            Certificamos para os devidos fins que a instituição teológica{' '}
            <strong className="text-gray-900 font-extrabold text-lg block my-1">
              {instituicao.nome_instituicao}
            </strong>{' '}
            inscrita no CNPJ sob o nº{' '}
            <span className="font-semibold text-gray-900">{formatCnpj(instituicao.cnpj)}</span>, 
            representada por <strong className="text-gray-900 font-bold">{instituicao.nome_representante}</strong>, 
            está devidamente credenciada e registrada junto a este conselho sob o número de registro{' '}
            <strong className="text-teal-900 font-extrabold">{credenciamento.numero_registro}</strong>, 
            estando habilitada para o ensino teológico no período de{' '}
            <span className="font-semibold text-gray-900">{dataInicioFormatada}</span> a{' '}
            <span className="font-semibold text-gray-900">{dataFimFormatada}</span>.
          </p>
        </div>

        {/* Rodapé / Emissão e Assinaturas */}
        <div className="flex flex-col items-center">
          <p className="text-xs text-gray-500 mb-8 font-medium">
            Belém - PA, {dataEmissaoFormatada}
          </p>

          <div className="grid grid-cols-2 gap-16 w-full max-w-xl text-center">
            <div className="flex flex-col items-center">
              <div className="w-full border-t border-gray-400 pt-2">
                <span className="text-xs font-bold text-gray-700 uppercase block">Secretário do CONEC</span>
                <span className="text-[10px] text-gray-400 uppercase tracking-wider block">CONEC</span>
              </div>
            </div>
            <div className="flex flex-col items-center">
              <div className="w-full border-t border-gray-400 pt-2">
                <span className="text-xs font-bold text-gray-700 uppercase block">Presidente da COMIEADEPA</span>
                <span className="text-[10px] text-gray-400 uppercase tracking-wider block">COMIEADEPA</span>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
