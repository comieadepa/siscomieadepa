'use client';

import { useState } from 'react';
import {
  X,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  HelpCircle,
  AlertOctagon,
  ArrowRight,
  ShieldCheck,
  Loader2,
} from 'lucide-react';
import type {
  ResultadoConciliacaoPreview,
  ResultadoRegularizacaoLote,
} from '@/lib/eventos/conciliacao-asaas';

interface ModalConciliacaoAsaasProps {
  eventoId: string;
  isOpen: boolean;
  onClose: () => void;
  onConcluido: () => void;
}

export default function ModalConciliacaoAsaas({
  eventoId,
  isOpen,
  onClose,
  onConcluido,
}: ModalConciliacaoAsaasProps) {
  const [etapa, setEtapa] = useState<'preview' | 'confirmar' | 'resultado'>('preview');
  const [carregando, setCarregando] = useState(false);
  const [processando, setProcessando] = useState(false);
  const [preview, setPreview] = useState<ResultadoConciliacaoPreview | null>(null);
  const [resultado, setResultado] = useState<ResultadoRegularizacaoLote | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [filtroAba, setFiltroAba] = useState<'elegiveis' | 'bloqueados' | 'erros'>('elegiveis');

  if (!isOpen) return null;

  async function consultarPrevia() {
    setCarregando(true);
    setErro(null);
    try {
      const res = await fetch(`/api/eventos/${eventoId}/financeiro/conciliacao-asaas`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Erro ao consultar prévia da conciliação.');
      }
      setPreview(data);
      setEtapa('preview');
    } catch (err: any) {
      setErro(err.message || 'Erro inesperado.');
    } finally {
      setCarregando(false);
    }
  }

  async function executarRegularizacao() {
    setProcessando(true);
    setErro(null);
    try {
      const res = await fetch(`/api/eventos/${eventoId}/financeiro/conciliacao-asaas`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Erro ao regularizar pagamentos.');
      }
      setResultado(data);
      setEtapa('resultado');
      onConcluido();
    } catch (err: any) {
      setErro(err.message || 'Erro inesperado ao aplicar baixa.');
    } finally {
      setProcessando(false);
    }
  }

  const itensElegiveis = preview?.itens.filter(i => i.elegivel) || [];
  const itensBloqueados = preview?.itens.filter(i => !i.elegivel) || [];
  const errosConsulta = preview?.erros || [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl border border-gray-200 w-full max-w-4xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header do Modal */}
        <div className="bg-gradient-to-r from-[#0D2B4E] to-[#123b63] p-5 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center text-xl">
              ⚖️
            </div>
            <div>
              <h2 className="text-base font-black tracking-wide">Conciliação de Pagamentos Asaas</h2>
              <p className="text-xs text-blue-200">
                Audita cobranças confirmadas no gateway e regulariza pendências no sistema
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={carregando || processando}
            className="p-1.5 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Corpo do Modal */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1">
          {erro && (
            <div className="p-3.5 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-start gap-2">
              <AlertOctagon className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-bold">Atenção</p>
                <p>{erro}</p>
              </div>
            </div>
          )}

          {/* Estado Inicial sem prévia consultada */}
          {!preview && !carregando && (
            <div className="text-center py-12 space-y-4">
              <div className="w-16 h-16 bg-blue-50 text-[#0D2B4E] rounded-2xl flex items-center justify-center mx-auto text-2xl shadow-inner">
                🔍
              </div>
              <div className="max-w-md mx-auto space-y-2">
                <h3 className="text-base font-bold text-gray-800">
                  Verificar Divergências com o Asaas
                </h3>
                <p className="text-xs text-gray-500 leading-relaxed">
                  Esta consulta irá verificar o status real de todas as cobranças vinculadas ao evento que ainda constam como pendentes no SISCOMIEADEPA.
                </p>
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-[11px] text-amber-800 text-left space-y-1">
                  <p className="font-bold flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5 text-amber-600" />
                    Segurança e Idempotência:
                  </p>
                  <p>• Nenhum registro é alterado durante a consulta prévia.</p>
                  <p>• Somente pagamentos com ID oficial e correspondência comprovada no Asaas são listados.</p>
                  <p>• Casos com valores divergentes ou estornos são separados para conferência manual.</p>
                </div>
              </div>

              <button
                type="button"
                onClick={consultarPrevia}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#0D2B4E] text-white text-xs font-bold hover:bg-[#0a1e38] transition shadow-md shadow-blue-900/10"
              >
                <RefreshCw className="w-4 h-4" />
                Iniciar Consulta de Conciliação
              </button>
            </div>
          )}

          {carregando && (
            <div className="text-center py-16 space-y-3">
              <Loader2 className="w-8 h-8 animate-spin text-[#0D2B4E] mx-auto" />
              <p className="text-sm font-bold text-gray-700">Consultando API oficial do Asaas...</p>
              <p className="text-xs text-gray-400">Verificando cobranças vinculadas e auditando divergências de pagamento.</p>
            </div>
          )}

          {/* Prévia dos Resultados */}
          {preview && etapa === 'preview' && (
            <div className="space-y-5">
              {/* Cards de Métricas */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-center">
                  <p className="text-[10px] font-bold text-slate-500 uppercase">Verificadas</p>
                  <p className="text-xl font-black text-slate-800 mt-0.5">{preview.total_consultadas_sistema}</p>
                </div>
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-center">
                  <p className="text-[10px] font-bold text-emerald-600 uppercase">Elegíveis para Baixa</p>
                  <p className="text-xl font-black text-emerald-700 mt-0.5">{preview.total_elegiveis}</p>
                </div>
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-center">
                  <p className="text-[10px] font-bold text-amber-700 uppercase">Análise Manual</p>
                  <p className="text-xl font-black text-amber-800 mt-0.5">{preview.total_ambiguos_ou_bloqueados}</p>
                </div>
                <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-center">
                  <p className="text-[10px] font-bold text-red-600 uppercase">Falhas de Consulta</p>
                  <p className="text-xl font-black text-red-700 mt-0.5">{preview.total_erros}</p>
                </div>
              </div>

              {/* Abas da listagem */}
              <div className="flex border-b border-gray-200 gap-2">
                <button
                  type="button"
                  onClick={() => setFiltroAba('elegiveis')}
                  className={`pb-2 px-3 text-xs font-bold border-b-2 transition flex items-center gap-1.5 ${
                    filtroAba === 'elegiveis'
                      ? 'border-emerald-600 text-emerald-700'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  Elegíveis ({itensElegiveis.length})
                </button>
                <button
                  type="button"
                  onClick={() => setFiltroAba('bloqueados')}
                  className={`pb-2 px-3 text-xs font-bold border-b-2 transition flex items-center gap-1.5 ${
                    filtroAba === 'bloqueados'
                      ? 'border-amber-600 text-amber-700'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  <HelpCircle className="w-3.5 h-3.5 text-amber-600" />
                  Não Elegíveis / Análise ({itensBloqueados.length})
                </button>
                {errosConsulta.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setFiltroAba('erros')}
                    className={`pb-2 px-3 text-xs font-bold border-b-2 transition flex items-center gap-1.5 ${
                      filtroAba === 'erros'
                        ? 'border-red-600 text-red-700'
                        : 'border-transparent text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    <AlertTriangle className="w-3.5 h-3.5 text-red-600" />
                    Erros ({errosConsulta.length})
                  </button>
                )}
              </div>

              {/* Tabela de Itens */}
              <div className="border border-gray-200 rounded-xl overflow-hidden shadow-sm">
                <div className="overflow-x-auto max-h-72">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 uppercase font-semibold text-[10px] sticky top-0">
                      <tr>
                        <th className="py-2.5 px-3">Participante / Objeto</th>
                        <th className="py-2.5 px-3">Cobrança Asaas</th>
                        <th className="py-2.5 px-3 text-right">Valor Sistema</th>
                        <th className="py-2.5 px-3 text-right">Valor Asaas</th>
                        <th className="py-2.5 px-3 text-center">Status Sistema</th>
                        <th className="py-2.5 px-3 text-center">Status Asaas</th>
                        {filtroAba === 'bloqueados' && <th className="py-2.5 px-3">Motivo / Condição</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {filtroAba === 'elegiveis' && itensElegiveis.length === 0 && (
                        <tr>
                          <td colSpan={6} className="py-8 text-center text-gray-400">
                            Nenhuma divergência pendente encontrada para regularização imediata.
                          </td>
                        </tr>
                      )}

                      {filtroAba === 'elegiveis' &&
                        itensElegiveis.map(item => (
                          <tr key={item.id} className="hover:bg-emerald-50/40 transition">
                            <td className="py-2.5 px-3 font-bold text-gray-800">
                              <div>{item.participante_nome}</div>
                              <div className="text-[10px] text-gray-400 font-normal">
                                {item.tipo_entidade.toUpperCase()} {item.participante_cpf ? `• CPF: ${item.participante_cpf}` : ''}
                              </div>
                            </td>
                            <td className="py-2.5 px-3 font-mono text-[11px] text-gray-600">
                              {item.asaas_payment_id}
                            </td>
                            <td className="py-2.5 px-3 text-right tabular-nums text-gray-700">
                              R$ {item.valor_sistema.toFixed(2)}
                            </td>
                            <td className="py-2.5 px-3 text-right tabular-nums font-bold text-emerald-700">
                              R$ {item.valor_asaas.toFixed(2)}
                            </td>
                            <td className="py-2.5 px-3 text-center">
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-yellow-100 text-yellow-800">
                                {item.status_sistema}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-center">
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-emerald-100 text-emerald-800">
                                {item.status_asaas}
                              </span>
                            </td>
                          </tr>
                        ))}

                      {filtroAba === 'bloqueados' && itensBloqueados.length === 0 && (
                        <tr>
                          <td colSpan={7} className="py-8 text-center text-gray-400">
                            Nenhum caso bloqueado ou em situação conflitante.
                          </td>
                        </tr>
                      )}

                      {filtroAba === 'bloqueados' &&
                        itensBloqueados.map(item => (
                          <tr key={item.id} className="hover:bg-amber-50/30 transition">
                            <td className="py-2.5 px-3 font-bold text-gray-800">
                              <div>{item.participante_nome}</div>
                              <div className="text-[10px] text-gray-400 font-normal">
                                {item.tipo_entidade.toUpperCase()}
                              </div>
                            </td>
                            <td className="py-2.5 px-3 font-mono text-[11px] text-gray-600">
                              {item.asaas_payment_id}
                            </td>
                            <td className="py-2.5 px-3 text-right tabular-nums text-gray-700">
                              R$ {item.valor_sistema.toFixed(2)}
                            </td>
                            <td className="py-2.5 px-3 text-right tabular-nums text-gray-700">
                              R$ {item.valor_asaas.toFixed(2)}
                            </td>
                            <td className="py-2.5 px-3 text-center">
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-gray-100 text-gray-700">
                                {item.status_sistema}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-center">
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-gray-100 text-gray-700">
                                {item.status_asaas}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-amber-700 font-medium text-[11px]">
                              {item.motivo_bloqueio || 'Análise necessária'}
                            </td>
                          </tr>
                        ))}

                      {filtroAba === 'erros' &&
                        errosConsulta.map((err, idx) => (
                          <tr key={idx} className="hover:bg-red-50/30 transition">
                            <td colSpan={2} className="py-2.5 px-3 font-mono text-gray-800">
                              {err.asaas_payment_id}
                            </td>
                            <td colSpan={5} className="py-2.5 px-3 text-red-600 font-medium">
                              {err.mensagem}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Confirmação Pré-Regularização */}
          {etapa === 'confirmar' && (
            <div className="py-6 px-4 space-y-4 max-w-lg mx-auto text-center">
              <div className="w-14 h-14 bg-emerald-100 text-emerald-800 rounded-2xl flex items-center justify-center mx-auto text-2xl">
                🛡️
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-bold text-gray-900">
                  Confirmar Regularização de {itensElegiveis.length} Pagamento(s)
                </h3>
                <p className="text-xs text-gray-500">
                  Ao confirmar, o sistema registrará a baixa como PAGO, ativará a autoalocação de leitos (se aplicável), disparará os jobs de notificação e registrará o log de auditoria oficial.
                </p>
              </div>

              <div className="p-4 bg-gray-50 rounded-xl border border-gray-200 text-left text-xs space-y-2">
                <p className="font-bold text-gray-700">Resumo da Ação:</p>
                <div className="flex justify-between">
                  <span className="text-gray-500">Inscrições/Lotes a regularizar:</span>
                  <span className="font-bold text-gray-800">{itensElegiveis.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Total a homologar:</span>
                  <span className="font-bold text-emerald-700">
                    R$ {itensElegiveis.reduce((s, i) => s + i.valor_asaas, 0).toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Pipeline utilizado:</span>
                  <span className="font-semibold text-gray-700">Webhook Central & Autoalocação</span>
                </div>
              </div>

              <div className="flex justify-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setEtapa('preview')}
                  disabled={processando}
                  className="px-4 py-2 text-xs font-bold text-gray-600 hover:text-gray-800 transition"
                >
                  Voltar à Prévia
                </button>
                <button
                  type="button"
                  onClick={executarRegularizacao}
                  disabled={processando}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-700 text-white text-xs font-bold hover:bg-emerald-800 transition shadow-md shadow-emerald-900/10 disabled:opacity-50"
                >
                  {processando ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4" />
                  )}
                  Confirmar e Regularizar Pagamentos
                </button>
              </div>
            </div>
          )}

          {/* Resultado Pós-Regularização */}
          {etapa === 'resultado' && resultado && (
            <div className="py-8 px-4 space-y-5 max-w-lg mx-auto text-center">
              <div className="w-16 h-16 bg-emerald-100 text-emerald-800 rounded-2xl flex items-center justify-center mx-auto text-3xl">
                ✅
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-black text-gray-900">
                  Conciliação Concluída com Sucesso!
                </h3>
                <p className="text-xs text-gray-500">
                  Os pagamentos foram confirmados e sincronizados com o banco de dados oficial.
                </p>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="p-3 bg-gray-50 border border-gray-200 rounded-xl">
                  <p className="text-[10px] font-bold text-gray-400 uppercase">Processados</p>
                  <p className="text-lg font-black text-gray-800">{resultado.total_processados}</p>
                </div>
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl">
                  <p className="text-[10px] font-bold text-emerald-600 uppercase">Sucessos</p>
                  <p className="text-lg font-black text-emerald-700">{resultado.total_sucessos}</p>
                </div>
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl">
                  <p className="text-[10px] font-bold text-red-600 uppercase">Falhas</p>
                  <p className="text-lg font-black text-red-700">{resultado.total_falhas}</p>
                </div>
              </div>

              <button
                type="button"
                onClick={onClose}
                className="px-6 py-2.5 rounded-xl bg-[#0D2B4E] text-white text-xs font-bold hover:bg-[#0a1e38] transition shadow-md"
              >
                Concluir e Fechar
              </button>
            </div>
          )}
        </div>

        {/* Footer com Ações */}
        {etapa === 'preview' && preview && (
          <div className="p-4 bg-gray-50 border-t border-gray-200 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={consultarPrevia}
              disabled={carregando || processando}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-gray-600 hover:text-gray-800 border border-gray-300 rounded-lg hover:bg-gray-100 transition"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Reconsultar Asaas
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-bold text-gray-600 hover:text-gray-800 transition"
              >
                Fechar
              </button>

              <button
                type="button"
                disabled={itensElegiveis.length === 0}
                onClick={() => setEtapa('confirmar')}
                className="inline-flex items-center gap-2 px-5 py-2 text-xs font-bold rounded-xl bg-emerald-700 text-white hover:bg-emerald-800 transition shadow-sm disabled:opacity-50"
              >
                Regularizar {itensElegiveis.length} Pagamento(s)
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
