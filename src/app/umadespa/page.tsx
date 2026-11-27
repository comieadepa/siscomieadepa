'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect, useCallback } from 'react';
import dynamicImport from 'next/dynamic';
import PageLayout from '@/components/PageLayout';
import { UmadespaDashboardStats } from '@/components/umadespa/UmadespaDashboardStats';
import { UmadespaFiltros } from '@/components/umadespa/UmadespaFiltros';
import { UmadespaTabela } from '@/components/umadespa/UmadespaTabela';
import {
  Sparkles,
  UserPlus,
  Link as LinkIcon,
  CreditCard,
  Settings,
  Users,
} from 'lucide-react';

// Carregamento sob demanda (Lazy Loading) para modais e painéis pesados
const ModalAssociadoUmadespa = dynamicImport(
  () => import('@/components/umadespa/ModalAssociadoUmadespa').then((m) => m.ModalAssociadoUmadespa),
  { ssr: false }
);

const ModalLiderancaUmadespa = dynamicImport(
  () => import('@/components/umadespa/ModalLiderancaUmadespa').then((m) => m.ModalLiderancaUmadespa),
  { ssr: false }
);

const PainelPedidosUmadespa = dynamicImport(
  () => import('@/components/umadespa/PainelPedidosUmadespa').then((m) => m.PainelPedidosUmadespa),
  { ssr: false }
);

const UmadespaConfiguracoesPainel = dynamicImport(
  () => import('@/components/umadespa/UmadespaConfiguracoesPainel').then((m) => m.UmadespaConfiguracoesPainel),
  { ssr: false }
);

const ModalLinkPublicoUmadespa = dynamicImport(
  () => import('@/components/umadespa/ModalLinkPublicoUmadespa').then((m) => m.ModalLinkPublicoUmadespa),
  { ssr: false }
);

const FichaCadastralUmadespa = dynamicImport(
  () => import('@/components/umadespa/FichaCadastralUmadespa').then((m) => m.FichaCadastralUmadespa),
  { ssr: false }
);

const CartaoUmadespa = dynamicImport(
  () => import('@/components/umadespa/CartaoUmadespa').then((m) => m.CartaoUmadespa),
  { ssr: false }
);

export default function UmadespaAdminPage() {
  const [abaAtiva, setAbaAtiva] = useState<'associados' | 'pedidos' | 'configuracoes'>('associados');

  // Dados de associados
  const [associados, setAssociados] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // Filtros
  const [busca, setBusca] = useState('');
  const [status, setStatus] = useState('todos');
  const [lideranca, setLideranca] = useState('todos');
  const [supervisaoId, setSupervisaoId] = useState('');
  const [campoId, setCampoId] = useState('');

  // Dados de Estrutura
  const [supervisoes, setSupervisoes] = useState<any[]>([]);
  const [campos, setCampos] = useState<any[]>([]);

  // Modais
  const [modalNovoAberto, setModalNovoAberto] = useState(false);
  const [associadoEdicao, setAssociadoEdicao] = useState<any | null>(null);
  const [associadoLideranca, setAssociadoLideranca] = useState<any | null>(null);
  const [associadoFicha, setAssociadoFicha] = useState<any | null>(null);
  const [associadoCartao, setAssociadoCartao] = useState<any | null>(null);
  const [modalLinkAberto, setModalLinkAberto] = useState(false);

  // Totais para Dashboard
  const [stats, setStats] = useState({
    totalAssociados: 0,
    totalLiderancas: 0,
    pedidosPendentes: 0,
    pedidosEmitidos: 0,
  });

  // Carrega Estrutura Eclesiástica (Supervisões e Campos)
  useEffect(() => {
    async function carregarEstrutura() {
      try {
        const res = await fetch('/api/v1/secretaria/estrutura');
        const json = await res.json();
        if (res.ok && json) {
          setSupervisoes(json.supervisoes || []);
          setCampos(json.campos || []);
        }
      } catch (err) {
        console.error('Erro ao buscar estrutura eclesiástica:', err);
      }
    }
    carregarEstrutura();
  }, []);

  // Carrega Associados
  const carregarAssociados = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', '30');

      if (busca) params.set('busca', busca);
      if (status && status !== 'todos') params.set('status', status);
      if (lideranca && lideranca !== 'todos') params.set('lideranca', lideranca);
      if (supervisaoId) params.set('supervisaoId', supervisaoId);
      if (campoId) params.set('campoId', campoId);

      const res = await fetch(`/api/v1/secretaria/umadespa/associados?${params.toString()}`);
      const json = await res.json();

      if (res.ok) {
        setAssociados(json.data || []);
        setTotal(json.total || 0);
        setTotalPages(json.totalPages || 1);

        // Atualiza stats
        const dataList = json.data || [];
        const numLideres = dataList.filter((a: any) => a.is_lideranca).length;
        setStats((prev) => ({
          ...prev,
          totalAssociados: json.total || 0,
          totalLiderancas: numLideres,
        }));
      }
    } catch (err) {
      console.error('Erro ao consultar associados:', err);
    } finally {
      setLoading(false);
    }
  }, [page, busca, status, lideranca, supervisaoId, campoId]);

  useEffect(() => {
    carregarAssociados();
  }, [carregarAssociados]);

  // Carrega contagens de pedidos para os stats do dashboard
  useEffect(() => {
    async function carregarStatsPedidos() {
      try {
        const res = await fetch('/api/v1/secretaria/umadespa/pedidos?limit=200');
        const json = await res.json();
        if (res.ok && Array.isArray(json.data)) {
          const pendentes = json.data.filter((p: any) =>
            ['aguardando_pagamento', 'processando_pagamento', 'pago', 'em_impressao'].includes(p.status)
          ).length;
          const entregues = json.data.filter((p: any) => p.status === 'entregue').length;

          setStats((prev) => ({
            ...prev,
            pedidosPendentes: pendentes,
            pedidosEmitidos: entregues,
          }));
        }
      } catch {
        // best-effort
      }
    }
    carregarStatsPedidos();
  }, []);

  const handleLimparFiltros = () => {
    setBusca('');
    setStatus('todos');
    setLideranca('todos');
    setSupervisaoId('');
    setCampoId('');
    setPage(1);
  };

  const handleSolicitarCarteirinha = async (item: any) => {
    if (!confirm(`Deseja gerar solicitação de carteirinha para ${item.nome}?`)) {
      return;
    }

    try {
      const res = await fetch('/api/v1/secretaria/umadespa/pedidos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ associado_id: item.id }),
      });
      const json = await res.json();
      if (!res.ok) {
        alert(json.error || 'Erro ao gerar pedido de carteirinha.');
        return;
      }

      alert(
        json.reutilizada
          ? 'Associado já possui pedido em andamento. Pedido reutilizado!'
          : 'Solicitação de carteirinha gerada com sucesso!'
      );
      carregarAssociados();
    } catch {
      alert('Falha na comunicação com o servidor.');
    }
  };

  return (
    <PageLayout
      title="UMADESPA"
      description="União de Mocidade das Assembleias de Deus no Estado do Pará"
      activeMenu="umadespa"
    >
      <div className="space-y-6">
        {/* Cabeçalho com Ações Rápidas */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-gradient-to-r from-emerald-800 to-teal-900 text-white rounded-2xl p-6 shadow-md">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/20 border border-emerald-400/30 text-emerald-200">
                <Sparkles className="w-3.5 h-3.5" />
                Painel da Juventude
              </span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight">Gestão Oficial UMADESPA</h1>
            <p className="text-xs text-emerald-100/80 mt-1 max-w-xl">
              Administração unificada de associados, lideranças da juventude e emissão de credenciais oficiais.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
            <button
              type="button"
              onClick={() => setModalLinkAberto(true)}
              className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-xl bg-white/10 hover:bg-white/20 text-white border border-white/20 transition-all shadow-xs"
            >
              <LinkIcon className="w-4 h-4" />
              Link Público
            </button>

            <button
              type="button"
              onClick={() => {
                setAssociadoEdicao(null);
                setModalNovoAberto(true);
              }}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 transition-all shadow-sm font-medium"
            >
              <UserPlus className="w-4 h-4" />
              Novo Membro
            </button>
          </div>
        </div>

        {/* Indicadores do Dashboard */}
        <UmadespaDashboardStats
          totalAssociados={stats.totalAssociados}
          totalLiderancas={stats.totalLiderancas}
          pedidosPendentes={stats.pedidosPendentes}
          pedidosEmitidos={stats.pedidosEmitidos}
        />

        {/* Navegação entre Abas */}
        <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-2">
          <button
            type="button"
            onClick={() => setAbaAtiva('associados')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
              abaAtiva === 'associados'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <Users className="w-4 h-4" />
            Jovens e Líderes Cadastrados
          </button>

          <button
            type="button"
            onClick={() => setAbaAtiva('pedidos')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
              abaAtiva === 'pedidos'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <CreditCard className="w-4 h-4" />
            Fila de Carteirinhas
          </button>

          <button
            type="button"
            onClick={() => setAbaAtiva('configuracoes')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
              abaAtiva === 'configuracoes'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <Settings className="w-4 h-4" />
            Parâmetros & Taxas
          </button>
        </div>

        {/* Conteúdo da Aba Ativa */}
        {abaAtiva === 'associados' && (
          <div className="space-y-4">
            <UmadespaFiltros
              busca={busca}
              onBuscaChange={(v) => {
                setBusca(v);
                setPage(1);
              }}
              status={status}
              onStatusChange={(v) => {
                setStatus(v);
                setPage(1);
              }}
              lideranca={lideranca}
              onLiderancaChange={(v) => {
                setLideranca(v);
                setPage(1);
              }}
              supervisoes={supervisoes}
              supervisaoId={supervisaoId}
              onSupervisaoChange={(v) => {
                setSupervisaoId(v);
                setPage(1);
              }}
              campos={campos}
              campoId={campoId}
              onCampoChange={(v) => {
                setCampoId(v);
                setPage(1);
              }}
              onLimparFiltros={handleLimparFiltros}
            />

            <UmadespaTabela
              associados={associados}
              loading={loading}
              page={page}
              totalPages={totalPages}
              total={total}
              onPageChange={setPage}
              onEditar={(item) => {
                setAssociadoEdicao(item);
                setModalNovoAberto(true);
              }}
              onGerenciarLideranca={(item) => setAssociadoLideranca(item)}
              onSolicitarCarteirinha={handleSolicitarCarteirinha}
              onVisualizarFicha={(item) => setAssociadoFicha(item)}
              onVisualizarCartao={(item) => setAssociadoCartao(item)}
            />
          </div>
        )}

        {abaAtiva === 'pedidos' && <PainelPedidosUmadespa />}

        {abaAtiva === 'configuracoes' && <UmadespaConfiguracoesPainel />}

        {/* Modais com Carregamento Sob Demanda */}
        {associadoCartao && (
          <CartaoUmadespa
            associado={associadoCartao}
            onClose={() => setAssociadoCartao(null)}
            onAtualizarStatus={() => carregarAssociados()}
          />
        )}
        {associadoFicha && (
          <FichaCadastralUmadespa
            associado={associadoFicha}
            onClose={() => setAssociadoFicha(null)}
          />
        )}
        {modalNovoAberto && (
          <ModalAssociadoUmadespa
            isOpen={modalNovoAberto}
            associado={associadoEdicao}
            supervisoes={supervisoes}
            campos={campos}
            onClose={() => {
              setModalNovoAberto(false);
              setAssociadoEdicao(null);
            }}
            onSalvo={carregarAssociados}
          />
        )}

        {associadoLideranca && (
          <ModalLiderancaUmadespa
            isOpen={Boolean(associadoLideranca)}
            associado={associadoLideranca}
            onClose={() => setAssociadoLideranca(null)}
            onSalvo={carregarAssociados}
          />
        )}

        {modalLinkAberto && (
          <ModalLinkPublicoUmadespa
            isOpen={modalLinkAberto}
            onClose={() => setModalLinkAberto(false)}
          />
        )}
      </div>
    </PageLayout>
  );
}
