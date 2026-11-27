'use client';

import { useState, useEffect, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase-client';
import { useRequireSupabaseAuth } from '@/hooks/useRequireSupabaseAuth';
import { useEventosPerfil } from '@/hooks/useEventosPerfil';

interface AutorizacaoRow {
  id: string;
  evento_id: string;
  operacao_id: string;
  nome_inscrito: string;
  cpf: string | null;
  modalidade_nome: string;
  valor_original: number;
  valor_desconto: number;
  valor_final: number;
  status: 'pendente' | 'autorizado' | 'negado' | 'cancelado';
  operador_nome: string;
  supervisor_nome: string | null;
  justificativa_supervisor: string | null;
  solicitado_em: string;
  deliberado_em: string | null;
  utilizado: boolean;
  inscricao_id: string | null;
}

export default function SupervisorDescontosPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;

  const { user, loading: authLoading } = useRequireSupabaseAuth();
  const perfil = useEventosPerfil();
  const supabase = useMemo(() => createClient(), []);

  const [aba, setAba] = useState<'pendentes' | 'deliberadas'>('pendentes');
  const [lista, setLista] = useState<AutorizacaoRow[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  // Alerta sonoro
  const [somHabilitado, setSomHabilitado] = useState(false);

  // Modal de Deliberação (Autorizar / Negar)
  const [itemSelecionado, setItemSelecionado] = useState<AutorizacaoRow | null>(null);
  const [modoModal, setModoModal] = useState<'autorizar' | 'negar'>('autorizar');
  const [valorDescontoInput, setValorDescontoInput] = useState<string>('');
  const [justificativaInput, setJustificativaInput] = useState<string>('');
  const [processando, setProcessando] = useState(false);
  const [erroModal, setErroModal] = useState<string | null>(null);

  function tocarAlertaSonoro() {
    if (!somHabilitado) return;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.5);
    } catch (e) {
      console.warn('Erro ao reproduzir alerta sonoro:', e);
    }
  }

  async function carregarAutorizacoes(silencioso = false) {
    if (!id) return;
    if (!silencioso) setCarregando(true);
    try {
      const res = await fetch(`/api/eventos/${id}/descontos?limit=150`);
      if (res.ok) {
        const json = await res.json();
        const novas = json.autorizacoes || [];
        setLista(prev => {
          const qtdPendentesAntiga = prev.filter(r => r.status === 'pendente').length;
          const qtdPendentesNova = novas.filter((r: AutorizacaoRow) => r.status === 'pendente').length;
          if (qtdPendentesNova > qtdPendentesAntiga) {
            tocarAlertaSonoro();
          }
          return novas;
        });
        setErro(null);
      } else {
        const json = await res.json();
        setErro(json.error || 'Erro ao carregar solicitações.');
      }
    } catch (err: any) {
      setErro(err.message || 'Falha de comunicação com o servidor.');
    } finally {
      if (!silencioso) setCarregando(false);
    }
  }

  useEffect(() => {
    if (!id) return;
    carregarAutorizacoes();

    const channel = supabase
      .channel(`supervisor_descontos_${id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'evento_desconto_autorizacoes',
          filter: `evento_id=eq.${id}`,
        },
        (payload: any) => {
          if (payload.eventType === 'INSERT') {
            tocarAlertaSonoro();
          }
          carregarAutorizacoes(true);
        }
      )
      .subscribe();

    const interval = setInterval(() => {
      carregarAutorizacoes(true);
    }, 4000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [id, supabase, somHabilitado]);

  const pendentes = useMemo(() => lista.filter(r => r.status === 'pendente'), [lista]);
  const deliberadas = useMemo(() => lista.filter(r => r.status !== 'pendente'), [lista]);

  const valorOriginalModal = Number(itemSelecionado?.valor_original || 0);
  const valorDescontoNum = Math.max(0, parseFloat(valorDescontoInput.replace(',', '.')) || 0);
  const valorFinalCalculado = Math.max(0, valorOriginalModal - valorDescontoNum);

  function abrirModal(item: AutorizacaoRow, modo: 'autorizar' | 'negar') {
    setItemSelecionado(item);
    setModoModal(modo);
    setValorDescontoInput('');
    setJustificativaInput('');
    setErroModal(null);
  }

  function fecharModal() {
    setItemSelecionado(null);
    setErroModal(null);
  }

  async function submeterDeliberacao() {
    if (!itemSelecionado) return;
    setErroModal(null);

    if (modoModal === 'autorizar') {
      if (valorDescontoNum <= 0) {
        setErroModal('Informe um valor de desconto válido maior que zero.');
        return;
      }
      if (valorDescontoNum > valorOriginalModal) {
        setErroModal(`O desconto não pode ser superior ao valor original de R$ ${valorOriginalModal.toFixed(2)}.`);
        return;
      }
    }

    setProcessando(true);
    try {
      const res = await fetch(`/api/eventos/${id}/descontos/deliberar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          solicitacao_id: itemSelecionado.id,
          acao: modoModal,
          valor_desconto: modoModal === 'autorizar' ? valorDescontoNum : 0,
          justificativa: justificativaInput.trim() || undefined,
          supervisor_nome: user?.user_metadata?.nome || user?.email || 'Supervisor',
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        setErroModal(json.error || 'Erro ao processar deliberação.');
        return;
      }

      fecharModal();
      carregarAutorizacoes(true);
    } catch (e: any) {
      setErroModal(e.message || 'Falha na conexão ao deliberar.');
    } finally {
      setProcessando(false);
    }
  }

  function fmtMoeda(val: number) {
    return Number(val || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function fmtData(dataStr: string) {
    if (!dataStr) return '-';
    try {
      const d = new Date(dataStr);
      return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) + ' (' + d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ')';
    } catch {
      return dataStr;
    }
  }

  if (authLoading || perfil.loading) {
    return (
      <div className="min-h-screen bg-[#0A1A2F] text-white flex items-center justify-center p-4">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-4 border-purple-500/30 border-t-purple-500 rounded-full animate-spin"></div>
          <p className="text-sm text-white/60">Verificando permissões de supervisor...</p>
        </div>
      </div>
    );
  }

  const temPermissao = perfil.isGlobal || perfil.podeSupervisorDescontos || perfil.podeVerFinanceiro;
  if (!temPermissao) {
    return (
      <div className="min-h-screen bg-[#0A1A2F] text-white flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-[#122A4A] p-6 rounded-2xl border border-red-500/30 text-center space-y-4">
          <span className="text-4xl">🚫</span>
          <h1 className="text-lg font-bold text-red-400">Acesso Restrito</h1>
          <p className="text-sm text-white/70">
            Você não possui a permissão de <strong>Supervisor de Descontos</strong> para este evento. Solicite acesso à administração da AGO.
          </p>
          <button
            onClick={() => router.push(`/eventos/${id}`)}
            className="w-full bg-white/10 hover:bg-white/20 text-white font-semibold py-2.5 rounded-xl text-sm transition"
          >
            Voltar ao Evento
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0A1A2F] text-white pb-12">
      <header className="sticky top-0 z-30 bg-[#0F2642]/95 backdrop-blur-md border-b border-white/10 px-4 py-3.5 shadow-md">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <button
              onClick={() => router.push(`/eventos/${id}`)}
              className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-white/60 text-sm"
              title="Voltar"
            >
              ←
            </button>
            <div>
              <h1 className="text-sm font-black text-white flex items-center gap-1.5">
                <span className="text-purple-400">🛡️</span> Supervisor de Descontos
              </h1>
              <p className="text-[10px] text-white/50 uppercase tracking-widest font-semibold">Balcão AGO 126ª</p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              const novo = !somHabilitado;
              setSomHabilitado(novo);
              if (novo) tocarAlertaSonoro();
            }}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition ${
              somHabilitado
                ? 'bg-purple-600 text-white shadow-lg shadow-purple-600/30'
                : 'bg-white/10 text-white/50 hover:bg-white/15'
            }`}
            title={somHabilitado ? 'Alerta sonoro ativado' : 'Ativar alerta sonoro'}
          >
            <span>{somHabilitado ? '🔔' : '🔕'}</span>
            <span className="text-[11px] hidden sm:inline">{somHabilitado ? 'Som Ativo' : 'Ativar Som'}</span>
          </button>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 mt-4">
        <div className="grid grid-cols-2 p-1 bg-[#122A4A] rounded-xl border border-white/10">
          <button
            onClick={() => setAba('pendentes')}
            className={`py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-2 transition ${
              aba === 'pendentes'
                ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow'
                : 'text-white/60 hover:text-white'
            }`}
          >
            <span>Pendentes</span>
            {pendentes.length > 0 && (
              <span className="px-1.5 py-0.2 bg-amber-400 text-black text-[10px] font-black rounded-full animate-bounce">
                {pendentes.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setAba('deliberadas')}
            className={`py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-2 transition ${
              aba === 'deliberadas'
                ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow'
                : 'text-white/60 hover:text-white'
            }`}
          >
            <span>Deliberadas</span>
            <span className="text-[10px] text-white/40">({deliberadas.length})</span>
          </button>
        </div>
      </div>

      <main className="max-w-lg mx-auto px-4 mt-4 space-y-3">
        {erro && (
          <div className="p-3 bg-red-500/20 border border-red-500/40 rounded-xl text-xs text-red-200">
            {erro}
          </div>
        )}

        {carregando && lista.length === 0 ? (
          <div className="text-center py-12 space-y-2">
            <div className="w-6 h-6 border-2 border-purple-500/30 border-t-purple-500 rounded-full animate-spin mx-auto"></div>
            <p className="text-xs text-white/40">Carregando solicitações...</p>
          </div>
        ) : aba === 'pendentes' ? (
          pendentes.length === 0 ? (
            <div className="text-center py-16 px-4 bg-[#122A4A]/50 rounded-2xl border border-white/5 space-y-3">
              <span className="text-4xl block">✨</span>
              <p className="text-sm font-semibold text-white/80">Nenhuma solicitação pendente</p>
              <p className="text-xs text-white/40 max-w-xs mx-auto">
                Quando os operadores do balcão solicitarem descontos, eles aparecerão aqui instantaneamente com aviso sonoro.
              </p>
            </div>
          ) : (
            pendentes.map(item => (
              <div
                key={item.id}
                className="bg-[#122A4A] p-4 rounded-2xl border border-amber-500/30 shadow-lg space-y-3 relative overflow-hidden"
              >
                <div className="absolute top-0 right-0 w-2 h-full bg-amber-400"></div>
                <div className="flex items-start justify-between pr-3">
                  <div>
                    <h3 className="text-sm font-bold text-white uppercase tracking-wide">
                      {item.nome_inscrito}
                    </h3>
                    <p className="text-xs text-purple-300 font-medium">{item.modalidade_nome}</p>
                  </div>
                  <span className="text-[10px] bg-amber-500/20 text-amber-300 font-bold px-2 py-0.5 rounded-full border border-amber-500/30">
                    Aguardando
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs bg-black/20 p-2.5 rounded-xl border border-white/5">
                  <div>
                    <span className="text-white/40 block text-[10px] uppercase">Valor Original</span>
                    <span className="font-bold text-sm text-white">{fmtMoeda(item.valor_original)}</span>
                  </div>
                  <div>
                    <span className="text-white/40 block text-[10px] uppercase">Operador / Hora</span>
                    <span className="text-white/80 font-medium truncate block">{item.operador_nome}</span>
                    <span className="text-[10px] text-white/40">{fmtData(item.solicitado_em)}</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => abrirModal(item, 'negar')}
                    className="w-full bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/40 font-bold py-2.5 rounded-xl text-xs transition"
                  >
                    ✕ Negar
                  </button>
                  <button
                    type="button"
                    onClick={() => abrirModal(item, 'autorizar')}
                    className="w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold py-2.5 rounded-xl text-xs transition shadow-md"
                  >
                    ✓ Autorizar
                  </button>
                </div>
              </div>
            ))
          )
        ) : (
          deliberadas.length === 0 ? (
            <div className="text-center py-16 text-white/40 text-xs">
              Nenhuma deliberação registrada até o momento.
            </div>
          ) : (
            deliberadas.map(item => (
              <div
                key={item.id}
                className="bg-[#122A4A] p-4 rounded-2xl border border-white/5 text-xs space-y-2"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-bold text-white uppercase">{item.nome_inscrito}</h3>
                    <p className="text-[11px] text-white/50">{item.modalidade_nome}</p>
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${
                    item.status === 'autorizado' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' :
                    item.status === 'negado' ? 'bg-red-500/20 text-red-300 border border-red-500/30' :
                    'bg-gray-500/20 text-gray-400'
                  }`}>
                    {item.status}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-1 bg-black/20 p-2 rounded-xl text-center">
                  <div>
                    <span className="text-[9px] text-white/40 block uppercase">Original</span>
                    <span className="font-semibold text-white/70">{fmtMoeda(item.valor_original)}</span>
                  </div>
                  <div>
                    <span className="text-[9px] text-white/40 block uppercase">Desconto</span>
                    <span className="font-bold text-emerald-400">−{fmtMoeda(item.valor_desconto)}</span>
                  </div>
                  <div>
                    <span className="text-[9px] text-white/40 block uppercase">Final</span>
                    <span className="font-bold text-[#F39C12]">{fmtMoeda(item.valor_final)}</span>
                  </div>
                </div>

                <div className="flex items-center justify-between text-[10px] text-white/40 pt-1 border-t border-white/5">
                  <span>Por {item.supervisor_nome || 'Supervisor'} em {fmtData(item.deliberado_em || '')}</span>
                  {item.utilizado && (
                    <span className="text-emerald-400 font-bold">✓ Utilizado na Inscrição</span>
                  )}
                </div>
              </div>
            ))
          )
        )}
      </main>

      {itemSelecionado && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200">
          <div className="bg-[#122A4A] w-full max-w-md rounded-t-3xl sm:rounded-2xl border border-white/10 p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                {modoModal === 'autorizar' ? (
                  <>
                    <span className="text-emerald-400">✓</span> Autorizar Desconto
                  </>
                ) : (
                  <>
                    <span className="text-red-400">✕</span> Negar Desconto
                  </>
                )}
              </h2>
              <button
                type="button"
                onClick={fecharModal}
                className="text-white/40 hover:text-white text-lg font-bold"
              >
                ✕
              </button>
            </div>

            <div className="bg-black/20 p-3 rounded-xl text-xs space-y-1">
              <p className="text-white font-bold uppercase">{itemSelecionado.nome_inscrito}</p>
              <p className="text-white/60">{itemSelecionado.modalidade_nome}</p>
              <div className="flex justify-between pt-1 border-t border-white/5 text-white/80">
                <span>Valor original da inscrição:</span>
                <span className="font-bold text-white">{fmtMoeda(valorOriginalModal)}</span>
              </div>
            </div>

            {modoModal === 'autorizar' ? (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-white/80 mb-1">
                    Informe exclusivamente o VALOR DO DESCONTO (R$):
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-2.5 text-white/40 text-sm font-bold">R$</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      max={valorOriginalModal}
                      autoFocus
                      value={valorDescontoInput}
                      onChange={e => setValorDescontoInput(e.target.value)}
                      placeholder="0,00"
                      className="w-full bg-[#0A1A2F] border border-white/20 rounded-xl pl-10 pr-3 py-2 text-white font-bold text-lg focus:outline-none focus:border-purple-500"
                    />
                  </div>
                </div>

                <div className="p-3 bg-purple-900/30 border border-purple-500/30 rounded-xl text-xs space-y-1.5 text-purple-200">
                  <div className="flex justify-between">
                    <span>Subtotal:</span>
                    <span>{fmtMoeda(valorOriginalModal)}</span>
                  </div>
                  <div className="flex justify-between text-emerald-400 font-bold">
                    <span>Desconto concedido:</span>
                    <span>−{fmtMoeda(valorDescontoNum)}</span>
                  </div>
                  <div className="flex justify-between border-t border-purple-500/20 pt-1.5 text-sm font-black text-white">
                    <span>Valor Final a Pagar:</span>
                    <span className="text-[#F39C12]">{fmtMoeda(valorFinalCalculado)}</span>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-white/60 mb-1">
                    Observação / Justificativa (opcional):
                  </label>
                  <input
                    type="text"
                    value={justificativaInput}
                    onChange={e => setJustificativaInput(e.target.value)}
                    placeholder="Ex: Autorizado pelo pastor setorial"
                    className="w-full bg-[#0A1A2F] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-white/30"
                  />
                </div>
              </div>
            ) : (
              <div>
                <label className="block text-xs font-semibold text-white/80 mb-1">
                  Motivo da recusa (opcional):
                </label>
                <textarea
                  rows={3}
                  value={justificativaInput}
                  onChange={e => setJustificativaInput(e.target.value)}
                  placeholder="Informe o motivo para ciência do operador..."
                  className="w-full bg-[#0A1A2F] border border-white/10 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-white/30 resize-none"
                />
              </div>
            )}

            {erroModal && (
              <p className="text-xs font-semibold text-red-400">{erroModal}</p>
            )}

            <div className="grid grid-cols-2 gap-2 pt-2">
              <button
                type="button"
                onClick={fecharModal}
                disabled={processando}
                className="w-full bg-white/10 hover:bg-white/15 text-white/80 font-semibold py-2.5 rounded-xl text-xs transition"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={submeterDeliberacao}
                disabled={processando || (modoModal === 'autorizar' && (valorDescontoNum <= 0 || valorDescontoNum > valorOriginalModal))}
                className={`w-full font-bold py-2.5 rounded-xl text-xs transition shadow-lg flex items-center justify-center gap-1.5 ${
                  modoModal === 'autorizar'
                    ? 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white disabled:opacity-40'
                    : 'bg-red-600 hover:bg-red-700 text-white disabled:opacity-40'
                }`}
              >
                {processando ? (
                  <span className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin"></span>
                ) : modoModal === 'autorizar' ? (
                  'Confirmar Desconto'
                ) : (
                  'Confirmar Recusa'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
