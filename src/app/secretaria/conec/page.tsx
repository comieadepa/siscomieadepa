'use client';

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import { createClient } from '@/lib/supabase-client';
import { deleteInstituicao, type InstitutionInput } from '@/lib/conec-service';
import { formatCnpj } from '@/lib/mascaras';
import {
  Building2,
  Plus,
  Search,
  Edit2,
  Trash2,
  ShieldCheck,
  Mail,
  MapPin,
  Printer,
  Award,
  CreditCard,
  X,
  ExternalLink,
  CheckCircle,
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
  asaas_payment_id?: string;
  asaas_invoice_url?: string;
  asaas_pix_qrcode?: string;
  asaas_status?: string;
}

interface InstitutionWithId extends InstitutionInput {
  id: string;
  created_at: string;
  conec_credenciamentos?: Credenciamento[];
}

export default function ConecDashboardPage() {
  const router = useRouter();
  const supabase = createClient();
  
  const [instituicoes, setInstituicoes] = useState<InstitutionWithId[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeMenu, setActiveMenu] = useState('conec-dashboard');

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'todos' | 'ativo' | 'inativo'>('todos');

  // Modelos do CONEC carregados para seleção de impressão
  const [modelosTermo, setModelosTermo] = useState<any[]>([]);
  const [modelosCertificado, setModelosCertificado] = useState<any[]>([]);
  const [modalPrint, setModalPrint] = useState<{
    isOpen: boolean;
    type: 'termo' | 'certificado';
    instId: string;
    credId?: string;
  } | null>(null);

  // Modal de Cobrança Gerada
  const [billingModal, setBillingModal] = useState<{
    isOpen: boolean;
    instName: string;
    paymentInfo: {
      id: string;
      invoiceUrl: string | null;
      pixQrCode: string | null;
      pixCopiaECola: string | null;
    } | null;
    fallbackUsed: boolean;
  } | null>(null);

  const [billingLoadingId, setBillingLoadingId] = useState<string | null>(null);

  const fetchDados = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: fetchErr } = await supabase
        .from('conec_instituicoes')
        .select(`
          *,
          conec_credenciamentos (
            id,
            ano_referencia,
            numero_registro,
            data_inicio,
            data_fim,
            data_emissao,
            status_credenciamento,
            status_pagamento,
            valor,
            asaas_payment_id,
            asaas_invoice_url,
            asaas_pix_qrcode,
            asaas_status
          )
        `)
        .is('deleted_at', null)
        .order('nome_instituicao', { ascending: true });

      if (fetchErr) throw fetchErr;
      setInstituicoes((data || []) as InstitutionWithId[]);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Erro ao carregar instituições.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDados();
    
    // Buscar templates salvos do CONEC para impressão
    (async () => {
      try {
        const { data: templates } = await supabase
          .from('certificados_templates')
          .select('*');
        if (templates) {
          const termos = templates.filter((t: any) => t.template_data?.document_type === 'termo_conec' || t.name.toLowerCase().includes('termo'));
          const certs = templates.filter((t: any) => t.template_data?.document_type === 'certificado_conec' || (!t.template_data?.document_type && t.name.toLowerCase().includes('conec')));
          setModelosTermo(termos);
          setModelosCertificado(certs);
        }
      } catch (err) {
        console.warn('Erro ao carregar templates para listagem:', err);
      }
    })();
  }, []);

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Deseja realmente remover a instituição "${name}"?`)) return;
    try {
      await deleteInstituicao(supabase, id);
      fetchDados();
    } catch (err: any) {
      alert(err.message || 'Erro ao remover instituição.');
    }
  };

  // Botão Ficha: abrir em nova aba
  const handleFicha = (instId: string) => {
    if (modelosTermo.length > 0) {
      setModalPrint({ isOpen: true, type: 'termo', instId });
    } else {
      window.open(`/secretaria/conec/imprimir/ficha/${instId}`, '_blank');
    }
  };

  // Botão Certificado: abrir em nova aba usando credenciamento ativo mais recente
  const handleCertificado = (inst: InstitutionWithId) => {
    const activeCreds = inst.conec_credenciamentos
      ?.filter((c) => c.status_credenciamento === 'ativo')
      ?.sort((a, b) => b.ano_referencia - a.ano_referencia);

    if (!activeCreds || activeCreds.length === 0) {
      alert('Esta instituição ainda não possui credenciamento ativo para emissão do certificado.');
      return;
    }

    const credId = activeCreds[0].id;
    if (modelosCertificado.length > 0) {
      setModalPrint({ isOpen: true, type: 'certificado', instId: inst.id, credId });
    } else {
      window.open(`/secretaria/conec/imprimir/certificado/${credId}`, '_blank');
    }
  };

  // Botão Gerar Taxa ASAAS
  const handleGerarTaxa = async (inst: InstitutionWithId) => {
    setBillingLoadingId(inst.id);
    try {
      const response = await fetch('/api/secretaria/conec/gerar-taxa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instituicaoId: inst.id }),
      });

      const resData = await response.json();

      if (!response.ok) {
        throw new Error(resData.error || 'Erro ao gerar taxa.');
      }

      // Se retornou que a cobrança já existia, mas sem novas info de pagamento, mostre aviso ou abra a URL
      if (resData.message === 'Cobrança já existente.') {
        const cred = resData.credenciamento;
        alert(`Esta instituição já possui uma taxa pendente para este ano. Registro: ${cred.numero_registro}`);
        fetchDados();
        return;
      }

      setBillingModal({
        isOpen: true,
        instName: inst.nome_instituicao,
        paymentInfo: resData.paymentInfo,
        fallbackUsed: resData.fallbackUsed,
      });

      fetchDados();
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Falha ao processar solicitação de taxa ASAAS.');
    } finally {
      setBillingLoadingId(null);
    }
  };

  const filteredInstituicoes = useMemo(() => {
    return instituicoes.filter((inst) => {
      const matchSearch =
        inst.nome_instituicao.toLowerCase().includes(searchTerm.toLowerCase()) ||
        inst.cnpj.replace(/\D/g, '').includes(searchTerm.replace(/\D/g, '')) ||
        inst.nome_representante.toLowerCase().includes(searchTerm.toLowerCase());

      const matchStatus =
        statusFilter === 'todos' ||
        inst.status === statusFilter;

      return matchSearch && matchStatus;
    });
  }, [instituicoes, searchTerm, statusFilter]);

  const metrics = useMemo(() => {
    const total = instituicoes.length;
    const ativas = instituicoes.filter((i) => i.status === 'ativo').length;
    const inativas = total - ativas;
    return { total, ativas, inativas };
  }, [instituicoes]);

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar activeMenu={activeMenu} setActiveMenu={setActiveMenu} />

      <div className="flex-1 overflow-auto">
        <div className="p-6 max-w-7xl mx-auto">

          {/* Cabeçalho */}
          <div className="mb-6">
            <div className="flex items-center gap-3 mb-2">
              <span className="text-4xl">🎓</span>
              <h1 className="text-3xl font-bold text-gray-800">CONEC</h1>
            </div>
            <p className="text-gray-600 text-sm">Conselho de Educação Cristã — Credenciamento de Instituições Teológicas</p>
          </div>

          {/* Cards de métricas */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="bg-white rounded-lg shadow-md p-5 flex items-center gap-4 border-l-4 border-blue-500">
              <div className="w-12 h-12 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center flex-shrink-0">
                <Building2 className="w-6 h-6" />
              </div>
              <div>
                <p className="text-gray-500 text-xs uppercase font-semibold">Total de Instituições</p>
                <h3 className="text-2xl font-bold text-gray-800">{metrics.total}</h3>
              </div>
            </div>
            <div className="bg-white rounded-lg shadow-md p-5 flex items-center gap-4 border-l-4 border-green-500">
              <div className="w-12 h-12 rounded-xl bg-green-50 text-green-600 flex items-center justify-center flex-shrink-0">
                <ShieldCheck className="w-6 h-6" />
              </div>
              <div>
                <p className="text-gray-500 text-xs uppercase font-semibold">Credenciadas Ativas</p>
                <h3 className="text-2xl font-bold text-gray-800">{metrics.ativas}</h3>
              </div>
            </div>
            <div className="bg-white rounded-lg shadow-md p-5 flex items-center gap-4 border-l-4 border-yellow-500">
              <div className="w-12 h-12 rounded-xl bg-yellow-50 text-yellow-600 flex items-center justify-center flex-shrink-0">
                <Building2 className="w-6 h-6" />
              </div>
              <div>
                <p className="text-gray-500 text-xs uppercase font-semibold">Inativas</p>
                <h3 className="text-2xl font-bold text-gray-800">{metrics.inativas}</h3>
              </div>
            </div>
          </div>

          {/* Barra de ações */}
          <div className="bg-white rounded-lg shadow-md p-4 mb-6 flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex flex-1 flex-col md:flex-row gap-3">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3.5 top-2.5 w-5 h-5 text-gray-400" />
                <input
                  type="text"
                  placeholder="Buscar por nome, CNPJ ou representante..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-11 pr-4 py-2 border-2 border-teal-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                />
              </div>
              <select
                value={statusFilter}
                onChange={(e: any) => setStatusFilter(e.target.value)}
                className="border-2 border-teal-500 rounded-lg px-4 py-2 text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm bg-white"
              >
                <option value="todos">Todos os Status</option>
                <option value="ativo">Ativo</option>
                <option value="inativo">Inativo</option>
              </select>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={() => router.push('/secretaria/conec/financeiro')}
                className="flex items-center justify-center gap-2 bg-teal-600 hover:bg-teal-700 text-white font-semibold px-5 py-2 rounded-lg transition text-sm shadow-sm"
              >
                <span>📊</span>
                Financeiro
              </button>

              <button
                onClick={() => router.push('/secretaria/conec/cadastro')}
                className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold px-5 py-2 rounded-lg transition text-sm shadow-sm"
              >
                <Plus className="w-5 h-5" />
                Cadastrar Instituição
              </button>
            </div>
          </div>

          {/* Tabela */}
          {loading ? (
            <div className="bg-white rounded-lg shadow-md p-12 text-center text-gray-500">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4" />
              Carregando instituições...
            </div>
          ) : error ? (
            <div className="bg-red-50 text-red-700 p-6 rounded-lg border border-red-200 text-center">{error}</div>
          ) : filteredInstituicoes.length === 0 ? (
            <div className="bg-white rounded-lg shadow-md p-12 text-center text-gray-500">
              <Building2 className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              Nenhuma instituição encontrada.
            </div>
          ) : (
            <div className="bg-white rounded-lg shadow-md overflow-hidden border border-gray-200">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200 text-gray-500 font-bold text-xs uppercase tracking-wider">
                      <th className="px-6 py-4">Instituição / CNPJ</th>
                      <th className="px-6 py-4">Representante</th>
                      <th className="px-6 py-4">Localização</th>
                      <th className="px-6 py-4">Status</th>
                      <th className="px-6 py-4 text-center">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 text-sm text-gray-700 bg-white">
                    {filteredInstituicoes.map((inst) => {
                      const latestCred = inst.conec_credenciamentos
                        ?.sort((a, b) => b.ano_referencia - a.ano_referencia)[0];

                      let statusText = 'Aguardando pagamento';
                      let statusColorClass = 'bg-yellow-100 text-yellow-850 border border-yellow-200';

                      if (latestCred) {
                        if (latestCred.status_pagamento === 'pago' && latestCred.status_credenciamento === 'ativo') {
                          statusText = 'Credenciado Ativo';
                          statusColorClass = 'bg-green-100 text-green-800 border border-green-200';
                        } else if (latestCred.status_pagamento === 'pendente') {
                          statusText = 'Aguardando pagamento';
                          statusColorClass = 'bg-yellow-100 text-yellow-800 border border-yellow-200';
                        } else {
                          const rawStatus = latestCred.status_credenciamento || 'Inativo';
                          statusText = rawStatus.charAt(0).toUpperCase() + rawStatus.slice(1);
                          statusColorClass = 'bg-red-100 text-red-800 border border-red-200';
                        }
                      }

                      const isDocLocked = !latestCred || latestCred.status_pagamento !== 'pago' || latestCred.status_credenciamento !== 'ativo';

                      const handleFichaClick = () => {
                        if (isDocLocked) {
                          alert("Documento disponível somente após confirmação do pagamento da taxa de credenciamento.");
                          return;
                        }
                        handleFicha(inst.id);
                      };

                      const handleCertificadoClick = () => {
                        if (isDocLocked) {
                          alert("Documento disponível somente após confirmação do pagamento da taxa de credenciamento.");
                          return;
                        }
                        handleCertificado(inst);
                      };

                      return (
                        <tr key={inst.id} className="hover:bg-gray-50/70 transition-colors">
                          <td className="px-6 py-4 bg-teal-50/10">
                            <div className="font-bold text-gray-900 text-base">{inst.nome_instituicao}</div>
                            <div className="text-xs font-semibold text-teal-600 mt-1">{formatCnpj(inst.cnpj)}</div>
                          </td>
                          <td className="px-6 py-4">
                            <div className="font-semibold text-gray-800">{inst.nome_representante}</div>
                            <div className="text-xs text-gray-400 mt-0.5 font-medium">Representante Legal</div>
                            <div className="text-xs text-gray-500 mt-1 flex items-center gap-1.5 font-mono">
                              <Mail className="w-3.5 h-3.5 text-gray-400" />
                              {inst.email_representante}
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            {inst.cidade && inst.estado ? (
                              <div className="flex items-center gap-1.5 text-gray-700 font-medium">
                                <MapPin className="w-4 h-4 text-teal-500" />
                                {inst.cidade} - {inst.estado}
                              </div>
                            ) : (
                              <span className="text-gray-400 italic">Não informado</span>
                            )}
                          </td>
                          <td className="px-6 py-4">
                            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold ${statusColorClass}`}>
                              {statusText}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex items-center justify-center gap-2">
                              
                              {/* Ficha */}
                              <button
                                onClick={handleFichaClick}
                                title={isDocLocked ? "Documento disponível somente após confirmação do pagamento" : "Ficha de Credenciamento"}
                                className={`p-2 rounded-full transition shadow-sm ${
                                  isDocLocked
                                    ? 'bg-gray-50 text-gray-300 border border-gray-150'
                                    : 'bg-gray-50 hover:bg-blue-50 hover:text-blue-600 text-gray-600 border border-gray-200 hover:border-blue-200'
                                }`}
                              >
                                <Printer className="w-4 h-4" />
                              </button>

                              {/* Certificado */}
                              <button
                                onClick={handleCertificadoClick}
                                title={isDocLocked ? "Documento disponível somente após confirmação do pagamento" : "Certificado de Credenciamento"}
                                className={`p-2 rounded-full transition shadow-sm ${
                                  !isDocLocked
                                    ? 'bg-teal-50 hover:bg-teal-600 hover:text-white text-teal-700 border border-teal-200 hover:border-teal-600'
                                    : 'bg-gray-50 text-gray-300 border border-gray-150'
                                }`}
                              >
                                <Award className="w-4 h-4" />
                              </button>

                              {/* Gerar taxa */}
                              <button
                                onClick={() => handleGerarTaxa(inst)}
                                disabled={billingLoadingId === inst.id}
                                title="Gerar taxa de Credenciamento — ASAAS Bank"
                                className="p-2 bg-blue-50 hover:bg-blue-600 hover:text-white text-blue-700 border border-blue-200 hover:border-blue-600 rounded-full transition shadow-sm disabled:opacity-50"
                              >
                                <CreditCard className="w-4 h-4" />
                              </button>

                              {/* Editar */}
                              <button
                                onClick={() => router.push(`/secretaria/conec/cadastro?id=${inst.id}`)}
                                title="Editar Cadastro"
                                className="p-2 bg-gray-50 hover:bg-amber-50 hover:text-amber-600 text-gray-600 border border-gray-200 hover:border-amber-200 rounded-full transition shadow-sm"
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>

                              {/* Excluir */}
                              <button
                                onClick={() => handleDelete(inst.id, inst.nome_instituicao)}
                                title="Excluir Cadastro"
                                className="p-2 bg-gray-50 hover:bg-red-50 hover:text-red-600 text-gray-600 border border-gray-200 hover:border-red-200 rounded-full transition shadow-sm"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>

                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

        </div>
      </div>

      {/* Modal de Detalhes da Cobrança Gerada */}
      {billingModal && billingModal.isOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-2xl max-w-lg w-full overflow-hidden border border-gray-200 animate-in fade-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="bg-teal-800 text-white p-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle className="w-5 h-5" />
                <h3 className="font-bold text-lg">Taxa Gerada com Sucesso</h3>
              </div>
              <button
                onClick={() => setBillingModal(null)}
                className="text-white hover:text-teal-200 transition"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            {/* Body */}
            <div className="p-6 space-y-4">
              <div>
                <p className="text-xs text-gray-400 uppercase font-semibold">Instituição</p>
                <p className="text-base font-bold text-gray-800">{billingModal.instName}</p>
              </div>

              <div>
                <p className="text-xs text-gray-400 uppercase font-semibold">Descrição</p>
                <p className="text-sm font-semibold text-gray-700">Taxa de Credenciamento CONEC — R$ 800,00</p>
              </div>

              {billingModal.paymentInfo?.invoiceUrl ? (
                <div className="pt-2">
                  <a
                    href={billingModal.paymentInfo.invoiceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full inline-flex items-center justify-center gap-2 bg-teal-600 hover:bg-teal-700 text-white font-bold py-3 px-4 rounded-lg text-sm transition shadow-sm"
                  >
                    Abrir Link de Pagamento (Fatura Asaas)
                    <ExternalLink className="w-4 h-4" />
                  </a>
                </div>
              ) : null}

              {billingModal.paymentInfo?.pixCopiaECola ? (
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                  <p className="text-xs text-gray-500 font-bold uppercase mb-1">Código Pix Copia e Cola</p>
                  <input
                    readOnly
                    value={billingModal.paymentInfo.pixCopiaECola}
                    onClick={(e) => (e.target as HTMLInputElement).select()}
                    className="w-full text-xs font-mono bg-white border border-gray-300 rounded p-2 text-gray-600 select-all"
                  />
                  <p className="text-[10px] text-gray-400 mt-1">Clique para selecionar e copiar o código Pix.</p>
                </div>
              ) : null}

              {billingModal.fallbackUsed && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-2.5 text-amber-800 text-xs">
                  <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold block mb-1">Nota de Integração</span>
                    A cobrança foi criada no Asaas com sucesso (ID: {billingModal.paymentInfo?.id}), porém as colunas extras de link/PIX não puderam ser salvas no banco. Execute a migração SQL no seu painel para normalizar a exibição.
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="bg-gray-50 px-6 py-4 flex justify-end border-t border-gray-100">
              <button
                onClick={() => setBillingModal(null)}
                className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 font-semibold rounded-lg text-xs transition"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Seleção de Modelo para Impressão */}
      {modalPrint && modalPrint.isOpen && (
        <ModalPrintSelection
          type={modalPrint.type}
          templates={modalPrint.type === 'termo' ? modelosTermo : modelosCertificado}
          onClose={() => setModalPrint(null)}
          onConfirm={(templateId) => {
            const url = modalPrint.type === 'termo'
              ? `/secretaria/conec/imprimir/ficha/${modalPrint.instId}${templateId !== 'default' ? `?templateId=${templateId}` : ''}`
              : `/secretaria/conec/imprimir/certificado/${modalPrint.credId}${templateId !== 'default' ? `?templateId=${templateId}` : ''}`;
            window.open(url, '_blank');
            setModalPrint(null);
          }}
        />
      )}
    </div>
  );
}

// Modal de Seleção de Modelo para Impressão
interface ModalPrintSelectionProps {
  type: 'termo' | 'certificado';
  templates: any[];
  onConfirm: (templateId: string) => void;
  onClose: () => void;
}

function ModalPrintSelection({ type, templates, onConfirm, onClose }: ModalPrintSelectionProps) {
  const [selectedId, setSelectedId] = useState<string>('default');

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="relative bg-white rounded-2xl max-w-md w-full shadow-2xl border border-gray-100 overflow-hidden transform transition-all duration-300 scale-100">
        
        {/* Header */}
        <div className="bg-emerald-600 px-6 py-4 flex items-center justify-between text-white">
          <div className="flex items-center gap-2">
            <Award className="w-5 h-5 text-emerald-100" />
            <h3 className="font-bold text-sm">Selecione o Modelo de Impressão</h3>
          </div>
          <button onClick={onClose} className="text-emerald-100 hover:text-white transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">
          <p className="text-xs text-gray-500 leading-relaxed">
            Escolha abaixo o modelo visual de documento que deseja utilizar para gerar o(a) {type === 'termo' ? 'Termo de Credenciamento A4' : 'Certificado Oficial'}.
          </p>

          <div className="space-y-2">
            <label className="flex items-center gap-3 p-3 rounded-xl border border-emerald-500 bg-emerald-50/20 hover:bg-emerald-50/30 transition cursor-pointer">
              <input
                type="radio"
                name="print-template"
                value="default"
                checked={selectedId === 'default'}
                onChange={() => setSelectedId('default')}
                className="text-emerald-600 focus:ring-emerald-500 animate-none"
              />
              <div className="flex-1">
                <span className="block text-xs font-bold text-gray-800">Modelo Padrão do Sistema</span>
                <span className="block text-[10px] text-emerald-700 font-medium">Layout oficial polido do CONEC</span>
              </div>
            </label>

            {templates.map((t) => (
              <label
                key={t.template_key}
                className={`flex items-center gap-3 p-3 rounded-xl border transition cursor-pointer ${
                  selectedId === t.template_key
                    ? 'border-emerald-500 bg-emerald-50/20'
                    : 'border-gray-200 hover:bg-gray-50'
                }`}
              >
                <input
                  type="radio"
                  name="print-template"
                  value={t.template_key}
                  checked={selectedId === t.template_key}
                  onChange={() => setSelectedId(t.template_key)}
                  className="text-emerald-600 focus:ring-emerald-500 animate-none"
                />
                <div className="flex-1">
                  <span className="block text-xs font-bold text-gray-800">{t.name}</span>
                  <span className="block text-[10px] text-gray-400 font-medium">
                    Orientação: {t.template_data?.orientacao === 'portrait' ? 'Retrato (A4)' : 'Paisagem'}
                  </span>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="bg-gray-50 px-6 py-4 flex justify-end gap-2 border-t border-gray-100">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 font-semibold rounded-lg text-xs transition"
          >
            Cancelar
          </button>
          <button
            onClick={() => onConfirm(selectedId)}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg text-xs transition shadow-sm"
          >
            Confirmar e Abrir
          </button>
        </div>
      </div>
    </div>
  );
}
