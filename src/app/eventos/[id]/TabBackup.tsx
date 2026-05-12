'use client';

import { useState, useEffect, useMemo } from 'react';
import { createClient } from '@/lib/supabase-client';
import { buildUrl, getAppBaseUrl } from '@/lib/urls';

// ─── Tipos locais ─────────────────────────────────────────────────────────
interface Evento {
  id: string; nome: string; slug: string; departamento: string;
  data_inicio: string; data_fim: string; local: string | null;
  cidade: string | null; valor_inscricao: number;
  permite_hospedagem: boolean; permite_alimentacao: boolean;
  permite_brinde: boolean; inscricoes_abertas: boolean;
  limite_vagas: number | null; limite_hospedagem: number | null;
  status: string; descricao: string | null;
}

interface Inscricao {
  id: string; nome_inscrito: string; cpf: string | null;
  email: string | null; telefone: string | null; whatsapp: string | null;
  sexo: string | null; data_nascimento: string | null;
  supervisao_id: string | null; campo_id: string | null;
  hospedagem: boolean; alimentacao: boolean; brinde: boolean;
  tipo_inscricao: string | null; valor_original: number | null;
  cupom_codigo: string | null; desconto_valor: number;
  valor_final: number | null; lote_id: string | null;
  valor_pago: number; status_pagamento: string;
  forma_pagamento: string | null; asaas_payment_id: string | null;
  checkin_realizado: boolean; checkin_at: string | null;
  etiqueta_impressa: boolean; certificado_enviado: boolean;
  observacoes: string | null; created_at: string;
}

interface Hospedagem {
  id: string; inscricao_id: string; alojamento_id: string | null;
  status: string; prioridade: number; necessidade_especial: boolean;
  descricao_necessidade: string | null; tipo_cama: string | null;
  numero_cama: string | null; observacoes: string | null;
  nome_inscrito?: string; cpf?: string | null; sexo?: string | null;
  supervisao_id?: string | null; campo_id?: string | null;
  alojamento_nome?: string | null; created_at: string;
}

interface Alojamento {
  id: string; nome: string; publico: string; sexo: string | null;
  total_vagas: number; camas_inferiores: number; camas_superiores: number;
  ativo: boolean;
}

interface Cupom {
  id: string; codigo: string; tipo: string; valor: number;
  limite_uso: number | null; usados: number; validade: string | null;
  ativo: boolean; created_at: string;
}

interface Lote {
  id: string; codigo: string; responsavel_nome: string;
  responsavel_email: string | null; responsavel_whatsapp: string | null;
  valor_total: number; status_pagamento: string;
  cupom_codigo: string | null; desconto_valor: number;
  comprovante_url: string | null; created_at: string;
}

interface TipoInscricao {
  id: string; nome: string; valor: number;
  inclui_alimentacao: boolean; inclui_hospedagem: boolean;
  ativo: boolean; ordem: number;
}

interface Notificacao {
  id: string; tipo: string; status: string; gatilho: string | null;
  assunto: string | null; mensagem: string | null;
  erro: string | null; enviado_em: string | null; created_at: string;
  inscricao_id: string | null;
  // join
  nome_inscrito?: string;
  email?: string | null;
  whatsapp?: string | null;
}

interface TabBackupProps {
  evento: Evento;
  eventoId: string;
  inscricoes: Inscricao[];
  podeVerFinanceiro: boolean;
  nomeSup: (id: string | null) => string;
  nomeCampo: (id: string | null) => string;
  supabase: ReturnType<typeof createClient>;
}

// ═══════════════════════════════════════════════════════════════════════════
// Utilitários CSV
// ═══════════════════════════════════════════════════════════════════════════
const BOM = '\uFEFF';

const DEPT_LOGOS: Record<string, string> = {
  AGO: '/img/logo_ago.png',
  COADESPA: '/img/logo_comieadepa.png',
  UMADESPA: '/img/logo_comieadepa.png',
  SEIADEPA: '/img/logo_comieadepa.png',
  AVULSO: '/img/logo_comieadepa.png',
  CONEC: '/img/logo_conec.png',
  CGADB: '/img/logo_cgadb.png',
};

function getDeptLogo(dept?: string | null): string {
  if (!dept) return '/img/logo_comieadepa.png';
  return DEPT_LOGOS[dept] ?? '/img/logo_comieadepa.png';
}

function esc(val: unknown): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'boolean') return val ? 'Sim' : 'Não';
  return String(val).replace(/"/g, '""');
}

function gerarCSV(colunas: string[], linhas: unknown[][]): string {
  const header = colunas.map(c => `"${esc(c)}"`).join(';');
  const body   = linhas.map(row => row.map(cell => `"${esc(cell)}"`).join(';')).join('\n');
  return `${BOM}${header}\n${body}`;
}

function baixarCSV(conteudo: string, nome: string) {
  const blob = new Blob([conteudo], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = nome;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

function nomeArquivo(nomeEvento: string, sufixo: string): string {
  const slug = nomeEvento.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30);
  const data = new Date().toISOString().slice(0, 10);
  return `evento-${slug}-${sufixo}-${data}.csv`;
}

function fmtData(d: string | null): string {
  if (!d) return '';
  if (d.includes('T')) return new Date(d).toLocaleString('pt-BR');
  return d.split('-').reverse().join('/');
}

function fmtMoeda(v: number | null): string {
  if (v === null || v === undefined) return '';
  return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// ═══════════════════════════════════════════════════════════════════════════
// Utilitários de Impressão
// ═══════════════════════════════════════════════════════════════════════════
function abrirJanelaPrint(titulo: string, conteudoHTML: string, logoDireita?: string) {
  const janela = window.open('', '_blank', 'width=1100,height=750');
  if (!janela) { alert('Permita pop-ups para esta página para imprimir.'); return; }
  const appBaseUrl = getAppBaseUrl();
  const logoDir = logoDireita ? buildUrl(appBaseUrl, logoDireita) : '';
  janela.document.write(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>${titulo}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; font-size: 10px; color: #000; padding: 16px; }
  .header { display: flex; align-items: center; justify-content: center; gap: 10px; }
  .header-logo { width: 58px; height: auto; flex-shrink: 0; }
  .header-center { max-width: 640px; text-align: center; }
  .header-center .org { font-size: 14px; font-weight: bold; }
  .header-center .info { font-size: 9px; color: #333; margin-top: 2px; }
  .divider { border-bottom: 2px solid #14b8a6; margin: 8px 0 10px; }
  .report-title { text-align: center; font-size: 13px; font-weight: bold; margin: 8px 0 6px; }
  .report-meta { display: flex; justify-content: space-between; font-size: 9px; margin-bottom: 8px; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  thead tr { background: #14b8a6; color: #fff; }
  th { padding: 5px 6px; text-align: left; font-size: 9px; font-weight: bold; }
  td { padding: 4px 8px; border-bottom: 1px solid #e5e7eb; font-size: 10px; }
  tr:nth-child(even) td { background: #f9fafb; }
  .cb { width: 18px; height: 18px; border: 1.5px solid #888; display: inline-block; }
  @media print { body { padding: 8px; } @page { margin: 10mm; size: A4 landscape; } }
</style>
</head>
<body>
<div class="header">
  <img class="header-logo" src="${buildUrl(appBaseUrl, '/img/logo_comieadepa.png')}" alt="COMIEADEPA" />
  <div class="header-center">
    <div class="org">COMIEADEPA</div>
    <div class="info">Rodovia Mario Covas, 2500 - do km 3.123 ao km 6.001 - lado impar lado par pertence a(o) Ananindeua - Coqueiro, Belem - PA, 66650-000</div>
    <div class="info">CNPJ: 04.760.047/0001-04 | Tel: (91) 99223-4022 | contato@comieadepa.org</div>
  </div>
  ${logoDir ? `<img class="header-logo" src="${logoDir}" alt="Departamento" />` : ''}
</div>
<div class="divider"></div>
${conteudoHTML}
<script>window.onload = () => { window.print(); }<\/script>
</body>
</html>`);
  janela.document.close();
}

// ═══════════════════════════════════════════════════════════════════════════
// Componente Principal
// ═══════════════════════════════════════════════════════════════════════════
export default function TabBackup({
  evento, eventoId, inscricoes, podeVerFinanceiro, nomeSup, nomeCampo, supabase,
}: TabBackupProps) {
  const [loadingExtra, setLoadingExtra] = useState(true);
  const [hospedagens,  setHospedagens]  = useState<Hospedagem[]>([]);
  const [alojamentos,  setAlojamentos]  = useState<Alojamento[]>([]);
  const [cupons,       setCupons]       = useState<Cupom[]>([]);
  const [lotes,        setLotes]        = useState<Lote[]>([]);
  const [tipos,        setTipos]        = useState<TipoInscricao[]>([]);
  const [notificacoes, setNotificacoes] = useState<Notificacao[]>([]);
  const [exportando,   setExportando]   = useState<string | null>(null);

  // ── Carrega dados adicionais ───────────────────────────────
  useEffect(() => {
    let cancelled = false;
    async function carregar() {
      setLoadingExtra(true);
      try {
        const [hospRes, alojRes, cupRes, loteRes, tipoRes, notifRes] = await Promise.all([
          supabase.from('evento_hospedagens').select(`
            id, inscricao_id, alojamento_id, status, prioridade,
            necessidade_especial, descricao_necessidade, tipo_cama,
            numero_cama, observacoes, created_at,
            evento_alojamentos ( nome ),
            evento_inscricoes ( nome_inscrito, cpf, sexo, supervisao_id, campo_id )
          `).eq('evento_id', eventoId).order('prioridade', { ascending: false }).order('created_at'),

          supabase.from('evento_alojamentos').select(
            'id,nome,publico,sexo,total_vagas,camas_inferiores,camas_superiores,ativo'
          ).eq('evento_id', eventoId).order('nome'),

          supabase.from('evento_cupons').select('*').eq('evento_id', eventoId).order('created_at', { ascending: false }),

          supabase.from('evento_lotes_inscricao').select(
            'id,codigo,responsavel_nome,responsavel_email,responsavel_whatsapp,valor_total,status_pagamento,cupom_codigo,desconto_valor,comprovante_url,created_at'
          ).eq('evento_id', eventoId).order('created_at', { ascending: false }),

          supabase.from('evento_tipos_inscricao').select(
            'id,nome,valor,inclui_alimentacao,inclui_hospedagem,ativo,ordem'
          ).eq('evento_id', eventoId).order('ordem'),

          supabase.from('evento_notificacoes').select(`
            id, tipo, status, gatilho, assunto, mensagem, erro, enviado_em, created_at, inscricao_id,
            evento_inscricoes ( nome_inscrito, email, whatsapp )
          `).eq('evento_id', eventoId).order('created_at', { ascending: false }).limit(2000),
        ]);

        if (cancelled) return;

        // Aplanar joins de hospedagens
        type JoinRow = Record<string, unknown>;
        const hosps = (hospRes.data ?? []).map((h: JoinRow) => {
          const insc = h.evento_inscricoes as JoinRow | null;
          const aloj = h.evento_alojamentos as JoinRow | null;
          return {
            id:                    h.id,
            inscricao_id:          h.inscricao_id,
            alojamento_id:         h.alojamento_id,
            status:                h.status,
            prioridade:            h.prioridade,
            necessidade_especial:  h.necessidade_especial,
            descricao_necessidade: h.descricao_necessidade,
            tipo_cama:             h.tipo_cama,
            numero_cama:           h.numero_cama,
            observacoes:           h.observacoes,
            created_at:            h.created_at,
            nome_inscrito:         insc?.nome_inscrito as string | undefined,
            cpf:                   insc?.cpf as string | null | undefined,
            sexo:                  insc?.sexo as string | null | undefined,
            supervisao_id:         insc?.supervisao_id as string | null | undefined,
            campo_id:              insc?.campo_id as string | null | undefined,
            alojamento_nome:       aloj?.nome as string | null | undefined,
          } as Hospedagem;
        });

        // Aplanar joins de notificações
        const notifs = (notifRes.data ?? []).map((n: JoinRow) => {
          const insc = n.evento_inscricoes as JoinRow | null;
          return {
            id:           n.id,
            tipo:         n.tipo,
            status:       n.status,
            gatilho:      n.gatilho,
            assunto:      n.assunto,
            mensagem:     n.mensagem,
            erro:         n.erro,
            enviado_em:   n.enviado_em,
            created_at:   n.created_at,
            inscricao_id: n.inscricao_id,
            nome_inscrito: insc?.nome_inscrito as string | undefined,
            email:        insc?.email as string | null | undefined,
            whatsapp:     insc?.whatsapp as string | null | undefined,
          } as Notificacao;
        });

        setHospedagens(hosps);
        setAlojamentos((alojRes.data ?? []) as Alojamento[]);
        setCupons((cupRes.data ?? []) as Cupom[]);
        setLotes((loteRes.data ?? []) as Lote[]);
        setTipos((tipoRes.data ?? []) as TipoInscricao[]);
        setNotificacoes(notifs);
      } finally {
        if (!cancelled) setLoadingExtra(false);
      }
    }
    carregar();
    return () => { cancelled = true; };
  }, [eventoId, supabase]);

  // ── Stats rápidos ──────────────────────────────────────────
  const stats = useMemo(() => ({
    total:       inscricoes.length,
    pagos:       inscricoes.filter(i => i.status_pagamento === 'pago').length,
    pendentes:   inscricoes.filter(i => i.status_pagamento === 'pendente').length,
    checkins:    inscricoes.filter(i => i.checkin_realizado).length,
    hospNaSolicitadas: hospedagens.filter(h => h.status === 'solicitada').length,
    hospConfirmadas:   hospedagens.filter(h => h.status === 'confirmada').length,
    hospEspera:        hospedagens.filter(h => h.status === 'lista_espera').length,
    etiqPendentes: inscricoes.filter(i => !i.etiqueta_impressa && i.checkin_realizado).length,
    arrecadado:    inscricoes
      .filter(i => i.status_pagamento === 'pago')
      .reduce((a, i) => a + (i.valor_pago || 0), 0),
  }), [inscricoes, hospedagens]);

  // ════════════════════════════════════════════════════════════
  // Funções de Exportação CSV
  // ════════════════════════════════════════════════════════════

  function exportInscritos() {
    setExportando('inscritos');
    const cols = ['Nome', 'CPF', 'Email', 'Telefone', 'WhatsApp', 'Sexo', 'Nascimento',
      'Supervisão', 'Campo', 'Hospedagem', 'Alimentação', 'Brinde',
      'Tipo Inscrição', 'Status Pagamento', 'Check-in', 'Check-in em',
      'Etiqueta Impressa', 'Certificado', 'Observações', 'Data Inscrição'];
    const linhas = inscricoes.map(i => [
      i.nome_inscrito, i.cpf, i.email, i.telefone, i.whatsapp,
      i.sexo, fmtData(i.data_nascimento),
      nomeSup(i.supervisao_id), nomeCampo(i.campo_id),
      i.hospedagem, i.alimentacao, i.brinde,
      i.tipo_inscricao, i.status_pagamento,
      i.checkin_realizado, fmtData(i.checkin_at),
      i.etiqueta_impressa, i.certificado_enviado,
      i.observacoes, fmtData(i.created_at),
    ]);
    baixarCSV(gerarCSV(cols, linhas), nomeArquivo(evento.nome, 'inscritos'));
    setExportando(null);
  }

  function exportFinanceiro() {
    if (!podeVerFinanceiro) return;
    setExportando('financeiro');
    const cols = ['Nome', 'CPF', 'Lote/Individual', 'Tipo Inscrição',
      'Valor Original', 'Cupom', 'Desconto', 'Valor Final',
      'Valor Pago', 'Status Pagamento', 'Forma Pagamento',
      'Asaas ID', 'Data Inscrição'];
    const linhas = inscricoes.map(i => [
      i.nome_inscrito, i.cpf,
      i.lote_id ? 'Lote' : 'Individual',
      i.tipo_inscricao,
      fmtMoeda(i.valor_original),
      i.cupom_codigo,
      fmtMoeda(i.desconto_valor),
      fmtMoeda(i.valor_final),
      fmtMoeda(i.valor_pago),
      i.status_pagamento, i.forma_pagamento,
      i.asaas_payment_id, fmtData(i.created_at),
    ]);
    baixarCSV(gerarCSV(cols, linhas), nomeArquivo(evento.nome, 'financeiro'));
    setExportando(null);
  }

  function exportCheckins() {
    setExportando('checkins');
    const cols = ['Nome', 'CPF', 'WhatsApp', 'Supervisão', 'Campo',
      'Check-in Realizado', 'Check-in em', 'Etiqueta Impressa'];
    const linhas = inscricoes.map(i => [
      i.nome_inscrito, i.cpf, i.whatsapp,
      nomeSup(i.supervisao_id), nomeCampo(i.campo_id),
      i.checkin_realizado, fmtData(i.checkin_at), i.etiqueta_impressa,
    ]);
    baixarCSV(gerarCSV(cols, linhas), nomeArquivo(evento.nome, 'checkins'));
    setExportando(null);
  }

  function exportHospedagem() {
    setExportando('hospedagem');
    const cols = ['Nome', 'CPF', 'Sexo', 'Supervisão', 'Campo',
      'Status Hospedagem', 'Alojamento', 'Tipo Cama', 'Número Cama',
      'Necessidade Especial', 'Descrição Necessidade', 'Observações',
      'Prioridade', 'Data Solicitação'];
    const linhas = hospedagens.map(h => [
      h.nome_inscrito, h.cpf, h.sexo,
      nomeSup(h.supervisao_id ?? null), nomeCampo(h.campo_id ?? null),
      h.status, h.alojamento_nome, h.tipo_cama, h.numero_cama,
      h.necessidade_especial, h.descricao_necessidade, h.observacoes,
      h.prioridade, fmtData(h.created_at),
    ]);
    baixarCSV(gerarCSV(cols, linhas), nomeArquivo(evento.nome, 'hospedagem'));
    setExportando(null);
  }

  function exportAlojamentos() {
    setExportando('alojamentos');
    const cols = ['Nome', 'Público', 'Sexo', 'Total Vagas',
      'Camas Inferiores', 'Camas Superiores', 'Ativo'];
    const linhas = alojamentos.map(a => [
      a.nome, a.publico, a.sexo ?? '',
      a.total_vagas, a.camas_inferiores, a.camas_superiores, a.ativo,
    ]);
    baixarCSV(gerarCSV(cols, linhas), nomeArquivo(evento.nome, 'alojamentos'));
    setExportando(null);
  }

  function exportEtiquetas() {
    setExportando('etiquetas');
    const cols = ['Nome', 'CPF', 'Supervisão', 'Campo',
      'Tipo Inscrição', 'Status Pagamento',
      'Check-in', 'Etiqueta Impressa'];
    const linhas = inscricoes.map(i => [
      i.nome_inscrito, i.cpf,
      nomeSup(i.supervisao_id), nomeCampo(i.campo_id),
      i.tipo_inscricao, i.status_pagamento,
      i.checkin_realizado, i.etiqueta_impressa,
    ]);
    baixarCSV(gerarCSV(cols, linhas), nomeArquivo(evento.nome, 'etiquetas'));
    setExportando(null);
  }

  function exportCupons() {
    setExportando('cupons');
    const cols = ['Código', 'Tipo', 'Valor', 'Limite de Uso', 'Usados', 'Validade', 'Ativo', 'Criado em'];
    const linhas = cupons.map(c => [
      c.codigo, c.tipo, fmtMoeda(c.valor),
      c.limite_uso ?? 'Ilimitado', c.usados,
      fmtData(c.validade), c.ativo, fmtData(c.created_at),
    ]);
    baixarCSV(gerarCSV(cols, linhas), nomeArquivo(evento.nome, 'cupons'));
    setExportando(null);
  }

  function exportLotes() {
    setExportando('lotes');
    const cols = ['Código', 'Responsável', 'Email', 'WhatsApp',
      'Valor Total', 'Status Pagamento', 'Cupom', 'Desconto', 'Criado em'];
    const linhas = lotes.map(l => [
      l.codigo, l.responsavel_nome, l.responsavel_email, l.responsavel_whatsapp,
      fmtMoeda(l.valor_total), l.status_pagamento,
      l.cupom_codigo ?? '', fmtMoeda(l.desconto_valor), fmtData(l.created_at),
    ]);
    baixarCSV(gerarCSV(cols, linhas), nomeArquivo(evento.nome, 'lotes'));
    setExportando(null);
  }

  function exportTipos() {
    setExportando('tipos');
    const cols = ['Nome', 'Valor', 'Inclui Alimentação', 'Inclui Hospedagem', 'Ativo', 'Ordem'];
    const linhas = tipos.map(t => [
      t.nome, fmtMoeda(t.valor), t.inclui_alimentacao, t.inclui_hospedagem, t.ativo, t.ordem,
    ]);
    baixarCSV(gerarCSV(cols, linhas), nomeArquivo(evento.nome, 'tipos-inscricao'));
    setExportando(null);
  }

  function exportComunicacao() {
    setExportando('comunicacao');
    const cols = ['Inscrito', 'Email', 'WhatsApp', 'Tipo', 'Gatilho',
      'Assunto', 'Status', 'Enviado em', 'Erro', 'Criado em'];
    const linhas = notificacoes.map(n => [
      n.nome_inscrito ?? '', n.email ?? '', n.whatsapp ?? '',
      n.tipo, n.gatilho, n.assunto,
      n.status, fmtData(n.enviado_em), n.erro, fmtData(n.created_at),
    ]);
    baixarCSV(gerarCSV(cols, linhas), nomeArquivo(evento.nome, 'comunicacao'));
    setExportando(null);
  }

  function exportEvento() {
    setExportando('evento');
    const cols = ['Campo', 'Valor'];
    const linhas: unknown[][] = [
      ['Nome',                evento.nome],
      ['Slug',                evento.slug],
      ['Departamento',        evento.departamento],
      ['Status',              evento.status],
      ['Data Início',         fmtData(evento.data_inicio)],
      ['Data Fim',            fmtData(evento.data_fim)],
      ['Local',               evento.local ?? ''],
      ['Cidade',              evento.cidade ?? ''],
      ['Valor Inscrição',     fmtMoeda(evento.valor_inscricao)],
      ['Inscrições Abertas',  evento.inscricoes_abertas],
      ['Limite Vagas',        evento.limite_vagas ?? 'Sem limite'],
      ['Permite Hospedagem',  evento.permite_hospedagem],
      ['Limite Hospedagem',   evento.limite_hospedagem ?? 'Sem limite'],
      ['Permite Alimentação', evento.permite_alimentacao],
      ['Permite Brinde',      evento.permite_brinde],
      ['Total Inscritos',     inscricoes.length],
      ['Total Checkins',      stats.checkins],
      ['Total Pagos',         stats.pagos],
      ['Total Pendentes',     stats.pendentes],
    ];
    if (podeVerFinanceiro) {
      linhas.push(['Total Arrecadado', fmtMoeda(stats.arrecadado)]);
    }
    baixarCSV(gerarCSV(cols, linhas), nomeArquivo(evento.nome, 'dados-evento'));
    setExportando(null);
  }

  // ─── Pacote Emergencial ───────────────────────────────────
  async function exportPacoteEmergencial() {
    setExportando('pacote');

    const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
    const slug  = evento.nome.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30);
    const data  = new Date().toISOString().slice(0, 10);
    const pfx   = `evento-${slug}`;

    // 1. Lista geral inscritos
    const cols1 = ['Nome', 'CPF', 'WhatsApp', 'Supervisão', 'Campo',
      'Status Pagamento', 'Hospedagem', 'Alimentação', 'Check-in', 'Check-in em'];
    const linhas1 = inscricoes.map(i => [
      i.nome_inscrito, i.cpf, i.whatsapp,
      nomeSup(i.supervisao_id), nomeCampo(i.campo_id),
      i.status_pagamento, i.hospedagem, i.alimentacao,
      i.checkin_realizado, fmtData(i.checkin_at),
    ]);
    baixarCSV(gerarCSV(cols1, linhas1), `${pfx}-inscritos-${data}.csv`);
    await delay(400);

    // 2. Presentes (checkin realizado)
    const presentes = inscricoes.filter(i => i.checkin_realizado);
    const cols2 = ['Nome', 'CPF', 'WhatsApp', 'Supervisão', 'Campo', 'Check-in em'];
    const linhas2 = presentes.map(i => [
      i.nome_inscrito, i.cpf, i.whatsapp,
      nomeSup(i.supervisao_id), nomeCampo(i.campo_id), fmtData(i.checkin_at),
    ]);
    baixarCSV(gerarCSV(cols2, linhas2), `${pfx}-presentes-${data}.csv`);
    await delay(400);

    // 3. Pendentes de pagamento
    const pendentes = inscricoes.filter(i => i.status_pagamento === 'pendente');
    const cols3 = ['Nome', 'CPF', 'WhatsApp', 'Supervisão', 'Campo', 'Valor Final', 'Data Inscrição'];
    const linhas3 = pendentes.map(i => [
      i.nome_inscrito, i.cpf, i.whatsapp,
      nomeSup(i.supervisao_id), nomeCampo(i.campo_id),
      fmtMoeda(i.valor_final), fmtData(i.created_at),
    ]);
    baixarCSV(gerarCSV(cols3, linhas3), `${pfx}-pendentes-pagamento-${data}.csv`);
    await delay(400);

    // 4. Hospedagem
    if (hospedagens.length > 0) {
      const cols4 = ['Nome', 'CPF', 'Sexo', 'Supervisão', 'Campo',
        'Status', 'Alojamento', 'Tipo Cama', 'Número Cama', 'Necessidade Especial'];
      const linhas4 = hospedagens.map(h => [
        h.nome_inscrito, h.cpf, h.sexo,
        nomeSup(h.supervisao_id ?? null), nomeCampo(h.campo_id ?? null),
        h.status, h.alojamento_nome, h.tipo_cama, h.numero_cama,
        h.necessidade_especial,
      ]);
      baixarCSV(gerarCSV(cols4, linhas4), `${pfx}-hospedagem-${data}.csv`);
      await delay(400);
    }

    // 5. Lista de espera (hospedagem)
    const espera = hospedagens.filter(h => h.status === 'lista_espera');
    if (espera.length > 0) {
      const cols5 = ['Nome', 'CPF', 'Sexo', 'Supervisão', 'Campo', 'Prioridade', 'Data Solicitação'];
      const linhas5 = espera.map(h => [
        h.nome_inscrito, h.cpf, h.sexo,
        nomeSup(h.supervisao_id ?? null), nomeCampo(h.campo_id ?? null),
        h.prioridade, fmtData(h.created_at),
      ]);
      baixarCSV(gerarCSV(cols5, linhas5), `${pfx}-lista-espera-${data}.csv`);
      await delay(400);
    }

    // 6. Etiquetas pendentes (checkin feito, mas etiqueta não impressa)
    const etiqPend = inscricoes.filter(i => i.checkin_realizado && !i.etiqueta_impressa);
    if (etiqPend.length > 0) {
      const cols6 = ['Nome', 'CPF', 'Supervisão', 'Campo', 'Tipo Inscrição', 'Check-in em'];
      const linhas6 = etiqPend.map(i => [
        i.nome_inscrito, i.cpf,
        nomeSup(i.supervisao_id), nomeCampo(i.campo_id),
        i.tipo_inscricao, fmtData(i.checkin_at),
      ]);
      baixarCSV(gerarCSV(cols6, linhas6), `${pfx}-etiquetas-pendentes-${data}.csv`);
      await delay(400);
    }

    // 7. Resumo financeiro (se permitido)
    if (podeVerFinanceiro) {
      const cols7 = ['Métrica', 'Valor'];
      const linhas7: unknown[][] = [
        ['Total Inscritos', inscricoes.length],
        ['Total Pagos',     stats.pagos],
        ['Total Pendentes', stats.pendentes],
        ['Total Isentos',   inscricoes.filter(i => i.status_pagamento === 'isento').length],
        ['Total Check-ins', stats.checkins],
        ['Total Arrecadado', fmtMoeda(stats.arrecadado)],
        ['Total Hospedagens', hospedagens.length],
        ['Hospedagens Confirmadas', stats.hospConfirmadas],
        ['Hospedagens Lista Espera', stats.hospEspera],
      ];
      baixarCSV(gerarCSV(cols7, linhas7), `${pfx}-resumo-financeiro-${data}.csv`);
      await delay(400);
    }

    setExportando(null);
  }

  // ─── Exportar tudo ────────────────────────────────────────
  async function exportTudo() {
    setExportando('tudo');
    const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
    exportInscritos(); await delay(500);
    exportCheckins();  await delay(500);
    exportEtiquetas(); await delay(500);
    exportHospedagem(); await delay(500);
    if (alojamentos.length > 0) { exportAlojamentos(); await delay(500); }
    if (cupons.length > 0)      { exportCupons();       await delay(500); }
    if (lotes.length > 0)       { exportLotes();         await delay(500); }
    if (tipos.length > 0)       { exportTipos();         await delay(500); }
    if (notificacoes.length > 0){ exportComunicacao();   await delay(500); }
    exportEvento(); await delay(500);
    if (podeVerFinanceiro)      { exportFinanceiro(); }
    setExportando(null);
  }

  // ════════════════════════════════════════════════════════════
  // Funções de Impressão
  // ════════════════════════════════════════════════════════════

  function imprimirLista() {
    const titulo = `${evento.nome} — Lista Geral de Inscritos`;
    const logoDept = getDeptLogo(evento.departamento);
    const linhas = inscricoes.map((i, idx) => `
      <tr>
        <td>${idx + 1}</td>
        <td>${esc(i.nome_inscrito)}</td>
        <td>${esc(i.cpf)}</td>
        <td>${esc(nomeSup(i.supervisao_id))}</td>
        <td>${esc(nomeCampo(i.campo_id))}</td>
        <td>${esc(i.status_pagamento)}</td>
        <td>${i.hospedagem ? 'Sim' : '-'}</td>
      </tr>`).join('');
    abrirJanelaPrint(titulo, `
      <div class="report-title">${titulo}</div>
      <div class="report-meta">
        <div>Total de registros: ${inscricoes.length}</div>
        <div>Data: ${new Date().toLocaleDateString('pt-BR')}</div>
      </div>
      <table>
        <thead><tr><th>#</th><th>Nome</th><th>CPF</th><th>Supervisao</th><th>Campo</th><th>Pagamento</th><th>Hosp.</th></tr></thead>
        <tbody>${linhas}</tbody>
      </table>`, logoDept);
  }

  function imprimirPresenca() {
    const titulo = `${evento.nome} — Lista de Presença`;
    const logoDept = getDeptLogo(evento.departamento);
    const linhas = inscricoes.map((i, idx) => `
      <tr>
        <td>${idx + 1}</td>
        <td>${esc(i.nome_inscrito)}</td>
        <td>${esc(i.cpf)}</td>
        <td>${esc(nomeSup(i.supervisao_id))}</td>
        <td>${esc(nomeCampo(i.campo_id))}</td>
        <td style="text-align:center">${i.checkin_realizado ? '✓' : '<span class="cb"></span>'}</td>
        <td>${esc(fmtData(i.checkin_at))}</td>
      </tr>`).join('');
    abrirJanelaPrint(titulo, `
      <div class="report-title">${titulo}</div>
      <div class="report-meta">
        <div>Total de registros: ${inscricoes.length}</div>
        <div>Data: ${new Date().toLocaleDateString('pt-BR')}</div>
      </div>
      <table>
        <thead><tr><th>#</th><th>Nome</th><th>CPF</th><th>Supervisao</th><th>Campo</th><th>✓</th><th>Hora Check-in</th></tr></thead>
        <tbody>${linhas}</tbody>
      </table>`, logoDept);
  }

  function imprimirHospedagem() {
    const titulo = `${evento.nome} — Lista de Hospedagem`;
    const logoDept = getDeptLogo(evento.departamento);
    const linhas = hospedagens.map((h, idx) => `
      <tr>
        <td>${idx + 1}</td>
        <td>${esc(h.nome_inscrito)}</td>
        <td>${esc(h.cpf)}</td>
        <td>${esc(h.sexo)}</td>
        <td>${esc(h.alojamento_nome)}</td>
        <td>${esc(h.tipo_cama)}</td>
        <td>${esc(h.numero_cama)}</td>
        <td>${esc(h.status)}</td>
      </tr>`).join('');
    abrirJanelaPrint(titulo, `
      <div class="report-title">${titulo}</div>
      <div class="report-meta">
        <div>Total de registros: ${hospedagens.length}</div>
        <div>Data: ${new Date().toLocaleDateString('pt-BR')}</div>
      </div>
      <table>
        <thead><tr><th>#</th><th>Nome</th><th>CPF</th><th>Sexo</th><th>Alojamento</th><th>Cama</th><th>Nº</th><th>Status</th></tr></thead>
        <tbody>${linhas}</tbody>
      </table>`, logoDept);
  }

  function imprimirFinanceiro() {
    if (!podeVerFinanceiro) return;
    const titulo = `${evento.nome} — Relatório Financeiro`;
    const logoDept = getDeptLogo(evento.departamento);
    const linhas = inscricoes.map((i, idx) => `
      <tr>
        <td>${idx + 1}</td>
        <td>${esc(i.nome_inscrito)}</td>
        <td>${esc(i.cpf)}</td>
        <td>${esc(fmtMoeda(i.valor_final))}</td>
        <td>${esc(fmtMoeda(i.valor_pago))}</td>
        <td>${esc(i.status_pagamento)}</td>
        <td>${esc(i.forma_pagamento)}</td>
      </tr>`).join('');
    abrirJanelaPrint(titulo, `
      <div class="report-title">${titulo}</div>
      <div class="report-meta">
        <div>Total de registros: ${inscricoes.length}</div>
        <div>Data: ${new Date().toLocaleDateString('pt-BR')}</div>
      </div>
      <table>
        <thead><tr><th>#</th><th>Nome</th><th>CPF</th><th>Valor</th><th>Valor Pago</th><th>Status</th><th>Forma Pag.</th></tr></thead>
        <tbody>${linhas}</tbody>
      </table>`, logoDept);
  }

  // ════════════════════════════════════════════════════════════
  // Render
  // ════════════════════════════════════════════════════════════
  const loading = loadingExtra;
  const btnBase = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed';
  const btnPrimary  = `${btnBase} bg-[#123b63] text-white hover:bg-[#0f2a45]`;
  const btnSecondary = `${btnBase} bg-gray-100 text-gray-700 hover:bg-gray-200`;
  const btnDanger   = `${btnBase} bg-amber-500 text-white hover:bg-amber-600`;

  return (
    <div className="space-y-6">

      {/* ── Pacote Emergencial ─────────────────────────────── */}
      <div className="bg-gradient-to-r from-[#0D2B4E] to-[#123b63] rounded-xl p-6 text-white shadow-lg">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold mb-1">📦 Pacote Emergencial do Evento</h2>
            <p className="text-sm text-white/70">
              Gera e baixa automaticamente todos os arquivos críticos: inscritos, presentes,
              pendentes, hospedagem, etiquetas{podeVerFinanceiro ? ' e resumo financeiro' : ''}.
              Ideal para uso offline durante o evento.
            </p>
          </div>
          <div className="flex flex-wrap gap-3 flex-shrink-0">
            <button
              onClick={exportPacoteEmergencial}
              disabled={exportando !== null || loading}
              className={`${btnDanger} px-5 py-2.5 text-sm font-bold shadow`}
            >
              {exportando === 'pacote' ? '⏳ Gerando...' : '🚨 Gerar Pacote Emergencial'}
            </button>
            <button
              onClick={exportTudo}
              disabled={exportando !== null || loading}
              className={`${btnBase} bg-white/20 text-white hover:bg-white/30 px-4 py-2 text-sm`}
            >
              {exportando === 'tudo' ? '⏳ Exportando...' : '📥 Exportar Tudo'}
            </button>
          </div>
        </div>

        {/* Contadores resumidos */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 mt-5 pt-4 border-t border-white/20">
          {[
            { label: 'Inscritos',   value: stats.total },
            { label: 'Presentes',   value: stats.checkins },
            { label: 'Pendentes $', value: stats.pendentes },
            { label: 'Hospedagem',  value: hospedagens.length },
            { label: 'Espera',      value: stats.hospEspera },
            { label: 'Etiq. pend.', value: stats.etiqPendentes },
          ].map(s => (
            <div key={s.label} className="text-center">
              <p className="text-xl font-bold">{loading ? '…' : s.value}</p>
              <p className="text-xs text-white/60">{s.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Exportações Individuais ────────────────────────── */}
      <div>
        <h3 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
          <span>📄</span> Exportações CSV Individuais
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">

          {/* Inscritos */}
          <ExportCard
            icon="👥" titulo="Lista de Inscritos"
            descricao={`${inscricoes.length} inscritos no total`}
            tags={['Todos os dados', 'Checkin', 'Hospedagem']}
            carregando={exportando === 'inscritos'}
            disabled={exportando !== null}
          >
            <button onClick={exportInscritos} disabled={exportando !== null} className={btnPrimary}>
              📥 Exportar CSV
            </button>
            <button onClick={imprimirLista} className={btnSecondary}>
              🖨️ Imprimir
            </button>
          </ExportCard>

          {/* Financeiro */}
          {podeVerFinanceiro && (
            <ExportCard
              icon="💳" titulo="Dados Financeiros"
              descricao={`${stats.pagos} pagos · ${stats.pendentes} pendentes · ${fmtMoeda(stats.arrecadado)}`}
              tags={['Valores', 'Status Pag.', 'Formas de Pagamento']}
              carregando={exportando === 'financeiro'}
              disabled={exportando !== null}
            >
              <button onClick={exportFinanceiro} disabled={exportando !== null} className={btnPrimary}>
                📥 Exportar CSV
              </button>
              <button onClick={imprimirFinanceiro} className={btnSecondary}>
                🖨️ Imprimir
              </button>
            </ExportCard>
          )}

          {/* Check-ins */}
          <ExportCard
            icon="✅" titulo="Registro de Check-ins"
            descricao={`${stats.checkins} check-ins realizados de ${inscricoes.length}`}
            tags={['Check-in', 'Horário', 'Etiquetas']}
            carregando={exportando === 'checkins'}
            disabled={exportando !== null}
          >
            <button onClick={exportCheckins} disabled={exportando !== null} className={btnPrimary}>
              📥 Exportar CSV
            </button>
            <button onClick={imprimirPresenca} className={btnSecondary}>
              🖨️ Lista Presença
            </button>
          </ExportCard>

          {/* Hospedagem */}
          <ExportCard
            icon="🏨" titulo="Hospedagem"
            descricao={loading
              ? 'Carregando...'
              : `${hospedagens.length} solicitações · ${stats.hospConfirmadas} confirmadas · ${stats.hospEspera} em espera`}
            tags={['Alojamentos', 'Tipo Cama', 'Status']}
            carregando={exportando === 'hospedagem'}
            disabled={exportando !== null || loading}
          >
            <button onClick={exportHospedagem} disabled={exportando !== null || loading || hospedagens.length === 0} className={btnPrimary}>
              📥 Exportar CSV
            </button>
            <button onClick={imprimirHospedagem} disabled={loading || hospedagens.length === 0} className={btnSecondary}>
              🖨️ Imprimir
            </button>
          </ExportCard>

          {/* Alojamentos */}
          <ExportCard
            icon="🏠" titulo="Alojamentos / Quartos"
            descricao={loading ? 'Carregando...' : `${alojamentos.length} alojamento(s) cadastrado(s)`}
            tags={['Vagas', 'Camas', 'Capacidade']}
            carregando={exportando === 'alojamentos'}
            disabled={exportando !== null || loading}
          >
            <button onClick={exportAlojamentos} disabled={exportando !== null || loading || alojamentos.length === 0} className={btnPrimary}>
              📥 Exportar CSV
            </button>
          </ExportCard>

          {/* Etiquetas */}
          <ExportCard
            icon="🏷️" titulo="Etiquetas / Crachás"
            descricao={`${stats.etiqPendentes} etiqueta(s) pendente(s) de impressão`}
            tags={['Impressas', 'Pendentes', 'Check-in']}
            carregando={exportando === 'etiquetas'}
            disabled={exportando !== null}
          >
            <button onClick={exportEtiquetas} disabled={exportando !== null} className={btnPrimary}>
              📥 Exportar CSV
            </button>
          </ExportCard>

          {/* Cupons */}
          <ExportCard
            icon="🎟️" titulo="Cupons de Desconto"
            descricao={loading ? 'Carregando...' : `${cupons.length} cupom(ns) cadastrado(s)`}
            tags={['Códigos', 'Descontos', 'Usos']}
            carregando={exportando === 'cupons'}
            disabled={exportando !== null || loading}
          >
            <button onClick={exportCupons} disabled={exportando !== null || loading || cupons.length === 0} className={btnPrimary}>
              📥 Exportar CSV
            </button>
          </ExportCard>

          {/* Lotes */}
          <ExportCard
            icon="📋" titulo="Lotes de Inscrição"
            descricao={loading ? 'Carregando...' : `${lotes.length} lote(s) gerado(s)`}
            tags={['Responsáveis', 'Valores', 'Status']}
            carregando={exportando === 'lotes'}
            disabled={exportando !== null || loading}
          >
            <button onClick={exportLotes} disabled={exportando !== null || loading || lotes.length === 0} className={btnPrimary}>
              📥 Exportar CSV
            </button>
          </ExportCard>

          {/* Tipos de Inscrição */}
          <ExportCard
            icon="🎫" titulo="Tipos de Inscrição"
            descricao={loading ? 'Carregando...' : `${tipos.length} tipo(s) configurado(s)`}
            tags={['Valores', 'Benefícios', 'Ativos']}
            carregando={exportando === 'tipos'}
            disabled={exportando !== null || loading}
          >
            <button onClick={exportTipos} disabled={exportando !== null || loading || tipos.length === 0} className={btnPrimary}>
              📥 Exportar CSV
            </button>
          </ExportCard>

          {/* Comunicação */}
          <ExportCard
            icon="📣" titulo="Comunicação / Notificações"
            descricao={loading ? 'Carregando...' : `${notificacoes.length} notificação(ões) registrada(s)`}
            tags={['Email', 'WhatsApp', 'Status Envio']}
            carregando={exportando === 'comunicacao'}
            disabled={exportando !== null || loading}
          >
            <button onClick={exportComunicacao} disabled={exportando !== null || loading || notificacoes.length === 0} className={btnPrimary}>
              📥 Exportar CSV
            </button>
          </ExportCard>

          {/* Dados do Evento */}
          <ExportCard
            icon="📅" titulo="Dados do Evento"
            descricao="Configurações gerais e resumo do evento"
            tags={['Configurações', 'Resumo', 'Estatísticas']}
            carregando={exportando === 'evento'}
            disabled={exportando !== null}
          >
            <button onClick={exportEvento} disabled={exportando !== null} className={btnPrimary}>
              📥 Exportar CSV
            </button>
          </ExportCard>

        </div>
      </div>

      {/* ── Impressão ──────────────────────────────────────── */}
      <div>
        <h3 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
          <span>🖨️</span> Impressão Direta
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">

          <PrintCard icon="👥" titulo="Lista Geral" descricao="Todos os inscritos com dados básicos">
            <button onClick={imprimirLista} className={btnPrimary}>🖨️ Imprimir</button>
          </PrintCard>

          <PrintCard icon="✅" titulo="Lista de Presença" descricao="Com checkbox de confirmação por inscrição">
            <button onClick={imprimirPresenca} className={btnPrimary}>🖨️ Imprimir</button>
          </PrintCard>

          <PrintCard
            icon="🏨" titulo="Hospedagem"
            descricao={`${hospedagens.length} solicitações de hospedagem`}
          >
            <button onClick={imprimirHospedagem} disabled={loading || hospedagens.length === 0} className={btnPrimary}>
              🖨️ Imprimir
            </button>
          </PrintCard>

          {podeVerFinanceiro && (
            <PrintCard icon="💳" titulo="Relatório Financeiro" descricao="Valores, status e formas de pagamento">
              <button onClick={imprimirFinanceiro} className={btnPrimary}>🖨️ Imprimir</button>
            </PrintCard>
          )}
        </div>
      </div>

      {/* ── Nota informativa ───────────────────────────────── */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-700">
        <strong>ℹ️ Sobre os arquivos exportados:</strong>{' '}
        Todos os CSVs são gerados com codificação UTF-8 + BOM para abertura correta no Excel.
        Use ponto-e-vírgula como separador ao importar. Os arquivos são gerados sob demanda —
        nenhum dado é armazenado em servidor.
      </div>
    </div>
  );
}

// ─── Sub-componentes utilitários ─────────────────────────────────────────
function ExportCard({
  icon, titulo, descricao, tags, carregando, disabled, children,
}: {
  icon: string; titulo: string; descricao: string; tags: string[];
  carregando?: boolean; disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`bg-white rounded-xl border p-4 flex flex-col gap-3 transition ${
      disabled && !carregando ? 'opacity-60' : ''} shadow-sm ${carregando ? 'border-[#123b63]' : 'border-gray-200'}`}>
      <div className="flex items-start gap-3">
        <span className="text-2xl">{icon}</span>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm text-gray-800 flex items-center gap-1.5">
            {titulo}
            {carregando && <span className="text-xs text-[#123b63] animate-pulse">Gerando…</span>}
          </p>
          <p className="text-xs text-gray-500 mt-0.5 truncate">{descricao}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-1 mb-1">
        {tags.map(t => (
          <span key={t} className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">{t}</span>
        ))}
      </div>
      <div className="flex flex-wrap gap-2 mt-auto pt-1 border-t border-gray-100">
        {children}
      </div>
    </div>
  );
}

function PrintCard({
  icon, titulo, descricao, children,
}: {
  icon: string; titulo: string; descricao: string; children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col gap-3 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="text-2xl">{icon}</span>
        <div>
          <p className="font-semibold text-sm text-gray-800">{titulo}</p>
          <p className="text-xs text-gray-500 mt-0.5">{descricao}</p>
        </div>
      </div>
      <div className="mt-auto pt-2 border-t border-gray-100">
        {children}
      </div>
    </div>
  );
}
