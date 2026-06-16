'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase-client';
import { getInstituicaoById } from '@/lib/conec-service';
import { formatCnpj } from '@/lib/mascaras';
import { Printer, ArrowLeft } from 'lucide-react';

export default function ImprimirFichaPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const supabase = createClient();

  const [instituicao, setInstituicao] = useState<any>(null);
  const [credenciamento, setCredenciamento] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchDados = async () => {
      try {
        const instData = await getInstituicaoById(supabase, id);
        setInstituicao(instData);

        // Buscar o credenciamento mais recente
        const { data: creds, error: credError } = await supabase
          .from('conec_credenciamentos')
          .select('*')
          .eq('instituicao_id', id)
          .is('deleted_at', null)
          .order('ano_referencia', { ascending: false });

        if (!credError && creds && creds.length > 0) {
          setCredenciamento(creds[0]);
        }
      } catch (err: any) {
        console.error(err);
        setError(err.message || 'Erro ao carregar dados para a ficha.');
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

  if (error || !instituicao) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-4">
        <div className="bg-red-50 border border-red-200 text-red-700 p-6 rounded-lg max-w-md text-center">
          <h2 className="text-lg font-bold mb-2">Erro</h2>
          <p>{error || 'Instituição não encontrada.'}</p>
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

  const dataInicioFormatada = credenciamento?.data_inicio
    ? new Date(credenciamento.data_inicio).toLocaleDateString('pt-BR')
    : '';

  const dataFimFormatada = credenciamento?.data_fim
    ? new Date(credenciamento.data_fim).toLocaleDateString('pt-BR')
    : '';

  const getLongDate = (dateString?: string) => {
    try {
      const d = dateString ? new Date(dateString) : new Date();
      // Ajusta para o fuso horário local para evitar retrocesso de data
      const date = new Date(d.getTime() + d.getTimezoneOffset() * 60000);
      const meses = [
        'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
        'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
      ];
      return `${date.getDate()} de ${meses[date.getMonth()]} de ${date.getFullYear()}`;
    } catch {
      return '';
    }
  };

  const emissaoLonga = getLongDate(credenciamento?.data_emissao || new Date().toISOString());

  const enderecoCompleto = [
    instituicao.logradouro && `${instituicao.logradouro}, ${instituicao.numero || 'S/N'}${instituicao.complemento ? ` - ${instituicao.complemento}` : ''}`,
    instituicao.bairro,
    instituicao.cidade && `${instituicao.cidade} - ${instituicao.estado || ''}`,
    instituicao.cep && `CEP: ${instituicao.cep}`
  ].filter(Boolean).join(', ') || 'Não informado';

  return (
    <div className="min-h-screen bg-gray-100 py-8 px-4 print:bg-white print:p-0 print:min-h-0 flex flex-col items-center justify-center">
      {/* Barra de Ações (Oculta na impressão) */}
      <div className="w-full max-w-[210mm] mb-6 flex items-center justify-between print:hidden">
        <button
          onClick={() => router.back()}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-900 font-semibold text-sm transition"
        >
          <ArrowLeft className="w-4 h-4" />
          Voltar para listagem
        </button>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold px-4 py-2 rounded-lg text-sm transition shadow-md"
        >
          <Printer className="w-4 h-4" />
          Imprimir Ficha
        </button>
      </div>

      {/* CSS customizado para garantir proporções de impressão exatas em A4 Portrait */}
      <style jsx global>{`
        @media print {
          @page {
            size: A4 portrait;
            margin: 0;
          }
          body {
            margin: 0;
            background-color: #ffffff;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .no-print {
            display: none !important;
          }
          .print-page {
            width: 210mm !important;
            height: 297mm !important;
            padding: 20mm 20mm 15mm 20mm !important;
            margin: 0 !important;
            border: 0 !important;
            box-shadow: none !important;
            border-radius: 0 !important;
            box-sizing: border-box !important;
            position: relative !important;
            page-break-after: avoid !important;
            page-break-before: avoid !important;
            overflow: hidden !important;
          }
        }

        .print-page {
          width: 210mm;
          height: 297mm;
          padding: 20mm 20mm 15mm 20mm;
          background-color: #ffffff;
          border: 1px solid #ccc;
          box-shadow: 0 4px 15px rgba(0,0,0,0.1);
          box-sizing: border-box;
          position: relative;
          overflow: hidden;
        }

        .watermark {
          position: absolute;
          left: 50%;
          top: 50%;
          transform: translate(-50%, -50%);
          width: 120mm;
          height: 120mm;
          opacity: 0.04;
          pointer-events: none;
          background-image: url('/img/logo_conec.png');
          background-size: contain;
          background-position: center;
          background-repeat: no-repeat;
          z-index: 0;
        }

        .vertical-register {
          position: absolute;
          right: 8mm;
          top: 80mm;
          writing-mode: vertical-rl;
          transform: rotate(180deg);
          font-size: 11px;
          font-family: 'Courier New', Courier, monospace;
          color: #333;
          letter-spacing: 2px;
          font-weight: bold;
          z-index: 20;
        }

        .data-box {
          border: 1px solid #000;
          margin-bottom: 5mm;
          position: relative;
          z-index: 10;
          background-color: transparent;
        }

        .data-box-label {
          position: absolute;
          top: -7px;
          left: 8px;
          background-color: #ffffff;
          padding: 0 6px;
          font-size: 9px;
          font-weight: bold;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: #000000;
          font-family: 'Arial', sans-serif;
        }

        .data-box-content {
          padding: 10px 12px;
          font-size: 12.5px;
          color: #111111;
          font-family: 'Arial', sans-serif;
          min-height: 20px;
        }

        .header-title-main {
          font-size: 15px;
          font-weight: bold;
          color: #000000;
          margin: 0;
          font-family: 'Times New Roman', Times, serif;
          letter-spacing: 0.5px;
        }

        .header-title-sub {
          font-size: 9.5px;
          font-weight: bold;
          color: #222222;
          margin: 2px 0 0 0;
          text-transform: uppercase;
          font-family: 'Arial', sans-serif;
        }

        .header-address {
          font-size: 8.5px;
          color: #444444;
          margin: 3px 0 0 0;
          font-family: 'Arial', sans-serif;
        }

        .doc-title-container {
          text-align: center;
          margin: 12mm 0 8mm 0;
          position: relative;
          z-index: 10;
        }

        .doc-title {
          font-size: 17px;
          font-family: 'Times New Roman', Times, serif;
          font-weight: bold;
          letter-spacing: 1.5px;
          text-transform: uppercase;
          border-bottom: 3px double #000000;
          display: inline-block;
          padding-bottom: 2px;
        }
      `}</style>

      {/* Conteúdo da Ficha */}
      <div className="print-page relative flex flex-col justify-between">
        
        {/* Marca d'água de Fundo */}
        <div className="watermark" />

        {/* Registro Vertical na Lateral Direita */}
        <div className="vertical-register">
          REGISTRO Nº {credenciamento?.numero_registro || 'PENDENTE'}
        </div>

        <div>
          {/* Cabeçalho Oficial */}
          <div className="flex items-center justify-between border-b-2 border-black pb-4 mb-4 relative z-10">
            <img 
              src="/img/logo_comieadepa.png" 
              alt="Logo COMIEADEPA" 
              className="w-[20mm] h-[20mm] object-contain"
            />
            <div className="flex-1 text-center px-4">
              <h1 className="header-title-main">CONSELHO DE EDUCAÇÃO CRISTÃ - CONEC</h1>
              <p className="header-title-sub">COMIEADEPA - CONVENÇÃO DE MINISTROS E IGREJAS EVANGÉLICAS ASSEMBLEIAS DE DEUS NO ESTADO DO PARÁ</p>
              <p className="header-address">Rod. BR-316, Km 08, s/n - Centro, Ananindeua - PA, 67113-970</p>
            </div>
            <img 
              src="/img/logo_conec.png" 
              alt="Logo CONEC" 
              className="w-[20mm] h-[20mm] object-contain"
            />
          </div>

          {/* Título do Documento */}
          <div className="doc-title-container">
            <h2 className="doc-title">Credenciamento de Instituição</h2>
          </div>

          {/* Grid de Campos em Caixas com Bordas Pretas */}
          <div className="flex flex-col gap-2 mt-4">
            
            {/* Campo: NOME */}
            <div className="data-box">
              <span className="data-box-label">Nome da Instituição</span>
              <div className="data-box-content font-bold uppercase">
                {instituicao.nome_instituicao}
              </div>
            </div>

            {/* Campo: REPRESENTANTE */}
            <div className="data-box">
              <span className="data-box-label">Representante Legal / Diretor</span>
              <div className="data-box-content">
                <span className="font-semibold uppercase">{instituicao.nome_representante}</span>
                {instituicao.cpf_representante && (
                  <span className="text-gray-600 ml-2"> (CPF: {instituicao.cpf_representante})</span>
                )}
              </div>
            </div>

            {/* Campo: ENDEREÇO */}
            <div className="data-box">
              <span className="data-box-label">Endereço Completo</span>
              <div className="data-box-content">
                {enderecoCompleto}
              </div>
            </div>

            {/* Linha Dupla: CNPJ e PERÍODO */}
            <div className="grid grid-cols-2 gap-4">
              <div className="data-box">
                <span className="data-box-label">CNPJ</span>
                <div className="data-box-content font-semibold">
                  {formatCnpj(instituicao.cnpj)}
                </div>
              </div>

              <div className="data-box">
                <span className="data-box-label">Período de Vigência</span>
                <div className="data-box-content font-semibold">
                  {dataInicioFormatada && dataFimFormatada 
                    ? `${dataInicioFormatada} a ${dataFimFormatada}` 
                    : 'Pendente'}
                </div>
              </div>
            </div>

            {/* Bloco: OBSERVAÇÕES */}
            <div className="data-box mt-2">
              <span className="data-box-label">Observações e Histórico Institucional</span>
              <div className="data-box-content text-justify leading-relaxed text-xs text-gray-800">
                <p className="mb-3">
                  Certificamos que a instituição de ensino teológico supracitada foi submetida ao processo de avaliação e credenciamento perante o Conselho de Educação Cristã (CONEC), órgão estatutário da COMIEADEPA. Diante da conformidade técnica, pedagógica e documental apresentada, esta credencial é concedida atestando sua regularidade e habilitação para a formação de ministros e promoção da educação cristã.
                </p>
                {instituicao.observacoes_internas && (
                  <p className="mt-3 pt-3 border-t border-dashed border-gray-300 font-sans">
                    <strong>Observações Adicionais:</strong> {instituicao.observacoes_internas}
                  </p>
                )}
              </div>
            </div>

          </div>
        </div>

        {/* Rodapé: Local, Data e Assinaturas */}
        <div className="mb-4">
          
          {/* Data por Extenso */}
          <div className="text-center font-serif italic text-[13px] mb-8 relative z-10">
            Belém - PA, {emissaoLonga}.
          </div>

          {/* Assinaturas Oficiais */}
          <div className="flex justify-between items-end relative z-10 px-8">
            
            {/* Bloco Assinatura 1 */}
            <div className="flex flex-col items-center w-[75mm] text-center">
              <div className="w-full border-b border-black mb-1" />
              <span className="text-[11.5px] font-bold text-black font-sans leading-tight">
                Pr. Luciano de Falconery Souza
              </span>
              <span className="text-[9.5px] text-gray-700 font-sans tracking-wider uppercase mt-0.5">
                Secretário do CONEC
              </span>
            </div>

            {/* Bloco Assinatura 2 */}
            <div className="flex flex-col items-center w-[75mm] text-center">
              <div className="w-full border-b border-black mb-1" />
              <span className="text-[11.5px] font-bold text-black font-sans leading-tight">
                Pr. Océlio Nauar de Araújo
              </span>
              <span className="text-[9.5px] text-gray-700 font-sans tracking-wider uppercase mt-0.5">
                Pastor Presidente da COMIEADEPA
              </span>
            </div>

          </div>

        </div>

      </div>
    </div>
  );
}
