'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useRequireSupabaseAuth } from '@/hooks/useRequireSupabaseAuth';
import { useEventosPerfil } from '@/hooks/useEventosPerfil';
import { createClient } from '@/lib/supabase-client';
import { clearEquipeSession } from '@/lib/equipe-session';
import { generateQRCodeToken } from '@/lib/qrcode-token';
import { normalizePayloadUppercase } from '@/lib/text';
import { EventBadge } from '@/components/EventBadge';
import { authenticatedFetch } from '@/lib/api-client';
import { parseCampoMissionarioConfig } from '@/lib/ago-regras';
import { resolveGrupoHospedagemAGO } from '@/lib/hospedagem-helpers';
import {
  filtrarTiposAgo,
  findTipoEsposaJubilado,
  findTipoPastorJubilado,
} from '@/lib/ago-inscricao-regras';

// ─── Tipos ────────────────────────────────────────────────────────────────
interface Supervisao { id: string; nome: string; }
interface Campo      { id: string; nome: string; supervisao_id: string; is_campo_missionario?: boolean; }

interface FormEsposa { nome: string; cpf: string; data_nascimento: string; whatsapp: string; }
interface HospEsposa {
  solicitar: boolean;
  hosp_necessidade_especial: boolean; hosp_descricao_necessidade: string;
  hosp_cama_inferior: boolean; hosp_observacoes: string;
  hosp_possui_comorbidade: boolean; hosp_descricao_comorbidade: string;
  grupo_hospedagem: string;
}
const FORM_ESPOSA_VAZIO: FormEsposa = { nome: '', cpf: '', data_nascimento: '', whatsapp: '' };
const HOSP_ESPOSA_VAZIO: HospEsposa = { solicitar: false, hosp_necessidade_especial: false, hosp_descricao_necessidade: '', hosp_cama_inferior: false, hosp_observacoes: '', hosp_possui_comorbidade: false, hosp_descricao_comorbidade: '', grupo_hospedagem: '' };

interface Evento {
  id: string; nome: string; slug: string; departamento: string;
  data_inicio: string; data_fim: string; local: string | null; cidade: string | null;
  banner_url: string | null; valor_inscricao: number;
  permite_hospedagem: boolean; permite_alimentacao: boolean; permite_brinde: boolean;
  limite_vagas: number | null; limite_hospedagem: number | null; limite_brindes: number | null;
  inscricoes_abertas: boolean; status: string; usar_tipos_inscricao: boolean;
  gerar_certificado: boolean;
  configuracoes_ago?: { habilitar_desconto_campo_missionario?: boolean; valor_pastor_presidente_campo_missionario?: number | string; campo_missionario?: { enabled?: boolean; valor_pastor_presidente?: number | string; valor_esposa?: number | string; } | null; } | null;
}

interface TipoInscricao {
  id: string; nome: string; valor: number;
  inclui_alimentacao: boolean; inclui_hospedagem: boolean;
}

interface MinistroInfo {
  nome: string;
  matricula: string | null;
  cargoMinisterial: string | null;
  isPastorPresidente: boolean;
  isPastorAuxiliar: boolean;
  isJubilado: boolean;
  status: string | null;
  supervisao_id: string | null;
  campo_id: string | null;
  isCampoMissionario: boolean;
}

interface InscricaoSalva {
  id: string; nome_inscrito: string; cpf: string | null;
  supervisao_id: string | null; campo_id: string | null;
  status_pagamento: string; hospedagem: boolean; alimentacao: boolean; brinde: boolean;
  qr_code: string | null; checkin_realizado: boolean;
}

interface InscricaoResumo {
  id: string;
  lote_id?: string | null;
  lote?: any;
  responsavel_pagamento?: boolean | null;
  nome_inscrito: string;
  cpf: string | null;
  whatsapp: string | null;
  email: string | null;
  supervisao_id: string | null;
  campo_id: string | null;
  tipo_inscricao: string | null;
  valor_original?: number | null;
  valor_final: number | null;
  valor_pago: number | null;
  status_pagamento: string;
  forma_pagamento: string | null;
  hospedagem: boolean;
  alimentacao: boolean;
  asaas_payment_id: string | null;
  invoice_url: string | null;
  checkin_realizado: boolean;
  checkin_at: string | null;
  etiqueta_impressa: boolean;
  certificado_enviado: boolean;
  created_at: string;
}

interface DadosOperacionais {
  tipoInscricao: string | null;
  valorInscricao: number | null;
  statusPagamento: string;
  hospedagem: boolean;
  statusHospedagem: string | null;
  grupoHospedagem: string | null;
  alojamentoNome: string | null;
  tipoLeito: string | null;
  posicaoLeito: string | null;
  numeroLeito: string | null;
  checkinAt: string | null;
  checkoutAt: string | null;
  alimentacao: boolean;
  refeicoesTotal: number | null;
  refeicoesUsadas: number | null;
  refeicoesSaldo: number | null;
  lote_id?: string | null;
  loteTotal?: number | null;
  formaPagamento?: string | null;
  loteCodigo?: string | null;
  loteCount?: number;
  valorOriginal?: number | null;
}

interface EditFormBalcao {
  nome_inscrito: string;
  cpf: string;
  email: string;
  whatsapp: string;
  supervisao_id: string;
  campo_id: string;
}

interface FormState {
  nome: string; cpf: string; email: string;
  whatsapp: string; sexo: string;
  data_nascimento: string;
  supervisao_id: string; campo_id: string;
  hospedagem: boolean; brinde: boolean;
  tipo_id: string;
  cupom: string;
  forma_pagamento: string; // 'dinheiro' | 'pix_manual' | 'cartao' | 'isento' | 'asaas'
  observacoes: string;
  // Campos hospedagem AGO
  hosp_necessidade_especial: boolean;
  hosp_descricao_necessidade: string;
  hosp_cama_inferior: boolean;
  hosp_possui_comorbidade: boolean;
  hosp_descricao_comorbidade: string;
  hosp_observacoes: string;
}

type BalcaoTab = 'nova' | 'inscritos' | 'caixa';

const FORM_VAZIO: FormState = {
  nome: '', cpf: '', email: '', whatsapp: '', sexo: '',
  data_nascimento: '',
  supervisao_id: '', campo_id: '',
  hospedagem: false, brinde: false,
  tipo_id: '', cupom: '', forma_pagamento: 'dinheiro', observacoes: '',
  hosp_necessidade_especial: false,
  hosp_descricao_necessidade: '',
  hosp_cama_inferior: false,
  hosp_possui_comorbidade: false,
  hosp_descricao_comorbidade: '',
  hosp_observacoes: '',
};

// ─── Helpers ──────────────────────────────────────────────────────────────
const fmtMoeda = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const inputCls =
  'w-full border border-gray-600 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#F39C12] bg-[#1a3050] text-white placeholder-gray-400';
const labelCls = 'block text-xs font-semibold text-gray-300 mb-1 uppercase tracking-wide';

const PAGAMENTO_CFG: Record<string, { label: string; cls: string }> = {
  pendente:  { label: 'Pendente',  cls: 'bg-amber-500/20 text-amber-300' },
  pago:      { label: 'Pago',      cls: 'bg-emerald-500/20 text-emerald-300' },
  isento:    { label: 'Isento',    cls: 'bg-blue-500/20 text-blue-300' },
  cancelado: { label: 'Cancelado', cls: 'bg-red-500/20 text-red-300' },
};

// ─── Componente principal ──────────────────────────────────────────────────
export default function BalcaoPage() {
  const { loading: authLoading } = useRequireSupabaseAuth();
  const perfil = useEventosPerfil();
  const router = useRouter();
  const params = useParams();
  const id = params?.id as string;
  const supabase = useMemo(() => createClient(), []);
  const handleSair = useCallback(async () => {
    clearEquipeSession();
    await supabase.auth.signOut();
    router.replace(`/eventos/${id}/operador`);
  }, [id, router, supabase]);
  const permissaoEvento = useMemo(() => (id ? perfil.permissaoParaEvento(id) : null), [id, perfil]);
  const podeCheckinManual = perfil.isGlobal || perfil.isDeptAdmin || permissaoEvento === 'admin_evento' || permissaoEvento === 'operador';

  // ── Estado geral ──────────────────────────────────────────
  const [evento,      setEvento]      = useState<Evento | null>(null);
  const [supervisoes, setSupervisoes] = useState<Supervisao[]>([]);
  const [campos,      setCampos]      = useState<Campo[]>([]);
  const [tipos,       setTipos]       = useState<TipoInscricao[]>([]);
  const [vagasPorGrupo, setVagasPorGrupo] = useState<Record<string, number>>({});
  const [loadingInit, setLoadingInit] = useState(true);
  const [acessoNegado, setAcessoNegado] = useState(false);
  const [activeTab, setActiveTab] = useState<BalcaoTab>('nova');

  // ── Estado do Meu Caixa ──────────────────────────────────
  const [caixaSessao, setCaixaSessao] = useState<any | null>(null);
  const [caixaResumo, setCaixaResumo] = useState<any | null>(null);
  const [caixaTimeline, setCaixaTimeline] = useState<any[]>([]);
  const [carregandoCaixa, setCarregandoCaixa] = useState(true);

  // ── Estado do Registro de Sangria ─────────────────────────
  const [modalSangriaAberto, setModalSangriaAberto] = useState(false);
  const [sangriaValor, setSangriaValor] = useState('');
  const [sangriaRetiradoPor, setSangriaRetiradoPor] = useState('');
  const [sangriaRecebidoPor, setSangriaRecebidoPor] = useState('');
  const [sangriaObservacao, setSangriaObservacao] = useState('');
  const [registrandoSangria, setRegistrandoSangria] = useState(false);
  const [sangriaErro, setSangriaErro] = useState<string | null>(null);
  const [sangriaSucesso, setSangriaSucesso] = useState(false);

  // ── Estado do Modal de Efetivar Pagamento Presencial ──
  const [modalPagarPresencialAberto, setModalPagarPresencialAberto] = useState(false);
  const [pagPresencialInscricao, setPagPresencialInscricao] = useState<InscricaoResumo | null>(null);
  const [pagPresencialForma, setPagPresencialForma] = useState('dinheiro');
  const [pagPresencialValor, setPagPresencialValor] = useState(0);
  const [pagPresencialObservacao, setPagPresencialObservacao] = useState('');
  const [processandoPagPresencial, setProcessandoPagPresencial] = useState(false);
  const [pagPresencialErro, setPagPresencialErro] = useState<string | null>(null);

  // ── Estado da lista de inscritos ─────────────────────────
  const [inscricoesLista, setInscricoesLista] = useState<InscricaoResumo[]>([]);
  const [loadingLista, setLoadingLista] = useState(false);
  const [listaErro, setListaErro] = useState<string | null>(null);
  const [buscaLista, setBuscaLista] = useState('');
  const [filtroPag, setFiltroPag] = useState('');
  const [filtroSup, setFiltroSup] = useState('');
  const [filtroCampo, setFiltroCampo] = useState('');
  const [pagina, setPagina] = useState(1);
  const POR_PAG = 50;

  useEffect(() => {
    setPagina(1);
  }, [buscaLista, filtroPag, filtroSup, filtroCampo]);
  const [destacarId, setDestacarId] = useState<string | null>(null);
  const [listaMsg, setListaMsg] = useState<{ tipo: 'ok' | 'erro' | 'aviso'; texto: string } | null>(null);
  const [enviandoEmail, setEnviandoEmail] = useState<Record<string, boolean>>({});
  const [enviandoCert, setEnviandoCert] = useState<Record<string, boolean>>({});
  const [marcandoEtiqueta, setMarcandoEtiqueta] = useState<Record<string, boolean>>({});
  const [checkinManual, setCheckinManual] = useState<Record<string, boolean>>({});
  const [editando, setEditando] = useState<InscricaoResumo | null>(null);
  const [editForm, setEditForm] = useState<EditFormBalcao | null>(null);
  const [salvandoEdit, setSalvandoEdit] = useState(false);
  const [erroEdit, setErroEdit] = useState<string | null>(null);
  const [dadosOperacionais, setDadosOperacionais] = useState<DadosOperacionais | null>(null);
  const [carregandoDadosOperacionais, setCarregandoDadosOperacionais] = useState(false);
  const [precisaAtualizar, setPrecisaAtualizar] = useState(false);
  const ignorarProximoClearRef = useRef(false);

  // ── Estado do formulário ──────────────────────────────────
  const [form,       setForm]       = useState<FormState>(FORM_VAZIO);
  const [cpfBusca,   setCpfBusca]   = useState('');
  const [buscando,   setBuscando]   = useState(false);
  const [ministroEncontrado, setMinistroEncontrado] = useState(false);
  const [nomeMinistro, setNomeMinistro] = useState('');
  // Alerta de CPF já inscrito neste evento
  const [inscricaoDuplicada, setInscricaoDuplicada] = useState<{ id: string; nome: string } | null>(null);
  const [ministroInfo,             setMinistroInfo]             = useState<MinistroInfo | null>(null);
  const [esposaJubiladoAuto, setEsposaJubiladoAuto] = useState<{ ministroId: string | null; ministroNome: string | null } | null>(null);
  const [cpfStatus,                setCpfStatus]                = useState<'idle' | 'encontrado' | 'nao_encontrado'>('idle');
  const [descontoCampoMissionario, setDescontoCampoMissionario] = useState(false);

  // AGO Campo Missionário — esposa
  const [incluirEsposa, setIncluirEsposa] = useState(false);
  const [formEsposa, setFormEsposa] = useState<FormEsposa>({ ...FORM_ESPOSA_VAZIO });
  const [hospEsposa, setHospEsposa] = useState<HospEsposa>({ ...HOSP_ESPOSA_VAZIO });

  // Equipe de Apoio
  const [equipeApoioSelecionada, setEquipeApoioSelecionada] = useState('Cozinha');
  const [equipesApoio, setEquipesApoio] = useState<string[]>([
    'Cozinha', 'Hospedagem', 'Recepcionista', 'Secretaria', 'Som e Imagem', 'Segurança', 'Mídia'
  ]);

  // ── Estado do cupom ───────────────────────────────────────
  const [cupomStatus,   setCupomStatus]   = useState<'idle' | 'validando' | 'ok' | 'erro'>('idle');
  const [cupomDesconto, setCupomDesconto] = useState(0);
  const [cupomMsg,      setCupomMsg]      = useState('');

  // Inclui serviços do tipo selecionado
  const tipoSel = useMemo(
    () => tipos.find(t => t.id === form.tipo_id) ?? null,
    [form.tipo_id, tipos]
  );

  // ── Estado de valores ─────────────────────────────────────
  const valorBase = useMemo(() => {
    return tipoSel?.valor ?? (evento?.valor_inscricao ?? 0);
  }, [tipoSel, evento]);

  const valorFinal = Math.max(0, valorBase - cupomDesconto);
  // Valor da esposa (Campo Missionário)
  const valorEsposaBase = useMemo(() => {
    if (!evento?.configuracoes_ago) return 0;
    const cmConfig = parseCampoMissionarioConfig(evento.configuracoes_ago);
    if (!cmConfig) return 0;
    return typeof cmConfig.valor_esposa === 'number' ? cmConfig.valor_esposa : parseFloat(String(cmConfig.valor_esposa)) || 0;
  }, [evento]);

  // ── Perfil ministerial AGO + filtragem de categorias ─────
  const tipoJubiladoAutomatico = useMemo(() => findTipoPastorJubilado(tipos), [tipos]);
  const tipoEsposaJubiladoAutomatico = useMemo(() => findTipoEsposaJubilado(tipos), [tipos]);
  const jubiladoAutomaticoAtivo = !!(evento?.departamento === 'AGO' && ministroInfo?.isJubilado);
  const esposaJubiladoAutomaticoAtivo = !!(evento?.departamento === 'AGO' && esposaJubiladoAuto);

  const { ministroAtivo, ministroInativo, tiposParaExibir, ministroSemPerfil } = useMemo(() => {
    const ativo = cpfStatus === 'encontrado' && ministroInfo !== null &&
      ['active', 'ativo'].includes((ministroInfo.status ?? '').toLowerCase());
    const inativo = cpfStatus === 'encontrado' && ministroInfo !== null && !ativo;

    const virtualEquipeApoio: TipoInscricao = {
      id: 'equipe_apoio',
      nome: 'Equipe de Apoio',
      valor: 0,
      inclui_alimentacao: false,
      inclui_hospedagem: false,
    };

    if (!evento || evento.departamento !== 'AGO') {
      return { ministroAtivo: ativo, ministroInativo: inativo, tiposParaExibir: [...tipos, virtualEquipeApoio] };
    }

    if (esposaJubiladoAutomaticoAtivo && tipoEsposaJubiladoAutomatico) {
      return {
        ministroAtivo: false,
        ministroInativo: false,
        tiposParaExibir: [tipoEsposaJubiladoAutomatico, virtualEquipeApoio],
        ministroSemPerfil: false,
      };
    }

    if (jubiladoAutomaticoAtivo && tipoJubiladoAutomatico) {
      return {
        ministroAtivo: ativo,
        ministroInativo: inativo,
        tiposParaExibir: [tipoJubiladoAutomatico, virtualEquipeApoio],
        ministroSemPerfil: false,
      };
    }

    const filtered = filtrarTiposAgo(tipos, {
      sexo: form.sexo,
      dataNascimento: form.data_nascimento,
      permitirViuvaEEsposaJubilado: true,
      permitirJubiladoManual: false,
      cpfLocalizado: cpfStatus === 'encontrado',
      ministroAtivo: ativo,
      cargoMinisterial: ministroInfo?.cargoMinisterial ?? null,
      pastorPresidente: !!ministroInfo?.isPastorPresidente,
      pastorAuxiliar: !!ministroInfo?.isPastorAuxiliar,
      jubilado: !!ministroInfo?.isJubilado,
      isCampoMissionario: !!ministroInfo?.isCampoMissionario,
    });

    // Ministro ativo mas sem nenhum tipo ministerial compatível → perfil indefinido
    const semPerfil = ativo && filtered.length === 0;
    return { ministroAtivo: ativo, ministroInativo: inativo, tiposParaExibir: [...filtered, virtualEquipeApoio], ministroSemPerfil: semPerfil };
  }, [cpfStatus, ministroInfo, form.sexo, form.data_nascimento, tipos, evento, jubiladoAutomaticoAtivo, tipoJubiladoAutomatico, esposaJubiladoAutomaticoAtivo, tipoEsposaJubiladoAutomatico]);

  useEffect(() => {
    if (!jubiladoAutomaticoAtivo || !tipoJubiladoAutomatico) return;
    if (form.tipo_id === tipoJubiladoAutomatico.id) return;
    setField('tipo_id', tipoJubiladoAutomatico.id);
  }, [jubiladoAutomaticoAtivo, tipoJubiladoAutomatico, form.tipo_id]);

  useEffect(() => {
    if (!esposaJubiladoAutomaticoAtivo || !tipoEsposaJubiladoAutomatico) return;
    if (form.tipo_id === tipoEsposaJubiladoAutomatico.id) return;
    setField('tipo_id', tipoEsposaJubiladoAutomatico.id);
  }, [esposaJubiladoAutomaticoAtivo, tipoEsposaJubiladoAutomatico, form.tipo_id]);

  const grupoHospedagemPrevisto = resolveGrupoHospedagemAGO({
    sexo: form.sexo || null,
    data_nascimento: form.data_nascimento || null,
    tipo_inscricao: tipoSel?.nome || null,
    hosp_necessidade_especial: form.hosp_necessidade_especial,
    hosp_possui_comorbidade: form.hosp_possui_comorbidade,
  });
  const grupoHospedagemEsposaPrevisto = resolveGrupoHospedagemAGO({
    sexo: 'F',
    data_nascimento: formEsposa.data_nascimento || null,
    tipo_inscricao: 'Esposa de Pastor Presidente Campo Missionário',
    hosp_necessidade_especial: hospEsposa.hosp_necessidade_especial,
    hosp_possui_comorbidade: hospEsposa.hosp_possui_comorbidade,
  });

  const temTipos = (evento?.usar_tipos_inscricao ?? false) && tiposParaExibir.length > 0;
  const podeHospedagem = useMemo(() => {
    if (form.tipo_id === 'equipe_apoio') return false;
    return !!evento?.permite_hospedagem && (
      evento.departamento === 'AGO'
        ? true
        : (tipoSel ? !!tipoSel.inclui_hospedagem : !temTipos)
    );
  }, [evento, tipoSel, temTipos, form.tipo_id]);

  // ── Estado pós-inscrição ──────────────────────────────────
  const [salvando,      setSalvando]      = useState(false);
  const [erroSave,      setErroSave]      = useState<string | null>(null);
  const [inscricaoSalva, setInscricaoSalva] = useState<InscricaoSalva | null>(null);
  const [contadorTotal,  setContadorTotal]  = useState(0);
  const [asaasData,      setAsaasData]      = useState<{ invoiceUrl?: string; pixCopiaECola?: string; valor: number } | null>(null);

  // ── Refs para foco ────────────────────────────────────────
  const cpfRef    = useRef<HTMLInputElement>(null);
  const nomeRef   = useRef<HTMLInputElement>(null);
  const supRef    = useRef<HTMLSelectElement>(null);
  const listaMsgTimeoutRef = useRef<number | null>(null);

  // ─────────────────────────────────────────────────────────
  // Inicialização
  // ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (authLoading || perfil.loading) return;
    if (!id) return;

    // Gate de permissão: checkin não pode acessar balcão
    if (!perfil.isGlobal) {
      const perm = perfil.permissaoParaEvento(id);
      if (!perm || perm === 'checkin') {
        setAcessoNegado(true);
        setLoadingInit(false);
        return;
      }
    }

    async function init() {
      try {
        const [
          { data: ev },
          estruturaRes,
          { data: tps },
        ] = await Promise.all([
          supabase.from('eventos').select(
            'id,nome,slug,departamento,data_inicio,data_fim,local,cidade,banner_url,valor_inscricao,permite_hospedagem,permite_alimentacao,permite_brinde,limite_vagas,limite_hospedagem,limite_brindes,inscricoes_abertas,status,usar_tipos_inscricao,gerar_certificado,configuracoes_ago'
          ).eq('id', id).single(),
          authenticatedFetch('/api/v1/estrutura'),
          supabase.from('evento_tipos_inscricao').select('id,nome,valor,inclui_alimentacao,inclui_hospedagem').eq('evento_id', id).eq('ativo', true).order('ordem'),
        ]);
        // Gate de departamento: isDeptAdmin só acessa eventos do seu dept (exceto subcategoria TODOS)
        if (ev && perfil.isDeptAdmin && perfil.departamentoUsuario !== 'TODOS' && (ev as Evento).departamento !== perfil.departamentoUsuario) {
          setAcessoNegado(true); setLoadingInit(false); return;
        }

        setEvento(ev as Evento);
        if (ev) {
          const config = (ev as any).configuracoes_ago || {};
          const equipes = config.equipes_apoio || ['Cozinha', 'Hospedagem', 'Recepcionista', 'Secretaria', 'Som e Imagem', 'Segurança', 'Mídia'];
          setEquipesApoio(equipes);
          if (equipes.length > 0) {
            setEquipeApoioSelecionada(equipes[0]);
          }
        }
        if (estruturaRes.ok) {
          const estrutura = await estruturaRes.json().catch(() => null as any);
          setSupervisoes((estrutura?.supervisoes as Supervisao[]) || []);
          setCampos((estrutura?.campos as Campo[]) || []);
        }
        setTipos((tps ?? []) as TipoInscricao[]);

        if (ev) {
          fetch(`/api/public/evento?slug=${(ev as Evento).slug}`)
            .then(r => r.json())
            .then(data => {
              if (data?.vagasPorGrupo) {
                setVagasPorGrupo(data.vagasPorGrupo);
              }
            })
            .catch(() => {});
        }

        // Se há exatamente um tipo, pré-selecionar (somente quando evento usa tipos)
        if (ev && (ev as Evento).usar_tipos_inscricao && tps && tps.length === 1) {
          setForm(f => ({ ...f, tipo_id: tps[0].id }));
        }
      } finally {
        setLoadingInit(false);
      }
    }
    init();
  }, [authLoading, perfil.loading, perfil.isGlobal, perfil.isDeptAdmin, perfil.departamentoUsuario, id, supabase]);

  // ─────────────────────────────────────────────────────────
  // Atalhos de teclado globais
  // ─────────────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Esc = limpar formulário (apenas se não estiver na tela de confirmação)
      if (e.key === 'Escape' && !inscricaoSalva) {
        e.preventDefault();
        limparTudo();
      }
      // Ctrl+Enter = salvar
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        document.getElementById('btn-confirmar')?.click();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [inscricaoSalva]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Funções do Meu Caixa ──────────────────────────────────
  const carregarCaixaDados = useCallback(async () => {
    if (!id) return;
    try {
      const res = await fetch(`/api/eventos/${id}/caixa/resumo`);
      if (res.ok) {
        const json = await res.json();
        if (json.ok) {
          setCaixaSessao(json.sessao);
          setCaixaResumo(json.resumo);
          setCaixaTimeline(json.timeline || []);
        }
      }
    } catch (err) {
      console.error('Erro ao carregar resumo de caixa:', err);
    } finally {
      setCarregandoCaixa(false);
    }
  }, [id]);

  const executarSangria = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id || !caixaSessao) return;

    const valorNum = parseFloat(sangriaValor);
    if (isNaN(valorNum) || valorNum <= 0) {
      setSangriaErro('O valor da sangria precisa ser maior que zero.');
      return;
    }

    if (!sangriaRetiradoPor.trim()) {
      setSangriaErro('O campo "Retirado por" é obrigatório.');
      return;
    }

    if (!sangriaRecebidoPor.trim()) {
      setSangriaErro('O campo "Recebido por" é obrigatório.');
      return;
    }

    setRegistrandoSangria(true);
    setSangriaErro(null);
    setSangriaSucesso(false);

    try {
      const equipeId = localStorage.getItem(`evento_${id}_equipe_id`);
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (equipeId) {
        headers['x-evento-equipe-id'] = equipeId;
      }

      const res = await fetch(`/api/eventos/${id}/caixa/sangria`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          caixa_sessao_id: caixaSessao.id,
          operador_id: caixaSessao.operador_id,
          valor: valorNum,
          forma_pagamento: 'dinheiro',
          observacao: sangriaObservacao,
          retirado_por: sangriaRetiradoPor,
          recebido_por: sangriaRecebidoPor,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Erro ao registrar sangria.');
      }

      setSangriaSucesso(true);
      setSangriaValor('');
      setSangriaRetiradoPor('');
      setSangriaRecebidoPor('');
      setSangriaObservacao('');
      
      await carregarCaixaDados();

      setTimeout(() => {
        setModalSangriaAberto(false);
        setSangriaSucesso(false);
      }, 1500);

    } catch (err: any) {
      setSangriaErro(err.message || 'Erro inesperado ao registrar sangria.');
    } finally {
      setRegistrandoSangria(false);
    }
  };

  const iniciarPagamentoPresencial = (ins: InscricaoResumo) => {
    if (ins.status_pagamento !== 'pendente') return;

    if (ins.lote_id) {
      alert("Inscrição vinculada a lote. O pagamento presencial deve ser marcado individualmente apenas para inscrições sem lote.");
      return;
    }

    setPagPresencialInscricao(ins);
    setPagPresencialForma('dinheiro');
    setPagPresencialValor(ins.valor_pago ?? ins.valor_final ?? 0);
    setPagPresencialObservacao('');
    setPagPresencialErro(null);
    setModalPagarPresencialAberto(true);
  };

  const confirmarPagamentoPresencial = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id || !pagPresencialInscricao) return;

    setProcessandoPagPresencial(true);
    setPagPresencialErro(null);

    try {
      const equipeId = localStorage.getItem(`evento_${id}_equipe_id`);
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (equipeId) {
        headers['x-evento-equipe-id'] = equipeId;
      }

      const res = await fetch(`/api/eventos/${id}/balcao/pagamento-presencial`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          inscricao_id: pagPresencialInscricao.id,
          forma_pagamento: pagPresencialForma,
          valor_pago: pagPresencialValor,
          observacao: pagPresencialObservacao,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Erro ao efetivar pagamento.');
      }

      setModalPagarPresencialAberto(false);
      setPagPresencialInscricao(null);

      // Atualizar lista e resumo do caixa imediatamente
      await carregarCaixaDados();
      await fetchInscricoesLista({ silent: true });

    } catch (err: any) {
      setPagPresencialErro(err.message || 'Erro inesperado ao registrar pagamento.');
    } finally {
      setProcessandoPagPresencial(false);
    }
  };

  useEffect(() => {
    if (authLoading || perfil.loading || !id) return;
    carregarCaixaDados();
  }, [authLoading, perfil.loading, id, carregarCaixaDados]);

  useEffect(() => {
    if (!id) return;
    const interval = setInterval(() => {
      carregarCaixaDados();
    }, 30000);
    return () => clearInterval(interval);
  }, [id, carregarCaixaDados]);

  // ─────────────────────────────────────────────────────────
  // Helpers do form
  // ─────────────────────────────────────────────────────────
  function setField<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm(f => ({ ...f, [k]: v }));
  }

  function handleText(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) {
    const { name, value } = e.target;
    setForm(f => ({ ...f, [name]: value }));
  }

  const camposFiltrados = form.supervisao_id
    ? campos.filter(c => c.supervisao_id === form.supervisao_id)
    : campos;

  function limparTudo(options?: { focoCpf?: boolean }) {
    setForm(FORM_VAZIO);
    setCpfBusca('');
    setMinistroEncontrado(false);
    setNomeMinistro('');
    setCupomStatus('idle');
    setCupomDesconto(0);
    setCupomMsg('');
    setErroSave(null);
    setInscricaoDuplicada(null);
    setMinistroInfo(null);
    setEsposaJubiladoAuto(null);
    setCpfStatus('idle');
    setDescontoCampoMissionario(false);
    setIncluirEsposa(false);
    setFormEsposa({ ...FORM_ESPOSA_VAZIO });
    setHospEsposa({ ...HOSP_ESPOSA_VAZIO });
    setInscricaoSalva(null);
    setAsaasData(null);
    // Se há só um tipo, pré-selecionar (somente quando evento usa tipos)
    if (evento?.usar_tipos_inscricao && tipos.length === 1) setForm(f => ({ ...f, tipo_id: tipos[0].id }));
    if (options?.focoCpf !== false) {
      setTimeout(() => cpfRef.current?.focus(), 50);
    }
  }

  const handleAdicionarEquipe = async () => {
    const nome = window.prompt('Digite o nome da nova equipe de apoio:');
    if (!nome || !nome.trim()) return;
    const nomeTrim = nome.trim();
    if (equipesApoio.includes(nomeTrim)) {
      alert('Esta equipe já existe na lista.');
      return;
    }
    const novasEquipes = [...equipesApoio, nomeTrim];
    setEquipesApoio(novasEquipes);
    setEquipeApoioSelecionada(nomeTrim);

    if (evento) {
      const configOriginal = evento.configuracoes_ago || {};
      const novoConfig = { ...configOriginal, equipes_apoio: novasEquipes };
      const { error } = await supabase
        .from('eventos')
        .update({ configuracoes_ago: novoConfig })
        .eq('id', id);
      if (!error) {
        setEvento(e => e ? { ...e, configuracoes_ago: novoConfig } : null);
      }
    }
  };

  // ─────────────────────────────────────────────────────────
  // Busca CPF
  // ─────────────────────────────────────────────────────────
  const handleCpfBuscaChange = (val: string) => {
    const apenasNumeros = val.replace(/\D/g, '').slice(0, 11);
    let formatado = apenasNumeros;
    if (apenasNumeros.length > 9) {
      formatado = `${apenasNumeros.slice(0, 3)}.${apenasNumeros.slice(3, 6)}.${apenasNumeros.slice(6, 9)}-${apenasNumeros.slice(9)}`;
    } else if (apenasNumeros.length > 6) {
      formatado = `${apenasNumeros.slice(0, 3)}.${apenasNumeros.slice(3, 6)}.${apenasNumeros.slice(6)}`;
    } else if (apenasNumeros.length > 3) {
      formatado = `${apenasNumeros.slice(0, 3)}.${apenasNumeros.slice(3)}`;
    }
    setCpfBusca(formatado);

    if (apenasNumeros.length === 11) {
      buscarCPF(apenasNumeros);
    }
  };

  async function buscarCPF(cpfForcado?: string) {
    const cpfLimpo = cpfForcado || cpfBusca.replace(/\D/g, '');
    if (cpfLimpo.length !== 11 || !evento) return;

    setBuscando(true);
    setMinistroEncontrado(false);
    setNomeMinistro('');
    setInscricaoDuplicada(null);
    setCpfStatus('idle');
    setMinistroInfo(null);
    setEsposaJubiladoAuto(null);
    setDescontoCampoMissionario(false);
    const isAGO = evento.departamento === 'AGO';

    // Para AGO com CPF (11 dígitos): endpoint público com dados ministeriais completos
    const usePublicEndpoint = isAGO && cpfLimpo.length === 11;

    const [lookupRes, dupRes] = await Promise.all([
      usePublicEndpoint
        ? fetch(`/api/public/members/lookup?cpf=${cpfLimpo}&includeMatricula=true`)
        : authenticatedFetch(`/api/v1/members/lookup?search=${encodeURIComponent(cpfLimpo || cpfBusca)}&limit=1`),
      cpfLimpo
        ? supabase
            .from('evento_inscricoes')
            .select('id,nome_inscrito')
            .eq('evento_id', id)
            .eq('cpf', cpfLimpo)
            .limit(1)
        : Promise.resolve({ data: [] as { id: string; nome_inscrito: string }[] }),
    ]);
    const lookupJson = lookupRes.ok ? await lookupRes.json().catch(() => null as any) : null;
    const dupData = (dupRes as { data?: { id: string; nome_inscrito: string }[] }).data ?? [];
    setBuscando(false);

    if (dupData && Array.isArray(dupData) && dupData.length > 0) {
      setInscricaoDuplicada({ id: dupData[0].id, nome: dupData[0].nome_inscrito });
    }

    if (usePublicEndpoint) {
      // Resposta: { encontrado, nome, sexo, data_nascimento, supervisao_id, campo_id, campo_nome, matricula, ... }
      const payload = (lookupJson ?? {}) as {
        encontrado?: boolean;
        lookup_kind?: 'ministro' | 'conjuge_jubilado' | null;
        conjuge_jubilado_validado?: boolean;
        conjuge_de_ministro_id?: string | null;
        conjuge_de_nome?: string | null;
        nome?: string | null;
        email?: string | null;
        whatsapp?: string | null;
        telefone?: string | null;
        sexo?: string | null;
        data_nascimento?: string | null;
        supervisao_id?: string | null;
        campo_id?: string | null;
        campo_nome?: string | null;
        matricula?: string | null;
        cargo_ministerial?: string | null;
        pastor_presidente?: boolean;
        pastor_auxiliar?: boolean;
        jubilado?: boolean;
        status?: string | null;
        is_campo_missionario?: boolean;
        nome_conjuge?: string | null;
        cpf_conjuge?: string | null;
        data_nascimento_conjuge?: string | null;
      };

      if (payload.encontrado) {
        const nome = payload.nome ?? '';
        const conjugeJubiladoAuto = payload.lookup_kind === 'conjuge_jubilado' || !!payload.conjuge_jubilado_validado;
        setCpfStatus('encontrado');
        setMinistroEncontrado(true);
        setNomeMinistro(nome);

        const sup = supervisoes.find(s => s.id === payload.supervisao_id);
        let campoEncontrado: Campo | undefined;

        if (sup?.id) {
          const camposRes = await fetch(`/api/public/estrutura?supervisao_id=${encodeURIComponent(sup.id)}&includeCamposInactive=true`);
          const camposJson = camposRes.ok ? await camposRes.json().catch(() => null) : null;
          const camposDaSup: Campo[] = (camposJson?.campos as Campo[]) || [];
          setCampos(prev => {
            const map = new Map(prev.map(c => [c.id, c]));
            camposDaSup.forEach(c => map.set(c.id, c));
            return Array.from(map.values());
          });
          // Tenta achar o campo primeiro por ID (FK via congregação), depois por nome (custom_fields)
          const normNome = (s: string) => s.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
          campoEncontrado = camposDaSup.find(c => c.id === payload.campo_id)
            ?? (payload.campo_nome
                ? camposDaSup.find(c => normNome(c.nome) === normNome(payload.campo_nome!))
                : undefined);
        }

        const campoMissionario = payload.is_campo_missionario ?? campoEncontrado?.is_campo_missionario ?? false;
        const confAgo = evento.configuracoes_ago;
        setDescontoCampoMissionario(!!(confAgo?.habilitar_desconto_campo_missionario) && campoMissionario);

        if (conjugeJubiladoAuto) {
          setEsposaJubiladoAuto({
            ministroId: payload.conjuge_de_ministro_id ?? null,
            ministroNome: payload.conjuge_de_nome ?? null,
          });
          setMinistroInfo(null);
          setDescontoCampoMissionario(false);
          setIncluirEsposa(false);
          setFormEsposa({ ...FORM_ESPOSA_VAZIO });
          setHospEsposa({ ...HOSP_ESPOSA_VAZIO });

          const sexoLookupRaw = String(payload.sexo || '').trim().toUpperCase();
          const sexoLookup = sexoLookupRaw.startsWith('M') ? 'M' : sexoLookupRaw.startsWith('F') ? 'F' : '';
          setForm(f => ({
            ...f,
            nome: nome || f.nome,
            cpf: cpfLimpo,
            sexo: sexoLookup || 'F',
            data_nascimento: payload.data_nascimento || f.data_nascimento,
            supervisao_id: sup?.id || f.supervisao_id,
            campo_id: campoEncontrado?.id || payload.campo_id || f.campo_id,
            email: payload.email || f.email,
            whatsapp: payload.whatsapp || payload.telefone || f.whatsapp,
          }));

          const tipoEsposaJub = findTipoEsposaJubilado(tipos);
          if (tipoEsposaJub) {
            setForm(f => ({ ...f, tipo_id: tipoEsposaJub.id }));
          }
          return;
        }

        setEsposaJubiladoAuto(null);

        const isPP = !!payload.pastor_presidente;
        const statusMinistro = payload.status ?? null;
        const ministerioAtivo = ['active', 'ativo'].includes((statusMinistro ?? '').toLowerCase());
        const podeEsposa = ministerioAtivo && isPP && campoMissionario;

        setMinistroInfo({
          nome,
          matricula: payload.matricula ?? null,
          cargoMinisterial: payload.cargo_ministerial ?? null,
          isPastorPresidente: isPP,
          isPastorAuxiliar: !!payload.pastor_auxiliar,
          isJubilado: !!payload.jubilado,
          status: statusMinistro,
          supervisao_id: payload.supervisao_id ?? null,
          campo_id: campoEncontrado?.id ?? payload.campo_id ?? null,
          isCampoMissionario: campoMissionario,
        });

        if (podeEsposa) {
          setFormEsposa({
            nome: payload.nome_conjuge || '',
            cpf: payload.cpf_conjuge || '',
            data_nascimento: payload.data_nascimento_conjuge || '',
            whatsapp: '',
          });
        } else {
          setIncluirEsposa(false);
          setFormEsposa({ ...FORM_ESPOSA_VAZIO });
          setHospEsposa({ ...HOSP_ESPOSA_VAZIO });
        }

        const sexoLookupRaw = String(payload.sexo || '').trim().toUpperCase();
        const sexoLookup = sexoLookupRaw.startsWith('M') ? 'M' : (sexoLookupRaw.startsWith('F') ? 'F' : 'M');

        setForm(f => ({
          ...f,
          nome:            nome || f.nome,
          cpf:             cpfLimpo,
          sexo:            sexoLookup,
          data_nascimento: payload.data_nascimento || f.data_nascimento,
          supervisao_id:   sup?.id || f.supervisao_id,
          campo_id:        campoEncontrado?.id || payload.campo_id || f.campo_id,
          email:           payload.email || f.email,
          whatsapp:        payload.whatsapp || payload.telefone || f.whatsapp,
        }));

        if (payload.jubilado) {
          const tipoJub = findTipoPastorJubilado(tipos);
          if (tipoJub) {
            setForm(f => ({ ...f, tipo_id: tipoJub.id }));
          }
        }
      } else {
        setCpfStatus('nao_encontrado');
        setEsposaJubiladoAuto(null);
        setForm(f => ({
          ...f,
          cpf: cpfLimpo,
          nome: '', email: '', whatsapp: '', sexo: '',
          data_nascimento: '', supervisao_id: '', campo_id: '',
        }));
        setTimeout(() => nomeRef.current?.focus(), 50);
      }
    } else {
      // Endpoint v1 (não-AGO ou busca por nome/RG)
      setEsposaJubiladoAuto(null);
      const data = (lookupJson?.data ?? []) as { id: string; nome?: string | null; name?: string | null; cpf?: string | null; celular?: string | null; phone?: string | null; whatsapp?: string | null; email?: string | null; supervisao?: string | null; campo?: string | null; supervisao_id?: string | null; campo_id?: string | null; sexo?: string | null; data_nascimento?: string | null }[];
      if (data && data.length > 0) {
        const m = data[0];
        const nome = (m.nome ?? m.name ?? '') as string;
        const celular = (m.celular ?? m.phone ?? '') as string;
        const sup   = supervisoes.find(s => s.id === m.supervisao_id || s.nome === m.supervisao);
        const campo = campos.find(c => c.id === m.campo_id || c.nome === m.campo);
        setCpfStatus('encontrado');
        setMinistroEncontrado(true);
        setNomeMinistro(nome || '');
        setForm(f => ({
          ...f,
          nome:         nome || f.nome,
          cpf:          m.cpf || cpfLimpo,
          whatsapp:     m.whatsapp || celular || f.whatsapp,
          email:        m.email   || f.email,
          supervisao_id: sup?.id  || f.supervisao_id,
          campo_id:     campo?.id || f.campo_id,
          sexo:         m.sexo    || f.sexo,
          data_nascimento: m.data_nascimento || f.data_nascimento,
        }));
        setTimeout(() => supRef.current?.focus(), 50);
      } else {
        setCpfStatus('nao_encontrado');
        setForm(f => ({
          ...f,
          cpf: cpfLimpo,
          nome: '', email: '', whatsapp: '', sexo: '',
          data_nascimento: '', supervisao_id: '', campo_id: '',
        }));
        setTimeout(() => nomeRef.current?.focus(), 50);
      }
    }
  }

  // ─────────────────────────────────────────────────────────
  // Validação e aplicação de cupom
  // ─────────────────────────────────────────────────────────
  async function validarCupom() {
    if (!form.cupom.trim() || !evento) return;
    setCupomStatus('validando');
    try {
      const res = await fetch(`/api/eventos/${evento.id}/cupons/validar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigo: form.cupom.trim().toUpperCase(), valor_base: valorBase }),
      });
      const json = await res.json() as { valido: boolean; desconto?: number; valorFinal?: number; erro?: string };
      if (json.valido && json.desconto !== undefined) {
        setCupomStatus('ok');
        setCupomDesconto(json.desconto);
        setCupomMsg(`Desconto de ${fmtMoeda(json.desconto)} aplicado!`);
      } else {
        setCupomStatus('erro');
        setCupomDesconto(0);
        setCupomMsg(json.erro || 'Cupom inválido.');
      }
    } catch {
      setCupomStatus('erro');
      setCupomMsg('Erro ao validar cupom.');
    }
  }

  function removerCupom() {
    setField('cupom', '');
    setCupomStatus('idle');
    setCupomDesconto(0);
    setCupomMsg('');
  }

  // Ao mudar tipo, recalcular cupom se houver
  useEffect(() => {
    if (cupomStatus === 'ok' && form.cupom) {
      setCupomStatus('idle');
      setCupomDesconto(0);
      setCupomMsg('Recalcule o cupom após mudar o tipo de inscrição.');
    }
  }, [form.tipo_id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─────────────────────────────────────────────────────────
  // Salvar inscrição
  // ─────────────────────────────────────────────────────────
  const salvar = useCallback(async () => {
    if (!evento || !form.nome.trim()) {
      setErroSave('Nome do inscrito é obrigatório.');
      return;
    }
    if (!form.supervisao_id) {
      setErroSave('Supervisão é obrigatória.');
      return;
    }
    if (ministroSemPerfil) {
      setErroSave('Ministro localizado, mas o perfil ministerial não está definido para esta AGO. Verifique o cargo/cadastro do ministro e selecione uma categoria autorizada.');
      return;
    }
    if (evento.usar_tipos_inscricao && !tipoSel && form.tipo_id !== 'equipe_apoio') {
      setErroSave('Selecione um tipo de inscrição.');
      return;
    }
    setErroSave(null);
    setSalvando(true);

    try {
      const isGratuito = form.tipo_id === 'equipe_apoio' || valorFinal <= 0 || form.forma_pagamento === 'isento';
      // Regra 8: AGO — hospedagem é sempre opt-in (nunca automática pelo tipo)
      const hospedagem = evento.departamento === 'AGO' ? form.hospedagem : (tipoSel ? tipoSel.inclui_hospedagem : form.hospedagem);
      const alimentacao = !!tipoSel?.inclui_alimentacao;
      const cupomCodigo = form.cupom && cupomStatus === 'ok'
        ? form.cupom.trim().toUpperCase()
        : undefined;
      const qrToken = generateQRCodeToken();

      const payload: Record<string, unknown> = {
        nome_inscrito:    form.nome.trim(),
        cpf:              form.cpf.replace(/\D/g, '') || undefined,
        email:            form.email.trim() || undefined,
        whatsapp:         form.whatsapp.trim() || undefined,
        sexo:             form.sexo || undefined,
        data_nascimento:  form.data_nascimento || undefined,
        supervisao_id:    form.supervisao_id,
        campo_id:         form.campo_id || undefined,
        hospedagem,
        alimentacao,
        brinde:           form.brinde,
        tipo_inscricao:   form.tipo_id === 'equipe_apoio' ? 'Equipe de Apoio' : (tipoSel?.nome || undefined),
        equipe_apoio:     form.tipo_id === 'equipe_apoio' ? equipeApoioSelecionada : undefined,
        cupom_codigo:     cupomCodigo,
        valor_original:   form.tipo_id === 'equipe_apoio' ? 0 : valorBase,
        desconto_valor:   form.tipo_id === 'equipe_apoio' ? 0 : cupomDesconto,
        valor_final:      form.tipo_id === 'equipe_apoio' ? 0 : valorFinal,
        forma_pagamento:  form.tipo_id === 'equipe_apoio' ? 'isento' : (isGratuito ? 'isento' : form.forma_pagamento),
        observacoes:      form.tipo_id === 'equipe_apoio'
          ? `[Equipe: ${equipeApoioSelecionada}] ${form.observacoes.trim()}`.trim()
          : (form.observacoes.trim() || undefined),
        qr_code:          qrToken,
        hosp_necessidade_especial:  form.hosp_necessidade_especial,
        hosp_descricao_necessidade: form.hosp_descricao_necessidade.trim() || undefined,
        hosp_observacoes:           form.hosp_observacoes.trim() || undefined,
        hosp_possui_comorbidade:    form.hosp_possui_comorbidade,
        hosp_descricao_comorbidade: form.hosp_descricao_comorbidade.trim() || undefined,
      };

      // AGO Campo Missionário — esposa
      if (incluirEsposa && formEsposa.nome.trim() && evento.departamento === 'AGO') {
        payload.incluir_esposa = true;
        payload.esposa = {
          nome_inscrito:   formEsposa.nome.trim(),
          cpf:             formEsposa.cpf.replace(/\D/g, '') || undefined,
          data_nascimento: formEsposa.data_nascimento || undefined,
          whatsapp:        formEsposa.whatsapp.trim() || undefined,
          sexo:            'F',
          tipo_inscricao:  'Esposa de Pastor Presidente Campo Missionário',
          hospedagem:      hospEsposa.solicitar,
          qr_code:         generateQRCodeToken(),
          hosp_necessidade_especial:  hospEsposa.hosp_necessidade_especial,
          hosp_descricao_necessidade: hospEsposa.hosp_descricao_necessidade.trim() || undefined,
          hosp_observacoes:           hospEsposa.hosp_observacoes.trim() || undefined,
          hosp_possui_comorbidade:    hospEsposa.hosp_possui_comorbidade,
          hosp_descricao_comorbidade: hospEsposa.hosp_descricao_comorbidade.trim() || undefined,
          lgpd_aceito:                true,
        };
      }

      const res = await authenticatedFetch(`/api/eventos/${id}/balcao/inscricao`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const json = await res.json() as {
        inscricaoId?: string;
        inscricao?: InscricaoSalva;
        statusPagamento?: string;
        pagamento?: { invoiceUrl?: string; pixCopiaECola?: string; valor?: number } | null;
        asaasError?: string;
        error?: string;
        stage?: string;
        details?: string;
        code?: string;
      };

      if (!res.ok || json.error) {
        const msg = json.details
          ? `${json.error} [${json.stage ?? 'erro'}]: ${json.details}${json.code ? ` (${json.code})` : ''}`
          : (json.error || 'Erro ao processar inscrição.');
        setErroSave(msg);
        return;
      }

      // Usa objeto completo retornado pelo endpoint ou busca pelo ID
      let inscCompleta: InscricaoSalva | null = null;
      if (json.inscricao) {
        inscCompleta = json.inscricao as InscricaoSalva;
      } else if (json.inscricaoId) {
        const { data: insc } = await supabase
          .from('evento_inscricoes')
          .select('id,nome_inscrito,cpf,supervisao_id,campo_id,status_pagamento,hospedagem,alimentacao,brinde,qr_code,checkin_realizado')
          .eq('id', json.inscricaoId)
          .single();
        if (insc) inscCompleta = insc as InscricaoSalva;
      }

      if (inscCompleta) {
        setInscricaoSalva(inscCompleta);
        registrarInscricaoCriada(inscCompleta);
      }

      if (json.pagamento) {
        setAsaasData({
          invoiceUrl:    json.pagamento.invoiceUrl,
          pixCopiaECola: json.pagamento.pixCopiaECola,
          valor:         json.pagamento.valor ?? valorFinal,
        });
      } else {
        setAsaasData(null);
      }

      if (json.asaasError) {
        setErroSave(json.asaasError);
      }

      setContadorTotal(c => c + 1);
    } catch (err: unknown) {
      setErroSave('Erro inesperado: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSalvando(false);
    }
  }, [evento, form, tipoSel, valorBase, valorFinal, cupomDesconto, cupomStatus, supabase, id, incluirEsposa, formEsposa, hospEsposa, equipeApoioSelecionada]);

  // ─────────────────────────────────────────────────────────
  // Impressão de crachá
  // ─────────────────────────────────────────────────────────
  function imprimirCracha() {
    if (!inscricaoSalva) return;
    if (inscricaoSalva.status_pagamento !== 'pago' && inscricaoSalva.status_pagamento !== 'isento') {
      alert('Esta inscrição ainda está pendente de pagamento e não pode ser impressa.');
      return;
    }
    window.open(`/eventos/${id}/etiquetas/print?ids=${inscricaoSalva.id}&size=medium`, '_blank', 'width=900,height=700');
  }

  function registrarInscricaoCriada(insc: InscricaoSalva) {
    setDestacarId(insc.id);
    setPrecisaAtualizar(true);
  }

  const fetchInscricoesLista = useCallback(async (options?: { silent?: boolean }) => {
    if (!id) return;
    if (!options?.silent) setLoadingLista(true);
    setListaErro(null);
    try {
      const { data, error } = await supabase
        .from('evento_inscricoes')
        .select('id,lote_id,nome_inscrito,cpf,whatsapp,email,supervisao_id,campo_id,tipo_inscricao,valor_final,valor_pago,status_pagamento,forma_pagamento,hospedagem,alimentacao,asaas_payment_id,invoice_url,checkin_realizado,checkin_at,etiqueta_impressa,certificado_enviado,created_at,valor_original')
        .eq('evento_id', id)
        .order('created_at', { ascending: false });
      if (error) {
        setListaErro('Erro ao carregar inscritos.');
        return;
      }
      
      const { data: lotesData } = await supabase
        .from('evento_lotes_inscricao')
        .select('*')
        .eq('evento_id', id);

      const lotesMap: Record<string, any> = {};
      if (lotesData) {
        lotesData.forEach((l: any) => {
          lotesMap[l.id] = l;
        });
      }

      const enriched = ((data as any[]) || []).map(i => ({
        ...i,
        lote: i.lote_id ? (lotesMap[i.lote_id] || null) : null,
      }));

      setInscricoesLista(enriched);
      setPrecisaAtualizar(false);
    } catch {
      setListaErro('Erro ao carregar inscritos.');
    } finally {
      if (!options?.silent) setLoadingLista(false);
    }
  }, [id, supabase]);

  useEffect(() => {
    if (!inscricaoSalva) return;
    if (!['pago', 'isento'].includes(inscricaoSalva.status_pagamento)) return;
    const timer = window.setTimeout(() => {
      limparTudo({ focoCpf: false });
      setActiveTab('inscritos');
    }, 3200);
    return () => window.clearTimeout(timer);
  }, [inscricaoSalva]);

  useEffect(() => {
    if (activeTab !== 'inscritos') return;
    fetchInscricoesLista();
    const timer = window.setInterval(() => {
      fetchInscricoesLista({ silent: true });
    }, 30000);
    return () => window.clearInterval(timer);
  }, [activeTab, fetchInscricoesLista]);

  useEffect(() => {
    if (activeTab === 'inscritos' && precisaAtualizar) {
      fetchInscricoesLista();
    }
  }, [activeTab, precisaAtualizar, fetchInscricoesLista]);

  useEffect(() => {
    if (!destacarId) return;
    const timer = window.setTimeout(() => setDestacarId(null), 12000);
    return () => window.clearTimeout(timer);
  }, [destacarId]);

  useEffect(() => {
    if (activeTab !== 'inscritos' || !destacarId) return;
    const timer = window.setTimeout(() => {
      document.getElementById(`insc-${destacarId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 200);
    return () => window.clearTimeout(timer);
  }, [activeTab, destacarId, inscricoesLista.length, buscaLista, filtroPag, filtroSup, filtroCampo]);

  useEffect(() => {
    if (!destacarId) return;
    if (ignorarProximoClearRef.current) {
      ignorarProximoClearRef.current = false;
      return;
    }
    setDestacarId(null);
  }, [buscaLista, filtroPag, filtroSup, filtroCampo]);

  useEffect(() => {
    if (activeTab === 'nova' && !inscricaoSalva) {
      setTimeout(() => cpfRef.current?.focus(), 50);
    }
  }, [activeTab, inscricaoSalva]);

  useEffect(() => () => {
    if (listaMsgTimeoutRef.current) window.clearTimeout(listaMsgTimeoutRef.current);
  }, []);

  // Auto-seleciona categoria quando só há uma opção válida (AGO)
  useEffect(() => {
    if (!evento || evento.departamento !== 'AGO') return;
    if (tiposParaExibir.length !== 1) return;
    setField('tipo_id', tiposParaExibir[0].id);
  }, [tiposParaExibir]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─────────────────────────────────────────────────────────
  // Helpers de nomes
  // ─────────────────────────────────────────────────────────
  const supervisaoById = useMemo(
    () => new Map(supervisoes.map(s => [s.id, s.nome])),
    [supervisoes]
  );
  const campoById = useMemo(
    () => new Map(campos.map(c => [c.id, c])),
    [campos]
  );

  const nomeSup   = (sid: string | null) => supervisoes.find(s => s.id === sid)?.nome ?? '';
  const nomeCampo = (cid: string | null) => campos.find(c => c.id === cid)?.nome ?? '';

  const supervisoesLista = useMemo(() => {
    const map = new Map<string, string>();
    inscricoesLista.forEach(i => {
      const id = i.supervisao_id;
      if (!id) return;
      const nome = (supervisaoById.get(id) ?? '').trim();
      if (!nome) return;
      map.set(id, nome);
    });
    return Array.from(map.entries())
      .map(([id, nome]) => ({ id, nome }))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }, [inscricoesLista, supervisaoById]);

  const camposBaseLista = useMemo(() => {
    const map = new Map<string, { id: string; nome: string; supervisao_id: string | null }>();
    inscricoesLista.forEach(i => {
      const id = i.campo_id;
      if (!id) return;
      const campo = campoById.get(id);
      const nome = (campo?.nome ?? '').trim();
      if (!nome) return;
      map.set(id, { id, nome, supervisao_id: campo?.supervisao_id ?? i.supervisao_id ?? null });
    });
    return Array.from(map.values())
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }, [inscricoesLista, campoById]);

  const camposLista = useMemo(
    () => (filtroSup ? camposBaseLista.filter(c => c.supervisao_id === filtroSup) : camposBaseLista),
    [camposBaseLista, filtroSup]
  );

  const inscritosFiltrados = useMemo(() => {
    const q = buscaLista.trim().toLowerCase();
    return inscricoesLista.filter(i => {
      if (q) {
        const nomeOk = i.nome_inscrito.toLowerCase().includes(q);
        const cpfOk = (i.cpf || '').includes(q);
        const wppOk = (i.whatsapp || '').includes(q);
        if (!nomeOk && !cpfOk && !wppOk) return false;
      }
      if (filtroSup && i.supervisao_id !== filtroSup) return false;
      if (filtroCampo && i.campo_id !== filtroCampo) return false;
      if (filtroPag && i.status_pagamento !== filtroPag) return false;
      // Filtro de check-in removido no balcao.
      return true;
    });
  }, [inscricoesLista, buscaLista, filtroSup, filtroCampo, filtroPag]);

  const totalPaginas = Math.ceil(inscritosFiltrados.length / POR_PAG);
  const inscritosPaginados = useMemo(() => {
    return inscritosFiltrados.slice((pagina - 1) * POR_PAG, pagina * POR_PAG);
  }, [inscritosFiltrados, pagina]);

  function definirMsgLista(tipo: 'ok' | 'erro' | 'aviso', texto: string) {
    setListaMsg({ tipo, texto });
    if (listaMsgTimeoutRef.current) window.clearTimeout(listaMsgTimeoutRef.current);
    listaMsgTimeoutRef.current = window.setTimeout(() => setListaMsg(null), 4000);
  }

  async function reenviarEmail(ins: InscricaoResumo) {
    if (!ins.email) {
      definirMsgLista('aviso', 'E-mail nao cadastrado para esta inscricao.');
      return;
    }
    setEnviandoEmail(p => ({ ...p, [ins.id]: true }));
    try {
      const res = await fetch(`/api/eventos/${id}/notificacoes/reenviar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inscricao_id: ins.id }),
      });
      const json = await res.json();
      if (res.ok) {
        definirMsgLista('ok', 'E-mail reenviado com sucesso.');
      } else {
        definirMsgLista('erro', json.error || 'Falha ao reenviar e-mail.');
      }
    } catch {
      definirMsgLista('erro', 'Erro de rede ao reenviar e-mail.');
    } finally {
      setEnviandoEmail(p => ({ ...p, [ins.id]: false }));
    }
  }

  async function enviarCertificadoLista(ins: InscricaoResumo) {
    if (!ins.email) {
      definirMsgLista('aviso', 'E-mail nao cadastrado para esta inscricao.');
      return;
    }
    if (!['pago', 'isento'].includes(ins.status_pagamento)) {
      definirMsgLista('aviso', 'Pagamento pendente: certificado indisponivel.');
      return;
    }
    if (!ins.checkin_realizado) {
      definirMsgLista('aviso', 'Check-in pendente: certificado indisponivel.');
      return;
    }
    setEnviandoCert(p => ({ ...p, [ins.id]: true }));
    try {
      const res = await fetch(`/api/eventos/${id}/certificados/enviar-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inscricao_id: ins.id, reenviar: ins.certificado_enviado }),
      });
      const json = await res.json();
      if (json.jaEnviado) {
        definirMsgLista('ok', 'Certificado ja enviado anteriormente.');
      } else if (res.ok) {
        definirMsgLista('ok', 'Certificado enviado com sucesso.');
        setInscricoesLista(list => list.map(i => i.id === ins.id ? { ...i, certificado_enviado: true } : i));
      } else {
        definirMsgLista('erro', json.error || 'Falha ao enviar certificado.');
      }
    } catch {
      definirMsgLista('erro', 'Erro de rede ao enviar certificado.');
    } finally {
      setEnviandoCert(p => ({ ...p, [ins.id]: false }));
    }
  }

  async function realizarCheckinManual(ins: InscricaoResumo) {
    if (!podeCheckinManual) return;
    if (!['pago', 'isento'].includes(ins.status_pagamento)) {
      definirMsgLista('aviso', 'Somente inscricoes pagas/isentas podem fazer check-in.');
      return;
    }
    setCheckinManual(p => ({ ...p, [ins.id]: true }));
    try {
      const now = new Date().toISOString();
      await supabase
        .from('evento_inscricoes')
        .update({ checkin_realizado: true, checkin_at: now })
        .eq('id', ins.id);
      await supabase
        .from('evento_checkins')
        .insert([{ evento_id: id, inscricao_id: ins.id, metodo: 'manual' }]);
      setInscricoesLista(list => list.map(i => i.id === ins.id ? { ...i, checkin_realizado: true, checkin_at: now } : i));
      definirMsgLista('ok', 'Check-in realizado com sucesso.');
    } catch {
      definirMsgLista('erro', 'Erro ao realizar check-in.');
    } finally {
      setCheckinManual(p => ({ ...p, [ins.id]: false }));
    }
  }

  async function imprimirEtiqueta(ins: InscricaoResumo) {
    if (ins.status_pagamento !== 'pago' && ins.status_pagamento !== 'isento') {
      alert('Esta inscrição ainda está pendente de pagamento e não pode ser impressa.');
      return;
    }

    window.open(`/eventos/${id}/etiquetas/print?mode=thermal&ids=${ins.id}`, '_blank', 'width=520,height=420');
  }

  async function alternarEtiquetaImpressa(ins: InscricaoResumo) {
    if (!perfil.podeEditarInscricoes) {
      definirMsgLista('aviso', 'Sem permissao para alterar etiqueta.');
      return;
    }
    setMarcandoEtiqueta(p => ({ ...p, [ins.id]: true }));
    try {
      const res = await fetch(`/api/eventos/${id}/inscricoes/${ins.id}/etiqueta`, {
        method: 'PATCH',
      });
      const json = await res.json();
      if (!res.ok) {
        definirMsgLista('erro', json.error || 'Falha ao atualizar etiqueta.');
        return;
      }
      setInscricoesLista(list => list.map(i => i.id === ins.id
        ? { ...i, etiqueta_impressa: !!json.etiqueta_impressa }
        : i));
      definirMsgLista('ok', json.etiqueta_impressa ? 'Etiqueta marcada como impressa.' : 'Etiqueta desmarcada.');
    } catch {
      definirMsgLista('erro', 'Erro de rede ao atualizar etiqueta.');
    } finally {
      setMarcandoEtiqueta(p => ({ ...p, [ins.id]: false }));
    }
  }



  const fmtDT = (d: string | null) => d ? new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';

  async function carregarDadosOperacionais(inscricaoId: string) {
    setCarregandoDadosOperacionais(true);
    setDadosOperacionais(null);
    try {
      const { data: insc, error: errInsc } = await supabase
        .from('evento_inscricoes')
        .select('tipo_inscricao, valor_final, valor_pago, status_pagamento, hospedagem, alimentacao, quantidade_refeicoes_total, quantidade_refeicoes_usadas, quantidade_refeicoes_saldo, refeicoes_total, refeicoes_utilizadas, grupo_hospedagem, lote_id, forma_pagamento, valor_original')
        .eq('id', inscricaoId)
        .single();

      if (errInsc || !insc) {
        console.error('Erro ao buscar inscricao para dados operacionais:', errInsc);
        return;
      }

      let loteCodigo: string | null = null;
      let loteTotal: number | null = null;
      let loteCount: number = 0;
      if (insc.lote_id) {
        const [loteRes, countRes] = await Promise.all([
          supabase.from('evento_lotes_inscricao').select('codigo, valor_total').eq('id', insc.lote_id).single(),
          supabase.from('evento_inscricoes').select('id', { count: 'exact', head: true }).eq('lote_id', insc.lote_id)
        ]);
        if (loteRes.data) {
          loteCodigo = loteRes.data.codigo;
          loteTotal = loteRes.data.valor_total;
        }
        if (countRes.count !== null) {
          loteCount = countRes.count;
        }
      }

      const { data: hosp } = await supabase
        .from('evento_hospedagens')
        .select(`
          status, grupo_hospedagem, checkin_at, checkout_at,
          alojamento_id, tipo_cama, numero_cama,
          evento_alojamentos ( nome )
        `)
        .eq('inscricao_id', inscricaoId)
        .maybeSingle();

      const { data: leito } = await supabase
        .from('evento_hospedagem_leitos')
        .select(`
          numero, tipo_leito, posicao, alojamento_id, ocupado,
          evento_alojamentos ( nome )
        `)
        .eq('inscricao_id', inscricaoId)
        .maybeSingle();

      let hospedagemFonte = hosp as any;
      let leitoFonte = leito as any;
      try {
        const [hospRes, leitosRes] = await Promise.all([
          fetch(`/api/eventos/${id}/hospedagens`),
          fetch(`/api/eventos/${id}/hospedagens/leitos`),
        ]);
        if (hospRes.ok) {
          const json = await hospRes.json();
          const apiHosp = (json.hospedagens ?? []).find((h: any) => h.inscricao_id === inscricaoId);
          if (apiHosp) hospedagemFonte = apiHosp;
        }
        if (leitosRes.ok) {
          const json = await leitosRes.json();
          const apiLeito = (json.leitos ?? []).find((l: any) => l.inscricao_id === inscricaoId && l.ocupado !== false)
            ?? (json.leitos ?? []).find((l: any) => l.inscricao_id === inscricaoId);
          if (apiLeito) leitoFonte = apiLeito;
        }
      } catch {
        // Mantem fallback direto via Supabase quando a API de hospedagem nao estiver acessivel.
      }

      let total = insc.quantidade_refeicoes_total ?? insc.refeicoes_total ?? null;
      let usadas = insc.quantidade_refeicoes_usadas ?? insc.refeicoes_utilizadas ?? null;
      let saldo = insc.quantidade_refeicoes_saldo ?? null;
      const isAgo = evento?.departamento === 'AGO';
      const alimentacaoInclusa = isAgo ? true : !!insc.alimentacao;

      if (isAgo) {
        if (total === null || total === 0) {
          total = 12;
        }
        if (usadas === null) {
          usadas = 0;
        }
        if (saldo === null) {
          saldo = Math.max(0, total - usadas);
        }
      }
      const statusHospFonte = String(hospedagemFonte?.status_operacional || hospedagemFonte?.status || '').toLowerCase();
      const possuiHospedagem = !!hospedagemFonte?.id || !!hospedagemFonte?.inscricao_id || !!hospedagemFonte?.status || !!hospedagemFonte?.status_operacional || !!hospedagemFonte?.alojamento_id || !!hospedagemFonte?.evento_alojamentos?.nome || !!hospedagemFonte?.alojamento_nome || !!hospedagemFonte?.numero_cama || !!hospedagemFonte?.tipo_cama;
      const possuiLeito = !!leitoFonte?.numero || !!leitoFonte?.tipo_leito || !!leitoFonte?.posicao || !!leitoFonte?.alojamento_id || !!leitoFonte?.evento_alojamentos?.nome;
      
      const hospedagemSolicitada = !!insc.hospedagem || possuiHospedagem || possuiLeito || ['alocada', 'confirmada', 'checkin_realizado', 'lista_espera', 'aguardando_pagamento'].includes(statusHospFonte);
      const possuiAlocacao = possuiLeito || !!hospedagemFonte?.alojamento_id || !!hospedagemFonte?.evento_alojamentos?.nome || !!hospedagemFonte?.alojamento_nome || !!hospedagemFonte?.numero_cama || !!hospedagemFonte?.tipo_cama;

      let statusHospedagem = null;
      let alojamentoNome = 'Não alocado';
      let numeroLeito = 'Não alocado';
      let tipoLeito = 'Não alocado';

      if (hospedagemSolicitada) {
        if (possuiAlocacao) {
          statusHospedagem = 'Alocada';
          alojamentoNome = leitoFonte?.evento_alojamentos?.nome || hospedagemFonte?.alojamento_nome || hospedagemFonte?.evento_alojamentos?.nome || 'Não alocado';
          numeroLeito = leitoFonte?.numero || hospedagemFonte?.numero_cama || 'Não alocado';
          tipoLeito = leitoFonte?.posicao || hospedagemFonte?.tipo_cama || leitoFonte?.tipo_leito || 'Não alocado';
        } else {
          statusHospedagem = 'Não alocada / Aguardando alocação';
        }
      }

      setDadosOperacionais({
        tipoInscricao: insc.tipo_inscricao || null,
        valorInscricao: insc.valor_final ?? insc.valor_original ?? insc.valor_pago ?? null,
        statusPagamento: insc.status_pagamento,
        hospedagem: hospedagemSolicitada,
        statusHospedagem,
        grupoHospedagem: hospedagemFonte?.grupo_hospedagem || insc.grupo_hospedagem || '—',
        alojamentoNome,
        tipoLeito,
        posicaoLeito: possuiAlocacao ? (leitoFonte?.posicao || null) : 'Não alocado',
        numeroLeito,
        checkinAt: hospedagemFonte?.checkin_at || null,
        checkoutAt: hospedagemFonte?.checkout_at || null,

        alimentacao: alimentacaoInclusa,
        refeicoesTotal: total,
        refeicoesUsadas: usadas,
        refeicoesSaldo: saldo,
        lote_id: insc.lote_id,
        loteTotal,
        formaPagamento: insc.forma_pagamento,
        loteCodigo,
        loteCount,
        valorOriginal: insc.valor_original,
      });
    } catch (err) {
      console.error('Erro ao carregar dados operacionais:', err);
    } finally {
      setCarregandoDadosOperacionais(false);
    }
  }

  function abrirEdicao(ins: InscricaoResumo) {
    if (!perfil.podeEditarInscricoes) return;
    setErroEdit(null);
    setEditando(ins);
    carregarDadosOperacionais(ins.id);
    setEditForm({
      nome_inscrito: ins.nome_inscrito,
      cpf: ins.cpf ?? '',
      email: ins.email ?? '',
      whatsapp: ins.whatsapp ?? '',
      supervisao_id: ins.supervisao_id ?? '',
      campo_id: ins.campo_id ?? '',
    });
  }

  async function salvarEdicao() {
    if (!editando || !editForm) return;
    if (!perfil.podeEditarInscricoes) return;
    if (!editForm.nome_inscrito.trim()) {
      setErroEdit('Nome do inscrito e obrigatorio.');
      return;
    }
    if (!editForm.supervisao_id) {
      setErroEdit('Supervisao e obrigatoria.');
      return;
    }
    setErroEdit(null);
    setSalvandoEdit(true);
    try {
      const cpfLimpo = editForm.cpf.replace(/\D/g, '') || null;
      const payload = normalizePayloadUppercase({
        nome_inscrito: editForm.nome_inscrito.trim(),
        cpf: cpfLimpo,
        email: editForm.email.trim() || null,
        whatsapp: editForm.whatsapp.trim() || null,
        supervisao_id: editForm.supervisao_id,
        campo_id: editForm.campo_id || null,
      });
      const { error } = await supabase
        .from('evento_inscricoes')
        .update(payload)
        .eq('id', editando.id);
      if (error) {
        setErroEdit(error.message);
        return;
      }
      const normalized = payload as {
        nome_inscrito?: string;
        cpf?: string | null;
        email?: string | null;
        whatsapp?: string | null;
        supervisao_id?: string | null;
        campo_id?: string | null;
      };
      setInscricoesLista(list => list.map(i => i.id === editando.id ? {
        ...i,
        nome_inscrito: normalized.nome_inscrito ?? editForm.nome_inscrito.trim(),
        cpf: normalized.cpf ?? cpfLimpo,
        email: normalized.email ?? (editForm.email.trim() || null),
        whatsapp: normalized.whatsapp ?? (editForm.whatsapp.trim() || null),
        supervisao_id: normalized.supervisao_id ?? editForm.supervisao_id,
        campo_id: normalized.campo_id ?? (editForm.campo_id || null),
      } : i));
      definirMsgLista('ok', 'Inscricao atualizada com sucesso.');
      setEditando(null);
      setEditForm(null);
    } catch {
      setErroEdit('Erro ao salvar edicao.');
    } finally {
      setSalvandoEdit(false);
    }
  }

  function trocarAba(tab: BalcaoTab) {
    setActiveTab(tab);
    setInscricaoSalva(null);
  }

  function verNaListaInscritos() {
    const idAtual = inscricaoSalva?.id ?? null;
    limparTudo({ focoCpf: false });
    if (idAtual) setDestacarId(idAtual);
    setActiveTab('inscritos');
    setPrecisaAtualizar(true);
  }

  function limparFiltrosLista() {
    setBuscaLista('');
    setFiltroPag('');
    setFiltroSup('');
    setFiltroCampo('');
  }

  // ─────────────────────────────────────────────────────────
  // Guards de carregamento
  // ─────────────────────────────────────────────────────────
  if (authLoading || perfil.loading || loadingInit) {
    return (
      <div className="min-h-screen bg-[#0D2B4E] flex items-center justify-center">
        <div className="text-center text-white space-y-3">
          <div className="w-10 h-10 border-4 border-white/30 border-t-white rounded-full animate-spin mx-auto" />
          <p className="text-sm text-white/60">Carregando modo balcão...</p>
        </div>
      </div>
    );
  }

  if (acessoNegado) {
    return (
      <div className="min-h-screen bg-[#0D2B4E] flex items-center justify-center p-8">
        <div className="text-center text-white space-y-4 max-w-sm">
          <p className="text-5xl">🚫</p>
          <h1 className="text-xl font-bold">Acesso Negado</h1>
          <p className="text-white/60 text-sm">Você não tem permissão para acessar o Modo Balcão.</p>
          <button onClick={handleSair} className="mt-4 px-6 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-sm font-semibold transition">← Sair</button>
        </div>
      </div>
    );
  }

  if (!evento) {
    return (
      <div className="min-h-screen bg-[#0D2B4E] flex items-center justify-center">
        <p className="text-white/60">Evento não encontrado.</p>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────
  // Formulário principal
  // ─────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#0D2B4E] flex flex-col">
      {/* ── Header ── */}
      <header className="bg-[#0a2040] border-b border-white/10 px-4 py-3 flex items-center gap-3 flex-shrink-0">
        <button
          onClick={handleSair}
          className="text-white/50 hover:text-white text-sm px-3 py-1.5 rounded-lg hover:bg-white/10 transition"
          title="Sair do painel"
        >
          ← Sair
        </button>
        <div className="flex-1 min-w-0 flex flex-wrap items-center gap-3">
          <div>
            <h1 className="text-white font-bold text-sm truncate">🏪 Modo Balcão — {evento.nome}</h1>
            <p className="text-white/40 text-xs hidden sm:block">Inscrição presencial rápida · Esc=Limpar · Ctrl+Enter=Salvar</p>
          </div>
          {caixaSessao && (
            <div className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 px-3 py-1 rounded-full text-xs font-bold inline-flex items-center gap-1.5 flex-shrink-0">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              Caixa Aberto • Operador: {caixaSessao.operador_nome} • Iniciado às {new Date(caixaSessao.data_abertura).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
            </div>
          )}
        </div>
        {contadorTotal > 0 && (
          <div className="bg-emerald-500 text-white text-xs font-bold px-3 py-1 rounded-full flex-shrink-0">
            {contadorTotal} inscrição{contadorTotal !== 1 ? 'ões' : ''} hoje
          </div>
        )}
      </header>

      {/* ── Abas internas ── */}
      <div className="bg-[#0a2040] border-b border-white/10">
        <div className="max-w-5xl mx-auto px-4 lg:px-6">
          <div className="flex gap-2 py-3 overflow-x-auto pb-1">
            <button
              type="button"
              onClick={() => trocarAba('nova')}
              className={`px-4 py-2 rounded-xl text-sm font-bold transition whitespace-nowrap flex-shrink-0 ${
                activeTab === 'nova'
                  ? 'bg-[#F39C12] text-[#0D2B4E]'
                  : 'bg-white/10 text-white/70 hover:bg-white/20'
              }`}
            >
              📝 Nova Inscrição
            </button>
            <button
              type="button"
              onClick={() => trocarAba('inscritos')}
              className={`px-4 py-2 rounded-xl text-sm font-bold transition whitespace-nowrap flex-shrink-0 ${
                activeTab === 'inscritos'
                  ? 'bg-[#F39C12] text-[#0D2B4E]'
                  : 'bg-white/10 text-white/70 hover:bg-white/20'
              }`}
            >
              👥 Inscritos
            </button>
            <button
              type="button"
              onClick={() => trocarAba('caixa')}
              className={`px-4 py-2 rounded-xl text-sm font-bold transition whitespace-nowrap flex-shrink-0 ${
                activeTab === 'caixa'
                  ? 'bg-[#F39C12] text-[#0D2B4E]'
                  : 'bg-white/10 text-white/70 hover:bg-white/20'
              }`}
            >
              💵 Meu Caixa
            </button>
          </div>
        </div>
      </div>

      {/* ── Corpo principal ── */}
      <div className="flex-1 overflow-y-auto">
        <div className={`mx-auto p-4 lg:p-6 ${activeTab === 'inscritos' ? 'max-w-[1400px]' : 'max-w-5xl'}`}>

          {activeTab === 'nova' && inscricaoSalva && (
            <ConfirmacaoScreen
              inscricao={inscricaoSalva}
              evento={evento}
              nomeSup={nomeSup(inscricaoSalva.supervisao_id)}
              nomeCampo={nomeCampo(inscricaoSalva.campo_id)}
              valorFinal={valorFinal}
              formaPagamento={form.forma_pagamento}
              asaasData={asaasData}
              contadorTotal={contadorTotal}
              onNova={() => { limparTudo(); setActiveTab('nova'); }}
              onImprimir={imprimirCracha}
              onVerLista={verNaListaInscritos}
            />
          )}

          {activeTab === 'nova' && !inscricaoSalva && (
            <>
              {/* ── Bloco 1: Busca CPF ── */}
              <section className="bg-[#123b63] rounded-2xl p-5 mb-4 border border-white/10">
            <h2 className="text-white font-bold text-sm mb-3 flex items-center gap-2">
              <span className="w-6 h-6 bg-[#F39C12] text-[#0D2B4E] rounded-full flex items-center justify-center text-xs font-black">1</span>
              Identificação
            </h2>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                ref={cpfRef}
                type="text"
                placeholder="Digite CPF e pressione Enter"
                value={cpfBusca}
                onChange={e => handleCpfBuscaChange(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && buscarCPF()}
                className={inputCls + ' w-full sm:flex-1'}
                autoFocus
              />
              <button
                onClick={() => buscarCPF()}
                disabled={buscando || cpfBusca.replace(/\D/g, '').length !== 11}
                className="w-full sm:w-auto bg-[#F39C12] hover:bg-[#D68910] disabled:opacity-40 text-[#0D2B4E] font-bold px-5 py-2.5 rounded-lg text-sm transition flex-shrink-0 whitespace-nowrap"
              >
                {buscando ? '...' : '🔍 Buscar'}
              </button>
            </div>
            {ministroEncontrado && (
              <div className="mt-2 bg-emerald-900/50 border border-emerald-500/30 rounded-lg px-4 py-2 text-sm text-emerald-300 flex items-center gap-2">
                <span className="text-emerald-400">✅</span>
                <span>Ministro encontrado: <strong>{nomeMinistro}</strong></span>
              </div>
            )}
            {cpfStatus === 'nao_encontrado' && (
              <div className="mt-2 bg-amber-900/50 border border-amber-500/40 rounded-lg px-4 py-2.5 text-sm text-amber-200 flex items-center gap-2">
                <span>⚠️</span>
                <span>CPF não localizado no cadastro ministerial. A inscrição continuará como visitante.</span>
              </div>
            )}
            {esposaJubiladoAutomaticoAtivo && (
              <div className="mt-2 bg-emerald-900/50 border border-emerald-500/40 rounded-lg px-4 py-2.5 text-sm text-emerald-200 flex items-center gap-2">
                <span>✅</span>
                <span>Esposa de Pastor Jubilado identificada por CPF do cônjuge. Cortesia aplicada automaticamente.</span>
              </div>
            )}
            {/* Alerta de CPF já inscrito neste evento */}
            {inscricaoDuplicada && (
              <div className="mt-3 bg-amber-900/70 border-2 border-amber-500/60 rounded-xl px-4 py-3 flex items-start gap-3">
                <span className="text-2xl flex-shrink-0">⚠️</span>
                <div className="flex-1">
                  <p className="text-amber-300 font-black text-sm">CPF já inscrito neste evento</p>
                  <p className="text-amber-200/80 text-xs mt-0.5">
                    <strong className="text-amber-100">{inscricaoDuplicada.nome}</strong> já possui inscrição.
                    Confirme antes de criar uma nova.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    ignorarProximoClearRef.current = true;
                    setFiltroPag('');
                    setFiltroSup('');
                    setFiltroCampo('');
                    setBuscaLista(cpfBusca.replace(/\D/g, ''));
                    setDestacarId(inscricaoDuplicada.id);
                    setActiveTab('inscritos');
                  }}
                  className="flex-shrink-0 text-xs bg-amber-500/20 hover:bg-amber-500/40 border border-amber-500/50 text-amber-300 px-3 py-1.5 rounded-lg font-bold transition whitespace-nowrap"
                >
                  Ver inscrição ↗
                </button>
              </div>
            )}
          </section>

          {/* ── Bloco 2: Dados pessoais ── */}
          <section className="bg-[#123b63] rounded-2xl p-5 mb-4 border border-white/10">
            <h2 className="text-white font-bold text-sm mb-3 flex items-center gap-2">
              <span className="w-6 h-6 bg-[#F39C12] text-[#0D2B4E] rounded-full flex items-center justify-center text-xs font-black">2</span>
              Dados do Inscrito
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <div className="lg:col-span-2">
                <label className={labelCls}>Nome completo *</label>
                <input
                  ref={nomeRef}
                  name="nome"
                  value={form.nome}
                  onChange={handleText}
                  onKeyDown={e => e.key === 'Enter' && supRef.current?.focus()}
                  className={inputCls}
                  placeholder="Nome completo"
                  required
                />
              </div>
              <div>
                <label className={labelCls}>Sexo</label>
                {evento.departamento === 'AGO' && (ministroInfo || esposaJubiladoAutomaticoAtivo) ? (
                  <div className={inputCls + ' cursor-default opacity-70'}>
                    {form.sexo === 'M' ? 'Masculino' : form.sexo === 'F' ? 'Feminino' : '-'}
                  </div>
                ) : (
                  <select name="sexo" value={form.sexo} onChange={handleText} className={inputCls}>
                    <option value="">-</option>
                    <option value="M">Masculino</option>
                    <option value="F">Feminino</option>
                  </select>
                )}
              </div>
              {/* Card ministerial AGO */}
              {evento.departamento === 'AGO' && cpfStatus === 'encontrado' && ministroInfo && (
                <div className={`col-span-1 sm:col-span-2 lg:col-span-3 p-4 rounded-xl border ${ministroAtivo ? 'bg-emerald-900/30 border-emerald-500/40' : 'bg-amber-900/30 border-amber-500/40'}`}>
                  <div className="flex items-center justify-between mb-2">
                    <p className={`text-xs font-bold uppercase tracking-wide ${ministroAtivo ? 'text-emerald-300' : 'text-amber-300'}`}>
                      {ministroAtivo ? '✅ Ministro COMIEADEPA identificado' : '⚠️ Registro ministerial (inativo)'}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                    {ministroInfo.matricula && (
                      <div><span className="text-white/50">Matrícula: </span><strong className="text-white">{ministroInfo.matricula}</strong></div>
                    )}
                    {ministroInfo.cargoMinisterial && (
                      <div><span className="text-white/50">Cargo: </span><strong className="text-white">{ministroInfo.cargoMinisterial}</strong></div>
                    )}
                    {form.supervisao_id && (
                      <div><span className="text-white/50">Supervisão: </span><strong className="text-white">{supervisoes.find(s => s.id === form.supervisao_id)?.nome ?? '-'}</strong></div>
                    )}
                    {form.campo_id && (
                      <div><span className="text-white/50">Campo: </span><strong className="text-white">{campos.find(c => c.id === form.campo_id)?.nome ?? '-'}</strong></div>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {ministroInfo.isPastorPresidente && <span className="bg-amber-500/20 text-amber-300 border border-amber-500/40 px-2 py-0.5 rounded-full text-xs font-bold">⭐ Pastor Presidente</span>}
                    {ministroInfo.isPastorAuxiliar && <span className="bg-blue-500/20 text-blue-300 border border-blue-500/40 px-2 py-0.5 rounded-full text-xs font-bold">Pastor Auxiliar</span>}
                    {ministroInfo.isJubilado && <span className="bg-purple-500/20 text-purple-300 border border-purple-500/40 px-2 py-0.5 rounded-full text-xs font-bold">🏅 Jubilado</span>}
                    {ministroInfo.isCampoMissionario && <span className="bg-green-500/20 text-green-300 border border-green-500/40 px-2 py-0.5 rounded-full text-xs font-bold">🌿 Campo Missionário</span>}
                  </div>
                  {ministroInativo && (
                    <div className="mt-2 p-2 bg-amber-900/30 border border-amber-500/30 rounded-lg text-xs text-amber-200">
                      Registro não ativo. Categorias ministeriais (Presidente, Auxiliar, Jubilado) não disponíveis.
                    </div>
                  )}
                </div>
              )}
              <div>
                <label className={labelCls}>WhatsApp</label>
                <input name="whatsapp" value={form.whatsapp} onChange={handleText} className={inputCls} placeholder="(00) 00000-0000" />
              </div>
              <div>
                <label className={labelCls}>E-mail</label>
                <input name="email" type="email" value={form.email} onChange={handleText} className={inputCls} placeholder="email@exemplo.com" />
              </div>
              {!(evento.departamento === 'AGO' && ministroInfo) && <div />}
              <div>
                <label className={labelCls}>Supervisão *</label>
                {evento.departamento === 'AGO' && ministroInfo ? (
                  <div className={inputCls + ' cursor-default opacity-70'}>
                    {supervisoes.find(s => s.id === form.supervisao_id)?.nome ?? '-'}
                  </div>
                ) : (
                  <select
                    ref={supRef}
                    name="supervisao_id"
                    value={form.supervisao_id}
                    onChange={e => { handleText(e); setForm(f => ({ ...f, campo_id: '' })); }}
                    className={inputCls}
                  >
                    <option value="">Selecione...</option>
                    {supervisoes.map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}
                  </select>
                )}
              </div>
              <div>
                <label className={labelCls}>Campo</label>
                {evento.departamento === 'AGO' && ministroInfo && form.campo_id ? (
                  <div className={inputCls + ' cursor-default opacity-70'}>
                    {campos.find(c => c.id === form.campo_id)?.nome ?? '-'}
                  </div>
                ) : (
                  <select name="campo_id" value={form.campo_id ?? ''} onChange={handleText} className={inputCls}>
                    <option value="">Selecione...</option>
                    {camposFiltrados.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                  </select>
                )}
              </div>
            </div>
          </section>

          {/* ── Bloco 3: Tipo + Serviços ── */}
          <section className="bg-[#123b63] rounded-2xl p-5 mb-4 border border-white/10">
            <h2 className="text-white font-bold text-sm mb-3 flex items-center gap-2">
              <span className="w-6 h-6 bg-[#F39C12] text-[#0D2B4E] rounded-full flex items-center justify-center text-xs font-black">3</span>
              Inscrição
            </h2>

            {/* Alerta: ministro ativo sem perfil ministerial definido */}
            {ministroSemPerfil && (
              <div className="mb-4 bg-amber-500/15 border border-amber-500/50 rounded-xl px-4 py-3 flex items-start gap-3">
                <span className="text-xl flex-shrink-0">⚠️</span>
                <div className="text-sm">
                  <p className="font-bold text-amber-300">Perfil ministerial não definido para esta AGO</p>
                  <p className="text-amber-200/80 mt-0.5">Ministro localizado, mas nenhuma das flags <strong>Pastor Presidente</strong>, <strong>Pastor Auxiliar</strong> ou <strong>Jubilado</strong> está ativa no cadastro. Verifique o perfil do ministro antes de salvar.</p>
                </div>
              </div>
            )}

            {jubiladoAutomaticoAtivo && tipoJubiladoAutomatico && (
              <div className="mb-4 bg-indigo-500/15 border border-indigo-400/50 rounded-xl px-4 py-3 text-sm text-indigo-100">
                Categoria Jubilado aplicada automaticamente pelo cadastro ministerial.
              </div>
            )}

            {esposaJubiladoAutomaticoAtivo && (
              <div className="mb-4 bg-emerald-500/15 border border-emerald-400/50 rounded-xl px-4 py-3 text-sm text-emerald-100">
                Esposa de Pastor Jubilado identificada pelo cadastro ministerial. Categoria de cortesia aplicada automaticamente.
              </div>
            )}

            {/* Tipos de inscrição */}
            {temTipos && (
              <div className="mb-4">
                <label className={labelCls}>Tipo de inscrição</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {tiposParaExibir.map(t => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => {
                        const newTipoId = form.tipo_id === t.id ? '' : t.id;
                        setField('tipo_id', newTipoId);
                        if (newTipoId === 'equipe_apoio') {
                          setField('forma_pagamento', 'isento');
                          setField('hospedagem', false);
                        } else if (form.forma_pagamento === 'isento' && form.tipo_id === 'equipe_apoio') {
                          setField('forma_pagamento', 'dinheiro');
                        }
                      }}
                      className={`text-left rounded-xl border-2 px-4 py-3 transition ${
                        form.tipo_id === t.id
                          ? 'border-[#F39C12] bg-[#F39C12]/10 text-white'
                          : 'border-white/20 hover:border-white/40 text-white/70'
                      }`}
                    >
                      <p className="font-semibold text-sm">{t.nome}</p>
                      <p className="text-xs mt-0.5 opacity-70">
                        {(() => {
                          if (t.id === 'equipe_apoio') return 'Gratuito • Sem hospedagem';
                          const isPPT = /pastor\s*presidente/i.test(t.nome) && !/esposa|viuva/i.test(t.nome);
                          let vExib = t.valor;
                          if (descontoCampoMissionario && isPPT && evento?.configuracoes_ago) {
                            const cmConfig = parseCampoMissionarioConfig(evento.configuracoes_ago);
                            const valorM = cmConfig
                              ? (typeof cmConfig.valor_pastor_presidente === 'number' ? cmConfig.valor_pastor_presidente : parseFloat(String(cmConfig.valor_pastor_presidente)) || 0)
                              : parseFloat(String(evento.configuracoes_ago.valor_pastor_presidente_campo_missionario ?? '0')) || 0;
                            if (valorM > 0) vExib = valorM;
                          }
                          return vExib === 0 ? 'Gratuito' : fmtMoeda(vExib);
                        })()}
                        {t.id !== 'equipe_apoio' && t.inclui_alimentacao && ' · Alim.'}
                        {t.id !== 'equipe_apoio' && t.inclui_hospedagem  && ' · Hosp.'}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {form.tipo_id === 'equipe_apoio' && (
              <div className="mb-4 bg-white/5 border border-white/10 rounded-xl p-4 flex flex-col sm:flex-row sm:items-end gap-3 transition animate-fade-in">
                <div className="flex-1">
                  <label className="block text-xs font-semibold text-white/75 mb-1.5 uppercase tracking-wide">
                    Equipe de Trabalho * (Obrigatório)
                  </label>
                  <select
                    value={equipeApoioSelecionada}
                    onChange={(e) => setEquipeApoioSelecionada(e.target.value)}
                    className="w-full border border-white/20 rounded-lg px-3 py-2.5 text-sm bg-[#0D2B4E] text-white focus:outline-none focus:ring-2 focus:ring-[#F39C12]"
                    required
                  >
                    {equipesApoio.map((eq) => (
                      <option key={eq} value={eq}>
                        {eq}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  onClick={handleAdicionarEquipe}
                  className="bg-[#F39C12] hover:bg-[#D68910] text-[#0D2B4E] font-bold px-4 py-2.5 rounded-lg text-sm transition flex items-center justify-center gap-1 self-stretch sm:self-auto"
                >
                  <span className="text-lg font-black leading-none">+</span> Nova Equipe
                </button>
              </div>
            )}

            {/* Opcionais da inscrição */}
            {podeHospedagem && (
              <div className="mt-3 p-3 bg-white/5 border border-white/10 rounded-xl">
                <label className="flex items-start gap-3 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={form.hospedagem}
                    onChange={e => setField('hospedagem', e.target.checked)}
                    className="mt-0.5 accent-amber-400 w-4 h-4"
                  />
                  <div>
                    <span className="text-sm font-semibold text-white/80">🏨 Desejo solicitar hospedagem</span>
                    <p className="text-xs text-white/40 mt-0.5">
                      A solicitação não garante alocação. A organização fará a distribuição conforme disponibilidade.
                      {evento.departamento === 'AGO' && grupoHospedagemPrevisto ? (
                        grupoHospedagemPrevisto === 'Misto' ? (
                          ' (Informe sexo/data/perfil para verificar vagas de hospedagem.)'
                        ) : (
                          ` (Grupo: ${grupoHospedagemPrevisto} - ${(vagasPorGrupo[grupoHospedagemPrevisto] ?? 0)} vagas restantes)`
                        )
                      ) : (
                        evento.limite_hospedagem !== null && ` (${evento.limite_hospedagem} vagas totais)`
                      )}
                    </p>
                    {evento.departamento === 'AGO' && grupoHospedagemPrevisto && grupoHospedagemPrevisto !== 'Misto' && (vagasPorGrupo[grupoHospedagemPrevisto] ?? 0) <= 0 && (
                      <p className="text-xs text-red-400 font-bold mt-1.5">
                        ⚠️ Não há mais vagas de hospedagem disponíveis para o grupo {grupoHospedagemPrevisto}. Você ainda pode concluir a inscrição sem hospedagem.
                      </p>
                    )}
                  </div>
                </label>
              </div>
            )}

            {evento.permite_alimentacao && (
              <div className="mt-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3">
                <p className="text-xs font-semibold text-amber-300 uppercase tracking-wide">Alimentação</p>
                <p className="text-sm text-amber-100 mt-1">
                  {evento.departamento === 'AGO'
                    ? 'Alimentação inclusa automaticamente para todos os inscritos da AGO — 12 refeições.'
                    : tipoSel
                      ? (tipoSel.inclui_alimentacao
                        ? 'Incluída automaticamente pela categoria selecionada.'
                        : 'Não incluída para a categoria selecionada.')
                      : 'Definida automaticamente pela categoria de inscrição.'}
                </p>
              </div>
            )}

            {/* Brinde avulso */}
            {evento.permite_brinde && (
              <div className="mt-2 flex gap-3">
                <ToggleService
                  label="🎁 Brinde"
                  active={form.brinde}
                  onClick={() => setField('brinde', !form.brinde)}
                />
              </div>
            )}

            {/* Campos AGO — aparecem SOMENTE quando AGO + checkbox hospedagem marcado */}
            {evento.departamento === 'AGO' && evento.permite_hospedagem && form.hospedagem && (
              <div className="mt-4 border border-amber-500/40 bg-amber-500/10 rounded-xl p-4 space-y-3">
                <p className="text-amber-300 text-xs font-bold uppercase tracking-wider">🏨 Hospedagem AGO</p>

                {/* Necessidade especial */}
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input type="checkbox" checked={form.hosp_necessidade_especial}
                    onChange={e => setField('hosp_necessidade_especial', e.target.checked)}
                    className="mt-0.5 accent-amber-400" />
                  <span className="text-sm text-white/80">
                    Possui <strong className="text-white">necessidade especial</strong>
                    <span className="block text-xs text-white/40">mobilidade reduzida, coluna, cirurgia recente…</span>
                  </span>
                </label>

                {form.hosp_necessidade_especial && (
                  <div>
                    <label className={labelCls + ' text-amber-300'}>Descreva a necessidade *</label>
                    <input
                      value={form.hosp_descricao_necessidade}
                      onChange={e => setField('hosp_descricao_necessidade', e.target.value)}
                      placeholder="Ex: usa andador, dificuldade em escadas..."
                      className={inputCls + ' border-amber-500/50'}
                    />
                  </div>
                )}

                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input type="checkbox" checked={form.hosp_possui_comorbidade}
                    onChange={e => setField('hosp_possui_comorbidade', e.target.checked)}
                    className="mt-0.5 accent-amber-400" />
                  <span className="text-sm text-white/80">
                    Possui <strong className="text-white">comorbidade relevante</strong>
                    <span className="block text-xs text-white/40">diabetes, hipertensão, cardiopatia, etc.</span>
                  </span>
                </label>

                {form.hosp_possui_comorbidade && (
                  <div>
                    <label className={labelCls + ' text-amber-300'}>Descreva a comorbidade *</label>
                    <input
                      value={form.hosp_descricao_comorbidade}
                      onChange={e => setField('hosp_descricao_comorbidade', e.target.value)}
                      placeholder="Ex: hipertensao controlada"
                      className={inputCls + ' border-amber-500/50'}
                    />
                  </div>
                )}

                <div className="rounded-xl border border-amber-500/40 bg-black/10 px-3 py-2">
                  <p className="text-xs font-bold uppercase tracking-wide text-amber-300">Grupo previsto</p>
                  <p className="text-sm text-white mt-1">
                    {evento.departamento === 'AGO' && grupoHospedagemPrevisto === 'Misto'
                      ? 'Informe sexo/data/perfil para verificar vagas de hospedagem.'
                      : grupoHospedagemPrevisto}
                  </p>
                  <p className="text-xs text-white/60 mt-1">
                    Cama inferior e grupo final sao definidos automaticamente pela organizacao conforme idade, necessidade especial e categoria.
                  </p>
                </div>

                {/* Observações hospedagem */}
                <div>
                  <label className={labelCls + ' text-amber-300'}>Observações (opcional)</label>
                  <textarea
                    value={form.hosp_observacoes}
                    onChange={e => setField('hosp_observacoes', e.target.value)}
                    rows={2}
                    placeholder="Informações adicionais para a equipe de hospedagem..."
                    className={inputCls + ' resize-none border-amber-500/50'}
                  />
                </div>
              </div>
            )}
          </section>

          {/* ── Bloco AGO: Esposa (Campo Missionário) ── */}
          {evento.departamento === 'AGO' && descontoCampoMissionario && ministroAtivo && ministroInfo?.isPastorPresidente && (
            <section className="bg-[#1a2a50] rounded-2xl p-5 mb-4 border border-purple-500/30">
              <h2 className="text-white font-bold text-sm mb-3 flex items-center gap-2">
                <span className="w-6 h-6 bg-purple-500 text-white rounded-full flex items-center justify-center text-xs font-black">👩</span>
                Esposa — Campo Missionário
                <span className="text-white/30 text-xs font-normal">(opcional)</span>
              </h2>

              <label className="flex items-center gap-3 cursor-pointer select-none mb-4">
                <input type="checkbox" checked={incluirEsposa}
                  onChange={e => { setIncluirEsposa(e.target.checked); if (!e.target.checked) setHospEsposa({ ...HOSP_ESPOSA_VAZIO }); }}
                  className="accent-purple-400 w-4 h-4" />
                <div>
                  <span className="text-sm font-semibold text-white">Incluir inscrição da esposa</span>
                  {valorEsposaBase > 0 && (
                    <span className="ml-2 text-xs text-purple-300">+{fmtMoeda(valorEsposaBase)}</span>
                  )}
                </div>
              </label>

              {incluirEsposa && (
                <div className="space-y-3">
                  <div>
                    <label className={labelCls}>Nome completo *</label>
                    <input value={formEsposa.nome} onChange={e => setFormEsposa(f => ({ ...f, nome: e.target.value }))}
                      placeholder="Nome completo da esposa" className={inputCls} />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className={labelCls}>CPF</label>
                      <input value={formEsposa.cpf} onChange={e => setFormEsposa(f => ({ ...f, cpf: e.target.value }))}
                        placeholder="000.000.000-00" maxLength={14} className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>Nasc.</label>
                      <input type="date" value={formEsposa.data_nascimento}
                        onChange={e => setFormEsposa(f => ({ ...f, data_nascimento: e.target.value }))}
                        className={inputCls} />
                    </div>
                  </div>
                  <div>
                    <label className={labelCls}>WhatsApp</label>
                    <input value={formEsposa.whatsapp} onChange={e => setFormEsposa(f => ({ ...f, whatsapp: e.target.value }))}
                      placeholder="(00) 00000-0000" className={inputCls} />
                  </div>

                  {/* Hospedagem da esposa */}
                  {evento.permite_hospedagem && (() => {
                    const esposaVagasGrupo = grupoHospedagemEsposaPrevisto ? (vagasPorGrupo[grupoHospedagemEsposaPrevisto] ?? 0) : 0;
                    const esposaGrupoEsgotado = evento.departamento === 'AGO' && grupoHospedagemEsposaPrevisto && esposaVagasGrupo <= 0;
                    return (
                      <div className="mt-3 p-3 bg-amber-500/10 border border-amber-500/40 rounded-xl space-y-2">
                        <label className="flex items-start gap-3 cursor-pointer select-none">
                          <input type="checkbox" checked={hospEsposa.solicitar}
                            onChange={e => setHospEsposa(h => ({ ...h, solicitar: e.target.checked }))}
                            className="mt-0.5 accent-amber-400 w-4 h-4" />
                          <div>
                            <span className="text-sm text-white/80">🛏️ Solicitar hospedagem para a esposa</span>
                            <p className="text-xs text-white/40 mt-0.5">
                              A hospedagem é independente — cada inscrição decide individualmente.
                              {evento.departamento === 'AGO' && grupoHospedagemEsposaPrevisto && (
                                grupoHospedagemEsposaPrevisto === 'Misto' ? (
                                  ' (Informe sexo/data/perfil para verificar vagas de hospedagem.)'
                                ) : (
                                  ` (Grupo: ${grupoHospedagemEsposaPrevisto} - ${esposaVagasGrupo} vagas restantes)`
                                )
                              )}
                            </p>
                            {esposaGrupoEsgotado && grupoHospedagemEsposaPrevisto !== 'Misto' && (
                              <p className="text-xs text-red-400 font-bold mt-1.5">
                                ⚠️ Não há mais vagas de hospedagem disponíveis para o grupo {grupoHospedagemEsposaPrevisto}. Você ainda pode concluir a inscrição sem hospedagem.
                              </p>
                            )}
                          </div>
                        </label>
                        {hospEsposa.solicitar && (
                          <>
                            <label className="flex items-start gap-2.5 cursor-pointer">
                              <input type="checkbox" checked={hospEsposa.hosp_necessidade_especial}
                                onChange={e => setHospEsposa(h => ({ ...h, hosp_necessidade_especial: e.target.checked }))}
                                className="mt-0.5 accent-amber-400" />
                              <span className="text-sm text-white/80">Necessidade especial de acessibilidade</span>
                            </label>
                            {hospEsposa.hosp_necessidade_especial && (
                              <input value={hospEsposa.hosp_descricao_necessidade}
                                onChange={e => setHospEsposa(h => ({ ...h, hosp_descricao_necessidade: e.target.value }))}
                                placeholder="Descreva a necessidade..." className={inputCls + ' border-amber-500/50'} />
                            )}
                            <div className="rounded-xl border border-amber-500/40 bg-black/10 px-3 py-2">
                              <p className="text-xs font-bold uppercase tracking-wide text-amber-300">Grupo previsto da esposa</p>
                              <p className="text-sm text-white mt-1">
                                {evento.departamento === 'AGO' && grupoHospedagemEsposaPrevisto === 'Misto'
                                  ? 'Informe sexo/data/perfil para verificar vagas de hospedagem.'
                                  : grupoHospedagemEsposaPrevisto}
                              </p>
                              <p className="text-xs text-white/60 mt-1">A cama inferior final sera definida automaticamente pela organizacao.</p>
                            </div>
                            <textarea value={hospEsposa.hosp_observacoes}
                              onChange={e => setHospEsposa(h => ({ ...h, hosp_observacoes: e.target.value }))}
                              rows={2} placeholder="Observações de hospedagem..." className={inputCls + ' resize-none border-amber-500/50'} />
                          </>
                        )}
                      </div>
                    );
                  })()}
                </div>
              )}
            </section>
          )}

          {/* ── Bloco 4: Cupom ── */}
          <section className="bg-[#123b63] rounded-2xl p-5 mb-4 border border-white/10">
            <h2 className="text-white font-bold text-sm mb-3 flex items-center gap-2">
              <span className="w-6 h-6 bg-[#F39C12] text-[#0D2B4E] rounded-full flex items-center justify-center text-xs font-black">4</span>
              Cupom de Desconto
              <span className="text-white/30 text-xs font-normal">(opcional)</span>
            </h2>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                name="cupom"
                value={form.cupom}
                onChange={e => { handleText(e); if (cupomStatus !== 'idle') { setCupomStatus('idle'); setCupomDesconto(0); setCupomMsg(''); } }}
                onKeyDown={e => e.key === 'Enter' && validarCupom()}
                className={inputCls + ' uppercase w-full sm:flex-1'}
                placeholder="Código do cupom"
                disabled={cupomStatus === 'ok'}
              />
              {cupomStatus === 'ok' ? (
                <button onClick={removerCupom} className="w-full sm:w-auto bg-red-600 hover:bg-red-700 text-white px-4 py-2.5 rounded-lg text-sm font-semibold transition flex-shrink-0">
                  ✕ Remover
                </button>
              ) : (
                <button
                  onClick={validarCupom}
                  disabled={!form.cupom.trim() || cupomStatus === 'validando'}
                  className="w-full sm:w-auto bg-[#F39C12] hover:bg-[#D68910] disabled:opacity-40 text-[#0D2B4E] font-bold px-5 py-2.5 rounded-lg text-sm transition flex-shrink-0"
                >
                  {cupomStatus === 'validando' ? '...' : 'Aplicar'}
                </button>
              )}
            </div>
            {cupomMsg && (
              <p className={`mt-2 text-xs font-semibold ${cupomStatus === 'ok' ? 'text-emerald-400' : 'text-red-400'}`}>
                {cupomMsg}
              </p>
            )}
          </section>

          {/* ── Bloco 5: Pagamento ── */}
          {form.tipo_id !== 'equipe_apoio' && (
            <section className="bg-[#123b63] rounded-2xl p-5 mb-4 border border-white/10">
              <h2 className="text-white font-bold text-sm mb-3 flex items-center gap-2">
                <span className="w-6 h-6 bg-[#F39C12] text-[#0D2B4E] rounded-full flex items-center justify-center text-xs font-black">5</span>
                Pagamento
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2 mb-4">
                {[
                  { id: 'dinheiro',     label: '💵 Dinheiro'  },
                  { id: 'pix_manual',   label: '📱 PIX Manual' },
                  { id: 'cartao',       label: '💳 Cartão'    },
                  { id: 'isento',       label: '🎟️ Isento'    },
                  { id: 'asaas',        label: '🔗 ASAAS'     },
                ].map(op => (
                  <button
                    key={op.id}
                    type="button"
                    onClick={() => setField('forma_pagamento', op.id)}
                    className={`rounded-xl border-2 px-3 py-3 text-sm font-semibold transition ${
                      form.forma_pagamento === op.id
                        ? 'border-[#F39C12] bg-[#F39C12]/10 text-white'
                        : 'border-white/20 hover:border-white/40 text-white/60'
                    }`}
                  >
                    {op.label}
                  </button>
                ))}
              </div>
              {form.forma_pagamento === 'asaas' && (
                <p className="text-xs text-[#F39C12]/80 bg-[#F39C12]/10 rounded-lg px-3 py-2">
                  ⚡ Será gerada cobrança ASAAS. O link de pagamento aparecerá na confirmação.
                </p>
              )}
            </section>
          )}

          {/* ── Bloco 6: Observações ── */}
          <section className="bg-[#123b63] rounded-2xl p-4 mb-4 border border-white/10">
            <label className={labelCls}>Observações (opcional)</label>
            <textarea
              name="observacoes"
              value={form.observacoes}
              onChange={handleText}
              rows={2}
              className={inputCls + ' resize-none'}
              placeholder="Anotações da inscrição..."
            />
          </section>

          {/* ── Rodapé: Valor + Botão ── */}
          <div className="relative sticky bottom-0 bg-[#0a2040] border-t border-white/10 p-4 flex flex-col sm:flex-row items-center gap-4">
            {/* Resumo do valor */}
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                {valorBase > 0 && cupomDesconto > 0 && (
                  <div className="text-white/40 text-sm line-through">{fmtMoeda(valorBase)}</div>
                )}
                <div className={`text-3xl font-black ${valorFinal <= 0 || form.forma_pagamento === 'isento' ? 'text-emerald-400' : 'text-[#F39C12]'}`}>
                  {valorFinal <= 0 || form.forma_pagamento === 'isento' ? 'GRATUITO' : fmtMoeda(valorFinal)}
                </div>
                {cupomDesconto > 0 && (
                  <div className="bg-emerald-900/50 text-emerald-400 text-xs font-bold px-2 py-1 rounded-full border border-emerald-500/30">
                    −{fmtMoeda(cupomDesconto)}
                  </div>
                )}
                {tipoSel && (
                  <div className="text-white/50 text-xs bg-white/5 px-2 py-1 rounded-full truncate max-w-[150px]">{tipoSel.nome}</div>
                )}
              </div>
              <p className="text-white/30 text-xs mt-1">{form.forma_pagamento === 'asaas' ? 'Cobrança via ASAAS' : form.forma_pagamento === 'isento' ? 'Isento' : 'Pago na hora'}</p>
            </div>

            {/* Botões */}
            <div className="flex gap-2 flex-shrink-0 w-full sm:w-auto">
              <button
                type="button"
                onClick={() => limparTudo()}
                className="flex-1 sm:flex-none border border-white/20 text-white/60 hover:text-white hover:border-white/40 px-5 py-3.5 rounded-xl text-sm font-semibold transition"
                title="Esc"
              >
                🗑️ Limpar
              </button>
              <button
                id="btn-confirmar"
                type="button"
                onClick={salvar}
                disabled={salvando || !form.nome.trim() || !form.supervisao_id}
                className="flex-1 sm:flex-none bg-emerald-500 hover:bg-emerald-400 active:scale-95 disabled:opacity-40 text-white font-black px-8 py-3.5 rounded-xl text-base transition"
                title="Ctrl+Enter"
              >
                {salvando ? (
                  <span className="flex items-center gap-2 justify-center"><span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> Salvando...</span>
                ) : (
                  '✅ Confirmar Inscrição'
                )}
              </button>
            </div>

            {erroSave && (
              <div className="w-full bg-red-600 border border-red-400 text-white px-4 py-3 rounded-xl text-sm font-bold flex items-start gap-2">
                <span className="text-xl flex-shrink-0">🚨</span>
                <span className="flex-1">{erroSave}</span>
                <button onClick={() => setErroSave(null)} className="ml-2 text-white/70 hover:text-white text-lg leading-none flex-shrink-0">×</button>
              </div>
            )}
          </div>
            </>
          )}

          {activeTab === 'inscritos' && (
            <div className="space-y-4">
              <div className="bg-[#123b63] rounded-2xl border border-white/10 p-4">
                <div className="flex flex-wrap gap-2">
                  <input
                    type="text"
                    placeholder="🔍 Buscar nome, CPF, WhatsApp"
                    value={buscaLista}
                    onChange={e => setBuscaLista(e.target.value)}
                    className={inputCls + ' w-full sm:flex-1 sm:min-w-[220px]'}
                  />
                  <select
                    value={filtroSup}
                    onChange={e => { setFiltroSup(e.target.value); setFiltroCampo(''); }}
                    className={inputCls + ' w-full sm:w-44'}
                  >
                    <option value="">Todas supervisões</option>
                    {supervisoesLista.map(s => (
                      <option key={s.id} value={s.id}>{s.nome}</option>
                    ))}
                  </select>
                  <select
                    value={filtroCampo}
                    onChange={e => setFiltroCampo(e.target.value)}
                    className={inputCls + ' w-full sm:w-44'}
                  >
                    <option value="">Todos campos</option>
                    {camposLista.map(c => (
                      <option key={c.id} value={c.id}>{c.nome}</option>
                    ))}
                  </select>
                  <select
                    value={filtroPag}
                    onChange={e => setFiltroPag(e.target.value)}
                    className={inputCls + ' w-full sm:w-40'}
                  >
                    <option value="">Pagamento</option>
                    <option value="pendente">Pendente</option>
                    <option value="pago">Pago</option>
                    <option value="isento">Isento</option>
                    <option value="cancelado">Cancelado</option>
                  </select>
                  <button
                    type="button"
                    onClick={limparFiltrosLista}
                    className="w-full sm:w-auto px-4 py-2.5 rounded-lg text-xs font-bold bg-white/10 text-white/70 hover:bg-white/20 transition"
                  >
                    Limpar
                  </button>
                  <button
                    type="button"
                    onClick={() => fetchInscricoesLista()}
                    disabled={loadingLista}
                    className="w-full sm:w-auto px-4 py-2.5 rounded-lg text-xs font-bold bg-[#F39C12] text-[#0D2B4E] hover:bg-[#D68910] disabled:opacity-50 transition"
                  >
                    {loadingLista ? 'Atualizando...' : 'Atualizar'}
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-3 mt-3 text-xs text-white/50">
                  <span>{inscritosFiltrados.length} inscrito(s)</span>
                  {precisaAtualizar && <span className="text-amber-300">Lista pendente de atualizacao</span>}
                </div>
                {listaMsg && (
                  <div className={`mt-3 text-xs font-bold px-3 py-2 rounded-lg border ${
                    listaMsg.tipo === 'ok'
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                      : listaMsg.tipo === 'aviso'
                      ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                      : 'bg-red-500/10 border-red-500/30 text-red-300'
                  }`}>
                    {listaMsg.texto}
                  </div>
                )}
                {listaErro && (
                  <div className="mt-3 text-xs font-bold px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300">
                    {listaErro}
                  </div>
                )}
              </div>

              {loadingLista ? (
                <div className="bg-[#123b63] rounded-2xl border border-white/10 p-6 text-white/60 text-sm">
                  Carregando inscritos...
                </div>
              ) : inscritosFiltrados.length === 0 ? (
                <div className="bg-[#123b63] rounded-2xl border border-white/10 p-6 text-white/60 text-sm">
                  Nenhum inscrito encontrado com os filtros atuais.
                </div>
              ) : (
                <>
                  <div className="bg-[#123b63] rounded-2xl border border-white/10 overflow-x-auto">
                  <table className="min-w-[1100px] w-full text-sm">
                    <thead className="bg-[#0a2040] text-white/70">
                      <tr>
                        {['Nome', 'Campo', 'Valor', 'Pagamento', 'Etiqueta', 'Ações'].map(h => (
                          <th key={h} className="text-left px-3 py-3 text-xs font-semibold whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {inscritosPaginados.map(ins => {
                        const pagCfg = PAGAMENTO_CFG[ins.status_pagamento] ?? PAGAMENTO_CFG.pendente;
                        const valorExib = ins.lote_id 
                          ? (ins.valor_final ?? ins.valor_original ?? ins.valor_pago ?? 0)
                          : (ins.valor_pago ?? ins.valor_final ?? 0);
                        const isDestaque = ins.id === destacarId;
                        const podeCert = perfil.podeCertificados && evento.gerar_certificado;
                        const elegivelCheckin = ['pago', 'isento'].includes(ins.status_pagamento);
                        const podeMostrarCheckin = podeCheckinManual && !ins.checkin_realizado && elegivelCheckin;
                        const podeMostrarCert = podeCert && !!ins.email && ins.checkin_realizado && elegivelCheckin;
                        const etiquetaAtiva = !!ins.etiqueta_impressa;
                        const etiquetaTooltip = etiquetaAtiva
                          ? 'Etiqueta impressa · Desmarcar impressão'
                          : 'Marcar etiqueta';
                        const podeAbrirPagamento = ins.status_pagamento === 'pendente';
                        return (
                          <tr
                            key={ins.id}
                            id={`insc-${ins.id}`}
                            className={`border-b border-white/5 ${isDestaque ? 'bg-amber-400/10' : 'hover:bg-white/5'}`}
                          >
                            <td className="px-3 py-3 text-white font-semibold whitespace-nowrap">
                              {ins.nome_inscrito}
                              {isDestaque && (
                                <span className="ml-2 text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300">
                                  Recém cadastrada
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-3 text-white/70 whitespace-nowrap">{nomeCampo(ins.campo_id) || '-'}</td>
                            <td className="px-3 py-3 text-white whitespace-nowrap">
                              {ins.lote_id ? (
                                <div 
                                  className="flex flex-col text-left cursor-help" 
                                  title={`Pago em lote\nLote: ${ins.lote?.codigo || '—'}\nValor individual: ${fmtMoeda(valorExib)}\nValor total do lote: ${fmtMoeda(ins.lote?.valor_total ?? 0)}\nQuantidade de inscrições: ${ins.lote_id ? inscricoesLista.filter(x => x.lote_id === ins.lote_id).length : 0}`}
                                >
                                  <span className="font-semibold text-emerald-400">{fmtMoeda(valorExib)}</span>
                                  <span className="text-[10px] text-white/50 block">Pago em lote 🏷️</span>
                                </div>
                              ) : (
                                fmtMoeda(valorExib)
                              )}
                            </td>
                            <td className="px-3 py-3 whitespace-nowrap">
                              <div className="flex flex-col gap-0.5 items-start">
                                <span className={`text-xs font-bold px-2 py-1 rounded-full text-center ${pagCfg.cls}`}>{pagCfg.label}</span>
                                {ins.lote_id && (
                                  <span className="text-[10px] text-white/40 block text-center mt-0.5">
                                    {ins.forma_pagamento ? (ins.forma_pagamento.toLowerCase().includes('lote') ? ins.forma_pagamento : `${ins.forma_pagamento}/lote`) : 'ASAAS/lote'}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-3 py-3 whitespace-nowrap">
                               {ins.etiqueta_impressa ? '🏷️' : <span className="text-white/30">—</span>}
                            </td>
                            <td className="px-3 py-3 whitespace-nowrap">
                              <div className="flex flex-wrap gap-1">
                                {perfil.podeEditarInscricoes && (
                                  <button
                                    type="button"
                                    onClick={() => abrirEdicao(ins)}
                                    className="px-2 py-1 text-xs font-bold rounded-md bg-white/10 text-white/70 hover:bg-white/20"
                                    title="Editar inscrição"
                                  >
                                    ✏️
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => imprimirEtiqueta(ins)}
                                  className="px-2 py-1 text-xs font-bold rounded-md bg-purple-500/20 text-purple-200 hover:bg-purple-500/30"
                                  title="Imprimir etiqueta"
                                >
                                  🖨️
                                </button>
                                {perfil.podeEditarInscricoes && (
                                  <button
                                    type="button"
                                    onClick={() => alternarEtiquetaImpressa(ins)}
                                    disabled={marcandoEtiqueta[ins.id]}
                                    className={`px-2 py-1 text-xs font-bold rounded-md transition disabled:opacity-50 ${
                                      etiquetaAtiva
                                        ? 'bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30'
                                        : 'bg-white/10 text-white/60 hover:bg-white/20'
                                    }`}
                                    title={etiquetaTooltip}
                                  >
                                    {marcandoEtiqueta[ins.id] ? '⏳' : etiquetaAtiva ? '✅' : '🏷️'}
                                  </button>
                                )}
                                {perfil.podeComunicacao && (
                                  <button
                                    type="button"
                                    onClick={() => reenviarEmail(ins)}
                                    disabled={enviandoEmail[ins.id]}
                                    className="px-2 py-1 text-xs font-bold rounded-md bg-sky-500/20 text-sky-200 hover:bg-sky-500/30 disabled:opacity-50"
                                    title="Reenviar e-mail"
                                  >
                                    {enviandoEmail[ins.id] ? '⏳' : '✉️'}
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => podeAbrirPagamento && iniciarPagamentoPresencial(ins)}
                                  disabled={!podeAbrirPagamento}
                                  className="px-2 py-1 text-xs font-bold rounded-md bg-white/10 text-white/60 hover:bg-white/20 disabled:opacity-50"
                                  title="Efetivar pagamento presencial"
                                >
                                  💳
                                </button>
                                {podeMostrarCheckin && (
                                  <button
                                    type="button"
                                    onClick={() => realizarCheckinManual(ins)}
                                    disabled={checkinManual[ins.id]}
                                    className="px-2 py-1 text-xs font-bold rounded-md bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30 disabled:opacity-50"
                                    title="Check-in manual"
                                  >
                                    {checkinManual[ins.id] ? '⏳' : '✅'}
                                  </button>
                                )}
                                {podeMostrarCert && (
                                  <button
                                    type="button"
                                    onClick={() => enviarCertificadoLista(ins)}
                                    disabled={enviandoCert[ins.id]}
                                    className="px-2 py-1 text-xs font-bold rounded-md bg-blue-500/20 text-blue-200 hover:bg-blue-500/30 disabled:opacity-50"
                                    title="Enviar certificado"
                                  >
                                    {enviandoCert[ins.id] ? '⏳' : '🎓'}
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Paginação */}
                {!loadingLista && totalPaginas > 1 && (
                  <div className="flex items-center justify-between mt-4 px-2">
                    <p className="text-xs text-white/50">Página {pagina} de {totalPaginas}</p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setPagina(p => Math.max(1, p - 1))}
                        disabled={pagina === 1}
                        className="px-3 py-1.5 text-xs font-bold rounded-lg bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 disabled:opacity-40 transition"
                      >
                        ← Anterior
                      </button>
                      <button
                        type="button"
                        onClick={() => setPagina(p => Math.min(totalPaginas, p + 1))}
                        disabled={pagina === totalPaginas}
                        className="px-3 py-1.5 text-xs font-bold rounded-lg bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 disabled:opacity-40 transition"
                      >
                        Próxima →
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
            </div>
          )}

          {editando && editForm && (
            <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => { setEditando(null); setEditForm(null); setDadosOperacionais(null); }}>
              <div className="bg-[#123b63] border border-white/10 rounded-2xl w-full max-w-4xl p-5" onClick={e => e.stopPropagation()}>
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="text-white font-bold text-sm">✏️ Editar inscrição</h3>
                    <p className="text-white/50 text-xs">{editando.nome_inscrito}</p>
                  </div>
                  <button className="text-white/60 hover:text-white text-lg" onClick={() => { setEditando(null); setEditForm(null); setDadosOperacionais(null); }}>×</button>
                </div>

                {erroEdit && (
                  <div className="mb-3 text-xs font-bold px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300">
                    {erroEdit}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="sm:col-span-2">
                    <label className={labelCls}>Nome completo *</label>
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
                    <label className={labelCls}>WhatsApp</label>
                    <input
                      value={editForm.whatsapp}
                      onChange={e => setEditForm(f => f ? { ...f, whatsapp: e.target.value } : f)}
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
                    <label className={labelCls}>Supervisão *</label>
                    <select
                      value={editForm.supervisao_id}
                      onChange={e => { setEditForm(f => f ? { ...f, supervisao_id: e.target.value, campo_id: '' } : f); }}
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
                      {campos.filter(c => !editForm.supervisao_id || c.supervisao_id === editForm.supervisao_id)
                        .map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                    </select>
                  </div>
                </div>

                {/* Dados operacionais */}
                <div className="mt-4 pt-4 border-t border-white/10">
                  <h4 className="text-white font-bold text-xs uppercase tracking-wider mb-3">💼 Dados operacionais</h4>
                  {carregandoDadosOperacionais ? (
                    <div className="text-xs text-white/60 flex items-center gap-1.5">
                      <span className="animate-spin">⏳</span> Carregando...
                    </div>
                  ) : dadosOperacionais ? (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 bg-white/5 border border-white/10 p-3.5 rounded-xl text-xs">
                      {/* Inscrição */}
                      <div>
                        <h5 className="font-bold text-emerald-400 mb-2 flex items-center gap-1">
                          Inscrição
                        </h5>
                        <div className="space-y-2 text-white/80">
                          <div>
                            <span className="text-white/50 block">Tipo de inscrição</span>
                            <span className="text-white font-medium">{dadosOperacionais.tipoInscricao || 'Não informado'}</span>
                          </div>
                          <div>
                            <span className="text-white/50 block">Valor</span>
                            {dadosOperacionais.lote_id ? (
                              <div 
                                className="cursor-help font-medium flex flex-col" 
                                title={`Pago em lote\nLote: ${dadosOperacionais.loteCodigo || '—'}\nValor individual: ${fmtMoeda(dadosOperacionais.valorInscricao ?? 0)}\nValor total do lote: ${fmtMoeda(dadosOperacionais.loteTotal ?? 0)}\nQuantidade de inscrições: ${dadosOperacionais.loteCount ?? 0}`}
                              >
                                <span className="text-white font-medium">{dadosOperacionais.valorInscricao !== null ? fmtMoeda(dadosOperacionais.valorInscricao) : '-'}</span>
                                <span className="text-emerald-400 text-[10px] font-semibold mt-0.5">Pago em lote 🏷️</span>
                              </div>
                            ) : (
                              <span className="text-white font-medium">{dadosOperacionais.valorInscricao !== null ? fmtMoeda(dadosOperacionais.valorInscricao) : '-'}</span>
                            )}
                          </div>
                          <div>
                            <span className="text-white/50 block">Pagamento</span>
                            <div className="flex flex-col">
                              <span className="text-white font-medium">{PAGAMENTO_CFG[dadosOperacionais.statusPagamento]?.label ?? dadosOperacionais.statusPagamento}</span>
                              {dadosOperacionais.lote_id && (
                                <span className="text-white/40 text-[10px] mt-0.5">
                                  Forma: {dadosOperacionais.formaPagamento ? (dadosOperacionais.formaPagamento.toLowerCase().includes('lote') ? dadosOperacionais.formaPagamento : `${dadosOperacionais.formaPagamento}/lote`) : 'ASAAS/lote'}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Hospedagem */}
                      <div>
                        <h5 className="font-bold text-emerald-400 mb-2 flex items-center gap-1">
                          🏨 Hospedagem
                        </h5>
                        <div className="space-y-2 text-white/80">
                          <div>
                            <span className="text-white/50 block">Hospedagem solicitada</span>
                            <span className="text-white font-medium">{dadosOperacionais.hospedagem ? 'Sim' : 'Não'}</span>
                          </div>
                          {dadosOperacionais.hospedagem && (
                            <>
                              <div>
                                <span className="text-white/50 block">Status</span>
                                <span className="text-white font-medium">{dadosOperacionais.statusHospedagem || 'Não alocada / Aguardando alocação'}</span>
                              </div>
                              <div>
                                <span className="text-white/50 block">Grupo</span>
                                <span className="text-white font-medium">{dadosOperacionais.grupoHospedagem || '—'}</span>
                              </div>
                              <div>
                                <span className="text-white/50 block">Setor/Alojamento</span>
                                <span className="text-white font-medium">{dadosOperacionais.alojamentoNome || 'Não alocado'}</span>
                              </div>
                              <div>
                                <span className="text-white/50 block">Tipo do leito</span>
                                <span className="text-white font-medium">
                                  {dadosOperacionais.tipoLeito 
                                    ? dadosOperacionais.tipoLeito
                                    : 'Não alocado'}
                                </span>
                              </div>
                              <div>
                                <span className="text-white/50 block">Posição do leito</span>
                                <span className="text-white font-medium">{dadosOperacionais.posicaoLeito || 'Não informada'}</span>
                              </div>
                              <div>
                                <span className="text-white/50 block">Número do leito</span>
                                <span className="text-white font-medium">{dadosOperacionais.numeroLeito || 'Não alocado'}</span>
                              </div>
                              <div>
                                <span className="text-white/50 block">Check-in</span>
                                <span className="text-white font-medium">{dadosOperacionais.checkinAt ? fmtDT(dadosOperacionais.checkinAt) : '—'}</span>
                              </div>
                              <div>
                                <span className="text-white/50 block">Check-out</span>
                                <span className="text-white font-medium">{dadosOperacionais.checkoutAt ? fmtDT(dadosOperacionais.checkoutAt) : '—'}</span>
                              </div>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Alimentação */}
                      <div>
                        <h5 className="font-bold text-emerald-400 mb-2 flex items-center gap-1">
                          🍽️ Alimentação
                        </h5>
                        <div className="space-y-2 text-white/80">
                          <div>
                            <span className="text-white/50 block">Alimentação inclusa</span>
                            <span className="text-white font-medium">{dadosOperacionais.alimentacao ? 'Sim' : 'Não'}</span>
                          </div>
                          {dadosOperacionais.alimentacao && (
                            <>
                              <div>
                                <span className="text-white/50 block">Total de refeições</span>
                                <span className="text-white font-medium">{dadosOperacionais.refeicoesTotal !== null ? dadosOperacionais.refeicoesTotal : '—'}</span>
                              </div>
                              <div>
                                <span className="text-white/50 block">Refeições utilizadas</span>
                                <span className="text-white font-medium">{dadosOperacionais.refeicoesUsadas !== null ? dadosOperacionais.refeicoesUsadas : '—'}</span>
                              </div>
                              <div>
                                <span className="text-white/50 block">Saldo de refeições</span>
                                <span className={`font-bold ${dadosOperacionais.refeicoesSaldo && dadosOperacionais.refeicoesSaldo > 0 ? 'text-emerald-300' : 'text-white'}`}>
                                  {dadosOperacionais.refeicoesSaldo !== null ? dadosOperacionais.refeicoesSaldo : '—'}
                                </span>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-red-300">Erro ao carregar dados operacionais.</div>
                  )}
                </div>

                <div className="flex gap-2 mt-4">
                  <button
                    type="button"
                    onClick={() => { setEditando(null); setEditForm(null); setDadosOperacionais(null); }}
                    className="flex-1 border border-white/20 text-white/70 hover:text-white hover:border-white/40 py-2.5 rounded-lg text-sm font-bold transition"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={salvarEdicao}
                    disabled={salvandoEdit}
                    className="flex-1 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-white py-2.5 rounded-lg text-sm font-bold transition"
                  >
                    {salvandoEdit ? 'Salvando...' : 'Salvar'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'caixa' && carregandoCaixa && (
            <div className="min-h-[300px] flex items-center justify-center">
              <div className="w-8 h-8 border-4 border-white/20 border-t-white rounded-full animate-spin"></div>
            </div>
          )}

          {activeTab === 'caixa' && !carregandoCaixa && (
            <div className="space-y-6 text-white">
              <style dangerouslySetInnerHTML={{__html: `
                @media print {
                  body {
                    background: white !important;
                    color: black !important;
                  }
                  header, nav, button, .flex-shrink-0 {
                    display: none !important;
                  }
                  .flex-1 {
                    overflow: visible !important;
                  }
                  .min-h-screen {
                    background: white !important;
                    min-height: auto !important;
                  }
                  .bg-\\[\\#0D2B4E\\], .bg-\\[\\#1a3050\\], .bg-\\[\\#0a2040\\] {
                    background: white !important;
                    border: 1px solid #ddd !important;
                    color: black !important;
                  }
                  .text-emerald-400 {
                    color: #059669 !important;
                  }
                  .text-red-400 {
                    color: #dc2626 !important;
                  }
                  .text-white\\/50, .text-white\\/40, .text-white\\/60 {
                    color: #666 !important;
                  }
                  .text-white {
                    color: black !important;
                  }
                  .shadow-sm, .border-white\\/10 {
                    border: 1px solid #ddd !important;
                  }
                }
              `}} />

              {/* Resumo Superior */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-[#1a3050] border border-white/10 rounded-xl p-4">
                  <p className="text-xs text-white/50 font-semibold uppercase">🟢 Sessão</p>
                  <p className="text-lg font-bold mt-1 text-emerald-400">Aberto</p>
                  <p className="text-xs text-white/40 mt-1">Desde: {caixaSessao ? new Date(caixaSessao.data_abertura).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '-'}</p>
                </div>
                <div className="bg-[#1a3050] border border-white/10 rounded-xl p-4">
                  <p className="text-xs text-white/50 font-semibold uppercase">💰 Total Recebido</p>
                  <p className="text-2xl font-bold mt-1 text-white">{fmtMoeda(caixaResumo?.totalRecebido || 0)}</p>
                  <p className="text-xs text-white/40 mt-1">Inscrições + Complementos</p>
                </div>
                <div className="bg-[#1a3050] border border-white/10 rounded-xl p-4">
                  <p className="text-xs text-white/50 font-semibold uppercase">💵 Dinheiro</p>
                  <p className="text-xl font-bold mt-1 text-white">{fmtMoeda(caixaResumo?.dinheiroRecebido || 0)}</p>
                  <p className="text-xs text-white/40 mt-1">Em mãos</p>
                </div>
                <div className="bg-[#1a3050] border border-white/10 rounded-xl p-4">
                  <p className="text-xs text-white/50 font-semibold uppercase">📱 PIX / 💳 Cartão</p>
                  <p className="text-sm font-bold mt-1 text-white">PIX: {fmtMoeda(caixaResumo?.pixRecebido || 0)}</p>
                  <p className="text-sm font-bold text-white">Cartão: {fmtMoeda(caixaResumo?.cartaoRecebido || 0)}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Saldo Caixa & Ações */}
                <div className="space-y-4 lg:col-span-1">
                  <div className="bg-[#1a3050] border border-emerald-500/30 rounded-xl p-6 space-y-4">
                    <h3 className="text-xs font-bold text-emerald-400 uppercase tracking-wider">CAIXA EM DINHEIRO</h3>
                    <div className="space-y-2 text-sm text-white/80">
                      <div className="flex justify-between">
                        <span>Recebido:</span>
                        <span className="font-semibold text-white">{fmtMoeda(caixaResumo?.dinheiroRecebido || 0)}</span>
                      </div>
                      <div className="flex justify-between text-red-400">
                        <span>(-) Sangrias:</span>
                        <span className="font-semibold">-{fmtMoeda(caixaResumo?.totalSangrias || 0)}</span>
                      </div>
                      <div className="border-t border-white/10 pt-2 flex justify-between font-bold text-emerald-400 text-lg">
                        <span>Saldo esperado:</span>
                        <span>{fmtMoeda(caixaResumo?.saldoEsperadoDinheiro || 0)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="bg-[#1a3050] border border-white/10 rounded-xl p-6 space-y-4">
                    <h3 className="text-xs font-bold text-white/50 uppercase tracking-wider">OUTROS PAGAMENTOS</h3>
                    <div className="space-y-2 text-sm text-white/80">
                      <div className="flex justify-between">
                        <span>Cortesias (Qtd):</span>
                        <span className="font-semibold text-white">{caixaResumo?.cortesiasQtd || 0} ({fmtMoeda(caixaResumo?.cortesiasValor || 0)})</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Complementos (Qtd):</span>
                        <span className="font-semibold text-white">{caixaResumo?.complementosQtd || 0} ({fmtMoeda(caixaResumo?.complementosValor || 0)})</span>
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setModalSangriaAberto(true)}
                    className="w-full bg-amber-500 hover:bg-amber-400 text-slate-950 py-3 rounded-xl font-bold transition flex items-center justify-center gap-2 mb-2"
                  >
                    🏦 Registrar Sangria
                  </button>

                  <button
                    type="button"
                    onClick={() => window.print()}
                    className="w-full bg-white/10 hover:bg-white/20 border border-white/15 text-white py-3 rounded-xl font-bold transition flex items-center justify-center gap-2"
                  >
                    🖨 Imprimir prestação parcial
                  </button>
                </div>

                {/* Timeline */}
                <div className="lg:col-span-2 bg-[#1a3050] border border-white/10 rounded-xl p-6 space-y-4">
                  <h3 className="text-sm font-bold text-white/80 uppercase">Timeline de Movimentações</h3>
                  <div className="divide-y divide-white/10 max-h-[500px] overflow-y-auto pr-2">
                    {caixaTimeline.length === 0 ? (
                      <p className="text-white/40 text-sm py-4 text-center">Nenhuma movimentação realizada nesta sessão.</p>
                    ) : (
                      caixaTimeline.map((item: any, idx: number) => (
                        <div key={idx} className="py-3 flex justify-between items-center text-sm">
                          <div>
                            <span className="text-xs text-white/40 block">
                              {new Date(item.data).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                            </span>
                            <span className="font-semibold block">{item.tipo}</span>
                            <span className="text-white/60 block">{item.nome}</span>
                          </div>
                          <div className="text-right">
                            <span className="text-xs bg-white/5 border border-white/10 px-2 py-0.5 rounded text-white/60 uppercase">
                              {item.forma}
                            </span>
                            <span className={`block font-bold mt-1 ${item.valor < 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                              {item.valor < 0 ? '' : '+'}{fmtMoeda(item.valor)}
                            </span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>

              {/* Modal de Sangria */}
              {modalSangriaAberto && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                  <div className="bg-[#0D2B4E] border border-white/10 w-full max-w-md rounded-2xl shadow-2xl p-6 relative">
                    <button
                      type="button"
                      onClick={() => {
                        setModalSangriaAberto(false);
                        setSangriaErro(null);
                        setSangriaSucesso(false);
                      }}
                      className="absolute top-4 right-4 text-white/50 hover:text-white transition text-lg"
                    >
                      ✕
                    </button>
                    <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                      🏦 Registrar Sangria
                    </h3>

                    {sangriaSucesso ? (
                      <div className="bg-emerald-500/20 text-emerald-300 p-4 rounded-xl text-center text-sm font-semibold mb-4 animate-pulse">
                        ✓ Sangria registrada com sucesso!
                      </div>
                    ) : (
                      <form onSubmit={executarSangria} className="space-y-4">
                        {sangriaErro && (
                          <div className="bg-red-500/20 text-red-300 p-3 rounded-lg text-xs font-semibold">
                            ⚠️ {sangriaErro}
                          </div>
                        )}

                        <div>
                          <label className="block text-xs font-semibold text-gray-300 mb-1 uppercase tracking-wide">
                            Valor (R$) *
                          </label>
                          <input
                            type="number"
                            step="0.01"
                            min="0.01"
                            required
                            value={sangriaValor}
                            onChange={(e) => setSangriaValor(e.target.value)}
                            placeholder="Ex: 100.00"
                            className="w-full border border-gray-600 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#F39C12] bg-[#1a3050] text-white"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-semibold text-gray-300 mb-1 uppercase tracking-wide">
                            Retirado por (Supervisor/Diretor) *
                          </label>
                          <input
                            type="text"
                            required
                            value={sangriaRetiradoPor}
                            onChange={(e) => setSangriaRetiradoPor(e.target.value)}
                            placeholder="Nome de quem retirou o valor"
                            className="w-full border border-gray-600 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#F39C12] bg-[#1a3050] text-white"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-semibold text-gray-300 mb-1 uppercase tracking-wide">
                            Recebido por *
                          </label>
                          <input
                            type="text"
                            required
                            value={sangriaRecebidoPor}
                            onChange={(e) => setSangriaRecebidoPor(e.target.value)}
                            placeholder="Nome de quem recebeu o valor"
                            className="w-full border border-gray-600 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#F39C12] bg-[#1a3050] text-white"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-semibold text-gray-300 mb-1 uppercase tracking-wide">
                            Observação
                          </label>
                          <textarea
                            value={sangriaObservacao}
                            onChange={(e) => setSangriaObservacao(e.target.value)}
                            placeholder="Observações adicionais..."
                            className="w-full border border-gray-600 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#F39C12] bg-[#1a3050] text-white h-20 resize-none"
                          />
                        </div>

                        <div className="flex gap-2 pt-2">
                          <button
                            type="button"
                            onClick={() => {
                              setModalSangriaAberto(false);
                              setSangriaErro(null);
                              setSangriaSucesso(false);
                            }}
                            className="flex-1 border border-white/20 text-white/70 hover:text-white hover:border-white/40 py-2.5 rounded-lg text-sm font-bold transition"
                          >
                            Cancelar
                          </button>
                          <button
                            type="submit"
                            disabled={registrandoSangria}
                            className="flex-1 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 py-2.5 rounded-lg text-sm font-bold transition"
                          >
                            {registrandoSangria ? 'Registrando...' : 'Registrar'}
                          </button>
                        </div>
                      </form>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Modal de Efetivar Pagamento Presencial */}
      {modalPagarPresencialAberto && pagPresencialInscricao && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-[#0D2B4E] border border-white/10 w-full max-w-md rounded-2xl shadow-2xl p-6 relative text-white">
            <button
              type="button"
              onClick={() => {
                setModalPagarPresencialAberto(false);
                setPagPresencialInscricao(null);
                setPagPresencialErro(null);
              }}
              className="absolute top-4 right-4 text-white/50 hover:text-white transition text-lg"
            >
              ✕
            </button>
            
            <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              💳 Efetivar Pagamento Presencial
            </h3>

            <form onSubmit={confirmarPagamentoPresencial} className="space-y-4">
              {pagPresencialErro && (
                <div className="bg-red-500/20 text-red-300 p-3 rounded-lg text-xs font-semibold">
                  ⚠️ {pagPresencialErro}
                </div>
              )}

              <div className="bg-white/5 rounded-xl p-3 space-y-1.5 text-xs text-white/80 border border-white/5">
                <div><span className="text-white/40">Inscrito: </span><strong className="text-white">{pagPresencialInscricao.nome_inscrito}</strong></div>
                <div><span className="text-white/40">Valor Original: </span><strong className="text-white">{fmtMoeda(pagPresencialInscricao.valor_final ?? 0)}</strong></div>
                <div><span className="text-white/40">Status: </span><strong className="text-amber-400">Pendente</strong></div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-300 mb-1 uppercase tracking-wide">
                  Valor Pago (R$) *
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.00"
                  required
                  value={pagPresencialValor}
                  onChange={(e) => setPagPresencialValor(Number(e.target.value))}
                  placeholder="0.00"
                  className="w-full border border-gray-600 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#F39C12] bg-[#1a3050] text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-300 mb-1 uppercase tracking-wide">
                  Forma de Pagamento *
                </label>
                <select
                  value={pagPresencialForma}
                  onChange={(e) => {
                    setPagPresencialForma(e.target.value);
                    if (e.target.value === 'isento') {
                      setPagPresencialValor(0);
                    } else if (pagPresencialValor === 0) {
                      setPagPresencialValor(pagPresencialInscricao.valor_final ?? 0);
                    }
                  }}
                  className="w-full border border-gray-600 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#F39C12] bg-[#1a3050] text-white"
                >
                  <option value="dinheiro">Dinheiro</option>
                  <option value="pix">PIX</option>
                  <option value="debito">Cartão de Débito</option>
                  <option value="credito">Cartão de Crédito</option>
                  <option value="isento">Cortesia / Isento</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-300 mb-1 uppercase tracking-wide">
                  Observação
                </label>
                <textarea
                  value={pagPresencialObservacao}
                  onChange={(e) => setPagPresencialObservacao(e.target.value)}
                  placeholder="Ex: Recebido no balcão..."
                  className="w-full border border-gray-600 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#F39C12] bg-[#1a3050] text-white h-16 resize-none"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setModalPagarPresencialAberto(false);
                    setPagPresencialInscricao(null);
                    setPagPresencialErro(null);
                  }}
                  className="flex-1 border border-white/20 text-white/70 hover:text-white hover:border-white/40 py-2.5 rounded-lg text-sm font-bold transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={processandoPagPresencial}
                  className="flex-1 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 py-2.5 rounded-lg text-sm font-bold transition"
                >
                  {processandoPagPresencial ? 'Processando...' : 'Confirmar pagamento'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Subcomponente: Serviço toggle ────────────────────────────────────────
function ToggleService({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border-2 px-5 py-2.5 text-sm font-semibold transition ${
        active
          ? 'border-[#F39C12] bg-[#F39C12]/15 text-[#F39C12]'
          : 'border-white/20 text-white/50 hover:border-white/40'
      }`}
    >
      {active ? '✓ ' : ''}{label}
    </button>
  );
}

// ─── Subcomponente: Tela de confirmação ───────────────────────────────────
function ConfirmacaoScreen({
  inscricao, evento, nomeSup, nomeCampo,
  valorFinal, formaPagamento, asaasData,
  contadorTotal, onNova, onImprimir, onVerLista,
}: {
  inscricao: InscricaoSalva;
  evento: { id: string; nome: string; departamento: string; data_inicio: string; data_fim: string; local: string | null; cidade: string | null; banner_url: string | null };
  nomeSup: string; nomeCampo: string;
  valorFinal: number; formaPagamento: string;
  asaasData: { invoiceUrl?: string; pixCopiaECola?: string; valor: number } | null;
  contadorTotal: number;
  onNova: () => void;
  onImprimir: () => void;
  onVerLista: () => void;
}) {
  const fmtMoeda = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  // Auto-foco no botão "Nova inscrição"
  const btnRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    setTimeout(() => btnRef.current?.focus(), 200);
  }, []);

  // Atalho Enter = nova inscrição
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Enter') { e.preventDefault(); onNova(); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onNova]);

  const isGratuito = valorFinal <= 0 || formaPagamento === 'isento';

  const pagamentoConfirmado = inscricao.status_pagamento === 'pago' || inscricao.status_pagamento === 'isento';

  return (
    <div className="min-h-[70vh] bg-[#0D2B4E] flex flex-col items-center justify-center p-4">
      {/* Ícone de sucesso / status */}
      <div className="mb-6 text-center">
        {pagamentoConfirmado ? (
          <>
            <div className="w-20 h-20 bg-emerald-500 rounded-full flex items-center justify-center mx-auto mb-3 shadow-lg shadow-emerald-500/30">
              <span className="text-4xl">✅</span>
            </div>
            <h1 className="text-2xl font-black text-white">Inscrição Confirmada!</h1>
            <p className="text-emerald-400 text-sm mt-1 font-semibold">{contadorTotal} inscri{contadorTotal !== 1 ? 'ções realizadas' : 'ção realizada'} hoje</p>
          </>
        ) : (
          <>
            <div className="w-20 h-20 bg-amber-500 rounded-full flex items-center justify-center mx-auto mb-3 shadow-lg shadow-amber-500/30">
              <span className="text-4xl">⏳</span>
            </div>
            <h1 className="text-2xl font-black text-white">Inscrição registrada</h1>
            <p className="text-amber-400 text-sm mt-1 font-semibold">Aguardando confirmação do pagamento</p>
            <span className="inline-block bg-amber-500/20 text-amber-300 text-xs font-bold px-3 py-1 rounded-full mt-2 border border-amber-500/30 uppercase">
              Pendente
            </span>
          </>
        )}
      </div>

      {/* Card do inscrito */}
      <div className="w-full max-w-lg bg-[#123b63] rounded-2xl border border-white/10 overflow-hidden mb-6">
        {/* Preview crachá */}
        <div className="p-5 flex justify-center bg-gradient-to-b from-[#0D2B4E] to-[#123b63]">
          <EventBadge
            inscricao={inscricao}
            evento={evento}
            nomeSup={nomeSup}
            nomeCampo={nomeCampo}
            size="medium"
            printMode={false}
          />
        </div>

        {/* Dados resumo */}
        <div className="px-5 py-4 space-y-2">
          <Row label="Nome"       value={inscricao.nome_inscrito} />
          <Row label="Supervisão" value={nomeSup   || '-'}        />
          <Row label="Campo"      value={nomeCampo || '-'}        />
          <Row
            label="Pagamento"
            value={isGratuito ? 'Gratuito / Isento' : fmtMoeda(valorFinal) + ' — ' + (formaPagamento === 'pix_manual' ? 'PIX' : formaPagamento === 'asaas' ? 'ASAAS' : formaPagamento)}
            highlight={!isGratuito}
          />
          {inscricao.hospedagem  && <Row label="Hospedagem"  value="✓ Incluída"  />}
          {inscricao.alimentacao && <Row label="Alimentação" value="✓ Incluída"  />}
          {inscricao.brinde      && <Row label="Brinde"      value="✓ Incluído"  />}
        </div>

        {/* Dados ASAAS */}
        {asaasData && (
          <div className="px-5 pb-4 space-y-2">
            {asaasData.pixCopiaECola && (
              <div>
                <p className="text-xs text-white/50 mb-1">PIX Copia e Cola</p>
                <div className="bg-[#0D2B4E] rounded-lg px-3 py-2 text-xs text-white/70 font-mono break-all select-all">
                  {asaasData.pixCopiaECola}
                </div>
              </div>
            )}
            {asaasData.invoiceUrl && (
              <a
                href={asaasData.invoiceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="block w-full text-center bg-[#F39C12] hover:bg-[#D68910] text-[#0D2B4E] font-bold py-2.5 rounded-xl text-sm transition"
              >
                💳 Abrir Fatura ASAAS
              </a>
            )}
          </div>
        )}

        {/* Aviso de pendência */}
        {!pagamentoConfirmado && (
          <div className="px-5 py-3 bg-red-950/40 border-t border-red-900/35 text-red-300 text-xs leading-relaxed text-center font-medium">
            ⚠️ Esta inscrição só será liberada para crachá, etiqueta e check-in após confirmação do pagamento.
          </div>
        )}
      </div>

      {/* Ações */}
      <div className="flex flex-col gap-3 w-full max-w-lg">
        {pagamentoConfirmado ? (
          <>
            {/* Botão destaque: imprimir + nova */}
            <button
              type="button"
              onClick={() => { onImprimir(); setTimeout(onNova, 600); }}
              className="w-full bg-[#F39C12] hover:bg-[#D68910] active:scale-95 text-[#0D2B4E] font-black py-4 rounded-xl text-base transition shadow-lg shadow-[#F39C12]/30 flex items-center justify-center gap-2"
            >
              🖨️ Imprimir Crachá e Nova Inscrição
            </button>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={onImprimir}
                className="flex-1 border-2 border-[#F39C12]/40 hover:border-[#F39C12] text-[#F39C12] hover:bg-[#F39C12]/10 font-bold py-3 rounded-xl text-sm transition"
              >
                🖨️ Só Imprimir
              </button>
              <button
                ref={btnRef}
                type="button"
                onClick={onNova}
                className="flex-1 bg-emerald-500 hover:bg-emerald-400 active:scale-95 text-white font-black py-3 rounded-xl text-base transition shadow-lg shadow-emerald-500/30"
                title="Enter"
              >
                ➕ Nova Inscrição
              </button>
            </div>
          </>
        ) : (
          <div className="flex gap-3">
            <button
              ref={btnRef}
              type="button"
              onClick={onNova}
              className="w-full bg-[#F39C12] hover:bg-[#D68910] active:scale-95 text-[#0D2B4E] font-black py-4 rounded-xl text-base transition shadow-lg shadow-[#F39C12]/30 flex items-center justify-center gap-2"
              title="Enter"
            >
              ➕ Nova Inscrição
            </button>
          </div>
        )}
        <button
          type="button"
          onClick={onVerLista}
          className="w-full border border border-white/20 text-white/80 hover:text-white hover:border-white/40 py-3 rounded-xl text-sm font-bold transition"
        >
          👥 Ver na lista de inscritos
        </button>
      </div>
      {pagamentoConfirmado ? (
        <p className="text-white/30 text-xs mt-3">Enter = Nova inscrição &nbsp;&middot;&nbsp; Ctrl+P = Só imprimir</p>
      ) : (
        <p className="text-white/30 text-xs mt-3">Enter = Nova inscrição</p>
      )}
    </div>
  );
}

// ─── Subcomponente: linha de resumo ───────────────────────────────────────
function Row({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className="text-white/40 text-xs">{label}</span>
      <span className={`font-semibold ${highlight ? 'text-[#F39C12]' : 'text-white'}`}>{value}</span>
    </div>
  );
}
