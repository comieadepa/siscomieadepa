'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import PageLayout from '@/components/PageLayout';
import { useRequireSupabaseAuth } from '@/hooks/useRequireSupabaseAuth';
import { buildUrl, getAppBaseUrl } from '@/lib/urls';
import { normalizeRole } from '@/lib/auth/roles';
import { authenticatedFetch } from '@/lib/api-client';

interface Supervisao { id: string; nome: string; }
interface Campo { id: string; nome: string; supervisao_id: string; pastor_member_id?: string | null; presidente_nome?: string | null; }

interface CsvRow {
  ano: number;
  codigo_processo: number;
  data_processo: string | null;
  data_posse: string | null;
  ministro_nome: string;
  ministro_cpf: string;
  ministro_matricula: string;
  campo_origem_nome: string;
  supervisao_origem_nome: string;
  campo_destino_nome: string;
  supervisao_destino_nome: string;
}
interface Permuta {
  id: string;
  codigo_processo: number;
  ano: number;
  data_processo: string | null;
  ministro_id: string | null;
  ministro_nome: string;
  ministro_matricula: string;
  ministro_cpf: string;
  supervisao_origem_nome: string;
  campo_origem_nome: string;
  supervisao_destino_nome: string;
  campo_destino_nome: string;
  data_posse: string | null;
  created_at: string;
}

const hoje = () => {
  const d = new Date();
  return d.toISOString().split('T')[0];
};

const fmtDate = (s: string | null) => {
  if (!s) return '—';
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
};

export default function PermutasPage() {
  const { loading } = useRequireSupabaseAuth();

  // Dados de referência
  const [supervisoes, setSupervisoes] = useState<Supervisao[]>([]);
  const [campos, setCampos] = useState<Campo[]>([]);

  // Formulário
  const [dataProcesso, setDataProcesso] = useState(hoje());
  const [proximoCodigo, setProximoCodigo] = useState<number | null>(null);

  // Origem (busca dinâmica)
  const [nomeQuery, setNomeQuery] = useState('');
  const [sugestoes, setSugestoes] = useState<any[]>([]);
  const [ministroId, setMinistroId] = useState('');
  const [ministroNome, setMinistroNome] = useState('');
  const [ministroMatricula, setMinistroMatricula] = useState('');
  const [ministroCpf, setMinistroCpf] = useState('');
  const [supervisaoOrigemId, setSupervisaoOrigemId] = useState('');
  const [supervisaoOrigemNome, setSupervisaoOrigemNome] = useState('');
  const [campoOrigemId, setCampoOrigemId] = useState('');
  const [campoOrigemNome, setCampoOrigemNome] = useState('');
  const buscarTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Destino
  const [supervisaoDestinoId, setSupervisaoDestinoId] = useState('');
  const [campoDestinoId, setCampoDestinoId] = useState('');
  const [dataPosse, setDataPosse] = useState('');

  // Tabela
  const [permutas, setPermutas] = useState<Permuta[]>([]);
  const [busca, setBusca] = useState('');
  const [periodoIni, setPeriodoIni] = useState('');
  const [periodoFim, setPeriodoFim] = useState('');
  const [page, setPage] = useState(1);
  const PER_PAGE = 15;

  // Status
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState('');
  const [sucesso, setSucesso] = useState('');

  // Importação CSV
  const [csvRows, setCsvRows] = useState<CsvRow[]>([]);
  const [csvErro, setCsvErro] = useState('');
  const [csvSucesso, setCsvSucesso] = useState('');
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Abas e permissão
  const [abaAtiva, setAbaAtiva] = useState<'nova' | 'lista' | 'importar'>('nova');
  const [isSuper, setIsSuper] = useState(false);

  const authedFetch = authenticatedFetch;

  useEffect(() => {
    authenticatedFetch('/api/auth/me')
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        const normalized = normalizeRole(json?.nivel as string | null | undefined);
        setIsSuper(normalized === 'super');
      })
      .catch(() => null);
  }, []);

  // ────────────────────────────────────────────────
  // Carrega supervisões, campos e permutas
  // ────────────────────────────────────────────────
  useEffect(() => {
    if (loading) return;
    const load = async () => {
      const [estruturaRes, pm] = await Promise.all([
        authedFetch('/api/v1/estrutura').then(r => r.json()),
        authedFetch('/api/permutas').then(r => r.json()),
      ]);

      setSupervisoes((estruturaRes?.supervisoes as any[]) || []);
      setCampos(((estruturaRes?.campos as any[]) || []).map((row: any) => ({
        id: row.id,
        nome: row.nome,
        supervisao_id: row.supervisao_id,
        pastor_member_id: row.pastor_member_id ?? null,
        presidente_nome: row.presidente_nome ?? null,
      })));
      setPermutas((pm.data as Permuta[]) || []);

      const ano = new Date().getFullYear();
      const ultimo = ((pm.data as Permuta[]) || []).filter(p => p.ano === ano);
      const maxCod = ultimo.reduce((acc, p) => Math.max(acc, p.codigo_processo), 0);
      setProximoCodigo(maxCod + 1);
    };
    load();
  }, [loading]);

  // ────────────────────────────────────────────────
  // Busca dinâmica de ministro
  // ────────────────────────────────────────────────
  const buscarMembro = useCallback(async (termo: string) => {
    if (termo.trim().length < 2) { setSugestoes([]); return; }
    const res = await authedFetch(`/api/v1/members/lookup?search=${encodeURIComponent(termo)}&limit=8`);
    const json = await res.json();
    setSugestoes((json?.data as any[]) || []);
  }, [authedFetch]);

  const handleNomeChange = (v: string) => {
    setNomeQuery(v);
    setMinistroId('');
    setMinistroNome('');
    setMinistroMatricula('');
    setMinistroCpf('');
    setSupervisaoOrigemId('');
    setSupervisaoOrigemNome('');
    setCampoOrigemId('');
    setCampoOrigemNome('');
    if (buscarTimeout.current) clearTimeout(buscarTimeout.current);
    buscarTimeout.current = setTimeout(() => buscarMembro(v), 300);
  };

  const selecionarMembro = (m: any) => {
    const cf = m.custom_fields || {};
    const sup = cf.supervisao || '';
    const campo = cf.campo || '';

    // Resolver IDs de supervisão e campo a partir dos nomes
    const svObj = supervisoes.find(s => s.nome.toLowerCase() === sup.toLowerCase());
    const cpObj = campos.find(c => c.nome.toLowerCase() === campo.toLowerCase());

    setNomeQuery(m.name);
    setMinistroId(m.id);
    setMinistroNome(m.name);
    setMinistroMatricula(m.matricula || '');
    setMinistroCpf(m.cpf || '');
    setSupervisaoOrigemId(svObj?.id || '');
    setSupervisaoOrigemNome(svObj?.nome || sup);
    setCampoOrigemId(cpObj?.id || '');
    setCampoOrigemNome(cpObj?.nome || campo);
    setSugestoes([]);
  };

  // ────────────────────────────────────────────────
  // Destino: campos filtrados pela supervisão
  // ────────────────────────────────────────────────
  const camposDestino = supervisaoDestinoId
    ? campos.filter(c => c.supervisao_id === supervisaoDestinoId)
    : campos;

  const campoDestinoObj = campos.find(c => c.id === campoDestinoId);
  const supervisaoDestinoObj = supervisoes.find(s => s.id === supervisaoDestinoId);

  // ────────────────────────────────────────────────
  // Registrar permuta
  // ────────────────────────────────────────────────
  const handleRegistrar = async () => {
    setErro('');
    setSucesso('');
    if (!ministroId) { setErro('Selecione o ministro pelo nome.'); return; }
    if (!supervisaoDestinoId || !campoDestinoId) { setErro('Informe Supervisão e Campo de destino.'); return; }

    setSaving(true);
    const res = await authedFetch('/api/permutas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data_processo: dataProcesso || null,
        ministro_id: ministroId,
        ministro_nome: ministroNome,
        ministro_matricula: ministroMatricula,
        ministro_cpf: ministroCpf,
        supervisao_origem_id: supervisaoOrigemId || null,
        supervisao_origem_nome: supervisaoOrigemNome,
        campo_origem_id: campoOrigemId || null,
        campo_origem_nome: campoOrigemNome,
        supervisao_destino_id: supervisaoDestinoId,
        supervisao_destino_nome: supervisaoDestinoObj?.nome || '',
        campo_destino_id: campoDestinoId,
        campo_destino_nome: campoDestinoObj?.nome || '',
        data_posse: dataPosse || null,
      }),
    });
    const json = await res.json();
    setSaving(false);
    if (!res.ok) { setErro(json.error || 'Erro ao registrar.'); return; }

    setSucesso(`Permuta ${json.codigo_processo}/${json.ano} registrada com sucesso!`);
    setProximoCodigo((json.codigo_processo as number) + 1);

    // Recarrega lista
    const pm = await authedFetch('/api/permutas').then(r => r.json());
    setPermutas(pm.data || []);

    // Recarrega campos (presidente_nome pode ter mudado)
    const estrutura = await authedFetch('/api/v1/estrutura').then(r => r.json()).catch(() => null as any);
    const reloadCampos = (estrutura?.campos as any[]) || [];
    setCampos(reloadCampos.map((row: any) => ({
      id: row.id,
      nome: row.nome,
      supervisao_id: row.supervisao_id,
      pastor_member_id: row.pastor_member_id ?? null,
      presidente_nome: row.presidente_nome ?? null,
    })));

    limpar();
  };

  const limpar = () => {
    setNomeQuery('');
    setMinistroId('');
    setMinistroNome('');
    setMinistroMatricula('');
    setMinistroCpf('');
    setSupervisaoOrigemId('');
    setSupervisaoOrigemNome('');
    setCampoOrigemId('');
    setCampoOrigemNome('');
    setSupervisaoDestinoId('');
    setCampoDestinoId('');
    setDataPosse('');
    setDataProcesso(hoje());
    setSugestoes([]);
  };

  // ────────────────────────────────────────────────
  // Importação CSV
  // ────────────────────────────────────────────────
  const parseDate = (v: string): string | null => {
    if (!v || v.trim() === '') return null;
    const iso = v.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const months: Record<string, string> = {
      jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',
      jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12'
    };
    const m = v.match(/([A-Za-z]{3})\s+(\d{1,2}),\s+(\d{4})/);
    if (m) {
      const mes = months[m[1].toLowerCase()];
      if (mes) return `${m[3]}-${mes}-${m[2].padStart(2,'0')}`;
    }
    return null;
  };

  const handleCsvFile = (file: File) => {
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
        const idx = (names: string[]) => {
          for (const n of names) {
            const i = headers.findIndex(h => h.includes(n.toUpperCase()));
            if (i >= 0) return i;
          }
          return -1;
        };
        const colAno        = idx(['ANO DO PROCESSO', 'ANO']);
        const colCod        = idx(['COD PROCESSO', 'COD.PROCESSO', 'CODIGO']);
        const colDataProc   = idx(['DATA PROCESSO']);
        const colDataPosse  = idx(['DATA POSSE']);
        const colNome       = idx(['NOME DO MINISTRO', 'MINISTRO']);
        const colCpf        = idx(['ORIGEM CPF', 'CPF']);
        const colMatricula  = idx(['ORIGEM MATRICULA', 'MATRICULA']);
        const colOrigemCampo = idx(['ORIGEM CAMPO']);
        const colOrigemSup  = idx(['ORIGEM SUPERVIS']);
        const colDestCampo  = idx(['DESTINO CAMPO']);
        const colDestSup    = idx(['DESTINO SUPERVIS']);
        const rows: CsvRow[] = [];
        for (let i = 1; i < lines.length; i++) {
          const cols = lines[i].split(sep).map(c => c.trim().replace(/^"|"$/g, ''));
          if (cols.every(c => !c)) continue;
          const get = (ci: number) => ci >= 0 ? (cols[ci] || '') : '';
          rows.push({
            ano: parseInt(get(colAno)) || new Date().getFullYear(),
            codigo_processo: parseInt(get(colCod)) || i,
            data_processo: parseDate(get(colDataProc)),
            data_posse: parseDate(get(colDataPosse)),
            ministro_nome: get(colNome),
            ministro_cpf: get(colCpf),
            ministro_matricula: get(colMatricula),
            campo_origem_nome: get(colOrigemCampo),
            supervisao_origem_nome: get(colOrigemSup),
            campo_destino_nome: get(colDestCampo),
            supervisao_destino_nome: get(colDestSup),
          });
        }
        setCsvRows(rows);
      } catch { setCsvErro('Erro ao ler o arquivo. Verifique o formato.'); }
    };
    reader.readAsText(file, 'UTF-8');
  };

  const handleImportarCsv = async () => {
    if (csvRows.length === 0) return;
    setImporting(true);
    setCsvErro('');
    setCsvSucesso('');
    const res = await authedFetch('/api/permutas/importar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: csvRows }),
    });
    const json = await res.json();
    setImporting(false);
    if (!res.ok) { setCsvErro(json.error || 'Erro ao importar.'); return; }
    setCsvSucesso(`${json.importados} permuta(s) importada(s) com sucesso!`);
    setCsvRows([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
    const pm = await authedFetch('/api/permutas').then(r => r.json());
    setPermutas(pm.data || []);
    const ano = new Date().getFullYear();
    const ultimo = ((pm.data as Permuta[]) || []).filter((p: Permuta) => p.ano === ano);
    const maxCod = ultimo.reduce((acc: number, p: Permuta) => Math.max(acc, p.codigo_processo), 0);
    setProximoCodigo(maxCod + 1);
  };

  // ────────────────────────────────────────────────
  // Filtro e paginação da tabela
  // ────────────────────────────────────────────────
  const permutasFiltradas = permutas.filter(p => {
    const texto = busca.toLowerCase();
    const matchTexto = !busca || [p.ministro_nome, p.campo_origem_nome, p.campo_destino_nome,
      p.supervisao_origem_nome, p.supervisao_destino_nome, `${p.codigo_processo}/${p.ano}`]
      .some(v => v.toLowerCase().includes(texto));
    const dataP = p.data_processo || '';
    const matchIni = !periodoIni || dataP >= periodoIni;
    const matchFim = !periodoFim || dataP <= periodoFim;
    return matchTexto && matchIni && matchFim;
  });

  const totalPages = Math.max(1, Math.ceil(permutasFiltradas.length / PER_PAGE));
  const paginated = permutasFiltradas.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  // ────────────────────────────────────────────────
  // Impressão da lista
  // ────────────────────────────────────────────────
  function handleImprimirLista() {
    const filtros: string[] = [];
    if (periodoIni) filtros.push(`De: ${new Date(periodoIni + 'T00:00:00').toLocaleDateString('pt-BR')}`);
    if (periodoFim) filtros.push(`Até: ${new Date(periodoFim + 'T00:00:00').toLocaleDateString('pt-BR')}`);
    if (busca) filtros.push(`Busca: "${busca}"`);
    const titulo = `LISTA DE PERMUTAS${filtros.length ? ' — ' + filtros.join(' | ') : ''} — QTD.: ${permutasFiltradas.length}`;

    const rows = permutasFiltradas.map(p => `
      <tr>
        <td>${p.codigo_processo}/${p.ano}</td>
        <td>${(p.ministro_nome || '—').toUpperCase()}</td>
        <td>${p.supervisao_origem_nome || '—'}</td>
        <td>${p.campo_origem_nome || '—'}</td>
        <td>${p.supervisao_destino_nome || '—'}</td>
        <td>${p.campo_destino_nome || '—'}</td>
        <td>${p.data_posse ? new Date(p.data_posse + 'T00:00:00').toLocaleDateString('pt-BR') : '—'}</td>
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
    .header { display: flex; align-items: center; justify-content: center; gap: 8px; border-bottom: 2px solid #000; padding-bottom: 10px; margin-bottom: 10px; }
    .header-logo { width: 60px; height: auto; flex-shrink: 0; }
    .header-center { text-align: center; }
    .header-center .org { font-size: 11px; font-weight: bold; line-height: 1.4; }
    .header-center .contact { font-size: 9px; color: #333; margin-top: 3px; }
    .header-center .address { font-size: 9px; font-weight: bold; margin-top: 2px; }
    .header-center .presidente { font-size: 11px; font-weight: bold; color: #0066cc; margin-top: 6px; }
    .report-title { text-align: center; font-size: 12px; font-weight: bold; margin: 12px 0 10px; border-bottom: 1px solid #000; padding-bottom: 6px; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    thead tr { background: #000; color: #fff; }
    th { padding: 5px 6px; text-align: left; font-size: 9px; font-weight: bold; }
    td { padding: 4px 6px; font-size: 9px; border-bottom: 1px solid #ddd; vertical-align: top; }
    tr:nth-child(even) td { background: #f5f5f5; }
    .footer { margin-top: 16px; font-size: 9px; color: #666; text-align: center; }
    @media print { body { padding: 8px; } @page { margin: 10mm; size: A4 landscape; } }
  </style>
</head>
<body>
  <div class="header">
    <img class="header-logo" src="${buildUrl(getAppBaseUrl(), '/img/logo_comieadepa.png')}" alt="COMIEADEPA"/>
    <div class="header-center">
      <div class="org">COMIEADEPA - CONVENÇÃO INTERESTADUAL DE MINISTROS E IGREJAS<br/>EVANGÉLICAS ASSEMBLEIA DE DEUS NO PARÁ</div>
      <div class="contact">Emails: comieadepa@bol.com.br / Site: www.comieadepa.org</div>
      <div class="address">RODOVIA DO MÁRIO COVAS, 2500, 67115-000 / COQUEIRO, ANANINDEUA - PA</div>
      <div class="presidente">PRESIDENTE: PR. OCELIO NAUAR</div>
    </div>
  </div>
  <div class="report-title">${titulo}</div>
  <table>
    <thead>
      <tr>
        <th>C. PROCESSO</th>
        <th>NOME DO MINISTRO</th>
        <th>SUP. ORIGEM</th>
        <th>CAMPO ORIGEM</th>
        <th>SUP. DESTINO</th>
        <th>CAMPO DESTINO</th>
        <th>DATA POSSE</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="footer">Documento gerado em ${new Date().toLocaleDateString('pt-BR')} às ${new Date().toLocaleTimeString('pt-BR')}</div>
</body>
</html>`;

    const win = window.open('', '_blank', 'width=1100,height=750');
    if (!win) return;
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 600);
  }

  if (loading) return <div className="p-8">Carregando...</div>;

  return (
    <PageLayout
      title="Permutas"
      description="Gerencie as permutas ministeriais"
      activeMenu="permutas"
    >
      <div className="w-full max-w-6xl mx-auto">

        {/* Abas */}
        <div className="mb-6 border-b border-gray-300">
          <div className="flex gap-4">
            <button
              onClick={() => setAbaAtiva('nova')}
              className={`px-6 py-3 font-semibold border-b-2 transition ${
                abaAtiva === 'nova'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-600 hover:text-gray-800'
              }`}
            >
              ➕ Nova Permuta
            </button>
            <button
              onClick={() => setAbaAtiva('lista')}
              className={`px-6 py-3 font-semibold border-b-2 transition ${
                abaAtiva === 'lista'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-600 hover:text-gray-800'
              }`}
            >
              📋 Lista de Permutas ({permutas.length})
            </button>
            {isSuper && (
              <button
                onClick={() => setAbaAtiva('importar')}
                className={`px-6 py-3 font-semibold border-b-2 transition ${
                  abaAtiva === 'importar'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-600 hover:text-gray-800'
                }`}
              >
                📥 Importar CSV
              </button>
            )}
          </div>
        </div>

        {/* ABA: NOVA PERMUTA */}
        {abaAtiva === 'nova' && (
        <div className="bg-white rounded-lg shadow-md p-6">

          {/* Cabeçalho interno */}
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-bold text-gray-800">Registro de Permuta</h2>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-gray-600">Cód. do Processo:</span>
              <span className="inline-flex items-center justify-center px-3 py-1 bg-orange-400 text-white rounded font-bold text-sm">
                {proximoCodigo !== null ? `${proximoCodigo}/${new Date().getFullYear()}` : '—'}
              </span>
            </div>
          </div>

          <div className="space-y-6">
            {/* Data do processo */}
            <div className="flex items-center gap-4">
              <label className="text-sm font-semibold text-gray-700 whitespace-nowrap">Data do Processo</label>
              <input
                type="date"
                value={dataProcesso}
                onChange={e => setDataProcesso(e.target.value)}
                className="border-2 border-teal-500 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* DADOS DE ORIGEM */}
            <div className="border border-gray-200 rounded-lg p-4">
              <p className="text-sm font-semibold text-gray-800 mb-4">Dados de Origem</p>
              <div className="space-y-4">
                {/* Nome do ministro + Matrícula + CPF */}
                <div className="grid grid-cols-1 md:grid-cols-[1fr_160px_180px] gap-4 items-end">
                  <div className="relative">
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Nome do Ministro</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={nomeQuery}
                        onChange={e => handleNomeChange(e.target.value)}
                        placeholder="Digite o nome..."
                        className="flex-1 border-2 border-teal-500 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      {nomeQuery && (
                        <button onClick={() => handleNomeChange('')} className="text-gray-400 hover:text-gray-700 text-lg px-1">✕</button>
                      )}
                    </div>
                    {sugestoes.length > 0 && (
                      <ul className="absolute z-50 bg-white border border-gray-200 rounded-lg shadow-lg mt-1 w-full max-h-52 overflow-auto">
                        {sugestoes.map(s => (
                          <li
                            key={s.id}
                            onMouseDown={() => selecionarMembro(s)}
                            className="px-4 py-2 hover:bg-gray-50 cursor-pointer text-sm"
                          >
                            <span className="font-semibold text-gray-800">{s.name}</span>
                            {s.matricula && <span className="text-gray-500 ml-2 text-xs">Mat: {s.matricula}</span>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Matrícula</label>
                    <input readOnly value={ministroMatricula} className="w-full px-4 py-2 bg-gray-100 border border-gray-200 rounded-lg text-sm text-gray-600" />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">CPF</label>
                    <input readOnly value={ministroCpf} className="w-full px-4 py-2 bg-gray-100 border border-gray-200 rounded-lg text-sm text-gray-600" />
                  </div>
                </div>

                {/* Supervisão e Campo de origem */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Supervisão de Origem</label>
                    <input readOnly value={supervisaoOrigemNome} className="w-full px-4 py-2 bg-gray-100 border border-gray-200 rounded-lg text-sm text-gray-600" />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Campo de Origem</label>
                    <input readOnly value={campoOrigemNome} className="w-full px-4 py-2 bg-gray-100 border border-gray-200 rounded-lg text-sm text-gray-600" />
                  </div>
                </div>
              </div>
            </div>

            {/* DADOS DE DESTINO */}
            <div className="border border-gray-200 rounded-lg p-4">
              <p className="text-sm font-semibold text-gray-800 mb-4">Dados de Destino</p>
              <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_180px] gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Supervisão de Destino</label>
                  <select
                    value={supervisaoDestinoId}
                    onChange={e => { setSupervisaoDestinoId(e.target.value); setCampoDestinoId(''); }}
                    className="w-full border-2 border-teal-500 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">— Defina uma Opção —</option>
                    {supervisoes.map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Campo de Destino</label>
                  <select
                    value={campoDestinoId}
                    onChange={e => setCampoDestinoId(e.target.value)}
                    className="w-full border-2 border-teal-500 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">— Defina uma Opção —</option>
                    {camposDestino.map(c => (
                      <option key={c.id} value={c.id}>{c.nome}</option>
                    ))}
                  </select>
                  {campoDestinoObj && (
                    <p className="text-orange-500 text-xs mt-1 font-medium">
                      Pastor atual: {campoDestinoObj.presidente_nome || 'Não cadastrado'}
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Data da Posse</label>
                  <input
                    type="date"
                    value={dataPosse}
                    onChange={e => setDataPosse(e.target.value)}
                    className="w-full border-2 border-teal-500 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>

            {/* Alertas */}
            {erro && <p className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-4 py-3">{erro}</p>}
            {sucesso && <p className="text-green-700 text-sm bg-green-50 border border-green-200 rounded-lg px-4 py-3">{sucesso}</p>}

            {/* Botões */}
            <div className="flex gap-3">
              <button
                onClick={handleRegistrar}
                disabled={saving}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition disabled:opacity-60"
              >
                {saving ? 'Registrando...' : 'Registrar'}
              </button>
              <button
                onClick={limpar}
                className="px-6 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 font-semibold rounded-lg transition"
              >
                Limpar
              </button>
            </div>
          </div>
        </div>
        )}

        {/* ABA: IMPORTAR CSV */}
        {abaAtiva === 'importar' && isSuper && (
        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className="text-lg font-bold text-gray-800 mb-4">Importar CSV de Permutas</h2>
          <div className="space-y-4">
            <p className="text-xs text-gray-500">
              Colunas esperadas: <strong>ANO DO PROCESSO, COD PROCESSO, DATA PROCESSO, DATA POSSE, NOME DO MINISTRO, ORIGEM CPF PRESIDEN, ORIGEM MATRICULA PRESIDEN, ORIGEM CAMPO, ORIGEM SUPERVISÃO, DESTINO CAMPO, DESTINO SUPERVISÃO</strong>. Separador: vírgula ou ponto-e-vírgula.
            </p>
            <div
              className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:border-blue-400 transition-colors"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleCsvFile(f); }}
            >
              <p className="text-gray-500 text-sm">Clique ou arraste o arquivo CSV aqui</p>
              <input ref={fileInputRef} type="file" accept=".csv,.txt" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleCsvFile(f); }} />
            </div>
            {csvErro && <p className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-4 py-3">{csvErro}</p>}
            {csvSucesso && <p className="text-green-700 text-sm bg-green-50 border border-green-200 rounded-lg px-4 py-3">{csvSucesso}</p>}
            {csvRows.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-gray-700">{csvRows.length} registro(s) — pré-visualização:</p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => { setCsvRows([]); if (fileInputRef.current) fileInputRef.current.value = ''; }}
                      className="px-4 py-1.5 text-sm border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 transition"
                    >
                      Cancelar
                    </button>
                    <button
                      onClick={handleImportarCsv}
                      disabled={importing}
                      className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition disabled:opacity-60"
                    >
                      {importing ? 'Importando...' : `Importar ${csvRows.length} registros`}
                    </button>
                  </div>
                </div>
                <div className="overflow-x-auto max-h-64 border border-gray-200 rounded-lg">
                  <table className="w-full text-sm">
                    <thead>
                      <tr>
                        <th className="px-4 py-3 text-left font-semibold bg-gray-200 text-gray-800">Cód</th>
                        <th className="px-4 py-3 text-left font-semibold bg-gray-200 text-gray-800">Ano</th>
                        <th className="px-4 py-3 text-left font-semibold bg-gray-200 text-gray-800">Ministro</th>
                        <th className="px-4 py-3 text-left font-semibold bg-gray-200 text-gray-800">Origem Campo</th>
                        <th className="px-4 py-3 text-left font-semibold bg-gray-200 text-gray-800">Destino Campo</th>
                        <th className="px-4 py-3 text-left font-semibold bg-gray-200 text-gray-800">Posse</th>
                      </tr>
                    </thead>
                    <tbody>
                      {csvRows.map((r, i) => (
                        <tr key={i} className="border-b border-gray-200 hover:bg-gray-50">
                          <td className="px-4 py-3 text-gray-700 text-xs font-bold">{r.codigo_processo}/{r.ano}</td>
                          <td className="px-4 py-3 text-gray-700 text-xs">{r.ano}</td>
                          <td className="px-4 py-3 text-gray-700 text-xs uppercase">{r.ministro_nome}</td>
                          <td className="px-4 py-3 text-gray-700 text-xs">{r.campo_origem_nome}</td>
                          <td className="px-4 py-3 text-gray-700 text-xs">{r.campo_destino_nome}</td>
                          <td className="px-4 py-3 text-gray-700 text-xs">{r.data_posse || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
        )}

        {/* ABA: LISTA DE PERMUTAS */}
        {abaAtiva === 'lista' && (
        <div className="space-y-4">

          {/* Cards de resumo */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white p-4 rounded-lg shadow border-l-4 border-blue-500">
              <p className="text-gray-600 text-sm">{permutasFiltradas.length === permutas.length ? 'Total de Permutas' : `Filtrados de ${permutas.length}`}</p>
              <p className="text-2xl font-bold text-blue-600">{permutasFiltradas.length}</p>
            </div>
            <div className="bg-white p-4 rounded-lg shadow border-l-4 border-orange-400">
              <p className="text-gray-600 text-sm">Ano Atual ({new Date().getFullYear()})</p>
              <p className="text-2xl font-bold text-orange-500">{permutas.filter(p => p.ano === new Date().getFullYear()).length}</p>
            </div>
            <div className="bg-white p-4 rounded-lg shadow border-l-4 border-green-500">
              <p className="text-gray-600 text-sm">Mês atual ({new Date().toLocaleString('pt-BR', { month: 'long' }).replace(/^\w/, c => c.toUpperCase())})</p>
              <p className="text-2xl font-bold text-green-600">{permutas.filter(p => { const d = p.data_processo || p.created_at; if (!d) return false; const dt = new Date(d); return dt.getFullYear() === new Date().getFullYear() && dt.getMonth() === new Date().getMonth(); }).length}</p>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-md p-6">

            {/* Filtros */}
            <div className="flex flex-wrap items-center gap-3 mb-5">
              <div className="flex items-center gap-2">
                <label className="text-sm text-gray-600 whitespace-nowrap">Período:</label>
                <input
                  type="date"
                  value={periodoIni}
                  onChange={e => { setPeriodoIni(e.target.value); setPage(1); }}
                  className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <span className="text-gray-400 text-sm">a</span>
                <input
                  type="date"
                  value={periodoFim}
                  onChange={e => { setPeriodoFim(e.target.value); setPage(1); }}
                  className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <input
                type="text"
                placeholder="Buscar por ministro, campo, supervisão..."
                value={busca}
                onChange={e => { setBusca(e.target.value); setPage(1); }}
                className="flex-1 min-w-[220px] border border-gray-300 rounded-lg px-4 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                onClick={() => { setBusca(''); setPeriodoIni(''); setPeriodoFim(''); setPage(1); }}
                className="px-4 py-1.5 bg-gray-200 hover:bg-gray-300 text-gray-700 text-sm font-semibold rounded-lg transition"
              >
                Limpar
              </button>
              <button
                onClick={handleImprimirLista}
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition flex items-center gap-1.5"
              >
                🖨️ Imprimir
              </button>
            </div>

            {/* Tabela */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold bg-gray-200 text-gray-800 whitespace-nowrap">C. Processo</th>
                    <th className="px-4 py-3 text-left font-semibold bg-gray-200 text-gray-800">Nome do Ministro</th>
                    <th className="px-4 py-3 text-left font-semibold bg-gray-200 text-gray-800 whitespace-nowrap">Sup. Origem</th>
                    <th className="px-4 py-3 text-left font-semibold bg-gray-200 text-gray-800 whitespace-nowrap">Campo Origem</th>
                    <th className="px-4 py-3 text-left font-semibold bg-gray-200 text-gray-800 whitespace-nowrap">Sup. Destino</th>
                    <th className="px-4 py-3 text-left font-semibold bg-gray-200 text-gray-800 whitespace-nowrap">Campo Destino</th>
                    <th className="px-4 py-3 text-left font-semibold bg-gray-200 text-gray-800 whitespace-nowrap">Posse</th>
                  </tr>
                </thead>
                <tbody>
                  {paginated.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-gray-500">Nenhuma permuta registrada.</td>
                    </tr>
                  )}
                  {paginated.map((p) => (
                    <tr key={p.id} className="border-b border-gray-200 hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-700 text-xs font-bold whitespace-nowrap">{p.codigo_processo}/{p.ano}</td>
                      <td className="px-4 py-3 text-gray-700 text-xs font-semibold uppercase">{p.ministro_nome}</td>
                      <td className="px-4 py-3 text-gray-700 text-xs">{p.supervisao_origem_nome || '—'}</td>
                      <td className="px-4 py-3 text-gray-700 text-xs">{p.campo_origem_nome || '—'}</td>
                      <td className="px-4 py-3 text-gray-700 text-xs">{p.supervisao_destino_nome}</td>
                      <td className="px-4 py-3 text-gray-700 text-xs">{p.campo_destino_nome}</td>
                      <td className="px-4 py-3 text-gray-700 text-xs whitespace-nowrap">{fmtDate(p.data_posse)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Paginação */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-5 pt-4 border-t border-gray-200">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-4 py-2 text-sm font-semibold rounded-lg border border-gray-300 disabled:opacity-40 hover:bg-gray-50 transition"
                >
                  ← Anterior
                </button>
                <span className="text-sm text-gray-600">
                  Página <span className="font-bold text-blue-600">{page}</span> de {totalPages}
                </span>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="px-4 py-2 text-sm font-semibold rounded-lg border border-gray-300 disabled:opacity-40 hover:bg-gray-50 transition"
                >
                  Próxima →
                </button>
              </div>
            )}
          </div>
        </div>
        )}

      </div>
    </PageLayout>
  );
}
