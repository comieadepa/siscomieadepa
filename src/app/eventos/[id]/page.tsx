'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import PageLayout from '@/components/PageLayout';
import { useRequireSupabaseAuth } from '@/hooks/useRequireSupabaseAuth';
import { useEventosPerfil } from '@/hooks/useEventosPerfil';
import { createClient } from '@/lib/supabase-client';
import { getEquipeSession } from '@/lib/equipe-session';
import type { EquipeSession } from '@/lib/equipe-session';
import { generateQRCodeToken } from '@/lib/qrcode-token';
import { normalizePayloadUppercase } from '@/lib/text';
import { authenticatedFetch } from '@/lib/api-client';
import { EtiquetaPreviewDepartamento, EtiquetaPreviewAGO } from '@/components/EtiquetaLabels';
import type { EtiquetaInscricaoAGO } from '@/components/EtiquetaLabels';
import { Pencil, KeyRound, Mail, PowerOff, Power, Trash2 } from 'lucide-react';
import TabHospedagem    from './TabHospedagem';
import TabBackup        from './TabBackup';
import TabProgramacao   from './TabProgramacao';
import TabCertificados  from './TabCertificados';
import TabControleAGO  from './TabControleAGO';

// ─── Tipos ───────────────────────────────────────────────────────────────
interface Supervisao { id: string; nome: string; }
interface Campo      { id: string; nome: string; supervisao_id: string; }

interface Evento {
  id: string; nome: string; slug: string; descricao: string | null;
  departamento: string; data_inicio: string; data_fim: string;
  local: string | null; cidade: string | null;
  supervisao_id: string | null; campo_id: string | null;
  banner_url: string | null; valor_inscricao: number;
  usar_tipos_inscricao: boolean;
  permite_hospedagem: boolean; permite_alimentacao: boolean;
  permite_brinde: boolean; gerar_certificado: boolean;
  link_whatsapp: string | null; mensagem_confirmacao: string | null;
  inscricoes_abertas: boolean; limite_vagas: number | null;
  limite_hospedagem: number | null; limite_brindes: number | null;
  publico_alvo: string | null;
  status: 'programado' | 'realizado' | 'cancelado' | 'encerrado';
  checkin_ativo: boolean;
  created_at: string;
  encerrado_em: string | null;
  configuracoes_ago: Record<string, unknown> | null;
}

interface Inscricao {
  id: string; evento_id: string; ministro_id: string | null;
  nome_inscrito: string; cpf: string | null; email: string | null;
  telefone: string | null; whatsapp: string | null; sexo: string | null;
  data_nascimento: string | null;
  supervisao_id: string | null; campo_id: string | null;
  hospedagem: boolean; alimentacao: boolean; brinde: boolean;
  // campos da evolução de inscrições
  tipo_inscricao: string | null;
  valor_original: number | null;
  cupom_codigo: string | null;
  desconto_valor: number;
  valor_final: number | null;
  direito_brinde: boolean;
  lote_id: string | null;
  valor_pago: number; status_pagamento: string; forma_pagamento: string | null;
  asaas_payment_id: string | null; comprovante_url: string | null;
  qr_code: string | null; checkin_realizado: boolean; checkin_at: string | null;
  etiqueta_impressa: boolean; certificado_enviado: boolean;
  observacoes: string | null; created_at: string;
}

interface EventoResumo {
  id: string;
  nome: string;
  departamento: string;
  status: 'programado' | 'realizado' | 'cancelado' | 'encerrado';
  data_inicio: string | null;
  data_fim: string | null;
  valor_inscricao: number;
  usar_tipos_inscricao: boolean;
  permite_hospedagem: boolean;
  permite_alimentacao: boolean;
  permite_brinde: boolean;
  limite_vagas: number | null;
  limite_hospedagem: number | null;
  limite_brindes: number | null;
}

interface TipoInscricao {
  id: string;
  nome: string;
  valor: number;
  inclui_alimentacao: boolean;
  inclui_hospedagem: boolean;
  ativo: boolean;
  ordem: number;
}

interface EditForm {
  evento_id: string;
  nome_inscrito: string;
  cpf: string;
  email: string;
  whatsapp: string;
  sexo: string;
  data_nascimento: string;
  supervisao_id: string;
  campo_id: string;
  tipo_inscricao: string;
  hospedagem: boolean;
  alimentacao: boolean;
  brinde: boolean;
  observacoes: string;
}

interface Equipe {
  id: string;
  evento_id: string;
  nome: string | null;
  email: string;
  tipo: 'operador' | 'checkin' | 'hospedagem' | 'checkin_hospedagem';
  ativo: boolean;
  created_at: string;
  ultimo_acesso_em: string | null;
}

interface Ministro {
  id: string; nome: string; cpf: string | null;
  celular: string | null; whatsapp: string | null;
  email: string | null; supervisao: string | null; campo: string | null;
  supervisao_id?: string | null; campo_id?: string | null;
}

type TabId = 'inscritos' | 'inscricao-manual' | 'checkin' | 'etiquetas' | 'financeiro' | 'relatorios' | 'comunicacao' | 'equipe' | 'configuracoes' | 'hospedagem' | 'backup' | 'programacao' | 'certificados' | 'relatorios-ago' | 'ausentes' | 'homologacao' | 'deliberacoes' | 'controle-ago';
// Nota: 'inscricao-manual' e 'configuracoes' mantidos no tipo para compatibilidade com ?tab= mas removidos da nav

// ─── Helpers ─────────────────────────────────────────────────────────────
const fmtData = (d: string | null) => {
  if (!d) return '-';
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y}`;
};
const fmtMoeda = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtDT = (d: string | null) => {
  if (!d) return '-';
  const dt = new Date(d);
  return dt.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
};

const DEPT_LOGOS: Record<string, string> = {
  AGO: '/img/logo_ago.png',
  COADESPA: '/img/logo_comieadepa.png',
  UMADESPA: '/img/logo_comieadepa.png',
  SEIADEPA: '/img/logo_comieadepa.png',
  AVULSO: '/img/logo_comieadepa.png',
  CONEC: '/img/logo_conec.png',
  CGADB: '/img/logo_cgadb.png',
};

const getDeptLogo = (dept?: string | null) => {
  if (!dept) return '/img/logo_comieadepa.png';
  return DEPT_LOGOS[dept] ?? '/img/logo_comieadepa.png';
};

const STATUS_PAG_CFG: Record<string, { label: string; cls: string }> = {
  pendente:  { label: 'Pendente',  cls: 'bg-yellow-100 text-yellow-700' },
  pago:      { label: 'Pago',      cls: 'bg-green-100 text-green-700'  },
  isento:    { label: 'Isento',    cls: 'bg-blue-100  text-blue-700'   },
  cancelado: { label: 'Cancelado', cls: 'bg-red-100   text-red-700'    },
};

const STATUS_EV_CFG = {
  programado: { label: 'Programado',    cls: 'bg-blue-100 text-blue-700'     },
  realizado:  { label: 'Realizado',     cls: 'bg-green-100 text-green-700'   },
  cancelado:  { label: 'Cancelado',     cls: 'bg-red-100 text-red-700'       },
  encerrado:  { label: 'AGO Encerrada', cls: 'bg-red-700 text-white font-black' },
};

const inputCls = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#123b63] bg-white';
const labelCls = 'block text-xs font-semibold text-gray-600 mb-1';

// ─── Componente principal ─────────────────────────────────────────────────
export default function GerenciarEventoPage() {
  const params = useParams();
  const id = params?.id as string;
  const { loading: authLoading } = useRequireSupabaseAuth({ allowEquipeSession: { eventoId: id } });
  const perfil = useEventosPerfil();
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = useMemo(() => createClient(), []);
  const [equipeSessao, setEquipeSessao] = useState<EquipeSession | null>(null);

  const [evento,     setEvento]     = useState<Evento | null>(null);
  const [inscricoes, setInscricoes] = useState<Inscricao[]>([]);
  const [equipe,     setEquipe]     = useState<Equipe[]>([]);
  const [supervisoes, setSupervisoes] = useState<Supervisao[]>([]);
  const [campos,      setCampos]     = useState<Campo[]>([]);
  const [loadingEvento, setLoadingEvento] = useState(true);
  const [loadingInsc,   setLoadingInsc]   = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>('inscritos');
  const [encerrandoAGO, setEncerrandoAGO] = useState(false);
  const [showEncerrarModal, setShowEncerrarModal] = useState(false);
  const [pausandoInscricoes, setPausandoInscricoes] = useState(false);
  const tabsTrackRef = useRef<HTMLDivElement | null>(null);
  const tabButtonRefs = useRef(new Map<TabId, HTMLButtonElement | null>());
  const [showLeftFade, setShowLeftFade] = useState(false);
  const [showRightFade, setShowRightFade] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [acessoNegado, setAcessoNegado] = useState(false);

  const updateTabFade = useCallback(() => {
    const el = tabsTrackRef.current;
    if (!el) return;
    const maxScroll = el.scrollWidth - el.clientWidth;
    if (maxScroll <= 0) {
      setShowLeftFade(false);
      setShowRightFade(false);
      return;
    }
    setShowLeftFade(el.scrollLeft > 4);
    setShowRightFade(el.scrollLeft < maxScroll - 4);
  }, []);

  const setTabRef = useCallback((tabId: TabId) => (el: HTMLButtonElement | null) => {
    tabButtonRefs.current.set(tabId, el);
  }, []);

  // Permissão específica para este evento
  const permissaoNesseEvento = useMemo(
    () => (id && !perfil.loading ? perfil.permissaoParaEvento(id) : null),
    [id, perfil]
  );

  const isAGO = evento?.departamento === 'AGO';

  const podeEditarInscritos = perfil.podeEditarInscricoes;
  const podeRemoverInscricao = perfil.podeRemoverInscricao;
  const podeMoverInscricao = perfil.podeMoverInscricao;
  const podeComunicacao = perfil.podeComunicacao;
  const podeCertificados = perfil.podeCertificados;

  // Abas visíveis baseadas na permissão do usuário neste evento
  const TODAS_TABS: { id: TabId; label: string; icon: string }[] = [
    { id: 'inscritos',    label: 'Inscritos',          icon: '👥' },
    { id: 'checkin',     label: 'Check-in',            icon: '✅' },
    { id: 'etiquetas',   label: 'Etiquetas',           icon: '🏷️' },
    { id: 'hospedagem',  label: 'Hospedagem',          icon: '🏨' },
    { id: 'equipe',      label: 'Equipe',              icon: '👤' },
    { id: 'comunicacao', label: 'Comunicação',         icon: '📣' },
    { id: 'financeiro',  label: 'Financeiro',          icon: '💳' },
    { id: 'backup',      label: 'Backup / Exportação', icon: '💾' },
    { id: 'certificados',label: 'Certificados',        icon: '🎓' },
    { id: 'programacao',    label: 'Programação',   icon: '📋' },
    { id: 'relatorios',     label: 'Relatórios',    icon: '📊' },
    ...(isAGO ? [
      { id: 'relatorios-ago' as TabId, label: 'Relatórios AGO',    icon: '📈' },
      { id: 'ausentes'       as TabId, label: 'Ausentes',          icon: '🚨' },
      { id: 'homologacao'    as TabId, label: 'Homologação',       icon: '⚖️' },
      { id: 'deliberacoes'   as TabId, label: 'Deliberações',      icon: '📜' },
      { id: 'controle-ago'   as TabId, label: 'Centro de Controle', icon: '📊' },
    ] : []),
  ];

  const tabsPermitidasEvento = id ? perfil.tabsPermitidasParaEvento(id) : perfil.tabsPermitidas;

  const tabsVisiveis = (() => {
    if (perfil.loading) return TODAS_TABS;
    if (perfil.isGlobal) return TODAS_TABS;
    if (permissaoNesseEvento === 'hospedagem') {
      return TODAS_TABS.filter(t => t.id === 'hospedagem');
    }
    if (permissaoNesseEvento === 'checkin_hospedagem') {
      return [];
    }
    return TODAS_TABS.filter(t => {
      if (t.id === 'relatorios-ago' || t.id === 'ausentes' || t.id === 'homologacao' || t.id === 'deliberacoes' || t.id === 'controle-ago') return isAGO && perfil.podeEditar;
      return tabsPermitidasEvento.includes(t.id as import('@/hooks/useEventosPerfil').TabEventoId);
    });
  })();

  useEffect(() => {
    if (perfil.loading) return;
    if (!tabsVisiveis.some(t => t.id === activeTab)) {
      setActiveTab(tabsVisiveis[0]?.id ?? 'inscritos');
    }
  }, [tabsVisiveis, activeTab, perfil.loading]);

  useEffect(() => {
    const el = tabsTrackRef.current;
    if (!el) return;
    const onScroll = () => updateTabFade();
    updateTabFade();
    el.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', updateTabFade);
    return () => {
      el.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', updateTabFade);
    };
  }, [updateTabFade, tabsVisiveis]);

  useEffect(() => {
    const btn = tabButtonRefs.current.get(activeTab);
    if (!btn) return;
    btn.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [activeTab, tabsVisiveis]);

  // ── Carrega dados base ───────────────────────────────────────
  const fetchEvento = useCallback(async () => {
    if (!id) return;
    setLoadingEvento(true);

    // Usuários de equipe sem conta Supabase: usa endpoint dedicado (bypass RLS)
    const equipeSessaoAtual = getEquipeSession();
    if (equipeSessaoAtual && equipeSessaoAtual.eventoId === id) {
      try {
        const res = await fetch(`/api/eventos/${id}/equipe-dados?equipeId=${equipeSessaoAtual.equipeId}&tipo=evento`);
        if (res.ok) {
          const json = await res.json();
          if (json.evento) { setEvento(json.evento as Evento); setLoadingEvento(false); return; }
        }
      } catch { /* cai no fallback abaixo */ }
    }

    const { data, error } = await supabase.from('eventos').select('*').eq('id', id).single();
    if (error || !data) { setErro('Evento não encontrado.'); setLoadingEvento(false); return; }
    // Gate de departamento: isDeptAdmin só acessa eventos do seu dept (exceto subcategoria TODOS)
    if (perfil.isDeptAdmin && perfil.departamentoUsuario !== 'TODOS' && (data as Evento).departamento !== perfil.departamentoUsuario) {
      setAcessoNegado(true); setLoadingEvento(false); return;
    }
    if (permissaoNesseEvento === 'operador' && (data as Evento).status !== 'programado') {
      setAcessoNegado(true); setLoadingEvento(false); return;
    }
    setEvento(data as Evento);
    setLoadingEvento(false);
  }, [id, supabase, perfil.isDeptAdmin, perfil.departamentoUsuario, permissaoNesseEvento]);

  const fetchInscricoes = useCallback(async () => {
    if (!id) return;
    setLoadingInsc(true);

    // Usuários de equipe sem conta Supabase: usa endpoint dedicado (bypass RLS)
    const equipeSessaoAtual = getEquipeSession();
    if (equipeSessaoAtual && equipeSessaoAtual.eventoId === id) {
      try {
        const res = await fetch(`/api/eventos/${id}/equipe-dados?equipeId=${equipeSessaoAtual.equipeId}&tipo=inscricoes`);
        if (res.ok) {
          const json = await res.json();
          setInscricoes((json.inscricoes as Inscricao[]) || []);
          setLoadingInsc(false);
          return;
        }
      } catch { /* cai no fallback abaixo */ }
    }

    const { data } = await supabase
      .from('evento_inscricoes')
      .select('*')
      .eq('evento_id', id)
      .order('created_at', { ascending: false });
    setInscricoes((data as Inscricao[]) || []);
    setLoadingInsc(false);
  }, [id, supabase]);

  const fetchEquipe = useCallback(async () => {
    if (!id) return;
    const { data } = await supabase.from('evento_equipe').select('*').eq('evento_id', id).order('created_at');
    setEquipe((data as Equipe[]) || []);
  }, [id, supabase]);

  useEffect(() => {
    setEquipeSessao(getEquipeSession());
  }, [id]);

  useEffect(() => {
    if (authLoading || perfil.loading) return;

    if (equipeSessao && equipeSessao.eventoId === id) {
      if (equipeSessao.tipo === 'checkin') {
        router.replace(`/eventos/${id}/checkin`);
        return;
      }
      if (equipeSessao.tipo === 'checkin_hospedagem') {
        router.replace(`/eventos/${id}/hospedagem/checkin`);
        return;
      }
    }

    // Gate de acesso: bloqueia acesso direto por URL
    if (!perfil.isGlobal && id && !perfil.podeAcessarEvento(id)) {
      // Fallback: lê sessão de equipe diretamente do localStorage para cobrir edge cases
      // de timing onde permissoesPorEvento ainda não foi populado quando este effect dispara
      const sessCheck = getEquipeSession();
      if (!sessCheck || sessCheck.eventoId !== id) {
        setAcessoNegado(true);
        setLoadingEvento(false);
        return;
      }
      // Sessão de equipe válida — permite continuar
    }

    // Perfis de equipe abrem direto em sua area
    if (!perfil.isGlobal && permissaoNesseEvento === 'checkin') {
      setActiveTab('checkin');
    } else if (!perfil.isGlobal && permissaoNesseEvento === 'hospedagem') {
      setActiveTab('hospedagem');
    } else if (!perfil.isGlobal && permissaoNesseEvento === 'checkin_hospedagem') {
      router.replace(`/eventos/${id}/hospedagem/checkin`);
      return;
    } else {
      // Aplica aba inicial via query param ?tab=X
      const tabParam = searchParams?.get('tab') as TabId | null;
      const TABS_VALIDAS: TabId[] = ['inscritos','inscricao-manual','checkin','etiquetas','financeiro','relatorios','comunicacao','equipe','configuracoes','hospedagem','backup','programacao','certificados','relatorios-ago','ausentes','homologacao','deliberacoes','controle-ago']; // inscricao-manual e configuracoes acessíveis via ?tab= mas não mostrados na nav
      if (tabParam && TABS_VALIDAS.includes(tabParam)) {
        setActiveTab(tabParam);
      }
    }

    Promise.all([
      fetchEvento(),
      (permissaoNesseEvento === 'hospedagem' || permissaoNesseEvento === 'checkin_hospedagem') ? Promise.resolve() : fetchInscricoes(),
      (permissaoNesseEvento === 'hospedagem' || permissaoNesseEvento === 'checkin_hospedagem') ? Promise.resolve() : fetchEquipe(),
      authenticatedFetch('/api/v1/estrutura').then(async (res) => {
        if (!res.ok) return;
        const estrutura = await res.json().catch(() => null as any);
        setSupervisoes((estrutura?.supervisoes as Supervisao[]) || []);
        setCampos((estrutura?.campos as Campo[]) || []);
      }),
    ]);
  }, [authLoading, perfil.loading, perfil.isGlobal, id, permissaoNesseEvento, equipeSessao, fetchEvento, fetchInscricoes, fetchEquipe, supabase, router, searchParams]);

  // ── Toggle inscrições abertas/pausadas ───────────────────────
  async function toggleInscricoes() {
    if (!evento || pausandoInscricoes) return;
    const novoValor = !evento.inscricoes_abertas;
    setPausandoInscricoes(true);
    const { error } = await supabase
      .from('eventos')
      .update({ inscricoes_abertas: novoValor })
      .eq('id', evento.id);
    if (!error) {
      setEvento(ev => ev ? { ...ev, inscricoes_abertas: novoValor } : ev);
    }
    setPausandoInscricoes(false);
  }

  // ── Stats calculadas ─────────────────────────────────────────
  const stats = useMemo(() => {
    const pagos    = inscricoes.filter(i => i.status_pagamento === 'pago');
    const pend     = inscricoes.filter(i => i.status_pagamento === 'pendente');
    const isentos  = inscricoes.filter(i => i.status_pagamento === 'isento');
    return {
      total:        inscricoes.length,
      pagos:        pagos.length,
      pendentes:    pend.length,
      isentos:      isentos.length,
      arrecadado:   pagos.reduce((a, i) => a + (i.valor_pago || 0), 0),
      checkins:     inscricoes.filter(i => i.checkin_realizado).length,
      etiquetas:    inscricoes.filter(i => i.etiqueta_impressa).length,
    };
  }, [inscricoes]);

  const nomeSup = (sid: string | null) => supervisoes.find(s => s.id === sid)?.nome ?? '-';
  const nomeCampo = (cid: string | null) => campos.find(c => c.id === cid)?.nome ?? '-';

  if (authLoading || perfil.loading || loadingEvento) return (
    <PageLayout title="Gerenciar Evento" description="" activeMenu="eventos">
      <div className="space-y-4">
        {[1, 2, 3].map(i => (
          <div key={i} className="bg-white rounded-xl p-6 animate-pulse">
            <div className="h-5 bg-gray-200 rounded w-1/3 mb-3" />
            <div className="h-3 bg-gray-200 rounded w-2/3" />
          </div>
        ))}
      </div>
    </PageLayout>
  );

  if (acessoNegado) return (
    <PageLayout title="Acesso Negado" description="" activeMenu="eventos">
      <div className="bg-red-50 border border-red-200 rounded-xl p-10 text-center max-w-md mx-auto">
        <span className="text-5xl mb-4 block">🔒</span>
        <p className="text-red-700 font-bold text-lg mb-2">Acesso não autorizado</p>
        <p className="text-sm text-red-500 mb-5">Você não tem permissão para acessar este evento.</p>
        <button onClick={() => router.push('/eventos')} className="bg-[#123b63] text-white px-5 py-2 rounded-lg text-sm font-semibold hover:bg-[#0f2a45] transition">
          ← Voltar para Eventos
        </button>
      </div>
    </PageLayout>
  );

  if (erro || !evento) return (
    <PageLayout title="Evento" description="" activeMenu="eventos">
      <div className="bg-red-50 border border-red-200 rounded-xl p-8 text-center">
        <p className="text-red-600 font-semibold">{erro || 'Evento não encontrado.'}</p>
        <button onClick={() => router.push('/eventos')} className="mt-4 text-sm text-[#123b63] underline">
          ← Voltar para Eventos
        </button>
      </div>
    </PageLayout>
  );

  const evCfg = STATUS_EV_CFG[evento.status] ?? STATUS_EV_CFG.programado;

  return (
    <PageLayout
      title={evento.nome}
      description={`${evento.departamento} • ${fmtData(evento.data_inicio)} → ${fmtData(evento.data_fim)}`}
      activeMenu="eventos"
    >

      {/* ── HEADER DO EVENTO ─────────────────────────────────── */}
      <div className="bg-white rounded-2xl shadow border border-gray-200 mb-6 overflow-hidden">
        {/* Faixa superior azul com banner */}
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(180px,220px)_minmax(0,1fr)_auto]">
          {/* Banner / imagem */}
          <div className="relative w-full bg-gradient-to-br from-[#0D2B4E] to-[#1a4a7a] flex items-center justify-center min-h-[160px] lg:min-h-0">
            {evento.banner_url
              ? <img src={evento.banner_url} alt={evento.nome} className="w-full h-full object-cover absolute inset-0" />
              : <span className="text-7xl select-none opacity-80">📅</span>
            }
            {/* Sobreposição dourada na borda esquerda */}
            <div className="absolute left-0 top-0 bottom-0 w-1 bg-[#D9A520]" />
          </div>

          {/* Info principal */}
          <div className="min-w-0 p-5 md:p-6">
            <div className="min-w-0">
              {/* Badges de status */}
              <div className="flex flex-wrap gap-1.5 mb-2.5">
                <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${evCfg.cls}`}>{evCfg.label}</span>
                <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-[#0D2B4E]/10 text-[#0D2B4E]">{evento.departamento}</span>
                {evento.inscricoes_abertas
                  ? <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700">✅ Inscrições abertas</span>
                  : <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-gray-100 text-gray-500">🔒 Inscrições fechadas</span>
                }
                {evento.status === 'encerrado' && evento.encerrado_em && (
                  <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-red-100 text-red-700">
                    🔒 Encerrada em {fmtDT(evento.encerrado_em)}
                  </span>
                )}
              </div>
              <h1 className="text-xl font-black text-[#0D2B4E] mb-1.5 leading-snug">{evento.nome}</h1>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                <span className="flex items-center gap-1">📅 {fmtData(evento.data_inicio)}{evento.data_fim !== evento.data_inicio ? ` → ${fmtData(evento.data_fim)}` : ''}</span>
                {(evento.local || evento.cidade) && <span className="flex items-center gap-1">📍 {[evento.local, evento.cidade].filter(Boolean).join(' — ')}</span>}
                {evento.supervisao_id && <span className="flex items-center gap-1">🗂️ {nomeSup(evento.supervisao_id)}</span>}
                {evento.campo_id      && <span className="flex items-center gap-1">⛪ {nomeCampo(evento.campo_id)}</span>}
              </div>
            </div>
          </div>

          {/* Botões de ação — agrupados à direita */}
          <div className="flex flex-wrap gap-2 px-5 pt-2 pb-5 md:px-6 md:pb-6 border-t border-gray-100 lg:border-t-0 lg:mt-0 lg:pt-6 lg:pb-0 lg:pr-6 lg:pl-0 lg:flex-col lg:flex-nowrap lg:items-end lg:self-start">
            <button
              onClick={() => router.push('/eventos')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-white text-gray-600 hover:bg-gray-50 border border-gray-200 transition"
            >
              ← Voltar
            </button>
            {perfil.podeEditar && (
              <button onClick={() => router.push(`/eventos/${id}/editar`)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-200 transition">
                ✏️ Editar
              </button>
            )}
            <a href={`/inscricao/${evento.slug}`} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 transition">
              🌐 Pág. Pública
            </a>
            <a href={`/eventos/${id}/display`} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-[#0D2B4E] text-white hover:bg-[#0a1e38] transition">
              📺 Display
            </a>
            <a href={`/eventos/${id}/balcao`} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-[#D9A520] text-white hover:bg-[#b8861a] transition">
              🏪 Balcão
            </a>
            {isAGO && evento.status === 'programado' && perfil.podeEditar && (
              <button
                onClick={() => setShowEncerrarModal(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-red-700 text-white hover:bg-red-800 transition"
              >
                🔒 Encerrar AGO
              </button>
            )}
            {perfil.podeEditar && evento.status === 'programado' && (
              <button
                onClick={toggleInscricoes}
                disabled={pausandoInscricoes}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition disabled:opacity-60 ${
                  evento.inscricoes_abertas
                    ? 'bg-amber-500 text-white hover:bg-amber-600'
                    : 'bg-emerald-600 text-white hover:bg-emerald-700'
                }`}
                title={evento.inscricoes_abertas ? 'Pausar inscrições (emergência ASAAS/Webhook)' : 'Retomar inscrições'}
              >
                {pausandoInscricoes
                  ? '...'
                  : evento.inscricoes_abertas
                    ? '⏸ Pausar Inscrições'
                    : '▶ Retomar Inscrições'
                }
              </button>
            )}
          </div>
        </div>

        {/* Faixa de métricas — fundo gradiente sutil */}
        <div className="border-t border-gray-100 bg-gradient-to-r from-[#0D2B4E]/[0.03] to-transparent">
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 lg:divide-x divide-gray-100">
            {[
              { label: 'Inscritos',  value: stats.total,               icon: '👥', color: 'text-[#0D2B4E]',   bgIcon: 'bg-[#0D2B4E]/10', show: true },
              { label: 'Pagos',      value: stats.pagos,               icon: '💳', color: 'text-emerald-700', bgIcon: 'bg-emerald-100',   show: true },
              { label: 'Pendentes',  value: stats.pendentes,           icon: '⏳', color: 'text-amber-600',   bgIcon: 'bg-amber-100',     show: perfil.podeVerFinanceiro },
              { label: 'Isentos',    value: stats.isentos,             icon: '🎟️', color: 'text-blue-600',    bgIcon: 'bg-blue-100',      show: perfil.podeVerFinanceiro },
              { label: 'Check-ins',  value: stats.checkins,            icon: '✅', color: 'text-purple-700',  bgIcon: 'bg-purple-100',    show: true },
              { label: 'Etiquetas',  value: stats.etiquetas,           icon: '🏷️', color: 'text-gray-600',    bgIcon: 'bg-gray-100',      show: true },
              { label: 'Arrecadado', value: fmtMoeda(stats.arrecadado),icon: '💰', color: 'text-[#D9A520]',   bgIcon: 'bg-amber-100',     show: perfil.podeVerFinanceiro },
            ].filter(s => s.show).map(s => (
              <div key={s.label} className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 lg:border-b-0">
                <div className={`w-8 h-8 rounded-lg ${s.bgIcon} flex items-center justify-center text-sm flex-shrink-0`}>{s.icon}</div>
                <div>
                  <p className={`font-black text-base leading-tight ${s.color}`}>{s.value}</p>
                  <p className="text-[10px] text-gray-400 uppercase tracking-wide">{s.label}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── ABAS ────────────────────────────────────────────────── */}
      <div className="relative">
        {/* Trilho com scroll horizontal */}
        <div
          ref={tabsTrackRef}
          className="flex flex-nowrap overflow-x-auto gap-1 px-1 sm:px-0 pb-0"
          style={{ scrollbarWidth: 'thin', scrollBehavior: 'smooth' }}
        >
          {tabsVisiveis.map(tab => (
            <button
              key={tab.id}
              ref={setTabRef(tab.id)}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 whitespace-nowrap px-4 py-2.5 text-xs font-bold rounded-t-xl border border-b-0 transition-all flex-shrink-0 ${
                activeTab === tab.id
                  ? 'bg-[#0D2B4E] text-white border-[#0D2B4E] shadow-md relative z-10'
                  : 'bg-gray-100 text-gray-500 border-gray-200 hover:bg-gray-200 hover:text-gray-700'
              }`}
            >
              <span className="text-sm">{tab.icon}</span>
              <span>{tab.label}</span>
              {tab.id === 'inscritos' && (
                <span
                  className={`ml-1 text-[10px] px-1.5 py-0.5 rounded-full font-black ${
                    activeTab === tab.id ? 'bg-white/25 text-white' : 'bg-white text-[#0D2B4E] border border-gray-200'
                  }`}
                >
                  {stats.total}
                </span>
              )}
            </button>
          ))}
        </div>
        {showLeftFade && (
          <div className="pointer-events-none absolute left-0 top-0 bottom-0 w-6 bg-gradient-to-r from-white to-white/0" />
        )}
        {showRightFade && (
          <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-white to-white/0" />
        )}
        {/* Linha de base que conecta as abas ao conteúdo */}
        <div className="h-0.5 bg-[#0D2B4E] rounded-b" />
      </div>

      {/* ── CABEÇALHO DA ABA ATIVA ─────────────────────────────── */}
      {(() => {
        const tab = tabsVisiveis.find(t => t.id === activeTab) ?? TODAS_TABS.find(t => t.id === activeTab);
        if (!tab) return null;
        const TAB_DESCS: Partial<Record<TabId, string>> = {
          inscritos:    'Lista completa de inscrições com filtros, ações e envio de certificados',
          checkin:      'Realize check-ins manuais ou via QR Code no celular',
          etiquetas:    'Impressão em massa e controle de crachás',
          financeiro:   'Visão financeira, baixas manuais e movimentações',
          comunicacao:  'Histórico de notificações e reenvio de confirmações',
          equipe:           'Operadores e permissões de acesso a este evento',
          hospedagem:       'Gestão de alojamentos e alocação de participantes',
          backup:           'Exportação de dados e backup do evento',
          certificados:     'Emissão, envio e configuração visual dos certificados',
          programacao:      'Agenda, sessões e grade do evento',
          relatorios:       'Relatórios gerenciais por supervisão, campo e financeiro',
          'relatorios-ago': 'Painel de indicadores e atalhos para relatórios da AGO',
          ausentes:         'Lista de ministros ausentes nas plenárias',
          homologacao:      'Homologação administrativa da frequência para geração de advertências',
          deliberacoes:     'Deliberações oficiais aprovadas durante a AGO',
        };
        const desc = TAB_DESCS[tab.id];
        const BADGE: Partial<Record<TabId, React.ReactNode>> = {
          inscritos:    <span className="bg-white/20 text-white text-xs font-black px-3 py-1 rounded-full">{stats.total} inscrito{stats.total !== 1 ? 's' : ''}</span>,
          checkin:      <span className="bg-white/20 text-white text-xs font-black px-3 py-1 rounded-full">{stats.checkins} check-in{stats.checkins !== 1 ? 's' : ''}</span>,
          etiquetas:    <span className="bg-white/20 text-white text-xs font-black px-3 py-1 rounded-full">{stats.etiquetas} impressa{stats.etiquetas !== 1 ? 's' : ''}</span>,
          financeiro:   perfil.podeVerFinanceiro ? <span className="bg-[#D9A520]/30 text-[#D9A520] text-xs font-black px-3 py-1 rounded-full">{fmtMoeda(stats.arrecadado)}</span> : null,
        };
        return (
          <div className="bg-gradient-to-r from-[#163B66] to-[#1B4B80] px-6 py-4 rounded-b-xl mb-6 flex flex-wrap items-center gap-3 shadow-md border-b border-white/10">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 bg-white/15 rounded-xl flex items-center justify-center text-xl flex-shrink-0">
                {tab.icon}
              </div>
              <div>
                <h2 className="text-white font-black text-base leading-tight">{tab.label}</h2>
                {desc && <p className="hidden sm:block text-white/55 text-xs mt-0.5">{desc}</p>}
              </div>
            </div>
            <div className="sm:ml-auto">{BADGE[tab.id] ?? null}</div>
          </div>
        );
      })()}

      {/* ── CONTEÚDO DAS ABAS ────────────────────────────────────── */}
      {activeTab === 'inscritos' && (
        <TabInscritos
          inscricoes={inscricoes}
          loading={loadingInsc}
          supervisoes={supervisoes}
          campos={campos}
          nomeSup={nomeSup}
          nomeCampo={nomeCampo}
          onRefresh={fetchInscricoes}
          supabase={supabase}
          evento={evento}
          podeEditar={podeEditarInscritos}
          podeRemover={podeRemoverInscricao}
          podeMover={podeMoverInscricao}
          podeComunicacao={podeComunicacao}
          podeCertificados={podeCertificados}
        />
      )}
      {activeTab === 'inscricao-manual' && (
        <TabInscricaoManual
          eventoId={id}
          evento={evento}
          supervisoes={supervisoes}
          campos={campos}
          supabase={supabase}
          onSalvo={fetchInscricoes}
        />
      )}
      {activeTab === 'checkin' && (
        <TabCheckin
          eventoId={id}
          evento={evento}
          inscricoes={inscricoes}
          loading={loadingInsc}
          nomeSup={nomeSup}
          nomeCampo={nomeCampo}
          supabase={supabase}
          onRefresh={fetchInscricoes}
        />
      )}
      {activeTab === 'etiquetas' && (
        <TabEtiquetas
          inscricoes={inscricoes}
          loading={loadingInsc}
          nomeSup={nomeSup}
          nomeCampo={nomeCampo}
          supabase={supabase}
          onRefresh={fetchInscricoes}
          evento={evento}
          eventoId={id}
        />
      )}
      {activeTab === 'financeiro' && (
        <TabFinanceiro
          inscricoes={inscricoes}
          loading={loadingInsc}
          stats={stats}
          supervisoes={supervisoes}
          campos={campos}
          nomeSup={nomeSup}
          nomeCampo={nomeCampo}
          onRefresh={fetchInscricoes}
        />
      )}
      {activeTab === 'relatorios' && (
        <TabRelatorios
          inscricoes={inscricoes}
          loading={loadingInsc}
          supervisoes={supervisoes}
          campos={campos}
          nomeSup={nomeSup}
          nomeCampo={nomeCampo}
          podeVerFinanceiro={perfil.podeVerFinanceiro}
          evento={evento}
          eventoId={id}
        />
      )}
      {activeTab === 'comunicacao' && (
        <TabComunicacao eventoId={id} supabase={supabase} />
      )}
      {activeTab === 'hospedagem' && (
        <TabHospedagem eventoId={id} evento={evento} supervisoes={supervisoes} campos={campos} nomeSup={nomeSup} nomeCampo={nomeCampo} supabase={supabase} />
      )}
      {activeTab === 'equipe' && (
        <TabEquipe
          eventoId={id}
          evento={evento}
          equipe={equipe}
          supabase={supabase}
          onRefresh={fetchEquipe}
        />
      )}
      {activeTab === 'configuracoes' && (
        <TabConfiguracoes evento={evento} nomeSup={nomeSup} nomeCampo={nomeCampo} podeEditar={perfil.podeEditar} />
      )}
      {activeTab === 'backup' && (
        <TabBackup
          evento={evento}
          eventoId={id}
          inscricoes={inscricoes}
          podeVerFinanceiro={perfil.podeVerFinanceiro}
          nomeSup={nomeSup}
          nomeCampo={nomeCampo}
          supabase={supabase}
        />
      )}
      {activeTab === 'programacao' && (
        <TabProgramacao eventoId={id} podeEditar={perfil.podeProgramacao} />
      )}
      {activeTab === 'certificados' && (
        <TabCertificados
          eventoId={id}
          gerarCertificado={(evento as unknown as Record<string, unknown>)?.gerar_certificado === true}
          podeEditar={perfil.podeEditar}
          supervisoes={supervisoes}
          campos={campos}
        />
      )}
      {activeTab === 'relatorios-ago' && (
        <TabRelatoriosAGO eventoId={id} evento={evento} />
      )}
      {activeTab === 'ausentes' && (
        <TabAusentes eventoId={id} evento={evento} podeEditar={perfil.podeEditar} />
      )}
      {activeTab === 'homologacao' && (
        <TabHomologacao eventoId={id} podeEditar={perfil.podeEditar} />
      )}
      {activeTab === 'deliberacoes' && (
        <TabDeliberacoes eventoId={id} evento={evento} podeEditar={perfil.podeEditar} />
      )}
      {activeTab === 'controle-ago' && (
        <TabControleAGO eventoId={id} podeEditar={perfil.podeEditar} />
      )}

      {/* ── MODAL ENCERRAR AGO ─────────────────────────────── */}
      {showEncerrarModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-7">
            <div className="text-center mb-5">
              <span className="text-5xl block mb-3">🔒</span>
              <h2 className="text-xl font-black text-gray-900 mb-2">Encerrar a AGO?</h2>
              <p className="text-sm text-gray-500">
                Esta ação irá <strong>encerrar definitivamente</strong> o evento, congelar todos os dados,
                consolidar a frequência e gerar a lista de ausentes para advertência.
              </p>
              <p className="text-xs text-red-600 font-semibold mt-3">
                ⚠️ Esta operação não pode ser desfeita.
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowEncerrarModal(false)}
                disabled={encerrandoAGO}
                className="flex-1 px-4 py-2.5 rounded-lg text-sm font-bold bg-gray-100 text-gray-700 hover:bg-gray-200 transition disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={async () => {
                  setEncerrandoAGO(true);
                  try {
                    const res = await fetch(`/api/eventos/${id}/encerrar`, { method: 'POST' });
                    const json = await res.json() as { ok?: boolean; error?: string; encerrado_em?: string; total_processados?: number; total_ausentes?: number };
                    if (!res.ok) { alert('Erro: ' + (json.error ?? 'Falha ao encerrar.')); return; }
                    setShowEncerrarModal(false);
                    await fetchEvento();
                  } catch { alert('Erro de rede ao encerrar AGO.'); }
                  finally { setEncerrandoAGO(false); }
                }}
                disabled={encerrandoAGO}
                className="flex-1 px-4 py-2.5 rounded-lg text-sm font-bold bg-red-700 text-white hover:bg-red-800 transition disabled:opacity-50"
              >
                {encerrandoAGO ? 'Encerrando...' : '🔒 Confirmar Encerramento'}
              </button>
            </div>
          </div>
        </div>
      )}

    </PageLayout>
  );
}

// ═══════════════════════════════════════════════════════════════
// ABA INSCRITOS
// ═══════════════════════════════════════════════════════════════
function TabInscritos({ inscricoes, loading, supervisoes, campos, nomeSup, nomeCampo, onRefresh, supabase, evento, podeEditar, podeRemover, podeMover, podeComunicacao, podeCertificados }: {
  inscricoes: Inscricao[]; loading: boolean;
  supervisoes: Supervisao[]; campos: Campo[];
  nomeSup: (id: string | null) => string;
  nomeCampo: (id: string | null) => string;
  onRefresh: () => void;
  supabase: ReturnType<typeof createClient>;
  evento: Evento;
  podeEditar: boolean;
  podeRemover: boolean;
  podeMover: boolean;
  podeComunicacao: boolean;
  podeCertificados: boolean;
}) {
  const [busca,       setBusca]       = useState('');
  const [filtroSup,   setFiltroSup]   = useState('');
  const [filtroCampo, setFiltroCampo] = useState('');
  const [filtroPag,   setFiltroPag]   = useState('');
  const [filtroCI,    setFiltroCI]    = useState('');
  const [filtroHosp,  setFiltroHosp]  = useState('');
  const [filtroAlim,  setFiltroAlim]  = useState('');
  const [pagina,      setPagina]      = useState(1);
  const [salvando,    setSalvando]    = useState<string | null>(null);
  const [enviandoCert, setEnviandoCert] = useState<Record<string, boolean>>({});
  const [certMsg,      setCertMsg]      = useState<Record<string, string>>({});
  const [enviandoEmail, setEnviandoEmail] = useState<Record<string, boolean>>({});
  const [emailMsg,      setEmailMsg]      = useState<Record<string, string>>({});
  const [editando,      setEditando]      = useState<Inscricao | null>(null);
  const [editForm,      setEditForm]      = useState<EditForm | null>(null);
  const [eventosDept,   setEventosDept]   = useState<EventoResumo[]>([]);
  const [tiposPorEvento, setTiposPorEvento] = useState<Record<string, TipoInscricao[]>>({});
  const [carregandoEventos, setCarregandoEventos] = useState(false);
  const [salvandoEdit,  setSalvandoEdit]  = useState(false);
  const [erroEdit,      setErroEdit]      = useState<string | null>(null);
  const timeoutsRef = useRef<number[]>([]);
  const POR_PAG = 20;

  const filtrados = useMemo(() => {
    return inscricoes.filter(i => {
      if (busca && !i.nome_inscrito.toLowerCase().includes(busca.toLowerCase()) &&
          !(i.cpf || '').includes(busca) && !(i.whatsapp || '').includes(busca)) return false;
      if (filtroSup   && i.supervisao_id !== filtroSup)      return false;
      if (filtroCampo && i.campo_id      !== filtroCampo)    return false;
      if (filtroPag   && i.status_pagamento !== filtroPag)   return false;
      if (filtroCI    && String(i.checkin_realizado) !== filtroCI) return false;
      if (filtroHosp  && String(i.hospedagem) !== filtroHosp)     return false;
      if (filtroAlim  && String(i.alimentacao) !== filtroAlim)    return false;
      return true;
    });
  }, [inscricoes, busca, filtroSup, filtroCampo, filtroPag, filtroCI, filtroHosp, filtroAlim]);

  const totalPags = Math.max(1, Math.ceil(filtrados.length / POR_PAG));
  const paginados = filtrados.slice((pagina - 1) * POR_PAG, pagina * POR_PAG);

  useEffect(() => { setPagina(1); }, [busca, filtroSup, filtroCampo, filtroPag, filtroCI, filtroHosp, filtroAlim]);

  useEffect(() => () => {
    timeoutsRef.current.forEach(t => clearTimeout(t));
    timeoutsRef.current = [];
  }, []);

  const scheduleClear = useCallback((fn: () => void, ms = 4000) => {
    const id = window.setTimeout(fn, ms);
    timeoutsRef.current.push(id);
  }, []);

  async function marcarEtiqueta(inscricao: Inscricao) {
    setSalvando(inscricao.id);
    await supabase.from('evento_inscricoes').update({ etiqueta_impressa: !inscricao.etiqueta_impressa }).eq('id', inscricao.id);
    setSalvando(null);
    onRefresh();
  }

  async function excluir(id: string) {
    if (!podeRemover) return;
    if (!confirm('Excluir esta inscrição?')) return;
    setSalvando(id);
    await supabase.from('evento_inscricoes').delete().eq('id', id);
    setSalvando(null);
    onRefresh();
  }

  async function enviarCertificado(ins: Inscricao, reenviar = false) {
    setEnviandoCert(p => ({ ...p, [ins.id]: true }));
    setCertMsg(p => ({ ...p, [ins.id]: '' }));
    try {
      const res = await fetch(`/api/eventos/${ins.evento_id}/certificados/enviar-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inscricao_id: ins.id, reenviar }),
      });
      const json = await res.json();
      if (json.jaEnviado) {
        setCertMsg(p => ({ ...p, [ins.id]: '✅ Já enviado' }));
      } else if (res.ok) {
        setCertMsg(p => ({ ...p, [ins.id]: '✅ Enviado!' }));
        onRefresh();
      } else {
        setCertMsg(p => ({ ...p, [ins.id]: '❌ ' + (json.error ?? 'Erro') }));
      }
    } catch {
      setCertMsg(p => ({ ...p, [ins.id]: '❌ Erro de rede' }));
    } finally {
      setEnviandoCert(p => ({ ...p, [ins.id]: false }));
      scheduleClear(() => setCertMsg(p => ({ ...p, [ins.id]: '' })));
    }
  }

  function avisarCertificado(id: string, msg: string) {
    setCertMsg(p => ({ ...p, [id]: msg }));
    scheduleClear(() => setCertMsg(p => ({ ...p, [id]: '' })));
  }

  function handleEnviarCertificado(ins: Inscricao) {
    if (!ins.email) {
      avisarCertificado(ins.id, '⚠️ E-mail não cadastrado.');
      return;
    }
    if (!['pago', 'isento'].includes(ins.status_pagamento)) {
      avisarCertificado(ins.id, '⚠️ Pagamento pendente.');
      return;
    }
    if (!ins.checkin_realizado) {
      avisarCertificado(ins.id, '⚠️ Check-in pendente.');
      return;
    }
    enviarCertificado(ins, ins.certificado_enviado);
  }

  async function enviarEmailConfirmacao(ins: Inscricao) {
    if (!ins.email) {
      setEmailMsg(p => ({ ...p, [ins.id]: '⚠️ E-mail não cadastrado.' }));
      scheduleClear(() => setEmailMsg(p => ({ ...p, [ins.id]: '' })));
      return;
    }
    setEnviandoEmail(p => ({ ...p, [ins.id]: true }));
    setEmailMsg(p => ({ ...p, [ins.id]: '' }));
    try {
      const res = await fetch(`/api/eventos/${ins.evento_id}/notificacoes/reenviar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inscricao_id: ins.id }),
      });
      const json = await res.json();
      if (res.ok) {
        setEmailMsg(p => ({ ...p, [ins.id]: '✅ E-mail enviado!' }));
      } else {
        setEmailMsg(p => ({ ...p, [ins.id]: '❌ ' + (json.error ?? 'Erro ao enviar') }));
      }
    } catch {
      setEmailMsg(p => ({ ...p, [ins.id]: '❌ Erro de rede' }));
    } finally {
      setEnviandoEmail(p => ({ ...p, [ins.id]: false }));
      scheduleClear(() => setEmailMsg(p => ({ ...p, [ins.id]: '' })));
    }
  }

  function abrirEdicao(ins: Inscricao) {
    if (!podeEditar) return;
    setErroEdit(null);
    setEditando(ins);
    setEditForm({
      evento_id: ins.evento_id,
      nome_inscrito: ins.nome_inscrito,
      cpf: ins.cpf ?? '',
      email: ins.email ?? '',
      whatsapp: ins.whatsapp ?? '',
      sexo: ins.sexo ?? '',
      data_nascimento: ins.data_nascimento ?? '',
      supervisao_id: ins.supervisao_id ?? '',
      campo_id: ins.campo_id ?? '',
      tipo_inscricao: ins.tipo_inscricao ?? '',
      hospedagem: ins.hospedagem,
      alimentacao: ins.alimentacao,
      brinde: ins.brinde,
      observacoes: ins.observacoes ?? '',
    });
    if (eventosDept.length === 0) {
      carregarEventosDepartamento();
    }
    if (evento.usar_tipos_inscricao && !tiposPorEvento[ins.evento_id]) {
      carregarTiposEvento(ins.evento_id);
    }
  }

  async function carregarEventosDepartamento() {
    if (carregandoEventos) return;
    setCarregandoEventos(true);
    const { data } = await supabase
      .from('eventos')
      .select('id,nome,departamento,status,data_inicio,data_fim,valor_inscricao,usar_tipos_inscricao,permite_hospedagem,permite_alimentacao,permite_brinde,limite_vagas,limite_hospedagem,limite_brindes')
      .eq('departamento', evento.departamento)
      .order('data_inicio', { ascending: false });
    const list = ((data as EventoResumo[]) || []).filter(e => e.status !== 'cancelado' || e.id === evento.id);
    setEventosDept(list);
    setCarregandoEventos(false);
  }

  async function carregarTiposEvento(eventoId: string) {
    const { data } = await supabase
      .from('evento_tipos_inscricao')
      .select('id,nome,valor,inclui_alimentacao,inclui_hospedagem,ativo,ordem')
      .eq('evento_id', eventoId)
      .eq('ativo', true)
      .order('ordem');
    setTiposPorEvento(p => ({ ...p, [eventoId]: (data as TipoInscricao[]) || [] }));
  }

  async function salvarEdicao() {
    if (!editando || !editForm || !eventoDestino) return;
    if (!podeEditar) return;
    setErroEdit(null);

    if (!podeMover && editForm.evento_id !== editando.evento_id) {
      setErroEdit('Sem permissao para mover inscricoes entre eventos.');
      return;
    }

    if (!editForm.nome_inscrito.trim()) {
      setErroEdit('Nome e obrigatorio.');
      return;
    }
    if (!editForm.supervisao_id) {
      setErroEdit('Supervisao e obrigatoria.');
      return;
    }
    if (eventoDestino.usar_tipos_inscricao && !tipoSelecionado) {
      setErroEdit('Selecione um tipo de inscricao.');
      return;
    }
    if (eventoDestino.status === 'cancelado') {
      setErroEdit('Evento destino cancelado.');
      return;
    }

    if (eventoDestino.limite_vagas && eventoDestino.id !== editando.evento_id) {
      const { count } = await supabase
        .from('evento_inscricoes')
        .select('id', { count: 'exact', head: true })
        .eq('evento_id', eventoDestino.id);
      if ((count ?? 0) >= eventoDestino.limite_vagas) {
        setErroEdit('Evento destino sem vagas disponiveis.');
        return;
      }
    }

    if (hospedagemEfetiva && eventoDestino.limite_hospedagem) {
      const precisaChecar = eventoDestino.id !== editando.evento_id || !editando.hospedagem;
      if (precisaChecar) {
        const { count } = await supabase
          .from('evento_inscricoes')
          .select('id', { count: 'exact', head: true })
          .eq('evento_id', eventoDestino.id)
          .eq('hospedagem', true);
        if ((count ?? 0) >= eventoDestino.limite_hospedagem) {
          setErroEdit('Limite de hospedagem atingido no evento destino.');
          return;
        }
      }
    }

    const valorNovoFinal = valorNovo ?? 0;

    let novoStatus = editando.status_pagamento;
    if ((diferencaValor ?? 0) > 0) {
      novoStatus = 'pendente';
    }

    const cpfLimpo = editForm.cpf.replace(/\D/g, '') || null;
    const emailLimpo = editForm.email.trim();
    const whatsappLimpo = editForm.whatsapp.trim();
    const dataNasc = editForm.data_nascimento || null;

    const mudancas: string[] = [];
    if (editando.evento_id !== editForm.evento_id) {
      mudancas.push(`Inscricao movida de \"${eventoAtualResumo.nome}\" para \"${eventoDestino.nome}\".`);
    }
    if ((editando.tipo_inscricao ?? '') !== (tipoSelecionado?.nome ?? '')) {
      mudancas.push(`Tipo de inscricao: ${editando.tipo_inscricao ?? '-'} -> ${tipoSelecionado?.nome ?? '-'}.`);
    }
    if (editando.hospedagem !== hospedagemEfetiva) {
      mudancas.push(`Hospedagem: ${editando.hospedagem ? 'Sim' : 'Nao'} -> ${hospedagemEfetiva ? 'Sim' : 'Nao'}.`);
    }
    if (editando.alimentacao !== alimentacaoEfetiva) {
      mudancas.push(`Alimentacao: ${editando.alimentacao ? 'Sim' : 'Nao'} -> ${alimentacaoEfetiva ? 'Sim' : 'Nao'}.`);
    }
    if (editando.brinde !== brindeEfetivo) {
      mudancas.push(`Brinde: ${editando.brinde ? 'Sim' : 'Nao'} -> ${brindeEfetivo ? 'Sim' : 'Nao'}.`);
    }

    const dadosAlterados =
      editando.nome_inscrito !== editForm.nome_inscrito.trim() ||
      (editando.cpf ?? '') !== (cpfLimpo ?? '') ||
      (editando.email ?? '') !== emailLimpo ||
      (editando.whatsapp ?? '') !== whatsappLimpo ||
      (editando.sexo ?? '') !== (editForm.sexo || '') ||
      (editando.data_nascimento ?? '') !== (dataNasc ?? '') ||
      (editando.supervisao_id ?? '') !== (editForm.supervisao_id || '') ||
      (editando.campo_id ?? '') !== (editForm.campo_id || '');

    if (dadosAlterados) {
      mudancas.push('Dados cadastrais atualizados.');
    }

    if (diferencaValor !== null && diferencaValor !== 0) {
      if (diferencaValor > 0) {
        mudancas.push(`Diferenca: ${fmtMoeda(diferencaValor)} (cobranca complementar).`);
      } else {
        mudancas.push(`Diferenca: ${fmtMoeda(Math.abs(diferencaValor))} (reembolso manual).`);
      }
    }

    if (mudancas.length === 0) {
      mudancas.push('Dados cadastrais atualizados.');
    }

    const log = `[${new Date().toLocaleString('pt-BR')}] ${mudancas.join(' ')}`;
    const obsBase = editForm.observacoes.trim();
    const obsFinal = obsBase ? `${obsBase}\n${log}` : log;

    const payload: Record<string, unknown> = normalizePayloadUppercase({
      evento_id: editForm.evento_id,
      nome_inscrito: editForm.nome_inscrito.trim(),
      cpf: cpfLimpo,
      email: emailLimpo || null,
      whatsapp: whatsappLimpo || null,
      sexo: editForm.sexo || null,
      data_nascimento: dataNasc,
      supervisao_id: editForm.supervisao_id || null,
      campo_id: editForm.campo_id || null,
      tipo_inscricao: eventoDestino.usar_tipos_inscricao ? (tipoSelecionado?.nome ?? null) : null,
      hospedagem: hospedagemEfetiva,
      alimentacao: alimentacaoEfetiva,
      brinde: brindeEfetivo,
      observacoes: obsFinal,
      valor_original: valorNovoFinal,
      valor_final: valorNovoFinal,
      status_pagamento: novoStatus,
    });

    setSalvandoEdit(true);
    const { error } = await supabase
      .from('evento_inscricoes')
      .update(payload)
      .eq('id', editando.id);

    if (error) {
      setErroEdit('Erro ao salvar: ' + error.message);
      setSalvandoEdit(false);
      return;
    }

    setSalvandoEdit(false);
    setEditando(null);
    setEditForm(null);
    onRefresh();
  }

  const escHtml = (val: unknown) => String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  function limparFiltros() {
    setBusca('');
    setFiltroSup('');
    setFiltroCampo('');
    setFiltroPag('');
    setFiltroCI('');
    setFiltroHosp('');
    setFiltroAlim('');
  }

  function imprimirLista() {
    const titulo = `${evento.nome} — Listagem de Inscritos`;
    const logoDir = getDeptLogo(evento.departamento);
    const dataHoje = new Date().toLocaleDateString('pt-BR');
    const linhas = filtrados.map(i => {
      const status = STATUS_PAG_CFG[i.status_pagamento]?.label ?? i.status_pagamento;
      return `
        <tr>
          <td>${escHtml(i.nome_inscrito)}</td>
          <td>${escHtml(i.cpf ?? '-')}</td>
          <td>${escHtml(i.whatsapp ?? '-')}</td>
          <td>${escHtml(nomeSup(i.supervisao_id))}</td>
          <td>${escHtml(nomeCampo(i.campo_id))}</td>
          <td>${escHtml(fmtMoeda(i.valor_pago))}</td>
          <td>${escHtml(status)}</td>
          <td>${i.checkin_realizado ? escHtml(fmtDT(i.checkin_at)) : '—'}</td>
          <td>${escHtml(fmtDT(i.created_at))}</td>
        </tr>`;
    }).join('');

    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <title>${escHtml(titulo)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Arial, sans-serif; font-size: 10px; color: #000; padding: 16px; }
    .header { display: flex; align-items: center; justify-content: center; gap: 10px; }
    .header-logo { width: 58px; height: auto; flex-shrink: 0; }
    .header-center { max-width: 640px; text-align: center; }
    .header-center .org { font-size: 14px; font-weight: bold; }
    .header-center .info { font-size: 9px; color: #333; margin-top: 2px; }
    .divider { border-bottom: 2px solid #14b8a6; margin: 8px 0 10px; }
    .report-title { text-align: center; font-size: 13px; font-weight: bold; margin: 8px 0 6px; }
    .report-meta { display: flex; justify-content: space-between; font-size: 9px; margin-bottom: 8px; }
    table { width: 100%; border-collapse: collapse; margin-top: 6px; }
    thead tr { background: #14b8a6; color: #fff; }
    th { padding: 5px 6px; text-align: left; font-size: 9px; font-weight: bold; }
    td { padding: 4px 6px; font-size: 9px; border-bottom: 1px solid #ddd; vertical-align: top; }
    tr:nth-child(even) td { background: #f5f5f5; }
    @media print { body { padding: 8px; } @page { margin: 10mm; size: A4 landscape; } }
  </style>
</head>
<body>
  <div class="header">
    <img class="header-logo" src="${origin ? `${origin}/img/logo_comieadepa.png` : '/img/logo_comieadepa.png'}" alt="COMIEADEPA" />
    <div class="header-center">
      <div class="org">COMIEADEPA</div>
      <div class="info">Rodovia Mario Covas, 2500 - do km 3.123 ao km 6.001 - lado impar lado par pertence a(o) Ananindeua - Coqueiro, Belem - PA, 66650-000</div>
      <div class="info">CNPJ: 04.760.047/0001-04 | Tel: (91) 99223-4022 | contato@comieadepa.org</div>
    </div>
    <img class="header-logo" src="${origin ? `${origin}${logoDir}` : logoDir}" alt="${escHtml(evento.departamento)}" />
  </div>
  <div class="divider"></div>
  <div class="report-title">${escHtml(titulo)}</div>
  <div class="report-meta">
    <div>Total de registros: ${filtrados.length}</div>
    <div>Data: ${dataHoje}</div>
  </div>
  <table>
    <thead>
      <tr>
        <th>Nome</th>
        <th>CPF</th>
        <th>WhatsApp</th>
        <th>Supervisao</th>
        <th>Campo</th>
        <th>Valor</th>
        <th>Pagamento</th>
        <th>Check-in</th>
        <th>Inscricao</th>
      </tr>
    </thead>
    <tbody>${linhas}</tbody>
  </table>
</body>
</html>`;

    const win = window.open('', '_blank', 'width=1100,height=750');
    if (!win) return;
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 600);
  }

  const supervisaoById = useMemo(
    () => new Map(supervisoes.map(s => [s.id, s.nome])),
    [supervisoes]
  );
  const campoById = useMemo(
    () => new Map(campos.map(c => [c.id, c.nome])),
    [campos]
  );

  const supervisoesDisponiveis = useMemo(() => {
    const map = new Map<string, string>();
    inscricoes.forEach(i => {
      const id = i.supervisao_id;
      if (!id) return;
      const nome = (supervisaoById.get(id) ?? '').trim() || id;
      if (!nome) return;
      map.set(id, nome);
    });
    return Array.from(map.entries())
      .map(([id, nome]) => ({ id, nome }))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }, [inscricoes, supervisaoById]);

  const camposDisponiveis = useMemo(() => {
    const map = new Map<string, { id: string; nome: string; supervisao_id: string | null }>();
    inscricoes.forEach(i => {
      const id = i.campo_id;
      if (!id) return;
      const nome = (campoById.get(id) ?? '').trim() || id;
      if (!nome) return;
      map.set(id, { id, nome, supervisao_id: i.supervisao_id ?? null });
    });
    return Array.from(map.values())
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }, [inscricoes, campoById]);

  const camposFiltrados = useMemo(
    () => (filtroSup ? camposDisponiveis.filter(c => c.supervisao_id === filtroSup) : camposDisponiveis),
    [camposDisponiveis, filtroSup]
  );

  useEffect(() => {
    if (editando && eventosDept.length === 0 && podeMover) {
      carregarEventosDepartamento();
    }
  }, [editando, eventosDept.length, podeMover]);

  useEffect(() => {
    if (!editForm?.evento_id) return;
    const ev = eventosDept.find(e => e.id === editForm.evento_id) ?? null;
    if (ev?.usar_tipos_inscricao) {
      carregarTiposEvento(editForm.evento_id);
    }
  }, [editForm?.evento_id, eventosDept]);

  const eventoAtualResumo = useMemo<EventoResumo>(() => ({
    id: evento.id,
    nome: evento.nome,
    departamento: evento.departamento,
    status: evento.status,
    data_inicio: evento.data_inicio,
    data_fim: evento.data_fim,
    valor_inscricao: evento.valor_inscricao,
    usar_tipos_inscricao: evento.usar_tipos_inscricao,
    permite_hospedagem: evento.permite_hospedagem,
    permite_alimentacao: evento.permite_alimentacao,
    permite_brinde: evento.permite_brinde,
    limite_vagas: evento.limite_vagas,
    limite_hospedagem: evento.limite_hospedagem,
    limite_brindes: evento.limite_brindes,
  }), [evento]);

  const eventosVisiveis = useMemo(
    () => (eventosDept.length > 0 ? eventosDept : [eventoAtualResumo]),
    [eventosDept, eventoAtualResumo]
  );

  const eventoDestino = useMemo(
    () => (editForm?.evento_id ? (eventosVisiveis.find(e => e.id === editForm.evento_id) ?? null) : null),
    [editForm?.evento_id, eventosVisiveis]
  );

  const tiposDestino = useMemo(
    () => (editForm?.evento_id ? (tiposPorEvento[editForm.evento_id] ?? []) : []),
    [editForm?.evento_id, tiposPorEvento]
  );

  const tipoSelecionado = useMemo(() => {
    if (!eventoDestino?.usar_tipos_inscricao) return null;
    return tiposDestino.find(t => t.nome === editForm?.tipo_inscricao) ?? null;
  }, [eventoDestino?.usar_tipos_inscricao, tiposDestino, editForm?.tipo_inscricao]);

  const hospedagemEfetiva = !!(
    eventoDestino && (
      eventoDestino.usar_tipos_inscricao
        ? tipoSelecionado?.inclui_hospedagem
        : (eventoDestino.permite_hospedagem && editForm?.hospedagem)
    )
  );

  const alimentacaoEfetiva = !!(
    eventoDestino && (
      eventoDestino.usar_tipos_inscricao
        ? tipoSelecionado?.inclui_alimentacao
        : (eventoDestino.permite_alimentacao && editForm?.alimentacao)
    )
  );

  const brindeEfetivo = !!(eventoDestino?.permite_brinde && editForm?.brinde);

  const valorNovo = eventoDestino
    ? (eventoDestino.usar_tipos_inscricao ? (tipoSelecionado ? tipoSelecionado.valor : null) : eventoDestino.valor_inscricao)
    : null;

  const valorPagoAtual = editando?.valor_pago ?? 0;
  const diferencaValor = valorNovo !== null ? valorNovo - valorPagoAtual : null;

  const camposModal = useMemo(() => {
    if (!editForm?.supervisao_id) return campos;
    return campos.filter(c => c.supervisao_id === editForm.supervisao_id);
  }, [editForm?.supervisao_id, campos]);

  if (loading) return <LoadingSkeleton />;

  return (
    <div>
      {/* Filtros */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-4">
        <div className="flex flex-wrap gap-3">
          <input type="text" placeholder="🔍 Buscar nome, CPF, WhatsApp..." value={busca}
            onChange={e => setBusca(e.target.value)}
            className="w-full sm:flex-1 sm:min-w-[220px] border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#123b63]" />
          <select value={filtroSup} onChange={e => { setFiltroSup(e.target.value); setFiltroCampo(''); }}
            className="w-full sm:w-auto border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#123b63]">
            <option value="">Todas supervisões</option>
            {supervisoesDisponiveis.map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}
          </select>
          <select value={filtroCampo} onChange={e => setFiltroCampo(e.target.value)}
            className="w-full sm:w-auto border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#123b63]">
            <option value="">Todos campos</option>
            {camposFiltrados.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
          <select value={filtroPag} onChange={e => setFiltroPag(e.target.value)}
            className="w-full sm:w-auto border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#123b63]">
            <option value="">Pagamento</option>
            <option value="pendente">Pendente</option>
            <option value="pago">Pago</option>
            <option value="isento">Isento</option>
            <option value="cancelado">Cancelado</option>
          </select>
          <select value={filtroCI} onChange={e => setFiltroCI(e.target.value)}
            className="w-full sm:w-auto border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#123b63]">
            <option value="">Check-in</option>
            <option value="true">Realizado</option>
            <option value="false">Pendente</option>
          </select>
          <select value={filtroHosp} onChange={e => setFiltroHosp(e.target.value)}
            className="w-full sm:w-auto border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#123b63]">
            <option value="">Hospedagem</option>
            <option value="true">Sim</option>
            <option value="false">Não</option>
          </select>
          <select value={filtroAlim} onChange={e => setFiltroAlim(e.target.value)}
            className="w-full sm:w-auto border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#123b63]">
            <option value="">Alimentação</option>
            <option value="true">Sim</option>
            <option value="false">Não</option>
          </select>
          <button type="button" onClick={limparFiltros}
            className="w-full sm:w-auto px-4 py-2 text-sm rounded-lg border border-gray-300 bg-gray-50 text-gray-700 hover:bg-gray-100 transition">
            Limpar
          </button>
          <button type="button" onClick={imprimirLista}
            className="w-full sm:w-auto px-4 py-2 text-sm rounded-lg bg-[#123b63] text-white font-semibold hover:bg-[#0f2a45] transition">
            🖨️ Imprimir
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-2">{filtrados.length} resultado(s)</p>
      </div>

      {filtrados.length === 0 ? (
        <EmptyState icon="👥" title="Nenhuma inscrição encontrada" desc="Nenhum inscrito corresponde aos filtros selecionados." />
      ) : (
        <>
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-x-auto">
            <table className="w-full min-w-[1100px] text-sm">
              <thead>
                <tr className="border-b border-[#D4DCEA] bg-[#E3ECF7]">
                  {['Nome', 'CPF', 'Supervisão', 'Campo', 'Valor', 'Pagamento', 'Etiq.', 'Ações'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-600 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paginados.map(ins => {
                  const pagCfg = STATUS_PAG_CFG[ins.status_pagamento] ?? STATUS_PAG_CFG.pendente;
                  const isSalvando = salvando === ins.id;
                  const isPendente = ins.status_pagamento === 'pendente';
                  const linhaMsg = emailMsg[ins.id] || certMsg[ins.id];
                  const certLabel = certMsg[ins.id]?.startsWith('✅')
                    ? certMsg[ins.id]
                    : (ins.certificado_enviado ? '🎓 ✓' : '🎓');
                  return (
                    <tr key={ins.id} className="border-b border-gray-50 hover:bg-gray-50 transition">
                      <td className="px-4 py-3 font-medium text-gray-800 whitespace-nowrap">{ins.nome_inscrito}</td>
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{ins.cpf || '-'}</td>
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{nomeSup(ins.supervisao_id)}</td>
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{nomeCampo(ins.campo_id)}</td>
                      <td className="px-4 py-3 text-gray-800 font-medium whitespace-nowrap">{fmtMoeda(ins.valor_pago)}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${pagCfg.cls}`}>{pagCfg.label}</span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-center">
                        {ins.etiqueta_impressa ? '🏷️' : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex gap-1 flex-wrap">
                          <button
                            title={podeEditar ? 'Editar dados da inscrição' : 'Sem permissão para editar'}
                            onClick={() => podeEditar && abrirEdicao(ins)}
                            disabled={isSalvando || !podeEditar || isPendente}
                            className="text-xs px-2 py-1 bg-amber-100 text-amber-700 rounded font-semibold hover:bg-amber-200 transition disabled:opacity-50">
                            ✏️
                          </button>
                          {podeComunicacao && (
                            <button
                              title={isPendente ? 'Pagamento pendente' : 'Reenviar e-mail de confirmação'}
                              onClick={() => enviarEmailConfirmacao(ins)}
                              disabled={isSalvando || enviandoEmail[ins.id] || isPendente}
                              className="text-xs px-2 py-1 bg-sky-100 text-sky-700 rounded font-semibold hover:bg-sky-200 transition disabled:opacity-50">
                              {enviandoEmail[ins.id] ? '⏳' : '✉️'}
                            </button>
                          )}
                          <button
                            title={isPendente ? 'Pagamento pendente' : 'Imprimir etiqueta térmica individual (100×30mm)'}
                            onClick={() => window.open(`/eventos/${ins.evento_id}/etiquetas/print?mode=thermal&ids=${ins.id}`, '_blank', 'width=520,height=420')}
                            disabled={isSalvando || isPendente}
                            className="text-xs px-2 py-1 bg-purple-100 text-purple-700 rounded font-semibold hover:bg-purple-200 transition disabled:opacity-50">
                            🏷️
                          </button>
                          <button
                            title={isPendente ? 'Pagamento pendente' : 'Marcar/desmarcar etiqueta como impressa'}
                            onClick={() => marcarEtiqueta(ins)}
                            disabled={isSalvando || isPendente}
                            className="text-xs px-2 py-1 bg-gray-100 text-gray-700 rounded font-semibold hover:bg-gray-200 transition disabled:opacity-50">
                            ✅
                          </button>
                          {podeCertificados && evento.gerar_certificado && (
                            <button
                              title={isPendente ? 'Pagamento pendente' : (certMsg[ins.id] || 'Enviar certificado por e-mail')}
                              onClick={() => handleEnviarCertificado(ins)}
                              disabled={isSalvando || enviandoCert[ins.id] || isPendente}
                              className={`text-xs px-2 py-1 rounded font-semibold transition disabled:opacity-50 ${ins.certificado_enviado ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200' : 'bg-blue-100 text-blue-700 hover:bg-blue-200'}`}>
                              {enviandoCert[ins.id] ? '⏳' : certLabel}
                            </button>
                          )}
                          {podeRemover && (
                            <button title="Excluir inscrição" onClick={() => excluir(ins.id)} disabled={isSalvando}
                              className="text-xs px-2 py-1 bg-red-100 text-red-600 rounded font-semibold hover:bg-red-200 transition disabled:opacity-50">
                              🗑️
                            </button>
                          )}
                        </div>
                        {linhaMsg && (
                          <div className={`mt-1 text-[11px] font-semibold ${linhaMsg.startsWith('✅') ? 'text-emerald-700' : linhaMsg.startsWith('⚠️') ? 'text-amber-600' : 'text-red-600'}`}>
                            {linhaMsg}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {/* Paginação */}
          {totalPags > 1 && (
            <div className="flex items-center justify-between mt-4">
              <p className="text-sm text-gray-500">Página {pagina} de {totalPags}</p>
              <div className="flex gap-2">
                <button onClick={() => setPagina(p => Math.max(1, p - 1))} disabled={pagina === 1}
                  className="px-3 py-1.5 text-sm rounded-lg bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-40">
                  ← Anterior
                </button>
                <button onClick={() => setPagina(p => Math.min(totalPags, p + 1))} disabled={pagina === totalPags}
                  className="px-3 py-1.5 text-sm rounded-lg bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-40">
                  Próxima →
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {editando && editForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-start sm:items-center justify-center p-2 sm:p-4 overflow-y-auto" onClick={() => { setEditando(null); setEditForm(null); }}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full flex flex-col max-h-[95dvh] sm:max-h-[90vh] my-auto" onClick={e => e.stopPropagation()}>
            {/* Cabeçalho fixo */}
            <div className="flex items-start justify-between px-4 sm:px-6 pt-4 sm:pt-6 pb-3 border-b border-gray-100 shrink-0">
              <div>
                <h3 className="font-bold text-[#123b63] text-base">✏️ Editar Inscrição</h3>
                <p className="text-xs text-gray-500 mt-0.5">{editando.nome_inscrito}</p>
              </div>
              <button onClick={() => { setEditando(null); setEditForm(null); }} className="text-gray-400 hover:text-gray-700 text-xl font-bold leading-none ml-4">×</button>
            </div>
            {/* Conteúdo com scroll */}
            <div className="overflow-y-auto flex-1 px-4 sm:px-6 py-4">

            {erroEdit && (
              <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg text-sm">{erroEdit}</div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Data da inscricao</label>
                <input
                  value={fmtDT(editando.created_at)}
                  readOnly
                  className={inputCls + ' bg-gray-50 text-gray-600'}
                />
              </div>
              <div className="md:col-span-2">
                <label className={labelCls}>Evento</label>
                <select
                  value={editForm.evento_id}
                  onChange={e => setEditForm(f => f ? { ...f, evento_id: e.target.value, tipo_inscricao: '' } : f)}
                  className={inputCls}
                  disabled={carregandoEventos || !podeMover}
                >
                  {eventosVisiveis.map(ev => (
                    <option key={ev.id} value={ev.id} disabled={ev.status === 'cancelado'}>
                      {ev.nome} {ev.status === 'cancelado' ? '(Cancelado)' : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-2">
                <label className={labelCls}>Nome completo</label>
                <input
                  value={editForm.nome_inscrito}
                  onChange={e => setEditForm(f => f ? { ...f, nome_inscrito: e.target.value } : f)}
                  className={inputCls}
                />
              </div>

              <div>
                <label className={labelCls}>CPF</label>
                <input
                  value={editForm.cpf}
                  onChange={e => setEditForm(f => f ? { ...f, cpf: e.target.value } : f)}
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>E-mail</label>
                <input
                  type="email"
                  value={editForm.email}
                  onChange={e => setEditForm(f => f ? { ...f, email: e.target.value } : f)}
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>WhatsApp</label>
                <input
                  value={editForm.whatsapp}
                  onChange={e => setEditForm(f => f ? { ...f, whatsapp: e.target.value } : f)}
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Sexo</label>
                <select
                  value={editForm.sexo}
                  onChange={e => setEditForm(f => f ? { ...f, sexo: e.target.value } : f)}
                  className={inputCls}
                >
                  <option value="">-</option>
                  <option value="M">Masculino</option>
                  <option value="F">Feminino</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>Data de nascimento</label>
                <input
                  type="date"
                  value={editForm.data_nascimento}
                  onChange={e => setEditForm(f => f ? { ...f, data_nascimento: e.target.value } : f)}
                  className={inputCls}
                />
              </div>

              <div>
                <label className={labelCls}>Supervisão</label>
                <select
                  value={editForm.supervisao_id}
                  onChange={e => setEditForm(f => f ? { ...f, supervisao_id: e.target.value, campo_id: '' } : f)}
                  className={inputCls}
                >
                  <option value="">Selecione...</option>
                  {supervisoes.map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Campo</label>
                <select
                  value={editForm.campo_id}
                  onChange={e => setEditForm(f => f ? { ...f, campo_id: e.target.value } : f)}
                  className={inputCls}
                >
                  <option value="">Selecione...</option>
                  {camposModal.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                </select>
              </div>

              {eventoDestino?.usar_tipos_inscricao && (
                <div className="md:col-span-2">
                  <label className={labelCls}>Tipo de inscrição</label>
                  <select
                    value={editForm.tipo_inscricao}
                    onChange={e => setEditForm(f => f ? { ...f, tipo_inscricao: e.target.value } : f)}
                    className={inputCls}
                  >
                    <option value="">Selecione...</option>
                    {tiposDestino.map(t => (
                      <option key={t.id} value={t.nome}>{t.nome} — {t.valor === 0 ? 'Gratuito' : fmtMoeda(t.valor)}</option>
                    ))}
                  </select>
                  <div className="mt-2 text-xs text-gray-500">
                    Hospedagem: <span className="font-semibold text-gray-700">{hospedagemEfetiva ? 'Sim' : 'Nao'}</span>
                    {' · '}Alimentacao: <span className="font-semibold text-gray-700">{alimentacaoEfetiva ? 'Sim' : 'Nao'}</span>
                  </div>
                </div>
              )}

              {!eventoDestino?.usar_tipos_inscricao && (
                <div className="md:col-span-2">
                  <label className={labelCls}>Serviços</label>
                  <div className="flex flex-wrap gap-4 mt-1">
                    {eventoDestino?.permite_hospedagem && (
                      <CheckItem name="hospedagem" label="Hospedagem" checked={editForm.hospedagem} onChange={e => setEditForm(f => f ? { ...f, hospedagem: e.target.checked } : f)} />
                    )}
                    {eventoDestino?.permite_alimentacao && (
                      <CheckItem name="alimentacao" label="Alimentação" checked={editForm.alimentacao} onChange={e => setEditForm(f => f ? { ...f, alimentacao: e.target.checked } : f)} />
                    )}
                  </div>
                </div>
              )}

              {eventoDestino?.permite_brinde && (
                <div className="md:col-span-2">
                  <label className={labelCls}>Brinde</label>
                  <div className="mt-1">
                    <CheckItem name="brinde" label="Brinde" checked={editForm.brinde} onChange={e => setEditForm(f => f ? { ...f, brinde: e.target.checked } : f)} />
                  </div>
                </div>
              )}

              <div className="md:col-span-2">
                <label className={labelCls}>Observações</label>
                <textarea
                  rows={3}
                  value={editForm.observacoes}
                  onChange={e => setEditForm(f => f ? { ...f, observacoes: e.target.value } : f)}
                  className={inputCls + ' resize-y'}
                />
              </div>
            </div>

            {valorNovo !== null && (
              <div className="mt-4 text-xs text-gray-600">
                <div>Valor atual pago: {fmtMoeda(valorPagoAtual)}</div>
                <div>Valor novo: {fmtMoeda(valorNovo)}</div>
                {diferencaValor !== null && diferencaValor > 0 && (
                  <div className="text-amber-600 font-semibold">Diferença a pagar: {fmtMoeda(diferencaValor)} (cobrança complementar)</div>
                )}
                {diferencaValor !== null && diferencaValor === 0 && (
                  <div className="text-emerald-700 font-semibold">Sem diferença de valor.</div>
                )}
                {diferencaValor !== null && diferencaValor < 0 && (
                  <div className="text-red-600 font-semibold">Há diferença a menor. Reembolso deve ser tratado manualmente.</div>
                )}
              </div>
            )}
            </div>{/* fim scroll */}
            {/* Rodapé fixo */}
            <div className="flex items-center justify-end gap-2 px-4 sm:px-6 py-3 sm:py-4 border-t border-gray-100 shrink-0">
              <button
                onClick={() => { setEditando(null); setEditForm(null); }}
                className="px-4 py-2 text-sm rounded-lg border border-gray-300 bg-gray-50 text-gray-700 hover:bg-gray-100 transition"
              >
                Cancelar
              </button>
              <button
                onClick={salvarEdicao}
                disabled={salvandoEdit}
                className="px-4 py-2 text-sm rounded-lg bg-[#123b63] text-white font-semibold hover:bg-[#0f2a45] transition disabled:opacity-50"
              >
                {salvandoEdit ? 'Salvando...' : 'Salvar alterações'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// ABA INSCRIÇÃO MANUAL
// ═══════════════════════════════════════════════════════════════
interface FormInscricao {
  nome_inscrito: string; cpf: string; email: string;
  telefone: string; whatsapp: string; sexo: string;
  supervisao_id: string; campo_id: string;
  hospedagem: boolean; alimentacao: boolean; brinde: boolean;
  valor_pago: string; status_pagamento: string; forma_pagamento: string;
  observacoes: string;
}

const FORM_INSCRICAO_VAZIO: FormInscricao = {
  nome_inscrito: '', cpf: '', email: '', telefone: '', whatsapp: '', sexo: '',
  supervisao_id: '', campo_id: '',
  hospedagem: false, alimentacao: false, brinde: false,
  valor_pago: '0', status_pagamento: 'pendente', forma_pagamento: '', observacoes: '',
};

function TabInscricaoManual({ eventoId, evento, supervisoes, campos, supabase, onSalvo }: {
  eventoId: string; evento: Evento;
  supervisoes: Supervisao[]; campos: Campo[];
  supabase: ReturnType<typeof createClient>;
  onSalvo: () => void;
}) {
  const [cpfBusca,    setCpfBusca]    = useState('');
  const [buscando,    setBuscando]    = useState(false);
  const [ministroEnc, setMinistroEnc] = useState<Ministro | null>(null);
  const [naoEncontrado, setNaoEncontrado] = useState(false);
  const [form, setForm] = useState<FormInscricao>({ ...FORM_INSCRICAO_VAZIO, valor_pago: String(evento.valor_inscricao) });
  const [salvando,    setSalvando]    = useState(false);
  const [sucesso,     setSucesso]     = useState<string | null>(null);
  const [erroForm,    setErroForm]    = useState<string | null>(null);

  const camposFiltrados = form.supervisao_id
    ? campos.filter(c => c.supervisao_id === form.supervisao_id)
    : campos;

  async function buscarCPF() {
    if (!cpfBusca.trim()) return;
    setBuscando(true);
    setNaoEncontrado(false);
    setMinistroEnc(null);
    const cpfLimpo = cpfBusca.replace(/\D/g, '');
    const searchParam = cpfLimpo || cpfBusca;
    const res = await authenticatedFetch(`/api/v1/members/lookup?search=${encodeURIComponent(searchParam)}&limit=1`);
    const json = res.ok ? await res.json().catch(() => null as any) : null;
    const data = (json?.data ?? []) as Ministro[];
    setBuscando(false);
    if (data && data.length > 0) {
      const m = data[0] as Ministro & { name?: string | null; phone?: string | null };
      const nome = (m.nome ?? m.name ?? '') as string;
      const celular = (m.celular ?? m.phone ?? '') as string;
      setMinistroEnc(m);
      const sup = supervisoes.find(s => s.id === m.supervisao_id || s.nome === m.supervisao);
      const campo = campos.find(c => c.id === m.campo_id || c.nome === m.campo);
      setForm(f => ({
        ...f,
        nome_inscrito: nome || f.nome_inscrito,
        cpf: m.cpf || cpfBusca,
        whatsapp: m.whatsapp || celular || f.whatsapp,
        email: m.email || f.email,
        supervisao_id: sup?.id || f.supervisao_id,
        campo_id: campo?.id || f.campo_id,
      }));
    } else {
      setNaoEncontrado(true);
      setForm(f => ({ ...f, cpf: cpfBusca }));
    }
  }

  function handleText(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) {
    const { name, value } = e.target;
    setForm(f => ({ ...f, [name]: value }));
  }
  function handleCheck(e: React.ChangeEvent<HTMLInputElement>) {
    setForm(f => ({ ...f, [e.target.name]: e.target.checked }));
  }

  async function salvar(e: React.FormEvent, addNova = false) {
    e.preventDefault();
    setErroForm(null);
    if (!form.nome_inscrito.trim()) return setErroForm('Nome é obrigatório.');
    setSalvando(true);
    try {
      const payload = normalizePayloadUppercase({
        evento_id:       eventoId,
        nome_inscrito:   form.nome_inscrito.trim(),
        cpf:             form.cpf.replace(/\D/g, '') || null,
        email:           form.email.trim()   || null,
        telefone:        form.telefone.trim()|| null,
        whatsapp:        form.whatsapp.trim()|| null,
        sexo:            form.sexo           || null,
        supervisao_id:   form.supervisao_id  || null,
        campo_id:        form.campo_id       || null,
        hospedagem:      form.hospedagem,
        alimentacao:     form.alimentacao,
        brinde:          form.brinde,
        valor_pago:      parseFloat(form.valor_pago) || 0,
        valor_final:     parseFloat(form.valor_pago) || 0,
        valor_original:  parseFloat(form.valor_pago) || 0,
        status_pagamento:form.status_pagamento,
        forma_pagamento: form.forma_pagamento|| null,
        observacoes:     form.observacoes.trim() || null,
        qr_code:         generateQRCodeToken(),
      });
      const { error } = await supabase.from('evento_inscricoes').insert([payload]);
      if (error) throw error;
      onSalvo();
      setSucesso(`Inscrição de "${form.nome_inscrito}" salva com sucesso!`);
      if (addNova) {
        setCpfBusca('');
        setMinistroEnc(null);
        setNaoEncontrado(false);
        setForm({ ...FORM_INSCRICAO_VAZIO, valor_pago: String(evento.valor_inscricao) });
      }
    } catch (err: unknown) {
      setErroForm('Erro ao salvar: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="max-w-3xl">
      {/* Banner modo balcão */}
      <div className="bg-gradient-to-r from-[#0D2B4E] to-[#123b63] rounded-xl p-4 mb-6 flex items-center justify-between gap-4">
        <div>
          <p className="text-white font-bold text-sm">🏪 Modo Balcão</p>
          <p className="text-white/60 text-xs mt-0.5">Tela fullscreen otimizada para fila de atendimento presencial</p>
        </div>
        <a
          href={`/eventos/${eventoId}/balcao`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-shrink-0 bg-[#F39C12] hover:bg-[#D68910] active:scale-95 text-[#0D2B4E] font-black py-2.5 px-5 rounded-xl text-sm transition"
        >
          Abrir ↗
        </a>
      </div>

      {/* Busca CPF */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
        <h3 className="font-bold text-[#123b63] mb-4 flex items-center gap-2">🔍 Buscar Ministro por CPF</h3>
        <div className="flex gap-3">
          <input type="text" placeholder="000.000.000-00" value={cpfBusca}
            onChange={e => setCpfBusca(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && buscarCPF()}
            className={inputCls + ' flex-1'} />
          <button onClick={buscarCPF} disabled={buscando || !cpfBusca.trim()}
            className="bg-[#123b63] text-white px-5 py-2 rounded-lg text-sm font-semibold hover:bg-[#0f2a45] transition disabled:opacity-50">
            {buscando ? 'Buscando...' : 'Buscar'}
          </button>
        </div>
        {ministroEnc && (
          <div className="mt-3 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3 text-sm">
            <span className="font-semibold text-emerald-700">✅ Ministro encontrado: </span>
            <span className="text-emerald-800">{ministroEnc.nome}</span>
            {ministroEnc.supervisao && <span className="text-emerald-600 ml-2">• {ministroEnc.supervisao}</span>}
          </div>
        )}
        {naoEncontrado && (
          <div className="mt-3 bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-3 text-sm text-yellow-700">
            ⚠️ CPF não encontrado na base de ministros. Preencha os dados manualmente.
          </div>
        )}
      </div>

      {/* Formulário */}
      {(ministroEnc || naoEncontrado) && (
        <form onSubmit={e => salvar(e, false)} noValidate>
          {sucesso && (
            <div className="mb-4 bg-emerald-50 border border-emerald-200 text-emerald-700 px-4 py-3 rounded-lg text-sm">{sucesso}</div>
          )}
          {erroForm && (
            <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{erroForm}</div>
          )}

          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-4">
            <h3 className="font-bold text-[#123b63] mb-4">📋 Dados do Inscrito</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className={labelCls}>Nome completo *</label>
                <input name="nome_inscrito" value={form.nome_inscrito} onChange={handleText} className={inputCls} required />
              </div>
              <div>
                <label className={labelCls}>CPF</label>
                <input name="cpf" value={form.cpf} onChange={handleText} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Sexo</label>
                <select name="sexo" value={form.sexo} onChange={handleText} className={inputCls}>
                  <option value="">-</option>
                  <option value="M">Masculino</option>
                  <option value="F">Feminino</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>WhatsApp</label>
                <input name="whatsapp" value={form.whatsapp} onChange={handleText} className={inputCls} placeholder="(00) 00000-0000" />
              </div>
              <div>
                <label className={labelCls}>E-mail</label>
                <input name="email" type="email" value={form.email} onChange={handleText} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Supervisão</label>
                <select name="supervisao_id" value={form.supervisao_id} onChange={e => { handleText(e); setForm(f => ({ ...f, campo_id: '' })); }} className={inputCls}>
                  <option value="">Selecione...</option>
                  {supervisoes.map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Campo</label>
                <select name="campo_id" value={form.campo_id} onChange={handleText} className={inputCls}>
                  <option value="">Selecione...</option>
                  {camposFiltrados.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                </select>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-4">
            <h3 className="font-bold text-[#123b63] mb-4">🎟️ Inscrição e Pagamento</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Valor pago (R$)</label>
                <input name="valor_pago" type="number" min="0" step="0.01" value={form.valor_pago} onChange={handleText} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Status pagamento</label>
                <select name="status_pagamento" value={form.status_pagamento} onChange={handleText} className={inputCls}>
                  <option value="pendente">Pendente</option>
                  <option value="pago">Pago</option>
                  <option value="isento">Isento</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>Forma de pagamento</label>
                <select name="forma_pagamento" value={form.forma_pagamento} onChange={handleText} className={inputCls}>
                  <option value="">-</option>
                  <option value="pix">PIX</option>
                  <option value="dinheiro">Dinheiro</option>
                  <option value="cartao">Cartão</option>
                  <option value="transferencia">Transferência</option>
                </select>
              </div>
              <div className="md:col-span-2">
                <label className={labelCls}>Serviços</label>
                <div className="flex flex-wrap gap-4 mt-1">
                  {evento.permite_hospedagem  && <CheckItem name="hospedagem"  label="Hospedagem"  checked={form.hospedagem}  onChange={handleCheck} />}
                  {evento.permite_alimentacao && <CheckItem name="alimentacao" label="Alimentação"  checked={form.alimentacao} onChange={handleCheck} />}
                  {evento.permite_brinde      && <CheckItem name="brinde"      label="Brinde"       checked={form.brinde}      onChange={handleCheck} />}
                </div>
              </div>
              <div className="md:col-span-2">
                <label className={labelCls}>Observações</label>
                <textarea name="observacoes" value={form.observacoes} onChange={handleText} rows={3} className={inputCls + ' resize-y'} />
              </div>
            </div>
          </div>

          <div className="flex gap-3">
            <button type="submit" disabled={salvando}
              className="bg-[#123b63] text-white px-6 py-2.5 rounded-lg text-sm font-semibold hover:bg-[#0f2a45] transition disabled:opacity-50">
              {salvando ? 'Salvando...' : '✅ Salvar Inscrição'}
            </button>
            <button type="button" disabled={salvando} onClick={e => salvar(e, true)}
              className="bg-[#F39C12] text-white px-6 py-2.5 rounded-lg text-sm font-semibold hover:bg-[#D68910] transition disabled:opacity-50">
              ✅ Salvar e Adicionar Nova
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// ABA CHECK-IN
// ═══════════════════════════════════════════════════════════════
function TabCheckin({ eventoId, evento, inscricoes, loading, nomeSup, nomeCampo, supabase, onRefresh }: {
  eventoId: string; evento: Evento; inscricoes: Inscricao[]; loading: boolean;
  nomeSup: (id: string | null) => string;
  nomeCampo: (id: string | null) => string;
  supabase: ReturnType<typeof createClient>;
  onRefresh: () => void;
}) {
  const [busca,       setBusca]       = useState('');
  const [salvando,    setSalvando]    = useState<string | null>(null);
  const [checkinAtivo, setCheckinAtivo] = useState(evento.checkin_ativo);
  const [togglingAtivo, setTogglingAtivo] = useState(false);
  const [linkCopiado, setLinkCopiado] = useState(false);

  async function toggleCheckinAtivo() {
    setTogglingAtivo(true);
    const novoValor = !checkinAtivo;
    await supabase.from('eventos').update({ checkin_ativo: novoValor }).eq('id', eventoId);
    setCheckinAtivo(novoValor);
    setTogglingAtivo(false);
  }

  function copiarLink() {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const link = origin ? `${origin}/eventos/${eventoId}/checkin` : `/eventos/${eventoId}/checkin`;
    navigator.clipboard.writeText(link).then(() => {
      setLinkCopiado(true);
      setTimeout(() => setLinkCopiado(false), 2500);
    });
  }

  const resultado = useMemo(() => {
    if (!busca.trim()) return [];
    const q = busca.toLowerCase();
    return inscricoes.filter(i =>
      (i.status_pagamento === 'pago' || i.status_pagamento === 'isento') &&
      (i.nome_inscrito.toLowerCase().includes(q) || (i.cpf || '').includes(busca))
    ).slice(0, 10);
  }, [inscricoes, busca]);

  async function fazerCheckin(inscricao: Inscricao) {
    if (inscricao.checkin_realizado) return;
    if (inscricao.status_pagamento !== 'pago' && inscricao.status_pagamento !== 'isento') return;
    setSalvando(inscricao.id);
    const now = new Date().toISOString();
    await supabase.from('evento_inscricoes').update({ checkin_realizado: true, checkin_at: now }).eq('id', inscricao.id);
    await supabase.from('evento_checkins').insert([{ evento_id: eventoId, inscricao_id: inscricao.id, metodo: 'manual' }]);
    // Envia link do certificado automaticamente (sem esperar)
    if (evento.gerar_certificado && inscricao.email) {
      fetch(`/api/eventos/${eventoId}/certificados/enviar-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inscricao_id: inscricao.id }),
      }).catch(() => { /* silencioso — não bloqueia o checkin */ });
    }
    setSalvando(null);
    onRefresh();
  }

  if (loading) return <LoadingSkeleton />;

  return (
    <div className="max-w-2xl">
      {/* Card modo mobile + toggle ativo */}
      <div className="bg-gradient-to-r from-[#0D2B4E] to-[#123b63] rounded-xl p-5 mb-6">
        <div className="flex items-center justify-between gap-4 mb-4">
          <div>
            <p className="text-white font-bold text-base">📱 Modo Check-in Mobile</p>
            <p className="text-white/60 text-xs mt-0.5">Tela otimizada para celular com câmera e scanner QR Code</p>
          </div>
          <button
            onClick={copiarLink}
            className="flex-shrink-0 bg-emerald-500 hover:bg-emerald-400 active:scale-95 text-white font-bold py-3 px-5 rounded-xl text-sm transition">
            {linkCopiado ? '✅ Link copiado!' : '📋 Copiar link'}
          </button>
        </div>
        <div className="flex items-center gap-3 bg-white/10 rounded-lg px-4 py-3">
          <span className="text-white text-sm font-semibold flex-1">
            Check-in mobile {checkinAtivo ? '🟢 Ativo' : '🔴 Inativo'}
          </span>
          <button
            onClick={toggleCheckinAtivo}
            disabled={togglingAtivo}
            className={`px-4 py-1.5 rounded-lg text-xs font-bold transition disabled:opacity-50 ${
              checkinAtivo
                ? 'bg-red-500 hover:bg-red-400 text-white'
                : 'bg-emerald-500 hover:bg-emerald-400 text-white'
            }`}>
            {togglingAtivo ? '...' : checkinAtivo ? 'Desativar' : 'Ativar'}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
        <h3 className="font-bold text-[#123b63] mb-4 flex items-center gap-2">✅ Check-in Manual (desktop)</h3>
        <input type="text" placeholder="🔍 Buscar por nome ou CPF..." value={busca}
          onChange={e => setBusca(e.target.value)}
          className={inputCls} />
      </div>

      {busca.trim() && resultado.length === 0 && (
        <EmptyState icon="🔍" title="Nenhum inscrito encontrado" desc="Verifique o nome ou CPF digitado." />
      )}

      {resultado.map(ins => {
        const pagCfg = STATUS_PAG_CFG[ins.status_pagamento] ?? STATUS_PAG_CFG.pendente;
        return (
          <div key={ins.id} className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 mb-3">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-bold text-gray-900">{ins.nome_inscrito}</p>
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500 mt-1">
                  {ins.cpf && <span>CPF: {ins.cpf}</span>}
                  <span>{nomeSup(ins.supervisao_id)}</span>
                  <span>{nomeCampo(ins.campo_id)}</span>
                  <span className={`font-semibold px-1.5 py-0.5 rounded-full ${pagCfg.cls}`}>{pagCfg.label}</span>
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                {ins.checkin_realizado ? (
                  <div className="text-emerald-600 text-sm font-semibold">
                    ✅ Check-in feito<br />
                    <span className="text-xs text-gray-400">{fmtDT(ins.checkin_at)}</span>
                  </div>
                ) : (
                  <button
                    onClick={() => fazerCheckin(ins)}
                    disabled={salvando === ins.id}
                    className="bg-[#123b63] text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-[#0f2a45] transition disabled:opacity-50"
                  >
                    {salvando === ins.id ? 'Aguarde...' : '✅ Realizar Check-in'}
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}

      {/* Últimos check-ins */}
      {!busca && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h3 className="font-bold text-gray-700 mb-4">Últimos Check-ins</h3>
          {inscricoes.filter(i => i.checkin_realizado).length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-4">Nenhum check-in realizado ainda.</p>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {inscricoes
                .filter(i => i.checkin_realizado)
                .sort((a, b) => new Date(b.checkin_at!).getTime() - new Date(a.checkin_at!).getTime())
                .slice(0, 20)
                .map(ins => (
                  <div key={ins.id} className="flex items-center justify-between py-2 border-b border-gray-50">
                    <span className="text-sm font-medium text-gray-800">{ins.nome_inscrito}</span>
                    <span className="text-xs text-gray-400">{fmtDT(ins.checkin_at)}</span>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// ABA ETIQUETAS
// ═══════════════════════════════════════════════════════════════
// ─── Modal de preview do crachá ───────────────────────────────
function BadgeModal({ ins, evento, nomeSup, nomeCampo, onClose, agoData }: {
  ins: Inscricao; evento: { id: string; nome: string; departamento: string; data_inicio: string; data_fim: string; local: string | null; cidade: string | null; banner_url: string | null };
  nomeSup: string; nomeCampo: string; onClose: () => void;
  agoData?: { matricula?: string | null; numero_cama?: string | null; tipo_cama?: string | null; hosp_status?: string | null; nome_alojamento?: string | null };
}) {
  const isAGO  = evento.departamento === 'AGO';
  const agoIns = { ...ins, ...(agoData ?? {}) } as EtiquetaInscricaoAGO;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl p-5 max-w-sm w-full" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-3">
          <h3 className="font-bold text-[#123b63] text-sm">
            {isAGO ? 'Pré-visualização AGO — A4 (99,1×34 mm)' : 'Pré-visualização — A4 (99,1×34 mm)'}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none">✕</button>
        </div>
        <div className="flex justify-center mb-3">
          {isAGO
            ? <EtiquetaPreviewAGO inscricao={agoIns} evento={evento} nomeSup={nomeSup} nomeCampo={nomeCampo} variant="a4" scale={0.92} />
            : <EtiquetaPreviewDepartamento inscricao={ins} evento={evento} nomeSup={nomeSup} nomeCampo={nomeCampo} variant="a4" scale={0.92} />
          }
        </div>
        <div className="border-t border-gray-100 pt-3">
          <p className="text-center text-xs text-gray-400 font-semibold mb-2">Térmica (100×30 mm)</p>
          <div className="flex justify-center">
            {isAGO
              ? <EtiquetaPreviewAGO  inscricao={agoIns} evento={evento} nomeSup={nomeSup} nomeCampo={nomeCampo} variant="thermal" scale={0.88} />
              : <EtiquetaPreviewDepartamento inscricao={ins} evento={evento} nomeSup={nomeSup} nomeCampo={nomeCampo} variant="thermal" scale={0.88} />
            }
          </div>
        </div>
        <p className="text-center text-xs text-gray-400 mt-3">Clique fora para fechar</p>
      </div>
    </div>
  );
}

function TabEtiquetas({ inscricoes, loading, nomeSup, nomeCampo, supabase, onRefresh, evento, eventoId }: {
  inscricoes: Inscricao[]; loading: boolean;
  nomeSup: (id: string | null) => string;
  nomeCampo: (id: string | null) => string;
  supabase: ReturnType<typeof createClient>;
  onRefresh: () => void;
  evento: { id: string; nome: string; departamento: string; data_inicio: string; data_fim: string; local: string | null; cidade: string | null; banner_url: string | null } | null;
  eventoId: string;
}) {
  const [busca,       setBusca]       = useState('');
  const [filtroImp,   setFiltroImp]   = useState<'todos' | 'impresso' | 'pendente'>('todos');
  const [filtroSup,   setFiltroSup]   = useState('');
  const [filtroHosp,  setFiltroHosp]  = useState(false);
  const [filtroAlim,  setFiltroAlim]  = useState(false);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [salvando,    setSalvando]    = useState<Set<string>>(new Set());
  const [preview,     setPreview]     = useState<Inscricao | null>(null);
  const [pag,         setPag]         = useState(1);

  const inscricoesElegiveis = useMemo(
    () => inscricoes.filter(i => i.status_pagamento === 'pago' || i.status_pagamento === 'isento'),
    [inscricoes]
  );

  // AGO: mapa de dados extras (matricula, hospedagem) por inscricao.id
  type AgoExtra = { matricula: string | null; numero_cama: string | null; tipo_cama: string | null; hosp_status: string | null; nome_alojamento: string | null };
  const [agoDataMap, setAgoDataMap] = useState<Map<string, AgoExtra>>(new Map());

  useEffect(() => {
    if (evento?.departamento !== 'AGO' || inscricoesElegiveis.length === 0) return;
    let cancelled = false;
    async function loadAgo() {
      const inscIds    = inscricoesElegiveis.map(i => i.id);
      const ministroIds = [...new Set(inscricoesElegiveis.map(i => i.ministro_id).filter((x): x is string => !!x))];

      const [hospRes, membersRes] = await Promise.all([
        supabase.from('evento_hospedagens')
          .select('inscricao_id,numero_cama,tipo_cama,status,alojamento_id')
          .in('inscricao_id', inscIds),
        ministroIds.length > 0
          ? authenticatedFetch(`/api/v1/members/lookup?ids=${encodeURIComponent(ministroIds.join(','))}&limit=${ministroIds.length}`)
          : Promise.resolve(null),
      ]);

      type HospRow2 = { inscricao_id: string; numero_cama: string | null; tipo_cama: string | null; status: string; alojamento_id: string | null };
      const hospRows2 = (hospRes.data ?? []) as HospRow2[];

      const aloIds = [...new Set(
        hospRows2.map(h => h.alojamento_id).filter((x): x is string => x !== null)
      )];
      const aloRes = aloIds.length > 0
        ? await supabase.from('evento_alojamentos').select('id,nome').in('id', aloIds)
        : { data: [] as { id: string; nome: string }[] };

      if (cancelled) return;

      const hospMap   = new Map(hospRows2.map(h => [h.inscricao_id, h]));
      const aloMap    = new Map(((aloRes.data ?? []) as { id: string; nome: string }[]).map(a => [a.id, a.nome]));
      const membersJson = membersRes && 'ok' in membersRes && membersRes.ok
        ? await membersRes.json().catch(() => null as any)
        : null;
      const memberList = (membersJson?.data ?? []) as { id: string; matricula: string | null }[];
      const memberMap = new Map(memberList.map(m => [m.id, m.matricula]));

      const map = new Map<string, AgoExtra>();
      inscricoesElegiveis.forEach(ins => {
        const hosp = hospMap.get(ins.id);
        map.set(ins.id, {
          matricula:       ins.ministro_id ? (memberMap.get(ins.ministro_id) ?? null) : null,
          numero_cama:     hosp?.numero_cama     ?? null,
          tipo_cama:       hosp?.tipo_cama       ?? null,
          hosp_status:     hosp?.status          ?? null,
          nome_alojamento: hosp?.alojamento_id   ? (aloMap.get(hosp.alojamento_id) ?? null) : null,
        });
      });
      setAgoDataMap(map);
    }
    loadAgo();
    return () => { cancelled = true; };
  }, [evento, inscricoesElegiveis, supabase]);
  const POR_PAG = 48;

  // Supervisões únicas para filtro
  const supsUnicas = useMemo(() => {
    const map = new Map<string, string>();
    inscricoesElegiveis.forEach(i => { if (i.supervisao_id) map.set(i.supervisao_id, nomeSup(i.supervisao_id)); });
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [inscricoesElegiveis, nomeSup]);

  // Filtragem
  const filtradas = useMemo(() => {
    let list = inscricoesElegiveis;
    if (busca.trim())         list = list.filter(i => i.nome_inscrito.toLowerCase().includes(busca.toLowerCase()));
    if (filtroImp === 'impresso')  list = list.filter(i => i.etiqueta_impressa);
    if (filtroImp === 'pendente')  list = list.filter(i => !i.etiqueta_impressa);
    if (filtroSup)            list = list.filter(i => i.supervisao_id === filtroSup);
    if (filtroHosp)           list = list.filter(i => i.hospedagem);
    if (filtroAlim)           list = list.filter(i => i.alimentacao);
    return list;
  }, [inscricoesElegiveis, busca, filtroImp, filtroSup, filtroHosp, filtroAlim]);

  const totalPags = Math.max(1, Math.ceil(filtradas.length / POR_PAG));
  const pagina = useMemo(() => filtradas.slice((pag - 1) * POR_PAG, pag * POR_PAG), [filtradas, pag]);

  // Reset pág ao mudar filtros
  useEffect(() => { setPag(1); }, [busca, filtroImp, filtroSup, filtroHosp, filtroAlim]);

  // Seleção
  const todosNaPaginaIds = pagina.map(i => i.id);
  const todosNaPaginaSelecionados = todosNaPaginaIds.length > 0 && todosNaPaginaIds.every(id => selecionados.has(id));

  function toggleSelecionarPagina() {
    setSelecionados(prev => {
      const next = new Set(prev);
      if (todosNaPaginaSelecionados) todosNaPaginaIds.forEach(id => next.delete(id));
      else todosNaPaginaIds.forEach(id => next.add(id));
      return next;
    });
  }

  function toggleItem(id: string) {
    setSelecionados(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  // Marcar como impressa individualmente
  async function marcar(ins: Inscricao) {
    setSalvando(prev => new Set(prev).add(ins.id));
    await supabase.from('evento_inscricoes').update({ etiqueta_impressa: !ins.etiqueta_impressa }).eq('id', ins.id);
    setSalvando(prev => { const n = new Set(prev); n.delete(ins.id); return n; });
    onRefresh();
  }

  // Marcar vários como impressos
  async function marcarSelecionados() {
    if (!selecionados.size) return;
    const ids = Array.from(selecionados);
    await supabase.from('evento_inscricoes').update({ etiqueta_impressa: true }).in('id', ids);
    setSelecionados(new Set());
    onRefresh();
  }

  // Abrir janela de impressão
  function abrirImpressao(idsParam?: string[], apenas?: 'pendentes') {
    let url = `/eventos/${eventoId}/etiquetas/print?mode=a4`;
    if (idsParam?.length) url += `&ids=${idsParam.join(',')}`;
    else if (apenas)      url += `&apenas=pendentes`;
    window.open(url, '_blank', 'width=1000,height=780');
  }

  if (loading) return <LoadingSkeleton />;

  const totalImpressos = inscricoesElegiveis.filter(i => i.etiqueta_impressa).length;
  const totalPendentes = inscricoesElegiveis.filter(i => !i.etiqueta_impressa).length;

  return (
    <div>
      {/* ── Banner de acesso rápido ── */}
      {preview && evento && (
        <BadgeModal
          ins={preview}
          evento={evento}
          nomeSup={nomeSup(preview.supervisao_id)}
          nomeCampo={nomeCampo(preview.campo_id)}
          onClose={() => setPreview(null)}
          agoData={agoDataMap.get(preview.id)}
        />
      )}

      {/* ── Stats rápidos ── */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-3 text-center">
          <p className="text-xl font-black text-[#123b63]">{inscricoesElegiveis.length}</p>
          <p className="text-xs text-gray-500">Total</p>
        </div>
        <div className="bg-emerald-50 rounded-xl border border-emerald-100 shadow-sm p-3 text-center">
          <p className="text-xl font-black text-emerald-700">{totalImpressos}</p>
          <p className="text-xs text-emerald-600">Impressos</p>
        </div>
        <div className="bg-amber-50 rounded-xl border border-amber-100 shadow-sm p-3 text-center">
          <p className="text-xl font-black text-amber-700">{totalPendentes}</p>
          <p className="text-xs text-amber-600">Pendentes</p>
        </div>
      </div>

      {/* ── Barra de ações de impressão em massa ── */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-3 mb-4 flex flex-wrap items-center gap-2">
        <span className="text-xs text-gray-400 font-semibold">Formato: CA4362 • 99,1×34 mm • 16 por página</span>

        <div className="flex-1" />

        {selecionados.size > 0 && (
          <>
            <button
              onClick={() => abrirImpressao(Array.from(selecionados))}
              className="flex items-center gap-1.5 bg-[#123b63] text-white px-4 py-2 rounded-lg text-xs font-semibold hover:bg-[#0f2a45] transition">
              🖨️ Imprimir {selecionados.size} selecionado{selecionados.size !== 1 ? 's' : ''}
            </button>
            <button
              onClick={marcarSelecionados}
              className="text-xs px-3 py-2 rounded-lg border border-emerald-200 text-emerald-700 hover:bg-emerald-50 transition font-semibold">
              ✅ Marcar como impressos
            </button>
          </>
        )}

        {totalPendentes > 0 && selecionados.size === 0 && (
          <button
            onClick={() => abrirImpressao(undefined, 'pendentes')}
            className="flex items-center gap-1.5 bg-amber-500 text-white px-4 py-2 rounded-lg text-xs font-semibold hover:bg-amber-600 transition">
            🖨️ Pendentes ({totalPendentes})
          </button>
        )}

        <button
          onClick={() => abrirImpressao()}
          className="flex items-center gap-1.5 bg-gray-700 text-white px-4 py-2 rounded-lg text-xs font-semibold hover:bg-gray-800 transition">
          🖨️ Imprimir todos
        </button>
      </div>

      {/* ── Filtros ── */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-3 mb-4 flex flex-wrap gap-2 items-end">
        <input type="text" placeholder="🔍 Buscar nome..." value={busca}
          onChange={e => setBusca(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-xs flex-1 min-w-[240px] sm:min-w-[320px] md:min-w-[420px] focus:outline-none focus:ring-2 focus:ring-[#123b63]" />

        <select value={filtroImp} onChange={e => setFiltroImp(e.target.value as typeof filtroImp)}
          className="border border-gray-200 rounded-lg px-2 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-[#123b63]">
          <option value="todos">Todos</option>
          <option value="pendente">Não impressos</option>
          <option value="impresso">Impressos</option>
        </select>

        {supsUnicas.length > 0 && (
          <select value={filtroSup} onChange={e => setFiltroSup(e.target.value)}
            className="border border-gray-200 rounded-lg px-2 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-[#123b63]">
            <option value="">Toda supervisão</option>
            {supsUnicas.map(([id, nome]) => <option key={id} value={id}>{nome}</option>)}
          </select>
        )}

        <label className="flex items-center gap-1 text-xs text-gray-600 cursor-pointer select-none">
          <input type="checkbox" checked={filtroHosp} onChange={e => setFiltroHosp(e.target.checked)} className="rounded" />
          Hospedagem
        </label>
        <label className="flex items-center gap-1 text-xs text-gray-600 cursor-pointer select-none">
          <input type="checkbox" checked={filtroAlim} onChange={e => setFiltroAlim(e.target.checked)} className="rounded" />
          Alimentação
        </label>

        {(busca || filtroImp !== 'todos' || filtroSup || filtroHosp || filtroAlim) && (
          <button onClick={() => { setBusca(''); setFiltroImp('todos'); setFiltroSup(''); setFiltroHosp(false); setFiltroAlim(false); }}
            className="text-xs text-red-500 hover:text-red-700 underline">
            Limpar filtros
          </button>
        )}

        <span className="ml-auto text-xs text-gray-400">{filtradas.length} resultado{filtradas.length !== 1 ? 's' : ''}</span>
      </div>

      {filtradas.length === 0 ? (
        <EmptyState icon="🏷️" title="Nenhum crachá" desc="Nenhum inscrito corresponde aos filtros." />
      ) : (
        <>
          {/* ── Seleção em massa da página ── */}
          <div className="flex items-center gap-3 mb-3 px-1">
            <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer select-none">
              <input type="checkbox" checked={todosNaPaginaSelecionados} onChange={toggleSelecionarPagina} className="rounded" />
              Selecionar página
            </label>
            {selecionados.size > 0 && (
              <button onClick={() => setSelecionados(new Set())} className="text-xs text-gray-400 hover:text-gray-600 underline">
                Limpar seleção ({selecionados.size})
              </button>
            )}
          </div>

          {/* ── Grid de crachás ── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {pagina.map(ins => (
              <div key={ins.id}
                className={`relative rounded-xl border-2 transition-all ${
                  selecionados.has(ins.id) ? 'border-[#123b63] shadow-lg ring-2 ring-[#123b63]/20' :
                  ins.etiqueta_impressa    ? 'border-emerald-300' : 'border-gray-200'
                }`}
              >
                {/* Checkbox seleção */}
                <input type="checkbox"
                  checked={selecionados.has(ins.id)}
                  onChange={() => toggleItem(ins.id)}
                  className="absolute top-2 left-2 z-10 w-4 h-4 rounded accent-[#123b63]"
                />
                {/* Badge impresso */}
                {ins.etiqueta_impressa && (
                  <span className="absolute top-2 right-2 z-10 bg-emerald-500 text-white text-[9px] font-bold px-2 py-0.5 rounded-full">
                    ✓ IMPRESSO
                  </span>
                )}

                {/* Preview da etiqueta (clicável) */}
                <div className="cursor-pointer p-2 flex justify-center bg-gray-50 rounded-t-lg" onClick={() => setPreview(ins)}>
                  {evento ? (
                    evento.departamento === 'AGO'
                      ? <EtiquetaPreviewAGO
                          inscricao={{ ...ins, ...(agoDataMap.get(ins.id) ?? {}) } as EtiquetaInscricaoAGO}
                          evento={evento}
                          nomeSup={nomeSup(ins.supervisao_id)}
                          nomeCampo={nomeCampo(ins.campo_id)}
                          variant="a4"
                          scale={0.62}
                        />
                      : <EtiquetaPreviewDepartamento
                          inscricao={ins}
                          evento={evento}
                          nomeSup={nomeSup(ins.supervisao_id)}
                          nomeCampo={nomeCampo(ins.campo_id)}
                          variant="a4"
                          scale={0.62}
                        />
                  ) : (
                    <div className="w-full bg-gray-50 rounded-lg p-3">
                      <p className="font-bold text-gray-800 text-sm">{ins.nome_inscrito}</p>
                      <p className="text-xs text-gray-500">{nomeSup(ins.supervisao_id)}</p>
                    </div>
                  )}
                </div>

                {/* Ações */}
                <div className="border-t border-gray-100 px-3 py-2 flex gap-2">
                  <button
                    onClick={() => setPreview(ins)}
                    className="flex-1 text-xs py-1.5 rounded-lg font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition">
                    👁 Ver
                  </button>
                  <button
                    onClick={() => window.open(`/eventos/${eventoId}/etiquetas/print?mode=thermal&ids=${ins.id}`, '_blank', 'width=520,height=420')}
                    className="flex-1 text-xs py-1.5 rounded-lg font-medium bg-purple-600 text-white hover:bg-purple-700 transition">
                    🏷️ Térmica
                  </button>
                  <button
                    onClick={() => abrirImpressao([ins.id])}
                    className="flex-1 text-xs py-1.5 rounded-lg font-medium bg-[#123b63] text-white hover:bg-[#0f2a45] transition">
                    🖨️ A4
                  </button>
                  <button
                    onClick={() => marcar(ins)}
                    disabled={salvando.has(ins.id)}
                    className={`flex-1 text-xs py-1.5 rounded-lg font-medium transition disabled:opacity-50 ${
                      ins.etiqueta_impressa
                        ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}>
                    {salvando.has(ins.id) ? '...' : ins.etiqueta_impressa ? '✅' : '○ Marcar'}
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* ── Paginação ── */}
          {totalPags > 1 && (
            <div className="flex items-center justify-center gap-2 mt-6">
              <button onClick={() => setPag(p => Math.max(1, p - 1))} disabled={pag === 1}
                className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition">
                ‹ Anterior
              </button>
              <span className="text-sm text-gray-500">
                Página <span className="font-bold text-[#123b63]">{pag}</span> de {totalPags}
              </span>
              <button onClick={() => setPag(p => Math.min(totalPags, p + 1))} disabled={pag === totalPags}
                className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition">
                Próxima ›
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// ABA RELATÓRIOS
// ═══════════════════════════════════════════════════════════════

type RelTipo = 'resumo' | 'supervisao' | 'campo' | 'hospedagem' | 'alimentacao' | 'presenca' | 'financeiro';

const REL_TABS: { id: RelTipo; label: string; icon: string; financeiro?: boolean }[] = [
  { id: 'resumo',      label: 'Resumo Geral',     icon: '📊' },
  { id: 'supervisao',  label: 'Por Supervisão',   icon: '🏛️' },
  { id: 'campo',       label: 'Por Campo',         icon: '⛪' },
  { id: 'hospedagem',  label: 'Hospedagem',        icon: '🛏️' },
  { id: 'alimentacao', label: 'Alimentação',        icon: '🍽️' },
  { id: 'presenca',    label: 'Presença',           icon: '📋' },
  { id: 'financeiro',  label: 'Financeiro',         icon: '💳', financeiro: true },
];

// CSV helper
function baixarCSV(nomeArq: string, colunas: string[], linhas: (string | number | null | undefined)[][]) {
  const esc = (v: string | number | null | undefined) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [colunas.map(esc).join(','), ...linhas.map(r => r.map(esc).join(','))].join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a'); a.href = url; a.download = nomeArq; a.click();
  URL.revokeObjectURL(url);
}

function TabRelatorios({ inscricoes, loading, supervisoes, campos, nomeSup, nomeCampo, podeVerFinanceiro, evento, eventoId }: {
  inscricoes: Inscricao[]; loading: boolean;
  supervisoes: Supervisao[]; campos: Campo[];
  nomeSup: (id: string | null) => string;
  nomeCampo: (id: string | null) => string;
  podeVerFinanceiro: boolean;
  evento: Evento | null;
  eventoId: string;
}) {
  const [relTipo,      setRelTipo]      = useState<RelTipo>('resumo');
  const [filtroSup,    setFiltroSup]    = useState('');
  const [filtroCampo,  setFiltroCampo]  = useState('');
  const [filtroPag,    setFiltroPag]    = useState('');
  const [filtroCheckin,setFiltroCheckin]= useState('');

  // Tabs visíveis (oculta financeiro se sem permissão)
  const relTabsVisiveis = REL_TABS.filter(t => !t.financeiro || podeVerFinanceiro);

  // Filtragem aplicada a todos os relatórios
  const filtradas = useMemo(() => {
    let list = inscricoes;
    if (filtroSup)     list = list.filter(i => i.supervisao_id === filtroSup);
    if (filtroCampo)   list = list.filter(i => i.campo_id === filtroCampo);
    if (filtroPag)     list = list.filter(i => i.status_pagamento === filtroPag);
    if (filtroCheckin === '1') list = list.filter(i => i.checkin_realizado);
    if (filtroCheckin === '0') list = list.filter(i => !i.checkin_realizado);
    return list;
  }, [inscricoes, filtroSup, filtroCampo, filtroPag, filtroCheckin]);

  // Agrupamentos para relatórios tabulares
  const porSup = useMemo(() => {
    const map = new Map<string, { nome: string; total: number; pagos: number; pendentes: number; isentos: number; checkins: number; valor: number }>();
    filtradas.forEach(i => {
      const k   = i.supervisao_id ?? '__sem__';
      const nom = nomeSup(i.supervisao_id);
      const cur = map.get(k) ?? { nome: nom, total: 0, pagos: 0, pendentes: 0, isentos: 0, checkins: 0, valor: 0 };
      cur.total++;
      if (i.status_pagamento === 'pago')     { cur.pagos++;     cur.valor += i.valor_pago; }
      if (i.status_pagamento === 'pendente')   cur.pendentes++;
      if (i.status_pagamento === 'isento')     cur.isentos++;
      if (i.checkin_realizado)                 cur.checkins++;
      map.set(k, cur);
    });
    return Array.from(map.values()).sort((a, b) => a.nome.localeCompare(b.nome));
  }, [filtradas, nomeSup]);

  const porCampo = useMemo(() => {
    const map = new Map<string, { nome: string; sup: string; total: number; pagos: number; pendentes: number; checkins: number; hosp: number; alim: number }>();
    filtradas.forEach(i => {
      const k   = i.campo_id ?? '__sem__';
      const nom = nomeCampo(i.campo_id);
      const sup = nomeSup(i.supervisao_id);
      const cur = map.get(k) ?? { nome: nom, sup, total: 0, pagos: 0, pendentes: 0, checkins: 0, hosp: 0, alim: 0 };
      cur.total++;
      if (i.status_pagamento === 'pago')  cur.pagos++;
      if (i.status_pagamento === 'pendente') cur.pendentes++;
      if (i.checkin_realizado) cur.checkins++;
      if (i.hospedagem)        cur.hosp++;
      if (i.alimentacao)       cur.alim++;
      map.set(k, cur);
    });
    return Array.from(map.values()).sort((a, b) => a.nome.localeCompare(b.nome));
  }, [filtradas, nomeSup, nomeCampo]);

  // Stats resumo (sobre filtradas)
  const resumo = useMemo(() => ({
    total:      filtradas.length,
    pagos:      filtradas.filter(i => i.status_pagamento === 'pago').length,
    pendentes:  filtradas.filter(i => i.status_pagamento === 'pendente').length,
    isentos:    filtradas.filter(i => i.status_pagamento === 'isento').length,
    cancelados: filtradas.filter(i => i.status_pagamento === 'cancelado').length,
    checkins:   filtradas.filter(i => i.checkin_realizado).length,
    etiquetas:  filtradas.filter(i => i.etiqueta_impressa).length,
    hospedagem: filtradas.filter(i => i.hospedagem).length,
    alimentacao:filtradas.filter(i => i.alimentacao).length,
    brindes:    filtradas.filter(i => i.brinde).length,
    valor:      filtradas.filter(i => i.status_pagamento === 'pago').reduce((s, i) => s + i.valor_pago, 0),
  }), [filtradas]);

  // Exportar CSV conforme relatório ativo
  function exportarCSV() {
    const ev   = evento?.nome ?? eventoId;
    const safe = (s: string) => s.replace(/[^a-z0-9]/gi, '_').slice(0, 30);

    if (relTipo === 'resumo') {
      baixarCSV(`relatorio_resumo_${safe(ev)}.csv`,
        ['Indicador', 'Valor'],
        [
          ['Total inscritos', resumo.total],
          ['Pagos', resumo.pagos],
          ['Pendentes', resumo.pendentes],
          ['Isentos', resumo.isentos],
          ['Cancelados', resumo.cancelados],
          ['Check-ins', resumo.checkins],
          ['Etiquetas impressas', resumo.etiquetas],
          ['Hospedagem', resumo.hospedagem],
          ['Alimentação', resumo.alimentacao],
          ...(podeVerFinanceiro ? [['Valor arrecadado', fmtMoeda(resumo.valor)]] : []),
        ]);
    } else if (relTipo === 'supervisao') {
      const cols = ['Supervisão', 'Total', 'Pagos', 'Pendentes', 'Isentos', 'Check-ins', ...(podeVerFinanceiro ? ['Arrecadado'] : [])];
      baixarCSV(`relatorio_supervisao_${safe(ev)}.csv`, cols,
        porSup.map(r => [r.nome, r.total, r.pagos, r.pendentes, r.isentos, r.checkins, ...(podeVerFinanceiro ? [fmtMoeda(r.valor)] : [])]));
    } else if (relTipo === 'campo') {
      baixarCSV(`relatorio_campo_${safe(ev)}.csv`,
        ['Campo', 'Supervisão', 'Total', 'Pagos', 'Pendentes', 'Check-ins', 'Hospedagem', 'Alimentação'],
        porCampo.map(r => [r.nome, r.sup, r.total, r.pagos, r.pendentes, r.checkins, r.hosp, r.alim]));
    } else if (relTipo === 'hospedagem') {
      baixarCSV(`relatorio_hospedagem_${safe(ev)}.csv`,
        ['Nome', 'CPF', 'WhatsApp', 'Supervisão', 'Campo', 'Status Pagamento', 'Check-in'],
        filtradas.filter(i => i.hospedagem).map(i => [i.nome_inscrito, i.cpf, i.whatsapp, nomeSup(i.supervisao_id), nomeCampo(i.campo_id), i.status_pagamento, i.checkin_realizado ? 'Sim' : 'Não']));
    } else if (relTipo === 'alimentacao') {
      baixarCSV(`relatorio_alimentacao_${safe(ev)}.csv`,
        ['Nome', 'CPF', 'WhatsApp', 'Supervisão', 'Campo', 'Status Pagamento', 'Check-in'],
        filtradas.filter(i => i.alimentacao).map(i => [i.nome_inscrito, i.cpf, i.whatsapp, nomeSup(i.supervisao_id), nomeCampo(i.campo_id), i.status_pagamento, i.checkin_realizado ? 'Sim' : 'Não']));
    } else if (relTipo === 'presenca') {
      baixarCSV(`relatorio_presenca_${safe(ev)}.csv`,
        ['Nome', 'CPF', 'Supervisão', 'Campo', 'Check-in', 'Horário Check-in'],
        filtradas.map(i => [i.nome_inscrito, i.cpf, nomeSup(i.supervisao_id), nomeCampo(i.campo_id), i.checkin_realizado ? 'Sim' : 'Não', i.checkin_at ? fmtDT(i.checkin_at) : '-']));
    } else if (relTipo === 'financeiro' && podeVerFinanceiro) {
      baixarCSV(`relatorio_financeiro_${safe(ev)}.csv`,
        ['Nome', 'CPF', 'Valor Pago', 'Forma Pagamento', 'Status', 'Data Inscrição'],
        filtradas.map(i => [i.nome_inscrito, i.cpf, fmtMoeda(i.valor_pago), i.forma_pagamento ?? '-', i.status_pagamento, fmtData(i.created_at.slice(0, 10))]));
    }
  }

  function abrirImpressao() {
    const p = new URLSearchParams({
      tipo: relTipo,
      fin:  podeVerFinanceiro ? '1' : '0',
      ...(filtroSup     ? { sup:     filtroSup }     : {}),
      ...(filtroCampo   ? { campo:   filtroCampo }   : {}),
      ...(filtroPag     ? { pag:     filtroPag }     : {}),
      ...(filtroCheckin ? { checkin: filtroCheckin } : {}),
    });
    window.open(`/eventos/${eventoId}/relatorios/print?${p}`, '_blank', 'width=960,height=720');
  }

  // Campos filtrados por supervisão selecionada
  const camposFiltrados = useMemo(() =>
    filtroSup ? campos.filter(c => c.supervisao_id === filtroSup) : campos,
    [campos, filtroSup]);

  if (loading) return <LoadingSkeleton />;

  // ── Helpers visuais ──────────────────────────────────────────
  const thCls = 'text-left text-xs font-semibold text-gray-500 uppercase tracking-wide py-2.5 px-3 bg-gray-50 first:rounded-tl-lg last:rounded-tr-lg';
  const tdCls = 'py-2.5 px-3 text-sm text-gray-700 border-t border-gray-50';
  const tdNumCls = `${tdCls} text-right tabular-nums`;

  const filtrosAtivos = filtroSup || filtroCampo || filtroPag || filtroCheckin;

  return (
    <div className="space-y-4">
      {/* Sub-tabs */}
      <div className="flex flex-wrap gap-1 bg-gray-100 rounded-xl p-1">
        {relTabsVisiveis.map(t => (
          <button key={t.id} onClick={() => setRelTipo(t.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${relTipo === t.id ? 'bg-white text-[#123b63] shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* Filtros */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-3 flex flex-wrap gap-2 items-end">
        <div>
          <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1">Supervisão</p>
          <select value={filtroSup} onChange={e => { setFiltroSup(e.target.value); setFiltroCampo(''); }}
            className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#123b63] min-w-[140px]">
            <option value="">Todas</option>
            {supervisoes.map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}
          </select>
        </div>
        <div>
          <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1">Campo</p>
          <select value={filtroCampo} onChange={e => setFiltroCampo(e.target.value)}
            className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#123b63] min-w-[140px]">
            <option value="">Todos</option>
            {camposFiltrados.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        </div>
        <div>
          <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1">Pagamento</p>
          <select value={filtroPag} onChange={e => setFiltroPag(e.target.value)}
            className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#123b63]">
            <option value="">Todos</option>
            <option value="pago">Pago</option>
            <option value="pendente">Pendente</option>
            <option value="isento">Isento</option>
            <option value="cancelado">Cancelado</option>
          </select>
        </div>
        <div>
          <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1">Check-in</p>
          <select value={filtroCheckin} onChange={e => setFiltroCheckin(e.target.value)}
            className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#123b63]">
            <option value="">Todos</option>
            <option value="1">Realizados</option>
            <option value="0">Não realizados</option>
          </select>
        </div>
        {filtrosAtivos && (
          <button onClick={() => { setFiltroSup(''); setFiltroCampo(''); setFiltroPag(''); setFiltroCheckin(''); }}
            className="text-xs text-red-500 hover:text-red-700 underline mt-4">
            Limpar filtros
          </button>
        )}
        <div className="ml-auto flex gap-2 mt-auto">
          <button onClick={exportarCSV}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-semibold text-gray-700 hover:bg-gray-50 transition">
            📥 Exportar CSV
          </button>
          <button onClick={abrirImpressao}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#123b63] text-white text-xs font-semibold hover:bg-[#0f2a45] transition">
            🖨️ Imprimir
          </button>
        </div>
      </div>

      {/* Contador */}
      <p className="text-xs text-gray-400 px-1">
        {filtradas.length} registro{filtradas.length !== 1 ? 's' : ''}{filtrosAtivos ? ' (com filtros)' : ''}
      </p>

      {/* ── CONTEÚDO DO RELATÓRIO ───────────────────────────── */}

      {/* RESUMO GERAL */}
      {relTipo === 'resumo' && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {[
            { label: 'Total Inscritos',    value: resumo.total,                      cor: 'text-[#123b63]', bg: 'bg-blue-50'   },
            { label: 'Pagos',              value: resumo.pagos,                      cor: 'text-emerald-700', bg: 'bg-emerald-50' },
            { label: 'Pendentes',          value: resumo.pendentes,                  cor: 'text-amber-700', bg: 'bg-amber-50'   },
            { label: 'Isentos',            value: resumo.isentos,                    cor: 'text-blue-700',  bg: 'bg-blue-50'    },
            { label: 'Cancelados',         value: resumo.cancelados,                 cor: 'text-red-700',   bg: 'bg-red-50'     },
            { label: 'Check-ins',          value: `${resumo.checkins} / ${resumo.total}`, cor: 'text-purple-700', bg: 'bg-purple-50' },
            { label: 'Etiquetas Impressas',value: resumo.etiquetas,                  cor: 'text-teal-700',  bg: 'bg-teal-50'    },
            { label: 'Hospedagem',         value: resumo.hospedagem,                 cor: 'text-sky-700',   bg: 'bg-sky-50'     },
            { label: 'Alimentação',        value: resumo.alimentacao,                cor: 'text-orange-700',bg: 'bg-orange-50'  },
            { label: 'Brindes',            value: resumo.brindes,                    cor: 'text-yellow-700',bg: 'bg-yellow-50'  },
            ...(podeVerFinanceiro ? [{ label: 'Valor Arrecadado', value: fmtMoeda(resumo.valor), cor: 'text-green-800', bg: 'bg-green-50' }] : []),
          ].map(({ label, value, cor, bg }) => (
            <div key={label} className={`${bg} rounded-xl border border-gray-100 shadow-sm p-4`}>
              <p className={`text-2xl font-black ${cor}`}>{value}</p>
              <p className="text-xs text-gray-500 mt-1">{label}</p>
            </div>
          ))}
        </div>
      )}

      {/* POR SUPERVISÃO */}
      {relTipo === 'supervisao' && (
        porSup.length === 0 ? <EmptyState icon="🏛️" title="Sem dados" desc="Nenhum inscrito com os filtros aplicados." /> : (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <table className="w-full">
              <thead><tr>
                <th className={thCls}>Supervisão</th>
                <th className={`${thCls} text-right`}>Total</th>
                <th className={`${thCls} text-right`}>Pagos</th>
                <th className={`${thCls} text-right`}>Pendentes</th>
                <th className={`${thCls} text-right`}>Isentos</th>
                <th className={`${thCls} text-right`}>Check-ins</th>
                {podeVerFinanceiro && <th className={`${thCls} text-right`}>Arrecadado</th>}
              </tr></thead>
              <tbody>
                {porSup.map(r => (
                  <tr key={r.nome} className="hover:bg-gray-50 transition">
                    <td className={`${tdCls} font-medium`}>{r.nome}</td>
                    <td className={tdNumCls}>{r.total}</td>
                    <td className={`${tdNumCls} text-emerald-700`}>{r.pagos}</td>
                    <td className={`${tdNumCls} text-amber-700`}>{r.pendentes}</td>
                    <td className={`${tdNumCls} text-blue-700`}>{r.isentos}</td>
                    <td className={`${tdNumCls} text-purple-700`}>{r.checkins}</td>
                    {podeVerFinanceiro && <td className={`${tdNumCls} text-green-700`}>{fmtMoeda(r.valor)}</td>}
                  </tr>
                ))}
                {/* Totais */}
                <tr className="bg-gray-50 font-bold border-t-2 border-gray-200">
                  <td className={`${tdCls} font-bold`}>TOTAL</td>
                  <td className={tdNumCls}>{porSup.reduce((s, r) => s + r.total, 0)}</td>
                  <td className={`${tdNumCls} text-emerald-700`}>{porSup.reduce((s, r) => s + r.pagos, 0)}</td>
                  <td className={`${tdNumCls} text-amber-700`}>{porSup.reduce((s, r) => s + r.pendentes, 0)}</td>
                  <td className={`${tdNumCls} text-blue-700`}>{porSup.reduce((s, r) => s + r.isentos, 0)}</td>
                  <td className={`${tdNumCls} text-purple-700`}>{porSup.reduce((s, r) => s + r.checkins, 0)}</td>
                  {podeVerFinanceiro && <td className={`${tdNumCls} text-green-700`}>{fmtMoeda(porSup.reduce((s, r) => s + r.valor, 0))}</td>}
                </tr>
              </tbody>
            </table>
          </div>
        )
      )}

      {/* POR CAMPO */}
      {relTipo === 'campo' && (
        porCampo.length === 0 ? <EmptyState icon="⛪" title="Sem dados" desc="Nenhum inscrito com os filtros aplicados." /> : (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <table className="w-full">
              <thead><tr>
                <th className={thCls}>Campo</th>
                <th className={thCls}>Supervisão</th>
                <th className={`${thCls} text-right`}>Total</th>
                <th className={`${thCls} text-right`}>Pagos</th>
                <th className={`${thCls} text-right`}>Pendentes</th>
                <th className={`${thCls} text-right`}>Check-ins</th>
                <th className={`${thCls} text-right`}>🛏</th>
                <th className={`${thCls} text-right`}>🍽</th>
              </tr></thead>
              <tbody>
                {porCampo.map(r => (
                  <tr key={r.nome} className="hover:bg-gray-50 transition">
                    <td className={`${tdCls} font-medium`}>{r.nome}</td>
                    <td className={`${tdCls} text-gray-500`}>{r.sup}</td>
                    <td className={tdNumCls}>{r.total}</td>
                    <td className={`${tdNumCls} text-emerald-700`}>{r.pagos}</td>
                    <td className={`${tdNumCls} text-amber-700`}>{r.pendentes}</td>
                    <td className={`${tdNumCls} text-purple-700`}>{r.checkins}</td>
                    <td className={`${tdNumCls} text-sky-700`}>{r.hosp}</td>
                    <td className={`${tdNumCls} text-orange-700`}>{r.alim}</td>
                  </tr>
                ))}
                <tr className="bg-gray-50 font-bold border-t-2 border-gray-200">
                  <td className={`${tdCls} font-bold`} colSpan={2}>TOTAL</td>
                  <td className={tdNumCls}>{porCampo.reduce((s, r) => s + r.total, 0)}</td>
                  <td className={`${tdNumCls} text-emerald-700`}>{porCampo.reduce((s, r) => s + r.pagos, 0)}</td>
                  <td className={`${tdNumCls} text-amber-700`}>{porCampo.reduce((s, r) => s + r.pendentes, 0)}</td>
                  <td className={`${tdNumCls} text-purple-700`}>{porCampo.reduce((s, r) => s + r.checkins, 0)}</td>
                  <td className={`${tdNumCls} text-sky-700`}>{porCampo.reduce((s, r) => s + r.hosp, 0)}</td>
                  <td className={`${tdNumCls} text-orange-700`}>{porCampo.reduce((s, r) => s + r.alim, 0)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )
      )}

      {/* HOSPEDAGEM */}
      {relTipo === 'hospedagem' && (() => {
        const lista = filtradas.filter(i => i.hospedagem);
        return lista.length === 0 ? <EmptyState icon="🛏️" title="Sem hospedagem" desc="Nenhum inscrito com hospedagem nos filtros aplicados." /> : (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <table className="w-full">
              <thead><tr>
                <th className={thCls}>Nome</th>
                <th className={thCls}>CPF</th>
                <th className={thCls}>WhatsApp</th>
                <th className={thCls}>Supervisão</th>
                <th className={thCls}>Campo</th>
                <th className={thCls}>Pagamento</th>
                <th className={`${thCls} text-center`}>Check-in</th>
              </tr></thead>
              <tbody>
                {lista.map(i => (
                  <tr key={i.id} className="hover:bg-gray-50 transition">
                    <td className={`${tdCls} font-medium`}>{i.nome_inscrito}</td>
                    <td className={tdCls}>{i.cpf ?? '-'}</td>
                    <td className={tdCls}>{i.whatsapp ?? '-'}</td>
                    <td className={tdCls}>{nomeSup(i.supervisao_id)}</td>
                    <td className={tdCls}>{nomeCampo(i.campo_id)}</td>
                    <td className={tdCls}>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${STATUS_PAG_CFG[i.status_pagamento]?.cls ?? ''}`}>
                        {STATUS_PAG_CFG[i.status_pagamento]?.label ?? i.status_pagamento}
                      </span>
                    </td>
                    <td className={`${tdCls} text-center`}>{i.checkin_realizado ? '✅' : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })()}

      {/* ALIMENTAÇÃO */}
      {relTipo === 'alimentacao' && (() => {
        const lista = filtradas.filter(i => i.alimentacao);
        return lista.length === 0 ? <EmptyState icon="🍽️" title="Sem alimentação" desc="Nenhum inscrito com alimentação nos filtros aplicados." /> : (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <table className="w-full">
              <thead><tr>
                <th className={thCls}>Nome</th>
                <th className={thCls}>CPF</th>
                <th className={thCls}>WhatsApp</th>
                <th className={thCls}>Supervisão</th>
                <th className={thCls}>Campo</th>
                <th className={thCls}>Pagamento</th>
                <th className={`${thCls} text-center`}>Check-in</th>
              </tr></thead>
              <tbody>
                {lista.map(i => (
                  <tr key={i.id} className="hover:bg-gray-50 transition">
                    <td className={`${tdCls} font-medium`}>{i.nome_inscrito}</td>
                    <td className={tdCls}>{i.cpf ?? '-'}</td>
                    <td className={tdCls}>{i.whatsapp ?? '-'}</td>
                    <td className={tdCls}>{nomeSup(i.supervisao_id)}</td>
                    <td className={tdCls}>{nomeCampo(i.campo_id)}</td>
                    <td className={tdCls}>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${STATUS_PAG_CFG[i.status_pagamento]?.cls ?? ''}`}>
                        {STATUS_PAG_CFG[i.status_pagamento]?.label ?? i.status_pagamento}
                      </span>
                    </td>
                    <td className={`${tdCls} text-center`}>{i.checkin_realizado ? '✅' : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })()}

      {/* LISTA DE PRESENÇA */}
      {relTipo === 'presenca' && (
        filtradas.length === 0 ? <EmptyState icon="📋" title="Sem inscritos" desc="Nenhum inscrito com os filtros aplicados." /> : (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <table className="w-full">
              <thead><tr>
                <th className={thCls}>#</th>
                <th className={thCls}>Nome</th>
                <th className={thCls}>CPF</th>
                <th className={thCls}>Supervisão</th>
                <th className={thCls}>Campo</th>
                <th className={`${thCls} text-center`}>Check-in</th>
                <th className={thCls}>Horário</th>
              </tr></thead>
              <tbody>
                {filtradas.map((i, idx) => (
                  <tr key={i.id} className="hover:bg-gray-50 transition">
                    <td className={`${tdCls} text-gray-400`}>{idx + 1}</td>
                    <td className={`${tdCls} font-medium`}>{i.nome_inscrito}</td>
                    <td className={tdCls}>{i.cpf ?? '-'}</td>
                    <td className={tdCls}>{nomeSup(i.supervisao_id)}</td>
                    <td className={tdCls}>{nomeCampo(i.campo_id)}</td>
                    <td className={`${tdCls} text-center`}>
                      {i.checkin_realizado
                        ? <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-semibold">Sim</span>
                        : <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">Não</span>}
                    </td>
                    <td className={`${tdCls} text-gray-500`}>{i.checkin_at ? fmtDT(i.checkin_at) : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {/* FINANCEIRO */}
      {relTipo === 'financeiro' && podeVerFinanceiro && (
        filtradas.length === 0 ? <EmptyState icon="💳" title="Sem dados" desc="Nenhum inscrito com os filtros aplicados." /> : (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <table className="w-full">
              <thead><tr>
                <th className={thCls}>Nome</th>
                <th className={thCls}>CPF</th>
                <th className={`${thCls} text-right`}>Valor Pago</th>
                <th className={thCls}>Forma Pgto</th>
                <th className={thCls}>Status</th>
                <th className={thCls}>Inscrição</th>
              </tr></thead>
              <tbody>
                {filtradas.map(i => (
                  <tr key={i.id} className="hover:bg-gray-50 transition">
                    <td className={`${tdCls} font-medium`}>{i.nome_inscrito}</td>
                    <td className={tdCls}>{i.cpf ?? '-'}</td>
                    <td className={`${tdNumCls} ${i.status_pagamento === 'pago' ? 'text-emerald-700' : 'text-gray-500'}`}>{fmtMoeda(i.valor_pago)}</td>
                    <td className={`${tdCls} text-gray-500`}>{i.forma_pagamento ?? '-'}</td>
                    <td className={tdCls}>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${STATUS_PAG_CFG[i.status_pagamento]?.cls ?? ''}`}>
                        {STATUS_PAG_CFG[i.status_pagamento]?.label ?? i.status_pagamento}
                      </span>
                    </td>
                    <td className={`${tdCls} text-gray-500`}>{fmtData(i.created_at.slice(0, 10))}</td>
                  </tr>
                ))}
                <tr className="bg-gray-50 font-bold border-t-2 border-gray-200">
                  <td className={`${tdCls} font-bold`} colSpan={2}>TOTAL ARRECADADO</td>
                  <td className={`${tdNumCls} text-emerald-700 font-bold`}>
                    {fmtMoeda(filtradas.filter(i => i.status_pagamento === 'pago').reduce((s, i) => s + i.valor_pago, 0))}
                  </td>
                  <td colSpan={3} />
                </tr>
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// ABA FINANCEIRO
// ═══════════════════════════════════════════════════════════════
function TabFinanceiro({ inscricoes, loading, stats, supervisoes, campos, nomeSup, nomeCampo, onRefresh }: {
  inscricoes: Inscricao[]; loading: boolean;
  stats: { total: number; pagos: number; pendentes: number; isentos: number; arrecadado: number };
  supervisoes: Supervisao[]; campos: Campo[];
  nomeSup: (id: string | null) => string;
  nomeCampo: (id: string | null) => string;
  onRefresh: () => void;
}) {
  const [busca,       setBusca]       = useState('');
  const [filtroSup,   setFiltroSup]   = useState('');
  const [filtroCampo, setFiltroCampo] = useState('');
  const [filtroPag,   setFiltroPag]   = useState('');
  const [salvando,       setSalvando]       = useState<string | null>(null);
  const [confirmarIns,   setConfirmarIns]   = useState<Inscricao | null>(null);
  const [erroModal,      setErroModal]      = useState<string | null>(null);

  const camposFiltrados = useMemo(() =>
    filtroSup ? campos.filter(c => c.supervisao_id === filtroSup) : campos,
    [campos, filtroSup]
  );

  const filtradas = useMemo(() => {
    return inscricoes.filter(i => {
      if (busca && !i.nome_inscrito.toLowerCase().includes(busca.toLowerCase()) &&
          !(i.cpf || '').includes(busca) && !(i.whatsapp || '').includes(busca)) return false;
      if (filtroSup   && i.supervisao_id !== filtroSup)    return false;
      if (filtroCampo && i.campo_id      !== filtroCampo)  return false;
      if (filtroPag   && i.status_pagamento !== filtroPag) return false;
      return true;
    });
  }, [inscricoes, busca, filtroSup, filtroCampo, filtroPag]);

  async function confirmarBaixaManual() {
    if (!confirmarIns) return;
    const ins = confirmarIns;
    setSalvando(ins.id);
    setErroModal(null);
    try {
      const res = await fetch(`/api/eventos/inscricao/${ins.id}/baixa-manual`, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErroModal(body.error ?? res.statusText);
        return;
      }
      setConfirmarIns(null);
      onRefresh();
    } catch {
      setErroModal('Erro de conexão. Tente novamente.');
    } finally {
      setSalvando(null);
    }
  }

  if (loading) return <LoadingSkeleton />;

  return (
    <div>
      {/* Cards de resumo */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total inscritos', value: stats.total,                    color: 'border-[#123b63]', text: 'text-[#123b63]' },
          { label: 'Pagos',           value: stats.pagos,                    color: 'border-emerald-500', text: 'text-emerald-700' },
          { label: 'Pendentes',       value: stats.pendentes,                color: 'border-yellow-500', text: 'text-yellow-700' },
          { label: 'Isentos',         value: stats.isentos,                  color: 'border-blue-500',   text: 'text-blue-700'   },
        ].map(c => (
          <div key={c.label} className={`bg-white rounded-xl p-4 shadow-sm border-l-4 ${c.color}`}>
            <p className="text-xs text-gray-500 mb-1">{c.label}</p>
            <p className={`text-2xl font-bold ${c.text}`}>{c.value}</p>
          </div>
        ))}
      </div>
      <div className="bg-white rounded-xl p-4 shadow-sm border-l-4 border-[#F39C12] mb-6">
        <p className="text-xs text-gray-500 mb-1">Total Arrecadado</p>
        <p className="text-3xl font-bold text-[#F39C12]">{fmtMoeda(stats.arrecadado)}</p>
      </div>

      {/* Tabela */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-x-auto">
        <div className="p-4 border-b border-gray-100 flex flex-wrap items-center gap-2">
          <input
            type="text" value={busca} onChange={e => setBusca(e.target.value)}
            placeholder="Buscar nome, CPF, WhatsApp..."
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white min-w-[200px] flex-1"
          />
          <select value={filtroSup} onChange={e => { setFiltroSup(e.target.value); setFiltroCampo(''); }}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white">
            <option value="">Todas supervisões</option>
            {supervisoes.map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}
          </select>
          <select value={filtroCampo} onChange={e => setFiltroCampo(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white">
            <option value="">Todos campos</option>
            {camposFiltrados.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
          <select value={filtroPag} onChange={e => setFiltroPag(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white">
            <option value="">Pagamento</option>
            <option value="pago">Pago</option>
            <option value="pendente">Pendente</option>
            <option value="isento">Isento</option>
            <option value="cancelado">Cancelado</option>
          </select>
          {(busca || filtroSup || filtroCampo || filtroPag) && (
            <button onClick={() => { setBusca(''); setFiltroSup(''); setFiltroCampo(''); setFiltroPag(''); }}
              className="text-sm text-gray-500 hover:text-gray-700 px-2 py-1.5 rounded border border-gray-300 bg-white">
              Limpar
            </button>
          )}
          <span className="text-xs text-gray-400 ml-1">{filtradas.length} resultado(s)</span>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              {['Nome', 'Supervisão', 'Campo', 'Valor', 'Status', 'Forma Pagamento', 'Ações'].map(h => (
                <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-600 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtradas.map(ins => {
              const pagCfg = STATUS_PAG_CFG[ins.status_pagamento] ?? STATUS_PAG_CFG.pendente;
              return (
                <tr key={ins.id} className="border-b border-gray-50 hover:bg-gray-50 transition">
                  <td className="px-4 py-3 font-medium text-gray-800 whitespace-nowrap">{ins.nome_inscrito}</td>
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{nomeSup(ins.supervisao_id)}</td>
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{nomeCampo(ins.campo_id)}</td>
                  <td className="px-4 py-3 font-medium text-gray-800 whitespace-nowrap">{fmtMoeda(ins.valor_pago)}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${pagCfg.cls}`}>{pagCfg.label}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{ins.forma_pagamento || '-'}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {ins.status_pagamento !== 'pago' && ins.status_pagamento !== 'isento' && (
                      <button onClick={() => { setErroModal(null); setConfirmarIns(ins); }} disabled={salvando === ins.id}
                        className="text-xs px-2 py-1 bg-emerald-100 text-emerald-700 rounded font-semibold hover:bg-emerald-200 transition disabled:opacity-50">
                        💳 Baixa manual
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtradas.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-8">Nenhum registro encontrado.</p>
        )}
      </div>

      {/* Modal de confirmação de baixa manual */}
      {confirmarIns && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden">
            {/* Cabeçalho */}
            <div className="bg-[#123b63] px-6 py-4 flex items-center gap-3">
              <span className="text-2xl">💳</span>
              <h2 className="text-white font-bold text-base">Confirmar Baixa Manual</h2>
            </div>
            {/* Corpo */}
            <div className="px-6 py-5">
              <p className="text-gray-600 text-sm mb-1">Você está confirmando pagamento para:</p>
              <p className="font-bold text-[#123b63] text-lg mb-1">{confirmarIns.nome_inscrito}</p>
              <div className="flex flex-wrap gap-2 mt-3 mb-1">
                <span className="text-xs px-2 py-1 bg-gray-100 text-gray-600 rounded-full">
                  {fmtMoeda(confirmarIns.valor_pago)}
                </span>
                {confirmarIns.forma_pagamento && (
                  <span className="text-xs px-2 py-1 bg-blue-50 text-blue-600 rounded-full capitalize">
                    {confirmarIns.forma_pagamento}
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-400 mt-3">O status será alterado para <strong>Pago</strong>.</p>
              {erroModal && (
                <p className="mt-3 text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{erroModal}</p>
              )}
            </div>
            {/* Rodapé */}
            <div className="px-6 pb-5 flex gap-3 justify-end">
              <button
                onClick={() => { setConfirmarIns(null); setErroModal(null); }}
                disabled={salvando === confirmarIns.id}
                className="px-4 py-2 rounded-lg border border-gray-300 text-sm text-gray-600 hover:bg-gray-50 transition disabled:opacity-50">
                Cancelar
              </button>
              <button
                onClick={confirmarBaixaManual}
                disabled={salvando === confirmarIns.id}
                className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 transition disabled:opacity-50 flex items-center gap-2">
                {salvando === confirmarIns.id ? (
                  <><span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Salvando...</>
                ) : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// ABA EQUIPE
// ═══════════════════════════════════════════════════════════════
function TabEquipe({ eventoId, evento, equipe, supabase: _supabase, onRefresh }: {
  eventoId: string; evento: Evento; equipe: Equipe[];
  supabase: ReturnType<typeof createClient>;
  onRefresh: () => void;
}) {
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [funcao, setFuncao] = useState<'operador' | 'checkin' | 'hospedagem' | 'checkin_hospedagem'>('checkin');
  const [senha, setSenha] = useState('');
  const [confirmarSenha, setConfirmarSenha] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);
  const [acaoId, setAcaoId] = useState<string | null>(null);
  const [removerConfirm, setRemoverConfirm] = useState<Equipe | null>(null);
  const [removendo, setRemovendo] = useState(false);
  const [editando, setEditando] = useState<Equipe | null>(null);
  const [editNome, setEditNome] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editFuncao, setEditFuncao] = useState<'operador' | 'checkin' | 'hospedagem' | 'checkin_hospedagem'>('checkin');
  const [editSenha, setEditSenha] = useState('');
  const [editConfirmarSenha, setEditConfirmarSenha] = useState('');
  const [resetando, setResetando] = useState<Equipe | null>(null);
  const [novaSenha, setNovaSenha] = useState('');
  const [confirmarNovaSenha, setConfirmarNovaSenha] = useState('');
  const [linkCopiado, setLinkCopiado] = useState<'operador' | 'checkin' | 'hospedagem' | 'checkin_hospedagem' | null>(null);
  const [reenviandoId, setReenviandoId] = useState<string | null>(null);
  const timeoutsRef = useRef<number[]>([]);

  useEffect(() => () => {
    timeoutsRef.current.forEach(t => clearTimeout(t));
    timeoutsRef.current = [];
  }, []);

  const scheduleClear = useCallback((fn: () => void, ms = 5000) => {
    const id = window.setTimeout(fn, ms);
    timeoutsRef.current.push(id);
  }, []);

  const mostrarErro = useCallback((msg: string) => {
    setErro(msg);
    setSucesso(null);
    scheduleClear(() => setErro(null));
  }, [scheduleClear]);

  const mostrarSucesso = useCallback((msg: string) => {
    setSucesso(msg);
    setErro(null);
    scheduleClear(() => setSucesso(null));
  }, [scheduleClear]);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const operadorUrl = origin ? `${origin}/eventos/${eventoId}/operador` : `/eventos/${eventoId}/operador`;
  const checkinUrl = origin ? `${origin}/eventos/${eventoId}/checkin` : `/eventos/${eventoId}/checkin`;
  const hospedagemUrl = origin ? `${origin}/eventos/${eventoId}/hospedagem` : `/eventos/${eventoId}/hospedagem`;
  const checkinHospedagemUrl = origin ? `${origin}/eventos/${eventoId}/hospedagem/checkin` : `/eventos/${eventoId}/hospedagem/checkin`;

  async function registrarCopiaLink(funcaoEquipe: 'operador' | 'checkin' | 'hospedagem' | 'checkin_hospedagem', url: string) {
    try {
      await fetch('/api/v1/audit-logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          acao: 'copiar_link_equipe',
          modulo: 'eventos',
          area: 'evento_equipe',
          tabela_afetada: 'evento_equipe',
          descricao: `Link de acesso da equipe copiado (${funcaoEquipe}).`,
          dados_novos: { eventoId, funcao: funcaoEquipe, url },
          status: 'sucesso',
        }),
      });
    } catch {
      // Auditoria nao deve bloquear a copia.
    }
  }

  async function copiarAcesso(funcaoEquipe: 'operador' | 'checkin' | 'hospedagem' | 'checkin_hospedagem', url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setLinkCopiado(funcaoEquipe);
      scheduleClear(() => setLinkCopiado(null), 2500);
      void registrarCopiaLink(funcaoEquipe, url);
    } catch {
      mostrarErro('Nao foi possivel copiar o link.');
    }
  }

  async function reenviarAcesso(eq: Equipe) {
    setReenviandoId(eq.id);
    setErro(null);
    setSucesso(null);
    try {
      const res = await fetch(`/api/eventos/${eventoId}/equipe/acesso`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ equipe_id: eq.id }),
      });
      const json = await res.json();
      if (!res.ok) {
        mostrarErro(json.error || 'Erro ao reenviar acesso.');
        return;
      }
      mostrarSucesso((eq.tipo === 'operador' || eq.tipo === 'hospedagem')
        ? 'Acesso reenviado. A senha antiga nao foi exibida; redefina se necessario.'
        : 'Acesso sem senha reenviado por e-mail.');
    } catch {
      mostrarErro('Erro ao reenviar acesso.');
    } finally {
      setReenviandoId(null);
    }
  }

  if (evento.status === 'realizado' || evento.status === 'cancelado') {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-8 text-center max-w-md mx-auto">
        <span className="text-4xl mb-4 block">🔒</span>
        <p className="font-bold text-amber-800">Acesso encerrado</p>
        <p className="text-sm text-amber-600 mt-1">Evento finalizado. Acesso da equipe foi encerrado.</p>
      </div>
    );
  }

  async function adicionar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setSucesso(null);

    if (!nome.trim()) return mostrarErro('Nome obrigatorio.');
    if (!email.trim()) return mostrarErro('E-mail obrigatorio.');
    if (funcao === 'operador' || funcao === 'hospedagem') {
      if (senha.length < 8) return mostrarErro('Senha deve ter no minimo 8 caracteres.');
      if (senha !== confirmarSenha) return mostrarErro('As senhas nao coincidem.');
    }

    setSalvando(true);
    try {
      const res = await fetch(`/api/eventos/${eventoId}/equipe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome: nome.trim(),
          email: email.trim(),
          funcao,
          senha: funcao === 'operador' || funcao === 'hospedagem' ? senha : undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        mostrarErro((json.detail ? `${json.error}: ${json.detail}` : json.error) || 'Erro ao cadastrar membro.');
        return;
      }
      setNome('');
      setEmail('');
      setFuncao('checkin');
      setSenha('');
      setConfirmarSenha('');
      onRefresh();
      mostrarSucesso(json.email_enviado === false
        ? 'Membro cadastrado, mas o e-mail de acesso nao foi enviado.'
        : 'Membro cadastrado e e-mail de acesso enviado.');
    } catch {
      mostrarErro('Erro ao cadastrar membro.');
    } finally {
      setSalvando(false);
    }
  }

  function abrirEdicao(eq: Equipe) {
    setEditando(eq);
    setEditNome(eq.nome || '');
    setEditEmail(eq.email);
    setEditFuncao(eq.tipo);
    setEditSenha('');
    setEditConfirmarSenha('');
  }

  async function salvarEdicao(e: React.FormEvent) {
    e.preventDefault();
    if (!editando) return;
    setErro(null);
    setSucesso(null);

    if (!editNome.trim()) return mostrarErro('Nome obrigatorio.');
    if (!editEmail.trim()) return mostrarErro('E-mail obrigatorio.');

    const mudandoParaFuncaoComSenha =
      (editando.tipo !== 'operador' && editFuncao === 'operador')
      || (editando.tipo !== 'hospedagem' && editFuncao === 'hospedagem');
    if (mudandoParaFuncaoComSenha && editSenha.length < 8) {
      return mostrarErro('Defina uma senha com no minimo 8 caracteres.');
    }
    if (editSenha && editSenha.length < 8) {
      return mostrarErro('Senha deve ter no minimo 8 caracteres.');
    }
    if (editSenha && editSenha !== editConfirmarSenha) {
      return mostrarErro('As senhas nao coincidem.');
    }

    setSalvando(true);
    try {
      const res = await fetch(`/api/eventos/${eventoId}/equipe`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          equipe_id: editando.id,
          nome: editNome.trim(),
          email: editEmail.trim(),
          funcao: editFuncao,
          senha: editSenha || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        mostrarErro(json.error || 'Erro ao editar membro.');
        return;
      }
      onRefresh();
      setEditando(null);
      mostrarSucesso('Dados atualizados.');
    } catch {
      mostrarErro('Erro ao editar membro.');
    } finally {
      setSalvando(false);
    }
  }

  async function alterarStatus(eq: Equipe, ativo: boolean) {
    setAcaoId(eq.id);
    setErro(null);
    setSucesso(null);
    try {
      const res = await fetch(`/api/eventos/${eventoId}/equipe`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ equipe_id: eq.id, ativo }),
      });
      const json = await res.json();
      if (!res.ok) {
        mostrarErro(json.error || 'Erro ao atualizar status.');
        return;
      }
      onRefresh();
      mostrarSucesso(ativo ? 'Membro reativado.' : 'Membro desativado.');
    } catch {
      mostrarErro('Erro ao atualizar status.');
    } finally {
      setAcaoId(null);
    }
  }

  async function removerConfirmado() {
    if (!removerConfirm) return;
    setRemovendo(true);
    try {
      const res = await fetch(`/api/eventos/${eventoId}/equipe`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ equipe_id: removerConfirm.id }),
      });
      const json = await res.json();
      if (!res.ok) {
        mostrarErro(json.error || 'Erro ao remover membro.');
        return;
      }
      onRefresh();
      setRemoverConfirm(null);
      mostrarSucesso('Membro removido.');
    } catch {
      mostrarErro('Erro ao remover membro.');
    } finally {
      setRemovendo(false);
    }
  }

  async function redefinirSenha(e: React.FormEvent) {
    e.preventDefault();
    if (!resetando) return;
    setErro(null);
    setSucesso(null);
    if (novaSenha.length < 8) return mostrarErro('Senha deve ter no minimo 8 caracteres.');
    if (novaSenha !== confirmarNovaSenha) return mostrarErro('As senhas nao coincidem.');

    setSalvando(true);
    try {
      const res = await fetch(`/api/eventos/${eventoId}/equipe/senha`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ equipe_id: resetando.id, senha: novaSenha }),
      });
      const json = await res.json();
      if (!res.ok) {
        mostrarErro(json.error || 'Erro ao redefinir senha.');
        return;
      }
      setResetando(null);
      setNovaSenha('');
      setConfirmarNovaSenha('');
      mostrarSucesso(json.email_enviado === false
        ? 'Senha atualizada, mas o e-mail de acesso nao foi enviado.'
        : 'Senha atualizada e e-mail de acesso enviado.');
    } catch {
      mostrarErro('Erro ao redefinir senha.');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="max-w-5xl">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
        <h3 className="font-bold text-[#123b63] mb-1">Acessos da equipe</h3>
        <p className="text-xs text-gray-500 mb-4">
          Use estes links para repassar o acesso correto aos operadores e equipe de check-in.
        </p>
        <div className="grid gap-3">
          {([
            { key: 'operador' as const, titulo: 'Operador', url: operadorUrl, desc: 'Entra com e-mail e senha definidos pelo administrador.' },
            { key: 'checkin' as const, titulo: 'Check-in', url: checkinUrl, desc: 'Acessa com o e-mail cadastrado para check-in geral.' },
            { key: 'hospedagem' as const, titulo: 'Hospedagem', url: hospedagemUrl, desc: 'Entra com e-mail e senha para operar somente a area de hospedagem.' },
            { key: 'checkin_hospedagem' as const, titulo: 'Check-in de Hospedagem', url: checkinHospedagemUrl, desc: 'Acessa com e-mail cadastrado para check-in/check-out de hospedagem.' },
          ]).map(item => (
            <div key={item.key} className="rounded-xl border border-gray-200 bg-gray-50 p-4">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div>
                  <p className="text-sm font-bold text-gray-800">{item.titulo}</p>
                  <p className="text-xs text-gray-500">{item.desc}</p>
                </div>
                {linkCopiado === item.key && (
                  <span className="shrink-0 text-xs font-semibold text-emerald-700 bg-emerald-100 px-2.5 py-1 rounded-full">
                    Link copiado!
                  </span>
                )}
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  readOnly
                  value={item.url}
                  className="flex-1 min-w-0 border border-gray-200 rounded-lg px-3 py-2 text-xs text-gray-700 bg-white font-mono"
                />
                <button
                  type="button"
                  onClick={() => copiarAcesso(item.key, item.url)}
                  className="px-3 py-2 rounded-lg text-xs font-semibold bg-white border border-gray-200 text-gray-700 hover:bg-gray-100 transition"
                >
                  Copiar link
                </button>
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-2 rounded-lg text-xs font-semibold bg-[#123b63] text-white hover:bg-[#0f2a45] transition text-center"
                >
                  Abrir
                </a>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Adicionar */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
        <h3 className="font-bold text-[#123b63] mb-4">➕ Adicionar membro</h3>
        {erro && <div className="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</div>}
        {sucesso && <div className="mb-3 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">{sucesso}</div>}
        <form onSubmit={adicionar} className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelCls}>Nome</label>
            <input type="text" placeholder="Nome completo" value={nome}
              onChange={e => setNome(e.target.value)}
              className={inputCls} required />
          </div>
          <div>
            <label className={labelCls}>E-mail</label>
            <input type="email" placeholder="email@exemplo.com" value={email}
              onChange={e => setEmail(e.target.value)}
              className={inputCls} required />
          </div>
          <div>
            <label className={labelCls}>Funcao</label>
            <select value={funcao} onChange={e => setFuncao(e.target.value as 'operador' | 'checkin' | 'hospedagem' | 'checkin_hospedagem')}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white w-full">
              <option value="checkin">Check-in</option>
              <option value="checkin_hospedagem">Check-in de Hospedagem</option>
              <option value="hospedagem">Hospedagem</option>
              <option value="operador">Operador</option>
            </select>
          </div>
          {(funcao === 'operador' || funcao === 'hospedagem') && (
            <div>
              <label className={labelCls}>Senha</label>
              <input type="password" value={senha}
                onChange={e => setSenha(e.target.value)}
                className={inputCls} placeholder="Minimo 8 caracteres" required />
            </div>
          )}
          {(funcao === 'operador' || funcao === 'hospedagem') && (
            <div className="sm:col-span-2">
              <label className={labelCls}>Confirmar senha</label>
              <input type="password" value={confirmarSenha}
                onChange={e => setConfirmarSenha(e.target.value)}
                className={inputCls} placeholder="Repita a senha" required />
            </div>
          )}
          <div className="sm:col-span-2">
            <button type="submit" disabled={salvando}
              className="bg-[#123b63] text-white px-5 py-2 rounded-lg text-sm font-semibold hover:bg-[#0f2a45] transition disabled:opacity-50">
              {salvando ? 'Salvando...' : 'Adicionar membro'}
            </button>
          </div>
        </form>
        <p className="mt-3 text-xs text-gray-500">
          O e-mail de acesso e enviado automaticamente apos o cadastro. Senhas de operador/hospedagem so aparecem no momento da criacao ou redefinicao.
        </p>
      </div>

      {/* Lista */}
      {equipe.length === 0 ? (
        <EmptyState icon="👤" title="Nenhum membro cadastrado" desc="Adicione membros para o evento acima." />
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                {['Nome', 'E-mail', 'Funcao', 'Status', 'Ultimo acesso', 'Acoes'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-600">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {equipe.map(eq => (
                <tr key={eq.id} className="border-b border-gray-50 hover:bg-gray-50 transition">
                  <td className="px-4 py-3 text-gray-800">{eq.nome || '-'}</td>
                  <td className="px-4 py-3 text-gray-800">{eq.email}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${eq.tipo === 'operador' || eq.tipo === 'hospedagem' ? 'bg-[#123b63]/10 text-[#123b63]' : 'bg-gray-100 text-gray-600'}`}>
                      {eq.tipo === 'operador'
                        ? 'Operador'
                        : eq.tipo === 'hospedagem'
                          ? 'Hospedagem'
                          : eq.tipo === 'checkin_hospedagem'
                            ? 'Check-in Hospedagem'
                            : 'Check-in'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${eq.ativo ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                      {eq.ativo ? 'Ativo' : 'Inativo'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {eq.ultimo_acesso_em ? fmtDT(eq.ultimo_acesso_em) : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1 items-center">
                      <button
                        onClick={() => abrirEdicao(eq)}
                        title="Editar membro"
                        className="p-1.5 rounded-lg bg-sky-100 text-sky-700 hover:bg-sky-200 transition">
                        <Pencil size={14} />
                      </button>
                      {(eq.tipo === 'operador' || eq.tipo === 'hospedagem') && (
                        <button
                          onClick={() => { setResetando(eq); setNovaSenha(''); setConfirmarNovaSenha(''); }}
                          title="Redefinir senha"
                          className="p-1.5 rounded-lg bg-amber-100 text-amber-700 hover:bg-amber-200 transition">
                          <KeyRound size={14} />
                        </button>
                      )}
                      <button
                        onClick={() => reenviarAcesso(eq)}
                        disabled={reenviandoId === eq.id || !eq.ativo}
                        title={reenviandoId === eq.id ? 'Enviando...' : 'Reenviar acesso'}
                        className="p-1.5 rounded-lg bg-emerald-100 text-emerald-700 hover:bg-emerald-200 transition disabled:opacity-50">
                        <Mail size={14} />
                      </button>
                      <button
                        onClick={() => alterarStatus(eq, !eq.ativo)}
                        disabled={acaoId === eq.id}
                        title={eq.ativo ? 'Desativar' : 'Reativar'}
                        className="p-1.5 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 transition disabled:opacity-50">
                        {eq.ativo ? <PowerOff size={14} /> : <Power size={14} className="text-emerald-600" />}
                      </button>
                      <button
                        onClick={() => setRemoverConfirm(eq)}
                        title="Remover membro"
                        className="p-1.5 rounded-lg bg-red-100 text-red-600 hover:bg-red-200 transition">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {removerConfirm && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setRemoverConfirm(null)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="text-base font-bold text-[#123b63]">Remover membro</h3>
                <p className="text-xs text-gray-500 mt-1">Esta acao remove o acesso do membro.</p>
              </div>
              <button
                onClick={() => setRemoverConfirm(null)}
                className="text-gray-400 hover:text-gray-700 text-xl font-bold leading-none"
                aria-label="Fechar"
              >
                ×
              </button>
            </div>
            <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700">
              {removerConfirm.nome || removerConfirm.email}
            </div>
            <div className="flex gap-2 mt-5">
              <button
                onClick={() => setRemoverConfirm(null)}
                className="flex-1 px-4 py-2 text-sm rounded-lg border border-gray-300 bg-gray-50 text-gray-700 hover:bg-gray-100 transition"
              >
                Cancelar
              </button>
              <button
                onClick={removerConfirmado}
                disabled={removendo}
                className="flex-1 px-4 py-2 text-sm rounded-lg bg-red-600 text-white font-semibold hover:bg-red-700 transition disabled:opacity-50"
              >
                {removendo ? 'Removendo...' : 'Remover'}
              </button>
            </div>
          </div>
        </div>
      )}

      {editando && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setEditando(null)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="text-base font-bold text-[#123b63]">Editar membro</h3>
                <p className="text-xs text-gray-500 mt-1">Atualize os dados do membro.</p>
              </div>
              <button
                onClick={() => setEditando(null)}
                className="text-gray-400 hover:text-gray-700 text-xl font-bold leading-none"
                aria-label="Fechar"
              >
                ×
              </button>
            </div>
            <form onSubmit={salvarEdicao} className="space-y-3">
              <div>
                <label className={labelCls}>Nome</label>
                <input
                  type="text"
                  value={editNome}
                  onChange={e => setEditNome(e.target.value)}
                  className={inputCls}
                  required
                />
              </div>
              <div>
                <label className={labelCls}>E-mail</label>
                <input
                  type="email"
                  value={editEmail}
                  onChange={e => setEditEmail(e.target.value)}
                  className={inputCls}
                  required
                />
              </div>
              <div>
                <label className={labelCls}>Funcao</label>
                <select
                  value={editFuncao}
                  onChange={e => setEditFuncao(e.target.value as 'operador' | 'checkin' | 'hospedagem' | 'checkin_hospedagem')}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white w-full"
                >
                  <option value="checkin">Check-in</option>
                  <option value="checkin_hospedagem">Check-in de Hospedagem</option>
                  <option value="hospedagem">Hospedagem</option>
                  <option value="operador">Operador</option>
                </select>
              </div>
              {(editFuncao === 'operador' || editFuncao === 'hospedagem') && (
                <div>
                  <label className={labelCls}>Nova senha (opcional)</label>
                  <input
                    type="password"
                    value={editSenha}
                    onChange={e => setEditSenha(e.target.value)}
                    className={inputCls}
                    placeholder="Minimo 8 caracteres"
                  />
                </div>
              )}
              {(editFuncao === 'operador' || editFuncao === 'hospedagem') && (
                <div>
                  <label className={labelCls}>Confirmar senha</label>
                  <input
                    type="password"
                    value={editConfirmarSenha}
                    onChange={e => setEditConfirmarSenha(e.target.value)}
                    className={inputCls}
                    placeholder="Repita a senha"
                  />
                </div>
              )}
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditando(null)}
                  className="flex-1 px-4 py-2 text-sm rounded-lg border border-gray-300 bg-gray-50 text-gray-700 hover:bg-gray-100 transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={salvando}
                  className="flex-1 px-4 py-2 text-sm rounded-lg bg-[#123b63] text-white font-semibold hover:bg-[#0f2a45] transition disabled:opacity-50"
                >
                  {salvando ? 'Salvando...' : 'Salvar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {resetando && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setResetando(null)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="text-base font-bold text-[#123b63]">Redefinir senha</h3>
                <p className="text-xs text-gray-500 mt-1">Atualize a senha do membro da equipe.</p>
              </div>
              <button
                onClick={() => setResetando(null)}
                className="text-gray-400 hover:text-gray-700 text-xl font-bold leading-none"
                aria-label="Fechar"
              >
                ×
              </button>
            </div>
            <form onSubmit={redefinirSenha} className="space-y-3">
              <div>
                <label className={labelCls}>Nova senha</label>
                <input
                  type="password"
                  value={novaSenha}
                  onChange={e => setNovaSenha(e.target.value)}
                  className={inputCls}
                  placeholder="Minimo 8 caracteres"
                  required
                />
              </div>
              <div>
                <label className={labelCls}>Confirmar senha</label>
                <input
                  type="password"
                  value={confirmarNovaSenha}
                  onChange={e => setConfirmarNovaSenha(e.target.value)}
                  className={inputCls}
                  placeholder="Repita a senha"
                  required
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setResetando(null)}
                  className="flex-1 px-4 py-2 text-sm rounded-lg border border-gray-300 bg-gray-50 text-gray-700 hover:bg-gray-100 transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={salvando}
                  className="flex-1 px-4 py-2 text-sm rounded-lg bg-[#123b63] text-white font-semibold hover:bg-[#0f2a45] transition disabled:opacity-50"
                >
                  {salvando ? 'Salvando...' : 'Atualizar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// ABA CONFIGURAÇÕES
// ═══════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════
// ABA COMUNICAÇÃO
// ═══════════════════════════════════════════════════════════════
type Notificacao = {
  id: string;
  tipo: 'email' | 'whatsapp';
  status: 'pendente' | 'enviado' | 'erro';
  gatilho: string;
  assunto: string | null;
  mensagem: string;
  erro: string | null;
  enviado_em: string | null;
  created_at: string;
  inscricao_id: string;
  evento_inscricoes: { nome_inscrito: string; email: string | null; whatsapp: string | null };
};

const GATILHO_LABEL: Record<string, string> = {
  inscricao_criada:     '📋 Inscrição criada',
  pagamento_confirmado: '💳 Pagamento confirmado',
  checkin_realizado:    '✅ Check-in realizado',
  manual:               '✍️ Manual',
};

const STATUS_NOTIF_CFG = {
  pendente: { label: 'Pendente', cls: 'bg-yellow-100 text-yellow-700' },
  enviado:  { label: 'Enviado',  cls: 'bg-green-100  text-green-700'  },
  erro:     { label: 'Erro',     cls: 'bg-red-100    text-red-700'    },
};

function TabComunicacao({ eventoId, supabase }: { eventoId: string; supabase: ReturnType<typeof createClient> }) {
  const [notifs,       setNotifs]       = useState<Notificacao[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [filtroStatus, setFiltroStatus] = useState('');
  const [filtroTipo,   setFiltroTipo]   = useState('');
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [enviando,     setEnviando]     = useState<string | null>(null);
  const [enviandoLote, setEnviandoLote] = useState(false);
  const [preview,      setPreview]      = useState<Notificacao | null>(null);
  const [total,        setTotal]        = useState(0);
  const [page,         setPage]         = useState(1);
  const [loteResult,   setLoteResult]   = useState<{ enviados: number; erros: number } | null>(null);

  // Busca por inscrito
  const [buscaInscrito,   setBuscaInscrito]   = useState('');
  const [buscandoInscrito, setBuscandoInscrito] = useState(false);
  const [resultadosBusca,  setResultadosBusca]  = useState<{ id: string; nome_inscrito: string; cpf: string | null; email: string | null; whatsapp: string | null; status_pagamento: string }[]>([]);
  const [reenvioMsg,       setReenvioMsg]       = useState<string | null>(null);

  async function buscarInscrito() {
    if (!buscaInscrito.trim()) return;
    setBuscandoInscrito(true);
    setResultadosBusca([]);
    setReenvioMsg(null);
    const { data } = await supabase
      .from('evento_inscricoes')
      .select('id,nome_inscrito,cpf,email,whatsapp,status_pagamento')
      .eq('evento_id', eventoId)
      .or(`nome_inscrito.ilike.%${buscaInscrito}%,cpf.ilike.%${buscaInscrito}%,email.ilike.%${buscaInscrito}%,whatsapp.ilike.%${buscaInscrito}%`)
      .limit(10);
    setResultadosBusca((data ?? []) as typeof resultadosBusca);
    setBuscandoInscrito(false);
  }

  async function reenviarConfirmacao(ins: typeof resultadosBusca[number]) {
    setReenvioMsg(null);
    const res = await fetch(`/api/eventos/${eventoId}/notificacoes/reenviar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inscricao_id: ins.id }),
    });
    if (res.ok) {
      setReenvioMsg(`✅ Confirmação reenviada para ${ins.nome_inscrito}`);
    } else {
      setReenvioMsg(`❌ Erro ao reenviar para ${ins.nome_inscrito}`);
    }
  }

  const fetchNotifs = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), per_page: '50' });
    if (filtroStatus) params.set('status', filtroStatus);
    if (filtroTipo)   params.set('tipo',   filtroTipo);
    const res  = await fetch(`/api/eventos/${eventoId}/notificacoes?${params}`);
    const json = await res.json();
    setNotifs(json.notificacoes ?? []);
    setTotal(json.total ?? 0);
    setLoading(false);
  }, [eventoId, filtroStatus, filtroTipo, page]);

  useEffect(() => { fetchNotifs(); }, [fetchNotifs]);

  async function enviarUm(id: string) {
    setEnviando(id);
    try {
      await fetch(`/api/eventos/${eventoId}/notificacoes/${id}/enviar`, { method: 'POST' });
      await fetchNotifs();
    } finally {
      setEnviando(null);
    }
  }

  async function enviarLote() {
    if (selecionados.size === 0) return;
    setEnviandoLote(true);
    setLoteResult(null);
    const res  = await fetch(`/api/eventos/${eventoId}/notificacoes/enviar-lote`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ ids: [...selecionados] }),
    });
    const json = await res.json();
    setLoteResult({ enviados: json.enviados ?? 0, erros: json.erros ?? 0 });
    setSelecionados(new Set());
    await fetchNotifs();
    setEnviandoLote(false);
  }

  const toggleSelect = (id: string) =>
    setSelecionados(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () =>
    setSelecionados(s => s.size === notifs.length ? new Set() : new Set(notifs.map(n => n.id)));

  const statsCounts = useMemo(() => ({
    total:    total,
    pendente: notifs.filter(n => n.status === 'pendente').length,
    enviado:  notifs.filter(n => n.status === 'enviado').length,
    erro:     notifs.filter(n => n.status === 'erro').length,
  }), [notifs, total]);

  return (
    <div className="space-y-5">
      {/* Busca por inscrito */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <h3 className="font-bold text-[#123b63] mb-3">🔍 Reenviar confirmação por inscrito</h3>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Nome, CPF, e-mail ou WhatsApp..."
            value={buscaInscrito}
            onChange={e => setBuscaInscrito(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && buscarInscrito()}
            className={inputCls + ' flex-1'}
          />
          <button
            onClick={buscarInscrito}
            disabled={buscandoInscrito}
            className="px-4 py-2 text-sm font-semibold bg-[#123b63] text-white rounded-lg hover:bg-[#0f2a45] transition disabled:opacity-50">
            {buscandoInscrito ? '⏳' : 'Buscar'}
          </button>
        </div>
        {reenvioMsg && (
          <p className={`mt-2 text-sm font-semibold ${reenvioMsg.startsWith('✅') ? 'text-emerald-700' : 'text-red-600'}`}>{reenvioMsg}</p>
        )}
        {resultadosBusca.length > 0 && (
          <div className="mt-3 space-y-2">
            {resultadosBusca.map(ins => (
              <div key={ins.id} className="flex items-center justify-between gap-3 border border-gray-100 rounded-lg px-4 py-2">
                <div>
                  <p className="text-sm font-medium text-gray-800">{ins.nome_inscrito}</p>
                  <p className="text-xs text-gray-500">{ins.cpf ?? ''} {ins.email ?? ''} {ins.whatsapp ?? ''}</p>
                </div>
                <button
                  onClick={() => reenviarConfirmacao(ins)}
                  className="text-xs px-3 py-1.5 bg-emerald-100 text-emerald-700 rounded font-semibold hover:bg-emerald-200 transition">
                  📤 Reenviar
                </button>
              </div>
            ))}
          </div>
        )}
        {!buscandoInscrito && buscaInscrito.trim() && resultadosBusca.length === 0 && (
          <p className="mt-2 text-sm text-gray-500">Nenhum inscrito encontrado.</p>
        )}
      </div>

      {/* Header com stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Total',    value: statsCounts.total,    color: 'text-[#123b63]' },
          { label: 'Enviados', value: statsCounts.enviado,  color: 'text-emerald-600' },
          { label: 'Pendentes',value: statsCounts.pendente, color: 'text-yellow-600' },
          { label: 'Erros',    value: statsCounts.erro,     color: 'text-red-600' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 text-center">
            <p className="text-xs text-gray-400 mb-1">{s.label}</p>
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Aviso simulação */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-3 flex items-start gap-3">
        <span className="text-lg mt-0.5">⚠️</span>
        <div>
          <p className="text-sm font-semibold text-amber-800">Modo simulação ativo</p>
          <p className="text-xs text-amber-700 mt-0.5">E-mails e WhatsApp não são enviados de verdade ainda. Configure <code className="bg-amber-100 px-1 rounded">SIMULATE_EMAIL=false</code> e <code className="bg-amber-100 px-1 rounded">SIMULATE_WHATSAPP=false</code> nos services quando pronto.</p>
        </div>
      </div>

      {/* Filtros + ações em lote */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className={labelCls}>Status</label>
            <select className={inputCls + ' w-36'} value={filtroStatus} onChange={e => { setFiltroStatus(e.target.value); setPage(1); }}>
              <option value="">Todos</option>
              <option value="pendente">Pendente</option>
              <option value="enviado">Enviado</option>
              <option value="erro">Erro</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>Tipo</label>
            <select className={inputCls + ' w-36'} value={filtroTipo} onChange={e => { setFiltroTipo(e.target.value); setPage(1); }}>
              <option value="">Todos</option>
              <option value="email">E-mail</option>
              <option value="whatsapp">WhatsApp</option>
            </select>
          </div>
          <button onClick={fetchNotifs} className="px-4 py-2 text-xs font-semibold bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition">
            🔄 Atualizar
          </button>
          {selecionados.size > 0 && (
            <button
              onClick={enviarLote}
              disabled={enviandoLote}
              className="ml-auto px-4 py-2 text-xs font-semibold bg-[#123b63] text-white rounded-lg hover:bg-[#0f2a45] transition disabled:opacity-50">
              {enviandoLote ? '⏳ Enviando…' : `📤 Enviar selecionados (${selecionados.size})`}
            </button>
          )}
        </div>

        {loteResult && (
          <div className={`mt-3 px-4 py-2 rounded-lg text-sm font-semibold ${loteResult.erros > 0 ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-800'}`}>
            {loteResult.enviados} enviados · {loteResult.erros} erros
          </div>
        )}
      </div>

      {/* Lista */}
      {loading ? (
        <LoadingSkeleton />
      ) : notifs.length === 0 ? (
        <EmptyState icon="📭" title="Nenhuma notificação" desc="As notificações são criadas automaticamente quando inscrições são realizadas." />
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          {/* Thead */}
          <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-3 bg-gray-50">
            <input type="checkbox" checked={selecionados.size === notifs.length && notifs.length > 0}
              onChange={toggleAll} className="w-4 h-4 accent-[#123b63]" />
            <span className="text-xs font-semibold text-gray-500 flex-1">Destinatário / Gatilho</span>
            <span className="text-xs font-semibold text-gray-500 w-24 text-center">Tipo</span>
            <span className="text-xs font-semibold text-gray-500 w-24 text-center">Status</span>
            <span className="text-xs font-semibold text-gray-500 w-32 text-right">Ações</span>
          </div>

          {notifs.map(n => {
            const stCfg = STATUS_NOTIF_CFG[n.status] ?? STATUS_NOTIF_CFG.pendente;
            return (
              <div key={n.id} className="flex items-center gap-3 px-4 py-3 border-b border-gray-50 hover:bg-gray-50/50 transition last:border-0">
                <input type="checkbox" checked={selecionados.has(n.id)} onChange={() => toggleSelect(n.id)}
                  className="w-4 h-4 accent-[#123b63] flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">{n.evento_inscricoes.nome_inscrito}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{GATILHO_LABEL[n.gatilho] ?? n.gatilho}</p>
                  {n.assunto && <p className="text-xs text-gray-500 italic truncate mt-0.5">{n.assunto}</p>}
                  {n.erro && <p className="text-xs text-red-500 mt-0.5 truncate">⚠️ {n.erro}</p>}
                  {n.enviado_em && <p className="text-xs text-emerald-600 mt-0.5">✅ {fmtDT(n.enviado_em)}</p>}
                </div>
                <div className="w-24 text-center flex-shrink-0">
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${n.tipo === 'email' ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'}`}>
                    {n.tipo === 'email' ? '✉️ E-mail' : '💬 WA'}
                  </span>
                </div>
                <div className="w-24 text-center flex-shrink-0">
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${stCfg.cls}`}>{stCfg.label}</span>
                </div>
                <div className="w-32 flex justify-end gap-1.5 flex-shrink-0">
                  <button onClick={() => setPreview(n)}
                    className="text-xs px-2.5 py-1 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 transition">
                    👁️
                  </button>
                  <button
                    onClick={() => enviarUm(n.id)}
                    disabled={enviando === n.id}
                    className="text-xs px-2.5 py-1 rounded-lg bg-[#123b63] text-white hover:bg-[#0f2a45] transition disabled:opacity-50">
                    {enviando === n.id ? '⏳' : '📤'}
                  </button>
                </div>
              </div>
            );
          })}

          {/* Paginação */}
          {total > 50 && (
            <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between">
              <p className="text-xs text-gray-400">{total} notificações no total</p>
              <div className="flex gap-2">
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                  className="text-xs px-3 py-1 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-40 transition">← Anterior</button>
                <span className="text-xs text-gray-500 self-center">Página {page}</span>
                <button onClick={() => setPage(p => p + 1)} disabled={notifs.length < 50}
                  className="text-xs px-3 py-1 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-40 transition">Próxima →</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modal preview da mensagem */}
      {preview && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setPreview(null)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="font-bold text-[#123b63] text-base">👁️ Visualizar mensagem</h3>
                <p className="text-xs text-gray-500 mt-0.5">{preview.evento_inscricoes.nome_inscrito} · {GATILHO_LABEL[preview.gatilho]}</p>
              </div>
              <button onClick={() => setPreview(null)} className="text-gray-400 hover:text-gray-700 text-xl font-bold leading-none">×</button>
            </div>
            {preview.assunto && (
              <div className="bg-gray-50 rounded-lg px-4 py-2 mb-3">
                <p className="text-xs text-gray-400 mb-0.5 font-semibold">ASSUNTO</p>
                <p className="text-sm font-semibold text-gray-800">{preview.assunto}</p>
              </div>
            )}
            <div className="bg-[#0D2B4E]/5 rounded-xl p-4">
              <p className="text-xs text-gray-400 mb-2 font-semibold">MENSAGEM</p>
              <pre className="text-sm text-gray-700 whitespace-pre-wrap font-sans leading-relaxed">{preview.mensagem}</pre>
            </div>
            <div className="flex justify-between items-center mt-4">
              <p className="text-xs text-gray-400">Criado em {fmtDT(preview.created_at)}</p>
              <button
                onClick={() => { setPreview(null); enviarUm(preview.id); }}
                className="text-xs px-4 py-2 rounded-lg bg-[#123b63] text-white hover:bg-[#0f2a45] transition">
                📤 Enviar agora
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// ABA CONFIGURAÇÕES
// ═══════════════════════════════════════════════════════════════
function TabConfiguracoes({ evento, nomeSup, nomeCampo, podeEditar }: {
  evento: Evento;
  nomeSup: (id: string | null) => string;
  nomeCampo: (id: string | null) => string;
  podeEditar: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();

  // ── Cupons ───────────────────────────────────────────────
  const [cupons,        setCupons]        = useState<Array<{id:string;codigo:string;tipo:string;valor:number;limite_uso:number|null;usados:number;ativo:boolean;validade:string|null}>>([]);
  const [addCupom,      setAddCupom]      = useState({ codigo:'', tipo:'percentual', valor:'', limite_uso:'', validade:'' });
  const [addCupErro,    setAddCupErro]    = useState('');
  const [salvandoCup,   setSalvandoCup]   = useState(false);

  // ── Tipos de inscrição ────────────────────────────────────
  const [usarTipos,     setUsarTipos]     = useState(evento.usar_tipos_inscricao);
  const [salvandoFlag,  setSalvandoFlag]  = useState(false);
  const [tipos,         setTipos]         = useState<Array<{id?:string;nome:string;valor:string;inclui_alimentacao:boolean;inclui_hospedagem:boolean;ativo:boolean;ordem:number}>>([]);
  const [salvandoTipos, setSalvandoTipos] = useState(false);
  const [tiposMsg,      setTiposMsg]      = useState('');

  // ── Alojamentos AGO ───────────────────────────────────────────
  type AlojCfg = { id: string; nome: string; publico: string; total_vagas: number; camas_inferiores: number; camas_superiores: number; ativo: boolean; vagas_livres?: number };
  const [alojamentos, setAlojamentos] = useState<AlojCfg[]>([]);

  // ── Página pública ─────────────────────────────────────────────
  const [copiado, setCopiado] = useState(false);
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const urlPublica = origin ? `${origin}/inscricao/${evento.slug}` : `/inscricao/${evento.slug}`;
  const editarHref = `/eventos/${evento.id}/editar`;
  const handleEditar = () => router.push(editarHref);

  useEffect(() => {
    fetch(`/api/eventos/${evento.id}/cupons`)
      .then(r => r.json())
      .then(j => setCupons(j.cupons ?? []))
      .catch(() => {});

    fetch(`/api/eventos/${evento.id}/tipos-inscricao`)
      .then(r => r.json())
      .then(j => {
        const t = (j.tipos ?? []) as Array<{id?:string;nome:string;valor:number;inclui_alimentacao:boolean;inclui_hospedagem:boolean;ativo:boolean;ordem:number}>;
        if (t.length > 0) {
          setTipos(t.map((x, i) => ({
            ...x,
            valor: String(x.valor ?? ''),
            ativo: x.ativo ?? true,
            inclui_alimentacao: !!x.inclui_alimentacao,
            inclui_hospedagem: !!x.inclui_hospedagem,
            ordem: x.ordem ?? (i + 1),
          })));
        } else {
          setTipos([
            { nome: 'Plenárias',                              valor: '', inclui_alimentacao: false, inclui_hospedagem: false, ativo: true, ordem: 1 },
            { nome: 'Plenárias + Alimentação',                valor: '', inclui_alimentacao: true,  inclui_hospedagem: false, ativo: true, ordem: 2 },
            { nome: 'Plenárias + Alimentação + Hospedagem',   valor: '', inclui_alimentacao: true,  inclui_hospedagem: true,  ativo: true, ordem: 3 },
          ]);
        }
      }).catch(() => {});

    if (evento.departamento === 'AGO' && evento.permite_hospedagem) {
      fetch(`/api/eventos/${evento.id}/alojamentos`)
        .then(r => r.json())
        .then(j => setAlojamentos(j.alojamentos ?? []))
        .catch(() => {});
    }
  }, [evento.id, evento.departamento, evento.permite_hospedagem]);

  async function salvarTipos() {
    setSalvandoTipos(true); setTiposMsg('');
    const payload = tipos.map(t => ({ ...t, valor: parseFloat(t.valor) || 0 }));
    const res = await fetch(`/api/eventos/${evento.id}/tipos-inscricao`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tipos: payload }),
    });
    setSalvandoTipos(false);
    setTiposMsg(res.ok ? '✅ Tipos de inscrição salvos!' : '❌ Erro ao salvar.');
    setTimeout(() => setTiposMsg(''), 3000);
  }

  async function toggleUsarTipos(novoValor: boolean) {
    setSalvandoFlag(true);
    setUsarTipos(novoValor);
    await supabase.from('eventos').update({ usar_tipos_inscricao: novoValor }).eq('id', evento.id);
    setSalvandoFlag(false);
  }

  async function criarCupom() {
    setAddCupErro(''); setSalvandoCup(true);
    const res = await fetch(`/api/eventos/${evento.id}/cupons`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        codigo:    addCupom.codigo,
        tipo:      addCupom.tipo,
        valor:     parseFloat(addCupom.valor) || 0,
        limite_uso: addCupom.limite_uso ? parseInt(addCupom.limite_uso) : null,
        validade:  addCupom.validade || null,
        ativo:     true,
      }),
    });
    const j = await res.json();
    setSalvandoCup(false);
    if (!res.ok) { setAddCupErro(j.error || 'Erro ao criar cupom.'); return; }
    setAddCupom({ codigo:'', tipo:'percentual', valor:'', limite_uso:'', validade:'' });
    fetch(`/api/eventos/${evento.id}/cupons`).then(r => r.json()).then(j2 => setCupons(j2.cupons ?? []));
  }

  async function toggleCupom(id: string, ativo: boolean) {
    await fetch(`/api/eventos/${evento.id}/cupons`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ativo }),
    });
    setCupons(c => c.map(x => x.id === id ? { ...x, ativo } : x));
  }

  function copiarLink() {
    navigator.clipboard.writeText(urlPublica).then(() => {
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    });
  }

  const STATUS_EV_LABEL: Record<string, string> = {
    programado: '🔵 Programado', realizado: '✅ Realizado', cancelado: '🔴 Cancelado',
  };
  const PUBLICO_LABEL: Record<string, string> = {
    feminino: '👩 Feminino', masculino_geral: '👨 Masculino (Geral)',
    presidentes: '👨 Presidentes', jubilados: '👨 Jubilados', misto: '👥 Misto',
  };
  const card = 'bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden';
  const hd   = 'px-6 py-4 border-b border-gray-100 flex items-center justify-between';
  const hdT  = 'font-bold text-[#123b63] text-sm';

  return (
    <div className="max-w-4xl space-y-6">

      {/* ══ 1. DADOS DO EVENTO ══════════════════════════════════════ */}
      <div className={card}>
        <div className={hd}>
          <h3 className={hdT}>📋 Dados do Evento</h3>
          {podeEditar && (
            <button type="button" onClick={handleEditar}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-gray-100 text-gray-700 hover:bg-gray-200 transition">
              ✏️ Editar
            </button>
          )}
        </div>
        <div className="p-6">
          {evento.banner_url && (
            <div className="mb-5 rounded-lg overflow-hidden border border-gray-100 h-36 bg-gray-50">
              <img src={evento.banner_url} alt={evento.nome} className="w-full h-full object-cover" />
            </div>
          )}
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-10 gap-y-4">
            {([
              ['Nome',         evento.nome],
              ['Departamento', evento.departamento],
              ['Status',       STATUS_EV_LABEL[evento.status] ?? evento.status],
              ['Inscrições',   evento.inscricoes_abertas ? '🟢 Abertas' : '🔴 Fechadas'],
              ['Data início',  fmtData(evento.data_inicio)],
              ['Data fim',     fmtData(evento.data_fim)],
              ['Local',        [evento.local, evento.cidade].filter(Boolean).join(' — ') || '—'],
              ['Supervisão',   nomeSup(evento.supervisao_id)],
              ['Campo',        nomeCampo(evento.campo_id)],
              ['Público-alvo', evento.publico_alvo || '—'],
            ] as [string,string][]).map(([label, val]) => (
              <div key={label}>
                <dt className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">{label}</dt>
                <dd className="text-sm text-gray-900 mt-0.5">{val}</dd>
              </div>
            ))}
          </dl>
          {evento.descricao && (
            <div className="mt-5 pt-4 border-t border-gray-100">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Descrição</p>
              <p className="text-sm text-gray-700 leading-relaxed">{evento.descricao}</p>
            </div>
          )}
        </div>
      </div>

      {/* ══ 2. INSCRIÇÕES E VALORES ═════════════════════════════════ */}
      <div className={card}>
        <div className={hd}>
          <h3 className={hdT}>🎟️ Inscrições e Valores</h3>
          {podeEditar && (
            <button type="button" onClick={handleEditar}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-gray-100 text-gray-700 hover:bg-gray-200 transition">
              ✏️ Editar limites
            </button>
          )}
        </div>
        <div className="p-6 space-y-5">

          {/* Toggle: valor único ou tipos de inscrição */}
          <div className="flex items-center justify-between gap-4 bg-gray-50 rounded-xl px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-gray-800">
                {usarTipos ? '🎫 Usando tipos de inscrição' : '💵 Valor único de inscrição'}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">
                {usarTipos
                  ? 'Inscritos escolhem o tipo (Plenárias, Alimentação, Hospedagem).'
                  : 'Todos os inscritos pagam o mesmo valor base.'}
              </p>
            </div>
            {podeEditar && (
              <button
                onClick={() => toggleUsarTipos(!usarTipos)}
                disabled={salvandoFlag}
                className={`shrink-0 px-4 py-2 rounded-lg text-xs font-semibold transition ${usarTipos ? 'bg-[#123b63] text-white hover:bg-[#0f2a45]' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'} disabled:opacity-50`}
              >
                {salvandoFlag ? '...' : usarTipos ? '✓ Ativo' : 'Ativar tipos'}
              </button>
            )}
          </div>

          {/* Valor base (apenas quando NÃO usa tipos) */}
          {!usarTipos && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {([
                { label: 'Valor da inscrição', value: fmtMoeda(evento.valor_inscricao) },
                { label: 'Limite de vagas',    value: evento.limite_vagas ? String(evento.limite_vagas) : 'Ilimitado' },
                { label: 'Limite hospedagem',  value: evento.limite_hospedagem ? String(evento.limite_hospedagem) : 'Ilimitado' },
                { label: 'Limite brindes',     value: evento.limite_brindes ? String(evento.limite_brindes) : 'Ilimitado' },
              ] as {label:string;value:string}[]).map(item => (
                <div key={item.label} className="bg-gray-50 rounded-lg p-3">
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">{item.label}</p>
                  <p className="text-sm font-bold text-gray-900 mt-0.5">{item.value}</p>
                </div>
              ))}
            </div>
          )}

          {/* Limites (apenas quando usa tipos) */}
          {usarTipos && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {([
                { label: 'Limite de vagas',   value: evento.limite_vagas ? String(evento.limite_vagas) : 'Ilimitado' },
                { label: 'Limite hospedagem', value: evento.limite_hospedagem ? String(evento.limite_hospedagem) : 'Ilimitado' },
                { label: 'Limite brindes',    value: evento.limite_brindes ? String(evento.limite_brindes) : 'Ilimitado' },
              ] as {label:string;value:string}[]).map(item => (
                <div key={item.label} className="bg-gray-50 rounded-lg p-3">
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">{item.label}</p>
                  <p className="text-sm font-bold text-gray-900 mt-0.5">{item.value}</p>
                </div>
              ))}
            </div>
          )}

          {/* Serviços */}
          <div>
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2">Serviços incluídos</p>
            <div className="flex flex-wrap gap-2">
              {([
                { label: '🏨 Hospedagem',  ok: evento.permite_hospedagem },
                { label: '🍽️ Alimentação', ok: evento.permite_alimentacao },
                { label: '🎁 Brinde',      ok: evento.permite_brinde },
                { label: '🎓 Certificado', ok: evento.gerar_certificado },
              ] as {label:string;ok:boolean}[]).map(s => (
                <span key={s.label}
                  className={`text-xs font-semibold px-3 py-1 rounded-full ${s.ok ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-400'}`}>
                  {s.ok ? s.label : `${s.label} (desativado)`}
                </span>
              ))}
            </div>
          </div>

          {/* Editor de tipos de inscrição */}
          {usarTipos && (
            <div>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-3">Tipos de inscrição</p>
              <div className="space-y-2">
                {tipos.map((t, i) => (
                  <div key={i}
                    className={`border rounded-xl p-3 transition ${t.ativo ? 'border-gray-200 bg-white' : 'border-gray-100 bg-gray-50 opacity-60'}`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      {/* Ativo */}
                      <label className="flex items-center gap-1 cursor-pointer shrink-0">
                        <input type="checkbox" checked={!!t.ativo}
                          onChange={e => setTipos(prev => prev.map((x, j) => j===i ? {...x, ativo: e.target.checked} : x))}
                          className="accent-[#123b63]" disabled={!podeEditar} />
                        <span className="text-xs font-semibold text-gray-600">Ativo</span>
                      </label>
                      {/* Nome */}
                      <input value={t.nome}
                        onChange={e => setTipos(prev => prev.map((x, j) => j===i ? {...x, nome: e.target.value} : x))}
                        className="flex-1 min-w-[160px] border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
                        placeholder="Nome" disabled={!podeEditar || !t.ativo} />
                      {/* Valor */}
                      <div className="flex items-center gap-1 w-28">
                        <span className="text-xs text-gray-400 shrink-0">R$</span>
                        <input type="number" min="0" step="0.01" value={t.valor}
                          onChange={e => setTipos(prev => prev.map((x, j) => j===i ? {...x, valor: e.target.value} : x))}
                          className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
                          placeholder="0.00" disabled={!podeEditar || !t.ativo} />
                      </div>
                      {/* Inclui Alimentação */}
                      <label className="flex items-center gap-1 cursor-pointer shrink-0">
                        <input type="checkbox" checked={!!t.inclui_alimentacao}
                          onChange={e => setTipos(prev => prev.map((x, j) => j===i ? {...x, inclui_alimentacao: e.target.checked} : x))}
                          className="accent-[#123b63]" disabled={!podeEditar || !t.ativo} />
                        <span className="text-xs text-gray-600">🍽️ Aliment.</span>
                      </label>
                      {/* Inclui Hospedagem */}
                      <label className="flex items-center gap-1 cursor-pointer shrink-0">
                        <input type="checkbox" checked={!!t.inclui_hospedagem}
                          onChange={e => setTipos(prev => prev.map((x, j) => j===i ? {...x, inclui_hospedagem: e.target.checked} : x))}
                          className="accent-[#123b63]" disabled={!podeEditar || !t.ativo} />
                        <span className="text-xs text-gray-600">🏨 Hosp.</span>
                      </label>
                    </div>
                  </div>
                ))}
              </div>
              {podeEditar && (
                <div className="flex items-center gap-3 pt-3">
                  <button onClick={salvarTipos} disabled={salvandoTipos}
                    className="px-4 py-2 bg-[#123b63] text-white text-sm font-semibold rounded-lg hover:bg-[#0f2a45] disabled:opacity-50 transition">
                    {salvandoTipos ? 'Salvando...' : '💾 Salvar Tipos'}
                  </button>
                  {tiposMsg && <span className="text-sm font-medium">{tiposMsg}</span>}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ══ 3. COMUNICAÇÃO ══════════════════════════════════════════ */}
      <div className={card}>
        <div className={hd}>
          <h3 className={hdT}>📣 Comunicação</h3>
          {podeEditar && (
            <button type="button" onClick={handleEditar}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-gray-100 text-gray-700 hover:bg-gray-200 transition">
              ✏️ Editar
            </button>
          )}
        </div>
        <div className="p-6 space-y-5">
          <div>
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Link do grupo WhatsApp</p>
            {evento.link_whatsapp ? (
              <div className="flex items-center gap-2 flex-wrap">
                <a href={evento.link_whatsapp} target="_blank" rel="noopener noreferrer"
                  className="text-sm text-[#123b63] underline break-all flex-1 min-w-0 truncate">{evento.link_whatsapp}</a>
                <button onClick={() => navigator.clipboard.writeText(evento.link_whatsapp!)}
                  className="flex-shrink-0 text-xs px-2.5 py-1 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 transition">
                  📋 Copiar
                </button>
              </div>
            ) : (
              <p className="text-sm text-gray-400 italic">Não configurado
                {podeEditar && <button type="button" onClick={handleEditar} className="ml-2 text-[#123b63] underline">→ Editar</button>}
              </p>
            )}
          </div>
          <div>
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Mensagem de confirmação</p>
            {evento.mensagem_confirmacao ? (
              <pre className="text-sm text-gray-700 bg-gray-50 rounded-lg p-4 whitespace-pre-wrap font-sans leading-relaxed border border-gray-200 max-h-40 overflow-y-auto">
                {evento.mensagem_confirmacao}
              </pre>
            ) : (
              <p className="text-sm text-gray-400 italic">Não configurada
                {podeEditar && <button type="button" onClick={handleEditar} className="ml-2 text-[#123b63] underline">→ Editar</button>}
              </p>
            )}
          </div>
          <div className="bg-gray-50 rounded-lg px-4 py-3 flex items-center justify-between">
            <p className="text-xs text-gray-600">Histórico de notificações enviadas (e-mail / WhatsApp)</p>
            <span className="text-xs text-gray-400 font-semibold">Aba 📣 Comunicação</span>
          </div>
        </div>
      </div>

      {/* ══ 4. CUPONS DE DESCONTO ════════════════════════════════════ */}
      <div className={card}>
        <div className={hd}>
          <h3 className={hdT}>🏷️ Cupons de Desconto</h3>
          <span className="text-xs text-gray-400">{cupons.filter(c => c.ativo).length} ativo(s)</span>
        </div>
        <div className="p-6">
          {cupons.length === 0 ? (
            <p className="text-sm text-gray-400 mb-4">Nenhum cupom criado ainda.</p>
          ) : (
            <div className="mb-5 overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-500 border-b border-gray-100">
                    <th className="text-left pb-2 font-semibold">Código</th>
                    <th className="text-left pb-2 font-semibold">Tipo</th>
                    <th className="text-right pb-2 font-semibold">Valor</th>
                    <th className="text-right pb-2 font-semibold">Usados</th>
                    <th className="text-left pb-2 font-semibold">Validade</th>
                    <th className="text-center pb-2 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {cupons.map(c => (
                    <tr key={c.id}>
                      <td className="py-2 font-mono font-bold text-[#123b63]">{c.codigo}</td>
                      <td className="py-2">{c.tipo === 'percentual' ? '%' : 'R$'}</td>
                      <td className="py-2 text-right">{c.tipo === 'percentual' ? `${c.valor}%` : fmtMoeda(c.valor)}</td>
                      <td className="py-2 text-right">{c.usados}{c.limite_uso ? `/${c.limite_uso}` : ''}</td>
                      <td className="py-2">{c.validade ? c.validade.slice(0,10).split('-').reverse().join('/') : '—'}</td>
                      <td className="py-2 text-center">
                        {podeEditar ? (
                          <button onClick={() => toggleCupom(c.id, !c.ativo)}
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-full transition ${c.ativo ? 'bg-emerald-100 text-emerald-700 hover:bg-red-100 hover:text-red-700' : 'bg-gray-100 text-gray-500 hover:bg-emerald-100 hover:text-emerald-700'}`}>
                            {c.ativo ? 'Ativo' : 'Inativo'}
                          </button>
                        ) : (
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${c.ativo ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                            {c.ativo ? 'Ativo' : 'Inativo'}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {podeEditar && (
            <div className={cupons.length > 0 ? 'border-t border-gray-100 pt-4' : ''}>
              <p className="text-sm font-semibold text-gray-700 mb-3">Criar novo cupom</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-2">
                <input value={addCupom.codigo} onChange={e => setAddCupom(x => ({...x, codigo: e.target.value.toUpperCase()}))}
                  placeholder="CODIGO" className="border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono uppercase" />
                <select value={addCupom.tipo} onChange={e => setAddCupom(x => ({...x, tipo: e.target.value}))}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm">
                  <option value="percentual">% Percentual</option>
                  <option value="valor_fixo">R$ Valor Fixo</option>
                </select>
                <input type="number" min="0" step="0.01" value={addCupom.valor}
                  onChange={e => setAddCupom(x => ({...x, valor: e.target.value}))}
                  placeholder={addCupom.tipo === 'percentual' ? 'Ex: 10 (%)' : 'Ex: 20.00'}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                <input type="number" min="1" step="1" value={addCupom.limite_uso}
                  onChange={e => setAddCupom(x => ({...x, limite_uso: e.target.value}))}
                  placeholder="Limite de usos (opcional)"
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                <input type="date" value={addCupom.validade}
                  onChange={e => setAddCupom(x => ({...x, validade: e.target.value}))}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              {addCupErro && <p className="text-red-600 text-xs mb-2">{addCupErro}</p>}
              <button onClick={criarCupom} disabled={salvandoCup || !addCupom.codigo || !addCupom.valor}
                className="px-4 py-2 bg-[#F39C12] text-white text-sm font-semibold rounded-lg hover:bg-[#d68910] disabled:opacity-50 transition">
                {salvandoCup ? 'Criando...' : '➕ Criar Cupom'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ══ 5. HOSPEDAGEM AGO (condicional) ════════════════════════ */}
      {evento.departamento === 'AGO' && evento.permite_hospedagem && (
        <div className={card}>
          <div className={hd}>
            <h3 className={hdT}>🏨 Hospedagem AGO — Alojamentos</h3>
            <span className="text-xs text-gray-400">{alojamentos.filter(a => a.ativo).length} ativo(s)</span>
          </div>
          {alojamentos.length === 0 ? (
            <div className="p-6">
              <p className="text-sm text-gray-400">Nenhum alojamento cadastrado. Use a aba <span className="font-semibold">🏨 Hospedagem</span> para criar.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="text-left px-5 py-2.5 font-semibold text-gray-500">Alojamento</th>
                    <th className="text-left px-4 py-2.5 font-semibold text-gray-500">Público</th>
                    <th className="text-right px-4 py-2.5 font-semibold text-gray-500">Vagas</th>
                    <th className="text-right px-4 py-2.5 font-semibold text-gray-500">⬇ Inf.</th>
                    <th className="text-right px-4 py-2.5 font-semibold text-gray-500">⬆ Sup.</th>
                    <th className="text-right px-4 py-2.5 font-semibold text-gray-500">Livres</th>
                    <th className="text-center px-4 py-2.5 font-semibold text-gray-500">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {alojamentos.map(a => (
                    <tr key={a.id} className={`hover:bg-gray-50 transition ${!a.ativo ? 'opacity-50' : ''}`}>
                      <td className="px-5 py-2.5 font-medium text-gray-900">{a.nome}</td>
                      <td className="px-4 py-2.5 text-gray-600">{PUBLICO_LABEL[a.publico] ?? a.publico}</td>
                      <td className="px-4 py-2.5 text-right font-mono">{a.total_vagas}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-sky-700">{a.camas_inferiores}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-gray-600">{a.camas_superiores}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-emerald-700">{a.vagas_livres ?? '—'}</td>
                      <td className="px-4 py-2.5 text-center">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${a.ativo ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                          {a.ativo ? 'Ativo' : 'Inativo'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ══ 6. PÁGINA PÚBLICA ═══════════════════════════════════════ */}
      <div className={card}>
        <div className={hd}>
          <h3 className={hdT}>🌐 Página Pública de Inscrição</h3>
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${evento.inscricoes_abertas ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
            {evento.inscricoes_abertas ? 'Abertas' : 'Fechadas'}
          </span>
        </div>
        <div className="p-6 space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            <input readOnly value={urlPublica}
              className="flex-1 min-w-0 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 bg-gray-50 font-mono" />
            <button onClick={copiarLink}
              className={`flex-shrink-0 px-4 py-2 rounded-lg text-sm font-semibold transition ${copiado ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
              {copiado ? '✅ Copiado!' : '📋 Copiar'}
            </button>
            <a href={urlPublica} target="_blank" rel="noopener noreferrer"
              className="flex-shrink-0 px-4 py-2 rounded-lg bg-[#123b63] text-white text-sm font-semibold hover:bg-[#0f2a45] transition">
              🌐 Abrir
            </a>
          </div>
          <p className="text-xs text-gray-400">
            Slug: <code className="bg-gray-100 px-1.5 py-0.5 rounded text-gray-700 font-mono">{evento.slug}</code>
          </p>
        </div>
      </div>

      {/* ══ 7. INTEGRAÇÕES ══════════════════════════════════════════ */}
      <div className={card}>
        <div className={hd}>
          <h3 className={hdT}>🔌 Integrações</h3>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-gray-50 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-lg">💬</span>
                <p className="text-xs font-bold text-gray-700">WhatsApp</p>
              </div>
              <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${evento.link_whatsapp ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                {evento.link_whatsapp ? 'Grupo configurado' : 'Não configurado'}
              </span>
            </div>
            <div className="bg-gray-50 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-lg">✉️</span>
                <p className="text-xs font-bold text-gray-700">Mensagem de Confirmação</p>
              </div>
              <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${evento.mensagem_confirmacao ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                {evento.mensagem_confirmacao ? 'Configurada' : 'Não configurada'}
              </span>
            </div>
            <div className="bg-gray-50 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-lg">💳</span>
                <p className="text-xs font-bold text-gray-700">ASAAS (Pagamentos)</p>
              </div>
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-blue-100 text-blue-700">
                Verificar no painel
              </span>
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Componentes auxiliares compartilhados
// ═══════════════════════════════════════════════════════════════
function EmptyState({ icon, title, desc }: { icon: string; title: string; desc: string }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 py-14 flex flex-col items-center justify-center text-center">
      <span className="text-5xl mb-3">{icon}</span>
      <p className="text-base font-semibold text-gray-700 mb-1">{title}</p>
      <p className="text-sm text-gray-400">{desc}</p>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-4">
      {[1, 2, 3].map(i => (
        <div key={i} className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 animate-pulse">
          <div className="h-4 bg-gray-200 rounded w-1/3 mb-3" />
          <div className="h-3 bg-gray-200 rounded w-2/3" />
        </div>
      ))}
    </div>
  );
}

function CheckItem({ name, label, checked, onChange }: {
  name: string; label: string; checked: boolean;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <input type="checkbox" name={name} checked={checked} onChange={onChange}
        className="w-4 h-4 accent-[#123b63] cursor-pointer" />
      <span className="text-sm text-gray-700">{label}</span>
    </label>
  );
}

// ═══════════════════════════════════════════════════════════════
// ABA RELATÓRIOS AGO
// ═══════════════════════════════════════════════════════════════
interface RelatoriosAGOData {
  status_evento: string;
  encerrado_em: string | null;
  total_inscritos: number;
  total_credenciados: number;
  total_presentes: number;
  total_ausentes_plenaria: number;
  frequencia_media: number | null;
  total_ausentes_consolidado: number | null;
  refeicoes_consumidas: number;
  refeicoes_restantes: number;
}

function TabRelatoriosAGO({ eventoId }: { eventoId: string; evento: Evento }) {
  const [data, setData] = useState<RelatoriosAGOData | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/eventos/${eventoId}/relatorios-ago`)
      .then(r => r.json())
      .then((d: RelatoriosAGOData) => { setData(d); setLoading(false); })
      .catch(() => { setErro('Erro ao carregar indicadores.'); setLoading(false); });
  }, [eventoId]);

  if (loading) return <div className="text-center py-16 text-gray-400 text-sm">Carregando indicadores...</div>;
  if (erro || !data) return <div className="text-center py-16 text-red-500 text-sm">{erro ?? 'Sem dados.'}</div>;

  const encerrado = data.status_evento === 'encerrado';

  const cards = [
    { label: 'Inscritos',          value: data.total_inscritos,            icon: '👥', color: 'text-[#0D2B4E]',   bg: 'bg-[#0D2B4E]/10' },
    { label: 'Credenciados',       value: data.total_credenciados,         icon: '✅', color: 'text-emerald-700', bg: 'bg-emerald-100' },
    { label: 'Presentes plenária', value: data.total_presentes,            icon: '🏛️', color: 'text-blue-700',    bg: 'bg-blue-100' },
    { label: 'Ausentes plenária',  value: data.total_ausentes_plenaria,    icon: '🚨', color: 'text-red-700',     bg: 'bg-red-100' },
    { label: 'Freq. média',        value: data.frequencia_media != null ? `${data.frequencia_media}%` : '—', icon: '📈', color: 'text-purple-700', bg: 'bg-purple-100' },
    { label: 'Refeições servidas', value: data.refeicoes_consumidas,       icon: '🍽️', color: 'text-amber-700',   bg: 'bg-amber-100' },
    { label: 'Refeições restantes',value: data.refeicoes_restantes,        icon: '🥗', color: 'text-gray-600',    bg: 'bg-gray-100' },
  ];

  return (
    <div className="space-y-6">
      {encerrado && (
        <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl px-5 py-3">
          <span className="text-2xl">🔒</span>
          <div>
            <p className="text-red-700 font-black text-sm">AGO Encerrada</p>
            {data.encerrado_em && <p className="text-red-500 text-xs">Encerrada em {new Date(data.encerrado_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</p>}
          </div>
          {data.total_ausentes_consolidado != null && (
            <span className="ml-auto bg-red-100 text-red-700 text-xs font-black px-3 py-1 rounded-full">
              {data.total_ausentes_consolidado} ausente{data.total_ausentes_consolidado !== 1 ? 's' : ''} consolidado{data.total_ausentes_consolidado !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {cards.map(c => (
          <div key={c.label} className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm flex items-start gap-3">
            <div className={`w-10 h-10 rounded-xl ${c.bg} flex items-center justify-center text-lg flex-shrink-0`}>{c.icon}</div>
            <div>
              <p className={`font-black text-xl leading-tight ${c.color}`}>{c.value}</p>
              <p className="text-[10px] text-gray-400 uppercase tracking-wide mt-0.5">{c.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Atalhos rápidos */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
        <h3 className="text-sm font-black text-gray-700 mb-3">Atalhos</h3>
        <div className="flex flex-wrap gap-2">
          <a
            href={`/eventos/${eventoId}/relatorios/frequencia-ago`}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold bg-[#0D2B4E] text-white hover:bg-[#0a1e38] transition"
          >
            📊 Frequência Detalhada
          </a>
          <a
            href={`/eventos/${eventoId}/ausentes`}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold bg-red-100 text-red-700 hover:bg-red-200 transition"
          >
            🚨 Página de Ausentes
          </a>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// ABA AUSENTES
// ═══════════════════════════════════════════════════════════════
interface AusenteItem {
  id: string | null;
  inscricao_id: string;
  nome: string;
  cpf: string | null;
  campo: string | null;
  supervisao: string | null;
  categoria: string | null;
  percentual_frequencia: number;
  faltas: number;
  selecionado_para_advertencia: boolean;
}

function TabAusentes({ eventoId, podeEditar }: { eventoId: string; evento: Evento; podeEditar: boolean }) {
  const [ausentes, setAusentes] = useState<AusenteItem[]>([]);
  const [encerrado, setEncerrado] = useState(false);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [salvando, setSalvando] = useState(false);
  const [filtroNome, setFiltroNome] = useState('');
  const [filtroCampo, setFiltroCampo] = useState('');

  const fetchAusentes = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/eventos/${eventoId}/ausentes`);
      const d = await r.json() as { encerrado: boolean; ausentes: AusenteItem[] };
      setAusentes(d.ausentes ?? []);
      setEncerrado(d.encerrado ?? false);
      // Inicializa selecionados com os já marcados no banco
      const jaMarc = new Set<string>(
        d.ausentes.filter(a => a.selecionado_para_advertencia && a.id).map(a => a.id as string)
      );
      setSelecionados(jaMarc);
    } catch { setErro('Erro ao carregar ausentes.'); }
    finally { setLoading(false); }
  }, [eventoId]);

  useEffect(() => { void fetchAusentes(); }, [fetchAusentes]);

  const filtrados = ausentes.filter(a =>
    (!filtroNome  || a.nome.toLowerCase().includes(filtroNome.toLowerCase())) &&
    (!filtroCampo || (a.campo ?? '').toLowerCase().includes(filtroCampo.toLowerCase()))
  );

  const toggleSel = (id: string | null) => {
    if (!id) return;
    setSelecionados(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleSalvar = async () => {
    if (!encerrado) return;
    setSalvando(true);
    try {
      const ids = [...selecionados];
      // Marca os selecionados
      if (ids.length > 0) {
        await fetch(`/api/eventos/${eventoId}/ausentes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids, selecionado: true }),
        });
      }
      // Desmarca os não-selecionados
      const naoSel = ausentes.filter(a => a.id && !selecionados.has(a.id)).map(a => a.id as string);
      if (naoSel.length > 0) {
        await fetch(`/api/eventos/${eventoId}/ausentes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: naoSel, selecionado: false }),
        });
      }
      await fetchAusentes();
    } finally { setSalvando(false); }
  };

  if (loading) return <div className="text-center py-16 text-gray-400 text-sm">Carregando ausentes...</div>;
  if (erro) return <div className="text-center py-16 text-red-500 text-sm">{erro}</div>;

  return (
    <div className="space-y-4">
      {!encerrado && (
        <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-700 font-semibold">
          ⚠️ A AGO ainda não foi encerrada — dados calculados em tempo real.
        </div>
      )}

      {/* Filtros */}
      <div className="flex flex-wrap gap-2">
        <input
          type="text"
          placeholder="Filtrar por nome..."
          value={filtroNome}
          onChange={e => setFiltroNome(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#123b63] w-48"
        />
        <input
          type="text"
          placeholder="Filtrar por campo..."
          value={filtroCampo}
          onChange={e => setFiltroCampo(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#123b63] w-48"
        />
        <span className="ml-auto text-xs text-gray-500 self-center">{filtrados.length} ausente{filtrados.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Tabela */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {encerrado && podeEditar && <th className="px-3 py-3 text-left text-xs font-bold text-gray-500">Advertência</th>}
                <th className="px-4 py-3 text-left text-xs font-bold text-gray-500">Nome</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-gray-500">Campo</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-gray-500">Supervisão</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-gray-500">Categoria</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-gray-500">Faltas</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-gray-500">Freq.%</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtrados.length === 0 ? (
                <tr>
                  <td colSpan={encerrado && podeEditar ? 7 : 6} className="px-4 py-10 text-center text-gray-400 text-sm">
                    Nenhum ausente encontrado.
                  </td>
                </tr>
              ) : filtrados.map((a, idx) => (
                <tr key={a.inscricao_id} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}>
                  {encerrado && podeEditar && (
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        checked={a.id ? selecionados.has(a.id) : false}
                        onChange={() => toggleSel(a.id)}
                        className="w-4 h-4 accent-red-600 cursor-pointer"
                      />
                    </td>
                  )}
                  <td className="px-4 py-3 font-semibold text-gray-900">{a.nome}</td>
                  <td className="px-4 py-3 text-gray-600">{a.campo ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{a.supervisao ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{a.categoria ?? '—'}</td>
                  <td className="px-4 py-3 text-right">
                    <span className="bg-red-100 text-red-700 text-xs font-bold px-2 py-0.5 rounded-full">{a.faltas}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${a.percentual_frequencia === 0 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                      {a.percentual_frequencia}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {encerrado && podeEditar && (
        <div className="flex justify-end gap-3">
          <span className="text-xs text-gray-500 self-center">{selecionados.size} selecionado{selecionados.size !== 1 ? 's' : ''} para advertência</span>
          <button
            onClick={handleSalvar}
            disabled={salvando}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-bold bg-red-700 text-white hover:bg-red-800 transition disabled:opacity-50"
          >
            {salvando ? 'Salvando...' : '📋 Salvar Seleção'}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── TabHomologacao ───────────────────────────────────────────────────────────

type HomologacaoStatus = 'pendente_analise' | 'regular' | 'ausente' | 'ausencia_justificada' | 'dispensado';

interface HomologacaoRecord {
  id: string;
  nome: string;
  matricula: string | null;
  campo: string | null;
  supervisao: string | null;
  categoria: string | null;
  total_plenarias: number;
  presencas: number;
  faltas: number;
  percentual_frequencia: number;
  status: HomologacaoStatus;
  motivo_justificativa: string | null;
  observacao_justificativa: string | null;
  usuario_responsavel_nome: string | null;
  homologado_em: string | null;
  historico_registrado: boolean;
}

interface HomologacaoStats {
  total: number;
  iniciado: boolean;
  finalizado: boolean;
  pendente_analise: number;
  regular: number;
  ausente: number;
  ausencia_justificada: number;
  dispensado: number;
}

const STATUS_HMLG_CFG: Record<HomologacaoStatus, { label: string; cls: string; bg: string }> = {
  pendente_analise:    { label: 'Pendente',    cls: 'bg-yellow-100 text-yellow-800', bg: 'bg-yellow-50'  },
  regular:             { label: 'Regular',     cls: 'bg-green-100  text-green-800',  bg: 'bg-green-50'   },
  ausente:             { label: 'Ausente',     cls: 'bg-red-100    text-red-800',    bg: 'bg-red-50'     },
  ausencia_justificada:{ label: 'Justificado', cls: 'bg-blue-100   text-blue-800',   bg: 'bg-blue-50'    },
  dispensado:          { label: 'Dispensado',  cls: 'bg-purple-100 text-purple-800', bg: 'bg-purple-50'  },
};

function TabHomologacao({ eventoId, podeEditar }: { eventoId: string; podeEditar: boolean }) {
  const [records, setRecords]     = useState<HomologacaoRecord[]>([]);
  const [stats,   setStats]       = useState<HomologacaoStats | null>(null);
  const [loading, setLoading]     = useState(true);
  const [erro, setErro]           = useState<string | null>(null);
  const [filtroNome,   setFiltroNome]   = useState('');
  const [filtroCampo,  setFiltroCampo]  = useState('');
  const [filtroStatus, setFiltroStatus] = useState<string>('');
  const [iniciando,    setIniciando]    = useState(false);
  const [finalizando,  setFinalizando]  = useState(false);
  const [confirmFinal, setConfirmFinal] = useState(false);
  const [modal, setModal] = useState<{
    record: HomologacaoRecord;
    novoStatus: HomologacaoStatus;
  } | null>(null);
  const [motivo, setMotivo]           = useState('');
  const [observacao, setObservacao]   = useState('');
  const [salvandoModal, setSalvandoModal] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    setErro(null);
    try {
      const res = await authenticatedFetch(`/api/eventos/${eventoId}/homologacao`);
      if (!res.ok) { setErro('Erro ao carregar dados.'); return; }
      const data = await res.json();
      setRecords(data.records ?? []);
      setStats(data.stats ?? null);
    } catch {
      setErro('Erro de rede.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void fetchData(); }, [eventoId]);

  const handleIniciar = async () => {
    setIniciando(true);
    setErro(null);
    try {
      const res = await authenticatedFetch(`/api/eventos/${eventoId}/homologacao`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'iniciar' }),
      });
      const data = await res.json();
      if (!res.ok) { setErro(data.error ?? 'Erro ao iniciar.'); return; }
      await fetchData();
    } catch {
      setErro('Erro de rede.');
    } finally {
      setIniciando(false);
    }
  };

  const handleAtualizar = async (
    id: string,
    novoStatus: HomologacaoStatus,
    motivoVal?: string,
    obsVal?: string
  ) => {
    setSalvandoModal(true);
    setErro(null);
    try {
      const res = await authenticatedFetch(`/api/eventos/${eventoId}/homologacao/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: novoStatus, motivo_justificativa: motivoVal, observacao_justificativa: obsVal }),
      });
      const data = await res.json();
      if (!res.ok) { setErro(data.error ?? 'Erro ao atualizar.'); return; }
      setModal(null);
      setMotivo('');
      setObservacao('');
      await fetchData();
    } catch {
      setErro('Erro de rede.');
    } finally {
      setSalvandoModal(false);
    }
  };

  const handleFinalizar = async () => {
    setFinalizando(true);
    setErro(null);
    try {
      const res = await authenticatedFetch(`/api/eventos/${eventoId}/homologacao/finalizar`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) { setErro(data.error ?? 'Erro ao finalizar.'); return; }
      setConfirmFinal(false);
      await fetchData();
    } catch {
      setErro('Erro de rede.');
    } finally {
      setFinalizando(false);
    }
  };

  const filtrados = records.filter(r => {
    if (filtroNome   && !r.nome.toLowerCase().includes(filtroNome.toLowerCase()))   return false;
    if (filtroCampo  && !(r.campo ?? '').toLowerCase().includes(filtroCampo.toLowerCase())) return false;
    if (filtroStatus && r.status !== filtroStatus) return false;
    return true;
  });

  if (loading) return <div className="flex items-center justify-center py-20 text-gray-400">Carregando...</div>;

  // Evento não encerrado
  if (stats && !stats.iniciado && !loading) {
    return (
      <div className="space-y-6">
        {erro && <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">{erro}</div>}
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-center">
          <div className="text-4xl mb-3">⚖️</div>
          <h3 className="text-lg font-black text-amber-900 mb-2">Homologação não iniciada</h3>
          <p className="text-sm text-amber-700 mb-5">
            Inicie a homologação para classificar a frequência de cada ministro.<br />
            O evento precisa estar <strong>encerrado</strong> antes de iniciar.
          </p>
          {podeEditar && (
            <button
              onClick={handleIniciar}
              disabled={iniciando}
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-bold bg-amber-700 text-white hover:bg-amber-800 transition disabled:opacity-50"
            >
              {iniciando ? '⏳ Iniciando...' : '⚖️ Iniciar Homologação'}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {erro && <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">{erro}</div>}

      {/* Cards de stats */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {([ 
            { key: 'pendente_analise', label: 'Pendentes', icon: '⏳', cls: 'border-yellow-200 bg-yellow-50' },
            { key: 'regular',          label: 'Regulares', icon: '✅', cls: 'border-green-200 bg-green-50' },
            { key: 'ausente',          label: 'Ausentes',  icon: '❌', cls: 'border-red-200 bg-red-50' },
            { key: 'ausencia_justificada', label: 'Justificados', icon: '📄', cls: 'border-blue-200 bg-blue-50' },
            { key: 'dispensado',       label: 'Dispensados', icon: '🔵', cls: 'border-purple-200 bg-purple-50' },
          ] as { key: keyof HomologacaoStats; label: string; icon: string; cls: string }[]).map(card => (
            <div key={card.key} className={`border rounded-xl p-4 text-center ${card.cls}`}>
              <div className="text-2xl mb-1">{card.icon}</div>
              <div className="text-2xl font-black text-gray-900">{stats[card.key] as number}</div>
              <div className="text-xs text-gray-600 font-semibold">{card.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Badge finalizado ou botão finalizar */}
      {podeEditar && stats && (
        <div className="flex items-center justify-between flex-wrap gap-3">
          {stats.finalizado ? (
            <span className="inline-flex items-center gap-2 bg-green-100 text-green-800 text-sm font-bold px-4 py-2 rounded-full">
              ✅ Homologação Finalizada — Histórico registrado
            </span>
          ) : (
            <button
              onClick={() => setConfirmFinal(true)}
              disabled={stats.pendente_analise > 0}
              title={stats.pendente_analise > 0 ? `${stats.pendente_analise} registro(s) pendentes de análise` : ''}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold bg-[#123b63] text-white hover:bg-[#0f3154] transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              🏁 Finalizar Homologação
            </button>
          )}
          <span className="text-xs text-gray-500">{stats.total} ministro{stats.total !== 1 ? 's' : ''} no total</span>
        </div>
      )}

      {/* Filtros */}
      <div className="flex flex-wrap gap-3">
        <input
          value={filtroNome}
          onChange={e => setFiltroNome(e.target.value)}
          placeholder="Filtrar por nome…"
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm flex-1 min-w-[180px] focus:outline-none focus:ring-2 focus:ring-[#123b63]"
        />
        <input
          value={filtroCampo}
          onChange={e => setFiltroCampo(e.target.value)}
          placeholder="Filtrar por campo…"
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm flex-1 min-w-[160px] focus:outline-none focus:ring-2 focus:ring-[#123b63]"
        />
        <select
          value={filtroStatus}
          onChange={e => setFiltroStatus(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#123b63]"
        >
          <option value="">Todos os status</option>
          <option value="pendente_analise">Pendente</option>
          <option value="regular">Regular</option>
          <option value="ausente">Ausente</option>
          <option value="ausencia_justificada">Justificado</option>
          <option value="dispensado">Dispensado</option>
        </select>
      </div>

      {/* Tabela */}
      <div className="overflow-x-auto rounded-xl border border-gray-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-left border-b border-gray-200">
              <th className="px-4 py-3 font-semibold text-gray-600">Nome</th>
              <th className="px-3 py-3 font-semibold text-gray-600">Matrícula</th>
              <th className="px-3 py-3 font-semibold text-gray-600">Campo</th>
              <th className="px-3 py-3 font-semibold text-gray-600">Supervisão</th>
              <th className="px-3 py-3 font-semibold text-gray-600">Categoria</th>
              <th className="px-3 py-3 font-semibold text-gray-600 text-center">Pres.</th>
              <th className="px-3 py-3 font-semibold text-gray-600 text-center">Falt.</th>
              <th className="px-3 py-3 font-semibold text-gray-600 text-center">%</th>
              <th className="px-3 py-3 font-semibold text-gray-600">Status</th>
              {podeEditar && !stats?.finalizado && (
                <th className="px-3 py-3 font-semibold text-gray-600 text-center">Ações</th>
              )}
            </tr>
          </thead>
          <tbody>
            {filtrados.length === 0 && (
              <tr>
                <td colSpan={podeEditar && !stats?.finalizado ? 10 : 9} className="text-center py-10 text-gray-400">
                  Nenhum registro encontrado.
                </td>
              </tr>
            )}
            {filtrados.map((r, idx) => {
              const cfg = STATUS_HMLG_CFG[r.status];
              return (
                <tr key={r.id} className={`border-b border-gray-100 ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/40'}`}>
                  <td className="px-4 py-3 font-semibold text-gray-900">
                    {r.nome}
                    {r.motivo_justificativa && (
                      <div className="text-xs text-gray-500 font-normal mt-0.5">{r.motivo_justificativa}</div>
                    )}
                  </td>
                  <td className="px-3 py-3 text-gray-600 text-xs">{r.matricula ?? '—'}</td>
                  <td className="px-3 py-3 text-gray-600 text-xs">{r.campo ?? '—'}</td>
                  <td className="px-3 py-3 text-gray-600 text-xs">{r.supervisao ?? '—'}</td>
                  <td className="px-3 py-3 text-gray-600 text-xs">{r.categoria ?? '—'}</td>
                  <td className="px-3 py-3 text-center">
                    <span className="bg-green-100 text-green-700 text-xs font-bold px-2 py-0.5 rounded-full">{r.presencas}</span>
                  </td>
                  <td className="px-3 py-3 text-center">
                    <span className="bg-red-100 text-red-700 text-xs font-bold px-2 py-0.5 rounded-full">{r.faltas}</span>
                  </td>
                  <td className="px-3 py-3 text-center">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${r.percentual_frequencia >= 100 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      {r.percentual_frequencia}%
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${cfg.cls}`}>{cfg.label}</span>
                  </td>
                  {podeEditar && !stats?.finalizado && (
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-1 justify-center flex-wrap">
                        {r.status !== 'regular' && (
                          <button
                            onClick={() => handleAtualizar(r.id, 'regular')}
                            className="text-xs px-2 py-1 rounded-lg bg-green-100 text-green-700 hover:bg-green-200 font-semibold transition"
                          >✅</button>
                        )}
                        {r.status !== 'ausente' && (
                          <button
                            onClick={() => handleAtualizar(r.id, 'ausente')}
                            className="text-xs px-2 py-1 rounded-lg bg-red-100 text-red-700 hover:bg-red-200 font-semibold transition"
                          >❌</button>
                        )}
                        {r.status !== 'ausencia_justificada' && (
                          <button
                            onClick={() => { setModal({ record: r, novoStatus: 'ausencia_justificada' }); setMotivo(''); setObservacao(''); }}
                            className="text-xs px-2 py-1 rounded-lg bg-blue-100 text-blue-700 hover:bg-blue-200 font-semibold transition"
                          >📄</button>
                        )}
                        {r.status !== 'dispensado' && (
                          <button
                            onClick={() => { setModal({ record: r, novoStatus: 'dispensado' }); setMotivo(''); setObservacao(''); }}
                            className="text-xs px-2 py-1 rounded-lg bg-purple-100 text-purple-700 hover:bg-purple-200 font-semibold transition"
                          >🔵</button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Modal justificativa / dispensar */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-7 space-y-4">
            <div className="text-center">
              <span className="text-4xl block mb-2">{modal.novoStatus === 'ausencia_justificada' ? '📄' : '🔵'}</span>
              <h3 className="text-lg font-black text-gray-900">
                {modal.novoStatus === 'ausencia_justificada' ? 'Justificar Ausência' : 'Dispensar'}
              </h3>
              <p className="text-sm text-gray-500 mt-1">{modal.record.nome}</p>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">
                Motivo <span className="text-red-500">*</span>
              </label>
              <input
                value={motivo}
                onChange={e => setMotivo(e.target.value)}
                placeholder="Ex: Doença, viagem a serviço…"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#123b63]"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Observação (opcional)</label>
              <textarea
                value={observacao}
                onChange={e => setObservacao(e.target.value)}
                rows={3}
                placeholder="Detalhes adicionais…"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#123b63] resize-none"
              />
            </div>
            {erro && <p className="text-red-600 text-xs">{erro}</p>}
            <div className="flex gap-3">
              <button
                onClick={() => { setModal(null); setErro(null); }}
                className="flex-1 py-2 rounded-xl text-sm font-semibold border border-gray-300 hover:bg-gray-50 transition"
              >Cancelar</button>
              <button
                onClick={() => handleAtualizar(modal.record.id, modal.novoStatus, motivo, observacao)}
                disabled={salvandoModal || !motivo.trim()}
                className="flex-1 py-2 rounded-xl text-sm font-bold bg-[#123b63] text-white hover:bg-[#0f3154] transition disabled:opacity-50"
              >
                {salvandoModal ? 'Salvando...' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal confirmar finalização */}
      {confirmFinal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-7">
            <div className="text-center mb-5">
              <span className="text-5xl block mb-3">🏁</span>
              <h2 className="text-xl font-black text-gray-900 mb-2">Finalizar Homologação?</h2>
              <p className="text-sm text-gray-500">
                Esta ação irá registrar no <strong>Histórico Ministerial</strong> de cada ministro e
                sincronizar a lista de <strong>ausentes para advertência</strong>.
              </p>
              {stats && stats.ausente > 0 && (
                <p className="text-sm text-red-600 font-semibold mt-2">
                  ⚠️ {stats.ausente} ministro{stats.ausente !== 1 ? 's' : ''} serão marcados para advertência.
                </p>
              )}
            </div>
            {erro && <p className="text-red-600 text-xs text-center mb-3">{erro}</p>}
            <div className="flex gap-3">
              <button
                onClick={() => { setConfirmFinal(false); setErro(null); }}
                className="flex-1 py-2 rounded-xl text-sm font-semibold border border-gray-300 hover:bg-gray-50 transition"
              >Cancelar</button>
              <button
                onClick={handleFinalizar}
                disabled={finalizando}
                className="flex-1 py-2 rounded-xl text-sm font-bold bg-[#123b63] text-white hover:bg-[#0f3154] transition disabled:opacity-50"
              >
                {finalizando ? '⏳ Finalizando...' : '🏁 Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── TabDeliberacoes ──────────────────────────────────────────────────────────

const TIPOS_DELIB = [
  { value: 'consagracao',          label: 'Consagração' },
  { value: 'ordenacao',            label: 'Ordenação' },
  { value: 'separacao_ministerio', label: 'Separação ao Ministério' },
  { value: 'recebimento',          label: 'Recebimento' },
  { value: 'transferencia',        label: 'Transferência' },
  { value: 'jubilacao',            label: 'Jubilação' },
  { value: 'mudanca_cargo',        label: 'Mudança de Cargo' },
  { value: 'aprovacao_candidato',  label: 'Aprovação de Candidato' },
  { value: 'exclusao',             label: 'Exclusão' },
  { value: 'observacao_geral',     label: 'Observação Geral' },
] as const;


const STATUS_DELIB_CFG: Record<string, { label: string; cls: string }> = {
  rascunho: { label: 'Rascunho', cls: 'bg-yellow-100 text-yellow-800' },
  aprovado: { label: 'Aprovado', cls: 'bg-blue-100 text-blue-800' },
  aplicado: { label: 'Aplicado', cls: 'bg-green-100 text-green-800' },
};

interface DeliberacaoRecord {
  id: string;
  ministro_id: string | null;
  ministro_nome: string;
  ministro_matricula: string | null;
  ministro_campo: string | null;
  ministro_supervisao: string | null;
  tipo: string;
  data_deliberacao: string | null;
  situacao_anterior: string | null;
  situacao_nova: string | null;
  observacao: string | null;
  numero_ata: string | null;
  status: 'rascunho' | 'aprovado' | 'aplicado';
  aprovado_em: string | null;
  aprovado_por_nome: string | null;
  aplicado_em: string | null;
  aplicado_por_nome: string | null;
  created_by_nome: string | null;
  created_at: string;
}

interface DelibStats { total: number; rascunho: number; aprovado: number; aplicado: number }
interface MemberHit  { id: string; name: string | null; matricula: string | null; campo: string | null; supervisao: string | null; cargo_ministerial: string | null }

const FORM_VAZIO = {
  ministroSearch:    '',
  ministroSelecionado: null as MemberHit | null,
  tipo:              '' as string,
  data_deliberacao:  '',
  situacao_anterior: '',
  situacao_nova:     '',
  observacao:        '',
  numero_ata:        '',
};

function fmtTipoDelib(tipo: string) {
  return TIPOS_DELIB.find(t => t.value === tipo)?.label ?? tipo;
}

function fmtDate(d: string | null) {
  if (!d) return '—';
  const [y, m, day] = d.slice(0, 10).split('-');
  return `${day}/${m}/${y}`;
}

function exportarCSV(records: DeliberacaoRecord[], eventoNome: string) {
  const headers = ['Nome','Matrícula','Campo','Supervisão','Tipo','Data','Sit. Anterior','Sit. Nova','Nº Ata','Status','Observação'];
  const rows = records.map(r => [
    r.ministro_nome,
    r.ministro_matricula ?? '',
    r.ministro_campo ?? '',
    r.ministro_supervisao ?? '',
    fmtTipoDelib(r.tipo),
    fmtDate(r.data_deliberacao),
    r.situacao_anterior ?? '',
    r.situacao_nova ?? '',
    r.numero_ata ?? '',
    STATUS_DELIB_CFG[r.status]?.label ?? r.status,
    r.observacao ?? '',
  ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
  const csv = [headers.join(','), ...rows].join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `deliberacoes-ago-${eventoNome.replace(/\s+/g, '-').toLowerCase()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function exportarImpressao(records: DeliberacaoRecord[], eventoNome: string) {
  const linhas = records.map(r => `
    <tr>
      <td>${r.ministro_nome}</td>
      <td>${r.ministro_matricula ?? '—'}</td>
      <td>${r.ministro_campo ?? '—'}</td>
      <td>${fmtTipoDelib(r.tipo)}</td>
      <td>${fmtDate(r.data_deliberacao)}</td>
      <td>${r.situacao_anterior ?? '—'}</td>
      <td>${r.situacao_nova ?? '—'}</td>
      <td>${r.numero_ata ?? '—'}</td>
      <td>${STATUS_DELIB_CFG[r.status]?.label ?? r.status}</td>
    </tr>`).join('');
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
    <title>Deliberações AGO — ${eventoNome}</title>
    <style>
      body { font-family: Arial, sans-serif; font-size: 11px; padding: 20px; }
      h2 { font-size: 14px; margin-bottom: 4px; }
      h3 { font-size: 11px; color: #555; margin-bottom: 12px; }
      table { width: 100%; border-collapse: collapse; }
      th, td { border: 1px solid #ccc; padding: 4px 6px; }
      th { background: #163b66; color: #fff; font-weight: bold; }
      tr:nth-child(even) { background: #f5f5f5; }
      @media print { button { display: none; } }
    </style></head><body>
    <button onclick="window.print()">🖨️ Imprimir</button>
    <h2>Deliberações AGO</h2><h3>${eventoNome}</h3>
    <table><thead><tr>
      <th>Nome</th><th>Matrícula</th><th>Campo</th><th>Tipo</th>
      <th>Data</th><th>Sit. Anterior</th><th>Sit. Nova</th><th>Nº Ata</th><th>Status</th>
    </tr></thead><tbody>${linhas}</tbody></table>
    </body></html>`;
  const w = window.open('', '_blank');
  if (w) { w.document.write(html); w.document.close(); }
}

function TabDeliberacoes({ eventoId, evento, podeEditar }: { eventoId: string; evento: Evento | null; podeEditar: boolean }) {
  const [records,  setRecords]  = useState<DeliberacaoRecord[]>([]);
  const [stats,    setStats]    = useState<DelibStats>({ total: 0, rascunho: 0, aprovado: 0, aplicado: 0 });
  const [loading,  setLoading]  = useState(true);
  const [erro,     setErro]     = useState<string | null>(null);

  // Filtros
  const [filtroNome,   setFiltroNome]   = useState('');
  const [filtroTipo,   setFiltroTipo]   = useState('');
  const [filtroStatus, setFiltroStatus] = useState('');
  const [filtroCampo,  setFiltroCampo]  = useState('');

  // Modal criar/editar
  const [modalAberto,  setModalAberto]  = useState(false);
  const [editando,     setEditando]     = useState<DeliberacaoRecord | null>(null);
  const [form,         setForm]         = useState(FORM_VAZIO);
  const [buscaMembro,  setBuscaMembro]  = useState('');
  const [resultsMembro,setResultsMembro] = useState<MemberHit[]>([]);
  const [buscandoMembro, setBuscandoMembro] = useState(false);
  const [salvandoModal,  setSalvandoModal]  = useState(false);
  const [erroModal,      setErroModal]      = useState<string | null>(null);

  // Confirmações de ação
  const [confirmAprovar, setConfirmAprovar] = useState<DeliberacaoRecord | null>(null);
  const [confirmAplicar, setConfirmAplicar] = useState<DeliberacaoRecord | null>(null);
  const [confirmExcluir, setConfirmExcluir] = useState<DeliberacaoRecord | null>(null);
  const [agindo, setAgindo] = useState(false);

  const eventoNome = evento?.nome ?? 'AGO';

  const fetchData = async () => {
    setLoading(true);
    setErro(null);
    try {
      const res = await authenticatedFetch(`/api/eventos/${eventoId}/deliberacoes`);
      if (!res.ok) { setErro('Erro ao carregar deliberações.'); return; }
      const data = await res.json();
      setRecords(data.records ?? []);
      setStats(data.stats ?? { total: 0, rascunho: 0, aprovado: 0, aplicado: 0 });
    } catch { setErro('Erro de rede.'); }
    finally   { setLoading(false); }
  };

  useEffect(() => { void fetchData(); }, [eventoId]);

  // Autocomplete de membros
  const buscarMembro = async (termo: string) => {
    if (!termo.trim() || termo.length < 2) { setResultsMembro([]); return; }
    setBuscandoMembro(true);
    try {
      const res = await authenticatedFetch(`/api/v1/members/lookup?search=${encodeURIComponent(termo)}&limit=8`);
      if (res.ok) {
        const data = await res.json();
        setResultsMembro((data.data ?? []) as MemberHit[]);
      }
    } catch { /* ignore */ }
    finally { setBuscandoMembro(false); }
  };

  useEffect(() => {
    const t = setTimeout(() => void buscarMembro(buscaMembro), 300);
    return () => clearTimeout(t);
  }, [buscaMembro]);

  const abrirCriar = () => {
    setEditando(null);
    setForm(FORM_VAZIO);
    setBuscaMembro('');
    setResultsMembro([]);
    setErroModal(null);
    setModalAberto(true);
  };

  const abrirEditar = (r: DeliberacaoRecord) => {
    setEditando(r);
    setForm({
      ministroSearch:      r.ministro_nome,
      ministroSelecionado: r.ministro_id ? {
        id: r.ministro_id, name: r.ministro_nome, matricula: r.ministro_matricula,
        campo: r.ministro_campo, supervisao: r.ministro_supervisao, cargo_ministerial: null,
      } : null,
      tipo:              r.tipo,
      data_deliberacao:  r.data_deliberacao ?? '',
      situacao_anterior: r.situacao_anterior ?? '',
      situacao_nova:     r.situacao_nova ?? '',
      observacao:        r.observacao ?? '',
      numero_ata:        r.numero_ata ?? '',
    });
    setBuscaMembro(r.ministro_nome);
    setResultsMembro([]);
    setErroModal(null);
    setModalAberto(true);
  };

  const selecionarMembro = (m: MemberHit) => {
    setForm(f => ({
      ...f,
      ministroSelecionado: m,
      ministroSearch: m.name ?? '',
    }));
    setBuscaMembro(m.name ?? '');
    setResultsMembro([]);
  };

  const handleSalvar = async () => {
    if (!form.tipo) { setErroModal('Selecione o tipo.'); return; }
    const nome = form.ministroSelecionado?.name ?? form.ministroSearch.trim();
    if (!nome) { setErroModal('Informe o nome do ministro.'); return; }

    setSalvandoModal(true);
    setErroModal(null);
    try {
      const payload = {
        ministro_id:         form.ministroSelecionado?.id ?? null,
        ministro_nome:       nome,
        ministro_matricula:  form.ministroSelecionado?.matricula ?? null,
        ministro_campo:      form.ministroSelecionado?.campo ?? null,
        ministro_supervisao: form.ministroSelecionado?.supervisao ?? null,
        tipo:                form.tipo,
        data_deliberacao:    form.data_deliberacao || null,
        situacao_anterior:   form.situacao_anterior || null,
        situacao_nova:       form.situacao_nova || null,
        observacao:          form.observacao || null,
        numero_ata:          form.numero_ata || null,
      };

      let res: Response;
      if (editando) {
        res = await authenticatedFetch(`/api/eventos/${eventoId}/deliberacoes/${editando.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } else {
        res = await authenticatedFetch(`/api/eventos/${eventoId}/deliberacoes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }
      const data = await res.json();
      if (!res.ok) { setErroModal(data.error ?? 'Erro ao salvar.'); return; }
      setModalAberto(false);
      await fetchData();
    } catch { setErroModal('Erro de rede.'); }
    finally  { setSalvandoModal(false); }
  };

  const handleAprovar = async () => {
    if (!confirmAprovar) return;
    setAgindo(true);
    try {
      const res = await authenticatedFetch(`/api/eventos/${eventoId}/deliberacoes/${confirmAprovar.id}/aprovar`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) { setErro(data.error ?? 'Erro ao aprovar.'); }
      else { setConfirmAprovar(null); await fetchData(); }
    } catch { setErro('Erro de rede.'); }
    finally  { setAgindo(false); }
  };

  const handleAplicar = async () => {
    if (!confirmAplicar) return;
    setAgindo(true);
    try {
      const res = await authenticatedFetch(`/api/eventos/${eventoId}/deliberacoes/${confirmAplicar.id}/aplicar`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) { setErro(data.error ?? 'Erro ao aplicar.'); }
      else { setConfirmAplicar(null); await fetchData(); }
    } catch { setErro('Erro de rede.'); }
    finally  { setAgindo(false); }
  };

  const handleExcluir = async () => {
    if (!confirmExcluir) return;
    setAgindo(true);
    try {
      const res = await authenticatedFetch(`/api/eventos/${eventoId}/deliberacoes/${confirmExcluir.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) { setErro(data.error ?? 'Erro ao excluir.'); }
      else { setConfirmExcluir(null); await fetchData(); }
    } catch { setErro('Erro de rede.'); }
    finally  { setAgindo(false); }
  };

  const filtrados = records.filter(r => {
    if (filtroNome   && !r.ministro_nome.toLowerCase().includes(filtroNome.toLowerCase()))   return false;
    if (filtroTipo   && r.tipo !== filtroTipo)                                                return false;
    if (filtroStatus && r.status !== filtroStatus)                                            return false;
    if (filtroCampo  && !(r.ministro_campo ?? '').toLowerCase().includes(filtroCampo.toLowerCase())) return false;
    return true;
  });

  if (loading) return <div className="flex items-center justify-center py-20 text-gray-400">Carregando...</div>;

  return (
    <div className="space-y-6">
      {erro && <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">{erro}</div>}

      {/* Cards de stats + ações */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex flex-wrap gap-3 flex-1">
          {([
            { key: 'rascunho', label: 'Rascunhos', icon: '📝', cls: 'border-yellow-200 bg-yellow-50' },
            { key: 'aprovado', label: 'Aprovadas',  icon: '✅', cls: 'border-blue-200 bg-blue-50' },
            { key: 'aplicado', label: 'Aplicadas',  icon: '🏆', cls: 'border-green-200 bg-green-50' },
          ] as { key: keyof DelibStats; label: string; icon: string; cls: string }[]).map(c => (
            <div key={c.key} className={`border rounded-xl px-4 py-3 text-center ${c.cls}`}>
              <div className="text-xl mb-0.5">{c.icon}</div>
              <div className="text-2xl font-black text-gray-900">{stats[c.key]}</div>
              <div className="text-xs text-gray-600 font-semibold">{c.label}</div>
            </div>
          ))}
        </div>
        <div className="flex gap-2 flex-wrap">
          {podeEditar && (
            <button
              onClick={abrirCriar}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold bg-[#123b63] text-white hover:bg-[#0f3154] transition"
            >
              ➕ Nova Deliberação
            </button>
          )}
          {records.length > 0 && (
            <>
              <button
                onClick={() => exportarCSV(filtrados, eventoNome)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold border border-gray-300 hover:bg-gray-50 transition"
              >📊 Excel</button>
              <button
                onClick={() => exportarImpressao(filtrados, eventoNome)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold border border-gray-300 hover:bg-gray-50 transition"
              >🖨️ PDF</button>
            </>
          )}
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-3">
        <input
          value={filtroNome} onChange={e => setFiltroNome(e.target.value)}
          placeholder="Filtrar por ministro…"
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm flex-1 min-w-[180px] focus:outline-none focus:ring-2 focus:ring-[#123b63]"
        />
        <input
          value={filtroCampo} onChange={e => setFiltroCampo(e.target.value)}
          placeholder="Filtrar por campo…"
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm flex-1 min-w-[150px] focus:outline-none focus:ring-2 focus:ring-[#123b63]"
        />
        <select
          value={filtroTipo} onChange={e => setFiltroTipo(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#123b63]"
        >
          <option value="">Todos os tipos</option>
          {TIPOS_DELIB.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <select
          value={filtroStatus} onChange={e => setFiltroStatus(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#123b63]"
        >
          <option value="">Todos os status</option>
          <option value="rascunho">Rascunho</option>
          <option value="aprovado">Aprovado</option>
          <option value="aplicado">Aplicado</option>
        </select>
      </div>

      {/* Tabela */}
      {filtrados.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <div className="text-4xl mb-3">📜</div>
          <p className="text-sm">Nenhuma deliberação encontrada.</p>
          {podeEditar && records.length === 0 && (
            <button onClick={abrirCriar} className="mt-4 px-5 py-2 rounded-xl text-sm font-bold bg-[#123b63] text-white hover:bg-[#0f3154] transition">
              ➕ Criar primeira deliberação
            </button>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left border-b border-gray-200">
                <th className="px-4 py-3 font-semibold text-gray-600">Ministro</th>
                <th className="px-3 py-3 font-semibold text-gray-600">Campo</th>
                <th className="px-3 py-3 font-semibold text-gray-600">Tipo</th>
                <th className="px-3 py-3 font-semibold text-gray-600">Data</th>
                <th className="px-3 py-3 font-semibold text-gray-600">Sit. Anterior</th>
                <th className="px-3 py-3 font-semibold text-gray-600">Sit. Nova</th>
                <th className="px-3 py-3 font-semibold text-gray-600">Nº Ata</th>
                <th className="px-3 py-3 font-semibold text-gray-600">Status</th>
                {podeEditar && <th className="px-3 py-3 font-semibold text-gray-600 text-center">Ações</th>}
              </tr>
            </thead>
            <tbody>
              {filtrados.map((r, idx) => (
                <tr key={r.id} className={`border-b border-gray-100 ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/40'}`}>
                  <td className="px-4 py-3">
                    <div className="font-semibold text-gray-900">{r.ministro_nome}</div>
                    {r.ministro_matricula && <div className="text-xs text-gray-500">{r.ministro_matricula}</div>}
                  </td>
                  <td className="px-3 py-3 text-gray-600 text-xs">{r.ministro_campo ?? '—'}</td>
                  <td className="px-3 py-3">
                    <span className="inline-block bg-gray-100 text-gray-700 text-xs font-semibold px-2 py-0.5 rounded-full">
                      {fmtTipoDelib(r.tipo)}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-gray-600 text-xs whitespace-nowrap">{fmtDate(r.data_deliberacao)}</td>
                  <td className="px-3 py-3 text-gray-600 text-xs max-w-[140px] truncate" title={r.situacao_anterior ?? ''}>{r.situacao_anterior ?? '—'}</td>
                  <td className="px-3 py-3 text-gray-600 text-xs max-w-[140px] truncate" title={r.situacao_nova ?? ''}>{r.situacao_nova ?? '—'}</td>
                  <td className="px-3 py-3 text-gray-600 text-xs">{r.numero_ata ?? '—'}</td>
                  <td className="px-3 py-3">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${STATUS_DELIB_CFG[r.status]?.cls ?? ''}`}>
                      {STATUS_DELIB_CFG[r.status]?.label ?? r.status}
                    </span>
                    {r.aplicado_por_nome && (
                      <div className="text-xs text-gray-400 mt-0.5">por {r.aplicado_por_nome}</div>
                    )}
                  </td>
                  {podeEditar && (
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-1 justify-center flex-wrap">
                        {r.status === 'rascunho' && (
                          <>
                            <button onClick={() => abrirEditar(r)} title="Editar" className="text-xs px-2 py-1 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold transition">✏️</button>
                            <button onClick={() => setConfirmAprovar(r)} title="Aprovar" className="text-xs px-2 py-1 rounded-lg bg-blue-100 hover:bg-blue-200 text-blue-700 font-semibold transition">✅ Aprovar</button>
                            <button onClick={() => setConfirmExcluir(r)} title="Excluir" className="text-xs px-2 py-1 rounded-lg bg-red-100 hover:bg-red-200 text-red-700 font-semibold transition">🗑️</button>
                          </>
                        )}
                        {r.status === 'aprovado' && (
                          <button onClick={() => setConfirmAplicar(r)} title="Aplicar" className="text-xs px-2 py-1 rounded-lg bg-green-100 hover:bg-green-200 text-green-700 font-semibold transition">🏆 Aplicar</button>
                        )}
                        {r.status === 'aplicado' && (
                          <span className="text-xs text-green-600 font-semibold">✓ Aplicado</span>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Modal Criar/Editar ──────────────────────────────── */}
      {modalAberto && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl p-7 my-8 space-y-5">
            <h3 className="text-lg font-black text-gray-900">
              {editando ? '✏️ Editar Deliberação' : '➕ Nova Deliberação'}
            </h3>

            {/* Busca de membro */}
            <div className="relative">
              <label className="block text-xs font-semibold text-gray-600 mb-1">
                Ministro <span className="text-red-500">*</span>
              </label>
              <input
                value={buscaMembro}
                onChange={e => { setBuscaMembro(e.target.value); setForm(f => ({ ...f, ministroSelecionado: null, ministroSearch: e.target.value })); }}
                placeholder="Digite o nome para buscar…"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#123b63]"
              />
              {form.ministroSelecionado && (
                <div className="mt-1 flex items-center gap-2 text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-1.5">
                  <span>✅</span>
                  <span className="font-semibold">{form.ministroSelecionado.name}</span>
                  {form.ministroSelecionado.matricula && <span className="text-gray-500">— {form.ministroSelecionado.matricula}</span>}
                  {form.ministroSelecionado.campo && <span className="text-gray-500">— {form.ministroSelecionado.campo}</span>}
                  <button onClick={() => { setForm(f => ({ ...f, ministroSelecionado: null })); setBuscaMembro(''); }} className="ml-auto text-red-400 hover:text-red-600">✕</button>
                </div>
              )}
              {buscandoMembro && <div className="text-xs text-gray-400 mt-1">Buscando…</div>}
              {resultsMembro.length > 0 && !form.ministroSelecionado && (
                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg max-h-48 overflow-y-auto">
                  {resultsMembro.map(m => (
                    <button
                      key={m.id}
                      onClick={() => selecionarMembro(m)}
                      className="w-full text-left px-4 py-2.5 hover:bg-gray-50 border-b border-gray-100 last:border-0"
                    >
                      <div className="font-semibold text-sm text-gray-900">{m.name}</div>
                      <div className="text-xs text-gray-500">{[m.matricula, m.campo].filter(Boolean).join(' — ')}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Tipo <span className="text-red-500">*</span></label>
                <select
                  value={form.tipo}
                  onChange={e => setForm(f => ({ ...f, tipo: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#123b63]"
                >
                  <option value="">Selecione…</option>
                  {TIPOS_DELIB.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Data</label>
                <input
                  type="date"
                  value={form.data_deliberacao}
                  onChange={e => setForm(f => ({ ...f, data_deliberacao: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#123b63]"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Situação Anterior</label>
                <input
                  value={form.situacao_anterior}
                  onChange={e => setForm(f => ({ ...f, situacao_anterior: e.target.value }))}
                  placeholder="Ex: Evangelista"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#123b63]"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Situação Nova</label>
                <input
                  value={form.situacao_nova}
                  onChange={e => setForm(f => ({ ...f, situacao_nova: e.target.value }))}
                  placeholder="Ex: Pastor"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#123b63]"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Número da Ata</label>
                <input
                  value={form.numero_ata}
                  onChange={e => setForm(f => ({ ...f, numero_ata: e.target.value }))}
                  placeholder="Ex: 12/2026"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#123b63]"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Observação</label>
              <textarea
                value={form.observacao}
                onChange={e => setForm(f => ({ ...f, observacao: e.target.value }))}
                rows={3}
                placeholder="Detalhes adicionais da deliberação…"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#123b63] resize-none"
              />
            </div>

            {erroModal && <p className="text-red-600 text-sm">{erroModal}</p>}

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setModalAberto(false)}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold border border-gray-300 hover:bg-gray-50 transition"
              >Cancelar</button>
              <button
                onClick={handleSalvar}
                disabled={salvandoModal}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold bg-[#123b63] text-white hover:bg-[#0f3154] transition disabled:opacity-50"
              >
                {salvandoModal ? 'Salvando...' : editando ? '💾 Salvar' : '➕ Criar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal Confirmar Aprovação ─────────────────────── */}
      {confirmAprovar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-7 text-center space-y-4">
            <span className="text-5xl block">✅</span>
            <h3 className="text-lg font-black text-gray-900">Aprovar Deliberação?</h3>
            <p className="text-sm text-gray-500">
              <strong>{fmtTipoDelib(confirmAprovar.tipo)}</strong> — {confirmAprovar.ministro_nome}
            </p>
            <p className="text-xs text-gray-400">A deliberação passará para <strong>Aprovado</strong>. A alteração no cadastro só ocorre ao <em>Aplicar</em>.</p>
            {erro && <p className="text-red-600 text-xs">{erro}</p>}
            <div className="flex gap-3">
              <button onClick={() => setConfirmAprovar(null)} className="flex-1 py-2 rounded-xl text-sm font-semibold border border-gray-300 hover:bg-gray-50">Cancelar</button>
              <button onClick={handleAprovar} disabled={agindo} className="flex-1 py-2 rounded-xl text-sm font-bold bg-blue-600 text-white hover:bg-blue-700 transition disabled:opacity-50">
                {agindo ? 'Aprovando...' : '✅ Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal Confirmar Aplicação ──────────────────────── */}
      {confirmAplicar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-7 text-center space-y-4">
            <span className="text-5xl block">🏆</span>
            <h3 className="text-lg font-black text-gray-900">Aplicar Deliberação?</h3>
            <p className="text-sm text-gray-500">
              <strong>{fmtTipoDelib(confirmAplicar.tipo)}</strong> — {confirmAplicar.ministro_nome}
            </p>
            <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              ⚠️ Esta ação irá registrar no <strong>Histórico Ministerial</strong>
              {confirmAplicar.ministro_id ? ' e atualizar o cadastro do ministro' : ''}.
              Não pode ser desfeita.
            </p>
            {erro && <p className="text-red-600 text-xs">{erro}</p>}
            <div className="flex gap-3">
              <button onClick={() => setConfirmAplicar(null)} className="flex-1 py-2 rounded-xl text-sm font-semibold border border-gray-300 hover:bg-gray-50">Cancelar</button>
              <button onClick={handleAplicar} disabled={agindo} className="flex-1 py-2 rounded-xl text-sm font-bold bg-green-600 text-white hover:bg-green-700 transition disabled:opacity-50">
                {agindo ? 'Aplicando...' : '🏆 Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal Confirmar Exclusão ────────────────────────── */}
      {confirmExcluir && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-7 text-center space-y-4">
            <span className="text-5xl block">🗑️</span>
            <h3 className="text-lg font-black text-gray-900">Excluir Deliberação?</h3>
            <p className="text-sm text-gray-500">{fmtTipoDelib(confirmExcluir.tipo)} — {confirmExcluir.ministro_nome}</p>
            {erro && <p className="text-red-600 text-xs">{erro}</p>}
            <div className="flex gap-3">
              <button onClick={() => setConfirmExcluir(null)} className="flex-1 py-2 rounded-xl text-sm font-semibold border border-gray-300 hover:bg-gray-50">Cancelar</button>
              <button onClick={handleExcluir} disabled={agindo} className="flex-1 py-2 rounded-xl text-sm font-bold bg-red-600 text-white hover:bg-red-700 transition disabled:opacity-50">
                {agindo ? 'Excluindo...' : '🗑️ Excluir'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
