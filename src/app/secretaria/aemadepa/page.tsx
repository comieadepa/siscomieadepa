'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect, useMemo, useCallback } from 'react';
import PageLayout from '@/components/PageLayout';
import ModalAemadepa, { MinistroAemadepaInfo, DadosEsposaForm } from '@/components/ModalAemadepa';
import CartaoAemadepa from '@/components/CartaoAemadepa';
import FichaAemadepa from '@/components/FichaAemadepa';
import { useRequireSupabaseAuth } from '@/hooks/useRequireSupabaseAuth';
import { authenticatedFetch } from '@/lib/api-client';
import {
  HeartHandshake,
  Search,
  UserPlus,
  RefreshCw,
  Printer,
  CreditCard,
  Edit,
  Users,
  CheckCircle2,
  AlertCircle,
  Clock,
  Sparkles,
  Phone,
  MapPin,
} from 'lucide-react';

interface AssociadaAemadepa {
  id: string; // member_id do ministro
  ministroId: string;
  uniqueId?: string;
  ministroNome: string;
  ministroMatricula: string;
  ministroCpf: string;
  cargoMinisterial: string;
  campo: string;
  supervisao: string;
  // Dados da Esposa
  nomeEsposa: string;
  cpfEsposa: string;
  rgEsposa: string;
  orgaoEmissorEsposa: string;
  dataNascimentoEsposa: string;
  nacionalidadeEsposa: string;
  naturalidadeEsposa: string;
  nomePaiEsposa: string;
  nomeMaeEsposa: string;
  tituloEleitoralEsposa: string;
  foneEsposa: string;
  emailEsposa: string;
  tipoSanguineoEsposa: string;
  fotoEsposaUrl: string | null;
  numeroAemadepa: string;
  temEsposaCadastrada: boolean;
  statusMinistro: string;
}

export default function AemadepaPage() {
  const { loading: authLoading } = useRequireSupabaseAuth();

  const [loading, setLoading] = useState(true);
  const [associadas, setAssociadas] = useState<AssociadaAemadepa[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [filtroStatusEsposa, setFiltroStatusEsposa] = useState<'todos' | 'com_esposa' | 'sem_esposa'>('todos');
  const [filtroSupervisao, setFiltroSupervisao] = useState('TODOS');
  const [filtroCampo, setFiltroCampo] = useState('TODOS');
  const [paginaAtual, setPaginaAtual] = useState(1);
  const ITENS_POR_PAGINA = 25;

  // Estado para modal de edição / cadastro AEMADEPA
  const [modalAemadepaAberto, setModalAemadepaAberto] = useState(false);
  const [ministroSelecionadoModal, setMinistroSelecionadoModal] = useState<MinistroAemadepaInfo | null>(null);
  const [dadosIniciaisModal, setDadosIniciaisModal] = useState<Partial<DadosEsposaForm> | null>(null);

  // Estados para Carteirinha e Ficha Cadastral AEMADEPA
  const [associadaCartao, setAssociadaCartao] = useState<AssociadaAemadepa | null>(null);
  const [associadaFicha, setAssociadaFicha] = useState<AssociadaAemadepa | null>(null);

  // Carrega ministros e mapeia para a visão AEMADEPA
  const carregarDados = useCallback(async () => {
    setLoading(true);
    try {
      // Busca ministros (limite alto para carregar o conjunto completo)
      const res = await authenticatedFetch('/api/v1/members?limit=5000&tipoCadastro=ministro');
      const payload = await res.json().catch(() => null as any);

      if (!res.ok) {
        throw new Error(payload?.error || 'Erro ao carregar dados dos ministros');
      }

      const rows: any[] = payload?.data || [];

      const listaMapeada: AssociadaAemadepa[] = rows.map((m: any) => {
        const cf = m.custom_fields && typeof m.custom_fields === 'object' ? m.custom_fields : {};
        const nomeEsposa = String(m.nome_conjuge || cf.nomeConjuge || '').trim();
        const temEsposa = Boolean(nomeEsposa && nomeEsposa.length > 0);

        return {
          id: m.id,
          ministroId: m.id,
          uniqueId: m.unique_id || cf.unique_id || cf.uniqueId || undefined,
          ministroNome: String(m.name || m.nome || cf.nome || '').trim(),
          ministroMatricula: String(m.matricula || cf.matricula || '').trim(),
          ministroCpf: String(m.cpf || cf.cpf || '').trim(),
          cargoMinisterial: String(m.cargo_ministerial || cf.cargoMinisterial || m.profissao || '').trim(),
          campo: String(cf.campo || m.cidade || '').trim(),
          supervisao: String(cf.supervisao || '').trim(),
          // Esposa / Associada
          nomeEsposa: nomeEsposa || 'Não cadastrada',
          cpfEsposa: String(m.cpf_conjuge || cf.cpfConjuge || '').trim(),
          rgEsposa: String(m.conjuge_rg || cf.conjugeRg || '').trim(),
          orgaoEmissorEsposa: String(m.conjuge_orgao_emissor || cf.conjugeOrgaoEmissor || '').trim(),
          dataNascimentoEsposa: String(m.data_nascimento_conjuge || cf.dataNascimentoConjuge || '').trim(),
          nacionalidadeEsposa: String(m.conjuge_nacionalidade || cf.conjugeNacionalidade || 'BRASILEIRA').trim(),
          naturalidadeEsposa: String(m.conjuge_naturalidade || cf.conjugeNaturalidade || '').trim(),
          nomePaiEsposa: String(m.conjuge_nome_pai || cf.conjugeNomePai || '').trim(),
          nomeMaeEsposa: String(m.conjuge_nome_mae || cf.conjugeNomeMae || '').trim(),
          tituloEleitoralEsposa: String(m.conjuge_titulo_eleitoral || cf.conjugeTituloEleitoral || '').trim(),
          foneEsposa: String(m.conjuge_fone || cf.conjugeFone || '').trim(),
          emailEsposa: String(m.conjuge_email || cf.conjugeEmail || '').trim(),
          tipoSanguineoEsposa: String(m.conjuge_tipo_sanguineo || cf.conjugeTipoSanguineo || '').trim(),
          fotoEsposaUrl: m.conjuge_foto_url || cf.conjugeFotoUrl || null,
          numeroAemadepa: String(m.numero_aemadepa || cf.numero_aemadepa || cf.numeroAemadepa || '').trim(),
          temEsposaCadastrada: temEsposa,
          statusMinistro: String(m.status || 'active').toLowerCase(),
        };
      });

      setAssociadas(listaMapeada);
    } catch (err: any) {
      console.error('Erro ao buscar dados AEMADEPA:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void carregarDados();
  }, [carregarDados]);

  // Lista de ministros convertida para o Modal
  const todosMinistrosInfo: MinistroAemadepaInfo[] = useMemo(() => {
    return associadas.map(a => ({
      id: a.ministroId,
      nome: a.ministroNome,
      matricula: a.ministroMatricula,
      cpf: a.ministroCpf,
      cargo: a.cargoMinisterial,
      campo: a.campo,
      supervisao: a.supervisao,
    }));
  }, [associadas]);

  // Abre modal para editar / cadastrar
  const abrirModalEdicao = (item: AssociadaAemadepa) => {
    setMinistroSelecionadoModal({
      id: item.ministroId,
      nome: item.ministroNome,
      matricula: item.ministroMatricula,
      cpf: item.ministroCpf,
      cargo: item.cargoMinisterial,
      campo: item.campo,
      supervisao: item.supervisao,
    });

    setDadosIniciaisModal({
      nome: item.temEsposaCadastrada ? item.nomeEsposa : '',
      cpf: item.cpfEsposa,
      rg: item.rgEsposa,
      orgao_emissor: item.orgaoEmissorEsposa,
      data_nascimento: item.dataNascimentoEsposa,
      nacionalidade: item.nacionalidadeEsposa || 'BRASILEIRA',
      naturalidade: item.naturalidadeEsposa,
      nome_pai: item.nomePaiEsposa,
      nome_mae: item.nomeMaeEsposa,
      titulo_eleitoral: item.tituloEleitoralEsposa,
      fone: item.foneEsposa,
      email: item.emailEsposa,
      tipo_sanguineo: item.tipoSanguineoEsposa,
      foto_url: item.fotoEsposaUrl,
      numero_aemadepa: item.numeroAemadepa,
    });

    setModalAemadepaAberto(true);
  };

  const abrirModalNova = () => {
    setMinistroSelecionadoModal(null);
    setDadosIniciaisModal(null);
    setModalAemadepaAberto(true);
  };

  // Listas de supervisões e campos para filtros
  const supervisoesDisponiveis = useMemo(() => {
    const set = new Set<string>();
    associadas.forEach(a => {
      if (a.supervisao) set.add(a.supervisao);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [associadas]);

  const camposDisponiveis = useMemo(() => {
    const set = new Set<string>();
    associadas.forEach(a => {
      if (a.campo) set.add(a.campo);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [associadas]);

  // Métricas
  const totalMinistros = associadas.length;
  const totalComEsposa = useMemo(() => associadas.filter(a => a.temEsposaCadastrada).length, [associadas]);
  const totalSemEsposa = totalMinistros - totalComEsposa;
  const totalComMatricula = useMemo(() => associadas.filter(a => a.temEsposaCadastrada && a.numeroAemadepa).length, [associadas]);

  // Filtragem
  const associadasFiltradas = useMemo(() => {
    const q = searchTerm.toLowerCase().trim();
    return associadas.filter(item => {
      // Filtro status esposa
      if (filtroStatusEsposa === 'com_esposa' && !item.temEsposaCadastrada) return false;
      if (filtroStatusEsposa === 'sem_esposa' && item.temEsposaCadastrada) return false;

      // Filtro supervisão
      if (filtroSupervisao !== 'TODOS' && item.supervisao !== filtroSupervisao) return false;

      // Filtro campo
      if (filtroCampo !== 'TODOS' && item.campo !== filtroCampo) return false;

      // Busca textual
      if (q) {
        const matchEsposa = item.nomeEsposa.toLowerCase().includes(q);
        const matchMinistro = item.ministroNome.toLowerCase().includes(q);
        const matchMatriculaAemadepa = item.numeroAemadepa.toLowerCase().includes(q);
        const matchMatriculaMinistro = item.ministroMatricula.toLowerCase().includes(q);
        const matchCpfEsposa = item.cpfEsposa.toLowerCase().includes(q);
        const matchCampo = item.campo.toLowerCase().includes(q);
        return matchEsposa || matchMinistro || matchMatriculaAemadepa || matchMatriculaMinistro || matchCpfEsposa || matchCampo;
      }

      return true;
    });
  }, [associadas, searchTerm, filtroStatusEsposa, filtroSupervisao, filtroCampo]);

  // Paginação
  const totalPaginas = Math.ceil(associadasFiltradas.length / ITENS_POR_PAGINA) || 1;
  const paginaSegura = Math.min(paginaAtual, totalPaginas);
  const associadasPaginadas = useMemo(() => {
    const start = (paginaSegura - 1) * ITENS_POR_PAGINA;
    return associadasFiltradas.slice(start, start + ITENS_POR_PAGINA);
  }, [associadasFiltradas, paginaSegura]);

  if (authLoading) {
    return <div className="p-8 text-center text-gray-500 font-semibold">Carregando permissões...</div>;
  }

  return (
    <PageLayout
      title="AEMADEPA"
      description="Associação das Esposas dos Ministros da Assembleia de Deus no Estado do Pará"
      activeMenu="aemadepa"
    >
      <div className="p-4 sm:p-6 space-y-6 max-w-7xl mx-auto">
        {/* Banner Institucional AEMADEPA */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-rose-700 via-pink-700 to-purple-800 text-white p-6 sm:p-8 shadow-xl">
          <div className="absolute top-0 right-0 -mt-8 -mr-8 w-64 h-64 bg-white/10 rounded-full blur-2xl pointer-events-none" />
          <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/20 backdrop-blur-md text-xs font-semibold uppercase tracking-wider">
                <Sparkles className="w-3.5 h-3.5 text-pink-200" />
                Gestão de Esposas
              </div>
              <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
                AEMADEPA
              </h2>
              <p className="text-rose-100 text-sm max-w-2xl leading-relaxed">
                Painel centralizado para cadastro, emissão de credenciais, impressão de fichas cadastrais e acompanhamento das esposas dos ministros vinculados à COMIEADEPA.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                onClick={abrirModalNova}
                className="px-5 py-2.5 bg-white text-rose-800 hover:bg-rose-50 font-bold text-sm rounded-xl shadow-md hover:shadow-lg transition flex items-center gap-2 cursor-pointer"
              >
                <UserPlus className="w-4 h-4" />
                Nova Esposa
              </button>
              <button
                onClick={() => void carregarDados()}
                disabled={loading}
                className="px-4 py-2.5 bg-rose-800/60 hover:bg-rose-800/80 text-white font-semibold text-sm rounded-xl border border-white/20 transition flex items-center gap-2 cursor-pointer"
                title="Atualizar lista"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                Atualizar
              </button>
            </div>
          </div>
        </div>

        {/* Cards de Métricas */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-200 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Total Ministros</p>
              <p className="text-2xl font-bold text-gray-800 mt-1">{totalMinistros}</p>
            </div>
            <div className="w-12 h-12 bg-gray-100 rounded-xl flex items-center justify-center text-gray-600">
              <Users className="w-6 h-6" />
            </div>
          </div>

          <div className="bg-white rounded-xl p-5 shadow-sm border border-rose-100 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-rose-600 uppercase tracking-wider">Esposas Cadastradas</p>
              <p className="text-2xl font-bold text-rose-700 mt-1">{totalComEsposa}</p>
            </div>
            <div className="w-12 h-12 bg-rose-50 rounded-xl flex items-center justify-center text-rose-600">
              <HeartHandshake className="w-6 h-6" />
            </div>
          </div>

          <div className="bg-white rounded-xl p-5 shadow-sm border border-amber-100 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-amber-600 uppercase tracking-wider">Sem Esposa Vinculada</p>
              <p className="text-2xl font-bold text-amber-700 mt-1">{totalSemEsposa}</p>
            </div>
            <div className="w-12 h-12 bg-amber-50 rounded-xl flex items-center justify-center text-amber-600">
              <AlertCircle className="w-6 h-6" />
            </div>
          </div>

          <div className="bg-white rounded-xl p-5 shadow-sm border border-purple-100 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-purple-600 uppercase tracking-wider">Com No AEMADEPA</p>
              <p className="text-2xl font-bold text-purple-700 mt-1">{totalComMatricula}</p>
            </div>
            <div className="w-12 h-12 bg-purple-50 rounded-xl flex items-center justify-center text-purple-600">
              <CreditCard className="w-6 h-6" />
            </div>
          </div>
        </div>

        {/* Modal de Cadastro / Edição da Associada AEMADEPA */}
        <ModalAemadepa
          isOpen={modalAemadepaAberto}
          onClose={() => setModalAemadepaAberto(false)}
          onSaved={() => void carregarDados()}
          ministro={ministroSelecionadoModal}
          dadosIniciais={dadosIniciaisModal}
          todosMinistros={todosMinistrosInfo}
        />

        {/* Modal de Emissão da Carteirinha AEMADEPA */}
        {associadaCartao && (
          <CartaoAemadepa
            associada={{
              id: associadaCartao.ministroId,
              nomeEsposa: associadaCartao.nomeEsposa,
              cpfEsposa: associadaCartao.cpfEsposa,
              rgEsposa: associadaCartao.rgEsposa,
              dataNascimentoEsposa: associadaCartao.dataNascimentoEsposa,
              tipoSanguineoEsposa: associadaCartao.tipoSanguineoEsposa,
              fotoEsposaUrl: associadaCartao.fotoEsposaUrl,
              numeroAemadepa: associadaCartao.numeroAemadepa,
              ministroNome: associadaCartao.ministroNome,
              ministroMatricula: associadaCartao.ministroMatricula,
              cargoMinisterial: associadaCartao.cargoMinisterial,
              campo: associadaCartao.campo,
              supervisao: associadaCartao.supervisao,
            }}
            onClose={() => setAssociadaCartao(null)}
          />
        )}

        {/* Modal de Emissão da Ficha Cadastral AEMADEPA */}
        {associadaFicha && (
          <FichaAemadepa
            associada={{
              id: associadaFicha.ministroId,
              uniqueId: associadaFicha.uniqueId,
              nomeEsposa: associadaFicha.nomeEsposa,
              cpfEsposa: associadaFicha.cpfEsposa,
              rgEsposa: associadaFicha.rgEsposa,
              orgaoEmissorEsposa: associadaFicha.orgaoEmissorEsposa,
              dataNascimentoEsposa: associadaFicha.dataNascimentoEsposa,
              nacionalidadeEsposa: associadaFicha.nacionalidadeEsposa,
              naturalidadeEsposa: associadaFicha.naturalidadeEsposa,
              nomePaiEsposa: associadaFicha.nomePaiEsposa,
              nomeMaeEsposa: associadaFicha.nomeMaeEsposa,
              tituloEleitoralEsposa: associadaFicha.tituloEleitoralEsposa,
              foneEsposa: associadaFicha.foneEsposa,
              emailEsposa: associadaFicha.emailEsposa,
              tipoSanguineoEsposa: associadaFicha.tipoSanguineoEsposa,
              fotoEsposaUrl: associadaFicha.fotoEsposaUrl,
              numeroAemadepa: associadaFicha.numeroAemadepa,
              ministroNome: associadaFicha.ministroNome,
              ministroMatricula: associadaFicha.ministroMatricula,
              cargoMinisterial: associadaFicha.cargoMinisterial,
              campo: associadaFicha.campo,
              supervisao: associadaFicha.supervisao,
            }}
            onClose={() => setAssociadaFicha(null)}
          />
        )}

        {/* Barra de Filtros e Pesquisa */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 space-y-4">
          <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
            {/* Campo de Pesquisa */}
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchTerm}
                onChange={e => {
                  setSearchTerm(e.target.value);
                  setPaginaAtual(1);
                }}
                placeholder="Buscar por nome da esposa, ministro, matrícula ou campo..."
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-rose-500 focus:border-rose-500"
              />
            </div>

            {/* Filtros em Linha */}
            <div className="flex flex-wrap gap-2 items-center">
              {/* Filtro Status da Esposa */}
              <select
                value={filtroStatusEsposa}
                onChange={e => {
                  setFiltroStatusEsposa(e.target.value as any);
                  setPaginaAtual(1);
                }}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-rose-500"
              >
                <option value="todos">Todas as Situações</option>
                <option value="com_esposa">Com Esposa Cadastrada</option>
                <option value="sem_esposa">Sem Esposa Vinculada</option>
              </select>

              {/* Filtro Supervisão */}
              {supervisoesDisponiveis.length > 0 && (
                <select
                  value={filtroSupervisao}
                  onChange={e => {
                    setFiltroSupervisao(e.target.value);
                    setPaginaAtual(1);
                  }}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-rose-500 max-w-[160px]"
                >
                  <option value="TODOS">Supervisão: Todas</option>
                  {supervisoesDisponiveis.map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              )}

              {/* Filtro Campo */}
              {camposDisponiveis.length > 0 && (
                <select
                  value={filtroCampo}
                  onChange={e => {
                    setFiltroCampo(e.target.value);
                    setPaginaAtual(1);
                  }}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-rose-500 max-w-[160px]"
                >
                  <option value="TODOS">Campo: Todos</option>
                  {camposDisponiveis.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              )}

              {/* Limpar Filtros */}
              {(searchTerm || filtroStatusEsposa !== 'todos' || filtroSupervisao !== 'TODOS' || filtroCampo !== 'TODOS') && (
                <button
                  onClick={() => {
                    setSearchTerm('');
                    setFiltroStatusEsposa('todos');
                    setFiltroSupervisao('TODOS');
                    setFiltroCampo('TODOS');
                    setPaginaAtual(1);
                  }}
                  className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-600 font-semibold text-xs rounded-lg transition cursor-pointer"
                >
                  Limpar
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Tabela de Esposas */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <HeartHandshake className="w-5 h-5 text-rose-600" />
              <h3 className="font-bold text-gray-800 text-base">
                Relação de Esposas AEMADEPA
              </h3>
            </div>
            <span className="text-xs font-semibold px-2.5 py-1 bg-rose-50 text-rose-700 rounded-full">
              {associadasFiltradas.length} registro(s)
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left border-collapse">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-xs uppercase font-semibold text-gray-600">
                  <th className="px-4 py-3 text-center w-14">Foto</th>
                  <th className="px-4 py-3">Nome da Esposa</th>
                  <th className="px-4 py-3">No AEMADEPA</th>
                  <th className="px-4 py-3">Ministro Vinculado</th>
                  <th className="px-4 py-3">Campo / Região</th>
                  <th className="px-4 py-3 text-center">Status</th>
                  <th className="px-4 py-3 text-center w-36">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="text-center py-12 text-gray-400">
                      <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-rose-600" />
                      Carregando esposas da AEMADEPA...
                    </td>
                  </tr>
                ) : associadasPaginadas.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-12 text-gray-400">
                      Nenhuma esposa encontrada com os filtros aplicados.
                    </td>
                  </tr>
                ) : (
                  associadasPaginadas.map(item => (
                    <tr key={item.id} className="hover:bg-rose-50/30 transition">
                      {/* Foto da Esposa */}
                      <td className="px-4 py-3 text-center">
                        <div className="w-10 h-10 rounded-full overflow-hidden bg-rose-100 flex items-center justify-center mx-auto border border-rose-200">
                          {item.fotoEsposaUrl ? (
                            <img
                              src={item.fotoEsposaUrl}
                              alt={item.nomeEsposa}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <span className="text-rose-400 text-sm font-bold">
                              {item.temEsposaCadastrada ? item.nomeEsposa.charAt(0).toUpperCase() : '—'}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Nome da Esposa */}
                      <td className="px-4 py-3">
                        {item.temEsposaCadastrada ? (
                          <div>
                            <p className="font-bold text-gray-900">{item.nomeEsposa}</p>
                            <div className="flex items-center gap-3 text-xs text-gray-500 mt-0.5">
                              {item.cpfEsposa && <span>CPF: {item.cpfEsposa}</span>}
                              {item.foneEsposa && (
                                <span className="flex items-center gap-1">
                                  <Phone className="w-3 h-3" /> {item.foneEsposa}
                                </span>
                              )}
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => abrirModalEdicao(item)}
                            className="text-xs font-semibold text-amber-700 bg-amber-50 hover:bg-amber-100 px-2 py-1 rounded-md border border-amber-200 inline-flex items-center gap-1 transition cursor-pointer"
                            title="Clique para cadastrar a esposa deste ministro"
                          >
                            <AlertCircle className="w-3 h-3" /> Cadastrar Esposa
                          </button>
                        )}
                      </td>

                      {/* No AEMADEPA */}
                      <td className="px-4 py-3 font-mono text-xs">
                        {item.numeroAemadepa ? (
                          <span className="font-bold text-purple-700 bg-purple-50 px-2 py-1 rounded border border-purple-200">
                            {item.numeroAemadepa}
                          </span>
                        ) : (
                          <span className="text-gray-400 italic">Pendente</span>
                        )}
                      </td>

                      {/* Ministro Vinculado */}
                      <td className="px-4 py-3">
                        <p className="font-semibold text-gray-800">{item.ministroNome}</p>
                        <p className="text-xs text-gray-500">
                          Matrícula: <strong>{item.ministroMatricula || '—'}</strong>
                          {item.cargoMinisterial && ` • ${item.cargoMinisterial}`}
                        </p>
                      </td>

                      {/* Campo / Supervisão */}
                      <td className="px-4 py-3 text-xs text-gray-600">
                        <div className="flex items-center gap-1 font-medium text-gray-800">
                          <MapPin className="w-3 h-3 text-rose-500" />
                          {item.campo || '—'}
                        </div>
                        {item.supervisao && (
                          <p className="text-[11px] text-gray-400 pl-4">{item.supervisao}</p>
                        )}
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3 text-center">
                        {item.temEsposaCadastrada ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-green-100 text-green-800">
                            <CheckCircle2 className="w-3 h-3" /> Cadastrada
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800">
                            <Clock className="w-3 h-3" /> Pendente
                          </span>
                        )}
                      </td>

                      {/* Ações */}
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          {/* Edição / Cadastro */}
                          <button
                            onClick={() => abrirModalEdicao(item)}
                            className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-lg transition cursor-pointer"
                            title={item.temEsposaCadastrada ? "Editar dados da esposa" : "Cadastrar esposa"}
                          >
                            <Edit className="w-4 h-4" />
                          </button>

                          {/* Impressão de Ficha */}
                          <button
                            onClick={() => setAssociadaFicha(item)}
                            disabled={!item.temEsposaCadastrada}
                            className={`p-1.5 rounded-lg transition ${
                              item.temEsposaCadastrada
                                ? 'text-gray-600 hover:bg-gray-100 cursor-pointer'
                                : 'text-gray-300 cursor-not-allowed'
                            }`}
                            title={item.temEsposaCadastrada ? "Imprimir Ficha Cadastral AEMADEPA" : "Cadastre a esposa antes de emitir a ficha"}
                          >
                            <Printer className="w-4 h-4" />
                          </button>

                          {/* Emissão de Carteirinha */}
                          <button
                            onClick={() => setAssociadaCartao(item)}
                            disabled={!item.temEsposaCadastrada}
                            className={`p-1.5 rounded-lg transition ${
                              item.temEsposaCadastrada
                                ? 'text-purple-600 hover:bg-purple-50 cursor-pointer'
                                : 'text-gray-300 cursor-not-allowed'
                            }`}
                            title={item.temEsposaCadastrada ? "Emitir Carteirinha AEMADEPA" : "Cadastre a esposa antes de emitir a carteirinha"}
                          >
                            <CreditCard className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Paginação da Tabela */}
          <div className="px-5 py-3.5 border-t border-gray-200 bg-gray-50 flex items-center justify-between text-xs text-gray-600">
            <div>
              Mostrando {associadasFiltradas.length === 0 ? 0 : (paginaSegura - 1) * ITENS_POR_PAGINA + 1} até{' '}
              {Math.min(paginaSegura * ITENS_POR_PAGINA, associadasFiltradas.length)} de{' '}
              {associadasFiltradas.length} registro(s)
            </div>

            <div className="flex items-center gap-1">
              <button
                onClick={() => setPaginaAtual(p => Math.max(1, p - 1))}
                disabled={paginaSegura <= 1}
                className="px-3 py-1.5 rounded-md border border-gray-300 bg-white hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
              >
                Anterior
              </button>
              <span className="px-3 py-1 font-semibold text-gray-700">
                {paginaSegura} / {totalPaginas}
              </span>
              <button
                onClick={() => setPaginaAtual(p => Math.min(totalPaginas, p + 1))}
                disabled={paginaSegura >= totalPaginas}
                className="px-3 py-1.5 rounded-md border border-gray-300 bg-white hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
              >
                Próxima
              </button>
            </div>
          </div>
        </div>
      </div>
    </PageLayout>
  );
}
