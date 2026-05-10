'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

// ─── Tipos ────────────────────────────────────────────────────
interface Mensagem {
  role: 'user' | 'bot';
  texto: string;
  ts: number;
}

interface AssistenteWidgetProps {
  eventoId: string;
  nomeEvento: string;
}

// ─── Sugestões rápidas ─────────────────────────────────────────
const SUGESTOES = [
  { label: '🙋 Preciso de ajuda',          texto: 'Olá! Preciso de ajuda com informações do evento.' },
  { label: '🔍 Consultar minha inscrição', texto: 'Quero consultar minha inscrição.' },
  { label: '📋 Ver programação',           texto: 'Qual é a programação do evento?' },
  { label: '🛏️ Falar sobre hospedagem',   texto: 'O evento oferece hospedagem?' },
];

// ─── Componente ───────────────────────────────────────────────
export default function AssistenteWidget({ eventoId, nomeEvento }: AssistenteWidgetProps) {
  const [aberto,       setAberto]       = useState(false);
  const [mensagens,    setMensagens]    = useState<Mensagem[]>([]);
  const [input,        setInput]        = useState('');
  const [cpf,          setCpf]          = useState('');
  const [mostraCpf,    setMostraCpf]    = useState(false);
  const [enviando,     setEnviando]     = useState(false);
  const [inicializado, setInicializado] = useState(false);

  const fimRef   = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Mensagem de boas-vindas ao abrir pela primeira vez
  useEffect(() => {
    if (aberto && !inicializado) {
      setMensagens([{
        role: 'bot',
        texto: `Olá! 👋 Sou o Assistente do evento *${nomeEvento}*.\n\nComo posso ajudar?`,
        ts: Date.now(),
      }]);
      setInicializado(true);
    }
  }, [aberto, inicializado, nomeEvento]);

  // Scroll para o fim ao receber mensagem
  useEffect(() => {
    fimRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [mensagens]);

  // Foca no input ao abrir
  useEffect(() => {
    if (aberto) setTimeout(() => inputRef.current?.focus(), 150);
  }, [aberto]);

  // ── Envia mensagem ──────────────────────────────────────────
  const enviar = useCallback(async (texto: string) => {
    const pergunta = texto.trim();
    if (!pergunta || enviando) return;

    // Adiciona mensagem do usuário
    setMensagens(prev => [...prev, { role: 'user', texto: pergunta, ts: Date.now() }]);
    setInput('');
    setEnviando(true);

    // Detecta CPF: 11 dígitos puros, ###.###.###-## ou variantes com espaços
    const CPF_RE = /(?<!\d)(\d{3}[.\s]?\d{3}[.\s]?\d{3}[-\s]?\d{2})(?!\d)/;
    const cpfMatch = pergunta.match(CPF_RE);
    const cpfDigits = cpfMatch ? cpfMatch[1].replace(/\D/g, '') : null;
    const cpfEnvio = cpfDigits ?? (cpf || undefined);

    try {
      const res = await fetch(`/api/eventos/${eventoId}/assistente`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pergunta, cpf: cpfEnvio }),
      });
      const json = await res.json();

      // Armazena CPF (apenas dígitos) se foi reconhecido
      if (cpfDigits) setCpf(cpfDigits);

      setMensagens(prev => [
        ...prev,
        { role: 'bot', texto: json.resposta ?? 'Não consegui processar sua mensagem.', ts: Date.now() },
      ]);
    } catch {
      setMensagens(prev => [
        ...prev,
        { role: 'bot', texto: '⚠️ Erro de conexão. Tente novamente.', ts: Date.now() },
      ]);
    } finally {
      setEnviando(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [enviando, cpf, eventoId]);

  // ── Tecla Enter ─────────────────────────────────────────────
  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      enviar(input);
    }
  }

  // ── Renderiza texto com *negrito* ───────────────────────────
  function renderTexto(texto: string) {
    const partes = texto.split(/(\*[^*]+\*)/g);
    return partes.map((parte, i) => {
      if (parte.startsWith('*') && parte.endsWith('*')) {
        return <strong key={i}>{parte.slice(1, -1)}</strong>;
      }
      return <span key={i}>{parte}</span>;
    });
  }

  // ── Bolha de mensagem ──────────────────────────────────────
  function Bolha({ msg }: { msg: Mensagem }) {
    const isBot = msg.role === 'bot';
    return (
      <div className={`flex ${isBot ? 'justify-start' : 'justify-end'} mb-2`}>
        {isBot && (
          <div className="w-7 h-7 rounded-full bg-[#123b63] flex items-center justify-center text-white text-xs font-bold mr-2 flex-shrink-0 mt-1">
            🤖
          </div>
        )}
        <div
          className={`max-w-[82%] px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
            isBot
              ? 'bg-white text-gray-800 shadow-sm border border-gray-100 rounded-tl-sm'
              : 'bg-[#123b63] text-white rounded-tr-sm'
          }`}
        >
          {renderTexto(msg.texto)}
        </div>
      </div>
    );
  }

  // ── Campo CPF opcional ──────────────────────────────────────
  function CampoCpf() {
    return (
      <div className="px-3 pb-2">
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
          <p className="text-xs text-amber-700 font-semibold mb-2">
            Para consultar sua inscrição, informe seu CPF:
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={cpf}
              onChange={e => setCpf(e.target.value)}
              placeholder="000.000.000-00"
              maxLength={14}
              className="flex-1 border border-amber-300 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-amber-300"
            />
            <button
              onClick={() => {
                setMostraCpf(false);
                if (cpf.trim()) {
                  enviar(`Consultar inscrição com CPF ${cpf}`);
                }
              }}
              className="bg-[#123b63] text-white text-xs px-3 py-1.5 rounded-lg font-bold hover:bg-[#0f2a45] transition"
            >
              OK
            </button>
            <button
              onClick={() => setMostraCpf(false)}
              className="text-gray-400 hover:text-gray-600 text-xs px-2"
            >
              ✕
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* ── Botão flutuante ─────────────────────────────────── */}
      <button
        onClick={() => setAberto(a => !a)}
        aria-label="Abrir assistente do evento"
        className={`fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full shadow-xl flex items-center justify-center transition-all duration-300 ${
          aberto
            ? 'bg-gray-700 hover:bg-gray-600 scale-95'
            : 'bg-[#123b63] hover:bg-[#0f2a45] scale-100 hover:scale-105'
        }`}
      >
        {aberto ? (
          <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5-1-5z" />
          </svg>
        )}
      </button>

      {/* Notificação no botão quando fechado */}
      {!aberto && (
        <div className="fixed bottom-[4.25rem] right-5 z-50 pointer-events-none">
          <div className="bg-white border border-gray-200 shadow-lg rounded-xl px-3 py-1.5 text-xs font-semibold text-gray-700 whitespace-nowrap animate-bounce">
            💬 Assistente do Evento
          </div>
        </div>
      )}

      {/* ── Janela do chat ──────────────────────────────────── */}
      <div
        className={`fixed bottom-24 right-6 z-50 w-[360px] max-w-[calc(100vw-2rem)] bg-white rounded-2xl shadow-2xl border border-gray-200 flex flex-col overflow-hidden transition-all duration-300 origin-bottom-right ${
          aberto ? 'opacity-100 scale-100 pointer-events-auto' : 'opacity-0 scale-95 pointer-events-none'
        }`}
        style={{ height: 480, maxHeight: 'calc(100vh - 8rem)' }}
      >
        {/* ── Cabeçalho ─────────────────────────────────────── */}
        <div className="bg-[#0D2B4E] px-4 py-3 flex items-center gap-3 flex-shrink-0">
          <div className="w-9 h-9 rounded-full bg-white/10 border border-white/20 flex items-center justify-center text-lg flex-shrink-0">
            🤖
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white font-bold text-sm leading-tight truncate">Assistente do Evento</p>
            <p className="text-white/60 text-xs truncate">{nomeEvento}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setMostraCpf(m => !m)}
              title="Informar CPF para consultar inscrição"
              className="text-white/60 hover:text-white text-xs bg-white/10 hover:bg-white/20 px-2 py-1 rounded-lg transition font-medium"
            >
              CPF
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

        {/* ── Área de mensagens ─────────────────────────────── */}
        <div className="flex-1 overflow-y-auto bg-gray-50 px-3 py-3">

          {/* Sugestões rápidas (antes de qualquer troca) */}
          {mensagens.length <= 1 && !enviando && (
            <div className="mb-3 flex flex-wrap gap-1.5">
              {SUGESTOES.map(s => (
                <button
                  key={s.label}
                  onClick={() => enviar(s.texto)}
                  className="text-xs bg-white border border-gray-200 hover:border-[#123b63] hover:text-[#123b63] text-gray-600 px-3 py-1.5 rounded-full transition font-medium shadow-sm"
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}

          {/* Mensagens */}
          {mensagens.map((msg, i) => (
            <Bolha key={i} msg={msg} />
          ))}

          {/* Indicador de digitação */}
          {enviando && (
            <div className="flex justify-start mb-2">
              <div className="w-7 h-7 rounded-full bg-[#123b63] flex items-center justify-center text-white text-xs mr-2 mt-1 flex-shrink-0">
                🤖
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

        {/* ── Campo CPF opcional ────────────────────────────── */}
        {mostraCpf && <CampoCpf />}

        {/* ── Input de mensagem ─────────────────────────────── */}
        <div className="flex-shrink-0 border-t border-gray-100 bg-white px-3 py-2.5 flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Digite sua mensagem..."
            disabled={enviando}
            className="flex-1 text-sm px-3 py-2 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#123b63]/30 disabled:bg-gray-50 disabled:text-gray-400"
          />
          <button
            onClick={() => enviar(input)}
            disabled={!input.trim() || enviando}
            className="w-9 h-9 rounded-xl bg-[#123b63] hover:bg-[#0f2a45] disabled:bg-gray-300 text-white flex items-center justify-center transition flex-shrink-0"
            aria-label="Enviar"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </button>
        </div>

        {/* ── Rodapé ─────────────────────────────────────────── */}
        <div className="flex-shrink-0 bg-gray-50 border-t border-gray-100 px-3 py-1.5 text-center">
          <p className="text-[10px] text-gray-300">Assistente baseado em dados cadastrados no sistema</p>
        </div>
      </div>
    </>
  );
}
