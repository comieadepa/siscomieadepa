﻿'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import PageLayout from '@/components/PageLayout';
import { useRequireSupabaseAuth } from '@/hooks/useRequireSupabaseAuth';
import { useMembers } from '@/hooks/useMembers';
import { createClient } from '@/lib/supabase-client';
import { loadOrgNomenclaturasFromSupabaseOrMigrate, type OrgNomenclaturasState } from '@/lib/org-nomenclaturas';
import { getCargosMinisteriais, type CargoMinisterial } from '@/lib/cargos-utils';
import { formatCpf, formatPhone } from '@/lib/mascaras';
import { normalizePayloadToUppercase } from '@/lib/uppercase-normalizer';
import type { Member } from '@/types/supabase';

interface SimpleOption {
  id: string;
  nome: string;
  supervisao_id?: string | null;
  campo_id?: string | null;
}

const STATUS_LABELS: Record<string, string> = {
  em_processo: 'Em Processo',
  deferir: 'Deferido',
  indeferir: 'Indeferido',
  homologar: 'Homologado'
};

const TIPO_REGISTRO_LABELS: Record<string, string> = {
  chegada: 'Candidato (Novo cadastro)',
  progressao: 'Progressão (já cadastrado)',
  filiacao: 'Filiação (consagrado em outra instituição)',
  novo: 'Candidato (Novo cadastro)',
  existente: 'Progressão (já cadastrado)',
  ministro: 'Progressão (já cadastrado)'
};

const TIPO_REGISTRO_OPTIONS: Array<{ value: 'chegada' | 'progressao' | 'filiacao'; label: string }> = [
  { value: 'chegada', label: TIPO_REGISTRO_LABELS.chegada },
  { value: 'progressao', label: TIPO_REGISTRO_LABELS.progressao },
  { value: 'filiacao', label: TIPO_REGISTRO_LABELS.filiacao },
];

const CATEGORIA_REGISTRO_OPTIONS = [
  'AUTORIZAÇÃO',
  'AUTORIZAÇÃO - NOVO APRESENTADOR',
  'CONSAGRAÇÃO',
  'ORDENAÇÃO',
  'ENTRADA NO PROBATÓRIO',
  'SAÍDA DO PROBATÓRIO',
  'INTEGRAÇÃO',
  'REINTEGRAÇÃO',
];

const normalizeTipoRegistro = (value: string) => {
  if (value === 'novo') return 'chegada';
  if (value === 'existente' || value === 'ministro') return 'progressao';
  if (value === 'chegada' || value === 'progressao' || value === 'filiacao') return value;
  return 'chegada';
};

const isConsagracaoTableMissing = (error: any) => {
  const message = String(error?.message || '').toLowerCase();
  const code = String(error?.code || '').toUpperCase();
  return code === 'PGRST205' || message.includes("could not find the table 'public.consagracao_registros'");
};

export default function ConsagracaoPage() {
  const { loading } = useRequireSupabaseAuth();
  const supabase = useMemo(() => createClient(), []);
  const { fetchMembers } = useMembers();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);
  const suppressNextSearchRef = useRef(false);

  // CSV Import
  const [csvRows, setCsvRows] = useState<any[]>([]);
  const [csvErro, setCsvErro] = useState('');
  const [csvSucesso, setCsvSucesso] = useState('');
  const [importing, setImporting] = useState(false);

  const [activeTab, setActiveTab] = useState('cadastro');
  const [ministryId] = useState<string>('single-tenant');
  const [loadingData, setLoadingData] = useState(true);

  const [nomenclaturas, setNomenclaturas] = useState<OrgNomenclaturasState | null>(null);
  const [supervisoes, setSupervisoes] = useState<SimpleOption[]>([]);
  const [campos, setCampos] = useState<SimpleOption[]>([]);
  const [congregacoes, setCongregacoes] = useState<SimpleOption[]>([]);
  const [cargosMinisteriais] = useState<CargoMinisterial[]>(() => getCargosMinisteriais());

  const [registros, setRegistros] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingRegistro, setEditingRegistro] = useState<any | null>(null);
  const [statusMensagem, setStatusMensagem] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [processModalOpen, setProcessModalOpen] = useState(false);
  const [processRegistro, setProcessRegistro] = useState<any | null>(null);
  const [consagracaoModuleReady, setConsagracaoModuleReady] = useState(true);

  const [memberQuery, setMemberQuery] = useState('');
  const [memberResults, setMemberResults] = useState<Member[]>([]);
  const [memberOpen, setMemberOpen] = useState(false);
  const [fotoBloqueada, setFotoBloqueada] = useState(false);

  // Regiões customizadas
  const REGIOES_PADRAO = ['COMIEADEPA', 'MARABÁ', 'SANTARÉM', 'SEGUNDA CHAMADA'];
  const [regioesList, setRegioesList] = useState<string[]>(REGIOES_PADRAO);
  const [novaRegiao, setNovaRegiao] = useState('');
  const [showNovaRegiao, setShowNovaRegiao] = useState(false);

  // Filtros da aba Lista
  const [filtroRegiao, setFiltroRegiao] = useState('');
  const [filtroSupervisao, setFiltroSupervisao] = useState('');
  const [filtroCampo, setFiltroCampo] = useState('');
  const [filtroBusca, setFiltroBusca] = useState('');
  const [filtroStatus, setFiltroStatus] = useState('');

  const todayIso = () => new Date().toISOString().slice(0, 10);

  const [formRegistro, setFormRegistro] = useState({
    tipo_registro: 'chegada',
    categoria_registro: '',
    member_id: '',
    numero_processo: '',
    data_processo: todayIso(),
    cpf: '',
    nome: '',
    data_nascimento: '',
    sexo: 'MASCULINO',
    rg: '',
    orgao_emissor: '',
    estado_civil: '',
    nacionalidade: '',
    naturalidade: '',
    uf: '',
    email: '',
    telefone: '',
    nome_pai: '',
    nome_mae: '',
    nome_conjuge: '',
    matricula: '',
    supervisao_id: '',
    campo_id: '',
    congregacao_id: '',
    cargo_ocupa: '',
    cargo_pretendido: '',
    pastor_solicitante: '',
    origem_instituicao: '',
    origem_cidade: '',
    origem_uf: '',
    origem_data_consagracao: '',
    data_autorizacao: '',
    status_processo: 'em_processo',
    observacoes: '',
    foto_url: '',
    // Endereço
    endereco: '',
    numero_endereco: '',
    bairro: '',
    complemento: '',
    cidade: '',
    uf_endereco: '',
    cep: '',
    // Formação e dados extras
    escolaridade: '',
    curso_teologico: '',
    cargo_anterior: '',
    mat_pr_solicitante: '',
    doc_pendente: false,
    data_registro: ''
  });

  const getNextProcessNumber = async () => {
    if (!ministryId || !consagracaoModuleReady) return '';
    const year = new Date().getFullYear();
    const { data, error } = await supabase
      .from('consagracao_registros')
      .select('numero_processo')
      
      .like('numero_processo', `%/${year}`);

    if (error) {
      if (isConsagracaoTableMissing(error)) {
        setConsagracaoModuleReady(false);
        setStatusMensagem('Módulo Consagração indisponível: tabela public.consagracao_registros não encontrada. Aplique as migrations de Consagração no Supabase.');
      }
      return '';
    }

    const numeros = (data || [])
      .map((item: any) => {
        const raw = String(item?.numero_processo || '');
        const base = raw.split('/')[0];
        const parsed = Number.parseInt(base, 10);
        return Number.isFinite(parsed) ? parsed : 0;
      })
      .filter((value: number) => value > 0);

    const next = (numeros.length ? Math.max(...numeros) : 0) + 1;
    return `${next}/${year}`;
  };

  const loadInitialData = async () => {
    setLoadingData(true);

    const orgNomes = await loadOrgNomenclaturasFromSupabaseOrMigrate(supabase, { syncLocalStorage: false });
    setNomenclaturas(orgNomes);

    const [supRes, camposRes, congRes] = await Promise.all([
      supabase.from('supervisoes').select('id, nome').order('nome'),
      supabase.from('campos').select('id, nome, supervisao_id').order('nome'),
      supabase.from('congregacoes').select('id, nome, supervisao_id, campo_id').order('nome')
    ]);

    if (!supRes.error) setSupervisoes((supRes.data as SimpleOption[]) || []);
    if (!camposRes.error) setCampos((camposRes.data as SimpleOption[]) || []);
    if (!congRes.error) setCongregacoes((congRes.data as SimpleOption[]) || []);

    const { data, error } = await supabase
      .from('consagracao_registros')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) {
      if (isConsagracaoTableMissing(error)) {
        setConsagracaoModuleReady(false);
        setStatusMensagem('Módulo Consagração indisponível: tabela public.consagracao_registros não encontrada. Aplique as migrations de Consagração no Supabase.');
        setRegistros([]);
      }
    } else if (data) {
      setConsagracaoModuleReady(true);
      setRegistros(data);
    }

    setLoadingData(false);
  };

  useEffect(() => {
    if (!loading) {
      loadInitialData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  useEffect(() => {
    if (formRegistro.tipo_registro !== 'progressao') {
      setMemberQuery('');
      setMemberResults([]);
      setMemberOpen(false);
      setFotoBloqueada(false);
      return;
    }
  }, [formRegistro.tipo_registro]);

  useEffect(() => {
    let cancelled = false;
    const query = memberQuery.trim();

    if (suppressNextSearchRef.current) {
      suppressNextSearchRef.current = false;
      setMemberOpen(false);
      return;
    }
    if (query.length < 3) {
      setMemberResults([]);
      setMemberOpen(false);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const res = await fetchMembers(1, 20, { status: 'active', search: query });
        const list = ((res as any)?.data || []) as Member[];
        if (!cancelled) {
          setMemberResults(list);
          setMemberOpen(true);
        }
      } catch {
        if (!cancelled) {
          setMemberResults([]);
          setMemberOpen(true);
        }
      }
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [memberQuery, fetchMembers, formRegistro.tipo_registro]);

  const compressImage = (base64: string): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve(base64);

        const maxSize = 480;
        const ratio = img.width / img.height;
        let width = maxSize;
        let height = maxSize;
        if (ratio > 1) {
          height = Math.round(maxSize / ratio);
        } else {
          width = Math.round(maxSize * ratio);
        }

        canvas.width = width;
        canvas.height = height;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        const compressed = canvas.toDataURL('image/jpeg', 0.8);
        resolve(compressed);
      };
      img.src = base64;
    });
  };

  const handleFotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      const result = event.target?.result as string;
      const compressed = await compressImage(result);
      setFormRegistro((prev) => ({ ...prev, foto_url: compressed }));
      setFotoBloqueada(false);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const resetForm = () => {
    setFormRegistro({
      tipo_registro: 'chegada',
      categoria_registro: '',
      member_id: '',
      numero_processo: '',
      data_processo: todayIso(),
      cpf: '',
      nome: '',
      data_nascimento: '',
      sexo: 'MASCULINO',
      rg: '',
      orgao_emissor: '',
      estado_civil: '',
      nacionalidade: '',
      naturalidade: '',
      uf: '',
      email: '',
      telefone: '',
      nome_pai: '',
      nome_mae: '',
      nome_conjuge: '',
      matricula: '',
      supervisao_id: '',
      campo_id: '',
      congregacao_id: '',
      cargo_ocupa: '',
      cargo_pretendido: '',
      pastor_solicitante: '',
      origem_instituicao: '',
      origem_cidade: '',
      origem_uf: '',
      origem_data_consagracao: '',
      data_autorizacao: '',
      status_processo: 'em_processo',
      observacoes: '',
      foto_url: '',
      // Endereço
      endereco: '',
      numero_endereco: '',
      bairro: '',
      complemento: '',
      cidade: '',
      uf_endereco: '',
      cep: '',
      // Formação e dados extras
      escolaridade: '',
      curso_teologico: '',
      cargo_anterior: '',
      mat_pr_solicitante: '',
      doc_pendente: false,
      data_registro: ''
    });
    setEditingRegistro(null);
    setMemberQuery('');
    setMemberResults([]);
    setMemberOpen(false);
    setFotoBloqueada(false);
  };

  // ─── CSV IMPORT ─────────────────────────────────────────────
  const parseCsvDate = (raw: string): string => {
    if (!raw) return '';
    // "Apr 1, 1978 12:00 am" or "Jan 10, 1980 12:00 am"
    const meses: Record<string, string> = {
      Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
      Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12'
    };
    const m = raw.match(/(\w+)\s+(\d+),\s*(\d{4})/);
    if (m) {
      const mes = meses[m[1]] || '01';
      const dia = m[2].padStart(2, '0');
      return `${m[3]}-${mes}-${dia}`;
    }
    // ISO or dd/mm/yyyy
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
    const dmy = raw.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
    if (dmy) return `${dmy[3]}-${dmy[2].padStart(2,'0')}-${dmy[1].padStart(2,'0')}`;
    return '';
  };

  const handleCsvConsagracao = (file: File) => {
    setCsvErro('');
    setCsvSucesso('');
    setCsvRows([]);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const lines = text.split(/\r?\n/).filter(l => l.trim());
        if (lines.length < 2) { setCsvErro('Arquivo vazio ou sem dados.'); return; }
        const sep = lines[0].includes(';') ? ';' : ',';
        const headers = lines[0].split(sep).map(h => h.trim().replace(/^"|"$/g, '').toUpperCase());
        const idx = (...names: string[]) => {
          for (const n of names) {
            const i = headers.findIndex(h => h.replace(/[\s_]+/g, ' ').includes(n.toUpperCase()));
            if (i >= 0) return i;
          }
          return -1;
        };
        const colNprocesso = idx('NPROCESSO', 'NUM PROCESSO', 'NUMERO PROCESSO');
        const colAno       = idx('ANO DO PROCESSO', 'ANO');
        const colNome      = idx('NOME CANDIDATO', 'NOME');
        const colCpf       = idx('CPF');
        const colRg        = idx('RG');
        const colSexo      = idx('SEXO');
        const colNasc      = idx('DNASCIMENTO', 'DATA NASCIMENTO', 'DATA DE NASCIMENTO');
        const colEstCivil  = idx('ESTADO CIVIL');
        const colMae       = idx('MÃE', 'MAE', 'NOME MAE');
        const colPai       = idx('PAI', 'NOME PAI');
        const colNat       = idx('NATURALIDADE');
        const colEmail     = idx('EMAIL');
        const colCelular   = idx('CELULAR', 'TELEFONE');
        const colMatricula = idx('MATRICULA');
        const colCargo     = idx('CARGO PR', 'CARGO PRETENDIDO');
        const colCargAnt   = idx('CARGO ANTERIOR');
        const colCampo     = idx('CAMPO');
        const colSup       = idx('SUPERVISAO', 'SUPERVISÃO');
        const colIndicacao = idx('INDICAÇÃO', 'INDICACAO');
        const colMatPr     = idx('MAT PR SOLICITANTE');
        const colCateg     = idx('CATEGORIA DO REGISTRO');
        const colRegiao    = idx('REGIÃO', 'REGIAO');
        const colStatus    = idx('STATUS');
        const colDataProc  = idx('DATA DO PROCESSO');
        const colDataReg   = idx('DATA DE REGISTRO', 'DATA REGISTRO');
        const colEndereco  = idx('ENDEREÇO', 'ENDERECO');
        const colNumEnd    = idx('NUM ENDEREÇO', 'NUM ENDERECO');
        const colCompl     = idx('COMPLEMENTO END', 'COMPLEMENTO');
        const colBairro    = idx('BAIRRO END', 'BAIRRO');
        const colCidade    = idx('CIDADE END', 'CIDADE');
        const colUfEnd     = idx('UF END');
        const colCep       = idx('CEP END', 'CEP');
        const colEscol     = idx('ESCOLARIDADE');
        const colCurso     = idx('CURSO TEOLOGICO', 'CURSO TEOLÓGICO');
        const colDoc       = idx('DOC PENDENTE');

        const rows: any[] = [];
        for (let i = 1; i < lines.length; i++) {
          const cols = lines[i].split(sep).map(c => c.trim().replace(/^"|"$/g, ''));
          if (cols.every(c => !c)) continue;
          const get = (ci: number) => ci >= 0 ? (cols[ci] || '') : '';
          const nome = get(colNome).toUpperCase();
          if (!nome) continue; // pula linhas sem nome
          const ano = get(colAno) || String(new Date().getFullYear());
          const nproc = get(colNprocesso);
          rows.push({
            numero_processo: nproc ? (nproc.includes('/') ? nproc : `${nproc}/${ano}`) : '',
            nome,
            cpf: get(colCpf),
            rg: get(colRg),
            sexo: get(colSexo).toUpperCase() || 'MASCULINO',
            data_nascimento: parseCsvDate(get(colNasc)),
            estado_civil: get(colEstCivil).toUpperCase(),
            nome_mae: get(colMae).toUpperCase(),
            nome_pai: get(colPai).toUpperCase(),
            naturalidade: get(colNat).toUpperCase(),
            email: get(colEmail).toLowerCase(),
            telefone: get(colCelular),
            matricula: get(colMatricula),
            cargo_pretendido: get(colCargo).toUpperCase(),
            cargo_anterior: get(colCargAnt).toUpperCase(),
            campo: get(colCampo),
            supervisao: get(colSup),
            pastor_solicitante: get(colIndicacao).toUpperCase(),
            mat_pr_solicitante: get(colMatPr),
            categoria_registro: get(colCateg).toUpperCase(),
            regiao: get(colRegiao).toUpperCase(),
            status_processo: (() => {
              const s = get(colStatus).toLowerCase();
              if (s.includes('deferido') && !s.includes('in')) return 'deferir';
              if (s.includes('indeferido')) return 'indeferir';
              if (s.includes('homolog')) return 'homologar';
              return 'em_processo';
            })(),
            data_processo: parseCsvDate(get(colDataProc)),
            data_registro: parseCsvDate(get(colDataReg)),
            endereco: get(colEndereco).toUpperCase(),
            numero_endereco: get(colNumEnd),
            complemento: get(colCompl).toUpperCase(),
            bairro: get(colBairro).toUpperCase(),
            cidade: get(colCidade).toUpperCase(),
            uf_endereco: get(colUfEnd).toUpperCase().slice(0, 2),
            cep: get(colCep),
            escolaridade: get(colEscol).toUpperCase(),
            curso_teologico: get(colCurso).toUpperCase(),
            doc_pendente: ['sim','yes','true','1'].includes(get(colDoc).toLowerCase()),
          });
        }
        setCsvRows(rows);
      } catch { setCsvErro('Erro ao ler o arquivo. Verifique o formato.'); }
    };
    reader.readAsText(file, 'UTF-8');
  };

  const handleImportarCsvConsagracao = async () => {
    if (csvRows.length === 0 || !ministryId) return;
    setImporting(true);
    setCsvErro('');
    setCsvSucesso('');
    let importados = 0;
    const erros: string[] = [];
    for (const row of csvRows) {
      const { campo, supervisao, categoria_registro, ...rest } = row;
      // Resolve campo_id / supervisao_id por nome (best-effort)
      const campoFound = campos.find(c => c.nome.toUpperCase() === (campo || '').toUpperCase());
      const supFound = supervisoes.find(s => s.nome.toUpperCase() === (supervisao || '').toUpperCase());
      const payload: Record<string, any> = {
        ...rest,
        // categoria_registro não é coluna do DB — mapeia para regiao (igual ao form)
        regiao: rest.regiao || categoria_registro || null,
        campo_id: campoFound?.id || null,
        supervisao_id: supFound?.id || campoFound?.supervisao_id || null,
        tipo_registro: 'chegada',
      };
      // Limpar strings vazias para null
      for (const k of Object.keys(payload)) {
        if (payload[k] === '') payload[k] = null;
      }
      const { error } = await supabase.from('consagracao_registros').insert(payload);
      if (error) erros.push(`${row.nome}: ${error.message}`);
      else importados++;
    }
    setImporting(false);
    if (erros.length > 0) setCsvErro(`${erros.length} erro(s): ${erros.slice(0, 3).join('; ')}`);
    if (importados > 0) {
      setCsvSucesso(`${importados} registro(s) importado(s) com sucesso!`);
      setCsvRows([]);
      if (csvInputRef.current) csvInputRef.current.value = '';
      loadInitialData();
    }
  };
  // ──────────────────────────────────────────────────────────────

  const ensureNumeroProcesso = async () => {
    if (editingRegistro) return;
    const next = await getNextProcessNumber();
    if (!next) return;
    setFormRegistro((prev) => ({ ...prev, numero_processo: next }));
  };

  const handleSelectMember = (member: Member) => {
    const cf = ((member as any).custom_fields || {}) as Record<string, any>;
    const fotoUrl = (member as any).foto_url || cf.fotoUrl || '';
    const cargoOcupa =
      (member as any).cargo_ministerial ||
      cf.cargoMinisterial ||
      (member as any).occupation ||
      cf.qualFuncao ||
      cf.cargo ||
      '';
    const processDate = new Date().toISOString().slice(0, 10);

    const normalizeText = (value: unknown) =>
      String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toUpperCase();

    const findOptionIdByName = (options: SimpleOption[], rawName: unknown) => {
      const target = normalizeText(rawName);
      if (!target) return '';
      const found = options.find((opt) => normalizeText(opt.nome) === target);
      return found?.id || '';
    };

    const memberSupervisaoIdRaw =
      String((member as any).supervisao_id || cf.supervisao_id || '') ||
      findOptionIdByName(
        supervisoes,
        (member as any).supervisao || cf.supervisao || cf.regional || cf.divisao3
      );

    const memberCampoIdRaw =
      String((member as any).campo_id || cf.campo_id || '') ||
      findOptionIdByName(
        campos,
        (member as any).campo || cf.campo || cf.setor || cf.divisao2
      );

    const memberCongregacaoIdRaw =
      String((member as any).congregacao_id || cf.congregacao_id || '') ||
      findOptionIdByName(
        congregacoes,
        (member as any).congregacao || cf.congregacao || cf.igreja || cf.divisao1
      );

    const campoFromId = campos.find((c) => c.id === memberCampoIdRaw) || null;
    const congregacaoFromId = congregacoes.find((c) => c.id === memberCongregacaoIdRaw) || null;
    const campoFromCongregacao = congregacaoFromId?.campo_id
      ? campos.find((c) => c.id === congregacaoFromId.campo_id) || null
      : null;

    const memberSupervisaoId =
      memberSupervisaoIdRaw ||
      campoFromId?.supervisao_id ||
      congregacaoFromId?.supervisao_id ||
      campoFromCongregacao?.supervisao_id ||
      '';

    const memberCampoId =
      memberCampoIdRaw ||
      congregacaoFromId?.campo_id ||
      '';

    const memberCongregacaoId = memberCongregacaoIdRaw || '';

    suppressNextSearchRef.current = true;
    setMemberQuery(member.name || (member as any).nome || '');
    setMemberOpen(false);
    setFotoBloqueada(Boolean(fotoUrl));
    setFieldErrors((prev) => {
      const next = { ...prev };
      delete next.nome;
      delete next.member_id;
      return next;
    });

    setFormRegistro((prev) => ({
      ...prev,
      member_id: member.id,
      nome: member.name || (member as any).nome || prev.nome,
      cpf: formatCpf((member as any).cpf || cf.cpf || prev.cpf || ''),
      data_nascimento: (member as any).birth_date || (member as any).data_nascimento || prev.data_nascimento,
      sexo: (member as any).gender || (member as any).sexo || prev.sexo,
      rg: (member as any).rg || cf.rg || prev.rg,
      estado_civil: (member as any).estado_civil || cf.estadoCivil || prev.estado_civil,
      nacionalidade: (member as any).nacionalidade || cf.nacionalidade || prev.nacionalidade,
      naturalidade: (member as any).naturalidade || cf.naturalidade || prev.naturalidade,
      uf: (member as any).uf || cf.uf || prev.uf,
      email: (member as any).email || cf.email || prev.email,
      telefone: formatPhone((member as any).celular || (member as any).phone || cf.celular || prev.telefone || ''),
      nome_pai: (member as any).nome_pai || cf.nomePai || prev.nome_pai,
      nome_mae: (member as any).nome_mae || cf.nomeMae || prev.nome_mae,
      nome_conjuge: (member as any).nome_conjuge || cf.nomeConjuge || prev.nome_conjuge,
      matricula: (member as any).matricula || cf.matricula || prev.matricula,
      data_processo: prev.data_processo || processDate,
      supervisao_id: memberSupervisaoId || '',
      campo_id: memberCampoId || '',
      congregacao_id: memberCongregacaoId || '',
      cargo_ocupa: cargoOcupa || prev.cargo_ocupa,
      pastor_solicitante: prev.pastor_solicitante,
      foto_url: fotoUrl || prev.foto_url
    }));
  };

  const syncMemberProgressStatus = async (
    memberId: string,
    processStatus: string,
    cargoPretendido: string,
    cargoOcupa: string
  ) => {
    if (!memberId) return;

    const { data: existingMember, error: existingMemberError } = await supabase
      .from('members')
      .select('custom_fields')
      .eq('id', memberId)
      .maybeSingle();

    if (existingMemberError) {
      console.error('Erro ao carregar membro para sincronizar status de consagração:', existingMemberError);
      return;
    }

    const currentCustomFields =
      existingMember?.custom_fields && typeof existingMember.custom_fields === 'object'
        ? (existingMember.custom_fields as Record<string, any>)
        : {};

    const nextCustomFields = {
      ...currentCustomFields,
      consagracaoStatus: processStatus === 'em_processo' ? 'em_processo' : null,
      consagracaoCargoPretendido: cargoPretendido || null,
      consagracaoCargoOcupado: cargoOcupa || null,
      consagracaoAtualizadoEm: new Date().toISOString(),
    };

    const { error: updateMemberError } = await supabase
      .from('members')
      .update({
        custom_fields: nextCustomFields,
        updated_at: new Date().toISOString(),
      } as any)
      .eq('id', memberId);

    if (updateMemberError) {
      console.error('Erro ao sincronizar status de consagração no membro:', updateMemberError);
    }
  };

  const handleSaveRegistro = async () => {
    if (!consagracaoModuleReady) {
      setStatusMensagem('Não foi possível salvar: a tabela de Consagração não existe no banco. Aplique as migrations do módulo.');
      return;
    }

    if (!ministryId) {
      setStatusMensagem('Erro ao salvar: ministério não identificado para este usuário. Recarregue a página ou verifique o vínculo de acesso.');
      return;
    }

    const tipoRegistro = normalizeTipoRegistro(formRegistro.tipo_registro);
    const nextErrors: Record<string, string> = {};

    if (!formRegistro.nome.trim()) {
      nextErrors.nome = 'Nome completo é obrigatório.';
    }

    if (!formRegistro.cargo_pretendido) {
      nextErrors.cargo_pretendido = 'Selecione o cargo pretendido.';
    }

    if (tipoRegistro === 'progressao') {
      if (!formRegistro.member_id) {
        nextErrors.member_id = 'Selecione um ministro da busca para progressão.';
      }
      if (!formRegistro.cargo_ocupa) {
        nextErrors.cargo_ocupa = 'Informe o cargo que ocupa.';
      }
    }

    if (tipoRegistro === 'filiacao' && !formRegistro.origem_instituicao.trim()) {
      nextErrors.origem_instituicao = 'Instituição de origem é obrigatória para filiação.';
    }

    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors(nextErrors);
      setStatusMensagem('Preencha os campos obrigatórios destacados em vermelho.');
      return;
    }

    setFieldErrors({});

    const payload = {
            member_id: tipoRegistro === 'progressao' ? formRegistro.member_id || null : null,
      tipo_registro: tipoRegistro,
      regiao: formRegistro.categoria_registro || null,
      numero_processo: formRegistro.numero_processo || null,
      data_processo: formRegistro.data_processo || null,
      cpf: formRegistro.cpf || null,
      nome: formRegistro.nome,
      data_nascimento: formRegistro.data_nascimento || null,
      sexo: formRegistro.sexo || null,
      rg: formRegistro.rg || null,
      orgao_emissor: formRegistro.orgao_emissor || null,
      estado_civil: formRegistro.estado_civil || null,
      nacionalidade: formRegistro.nacionalidade || null,
      naturalidade: formRegistro.naturalidade || null,
      uf: formRegistro.uf || null,
      email: formRegistro.email || null,
      telefone: formRegistro.telefone || null,
      nome_pai: formRegistro.nome_pai || null,
      nome_mae: formRegistro.nome_mae || null,
      nome_conjuge: formRegistro.nome_conjuge || null,
      matricula: formRegistro.matricula || null,
      supervisao_id: formRegistro.supervisao_id || null,
      campo_id: formRegistro.campo_id || null,
      congregacao_id: formRegistro.congregacao_id || null,
      cargo_ocupa: formRegistro.cargo_ocupa || null,
      cargo_pretendido: formRegistro.cargo_pretendido || null,
      pastor_solicitante: formRegistro.pastor_solicitante || null,
      origem_instituicao: formRegistro.origem_instituicao || null,
      origem_cidade: formRegistro.origem_cidade || null,
      origem_uf: formRegistro.origem_uf || null,
      origem_data_consagracao: formRegistro.origem_data_consagracao || null,
      data_autorizacao: formRegistro.data_autorizacao || null,
      status_processo: formRegistro.status_processo || 'em_processo',
      observacoes: formRegistro.observacoes || null,
      foto_url: formRegistro.foto_url || null,
      // Endereço
      endereco: formRegistro.endereco || null,
      numero_endereco: formRegistro.numero_endereco || null,
      bairro: formRegistro.bairro || null,
      complemento: formRegistro.complemento || null,
      cidade: formRegistro.cidade || null,
      uf_endereco: formRegistro.uf_endereco || null,
      cep: formRegistro.cep || null,
      // Formação e dados extras
      escolaridade: formRegistro.escolaridade || null,
      curso_teologico: formRegistro.curso_teologico || null,
      cargo_anterior: formRegistro.cargo_anterior || null,
      mat_pr_solicitante: formRegistro.mat_pr_solicitante || null,
      doc_pendente: formRegistro.doc_pendente ?? false,
      data_registro: formRegistro.data_registro || null
    };

    const normalizedPayload = normalizePayloadToUppercase(payload);
    if (typeof normalizedPayload.email === 'string') {
      normalizedPayload.email = normalizedPayload.email.toLowerCase();
    }

    if (editingRegistro) {
      const { error } = await supabase
        .from('consagracao_registros')
        .update({ ...normalizedPayload, updated_at: new Date().toISOString() })
        .eq('id', editingRegistro.id);
      if (error) {
        if (isConsagracaoTableMissing(error)) {
          setConsagracaoModuleReady(false);
          setStatusMensagem('Módulo Consagração indisponível: tabela public.consagracao_registros não encontrada. Aplique as migrations de Consagração no Supabase.');
          return;
        }
        setStatusMensagem(`Erro ao atualizar registro: ${error.message}`);
        return;
      }
    } else {
      const { error } = await supabase
        .from('consagracao_registros')
        .insert(normalizedPayload);
      if (error) {
        if (isConsagracaoTableMissing(error)) {
          setConsagracaoModuleReady(false);
          setStatusMensagem('Módulo Consagração indisponível: tabela public.consagracao_registros não encontrada. Aplique as migrations de Consagração no Supabase.');
          return;
        }
        setStatusMensagem(`Erro ao criar registro: ${error.message}`);
        return;
      }
    }

    if (tipoRegistro === 'progressao' && formRegistro.member_id) {
      await syncMemberProgressStatus(
        formRegistro.member_id,
        formRegistro.status_processo || 'em_processo',
        formRegistro.cargo_pretendido,
        formRegistro.cargo_ocupa
      );
    }

    setStatusMensagem('Registro salvo.');
    resetForm();
    setShowForm(false);
    await ensureNumeroProcesso();
    const { data, error } = await supabase
      .from('consagracao_registros')
      .select('*')
      .order('created_at', { ascending: false });
    if (!error && data) setRegistros(data);
  };

  const handleDeleteRegistro = async (id: string) => {
    if (!consagracaoModuleReady) {
      setStatusMensagem('Módulo Consagração indisponível: tabela de registros não encontrada no banco.');
      return;
    }

    const { error } = await supabase
      .from('consagracao_registros')
      .delete()
      .eq('id', id);
    if (error) {
      if (isConsagracaoTableMissing(error)) {
        setConsagracaoModuleReady(false);
        setStatusMensagem('Módulo Consagração indisponível: tabela public.consagracao_registros não encontrada. Aplique as migrations de Consagração no Supabase.');
        return;
      }
      setStatusMensagem('Erro ao remover registro.');
      return;
    }
    setRegistros((prev) => prev.filter((r) => r.id !== id));
  };

  const handleUpdateStatus = async (status: string) => {
    if (!consagracaoModuleReady) {
      setStatusMensagem('Módulo Consagração indisponível: tabela de registros não encontrada no banco.');
      return;
    }

    if (!processRegistro) return;
    const { error } = await supabase
      .from('consagracao_registros')
      .update({ status_processo: status, updated_at: new Date().toISOString() })
      .eq('id', processRegistro.id);
    if (error) {
      if (isConsagracaoTableMissing(error)) {
        setConsagracaoModuleReady(false);
        setStatusMensagem('Módulo Consagração indisponível: tabela public.consagracao_registros não encontrada. Aplique as migrations de Consagração no Supabase.');
        return;
      }
      setStatusMensagem('Erro ao atualizar status.');
      return;
    }
    setRegistros((prev) =>
      prev.map((r) => (r.id === processRegistro.id ? { ...r, status_processo: status } : r))
    );

    const tipoProcesso = normalizeTipoRegistro(processRegistro.tipo_registro || '');
    if (tipoProcesso === 'progressao' && processRegistro.member_id) {
      await syncMemberProgressStatus(
        processRegistro.member_id,
        status,
        processRegistro.cargo_pretendido || '',
        processRegistro.cargo_ocupa || ''
      );
    }

    setProcessModalOpen(false);
    setProcessRegistro(null);
  };

  if (loading || loadingData) return <div className="p-8">Carregando...</div>;

  const labelCongregacao = nomenclaturas?.divisaoPrincipal?.opcao1 || 'Congregação';
  const labelCampo = nomenclaturas?.divisaoSecundaria?.opcao1 || 'Campo';
  const labelSupervisao = nomenclaturas?.divisaoTerciaria?.opcao1 || 'Supervisão';

  const showCongregacao = labelCongregacao !== 'NENHUMA';
  const showCampo = labelCampo !== 'NENHUMA';
  const showSupervisao = labelSupervisao !== 'NENHUMA';

  const emProcessoCount = registros.filter((r) => r.status_processo === 'em_processo').length;
  const deferidosCount = registros.filter((r) => r.status_processo === 'deferir').length;
  const homologadosCount = registros.filter((r) => r.status_processo === 'homologar').length;
  const isProgressao = formRegistro.tipo_registro === 'progressao';
  const isFiliacao = formRegistro.tipo_registro === 'filiacao';
  const statusIsError = /(erro|preencha|obrigat|nao foi possivel|não foi possível)/i.test(statusMensagem);

  const registrosFiltrados = registros.filter(r => {
    if (filtroRegiao && r.regiao !== filtroRegiao) return false;
    if (filtroSupervisao && r.supervisao_id !== filtroSupervisao) return false;
    if (filtroCampo && r.campo_id !== filtroCampo) return false;
    if (filtroStatus && r.status_processo !== filtroStatus) return false;
    if (filtroBusca) {
      const q = filtroBusca.toLowerCase();
      return [(r.nome || ''), (r.cpf || ''), (r.numero_processo || ''), (r.cargo_pretendido || '')]
        .some(v => v.toLowerCase().includes(q));
    }
    return true;
  });

  return (
    <PageLayout
      title="Consagração"
      description="Separação de ministros: chegadas, progressão e filiação"
      activeMenu="consagracao"
    >
      <div className="w-full max-w-7xl mx-auto">

        {/* Abas */}
        <div className="mb-6 border-b border-gray-300">
          <div className="flex gap-4">
            <button
              onClick={() => setActiveTab('cadastro')}
              className={`px-6 py-3 font-semibold border-b-2 transition ${
                activeTab === 'cadastro'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-600 hover:text-gray-800'
              }`}
            >
              ➕ Cadastro de Processos
            </button>
            <button
              onClick={() => setActiveTab('registros')}
              className={`px-6 py-3 font-semibold border-b-2 transition ${
                activeTab === 'registros'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-600 hover:text-gray-800'
              }`}
            >
              📋 Registros ({registros.length})
            </button>
            <button
              onClick={() => setActiveTab('importar')}
              className={`px-6 py-3 font-semibold border-b-2 transition ${
                activeTab === 'importar'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-600 hover:text-gray-800'
              }`}
            >
              📥 Importar CSV
            </button>
          </div>
        </div>

        {/* Alerta global */}
        {statusMensagem && (
          <div className={`mb-4 px-4 py-3 rounded border text-sm ${statusIsError ? 'bg-red-50 border-red-200 text-red-700' : 'bg-blue-50 border-blue-200 text-blue-700'}`}>
            {statusMensagem}
          </div>
        )}

        {/* ABA: CADASTRO */}
        {activeTab === 'cadastro' && (
        <div className="bg-white rounded-lg shadow-md p-6">

          {/* Cabeçalho */}
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-bold text-gray-800">
              {editingRegistro ? 'Editar Registro' : 'Novo Registro de Processo'}
            </h2>
            <div className="flex items-center gap-3">
              {showForm && formRegistro.numero_processo && (
                <span className="inline-flex items-center px-3 py-1 bg-orange-400 text-white rounded font-bold text-sm">
                  {formRegistro.numero_processo}
                </span>
              )}
              {!showForm && (
                <button
                  className={`text-white px-4 py-2 rounded-lg transition shadow-md font-semibold ${consagracaoModuleReady ? 'bg-blue-600 hover:bg-blue-700' : 'bg-gray-400 cursor-not-allowed'}`}
                  onClick={async () => {
                    setStatusMensagem('');
                    resetForm();
                    const next = await getNextProcessNumber();
                    if (next) {
                      setFormRegistro((prev) => ({ ...prev, numero_processo: next }));
                    }
                    setShowForm(true);
                  }}
                  disabled={!consagracaoModuleReady}
                  title={!consagracaoModuleReady ? 'Aplique as migrations do módulo de Consagração no Supabase' : 'Novo Registro'}
                >
                  + Novo Registro
                </button>
              )}
            </div>
          </div>

          {!showForm && (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400">
              <span className="text-5xl mb-4">📋</span>
              <p className="text-sm">Clique em &quot;+ Novo Registro&quot; para iniciar um cadastro de processo.</p>
            </div>
          )}

          {showForm && (
              <div className="max-w-6xl mx-auto">
                <div className="grid grid-cols-1 lg:grid-cols-[2fr,1fr] gap-6">
                  <div className="space-y-4">
                    <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-4 space-y-4">
                      <h4 className="text-sm font-semibold text-teal-700 border-b border-gray-100 pb-2">Dados do Processo</h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[minmax(130px,auto)_1fr_1fr_1fr] gap-4 items-start">
                        <div>
                          <label className="block text-sm font-semibold text-gray-700 mb-1">Nº do Processo</label>
                          <input
                            className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg bg-gray-100 text-gray-600 font-bold focus:outline-none"
                            value={formRegistro.numero_processo}
                            readOnly
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-semibold text-gray-700 mb-1">Tipo de Registro</label>
                          <select
                            className="w-full px-3 py-2 border-2 border-teal-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                            value={formRegistro.tipo_registro}
                            onChange={(e) => {
                              const value = normalizeTipoRegistro(e.target.value);
                              setFormRegistro((prev) => {
                                const leavingProgressao = prev.tipo_registro === 'progressao' && value !== 'progressao';
                                return {
                                  ...prev,
                                  tipo_registro: value,
                                  member_id: value === 'progressao' ? prev.member_id : '',
                                  cargo_ocupa: value === 'progressao' ? prev.cargo_ocupa : '',
                                  origem_instituicao: value === 'filiacao' ? prev.origem_instituicao : '',
                                  origem_cidade: value === 'filiacao' ? prev.origem_cidade : '',
                                  origem_uf: value === 'filiacao' ? prev.origem_uf : '',
                                  origem_data_consagracao: value === 'filiacao' ? prev.origem_data_consagracao : '',
                                  foto_url: leavingProgressao ? '' : prev.foto_url
                                };
                              });
                              if (value !== 'progressao') {
                                setMemberQuery('');
                                setMemberResults([]);
                                setMemberOpen(false);
                                setFotoBloqueada(false);
                                setFieldErrors({});
                              }
                            }}
                          >
                            {TIPO_REGISTRO_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-semibold text-gray-700 mb-1">Categoria do Registro</label>
                          <select
                            className="w-full px-3 py-2 border-2 border-teal-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                            value={formRegistro.categoria_registro}
                            onChange={(e) => setFormRegistro({ ...formRegistro, categoria_registro: e.target.value })}
                          >
                            <option value="">Selecione</option>
                            {CATEGORIA_REGISTRO_OPTIONS.map((categoria) => (
                              <option key={categoria} value={categoria}>{categoria}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-semibold text-gray-700 mb-1">Região</label>
                          <div className="flex items-stretch gap-1">
                            <select
                              className="flex-1 min-w-0 px-3 py-2 border-2 border-teal-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                              value={regioesList.includes(formRegistro.categoria_registro) ? formRegistro.categoria_registro : ''}
                              onChange={(e) => {
                                if (e.target.value) setFormRegistro({ ...formRegistro, categoria_registro: e.target.value });
                              }}
                            >
                              <option value="">- Região -</option>
                              {regioesList.map((r) => (
                                <option key={r} value={r}>{r}</option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={() => setShowNovaRegiao(v => !v)}
                              className="flex-shrink-0 px-3 py-2 bg-teal-500 hover:bg-teal-600 text-white rounded-lg font-bold text-sm"
                              title="Adicionar nova região"
                            >+</button>
                          </div>
                          {showNovaRegiao && (
                            <div className="flex gap-1 mt-1">
                              <input
                                className="flex-1 px-2 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                placeholder="Nova região..."
                                value={novaRegiao}
                                onChange={e => setNovaRegiao(e.target.value.toUpperCase())}
                                onKeyDown={e => {
                                  if (e.key === 'Enter' && novaRegiao.trim()) {
                                    setRegioesList(prev => [...prev, novaRegiao.trim()]);
                                    setFormRegistro(prev => ({ ...prev, categoria_registro: novaRegiao.trim() }));
                                    setNovaRegiao('');
                                    setShowNovaRegiao(false);
                                  }
                                }}
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  if (!novaRegiao.trim()) return;
                                  setRegioesList(prev => [...prev, novaRegiao.trim()]);
                                  setFormRegistro(prev => ({ ...prev, categoria_registro: novaRegiao.trim() }));
                                  setNovaRegiao('');
                                  setShowNovaRegiao(false);
                                }}
                                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg"
                              >OK</button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-4 space-y-4">
                      <h4 className="text-sm font-semibold text-teal-700 border-b border-gray-100 pb-2">Dados Pessoais</h4>
                      <div className="grid grid-cols-1 gap-4">
                        <div className="relative">
                          <label className="block text-sm font-semibold text-gray-700 mb-1">Nome Completo</label>
                          <input
                            className={`mt-1 w-full px-3 py-2 border-2 rounded-lg focus:outline-none focus:ring-2 ${fieldErrors.nome || fieldErrors.member_id ? 'border-red-500 focus:ring-red-400' : 'border-teal-500 focus:ring-blue-500'}`}
                            value={formRegistro.nome}
                            autoComplete="off"
                            name="consagracao_nome_completo"
                            onChange={(e) => {
                              const value = e.target.value;
                              setFieldErrors((prev) => {
                                const next = { ...prev };
                                delete next.nome;
                                delete next.member_id;
                                return next;
                              });
                              setFormRegistro((prev) => ({
                                ...prev,
                                nome: value,
                                member_id: value !== prev.nome ? '' : prev.member_id,
                              }));
                              setMemberQuery(value);
                              if (!value) {
                                setMemberResults([]);
                                setMemberOpen(false);
                                setFotoBloqueada(false);
                              }
                            }}
                            placeholder="Digite o nome para buscar no cadastro (a partir de 3 letras)"
                          />
                          {memberOpen && memberResults.length > 0 && (
                            <div className="absolute z-20 mt-2 w-full bg-white border rounded-lg shadow-lg max-h-60 overflow-auto">
                              {memberResults.map((m) => (
                                <button
                                  key={m.id}
                                  type="button"
                                  onClick={() => handleSelectMember(m)}
                                  className="w-full px-4 py-2 text-left hover:bg-blue-50 text-sm"
                                >
                                  <div className="font-semibold text-gray-800">{m.name}</div>
                                  <div className="text-xs text-gray-500">CPF: {(m as any).cpf || '-'}</div>
                                </button>
                              ))}
                            </div>
                          )}
                          <p className="mt-1 text-xs text-gray-500">
                            Selecione um ministro para preenchimento automático, ou preencha manualmente.
                          </p>
                          {(fieldErrors.nome || fieldErrors.member_id) && (
                            <p className="mt-1 text-xs text-red-600">{fieldErrors.member_id || fieldErrors.nome}</p>
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                          <label className="block text-sm font-semibold text-gray-700 mb-1">CPF</label>
                          <input
                            className="mt-1 w-full px-3 py-2 border-2 border-teal-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                            value={formRegistro.cpf}
                            onChange={(e) => setFormRegistro({ ...formRegistro, cpf: formatCpf(e.target.value) })}
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-semibold text-gray-700 mb-1">Data de Nascimento</label>
                          <input
                            type="date"
                            className="mt-1 w-full px-3 py-2 border-2 border-teal-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                            value={formRegistro.data_nascimento}
                            onChange={(e) => setFormRegistro({ ...formRegistro, data_nascimento: e.target.value })}
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-semibold text-gray-700 mb-1">Sexo</label>
                          <select
                            className="mt-1 w-full px-3 py-2 border-2 border-teal-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                            value={formRegistro.sexo}
                            onChange={(e) => setFormRegistro({ ...formRegistro, sexo: e.target.value })}
                          >
                            <option value="MASCULINO">Masculino</option>
                            <option value="FEMININO">Feminino</option>
                          </select>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                          <label className="block text-sm font-semibold text-gray-700 mb-1">Filiação: Pai</label>
                          <input
                            className="mt-1 w-full px-3 py-2 border-2 border-teal-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                            value={formRegistro.nome_pai}
                            onChange={(e) => setFormRegistro({ ...formRegistro, nome_pai: e.target.value })}
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-semibold text-gray-700 mb-1">Filiação: Mãe</label>
                          <input
                            className="mt-1 w-full px-3 py-2 border-2 border-teal-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                            value={formRegistro.nome_mae}
                            onChange={(e) => setFormRegistro({ ...formRegistro, nome_mae: e.target.value })}
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-semibold text-gray-700 mb-1">Estado Civil</label>
                          <select
                            className="mt-1 w-full px-3 py-2 border-2 border-teal-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                            value={formRegistro.estado_civil}
                            onChange={(e) => setFormRegistro({ ...formRegistro, estado_civil: e.target.value })}
                          >
                            <option value="">Selecione</option>
                            <option value="SOLTEIRO">Solteiro(a)</option>
                            <option value="CASADO">Casado(a)</option>
                            <option value="DIVORCIADO">Divorciado(a)</option>
                            <option value="VIUVO">Viúvo(a)</option>
                            <option value="UNIAO ESTAVEL">União Estável</option>
                          </select>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="md:col-span-2">
                          <label className="block text-sm font-semibold text-gray-700 mb-1">RG / Órgão Emissor</label>
                          <div className="flex gap-2 mt-1">
                            <input
                              className="flex-1 px-3 py-2 border-2 border-teal-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                              value={formRegistro.rg}
                              onChange={(e) => setFormRegistro({ ...formRegistro, rg: e.target.value })}
                              placeholder="RG"
                            />
                            <input
                              className="w-36 px-3 py-2 border-2 border-teal-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                              value={formRegistro.orgao_emissor}
                              onChange={(e) => setFormRegistro({ ...formRegistro, orgao_emissor: e.target.value })}
                              placeholder="Órgão emissor"
                            />
                          </div>
                        </div>
                        <div>
                          <label className="block text-sm font-semibold text-gray-700 mb-1">Cônjuge</label>
                          <input
                            className="mt-1 w-full px-3 py-2 border-2 border-teal-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                            value={formRegistro.nome_conjuge}
                            onChange={(e) => setFormRegistro({ ...formRegistro, nome_conjuge: e.target.value })}
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                          <label className="block text-sm font-semibold text-gray-700 mb-1">Nacionalidade</label>
                          <input
                            className="mt-1 w-full px-3 py-2 border-2 border-teal-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                            value={formRegistro.nacionalidade}
                            onChange={(e) => setFormRegistro({ ...formRegistro, nacionalidade: e.target.value })}
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-semibold text-gray-700 mb-1">Naturalidade/UF</label>
                          <input
                            className="mt-1 w-full px-3 py-2 border-2 border-teal-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                            value={formRegistro.naturalidade}
                            onChange={(e) => setFormRegistro({ ...formRegistro, naturalidade: e.target.value })}
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-semibold text-gray-700 mb-1">Email</label>
                          <input
                            type="email"
                            className="mt-1 w-full px-3 py-2 border-2 border-teal-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                            value={formRegistro.email}
                            onChange={(e) => setFormRegistro({ ...formRegistro, email: e.target.value })}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Endereço */}
                    <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-4 space-y-4">
                      <h4 className="text-sm font-semibold text-teal-700 border-b border-gray-100 pb-2">Endereço</h4>
                      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto] gap-4">
                        <div>
                          <label className="block text-sm font-semibold text-gray-700 mb-1">Logradouro</label>
                          <input
                            className="w-full px-3 py-2 border-2 border-teal-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                            value={formRegistro.endereco}
                            onChange={(e) => setFormRegistro({ ...formRegistro, endereco: e.target.value })}
                            placeholder="Rua, Av., Travessa..."
                          />
                        </div>
                        <div className="w-24">
                          <label className="block text-sm font-semibold text-gray-700 mb-1">Número</label>
                          <input
                            className="w-full px-3 py-2 border-2 border-teal-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                            value={formRegistro.numero_endereco}
                            onChange={(e) => setFormRegistro({ ...formRegistro, numero_endereco: e.target.value })}
                            placeholder="Nº"
                          />
                        </div>
                        <div className="w-36">
                          <label className="block text-sm font-semibold text-gray-700 mb-1">Complemento</label>
                          <input
                            className="w-full px-3 py-2 border-2 border-teal-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                            value={formRegistro.complemento}
                            onChange={(e) => setFormRegistro({ ...formRegistro, complemento: e.target.value })}
                            placeholder="Apto, Bloco..."
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                        <div>
                          <label className="block text-sm font-semibold text-gray-700 mb-1">Bairro</label>
                          <input
                            className="w-full px-3 py-2 border-2 border-teal-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                            value={formRegistro.bairro}
                            onChange={(e) => setFormRegistro({ ...formRegistro, bairro: e.target.value })}
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-semibold text-gray-700 mb-1">Cidade</label>
                          <input
                            className="w-full px-3 py-2 border-2 border-teal-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                            value={formRegistro.cidade}
                            onChange={(e) => setFormRegistro({ ...formRegistro, cidade: e.target.value })}
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-semibold text-gray-700 mb-1">UF</label>
                          <input
                            className="w-full px-3 py-2 border-2 border-teal-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                            value={formRegistro.uf_endereco}
                            onChange={(e) => setFormRegistro({ ...formRegistro, uf_endereco: e.target.value.toUpperCase().slice(0, 2) })}
                            maxLength={2}
                            placeholder="PA"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-semibold text-gray-700 mb-1">CEP</label>
                          <input
                            className="w-full px-3 py-2 border-2 border-teal-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                            value={formRegistro.cep}
                            onChange={(e) => setFormRegistro({ ...formRegistro, cep: e.target.value })}
                            placeholder="00000-000"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-4 space-y-4">
                      <h4 className="text-sm font-semibold text-teal-700 border-b border-gray-100 pb-2">Contato e Estrutura Ministerial</h4>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                          <label className="block text-sm font-semibold text-gray-700 mb-1">Telefone</label>
                          <input
                            className="mt-1 w-full px-3 py-2 border-2 border-teal-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                            value={formRegistro.telefone}
                            onChange={(e) => setFormRegistro({ ...formRegistro, telefone: formatPhone(e.target.value) })}
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-semibold text-gray-700 mb-1">Matrícula</label>
                          <input
                            className="mt-1 w-full px-3 py-2 border-2 border-gray-300 rounded-lg bg-gray-50 text-gray-500"
                            value={formRegistro.matricula}
                            readOnly
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-semibold text-gray-700 mb-1">Data do Processo</label>
                          <input
                            type="date"
                            className="mt-1 w-full px-3 py-2 border-2 border-teal-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                            value={formRegistro.data_processo}
                            onChange={(e) => setFormRegistro({ ...formRegistro, data_processo: e.target.value })}
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="md:col-span-2">
                          <label className="block text-sm font-semibold text-gray-700 mb-1">Indicação</label>
                          <input
                            className="mt-1 w-full px-3 py-2 border-2 border-teal-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                            value={formRegistro.pastor_solicitante}
                            onChange={(e) => setFormRegistro({ ...formRegistro, pastor_solicitante: e.target.value })}
                            placeholder="Nome do pastor que indica o ministro"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-semibold text-gray-700 mb-1">Supervisão</label>
                          <select
                            className="mt-1 w-full px-3 py-2 border-2 border-teal-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                            value={formRegistro.supervisao_id}
                            onChange={(e) => { setFormRegistro({ ...formRegistro, supervisao_id: e.target.value, campo_id: '' }); }}
                          >
                            <option value="">Selecione</option>
                            {supervisoes.map((s) => (
                              <option key={s.id} value={s.id}>{s.nome}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-semibold text-gray-700 mb-1">Campo</label>
                          <select
                            className="mt-1 w-full px-3 py-2 border-2 border-teal-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                            value={formRegistro.campo_id}
                            onChange={(e) => setFormRegistro({ ...formRegistro, campo_id: e.target.value })}
                          >
                            <option value="">Selecione</option>
                            {campos
                              .filter(c => !formRegistro.supervisao_id || c.supervisao_id === formRegistro.supervisao_id)
                              .map((c) => (
                                <option key={c.id} value={c.id}>{c.nome}</option>
                              ))}
                          </select>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                          <label className="block text-sm font-semibold text-gray-700 mb-1">Cargo que ocupa</label>
                          {isProgressao ? (
                            <select
                              className={`mt-1 w-full px-3 py-2 border-2 rounded-lg focus:outline-none focus:ring-2 ${fieldErrors.cargo_ocupa ? 'border-red-500 focus:ring-red-400' : 'border-teal-500 focus:ring-blue-500'}`}
                              value={formRegistro.cargo_ocupa}
                              onChange={(e) => {
                                setFieldErrors((prev) => {
                                  const next = { ...prev };
                                  delete next.cargo_ocupa;
                                  return next;
                                });
                                setFormRegistro({ ...formRegistro, cargo_ocupa: e.target.value });
                              }}
                            >
                              <option value="">Selecione</option>
                              {cargosMinisteriais.filter((c) => c.ativo).map((cargo) => (
                                <option key={cargo.id} value={cargo.nome}>{cargo.nome}</option>
                              ))}
                            </select>
                          ) : (
                            <input
                              className="mt-1 w-full px-3 py-2 border-2 border-gray-300 rounded-lg bg-gray-50 text-gray-500"
                              value="Não se aplica"
                              readOnly
                            />
                          )}
                          {isProgressao && fieldErrors.cargo_ocupa && (
                            <p className="mt-1 text-xs text-red-600">{fieldErrors.cargo_ocupa}</p>
                          )}
                        </div>
                        <div>
                          <label className="block text-sm font-semibold text-gray-700 mb-1">Cargo pretendido</label>
                          <select
                            className={`mt-1 w-full px-3 py-2 border-2 rounded-lg focus:outline-none focus:ring-2 ${fieldErrors.cargo_pretendido ? 'border-red-500 focus:ring-red-400' : 'border-teal-500 focus:ring-blue-500'}`}
                            value={formRegistro.cargo_pretendido}
                            onChange={(e) => {
                              setFieldErrors((prev) => {
                                const next = { ...prev };
                                delete next.cargo_pretendido;
                                return next;
                              });
                              setFormRegistro({ ...formRegistro, cargo_pretendido: e.target.value });
                            }}
                          >
                            <option value="">Selecione</option>
                            {cargosMinisteriais.filter((c) => c.ativo).map((cargo) => (
                              <option key={cargo.id} value={cargo.nome}>{cargo.nome}</option>
                            ))}
                          </select>
                          {fieldErrors.cargo_pretendido && (
                            <p className="mt-1 text-xs text-red-600">{fieldErrors.cargo_pretendido}</p>
                          )}
                        </div>
                      </div>
                    </div>

                    {isFiliacao && (
                      <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 space-y-4 shadow-sm">
                        <h4 className="text-sm font-semibold text-amber-900 border-b border-amber-200 pb-2">Dados de Origem para Filiação</h4>
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                          <div className="md:col-span-2">
                            <label className="block text-sm font-semibold text-gray-700 mb-1">Instituição de origem *</label>
                            <input
                              className={`mt-1 w-full px-3 py-2 border-2 rounded-lg focus:outline-none focus:ring-2 ${fieldErrors.origem_instituicao ? 'border-red-500 focus:ring-red-400' : 'border-amber-400 focus:ring-amber-500'}`}
                              value={formRegistro.origem_instituicao}
                              onChange={(e) => {
                                setFieldErrors((prev) => {
                                  const next = { ...prev };
                                  delete next.origem_instituicao;
                                  return next;
                                });
                                setFormRegistro({ ...formRegistro, origem_instituicao: e.target.value });
                              }}
                            />
                            {fieldErrors.origem_instituicao && (
                              <p className="mt-1 text-xs text-red-600">{fieldErrors.origem_instituicao}</p>
                            )}
                          </div>
                          <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-1">Cidade de origem</label>
                            <input
                              className="mt-1 w-full px-3 py-2 border-2 border-amber-400 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                              value={formRegistro.origem_cidade}
                              onChange={(e) => setFormRegistro({ ...formRegistro, origem_cidade: e.target.value })}
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-1">UF de origem</label>
                            <input
                              className="mt-1 w-full px-3 py-2 border-2 border-amber-400 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                              value={formRegistro.origem_uf}
                              onChange={(e) => setFormRegistro({ ...formRegistro, origem_uf: e.target.value.toUpperCase().slice(0, 2) })}
                              maxLength={2}
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-1">Data da consagração de origem</label>
                            <input
                              type="date"
                              className="mt-1 w-full px-3 py-2 border-2 border-amber-400 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                              value={formRegistro.origem_data_consagracao}
                              onChange={(e) => setFormRegistro({ ...formRegistro, origem_data_consagracao: e.target.value })}
                            />
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Formação e Dados Complementares */}
                    <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-4 space-y-4">
                      <h4 className="text-sm font-semibold text-teal-700 border-b border-gray-100 pb-2">Formação e Dados Complementares</h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                        <div>
                          <label className="block text-sm font-semibold text-gray-700 mb-1">Escolaridade</label>
                          <select
                            className="w-full px-3 py-2 border-2 border-teal-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                            value={formRegistro.escolaridade}
                            onChange={(e) => setFormRegistro({ ...formRegistro, escolaridade: e.target.value })}
                          >
                            <option value="">Selecione</option>
                            {['FUNDAMENTAL INCOMPLETO','FUNDAMENTAL COMPLETO','MÉDIO INCOMPLETO','MÉDIO COMPLETO','SUPERIOR INCOMPLETO','SUPERIOR COMPLETO','PÓS-GRADUAÇÃO','MESTRADO','DOUTORADO'].map(e => (
                              <option key={e} value={e}>{e}</option>
                            ))}
                          </select>
                        </div>
                        <div className="md:col-span-2">
                          <label className="block text-sm font-semibold text-gray-700 mb-1">Curso Teológico</label>
                          <input
                            className="w-full px-3 py-2 border-2 border-teal-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                            value={formRegistro.curso_teologico}
                            onChange={(e) => setFormRegistro({ ...formRegistro, curso_teologico: e.target.value })}
                            placeholder="Nome da instituição / curso"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-semibold text-gray-700 mb-1">Data de Registro</label>
                          <input
                            type="date"
                            className="w-full px-3 py-2 border-2 border-teal-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                            value={formRegistro.data_registro}
                            onChange={(e) => setFormRegistro({ ...formRegistro, data_registro: e.target.value })}
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                        <div>
                          <label className="block text-sm font-semibold text-gray-700 mb-1">Cargo Anterior</label>
                          <input
                            className="w-full px-3 py-2 border-2 border-teal-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                            value={formRegistro.cargo_anterior}
                            onChange={(e) => setFormRegistro({ ...formRegistro, cargo_anterior: e.target.value })}
                            placeholder="Cargo exercido anteriormente"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-semibold text-gray-700 mb-1">Matrícula do Solicitante (Pastor)</label>
                          <input
                            className="w-full px-3 py-2 border-2 border-teal-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                            value={formRegistro.mat_pr_solicitante}
                            onChange={(e) => setFormRegistro({ ...formRegistro, mat_pr_solicitante: e.target.value })}
                            placeholder="Matrícula do pastor indicante"
                          />
                        </div>
                        <div className="flex items-center gap-3 pt-6">
                          <input
                            id="doc_pendente"
                            type="checkbox"
                            className="w-4 h-4 accent-teal-500 cursor-pointer"
                            checked={formRegistro.doc_pendente}
                            onChange={(e) => setFormRegistro({ ...formRegistro, doc_pendente: e.target.checked })}
                          />
                          <label htmlFor="doc_pendente" className="text-sm font-semibold text-gray-700 cursor-pointer">
                            Documentação Pendente?
                          </label>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-4 space-y-4">
                      <h4 className="text-sm font-semibold text-teal-700 border-b border-gray-100 pb-2">Andamento e Observações</h4>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                          <label className="block text-sm font-semibold text-gray-700 mb-1">Data Autorização</label>
                          <input
                            type="date"
                            className="mt-1 w-full px-3 py-2 border-2 border-teal-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                            value={formRegistro.data_autorizacao}
                            onChange={(e) => setFormRegistro({ ...formRegistro, data_autorizacao: e.target.value })}
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-semibold text-gray-700 mb-1">Status do Processo</label>
                          <select
                            className="mt-1 w-full px-3 py-2 border-2 border-teal-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                            value={formRegistro.status_processo}
                            onChange={(e) => setFormRegistro({ ...formRegistro, status_processo: e.target.value })}
                          >
                            <option value="em_processo">Em Processo</option>
                            <option value="deferir">Deferido</option>
                            <option value="indeferir">Indeferido</option>
                            <option value="homologar">Homologado</option>
                          </select>
                        </div>
                      </div>

                      <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-1">Observações</label>
                        <textarea
                          className="mt-1 w-full px-3 py-2 border-2 border-teal-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                          rows={3}
                          value={formRegistro.observacoes}
                          onChange={(e) => setFormRegistro({ ...formRegistro, observacoes: e.target.value })}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-4">
                      <h4 className="text-sm font-semibold text-teal-700 border-b border-gray-100 pb-2 mb-3">Foto do Candidato</h4>
                      <div className="w-full h-48 rounded border-2 border-dashed border-gray-300 flex items-center justify-center bg-white">
                        {formRegistro.foto_url ? (
                          <img src={formRegistro.foto_url} alt="Foto" className="max-h-44 object-contain" />
                        ) : (
                          <span className="text-xs text-gray-500">Sem foto</span>
                        )}
                      </div>
                      <div className="mt-3 space-y-2">
                        <button
                          className={`w-full px-3 py-2 rounded-lg text-sm font-semibold ${
                            fotoBloqueada
                              ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                              : 'bg-teal-500 text-white hover:bg-teal-600'
                          }`}
                          onClick={() => !fotoBloqueada && fileInputRef.current?.click()}
                          disabled={fotoBloqueada}
                        >
                          {fotoBloqueada ? 'Foto já cadastrada' : 'Abrir Foto'}
                        </button>
                        {!fotoBloqueada && formRegistro.foto_url && (
                          <button
                            className="w-full px-3 py-2 rounded-lg text-sm font-semibold bg-red-100 text-red-700 hover:bg-red-200"
                            onClick={() => setFormRegistro((prev) => ({ ...prev, foto_url: '' }))}
                          >
                            Remover Foto
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex gap-3 justify-end mt-6">
                  <button
                    className="px-4 py-2 rounded-lg border-2 border-gray-300 text-gray-600 hover:text-gray-800"
                    onClick={() => {
                      resetForm();
                      setShowForm(false);
                    }}
                  >
                    Cancelar
                  </button>
                  <button
                    className={`px-4 py-2 rounded-lg text-white font-semibold transition shadow-md ${ministryId && consagracaoModuleReady ? 'bg-teal-500 hover:bg-teal-600' : 'bg-gray-400 cursor-not-allowed'}`}
                    onClick={handleSaveRegistro}
                    disabled={!ministryId || !consagracaoModuleReady}
                    title={!consagracaoModuleReady ? 'Aplique as migrations do módulo de Consagração no Supabase' : (!ministryId ? 'Sem ministério associado ao usuário' : 'Salvar registro')}
                  >
                    Salvar
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ABA: REGISTROS */}
        {activeTab === 'registros' && (
        <div className="space-y-4">

          {/* Cards resumo */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white p-4 rounded-lg shadow border-l-4 border-teal-500">
              <p className="text-gray-600 text-sm">Em Processo</p>
              <p className="text-2xl font-bold text-teal-700">{emProcessoCount}</p>
            </div>
            <div className="bg-white p-4 rounded-lg shadow border-l-4 border-green-500">
              <p className="text-gray-600 text-sm">Deferidos</p>
              <p className="text-2xl font-bold text-green-600">{deferidosCount}</p>
            </div>
            <div className="bg-white p-4 rounded-lg shadow border-l-4 border-purple-500">
              <p className="text-gray-600 text-sm">Homologados</p>
              <p className="text-2xl font-bold text-purple-600">{homologadosCount}</p>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-md p-6">

            {/* Filtros */}
            <div className="flex flex-wrap items-center gap-3 mb-5">
              {/* Região/Categoria */}
              <select
                value={filtroRegiao}
                onChange={e => setFiltroRegiao(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Todas as Categorias</option>
                {CATEGORIA_REGISTRO_OPTIONS.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>

              {/* Supervisão */}
              {showSupervisao && (
                <select
                  value={filtroSupervisao}
                  onChange={e => setFiltroSupervisao(e.target.value)}
                  className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Todas as Supervisões</option>
                  {supervisoes.map(s => (
                    <option key={s.id} value={s.id}>{s.nome}</option>
                  ))}
                </select>
              )}

              {/* Campo */}
              {showCampo && (
                <select
                  value={filtroCampo}
                  onChange={e => setFiltroCampo(e.target.value)}
                  className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Todos os Campos</option>
                  {campos
                    .filter(c => !filtroSupervisao || c.supervisao_id === filtroSupervisao)
                    .map(c => (
                      <option key={c.id} value={c.id}>{c.nome}</option>
                    ))}
                </select>
              )}

              {/* Status */}
              <select
                value={filtroStatus}
                onChange={e => setFiltroStatus(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Todos os Status</option>
                <option value="em_processo">Em Processo</option>
                <option value="deferir">Deferido</option>
                <option value="indeferir">Indeferido</option>
                <option value="homologar">Homologado</option>
              </select>

              {/* Busca */}
              <input
                type="text"
                placeholder="Buscar por nome, CPF ou processo..."
                value={filtroBusca}
                onChange={e => setFiltroBusca(e.target.value)}
                className="flex-1 min-w-[200px] border border-gray-300 rounded-lg px-4 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />

              <button
                onClick={() => { setFiltroRegiao(''); setFiltroSupervisao(''); setFiltroCampo(''); setFiltroBusca(''); setFiltroStatus(''); }}
                className="px-4 py-1.5 bg-gray-200 hover:bg-gray-300 text-gray-700 text-sm font-semibold rounded-lg transition"
              >
                Limpar
              </button>

              <span className="text-sm text-gray-500 font-medium ml-auto">
                {registrosFiltrados.length} registro(s)
              </span>
            </div>

            {/* Tabela */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="px-3 py-3 text-left font-semibold bg-gray-200 text-gray-800 w-12">Foto</th>
                    <th className="px-3 py-3 text-left font-semibold bg-gray-200 text-gray-800 whitespace-nowrap">Nº Processo</th>
                    <th className="px-3 py-3 text-left font-semibold bg-gray-200 text-gray-800 whitespace-nowrap">Data Proc.</th>
                    <th className="px-3 py-3 text-left font-semibold bg-gray-200 text-gray-800">Nome</th>
                    <th className="px-3 py-3 text-left font-semibold bg-gray-200 text-gray-800">CPF</th>
                    <th className="px-3 py-3 text-left font-semibold bg-gray-200 text-gray-800">Categoria</th>
                    <th className="px-3 py-3 text-left font-semibold bg-gray-200 text-gray-800">Tipo</th>
                    <th className="px-3 py-3 text-left font-semibold bg-gray-200 text-gray-800">Status</th>
                    <th className="px-3 py-3 text-right font-semibold bg-gray-200 text-gray-800">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {registrosFiltrados.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-4 py-8 text-center text-gray-500">Nenhum registro encontrado.</td>
                    </tr>
                  )}
                  {registrosFiltrados.map((reg) => (
                    <tr key={reg.id} className="border-b border-gray-200 hover:bg-gray-50">
                      <td className="px-3 py-2">
                        <div className="w-9 h-9 rounded-full overflow-hidden border border-gray-200 bg-gray-100 flex items-center justify-center">
                          {reg.foto_url ? (
                            <img src={reg.foto_url} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <span className="text-[8px] text-gray-400 text-center leading-tight">SEM FOTO</span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-xs font-bold text-gray-700 whitespace-nowrap">{reg.numero_processo || '—'}</td>
                      <td className="px-3 py-2 text-xs text-gray-700 whitespace-nowrap">{reg.data_processo ? new Date(reg.data_processo + 'T00:00:00').toLocaleDateString('pt-BR') : '—'}</td>
                      <td className="px-3 py-2 text-xs font-semibold text-gray-800 uppercase">{reg.nome}</td>
                      <td className="px-3 py-2 text-xs text-gray-600">{reg.cpf || '—'}</td>
                      <td className="px-3 py-2 text-xs text-gray-600">{reg.regiao || '—'}</td>
                      <td className="px-3 py-2 text-xs text-gray-600">{TIPO_REGISTRO_LABELS[reg.tipo_registro] || reg.tipo_registro || '—'}</td>
                      <td className="px-3 py-2">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                          reg.status_processo === 'em_processo' ? 'bg-teal-100 text-teal-700' :
                          reg.status_processo === 'deferir' ? 'bg-green-100 text-green-700' :
                          reg.status_processo === 'indeferir' ? 'bg-red-100 text-red-700' :
                          reg.status_processo === 'homologar' ? 'bg-purple-100 text-purple-700' :
                          'bg-gray-100 text-gray-600'
                        }`}>
                          {STATUS_LABELS[reg.status_processo] || reg.status_processo}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            className="px-2 py-1 bg-blue-50 text-blue-700 rounded hover:bg-blue-100 transition text-xs font-semibold"
                            onClick={() => {
                              setEditingRegistro(reg);
                              setFormRegistro({
                                tipo_registro: normalizeTipoRegistro(reg.tipo_registro || ''),
                                categoria_registro: reg.regiao || '',
                                member_id: reg.member_id || '',
                                numero_processo: reg.numero_processo || '',
                                data_processo: reg.data_processo || '',
                                nome: reg.nome || '',
                                data_nascimento: reg.data_nascimento || '',
                                sexo: reg.sexo || 'MASCULINO',
                                rg: reg.rg || '',
                                orgao_emissor: reg.orgao_emissor || '',
                                estado_civil: reg.estado_civil || '',
                                nacionalidade: reg.nacionalidade || '',
                                naturalidade: reg.naturalidade || '',
                                uf: reg.uf || '',
                                email: reg.email || '',
                                cpf: reg.cpf ? formatCpf(reg.cpf) : '',
                                telefone: reg.telefone ? formatPhone(reg.telefone) : '',
                                nome_pai: reg.nome_pai || '',
                                nome_mae: reg.nome_mae || '',
                                nome_conjuge: reg.nome_conjuge || '',
                                matricula: reg.matricula || '',
                                supervisao_id: reg.supervisao_id || '',
                                campo_id: reg.campo_id || '',
                                congregacao_id: reg.congregacao_id || '',
                                cargo_ocupa: reg.cargo_ocupa || '',
                                cargo_pretendido: reg.cargo_pretendido || '',
                                pastor_solicitante: reg.pastor_solicitante || '',
                                origem_instituicao: reg.origem_instituicao || '',
                                origem_cidade: reg.origem_cidade || '',
                                origem_uf: reg.origem_uf || '',
                                origem_data_consagracao: reg.origem_data_consagracao || '',
                                data_autorizacao: reg.data_autorizacao || '',
                                status_processo: reg.status_processo || 'em_processo',
                                observacoes: reg.observacoes || '',
                                foto_url: reg.foto_url || '',
                                // Endereço
                                endereco: reg.endereco || '',
                                numero_endereco: reg.numero_endereco || '',
                                bairro: reg.bairro || '',
                                complemento: reg.complemento || '',
                                cidade: reg.cidade || '',
                                uf_endereco: reg.uf_endereco || '',
                                cep: reg.cep || '',
                                // Formação e dados extras
                                escolaridade: reg.escolaridade || '',
                                curso_teologico: reg.curso_teologico || '',
                                cargo_anterior: reg.cargo_anterior || '',
                                mat_pr_solicitante: reg.mat_pr_solicitante || '',
                                doc_pendente: reg.doc_pendente ?? false,
                                data_registro: reg.data_registro || ''
                              });
                              setShowForm(true);
                              setActiveTab('cadastro');
                            }}
                          >
                            Editar
                          </button>
                          <button
                            className="px-2 py-1 bg-emerald-50 text-emerald-700 rounded hover:bg-emerald-100 transition text-xs font-semibold"
                            onClick={() => {
                              setProcessRegistro(reg);
                              setProcessModalOpen(true);
                            }}
                          >
                            Processar
                          </button>
                          <button
                            className="px-2 py-1 bg-red-50 text-red-700 rounded hover:bg-red-100 transition text-xs font-semibold"
                            onClick={() => handleDeleteRegistro(reg.id)}
                          >
                            Excluir
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
        )}

        {/* ABA: IMPORTAR CSV */}
        {activeTab === 'importar' && (
        <div className="bg-white rounded-lg shadow-md p-6 space-y-4">
          <h2 className="text-lg font-bold text-gray-800">Importar CSV de Consagração</h2>
          <p className="text-xs text-gray-500 leading-relaxed">
            Colunas reconhecidas (case-insensitive, separador <strong>;</strong> ou <strong>,</strong>):<br />
            <span className="font-mono">
              NPROCESSO, ANO DO PROCESSO, NOME CANDIDATO, CPF, RG, SEXO, DNASCIMENTO, ESTADO CIVIL, MAE, PAI, NATURALIDADE, EMAIL, CELULAR, MATRICULA,
              CARGO PR, CARGO ANTERIOR, MAT PR SOLICITANTE, CAMPO, SUPERVISAO, INDICAÇÃO, CATEGORIA DO REGISTRO, REGIÃO, STATUS,
              DATA DO PROCESSO, DATA DE REGISTRO, ENDEREÇO, NUM ENDEREÇO, COMPLEMENTO END, BAIRRO END, CIDADE END, UF END, CEP END,
              ESCOLARIDADE, CURSO TEOLOGICO, DOC PENDENTE
            </span>
          </p>
          <div
            className="border-2 border-dashed border-gray-300 rounded-lg p-10 text-center cursor-pointer hover:border-blue-400 transition-colors"
            onClick={() => csvInputRef.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleCsvConsagracao(f); }}
          >
            <p className="text-gray-400 text-3xl mb-2">📂</p>
            <p className="text-gray-500 text-sm">Clique ou arraste o arquivo CSV aqui</p>
            <input
              ref={csvInputRef}
              type="file"
              accept=".csv,.txt"
              className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleCsvConsagracao(f); }}
            />
          </div>
          {csvErro && <p className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-4 py-3">{csvErro}</p>}
          {csvSucesso && <p className="text-green-700 text-sm bg-green-50 border border-green-200 rounded-lg px-4 py-3">{csvSucesso}</p>}
          {csvRows.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-gray-700">{csvRows.length} registro(s) lidos — pré-visualização:</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => { setCsvRows([]); setCsvErro(''); setCsvSucesso(''); if (csvInputRef.current) csvInputRef.current.value = ''; }}
                    className="px-4 py-1.5 text-sm border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 transition"
                  >Cancelar</button>
                  <button
                    onClick={handleImportarCsvConsagracao}
                    disabled={importing}
                    className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition disabled:opacity-60"
                  >
                    {importing ? 'Importando...' : `Importar ${csvRows.length} registros`}
                  </button>
                </div>
              </div>
              <div className="overflow-x-auto max-h-80 border border-gray-200 rounded-lg">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-200">
                      {['Nº Processo','Nome','CPF','RG','Status','Categoria','Região','Campo','Supervisão','Cargo Pretendido'].map(h => (
                        <th key={h} className="px-3 py-2 text-left font-semibold text-gray-800 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {csvRows.map((r, i) => (
                      <tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="px-3 py-2 font-bold text-gray-700 whitespace-nowrap">{r.numero_processo || '—'}</td>
                        <td className="px-3 py-2 text-gray-700">{r.nome || '—'}</td>
                        <td className="px-3 py-2 text-gray-500">{r.cpf || '—'}</td>
                        <td className="px-3 py-2 text-gray-500">{r.rg || '—'}</td>
                        <td className="px-3 py-2">
                          <span className={`px-1.5 py-0.5 rounded text-xs font-semibold ${
                            r.status_processo === 'deferir' ? 'bg-green-100 text-green-700' :
                            r.status_processo === 'indeferir' ? 'bg-red-100 text-red-700' :
                            r.status_processo === 'homologar' ? 'bg-purple-100 text-purple-700' :
                            'bg-yellow-100 text-yellow-700'
                          }`}>{r.status_processo}</span>
                        </td>
                        <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{r.categoria_registro || '—'}</td>
                        <td className="px-3 py-2 text-gray-500">{r.regiao || '—'}</td>
                        <td className="px-3 py-2 text-gray-500">{r.campo || '—'}</td>
                        <td className="px-3 py-2 text-gray-500">{r.supervisao || '—'}</td>
                        <td className="px-3 py-2 text-gray-500">{r.cargo_pretendido || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFotoUpload}
      />

      {processModalOpen && processRegistro && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-800">Alterar Registro - Processos</h3>
              <button
                className="text-gray-500 hover:text-gray-800"
                onClick={() => setProcessModalOpen(false)}
              >
                X
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button
                className="px-4 py-3 bg-green-100 text-green-700 rounded-lg font-semibold hover:bg-green-200"
                onClick={() => handleUpdateStatus('deferir')}
              >
                Deferir
              </button>
              <button
                className="px-4 py-3 bg-red-100 text-red-700 rounded-lg font-semibold hover:bg-red-200"
                onClick={() => handleUpdateStatus('indeferir')}
              >
                Indeferir
              </button>
              <button
                className="px-4 py-3 bg-blue-100 text-blue-700 rounded-lg font-semibold hover:bg-blue-200"
                onClick={() => handleUpdateStatus('em_processo')}
              >
                Em Processo
              </button>
              <button
                className="px-4 py-3 bg-emerald-100 text-emerald-700 rounded-lg font-semibold hover:bg-emerald-200"
                onClick={() => handleUpdateStatus('homologar')}
              >
                Homologar
              </button>
            </div>
          </div>
        </div>
      )}
    </PageLayout>
  );
}

