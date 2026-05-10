'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import PageLayout from '@/components/PageLayout';
import { useRequireSupabaseAuth } from '@/hooks/useRequireSupabaseAuth';
import { useEventosPerfil } from '@/hooks/useEventosPerfil';
import { createClient } from '@/lib/supabase-client';
import { generateQRCodeToken } from '@/lib/qrcode-token';
import { EventBadge } from '@/components/EventBadge';
import TabHospedagem    from './TabHospedagem';
import TabBackup        from './TabBackup';
import TabProgramacao   from './TabProgramacao';
import TabCertificados  from './TabCertificados';

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
  status: 'programado' | 'realizado' | 'cancelado';
  created_at: string;
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

interface Equipe {
  id: string; evento_id: string; email: string;
  tipo: 'admin' | 'checkin'; ativo: boolean; created_at: string;
}

interface Ministro {
  id: string; nome: string; cpf: string | null;
  celular: string | null; whatsapp: string | null;
  email: string | null; supervisao: string | null; campo: string | null;
  supervisao_id?: string | null; campo_id?: string | null;
}

type TabId = 'inscritos' | 'inscricao-manual' | 'checkin' | 'etiquetas' | 'financeiro' | 'relatorios' | 'comunicacao' | 'equipe' | 'configuracoes' | 'hospedagem' | 'backup' | 'programacao' | 'certificados';

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

const STATUS_PAG_CFG: Record<string, { label: string; cls: string }> = {
  pendente:  { label: 'Pendente',  cls: 'bg-yellow-100 text-yellow-700' },
  pago:      { label: 'Pago',      cls: 'bg-green-100 text-green-700'  },
  isento:    { label: 'Isento',    cls: 'bg-blue-100  text-blue-700'   },
  cancelado: { label: 'Cancelado', cls: 'bg-red-100   text-red-700'    },
};

const STATUS_EV_CFG = {
  programado: { label: 'Programado', cls: 'bg-blue-100 text-blue-700'  },
  realizado:  { label: 'Realizado',  cls: 'bg-green-100 text-green-700'},
  cancelado:  { label: 'Cancelado',  cls: 'bg-red-100 text-red-700'    },
};

const inputCls = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#123b63] bg-white';
const labelCls = 'block text-xs font-semibold text-gray-600 mb-1';

// ─── Componente principal ─────────────────────────────────────────────────
export default function GerenciarEventoPage() {
  const { loading: authLoading } = useRequireSupabaseAuth();
  const perfil = useEventosPerfil();
  const router = useRouter();
  const params = useParams();
  const id = params?.id as string;
  const supabase = useMemo(() => createClient(), []);

  const [evento,     setEvento]     = useState<Evento | null>(null);
  const [inscricoes, setInscricoes] = useState<Inscricao[]>([]);
  const [equipe,     setEquipe]     = useState<Equipe[]>([]);
  const [supervisoes, setSupervisoes] = useState<Supervisao[]>([]);
  const [campos,      setCampos]     = useState<Campo[]>([]);
  const [loadingEvento, setLoadingEvento] = useState(true);
  const [loadingInsc,   setLoadingInsc]   = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>('inscritos');
  const [erro, setErro] = useState<string | null>(null);
  const [acessoNegado, setAcessoNegado] = useState(false);

  // Permissão específica para este evento
  const permissaoNesseEvento = useMemo(
    () => (id && !perfil.loading ? perfil.permissaoParaEvento(id) : null),
    [id, perfil]
  );

  // Abas visíveis baseadas na permissão do usuário neste evento
  const TODAS_TABS: { id: TabId; label: string; icon: string }[] = [
    { id: 'inscritos',        label: 'Inscritos',        icon: '👥' },
    { id: 'inscricao-manual', label: 'Inscrição Manual', icon: '✍️' },
    { id: 'checkin',          label: 'Check-in',          icon: '✅' },
    { id: 'etiquetas',        label: 'Etiquetas',         icon: '🏷️' },
    { id: 'financeiro',       label: 'Financeiro',        icon: '💳' },
    { id: 'relatorios',       label: 'Relatórios',        icon: '📊' },
    { id: 'comunicacao',      label: 'Comunicação',       icon: '📣' },
    { id: 'hospedagem',       label: 'Hospedagem',        icon: '🏨' },
    { id: 'equipe',           label: 'Equipe',            icon: '👤' },
    { id: 'configuracoes',    label: 'Configurações',     icon: '⚙️' },
    { id: 'programacao',      label: 'Programação',       icon: '📋' },
    { id: 'certificados',     label: 'Certificados',       icon: '🎓' },
    { id: 'backup',           label: 'Backup / Exportação', icon: '💾' },
  ];

  const tabsVisiveis = useMemo(() => {
    if (perfil.loading) return TODAS_TABS;
    if (perfil.isGlobal) return TODAS_TABS;
    return TODAS_TABS.filter(t => perfil.tabsPermitidas.includes(t.id));
  }, [perfil.loading, perfil.isGlobal, perfil.tabsPermitidas]);

  // ── Carrega dados base ───────────────────────────────────────
  const fetchEvento = useCallback(async () => {
    if (!id) return;
    setLoadingEvento(true);
    const { data, error } = await supabase.from('eventos').select('*').eq('id', id).single();
    if (error || !data) { setErro('Evento não encontrado.'); setLoadingEvento(false); return; }
    // Gate de departamento: isDeptAdmin só acessa eventos do seu dept
    if (perfil.isDeptAdmin && (data as Evento).departamento !== perfil.departamentoUsuario) {
      setAcessoNegado(true); setLoadingEvento(false); return;
    }
    setEvento(data as Evento);
    setLoadingEvento(false);
  }, [id, supabase, perfil.isDeptAdmin, perfil.departamentoUsuario]);

  const fetchInscricoes = useCallback(async () => {
    if (!id) return;
    setLoadingInsc(true);
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
    if (authLoading || perfil.loading) return;

    // Gate de acesso: bloqueia acesso direto por URL
    if (!perfil.isGlobal && id && !perfil.podeAcessarEvento(id)) {
      setAcessoNegado(true);
      setLoadingEvento(false);
      return;
    }

    // Para perfil checkin, redireciona direto para a aba checkin
    if (!perfil.isGlobal && permissaoNesseEvento === 'checkin') {
      setActiveTab('checkin');
    }

    Promise.all([
      fetchEvento(),
      fetchInscricoes(),
      fetchEquipe(),
      supabase.from('supervisoes').select('id,nome').order('nome').then((r: { data: unknown }) => setSupervisoes((r.data as Supervisao[]) || [])),
      supabase.from('campos').select('id,nome,supervisao_id').order('nome').then((r: { data: unknown }) => setCampos((r.data as Campo[]) || [])),
    ]);
  }, [authLoading, perfil.loading, perfil.isGlobal, perfil.loading, id, permissaoNesseEvento, fetchEvento, fetchInscricoes, fetchEquipe, supabase]);

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
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 mb-6 overflow-hidden">
        <div className="flex flex-col md:flex-row">
          {/* Banner */}
          <div className="md:w-48 md:flex-shrink-0 bg-gradient-to-br from-[#123b63] to-[#1A5276] flex items-center justify-center min-h-[140px]">
            {evento.banner_url
              ? <img src={evento.banner_url} alt={evento.nome} className="w-full h-full object-cover" />
              : <span className="text-6xl select-none">📅</span>
            }
          </div>

          {/* Info */}
          <div className="flex-1 p-6">
            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
              <div>
                <div className="flex flex-wrap gap-2 mb-2">
                  <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${evCfg.cls}`}>{evCfg.label}</span>
                  <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-[#123b63]/10 text-[#123b63]">{evento.departamento}</span>
                  {evento.inscricoes_abertas
                    ? <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700">Inscrições abertas</span>
                    : <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-gray-100 text-gray-500">Inscrições fechadas</span>
                  }
                </div>
                <h1 className="text-xl font-bold text-gray-900 mb-1">{evento.nome}</h1>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-500">
                  <span>📅 {fmtData(evento.data_inicio)} → {fmtData(evento.data_fim)}</span>
                  {(evento.local || evento.cidade) && <span>📍 {[evento.local, evento.cidade].filter(Boolean).join(' — ')}</span>}
                  {evento.supervisao_id && <span>🗂️ {nomeSup(evento.supervisao_id)}</span>}
                  {evento.campo_id      && <span>⛪ {nomeCampo(evento.campo_id)}</span>}
                </div>
              </div>

              {/* Botões header — controlados pelo perfil */}
              <div className="flex flex-wrap gap-2">
                {perfil.podeEditar && (
                  <button onClick={() => router.push(`/eventos/${id}/editar`)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-gray-100 text-gray-700 hover:bg-gray-200 transition">
                    ✏️ Editar
                  </button>
                )}
                <a href={`/inscricao/${evento.slug}`} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-100 text-emerald-700 hover:bg-emerald-200 transition">
                  🌐 Pág. Pública
                </a>
                <a href={`/eventos/${id}/display`} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#0D2B4E] text-white hover:bg-[#0a1e38] transition">
                  📺 Abrir Display
                </a>
                {perfil.podeEditar && (
                  <button className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-gray-100 text-gray-400 cursor-not-allowed" disabled>
                    📊 Relatórios
                  </button>
                )}
              </div>
            </div>

            {/* Stats do header */}
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 mt-5 pt-4 border-t border-gray-100">
              {[
                { label: 'Inscritos',  value: stats.total,     color: 'text-[#123b63]',    show: true },
                { label: 'Pagos',      value: stats.pagos,     color: 'text-emerald-600',  show: true },
                { label: 'Pendentes',  value: stats.pendentes, color: 'text-yellow-600',   show: perfil.podeVerFinanceiro },
                { label: 'Isentos',    value: stats.isentos,   color: 'text-blue-600',     show: perfil.podeVerFinanceiro },
                { label: 'Check-ins',  value: stats.checkins,  color: 'text-purple-600',   show: true },
                { label: 'Etiquetas',  value: stats.etiquetas, color: 'text-gray-600',     show: true },
                { label: 'Arrecadado', value: fmtMoeda(stats.arrecadado), color: 'text-[#F39C12]', show: perfil.podeVerFinanceiro },
              ].filter(s => s.show).map(s => (
                <div key={s.label} className="text-center">
                  <p className="text-xs text-gray-400 mb-0.5">{s.label}</p>
                  <p className={`font-bold text-sm ${s.color}`}>{s.value}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── ABAS ────────────────────────────────────────────────── */}
      <div className="border-b border-gray-300 mb-6">
        <div className="flex overflow-x-auto">
          {tabsVisiveis.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 whitespace-nowrap px-5 py-3 text-sm font-semibold border-b-2 transition ${
                activeTab === tab.id
                  ? 'border-[#123b63] text-[#123b63]'
                  : 'border-transparent text-gray-500 hover:text-gray-800 hover:border-gray-300'
              }`}
            >
              <span>{tab.icon}</span>{tab.label}
              {tab.id === 'inscritos' && (
                <span className={`ml-1 text-xs px-1.5 py-0.5 rounded-full font-bold ${activeTab === tab.id ? 'bg-[#123b63] text-white' : 'bg-gray-200 text-gray-600'}`}>
                  {stats.total}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

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
          nomeSup={nomeSup}
          nomeCampo={nomeCampo}
          supabase={supabase}
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
        <TabComunicacao eventoId={id} />
      )}
      {activeTab === 'hospedagem' && (
        <TabHospedagem eventoId={id} evento={evento} supervisoes={supervisoes} campos={campos} nomeSup={nomeSup} nomeCampo={nomeCampo} supabase={supabase} />
      )}
      {activeTab === 'equipe' && (
        <TabEquipe
          eventoId={id}
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
        <TabProgramacao eventoId={id} podeEditar={perfil.podeEditar} />
      )}
      {activeTab === 'certificados' && (
        <TabCertificados
          eventoId={id}
          eventoNome={evento?.nome ?? ''}
          eventoDataInicio={evento?.data_inicio ?? ''}
          eventoDataFim={evento?.data_fim ?? evento?.data_inicio ?? ''}
          gerarCertificado={(evento as unknown as Record<string, unknown>)?.gerar_certificado === true}
          podeEditar={perfil.podeEditar}
          supervisoes={supervisoes}
          campos={campos}
        />
      )}

    </PageLayout>
  );
}

// ═══════════════════════════════════════════════════════════════
// ABA INSCRITOS
// ═══════════════════════════════════════════════════════════════
function TabInscritos({ inscricoes, loading, supervisoes, campos, nomeSup, nomeCampo, onRefresh, supabase }: {
  inscricoes: Inscricao[]; loading: boolean;
  supervisoes: Supervisao[]; campos: Campo[];
  nomeSup: (id: string | null) => string;
  nomeCampo: (id: string | null) => string;
  onRefresh: () => void;
  supabase: ReturnType<typeof createClient>;
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

  async function baixaManual(inscricao: Inscricao) {
    setSalvando(inscricao.id);
    if (inscricao.lote_id) {
      // Inscrição de lote: atualiza o lote (trigger fn_sync_lote_pagamento cuida das inscrições)
      await supabase.from('evento_lotes_inscricao').update({ status_pagamento: 'pago' }).eq('id', inscricao.lote_id);
    } else {
      await supabase.from('evento_inscricoes').update({ status_pagamento: 'pago', valor_pago: inscricao.valor_pago || 0 }).eq('id', inscricao.id);
    }
    setSalvando(null);
    onRefresh();
  }

  async function marcarEtiqueta(inscricao: Inscricao) {
    setSalvando(inscricao.id);
    await supabase.from('evento_inscricoes').update({ etiqueta_impressa: !inscricao.etiqueta_impressa }).eq('id', inscricao.id);
    setSalvando(null);
    onRefresh();
  }

  async function excluir(id: string) {
    if (!confirm('Excluir esta inscrição?')) return;
    setSalvando(id);
    await supabase.from('evento_inscricoes').delete().eq('id', id);
    setSalvando(null);
    onRefresh();
  }

  const camposFiltrados = filtroSup ? campos.filter(c => c.supervisao_id === filtroSup) : campos;

  if (loading) return <LoadingSkeleton />;

  return (
    <div>
      {/* Filtros */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-4">
        <div className="flex flex-wrap gap-3">
          <input type="text" placeholder="🔍 Buscar nome, CPF, WhatsApp..." value={busca}
            onChange={e => setBusca(e.target.value)}
            className="flex-1 min-w-[200px] border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#123b63]" />
          <select value={filtroSup} onChange={e => { setFiltroSup(e.target.value); setFiltroCampo(''); }}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#123b63]">
            <option value="">Supervisão</option>
            {supervisoes.map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}
          </select>
          <select value={filtroCampo} onChange={e => setFiltroCampo(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#123b63]">
            <option value="">Campo</option>
            {camposFiltrados.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
          <select value={filtroPag} onChange={e => setFiltroPag(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#123b63]">
            <option value="">Pagamento</option>
            <option value="pendente">Pendente</option>
            <option value="pago">Pago</option>
            <option value="isento">Isento</option>
            <option value="cancelado">Cancelado</option>
          </select>
          <select value={filtroCI} onChange={e => setFiltroCI(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#123b63]">
            <option value="">Check-in</option>
            <option value="true">Realizado</option>
            <option value="false">Pendente</option>
          </select>
          <select value={filtroHosp} onChange={e => setFiltroHosp(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#123b63]">
            <option value="">Hospedagem</option>
            <option value="true">Sim</option>
            <option value="false">Não</option>
          </select>
          <select value={filtroAlim} onChange={e => setFiltroAlim(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#123b63]">
            <option value="">Alimentação</option>
            <option value="true">Sim</option>
            <option value="false">Não</option>
          </select>
        </div>
        <p className="text-xs text-gray-500 mt-2">{filtrados.length} resultado(s)</p>
      </div>

      {filtrados.length === 0 ? (
        <EmptyState icon="👥" title="Nenhuma inscrição encontrada" desc="Nenhum inscrito corresponde aos filtros selecionados." />
      ) : (
        <>
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  {['Nome', 'CPF', 'WhatsApp', 'Supervisão', 'Campo', 'Valor', 'Pagamento', 'Check-in', 'Etiq.', 'Cert.', 'Inscrição', 'Ações'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-600 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paginados.map(ins => {
                  const pagCfg = STATUS_PAG_CFG[ins.status_pagamento] ?? STATUS_PAG_CFG.pendente;
                  const isSalvando = salvando === ins.id;
                  return (
                    <tr key={ins.id} className="border-b border-gray-50 hover:bg-gray-50 transition">
                      <td className="px-4 py-3 font-medium text-gray-800 whitespace-nowrap">{ins.nome_inscrito}</td>
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{ins.cpf || '-'}</td>
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{ins.whatsapp || '-'}</td>
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{nomeSup(ins.supervisao_id)}</td>
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{nomeCampo(ins.campo_id)}</td>
                      <td className="px-4 py-3 text-gray-800 font-medium whitespace-nowrap">{fmtMoeda(ins.valor_pago)}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${pagCfg.cls}`}>{pagCfg.label}</span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {ins.checkin_realizado
                          ? <span className="text-xs font-semibold text-emerald-600">✅ {fmtDT(ins.checkin_at)}</span>
                          : <span className="text-xs text-gray-400">—</span>}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-center">
                        {ins.etiqueta_impressa ? '🏷️' : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-center">
                        {ins.certificado_enviado ? '🎓' : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-gray-500 whitespace-nowrap text-xs">{fmtDT(ins.created_at)}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex gap-1">
                          {ins.status_pagamento !== 'pago' && (
                            <button onClick={() => baixaManual(ins)} disabled={isSalvando}
                              className="text-xs px-2 py-1 bg-emerald-100 text-emerald-700 rounded font-semibold hover:bg-emerald-200 transition disabled:opacity-50">
                              💳 Pago
                            </button>
                          )}
                          <button onClick={() => marcarEtiqueta(ins)} disabled={isSalvando}
                            className="text-xs px-2 py-1 bg-gray-100 text-gray-700 rounded font-semibold hover:bg-gray-200 transition disabled:opacity-50">
                            🏷️
                          </button>
                          <button onClick={() => excluir(ins.id)} disabled={isSalvando}
                            className="text-xs px-2 py-1 bg-red-100 text-red-600 rounded font-semibold hover:bg-red-200 transition disabled:opacity-50">
                            🗑️
                          </button>
                        </div>
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
    // busca em members pelo CPF
    const { data } = await supabase
      .from('members')
      .select('id, nome, cpf, celular, whatsapp, email, supervisao, campo, supervisao_id, campo_id')
      .or(`cpf.ilike.%${cpfLimpo}%,cpf.ilike.%${cpfBusca}%`)
      .limit(1);
    setBuscando(false);
    if (data && data.length > 0) {
      const m = data[0] as Ministro;
      setMinistroEnc(m);
      const sup = supervisoes.find(s => s.id === m.supervisao_id || s.nome === m.supervisao);
      const campo = campos.find(c => c.id === m.campo_id || c.nome === m.campo);
      setForm(f => ({
        ...f,
        nome_inscrito: m.nome || '',
        cpf: m.cpf || cpfBusca,
        whatsapp: m.whatsapp || m.celular || '',
        email: m.email || '',
        supervisao_id: sup?.id || '',
        campo_id: campo?.id || '',
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
      const { error } = await supabase.from('evento_inscricoes').insert([{
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
      }]);
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
function TabCheckin({ eventoId, inscricoes, loading, nomeSup, nomeCampo, supabase, onRefresh }: {
  eventoId: string; inscricoes: Inscricao[]; loading: boolean;
  nomeSup: (id: string | null) => string;
  nomeCampo: (id: string | null) => string;
  supabase: ReturnType<typeof createClient>;
  onRefresh: () => void;
}) {
  const [busca,    setBusca]    = useState('');
  const [salvando, setSalvando] = useState<string | null>(null);

  const resultado = useMemo(() => {
    if (!busca.trim()) return [];
    const q = busca.toLowerCase();
    return inscricoes.filter(i =>
      i.nome_inscrito.toLowerCase().includes(q) || (i.cpf || '').includes(busca)
    ).slice(0, 10);
  }, [inscricoes, busca]);

  async function fazerCheckin(inscricao: Inscricao) {
    if (inscricao.checkin_realizado) return;
    setSalvando(inscricao.id);
    const now = new Date().toISOString();
    await supabase.from('evento_inscricoes').update({ checkin_realizado: true, checkin_at: now }).eq('id', inscricao.id);
    await supabase.from('evento_checkins').insert([{ evento_id: eventoId, inscricao_id: inscricao.id, metodo: 'manual' }]);
    setSalvando(null);
    onRefresh();
  }

  if (loading) return <LoadingSkeleton />;

  return (
    <div className="max-w-2xl">
      {/* Botão modo mobile */}
      <div className="bg-gradient-to-r from-[#0D2B4E] to-[#123b63] rounded-xl p-5 mb-6 flex items-center justify-between gap-4">
        <div>
          <p className="text-white font-bold text-base">📱 Modo Check-in Mobile</p>
          <p className="text-white/60 text-xs mt-0.5">Tela otimizada para celular com câmera e scanner QR Code</p>
        </div>
        <a href={`/eventos/${eventoId}/checkin`} target="_blank" rel="noopener noreferrer"
          className="flex-shrink-0 bg-emerald-500 hover:bg-emerald-400 active:scale-95 text-white font-bold py-3 px-5 rounded-xl text-sm transition">
          Abrir ↗
        </a>
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
// ─── Tipos de tamanho para o crachá ──────────────────────────
type EtiquetaSize = 'small' | 'medium';

// ─── Modal de preview do crachá ───────────────────────────────
function BadgeModal({ ins, evento, nomeSup, nomeCampo, onClose }: {
  ins: Inscricao; evento: { id: string; nome: string; departamento: string; data_inicio: string; data_fim: string; local: string | null; cidade: string | null; banner_url: string | null };
  nomeSup: string; nomeCampo: string; onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-bold text-[#123b63] text-base">Pré-visualização do Crachá</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none">✕</button>
        </div>
        <div className="flex justify-center">
          <EventBadge inscricao={ins} evento={evento} nomeSup={nomeSup} nomeCampo={nomeCampo} size="medium" printMode={false} />
        </div>
        <p className="text-center text-xs text-gray-400 mt-4">Clique fora para fechar</p>
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
  const [filtroPag,   setFiltroPag]   = useState('');
  const [filtroSup,   setFiltroSup]   = useState('');
  const [filtroHosp,  setFiltroHosp]  = useState(false);
  const [filtroAlim,  setFiltroAlim]  = useState(false);
  const [size,        setSize]        = useState<EtiquetaSize>('medium');
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [salvando,    setSalvando]    = useState<Set<string>>(new Set());
  const [preview,     setPreview]     = useState<Inscricao | null>(null);
  const [pag,         setPag]         = useState(1);
  const POR_PAG = 48;

  // Supervisões únicas para filtro
  const supsUnicas = useMemo(() => {
    const map = new Map<string, string>();
    inscricoes.forEach(i => { if (i.supervisao_id) map.set(i.supervisao_id, nomeSup(i.supervisao_id)); });
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [inscricoes, nomeSup]);

  // Filtragem
  const filtradas = useMemo(() => {
    let list = inscricoes;
    if (busca.trim())         list = list.filter(i => i.nome_inscrito.toLowerCase().includes(busca.toLowerCase()));
    if (filtroImp === 'impresso')  list = list.filter(i => i.etiqueta_impressa);
    if (filtroImp === 'pendente')  list = list.filter(i => !i.etiqueta_impressa);
    if (filtroPag)            list = list.filter(i => i.status_pagamento === filtroPag);
    if (filtroSup)            list = list.filter(i => i.supervisao_id === filtroSup);
    if (filtroHosp)           list = list.filter(i => i.hospedagem);
    if (filtroAlim)           list = list.filter(i => i.alimentacao);
    return list;
  }, [inscricoes, busca, filtroImp, filtroPag, filtroSup, filtroHosp, filtroAlim]);

  const totalPags = Math.max(1, Math.ceil(filtradas.length / POR_PAG));
  const pagina = useMemo(() => filtradas.slice((pag - 1) * POR_PAG, pag * POR_PAG), [filtradas, pag]);

  // Reset pág ao mudar filtros
  useEffect(() => { setPag(1); }, [busca, filtroImp, filtroPag, filtroSup, filtroHosp, filtroAlim]);

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
    const base = `/eventos/${eventoId}/etiquetas/print?size=${size}`;
    let url = base;
    if (idsParam?.length) url += `&ids=${idsParam.join(',')}`;
    else if (apenas) url += `&apenas=pendentes`;
    window.open(url, '_blank', 'width=900,height=700');
  }

  if (loading) return <LoadingSkeleton />;

  const totalImpressos = inscricoes.filter(i => i.etiqueta_impressa).length;
  const totalPendentes = inscricoes.filter(i => !i.etiqueta_impressa).length;

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
        />
      )}

      {/* ── Stats rápidos ── */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-3 text-center">
          <p className="text-xl font-black text-[#123b63]">{inscricoes.length}</p>
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
        {/* Tamanho */}
        <div className="flex items-center gap-1 border border-gray-200 rounded-lg overflow-hidden">
          <button onClick={() => setSize('small')}  className={`px-3 py-1.5 text-xs font-semibold transition ${size === 'small'  ? 'bg-[#123b63] text-white' : 'text-gray-600 hover:bg-gray-50'}`}>Térmica</button>
          <button onClick={() => setSize('medium')} className={`px-3 py-1.5 text-xs font-semibold transition ${size === 'medium' ? 'bg-[#123b63] text-white' : 'text-gray-600 hover:bg-gray-50'}`}>Crachá</button>
        </div>

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
          className="border border-gray-200 rounded-lg px-3 py-2 text-xs w-44 focus:outline-none focus:ring-2 focus:ring-[#123b63]" />

        <select value={filtroImp} onChange={e => setFiltroImp(e.target.value as typeof filtroImp)}
          className="border border-gray-200 rounded-lg px-2 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-[#123b63]">
          <option value="todos">Todos</option>
          <option value="pendente">Não impressos</option>
          <option value="impresso">Impressos</option>
        </select>

        <select value={filtroPag} onChange={e => setFiltroPag(e.target.value)}
          className="border border-gray-200 rounded-lg px-2 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-[#123b63]">
          <option value="">Qualquer pagamento</option>
          <option value="pago">Pago</option>
          <option value="pendente">Pendente</option>
          <option value="isento">Isento</option>
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

        {(busca || filtroImp !== 'todos' || filtroPag || filtroSup || filtroHosp || filtroAlim) && (
          <button onClick={() => { setBusca(''); setFiltroImp('todos'); setFiltroPag(''); setFiltroSup(''); setFiltroHosp(false); setFiltroAlim(false); }}
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

                {/* Preview do crachá (clicável) */}
                <div className="cursor-pointer p-3 flex justify-center" onClick={() => setPreview(ins)}>
                  {evento ? (
                    <EventBadge inscricao={ins} evento={evento} nomeSup={nomeSup(ins.supervisao_id)} nomeCampo={nomeCampo(ins.campo_id)} size="small" printMode={false} />
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
                    onClick={() => abrirImpressao([ins.id])}
                    className="flex-1 text-xs py-1.5 rounded-lg font-medium bg-[#123b63] text-white hover:bg-[#0f2a45] transition">
                    🖨️ Imprimir
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
function TabFinanceiro({ inscricoes, loading, stats, nomeSup, nomeCampo, supabase, onRefresh }: {
  inscricoes: Inscricao[]; loading: boolean;
  stats: { total: number; pagos: number; pendentes: number; isentos: number; arrecadado: number };
  nomeSup: (id: string | null) => string;
  nomeCampo: (id: string | null) => string;
  supabase: ReturnType<typeof createClient>;
  onRefresh: () => void;
}) {
  const [filtro, setFiltro] = useState('');
  const [salvando, setSalvando] = useState<string | null>(null);

  const filtradas = useMemo(() =>
    filtro ? inscricoes.filter(i => i.status_pagamento === filtro) : inscricoes,
    [inscricoes, filtro]
  );

  async function baixaManual(ins: Inscricao) {
    if (!confirm(`Confirmar baixa manual para ${ins.nome_inscrito}?`)) return;
    setSalvando(ins.id);
    if (ins.lote_id) {
      // Inscrição de lote: atualiza o lote (trigger fn_sync_lote_pagamento cuida das inscrições)
      await supabase.from('evento_lotes_inscricao').update({ status_pagamento: 'pago' }).eq('id', ins.lote_id);
    } else {
      await supabase.from('evento_inscricoes').update({ status_pagamento: 'pago' }).eq('id', ins.id);
    }
    setSalvando(null);
    onRefresh();
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
        <div className="p-4 border-b border-gray-100 flex items-center gap-3">
          <h3 className="font-bold text-[#123b63] flex-1">Movimentações</h3>
          <select value={filtro} onChange={e => setFiltro(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white">
            <option value="">Todos</option>
            <option value="pago">Pago</option>
            <option value="pendente">Pendente</option>
            <option value="isento">Isento</option>
            <option value="cancelado">Cancelado</option>
          </select>
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
                    {ins.status_pagamento !== 'pago' && (
                      <button onClick={() => baixaManual(ins)} disabled={salvando === ins.id}
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
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// ABA EQUIPE
// ═══════════════════════════════════════════════════════════════
function TabEquipe({ eventoId, equipe, supabase, onRefresh }: {
  eventoId: string; equipe: Equipe[];
  supabase: ReturnType<typeof createClient>;
  onRefresh: () => void;
}) {
  const [email,    setEmail]    = useState('');
  const [tipo,     setTipo]     = useState<'admin' | 'checkin'>('checkin');
  const [salvando, setSalvando] = useState(false);
  const [erro,     setErro]     = useState<string | null>(null);

  async function adicionar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    if (!email.trim()) return setErro('E-mail obrigatório.');
    setSalvando(true);
    const { error } = await supabase.from('evento_equipe').insert([{ evento_id: eventoId, email: email.trim(), tipo, ativo: true }]);
    setSalvando(false);
    if (error) return setErro('Erro: ' + error.message);
    setEmail('');
    onRefresh();
  }

  async function toggleAtivo(eq: Equipe) {
    await supabase.from('evento_equipe').update({ ativo: !eq.ativo }).eq('id', eq.id);
    onRefresh();
  }

  async function remover(id: string) {
    if (!confirm('Remover este operador?')) return;
    await supabase.from('evento_equipe').delete().eq('id', id);
    onRefresh();
  }

  return (
    <div className="max-w-2xl">
      {/* Adicionar */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
        <h3 className="font-bold text-[#123b63] mb-4">➕ Adicionar Operador</h3>
        {erro && <div className="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</div>}
        <form onSubmit={adicionar} className="flex flex-col sm:flex-row gap-3">
          <input type="email" placeholder="email@exemplo.com" value={email}
            onChange={e => setEmail(e.target.value)}
            className={inputCls + ' flex-1'} required />
          <select value={tipo} onChange={e => setTipo(e.target.value as 'admin' | 'checkin')}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white">
            <option value="checkin">Check-in</option>
            <option value="admin">Admin</option>
          </select>
          <button type="submit" disabled={salvando}
            className="bg-[#123b63] text-white px-5 py-2 rounded-lg text-sm font-semibold hover:bg-[#0f2a45] transition disabled:opacity-50">
            {salvando ? 'Salvando...' : 'Adicionar'}
          </button>
        </form>
      </div>

      {/* Lista */}
      {equipe.length === 0 ? (
        <EmptyState icon="👤" title="Nenhum operador cadastrado" desc="Adicione operadores para o evento acima." />
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                {['E-mail', 'Tipo', 'Status', 'Ações'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-600">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {equipe.map(eq => (
                <tr key={eq.id} className="border-b border-gray-50 hover:bg-gray-50 transition">
                  <td className="px-4 py-3 text-gray-800">{eq.email}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${eq.tipo === 'admin' ? 'bg-[#123b63]/10 text-[#123b63]' : 'bg-gray-100 text-gray-600'}`}>
                      {eq.tipo === 'admin' ? 'Admin' : 'Check-in'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${eq.ativo ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                      {eq.ativo ? 'Ativo' : 'Inativo'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <button onClick={() => toggleAtivo(eq)}
                        className="text-xs px-2 py-1 bg-gray-100 text-gray-700 rounded font-semibold hover:bg-gray-200 transition">
                        {eq.ativo ? 'Desativar' : 'Ativar'}
                      </button>
                      <button onClick={() => remover(eq.id)}
                        className="text-xs px-2 py-1 bg-red-100 text-red-600 rounded font-semibold hover:bg-red-200 transition">
                        Remover
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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

function TabComunicacao({ eventoId }: { eventoId: string }) {
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
  const urlPublica = `${typeof window !== 'undefined' ? window.location.origin : ''}/inscricao/${evento.slug}`;

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
          setTipos(t.map(x => ({ ...x, valor: String(x.valor) })));
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
            <a href={`/eventos/${evento.id}/editar`}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-gray-100 text-gray-700 hover:bg-gray-200 transition">
              ✏️ Editar
            </a>
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
            <a href={`/eventos/${evento.id}/editar`}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-gray-100 text-gray-700 hover:bg-gray-200 transition">
              ✏️ Editar limites
            </a>
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
                        <input type="checkbox" checked={t.ativo}
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
                        <input type="checkbox" checked={t.inclui_alimentacao}
                          onChange={e => setTipos(prev => prev.map((x, j) => j===i ? {...x, inclui_alimentacao: e.target.checked} : x))}
                          className="accent-[#123b63]" disabled={!podeEditar || !t.ativo} />
                        <span className="text-xs text-gray-600">🍽️ Aliment.</span>
                      </label>
                      {/* Inclui Hospedagem */}
                      <label className="flex items-center gap-1 cursor-pointer shrink-0">
                        <input type="checkbox" checked={t.inclui_hospedagem}
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
            <a href={`/eventos/${evento.id}/editar`}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-gray-100 text-gray-700 hover:bg-gray-200 transition">
              ✏️ Editar
            </a>
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
                {podeEditar && <a href={`/eventos/${evento.id}/editar`} className="ml-2 text-[#123b63] underline">→ Editar</a>}
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
                {podeEditar && <a href={`/eventos/${evento.id}/editar`} className="ml-2 text-[#123b63] underline">→ Editar</a>}
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
