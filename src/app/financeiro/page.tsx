'use client';

import { useState, useEffect, useCallback } from 'react';
import PageLayout from '@/components/PageLayout';
import AccessRestricted from '@/components/AccessRestricted';
import { createClient } from '@/lib/supabase-client';
import { buildUrl, getAppBaseUrl } from '@/lib/urls';
import { useRequireSupabaseAuth } from '@/hooks/useRequireSupabaseAuth';
import { useUserRole } from '@/hooks/useUserRole';
import { canAccessModule } from '@/lib/auth/roles';

// ─── Tipos ─────────────────────────────────────────────────────────────
interface Supervisao { id: string; nome: string; }
interface Campo {
  id: string; nome: string; supervisao_id: string;
  pastor_member_id?: string | null; presidente_nome?: string | null;
}
interface Contribuicao {
  id: string;
  campo_id: string | null;
  campo_nome: string;
  supervisao_id: string | null;
  supervisao_nome: string;
  pastor_member_id?: string | null;
  pastor_nome?: string | null;
  mes: number;
  ano: number;
  valor: number;
  forma_pagamento: string;
  contato?: string | null;
  created_at: string;
}
interface LinhaPivot {
  campo_id: string | null;
  campo_nome: string;
  supervisao_id: string | null;
  supervisao_nome: string;
  ano: number;
  meses: Record<number, Contribuicao>;
}

const MESES_ABREV = ['JAN','FEV','MAR','ABR','MAI','JUN','JUL','AGO','SET','OUT','NOV','DEZ'];
const MESES_FULL  = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const FORMAS_PAG  = ['A VISTA','PIX','TRANSFERÊNCIA','BOLETO','CHEQUE'];

const fmtValor = (v: number | null | undefined) =>
  v ? v.toFixed(2).replace('.', ',') : '00,00';

const parseMoeda = (s: string) =>
  parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0;

// ─── Componente principal ──────────────────────────────────────────────
export default function FinanceiroPage() {
  const { loading } = useRequireSupabaseAuth();
  const { role, loading: roleLoading } = useUserRole();
  const supabase = createClient();
  const anoAtual = new Date().getFullYear();

  const podeAcessar = canAccessModule(role, 'financeiro');

  // Aba ativa
  const [abaAtiva, setAbaAtiva] = useState<'contribuicao-estatutaria'>('contribuicao-estatutaria');

  // Dados de referência
  const [supervisoes, setSupervisoes] = useState<Supervisao[]>([]);
  const [campos, setCampos] = useState<Campo[]>([]);

  // Formulário de registro
  const [supId, setSupId]             = useState('');
  const [campoId, setCampoId]         = useState('');
  const [campoNome, setCampoNome]     = useState('');
  const [pastorNome, setPastorNome]   = useState('');
  const [pastorMat, setPastorMat]     = useState('');
  const [pastorCpf, setPastorCpf]     = useState('');
  const [contato, setContato]         = useState('');
  const [mes, setMes]                 = useState(new Date().getMonth() + 1);
  const [formaPag, setFormaPag]       = useState('A VISTA');
  const [valorStr, setValorStr]       = useState('0,00');

  // Tabela / filtros
  const [contribuicoes, setContribuicoes] = useState<Contribuicao[]>([]);
  const [filtroSup, setFiltroSup]         = useState('');
  const [filtroCampo, setFiltroCampo]     = useState('');
  const [filtroAno, setFiltroAno]         = useState(String(anoAtual));
  const [busca, setBusca]                 = useState('');
  const [page, setPage]                   = useState(1);
  const PER_PAGE = 20;

  // Status
  const [saving, setSaving]   = useState(false);
  const [erro, setErro]       = useState('');
  const [sucesso, setSucesso] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);

  const getAccessTokenOrThrow = async () => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error('Nao autenticado');
    return token;
  };

  const authedFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const token = await getAccessTokenOrThrow();
    const headers = new Headers(init?.headers || {});
    headers.set('Authorization', `Bearer ${token}`);
    return fetch(input, { ...init, headers });
  };

  // ─── Carga inicial ────────────────────────────────────────────────────
  const loadContribuicoes = useCallback(async () => {
    const params = new URLSearchParams();
    if (filtroAno) params.set('ano', filtroAno);
    if (filtroSup) params.set('supervisao_id', filtroSup);
    if (filtroCampo) params.set('campo_id', filtroCampo);
    const res = await authedFetch(`/api/financeiro/contribuicoes?${params}`);
    const json = await res.json();
    setContribuicoes(json.data || []);
  }, [filtroAno, filtroSup, filtroCampo]);

  useEffect(() => {
    if (loading || roleLoading || !podeAcessar) return;
    // Carrega supervisoes e campos via API protegida
    (async () => {
      const res = await authedFetch('/api/v1/estrutura');
      const json = await res.json();
      if (res.ok) {
        setSupervisoes((json?.supervisoes as Supervisao[]) || []);
        setCampos((json?.campos as Campo[]) || []);
      }
    })();

    loadContribuicoes();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, roleLoading, podeAcessar]);

  // Recarrega tabela quando filtros mudam
  useEffect(() => {
    if (!loading && !roleLoading && podeAcessar) loadContribuicoes();
  }, [loading, roleLoading, podeAcessar, loadContribuicoes]);

  // ─── Selecionar campo → preenche pastor ──────────────────────────────
  const handleCampoChange = async (id: string) => {
    setCampoId(id);
    const campo = campos.find(c => c.id === id);
    if (!campo) { setCampoNome(''); setPastorNome(''); setPastorMat(''); setPastorCpf(''); return; }
    setCampoNome(campo.nome);
    if (campo.pastor_member_id) {
      const res = await authedFetch(`/api/v1/members/lookup?id=${campo.pastor_member_id}&limit=1`);
      const json = await res.json();
      const data = (json?.data as any[])?.[0];
      if (res.ok && data) {
        setPastorNome(data.name || '');
        setPastorMat(String(data.matricula || ''));
        setPastorCpf(data.cpf || '');
        return;
      }
    }
    setPastorNome(campo.presidente_nome || '');
    setPastorMat('');
    setPastorCpf('');
  };

  const limpar = () => {
    setSupId(''); setCampoId(''); setCampoNome('');
    setPastorNome(''); setPastorMat(''); setPastorCpf('');
    setContato(''); setFormaPag('A VISTA'); setValorStr('0,00');
    setErro(''); setSucesso('');
  };

  // ─── Registrar contribuição ───────────────────────────────────────────
  const handleRegistrar = async () => {
    if (!campoId || !campoNome) { setErro('Selecione uma supervisão e um campo.'); return; }
    setSaving(true); setErro(''); setSucesso('');
    const sup = supervisoes.find(s => s.id === supId);
    const res = await authedFetch('/api/financeiro/contribuicoes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        campo_id: campoId, campo_nome: campoNome,
        supervisao_id: supId || null, supervisao_nome: sup?.nome || '',
        pastor_nome: pastorNome || null, pastor_member_id: null,
        mes, ano: anoAtual,
        valor: parseMoeda(valorStr),
        forma_pagamento: formaPag,
        contato: contato || null,
      }),
    });
    const json = await res.json();
    setSaving(false);
    if (!res.ok) { setErro(json.error || 'Erro ao registrar.'); return; }
    setSucesso(json.updated
      ? `Contribuição de ${MESES_FULL[mes - 1]} atualizada com sucesso!`
      : `Contribuição de ${MESES_FULL[mes - 1]} registrada com sucesso!`);
    limpar();
    await loadContribuicoes();
  };

  // ─── Excluir ──────────────────────────────────────────────────────────
  const handleExcluir = async (id: string) => {
    if (!confirm('Excluir este registro?')) return;
    setDeleting(id);
    await authedFetch(`/api/financeiro/contribuicoes?id=${id}`, { method: 'DELETE' });
    setDeleting(null);
    await loadContribuicoes();
  };

  if (loading || roleLoading) return <div className="p-8">Carregando...</div>;
  if (!podeAcessar) {
    return (
      <PageLayout title="Financeiro" description="" activeMenu="financeiro">
        <AccessRestricted
          message="Voce nao tem permissao para acessar o modulo financeiro."
        />
      </PageLayout>
    );
  }

  // ─── Pivot table ──────────────────────────────────────────────────────
  const linhas: LinhaPivot[] = [];
  const chaves: Record<string, number> = {};

  contribuicoes
    .filter(c => {
      const txt = busca.toLowerCase();
      return !busca || c.campo_nome.toLowerCase().includes(txt) ||
        c.supervisao_nome.toLowerCase().includes(txt);
    })
    .forEach(c => {
      const key = `${c.campo_id ?? c.campo_nome}|${c.ano}`;
      if (chaves[key] === undefined) {
        chaves[key] = linhas.length;
        linhas.push({
          campo_id: c.campo_id, campo_nome: c.campo_nome,
          supervisao_id: c.supervisao_id, supervisao_nome: c.supervisao_nome,
          ano: c.ano, meses: {},
        });
      }
      linhas[chaves[key]].meses[c.mes] = c;
    });

  // Filtros de campo dropdown (dependente da supervisão do filtro)
  const camposParaFiltro = filtroSup
    ? campos.filter(c => c.supervisao_id === filtroSup)
    : campos;

  const totalPages = Math.max(1, Math.ceil(linhas.length / PER_PAGE));
  const paginadas  = linhas.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  // ─── Imprimir ─────────────────────────────────────────────────────────
  const handleImprimir = () => {
    const rows = linhas.map(l => {
      const mesesHtml = Array.from({ length: 12 }, (_, i) => {
        const c = l.meses[i + 1];
        const val = c ? fmtValor(c.valor) : '—';
        const color = (!c || c.valor === 0) ? '#cc0000' : '#000';
        return `<td style="color:${color};text-align:center">${val}</td>`;
      }).join('');
      return `<tr>
        <td>${l.ano}</td>
        <td>${l.campo_nome}</td>
        <td>${l.supervisao_nome}</td>
        ${mesesHtml}
      </tr>`;
    }).join('');

    const win = window.open('', '_blank', 'width=1200,height=800');
    if (!win) return;
    win.document.write(`<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"/>
<title>Contribuição Estatutária</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:Arial,sans-serif; font-size:9px; padding:12px; }
  .header { display:flex; align-items:center; gap:8px; border-bottom:2px solid #000; padding-bottom:8px; margin-bottom:8px; }
  .header img { width:55px; }
  .org { font-size:10px; font-weight:bold; }
  .sub { font-size:8px; color:#444; }
  h2 { text-align:center; font-size:11px; margin:8px 0 6px; border-bottom:1px solid #000; padding-bottom:4px; }
  table { width:100%; border-collapse:collapse; }
  thead tr { background:#000; color:#fff; }
  th { padding:4px 3px; text-align:left; font-size:8px; }
  td { padding:3px; border-bottom:1px solid #ddd; }
  tr:nth-child(even) td { background:#f5f5f5; }
  @media print { @page { size:A4 landscape; margin:8mm; } }
</style></head>
<body>
<div class="header">
  <img src="${buildUrl(getAppBaseUrl(), '/img/logo_comieadepa.png')}" alt="COMIEADEPA"/>
  <div>
    <div class="org">COMIEADEPA — CONTRIBUIÇÃO ESTATUTÁRIA</div>
    <div class="sub">Gerado em ${new Date().toLocaleDateString('pt-BR')} às ${new Date().toLocaleTimeString('pt-BR')}</div>
  </div>
</div>
<h2>CONTRIBUIÇÃO ESTATUTÁRIA${filtroAno ? ` — ANO ${filtroAno}` : ''} — ${linhas.length} registro(s)</h2>
<table>
  <thead><tr>
    <th>ANO</th><th>CAMPO</th><th>SUPERVISÃO</th>
    ${MESES_ABREV.map(m => `<th style="text-align:center">${m}</th>`).join('')}
  </tr></thead>
  <tbody>${rows}</tbody>
</table>
</body></html>`);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 500);
  };

  if (loading) return <div className="p-8">Carregando...</div>;

  // Campos do formulário filtrados pela supervisão selecionada
  const camposForm = supId ? campos.filter(c => c.supervisao_id === supId) : campos;

  return (
    <PageLayout
      title="Financeiro"
      description="Gestão financeira da COMIEADEPA"
      activeMenu="financeiro"
    >
      <div className="w-full max-w-7xl mx-auto">

        {/* ─── Abas ─────────────────────────────────────────────────── */}
        <div className="mb-6 border-b border-gray-300">
          <div className="flex gap-4">
            <button
              onClick={() => setAbaAtiva('contribuicao-estatutaria')}
              className={`px-6 py-3 font-semibold border-b-2 transition ${
                abaAtiva === 'contribuicao-estatutaria'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-600 hover:text-gray-800'
              }`}
            >
              💰 Contribuição Estatutária
            </button>
          </div>
        </div>

        {/* ─── ABA: CONTRIBUIÇÃO ESTATUTÁRIA ────────────────────────── */}
        {abaAtiva === 'contribuicao-estatutaria' && (
          <div className="space-y-4">

            {/* Formulário de registro */}
            <div className="bg-[#fdf9ed] border border-yellow-200 rounded-lg p-4 shadow-sm">

              {/* Linha 1: SUP | CAMPO | PASTOR | MATRÍCULA | CPF */}
              <div className="grid grid-cols-1 md:grid-cols-[200px_220px_1fr_120px_160px] gap-3 items-end">
                <div>
                  <label className="block text-[10px] font-bold text-red-700 uppercase mb-1 tracking-wide">Supervisão</label>
                  <select
                    value={supId}
                    onChange={e => { setSupId(e.target.value); setCampoId(''); setCampoNome(''); setPastorNome(''); setPastorMat(''); setPastorCpf(''); }}
                    className="w-full border-2 border-red-400 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-300 bg-white"
                  >
                    <option value="">— Supervisão —</option>
                    {supervisoes.map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-red-700 uppercase mb-1 tracking-wide">Campo</label>
                  <div className="flex gap-1 items-center">
                    <select
                      value={campoId}
                      onChange={e => handleCampoChange(e.target.value)}
                      className="flex-1 border-2 border-red-400 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-300 bg-white"
                    >
                      <option value="">— Campo —</option>
                      {camposForm.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                    </select>
                    <button
                      onClick={limpar}
                      title="Limpar seleção"
                      className="w-7 h-7 flex items-center justify-center rounded-full bg-red-500 text-white hover:bg-red-600 transition text-xs font-bold flex-shrink-0"
                    >✕</button>
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1 tracking-wide">Pastor Presidente</label>
                  <input
                    readOnly value={pastorNome}
                    className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm bg-gray-50 text-gray-700"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1 tracking-wide">Matrícula</label>
                  <input
                    readOnly value={pastorMat}
                    className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm bg-gray-50 text-gray-700"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1 tracking-wide">CPF</label>
                  <input
                    readOnly value={pastorCpf}
                    className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm bg-gray-50 text-gray-700"
                  />
                </div>
              </div>

              {/* Linha 2: CONTATO | MÊS | ANO | FORMA | VALOR | REGISTRAR */}
              <div className="grid grid-cols-1 md:grid-cols-[180px_160px_90px_160px_130px_auto] gap-3 items-end mt-3">
                <div>
                  <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1 tracking-wide">Contato</label>
                  <input
                    type="text"
                    value={contato}
                    onChange={e => setContato(e.target.value)}
                    placeholder="(91) 9xxxx-xxxx"
                    className="w-full border-2 border-teal-500 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-300"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1 tracking-wide">Mês de Referência</label>
                  <select
                    value={mes}
                    onChange={e => setMes(Number(e.target.value))}
                    className="w-full border-2 border-teal-500 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-300 bg-white"
                  >
                    {MESES_FULL.map((m, i) => (
                      <option key={i + 1} value={i + 1}>{m}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1 tracking-wide">Ano</label>
                  <input
                    readOnly value={anoAtual}
                    className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm bg-gray-50 text-center font-bold text-[#123b63]"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1 tracking-wide">Forma de Pagamento</label>
                  <select
                    value={formaPag}
                    onChange={e => setFormaPag(e.target.value)}
                    className="w-full border-2 border-teal-500 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-300 bg-white"
                  >
                    {FORMAS_PAG.map(f => <option key={f} value={f}>{f}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1 tracking-wide">Valor</label>
                  <div className="flex items-center border-2 border-teal-500 rounded overflow-hidden bg-white">
                    <span className="px-2 text-sm text-gray-500 font-semibold border-r border-gray-200">R$</span>
                    <input
                      type="text"
                      value={valorStr}
                      onChange={e => setValorStr(e.target.value)}
                      onFocus={e => e.target.select()}
                      className="flex-1 px-2 py-1.5 text-sm focus:outline-none text-right"
                    />
                  </div>
                </div>
                <div className="flex flex-col justify-end">
                  <button
                    onClick={handleRegistrar}
                    disabled={saving}
                    className="px-5 py-2 bg-gray-400 hover:bg-[#123b63] text-white font-bold text-sm rounded transition disabled:opacity-60"
                  >
                    {saving ? 'AGUARDE...' : 'REGISTRAR'}
                  </button>
                </div>
              </div>

              {/* Alertas */}
              {erro    && <p className="mt-3 text-sm text-red-600 font-semibold">{erro}</p>}
              {sucesso && <p className="mt-3 text-sm text-green-700 font-semibold">{sucesso}</p>}
            </div>

            {/* ─── Tabela de histórico ──────────────────────────────── */}
            <div className="bg-white rounded-lg shadow-md overflow-hidden">

              {/* Barra de filtros */}
              <div className="bg-[#123b63] text-white px-4 py-2 flex flex-wrap items-center gap-2 text-xs font-bold">
                <span className="uppercase tracking-widest mr-1">Filtros</span>

                <select
                  value={filtroSup}
                  onChange={e => { setFiltroSup(e.target.value); setFiltroCampo(''); setPage(1); }}
                  className="border border-white/40 bg-[#1a4f85] text-white rounded px-2 py-1 text-xs focus:outline-none"
                >
                  <option value="">Supervisão</option>
                  {supervisoes.map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}
                </select>

                <select
                  value={filtroCampo}
                  onChange={e => { setFiltroCampo(e.target.value); setPage(1); }}
                  className="border border-white/40 bg-[#1a4f85] text-white rounded px-2 py-1 text-xs focus:outline-none"
                >
                  <option value="">Campo</option>
                  {camposParaFiltro.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                </select>

                <select
                  value={filtroAno}
                  onChange={e => { setFiltroAno(e.target.value); setPage(1); }}
                  className="border border-white/40 bg-[#1a4f85] text-white rounded px-2 py-1 text-xs focus:outline-none"
                >
                  {Array.from({ length: 6 }, (_, i) => anoAtual - i).map(a => (
                    <option key={a} value={a}>{a}</option>
                  ))}
                </select>

                <input
                  type="text"
                  value={busca}
                  onChange={e => { setBusca(e.target.value); setPage(1); }}
                  placeholder="Digite sua busca..."
                  className="flex-1 min-w-[140px] border border-white/40 bg-[#1a4f85] text-white placeholder-white/60 rounded px-2 py-1 text-xs focus:outline-none"
                />

                <button
                  onClick={() => { setFiltroSup(''); setFiltroCampo(''); setBusca(''); setPage(1); }}
                  className="px-3 py-1 bg-white text-[#123b63] rounded font-bold hover:bg-gray-100 transition"
                >
                  LIMPAR
                </button>
                <button
                  onClick={handleImprimir}
                  className="px-3 py-1 bg-[#c8a42a] text-white rounded font-bold hover:bg-[#a8872a] transition"
                >
                  IMPRIMIR
                </button>

                <span className="ml-auto px-2 py-0.5 bg-white text-[#123b63] rounded font-bold text-xs min-w-[28px] text-center">
                  {page}
                </span>
              </div>

              {/* Tabela */}
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-[#123b63] text-white">
                      <th className="px-3 py-2 text-left whitespace-nowrap">REFERÊNCIA</th>
                      <th className="px-3 py-2 text-left">CAMPO</th>
                      {MESES_ABREV.map(m => (
                        <th key={m} className="px-2 py-2 text-center whitespace-nowrap">{m}</th>
                      ))}
                      <th className="px-3 py-2 text-center">CONTROL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginadas.length === 0 && (
                      <tr>
                        <td colSpan={15} className="text-center text-gray-400 py-8 text-sm">
                          Nenhum registro encontrado
                        </td>
                      </tr>
                    )}
                    {paginadas.map((l, idx) => (
                      <tr key={`${l.campo_id}|${l.ano}|${idx}`} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                        <td className="px-3 py-2 font-bold text-gray-700 whitespace-nowrap">{l.ano}</td>
                        <td className="px-3 py-2 font-semibold italic text-gray-800 whitespace-nowrap">
                          {l.campo_nome}
                        </td>
                        {Array.from({ length: 12 }, (_, i) => {
                          const c = l.meses[i + 1];
                          const pago = c && c.valor > 0;
                          return (
                            <td key={i} className="px-1 py-2 text-center whitespace-nowrap">
                              <span className={`font-semibold ${pago ? 'text-gray-800' : 'text-red-600'}`}>
                                {fmtValor(c?.valor)}
                              </span>
                            </td>
                          );
                        })}
                        <td className="px-3 py-2 text-center whitespace-nowrap">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              title="Imprimir linha"
                              onClick={() => {
                                const win = window.open('', '_blank', 'width=800,height=600');
                                if (!win) return;
                                const mesesHtml = Array.from({ length: 12 }, (_, i) => {
                                  const c = l.meses[i + 1];
                                  return `<td style="text-align:center;color:${c && c.valor > 0 ? '#000' : '#c00'}">${fmtValor(c?.valor)}</td>`;
                                }).join('');
                                win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"/><title>Contribuição</title>
                                  <style>body{font-family:Arial;font-size:10px;padding:16px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:4px 6px}thead{background:#000;color:#fff}@media print{@page{size:A4 landscape;margin:8mm}}</style></head>
                                  <body><h3 style="margin-bottom:8px">CONTRIBUIÇÃO ESTATUTÁRIA — ${l.campo_nome} — ${l.ano}</h3>
                                  <table><thead><tr><th>CAMPO</th>${MESES_ABREV.map(m=>`<th>${m}</th>`).join('')}</tr></thead>
                                  <tbody><tr><td>${l.campo_nome}</td>${mesesHtml}</tr></tbody></table></body></html>`);
                                win.document.close(); win.focus(); setTimeout(() => win.print(), 400);
                              }}
                              className="text-blue-500 hover:text-blue-700 text-base"
                            >🖨</button>
                            {Object.values(l.meses).map(c => (
                              <button
                                key={c.id}
                                onClick={() => handleExcluir(c.id)}
                                disabled={deleting === c.id}
                                title={`Excluir ${MESES_ABREV[c.mes - 1]}`}
                                className="text-red-500 hover:text-red-700 text-base disabled:opacity-40"
                              >✕</button>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Paginação */}
              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-2 py-3 border-t border-gray-100">
                  <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                    className="px-3 py-1 text-xs border rounded disabled:opacity-40 hover:bg-gray-50">‹</button>
                  <span className="text-xs text-gray-600">{page} / {totalPages}</span>
                  <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                    className="px-3 py-1 text-xs border rounded disabled:opacity-40 hover:bg-gray-50">›</button>
                </div>
              )}

            </div>
          </div>
        )}

      </div>
    </PageLayout>
  );
}
