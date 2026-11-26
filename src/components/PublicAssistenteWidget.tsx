'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import type { DepartamentoConfig } from '@/lib/public-portal';

export type PublicAssistenteScope = 'global' | 'departamento';

type AssistenteAction = {
  label: string;
  href?: string;
  copyText?: string;
  variant?: 'primary' | 'ghost';
};

type AssistenteCard = {
  id: string;
  inscricao_id?: string;
  title: string;
  subtitle?: string;
  meta?: string[];
  actions?: AssistenteAction[];
  status_pagamento?: string;
  status_hospedagem?: string;
  numero_leito?: string;
  inscricao?: {
    id: string;
  };
};

type Message = {
  id: string;
  role: 'maia' | 'user';
  text: string;
  cards?: AssistenteCard[];
};

type Props = {
  scope: PublicAssistenteScope;
  departamento?: DepartamentoConfig | null;
};

function buildInitialMessage(scope: PublicAssistenteScope, departamento?: DepartamentoConfig | null) {
  if (scope === 'departamento' && departamento) {
    return `Oi! Eu sou a SARA :)\nPosso ajudar com inscricoes e eventos da ${departamento.nome}.`;
  }
  return 'Oi! Eu sou a SARA :)\nPosso ajudar com inscricoes abertas, pagamentos e duvidas gerais dos eventos.';
}

function MaiaAvatar({ sizeClass, className, isFloating }: { sizeClass: string; className?: string; isFloating?: boolean }) {
  if (isFloating) {
    return (
      <img
        src="/img/sara.png?v=2"
        alt="SARA - Assistente Virtual"
        className={`${sizeClass} object-contain select-none pointer-events-none ${className ?? ''}`.trim()}
        draggable={false}
      />
    );
  }

  return (
    <img
      src="/img/sara2.png"
      alt="SARA"
      className={`${sizeClass} object-contain shrink-0 select-none ${className ?? ''}`.trim()}
      draggable={false}
    />
  );
}

const ATALHOS_FIXOS = [
  {
    icon: '📋',
    label: 'Consultar minha inscrição',
    texto: 'Quero consultar minha inscrição.',
    cardClass: 'bg-blue-50/90 border-blue-200 text-blue-950 hover:bg-blue-100/90',
    arrowClass: 'text-blue-500',
  },
  {
    icon: '🛏️',
    label: 'Consultar minha hospedagem',
    texto: 'Quero consultar minha hospedagem.',
    cardClass: 'bg-emerald-50/90 border-emerald-200 text-emerald-950 hover:bg-emerald-100/90',
    arrowClass: 'text-emerald-600',
  },
  {
    icon: '📅',
    label: 'Informações sobre o evento',
    texto: 'Quais são as informações sobre o evento?',
    cardClass: 'bg-amber-50/90 border-amber-200 text-amber-950 hover:bg-amber-100/90',
    arrowClass: 'text-amber-600',
  },
];

export default function PublicAssistenteWidget({ scope, departamento }: Props) {
  const [aberto, setAberto] = useState(false);
  const [mensagens, setMensagens] = useState<Message[]>([]);
  const [texto, setTexto] = useState('');
  const [loading, setLoading] = useState(false);
  const [inicializado, setInicializado] = useState(false);
  const [copiadoId, setCopiadoId] = useState<string | null>(null);
  const [ctxCpf, setCtxCpf] = useState<string | null>(null);
  const [ctxInscricaoId, setCtxInscricaoId] = useState<string | null>(null);
  const [ctxPendingIntent, setCtxPendingIntent] = useState<string | null>(null);
  const [ctxEventoId, setCtxEventoId] = useState<string | null>(null);
  const [ctxEventoNome, setCtxEventoNome] = useState<string | null>(null);
  const [ctxUltimaIntencao, setCtxUltimaIntencao] = useState<string | null>(null);
  const fimRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const isPointerCoarse = () =>
    typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

  const sugestoes = ATALHOS_FIXOS;

  const headerSubtitle = scope === 'departamento' && departamento
    ? departamento.nome
    : 'Eventos publicos';

  const criarMensagemInicial = useCallback((): Message => ({
    id: `maia-${Date.now()}`,
    role: 'maia',
    text: buildInitialMessage(scope, departamento),
  }), [scope, departamento]);

  useEffect(() => {
    if (aberto && !inicializado) {
      setMensagens([criarMensagemInicial()]);
      setInicializado(true);
    }
    // Focar input ao abrir o chat (apenas em desktop para não forçar teclado mobile)
    if (aberto && !isPointerCoarse()) {
      const t = setTimeout(() => inputRef.current?.focus(), 300);
      return () => clearTimeout(t);
    }
  }, [aberto, inicializado, criarMensagemInicial]);

  // Listener para abertura contextualizada externa (ex: botão Consultar Inscrição na 126ª AGO)
  useEffect(() => {
    const handleAbrirExterno = (e: Event) => {
      const customEvent = e as CustomEvent<{
        mensagemInicial?: string;
        mensagemAssistente?: string;
        pendingIntent?: string;
      }>;
      setAberto(true);
      setInicializado(true);

      const msgAssistente = customEvent.detail?.mensagemAssistente;
      const pending = customEvent.detail?.pendingIntent;
      const msg = customEvent.detail?.mensagemInicial;

      if (msgAssistente) {
        // Inicializa o chat diretamente com a saudação solicitada e aguarda entrada do usuário
        setMensagens([
          {
            id: `assistente-${Date.now()}`,
            role: 'maia',
            text: msgAssistente,
          },
        ]);
        if (pending) {
          setCtxPendingIntent(pending);
        }
      } else if (msg) {
        enviarPergunta(msg);
      }
    };

    window.addEventListener('abrir-sara-publica', handleAbrirExterno);
    return () => window.removeEventListener('abrir-sara-publica', handleAbrirExterno);
  }, []);

  useEffect(() => {
    fimRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [mensagens]);

  // Restaurar foco no input após cada resposta da SARA (loading false → input reabilitado)
  useEffect(() => {
    if (!loading && aberto) {
      inputRef.current?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  function limparConversa() {
    setMensagens([criarMensagemInicial()]);
    setTexto('');
    setLoading(false);
    setInicializado(true);
    setCtxCpf(null);
    setCtxInscricaoId(null);
    setCtxPendingIntent(null);
    setCtxEventoId(null);
    setCtxEventoNome(null);
    setCtxUltimaIntencao(null);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  async function enviarPergunta(pergunta: string) {
    const cleaned = pergunta.trim();
    if (!cleaned || loading) return;

    const userMsg: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      text: cleaned,
    };

    setMensagens(prev => [...prev, userMsg]);
    setTexto('');
    setLoading(true);

    try {
      const res = await fetch('/api/public/assistente', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pergunta: cleaned,
          contexto: {
            scope,
            departamento: departamento?.key ?? null,
            cpf: ctxCpf,
            inscricao_id: ctxInscricaoId,
            pending_intent: ctxPendingIntent,
            evento_id: ctxEventoId,
            evento_nome: ctxEventoNome,
            ultima_intencao: ctxUltimaIntencao,
          },
        }),
      });

      const data = await res.json();
      const resposta = String(data?.resposta || 'Desculpe, nao consegui responder agora.');
      if (data?._ctx) {
        if (data._ctx.cpf !== undefined) setCtxCpf(data._ctx.cpf ? String(data._ctx.cpf) : null);
        if (data._ctx.inscricao_id !== undefined) setCtxInscricaoId(data._ctx.inscricao_id ? String(data._ctx.inscricao_id) : null);
        if (data._ctx.evento_id !== undefined) setCtxEventoId(data._ctx.evento_id ? String(data._ctx.evento_id) : null);
        if (data._ctx.evento_nome !== undefined) setCtxEventoNome(data._ctx.evento_nome ? String(data._ctx.evento_nome) : null);
        if (data._ctx.ultima_intencao !== undefined) setCtxUltimaIntencao(data._ctx.ultima_intencao ? String(data._ctx.ultima_intencao) : null);
        setCtxPendingIntent(typeof data._ctx.pending_intent === 'string' ? data._ctx.pending_intent : null);
      }
      const maiaMsg: Message = {
        id: `maia-${Date.now()}`,
        role: 'maia',
        text: resposta,
        cards: Array.isArray(data?.cards) ? data.cards : undefined,
      };
      setMensagens(prev => [...prev, maiaMsg]);
    } catch {
      const maiaMsg: Message = {
        id: `maia-${Date.now()}`,
        role: 'maia',
        text: 'Tive um problema de conexao. Pode tentar novamente?',
      };
      setMensagens(prev => [...prev, maiaMsg]);
    } finally {
      setLoading(false);
    }
  }

  function renderTexto(textoMsg: string) {
    const partes = textoMsg.split(/(\*[^*]+\*)/g);
    return partes.map((parte, i) => {
      if (parte.startsWith('*') && parte.endsWith('*')) {
        return <strong key={i}>{parte.slice(1, -1)}</strong>;
      }
      return <span key={i}>{parte}</span>;
    });
  }

  function handleAction(action: AssistenteAction, actionId: string) {
    if (action.copyText) {
      navigator.clipboard?.writeText(action.copyText).catch(() => null);
      setCopiadoId(actionId);
      setTimeout(() => setCopiadoId(null), 2000);
    }
  }

  function Bolha({ msg }: { msg: Message }) {
    const isUser = msg.role === 'user';
    return (
      <div className={`mb-2 ${isUser ? 'flex justify-end' : ''}`}>
        <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
          {!isUser && (
            <div className="mr-2 mt-1 flex-shrink-0">
              <MaiaAvatar sizeClass="w-8 h-8" />
            </div>
          )}
          <div
            className={`max-w-[82%] px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
              isUser
                ? 'bg-[#123b63] text-white rounded-tr-sm'
                : 'bg-white text-gray-800 shadow-sm border border-gray-100 rounded-tl-sm'
            }`}
          >
            {renderTexto(msg.text)}
          </div>
        </div>

        {!isUser && msg.cards && msg.cards.length > 0 ? (() => {
          // 2. Deduplicação FINAL
          const map = new Map<string, AssistenteCard>();
          for (const item of msg.cards) {
            // 3. Chave oficial: inscricao.id -> inscricao_id -> id
            const key = item.inscricao?.id ?? item.inscricao_id ?? item.id;

            const existing = map.get(key);
            if (!existing) {
              map.set(key, item);
              continue;
            }

            // 4. Caso exista atualização da mesma inscrição:
            // priorizar o que possuir: pagamento = pago/isento + status_hospedagem = alocada/checkin + numero_leito preenchido
            const getScore = (c: AssistenteCard) => {
              const pag = String(c.status_pagamento || '').toLowerCase();
              const hosp = String(c.status_hospedagem || '').toLowerCase();
              const lei = String(c.numero_leito || '').trim();

              const isPago = pag === 'pago' || pag === 'isento';
              const isHosp = hosp === 'alocada' || hosp === 'confirmada' || hosp.includes('checkin') || hosp.includes('check-in') || hosp.includes('check_in');
              const hasLeito = lei !== '' && lei !== 'não definido' && lei !== 'nao definido' && lei !== 'não definido';

              let score = 0;
              if (isPago) score += 4;
              if (isHosp) score += 2;
              if (hasLeito) score += 1;
              return score;
            };

            if (getScore(item) > getScore(existing)) {
              map.set(key, item);
            }
          }
          const unique = Array.from(map.values());

          return (
            <div className="mt-3 ml-9 space-y-2">
              {unique.map(card => (
                <div key={card.id} className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
                  <div className="text-sm font-semibold text-gray-900">{card.title}</div>
                  {card.subtitle ? (
                    <div className="mt-1 text-xs text-gray-500">{card.subtitle}</div>
                  ) : null}
                  {card.meta && card.meta.length > 0 ? (
                    <div className="mt-2 space-y-1 text-xs text-gray-600">
                      {card.meta.map((line, idx) => (
                        <div key={`${card.id}-meta-${idx}`}>{line}</div>
                      ))}
                    </div>
                  ) : null}
                  {card.actions && card.actions.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {card.actions.map((action, idx) => {
                        const actionKey = `${msg.id}-${card.id}-${idx}`;
                        const label = copiadoId === actionKey ? 'Copiado!' : action.label;
                        const baseClass = action.variant === 'primary'
                          ? 'bg-[#123b63] text-white hover:bg-[#0f2a45]'
                          : 'bg-white text-gray-700 border border-gray-200 hover:border-[#123b63] hover:text-[#123b63]';

                        if (action.href) {
                          return (
                            <a
                              key={actionKey}
                              href={action.href}
                              target="_blank"
                              rel="noreferrer"
                              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition ${baseClass}`}
                            >
                              {label}
                            </a>
                          );
                        }

                        return (
                          <button
                            key={actionKey}
                            type="button"
                            onClick={() => handleAction(action, actionKey)}
                            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition ${baseClass}`}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          );
        })() : null}
      </div>
    );
  }

  return (
    <>
      <style jsx global>{`
        @keyframes saraFloating {
          0%, 100% {
            transform: translateY(0);
          }
          50% {
            transform: translateY(-8px);
          }
        }
        .animate-sara-float {
          animation: saraFloating 3s ease-in-out infinite;
        }
        @media (hover: hover) {
          .animate-sara-float:hover {
            animation-play-state: paused;
          }
        }
        .animate-sara-float:active,
        .animate-sara-float:focus {
          animation-play-state: paused;
        }
        @media (prefers-reduced-motion: reduce) {
          .animate-sara-float {
            animation: none !important;
          }
        }
      `}</style>

      {/* Botão flutuante - exibido somente enquanto o chat estiver fechado */}
      {!aberto && (
        <button
          onClick={() => setAberto(true)}
          aria-label="Abrir assistente virtual Sara"
          className="fixed bottom-[calc(1.25rem+env(safe-area-inset-bottom))] right-[calc(1.25rem+env(safe-area-inset-right))] z-40 flex items-center justify-center p-0 border-0 bg-transparent focus:outline-none cursor-pointer animate-sara-float transition-transform duration-200 hover:scale-[1.02] active:scale-95"
          style={{ width: 'auto', height: 'auto' }}
        >
          <MaiaAvatar sizeClass="w-[190px] sm:w-[260px] h-auto max-w-[85vw]" isFloating />
        </button>
      )}

      <div
        className={`fixed inset-x-3 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-50 h-[calc(100dvh-1.5rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] max-h-[600px] sm:inset-auto sm:bottom-6 sm:right-6 sm:w-[380px] sm:h-[520px] sm:max-h-[calc(100dvh-3rem)] bg-white rounded-2xl shadow-2xl border border-gray-200 flex flex-col overflow-hidden transition-all duration-300 origin-bottom-right ${
          aberto ? 'opacity-100 scale-100 pointer-events-auto' : 'opacity-0 scale-95 pointer-events-none'
        }`}
      >
        <div className="bg-[#0D2B4E] px-3.5 py-2.5 flex items-center gap-3 flex-shrink-0">
          <MaiaAvatar sizeClass="w-11 h-11" />
          <div className="flex-1 min-w-0">
            <p className="text-white font-bold text-sm leading-tight truncate">SARA</p>
            <p className="text-white/75 text-xs truncate">{headerSubtitle}</p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={limparConversa}
              title="Limpar conversa"
              className="min-h-[44px] px-3 py-2 text-white/80 hover:text-white text-xs bg-white/10 hover:bg-white/20 rounded-xl transition font-medium whitespace-nowrap flex items-center justify-center"
            >
              Limpar Conversa
            </button>
            <button
              onClick={() => setAberto(false)}
              className="min-w-[44px] min-h-[44px] flex items-center justify-center text-white/80 hover:text-white hover:bg-white/10 rounded-xl transition"
              aria-label="Fechar"
            >
              <svg className="w-[22px] h-[22px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto overflow-x-hidden bg-gray-50 px-3 py-3">
          {mensagens.length <= 1 && !loading && (
            <div className="mb-3 flex flex-col gap-2 w-full">
              {sugestoes.map(s => (
                <button
                  key={s.label}
                  type="button"
                  onClick={() => enviarPergunta(s.texto)}
                  className={`w-full min-h-[44px] flex items-center gap-2.5 rounded-xl border px-3.5 py-2 text-xs sm:text-sm font-medium shadow-sm transition active:scale-[0.99] ${s.cardClass}`}
                >
                  <span className="text-base leading-none shrink-0" aria-hidden="true">{s.icon}</span>
                  <span className="flex-1 text-left leading-snug">{s.label}</span>
                  <span className={`text-sm font-semibold shrink-0 ${s.arrowClass}`} aria-hidden="true">→</span>
                </button>
              ))}
            </div>
          )}

          {mensagens.map(msg => (
            <Bolha key={msg.id} msg={msg} />
          ))}

          {loading && (
            <div className="flex justify-start mb-2">
              <div className="mr-2 mt-1 flex-shrink-0">
                <MaiaAvatar sizeClass="w-8 h-8" />
              </div>
              <div className="bg-white border border-gray-100 shadow-sm px-4 py-3 rounded-2xl rounded-tl-sm">
                <div className="flex gap-1 items-center">
                  <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            </div>
          )}

          <div ref={fimRef} />
        </div>

        <form
          className="flex-shrink-0 border-t border-gray-100 bg-white px-3 py-2.5 flex items-center gap-2"
          onSubmit={event => {
            event.preventDefault();
            enviarPergunta(texto);
          }}
        >
          <input
            ref={inputRef}
            value={texto}
            onChange={event => setTexto(event.target.value)}
            placeholder="Digite sua mensagem..."
            disabled={loading}
            className="flex-1 text-base sm:text-sm px-3 py-2 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#123b63]/30 disabled:bg-gray-50 disabled:text-gray-400"
          />
          <button
            type="submit"
            disabled={!texto.trim() || loading}
            className="w-9 h-9 rounded-xl bg-[#123b63] hover:bg-[#0f2a45] disabled:bg-gray-300 text-white flex items-center justify-center transition flex-shrink-0"
            aria-label="Enviar"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </button>
        </form>

        <div className="flex-shrink-0 bg-gray-50 border-t border-gray-100 px-3 py-1.5 text-center">
          <p className="text-[10px] text-gray-300">Assistente baseado em dados cadastrados no sistema</p>
        </div>
      </div>
    </>
  );
}
