'use client';

import { useEffect, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase-client';
import { CheckCircle, AlertTriangle, ShieldAlert, Award, Calendar } from 'lucide-react';

interface PublicDocumentData {
  nome_instituicao: string;
  cnpj: string;
  numero_registro: string;
  data_inicio: string;
  data_fim: string;
  status: string;
}

interface DocumentTokenRow {
  token: string;
  document_type: string;
  dados_publicos: PublicDocumentData;
  created_at: string;
}

export default function PublicValidationPage({ params }: { params: Promise<{ token: string }> }) {
  const resolvedParams = use(params);
  const router = useRouter();
  const token = resolvedParams.token;
  const supabase = createClient();

  const [docToken, setDocToken] = useState<DocumentTokenRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchTokenData = async () => {
      try {
        const { data, error: fetchErr } = await supabase
          .from('document_tokens')
          .select('*')
          .eq('token', token)
          .maybeSingle();

        if (fetchErr || !data) {
          throw new Error('Token de validação inválido ou não encontrado.');
        }

        setDocToken(data as unknown as DocumentTokenRow);
      } catch (err: any) {
        setError(err.message || 'Erro ao validar documento.');
      } finally {
        setLoading(false);
      }
    };

    if (token) fetchTokenData();
  }, [token]);

  // Mascarar CNPJ para manter privacidade
  const maskCnpj = (cnpj: string) => {
    const clean = cnpj.replace(/\D/g, '');
    if (clean.length !== 14) return cnpj;
    return `${clean.slice(0, 2)}.***.***/${clean.slice(8, 12)}-**`;
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600" />
      </div>
    );
  }

  if (error || !docToken) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 max-w-md w-full text-center shadow-lg">
          <ShieldAlert className="w-12 h-12 text-red-600 mx-auto mb-4 animate-pulse" />
          <h2 className="text-xl font-bold text-red-800 mb-2">Documento Inválido</h2>
          <p className="text-sm text-red-700 leading-relaxed mb-6">
            O código de validação consultado não pôde ser encontrado no sistema da COMIEADEPA. Certifique-se de que o QR Code está correto ou contate a secretaria.
          </p>
          <button
            onClick={() => router.push('/')}
            className="w-full py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-semibold transition"
          >
            Ir para página inicial
          </button>
        </div>
      </div>
    );
  }

  const dados = docToken.dados_publicos;
  const isDocActive = dados.status === 'ativo';

  const dataInicioFormatted = dados.data_inicio
    ? new Date(dados.data_inicio).toLocaleDateString('pt-BR')
    : '';
  const dataFimFormatted = dados.data_fim
    ? new Date(dados.data_fim).toLocaleDateString('pt-BR')
    : '';

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full overflow-hidden border border-gray-150">
        
        {/* Banner de status */}
        <div className={`p-6 text-white text-center flex flex-col items-center justify-center gap-2 ${
          isDocActive ? 'bg-green-700' : 'bg-amber-600'
        }`}>
          {isDocActive ? (
            <CheckCircle className="w-12 h-12 text-white" />
          ) : (
            <AlertTriangle className="w-12 h-12 text-white animate-bounce" />
          )}
          <h2 className="text-xl font-bold uppercase tracking-wider">
            {isDocActive ? 'Documento Autêntico e Válido' : 'Documento Expirado ou Inativo'}
          </h2>
          <p className="text-xs text-white/80 uppercase tracking-widest font-semibold">
            VALIDADO POR COMIEADEPA
          </p>
        </div>

        {/* Corpo com Informações Públicas */}
        <div className="p-8 space-y-6">
          <div className="flex items-start gap-4">
            <Award className="w-6 h-6 text-teal-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-xs text-gray-400 font-bold uppercase">Tipo de Documento</p>
              <p className="text-sm font-bold text-gray-800">
                Certificado de Credenciamento CONEC
              </p>
            </div>
          </div>

          <hr className="border-gray-100" />

          <div>
            <p className="text-xs text-gray-400 font-bold uppercase mb-1">Instituição</p>
            <p className="text-base font-bold text-gray-900 leading-snug">
              {dados.nome_instituicao}
            </p>
            <p className="text-xs text-gray-500 font-mono mt-1">
              CNPJ: {maskCnpj(dados.cnpj)}
            </p>
          </div>

          <hr className="border-gray-100" />

          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-gray-400 font-bold uppercase">Registro CONEC</p>
              <p className="text-sm font-bold text-teal-800 font-sans mt-0.5">
                {dados.numero_registro}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-400 font-bold uppercase">Status Credenciamento</p>
              <p className={`text-xs font-extrabold mt-1 uppercase ${
                isDocActive ? 'text-green-700' : 'text-amber-600'
              }`}>
                {dados.status}
              </p>
            </div>
          </div>

          <hr className="border-gray-100" />

          <div className="flex items-start gap-4">
            <Calendar className="w-5 h-5 text-gray-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-xs text-gray-400 font-bold uppercase">Período de Vigência</p>
              <p className="text-sm font-semibold text-gray-800 mt-0.5">
                {dataInicioFormatted && dataFimFormatted ? `${dataInicioFormatted} até ${dataFimFormatted}` : 'Não iniciada'}
              </p>
            </div>
          </div>
        </div>

        {/* Rodapé da validação */}
        <div className="bg-gray-50 px-8 py-4 text-center border-t border-gray-100">
          <p className="text-[10px] text-gray-450 uppercase tracking-widest font-semibold">
            Conselho de Educação Cristã — CONEC COMIEADEPA
          </p>
          <p className="text-[9px] text-gray-400 mt-0.5">
            Esta consulta valida apenas a autenticidade cadastral da instituição e a validade de sua credencial ativa.
          </p>
        </div>

      </div>
    </div>
  );
}
