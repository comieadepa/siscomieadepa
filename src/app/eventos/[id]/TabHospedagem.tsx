'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createClient } from '@/lib/supabase-client';

// ─── Interfaces ──────────────────────────────────────────────────────────────
interface Evento {
  id: string; nome: string; departamento: string;
  data_inicio: string; data_fim: string;
  permite_hospedagem: boolean;
  configuracoes_ago?: Record<string, unknown> | null;
}

interface SetorAgo {
  id: string; nome: string; grupo: string;
  tipos_leito: ('beliche' | 'colchonete' | 'rede')[];
  quantidade_leitos: number;
  quantidade_leitos_inferiores: number;
  observacoes: string; ativo: boolean;
}

interface Supervisao { id: string; nome: string; }
interface Campo      { id: string; nome: string; supervisao_id: string; }

interface Alojamento {
  id: string;
  evento_id: string;
  nome: string;
  publico: 'feminino' | 'presidentes' | 'jubilados' | 'masculino_geral' | 'misto';
  sexo: 'M' | 'F' | null;
  total_vagas: number;
  camas_inferiores: number;
  camas_superiores: number;
  ativo: boolean;
  vagas_livres?: number;
  inferiores_livres?: number;
  superiores_livres?: number;
}

interface Hospedagem {
  id: string | null;
  inscricao_id: string;
  alojamento_id: string | null;
  status: string;
  prioridade: number;
  necessidade_especial: boolean;
  descricao_necessidade: string | null;
  cama_inferior: boolean;
  possui_comorbidade: boolean;
  descricao_comorbidade: string | null;
  grupo_hospedagem: string | null;
  tipo_cama: 'inferior' | 'superior' | null;
  numero_cama: string | null;
  observacoes: string | null;
  alocacao_automatica: boolean;
  checkin_at: string | null;
  checkout_at: string | null;
  checkin_operador: string | null;
  checkout_operador: string | null;
  // joins
  nome_inscrito?: string;
  cpf?: string | null;
  sexo?: string | null;
  supervisao_id?: string | null;
  campo_id?: string | null;
  data_nascimento?: string | null;
  tipo_inscricao?: string | null;
  status_pagamento?: string | null;
  alojamento_nome?: string | null;
  status_operacional?:
    | 'solicitada'
    | 'aguardando_pagamento'
    | 'elegivel'
    | 'alocada'
    | 'confirmada'
    | 'checkin_realizado'
    | 'lista_espera';
  elegivel_autoalocacao?: boolean;
  tem_leito_ocupado?: boolean;
  pendencias?: string[];
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function normalizarTexto(val: string | null | undefined): string {
  return String(val ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

const STATUS_HOSP_CFG: Record<string, { label: string; cls: string }> = {
  solicitada:           { label: 'Solicitada',            cls: 'bg-yellow-100 text-yellow-700' },
  aguardando_pagamento: { label: 'Aguardando pagamento',  cls: 'bg-amber-100 text-amber-800' },
  pago_sem_alocacao:    { label: 'Pago sem alocação',      cls: 'bg-amber-100 text-amber-800 border border-amber-200' },
  elegivel:             { label: 'Elegível',              cls: 'bg-blue-100 text-blue-700' },
  alocada:              { label: 'Alocada',               cls: 'bg-indigo-100 text-indigo-700' },
  confirmada:           { label: 'Confirmada',            cls: 'bg-emerald-100 text-emerald-700' },
  checkin_realizado:    { label: 'Check-in realizado',    cls: 'bg-teal-100 text-teal-700' },
  lista_espera:         { label: 'Lista de espera',       cls: 'bg-orange-100 text-orange-700' },
  checkout_realizado:   { label: 'Check-out realizado',   cls: 'bg-gray-100 text-gray-600' },
  cancelada:            { label: 'Cancelada',             cls: 'bg-red-100 text-red-700' },
  recusada:             { label: 'Recusada',              cls: 'bg-red-100 text-red-700' },
};

const PENDENCIA_LABEL: Record<string, string> = {
  pagou_mas_nao_alocado: 'Pagou, mas sem alocação',
  solicitou_sem_pagamento: 'Solicitou, mas sem pagamento',
  prioridade_sem_leito_inferior: 'Prioridade sem leito inferior',
  sem_grupo_calculado: 'Sem grupo calculado',
  grupo_incompativel_alojamento: 'Grupo incompatível com alojamento',
  sem_numero_leito: 'Sem número de leito',
  alojamento_acima_capacidade: 'Alojamento acima da capacidade',
};


function baixarCSV(nomeArq: string, colunas: string[], linhas: (string | number | null | undefined)[][]) {
  const esc = (v: string | number | null | undefined) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [colunas.map(esc).join(','), ...linhas.map(r => r.map(esc).join(','))].join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a'); a.href = url; a.download = nomeArq; a.click();
  URL.revokeObjectURL(url);
}

const inputCls = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#123b63] bg-white';
const labelCls = 'block text-xs font-semibold text-gray-600 mb-1';
const thCls = 'text-left text-xs font-semibold text-gray-500 uppercase tracking-wide py-2.5 px-3 bg-gray-50 whitespace-nowrap';
const tdCls = 'py-2.5 px-3 text-sm text-gray-700 border-t border-gray-50 whitespace-nowrap';

// ─── Sub-aba ────────────────────────────────────────────────────────────────
type SubAba = 'hospedagens' | 'alojamentos' | 'relatorios' | 'setores' | 'chegadas' | 'ausentes' | 'painel_ago';

// ════════════════════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL
// ════════════════════════════════════════════════════════════════════════════
export default function TabHospedagem({
  eventoId,
  evento,
  supervisoes,
  campos: _campos,
  nomeSup,
  nomeCampo,
  supabase: _supabase,
}: {
  eventoId: string;
  evento: Evento;
  supervisoes: Supervisao[];
  campos: Campo[];
  nomeSup: (id: string | null) => string;
  nomeCampo: (id: string | null) => string;
  supabase: ReturnType<typeof createClient>;
}) {
  const [subAba, setSubAba] = useState<SubAba>('hospedagens');

  const [alojamentos,     setAlojamentos]     = useState<Alojamento[]>([]);
  const [hospedagens,     setHospedagens]     = useState<Hospedagem[]>([]);
  const [loadingAloj,     setLoadingAloj]     = useState(true);
  const [loadingHosp,     setLoadingHosp]     = useState(true);
  const [autoalocando,    setAutoalocando]    = useState(false);
  const [autoalocResult,  setAutoalocResult]  = useState<{ alocadas: number; listaEspera: number; erros: number; leitos: number } | null>(null);

  // Filtros hospedagens
  const [filtroStatus,  setFiltroStatus]  = useState('');
  const [filtroAloj,    setFiltroAloj]    = useState('');
  const [filtroSup,     setFiltroSup]     = useState('');
  const [filtroNecEsp,  setFiltroNecEsp]  = useState('');
  const [filtroGrupo,   setFiltroGrupo]   = useState('');
  const [filtroPend,    setFiltroPend]    = useState('');
  const [busca,         setBusca]         = useState('');
  const [filtroSexo,    setFiltroSexo]    = useState('');

  // Modal edição
  const [editando, setEditando] = useState<Hospedagem | null>(null);
  const [editForm, setEditForm] = useState<{
    alojamento_id: string;
    tipo_cama: string;
    numero_cama: string;
    status: string;
    observacoes: string;
  } | null>(null);
  const [salvandoEdit, setSalvandoEdit] = useState(false);
  const [erroEdit,    setErroEdit]    = useState<string | null>(null);
  const [quickErro,   setQuickErro]   = useState<string | null>(null);
  const [salvandoId,  setSalvandoId]  = useState<string | null>(null);

  // Modal ocorrência
  const [modalOcorr,      setModalOcorr]      = useState<Hospedagem | null>(null);
  const [ocorrTipo,       setOcorrTipo]       = useState('observacao_geral');
  const [ocorrDesc,       setOcorrDesc]       = useState('');
  const [ocorrOp,         setOcorrOp]         = useState('');
  const [salvandoOcorr,   setSalvandoOcorr]   = useState(false);
  const [erroOcorr,       setErroOcorr]       = useState<string | null>(null);

  // Modal realocação
  const [modalRealocar,   setModalRealocar]   = useState<Hospedagem | null>(null);
  const [realAlojId,      setRealAlojId]      = useState('');
  const [realTipoCama,    setRealTipoCama]    = useState('');
  const [realMotivo,      setRealMotivo]      = useState('');
  const [realOp,          setRealOp]          = useState('');
  const [salvandoReal,    setSalvandoReal]    = useState(false);
  const [erroReal,        setErroReal]        = useState<string | null>(null);

  // ── Sincronização setores AGO ──────────────────────────
  const [sincronizando, setSincronizando] = useState(false);
  const autoSincronizadoRef = useRef(false);

  // ── Fetch ──────────────────────────────────────────────────
  const fetchAlojamentos = useCallback(async (): Promise<Alojamento[]> => {
    setLoadingAloj(true);
    const res = await fetch(`/api/eventos/${eventoId}/alojamentos`);
    const json = await res.json();
    const list: Alojamento[] = json.alojamentos ?? [];
    setAlojamentos(list);
    setLoadingAloj(false);
    return list;
  }, [eventoId]);

  const fetchHospedagens = useCallback(async () => {
    setLoadingHosp(true);
    const res = await fetch(`/api/eventos/${eventoId}/hospedagens`);
    const json = await res.json();
    setHospedagens(json.hospedagens ?? []);
    setLoadingHosp(false);
  }, [eventoId]);

  useEffect(() => {
    fetchAlojamentos();
    fetchHospedagens();
  }, [fetchAlojamentos, fetchHospedagens]);

  // ── Sincronização manual de setores AGO ────────────────────────
  const sincronizarSetores = useCallback(async () => {
    setSincronizando(true);
    try {
      await fetch(`/api/eventos/${eventoId}/alojamentos/sincronizar`, { method: 'POST' });
      await fetchAlojamentos();
    } finally {
      setSincronizando(false);
    }
  }, [eventoId, fetchAlojamentos]);

  // ── Autoalocar ─────────────────────────────────────────────
  async function autoalocar() {
    if (!confirm('Executar alocação automática para todas as hospedagens solicitadas?')) return;
    setAutoalocando(true);
    setAutoalocResult(null);
    setQuickErro(null);
    try {
      const res = await fetch(`/api/eventos/${eventoId}/hospedagens/alocar`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error ?? 'Erro inesperado na autoalocação');
      }
      setAutoalocResult({ alocadas: json.confirmados ?? 0, listaEspera: json.lista_espera ?? 0, erros: 0, leitos: json.leitos_atribuidos ?? 0 });
      fetchHospedagens();
    } catch (err) {
      setQuickErro(err instanceof Error ? err.message : 'Erro ao executar autoalocação');
    } finally {
      setAutoalocando(false);
    }
  }

  // ── Filtros hospedagens ────────────────────────────────────
  const gruposDisponiveis = useMemo(() => {
    const s = new Set<string>();
    hospedagens.forEach(h => { if (h.grupo_hospedagem) s.add(h.grupo_hospedagem); });
    const cfgGrupos = (evento.configuracoes_ago?.grupos as string[] | undefined) ?? [];
    cfgGrupos.forEach(g => s.add(g));
    return Array.from(s).sort();
  }, [hospedagens, evento.configuracoes_ago]);

  const hospedagensSexFiltered = useMemo(() => {
    let list = hospedagens;
    if (filtroSexo) {
      if (filtroSexo === 'M') {
        list = list.filter(h => (h.sexo ?? '').toUpperCase() === 'M');
      } else if (filtroSexo === 'F') {
        list = list.filter(h => (h.sexo ?? '').toUpperCase() === 'F');
      } else if (filtroSexo === 'N') {
        list = list.filter(h => !h.sexo || (h.sexo ?? '').trim() === '');
      }
    }
    return list;
  }, [hospedagens, filtroSexo]);

  const hospFiltradas = useMemo(() => {
    let list = hospedagensSexFiltered;
    if (filtroStatus)  list = list.filter(h => (h.status_operacional ?? h.status) === filtroStatus);
    if (filtroAloj)    list = list.filter(h => h.alojamento_id === filtroAloj);
    if (filtroSup)     list = list.filter(h => h.supervisao_id === filtroSup);
    if (filtroNecEsp === '1') list = list.filter(h => h.necessidade_especial);
    if (filtroNecEsp === '0') list = list.filter(h => !h.necessidade_especial);
    if (filtroGrupo)   list = list.filter(h => h.grupo_hospedagem === filtroGrupo);
    if (filtroPend)    list = list.filter(h => (h.pendencias ?? []).includes(filtroPend));
    if (busca.trim()) {
      const q = normalizarTexto(busca);
      const qCPF = busca.replace(/\D/g, '');
      list = list.filter(h => {
        const nomeNorm = normalizarTexto(h.nome_inscrito);
        const cpfNorm = String(h.cpf ?? '').replace(/\D/g, '');
        return nomeNorm.includes(q) || (qCPF !== '' && cpfNorm.includes(qCPF));
      });
    }
    return list;
  }, [hospedagensSexFiltered, filtroStatus, filtroAloj, filtroSup, filtroNecEsp, filtroGrupo, filtroPend, busca]);

  // ── Stats ──────────────────────────────────────────────────
  const stats = useMemo(() => {
    const total = hospedagens.length;
    const aguardandoPagamento = hospedagens.filter(h => (h.status_operacional ?? h.status) === 'aguardando_pagamento').length;
    const elegiveis = hospedagens.filter(h => (h.status_operacional ?? h.status) === 'elegivel' || (h.status_operacional ?? h.status) === 'pago_sem_alocacao').length;
    const pagoSemAlocacao = hospedagens.filter(h => (h.status_operacional ?? h.status) === 'pago_sem_alocacao').length;
    const alocadas = hospedagens.filter(h => ['alocada', 'confirmada', 'checkin_realizado'].includes(h.status_operacional ?? h.status)).length;
    const listaEspera = hospedagens.filter(h => (h.status_operacional ?? h.status) === 'lista_espera').length;
    const vagasDisp = alojamentos.filter(a => a.ativo).reduce((sum, a) => sum + (a.vagas_livres ?? 0), 0);
    const prioridadeInferiorPendente = hospedagens.filter(h => (h.pendencias ?? []).includes('prioridade_sem_leito_inferior')).length;
    
    const pagos = hospedagens.filter(h => {
      const sp = (h.status_pagamento || '').toLowerCase();
      return sp === 'pago' || sp === 'isento';
    }).length;

    const pendentes = hospedagens.filter(h => {
      const sp = (h.status_pagamento || '').toLowerCase();
      return sp !== 'pago' && sp !== 'isento';
    }).length;

    return {
      total,
      aguardandoPagamento,
      elegiveis,
      pagoSemAlocacao,
      alocadas,
      listaEspera,
      vagasDisp,
      prioridadeInferiorPendente,
      pagos,
      pendentes
    };
  }, [hospedagens, alojamentos]);

  const pendenciasResumo = useMemo(() => {
    const map: Record<string, number> = {};
    for (const h of hospedagensSexFiltered) {
      for (const p of h.pendencias ?? []) {
        map[p] = (map[p] ?? 0) + 1;
      }
    }
    return Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .map(([codigo, qtd]) => ({ codigo, qtd, label: PENDENCIA_LABEL[codigo] ?? codigo }));
  }, [hospedagensSexFiltered]);

  // ── Setores planejados (configuracoes_ago.setores) ─────────
  const setoresConfigurados = useMemo(
    () => (evento.configuracoes_ago?.setores as SetorAgo[] | undefined) ?? [],
    [evento.configuracoes_ago],
  );

  // ── Auto-sincronização: quando alojamentos carrega vazio e há setores planejados
  useEffect(() => {
    if (loadingAloj) return;
    if (autoSincronizadoRef.current) return;
    if (alojamentos.length > 0) return;
    if (setoresConfigurados.length === 0) return;

    autoSincronizadoRef.current = true;
    setSincronizando(true);
    fetch(`/api/eventos/${eventoId}/alojamentos/sincronizar`, { method: 'POST' })
      .then(() => fetchAlojamentos())
      .catch(console.error)
      .finally(() => setSincronizando(false));
  }, [loadingAloj, alojamentos.length, setoresConfigurados.length, eventoId, fetchAlojamentos]);

  // ── Abrir modal edição ─────────────────────────────────────
  function abrirEdicao(h: Hospedagem) {
    setEditando(h);
    setEditForm({
      alojamento_id: h.alojamento_id ?? '',
      tipo_cama:     h.tipo_cama     ?? '',
      numero_cama:   h.numero_cama   ?? '',
      status:        h.status,
      observacoes:   h.observacoes   ?? '',
    });
    setErroEdit(null);
  }

  async function salvarEdicao() {
    if (!editando || !editForm) return;
    setSalvandoEdit(true);
    setErroEdit(null);
    try {
      let res: Response;
      if (editando.id) {
        res = await fetch(`/api/eventos/${eventoId}/hospedagens`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id:                  editando.id,
            alojamento_id:       editForm.alojamento_id || null,
            tipo_cama:           editForm.tipo_cama     || null,
            numero_cama:         editForm.numero_cama   || null,
            status:              editForm.status,
            observacoes:         editForm.observacoes   || null,
            alocacao_automatica: false,
          }),
        });
      } else {
        // Cria registro ao alocar manualmente pela primeira vez
        res = await fetch(`/api/eventos/${eventoId}/hospedagens`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            inscricao_id:          editando.inscricao_id,
            alojamento_id:         editForm.alojamento_id || null,
            tipo_cama:             editForm.tipo_cama     || null,
            numero_cama:           editForm.numero_cama   || null,
            status:                editForm.status,
            observacoes:           editForm.observacoes   || null,
            prioridade:            editando.prioridade,
            necessidade_especial:  editando.necessidade_especial,
            descricao_necessidade: editando.descricao_necessidade,
            cama_inferior:         editando.cama_inferior,
            grupo_hospedagem:      editando.grupo_hospedagem,
            alocacao_automatica:   false,
          }),
        });
      }
      if (!res.ok) { const j = await res.json(); throw new Error(j.error ?? 'Erro'); }
      setEditando(null);
      fetchHospedagens();
    } catch (err) {
      setErroEdit(err instanceof Error ? err.message : 'Erro ao salvar');
    } finally {
      setSalvandoEdit(false);
    }
  }
  // ── Ações rápidas ───────────────────────────────────────────
  async function acaoRapida(h: Hospedagem, novoStatus: string) {
    if (novoStatus === 'confirmada' && !h.alojamento_id) {
      setQuickErro('Defina um alojamento antes de confirmar (use ✏️ Alocar).');
      return;
    }
    setSalvandoId(h.inscricao_id);
    setQuickErro(null);
    try {
      if (h.id) {
        const res = await fetch(`/api/eventos/${eventoId}/hospedagens`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: h.id, status: novoStatus }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? 'Erro');
      } else {
        // Cria registro de alocação ao primeiro acesso do administrador
        const res = await fetch(`/api/eventos/${eventoId}/hospedagens`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            inscricao_id:          h.inscricao_id,
            status:                novoStatus,
            prioridade:            h.prioridade,
            necessidade_especial:  h.necessidade_especial,
            descricao_necessidade: h.descricao_necessidade,
            cama_inferior:         h.cama_inferior,
            observacoes:           h.observacoes,
            grupo_hospedagem:      h.grupo_hospedagem,
          }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? 'Erro');
      }
      fetchHospedagens();
    } catch (err) {
      setQuickErro(err instanceof Error ? err.message : 'Erro ao atualizar');
    } finally {
      setSalvandoId(null);
    }
  }

  async function removerHospedagem(h: Hospedagem) {
    if (!h.id) {
      setQuickErro('Esta solicitação ainda não possui registro de alocação. Use ✏️ Alocar para criar.');
      return;
    }
    if (!confirm(`Remover hospedagem de "${h.nome_inscrito ?? 'participante'}"? Esta ação não pode ser desfeita.`)) return;
    setSalvandoId(h.inscricao_id);
    setQuickErro(null);
    try {
      const res = await fetch(`/api/eventos/${eventoId}/hospedagens?id=${h.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Erro');
      fetchHospedagens();
    } catch (err) {
      setQuickErro(err instanceof Error ? err.message : 'Erro ao remover');
    } finally {
      setSalvandoId(null);
    }
  }
  // ── Check-in / Checkout rápido ─────────────────────────────
  async function acaoCheckin(h: Hospedagem, acao: 'checkin' | 'checkout') {
    if (!h.id) return;
    setSalvandoId(h.inscricao_id);
    setQuickErro(null);
    try {
      const res = await fetch(`/api/eventos/${eventoId}/hospedagens/checkin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inscricao_id: h.inscricao_id, acao }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Erro');
      fetchHospedagens();
    } catch (err) {
      setQuickErro(err instanceof Error ? err.message : 'Erro ao registrar');
    } finally {
      setSalvandoId(null);
    }
  }

  // ── Ocorrência ──────────────────────────────────────────────
  function abrirOcorrencia(h: Hospedagem) {
    setModalOcorr(h);
    setOcorrTipo('observacao_geral');
    setOcorrDesc('');
    setOcorrOp('');
    setErroOcorr(null);
  }

  async function salvarOcorrencia() {
    if (!modalOcorr?.id) return;
    setSalvandoOcorr(true);
    setErroOcorr(null);
    try {
      const res = await fetch(`/api/eventos/${eventoId}/hospedagens/ocorrencia`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hospedagem_id: modalOcorr.id,
          inscricao_id:  modalOcorr.inscricao_id,
          tipo:          ocorrTipo,
          descricao:     ocorrDesc,
          operador:      ocorrOp,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Erro');
      setModalOcorr(null);
    } catch (err) {
      setErroOcorr(err instanceof Error ? err.message : 'Erro ao salvar');
    } finally {
      setSalvandoOcorr(false);
    }
  }

  // ── Realocação ──────────────────────────────────────────────
  function abrirRealocar(h: Hospedagem) {
    setModalRealocar(h);
    setRealAlojId(h.alojamento_id ?? '');
    setRealTipoCama(h.tipo_cama ?? '');
    setRealMotivo('');
    setRealOp('');
    setErroReal(null);
  }

  async function salvarRealocacao() {
    if (!modalRealocar?.id || !realAlojId) return;
    setSalvandoReal(true);
    setErroReal(null);
    try {
      const res = await fetch(`/api/eventos/${eventoId}/hospedagens/realocar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hospedagem_id:       modalRealocar.id,
          novo_alojamento_id:  realAlojId,
          novo_tipo_cama:      realTipoCama || null,
          motivo:              realMotivo,
          operador:            realOp,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Erro');
      setModalRealocar(null);
      fetchHospedagens();
    } catch (err) {
      setErroReal(err instanceof Error ? err.message : 'Erro ao realocar');
    } finally {
      setSalvandoReal(false);
    }
  }

  // ── Exportar CSV ───────────────────────────────────────────
  function exportarCSV(lista: Hospedagem[], nome: string) {    baixarCSV(`hospedagem_${nome}_${eventoId}.csv`,
      ['Nome', 'CPF', 'Categoria', 'Sexo', 'Data Nasc.', 'Supervisão', 'Campo', 'Grupo', 'Alojamento', 'Nº Leito', 'Tipo Cama', 'Status', 'Prioridade', 'Nec. Especial', 'Desc. Necessidade', 'Comorbidade', 'Desc. Comorbidade', 'Cama Inferior', 'Observações'],
      lista.map(h => [
        h.nome_inscrito, h.cpf, h.tipo_inscricao, h.sexo, h.data_nascimento,
        nomeSup(h.supervisao_id ?? null),
        nomeCampo(h.campo_id ?? null),
        h.grupo_hospedagem,
        h.alojamento_nome,
        h.numero_cama,
        h.tipo_cama,
        h.status_operacional ?? h.status,
        h.prioridade,
        h.necessidade_especial ? 'Sim' : 'Não',
        h.descricao_necessidade,
        h.possui_comorbidade ? 'Sim' : 'Não',
        h.descricao_comorbidade,
        h.cama_inferior ? 'Sim' : 'Não',
        h.observacoes,
      ])
    );
  }

  return (
    <div className="space-y-5">

      {/* ── Sub-abas ──────────────────────────────────────────── */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-full overflow-x-auto">
        {([
          { id: 'hospedagens', label: '🛏️ Alocações' },
          { id: 'alojamentos', label: '🏠 Alojamentos' },
          { id: 'relatorios',  label: '📊 Relatórios' },
          ...(evento.departamento === 'AGO' ? [
            { id: 'chegadas'   as SubAba, label: '📋 Chegadas' },
            { id: 'ausentes'   as SubAba, label: '⚠️ Ausentes' },
            { id: 'setores'    as SubAba, label: '🏗️ Setores' },
            { id: 'painel_ago' as SubAba, label: '🎯 Painel AGO' },
          ] : []),
        ] as { id: SubAba; label: string }[]).map(t => (
          <button key={t.id} onClick={() => setSubAba(t.id)}
            className={`px-4 py-2 rounded-lg text-xs font-semibold transition whitespace-nowrap flex-shrink-0 ${
              subAba === t.id ? 'bg-white text-[#123b63] shadow-sm' : 'text-gray-500 hover:text-gray-800'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Cards operacionais ──────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
        {(evento.departamento === 'AGO' ? [
          { label: 'Solicitações', value: stats.total, cor: 'text-[#123b63]' },
          { label: 'Aguard. pgto', value: stats.aguardandoPagamento, cor: 'text-amber-700' },
          { label: 'Elegíveis', value: stats.elegiveis, cor: 'text-blue-700' },
          { label: 'Alocados', value: stats.alocadas, cor: 'text-indigo-700' },
          { label: 'Lista espera', value: stats.listaEspera, cor: 'text-orange-700' },
          { label: 'Vagas livres', value: stats.vagasDisp, cor: 'text-emerald-700' },
          { label: 'Prioridade ↓ pendente', value: stats.prioridadeInferiorPendente, cor: 'text-rose-700' },
        ] : [
          { label: 'Solicitaram hospedagem', value: stats.total, cor: 'text-[#123b63]' },
          { label: 'Pagos com hospedagem', value: stats.pagos, cor: 'text-emerald-700' },
          { label: 'Pendentes hospedagem', value: stats.pendentes, cor: 'text-rose-700' },
          { label: 'Alocados', value: stats.alocadas, cor: 'text-indigo-700' },
          { label: 'Lista espera', value: stats.listaEspera, cor: 'text-orange-700' },
          { label: 'Vagas livres', value: stats.vagasDisp, cor: 'text-emerald-700' },
          { label: 'Pago sem alocação', value: stats.pagoSemAlocacao, cor: 'text-amber-700' },
        ]).map(s => (
          <div key={s.label} className="bg-white rounded-xl border border-gray-100 shadow-sm p-3 text-center">
            <p className={`text-xl font-black ${s.cor}`}>{s.value}</p>
            <p className="text-[10px] text-gray-400 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* ── Resultado autoalocação ────────────────────────────── */}
      {autoalocResult && (
        <div className={`rounded-xl px-5 py-3 flex items-center gap-3 border text-sm font-semibold ${
          autoalocResult.erros > 0 ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-emerald-50 border-emerald-200 text-emerald-800'
        }`}>
          ✅ Autoalocação concluída: {autoalocResult.alocadas} alocadas · {autoalocResult.leitos} leitos · {autoalocResult.listaEspera} em lista de espera
          <button onClick={() => setAutoalocResult(null)} className="ml-auto text-gray-400 hover:text-gray-600">✕</button>
        </div>
      )}
      {/* ── Erro de ação rápida ───────────────────────────── */}
      {quickErro && (
        <div className="rounded-xl px-5 py-3 flex items-center gap-3 border bg-red-50 border-red-200 text-red-700 text-sm font-semibold">
          ⚠️ {quickErro}
          <button onClick={() => setQuickErro(null)} className="ml-auto text-red-400 hover:text-red-600">✕</button>
        </div>
      )}
      {/* ════════════ SUB-ABA: ALOCAÇÕES ════════════════════════ */}
      {subAba === 'hospedagens' && (
        <div className="space-y-4">

          {/* Botão autoalocar + filtros */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex flex-wrap gap-3 items-end">
            <button
              onClick={autoalocar}
              disabled={autoalocando || stats.elegiveis === 0}
              title="Reprocessa hospedagens pagas que ainda não receberam leito. O fluxo normal já aloca automaticamente após pagamento."
              className="w-full sm:w-auto flex items-center gap-2 bg-[#0D2B4E] text-white px-5 py-2.5 rounded-xl text-sm font-bold hover:bg-[#0a1e38] transition disabled:opacity-50"
            >
              {autoalocando ? '⏳ Alocando...' : '🤖 Processar pendências'}
            </button>

            <a
              href={`/eventos/${eventoId}/hospedagem/checkin`}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full sm:w-auto flex items-center gap-2 bg-teal-600 text-white px-5 py-2.5 rounded-xl text-sm font-bold hover:bg-teal-700 transition"
            >
              📱 Tela Check-in
            </a>

            <div className="flex flex-wrap gap-2 flex-1 min-w-0">
              <select value={filtroStatus} onChange={e => setFiltroStatus(e.target.value)}
                className="w-full sm:w-auto border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#123b63]">
                <option value="">Todos os status</option>
                <option value="aguardando_pagamento">Aguardando pagamento</option>
                <option value="elegivel">Elegível para alocação</option>
                <option value="pago_sem_alocacao">Pago sem alocação</option>
                <option value="alocada">Alocada</option>
                <option value="confirmada">Confirmada</option>
                <option value="checkin_realizado">Check-in Realizado</option>
                <option value="lista_espera">Lista Espera</option>
              </select>

              <select value={filtroSexo} onChange={e => setFiltroSexo(e.target.value)}
                className="w-full sm:w-auto border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#123b63]">
                <option value="">Todos os sexos</option>
                <option value="M">Masculino</option>
                <option value="F">Feminino</option>
                <option value="N">Não informado</option>
              </select>

              <select value={filtroAloj} onChange={e => setFiltroAloj(e.target.value)}
                className="w-full sm:w-auto border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#123b63]">
                <option value="">Todos os alojamentos</option>
                {alojamentos.map(a => <option key={a.id} value={a.id}>{a.nome}</option>)}
              </select>

              <select value={filtroSup} onChange={e => setFiltroSup(e.target.value)}
                className="w-full sm:w-auto border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#123b63]">
                <option value="">Toda supervisão</option>
                {supervisoes.map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}
              </select>

              <select value={filtroNecEsp} onChange={e => setFiltroNecEsp(e.target.value)}
                className="w-full sm:w-auto border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#123b63]">
                <option value="">Nec. especial?</option>
                <option value="1">Sim</option>
                <option value="0">Não</option>
              </select>

              {gruposDisponiveis.length > 0 && (
                <select value={filtroGrupo} onChange={e => setFiltroGrupo(e.target.value)}
                  className="w-full sm:w-auto border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#123b63]">
                  <option value="">Todos os grupos</option>
                  {gruposDisponiveis.map(g => <option key={g} value={g}>{g}</option>)}
                </select>
              )}

              <select value={filtroPend} onChange={e => setFiltroPend(e.target.value)}
                className="w-full sm:w-auto border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#123b63]">
                <option value="">Todas as pendências</option>
                {Object.entries(PENDENCIA_LABEL).map(([codigo, label]) => (
                  <option key={codigo} value={codigo}>{label}</option>
                ))}
              </select>

              <input
                type="text"
                value={busca}
                onChange={e => setBusca(e.target.value)}
                placeholder="Buscar nome ou CPF..."
                className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#123b63]"
              />
            </div>

            <button onClick={() => exportarCSV(hospFiltradas, 'geral')}
              className="w-full sm:w-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-semibold text-gray-700 hover:bg-gray-50 transition">
              📥 CSV
            </button>
          </div>

          {/* Pendências de hospedagem */}
          <div className="bg-white rounded-xl border border-amber-200 shadow-sm p-4">
            <div className="flex items-center justify-between gap-3 mb-3">
              <h3 className="text-sm font-bold text-amber-800">Pendências de hospedagem</h3>
              <span className="text-xs text-amber-700">{pendenciasResumo.reduce((s, p) => s + p.qtd, 0)} ocorrências</span>
            </div>
            {pendenciasResumo.length === 0 ? (
              <p className="text-xs text-gray-500">Nenhuma pendência operacional encontrada no momento.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {pendenciasResumo.map((p) => (
                  <button
                    key={p.codigo}
                    onClick={() => setFiltroPend(p.codigo)}
                    className="text-left px-3 py-2 rounded-lg border border-amber-100 hover:bg-amber-50 transition"
                    title="Filtrar participantes com esta pendência"
                  >
                    <p className="text-xs font-semibold text-amber-900">{p.label}</p>
                    <p className="text-[11px] text-amber-700">{p.qtd} caso(s)</p>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Tabela hospedagens */}
          {loadingHosp ? (
            <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="bg-white rounded-xl h-12 animate-pulse" />)}</div>
          ) : hospFiltradas.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
              <span className="text-4xl mb-3 block">🛏️</span>
              <p className="text-gray-500 font-medium">Nenhuma solicitação de hospedagem encontrada</p>
              <p className="text-xs text-gray-400 mt-1">
                {hospedagens.length === 0
                  ? 'Nenhuma inscrição com hospedagem=true ainda. Realize uma inscrição AGO com hospedagem para que apareça aqui.'
                  : 'Ajuste os filtros para ver as solicitações.'
                }
              </p>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
              <table className="w-full min-w-[1260px] text-sm">
                <thead>
                  <tr>
                    <th className={thCls}>Nome</th>
                    <th className={thCls}>Categoria</th>
                    <th className={thCls}>Sx / Idade</th>
                    <th className={thCls}>Campo</th>
                    <th className={thCls}>Supervisão</th>
                    <th className={thCls}>Grupo</th>
                    <th className={thCls}>Alojamento</th>
                    <th className={thCls}>Status</th>
                    <th className={thCls + ' text-center'}>🦽</th>
                    <th className={thCls + ' text-center'}>🩺</th>
                    <th className={thCls + ' text-center'}>⬇</th>
                    <th className={thCls}>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {hospFiltradas.map(h => {
                    const statusRef = h.status_operacional ?? h.status;
                    const stCfg = STATUS_HOSP_CFG[statusRef] ?? STATUS_HOSP_CFG.solicitada;
                    const carregando = salvandoId === h.inscricao_id;
                    const idade = h.data_nascimento
                      ? (() => {
                          const hoje = new Date();
                          const nasc = new Date(h.data_nascimento);
                          let i = hoje.getFullYear() - nasc.getFullYear();
                          const m = hoje.getMonth() - nasc.getMonth();
                          if (m < 0 || (m === 0 && hoje.getDate() < nasc.getDate())) i--;
                          return i;
                        })()
                      : null;
                    return (
                      <tr key={h.inscricao_id} className={`border-t border-gray-50 hover:bg-gray-50 transition ${carregando ? 'opacity-60' : ''}`}>
                        <td className={tdCls + ' font-medium text-gray-900 max-w-[160px] truncate'} title={h.nome_inscrito}>{h.nome_inscrito ?? '-'}</td>
                        <td className={tdCls + ' text-xs text-gray-500 max-w-[120px] truncate'} title={h.tipo_inscricao ?? ''}>{h.tipo_inscricao ?? <span className="text-gray-300">—</span>}</td>
                        <td className={tdCls + ' text-xs'}>{h.sexo ?? '—'}{idade !== null ? ` / ${idade}a` : ''}</td>
                        <td className={tdCls + ' text-xs text-gray-500'}>{nomeCampo(h.campo_id ?? null)}</td>
                        <td className={tdCls + ' text-xs text-gray-500'}>{nomeSup(h.supervisao_id ?? null)}</td>
                        <td className={tdCls + ' text-xs'}>{h.grupo_hospedagem ?? <span className="text-gray-300">—</span>}</td>
                        <td className={tdCls}>{h.alojamento_nome ?? <span className="text-gray-400 italic text-xs">Não alocado</span>}</td>
                        <td className={tdCls}>
                          <div className="space-y-1">
                            <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${stCfg.cls}`}>{stCfg.label}</span>
                            {(h.pendencias ?? []).length > 0 && (
                              <p className="text-[10px] text-rose-600 font-semibold" title={(h.pendencias ?? []).map(p => PENDENCIA_LABEL[p] ?? p).join(' | ')}>
                                {(h.pendencias ?? []).length} pendência(s)
                              </p>
                            )}
                          </div>
                        </td>
                        <td className={tdCls + ' text-center'}>
                          {h.necessidade_especial ? (
                            <span title={h.descricao_necessidade ?? ''} className="cursor-help">🦽</span>
                          ) : '—'}
                        </td>
                        <td className={tdCls + ' text-center'}>
                          {h.possui_comorbidade ? (
                            <span title={h.descricao_comorbidade ?? ''} className="cursor-help">🩺</span>
                          ) : '—'}
                        </td>
                        <td className={tdCls + ' text-center'}>
                          {h.cama_inferior ? '↓' : '—'}
                        </td>
                        <td className={tdCls}>
                          <div className="flex gap-1 items-center">
                            {h.status !== 'confirmada' && (
                              <button
                                onClick={() => acaoRapida(h, 'confirmada')}
                                disabled={carregando}
                                title="Confirmar hospedagem"
                                className="text-xs px-2 py-1 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition disabled:opacity-40">
                                ✅
                              </button>
                            )}
                            {h.status !== 'lista_espera' && (
                              <button
                                onClick={() => acaoRapida(h, 'lista_espera')}
                                disabled={carregando}
                                title="Mover para lista de espera"
                                className="text-xs px-2 py-1 rounded-lg bg-orange-500 text-white hover:bg-orange-600 transition disabled:opacity-40">
                                ⏳
                              </button>
                            )}
                            <button
                              onClick={() => abrirEdicao(h)}
                              disabled={carregando}
                              title="Alocar / Editar leito"
                              className="text-xs px-2 py-1 rounded-lg bg-[#123b63] text-white hover:bg-[#0f2a45] transition disabled:opacity-40">
                              ✏️
                            </button>
                            {h.id && (
                              <button
                                onClick={() => removerHospedagem(h)}
                                disabled={carregando}
                                title="Remover alocação"
                                className="text-xs px-2 py-1 rounded-lg bg-red-500 text-white hover:bg-red-600 transition disabled:opacity-40">
                                🗑️
                              </button>
                            )}
                            {/* Check-in / Checkout rápido */}
                            {(h.status === 'confirmada' || h.status === 'alocada') && (
                              <button
                                onClick={() => acaoCheckin(h, 'checkin')}
                                disabled={salvandoId === h.inscricao_id}
                                title="Registrar check-in"
                                className="text-xs px-2 py-1 rounded-lg bg-teal-600 text-white hover:bg-teal-700 transition disabled:opacity-40">
                                🏠
                              </button>
                            )}
                            {h.status === 'checkin_realizado' && (
                              <button
                                onClick={() => acaoCheckin(h, 'checkout')}
                                disabled={salvandoId === h.inscricao_id}
                                title="Registrar checkout"
                                className="text-xs px-2 py-1 rounded-lg bg-gray-500 text-white hover:bg-gray-600 transition disabled:opacity-40">
                                🚪
                              </button>
                            )}
                            {h.id && (
                              <button
                                onClick={() => abrirOcorrencia(h)}
                                title="Registrar ocorrência"
                                className="text-xs px-2 py-1 rounded-lg bg-amber-500 text-white hover:bg-amber-600 transition">
                                📝
                              </button>
                            )}
                            {h.id && (
                              <button
                                onClick={() => abrirRealocar(h)}
                                title="Realocar participante"
                                className="text-xs px-2 py-1 rounded-lg bg-violet-600 text-white hover:bg-violet-700 transition">
                                🔄
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
          )}
        </div>
      )}

      {/* ════════════ SUB-ABA: ALOJAMENTOS ══════════════════════ */}
      {subAba === 'alojamentos' && (
        <SecaoAlojamentos
          eventoId={eventoId}
          alojamentos={alojamentos}
          loading={loadingAloj}
          onRefresh={fetchAlojamentos}
        />
      )}

      {/* ════════════ SUB-ABA: RELATÓRIOS ══════════════════════ */}
      {subAba === 'relatorios' && (
        <SecaoRelatorios
          hospedagens={hospedagens}
          alojamentos={alojamentos}
          nomeSup={nomeSup}
          nomeCampo={nomeCampo}
          eventoId={eventoId}
          exportarCSV={exportarCSV}
        />
      )}

      {/* ════════════ SUB-ABA: CHEGADAS ═════════════════════════ */}
      {subAba === 'chegadas' && (
        <SecaoChegadas
          hospedagens={hospedagens}
          alojamentos={alojamentos}
          nomeSup={nomeSup}
          nomeCampo={nomeCampo}
          exportarCSV={exportarCSV}
          onCheckin={(h) => acaoCheckin(h, 'checkin')}
          onCheckout={(h) => acaoCheckin(h, 'checkout')}
          salvandoId={salvandoId}
        />
      )}

      {/* ════════════ SUB-ABA: AUSENTES ═════════════════════════ */}
      {subAba === 'ausentes' && (
        <SecaoAusentes
          hospedagens={hospedagens}
          alojamentos={alojamentos}
          nomeSup={nomeSup}
          nomeCampo={nomeCampo}
          exportarCSV={exportarCSV}
          onCheckin={(h) => acaoCheckin(h, 'checkin')}
          salvandoId={salvandoId}
        />
      )}

      {/* ════════════ SUB-ABA: SETORES ══════════════════════════ */}
      {subAba === 'setores' && (
        <SecaoSetores
          hospedagens={hospedagens}
          alojamentos={alojamentos}
          configuracoes={evento.configuracoes_ago ?? null}
          onSincronizar={sincronizarSetores}
          sincronizando={sincronizando}
        />
      )}

      {/* ════════════ SUB-ABA: PAINEL AGO ═══════════════════════ */}
      {subAba === 'painel_ago' && (
        <SecaoPainelAgo
          hospedagens={hospedagens}
          alojamentos={alojamentos}
          configuracoes={evento.configuracoes_ago ?? null}
          exportarCSV={exportarCSV}
        />
      )}

      {/* ════════════ MODAL EDIÇÃO ══════════════════════════════ */}
      {editando && editForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setEditando(null)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-5">
              <div>
                <h3 className="font-bold text-[#123b63] text-base">✏️ Editar Hospedagem</h3>
                <p className="text-xs text-gray-500 mt-0.5">{editando.nome_inscrito}</p>
              </div>
              <button onClick={() => setEditando(null)} className="text-gray-400 hover:text-gray-700 text-xl font-bold leading-none">×</button>
            </div>

            {erroEdit && (
              <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg text-sm">{erroEdit}</div>
            )}

            <div className="space-y-4">
              <div>
                <label className={labelCls}>Alojamento</label>
                <select
                  value={editForm.alojamento_id}
                  onChange={e => setEditForm(f => f ? { ...f, alojamento_id: e.target.value } : f)}
                  className={inputCls}
                >
                  <option value="">Sem alojamento</option>
                  {alojamentos.filter(a => a.ativo).map(a => (
                    <option key={a.id} value={a.id}>
                      {a.nome} ({a.sexo === 'M' ? 'Masc' : a.sexo === 'F' ? 'Fem' : 'Misto'}) — {a.vagas_livres ?? 0}/{a.total_vagas} livres
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className={labelCls}>Tipo de Cama</label>
                <select
                  value={editForm.tipo_cama}
                  onChange={e => setEditForm(f => f ? { ...f, tipo_cama: e.target.value } : f)}
                  className={inputCls}
                >
                  <option value="">Não definido</option>
                  <option value="inferior">⬇ Inferior</option>
                  <option value="superior">⬆ Superior</option>
                </select>
              </div>

              <div>
                <label className={labelCls}>Número do leito</label>
                <input
                  type="text"
                  value={editForm.numero_cama}
                  onChange={e => setEditForm(f => f ? { ...f, numero_cama: e.target.value } : f)}
                  placeholder="Ex: 01, A-12, 120"
                  maxLength={20}
                  className={inputCls}
                />
              </div>

              <div>
                <label className={labelCls}>Status</label>
                <select
                  value={editForm.status}
                  onChange={e => setEditForm(f => f ? { ...f, status: e.target.value } : f)}
                  className={inputCls}
                >
                  <option value="solicitada">Solicitada</option>
                  <option value="alocada">Alocada</option>
                  <option value="confirmada">Confirmada</option>
                  <option value="checkin_realizado">Check-in Realizado</option>
                  <option value="checkout_realizado">Check-out Realizado</option>
                  <option value="lista_espera">Lista de Espera</option>
                  <option value="cancelada">Cancelada</option>
                  <option value="recusada">Recusada</option>
                </select>
              </div>

              <div>
                <label className={labelCls}>Observações</label>
                <textarea
                  value={editForm.observacoes}
                  onChange={e => setEditForm(f => f ? { ...f, observacoes: e.target.value } : f)}
                  rows={3}
                  className={inputCls + ' resize-y'}
                />
              </div>

              {/* Info prioridade e nec. especial */}
              <div className="bg-gray-50 rounded-lg px-4 py-3 text-xs text-gray-600 space-y-1">
                <p><span className="font-semibold">Prioridade calculada:</span> {editando.prioridade}</p>
                {editando.necessidade_especial && (
                  <p><span className="font-semibold">🦽 Necessidade especial:</span> {editando.descricao_necessidade}</p>
                )}
                {editando.cama_inferior && (
                  <p>⬇ Solicitou cama inferior</p>
                )}
                <p><span className="font-semibold">Alocação automática:</span> {editando.alocacao_automatica ? 'Sim' : 'Não (manual)'}</p>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button onClick={() => setEditando(null)}
                className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition">
                Cancelar
              </button>
              <button onClick={salvarEdicao} disabled={salvandoEdit}
                className="flex-1 px-4 py-2.5 rounded-xl bg-[#123b63] text-white text-sm font-bold hover:bg-[#0f2a45] transition disabled:opacity-50">
                {salvandoEdit ? 'Salvando...' : '✅ Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ════════════ MODAL OCORRÊNCIA ══════════════════════════ */}
      {modalOcorr && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <h2 className="text-base font-black text-[#0D2B4E] mb-1">📝 Registrar Ocorrência</h2>
            <p className="text-xs text-gray-500 mb-4">{modalOcorr.nome_inscrito}</p>

            {erroOcorr && (
              <div className="mb-3 bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg text-sm">{erroOcorr}</div>
            )}

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Tipo</label>
                <select value={ocorrTipo} onChange={e => setOcorrTipo(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#123b63]">
                  <option value="observacao_geral">Observação geral</option>
                  <option value="mudanca_leito">Mudança de leito</option>
                  <option value="mudanca_alojamento">Mudança de alojamento</option>
                  <option value="atendimento_medico">Atendimento médico</option>
                  <option value="dano_patrimonio">Dano ao patrimônio</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Descrição</label>
                <textarea value={ocorrDesc} onChange={e => setOcorrDesc(e.target.value)}
                  rows={3} placeholder="Descreva o ocorrido..."
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#123b63] resize-y" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Operador</label>
                <input type="text" value={ocorrOp} onChange={e => setOcorrOp(e.target.value)}
                  placeholder="Nome do responsável"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#123b63]" />
              </div>
            </div>

            <div className="flex gap-3 mt-5">
              <button onClick={() => setModalOcorr(null)}
                className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition">
                Cancelar
              </button>
              <button onClick={salvarOcorrencia} disabled={salvandoOcorr}
                className="flex-1 px-4 py-2.5 rounded-xl bg-amber-500 text-white text-sm font-bold hover:bg-amber-600 transition disabled:opacity-50">
                {salvandoOcorr ? 'Salvando...' : '📝 Registrar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ════════════ MODAL REALOCAÇÃO ══════════════════════════ */}
      {modalRealocar && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <h2 className="text-base font-black text-[#0D2B4E] mb-1">🔄 Realocar Participante</h2>
            <p className="text-xs text-gray-500 mb-4">{modalRealocar.nome_inscrito}</p>

            {erroReal && (
              <div className="mb-3 bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg text-sm">{erroReal}</div>
            )}

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Novo alojamento *</label>
                <select value={realAlojId} onChange={e => setRealAlojId(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#123b63]">
                  <option value="">Selecione...</option>
                  {alojamentos.filter(a => a.ativo).map(a => (
                    <option key={a.id} value={a.id}>
                      {a.nome} — {(a.vagas_livres ?? 0)}/{a.total_vagas} livres
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Tipo de cama</label>
                <select value={realTipoCama} onChange={e => setRealTipoCama(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#123b63]">
                  <option value="">Não definido</option>
                  <option value="inferior">Inferior</option>
                  <option value="superior">Superior</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Motivo</label>
                <input type="text" value={realMotivo} onChange={e => setRealMotivo(e.target.value)}
                  placeholder="Motivo da realocação (opcional)"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#123b63]" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Operador</label>
                <input type="text" value={realOp} onChange={e => setRealOp(e.target.value)}
                  placeholder="Nome do responsável"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#123b63]" />
              </div>
            </div>

            <div className="flex gap-3 mt-5">
              <button onClick={() => setModalRealocar(null)}
                className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition">
                Cancelar
              </button>
              <button onClick={salvarRealocacao} disabled={salvandoReal || !realAlojId}
                className="flex-1 px-4 py-2.5 rounded-xl bg-violet-600 text-white text-sm font-bold hover:bg-violet-700 transition disabled:opacity-50">
                {salvandoReal ? 'Realocando...' : '🔄 Realocar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// SEÇÃO: CHEGADAS (check-in realizado)
// ════════════════════════════════════════════════════════════════════════════
function SecaoChegadas({
  hospedagens,
  alojamentos: _alojamentos,
  nomeSup: _nomeSup,
  nomeCampo: _nomeCampo,
  exportarCSV,
  onCheckin: _onCheckin,
  onCheckout,
  salvandoId,
}: {
  hospedagens: Hospedagem[];
  alojamentos: Alojamento[];
  nomeSup: (id: string | null) => string;
  nomeCampo: (id: string | null) => string;
  exportarCSV: (lista: Hospedagem[], nome: string) => void;
  onCheckin: (h: Hospedagem) => void;
  onCheckout: (h: Hospedagem) => void;
  salvandoId: string | null;
}) {
  const chegadas = hospedagens.filter(h => h.status === 'checkin_realizado' || h.status === 'checkout_realizado');
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-black text-[#0D2B4E] text-sm">
          📋 Chegadas — {chegadas.length} participante(s)
        </h3>
        <button onClick={() => exportarCSV(chegadas, 'chegadas')}
          className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition font-semibold">
          ⬇ CSV
        </button>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              {['Nome', 'Alojamento', 'Leito', 'Status', 'Check-in', 'Ações'].map(h => (
                <th key={h} className="px-3 py-2 text-left text-[10px] font-bold text-gray-500 uppercase">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {chegadas.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Nenhuma chegada registrada ainda.</td></tr>
            ) : chegadas.map(h => (
              <tr key={h.inscricao_id} className="border-t border-gray-50 hover:bg-gray-50/50">
                <td className="px-3 py-2 font-semibold text-gray-800">{h.nome_inscrito}</td>
                <td className="px-3 py-2 text-gray-600">{h.alojamento_nome ?? '—'}</td>
                <td className="px-3 py-2 text-gray-600">{h.numero_cama ?? '—'}</td>
                <td className="px-3 py-2">
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                    h.status === 'checkin_realizado' ? 'bg-teal-100 text-teal-700' : 'bg-gray-100 text-gray-600'
                  }`}>
                    {h.status === 'checkin_realizado' ? 'Check-in ✓' : 'Check-out ✓'}
                  </span>
                </td>
                <td className="px-3 py-2 text-gray-500">
                  {h.checkin_at ? new Date(h.checkin_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                </td>
                <td className="px-3 py-2">
                  {h.status === 'checkin_realizado' && (
                    <button onClick={() => onCheckout(h)} disabled={salvandoId === h.inscricao_id}
                      className="text-xs px-2 py-1 rounded-lg bg-gray-500 text-white hover:bg-gray-600 transition disabled:opacity-40">
                      🚪 Checkout
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// SEÇÃO: AUSENTES (confirmados/alocados sem check-in)
// ════════════════════════════════════════════════════════════════════════════
function SecaoAusentes({
  hospedagens,
  alojamentos: _alojamentos,
  nomeSup,
  nomeCampo: _nomeCampo,
  exportarCSV,
  onCheckin,
  salvandoId,
}: {
  hospedagens: Hospedagem[];
  alojamentos: Alojamento[];
  nomeSup: (id: string | null) => string;
  nomeCampo: (id: string | null) => string;
  exportarCSV: (lista: Hospedagem[], nome: string) => void;
  onCheckin: (h: Hospedagem) => void;
  salvandoId: string | null;
}) {
  const ausentes = hospedagens.filter(
    h => (h.status === 'confirmada' || h.status === 'alocada') && !h.checkin_at,
  );
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-black text-[#0D2B4E] text-sm">
          ⚠️ Ausentes — {ausentes.length} participante(s) confirmados sem check-in
        </h3>
        <button onClick={() => exportarCSV(ausentes, 'ausentes')}
          className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition font-semibold">
          ⬇ CSV
        </button>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              {['Nome', 'Supervisão', 'Alojamento', 'Leito', 'Status', 'Ação'].map(h => (
                <th key={h} className="px-3 py-2 text-left text-[10px] font-bold text-gray-500 uppercase">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ausentes.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Nenhum ausente — todos realizaram check-in! 🎉</td></tr>
            ) : ausentes.map(h => (
              <tr key={h.inscricao_id} className="border-t border-gray-50 hover:bg-gray-50/50">
                <td className="px-3 py-2 font-semibold text-gray-800">{h.nome_inscrito}</td>
                <td className="px-3 py-2 text-gray-500">{nomeSup(h.supervisao_id ?? null)}</td>
                <td className="px-3 py-2 text-gray-600">{h.alojamento_nome ?? '—'}</td>
                <td className="px-3 py-2 text-gray-600">{h.numero_cama ?? '—'}</td>
                <td className="px-3 py-2">
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-700">
                    Aguardando
                  </span>
                </td>
                <td className="px-3 py-2">
                  <button onClick={() => onCheckin(h)} disabled={salvandoId === h.inscricao_id}
                    className="text-xs px-2 py-1 rounded-lg bg-teal-600 text-white hover:bg-teal-700 transition disabled:opacity-40">
                    🏠 Check-in
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// SEÇÃO: GERENCIAR ALOJAMENTOS
// ════════════════════════════════════════════════════════════════════════════
function SecaoAlojamentos({
  eventoId,
  alojamentos,
  loading,
  onRefresh,
}: {
  eventoId: string;
  alojamentos: Alojamento[];
  loading: boolean;
  onRefresh: () => void;
}) {
  const [form, setForm] = useState({
    nome: '', publico: 'masculino_geral' as string, total_vagas: '20',
    camas_inferiores: '10', camas_superiores: '10',
  });
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);

  // Modal de edição de alojamento
  const [modalEditar, setModalEditar] = useState<Alojamento | null>(null);
  const [editForm, setEditForm] = useState({
    nome: '', publico: 'masculino_geral' as string, total_vagas: 20,
    camas_inferiores: 10, camas_superiores: 10, ativo: true,
  });
  const [salvandoEdit, setSalvandoEdit] = useState(false);
  const [erroEdit, setErroEdit] = useState<string | null>(null);

  function abrirModalEdicao(aloj: Alojamento) {
    setModalEditar(aloj);
    setEditForm({
      nome: aloj.nome,
      publico: aloj.publico,
      total_vagas: aloj.total_vagas,
      camas_inferiores: aloj.camas_inferiores,
      camas_superiores: aloj.camas_superiores,
      ativo: aloj.ativo,
    });
    setErroEdit(null);
  }

  async function salvarAlojamento(e: React.FormEvent) {
    e.preventDefault();
    if (!modalEditar) return;
    setErroEdit(null);

    const ocupados = modalEditar.total_vagas - (modalEditar.vagas_livres ?? 0);
    if (editForm.total_vagas < ocupados) {
      setErroEdit(`Não é possível reduzir a capacidade abaixo da quantidade de leitos ocupados (${ocupados} ocupados).`);
      return;
    }

    if (editForm.camas_inferiores + editForm.camas_superiores !== editForm.total_vagas) {
      setErroEdit("A soma das camas inferiores e superiores deve ser igual ao total de vagas.");
      return;
    }

    if (editForm.publico !== modalEditar.publico && ocupados > 0) {
      setErroEdit("Não é possível alterar o público/grupo de um alojamento com hóspedes alocados.");
      return;
    }

    if (!editForm.ativo && ocupados > 0) {
      setErroEdit("Não é possível desativar o alojamento porque existem hospedagens alocadas nele. Realoque os ocupantes primeiro.");
      return;
    }

    setSalvandoEdit(true);
    try {
      const res = await fetch(`/api/eventos/${eventoId}/alojamentos`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: modalEditar.id,
          nome: editForm.nome.trim(),
          publico: editForm.publico,
          sexo: editForm.publico === 'feminino' ? 'F' : editForm.publico === 'misto' ? null : 'M',
          total_vagas: editForm.total_vagas,
          camas_inferiores: editForm.camas_inferiores,
          camas_superiores: editForm.camas_superiores,
          ativo: editForm.ativo,
        }),
      });

      if (!res.ok) {
        const j = await res.json();
        throw new Error(j.error ?? 'Erro ao salvar alterações');
      }

      setModalEditar(null);
      onRefresh();
    } catch (err) {
      setErroEdit(err instanceof Error ? err.message : 'Erro ao salvar');
    } finally {
      setSalvandoEdit(false);
    }
  }

  async function criarAlojamento(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    if (!form.nome.trim()) return setErro('Nome obrigatório.');
    setSalvando(true);
    try {
      const res = await fetch(`/api/eventos/${eventoId}/alojamentos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome: form.nome.trim(),
          publico: form.publico,
          sexo: form.publico === 'feminino' ? 'F' : form.publico === 'misto' ? null : 'M',
          total_vagas: parseInt(form.total_vagas) || 0,
          camas_inferiores: parseInt(form.camas_inferiores) || 0,
          camas_superiores: parseInt(form.camas_superiores) || 0,
        }),
      });
      if (!res.ok) { const j = await res.json(); throw new Error(j.error ?? 'Erro'); }
      setSucesso(`Alojamento "${form.nome}" criado com sucesso!`);
      setForm({ nome: '', publico: 'masculino_geral', total_vagas: '20', camas_inferiores: '10', camas_superiores: '10' });
      onRefresh();
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao criar');
    } finally {
      setSalvando(false);
    }
  }

  async function toggleAtivo(aloj: Alojamento) {
    const res = await fetch(`/api/eventos/${eventoId}/alojamentos`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: aloj.id, ativo: !aloj.ativo }),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      alert(json.error || 'Erro ao alterar status do alojamento.');
      return;
    }
    onRefresh();
  }

  return (
    <div className="space-y-5">
      {/* Formulário criar alojamento */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
        <h3 className="font-bold text-[#123b63] mb-4">➕ Novo Alojamento</h3>
        {erro && <div className="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</div>}
        {sucesso && <div className="mb-3 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">{sucesso}</div>}
        <form onSubmit={criarAlojamento}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div className="md:col-span-3">
              <label className={labelCls}>Nome do alojamento *</label>
              <input type="text" value={form.nome} onChange={e => setForm(f => ({ ...f, nome: e.target.value }))}
                placeholder="Ex: Bloco A — Masculino" className={inputCls} required />
            </div>
            <div>
              <label className={labelCls}>Público</label>
              <select value={form.publico} onChange={e => setForm(f => ({ ...f, publico: e.target.value }))} className={inputCls}>
                <option value="masculino_geral">👨 Masculino (Geral)</option>
                <option value="feminino">👩 Feminino</option>
                <option value="presidentes">👨 Presidentes</option>
                <option value="jubilados">👨 Jubilados</option>
                <option value="misto">👥 Misto</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Total de vagas</label>
              <input type="number" min="1" value={form.total_vagas}
                onChange={e => {
                  const val = parseInt(e.target.value) || 0;
                  setForm(f => ({
                    ...f,
                    total_vagas: e.target.value,
                    camas_superiores: String(Math.max(0, val - (parseInt(f.camas_inferiores) || 0)))
                  }));
                }} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Camas inferiores</label>
              <input type="number" min="0" value={form.camas_inferiores}
                onChange={e => {
                  const val = parseInt(e.target.value) || 0;
                  setForm(f => ({
                    ...f,
                    camas_inferiores: e.target.value,
                    camas_superiores: String(Math.max(0, (parseInt(f.total_vagas) || 0) - val))
                  }));
                }} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Camas superiores</label>
              <input type="number" min="0" value={form.camas_superiores}
                onChange={e => {
                  const val = parseInt(e.target.value) || 0;
                  setForm(f => ({
                    ...f,
                    camas_superiores: e.target.value,
                    camas_inferiores: String(Math.max(0, (parseInt(f.total_vagas) || 0) - val))
                  }));
                }} className={inputCls} />
            </div>
          </div>
          <button type="submit" disabled={salvando}
            className="bg-[#123b63] text-white px-6 py-2.5 rounded-lg text-sm font-semibold hover:bg-[#0f2a45] transition disabled:opacity-50">
            {salvando ? 'Criando...' : '✅ Criar Alojamento'}
          </button>
        </form>
      </div>

      {/* Lista de alojamentos */}
      {loading ? (
        <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="bg-white rounded-xl h-16 animate-pulse" />)}</div>
      ) : alojamentos.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
          <span className="text-4xl mb-3 block">🏠</span>
          <p className="text-gray-500 font-medium">Nenhum alojamento cadastrado</p>
          <p className="text-xs text-gray-400 mt-1">Adicione alojamentos acima para começar a alocar participantes.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {alojamentos.map(aloj => {
            const vagsLivres = aloj.vagas_livres ?? 0;
            const ocupados   = aloj.total_vagas - vagsLivres;
            const pct = aloj.total_vagas > 0 ? Math.round((ocupados / aloj.total_vagas) * 100) : 0;
            const cor = pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-orange-500' : 'bg-emerald-500';
            const PUBLICO_LABEL: Record<string, string> = {
              feminino: '👩 Feminino', masculino_geral: '👨 Masculino (Geral)',
              presidentes: '👨 Presidentes', jubilados: '👨 Jubilados', misto: '👥 Misto',
            };
            return (
              <div key={aloj.id} className={`bg-white rounded-xl border shadow-sm p-5 ${!aloj.ativo ? 'opacity-60' : 'border-gray-200'}`}>
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h4 className="font-bold text-gray-900 text-sm">{aloj.nome}</h4>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {PUBLICO_LABEL[aloj.publico] ?? aloj.publico} · {aloj.total_vagas} vagas
                    </p>
                  </div>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${aloj.ativo ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                    {aloj.ativo ? 'Ativo' : 'Inativo'}
                  </span>
                </div>

                {/* Barra de ocupação */}
                <div className="mb-3">
                  <div className="flex justify-between text-xs text-gray-500 mb-1">
                    <span>{ocupados}/{aloj.total_vagas} ocupados</span>
                    <span className={pct >= 100 ? 'text-red-600 font-bold' : ''}>{pct}%</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${cor}`} style={{ width: `${Math.min(100, pct)}%` }} />
                  </div>
                </div>

                <div className="flex gap-1.5 text-xs text-gray-500 mb-3">
                  <span className="bg-sky-50 text-sky-700 px-2 py-0.5 rounded-full">⬇ {aloj.camas_inferiores} inf.</span>
                  <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">⬆ {aloj.camas_superiores} sup.</span>
                </div>

                <div className="flex gap-1.5 mt-2">
                  <button onClick={() => abrirModalEdicao(aloj)}
                    className="flex-1 text-xs py-1.5 rounded-lg border border-gray-200 text-[#0D2B4E] hover:bg-gray-50 transition font-semibold">
                    ✏️ Editar
                  </button>
                  <button onClick={() => toggleAtivo(aloj)}
                    className="flex-1 text-xs py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition font-semibold">
                    {aloj.ativo ? 'Desativar' : 'Ativar'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal de Edição de Alojamento */}
      {modalEditar && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setModalEditar(null)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-5">
              <div>
                <h3 className="font-bold text-[#123b63] text-base">✏️ Editar Alojamento</h3>
                <p className="text-xs text-gray-500 mt-0.5">{modalEditar.nome}</p>
              </div>
              <button onClick={() => setModalEditar(null)} className="text-gray-400 hover:text-gray-700 text-xl font-bold leading-none">×</button>
            </div>

            {erroEdit && (
              <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg text-sm">{erroEdit}</div>
            )}

            <form onSubmit={salvarAlojamento} className="space-y-4">
              <div>
                <label className={labelCls}>Nome do alojamento *</label>
                <input
                  type="text"
                  value={editForm.nome}
                  onChange={e => setEditForm(f => ({ ...f, nome: e.target.value }))}
                  className={inputCls}
                  required
                />
              </div>

              <div>
                <label className={labelCls}>Público</label>
                <select
                  value={editForm.publico}
                  onChange={e => setEditForm(f => ({ ...f, publico: e.target.value }))}
                  className={inputCls}
                >
                  <option value="masculino_geral">👨 Masculino (Geral)</option>
                  <option value="feminino">👩 Feminino</option>
                  <option value="presidentes">👨 Presidentes</option>
                  <option value="jubilados">👨 Jubilados</option>
                  <option value="misto">👥 Misto</option>
                </select>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className={labelCls}>Total vagas</label>
                  <input
                    type="number"
                    min="1"
                    value={editForm.total_vagas}
                    onChange={e => {
                      const val = parseInt(e.target.value) || 0;
                      setEditForm(f => ({
                        ...f,
                        total_vagas: val,
                        camas_superiores: Math.max(0, val - f.camas_inferiores)
                      }));
                    }}
                    className={inputCls}
                    required
                  />
                </div>
                <div>
                  <label className={labelCls}>Inferiores</label>
                  <input
                    type="number"
                    min="0"
                    value={editForm.camas_inferiores}
                    onChange={e => {
                      const val = parseInt(e.target.value) || 0;
                      setEditForm(f => ({
                        ...f,
                        camas_inferiores: val,
                        camas_superiores: Math.max(0, f.total_vagas - val)
                      }));
                    }}
                    className={inputCls}
                    required
                  />
                </div>
                <div>
                  <label className={labelCls}>Superiores</label>
                  <input
                    type="number"
                    min="0"
                    value={editForm.camas_superiores}
                    onChange={e => {
                      const val = parseInt(e.target.value) || 0;
                      setEditForm(f => ({
                        ...f,
                        camas_superiores: val,
                        camas_inferiores: Math.max(0, f.total_vagas - val)
                      }));
                    }}
                    className={inputCls}
                    required
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 py-2">
                <input
                  type="checkbox"
                  id="edit-ativo"
                  checked={editForm.ativo}
                  onChange={e => setEditForm(f => ({ ...f, ativo: e.target.checked }))}
                  className="rounded border-gray-300 text-[#123b63] focus:ring-[#123b63]"
                />
                <label htmlFor="edit-ativo" className="text-sm font-semibold text-gray-700 select-none cursor-pointer">
                  Alojamento ativo para alocação
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setModalEditar(null)}
                  className="px-4 py-2 rounded-lg text-sm border border-gray-300 text-gray-700 hover:bg-gray-50 transition font-semibold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={salvandoEdit}
                  className="px-5 py-2 rounded-lg text-sm bg-[#123b63] text-white font-bold hover:bg-[#0f2a45] transition disabled:opacity-50"
                >
                  {salvandoEdit ? 'Salvando...' : 'Salvar alterações'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// SEÇÃO: RELATÓRIOS DE HOSPEDAGEM
// ════════════════════════════════════════════════════════════════════════════
type RelHospTipo = 'geral' | 'por_alojamento' | 'masculino' | 'feminino' | 'nec_especial' | 'cama_inferior' | 'lista_espera';

function SecaoRelatorios({
  hospedagens,
  alojamentos,
  nomeSup: _nomeSup,
  nomeCampo: _nomeCampo,
  eventoId,
  exportarCSV,
}: {
  hospedagens: Hospedagem[];
  alojamentos: Alojamento[];
  nomeSup: (id: string | null) => string;
  nomeCampo: (id: string | null) => string;
  eventoId: string;
  exportarCSV: (lista: Hospedagem[], nome: string) => void;
}) {
  const [relTipo, setRelTipo] = useState<RelHospTipo>('geral');
  const [filtroAloj, setFiltroAloj] = useState('');

  const REL_TABS: { id: RelHospTipo; label: string; icon: string }[] = [
    { id: 'geral',         label: 'Geral',          icon: '📋' },
    { id: 'por_alojamento',label: 'Por Alojamento', icon: '🏠' },
    { id: 'masculino',     label: 'Masculino',      icon: '👨' },
    { id: 'feminino',      label: 'Feminino',       icon: '👩' },
    { id: 'nec_especial',  label: 'Nec. Especial',  icon: '🦽' },
    { id: 'cama_inferior', label: 'Cama Inferior',  icon: '⬇' },
    { id: 'lista_espera',  label: 'Lista Espera',   icon: '⏳' },
  ];

  const lista = useMemo(() => {
    let l = hospedagens;
    if (relTipo === 'masculino')     l = l.filter(h => h.sexo === 'M');
    if (relTipo === 'feminino')      l = l.filter(h => h.sexo === 'F');
    if (relTipo === 'nec_especial')  l = l.filter(h => h.necessidade_especial);
    if (relTipo === 'cama_inferior') l = l.filter(h => h.cama_inferior);
    if (relTipo === 'lista_espera')  l = l.filter(h => h.status === 'lista_espera');
    if (relTipo === 'por_alojamento' && filtroAloj) l = l.filter(h => h.alojamento_id === filtroAloj);
    return l;
  }, [hospedagens, relTipo, filtroAloj]);

  const porAlojamento = useMemo(() => {
    // 1. Mapeia os alojamentos cadastrados
    const map = new Map<string, {
      id: string;
      nome: string;
      vagas_totais: number | null;
      ocupadas: number | null;
      livres: number | null;
      lista_espera: number | null;
      taxa: number | null;
      isSemAlojamento?: boolean;
    }>();

    alojamentos.forEach(aloj => {
      const associated = hospedagens.filter(h => h.alojamento_id === aloj.id);
      
      // Regra de ocupação real: leito ocupado (ou status como fallback)
      const ocupadas = associated.filter(h => 
        h.tem_leito_ocupado || ['alocada', 'confirmada', 'checkin_realizado'].includes(h.status_operacional ?? h.status)
      ).length;

      const lista_espera = associated.filter(h => 
        (h.status_operacional ?? h.status) === 'lista_espera'
      ).length;

      const totalVagas = aloj.total_vagas ?? 0;
      const livres = Math.max(0, totalVagas - ocupadas);
      const taxa = totalVagas > 0 ? Math.round((ocupadas / totalVagas) * 100) : 0;

      map.set(aloj.id, {
        id: aloj.id,
        nome: aloj.nome,
        vagas_totais: totalVagas,
        ocupadas,
        livres,
        lista_espera,
        taxa,
      });
    });

    const result = Array.from(map.values()).sort((a, b) => a.nome.localeCompare(b.nome));

    // 2. Mapeia os sem alojamento
    const semAloj = hospedagens.filter(h => !h.alojamento_id);

    const aguardandoPagamento = semAloj.filter(h => (h.status_operacional ?? h.status) === 'aguardando_pagamento').length;
    const listaEsperaSemAloj = semAloj.filter(h => (h.status_operacional ?? h.status) === 'lista_espera').length;
    const pendenteAlocacao = semAloj.filter(h => (h.status_operacional ?? h.status) === 'elegivel').length;
    const outrasSemAloj = semAloj.filter(h => !['aguardando_pagamento', 'lista_espera', 'elegivel'].includes(h.status_operacional ?? h.status)).length;

    if (aguardandoPagamento > 0) {
      result.push({
        id: 'sem_aloj_pagamento',
        nome: 'Sem alojamento (Aguardando pagamento)',
        vagas_totais: null,
        ocupadas: aguardandoPagamento,
        livres: null,
        lista_espera: null,
        taxa: null,
        isSemAlojamento: true,
      });
    }
    if (listaEsperaSemAloj > 0) {
      result.push({
        id: 'sem_aloj_espera',
        nome: 'Sem alojamento (Lista de espera)',
        vagas_totais: null,
        ocupadas: null,
        livres: null,
        lista_espera: listaEsperaSemAloj,
        taxa: null,
        isSemAlojamento: true,
      });
    }
    if (pendenteAlocacao > 0) {
      result.push({
        id: 'sem_aloj_pendente',
        nome: 'Sem alojamento (Pendente de alocação)',
        vagas_totais: null,
        ocupadas: pendenteAlocacao,
        livres: null,
        lista_espera: null,
        taxa: null,
        isSemAlojamento: true,
      });
    }
    if (outrasSemAloj > 0) {
      result.push({
        id: 'sem_aloj_outras',
        nome: 'Sem alojamento (Outros / Solicitados)',
        vagas_totais: null,
        ocupadas: outrasSemAloj,
        livres: null,
        lista_espera: null,
        taxa: null,
        isSemAlojamento: true,
      });
    }

    return result;
  }, [hospedagens, alojamentos]);

  function imprimir() {
    const params = new URLSearchParams({
      tipo: 'hospedagem',
      rel: relTipo,
      ...(filtroAloj ? { aloj: filtroAloj } : {}),
    });
    window.open(`/eventos/${eventoId}/relatorios/print?${params}`, '_blank', 'width=960,height=720');
  }

  const thR = 'text-left text-xs font-semibold text-gray-500 uppercase tracking-wide py-2.5 px-3 bg-gray-50 whitespace-nowrap';
  const tdR = 'py-2.5 px-3 text-sm text-gray-700 border-t border-gray-50 whitespace-nowrap';
  const tdN = `${tdR} text-right tabular-nums`;

  return (
    <div className="space-y-4">
      {/* Sub-tabs relatório */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 overflow-x-auto">
        {REL_TABS.map(t => (
          <button key={t.id} onClick={() => setRelTipo(t.id)}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition whitespace-nowrap flex-shrink-0 ${
              relTipo === t.id ? 'bg-white text-[#123b63] shadow-sm' : 'text-gray-500 hover:text-gray-800'
            }`}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* Ações + filtro alojamento */}
      <div className="flex flex-wrap gap-3 items-center">
        {relTipo === 'por_alojamento' && (
          <select value={filtroAloj} onChange={e => setFiltroAloj(e.target.value)}
            className="w-full sm:w-auto border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#123b63]">
            <option value="">Todos os alojamentos</option>
            {alojamentos.map(a => <option key={a.id} value={a.id}>{a.nome}</option>)}
          </select>
        )}
        <div className="ml-auto flex flex-wrap gap-2">
          <button onClick={() => exportarCSV(lista, relTipo)}
            className="w-full sm:w-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-semibold text-gray-700 hover:bg-gray-50 transition">
            📥 CSV
          </button>
          <button onClick={imprimir}
            className="w-full sm:w-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#123b63] text-white text-xs font-semibold hover:bg-[#0f2a45] transition">
            🖨️ Imprimir
          </button>
        </div>
      </div>

      <p className="text-xs text-gray-400">{lista.length} registro(s)</p>

      {/* ── POR ALOJAMENTO (resumo) ─────── */}
      {relTipo === 'por_alojamento' && !filtroAloj && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
          <table className="w-full min-w-[720px]">
            <thead><tr>
              <th className={thR}>Alojamento</th>
              <th className={thR + ' text-right'}>Vagas Totais</th>
              <th className={thR + ' text-right'}>Alocados/Ocupados</th>
              <th className={thR + ' text-right'}>Livres</th>
              <th className={thR + ' text-right'}>Lista Espera</th>
              <th className={thR + ' text-right'}>Taxa Ocupação</th>
            </tr></thead>
            <tbody>
              {porAlojamento.map(r => (
                <tr key={r.nome} className="hover:bg-gray-50 transition">
                  <td className={tdR + ' font-medium'}>{r.nome}</td>
                  <td className={tdN}>{r.vagas_totais !== null ? r.vagas_totais : '—'}</td>
                  <td className={tdN + (r.ocupadas !== null && r.ocupadas > 0 ? ' text-emerald-700' : '')}>
                    {r.ocupadas !== null ? r.ocupadas : '—'}
                  </td>
                  <td className={tdN}>{r.livres !== null ? r.livres : '—'}</td>
                  <td className={tdN + (r.lista_espera !== null && r.lista_espera > 0 ? ' text-orange-700' : '')}>
                    {r.lista_espera !== null ? r.lista_espera : '—'}
                  </td>
                  <td className={tdN + ' font-semibold'}>{r.taxa !== null ? `${r.taxa}%` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── LISTA DETALHADA ─────────────── */}
      {(relTipo !== 'por_alojamento' || filtroAloj) && (
        lista.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
            <p className="text-gray-500">Nenhum registro neste relatório.</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
            <table className="w-full min-w-[900px]">
              <thead><tr>
                <th className={thR}>#</th>
                <th className={thR}>Nome</th>
                <th className={thR}>Alojamento</th>
                <th className={thR}>Leito</th>
                <th className={thR}>Tipo Cama</th>
                <th className={thR}>Status</th>
                <th className={thR + ' text-center'}>🦽</th>
                <th className={thR}>Obs.</th>
              </tr></thead>
              <tbody>
                {lista.map((h, idx) => {
                  const stCfg = STATUS_HOSP_CFG[h.status] ?? STATUS_HOSP_CFG.solicitada;
                  return (
                    <tr key={h.id} className="hover:bg-gray-50 transition">
                      <td className={tdR + ' text-gray-400'}>{idx + 1}</td>
                      <td className={tdR + ' font-medium text-gray-900'}>{h.nome_inscrito}</td>
                      <td className={tdR}>{h.alojamento_nome ?? <span className="text-gray-400 italic">—</span>}</td>
                      <td className={tdR + ' font-mono text-xs font-semibold'}>{h.numero_cama ?? '—'}</td>
                      <td className={tdR}>
                        {h.tipo_cama ? (
                          <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                            h.tipo_cama === 'inferior' ? 'bg-sky-100 text-sky-700' : 'bg-gray-100 text-gray-600'
                          }`}>
                            {h.tipo_cama === 'inferior' ? '⬇ Inf.' : '⬆ Sup.'}
                          </span>
                        ) : '—'}
                      </td>
                      <td className={tdR}>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${stCfg.cls}`}>{stCfg.label}</span>
                      </td>
                      <td className={tdR + ' text-center'}>
                        {h.necessidade_especial ? (
                          <span title={h.descricao_necessidade ?? ''} className="cursor-help text-sm">🦽</span>
                        ) : '—'}
                      </td>
                      <td className={tdR + ' max-w-[220px] truncate text-xs text-gray-500'}>{h.observacoes ?? '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// SEÇÃO: PAINEL AGO
// ════════════════════════════════════════════════════════════════════════════
const PUBLICO_GRUPO: Record<string, string> = {
  presidentes:     'Pastor Presidente / Pastor Jubilado',
  jubilados:       'Pastor Presidente / Pastor Jubilado',
  masculino_geral: 'Pastor Auxiliar / Juventude',
  feminino:        'Mulheres',
  misto:           'Misto',
};

const PUBLICO_LABEL: Record<string, string> = {
  presidentes:     'Presidentes',
  jubilados:       'Jubilados',
  masculino_geral: 'Masculino (Geral)',
  feminino:        'Feminino',
  misto:           'Misto',
};

const TIPO_LEITO_LABEL: Record<string, string> = {
  beliche:    '🛏️ Beliche',
  colchonete: '🟦 Colchonete',
  rede:       '🌿 Rede',
};

// ════════════════════════════════════════════════════════════════════════════
// SEÇÃO: SETORES — OCUPAÇÃO POR ALOJAMENTO
// ════════════════════════════════════════════════════════════════════════════
function SecaoSetores({
  hospedagens,
  alojamentos,
  configuracoes,
  onSincronizar,
  sincronizando = false,
}: {
  hospedagens: Hospedagem[];
  alojamentos: Alojamento[];
  configuracoes: Record<string, unknown> | null;
  onSincronizar?: () => void;
  sincronizando?: boolean;
}) {
  const setoresConfig = useMemo(
    () => (configuracoes?.setores as SetorAgo[] | undefined) ?? [],
    [configuracoes],
  );

  // Stats por alojamento físico (tabela evento_alojamentos)
  const statsAloj = useMemo(() => {
    if (alojamentos.length === 0) return [];
    return alojamentos.map(a => {
      const todos       = hospedagens.filter(h => h.alojamento_id === a.id);
      const confirmados = todos.filter(h =>
        h.tem_leito_ocupado || ['alocada', 'confirmada', 'checkin_realizado'].includes(h.status_operacional ?? h.status)
      ).length;
      const solicitados = todos.filter(h => h.status === 'solicitada').length;
      const taxa        = a.total_vagas > 0 ? Math.round(confirmados / a.total_vagas * 100) : 0;
      const livres      = Math.max(0, a.total_vagas - confirmados);
      return { ...a, confirmados, solicitados, taxa, livres };
    }).sort((a, b) => b.confirmados - a.confirmados);
  }, [hospedagens, alojamentos]);

  // Stats por setor planejado (configuracoes_ago.setores)
  // Vincula por grupo_hospedagem === setor.grupo
  const statsSetores = useMemo(() => {
    return setoresConfig.map(s => {
      const porGrupo    = hospedagens.filter(h => h.grupo_hospedagem === s.grupo);
      const confirmados = porGrupo.filter(h =>
        h.tem_leito_ocupado || ['alocada', 'confirmada', 'checkin_realizado'].includes(h.status_operacional ?? h.status)
      ).length;
      const solicitados = porGrupo.filter(h => h.status === 'solicitada').length;
      const taxa        = s.quantidade_leitos > 0 ? Math.round(confirmados / s.quantidade_leitos * 100) : 0;
      const livres      = Math.max(0, s.quantidade_leitos - confirmados);
      const infOcup     = porGrupo.filter(h =>
        (h.tem_leito_ocupado || ['alocada', 'confirmada', 'checkin_realizado'].includes(h.status_operacional ?? h.status)) &&
        h.tipo_cama === 'inferior'
      ).length;
      const infLivres   = Math.max(0, s.quantidade_leitos_inferiores - infOcup);
      return { ...s, confirmados, solicitados, taxa, livres, infLivres };
    });
  }, [hospedagens, setoresConfig]);

  // Usar setores planejados quando não há alojamentos físicos cadastrados
  const usarSetoresPlanejados = alojamentos.length === 0 && setoresConfig.length > 0;

  const totalCapacidade = usarSetoresPlanejados
    ? setoresConfig.filter(s => s.ativo).reduce((sum, s) => sum + s.quantidade_leitos, 0)
    : alojamentos.filter(a => a.ativo).reduce((sum, a) => sum + a.total_vagas, 0);

  const setoresAtivos = usarSetoresPlanejados
    ? setoresConfig.filter(s => s.ativo).length
    : alojamentos.filter(a => a.ativo).length;

  const totalOcupados = hospedagens.filter(h =>
    h.tem_leito_ocupado || ['alocada', 'confirmada', 'checkin_realizado'].includes(h.status_operacional ?? h.status)
  ).length;
  const totalLivres   = Math.max(0, totalCapacidade - totalOcupados);
  const taxaGlobal    = totalCapacidade > 0 ? Math.round(totalOcupados / totalCapacidade * 100) : 0;

  const thS  = 'text-left text-xs font-semibold text-gray-500 uppercase tracking-wide py-2.5 px-3 bg-gray-50 whitespace-nowrap';
  const tdS  = 'py-2.5 px-3 text-sm text-gray-700 border-t border-gray-50 whitespace-nowrap';
  const tdSn = `${tdS} text-right tabular-nums`;

  return (
    <div className="space-y-5">

      {/* Aviso quando usando setores planejados */}
      {usarSetoresPlanejados && (
        <div className="bg-sky-50 border border-sky-200 rounded-xl px-4 py-2.5 flex items-center justify-between gap-3 text-xs text-sky-800">
          <div className="flex items-center gap-2">
            <span>{sincronizando ? '⏳' : 'ℹ️'}</span>
            <span>
              {sincronizando
                ? 'Sincronizando setores planejados com alojamentos…'
                : <>Capacidade calculada a partir dos <strong>setores planejados</strong>. Sincronize para criar os alojamentos físicos.</>
              }
            </span>
          </div>
          {onSincronizar && !sincronizando && (
            <button
              onClick={onSincronizar}
              className="shrink-0 bg-sky-600 text-white font-medium px-3 py-1.5 rounded-lg hover:bg-sky-700 transition"
            >
              🔄 Sincronizar
            </button>
          )}
        </div>
      )}

      {/* Cards de resumo */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: 'Setores Ativos', value: setoresAtivos,            cor: 'text-[#123b63]' },
          { label: 'Cap. Total',     value: totalCapacidade,          cor: 'text-[#123b63]' },
          { label: 'Ocupados',       value: totalOcupados,            cor: 'text-rose-600' },
          { label: 'Livres',         value: totalLivres,              cor: totalLivres === 0 ? 'text-red-600' : 'text-emerald-600' },
          { label: 'Taxa',           value: `${taxaGlobal}%`,         cor: taxaGlobal >= 90 ? 'text-red-600' : taxaGlobal >= 70 ? 'text-yellow-600' : 'text-teal-600' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 text-center">
            <p className={`text-2xl font-black ${s.cor}`}>{s.value}</p>
            <p className="text-[10px] text-gray-400 mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Tabela: alojamentos físicos (quando existem na DB) */}
      {!usarSetoresPlanejados && alojamentos.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
          <table className="w-full min-w-[720px]">
            <thead>
              <tr>
                <th className={thS}>Setor / Alojamento</th>
                <th className={thS}>Grupo</th>
                <th className={thS + ' text-right'}>Capacidade</th>
                <th className={thS + ' text-right'}>Ocupados</th>
                <th className={thS + ' text-right'}>Livres</th>
                <th className={thS + ' text-right'}>Pendentes</th>
                <th className={thS}>Ocupação</th>
              </tr>
            </thead>
            <tbody>
              {statsAloj.map(a => {
                const corBar  = a.taxa >= 90 ? 'bg-red-500' : a.taxa >= 70 ? 'bg-yellow-500' : 'bg-emerald-500';
                const corText = a.taxa >= 90 ? 'text-red-600' : a.taxa >= 70 ? 'text-yellow-600' : 'text-emerald-600';
                return (
                  <tr key={a.id} className={`border-t border-gray-50 hover:bg-gray-50 transition ${!a.ativo ? 'opacity-50' : ''}`}>
                    <td className={tdS + ' font-medium text-gray-900'}>
                      {a.nome}
                      {!a.ativo && <span className="ml-2 text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">Inativo</span>}
                    </td>
                    <td className={tdS + ' text-xs text-gray-500'}>{PUBLICO_LABEL[a.publico] ?? a.publico}</td>
                    <td className={tdSn}>{a.total_vagas}</td>
                    <td className={tdSn + ' text-rose-700 font-semibold'}>{a.confirmados}</td>
                    <td className={tdSn + (a.livres === 0 ? ' text-gray-400' : ' text-emerald-700 font-semibold')}>{a.livres}</td>
                    <td className={tdSn + ' text-yellow-700'}>{a.solicitados}</td>
                    <td className={tdS}>
                      <div className="flex items-center gap-2 min-w-[130px]">
                        <div className="flex-1 bg-gray-100 rounded-full h-2">
                          <div className={`h-2 rounded-full transition-all ${corBar}`} style={{ width: `${Math.min(100, a.taxa)}%` }} />
                        </div>
                        <span className={`text-xs font-bold tabular-nums ${corText}`}>{a.taxa}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Tabela: setores planejados (quando não há alojamentos físicos) */}
      {usarSetoresPlanejados && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
          <table className="w-full min-w-[780px]">
            <thead>
              <tr>
                <th className={thS}>Setor Planejado</th>
                <th className={thS}>Grupo Permitido</th>
                <th className={thS + ' text-right'}>Capacidade</th>
                <th className={thS + ' text-right'}>⬇ Inf. Livres</th>
                <th className={thS + ' text-right'}>Ocupados</th>
                <th className={thS + ' text-right'}>Livres</th>
                <th className={thS + ' text-right'}>Pendentes</th>
                <th className={thS}>Tipos de Leito</th>
                <th className={thS}>Ocupação</th>
              </tr>
            </thead>
            <tbody>
              {statsSetores.map(s => {
                const corBar  = s.taxa >= 90 ? 'bg-red-500' : s.taxa >= 70 ? 'bg-yellow-500' : 'bg-emerald-500';
                const corText = s.taxa >= 90 ? 'text-red-600' : s.taxa >= 70 ? 'text-yellow-600' : 'text-emerald-600';
                return (
                  <tr key={s.id} className={`border-t border-gray-50 hover:bg-gray-50 transition ${!s.ativo ? 'opacity-50' : ''}`}>
                    <td className={tdS + ' font-medium text-gray-900'}>
                      {s.nome}
                      {!s.ativo && <span className="ml-2 text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">Inativo</span>}
                    </td>
                    <td className={tdS + ' text-xs text-gray-500 max-w-[160px] truncate'}>{s.grupo}</td>
                    <td className={tdSn}>{s.quantidade_leitos}</td>
                    <td className={tdSn + ' text-sky-700'}>{s.infLivres}</td>
                    <td className={tdSn + ' text-rose-700 font-semibold'}>{s.confirmados}</td>
                    <td className={tdSn + (s.livres === 0 ? ' text-gray-400' : ' text-emerald-700 font-semibold')}>{s.livres}</td>
                    <td className={tdSn + ' text-yellow-700'}>{s.solicitados}</td>
                    <td className={tdS}>
                      <div className="flex gap-1 flex-wrap">
                        {s.tipos_leito.map(t => (
                          <span key={t} className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full whitespace-nowrap">
                            {TIPO_LEITO_LABEL[t] ?? t}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className={tdS}>
                      <div className="flex items-center gap-2 min-w-[110px]">
                        <div className="flex-1 bg-gray-100 rounded-full h-2">
                          <div className={`h-2 rounded-full transition-all ${corBar}`} style={{ width: `${Math.min(100, s.taxa)}%` }} />
                        </div>
                        <span className={`text-xs font-bold tabular-nums ${corText}`}>{s.taxa}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Setores planejados como painel secundário (quando já há alojamentos físicos) */}
      {!usarSetoresPlanejados && setoresConfig.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <h3 className="font-bold text-[#123b63] text-sm mb-3">
            📋 Setores Planejados
            <span className="ml-2 text-xs text-gray-400 font-normal">
              (configuração AGO · {setoresConfig.filter(s => s.ativo).length} ativo(s))
            </span>
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {setoresConfig.map(s => (
              <div key={s.id} className={`bg-gray-50 rounded-lg p-3 ${!s.ativo ? 'opacity-50' : ''}`}>
                <div className="flex items-center justify-between mb-1">
                  <h4 className="font-semibold text-sm text-gray-900">{s.nome}</h4>
                  <span className="text-xs text-gray-500 tabular-nums">{s.quantidade_leitos} leitos</span>
                </div>
                <p className="text-xs text-gray-500">{s.grupo} · ⬇ {s.quantidade_leitos_inferiores} inf.</p>
                <div className="flex gap-1 mt-1.5 flex-wrap">
                  {s.tipos_leito.map(t => (
                    <span key={t} className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full">
                      {TIPO_LEITO_LABEL[t] ?? t}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sem dados */}
      {!usarSetoresPlanejados && alojamentos.length === 0 && setoresConfig.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <span className="text-4xl mb-3 block">🏗️</span>
          <p className="text-gray-500 font-medium">Nenhum setor configurado</p>
          <p className="text-xs text-gray-400 mt-1">
            Configure os setores em <strong>Configurações do Evento → AGO → Setores de Hospedagem</strong>.
          </p>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// SEÇÃO: PAINEL AGO
// ════════════════════════════════════════════════════════════════════════════
function SecaoPainelAgo({
  hospedagens,
  alojamentos,
  configuracoes,
  exportarCSV,
}: {
  hospedagens: Hospedagem[];
  alojamentos: Alojamento[];
  configuracoes: Record<string, unknown> | null;
  exportarCSV: (lista: Hospedagem[], nome: string) => void;
}) {
  // Mapear alojamento_id → publico
  const alojMap = useMemo(() => {
    const m = new Map<string, Alojamento>();
    alojamentos.forEach(a => m.set(a.id, a));
    return m;
  }, [alojamentos]);

  // Extrair dados de configuração AGO
  const grupos = useMemo(() => {
    return (configuracoes?.grupos as string[] | undefined) ?? [
      'Pastor Presidente / Pastor Jubilado',
      'Pastor Auxiliar / Juventude',
      'Mulheres',
    ];
  }, [configuracoes]);

  const setores = useMemo(() => {
    return (configuracoes?.setores as SetorAgo[] | undefined) ?? [];
  }, [configuracoes]);

  // Estatísticas por grupo
  const statsPorGrupo = useMemo(() => {
    const map = new Map<string, {
      totalVagas: number;
      ocupadas: number;
      disponiveis: number;
      listaEspera: number;
      pagaAlocada: number;
      pagaListaEspera: number;
      solicitadaSemPagamento: number;
      total: number;
    }>();

    grupos.forEach(g => map.set(g, {
      totalVagas: 0,
      ocupadas: 0,
      disponiveis: 0,
      listaEspera: 0,
      pagaAlocada: 0,
      pagaListaEspera: 0,
      solicitadaSemPagamento: 0,
      total: 0,
    }));
    map.set('Sem grupo', {
      totalVagas: 0,
      ocupadas: 0,
      disponiveis: 0,
      listaEspera: 0,
      pagaAlocada: 0,
      pagaListaEspera: 0,
      solicitadaSemPagamento: 0,
      total: 0,
    });

    // 1. Calcular totalVagas por grupo
    alojamentos.forEach(a => {
      if (a.ativo) {
        const gp = PUBLICO_GRUPO[a.publico] ?? 'Misto';
        const cur = map.get(gp) ?? map.get('Sem grupo')!;
        cur.totalVagas += (a.total_vagas ?? 0);
      }
    });

    // 2. Acumular estatísticas dos inscritos
    hospedagens.forEach(h => {
      const aloj = h.alojamento_id ? alojMap.get(h.alojamento_id) : null;
      const grupo = aloj 
        ? (PUBLICO_GRUPO[aloj.publico] ?? h.grupo_hospedagem ?? 'Sem grupo') 
        : (h.grupo_hospedagem ?? 'Sem grupo');
      
      const cur = map.get(grupo) ?? map.get('Sem grupo')!;
      cur.total++;

      const isOcupada = ['alocada', 'confirmada', 'checkin_realizado'].includes(h.status);
      const isPagoConfirmado = h.status_pagamento === 'pago' || h.status_pagamento === 'isento';

      if (isOcupada) {
        cur.ocupadas++;
      }
      if (h.status === 'lista_espera') {
        cur.listaEspera++;
      }
      if (isPagoConfirmado && isOcupada) {
        cur.pagaAlocada++;
      }
      if (isPagoConfirmado && h.status === 'lista_espera') {
        cur.pagaListaEspera++;
      }
      if (!isPagoConfirmado) {
        cur.solicitadaSemPagamento++;
      }
    });

    // 3. Calcular vagas disponíveis
    map.forEach((val) => {
      val.disponiveis = Math.max(0, val.totalVagas - val.ocupadas);
    });

    return map;
  }, [hospedagens, alojMap, alojamentos, grupos]);

  // Estatísticas por alojamento com tipo público
  const statsAloj = useMemo(() => {
    return alojamentos.map(a => {
      const inscritos = hospedagens.filter(h => h.alojamento_id === a.id);
      return {
        ...a,
        inscritos: inscritos.length,
        confirmados: inscritos.filter(h => h.status === 'confirmada').length,
        nec_especial: inscritos.filter(h => h.necessidade_especial).length,
        cama_inf: inscritos.filter(h => h.cama_inferior).length,
      };
    }).sort((a, b) => b.inscritos - a.inscritos);
  }, [hospedagens, alojamentos]);

  // Preferências gerais
  const prefStats = useMemo(() => ({
    total:       hospedagens.length,
    confirmados: hospedagens.filter(h => h.status === 'confirmada').length,
    necEsp:      hospedagens.filter(h => h.necessidade_especial).length,
    camaInf:     hospedagens.filter(h => h.cama_inferior).length,
    listaEspera: hospedagens.filter(h => h.status === 'lista_espera').length,
    semAloj:     hospedagens.filter(h => !h.alojamento_id).length,
  }), [hospedagens]);

  // Estatísticas por categoria de inscrição (Fase 6)
  const statsPorCategoria = useMemo(() => {
    const cats: Record<string, { hospedados: number; confirmados: number }> = {
      'Pastor Presidente': { hospedados: 0, confirmados: 0 },
      'Pastor Jubilado':   { hospedados: 0, confirmados: 0 },
      'Pastor Auxiliar':   { hospedados: 0, confirmados: 0 },
      'Feminino':          { hospedados: 0, confirmados: 0 },
      'Outros':            { hospedados: 0, confirmados: 0 },
    };
    const catFn = (h: Hospedagem): string => {
      const t = (h.tipo_inscricao ?? '').toLowerCase();
      const isEspViu = /esposa|vi[uú]va/i.test(t);
      if (/pastor[- .]?pres/i.test(t) && !isEspViu) return 'Pastor Presidente';
      if (/jubilad/i.test(t))                        return 'Pastor Jubilado';
      if (/auxiliar/i.test(t) && !isEspViu)          return 'Pastor Auxiliar';
      if (h.sexo === 'F')                             return 'Feminino';
      return 'Outros';
    };
    hospedagens.forEach(h => {
      const cat = catFn(h);
      cats[cat].hospedados++;
      if (h.status === 'confirmada') cats[cat].confirmados++;
    });
    return cats;
  }, [hospedagens]);

  // Total de vagas por setor (capacity planejada)
  const totalVagasSetores = setores.filter(s => s.ativo).reduce((sum, s) => sum + s.quantidade_leitos, 0);

  const thP = 'text-left text-xs font-semibold text-gray-500 uppercase tracking-wide py-2.5 px-3 bg-gray-50 whitespace-nowrap';
  const tdP = 'py-2.5 px-3 text-sm text-gray-700 border-t border-gray-50 whitespace-nowrap';
  const tdPn = `${tdP} text-right tabular-nums`;

  return (
    <div className="space-y-6">

      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-black text-[#123b63]">🎯 Painel de Controle — AGO</h2>
          <p className="text-xs text-gray-400 mt-0.5">Visão consolidada do sistema de hospedagem da Assembleia Geral Ordinária</p>
        </div>
        <button
          onClick={() => exportarCSV(hospedagens, 'ago_completo')}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-gray-200 text-xs font-semibold text-gray-700 hover:bg-gray-50 transition">
          📥 Exportar tudo (CSV)
        </button>
      </div>

      {/* ── KPIs gerais ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: 'Total inscritos', value: prefStats.total,        cor: 'text-[#123b63]', bg: 'from-blue-50' },
          { label: 'Confirmados',     value: prefStats.confirmados,  cor: 'text-emerald-700', bg: 'from-emerald-50' },
          { label: 'Lista espera',    value: prefStats.listaEspera,  cor: 'text-orange-600',  bg: 'from-orange-50' },
          { label: 'Sem alojamento',  value: prefStats.semAloj,      cor: 'text-red-600',     bg: 'from-red-50' },
          { label: 'Nec. Especial',   value: prefStats.necEsp,       cor: 'text-purple-600',  bg: 'from-purple-50' },
          { label: 'Cama inferior',   value: prefStats.camaInf,      cor: 'text-sky-600',     bg: 'from-sky-50' },
        ].map(s => (
          <div key={s.label} className={`bg-gradient-to-b ${s.bg} to-white rounded-xl border border-gray-100 shadow-sm p-4 text-center`}>
            <p className={`text-2xl font-black ${s.cor}`}>{s.value}</p>
            <p className="text-[10px] text-gray-500 mt-1 leading-tight">{s.label}</p>
          </div>
        ))}
      </div>

      {/* ── Por Categoria de Inscrição ─────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <h3 className="font-bold text-[#123b63] text-sm mb-3">📊 Hospedados por Categoria</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {Object.entries(statsPorCategoria).map(([cat, s]) => (
            <div key={cat} className="text-center p-3 bg-gray-50 rounded-xl">
              <p className="text-xl font-black text-[#123b63]">{s.confirmados}</p>
              <p className="text-[10px] text-gray-600 font-semibold mt-0.5 leading-tight">{cat}</p>
              <p className="text-[9px] text-gray-400">{s.hospedados} solicit.</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Resumo por Grupo de Alocação ────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h3 className="font-bold text-[#123b63] text-sm">👥 Resumo por Grupo de Alocação</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px]">
            <thead><tr>
              <th className={thP}>Grupo</th>
              <th className={thP + ' text-right'}>Vagas Totais</th>
              <th className={thP + ' text-right'}>Ocupadas (Leitos)</th>
              <th className={thP + ' text-right'}>Disponíveis</th>
              <th className={thP + ' text-right'}>Lista de Espera</th>
              <th className={thP + ' text-right'}>Paga Alocada</th>
              <th className={thP + ' text-right'}>Paga Lista Espera</th>
              <th className={thP + ' text-right'}>Sol. Sem Pagto</th>
              <th className={thP + ' text-right'}>Total Solicit.</th>
              <th className={thP + ' text-right'}>Ações</th>
            </tr></thead>
            <tbody>
              {grupos.map(g => {
                const s = statsPorGrupo.get(g) ?? {
                  totalVagas: 0,
                  ocupadas: 0,
                  disponiveis: 0,
                  listaEspera: 0,
                  pagaAlocada: 0,
                  pagaListaEspera: 0,
                  solicitadaSemPagamento: 0,
                  total: 0,
                };
                const listaGrupo = hospedagens.filter(h => {
                  const aloj = h.alojamento_id ? alojMap.get(h.alojamento_id) : null;
                  return aloj 
                    ? (PUBLICO_GRUPO[aloj.publico] === g || h.grupo_hospedagem === g) 
                    : h.grupo_hospedagem === g;
                });
                return (
                  <tr key={g} className="hover:bg-gray-50 transition">
                    <td className={tdP + ' font-semibold text-gray-900'}>{g}</td>
                    <td className={tdPn}>{s.totalVagas}</td>
                    <td className={tdPn + ' text-indigo-700 font-semibold'}>{s.ocupadas}</td>
                    <td className={tdPn + (s.disponiveis === 0 ? ' text-red-600 font-bold' : ' text-teal-700')}>{s.disponiveis}</td>
                    <td className={tdPn + ' text-orange-600'}>{s.listaEspera}</td>
                    <td className={tdPn + ' text-emerald-700 font-semibold'}>{s.pagaAlocada}</td>
                    <td className={tdPn + ' text-amber-600 font-semibold'}>{s.pagaListaEspera}</td>
                    <td className={tdPn + ' text-yellow-600'}>{s.solicitadaSemPagamento}</td>
                    <td className={tdPn + ' font-bold text-[#123b63]'}>{s.total}</td>
                    <td className={tdPn}>
                      {listaGrupo.length > 0 && (
                        <button
                          onClick={() => exportarCSV(listaGrupo, `grupo_${g.replace(/\//g, '_').replace(/\s+/g, '_').toLowerCase()}`)}
                          className="text-xs px-2 py-1 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition">
                          📥 CSV
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {(statsPorGrupo.get('Sem grupo')?.total ?? 0) > 0 && (() => {
                const s = statsPorGrupo.get('Sem grupo')!;
                return (
                  <tr className="hover:bg-gray-50 transition bg-gray-50/50">
                    <td className={tdP + ' text-gray-400 italic'}>Sem alojamento definido</td>
                    <td className={tdPn + ' text-gray-400'}>{s.totalVagas}</td>
                    <td className={tdPn + ' text-gray-400'}>{s.ocupadas}</td>
                    <td className={tdPn + ' text-gray-400'}>{s.disponiveis}</td>
                    <td className={tdPn + ' text-gray-400'}>{s.listaEspera}</td>
                    <td className={tdPn + ' text-gray-400'}>{s.pagaAlocada}</td>
                    <td className={tdPn + ' text-gray-400'}>{s.pagaListaEspera}</td>
                    <td className={tdPn + ' text-gray-400'}>{s.solicitadaSemPagamento}</td>
                    <td className={tdPn + ' text-gray-400 font-semibold'}>{s.total}</td>
                    <td className={tdPn}></td>
                  </tr>
                );
              })()}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Setores Configurados ────────────────────────────────── */}
      {setores.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
            <h3 className="font-bold text-[#123b63] text-sm">🏠 Setores de Hospedagem Configurados</h3>
            <span className="text-xs text-gray-400">{setores.filter(s => s.ativo).length} ativo(s) · {totalVagasSetores} vagas planejadas</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-5">
            {setores.map(setor => (
              <div key={setor.id} className={`rounded-xl border p-4 ${setor.ativo ? 'border-gray-200 bg-white' : 'border-gray-100 bg-gray-50 opacity-60'}`}>
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <h4 className="font-bold text-gray-900 text-sm">{setor.nome}</h4>
                    <p className="text-xs text-gray-500 mt-0.5">{setor.grupo}</p>
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${setor.ativo ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                    {setor.ativo ? 'Ativo' : 'Inativo'}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1 mb-2">
                  {setor.tipos_leito.map(t => (
                    <span key={t} className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-semibold">
                      {TIPO_LEITO_LABEL[t] ?? t}
                    </span>
                  ))}
                </div>
                <div className="flex gap-4 text-xs text-gray-500">
                  <span><strong className="text-gray-800">{setor.quantidade_leitos}</strong> leitos</span>
                  {setor.tipos_leito.includes('beliche') && (
                    <span><strong className="text-sky-700">{setor.quantidade_leitos_inferiores}</strong> inf.</span>
                  )}
                </div>
                {setor.observacoes && (
                  <p className="mt-2 text-[10px] text-gray-400 italic">{setor.observacoes}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Alojamentos — Ocupação Detalhada ───────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h3 className="font-bold text-[#123b63] text-sm">📊 Alojamentos — Ocupação</h3>
        </div>
        {statsAloj.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">Nenhum alojamento cadastrado ainda.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px]">
              <thead><tr>
                <th className={thP}>Alojamento</th>
                <th className={thP}>Grupo</th>
                <th className={thP + ' text-right'}>Vagas</th>
                <th className={thP + ' text-right'}>Confirmados</th>
                <th className={thP + ' text-right'}>Livres</th>
                <th className={thP + ' text-right'}>Nec. Esp.</th>
                <th className={thP + ' text-right'}>Inf.</th>
                <th className={thP}>Ocupação</th>
              </tr></thead>
              <tbody>
                {statsAloj.map(a => {
                  const pct = a.total_vagas > 0 ? Math.round((a.confirmados / a.total_vagas) * 100) : 0;
                  const cor = pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-orange-500' : 'bg-emerald-500';
                  return (
                    <tr key={a.id} className={`hover:bg-gray-50 transition ${!a.ativo ? 'opacity-50' : ''}`}>
                      <td className={tdP + ' font-medium text-gray-900'}>
                        {a.nome}
                        {!a.ativo && <span className="ml-1 text-[10px] text-gray-400">(inativo)</span>}
                      </td>
                      <td className={tdP + ' text-xs text-gray-500'}>{PUBLICO_LABEL[a.publico] ?? a.publico}</td>
                      <td className={tdPn}>{a.total_vagas}</td>
                      <td className={tdPn + ' text-emerald-700 font-semibold'}>{a.confirmados}</td>
                      <td className={tdPn + (( a.vagas_livres ?? 0) === 0 ? ' text-red-600 font-bold' : ' text-teal-700')}>{a.vagas_livres ?? '—'}</td>
                      <td className={tdPn + ' text-purple-600'}>{a.nec_especial || '—'}</td>
                      <td className={tdPn + ' text-sky-600'}>{a.cama_inf || '—'}</td>
                      <td className={tdP}>
                        <div className="flex items-center gap-2 min-w-[120px]">
                          <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full ${cor}`} style={{ width: `${Math.min(100, pct)}%` }} />
                          </div>
                          <span className={`text-xs font-semibold tabular-nums ${pct >= 100 ? 'text-red-600' : 'text-gray-600'}`}>{pct}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Relatórios Rápidos ──────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <h3 className="font-bold text-[#123b63] text-sm mb-4">📥 Relatórios Rápidos</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {[
            { label: 'Todos os inscritos',      lista: hospedagens, nome: 'ago_geral' },
            { label: 'Confirmados',              lista: hospedagens.filter(h => h.status === 'confirmada'), nome: 'ago_confirmados' },
            { label: 'Lista de espera',          lista: hospedagens.filter(h => h.status === 'lista_espera'), nome: 'ago_lista_espera' },
            { label: 'Sem alojamento',           lista: hospedagens.filter(h => !h.alojamento_id), nome: 'ago_sem_alojamento' },
            { label: 'Necessidade especial',     lista: hospedagens.filter(h => h.necessidade_especial), nome: 'ago_nec_especial' },
            { label: 'Sol. cama inferior',       lista: hospedagens.filter(h => h.cama_inferior), nome: 'ago_cama_inferior' },
            { label: 'Masculino',                lista: hospedagens.filter(h => h.sexo === 'M'), nome: 'ago_masculino' },
            { label: 'Feminino',                 lista: hospedagens.filter(h => h.sexo === 'F'), nome: 'ago_feminino' },
          ].map(rel => (
            <button
              key={rel.nome}
              disabled={rel.lista.length === 0}
              onClick={() => exportarCSV(rel.lista, rel.nome)}
              className="flex items-center justify-between gap-2 px-4 py-3 rounded-xl border border-gray-200 text-xs font-semibold text-gray-700 hover:bg-gray-50 transition disabled:opacity-40 disabled:cursor-not-allowed text-left">
              <span>{rel.label}</span>
              <span className="ml-auto bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full text-[10px] tabular-nums font-bold">{rel.lista.length}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Preferências — Hospedagens sem Alocação ─────────────── */}
      {prefStats.semAloj > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
          <h3 className="font-bold text-amber-800 text-sm mb-3">⚠️ {prefStats.semAloj} Inscrito(s) Sem Alojamento Definido</h3>
          <div className="overflow-x-auto max-h-64">
            <table className="w-full min-w-[520px] text-sm">
              <thead><tr>
                <th className="text-left text-xs font-semibold text-amber-700 uppercase tracking-wide py-2 px-3 bg-amber-100/60">Nome</th>
                <th className="text-left text-xs font-semibold text-amber-700 uppercase tracking-wide py-2 px-3 bg-amber-100/60">Status</th>
                <th className="text-left text-xs font-semibold text-amber-700 uppercase tracking-wide py-2 px-3 bg-amber-100/60">Sexo</th>
                <th className="text-left text-xs font-semibold text-amber-700 uppercase tracking-wide py-2 px-3 bg-amber-100/60">Prioridade</th>
              </tr></thead>
              <tbody>
                {hospedagens
                  .filter(h => !h.alojamento_id)
                  .sort((a, b) => b.prioridade - a.prioridade)
                  .map(h => {
                    const stCfg = STATUS_HOSP_CFG[h.status] ?? STATUS_HOSP_CFG.solicitada;
                    return (
                      <tr key={h.id} className="border-t border-amber-100 hover:bg-amber-50/50">
                        <td className="py-2 px-3 font-medium text-gray-900">{h.nome_inscrito ?? '—'}</td>
                        <td className="py-2 px-3">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${stCfg.cls}`}>{stCfg.label}</span>
                        </td>
                        <td className="py-2 px-3 text-gray-600">{h.sexo === 'M' ? '👨 M' : h.sexo === 'F' ? '👩 F' : '—'}</td>
                        <td className="py-2 px-3 font-mono text-xs text-gray-500">{h.prioridade}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      )}

    </div>
  );
}
