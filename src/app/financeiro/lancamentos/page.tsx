'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import PageLayout from '@/components/PageLayout';
import AccessRestricted from '@/components/AccessRestricted';
import { createClient } from '@/lib/supabase-client';
import { buildUrl, getAppBaseUrl } from '@/lib/urls';
import { useRequireSupabaseAuth } from '@/hooks/useRequireSupabaseAuth';
import { useUserRole } from '@/hooks/useUserRole';
import { canAccessModule } from '@/lib/auth/roles';
import { useAuditLog } from '@/hooks/useAuditLog';
import { fetchConfiguracaoIgrejaFromSupabase, type ConfiguracaoIgreja } from '@/lib/igreja-config-utils';

// ─── Tipos ─────────────────────────────────────────────────────────────
interface Supervisao { id: string; nome: string; }
interface Campo {
  id: string; nome: string; supervisao_id: string;
  pastor_member_id?: string | null; presidente_nome?: string | null;
  presidente_cpf?: string | null; presidente_matricula?: string | null;
  telefone?: string | null;
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
  const { registrarAcao } = useAuditLog();
  const anoAtual = new Date().getFullYear();

  const podeAcessar = canAccessModule(role, 'financeiro');

  // Aba ativa
  const [abaAtiva, setAbaAtiva] = useState<'contribuicao-estatutaria'>('contribuicao-estatutaria');

  // Dados de referência
  const [supervisoes, setSupervisoes] = useState<Supervisao[]>([]);
  const [campos, setCampos] = useState<Campo[]>([]);

  // Configuração da organização (timbre)
  const [configIgreja, setConfigIgreja] = useState<ConfiguracaoIgreja>({
    nome: 'COMIEADEPA', endereco: 'Belém - PA', cnpj: '', telefone: '', email: '', logo: '',
  });

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

  // Modal exclusão
  const [modalExcluir, setModalExcluir] = useState<Contribuicao | null>(null);
  const [excluindo, setExcluindo]       = useState(false);

  // Modal edição
  const [modalEditar, setModalEditar]   = useState<Contribuicao | null>(null);
  const [editValor, setEditValor]       = useState('');
  const [editMes, setEditMes]           = useState(1);
  const [editForma, setEditForma]       = useState('A VISTA');
  const [editSaving, setEditSaving]     = useState(false);

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
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErro(json?.error || 'Falha ao carregar contribuicoes.');
      setContribuicoes([]);
      return;
    }
    setErro('');
    setContribuicoes(json.data || []);
  }, [filtroAno, filtroSup, filtroCampo]);

  useEffect(() => {
    if (loading || roleLoading || !podeAcessar) return;
    // Carrega supervisoes e campos via API protegida
    (async () => {
      const res = await authedFetch('/api/v1/estrutura');
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        setSupervisoes((json?.supervisoes as Supervisao[]) || []);
        setCampos((json?.campos as Campo[]) || []);
        setErro('');
      } else {
        setErro(json?.error || 'Falha ao carregar estrutura.');
      }
    })();

    loadContribuicoes();
    fetchConfiguracaoIgrejaFromSupabase(supabase).then(setConfigIgreja).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, roleLoading, podeAcessar]);

  // Recarrega tabela quando filtros mudam
  useEffect(() => {
    if (!loading && !roleLoading && podeAcessar) loadContribuicoes();
  }, [loading, roleLoading, podeAcessar, loadContribuicoes]);

  useEffect(() => {
    if (!sucesso) return;
    const t = setTimeout(() => setSucesso(''), 4000);
    return () => clearTimeout(t);
  }, [sucesso]);

  // ─── Selecionar campo → preenche pastor ──────────────────────────────
  const handleCampoChange = async (id: string) => {
    setCampoId(id);
    const campo = campos.find(c => c.id === id);
    if (!campo) { setCampoNome(''); setPastorNome(''); setPastorMat(''); setPastorCpf(''); setContato(''); return; }
    setCampoNome(campo.nome);

    // Preenche diretamente das colunas da tabela campos
    setPastorNome(campo.presidente_nome || '');
    setPastorMat(campo.presidente_matricula || '');
    setPastorCpf(campo.presidente_cpf || '');
    setContato(campo.telefone || '');

    // Se tiver pastor_member_id, complementa com dados do membro (sobrescreve se mais completo)
    if (campo.pastor_member_id) {
      const res = await authedFetch(`/api/v1/members/lookup?id=${campo.pastor_member_id}&limit=1`);
      const json = await res.json();
      const data = (json?.data as any[])?.[0];
      if (res.ok && data) {
        if (data.name) setPastorNome(data.name);
        if (data.matricula) setPastorMat(String(data.matricula));
        if (data.cpf) setPastorCpf(data.cpf);
        const tel = data.whatsapp || data.celular || data.phone;
        if (tel) setContato(tel);
      }
    }
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
    const json = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) { setErro(json.error || 'Erro ao registrar.'); return; }
    setSucesso(json.updated
      ? `Contribuição de ${MESES_FULL[mes - 1]} atualizada com sucesso!`
      : `Contribuição de ${MESES_FULL[mes - 1]} registrada com sucesso!`);
    limpar();
    await loadContribuicoes();
  };

  // ─── Excluir (com modal) ─────────────────────────────────────────────
  const confirmarExcluir = async () => {
    if (!modalExcluir) return;
    setExcluindo(true);
    const res = await authedFetch(`/api/financeiro/contribuicoes?id=${modalExcluir.id}`, { method: 'DELETE' });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      setErro(json?.error || 'Falha ao excluir contribuicao.');
    } else {
      setSucesso('Registro excluído com sucesso.');
      await loadContribuicoes();
    }
    setExcluindo(false);
    setModalExcluir(null);
  };

  // ─── Editar ──────────────────────────────────────────────────────────
  const abrirEditar = (c: Contribuicao) => {
    setModalEditar(c);
    setEditValor(fmtValor(c.valor));
    setEditMes(c.mes);
    setEditForma(c.forma_pagamento || 'A VISTA');
  };

  const confirmarEditar = async () => {
    if (!modalEditar) return;
    setEditSaving(true);
    const res = await authedFetch('/api/financeiro/contribuicoes', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: modalEditar.id,
        valor: parseMoeda(editValor),
        mes: editMes,
        forma_pagamento: editForma,
      }),
    });
    const json = await res.json().catch(() => ({}));
    setEditSaving(false);
    if (!res.ok) { setErro(json?.error || 'Erro ao editar.'); }
    else { setSucesso('Registro atualizado com sucesso.'); await loadContribuicoes(); }
    setModalEditar(null);
  };

  // ─── Imprimir recibo individual ───────────────────────────────────────
  const imprimirRecibo = (c: Contribuicao) => {
    const win = window.open('', '_blank', 'width=720,height=780');
    if (!win) {
      setErro('Não foi possível abrir a janela de impressão. Verifique o bloqueador de pop-ups.');
      return;
    }
    const reciboId = `REC-${c.id.slice(0,8).toUpperCase()}`;
    const dataReg = new Date(c.created_at).toLocaleString('pt-BR');
    const logoSrc = configIgreja.logo
      ? configIgreja.logo
      : '/img/logo_comieadepa.png';
    const nomeOrg  = configIgreja.nome     || 'COMIEADEPA';
    const endOrg   = configIgreja.endereco || 'Belém - PA';
    const telOrg   = configIgreja.telefone ? `Tel: ${configIgreja.telefone}` : '';
    const emailOrg = configIgreja.email    || '';
    const infoLinha = [telOrg, emailOrg].filter(Boolean).join(' | ');
    win.document.write(`<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"/><title>Recibo ${reciboId}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:Arial,sans-serif;font-size:11px;padding:20mm 16mm;color:#111;background:#fff}
  /* ── Timbre ── */
  .timbre{width:100%;border-collapse:collapse;margin-bottom:0;border-top:4px solid #0D2B4E}
  .timbre td{vertical-align:middle;padding:8px 0}
  .timbre .logo-cell{width:72px;padding-right:12px}
  .timbre img{width:68px;height:68px;object-fit:contain}
  .timbre .logo-placeholder{width:68px;height:68px;border:1px dashed #aaa;display:flex;align-items:center;justify-content:center;font-size:8px;color:#aaa}
  .timbre .info-cell{text-align:center}
  .org-nome{font-size:15px;font-weight:bold;color:#0D2B4E;letter-spacing:1px}
  .org-sub{font-size:9px;color:#555;margin-top:2px}
  .org-end{font-size:8px;color:#777;margin-top:1px}
  /* ── Faixa título ── */
  .faixa{background:#0D2B4E;color:#F39C12;font-weight:bold;font-size:13px;text-align:center;
         padding:6px 10px;letter-spacing:2px;margin:0 0 18px;border-bottom:4px solid #F39C12}
  /* ── Identificação recibo ── */
  .recibo-id{font-size:10px;font-weight:bold;color:#0D2B4E;text-align:right;margin:8px 0 4px}
  /* ── Grid de campos ── */
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:8px 24px;margin-bottom:16px}
  .field label{font-size:9px;font-weight:bold;text-transform:uppercase;color:#666;display:block;margin-bottom:2px}
  .field span{font-size:11px;font-weight:600;color:#111;display:block;border-bottom:1px solid #ddd;padding-bottom:3px}
  /* ── Destaque valor ── */
  .valor-box{background:#f0f7ff;border:2px solid #0D2B4E;border-radius:6px;padding:10px 16px;text-align:center;margin:12px 0}
  .valor-box .vlabel{font-size:10px;color:#555;text-transform:uppercase}
  .valor-box .vnum{font-size:22px;font-weight:bold;color:#0D2B4E}
  /* ── Rodapé ── */
  .footer{font-size:9px;color:#888;text-align:center;margin-top:20px;border-top:1px solid #ddd;padding-top:8px}
  @media print{@page{size:A4;margin:0}body{padding:12mm 14mm}}
</style></head>
<body>
<table class="timbre"><tbody><tr>
  <td class="logo-cell">
    <img src="${logoSrc}" alt="Logo" onerror="this.style.display='none'"/>
  </td>
  <td class="info-cell">
    <div class="org-nome">${nomeOrg}</div>
    <div class="org-sub">Convênio das Igrejas Evangélicas Assembléia de Deus do Pará</div>
    <div class="org-end">${endOrg}</div>
    ${infoLinha ? `<div class="org-end">${infoLinha}</div>` : ''}
  </td>
</tr></tbody></table>
<div class="faixa">RECIBO DE CONTRIBUIÇÃO ESTATUTÁRIA</div>
<div class="recibo-id">${reciboId}</div>
<div class="grid">
  <div class="field"><label>Supervisão</label><span>${c.supervisao_nome || '—'}</span></div>
  <div class="field"><label>Campo</label><span>${c.campo_nome}</span></div>
  <div class="field"><label>Pastor Presidente</label><span>${c.pastor_nome || '—'}</span></div>
  <div class="field"><label>Matrícula</label><span>${(c as any).matricula || '—'}</span></div>
  <div class="field"><label>CPF</label><span>${(c as any).cpf || '—'}</span></div>
  <div class="field"><label>Contato</label><span>${c.contato || '—'}</span></div>
  <div class="field"><label>Mês de Referência</label><span>${MESES_FULL[c.mes - 1]}</span></div>
  <div class="field"><label>Ano</label><span>${c.ano}</span></div>
  <div class="field"><label>Forma de Pagamento</label><span>${c.forma_pagamento || '—'}</span></div>
  <div class="field"><label>Data do Registro</label><span>${dataReg}</span></div>
</div>
<div class="valor-box">
  <div class="vlabel">Valor Recebido</div>
  <div class="vnum">R$ ${fmtValor(c.valor)}</div>
</div>
<div class="footer">Documento gerado em ${new Date().toLocaleString('pt-BR')} — ${nomeOrg} © ${new Date().getFullYear()}</div>
</body></html>`);
    win.document.close(); win.focus(); setTimeout(() => win.print(), 400);
    setSucesso('Recibo enviado para impressão.');
    void registrarAcao({
      acao: 'imprimir_recibo',
      modulo: 'financeiro',
      tabela_afetada: 'contribuicoes_estatutarias',
      registro_id: c.id,
      descricao: `Impressão de recibo: ${c.campo_nome} — ${MESES_FULL[c.mes - 1]}/${c.ano}`,
      dados_novos: { campo_nome: c.campo_nome, mes: c.mes, ano: c.ano, valor: c.valor },
    });
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
    setSucesso('Relatório de contribuição enviado para impressão.');
    void registrarAcao({
      acao: 'imprimir_relatorio',
      modulo: 'financeiro',
      descricao: `Impressão do relatório de contribuição estatutária — ${filtroAno || 'todos os anos'}`,
      dados_novos: {
        filtroAno: filtroAno || null,
        filtroSup: filtroSup || null,
        filtroCampo: filtroCampo || null,
        totalRegistros: linhas.length,
      },
    });
  };

  if (loading) return <div className="p-8">Carregando...</div>;

  // Campos do formulário filtrados pela supervisão selecionada
  const camposForm = supId ? campos.filter(c => c.supervisao_id === supId) : campos;

  return (
    <>
    <PageLayout
      title="Financeiro"
      description="Gestão financeira da COMIEADEPA"
      activeMenu="financeiro"
    >
      <div className="w-full max-w-7xl mx-auto">

        {/* ─── Navegação ─────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <span className="text-xs font-bold uppercase tracking-widest text-gray-400 mr-2">Módulo Financeiro</span>
          <Link href="/financeiro"
            className="px-4 py-1.5 rounded-full text-xs font-semibold border border-gray-300 text-gray-600 hover:bg-gray-50 transition">
            ← Dashboard
          </Link>
          <Link href="/financeiro/lancamentos"
            className="px-4 py-1.5 rounded-full text-xs font-semibold bg-[#123b63] text-white shadow-sm">
            Contribuição Estatutária
          </Link>
        </div>

        {/* ─── Abas ─────────────────────────────────────────────────── */}
        <div className="mb-6 border-b border-gray-300">
          <div className="flex gap-4 overflow-x-auto pb-1">
            <button
              onClick={() => setAbaAtiva('contribuicao-estatutaria')}
              className={`px-6 py-3 font-semibold border-b-2 transition whitespace-nowrap ${
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
              <div className="grid grid-cols-2 lg:grid-cols-[1fr_1.4fr_1.2fr_0.7fr_0.9fr] gap-3 items-end">
                <div className="min-w-0">
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
                <div className="min-w-0">
                  <label className="block text-[10px] font-bold text-red-700 uppercase mb-1 tracking-wide">Campo</label>
                  <div className="flex gap-1 items-center min-w-0 overflow-hidden">
                    <select
                      value={campoId}
                      onChange={e => handleCampoChange(e.target.value)}
                      className="min-w-0 flex-1 w-0 border-2 border-red-400 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-300 bg-white"
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
                <div className="min-w-0">
                  <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1 tracking-wide">Pastor Presidente</label>
                  <input
                    readOnly value={pastorNome}
                    className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm bg-gray-50 text-gray-700"
                  />
                </div>
                <div className="min-w-0">
                  <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1 tracking-wide">Matrícula</label>
                  <input
                    readOnly value={pastorMat}
                    className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm bg-gray-50 text-gray-700"
                  />
                </div>
                <div className="min-w-0">
                  <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1 tracking-wide">CPF</label>
                  <input
                    readOnly value={pastorCpf}
                    className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm bg-gray-50 text-gray-700"
                  />
                </div>
              </div>

              {/* Linha 2: CONTATO | MÊS | ANO | FORMA | VALOR | REGISTRAR */}
              <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 items-end mt-3 min-w-0">
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
                  <div className="flex items-center border-2 border-teal-500 rounded bg-white">
                    <span className="pl-2 pr-2 text-sm text-gray-500 font-semibold border-r border-gray-200 flex-shrink-0">R$</span>
                    <input
                      type="text"
                      value={valorStr}
                      onChange={e => setValorStr(e.target.value)}
                      onFocus={e => e.target.select()}
                      className="flex-1 min-w-0 pl-2 pr-4 py-1.5 text-sm focus:outline-none text-right"
                    />
                  </div>
                </div>
                <div className="flex flex-col justify-end sm:col-span-2 lg:col-span-1">
                  <button
                    onClick={handleRegistrar}
                    disabled={saving}
                    title="Registrar contribuição"
                    className="w-full sm:w-auto px-5 py-2 bg-gray-400 hover:bg-[#123b63] text-white font-bold text-sm rounded transition disabled:opacity-60"
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
                <span className="uppercase tracking-widest mr-1 w-full sm:w-auto">Filtros</span>

                <select
                  value={filtroSup}
                  onChange={e => { setFiltroSup(e.target.value); setFiltroCampo(''); setPage(1); }}
                  className="w-full sm:w-auto border border-white/40 bg-[#1a4f85] text-white rounded px-2 py-1 text-xs focus:outline-none"
                >
                  <option value="">Supervisão</option>
                  {supervisoes.map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}
                </select>

                <select
                  value={filtroCampo}
                  onChange={e => { setFiltroCampo(e.target.value); setPage(1); }}
                  className="w-full sm:w-auto border border-white/40 bg-[#1a4f85] text-white rounded px-2 py-1 text-xs focus:outline-none"
                >
                  <option value="">Campo</option>
                  {camposParaFiltro.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                </select>

                <select
                  value={filtroAno}
                  onChange={e => { setFiltroAno(e.target.value); setPage(1); }}
                  className="w-full sm:w-auto border border-white/40 bg-[#1a4f85] text-white rounded px-2 py-1 text-xs focus:outline-none"
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
                  className="w-full sm:flex-1 sm:min-w-[160px] border border-white/40 bg-[#1a4f85] text-white placeholder-white/60 rounded px-2 py-1 text-xs focus:outline-none"
                />

                <button
                  onClick={() => { setFiltroSup(''); setFiltroCampo(''); setBusca(''); setPage(1); }}
                  title="Limpar filtros"
                  className="w-full sm:w-auto px-3 py-1 bg-white text-[#123b63] rounded font-bold hover:bg-gray-100 transition"
                >
                  LIMPAR
                </button>
                <button
                  onClick={handleImprimir}
                  title="Imprimir relatório da tabela"
                  className="w-full sm:w-auto px-3 py-1 bg-[#c8a42a] text-white rounded font-bold hover:bg-[#a8872a] transition"
                >
                  IMPRIMIR
                </button>

                <span className="w-full sm:w-auto sm:ml-auto px-2 py-0.5 bg-white text-[#123b63] rounded font-bold text-xs min-w-[28px] text-center">
                  {page}
                </span>
              </div>

              {/* Tabela */}
              <div className="overflow-x-auto">
                <table className="w-full min-w-[980px] text-xs">
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
                          <div className="flex items-center justify-center gap-1.5">
                            {/* Imprimir — primeiro mês disponível como referência de recibo */}
                            {(() => {
                              const primeiro = Object.values(l.meses)[0];
                              if (!primeiro) return null;
                              return (
                                <button
                                  onClick={() => imprimirRecibo(primeiro)}
                                  aria-label="Imprimir recibo"
                                  title="Imprimir recibo"
                                  className="w-8 h-8 flex items-center justify-center rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-600 hover:text-white transition cursor-pointer border border-blue-200"
                                >
                                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2M6 14h12v8H6v-8z"/>
                                  </svg>
                                </button>
                              );
                            })()}
                            {/* Editar e Excluir — um botão por mês registrado */}
                            {Object.values(l.meses).map(c => (
                              <div key={c.id} className="flex items-center gap-1">
                                <button
                                  onClick={() => abrirEditar(c)}
                                  aria-label={`Editar ${MESES_ABREV[c.mes - 1]}`}
                                  title={`Editar ${MESES_ABREV[c.mes - 1]}`}
                                  className="w-8 h-8 flex items-center justify-center rounded-lg bg-amber-50 text-amber-600 hover:bg-amber-500 hover:text-white transition cursor-pointer border border-amber-200"
                                >
                                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2 2 0 112.828 2.828L11.828 15.828A2 2 0 0110 16H8v-2a2 2 0 01.586-1.414z"/>
                                  </svg>
                                </button>
                                <button
                                  onClick={() => setModalExcluir(c)}
                                  aria-label={`Excluir ${MESES_ABREV[c.mes - 1]}`}
                                  title={`Excluir ${MESES_ABREV[c.mes - 1]}`}
                                  className="w-8 h-8 flex items-center justify-center rounded-lg bg-red-50 text-red-600 hover:bg-red-600 hover:text-white transition cursor-pointer border border-red-200"
                                >
                                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7V4h6v3M3 7h18"/>
                                  </svg>
                                </button>
                              </div>
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

    {/* ═══ MODAL EXCLUSÃO ═══════════════════════════════════════════════ */}
    {modalExcluir && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
              </svg>
            </div>
            <h2 className="text-lg font-bold text-gray-800">Confirma exclusão deste registro?</h2>
          </div>
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4 text-sm text-gray-700 space-y-1">
            <p><span className="font-semibold">Campo:</span> {modalExcluir.campo_nome}</p>
            <p><span className="font-semibold">Mês/Ano:</span> {MESES_FULL[modalExcluir.mes - 1]} / {modalExcluir.ano}</p>
            <p><span className="font-semibold">Valor:</span> R$ {fmtValor(modalExcluir.valor)}</p>
          </div>
          <p className="text-xs text-gray-500 mb-5">Esta ação removerá o lançamento financeiro. O procedimento será registrado em histórico para futuras consultas e auditoria.</p>
          <div className="flex gap-3 justify-end">
            <button
              onClick={() => setModalExcluir(null)}
              className="px-5 py-2 rounded-lg border border-gray-300 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition"
            >Cancelar</button>
            <button
              onClick={confirmarExcluir}
              disabled={excluindo}
              className="px-5 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-bold transition disabled:opacity-60"
            >{excluindo ? 'Excluindo...' : 'Confirmar exclusão'}</button>
          </div>
        </div>
      </div>
    )}

    {/* ═══ MODAL EDIÇÃO ═════════════════════════════════════════════════ */}
    {modalEditar && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
          <h2 className="text-lg font-bold text-gray-800 mb-1">Editar Registro</h2>
          <p className="text-xs text-gray-500 mb-4">{modalEditar.campo_nome} — {modalEditar.ano}</p>
          <div className="space-y-3">
            <div>
              <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Mês de Referência</label>
              <select value={editMes} onChange={e => setEditMes(Number(e.target.value))}
                className="w-full border-2 border-teal-500 rounded px-2 py-1.5 text-sm focus:outline-none">
                {MESES_FULL.map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Forma de Pagamento</label>
              <select value={editForma} onChange={e => setEditForma(e.target.value)}
                className="w-full border-2 border-teal-500 rounded px-2 py-1.5 text-sm focus:outline-none">
                {FORMAS_PAG.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Valor</label>
              <div className="flex items-center border-2 border-teal-500 rounded bg-white">
                <span className="pl-2 pr-2 text-sm text-gray-500 font-semibold border-r border-gray-200 flex-shrink-0">R$</span>
                <input type="text" value={editValor} onChange={e => setEditValor(e.target.value)}
                  onFocus={e => e.target.select()}
                  className="flex-1 min-w-0 pl-2 pr-4 py-1.5 text-sm focus:outline-none text-right"/>
              </div>
            </div>
          </div>
          <p className="text-xs text-gray-400 mt-4">As alterações serão registradas em histórico para futuras consultas e auditoria.</p>
          <div className="flex gap-3 justify-end mt-3">
            <button onClick={() => setModalEditar(null)}
              className="px-5 py-2 rounded-lg border border-gray-300 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition">Cancelar</button>
            <button onClick={confirmarEditar} disabled={editSaving}
              className="px-5 py-2 rounded-lg bg-[#123b63] hover:bg-[#0d2b4e] text-white text-sm font-bold transition disabled:opacity-60">
              {editSaving ? 'Salvando...' : 'Salvar alterações'}
            </button>
          </div>
        </div>
      </div>
    )}
  </>
  );
}
