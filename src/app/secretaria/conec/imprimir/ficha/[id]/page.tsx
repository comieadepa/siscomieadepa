'use client';

import { useEffect, useState, useRef, Suspense } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase-client';
import { getInstituicaoById } from '@/lib/conec-service';
import { formatCnpj } from '@/lib/mascaras';
import { Printer, ArrowLeft } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import TemplateStudioRenderer from '@/components/TemplateStudioRenderer';

function FichaContent() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const templateId = searchParams?.get('templateId') || '';
  const id = params.id as string;
  const obsRef = useRef<HTMLDivElement>(null);
  const supabase = createClient();

  const [instituicao, setInstituicao] = useState<any>(null);
  const [credenciamento, setCredenciamento] = useState<any>(null);
  const [template, setTemplate] = useState<any>(null);
  const [token, setToken] = useState<string>('');
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
          const cred = creds[0];
          setCredenciamento(cred);

          // Buscar ou criar token de validação para a ficha/termo
          const { data: existingToken } = await supabase
            .from('document_tokens')
            .select('token')
            .eq('reference_id', cred.id)
            .eq('document_type', 'conec_credenciamento')
            .maybeSingle();

          if (existingToken?.token) {
            setToken(existingToken.token);
          } else {
            const { data: newToken, error: createError } = await supabase
              .from('document_tokens')
              .insert({
                template_id: '12345678-1234-1234-1234-123456789abc',
                document_type: 'conec_credenciamento',
                reference_id: cred.id,
                dados_publicos: {
                  nome_instituicao: instData.nome_instituicao,
                  cnpj: instData.cnpj,
                  numero_registro: cred.numero_registro,
                  data_inicio: cred.data_inicio,
                  data_fim: cred.data_fim,
                  status: cred.status_credenciamento,
                },
              })
              .select('token')
              .single();

            if (!createError && newToken) {
              setToken(newToken.token);
            }
          }
        }

        // Buscar template se solicitado
        if (templateId) {
          const { data: tmpl } = await supabase
            .from('certificados_templates')
            .select('*')
            .eq('template_key', templateId)
            .maybeSingle();
          if (tmpl) setTemplate(tmpl);
        }
      } catch (err: any) {
        console.error(err);
        setError(err.message || 'Erro ao carregar dados para a ficha.');
      } finally {
        setLoading(false);
      }
    };

    if (id) fetchDados();
  }, [id, templateId]);

  useEffect(() => {
    if (!loading && obsRef.current) {
      let size = 11;
      obsRef.current.style.fontSize = `${size}px`;
      // Reduce font size if content overflows
      let attempts = 0;
      while (
        obsRef.current.scrollHeight > obsRef.current.clientHeight &&
        size > 8.5 &&
        attempts < 10
      ) {
        size -= 0.5;
        obsRef.current.style.fontSize = `${size}px`;
        attempts++;
      }
    }
  }, [instituicao, loading]);

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

  const formatObservacoes = (text: string) => {
    if (!text) return '';
    let formatted = text;
    // Highlight specific key academic cycles in observations
    formatted = formatted.replace(
      /CICLO I[–\- ]+NÍVEL BÁSICO E MÉDIO/g,
      '<strong class="text-emerald-800 block mt-1.5 mb-1 font-bold text-[10px] tracking-wide uppercase">CICLO I – NÍVEL BÁSICO E MÉDIO</strong>'
    );
    formatted = formatted.replace(
      /CICLO II[–\- ]+NÍVEL AVANÇADO \/ PLENO/g,
      '<strong class="text-emerald-800 block mt-1.5 mb-1 font-bold text-[10px] tracking-wide uppercase">CICLO II – NÍVEL AVANÇADO / PLENO</strong>'
    );

    return formatted.split('\n').map(p => p.trim()).filter(Boolean).map(paragraph => {
      if (paragraph.includes('text-emerald-800')) {
        return `<div class="mb-1">${paragraph}</div>`;
      }
      return `<p class="mb-1 text-justify leading-relaxed">${paragraph}</p>`;
    }).join('');
  };

  const dados = {
    instituicao_nome: instituicao?.nome_instituicao || '',
    nome_instituicao: instituicao?.nome_instituicao || '',
    cnpj: instituicao?.cnpj ? formatCnpj(instituicao.cnpj) : '',
    numero_registro: credenciamento?.numero_registro || '',
    data_credenciamento: dataInicioFormatada || '',
    validade: dataFimFormatada || '',
    ano_referencia: credenciamento?.ano_referencia || '',
    qr_code_validacao: token ? `${typeof window !== 'undefined' ? window.location.origin : ''}/conec/credenciamento/validar/${token}` : '',
    responsavel: instituicao?.nome_representante || '',
    nome_representante: instituicao?.nome_representante || '',
    municipio: instituicao?.cidade || '',
    cidade: instituicao?.cidade || '',
    uf: instituicao?.estado || '',
    estado: instituicao?.estado || '',
    endereco: enderecoCompleto,
    endereco_completo: enderecoCompleto,
    numero_credenciamento: credenciamento?.numero_registro || '',
    data_emissao: dataInicioFormatada || '',
    data_validade: dataFimFormatada || '',
    status: credenciamento?.status_credenciamento || '',
    observacoes: instituicao?.observacoes_internas || '',
  };

  const getMappedTemplate = () => {
    if (!template) return null;
    const tData = template.template_data || template;
    const rawElements = Array.isArray(tData.elementos) ? tData.elementos : [];

    const parsePlaceholderText = (text: string) => {
      if (!text) return '';
      let res = text;
      Object.entries(dados).forEach(([key, val]) => {
        res = res.split(`{${key}}`).join(String(val ?? ''));
        res = res.split(`{{${key}}}`).join(String(val ?? ''));
      });
      return res;
    };

    const mappedElements = rawElements
      .filter((el: any) => el.visivel !== false)
      .map((el: any) => {
        let tipoFinal = 'text_fixed';
        if (el.tipo === 'qrcode') {
          tipoFinal = 'qrcode';
        } else if (el.tipo === 'imagem' || el.tipo === 'image') {
          tipoFinal = 'image';
        } else if (el.tipo === 'logo') {
          tipoFinal = 'logo';
        } else if (el.tipo === 'signature' || el.tipo === 'assinatura') {
          tipoFinal = 'signature';
        }

        return {
          id: el.id,
          tipo: tipoFinal,
          imagemUrl: el.imagemUrl || el.url || el.conteudo || '',
          x: (el.x / 595) * 100,
          y: (el.y / 840) * 100,
          width: (el.largura / 595) * 100,
          height: (el.altura / 840) * 100,
          conteudo: el.tipo === 'qrcode' ? '' : parsePlaceholderText(el.texto || ''),
          styles: {
            fontSize: el.fontSize ? `${el.fontSize}px` : '14px',
            fontFamily: el.fonte || 'sans-serif',
            fontWeight: el.negrito ? 'bold' : 'normal',
            fontStyle: el.italico ? 'italic' : 'normal',
            textAlign: el.alinhamento || 'left',
            color: el.cor || '#000000',
          }
        };
      });

    return {
      background_url: tData.backgroundUrl || '',
      largura: 595,
      altura: 840,
      orientacao: 'portrait' as 'portrait',
      elementos: mappedElements
    };
  };

  const finalTemplate = getMappedTemplate();

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
            padding: 22mm 22mm 15mm 22mm !important;
            margin: 0 !important;
            border: 0 !important;
            box-shadow: none !important;
            border-radius: 0 !important;
            box-sizing: border-box !important;
            position: relative !important;
            page-break-after: avoid !important;
            page-break-before: avoid !important;
            overflow: hidden !important;
            background-image: url('/img/bg_termo.jpg') !important;
            background-size: 100% 100% !important;
            background-repeat: no-repeat !important;
            display: flex !important;
            flex-direction: column !important;
            justify-content: space-between !important;
          }
          .print-container {
            width: 210mm !important;
            height: 297mm !important;
            background-size: 100% 100% !important;
            border: 0 !important;
            box-shadow: none !important;
            border-radius: 0 !important;
            margin: 0 !important;
            transform: none !important;
          }
        }

        .print-page {
          width: 210mm;
          height: 297mm;
          padding: 22mm 22mm 15mm 22mm;
          background-image: url('/img/bg_termo.jpg');
          background-size: 100% 100%;
          background-repeat: no-repeat;
          background-color: #ffffff;
          border: 1px solid #ccc;
          box-shadow: 0 4px 15px rgba(0,0,0,0.1);
          box-sizing: border-box;
          position: relative;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
        }

        .watermark {
          display: none;
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
          border: 1.2px solid #b89353;
          border-radius: 5px;
          margin-bottom: 3.5mm;
          position: relative;
          z-index: 10;
          background-color: rgba(255, 255, 255, 0.75);
          padding: 6px 12px;
          box-sizing: border-box;
          box-shadow: 0 1px 3px rgba(0,0,0,0.03);
        }

        .observations-data-box {
          border: 1.2px solid #b89353;
          border-radius: 5px;
          margin-bottom: 3.5mm;
          position: relative;
          z-index: 10;
          background-color: rgba(255, 255, 255, 0.8);
          padding: 10px 14px;
          box-sizing: border-box;
          box-shadow: 0 1px 3px rgba(0,0,0,0.03);
        }

        .data-box-label {
          display: block;
          font-size: 8px;
          font-weight: bold;
          text-transform: uppercase;
          letter-spacing: 0.8px;
          color: #8a6d3b;
          font-family: 'Arial', sans-serif;
          margin-bottom: 1.5px;
        }

        .data-box-content {
          font-size: 11.5px;
          color: #1a202c;
          font-family: 'Arial', sans-serif;
          line-height: 1.35;
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
      {finalTemplate ? (
        <TemplateStudioRenderer
          template={finalTemplate}
          dados={dados}
          validationToken={token}
        />
      ) : (
        <div className="print-container print-page relative flex flex-col justify-between h-[297mm]">
        
        {/* Marca d'água de Fundo */}
        <div className="watermark" />

        {/* Registro Vertical na Lateral Direita */}
        <div className="vertical-register">
          REGISTRO Nº {credenciamento?.numero_registro || 'PENDENTE'}
        </div>

        {/* Conteúdo Principal Superior */}
        <div className="flex-grow flex flex-col justify-start">
          {/* Cabeçalho Oficial */}
          <div className="flex items-center justify-between border-b-2 border-black pb-3 mb-2 relative z-10">
            <img 
              src="/img/logo_comieadepa.png" 
              alt="Logo COMIEADEPA" 
              className="w-[18mm] h-[18mm] object-contain"
            />
            <div className="flex-1 text-center px-4">
              <h1 className="header-title-main text-[14px]">CONSELHO DE EDUCAÇÃO CRISTÃ - CONEC</h1>
              <p className="header-title-sub text-[8.5px]">COMIEADEPA - CONVENÇÃO DE MINISTROS E IGREJAS EVANGÉLICAS ASSEMBLEIAS DE DEUS NO ESTADO DO PARÁ</p>
              <p className="header-address text-[7.5px]">Rod. BR-316, Km 08, s/n - Centro, Ananindeua - PA, 67113-970</p>
            </div>
            <img 
              src="/img/logo_conec.png" 
              alt="Logo CONEC" 
              className="w-[18mm] h-[18mm] object-contain"
            />
          </div>

          {/* Título do Documento e Registro em Destaque */}
          <div className="doc-title-container flex flex-col items-center mb-2">
            <h2 className="doc-title text-[15px]">Credenciamento de Instituição</h2>
            <div className="mt-1.5 text-xs font-bold text-gray-800 tracking-wider">
              REGISTRO CONEC Nº <span className="text-sm text-black underline decoration-2 font-mono font-bold">{credenciamento?.numero_registro || 'PENDENTE'}</span>
            </div>
          </div>

          {/* Selo Discreto */}
          <div className="absolute top-[26mm] right-[20mm] border-2 border-emerald-600 text-emerald-600 px-3 py-1 text-[9px] font-bold tracking-widest rounded uppercase select-none opacity-80 print:opacity-100 rotate-12 z-20">
            CREDENCIADO
          </div>

          {/* Grid de Campos em Caixas com Bordas Pretas */}
          <div className="flex flex-col gap-1.5 mt-2">
            
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
            <div className="grid grid-cols-2 gap-3">
              <div className="data-box">
                <span className="data-box-label">CNPJ</span>
                <div className="data-box-content font-semibold">
                  {formatCnpj(instituicao.cnpj)}
                </div>
              </div>

              <div className="data-box">
                <span className="data-box-label">Período de Vigência / Validade</span>
                <div className="data-box-content font-semibold text-xs flex flex-col gap-0.5">
                  <div><strong>Emissão:</strong> {dataInicioFormatada || '—'}</div>
                  {dataFimFormatada && (
                    <div><strong>Validade:</strong> {dataFimFormatada}</div>
                  )}
                </div>
              </div>
            </div>

            {/* Bloco: OBSERVAÇÕES com altura controlada e auto-scaling de fonte */}
            <div className="observations-data-box mt-1 h-[42mm] max-h-[42mm] overflow-hidden relative">
              <span className="data-box-label">Observações e Histórico Institucional</span>
              <div 
                ref={obsRef}
                className="data-box-content text-justify leading-relaxed text-gray-800 transition-all duration-200"
                style={{ fontSize: '11px', height: '100%', overflow: 'hidden', padding: '2px 0' }}
              >
                <div className="mb-2 text-[10.5px] leading-relaxed">
                  Certificamos que a instituição de ensino teológico supracitada foi submetida ao processo de avaliação e credenciamento perante o Conselho de Educação Cristã (CONEC), órgão estatutário da COMIEADEPA. Diante da conformidade técnica, pedagógica e documental apresentada, esta credencial é concedida atestando sua regularidade e habilitação para a formação de ministros e promoção da educação cristã.
                </div>
                {instituicao.observacoes_internas && (
                  <div 
                    className="mt-2 pt-2 border-t border-dashed border-gray-300 font-sans text-[10px]"
                    dangerouslySetInnerHTML={{ __html: formatObservacoes(instituicao.observacoes_internas) }}
                  />
                )}
              </div>
            </div>

          </div>
        </div>

        {/* Rodapé: Local, Data e Assinaturas (Espaço 100% isolado no rodapé) */}
        <div className="mt-auto mb-6 relative z-10 w-full">
          
          {/* Data por Extenso */}
          <div className="text-center font-serif italic text-[13px] mb-6 relative z-10">
            Belém - PA, {emissaoLonga}.
          </div>

          {/* Assinaturas Oficiais */}
          <div className="flex justify-between items-end relative z-10 px-4">
            
            {/* Bloco Assinatura 1: Secretário */}
            <div className="flex flex-col items-center w-[65mm] text-center">
              <div className="h-[15mm] flex items-end justify-center mb-1">
                <img 
                  src="/img/pr_assis.png" 
                  alt="Assinatura Pr. Francisco de Assis" 
                  className="max-h-[14mm] object-contain"
                />
              </div>
              <div className="w-full border-b border-black mb-1" />
              <span className="text-[10px] font-bold text-black font-sans leading-tight">
                Pr. Francisco de Assis da Silva Alcântara
              </span>
              <span className="text-[8px] text-gray-700 font-sans tracking-wider uppercase mt-0.5">
                Secretário do CONEC
              </span>
            </div>

            {/* QR Code de Validação no Centro */}
            {token && (
              <div className="flex flex-col items-center justify-center mb-1 max-w-[48mm] text-center">
                <div className="p-1 bg-white border border-gray-250 rounded">
                  <QRCodeSVG 
                    value={`${typeof window !== 'undefined' ? window.location.origin : ''}/conec/credenciamento/validar/${token}`} 
                    size={65} 
                    level="M" 
                  />
                </div>
                <span className="text-[5.5px] text-gray-500 font-sans mt-1 leading-normal uppercase font-semibold">
                  Leia o QR Code para validar a autenticidade deste credenciamento.
                </span>
              </div>
            )}

            {/* Bloco Assinatura 2: Presidente CONEC */}
            <div className="flex flex-col items-center w-[65mm] text-center">
              <div className="h-[15mm] flex items-end justify-center mb-1">
                <img 
                  src="/img/pr_jesanias.png" 
                  alt="Assinatura Pr. Jesanias Pereira" 
                  className="max-h-[14mm] object-contain"
                />
              </div>
              <div className="w-full border-b border-black mb-1" />
              <span className="text-[10px] font-bold text-black font-sans leading-tight">
                Pr. Jesanias Pereira Calderaro
              </span>
              <span className="text-[8px] text-gray-700 font-sans tracking-wider uppercase mt-0.5">
                Presidente da CONEC
              </span>
            </div>

          </div>

        </div>

      </div>
      )}
    </div>
  );
}

export default function ImprimirFichaPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center bg-gray-50"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600" /></div>}>
      <FichaContent />
    </Suspense>
  );
}
