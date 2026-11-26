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

type Intent = 'segunda_via' | 'consulta_inscricao' | 'hospedagem' | 'certificado' | null;

interface CampoCpfProps {
  cpf: string;
  onCpfChange: (value: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}

// ─── Atalhos fixos ────────────────────────────────────────────
const SUGESTOES = [
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

function CampoCpf({ cpf, onCpfChange, onSubmit, onClose }: CampoCpfProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="px-3 pb-2">
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
        <p className="text-xs text-amber-700 font-semibold mb-2">
          Para consultar sua inscrição, informe seu CPF:
        </p>
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={cpf}
            onChange={e => onCpfChange(e.target.value)}
            placeholder="000.000.000-00"
            maxLength={14}
            className="flex-1 border border-amber-300 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-amber-300"
          />
          <button
            onClick={onSubmit}
            className="bg-[#123b63] text-white text-xs px-3 py-1.5 rounded-lg font-bold hover:bg-[#0f2a45] transition"
          >
            OK
          </button>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xs px-2"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}

function detectarIntent(pergunta: string): Intent {
  const p = pergunta
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const pNoSpace = p.replace(/\s+/g, '');

  const isSegundaVia = [
    'segunda via',
    'segundo via',
    'segunda bia',
    'boleto',
    'pix',
    'link de pagamento',
    'link do pagamento',
    'pagamento',
    'pagar inscricao',
    'perdi o pagamento',
    'gerar cobranca',
  ].some(termo => p.includes(termo))
    || ['2via', '2avia'].some(termo => pNoSpace.includes(termo))
    || /\b2\s+via\b/.test(p)
    || /\bsegund[ao]\s+vi?a\b/.test(p)
    || /\bsegunda\s+bi?a\b/.test(p);

  if (isSegundaVia) return 'segunda_via';

  const isInscricao = [
    'minha inscricao',
    'status da inscricao',
    'minha vaga',
    'meu status',
    'confirmado',
    'confirmada',
    'estou inscrito',
    'estou inscrita',
    'consultar inscricao',
    'ver minha inscricao',
    'consultar minha inscricao',
  ].some(termo => p.includes(termo))
    || /\b(minha|meu)\s+inscri[cç][aã]o\b/.test(p)
    || /\bestou\s+inscrit[oa]\b/.test(p)
    || /\bconsultar\s+(minha\s+)?inscri[cç][aã]o\b/.test(p)
    || /\b(minha\s+inscri[cç][aã]o\s+est[aá]\s+confirmad[oa])\b/.test(p);
  if (isInscricao) return 'consulta_inscricao';

  if (['hospedagem', 'alojamento', 'dormir', 'pernoite', 'cama', 'leito'].some(termo => p.includes(termo))) {
    return 'hospedagem';
  }

  if (p.includes('certificado')) return 'certificado';
  return null;
}

// ─── Componente ───────────────────────────────────────────────
export default function AssistenteWidget({ eventoId, nomeEvento }: AssistenteWidgetProps) {
  const [aberto,       setAberto]       = useState(false);
  const [mensagens,    setMensagens]    = useState<Mensagem[]>([]);
  const [input,        setInput]        = useState('');
  const [cpf,          setCpf]          = useState('');
  const [ultimoCpf,    setUltimoCpf]    = useState('');
  const [pendingIntent, setPendingIntent] = useState<Intent>(null);
  const [pendingCpf,   setPendingCpf]   = useState(false);
  const [mostraCpf,    setMostraCpf]    = useState(false);
  const [enviando,     setEnviando]     = useState(false);
  const [inicializado, setInicializado] = useState(false);

  const fimRef   = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const criarMensagemInicial = useCallback((): Mensagem => ({
    role: 'bot',
    texto: `Oi 😊\nSou a SARA e estou aqui para te ajudar com informações do evento *${nomeEvento}*.\n\nComo posso ajudar?`,
    ts: Date.now(),
  }), [nomeEvento]);

  // Mensagem de boas-vindas ao abrir pela primeira vez
  useEffect(() => {
    if (aberto && !inicializado) {
      setMensagens([criarMensagemInicial()]);
      setInicializado(true);
    }
  }, [aberto, inicializado, criarMensagemInicial]);

  // Scroll para o fim ao receber mensagem
  useEffect(() => {
    fimRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [mensagens]);

  // Foca no input ao abrir
  useEffect(() => {
    if (aberto) setTimeout(() => inputRef.current?.focus(), 150);
  }, [aberto]);

  useEffect(() => {
    if (pendingCpf && !mostraCpf) setMostraCpf(true);
  }, [pendingCpf, mostraCpf]);

  const limparConversa = useCallback(() => {
    setMensagens([criarMensagemInicial()]);
    setInput('');
    setCpf('');
    setUltimoCpf('');
    setPendingIntent(null);
    setPendingCpf(false);
    setMostraCpf(false);
    setEnviando(false);
    setInicializado(true);
    setTimeout(() => inputRef.current?.focus(), 100);
  }, [criarMensagemInicial]);

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

    const intentDetectada = detectarIntent(pergunta);
    const intentFinal = intentDetectada ?? pendingIntent;
    const cpfEnvio = cpfDigits ?? (ultimoCpf || cpf || undefined);
    const cpfEnvioDigits = cpfEnvio ? String(cpfEnvio).replace(/\D/g, '') : '';
    const cpfEnvioFinal = cpfEnvioDigits.length === 11 ? cpfEnvioDigits : cpfEnvio;
    const precisaCpf = intentFinal === 'segunda_via' || intentFinal === 'consulta_inscricao';
    const aguardandoAgora = !!(precisaCpf && cpfEnvioDigits.length !== 11);
    const usarPendencia = pendingCpf && pendingIntent && cpfEnvioDigits.length === 11;

    let perguntaParaApi = pergunta;
    let intentParaApi = intentFinal;
    if (usarPendencia) {
      intentParaApi = pendingIntent;
      perguntaParaApi = pendingIntent === 'segunda_via'
        ? 'segunda via'
        : pendingIntent === 'consulta_inscricao'
          ? 'consulta inscricao'
          : pendingIntent === 'certificado'
            ? 'certificado'
            : 'hospedagem';
    }

    if (intentDetectada && precisaCpf && cpfEnvioDigits.length !== 11) {
      setPendingIntent(intentDetectada);
      setPendingCpf(true);
    } else if (intentDetectada && precisaCpf && cpfEnvioDigits.length === 11) {
      setPendingIntent(null);
      setPendingCpf(false);
    } else if (intentDetectada && !precisaCpf) {
      setPendingIntent(null);
      setPendingCpf(false);
    }
    if (cpfDigits) {
      setUltimoCpf(cpfDigits);
    } else if (cpfEnvioDigits.length === 11) {
      setUltimoCpf(cpfEnvioDigits);
    }
    if (!intentDetectada) {
      setPendingCpf(aguardandoAgora);
    }

    try {
      const res = await fetch(`/api/eventos/${eventoId}/assistente`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pergunta: perguntaParaApi,
          cpf: cpfEnvioFinal,
          contexto: {
            intent: intentParaApi,
            aguardandoCpf: aguardandoAgora,
            ultimoCpf: cpfEnvioDigits || null,
          },
        }),
      });
      const json = await res.json();

      // Armazena CPF (apenas dígitos) se foi reconhecido
      if (cpfDigits) {
        setCpf(cpfDigits);
        setPendingCpf(false);
      }
      if ((intentParaApi === 'segunda_via' || intentParaApi === 'consulta_inscricao') && cpfEnvioDigits.length === 11) {
        setPendingIntent(null);
        setPendingCpf(false);
      }

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
  }, [enviando, cpf, eventoId, ultimoCpf, pendingIntent, pendingCpf]);

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
          <div className="mr-2 mt-1 flex-shrink-0">
            <MaiaAvatar sizeClass="w-8 h-8" />
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

      {/* ── Botão flutuante - exibido somente enquanto o chat estiver fechado ── */}
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

      {/* ── Janela do chat ──────────────────────────────────── */}
      <div
        className={`fixed inset-x-3 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-50 h-[calc(100dvh-1.5rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] max-h-[600px] sm:inset-auto sm:bottom-6 sm:right-6 sm:w-[380px] sm:h-[520px] sm:max-h-[calc(100dvh-3rem)] bg-white rounded-2xl shadow-2xl border border-gray-200 flex flex-col overflow-hidden transition-all duration-300 origin-bottom-right ${
          aberto ? 'opacity-100 scale-100 pointer-events-auto' : 'opacity-0 scale-95 pointer-events-none'
        }`}
      >
        {/* ── Cabeçalho ─────────────────────────────────────── */}
        <div className="bg-[#0D2B4E] px-3.5 py-2.5 flex items-center gap-3 flex-shrink-0">
          <MaiaAvatar sizeClass="w-11 h-11" />
          <div className="flex-1 min-w-0">
            <p className="text-white font-bold text-sm leading-tight truncate">SARA</p>
            <p className="text-white/75 text-xs truncate">
              {/126[ªa]\s*AGO/i.test(nomeEvento) ? '126ª AGO' : nomeEvento}
            </p>
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

        {/* ── Área de mensagens ─────────────────────────────── */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden bg-gray-50 px-3 py-3">

          {/* Atalhos fixos (antes de qualquer troca) */}
          {mensagens.length <= 1 && !enviando && (
            <div className="mb-3 flex flex-col gap-2 w-full">
              {SUGESTOES.map(s => (
                <button
                  key={s.label}
                  type="button"
                  onClick={() => enviar(s.texto)}
                  className={`w-full min-h-[44px] flex items-center gap-2.5 rounded-xl border px-3.5 py-2 text-xs sm:text-sm font-medium shadow-sm transition active:scale-[0.99] ${s.cardClass}`}
                >
                  <span className="text-base leading-none shrink-0" aria-hidden="true">{s.icon}</span>
                  <span className="flex-1 text-left leading-snug">{s.label}</span>
                  <span className={`text-sm font-semibold shrink-0 ${s.arrowClass}`} aria-hidden="true">→</span>
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

        {/* ── Campo CPF opcional ────────────────────────────── */}
        {mostraCpf && (
          <CampoCpf
            cpf={cpf}
            onCpfChange={setCpf}
            onSubmit={() => {
              setMostraCpf(false);
              if (cpf.trim()) {
                enviar(cpf);
              }
            }}
            onClose={() => setMostraCpf(false)}
          />
        )}

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
            className="flex-1 text-base sm:text-sm px-3 py-2 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#123b63]/30 disabled:bg-gray-50 disabled:text-gray-400"
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
