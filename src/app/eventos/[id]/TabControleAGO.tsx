'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';

// ─── Tipos ───────────────────────────────────────────────────────────────────
interface Cards {
  inscritos: number; pagos: number; credenciados: number; hospedados: number;
  presentes_hoje: number; frequencia_media: number | null;
  refeicoes_consumidas: number; refeicoes_total: number;
  advertencias_pendentes: number;
}
interface Integridade {
  percentual: number; status: 'ok' | 'atencao' | 'critico';
  sem_cpf: number; sem_categoria: number; total_problemas: number; atingiu_meta: boolean;
}
interface MatrizRow {
  id: string; nome: string; cpf: string | null; categoria: string | null;
  supervisao_id: string | null; campo_id: string | null;
  supervisao_nome: string | null; campo_nome: string | null;
  pago: boolean; status_pagamento: string; credenciado: boolean;
  hospedagem_status: string;
  refeicoes_utilizadas: number; refeicoes_total: number;
  presencas_plenaria: number; total_plenarias: number;
  percentual_frequencia: number | null;
}
interface CatRow  { categoria: string; inscritos: number; credenciados: number; presentes: number; frequencia_media: number | null; }
interface SupRow  { id: string; nome: string; inscritos: number; credenciados: number; presentes: number; frequencia_media: number | null; }
interface CampoRow{ id: string; nome: string; supervisao_nome: string; inscritos: number; hospedados: number; pastor_presidente: string | null; frequencia_media: number | null; }
interface HospStat{ capacidade_total: number; solicitados: number; confirmados: number; checkin_realizado: number; checkout_realizado: number; ausentes: number; lista_espera: number; }
interface PlenariaRow { data: string; label: string; presentes: number; total: number; }
interface RefeitorioRow { data: string; total: number; }
interface AlimentacaoIndicadores { total_inscritos_com_alimentacao: number; refeicoes_previstas: number; refeicoes_consumidas: number; saldo_restante: number; }
interface ConsumoCategoriaRow { categoria: string; consumidas: number; }
interface AlimentacaoTabelaRow {
  inscricao_id: string;
  nome: string;
  categoria: string;
  inclui_alimentacao: boolean;
  total_refeicoes: number;
  consumidas: number;
  saldo: number;
  ultimo_consumo: string | null;
}
interface RelatorioAlimentacao {
  indicadores: AlimentacaoIndicadores;
  consumo_por_dia: RefeitorioRow[];
  consumo_por_categoria: ConsumoCategoriaRow[];
  tabela: AlimentacaoTabelaRow[];
}
interface AdvertStat   { total: number; rascunho: number; enviadas: number; canceladas: number; }
interface AdvertEleg   { id: string; nome: string; categoria: string | null; supervisao_nome: string | null; campo_nome: string | null; presencas: number; total_plenarias: number; percentual: number; }
interface CampoMiss    { total: number; subsidiados: number; economia_total: number; }
interface DashData {
  evento_id: string; gerado_em: string;
  evento: { nome: string; status: string; data_inicio: string; data_fim: string; plenarias_datas: string[] };
  cards: Cards;
  integridade: Integridade;
  matriz: MatrizRow[];
  por_categoria: CatRow[];
  por_supervisao: SupRow[];
  por_campo: CampoRow[];
  hospedagem: HospStat;
  refeitorio_por_dia: RefeitorioRow[];
  frequencia_por_plenaria: PlenariaRow[];
  advertencias: AdvertStat;
  advertencias_elegiveis: AdvertEleg[];
  campo_missionario: CampoMiss;
  relatorio_alimentacao: RelatorioAlimentacao;
}

export interface OficialMinistro {
  ministro_id: string;
  nome: string;
  cpf: string | null;
  matricula: string | null;
  cargo_ministerial: string | null;
  esta_inscrito: boolean;
  inscricao_id: string | null;
  possui_checkin_plenaria: boolean;
  dias_presentes: number;
  dias_ausentes: number;
  percentual_presenca: number | null;
  status_frequencia: 'REGULAR' | 'CINQUENTA_POR_CENTO' | 'FALTOSO' | 'INSCRITO_SEM_CHECKIN' | 'NAO_INSCRITO';
  dias_detalhes: Array<{ dia: number; data: string; presente: boolean }>;
}

export interface OficialPreviewResponse {
  evento_id: string;
  total_ministros: number;
  plenarias_datas: string[];
  ministros: OficialMinistro[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
const fmtPct  = (v: number | null) => v === null ? '—' : `${v.toFixed(1)}%`;
const fmtNum  = (v: number) => v.toLocaleString('pt-BR');
const fmtDate = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
const fmtDT   = (d: string) => new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

const HOSP_LABEL: Record<string, string> = {
  confirmada: '✔ Confirmada', alocada: '✔ Alocada',
  checkin_realizado: '🏠 Check-in', checkout_realizado: '🚪 Checkout',
  solicitada: '⏳ Solicitada', lista_espera: '⏳ Espera',
  nao: '—', cancelada: '✖',
};

function FreqBar({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-gray-400 text-[10px]">—</span>;
  const cor = pct >= 75 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-400' : 'bg-red-500';
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-16 h-1.5 bg-gray-200 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${cor}`} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <span className={`text-[10px] font-bold ${pct >= 75 ? 'text-emerald-700' : pct >= 50 ? 'text-amber-600' : 'text-red-600'}`}>
        {fmtPct(pct)}
      </span>
    </div>
  );
}

function SecaoTitle({ icon, title, count }: { icon: string; title: string; count?: number }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <span className="text-lg">{icon}</span>
      <h3 className="font-black text-[#0D2B4E] text-sm">{title}</h3>
      {count !== undefined && (
        <span className="ml-auto text-xs bg-[#0D2B4E]/10 text-[#0D2B4E] px-2 py-0.5 rounded-full font-semibold">
          {fmtNum(count)}
        </span>
      )}
    </div>
  );
}

// ─── Exportação CSV ───────────────────────────────────────────────────────────
function exportCSV(rows: string[][], nomeArquivo: string) {
  const sep = ';';
  const csv = rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(sep)).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `${nomeArquivo}.csv`; a.click();
  URL.revokeObjectURL(url);
}

// ─── Componente principal ─────────────────────────────────────────────────────
export default function TabControleAGO({
  eventoId,
  podeEditar: _podeEditar,
}: {
  eventoId: string;
  podeEditar: boolean;
}) {
  const [data,       setData]       = useState<DashData | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [erro,       setErro]       = useState<string | null>(null);
  const [atualizadoEm, setAtualizadoEm] = useState<string | null>(null);

  // Frequência Oficial Ministerial States
  const [oficialData,    setOficialData]    = useState<OficialPreviewResponse | null>(null);
  const [loadingOficial, setLoadingOficial] = useState(false);
  const [erroOficial,    setErroOficial]    = useState<string | null>(null);
  const [oficialBusca,   setOficialBusca]   = useState('');
  const [oficialStatus,  setOficialStatus]  = useState('');
  const [oficialPagina,  setOficialPagina]  = useState(0);
  const [cartaRascunho,  setCartaRascunho]  = useState<OficialMinistro | null>(null);
  const [salvandoCarta,  setSalvandoCarta]  = useState(false);

  // Filtros da matriz
  const [mBusca,    setMBusca]    = useState('');
  const [mCategoria,setMCategoria]= useState('');
  const [mSup,      setMSup]      = useState('');
  const [mCampo,    setMCampo]    = useState('');
  const [mPagina,   setMPagina]   = useState(0);
  const LINHAS_PAG = 50;

  // Expansão de seções
  const [showIntegProbs, setShowIntegProbs] = useState(false);

  const carregarOficial = useCallback(async () => {
    setLoadingOficial(true);
    setErroOficial(null);
    try {
      const res = await fetch(`/api/eventos/${eventoId}/frequencia-ago/oficial-preview`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Erro ao carregar prévia oficial.');
      setOficialData(json as OficialPreviewResponse);
    } catch (e) {
      setErroOficial(e instanceof Error ? e.message : 'Erro.');
    } finally {
      setLoadingOficial(false);
    }
  }, [eventoId]);

  const carregar = useCallback(async () => {
    setLoading(true);
    setErro(null);
    try {
      const pExecutivo = fetch(`/api/eventos/${eventoId}/dashboard-executivo`).then(async res => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? 'Erro ao carregar dados.');
        setData(json as DashData);
      });
      const pOficial = carregarOficial();
      await Promise.all([pExecutivo, pOficial]);
      setAtualizadoEm(new Date().toLocaleTimeString('pt-BR'));
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro.');
    } finally {
      setLoading(false);
    }
  }, [eventoId]);

  async function handleSalvarRascunho() {
    if (!cartaRascunho) return;
    setSalvandoCarta(true);
    try {
      const textoFinal = `Prezado(a) ${cartaRascunho.cargo_ministerial || 'Ministro'} ${cartaRascunho.nome},

Constatamos em nossos registros de controle de acesso via leitor de QR Code que V. Sa. obteve o seguinte índice de comparecimento durante as plenárias da ${data?.evento?.nome ?? 'AGO'}:

Matrícula Ministerial: ${cartaRascunho.matricula || '—'}
CPF: ${cartaRascunho.cpf || '—'}
Inscrito no Evento: ${cartaRascunho.esta_inscrito ? 'Sim' : 'Não'}
Plenárias Comparecidas: ${cartaRascunho.dias_presentes}
Plenárias Ausentes: ${cartaRascunho.dias_ausentes}
Frequência Consolidada: ${cartaRascunho.percentual_presenca !== null ? `${cartaRascunho.percentual_presenca}%` : '0%'}

De acordo com os estatutos e regimentos internos que regem as plenárias e sessões deliberativas desta Convenção, a assiduidade mínima de 75% é obrigatória para a manutenção da regularidade das plenárias da AGO. A ausência sem justificativa nas sessões de plenárias implica na emissão da presente advertência.

⚠️ ORIENTAÇÕES PARA REGULARIZAÇÃO E JUSTIFICATIVA:
V. Sa. dispõe de um prazo regulamentar para protocolar a justificativa de suas ausências. O protocolo deve detalhar os motivos de força maior ou justificativas eclesiásticas para análise da Mesa Diretora.`;

      const res = await fetch(`/api/eventos/${eventoId}/ago-cartas-advertencia`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inscricao_id: cartaRascunho.inscricao_id,
          ministro_id: cartaRascunho.ministro_id,
          nome_ministro: cartaRascunho.nome,
          matricula: cartaRascunho.matricula,
          cpf: cartaRascunho.cpf,
          status_frequencia: cartaRascunho.status_frequencia,
          percentual_presenca: cartaRascunho.percentual_presenca,
          dias_presentes: cartaRascunho.dias_presentes,
          dias_ausentes: cartaRascunho.dias_ausentes,
          motivo: 'Frequência abaixo de 75% nas plenárias da AGO',
          texto_final: textoFinal,
          dias_detalhes: cartaRascunho.dias_detalhes,
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Erro ao salvar rascunho.');

      alert(json.message ?? 'Rascunho de carta salvo com sucesso!');
      setCartaRascunho(null);
      carregar(); // Recarrega os dados do dashboard para atualizar o contador de advertências
    } catch (e: any) {
      alert(`Erro: ${e.message}`);
    } finally {
      setSalvandoCarta(false);
    }
  }

  useEffect(() => { carregar(); }, [carregar]);

  // Filtros derivados para a lista oficial
  const oficialFiltrada = useMemo(() => {
    if (!oficialData) return [];
    return oficialData.ministros.filter(m => {
      if (oficialBusca) {
        const busca = oficialBusca.toLowerCase();
        const nomeMatch = String(m.nome ?? '').toLowerCase().includes(busca);
        const cpfMatch = String(m.cpf ?? '').includes(busca);
        const matMatch = String(m.matricula ?? '').includes(busca);
        if (!nomeMatch && !cpfMatch && !matMatch) return false;
      }
      if (oficialStatus && m.status_frequencia !== oficialStatus) return false;
      return true;
    });
  }, [oficialData, oficialBusca, oficialStatus]);

  const oficialPag = useMemo(() => {
    return oficialFiltrada.slice(oficialPagina * LINHAS_PAG, (oficialPagina + 1) * LINHAS_PAG);
  }, [oficialFiltrada, oficialPagina]);

  const totalPaginasOficial = Math.ceil(oficialFiltrada.length / LINHAS_PAG);

  const oficialStats = useMemo(() => {
    if (!oficialData) return { total: 0, inscritos: 0, naoInscritos: 0, comCheckin: 0, regular: 0, cinquenta: 0, faltoso: 0, semCheckin: 0 };
    let total = oficialData.total_ministros;
    let inscritos = 0;
    let comCheckin = 0;
    let regular = 0;
    let cinquenta = 0;
    let faltoso = 0;
    let semCheckin = 0;

    for (const m of oficialData.ministros) {
      if (m.esta_inscrito) {
        inscritos++;
        if (m.possui_checkin_plenaria) {
          comCheckin++;
          if (m.status_frequencia === 'REGULAR') regular++;
          else if (m.status_frequencia === 'CINQUENTA_POR_CENTO') cinquenta++;
          else if (m.status_frequencia === 'FALTOSO') faltoso++;
        } else {
          semCheckin++;
        }
      }
    }

    return {
      total,
      inscritos,
      naoInscritos: total - inscritos,
      comCheckin,
      regular,
      cinquenta,
      faltoso,
      semCheckin
    };
  }, [oficialData]);

  // Filtros derivados para a matriz
  const matrizFiltrada = useMemo(() => {
    if (!data) return [];
    return data.matriz.filter(r => {
      if (mBusca    && !r.nome.toLowerCase().includes(mBusca.toLowerCase())
                    && !(r.cpf ?? '').includes(mBusca)) return false;
      if (mCategoria && r.categoria !== mCategoria) return false;
      if (mSup      && r.supervisao_id !== mSup) return false;
      if (mCampo    && r.campo_id !== mCampo)    return false;
      return true;
    });
  }, [data, mBusca, mCategoria, mSup, mCampo]);

  const categorias    = useMemo(() => [...new Set(data?.matriz.map(r => r.categoria).filter(Boolean))].sort() as string[], [data]);
  const supervisoes   = useMemo(() => [...new Map(data?.matriz.filter(r => r.supervisao_id).map(r => [r.supervisao_id!, r.supervisao_nome ?? r.supervisao_id!])).entries()].sort((a,b)=>a[1].localeCompare(b[1])), [data]);
  const camposFiltro  = useMemo(() => [...new Map(data?.matriz.filter(r => r.campo_id && (!mSup || r.supervisao_id === mSup)).map(r => [r.campo_id!, r.campo_nome ?? r.campo_id!])).entries()].sort((a,b)=>a[1].localeCompare(b[1])), [data, mSup]);

  const totalPaginasMatriz = Math.ceil(matrizFiltrada.length / LINHAS_PAG);
  const matrizPag = matrizFiltrada.slice(mPagina * LINHAS_PAG, (mPagina + 1) * LINHAS_PAG);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-gray-500 gap-3">
        <div className="w-6 h-6 border-2 border-[#123b63] border-t-transparent rounded-full animate-spin" />
        Carregando Centro de Controle…
      </div>
    );
  }

  if (erro || !data) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-red-700 text-sm">
        ⚠️ {erro ?? 'Sem dados.'}
        <button onClick={carregar} className="ml-3 underline font-semibold">Tentar novamente</button>
      </div>
    );
  }

  const { cards, integridade, por_categoria, por_supervisao, por_campo,
          hospedagem, refeitorio_por_dia, frequencia_por_plenaria,
      advertencias: advStats, advertencias_elegiveis, campo_missionario,
      relatorio_alimentacao } = data;

  // ── render ──────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">

      {/* Cabeçalho */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-black text-[#0D2B4E]">📊 Centro de Controle AGO</h2>
          {atualizadoEm && <p className="text-xs text-gray-400 mt-0.5">Atualizado às {atualizadoEm}</p>}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              const cabecalho = ['Nome', 'CPF', 'Categoria', 'Supervisão', 'Campo', 'Pago', 'Credenciado', 'Hospedagem', 'Refeições Usadas', 'Presenças Plenária', 'Freq. %'];
              const linhas = data.matriz.map(r => [
                r.nome, r.cpf ?? '', r.categoria ?? '', r.supervisao_nome ?? '', r.campo_nome ?? '',
                r.pago ? 'Sim' : 'Não', r.credenciado ? 'Sim' : 'Não',
                r.hospedagem_status, String(r.refeicoes_utilizadas), String(r.presencas_plenaria),
                fmtPct(r.percentual_frequencia),
              ]);
              exportCSV([cabecalho, ...linhas], `dashboard-ago-${eventoId.slice(0, 8)}`);
            }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 transition"
          >
            ⬇ CSV Executivo
          </button>
          <button
            onClick={() => window.print()}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-gray-600 text-white text-xs font-bold hover:bg-gray-700 transition"
          >
            🖨️ Imprimir
          </button>
          <button
            onClick={carregar}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#123b63] text-white text-xs font-bold hover:bg-[#0f2a45] transition"
          >
            🔄 Atualizar
          </button>
        </div>
      </div>

      {/* ── Alerta: plenárias não configuradas ─────────────────────────────── */}
      {data.evento.plenarias_datas.length === 0 && (
        <div className="bg-amber-50 border border-amber-300 rounded-xl p-3 flex items-start gap-2 text-sm text-amber-800">
          <span className="text-lg shrink-0">⚠️</span>
          <div>
            <strong>Datas de plenárias não configuradas.</strong>{' '}
            Frequência média e por plenária aparecerão como &ldquo;—&rdquo;.
            Configure as datas em <strong>Configurações do Evento → AGO</strong>.
          </div>
        </div>
      )}

      {/* ── 1. CARDS EXECUTIVOS ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Inscritos',    value: fmtNum(cards.inscritos),    icon: '👥', cor: 'bg-[#0D2B4E] text-white' },
          { label: 'Pagos',        value: fmtNum(cards.pagos),        icon: '💳', cor: 'bg-emerald-600 text-white' },
          { label: 'Credenciados', value: fmtNum(cards.credenciados), icon: '✅', cor: 'bg-teal-600 text-white' },
          { label: 'Hospedados',   value: fmtNum(cards.hospedados),   icon: '🏨', cor: 'bg-sky-600 text-white' },
          { label: 'Presentes Hoje',    value: fmtNum(cards.presentes_hoje),       icon: '📍', cor: 'bg-violet-600 text-white' },
          { label: 'Freq. Média',       value: fmtPct(cards.frequencia_media),     icon: '📈', cor: 'bg-indigo-600 text-white' },
          { label: 'Refeições Consum.', value: `${fmtNum(cards.refeicoes_consumidas)} / ${fmtNum(cards.refeicoes_total)}`, icon: '🍽️', cor: 'bg-amber-600 text-white' },
          { label: 'Advertências Pend.', value: fmtNum(cards.advertencias_pendentes), icon: '⚠️', cor: cards.advertencias_pendentes > 0 ? 'bg-red-600 text-white' : 'bg-gray-500 text-white' },
        ].map(c => (
          <div key={c.label} className={`rounded-xl p-4 shadow-sm flex flex-col gap-1 ${c.cor}`}>
            <span className="text-xl leading-none">{c.icon}</span>
            <p className="text-xl font-black leading-none mt-1">{c.value}</p>
            <p className="text-[11px] opacity-80">{c.label}</p>
          </div>
        ))}
      </div>

      {/* ── 2. INTEGRIDADE ──────────────────────────────────────────────────── */}
      <div className={`rounded-xl border-2 p-4 flex items-center justify-between flex-wrap gap-3 ${
        integridade.status === 'ok'      ? 'border-emerald-300 bg-emerald-50' :
        integridade.status === 'atencao' ? 'border-amber-300 bg-amber-50'    :
                                           'border-red-300 bg-red-50'
      }`}>
        <div className="flex items-center gap-3">
          <span className="text-2xl">
            {integridade.status === 'ok' ? '🟢' : integridade.status === 'atencao' ? '🟡' : '🔴'}
          </span>
          <div>
            <p className="font-black text-sm text-gray-800">
              Integridade dos Dados: {fmtPct(integridade.percentual)}
            </p>
            <p className="text-xs text-gray-500">
              {integridade.atingiu_meta ? 'Meta ≥ 99% atingida ✓'
                : `${fmtNum(integridade.total_problemas)} problema(s) encontrado(s) — meta não atingida`}
            </p>
          </div>
        </div>
        {integridade.total_problemas > 0 && (
          <button
            onClick={() => setShowIntegProbs(p => !p)}
            className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 bg-white font-semibold hover:bg-gray-50 transition"
          >
            {showIntegProbs ? '▲ Ocultar' : '▼ Ver problemas'}
          </button>
        )}
      </div>
      {showIntegProbs && integridade.total_problemas > 0 && (
        <div className="bg-white rounded-xl border border-red-200 p-4 space-y-1 text-sm">
          {integridade.sem_cpf      > 0 && <p className="text-red-700">🔴 {fmtNum(integridade.sem_cpf)} inscrição(ões) sem CPF</p>}
          {integridade.sem_categoria> 0 && <p className="text-amber-700">🟡 {fmtNum(integridade.sem_categoria)} inscrição(ões) sem categoria</p>}
          <a href={`/api/eventos/${eventoId}/integridade`} target="_blank"
            className="inline-block mt-2 text-xs text-[#123b63] underline font-semibold">
            Ver relatório completo →
          </a>
        </div>
      )}

      {/* ── 3. FREQUÊNCIA POR PLENÁRIA ────────────────────────────────────── */}
      {frequencia_por_plenaria.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
          <SecaoTitle icon="📅" title="Frequência por Plenária" count={frequencia_por_plenaria.length} />
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
            {frequencia_por_plenaria.map(p => {
              const pct = p.total > 0 ? Math.round((p.presentes / p.total) * 100) : 0;
              return (
                <div key={p.data} className="bg-gray-50 rounded-xl p-3 text-center border border-gray-100">
                  <p className="font-black text-[#0D2B4E] text-lg">{fmtNum(p.presentes)}</p>
                  <p className="text-[10px] text-gray-500 mb-1">{p.label} · {fmtDate(p.data)}</p>
                  <div className="w-full h-1.5 bg-gray-200 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${pct >= 75 ? 'bg-emerald-500' : 'bg-amber-400'}`}
                      style={{ width: `${pct}%` }} />
                  </div>
                  <p className="text-[10px] text-gray-400 mt-0.5">{pct}%</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── 4. POR CATEGORIA ─────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
        <SecaoTitle icon="🏷️" title="Por Categoria" count={por_categoria.length} />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {por_categoria.map(c => (
            <div key={c.categoria} className="bg-gray-50 rounded-xl p-3 border border-gray-100">
              <p className="font-bold text-[#0D2B4E] text-xs mb-2 truncate">{c.categoria}</p>
              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
                <span className="text-gray-500">Inscritos</span><span className="font-semibold">{fmtNum(c.inscritos)}</span>
                <span className="text-gray-500">Credenciados</span><span className="font-semibold text-teal-700">{fmtNum(c.credenciados)}</span>
                <span className="text-gray-500">Presentes</span><span className="font-semibold text-blue-700">{fmtNum(c.presentes)}</span>
                <span className="text-gray-500">Freq. Média</span><span className="font-semibold text-violet-700">{fmtPct(c.frequencia_media)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── 5. POR SUPERVISÃO ────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
        <SecaoTitle icon="🏛️" title="Por Supervisão" count={por_supervisao.length} />
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                {['Supervisão', 'Inscritos', 'Credenciados', 'Presentes', 'Freq. Média'].map(h => (
                  <th key={h} className="px-3 py-2 text-left text-[10px] font-bold text-gray-500 uppercase">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {por_supervisao.map(s => (
                <tr key={s.id} className="border-t border-gray-50 hover:bg-gray-50/50">
                  <td className="px-3 py-2 font-semibold text-gray-800">{s.nome}</td>
                  <td className="px-3 py-2 text-[#0D2B4E] font-bold">{fmtNum(s.inscritos)}</td>
                  <td className="px-3 py-2 text-teal-700 font-semibold">{fmtNum(s.credenciados)}</td>
                  <td className="px-3 py-2 text-blue-700 font-semibold">{fmtNum(s.presentes)}</td>
                  <td className="px-3 py-2"><FreqBar pct={s.frequencia_media} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── 6. POR CAMPO ─────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-lg">⛪</span>
            <h3 className="font-black text-[#0D2B4E] text-sm">Por Campo</h3>
            <span className="ml-auto text-xs bg-[#0D2B4E]/10 text-[#0D2B4E] px-2 py-0.5 rounded-full font-semibold">
              {fmtNum(por_campo.length)}
            </span>
          </div>
          <button
            onClick={() => {
              const h = ['Campo', 'Supervisão', 'Pastor Presidente', 'Inscritos', 'Hospedados', 'Freq. Média'];
              exportCSV([h, ...por_campo.map(c => [c.nome, c.supervisao_nome, c.pastor_presidente ?? '', String(c.inscritos), String(c.hospedados), fmtPct(c.frequencia_media)])], 'por-campo');
            }}
            className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-600 hover:bg-gray-200"
          >⬇ CSV</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                {['Campo', 'Supervisão', 'Pastor Presidente', 'Inscritos', 'Hospedados', 'Freq. Média'].map(h => (
                  <th key={h} className="px-3 py-2 text-left text-[10px] font-bold text-gray-500 uppercase">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {por_campo.map(c => (
                <tr key={c.id} className="border-t border-gray-50 hover:bg-gray-50/50">
                  <td className="px-3 py-2 font-semibold text-gray-800">{c.nome}</td>
                  <td className="px-3 py-2 text-gray-500">{c.supervisao_nome}</td>
                  <td className="px-3 py-2 text-gray-600">{c.pastor_presidente ?? '—'}</td>
                  <td className="px-3 py-2 font-bold text-[#0D2B4E]">{fmtNum(c.inscritos)}</td>
                  <td className="px-3 py-2 text-sky-700 font-semibold">{fmtNum(c.hospedados)}</td>
                  <td className="px-3 py-2"><FreqBar pct={c.frequencia_media} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── 7 + 8. HOSPEDAGEM & REFEITÓRIO ──────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* Hospedagem */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
          <SecaoTitle icon="🏨" title="Hospedagem" />
          <div className="space-y-2 text-sm">
            {[
              { label: 'Capacidade total', value: fmtNum(hospedagem.capacidade_total), cor: 'text-[#0D2B4E]' },
              { label: 'Solicitados',      value: fmtNum(hospedagem.solicitados),      cor: 'text-gray-700' },
              { label: 'Confirmados',      value: fmtNum(hospedagem.confirmados),      cor: 'text-blue-700' },
              { label: 'Check-in ✓',       value: fmtNum(hospedagem.checkin_realizado), cor: 'text-teal-700' },
              { label: 'Check-out ✓',      value: fmtNum(hospedagem.checkout_realizado), cor: 'text-gray-500' },
              { label: 'Ausentes',         value: fmtNum(hospedagem.ausentes),         cor: 'text-amber-600' },
              { label: 'Lista de espera',  value: fmtNum(hospedagem.lista_espera),     cor: 'text-orange-600' },
            ].map(r => (
              <div key={r.label} className="flex justify-between border-b border-gray-50 pb-1">
                <span className="text-gray-500 text-xs">{r.label}</span>
                <span className={`font-bold text-xs ${r.cor}`}>{r.value}</span>
              </div>
            ))}
            {hospedagem.capacidade_total > 0 && (
              <div>
                <div className="flex justify-between text-xs text-gray-400 mb-1">
                  <span>Ocupação</span>
                  <span>{Math.round((hospedagem.checkin_realizado / hospedagem.capacidade_total) * 100)}%</span>
                </div>
                <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-teal-500 rounded-full"
                    style={{ width: `${Math.min(100, Math.round((hospedagem.checkin_realizado / hospedagem.capacidade_total) * 100))}%` }} />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Refeitório */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
          <SecaoTitle icon="🍽️" title="Refeitório por Dia" count={refeitorio_por_dia.length} />
          {refeitorio_por_dia.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-4">Nenhum consumo registrado.</p>
          ) : (
            <div className="space-y-2">
              {refeitorio_por_dia.map(r => {
                const pct = cards.inscritos > 0 ? Math.round((r.total / cards.inscritos) * 100) : 0;
                return (
                  <div key={r.data} className="flex items-center gap-3">
                    <span className="text-xs text-gray-500 w-20 shrink-0">{fmtDate(r.data)}</span>
                    <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-amber-400 rounded-full" style={{ width: `${Math.min(100, pct)}%` }} />
                    </div>
                    <span className="text-xs font-bold text-gray-700 w-12 text-right">{fmtNum(r.total)}</span>
                  </div>
                );
              })}
              <div className="flex justify-between text-xs text-gray-400 mt-2 pt-2 border-t border-gray-100">
                <span>Total consumido</span>
                <span className="font-semibold">{fmtNum(refeitorio_por_dia.reduce((s, r) => s + r.total, 0))}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── 8.1 RELATÓRIO DE ALIMENTAÇÃO ──────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
        <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
          <SecaoTitle icon="🥗" title="Relatório de Alimentação" count={relatorio_alimentacao.tabela.length} />
          <button
            onClick={() => {
              const h = ['Nome', 'Categoria', 'Inclui alimentação', 'Previstas', 'Consumidas', 'Saldo', 'Último consumo'];
              const linhas = relatorio_alimentacao.tabela.map(r => [
                r.nome,
                r.categoria,
                r.inclui_alimentacao ? 'Sim' : 'Não',
                String(r.total_refeicoes),
                String(r.consumidas),
                String(r.saldo),
                r.ultimo_consumo ? fmtDT(r.ultimo_consumo) : '',
              ]);
              exportCSV([h, ...linhas], `relatorio-alimentacao-${eventoId.slice(0, 8)}`);
            }}
            className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-600 hover:bg-gray-200"
          >⬇ CSV Alimentação</button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          {[
            { label: 'Com alimentação', valor: relatorio_alimentacao.indicadores.total_inscritos_com_alimentacao, cor: 'text-[#0D2B4E]' },
            { label: 'Previstas', valor: relatorio_alimentacao.indicadores.refeicoes_previstas, cor: 'text-blue-700' },
            { label: 'Consumidas', valor: relatorio_alimentacao.indicadores.refeicoes_consumidas, cor: 'text-amber-700' },
            { label: 'Saldo', valor: relatorio_alimentacao.indicadores.saldo_restante, cor: 'text-emerald-700' },
          ].map(item => (
            <div key={item.label} className="bg-gray-50 rounded-xl p-3 border border-gray-100">
              <p className={`text-lg font-black ${item.cor}`}>{fmtNum(item.valor)}</p>
              <p className="text-[10px] text-gray-400">{item.label}</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="rounded-xl border border-gray-100 p-3">
            <p className="text-xs font-semibold text-gray-600 mb-2">Consumo por Categoria</p>
            {relatorio_alimentacao.consumo_por_categoria.length === 0 ? (
              <p className="text-xs text-gray-400">Sem consumo registrado.</p>
            ) : (
              <div className="space-y-1.5">
                {relatorio_alimentacao.consumo_por_categoria.slice(0, 8).map(row => (
                  <div key={row.categoria} className="flex items-center justify-between text-xs">
                    <span className="text-gray-600 truncate pr-2">{row.categoria}</span>
                    <span className="font-bold text-amber-700">{fmtNum(row.consumidas)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-gray-100 p-3">
            <p className="text-xs font-semibold text-gray-600 mb-2">Consumo por Dia</p>
            {relatorio_alimentacao.consumo_por_dia.length === 0 ? (
              <p className="text-xs text-gray-400">Sem consumo registrado.</p>
            ) : (
              <div className="space-y-1.5">
                {relatorio_alimentacao.consumo_por_dia.map(row => (
                  <div key={row.data} className="flex items-center justify-between text-xs">
                    <span className="text-gray-600">{fmtDate(row.data)}</span>
                    <span className="font-bold text-amber-700">{fmtNum(row.total)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="overflow-x-auto mt-4">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                {['Nome', 'Categoria', 'Alimentação', 'Previstas', 'Consumidas', 'Saldo', 'Último consumo'].map(h => (
                  <th key={h} className="px-2 py-2 text-left text-[10px] font-bold text-gray-500 uppercase whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {relatorio_alimentacao.tabela.slice(0, 100).map(r => (
                <tr key={r.inscricao_id} className="border-t border-gray-50 hover:bg-gray-50/50">
                  <td className="px-2 py-1.5 font-semibold text-gray-800 max-w-[180px] truncate">{r.nome}</td>
                  <td className="px-2 py-1.5 text-gray-500">{r.categoria}</td>
                  <td className="px-2 py-1.5 text-center">{r.inclui_alimentacao ? 'Sim' : 'Não'}</td>
                  <td className="px-2 py-1.5 text-center text-blue-700 font-semibold">{fmtNum(r.total_refeicoes)}</td>
                  <td className="px-2 py-1.5 text-center text-amber-700 font-semibold">{fmtNum(r.consumidas)}</td>
                  <td className="px-2 py-1.5 text-center text-emerald-700 font-semibold">{fmtNum(r.saldo)}</td>
                  <td className="px-2 py-1.5 text-gray-500 whitespace-nowrap">{r.ultimo_consumo ? fmtDT(r.ultimo_consumo) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {relatorio_alimentacao.tabela.length > 100 && (
            <p className="text-xs text-gray-400 text-center mt-2">Mostrando 100 de {fmtNum(relatorio_alimentacao.tabela.length)} registros.</p>
          )}
        </div>
      </div>

      {/* ── 9. CAMPO MISSIONÁRIO ────────────────────────────────────────── */}
      {campo_missionario.total > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
          <SecaoTitle icon="🌍" title="Campo Missionário" count={campo_missionario.total} />
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
            {[
              { label: 'Total missionários',     value: fmtNum(campo_missionario.total),         cor: 'text-[#0D2B4E]' },
              { label: 'Inscrições subsidiadas', value: fmtNum(campo_missionario.subsidiados),    cor: 'text-emerald-700' },
              { label: 'Economia concedida',     value: `R$ ${campo_missionario.economia_total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, cor: 'text-violet-700' },
            ].map(r => (
              <div key={r.label} className="bg-gray-50 rounded-xl p-3">
                <p className={`text-lg font-black ${r.cor}`}>{r.value}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">{r.label}</p>
              </div>
            ))}
          </div>
        </div>
      )}


      {/* ── 9.5. FREQUÊNCIA OFICIAL MINISTERIAL ────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 space-y-4">
        <div className="flex items-center justify-between pb-2 border-b border-gray-100 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <span className="text-lg">📊</span>
            <h3 className="font-black text-[#0D2B4E] text-sm">Frequência Oficial Ministerial</h3>
            {loadingOficial && (
              <div className="w-4 h-4 border-2 border-[#123b63] border-t-transparent rounded-full animate-spin ml-2" />
            )}
          </div>
          {oficialData && (
            <button
              onClick={() => {
                const datas = oficialData.plenarias_datas;
                const cabecalho = [
                  'Nome', 'Matrícula', 'CPF', 'Cargo', 'Inscrito',
                  'Dias Presentes', 'Dias Ausentes', 'Percentual', 'Status',
                  ...datas.map((d, idx) => `Dia ${idx + 1} (${fmtDate(d)})`)
                ];

                const linhas = oficialFiltrada.map(m => {
                  const labelStatus = 
                    m.status_frequencia === 'REGULAR' ? 'REGULAR (>= 75%)' :
                    m.status_frequencia === 'CINQUENTA_POR_CENTO' ? 'PARCIAL (>= 50%)' :
                    m.status_frequencia === 'FALTOSO' ? 'FALTOSO (< 50%)' :
                    m.status_frequencia === 'INSCRITO_SEM_CHECKIN' ? 'INSCRITO SEM CHECK-IN' :
                    'NÃO INSCRITO';

                  return [
                    m.nome,
                    m.matricula ?? '',
                    m.cpf ?? '',
                    m.cargo_ministerial ?? '',
                    m.esta_inscrito ? 'Sim' : 'Não',
                    String(m.dias_presentes),
                    String(m.dias_ausentes),
                    m.percentual_presenca !== null ? `${m.percentual_presenca}%` : '—',
                    labelStatus,
                    ...m.dias_detalhes.map(d => d.presente ? 'Presente' : 'Ausente')
                  ];
                });

                exportCSV([cabecalho, ...linhas], `frequencia-oficial-${eventoId.slice(0, 8)}`);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 transition"
            >
              ⬇ Exportar CSV
            </button>
          )}
        </div>

        {erroOficial ? (
          <div className="text-xs text-red-600 bg-red-50 p-3 rounded-lg">⚠️ {erroOficial}</div>
        ) : !oficialData ? (
          <p className="text-xs text-gray-400 text-center py-2">Nenhum dado de frequência oficial carregado.</p>
        ) : (
          <>
            {/* Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5">
              {[
                { label: 'Min. Ativos', value: oficialStats.total, cor: 'text-gray-800' },
                { label: 'Inscritos', value: oficialStats.inscritos, cor: 'text-[#0D2B4E]' },
                { label: 'Não Inscritos', value: oficialStats.naoInscritos, cor: 'text-gray-400' },
                { label: 'Com Check-in', value: oficialStats.comCheckin, cor: 'text-teal-700' },
                { label: 'Regulares', value: oficialStats.regular, cor: 'text-green-700' },
                { label: '50% Presença', value: oficialStats.cinquenta, cor: 'text-amber-700' },
                { label: 'Sem Check-in', value: oficialStats.semCheckin, cor: 'text-red-700' },
              ].map(c => (
                <div key={c.label} className="bg-gray-50 rounded-xl p-2.5 text-center">
                  <p className="text-xs text-gray-400 font-medium truncate">{c.label}</p>
                  <p className={`text-base font-black mt-0.5 ${c.cor}`}>{fmtNum(c.value)}</p>
                </div>
              ))}
            </div>

            {/* Filtros e Busca */}
            <div className="flex flex-wrap gap-2 pt-2">
              <input
                value={oficialBusca}
                onChange={e => { setOficialBusca(e.target.value); setOficialPagina(0); }}
                placeholder="Buscar ministro por nome, CPF ou matrícula…"
                className="border border-gray-200 rounded-lg px-3 py-1.5 text-xs flex-1 min-w-40 focus:outline-none focus:ring-1 focus:ring-[#123b63]"
              />
              <select
                value={oficialStatus}
                onChange={e => { setOficialStatus(e.target.value); setOficialPagina(0); }}
                className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#123b63]"
              >
                <option value="">Todos os status</option>
                <option value="REGULAR">Regular (≥ 75%)</option>
                <option value="CINQUENTA_POR_CENTO">Parcial (≥ 50% e &lt; 75%)</option>
                <option value="FALTOSO">Faltoso (&lt; 50%)</option>
                <option value="INSCRITO_SEM_CHECKIN">Inscrito sem check-in</option>
                <option value="NAO_INSCRITO">Não Inscrito</option>
              </select>
            </div>

            {/* Tabela */}
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    {['Nome / Matrícula', 'CPF', 'Cargo', 'Inscrito', 'Presenças', 'Freq. %', 'Status', 'Ações'].map(h => (
                      <th key={h} className="px-2 py-2 text-left text-[10px] font-bold text-gray-500 uppercase whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {oficialPag.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-gray-400">Nenhum ministro localizado com os filtros selecionados.</td>
                    </tr>
                  ) : (
                    oficialPag.map(m => {
                      const badgeStatus = 
                        m.status_frequencia === 'REGULAR' ? 'bg-green-50 text-green-700 border-green-200' :
                        m.status_frequencia === 'CINQUENTA_POR_CENTO' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                        m.status_frequencia === 'FALTOSO' ? 'bg-red-50 text-red-700 border-red-200' :
                        m.status_frequencia === 'INSCRITO_SEM_CHECKIN' ? 'bg-gray-100 text-gray-700 border-gray-200' :
                        'bg-slate-50 text-slate-400 border-slate-200';

                      const labelStatus = 
                        m.status_frequencia === 'REGULAR' ? 'REGULAR (≥ 75%)' :
                        m.status_frequencia === 'CINQUENTA_POR_CENTO' ? 'PARCIAL (≥ 50%)' :
                        m.status_frequencia === 'FALTOSO' ? 'FALTOSO (< 50%)' :
                        m.status_frequencia === 'INSCRITO_SEM_CHECKIN' ? 'INSCRITO SEM CHECK-IN' :
                        'NÃO INSCRITO';

                      return (
                        <tr key={m.ministro_id} className="border-t border-gray-50 hover:bg-gray-50/50">
                          <td className="px-2 py-1.5">
                            <p className="font-semibold text-gray-800 truncate max-w-[200px]" title={m.nome}>{m.nome}</p>
                            <p className="text-[10px] text-gray-400 mt-0.5">Matrícula: {m.matricula || '—'}</p>
                          </td>
                          <td className="px-2 py-1.5 text-gray-500 whitespace-nowrap">{m.cpf || '—'}</td>
                          <td className="px-2 py-1.5 text-gray-500 whitespace-nowrap">{m.cargo_ministerial || '—'}</td>
                          <td className="px-2 py-1.5">
                            {m.esta_inscrito ? (
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">Sim</span>
                            ) : (
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-400">Não</span>
                            )}
                          </td>
                          <td className="px-2 py-1.5 text-gray-700 whitespace-nowrap">
                            {m.esta_inscrito ? `${m.dias_presentes} presenças` : '—'}
                          </td>
                          <td className="px-2 py-1.5">
                            {m.esta_inscrito && m.percentual_presenca !== null ? (
                              <FreqBar pct={m.percentual_presenca} />
                            ) : (
                              <span className="text-gray-400">—</span>
                            )}
                          </td>
                          <td className="px-2 py-1.5">
                            <span className={`text-[9px] font-extrabold px-2 py-0.5 rounded border whitespace-nowrap ${badgeStatus}`}>
                              {labelStatus}
                            </span>
                          </td>
                          <td className="px-2 py-1.5">
                            {['CINQUENTA_POR_CENTO', 'INSCRITO_SEM_CHECKIN', 'NAO_INSCRITO', 'FALTOSO'].includes(m.status_frequencia) && (
                              <button
                                onClick={() => setCartaRascunho(m)}
                                className="text-[10px] bg-slate-100 hover:bg-slate-200 text-slate-700 px-2 py-0.5 rounded font-bold transition whitespace-nowrap"
                              >
                                📄 Gerar Carta
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Paginação */}
            {totalPaginasOficial > 1 && (
              <div className="flex items-center justify-between pt-3 text-xs text-gray-500 border-t border-gray-100">
                <span>Pág. {oficialPagina + 1} de {totalPaginasOficial} ({fmtNum(oficialFiltrada.length)} registros)</span>
                <div className="flex gap-2">
                  <button onClick={() => setOficialPagina(p => Math.max(0, p - 1))} disabled={oficialPagina === 0}
                    className="px-3 py-1 rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50">← Anterior</button>
                  <button onClick={() => setOficialPagina(p => Math.min(totalPaginasOficial - 1, p + 1))} disabled={oficialPagina >= totalPaginasOficial - 1}
                    className="px-3 py-1 rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50">Próxima →</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── 10. ADVERTÊNCIAS ELEGÍVEIS ──────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-lg">⚠️</span>
          <h3 className="font-black text-[#0D2B4E] text-sm">Advertências</h3>
          <div className="ml-auto flex gap-2">
            {[
              { label: 'Rascunho', value: advStats.rascunho, cor: 'bg-amber-100 text-amber-700' },
              { label: 'Enviadas', value: advStats.enviadas,  cor: 'bg-red-100 text-red-700' },
            ].map(s => (
              <span key={s.label} className={`text-xs px-2 py-0.5 rounded-full font-bold ${s.cor}`}>
                {s.label}: {s.value}
              </span>
            ))}
          </div>
        </div>
        {advertencias_elegiveis.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-3">
            ✅ Nenhum participante elegível para advertência (presença ≥ 75%).
          </p>
        ) : (
          <div className="overflow-x-auto">
            <p className="text-xs text-amber-700 mb-2 font-medium">
              {fmtNum(advertencias_elegiveis.length)} participante(s) com menos de 75% de presença e sem advertência emitida.
            </p>
            <table className="w-full text-xs">
              <thead className="bg-gray-50">
                <tr>
                  {['Nome', 'Categoria', 'Supervisão', 'Presenças', 'Freq.'].map(h => (
                    <th key={h} className="px-3 py-2 text-left text-[10px] font-bold text-gray-500 uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {advertencias_elegiveis.slice(0, 30).map(a => (
                  <tr key={a.id} className="border-t border-gray-50 hover:bg-gray-50/50">
                    <td className="px-3 py-2 font-semibold text-gray-800">{a.nome}</td>
                    <td className="px-3 py-2 text-gray-500">{a.categoria ?? '—'}</td>
                    <td className="px-3 py-2 text-gray-500">{a.supervisao_nome ?? '—'}</td>
                    <td className="px-3 py-2 text-gray-700">{a.presencas}/{a.total_plenarias}</td>
                    <td className="px-3 py-2"><FreqBar pct={a.percentual} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {advertencias_elegiveis.length > 30 && (
              <p className="text-xs text-gray-400 text-center mt-2">+ {fmtNum(advertencias_elegiveis.length - 30)} mais</p>
            )}
          </div>
        )}
      </div>

      {/* ── 11. MATRIZ OPERACIONAL ──────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <span className="text-lg">📋</span>
            <h3 className="font-black text-[#0D2B4E] text-sm">Matriz Operacional</h3>
            <span className="text-xs bg-[#0D2B4E]/10 text-[#0D2B4E] px-2 py-0.5 rounded-full font-semibold">
              {fmtNum(matrizFiltrada.length)} / {fmtNum(data.matriz.length)}
            </span>
          </div>
        </div>

        {/* Filtros */}
        <div className="flex flex-wrap gap-2 mb-3">
          <input
            value={mBusca} onChange={e => { setMBusca(e.target.value); setMPagina(0); }}
            placeholder="Buscar nome ou CPF…"
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-xs flex-1 min-w-40 focus:outline-none focus:ring-1 focus:ring-[#123b63]"
          />
          <select value={mCategoria} onChange={e => { setMCategoria(e.target.value); setMPagina(0); }}
            className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#123b63]">
            <option value="">Todas categorias</option>
            {categorias.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={mSup} onChange={e => { setMSup(e.target.value); setMCampo(''); setMPagina(0); }}
            className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#123b63]">
            <option value="">Todas supervisões</option>
            {supervisoes.map(([id, nome]) => <option key={id} value={id}>{nome}</option>)}
          </select>
          <select value={mCampo} onChange={e => { setMCampo(e.target.value); setMPagina(0); }}
            className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#123b63]">
            <option value="">Todos os campos</option>
            {camposFiltro.map(([id, nome]) => <option key={id} value={id}>{nome}</option>)}
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                {['Nome', 'Categoria', 'Supervisão', 'Pago', 'Credenciado', 'Hospedagem', 'Refeitório', 'Plenária'].map(h => (
                  <th key={h} className="px-2 py-2 text-left text-[10px] font-bold text-gray-500 uppercase whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrizPag.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">Nenhum registro encontrado.</td></tr>
              ) : matrizPag.map(r => (
                <tr key={r.id} className="border-t border-gray-50 hover:bg-gray-50/50">
                  <td className="px-2 py-1.5 font-semibold text-gray-800 max-w-[160px] truncate">{r.nome}</td>
                  <td className="px-2 py-1.5 text-gray-500 max-w-[110px] truncate">{r.categoria ?? '—'}</td>
                  <td className="px-2 py-1.5 text-gray-500 max-w-[110px] truncate">{r.supervisao_nome ?? '—'}</td>
                  <td className="px-2 py-1.5 text-center">{r.pago ? '✔' : '✖'}</td>
                  <td className="px-2 py-1.5 text-center">{r.credenciado ? <span className="text-teal-600 font-bold">✔</span> : '—'}</td>
                  <td className="px-2 py-1.5 text-center text-[10px]">{HOSP_LABEL[r.hospedagem_status] ?? r.hospedagem_status}</td>
                  <td className="px-2 py-1.5 text-center">{r.refeicoes_utilizadas > 0 ? <span className="text-amber-600 font-semibold">{r.refeicoes_utilizadas}</span> : '—'}</td>
                  <td className="px-2 py-1.5">
                    {r.total_plenarias > 0
                    ? <FreqBar pct={r.percentual_frequencia} />
                      : <span className="text-gray-400">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Paginação */}
        {totalPaginasMatriz > 1 && (
          <div className="flex items-center justify-between mt-3 text-xs text-gray-500">
            <span>Pág. {mPagina + 1} de {totalPaginasMatriz}</span>
            <div className="flex gap-2">
              <button onClick={() => setMPagina(p => Math.max(0, p - 1))} disabled={mPagina === 0}
                className="px-3 py-1 rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50">← Anterior</button>
              <button onClick={() => setMPagina(p => Math.min(totalPaginasMatriz - 1, p + 1))} disabled={mPagina >= totalPaginasMatriz - 1}
                className="px-3 py-1 rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50">Próxima →</button>
            </div>
          </div>
        )}
      </div>

      {/* ── Rodapé ──────────────────────────────────────────────────────── */}
      <p className="text-center text-[10px] text-gray-300 pb-2">
        Gerado em {fmtDT(data.gerado_em)} · endpoint /api/eventos/{eventoId}/dashboard-executivo
      </p>

      {/* ── Modal de Rascunho da Carta de Advertência ────────────────────────── */}
      {cartaRascunho && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fadeIn">
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto border border-gray-100 flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-gray-100 bg-slate-50 rounded-t-2xl">
              <div className="flex items-center gap-2">
                <span className="text-lg">📄</span>
                <div>
                  <h4 className="font-black text-slate-800 text-sm">Visualização de Advertência</h4>
                  <p className="text-[10px] text-gray-400">Rascunho de Documento Oficial Ministerial</p>
                </div>
              </div>
              <button
                onClick={() => setCartaRascunho(null)}
                className="text-xs px-2.5 py-1 rounded bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold transition"
              >
                Fechar
              </button>
            </div>

            {/* Corpo da Carta (Papel Timbrado) */}
            <div className="p-8 flex-1 overflow-y-auto space-y-6 text-sm text-slate-700 leading-relaxed font-serif bg-slate-50/50">
              <div className="bg-white p-8 border border-gray-200 shadow-sm rounded-xl space-y-6 max-w-xl mx-auto relative overflow-hidden">
                {/* Linha decorativa topo */}
                <div className="absolute top-0 inset-x-0 h-1.5 bg-[#0D2B4E]" />

                {/* Cabeçalho Oficial */}
                <div className="text-center space-y-1">
                  <h3 className="font-extrabold text-[#0D2B4E] text-base font-sans tracking-wide">COMIEADEPA</h3>
                  <p className="text-[9px] uppercase tracking-widest font-sans font-bold text-gray-400">Convenção de Ministros e Igrejas Assembleias de Deus no Estado do Pará</p>
                  <p className="text-[10px] font-sans font-medium text-gray-500">Centro Administrativo · Departamento de Frequência Ministerial</p>
                </div>

                <div className="h-px bg-gray-100" />

                {/* Conteúdo */}
                <div className="space-y-4 font-sans text-xs">
                  <p className="text-right text-gray-400 font-sans text-[10px]">
                    Belém-PA, {new Date().toLocaleDateString('pt-BR')}
                  </p>

                  <p className="font-bold text-[#0D2B4E]">
                    Prezado(a) {cartaRascunho.cargo_ministerial || 'Ministro'} {cartaRascunho.nome},
                  </p>

                  <p className="text-justify leading-relaxed">
                    Constatamos em nossos registros de controle de acesso via leitor de QR Code que V. Sa. obteve o seguinte índice de comparecimento durante as plenárias da <strong>{data.evento.nome}</strong>:
                  </p>

                  {/* Detalhamento de Frequência */}
                  <div className="bg-slate-50 border border-slate-100 rounded-xl p-3.5 space-y-2">
                    <p className="font-bold text-slate-800 text-[11px] mb-1">MÉTRICAS OFICIAIS DE COMPARECIMENTO:</p>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
                      <p className="text-gray-500">Matrícula Ministerial:</p>
                      <p className="font-bold text-slate-800 text-right">{cartaRascunho.matricula || '—'}</p>

                      <p className="text-gray-500">CPF:</p>
                      <p className="font-bold text-slate-800 text-right">{cartaRascunho.cpf || '—'}</p>

                      <p className="text-gray-500">Inscrito no Evento:</p>
                      <p className="font-bold text-slate-800 text-right">{cartaRascunho.esta_inscrito ? 'Sim' : 'Não'}</p>

                      <p className="text-gray-500">Plenárias Comparecidas:</p>
                      <p className="font-bold text-slate-800 text-right">{cartaRascunho.dias_presentes} de {cartaRascunho.dias_presentes + cartaRascunho.dias_ausentes} plenárias</p>

                      <p className="text-gray-500">Plenárias Ausentes:</p>
                      <p className="font-bold text-red-600 text-right">{cartaRascunho.dias_ausentes} plenárias</p>

                      <p className="text-gray-500">Frequência Consolidada:</p>
                      <p className="font-black text-right text-red-700">
                        {cartaRascunho.percentual_presenca !== null ? `${cartaRascunho.percentual_presenca}%` : '0%'}
                      </p>
                    </div>
                  </div>

                  <p className="text-justify leading-relaxed">
                    De acordo com os estatutos e regimentos internos que regem as plenárias e sessões deliberativas desta Convenção, a assiduidade mínima de 75% é obrigatória para a manutenção da regularidade das plenárias da AGO. A ausência sem justificativa nas sessões de plenárias implica na emissão da presente advertência em rascunho.
                  </p>

                  <p className="text-justify leading-relaxed font-semibold text-[#0d2b4e]">
                    ⚠️ ORIENTAÇÕES PARA REGULARIZAÇÃO E JUSTIFICATIVA:
                  </p>
                  <p className="text-justify leading-relaxed">
                    V. Sa. dispõe de um prazo regulamentar para protocolar a justificativa de suas ausências. O protocolo deve detalhar os motivos de força maior ou justificativas eclesiásticas para análise da Mesa Diretora.
                  </p>

                  <div className="pt-6 text-center space-y-1 text-[10px] text-gray-400 font-sans">
                    <p className="h-0.5 w-32 bg-gray-200 mx-auto mb-2" />
                    <p className="font-bold text-slate-700">MESA DIRETORA COMIEADEPA</p>
                    <p>Secretaria Geral Administrativa</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-gray-100 bg-slate-50 flex items-center justify-end gap-2 rounded-b-2xl">
              <button
                onClick={() => setCartaRascunho(null)}
                disabled={salvandoCarta}
                className="text-xs px-4 py-2 rounded-lg bg-gray-500 text-white font-bold hover:bg-gray-600 disabled:opacity-50 transition"
              >
                Fechar
              </button>
              <button
                onClick={handleSalvarRascunho}
                disabled={salvandoCarta}
                className="text-xs px-4 py-2 rounded-lg bg-emerald-600 text-white font-bold hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-1.5 transition"
              >
                {salvandoCarta ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Salvando...
                  </>
                ) : (
                  'Salvar Rascunho'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
