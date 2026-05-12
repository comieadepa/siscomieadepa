'use client';

import { useState, useEffect, useMemo } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase-client';
import { buildUrl, getAppBaseUrl } from '@/lib/urls';

// ─── Tipos locais ─────────────────────────────────────────────
interface Supervisao { id: string; nome: string; }
interface Campo      { id: string; nome: string; supervisao_id: string; }
interface Evento     { id: string; nome: string; departamento: string; data_inicio: string; data_fim: string; cidade: string | null; }
interface Inscricao  {
  id: string; nome_inscrito: string; cpf: string | null;
  whatsapp: string | null; supervisao_id: string | null; campo_id: string | null;
  status_pagamento: string; forma_pagamento: string | null;
  valor_pago: number; checkin_realizado: boolean; checkin_at: string | null;
  hospedagem: boolean; alimentacao: boolean; brinde: boolean;
  etiqueta_impressa: boolean; created_at: string;
}

type RelTipo = 'resumo' | 'supervisao' | 'campo' | 'hospedagem' | 'alimentacao' | 'presenca' | 'financeiro';

// ─── Formatadores ─────────────────────────────────────────────
const fmtData = (d: string | null) => {
  if (!d) return '-';
  const [y, m, day] = d.slice(0, 10).split('-');
  return `${day}/${m}/${y}`;
};
const fmtMoeda = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtDT = (d: string | null) => {
  if (!d) return '-';
  return new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
};

const STATUS_LABEL: Record<string, string> = {
  pago: 'Pago', pendente: 'Pendente', isento: 'Isento', cancelado: 'Cancelado',
};

const DEPT_LOGOS: Record<string, string> = {
  AGO: '/img/logo_ago.png',
  COADESPA: '/img/logo_comieadepa.png',
  UMADESPA: '/img/logo_comieadepa.png',
  SEIADEPA: '/img/logo_comieadepa.png',
  AVULSO: '/img/logo_comieadepa.png',
  CONEC: '/img/logo_conec.png',
  CGADB: '/img/logo_cgadb.png',
};

const getDeptLogo = (dept?: string | null) => {
  if (!dept) return '/img/logo_comieadepa.png';
  return DEPT_LOGOS[dept] ?? '/img/logo_comieadepa.png';
};

// ─── Estilos de tabela ────────────────────────────────────────
const thS: React.CSSProperties = {
  textAlign: 'left', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase',
  letterSpacing: '0.04em', padding: '8px 10px', backgroundColor: '#F3F4F6', color: '#6B7280',
  borderBottom: '1px solid #E5E7EB',
};
const tdS: React.CSSProperties = {
  fontSize: '12px', padding: '7px 10px', color: '#374151', borderBottom: '1px solid #F9FAFB',
};
const tdNumS: React.CSSProperties = { ...tdS, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };

// ─── Componente principal ─────────────────────────────────────
export default function RelatoriosPrintPage() {
  const params       = useParams();
  const searchParams = useSearchParams();
  const id           = params?.id as string;

  const tipo         = (searchParams?.get('tipo') ?? 'resumo') as RelTipo;
  const podeFinanc   = searchParams?.get('fin') === '1';
  const filtroSup    = searchParams?.get('sup') ?? '';
  const filtroCampo  = searchParams?.get('campo') ?? '';
  const filtroPag    = searchParams?.get('pag') ?? '';
  const filtroCheckin= searchParams?.get('checkin') ?? '';

  const supabase = useMemo(() => createClient(), []);
  const [evento,      setEvento]      = useState<Evento | null>(null);
  const [inscricoes,  setInscricoes]  = useState<Inscricao[]>([]);
  const [supervisoes, setSupervisoes] = useState<Supervisao[]>([]);
  const [campos,      setCampos]      = useState<Campo[]>([]);
  const [loading,     setLoading]     = useState(true);

  useEffect(() => {
    async function load() {
      const [evRes, supRes, camRes, insRes] = await Promise.all([
        supabase.from('eventos').select('id,nome,departamento,data_inicio,data_fim,cidade').eq('id', id).single(),
        supabase.from('supervisoes').select('id,nome'),
        supabase.from('campos').select('id,nome,supervisao_id'),
        supabase.from('evento_inscricoes')
          .select('id,nome_inscrito,cpf,whatsapp,supervisao_id,campo_id,status_pagamento,forma_pagamento,valor_pago,checkin_realizado,checkin_at,hospedagem,alimentacao,brinde,etiqueta_impressa,created_at')
          .eq('evento_id', id)
          .order('nome_inscrito'),
      ]);
      if (evRes.data)  setEvento(evRes.data as Evento);
      if (supRes.data) setSupervisoes(supRes.data as Supervisao[]);
      if (camRes.data) setCampos(camRes.data as Campo[]);
      if (insRes.data) setInscricoes(insRes.data as Inscricao[]);
      setLoading(false);
    }
    load();
  }, [id, supabase]);

  // Helpers de nome
  const nomeSup   = (sid: string | null) => supervisoes.find(s => s.id === sid)?.nome ?? '-';
  const nomeCampo = (cid: string | null) => campos.find(c => c.id === cid)?.nome ?? '-';

  // Filtragem
  const filtradas = useMemo(() => {
    let list = inscricoes;
    if (filtroSup)     list = list.filter(i => i.supervisao_id === filtroSup);
    if (filtroCampo)   list = list.filter(i => i.campo_id === filtroCampo);
    if (filtroPag)     list = list.filter(i => i.status_pagamento === filtroPag);
    if (filtroCheckin === '1') list = list.filter(i => i.checkin_realizado);
    if (filtroCheckin === '0') list = list.filter(i => !i.checkin_realizado);
    return list;
  }, [inscricoes, filtroSup, filtroCampo, filtroPag, filtroCheckin]);

  // Agrupamento por supervisão
  const porSup = useMemo(() => {
    const map = new Map<string, { nome: string; total: number; pagos: number; pendentes: number; isentos: number; checkins: number; valor: number }>();
    filtradas.forEach(i => {
      const k = i.supervisao_id ?? '__sem__';
      const cur = map.get(k) ?? { nome: nomeSup(i.supervisao_id), total: 0, pagos: 0, pendentes: 0, isentos: 0, checkins: 0, valor: 0 };
      cur.total++;
      if (i.status_pagamento === 'pago')     { cur.pagos++;     cur.valor += i.valor_pago; }
      if (i.status_pagamento === 'pendente')   cur.pendentes++;
      if (i.status_pagamento === 'isento')     cur.isentos++;
      if (i.checkin_realizado)                 cur.checkins++;
      map.set(k, cur);
    });
    return Array.from(map.values()).sort((a, b) => a.nome.localeCompare(b.nome));
  }, [filtradas, nomeSup]);

  // Agrupamento por campo
  const porCampo = useMemo(() => {
    const map = new Map<string, { nome: string; sup: string; total: number; pagos: number; pendentes: number; checkins: number; hosp: number; alim: number }>();
    filtradas.forEach(i => {
      const k = i.campo_id ?? '__sem__';
      const cur = map.get(k) ?? { nome: nomeCampo(i.campo_id), sup: nomeSup(i.supervisao_id), total: 0, pagos: 0, pendentes: 0, checkins: 0, hosp: 0, alim: 0 };
      cur.total++;
      if (i.status_pagamento === 'pago')     cur.pagos++;
      if (i.status_pagamento === 'pendente') cur.pendentes++;
      if (i.checkin_realizado) cur.checkins++;
      if (i.hospedagem)        cur.hosp++;
      if (i.alimentacao)       cur.alim++;
      map.set(k, cur);
    });
    return Array.from(map.values()).sort((a, b) => a.nome.localeCompare(b.nome));
  }, [filtradas, nomeSup, nomeCampo]);

  // Resumo
  const resumo = useMemo(() => ({
    total:      filtradas.length,
    pagos:      filtradas.filter(i => i.status_pagamento === 'pago').length,
    pendentes:  filtradas.filter(i => i.status_pagamento === 'pendente').length,
    isentos:    filtradas.filter(i => i.status_pagamento === 'isento').length,
    cancelados: filtradas.filter(i => i.status_pagamento === 'cancelado').length,
    checkins:   filtradas.filter(i => i.checkin_realizado).length,
    etiquetas:  filtradas.filter(i => i.etiqueta_impressa).length,
    hospedagem: filtradas.filter(i => i.hospedagem).length,
    alimentacao:filtradas.filter(i => i.alimentacao).length,
    brindes:    filtradas.filter(i => i.brinde).length,
    valor:      filtradas.filter(i => i.status_pagamento === 'pago').reduce((s, i) => s + i.valor_pago, 0),
  }), [filtradas]);

  const TITULOS: Record<RelTipo, string> = {
    resumo:      'Resumo Geral',
    supervisao:  'Relatório por Supervisão',
    campo:       'Relatório por Campo',
    hospedagem:  'Lista de Hospedagem',
    alimentacao: 'Lista de Alimentação',
    presenca:    'Lista de Presença',
    financeiro:  'Relatório Financeiro',
  };

  const filtrosAplicados = [
    filtroSup    ? `Supervisão: ${nomeSup(filtroSup)}`       : '',
    filtroCampo  ? `Campo: ${nomeCampo(filtroCampo)}`        : '',
    filtroPag    ? `Pagamento: ${STATUS_LABEL[filtroPag] ?? filtroPag}` : '',
    filtroCheckin === '1' ? 'Apenas com check-in' : filtroCheckin === '0' ? 'Sem check-in' : '',
  ].filter(Boolean).join(' • ');

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Arial, sans-serif' }}>
        <p style={{ color: '#6B7280' }}>Carregando relatório...</p>
      </div>
    );
  }

  return (
    <>
      {/* ── Barra de controle (somente na tela) ──────────────── */}
      <div className="print:hidden fixed top-0 left-0 right-0 z-50 bg-white border-b border-gray-200 shadow-sm px-6 py-3 flex items-center justify-between gap-4">
        <div>
          <p className="font-bold text-[#123b63] text-sm">{evento?.nome ?? 'Evento'} — {TITULOS[tipo]}</p>
          {filtrosAplicados && <p className="text-xs text-gray-400">{filtrosAplicados}</p>}
        </div>
        <div className="flex gap-2">
          <button onClick={() => window.history.back()}
            className="px-4 py-2 rounded-lg text-sm border border-gray-300 text-gray-600 hover:bg-gray-50 transition">
            ← Voltar
          </button>
          <button onClick={() => window.print()}
            className="px-5 py-2 rounded-lg text-sm font-semibold bg-[#123b63] text-white hover:bg-[#0f2a45] transition">
            🖨️ Imprimir
          </button>
        </div>
      </div>

      {/* ── Conteúdo do relatório ─────────────────────────────── */}
      <div style={{ padding: '80px 32px 32px', fontFamily: 'Arial, sans-serif', maxWidth: '1100px', margin: '0 auto' }}
        className="print:p-0 print:max-w-none">
        {/* Cabeçalho com timbre */}
        <div style={{ marginBottom: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
            <img src={buildUrl(getAppBaseUrl(), '/img/logo_comieadepa.png')} alt="COMIEADEPA" style={{ width: '58px', height: 'auto' }} />
            <div style={{ maxWidth: '640px', textAlign: 'center' }}>
              <div style={{ fontSize: '16px', fontWeight: 800 }}>COMIEADEPA</div>
              <div style={{ fontSize: '10px', color: '#333', marginTop: '2px' }}>
                Rodovia Mario Covas, 2500 - do km 3.123 ao km 6.001 - lado impar lado par pertence a(o) Ananindeua - Coqueiro, Belem - PA, 66650-000
              </div>
              <div style={{ fontSize: '10px', color: '#333', marginTop: '2px' }}>
                CNPJ: 04.760.047/0001-04 | Tel: (91) 99223-4022 | contato@comieadepa.org
              </div>
            </div>
            <img src={buildUrl(getAppBaseUrl(), getDeptLogo(evento?.departamento))} alt={evento?.departamento ?? 'Departamento'} style={{ width: '58px', height: 'auto' }} />
          </div>
          <div style={{ borderBottom: '2px solid #14b8a6', marginTop: '8px' }} />
        </div>

        <div style={{ textAlign: 'center', fontSize: '14px', fontWeight: 700, margin: '8px 0 6px' }}>{TITULOS[tipo]}</div>
        <div style={{ fontSize: '11px', color: '#6B7280', textAlign: 'center', marginBottom: '6px' }}>
          {evento?.nome}{evento?.cidade ? ` — ${evento.cidade}` : ''}
          {evento?.data_inicio ? ` • ${fmtData(evento.data_inicio)} a ${fmtData(evento.data_fim)}` : ''}
        </div>
        {filtrosAplicados && (
          <div style={{ fontSize: '10px', color: '#9CA3AF', textAlign: 'center', marginBottom: '6px' }}>Filtros: {filtrosAplicados}</div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', marginBottom: '12px' }}>
          <div>Total de registros: {filtradas.length}</div>
          <div>Data: {new Date().toLocaleDateString('pt-BR')}</div>
        </div>

        {/* ── RESUMO ─────────────────────────────────────────── */}
        {tipo === 'resumo' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '12px' }}>
            {[
              { label: 'Total Inscritos',    value: resumo.total },
              { label: 'Pagos',              value: resumo.pagos },
              { label: 'Pendentes',          value: resumo.pendentes },
              { label: 'Isentos',            value: resumo.isentos },
              { label: 'Cancelados',         value: resumo.cancelados },
              { label: 'Check-ins',          value: `${resumo.checkins} / ${resumo.total}` },
              { label: 'Etiquetas Impressas',value: resumo.etiquetas },
              { label: 'Hospedagem',         value: resumo.hospedagem },
              { label: 'Alimentação',        value: resumo.alimentacao },
              { label: 'Brindes',            value: resumo.brindes },
              ...(podeFinanc ? [{ label: 'Valor Arrecadado', value: fmtMoeda(resumo.valor) }] : []),
            ].map(({ label, value }) => (
              <div key={label} style={{ border: '1px solid #E5E7EB', borderRadius: '10px', padding: '14px', backgroundColor: '#F9FAFB' }}>
                <p style={{ fontSize: '22px', fontWeight: 900, color: '#0D2B4E', margin: 0 }}>{value}</p>
                <p style={{ fontSize: '11px', color: '#6B7280', margin: '4px 0 0' }}>{label}</p>
              </div>
            ))}
          </div>
        )}

        {/* ── POR SUPERVISÃO ──────────────────────────────────── */}
        {tipo === 'supervisao' && (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={thS}>Supervisão</th>
              <th style={{ ...thS, textAlign: 'right' }}>Total</th>
              <th style={{ ...thS, textAlign: 'right' }}>Pagos</th>
              <th style={{ ...thS, textAlign: 'right' }}>Pendentes</th>
              <th style={{ ...thS, textAlign: 'right' }}>Isentos</th>
              <th style={{ ...thS, textAlign: 'right' }}>Check-ins</th>
              {podeFinanc && <th style={{ ...thS, textAlign: 'right' }}>Arrecadado</th>}
            </tr></thead>
            <tbody>
              {porSup.map(r => (
                <tr key={r.nome}>
                  <td style={{ ...tdS, fontWeight: 600 }}>{r.nome}</td>
                  <td style={tdNumS}>{r.total}</td>
                  <td style={tdNumS}>{r.pagos}</td>
                  <td style={tdNumS}>{r.pendentes}</td>
                  <td style={tdNumS}>{r.isentos}</td>
                  <td style={tdNumS}>{r.checkins}</td>
                  {podeFinanc && <td style={tdNumS}>{fmtMoeda(r.valor)}</td>}
                </tr>
              ))}
              <tr style={{ backgroundColor: '#F3F4F6', fontWeight: 700, borderTop: '2px solid #D1D5DB' }}>
                <td style={{ ...tdS, fontWeight: 800 }}>TOTAL</td>
                <td style={tdNumS}>{porSup.reduce((s, r) => s + r.total, 0)}</td>
                <td style={tdNumS}>{porSup.reduce((s, r) => s + r.pagos, 0)}</td>
                <td style={tdNumS}>{porSup.reduce((s, r) => s + r.pendentes, 0)}</td>
                <td style={tdNumS}>{porSup.reduce((s, r) => s + r.isentos, 0)}</td>
                <td style={tdNumS}>{porSup.reduce((s, r) => s + r.checkins, 0)}</td>
                {podeFinanc && <td style={tdNumS}>{fmtMoeda(porSup.reduce((s, r) => s + r.valor, 0))}</td>}
              </tr>
            </tbody>
          </table>
        )}

        {/* ── POR CAMPO ───────────────────────────────────────── */}
        {tipo === 'campo' && (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={thS}>Campo</th>
              <th style={thS}>Supervisão</th>
              <th style={{ ...thS, textAlign: 'right' }}>Total</th>
              <th style={{ ...thS, textAlign: 'right' }}>Pagos</th>
              <th style={{ ...thS, textAlign: 'right' }}>Pendentes</th>
              <th style={{ ...thS, textAlign: 'right' }}>Check-ins</th>
              <th style={{ ...thS, textAlign: 'right' }}>Hospedagem</th>
              <th style={{ ...thS, textAlign: 'right' }}>Alimentação</th>
            </tr></thead>
            <tbody>
              {porCampo.map(r => (
                <tr key={r.nome}>
                  <td style={{ ...tdS, fontWeight: 600 }}>{r.nome}</td>
                  <td style={{ ...tdS, color: '#6B7280' }}>{r.sup}</td>
                  <td style={tdNumS}>{r.total}</td>
                  <td style={tdNumS}>{r.pagos}</td>
                  <td style={tdNumS}>{r.pendentes}</td>
                  <td style={tdNumS}>{r.checkins}</td>
                  <td style={tdNumS}>{r.hosp}</td>
                  <td style={tdNumS}>{r.alim}</td>
                </tr>
              ))}
              <tr style={{ backgroundColor: '#F3F4F6', fontWeight: 700, borderTop: '2px solid #D1D5DB' }}>
                <td style={{ ...tdS, fontWeight: 800 }} colSpan={2}>TOTAL</td>
                <td style={tdNumS}>{porCampo.reduce((s, r) => s + r.total, 0)}</td>
                <td style={tdNumS}>{porCampo.reduce((s, r) => s + r.pagos, 0)}</td>
                <td style={tdNumS}>{porCampo.reduce((s, r) => s + r.pendentes, 0)}</td>
                <td style={tdNumS}>{porCampo.reduce((s, r) => s + r.checkins, 0)}</td>
                <td style={tdNumS}>{porCampo.reduce((s, r) => s + r.hosp, 0)}</td>
                <td style={tdNumS}>{porCampo.reduce((s, r) => s + r.alim, 0)}</td>
              </tr>
            </tbody>
          </table>
        )}

        {/* ── HOSPEDAGEM / ALIMENTAÇÃO ─────────────────────────── */}
        {(tipo === 'hospedagem' || tipo === 'alimentacao') && (() => {
          const lista = filtradas.filter(i => tipo === 'hospedagem' ? i.hospedagem : i.alimentacao);
          return (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={{ ...thS, width: '24px' }}>#</th>
                <th style={thS}>Nome</th>
                <th style={thS}>CPF</th>
                <th style={thS}>WhatsApp</th>
                <th style={thS}>Supervisão</th>
                <th style={thS}>Campo</th>
                <th style={thS}>Pagamento</th>
                <th style={{ ...thS, textAlign: 'center' }}>Check-in</th>
              </tr></thead>
              <tbody>
                {lista.map((i, idx) => (
                  <tr key={i.id}>
                    <td style={{ ...tdS, color: '#9CA3AF' }}>{idx + 1}</td>
                    <td style={{ ...tdS, fontWeight: 600 }}>{i.nome_inscrito}</td>
                    <td style={tdS}>{i.cpf ?? '-'}</td>
                    <td style={tdS}>{i.whatsapp ?? '-'}</td>
                    <td style={tdS}>{nomeSup(i.supervisao_id)}</td>
                    <td style={tdS}>{nomeCampo(i.campo_id)}</td>
                    <td style={tdS}>{STATUS_LABEL[i.status_pagamento] ?? i.status_pagamento}</td>
                    <td style={{ ...tdS, textAlign: 'center' }}>{i.checkin_realizado ? '✅' : '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ backgroundColor: '#F3F4F6', borderTop: '2px solid #D1D5DB' }}>
                  <td style={{ ...tdS, fontWeight: 800 }} colSpan={8}>Total: {lista.length}</td>
                </tr>
              </tfoot>
            </table>
          );
        })()}

        {/* ── PRESENÇA ────────────────────────────────────────── */}
        {tipo === 'presenca' && (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={{ ...thS, width: '24px' }}>#</th>
              <th style={thS}>Nome</th>
              <th style={thS}>CPF</th>
              <th style={thS}>Supervisão</th>
              <th style={thS}>Campo</th>
              <th style={{ ...thS, textAlign: 'center' }}>Check-in</th>
              <th style={thS}>Horário</th>
            </tr></thead>
            <tbody>
              {filtradas.map((i, idx) => (
                <tr key={i.id} style={{ backgroundColor: i.checkin_realizado ? '#F0FDF4' : 'white' }}>
                  <td style={{ ...tdS, color: '#9CA3AF' }}>{idx + 1}</td>
                  <td style={{ ...tdS, fontWeight: 600 }}>{i.nome_inscrito}</td>
                  <td style={tdS}>{i.cpf ?? '-'}</td>
                  <td style={tdS}>{nomeSup(i.supervisao_id)}</td>
                  <td style={tdS}>{nomeCampo(i.campo_id)}</td>
                  <td style={{ ...tdS, textAlign: 'center' }}>{i.checkin_realizado ? '✅ Sim' : '—'}</td>
                  <td style={{ ...tdS, color: '#6B7280' }}>{fmtDT(i.checkin_at)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ backgroundColor: '#F3F4F6', borderTop: '2px solid #D1D5DB' }}>
                <td style={{ ...tdS, fontWeight: 800 }} colSpan={7}>
                  Total: {filtradas.length} • Check-ins: {filtradas.filter(i => i.checkin_realizado).length}
                </td>
              </tr>
            </tfoot>
          </table>
        )}

        {/* ── FINANCEIRO ──────────────────────────────────────── */}
        {tipo === 'financeiro' && podeFinanc && (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={{ ...thS, width: '24px' }}>#</th>
              <th style={thS}>Nome</th>
              <th style={thS}>CPF</th>
              <th style={{ ...thS, textAlign: 'right' }}>Valor Pago</th>
              <th style={thS}>Forma Pgto</th>
              <th style={thS}>Status</th>
              <th style={thS}>Inscrição</th>
            </tr></thead>
            <tbody>
              {filtradas.map((i, idx) => (
                <tr key={i.id}>
                  <td style={{ ...tdS, color: '#9CA3AF' }}>{idx + 1}</td>
                  <td style={{ ...tdS, fontWeight: 600 }}>{i.nome_inscrito}</td>
                  <td style={tdS}>{i.cpf ?? '-'}</td>
                  <td style={{ ...tdNumS, color: i.status_pagamento === 'pago' ? '#15803D' : '#6B7280' }}>{fmtMoeda(i.valor_pago)}</td>
                  <td style={tdS}>{i.forma_pagamento ?? '-'}</td>
                  <td style={tdS}>{STATUS_LABEL[i.status_pagamento] ?? i.status_pagamento}</td>
                  <td style={tdS}>{fmtData(i.created_at)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ backgroundColor: '#F0FDF4', borderTop: '2px solid #D1D5DB', fontWeight: 800 }}>
                <td style={{ ...tdS, fontWeight: 800 }} colSpan={3}>TOTAL ARRECADADO</td>
                <td style={{ ...tdNumS, color: '#15803D', fontWeight: 800 }}>
                  {fmtMoeda(filtradas.filter(i => i.status_pagamento === 'pago').reduce((s, i) => s + i.valor_pago, 0))}
                </td>
                <td colSpan={3} />
              </tr>
            </tfoot>
          </table>
        )}

        {tipo === 'financeiro' && !podeFinanc && (
          <div style={{ textAlign: 'center', padding: '60px', color: '#9CA3AF' }}>
            <p style={{ fontSize: '40px' }}>🔒</p>
            <p style={{ fontWeight: 700, color: '#374151' }}>Acesso negado</p>
            <p style={{ fontSize: '13px' }}>Você não tem permissão para visualizar dados financeiros.</p>
          </div>
        )}
      </div>

      {/* ── Estilos de impressão ──────────────────────────────── */}
      <style jsx global>{`
        @media print {
          @page { size: A4 landscape; margin: 1cm; }
          body { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        }
      `}</style>
    </>
  );
}
