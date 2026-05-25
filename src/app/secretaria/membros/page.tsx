'use client';

import { useState, useEffect, useRef } from 'react';
import Sidebar from '@/components/Sidebar';
import NotificationModal from '@/components/NotificationModal';
import FichaMembro from '@/components/FichaMembro';
import DocCasaDoPastor from '@/components/DocCasaDoPastor';
import CartãoMembro from '@/components/CartãoMembro';
import CartaoBatchPrinter from '@/components/CartaoBatchPrinter';
import CartaMudanca from '@/components/CartaMudanca';
import CartaRecomendacao from '@/components/CartaRecomendacao';
import DocumentosMinistro from '@/components/DocumentosMinistro';
import HistoricoMinistro from '@/components/HistoricoMinistro';
import MembrosOverview from '@/components/MembrosOverview';
import { getCargosMinisteriais, type CargoMinisterial } from '@/lib/cargos-utils';
import { fetchConfiguracaoIgrejaFromSupabase } from '@/lib/igreja-config-utils';
import { getMensagemSemTemplate } from '@/lib/cartoes-utils';
import { createClient } from '@/lib/supabase-client';
import { loadOrgNomenclaturasFromSupabaseOrMigrate } from '@/lib/org-nomenclaturas';
import { loadTemplatesForCurrentUser } from '@/lib/cartoes-templates-sync';
import { authenticatedFetch } from '@/lib/api-client';
import { useMembers } from '@/hooks/useMembers';
import type { Member, CreateMemberRequest, UpdateMemberRequest } from '@/types/supabase';

interface Membro {
  id: string;
  uniqueId: string; // UNIQUE ID com 16 caracteres para QR Code
  matricula: string;
  nome: string;
  cpf: string;
  tipoCadastro: 'membro' | 'congregado' | 'ministro' | 'crianca';

  supervisao: string;
  campo: string;
  congregacao: string;
  status: 'ativo' | 'inativo' | 'desligado' | 'jubilado' | 'em_processo' | 'falecido';
  jubilado?: boolean;
  // Dados pessoais
  dataNascimento?: string;
  sexo?: string;
  tipoSanguineo?: string;
  escolaridade?: string;
  estadoCivil?: string;
  nomeConjuge?: string;
  cpfConjuge?: string;
  dataNascimentoConjuge?: string;
  nomePai?: string;
  nomeMae?: string;
  rg?: string;
  orgaoEmissor?: string;
  nacionalidade?: string;
  naturalidade?: string;
  uf?: string;
  // Endereço
  cep?: string;
  logradouro?: string;
  numero?: string;
  bairro?: string;
  complemento?: string;
  cidade?: string;
  latitude?: string;
  longitude?: string;
  // Contato
  email?: string;
  celular?: string;
  whatsapp?: string;
  // Foto
  fotoUrl?: string;
  // Ministeriais
  temFuncaoIgreja?: boolean;
  qualFuncao?: string;
  setorDepartamento?: string;
  dataBatismoAguas?: string;
  dataBatismoEspiritoSanto?: string;
  cursoTeologico?: string;
  instituicaoTeologica?: string;
  pastorAuxiliar?: boolean;
  pastorPresidente?: boolean;
  diretoriaCargo?: string;
  diretoria?: boolean;
  procedencia?: string;
  procedenciaLocal?: string;
  cargoMinisterial?: string;
  dataConsagracao?: string;
  dataEmissao?: string;
  dataValidadeCredencial?: string;
  dadosCargos?: {
    [key: string]: {
      dataConsagracaoRecebimento: string;
      localConsagracao: string;
      localOrigem: string;
    }
  };
  observacoesMinisteriais?: string;
}

interface DivisaoOption {
  id: string;
  nome: string;
  supervisao_id?: string | null;
  campo_id?: string | null;
}

export default function MembrosPage() {
  const supabase = createClient();

  const [dashboardView, setDashboardView] = useState<'overview' | 'list' | 'aniversariantes'>('overview');
  const [activeMenu, setActiveMenu] = useState('membros');
  const [activeTab, setActiveTab] = useState('dados');

  // ── Aniversariantes ──────────────────────────────────────────────
  const [anivMes, setAnivMes] = useState<number>(new Date().getMonth() + 1);
  const [anivPage, setAnivPage] = useState<number>(1);
  const ANIV_POR_PAGINA = 25;
  const ANIV_TEXTO_DEFAULT = 'Feliz Aniversário, {nome}! 🎉\n\nA COMIEADEPA deseja que Deus te abençoe grandemente neste dia tão especial!\n\nCom carinho,\nSecretaria COMIEADEPA';
  const [anivTexto, setAnivTexto] = useState<string>(() =>
    typeof window !== 'undefined' ? (localStorage.getItem('aniv_mensagem_texto') ?? ANIV_TEXTO_DEFAULT) : ANIV_TEXTO_DEFAULT
  );
  const [anivImagemUrl, setAnivImagemUrl] = useState<string>(() =>
    typeof window !== 'undefined' ? (localStorage.getItem('aniv_mensagem_imagem') ?? '') : ''
  );
  const [_anivImagemFile, setAnivImagemFile] = useState<File | null>(null); void _anivImagemFile;
  const [anivEnviando, setAnivEnviando] = useState<string | null>(null);
  const [anivSoHoje, setAnivSoHoje] = useState<boolean>(false);
  const anivFileRef = useRef<HTMLInputElement>(null);
  const [templatesSnapshot, setTemplatesSnapshot] = useState<any[]>([]);
  const [configIgreja, setConfigIgreja] = useState({
    nome: 'Igreja/Ministério',
    endereco: '',
    cnpj: '',
    telefone: '',
    email: '',
    logo: ''
  });

  // Função para gerar UNIQUE ID no formato Bubble: timestamp + 'x' + random 18 dígitos
  const gerarUniqueId = (): string => {
    const ts = Date.now().toString();
    const rand = Array.from({ length: 18 }, () => Math.floor(Math.random() * 10)).join('');
    return `${ts}x${rand}`;
  };

  const onlyDigits = (value: string) => value.replace(/\D/g, '');

  const formatCpf = (cpf: string) => {
    const digits = onlyDigits(cpf).slice(0, 11);
    if (!digits) return '';
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
    if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
  };

  const formatPhone = (value: string) => {
    const digits = onlyDigits(value).slice(0, 11);
    if (!digits) return '';
    if (digits.length <= 2) return `(${digits}`;
    if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
    if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  };

  const normalizeTipoCadastro = (value: any): Membro['tipoCadastro'] => {
    const v = String(value || '').toLowerCase();
    if (v === 'membro' || v === 'congregado' || v === 'ministro' || v === 'crianca') return v as any;
    return 'ministro';
  };

  const dbStatusToUi = (status: Member['status'] | string | null | undefined): Membro['status'] => {
    if (status === 'active' || status === 'ativo') return 'ativo';
    if (status === 'falecido' || status === 'deceased') return 'falecido';
    if (status === 'desligado') return 'desligado';
    if (status === 'jubilado') return 'jubilado';
    if (status === 'em_processo') return 'em_processo';
    return 'inativo'; // inactive e qualquer outro
  };

  // Resolve o status considerando tipo_cadastro (situação ministerial real) com prioridade
  const resolveStatusFromMember = (member: Member): Membro['status'] => {
    const tc = String(member.tipo_cadastro || '').toUpperCase().trim();
    if (tc.includes('FALECIDO')) return 'falecido';
    if (tc.includes('DESLIGADO')) return 'desligado';
    if (tc === 'EM PROCESSO') return 'em_processo';
    if (tc === 'SUSPENSO' || tc === 'INATIVO' || tc === 'LICENCIADO' || tc === 'DISPONIBILIDADE' || tc === 'ARQUIVO MORTO') return 'inativo';
    // fallback para coluna status do banco
    return dbStatusToUi(member.status);
  };

  const uiStatusToDb = (status: Membro['status']): string => {
    if (status === 'ativo') return 'active';
    if (status === 'desligado') return 'desligado';
    if (status === 'jubilado') return 'jubilado';
    if (status === 'em_processo') return 'em_processo';
    if (status === 'falecido') return 'deceased';
    return 'inactive';
  };

  const memberToMembro = (member: Member): Membro => {
    const cf = (member.custom_fields && typeof member.custom_fields === 'object') ? member.custom_fields : {};
    const cargoMinisterial = String(
      (cf as any).cargoMinisterial ||
      (cf as any).cargo_ministerial ||
      member.cargo_ministerial ||
      member.profissao ||
      ''
    );
    const stableUniqueId =
      member.unique_id ||
      (typeof (cf as any).uniqueId === 'string' && String((cf as any).uniqueId).length >= 8
        ? String((cf as any).uniqueId)
        : String(member.id || '').replace(/-/g, '').slice(0, 16).toUpperCase());

    return {
      id: member.id,
      uniqueId: stableUniqueId,
      ...(cf as any),
      matricula: String(member.matricula || (cf as any).matricula || ''),
      nome: String(member.name || (cf as any).nome || ''),
      cpf: formatCpf(String(member.cpf || (cf as any).cpf || '')),
      tipoCadastro: normalizeTipoCadastro(member.tipo_cadastro || member.role || (cf as any).tipoCadastro),
      supervisao: String((cf as any).supervisao || ''),
      campo: String((cf as any).campo || ''),
      congregacao: String((cf as any).congregacao || ''),
      status: resolveStatusFromMember(member),
      jubilado: (member as any).jubilado ?? false,
      dataNascimento: String(member.data_nascimento || (cf as any).dataNascimento || ''),
      sexo: String(member.sexo || (cf as any).sexo || ''),
      tipoSanguineo: String(member.tipo_sanguineo || (cf as any).tipoSanguineo || ''),
      escolaridade: String(member.escolaridade || (cf as any).escolaridade || ''),
      estadoCivil: String(member.estado_civil || (cf as any).estadoCivil || ''),
      nomeConjuge: String(member.nome_conjuge || (cf as any).nomeConjuge || ''),
      cpfConjuge: String(member.cpf_conjuge || (cf as any).cpfConjuge || ''),
      dataNascimentoConjuge: String(member.data_nascimento_conjuge || (cf as any).dataNascimentoConjuge || ''),
      nomePai: String(member.nome_pai || (cf as any).nomePai || ''),
      nomeMae: String(member.nome_mae || (cf as any).nomeMae || ''),
      rg: String(member.rg || (cf as any).rg || ''),
      orgaoEmissor: String(member.orgao_emissor || (cf as any).orgaoEmissor || ''),
      nacionalidade: String(member.nacionalidade || (cf as any).nacionalidade || ''),
      naturalidade: String(member.naturalidade || (cf as any).naturalidade || ''),
      uf: String(member.uf_naturalidade || member.estado || (cf as any).uf || ''),
      qualFuncao: String(member.qual_funcao || member.profissao || (cf as any).qualFuncao || ''),
      email: String(member.email || (cf as any).email || ''),
      celular: String(member.celular || member.phone || (cf as any).celular || ''),
      whatsapp: String(member.whatsapp || (cf as any).whatsapp || ''),
      logradouro: String(member.logradouro || (cf as any).logradouro || ''),
      numero: String(member.numero || (cf as any).numero || ''),
      bairro: String(member.bairro || (cf as any).bairro || ''),
      cidade: String(member.cidade || (cf as any).cidade || ''),
      complemento: String(member.complemento || (cf as any).complemento || ''),
      cep: String(member.cep || (cf as any).cep || ''),
      procedencia: String(member.procedencia || (cf as any).procedencia || '').toLocaleLowerCase('pt-BR'),
      procedenciaLocal: String(member.procedencia_local || (cf as any).procedenciaLocal || ''),
      latitude: String((member.latitude ?? (cf as any).latitude ?? '') || ''),
      longitude: String((member.longitude ?? (cf as any).longitude ?? '') || ''),
      cargoMinisterial,
      cursoTeologico: String(member.curso_teologico || (cf as any).cursoTeologico || ''),
      instituicaoTeologica: String(member.instituicao_teologica || (cf as any).instituicaoTeologica || ''),
      pastorAuxiliar: member.pastor_auxiliar ?? (cf as any).pastorAuxiliar ?? false,
      pastorPresidente: member.pastor_presidente ?? (cf as any).pastorPresidente ?? false,
      diretoriaCargo: String((member as any).diretoria_cargo || (cf as any).diretoriaCargo || ''),
      diretoria: (member as any).diretoria ?? (cf as any).diretoria ?? false,
      temFuncaoIgreja: member.tem_funcao_igreja ?? (cf as any).temFuncaoIgreja ?? false,
      setorDepartamento: String(member.setor_departamento || (cf as any).setorDepartamento || ''),
      observacoesMinisteriais: String(member.observacoes_ministeriais || (cf as any).observacoesMinisteriais || ''),
      dataConsagracao: String((cf as any).dataConsagracao || ''),
      dataEmissao: String(member.data_emissao || (cf as any).dataEmissao || ''),
      dataValidadeCredencial: String((member as any).cred_validade || (cf as any).dataValidadeCredencial || ''),
      dataBatismoAguas: String(member.data_batismo_aguas || (cf as any).dataBatismoAguas || ''),
      dataBatismoEspiritoSanto: String(member.data_batismo_espirito_santo || (cf as any).dataBatismoEspiritoSanto || ''),
      fotoUrl: member.foto_url || (cf as any).fotoUrl || undefined,
      profissao: String(member.profissao || (cf as any).profissao || ''),
      email2: String(member.email2 || (cf as any).email2 || ''),
      uf_rg: String(member.uf_rg || (cf as any).uf_rg || ''),
      tituloEleitoral: String(member.titulo_eleitoral || (cf as any).tituloEleitoral || ''),
      zonaEleitoral: String(member.zona_eleitoral || (cf as any).zonaEleitoral || ''),
      secaoEleitoral: String(member.secao_eleitoral || (cf as any).secaoEleitoral || ''),
      municipioEleitoral: String(member.municipio_eleitoral || (cf as any).municipioEleitoral || ''),
      posicaoNoCampo: String(member.posicao_no_campo || (cf as any).posicaoNoCampo || ''),
      numero_cgadb: String(member.numero_cgadb || (cf as any).numero_cgadb || ''),
      localBatismo: String(member.local_batismo || (cf as any).localBatismo || ''),
      dataFiliacao: String(member.data_filiacao || (cf as any).dataFiliacao || ''),
      evAutorizadoData: String(member.ev_autorizado_data || (cf as any).evAutorizadoData || ''),
      evAutorizadoLocal: String(member.ev_autorizado_local || (cf as any).evAutorizadoLocal || ''),
      evConsagradoData: String(member.ev_consagrado_data || (cf as any).evConsagradoData || ''),
      evConsagradoLocal: String(member.ev_consagrado_local || (cf as any).evConsagradoLocal || ''),
      consMissionarioData: String(member.cons_missionario_data || (cf as any).consMissionarioData || ''),
      consMissionarioLocal: String(member.cons_missionario_local || (cf as any).consMissionarioLocal || ''),
      ordenPastorData: String(member.orden_pastor_data || (cf as any).ordenPastorData || ''),
      ordenPastorLocal: String(member.orden_pastor_local || (cf as any).ordenPastorLocal || ''),
      conjugeRg: String(member.conjuge_rg || (cf as any).conjugeRg || ''),
      conjugeOrgaoEmissor: String(member.conjuge_orgao_emissor || (cf as any).conjugeOrgaoEmissor || ''),
      conjugeNacionalidade: String(member.conjuge_nacionalidade || (cf as any).conjugeNacionalidade || ''),
      conjugeNaturalidade: String(member.conjuge_naturalidade || (cf as any).conjugeNaturalidade || ''),
      conjugeNomePai: String(member.conjuge_nome_pai || (cf as any).conjugeNomePai || ''),
      conjugeNomeMae: String(member.conjuge_nome_mae || (cf as any).conjugeNomeMae || ''),
      conjugeTituloEleitoral: String(member.conjuge_titulo_eleitoral || (cf as any).conjugeTituloEleitoral || ''),
      conjugeFone: String(member.conjuge_fone || (cf as any).conjugeFone || ''),
      conjugeEmail: String(member.conjuge_email || (cf as any).conjugeEmail || ''),
      conjugeTipoSanguineo: String(member.conjuge_tipo_sanguineo || (cf as any).conjugeTipoSanguineo || ''),
      primeiroCasamento: String(member.primeiro_casamento ?? (cf as any).primeiroCasamento ?? 'SIM'),
      qtdFilhos: member.qtd_filhos ?? (cf as any).qtdFilhos ?? 0,
      registroComieadepa: String(member.registro_comieadepa || (cf as any).registroComieadepa || ''),
      convencional: member.convencional ?? (cf as any).convencional ?? false,
      aptoVotar: member.apto_votar ?? (cf as any).aptoVotar ?? false,
      efetivo: member.efetivo ?? (cf as any).efetivo ?? false,
      ministerial: member.ministerial ?? (cf as any).ministerial ?? false,
      homologado: member.homologado ?? (cf as any).homologado ?? false,
      dataJubilacao: String(member.data_jubilacao || (cf as any).dataJubilacao || ''),
      dataFalecimento: String(member.data_falecimento || (cf as any).dataFalecimento || ''),
      localFalecimento: String(member.local_falecimento || (cf as any).localFalecimento || ''),
      diaconoData: String(member.diacono_data || (cf as any).diaconoData || ''),
      diaconoLocal: String(member.diacono_local || (cf as any).diaconoLocal || ''),
      certDiacono: String(member.cert_diacono || (cf as any).certDiacono || ''),
      presbiteroData: String(member.presbitero_data || (cf as any).presbiteroData || ''),
      presbiteroLocal: String(member.presbitero_local || (cf as any).presbiteroLocal || ''),
      certPresbitero: String(member.cert_presbitero || (cf as any).certPresbitero || ''),
      certEvangelista: String(member.cert_evangelista || (cf as any).certEvangelista || ''),
      certPastor: String(member.cert_pastor || (cf as any).certPastor || ''),
      credVencida: member.cred_vencida ?? (cf as any).credVencida ?? false,
      conjugeFotoUrl: member.conjuge_foto_url || (cf as any).conjugeFotoUrl || null,
    };
  };

  const buildCustomFieldsFromForm = (base: Partial<Membro>) => {
    const customFields = { ...base } as Record<string, any>;
    delete customFields.id;
    delete customFields.nome;
    delete customFields.cpf;
    delete customFields.status;
    return customFields;
  };

  const { members: membersApi, fetchMembers, createMember, updateMember, deleteMember } = useMembers();

  const [membros, setMembros] = useState<Membro[]>([]);

  // Carregar membros do Supabase (API) ao abrir a tela
  useEffect(() => {
    fetchMembers(1, 10000).catch((e) => {
      // Erros já são expostos via membersError; aqui evitamos poluir o console.
      if (e instanceof Error && e.message === 'Usuário sem ministério associado') return;
      if (e instanceof Error && e.message === 'Não autenticado') return; // race condition na hidratação
      console.error('Erro ao carregar membros (API):', e);
    });
  }, [fetchMembers]);

  // Projetar o formato do banco (Member) para o formato usado pela UI (Membro)
  useEffect(() => {
    setMembros(
      membersApi
        .map(memberToMembro)
        .sort((a, b) => {
          const ma = parseInt(a.matricula) || 999999;
          const mb = parseInt(b.matricula) || 999999;
          return ma - mb;
        })
    );
  }, [membersApi]);

  useEffect(() => {
    fetchConfiguracaoIgrejaFromSupabase(supabase)
      .then(setConfigIgreja)
      .catch(() => null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    localStorage.setItem('aniv_mensagem_texto', anivTexto);
  }, [anivTexto]);

  useEffect(() => {
    if (anivImagemUrl) {
      try { localStorage.setItem('aniv_mensagem_imagem', anivImagemUrl); } catch { localStorage.removeItem('aniv_mensagem_imagem'); }
    } else {
      localStorage.removeItem('aniv_mensagem_imagem');
    }
  }, [anivImagemUrl]);

  const ensureTemplatesSnapshot = async () => {
    if (templatesSnapshot.length > 0) return templatesSnapshot;

    // Priorizar cache local (salvo pelo editor de cartões)
    if (typeof window !== 'undefined') {
      try {
        const cached = localStorage.getItem('cartoes_templates_v3');
        if (cached) {
          const parsed = JSON.parse(cached) as any[];
          if (Array.isArray(parsed) && parsed.length > 0) {
            setTemplatesSnapshot(parsed);
            return parsed;
          }
        }
      } catch { /* ignore */ }
    }

    const { templates } = await loadTemplatesForCurrentUser(supabase, { allowLocalMigration: true });
    setTemplatesSnapshot(templates);
    return templates;
  };

  const hasActiveTemplate = (tipoCadastro: string, templatesBase: any[]) => {
    const tipo = (tipoCadastro || '').toLowerCase() === 'crianca' ? 'membro' : tipoCadastro;
    return templatesBase.some((t: any) => {
      const tTipo = (t.tipoCadastro || t.tipo || '').toLowerCase();
      return tTipo === tipo && t.ativo === true;
    });
  };

  const [maxMembros] = useState<number>(0); // 0 = sem limite
  const _limiteMembrosAtingido = maxMembros > 0 && membros.length >= maxMembros; void _limiteMembrosAtingido;

  const [showForm, setShowForm] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('ativo');
  const [cargoFilter, setCargoFilter] = useState('TODOS');
  const [supervisaoFilter, setSupervisaoFilter] = useState('TODOS');
  const [campoFilter, setCampoFilter] = useState('TODOS');
  const [pastorPresidenteFilter, setPastorPresidenteFilter] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [membroEditando, setMembroEditando] = useState<Membro | null>(null);
  const [membroDeletando, setMembroDeletando] = useState<Membro | null>(null);
  const [membroAlterandoStatus, setMembroAlterandoStatus] = useState<Membro | null>(null);
  const [novoStatus, setNovoStatus] = useState('');
  const [isJubilado, setIsJubilado] = useState(false);
  const [motivoStatus, setMotivoStatus] = useState('');
  const [salvandoStatus, setSalvandoStatus] = useState(false);
  const [membroImprimindo, setMembroImprimindo] = useState<Membro | null>(null);
  const [fichaAcpStatus, setFichaAcpStatus] = useState<string>('');
  const [fichaAcpLoading, setFichaAcpLoading] = useState(false);
  const [membroImprimindoCasaPastor, setMembroImprimindoCasaPastor] = useState<Membro | null>(null);
  const [membroSelecionandoImpressao, setMembroSelecionandoImpressao] = useState<Membro | null>(null);
  const [membroSelecionandoCarta, setMembroSelecionandoCarta] = useState<Membro | null>(null);
  const [membroImprimindoCartaMudanca, setMembroImprimindoCartaMudanca] = useState<Membro | null>(null);
  const [membroImprimindoCartaRecomendacao, setMembroImprimindoCartaRecomendacao] = useState<Membro | null>(null);
  const [membroDocumentos, setMembroDocumentos] = useState<Membro | null>(null);
  const [membroHistorico, setMembroHistorico] = useState<Membro | null>(null);
  const [membroImprimindoCartao, setMembroImprimindoCartao] = useState<Membro | null>(null);
  const [_ultimoCadastro, setUltimoCadastro] = useState<Membro | null>(null);
  const [membrosSelecionados, setMembrosSelecionados] = useState<Set<string>>(new Set());
  const [imprimindoLote, setImprimindoLote] = useState(false);
  const [notification, setNotification] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    type: 'success' | 'error' | 'warning' | 'info';
    autoClose?: number; // Tempo em ms
    showButton?: boolean;
  }>({ isOpen: false, title: '', message: '', type: 'success' });
  const [enderecoData, setEnderecoData] = useState({
    cep: '',
    logradouro: '',
    numero: '',
    bairro: '',
    complemento: '',
    cidade: '',
    latitude: '',
    longitude: ''
  });

  // Estado para dados pessoais
  const [dadosPessoais, setDadosPessoais] = useState({
    matricula: '',
    cpf: '',
    tipoCadastro: 'ministro',
    nome: '',
    dataNascimento: '',
    sexo: 'MASCULINO',
    tipoSanguineo: '',
    escolaridade: '',
    estadoCivil: '',
    nomeConjuge: '',
    cpfConjuge: '',
    dataNascimentoConjuge: '',
    nomePai: '',
    nomeMae: '',
    rg: '',
    uf_rg: '',
    orgaoEmissor: '',
    nacionalidade: 'BRASILEIRA',
    naturalidade: '',
    uf: '',
    tituloEleitoral: '',
    zonaEleitoral: '',
    secaoEleitoral: '',
    municipioEleitoral: '',
    profissao: '',
    supervisao: '',
    campo: '',
    congregacao: '',
    email: '',
    email2: '',
    celular: '',
    whatsapp: '',
    posicaoNoCampo: '',
    numero_cgadb: '',
  });

  // Dados do cônjuge (Registro Familiar)
  const [dadosConjuge, setDadosConjuge] = useState({
    rg: '',
    orgao_emissor: '',
    nacionalidade: 'BRASILEIRA',
    naturalidade: '',
    nome_pai: '',
    nome_mae: '',
    titulo_eleitoral: '',
    fone: '',
    email: '',
    tipo_sanguineo: '',
    foto_url: null as string | null,
  });
  const [primeirosCasamento, setPrimeirosCasamento] = useState('SIM');
  const [qtdFilhos, setQtdFilhos] = useState(0);

  // Filhos (Juventude COMIEADEPA)
  type FilhoRecord = { id: string; nome: string; sexo: string; data_nascimento: string; cpf: string; emJuventude?: boolean };
  const [filhosRegistros, setFilhosRegistros] = useState<FilhoRecord[]>([]);
  const [showFilhoForm, setShowFilhoForm] = useState(false);
  const [novoFilho, setNovoFilho] = useState({ nome: '', sexo: 'MASCULINO', data_nascimento: '', cpf: '' });
  const [salvandoFilho, setSalvandoFilho] = useState(false);


  // Dados de Consagração (campos fixos)
  const [dadosConsagracao, setDadosConsagracao] = useState({
    ev_autorizado_data: '',
    ev_autorizado_local: '',
    ev_consagrado_data: '',
    ev_consagrado_local: '',
    cons_missionario_data: '',
    cons_missionario_local: '',
    orden_pastor_data: '',
    orden_pastor_local: '',
    diretoria: false,
    local_batismo: '',
    data_filiacao: '',
    cargo_diretoria: '',
  });

  // Estado para foto (Base64)
  const [fotoMembro, setFotoMembro] = useState<string | null>(null);
  const [fotoOriginal, setFotoOriginal] = useState<string | null>(null); // Guardar original para crop
  const [fotoCropRotacao, setFotoCropRotacao] = useState<number>(0); // Rotação manual em graus
  const [rotation, setRotation] = useState(0);
  const [mostrarCropModal, setMostrarCropModal] = useState(false);
  const [fotoCropZoom, setFotoCropZoom] = useState(1);
  const [fotoCropPositionX, setFotoCropPositionX] = useState(0);
  const [fotoCropPositionY, setFotoCropPositionY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const canvasRefCrop = useRef<HTMLCanvasElement>(null);
  const previewAreaRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Estado para forçar atualização da validação ao focar na janela
  // const [updateTrigger, setUpdateTrigger] = useState(0);

  useEffect(() => {
    function handleFocus() {
      // Forçar re-render para validar templates novamente
      // setUpdateTrigger(prev => prev + 1);
      // console.log('🔄 Janela focada - revalidando templates');
    }

    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, []);

  // Estado para dados ministeriais
  const [dadosMinisteriais, setDadosMinisteriais] = useState({
    temFuncaoIgreja: false,
    qualFuncao: '',
    setorDepartamento: '',
    dataBatismoAguas: '',
    dataBatismoEspiritoSanto: '',
    cursoTeologico: '',
    instituicaoTeologica: '',
    pastorAuxiliar: false,
    pastorPresidente: false,
    procedencia: '',
    procedenciaLocal: '',
    dataConsagracao: '',
    dataEmissao: '',
    dataValidadeCredencial: '',
    observacoesMinisteriais: ''
  });

  // Status Casa do Pastor — somente leitura, obtido via API externa
  const [casaDoPastorStatus, setCasaDoPastorStatus] = useState<'adimplente' | 'inadimplente' | 'nao_encontrado' | null>(null);
  const [casaDoPastorLoading, setCasaDoPastorLoading] = useState(false);

  const consultarCasaDoPastor = async (cpf: string) => {
    const cpfLimpo = cpf.replace(/\D/g, '');
    if (cpfLimpo.length !== 11) return;
    setCasaDoPastorLoading(true);
    setCasaDoPastorStatus(null);
    try {
      const res = await fetch(`/api/integracao/casa-do-pastor?cpf=${cpfLimpo}`);
      if (res.ok) {
        const data = await res.json();
        const s = data?.status as string;
        setCasaDoPastorStatus(
          s === 'adimplente' ? 'adimplente' :
          s === 'inadimplente' ? 'inadimplente' :
          'nao_encontrado'
        );
      } else {
        setCasaDoPastorStatus('nao_encontrado');
      }
    } catch {
      setCasaDoPastorStatus(null);
    } finally {
      setCasaDoPastorLoading(false);
    }
  };

  // Estado para rastrear cargo selecionado
  const [cargoSelecionado, setCargoSelecionado] = useState('');

  // Estado para armazenar dados de consagração/recebimento por cargo
  const [dadosCargos, setDadosCargos] = useState<{
    [key: string]: {
      dataConsagracaoRecebimento: string;
      localConsagracao: string;
      localOrigem: string;
    }
  }>({});

  // Estado para controlar modo edição (admin only)
  const [_isAdminMode, setIsAdminMode] = useState(false);
  const [isEditando, setIsEditando] = useState(false);

  // Cargos ministeriais (sincronizados com configurações via localStorage)
  const [cargosMinisteriais] = useState<CargoMinisterial[]>(() => getCargosMinisteriais());

  const resolveCargoValue = (rawValue?: string) => {
    const value = String(rawValue || '').trim();
    if (!value) return '';

    const match = cargosMinisteriais.find(
      (cargo) => String(cargo.nome || '').trim().toLocaleUpperCase('pt-BR') === value.toLocaleUpperCase('pt-BR')
    );

    return match?.nome || value;
  };

  // Nomenclaturas dinâmicas para as divisões
  const [, setNomenclaturasState] = useState({
    divisao1: 'IGREJA',
    divisao2: 'CAMPO',
    divisao3: 'NENHUMA'
  });
  const [orgNomenclaturasRaw, setOrgNomenclaturasRaw] = useState<any>(null);

  const [supervisoes, setSupervisoes] = useState<DivisaoOption[]>([]);
  const [campos, setCampos] = useState<DivisaoOption[]>([]);
  const [congregacoes, setCongregacoes] = useState<DivisaoOption[]>([]);

  const refreshNomenclaturas = async () => {
    const org = await loadOrgNomenclaturasFromSupabaseOrMigrate(supabase);
    setOrgNomenclaturasRaw(org);
    setNomenclaturasState({
      divisao1: org?.divisaoPrincipal?.opcao1 || 'IGREJA',
      divisao2: org?.divisaoSecundaria?.opcao1 || 'CAMPO',
      divisao3: org?.divisaoTerciaria?.opcao1 || 'NENHUMA',
    });
  };

  useEffect(() => {
    let mounted = true;

    const run = async () => {
      try {
        await refreshNomenclaturas();
      } catch {
        // ignore
      }
    };

    run();

    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'nomenclaturas' && mounted) {
        run();
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => {
      mounted = false;
      window.removeEventListener('storage', handleStorageChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

useEffect(() => {
    const loadEstruturaOptions = async () => {
      const res = await authenticatedFetch('/api/v1/secretaria/estrutura?includeInactive=true');
      const payload = await res.json().catch(() => null as any);
      if (!res.ok) {
        console.warn('Falha ao carregar estrutura:', payload?.error || 'Erro');
        return;
      }

      const supers = (payload?.supervisoes as any[]) || [];
      const camposRows = (payload?.campos as any[]) || [];
      const congs = (payload?.congregacoes as any[]) || [];

      setSupervisoes(supers.map((row: any) => ({ id: row.id, nome: row.nome })));
      setCampos(camposRows.map((row: any) => ({ id: row.id, nome: row.nome, supervisao_id: row.supervisao_id })));
      setCongregacoes(congs.map((row: any) => ({ id: row.id, nome: row.nome, supervisao_id: row.supervisao_id, campo_id: row.campo_id })));
    };

    loadEstruturaOptions().catch(() => null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sanitizeNome = (value: unknown) => String(value || '').trim();

  const dedupByNome = (items: DivisaoOption[]): DivisaoOption[] => {
    const seen = new Set<string>();
    const out: DivisaoOption[] = [];
    items.forEach((item) => {
      const nome = sanitizeNome(item.nome);
      if (!nome) return;
      const key = nome.toUpperCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ ...item, nome });
    });
    return out;
  };

  const supervisoesFromNomenclaturas = ((orgNomenclaturasRaw?.divisaoPrincipal?.custom || []) as string[])
    .map((nome, idx) => ({ id: `cfg-s-${idx}-${nome}`, nome: sanitizeNome(nome) }))
    .filter((opt) => !!opt.nome);
  const camposFromNomenclaturas = ((orgNomenclaturasRaw?.divisaoSecundaria?.custom || []) as string[])
    .map((nome, idx) => ({ id: `cfg-c-${idx}-${nome}`, nome: sanitizeNome(nome) }))
    .filter((opt) => !!opt.nome);

  const supervisoesFromMembers = dedupByNome(
    (membersApi || [])
      .map((m: any, idx: number) => ({ id: `legacy-s-${idx}`, nome: sanitizeNome((m?.custom_fields as any)?.supervisao) }))
      .filter((opt: any) => !!opt.nome)
  );
  const camposFromMembers = dedupByNome(
    (membersApi || [])
      .map((m: any, idx: number) => ({ id: `legacy-c-${idx}`, nome: sanitizeNome((m?.custom_fields as any)?.campo) }))
      .filter((opt: any) => !!opt.nome)
  );

  // Funções de Imagem
  const handleFotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const result = event.target?.result as string;
        setFotoOriginal(result);
        setFotoCropZoom(1);
        setFotoCropPositionX(0);
        setFotoCropPositionY(0);
        setFotoCropRotacao(0);
        setMostrarCropModal(true);
      };
      reader.readAsDataURL(file);
    }
  };

  // Função para confirmar crop da foto
  const confirmarCropFoto = () => {
    if (!canvasRefCrop.current || !fotoOriginal) return;

    const canvas = canvasRefCrop.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Carregar imagem para renderizar no canvas com transformações
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      // Limpar canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Calcular escala da imagem para preenchimento (object-cover)
      const canvasAspect = canvas.width / canvas.height;
      const imgAspect = img.width / img.height;

      let imgX, imgY, imgWidth, imgHeight;

      if (imgAspect > canvasAspect) {
        // Imagem é mais larga - colocar altura = altura canvas
        imgHeight = canvas.height;
        imgWidth = imgHeight * imgAspect;
        imgX = (canvas.width - imgWidth) / 2;
        imgY = 0;
      } else {
        // Imagem é mais estreita - colocar largura = largura canvas
        imgWidth = canvas.width;
        imgHeight = imgWidth / imgAspect;
        imgX = 0;
        imgY = (canvas.height - imgHeight) / 2;
      }

      // Aplicar transformações em relação ao CENTRO DA IMAGEM VISÍVEL
      ctx.save();
      
      // Centro da imagem visível (com object-cover)
      const imgCenterX = imgX + imgWidth / 2;
      const imgCenterY = imgY + imgHeight / 2;
      
      // Mover para centro da imagem, aplicar transformações, e voltar
      ctx.translate(imgCenterX, imgCenterY);
      ctx.rotate((fotoCropRotacao * Math.PI) / 180);
      ctx.scale(fotoCropZoom, fotoCropZoom);
      ctx.translate(fotoCropPositionX, fotoCropPositionY);
      ctx.translate(-imgCenterX, -imgCenterY);

      // Desenhar a imagem
      ctx.drawImage(img, imgX, imgY, imgWidth, imgHeight);
      
      ctx.restore();

      // Converter canvas para JPEG e salvar
      const imagemCropada = canvas.toDataURL('image/jpeg', 0.95);
      setFotoMembro(imagemCropada);
      setMostrarCropModal(false);
      setFotoOriginal(imagemCropada);
    };
    img.src = fotoOriginal;
  };

  // Função para cancelar crop
  const cancelarCropFoto = () => {
    setMostrarCropModal(false);
    setFotoOriginal(null);
    setFotoCropZoom(1);
    setFotoCropPositionX(0);
    setFotoCropPositionY(0);
    setFotoCropRotacao(0);
  };

  // Controles de mouse para crop
  const handleCropWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const zoomAmount = e.deltaY > 0 ? -0.1 : 0.1; // Scroll down = zoom out, scroll up = zoom in
    const newZoom = Math.max(1, Math.min(3, fotoCropZoom + zoomAmount));
    setFotoCropZoom(newZoom);
  };

  const handleCropMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    setIsDragging(true);
    setDragStart({ x: e.clientX, y: e.clientY });
  };

  const handleCropMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    
    const deltaX = e.clientX - dragStart.x;
    const deltaY = e.clientY - dragStart.y;
    
    setFotoCropPositionX(prev => Math.max(-200, Math.min(200, prev + deltaX / 2)));
    setFotoCropPositionY(prev => Math.max(-200, Math.min(200, prev + deltaY / 2)));
    
    setDragStart({ x: e.clientX, y: e.clientY });
  };

  const handleCropMouseUp = () => {
    setIsDragging(false);
  };

  const resetCropView = () => {
    setFotoCropZoom(1);
    setFotoCropPositionX(0);
    setFotoCropPositionY(0);
  };

  const girarCropImagemEsquerda = () => {
    setFotoCropRotacao((prev) => {
      const novaRotacao = prev - 90;
      return novaRotacao < 0 ? novaRotacao + 360 : novaRotacao;
    });
  };

  const girarCropImagemDireita = () => {
    setFotoCropRotacao((prev) => (prev + 90) % 360);
  };

  const processarERedimensionar = (base64: string, deg = 0): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve(base64);

        // Proporção alvo para o cartão (3:4)
        const targetWidth = 300;
        const targetHeight = 400;

        canvas.width = targetWidth;
        canvas.height = targetHeight;

        // Limpar fundo
        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(0, 0, targetWidth, targetHeight);

        ctx.save();
        // Centralizar para rotacionar
        ctx.translate(targetWidth / 2, targetHeight / 2);
        ctx.rotate((deg * Math.PI) / 180);

        // Calcular dimensões da imagem rotacionada para o corte
        let drawWidth, drawHeight;
        const targetRatio = targetWidth / targetHeight;

        // Se rotacionado 90 ou 270, invertemos a análise de proporção da fonte
        const isVertical = deg === 90 || deg === 270;
        const sourceWidth = isVertical ? img.height : img.width;
        const sourceHeight = isVertical ? img.width : img.height;
        const sourceRatio = sourceWidth / sourceHeight;

        if (sourceRatio > targetRatio) {
          // Fonte mais larga que o alvo
          drawHeight = targetHeight;
          drawWidth = targetHeight * sourceRatio;
        } else {
          // Alvo mais largo que a fonte
          drawWidth = targetWidth;
          drawHeight = targetWidth / sourceRatio;
        }

        // Desenhar centralizado (a partir do translate de centro)
        // Se isVertical, o drawImage precisa lidar com o fato de que largura/altura da 'img' são fixas
        ctx.drawImage(img, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
        ctx.restore();

        // JPEG 0.7 para otimização
        const compressedBase64 = canvas.toDataURL('image/jpeg', 0.8);
        resolve(compressedBase64);
      };
      img.src = base64;
    });
  };

  const handleGirarFoto = async () => {
    const novaRotacao = (rotation + 90) % 360;
    setRotation(novaRotacao);
    if (fotoOriginal || fotoMembro) {
      const rotacionada = await processarERedimensionar(fotoOriginal || fotoMembro as string, novaRotacao);
      setFotoMembro(rotacionada);
    }
  };

  const itemsPerPage = 10;

  // Função para gerar próxima matrícula automática
  const gerarProximaMatricula = () => {
    const ultimaMatricula = Math.max(
      ...membros.map(m => parseInt(m.matricula) || 0),
      0
    );
    return String(ultimaMatricula + 1).padStart(3, '0');
  };

  // Função para abrir novo cadastro
  const _abrirNovoCadastro = () => {
    void _abrirNovoCadastro;
    const novaMatricula = gerarProximaMatricula();
    setDadosPessoais({
      matricula: novaMatricula,
      cpf: '',
      tipoCadastro: 'ministro',
      nome: '',
      dataNascimento: '',
      sexo: 'MASCULINO',
      tipoSanguineo: '',
      escolaridade: '',
      estadoCivil: '',
      nomeConjuge: '',
      cpfConjuge: '',
      dataNascimentoConjuge: '',
      nomePai: '',
      nomeMae: '',
      rg: '',
      uf_rg: '',
      orgaoEmissor: '',
      nacionalidade: 'BRASILEIRA',
      naturalidade: '',
      uf: '',
      tituloEleitoral: '',
      zonaEleitoral: '',
      secaoEleitoral: '',
      municipioEleitoral: '',
      profissao: '',
      email2: '',
      posicaoNoCampo: '',
      numero_cgadb: '',
      supervisao: '',
      campo: '',
      congregacao: '',
      email: '',
      celular: '',
      whatsapp: ''
    });
    setEnderecoData({
      cep: '',
      logradouro: '',
      numero: '',
      bairro: '',
      complemento: '',
      cidade: '',
      latitude: '',
      longitude: ''
    });
    setDadosMinisteriais({
      temFuncaoIgreja: false,
      qualFuncao: '',
      setorDepartamento: '',
      dataBatismoAguas: '',
      dataBatismoEspiritoSanto: '',
      cursoTeologico: '',
      instituicaoTeologica: '',
      pastorAuxiliar: false,
      pastorPresidente: false,
      procedencia: '',
      procedenciaLocal: '',
      dataConsagracao: '',
      dataEmissao: new Date().toISOString().slice(0, 10),
      dataValidadeCredencial: '',
      observacoesMinisteriais: ''
    });
    setCasaDoPastorStatus(null);
    setFotoMembro(null);
    setFotoOriginal(null);
    setCargoSelecionado('');
    setDadosCargos({});
    setIsEditando(false);
    setShowForm(true);
    setActiveTab('dados');
  };

  // Função para validar CPF
  const validarCPF = (cpf: string): boolean => {
    // Remove caracteres especiais
    const cpfLimpo = cpf.replace(/\D/g, '');

    // Verifica se tem 11 dígitos
    if (cpfLimpo.length !== 11) {
      return false;
    }

    // Verifica se todos os dígitos são iguais
    if (/^(\d)\1{10}$/.test(cpfLimpo)) {
      return false;
    }

    // Permitir CPFs de teste comuns (ex: 123...)
    if (cpfLimpo.startsWith('123456789')) return true;

    // Valida primeiro dígito verificador
    let soma = 0;
    let resto;

    for (let i = 1; i <= 9; i++) {
      soma += parseInt(cpfLimpo.substring(i - 1, i)) * (11 - i);
    }

    resto = (soma * 10) % 11;
    if (resto === 10 || resto === 11) {
      resto = 0;
    }

    if (resto !== parseInt(cpfLimpo.substring(9, 10))) {
      return false;
    }

    // Valida segundo dígito verificador
    soma = 0;

    for (let i = 1; i <= 10; i++) {
      soma += parseInt(cpfLimpo.substring(i - 1, i)) * (12 - i);
    }

    resto = (soma * 10) % 11;
    if (resto === 10 || resto === 11) {
      resto = 0;
    }

    if (resto !== parseInt(cpfLimpo.substring(10, 11))) {
      return false;
    }

    return true;
  };

  // Função para gerar PDF da listagem de membros
  const gerarPDFListagem = () => {
    const { jsPDF } = require('jspdf');
    const autoTable = require('jspdf-autotable').default;

    const doc = new jsPDF('landscape', 'mm', 'a4');
    const pageWidth = doc.internal.pageSize.getWidth();
    const config = configIgreja;

    // Cabeçalho personalizado
    let yPos = 15;

    // Logo à esquerda (se existir)
    if (config.logo) {
      try {
        doc.addImage(config.logo, 'PNG', 14, yPos - 5, 30, 30);
      } catch (error) {
        console.error('Erro ao adicionar logo:', error);
      }
    }

    // Informações da igreja à direita do logo
    const textStartX = config.logo ? 50 : 14;

    // Nome da igreja (título)
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text(config.nome, textStartX, yPos + 5);

    // Informações de contato
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');

    let infoY = yPos + 12;
    if (config.endereco) {
      doc.text(config.endereco, textStartX, infoY);
      infoY += 5;
    }

    const contatoInfo = [];
    if (config.cnpj) contatoInfo.push(`CNPJ: ${config.cnpj}`);
    if (config.telefone) contatoInfo.push(`Tel: ${config.telefone}`);
    if (config.email) contatoInfo.push(config.email);

    if (contatoInfo.length > 0) {
      doc.text(contatoInfo.join(' | '), textStartX, infoY);
    }

    // Linha separadora
    yPos = config.logo ? 50 : 35;
    doc.setDrawColor(20, 184, 166); // teal-600
    doc.setLineWidth(0.5);
    doc.line(14, yPos, pageWidth - 14, yPos);

    // Título do relatório
    yPos += 8;
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('Listagem de Ministros', pageWidth / 2, yPos, { align: 'center' });

    // Informações do relatório
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    yPos += 7;

    doc.text(`Total de registros: ${membrosFiltrados.length}`, 14, yPos);
    doc.text(`Data: ${new Date().toLocaleDateString('pt-BR')}`, pageWidth - 14, yPos, { align: 'right' });

    // Preparar dados da tabela
    const tableData = membrosFiltrados.map(membro => [
      membro.matricula,
      membro.nome,
      membro.cpf,
      membro.cargoMinisterial || '-',
      (membro as any).dadosCargos?.dataConsagracao
        ? new Date((membro as any).dadosCargos.dataConsagracao).toLocaleDateString('pt-BR')
        : (membro as any).dataConsagracao
          ? new Date((membro as any).dataConsagracao).toLocaleDateString('pt-BR')
          : '-',
      membro.status === 'ativo' ? 'Ativo' : 'Inativo'
    ]);

    // Gerar tabela
    autoTable(doc, {
      startY: yPos + 5,
      head: [['Matrícula', 'Nome', 'CPF', 'Cargo', 'Dt. Consagração', 'Status']],
      body: tableData,
      theme: 'grid',
      headStyles: {
        fillColor: [20, 184, 166], // teal-600
        textColor: 255,
        fontStyle: 'bold',
        halign: 'center'
      },
      styles: {
        fontSize: 8,
        cellPadding: 2
      },
      columnStyles: {
        0: { halign: 'center', cellWidth: 20 },
        1: { halign: 'left', cellWidth: 'auto' },
        2: { halign: 'center', cellWidth: 35 },
        3: { halign: 'left', cellWidth: 35 },
        4: { halign: 'center', cellWidth: 30 },
        5: { halign: 'center', cellWidth: 20 }
      },
      alternateRowStyles: {
        fillColor: [245, 245, 245]
      }
    });

    // Rodapé
    const pageCount = (doc as any).internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.text(
        `Gestão Eklésia - Sistema de Gerenciamento Eclesiástico`,
        pageWidth / 2,
        doc.internal.pageSize.getHeight() - 10,
        { align: 'center' }
      );
      doc.text(
        `Página ${i} de ${pageCount}`,
        pageWidth - 14,
        doc.internal.pageSize.getHeight() - 10,
        { align: 'right' }
      );
    }

    // Salvar PDF
    const dataHora = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
    doc.save(`listagem_ministros_${dataHora}.pdf`);

    setNotification({
      isOpen: true,
      title: 'Sucesso',
      message: 'PDF gerado com sucesso!',
      type: 'success'
    });
  };

  // Função para abrir edição de membro
  const abrirEdicao = (membro: Membro) => {
    setMembroEditando(membro);
    setDadosPessoais({
      matricula: membro.matricula || '',
      cpf: membro.cpf || '',
      tipoCadastro: 'ministro',
      nome: membro.nome || '',
      dataNascimento: membro.dataNascimento || '',
      sexo: membro.sexo || 'MASCULINO',
      tipoSanguineo: membro.tipoSanguineo || '',
      escolaridade: membro.escolaridade || '',
      estadoCivil: membro.estadoCivil || '',
      nomeConjuge: membro.nomeConjuge || '',
      cpfConjuge: membro.cpfConjuge || '',
      dataNascimentoConjuge: membro.dataNascimentoConjuge || '',
      nomePai: membro.nomePai || '',
      nomeMae: membro.nomeMae || '',
      rg: membro.rg || '',
      uf_rg: (membro as any).uf_rg || '',
      orgaoEmissor: membro.orgaoEmissor || '',
      nacionalidade: membro.nacionalidade || 'BRASILEIRA',
      naturalidade: membro.naturalidade || '',
      uf: membro.uf || '',
      tituloEleitoral: (membro as any).tituloEleitoral || '',
      zonaEleitoral: (membro as any).zonaEleitoral || '',
      secaoEleitoral: (membro as any).secaoEleitoral || '',
      municipioEleitoral: (membro as any).municipioEleitoral || '',
      profissao: (membro as any).profissao || '',
      email2: (membro as any).email2 || '',
      posicaoNoCampo: (membro as any).posicaoNoCampo || '',
      numero_cgadb: (membro as any).numero_cgadb || '',
      jubilado: (membro as any).jubilado ?? false,
      supervisao: membro.supervisao || '',
      campo: membro.campo || '',
      congregacao: membro.congregacao || '',
      email: membro.email || '',
      celular: membro.celular || '',
      whatsapp: membro.whatsapp || ''
    } as any);
    setEnderecoData({
      cep: membro.cep || '',
      logradouro: membro.logradouro || '',
      numero: membro.numero || '',
      bairro: membro.bairro || '',
      complemento: membro.complemento || '',
      cidade: membro.cidade || '',
      latitude: membro.latitude || '',
      longitude: membro.longitude || ''
    });
    setFotoMembro(membro.fotoUrl || null);
    setFotoOriginal(membro.fotoUrl || null);
    setRotation(0); // Reset rotation on edit
    setDadosMinisteriais({
      temFuncaoIgreja: membro.temFuncaoIgreja || false,
      qualFuncao: membro.qualFuncao || '',
      setorDepartamento: membro.setorDepartamento || '',
      dataBatismoAguas: membro.dataBatismoAguas || '',
      dataBatismoEspiritoSanto: membro.dataBatismoEspiritoSanto || '',
      cursoTeologico: membro.cursoTeologico || '',
      instituicaoTeologica: membro.instituicaoTeologica || '',
      pastorAuxiliar: membro.pastorAuxiliar || false,
      pastorPresidente: membro.pastorPresidente || false,
      procedencia: membro.procedencia || '',
      procedenciaLocal: membro.procedenciaLocal || '',
      dataConsagracao: membro.dataConsagracao || '',
      dataEmissao: membro.dataEmissao || '',
      dataValidadeCredencial: membro.dataValidadeCredencial || '',
      observacoesMinisteriais: membro.observacoesMinisteriais || ''
    });
    setDadosConjuge({
      rg: (membro as any).conjugeRg || '',
      orgao_emissor: (membro as any).conjugeOrgaoEmissor || '',
      nacionalidade: (membro as any).conjugeNacionalidade || 'BRASILEIRA',
      naturalidade: (membro as any).conjugeNaturalidade || '',
      nome_pai: (membro as any).conjugeNomePai || '',
      nome_mae: (membro as any).conjugeNomeMae || '',
      titulo_eleitoral: (membro as any).conjugeTituloEleitoral || '',
      fone: (membro as any).conjugeFone || '',
      email: (membro as any).conjugeEmail || '',
      tipo_sanguineo: (membro as any).conjugeTipoSanguineo || '',
      foto_url: (membro as any).conjugeFotoUrl || null,
    });
    setCargoSelecionado(resolveCargoValue(membro.cargoMinisterial));
    setDadosCargos(membro.dadosCargos || {});
    setDadosConsagracao({
      ev_autorizado_data:    (membro as any).evAutorizadoData    || '',
      ev_autorizado_local:   (membro as any).evAutorizadoLocal   || '',
      ev_consagrado_data:    (membro as any).evConsagradoData    || '',
      ev_consagrado_local:   (membro as any).evConsagradoLocal   || '',
      cons_missionario_data: (membro as any).consMissionarioData || '',
      cons_missionario_local:(membro as any).consMissionarioLocal|| '',
      orden_pastor_data:     (membro as any).ordenPastorData     || '',
      orden_pastor_local:    (membro as any).ordenPastorLocal    || '',
      diretoria:             membro.diretoria     || false,
      local_batismo:         (membro as any).localBatismo  || '',
      data_filiacao:         (membro as any).dataFiliacao  || '',
      cargo_diretoria:       membro.diretoriaCargo || '',
    });
    setIsEditando(false);
    setIsAdminMode(true); // Modo admin ativado para edição
    setShowForm(true);
    setActiveTab('dados');
    // Carregar filhos (HDS = Heranças do Senhor) com flag se também está em Juventude COMIEADEPA
    setFilhosRegistros([]);
    setShowFilhoForm(false);
    setNovoFilho({ nome: '', sexo: 'MASCULINO', data_nascimento: '', cpf: '' });
    Promise.all([
      authenticatedFetch(`/api/v1/secretaria/hds?membro_id=${membro.id}`),
      authenticatedFetch(`/api/v1/secretaria/juventude?membro_id=${membro.id}`)
    ]).then(async ([hdsRes, juvRes]) => {
      const hdsJson = hdsRes.ok ? await hdsRes.json().catch(() => null as any) : null;
      const juvJson = juvRes.ok ? await juvRes.json().catch(() => null as any) : null;
      const hdsRows = (hdsJson?.data as any[]) || [];
      const juvRows = (juvJson?.data as any[]) || [];
      const juvIds = new Set<string>(juvRows.map((r: any) => r.hds_id).filter(Boolean));
      const combined = hdsRows.map((r: any) => ({ ...r, emJuventude: juvIds.has(r.id) }));
      setFilhosRegistros(combined);
      setQtdFilhos(combined.length);
    });
  };

  const isDataUrl = (value?: string | null) => {
    return !!value && value.startsWith('data:image/');
  };

  const uploadFotoMembro = async (dataUrl: string, membroId: string) => {
    const blob = await fetch(dataUrl).then((res) => res.blob());
    const file = new File([blob], `foto-${membroId}.jpg`, {
      type: blob.type || 'image/jpeg',
    });
    const form = new FormData();
    form.append('file', file);
    form.append('membroId', membroId);

    const resp = await authenticatedFetch('/api/v1/secretaria/uploads/membro-foto', {
      method: 'POST',
      body: form,
    });
    const payload = await resp.json();
    if (!resp.ok) {
      throw new Error(payload?.error || 'Erro ao enviar foto');
    }
    if (!payload?.url) {
      throw new Error('Upload concluido sem URL publica.');
    }
    return payload as { url?: string; bucket?: string; path?: string };
  };

  // Função para salvar/atualizar membro
  const salvarMembro = async () => {
    console.log('💾 Iniciando salvamento do membro...');
    console.log('Dados Pessoais:', dadosPessoais);

    // Validar campos obrigatórios
    if (!dadosPessoais.cpf || !dadosPessoais.nome || !dadosPessoais.dataNascimento) {
      console.warn('⚠️ Erro: Campos obrigatórios ausentes');
      setNotification({
        isOpen: true,
        title: 'Erro de Validação',
        message: 'Preencha todos os campos obrigatórios: CPF, Nome e Data de Nascimento',
        type: 'error'
      });
      return;
    }

    // Validar CPF
    if (!validarCPF(dadosPessoais.cpf)) {
      setNotification({
        isOpen: true,
        title: 'Erro',
        message: 'CPF inválido. Verifique o número digitado',
        type: 'error'
      });
      return;
    }

    try {
      const fotoEhBase64 = isDataUrl(fotoMembro);
      let fotoUrlFinal: string | null = fotoMembro || null;

      if (membroEditando && fotoEhBase64 && fotoMembro) {
        const uploaded = await uploadFotoMembro(fotoMembro, membroEditando.id);
        fotoUrlFinal = uploaded?.url || null;
      }

      if (!membroEditando && fotoEhBase64) {
        fotoUrlFinal = null;
      }

      const baseForCustom: Partial<Membro> = {
        uniqueId: membroEditando?.uniqueId || gerarUniqueId(),
        matricula: dadosPessoais.matricula,
        tipoCadastro: 'ministro',
        supervisao: dadosPessoais.supervisao,
        campo: dadosPessoais.campo,
        congregacao: dadosPessoais.congregacao,
        status: 'ativo',
        dataNascimento: dadosPessoais.dataNascimento,
        sexo: dadosPessoais.sexo,
        tipoSanguineo: dadosPessoais.tipoSanguineo,
        escolaridade: dadosPessoais.escolaridade,
        estadoCivil: dadosPessoais.estadoCivil,
        nomeConjuge: dadosPessoais.nomeConjuge,
        cpfConjuge: dadosPessoais.cpfConjuge,
        dataNascimentoConjuge: dadosPessoais.dataNascimentoConjuge,
        nomePai: dadosPessoais.nomePai,
        nomeMae: dadosPessoais.nomeMae,
        rg: dadosPessoais.rg,
        orgaoEmissor: dadosPessoais.orgaoEmissor,
        nacionalidade: dadosPessoais.nacionalidade,
        naturalidade: dadosPessoais.naturalidade,
        uf: dadosPessoais.uf,
        email: dadosPessoais.email,
        celular: dadosPessoais.celular,
        whatsapp: dadosPessoais.whatsapp,
        ...enderecoData,
        ...dadosMinisteriais,
        cargoMinisterial: cargoSelecionado,
        dadosCargos,
        temFuncaoIgreja: dadosMinisteriais.temFuncaoIgreja,
        fotoUrl: fotoUrlFinal || undefined,
      };

      const custom_fields = {
        ...buildCustomFieldsFromForm(baseForCustom),
        // Compatibilidade entre telas/fluxos que usam nomes diferentes para o mesmo dado
        cargoMinisterial: cargoSelecionado || null,
        cargo_ministerial: cargoSelecionado || null,
      };

      const latitudeNumber = enderecoData.latitude ? Number(String(enderecoData.latitude).replace(',', '.')) : null
      const longitudeNumber = enderecoData.longitude ? Number(String(enderecoData.longitude).replace(',', '.')) : null

      const payloadBase: CreateMemberRequest & Record<string, any> = {
        name: dadosPessoais.nome,
        cpf: onlyDigits(dadosPessoais.cpf) || null,
        email: dadosPessoais.email || null,
        phone: dadosPessoais.celular || null,
        // Aba Dados
        matricula: dadosPessoais.matricula || null,
        unique_id: baseForCustom.uniqueId || null,
        tipo_cadastro: 'ministro',
        data_nascimento: dadosPessoais.dataNascimento || null,
        sexo: dadosPessoais.sexo || null,
        tipo_sanguineo: dadosPessoais.tipoSanguineo || null,
        escolaridade: dadosPessoais.escolaridade || null,
        estado_civil: dadosPessoais.estadoCivil || null,
        nome_conjuge: dadosPessoais.nomeConjuge || null,
        cpf_conjuge: dadosPessoais.cpfConjuge ? onlyDigits(dadosPessoais.cpfConjuge) : null,
        data_nascimento_conjuge: dadosPessoais.dataNascimentoConjuge || null,
        nome_pai: dadosPessoais.nomePai || null,
        nome_mae: dadosPessoais.nomeMae || null,
        rg: dadosPessoais.rg || null,
        uf_rg: dadosPessoais.uf_rg || null,
        orgao_emissor: dadosPessoais.orgaoEmissor || null,
        nacionalidade: dadosPessoais.nacionalidade || null,
        naturalidade: dadosPessoais.naturalidade || null,
        uf_naturalidade: dadosPessoais.uf || null,
        titulo_eleitoral: dadosPessoais.tituloEleitoral || null,
        zona_eleitoral: dadosPessoais.zonaEleitoral || null,
        secao_eleitoral: dadosPessoais.secaoEleitoral || null,
        municipio_eleitoral: dadosPessoais.municipioEleitoral || null,
        profissao: dadosPessoais.profissao || null,
        email2: dadosPessoais.email2 || null,
        posicao_no_campo: dadosPessoais.posicaoNoCampo || null,
        numero_cgadb: dadosPessoais.numero_cgadb || null,
        jubilado: (dadosPessoais as any).jubilado ?? false,
        data_batismo_aguas: dadosMinisteriais.dataBatismoAguas || null,
        data_batismo_espirito_santo: dadosMinisteriais.dataBatismoEspiritoSanto || null,
        // Aba Endereço
        cep: onlyDigits(enderecoData.cep) || null,
        logradouro: enderecoData.logradouro || null,
        numero: enderecoData.numero || null,
        bairro: enderecoData.bairro || null,
        complemento: enderecoData.complemento || null,
        cidade: enderecoData.cidade || null,
        estado: dadosPessoais.uf || null,
        // Aba Contato
        celular: dadosPessoais.celular || null,
        whatsapp: dadosPessoais.whatsapp || null,
        // Geolocalização
        supervisao_id: supervisoes.find((s) => s.nome === dadosPessoais.supervisao)?.id || null,
        congregacao_id: congregacoes.find((cg) => cg.nome === dadosPessoais.congregacao)?.id || null,
        latitude: Number.isFinite(latitudeNumber) ? latitudeNumber : null,
        longitude: Number.isFinite(longitudeNumber) ? longitudeNumber : null,
        // Aba Ministerial
        curso_teologico: dadosMinisteriais.cursoTeologico || null,
        instituicao_teologica: dadosMinisteriais.instituicaoTeologica || null,
        pastor_auxiliar: dadosMinisteriais.pastorAuxiliar ?? false,
        pastor_presidente: dadosMinisteriais.pastorPresidente ?? false,
        procedencia: dadosMinisteriais.procedencia || null,
        procedencia_local: dadosMinisteriais.procedenciaLocal || null,
        cargo_ministerial: cargoSelecionado || null,
        tem_funcao_igreja: dadosMinisteriais.temFuncaoIgreja ?? false,
        qual_funcao: dadosMinisteriais.qualFuncao || null,
        setor_departamento: dadosMinisteriais.setorDepartamento || null,
        observacoes_ministeriais: dadosMinisteriais.observacoesMinisteriais || null,
        cred_validade: dadosMinisteriais.dataValidadeCredencial || null,
        // Aba Foto
        foto_url: fotoUrlFinal,
        // Dados de Consagração
        local_batismo: dadosConsagracao.local_batismo || null,
        data_filiacao: dadosConsagracao.data_filiacao || null,
        diretoria: dadosConsagracao.diretoria ?? false,
        diretoria_cargo: dadosConsagracao.cargo_diretoria || null,
        ev_autorizado_data: dadosConsagracao.ev_autorizado_data || null,
        ev_autorizado_local: dadosConsagracao.ev_autorizado_local || null,
        ev_consagrado_data: dadosConsagracao.ev_consagrado_data || null,
        ev_consagrado_local: dadosConsagracao.ev_consagrado_local || null,
        cons_missionario_data: dadosConsagracao.cons_missionario_data || null,
        cons_missionario_local: dadosConsagracao.cons_missionario_local || null,
        orden_pastor_data: dadosConsagracao.orden_pastor_data || null,
        orden_pastor_local: dadosConsagracao.orden_pastor_local || null,
        // Registro Familiar
        conjuge_rg: dadosConjuge.rg || null,
        conjuge_orgao_emissor: dadosConjuge.orgao_emissor || null,
        conjuge_nacionalidade: dadosConjuge.nacionalidade || null,
        conjuge_naturalidade: dadosConjuge.naturalidade || null,
        conjuge_nome_pai: dadosConjuge.nome_pai || null,
        conjuge_nome_mae: dadosConjuge.nome_mae || null,
        conjuge_titulo_eleitoral: dadosConjuge.titulo_eleitoral || null,
        conjuge_fone: dadosConjuge.fone || null,
        conjuge_email: dadosConjuge.email || null,
        conjuge_tipo_sanguineo: dadosConjuge.tipo_sanguineo || null,
        conjuge_foto_url: dadosConjuge.foto_url || null,
        primeiro_casamento: primeirosCasamento,
        qtd_filhos: qtdFilhos,
        // Sistema
        status: uiStatusToDb('ativo') as Member['status'],
        role: 'ministro',
        observacoes: null,
        custom_fields,
      };

      if (membroEditando) {
        const payload: UpdateMemberRequest = payloadBase;
        await updateMember(membroEditando.id, payload);
        await fetchMembers(1, 10000, undefined, { force: true });
        setNotification({
          isOpen: true,
          title: 'Sucesso',
          message: 'Ministro atualizado com sucesso!',
          type: 'success'
        });
      } else {
        const created = await createMember(payloadBase);
        let createdUi = memberToMembro(created as unknown as Member);

        if (fotoEhBase64 && fotoMembro && created?.id) {
          const uploaded = await uploadFotoMembro(fotoMembro, created.id);
          if (uploaded?.url) {
            await updateMember(created.id, { foto_url: uploaded.url });
            createdUi = { ...createdUi, fotoUrl: uploaded.url } as Membro;
            setFotoMembro(uploaded.url);
            setFotoOriginal(uploaded.url);
          }
        }

        await fetchMembers(1, 10000, undefined, { force: true });
        setUltimoCadastro(createdUi);
        setNotification({
          isOpen: true,
          title: 'Sucesso',
          message: 'Novo ministro cadastrado com sucesso!',
          type: 'success'
        });
      }
    } catch (e) {
      console.error('Erro ao salvar membro (API):', e);
      setNotification({
        isOpen: true,
        title: 'Erro',
        message: e instanceof Error ? e.message : 'Erro ao salvar membro',
        type: 'error'
      });
      return;
    }

    // Limpar formulário completamente
    resetarFormulario();
  };

  // Função para resetar todos os dados do formulário
  const resetarFormulario = () => {
    setDadosPessoais({
      matricula: '', cpf: '', tipoCadastro: 'ministro', nome: '', dataNascimento: '',
      sexo: 'MASCULINO', tipoSanguineo: '', escolaridade: '', estadoCivil: '',
      nomeConjuge: '', cpfConjuge: '', dataNascimentoConjuge: '',
      nomePai: '', nomeMae: '', rg: '', uf_rg: '', orgaoEmissor: '',
      nacionalidade: 'BRASILEIRA', naturalidade: '', uf: '',
      tituloEleitoral: '', zonaEleitoral: '', secaoEleitoral: '', municipioEleitoral: '',
      profissao: '', email2: '', posicaoNoCampo: '', numero_cgadb: '',
      supervisao: '', campo: '', congregacao: '', email: '', celular: '', whatsapp: '',
    });
    setDadosConjuge({ rg: '', orgao_emissor: '', nacionalidade: 'BRASILEIRA', naturalidade: '', nome_pai: '', nome_mae: '', titulo_eleitoral: '', fone: '', email: '', tipo_sanguineo: '', foto_url: null });
    setPrimeirosCasamento('SIM');
    setQtdFilhos(0);
    setDadosConsagracao({ ev_autorizado_data: '', ev_autorizado_local: '', ev_consagrado_data: '', ev_consagrado_local: '', cons_missionario_data: '', cons_missionario_local: '', orden_pastor_data: '', orden_pastor_local: '', diretoria: false, local_batismo: '', data_filiacao: '', cargo_diretoria: '' });
    setEnderecoData({
      cep: '',
      logradouro: '',
      numero: '',
      bairro: '',
      complemento: '',
      cidade: '',
      latitude: '',
      longitude: ''
    });
    setDadosMinisteriais({
      temFuncaoIgreja: false,
      qualFuncao: '',
      setorDepartamento: '',
      dataBatismoAguas: '',
      dataBatismoEspiritoSanto: '',
      cursoTeologico: '',
      instituicaoTeologica: '',
      pastorAuxiliar: false,
      pastorPresidente: false,
      procedencia: '',
      procedenciaLocal: '',
      dataConsagracao: '',
      dataEmissao: '',
      dataValidadeCredencial: '',
      observacoesMinisteriais: ''
    });
    setFotoMembro(null);
    setFotoOriginal(null);
    setRotation(0);
    setCargoSelecionado('');
    setDadosCargos({});
    setShowForm(false);
    setMembroEditando(null);
    setIsAdminMode(false);
  };

  // Função para fechar formulário
  const fecharFormulario = () => {
    resetarFormulario();
  };

  // Função para abrir modal de confirmação de deleção
  const _abrirConfirmacaoDeletar = (membro: Membro) => {
    setMembroDeletando(membro);
  }; void _abrirConfirmacaoDeletar;

  // Função para deletar membro
  const deletarMembro = async () => {
    if (!membroDeletando) return;

    try {
      await deleteMember(membroDeletando.id);
      await fetchMembers(1, 10000, undefined, { force: true });
      setNotification({
        isOpen: true,
        title: 'Sucesso',
        message: `Ministro "${membroDeletando.nome}" foi deletado com sucesso!`,
        type: 'success'
      });
      setMembroDeletando(null);
    } catch (e) {
      console.error('Erro ao deletar membro (API):', e);
      setNotification({
        isOpen: true,
        title: 'Erro',
        message: e instanceof Error ? e.message : 'Erro ao deletar membro',
        type: 'error'
      });
    }
  };

  // Função para cancelar deleção
  const cancelarDeletar = () => {
    setMembroDeletando(null);
  };

  // Função para buscar CEP e preencher endereço automaticamente
  const buscarCEP = async () => {
    const cepLimpo = enderecoData.cep.replace(/\D/g, '');

    if (!cepLimpo || cepLimpo.length !== 8) {
      setNotification({
        isOpen: true,
        title: 'Aviso',
        message: 'Digite um CEP válido com 8 dígitos',
        type: 'warning'
      });
      // Limpar dados de endereço quando CEP inválido
      setEnderecoData(prev => ({
        ...prev,
        logradouro: '',
        bairro: '',
        cidade: '',
        complemento: '',
        latitude: '',
        longitude: ''
      }));
      return;
    }

    try {
      console.log('🔎 Buscando CEP:', cepLimpo);
      const response = await fetch(`https://viacep.com.br/ws/${cepLimpo}/json/`);

      if (!response.ok) {
        throw new Error('Erro ao conectar com ViaCEP');
      }

      const data = await response.json();
      console.log('📮 Resposta ViaCEP:', data);

      if (data.erro) {
        setNotification({
          isOpen: true,
          title: 'Aviso',
          message: 'CEP não encontrado. Verifique o número.',
          type: 'warning'
        });
        // Limpar dados
        setEnderecoData(prev => ({
          ...prev,
          logradouro: '',
          bairro: '',
          cidade: '',
          complemento: '',
          latitude: '',
          longitude: ''
        }));
        return;
      }

      const novoEndereco = {
        logradouro: data.logradouro || '',
        bairro: data.bairro || '',
        cidade: data.localidade || '',
        complemento: data.complemento || ''
      };

      console.log('📝 Novo endereço:', novoEndereco);

      // Primeiro, atualizar o estado com o novo endereço
      const enderecoAtualizado = {
        ...enderecoData,
        ...novoEndereco,
        latitude: '',
        longitude: ''
      };

      setEnderecoData(enderecoAtualizado);

      // Após atualizar, fazer geocodificação
      if (novoEndereco.logradouro && novoEndereco.cidade) {
        console.log('🌍 Iniciando geocodificação automática...');

        // Construir endereço com dados do estado atual
        const partesEndereco = [
          novoEndereco.logradouro,
          enderecoData.numero, // Usar o número que estava antes
          novoEndereco.bairro,
          novoEndereco.cidade
        ].filter(Boolean);

        const enderecoCompleto = partesEndereco.join(', ');
        console.log('📍 Endereço para geocoding:', enderecoCompleto);

        // Fazer requisição de geocoding
        try {
          const geoResponse = await fetch(
            `https://nominatim.openstreetmap.org/search?street=${encodeURIComponent(enderecoCompleto)}&format=json&limit=1`
          );

          if (!geoResponse.ok) {
            throw new Error('Erro ao conectar com Nominatim');
          }

          const geoData = await geoResponse.json();
          console.log('📍 Resposta Nominatim:', geoData);

          if (geoData && geoData.length > 0) {
            const latitude = parseFloat(geoData[0].lat).toFixed(4);
            const longitude = parseFloat(geoData[0].lon).toFixed(4);
            console.log('✅ Coordenadas encontradas:', { latitude, longitude });

            setEnderecoData(prev => ({
              ...prev,
              latitude: latitude,
              longitude: longitude
            }));
          } else {
            console.log('⚠️ Nenhuma coordenada encontrada para este endereço');
          }
        } catch (geoError) {
          console.error('❌ Erro na geocodificação:', geoError);
        }
      }

    } catch (error) {
      console.error('❌ Erro ao buscar CEP:', error);
      setNotification({
        isOpen: true,
        title: 'Erro',
        message: 'Erro ao buscar CEP. Tente novamente.',
        type: 'error'
      });
      // Limpar dados em caso de erro
      setEnderecoData(prev => ({
        ...prev,
        logradouro: '',
        bairro: '',
        cidade: '',
        complemento: '',
        latitude: '',
        longitude: ''
      }));
    }
  };


  // Filtrar membros
  const membrosFiltrados = membros.filter(m => {
    const matchSearch = m.nome.toLowerCase().includes(searchTerm.toLowerCase()) ||
      m.cpf.includes(searchTerm) ||
      m.matricula.includes(searchTerm);
    const sf = statusFilter.toLowerCase();
    const matchStatus = sf === 'todos'
      || (sf === 'jubilado' ? m.jubilado === true : m.status.toLowerCase() === sf);
    const matchCargo = cargoFilter === 'TODOS' || (m.cargoMinisterial || '').toUpperCase() === cargoFilter.toUpperCase();
    const matchSupervisao = supervisaoFilter === 'TODOS' || (m.supervisao || '').toUpperCase() === supervisaoFilter.toUpperCase();
    const matchCampo = campoFilter === 'TODOS' || (m.campo || '').toUpperCase() === campoFilter.toUpperCase();
    const matchPastor = !pastorPresidenteFilter || m.pastorPresidente === true;
    return matchSearch && matchStatus && matchCargo && matchSupervisao && matchCampo && matchPastor;
  });

  const totalPages = Math.ceil(membrosFiltrados.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const membrosPaginados = membrosFiltrados.slice(startIndex, endIndex);

  const supervisoesOptions = dedupByNome(
    supervisoes.length
      ? [...supervisoes]
      : [...supervisoes, ...supervisoesFromMembers, ...supervisoesFromNomenclaturas]
  ).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

  const camposOptions = dedupByNome(
    campos.length
      ? [...campos]
      : [...campos, ...camposFromMembers, ...camposFromNomenclaturas]
  ).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar activeMenu={activeMenu} setActiveMenu={setActiveMenu} />

      <NotificationModal
        isOpen={notification.isOpen}
        title={notification.title}
        message={notification.message}
        type={notification.type}
        onClose={() => setNotification({ ...notification, isOpen: false })}
        autoClose={notification.autoClose}
        showButton={notification.showButton !== undefined ? notification.showButton : true}
      />

      {/* Modal de Confirmação de Deleção */}
      {membroDeletando && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-2xl max-w-md w-full">
            {/* Header */}
            <div className="flex items-center gap-3 px-6 py-4 border-b-2 border-red-500 bg-gradient-to-r from-red-600 to-red-700">
              <span className="text-3xl">⚠️</span>
              <h2 className="text-lg font-bold text-white">Confirmar Deleção</h2>
            </div>

            {/* Conteúdo */}
            <div className="px-6 py-6 space-y-4">
              <p className="text-gray-700 font-semibold">
                Tem certeza que deseja deletar este ministro?
              </p>
              <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded">
                <p className="text-sm text-gray-700">
                  <span className="font-semibold">Matrícula:</span> {membroDeletando.matricula}
                </p>
                <p className="text-sm text-gray-700">
                  <span className="font-semibold">Nome:</span> {membroDeletando.nome}
                </p>
                <p className="text-sm text-gray-700">
                  <span className="font-semibold">CPF:</span> {membroDeletando.cpf}
                </p>
              </div>
              <div className="bg-yellow-50 border-l-4 border-yellow-500 p-3 rounded">
                <p className="text-xs text-yellow-800">
                  <span className="font-semibold">⚠️ Atenção:</span> Esta ação é irreversível e não pode ser desfeita.
                </p>
              </div>
            </div>

            {/* Botões */}
            <div className="flex gap-4 px-6 py-4 border-t border-gray-300 bg-gray-50">
              <button
                onClick={deletarMembro}
                className="flex-1 px-4 py-2 bg-gradient-to-r from-red-600 to-red-700 text-white rounded-lg hover:from-red-700 hover:to-red-800 transition font-semibold text-sm"
              >
                ✓ Deletar
              </button>
              <button
                onClick={cancelarDeletar}
                className="flex-1 px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition font-semibold text-sm"
              >
                ✕ Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Crop de Foto - Enquadrar Foto 3x4 */}
      {mostrarCropModal && fotoOriginal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[100] p-4">
          <div className="bg-white rounded-lg shadow-2xl max-w-2xl w-full">
            {/* Header */}
            <div className="flex justify-between items-center px-6 py-4 border-b-2 border-teal-500 bg-gradient-to-r from-teal-600 to-teal-700">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <span>🖼️</span> Enquadrar Foto (3x4)
              </h2>
              <button
                onClick={cancelarCropFoto}
                className="text-white hover:text-gray-100 text-2xl"
              >
                ✕
              </button>
            </div>

            {/* Conteúdo */}
            <div className="p-6 space-y-4">

              {/* Área de Preview com proporcao 3x4 */}
              <div className="bg-gray-100 rounded-lg p-4 flex justify-center">
                <div 
                  ref={previewAreaRef}
                  className="relative bg-black rounded-lg overflow-hidden cursor-grab active:cursor-grabbing select-none aspect-[3/4]" 
                  style={{ width: '220px', height: '293px' }}
                  onWheel={handleCropWheel}
                  onMouseDown={handleCropMouseDown}
                  onMouseMove={handleCropMouseMove}
                  onMouseUp={handleCropMouseUp}
                  onMouseLeave={handleCropMouseUp}
                >
                  <canvas
                    ref={canvasRefCrop}
                    width={220}
                    height={293}
                    className="hidden"
                  />
                  <div className="w-full h-full absolute inset-0 flex items-center justify-center bg-gray-900">
                    <img
                      src={fotoOriginal}
                      alt="Preview para crop"
                      className="w-full h-full object-cover pointer-events-none"
                      style={{
                        transform: `rotate(${fotoCropRotacao}deg) scale(${fotoCropZoom}) translateX(${fotoCropPositionX}px) translateY(${fotoCropPositionY}px)`,
                        transformOrigin: 'center',
                        transition: isDragging ? 'none' : 'transform 0.1s ease-out'
                      }}
                    />
                  </div>
                </div>
              </div>

              {/* Controles de Rotação */}
              <div className="space-y-2">
                <label className="block text-sm font-semibold text-gray-700">Rotação</label>
                <div className="flex gap-3 justify-center items-center">
                  <button
                    onClick={girarCropImagemEsquerda}
                    className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold text-sm transition"
                  >
                    ↺ 90° Esq
                  </button>
                  <span className="text-sm font-bold text-gray-700 bg-gray-100 px-3 py-2 rounded min-w-[50px] text-center">{fotoCropRotacao}°</span>
                  <button
                    onClick={girarCropImagemDireita}
                    className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold text-sm transition"
                  >
                    90° Dir ↻
                  </button>
                </div>
              </div>

              {/* Controles de Zoom */}
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <label className="block text-sm font-semibold text-gray-700">Zoom</label>
                  <span className="text-xs font-bold text-teal-600 bg-teal-100 px-2 py-1 rounded">{fotoCropZoom.toFixed(1)}x</span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="3"
                  step="0.1"
                  value={fotoCropZoom}
                  onChange={(e) => setFotoCropZoom(parseFloat(e.target.value))}
                  className="w-full h-2 bg-gray-300 rounded-lg appearance-none cursor-pointer"
                />
                <div className="flex justify-between text-xs text-gray-500">
                  <span>1x</span>
                  <span>3x</span>
                </div>
              </div>

              {/* Controles de Posição */}
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <label className="text-sm font-semibold text-gray-700">Posição</label>
                  <button
                    onClick={resetCropView}
                    className="text-xs px-3 py-1 bg-gray-300 text-gray-700 rounded hover:bg-gray-400 transition"
                  >
                    ↺ Resetar
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-2">Horizontal</label>
                    <input
                      type="range"
                      min="-200"
                      max="200"
                      step="5"
                      value={fotoCropPositionX}
                      onChange={(e) => setFotoCropPositionX(parseInt(e.target.value))}
                      className="w-full h-2 bg-gray-300 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-2">Vertical</label>
                    <input
                      type="range"
                      min="-200"
                      max="200"
                      step="5"
                      value={fotoCropPositionY}
                      onChange={(e) => setFotoCropPositionY(parseInt(e.target.value))}
                      className="w-full h-2 bg-gray-300 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>
                </div>
              </div>

            </div>

            {/* Botões */}
            <div className="flex gap-4 px-6 py-4 border-t border-gray-300 bg-gray-50">
              <button
                onClick={confirmarCropFoto}
                className="flex-1 px-4 py-2 bg-gradient-to-r from-teal-600 to-teal-700 text-white rounded-lg hover:from-teal-700 hover:to-teal-800 transition font-bold text-sm"
              >
                ✓ Confirmar Enquadramento
              </button>
              <button
                onClick={cancelarCropFoto}
                className="flex-1 px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition font-bold text-sm"
              >
                ✕ Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Alterar Status */}
      {membroAlterandoStatus && (() => {
        const statusOriginal = membroAlterandoStatus.status || 'ativo';
        const jubiladoOriginal = membroAlterandoStatus.jubilado ?? false;
        const motivoObrigatorio = novoStatus === 'desligado' || novoStatus === 'jubilado';
        const semAlteracao = novoStatus === statusOriginal && isJubilado === jubiladoOriginal;
        const podeAlterar = !semAlteracao && (!motivoObrigatorio || motivoStatus.trim().length > 0);
        return (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
              <div className="bg-blue-900 text-white px-6 py-4 rounded-t-xl flex justify-between items-center">
                <h2 className="text-lg font-bold">Alterar Status do Membro</h2>
                <button onClick={() => setMembroAlterandoStatus(null)} className="text-white hover:text-gray-300 text-2xl leading-none">&times;</button>
              </div>
              <div className="p-6 flex flex-col gap-4">
                <p className="text-sm text-gray-600">Membro: <strong>{membroAlterandoStatus.nome}</strong></p>
                <p className="text-xs text-gray-400">Status atual: <strong>{statusOriginal.toUpperCase()}</strong>{jubiladoOriginal ? ' · JUBILADO' : ''}</p>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">NOVA SITUAÇÃO:</label>
                  <select
                    value={novoStatus}
                    onChange={(e) => {
                      const s = e.target.value;
                      setNovoStatus(s);
                      if (s === 'jubilado') setIsJubilado(true);
                      if (s === 'desligado') setIsJubilado(false);
                    }}
                    className="w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                  >
                    <option value="ativo">ATIVO</option>
                    <option value="desligado">DESLIGADO</option>
                    <option value="jubilado">JUBILADO</option>
                    <option value="em_processo">EM PROCESSO</option>
                    <option value="falecido">FALECIDO</option>
                    <option value="inativo">INATIVO</option>
                  </select>
                </div>

                <div className="flex items-center gap-3">
                  <label className="text-sm font-semibold text-gray-700">JUBILADO?</label>
                  <button
                    type="button"
                    disabled={novoStatus === 'jubilado' || novoStatus === 'desligado'}
                    onClick={() => setIsJubilado(v => !v)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 ${
                      isJubilado ? 'bg-blue-600' : 'bg-gray-300'
                    }`}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                      isJubilado ? 'translate-x-6' : 'translate-x-1'
                    }`} />
                  </button>
                  {isJubilado && <span className="text-xs text-blue-600 font-semibold">Membro está jubilado</span>}
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    OBSERVAÇÃO / MOTIVO:{motivoObrigatorio && <span className="text-red-500 ml-1">*</span>}
                  </label>
                  <textarea
                    value={motivoStatus}
                    onChange={(e) => setMotivoStatus(e.target.value)}
                    placeholder={motivoObrigatorio ? 'Motivo obrigatório para este status...' : 'Escreva aqui as Observações...'}
                    rows={4}
                    className={`w-full border-2 rounded-lg px-3 py-2 text-sm focus:outline-none resize-none ${
                      motivoObrigatorio && motivoStatus.trim().length === 0
                        ? 'border-red-400 focus:border-red-500'
                        : 'border-gray-300 focus:border-blue-500'
                    }`}
                  />
                  {motivoObrigatorio && motivoStatus.trim().length === 0 && (
                    <p className="text-xs text-red-500 mt-1">O motivo é obrigatório para status DESLIGADO ou JUBILADO.</p>
                  )}
                </div>

                <button
                  disabled={salvandoStatus || !podeAlterar}
                  onClick={async () => {
                    setSalvandoStatus(true);
                    try {
                      const dbStatus = uiStatusToDb(novoStatus as Membro['status']);
                      const statusAnterior = uiStatusToDb(statusOriginal as Membro['status']);
                      const payload: Record<string, unknown> = {
                        status: dbStatus,
                        jubilado: isJubilado,
                        observacoes: motivoStatus.trim() || null,
                        _status_anterior: statusAnterior,
                        _motivo: motivoStatus.trim() || null,
                      };
                      const res = await authenticatedFetch(`/api/v1/members/${membroAlterandoStatus.id}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload),
                      });
                      if (!res.ok) {
                        const errJson = await res.json().catch(() => null as any);
                        throw new Error(errJson?.error || 'Erro ao salvar.');
                      }

                      // Registrar no Histórico do Ministro
                      const novoStatusLabel = novoStatus.toUpperCase();
                      const statusAnteriorLabel = statusOriginal.toUpperCase();
                      const descricaoHistorico = `Status alterado de ${statusAnteriorLabel} para ${novoStatusLabel}.${
                        motivoStatus.trim() ? ` Motivo: ${motivoStatus.trim()}` : ''
                      }${
                        isJubilado !== jubiladoOriginal
                          ? ` Jubilado: ${isJubilado ? 'Sim' : 'Não'}.`
                          : ''
                      }`;
                      void authenticatedFetch(`/api/membros/${membroAlterandoStatus.id}/historico`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          tipo: 'alteracao_status',
                          titulo: 'Alteração de status ministerial',
                          descricao: descricaoHistorico,
                          origem: 'secretaria/membros',
                          referencia_id: `status_${Date.now()}`,
                        }),
                      });

                      setMembros(prev => prev.map(m =>
                        m.id === membroAlterandoStatus.id
                          ? { ...m, status: novoStatus as Membro['status'], jubilado: isJubilado }
                          : m
                      ));
                      setMembroAlterandoStatus(null);
                      setNotification({
                        isOpen: true,
                        title: 'Status Alterado',
                        message: `Status de ${membroAlterandoStatus.nome} alterado para ${novoStatusLabel} com sucesso.`,
                        type: 'success',
                        autoClose: 4000,
                      });
                    } catch (e) {
                      setNotification({
                        isOpen: true,
                        title: 'Erro ao Alterar Status',
                        message: e instanceof Error ? e.message : String(e),
                        type: 'error',
                      });
                    } finally {
                      setSalvandoStatus(false);
                    }
                  }}
                  className="w-full py-2 bg-blue-900 hover:bg-blue-800 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-bold rounded-lg transition text-sm tracking-widest"
                >
                  {salvandoStatus ? 'SALVANDO...' : 'ALTERAR'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Modal: Histórico do Ministro */}
      {membroHistorico && (
        <HistoricoMinistro
          memberId={membroHistorico.id}
          memberName={membroHistorico.nome}
          matricula={membroHistorico.matricula}
          cargo={membroHistorico.cargoMinisterial}
          cpf={membroHistorico.cpf}
          campo={membroHistorico.campo}
          supervisao={membroHistorico.supervisao}
          onClose={() => setMembroHistorico(null)}
        />
      )}

      {/* Modal: Documentos do Ministro */}
      {membroDocumentos && (
        <DocumentosMinistro
          memberId={membroDocumentos.id}
          memberName={membroDocumentos.nome}
          matricula={membroDocumentos.matricula}
          onClose={() => setMembroDocumentos(null)}
        />
      )}

      {/* Modal: Escolher Carta Convencional */}
      {membroSelecionandoCarta && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="relative rounded-2xl shadow-2xl overflow-hidden" style={{ background: 'linear-gradient(135deg, #F5C842 0%, #F39C12 100%)', padding: '28px 32px', minWidth: '380px' }}>
            <button
              onClick={() => setMembroSelecionandoCarta(null)}
              className="absolute top-2 right-2 w-8 h-8 flex items-center justify-center rounded-full bg-red-500 hover:bg-red-600 text-white font-bold text-lg shadow"
              title="Fechar"
            >✕</button>
            <div className="text-center font-bold text-[#0D2B4E] text-base mb-6 tracking-wide uppercase">
              Escolha o Documento a ser Impresso:
            </div>
            <div className="flex flex-col gap-4">
              <button
                onClick={() => { setMembroImprimindoCartaMudanca(membroSelecionandoCarta); setMembroSelecionandoCarta(null); }}
                className="flex items-center gap-4 rounded-xl px-6 py-4 font-bold text-white text-sm uppercase tracking-wide shadow-lg hover:brightness-110 transition"
                style={{ background: 'linear-gradient(135deg, #1a73e8 0%, #1558b0 100%)' }}
              >
                <svg className="w-10 h-10 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
                <span>Carta de Mudança</span>
              </button>
              <button
                onClick={() => { setMembroImprimindoCartaRecomendacao(membroSelecionandoCarta); setMembroSelecionandoCarta(null); }}
                className="flex items-center gap-4 rounded-xl px-6 py-4 font-bold text-white text-sm uppercase tracking-wide shadow-lg hover:brightness-110 transition"
                style={{ background: 'linear-gradient(135deg, #0D2B4E 0%, #1a4a7a 100%)' }}
              >
                <svg className="w-10 h-10 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span>Carta de Recomendação</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Carta de Mudança */}
      {membroImprimindoCartaMudanca && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-lg shadow-2xl max-w-4xl w-full my-8 flex flex-col max-h-[90vh]">
            <div className="flex justify-between items-center px-6 py-4 border-b-2 border-green-600 bg-gradient-to-r from-green-700 to-green-800 flex-shrink-0">
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                <span>✉️</span> Carta de Mudança — {membroImprimindoCartaMudanca.nome}
              </h2>
              <button onClick={() => setMembroImprimindoCartaMudanca(null)} className="text-white hover:text-gray-100 text-2xl">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              <CartaMudanca
                membro={{
                  matricula: membroImprimindoCartaMudanca.matricula,
                  id: membroImprimindoCartaMudanca.id,
                  uniqueId: membroImprimindoCartaMudanca.uniqueId,
                  nome: membroImprimindoCartaMudanca.nome,
                  cpf: membroImprimindoCartaMudanca.cpf,
                  tipoCadastro: membroImprimindoCartaMudanca.tipoCadastro,
                  cargo: membroImprimindoCartaMudanca.cargoMinisterial || '',
                  qualFuncao: membroImprimindoCartaMudanca.qualFuncao || '',
                  status: membroImprimindoCartaMudanca.status || '',
                  rg: (membroImprimindoCartaMudanca as any).rg || '',
                  orgaoEmissor: (membroImprimindoCartaMudanca as any).orgaoEmissor || '',
                  uf_rg: (membroImprimindoCartaMudanca as any).uf_rg || '',
                  dataNascimento: membroImprimindoCartaMudanca.dataNascimento || '',
                  numero_cgadb: (membroImprimindoCartaMudanca as any).numero_cgadb || '',
                  supervisao: membroImprimindoCartaMudanca.supervisao || '',
                  campo: membroImprimindoCartaMudanca.campo || '',
                  data_filiacao: (membroImprimindoCartaMudanca as any).data_filiacao || '',
                  dataConsagracao: membroImprimindoCartaMudanca.dataConsagracao || '',
                  orden_pastor_data: (membroImprimindoCartaMudanca as any).orden_pastor_data || '',
                  orden_pastor_local: (membroImprimindoCartaMudanca as any).orden_pastor_local || '',
                  observacoes: (membroImprimindoCartaMudanca as any).observacoes || '',
                  naturalidade: (membroImprimindoCartaMudanca as any).naturalidade || '',
                  cidade: (membroImprimindoCartaMudanca as any).cidade || '',
                  uf: (membroImprimindoCartaMudanca as any).uf || '',
                  nomeConjuge: membroImprimindoCartaMudanca.nomeConjuge || '',
                }}
                dadosIgreja={{
                  nomeIgreja: configIgreja.nome || 'COMIEADEPA',
                  endereco: configIgreja.endereco || 'Belém - PA',
                  telefone: configIgreja.telefone || '',
                  email: configIgreja.email || '',
                  cnpj: (configIgreja as any).cnpj || '',
                  logoUrl: configIgreja.logo || undefined,
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Modal: Carta de Recomendação */}
      {membroImprimindoCartaRecomendacao && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-lg shadow-2xl max-w-4xl w-full my-8 flex flex-col max-h-[90vh]">
            <div className="flex justify-between items-center px-6 py-4 border-b-2 border-blue-800 bg-gradient-to-r from-[#0D2B4E] to-[#1a4a7a] flex-shrink-0">
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                <span>🤝</span> Carta de Recomendação — {membroImprimindoCartaRecomendacao.nome}
              </h2>
              <button onClick={() => setMembroImprimindoCartaRecomendacao(null)} className="text-white hover:text-gray-100 text-2xl">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              <CartaRecomendacao
                membro={{
                  matricula: membroImprimindoCartaRecomendacao.matricula,
                  id: membroImprimindoCartaRecomendacao.id,
                  uniqueId: membroImprimindoCartaRecomendacao.uniqueId,
                  nome: membroImprimindoCartaRecomendacao.nome,
                  cpf: membroImprimindoCartaRecomendacao.cpf,
                  tipoCadastro: membroImprimindoCartaRecomendacao.tipoCadastro,
                  cargo: membroImprimindoCartaRecomendacao.cargoMinisterial || '',
                  qualFuncao: membroImprimindoCartaRecomendacao.qualFuncao || '',
                  status: membroImprimindoCartaRecomendacao.status || '',
                  rg: (membroImprimindoCartaRecomendacao as any).rg || '',
                  orgaoEmissor: (membroImprimindoCartaRecomendacao as any).orgaoEmissor || '',
                  uf_rg: (membroImprimindoCartaRecomendacao as any).uf_rg || '',
                  dataNascimento: membroImprimindoCartaRecomendacao.dataNascimento || '',
                  numero_cgadb: (membroImprimindoCartaRecomendacao as any).numero_cgadb || '',
                  supervisao: membroImprimindoCartaRecomendacao.supervisao || '',
                  campo: membroImprimindoCartaRecomendacao.campo || '',
                  data_filiacao: (membroImprimindoCartaRecomendacao as any).data_filiacao || '',
                  dataConsagracao: membroImprimindoCartaRecomendacao.dataConsagracao || '',
                  orden_pastor_data: (membroImprimindoCartaRecomendacao as any).orden_pastor_data || '',
                  orden_pastor_local: (membroImprimindoCartaRecomendacao as any).orden_pastor_local || '',
                  observacoes: (membroImprimindoCartaRecomendacao as any).observacoes || '',
                  naturalidade: (membroImprimindoCartaRecomendacao as any).naturalidade || '',
                  cidade: (membroImprimindoCartaRecomendacao as any).cidade || '',
                  uf: (membroImprimindoCartaRecomendacao as any).uf || '',
                  nomeConjuge: membroImprimindoCartaRecomendacao.nomeConjuge || '',
                  ev_autorizado_data: (membroImprimindoCartaRecomendacao as any).ev_autorizado_data || '',
                  ev_consagrado_data: (membroImprimindoCartaRecomendacao as any).ev_consagrado_data || '',
                }}
                dadosIgreja={{
                  nomeIgreja: configIgreja.nome || 'COMIEADEPA',
                  endereco: configIgreja.endereco || 'Belém - PA',
                  telefone: configIgreja.telefone || '',
                  email: configIgreja.email || '',
                  cnpj: (configIgreja as any).cnpj || '',
                  logoUrl: configIgreja.logo || undefined,
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Modal de Seleção de Impressão */}
      {membroSelecionandoImpressao && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="relative rounded-2xl shadow-2xl overflow-hidden" style={{ background: 'linear-gradient(135deg, #F5C842 0%, #F39C12 100%)', padding: '28px 32px', minWidth: '420px' }}>
            {/* Fechar */}
            <button
              onClick={() => setMembroSelecionandoImpressao(null)}
              className="absolute top-2 right-2 w-8 h-8 flex items-center justify-center rounded-full bg-red-500 hover:bg-red-600 text-white font-bold text-lg shadow"
              title="Fechar"
            >
              ✕
            </button>
            <div className="text-center font-bold text-[#0D2B4E] text-lg mb-6 tracking-wide uppercase">
              Escolha o Documento a ser Impresso:
            </div>
            <div className="flex gap-6 justify-center">
              {/* Ficha Convencional */}
              <button
                onClick={async () => {
                  const m = membroSelecionandoImpressao;
                  setMembroSelecionandoImpressao(null);
                  setFichaAcpStatus('carregando');
                  setFichaAcpLoading(true);
                  setMembroImprimindo(m);
                  if (m?.cpf) {
                    const cpfLimpo = m.cpf.replace(/\D/g, '');
                    try {
                      const res = await fetch(`/api/integracao/casa-do-pastor?cpf=${cpfLimpo}`);
                      const data = await res.json();
                      if (res.ok && data?.status) {
                        setFichaAcpStatus(data.status);
                      } else {
                        setFichaAcpStatus('erro');
                      }
                    } catch {
                      setFichaAcpStatus('erro');
                    } finally {
                      setFichaAcpLoading(false);
                    }
                  } else {
                    setFichaAcpStatus('sem_cpf');
                    setFichaAcpLoading(false);
                  }
                }}
                className="flex flex-col items-center gap-2 rounded-xl px-6 py-4 font-bold text-white text-sm uppercase tracking-wide shadow-lg hover:brightness-110 transition"
                style={{ background: 'linear-gradient(135deg, #1a73e8 0%, #1558b0 100%)', minWidth: '140px' }}
              >
                <span className="text-4xl">👥</span>
                Ficha Convencional
              </button>
              {/* Doc. Casa do Pastor */}
              <button
                onClick={() => { setMembroImprimindoCasaPastor(membroSelecionandoImpressao); setMembroSelecionandoImpressao(null); }}
                className="flex flex-col items-center gap-2 rounded-xl px-6 py-4 font-bold text-white text-sm uppercase tracking-wide shadow-lg hover:brightness-110 transition"
                style={{ background: 'linear-gradient(135deg, #0D2B4E 0%, #1a4a7a 100%)', minWidth: '140px' }}
              >
                <span className="text-4xl">🏠</span>
                Doc. Casa do Pastor
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Impressão - Ficha do Ministro */}
      {membroImprimindo && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-lg shadow-2xl max-w-4xl w-full my-8 flex flex-col max-h-[90vh]">
            {/* Header */}
            <div className="flex justify-between items-center px-6 py-4 border-b-2 border-teal-500 bg-gradient-to-r from-teal-600 to-teal-700 flex-shrink-0">
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                <span>🖨️</span> Ficha do Ministro
              </h2>
              <button
                onClick={() => setMembroImprimindo(null)}
                className="text-white hover:text-gray-100 text-2xl"
              >
                ✕
              </button>
            </div>

            {/* Conteúdo da Ficha com scroll */}
            <div className="flex-1 overflow-y-auto p-6">
              <FichaMembro
                membro={{
                  matricula: membroImprimindo.matricula,
                  id: membroImprimindo.id,
                  uniqueId: membroImprimindo.uniqueId,
                  nome: membroImprimindo.nome,
                  cpf: membroImprimindo.cpf,
                  tipoCadastro: membroImprimindo.tipoCadastro,
                  dataNascimento: membroImprimindo.dataNascimento || '',
                  sexo: membroImprimindo.sexo || '',
                  tipoSanguineo: membroImprimindo.tipoSanguineo || '',
                  escolaridade: membroImprimindo.escolaridade || '',
                  estadoCivil: membroImprimindo.estadoCivil || '',
                  rg: membroImprimindo.rg || '',
                  nacionalidade: membroImprimindo.nacionalidade || '',
                  naturalidade: membroImprimindo.naturalidade || '',
                  uf: membroImprimindo.uf || '',
                  cep: membroImprimindo.cep || '',
                  logradouro: membroImprimindo.logradouro || '',
                  numero: membroImprimindo.numero || '',
                  bairro: membroImprimindo.bairro || '',
                  complemento: membroImprimindo.complemento || '',
                  cidade: membroImprimindo.cidade || '',
                  nomeConjuge: membroImprimindo.nomeConjuge || '',
                  cpfConjuge: membroImprimindo.cpfConjuge || '',
                  dataNascimentoConjuge: membroImprimindo.dataNascimentoConjuge || '',
                  nomePai: membroImprimindo.nomePai || '',
                  nomeMae: membroImprimindo.nomeMae || '',
                  email: membroImprimindo.email || '',
                  celular: membroImprimindo.celular || '',
                  whatsapp: membroImprimindo.whatsapp || '',
                  qualFuncao: membroImprimindo.qualFuncao || '',
                  setorDepartamento: membroImprimindo.setorDepartamento || '',
                  cargo: membroImprimindo.cargoMinisterial || '',
                  numero_cgadb: (membroImprimindo as any).numero_cgadb || '',
                  posicaoNoCampo: (membroImprimindo as any).posicaoNoCampo || '',
                  casaDoPastorAcp: fichaAcpLoading ? 'carregando' : (fichaAcpStatus || undefined),
                  supervisao: membroImprimindo.supervisao || '',
                  campo: membroImprimindo.campo || '',
                  cursoTeologico: membroImprimindo.cursoTeologico || '',
                  instituicaoTeologica: (membroImprimindo as any).instituicaoTeologica || '',
                  profissao: (membroImprimindo as any).profissao || '',
                  dataBatismoAguas: membroImprimindo.dataBatismoAguas || '',
                  dataConsagracao: membroImprimindo.dataConsagracao || '',
                  data_filiacao: (membroImprimindo as any).data_filiacao || '',
                  ev_autorizado_data: (membroImprimindo as any).ev_autorizado_data || '',
                  ev_autorizado_local: (membroImprimindo as any).ev_autorizado_local || '',
                  ev_consagrado_data: (membroImprimindo as any).ev_consagrado_data || '',
                  ev_consagrado_local: (membroImprimindo as any).ev_consagrado_local || '',
                  cons_missionario_data: (membroImprimindo as any).cons_missionario_data || '',
                  cons_missionario_local: (membroImprimindo as any).cons_missionario_local || '',
                  orden_pastor_data: (membroImprimindo as any).orden_pastor_data || '',
                  orden_pastor_local: (membroImprimindo as any).orden_pastor_local || '',
                  conjuge_rg: (membroImprimindo as any).conjuge_rg || '',
                  conjuge_naturalidade: (membroImprimindo as any).conjuge_naturalidade || '',
                  conjuge_nome_pai: (membroImprimindo as any).conjuge_nome_pai || '',
                  conjuge_nome_mae: (membroImprimindo as any).conjuge_nome_mae || '',
                  conjuge_tipo_sanguineo: (membroImprimindo as any).conjuge_tipo_sanguineo || '',
                  conjuge_titulo_eleitoral: (membroImprimindo as any).conjuge_titulo_eleitoral || '',
                  conjuge_fone: (membroImprimindo as any).conjuge_fone || '',
                  conjuge_email: (membroImprimindo as any).conjuge_email || '',
                  qtd_filhos: (membroImprimindo as any).qtd_filhos ?? 0,
                  observacoes: (membroImprimindo as any).observacoes || '',
                  orgaoEmissor: membroImprimindo.orgaoEmissor || '',
                  uf_rg: (membroImprimindo as any).uf_rg || '',
                }}
                dadosIgreja={(() => {
                  return {
                    nomeIgreja: configIgreja.nome || 'Igreja',
                    endereco: configIgreja.endereco || '',
                    telefone: configIgreja.telefone || '',
                    email: configIgreja.email || '',
                    cnpj: (configIgreja as any).cnpj || '',
                    logoUrl: configIgreja.logo || undefined
                  };
                })()}
                fotoUrl={membroImprimindo.fotoUrl || undefined}
              />
            </div>

            {/* Botão de Fechar */}
            <div className="flex gap-4 px-6 py-4 border-t border-gray-300 bg-gray-50 flex-shrink-0">
              <button
                onClick={() => setMembroImprimindo(null)}
                className="flex-1 px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition font-semibold text-sm"
              >
                ✕ Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Impressão - Cartão do Membro */}
      {membroImprimindoCasaPastor && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-lg shadow-2xl max-w-4xl w-full my-8 flex flex-col max-h-[90vh]">
            <div className="flex justify-between items-center px-6 py-4 border-b-2 border-blue-800 bg-gradient-to-r from-blue-900 to-blue-800 flex-shrink-0">
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                <span>🏠</span> Doc. Casa do Pastor
              </h2>
              <button
                onClick={() => setMembroImprimindoCasaPastor(null)}
                className="text-white hover:text-gray-100 text-2xl"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              <DocCasaDoPastor
                membro={{
                  matricula: membroImprimindoCasaPastor.matricula,
                  id: membroImprimindoCasaPastor.id,
                  uniqueId: membroImprimindoCasaPastor.uniqueId,
                  nome: membroImprimindoCasaPastor.nome,
                  cpf: membroImprimindoCasaPastor.cpf,
                  tipoCadastro: membroImprimindoCasaPastor.tipoCadastro,
                  dataNascimento: membroImprimindoCasaPastor.dataNascimento || '',
                  sexo: membroImprimindoCasaPastor.sexo || '',
                  tipoSanguineo: membroImprimindoCasaPastor.tipoSanguineo || '',
                  escolaridade: membroImprimindoCasaPastor.escolaridade || '',
                  estadoCivil: membroImprimindoCasaPastor.estadoCivil || '',
                  rg: membroImprimindoCasaPastor.rg || '',
                  orgaoEmissor: membroImprimindoCasaPastor.orgaoEmissor || '',
                  uf_rg: (membroImprimindoCasaPastor as any).uf_rg || '',
                  nacionalidade: membroImprimindoCasaPastor.nacionalidade || '',
                  naturalidade: membroImprimindoCasaPastor.naturalidade || '',
                  uf: membroImprimindoCasaPastor.uf || '',
                  nomeConjuge: membroImprimindoCasaPastor.nomeConjuge || '',
                  cpfConjuge: membroImprimindoCasaPastor.cpfConjuge || '',
                  dataNascimentoConjuge: membroImprimindoCasaPastor.dataNascimentoConjuge || '',
                  nomePai: membroImprimindoCasaPastor.nomePai || '',
                  nomeMae: membroImprimindoCasaPastor.nomeMae || '',
                  email: membroImprimindoCasaPastor.email || '',
                  celular: membroImprimindoCasaPastor.celular || '',
                  qualFuncao: membroImprimindoCasaPastor.qualFuncao || '',
                  cargo: membroImprimindoCasaPastor.cargoMinisterial || '',
                  numero_cgadb: (membroImprimindoCasaPastor as any).numero_cgadb || '',
                  supervisao: membroImprimindoCasaPastor.supervisao || '',
                  campo: membroImprimindoCasaPastor.campo || '',
                  cursoTeologico: membroImprimindoCasaPastor.cursoTeologico || '',
                  instituicaoTeologica: (membroImprimindoCasaPastor as any).instituicaoTeologica || '',
                  dataBatismoAguas: membroImprimindoCasaPastor.dataBatismoAguas || '',
                  data_filiacao: (membroImprimindoCasaPastor as any).data_filiacao || '',
                  ev_autorizado_data: (membroImprimindoCasaPastor as any).ev_autorizado_data || '',
                  ev_autorizado_local: (membroImprimindoCasaPastor as any).ev_autorizado_local || '',
                  ev_consagrado_data: (membroImprimindoCasaPastor as any).ev_consagrado_data || '',
                  ev_consagrado_local: (membroImprimindoCasaPastor as any).ev_consagrado_local || '',
                  orden_pastor_data: (membroImprimindoCasaPastor as any).orden_pastor_data || '',
                  orden_pastor_local: (membroImprimindoCasaPastor as any).orden_pastor_local || '',
                  observacoes: (membroImprimindoCasaPastor as any).observacoes || '',
                }}
                dadosIgreja={{
                  nomeIgreja: configIgreja.nome || 'Igreja',
                  endereco: configIgreja.endereco || '',
                  telefone: configIgreja.telefone || '',
                  email: configIgreja.email || '',
                  cnpj: (configIgreja as any).cnpj || '',
                  logoUrl: configIgreja.logo || undefined,
                }}
                fotoUrl={membroImprimindoCasaPastor.fotoUrl || undefined}
              />
            </div>
            <div className="flex gap-4 px-6 py-4 border-t border-gray-300 bg-gray-50 flex-shrink-0">
              <button
                onClick={() => setMembroImprimindoCasaPastor(null)}
                className="flex-1 px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition font-semibold text-sm"
              >
                ✕ Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Impressão - Cartão do Membro */}
      {membroImprimindoCartao && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <CartãoMembro
            membro={membroImprimindoCartao as any}
            onClose={() => setMembroImprimindoCartao(null)}
          />
        </div>
      )}

      {/* Modal de Impressão em Lote - Cartões */}
      {imprimindoLote && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-2xl max-w-md w-full">
            {/* Header */}
            <div className="flex justify-between items-center px-6 py-4 border-b-2 border-purple-500 bg-gradient-to-r from-purple-600 to-purple-700">
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                <span>🎫</span> Impressão em Lote
              </h2>
              <button
                onClick={() => setImprimindoLote(false)}
                className="text-white hover:text-gray-100 text-2xl"
              >
                ✕
              </button>
            </div>

            {/* Conteúdo */}
            <div className="p-6">
              <div className="mb-4">
                <p className="text-gray-700 font-semibold mb-4">
                  Pronto para imprimir cartões de {membrosSelecionados.size} membro{membrosSelecionados.size !== 1 ? 's' : ''}?
                </p>

                <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 mb-4">
                  <p className="text-sm text-gray-600">
                    Os cartões serão gerados em PDF e otimizados para impressão em lote.
                  </p>
                </div>

                {/* Listagem dos membros selecionados */}
                <div className="bg-gray-50 rounded-lg p-3 max-h-48 overflow-y-auto mb-4">
                  <p className="text-xs font-semibold text-gray-700 mb-2">Membros selecionados:</p>
                  <ul className="text-xs text-gray-600 space-y-1">
                    {membros
                      .filter(m => membrosSelecionados.has(m.id))
                      .map(m => (
                        <li key={m.id}>• {m.nome} ({m.matricula})</li>
                      ))}
                  </ul>
                </div>
              </div>

              {/* Botões */}
              <div className="flex gap-4">
                <button
                  onClick={() => setImprimindoLote(false)}
                  className="flex-1 px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition font-semibold"
                >
                  ✕ Cancelar
                </button>
                <CartaoBatchPrinter
                  membros={membros.filter(m => membrosSelecionados.has(m.id)) as any}
                  onComplete={() => {
                    setImprimindoLote(false);
                    setMembrosSelecionados(new Set());
                    setNotification({
                      isOpen: true,
                      title: 'Sucesso',
                      message: 'PDF de cartões gerado com sucesso!',
                      type: 'success',
                      autoClose: 2000, // Fechar em 2 segundos
                      showButton: false // Esconder botão
                    });
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-auto">
        <div className="p-6 max-w-[96rem] mx-auto w-full">
          {/* Navegação de Abas - Dashboard vs Dados de Ministros */}
          <div className="bg-white rounded-lg shadow-md mb-6 border-b-4 border-teal-500">
            <div className="flex items-center gap-4 p-4">
              <button
                onClick={() => setDashboardView('overview')}
                className={`px-6 py-3 rounded-lg font-semibold transition ${
                  dashboardView === 'overview'
                    ? 'bg-teal-600 text-white shadow-lg'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                📊 Dashboard
              </button>
              <button
                onClick={() => setDashboardView('list')}
                className={`px-6 py-3 rounded-lg font-semibold transition ${
                  dashboardView === 'list'
                    ? 'bg-teal-600 text-white shadow-lg'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                👥 Dados de Ministros
              </button>
              <button
                onClick={() => setDashboardView('aniversariantes')}
                className={`px-6 py-3 rounded-lg font-semibold transition ${
                  dashboardView === 'aniversariantes'
                    ? 'bg-teal-600 text-white shadow-lg'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                🎂 Aniversariantes
              </button>
            </div>
          </div>

{/* Vista - Dashboard */}
          {dashboardView === 'overview' && (
            <div>
              <MembrosOverview 
                membros={membros as any}
                nivelUsuario="administrador"
                maxMembros={maxMembros}
              />
            </div>
          )}

          {/* Vista - Dados de Ministros (Listagem completa) */}
          {dashboardView === 'list' && (
            <div>
          {/* Filtro de Busca */}
          <div className="bg-white rounded-lg px-4 py-3 shadow-md mb-4">
            <div className="flex flex-wrap gap-2 items-center">

              {/* BUSCA */}
              <div className="flex-1 min-w-[180px] relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔍</span>
                <input
                  type="text"
                  placeholder="DIGITE SUA BUSCA..."
                  value={searchTerm}
                  onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
                  className="w-full h-9 pl-9 pr-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-[#0D2B4E]"
                />
              </div>

              {/* SUPERVISÃO */}
              <select
                value={supervisaoFilter}
                onChange={(e) => { setSupervisaoFilter(e.target.value); setCurrentPage(1); }}
                className="h-9 px-3 border border-gray-300 rounded-lg text-sm font-semibold text-[#0D2B4E] bg-white focus:outline-none focus:border-[#0D2B4E] w-[180px]"
              >
                <option value="TODOS">SUPERVISÃO: TODAS</option>
                {supervisoesOptions.map(s => (
                  <option key={s.id} value={s.nome}>{s.nome.toUpperCase()}</option>
                ))}
              </select>

              {/* CAMPO */}
              <select
                value={campoFilter}
                onChange={(e) => { setCampoFilter(e.target.value); setCurrentPage(1); }}
                className="h-9 px-3 border border-gray-300 rounded-lg text-sm font-semibold text-[#0D2B4E] bg-white focus:outline-none focus:border-[#0D2B4E] w-[180px]"
              >
                <option value="TODOS">CAMPO: TODOS</option>
                {camposOptions
                  .filter(c => supervisaoFilter === 'TODOS' || (c as any).supervisao_id === supervisoesOptions.find(s => s.nome === supervisaoFilter)?.id)
                  .map(c => (
                    <option key={c.id} value={c.nome}>{c.nome.toUpperCase()}</option>
                  ))}
              </select>

              {/* CARGO */}
              <select
                value={cargoFilter}
                onChange={(e) => { setCargoFilter(e.target.value); setCurrentPage(1); }}
                className="h-9 px-3 border border-gray-300 rounded-lg text-sm font-semibold text-[#0D2B4E] bg-white focus:outline-none focus:border-[#0D2B4E] min-w-[120px]"
              >
                <option value="TODOS">CARGO: TODOS</option>
                {getCargosMinisteriais().filter(c => c.ativo).map(c => (
                  <option key={c.id} value={c.nome}>{c.nome.toUpperCase()}</option>
                ))}
              </select>

              {/* STATUS */}
              <select
                value={statusFilter}
                onChange={(e) => { setStatusFilter(e.target.value); setCurrentPage(1); }}
                className="h-9 px-3 border border-gray-300 rounded-lg text-sm font-semibold text-[#0D2B4E] bg-white focus:outline-none focus:border-[#0D2B4E] min-w-[130px]"
              >
                <option value="TODOS">STATUS: TODOS</option>
                <option value="ativo">ATIVO</option>
                <option value="desligado">DESLIGADO</option>
                <option value="em_processo">EM PROCESSO</option>
                <option value="falecido">FALECIDO</option>
                <option value="inativo">INATIVO</option>
                <option value="JUBILADO">JUBILADO</option>
              </select>

              {/* PASTOR PRESIDENTE */}
              <label className="flex flex-col items-center gap-0.5 cursor-pointer shrink-0">
                <span className="text-[9px] font-bold text-[#0D2B4E] uppercase leading-tight text-center">PASTOR<br/>PRESIDENTE</span>
                <input
                  type="checkbox"
                  checked={pastorPresidenteFilter}
                  onChange={(e) => { setPastorPresidenteFilter(e.target.checked); setCurrentPage(1); }}
                  className="w-4 h-4 accent-[#0D2B4E]"
                />
              </label>

              {/* LIMPAR */}
              <button
                onClick={() => {
                  setSearchTerm('');
                  setStatusFilter('ativo');
                  setCargoFilter('TODOS');
                  setSupervisaoFilter('TODOS');
                  setCampoFilter('TODOS');
                  setPastorPresidenteFilter(false);
                  setCurrentPage(1);
                }}
                className="h-9 px-5 bg-[#0D2B4E] text-white rounded-lg hover:bg-[#1A3A5C] transition font-semibold text-sm shrink-0"
              >
                LIMPAR
              </button>

            </div>
          </div>

          {/* Header da Tabela */}
          <div className="bg-white rounded-t-lg shadow-md">
            <div className="flex items-center justify-between p-4 border-b-2 border-teal-500">
              <div className="flex items-center gap-2">
                <span className="text-2xl">☰</span>
                <h2 className="text-lg font-bold text-teal-700">Listagem de Ministros</h2>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-sm text-gray-600">
                  Quantidade de Ministros:
                  <span className="ml-2 px-2 py-0.5 bg-teal-100 text-teal-700 font-bold rounded-full text-sm">
                    {membrosFiltrados.length}
                  </span>
                  {membrosFiltrados.length !== membros.length && (
                    <span className="ml-1 text-xs text-gray-400">de {membros.length}</span>
                  )}
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={gerarPDFListagem}
                    className="px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 transition font-semibold text-sm"
                  >
                    🖨️ IMPRIMIR
                  </button>
                  <button
                    onClick={async () => {
                      if (membrosSelecionados.size === 0) {
                        setNotification({
                          isOpen: true,
                          title: 'Aviso',
                          message: 'Selecione pelo menos um membro para imprimir cartões',
                          type: 'warning'
                        });
                        return;
                      }

                      // Verificar template ativo (assumindo 'membro' como padrão para lote ou verificar o primeiro)
                      // Se quiser ser mais estrito, poderia verificar todos os selecionados
                      const selecionados = membros.filter(m => membrosSelecionados.has(m.id));
                      if (selecionados.length === 0) return;

                      const tiposUnicos = Array.from(new Set(selecionados.map(m => m.tipoCadastro || 'membro')));
                      const templatesBase = await ensureTemplatesSnapshot();
                      const tipoSemTemplate = tiposUnicos.find(t => !hasActiveTemplate(t, templatesBase));

                      if (tipoSemTemplate) {
                        setNotification({
                          isOpen: true,
                          title: 'Template Ausente',
                          message: getMensagemSemTemplate(tipoSemTemplate),
                          type: 'warning'
                        });
                        return;
                      }

                      setImprimindoLote(true);
                    }}
                    disabled={membrosSelecionados.size === 0}
                    className={`px-4 py-2 rounded-lg transition font-semibold text-sm ${membrosSelecionados.size > 0
                      ? 'bg-purple-600 text-white hover:bg-purple-700 cursor-pointer'
                      : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                      }`}
                  >
                    🎫 IMPRIMIR CARTÕES ({membrosSelecionados.size})
                  </button>
                </div>
              </div>
            </div>

            {/* Tabela */}
            <div className="px-4 pt-3 pb-2">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[980px] border-collapse">
                <thead>
                  <tr className="bg-gray-100">
                    <th className="border-2 border-gray-300 px-4 py-3 text-center font-semibold text-gray-700 w-12">
                      <input
                        type="checkbox"
                        checked={membrosSelecionados.size === membrosPaginados.length && membrosPaginados.length > 0}
                        onChange={(e) => {
                          if (e.target.checked) {
                            const novoSet = new Set(membrosSelecionados);
                            membrosPaginados.forEach(m => novoSet.add(m.id));
                            setMembrosSelecionados(novoSet);
                          } else {
                            const novoSet = new Set(membrosSelecionados);
                            membrosPaginados.forEach(m => novoSet.delete(m.id));
                            setMembrosSelecionados(novoSet);
                          }
                        }}
                        className="w-4 h-4 cursor-pointer"
                      />
                    </th>
                    <th className="border-2 border-gray-300 px-4 py-3 text-left font-semibold text-gray-700 w-20">Matrícula</th>
                    <th className="border-2 border-gray-300 px-4 py-3 text-center font-semibold text-gray-700 w-12">Foto</th>
                    <th className="border-2 border-gray-300 px-4 py-3 text-left font-semibold text-gray-700">Nome</th>
                    <th className="border-2 border-gray-300 px-4 py-3 text-left font-semibold text-gray-700">CPF</th>
                    <th className="border-2 border-gray-300 px-4 py-3 text-left font-semibold text-gray-700">Cargo</th>
                    <th className="border-2 border-gray-300 px-4 py-3 text-left font-semibold text-gray-700">Campo</th>
                    <th className="border-2 border-gray-300 px-4 py-3 text-left font-semibold text-gray-700">Status</th>
                    <th className="border-2 border-gray-300 px-4 py-3 text-center font-semibold text-gray-700">Controles</th>
                  </tr>
                </thead>
                <tbody>
                  {membrosPaginados.map((membro) => (
                    <tr key={membro.id} className="hover:bg-gray-50">
                      <td className="border border-gray-300 px-4 py-3 text-center">
                        <input
                          type="checkbox"
                          checked={membrosSelecionados.has(membro.id)}
                          onChange={(e) => {
                            const novoSet = new Set(membrosSelecionados);
                            if (e.target.checked) {
                              novoSet.add(membro.id);
                            } else {
                              novoSet.delete(membro.id);
                            }
                            setMembrosSelecionados(novoSet);
                          }}
                          className="w-4 h-4 cursor-pointer"
                        />
                      </td>
                      <td className="border border-gray-300 px-4 py-3 font-semibold text-gray-700">{membro.matricula}</td>
                      <td className="border border-gray-300 px-4 py-3 text-center">
                        <div className="w-10 h-12 bg-gray-100 rounded overflow-hidden flex items-center justify-center mx-auto border border-gray-200">
                          {membro.fotoUrl ? (
                            <img src={membro.fotoUrl} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <span className="text-xl text-gray-400">👤</span>
                          )}
                        </div>
                      </td>
                      <td className="border border-gray-300 px-4 py-3 text-gray-700">{membro.nome}</td>
                      <td className="border border-gray-300 px-4 py-3 text-gray-600">{membro.cpf}</td>
                      <td className="border border-gray-300 px-4 py-3 text-gray-600">{membro.cargoMinisterial || '-'}</td>
                      <td className="border border-gray-300 px-4 py-3 text-gray-600">{membro.campo || '-'}</td>
                      <td className="border border-gray-300 px-4 py-3">
                        {membro.jubilado
                          ? <span className="px-3 py-1 rounded text-sm font-semibold bg-blue-100 text-blue-800">JUBILADO</span>
                          : <span className={`px-3 py-1 rounded text-sm font-semibold ${
                              membro.status === 'ativo' ? 'bg-green-100 text-green-800'
                              : membro.status === 'falecido' ? 'bg-gray-200 text-gray-600'
                              : membro.status === 'em_processo' ? 'bg-yellow-100 text-yellow-800'
                              : membro.status === 'desligado' ? 'bg-orange-100 text-orange-800'
                              : 'bg-red-100 text-red-800'
                            }`}>
                              {membro.status === 'em_processo' ? 'EM PROCESSO' : membro.status.toUpperCase()}
                            </span>
                        }
                      </td>
                      <td className="border border-gray-300 px-4 py-3">
                        <div className="flex justify-center gap-0">
                          <button
                            onClick={() => setMembroSelecionandoImpressao(membro)}
                            className="p-1.5 text-gray-600 hover:bg-gray-200 rounded-lg transition"
                            title="Imprimir Ficha"
                          >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                            </svg>
                          </button>
                          <button
                            onClick={async () => {
                              const templatesBase = await ensureTemplatesSnapshot();
                              if (!hasActiveTemplate(membro.tipoCadastro, templatesBase)) {
                                setNotification({
                                  isOpen: true,
                                  title: 'Template Ausente',
                                  message: getMensagemSemTemplate(membro.tipoCadastro),
                                  type: 'warning'
                                });
                                return;
                              }
                              setMembroImprimindoCartao(membro);
                            }}
                            className="p-1.5 text-purple-600 hover:bg-purple-100 rounded-lg transition"
                            title="Imprimir Credencial"
                          >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" />
                            </svg>
                          </button>
                          <button
                            onClick={() => abrirEdicao(membro)}
                            className="p-1.5 text-blue-600 hover:bg-blue-100 rounded-lg transition"
                            title="Editar"
                          >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          </button>
                          <button
                            onClick={() => {
                              setMembroAlterandoStatus(membro);
                              setNovoStatus(membro.status || 'ativo');
                              setIsJubilado(false);
                              setMotivoStatus('');
                            }}
                            className="p-1.5 text-amber-600 hover:bg-amber-100 rounded-lg transition"
                            title="Alterar Status"
                          >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                          </button>
                          <button
                            onClick={() => setMembroSelecionandoCarta(membro)}
                            className="p-1.5 text-green-700 hover:bg-green-100 rounded-lg transition"
                            title="Cartas Convencionais"
                          >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                            </svg>
                          </button>
                          <button
                            onClick={() => setMembroDocumentos(membro)}
                            className="p-1.5 text-indigo-600 hover:bg-indigo-100 rounded-lg transition"
                            title="Documentos"
                          >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
                            </svg>
                          </button>
                          <button
                            onClick={() => setMembroHistorico(membro)}
                            className="p-1.5 text-slate-600 hover:bg-slate-100 rounded-lg transition"
                            title="Histórico"
                          >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                          </button>

                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Rodapé da Tabela */}
          <div className="bg-white rounded-b-lg shadow-md p-4 border-t border-gray-300">
            <div className="flex justify-between items-center">
              <div className="text-sm text-gray-600">
                Mostrando {startIndex + 1} até {Math.min(endIndex, membrosFiltrados.length)} de {membrosFiltrados.length} registros
              </div>
              <div className="flex items-center gap-1">
                {/* Anterior */}
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="px-3 py-1 rounded bg-gray-200 text-gray-700 hover:bg-gray-300 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  ‹
                </button>

                {/* Páginas com ellipsis */}
                {(() => {
                  const pages: (number | string)[] = [];
                  if (totalPages <= 7) {
                    for (let i = 1; i <= totalPages; i++) pages.push(i);
                  } else {
                    pages.push(1);
                    if (currentPage > 4) pages.push('...');
                    const start = Math.max(2, currentPage - 2);
                    const end = Math.min(totalPages - 1, currentPage + 2);
                    for (let i = start; i <= end; i++) pages.push(i);
                    if (currentPage < totalPages - 3) pages.push('...');
                    pages.push(totalPages);
                  }
                  return pages.map((p, idx) =>
                    p === '...' ? (
                      <span key={`ellipsis-${idx}`} className="px-2 py-1 text-gray-400 select-none">…</span>
                    ) : (
                      <button
                        key={p}
                        onClick={() => setCurrentPage(p as number)}
                        className={`px-3 py-1 rounded ${
                          currentPage === p
                            ? 'bg-teal-600 text-white font-bold'
                            : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                        }`}
                      >
                        {p}
                      </button>
                    )
                  );
                })()}

                {/* Próximo */}
                <button
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="px-3 py-1 rounded bg-gray-200 text-gray-700 hover:bg-gray-300 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  ›
                </button>
              </div>
            </div>
          </div>

          {/* Formulário Modal com Abas */}
          {showForm && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-lg shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col" style={{ height: '90vh' }}>
                {/* Header */}
                <div className="flex justify-between items-center px-4 py-4 border-b-2 border-teal-500 bg-gradient-to-r from-teal-600 to-teal-700 flex-shrink-0">
                  <h2 className="text-xl font-bold text-white flex items-center gap-2">
                    <span>{membroEditando ? '✏️' : '➕'}</span>
                    {membroEditando ? `Editar Ministro - ${membroEditando.nome}` : 'Inserir Novo Ministro'}
                  </h2>
                  <button
                    onClick={() => setShowForm(false)}
                    className="text-white hover:text-gray-100 text-2xl"
                  >
                    ✕
                  </button>
                </div>

                {/* Abas - Com altura fixa para evitar redimensionamento */}
                <div className="flex border-b border-gray-300 bg-white overflow-x-auto h-16 items-center flex-shrink-0">
                  <button
                    onClick={() => setActiveTab('dados')}
                    className={`px-4 py-3 font-semibold transition whitespace-nowrap text-sm border-b-3 h-full flex items-center ${activeTab === 'dados'
                      ? 'text-teal-700 border-teal-600'
                      : 'text-gray-600 border-transparent hover:text-teal-600'
                      }`}
                  >
                    📋 Dados
                  </button>
                  <button
                    onClick={() => setActiveTab('endereco')}
                    className={`px-4 py-3 font-semibold transition whitespace-nowrap text-sm border-b-3 h-full flex items-center ${activeTab === 'endereco'
                      ? 'text-teal-700 border-teal-600'
                      : 'text-gray-600 border-transparent hover:text-teal-600'
                      }`}
                  >
                    🌍 Endereço + Contato
                  </button>
                  <button
                    onClick={() => setActiveTab('ministerial')}
                    className={`px-4 py-3 font-semibold transition whitespace-nowrap text-sm border-b-3 h-full flex items-center ${activeTab === 'ministerial'
                      ? 'text-teal-700 border-teal-600'
                      : 'text-gray-600 border-transparent hover:text-teal-600'
                      }`}
                  >
                    ⛪ Ministerial
                  </button>
                  <button
                    onClick={() => setActiveTab('familiar')}
                    className={`px-4 py-3 font-semibold transition whitespace-nowrap text-sm border-b-3 h-full flex items-center ${activeTab === 'familiar'
                      ? 'text-teal-700 border-teal-600'
                      : 'text-gray-600 border-transparent hover:text-teal-600'
                      }`}
                  >
                    👨‍👩‍👧 Familiar
                  </button>
                  <button
                    onClick={() => setActiveTab('foto')}
                    className={`px-4 py-3 font-semibold transition whitespace-nowrap text-sm border-b-3 h-full flex items-center ${activeTab === 'foto'
                      ? 'text-teal-700 border-teal-600'
                      : 'text-gray-600 border-transparent hover:text-teal-600'
                      }`}
                  >
                    📸 Foto
                  </button>
                </div>

                {/* Conteúdo das Abas - Scrollável com margens laterais e altura fixa */}
                <div className="flex-1 overflow-y-auto px-4 py-3 min-h-0">
                  {/* ABA: DADOS CADASTRAIS */}
                  {activeTab === 'dados' && (
                    <div className="space-y-3">
                      {/* Linha 0: Matrícula + Editar Matrícula + Jubilado */}
                      <div className="flex flex-wrap items-center gap-6">
                        <div className="flex-1 min-w-[160px]">
                          <label className="block text-xs font-semibold text-gray-700 mb-1">Matrícula</label>
                          <input
                            type="text"
                            placeholder="Automática"
                            value={dadosPessoais.matricula}
                            onChange={(e) => setDadosPessoais({ ...dadosPessoais, matricula: e.target.value })}
                            disabled={!isEditando}
                            className={`w-full px-3 py-2 border border-gray-300 rounded-md text-sm ${
                              isEditando
                                ? 'focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent'
                                : 'bg-gray-100 text-gray-600 cursor-not-allowed'
                            }`}
                          />
                        </div>
                        <div className="flex items-center gap-2 mt-4">
                          <label className="text-xs font-semibold text-gray-700 whitespace-nowrap">Editar Matrícula</label>
                          <button
                            type="button"
                            onClick={() => setIsEditando(!isEditando)}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                              isEditando ? 'bg-teal-500' : 'bg-gray-300'
                            }`}
                          >
                            <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                              isEditando ? 'translate-x-6' : 'translate-x-1'
                            }`} />
                          </button>
                        </div>
                        <div className="flex items-center gap-2 mt-4">
                          <label className="text-xs font-semibold text-gray-700 whitespace-nowrap">JUBILADO?</label>
                          <button
                            type="button"
                            onClick={() => (setDadosPessoais as any)({ ...dadosPessoais, jubilado: !(dadosPessoais as any).jubilado })}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                              (dadosPessoais as any).jubilado ? 'bg-blue-600' : 'bg-gray-300'
                            }`}
                          >
                            <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                              (dadosPessoais as any).jubilado ? 'translate-x-6' : 'translate-x-1'
                            }`} />
                          </button>
                          {(dadosPessoais as any).jubilado && (
                            <span className="text-xs text-blue-600 font-semibold">Ativo</span>
                          )}
                        </div>
                      </div>

                      {/* Organização Eclesiástica */}
                      <div className="bg-sky-50 border border-sky-200 p-3 rounded-md">
                        <h4 className="text-xs font-semibold text-sky-800 mb-3">🏢 Organização Eclesiástica</h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs font-semibold text-gray-700 mb-1">Supervisão</label>
                            <select
                              value={dadosPessoais.supervisao}
                              onChange={(e) => {
                                setDadosPessoais({
                                  ...dadosPessoais,
                                  supervisao: e.target.value,
                                  campo: '',
                                });
                              }}
                              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                            >
                              <option value="">Selecione</option>
                              {supervisoesOptions.map((opt) => (
                                <option key={opt.id} value={opt.nome}>{opt.nome}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-gray-700 mb-1">Campo</label>
                            <select
                              value={dadosPessoais.campo}
                              onChange={(e) => {
                                setDadosPessoais({ ...dadosPessoais, campo: e.target.value });
                              }}
                              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                            >
                              <option value="">Selecione</option>
                              {camposOptions
                                .filter((opt) => {
                                  if (!dadosPessoais.supervisao) return true;
                                  const sup = supervisoesOptions.find((s) => s.nome === dadosPessoais.supervisao);
                                  return sup ? opt.supervisao_id === sup.id : true;
                                })
                                .map((opt) => (
                                  <option key={opt.id} value={opt.nome}>{opt.nome}</option>
                                ))}
                            </select>
                          </div>
                        </div>
                      </div>

                      {/* Linha 1: CPF e Tipo de Cadastro */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-semibold text-gray-700 mb-1">
                            CPF *
                            {membroEditando && <span className="ml-2 text-xs text-gray-500">(Bloqueado)</span>}
                            {dadosPessoais.cpf && !membroEditando && (
                              <span className={`ml-2 ${validarCPF(dadosPessoais.cpf) ? 'text-green-600' : 'text-red-600'}`}>
                                {validarCPF(dadosPessoais.cpf) ? '✓ Válido' : '✗ Inválido'}
                              </span>
                            )}
                          </label>
                          <input
                            type="text"
                            placeholder="Somente Números"
                            value={dadosPessoais.cpf}
                            onChange={(e) => setDadosPessoais({ ...dadosPessoais, cpf: formatCpf(e.target.value) })}
                            disabled={false}
                            className={`w-full px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:border-transparent ${
                              dadosPessoais.cpf && !validarCPF(dadosPessoais.cpf)
                                ? 'border-red-500 focus:ring-red-500'
                                : 'border-gray-300 focus:ring-teal-500'
                            }`}
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-gray-700 mb-1">Tipo de Cadastro *</label>
                          <input
                            type="text"
                            value="Ministro"
                            disabled
                            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm bg-gray-100 text-gray-600 cursor-not-allowed focus:outline-none"
                          />
                        </div>
                      </div>



                      {/* Nome */}
                      <div>
                        <label className="block text-xs font-semibold text-gray-700 mb-1">NOME *</label>
                        <input
                          type="text"
                          placeholder="Nome da Pessoa"
                          value={dadosPessoais.nome}
                          onChange={(e) => setDadosPessoais({ ...dadosPessoais, nome: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                        />
                      </div>

                      {/* Data Nascimento, Sexo e Tipo Sanguíneo */}
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div>
                          <label className="block text-xs font-semibold text-gray-700 mb-1">Data Nascimento *</label>
                          <input
                            type="date"
                            value={dadosPessoais.dataNascimento}
                            onChange={(e) => setDadosPessoais({ ...dadosPessoais, dataNascimento: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-gray-700 mb-1">Sexo</label>
                          <select
                            value={dadosPessoais.sexo}
                            onChange={(e) => setDadosPessoais({ ...dadosPessoais, sexo: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                          >
                            <option>MASCULINO</option>
                            <option>FEMININO</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-gray-700 mb-1">Tipo Sanguíneo</label>
                          <select
                            value={dadosPessoais.tipoSanguineo}
                            onChange={(e) => setDadosPessoais({ ...dadosPessoais, tipoSanguineo: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                          >
                            <option value="">- Escolha -</option>
                            <option value="O+">O+</option>
                            <option value="O-">O-</option>
                            <option value="A+">A+</option>
                            <option value="A-">A-</option>
                            <option value="B+">B+</option>
                            <option value="B-">B-</option>
                            <option value="AB+">AB+</option>
                            <option value="AB-">AB-</option>
                          </select>
                        </div>
                      </div>



                      {/* Escolaridade e Estado Civil */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-semibold text-gray-700 mb-1">Escolaridade</label>
                          <select
                            value={dadosPessoais.escolaridade}
                            onChange={(e) => setDadosPessoais({ ...dadosPessoais, escolaridade: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                          >
                            <option value="">- Escolha -</option>
                            <option value="SEM_INSTRUCAO">Sem Instrução</option>
                            <option value="FUNDAMENTAL">Ensino Fundamental</option>
                            <option value="MEDIO">Ensino Médio</option>
                            <option value="SUPERIOR">Ensino Superior</option>
                            <option value="POSGRADUACAO">Pós-Graduação</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-gray-700 mb-1">Estado Civil</label>
                          <select
                            value={dadosPessoais.estadoCivil}
                            onChange={(e) => setDadosPessoais({ ...dadosPessoais, estadoCivil: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                          >
                            <option value="">- Escolha -</option>
                            <option value="solteiro">{dadosPessoais.sexo === 'FEMININO' ? 'Solteira' : 'Solteiro'}</option>
                            <option value="casado">{dadosPessoais.sexo === 'FEMININO' ? 'Casada' : 'Casado'}</option>
                          </select>
                        </div>
                      </div>



                      {/* Dados do Cônjuge - Aparecem apenas se casado */}
                      {dadosPessoais.estadoCivil === 'casado' && (
                        <div className="bg-blue-50 border border-blue-200 p-3 rounded-md">
                          <h4 className="text-xs font-semibold text-blue-800 mb-3">👥 Dados do Cônjuge</h4>
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            <div>
                              <label className="block text-xs font-semibold text-gray-700 mb-1">Nome do Cônjuge</label>
                              <input
                                type="text"
                                placeholder="Nome"
                                value={dadosPessoais.nomeConjuge}
                                onChange={(e) => setDadosPessoais({ ...dadosPessoais, nomeConjuge: e.target.value })}
                                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-semibold text-gray-700 mb-1">CPF do Cônjuge</label>
                              <input
                                type="text"
                                placeholder="Somente Números"
                                value={dadosPessoais.cpfConjuge}
                                onChange={(e) => setDadosPessoais({ ...dadosPessoais, cpfConjuge: formatCpf(e.target.value) })}
                                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-semibold text-gray-700 mb-1">Data Nascimento do Cônjuge</label>
                              <input
                                type="date"
                                value={dadosPessoais.dataNascimentoConjuge}
                                onChange={(e) => setDadosPessoais({ ...dadosPessoais, dataNascimentoConjuge: e.target.value })}
                                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                              />
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Pais e Filiação */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-semibold text-gray-700 mb-1">Nome do Pai</label>
                          <input
                            type="text"
                            value={dadosPessoais.nomePai}
                            onChange={(e) => setDadosPessoais({ ...dadosPessoais, nomePai: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-gray-700 mb-1">Nome da Mãe</label>
                          <input
                            type="text"
                            value={dadosPessoais.nomeMae}
                            onChange={(e) => setDadosPessoais({ ...dadosPessoais, nomeMae: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                          />
                        </div>
                      </div>



                      {/* Documentação */}
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                        <div>
                          <label className="block text-xs font-semibold text-gray-700 mb-1">RG</label>
                          <input type="text" value={dadosPessoais.rg} onChange={(e) => setDadosPessoais({ ...dadosPessoais, rg: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent" />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-gray-700 mb-1">Órgão Exp.</label>
                          <input type="text" value={dadosPessoais.orgaoEmissor} onChange={(e) => setDadosPessoais({ ...dadosPessoais, orgaoEmissor: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent" />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-gray-700 mb-1">UF RG</label>
                          <select value={dadosPessoais.uf_rg} onChange={(e) => setDadosPessoais({ ...dadosPessoais, uf_rg: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent">
                            <option value="">UF</option>
                            {['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'].map(u => <option key={u} value={u}>{u}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-gray-700 mb-1">Nacionalidade</label>
                          <select value={dadosPessoais.nacionalidade} onChange={(e) => setDadosPessoais({ ...dadosPessoais, nacionalidade: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent">
                            <option>BRASILEIRA</option>
                            <option>ESTRANGEIRA</option>
                          </select>
                        </div>
                      </div>



                      {/* Naturalidade e UF */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-semibold text-gray-700 mb-1">Naturalidade</label>
                          <input
                            type="text"
                            value={dadosPessoais.naturalidade}
                            onChange={(e) => setDadosPessoais({ ...dadosPessoais, naturalidade: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-gray-700 mb-1">UF</label>
                          <select
                            value={dadosPessoais.uf}
                            onChange={(e) => setDadosPessoais({ ...dadosPessoais, uf: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                          >
                            <option value="">Selecionar</option>
                            <option value="AC">Acre</option>
                            <option value="AL">Alagoas</option>
                            <option value="AP">Amapá</option>
                            <option value="AM">Amazonas</option>
                            <option value="BA">Bahia</option>
                            <option value="CE">Ceará</option>
                            <option value="DF">Distrito Federal</option>
                            <option value="ES">Espírito Santo</option>
                            <option value="GO">Goiás</option>
                            <option value="MA">Maranhão</option>
                            <option value="MT">Mato Grosso</option>
                            <option value="MS">Mato Grosso do Sul</option>
                            <option value="MG">Minas Gerais</option>
                            <option value="PA">Pará</option>
                            <option value="PB">Paraíba</option>
                            <option value="PR">Paraná</option>
                            <option value="PE">Pernambuco</option>
                            <option value="PI">Piauí</option>
                            <option value="RJ">Rio de Janeiro</option>
                            <option value="RN">Rio Grande do Norte</option>
                            <option value="RS">Rio Grande do Sul</option>
                            <option value="RO">Rondônia</option>
                            <option value="RR">Roraima</option>
                            <option value="SC">Santa Catarina</option>
                            <option value="SP">São Paulo</option>
                            <option value="SE">Sergipe</option>
                            <option value="TO">Tocantins</option>
                          </select>
                        </div>
                      </div>



                      {/* Batismo */}
                      <div className="bg-teal-50 border border-teal-200 p-3 rounded-md">
                        <h4 className="text-xs font-semibold text-teal-800 mb-3">⛪ Dados Eclesiásticos</h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs font-semibold text-gray-700 mb-1">Data de Batismo nas Águas</label>
                            <input
                              type="date"
                              value={dadosMinisteriais.dataBatismoAguas}
                              onChange={(e) => setDadosMinisteriais({ ...dadosMinisteriais, dataBatismoAguas: e.target.value })}
                              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-gray-700 mb-1">Data de Batismo no Espírito Santo</label>
                            <input
                              type="date"
                              value={dadosMinisteriais.dataBatismoEspiritoSanto}
                              onChange={(e) => setDadosMinisteriais({ ...dadosMinisteriais, dataBatismoEspiritoSanto: e.target.value })}
                              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                            />
                          </div>
                        </div>
                      </div>



                      {/* Título Eleitoral / Zona / Seção / Município Eleitoral */}
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                        <div>
                          <label className="block text-xs font-semibold text-gray-700 mb-1">Título Eleitoral</label>
                          <input type="text" value={dadosPessoais.tituloEleitoral} onChange={(e) => setDadosPessoais({ ...dadosPessoais, tituloEleitoral: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent" />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-gray-700 mb-1">Zona</label>
                          <input type="text" value={dadosPessoais.zonaEleitoral} onChange={(e) => setDadosPessoais({ ...dadosPessoais, zonaEleitoral: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent" />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-gray-700 mb-1">Seção</label>
                          <input type="text" value={dadosPessoais.secaoEleitoral} onChange={(e) => setDadosPessoais({ ...dadosPessoais, secaoEleitoral: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent" />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-gray-700 mb-1">Município Eleitoral</label>
                          <input type="text" value={dadosPessoais.municipioEleitoral} onChange={(e) => setDadosPessoais({ ...dadosPessoais, municipioEleitoral: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent" />
                        </div>
                      </div>
                      {/* Profissão e Email 02 */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-semibold text-gray-700 mb-1">Profissão</label>
                          <input type="text" value={dadosPessoais.profissao} onChange={(e) => setDadosPessoais({ ...dadosPessoais, profissao: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent" />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-gray-700 mb-1">Email 02</label>
                          <input type="email" value={dadosPessoais.email2} onChange={(e) => setDadosPessoais({ ...dadosPessoais, email2: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent" />
                        </div>
                      </div>



                      {/* Posição no Campo, Nº CGADB e Jubilado */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-semibold text-gray-700 mb-1">Posição do Ministro no Campo</label>
                          <input type="text" value={dadosPessoais.posicaoNoCampo} onChange={(e) => setDadosPessoais({ ...dadosPessoais, posicaoNoCampo: e.target.value })} placeholder="Ex: Pastor Titular, Cooperador..." className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent" />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-gray-700 mb-1">Nº CGADB</label>
                          <input type="text" value={dadosPessoais.numero_cgadb} onChange={(e) => setDadosPessoais({ ...dadosPessoais, numero_cgadb: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent" />
                        </div>
                      </div>

                    </div>
                  )}

                  {/* ABA: ENDEREÇO + CONTATO COM GEOLOCALIZAÇÃO */}
                  {activeTab === 'endereco' && (
                    <div className="space-y-3">
                      {/* Seção: ENDEREÇO */}
                      <div className="border-b pb-3">
                        <h3 className="text-sm font-bold text-teal-700 mb-3">📍 Endereço</h3>
                        <div className="space-y-3">
                          {/* Linha 1: CEP + Botão Buscar */}
                          <div>
                            <label className="block text-xs font-semibold text-gray-700 mb-1">CEP</label>
                            <div className="flex gap-2">
                              <input
                                type="text"
                                value={enderecoData.cep}
                                onChange={(e) => setEnderecoData({ ...enderecoData, cep: e.target.value })}
                                placeholder="00000-000"
                                className="w-32 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                              />
                              <button
                                type="button"
                                onClick={buscarCEP}
                                className="px-4 py-2 bg-teal-600 text-white rounded-md hover:bg-teal-700 font-semibold text-sm transition whitespace-nowrap"
                              >
                                🔍 Buscar
                              </button>
                            </div>
                          </div>

                          {/* Linha 2: Logradouro + Número */}
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            <div className="md:col-span-2">
                              <label className="block text-xs font-semibold text-gray-700 mb-1">Logradouro</label>
                              <input type="text" value={enderecoData.logradouro} onChange={(e) => setEnderecoData({ ...enderecoData, logradouro: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent" />
                            </div>
                            <div>
                              <label className="block text-xs font-semibold text-gray-700 mb-1">Número</label>
                              <input type="text" value={enderecoData.numero} onChange={(e) => setEnderecoData({ ...enderecoData, numero: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent" />
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
                          <div>
                            <label className="block text-xs font-semibold text-gray-700 mb-1">Bairro</label>
                            <input type="text" value={enderecoData.bairro} onChange={(e) => setEnderecoData({ ...enderecoData, bairro: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent" />
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-gray-700 mb-1">Complemento</label>
                            <input type="text" value={enderecoData.complemento} onChange={(e) => setEnderecoData({ ...enderecoData, complemento: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent" />
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-gray-700 mb-1">Cidade</label>
                            <input type="text" value={enderecoData.cidade} onChange={(e) => setEnderecoData({ ...enderecoData, cidade: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent" />
                          </div>
                        </div>

                        {/* Geolocalização (Automática) */}
                        <div className="mt-3 p-3 bg-gray-50 rounded-md border border-gray-200">
                          <label className="block text-xs font-semibold text-gray-700 mb-2">🌐 Geolocalização (Automática)</label>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div>
                              <label className="block text-xs font-semibold text-gray-700 mb-1">Latitude</label>
                              <input type="text" value={enderecoData.latitude} disabled className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm bg-gray-100 text-gray-600 cursor-not-allowed" />
                            </div>
                            <div>
                              <label className="block text-xs font-semibold text-gray-700 mb-1">Longitude</label>
                              <input type="text" value={enderecoData.longitude} disabled className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm bg-gray-100 text-gray-600 cursor-not-allowed" />
                            </div>
                          </div>
                          <p className="text-xs text-gray-600 mt-2">Os dados de latitude e longitude serão preenchidos automaticamente ao buscar o CEP.</p>
                        </div>
                      </div>

                      {/* Seção: CONTATO */}
                      <div>
                        <h3 className="text-sm font-bold text-teal-700 mb-3">📞 Contato</h3>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                          <div>
                            <label className="block text-xs font-semibold text-gray-700 mb-1">EMAIL</label>
                            <input
                              type="email"
                              value={dadosPessoais.email}
                              onChange={(e) => setDadosPessoais({ ...dadosPessoais, email: e.target.value })}
                              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-gray-700 mb-1">CELULAR</label>
                            <input
                              type="text"
                              placeholder="(00) 00000-0000"
                              value={dadosPessoais.celular}
                              onChange={(e) => setDadosPessoais({ ...dadosPessoais, celular: formatPhone(e.target.value) })}
                              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-gray-700 mb-1">WHATSAPP</label>
                            <div className="flex gap-2">
                              <input
                                type="text"
                                placeholder="(00) 00000-0000"
                                value={dadosPessoais.whatsapp}
                                onChange={(e) => setDadosPessoais({ ...dadosPessoais, whatsapp: formatPhone(e.target.value) })}
                                className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  if (dadosPessoais.whatsapp) {
                                    const num = dadosPessoais.whatsapp.replace(/\D/g, '');
                                    window.open(`https://wa.me/55${num}`, '_blank');
                                  }
                                }}
                                className="bg-green-600 text-white px-3 rounded-md hover:bg-green-700 font-semibold text-sm"
                              >
                                💬
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>

                    </div>
                  )}

                  {/* ABA: MINISTERIAL */}
                  {activeTab === 'ministerial' && (
                    <div className="space-y-3">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div>
                          <label className="block text-xs font-semibold text-gray-700 mb-1">Curso Teológico</label>
                          <select
                            value={dadosMinisteriais.cursoTeologico}
                            onChange={(e) => setDadosMinisteriais({ ...dadosMinisteriais, cursoTeologico: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                          >
                            <option value="">NÃO TEM</option>
                            <option value="BASICO">Básico</option>
                            <option value="MEDIO">Médio</option>
                            <option value="BACHAREL">Bacharel</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-gray-700 mb-1">Instituição</label>
                          <input
                            type="text"
                            value={dadosMinisteriais.instituicaoTeologica}
                            onChange={(e) => setDadosMinisteriais({ ...dadosMinisteriais, instituicaoTeologica: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                          />
                        </div>
                        <div className="flex gap-6">
                          <label className="flex flex-col gap-1 text-xs font-semibold text-gray-700 cursor-pointer">
                            Pastor Auxiliar?
                            <input
                              type="checkbox"
                              checked={!!dadosMinisteriais.pastorAuxiliar}
                              onChange={(e) => setDadosMinisteriais({ ...dadosMinisteriais, pastorAuxiliar: e.target.checked })}
                              className="w-5 h-5 mt-1"
                            />
                          </label>
                          <label className="flex flex-col gap-1 text-xs font-semibold text-gray-700 cursor-pointer">
                            Pastor Presidente?
                            <input
                              type="checkbox"
                              checked={!!dadosMinisteriais.pastorPresidente}
                              onChange={(e) => setDadosMinisteriais({ ...dadosMinisteriais, pastorPresidente: e.target.checked })}
                              className="w-5 h-5 mt-1"
                            />
                          </label>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div>
                          <label className="block text-xs font-semibold text-gray-700 mb-1">Procedência</label>
                          <select
                            value={dadosMinisteriais.procedencia}
                            onChange={(e) => setDadosMinisteriais({ ...dadosMinisteriais, procedencia: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                          >
                            <option value="">- Definir -</option>
                            <option value="aclamacao">Aclamação</option>
                            <option value="batismo">Batismo</option>
                            <option value="carta">Carta</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-gray-700 mb-1">Procedência Local</label>
                          <input
                            type="text"
                            value={dadosMinisteriais.procedenciaLocal}
                            onChange={(e) => setDadosMinisteriais({ ...dadosMinisteriais, procedenciaLocal: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-gray-700 mb-1">Status Casa do Pastor</label>
                          <div className="flex items-center gap-2 h-[38px]">
                            {casaDoPastorLoading ? (
                              <span className="text-xs text-gray-400 italic">Consultando...</span>
                            ) : casaDoPastorStatus === 'adimplente' ? (
                              <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-green-100 text-green-700 border border-green-300">&#10003; ADIMPLENTE</span>
                            ) : casaDoPastorStatus === 'inadimplente' ? (
                              <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-red-100 text-red-700 border border-red-300">&#10007; INADIMPLENTE</span>
                            ) : casaDoPastorStatus === 'nao_encontrado' ? (
                              <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-yellow-100 text-yellow-700 border border-yellow-300">&#8212; NÃO ENCONTRADO</span>
                            ) : (
                              <span className="text-xs text-gray-400 italic">Não consultado</span>
                            )}
                            <button
                              type="button"
                              onClick={() => consultarCasaDoPastor(dadosPessoais.cpf)}
                              disabled={casaDoPastorLoading || !dadosPessoais.cpf}
                              className="ml-auto px-2 py-1 text-xs rounded border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                              title="Consultar status na Casa do Pastor"
                            >
                              Consultar
                            </button>
                          </div>
                        </div>
                      </div>



                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div>
                          <label className="block text-xs font-semibold text-gray-700 mb-1">Cargo Ministerial</label>
                          <select
                            value={cargoSelecionado}
                            onChange={(e) => setCargoSelecionado(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                          >
                            <option value="">- Selecionar -</option>
                            {cargosMinisteriais
                              .filter(cargo => cargo.ativo)
                              .map(cargo => (
                                <option key={cargo.id} value={cargo.nome}>
                                  {cargo.nome}
                                </option>
                              ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-gray-700 mb-1">Data Batismo Esp. Santo</label>
                          <input
                            type="date"
                            value={dadosMinisteriais.dataBatismoEspiritoSanto}
                            onChange={(e) => setDadosMinisteriais({ ...dadosMinisteriais, dataBatismoEspiritoSanto: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-gray-700 mb-1">Data Batismo Águas</label>
                          <input
                            type="date"
                            value={dadosMinisteriais.dataBatismoAguas}
                            onChange={(e) => setDadosMinisteriais({ ...dadosMinisteriais, dataBatismoAguas: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-semibold text-gray-700 mb-1">Data de Validade (Credencial)</label>
                          <input
                            type="date"
                            value={dadosMinisteriais.dataValidadeCredencial}
                            onChange={(e) => setDadosMinisteriais({ ...dadosMinisteriais, dataValidadeCredencial: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                          />
                        </div>
                      </div>

                      {/* Dados Ministeriais fixos */}
                      <div className="grid grid-cols-1 md:grid-cols-[1fr_140px_auto_1fr] gap-3 items-end">
                        <div>
                          <label className="block text-xs font-semibold text-gray-700 mb-1">Local do Batismo</label>
                          <input type="text" value={dadosConsagracao.local_batismo} onChange={(e) => setDadosConsagracao({ ...dadosConsagracao, local_batismo: e.target.value })} placeholder="Ex: Igreja Central" className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent" />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-gray-700 mb-1">Data de Filiação</label>
                          <input type="date" value={dadosConsagracao.data_filiacao} onChange={(e) => setDadosConsagracao({ ...dadosConsagracao, data_filiacao: e.target.value })} className="w-full px-2 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent" />
                        </div>
                        <div className="flex flex-col items-start gap-1 pb-1">
                          <label className="text-xs font-semibold text-gray-700">Diretoria?</label>
                          <button type="button" onClick={() => setDadosConsagracao(prev => ({ ...prev, diretoria: !prev.diretoria }))}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${dadosConsagracao.diretoria ? 'bg-teal-500' : 'bg-gray-300'}`}>
                            <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${dadosConsagracao.diretoria ? 'translate-x-5' : 'translate-x-0.5'}`} />
                          </button>
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-gray-700 mb-1">Cargo Diretoria</label>
                          <input
                            type="text"
                            value={dadosConsagracao.cargo_diretoria}
                            onChange={(e) => setDadosConsagracao({ ...dadosConsagracao, cargo_diretoria: e.target.value })}
                            placeholder={dadosConsagracao.diretoria ? 'Ex: Secretário, Tesoureiro...' : '—'}
                            disabled={!dadosConsagracao.diretoria}
                            className={`w-full px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent ${dadosConsagracao.diretoria ? 'border-gray-300 bg-white' : 'border-gray-200 bg-gray-50 text-gray-400 cursor-not-allowed'}`}
                          />
                        </div>
                      </div>

                      {/* Dados de Consagração */}
                      <div className="bg-amber-50 border border-amber-200 p-4 rounded-md">
                        <h4 className="text-sm font-bold text-amber-800 mb-3">✝️ Dados de Consagração</h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                          <div>
                            <label className="block text-xs font-semibold text-gray-700 mb-1">Ev. Autorizado — Data</label>
                            <input type="date" value={dadosConsagracao.ev_autorizado_data} onChange={(e) => setDadosConsagracao({ ...dadosConsagracao, ev_autorizado_data: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-gray-700 mb-1">Ev. Autorizado — Local</label>
                            <input type="text" value={dadosConsagracao.ev_autorizado_local} onChange={(e) => setDadosConsagracao({ ...dadosConsagracao, ev_autorizado_local: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                          </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                          <div>
                            <label className="block text-xs font-semibold text-gray-700 mb-1">Ev. Consagrado — Data</label>
                            <input type="date" value={dadosConsagracao.ev_consagrado_data} onChange={(e) => setDadosConsagracao({ ...dadosConsagracao, ev_consagrado_data: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-gray-700 mb-1">Ev. Consagrado — Local</label>
                            <input type="text" value={dadosConsagracao.ev_consagrado_local} onChange={(e) => setDadosConsagracao({ ...dadosConsagracao, ev_consagrado_local: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                          </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                          <div>
                            <label className="block text-xs font-semibold text-gray-700 mb-1">Cons. Missionário(a) — Data</label>
                            <input type="date" value={dadosConsagracao.cons_missionario_data} onChange={(e) => setDadosConsagracao({ ...dadosConsagracao, cons_missionario_data: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-gray-700 mb-1">Cons. Missionário(a) — Local</label>
                            <input type="text" value={dadosConsagracao.cons_missionario_local} onChange={(e) => setDadosConsagracao({ ...dadosConsagracao, cons_missionario_local: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                          </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs font-semibold text-gray-700 mb-1">Orden. Pastor — Data</label>
                            <input type="date" value={dadosConsagracao.orden_pastor_data} onChange={(e) => setDadosConsagracao({ ...dadosConsagracao, orden_pastor_data: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-gray-700 mb-1">Orden. Pastor — Local</label>
                            <input type="text" value={dadosConsagracao.orden_pastor_local} onChange={(e) => setDadosConsagracao({ ...dadosConsagracao, orden_pastor_local: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                          </div>
                        </div>
                      </div>



                      {/* Bloco de Consagração/Recebimento - Aparece quando cargo é selecionado */}
                      {cargoSelecionado && (
                        <div className="p-4 border border-teal-200 rounded-lg bg-teal-50">
                          <h3 className="text-sm font-bold text-teal-900 mb-3">Consagração / Recebimento - {cargoSelecionado}</h3>
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            <div>
                              <label className="block text-xs font-semibold text-gray-700 mb-1">Data da Consagração ou Recebimento</label>
                              <input
                                type="date"
                                value={dadosCargos[cargoSelecionado]?.dataConsagracaoRecebimento || ''}
                                onChange={(e) => setDadosCargos({
                                  ...dadosCargos,
                                  [cargoSelecionado]: {
                                    ...dadosCargos[cargoSelecionado],
                                    dataConsagracaoRecebimento: e.target.value
                                  }
                                })}
                                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-semibold text-gray-700 mb-1">Local de Consagração</label>
                              <input
                                type="text"
                                placeholder="Ex: Templo Central"
                                value={dadosCargos[cargoSelecionado]?.localConsagracao || ''}
                                onChange={(e) => setDadosCargos({
                                  ...dadosCargos,
                                  [cargoSelecionado]: {
                                    ...dadosCargos[cargoSelecionado],
                                    localConsagracao: e.target.value
                                  }
                                })}
                                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-semibold text-gray-700 mb-1">Local de Origem</label>
                              <input
                                type="text"
                                placeholder="Ex: Igreja Original, Pastor Referência"
                                value={dadosCargos[cargoSelecionado]?.localOrigem || ''}
                                onChange={(e) => setDadosCargos({
                                  ...dadosCargos,
                                  [cargoSelecionado]: {
                                    ...dadosCargos[cargoSelecionado],
                                    localOrigem: e.target.value
                                  }
                                })}
                                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                              />
                            </div>
                          </div>
                        </div>
                      )}

                      <div className="space-y-3">
                        <div className="flex items-center gap-3 p-3 border border-gray-300 rounded-lg bg-gray-50">
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={dadosMinisteriais.temFuncaoIgreja}
                              onChange={(e) => setDadosMinisteriais({ ...dadosMinisteriais, temFuncaoIgreja: e.target.checked })}
                              className="w-5 h-5 cursor-pointer"
                            />
                            <label className="text-sm font-semibold text-gray-700">Função na Igreja?</label>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-3 rounded-lg" style={{ backgroundColor: dadosMinisteriais.temFuncaoIgreja ? '#f0f9ff' : '#f9fafb', borderColor: dadosMinisteriais.temFuncaoIgreja ? '#bfdbfe' : '#e5e7eb', borderWidth: '1px' }}>
                          <div>
                            <label className="block text-xs font-semibold text-gray-700 mb-1">Qual Função?</label>
                            <input
                              type="text"
                              placeholder="Ex: Líder de Louvor, Coordenador"
                              value={dadosMinisteriais.qualFuncao}
                              onChange={(e) => setDadosMinisteriais({ ...dadosMinisteriais, qualFuncao: e.target.value })}
                              disabled={!dadosMinisteriais.temFuncaoIgreja}
                              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-gray-700 mb-1">Setor ou Departamento</label>
                            <input
                              type="text"
                              placeholder="Ex: Ministério de Louvor"
                              value={dadosMinisteriais.setorDepartamento}
                              onChange={(e) => setDadosMinisteriais({ ...dadosMinisteriais, setorDepartamento: e.target.value })}
                              disabled={!dadosMinisteriais.temFuncaoIgreja}
                              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed"
                            />
                          </div>
                        </div>
                      </div>



                      <div>
                        <label className="block text-xs font-semibold text-gray-700 mb-1">Observações</label>
                        <textarea
                          rows={2}
                          value={dadosMinisteriais.observacoesMinisteriais}
                          onChange={(e) => setDadosMinisteriais({ ...dadosMinisteriais, observacoesMinisteriais: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                        />
                      </div>
                    </div>
                  )}

                  {/* ABA: REGISTRO FAMILIAR */}
                  {activeTab === 'familiar' && (
                    <div className="space-y-4">

                      {/* Dados do Cônjuge — visível apenas se casado */}
                      {dadosPessoais.estadoCivil === 'casado' ? (
                        <div className="bg-blue-50 border border-blue-200 p-4 rounded-md">
                          <h4 className="text-sm font-bold text-blue-800 mb-3">👥 Registro Familiar — Cônjuge</h4>

                          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                            <div className="md:col-span-2">
                              <label className="block text-xs font-semibold text-gray-700 mb-1">CÔNJUGE</label>
                              <input type="text" value={dadosPessoais.nomeConjuge} onChange={(e) => setDadosPessoais({ ...dadosPessoais, nomeConjuge: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                            </div>
                            <div>
                              <label className="block text-xs font-semibold text-gray-700 mb-1">CPF</label>
                              <input type="text" value={dadosPessoais.cpfConjuge} onChange={(e) => setDadosPessoais({ ...dadosPessoais, cpfConjuge: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                            </div>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
                            <div>
                              <label className="block text-xs font-semibold text-gray-700 mb-1">RG / Emissor</label>
                              <input type="text" value={dadosConjuge.rg} onChange={(e) => setDadosConjuge({ ...dadosConjuge, rg: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                            </div>
                            <div>
                              <label className="block text-xs font-semibold text-gray-700 mb-1">Emissor</label>
                              <input type="text" value={dadosConjuge.orgao_emissor} onChange={(e) => setDadosConjuge({ ...dadosConjuge, orgao_emissor: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                            </div>
                            <div>
                              <label className="block text-xs font-semibold text-gray-700 mb-1">Nacionalidade</label>
                              <select value={dadosConjuge.nacionalidade} onChange={(e) => setDadosConjuge({ ...dadosConjuge, nacionalidade: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
                                <option>BRASILEIRA</option>
                                <option>ESTRANGEIRA</option>
                              </select>
                            </div>
                            <div>
                              <label className="block text-xs font-semibold text-gray-700 mb-1">Naturalidade</label>
                              <input type="text" value={dadosConjuge.naturalidade} onChange={(e) => setDadosConjuge({ ...dadosConjuge, naturalidade: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                            </div>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                            <div>
                              <label className="block text-xs font-semibold text-gray-700 mb-1">Filiação — PAI</label>
                              <input type="text" value={dadosConjuge.nome_pai} onChange={(e) => setDadosConjuge({ ...dadosConjuge, nome_pai: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                            </div>
                            <div>
                              <label className="block text-xs font-semibold text-gray-700 mb-1">Filiação — MÃE</label>
                              <input type="text" value={dadosConjuge.nome_mae} onChange={(e) => setDadosConjuge({ ...dadosConjuge, nome_mae: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                            </div>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
                            <div>
                              <label className="block text-xs font-semibold text-gray-700 mb-1">Título Eleitor</label>
                              <input type="text" value={dadosConjuge.titulo_eleitoral} onChange={(e) => setDadosConjuge({ ...dadosConjuge, titulo_eleitoral: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                            </div>
                            <div>
                              <label className="block text-xs font-semibold text-gray-700 mb-1">Fone</label>
                              <input type="text" value={dadosConjuge.fone} onChange={(e) => setDadosConjuge({ ...dadosConjuge, fone: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                            </div>
                            <div>
                              <label className="block text-xs font-semibold text-gray-700 mb-1">Email</label>
                              <input type="email" value={dadosConjuge.email} onChange={(e) => setDadosConjuge({ ...dadosConjuge, email: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                            </div>
                            <div>
                              <label className="block text-xs font-semibold text-gray-700 mb-1">T. Sanguíneo</label>
                              <select value={dadosConjuge.tipo_sanguineo} onChange={(e) => setDadosConjuge({ ...dadosConjuge, tipo_sanguineo: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
                                <option value="">-</option>
                                {['O+','O-','A+','A-','B+','B-','AB+','AB-'].map(t => <option key={t}>{t}</option>)}
                              </select>
                            </div>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            <div>
                              <label className="block text-xs font-semibold text-gray-700 mb-1">Data Nasc. Cônjuge</label>
                              <input type="date" value={dadosPessoais.dataNascimentoConjuge} onChange={(e) => setDadosPessoais({ ...dadosPessoais, dataNascimentoConjuge: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                            </div>
                            <div>
                              <label className="block text-xs font-semibold text-gray-700 mb-1">1º Casamento?</label>
                              <select value={primeirosCasamento} onChange={(e) => setPrimeirosCasamento(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
                                <option>SIM</option>
                                <option>NÃO</option>
                              </select>
                            </div>
                            <div>
                              <label className="block text-xs font-semibold text-gray-700 mb-1">QTD. de Filhos</label>
                              <input type="number" readOnly value={filhosRegistros.length} className="w-24 px-3 py-2 bg-gray-100 border border-gray-200 rounded-md text-sm cursor-not-allowed text-gray-500" />
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="text-center text-gray-500 py-8 text-sm">
                          <p>Preencha o Estado Civil como <strong>Casado(a)</strong> na aba <strong>Dados</strong> para habilitar o Registro Familiar.</p>
                        </div>
                      )}

                      {dadosPessoais.estadoCivil !== 'casado' && (
                        <div className="bg-gray-50 border border-gray-200 p-4 rounded-md">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div>
                              <label className="block text-xs font-semibold text-gray-700 mb-1">1º Casamento?</label>
                              <select value={primeirosCasamento} onChange={(e) => setPrimeirosCasamento(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
                                <option>SIM</option>
                                <option>NÃO</option>
                              </select>
                            </div>
                            <div>
                              <label className="block text-xs font-semibold text-gray-700 mb-1">QTD. de Filhos</label>
                              <input type="number" readOnly value={filhosRegistros.length} className="w-24 px-3 py-2 bg-gray-100 border border-gray-200 rounded-md text-sm cursor-not-allowed text-gray-500" />
                            </div>
                          </div>
                        </div>
                      )}

                      {/* ── JUVENTUDE COMIEADEPA ─────────────────────────────── */}
                      {membroEditando && (
                        <div className="mt-4 border border-teal-200 rounded-lg overflow-hidden">
                          <div className="flex items-center justify-between bg-teal-50 px-4 py-3 border-b border-teal-200">
                            <h4 className="text-sm font-bold text-teal-800">👦 Juventude COMIEADEPA — Filhos</h4>
                            <button
                              type="button"
                              onClick={() => setShowFilhoForm(v => !v)}
                              className="px-3 py-1.5 bg-teal-500 hover:bg-teal-600 text-white text-xs font-semibold rounded-md transition"
                            >
                              {showFilhoForm ? '✕ Cancelar' : '+ Adicionar Registro'}
                            </button>
                          </div>

                          {/* Formulário de novo filho */}
                          {showFilhoForm && (
                            <div className="bg-teal-50/50 px-4 py-3 border-b border-teal-100">
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                                <input
                                  placeholder="NOME"
                                  value={novoFilho.nome}
                                  onChange={e => setNovoFilho(f => ({ ...f, nome: e.target.value.toUpperCase() }))}
                                  className="col-span-2 md:col-span-4 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 uppercase"
                                />
                                <select
                                  value={novoFilho.sexo}
                                  onChange={e => setNovoFilho(f => ({ ...f, sexo: e.target.value }))}
                                  className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                                >
                                  <option value="MASCULINO">MASCULINO</option>
                                  <option value="FEMININO">FEMININO</option>
                                </select>
                                <input
                                  type="date"
                                  placeholder="DATA NASC. *"
                                  required
                                  value={novoFilho.data_nascimento}
                                  onChange={e => setNovoFilho(f => ({ ...f, data_nascimento: e.target.value }))}
                                  className={`px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 ${!novoFilho.data_nascimento ? 'border-red-300 bg-red-50' : 'border-gray-300'}`}
                                />
                                <input
                                  placeholder="CPF"
                                  value={novoFilho.cpf}
                                  onChange={e => setNovoFilho(f => ({ ...f, cpf: e.target.value }))}
                                  className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                                />
                                <button
                                  type="button"
                                  disabled={salvandoFilho || !novoFilho.nome.trim() || !novoFilho.data_nascimento}
                                  onClick={async () => {
                                    if (!novoFilho.nome.trim() || !novoFilho.data_nascimento || !membroEditando) return;
                                    setSalvandoFilho(true);

                                    // 1. SEMPRE insere em HDS (Heranças do Senhor) — todos os filhos de pastores
                                    const hdsRes = await authenticatedFetch('/api/v1/secretaria/hds', {
                                      method: 'POST',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({
                                        membro_id: membroEditando.id,
                                        nome: novoFilho.nome.trim(),
                                        sexo: novoFilho.sexo,
                                        data_nascimento: novoFilho.data_nascimento,
                                        cpf: novoFilho.cpf || null,
                                      }),
                                    });
                                    setSalvandoFilho(false);
                                    if (!hdsRes.ok) return;
                                    const hdsJson = await hdsRes.json().catch(() => null as any);
                                    const hdsData = hdsJson?.data as any;
                                    if (!hdsData) return;

                                    // 2. Verifica elegibilidade para Juventude COMIEADEPA:
                                    //    • Idade >= 12 e < 33 anos
                                    //    • Não consta na tabela de membros/ministros
                                    const hoje = new Date();
                                    const nasc = new Date(novoFilho.data_nascimento);
                                    const idadeAnos = Math.floor((hoje.getTime() - nasc.getTime()) / (1000 * 60 * 60 * 24 * 365.25));
                                    const idadeElegivel = idadeAnos >= 12 && idadeAnos < 33;

                                    let emJuventude = false;
                                    if (idadeElegivel) {
                                      const memberRes = await authenticatedFetch(`/api/v1/members?search=${encodeURIComponent(novoFilho.nome.trim())}&limit=1`);
                                      const memberJson = memberRes.ok ? await memberRes.json().catch(() => null as any) : null;
                                      const naoEhMembro = ((memberJson?.data as any[]) || []).length === 0;
                                      if (naoEhMembro) {
                                        await authenticatedFetch('/api/v1/secretaria/juventude', {
                                          method: 'POST',
                                          headers: { 'Content-Type': 'application/json' },
                                          body: JSON.stringify({
                                            membro_id: membroEditando.id,
                                            hds_id: hdsData.id,
                                            nome: hdsData.nome,
                                            sexo: hdsData.sexo,
                                            data_nascimento: hdsData.data_nascimento,
                                            cpf: hdsData.cpf,
                                          }),
                                        });
                                        emJuventude = true;
                                      }
                                    }

                                    const newRecord = { ...hdsData, emJuventude } as any;
                                    setFilhosRegistros(prev => { const upd = [...prev, newRecord]; setQtdFilhos(upd.length); return upd; });
                                    setNovoFilho({ nome: '', sexo: 'MASCULINO', data_nascimento: '', cpf: '' });
                                    setShowFilhoForm(false);
                                  }}
                                  className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold rounded-md transition disabled:opacity-50"
                                >
                                  {salvandoFilho ? 'Salvando...' : 'Salvar'}
                                </button>
                              </div>
                            </div>
                          )}

                          {/* Tabela de filhos */}
                          {filhosRegistros.length === 0 ? (
                            <p className="text-center text-gray-400 text-xs py-4">Nenhum filho cadastrado.</p>
                          ) : (
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="bg-gray-100 text-gray-600">
                                  <th className="px-3 py-2 text-left font-semibold">Nome</th>
                                  <th className="px-3 py-2 text-left font-semibold">Sexo</th>
                                  <th className="px-3 py-2 text-left font-semibold">Nasc.</th>
                                  <th className="px-3 py-2 text-left font-semibold">CPF</th>
                                  <th className="px-3 py-2 text-center font-semibold" title="Também cadastrado na Juventude COMIEADEPA">Juventude</th>
                                  <th className="px-3 py-2"></th>
                                </tr>
                              </thead>
                              <tbody>
                                {filhosRegistros.map(filho => (
                                  <tr key={filho.id} className="border-t border-gray-100 hover:bg-gray-50">
                                    <td className="px-3 py-2 font-medium uppercase">{filho.nome}</td>
                                    <td className="px-3 py-2 text-gray-600">{filho.sexo}</td>
                                    <td className="px-3 py-2 text-gray-600">{filho.data_nascimento || '—'}</td>
                                    <td className="px-3 py-2 text-gray-600">{filho.cpf || '—'}</td>
                                    <td className="px-3 py-2 text-center">
                                      {filho.emJuventude
                                        ? <span className="px-1.5 py-0.5 bg-teal-100 text-teal-700 rounded text-[10px] font-bold">SIM</span>
                                        : <span className="px-1.5 py-0.5 bg-gray-100 text-gray-400 rounded text-[10px]">NÃO</span>}
                                    </td>
                                    <td className="px-3 py-2 text-right">
                                      <button
                                        type="button"
                                        onClick={async () => {
                                          // Deleta de HDS; juventude_comieadepa é deletado em cascata via hds_id FK
                                          await authenticatedFetch('/api/v1/secretaria/hds', {
                                            method: 'DELETE',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({ id: filho.id }),
                                          });
                                          setFilhosRegistros(prev => { const upd = prev.filter(f => f.id !== filho.id); setQtdFilhos(upd.length); return upd; });
                                        }}
                                        className="text-red-400 hover:text-red-600 text-xs font-semibold"
                                      >
                                        remover
                                      </button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* ABA: FOTO */}
                  {activeTab === 'foto' && (
                    <div className="space-y-4">
                      <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center bg-gray-50 relative overflow-hidden flex flex-col items-center justify-center min-h-[300px]">
                        {fotoMembro ? (
                          <div className="relative group">
                            <img
                              src={fotoMembro}
                              alt="Foto do Ministro"
                              className="max-h-64 rounded-md shadow-md border-2 border-teal-500 transition-opacity group-hover:opacity-50"
                            />
                            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                onClick={() => fileInputRef.current?.click()}
                                className="bg-teal-600 text-white p-2 rounded-full shadow-lg"
                                title="Alterar Foto"
                              >
                                ✏️
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="text-4xl mb-3">📸</div>
                            <h3 className="text-base font-semibold text-gray-800 mb-1">Foto do Ministro</h3>
                            <p className="text-xs text-gray-600 mb-3">Clique para fazer upload</p>
                            <button
                              onClick={() => fileInputRef.current?.click()}
                              className="px-4 py-2 bg-teal-600 text-white rounded-md hover:bg-teal-700 font-semibold text-sm flex items-center gap-2"
                            >
                              📁 Escolher Foto
                            </button>
                          </>
                        )}
                        <input
                          type="file"
                          ref={fileInputRef}
                          onChange={handleFotoUpload}
                          accept="image/*"
                          className="hidden"
                        />
                      </div>

                      {fotoMembro && (
                        <div className="flex gap-3 justify-center">
                          <button
                            onClick={handleGirarFoto}
                            className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 font-semibold text-sm flex items-center gap-2"
                          >
                            🔄 Girar
                          </button>
                          {fotoMembro && (
                            <button
                              onClick={() => setFotoMembro(null)}
                              className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 font-semibold text-sm flex items-center gap-2"
                            >
                              🗑️ Remover
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Rodapé com Botões de Ação */}
                <div className="flex gap-4 px-4 py-3 border-t border-gray-300 bg-gradient-to-r from-teal-50 to-cyan-50 flex-shrink-0">
                  <button
                    onClick={salvarMembro}
                    className="flex-1 px-4 py-2 bg-gradient-to-r from-teal-600 to-teal-700 text-white rounded-lg hover:from-teal-700 hover:to-teal-800 transition font-bold text-sm"
                  >
                    ✓ {membroEditando ? 'Atualizar' : 'Cadastrar'}
                  </button>
                  <button
                    onClick={fecharFormulario}
                    className="flex-1 px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition font-bold text-sm"
                  >
                    ✕ Cancelar
                  </button>
                </div>
              </div>
            </div>
          )}
            </div>
          )}

          {/* Vista - Aniversariantes */}
          {dashboardView === 'aniversariantes' && (() => {
            const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
            const hoje = new Date();
            const hojeMes = hoje.getMonth() + 1;
            const hojeDia = hoje.getDate();
            const aniversariantesDoMes = membros.filter(m => {
              if (!m.dataNascimento) return false;
              if (m.status !== 'ativo') return false;
              const parts = m.dataNascimento.split('-');
              if (parts.length < 2) return false;
              return parseInt(parts[1], 10) === anivMes;
            }).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }));
            const aniversariantes = anivSoHoje
              ? aniversariantesDoMes.filter(m => {
                  const dia = parseInt((m.dataNascimento || '').split('-')[2] || '0', 10);
                  return anivMes === hojeMes && dia === hojeDia;
                })
              : aniversariantesDoMes;

            const totalPaginas = Math.max(1, Math.ceil(aniversariantes.length / ANIV_POR_PAGINA));
            const paginaAtual = Math.min(anivPage, totalPaginas);
            const anivPagina = aniversariantes.slice((paginaAtual - 1) * ANIV_POR_PAGINA, paginaAtual * ANIV_POR_PAGINA);

            const trocarMes = (mes: number) => { setAnivMes(mes); setAnivPage(1); };

            const msgParaMembro = (m: typeof membros[0]) =>
              anivTexto
                .replace(/{nome}/g, m.nome)
                .replace(/{campo}/g, m.campo || '')
                .replace(/{supervisao}/g, m.supervisao || '');

            const handleWhatsApp = (m: typeof membros[0]) => {
              const tel = (m.whatsapp || m.celular || '').replace(/\D/g, '');
              if (!tel) return alert('Ministro sem WhatsApp/celular cadastrado.');
              const text = encodeURIComponent(msgParaMembro(m));
              window.open(`https://wa.me/55${tel}?text=${text}`, '_blank');
            };

            const handleEmail = (m: typeof membros[0]) => {
              if (!m.email) return alert('Ministro sem e-mail cadastrado.');
              const subject = encodeURIComponent('Parabéns pelo seu aniversário! 🎉');
              const body = encodeURIComponent(msgParaMembro(m));
              window.open(`mailto:${m.email}?subject=${subject}&body=${body}`, '_blank');
            };

            const handleImagemAniv = (e: React.ChangeEvent<HTMLInputElement>) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setAnivImagemFile(file);
              const reader = new FileReader();
              reader.onload = ev => setAnivImagemUrl(ev.target?.result as string);
              reader.readAsDataURL(file);
            };

            return (
            <div className="space-y-6">

              {/* Cards resumo */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {MESES.map((mes, idx) => {
                  const qtd = membros.filter(m => {
                    if (!m.dataNascimento) return false;
                    return parseInt((m.dataNascimento.split('-')[1] || '0'), 10) === idx + 1;
                  }).length;
                  return (
                    <button
                      key={idx}
                      onClick={() => trocarMes(idx + 1)}
                      className={`p-3 rounded-lg text-left border-l-4 shadow transition ${
                        anivMes === idx + 1
                          ? 'border-teal-500 bg-teal-50 ring-2 ring-teal-300'
                          : 'border-gray-200 bg-white hover:bg-gray-50'
                      }`}
                    >
                      <p className={`text-xs font-semibold ${anivMes === idx + 1 ? 'text-teal-700' : 'text-gray-500'}`}>{mes}</p>
                      <p className={`text-xl font-bold ${anivMes === idx + 1 ? 'text-teal-700' : 'text-gray-700'}`}>{qtd}</p>
                    </button>
                  );
                })}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">

                {/* Lista de aniversariantes */}
                <div className="bg-white rounded-lg shadow-md p-6">
                  <div className="flex items-center gap-2 justify-between mb-4">
                    <h3 className="font-bold text-gray-800 text-base">
                      🎂 Aniversariantes de {MESES[anivMes - 1]} ({aniversariantes.length})
                    </h3>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => { setAnivSoHoje(v => !v); setAnivPage(1); }}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold border transition ${
                          anivSoHoje
                            ? 'bg-teal-500 border-teal-500 text-white'
                            : 'bg-white border-gray-300 text-gray-600 hover:border-teal-400 hover:text-teal-600'
                        }`}
                        title={anivSoHoje ? 'Mostrar todos do mês' : 'Mostrar só os de hoje'}
                      >
                        <span className={`w-3 h-3 rounded-full ${anivSoHoje ? 'bg-white' : 'bg-gray-300'}`} />
                        Só hoje
                      </button>
                      <button
                        onClick={() => {
                          const dataEmissao = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
                          const titulo = anivSoHoje ? `Aniversariantes do Dia — ${hojeDia} de ${MESES[anivMes - 1]}` : `Aniversariantes de ${MESES[anivMes - 1]}`;
                          const linhas = aniversariantes.map(m => {
                            const dia = (m.dataNascimento || '').split('-')[2] || '—';
                            return `<tr><td style="text-align:center;font-weight:bold">${dia}</td><td>${m.nome}</td><td>${m.supervisao || '—'}</td><td>${m.campo || '—'}</td><td>${m.celular || m.whatsapp || '—'}</td><td>${m.email || '—'}</td></tr>`;
                          }).join('');
                          const logoUrl = configIgreja.logo || (window.location.origin + '/img/logo_comieadepa.png');
                          const logoHtml = `<img src="${logoUrl}" alt="Logo" style="width:70px;height:70px;object-fit:contain;border-radius:8px" />`;
                          const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>${titulo}</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:11px;color:#333;padding:30px}header{border-bottom:3px solid #123b63;padding-bottom:16px;margin-bottom:20px;display:flex;align-items:center;gap:20px}.logo-box{width:70px;height:70px;display:flex;align-items:center;justify-content:center;flex-shrink:0}.org{flex:1}.org h1{font-size:18px;font-weight:bold;color:#123b63}.org p{font-size:10px;color:#666;margin-top:2px}.badge{background:#F39C12;color:#fff;padding:4px 12px;border-radius:20px;font-size:10px;font-weight:bold;align-self:flex-start}h2{font-size:13px;font-weight:bold;color:#123b63;margin:16px 0 10px;border-bottom:1px solid #e2e8f0;padding-bottom:4px}table{width:100%;border-collapse:collapse;margin-bottom:16px}th{background:#123b63;color:#fff;font-size:10px;padding:6px 8px;text-align:left}td{padding:5px 8px;border-bottom:1px solid #f1f5f9;font-size:10px}tr:nth-child(even) td{background:#f8fafc}footer{margin-top:24px;border-top:1px solid #e2e8f0;padding-top:10px;font-size:9px;color:#94a3b8;text-align:center}@media print{button{display:none}}</style></head><body><header><div class="logo-box">${logoHtml}</div><div class="org"><h1>COMIEADEPA</h1><p>Convenção das Assembleias de Deus no Estado do Pará</p><p>Secretária Geral — Lista de Aniversariantes</p></div><div class="badge">${MESES[anivMes - 1].toUpperCase()}</div></header><h2>${titulo} (${aniversariantes.length} ministros ativos)</h2><table><thead><tr><th>Dia</th><th>Nome</th><th>Supervisão</th><th>Campo</th><th>Telefone</th><th>E-mail</th></tr></thead><tbody>${linhas}</tbody></table><footer>Emitido em ${dataEmissao} | COMIEADEPA — Sistema de Gestão</footer><script>window.onload=function(){window.print();}<\/script></body></html>`;
                          const w = window.open('', '', 'height=900,width=1100');
                          if (w) { w.document.write(html); w.document.close(); }
                        }}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border border-gray-300 bg-white text-gray-600 hover:border-blue-400 hover:text-blue-600 transition"
                        title="Imprimir lista de aniversariantes"
                      >
                        🖨️ Imprimir
                      </button>
                    </div>
                  </div>

                  {aniversariantes.length === 0 ? (
                    <p className="text-center text-gray-400 py-10">Nenhum aniversariante neste mês.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[760px] text-sm">
                        <thead>
                          <tr>
                            <th className="px-3 py-3 text-left font-semibold bg-gray-200 text-gray-800 whitespace-nowrap">Dia</th>
                            <th className="px-3 py-3 text-left font-semibold bg-gray-200 text-gray-800">Nome</th>
                            <th className="px-3 py-3 text-left font-semibold bg-gray-200 text-gray-800">Campo</th>
                            <th className="px-3 py-3 text-left font-semibold bg-gray-200 text-gray-800">Contato</th>
                            <th className="px-3 py-3 text-center font-semibold bg-gray-200 text-gray-800">Enviar</th>
                          </tr>
                        </thead>
                        <tbody>
                          {anivPagina.map(m => {
                              const partes = (m.dataNascimento || '').split('-');
                              const dia = partes[2] || '—';
                              const diaNasc = parseInt(partes[2] || '0', 10);
                              const isHoje = anivMes === hojeMes && diaNasc === hojeDia;
                              const temWhatsapp = !!(m.whatsapp || m.celular);
                              const temEmail = !!m.email;
                              const whatsappAtivo = isHoje && temWhatsapp && anivEnviando !== m.id;
                              const emailAtivo = isHoje && temEmail && anivEnviando !== m.id;
                              return (
                                <tr key={m.id} className="border-b border-gray-200 hover:bg-gray-50">
                                  <td className="px-3 py-2 text-center">
                                    <span className={`inline-flex items-center justify-center w-8 h-8 rounded-full font-bold text-sm ${isHoje ? 'bg-teal-500 text-white ring-2 ring-teal-300' : 'bg-teal-100 text-teal-700'}`}>{dia}</span>
                                  </td>
                                  <td className="px-3 py-2">
                                    <p className="text-xs font-semibold text-gray-800 uppercase">{m.nome}</p>
                                    <p className="text-[10px] text-gray-500">{m.tipoCadastro}</p>
                                  </td>
                                  <td className="px-3 py-2 text-xs text-gray-600">{m.campo || '—'}</td>
                                  <td className="px-3 py-2">
                                    <p className="text-xs text-gray-600">{m.celular || m.whatsapp || '—'}</p>
                                    <p className="text-[10px] text-gray-400 truncate max-w-[140px]">{m.email || ''}</p>
                                  </td>
                                  <td className="px-3 py-2">
                                    <div className="flex items-center justify-center gap-2">
                                      <button
                                        onClick={() => handleWhatsApp(m)}
                                        disabled={!whatsappAtivo}
                                        className={`px-2 py-1 text-white text-xs font-semibold rounded transition ${whatsappAtivo ? 'bg-green-500 hover:bg-green-600 cursor-pointer' : 'bg-gray-300 cursor-not-allowed opacity-50'}`}
                                        title={!isHoje ? 'Disponível apenas no dia do aniversário' : !temWhatsapp ? 'WhatsApp não cadastrado' : 'Enviar via WhatsApp'}
                                      >
                                        WhatsApp
                                      </button>
                                      <button
                                        onClick={() => handleEmail(m)}
                                        disabled={!emailAtivo}
                                        className={`px-2 py-1 text-white text-xs font-semibold rounded transition ${emailAtivo ? 'bg-blue-500 hover:bg-blue-600 cursor-pointer' : 'bg-gray-300 cursor-not-allowed opacity-50'}`}
                                        title={!isHoje ? 'Disponível apenas no dia do aniversário' : !temEmail ? 'E-mail não cadastrado' : 'Enviar via E-mail'}
                                      >
                                        E-mail
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                        </tbody>
                      </table>

                      {/* Paginação */}
                      {totalPaginas > 1 && (
                        <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-200">
                          <p className="text-xs text-gray-500">
                            Exibindo {((paginaAtual - 1) * ANIV_POR_PAGINA) + 1}–{Math.min(paginaAtual * ANIV_POR_PAGINA, aniversariantes.length)} de {aniversariantes.length}
                          </p>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => setAnivPage(1)}
                              disabled={paginaAtual === 1}
                              className="px-2 py-1 text-xs rounded border border-gray-300 disabled:opacity-40 hover:bg-gray-100"
                            >«</button>
                            <button
                              onClick={() => setAnivPage(p => Math.max(1, p - 1))}
                              disabled={paginaAtual === 1}
                              className="px-2 py-1 text-xs rounded border border-gray-300 disabled:opacity-40 hover:bg-gray-100"
                            >‹</button>
                            {Array.from({ length: totalPaginas }, (_, i) => i + 1)
                              .filter(p => p === 1 || p === totalPaginas || Math.abs(p - paginaAtual) <= 1)
                              .reduce<(number | '...')[]>((acc, p, i, arr) => {
                                if (i > 0 && (p as number) - (arr[i - 1] as number) > 1) acc.push('...');
                                acc.push(p);
                                return acc;
                              }, [])
                              .map((p, i) => p === '...'
                                ? <span key={`e${i}`} className="px-2 py-1 text-xs text-gray-400">…</span>
                                : <button key={p} onClick={() => setAnivPage(p as number)} className={`px-2 py-1 text-xs rounded border transition ${paginaAtual === p ? 'bg-teal-500 text-white border-teal-500' : 'border-gray-300 hover:bg-gray-100'}`}>{p}</button>
                              )}
                            <button
                              onClick={() => setAnivPage(p => Math.min(totalPaginas, p + 1))}
                              disabled={paginaAtual === totalPaginas}
                              className="px-2 py-1 text-xs rounded border border-gray-300 disabled:opacity-40 hover:bg-gray-100"
                            >›</button>
                            <button
                              onClick={() => setAnivPage(totalPaginas)}
                              disabled={paginaAtual === totalPaginas}
                              className="px-2 py-1 text-xs rounded border border-gray-300 disabled:opacity-40 hover:bg-gray-100"
                            >»</button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Painel de configuração da mensagem */}
                <div className="space-y-4">
                  <div className="bg-white rounded-lg shadow-md p-5">
                    <h3 className="font-bold text-gray-800 text-sm mb-4">✉️ Configurar Mensagem Padrão</h3>
                    <p className="text-[11px] text-gray-500 mb-3">
                      Use <code className="bg-gray-100 px-1 rounded">{'{nome}'}</code>, <code className="bg-gray-100 px-1 rounded">{'{campo}'}</code> e <code className="bg-gray-100 px-1 rounded">{'{supervisao}'}</code> como variáveis.
                    </p>
                    <textarea
                      value={anivTexto}
                      onChange={e => setAnivTexto(e.target.value)}
                      rows={8}
                      className="w-full border-2 border-teal-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                      placeholder="Digite o texto da mensagem..."
                    />

                    {/* Imagem */}
                    <div className="mt-4">
                      <p className="text-sm font-semibold text-gray-700 mb-2">Imagem da mensagem</p>
                      {anivImagemUrl ? (
                        <div className="relative">
                          <img src={anivImagemUrl} alt="Imagem aniversário" className="w-full rounded-lg object-cover max-h-40 border border-gray-200" />
                          <button
                            onClick={() => { setAnivImagemUrl(''); setAnivImagemFile(null); if (anivFileRef.current) anivFileRef.current.value = ''; }}
                            className="absolute top-1 right-1 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs hover:bg-red-600"
                          >
                            ✕
                          </button>
                        </div>
                      ) : (
                        <div
                          onClick={() => anivFileRef.current?.click()}
                          className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center cursor-pointer hover:border-teal-400 transition"
                        >
                          <p className="text-gray-400 text-xs">Clique para adicionar uma imagem</p>
                          <p className="text-gray-300 text-[10px] mt-1">PNG, JPG, GIF</p>
                        </div>
                      )}
                      <input ref={anivFileRef} type="file" accept="image/*" className="hidden" onChange={handleImagemAniv} />
                    </div>

                    {/* Pré-visualização */}
                    <div className="mt-4 border border-gray-200 rounded-lg p-3 bg-gray-50">
                      <p className="text-[10px] font-semibold text-gray-500 mb-2 uppercase tracking-wide">Pré-visualização</p>
                      {anivImagemUrl && <img src={anivImagemUrl} alt="" className="w-full rounded mb-2 max-h-32 object-cover" />}
                      <p className="text-xs text-gray-700 whitespace-pre-line">
                        {anivTexto.replace(/{nome}/g, 'JOÃO DA SILVA').replace(/{campo}/g, 'Campo Central').replace(/{supervisao}/g, '1ª Supervisão')}
                      </p>
                    </div>
                  </div>

                  {/* Envio em massa */}
                  <div className="bg-white rounded-lg shadow-md p-5">
                    <h3 className="font-bold text-gray-800 text-sm mb-3">📤 Envio em Massa</h3>
                    <p className="text-xs text-gray-500 mb-4">
                      Abre o WhatsApp/e-mail individualmente para cada aniversariante do mês selecionado.
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          let i = 0;
                          const next = () => {
                            if (i >= aniversariantes.length) { setAnivEnviando(null); return; }
                            const m = aniversariantes[i++];
                            setAnivEnviando(m.id);
                            handleWhatsApp(m);
                            setTimeout(next, 1500);
                          };
                          next();
                        }}
                        disabled={aniversariantes.length === 0}
                        className="flex-1 px-3 py-2 bg-green-500 hover:bg-green-600 text-white text-sm font-semibold rounded-lg transition disabled:opacity-50"
                      >
                        WhatsApp ({aniversariantes.filter(m => !!(m.whatsapp || m.celular)).length})
                      </button>
                      <button
                        onClick={() => {
                          aniversariantes.filter(m => !!m.email).forEach((m, i) => {
                            setTimeout(() => handleEmail(m), i * 1000);
                          });
                        }}
                        disabled={aniversariantes.length === 0}
                        className="flex-1 px-3 py-2 bg-blue-500 hover:bg-blue-600 text-white text-sm font-semibold rounded-lg transition disabled:opacity-50"
                      >
                        E-mail ({aniversariantes.filter(m => !!m.email).length})
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}