'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import PageLayout from '@/components/PageLayout';
import AccessRestricted from '@/components/AccessRestricted';
import { useRequireSupabaseAuth } from '@/hooks/useRequireSupabaseAuth';
import { useEventosPerfil } from '@/hooks/useEventosPerfil';
import { useUserRole } from '@/hooks/useUserRole';
import { createClient } from '@/lib/supabase-client';
import { buildUrl, getPublicBaseUrl } from '@/lib/urls';
import { canAccessModule } from '@/lib/auth/roles';

// ─── Tipos ───────────────────────────────────────────────────
interface Supervisao { id: string; nome: string; }
interface Campo      { id: string; nome: string; supervisao_id: string; }

interface Evento {
  id: string;
  nome: string;
  slug: string;
  departamento: string;
  descricao: string | null;
  data_inicio: string;
  data_fim: string;
  local: string | null;
  cidade: string | null;
  supervisao_id: string | null;
  campo_id: string | null;
  banner_url: string | null;
  valor_inscricao: number;
  status: 'programado' | 'realizado' | 'cancelado';
  inscricoes_abertas: boolean;
  limite_vagas: number | null;
  publico_alvo: string | null;
  created_at: string;
}

interface InscricaoResumo {
  evento_id: string;
  status_pagamento: string;
  valor_pago: number;
}

type ImportCsvRow = {
  nome: string;
  cpf: string;
  email: string | null;
  whatsapp: string | null;
  sexo: string | null;
  data_nascimento: string | null;
  supervisao_nome: string | null;
  campo_nome: string | null;
  status_raw: string | null;
  metodo_raw: string | null;
  qtd_refeicoes: number | null;
  created_at: string | null;
  valor_raw: string | null;
};

interface EventoComStats extends Evento {
  total_inscritos: number;
  total_pagos: number;
  valor_arrecadado: number;
  nome_supervisao: string | null;
  nome_campo: string | null;
}

const DEPARTAMENTOS = ['AGO', 'COADESPA', 'UMADESPA', 'SEIADEPA', 'AVULSO'];

const STATUS_CONFIG = {
  programado: { label: 'Programado', bg: 'bg-blue-100',  text: 'text-blue-700',  dot: 'bg-blue-500'  },
  realizado:  { label: 'Realizado',  bg: 'bg-green-100', text: 'text-green-700', dot: 'bg-green-500' },
  cancelado:  { label: 'Cancelado',  bg: 'bg-red-100',   text: 'text-red-700',   dot: 'bg-red-500'   },
};

function fmtData(d: string) {
  if (!d) return '';
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y}`;
}

function fmtMoeda(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

const CSV_MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  fev: '02', abr: '04', mai: '05', ago: '08', set: '09', out: '10', dez: '12',
};

function normalizeCsvHeader(value: string): string {
  return String(value || '')
    .replace(/^\uFEFF/, '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function cleanCpfLocal(value: string): string {
  return String(value || '').replace(/\D/g, '');
}

function parseCsvLine(line: string, sep: string): string[] {
  const result: string[] = [];
  let cur = '';
  let inQuote = false;
  for (const ch of line) {
    if (ch === '"') { inQuote = !inQuote; continue; }
    if (!inQuote && ch === sep) { result.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  result.push(cur.trim());
  return result;
}

function splitCsvLines(text: string): string[] {
  const lines: string[] = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      inQuote = !inQuote;
      cur += ch;
    } else if (!inQuote && (ch === '\n' || (ch === '\r' && text[i + 1] === '\n'))) {
      if (ch === '\r') i++;
      if (cur.trim()) lines.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) lines.push(cur);
  return lines;
}

function detectSep(firstLine: string): string {
  const sc = (firstLine.match(/;/g) || []).length;
  const cc = (firstLine.match(/,/g) || []).length;
  return sc >= cc ? ';' : ',';
}

function parseCsvNumber(raw: string): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[^0-9,.-]/g, '').replace(',', '.');
  if (!cleaned) return null;
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

function parseCsvDateOnly(raw: string): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const dmy = s.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  const m = s.match(/^([A-Za-z]{3})\s+(\d{1,2}),?\s+(\d{4})/);
  if (m) {
    const mm = CSV_MONTHS[m[1].toLowerCase()];
    if (mm) return `${m[3]}-${mm}-${m[2].padStart(2, '0')}`;
  }
  return null;
}

function parseCsvDateTime(raw: string): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T00:00:00.000Z`;
  const md = s.match(/^([A-Za-z]{3})\s+(\d{1,2}),?\s+(\d{4})(.*)$/);
  if (md) {
    const mm = CSV_MONTHS[md[1].toLowerCase()];
    if (mm) {
      const time = (md[4] || '').trim();
      const tm = time.match(/(\d{1,2}):(\d{2})\s*(am|pm)?/i);
      let hh = '00';
      let mi = '00';
      if (tm) {
        let h = Number(tm[1]);
        const m = tm[2];
        const ap = (tm[3] || '').toLowerCase();
        if (ap === 'pm' && h < 12) h += 12;
        if (ap === 'am' && h === 12) h = 0;
        hh = String(h).padStart(2, '0');
        mi = m.padStart(2, '0');
      }
      return `${md[3]}-${mm}-${md[2].padStart(2, '0')}T${hh}:${mi}:00.000Z`;
    }
  }
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString();
  return null;
}

function isReceivedStatus(raw: string | null): boolean {
  const s = normalizeCsvHeader(raw || '');
  return s.includes('received');
}

// ─── Componente principal ─────────────────────────────────────
export default function EventosPage() {
  const { loading: authLoading } = useRequireSupabaseAuth();
  const perfil = useEventosPerfil();
  const { role, loading: roleLoading } = useUserRole();
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [eventos,     setEventos]     = useState<Evento[]>([]);
  const [inscricoes,  setInscricoes]  = useState<InscricaoResumo[]>([]);
  const [supervisoes, setSupervisoes] = useState<Supervisao[]>([]);
  const [campos,      setCampos]      = useState<Campo[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [activeTab,   setActiveTab]   = useState<'programado' | 'realizado' | 'cancelado'>('programado');
  const [modalEvento, setModalEvento] = useState<EventoComStats | null>(null);
  const [acaoLoading, setAcaoLoading] = useState(false);
  const [acaoErro,    setAcaoErro]    = useState('');
  const [importEvento, setImportEvento] = useState<EventoComStats | null>(null);
  const [importFile,   setImportFile]   = useState<File | null>(null);
  const [importRows,   setImportRows]   = useState<ImportCsvRow[]>([]);
  const [importParsing, setImportParsing] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [importErro, setImportErro] = useState('');
  const [importSucesso, setImportSucesso] = useState('');
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const [busca,       setBusca]       = useState('');
  const [filtroDept,  setFiltroDept]  = useState('');
  const [filtroAno,   setFiltroAno]   = useState('');
  const [filtroSup,   setFiltroSup]   = useState('');
  const [filtroCampo, setFiltroCampo] = useState('');

  // Para isDeptAdmin com dept específico, trava o filtro de departamento
  useEffect(() => {
    if (!perfil.loading && perfil.isDeptAdmin && perfil.departamentoUsuario && perfil.departamentoUsuario !== 'TODOS') {
      setFiltroDept(perfil.departamentoUsuario);
    }
  }, [perfil.loading, perfil.isDeptAdmin, perfil.departamentoUsuario]);

  const podeAcessar = canAccessModule(role, 'eventos');
  const isReady = !authLoading && !perfil.loading && !roleLoading && podeAcessar;

  const getAccessTokenOrThrow = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error('Sessao expirada. Faça login novamente.');
    return token;
  }, [supabase]);

  const authedFetch = useCallback(async (input: RequestInfo | URL, init?: RequestInit) => {
    const token = await getAccessTokenOrThrow();
    const headers = new Headers(init?.headers || {});
    headers.set('Authorization', `Bearer ${token}`);
    return fetch(input, { ...init, headers });
  }, [getAccessTokenOrThrow]);

  const carregarDados = useCallback(async () => {
    try {
      // Busca eventos: filtra pelo dept (isDeptAdmin) ou IDs acessíveis (vinculados)
      let evQuery = supabase.from('eventos').select('*').order('data_inicio', { ascending: false });
      if (perfil.isDeptAdmin && perfil.departamentoUsuario && perfil.departamentoUsuario !== 'TODOS') {
        // Admin de departamento específico: filtra pelo dept
        evQuery = evQuery.eq('departamento', perfil.departamentoUsuario);
      } else if (!perfil.isGlobal && !perfil.isDeptAdmin && perfil.eventoIds !== null) {
        if (perfil.eventoIds.length === 0) {
          setEventos([]);
          setInscricoes([]);
          return;
        }
        evQuery = evQuery.in('id', perfil.eventoIds);
      }

      const [evRes, estruturaRes] = await Promise.all([
        evQuery,
        authedFetch('/api/v1/estrutura'),
      ]);

      const estruturaJson = await estruturaRes.json();
      if (estruturaRes.ok) {
        setSupervisoes((estruturaJson?.supervisoes as Supervisao[]) || []);
        setCampos((estruturaJson?.campos as Campo[]) || []);
      }

      const evs = (evRes.data as Evento[]) || [];
      setEventos(evs);

      // Carrega inscrições apenas dos eventos acessíveis
      if (evs.length > 0) {
        const ids = evs.map(e => e.id);
        const { data: inData } = await supabase
          .from('evento_inscricoes')
          .select('evento_id, status_pagamento, valor_pago')
          .in('evento_id', ids);
        setInscricoes((inData as InscricaoResumo[]) || []);
      } else {
        setInscricoes([]);
      }
    } catch {
      setEventos([]);
      setInscricoes([]);
    }
  }, [perfil.departamentoUsuario, perfil.eventoIds, perfil.isDeptAdmin, perfil.isGlobal, supabase]);

  const recarregarDados = useCallback(async () => {
    setLoadingData(true);
    await carregarDados();
    setLoadingData(false);
  }, [carregarDados]);

  useEffect(() => {
    if (!isReady) return;
    setLoadingData(true);
    carregarDados().finally(() => setLoadingData(false));
  }, [isReady, carregarDados]);

  const eventosComStats = useMemo<EventoComStats[]>(() => {
    return eventos.map(ev => {
      const ins   = inscricoes.filter(i => i.evento_id === ev.id);
      const pagos = ins.filter(i => i.status_pagamento === 'pago');
      const sup   = supervisoes.find(s => s.id === ev.supervisao_id);
      const campo = campos.find(c => c.id === ev.campo_id);
      return {
        ...ev,
        total_inscritos:  ins.length,
        total_pagos:      pagos.length,
        valor_arrecadado: pagos.reduce((acc, i) => acc + (i.valor_pago || 0), 0),
        nome_supervisao:  sup?.nome   ?? null,
        nome_campo:       campo?.nome ?? null,
      };
    });
  }, [eventos, inscricoes, supervisoes, campos]);

  const summary = useMemo(() => ({
    programados: eventos.filter(e => e.status === 'programado').length,
    realizados:  eventos.filter(e => e.status === 'realizado').length,
    cancelados:  eventos.filter(e => e.status === 'cancelado').length,
    pagas:       inscricoes.filter(i => i.status_pagamento === 'pago').length,
    pendentes:   inscricoes.filter(i => i.status_pagamento === 'pendente').length,
    valorTotal:  inscricoes.filter(i => i.status_pagamento === 'pago').reduce((a, i) => a + (i.valor_pago || 0), 0),
  }), [eventos, inscricoes]);

  const anos = useMemo(() => {
    const set = new Set(eventos.map(e => e.data_inicio?.slice(0, 4)).filter(Boolean));
    return Array.from(set).sort((a, b) => Number(b) - Number(a));
  }, [eventos]);

  const camposFiltrados = useMemo(() =>
    filtroSup ? campos.filter(c => c.supervisao_id === filtroSup) : campos,
    [campos, filtroSup]
  );

  const eventosFiltrados = useMemo(() => {
    return eventosComStats.filter(ev => {
      if (ev.status !== activeTab) return false;
      if (busca && !ev.nome.toLowerCase().includes(busca.toLowerCase())) return false;
      if (filtroDept && ev.departamento !== filtroDept) return false;
      if (filtroAno  && !ev.data_inicio.startsWith(filtroAno)) return false;
      if (filtroSup  && ev.supervisao_id !== filtroSup) return false;
      if (filtroCampo && ev.campo_id !== filtroCampo) return false;
      return true;
    });
  }, [eventosComStats, activeTab, busca, filtroDept, filtroAno, filtroSup, filtroCampo]);

  const abrirModalRemocao = (ev: EventoComStats) => {
    setModalEvento(ev);
    setAcaoErro('');
  };

  const fecharModalRemocao = () => {
    setModalEvento(null);
    setAcaoErro('');
  };

  const handleCancelarEvento = async () => {
    if (!modalEvento) return;
    setAcaoLoading(true);
    setAcaoErro('');
    try {
      const res = await authedFetch(`/api/eventos/${modalEvento.id}`, { method: 'PATCH' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Erro ao cancelar evento.');
      fecharModalRemocao();
      await recarregarDados();
    } catch (e) {
      setAcaoErro(e instanceof Error ? e.message : 'Erro ao cancelar evento.');
    } finally {
      setAcaoLoading(false);
    }
  };

  const handleDeletarEvento = async () => {
    if (!modalEvento) return;
    setAcaoLoading(true);
    setAcaoErro('');
    try {
      const res = await authedFetch(`/api/eventos/${modalEvento.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Erro ao deletar evento.');
      fecharModalRemocao();
      await recarregarDados();
    } catch (e) {
      setAcaoErro(e instanceof Error ? e.message : 'Erro ao deletar evento.');
    } finally {
      setAcaoLoading(false);
    }
  };

  const handleImportarCsv = (ev: EventoComStats) => {
    setImportEvento(ev);
    setImportFile(null);
    setImportRows([]);
    setImportErro('');
    setImportSucesso('');
    importInputRef.current?.click();
  };

  const handleImportFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    if (!file) {
      setImportEvento(null);
      setImportFile(null);
      setImportRows([]);
      setImportErro('');
      setImportSucesso('');
      return;
    }
    setImportFile(file);
    setImportRows([]);
    setImportErro('');
    setImportSucesso('');
    e.target.value = '';

    (async () => {
      setImportParsing(true);
      try {
        const text = await file.text();
        const lines = splitCsvLines(text);
        if (lines.length < 2) throw new Error('Arquivo vazio ou sem dados.');

        const sep = detectSep(lines[0]);
        const headers = parseCsvLine(lines[0], sep).map(h => normalizeCsvHeader(h));

        const idx = (patterns: string[]) => {
          for (const p of patterns) {
            const i = headers.findIndex(h => h.includes(p));
            if (i >= 0) return i;
          }
          return -1;
        };

        const colNome = idx(['nome', 'name', 'participant name', 'nome completo', 'inscrito']);
        const colCpf = idx(['cpf']);
        if (colNome < 0 || colCpf < 0) {
          throw new Error('Colunas obrigatorias nao encontradas: Nome, CPF.');
        }

        const colEmail = idx(['email', 'e mail']);
        const colWhatsapp = idx(['whatsapp', 'telefone', 'celular', 'phone']);
        const colSexo = idx(['sexo', 'gender']);
        const colNasc = idx(['data nascimento', 'nascimento', 'birth']);
        const colSup = idx(['supervisao', 'supervisao nome', 'supervisao do campo']);
        const colCampo = idx(['campo', 'campo nome']);
        const colStatus = idx(['status', 'status pagamento', 'payment status']);
        const colMetodo = idx(['payment method', 'metodo pagamento', 'forma pagamento', 'pagamento']);
        const colQtdRef = idx(['qtd refeicoes', 'quantidade refeicoes', 'refeicoes', 'refeicao']);
        const colCreated = idx(['creation date', 'data criacao', 'data cadastro', 'created at', 'data inscricao']);
        const colValor = idx(['valor', 'amount', 'valor pago', 'paid amount', 'preco', 'price', 'total']);

        const rows: ImportCsvRow[] = [];
        for (let i = 1; i < lines.length; i++) {
          const cols = parseCsvLine(lines[i], sep);
          if (cols.every(c => !c)) continue;
          const get = (ci: number) => (ci >= 0 ? (cols[ci] || '').trim() : '');
          rows.push({
            nome: get(colNome),
            cpf: get(colCpf),
            email: get(colEmail) || null,
            whatsapp: get(colWhatsapp) || null,
            sexo: get(colSexo) || null,
            data_nascimento: parseCsvDateOnly(get(colNasc)),
            supervisao_nome: get(colSup) || null,
            campo_nome: get(colCampo) || null,
            status_raw: get(colStatus) || null,
            metodo_raw: get(colMetodo) || null,
            qtd_refeicoes: parseCsvNumber(get(colQtdRef)),
            created_at: parseCsvDateTime(get(colCreated)),
            valor_raw: get(colValor) || null,
          });
        }

        if (rows.length === 0) throw new Error('Arquivo sem registros validos.');
        setImportRows(rows);
      } catch (err) {
        setImportRows([]);
        setImportErro(err instanceof Error ? err.message : 'Erro ao ler o arquivo.');
      } finally {
        setImportParsing(false);
      }
    })();
  };

  const fecharModalImport = () => {
    setImportEvento(null);
    setImportFile(null);
    setImportRows([]);
    setImportErro('');
    setImportSucesso('');
  };

  const importStats = useMemo(() => {
    const total = importRows.length;
    const pagos = importRows.filter(r => isReceivedStatus(r.status_raw)).length;
    const pendentes = total - pagos;
    const comAlimentacao = importRows.filter(r => (r.qtd_refeicoes ?? 0) > 0).length;
    const semCpf = importRows.filter(r => cleanCpfLocal(r.cpf).length !== 11).length;
    return { total, pagos, pendentes, comAlimentacao, semCpf };
  }, [importRows]);

  const handleConfirmarImportacao = async () => {
    if (!importEvento || importRows.length === 0 || importLoading) return;
    setImportLoading(true);
    setImportErro('');
    setImportSucesso('');
    try {
      const res = await authedFetch(`/api/eventos/${importEvento.id}/importar-csv`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: importRows }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Erro ao importar CSV.');

      const ign = json?.ignorados;
      const ignMsg = ign
        ? ` Ignorados: ${ign.total} (sem CPF: ${ign.semCpf}, sem nome: ${ign.semNome}, duplicados: ${ign.duplicados}, existentes: ${ign.existentes}).`
        : '';
      setImportSucesso(`Importados: ${json?.importados ?? 0}.${ignMsg}`);
      await recarregarDados();
    } catch (err) {
      setImportErro(err instanceof Error ? err.message : 'Erro ao importar CSV.');
    } finally {
      setImportLoading(false);
    }
  };

  function handleFiltroSup(v: string) {
    setFiltroSup(v);
    setFiltroCampo('');
  }

  if (authLoading || perfil.loading || roleLoading) return <div className="p-8 text-gray-500">Carregando...</div>;

  if (!podeAcessar) {
    return (
      <PageLayout title="Eventos" description="" activeMenu="eventos">
        <AccessRestricted message="Voce nao tem permissao para acessar o modulo de eventos." />
      </PageLayout>
    );
  }

  // ── Dashboard simplificada para perfil checkin ───────────
  if (perfil.somenteCheckin) {
    return (
      <PageLayout title="Eventos" description="Seus eventos de check-in" activeMenu="eventos">
        {loadingData ? (
          <LoadingCards />
        ) : eventos.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-12 text-center">
            <span className="text-5xl mb-4 block">📋</span>
            <p className="text-gray-600 font-semibold">Nenhum evento vinculado a você ainda.</p>
            <p className="text-sm text-gray-400 mt-1">Entre em contato com o administrador do sistema.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {eventos.map(ev => (
              <div key={ev.id} className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-[#123b63]/10 text-[#123b63]">{ev.departamento}</span>
                  </div>
                  <p className="font-bold text-gray-900">{ev.nome}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    📅 {fmtData(ev.data_inicio)} → {fmtData(ev.data_fim)}
                    {ev.local && <> &nbsp;·&nbsp; 📍{ev.local}</>}
                  </p>
                </div>
                <button
                  onClick={() => router.push(`/eventos/${ev.id}/checkin`)}
                  className="whitespace-nowrap bg-[#123b63] text-white px-6 py-2.5 rounded-lg text-sm font-bold hover:bg-[#0f2a45] transition flex items-center gap-2"
                >
                  ✅ Abrir Check-in
                </button>
              </div>
            ))}
          </div>
        )}
      </PageLayout>
    );
  }

  return (
    <PageLayout
      title="Eventos"
      description={perfil.isGlobal ? 'Gerenciamento de eventos e inscrições' : 'Seus eventos'}
      activeMenu="eventos"
    >

      {/* ── Summary Cards ──────────────────────────────────── */}
      {loadingData ? (
        <LoadingCards />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4 mb-8">
          <SummaryCard label="Programados"      value={summary.programados} color="border-blue-500"    textColor="text-[#123b63]"   icon="📅" />
          <SummaryCard label="Realizados"       value={summary.realizados}  color="border-green-500"   textColor="text-green-700"   icon="✅" />
          <SummaryCard label="Cancelados"       value={summary.cancelados}  color="border-red-400"     textColor="text-red-600"     icon="❌" />
          <SummaryCard label="Inscrições Pagas" value={summary.pagas}       color="border-emerald-500" textColor="text-emerald-700" icon="💳" />
          <SummaryCard label="Pendentes"        value={summary.pendentes}   color="border-yellow-500"  textColor="text-yellow-700"  icon="⏳" />
          {perfil.podeVerFinanceiro && (
            <SummaryCard label="Arrecadado" value={fmtMoeda(summary.valorTotal)} color="border-[#F39C12]" textColor="text-[#F39C12]" icon="💰" small />
          )}
        </div>
      )}

      {/* ── Filtros + Novo Evento ──────────────────────────── */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 mb-6 p-4">
        <div className="flex flex-col lg:flex-row lg:flex-wrap gap-3">
          <div className="flex-1 min-w-0">
            <input
              type="text"
              placeholder="🔍  Buscar evento..."
              value={busca}
              onChange={e => setBusca(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#123b63]"
            />
          </div>
          {/* Filtros de departamento/supervisão apenas para admin global */}
          {perfil.isGlobal && (
            <>
              <select value={filtroDept} onChange={e => setFiltroDept(e.target.value)}
                className="w-full sm:w-auto border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#123b63] bg-white">
                <option value="">Todos os departamentos</option>
                {DEPARTAMENTOS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
              <select value={filtroAno} onChange={e => setFiltroAno(e.target.value)}
                className="w-full sm:w-auto border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#123b63] bg-white">
                <option value="">Todos os anos</option>
                {anos.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
              <select value={filtroSup} onChange={e => handleFiltroSup(e.target.value)}
                className="w-full sm:w-auto border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#123b63] bg-white">
                <option value="">Todas as supervisões</option>
                {supervisoes.map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}
              </select>
              <select value={filtroCampo} onChange={e => setFiltroCampo(e.target.value)}
                className="w-full sm:w-auto border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#123b63] bg-white">
                <option value="">Todos os campos</option>
                {camposFiltrados.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </>
          )}
          {/* isDeptAdmin: exibe departamento travado */}
          {perfil.isDeptAdmin && perfil.departamentoUsuario && (
            <span className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border border-[#123b63]/30 bg-[#123b63]/5 text-[#123b63] font-semibold">
              🏷️ {perfil.departamentoUsuario === 'TODOS' ? 'Todos os Departamentos' : perfil.departamentoUsuario}
            </span>
          )}
          {/* Filtro de ano disponível para não-admin-global */}
          {!perfil.isGlobal && !perfil.isDeptAdmin && (
            <select value={filtroAno} onChange={e => setFiltroAno(e.target.value)}
              className="w-full sm:w-auto border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#123b63] bg-white">
              <option value="">Todos os anos</option>
              {anos.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          )}
          {perfil.podeNovoEvento && (
            <button
              onClick={() => router.push('/eventos/novo')}
              className="w-full sm:w-auto whitespace-nowrap bg-[#123b63] text-white px-5 py-2 rounded-lg text-sm font-semibold hover:bg-[#0f2a45] transition flex items-center gap-2"
            >
              <span className="text-[#F39C12] font-bold">+</span> Novo Evento
            </button>
          )}
          <button
            onClick={() => window.open(buildUrl(getPublicBaseUrl(), '/eventos-publicos'), '_blank')}
            className="w-full sm:w-auto whitespace-nowrap bg-white text-[#123b63] px-5 py-2 rounded-lg text-sm font-semibold border border-[#123b63]/30 hover:bg-[#123b63]/5 transition flex items-center gap-2"
          >
            🌐 Portal publico
          </button>
        </div>
      </div>

      {/* ── Abas ───────────────────────────────────────────── */}
      <div className="mb-6 border-b border-gray-300">
        <div className="flex gap-2 overflow-x-auto pb-1">
          {([
            { id: 'programado' as const, label: 'Programados', icon: '📅', count: summary.programados },
            { id: 'realizado'  as const, label: 'Realizados',  icon: '✅', count: summary.realizados  },
            { id: 'cancelado'  as const, label: 'Cancelados',  icon: '❌', count: summary.cancelados  },
          ]).map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-6 py-3 text-sm font-semibold border-b-2 transition whitespace-nowrap flex-shrink-0 ${
                activeTab === tab.id
                  ? 'border-[#123b63] text-[#123b63]'
                  : 'border-transparent text-gray-500 hover:text-gray-800 hover:border-gray-300'
              }`}
            >
              <span>{tab.icon}</span>
              {tab.label}
              <span className={`ml-1 text-xs px-1.5 py-0.5 rounded-full font-bold ${
                activeTab === tab.id ? 'bg-[#123b63] text-white' : 'bg-gray-200 text-gray-600'
              }`}>
                {tab.count}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Lista de eventos ───────────────────────────────── */}
      {loadingData ? (
        <div className="space-y-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 animate-pulse">
              <div className="flex gap-6">
                <div className="w-28 h-20 bg-gray-200 rounded-lg flex-shrink-0" />
                <div className="flex-1 space-y-3">
                  <div className="h-5 bg-gray-200 rounded w-2/3" />
                  <div className="h-3 bg-gray-200 rounded w-1/3" />
                  <div className="h-3 bg-gray-200 rounded w-1/2" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : eventosFiltrados.length === 0 ? (
        <EmptyState
          tab={activeTab}
          temFiltro={!!(busca || filtroDept || filtroAno || filtroSup || filtroCampo)}
          podeNovoEvento={perfil.podeNovoEvento}
          onNovo={() => router.push('/eventos/novo')}
        />
      ) : (
        <div className="space-y-4">
          {eventosFiltrados.map(ev => (
            <EventoCard
              key={ev.id}
              evento={ev}
              podeVerFinanceiro={perfil.podeVerFinanceiro}
              onGerenciar={() => router.push(`/eventos/${ev.id}`)}
              podeImportar={perfil.podeEditarEvento}
              onImportarCsv={() => handleImportarCsv(ev)}
              podeRemover={perfil.podeEditarEvento}
              onRemover={() => abrirModalRemocao(ev)}
            />
          ))}
        </div>
      )}

      {modalEvento && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-bold text-gray-800">Remover evento</h3>
            <p className="mt-2 text-sm text-gray-600">
              Escolha o que deseja fazer com <strong>{modalEvento.nome}</strong>.
            </p>
            <div className="mt-4 space-y-1 text-xs text-gray-500">
              <p>• Deletar: remove o evento e todas as inscricoes vinculadas.</p>
              <p>• Cancelar: define status Cancelado e marca inscricoes como canceladas.</p>
            </div>

            {acaoErro && (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {acaoErro}
              </div>
            )}

            <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                onClick={fecharModalRemocao}
                disabled={acaoLoading}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50"
              >
                Voltar
              </button>
              <button
                onClick={handleCancelarEvento}
                disabled={acaoLoading || modalEvento.status === 'cancelado'}
                className="rounded-lg bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-700 hover:bg-amber-100 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
              >
                Cancelar evento
              </button>
              <button
                onClick={handleDeletarEvento}
                disabled={acaoLoading}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-red-300"
              >
                Deletar evento
              </button>
            </div>
          </div>
        </div>
      )}

      <input
        ref={importInputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={handleImportFileChange}
      />

      {importEvento && importFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-bold text-gray-800">Importar CSV</h3>
            <p className="mt-2 text-sm text-gray-600">
              Evento: <strong>{importEvento.nome}</strong>
            </p>
            <p className="mt-1 text-xs text-gray-500">Arquivo: {importFile.name}</p>

            {importErro && (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {importErro}
              </div>
            )}

            {importSucesso && (
              <div className="mt-4 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-700">
                {importSucesso}
              </div>
            )}

            {!importErro && (
              <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-gray-600">
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">Total: <strong>{importStats.total}</strong></div>
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">Pagos: <strong>{importStats.pagos}</strong></div>
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">Pendentes: <strong>{importStats.pendentes}</strong></div>
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">Alimentacao: <strong>{importStats.comAlimentacao}</strong></div>
              </div>
            )}

            {importParsing && (
              <p className="mt-3 text-xs text-gray-500">Lendo arquivo...</p>
            )}

            {!importParsing && importRows.length > 0 && (
              <div className="mt-4">
                <p className="text-xs font-semibold text-gray-600">Preview (primeiros 5)</p>
                <div className="mt-2 max-h-56 overflow-auto rounded-lg border border-gray-200">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 text-gray-600">
                      <tr>
                        <th className="px-2 py-1 text-left">Nome</th>
                        <th className="px-2 py-1 text-left">CPF</th>
                        <th className="px-2 py-1 text-left">Campo</th>
                        <th className="px-2 py-1 text-left">Supervisao</th>
                        <th className="px-2 py-1 text-left">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importRows.slice(0, 5).map((r, idx) => (
                        <tr key={`${r.cpf}-${idx}`} className="border-t border-gray-100">
                          <td className="px-2 py-1 text-gray-700">{r.nome || '-'}</td>
                          <td className="px-2 py-1 text-gray-700">{r.cpf || '-'}</td>
                          <td className="px-2 py-1 text-gray-700">{r.campo_nome || '-'}</td>
                          <td className="px-2 py-1 text-gray-700">{r.supervisao_nome || '-'}</td>
                          <td className="px-2 py-1 text-gray-700">{r.status_raw || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                onClick={fecharModalImport}
                disabled={importLoading}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50"
              >
                Fechar
              </button>
              <button
                onClick={() => importInputRef.current?.click()}
                disabled={importLoading}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50"
              >
                Trocar arquivo
              </button>
              <button
                onClick={handleConfirmarImportacao}
                disabled={importLoading || importParsing || importRows.length === 0 || !!importErro}
                className="rounded-lg bg-[#123b63] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0f2a45] disabled:cursor-not-allowed disabled:bg-gray-300"
              >
                {importLoading ? 'Importando...' : `Importar ${importRows.length} registros`}
              </button>
            </div>
          </div>
        </div>
      )}

    </PageLayout>
  );
}

// ─── SummaryCard ─────────────────────────────────────────────
function SummaryCard({ label, value, color, textColor, icon, small = false }: {
  label: string; value: number | string; color: string;
  textColor: string; icon: string; small?: boolean;
}) {
  return (
    <div className={`bg-white rounded-xl p-4 shadow-sm border-l-4 ${color}`}>
      <div className="flex items-center justify-between mb-2">
        <p className="text-gray-500 text-xs font-medium leading-tight">{label}</p>
        <span className="text-lg">{icon}</span>
      </div>
      <p className={`font-bold ${textColor} ${small ? 'text-base' : 'text-2xl'}`}>{value}</p>
    </div>
  );
}

// ─── EventoCard ───────────────────────────────────────────────
function EventoCard({ evento, podeVerFinanceiro, onGerenciar, podeImportar, onImportarCsv, podeRemover, onRemover }: {
  evento: EventoComStats;
  podeVerFinanceiro: boolean;
  onGerenciar: () => void;
  podeImportar: boolean;
  onImportarCsv: () => void;
  podeRemover: boolean;
  onRemover: () => void;
}) {
  const cfg = STATUS_CONFIG[evento.status] ?? STATUS_CONFIG.programado;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-shadow">
      <div className="flex flex-col sm:flex-row">

        {/* Banner */}
        <div className="sm:w-36 sm:flex-shrink-0 bg-gray-100 flex items-center justify-center min-h-[96px]">
          {evento.banner_url ? (
            <img src={evento.banner_url} alt={evento.nome} className="w-full h-full object-cover" />
          ) : (
            <span className="text-4xl select-none">📅</span>
          )}
        </div>

        {/* Conteúdo */}
        <div className="flex-1 p-5">
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold ${cfg.bg} ${cfg.text}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                  {cfg.label}
                </span>
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#123b63]/10 text-[#123b63]">
                  {evento.departamento}
                </span>
                {evento.inscricoes_abertas && (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700">
                    Inscrições abertas
                  </span>
                )}
              </div>

              <h3 className="text-base font-bold text-gray-900 truncate mb-1">{evento.nome}</h3>

              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                <span>📅 {fmtData(evento.data_inicio)} → {fmtData(evento.data_fim)}</span>
                {(evento.local || evento.cidade) && (
                  <span>📍 {[evento.local, evento.cidade].filter(Boolean).join(' — ')}</span>
                )}
                {evento.nome_supervisao && <span>🗂️ {evento.nome_supervisao}</span>}
                {evento.nome_campo      && <span>⛪ {evento.nome_campo}</span>}
                {evento.publico_alvo    && <span>👥 {evento.publico_alvo}</span>}
              </div>
            </div>

            {/* Stats */}
            <div className="flex sm:flex-col gap-4 sm:gap-2 sm:items-end sm:text-right flex-shrink-0">
              <StatBadge label="Inscritos"  value={evento.total_inscritos}  color="text-[#123b63]"    />
              <StatBadge label="Pagos"      value={evento.total_pagos}      color="text-emerald-600"  />
              {podeVerFinanceiro && (
                <StatBadge label="Arrecadado" value={fmtMoeda(evento.valor_arrecadado)} color="text-[#F39C12]" small />
              )}
            </div>
          </div>

          {/* Botões */}
          <div className="flex flex-wrap gap-2 mt-4 pt-3 border-t border-gray-100">
            <ActionBtn label="Gerenciar" icon="⚙️" onClick={onGerenciar} primary tooltip="Abrir painel completo do evento" />
            <ActionBtn label="Pág. Pública" icon="🌐" onClick={() => window.open(buildUrl(getPublicBaseUrl(), `/inscricao/${evento.slug}`), '_blank')} />
            {podeImportar && (
              <ActionBtn label="Importar CSV" icon="📥" onClick={onImportarCsv} />
            )}
            {podeRemover && (
              <button
                onClick={onRemover}
                className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100"
              >
                🗑️ Deletar evento
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Auxiliares ──────────────────────────────────────────────
function StatBadge({ label, value, color, small = false }: {
  label: string; value: number | string; color: string; small?: boolean;
}) {
  return (
    <div className="text-center sm:text-right">
      <p className="text-gray-400 text-xs">{label}</p>
      <p className={`font-bold ${color} ${small ? 'text-sm' : 'text-lg'}`}>{value}</p>
    </div>
  );
}

function ActionBtn({ label, icon, onClick, primary = false, disabled = false, tooltip }: {
  label: string; icon: string; onClick: () => void; primary?: boolean; disabled?: boolean; tooltip?: string;
}) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      title={tooltip}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
        disabled
          ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
          : primary
          ? 'bg-[#123b63] text-white hover:bg-[#0f2a45]'
          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
      }`}
    >
      <span>{icon}</span>{label}
    </button>
  );
}

function EmptyState({ tab, temFiltro, podeNovoEvento, onNovo }: {
  tab: string; temFiltro: boolean; podeNovoEvento: boolean; onNovo: () => void;
}) {
  const msgs: Record<string, { icon: string; title: string; desc: string }> = {
    programado: { icon: '📅', title: 'Nenhum evento programado', desc: 'Crie o primeiro evento.' },
    realizado:  { icon: '✅', title: 'Nenhum evento realizado',  desc: 'Eventos concluídos aparecerão aqui.' },
    cancelado:  { icon: '❌', title: 'Nenhum evento cancelado',  desc: 'Eventos cancelados aparecerão aqui.' },
  };
  const m = msgs[tab] ?? msgs.programado;
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 py-16 flex flex-col items-center justify-center text-center">
      <span className="text-6xl mb-4">{m.icon}</span>
      <p className="text-lg font-semibold text-gray-700 mb-1">
        {temFiltro ? 'Nenhum resultado para os filtros aplicados' : m.title}
      </p>
      <p className="text-sm text-gray-500 mb-6">
        {temFiltro ? 'Tente ajustar os filtros acima.' : m.desc}
      </p>
      {!temFiltro && tab === 'programado' && podeNovoEvento && (
        <button
          onClick={onNovo}
          className="bg-[#123b63] text-white px-6 py-2.5 rounded-lg text-sm font-semibold hover:bg-[#0f2a45] transition"
        >
          + Novo Evento
        </button>
      )}
    </div>
  );
}

function LoadingCards() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4 mb-8">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="bg-white rounded-xl p-5 shadow-sm border border-gray-100 animate-pulse">
          <div className="h-3 bg-gray-200 rounded w-3/4 mb-3" />
          <div className="h-8 bg-gray-200 rounded w-1/2" />
        </div>
      ))}
    </div>
  );
}
