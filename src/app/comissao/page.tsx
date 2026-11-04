'use client';

import { useState, useEffect, useCallback } from 'react';
import PageLayout from '@/components/PageLayout';
import { useRequireSupabaseAuth } from '@/hooks/useRequireSupabaseAuth';
import AccessRestricted from '@/components/AccessRestricted';
import { useUserRole } from '@/hooks/useUserRole';
import { canAccessModule } from '@/lib/auth/roles';
import { Comissao, ComissaoFiltros } from '@/types/comissao';
import ComissaoModal from '@/components/comissao/ComissaoModal';
import IntegrantesManagerModal from '@/components/comissao/IntegrantesManagerModal';
import {
  Users,
  CheckCircle,
  Plus,
  Search,
  Edit,
  UserPlus,
  Trash2,
  Calendar,
  AlertTriangle,
  FileText,
  Layers,
} from 'lucide-react';

export default function ComissaoPage() {
  const { loading: authLoading } = useRequireSupabaseAuth();
  const { role, loading: roleLoading } = useUserRole();

  // Estados de dados
  const [comissoes, setComissoes] = useState<Comissao[]>([]);
  const [stats, setStats] = useState({ ativas: 0, concluidas: 0, totalIntegrantes: 0 });
  const [migrationPending, setMigrationPending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filtros
  const [filtros, setFiltros] = useState<ComissaoFiltros>({
    status: 'todos',
    tipo: 'todos',
    search: '',
  });

  // Modais
  const [modalComissaoOpen, setModalComissaoOpen] = useState(false);
  const [comissaoToEdit, setComissaoToEdit] = useState<Comissao | null>(null);

  const [modalIntegrantesOpen, setModalIntegrantesOpen] = useState(false);
  const [comissaoIntegrantes, setComissaoIntegrantes] = useState<Comissao | null>(null);

  const podeAcessar = canAccessModule(role, 'comissao');
  const podeGerenciar = role === 'super' || role === 'administrador';

  // Buscar lista de comissões
  const fetchComissoes = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams();
      if (filtros.status && filtros.status !== 'todos') params.append('status', filtros.status);
      if (filtros.tipo && filtros.tipo !== 'todos') params.append('tipo', filtros.tipo);
      if (filtros.search) params.append('search', filtros.search);

      const res = await fetch(`/api/v1/comissoes?${params.toString()}`);
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Erro ao carregar comissões');
      }

      if (data.migrationPending) {
        setMigrationPending(true);
        setComissoes([]);
        setStats({ ativas: 0, concluidas: 0, totalIntegrantes: 0 });
      } else {
        setMigrationPending(false);
        setComissoes(data.comissoes || []);
        setStats(data.stats || { ativas: 0, concluidas: 0, totalIntegrantes: 0 });
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Falha na comunicação com o servidor.');
    } finally {
      setLoading(false);
    }
  }, [filtros]);

  useEffect(() => {
    if (podeAcessar && !authLoading && !roleLoading) {
      fetchComissoes();
    }
  }, [podeAcessar, authLoading, roleLoading, fetchComissoes]);

  // Excluir (soft delete) comissão
  const handleDeleteComissao = async (comissao: Comissao) => {
    const confirmacao = window.confirm(
      `Deseja realmente arquivar a comissão "${comissao.nome}"? Os integrantes e o histórico serão mantidos.`
    );
    if (!confirmacao) return;

    try {
      const res = await fetch(`/api/v1/comissoes/${comissao.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Erro ao arquivar comissão.');
      }
      fetchComissoes();
    } catch (err: any) {
      alert(err.message);
    }
  };

  if (authLoading || roleLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-[#123b63] border-t-transparent"></div>
          <p className="mt-2 text-sm text-gray-500 font-medium">Carregando permissões...</p>
        </div>
      </div>
    );
  }

  if (!podeAcessar) {
    return (
      <PageLayout title="Comissões" description="" activeMenu="comissao">
        <AccessRestricted message="Você não tem permissão para acessar o módulo de comissões institucionais." />
      </PageLayout>
    );
  }

  return (
    <PageLayout
      title="Comissões Institucionais"
      description="Gestão de comissões, grupos de trabalho e designação de ministros da COMIEADEPA"
      activeMenu="comissao"
    >
      {/* Alerta de Migration Pendente */}
      {migrationPending && (
        <div className="mb-6 p-4 bg-amber-50 border-l-4 border-amber-500 rounded-lg flex items-start gap-3 shadow-sm">
          <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm">
            <h4 className="font-bold text-amber-900">Estrutura do Banco de Dados Pronta para Aplicação</h4>
            <p className="text-amber-800 mt-1">
              A migration versionada <code className="bg-amber-100 px-1 py-0.5 rounded text-xs font-mono font-bold">migrations/20261104_modulo_comissoes_fase1.sql</code> foi gerada com sucesso e aguarda a sua autorização para execução no banco Supabase. Assim que aplicada, os registros serão carregados instantaneamente.
            </p>
          </div>
        </div>
      )}

      {/* Cards de Métricas / KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-white p-6 rounded-xl shadow-sm border-l-4 border-emerald-500 flex items-center justify-between">
          <div>
            <p className="text-gray-500 text-xs font-bold uppercase tracking-wider">Comissões Ativas</p>
            <p className="text-3xl font-extrabold text-[#123b63] mt-1">{stats.ativas}</p>
            <p className="text-xs text-gray-400 mt-1">Órgãos em atividade regular</p>
          </div>
          <div className="w-12 h-12 rounded-full bg-emerald-50 flex items-center justify-center text-emerald-600">
            <CheckCircle className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm border-l-4 border-blue-600 flex items-center justify-between">
          <div>
            <p className="text-gray-500 text-xs font-bold uppercase tracking-wider">Ministros Designados</p>
            <p className="text-3xl font-extrabold text-[#123b63] mt-1">{stats.totalIntegrantes}</p>
            <p className="text-xs text-gray-400 mt-1">Ministros oficiais em exercício</p>
          </div>
          <div className="w-12 h-12 rounded-full bg-blue-50 flex items-center justify-center text-blue-600">
            <Users className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm border-l-4 border-indigo-500 flex items-center justify-between">
          <div>
            <p className="text-gray-500 text-xs font-bold uppercase tracking-wider">Comissões Concluídas</p>
            <p className="text-3xl font-extrabold text-indigo-700 mt-1">{stats.concluidas}</p>
            <p className="text-xs text-gray-400 mt-1">Mandatos e relatórios finalizados</p>
          </div>
          <div className="w-12 h-12 rounded-full bg-indigo-50 flex items-center justify-center text-indigo-600">
            <Layers className="w-6 h-6" />
          </div>
        </div>
      </div>

      {/* Seção Principal com Filtros e Listagem */}
      <div className="mb-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
          <div className="flex items-center gap-2">
            <span className="text-2xl">👥</span>
            <h2 className="text-lg font-bold text-gray-800">Quadro Geral de Comissões</h2>
          </div>
          {podeGerenciar && (
            <button
              onClick={() => {
                setComissaoToEdit(null);
                setModalComissaoOpen(true);
              }}
              className="inline-flex items-center gap-2 bg-[#123b63] text-white px-4 py-2 rounded-lg hover:bg-[#0d2a47] transition text-sm font-semibold shadow-sm"
            >
              <Plus className="w-4 h-4" />
              Nova Comissão
            </button>
          )}
        </div>

        {/* Barra de Filtros */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6 pt-2">
          <div className="md:col-span-2 relative">
            <Search className="absolute left-3 top-3 text-gray-400 w-4 h-4" />
            <input
              type="text"
              value={filtros.search}
              onChange={(e) => setFiltros({ ...filtros, search: e.target.value })}
              placeholder="Buscar comissão por nome, sigla ou finalidade..."
              className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-[#123b63] outline-none"
            />
          </div>

          <div>
            <select
              value={filtros.status}
              onChange={(e) => setFiltros({ ...filtros, status: e.target.value })}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-[#123b63] outline-none"
            >
              <option value="todos">Todos os Status</option>
              <option value="ativa">Ativas</option>
              <option value="inativa">Inativas</option>
              <option value="concluida">Concluídas</option>
              <option value="suspensa">Suspensas</option>
            </select>
          </div>

          <div>
            <select
              value={filtros.tipo}
              onChange={(e) => setFiltros({ ...filtros, tipo: e.target.value })}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-[#123b63] outline-none"
            >
              <option value="todos">Todos os Tipos</option>
              <option value="permanente">Permanente</option>
              <option value="temporaria">Temporária</option>
              <option value="especial">Especial</option>
              <option value="ago">AGO / Específica</option>
            </select>
          </div>
        </div>

        {/* Listagem em Cards Informativos */}
        {loading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-[#123b63] border-t-transparent"></div>
            <p className="mt-2 text-sm text-gray-500">Carregando comissões...</p>
          </div>
        ) : error ? (
          <div className="p-4 bg-red-50 text-red-700 rounded-lg text-sm text-center">
            {error}
          </div>
        ) : comissoes.length === 0 ? (
          <div className="text-center py-12 border-2 border-dashed border-gray-200 rounded-xl">
            <Layers className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <h4 className="font-bold text-gray-700 text-base">Nenhuma comissão encontrada</h4>
            <p className="text-gray-400 text-sm mt-1 max-w-md mx-auto">
              {migrationPending
                ? 'Aguardando aplicação da migration no banco de dados para listar registros.'
                : 'Utilize o botão acima para cadastrar a primeira comissão institucional.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {comissoes.map((comissao) => {
              const ativos = (comissao.integrantes || []).filter((i) => i.status === 'ativo');
              const lideranca = ativos.slice(0, 3);

              return (
                <div
                  key={comissao.id}
                  className="bg-white border border-gray-200 hover:border-[#123b63]/40 rounded-xl p-5 transition shadow-sm hover:shadow"
                >
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    <div className="space-y-1.5 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`text-xs px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wider ${
                            comissao.status === 'ativa'
                              ? 'bg-emerald-100 text-emerald-800'
                              : comissao.status === 'concluida'
                              ? 'bg-blue-100 text-blue-800'
                              : 'bg-gray-100 text-gray-700'
                          }`}
                        >
                          {comissao.status}
                        </span>

                        <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded font-medium">
                          Tipo: {comissao.tipo.toUpperCase()}
                        </span>

                        {comissao.ano_referencia && (
                          <span className="text-xs px-2 py-0.5 bg-blue-50 text-blue-700 rounded font-semibold flex items-center gap-1">
                            <Calendar className="w-3 h-3" /> {comissao.ano_referencia}
                          </span>
                        )}

                        {comissao.ato_nomeacao && (
                          <span className="text-xs text-gray-500 font-medium flex items-center gap-1">
                            <FileText className="w-3 h-3 text-gray-400" /> {comissao.ato_nomeacao}
                          </span>
                        )}
                      </div>

                      <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
                        {comissao.nome}
                        {comissao.sigla && (
                          <span className="text-xs font-bold text-[#123b63] bg-[#123b63]/10 px-2 py-0.5 rounded">
                            {comissao.sigla}
                          </span>
                        )}
                      </h3>

                      <p className="text-sm text-gray-600 line-clamp-2">
                        {comissao.finalidade}
                      </p>

                      {/* Ministros em destaque */}
                      <div className="pt-2 flex flex-wrap items-center gap-2 text-xs text-gray-600">
                        <span className="font-semibold text-gray-700">Composição ({ativos.length}):</span>
                        {ativos.length === 0 ? (
                          <span className="text-gray-400 italic">Nenhum ministro designado</span>
                        ) : (
                          lideranca.map((item) => (
                            <span
                              key={item.id}
                              className="bg-gray-100 px-2 py-1 rounded text-gray-700 border border-gray-200"
                            >
                              <strong className="text-[#123b63]">{item.cargo}:</strong>{' '}
                              {item.ministro?.name}
                            </span>
                          ))
                        )}
                        {ativos.length > 3 && (
                          <span className="text-gray-400 text-xs font-semibold">
                            +{ativos.length - 3} integrante(s)
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Botões de Ação */}
                    <div className="flex items-center gap-2 lg:flex-col lg:items-end flex-shrink-0 pt-2 lg:pt-0 border-t lg:border-t-0 border-gray-100">
                      <button
                        onClick={() => {
                          setComissaoIntegrantes(comissao);
                          setModalIntegrantesOpen(true);
                        }}
                        className="flex-1 lg:flex-none inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 bg-[#123b63] text-white rounded-lg text-xs font-semibold hover:bg-[#0d2a47] transition shadow-sm"
                        title={podeGerenciar ? 'Gerenciar ministros, substituições e histórico' : 'Ver ministros e histórico'}
                      >
                        <UserPlus className="w-3.5 h-3.5" />
                        {podeGerenciar ? `Composição (${ativos.length})` : `Ver Membros (${ativos.length})`}
                      </button>

                      {podeGerenciar && (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => {
                              setComissaoToEdit(comissao);
                              setModalComissaoOpen(true);
                            }}
                            className="p-1.5 text-gray-600 hover:text-[#123b63] hover:bg-gray-100 rounded-lg transition"
                            title="Editar comissão"
                          >
                            <Edit className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDeleteComissao(comissao)}
                            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
                            title="Arquivar comissão"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modais */}
      {modalComissaoOpen && (
        <ComissaoModal
          isOpen={modalComissaoOpen}
          onClose={() => setModalComissaoOpen(false)}
          onSuccess={fetchComissoes}
          comissaoToEdit={comissaoToEdit}
        />
      )}

      {modalIntegrantesOpen && comissaoIntegrantes && (
        <IntegrantesManagerModal
          isOpen={modalIntegrantesOpen}
          onClose={() => {
            setModalIntegrantesOpen(false);
            setComissaoIntegrantes(null);
          }}
          comissao={comissaoIntegrantes}
          onSuccess={fetchComissoes}
        />
      )}
    </PageLayout>
  );
}
