'use client';

import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
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
  title: string;
  subtitle?: string;
  meta?: string[];
  actions?: AssistenteAction[];
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
    return `Oi! Eu sou a Maia :)\nPosso ajudar com inscricoes e eventos da ${departamento.nome}.`;
  }
  return 'Oi! Eu sou a Maia :)\nPosso ajudar com inscricoes abertas, pagamentos e duvidas gerais dos eventos.';
}

function MaiaAvatar({ sizeClass, className }: { sizeClass: string; className?: string }) {
  return (
    <img
      src="/maia.png"
      alt="Maia"
      className={`${sizeClass} rounded-full bg-white border border-blue-200 shadow-sm object-cover object-center ${className ?? ''}`.trim()}
    />
  );
}

const SUGESTOES_GERAIS = [
  'Quais eventos estao com inscricoes abertas?',
  'Como faco minha inscricao?',
  'Preciso da segunda via do pagamento',
];

const SUGESTOES_DEPTO = [
  'Quais eventos estao abertos?',
  'Como pago minha inscricao?',
  'Tem vagas disponiveis?',
];

export default function PublicAssistenteWidget({ scope, departamento }: Props) {
  const [aberto, setAberto] = useState(false);
  const [mensagens, setMensagens] = useState<Message[]>([]);
  const [texto, setTexto] = useState('');
  const [loading, setLoading] = useState(false);
  const [inicializado, setInicializado] = useState(false);
  const [copiadoId, setCopiadoId] = useState<string | null>(null);
  const fimRef = useRef<HTMLDivElement | null>(null);

  const sugestoes = useMemo(() => {
    return scope === 'departamento' ? SUGESTOES_DEPTO : SUGESTOES_GERAIS;
  }, [scope]);

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
  }, [aberto, inicializado, criarMensagemInicial]);

  useEffect(() => {
    fimRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [mensagens]);

  function limparConversa() {
    setMensagens([criarMensagemInicial()]);
    setTexto('');
    setLoading(false);
    setInicializado(true);
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
          },
        }),
      });

      const data = await res.json();
      const resposta = String(data?.resposta || 'Desculpe, nao consegui responder agora.');
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
              <MaiaAvatar sizeClass="w-7 h-7" />
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

        {!isUser && msg.cards && msg.cards.length > 0 ? (
          <div className="mt-3 ml-9 space-y-2">
            {msg.cards.map(card => (
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
        ) : null}
      </div>
    );
  }

  return (
    <>
      <button
        onClick={() => setAberto(a => !a)}
        aria-label="Abrir assistente publico"
        className={`fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full shadow-xl flex items-center justify-center transition-all duration-300 ${
          aberto
            ? 'bg-gray-700 hover:bg-gray-600 scale-95'
            : 'bg-[#123b63] hover:bg-[#0f2a45] scale-100 hover:scale-105'
        }`}
      >
        <div className="relative">
          <span className="pointer-events-none absolute -inset-1 rounded-full shadow-[0_0_14px_rgba(59,130,246,0.35)] motion-safe:animate-pulse" />
          <MaiaAvatar sizeClass="w-14 h-14" className="relative border-[3px] border-white shadow-md" />
        </div>
      </button>

      {!aberto && (
        <div className="fixed bottom-[5.25rem] right-5 z-50 pointer-events-none">
          <div className="bg-white border border-gray-200 shadow-lg rounded-xl px-3.5 py-1.5 text-xs font-semibold text-[#0D2B4E] animate-bounce max-w-[70vw]">
            Ola :) Posso ajudar?
          </div>
        </div>
      )}

      <div
        className={`fixed bottom-24 right-6 z-50 w-[360px] max-w-[calc(100vw-2rem)] bg-white rounded-2xl shadow-2xl border border-gray-200 flex flex-col overflow-hidden transition-all duration-300 origin-bottom-right ${
          aberto ? 'opacity-100 scale-100 pointer-events-auto' : 'opacity-0 scale-95 pointer-events-none'
        }`}
        style={{ height: 480, maxHeight: 'calc(100vh - 8rem)' }}
      >
        <div className="bg-[#0D2B4E] px-4 py-3 flex items-center gap-3 flex-shrink-0">
          <MaiaAvatar sizeClass="w-9 h-9" />
          <div className="flex-1 min-w-0">
            <p className="text-white font-bold text-sm leading-tight truncate">Maia</p>
            <p className="text-white/60 text-xs truncate">{headerSubtitle}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={limparConversa}
              title="Limpar conversa"
              className="text-white/60 hover:text-white text-xs bg-white/10 hover:bg-white/20 px-2 py-1 rounded-lg transition font-medium whitespace-nowrap"
            >
              Limpar Conversa
            </button>
            <button
              onClick={() => setAberto(false)}
              className="text-white/60 hover:text-white transition"
              aria-label="Fechar"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto bg-gray-50 px-3 py-3">
          {mensagens.length <= 1 && !loading && (
            <div className="mb-3 flex flex-wrap gap-1.5">
              {sugestoes.map(s => (
                <button
                  key={s}
                  onClick={() => enviarPergunta(s)}
                  className="text-xs bg-white border border-gray-200 hover:border-[#123b63] hover:text-[#123b63] text-gray-600 px-3 py-1.5 rounded-full transition font-medium shadow-sm"
                >
                  {s}
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
                <MaiaAvatar sizeClass="w-7 h-7" />
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
            value={texto}
            onChange={event => setTexto(event.target.value)}
            placeholder="Digite sua mensagem..."
            disabled={loading}
            className="flex-1 text-sm px-3 py-2 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#123b63]/30 disabled:bg-gray-50 disabled:text-gray-400"
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
