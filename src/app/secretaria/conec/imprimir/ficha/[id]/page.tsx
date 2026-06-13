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

  const dataEmissaoFormatada = credenciamento?.data_emissao
    ? new Date(credenciamento.data_emissao).toLocaleDateString('pt-BR')
    : new Date().toLocaleDateString('pt-BR');

  const dataInicioFormatada = credenciamento?.data_inicio
    ? new Date(credenciamento.data_inicio).toLocaleDateString('pt-BR')
    : '';

  const dataFimFormatada = credenciamento?.data_fim
    ? new Date(credenciamento.data_fim).toLocaleDateString('pt-BR')
    : '';

  return (
    <div className="min-h-screen bg-gray-100 py-8 px-4 print:bg-white print:p-0 print:min-h-0">
      {/* Barra de Ações (Oculta na impressão) */}
      <div className="max-w-3xl mx-auto mb-6 flex items-center justify-between print:hidden">
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

      {/* Conteúdo da Ficha */}
      <div className="max-w-3xl mx-auto bg-white border border-gray-300 rounded-lg shadow-lg p-8 print:shadow-none print:border-0 print:p-0 print:max-w-full">
        
        {/* Cabeçalho */}
        <div className="text-center border-b border-gray-300 pb-6 mb-6">
          <div className="text-3xl mb-2">🎓</div>
          <h1 className="text-2xl font-bold uppercase tracking-wider text-gray-800">Ficha de Credenciamento</h1>
          <p className="text-sm text-gray-500 font-semibold tracking-wide mt-1">
            CONSELHO DE EDUCAÇÃO CRISTÃ — CONEC
          </p>
          <p className="text-xs text-gray-400 uppercase tracking-widest mt-0.5">
            COMIEADEPA
          </p>
        </div>

        {/* Informações da Instituição */}
        <div className="mb-6">
          <h2 className="text-sm font-bold text-teal-700 uppercase tracking-wider border-b border-teal-100 pb-1 mb-3">
            Dados da Instituição
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase">Nome da Instituição</label>
              <div className="text-sm font-bold text-gray-800">{instituicao.nome_instituicao}</div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase">CNPJ</label>
              <div className="text-sm font-semibold text-gray-700">{formatCnpj(instituicao.cnpj)}</div>
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-semibold text-gray-400 uppercase">Endereço</label>
              <div className="text-sm text-gray-700">
                {[
                  instituicao.logradouro && `${instituicao.logradouro}, ${instituicao.numero || 'S/N'}${instituicao.complemento ? ` - ${instituicao.complemento}` : ''}`,
                  instituicao.bairro,
                  instituicao.cidade && `${instituicao.cidade} - ${instituicao.estado || ''}`,
                  instituicao.cep && `CEP: ${instituicao.cep}`
                ].filter(Boolean).join(', ') || 'Não informado'}
              </div>
            </div>
          </div>
        </div>

        {/* Informações do Representante */}
        <div className="mb-6">
          <h2 className="text-sm font-bold text-teal-700 uppercase tracking-wider border-b border-teal-100 pb-1 mb-3">
            Representante Legal
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase">Nome do Representante</label>
              <div className="text-sm font-bold text-gray-800">{instituicao.nome_representante}</div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase">CPF</label>
              <div className="text-sm font-semibold text-gray-700">{instituicao.cpf_representante}</div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase">E-mail</label>
              <div className="text-sm text-gray-700">{instituicao.email_representante}</div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase">Contatos</label>
              <div className="text-sm text-gray-700">
                {[instituicao.telefone_representante, instituicao.whatsapp && `WhatsApp: ${instituicao.whatsapp}`].filter(Boolean).join(' / ') || 'Não informado'}
              </div>
            </div>
          </div>
        </div>

        {/* Detalhes do Credenciamento */}
        <div className="mb-6">
          <h2 className="text-sm font-bold text-teal-700 uppercase tracking-wider border-b border-teal-100 pb-1 mb-3">
            Período & Registro de Credenciamento
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase">Registro CONEC</label>
              <div className="text-sm font-bold text-teal-800">{credenciamento?.numero_registro || 'Pendente'}</div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase">Vigência</label>
              <div className="text-sm font-semibold text-gray-700">
                {dataInicioFormatada && dataFimFormatada ? `${dataInicioFormatada} até ${dataFimFormatada}` : 'Não iniciada'}
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase">Data de Emissão</label>
              <div className="text-sm font-semibold text-gray-700">{dataEmissaoFormatada}</div>
            </div>
          </div>
        </div>

        {/* Observações */}
        <div className="mb-12">
          <h2 className="text-sm font-bold text-teal-700 uppercase tracking-wider border-b border-teal-100 pb-1 mb-3">
            Observações Internas
          </h2>
          <div className="p-3 bg-gray-50 border border-gray-200 rounded text-sm text-gray-600 min-h-[80px] print:bg-white">
            {instituicao.observacoes_internas || 'Nenhuma observação registrada.'}
          </div>
        </div>

        {/* Assinaturas */}
        <div className="mt-16 grid grid-cols-2 gap-8 text-center pt-8 border-t border-gray-200">
          <div className="flex flex-col items-center">
            <div className="w-48 border-b border-gray-400 mb-2"></div>
            <span className="text-xs font-bold uppercase text-gray-700">Secretário do CONEC</span>
            <span className="text-[10px] text-gray-400 uppercase tracking-wide">Assinatura</span>
          </div>
          <div className="flex flex-col items-center">
            <div className="w-48 border-b border-gray-400 mb-2"></div>
            <span className="text-xs font-bold uppercase text-gray-700">Presidente da COMIEADEPA</span>
            <span className="text-[10px] text-gray-400 uppercase tracking-wide">Assinatura</span>
          </div>
        </div>

      </div>
    </div>
  );
}
