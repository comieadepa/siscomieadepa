'use client';

import { useEffect, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase-client';
import { CheckCircle, AlertTriangle, ShieldAlert, Calendar, Landmark, User, MapPin } from 'lucide-react';
import { formatCnpj } from '@/lib/mascaras';

interface ValidationData {
  nome_instituicao: string;
  cnpj: string;
  nome_representante: string;
  cidade: string;
  estado: string;
  numero_registro: string;
  data_emissao: string;
  data_fim: string;
  status: string;
}

export default function ConecValidationPage({ params }: { params: Promise<{ token: string }> }) {
  const resolvedParams = use(params);
  const router = useRouter();
  const token = resolvedParams.token;
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dados, setDados] = useState<ValidationData | null>(null);

  useEffect(() => {
    const validateToken = async () => {
      try {
        // 1. Buscar o token na tabela document_tokens
        const { data: docToken, error: tokenError } = await supabase
          .from('document_tokens')
          .select('reference_id, document_type, dados_publicos')
          .eq('token', token)
          .maybeSingle();

        if (tokenError || !docToken) {
          throw new Error('Credenciamento não pôde ser validado.');
        }

        // 2. Buscar o credenciamento para obter os dados mais atualizados e consistentes
        const { data: cred, error: credError } = await supabase
          .from('conec_credenciamentos')
          .select('*')
          .eq('id', docToken.reference_id)
          .is('deleted_at', null)
          .maybeSingle();

        if (credError || !cred) {
          throw new Error('Credenciamento não pôde ser validado.');
        }

        // 3. Buscar a instituição
        const { data: inst, error: instError } = await supabase
          .from('conec_instituicoes')
          .select('*')
          .eq('id', cred.instituicao_id)
          .is('deleted_at', null)
          .maybeSingle();

        if (instError || !inst) {
          throw new Error('Credenciamento não pôde ser validado.');
        }

        setDados({
          nome_instituicao: inst.nome_instituicao,
          cnpj: inst.cnpj,
          nome_representante: inst.nome_representante,
          cidade: inst.cidade,
          estado: inst.estado,
          numero_registro: cred.numero_registro,
          data_emissao: cred.data_emissao || cred.data_inicio,
          data_fim: cred.data_fim,
          status: cred.status_credenciamento,
        });

      } catch (err: any) {
        console.error(err);
        setError(err.message || 'Credenciamento não pôde ser validado.');
      } finally {
        setLoading(false);
      }
    };

    if (token) validateToken();
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600" />
      </div>
    );
  }

  if (error || !dados) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="bg-red-50 border border-red-200 rounded-2xl p-8 max-w-md w-full text-center shadow-xl">
          <ShieldAlert className="w-16 h-16 text-red-600 mx-auto mb-4 animate-pulse" />
          <h2 className="text-xl font-bold text-red-800 mb-2">Credenciamento Inválido</h2>
          <p className="text-sm text-red-700 leading-relaxed mb-6">
            O credenciamento consultado não pôde ser validado no sistema da COMIEADEPA. Certifique-se de que o QR Code está correto ou contate a secretaria.
          </p>
          <button
            onClick={() => router.push('/')}
            className="w-full py-3 bg-red-600 hover:bg-red-700 text-white rounded-xl text-sm font-semibold transition"
          >
            Ir para a página inicial
          </button>
        </div>
      </div>
    );
  }

  const isDocActive = dados.status === 'ativo';
  const dataEmissaoFormatted = dados.data_emissao
    ? new Date(dados.data_emissao).toLocaleDateString('pt-BR')
    : '—';
  const dataFimFormatted = dados.data_fim
    ? new Date(dados.data_fim).toLocaleDateString('pt-BR')
    : '—';

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden border border-gray-200">
        
        {/* Banner de Status */}
        <div className={`p-8 text-white text-center flex flex-col items-center justify-center gap-3 ${
          isDocActive ? 'bg-emerald-600' : 'bg-amber-600'
        }`}>
          {isDocActive ? (
            <CheckCircle className="w-16 h-16 text-white" />
          ) : (
            <AlertTriangle className="w-16 h-16 text-white animate-bounce" />
          )}
          <div>
            <h2 className="text-2xl font-bold uppercase tracking-wider">
              {isDocActive ? 'Credenciamento Válido' : 'Credenciamento Expirado/Inativo'}
            </h2>
            <p className="text-[10px] text-white/90 uppercase tracking-widest font-semibold mt-1">
              AUTENTICADO VIA CONEC COMIEADEPA
            </p>
          </div>
        </div>

        {/* Corpo com Informações Detalhadas */}
        <div className="p-8 space-y-6">
          
          {/* Nome da Instituição */}
          <div className="flex items-start gap-4">
            <Landmark className="w-6 h-6 text-emerald-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-[10px] text-gray-400 font-bold uppercase">Instituição de Ensino</p>
              <p className="text-lg font-bold text-gray-900 leading-snug">
                {dados.nome_instituicao}
              </p>
              <p className="text-xs text-gray-500 font-mono mt-1">
                CNPJ: {formatCnpj(dados.cnpj)}
              </p>
            </div>
          </div>

          <hr className="border-gray-100" />

          {/* Responsável / Diretor */}
          <div className="flex items-start gap-4">
            <User className="w-6 h-6 text-gray-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-[10px] text-gray-400 font-bold uppercase">Responsável / Diretor</p>
              <p className="text-sm font-bold text-gray-800">
                {dados.nome_representante || 'Não informado'}
              </p>
            </div>
          </div>

          <hr className="border-gray-100" />

          {/* Município / UF */}
          <div className="flex items-start gap-4">
            <MapPin className="w-6 h-6 text-gray-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-[10px] text-gray-400 font-bold uppercase">Localização</p>
              <p className="text-sm font-bold text-gray-800">
                {dados.cidade ? `${dados.cidade} - ${dados.estado || ''}` : 'Não informada'}
              </p>
            </div>
          </div>

          <hr className="border-gray-100" />

          {/* Registro e Status */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-[10px] text-gray-400 font-bold uppercase">Registro CONEC</p>
              <p className="text-sm font-bold text-emerald-800 mt-0.5">
                {dados.numero_registro}
              </p>
            </div>
            <div>
              <p className="text-[10px] text-gray-400 font-bold uppercase">Status Atual</p>
              <p className={`text-xs font-extrabold mt-1 uppercase ${
                isDocActive ? 'text-emerald-600' : 'text-amber-600'
              }`}>
                {dados.status}
              </p>
            </div>
          </div>

          <hr className="border-gray-100" />

          {/* Vigência */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-[10px] text-gray-400 font-bold uppercase">Data de Emissão</p>
              <div className="flex items-center gap-1.5 mt-1">
                <Calendar className="w-4 h-4 text-gray-400" />
                <span className="text-sm font-semibold text-gray-800">{dataEmissaoFormatted}</span>
              </div>
            </div>
            <div>
              <p className="text-[10px] text-gray-400 font-bold uppercase">Data de Validade</p>
              <div className="flex items-center gap-1.5 mt-1">
                <Calendar className="w-4 h-4 text-gray-400" />
                <span className="text-sm font-semibold text-gray-800">{dataFimFormatted}</span>
              </div>
            </div>
          </div>

        </div>

        {/* Rodapé da Validação */}
        <div className="bg-gray-50 px-8 py-6 text-center border-t border-gray-150">
          <p className="text-[10px] text-gray-500 uppercase tracking-widest font-semibold">
            Conselho de Educação Cristã — CONEC COMIEADEPA
          </p>
          <p className="text-[9px] text-gray-400 mt-1">
            Esta consulta valida a autenticidade pedagógica e documental da credencial do estabelecimento de ensino teológico perante os órgãos oficiais da convenção.
          </p>
        </div>

      </div>
    </div>
  );
}
