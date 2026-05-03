'use client';

import React, { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import NotificationModal from '@/components/NotificationModal';
import { createClient } from '@/lib/supabase-client';

export const dynamic = 'force-dynamic';

// ── Helpers ───────────────────────────────────────────────────────────────────

function normCpf(v: string) { return (v || '').replace(/\D/g, ''); }

const MONTH_ABBR: Record<string, string> = {
  jan:'01', feb:'02', mar:'03', apr:'04', may:'05', jun:'06',
  jul:'07', aug:'08', sep:'09', oct:'10', nov:'11', dec:'12',
  // português
  fev:'02', abr:'04', mai:'05', ago:'08', set:'09', out:'10', dez:'12',
};

/** Converte diversas variantes de data para ISO (YYYY-MM-DD). Retorna null se inválida. */
function parseDateBR(v: string): string | null {
  if (!v) return null;
  const s = v.trim();

  // DD/MM/YYYY ou DD-MM-YYYY
  const slashed = s.replace(/-/g, '/').split('/');
  if (slashed.length === 3) {
    const [a, b, c] = slashed;
    if (c.length === 4) return `${c}-${b.padStart(2,'0')}-${a.padStart(2,'0')}`;
    if (a.length === 4) return `${a}-${b.padStart(2,'0')}-${c.padStart(2,'0')}`;
  }

  // "Apr 10, 2024" ou "Apr 10, 2024 12:48 pm" (formato exportado pelo Access/Excel EN)
  const mEn = s.match(/^([A-Za-z]{3})\s+(\d{1,2}),?\s+(\d{4})/);
  if (mEn) {
    const mm = MONTH_ABBR[mEn[1].toLowerCase()];
    if (mm) return `${mEn[3]}-${mm}-${mEn[2].padStart(2,'0')}`;
  }

  // "10 Apr 2024" ou "10 de Abr 2024"
  const mDayMon = s.match(/^(\d{1,2})\s+(?:de\s+)?([A-Za-z]{3})/i);
  if (mDayMon) {
    const yrM = s.match(/(\d{4})/);
    const mm = MONTH_ABBR[mDayMon[2].toLowerCase().slice(0, 3)];
    if (mm && yrM) return `${yrM[1]}-${mm}-${mDayMon[1].padStart(2,'0')}`;
  }

  return null;
}

function parseBool(v: string): boolean {
  const s = (v || '').toLowerCase().trim();
  if (['s','sim','yes','true','1','x'].includes(s)) return true;
  return false; // "não", "no", "nao", "false", "0", "" → false
}

function parseStatus(v: string): string {
  const s = (v || '').toLowerCase().trim();
  if (s === 'ativo' || s === 'active') return 'active';
  if (s === 'inativo' || s === 'inactive') return 'inactive';
  if (s === 'falecido' || s === 'deceased') return 'deceased';
  if (s === 'transferido' || s === 'transferred') return 'transferred';
  return 'active';
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

/** Divide o texto CSV em linhas respeitando campos com aspas (que podem conter \n) */
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
      if (ch === '\r') i++; // pula \n do \r\n
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

// ── Mapeamento colunas CSV → campos do banco ─────────────────────────────────
// Chave: fragmento do cabeçalho CSV (lowercase, sem acento); Valor: campo destino
type DestType = { col: string; type: 'direct' | 'date' | 'bool' | 'status' | 'cf' };

const COLUMN_MAP: [string, DestType][] = [
  // Identificação
  ['nome',                    { col: 'name',                    type: 'direct' }],
  ['cpf',                     { col: 'cpf',                     type: 'direct' }],
  ['matricula',               { col: 'matricula',               type: 'direct' }],
  ['unique id',               { col: 'unique_id',               type: 'direct' }],
  ['cgadb reg',               { col: 'numero_cgadb',            type: 'direct' }],
  ['comieadepa reg',          { col: 'registro_comieadepa',     type: 'direct' }],
  ['status',                  { col: 'status',                  type: 'status' }],
  ['cargo tipo',              { col: 'tipo_cadastro',           type: 'direct' }],
  ['cargo ',                  { col: 'cargo_ministerial',       type: 'direct' }],

  // Documentos pessoais
  ['rg',                      { col: 'rg',                      type: 'direct' }],
  ['orgao exp',               { col: 'orgao_emissor',           type: 'direct' }],
  ['uf rg',                   { col: 'uf_rg',                   type: 'direct' }],

  // Dados pessoais
  ['dnascimento',             { col: 'data_nascimento',         type: 'date'   }],
  ['sexo',                    { col: 'sexo',                    type: 'direct' }],
  ['tsanguineo',              { col: 'tipo_sanguineo',          type: 'direct' }],
  ['escolaridade',            { col: 'escolaridade',            type: 'direct' }],
  ['estado civil',            { col: 'estado_civil',            type: 'direct' }],
  ['nacionalidade',           { col: 'nacionalidade',           type: 'direct' }],
  ['naturalidade',            { col: 'naturalidade',            type: 'direct' }],
  ['uf nascimento',           { col: 'uf_naturalidade',         type: 'direct' }],
  ['mae',                     { col: 'nome_mae',                type: 'direct' }],
  ['pai',                     { col: 'nome_pai',                type: 'direct' }],
  ['profissao',               { col: 'profissao',               type: 'direct' }],
  ['qtd filhos',              { col: 'qtd_filhos',              type: 'direct' }],

  // Endereço
  ['endereco',                { col: 'logradouro',              type: 'direct' }],
  ['num endereco',            { col: 'numero',                  type: 'direct' }],
  ['bairro end',              { col: 'bairro',                  type: 'direct' }],
  ['cidade end',              { col: 'cidade',                  type: 'direct' }],
  ['municipio end',           { col: 'cidade',                  type: 'direct' }],
  ['uf end',                  { col: 'estado',                  type: 'direct' }],
  ['cep end',                 { col: 'cep',                     type: 'direct' }],
  ['complemento',             { col: 'complemento',             type: 'direct' }],

  // Contato
  ['email',                   { col: 'email',                   type: 'direct' }],
  ['celular 01',              { col: 'celular',                 type: 'direct' }],
  ['celular 02',              { col: 'whatsapp',                type: 'direct' }],
  ['foto',                    { col: 'foto_url',                type: 'direct' }],

  // Ministerial
  ['posicao min no campo',    { col: 'posicao_no_campo',        type: 'direct' }],
  ['cargo funcao',            { col: 'qual_funcao',             type: 'direct' }],
  ['departamento fun',        { col: 'setor_departamento',      type: 'direct' }],
  ['setor funcionario',       { col: 'setor_departamento',      type: 'direct' }],
  ['procedencia',             { col: 'procedencia',             type: 'direct' }],
  ['pastor auxiliar',         { col: 'pastor_auxiliar',         type: 'bool'   }],
  ['diretoria?',              { col: 'diretoria',               type: 'bool'   }],
  ['diretoria cargo',         { col: 'diretoria_cargo',         type: 'direct' }],
  ['curso teologico',         { col: 'curso_teologico',         type: 'direct' }],
  ['titulo eleitoral',        { col: 'titulo_eleitoral',        type: 'direct' }],
  ['zona',                    { col: 'zona_eleitoral',          type: 'direct' }],
  ['secao eleitoral',         { col: 'secao_eleitoral',         type: 'direct' }],
  ['municipio eleitoral',     { col: 'municipio_eleitoral',     type: 'direct' }],
  ['escolaridade',            { col: 'escolaridade',            type: 'direct' }],
  ['cad obs',                 { col: 'observacoes',             type: 'direct' }],
  ['cad teologia obs',        { col: 'observacoes_ministeriais',type: 'direct' }],

  // Datas ministeriais
  ['dfiliacao',               { col: 'data_filiacao',           type: 'date'   }],
  ['dmembrodesde',            { col: 'member_since',            type: 'date'   }],
  ['casamento',               { col: 'data_casamento',          type: 'date'   }],
  ['dbaguas',                 { col: 'data_batismo_aguas',      type: 'date'   }],
  ['baguas local',            { col: 'local_batismo',           type: 'direct' }],
  ['dbatismoep',              { col: 'data_batismo_espirito_santo', type: 'date' }],
  ['ev autorizado data ok',   { col: 'ev_autorizado_data',      type: 'date'   }],
  ['ev. autorizado l',        { col: 'ev_autorizado_local',     type: 'direct' }],
  ['ev consagracao data ok',  { col: 'ev_consagrado_data',      type: 'date'   }],
  ['ev. consagrado l',        { col: 'ev_consagrado_local',     type: 'direct' }],
  ['missionario data ok',     { col: 'cons_missionario_data',   type: 'date'   }],
  ['missionario local',       { col: 'cons_missionario_local',  type: 'direct' }],
  ['ordenacao pastor ok',     { col: 'orden_pastor_data',       type: 'date'   }],
  ['pastor local c',          { col: 'orden_pastor_local',      type: 'direct' }],
  ['diacono data',            { col: 'diacono_data',            type: 'date'   }],
  ['diacono local c',         { col: 'diacono_local',           type: 'direct' }],
  ['cert diacono',            { col: 'cert_diacono',            type: 'direct' }],
  ['presbitero local c',      { col: 'presbitero_local',        type: 'direct' }],
  ['cert presbitero',         { col: 'cert_presbitero',         type: 'direct' }],
  ['cert evangelista',        { col: 'cert_evangelista',        type: 'direct' }],
  ['cert pastor',             { col: 'cert_pastor',             type: 'direct' }],
  ['cred validade',           { col: 'cred_validade',           type: 'date'   }],
  ['cvalidade',               { col: 'cred_validade',           type: 'date'   }],
  ['cred vencida',            { col: 'cred_vencida',            type: 'bool'   }],
  ['djubilacao',              { col: 'data_jubilacao',          type: 'date'   }],
  ['jubilado',                { col: 'jubilado',                type: 'bool'   }],
  ['dfalecimento',            { col: 'data_falecimento',        type: 'date'   }],
  ['local falecimento',       { col: 'local_falecimento',       type: 'direct' }],
  ['dtransferido em',         { col: 'data_transferido_em',     type: 'date'   }],
  ['dtransferido para',       { col: 'data_transferido_para',   type: 'direct' }],
  ['local da transferencia',  { col: 'local_transferencia',     type: 'direct' }],
  ['drecebido em transferencia',{ col:'data_recebido_transferencia', type:'date'}],

  // Booleans
  ['convencional',            { col: 'convencional',            type: 'bool'   }],
  ['apto para votar',         { col: 'apto_votar',              type: 'bool'   }],
  ['efetivo',                 { col: 'efetivo',                 type: 'bool'   }],
  ['ministerial',             { col: 'ministerial',             type: 'bool'   }],
  ['homologado',              { col: 'homologado',              type: 'bool'   }],
  ['casamento?',              { col: 'primeiro_casamento',      type: 'direct' }],
  ['1 casamento?',            { col: 'primeiro_casamento',      type: 'direct' }],

  // Cônjuge
  ['conjuge nome',            { col: 'nome_conjuge',            type: 'direct' }],
  ['conjuge cpf',             { col: 'cpf_conjuge',             type: 'direct' }],
  ['conjuge dnascimento',     { col: 'data_nascimento_conjuge', type: 'date'   }],
  ['conjuje rg',              { col: 'conjuge_rg',              type: 'direct' }],
  ['conjuje mae',             { col: 'conjuge_nome_mae',        type: 'direct' }],
  ['conjuje pai',             { col: 'conjuge_nome_pai',        type: 'direct' }],
  ['conjuje nacionalidade',   { col: 'conjuge_nacionalidade',   type: 'direct' }],
  ['conjuje naturalidade',    { col: 'conjuge_naturalidade',    type: 'direct' }],
  ['conjuje teleitor',        { col: 'conjuge_titulo_eleitoral',type: 'direct' }],
  ['conjuje tsangue',         { col: 'conjuge_tipo_sanguineo',  type: 'direct' }],
  ['conjuje fone',            { col: 'conjuge_fone',            type: 'direct' }],
  ['conjuje email',           { col: 'conjuge_email',           type: 'direct' }],

  // custom_fields
  ['campo atual',             { col: 'campo_atual',             type: 'cf'     }],
  ['campo',                   { col: 'campo',                   type: 'cf'     }],
  ['supervisao',              { col: 'supervisao',              type: 'cf'     }],
  ['congregacao',             { col: 'congregacao',             type: 'cf'     }],
  ['curso teologia?',         { col: 'tem_curso_teologia',      type: 'cf'     }],
  ['cred autoriza',           { col: 'cred_autoriza',           type: 'cf'     }],
  ['parecer da comissao',     { col: 'parecer_comissao',        type: 'cf'     }],
  ['sit. caixa pastor',       { col: 'sit_caixa_pastor',        type: 'cf'     }],
  ['nota prova',              { col: 'nota_prova',              type: 'cf'     }],
  ['lista docs',              { col: 'lista_docs',              type: 'cf'     }],
  ['biometria',               { col: 'biometria',               type: 'cf'     }],
  ['atualizado',              { col: 'atualizado',              type: 'cf'     }],
  ['entrevistado',            { col: 'entrevistado',            type: 'cf'     }],
  ['fiscal ok',               { col: 'fiscal_ok',               type: 'cf'     }],
  ['doc pendente',            { col: 'doc_pendente',            type: 'cf'     }],
  ['doc extrangeiro',         { col: 'doc_estrangeiro',         type: 'cf'     }],
  ['reg na cgadb',            { col: 'reg_cgadb',               type: 'cf'     }],
  ['data cad convencao',      { col: 'data_cad_convencao',      type: 'cf'     }],
  ['dbaguas2',                { col: 'data_batismo_aguas2',     type: 'cf'     }],
  ['dbatismoep2',             { col: 'data_batismo_ep2',        type: 'cf'     }],
  ['dmembrodesde2',           { col: 'data_membro_desde2',      type: 'cf'     }],
  ['pastor presidente',       { col: 'pastor_presidente',       type: 'cf'     }],
  ['cargo anterior',          { col: 'cargo_anterior',          type: 'cf'     }],
  ['cargo funcionario',       { col: 'cargo_funcionario',       type: 'cf'     }],
  ['mat funcionario',         { col: 'matricula_funcionario',   type: 'cf'     }],
  ['matricula membro def',    { col: 'matricula_membro_def',    type: 'cf'     }],
  ['pais end',                { col: 'pais_endereco',           type: 'cf'     }],
  ['pais origem',             { col: 'pais_nascimento',         type: 'cf'     }],
  ['pais de nacimento',       { col: 'pais_nascimento',         type: 'cf'     }],
  ['ev. autorizacao data no', { col: 'ev_autorizacao_data_no',  type: 'cf'     }],
  ['evangelista autorizacao data no', { col: 'ev_autorizacao_data_no', type: 'cf' }],
  ['pastor data no',          { col: 'pastor_data_no',          type: 'cf'     }],
  ['filhos add',              { col: 'filhos_add',              type: 'cf'     }],
  ['conjuje foto',            { col: 'conjuge_foto',            type: 'cf'     }],
];

// Remove acentos para comparação de cabeçalho
function deaccent(s: string) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function matchHeader(header: string): DestType | null {
  const h = deaccent(header);
  // Ignorar colunas
  if (['saldo cgadb', 'datualizado', 'dmodificacao'].includes(h)) return null;
  for (const [pattern, dest] of COLUMN_MAP) {
    if (h === deaccent(pattern) || h.startsWith(deaccent(pattern))) return dest;
  }
  return null;
}

interface ParseResult {
  headers: string[];
  mapping: (DestType | null)[];
  rows: string[][];
  sep: string;
}

interface ImportResult {
  total: number;
  inserted: number;
  skipped: number;
  errors: string[];
}

// ── Componente principal ──────────────────────────────────────────────────────
export default function ImportarMembrosPage() {
  const supabase = createClient();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeMenu, setActiveMenu] = useState('membros');
  const [isDragging, setIsDragging] = useState(false);
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [notification, setNotification] = useState<{
    isOpen: boolean; title: string; message: string; type: 'success' | 'error' | 'warning' | 'info';
  }>({ isOpen: false, title: '', message: '', type: 'success' });

  function notify(title: string, message: string, type: 'success' | 'error' | 'warning' | 'info') {
    setNotification({ isOpen: true, title, message, type });
  }

  function handleFile(file: File) {
    if (!file.name.toLowerCase().endsWith('.csv')) {
      notify('Formato inválido', 'Selecione um arquivo .CSV', 'warning');
      return;
    }
    file.text().then(text => {
      const lines = splitCsvLines(text);
      if (lines.length < 2) { notify('Arquivo vazio', 'O CSV não tem dados.', 'warning'); return; }
      const sep = detectSep(lines[0]);
      const headers = parseCsvLine(lines[0], sep);
      const mapping = headers.map(h => matchHeader(h));
      const rows = lines.slice(1).map(l => parseCsvLine(l, sep));
      setParsed({ headers, mapping, rows, sep });
      setResult(null);
    });
  }

  function buildRow(headers: string[], mapping: (DestType | null)[], cols: string[]) {
    const directFields: Record<string, any> = {};
    const customFields: Record<string, any> = {};

    for (let i = 0; i < headers.length; i++) {
      const dest = mapping[i];
      if (!dest) continue;
      const raw = cols[i] ?? '';
      if (!raw) continue;

      let value: any = raw;
      if (dest.type === 'date')   value = parseDateBR(raw);
      if (dest.type === 'bool')   value = parseBool(raw);
      if (dest.type === 'status') value = parseStatus(raw);
      if (dest.type === 'direct' && dest.col === 'cpf') value = normCpf(raw);
      if (dest.type === 'direct' && dest.col === 'cpf_conjuge') value = normCpf(raw);

      // Pular somente se realmente vazio (mas manter false/0/null-date tratados)
      if (value === null && dest.type === 'date') continue; // data inválida → pular
      if (value === null || value === '') continue;         // demais campos vazios → pular

      // Truncar strings para evitar "value too long for type character varying(N)"
      const LIMITS: Record<string, number> = {
        cpf: 30, phone: 50, celular: 50, whatsapp: 50, rg: 50,
        cep: 20, orgao_emissor: 50, uf_rg: 2, estado: 2,
        // colunas adicionadas em 20260430300000 (expandidas em 20260430700000)
        unique_id: 100, numero: 50, zona_eleitoral: 50,
        secao_eleitoral: 50, cpf_conjuge: 30, tipo_sanguineo: 20,
      };
      if (typeof value === 'string' && LIMITS[dest.col]) {
        value = value.slice(0, LIMITS[dest.col]);
      }

      if (dest.type === 'cf') {
        customFields[dest.col] = value;
      } else {
        directFields[dest.col] = value;
      }
    }

    if (!directFields['name']) return null; // linha sem nome é inválida — descarta

    // Garantir status padrão (coluna NOT NULL no banco)
    if (!directFields['status']) directFields['status'] = 'active';

    // Normaliza CPF (pode estar vazio — operadores vão preencher depois)
    if (directFields['cpf']) directFields['cpf'] = normCpf(String(directFields['cpf']));

    return { ...directFields, custom_fields: customFields };
  }

  async function startImport() {
    if (!parsed) return;
    setImporting(true);
    setProgress(0);
    setResult(null);

    const { headers, mapping, rows } = parsed;
    const BATCH = 200;
    let inserted = 0;
    let skipped = 0;
    const errors: string[] = [];

    // Separar: com CPF (upsert) e sem CPF (insert simples)
    const byCpf = new Map<string, any>();
    const semCpf: any[] = [];

    for (const row of rows) {
      const built = buildRow(headers, mapping, row);
      if (!built) { skipped++; continue; }
      if (built.cpf) {
        byCpf.set(built.cpf, built); // dedup — mantém o último
      } else {
        semCpf.push(built);
      }
    }

    const comCpf  = Array.from(byCpf.values());
    const allRows = [...comCpf, ...semCpf];
    const total   = allRows.length;

    // Lotes com CPF → upsert (atualiza se já existe)
    for (let i = 0; i < comCpf.length; i += BATCH) {
      const batch = comCpf.slice(i, i + BATCH);
      const { error } = await supabase
        .from('members')
        .upsert(batch, { onConflict: 'cpf', ignoreDuplicates: false });
      if (error) {
        // Fallback: insert ignorando duplicatas (não faz update, mas não trava)
        const { error: ie, count } = await supabase
          .from('members')
          .insert(batch)
          .select('id', { count: 'exact', head: true });
        if (ie) errors.push(`Lote ${Math.floor(i / BATCH) + 1}: ${ie.message}`);
        else inserted += count ?? batch.length;
      } else {
        inserted += batch.length;
      }
      setProgress(Math.round(((i + batch.length) / total) * 80)); // 0–80%
    }

    // Lotes sem CPF → insert simples (novo registro para preencher depois)
    const offsetLote = Math.ceil(comCpf.length / BATCH);
    for (let i = 0; i < semCpf.length; i += BATCH) {
      const batch = semCpf.slice(i, i + BATCH);
      const { error } = await supabase
        .from('members')
        .insert(batch);
      if (error) errors.push(`Lote sem-CPF ${offsetLote + Math.floor(i / BATCH) + 1}: ${error.message}`);
      else inserted += batch.length;
      setProgress(80 + Math.round(((i + batch.length) / (semCpf.length || 1)) * 20)); // 80–100%
    }

    setResult({ total: rows.length, inserted, skipped: rows.length - total + skipped, errors });
    setImporting(false);
    if (errors.length === 0) notify('Importação concluída', `${inserted} ministro(s) importados com sucesso.`, 'success');
    else notify('Concluído com erros', `${inserted} importados, ${errors.length} erro(s).`, 'warning');
  }

  const mappedCount = parsed ? parsed.mapping.filter(Boolean).length : 0;
  const unmappedHeaders = parsed ? parsed.headers.filter((_, i) => !parsed.mapping[i]) : [];
  const previewRows = parsed ? parsed.rows.slice(0, 5) : [];

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
        <div className="p-6 max-w-6xl mx-auto">
          {/* Header */}
          <div className="flex items-center gap-4 mb-6">
            <button
              onClick={() => router.push('/secretaria/membros')}
              className="text-gray-500 hover:text-gray-700 text-sm font-medium flex items-center gap-1"
            >
              ← Voltar
            </button>
            <div>
              <h1 className="text-2xl font-bold text-gray-800">📥 Importar Ministros (CSV)</h1>
              <p className="text-sm text-gray-500 mt-0.5">Importação em massa a partir da planilha COMIEADEPA</p>
            </div>
          </div>

          {/* Upload */}
          {!parsed && (
            <div
              onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={e => { e.preventDefault(); setIsDragging(false); const f = e.dataTransfer.files?.[0]; if (f) handleFile(f); }}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-2xl p-16 text-center cursor-pointer transition-all ${
                isDragging ? 'border-teal-500 bg-teal-50' : 'border-gray-300 bg-white hover:border-teal-400 hover:bg-teal-50/30'
              }`}
            >
              <input ref={fileInputRef} type="file" accept=".csv" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
              <p className="text-5xl mb-4">📂</p>
              <p className="text-gray-800 font-semibold text-lg">Arraste o CSV ou clique para selecionar</p>
              <p className="text-gray-400 text-sm mt-2">Planilha exportada do sistema COMIEADEPA/CGADB com 3000+ ministros</p>
              <p className="text-gray-400 text-xs mt-1">Separador: ponto e vírgula (;) ou vírgula (,) — detectado automaticamente</p>
            </div>
          )}

          {/* Preview após leitura */}
          {parsed && !result && (
            <div className="space-y-5">
              {/* Resumo do mapeamento */}
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-white rounded-xl border border-gray-200 p-4 text-center shadow-sm">
                  <p className="text-3xl font-bold text-teal-600">{parsed.rows.length}</p>
                  <p className="text-xs text-gray-500 mt-1">Linhas no CSV</p>
                </div>
                <div className="bg-white rounded-xl border border-gray-200 p-4 text-center shadow-sm">
                  <p className="text-3xl font-bold text-green-600">{mappedCount}</p>
                  <p className="text-xs text-gray-500 mt-1">Colunas mapeadas</p>
                </div>
                <div className="bg-white rounded-xl border border-gray-200 p-4 text-center shadow-sm">
                  <p className="text-3xl font-bold text-orange-500">{unmappedHeaders.length}</p>
                  <p className="text-xs text-gray-500 mt-1">Colunas não mapeadas</p>
                </div>
              </div>

              {/* Colunas não mapeadas */}
              {unmappedHeaders.length > 0 && (
                <div className="bg-orange-50 border border-orange-200 rounded-xl p-4">
                  <p className="text-sm font-semibold text-orange-700 mb-2">⚠️ Colunas ignoradas na importação:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {unmappedHeaders.map(h => (
                      <span key={h} className="px-2 py-0.5 bg-orange-100 text-orange-700 rounded text-xs">{h}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Preview das primeiras 5 linhas */}
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="px-5 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
                  <p className="text-sm font-semibold text-gray-700">Preview (primeiras 5 linhas)</p>
                  <button onClick={() => setParsed(null)} className="text-xs text-gray-400 hover:text-red-500 transition">
                    × Trocar arquivo
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="bg-gray-700 text-white">
                        {parsed.headers.slice(0, 10).map((h, i) => (
                          <th key={i} className="px-3 py-2 text-left font-semibold whitespace-nowrap">
                            <span className="block">{h}</span>
                            {parsed.mapping[i] && (
                              <span className="block text-teal-300 font-normal">→ {parsed.mapping[i]!.col}</span>
                            )}
                            {!parsed.mapping[i] && (
                              <span className="block text-orange-300 font-normal">ignorado</span>
                            )}
                          </th>
                        ))}
                        {parsed.headers.length > 10 && (
                          <th className="px-3 py-2 text-gray-300 font-normal">+{parsed.headers.length - 10} cols...</th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.map((row, ri) => (
                        <tr key={ri} className={ri % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                          {row.slice(0, 10).map((cell, ci) => (
                            <td key={ci} className="px-3 py-2 text-gray-700 max-w-[150px] truncate">{cell || '—'}</td>
                          ))}
                          {row.length > 10 && <td className="px-3 py-2 text-gray-400">...</td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Botões */}
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => setParsed(null)}
                  className="px-6 py-2.5 border border-gray-300 text-gray-700 rounded-lg text-sm font-semibold hover:bg-gray-50 transition"
                >
                  Cancelar
                </button>
                <button
                  onClick={startImport}
                  disabled={importing}
                  className="px-8 py-2.5 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-sm font-bold shadow transition disabled:opacity-60"
                >
                  {importing ? 'Importando...' : `Importar ${parsed.rows.length} registros`}
                </button>
              </div>

              {/* Barra de progresso */}
              {importing && (
                <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-semibold text-gray-700">Importando...</p>
                    <p className="text-sm font-bold text-teal-600">{progress}%</p>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-3">
                    <div
                      className="bg-teal-500 h-3 rounded-full transition-all duration-300"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Resultado */}
          {result && (
            <div className="space-y-5">
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-teal-50 border border-teal-200 rounded-xl p-5 text-center shadow-sm">
                  <p className="text-4xl font-bold text-teal-600">{result.inserted}</p>
                  <p className="text-sm text-teal-600 font-semibold mt-1">Importados / Atualizados</p>
                </div>
                <div className="bg-orange-50 border border-orange-200 rounded-xl p-5 text-center shadow-sm">
                  <p className="text-4xl font-bold text-orange-500">{result.skipped}</p>
                  <p className="text-sm text-orange-500 font-semibold mt-1">Ignorados (sem CPF/Nome)</p>
                </div>
                <div className={`border rounded-xl p-5 text-center shadow-sm ${result.errors.length > 0 ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'}`}>
                  <p className={`text-4xl font-bold ${result.errors.length > 0 ? 'text-red-600' : 'text-green-600'}`}>{result.errors.length}</p>
                  <p className={`text-sm font-semibold mt-1 ${result.errors.length > 0 ? 'text-red-600' : 'text-green-600'}`}>Erros</p>
                </div>
              </div>

              {result.errors.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                  <p className="text-sm font-semibold text-red-700 mb-2">Detalhes dos erros:</p>
                  <ul className="space-y-1">
                    {result.errors.map((e, i) => (
                      <li key={i} className="text-xs text-red-600">{e}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => { setParsed(null); setResult(null); }}
                  className="px-6 py-2.5 border border-gray-300 text-gray-700 rounded-lg text-sm font-semibold hover:bg-gray-50 transition"
                >
                  Importar outro arquivo
                </button>
                <button
                  onClick={() => router.push('/secretaria/membros')}
                  className="px-8 py-2.5 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-sm font-bold shadow transition"
                >
                  Ver ministros →
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
