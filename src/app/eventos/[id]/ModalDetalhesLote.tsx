'use client';

import { useState, useEffect } from 'react';
import {
  X,
  CreditCard,
  User,
  Calendar,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ExternalLink,
  Users,
  ShieldCheck,
  Loader2,
} from 'lucide-react';

interface ParticipanteLote {
  id: string;
  nome_inscrito: string;
  cpf: string | null;
  tipo_inscricao: string | null;
  status_pagamento: string;
  forma_pagamento: string;
  valor_individual: number;
  updated_at: string;
}

interface DadosLote {
  id: string;
  codigo: string;
  responsavel_nome: string;
  responsavel_email: string | null;
  responsavel_whatsapp: string | null;
  status_pagamento: string;
  valor_cobranca: number;
  valor_efetivamente_pago: number;
  asaas_payment_id: string | null;
  data_criacao: string;
  data_confirmacao: string | null;
  data_vencimento: string | null;
  invoice_url: string | null;
  comprovante_url: string | null;
  forma_pagamento: string;
}

interface ResumoFinanceiro {
  quantidade_participantes: number;
  total_soma_inscricoes: number;
  valor_cobranca: number;
  valor_efetivamente_pago: number;
  tem_divergencia: boolean;
  diferenca_valor: number;
}

interface ModalDetalhesLoteProps {
  eventoId: string;
  loteId: string | null;
  isOpen: boolean;
  onClose: () => void;
}

function formatarCPF(cpf: string | null | undefined): string {
  if (!cpf) return '—';
  const clean = cpf.replace(/\D/g, '');
  if (clean.length === 11) {
    return clean.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  }
  return cpf;
}

function formatarDataHora(dataIso: string | null | undefined): string {
  if (!dataIso) return '—';
  try {
    const d = new Date(dataIso);
    return d.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dataIso;
  }
}

function formatarMoeda(val: number | null | undefined): string {
  const v = Number(val || 0);
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export default function ModalDetalhesLote({
  eventoId,
  loteId,
  isOpen,
  onClose,
}: ModalDetalhesLoteProps) {
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [lote, setLote] = useState<DadosLote | null>(null);
  const [resumo, setResumo] = useState<ResumoFinanceiro | null>(null);
  const [participantes, setParticipantes] = useState<ParticipanteLote[]>([]);

  useEffect(() => {
    if (!isOpen || !loteId) {
      setLote(null);
      setResumo(null);
      setParticipantes([]);
      setErro(null);
      return;
    }

    let isMounted = true;
    async function carregarDetalhes() {
      setCarregando(true);
      setErro(null);
      try {
        const res = await fetch(`/api/eventos/${eventoId}/lotes/${loteId}`);
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Não foi possível carregar os detalhes do lote.');
        }
        if (isMounted) {
          setLote(data.lote);
          setResumo(data.resumo_financeiro);
          setParticipantes(data.participantes || []);
        }
      } catch (err: any) {
        if (isMounted) {
          setErro(err.message || 'Erro inesperado.');
        }
      } finally {
        if (isMounted) {
          setCarregando(false);
        }
      }
    }

    carregarDetalhes();

    return () => {
      isMounted = false;
    };
  }, [eventoId, loteId, isOpen]);

  if (!isOpen) return null;

  const isPago = lote?.status_pagamento === 'pago';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div
        className="relative w-full max-w-4xl bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-gradient-to-r from-purple-700 via-indigo-700 to-purple-800 text-white">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/10 backdrop-blur flex items-center justify-center border border-white/20">
              <CreditCard className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="text-base font-bold flex items-center gap-2">
                Consulta de Pagamento em Lote
                {lote?.codigo && (
                  <span className="text-xs bg-white/20 px-2 py-0.5 rounded-full font-mono font-medium">
                    {lote.codigo}
                  </span>
                )}
              </h3>
              <p className="text-xs text-purple-200">
                Visualização consultiva dos vínculos oficiais no banco de dados
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-white/80 hover:text-white rounded-lg hover:bg-white/10 transition"
            title="Fechar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Conteúdo */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          {carregando && (
            <div className="py-16 flex flex-col items-center justify-center gap-3 text-gray-500">
              <Loader2 className="w-8 h-8 animate-spin text-purple-600" />
              <p className="text-sm font-medium">Carregando dados oficiais do lote...</p>
            </div>
          )}

          {erro && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3 text-red-800">
              <AlertTriangle className="w-5 h-5 flex-shrink-0 text-red-600 mt-0.5" />
              <div className="text-sm">
                <p className="font-semibold">Erro ao carregar dados do lote</p>
                <p className="text-red-700 mt-0.5">{erro}</p>
              </div>
            </div>
          )}

          {!carregando && !erro && lote && resumo && (
            <>
              {/* Alerta de Divergência Financeira se existir */}
              {resumo.tem_divergencia && (
                <div className="p-4 bg-amber-50 border-l-4 border-amber-500 rounded-r-xl flex items-start gap-3 text-amber-900 shadow-sm">
                  <AlertTriangle className="w-5 h-5 flex-shrink-0 text-amber-600 mt-0.5" />
                  <div className="text-sm">
                    <p className="font-bold">Atenção: Divergência Financeira Detectada</p>
                    <p className="mt-0.5 text-amber-800">
                      A soma dos valores individuais das inscrições ({formatarMoeda(resumo.total_soma_inscricoes)})
                      difere do valor total registrado para a cobrança do lote ({formatarMoeda(resumo.valor_cobranca)}).
                      Diferença: <span className="font-bold">{formatarMoeda(resumo.diferenca_valor)}</span>.
                    </p>
                  </div>
                </div>
              )}

              {/* Grid de Informações Principais do Lote */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Card 1: Identificação e Responsável */}
                <div className="p-4 bg-gray-50 rounded-xl border border-gray-100 flex flex-col justify-between">
                  <div>
                    <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider block mb-1">
                      Responsável pelo Lote
                    </span>
                    <p className="font-bold text-gray-800 flex items-center gap-1.5 text-sm">
                      <User className="w-4 h-4 text-purple-600 flex-shrink-0" />
                      <span className="truncate">{lote.responsavel_nome}</span>
                    </p>
                    {lote.responsavel_whatsapp && (
                      <p className="text-xs text-gray-500 mt-1 pl-5">
                        WhatsApp: {lote.responsavel_whatsapp}
                      </p>
                    )}
                    {lote.responsavel_email && (
                      <p className="text-xs text-gray-500 pl-5 truncate">
                        E-mail: {lote.responsavel_email}
                      </p>
                    )}
                  </div>
                  <div className="mt-3 pt-3 border-t border-gray-200/60 text-[11px] text-gray-400 font-mono truncate">
                    ID: {lote.id}
                  </div>
                </div>

                {/* Card 2: Situação e Pagamento */}
                <div className="p-4 bg-gray-50 rounded-xl border border-gray-100 flex flex-col justify-between">
                  <div>
                    <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider block mb-1">
                      Situação do Pagamento
                    </span>
                    <div className="flex items-center gap-2 mt-1">
                      {isPago ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                          PAGO
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-200">
                          <Clock className="w-3.5 h-3.5 text-amber-600" />
                          PENDENTE
                        </span>
                      )}
                      <span className="text-xs text-gray-700 font-bold bg-gray-200/60 px-2 py-0.5 rounded">
                        {lote.forma_pagamento}
                      </span>
                    </div>

                    <div className="mt-2.5 space-y-1 text-xs text-gray-600">
                      <div className="flex items-center gap-1">
                        <Calendar className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                        <span>Criação do lote: {formatarDataHora(lote.data_criacao)}</span>
                      </div>
                      {lote.data_confirmacao && (
                        <div className="flex items-center gap-1 text-emerald-700 font-medium">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
                          <span>Confirmação: {formatarDataHora(lote.data_confirmacao)}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Referência ASAAS */}
                  <div className="mt-3 pt-3 border-t border-gray-200/60 flex items-center justify-between text-xs">
                    <span className="text-gray-500">Ref. ASAAS:</span>
                    <span className="font-mono font-bold text-gray-700 truncate max-w-[150px]">
                      {lote.asaas_payment_id || '—'}
                    </span>
                  </div>
                </div>

                {/* Card 3: Total Financeiro */}
                <div className="p-4 bg-purple-50/60 rounded-xl border border-purple-100 flex flex-col justify-between">
                  <div>
                    <span className="text-[11px] font-bold text-purple-700 uppercase tracking-wider block mb-1">
                      Resumo Financeiro
                    </span>
                    <div className="mt-1">
                      <span className="text-xs text-purple-600 font-medium">Valor Efetivamente Pago</span>
                      <p className="text-2xl font-black text-purple-950">
                        {formatarMoeda(lote.valor_efetivamente_pago)}
                      </p>
                    </div>
                    <div className="mt-1 text-xs text-purple-700 flex items-center justify-between">
                      <span>Valor da cobrança:</span>
                      <span className="font-semibold">{formatarMoeda(lote.valor_cobranca)}</span>
                    </div>
                  </div>

                  <div className="mt-3 pt-3 border-t border-purple-200/60 flex items-center justify-between text-xs">
                    <span className="text-purple-800 font-medium flex items-center gap-1">
                      <Users className="w-3.5 h-3.5 text-purple-600" />
                      {participantes.length} participante(s)
                    </span>
                    {lote.comprovante_url && (
                      <a
                        href={lote.comprovante_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-purple-700 hover:text-purple-900 font-semibold underline flex items-center gap-1"
                      >
                        Comprovante <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                </div>
              </div>

              {/* Tabela de Participantes Vinculados */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-bold text-gray-800 flex items-center gap-2">
                    <Users className="w-4 h-4 text-purple-600" />
                    Participantes Vinculados ao Lote ({participantes.length})
                  </h4>
                  <span className="text-xs text-gray-400">
                    Registros oficiais vinculados pelo lote_id no banco
                  </span>
                </div>

                <div className="border border-gray-200 rounded-xl overflow-hidden shadow-sm bg-white">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-600 uppercase">
                      <tr>
                        <th className="px-4 py-3">Participante</th>
                        <th className="px-4 py-3">CPF</th>
                        <th className="px-4 py-3">Categoria</th>
                        <th className="px-4 py-3 text-right">Valor Individual</th>
                        <th className="px-4 py-3 text-center">Situação</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {participantes.map((p, idx) => (
                        <tr key={p.id} className="hover:bg-purple-50/20 transition">
                          <td className="px-4 py-3 font-medium text-gray-800">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-mono text-gray-400 w-5">
                                #{idx + 1}
                              </span>
                              <span>{p.nome_inscrito}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-gray-600 font-mono text-xs">
                            {formatarCPF(p.cpf)}
                          </td>
                          <td className="px-4 py-3 text-gray-600 text-xs">
                            {p.tipo_inscricao || '—'}
                          </td>
                          <td className="px-4 py-3 text-right font-bold text-gray-800">
                            {formatarMoeda(p.valor_individual)}
                          </td>
                          <td className="px-4 py-3 text-center">
                            {p.status_pagamento === 'pago' ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-800">
                                Pago
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-800">
                                {p.status_pagamento}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-gray-50/80 border-t border-gray-200 font-semibold text-gray-800 text-xs">
                      <tr>
                        <td colSpan={3} className="px-4 py-2.5 text-right uppercase tracking-wider text-gray-500">
                          Total das Inscrições:
                        </td>
                        <td className="px-4 py-2.5 text-right font-black text-sm text-purple-950">
                          {formatarMoeda(resumo.total_soma_inscricoes)}
                        </td>
                        <td className="px-4 py-2.5 text-center text-gray-500">
                          {resumo.quantidade_participantes} itens
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 bg-gray-50 border-t border-gray-200 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span>Consulta segura e isolada por evento</span>
          </div>
          <button
            onClick={onClose}
            className="px-5 py-2 text-sm font-semibold text-gray-700 bg-white border border-gray-300 rounded-xl hover:bg-gray-100 transition shadow-sm"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
