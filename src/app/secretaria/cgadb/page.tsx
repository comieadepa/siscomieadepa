'use client';

import { useState, useEffect, useRef } from 'react';
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
  status: string;
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
            {activeTab === 'ministros' && <AbaMinistros notify={notify} />}
            {activeTab === 'debitos' && <AbaDebitos notify={notify} />}
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

  // Expandir detalhes de débito por ministro
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load() {
    try {
      setLoading(true);

      // Carregar ministros e débitos em paralelo
      const [membrosRes, debitosRes] = await Promise.all([
        supabase
          .from('members')
          .select('id, name, cpf, status, tipo_cadastro, custom_fields')
          .in('tipo_cadastro', ['ministro'])
          .order('name'),
        supabase
          .from('cgadb_debitos')
          .select('*')
          .order('ano', { ascending: false }),
      ]);

      if (membrosRes.error) throw membrosRes.error;

      const membros = (membrosRes.data || []) as any[];
      const debitos = (debitosRes.data || []) as DebitoCgadb[];

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
          status: String(m.status || ''),
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

  // Filtrar lista
  const busca = filtroBusca.toLowerCase();
  const filtered = ministros.filter(m => {
    if (filtroSupervisao && m.supervisao !== filtroSupervisao) return false;
    if (filtroCampo && m.campo !== filtroCampo) return false;
    if (busca && !m.nome.toLowerCase().includes(busca) && !normalizeCpf(m.cpf).includes(busca.replace(/\D/g, ''))) return false;
    if (filtroStatus === 'com_debito' && m.debitos.length === 0) return false;
    if (filtroStatus === 'sem_debito' && m.debitos.length > 0) return false;
    return true;
  });

  const totalComDebito = ministros.filter(m => m.debitos.length > 0).length;

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

      {/* Filtros */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
        <select
          value={filtroSupervisao}
          onChange={e => setFiltroSupervisao(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
        >
          <option value="">Todas as Supervisões</option>
          {supervisoes.map(s => <option key={s} value={s}>{s}</option>)}
        </select>

        <select
          value={filtroCampo}
          onChange={e => setFiltroCampo(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
        >
          <option value="">Todos os Campos</option>
          {campos.map(c => <option key={c} value={c}>{c}</option>)}
        </select>

        <input
          type="text"
          placeholder="Buscar por nome ou CPF..."
          value={filtroBusca}
          onChange={e => setFiltroBusca(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
        />

        <select
          value={filtroStatus}
          onChange={e => setFiltroStatus(e.target.value as any)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
        >
          <option value="todos">Todos</option>
          <option value="com_debito">Com Débito</option>
          <option value="sem_debito">Sem Débito</option>
        </select>
      </div>

      {/* Contagem */}
      <p className="text-xs text-gray-500 mb-3">{filtered.length} ministro(s) encontrado(s)</p>

      {loading && <p className="text-sm text-gray-400 py-8 text-center">Carregando...</p>}

      {/* Tabela */}
      {!loading && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Nome</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">CPF</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Supervisão</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Campo</th>
                <th className="text-center px-4 py-3 font-semibold text-gray-600">Anos em Débito</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-600">Total Devido</th>
                <th className="text-center px-4 py-3 font-semibold text-gray-600">Situação CGADB</th>
                <th className="text-center px-4 py-3 font-semibold text-gray-600">Detalhes</th>
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
              {filtered.map(m => (
                <>
                  <tr key={m.id} className={`border-b border-gray-100 hover:bg-gray-50 transition ${m.debitos.length > 0 ? 'bg-red-50/40' : ''}`}>
                    <td className="px-4 py-3 font-medium text-gray-800">{m.nome}</td>
                    <td className="px-4 py-3 text-gray-600 font-mono text-xs">{formatCpfDisplay(m.cpf)}</td>
                    <td className="px-4 py-3 text-gray-600 text-xs">{m.supervisao || '—'}</td>
                    <td className="px-4 py-3 text-gray-600 text-xs">{m.campo || '—'}</td>
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
                      {m.debitos.length > 0 ? (
                        <span className="px-2 py-1 bg-red-100 text-red-700 rounded-full text-xs font-semibold">
                          INADIMPLENTE
                        </span>
                      ) : (
                        <span className="px-2 py-1 bg-green-100 text-green-700 rounded-full text-xs font-semibold">
                          REGULAR
                        </span>
                      )}
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
                </>
              ))}
            </tbody>
          </table>
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
  const [debitos, setDebitos] = useState<DebitoCgadb[]>([]);
  const [filtroBusca, setFiltroBusca] = useState('');
  const [lastImport, setLastImport] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    loadDebitos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadDebitos() {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('cgadb_debitos')
        .select('*')
        .order('nome', { ascending: true });
      if (error) throw error;
      setDebitos((data || []) as DebitoCgadb[]);

      // Data da última importação
      if (data && data.length > 0) {
        const last = (data as DebitoCgadb[]).reduce((a, b) =>
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
        const valor = valorRaw
          ? parseFloat(valorRaw.replace(/\./g, '').replace(',', '.')) || null
          : null;
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

      // Upsert em lotes de 500
      const BATCH = 500;
      let upserted = 0;
      for (let i = 0; i < rows.length; i += BATCH) {
        const batch = rows.slice(i, i + BATCH);
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

  // Filtrar
  const busca = filtroBusca.toLowerCase();
  const filtered = debitos.filter(d => {
    if (!busca) return true;
    return (
      d.nome.toLowerCase().includes(busca) ||
      normalizeCpf(d.cpf).includes(busca.replace(/\D/g, ''))
    );
  });

  return (
    <div>
      {/* Área de upload */}
      <div
        onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={`border-2 border-dashed rounded-xl p-8 mb-6 text-center transition cursor-pointer ${
          isDragging ? 'border-teal-500 bg-teal-50' : 'border-gray-300 bg-gray-50 hover:border-teal-400 hover:bg-teal-50/50'
        }`}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={handleFileChange}
        />
        {uploading ? (
          <div>
            <div className="w-10 h-10 border-4 border-teal-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-teal-600 font-semibold">Importando...</p>
          </div>
        ) : (
          <div>
            <p className="text-4xl mb-3">📂</p>
            <p className="text-gray-700 font-semibold">Arraste o arquivo CSV ou clique para selecionar</p>
            <p className="text-gray-400 text-sm mt-1">Arquivo gerado pela CGADB com colunas: CPF, REGISTRO, NOME, CONVENÇÃO, ANO, VALOR, STATUS</p>
            {lastImport && (
              <p className="text-xs text-gray-400 mt-3">
                Última importação: {new Date(lastImport).toLocaleString('pt-BR')}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Filtro */}
      <div className="flex gap-3 mb-4">
        <input
          type="text"
          placeholder="Buscar por nome ou CPF..."
          value={filtroBusca}
          onChange={e => setFiltroBusca(e.target.value)}
          className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
        />
      </div>

      <p className="text-xs text-gray-500 mb-3">{filtered.length} registro(s) encontrado(s)</p>

      {loading && <p className="text-sm text-gray-400 py-8 text-center">Carregando...</p>}

      {/* Tabela */}
      {!loading && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-3 font-semibold text-gray-600">CPF</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Registro</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Nome</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Convenção</th>
                <th className="text-center px-4 py-3 font-semibold text-gray-600">Ano</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-600">Valor</th>
                <th className="text-center px-4 py-3 font-semibold text-gray-600">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center py-10 text-gray-400">
                    {debitos.length === 0
                      ? 'Nenhum dado importado ainda. Faça o upload do CSV da CGADB.'
                      : 'Nenhum registro encontrado para o filtro.'}
                  </td>
                </tr>
              )}
              {filtered.map(d => (
                <tr key={d.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs text-gray-600">{formatCpfDisplay(d.cpf)}</td>
                  <td className="px-4 py-3 text-gray-600">{d.registro || '—'}</td>
                  <td className="px-4 py-3 font-medium text-gray-800">{d.nome}</td>
                  <td className="px-4 py-3 text-gray-600 text-xs">{d.convencao || '—'}</td>
                  <td className="px-4 py-3 text-center text-gray-700">{d.ano || '—'}</td>
                  <td className="px-4 py-3 text-right font-semibold text-red-600">{formatValor(d.valor)}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2 py-1 rounded-full text-xs font-semibold ${
                      (d.status || '').toUpperCase() === 'INATIVO'
                        ? 'bg-red-100 text-red-700'
                        : 'bg-yellow-100 text-yellow-700'
                    }`}>
                      {d.status || '—'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
