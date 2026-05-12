'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import PageLayout from '@/components/PageLayout';
import Tabs from '@/components/Tabs';
import Section from '@/components/Section';
import { createClient } from '@/lib/supabase-client';
import { loadOrgNomenclaturasFromSupabaseOrMigrate } from '@/lib/org-nomenclaturas';
import { useAppDialog } from '@/providers/AppDialogProvider';
import { buildUrl, getAppBaseUrl } from '@/lib/urls';
import { authenticatedFetch } from '@/lib/api-client';

interface Divisao1 {
  id: string;
  codigo?: number | null;
  nome: string;
  uf?: string | null;
  supervisao_id?: string;
  supervisor_member_id?: string | null;
  supervisor_matricula?: string | null;
  supervisor_nome?: string | null;
  supervisor_cpf?: string | null;
  supervisor_data_nascimento?: string | null;
  supervisor_cargo?: string | null;
  supervisor_celular?: string | null;
  is_active: boolean;
  created_at: string;
}

interface Divisao2 {
  id: string;
  supervisao_id?: string | null;
  nome: string;
  is_sede: boolean;
  data_fundacao?: string | null;
  cnpj?: string | null;
  email?: string | null;
  telefone?: string | null;
  observacoes?: string | null;
  logomarca_url?: string | null;
  endereco?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  cep?: string | null;
  uf?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  pastor_member_id?: string | null;
  pastor_nome?: string | null;
  pastor_data_posse?: string | null;
  is_active: boolean;
  created_at: string;
}

interface Divisao3 {
  id: string;
  ministry_id?: string;
  supervisao_id?: string | null;
  campo_id?: string | null;
  nome: string;
  dirigente?: string | null;
  dirigente_cpf?: string | null;
  dirigente_cargo?: string | null;
  dirigente_matricula?: string | null;
  endereco?: string | null;
  cidade?: string | null;
  uf?: string | null;
  cep?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  status_imovel?: 'PROPRIO' | 'ALUGADO' | 'CEDIDO' | null;
  foto_url?: string | null;
  foto_bucket?: string | null;
  foto_path?: string | null;
  is_active: boolean;
  created_at: string;
}

interface Nomenclaturas {
  divisaoPrincipal?: { opcao1: string };
  divisaoSecundaria?: { opcao1: string };
  divisaoTerciaria?: { opcao1: string };
}

interface MemberLookup {
  id: string;
  name: string;
  cpf: string | null;
  data_nascimento: string | null;
  role: string | null;
  occupation: string | null;
  profissao?: string | null;
  phone: string | null;
  custom_fields: Record<string, any> | null;
}

export default function CongregacoesPage() {
  const router = useRouter();
  const dialog = useAppDialog();
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('divisao1');
  const [nomenclaturas, setNomenclaturasState] = useState<Nomenclaturas>({
    // Divisão 1 agora usa o conteúdo que era da Divisão 3
    divisaoPrincipal: { opcao1: 'Igreja' },
    divisaoSecundaria: { opcao1: 'Campo' },
    // Divisão 3 agora usa o conteúdo que era da Divisão 1
    divisaoTerciaria: { opcao1: 'Supervisão' }
  });

  const [divisoes1, setDivisoes1] = useState<Divisao1[]>([]);
  const [divisoes2, setDivisoes2] = useState<Divisao2[]>([]);
  const [divisoes3, setDivisoes3] = useState<Divisao3[]>([]);
  const [ministryId, setMinistryId] = useState<string>('');

  // Limites do plano para divisões hierárquicas
  // -1 = ilimitado, 0 = bloqueado, N = máximo N registros
  const [planLimits, setPlanLimits] = useState({
    max_divisao1: 999, // Supervisão
    max_divisao2: 999, // Campo
    max_divisao3: -1,  // Igreja/Congregação
    planName: '',
  });

  // ── Busca + Paginação ─────────────────────────────────────────────────────
  const PAGE_SIZE_CAMPOS = 50;
  const PAGE_SIZE_SUPS   = 25;
  const [searchCampos, setSearchCampos]       = useState('');
  const [filterUfCampos,  setFilterUfCampos]  = useState('');
  const [filterSupCampos, setFilterSupCampos] = useState('');
  const [filterCnpjCampos, setFilterCnpjCampos] = useState('');
  const [pageCampos,   setPageCampos]         = useState(0);
  const [searchSups,      setSearchSups]      = useState('');
  const [filterUfSups,    setFilterUfSups]    = useState('');
  const [pageSups,        setPageSups]        = useState(0);
  // ── /Busca + Paginação ────────────────────────────────────────────────────

  // Associações (seleção múltipla)
  // - D2 (campos) pode receber várias D1 (congregações) via congregacoes.campo_id
  // - D3 (supervisões) pode receber várias D2 (campos) via campos.supervisao_id
  const [selectedD1IdsForD2, setSelectedD1IdsForD2] = useState<string[]>([]);
  const [expandedSupId, setExpandedSupId] = useState<string | null>(null);
  const [selectedD2IdsForD3, setSelectedD2IdsForD3] = useState<string[]>([]);
  const [camposLocked, setCamposLocked] = useState(true);

  // Form states
  const [formD1, setFormD1] = useState({
    codigo: '',
    nome: '',
    uf: '',
    informar_supervisor: false,
    supervisor_cpf_input: '',
    supervisor_member_id: '',
    supervisor_matricula: '',
    supervisor_nome: '',
    supervisor_cpf: '',
    supervisor_data_nascimento: '',
    supervisor_cargo: '',
    supervisor_celular: ''
  });
  const [editingD1, setEditingD1] = useState<Divisao1 | null>(null);
  const [showFormD1, setShowFormD1] = useState(false);

  const [, setSupervisorStatus] = useState<'idle' | 'loading' | 'found' | 'not_found' | 'error'>('idle');
  const [, setSupervisorMsg] = useState<string>('');

  const [, setSupervisorCpfResults] = useState<MemberLookup[]>([]);
  const [, setSupervisorCpfStatus] = useState<'idle' | 'loading' | 'selected' | 'not_found' | 'error'>('idle');
  const [, setSupervisorCpfMsg] = useState<string>('');

  // Divisão 02 (Campo) - Form states
  const [formD2, setFormD2] = useState({
    supervisao_id: '',
    nome: '',
    is_sede: false,
    data_fundacao: '',
    cnpj: '',
    possui_cnpj: false,
    email: '',
    telefone: '',
    observacoes: '',
    logomarca_url: '',
    informar_pastor: false,
    pastor_nome_input: '',
    pastor_member_id: '',
    pastor_nome: '',
    pastor_data_posse: '',
    cep: '',
    endereco: '',
    numero: '',
    complemento: '',
    bairro: '',
    cidade: '',
    uf: '',
    latitude: '',
    longitude: '',
  });
  const [editingD2, setEditingD2] = useState<Divisao2 | null>(null);
  const [showFormD2, setShowFormD2] = useState(false);

  const [pastorResults, setPastorResults] = useState<MemberLookup[]>([]);
  const [pastorStatus, setPastorStatus] = useState<'idle' | 'loading' | 'selected' | 'not_found' | 'error'>('idle');
  const [pastorMsg, setPastorMsg] = useState<string>('');

  // Busca dinâmica supervisor (D1)
  const [supervisorResults, setSupervisorResults] = useState<MemberLookup[]>([]);
  const [supervisorSearchInput, setSupervisorSearchInput] = useState('');
  const [supervisorSearchStatus, setSupervisorSearchStatus] = useState<'idle' | 'loading' | 'selected' | 'not_found'>('idle');

  const [dirigenteResults, setDirigenteResults] = useState<MemberLookup[]>([]);
  const [dirigenteStatus, setDirigenteStatus] = useState<'idle' | 'loading' | 'selected' | 'not_found' | 'error'>('idle');
  const [dirigenteMsg, setDirigenteMsg] = useState<string>('');
  const [dirigenteSelected, setDirigenteSelected] = useState<{ id: string; name: string } | null>(null);

  // Divisão 03 (Congregação) - Form states
  const [formD3, setFormD3] = useState({
    supervisao_id: '',
    campo_id: '',
    nome: '',
    dirigente: '',
    dirigente_cpf: '',
    dirigente_cargo: '',
    dirigente_matricula: '',
    endereco: '',
    cep: '',
    municipio: '',
    uf: '',
    status_imovel: '' as '' | 'PROPRIO' | 'ALUGADO' | 'CEDIDO',
    is_active: true,
  });
  const [editingD3, setEditingD3] = useState<Divisao3 | null>(null);
  const [showFormD3, setShowFormD3] = useState(false);

  // ── CSV Import ────────────────────────────────────────────────────────────
  type CsvImportTab = 'campos' | 'supervisoes';

  interface CsvCampoRow {
    nome: string;
    supervisao_nome?: string;
    data_fundacao?: string;
    cnpj?: string;
    tem_cnpj?: string;
    email?: string;
    telefone?: string;
    observacoes?: string;
    cep?: string;
    endereco?: string;
    numero?: string;
    complemento?: string;
    bairro?: string;
    cidade?: string;
    uf?: string;
    pastor_nome?: string;
    presidente_nome?: string;
    presidente_cpf?: string;
    presidente_matricula?: string;
    presidente_data_posse?: string;
    registro?: string;
    _error?: string;
  }

  interface CsvSupervisaoRow {
    nome: string;
    codigo?: string;
    supervisor_nome?: string;
    supervisor_cpf?: string;
    supervisor_matricula?: string;
    uf?: string;
    _error?: string;
  }

  const [csvImportTab, setCsvImportTab] = useState<CsvImportTab>('campos');
  const [csvCamposRows, setCsvCamposRows] = useState<CsvCampoRow[]>([]);
  const [csvSupRows, setCsvSupRows] = useState<CsvSupervisaoRow[]>([]);
  const [csvImporting, setCsvImporting] = useState(false);
  const [csvResult, setCsvResult] = useState<{ ok: number; errors: string[] } | null>(null);

  const parseCsvText = (text: string): string[][] => {
    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim());
    if (lines.length === 0) return [];
    // Detecta delimitador pela linha de cabeçalho: usa ';' se tiver mais ';' que ','
    const header = lines[0];
    const countSemi = (header.match(/;/g) || []).length;
    const countComma = (header.match(/,/g) || []).length;
    const sep = countSemi >= countComma ? ';' : ',';

    const parseLine = (line: string): string[] => {
      const row: string[] = [];
      let cur = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
          else { inQuotes = !inQuotes; }
        } else if (ch === sep && !inQuotes) {
          row.push(cur.trim()); cur = '';
        } else {
          cur += ch;
        }
      }
      row.push(cur.trim());
      return row;
    };

    return lines.map(parseLine).filter(r => r.some(c => c));
  };

  const normHeader = (h: string) =>
    h.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');

  // Converte datas no formato "Apr 14, 2025 12:00 am" ou "2025-04-14" para "YYYY-MM-DD"
  const normalizeDateStr = (raw: string): string | null => {
    if (!raw) return null;
    const s = raw.trim();
    // já está em ISO
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    // "Apr 14, 2025 12:00 am" ou "Apr 14, 2025"
    const match = s.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})/);
    if (match) {
      const months: Record<string, string> = {
        jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
        jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
      };
      const m = months[match[1].toLowerCase().slice(0, 3)];
      if (m) return `${match[3]}-${m}-${match[2].padStart(2, '0')}`;
    }
    // DD/MM/YYYY
    const brMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (brMatch) return `${brMatch[3]}-${brMatch[2].padStart(2,'0')}-${brMatch[1].padStart(2,'0')}`;
    return null;
  };

  const parseCsvCampos = (text: string): CsvCampoRow[] => {
    const rows = parseCsvText(text);
    if (rows.length < 2) return [];
    const headers = rows[0].map(normHeader);
    return rows.slice(1).map(cols => {
      const get = (keys: string[]) => {
        for (const k of keys) {
          const idx = headers.indexOf(k);
          if (idx >= 0 && cols[idx]) return cols[idx].trim();
        }
        return '';
      };
      // Aceita tanto nomes originais da planilha quanto nomes normalizados
      const nome = get(['nome_do_campo', 'nome', 'campo', 'name']);
      if (!nome) return { nome: '', _error: 'Nome obrigatório' };
      return {
        nome,
        supervisao_nome: get(['supervisao', 'supervisao_nome', 'supervisao_nome_campo', 'regional']),
        data_fundacao: normalizeDateStr(get(['data_fundacao', 'data_de_fundacao', 'fundacao'])) || undefined,
        cnpj: get(['cnpj']),
        tem_cnpj: get(['tem_cnpj', 'possui_cnpj']),
        email: get(['email_campo', 'email', 'e_mail']),
        telefone: get(['telefone', 'tel', 'fone']),
        observacoes: get(['obs', 'observacoes', 'observacao']),
        cep: get(['cep']),
        endereco: get(['endereco', 'logradouro', 'rua']),
        numero: get(['numero_end', 'numero', 'num', 'n']),
        complemento: get(['complemento', 'compl']),
        bairro: get(['bairro']),
        cidade: get(['cidade', 'municipio', 'localidade']),
        uf: get(['uf', 'estado']),
        pastor_nome: get(['pastor_supervisor', 'pastor', 'pastor_nome', 'responsavel']),
        presidente_nome: get(['presidente_nome', 'presidente']),
        presidente_cpf: get(['presidente_cpf']),
        presidente_matricula: get(['presidente_matricula']),
        presidente_data_posse: normalizeDateStr(get(['data_da_posse', 'data_posse', 'posse'])) || undefined,
        registro: get(['registro_comieadepa', 'registro']),
      };
    });
  };

  const parseCsvSupervisoes = (text: string): CsvSupervisaoRow[] => {
    const rows = parseCsvText(text);
    if (rows.length < 2) return [];
    const headers = rows[0].map(normHeader);
    return rows.slice(1).map(cols => {
      const get = (keys: string[]) => {
        for (const k of keys) {
          const idx = headers.indexOf(k);
          if (idx >= 0 && cols[idx]) return cols[idx].trim();
        }
        return '';
      };
      // Aceita tanto o cabeçalho real da planilha quanto variantes genéricas
      const nome = get(['nome_da_supervisao', 'nome', 'supervisao', 'name']);
      if (!nome) return { nome: '', _error: 'Nome obrigatório' };
      return {
        nome,
        codigo: get(['matricula_supervisor', 'matricula', 'codigo', 'cod', 'id']),
        supervisor_nome: get(['pastor_supervisor', 'supervisor_nome', 'supervisor', 'responsavel', 'pastor']),
        supervisor_cpf: get(['cpf_do_supervisor', 'cpf_supervisor', 'cpf']),
        supervisor_matricula: get(['matricula_supervisor', 'matricula', 'supervisor_matricula']),
        uf: get(['uf', 'estado']),
      };
    });
  };

  const handleCsvFileChange = (e: React.ChangeEvent<HTMLInputElement>, tab: CsvImportTab) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      if (tab === 'campos') {
        setCsvCamposRows(parseCsvCampos(text));
        setCsvResult(null);
      } else {
        setCsvSupRows(parseCsvSupervisoes(text));
        setCsvResult(null);
      }
    };
    reader.readAsText(file, 'UTF-8');
    e.target.value = '';
  };

  const handleCsvImportCampos = async () => {
    const validRows = csvCamposRows.filter(r => r.nome && !r._error);
    if (!validRows.length) return;
    setCsvImporting(true);
    setCsvResult(null);
    let ok = 0;
    const errors: string[] = [];

    for (const row of validRows) {
      try {
        // Resolver supervisão pelo nome (best-effort)
        let supervisao_id: string | null = null;
        if (row.supervisao_nome) {
          const sup = divisoes1.find(s => s.nome.toLowerCase() === (row.supervisao_nome || '').toLowerCase());
          supervisao_id = sup?.id || null;
        }

        const cnpjDigits = (row.cnpj || '').replace(/\D/g, '').slice(0, 14) || null;
        // tem_cnpj pode ser 'sim', 'yes', 'true', '1', ou haver cnpj preenchido
        const temCnpj = cnpjDigits ||
          ['sim','yes','true','1','s'].includes((row.tem_cnpj || '').toLowerCase().trim());

        const payload: any = {
          nome: row.nome,
          supervisao_id,
          data_fundacao: row.data_fundacao || null,
          cnpj: temCnpj ? (cnpjDigits || null) : null,
          email: row.email || null,
          telefone: (row.telefone || '').replace(/\D/g, '').slice(0, 11) || null,
          observacoes: row.observacoes || null,
          cep: (row.cep || '').replace(/\D/g, '').slice(0, 8) || null,
          endereco: row.endereco || null,
          numero: row.numero || null,
          complemento: row.complemento || null,
          bairro: row.bairro || null,
          cidade: row.cidade || null,
          uf: row.uf ? row.uf.toUpperCase().slice(0, 2) : null,
          pastor_nome: row.pastor_nome || null,
          presidente_nome: row.presidente_nome || null,
          presidente_cpf: (row.presidente_cpf || '').replace(/\D/g, '').slice(0, 11) || null,
          presidente_matricula: row.presidente_matricula || null,
          presidente_data_posse: row.presidente_data_posse || null,
          is_sede: false,
          is_active: true,
        };

        const res = await authenticatedFetch('/api/v1/secretaria/campos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const errJson = await res.json().catch(() => null as any);
          throw new Error(errJson?.error || 'Erro ao inserir campo.');
        }
        ok++;
      } catch (err: any) {
        errors.push(`"${row.nome}": ${err?.message || String(err)}`);
      }
    }

    await loadDivisoes2();
    setCsvImporting(false);
    setCsvResult({ ok, errors });
    if (!errors.length) setCsvCamposRows([]);
  };

  const handleCsvImportSupervisoes = async () => {
    const validRows = csvSupRows.filter(r => r.nome && !r._error);
    if (!validRows.length) return;
    setCsvImporting(true);
    setCsvResult(null);
    let ok = 0;
    const errors: string[] = [];

    let nextCodigo = getNextCodigo();

    for (const row of validRows) {
      try {
        const codigoParsed = row.codigo ? Number.parseInt(row.codigo, 10) : null;
        const codigo = Number.isFinite(codigoParsed as any) && (codigoParsed as any) > 0 ? codigoParsed : nextCodigo;

        const payload: any = {
          codigo,
          nome: row.nome,
          supervisor_nome: row.supervisor_nome || null,
          supervisor_cpf: (row.supervisor_cpf || '').replace(/\D/g, '').slice(0, 11) || null,
          supervisor_matricula: row.supervisor_matricula || null,
          uf: row.uf ? row.uf.toUpperCase().slice(0, 2) : null,
          is_active: true,
        };

        const res = await authenticatedFetch('/api/v1/secretaria/supervisoes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const errJson = await res.json().catch(() => null as any);
          throw new Error(errJson?.error || 'Erro ao inserir supervisao.');
        }
        ok++;
        nextCodigo++;
      } catch (err: any) {
        errors.push(`"${row.nome}": ${err?.message || String(err)}`);
      }
    }

    await loadDivisoes1();
    setCsvImporting(false);
    setCsvResult({ ok, errors });
    if (!errors.length) setCsvSupRows([]);
  };
  // ── /CSV Import ──────────────────────────────────────────────────────────

  type FotoIgrejaChange =
    | { kind: 'none' }
    | { kind: 'file'; file: File; previewUrl: string }
    | { kind: 'url'; url: string };

  const [fotoIgrejaChange, setFotoIgrejaChange] = useState<FotoIgrejaChange>({ kind: 'none' });
  const [fotoIgrejaUrlInput, setFotoIgrejaUrlInput] = useState('');

  const [geoPreview, setGeoPreview] = useState<{ latitude: number; longitude: number; address: string } | null>(null);
  const [lastCepAutofill, setLastCepAutofill] = useState<string>('');

  const buildGeocodeQuery = (opts: { endereco: string; municipio: string; uf: string; cepDigits: string }) => {
    return [opts.endereco, opts.municipio, opts.uf, opts.cepDigits, 'Brasil']
      .map(v => (v || '').trim())
      .filter(Boolean)
      .join(', ');
  };

  const geocodeFromAddress = async (
    address: string,
    signal?: AbortSignal
  ): Promise<{ latitude: number; longitude: number } | null> => {
    const q = address.trim();
    if (!q) return null;

    // Se for um CEP (8 dígitos), use o parâmetro postalcode (melhor assertividade)
    const qDigits = onlyDigits(q);
    const isLikelyCep = qDigits.length === 8 && q.replace(/\D/g, '').length === 8;

    try {
      const url = isLikelyCep
        ? `https://nominatim.openstreetmap.org/search?postalcode=${encodeURIComponent(qDigits)}&country=${encodeURIComponent('Brazil')}&format=json&limit=1`
        : `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1`;
      const res = await fetch(url, signal ? { signal } : undefined);
      if (!res.ok) return null;
      const data = await res.json();
      if (!Array.isArray(data) || data.length === 0) return null;
      const latitude = Number.parseFloat(data[0]?.lat);
      const longitude = Number.parseFloat(data[0]?.lon);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
      return { latitude, longitude };
    } catch {
      return null;
    }
  };

  // Geolocalização: gerar preview automaticamente ao digitar o endereço (debounce + abort).
  useEffect(() => {
    if (!showFormD3) return;

    const enderecoTrim = (formD3.endereco || '').trim();
    const municipioTrim = (formD3.municipio || '').trim();
    const ufTrim = (formD3.uf || '').trim().toUpperCase();
    const cepDigits = onlyDigits(formD3.cep);

    // Permite geocode só com CEP (8 dígitos) ou (município + UF).
    // Isso atende o caso comum: usuário digita o CEP e espera a geolocalização preencher.
    const hasEnoughForGeocode = !!(
      (cepDigits && cepDigits.length === 8) ||
      (municipioTrim && ufTrim) ||
      (enderecoTrim && (municipioTrim || ufTrim || cepDigits))
    );
    if (!hasEnoughForGeocode) {
      setGeoPreview(null);
      return;
    }

    const addressForGeocode = buildGeocodeQuery({
      endereco: enderecoTrim,
      municipio: municipioTrim,
      uf: ufTrim,
      cepDigits,
    });

    const timer = window.setTimeout(() => {
      const controller = new AbortController();
      const signal = controller.signal;

      let cancelled = false;
      (async () => {
        const coords = await geocodeFromAddress(addressForGeocode, signal);
        if (cancelled) return;
        if (coords) {
          setGeoPreview({ ...coords, address: addressForGeocode });
        } else {
          setGeoPreview(null);
        }
      })();

      // Cleanup do timeout não tem acesso ao controller; então retornamos cleanup separado abaixo.
      // (A cada alteração de campos, o efeito roda novamente e aborta a request anterior.)
      (window as any).__geoAbortController__ = controller;

      return () => {
        cancelled = true;
        try { controller.abort(); } catch { /* noop */ }
      };
    }, 700);

    return () => {
      window.clearTimeout(timer);
      const prev = (window as any).__geoAbortController__ as AbortController | undefined;
      if (prev) {
        try { prev.abort(); } catch { /* noop */ }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showFormD3, formD3.endereco, formD3.municipio, formD3.uf, formD3.cep]);

  // CEP autocomplete (ViaCEP): ao digitar 8 dígitos, completa endereço/município/UF.
  useEffect(() => {
    if (!showFormD3) return;

    const cepDigits = onlyDigits(formD3.cep);
    if (!cepDigits || cepDigits.length !== 8) return;
    if (cepDigits === lastCepAutofill) return;

    const timer = window.setTimeout(() => {
      const controller = new AbortController();
      const signal = controller.signal;

      (async () => {
        try {
          const resp = await fetch(`https://viacep.com.br/ws/${cepDigits}/json/`, { signal });
          if (!resp.ok) return;
          const data = await resp.json().catch(() => null as any);
          if (!data || data.erro) return;

          const logradouro = String(data.logradouro || '').trim();
          const bairro = String(data.bairro || '').trim();
          const localidade = String(data.localidade || '').trim();
          const uf = String(data.uf || '').trim().toUpperCase();
          const enderecoAutofill = [logradouro, bairro].filter(Boolean).join(' - ');

          setFormD3(prev => {
            const prevEndereco = (prev.endereco || '').trim();
            const nextEndereco = prevEndereco ? prevEndereco : enderecoAutofill;
            return {
              ...prev,
              endereco: nextEndereco,
              municipio: localidade || prev.municipio,
              uf: uf ? uf.slice(0, 2) : prev.uf,
            };
          });

          setGeoPreview(null);
          setLastCepAutofill(cepDigits);
        } catch {
          // silencioso (autocomplete best-effort)
        }
      })();

      (window as any).__cepAbortController__ = controller;
    }, 600);

    return () => {
      window.clearTimeout(timer);
      const prev = (window as any).__cepAbortController__ as AbortController | undefined;
      if (prev) {
        try { prev.abort(); } catch { /* noop */ }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showFormD3, formD3.cep]);

  // Geolocalização D2 — geocodifica automaticamente ao digitar o endereço
  useEffect(() => {
    if (!showFormD2) return;

    const enderecoTrim = (formD2.endereco || '').trim();
    const cidadeTrim = (formD2.cidade || '').trim();
    const ufTrim = (formD2.uf || '').trim().toUpperCase();
    const cepDigits = (formD2.cep || '').replace(/\D/g, '');

    const hasEnough = !!(
      (cepDigits && cepDigits.length === 8) ||
      (cidadeTrim && ufTrim) ||
      (enderecoTrim && (cidadeTrim || ufTrim || cepDigits))
    );
    if (!hasEnough) return;

    const timer = window.setTimeout(() => {
      const controller = new AbortController();
      (async () => {
        try {
          // Tenta primeiro com CEP (mais preciso via postalcode= no Nominatim)
          let coords: { latitude: number; longitude: number } | null = null;
          if (cepDigits.length === 8) {
            const res = await fetch(
              `https://nominatim.openstreetmap.org/search?postalcode=${encodeURIComponent(cepDigits)}&country=Brazil&format=json&limit=1`,
              { signal: controller.signal }
            );
            if (res.ok) {
              const data = await res.json();
              if (Array.isArray(data) && data.length > 0) {
                const lat = Number.parseFloat(data[0]?.lat);
                const lng = Number.parseFloat(data[0]?.lon);
                if (Number.isFinite(lat) && Number.isFinite(lng)) coords = { latitude: lat, longitude: lng };
              }
            }
          }
          // Fallback: busca por endereço completo
          if (!coords) {
            const query = [enderecoTrim, cidadeTrim, ufTrim, cepDigits, 'Brasil']
              .filter(Boolean).join(', ');
            const res = await fetch(
              `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`,
              { signal: controller.signal }
            );
            if (res.ok) {
              const data = await res.json();
              if (Array.isArray(data) && data.length > 0) {
                const lat = Number.parseFloat(data[0]?.lat);
                const lng = Number.parseFloat(data[0]?.lon);
                if (Number.isFinite(lat) && Number.isFinite(lng)) coords = { latitude: lat, longitude: lng };
              }
            }
          }
          if (coords) {
            setFormD2(prev => ({
              ...prev,
              latitude: String(coords!.latitude),
              longitude: String(coords!.longitude),
            }));
          }
        } catch { /* abortado ou erro de rede — silencioso */ }
      })();
      (window as any).__geoD2AbortController__ = controller;
    }, 800);

    return () => {
      window.clearTimeout(timer);
      const prev = (window as any).__geoD2AbortController__ as AbortController | undefined;
      if (prev) { try { prev.abort(); } catch { /* noop */ } }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showFormD2, formD2.endereco, formD2.cidade, formD2.uf, formD2.cep]);

  const getNextCodigo = () => {
    const codigos = divisoes1
      .map(d => (typeof d.codigo === 'number' ? d.codigo : null))
      .filter((v): v is number => v !== null && Number.isFinite(v));
    const max = codigos.length ? Math.max(...codigos) : 0;
    return max + 1;
  };

  // Garantir que o ID (código) apareça automaticamente ao abrir o formulário
  useEffect(() => {
    if (!showFormD1) return;
    if (editingD1) return;
    if (formD1.codigo) return;
    setFormD1(prev => ({ ...prev, codigo: String(getNextCodigo()) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showFormD1, editingD1, divisoes1.length]);

  const nomeD1 = nomenclaturas.divisaoPrincipal?.opcao1 || 'Igreja';
  const nomeD2 = 'Campo';
  const nomeD3 = 'Supervisão';

  const normalizeLabel = (label: string) => label.trim().toUpperCase();
  const isEnabledDivision = (label: string) => normalizeLabel(label) !== 'NENHUMA';

  const d1Enabled = isEnabledDivision(nomeD1);
  const d2Enabled = true;
  const d3Enabled = true;

  const enabledTabIds = ['divisao2', 'divisao3', 'importar-csv'];

  useEffect(() => {
    if (!enabledTabIds.includes(activeTab)) {
      setActiveTab('divisao2');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Inicializar cliente Supabase (singleton)
  const supabase = createClient();

  // Ao trocar de aba, não manter formulários abertos.
  useEffect(() => {
    if (activeTab !== 'divisao1') {
      setShowFormD1(false);
      setEditingD1(null);
      setSupervisorStatus('idle');
      setSupervisorMsg('');
    }

    if (activeTab !== 'divisao2') {
      setShowFormD2(false);
      setEditingD2(null);
      setPastorResults([]);
      setPastorStatus('idle');
      setPastorMsg('');
    }

    if (activeTab !== 'divisao3') {
      setShowFormD3(false);
      setEditingD3(null);
    }
  }, [activeTab]);

  useEffect(() => {
    const initPage = async () => {
      try {
        const meRes = await authenticatedFetch('/api/auth/me');
        if (!meRes.ok) {
          router.push('/login');
          return;
        }

        const me = await meRes.json().catch(() => null as any);
        const resolvedMinistryId = String(me?.userId || '');
        if (!resolvedMinistryId) {
          router.push('/login');
          return;
        }

        // Carregar nomenclaturas a partir do Supabase (com fallback/migração controlados)
        const orgNomenclaturas = await loadOrgNomenclaturasFromSupabaseOrMigrate(supabase);
        setNomenclaturasState(orgNomenclaturas);

        // Single-tenant: usar user.id como namespace (sem ministry_id/ministries)
        setMinistryId(resolvedMinistryId);

        // Sem limites de plano no single-tenant
        setPlanLimits({ max_divisao1: 999, max_divisao2: 999, max_divisao3: -1, planName: '' });

        // Carregar dados via API protegida
        await Promise.all([
          loadDivisoes1(),
          loadDivisoes2(),
          loadDivisoes3(),
        ]);

        setLoading(false);
      } catch (error) {
        console.error('Erro ao inicializar página:', error);
        setLoading(false);
      }
    };

    initPage();
  }, [router]);

  const onlyDigits = (value: string) => (value || '').replace(/\D/g, '');

  const compressImageToJpeg = async (file: File, maxBytes: number): Promise<File> => {
    const bitmap = await createImageBitmap(file);
    const maxSide = 1280;
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const targetW = Math.max(1, Math.round(bitmap.width * scale));
    const targetH = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas não suportado');
    ctx.drawImage(bitmap, 0, 0, targetW, targetH);

    const toBlob = (quality: number) =>
      new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('Falha ao gerar imagem'))),
          'image/jpeg',
          quality
        );
      });

    let quality = 0.82;
    let blob = await toBlob(quality);
    while (blob.size > maxBytes && quality > 0.5) {
      quality = Math.max(0.5, quality - 0.08);
      blob = await toBlob(quality);
    }

    const outName = file.name.replace(/\.[^.]+$/, '') + '.jpg';
    return new File([blob], outName, { type: 'image/jpeg' });
  };

  const uploadFotoIgreja = async (file: File, congregacaoId: string) => {
    const compressed = await compressImageToJpeg(file, 600 * 1024);

    const form = new FormData();
    form.append('file', compressed);
    form.append('congregacaoId', congregacaoId);

    const resp = await authenticatedFetch('/api/v1/secretaria/uploads/igreja-foto', {
      method: 'POST',
      body: form,
    });

    const json = await resp.json().catch(() => null as any);
    if (!resp.ok) {
      const msg = json?.error || 'Falha ao enviar foto.';
      throw new Error(msg);
    }

    if (!json?.url || !json?.bucket || !json?.path) {
      throw new Error('Resposta inválida do upload.');
    }

    return { url: String(json.url), bucket: String(json.bucket), path: String(json.path) };
  };

  const deleteFotoIgreja = async (bucket: string, path: string) => {
    await authenticatedFetch('/api/v1/secretaria/uploads/igreja-foto', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bucket, path }),
    }).catch(() => null);
  };

  const formatCpf = (cpf: string) => {
    const digits = onlyDigits(cpf);
    if (digits.length !== 11) return cpf;
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9, 11)}`;
  };

  const getMinisterCargo = (member: MemberLookup) => {
    const cf = member.custom_fields || {};
    return (
      member.role ||
      cf.cargo ||
      cf.função ||
      cf.funcao ||
      ''
    );
  };

  const getMemberMatricula = (member: MemberLookup) => {
    const cf = member.custom_fields || {};
    return (
      (cf as any).matricula ||
      (cf as any).matrícula ||
      (cf as any).registration ||
      (cf as any).registro ||
      ''
    );
  };

  const isMinisterMember = (member: MemberLookup | null) => {
    if (!member) return false;
    const tipoCadastroRaw = (member.custom_fields as any)?.tipoCadastro ?? (member.custom_fields as any)?.tipo_cadastro;
    const tipoCadastro = String(tipoCadastroRaw || '').trim().toLowerCase();

    // Fonte oficial: select "Tipo de Cadastro" no cadastro de membros
    if (tipoCadastro) {
      return tipoCadastro === 'ministro' || tipoCadastro.includes('ministro');
    }

    // Fallback para bases antigas (sem tipoCadastro preenchido)
    const cargo = String(getMinisterCargo(member) || '').trim();
    return !!cargo;
  };

  const buscarMinistrosPorCpfPrefixo = async (cpfInput: string) => {
    const cpfDigits = onlyDigits(cpfInput);
    if (!ministryId) return;
    if (cpfDigits.length < 3 || cpfDigits.length >= 11) {
      setSupervisorCpfResults([]);
      setSupervisorCpfStatus('idle');
      setSupervisorCpfMsg('');
      return;
    }

    try {
      setSupervisorCpfStatus('loading');
      setSupervisorCpfMsg('Buscando sugestões...');

      const res = await authenticatedFetch(`/api/v1/members/lookup?search=${encodeURIComponent(cpfDigits)}&limit=20`);
      const payload = await res.json().catch(() => null as any);
      if (!res.ok) throw new Error(payload?.error || 'Erro ao buscar membros.');

      const all = ((payload?.data as any) || [])
        .filter((m: any) => String(m?.cpf || '').startsWith(cpfDigits)) as MemberLookup[];
      const ministros = all.filter(m => m && m.cpf && isMinisterMember(m));

      if (!ministros.length) {
        setSupervisorCpfResults([]);
        setSupervisorCpfStatus('not_found');
        setSupervisorCpfMsg('Nenhum ministro encontrado com este início de CPF.');
        return;
      }

      setSupervisorCpfResults(ministros);
      setSupervisorCpfStatus('idle');
      setSupervisorCpfMsg('');
    } catch (error) {
      console.error('Erro ao buscar sugestões de CPF do supervisor:', error);
      setSupervisorCpfResults([]);
      setSupervisorCpfStatus('error');
      setSupervisorCpfMsg('Erro ao buscar sugestões.');
    }
  };

  const buscarSupervisorPorCpf = async (cpfInput: string) => {
    const cpfDigits = onlyDigits(cpfInput);
    if (!ministryId) return;

    if (cpfDigits.length !== 11) {
      setSupervisorStatus('idle');
      setSupervisorMsg('');
      setFormD1(prev => ({
        ...prev,
        supervisor_member_id: '',
        supervisor_matricula: '',
        supervisor_nome: '',
        supervisor_cpf: '',
        supervisor_data_nascimento: '',
        supervisor_cargo: '',
        supervisor_celular: ''
      }));
      return;
    }

    try {
      setSupervisorStatus('loading');
      setSupervisorMsg('Aguardando dados...');

      const res = await authenticatedFetch(`/api/v1/members/lookup?cpf=${encodeURIComponent(cpfDigits)}`);
      const payload = await res.json().catch(() => null as any);
      if (!res.ok) throw new Error(payload?.error || 'Erro ao buscar membros.');

      const member: MemberLookup | null = ((payload?.data as any) || [])?.[0] || null;

      if (!member) {
        setSupervisorStatus('not_found');
        setSupervisorMsg('Ministro não encontrado para este CPF.');
        setFormD1(prev => ({
          ...prev,
          supervisor_member_id: '',
          supervisor_matricula: '',
          supervisor_nome: '',
          supervisor_cpf: '',
          supervisor_data_nascimento: '',
          supervisor_cargo: '',
          supervisor_celular: ''
        }));
        return;
      }

      if (!isMinisterMember(member)) {
        setSupervisorStatus('not_found');
        setSupervisorMsg('Ministro não encontrado para este CPF.');
        setFormD1(prev => ({
          ...prev,
          supervisor_member_id: '',
          supervisor_matricula: '',
          supervisor_nome: '',
          supervisor_cpf: '',
          supervisor_data_nascimento: '',
          supervisor_cargo: '',
          supervisor_celular: ''
        }));
        return;
      }

      const matricula =
        (member.custom_fields && (member.custom_fields.matricula || member.custom_fields.matrícula)) ||
        (member.custom_fields && (member.custom_fields.registration || member.custom_fields.registro)) ||
        '';

      const cargo =
        member.role ||
        member.profissao ||
        (member.custom_fields && (member.custom_fields.cargo || member.custom_fields.função || member.custom_fields.funcao)) ||
        '';

      const celular =
        member.phone ||
        (member.custom_fields && (member.custom_fields.celular || member.custom_fields.whatsapp)) ||
        '';

      setFormD1(prev => ({
        ...prev,
        supervisor_member_id: member.id,
        supervisor_matricula: String(matricula || ''),
        supervisor_nome: member.name || '',
        supervisor_cpf: member.cpf || cpfDigits,
        supervisor_data_nascimento: member.data_nascimento || '',
        supervisor_cargo: String(cargo || ''),
        supervisor_celular: String(celular || '')
      }));

      setSupervisorStatus('found');
      setSupervisorMsg('Supervisor encontrado.');
    } catch (error: any) {
      console.error('Erro ao buscar supervisor por CPF:', error);
      setSupervisorStatus('error');
      setSupervisorMsg('Erro ao buscar supervisor.');
    }
  };

  useEffect(() => {
    if (!showFormD1) return;
    if (!formD1.supervisor_cpf_input) return;

    const t = setTimeout(() => {
      buscarSupervisorPorCpf(formD1.supervisor_cpf_input);
    }, 450);

    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formD1.supervisor_cpf_input, showFormD1, ministryId]);

  useEffect(() => {
    if (!showFormD1) {
      setSupervisorCpfResults([]);
      setSupervisorCpfStatus('idle');
      setSupervisorCpfMsg('');
      return;
    }

    if (!ministryId) return;

    const digits = onlyDigits(formD1.supervisor_cpf_input);
    if (digits.length < 3 || digits.length >= 11) {
      setSupervisorCpfResults([]);
      setSupervisorCpfStatus('idle');
      setSupervisorCpfMsg('');
      return;
    }

    const t = setTimeout(() => {
      buscarMinistrosPorCpfPrefixo(formD1.supervisor_cpf_input);
    }, 300);

    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formD1.supervisor_cpf_input, showFormD1, ministryId]);

  const loadDivisoes1 = async () => {
    try {
      const res = await authenticatedFetch('/api/v1/secretaria/supervisoes?includeInactive=true');
      const payload = await res.json().catch(() => null as any);
      if (!res.ok) throw new Error(payload?.error || 'Erro ao carregar supervisoes.');
      setDivisoes1((payload?.data as any[]) || []);
    } catch (error) {
      setDivisoes1([]);
      const msg = (error as any)?.message || (error as any)?.error_description || '';
      console.warn('Falha ao carregar divisões (Divisão 01).', msg || error);
    }
  };

  const loadDivisoes2 = async (_ministryId?: string) => {
    try {
      const res = await authenticatedFetch('/api/v1/secretaria/campos?includeInactive=true');
      const payload = await res.json().catch(() => null as any);
      if (!res.ok) throw new Error(payload?.error || 'Erro ao carregar campos.');
      setDivisoes2(((payload?.data as any[]) || []) as any);
    } catch (error) {
      setDivisoes2([] as any);
      const msg = (error as any)?.message || (error as any)?.error_description || '';
      console.warn('Falha ao carregar divisões (Divisão 02).', msg || error);
    }
  };

  const loadDivisoes3 = async () => {
    try {
      const res = await authenticatedFetch('/api/v1/secretaria/congregacoes?includeInactive=true');
      const payload = await res.json().catch(() => null as any);
      if (!res.ok) throw new Error(payload?.error || 'Erro ao carregar congregacoes.');
      setDivisoes3((payload?.data as any) || []);
    } catch (error) {
      setDivisoes3([] as any);
      const msg = (error as any)?.message || (error as any)?.error_description || '';
      console.warn('Falha ao carregar divisões (Divisão 03).', msg || error);
    }
  };

  const formatSupervisaoLabel = (s: Divisao1) => {
    const codigo = typeof s.codigo === 'number' && Number.isFinite(s.codigo) ? s.codigo : null;
    return codigo ? `${codigo}-${s.nome}` : s.nome;
  };

  const formatCampoLabel = (c: Divisao2) => {
    if (!d3Enabled) return c.nome;
    if (!c.supervisao_id) return c.nome;
    const sup = divisoes1.find(s => s.id === c.supervisao_id) || null;
    return sup ? `${formatSupervisaoLabel(sup)} — ${c.nome}` : c.nome;
  };

  const buscarPastorPorNome = async (term: string) => {
    if (!ministryId) return;

    const q = (term || '').trim();
    if (q.length < 2) {
      setPastorResults([]);
      setPastorStatus('idle');
      setPastorMsg('');
      return;
    }

    try {
      setPastorStatus('loading');
      setPastorMsg('Buscando...');

      const res = await authenticatedFetch(`/api/v1/members/lookup?search=${encodeURIComponent(q)}&limit=7`);
      const payload = await res.json().catch(() => null as any);
      if (!res.ok) throw new Error(payload?.error || 'Erro ao buscar membros.');

      const results = ((payload?.data as any) || []) as MemberLookup[];
      setPastorResults(results);

      if (!results.length) {
        setPastorStatus('not_found');
        setPastorMsg('Nenhum membro encontrado com este nome.');
      } else {
        setPastorStatus('idle');
        setPastorMsg('');
      }
    } catch (error: any) {
      console.error('Erro ao buscar pastor por nome:', error);
      setPastorResults([]);
      setPastorStatus('error');
      setPastorMsg('Erro ao buscar pastor.');
    }
  };

  useEffect(() => {
    if (!showFormD2) return;
    if (!formD2.informar_pastor) return;

    const t = setTimeout(() => {
      buscarPastorPorNome(formD2.pastor_nome_input);
    }, 350);

    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formD2.pastor_nome_input, formD2.informar_pastor, showFormD2, ministryId]);

  const buscarSupervisorPorNome = async (term: string) => {
    const q = (term || '').trim();
    if (q.length < 3) {
      setSupervisorResults([]);
      setSupervisorSearchStatus('idle');
      return;
    }
    try {
      setSupervisorSearchStatus('loading');
      const res = await authenticatedFetch(`/api/v1/members/lookup?search=${encodeURIComponent(q)}&limit=7`);
      const payload = await res.json().catch(() => null as any);
      if (!res.ok) throw new Error(payload?.error || 'Erro ao buscar membros.');
      const results = ((payload?.data as any) || []) as MemberLookup[];
      setSupervisorResults(results);
      setSupervisorSearchStatus(results.length ? 'idle' : 'not_found');
    } catch {
      setSupervisorResults([]);
      setSupervisorSearchStatus('idle');
    }
  };

  useEffect(() => {
    if (!showFormD1 || !formD1.informar_supervisor) return;
    const t = setTimeout(() => buscarSupervisorPorNome(supervisorSearchInput), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supervisorSearchInput, formD1.informar_supervisor, showFormD1]);

  const buscarDirigentePorNome = async (term: string) => {
    if (!ministryId) return;

    const q = (term || '').trim();
    if (q.length < 2) {
      setDirigenteResults([]);
      setDirigenteStatus('idle');
      setDirigenteMsg('');
      return;
    }

    // Se já está selecionado e o texto bate, não precisa buscar de novo.
    if (dirigenteSelected && q === dirigenteSelected.name) return;

    try {
      setDirigenteStatus('loading');
      setDirigenteMsg('Buscando...');

      const res = await authenticatedFetch(`/api/v1/members/lookup?search=${encodeURIComponent(q)}&limit=8`);
      const payload = await res.json().catch(() => null as any);
      if (!res.ok) throw new Error(payload?.error || 'Erro ao buscar membros.');

      const results = (((payload?.data as any) || []) as MemberLookup[])
        .filter(Boolean)
        .filter(isMinisterMember);

      setDirigenteResults(results);

      if (!results.length) {
        setDirigenteStatus('not_found');
        setDirigenteMsg('Nenhum ministro encontrado com este nome.');
      } else {
        setDirigenteStatus('idle');
        setDirigenteMsg('');
      }
    } catch (error: any) {
      console.error('Erro ao buscar dirigente por nome:', error);
      setDirigenteResults([]);
      setDirigenteStatus('error');
      setDirigenteMsg('Erro ao buscar dirigente.');
    }
  };

  useEffect(() => {
    if (!showFormD3) {
      setDirigenteResults([]);
      setDirigenteStatus('idle');
      setDirigenteMsg('');
      setDirigenteSelected(null);
      return;
    }

    if (!ministryId) return;

    const q = (formD3.dirigente || '').trim();
    if (dirigenteSelected && q === dirigenteSelected.name) return;

    const t = setTimeout(() => {
      buscarDirigentePorNome(formD3.dirigente);
    }, 350);

    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formD3.dirigente, showFormD3, ministryId, dirigenteSelected?.name]);

  const handleSaveD2 = async () => {
    if (!ministryId) {
      await dialog.alert({ title: 'Aguarde', message: 'Ainda estamos carregando o ministério do usuário.', type: 'info' });
      return;
    }

    if (!formD2.nome.trim()) {
      await dialog.alert({ title: 'Atenção', type: 'warning', message: 'Por favor, preencha o nome.' });
      return;
    }

    // Verificar limite do plano para 2ª divisão
    if (!editingD2) {
      if (planLimits.max_divisao2 === 0) {
        await dialog.alert({ title: 'Limite do Plano', type: 'error', message: `O plano atual não permite criação de ${nomeD2}. Faça upgrade para habilitar esta divisão.` });
        return;
      }
      if (planLimits.max_divisao2 > 0 && divisoes2.length >= planLimits.max_divisao2) {
        await dialog.alert({ title: 'Limite do Plano', type: 'error', message: `Limite atingido: o plano permite até ${planLimits.max_divisao2} ${nomeD2}(s). Faça upgrade para adicionar mais.` });
        return;
      }
    }


    // Regra nova: D2 não depende de existir D1.
    // Se houver divisão 3 (Supervisão) habilitada, o vínculo é opcional.
    if (d3Enabled && formD2.is_sede && !formD2.supervisao_id) {
      await dialog.alert({ title: 'Atenção', type: 'warning', message: `Selecione a ${nomeD3} para definir o campo sede.` });
      return;
    }

    if (formD2.informar_pastor) {
      if (!formD2.pastor_member_id) {
        await dialog.alert({ title: 'Atenção', type: 'warning', message: 'Selecione o Pastor do Campo a partir da busca por nome.' });
        return;
      }
      if (!formD2.pastor_data_posse) {
        await dialog.alert({ title: 'Atenção', type: 'warning', message: 'Informe a Data da posse.' });
        return;
      }
    }

    const payload: any = {
      supervisao_id: formD2.supervisao_id || null,
      nome: formD2.nome.trim(),
      is_sede: !!formD2.is_sede,
      data_fundacao: formD2.data_fundacao || null,
      cnpj: formD2.possui_cnpj ? (formD2.cnpj || null) : null,
      email: formD2.email || null,
      telefone: formD2.telefone || null,
      observacoes: formD2.observacoes || null,
      logomarca_url: formD2.logomarca_url || null,
      pastor_member_id: formD2.informar_pastor ? (formD2.pastor_member_id || null) : null,
      pastor_nome: formD2.informar_pastor ? (formD2.pastor_nome || formD2.pastor_nome_input || null) : null,
      pastor_data_posse: formD2.informar_pastor ? (formD2.pastor_data_posse || null) : null,
      cep: formD2.cep || null,
      endereco: formD2.endereco || null,
      numero: formD2.numero || null,
      complemento: formD2.complemento || null,
      bairro: formD2.bairro || null,
      cidade: formD2.cidade || null,
      uf: formD2.uf || null,
      latitude: formD2.latitude ? parseFloat(formD2.latitude) : null,
      longitude: formD2.longitude ? parseFloat(formD2.longitude) : null,
      updated_at: new Date().toISOString()
    };

    try {
      // Se marcar como sede, desmarcar os demais da mesma supervisão (best-effort)
      if (payload.is_sede && payload.supervisao_id) {
        const nowIso = new Date().toISOString();
        const toUnset = divisoes2
          .filter((c) => c.supervisao_id === payload.supervisao_id && c.is_sede && c.id !== editingD2?.id)
          .map((c) => c.id);

        if (toUnset.length) {
          await Promise.all(
            toUnset.map((id) =>
              authenticatedFetch('/api/v1/secretaria/campos', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, is_sede: false, updated_at: nowIso }),
              })
            )
          );
        }
      }

      let campoId = editingD2?.id || null;

      if (editingD2) {
        const res = await authenticatedFetch('/api/v1/secretaria/campos', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: editingD2.id, ...payload }),
        });
        if (!res.ok) {
          const errJson = await res.json().catch(() => null as any);
          throw new Error(errJson?.error || 'Erro ao atualizar campo.');
        }
      } else {
        const res = await authenticatedFetch('/api/v1/secretaria/campos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...payload }),
        });
        const payloadRes = await res.json().catch(() => null as any);
        if (!res.ok) {
          throw new Error(payloadRes?.error || 'Erro ao criar campo.');
        }
        campoId = payloadRes?.data?.id || null;
      }

      const isMissingCongregacoesTableError = (err: any) => {
        const text = String(err?.message || err?.details || err?.hint || err || '');
        return /public\.congregacoes/i.test(text) && /could not find the table|schema cache|PGRST205/i.test(text);
      };

      // Associações D1 -> D2 (best-effort)
      if (campoId) {
        const nowIso = new Date().toISOString();
        const existing = divisoes3
          .filter(cg => cg.campo_id === campoId)
          .map(cg => cg.id);
        const availableIds = new Set(
          divisoes3
            .filter(cg => !cg.campo_id || cg.campo_id === campoId)
            .map(cg => cg.id)
        );
        const selected = selectedD1IdsForD2.filter(id => availableIds.has(id));
        const toAdd = selected.filter(id => !existing.includes(id));
        const toRemove = existing.filter(id => !selected.includes(id));

        if (toAdd.length) {
          for (const id of toAdd) {
            const res = await authenticatedFetch('/api/v1/secretaria/congregacoes', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id, campo_id: campoId, updated_at: nowIso }),
            });
            if (!res.ok) {
              const errJson = await res.json().catch(() => null as any);
              if (isMissingCongregacoesTableError(errJson?.error)) {
                console.warn('Tabela public.congregacoes ausente; associação D1 -> D2 ignorada neste ambiente.');
              } else {
                throw new Error(errJson?.error || 'Erro ao associar congregacoes.');
              }
            }
          }
        }

        if (toRemove.length) {
          for (const id of toRemove) {
            const res = await authenticatedFetch('/api/v1/secretaria/congregacoes', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id, campo_id: null, updated_at: nowIso }),
            });
            if (!res.ok) {
              const errJson = await res.json().catch(() => null as any);
              if (isMissingCongregacoesTableError(errJson?.error)) {
                console.warn('Tabela public.congregacoes ausente; desassociação D1 -> D2 ignorada neste ambiente.');
              } else {
                throw new Error(errJson?.error || 'Erro ao desassociar congregacoes.');
              }
            }
          }
        }
      }

      // ── Sync supervisão dos membros deste campo ────────────────────────────
      // Sempre que um campo é salvo com supervisao_id, todos os membros cujo
      // custom_fields.campo bate com o nome do campo passam a ter a nova supervisão.
      if (payload.supervisao_id) {
        // Busca pelo nome anterior ao edit (se houve rename, mantém coerência)
        const campoNomeBusca = (editingD2?.nome || formD2.nome).trim();
        const supNome = divisoes1.find(d => d.id === payload.supervisao_id)?.nome || '';

        try {
          const res = await authenticatedFetch('/api/v1/secretaria/members/sync-supervisao', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              campo_nome: campoNomeBusca,
              supervisao_id: payload.supervisao_id,
              supervisao_nome: supNome,
            }),
          });
          if (!res.ok) {
            const errJson = await res.json().catch(() => null as any);
            throw new Error(errJson?.error || 'Erro ao sincronizar membros.');
          }
        } catch (syncErr) {
          // Não bloqueia o fluxo principal — apenas avisa no console
          console.warn('[Sync] Não foi possível sincronizar supervisão dos membros:', syncErr);
        }
      }
      // ── Fim sync membros ───────────────────────────────────────────────────

      await loadDivisoes2();
      await loadDivisoes3();

      setFormD2({
        supervisao_id: '',
        nome: '',
        is_sede: false,
        data_fundacao: '',
        cnpj: '',
        possui_cnpj: false,
        email: '',
        telefone: '',
        observacoes: '',
        logomarca_url: '',
        informar_pastor: false,
        pastor_nome_input: '',
        pastor_member_id: '',
        pastor_nome: '',
        pastor_data_posse: '',
        cep: '',
        endereco: '',
        numero: '',
        complemento: '',
        bairro: '',
        cidade: '',
        uf: '',
        latitude: '',
        longitude: '',
      });
      setPastorResults([]);
      setPastorStatus('idle');
      setPastorMsg('');
      setSelectedD1IdsForD2([]);
      setEditingD2(null);
      setShowFormD2(false);
    } catch (error) {
      const err: any = error as any;
      const fallbackRaw = (() => {
        try {
          if (typeof error === 'string') return error;
          if (error instanceof Error) return error.message || error.name;
          if (error && typeof error === 'object') return JSON.stringify(error);
          return String(error || '');
        } catch {
          return '';
        }
      })();
      const parts = [
        err?.code ? `(${String(err.code)})` : '',
        err?.message ? String(err.message) : '',
        err?.details ? String(err.details) : '',
        err?.hint ? String(err.hint) : '',
        fallbackRaw
      ].filter(Boolean);
      const debugMsg = parts.join(' ');

      console.error('Erro ao salvar divisão 02:', {
        code: err?.code,
        message: err?.message,
        details: err?.details,
        hint: err?.hint,
        raw: error,
        rawKeys: err ? Object.getOwnPropertyNames(err) : null,
      });

      const missingTableMatch = debugMsg.match(/table\s+'([^']+)'/i);
      const missingTableName = missingTableMatch?.[1] || '';
      const tableMissing = /could not find the table|schema cache|PGRST205/i.test(debugMsg) && !!missingTableName;

      await dialog.alert({
        title: 'Erro',
        type: 'error',
        message: tableMissing
          ? `Erro ao salvar: a tabela ${missingTableName} não existe neste banco. Aplique as migrações pendentes da Estrutura Hierárquica e tente novamente.`
          : (debugMsg ? `Erro ao salvar: ${debugMsg}` : 'Erro ao salvar. Tente novamente.'),
      });
    }
  };

  const handleDeleteD2 = async (id: string) => {
    const ok = await dialog.confirm({ title: 'Confirmar', type: 'warning', message: 'Tem certeza que deseja deletar?', confirmText: 'OK', cancelText: 'Cancelar' });
    if (!ok) return;
    try {
      const res = await authenticatedFetch('/api/v1/secretaria/campos', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => null as any);
        throw new Error(errJson?.error || 'Erro ao deletar campo.');
      }
      await loadDivisoes2();
    } catch (error) {
      console.error('Erro ao deletar divisão 02:', error);
      await dialog.alert({ title: 'Erro', type: 'error', message: 'Erro ao deletar. Tente novamente.' });
    }
  };

  const handleSaveD3 = async () => {
    if (!ministryId) {
      await dialog.alert({ title: 'Aguarde', message: 'Ainda estamos carregando o ministério do usuário.', type: 'info' });
      return;
    }

    if (!formD3.nome.trim()) {
      await dialog.alert({ title: 'Atenção', message: 'Por favor, preencha o nome.', type: 'warning' });
      return;
    }

    // Verificar limite do plano para 3ª divisão (Igreja/Congregação)
    if (!editingD3) {
      if (planLimits.max_divisao3 === 0) {
        await dialog.alert({ title: 'Limite do Plano', type: 'error', message: `O plano atual não permite criação de ${nomeD1}. Faça upgrade para habilitar esta divisão.` });
        return;
      }
      if (planLimits.max_divisao3 > 0 && divisoes3.length >= planLimits.max_divisao3) {
        await dialog.alert({ title: 'Limite do Plano', type: 'error', message: `Limite atingido: o plano permite até ${planLimits.max_divisao3} ${nomeD1}(s). Faça upgrade para adicionar mais.` });
        return;
      }
    }

    if (!formD3.status_imovel) {
      await dialog.alert({ title: 'Atenção', message: 'Por favor, selecione o status do imóvel.', type: 'warning' });
      return;
    }

    const uf = (formD3.uf || '').trim().toUpperCase();
    if (uf && uf.length !== 2) {
      await dialog.alert({ title: 'Atenção', message: 'UF inválida. Informe 2 letras (ou deixe em branco).', type: 'warning' });
      return;
    }

    const cepDigits = onlyDigits(formD3.cep);
    if (cepDigits && cepDigits.length !== 8) {
      await dialog.alert({ title: 'Atenção', message: 'CEP inválido. Informe 8 dígitos (ou deixe em branco).', type: 'warning' });
      return;
    }

    // Regra nova: D1 (que usa este formulário) não depende de existir D2/D3.
    // Vínculos (campo/supervisão) são opcionais.

    const enderecoTrim = (formD3.endereco || '').trim();
    const dirigenteTrim = (formD3.dirigente || '').trim();
    const dirigenteCpfTrim = (formD3.dirigente_cpf || '').trim();
    const dirigenteCargoTrim = (formD3.dirigente_cargo || '').trim();
    const dirigenteMatriculaTrim = (formD3.dirigente_matricula || '').trim();
    const municipioTrim = (formD3.municipio || '').trim();

    const payload: any = {
            nome: formD3.nome.trim(),
      dirigente: dirigenteTrim || null,
      dirigente_cpf: dirigenteCpfTrim || null,
      dirigente_cargo: dirigenteCargoTrim || null,
      dirigente_matricula: dirigenteMatriculaTrim || null,
      endereco: enderecoTrim || null,
      cidade: municipioTrim || null,
      uf: uf || null,
      cep: cepDigits || null,
      status_imovel: formD3.status_imovel || null,
      updated_at: new Date().toISOString(),
    };

    // Só enviar supervisao_id quando houver valor (evita erro em bases legadas / coluna ausente)
    // Observação: neste formulário (Igreja) os vínculos são opcionais.
    const supervisaoIdToSave = d2Enabled
      ? null
      : (d3Enabled ? (formD3.supervisao_id || null) : null);
    if (supervisaoIdToSave) {
      payload.supervisao_id = supervisaoIdToSave;
    }

    // Só enviar campo_id quando houver valor (evita erro em bases antigas / colunas ausentes)
    if (d2Enabled && formD3.campo_id) {
      payload.campo_id = formD3.campo_id;
    }

    // Se D2 está habilitado e D1 também, inferir supervisao_id a partir do campo (para facilitar filtros)
    if (d2Enabled && d3Enabled && payload.campo_id) {
      const campo = divisoes2.find(c => c.id === payload.campo_id) || null;
      payload.supervisao_id = campo?.supervisao_id || null;
    }

    const getMissingColumnFromError = (err: any): string | null => {
      const msg = String(err?.message || err?.error_description || '');
      const m = msg.match(/Could not find the '([^']+)' column/i);
      return m?.[1] ? String(m[1]) : null;
    };

    const formatDbError = (err: any) => {
      if (!err) return 'Erro desconhecido';
      if (typeof err === 'string') return err;

      const anyErr = err as any;
      const msg = anyErr?.message || anyErr?.error_description || anyErr?.details || anyErr?.hint || '';
      const code = anyErr?.code || anyErr?.status || '';
      const base = String(msg || 'Erro desconhecido');
      return code ? `${base} (${code})` : base;
    };

    const toDebugObject = (err: any) => {
      // Importante: alguns erros do Supabase/PostgREST possuem propriedades não-enumeráveis.
      // Este helper tenta capturar o máximo possível sem quebrar o console.
      try {
        if (!err) return { value: err };
        if (typeof err !== 'object') return { value: err, type: typeof err };

        const anyErr = err as any;
        const ownNames = (() => {
          try {
            return Object.getOwnPropertyNames(anyErr);
          } catch {
            return [] as string[];
          }
        })();

        const keys = Array.from(new Set([
          ...Object.keys(anyErr),
          ...ownNames,
          'name',
          'message',
          'code',
          'details',
          'hint',
          'status',
          'stack',
        ]));

        const out: Record<string, any> = {
          _string: (() => {
            try { return String(anyErr); } catch { return '[unstringifiable]'; }
          })(),
        };

        for (const k of keys) {
          try {
            out[k] = anyErr[k];
          } catch (e) {
            out[k] = `[threw: ${String((e as any)?.message || e)}]`;
          }
        }

        return out;
      } catch (e) {
        return { _debug_failed: String((e as any)?.message || e) };
      }
    };

    try {
      // Geolocalização automática: ao salvar, tenta preencher latitude/longitude a partir do endereço.
      // (Não é editável manualmente neste formulário.)
      const oldEndereco = (editingD3?.endereco || '').trim();
      const oldCidade = (editingD3?.cidade || '').trim();
      const oldUf = (editingD3?.uf || '').trim().toUpperCase();
      const oldCep = onlyDigits(editingD3?.cep || '');

      const addressChanged = editingD3
        ? (oldEndereco !== enderecoTrim || oldCidade !== municipioTrim || oldUf !== uf || oldCep !== cepDigits)
        : true;

      const hasSomeAddress = !!(enderecoTrim || municipioTrim || uf || cepDigits);
      if (addressChanged && hasSomeAddress) {
        const addressForGeocode = buildGeocodeQuery({
          endereco: enderecoTrim,
          municipio: municipioTrim,
          uf,
          cepDigits,
        });

        const coords = geoPreview?.address === addressForGeocode
          ? { latitude: geoPreview.latitude, longitude: geoPreview.longitude }
          : await geocodeFromAddress(addressForGeocode);
        if (coords) {
          payload.latitude = coords.latitude;
          payload.longitude = coords.longitude;
        }
      }

      const nowIso = new Date().toISOString();
      let savedId = editingD3?.id || null;

      const saveToDb = async (payloadToUse: any) => {
        const res = await authenticatedFetch('/api/v1/secretaria/congregacoes', {
          method: editingD3 ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(editingD3 ? { id: editingD3.id, ...payloadToUse } : payloadToUse),
        });
        const json = await res.json().catch(() => null as any);
        return { data: json?.data, error: res.ok ? null : json?.error } as any;
      };

      let saveResult: any = await saveToDb(payload);
      if (saveResult?.error) {
        const missingCol = getMissingColumnFromError(saveResult.error);
        if (missingCol && Object.prototype.hasOwnProperty.call(payload, missingCol)) {
          const shouldRetry = await dialog.confirm({
            title: 'Schema do Supabase',
            type: 'warning',
            message:
              `Sua base ainda não reconheceu a coluna "${missingCol}" (schema/cache do Supabase).\n\n` +
              `Se você aplicou migração agora, pode ser só cache; tente recarregar a página e aguardar 1-2 minutos.\n` +
              `Deseja salvar mesmo assim (sem esse campo) agora?`,
            confirmText: 'OK',
            cancelText: 'Cancelar',
          });

          if (shouldRetry) {
            const cleanPayload = { ...payload };
            delete (cleanPayload as any)[missingCol];
            saveResult = await saveToDb(cleanPayload);
          }
        } else {
          // Se for PGRST204 (cache) mas não conseguimos remover do payload,
          // tenta um retry simples após uma pequena espera.
          const msg = String(saveResult.error?.message || '');
          const isSchemaCache = /PGRST204/i.test(msg) || /schema cache/i.test(msg);
          if (isSchemaCache) {
            await new Promise(resolve => setTimeout(resolve, 1500));
            saveResult = await saveToDb(payload);
          }
        }
      }

      if (saveResult?.error) throw saveResult.error;

      if (editingD3) {
        savedId = editingD3.id;
      } else {
        const created = saveResult?.data;
        savedId = created?.id ? String(created.id) : null;
      }

      if (!savedId) throw new Error('Não foi possível salvar o registro.');

      // Foto: upload/URL (best-effort) + limpeza da foto antiga
      const oldBucket = editingD3?.foto_bucket || null;
      const oldPath = editingD3?.foto_path || null;
      let didChangePhoto = false;

      if (fotoIgrejaChange.kind === 'file') {
        const uploaded = await uploadFotoIgreja(fotoIgrejaChange.file, savedId);
        const upRes = await authenticatedFetch('/api/v1/secretaria/congregacoes', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: savedId,
            foto_url: uploaded.url,
            foto_bucket: uploaded.bucket,
            foto_path: uploaded.path,
            updated_at: nowIso,
          }),
        });
        if (!upRes.ok) {
          const errJson = await upRes.json().catch(() => null as any);
          throw new Error(errJson?.error || 'Erro ao atualizar foto.');
        }
        didChangePhoto = true;
      }

      if (fotoIgrejaChange.kind === 'url') {
        const url = fotoIgrejaChange.url.trim();
        const upRes = await authenticatedFetch('/api/v1/secretaria/congregacoes', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: savedId,
            foto_url: url,
            foto_bucket: null,
            foto_path: null,
            updated_at: nowIso,
          }),
        });
        if (!upRes.ok) {
          const errJson = await upRes.json().catch(() => null as any);
          throw new Error(errJson?.error || 'Erro ao atualizar foto.');
        }
        didChangePhoto = true;
      }

      if (didChangePhoto && oldBucket && oldPath) {
        await deleteFotoIgreja(oldBucket, oldPath);
      }

      await loadDivisoes3();

      setFormD3({
        supervisao_id: '',
        campo_id: '',
        nome: '',
        dirigente: '',
        dirigente_cpf: '',
        dirigente_cargo: '',
        dirigente_matricula: '',
        endereco: '',
        cep: '',
        municipio: '',
        uf: '',
        status_imovel: '' as any,
        is_active: true,
      });
      setEditingD3(null);
      setShowFormD3(false);
      if (fotoIgrejaChange.kind === 'file') {
        try { URL.revokeObjectURL(fotoIgrejaChange.previewUrl); } catch { /* noop */ }
      }
      setFotoIgrejaChange({ kind: 'none' });
      setFotoIgrejaUrlInput('');
    } catch (error) {
      console.error('Erro ao salvar divisão 03 (raw):', error);
      console.error('Erro ao salvar divisão 03 (debug):', toDebugObject(error));
      const errText = formatDbError(error);
      const tableMissing = /public\.congregacoes/i.test(errText) && /could not find the table|schema cache|PGRST205/i.test(errText);
      await dialog.alert({
        title: 'Erro',
        type: 'error',
        message: tableMissing
          ? 'Erro ao salvar: a tabela public.congregacoes não existe neste banco. Aplique as migrações pendentes da Estrutura Hierárquica e tente novamente.'
          : `Erro ao salvar. ${errText}`,
      });
    }
  };

  const handleDeleteD3 = async (id: string) => {
    const ok = await dialog.confirm({ title: 'Confirmar', type: 'warning', message: 'Tem certeza que deseja deletar?', confirmText: 'OK', cancelText: 'Cancelar' });
    if (!ok) return;
    try {
      const res = await authenticatedFetch('/api/v1/secretaria/congregacoes', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => null as any);
        throw new Error(errJson?.error || 'Erro ao deletar congregacao.');
      }
      await loadDivisoes3();
    } catch (error) {
      console.error('Erro ao deletar divisão 03:', error);
      await dialog.alert({ title: 'Erro', type: 'error', message: 'Erro ao deletar. Tente novamente.' });
    }
  };

  const openNewD1 = () => {
    const nextCodigo = getNextCodigo();
    setActiveTab('divisao3');
    setShowFormD1(true);
    setEditingD1(null);
    setFormD1({
      codigo: String(nextCodigo),
      nome: '',
      uf: '',
      informar_supervisor: false,
      supervisor_cpf_input: '',
      supervisor_member_id: '',
      supervisor_matricula: '',
      supervisor_nome: '',
      supervisor_cpf: '',
      supervisor_data_nascimento: '',
      supervisor_cargo: '',
      supervisor_celular: ''
    });
    setSupervisorStatus('idle');
    setSupervisorMsg('');
  };

  const handleSaveD1 = async () => {
    if (!formD1.nome.trim()) {
      await dialog.alert({ title: 'Atenção', type: 'warning', message: 'Por favor, preencha o nome' });
      return;
    }

    // Verificar limite do plano para 1ª divisão (Supervisão/Regional)
    if (!editingD1) {
      if (planLimits.max_divisao1 === 0) {
        await dialog.alert({ title: 'Limite do Plano', type: 'error', message: `O plano atual não permite criação de ${nomeD3}. Faça upgrade para habilitar esta divisão.` });
        return;
      }
      if (planLimits.max_divisao1 > 0 && divisoes1.length >= planLimits.max_divisao1) {
        await dialog.alert({ title: 'Limite do Plano', type: 'error', message: `Limite atingido: o plano permite até ${planLimits.max_divisao1} ${nomeD3}(s). Faça upgrade para adicionar mais.` });
        return;
      }
    }

    const uf: string | null = null;

    const shouldSaveSupervisor = !!formD1.informar_supervisor;
    const supervisorPayload = shouldSaveSupervisor
      ? {
          supervisor_member_id: null,
          supervisor_matricula: null,
          supervisor_nome: (formD1.supervisor_nome || '').trim() || null,
          supervisor_cpf: null,
          supervisor_data_nascimento: null,
          supervisor_cargo: null,
          supervisor_celular: null,
        }
      : {
          supervisor_member_id: null,
          supervisor_matricula: null,
          supervisor_nome: null,
          supervisor_cpf: null,
          supervisor_data_nascimento: null,
          supervisor_cargo: null,
          supervisor_celular: null,
        };

    const codigoAuto = getNextCodigo();
    const codigoParsedRaw = formD1.codigo.trim() ? Number.parseInt(formD1.codigo.trim(), 10) : null;
    const codigoParsed = Number.isFinite(codigoParsedRaw as any) && (codigoParsedRaw as any) > 0 ? (codigoParsedRaw as number) : null;
    const codigoToSave = editingD1?.codigo && Number.isFinite(editingD1.codigo) ? editingD1.codigo : (codigoParsed ?? codigoAuto);

    try {
      let createdSupervisaoId: string | null = null;

      if (editingD1) {
        // Atualizar
        const res = await authenticatedFetch('/api/v1/secretaria/supervisoes', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: editingD1.id,
            codigo: codigoToSave,
            nome: formD1.nome,
            uf,
            ...supervisorPayload,
            updated_at: new Date().toISOString(),
          }),
        });

        if (!res.ok) {
          const errJson = await res.json().catch(() => null as any);
          throw new Error(errJson?.error || 'Erro ao atualizar supervisao.');
        }
      } else {
        // Criar
        const res = await authenticatedFetch('/api/v1/secretaria/supervisoes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            codigo: codigoToSave,
            nome: formD1.nome,
            uf,
            ...supervisorPayload,
            is_active: true,
          }),
        });

        let resJson = await res.json().catch(() => null as any);
        createdSupervisaoId = resJson?.data?.id || null;

        if (!res.ok) {
          // Em caso de corrida (código duplicado), recalcular e tentar 1 vez.
          const msg = String(resJson?.error || '');
          if (msg.includes('idx_supervisoes_ministry_codigo_unique') || msg.includes('duplicate key')) {
            await loadDivisoes1();
            const retryCodigo = getNextCodigo();
            const retryRes = await authenticatedFetch('/api/v1/secretaria/supervisoes', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                codigo: retryCodigo,
                nome: formD1.nome,
                uf,
                ...supervisorPayload,
                is_active: true,
              }),
            });
            resJson = await retryRes.json().catch(() => null as any);
            if (!retryRes.ok) throw new Error(resJson?.error || 'Erro ao criar supervisao.');
            createdSupervisaoId = resJson?.data?.id || null;
          } else {
            throw new Error(resJson?.error || 'Erro ao criar supervisao.');
          }
        }
      }

      // Associações D2 -> D3 (best-effort): campos.supervisao_id
      {
        const supervisaoId = editingD1?.id || createdSupervisaoId || null;
        // Se criou novo, precisamos descobrir o ID. Como esta tela usa o fluxo
        // de código auto-incremental + unique, a forma mais segura aqui é recarregar
        // e encontrar pelo (ministry_id, codigo).
        let resolvedId = supervisaoId;
        if (!resolvedId) {
          await loadDivisoes1();
          const found = divisoes1.find(s => {
            const codigo = typeof s.codigo === 'number' && Number.isFinite(s.codigo) ? s.codigo : null;
            return codigo === codigoToSave && s.nome === formD1.nome;
          }) || null;
          resolvedId = found?.id || null;
        }

        if (resolvedId) {
          const nowIso = new Date().toISOString();
          const existing = divisoes2
            .filter(c => c.supervisao_id === resolvedId)
            .map(c => c.id);
          const availableIds = new Set(
            divisoes2
              .filter(c => !c.supervisao_id || c.supervisao_id === resolvedId)
              .map(c => c.id)
          );
          const selected = selectedD2IdsForD3.filter(id => availableIds.has(id));
          const toAdd = selected.filter(id => !existing.includes(id));
          const toRemove = existing.filter(id => !selected.includes(id));

          if (toAdd.length) {
            for (const id of toAdd) {
              const res = await authenticatedFetch('/api/v1/secretaria/campos', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, supervisao_id: resolvedId, updated_at: nowIso }),
              });
              if (!res.ok) {
                const errJson = await res.json().catch(() => null as any);
                throw new Error(errJson?.error || 'Erro ao associar campo.');
              }
            }
          }

          if (toRemove.length) {
            for (const id of toRemove) {
              const res = await authenticatedFetch('/api/v1/secretaria/campos', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, supervisao_id: null, updated_at: nowIso }),
              });
              if (!res.ok) {
                const errJson = await res.json().catch(() => null as any);
                throw new Error(errJson?.error || 'Erro ao desassociar campo.');
              }
            }
          }
        }
      }

      // Recarregar lista
      await loadDivisoes1();
      await loadDivisoes2();
      
      // Limpar form
      setFormD1({
        codigo: '',
        nome: '',
        uf: '',
        informar_supervisor: false,
        supervisor_cpf_input: '',
        supervisor_member_id: '',
        supervisor_matricula: '',
        supervisor_nome: '',
        supervisor_cpf: '',
        supervisor_data_nascimento: '',
        supervisor_cargo: '',
        supervisor_celular: ''
      });
      setSupervisorStatus('idle');
      setSupervisorMsg('');
      setSelectedD2IdsForD3([]);
      setEditingD1(null);
      setShowFormD1(false);
    } catch (error) {
      console.error('Erro ao salvar:', error);
      await dialog.alert({ title: 'Erro', type: 'error', message: 'Erro ao salvar. Tente novamente.' });
    }
  };

  const handleDeleteD1 = async (id: string) => {
    const ok = await dialog.confirm({ title: 'Confirmar', type: 'warning', message: 'Tem certeza que deseja deletar?', confirmText: 'OK', cancelText: 'Cancelar' });
    if (!ok) return;

    try {
      const res = await authenticatedFetch('/api/v1/secretaria/supervisoes', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => null as any);
        throw new Error(errJson?.error || 'Erro ao deletar supervisao.');
      }
      
      await loadDivisoes1();
    } catch (error) {
      console.error('Erro ao deletar:', error);
      await dialog.alert({ title: 'Erro', type: 'error', message: 'Erro ao deletar. Tente novamente.' });
    }
  };

  if (loading) return <div className="p-8">Carregando...</div>;

  const tabs = [
    { id: 'divisao2', label: 'Campos', icon: '📍' },
    { id: 'divisao3', label: 'Supervisões', icon: '🗂️' },
    { id: 'importar-csv', label: 'Importar CSV', icon: '📥' },
  ];

  // Lista dinâmica: reflete desmarcações em tempo real
  // Campos desmarcados (que estavam na supervisão atual) ficam visíveis como disponíveis
  const listaDivisoes2ParaModal = divisoes2.filter(c => {
    // Se pertence à supervisão em edição → sempre aparece (marcado ou desmarcado)
    if (editingD1 && c.supervisao_id === editingD1.id) return true;
    // Se pertence a outra supervisão → oculto, a menos que esteja nos selecionados
    if (c.supervisao_id) return false;
    // Campo livre → aparece
    return true;
  });

  const PRINT_HEADER = `
    <div class="header">
      <img class="header-logo" src="${buildUrl(getAppBaseUrl(), '/img/logo_comieadepa.png')}" alt="COMIEADEPA"/>
      <div class="header-center">
        <div class="org">COMIEADEPA - CONVENÇÃO INTERESTADUAL DE MINISTROS E IGREJAS<br/>EVANGÉLICAS ASSEMBLEIA DE DEUS NO PARÁ</div>
        <div class="contact">Emails: comieadepa@bol.com.br / Site: www.comieadepa.org</div>
        <div class="address">RODOVIA DO MÁRIO COVAS, 2500, 67115-000 / COQUEIRO, ANANINDEUA - PA</div>
        <div class="presidente">PRESIDENTE: PR. OCELIO NAUAR</div>
      </div>
    </div>`;

  const PRINT_STYLES = `
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Arial, sans-serif; font-size: 10px; color: #000; padding: 16px; }
    .header { display: flex; align-items: center; justify-content: center; gap: 8px; border-bottom: 2px solid #000; padding-bottom: 10px; margin-bottom: 10px; }
    .header-logo { width: 60px; height: auto; flex-shrink: 0; }
    .header-center { text-align: center; }
    .header-center .org { font-size: 11px; font-weight: bold; line-height: 1.4; }
    .header-center .contact { font-size: 9px; color: #333; margin-top: 3px; }
    .header-center .address { font-size: 9px; font-weight: bold; margin-top: 2px; }
    .header-center .presidente { font-size: 11px; font-weight: bold; color: #0066cc; margin-top: 6px; }
    .report-title { text-align: center; font-size: 13px; font-weight: bold; margin: 12px 0 10px; border-bottom: 1px solid #000; padding-bottom: 6px; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    thead tr { background: #000; color: #fff; }
    th { padding: 5px 6px; text-align: left; font-size: 9px; font-weight: bold; }
    td { padding: 4px 6px; font-size: 9px; border-bottom: 1px solid #ddd; vertical-align: top; }
    tr:nth-child(even) td { background: #f5f5f5; }
    @media print { body { padding: 8px; } @page { margin: 10mm; size: A4 landscape; } }`;

  function handlePrintCampos(lista: typeof divisoes2) {
    const filtros: string[] = [];
    if (filterUfCampos) filtros.push(`Estado: ${filterUfCampos}`);
    if (filterSupCampos) { const s = divisoes1.find(s => s.id === filterSupCampos); if (s) filtros.push(`Supervisão: ${s.nome}`); }
    if (filterCnpjCampos) filtros.push(filterCnpjCampos === 'sim' ? 'Com CNPJ' : 'Sem CNPJ');
    if (searchCampos) filtros.push(`Busca: "${searchCampos}"`);
    const titulo = `LISTA DE CAMPOS${filtros.length ? ' — ' + filtros.join(' | ') : ''} — QTD.: ${lista.length}`;
    const rows = lista.map(c => {
      const sup = divisoes1.find(s => s.id === c.supervisao_id);
      return `<tr>
        <td>${sup ? sup.nome : '—'}</td>
        <td>${c.uf || '—'}</td>
        <td>${c.nome}</td>
        <td>${(c as any).presidente_nome || '—'}</td>
        <td>${c.cnpj ? 'SIM' : 'NÃO'}</td>
      </tr>`;
    }).join('');
    const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"/><title>${titulo}</title><style>${PRINT_STYLES}</style></head><body>
      ${PRINT_HEADER}
      <div class="report-title">${titulo}</div>
      <table><thead><tr><th>SUPERVISÃO</th><th>UF</th><th>NOME DO CAMPO</th><th>PRESIDENTE</th><th>CNPJ</th></tr></thead><tbody>${rows}</tbody></table>
    </body></html>`;
    const win = window.open('', '_blank', 'width=1100,height=750');
    if (!win) return;
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 600);
  }

  function handlePrintSupervisoes(lista: typeof divisoes1) {
    const filtros: string[] = [];
    if (filterUfSups) filtros.push(`Estado: ${filterUfSups}`);
    if (searchSups) filtros.push(`Busca: "${searchSups}"`);
    const titulo = `LISTA DE SUPERVISÕES${filtros.length ? ' — ' + filtros.join(' | ') : ''} — QTD.: ${lista.length}`;
    const rows = lista.map(d => {
      const qtd = divisoes2.filter(c => c.supervisao_id === d.id).length;
      return `<tr>
        <td>${d.nome}</td>
        <td>${(d as any).uf || '—'}</td>
        <td>${d.supervisor_nome || '—'}</td>
        <td style="text-align:center">${qtd}</td>
      </tr>`;
    }).join('');
    const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"/><title>${titulo}</title><style>${PRINT_STYLES.replace('size: A4 landscape', 'size: A4 portrait')}</style></head><body>
      ${PRINT_HEADER}
      <div class="report-title">${titulo}</div>
      <table><thead><tr><th>NOME DA SUPERVISÃO</th><th>UF</th><th>PASTOR/SUPERVISOR</th><th style="text-align:center">QTD CAMPOS</th></tr></thead><tbody>${rows}</tbody></table>
    </body></html>`;
    const win = window.open('', '_blank', 'width=1100,height=750');
    if (!win) return;
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 600);
  }

  return (
    <PageLayout
      title="Supervisões e Campos"
      description="Gerenciar Campos e Supervisões do ministério"
      activeMenu="estrutura-hierarquica"
    >
      <div className="w-full max-w-7xl mx-auto px-1 sm:px-2 lg:px-4">
      {/* Abas */}
      <Tabs tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab}>
        {tabs.length === 0 && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 text-center">
            <p className="text-yellow-900 font-semibold">⚠️ Nenhuma divisão habilitada</p>
            <p className="text-yellow-700 text-sm mt-2">
              Vá em Configurações → Nomenclaturas e escolha uma divisão diferente de “NENHUMA”.
            </p>
          </div>
        )}

        {/* TAB: 1ª Divisão (Agora: Congregações / antigo formulário da Divisão 03) */}
        {d1Enabled && activeTab === 'divisao1' && (
          <Section icon="1️⃣" title={`${nomeD1}s`}>
            <div className="grid grid-cols-1 gap-4 mb-6">
              <div className="bg-white p-4 rounded-lg shadow border-l-4 border-blue-500">
                <p className="text-gray-600 text-sm">Total de {nomeD1}s</p>
                <p className="text-2xl font-bold text-blue-600">{divisoes3.length}</p>
              </div>
            </div>

            {showFormD3 && (
              <div className="bg-white rounded-lg shadow-md p-6 mb-6">
                <h3 className="text-lg font-bold text-gray-800 mb-4">
                  {editingD3 ? `Editar ${nomeD1}` : `Nova ${nomeD1}`}
                </h3>

                <div className="space-y-4">
                  {/* Removido: CAMPO/SUPERVISÃO (conforme imagem/UX) */}

                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                      Nome da {nomeD1}
                    </label>
                    <input
                      type="text"
                      value={formD3.nome}
                      onChange={(e) => setFormD3(prev => ({ ...prev, nome: e.target.value }))}
                      placeholder={`Ex: ${nomeD1} Central`}
                      className="w-full px-4 py-2 border-2 border-teal-500 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                      Dirigente
                    </label>
                    <input
                      type="text"
                      value={formD3.dirigente}
                      onChange={(e) => {
                        const v = e.target.value;
                        setFormD3(prev => ({
                          ...prev,
                          dirigente: v,
                          dirigente_cpf: '',
                          dirigente_cargo: '',
                          dirigente_matricula: '',
                        }));
                        setDirigenteSelected(null);
                        setDirigenteStatus('idle');
                        setDirigenteMsg('');
                      }}
                      placeholder="Ex: Pr. João Silva"
                      className="w-full px-4 py-2 border-2 border-teal-500 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <p className="text-xs text-gray-600 mt-2">
                      {dirigenteStatus === 'loading'
                        ? 'Buscando...'
                        : dirigenteMsg || (dirigenteSelected ? 'Dirigente selecionado.' : 'Digite pelo menos 2 letras para buscar na lista de ministros.')}
                    </p>

                    {dirigenteResults.length > 0 && !dirigenteSelected && (
                      <div className="mt-2 border border-gray-200 rounded-lg bg-white overflow-hidden">
                        {dirigenteResults.map(m => {
                          const cargo = String(getMinisterCargo(m) || '').trim();
                          const matricula = String(getMemberMatricula(m) || '').trim();
                          const cpf = String(m.cpf || '').trim();
                          return (
                            <button
                              type="button"
                              key={m.id}
                              onClick={() => {
                                setFormD3(prev => ({
                                  ...prev,
                                  dirigente: m.name,
                                  dirigente_cpf: cpf,
                                  dirigente_cargo: cargo,
                                  dirigente_matricula: matricula,
                                }));
                                setDirigenteSelected({ id: m.id, name: m.name });
                                setDirigenteResults([]);
                                setDirigenteStatus('selected');
                                setDirigenteMsg('Dirigente selecionado.');
                              }}
                              className="w-full text-left px-4 py-2 hover:bg-gray-50 text-sm"
                            >
                              <span className="font-semibold text-gray-800">{m.name}</span>
                              {cargo ? <span className="text-gray-500"> — {cargo}</span> : null}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="bg-white rounded-lg border border-gray-200 p-4">
                    <p className="text-sm font-semibold text-gray-800 mb-3">Dados do Dirigente</p>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2">CPF</label>
                        <input
                          type="text"
                          value={formD3.dirigente_cpf}
                          onChange={(e) => setFormD3(prev => ({ ...prev, dirigente_cpf: formatCpf(e.target.value) }))}
                          placeholder="Ex: 00000000000"
                          className="w-full px-4 py-2 border-2 border-teal-500 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2">Cargo</label>
                        <input
                          type="text"
                          value={formD3.dirigente_cargo}
                          onChange={(e) => setFormD3(prev => ({ ...prev, dirigente_cargo: e.target.value }))}
                          placeholder="Ex: Pastor"
                          className="w-full px-4 py-2 border-2 border-teal-500 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2">Matrícula</label>
                        <input
                          type="text"
                          value={formD3.dirigente_matricula}
                          onChange={(e) => setFormD3(prev => ({ ...prev, dirigente_matricula: e.target.value }))}
                          placeholder="Ex: 12345"
                          className="w-full px-4 py-2 border-2 border-teal-500 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Endereço</label>
                    <input
                      type="text"
                      value={formD3.endereco}
                      onChange={(e) => setFormD3(prev => ({ ...prev, endereco: e.target.value }))}
                      placeholder="Ex: Rua X, 123"
                      className="w-full px-4 py-2 border-2 border-teal-500 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">CEP</label>
                      <input
                        type="text"
                        value={formD3.cep}
                        onChange={(e) => setFormD3(prev => ({ ...prev, cep: e.target.value }))}
                        placeholder="Somente números"
                        className="w-full px-4 py-2 border-2 border-teal-500 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">Município</label>
                      <input
                        type="text"
                        value={formD3.municipio}
                        onChange={(e) => setFormD3(prev => ({ ...prev, municipio: e.target.value }))}
                        placeholder="Ex: Santos"
                        className="w-full px-4 py-2 border-2 border-teal-500 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">UF</label>
                      <input
                        type="text"
                        value={formD3.uf}
                        onChange={(e) => setFormD3(prev => ({ ...prev, uf: e.target.value.toUpperCase().slice(0, 2) }))}
                        placeholder="Ex: SP"
                        maxLength={2}
                        className="w-full px-4 py-2 border-2 border-teal-500 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                      Status do imóvel
                    </label>
                    <select
                      value={formD3.status_imovel}
                      onChange={(e) => setFormD3(prev => ({ ...prev, status_imovel: e.target.value as any }))}
                      className="w-full px-4 py-2 border-2 border-teal-500 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">Selecione</option>
                      <option value="PROPRIO">Próprio</option>
                      <option value="ALUGADO">Alugado</option>
                      <option value="CEDIDO">Cedido</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Geolocalização</label>
                    <input
                      type="text"
                      value={
                        geoPreview
                          ? `${geoPreview.latitude}, ${geoPreview.longitude}`
                          : (editingD3?.latitude != null && editingD3?.longitude != null
                            ? `${editingD3.latitude}, ${editingD3.longitude}`
                            : '')
                      }
                      disabled
                      placeholder="Gerado automaticamente ao salvar"
                      className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg bg-gray-100 text-gray-700"
                    />
                    <p className="text-xs text-gray-600 mt-1">
                      Este campo é preenchido automaticamente com base no endereço e não pode ser editado aqui.
                    </p>
                  </div>

                  <div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Card: upload/URL */}
                      <div className="bg-white border border-gray-200 rounded-lg p-4">
                        <div className="text-sm font-semibold text-gray-700 text-center">Foto da Igreja</div>
                        <div className="text-xs text-gray-600 mt-1 text-center">
                          Envie um arquivo ou informe uma URL. A imagem será redimensionada e comprimida automaticamente.
                        </div>

                        <div className="mt-4 flex flex-col items-center gap-4">
                          <input
                            id="foto-igreja-file"
                            type="file"
                            accept="image/*"
                            onChange={(e) => {
                              const file = e.target.files?.[0] || null;
                              if (!file) return;

                              if (fotoIgrejaChange.kind === 'file') {
                                try { URL.revokeObjectURL(fotoIgrejaChange.previewUrl); } catch { /* noop */ }
                              }

                              const previewUrl = URL.createObjectURL(file);
                              setFotoIgrejaChange({ kind: 'file', file, previewUrl });
                            }}
                            className="hidden"
                          />

                          <div className="w-full flex flex-col items-center gap-2">
                            <label
                              htmlFor="foto-igreja-file"
                              className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-semibold cursor-pointer"
                            >
                              Selecionar foto
                            </label>
                            <div className="w-full text-center text-sm text-gray-700 truncate">
                              {fotoIgrejaChange.kind === 'file'
                                ? fotoIgrejaChange.file.name
                                : 'Nenhum arquivo selecionado'}
                            </div>
                          </div>

                          <div className="w-full flex flex-col items-center gap-2">
                            <input
                              type="url"
                              value={fotoIgrejaUrlInput}
                              onChange={(e) => setFotoIgrejaUrlInput(e.target.value)}
                              placeholder="(opcional) URL da foto"
                              className="w-full px-4 py-2 border-2 border-teal-500 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                const url = fotoIgrejaUrlInput.trim();
                                if (!url) return;
                                if (fotoIgrejaChange.kind === 'file') {
                                  try { URL.revokeObjectURL(fotoIgrejaChange.previewUrl); } catch { /* noop */ }
                                }
                                setFotoIgrejaChange({ kind: 'url', url });
                              }}
                              className="px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-800 transition font-semibold"
                            >
                              Usar URL
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Card: pré-visualização */}
                      <div className="bg-white border border-gray-200 rounded-lg p-4">
                        <div className="text-sm font-semibold text-gray-700 text-center">Pré-visualização</div>
                        <div className="mt-4 flex items-center justify-center">
                          <div className="w-full h-52 border border-gray-200 rounded-lg bg-gray-50 p-3 flex items-center justify-center">
                            {(() => {
                              const preview =
                                fotoIgrejaChange.kind === 'file'
                                  ? fotoIgrejaChange.previewUrl
                                  : fotoIgrejaChange.kind === 'url'
                                    ? fotoIgrejaChange.url
                                    : (editingD3?.foto_url || '');

                              if (!preview) {
                                return <div className="text-sm text-gray-500">Sem foto</div>;
                              }

                              return (
                                <img
                                  src={preview}
                                  alt="Pré-visualização"
                                  className="max-w-full max-h-full object-contain rounded-md"
                                  loading="lazy"
                                />
                              );
                            })()}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-3 pt-4">
                    <button
                      onClick={handleSaveD3}
                      className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition font-semibold"
                    >
                      {editingD3 ? '💾 Atualizar' : '✓ Salvar'}
                    </button>
                    <button
                      onClick={() => {
                        setShowFormD3(false);
                        setEditingD3(null);
                        setGeoPreview(null);
                        setDirigenteResults([]);
                        setDirigenteStatus('idle');
                        setDirigenteMsg('');
                        setDirigenteSelected(null);
                        setFormD3({
                          supervisao_id: '',
                          campo_id: '',
                          nome: '',
                          dirigente: '',
                          dirigente_cpf: '',
                          dirigente_cargo: '',
                          dirigente_matricula: '',
                          endereco: '',
                          cep: '',
                          municipio: '',
                          uf: '',
                          status_imovel: '' as any,
                          is_active: true,
                        });
                      }}
                      className="flex-1 px-4 py-2 bg-gray-400 text-white rounded-lg hover:bg-gray-500 transition font-semibold"
                    >
                      ✕ Cancelar
                    </button>
                  </div>
                </div>
              </div>
            )}

            {!showFormD3 && (
              <div className="mb-6 flex gap-3">
                <button
                  onClick={() => {
                    if (planLimits.max_divisao3 === 0) return;
                    if (planLimits.max_divisao3 > 0 && divisoes3.length >= planLimits.max_divisao3) return;
                    setShowFormD3(true);
                    setEditingD3(null);
                    setGeoPreview(null);
                    setDirigenteResults([]);
                    setDirigenteStatus('idle');
                    setDirigenteMsg('');
                    setDirigenteSelected(null);
                    setFormD3({
                      supervisao_id: '',
                      campo_id: '',
                      nome: '',
                      dirigente: '',
                      dirigente_cpf: '',
                      dirigente_cargo: '',
                      dirigente_matricula: '',
                      endereco: '',
                      cep: '',
                      municipio: '',
                      uf: '',
                      status_imovel: '' as any,
                      is_active: true,
                    });
                    if (fotoIgrejaChange.kind === 'file') {
                      try { URL.revokeObjectURL(fotoIgrejaChange.previewUrl); } catch { /* noop */ }
                    }
                    setFotoIgrejaChange({ kind: 'none' });
                    setFotoIgrejaUrlInput('');
                  }}
                  disabled={planLimits.max_divisao3 === 0 || (planLimits.max_divisao3 > 0 && divisoes3.length >= planLimits.max_divisao3)}
                  title={
                    planLimits.max_divisao3 === 0
                      ? `Plano atual não permite ${nomeD1}`
                      : planLimits.max_divisao3 > 0 && divisoes3.length >= planLimits.max_divisao3
                        ? `Limite do plano atingido (${planLimits.max_divisao3})`
                        : undefined
                  }
                  className={`flex-1 px-6 py-3 font-bold rounded-lg transition shadow-md flex items-center justify-center gap-2 ${
                    planLimits.max_divisao3 === 0 || (planLimits.max_divisao3 > 0 && divisoes3.length >= planLimits.max_divisao3)
                      ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                      : 'bg-teal-500 text-white hover:bg-teal-600'
                  }`}
                >
                  + Adicionar {nomeD1}
                  {planLimits.max_divisao3 > 0 && (
                    <span className="text-xs opacity-80">({divisoes3.length}/{planLimits.max_divisao3})</span>
                  )}
                  {planLimits.max_divisao3 === 0 && <span className="text-xs opacity-80">(bloqueado no plano)</span>}
                </button>
              </div>
            )}

            <div className="bg-white rounded-lg shadow-md p-6">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-200 text-gray-800">
                      <th className="px-4 py-3 text-left font-semibold">SETOR</th>
                      <th className="px-4 py-3 text-left font-semibold">NOME</th>
                      <th className="px-4 py-3 text-left font-semibold">DIRIGENTE</th>
                      <th className="px-4 py-3 text-left font-semibold">CONDIÇÃO</th>
                      <th className="px-4 py-3 text-center font-semibold">AÇÕES</th>
                    </tr>
                  </thead>
                <tbody>
                  {divisoes3.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-center text-gray-500">
                        Nenhuma {nomeD1} cadastrada
                      </td>
                    </tr>
                  ) : (
                    divisoes3.map(cg => {
                      const campo = d2Enabled && cg.campo_id
                        ? divisoes2.find(c => c.id === cg.campo_id) || null
                        : null;
                      const sup = (!d2Enabled && d3Enabled && cg.supervisao_id)
                        ? divisoes1.find(s => s.id === cg.supervisao_id) || null
                        : null;

                      return (
                        <tr key={cg.id} className="border-b border-gray-200 hover:bg-gray-50">
                          <td className="px-4 py-3 text-gray-700">
                            {campo ? formatCampoLabel(campo) : (sup ? formatSupervisaoLabel(sup) : '-')}
                          </td>
                          <td className="px-4 py-3 font-semibold text-gray-800">{cg.nome}</td>
                          <td className="px-4 py-3 text-gray-700">{String((cg as any).dirigente || '').trim() || '-'}</td>
                          <td className="px-4 py-3 text-gray-700">
                            {cg.status_imovel === 'PROPRIO'
                              ? 'Própria'
                              : cg.status_imovel === 'ALUGADO'
                                ? 'Alugada'
                                : cg.status_imovel === 'CEDIDO'
                                  ? 'Cedida'
                                  : '-'}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <button
                              onClick={() => {
                                setEditingD3(cg);
                                setShowFormD3(true);
                                setGeoPreview(null);
                                setDirigenteResults([]);
                                setDirigenteStatus('idle');
                                setDirigenteMsg('');
                                setFormD3({
                                  supervisao_id: (cg.supervisao_id as any) || '',
                                  campo_id: (cg.campo_id as any) || '',
                                  nome: cg.nome || '',
                                  dirigente: (cg as any).dirigente || '',
                                  dirigente_cpf: (cg as any).dirigente_cpf || '',
                                  dirigente_cargo: (cg as any).dirigente_cargo || '',
                                  dirigente_matricula: (cg as any).dirigente_matricula || '',
                                  endereco: (cg.endereco as any) || '',
                                  cep: (cg.cep as any) || '',
                                  municipio: (cg.cidade as any) || '',
                                  uf: (cg.uf as any) || '',
                                  status_imovel: (cg.status_imovel as any) || '',
                                  is_active: !!cg.is_active,
                                });
                                const existingDirigente = String((cg as any).dirigente || '').trim();
                                setDirigenteSelected(existingDirigente ? { id: 'existing', name: existingDirigente } : null);
                                if (fotoIgrejaChange.kind === 'file') {
                                  try { URL.revokeObjectURL(fotoIgrejaChange.previewUrl); } catch { /* noop */ }
                                }
                                setFotoIgrejaChange({ kind: 'none' });
                                setFotoIgrejaUrlInput('');
                              }}
                              className="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 transition text-xs font-semibold"
                            >
                              Editar
                            </button>
                            <button
                              onClick={() => handleDeleteD3(cg.id)}
                              className="ml-2 px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600 transition text-xs font-semibold"
                            >
                              Deletar
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
                </table>
              </div>
            </div>
          </Section>
        )}

        {/* TAB: 2ª Divisão */}
        {activeTab === 'divisao2' && (
          <Section icon="📍" title="Campos">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
              <div className="bg-white p-4 rounded-lg shadow border-l-4 border-blue-500">
                <p className="text-gray-600 text-sm">Total de {nomeD2}s</p>
                <p className="text-2xl font-bold text-blue-600">{divisoes2.length}</p>
              </div>
              <div className="bg-white p-4 rounded-lg shadow border-l-4 border-orange-400">
                <p className="text-gray-600 text-sm">Campos sem supervisão</p>
                <p className="text-2xl font-bold text-orange-500">{divisoes2.filter(c => !c.supervisao_id).length}</p>
              </div>
            </div>

            <>
              {showFormD2 && (
                <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 overflow-y-auto">
                  <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl mt-8 mb-8">
                    <div className="flex items-center justify-between px-6 py-4 border-b bg-teal-600 rounded-t-xl">
                      <h3 className="text-lg font-bold text-white">
                        {editingD2 ? '✏️ Editar Campo' : '➕ Novo Campo'}
                      </h3>
                      <button
                        onClick={() => { setShowFormD2(false); setEditingD2(null); setFormD2({ supervisao_id: '', nome: '', is_sede: false, data_fundacao: '', cnpj: '', possui_cnpj: false, email: '', telefone: '', observacoes: '', logomarca_url: '', informar_pastor: false, pastor_nome_input: '', pastor_member_id: '', pastor_nome: '', pastor_data_posse: '', cep: '', endereco: '', numero: '', complemento: '', bairro: '', cidade: '', uf: '', latitude: '', longitude: '' }); setPastorResults([]); setPastorStatus('idle'); setPastorMsg(''); setSelectedD1IdsForD2([]); }}
                        className="text-white hover:text-teal-200 text-2xl font-bold leading-none"
                      >×</button>
                    </div>
                    <div className="p-6">

                    {/* Linha 1: Nome, Data Fundação, Logomarca */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                      <div>
                        <label className="block text-xs font-semibold text-gray-700 mb-1">Nome do Campo *</label>
                        <input
                          type="text"
                          value={formD2.nome}
                          onChange={(e) => setFormD2(prev => ({ ...prev, nome: e.target.value }))}
                          placeholder="Nome do Campo"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-700 mb-1">Data da Fundação</label>
                        <input
                          type="date"
                          value={formD2.data_fundacao}
                          onChange={(e) => setFormD2(prev => ({ ...prev, data_fundacao: e.target.value }))}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-700 mb-1">Observações</label>
                        <textarea
                          value={formD2.observacoes}
                          onChange={(e) => setFormD2(prev => ({ ...prev, observacoes: e.target.value }))}
                          placeholder="Inserir Observações aqui..."
                          rows={2}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none"
                        />
                      </div>
                    </div>

                    {/* Linha 2: CNPJ, Email, Telefone */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                      <div>
                        <label className="flex items-center gap-2 text-xs font-semibold text-gray-700 mb-1">
                          <button
                            type="button"
                            onClick={() => setFormD2(prev => ({ ...prev, possui_cnpj: !prev.possui_cnpj, cnpj: '' }))}
                            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${formD2.possui_cnpj ? 'bg-teal-500' : 'bg-gray-300'}`}
                          >
                            <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${formD2.possui_cnpj ? 'translate-x-4' : 'translate-x-0.5'}`} />
                          </button>
                          Possui CNPJ?
                        </label>
                        <input
                          type="text"
                          value={formD2.cnpj}
                          disabled={!formD2.possui_cnpj}
                          onChange={(e) => setFormD2(prev => ({ ...prev, cnpj: e.target.value.replace(/\D/g, '').slice(0, 14) }))}
                          placeholder="Somente Números"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:bg-gray-100 disabled:text-gray-400"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-700 mb-1">Email do Campo</label>
                        <input
                          type="email"
                          value={formD2.email}
                          onChange={(e) => setFormD2(prev => ({ ...prev, email: e.target.value }))}
                          placeholder="email@campo.org"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-700 mb-1">Telefone do Campo</label>
                        <input
                          type="text"
                          value={formD2.telefone}
                          onChange={(e) => setFormD2(prev => ({ ...prev, telefone: e.target.value.replace(/\D/g, '').slice(0, 11) }))}
                          placeholder="Somente Números"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                        />
                      </div>
                    </div>

                    {/* Pastor do Campo */}
                    <div className="mb-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
                      <div className="flex items-center gap-3 mb-3">
                        <button
                          type="button"
                          onClick={() => {
                            const checked = !formD2.informar_pastor;
                            setFormD2(prev => ({
                              ...prev,
                              informar_pastor: checked,
                              pastor_nome_input: checked ? prev.pastor_nome_input : '',
                              pastor_member_id: checked ? prev.pastor_member_id : '',
                              pastor_nome: checked ? prev.pastor_nome : '',
                              pastor_data_posse: checked ? prev.pastor_data_posse : ''
                            }));
                            if (!checked) { setPastorResults([]); setPastorStatus('idle'); setPastorMsg(''); }
                          }}
                          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${formD2.informar_pastor ? 'bg-teal-500' : 'bg-gray-300'}`}
                        >
                          <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${formD2.informar_pastor ? 'translate-x-4' : 'translate-x-0.5'}`} />
                        </button>
                        <span className="text-sm font-semibold text-gray-800">Informar Pastor Presidente do Campo?</span>
                      </div>

                      {formD2.informar_pastor && (
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          <div className="md:col-span-2">
                            <label className="block text-xs font-semibold text-gray-700 mb-1">Nome do Presidente</label>
                            <input
                              type="text"
                              value={formD2.pastor_nome_input}
                              onChange={(e) => {
                                const v = e.target.value;
                                setFormD2(prev => ({ ...prev, pastor_nome_input: v, pastor_member_id: '', pastor_nome: '' }));
                                setPastorStatus('idle'); setPastorMsg('');
                              }}
                              placeholder="Digite para buscar..."
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                            />
                            <p className="text-xs text-gray-500 mt-1">
                              {pastorStatus === 'loading' ? 'Buscando...' : pastorMsg || (formD2.pastor_member_id ? '✓ Pastor selecionado.' : 'Digite pelo menos 2 letras.')}
                            </p>
                            {pastorResults.length > 0 && !formD2.pastor_member_id && (
                              <div className="mt-1 border border-gray-200 rounded-lg bg-white overflow-hidden shadow">
                                {pastorResults.map(m => (
                                  <button type="button" key={m.id}
                                    onClick={() => { setFormD2(prev => ({ ...prev, pastor_member_id: m.id, pastor_nome: m.name, pastor_nome_input: m.name })); setPastorResults([]); setPastorStatus('selected'); setPastorMsg('Pastor selecionado.'); }}
                                    className="w-full text-left px-3 py-2 hover:bg-gray-50 text-sm border-b border-gray-100"
                                  >
                                    <span className="font-semibold text-gray-800">{m.name}</span>
                                    {m.role ? <span className="text-gray-500 ml-1">— {m.role}</span> : null}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-gray-700 mb-1">Data Posse</label>
                            <input
                              type="date"
                              value={formD2.pastor_data_posse}
                              onChange={(e) => setFormD2(prev => ({ ...prev, pastor_data_posse: e.target.value }))}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                            />
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Endereço */}
                    <div className="mb-4">
                      <h4 className="text-sm font-bold text-gray-700 mb-3 border-b pb-2">* Informe o Endereço do Campo:</h4>
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
                        <div>
                          <label className="block text-xs font-semibold text-red-600 mb-1">DIGITE O CEP:</label>
                          <input
                            type="text"
                            value={formD2.cep}
                            onChange={(e) => setFormD2(prev => ({ ...prev, cep: e.target.value.replace(/\D/g, '').slice(0, 8) }))}
                            onBlur={async () => {
                              const cep = formD2.cep.replace(/\D/g, '');
                              if (cep.length !== 8) return;
                              try {
                                const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
                                const d = await r.json();
                                if (!d.erro) setFormD2(prev => ({ ...prev, endereco: d.logradouro || '', bairro: d.bairro || '', cidade: d.localidade || '', uf: d.uf || '' }));
                              } catch {}
                            }}
                            placeholder="00000000"
                            className="w-full px-3 py-2 border border-red-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
                          />
                        </div>
                        <div className="md:col-span-2">
                          <label className="block text-xs font-semibold text-gray-700 mb-1">Endereço:</label>
                          <input type="text" value={formD2.endereco}
                            onChange={(e) => setFormD2(prev => ({ ...prev, endereco: e.target.value }))}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-gray-700 mb-1">N.º:</label>
                          <input type="text" value={formD2.numero}
                            onChange={(e) => setFormD2(prev => ({ ...prev, numero: e.target.value }))}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                        <div>
                          <label className="block text-xs font-semibold text-gray-700 mb-1">Complemento:</label>
                          <input type="text" value={formD2.complemento}
                            onChange={(e) => setFormD2(prev => ({ ...prev, complemento: e.target.value }))}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-gray-700 mb-1">Bairro:</label>
                          <input type="text" value={formD2.bairro}
                            onChange={(e) => setFormD2(prev => ({ ...prev, bairro: e.target.value }))}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-gray-700 mb-1">Cidade:</label>
                          <input type="text" value={formD2.cidade}
                            onChange={(e) => setFormD2(prev => ({ ...prev, cidade: e.target.value }))}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-gray-700 mb-1">UF:</label>
                          <input type="text" value={formD2.uf} maxLength={2}
                            onChange={(e) => setFormD2(prev => ({ ...prev, uf: e.target.value.toUpperCase().slice(0, 2) }))}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                          />
                        </div>
                      </div>
                      <div className="mt-3">
                        <label className="block text-xs font-semibold text-gray-700 mb-1">
                          📍 Geo-Localização da Sede:
                          <span className="ml-1 text-gray-400 font-normal">(preenchido automaticamente pelo endereço)</span>
                        </label>
                        <input
                          type="text"
                          readOnly
                          value={formD2.latitude && formD2.longitude ? `${formD2.latitude}, ${formD2.longitude}` : ''}
                          placeholder="Aguardando endereço..."
                          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 text-gray-500 cursor-not-allowed"
                        />
                      </div>
                    </div>

                    <div className="flex gap-3 pt-4">
                      <button onClick={handleSaveD2}
                        className="flex-1 px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition font-bold text-sm"
                      >
                        {editingD2 ? '💾 Atualizar' : '✓ Cadastrar'}
                      </button>
                      <button
                        onClick={() => {
                          setShowFormD2(false); setEditingD2(null);
                          setFormD2({ supervisao_id: '', nome: '', is_sede: false, data_fundacao: '', cnpj: '', possui_cnpj: false, email: '', telefone: '', observacoes: '', logomarca_url: '', informar_pastor: false, pastor_nome_input: '', pastor_member_id: '', pastor_nome: '', pastor_data_posse: '', cep: '', endereco: '', numero: '', complemento: '', bairro: '', cidade: '', uf: '', latitude: '', longitude: '' });
                          setPastorResults([]); setPastorStatus('idle'); setPastorMsg(''); setSelectedD1IdsForD2([]);
                        }}
                        className="flex-1 px-4 py-2 bg-gray-400 text-white rounded-lg hover:bg-gray-500 transition font-bold text-sm"
                      >
                        ✕ Cancelar
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
                <div className="mb-6 flex gap-3">
                    <button
                      onClick={() => {
                        if (planLimits.max_divisao2 === 0) return;
                        if (planLimits.max_divisao2 > 0 && divisoes2.length >= planLimits.max_divisao2) return;
                        setShowFormD2(true);
                        setEditingD2(null);
                        setFormD2({ supervisao_id: '', nome: '', is_sede: false, data_fundacao: '', cnpj: '', possui_cnpj: false, email: '', telefone: '', observacoes: '', logomarca_url: '', informar_pastor: false, pastor_nome_input: '', pastor_member_id: '', pastor_nome: '', pastor_data_posse: '', cep: '', endereco: '', numero: '', complemento: '', bairro: '', cidade: '', uf: '', latitude: '', longitude: '' });
                        setPastorResults([]);
                        setPastorStatus('idle');
                        setPastorMsg('');
                        setSelectedD1IdsForD2([]);
                      }}
                      className="flex-1 px-6 py-3 font-bold rounded-lg transition shadow-md flex items-center justify-center gap-2 bg-teal-500 text-white hover:bg-teal-600"
                    >
                      + Adicionar Campo
                    </button>
                  </div>
            </>

            <div className="bg-white rounded-lg shadow-md p-6">
              {/* Filtros */}
              <div className="flex flex-wrap gap-2 mb-4 items-center">
                {/* ESTADO */}
                <select
                  value={filterUfCampos}
                  onChange={(e) => { setFilterUfCampos(e.target.value); setPageCampos(0); }}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white"
                >
                  <option value="">DEFINA O ESTADO:</option>
                  {Array.from(new Set(divisoes2.map(c => c.uf).filter((v): v is string => !!v))).sort().map(uf => (
                    <option key={uf} value={uf}>{uf}</option>
                  ))}
                </select>

                {/* SUPERVISÃO */}
                <select
                  value={filterSupCampos}
                  onChange={(e) => { setFilterSupCampos(e.target.value); setPageCampos(0); }}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white"
                >
                  <option value="">SUPERVISÃO:</option>
                  {divisoes1.slice().sort((a, b) => a.nome.localeCompare(b.nome)).map(s => (
                    <option key={s.id} value={s.id}>{s.nome}</option>
                  ))}
                </select>

                {/* CNPJ */}
                <select
                  value={filterCnpjCampos}
                  onChange={(e) => { setFilterCnpjCampos(e.target.value); setPageCampos(0); }}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white"
                >
                  <option value="">CNPJ:</option>
                  <option value="sim">Com CNPJ</option>
                  <option value="nao">Sem CNPJ</option>
                </select>

                {/* Busca texto */}
                <div className="relative flex-1 min-w-[200px]">
                  <input
                    type="text"
                    value={searchCampos}
                    onChange={(e) => { setSearchCampos(e.target.value); setPageCampos(0); }}
                    placeholder="DIGITE SUA BUSCA..."
                    className="w-full pl-4 pr-10 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">🔍</span>
                </div>

                {/* LIMPAR */}
                <button
                  onClick={() => { setSearchCampos(''); setFilterUfCampos(''); setFilterSupCampos(''); setFilterCnpjCampos(''); setPageCampos(0); }}
                  className="px-4 py-2 bg-teal-600 text-white text-sm font-semibold rounded-lg hover:bg-teal-700 transition"
                >
                  LIMPAR
                </button>
                <button
                  onClick={() => {
                    const q = searchCampos.toLowerCase();
                    const lista = divisoes2.filter(c => {
                      if (filterUfCampos && (c.uf || '') !== filterUfCampos) return false;
                      if (filterSupCampos && c.supervisao_id !== filterSupCampos) return false;
                      if (filterCnpjCampos === 'sim' && !c.cnpj) return false;
                      if (filterCnpjCampos === 'nao' && c.cnpj) return false;
                      if (q) { const s = divisoes1.find(s => s.id === c.supervisao_id); return c.nome.toLowerCase().includes(q) || (c.cidade||'').toLowerCase().includes(q) || (c.uf||'').toLowerCase().includes(q) || (c.pastor_nome||'').toLowerCase().includes(q) || ((c as any).presidente_nome||'').toLowerCase().includes(q) || (s ? s.nome.toLowerCase().includes(q) : false); }
                      return true;
                    });
                    handlePrintCampos(lista);
                  }}
                  className="px-4 py-2 bg-gray-700 text-white text-sm font-semibold rounded-lg hover:bg-gray-800 transition flex items-center gap-1"
                >
                  🖨️ Imprimir lista
                </button>
              </div>

              {/* Info */}
              {(() => {
                const q = searchCampos.toLowerCase();
                const filtered = divisoes2.filter(c => {
                  if (filterUfCampos && (c.uf || '') !== filterUfCampos) return false;
                  if (filterSupCampos && c.supervisao_id !== filterSupCampos) return false;
                  if (filterCnpjCampos === 'sim' && !c.cnpj) return false;
                  if (filterCnpjCampos === 'nao' && c.cnpj) return false;
                  if (q) {
                    const s = divisoes1.find(s => s.id === c.supervisao_id);
                    return (
                      c.nome.toLowerCase().includes(q) ||
                      (c.cidade || '').toLowerCase().includes(q) ||
                      (c.uf || '').toLowerCase().includes(q) ||
                      (c.pastor_nome || '').toLowerCase().includes(q) ||
                      ((c as any).presidente_nome || '').toLowerCase().includes(q) ||
                      (s ? s.nome.toLowerCase().includes(q) : false)
                    );
                  }
                  return true;
                });
                const totalPages = Math.ceil(filtered.length / PAGE_SIZE_CAMPOS) || 1;
                const safePage = Math.min(pageCampos, totalPages - 1);
                const paged = filtered.slice(safePage * PAGE_SIZE_CAMPOS, (safePage + 1) * PAGE_SIZE_CAMPOS);

                return (
                  <>
                    <p className="text-xs text-gray-500 mb-3 text-right">
                      {filtered.length > PAGE_SIZE_CAMPOS && <span className="mr-1">página {safePage + 1} de {totalPages} —</span>}
                      {filtered.length} de {divisoes2.length} campo(s){' '}
                      <span className="inline-flex items-center justify-center w-9 h-6 bg-blue-600 text-white rounded-full font-bold text-xs">{filtered.length}</span>
                    </p>
                    <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr>
                          <th className="px-4 py-3 text-left font-semibold bg-gray-200 text-gray-800">SUPERVISÃO</th>
                          <th className="px-4 py-3 text-left font-semibold bg-gray-200 text-gray-800">ESTADO</th>
                          <th className="px-4 py-3 text-left font-semibold bg-gray-200 text-gray-800">NOME</th>
                          <th className="px-4 py-3 text-left font-semibold bg-gray-200 text-gray-800">PRESIDENTE</th>
                          <th className="px-4 py-3 text-center font-semibold bg-gray-200 text-gray-800">CNPJ?</th>
                          <th className="px-4 py-3 text-center font-semibold bg-gray-200 text-gray-800">AÇÕES</th>
                        </tr>
                      </thead>
                      <tbody>
                        {paged.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="px-4 py-6 text-center text-gray-500">
                              {(searchCampos || filterUfCampos || filterSupCampos || filterCnpjCampos) ? 'Nenhum campo encontrado para os filtros aplicados.' : `Nenhum ${nomeD2} cadastrado`}
                            </td>
                          </tr>
                        ) : (
                          paged.map(c => {
                            const sup = c.supervisao_id
                              ? divisoes1.find(s => s.id === c.supervisao_id) || null
                              : null;
                            return (
                              <tr key={c.id} className="border-b border-gray-200 hover:bg-gray-50">
                                <td className="px-4 py-3 text-gray-700 text-xs">{sup ? sup.nome : '-'}</td>
                                <td className="px-4 py-3 text-gray-700 text-xs">{c.uf || '-'}</td>
                                <td className="px-4 py-3 text-gray-700 font-semibold text-xs">{c.nome}</td>
                                <td className="px-4 py-3 text-gray-700 text-xs">{(c as any).presidente_nome || '-'}</td>
                                <td className="px-4 py-3 text-center text-xs">
                                  {c.cnpj
                                    ? <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded font-semibold">SIM</span>
                                    : <span className="px-2 py-0.5 bg-yellow-100 text-yellow-700 rounded font-semibold">NÃO</span>}
                                </td>
                                <td className="px-4 py-3 text-center">
                                  <button
                                    onClick={() => {
                                      setEditingD2(c);
                                      setShowFormD2(true);
                                      setFormD2({
                                        supervisao_id: c.supervisao_id || '',
                                        nome: c.nome || '',
                                        is_sede: !!c.is_sede,
                                        data_fundacao: (c.data_fundacao as any) || '',
                                        cnpj: c.cnpj || '',
                                        possui_cnpj: !!c.cnpj,
                                        email: c.email || '',
                                        telefone: c.telefone || '',
                                        observacoes: c.observacoes || '',
                                        logomarca_url: c.logomarca_url || '',
                                        informar_pastor: !!c.pastor_member_id,
                                        pastor_nome_input: c.pastor_nome || '',
                                        pastor_member_id: c.pastor_member_id || '',
                                        pastor_nome: c.pastor_nome || '',
                                        pastor_data_posse: (c.pastor_data_posse as any) || '',
                                        cep: c.cep || '',
                                        endereco: c.endereco || '',
                                        numero: c.numero || '',
                                        complemento: c.complemento || '',
                                        bairro: c.bairro || '',
                                        cidade: c.cidade || '',
                                        uf: c.uf || '',
                                        latitude: c.latitude != null ? String(c.latitude) : '',
                                        longitude: c.longitude != null ? String(c.longitude) : '',
                                      });
                                      setSelectedD1IdsForD2(divisoes3.filter(cg => cg.campo_id === c.id).map(cg => cg.id));
                                      setPastorResults([]);
                                      setPastorStatus(c.pastor_member_id ? 'selected' : 'idle');
                                      setPastorMsg(c.pastor_member_id ? 'Pastor selecionado.' : '');
                                    }}
                                    className="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 transition text-xs font-semibold mr-1"
                                  >
                                    ✏️ Editar
                                  </button>
                                  <button
                                    onClick={() => handleDeleteD2(c.id)}
                                    className="px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600 transition text-xs font-semibold"
                                  >
                                    🗑️ Excluir
                                  </button>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                    </div>

                    {/* Paginação */}
                    {totalPages > 1 && (
                      <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-200">
                        <button
                          onClick={() => setPageCampos(p => Math.max(0, p - 1))}
                          disabled={safePage === 0}
                          className="px-4 py-2 text-sm font-semibold rounded-lg border border-gray-300 disabled:opacity-40 hover:bg-gray-50 transition"
                        >
                          ← Anterior
                        </button>
                        <div className="flex items-center gap-1">
                          {Array.from({ length: Math.min(totalPages, 9) }, (_, i) => {
                            let pg: number;
                            if (totalPages <= 9) {
                              pg = i;
                            } else if (safePage < 5) {
                              if (i < 7) pg = i;
                              else if (i === 7) return <span key="e1" className="px-2 text-gray-400">…</span>;
                              else pg = totalPages - 1;
                            } else if (safePage > totalPages - 6) {
                              if (i === 0) pg = 0;
                              else if (i === 1) return <span key="e1" className="px-2 text-gray-400">…</span>;
                              else pg = totalPages - (9 - i);
                            } else {
                              if (i === 0) pg = 0;
                              else if (i === 1) return <span key="e1" className="px-2 text-gray-400">…</span>;
                              else if (i === 7) return <span key="e2" className="px-2 text-gray-400">…</span>;
                              else if (i === 8) pg = totalPages - 1;
                              else pg = safePage + (i - 4);
                            }
                            return (
                              <button
                                key={pg}
                                onClick={() => setPageCampos(pg)}
                                className={`w-9 h-9 rounded-lg text-sm font-semibold transition ${pg === safePage ? 'bg-teal-600 text-white' : 'border border-gray-300 hover:bg-gray-50 text-gray-700'}`}
                              >
                                {pg + 1}
                              </button>
                            );
                          })}
                        </div>
                        <button
                          onClick={() => setPageCampos(p => Math.min(totalPages - 1, p + 1))}
                          disabled={safePage >= totalPages - 1}
                          className="px-4 py-2 text-sm font-semibold rounded-lg border border-gray-300 disabled:opacity-40 hover:bg-gray-50 transition"
                        >
                          Próxima →
                        </button>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          </Section>
        )}

        {/* TAB: 3ª Divisão (Congregações) */}
        {activeTab === 'divisao3' && (
          <Section icon="🗂️" title="Supervisões">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
              <div className="bg-white p-4 rounded-lg shadow border-l-4 border-blue-500">
                <p className="text-gray-600 text-sm">Total de {nomeD3}s</p>
                <p className="text-2xl font-bold text-blue-600">{divisoes1.length}</p>
              </div>
              <div className="bg-white p-4 rounded-lg shadow border-l-4 border-orange-400">
                <p className="text-gray-600 text-sm">Supervisões sem campo</p>
                <p className="text-2xl font-bold text-orange-500">{divisoes1.filter(s => !divisoes2.some(c => c.supervisao_id === s.id)).length}</p>
              </div>
            </div>
            {showFormD1 && (
              <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 overflow-y-auto">
                <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl mt-8 mb-8">
                  <div className="flex items-center justify-between px-6 py-4 border-b bg-teal-600 rounded-t-xl">
                    <h3 className="text-lg font-bold text-white">
                      {editingD1 ? `✏️ Editar ${nomeD3}` : `➕ Nova ${nomeD3}`}
                    </h3>
                    <button
                      onClick={() => { setShowFormD1(false); setEditingD1(null); setFormD1({ codigo: '', nome: '', uf: '', informar_supervisor: false, supervisor_cpf_input: '', supervisor_member_id: '', supervisor_matricula: '', supervisor_nome: '', supervisor_cpf: '', supervisor_data_nascimento: '', supervisor_cargo: '', supervisor_celular: '' }); setSupervisorStatus('idle'); setSupervisorMsg(''); setSupervisorSearchInput(''); setSupervisorResults([]); setSupervisorSearchStatus('idle'); setSelectedD2IdsForD3([]); }}
                      className="text-white hover:text-teal-200 text-2xl font-bold leading-none"
                    >×</button>
                  </div>
                  <div className="p-6">
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Nome da {nomeD3}</label>
                    <input
                      type="text"
                      value={formD1.nome}
                      onChange={(e) => setFormD1({ ...formD1, nome: e.target.value })}
                      placeholder={`Ex: ${nomeD3} Norte`}
                      className="w-full px-4 py-2 border-2 border-teal-500 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div>
                    <label className="inline-flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={!!formD1.informar_supervisor}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setFormD1(prev => ({
                            ...prev,
                            informar_supervisor: checked,
                            supervisor_nome: checked ? prev.supervisor_nome : '',
                            supervisor_cpf_input: '',
                            supervisor_member_id: '',
                            supervisor_matricula: '',
                            supervisor_cpf: '',
                            supervisor_data_nascimento: '',
                            supervisor_cargo: '',
                            supervisor_celular: '',
                          }));
                          setSupervisorStatus('idle');
                          setSupervisorMsg('');
                          setSupervisorCpfResults([]);
                          setSupervisorCpfStatus('idle');
                          setSupervisorCpfMsg('');
                        }}
                        className="h-5 w-5"
                      />
                      <span className="text-sm font-semibold text-gray-800">Informar Pastor/Supervisor</span>
                    </label>
                  </div>

                  {formD1.informar_supervisor && (
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">Nome do Supervisor</label>
                      <input
                        type="text"
                        value={supervisorSearchInput}
                        onChange={(e) => {
                          const v = e.target.value;
                          setSupervisorSearchInput(v);
                          if (!v) { setFormD1(prev => ({ ...prev, supervisor_nome: '', supervisor_member_id: '' })); setSupervisorResults([]); setSupervisorSearchStatus('idle'); }
                        }}
                        placeholder="Digite 3+ letras para buscar..."
                        className="w-full px-4 py-2 border-2 border-teal-500 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        {supervisorSearchStatus === 'loading' ? 'Buscando...' : supervisorSearchStatus === 'not_found' ? 'Nenhum membro encontrado.' : formD1.supervisor_member_id ? '✓ Supervisor selecionado.' : supervisorSearchInput.length >= 3 ? '' : 'Digite pelo menos 3 letras.'}
                      </p>
                      {supervisorResults.length > 0 && !formD1.supervisor_member_id && (
                        <div className="mt-1 border border-gray-200 rounded-lg bg-white overflow-hidden shadow z-10 relative">
                          {supervisorResults.map(m => (
                            <button type="button" key={m.id}
                              onClick={() => {
                                setFormD1(prev => ({ ...prev, supervisor_nome: m.name, supervisor_member_id: m.id }));
                                setSupervisorSearchInput(m.name);
                                setSupervisorResults([]);
                                setSupervisorSearchStatus('selected');
                              }}
                              className="w-full text-left px-3 py-2 hover:bg-gray-50 text-sm border-b border-gray-100"
                            >
                              <span className="font-semibold text-gray-800">{m.name}</span>
                              {m.role ? <span className="text-gray-500 ml-1">— {m.role}</span> : null}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="bg-white rounded-lg border border-gray-200 p-4">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-sm font-semibold text-gray-800">Adicionar {nomeD2}s (opcional)</p>
                      {camposLocked ? (
                        <button
                          type="button"
                          onClick={() => setCamposLocked(false)}
                          className="flex items-center gap-1 px-3 py-1 text-xs font-semibold bg-yellow-400 hover:bg-yellow-500 text-yellow-900 rounded-lg transition"
                        >
                          🔒 Editar campos
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setCamposLocked(true)}
                          className="flex items-center gap-1 px-3 py-1 text-xs font-semibold bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg transition"
                        >
                          🔓 Travar
                        </button>
                      )}
                    </div>
                    <p className="text-xs text-gray-600 mb-3">Selecionados: {selectedD2IdsForD3.length}</p>
                    {camposLocked ? (
                      <div className="relative max-h-48 overflow-hidden rounded-lg border border-gray-200 select-none">
                        <div className="absolute inset-0 bg-gray-100/70 z-10 flex items-center justify-center rounded-lg">
                          <span className="text-xs text-gray-500 font-semibold">🔒 Clique em "Editar campos" para modificar</span>
                        </div>
                        <div className="opacity-50">
                          {listaDivisoes2ParaModal.slice(0, 5).map(c => (
                            <div key={c.id} className="flex items-center gap-3 px-4 py-2 border-b border-gray-100 text-sm">
                              <input type="checkbox" checked={selectedD2IdsForD3.includes(c.id)} readOnly className="h-4 w-4" />
                              <span className="text-gray-800 font-semibold">{c.nome}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : listaDivisoes2ParaModal.length === 0 ? (
                      <p className="text-sm text-gray-600">Nenhum {nomeD2} disponível para esta {nomeD3}.</p>
                    ) : (
                      <div className="max-h-48 overflow-auto border border-yellow-300 rounded-lg bg-white ring-2 ring-yellow-400">
                        {listaDivisoes2ParaModal.map(c => {
                          const checked = selectedD2IdsForD3.includes(c.id);
                          return (
                            <label key={c.id} className="flex items-center gap-3 px-4 py-2 border-b border-gray-100 text-sm cursor-pointer hover:bg-yellow-50">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => {
                                  const isChecked = e.target.checked;
                                  setSelectedD2IdsForD3(prev => {
                                    if (isChecked) return prev.includes(c.id) ? prev : [...prev, c.id];
                                    return prev.filter(id => id !== c.id);
                                  });
                                }}
                                className="h-4 w-4"
                              />
                              <span className="text-gray-800 font-semibold">{c.nome}</span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="flex gap-3 pt-4">
                    <button onClick={handleSaveD1} className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition font-semibold">
                      {editingD1 ? '💾 Atualizar' : '✓ Salvar'}
                    </button>
                    <button
                      onClick={() => {
                        setShowFormD1(false);
                        setEditingD1(null);
                        setFormD1({
                          codigo: '',
                          nome: '',
                          uf: '',
                          informar_supervisor: false,
                          supervisor_cpf_input: '',
                          supervisor_member_id: '',
                          supervisor_matricula: '',
                          supervisor_nome: '',
                          supervisor_cpf: '',
                          supervisor_data_nascimento: '',
                          supervisor_cargo: '',
                          supervisor_celular: ''
                        });
                        setSupervisorStatus('idle');
                        setSupervisorMsg('');
                        setSelectedD2IdsForD3([]);
                      }}
                      className="flex-1 px-4 py-2 bg-gray-400 text-white rounded-lg hover:bg-gray-500 transition font-semibold"
                    >
                      ✕ Cancelar
                    </button>
                  </div>
                </div>
                  </div>
                </div>
              </div>
            )}

            {!showFormD1 && (
              <div className="mb-6 flex gap-3">
                <button
                  onClick={() => {
                    if (planLimits.max_divisao1 === 0) return;
                    if (planLimits.max_divisao1 > 0 && divisoes1.length >= planLimits.max_divisao1) return;
                    openNewD1();
                  }}
                  disabled={planLimits.max_divisao1 === 0 || (planLimits.max_divisao1 > 0 && divisoes1.length >= planLimits.max_divisao1)}
                  title={
                    planLimits.max_divisao1 === 0
                      ? `Plano atual não permite ${nomeD3}`
                      : planLimits.max_divisao1 > 0 && divisoes1.length >= planLimits.max_divisao1
                        ? `Limite do plano atingido (${planLimits.max_divisao1})`
                        : undefined
                  }
                  className={`flex-1 px-6 py-3 font-bold rounded-lg transition shadow-md flex items-center justify-center gap-2 ${
                    planLimits.max_divisao1 === 0 || (planLimits.max_divisao1 > 0 && divisoes1.length >= planLimits.max_divisao1)
                      ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                      : 'bg-teal-500 text-white hover:bg-teal-600'
                  }`}
                >
                  + Adicionar {nomeD3}
                  {planLimits.max_divisao1 > 0 && planLimits.max_divisao1 < 999 && (
                    <span className="text-xs opacity-80">({divisoes1.length}/{planLimits.max_divisao1})</span>
                  )}
                  {planLimits.max_divisao1 === 0 && <span className="text-xs opacity-80">(bloqueado no plano)</span>}
                </button>
              </div>
            )}

            <div className="bg-white rounded-lg shadow-md p-6">
              {/* Filtros */}
              <div className="flex flex-wrap gap-2 mb-4 items-center">
                <select
                  value={filterUfSups}
                  onChange={(e) => { setFilterUfSups(e.target.value); setPageSups(0); }}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white"
                >
                  <option value="">DEFINA O ESTADO:</option>
                  {Array.from(new Set(divisoes1.map(d => (d as any).uf).filter((v): v is string => !!v))).sort().map(uf => (
                    <option key={uf} value={uf}>{uf}</option>
                  ))}
                </select>

                <div className="relative flex-1 min-w-[200px]">
                  <input
                    type="text"
                    value={searchSups}
                    onChange={(e) => { setSearchSups(e.target.value); setPageSups(0); }}
                    placeholder="DIGITE SUA BUSCA..."
                    className="w-full pl-4 pr-10 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">🔍</span>
                </div>

                <button
                  onClick={() => { setSearchSups(''); setFilterUfSups(''); setPageSups(0); }}
                  className="px-4 py-2 bg-teal-600 text-white text-sm font-semibold rounded-lg hover:bg-teal-700 transition"
                >
                  LIMPAR BUSCA
                </button>
                <button
                  onClick={() => {
                    const q = searchSups.toLowerCase();
                    const lista = divisoes1.filter(d => {
                      if (filterUfSups && (d as any).uf !== filterUfSups) return false;
                      if (q) return d.nome.toLowerCase().includes(q) || (d.supervisor_nome || '').toLowerCase().includes(q);
                      return true;
                    });
                    handlePrintSupervisoes(lista);
                  }}
                  className="px-4 py-2 bg-gray-700 text-white text-sm font-semibold rounded-lg hover:bg-gray-800 transition flex items-center gap-1"
                >
                  🖨️ Imprimir lista
                </button>


              </div>

              {(() => {
                const q = searchSups.toLowerCase();
                const filtered = divisoes1.filter(d => {
                  if (filterUfSups && (d as any).uf !== filterUfSups) return false;
                  if (q) return d.nome.toLowerCase().includes(q) || (d.supervisor_nome || '').toLowerCase().includes(q);
                  return true;
                });
                const totalPages = Math.ceil(filtered.length / PAGE_SIZE_SUPS) || 1;
                const safePage = Math.min(pageSups, totalPages - 1);
                const paged = filtered.slice(safePage * PAGE_SIZE_SUPS, (safePage + 1) * PAGE_SIZE_SUPS);

                return (
                  <>
                    <p className="text-xs text-gray-500 mb-3 text-right">
                      {filtered.length > PAGE_SIZE_SUPS && <span className="mr-1">página {safePage + 1} de {totalPages} —</span>}
                      {filtered.length} de {divisoes1.length} supervisão(ões){' '}
                      <span className="inline-flex items-center justify-center w-9 h-6 bg-blue-600 text-white rounded-full font-bold text-xs">{filtered.length}</span>
                    </p>
                    <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr>
                          <th className="px-4 py-3 text-left font-semibold bg-gray-200 text-gray-800 w-6"></th>
                          <th className="px-4 py-3 text-left font-semibold bg-gray-200 text-gray-800">NOME</th>
                          <th className="px-4 py-3 text-left font-semibold bg-gray-200 text-gray-800">PASTOR/SUPERVISOR</th>
                          <th className="px-4 py-3 text-left font-semibold bg-gray-200 text-gray-800">QTD DE CAMPOS</th>
                          <th className="px-4 py-3 text-center font-semibold bg-gray-200 text-gray-800">Ações</th>
                        </tr>
                      </thead>
                      <tbody>
                        {paged.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="px-4 py-6 text-center text-gray-500">
                              {(searchSups || filterUfSups) ? 'Nenhuma supervisão encontrada para os filtros aplicados.' : `Nenhuma ${nomeD3} cadastrada`}
                            </td>
                          </tr>
                        ) : (
                          paged.map(d => {
                            const camposDaSup = divisoes2.filter(c => c.supervisao_id === d.id);
                            const qtdSetor = camposDaSup.length;
                            const isExpanded = expandedSupId === d.id;
                            return (
                              <>
                                <tr key={d.id} className={`border-b border-gray-200 cursor-pointer transition ${isExpanded ? 'bg-teal-50' : 'hover:bg-gray-50'}`}
                                  onClick={() => setExpandedSupId(isExpanded ? null : d.id)}>
                                  <td className="px-3 py-3 text-gray-400 text-xs font-bold select-none">
                                    {isExpanded ? '▾' : '▸'}
                                  </td>
                                  <td className="px-4 py-3 text-gray-700 font-semibold">{d.nome}</td>
                                  <td className="px-4 py-3 text-gray-700">{d.supervisor_nome || '-'}</td>
                                  <td className="px-4 py-3 text-gray-700 font-semibold">
                                    <span className={`inline-flex items-center justify-center px-2 py-0.5 rounded-full text-xs font-bold ${qtdSetor === 0 ? 'bg-orange-100 text-orange-600' : 'bg-teal-100 text-teal-700'}`}>{qtdSetor}</span>
                                  </td>
                                  <td className="px-4 py-3 text-center" onClick={e => e.stopPropagation()}>
                                    <button
                                      onClick={() => {
                                        setEditingD1(d);
                                        setFormD1({
                                          codigo: d.codigo ? String(d.codigo) : '',
                                          nome: d.nome || '',
                                          uf: '',
                                          informar_supervisor: !!(d.supervisor_nome || d.supervisor_member_id),
                                          supervisor_cpf_input: '',
                                          supervisor_member_id: '',
                                          supervisor_matricula: '',
                                          supervisor_nome: d.supervisor_nome || '',
                                          supervisor_cpf: '',
                                          supervisor_data_nascimento: '',
                                          supervisor_cargo: '',
                                          supervisor_celular: ''
                                        });
                                        setSelectedD2IdsForD3(divisoes2.filter(c => c.supervisao_id === d.id).map(c => c.id));
                                        setSupervisorStatus('idle');
                                        setSupervisorMsg('');
                                        setSupervisorSearchInput(d.supervisor_nome || '');
                                        setSupervisorResults([]);
                                        setSupervisorSearchStatus('idle');
                                        setCamposLocked(true);
                                        setShowFormD1(true);
                                      }}
                                      className="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 transition text-xs font-semibold"
                                    >
                                      Editar
                                    </button>
                                    <button onClick={() => handleDeleteD1(d.id)} className="ml-2 px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600 transition text-xs font-semibold">
                                      Deletar
                                    </button>
                                  </td>
                                </tr>
                                {isExpanded && (
                                  <tr key={`${d.id}-expand`} className="bg-teal-50 border-b border-teal-200">
                                    <td colSpan={5} className="px-6 py-3">
                                      {camposDaSup.length === 0 ? (
                                        <p className="text-xs text-orange-500 font-semibold py-2">⚠️ Esta supervisão não possui campos vinculados.</p>
                                      ) : (
                                        <table className="w-full text-xs border border-teal-200 rounded-lg overflow-hidden">
                                          <thead>
                                            <tr className="bg-teal-600 text-white">
                                              <th className="px-3 py-2 text-left">NOME DO CAMPO</th>
                                              <th className="px-3 py-2 text-left">UF</th>
                                              <th className="px-3 py-2 text-left">PRESIDENTE</th>
                                              <th className="px-3 py-2 text-center">CNPJ?</th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {camposDaSup.map((c, idx) => (
                                              <tr key={c.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-teal-50/50'}>
                                                <td className="px-3 py-1.5 font-semibold text-gray-800">{c.nome}</td>
                                                <td className="px-3 py-1.5 text-gray-600">{c.uf || '—'}</td>
                                                <td className="px-3 py-1.5 text-gray-600">{(c as any).presidente_nome || '—'}</td>
                                                <td className="px-3 py-1.5 text-center">
                                                  {c.cnpj
                                                    ? <span className="px-1.5 py-0.5 bg-green-100 text-green-700 rounded font-semibold">SIM</span>
                                                    : <span className="px-1.5 py-0.5 bg-yellow-100 text-yellow-700 rounded font-semibold">NÃO</span>}
                                                </td>
                                              </tr>
                                            ))}
                                          </tbody>
                                        </table>
                                      )}
                                    </td>
                                  </tr>
                                )}
                              </>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                    </div>

                    {/* Paginação */}
                    {totalPages > 1 && (
                      <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-200">
                        <button
                          onClick={() => setPageSups(p => Math.max(0, p - 1))}
                          disabled={safePage === 0}
                          className="px-4 py-2 text-sm font-semibold rounded-lg border border-gray-300 disabled:opacity-40 hover:bg-gray-50 transition"
                        >
                          ← Anterior
                        </button>
                        <div className="flex items-center gap-1">
                          {Array.from({ length: Math.min(totalPages, 9) }, (_, i) => {
                            let pg: number;
                            if (totalPages <= 9) {
                              pg = i;
                            } else if (safePage < 5) {
                              if (i < 7) pg = i;
                              else if (i === 7) return <span key="e1" className="px-2 text-gray-400">…</span>;
                              else pg = totalPages - 1;
                            } else if (safePage > totalPages - 6) {
                              if (i === 0) pg = 0;
                              else if (i === 1) return <span key="e1" className="px-2 text-gray-400">…</span>;
                              else pg = totalPages - (9 - i);
                            } else {
                              if (i === 0) pg = 0;
                              else if (i === 1) return <span key="e1" className="px-2 text-gray-400">…</span>;
                              else if (i === 7) return <span key="e2" className="px-2 text-gray-400">…</span>;
                              else if (i === 8) pg = totalPages - 1;
                              else pg = safePage + (i - 4);
                            }
                            return (
                              <button
                                key={pg}
                                onClick={() => setPageSups(pg)}
                                className={`w-9 h-9 rounded-lg text-sm font-semibold transition ${pg === safePage ? 'bg-teal-600 text-white' : 'border border-gray-300 hover:bg-gray-50 text-gray-700'}`}
                              >
                                {pg + 1}
                              </button>
                            );
                          })}
                        </div>
                        <button
                          onClick={() => setPageSups(p => Math.min(totalPages - 1, p + 1))}
                          disabled={safePage >= totalPages - 1}
                          className="px-4 py-2 text-sm font-semibold rounded-lg border border-gray-300 disabled:opacity-40 hover:bg-gray-50 transition"
                        >
                          Próxima →
                        </button>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          </Section>
        )}

        {/* ── ABA: Importar CSV ─────────────────────────────────────────── */}
        {activeTab === 'importar-csv' && (
          <Section icon="📥" title="Importar CSV">
            <div className="bg-white rounded-xl shadow-md p-6 space-y-4">
              {/* Sub-abas Campos / Supervisões */}
              <div className="flex border-b">
              <button
                onClick={() => { setCsvImportTab('campos'); setCsvCamposRows([]); setCsvResult(null); }}
                className={`flex-1 py-3 text-sm font-semibold ${csvImportTab === 'campos' ? 'border-b-2 border-blue-600 text-blue-700' : 'text-gray-500 hover:text-gray-700'}`}
              >
                📍 Campos
              </button>
              <button
                onClick={() => { setCsvImportTab('supervisoes'); setCsvSupRows([]); setCsvResult(null); }}
                className={`flex-1 py-3 text-sm font-semibold ${csvImportTab === 'supervisoes' ? 'border-b-2 border-blue-600 text-blue-700' : 'text-gray-500 hover:text-gray-700'}`}
              >
                🗂️ Supervisões
              </button>
            </div>

              {/* Instruções e modelo */}
              {csvImportTab === 'campos' ? (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-900">
                  <p className="font-semibold mb-1">Colunas do CSV para Campos (cabeçalhos aceitos):</p>
                  <p className="font-mono text-xs bg-white border border-blue-100 rounded p-2 overflow-x-auto whitespace-nowrap">
                    NOME DO CAMPO, SUPERVISÃO, DATA FUNDAÇÃO, EMAIL CAMPO, ENDEREÇO, NUMERO END, BAIRRO, CEP, CIDADE, UF, COMPLEMENTO, CNPJ, TEM CNPJ?, OBS, PASTOR SUPERVISOR, DATA DA POSSE, PRESIDENTE NOME, REGISTRO COMIEADEPA
                  </p>
                  <p className="mt-2 text-xs text-blue-700">• Separador: vírgula <code>,</code> ou ponto-e-vírgula <code>;</code> • Codificação: UTF-8 • Apenas <strong>NOME DO CAMPO</strong> é obrigatório • Datas aceitas: <code>Apr 14, 2025 12:00 am</code>, <code>2025-04-14</code> ou <code>14/04/2025</code></p>
                </div>
              ) : (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-900">
                  <p className="font-semibold mb-1">Colunas do CSV para Supervisões (cabeçalhos aceitos):</p>
                  <p className="font-mono text-xs bg-white border border-blue-100 rounded p-2 overflow-x-auto whitespace-nowrap">
                    NOME DA SUPERVISÃO; MATRICULA SUPERVISOR; PASTOR SUPERVISOR; CPF DO SUPERVISOR; UF
                  </p>
                  <p className="mt-2 text-xs text-blue-700">• Separador: vírgula <code>,</code> ou ponto-e-vírgula <code>;</code> • Codificação: UTF-8 • Apenas <strong>NOME DA SUPERVISÃO</strong> é obrigatório • Se <strong>MATRICULA SUPERVISOR</strong> não for informada, será gerada automaticamente</p>
                </div>
              )}

              {/* Upload de arquivo */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Selecione o arquivo CSV:</label>
                <input
                  type="file"
                  accept=".csv,text/csv,text/plain"
                  onChange={(e) => handleCsvFileChange(e, csvImportTab)}
                  className="block w-full text-sm text-gray-700 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 border border-gray-300 rounded-lg cursor-pointer"
                />
              </div>

              {/* Resultado da importação */}
              {csvResult && (
                <div className={`rounded-lg p-4 text-sm ${csvResult.errors.length === 0 ? 'bg-green-50 border border-green-200 text-green-800' : 'bg-yellow-50 border border-yellow-200 text-yellow-800'}`}>
                  <p className="font-semibold">
                    {csvResult.errors.length === 0
                      ? `✅ ${csvResult.ok} registro(s) importado(s) com sucesso!`
                      : `⚠️ ${csvResult.ok} importado(s) com sucesso, ${csvResult.errors.length} erro(s).`}
                  </p>
                  {csvResult.errors.length > 0 && (
                    <ul className="mt-2 text-xs space-y-1 list-disc list-inside">
                      {csvResult.errors.map((e, i) => <li key={i}>{e}</li>)}
                    </ul>
                  )}
                </div>
              )}

              {/* Preview dos dados */}
              {csvImportTab === 'campos' && csvCamposRows.length > 0 && !csvResult && (
                <div>
                  <p className="text-sm font-semibold text-gray-700 mb-2">Preview ({csvCamposRows.length} linha(s)):</p>
                  <div className="overflow-x-auto border border-gray-200 rounded-lg max-h-72 overflow-y-auto">
                    <table className="w-full text-xs whitespace-nowrap">
                      <thead className="bg-gray-100 sticky top-0">
                        <tr>
                          <th className="px-2 py-1 text-left">Nome do Campo</th>
                          <th className="px-2 py-1 text-left">Supervisão</th>
                          <th className="px-2 py-1 text-left">Cidade/UF</th>
                          <th className="px-2 py-1 text-left">Pastor/Supervisor</th>
                          <th className="px-2 py-1 text-left">Data Posse</th>
                          <th className="px-2 py-1 text-left">Endereço</th>
                          <th className="px-2 py-1 text-center">CNPJ?</th>
                          <th className="px-2 py-1 text-left">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {csvCamposRows.map((row, i) => (
                          <tr key={i} className={`border-t ${row._error ? 'bg-red-50' : 'hover:bg-gray-50'}`}>
                            <td className="px-2 py-1 font-semibold">{row.nome || <span className="text-red-500">(vazio)</span>}</td>
                            <td className="px-2 py-1 text-gray-600">{row.supervisao_nome || '-'}</td>
                            <td className="px-2 py-1 text-gray-600">{[row.cidade, row.uf].filter(Boolean).join('/') || '-'}</td>
                            <td className="px-2 py-1 text-gray-600">{row.pastor_nome || '-'}</td>
                            <td className="px-2 py-1 text-gray-600">{(row as any).pastor_data_posse || '-'}</td>
                            <td className="px-2 py-1 text-gray-600 max-w-[160px] truncate">{[row.endereco, row.numero].filter(Boolean).join(', ') || '-'}</td>
                            <td className="px-2 py-1 text-center">
                              {(row.cnpj || ['sim','yes','true','1','s'].includes((row.tem_cnpj||'').toLowerCase().trim()))
                                ? <span className="px-1 bg-green-100 text-green-700 rounded">SIM</span>
                                : <span className="px-1 bg-gray-100 text-gray-500 rounded">NÃO</span>}
                            </td>
                            <td className="px-2 py-1">{row._error ? <span className="text-red-600">⚠ {row._error}</span> : <span className="text-green-600">✓ OK</span>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    {csvCamposRows.filter(r => !r._error && r.nome).length} válidos · {csvCamposRows.filter(r => !!r._error).length} com erro (serão ignorados)
                  </p>
                </div>
              )}

              {csvImportTab === 'supervisoes' && csvSupRows.length > 0 && !csvResult && (
                <div>
                  <p className="text-sm font-semibold text-gray-700 mb-2">Preview ({csvSupRows.length} linha(s)):</p>
                  <div className="overflow-x-auto border border-gray-200 rounded-lg max-h-64 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-100 sticky top-0">
                        <tr>
                          <th className="px-2 py-1 text-left">Matrícula</th>
                          <th className="px-2 py-1 text-left">Nome da Supervisão</th>
                          <th className="px-2 py-1 text-left">Pastor Supervisor</th>
                          <th className="px-2 py-1 text-left">CPF</th>
                          <th className="px-2 py-1 text-left">UF</th>
                          <th className="px-2 py-1 text-left">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {csvSupRows.map((row, i) => (
                          <tr key={i} className={`border-t ${row._error ? 'bg-red-50' : 'hover:bg-gray-50'}`}>
                            <td className="px-2 py-1 text-gray-600">{row.codigo || '(auto)'}</td>
                            <td className="px-2 py-1 font-semibold">{row.nome || <span className="text-red-500">(vazio)</span>}</td>
                            <td className="px-2 py-1 text-gray-600">{row.supervisor_nome || '-'}</td>
                            <td className="px-2 py-1 text-gray-600">{row.supervisor_cpf || '-'}</td>
                            <td className="px-2 py-1 text-gray-600">{row.uf || '-'}</td>
                            <td className="px-2 py-1">{row._error ? <span className="text-red-600">⚠ {row._error}</span> : <span className="text-green-600">✓ OK</span>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    {csvSupRows.filter(r => !r._error && r.nome).length} válidos · {csvSupRows.filter(r => !!r._error).length} com erro (serão ignorados)
                  </p>
                </div>
              )}

              {/* Botões */}
              <div className="flex gap-3 pt-2">
                {csvImportTab === 'campos' && csvCamposRows.filter(r => !r._error && r.nome).length > 0 && !csvResult && (
                  <button
                    onClick={handleCsvImportCampos}
                    disabled={csvImporting}
                    className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition font-bold text-sm disabled:opacity-60"
                  >
                    {csvImporting ? 'Importando...' : `✓ Importar ${csvCamposRows.filter(r => !r._error && r.nome).length} campo(s)`}
                  </button>
                )}
                {csvImportTab === 'supervisoes' && csvSupRows.filter(r => !r._error && r.nome).length > 0 && !csvResult && (
                  <button
                    onClick={handleCsvImportSupervisoes}
                    disabled={csvImporting}
                    className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition font-bold text-sm disabled:opacity-60"
                  >
                    {csvImporting ? 'Importando...' : `✓ Importar ${csvSupRows.filter(r => !r._error && r.nome).length} supervisão(ões)`}
                  </button>
                )}
                <button
                  onClick={() => { setCsvCamposRows([]); setCsvSupRows([]); setCsvResult(null); }}
                  className="px-4 py-2 bg-gray-400 text-white rounded-lg hover:bg-gray-500 transition font-bold text-sm"
                >
                  Limpar
                </button>
              </div>
            </div>
          </Section>
        )}
      </Tabs>
      </div>
    </PageLayout>
  );
}
