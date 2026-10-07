'use client';

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import { createClient } from '@/lib/supabase-client';
import { formatCnpj } from '@/lib/mascaras';
import {
  Building2,
  Search,
  CheckCircle,
  CheckCircle2,
  Download,
  Printer,
  ArrowLeft,
  X,
  ExternalLink,
  Calendar,
  CreditCard,
  FileText,
  Loader2,
  AlertCircle
} from 'lucide-react';

interface Credenciamento {
  id: string;
  ano_referencia: number;
  numero_registro: string;
  data_inicio: string;
  data_fim: string;
  data_emissao?: string;
  status_credenciamento: string;
  status_pagamento: string;
  valor: number;
  data_pagamento?: string;
  forma_pagamento?: string;
  observacoes_financeiras?: string;
  asaas_invoice_url?: string;
  conec_instituicoes: {
    nome_instituicao: string;
    cnpj: string;
  };
}

export default function ConecFinanceiroPage() {
  const router = useRouter();
  const supabase = createClient();

  const [activeMenu, setActiveMenu] = useState('conec');
  const [credenciamentos, setCredenciamentos] = useState<Credenciamento[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filtros
  const [searchTerm, setSearchTerm] = useState('');
  const [yearFilter, setYearFilter] = useState<string>(new Date().getFullYear().toString());
  const [statusFilter, setStatusFilter] = useState<string>('todos');

  // Modal de Baixa Manual
  const [baixaModal, setBaixaModal] = useState<{
    isOpen: boolean;
    credId: string;
    instName: string;
    ano: number;
    valor: number;
    dataPagamento: string;
    formaPagamento: string;
    observacoes: string;
  } | null>(null);

  const [baixaLoading, setBaixaLoading] = useState(false);
  const [notificacao, setNotificacao] = useState<{
    isOpen: boolean;
    tipo: 'success' | 'error';
    titulo: string;
    mensagem: string;
  } | null>(null);

  const fetchFinanceiro = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: fetchErr } = await supabase
        .from('conec_credenciamentos')
        .select(`
          *,
          conec_instituicoes (
            nome_instituicao,
            cnpj
          )
        `)
        .is('deleted_at', null)
        .order('created_at', { ascending: false });

      if (fetchErr) throw fetchErr;
      setCredenciamentos((data || []) as unknown as Credenciamento[]);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Erro ao carregar dados financeiros do CONEC.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFinanceiro();
  }, []);

  // Anos disponíveis para filtro (extraídos dinamicamente dos dados + ano atual)
  const availableYears = useMemo(() => {
    const years = new Set<string>();
    years.add(new Date().getFullYear().toString());
    credenciamentos.forEach((c) => {
      if (c.ano_referencia) years.add(c.ano_referencia.toString());
    });
    return Array.from(years).sort((a, b) => b.localeCompare(a));
  }, [credenciamentos]);

  // Filtragem dos dados
  const filteredCreds = useMemo(() => {
    return credenciamentos.filter((c) => {
      const matchSearch =
        c.conec_instituicoes?.nome_instituicao.toLowerCase().includes(searchTerm.toLowerCase()) ||
        c.conec_instituicoes?.cnpj.replace(/\D/g, '').includes(searchTerm.replace(/\D/g, '')) ||
        c.numero_registro?.toLowerCase().includes(searchTerm.toLowerCase());

      const matchYear = yearFilter === 'todos' || c.ano_referencia.toString() === yearFilter;
      const matchStatus = statusFilter === 'todos' || c.status_pagamento === statusFilter;

      return matchSearch && matchYear && matchStatus;
    });
  }, [credenciamentos, searchTerm, yearFilter, statusFilter]);

  // KPIs calculados com base nos dados FILTRADOS por ano
  const kpis = useMemo(() => {
    let previsto = 0;
    let recebido = 0;
    let pendente = 0;
    let pagasCount = 0;
    let pendentesCount = 0;

    filteredCreds.forEach((c) => {
      const valor = Number(c.valor || 0);
      previsto += valor;
      if (c.status_pagamento === 'pago') {
        recebido += valor;
        pagasCount += 1;
      } else {
        pendente += valor;
        pendentesCount += 1;
      }
    });

    return { previsto, recebido, pendente, pagasCount, pendentesCount };
  }, [filteredCreds]);

  // Formatar Moeda
  const formatCurrency = (val: number) => {
    return val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  };

  // Abrir Modal de Baixa
  const openBaixaModal = (c: Credenciamento) => {
    setBaixaModal({
      isOpen: true,
      credId: c.id,
      instName: c.conec_instituicoes.nome_instituicao,
      ano: c.ano_referencia,
      valor: c.valor,
      dataPagamento: new Date().toISOString().slice(0, 10),
      formaPagamento: 'pix',
      observacoes: '',
    });
  };

  // Confirmar pagamento manual
  const handleConfirmarPagamento = async () => {
    if (!baixaModal) return;
    setBaixaLoading(true);
    try {
      const response = await fetch('/api/secretaria/conec/financeiro/baixar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          credenciamentoId: baixaModal.credId,
          data_pagamento: baixaModal.dataPagamento,
          forma_pagamento: baixaModal.formaPagamento,
          observacoes_financeiras: baixaModal.observacoes,
        }),
      });

      const resData = await response.json();
      if (!response.ok) {
        throw new Error(resData.error || 'Erro ao processar pagamento.');
      }

      const instSalva = baixaModal.instName;
      const anoSalvo = baixaModal.ano;
      const valorSalvo = baixaModal.valor;

      setBaixaModal(null);
      setNotificacao({
        isOpen: true,
        tipo: 'success',
        titulo: 'Pagamento Confirmado',
        mensagem: `A anuidade ${anoSalvo} de "${instSalva}" no valor de ${formatCurrency(valorSalvo)} foi confirmada com sucesso!`,
      });
      fetchFinanceiro();
    } catch (err: any) {
      setNotificacao({
        isOpen: true,
        tipo: 'error',
        titulo: 'Falha na Baixa',
        mensagem: err.message || 'Falha ao confirmar pagamento manual.',
      });
    } finally {
      setBaixaLoading(false);
    }
  };

  // Exportar CSV simples dos dados filtrados
  const handleExportarCsv = () => {
    if (filteredCreds.length === 0) {
      alert('Nenhum registro para exportar.');
      return;
    }

    const headers = [
      'Instituicao',
      'CNPJ',
      'Registro',
      'Ano Referencia',
      'Valor (R$)',
      'Status Pagamento',
      'Status Credenciamento',
      'Data Pagamento',
      'Forma Pagamento',
      'Observacoes'
    ];

    const rows = filteredCreds.map((c) => [
      `"${c.conec_instituicoes.nome_instituicao.replace(/"/g, '""')}"`,
      `"${formatCnpj(c.conec_instituicoes.cnpj)}"`,
      `"${c.numero_registro || ''}"`,
      c.ano_referencia,
      c.valor,
      c.status_pagamento,
      c.status_credenciamento,
      c.data_pagamento ? new Date(c.data_pagamento).toLocaleDateString('pt-BR') : '',
      c.forma_pagamento || '',
      `"${(c.observacoes_financeiras || '').replace(/"/g, '""')}"`
    ]);

    const csvContent =
      'data:text/csv;charset=utf-8,\uFEFF' +
      [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `financeiro_conec_${yearFilter}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="flex h-screen bg-gray-100 print:bg-white print:h-auto print:overflow-visible">
      {/* Sidebar - Oculta na impressão */}
      <div className="print:hidden">
        <Sidebar activeMenu={activeMenu} setActiveMenu={setActiveMenu} />
      </div>

      <div className="flex-1 overflow-auto print:overflow-visible">
        <div className="p-6 max-w-7xl mx-auto print:p-0">

          {/* Cabeçalho */}
          <div className="mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4 print:mb-8">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <button
                  onClick={() => router.push('/secretaria/conec')}
                  className="p-1.5 hover:bg-gray-200 rounded-lg text-gray-600 transition print:hidden"
                  title="Voltar para listagem cadastral"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <span className="text-4xl">📊</span>
                <h1 className="text-3xl font-bold text-gray-800">Financeiro CONEC</h1>
              </div>
              <p className="text-gray-600 text-sm">
                Conselho de Educação Cristã — Gestão Financeira de Taxas de Credenciamento
              </p>
            </div>

            {/* Ações Rápidas - Ocultas na impressão */}
            <div className="flex items-center gap-3 print:hidden">
              <button
                onClick={handleExportarCsv}
                className="flex items-center gap-2 bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold px-4 py-2 rounded-lg text-sm transition shadow-sm"
              >
                <Download className="w-4 h-4" />
                Exportar CSV
              </button>
              <button
                onClick={() => window.print()}
                className="flex items-center gap-2 bg-teal-600 hover:bg-teal-700 text-white font-semibold px-4 py-2 rounded-lg text-sm transition shadow-sm"
              >
                <Printer className="w-4 h-4" />
                Imprimir Relatório
              </button>
            </div>
          </div>

          {/* KPIs Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-4 mb-6">
            <div className="bg-white rounded-lg shadow-md p-4 border-l-4 border-blue-500">
              <p className="text-gray-400 text-xs font-bold uppercase">Total Previsto</p>
              <h3 className="text-lg font-bold text-gray-800 mt-1">{formatCurrency(kpis.previsto)}</h3>
            </div>
            <div className="bg-white rounded-lg shadow-md p-4 border-l-4 border-green-500">
              <p className="text-gray-400 text-xs font-bold uppercase">Total Recebido</p>
              <h3 className="text-lg font-bold text-green-700 mt-1">{formatCurrency(kpis.recebido)}</h3>
            </div>
            <div className="bg-white rounded-lg shadow-md p-4 border-l-4 border-yellow-500">
              <p className="text-gray-400 text-xs font-bold uppercase">Total Pendente</p>
              <h3 className="text-lg font-bold text-yellow-700 mt-1">{formatCurrency(kpis.pendente)}</h3>
            </div>
            <div className="bg-white rounded-lg shadow-md p-4 border-l-4 border-emerald-500">
              <p className="text-gray-400 text-xs font-bold uppercase">Pagas</p>
              <h3 className="text-lg font-bold text-gray-800 mt-1">{kpis.pagasCount} inst.</h3>
            </div>
            <div className="bg-white rounded-lg shadow-md p-4 border-l-4 border-amber-500">
              <p className="text-gray-400 text-xs font-bold uppercase">Pendentes</p>
              <h3 className="text-lg font-bold text-gray-800 mt-1">{kpis.pendentesCount} inst.</h3>
            </div>
          </div>

          {/* Filtros - Ocultos na Impressão */}
          <div className="bg-white rounded-lg shadow-md p-4 mb-6 flex flex-col md:flex-row md:items-center justify-between gap-3 print:hidden">
            <div className="flex flex-1 flex-col md:flex-row gap-3">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3.5 top-2.5 w-5 h-5 text-gray-400" />
                <input
                  type="text"
                  placeholder="Buscar por instituição, CNPJ ou registro..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-11 pr-4 py-2 border-2 border-teal-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                />
              </div>

              {/* Filtro de Ano */}
              <select
                value={yearFilter}
                onChange={(e) => setYearFilter(e.target.value)}
                className="border-2 border-teal-500 rounded-lg px-4 py-2 text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm bg-white font-semibold"
              >
                <option value="todos">Todos os Anos</option>
                {availableYears.map((year) => (
                  <option key={year} value={year}>{year}</option>
                ))}
              </select>

              {/* Filtro de Status Pagamento */}
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="border-2 border-teal-500 rounded-lg px-4 py-2 text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm bg-white font-semibold"
              >
                <option value="todos">Todos os Status</option>
                <option value="pago">Pago</option>
                <option value="pendente">Pendente</option>
              </select>
            </div>
          </div>

          {/* Tabela Financeira */}
          {loading ? (
            <div className="bg-white rounded-lg shadow-md p-12 text-center text-gray-500">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4" />
              Carregando dados financeiros...
            </div>
          ) : error ? (
            <div className="bg-red-50 text-red-700 p-6 rounded-lg border border-red-200 text-center">{error}</div>
          ) : filteredCreds.length === 0 ? (
            <div className="bg-white rounded-lg shadow-md p-12 text-center text-gray-500">
              <Building2 className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              Nenhum registro financeiro encontrado.
            </div>
          ) : (
            <div className="bg-white rounded-lg shadow-md overflow-hidden border border-gray-200 print:border-0 print:shadow-none">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200 text-gray-500 font-bold text-xs uppercase tracking-wider">
                      <th className="px-6 py-4">Instituição / CNPJ</th>
                      <th className="px-6 py-4 text-center">Ano</th>
                      <th className="px-6 py-4">Valor</th>
                      <th className="px-6 py-4">Status Pagamento</th>
                      <th className="px-6 py-4">Status Credenciamento</th>
                      <th className="px-6 py-4">Data Pagamento</th>
                      <th className="px-6 py-4 text-center print:hidden">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 text-sm text-gray-700 bg-white">
                    {filteredCreds.map((c) => (
                      <tr key={c.id} className="hover:bg-gray-50/70 transition-colors">
                        <td className="px-6 py-4">
                          <div className="font-bold text-gray-950">{c.conec_instituicoes?.nome_instituicao}</div>
                          <div className="text-xs text-gray-500 mt-1 font-semibold">
                            {c.conec_instituicoes?.cnpj ? formatCnpj(c.conec_instituicoes.cnpj) : ''}
                          </div>
                        </td>
                        <td className="px-6 py-4 text-center font-bold text-gray-800">
                          {c.ano_referencia}
                        </td>
                        <td className="px-6 py-4 font-bold text-gray-900">
                          {formatCurrency(c.valor)}
                        </td>
                        <td className="px-6 py-4">
                          <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold ${
                            c.status_pagamento === 'pago'
                              ? 'bg-green-100 text-green-800 border border-green-200'
                              : 'bg-yellow-100 text-yellow-800 border border-yellow-200'
                          }`}>
                            {c.status_pagamento === 'pago' ? 'Pago' : 'Pendente'}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${
                            c.status_credenciamento === 'ativo'
                              ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                              : c.status_credenciamento === 'cancelado' || c.status_credenciamento === 'suspenso'
                              ? 'bg-red-100 text-red-800 border border-red-200'
                              : 'bg-gray-100 text-gray-800 border border-gray-200'
                          }`}>
                            {c.status_credenciamento}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-gray-600 font-medium">
                          {c.data_pagamento
                            ? new Date(c.data_pagamento).toLocaleDateString('pt-BR')
                            : '-'}
                        </td>
                        <td className="px-6 py-4 text-center print:hidden">
                          <div className="flex items-center justify-center gap-2">
                            {c.status_pagamento === 'pendente' &&
                             c.status_credenciamento !== 'cancelado' &&
                             c.status_credenciamento !== 'suspenso' ? (
                              <>
                                {c.asaas_invoice_url ? (
                                  <a
                                    href={c.asaas_invoice_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    title="Abrir Fatura Asaas"
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-bold transition shadow-sm"
                                  >
                                    <ExternalLink className="w-3.5 h-3.5" />
                                    Abrir Fatura
                                  </a>
                                ) : (
                                  <button
                                    disabled
                                    title="Fatura ainda não gerada"
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-150 text-gray-400 border border-gray-200 rounded text-xs font-bold cursor-not-allowed"
                                  >
                                    <ExternalLink className="w-3.5 h-3.5" />
                                    Abrir Fatura
                                  </button>
                                )}
                                <button
                                  onClick={() => openBaixaModal(c)}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded text-xs font-bold transition shadow-sm"
                                >
                                  <CheckCircle className="w-3.5 h-3.5" />
                                  Baixar Manual
                                </button>
                              </>
                            ) : (
                              <span className="text-gray-400 text-xs italic font-medium">
                                {c.status_pagamento === 'pago' ? 'Confirmado' : 'Bloqueado'}
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

        </div>
      </div>

      {/* Modal de Confirmação de Pagamento */}
      {baixaModal && baixaModal.isOpen && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-xs z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden border border-emerald-100 my-6 animate-in fade-in zoom-in-95 duration-200 text-gray-800 flex flex-col">
            {/* Header com gradiente verde/teal moderno */}
            <div className="bg-gradient-to-r from-emerald-800 via-teal-700 to-green-800 text-white px-6 py-4 flex items-center justify-between shadow-md">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-white/20 backdrop-blur-md rounded-xl flex items-center justify-center shadow-inner">
                  <CheckCircle2 className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="text-lg font-extrabold tracking-tight">Confirmar Pagamento</h3>
                  <p className="text-xs text-emerald-100 mt-0.5">Baixa manual de anuidade CONEC</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setBaixaModal(null)}
                className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition cursor-pointer"
                title="Fechar"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Body */}
            <div className="p-6 space-y-4 bg-slate-50/50 overflow-y-auto">
              {/* Card de Resumo (Instituição + Valor) */}
              <div className="bg-white rounded-2xl p-4.5 border border-emerald-100 shadow-xs space-y-3">
                <div>
                  <div className="flex items-center gap-1.5 text-xs font-bold text-gray-500 uppercase tracking-wider">
                    <Building2 className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Instituição</span>
                  </div>
                  <p className="text-sm sm:text-base font-bold text-gray-900 leading-snug mt-1">
                    {baixaModal.instName}
                  </p>
                  <div className="mt-1.5">
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-teal-50 text-teal-800 border border-teal-200">
                      Referência: <strong>{baixaModal.ano}</strong>
                    </span>
                  </div>
                </div>

                <div className="border-t border-gray-100 pt-3 flex items-center justify-between">
                  <span className="text-xs font-bold text-gray-500 uppercase">Valor a Confirmar</span>
                  <span className="text-2xl font-black text-emerald-700 tracking-tight">
                    {formatCurrency(baixaModal.valor)}
                  </span>
                </div>
              </div>

              {/* Data de pagamento */}
              <div>
                <label className="flex items-center gap-1.5 text-xs font-bold text-gray-700 uppercase mb-1.5">
                  <Calendar className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Data do Pagamento *</span>
                </label>
                <input
                  type="date"
                  value={baixaModal.dataPagamento}
                  onChange={(e) => setBaixaModal({ ...baixaModal, dataPagamento: e.target.value })}
                  className="w-full rounded-xl border border-gray-300 bg-white px-3.5 py-2.5 text-sm font-medium text-gray-800 shadow-xs focus:border-emerald-500 focus:outline-none focus:ring-3 focus:ring-emerald-500/20 transition"
                />
              </div>

              {/* Forma de pagamento */}
              <div>
                <label className="flex items-center gap-1.5 text-xs font-bold text-gray-700 uppercase mb-1.5">
                  <CreditCard className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Forma de Pagamento *</span>
                </label>
                <select
                  value={baixaModal.formaPagamento}
                  onChange={(e) => setBaixaModal({ ...baixaModal, formaPagamento: e.target.value })}
                  className="w-full rounded-xl border border-gray-300 bg-white px-3.5 py-2.5 text-sm font-semibold text-gray-800 shadow-xs focus:border-emerald-500 focus:outline-none focus:ring-3 focus:ring-emerald-500/20 transition cursor-pointer"
                >
                  <option value="pix">Pix</option>
                  <option value="boleto">Boleto Bancário</option>
                  <option value="cartao">Cartão de Crédito</option>
                  <option value="transferencia">Transferência / TED</option>
                  <option value="dinheiro">Dinheiro</option>
                  <option value="outro">Outro</option>
                </select>
              </div>

              {/* Observações */}
              <div>
                <label className="flex items-center gap-1.5 text-xs font-bold text-gray-700 uppercase mb-1.5">
                  <FileText className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Observações Financeiras</span>
                </label>
                <textarea
                  value={baixaModal.observacoes}
                  placeholder="Ex: Pagamento recebido offline em mãos ou comprovante conferido..."
                  onChange={(e) => setBaixaModal({ ...baixaModal, observacoes: e.target.value })}
                  className="w-full rounded-xl border border-gray-300 bg-white p-3 text-sm text-gray-800 shadow-xs focus:border-emerald-500 focus:outline-none focus:ring-3 focus:ring-emerald-500/20 transition h-20 resize-none"
                />
              </div>
            </div>

            {/* Footer */}
            <div className="bg-white px-6 py-4 flex items-center justify-between border-t border-gray-200">
              <button
                type="button"
                onClick={() => setBaixaModal(null)}
                disabled={baixaLoading}
                className="px-5 py-2.5 rounded-xl border border-gray-300 text-gray-700 hover:bg-gray-100 font-semibold text-sm transition cursor-pointer disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmarPagamento}
                disabled={baixaLoading}
                className="px-6 py-2.5 bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-700 hover:from-emerald-700 hover:to-teal-800 text-white font-bold text-sm rounded-xl shadow-md hover:shadow-lg transition flex items-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {baixaLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Confirmando...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Confirmar Pagamento</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal / Toast de Notificação */}
      {notificacao && notificacao.isOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 text-center border border-gray-200 animate-in fade-in zoom-in-95 duration-200">
            <div className={`w-14 h-14 mx-auto rounded-full flex items-center justify-center mb-4 ${
              notificacao.tipo === 'success' ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'
            }`}>
              {notificacao.tipo === 'success' ? (
                <CheckCircle2 className="w-8 h-8" />
              ) : (
                <AlertCircle className="w-8 h-8" />
              )}
            </div>
            <h3 className="text-lg font-bold text-gray-900 mb-2">{notificacao.titulo}</h3>
            <p className="text-sm text-gray-600 mb-6">{notificacao.mensagem}</p>
            <button
              onClick={() => setNotificacao(null)}
              className={`w-full py-2.5 px-4 rounded-xl font-bold text-sm text-white shadow-md transition cursor-pointer ${
                notificacao.tipo === 'success'
                  ? 'bg-emerald-600 hover:bg-emerald-700'
                  : 'bg-red-600 hover:bg-red-700'
              }`}
            >
              OK
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
