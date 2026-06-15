'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { generateQRCodeToken } from '@/lib/qrcode-token';
import { normalizePayloadUppercase } from '@/lib/text';
import AssistenteWidget from '@/components/AssistenteWidget';
import { parseCampoMissionarioConfig } from '@/lib/ago-regras';
import { resolveGrupoHospedagemAGO } from '@/lib/hospedagem-helpers';
import {
  filtrarTiposAgo,
  findTipoEsposaJubilado,
  findTipoPastorJubilado,
  ehTipoPastorAuxiliar,
  ehTipoPastorPresidente,
  ehTipoPastorJubilado,
  ehTipoVisitante,
} from '@/lib/ago-inscricao-regras';
import {
  isEventoInscricaoPublicaDisponivel,
  resolveEventoStatusVisual,
} from '@/lib/eventos/evento-listing';

// ─── Tipos ────────────────────────────────────────────────────
interface Supervisao { id: string; nome: string; }
interface Campo      { id: string; nome: string; supervisao_id: string; is_campo_missionario?: boolean; }

interface TipoInscricao {
  id: string; nome: string; valor: number;
  inclui_alimentacao: boolean; inclui_hospedagem: boolean;
  quantidade_refeicoes?: number | null;
  cortesia?: boolean; limite_vagas?: number | null; ordem: number;
}

interface MinistroInfo {
  nome: string;
  matricula: string | null;
  cargoMinisterial: string | null;
  email: string | null;
  whatsapp: string | null;
  isPastorPresidente: boolean;
  isPastorAuxiliar: boolean;
  isJubilado: boolean;
  status: string | null;
  supervisao_id: string | null;
  supervisao_nome: string | null;
  campo_id: string | null;
  campo_nome: string | null;
  isCampoMissionario: boolean;
}

interface MemberLookupPayload {
  encontrado?: boolean;
  lookup_kind?: 'ministro' | 'conjuge_jubilado' | null;
  conjuge_jubilado_validado?: boolean;
  conjuge_de_ministro_id?: string | null;
  conjuge_de_nome?: string | null;
  nome?: string | null;
  email?: string | null;
  whatsapp?: string | null;
  telefone?: string | null;
  celular?: string | null;
  phone?: string | null;
  sexo?: string | null;
  data_nascimento?: string | null;
  supervisao_id?: string | null;
  supervisao_nome?: string | null;
  campo_id?: string | null;
  campo_nome?: string | null;
  congregacao_id?: string | null;
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
}

interface Evento {
  id: string; nome: string; slug: string; descricao: string | null;
  departamento: string; data_inicio: string; data_fim: string;
  local: string | null; cidade: string | null;
  supervisao_id: string | null; campo_id: string | null;
  banner_url: string | null; valor_inscricao: number;
  permite_hospedagem: boolean; permite_alimentacao: boolean;
  permite_brinde: boolean; gerar_certificado: boolean;
  link_whatsapp: string | null; mensagem_confirmacao: string | null;
  inscricoes_abertas: boolean; limite_vagas: number | null;
  limite_hospedagem: number | null; limite_brindes: number | null;
  publico_alvo: string | null;
  usar_tipos_inscricao: boolean;
  status: 'programado' | 'realizado' | 'cancelado';
  suporte_nome: string | null;
  suporte_whatsapp: string | null;
  configuracoes_ago?: { enabled?: boolean; grupos?: string[]; leitos_inferiores_preferenciais?: boolean; preferencia_60_mais?: boolean; preferencia_necessidade_especial?: boolean; observacoes?: string; habilitar_desconto_campo_missionario?: boolean; valor_pastor_presidente_campo_missionario?: number | string; campo_missionario?: { enabled?: boolean; valor_pastor_presidente?: number | string; valor_esposa?: number | string; } | null; } | null;
  possuiCupomAtivo?: boolean;
}

interface FormData {
  nome_inscrito: string;
  cpf: string;
  email: string;
  whatsapp: string;
  sexo: string;
  data_nascimento: string;
  supervisao_id: string;
  campo_id: string;
  hospedagem: boolean;
  brinde: boolean;
  // Campos hospedagem AGO
  hosp_necessidade_especial: boolean;
  hosp_descricao_necessidade: string;
  hosp_cama_inferior: boolean;
  hosp_observacoes: string;
  hosp_possui_comorbidade: boolean;
  hosp_descricao_comorbidade: string;
  grupo_hospedagem: string;
}

// Participante adicional (lote)
interface ParticipanteExtra {
  nome_inscrito: string; cpf: string; email: string; whatsapp: string;
  sexo: string; data_nascimento: string; supervisao_id: string; campo_id: string;
  tipo_inscricao: string;
  hospedagem: boolean;
  hosp_necessidade_especial: boolean;
  hosp_descricao_necessidade: string;
  hosp_observacoes: string;
  hosp_possui_comorbidade: boolean;
  hosp_descricao_comorbidade: string;
}

interface ExtraMinisterialInfo {
  cpfStatus: 'idle' | 'encontrado' | 'nao_encontrado';
  ministroAtivo: boolean;
  cargoMinisterial: string | null;
  isPastorPresidente: boolean;
  isPastorAuxiliar: boolean;
  isJubilado: boolean;
}

const EXTRA_MINISTERIAL_VAZIO: ExtraMinisterialInfo = {
  cpfStatus: 'idle',
  ministroAtivo: false,
  cargoMinisterial: null,
  isPastorPresidente: false,
  isPastorAuxiliar: false,
  isJubilado: false,
};

// Dados da esposa (AGO — Campo Missionário)
interface FormEsposa {
  nome: string;
  cpf: string;
  data_nascimento: string;
  whatsapp: string;
}

const FORM_ESPOSA_VAZIO: FormEsposa = { nome: '', cpf: '', data_nascimento: '', whatsapp: '' };

interface HospEsposa {
  solicitar: boolean;
  hosp_necessidade_especial: boolean;
  hosp_descricao_necessidade: string;
  hosp_cama_inferior: boolean;
  hosp_observacoes: string;
  hosp_possui_comorbidade: boolean;
  hosp_descricao_comorbidade: string;
  grupo_hospedagem: string;
}

const HOSP_ESPOSA_VAZIO: HospEsposa = {
  solicitar: false,
  hosp_necessidade_especial: false,
  hosp_descricao_necessidade: '',
  hosp_cama_inferior: false,
  hosp_observacoes: '',
  hosp_possui_comorbidade: false,
  hosp_descricao_comorbidade: '',
  grupo_hospedagem: '',
};

const FORM_VAZIO: FormData = {
  nome_inscrito: '', cpf: '', email: '', whatsapp: '',
  sexo: '', data_nascimento: '',
  supervisao_id: '', campo_id: '',
  hospedagem: false, brinde: false,
  hosp_necessidade_especial: false,
  hosp_descricao_necessidade: '',
  hosp_cama_inferior: false,
  hosp_observacoes: '',
  hosp_possui_comorbidade: false,
  hosp_descricao_comorbidade: '',
  grupo_hospedagem: '',
};

// ─── Helpers ─────────────────────────────────────────────────
const fmtData = (d: string | null) => {
  if (!d) return '-';
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y}`;
};

const fmtMoeda = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function dedupeTipos(tipos: TipoInscricao[]): TipoInscricao[] {
  const seen = new Map<string, TipoInscricao>();
  for (const t of tipos) {
    const key = `${t.nome.trim().toLowerCase()}|${t.inclui_alimentacao ? 1 : 0}|${t.inclui_hospedagem ? 1 : 0}`;
    if (!seen.has(key)) seen.set(key, t);
  }
  return Array.from(seen.values()).sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0));
}

function substituirVariaveis(mensagem: string, vars: Record<string, string>) {
  return mensagem.replace(/\{([A-Z_]+)\}/g, (_, key) => vars[key] ?? `{${key}}`);
}

function formatarCPF(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 11);
  return d
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
}

function normalizarComparacao(v: string | null | undefined) {
  return String(v || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatYmdToDma(ymd: string | null | undefined): string {
  if (!ymd) return '';
  if (ymd.includes('/')) return ymd;
  const parts = ymd.split('-');
  if (parts.length === 3) {
    const [y, m, d] = parts;
    return `${d}/${m}/${y}`;
  }
  return ymd;
}

function formatDmaToYmd(dma: string | null | undefined): string {
  if (!dma) return '';
  if (dma.includes('-')) return dma;
  const parts = dma.split('/');
  if (parts.length === 3) {
    const [d, m, y] = parts;
    if (d.length === 2 && m.length === 2 && y.length === 4) {
      return `${y}-${m}-${d}`;
    }
  }
  return '';
}

function formatBirthDateInput(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) {
    return digits;
  } else if (digits.length <= 4) {
    return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  } else {
    return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
  }
}

function validarDataNascimento(dma: string | null | undefined): string | null {
  if (!dma) return null;
  const regex = /^(\d{2})\/(\d{2})\/(\d{4})$/;
  const match = dma.match(regex);
  if (!match) {
    return 'Data de nascimento inválida. Use o formato dd/mm/aaaa.';
  }
  const dia = parseInt(match[1], 10);
  const mes = parseInt(match[2], 10);
  const ano = parseInt(match[3], 10);

  const hoje = new Date();
  if (ano > hoje.getFullYear()) {
    return 'O ano de nascimento não pode ser no futuro.';
  }

  const dateObj = new Date(ano, mes - 1, dia);
  if (
    dateObj.getFullYear() !== ano ||
    dateObj.getMonth() !== mes - 1 ||
    dateObj.getDate() !== dia
  ) {
    return 'Data de nascimento inválida.';
  }

  if (dateObj > hoje) {
    return 'A data de nascimento não pode ser no futuro.';
  }

  return null;
}

// ─── Componente principal ────────────────────────────────────
export default function InscricaoPublicaPage() {
  const params = useParams();
  const slug = params?.slug as string;

  const [evento,      setEvento]      = useState<Evento | null>(null);
  const [supervisoes, setSupervisoes] = useState<Supervisao[]>([]);
  const [campos,      setCampos]      = useState<Campo[]>([]);
  const [tipos,       setTipos]       = useState<TipoInscricao[]>([]);
  const [vagasHospedagem, setVagasHospedagem] = useState<number | null>(null);
  const [vagasPorGrupo, setVagasPorGrupo] = useState<Record<string, number>>({});
  const [loading,     setLoading]     = useState(true);
  const [estadoErro,  setEstadoErro]  = useState<'nao_encontrado' | 'fechado' | 'encerrado' | 'esgotado' | null>(null);

  // Form
  const [form,          setForm]          = useState<FormData>({ ...FORM_VAZIO });
  const [buscandoCPF,   setBuscandoCPF]   = useState(false);
  const [cpfStatus,     setCpfStatus]     = useState<'idle' | 'encontrado' | 'nao_encontrado'>('idle');
  const [salvando,      setSalvando]      = useState(false);
  const [erroForm,      setErroForm]      = useState<string | null>(null);

  // Tipo de inscrição e cupom
  const [tipoSelecionado, setTipoSelecionado] = useState<TipoInscricao | null>(null);
  const [cupomCodigo,     setCupomCodigo]     = useState('');
  const [cupomStatus,     setCupomStatus]     = useState<'idle' | 'validando' | 'ok' | 'erro'>('idle');
  const [cupomDesconto,   setCupomDesconto]   = useState(0);
  const [cupomMensagem,   setCupomMensagem]   = useState('');
  const [cupomMeta,       setCupomMeta]       = useState<{ tipo: 'percentual' | 'valor_fixo'; valor: number } | null>(null);
  const [descontoCampoMissionario, setDescontoCampoMissionario] = useState(false);

  // Dados ministeriais (AGO — preenchidos após consulta de CPF)
  const [ministroInfo, setMinistroInfo] = useState<MinistroInfo | null>(null);
  const [esposaJubiladoAuto, setEsposaJubiladoAuto] = useState<{ ministroId: string | null; ministroNome: string | null } | null>(null);
  // Hospedagem AGO: solicitada pelo usuário mesmo quando tipo não inclui automaticamente
  const [solicitaHospedagem, setSolicitaHospedagem] = useState(false);

  // AGO — Campo Missionário: esposa do pastor
  const [incluirEsposa, setIncluirEsposa] = useState(false);
  const [formEsposa, setFormEsposa] = useState<FormEsposa>({ ...FORM_ESPOSA_VAZIO });
  const [hospEsposa, setHospEsposa] = useState<HospEsposa>({ ...HOSP_ESPOSA_VAZIO });

  // Termos/LGPD
  const [modalTermosAberto, setModalTermosAberto] = useState(false);

  // Lote (participantes extras)
  const [modoLote,          setModoLote]          = useState(false);
  const [participantesExtra,setParticipantesExtra] = useState<ParticipanteExtra[]>([]);
  const [extrasMinisteriais, setExtrasMinisteriais] = useState<ExtraMinisterialInfo[]>([]);

  // Confirmação + pagamento
  const [confirmacao,    setConfirmacao]    = useState<{
    qr_code: string;
    inscricaoId?: string;
    loteId?: string;
    qtdLote?: number;
    statusPagamento: string;
    pagamento: {
      asaasId: string | null;
      invoiceUrl: string | null;
      pixQrCode: string | null;
      pixCopiaECola: string | null;
      valor: number;
      vencimento: string;
    } | null;
    asaasError?: string;
  } | null>(null);
  const [totalInscritos, setTotalInscritos] = useState(0);
  const [verificando,    setVerificando]    = useState(false);
  const [statusChecked,  setStatusChecked]  = useState<string | null>(null);
  const [copiado,        setCopiado]        = useState(false);

  const [carregandoCampos, setCarregandoCampos] = useState(false);

  // ── Busca campos de uma supervisão específica (on-demand, evita limite 1000 do Supabase) ──
  const fetchCamposDaSupervisao = useCallback(async (supervisaoId: string) => {
    if (!supervisaoId) { setCampos([]); return [] as Campo[]; }
    setCarregandoCampos(true);
    try {
      const res = await fetch(`/api/public/estrutura?supervisao_id=${encodeURIComponent(supervisaoId)}&includeCamposInactive=true`);
      const json = res.ok ? await res.json().catch(() => null) : null;
      const lista = ((json?.campos as Campo[]) || []);
      setCampos(lista);
      return lista;
    } catch {
      setCampos([]);
      return [] as Campo[];
    } finally {
      setCarregandoCampos(false);
    }
  }, []);

  // ── Carrega evento ───────────────────────────────────────
  const fetchEvento = useCallback(async () => {
    if (!slug) return;
    setLoading(true);

    // Carrega apenas supervisões no início (campos são buscados on-demand)
    const estruturaPromise = fetch('/api/public/estrutura')
      .then(async (res) => (res.ok ? res.json() : null))
      .catch(() => null);

    const evRes = await fetch(`/api/public/evento?slug=${encodeURIComponent(slug)}`);
    const evJson = evRes.ok ? await evRes.json().catch(() => null as any) : null;
    const estrutura = await estruturaPromise;

    if (!evRes.ok || !evJson?.evento) {
      setEstadoErro('nao_encontrado');
      setLoading(false);
      return;
    }

    const ev = evJson.evento as Evento;
    const totalInscritos = typeof evJson?.totalInscritos === 'number' ? evJson.totalInscritos : null;
    const vagasHosp = typeof evJson?.vagasHospedagem === 'number' ? evJson.vagasHospedagem : null;
    const tiposApi = (evJson?.tipos as TipoInscricao[]) || [];

    const statusVisual = resolveEventoStatusVisual(ev);
    if (statusVisual !== 'programado') { setEstadoErro('encerrado'); setLoading(false); return; }
    if (!isEventoInscricaoPublicaDisponivel(ev)) { setEstadoErro('fechado'); setLoading(false); return; }

    // Verifica vagas
    if (ev.limite_vagas && totalInscritos !== null) {
      if (totalInscritos >= ev.limite_vagas) {
        setEstadoErro('esgotado');
        setLoading(false);
        return;
      }
      setTotalInscritos(totalInscritos);
    }

    // Verifica vagas de hospedagem
    if (ev.limite_hospedagem && vagasHosp !== null) {
      setVagasHospedagem(vagasHosp);
    }
    setVagasPorGrupo(evJson?.vagasPorGrupo || {});

    // Busca tipos de inscrição
    const tiposLimpos = dedupeTipos(tiposApi);
    setTipos(tiposLimpos);

    setEvento(ev);
    setSupervisoes((estrutura?.supervisoes as Supervisao[]) || []);
    // Campos serão carregados on-demand ao selecionar supervisão
    setCampos([]);
    setLoading(false);
  }, [slug]);

  useEffect(() => { fetchEvento(); }, [fetchEvento]);

  // ── Busca CPF ────────────────────────────────────────────
  // Para AGO: consulta a tabela `members` (base de ministros) e traz
  //   sexo, data_nascimento e cargo_ministerial além dos dados básicos.
  // Para outros eventos: consulta a mesma tabela `members` (base geral).
  async function buscarCPF(cpf: string) {
    const limpo = cpf.replace(/\D/g, '');
    if (limpo.length < 11 || !evento) return;
    setBuscandoCPF(true);
    setCpfStatus('idle');
    setEsposaJubiladoAuto(null);

    const isAGO = evento.departamento === 'AGO';
    const query = new URLSearchParams({ cpf: limpo });
    if (isAGO) query.set('includeMatricula', 'true');
    const res = await fetch(`/api/public/members/lookup?${query.toString()}`);
    const json = res.ok ? await res.json().catch(() => null as any) : null;
    const payload = (json ?? {}) as MemberLookupPayload;

    setBuscandoCPF(false);
    if (payload.encontrado) {
      const nome = (payload.nome ?? '') as string;
      setCpfStatus('encontrado');
      const conjugeJubiladoAuto = isAGO && (
        payload.lookup_kind === 'conjuge_jubilado'
        || !!payload.conjuge_jubilado_validado
      );
      const sup = supervisoes.find(s => s.id === payload.supervisao_id);
      const whatsappLookup = payload.whatsapp ?? payload.celular ?? payload.telefone ?? payload.phone ?? null;
      let camposDaSup: Campo[] = [];
      let campoSelecionado: Campo | null = null;

      if (sup?.id) {
        camposDaSup = await fetchCamposDaSupervisao(sup.id);
        campoSelecionado = camposDaSup.find(c => c.id === payload.campo_id) || null;
        if (!campoSelecionado && payload.campo_nome) {
          const campoNomeNorm = normalizarComparacao(payload.campo_nome);
          campoSelecionado = camposDaSup.find(c => normalizarComparacao(c.nome) === campoNomeNorm) || null;
        }
      } else {
        setCampos([]);
      }

      const confAgo = evento.configuracoes_ago;
      const descontoHabilitado = !!(confAgo?.habilitar_desconto_campo_missionario);
      const campoMissionario = payload.is_campo_missionario ?? campoSelecionado?.is_campo_missionario ?? false;

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

        setForm(f => ({
          ...f,
          nome_inscrito: nome || f.nome_inscrito,
          email: payload.email || f.email,
          whatsapp: whatsappLookup || f.whatsapp,
          supervisao_id: sup?.id || payload.supervisao_id || f.supervisao_id,
          campo_id: campoSelecionado?.id || payload.campo_id || '',
          sexo: 'F',
          ...(payload.data_nascimento ? { data_nascimento: formatYmdToDma(payload.data_nascimento) } : {}),
        }));

        const tipoEsposaJubilado = findTipoEsposaJubilado(tipos);
        if (tipoEsposaJubilado) {
          setTipoSelecionado(tipoEsposaJubilado);
          setCupomStatus('idle');
          setCupomDesconto(0);
          setCupomMeta(null);
        }
        return;
      }

      setEsposaJubiladoAuto(null);
      setDescontoCampoMissionario(descontoHabilitado && campoMissionario);

      const isPP = !!payload.pastor_presidente;
      const statusMinistro = payload.status ?? null;
      const ministerioAtivo = ['active', 'ativo'].includes((statusMinistro ?? '').toLowerCase());
      const sexoLookupRaw = String(payload.sexo || '').trim().toUpperCase();
      const sexoLookup = sexoLookupRaw.startsWith('M') ? 'M' : (sexoLookupRaw.startsWith('F') ? 'F' : 'M');

      setMinistroInfo({
        nome,
        matricula: payload.matricula ?? null,
        cargoMinisterial: payload.cargo_ministerial ?? null,
        email: payload.email ?? null,
        whatsapp: whatsappLookup,
        isPastorPresidente: isPP,
        isPastorAuxiliar: !!payload.pastor_auxiliar,
        isJubilado: !!payload.jubilado,
        status: statusMinistro,
        supervisao_id: payload.supervisao_id ?? null,
        supervisao_nome: payload.supervisao_nome ?? sup?.nome ?? null,
        campo_id: payload.campo_id ?? campoSelecionado?.id ?? null,
        campo_nome: campoSelecionado?.nome ?? payload.campo_nome ?? null,
        isCampoMissionario: campoMissionario,
      });

      const podeEsposa = ministerioAtivo && isPP && campoMissionario;
      if (podeEsposa) {
        setFormEsposa({
          nome: payload.nome_conjuge || '',
          cpf: payload.cpf_conjuge ? formatarCPF(payload.cpf_conjuge) : '',
          data_nascimento: payload.data_nascimento_conjuge ? formatYmdToDma(payload.data_nascimento_conjuge) : '',
          whatsapp: '',
        });
      } else {
        setIncluirEsposa(false);
        setFormEsposa({ ...FORM_ESPOSA_VAZIO });
        setHospEsposa({ ...HOSP_ESPOSA_VAZIO });
      }

      setForm(f => ({
        ...f,
        nome_inscrito: nome || f.nome_inscrito,
        email: payload.email || f.email,
        whatsapp: whatsappLookup || f.whatsapp,
        supervisao_id: sup?.id || payload.supervisao_id || f.supervisao_id,
        campo_id: campoSelecionado?.id || payload.campo_id || '',
        sexo: sexoLookup,
        data_nascimento: payload.data_nascimento ? formatYmdToDma(payload.data_nascimento) : f.data_nascimento,
      }));
    } else {
      setCpfStatus('nao_encontrado');
      setMinistroInfo(null);
      setEsposaJubiladoAuto(null);
      setDescontoCampoMissionario(false);
      setIncluirEsposa(false);
      setFormEsposa({ ...FORM_ESPOSA_VAZIO });
      setHospEsposa({ ...HOSP_ESPOSA_VAZIO });
    }
  }

  function handleText(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) {
    const { name, value } = e.target;
    if (name === 'cpf') {
      const masked = formatarCPF(value);
      setForm(f => ({ ...f, cpf: masked }));
      if (masked.replace(/\D/g, '').length === 11) buscarCPF(masked);
      return;
    }
    if (name === 'data_nascimento') {
      const masked = formatBirthDateInput(value);
      setForm(f => ({ ...f, data_nascimento: masked }));
      return;
    }
    if (name === 'supervisao_id') {
      setForm(f => ({ ...f, supervisao_id: value, campo_id: '' }));
      fetchCamposDaSupervisao(value);
      return;
    }
    setForm(f => ({ ...f, [name]: value }));
  }

  function handleCheck(e: React.ChangeEvent<HTMLInputElement>) {
    setForm(f => ({ ...f, [e.target.name]: e.target.checked }));
  }

  // ── Valida cupom ────────────────────────────────────────
  async function validarCupom() {
    if (!cupomCodigo.trim() || !evento) return;
    const valorBase = tipoSelecionado?.valor ?? evento.valor_inscricao;
    setCupomStatus('validando');
    try {
      const res  = await fetch(`/api/eventos/${evento.id}/cupons/validar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigo: cupomCodigo, valor_base: valorBase }),
      });
      const json = await res.json();
      if (json.valido) {
        setCupomStatus('ok');
        setCupomDesconto(json.desconto);
        setCupomMeta({
          tipo: json.tipo === 'percentual' ? 'percentual' : 'valor_fixo',
          valor: Number(json.valorCupom ?? 0),
        });
        setCupomMensagem(`Desconto de ${fmtMoeda(json.desconto)} aplicado!`);
      } else {
        setCupomStatus('erro');
        setCupomDesconto(0);
        setCupomMeta(null);
        setCupomMensagem(json.erro || 'Cupom inválido.');
      }
    } catch {
      setCupomStatus('erro');
      setCupomMeta(null);
      setCupomMensagem('Erro ao validar cupom.');
    }
  }

  // ── Adiciona participante no lote ───────────────────────
  function adicionarParticipante() {
    setParticipantesExtra(p => [...p, {
      nome_inscrito: '',
      cpf: '',
      email: '',
      whatsapp: '',
      sexo: '',
      data_nascimento: '',
      supervisao_id: form.supervisao_id,
      campo_id: form.campo_id,
      tipo_inscricao: '',
      hospedagem: false,
      hosp_necessidade_especial: false,
      hosp_descricao_necessidade: '',
      hosp_observacoes: '',
      hosp_possui_comorbidade: false,
      hosp_descricao_comorbidade: '',
    }]);
    setExtrasMinisteriais((m) => [...m, { ...EXTRA_MINISTERIAL_VAZIO }]);
  }

  function atualizarParticipante(idx: number, field: keyof ParticipanteExtra, value: string | boolean) {
    setParticipantesExtra(p => p.map((x, i) => {
      if (i !== idx) return x;
      if (field === 'sexo') {
        return {
          ...x,
          sexo: String(value || ''),
          tipo_inscricao: '',
        };
      }
      if (field === 'tipo_inscricao') {
        const selectedType = value ? tipos.find(t => t.nome === String(value)) : null;
        const autoHospedagem = selectedType ? !!selectedType.inclui_hospedagem : false;
        return {
          ...x,
          tipo_inscricao: String(value || ''),
          hospedagem: autoHospedagem ? true : x.hospedagem
        };
      }
      return { ...x, [field]: value };
    }));
  }

  function removerParticipante(idx: number) {
    setParticipantesExtra(p => p.filter((_, i) => i !== idx));
    setExtrasMinisteriais((m) => m.filter((_, i) => i !== idx));
  }

  async function buscarCpfParticipanteExtra(idx: number, cpfFormatado: string) {
    const cpfLimpo = cpfFormatado.replace(/\D/g, '');
    if (cpfLimpo.length !== 11) return;

    const res = await fetch(`/api/public/members/lookup?cpf=${cpfLimpo}&includeMatricula=true`);
    const payload = res.ok ? await res.json().catch(() => null as any) : null;

    if (!payload?.encontrado) {
      setExtrasMinisteriais((m) => m.map((x, i) => i === idx ? {
        ...EXTRA_MINISTERIAL_VAZIO,
        cpfStatus: 'nao_encontrado',
      } : x));
      return;
    }

    const statusMinistro = String(payload.status ?? '').toLowerCase();
    const ministroAtivoExtra = statusMinistro === 'active' || statusMinistro === 'ativo';
    const cargo = payload.cargo_ministerial ? String(payload.cargo_ministerial) : null;
    const isJubiladoExtra = !!payload.jubilado;

    setExtrasMinisteriais((m) => m.map((x, i) => i === idx ? {
      cpfStatus: 'encontrado',
      ministroAtivo: ministroAtivoExtra,
      cargoMinisterial: cargo,
      isPastorPresidente: !!payload.pastor_presidente,
      isPastorAuxiliar: !!payload.pastor_auxiliar,
      isJubilado: isJubiladoExtra,
    } : x));

    setParticipantesExtra((p) => p.map((x, i) => i === idx ? {
      ...x,
      sexo: payload.sexo || x.sexo,
      data_nascimento: payload.data_nascimento ? formatYmdToDma(payload.data_nascimento) : x.data_nascimento,
      supervisao_id: payload.supervisao_id || x.supervisao_id,
      campo_id: payload.campo_id || x.campo_id,
    } : x));

    if (ministroAtivoExtra && isJubiladoExtra) {
      const tipoJub = findTipoPastorJubilado(tipos);
      if (tipoJub) {
        setParticipantesExtra((p) => p.map((x, i) => i === idx ? { ...x, tipo_inscricao: tipoJub.nome } : x));
      }
    }
  }

  // Valor a pagar calculado
  const isPastorPresidenteTipo = !!(tipoSelecionado && /pastor\s*presidente/i.test(tipoSelecionado.nome));
  const configCM = parseCampoMissionarioConfig(evento?.configuracoes_ago ?? null);
  const fluxoCampoMissionarioEspecial =
    !!evento
    && evento.departamento === 'AGO'
    && !!configCM?.enabled
    && ['active', 'ativo'].includes((ministroInfo?.status ?? '').toLowerCase())
    && !!ministroInfo?.isPastorPresidente
    && !!ministroInfo?.isCampoMissionario;

  function getValorExibicaoTipo(tipo: TipoInscricao | null | undefined): number {
    if (!tipo) return 0;
    return tipo.valor;
  }

  const valorBase  = tipoSelecionado ? getValorExibicaoTipo(tipoSelecionado) : (evento?.valor_inscricao ?? 0);
  const valorFinal = Math.max(0, valorBase - cupomDesconto);
  // Valor da esposa (AGO Campo Missionário)
  const valorEsposaBase = configCM
    ? (typeof configCM.valor_esposa === 'number' ? configCM.valor_esposa : parseFloat(String(configCM.valor_esposa)) || 0)
    : 0;

  const podeHospedagem = !!evento?.permite_hospedagem && (
    evento.departamento === 'AGO'
      ? true
      : (tipoSelecionado ? !!tipoSelecionado.inclui_hospedagem : !evento.usar_tipos_inscricao)
  );

  const mainGroup = tipoSelecionado ? resolveGrupoHospedagemAGO({
    sexo: form.sexo || null,
    data_nascimento: formatDmaToYmd(form.data_nascimento) || null,
    tipo_inscricao: tipoSelecionado.nome,
    hosp_necessidade_especial: !!form.hosp_necessidade_especial,
    hosp_possui_comorbidade: !!form.hosp_possui_comorbidade,
  }) : '';
  const mainVagasGrupo = mainGroup ? (vagasPorGrupo[mainGroup] ?? 0) : 0;
  const mainGrupoEsgotado = evento?.departamento === 'AGO' && mainGroup && mainVagasGrupo <= 0;


  const cupomTipo = cupomMeta?.tipo ?? null;
  const cupomValor = cupomMeta?.valor ?? 0;
  const tiposReferenciaLote = tipos;
  const camposMissionarios = new Set(
    campos.filter(c => c.is_campo_missionario).map(c => c.id),
  );

  function calcularValorParticipanteLote(tipoNome: string | null, campoId: string | null, solicitarHospedagem: boolean) {
    const tipoBase = tiposReferenciaLote.find(t => t.nome === (tipoNome ?? ''));
    let valorBaseParticipante = tipoBase?.valor ?? 0;

    if (evento?.departamento === 'AGO' && configCM?.enabled && campoId && camposMissionarios.has(campoId)) {
      const tipoNorm = normalizarComparacao(tipoNome ?? '');
      const ehEsposa = tipoNorm.includes('esposa') || tipoNorm.includes('viuva') || tipoNorm.includes('viúva');
      const ehPastorPresidente = tipoNorm.includes('pastor presidente') && !ehEsposa;
      if (ehPastorPresidente) {
        const vPP = typeof configCM.valor_pastor_presidente === 'number'
          ? configCM.valor_pastor_presidente
          : parseFloat(String(configCM.valor_pastor_presidente)) || 0;
        if (vPP > 0) valorBaseParticipante = vPP;
      }
      if (ehEsposa && tipoNorm.includes('pastor presidente')) {
        if (valorEsposaBase > 0) valorBaseParticipante = valorEsposaBase;
      }
    }

    let descontoParticipante = 0;
    if (cupomStatus === 'ok' && cupomTipo && cupomValor > 0) {
      if (cupomTipo === 'percentual') {
        descontoParticipante = Math.round((valorBaseParticipante * cupomValor / 100) * 100) / 100;
      } else {
        descontoParticipante = Math.min(cupomValor, valorBaseParticipante);
      }
    }

    const valorFinalParticipante = Math.max(0, valorBaseParticipante - descontoParticipante);
    const alimentacaoParticipante = !!tipoBase?.inclui_alimentacao;
    const refeicoesParticipante = alimentacaoParticipante
      ? Math.max(0, Number(tipoBase?.quantidade_refeicoes ?? 0))
      : 0;
    const hospedagemParticipante = evento?.departamento === 'AGO'
      ? !!solicitarHospedagem
      : (!!tipoBase?.inclui_hospedagem || !!solicitarHospedagem);
    return {
      valorBaseParticipante,
      descontoParticipante,
      valorFinalParticipante,
      alimentacaoParticipante,
      refeicoesParticipante,
      hospedagemParticipante,
    };
  }

  const participantesCalculados = [
    {
      nome_inscrito: form.nome_inscrito || 'Titular',
      tipo_inscricao: tipoSelecionado?.nome ?? null,
      ...calcularValorParticipanteLote(tipoSelecionado?.nome ?? null, form.campo_id || null, !!solicitaHospedagem),
    },
    ...participantesExtra.map(p => ({
      nome_inscrito: p.nome_inscrito || 'Participante extra',
      tipo_inscricao: p.tipo_inscricao || null,
      ...calcularValorParticipanteLote(p.tipo_inscricao || null, p.campo_id || null, !!p.hospedagem),
    })),
  ];

  const qtdTotal   = modoLote ? 1 + participantesExtra.length : 1;
  const totalLote  = participantesCalculados.reduce((acc, p) => acc + p.valorFinalParticipante, 0);
  const totalComEsposa = incluirEsposa ? valorFinal + valorEsposaBase : valorFinal;

  // ── Filtragem de categorias AGO ──────────────────────────────────────────────
  // Ordem: 1.CPF/status  2.Cargo ministerial  3.Sexo  4.Idade  5.Campo Missionário (aplicado ao valor, não à categoria)
  const ministroAtivo = cpfStatus === 'encontrado' && ministroInfo !== null &&
    ['active', 'ativo'].includes((ministroInfo.status ?? '').toLowerCase());
  const ministroInativo = cpfStatus === 'encontrado' && ministroInfo !== null && !ministroAtivo;
  const dadosMinisteriaisBloqueados = evento?.departamento === 'AGO' && (ministroAtivo || !!esposaJubiladoAuto);
  const sexoTitularRaw = String(form.sexo || '').trim().toUpperCase();
  const sexoTitularNorm = sexoTitularRaw.startsWith('M') ? 'M' : sexoTitularRaw.startsWith('F') ? 'F' : '';

  const tipoJubiladoAutomatico = findTipoPastorJubilado(tipos);
  const tipoEsposaJubiladoAutomatico = findTipoEsposaJubilado(tipos);
  const jubiladoAutomaticoAtivo = !!(evento?.departamento === 'AGO' && ministroInfo?.isJubilado);
  const esposaJubiladoAutomaticoAtivo = !!(evento?.departamento === 'AGO' && esposaJubiladoAuto);

  const tiposParaExibir: TipoInscricao[] = (() => {
    if (!evento || evento.departamento !== 'AGO') return tipos;

    if (esposaJubiladoAutomaticoAtivo && tipoEsposaJubiladoAutomatico) {
      return [tipoEsposaJubiladoAutomatico];
    }

    if (jubiladoAutomaticoAtivo && tipoJubiladoAutomatico) {
      return [tipoJubiladoAutomatico];
    }

    if (!String(form.sexo || '').trim()) {
      return [];
    }

    const filtered = filtrarTiposAgo(tipos, {
      sexo: form.sexo,
      dataNascimento: formatDmaToYmd(form.data_nascimento),
      permitirViuvaEEsposaJubilado: false,
      permitirJubiladoManual: false,
      somentePastorPresidente: fluxoCampoMissionarioEspecial,
      cpfLocalizado: cpfStatus === 'encontrado',
      ministroAtivo,
      cargoMinisterial: ministroInfo?.cargoMinisterial ?? null,
      pastorPresidente: !!ministroInfo?.isPastorPresidente,
      pastorAuxiliar: !!ministroInfo?.isPastorAuxiliar,
      jubilado: !!ministroInfo?.isJubilado,
      isCampoMissionario: !!ministroInfo?.isCampoMissionario,
    });

    return filtered;
  })();

  const ppPorCampoNoLote = (() => {
    const mapa = new Map<string, number>();
    const incrementar = (campoId: string | null | undefined, tipoNome: string | null | undefined) => {
      const campoKey = String(campoId || '').trim();
      if (!campoKey) return;
      if (!ehTipoPastorPresidente(tipoNome)) return;
      mapa.set(campoKey, (mapa.get(campoKey) || 0) + 1);
    };

    incrementar(form.campo_id, tipoSelecionado?.nome ?? null);
    for (const p of participantesExtra) {
      incrementar(p.campo_id, p.tipo_inscricao);
    }
    return mapa;
  })();

  const tiposDisponiveisParticipanteLote = (idx: number): TipoInscricao[] => {
    const p = participantesExtra[idx];
    if (!p) return tipos;

    if (!String(p.sexo || '').trim()) return [];

    const extraMin = extrasMinisteriais[idx] ?? EXTRA_MINISTERIAL_VAZIO;
    const extraCpfLocalizado = extraMin.cpfStatus === 'encontrado';
    const extraMinistroAtivo = !!extraMin.ministroAtivo;
    const sexoExtraRaw = String(p.sexo || '').trim().toUpperCase();
    const sexoExtraNorm = sexoExtraRaw.startsWith('M') ? 'M' : sexoExtraRaw.startsWith('F') ? 'F' : '';
    const podePastorPresidente = extraCpfLocalizado && extraMinistroAtivo && !!extraMin.isPastorPresidente;
    const podePastorAuxiliar = extraCpfLocalizado
      && extraMinistroAtivo
      && sexoExtraNorm === 'M'
      && !extraMin.isPastorPresidente
      && !extraMin.isJubilado;
    const jubiladoAutomaticoExtra = extraCpfLocalizado && extraMinistroAtivo && !!extraMin.isJubilado;

    const campoKey = String(p.campo_id || '').trim();
    if (!campoKey) {
      return evento?.departamento === 'AGO'
        ? filtrarTiposAgo(tipos, {
          sexo: p.sexo,
          dataNascimento: formatDmaToYmd(p.data_nascimento),
          permitirViuvaEEsposaJubilado: false,
          permitirJubiladoManual: false,
          cpfLocalizado: extraCpfLocalizado,
          ministroAtivo: extraMinistroAtivo,
          cargoMinisterial: extraMin.cargoMinisterial,
          pastorPresidente: !!extraMin.isPastorPresidente,
          pastorAuxiliar: !!extraMin.isPastorAuxiliar,
          jubilado: !!extraMin.isJubilado,
        })
          .filter((t) => {
            if (ehTipoPastorPresidente(t.nome)) return podePastorPresidente;
            if (ehTipoPastorAuxiliar(t.nome)) return podePastorAuxiliar;
            if (ehTipoPastorJubilado(t.nome)) return jubiladoAutomaticoExtra;
            if (extraMinistroAtivo && ehTipoVisitante(t.nome)) return false;
            return true;
          })
        : tipos;
    }

    const participanteAtualEhPP = ehTipoPastorPresidente(p.tipo_inscricao);
    const qtdPPNoCampo = ppPorCampoNoLote.get(campoKey) || 0;
    const qtdPPNoCampoSemAtual = Math.max(0, qtdPPNoCampo - (participanteAtualEhPP ? 1 : 0));

    const tiposElegiveis = evento?.departamento === 'AGO'
      ? filtrarTiposAgo(tipos, {
        sexo: p.sexo,
        dataNascimento: formatDmaToYmd(p.data_nascimento),
        permitirViuvaEEsposaJubilado: false,
        permitirJubiladoManual: false,
        cpfLocalizado: extraCpfLocalizado,
        ministroAtivo: extraMinistroAtivo,
        cargoMinisterial: extraMin.cargoMinisterial,
        pastorPresidente: !!extraMin.isPastorPresidente,
        pastorAuxiliar: !!extraMin.isPastorAuxiliar,
        jubilado: !!extraMin.isJubilado,
      })
        .filter((t) => {
          if (ehTipoPastorPresidente(t.nome)) return podePastorPresidente;
          if (ehTipoPastorAuxiliar(t.nome)) return podePastorAuxiliar;
          if (ehTipoPastorJubilado(t.nome)) return jubiladoAutomaticoExtra;
          if (extraMinistroAtivo && ehTipoVisitante(t.nome)) return false;
          return true;
        })
      : tipos;

    return tiposElegiveis.filter((t) => {
      if (!ehTipoPastorPresidente(t.nome)) return true;
      return qtdPPNoCampoSemAtual < 1;
    });
  };
  const ministroSemPerfil = ministroAtivo && tiposParaExibir.length === 0;

  useEffect(() => {
    if (!fluxoCampoMissionarioEspecial) return;

    const tipoPP = tiposParaExibir.find(t => {
      const nome = normalizarComparacao(t.nome);
      return nome.includes('pastor presidente') && !nome.includes('esposa') && !nome.includes('viuva');
    }) || null;

    if (tipoPP && tipoSelecionado?.id !== tipoPP.id) {
      setTipoSelecionado(tipoPP);
      setCupomStatus('idle');
      setCupomDesconto(0);
      setCupomMeta(null);
    }

    if (modoLote) setModoLote(false);
    if (participantesExtra.length > 0) setParticipantesExtra([]);
    if (extrasMinisteriais.length > 0) setExtrasMinisteriais([]);
  }, [
    fluxoCampoMissionarioEspecial,
    tiposParaExibir,
    tipoSelecionado?.id,
    modoLote,
    participantesExtra.length,
    extrasMinisteriais.length,
  ]);

  useEffect(() => {
    if (!jubiladoAutomaticoAtivo || !tipoJubiladoAutomatico) return;
    if (tipoSelecionado?.id === tipoJubiladoAutomatico.id) return;

    setTipoSelecionado(tipoJubiladoAutomatico);
    setCupomStatus('idle');
    setCupomDesconto(0);
    setCupomMeta(null);
  }, [
    jubiladoAutomaticoAtivo,
    tipoJubiladoAutomatico,
    tipoSelecionado?.id,
  ]);

  useEffect(() => {
    if (!esposaJubiladoAutomaticoAtivo || !tipoEsposaJubiladoAutomatico) return;
    if (tipoSelecionado?.id === tipoEsposaJubiladoAutomatico.id) return;

    setTipoSelecionado(tipoEsposaJubiladoAutomatico);
    setCupomStatus('idle');
    setCupomDesconto(0);
    setCupomMeta(null);
  }, [
    esposaJubiladoAutomaticoAtivo,
    tipoEsposaJubiladoAutomatico,
    tipoSelecionado?.id,
  ]);

  useEffect(() => {
    if (!evento || evento.departamento !== 'AGO') return;
    if (!tipoSelecionado) return;

    const tipoAindaValido = tiposParaExibir.some((t) => t.id === tipoSelecionado.id);
    if (tipoAindaValido) return;

    setTipoSelecionado(null);
    setCupomStatus('idle');
    setCupomDesconto(0);
    setCupomMeta(null);
  }, [
    evento,
    tipoSelecionado,
    tiposParaExibir,
  ]);

  useEffect(() => {
    if (!modoLote || participantesExtra.length === 0) return;

    setParticipantesExtra((listaAtual) => {
      let alterou = false;
      const listaNova = listaAtual.map((p, idx) => {
        if (!String(p.sexo || '').trim()) {
          if (!p.tipo_inscricao) return p;
          alterou = true;
          return { ...p, tipo_inscricao: '' };
        }

        const nomesElegiveis = new Set(tiposDisponiveisParticipanteLote(idx).map((t) => t.nome));
        if (!p.tipo_inscricao || nomesElegiveis.has(p.tipo_inscricao)) return p;
        alterou = true;
        return { ...p, tipo_inscricao: '' };
      });

      return alterou ? listaNova : listaAtual;
    });
  }, [
    modoLote,
    participantesExtra,
    extrasMinisteriais,
    tipos,
    evento?.departamento,
  ]);

  useEffect(() => {
    if (tipoSelecionado) {
      if (tipoSelecionado.inclui_hospedagem) {
        setSolicitaHospedagem(true);
      } else {
        setSolicitaHospedagem(false);
      }
    }
  }, [tipoSelecionado]);

  const erroNomeTitular = erroForm === 'Nome completo é obrigatório.';
  const erroCpfTitular = erroForm === 'CPF é obrigatório.';
  const erroSupervisaoTitular = erroForm === 'Selecione a supervisão.';
  const erroTipoTitular = erroForm === 'Selecione o tipo de inscrição.' || erroForm === 'Selecione a modalidade de inscrição.';
  const erroNomeExtra = (idx: number) => erroForm === `Nome do participante ${idx + 2} é obrigatório.`;
  const erroSupervisaoExtra = (idx: number) => erroForm === `Supervisão do participante ${idx + 2} é obrigatória.`;
  const erroTipoExtra = (idx: number) => erroForm === `Tipo de inscrição do participante ${idx + 2} é obrigatório.`;
  const classeCampoObrigatorio = (temErro: boolean, classeBase = INP) => (
    temErro ? `${classeBase} border-red-500 ring-1 ring-red-200 bg-red-50` : classeBase
  );

  const grupoHospedagemPrevisto = resolveGrupoHospedagemAGO({
    sexo: form.sexo || null,
    data_nascimento: formatDmaToYmd(form.data_nascimento) || null,
    tipo_inscricao: tipoSelecionado?.nome || null,
    hosp_necessidade_especial: form.hosp_necessidade_especial,
    hosp_possui_comorbidade: form.hosp_possui_comorbidade,
  });
  const grupoHospedagemEsposaPrevisto = resolveGrupoHospedagemAGO({
    sexo: 'F',
    data_nascimento: formatDmaToYmd(formEsposa.data_nascimento) || null,
    tipo_inscricao: 'Esposa de Pastor Presidente Campo Missionário',
    hosp_necessidade_especial: hospEsposa.hosp_necessidade_especial,
    hosp_possui_comorbidade: hospEsposa.hosp_possui_comorbidade,
  });

  function termosSuporteTexto() {
    if (!evento?.suporte_whatsapp) return 'Canal de suporte: secretaria do evento.';
    const tel = evento.suporte_whatsapp.replace(/\D/g, '');
    const nome = evento.suporte_nome ? ` ${evento.suporte_nome}` : '';
    return `Canal de suporte:${nome} https://wa.me/55${tel}`;
  }

  function termoParagrafos() {
    if (!evento) return [] as string[];
    const depto = evento.departamento ? ` (${evento.departamento})` : '';
    const linhas = [
      `Termos de Uso e Politica de Privacidade — ${evento.nome}${depto}.`,
      'Ao realizar esta inscricao, voce declara estar ciente e concordar com as regras abaixo.',
      '1) Coleta de dados pessoais: Nome, CPF, e-mail, telefone/WhatsApp e dados de supervisao/campo sao coletados para fins de credenciamento e controle do evento.',
      '2) Uso dos dados: Os dados serao usados para comunicacoes do evento, confirmacao de inscricao, check-in, hospedagem (quando aplicavel), emissao de certificados e suporte ao participante.',
      '3) Comunicacao: Autorizo o envio de mensagens por e-mail e WhatsApp relacionadas ao evento e aos servicos contratados.',
      '4) Hospedagem e check-in: Caso eu solicite hospedagem, meus dados poderao ser usados para organizacao de alojamentos e controle de acesso.',
      '5) Certificados: Caso o evento gere certificados, meus dados serao usados para emissao e validacao.',
      '6) Armazenamento e seguranca: As informacoes sao armazenadas de forma segura e usadas apenas para os fins descritos neste termo.',
      '7) Nao compartilhamento indevido: Os dados nao serao compartilhados com terceiros sem necessidade operacional ou obrigacao legal.',
      '8) Consentimento LGPD: Autorizo o tratamento dos meus dados pessoais para as finalidades descritas, nos termos da Lei 13.709/2018 (LGPD).',
      '9) Uso de imagem: Autorizo, de forma gratuita, o uso de minha imagem em fotos e videos captados no evento para fins institucionais e de divulgacao.',
      '10) Responsabilidade do participante: Declaro que as informacoes fornecidas sao verdadeiras e de minha responsabilidade.',
      termosSuporteTexto(),
    ];
    return linhas;
  }

  // ── Envio do formulário — chama API server-side ─────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErroForm(null);
    if (!evento) return;
    if (!form.nome_inscrito.trim()) return setErroForm('Nome completo é obrigatório.');
    if (!form.cpf.replace(/\D/g, ''))  return setErroForm('CPF é obrigatório.');
    if (!form.whatsapp.replace(/\D/g, '')) return setErroForm('WhatsApp/Celular é obrigatório.');
    if (!form.data_nascimento) return setErroForm('Data de nascimento é obrigatória.');
    if (!form.supervisao_id)           return setErroForm('Selecione a supervisão.');

    const errDataTitular = validarDataNascimento(form.data_nascimento);
    if (errDataTitular) return setErroForm(errDataTitular);

    if (fluxoCampoMissionarioEspecial && incluirEsposa && formEsposa.data_nascimento) {
      if (!formEsposa.cpf.replace(/\D/g, '')) return setErroForm('CPF da cônjuge é obrigatório.');
      if (!formEsposa.whatsapp.replace(/\D/g, '')) return setErroForm('WhatsApp/Celular da cônjuge é obrigatório.');
      if (!formEsposa.data_nascimento) return setErroForm('Data de nascimento da cônjuge é obrigatória.');
      const errDataEsposa = validarDataNascimento(formEsposa.data_nascimento);
      if (errDataEsposa) return setErroForm(`Cônjuge: ${errDataEsposa}`);
    }

    if (evento.usar_tipos_inscricao && !tipoSelecionado)
      return setErroForm(evento.departamento === 'AGO' ? 'Selecione o tipo de inscrição.' : 'Selecione a modalidade de inscrição.');
    if (ministroSemPerfil)
      return setErroForm('Ministro localizado, mas o perfil ministerial não está definido para esta AGO. Verifique o cargo/cadastro do ministro e selecione uma categoria autorizada.');

    // Validação de descrições obrigatórias para hospedagem (necessidades especiais e comorbidades)
    if (form.hospedagem) {
      if (form.hosp_necessidade_especial && !form.hosp_descricao_necessidade.trim()) {
        return setErroForm('A descrição da necessidade especial é obrigatória.');
      }
      if (form.hosp_possui_comorbidade && !form.hosp_descricao_comorbidade.trim()) {
        return setErroForm('A descrição da comorbidade é obrigatória.');
      }
    }

    if (hospEsposa.solicitar) {
      if (hospEsposa.hosp_necessidade_especial && !hospEsposa.hosp_descricao_necessidade.trim()) {
        return setErroForm('A descrição da necessidade especial da cônjuge é obrigatória.');
      }
      if (hospEsposa.hosp_possui_comorbidade && !hospEsposa.hosp_descricao_comorbidade.trim()) {
        return setErroForm('A descrição da comorbidade da cônjuge é obrigatória.');
      }
    }

    // Valida participantes extras se modo lote
    if (modoLote) {
      if (fluxoCampoMissionarioEspecial) {
        return setErroForm('Campo Missionário permite inscrição apenas do Pastor Presidente e, opcionalmente, sua esposa.');
      }

      const ppPorCampo = new Map<string, number>();
      const somaPP = (campoId: string | null | undefined, tipoNome: string | null | undefined) => {
        const campoKey = String(campoId || '').trim();
        if (!campoKey || !ehTipoPastorPresidente(tipoNome)) return;
        ppPorCampo.set(campoKey, (ppPorCampo.get(campoKey) || 0) + 1);
      };

      somaPP(form.campo_id, tipoSelecionado?.nome ?? null);

      for (let i = 0; i < participantesExtra.length; i++) {
        const pExtra = participantesExtra[i];
        if (!pExtra.nome_inscrito.trim()) {
          return setErroForm(`Nome do participante ${i + 2} é obrigatório.`);
        }
        if (!pExtra.cpf.replace(/\D/g, '')) {
          return setErroForm(`CPF do participante ${i + 2} é obrigatório.`);
        }
        if (!pExtra.whatsapp.replace(/\D/g, '')) {
          return setErroForm(`WhatsApp/Celular do participante ${i + 2} é obrigatório.`);
        }
        if (!pExtra.data_nascimento) {
          return setErroForm(`Data de nascimento do participante ${i + 2} é obrigatória.`);
        }
        if (!pExtra.supervisao_id) {
          return setErroForm(`Supervisão do participante ${i + 2} é obrigatória.`);
        }
        if (evento.usar_tipos_inscricao && !pExtra.tipo_inscricao) {
          return setErroForm(`Tipo de inscrição do participante ${i + 2} é obrigatório.`);
        }

        const errDataExtra = validarDataNascimento(pExtra.data_nascimento);
        if (errDataExtra) {
          return setErroForm(`Participante ${i + 2}: ${errDataExtra}`);
        }

        if (pExtra.hospedagem) {
          if (pExtra.hosp_necessidade_especial && !pExtra.hosp_descricao_necessidade.trim()) {
            return setErroForm(`A descrição da necessidade especial do participante ${i + 2} é obrigatória.`);
          }
          if (pExtra.hosp_possui_comorbidade && !pExtra.hosp_descricao_comorbidade.trim()) {
            return setErroForm(`A descrição da comorbidade do participante ${i + 2} é obrigatória.`);
          }
        }

        somaPP(pExtra.campo_id, pExtra.tipo_inscricao);
        const campoKey = String(pExtra.campo_id || '').trim();
        if (campoKey && (ppPorCampo.get(campoKey) || 0) > 1) {
          return setErroForm(`Pastor Presidente só pode ter 1 inscrição por campo no lote (campo do participante ${i + 2}).`);
        }
      }
    }

    setSalvando(true);
    try {
      const qr = generateQRCodeToken();
      const body: Record<string, unknown> = normalizePayloadUppercase({
        slug:            evento.slug,
        nome_inscrito:   form.nome_inscrito.trim(),
        cpf:             form.cpf,
        email:           form.email.trim() || null,
        whatsapp:        form.whatsapp.trim() || null,
        sexo:            form.sexo || null,
        data_nascimento: formatDmaToYmd(form.data_nascimento) || null,
        supervisao_id:   form.supervisao_id || null,
        campo_id:        form.campo_id || null,
        // Regra 8: Hospedagem é opt-in quando o evento/tipo permitir
        hospedagem:      evento.usar_tipos_inscricao ? solicitaHospedagem : form.hospedagem,
        alimentacao:     !!tipoSelecionado?.inclui_alimentacao,
        brinde:          form.brinde,
        qr_code:         qr,
        tipo_inscricao:  tipoSelecionado?.nome ?? null,
        cupom_codigo:    cupomStatus === 'ok' && cupomCodigo ? cupomCodigo.toUpperCase() : null,
        // Campos hospedagem AGO
        hosp_necessidade_especial:  form.hosp_necessidade_especial,
        hosp_descricao_necessidade: form.hosp_descricao_necessidade.trim() || null,
        hosp_observacoes:           form.hosp_observacoes.trim() || null,
        hosp_possui_comorbidade:    form.hosp_possui_comorbidade,
        hosp_descricao_comorbidade: form.hosp_descricao_comorbidade.trim() || null,
        lgpd_aceito:                true,
      });

      if (!fluxoCampoMissionarioEspecial && modoLote && participantesExtra.length > 0) {
        body.participantes = participantesExtra.map(p => normalizePayloadUppercase({
          ...p,
          cpf:           p.cpf.replace(/\D/g, ''),
          data_nascimento: formatDmaToYmd(p.data_nascimento) || null,
          tipo_inscricao: p.tipo_inscricao || null,
          hospedagem:    !!p.hospedagem,
          hosp_necessidade_especial:  !!p.hospedagem && !!p.hosp_necessidade_especial,
          hosp_descricao_necessidade: !!p.hospedagem ? (p.hosp_descricao_necessidade.trim() || null) : null,
          hosp_observacoes:           !!p.hospedagem ? (p.hosp_observacoes.trim() || null) : null,
          hosp_possui_comorbidade:    !!p.hospedagem && !!p.hosp_possui_comorbidade,
          hosp_descricao_comorbidade: !!p.hospedagem ? (p.hosp_descricao_comorbidade.trim() || null) : null,
          brinde:        false,
          qr_code:       generateQRCodeToken(),
          lgpd_aceito:   true,
        }));
      }

      // AGO Campo Missionário — inscrição da esposa junto
      if (fluxoCampoMissionarioEspecial && incluirEsposa && formEsposa.nome.trim() && evento.departamento === 'AGO') {
        body.incluir_esposa = true;
        body.esposa = normalizePayloadUppercase({
          nome_inscrito:   formEsposa.nome.trim(),
          cpf:             formEsposa.cpf,
          data_nascimento: formatDmaToYmd(formEsposa.data_nascimento) || null,
          whatsapp:        formEsposa.whatsapp.trim() || null,
          sexo:            'F',
          tipo_inscricao:  'Esposa de Pastor Presidente Campo Missionário',
          hospedagem:      hospEsposa.solicitar,
          qr_code:         generateQRCodeToken(),
          // Campos hospedagem da esposa
          hosp_necessidade_especial:  hospEsposa.hosp_necessidade_especial,
          hosp_descricao_necessidade: hospEsposa.hosp_descricao_necessidade.trim() || null,
          hosp_observacoes:           hospEsposa.hosp_observacoes.trim() || null,
          hosp_possui_comorbidade:    hospEsposa.hosp_possui_comorbidade,
          hosp_descricao_comorbidade: hospEsposa.hosp_descricao_comorbidade.trim() || null,
          lgpd_aceito:                true,
        });
      }

      const res = await fetch('/api/eventos/inscricao', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        const base = json?.error || `Falha na inscrição (HTTP ${res.status})`;
        const details = json?.details ? `Detalhes: ${String(json.details)}` : null;
        const stage = json?.stage ? `Etapa: ${String(json.stage)}` : null;
        const code = json?.code ? `Código: ${String(json.code)}` : null;
        const msg = [base, details, stage, code].filter(Boolean).join(' | ');
        throw new Error(msg || 'Erro ao realizar inscrição');
      }
      setConfirmacao({
        qr_code:         qr,
        inscricaoId:     json.inscricaoId,
        loteId:          json.loteId,
        qtdLote:         json.inscricoes,
        statusPagamento: json.statusPagamento,
        pagamento:       json.pagamento ?? null,
        asaasError:      json.asaasError,
      });
    } catch (err: unknown) {
      setErroForm('Erro ao realizar inscrição: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSalvando(false);
    }
  }

  // ── Verifica status do pagamento (polling manual) ────────
  async function verificarPagamento() {
    if (!confirmacao?.inscricaoId) return;
    setVerificando(true);
    try {
      const res = await fetch(`/api/eventos/inscricao/${confirmacao.inscricaoId}/pagamento`);
      const json = await res.json();
      setStatusChecked(json.status);
      if (json.status === 'pago') {
        setConfirmacao(c => c ? { ...c, statusPagamento: 'pago' } : c);
      }
      // Atualiza QR code se chegou agora
      if (json.pixCopiaECola && confirmacao.pagamento && !confirmacao.pagamento.pixCopiaECola) {
        setConfirmacao(c => c ? {
          ...c,
          pagamento: c.pagamento ? { ...c.pagamento, pixCopiaECola: json.pixCopiaECola, pixQrCode: json.pixQrCode } : null,
        } : c);
      }
    } catch {
      // ignora silenciosamente
    } finally {
      setVerificando(false);
    }
  }

  async function copiarPix(texto: string) {
    try { await navigator.clipboard.writeText(texto); } catch { /* fallback: não faz nada */ }
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2500);
  }

  // ── Estados de erro ──────────────────────────────────────
  if (loading) return <PaginaLoading />;
  if (estadoErro) return <PaginaErro tipo={estadoErro} />;
  if (!evento)    return <PaginaErro tipo="nao_encontrado" />;

  // ── Confirmação pós-inscrição ────────────────────────────
  if (confirmacao) {
    const pago = confirmacao.statusPagamento === 'pago' || statusChecked === 'pago';
    const isento = confirmacao.statusPagamento === 'isento';
    const pag = confirmacao.pagamento;

    const vars: Record<string, string> = {
      NOME:        form.nome_inscrito,
      EVENTO:      evento.nome,
      LINK_GRUPO:  evento.link_whatsapp || '(em breve)',
      QR_CODE:     confirmacao.qr_code,
    };
    const mensagem = evento.mensagem_confirmacao
      ? substituirVariaveis(evento.mensagem_confirmacao, vars)
      : null;

    return (
      <PaginaPublica evento={evento}>
        <div className="max-w-lg mx-auto py-8 px-4">
          {/* Confirmação pós-inscrição: cabeçalho para lote */}
          <div className="text-center mb-6">
            <div className={`w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4 ${pago || isento ? 'bg-emerald-100' : 'bg-blue-100'}`}>
              <span className="text-4xl">{pago || isento ? '✅' : '📋'}</span>
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-1">
              {pago ? 'Pagamento confirmado!' : isento ? 'Inscrição gratuita!' : 'Inscrição realizada!'}
            </h2>
            <p className="text-gray-500">
              Obrigado, <span className="font-semibold text-[#123b63]">{form.nome_inscrito}</span>.
              {confirmacao.loteId
                ? ` Lote com ${confirmacao.qtdLote ?? 1} participante(s) registrado.`
                : isento ? ' Sua inscrição gratuita foi registrada.' : pago ? ' Seu pagamento foi confirmado.' : ' Complete o pagamento para garantir sua vaga.'}
            </p>
          </div>

          {/* Código de inscrição — exibido somente após confirmação do pagamento */}
          {(pago || isento) && (
            <div className="bg-gray-50 border-2 border-dashed border-gray-300 rounded-xl p-4 mb-5 text-center">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Código de inscrição</p>
              <p className="text-base font-mono font-bold text-[#123b63] tracking-widest">{confirmacao.qr_code}</p>
              <p className="text-xs text-gray-400 mt-1">Apresente este código no check-in do evento.</p>
            </div>
          )}

          {/* ── Bloco de pagamento ── */}
          {!isento && (
            <div className="mb-5">
              {/* Pago */}
              {pago && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5 text-center">
                  <p className="text-emerald-700 font-bold text-lg">✅ Pagamento confirmado</p>
                  <p className="text-emerald-600 text-sm mt-1">Sua vaga está garantida!</p>
                </div>
              )}

              {/* Pendente com dados ASAAS */}
              {!pago && pag && (
                <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
                  {/* Header */}
                  <div className="bg-[#123b63] text-white px-5 py-4">
                    <p className="font-bold text-base">💳 Realize o pagamento</p>
                    <p className="text-blue-200 text-sm mt-0.5">
                      {fmtMoeda(pag.valor)} • vence em {pag.vencimento?.split('-').reverse().join('/')}
                    </p>
                  </div>

                  <div className="p-5 space-y-4">
                    {/* PIX QR Code */}
                    {pag.pixQrCode && (
                      <div className="text-center">
                        <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">📱 PIX — Escaneie o QR Code</p>
                        <div className="inline-block border-4 border-[#123b63]/20 rounded-xl p-2 bg-white shadow-sm">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={`data:image/png;base64,${pag.pixQrCode}`}
                            alt="QR Code PIX"
                            width={200}
                            height={200}
                            className="mx-auto"
                          />
                        </div>
                      </div>
                    )}

                    {/* PIX copia e cola */}
                    {pag.pixCopiaECola && (
                      <div>
                        <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">📋 PIX Copia e Cola</p>
                        <div className="flex gap-2">
                          <div className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs font-mono text-gray-600 truncate">
                            {pag.pixCopiaECola.slice(0, 60)}…
                          </div>
                          <button
                            onClick={() => copiarPix(pag.pixCopiaECola!)}
                            className={`flex-shrink-0 px-4 py-2 rounded-xl text-xs font-semibold transition ${copiado ? 'bg-emerald-500 text-white' : 'bg-[#123b63] text-white hover:bg-[#0f2a45]'}`}>
                            {copiado ? '✅ Copiado' : '📋 Copiar'}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Link de pagamento alternativo */}
                    {pag.invoiceUrl && (
                      <div className="border-t border-gray-100 pt-4">
                        <p className="text-xs text-gray-500 mb-2 text-center">Prefere pagar de outra forma?</p>
                        <a href={pag.invoiceUrl} target="_blank" rel="noopener noreferrer"
                          className="flex items-center justify-center gap-2 w-full bg-white border-2 border-[#123b63] text-[#123b63] font-semibold text-sm py-2.5 rounded-xl hover:bg-[#123b63] hover:text-white transition">
                          💳 Abrir link de pagamento
                        </a>
                        <p className="text-center text-xs text-gray-400 mt-1">PIX, boleto, cartão de crédito</p>
                      </div>
                    )}

                    {/* Verificar pagamento */}
                    <div className="border-t border-gray-100 pt-4 text-center">
                      <button
                        onClick={verificarPagamento}
                        disabled={verificando}
                        className="inline-flex items-center gap-2 px-5 py-2 rounded-xl border border-[#123b63] text-[#123b63] text-sm font-semibold hover:bg-[#123b63]/5 transition disabled:opacity-50">
                        {verificando ? '⏳ Verificando…' : '🔄 Já paguei — verificar'}
                      </button>
                      {statusChecked && statusChecked !== 'pago' && (
                        <p className="text-xs text-amber-600 mt-2">Pagamento ainda não identificado. Aguarde alguns instantes.</p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Pendente SEM dados ASAAS (fallback) */}
              {!pago && !pag && (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 text-center">
                  {confirmacao.asaasError ? (
                    <>
                      <p className="text-amber-800 font-semibold text-sm">⚠️ Pagamento online temporariamente indisponível</p>
                      <p className="text-amber-700 text-xs mt-1">{confirmacao.asaasError}</p>
                    </>
                  ) : (
                    <>
                      <p className="text-amber-800 font-semibold text-sm">⏳ Pagamento pendente</p>
                      <p className="text-amber-700 text-xs mt-1">A organização do evento informará as instruções de pagamento.</p>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Aviso quando pagamento ainda pendente */}
          {!pago && !isento && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-5 text-sm text-blue-800">
              ℹ️ Após a confirmação do pagamento, você receberá por e-mail o código de check-in, o link do grupo do WhatsApp e as informações do evento.
            </div>
          )}

          {/* Mensagem de confirmação e grupo WhatsApp — somente após pagamento confirmado */}
          {(pago || isento) && (
            <>
              {mensagem && (
                <div className="bg-[#123b63]/5 border border-[#123b63]/20 rounded-xl p-5 mb-5">
                  <p className="text-xs font-semibold text-[#123b63] mb-3 uppercase tracking-wide">📢 Informações importantes</p>
                  <pre className="text-sm text-gray-700 whitespace-pre-wrap font-sans leading-relaxed">{mensagem}</pre>
                </div>
              )}
              {evento.link_whatsapp && (
                <a href={evento.link_whatsapp} target="_blank" rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 w-full bg-emerald-500 text-white px-6 py-3 rounded-xl font-semibold text-sm hover:bg-emerald-600 transition mb-4">
                  📲 Entrar no grupo do WhatsApp
                </a>
              )}
            </>
          )}
        </div>
      </PaginaPublica>
    );
  }

  const vagasRestantes = evento.limite_vagas ? evento.limite_vagas - totalInscritos : null;

  // ── Formulário público ───────────────────────────────────
  return (
    <PaginaPublica evento={evento}>
      <div className="max-w-2xl mx-auto px-4 pb-12">

        {/* Card de informações do evento */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden mb-8">
          {/* Banner */}
          <div className="relative bg-gradient-to-br from-[#0D2B4E] to-[#1A5276] h-48 flex items-center justify-center">
            {evento.banner_url ? (
              <img src={evento.banner_url} alt={evento.nome}
                className="absolute inset-0 w-full h-full object-cover" />
            ) : (
              <span className="text-7xl select-none">📅</span>
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
            <div className="absolute bottom-0 left-0 p-5 text-white">
              <span className="text-xs font-bold bg-[#F39C12] text-white px-2.5 py-0.5 rounded-full uppercase tracking-wide">
                {evento.departamento}
              </span>
              <h1 className="text-xl font-bold mt-2 leading-tight drop-shadow">{evento.nome}</h1>
            </div>
          </div>

          <div className="p-5">
            <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-gray-600 mb-4">
              <span className="flex items-center gap-1.5">📅 {fmtData(evento.data_inicio)} → {fmtData(evento.data_fim)}</span>
              {(evento.local || evento.cidade) &&
                <span className="flex items-center gap-1.5">📍 {[evento.local, evento.cidade].filter(Boolean).join(' — ')}</span>}
            </div>

            {evento.descricao && (
              <p className="text-sm text-gray-600 leading-relaxed border-t border-gray-100 pt-4 mb-4 whitespace-pre-line">{evento.descricao}</p>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <div className="bg-[#123b63]/10 text-[#123b63] px-4 py-2 rounded-xl text-sm font-bold">
                {evento.usar_tipos_inscricao ? '🎟️ Ver modalidades abaixo' : evento.valor_inscricao === 0 ? '🎁 Inscrição gratuita' : `💳 ${fmtMoeda(evento.valor_inscricao)}`}
              </div>
              {vagasRestantes !== null && (
                <div className={`px-3 py-1.5 rounded-xl text-xs font-semibold ${
                  vagasRestantes <= 10 ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'
                }`}>
                  {vagasRestantes <= 10 ? `⚠️ Últimas ${vagasRestantes} vagas` : `✅ ${vagasRestantes} vagas disponíveis`}
                </div>
              )}
              {evento.publico_alvo && (
                <div className="bg-gray-100 text-gray-600 px-3 py-1.5 rounded-xl text-xs font-semibold">
                  👥 {evento.publico_alvo}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Formulário de inscrição */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-xl font-bold text-[#123b63] mb-1 flex items-center gap-2">
            ✍️ Formulário de Inscrição
          </h2>
          <p className="text-sm text-gray-500 mb-6">Preencha os dados abaixo para realizar sua inscrição.</p>

          <form onSubmit={handleSubmit} noValidate>

            {/* CPF — primeiro campo */}
            <div className="mb-5">
              <label className={LBL}>CPF *</label>
              <div className="relative">
                <input name="cpf" value={form.cpf} onChange={handleText}
                  placeholder="000.000.000-00" maxLength={14}
                  className={classeCampoObrigatorio(erroCpfTitular, INP + (cpfStatus === 'encontrado' ? ' border-emerald-400 bg-emerald-50' : ''))}
                  required />
                {buscandoCPF && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 animate-pulse">
                    Buscando...
                  </span>
                )}
              </div>
              {cpfStatus === 'encontrado' && ministroAtivo && (
                <p className="mt-1 text-xs text-emerald-600 font-semibold">✅ Ministro ativo localizado — dados preenchidos automaticamente</p>
              )}
              {cpfStatus === 'encontrado' && ministroInativo && (
                <p className="mt-1 text-xs text-orange-600 font-semibold">⚠️ Registro ministerial localizado, mas não está ativo.</p>
              )}

            </div>

            {/* Card do ministro — AGO: exibe dados ministeriais após CPF encontrado */}
            {evento.departamento === 'AGO' && cpfStatus === 'encontrado' && ministroInfo && (
              <div className={`mb-5 p-4 rounded-xl border ${ministroAtivo ? 'bg-blue-50 border-blue-200' : 'bg-orange-50 border-orange-200'}`}>
                <div className="flex items-center justify-between mb-3">
                  <p className={`text-xs font-bold uppercase tracking-wide ${ministroAtivo ? 'text-blue-700' : 'text-orange-700'}`}>
                    {ministroAtivo ? '✅ Ministro COMIEADEPA localizado' : '⚠️ Registro ministerial encontrado'}
                  </p>
                  {!ministroAtivo && (
                    <span className="bg-orange-100 text-orange-700 border border-orange-300 px-2 py-0.5 rounded-full text-xs font-bold">
                      Não ativo
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                  <div className="col-span-2">
                    <span className="text-gray-500">Nome: </span>
                    <strong className="text-gray-800">{ministroInfo.nome}</strong>
                  </div>
                  {ministroInfo.matricula && (
                    <div>
                      <span className="text-gray-500">Matrícula: </span>
                      <strong className="text-gray-800">{ministroInfo.matricula}</strong>
                    </div>
                  )}
                  {ministroInfo.cargoMinisterial && (
                    <div>
                      <span className="text-gray-500">Cargo: </span>
                      <strong className="text-gray-800">{ministroInfo.cargoMinisterial}</strong>
                    </div>
                  )}
                  {form.campo_id && campos.find(c => c.id === form.campo_id) && (
                    <div>
                      <span className="text-gray-500">Campo: </span>
                      <strong className="text-gray-800">{campos.find(c => c.id === form.campo_id)?.nome}</strong>
                    </div>
                  )}
                  {!form.campo_id && ministroInfo.campo_nome && (
                    <div>
                      <span className="text-gray-500">Campo: </span>
                      <strong className="text-gray-800">{ministroInfo.campo_nome}</strong>
                    </div>
                  )}
                  {form.supervisao_id && supervisoes.find(s => s.id === form.supervisao_id) && (
                    <div>
                      <span className="text-gray-500">Supervisão: </span>
                      <strong className="text-gray-800">{supervisoes.find(s => s.id === form.supervisao_id)?.nome}</strong>
                    </div>
                  )}
                  {!form.supervisao_id && ministroInfo.supervisao_nome && (
                    <div>
                      <span className="text-gray-500">Supervisão: </span>
                      <strong className="text-gray-800">{ministroInfo.supervisao_nome}</strong>
                    </div>
                  )}
                  {ministroInfo.email && (
                    <div className="col-span-2">
                      <span className="text-gray-500">E-mail: </span>
                      <strong className="text-gray-800">{ministroInfo.email}</strong>
                    </div>
                  )}
                  {ministroInfo.whatsapp && (
                    <div className="col-span-2">
                      <span className="text-gray-500">WhatsApp: </span>
                      <strong className="text-gray-800">{ministroInfo.whatsapp}</strong>
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap gap-2 mt-3">
                  {ministroInfo.isPastorPresidente && (
                    <span className="bg-amber-100 text-amber-700 border border-amber-300 px-2 py-0.5 rounded-full text-xs font-bold">
                      ⭐ Pastor Presidente
                    </span>
                  )}
                  {ministroInfo.isPastorAuxiliar && (
                    <span className="bg-blue-100 text-blue-700 border border-blue-300 px-2 py-0.5 rounded-full text-xs font-bold">
                      Pastor Auxiliar
                    </span>
                  )}
                  {ministroInfo.isJubilado && (
                    <span className="bg-purple-100 text-purple-700 border border-purple-300 px-2 py-0.5 rounded-full text-xs font-bold">
                      🏅 Jubilado
                    </span>
                  )}
                  {ministroInfo.isCampoMissionario && (
                    <span className="bg-green-100 text-green-700 border border-green-300 px-2 py-0.5 rounded-full text-xs font-bold">
                      🌿 Campo Missionário
                    </span>
                  )}
                </div>
                {!ministroAtivo && (
                  <div className="mt-3 p-2 bg-orange-100 border border-orange-300 rounded-lg text-xs text-orange-800">
                    Este registro ministerial não está ativo. As categorias ministeriais (Pastor Presidente, Auxiliar, Jubilado) não estão disponíveis. Continue selecionando uma categoria não ministerial abaixo.
                  </div>
                )}
              </div>
            )}



            {/* Nome */}
            <div className="mb-5">
              <label className={LBL}>Nome completo *</label>
              <input name="nome_inscrito" value={form.nome_inscrito} onChange={handleText}
                placeholder="Seu nome completo"
                className={classeCampoObrigatorio(erroNomeTitular, INP + (dadosMinisteriaisBloqueados ? ' bg-gray-50 text-gray-600' : ''))} readOnly={dadosMinisteriaisBloqueados} required />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
              {/* E-mail */}
              <div>
                <label className={LBL}>E-mail</label>
                <input name="email" type="email" value={form.email} onChange={handleText}
                  placeholder="email@exemplo.com" className={INP} />
              </div>
              {/* WhatsApp */}
              <div>
                <label className={LBL}>WhatsApp</label>
                <input name="whatsapp" value={form.whatsapp} onChange={handleText}
                  placeholder="(00) 00000-0000" className={INP} />
              </div>
              {/* Sexo */}
              <div>
                <label className={LBL}>Sexo</label>
                <select
                  name="sexo"
                  value={form.sexo}
                  onChange={handleText}
                  className={INP + (cpfStatus === 'encontrado' || esposaJubiladoAutomaticoAtivo ? ' bg-gray-50 text-gray-600' : '')}
                  disabled={cpfStatus === 'encontrado' || esposaJubiladoAutomaticoAtivo}
                >
                  <option value="">Selecione...</option>
                  <option value="M">Masculino</option>
                  <option value="F">Feminino</option>
                </select>
              </div>
              {/* Data nascimento */}
              <div>
                <label className={LBL}>Data de Nascimento</label>
                <input
                  name="data_nascimento"
                  type="text"
                  inputMode="numeric"
                  placeholder="dd/mm/aaaa"
                  maxLength={10}
                  value={form.data_nascimento}
                  onChange={handleText}
                  className={INP + (dadosMinisteriaisBloqueados ? ' bg-gray-50 text-gray-600' : '')}
                  readOnly={dadosMinisteriaisBloqueados}
                />
              </div>
            </div>

            {/* Supervisão */}
            <div className="mb-4">
              <label className={LBL}>Supervisão *</label>
              <select name="supervisao_id" value={form.supervisao_id} onChange={handleText}
                className={classeCampoObrigatorio(erroSupervisaoTitular)} required>
                <option value="">Selecione a supervisão...</option>
                {supervisoes.map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}
              </select>
            </div>

            {/* Campo */}
            <div className="mb-6">
              <label className={LBL}>Campo</label>
              <select name="campo_id" value={form.campo_id} onChange={handleText} className={INP}
                disabled={carregandoCampos || !form.supervisao_id}>
                <option value="">
                  {carregandoCampos ? 'Carregando...' : !form.supervisao_id ? 'Selecione a supervisão primeiro' : 'Selecione o campo...'}
                </option>
                {campos.filter(c => !form.supervisao_id || c.supervisao_id === form.supervisao_id).map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </div>

            {/* Tipos de inscrição */}
            {evento.usar_tipos_inscricao && (
              evento.departamento === 'AGO' ? (
                <div className={erroTipoTitular ? 'mb-6 p-3 border border-red-300 bg-red-50 rounded-xl' : 'mb-6'}>
                  {/* Orientação: preencher sexo quando ainda não informado */}
                  {form.sexo === '' && (
                    <div className="mb-3 p-3 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-600">
                      ℹ️ Selecione o <strong>sexo</strong> para ver as categorias de inscrição disponíveis.
                    </div>
                  )}

                  {/* Dica: informar CPF para categorias ministeriais (sexo M, CPF ainda não verificado) */}
                  {sexoTitularNorm === 'M' && cpfStatus === 'idle' && (
                    <div className="mb-3 p-3 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-700">
                      🔍 Para categorias ministeriais (Pastor Presidente, Auxiliar, Jubilado), informe o CPF acima.
                    </div>
                  )}
                  {/* Dica: data de nascimento para Juventude (só quando sexo já preenchido) */}
                  {form.sexo !== '' && !form.data_nascimento && tipos.some(t => /juventude/i.test(t.nome)) && (
                    <div className="mb-3 p-3 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-600">
                      ℹ️ Informe a <strong>data de nascimento</strong> para verificar disponibilidade da categoria Juventude COMIEADEPA (até 29 anos).
                    </div>
                  )}
                  {/* Aviso ministro inativo */}
                  {ministroInativo && (
                    <div className="mb-3 p-3 bg-orange-50 border border-orange-200 rounded-xl text-xs text-orange-800">
                      ⚠️ Registro ministerial localizado, porém não está ativo. Categorias ministeriais indisponíveis. Continue com uma categoria não ministerial abaixo.
                    </div>
                  )}
                  {ministroSemPerfil && (
                    <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-800">
                      ⚠️ Ministro localizado, mas sem perfil ministerial compatível para esta AGO. Verifique o cadastro ministerial para liberar a categoria correta.
                    </div>
                  )}
                  {jubiladoAutomaticoAtivo && tipoJubiladoAutomatico && (
                    <div className="mb-3 p-3 bg-indigo-50 border border-indigo-200 rounded-xl text-xs text-indigo-800">
                      Categoria de Jubilado aplicada automaticamente pelo cadastro ministerial.
                    </div>
                  )}
                  {esposaJubiladoAutomaticoAtivo && (
                    <div className="mb-3 p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800">
                      Esposa de Pastor Jubilado identificada pelo cadastro ministerial. Cortesia aplicada automaticamente.
                    </div>
                  )}
                  {/* Nenhuma categoria disponível (só exibe se sexo foi selecionado) */}
                  {tiposParaExibir.length === 0 && form.sexo !== '' && (
                    <div className="p-4 bg-orange-50 border border-orange-200 rounded-xl text-sm text-orange-700">
                      ⚠️ Nenhuma categoria disponível para o perfil identificado. Verifique os dados informados ou entre em contato com a secretaria do evento.
                    </div>
                  )}
                  {/* Lista de categorias filtradas */}
                  {tiposParaExibir.length > 0 && (
                    <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl">
                      <p className="text-sm font-semibold text-[#123b63] mb-3">🏛️ Tipo de Inscrição</p>
                      <div className="space-y-2">
                        {tiposParaExibir.map(t => (
                          <label key={t.id} className={`flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-3 rounded-xl border-2 cursor-pointer transition ${tipoSelecionado?.id === t.id ? 'border-[#123b63] bg-white' : 'border-gray-200 bg-white hover:border-[#123b63]/50'}`}>
                            <div className="flex items-center gap-3">
                              <input type="radio" name="tipo_inscricao" value={t.id}
                                checked={tipoSelecionado?.id === t.id}
                                onChange={() => {
                                  if (jubiladoAutomaticoAtivo && tipoJubiladoAutomatico && t.id !== tipoJubiladoAutomatico.id) return;
                                  setTipoSelecionado(t); setCupomStatus('idle'); setCupomDesconto(0); setCupomMeta(null);
                                }}
                                className="accent-[#123b63]" />
                              <div>
                                <p className="text-sm font-semibold text-gray-800 flex items-center gap-2">
                                  {t.nome}
                                  {t.cortesia && (
                                    <span className="text-xs font-bold bg-green-100 text-green-700 border border-green-300 px-1.5 py-0.5 rounded-full">
                                      🎁 Cortesia
                                    </span>
                                  )}
                                </p>
                                <p className="text-xs text-gray-500">
                                  {[t.inclui_alimentacao && '🍽️ Alimentação', t.inclui_hospedagem && '🛏️ Hospedagem'].filter(Boolean).join(' + ') || 'Apenas plenárias'}
                                </p>
                              </div>
                            </div>
                            <span className="text-sm font-bold text-[#123b63] sm:whitespace-nowrap">
                              {(() => {
                                const vExib = getValorExibicaoTipo(t);
                                return vExib === 0 ? (t.cortesia ? 'Gratuito (Cortesia)' : 'Gratuito') : fmtMoeda(vExib);
                              })()}
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                tipos.length > 0 && (
                  <div className={erroTipoTitular ? 'mb-6 p-4 bg-red-50 border border-red-300 rounded-xl' : 'mb-6 p-4 bg-blue-50 border border-blue-200 rounded-xl'}>
                    <p className="text-sm font-semibold text-[#123b63] mb-3">📋 Modalidade de Inscrição</p>
                    <div className="space-y-2">
                      {tipos.map(t => (
                        <label key={t.id} className={`flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-3 rounded-xl border-2 cursor-pointer transition ${tipoSelecionado?.id === t.id ? 'border-[#123b63] bg-white' : 'border-gray-200 bg-white hover:border-[#123b63]/50'}`}>
                          <div className="flex items-center gap-3">
                            <input type="radio" name="tipo_inscricao" value={t.id}
                              checked={tipoSelecionado?.id === t.id}
                              onChange={() => { setTipoSelecionado(t); setCupomStatus('idle'); setCupomDesconto(0); setCupomMeta(null); }}
                              className="accent-[#123b63]" />
                            <div>
                              <p className="text-sm font-semibold text-gray-800 flex items-center gap-2">
                                {t.nome}
                                {t.cortesia && (
                                  <span className="text-xs font-bold bg-green-100 text-green-700 border border-green-300 px-1.5 py-0.5 rounded-full">
                                    🎁 Cortesia
                                  </span>
                                )}
                              </p>
                              <p className="text-xs text-gray-500">
                                {[t.inclui_alimentacao && '🍽️ Alimentação', t.inclui_hospedagem && '🛏️ Hospedagem'].filter(Boolean).join(' + ') || 'Apenas participação'}
                              </p>
                            </div>
                          </div>
                          <span className="text-sm font-bold text-[#123b63] sm:whitespace-nowrap">
                            {getValorExibicaoTipo(t) === 0 ? (t.cortesia ? 'Gratuito (Cortesia)' : 'Gratuito') : fmtMoeda(getValorExibicaoTipo(t))}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                )
              )
            )}

            {/* Serviços opcionais (apenas se não houver tipos configurados) */}
            {!evento.usar_tipos_inscricao && (evento.permite_hospedagem || evento.permite_brinde) && (
              <div className="mb-6 p-4 bg-gray-50 rounded-xl border border-gray-200">
                <p className="text-sm font-semibold text-gray-700 mb-3">Serviços adicionais</p>
                <div className="flex flex-wrap gap-4">
                  {evento.permite_hospedagem && (
                    <div>
                      <ChkPublico name="hospedagem"  label="🛏️ Hospedagem"  checked={form.hospedagem}  onChange={handleCheck} />
                      {vagasHospedagem !== null && (
                        <p className="text-xs text-gray-500 mt-1 ml-6">{vagasHospedagem} vagas restantes</p>
                      )}
                    </div>
                  )}
                  {evento.permite_brinde && (
                    <ChkPublico name="brinde"      label="🎁 Brinde"       checked={form.brinde}      onChange={handleCheck} />
                  )}
                </div>
              </div>
            )}

            {/* Informação sobre Alimentação */}
            {evento.usar_tipos_inscricao && tipoSelecionado && (
              <div className="mb-5 p-3.5 bg-gray-50 rounded-xl border border-gray-200 text-xs">
                {evento.departamento === 'AGO' ? (
                  <p className="text-emerald-700 font-bold flex items-center gap-1.5">
                    🍽️ Alimentação inclusa automaticamente para todos os inscritos da AGO — 12 refeições.
                  </p>
                ) : tipoSelecionado.inclui_alimentacao ? (
                  <p className="text-emerald-700 font-bold flex items-center gap-1.5">
                    🍽️ Alimentação inclusa: {tipoSelecionado.quantidade_refeicoes && tipoSelecionado.quantidade_refeicoes > 0 ? `${tipoSelecionado.quantidade_refeicoes} refeições.` : 'Alimentação inclusa nesta inscrição.'}
                  </p>
                ) : (
                  <p className="text-gray-500 font-semibold flex items-center gap-1.5">
                    🍽️ Esta categoria não inclui alimentação.
                  </p>
                )}
              </div>
            )}

            {/* Campos de hospedagem (opt-in) */}
            {podeHospedagem && (
              <div className="mb-6">
                {!(tipoSelecionado && tipoSelecionado.inclui_hospedagem) && (
                  <div className="mb-3 p-3 bg-gray-50 border border-gray-200 rounded-xl">
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input type="checkbox" id="solicita_hospedagem"
                        checked={solicitaHospedagem}
                        onChange={e => setSolicitaHospedagem(e.target.checked)}
                        className="accent-[#123b63]" />
                      <div>
                        <span className="text-sm font-semibold text-gray-700">🛏️ Desejo solicitar hospedagem</span>
                        <p className="text-xs text-gray-500 mt-0.5">
                          A solicitação não garante alocação. A organização fará a distribuição conforme disponibilidade.
                          {evento.departamento === 'AGO' && mainGroup ? (mainGroup === 'Misto' ? ' (Informe sexo/data/perfil para verificar vagas de hospedagem.)' : ` (Grupo: ${mainGroup} - ${mainVagasGrupo} vagas restantes)`) : (vagasHospedagem !== null && ` (${vagasHospedagem} vagas restantes)`)}
                        </p>
                        {mainGrupoEsgotado && mainGroup !== 'Misto' && (
                          <p className="text-xs text-red-600 font-bold mt-1.5">
                            ⚠️ Não há mais vagas de hospedagem disponíveis para o grupo {mainGroup}. Você ainda pode concluir a inscrição sem hospedagem.
                          </p>
                        )}
                      </div>
                    </label>
                  </div>
                )}

                {/* Detalhes de hospedagem: aparece somente quando o usuário solicitar e for evento AGO */}
                {evento.departamento === 'AGO' && solicitaHospedagem && (
                  <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl">
                    <p className="text-sm font-bold text-amber-800 mb-3">🏨 Informações de Hospedagem (AGO)</p>

                    {/* Observações configuradas pelo organizador */}
                    {evento.configuracoes_ago?.observacoes && (
                      <div className="mb-3 p-3 bg-amber-100 border border-amber-300 rounded-lg text-xs text-amber-900 whitespace-pre-wrap">
                        {evento.configuracoes_ago.observacoes}
                      </div>
                    )}

                    <div className="flex items-start gap-3 mb-3">
                      <input type="checkbox" id="hosp_necessidade_especial"
                        name="hosp_necessidade_especial" checked={form.hosp_necessidade_especial}
                        onChange={handleCheck}
                        className="mt-0.5 accent-amber-600" />
                      <label htmlFor="hosp_necessidade_especial" className="text-sm text-gray-700 cursor-pointer">
                        Possuo <strong>necessidade especial</strong> de acessibilidade
                        <span className="block text-xs text-gray-500 mt-0.5">
                          (mobilidade reduzida, deficiência visual, problema de coluna, cirurgia recente, etc.)
                        </span>
                      </label>
                    </div>

                    {form.hosp_necessidade_especial && (
                      <div className="mb-3">
                        <label className={LBL}>Descreva a necessidade *</label>
                        <input name="hosp_descricao_necessidade"
                          value={form.hosp_descricao_necessidade}
                          onChange={handleText}
                          placeholder="Ex: mobilidade reduzida, usa cadeira de rodas..."
                          className={INP}
                          required />
                      </div>
                    )}

                    <div className="flex items-start gap-3 mb-3">
                      <input type="checkbox" id="hosp_possui_comorbidade"
                        name="hosp_possui_comorbidade" checked={form.hosp_possui_comorbidade}
                        onChange={handleCheck}
                        className="mt-0.5 accent-amber-600" />
                      <label htmlFor="hosp_possui_comorbidade" className="text-sm text-gray-700 cursor-pointer">
                        Possuo <strong>comorbidade</strong> relevante
                        <span className="block text-xs text-gray-500 mt-0.5">
                          (diabetes, hipertensão, cardíaco, renal, imunossuprimido, etc.)
                        </span>
                      </label>
                    </div>

                    {form.hosp_possui_comorbidade && (
                      <div className="mb-3">
                        <label className={LBL}>Descreva a comorbidade *</label>
                        <input name="hosp_descricao_comorbidade"
                          value={form.hosp_descricao_comorbidade}
                          onChange={handleText}
                          placeholder="Ex: diabético tipo 2, hipertenso controlado..."
                          className={INP}
                          required />
                      </div>
                    )}

                    <div className="mb-3 p-3 bg-white border border-amber-300 rounded-lg">
                      <p className="text-xs font-bold text-amber-800 uppercase tracking-wide">Grupo previsto</p>
                      <p className="text-sm text-gray-700 mt-1">
                        {evento.departamento === 'AGO' && grupoHospedagemPrevisto === 'Misto'
                          ? 'Informe sexo/data/perfil para verificar vagas de hospedagem.'
                          : grupoHospedagemPrevisto}
                      </p>
                      <p className="text-xs text-gray-500 mt-1">
                        A cama inferior e o grupo final sao definidos automaticamente pela organizacao conforme idade, necessidade especial, comorbidades e categoria.
                      </p>
                    </div>

                    <div>
                      <label className={LBL}>Observações de hospedagem (opcional)</label>
                      <textarea name="hosp_observacoes"
                        value={form.hosp_observacoes}
                        onChange={handleText}
                        rows={2}
                        placeholder="Alguma informação relevante para a equipe de hospedagem..."
                        className={INP + ' resize-none'} />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Badge Campo Missionário */}
            {descontoCampoMissionario && isPastorPresidenteTipo && (
              <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-xl flex items-start gap-2">
                <span className="text-green-700 text-base">🏷</span>
                <div>
                  <p className="text-sm font-bold text-green-800">Campo Missionário</p>
                  <p className="text-xs text-green-700">Seu campo possui classificação missionária. O valor especial de Pastor Presidente foi aplicado automaticamente.</p>
                </div>
              </div>
            )}

            {/* AGO — Incluir Esposa (Campo Missionário) */}
            {evento?.departamento === 'AGO' && fluxoCampoMissionarioEspecial && (
              <div className="mb-5 p-4 bg-purple-50 border border-purple-200 rounded-xl">
                <label className="flex items-center gap-3 cursor-pointer select-none">
                  <input type="checkbox" checked={incluirEsposa}
                    onChange={e => { setIncluirEsposa(e.target.checked); if (!e.target.checked) { setHospEsposa({ ...HOSP_ESPOSA_VAZIO }); } }}
                    className="accent-purple-700 w-4 h-4" />
                  <div>
                    <span className="text-sm font-semibold text-purple-900">👩 Incluir inscrição da esposa</span>
                    <p className="text-xs text-purple-700 mt-0.5">
                      Valor: {valorEsposaBase > 0 ? fmtMoeda(valorEsposaBase) : 'gratuito'}
                      {' '}— Será gerada uma inscrição separada com pagamento unificado.
                    </p>
                  </div>
                </label>

                {incluirEsposa && (
                  <div className="mt-4 space-y-3">
                    <p className="text-xs font-bold text-purple-800 uppercase tracking-wide">Dados da Esposa</p>
                    <div>
                      <label className={LBL}>Nome completo *</label>
                      <input value={formEsposa.nome} onChange={e => setFormEsposa(f => ({ ...f, nome: e.target.value }))}
                        placeholder="Nome completo da esposa" className={INP} required />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className={LBL}>CPF</label>
                        <input value={formEsposa.cpf} onChange={e => setFormEsposa(f => ({ ...f, cpf: formatarCPF(e.target.value) }))}
                          placeholder="000.000.000-00" maxLength={14} className={INP} />
                      </div>
                      <div>
                        <label className={LBL}>Data de Nascimento</label>
                        <input
                          type="text"
                          inputMode="numeric"
                          placeholder="dd/mm/aaaa"
                          maxLength={10}
                          value={formEsposa.data_nascimento}
                          onChange={e => {
                            const formatted = formatBirthDateInput(e.target.value);
                            setFormEsposa(f => ({ ...f, data_nascimento: formatted }));
                          }}
                          className={INP}
                        />
                      </div>
                    </div>
                    <div>
                      <label className={LBL}>WhatsApp da esposa</label>
                      <input value={formEsposa.whatsapp} onChange={e => setFormEsposa(f => ({ ...f, whatsapp: e.target.value }))}
                        placeholder="(00) 00000-0000" className={INP} />
                    </div>

                    {/* Hospedagem da esposa */}
                    {evento.permite_hospedagem && (() => {
                      const esposaVagasGrupo = grupoHospedagemEsposaPrevisto ? (vagasPorGrupo[grupoHospedagemEsposaPrevisto] ?? 0) : 0;
                      const esposaGrupoEsgotado = evento.departamento === 'AGO' && grupoHospedagemEsposaPrevisto && esposaVagasGrupo <= 0;
                      return (
                        <div className="mt-3 p-3 bg-white border border-purple-200 rounded-lg">
                          <label className="flex items-start gap-3 cursor-pointer select-none">
                            <input type="checkbox" checked={hospEsposa.solicitar}
                              onChange={e => setHospEsposa(h => ({ ...h, solicitar: e.target.checked }))}
                              className="mt-0.5 accent-purple-700" />
                            <div>
                              <span className="text-sm font-semibold text-gray-700">🛏️ Desejo solicitar hospedagem para a esposa</span>
                              <p className="text-xs text-gray-500 mt-0.5">
                                A hospedagem é independente — cada inscrição decide individualmente.
                                {evento.departamento === 'AGO' && grupoHospedagemEsposaPrevisto && ` (Grupo: ${grupoHospedagemEsposaPrevisto} - ${esposaVagasGrupo} vagas restantes)`}
                              </p>
                              {esposaGrupoEsgotado && (
                                <p className="text-xs text-red-600 font-bold mt-1.5">
                                  ⚠️ Não há mais vagas de hospedagem disponíveis para o grupo {grupoHospedagemEsposaPrevisto}. Você ainda pode concluir a inscrição sem hospedagem.
                                </p>
                              )}
                            </div>
                          </label>

                          {hospEsposa.solicitar && (
                            <div className="mt-3 space-y-3">
                              <div className="flex items-start gap-3">
                                <input type="checkbox" id="hosp_esp_nec_especial" checked={hospEsposa.hosp_necessidade_especial}
                                  onChange={e => setHospEsposa(h => ({ ...h, hosp_necessidade_especial: e.target.checked }))}
                                  className="mt-0.5 accent-amber-600" />
                                <label htmlFor="hosp_esp_nec_especial" className="text-sm text-gray-700 cursor-pointer">
                                  Possui <strong>necessidade especial</strong> de acessibilidade
                                </label>
                              </div>
                              {hospEsposa.hosp_necessidade_especial && (
                                <div className="space-y-1">
                                  <label className={LBL}>Descreva a necessidade *</label>
                                  <input value={hospEsposa.hosp_descricao_necessidade}
                                    onChange={e => setHospEsposa(h => ({ ...h, hosp_descricao_necessidade: e.target.value }))}
                                    placeholder="Ex: mobilidade reduzida..." className={INP} />
                                </div>
                              )}
                              <div className="flex items-start gap-3">
                                <input type="checkbox" id="hosp_esp_comorbidade" checked={hospEsposa.hosp_possui_comorbidade}
                                  onChange={e => setHospEsposa(h => ({ ...h, hosp_possui_comorbidade: e.target.checked }))}
                                  className="mt-0.5 accent-amber-600" />
                                <label htmlFor="hosp_esp_comorbidade" className="text-sm text-gray-700 cursor-pointer">
                                  Possui <strong>comorbidade</strong> relevante
                                </label>
                              </div>
                              {hospEsposa.hosp_possui_comorbidade && (
                                <div className="space-y-1">
                                  <label className={LBL}>Descreva a comorbidade *</label>
                                  <input value={hospEsposa.hosp_descricao_comorbidade}
                                    onChange={e => setHospEsposa(h => ({ ...h, hosp_descricao_comorbidade: e.target.value }))}
                                    placeholder="Ex: diabetes..." className={INP} />
                                </div>
                              )}
                              <div className="p-3 bg-white border border-amber-300 rounded-lg">
                                <p className="text-xs font-bold text-amber-800 uppercase tracking-wide">Grupo previsto</p>
                                <p className="text-sm text-gray-700 mt-1">
                                  {evento.departamento === 'AGO' && grupoHospedagemEsposaPrevisto === 'Misto'
                                    ? 'Informe sexo/data/perfil para verificar vagas de hospedagem.'
                                    : grupoHospedagemEsposaPrevisto}
                                </p>
                                <p className="text-xs text-gray-500 mt-1">
                                  A cama inferior e o grupo final da esposa tambem sao definidos automaticamente pela organizacao.
                                </p>
                              </div>
                              <textarea value={hospEsposa.hosp_observacoes}
                                onChange={e => setHospEsposa(h => ({ ...h, hosp_observacoes: e.target.value }))}
                                rows={2} placeholder="Observações de hospedagem (opcional)" className={INP + ' resize-none'} />
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>
            )}

            {/* Cupom de desconto */}
            {evento.possuiCupomAtivo && (evento.usar_tipos_inscricao || evento.valor_inscricao > 0) && (
              <div className="mb-6">
                <p className="text-sm font-semibold text-gray-700 mb-2">🏷️ Cupom de desconto</p>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input value={cupomCodigo} onChange={e => { setCupomCodigo(e.target.value); setCupomStatus('idle'); setCupomDesconto(0); }}
                    placeholder="Código do cupom"
                    className={INP + ' w-full sm:flex-1 uppercase'}
                    disabled={cupomStatus === 'ok'} />
                  {cupomStatus !== 'ok' ? (
                    <button type="button" onClick={validarCupom} disabled={!cupomCodigo.trim() || cupomStatus === 'validando'}
                      className="w-full sm:w-auto px-4 py-2 bg-[#123b63] text-white text-sm font-semibold rounded-xl hover:bg-[#0f2a45] transition disabled:opacity-50 whitespace-nowrap">
                      {cupomStatus === 'validando' ? 'Validando...' : 'Aplicar'}
                    </button>
                  ) : (
                    <button type="button" onClick={() => { setCupomStatus('idle'); setCupomCodigo(''); setCupomDesconto(0); setCupomMeta(null); }}
                      className="w-full sm:w-auto px-4 py-2 bg-gray-200 text-gray-600 text-sm font-semibold rounded-xl hover:bg-gray-300 transition whitespace-nowrap">
                      Remover
                    </button>
                  )}
                </div>
                {cupomStatus === 'ok' && (
                  <p className="text-emerald-600 text-xs font-semibold mt-1.5">✅ {cupomMensagem}</p>
                )}
                {cupomStatus === 'erro' && (
                  <p className="text-red-600 text-xs mt-1.5">❌ {cupomMensagem}</p>
                )}
              </div>
            )}

            {/* Resumo do valor */}
            {(evento.usar_tipos_inscricao || evento.valor_inscricao > 0 || modoLote || incluirEsposa) && (
              <div className="mb-5 p-4 bg-[#123b63]/5 rounded-xl border border-[#123b63]/20 text-sm">
                {cupomDesconto > 0 && (
                  <div className="flex justify-between text-gray-600 mb-1">
                    <span>Valor base</span><span>{fmtMoeda(valorBase)}</span>
                  </div>
                )}
                {cupomDesconto > 0 && (
                  <div className="flex justify-between text-emerald-600 mb-1">
                    <span>Desconto</span><span>- {fmtMoeda(cupomDesconto)}</span>
                  </div>
                )}
                {modoLote && qtdTotal > 1 && (
                  <div className="flex justify-between text-gray-600 mb-1">
                    <span>Participantes</span><span>× {qtdTotal}</span>
                  </div>
                )}
                {modoLote && qtdTotal > 1 && (
                  <div className="mt-2 mb-2 rounded-lg border border-[#123b63]/15 bg-white/70 p-3">
                    <p className="text-xs font-bold text-[#123b63] mb-2 uppercase tracking-wide">Resumo do lote</p>
                    {participantesCalculados.map((pc, idx) => (
                      <div key={`resumo-lote-${idx}`} className="flex justify-between text-xs text-gray-700 mb-1">
                        <span>
                          {idx === 0 ? 'Titular' : `Participante extra ${idx}`}: {pc.tipo_inscricao || 'Sem tipo selecionado'}
                        </span>
                        <span>{fmtMoeda(pc.valorFinalParticipante)}</span>
                      </div>
                    ))}
                  </div>
                )}
                {incluirEsposa && (
                  <div className="flex justify-between text-purple-700 mb-1">
                    <span>Esposa (Campo Missionário)</span><span>+ {fmtMoeda(valorEsposaBase)}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-[#123b63] border-t border-[#123b63]/20 pt-2 mt-1">
                  <span>Total a pagar</span>
                  <span>{modoLote && qtdTotal > 1 ? fmtMoeda(totalLote) : fmtMoeda(incluirEsposa ? totalComEsposa : valorFinal)}</span>
                </div>
              </div>
            )}

            {/* Inscrição em lote */}
            {!fluxoCampoMissionarioEspecial && (
              <div className="mb-5">
                <button type="button" onClick={() => {
                  setModoLote(m => !m);
                  if (modoLote) {
                    setParticipantesExtra([]);
                    setExtrasMinisteriais([]);
                  }
                }}
                  className="text-sm text-[#123b63] font-semibold underline underline-offset-2 hover:text-[#0f2a45]">
                  {modoLote ? '➖ Cancelar inscrição em grupo' : '➕ Adicionar mais participantes (inscrição em grupo)'}
                </button>
              </div>
            )}

            {fluxoCampoMissionarioEspecial && (
              <div className="mb-5 p-3 bg-green-50 border border-green-200 rounded-xl text-xs text-green-800">
                Fluxo Campo Missionário ativo: inscrição apenas do Pastor Presidente e, opcionalmente, de sua esposa.
              </div>
            )}

            {modoLote && (
              <div className="mb-6 space-y-4">
                {participantesExtra.map((p, idx) => (
                  <div key={idx} className="p-4 bg-gray-50 border border-gray-200 rounded-xl">
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-sm font-semibold text-gray-700">Participante {idx + 2}</p>
                      <button type="button" onClick={() => removerParticipante(idx)} className="text-red-500 text-xs hover:underline">Remover</button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="sm:col-span-2">
                        <label className={LBL}>Nome completo *</label>
                        <input value={p.nome_inscrito} onChange={e => atualizarParticipante(idx, 'nome_inscrito', e.target.value)} className={classeCampoObrigatorio(erroNomeExtra(idx))} placeholder="Nome completo" required />
                      </div>
                      <div>
                        <label className={LBL}>CPF</label>
                        <input
                          value={p.cpf}
                          onChange={async (e) => {
                            const masked = formatarCPF(e.target.value);
                            atualizarParticipante(idx, 'cpf', masked);
                            const cpfDigits = masked.replace(/\D/g, '');
                            if (cpfDigits.length === 11) {
                              await buscarCpfParticipanteExtra(idx, masked);
                            } else {
                              setExtrasMinisteriais((m) => m.map((x, i) => i === idx ? { ...EXTRA_MINISTERIAL_VAZIO } : x));
                            }
                          }}
                          className={INP}
                          placeholder="000.000.000-00"
                          maxLength={14}
                        />
                      </div>
                      <div>
                        <label className={LBL}>WhatsApp</label>
                        <input value={p.whatsapp} onChange={e => atualizarParticipante(idx, 'whatsapp', e.target.value)} className={INP} placeholder="(00) 00000-0000" />
                      </div>
                      <div>
                        <label className={LBL}>Sexo</label>
                        <select value={p.sexo} onChange={e => atualizarParticipante(idx, 'sexo', e.target.value)} className={INP}>
                          <option value="">Selecione...</option>
                          <option value="M">Masculino</option>
                          <option value="F">Feminino</option>
                        </select>
                      </div>
                      <div>
                        <label className={LBL}>Data de Nascimento</label>
                        <input
                          type="text"
                          inputMode="numeric"
                          placeholder="dd/mm/aaaa"
                          maxLength={10}
                          value={p.data_nascimento}
                          onChange={e => {
                            const formatted = formatBirthDateInput(e.target.value);
                            atualizarParticipante(idx, 'data_nascimento', formatted);
                          }}
                          className={INP}
                        />
                      </div>
                      <div>
                        <label className={LBL}>Supervisão *</label>
                        <select value={p.supervisao_id} onChange={e => atualizarParticipante(idx, 'supervisao_id', e.target.value)} className={classeCampoObrigatorio(erroSupervisaoExtra(idx))} required>
                          <option value="">Selecione...</option>
                          {supervisoes.map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className={LBL}>Campo</label>
                        <select value={p.campo_id} onChange={e => atualizarParticipante(idx, 'campo_id', e.target.value)} className={INP}>
                          <option value="">Selecione...</option>
                          {campos.filter(c => !p.supervisao_id || c.supervisao_id === p.supervisao_id).map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                        </select>
                      </div>
                      <div className="sm:col-span-2">
                        <label className={LBL}>Tipo de inscrição *</label>
                        <select
                          value={p.tipo_inscricao}
                          onChange={e => atualizarParticipante(idx, 'tipo_inscricao', e.target.value)}
                          className={classeCampoObrigatorio(erroTipoExtra(idx))}
                          disabled={!String(p.sexo || '').trim()}
                          required
                        >
                          <option value="">{String(p.sexo || '').trim() ? 'Selecione o tipo...' : 'Aguardando dados!'}</option>
                          {tiposDisponiveisParticipanteLote(idx).map(t => (
                            <option key={`extra-${idx}-${t.id}`} value={t.nome}>
                              {t.nome} - {fmtMoeda(getValorExibicaoTipo(t))}
                            </option>
                          ))}
                        </select>
                        {String(p.campo_id || '').trim() && tiposDisponiveisParticipanteLote(idx).length === 0 && (
                          <p className="mt-1 text-xs text-amber-700">Sem tipos disponíveis para este campo com as seleções atuais.</p>
                        )}
                      </div>

                      {/* Informação sobre Alimentação do Participante Extra */}
                      {evento.usar_tipos_inscricao && p.tipo_inscricao && (() => {
                        const tipoExtra = tipos.find(t => t.nome === p.tipo_inscricao);
                        if (!tipoExtra) return null;
                        return (
                          <div className="sm:col-span-2 mt-1.5 p-3.5 bg-white rounded-xl border border-gray-200 text-xs">
                            {evento.departamento === 'AGO' ? (
                              <p className="text-emerald-700 font-bold flex items-center gap-1.5">
                                🍽️ Alimentação inclusa automaticamente para todos os inscritos da AGO — 12 refeições.
                              </p>
                            ) : tipoExtra.inclui_alimentacao ? (
                              <p className="text-emerald-700 font-bold flex items-center gap-1.5">
                                🍽️ Alimentação inclusa: {tipoExtra.quantidade_refeicoes && tipoExtra.quantidade_refeicoes > 0 ? `${tipoExtra.quantidade_refeicoes} refeições.` : 'Alimentação inclusa nesta inscrição.'}
                              </p>
                            ) : (
                              <p className="text-gray-500 font-semibold flex items-center gap-1.5">
                                🍽️ Esta categoria não inclui alimentação.
                              </p>
                            )}
                          </div>
                        );
                      })()}

                      {(() => {
                        const tipoExtra = tipos.find(t => t.nome === p.tipo_inscricao);
                        const podeHospedagemExtra = !!evento.permite_hospedagem && (
                          evento.departamento === 'AGO'
                            ? true
                            : (tipoExtra ? !!tipoExtra.inclui_hospedagem : !evento.usar_tipos_inscricao)
                        );
                        if (!podeHospedagemExtra) return null;

                        const extraGroup = resolveGrupoHospedagemAGO({
                          sexo: p.sexo || null,
                          data_nascimento: formatDmaToYmd(p.data_nascimento) || null,
                          tipo_inscricao: p.tipo_inscricao || null,
                          hosp_necessidade_especial: !!p.hosp_necessidade_especial,
                          hosp_possui_comorbidade: !!p.hosp_possui_comorbidade,
                        });
                        const extraVagasGrupo = extraGroup ? (vagasPorGrupo[extraGroup] ?? 0) : 0;
                        const extraGrupoEsgotado = evento.departamento === 'AGO' && extraGroup && extraVagasGrupo <= 0;

                        return (
                          <div className="sm:col-span-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
                            {!(tipoExtra && tipoExtra.inclui_hospedagem) && (
                              <label className="flex items-start gap-3 cursor-pointer select-none">
                                <input
                                  type="checkbox"
                                  checked={!!p.hospedagem}
                                  onChange={e => atualizarParticipante(idx, 'hospedagem', e.target.checked)}
                                  className="mt-0.5 accent-[#123b63]"
                                />
                                <div>
                                  <span className="text-sm font-semibold text-gray-700">🛏️ Desejo solicitar hospedagem</span>
                                  <p className="text-xs text-gray-500 mt-0.5">
                                    A solicitação não garante alocação. A organização fará a distribuição conforme disponibilidade.
                                    {evento.departamento === 'AGO' && extraGroup ? (extraGroup === 'Misto' ? ' (Informe sexo/data/perfil para verificar vagas de hospedagem.)' : ` (Grupo: ${extraGroup} - ${extraVagasGrupo} vagas restantes)`) : (vagasHospedagem !== null && ` (${vagasHospedagem} vagas restantes)`)}
                                  </p>
                                  {extraGrupoEsgotado && extraGroup !== 'Misto' && (
                                    <p className="text-xs text-red-600 font-bold mt-1.5">
                                      ⚠️ Não há mais vagas de hospedagem disponíveis para o grupo {extraGroup}. Você ainda pode concluir a inscrição sem hospedagem.
                                    </p>
                                  )}
                                </div>
                              </label>
                            )}

                            {evento.departamento === 'AGO' && p.hospedagem && (
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                                <label className="inline-flex items-center gap-2 text-xs text-gray-700">
                                  <input
                                    type="checkbox"
                                    checked={!!p.hosp_necessidade_especial}
                                    onChange={e => atualizarParticipante(idx, 'hosp_necessidade_especial', e.target.checked)}
                                    className="accent-[#123b63]"
                                  />
                                  Necessidade especial
                                </label>
                                <label className="inline-flex items-center gap-2 text-xs text-gray-700">
                                  <input
                                    type="checkbox"
                                    checked={!!p.hosp_possui_comorbidade}
                                    onChange={e => atualizarParticipante(idx, 'hosp_possui_comorbidade', e.target.checked)}
                                    className="accent-[#123b63]"
                                  />
                                  Comorbidade
                                </label>
                                <div className="sm:col-span-2">
                                  <label className={LBL}>Descrição da necessidade {p.hosp_necessidade_especial ? '*' : '(opcional)'}</label>
                                  <textarea
                                    value={p.hosp_descricao_necessidade}
                                    onChange={e => atualizarParticipante(idx, 'hosp_descricao_necessidade', e.target.value)}
                                    rows={2}
                                    placeholder={p.hosp_necessidade_especial ? "Descreva a necessidade especial..." : ""}
                                    className={INP + ' resize-none'}
                                  />
                                </div>
                                <div className="sm:col-span-2">
                                  <label className={LBL}>Descrição da comorbidade {p.hosp_possui_comorbidade ? '*' : '(opcional)'}</label>
                                  <textarea
                                    value={p.hosp_descricao_comorbidade}
                                    onChange={e => atualizarParticipante(idx, 'hosp_descricao_comorbidade', e.target.value)}
                                    rows={2}
                                    placeholder={p.hosp_possui_comorbidade ? "Descreva a comorbidade..." : ""}
                                    className={INP + ' resize-none'}
                                  />
                                </div>
                                <div className="sm:col-span-2">
                                  <label className={LBL}>Observações de hospedagem (opcional)</label>
                                  <textarea
                                    value={p.hosp_observacoes}
                                    onChange={e => atualizarParticipante(idx, 'hosp_observacoes', e.target.value)}
                                    rows={2}
                                    className={INP + ' resize-none'}
                                  />
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                ))}
                <button type="button" onClick={adicionarParticipante}
                  className="w-full py-2.5 border-2 border-dashed border-[#123b63]/40 text-[#123b63] text-sm font-semibold rounded-xl hover:border-[#123b63] hover:bg-[#123b63]/5 transition">
                  ➕ Adicionar participante
                </button>
              </div>
            )}

            {erroForm && (
              <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm" role="alert" aria-live="assertive">
                {erroForm}
              </div>
            )}

            <button type="submit" disabled={salvando}
              className="w-full bg-[#123b63] text-white py-3.5 rounded-xl font-bold text-base hover:bg-[#0f2a45] transition disabled:opacity-50 flex items-center justify-center gap-2">
              {salvando
                ? <><Spinner /> Enviando inscrição...</>
                : modoLote && qtdTotal > 1
                  ? `✅ Confirmar ${qtdTotal} inscrições — ${fmtMoeda(totalLote)}`
                  : '✅ Confirmar Inscrição'}
            </button>
            <p className="mt-4 text-xs text-gray-500 leading-relaxed">
              Ao clicar em Confirmar Inscrição, você declara que leu e concorda com os{' '}
              <button
                type="button"
                onClick={() => setModalTermosAberto(true)}
                className="text-[#123b63] font-semibold underline underline-offset-2"
              >
                Termos de Uso
              </button>
              {' '}e a{' '}
              <button
                type="button"
                onClick={() => setModalTermosAberto(true)}
                className="text-[#123b63] font-semibold underline underline-offset-2"
              >
                Política de Privacidade
              </button>
              .
            </p>
          </form>
        </div>
      </div>

      {modalTermosAberto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-3">
          <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-base font-bold text-gray-800">Termos de Uso e Política de Privacidade</h3>
              <button
                type="button"
                onClick={() => setModalTermosAberto(false)}
                className="text-gray-400 hover:text-gray-600"
                aria-label="Fechar"
              >
                ✕
              </button>
            </div>
            <div className="px-5 py-4 max-h-[70vh] overflow-y-auto text-sm text-gray-700 leading-relaxed">
              {termoParagrafos().map((p, idx) => (
                <p key={idx} className="mb-3">
                  {p}
                </p>
              ))}
            </div>
            <div className="px-5 py-4 border-t border-gray-100 flex justify-end">
              <button
                type="button"
                onClick={() => setModalTermosAberto(false)}
                className="px-4 py-2 rounded-lg bg-[#123b63] text-white text-sm font-semibold hover:bg-[#0f2a45] transition"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </PaginaPublica>
  );
}

// ─── Layout público ──────────────────────────────────────────
function PaginaPublica({ evento, children }: { evento: Evento; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header institucional */}
      <header className="bg-[#0D2B4E] text-white shadow-md">
        <div className="max-w-4xl mx-auto px-4 py-4 flex flex-wrap items-center gap-3">
          <div className="w-9 h-9 bg-[#F39C12] rounded-lg flex items-center justify-center flex-shrink-0">
            <span className="text-white font-black text-sm">GS</span>
          </div>
          <div>
            <p className="font-bold text-sm leading-tight">SISCOMIEADEPA</p>
            <p className="text-xs text-blue-300 leading-tight">Sistema de Gestão Convencional v.2.0</p>
          </div>
          <div className="w-full sm:w-auto sm:ml-auto flex flex-wrap items-center gap-3">
            <Link
              href="/eventos-publicos"
              className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-white/85 hover:bg-white/15"
            >
              ← Voltar ao portal
            </Link>
            <span className="hidden sm:inline text-xs text-blue-300 font-medium">📅 {evento.nome}</span>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-2 pt-6">
        {children}
      </main>

      <footer className="text-center py-8 mt-8 text-xs text-gray-400 border-t border-gray-200">
        SISCOMIEADEPA • Sistema de Gestão Convencional v.2.0
      </footer>

      {/* Assistente flutuante do evento */}
      <AssistenteWidget eventoId={evento.id} nomeEvento={evento.nome} />
    </div>
  );
}

// ─── Páginas de estado ───────────────────────────────────────
function PaginaLoading() {
  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center">
      <div className="text-center">
        <Spinner large />
        <p className="mt-4 text-sm text-gray-500">Carregando evento...</p>
      </div>
    </div>
  );
}

const MSGS_ERRO = {
  nao_encontrado: { icon: '🔍', titulo: 'Evento não encontrado', desc: 'O link acessado não corresponde a nenhum evento cadastrado.' },
  fechado:        { icon: '🔒', titulo: 'Inscrições encerradas', desc: 'As inscrições para este evento estão fechadas no momento.' },
  encerrado:      { icon: '📋', titulo: 'Evento encerrado',      desc: 'Este evento já foi realizado ou foi cancelado.' },
  esgotado:       { icon: '⚠️', titulo: 'Vagas esgotadas',       desc: 'Todas as vagas disponíveis para este evento já foram preenchidas.' },
};

function PaginaErro({ tipo }: { tipo: keyof typeof MSGS_ERRO }) {
  const cfg = MSGS_ERRO[tipo];
  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-10 max-w-md text-center">
        <span className="text-6xl mb-4 block">{cfg.icon}</span>
        <h2 className="text-xl font-bold text-gray-900 mb-2">{cfg.titulo}</h2>
        <p className="text-sm text-gray-500">{cfg.desc}</p>
      </div>
    </div>
  );
}

// ─── Micro-componentes ────────────────────────────────────────
const LBL = 'block text-sm font-semibold text-gray-700 mb-1.5';
const INP = 'w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#123b63] bg-white transition';

function ChkPublico({ name, label, checked, onChange }: {
  name: string; label: string; checked: boolean;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <label className="flex items-center gap-2.5 cursor-pointer group">
      <input type="checkbox" name={name} checked={checked} onChange={onChange}
        className="w-4 h-4 accent-[#123b63] cursor-pointer" />
      <span className="text-sm text-gray-700 group-hover:text-[#123b63] transition">{label}</span>
    </label>
  );
}

function Spinner({ large }: { large?: boolean }) {
  return (
    <div className={`inline-block border-2 border-gray-300 border-t-[#123b63] rounded-full animate-spin ${large ? 'w-10 h-10' : 'w-4 h-4'}`} />
  );
}
