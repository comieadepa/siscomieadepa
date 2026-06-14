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
  Download,
  Printer,
  ArrowLeft,
  X,
  ExternalLink
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

      alert('Pagamento confirmado com sucesso!');
      setBaixaModal(null);
      fetchFinanceiro();
    } catch (err: any) {
      alert(err.message || 'Falha ao confirmar pagamento.');
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
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-2xl max-w-md w-full overflow-hidden border border-gray-200 animate-in fade-in zoom-in-95 duration-200 text-gray-800">
            {/* Header */}
            <div className="bg-green-700 text-white p-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle className="w-5 h-5" />
                <h3 className="font-bold text-lg">Confirmar Pagamento</h3>
              </div>
              <button
                onClick={() => setBaixaModal(null)}
                className="text-white hover:text-green-200 transition"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            {/* Body */}
            <div className="p-6 space-y-4">
              <div>
                <p className="text-xs text-gray-400 uppercase font-semibold">Instituição</p>
                <p className="text-sm font-bold text-gray-900">{baixaModal.instName}</p>
                <p className="text-xs text-teal-600 font-semibold mt-0.5">Referência: {baixaModal.ano}</p>
              </div>

              <div>
                <p className="text-xs text-gray-400 uppercase font-semibold">Valor</p>
                <p className="text-lg font-extrabold text-green-700">{formatCurrency(baixaModal.valor)}</p>
              </div>

              {/* Data de pagamento */}
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">
                  Data de Pagamento *
                </label>
                <input
                  type="date"
                  value={baixaModal.dataPagamento}
                  onChange={(e) => setBaixaModal({ ...baixaModal, dataPagamento: e.target.value })}
                  className="w-full border-2 border-teal-500 rounded-lg p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Forma de pagamento */}
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">
                  Forma de Pagamento *
                </label>
                <select
                  value={baixaModal.formaPagamento}
                  onChange={(e) => setBaixaModal({ ...baixaModal, formaPagamento: e.target.value })}
                  className="w-full border-2 border-teal-500 rounded-lg p-2 text-sm focus:outline-none bg-white font-semibold"
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
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">
                  Observações Financeiras
                </label>
                <textarea
                  value={baixaModal.observacoes}
                  placeholder="Ex: Pagamento recebido offline em mãos..."
                  onChange={(e) => setBaixaModal({ ...baixaModal, observacoes: e.target.value })}
                  className="w-full border-2 border-teal-500 rounded-lg p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 h-20"
                />
              </div>
            </div>

            {/* Footer */}
            <div className="bg-gray-50 px-6 py-4 flex justify-end gap-2 border-t border-gray-100">
              <button
                onClick={() => setBaixaModal(null)}
                className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 font-semibold rounded-lg text-xs transition"
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirmarPagamento}
                disabled={baixaLoading}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-bold rounded-lg text-xs transition flex items-center gap-1.5 shadow-sm disabled:opacity-50"
              >
                {baixaLoading ? 'Confirmando...' : 'Confirmar Pagamento'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
