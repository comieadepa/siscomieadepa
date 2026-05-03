'use client';

import React, { useState, useEffect, useRef } from 'react';
import Sidebar from '@/components/Sidebar';
import NotificationModal from '@/components/NotificationModal';
import { createClient } from '@/lib/supabase-client';

export const dynamic = 'force-dynamic';

// ── Tipos ────────────────────────────────────────────────────────────────────

interface DebitoCgadb {
  id: string;
  cpf: string;
  registro: string | null;
  nome: string;
  convencao: string | null;
  ano: number | null;
  valor: number | null;
  status: string | null;
  imported_at: string;
}

interface MinistroComDebito {
  id: string;
  nome: string;
  cpf: string;
  supervisao: string;
  campo: string;
  cargo: string;
  telefone: string;
  status: string;
  registro: string;
  debitos: DebitoCgadb[];
  totalDevido: number;
  anosDebito: number[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function normalizeCpf(cpf: string): string {
  return (cpf || '').replace(/\D/g, '');
}

function formatCpfDisplay(cpf: string): string {
  const d = normalizeCpf(cpf);
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  return cpf;
}

function formatValor(v: number | null): string {
  if (v == null) return '—';
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Detecta automaticamente se o valor usa ponto decimal (inglês: 144.00)
// ou vírgula decimal (BR: 144,00 / 1.234,56) e converte corretamente
function parseValor(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  // Tem vírgula → formato BR: remover pontos de milhar, trocar vírgula por ponto
  if (s.includes(',')) return parseFloat(s.replace(/\./g, '').replace(',', '.')) || null;
  // Tem ponto: verificar se é decimal (≤2 dígitos após último ponto) ou milhar (≥3 dígitos)
  if (s.includes('.')) {
    const afterDot = s.slice(s.lastIndexOf('.') + 1);
    if (afterDot.length <= 2) return parseFloat(s) || null; // decimal inglês: 144.00
    return parseFloat(s.replace(/\./g, '')) || null; // milhar BR: 1.000
  }
  return parseFloat(s) || null;
}

// Parse CSV flexível (vírgula ou ponto-e-vírgula, com ou sem aspas)
function parseCsvLine(line: string, sep: string): string[] {
  const result: string[] = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQuote = !inQuote; continue; }
    if (!inQuote && ch === sep) { result.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  result.push(cur.trim());
  return result;
}

function detectSep(firstLine: string): string {
  const sc = (firstLine.match(/;/g) || []).length;
  const cc = (firstLine.match(/,/g) || []).length;
  return sc >= cc ? ';' : ',';
}

// ── Componente principal ──────────────────────────────────────────────────────

export default function CgadbPage() {
  const [activeMenu, setActiveMenu] = useState('cgadb');
  const [activeTab, setActiveTab] = useState<'ministros' | 'debitos'>('ministros');
  const [notification, setNotification] = useState<{
    isOpen: boolean; title: string; message: string; type: 'success' | 'error' | 'warning' | 'info';
  }>({ isOpen: false, title: '', message: '', type: 'success' });

  const notify = (title: string, message: string, type: 'success' | 'error' | 'warning' | 'info') =>
    setNotification({ isOpen: true, title, message, type });

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar activeMenu={activeMenu} setActiveMenu={setActiveMenu} />

      <NotificationModal
        title={notification.title}
        message={notification.message}
        type={notification.type}
        isOpen={notification.isOpen}
        onClose={() => setNotification(n => ({ ...n, isOpen: false }))}
      />

      <div className="flex-1 overflow-auto">
        <div className="p-6">
          <h1 className="text-3xl font-bold text-gray-800 mb-6">🔴 Débitos CGADB</h1>

          {/* Abas */}
          <div className="flex border-b border-gray-300 bg-white rounded-t-lg overflow-x-auto">
            <button
              onClick={() => setActiveTab('ministros')}
              className={`px-6 py-3 font-semibold transition whitespace-nowrap text-sm border-b-2 ${
                activeTab === 'ministros'
                  ? 'text-teal-700 border-teal-600'
                  : 'text-gray-600 border-transparent hover:text-teal-600'
              }`}
            >
              👥 Lista de Ministros
            </button>
            <button
              onClick={() => setActiveTab('debitos')}
              className={`px-6 py-3 font-semibold transition whitespace-nowrap text-sm border-b-2 ${
                activeTab === 'debitos'
                  ? 'text-teal-700 border-teal-600'
                  : 'text-gray-600 border-transparent hover:text-teal-600'
              }`}
            >
              📋 Débito CGADB
            </button>
          </div>

          <div className="bg-white rounded-b-lg shadow-md p-6">
            <div className={activeTab === 'ministros' ? '' : 'hidden'}><AbaMinistros notify={notify} /></div>
            <div className={activeTab === 'debitos' ? '' : 'hidden'}><AbaDebitos notify={notify} /></div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Aba 1: Lista de Ministros ─────────────────────────────────────────────────

function AbaMinistros({ notify }: { notify: (t: string, m: string, tp: 'success' | 'error' | 'warning' | 'info') => void }) {
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [ministros, setMinistros] = useState<MinistroComDebito[]>([]);
  const [supervisoes, setSupervisoes] = useState<string[]>([]);
  const [campos, setCampos] = useState<string[]>([]);

  // Filtros
  const [filtroSupervisao, setFiltroSupervisao] = useState('');
  const [filtroCampo, setFiltroCampo] = useState('');
  const [filtroBusca, setFiltroBusca] = useState('');
  const [filtroStatus, setFiltroStatus] = useState<'todos' | 'com_debito' | 'sem_debito'>('todos');
  const [apenasNaoRegistrados, setApenasNaoRegistrados] = useState(false);

  // Expandir detalhes de débito por ministro
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load() {
    try {
      setLoading(true);

      // Carregar ministros em lotes (Supabase limita 1000/query)
      const allMembros: any[] = [];
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from('members')
          .select('id, name, cpf, status, tipo_cadastro, celular, phone, whatsapp, cargo_ministerial, custom_fields')
          .or('status.eq.active,tipo_cadastro.eq.ministro')
          .order('name')
          .range(from, from + 999);
        if (error) throw error;
        if (!data || data.length === 0) break;
        allMembros.push(...data);
        if (data.length < 1000) break;
        from += 1000;
      }

      // Carregar todos os débitos em lotes
      const allDebitos: DebitoCgadb[] = [];
      from = 0;
      while (true) {
        const { data, error } = await supabase
          .from('cgadb_debitos')
          .select('*')
          .order('ano', { ascending: false })
          .range(from, from + 999);
        if (error) throw error;
        if (!data || data.length === 0) break;
        allDebitos.push(...(data as DebitoCgadb[]));
        if (data.length < 1000) break;
        from += 1000;
      }

      const membros = allMembros;
      const debitos = allDebitos;

      // Índice de débitos por CPF normalizado
      const debitosByCpf = new Map<string, DebitoCgadb[]>();
      for (const d of debitos) {
        const key = normalizeCpf(d.cpf);
        if (!debitosByCpf.has(key)) debitosByCpf.set(key, []);
        debitosByCpf.get(key)!.push(d);
      }

      // Montar ministros com débitos
      const lista: MinistroComDebito[] = membros.map((m: any) => {
        const cf = (m.custom_fields || {}) as Record<string, any>;
        const cpfNorm = normalizeCpf(String(m.cpf || ''));
        const debs = debitosByCpf.get(cpfNorm) || [];
        const total = debs.reduce((acc, d) => acc + (d.valor || 0), 0);
        const anos = debs.map(d => d.ano!).filter(Boolean).sort((a, b) => b - a);

        return {
          id: m.id,
          nome: String(m.name || ''),
          cpf: String(m.cpf || ''),
          supervisao: String(cf.supervisao || ''),
          campo: String(cf.campo || ''),
          cargo: String(cf.cargoMinisterial || cf.cargo_ministerial || m.cargo_ministerial || ''),
          telefone: String(m.celular || m.phone || cf.celular || m.whatsapp || cf.whatsapp || ''),
          status: String(m.status || ''),
          registro: debs[0]?.registro || '',
          debitos: debs,
          totalDevido: total,
          anosDebito: anos,
        };
      });

      setMinistros(lista);

      // Extrair opções únicas para filtros
      const supSet = new Set<string>();
      const camSet = new Set<string>();
      lista.forEach(m => {
        if (m.supervisao) supSet.add(m.supervisao);
        if (m.campo) camSet.add(m.campo);
      });
      setSupervisoes(Array.from(supSet).sort());
      setCampos(Array.from(camSet).sort());
    } catch (err: any) {
      notify('Erro', 'Erro ao carregar ministros: ' + (err?.message || ''), 'error');
    } finally {
      setLoading(false);
    }
  }

  const [pageSize, setPageSize] = useState(20);
  const [currentPage, setCurrentPage] = useState(1);

  // Filtrar lista
  const busca = filtroBusca.toLowerCase();
  const filtered = ministros.filter(m => {
    if (filtroSupervisao && m.supervisao !== filtroSupervisao) return false;
    if (filtroCampo && m.campo !== filtroCampo) return false;
    if (busca) {
      const cpfBusca = busca.replace(/\D/g, '');
      if (!m.nome.toLowerCase().includes(busca) && !(cpfBusca.length > 0 && normalizeCpf(m.cpf).includes(cpfBusca))) return false;
    }
    if (filtroStatus === 'com_debito' && m.debitos.length === 0) return false;
    if (filtroStatus === 'sem_debito' && m.debitos.length > 0) return false;
    if (apenasNaoRegistrados && m.debitos.length > 0) return false;
    return true;
  });

  const totalComDebito = ministros.filter(m => m.debitos.length > 0).length;

  const totalPages = Math.ceil(filtered.length / pageSize);
  const paginated = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  // Reset página ao filtrar
  const resetPage = () => setCurrentPage(1);

  function handlePrint() {
    const supervisaoTitulo = filtroSupervisao || 'TODAS AS SUPERVISÕES';
    const totalDebito = filtered.reduce((sum, m) => sum + m.totalDevido, 0);
    const totalDebitoFmt = totalDebito.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const titulo = `DÉBITOS CGADB - SUPERVISÃO: ${supervisaoTitulo.toUpperCase()} - QTD.: ${filtered.length}`;
    const tituloTotal = `/ TOTAL DO DÉBITO: ${totalDebitoFmt}`;

    const rows = filtered.map(m => `
      <tr>
        <td>${m.registro || '—'}</td>
        <td>${m.nome.toUpperCase()}</td>
        <td>${(m.supervisao || '—').toUpperCase()}</td>
        <td>${(m.campo || '—').toUpperCase()}</td>
        <td>${(m.cargo || '—').toUpperCase()}</td>
        <td style="text-align:right">${m.totalDevido > 0 ? m.totalDevido.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '—'}</td>
        <td>${m.telefone || '—'}</td>
      </tr>
    `).join('');

    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8"/>
  <title>${titulo}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Arial, sans-serif; font-size: 10px; color: #000; padding: 16px; }
    .header { display: flex; align-items: center; justify-content: center; gap: 4px; border-bottom: 2px solid #000; padding-bottom: 10px; margin-bottom: 10px; }
    .header-logo { width: 65px; height: auto; flex-shrink: 0; }
    .header-center { text-align: center; padding: 0 8px; }
    .header-center .org { font-size: 11px; font-weight: bold; line-height: 1.4; }
    .header-center .contact { font-size: 9px; color: #333; margin-top: 3px; }
    .header-center .address { font-size: 9px; font-weight: bold; margin-top: 2px; }
    .header-center .presidente { font-size: 11px; font-weight: bold; color: #0066cc; margin-top: 6px; }
    .report-title { text-align: center; font-size: 13px; font-weight: bold; margin: 12px 0 10px; border-bottom: 1px solid #000; padding-bottom: 6px; }
    .report-title .total { color: #cc0000; font-size: 12px; margin-left: 6px; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    thead tr { background: #000; color: #fff; }
    th { padding: 5px 6px; text-align: left; font-size: 9px; font-weight: bold; }
    td { padding: 4px 6px; font-size: 9px; border-bottom: 1px solid #ddd; vertical-align: top; }
    tr:nth-child(even) td { background: #f5f5f5; }
    @media print {
      body { padding: 8px; }
      @page { margin: 10mm; size: A4 landscape; }
    }
  </style>
</head>
<body>
  <div class="header">
    <img class="header-logo" src="${window.location.origin}/img/logo_comieadepa.png" alt="COMIEADEPA"/>
    <div class="header-center">
      <div class="org">COMIEADEPA - CONVENÇÃO INTERESTADUAL DE MINISTROS E IGREJAS<br/>EVANGÉLICAS ASSEMBLEIA DE DEUS NO PARÁ</div>
      <div class="contact">Emails: comieadepa@bol.com.br / Site: www.comieadepa.org</div>
      <div class="address">RODOVIA DO MÁRIO COVAS, 2500, 67115-000 / COQUEIRO, ANANINDEUA - PA</div>
      <div class="presidente">PRESIDENTE: PR. OCELIO NAUAR</div>
    </div>
    <img class="header-logo" src="${window.location.origin}/img/cgadb.png" alt="CGADB"/>
  </div>
  <div class="report-title">${titulo} <span class="total">${tituloTotal}</span></div>
  <table>
    <thead>
      <tr>
        <th>COD. CGADB</th>
        <th>NOME</th>
        <th>SUPERVISÃO</th>
        <th>CAMPO</th>
        <th>CARGO</th>
        <th style="text-align:right">DÉBITO</th>
        <th>CONTATO</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`;

    const win = window.open('', '_blank', 'width=1100,height=750');
    if (!win) return;
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 600);
  }

  return (
    <div>
      {/* Resumo */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-teal-50 border border-teal-200 rounded-lg p-4 text-center">
          <p className="text-2xl font-bold text-teal-700">{ministros.length}</p>
          <p className="text-xs text-teal-600 font-semibold mt-1">Total de Ministros</p>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-center">
          <p className="text-2xl font-bold text-red-600">{totalComDebito}</p>
          <p className="text-xs text-red-500 font-semibold mt-1">Com Débito CGADB</p>
        </div>
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-center">
          <p className="text-2xl font-bold text-green-600">{ministros.length - totalComDebito}</p>
          <p className="text-xs text-green-500 font-semibold mt-1">Sem Débito</p>
        </div>
        <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 text-center">
          <p className="text-2xl font-bold text-orange-600">
            {formatValor(ministros.reduce((acc, m) => acc + m.totalDevido, 0))}
          </p>
          <p className="text-xs text-orange-500 font-semibold mt-1">Total em Débito</p>
        </div>
      </div>

      {/* Filtros — barra única */}
      <div className="flex flex-wrap items-center gap-2 mb-4 p-3 bg-gray-50 border border-gray-200 rounded-2xl shadow-sm">
        <select
          value={filtroSupervisao}
          onChange={e => { setFiltroSupervisao(e.target.value); resetPage(); }}
          className="flex-1 min-w-[160px] px-3 py-2.5 bg-white border border-gray-200 rounded-xl text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-[#0D2B4E] focus:border-[#0D2B4E] transition"
        >
          <option value="">Todas as Supervisões</option>
          {supervisoes.map(s => <option key={s} value={s}>{s}</option>)}
        </select>

        <select
          value={filtroCampo}
          onChange={e => { setFiltroCampo(e.target.value); resetPage(); }}
          className="flex-1 min-w-[140px] px-3 py-2.5 bg-white border border-gray-200 rounded-xl text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-[#0D2B4E] focus:border-[#0D2B4E] transition"
        >
          <option value="">Todos os Campos</option>
          {campos.map(c => <option key={c} value={c}>{c}</option>)}
        </select>

        <div className="relative flex-[2] min-w-[180px]">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm pointer-events-none">🔍</span>
          <input
            type="text"
            placeholder="Buscar por nome ou CPF..."
            value={filtroBusca}
            onChange={e => { setFiltroBusca(e.target.value); resetPage(); }}
            className="w-full pl-9 pr-9 py-2.5 bg-white border border-gray-200 rounded-xl text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-[#0D2B4E] focus:border-[#0D2B4E] transition"
          />
          {filtroBusca && (
            <button onClick={() => { setFiltroBusca(''); resetPage(); }}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition text-base leading-none"
              title="Limpar busca">✕</button>
          )}
        </div>

        <select
          value={filtroStatus}
          onChange={e => { setFiltroStatus(e.target.value as any); resetPage(); }}
          className="flex-1 min-w-[120px] px-3 py-2.5 bg-white border border-gray-200 rounded-xl text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-[#0D2B4E] focus:border-[#0D2B4E] transition"
        >
          <option value="todos">Todos</option>
          <option value="com_debito">Com Débito</option>
          <option value="sem_debito">Sem Débito</option>
        </select>

        <div className="hidden sm:block w-px h-8 bg-gray-200 shrink-0" />

        <label className="shrink-0 flex items-center gap-2 cursor-pointer select-none bg-white border border-gray-200 rounded-xl px-4 py-2.5 shadow-sm hover:border-[#0D2B4E] transition">
          <input
            type="checkbox"
            checked={apenasNaoRegistrados}
            onChange={e => { setApenasNaoRegistrados(e.target.checked); resetPage(); }}
            className="w-4 h-4 accent-[#0D2B4E] cursor-pointer"
          />
          <span className="text-xs font-semibold text-gray-700 whitespace-nowrap">Sem Registro na CGADB</span>
        </label>
      </div>

      {/* Contagem + controle de página */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <p className="text-xs text-gray-500">{filtered.length} ministro(s) encontrado(s) — página {currentPage} de {totalPages || 1}</p>
        <div className="flex items-center gap-2">
          <button
            onClick={handlePrint}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#0D2B4E] text-white hover:bg-[#1A3A5C] transition"
          >
            🖨️ Imprimir
          </button>
          <span className="text-xs text-gray-400">|</span>
          <span className="text-xs text-gray-500">Exibir:</span>
          {[20, 30, 50, 100].map(n => (
            <button key={n} onClick={() => { setPageSize(n); setCurrentPage(1); }}
              className={`px-2.5 py-1 text-xs rounded font-semibold border transition ${pageSize === n ? 'bg-[#0D2B4E] text-white border-[#0D2B4E]' : 'bg-white text-gray-600 border-gray-300 hover:border-[#0D2B4E]'}`}>
              {n}
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-16 gap-3">
          <div className="w-6 h-6 border-4 border-teal-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-gray-400">Carregando...</p>
        </div>
      )}

      {/* Tabela */}
      {!loading && (
        <div className="overflow-x-auto rounded-xl border border-gray-200 shadow-sm">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-gradient-to-r from-gray-700 to-gray-800 text-white">
                <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wide">Nome</th>
                <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wide">CPF</th>
                <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wide">Supervisão</th>
                <th className="text-center px-4 py-3 font-semibold text-xs uppercase tracking-wide">Anos em Débito</th>
                <th className="text-right px-4 py-3 font-semibold text-xs uppercase tracking-wide">Total Devido</th>
                <th className="text-center px-4 py-3 font-semibold text-xs uppercase tracking-wide">Status</th>
                <th className="text-center px-4 py-3 font-semibold text-xs uppercase tracking-wide">CGADB</th>
                <th className="text-center px-4 py-3 font-semibold text-xs uppercase tracking-wide">Detalhes</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center py-10 text-gray-400">
                    Nenhum ministro encontrado.
                  </td>
                </tr>
              )}
              {paginated.map((m, idx) => (
                <React.Fragment key={m.id}>
                  <tr className={`border-b border-gray-100 cursor-pointer transition-colors ${
                    m.debitos.length > 0
                      ? 'bg-red-50/60 hover:bg-red-50'
                      : idx % 2 === 0 ? 'bg-white hover:bg-gray-50' : 'bg-gray-50/60 hover:bg-gray-100'
                  }`}>
                    <td className="px-4 py-3 font-medium text-gray-800">{m.nome}</td>
                    <td className="px-4 py-3 text-gray-600 font-mono text-xs">{formatCpfDisplay(m.cpf)}</td>
                    <td className="px-4 py-3 text-gray-600 text-xs">{m.supervisao || '—'}</td>
                    <td className="px-4 py-3 text-center">
                      {m.anosDebito.length > 0 ? (
                        <span className="text-xs font-semibold text-red-600">
                          {m.anosDebito.join(', ')}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold">
                      {m.totalDevido > 0 ? (
                        <span className="text-red-600">{formatValor(m.totalDevido)}</span>
                      ) : (
                        <span className="text-green-600">Em dia</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`px-2 py-1 rounded-full text-xs font-semibold ${
                        m.status.toUpperCase() === 'ATIVO'
                          ? 'bg-green-100 text-green-700'
                          : 'bg-red-100 text-red-700'
                      }`}>{m.status.toUpperCase() || '—'}</span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {m.debitos.length > 0
                        ? <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-red-100 text-red-700">REGISTRADO</span>
                        : <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-gray-100 text-gray-500">NÃO REGISTRADO</span>
                      }
                    </td>
                    <td className="px-4 py-3 text-center">
                      {m.debitos.length > 0 && (
                        <button
                          onClick={() => setExpandedId(expandedId === m.id ? null : m.id)}
                          className="text-teal-600 hover:text-teal-800 text-xs font-semibold"
                        >
                          {expandedId === m.id ? '▲ Fechar' : '▼ Ver'}
                        </button>
                      )}
                    </td>
                  </tr>

                  {/* Linha expandida com detalhes dos débitos */}
                  {expandedId === m.id && (
                    <tr key={`${m.id}-detail`} className="bg-red-50 border-b border-red-100">
                      <td colSpan={8} className="px-6 py-4">
                        <p className="text-xs font-semibold text-gray-600 mb-2">Detalhamento dos débitos CGADB:</p>
                        <table className="w-full text-xs border-collapse">
                          <thead>
                            <tr className="bg-white border border-gray-200">
                              <th className="text-left px-3 py-2 font-semibold text-gray-500">Convenção</th>
                              <th className="text-center px-3 py-2 font-semibold text-gray-500">Ano</th>
                              <th className="text-right px-3 py-2 font-semibold text-gray-500">Valor</th>
                              <th className="text-center px-3 py-2 font-semibold text-gray-500">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {m.debitos.map(d => (
                              <tr key={d.id} className="border-b border-gray-100 bg-white">
                                <td className="px-3 py-2 text-gray-700">{d.convencao || '—'}</td>
                                <td className="px-3 py-2 text-center text-gray-700">{d.ano || '—'}</td>
                                <td className="px-3 py-2 text-right text-red-600 font-semibold">{formatValor(d.valor)}</td>
                                <td className="px-3 py-2 text-center">
                                  <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded-full text-xs">{d.status || '—'}</span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Paginação */}
      {!loading && totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 flex-wrap gap-2">
          <p className="text-xs text-gray-500">
            Mostrando {((currentPage - 1) * pageSize) + 1}–{Math.min(currentPage * pageSize, filtered.length)} de {filtered.length}
          </p>
          <div className="flex items-center gap-1">
            <button onClick={() => setCurrentPage(1)} disabled={currentPage === 1}
              className="px-2 py-1 text-xs border rounded disabled:opacity-40 hover:bg-gray-100">«</button>
            <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}
              className="px-2 py-1 text-xs border rounded disabled:opacity-40 hover:bg-gray-100">‹</button>
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              const start = Math.max(1, Math.min(currentPage - 2, totalPages - 4));
              const page = start + i;
              return (
                <button key={page} onClick={() => setCurrentPage(page)}
                  className={`px-2.5 py-1 text-xs border rounded font-semibold ${currentPage === page ? 'bg-[#0D2B4E] text-white border-[#0D2B4E]' : 'hover:bg-gray-100'}`}>
                  {page}
                </button>
              );
            })}
            <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}
              className="px-2 py-1 text-xs border rounded disabled:opacity-40 hover:bg-gray-100">›</button>
            <button onClick={() => setCurrentPage(totalPages)} disabled={currentPage === totalPages}
              className="px-2 py-1 text-xs border rounded disabled:opacity-40 hover:bg-gray-100">»</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Aba 2: Débito CGADB (com upload CSV) ─────────────────────────────────────

function AbaDebitos({ notify }: { notify: (t: string, m: string, tp: 'success' | 'error' | 'warning' | 'info') => void }) {
  const supabase = createClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [debitos, setDebitos] = useState<DebitoCgadb[]>([]);
  const [membersSet, setMembersSet] = useState<Set<string>>(new Set());
  const [filtroBusca, setFiltroBusca] = useState('');
  const [lastImport, setLastImport] = useState<string | null>(null);
  const [expandedCpf, setExpandedCpf] = useState<string | null>(null);
  const [apenasNaoCadastrados, setApenasNaoCadastrados] = useState(false);
  const [editCpf, setEditCpf] = useState<{ oldCpf: string; nome: string; value: string } | null>(null);
  const [savingCpf, setSavingCpf] = useState(false);

  async function handleSaveCpf() {
    if (!editCpf) return;
    const newCpf = editCpf.value.replace(/\D/g, '');
    if (newCpf.length < 3) {
      notify('CPF inválido', 'Digite um CPF válido.', 'warning');
      return;
    }
    setSavingCpf(true);
    try {
      const oldKey = normalizeCpf(editCpf.oldCpf);
      // Atualiza todos os registros da tabela cgadb_debitos com o CPF antigo
      const ids = debitos.filter(d => normalizeCpf(d.cpf) === oldKey).map(d => d.id);
      for (const id of ids) {
        const { error } = await supabase.from('cgadb_debitos').update({ cpf: newCpf }).eq('id', id);
        if (error) throw error;
      }
      notify('CPF atualizado', `CPF de ${editCpf.nome} atualizado com sucesso.`, 'success');
      setEditCpf(null);
      await loadDebitos();
    } catch (err: any) {
      notify('Erro', 'Erro ao atualizar CPF: ' + (err?.message || ''), 'error');
    } finally {
      setSavingCpf(false);
    }
  }

  useEffect(() => {
    loadDebitos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadDebitos() {
    try {
      setLoading(true);
      // Carrega todos em lotes (Supabase limita 1000/query)
      const allDebitos: DebitoCgadb[] = [];
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from('cgadb_debitos')
          .select('*')
          .order('nome', { ascending: true })
          .range(from, from + 999);
        if (error) throw error;
        if (!data || data.length === 0) break;
        allDebitos.push(...(data as DebitoCgadb[]));
        if (data.length < 1000) break;
        from += 1000;
      }
      setDebitos(allDebitos);

      // Carrega CPFs dos ministros cadastrados no COMIEADEPA
      const cpfSet = new Set<string>();
      let mFrom = 0;
      while (true) {
        const { data: mData, error: mError } = await supabase
          .from('members')
          .select('cpf')
          .range(mFrom, mFrom + 999);
        if (mError) break;
        if (!mData || mData.length === 0) break;
        for (const row of mData) {
          if (row.cpf) cpfSet.add(normalizeCpf(row.cpf));
        }
        if (mData.length < 1000) break;
        mFrom += 1000;
      }
      setMembersSet(cpfSet);

      // Data da última importação
      if (allDebitos.length > 0) {
        const last = allDebitos.reduce((a, b) =>
          new Date(a.imported_at) > new Date(b.imported_at) ? a : b
        );
        setLastImport(last.imported_at);
      }
    } catch (err: any) {
      notify('Erro', 'Erro ao carregar débitos: ' + (err?.message || ''), 'error');
    } finally {
      setLoading(false);
    }
  }

  async function deleteAll() {
    setDeleting(true);
    try {
      const { error } = await supabase.from('cgadb_debitos').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      if (error) throw error;
      setDebitos([]);
      setLastImport(null);
      setExpandedCpf(null);
      setConfirmDelete(false);
      notify('Dados apagados', 'Todos os débitos foram removidos da tabela.', 'success');
    } catch (err: any) {
      notify('Erro', 'Erro ao apagar dados: ' + (err?.message || ''), 'error');
    } finally {
      setDeleting(false);
    }
  }

  async function processFile(file: File) {
    if (!file || !file.name.toLowerCase().endsWith('.csv')) {
      notify('Formato inválido', 'Selecione um arquivo .CSV', 'warning');
      return;
    }

    setUploading(true);

    try {
      const text = await file.text();
      const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
      if (lines.length < 2) {
        notify('Arquivo vazio', 'O CSV não contém dados.', 'warning');
        return;
      }

      const sep = detectSep(lines[0]);
      const headers = parseCsvLine(lines[0], sep).map(h => h.toLowerCase().trim());

      // Mapear índices das colunas (aceita variações de cabeçalho)
      const idxCpf = headers.findIndex(h => h.includes('cpf'));
      const idxReg = headers.findIndex(h => h.includes('registro'));
      const idxNome = headers.findIndex(h => h.includes('nome'));
      const idxConv = headers.findIndex(h => h.includes('conven'));
      const idxAno = headers.findIndex(h => h === 'ano' || h.includes('ano'));
      const idxValor = headers.findIndex(h => h.includes('valor'));
      const idxStatus = headers.findIndex(h => h.includes('status'));

      if (idxCpf === -1 || idxNome === -1) {
        notify('CSV inválido', 'O arquivo deve conter as colunas CPF e NOME.', 'error');
        return;
      }

      const rows: object[] = [];
      for (let i = 1; i < lines.length; i++) {
        const cols = parseCsvLine(lines[i], sep);
        const cpfRaw = idxCpf >= 0 ? cols[idxCpf] : '';
        const cpfNorm = normalizeCpf(cpfRaw);
        if (!cpfNorm || cpfNorm.length < 3) continue; // pula linhas sem CPF

        const valorRaw = idxValor >= 0 ? cols[idxValor] : '';
        const valor = valorRaw ? parseValor(valorRaw) : null;
        const anoRaw = idxAno >= 0 ? cols[idxAno] : '';
        const ano = anoRaw ? parseInt(anoRaw, 10) || null : null;

        rows.push({
          cpf: cpfNorm,
          registro: idxReg >= 0 ? cols[idxReg] || null : null,
          nome: idxNome >= 0 ? cols[idxNome] || '' : '',
          convencao: idxConv >= 0 ? cols[idxConv] || null : null,
          ano,
          valor,
          status: idxStatus >= 0 ? cols[idxStatus] || null : null,
          imported_at: new Date().toISOString(),
        });
      }

      if (rows.length === 0) {
        notify('Sem dados', 'Nenhuma linha válida encontrada no CSV.', 'warning');
        return;
      }

      // Desduplicar pelo par (cpf, ano) — mantém última ocorrência
      const seen = new Map<string, object>();
      for (const r of rows) {
        const key = `${(r as any).cpf}__${(r as any).ano ?? ''}`;
        seen.set(key, r);
      }
      const deduped = Array.from(seen.values());

      // Upsert em lotes de 500
      const BATCH = 500;
      let upserted = 0;
      for (let i = 0; i < deduped.length; i += BATCH) {
        const batch = deduped.slice(i, i + BATCH);
        const { error } = await supabase
          .from('cgadb_debitos')
          .upsert(batch as any[], { onConflict: 'cpf,ano', ignoreDuplicates: false });
        if (error) throw error;
        upserted += batch.length;
      }

      notify('Importação concluída', `${upserted} registro(s) importados com sucesso!`, 'success');
      await loadDebitos();
    } catch (err: any) {
      notify('Erro na importação', err?.message || 'Erro desconhecido', 'error');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  }

  const [isDragging, setIsDragging] = useState(false);

  // Agrupar débitos por CPF (um card/linha por ministro)
  const busca = filtroBusca.toLowerCase();
  const grouped = (() => {
    const map = new Map<string, { cpf: string; registro: string | null; nome: string; debitos: DebitoCgadb[]; total: number }>();
    for (const d of debitos) {
      const key = normalizeCpf(d.cpf);
      if (!map.has(key)) map.set(key, { cpf: d.cpf, registro: d.registro, nome: d.nome, debitos: [], total: 0 });
      const entry = map.get(key)!;
      entry.debitos.push(d);
      entry.total += d.valor || 0;
    }
    return Array.from(map.values()).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  })();

  const filtered = grouped.filter(g => {
    if (apenasNaoCadastrados && membersSet.has(normalizeCpf(g.cpf))) return false;
    if (!busca) return true;
    const cpfBusca = busca.replace(/\D/g, '');
    return g.nome.toLowerCase().includes(busca) || (cpfBusca.length > 0 && normalizeCpf(g.cpf).includes(cpfBusca));
  });

  const [pageSize, setPageSize] = useState(20);
  const [currentPage, setCurrentPage] = useState(1);
  const totalPages = Math.ceil(filtered.length / pageSize);
  const paginated = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  function resetPage() { setCurrentPage(1); }

  const totalDivida = filtered.reduce((sum, g) => sum + g.total, 0);

  return (
    <div>
      {/* Área de upload */}
      {/* Upload */}
      <div
        onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`relative border-2 border-dashed rounded-2xl p-6 mb-6 text-center cursor-pointer transition-all ${
          isDragging
            ? 'border-teal-500 bg-teal-50 scale-[1.01]'
            : 'border-gray-300 bg-gradient-to-br from-gray-50 to-white hover:border-teal-400 hover:bg-teal-50/30'
        }`}
      >
        <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleFileChange} />
        {uploading ? (
          <div className="flex flex-col items-center gap-2 py-2">
            <div className="w-8 h-8 border-4 border-teal-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-teal-600 font-semibold text-sm">Importando dados...</p>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4 text-left">
              <div className="w-12 h-12 bg-teal-100 rounded-xl flex items-center justify-center text-2xl shrink-0">📂</div>
              <div>
                <p className="text-gray-800 font-semibold text-sm">Importar CSV da CGADB</p>
                <p className="text-gray-400 text-xs mt-0.5">Colunas esperadas: CPF, REGISTRO, NOME, CONVENÇÃO, ANO, VALOR, STATUS</p>
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div className="flex items-center gap-2 justify-end">
                <span className="inline-block px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold rounded-lg transition">
                  Selecionar arquivo
                </span>
                {debitos.length > 0 && !confirmDelete && (
                  <button
                    type="button"
                    onClick={e => { e.stopPropagation(); setConfirmDelete(true); }}
                    className="px-4 py-2 bg-red-100 hover:bg-red-200 text-red-700 text-xs font-semibold rounded-lg transition"
                  >
                    🗑 Apagar tudo
                  </button>
                )}
                {confirmDelete && (
                  <div className="flex items-center gap-2 bg-red-50 border border-red-300 rounded-lg px-3 py-1.5" onClick={e => e.stopPropagation()}>
                    <span className="text-xs text-red-700 font-semibold">Confirmar exclusão?</span>
                    <button
                      type="button"
                      disabled={deleting}
                      onClick={e => { e.stopPropagation(); deleteAll(); }}
                      className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded transition disabled:opacity-60"
                    >
                      {deleting ? 'Apagando...' : 'Sim, apagar'}
                    </button>
                    <button
                      type="button"
                      onClick={e => { e.stopPropagation(); setConfirmDelete(false); }}
                      className="px-3 py-1 bg-gray-200 hover:bg-gray-300 text-gray-700 text-xs font-semibold rounded transition"
                    >
                      Cancelar
                    </button>
                  </div>
                )}
              </div>
              {lastImport && (
                <p className="text-xs text-gray-400 mt-1.5">
                  Última importação: {new Date(lastImport).toLocaleString('pt-BR')}
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Filtro + contagem */}
      <div className="flex flex-wrap items-center gap-3 mb-4 p-3 bg-gray-50 border border-gray-200 rounded-2xl shadow-sm">
        {/* Campo de busca */}
        <div className="relative flex-1 min-w-[220px]">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm pointer-events-none">🔍</span>
          <input
            type="text"
            placeholder="Buscar por nome ou CPF..."
            value={filtroBusca}
            onChange={e => { setFiltroBusca(e.target.value); resetPage(); }}
            className="w-full pl-9 pr-9 py-2.5 bg-white border border-gray-200 rounded-xl text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-[#0D2B4E] focus:border-[#0D2B4E] transition"
          />
          {filtroBusca && (
            <button onClick={() => { setFiltroBusca(''); resetPage(); }}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition text-base leading-none"
              title="Limpar busca">✕</button>
          )}
        </div>

        {/* Checkbox Sem Registro */}
        <label className="shrink-0 flex items-center gap-2 cursor-pointer select-none bg-white border border-gray-200 rounded-xl px-4 py-2.5 shadow-sm hover:border-[#0D2B4E] transition">
          <input
            type="checkbox"
            checked={apenasNaoCadastrados}
            onChange={e => { setApenasNaoCadastrados(e.target.checked); resetPage(); }}
            className="w-4 h-4 accent-[#0D2B4E] cursor-pointer"
          />
          <span className="text-xs font-semibold text-gray-700 whitespace-nowrap">Sem Registro na COMIEADEPA</span>
        </label>

        {/* Divisor */}
        <div className="hidden sm:block w-px h-8 bg-gray-200" />

        {/* Contadores */}
        <div className="flex items-center gap-2">
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-2 text-center min-w-[72px]">
            <p className="text-lg font-bold text-red-600 leading-none">{filtered.length}</p>
            <p className="text-xs text-red-400 mt-0.5">ministro(s)</p>
          </div>
          <div className="bg-orange-50 border border-orange-200 rounded-xl px-4 py-2 text-center">
            <p className="text-base font-bold text-orange-600 leading-none">{formatValor(totalDivida)}</p>
            <p className="text-xs text-orange-400 mt-0.5">total em débito</p>
          </div>
        </div>
      </div>

      {/* Controle de itens por página */}
      {!loading && filtered.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <p className="text-xs text-gray-500">{filtered.length} ministro(s) com débito — página {currentPage} de {totalPages || 1}</p>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">Exibir:</span>
            {[20, 30, 50, 100].map(n => (
              <button key={n} onClick={() => { setPageSize(n); setCurrentPage(1); }}
                className={`px-2.5 py-1 text-xs rounded font-semibold border transition ${pageSize === n ? 'bg-[#0D2B4E] text-white border-[#0D2B4E]' : 'bg-white text-gray-600 border-gray-300 hover:border-[#0D2B4E]'}`}>
                {n}
              </button>
            ))}
          </div>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-16 gap-3">
          <div className="w-6 h-6 border-4 border-teal-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-gray-400">Carregando...</p>
        </div>
      )}

      {/* Tabela */}
      {!loading && (
        <div className="overflow-x-auto rounded-xl border border-gray-200 shadow-sm">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-gradient-to-r from-gray-700 to-gray-800 text-white">
                <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wide">CPF</th>
                <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wide">Registro</th>
                <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wide">Nome</th>
                <th className="text-center px-4 py-3 font-semibold text-xs uppercase tracking-wide">Anos em Débito</th>
                <th className="text-right px-4 py-3 font-semibold text-xs uppercase tracking-wide">Total Devido</th>
                <th className="text-center px-4 py-3 font-semibold text-xs uppercase tracking-wide">Status CGADB</th>
                <th className="text-center px-4 py-3 font-semibold text-xs uppercase tracking-wide">COMIEADEPA</th>
                <th className="text-center px-4 py-3 font-semibold text-xs uppercase tracking-wide">Detalhes</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center py-16 text-gray-400">
                    <p className="text-3xl mb-2">📋</p>
                    <p className="font-medium">{debitos.length === 0 ? 'Nenhum dado importado ainda.' : 'Nenhum ministro encontrado.'}</p>
                    <p className="text-xs mt-1">{debitos.length === 0 ? 'Faça o upload do CSV da CGADB acima.' : 'Tente outro nome ou CPF.'}</p>
                  </td>
                </tr>
              )}
              {paginated.map((g, idx) => {
                const cpfKey = normalizeCpf(g.cpf);
                const isExpanded = expandedCpf === cpfKey;
                const anos = g.debitos.map(d => d.ano).filter(Boolean).sort((a, b) => (b ?? 0) - (a ?? 0));
                const statusCgadb = (g.debitos[0]?.status || '').toUpperCase();
                return (
                  <React.Fragment key={cpfKey}>
                    <tr
                      onClick={() => setExpandedCpf(isExpanded ? null : cpfKey)}
                      className={`border-b border-gray-100 cursor-pointer transition-colors ${
                        isExpanded ? 'bg-red-50' : idx % 2 === 0 ? 'bg-white hover:bg-red-50/50' : 'bg-gray-50/60 hover:bg-red-50/50'
                      }`}
                    >
                      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-xs text-gray-500">{formatCpfDisplay(g.cpf)}</span>
                          <button
                            onClick={() => setEditCpf({ oldCpf: g.cpf, nome: g.nome, value: g.cpf })}
                            className="text-blue-400 hover:text-blue-600 transition" title="Editar CPF"
                          >✏️</button>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-600 text-xs">{g.registro || '—'}</td>
                      <td className="px-4 py-3 font-semibold text-gray-800">{g.nome}</td>
                      <td className="px-4 py-3 text-center">
                        {anos.length > 0 ? (
                          <div className="flex flex-wrap gap-1 justify-center">
                            {anos.map(a => (
                              <span key={a} className="px-1.5 py-0.5 bg-red-100 text-red-700 rounded text-xs font-semibold">{a}</span>
                            ))}
                          </div>
                        ) : <span className="text-gray-400">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-red-600 text-sm">{formatValor(g.total)}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                          statusCgadb === 'INATIVO' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'
                        }`}>{statusCgadb || '—'}</span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {membersSet.has(normalizeCpf(g.cpf))
                          ? <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-green-100 text-green-700">REGISTRADO</span>
                          : <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-gray-100 text-gray-500">SEM REGISTRO</span>
                        }
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold transition ${
                          isExpanded ? 'bg-teal-100 text-teal-700' : 'bg-gray-100 text-gray-600 hover:bg-teal-50 hover:text-teal-600'
                        }`}>
                          {isExpanded ? '▲ Fechar' : '▼ Ver'}
                        </span>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={8} className="px-8 py-4 bg-red-50 border-b border-red-100">
                          <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Débitos por ano</p>
                          <table className="w-full text-xs border-collapse rounded-lg overflow-hidden">
                            <thead>
                              <tr className="bg-gray-700 text-white">
                                <th className="text-left px-3 py-2 font-semibold">Convenção</th>
                                <th className="text-center px-3 py-2 font-semibold">Ano</th>
                                <th className="text-right px-3 py-2 font-semibold">Valor</th>
                                <th className="text-center px-3 py-2 font-semibold">Status</th>
                              </tr>
                            </thead>
                            <tbody>
                              {g.debitos
                                .slice()
                                .sort((a, b) => (b.ano ?? 0) - (a.ano ?? 0))
                                .map((d, di) => (
                                  <tr key={d.id} className={`border-b border-gray-100 ${di % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>
                                    <td className="px-3 py-2 text-gray-700">{d.convencao || '—'}</td>
                                    <td className="px-3 py-2 text-center font-semibold text-gray-700">{d.ano || '—'}</td>
                                    <td className="px-3 py-2 text-right text-red-600 font-bold">{formatValor(d.valor)}</td>
                                    <td className="px-3 py-2 text-center">
                                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                                        (d.status || '').toUpperCase() === 'INATIVO'
                                          ? 'bg-red-100 text-red-700'
                                          : 'bg-yellow-100 text-yellow-700'
                                      }`}>{d.status || '—'}</span>
                                    </td>
                                  </tr>
                                ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Paginação */}
      {!loading && totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 flex-wrap gap-2">
          <p className="text-xs text-gray-500">
            Mostrando {((currentPage - 1) * pageSize) + 1}–{Math.min(currentPage * pageSize, filtered.length)} de {filtered.length}
          </p>
          <div className="flex items-center gap-1">
            <button onClick={() => setCurrentPage(1)} disabled={currentPage === 1}
              className="px-2 py-1 text-xs border rounded disabled:opacity-40 hover:bg-gray-100">«</button>
            <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}
              className="px-2 py-1 text-xs border rounded disabled:opacity-40 hover:bg-gray-100">‹</button>
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              const start = Math.max(1, Math.min(currentPage - 2, totalPages - 4));
              const page = start + i;
              return (
                <button key={page} onClick={() => setCurrentPage(page)}
                  className={`px-2.5 py-1 text-xs border rounded font-semibold ${currentPage === page ? 'bg-[#0D2B4E] text-white border-[#0D2B4E]' : 'hover:bg-gray-100'}`}>
                  {page}
                </button>
              );
            })}
            <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}
              className="px-2 py-1 text-xs border rounded disabled:opacity-40 hover:bg-gray-100">›</button>
            <button onClick={() => setCurrentPage(totalPages)} disabled={currentPage === totalPages}
              className="px-2 py-1 text-xs border rounded disabled:opacity-40 hover:bg-gray-100">»</button>
          </div>
        </div>
      )}

      {/* Modal edição de CPF */}
      {editCpf && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setEditCpf(null)}>
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm mx-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-gray-800 mb-1">Editar CPF</h3>
            <p className="text-xs text-gray-500 mb-4">{editCpf.nome}</p>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Novo CPF</label>
            <input
              type="text"
              value={editCpf.value}
              onChange={e => setEditCpf(prev => prev ? { ...prev, value: e.target.value } : null)}
              placeholder="000.000.000-00"
              maxLength={14}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#0D2B4E] mb-4"
              autoFocus
              onKeyDown={e => { if (e.key === 'Enter') handleSaveCpf(); if (e.key === 'Escape') setEditCpf(null); }}
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setEditCpf(null)}
                className="px-4 py-2 text-xs rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 transition">
                Cancelar
              </button>
              <button onClick={handleSaveCpf} disabled={savingCpf}
                className="px-4 py-2 text-xs rounded-lg bg-[#0D2B4E] text-white font-semibold hover:bg-[#1A3A5C] disabled:opacity-60 transition">
                {savingCpf ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
