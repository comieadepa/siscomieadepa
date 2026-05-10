'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useEventosPerfil } from '@/hooks/useEventosPerfil';
import { useRequireSupabaseAuth } from '@/hooks/useRequireSupabaseAuth';
import { createClient } from '@/lib/supabase-client';

// ─── Tipos ────────────────────────────────────────────────────
interface Evento {
  id: string; nome: string; slug: string;
  departamento: string; data_inicio: string; data_fim: string;
}

interface Inscricao {
  id: string; evento_id: string;
  nome_inscrito: string; cpf: string | null;
  supervisao_id: string | null; campo_id: string | null;
  status_pagamento: string;
  checkin_realizado: boolean; checkin_at: string | null;
  qr_code: string | null;
}

interface Supervisao { id: string; nome: string; }
interface Campo      { id: string; nome: string; }

type EstadoScan =
  | 'idle'
  | 'processing'
  | 'success'
  | 'already'
  | 'invalid'
  | 'wrong_event';

interface ResultadoScan {
  estado: EstadoScan;
  inscricao?: Inscricao;
  nomeSup?: string;
  nomeCampo?: string;
}

// ─── Helpers ─────────────────────────────────────────────────
const fmtDT = (d: string | null) => {
  if (!d) return '-';
  return new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
};

function emitirSom(tipo: 'sucesso' | 'erro') {
  try {
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    if (tipo === 'sucesso') {
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.setValueAtTime(1100, ctx.currentTime + 0.1);
    } else {
      osc.frequency.setValueAtTime(220, ctx.currentTime);
      osc.frequency.setValueAtTime(180, ctx.currentTime + 0.1);
    }
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.4);
  } catch {
    // Silencioso se AudioContext não disponível
  }
}

function vibrar(tipo: 'sucesso' | 'erro') {
  if (!navigator.vibrate) return;
  if (tipo === 'sucesso') navigator.vibrate([100, 50, 100]);
  else navigator.vibrate([200, 100, 200, 100, 200]);
}

// ─── Componente principal ─────────────────────────────────────
export default function CheckinMobilePage() {
  const { loading: authLoading } = useRequireSupabaseAuth();
  const perfil = useEventosPerfil();
  const router = useRouter();
  const params = useParams();
  const id = params?.id as string;
  const supabase = useMemo(() => createClient(), []);

  const [evento,      setEvento]      = useState<Evento | null>(null);
  const [supervisoes, setSupervisoes] = useState<Supervisao[]>([]);
  const [campos,      setCampos]      = useState<Campo[]>([]);
  const [loadingEvento, setLoadingEvento] = useState(true);
  const [acessoNegado,  setAcessoNegado]  = useState(false);

  // Contadores em tempo real
  const [totalCheckins, setTotalCheckins] = useState(0);
  const [ultimosCheckins, setUltimosCheckins] = useState<Inscricao[]>([]);

  // Estado do scanner
  const [scannerAtivo,  setScannerAtivo]  = useState(false);
  const [resultado,     setResultado]     = useState<ResultadoScan | null>(null);
  const [processando,   setProcessando]   = useState(false);
  const scannerRef = useRef<unknown>(null);
  const scannerElementId = 'qr-scanner-region';
  const ignorandoRef = useRef(false); // evita double-scan

  // Busca manual
  const [modoManual,  setModoManual]  = useState(false);
  const [buscaManual, setBuscaManual] = useState('');
  const [resultadosManual, setResultadosManual] = useState<Inscricao[]>([]);
  const [buscandoManual,   setBuscandoManual]   = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Carrega evento e dados base ───────────────────────────
  useEffect(() => {
    if (authLoading || perfil.loading) return;

    // Gate de acesso
    if (!perfil.isGlobal && id && !perfil.podeAcessarEvento(id)) {
      setAcessoNegado(true);
      setLoadingEvento(false);
      return;
    }

    async function load() {
      const [evRes, supRes, camRes] = await Promise.all([
        supabase.from('eventos').select('id,nome,slug,departamento,data_inicio,data_fim').eq('id', id).single(),
        supabase.from('supervisoes').select('id,nome').order('nome'),
        supabase.from('campos').select('id,nome').order('nome'),
      ]);
      // Gate de departamento: isDeptAdmin só acessa eventos do seu dept
      if (evRes.data && perfil.isDeptAdmin && (evRes.data as Evento).departamento !== perfil.departamentoUsuario) {
        setAcessoNegado(true); setLoadingEvento(false); return;
      }
      if (evRes.data) setEvento(evRes.data as Evento);
      if (supRes.data) setSupervisoes(supRes.data as Supervisao[]);
      if (camRes.data) setCampos(camRes.data as Campo[]);
      setLoadingEvento(false);
      await carregarContadores();
    }
    load();
  }, [authLoading, perfil.loading, perfil.isGlobal, perfil.isDeptAdmin, perfil.departamentoUsuario, id, supabase]);

  const carregarContadores = useCallback(async () => {
    if (!id) return;
    const { data, count } = await supabase
      .from('evento_inscricoes')
      .select('id,nome_inscrito,cpf,supervisao_id,campo_id,status_pagamento,checkin_realizado,checkin_at,qr_code,evento_id', { count: 'exact' })
      .eq('evento_id', id)
      .eq('checkin_realizado', true)
      .order('checkin_at', { ascending: false })
      .limit(10);
    setTotalCheckins(count ?? 0);
    setUltimosCheckins((data ?? []) as Inscricao[]);
  }, [id, supabase]);

  // ── Inicia / para câmera ──────────────────────────────────
  useEffect(() => {
    if (!scannerAtivo || !evento) return;

    let scanner: unknown = null;

    import('html5-qrcode').then(({ Html5QrcodeScanner }) => {
      scanner = new Html5QrcodeScanner(
        scannerElementId,
        {
          fps: 10,
          qrbox: { width: 260, height: 260 },
          aspectRatio: 1.0,
          rememberLastUsedCamera: true,
          showTorchButtonIfSupported: true,
        },
        false
      );

      (scanner as { render: (s: (d: string) => void, e: (e: string) => void) => void }).render(
        onQRCodeSuccess,
        () => { /* erros de scan silenciosos */ }
      );

      scannerRef.current = scanner;
    });

    return () => {
      if (scannerRef.current) {
        (scannerRef.current as { clear: () => Promise<void> }).clear().catch(() => {});
        scannerRef.current = null;
      }
    };
  }, [scannerAtivo, evento]);

  // ── Processa QR Code lido ─────────────────────────────────
  async function onQRCodeSuccess(qrText: string) {
    if (ignorandoRef.current || processando) return;
    ignorandoRef.current = true;
    setProcessando(true);

    // Pausa o scanner enquanto processa
    if (scannerRef.current) {
      try {
        await (scannerRef.current as { pause: () => void }).pause();
      } catch { /* ignora */ }
    }

    try {
      // Busca inscrição pelo token do QR Code
      const { data: insc } = await supabase
        .from('evento_inscricoes')
        .select('id,evento_id,nome_inscrito,cpf,supervisao_id,campo_id,status_pagamento,checkin_realizado,checkin_at,qr_code')
        .eq('qr_code', qrText.trim())
        .single();

      if (!insc) {
        setResultado({ estado: 'invalid' });
        emitirSom('erro');
        vibrar('erro');
        setTimeout(() => voltarParaScan(), 4000);
        return;
      }

      const inscricao = insc as Inscricao;

      if (inscricao.evento_id !== id) {
        setResultado({ estado: 'wrong_event', inscricao });
        emitirSom('erro');
        vibrar('erro');
        setTimeout(() => voltarParaScan(), 4000);
        return;
      }

      const nomeSup   = supervisoes.find(s => s.id === inscricao.supervisao_id)?.nome ?? '-';
      const nomeCampo = campos.find(c => c.id === inscricao.campo_id)?.nome ?? '-';

      if (inscricao.checkin_realizado) {
        setResultado({ estado: 'already', inscricao, nomeSup, nomeCampo });
        emitirSom('erro');
        vibrar('erro');
        setTimeout(() => voltarParaScan(), 5000);
        return;
      }

      // Registra check-in
      const now = new Date().toISOString();
      await Promise.all([
        supabase.from('evento_inscricoes')
          .update({ checkin_realizado: true, checkin_at: now })
          .eq('id', inscricao.id),
        supabase.from('evento_checkins')
          .insert([{ evento_id: id, inscricao_id: inscricao.id, metodo: 'qrcode' }]),
      ]);

      setResultado({ estado: 'success', inscricao: { ...inscricao, checkin_realizado: true, checkin_at: now }, nomeSup, nomeCampo });
      emitirSom('sucesso');
      vibrar('sucesso');
      await carregarContadores();
      setTimeout(() => voltarParaScan(), 4000);

    } catch {
      setResultado({ estado: 'invalid' });
      emitirSom('erro');
      vibrar('erro');
      setTimeout(() => voltarParaScan(), 4000);
    } finally {
      setProcessando(false);
    }
  }

  function voltarParaScan() {
    setResultado(null);
    ignorandoRef.current = false;
    if (scannerRef.current) {
      try {
        (scannerRef.current as { resume: () => void }).resume();
      } catch { /* ignora */ }
    }
  }

  // ── Check-in manual ───────────────────────────────────────
  async function fazerCheckinManual(inscricao: Inscricao) {
    if (inscricao.checkin_realizado || processando) return;
    setProcessando(true);
    const now = new Date().toISOString();
    try {
      await Promise.all([
        supabase.from('evento_inscricoes')
          .update({ checkin_realizado: true, checkin_at: now })
          .eq('id', inscricao.id),
        supabase.from('evento_checkins')
          .insert([{ evento_id: id, inscricao_id: inscricao.id, metodo: 'manual' }]),
      ]);
      emitirSom('sucesso');
      vibrar('sucesso');
      setBuscaManual('');
      setResultadosManual([]);
      await carregarContadores();

      // Atualiza estado local
      setResultadosManual(prev =>
        prev.map(i => i.id === inscricao.id ? { ...i, checkin_realizado: true, checkin_at: now } : i)
      );
    } finally {
      setProcessando(false);
    }
  }

  // Busca manual com debounce
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!buscaManual.trim() || buscaManual.length < 2) {
      setResultadosManual([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setBuscandoManual(true);
      const q = buscaManual.trim();
      const cpfLimpo = q.replace(/\D/g, '');
      const { data } = await supabase
        .from('evento_inscricoes')
        .select('id,evento_id,nome_inscrito,cpf,supervisao_id,campo_id,status_pagamento,checkin_realizado,checkin_at,qr_code')
        .eq('evento_id', id)
        .or(
          cpfLimpo.length >= 3
            ? `nome_inscrito.ilike.%${q}%,cpf.ilike.%${cpfLimpo}%`
            : `nome_inscrito.ilike.%${q}%`
        )
        .order('nome_inscrito')
        .limit(20);
      setResultadosManual((data ?? []) as Inscricao[]);
      setBuscandoManual(false);
    }, 350);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [buscaManual, id, supabase]);

  const nomeSup   = (sid: string | null) => supervisoes.find(s => s.id === sid)?.nome ?? '-';
  const nomeCampo = (cid: string | null) => campos.find(c => c.id === cid)?.nome ?? '-';

  // ── Loading / Acesso negado ───────────────────────────────
  if (authLoading || perfil.loading || loadingEvento) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-white text-center">
          <div className="w-10 h-10 border-4 border-white border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-gray-400">Carregando...</p>
        </div>
      </div>
    );
  }

  if (acessoNegado || !evento) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center p-6">
        <div className="text-center max-w-sm">
          <span className="text-6xl mb-4 block">🔒</span>
          <p className="text-white font-bold text-xl mb-2">Acesso não autorizado</p>
          <p className="text-gray-400 text-sm mb-6">Você não tem permissão para este evento.</p>
          <button onClick={() => router.push('/eventos')}
            className="bg-white text-gray-900 px-6 py-3 rounded-xl font-semibold text-sm">
            ← Voltar
          </button>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════
  // OVERLAY DE RESULTADO
  // ═══════════════════════════════════════════════════════════
  const OverlayResultado = () => {
    if (!resultado) return null;
    const { estado, inscricao, nomeSup: ns, nomeCampo: nc } = resultado;

    const configs = {
      success: {
        bg: 'bg-emerald-600',
        icon: '✅',
        titulo: 'CHECK-IN LIBERADO',
        tituloCls: 'text-white text-3xl font-black tracking-wide',
      },
      already: {
        bg: 'bg-red-700',
        icon: '⚠️',
        titulo: 'CHECK-IN JÁ REALIZADO',
        tituloCls: 'text-white text-2xl font-black tracking-wide',
      },
      invalid: {
        bg: 'bg-red-800',
        icon: '❌',
        titulo: 'QR CODE INVÁLIDO',
        tituloCls: 'text-white text-2xl font-black tracking-wide',
      },
      wrong_event: {
        bg: 'bg-orange-700',
        icon: '🚫',
        titulo: 'INSCRIÇÃO NÃO PERTENCE A ESTE EVENTO',
        tituloCls: 'text-white text-xl font-black tracking-wide',
      },
      idle: { bg: '', icon: '', titulo: '', tituloCls: '' },
      processing: { bg: '', icon: '', titulo: '', tituloCls: '' },
    };

    const cfg = configs[estado];

    return (
      <div className={`fixed inset-0 z-50 flex flex-col items-center justify-center p-8 ${cfg.bg}`}
        onClick={voltarParaScan}>
        <span className="text-8xl mb-6 block animate-bounce">{cfg.icon}</span>
        <p className={cfg.tituloCls + ' text-center mb-6'}>{cfg.titulo}</p>

        {inscricao && (estado === 'success' || estado === 'already' || estado === 'wrong_event') && (
          <div className="bg-white/20 rounded-2xl p-6 text-white text-center max-w-sm w-full">
            <p className="text-2xl font-bold mb-1">{inscricao.nome_inscrito}</p>
            {ns && <p className="text-sm opacity-80">{ns}</p>}
            {nc && <p className="text-sm opacity-80">{nc}</p>}
            {estado === 'already' && inscricao.checkin_at && (
              <p className="mt-3 text-sm bg-white/20 rounded-lg px-3 py-2">
                Check-in em: {fmtDT(inscricao.checkin_at)}
              </p>
            )}
          </div>
        )}

        <p className="text-white/60 text-xs mt-8">Toque para continuar</p>
      </div>
    );
  };

  // ═══════════════════════════════════════════════════════════
  // RENDER PRINCIPAL
  // ═══════════════════════════════════════════════════════════
  return (
    <div className="min-h-screen bg-gray-950 flex flex-col text-white">
      <OverlayResultado />

      {/* ── HEADER ──────────────────────────────────────────── */}
      <div className="bg-[#0D2B4E] px-4 py-3 flex items-center justify-between gap-4 flex-shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push(`/eventos/${id}`)}
            className="text-white/70 hover:text-white text-xl leading-none">
            ‹
          </button>
          <div>
            <p className="text-xs text-white/50 leading-none">Check-in</p>
            <p className="font-bold text-sm leading-tight truncate max-w-[180px]">{evento.nome}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-right">
            <p className="text-xs text-white/50 leading-none">Check-ins</p>
            <p className="text-2xl font-black text-emerald-400 leading-tight">{totalCheckins}</p>
          </div>
        </div>
      </div>

      {/* ── MODO MANUAL / CÂMERA toggle ─────────────────────── */}
      <div className="flex border-b border-white/10 flex-shrink-0">
        <button
          onClick={() => { setModoManual(false); setScannerAtivo(true); setBuscaManual(''); setResultadosManual([]); }}
          className={`flex-1 py-3 text-sm font-semibold transition ${!modoManual ? 'text-emerald-400 border-b-2 border-emerald-400' : 'text-white/50'}`}>
          📷 Câmera
        </button>
        <button
          onClick={() => { setModoManual(true); setScannerAtivo(false); setResultado(null); }}
          className={`flex-1 py-3 text-sm font-semibold transition ${modoManual ? 'text-emerald-400 border-b-2 border-emerald-400' : 'text-white/50'}`}>
          🔍 Manual
        </button>
      </div>

      {/* ── ÁREA DE CONTEÚDO ─────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">

        {/* ── MODO CÂMERA ─────────────────────────────────────── */}
        {!modoManual && (
          <div className="flex flex-col items-center">
            {!scannerAtivo ? (
              <div className="flex flex-col items-center justify-center py-16 px-8">
                <span className="text-7xl mb-6">📷</span>
                <p className="text-white/70 text-center mb-8 text-sm">
                  Aponte a câmera para o QR Code do participante
                </p>
                <button
                  onClick={() => setScannerAtivo(true)}
                  className="bg-emerald-500 hover:bg-emerald-400 text-white font-bold py-5 px-12 rounded-2xl text-lg shadow-xl transition active:scale-95">
                  Iniciar Scanner
                </button>
              </div>
            ) : (
              <div className="w-full">
                {/* Região do scanner html5-qrcode */}
                <div id={scannerElementId} className="w-full" />
                <div className="px-4 py-3 flex justify-center">
                  <button
                    onClick={() => { setScannerAtivo(false); }}
                    className="text-sm text-white/50 hover:text-white underline">
                    Parar câmera
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── MODO MANUAL ─────────────────────────────────────── */}
        {modoManual && (
          <div className="px-4 py-4">
            <input
              type="text"
              placeholder="🔍 Buscar por nome ou CPF..."
              value={buscaManual}
              onChange={e => setBuscaManual(e.target.value)}
              autoFocus
              className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-4 text-white placeholder-white/40 text-base focus:outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400"
            />

            {buscandoManual && (
              <div className="flex justify-center mt-6">
                <div className="w-6 h-6 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
              </div>
            )}

            {!buscandoManual && buscaManual.length >= 2 && resultadosManual.length === 0 && (
              <p className="text-white/40 text-center mt-8 text-sm">Nenhum inscrito encontrado</p>
            )}

            <div className="mt-4 space-y-3">
              {resultadosManual.map(ins => (
                <div key={ins.id}
                  className={`rounded-2xl p-4 ${ins.checkin_realizado ? 'bg-emerald-900/40 border border-emerald-700/50' : 'bg-white/10 border border-white/10'}`}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-white text-base truncate">{ins.nome_inscrito}</p>
                      <p className="text-white/50 text-xs mt-0.5">
                        {nomeSup(ins.supervisao_id)} {ins.cpf ? `• CPF: ${ins.cpf}` : ''}
                      </p>
                      <p className="text-white/40 text-xs">{nomeCampo(ins.campo_id)}</p>
                      {ins.checkin_realizado && (
                        <p className="text-emerald-400 text-xs font-semibold mt-1">
                          ✅ Realizado {fmtDT(ins.checkin_at)}
                        </p>
                      )}
                    </div>
                    {!ins.checkin_realizado && (
                      <button
                        onClick={() => fazerCheckinManual(ins)}
                        disabled={processando}
                        className="flex-shrink-0 bg-emerald-500 hover:bg-emerald-400 active:scale-95 text-white font-bold py-3 px-5 rounded-xl text-sm transition disabled:opacity-50">
                        ✅ Check-in
                      </button>
                    )}
                    {ins.checkin_realizado && (
                      <span className="flex-shrink-0 text-emerald-400 text-2xl">✅</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── ÚLTIMOS CHECK-INS ────────────────────────────────── */}
        <div className="px-4 pb-8 mt-2">
          <p className="text-white/40 text-xs font-semibold uppercase tracking-wider mb-3">
            Últimos check-ins
          </p>
          {ultimosCheckins.length === 0 ? (
            <p className="text-white/25 text-sm text-center py-4">Nenhum check-in ainda</p>
          ) : (
            <div className="space-y-2">
              {ultimosCheckins.map((ins, idx) => (
                <div key={ins.id} className="flex items-center gap-3 bg-white/5 rounded-xl px-4 py-3">
                  <span className="text-emerald-400 text-lg font-bold flex-shrink-0 w-7 text-center">
                    {idx + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-semibold truncate">{ins.nome_inscrito}</p>
                    <p className="text-white/40 text-xs">{nomeSup(ins.supervisao_id)} • {nomeCampo(ins.campo_id)}</p>
                  </div>
                  <span className="text-white/30 text-xs flex-shrink-0">{fmtDT(ins.checkin_at)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
