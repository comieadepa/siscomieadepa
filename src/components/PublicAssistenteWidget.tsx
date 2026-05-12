'use client';

import { useMemo, useRef, useState } from 'react';
import type { DepartamentoConfig } from '@/lib/public-portal';

export type PublicAssistenteScope = 'global' | 'departamento';

type Message = {
  id: string;
  role: 'maia' | 'user';
  text: string;
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
  const listRef = useRef<HTMLDivElement | null>(null);

  const sugestoes = useMemo(() => {
    return scope === 'departamento' ? SUGESTOES_DEPTO : SUGESTOES_GERAIS;
  }, [scope]);

  const headerTitle = scope === 'departamento' && departamento
    ? `Maia - ${departamento.nome}`
    : 'Maia - Eventos';

  function ensureInitialMessage() {
    if (mensagens.length > 0) return;
    const msg: Message = {
      id: `maia-${Date.now()}`,
      role: 'maia',
      text: buildInitialMessage(scope, departamento),
    };
    setMensagens([msg]);
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
      requestAnimationFrame(() => {
        listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
      });
    }
  }

  return (
    <div className="fixed bottom-5 right-5 z-40">
      <button
        type="button"
        onClick={() => {
          setAberto(prev => {
            const next = !prev;
            if (next) ensureInitialMessage();
            return next;
          });
        }}
        className="flex items-center gap-2 rounded-full bg-slate-900 px-4 py-3 text-sm font-semibold text-white shadow-lg transition hover:-translate-y-0.5"
      >
        <img src="/maia.png" alt="Maia" className="h-7 w-7 rounded-full object-cover" />
        <span>Falar com a Maia</span>
      </button>

      {aberto ? (
        <div className="mt-3 w-[min(92vw,380px)] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
          <div className="flex items-center justify-between bg-slate-900 px-4 py-3 text-white">
            <div>
              <div className="text-sm font-semibold">{headerTitle}</div>
              <div className="text-xs text-slate-300">Assistente oficial de eventos</div>
            </div>
            <button
              type="button"
              onClick={() => setAberto(false)}
              className="rounded-full border border-slate-600 px-2 py-1 text-xs"
            >
              Fechar
            </button>
          </div>

          <div ref={listRef} className="max-h-[360px] overflow-y-auto px-4 py-3">
            {mensagens.map(msg => (
              <div key={msg.id} className={`mb-3 flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[85%] whitespace-pre-line rounded-2xl px-3 py-2 text-sm ${
                    msg.role === 'user'
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-100 text-slate-800'
                  }`}
                >
                  {msg.text}
                </div>
              </div>
            ))}

            {mensagens.length === 1 ? (
              <div className="mt-4 grid gap-2">
                {sugestoes.map(s => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => enviarPergunta(s)}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-xs font-semibold text-slate-700 transition hover:border-slate-400"
                  >
                    {s}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <form
            className="flex items-center gap-2 border-t border-slate-200 px-3 py-3"
            onSubmit={event => {
              event.preventDefault();
              enviarPergunta(texto);
            }}
          >
            <input
              value={texto}
              onChange={event => setTexto(event.target.value)}
              placeholder="Digite sua pergunta"
              className="flex-1 rounded-full border border-slate-200 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
            />
            <button
              type="submit"
              disabled={loading}
              className="rounded-full bg-amber-500 px-4 py-2 text-xs font-semibold text-white transition disabled:opacity-60"
            >
              {loading ? 'Enviando...' : 'Enviar'}
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
