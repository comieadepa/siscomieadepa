'use client';

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import { createClient } from '@/lib/supabase-client';
import { getInstituicoes, deleteInstituicao, type InstitutionInput } from '@/lib/conec-service';
import { Building2, Plus, Search, Edit2, Trash2, ShieldCheck, Mail, MapPin } from 'lucide-react';

interface InstitutionWithId extends InstitutionInput {
  id: string;
  created_at: string;
}

export default function ConecDashboardPage() {
  const router = useRouter();
  const supabase = createClient();
  
  const [instituicoes, setInstituicoes] = useState<InstitutionWithId[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeMenu, setActiveMenu] = useState('conec');

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'todos' | 'ativo' | 'inativo'>('todos');

  const fetchDados = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getInstituicoes(supabase);
      setInstituicoes(data as InstitutionWithId[]);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Erro ao carregar instituições.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDados();
  }, []);

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Deseja realmente remover a instituição "${name}"?`)) return;
    try {
      await deleteInstituicao(supabase, id);
      fetchDados();
    } catch (err: any) {
      alert(err.message || 'Erro ao remover instituição.');
    }
  };

  const filteredInstituicoes = useMemo(() => {
    return instituicoes.filter((inst) => {
      const matchSearch =
        inst.nome_instituicao.toLowerCase().includes(searchTerm.toLowerCase()) ||
        inst.cnpj.replace(/\D/g, '').includes(searchTerm.replace(/\D/g, '')) ||
        inst.nome_representante.toLowerCase().includes(searchTerm.toLowerCase());

      const matchStatus =
        statusFilter === 'todos' ||
        inst.status === statusFilter;

      return matchSearch && matchStatus;
    });
  }, [instituicoes, searchTerm, statusFilter]);

  const metrics = useMemo(() => {
    const total = instituicoes.length;
    const ativas = instituicoes.filter((i) => i.status === 'ativo').length;
    const inativas = total - ativas;
    return { total, ativas, inativas };
  }, [instituicoes]);

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar activeMenu={activeMenu} setActiveMenu={setActiveMenu} />

      <div className="flex-1 overflow-auto">
        <div className="p-6 max-w-7xl mx-auto">

          {/* Cabeçalho */}
          <div className="mb-6">
            <div className="flex items-center gap-3 mb-2">
              <span className="text-4xl">🎓</span>
              <h1 className="text-3xl font-bold text-gray-800">CONEC</h1>
            </div>
            <p className="text-gray-600">Conselho de Educação Cristã — Credenciamento de Instituições Teológicas</p>
          </div>

          {/* Cards de métricas */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="bg-white rounded-lg shadow-md p-5 flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center flex-shrink-0">
                <Building2 className="w-6 h-6" />
              </div>
              <div>
                <p className="text-gray-500 text-sm">Total de Instituições</p>
                <h3 className="text-2xl font-bold text-gray-800">{metrics.total}</h3>
              </div>
            </div>
            <div className="bg-white rounded-lg shadow-md p-5 flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-green-50 text-green-600 flex items-center justify-center flex-shrink-0">
                <ShieldCheck className="w-6 h-6" />
              </div>
              <div>
                <p className="text-gray-500 text-sm">Credenciadas Ativas</p>
                <h3 className="text-2xl font-bold text-gray-800">{metrics.ativas}</h3>
              </div>
            </div>
            <div className="bg-white rounded-lg shadow-md p-5 flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-yellow-50 text-yellow-600 flex items-center justify-center flex-shrink-0">
                <Building2 className="w-6 h-6" />
              </div>
              <div>
                <p className="text-gray-500 text-sm">Inativas</p>
                <h3 className="text-2xl font-bold text-gray-800">{metrics.inativas}</h3>
              </div>
            </div>
          </div>

          {/* Barra de ações */}
          <div className="bg-white rounded-lg shadow-md p-4 mb-6 flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex flex-1 flex-col md:flex-row gap-3">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3.5 top-2.5 w-5 h-5 text-gray-400" />
                <input
                  type="text"
                  placeholder="Buscar por nome, CNPJ ou representante..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-11 pr-4 py-2 border-2 border-teal-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                />
              </div>
              <select
                value={statusFilter}
                onChange={(e: any) => setStatusFilter(e.target.value)}
                className="border-2 border-teal-500 rounded-lg px-4 py-2 text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              >
                <option value="todos">Todos os Status</option>
                <option value="ativo">Ativo</option>
                <option value="inativo">Inativo</option>
              </select>
            </div>

            <button
              onClick={() => router.push('/secretaria/conec/cadastro')}
              className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold px-5 py-2 rounded-lg transition text-sm"
            >
              <Plus className="w-5 h-5" />
              Cadastrar Instituição
            </button>
          </div>

          {/* Tabela */}
          {loading ? (
            <div className="bg-white rounded-lg shadow-md p-12 text-center text-gray-500">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4" />
              Carregando instituições...
            </div>
          ) : error ? (
            <div className="bg-red-50 text-red-700 p-6 rounded-lg border border-red-200 text-center">{error}</div>
          ) : filteredInstituicoes.length === 0 ? (
            <div className="bg-white rounded-lg shadow-md p-12 text-center text-gray-500">
              <Building2 className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              Nenhuma instituição encontrada.
            </div>
          ) : (
            <div className="bg-white rounded-lg shadow-md overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200 text-gray-500 font-semibold text-xs uppercase tracking-wider">
                      <th className="px-6 py-4">Instituição / CNPJ</th>
                      <th className="px-6 py-4">Representante</th>
                      <th className="px-6 py-4">Localização</th>
                      <th className="px-6 py-4">Status</th>
                      <th className="px-6 py-4 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 text-sm text-gray-700">
                    {filteredInstituicoes.map((inst) => (
                      <tr key={inst.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-6 py-4">
                          <div className="font-semibold text-gray-800">{inst.nome_instituicao}</div>
                          <div className="text-xs text-gray-500 mt-0.5">{inst.cnpj}</div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="font-medium text-gray-800">{inst.nome_representante}</div>
                          <div className="text-xs text-gray-500 mt-0.5 flex items-center gap-1.5">
                            <Mail className="w-3.5 h-3.5 text-gray-400" />
                            {inst.email_representante}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          {inst.cidade && inst.estado ? (
                            <div className="flex items-center gap-1.5 text-gray-600">
                              <MapPin className="w-4 h-4 text-gray-400" />
                              {inst.cidade} - {inst.estado}
                            </div>
                          ) : (
                            <span className="text-gray-400">Não informado</span>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${
                            inst.status === 'ativo'
                              ? 'bg-green-50 text-green-700 border border-green-200'
                              : 'bg-yellow-50 text-yellow-700 border border-yellow-200'
                          }`}>
                            {inst.status === 'ativo' ? 'Ativo' : 'Inativo'}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => router.push(`/secretaria/conec/cadastro?id=${inst.id}`)}
                              title="Editar Instituição"
                              className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-600 hover:text-blue-600 transition-colors"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleDelete(inst.id, inst.nome_instituicao)}
                              title="Excluir"
                              className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-600 hover:text-red-600 transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
