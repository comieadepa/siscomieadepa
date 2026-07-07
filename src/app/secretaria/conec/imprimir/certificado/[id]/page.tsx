'use client';

import { useEffect, useState, Suspense } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase-client';
import { formatCnpj } from '@/lib/mascaras';
import { Printer, ArrowLeft, Lock } from 'lucide-react';
import TemplateStudioRenderer from '@/components/TemplateStudioRenderer';

function CertificadoContent() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();

  const id = params.id as string; // credenciamentoId
  const debug = searchParams?.get('debug') === '1';
  const supabase = createClient();

  const [credenciamento, setCredenciamento] = useState<any>(null);
  const [instituicao, setInstituicao] = useState<any>(null);
  const [template, setTemplate] = useState<any>(null);
  const [token, setToken] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchDados = async () => {
      try {
        // 1. Buscar o credenciamento
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

        // 2. Buscar a instituição
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

        // 3. Buscar ou criar token de validação para o certificado
        const { data: existingToken } = await supabase
          .from('document_tokens')
          .select('token')
          .eq('reference_id', id)
          .eq('document_type', 'conec_credenciamento')
          .maybeSingle();

        let currentToken = '';

        if (existingToken?.token) {
          currentToken = existingToken.token;
          setToken(currentToken);
        } else {
          // Criar novo token
          const dadosPublicos = {
            nome_instituicao: inst.nome_instituicao,
            cnpj: inst.cnpj,
            numero_registro: cred.numero_registro,
            data_inicio: cred.data_inicio,
            data_fim: cred.data_fim,
            status: cred.status_credenciamento,
          };

          const { data: newToken, error: createError } = await supabase
            .from('document_tokens')
            .insert({
              template_id: '12345678-1234-1234-1234-123456789abc', // ID do seed padrão
              document_type: 'conec_credenciamento',
              reference_id: id,
              dados_publicos: dadosPublicos,
            })
            .select('token')
            .single();

          if (!createError && newToken) {
            currentToken = newToken.token;
            setToken(currentToken);
          }
        }

        // 4. Buscar o template do visual editor
        const requestedTemplateId = searchParams?.get('templateId') || '';
        let loadedTemplate = null;

        if (requestedTemplateId) {
          const { data: tmpl } = await supabase
            .from('certificados_templates')
            .select('*')
            .eq('template_key', requestedTemplateId)
            .maybeSingle();
          if (tmpl) loadedTemplate = tmpl;
        }

        if (!loadedTemplate) {
          const { data: templatesList } = await supabase
            .from('certificados_templates')
            .select('*')
            .or('name.ilike.conec,template_key.ilike.conec');

          if (templatesList && templatesList.length > 0) {
            const sorted = [...templatesList].sort((a, b) => {
              if (a.is_active && !b.is_active) return -1;
              if (!a.is_active && b.is_active) return 1;
              return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
            });
            loadedTemplate = sorted[0];
          }
        }

        if (loadedTemplate) {
          setTemplate(loadedTemplate);
        } else {
          // Fallback para estrutura interna local se não existir modelo no banco
          setTemplate({
            background_url: '/img/cert_credenciamento.jpg',
            largura: 1123,
            altura: 794,
            orientacao: 'landscape',
            elementos: [
              { id: 'nome_instituicao', tipo: 'text_dynamic', placeholder: 'nome_instituicao', x: 15, y: 49, width: 70, height: 4.5, styles: { fontSize: '26px', fontWeight: 'bold', textAlign: 'center' } },
              { id: 'cnpj', tipo: 'text_dynamic', placeholder: 'cnpj', x: 35, y: 54, width: 30, height: 3, styles: { fontSize: '14px', textAlign: 'center' } },
              { id: 'numero_registro', tipo: 'text_dynamic', placeholder: 'numero_registro', x: 15, y: 80, width: 20, height: 3, styles: { fontSize: '14px', fontWeight: 'bold', textAlign: 'left' } },
              { id: 'data_credenciamento', tipo: 'text_dynamic', placeholder: 'data_credenciamento', x: 15, y: 83, width: 25, height: 3, styles: { fontSize: '14px', fontWeight: 'bold', textAlign: 'left' } },
              { id: 'validade', tipo: 'text_dynamic', placeholder: 'validade', x: 15, y: 86, width: 20, height: 3, styles: { fontSize: '14px', fontWeight: 'bold', textAlign: 'left' } },
              { id: 'qr_code_validacao', tipo: 'qrcode', placeholder: 'qr_code_validacao', x: 78, y: 76, width: 10, height: 10 }
            ]
          });
        }
      } catch (err: any) {
        console.error(err);
        setError(err.message || 'Erro ao carregar dados do certificado.');
      } finally {
        setLoading(false);
      }
    };

    if (id) fetchDados();
  }, [id]);

  // Regra de Bloqueio Obrigatória
  const isLocked = !credenciamento ||
                   credenciamento.status_pagamento !== 'pago' ||
                   credenciamento.status_credenciamento !== 'ativo';

  // Datas Formatadas
  const dataEmissaoFormatada = credenciamento?.data_emissao
    ? new Date(credenciamento.data_emissao).toLocaleDateString('pt-BR')
    : credenciamento?.data_inicio
    ? new Date(credenciamento.data_inicio).toLocaleDateString('pt-BR')
    : '';

  const dataFimFormatada = credenciamento?.data_fim ? new Date(credenciamento.data_fim).toLocaleDateString('pt-BR') : '';

  const enderecoCompleto = [
    instituicao?.logradouro && `${instituicao.logradouro}, ${instituicao.numero || 'S/N'}${instituicao.complemento ? ` - ${instituicao.complemento}` : ''}`,
    instituicao?.bairro,
    instituicao?.cidade && `${instituicao.cidade} - ${instituicao.estado || ''}`,
    instituicao?.cep && `CEP: ${instituicao.cep}`
  ].filter(Boolean).join(', ') || 'Não informado';

  // Dados dinâmicos mapeados para os placeholders do template
  const dados = {
    instituicao_nome: instituicao?.nome_instituicao || '',
    nome_instituicao: instituicao?.nome_instituicao || '',
    cnpj: instituicao?.cnpj ? formatCnpj(instituicao.cnpj) : '',
    numero_registro: credenciamento?.numero_registro || '',
    data_credenciamento: dataEmissaoFormatada,
    validade: dataFimFormatada,
    ano_referencia: credenciamento?.ano_referencia || '',
    qr_code_validacao: token ? `${typeof window !== 'undefined' ? window.location.origin : ''}/conec/credenciamento/validar/${token}` : '',
    
    // Novos placeholders para compatibilidade total com o Editor de Modelos CONEC
    responsavel: instituicao?.nome_representante || '',
    nome_representante: instituicao?.nome_representante || '',
    municipio: instituicao?.cidade || '',
    cidade: instituicao?.cidade || '',
    uf: instituicao?.estado || '',
    estado: instituicao?.estado || '',
    endereco: enderecoCompleto,
    endereco_completo: enderecoCompleto,
    numero_credenciamento: credenciamento?.numero_registro || '',
    data_emissao: dataEmissaoFormatada,
    data_validade: dataFimFormatada,
    status: credenciamento?.status_credenciamento || '',
    observacoes: instituicao?.observacoes_internas || '',
  };

  // Mapeia e normaliza o template do visual editor para o formato do renderizador
  const getMappedTemplate = () => {
    if (!template) return null;
    
    // Se for o fallback local (que tem background_url em vez de backgroundUrl)
    if (template.background_url && !template.template_data) {
      return template;
    }

    const tData = template.template_data || template;
    const rawElements = Array.isArray(tData.elementos)
      ? tData.elementos
      : (typeof tData.elementos === 'string' ? JSON.parse(tData.elementos) : []);

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

        const baseWidth = tData.largura || (tData.orientacao === 'portrait' ? 794 : 1123);
        const baseHeight = tData.altura || (tData.orientacao === 'portrait' ? 1123 : 794);

        return {
          id: el.id,
          tipo: tipoFinal,
          imagemUrl: el.imagemUrl || el.url || el.conteudo || '',
          x: (el.x / baseWidth) * 100,
          y: (el.y / baseHeight) * 100,
          width: (el.largura / baseWidth) * 100,
          height: (el.altura / baseHeight) * 100,
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
      largura: tData.largura || (tData.orientacao === 'portrait' ? 794 : 1123),
      altura: tData.altura || (tData.orientacao === 'portrait' ? 1123 : 794),
      orientacao: tData.orientacao || 'landscape',
      elementos: mappedElements
    };
  };

  const finalTemplate = getMappedTemplate();

  useEffect(() => {
    if (!loading && finalTemplate && !error && !isLocked) {
      const timer = setTimeout(() => {
        window.print();
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [loading, finalTemplate, error, isLocked]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600" />
      </div>
    );
  }

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
            width: 297mm !important;
            height: 210mm !important;
            background-size: 100% 100% !important;
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

      {/* Renderização do Certificado via Template Studio */}
      {finalTemplate && (
        <TemplateStudioRenderer
          template={finalTemplate}
          dados={dados}
          validationToken={token}
          debug={debug}
        />
      )}
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
