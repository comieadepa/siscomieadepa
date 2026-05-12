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

// ─── Sugestões rápidas ─────────────────────────────────────────
const SUGESTOES = [
  { label: '🙋 Preciso de ajuda',          texto: 'Olá! Preciso de ajuda com informações do evento.' },
  { label: '🔍 Consultar minha inscrição', texto: 'Quero consultar minha inscrição.' },
  { label: '📋 Ver programação',           texto: 'Qual é a programação do evento?' },
  { label: '🛏️ Falar sobre hospedagem',   texto: 'O evento oferece hospedagem?' },
];

function MaiaAvatar({ sizeClass, className }: { sizeClass: string; className?: string }) {
  return (
    <img
      src="/maia.png"
      alt="Maia"
      className={`${sizeClass} rounded-full bg-white border border-blue-200 shadow-sm object-cover object-center ${className ?? ''}`.trim()}
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
    'inscricao',
    'status',
    'confirmado',
    'confirmada',
    'estou inscrito',
    'consultar inscricao',
  ].some(termo => p.includes(termo));
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
    texto: `Oi 😊\nSou a Maia e estou aqui para te ajudar com informações do evento *${nomeEvento}*.\n\nComo posso ajudar?`,
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
            <MaiaAvatar sizeClass="w-7 h-7" />
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
        <div className="relative">
          <span className="pointer-events-none absolute -inset-1 rounded-full shadow-[0_0_14px_rgba(59,130,246,0.35)] motion-safe:animate-pulse" />
          <MaiaAvatar sizeClass="w-14 h-14" className="relative border-[3px] border-white shadow-md" />
        </div>
      </button>

      {/* Notificação no botão quando fechado */}
      {!aberto && (
        <div className="fixed bottom-[5.25rem] right-5 z-50 pointer-events-none">
          <div className="bg-white border border-gray-200 shadow-lg rounded-xl px-3.5 py-1.5 text-xs font-semibold text-[#0D2B4E] animate-bounce max-w-[70vw]">
            Olá 😊 Posso ajudar?
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
          <MaiaAvatar sizeClass="w-9 h-9" />
          <div className="flex-1 min-w-0">
            <p className="text-white font-bold text-sm leading-tight truncate">Maia</p>
            <p className="text-white/60 text-xs truncate">{nomeEvento}</p>
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
