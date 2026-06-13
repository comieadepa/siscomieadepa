'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import PageLayout from '@/components/PageLayout';
import { createClient } from '@/lib/supabase-client';
import { createInstituicao, getInstituicaoById, updateInstituicao, type InstitutionInput } from '@/lib/conec-service';
import { ArrowLeft, Save, Building2, User, MapPin, Notebook } from 'lucide-react';
import { formatCpf, formatPhone } from '@/lib/mascaras';

function CadastroForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const id = searchParams?.get('id');
  const supabase = createClient();

  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      setError(null);
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
        console.error(err);
        setError(err.message || 'Erro ao carregar dados da instituição.');
      } finally {
        setFetching(false);
      }
    };

    loadData();
  }, [id]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value
    }));
  };

  const handleCpfChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData((prev) => ({
      ...prev,
      cpf_representante: formatCpf(e.target.value)
    }));
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: formatPhone(e.target.value)
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    // Validações básicas
    if (!formData.nome_instituicao || !formData.cnpj || !formData.nome_representante || !formData.cpf_representante || !formData.email_representante) {
      setError('Por favor, preencha todos os campos obrigatórios.');
      setLoading(false);
      return;
    }

    try {
      if (id) {
        await updateInstituicao(supabase, id, formData);
      } else {
        await createInstituicao(supabase, formData);
      }
      router.push('/secretaria/conec');
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Erro ao salvar instituição.');
    } finally {
      setLoading(false);
    }
  };

  if (fetching) {
    return (
      <div className="bg-white rounded-2xl border border-gray-150 p-12 text-center text-gray-500">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
        Carregando dados da instituição...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* HEADER CONTROLS */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => router.push('/secretaria/conec')}
          className="p-2 hover:bg-gray-100 rounded-xl text-gray-600 transition-colors"
        >
          <ArrowLeft className="w-6 h-6" />
        </button>
        <h2 className="text-xl font-bold text-gray-800">
          {id ? 'Editar Instituição' : 'Cadastrar Nova Instituição'}
        </h2>
      </div>

      {error && (
        <div className="bg-red-50 text-red-700 p-4 rounded-xl border border-red-200">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* CARD 1: DADOS DA INSTITUIÇÃO */}
        <div className="bg-white rounded-2xl border border-gray-150 p-6 shadow-sm space-y-4">
          <div className="flex items-center gap-2 text-gray-800 font-bold border-b border-gray-100 pb-3">
            <Building2 className="w-5 h-5 text-[#0D2B4E]" />
            <h3>Dados da Instituição de Ensino</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">
                Nome da Instituição <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                name="nome_instituicao"
                value={formData.nome_instituicao}
                onChange={handleChange}
                placeholder="Ex: Seminário Teológico Betel"
                required
                className="w-full px-4 py-2.5 bg-gray-50 border border-gray-250 rounded-xl text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">
                CNPJ <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                name="cnpj"
                value={formData.cnpj}
                onChange={handleChange}
                placeholder="Ex: 00.000.000/0000-00"
                required
                className="w-full px-4 py-2.5 bg-gray-50 border border-gray-250 rounded-xl text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">
                Status
              </label>
              <select
                name="status"
                value={formData.status}
                onChange={handleChange}
                className="w-full px-4 py-2.5 bg-gray-50 border border-gray-250 rounded-xl text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              >
                <option value="ativo">Ativo</option>
                <option value="inativo">Inativo</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">
                ID Cliente ASAAS (Preparação)
              </label>
              <input
                type="text"
                name="asaas_customer_id"
                value={formData.asaas_customer_id}
                onChange={handleChange}
                placeholder="Preenchido automaticamente após integração"
                className="w-full px-4 py-2.5 bg-gray-50 border border-gray-250 rounded-xl text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              />
            </div>
          </div>
        </div>

        {/* CARD 2: DADOS DO RESPONSÁVEL */}
        <div className="bg-white rounded-2xl border border-gray-150 p-6 shadow-sm space-y-4">
          <div className="flex items-center gap-2 text-gray-800 font-bold border-b border-gray-100 pb-3">
            <User className="w-5 h-5 text-[#0D2B4E]" />
            <h3>Dados do Responsável / Representante</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">
                Nome do Representante <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                name="nome_representante"
                value={formData.nome_representante}
                onChange={handleChange}
                placeholder="Nome completo do diretor/responsável"
                required
                className="w-full px-4 py-2.5 bg-gray-50 border border-gray-250 rounded-xl text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">
                CPF do Representante <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                name="cpf_representante"
                value={formData.cpf_representante}
                onChange={handleCpfChange}
                placeholder="000.000.000-00"
                required
                className="w-full px-4 py-2.5 bg-gray-50 border border-gray-250 rounded-xl text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">
                E-mail de Contato <span className="text-red-500">*</span>
              </label>
              <input
                type="email"
                name="email_representante"
                value={formData.email_representante}
                onChange={handleChange}
                placeholder="Ex: contato@instituicao.com"
                required
                className="w-full px-4 py-2.5 bg-gray-50 border border-gray-250 rounded-xl text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">
                Telefone
              </label>
              <input
                type="text"
                name="telefone_representante"
                value={formData.telefone_representante}
                onChange={handlePhoneChange}
                placeholder="(00) 0000-0000"
                className="w-full px-4 py-2.5 bg-gray-50 border border-gray-250 rounded-xl text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">
                WhatsApp
              </label>
              <input
                type="text"
                name="whatsapp"
                value={formData.whatsapp}
                onChange={handlePhoneChange}
                placeholder="(00) 00000-0000"
                className="w-full px-4 py-2.5 bg-gray-50 border border-gray-250 rounded-xl text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              />
            </div>
          </div>
        </div>

        {/* CARD 3: ENDEREÇO */}
        <div className="bg-white rounded-2xl border border-gray-150 p-6 shadow-sm space-y-4">
          <div className="flex items-center gap-2 text-gray-800 font-bold border-b border-gray-100 pb-3">
            <MapPin className="w-5 h-5 text-[#0D2B4E]" />
            <h3>Endereço</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">
                CEP
              </label>
              <input
                type="text"
                name="cep"
                value={formData.cep}
                onChange={handleChange}
                placeholder="00000-000"
                className="w-full px-4 py-2.5 bg-gray-50 border border-gray-250 rounded-xl text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">
                Logradouro
              </label>
              <input
                type="text"
                name="logradouro"
                value={formData.logradouro}
                onChange={handleChange}
                placeholder="Rua, Avenida, etc."
                className="w-full px-4 py-2.5 bg-gray-50 border border-gray-250 rounded-xl text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">
                Número
              </label>
              <input
                type="text"
                name="numero"
                value={formData.numero}
                onChange={handleChange}
                placeholder="Ex: 123 ou S/N"
                className="w-full px-4 py-2.5 bg-gray-50 border border-gray-250 rounded-xl text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">
                Complemento
              </label>
              <input
                type="text"
                name="complemento"
                value={formData.complemento}
                onChange={handleChange}
                placeholder="Ex: Sala 4, Bloco B"
                className="w-full px-4 py-2.5 bg-gray-50 border border-gray-250 rounded-xl text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">
                Bairro
              </label>
              <input
                type="text"
                name="bairro"
                value={formData.bairro}
                onChange={handleChange}
                placeholder="Ex: Centro"
                className="w-full px-4 py-2.5 bg-gray-50 border border-gray-250 rounded-xl text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              />
            </div>
            <div>
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">
                    Cidade
                  </label>
                  <input
                    type="text"
                    name="cidade"
                    value={formData.cidade}
                    onChange={handleChange}
                    placeholder="Cidade"
                    className="w-full px-4 py-2.5 bg-gray-50 border border-gray-250 rounded-xl text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">
                    UF
                  </label>
                  <input
                    type="text"
                    name="estado"
                    value={formData.estado}
                    onChange={handleChange}
                    maxLength={2}
                    placeholder="UF"
                    className="w-full px-4 py-2.5 bg-gray-50 border border-gray-250 rounded-xl text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm text-center uppercase"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* CARD 4: OBSERVAÇÕES */}
        <div className="bg-white rounded-2xl border border-gray-150 p-6 shadow-sm space-y-4">
          <div className="flex items-center gap-2 text-gray-800 font-bold border-b border-gray-100 pb-3">
            <Notebook className="w-5 h-5 text-[#0D2B4E]" />
            <h3>Observações Internas (Uso da Secretaria)</h3>
          </div>
          <div>
            <textarea
              name="observacoes_internas"
              value={formData.observacoes_internas}
              onChange={handleChange}
              rows={4}
              placeholder="Digite observações sobre a análise de cadastro, pendências de documentos, etc."
              className="w-full px-4 py-2.5 bg-gray-50 border border-gray-250 rounded-xl text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm resize-y"
            ></textarea>
          </div>
        </div>

        {/* ACTION BUTTONS */}
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={() => router.push('/secretaria/conec')}
            className="px-5 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold rounded-xl transition-all text-sm"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={loading}
            className="flex items-center gap-2 bg-[#0D2B4E] hover:bg-[#153e6d] text-white font-semibold px-6 py-2.5 rounded-xl transition-all shadow-sm disabled:opacity-55 text-sm"
          >
            <Save className="w-5 h-5" />
            {loading ? 'Salvando...' : 'Salvar Cadastro'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function ConecCadastroPage() {
  return (
    <PageLayout
      title="Cadastro CONEC"
      description="Gerenciar cadastro de instituição teológica"
      activeMenu="conec"
    >
      <Suspense fallback={<div>Carregando formulário...</div>}>
        <CadastroForm />
      </Suspense>
    </PageLayout>
  );
}
