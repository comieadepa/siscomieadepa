'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import { createClient } from '@/lib/supabase-client';
import { createInstituicao, getInstituicaoById, updateInstituicao, type InstitutionInput } from '@/lib/conec-service';
import { formatCpf, formatPhone, formatCnpj } from '@/lib/mascaras';

const UF_OPTIONS = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];

function CadastroForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const id = searchParams?.get('id');
  const supabase = createClient();

  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [erro, setErro] = useState('');
  const [sucesso, setSucesso] = useState('');

  const [formData, setFormData] = useState<InstitutionInput>({
    nome_instituicao: '',
    cnpj: '',
    nome_representante: '',
    cpf_representante: '',
    email_representante: '',
    telefone_representante: '',
    whatsapp: '',
    cep: '',
    logradouro: '',
    numero: '',
    complemento: '',
    bairro: '',
    cidade: '',
    estado: '',
    status: 'ativo',
    observacoes_internas: '',
    asaas_customer_id: ''
  });

  useEffect(() => {
    if (!id) return;
    const loadData = async () => {
      setFetching(true);
      setErro('');
      try {
        const data = await getInstituicaoById(supabase, id);
        setFormData({
          nome_instituicao: data.nome_instituicao || '',
          cnpj: data.cnpj || '',
          nome_representante: data.nome_representante || '',
          cpf_representante: data.cpf_representante || '',
          email_representante: data.email_representante || '',
          telefone_representante: data.telefone_representante || '',
          whatsapp: data.whatsapp || '',
          cep: data.cep || '',
          logradouro: data.logradouro || '',
          numero: data.numero || '',
          complemento: data.complemento || '',
          bairro: data.bairro || '',
          cidade: data.cidade || '',
          estado: data.estado || '',
          status: data.status || 'ativo',
          observacoes_internas: data.observacoes_internas || '',
          asaas_customer_id: data.asaas_customer_id || ''
        });
      } catch (err: any) {
        setErro(err.message || 'Erro ao carregar dados da instituição.');
      } finally {
        setFetching(false);
      }
    };
    loadData();
  }, [id]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleCnpjChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData((prev) => ({ ...prev, cnpj: formatCnpj(e.target.value) }));
  };

  const handleCpfChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData((prev) => ({ ...prev, cpf_representante: formatCpf(e.target.value) }));
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name } = e.target;
    setFormData((prev) => ({ ...prev, [name]: formatPhone(e.target.value) }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro('');
    setSucesso('');

    if (!formData.nome_instituicao || !formData.cnpj || !formData.nome_representante || !formData.cpf_representante || !formData.email_representante) {
      setErro('Por favor, preencha todos os campos obrigatórios (*).');
      return;
    }

    setLoading(true);
    try {
      if (id) {
        await updateInstituicao(supabase, id, formData);
        setSucesso('Instituição atualizada com sucesso!');
      } else {
        await createInstituicao(supabase, formData);
        setSucesso('Instituição cadastrada com sucesso!');
      }
      setTimeout(() => router.push('/secretaria/conec'), 1200);
    } catch (err: any) {
      setErro(err.message || 'Erro ao salvar instituição.');
    } finally {
      setLoading(false);
    }
  };

  if (fetching) {
    return <div className="p-8 text-gray-500">Carregando dados da instituição...</div>;
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Cabeçalho */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <span className="text-3xl">🏫</span>
          <h1 className="text-2xl font-bold text-gray-800">
            {id ? 'Editar Instituição' : 'Cadastrar Nova Instituição'}
          </h1>
        </div>
        <p className="text-gray-600 text-sm">CONEC — Conselho de Educação Cristã da COMIEADEPA</p>
      </div>

      <form onSubmit={handleSubmit}>

        {/* SEÇÃO 1: DADOS DA INSTITUIÇÃO */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
            <span>🏛️</span> Dados da Instituição de Ensino
          </h2>

          <div className="border border-gray-200 rounded-lg p-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Nome da Instituição <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  name="nome_instituicao"
                  value={formData.nome_instituicao}
                  onChange={handleChange}
                  placeholder="Ex: Seminário Teológico Betel"
                  required
                  className="w-full px-4 py-2 border-2 border-teal-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  CNPJ <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  name="cnpj"
                  value={formData.cnpj}
                  onChange={handleCnpjChange}
                  placeholder="00.000.000/0000-00"
                  required
                  className="w-full px-4 py-2 border-2 border-teal-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Status
                </label>
                <select
                  name="status"
                  value={formData.status}
                  onChange={handleChange}
                  className="w-full px-4 py-2 border-2 border-teal-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                >
                  <option value="ativo">Ativo</option>
                  <option value="inativo">Inativo</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* SEÇÃO 2: DADOS DO RESPONSÁVEL */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
            <span>👤</span> Dados do Responsável / Representante
          </h2>

          <div className="border border-gray-200 rounded-lg p-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-[1fr_180px] gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Nome do Representante <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  name="nome_representante"
                  value={formData.nome_representante}
                  onChange={handleChange}
                  placeholder="Nome completo do diretor/responsável"
                  required
                  className="w-full px-4 py-2 border-2 border-teal-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  CPF <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  name="cpf_representante"
                  value={formData.cpf_representante}
                  onChange={handleCpfChange}
                  placeholder="000.000.000-00"
                  required
                  className="w-full px-4 py-2 border-2 border-teal-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  E-mail de Contato <span className="text-red-500">*</span>
                </label>
                <input
                  type="email"
                  name="email_representante"
                  value={formData.email_representante}
                  onChange={handleChange}
                  placeholder="contato@instituicao.com"
                  required
                  className="w-full px-4 py-2 border-2 border-teal-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Telefone
                </label>
                <input
                  type="text"
                  name="telefone_representante"
                  value={formData.telefone_representante}
                  onChange={handlePhoneChange}
                  placeholder="(00) 0000-0000"
                  className="w-full px-4 py-2 border-2 border-teal-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  WhatsApp
                </label>
                <input
                  type="text"
                  name="whatsapp"
                  value={formData.whatsapp}
                  onChange={handlePhoneChange}
                  placeholder="(00) 00000-0000"
                  className="w-full px-4 py-2 border-2 border-teal-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                />
              </div>
            </div>
          </div>
        </div>

        {/* SEÇÃO 3: ENDEREÇO */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
            <span>📍</span> Endereço
          </h2>

          <div className="border border-gray-200 rounded-lg p-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-[140px_1fr_140px] gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">CEP</label>
                <input
                  type="text"
                  name="cep"
                  value={formData.cep}
                  onChange={handleChange}
                  placeholder="00000-000"
                  className="w-full px-4 py-2 border-2 border-teal-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Logradouro</label>
                <input
                  type="text"
                  name="logradouro"
                  value={formData.logradouro}
                  onChange={handleChange}
                  placeholder="Rua, Avenida, etc."
                  className="w-full px-4 py-2 border-2 border-teal-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Número</label>
                <input
                  type="text"
                  name="numero"
                  value={formData.numero}
                  onChange={handleChange}
                  placeholder="Ex: 123"
                  className="w-full px-4 py-2 border-2 border-teal-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-[1fr_160px_1fr_80px] gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Complemento</label>
                <input
                  type="text"
                  name="complemento"
                  value={formData.complemento}
                  onChange={handleChange}
                  placeholder="Ex: Sala 4"
                  className="w-full px-4 py-2 border-2 border-teal-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Bairro</label>
                <input
                  type="text"
                  name="bairro"
                  value={formData.bairro}
                  onChange={handleChange}
                  placeholder="Ex: Centro"
                  className="w-full px-4 py-2 border-2 border-teal-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Cidade</label>
                <input
                  type="text"
                  name="cidade"
                  value={formData.cidade}
                  onChange={handleChange}
                  placeholder="Cidade"
                  className="w-full px-4 py-2 border-2 border-teal-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">UF</label>
                <select
                  name="estado"
                  value={formData.estado}
                  onChange={handleChange}
                  className="w-full px-2 py-2 border-2 border-teal-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                >
                  <option value="">UF</option>
                  {UF_OPTIONS.map(uf => (
                    <option key={uf} value={uf}>{uf}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* SEÇÃO 4: OBSERVAÇÕES */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
            <span>📝</span> Observações Internas (Uso da Secretaria)
          </h2>

          <div className="border border-gray-200 rounded-lg p-4">
            <textarea
              name="observacoes_internas"
              value={formData.observacoes_internas}
              onChange={handleChange}
              rows={4}
              placeholder="Digite observações sobre a análise de cadastro, pendências de documentos, etc."
              className="w-full px-4 py-2 border-2 border-teal-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm resize-y"
            />
          </div>
        </div>

        {/* Alertas */}
        {erro && (
          <p className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4">{erro}</p>
        )}
        {sucesso && (
          <p className="text-green-700 text-sm bg-green-50 border border-green-200 rounded-lg px-4 py-3 mb-4">{sucesso}</p>
        )}

        {/* Botões */}
        <div className="flex gap-3">
          <button
            type="submit"
            disabled={loading}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition disabled:opacity-60"
          >
            {loading ? 'Salvando...' : id ? '💾 Salvar Alterações' : '💾 Cadastrar Instituição'}
          </button>
          <button
            type="button"
            onClick={() => router.push('/secretaria/conec')}
            className="px-6 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 font-semibold rounded-lg transition"
          >
            Cancelar
          </button>
        </div>
      </form>
    </div>
  );
}

export default function ConecCadastroPage() {
  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar activeMenu="conec" setActiveMenu={() => {}} />
      <div className="flex-1 overflow-auto">
        <Suspense fallback={<div className="p-8">Carregando formulário...</div>}>
          <CadastroForm />
        </Suspense>
      </div>
    </div>
  );
}
