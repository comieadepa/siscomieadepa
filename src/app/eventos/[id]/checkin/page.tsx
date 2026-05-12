'use client';

import { useState, useEffect, useRef, useMemo, useCallback, type FormEvent } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useEventosPerfil } from '@/hooks/useEventosPerfil';
import { useRequireSupabaseAuth } from '@/hooks/useRequireSupabaseAuth';
import { createClient } from '@/lib/supabase-client';
import { clearEquipeSession, getEquipeSession } from '@/lib/equipe-session';
import type { EquipeSession } from '@/lib/equipe-session';
import { authenticatedFetch } from '@/lib/api-client';

// ─── Tipos ────────────────────────────────────────────────────
interface Evento {
  id: string; nome: string; slug: string;
  departamento: string; data_inicio: string; data_fim: string;
  status: 'programado' | 'realizado' | 'cancelado';
  checkin_ativo: boolean | null;
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

type AcessoMotivo = 'nao_autorizado' | 'evento_encerrado' | 'checkin_desativado';

// ─── Helpers ─────────────────────────────────────────────────
const fmtDT = (d: string | null) => {
  if (!d) return '-';
  return new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
};

const PAGAMENTO_LABELS: Record<string, string> = {
  pago: 'Pago',
  isento: 'Isento',
  pendente: 'Pendente',
  cancelado: 'Cancelado',
};

const MIN_BUSCA_MANUAL = 3;
const DEBOUNCE_MANUAL_MS = 400;

function extractQrToken(raw: string): string {
  const value = raw.trim();
  if (!value) return '';
  if (!/^https?:\/\//i.test(value)) return value;

  try {
    const url = new URL(value);
    const fromQuery = url.searchParams.get('qr') || url.searchParams.get('token') || url.searchParams.get('code');
    if (fromQuery) return fromQuery;

    const match = url.pathname.match(/\/qr\/([^/]+)/i);
    if (match?.[1]) return decodeURIComponent(match[1]);

    const parts = url.pathname.split('/').filter(Boolean);
    return parts.length ? decodeURIComponent(parts[parts.length - 1]) : value;
  } catch {
    return value;
  }
}

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
  const params = useParams();
  const id = params?.id as string;
  const { user, loading: authLoading } = useRequireSupabaseAuth({ allowEquipeSession: { eventoId: id }, allowAnonymous: true });
  const perfil = useEventosPerfil();
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [equipeSessao, setEquipeSessao] = useState<EquipeSession | null>(null);
  const [emailAcesso, setEmailAcesso] = useState('');
  const [solicitando, setSolicitando] = useState(false);
  const [gateMsg, setGateMsg] = useState<string | null>(null);
  const [gateMsgTipo, setGateMsgTipo] = useState<'success' | 'error'>('success');
  const [linkSimulado, setLinkSimulado] = useState<string | null>(null);

  const [evento,      setEvento]      = useState<Evento | null>(null);
  const [supervisoes, setSupervisoes] = useState<Supervisao[]>([]);
  const [campos,      setCampos]      = useState<Campo[]>([]);
  const [loadingEvento, setLoadingEvento] = useState(true);
  const [acessoNegado,  setAcessoNegado]  = useState(false);
  const [acessoMotivo,  setAcessoMotivo]  = useState<AcessoMotivo | null>(null);

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
  const [manualMsg,        setManualMsg]        = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const precisaGate = !authLoading && !perfil.loading && !user && !equipeSessao;

  useEffect(() => {
    const sess = getEquipeSession();
    if (sess && sess.eventoId === id) {
      setEquipeSessao(sess);
    } else {
      setEquipeSessao(null);
    }
  }, [id]);

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

  const validarSessaoEquipe = useCallback(async () => {
    if (!equipeSessao || !id) return true;
    try {
      const res = await fetch(`/api/eventos/${id}/checkin/validar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ equipe_id: equipeSessao.equipeId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        const erro = (json?.error as string | undefined) || '';
        if (erro.includes('Convite expirado')) {
          setGateMsg('Link expirado. Solicite novo acesso à organização.');
          setGateMsgTipo('error');
        } else if (erro.includes('Evento encerrado')) {
          setAcessoMotivo('evento_encerrado');
          setAcessoNegado(true);
        } else if (erro.includes('Check-in desativado')) {
          setAcessoMotivo('checkin_desativado');
          setAcessoNegado(true);
        } else {
          setGateMsg('Seu acesso ao check-in foi encerrado. Solicite novo acesso à organização.');
          setGateMsgTipo('error');
        }
        throw new Error('Sessao invalida');
      }
      return true;
    } catch {
      clearEquipeSession();
      setEquipeSessao(null);
      setScannerAtivo(false);
      setAcessoNegado(false);
      setLoadingEvento(false);
      return false;
    }
  }, [equipeSessao, id]);

  // ── Carrega evento e dados base ───────────────────────────
  useEffect(() => {
    if (authLoading || perfil.loading) return;

    if (precisaGate) {
      setLoadingEvento(false);
      return;
    }

    // Gate de acesso
    if (!perfil.isGlobal && id && !perfil.podeAcessarEvento(id)) {
      setAcessoMotivo('nao_autorizado');
      setAcessoNegado(true);
      setLoadingEvento(false);
      return;
    }

    async function load() {
      if (equipeSessao) {
        const ok = await validarSessaoEquipe();
        if (!ok) return;
      }
      const [evRes, estruturaRes] = await Promise.all([
        supabase.from('eventos').select('id,nome,slug,departamento,data_inicio,data_fim,status,checkin_ativo').eq('id', id).single(),
        authenticatedFetch('/api/v1/estrutura'),
      ]);
      if (evRes.data && (evRes.data as Evento).status !== 'programado') {
        setAcessoMotivo('evento_encerrado');
        setAcessoNegado(true);
        setLoadingEvento(false);
        return;
      }
      if (evRes.data && (evRes.data as Evento).checkin_ativo !== true) {
        setAcessoMotivo('checkin_desativado');
        setAcessoNegado(true);
        setLoadingEvento(false);
        return;
      }
      // Gate de departamento: isDeptAdmin só acessa eventos do seu dept
      if (evRes.data && perfil.isDeptAdmin && (evRes.data as Evento).departamento !== perfil.departamentoUsuario) {
        setAcessoMotivo('nao_autorizado');
        setAcessoNegado(true); setLoadingEvento(false); return;
      }
      if (evRes.data) setEvento(evRes.data as Evento);
      if (estruturaRes.ok) {
        const estrutura = await estruturaRes.json().catch(() => null as any);
        setSupervisoes((estrutura?.supervisoes as Supervisao[]) || []);
        setCampos((estrutura?.campos as Campo[]) || []);
      }
      setLoadingEvento(false);
      await carregarContadores();
    }
    load();
  }, [authLoading, perfil.loading, perfil.isGlobal, perfil.isDeptAdmin, perfil.departamentoUsuario, id, supabase, precisaGate, perfil.podeAcessarEvento, carregarContadores, equipeSessao, validarSessaoEquipe]);

  async function solicitarAcesso(e: FormEvent) {
    e.preventDefault();
    setGateMsg(null);
    setGateMsgTipo('success');
    setLinkSimulado(null);
    if (!id) {
      setGateMsg('Evento invalido.');
      setGateMsgTipo('error');
      return;
    }
    const email = emailAcesso.trim().toLowerCase();
    if (!email) {
      setGateMsg('Informe o e-mail autorizado.');
      setGateMsgTipo('error');
      return;
    }

    setSolicitando(true);
    try {
      const res = await fetch(`/api/eventos/${id}/checkin/solicitar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const json = await res.json();
      if (!res.ok) {
        setGateMsg(json.error || 'Erro ao enviar acesso.');
        setGateMsgTipo('error');
        return;
      }
      if (json.simulado && json.link) {
        setGateMsg('Convite gerado (simulacao). Copie o link abaixo.');
        setGateMsgTipo('success');
        setLinkSimulado(json.link);
      } else {
        setGateMsg('Link de acesso enviado para seu e-mail.');
        setGateMsgTipo('success');
      }
    } catch {
      setGateMsg('Erro ao enviar acesso.');
      setGateMsgTipo('error');
    } finally {
      setSolicitando(false);
    }
  }

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
      const qrToken = extractQrToken(qrText);
      if (!qrToken) {
        setResultado({ estado: 'invalid' });
        emitirSom('erro');
        vibrar('erro');
        setTimeout(() => voltarParaScan(), 4000);
        return;
      }

      // Busca inscrição pelo token do QR Code
      const { data: insc } = await supabase
        .from('evento_inscricoes')
        .select('id,evento_id,nome_inscrito,cpf,supervisao_id,campo_id,status_pagamento,checkin_realizado,checkin_at,qr_code')
        .eq('qr_code', qrToken)
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

      if (equipeSessao) {
        const ok = await validarSessaoEquipe();
        if (!ok) {
          ignorandoRef.current = false;
          setResultado(null);
          return;
        }
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
      if (equipeSessao) {
        const ok = await validarSessaoEquipe();
        if (!ok) return;
      }

      const { data, error } = await supabase
        .from('evento_inscricoes')
        .update({ checkin_realizado: true, checkin_at: now })
        .eq('id', inscricao.id)
        .eq('evento_id', id)
        .eq('checkin_realizado', false)
        .in('status_pagamento', ['pago', 'isento'])
        .select('id');

      if (error) {
        setManualMsg('Erro ao realizar check-in.');
        return;
      }

      if (!data || data.length === 0) {
        setManualMsg('Check-in não permitido para pendentes/cancelados ou já realizado.');
        return;
      }

      await supabase
        .from('evento_checkins')
        .insert([{ evento_id: id, inscricao_id: inscricao.id, metodo: 'manual' }]);

      setManualMsg(null);
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
    const qRaw = buscaManual.trim();
    if (manualMsg) setManualMsg(null);
    if (!qRaw || qRaw.length < MIN_BUSCA_MANUAL) {
      setResultadosManual([]);
      setBuscandoManual(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setBuscandoManual(true);
      try {
        const q = qRaw;
        const cpfLimpo = q.replace(/\D/g, '');
        const filtros = [
          `nome_inscrito.ilike.%${q}%`,
          `email.ilike.%${q}%`,
          `whatsapp.ilike.%${q}%`,
        ];
        if (cpfLimpo.length >= MIN_BUSCA_MANUAL) {
          filtros.push(`cpf.ilike.%${cpfLimpo}%`);
          filtros.push(`whatsapp.ilike.%${cpfLimpo}%`);
        }
        const { data } = await supabase
          .from('evento_inscricoes')
          .select('id,evento_id,nome_inscrito,cpf,supervisao_id,campo_id,status_pagamento,checkin_realizado,checkin_at,qr_code')
          .eq('evento_id', id)
          .in('status_pagamento', ['pago', 'isento'])
          .or(filtros.join(','))
          .order('nome_inscrito')
          .limit(20);
        setResultadosManual((data ?? []) as Inscricao[]);
      } finally {
        setBuscandoManual(false);
      }
    }, DEBOUNCE_MANUAL_MS);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [buscaManual, id, supabase]);

  const nomeSup   = (sid: string | null) => supervisoes.find(s => s.id === sid)?.nome ?? '-';
  const nomeCampo = (cid: string | null) => campos.find(c => c.id === cid)?.nome ?? '-';

  // ── Loading / Acesso negado ───────────────────────────────
  if (acessoNegado || !evento) {
    const mensagens: Record<AcessoMotivo, { titulo: string; corpo: string }> = {
      nao_autorizado: {
        titulo: 'Acesso não autorizado',
        corpo: 'Você não tem permissão para este evento.',
      },
      evento_encerrado: {
        titulo: 'Evento encerrado',
        corpo: 'Este evento foi finalizado ou cancelado.',
      },
      checkin_desativado: {
        titulo: 'Check-in desativado',
        corpo: 'O check-in deste evento ainda não foi iniciado. Aguarde a liberação pela organização.',
      },
    };

    const msg = mensagens[acessoMotivo || 'nao_autorizado'];

    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center p-6">
        <div className="text-center max-w-sm">
          <span className="text-6xl mb-4 block">🔒</span>
          <p className="text-white font-bold text-xl mb-2">{msg.titulo}</p>
          <p className="text-gray-400 text-sm mb-6">{msg.corpo}</p>
          <button onClick={() => router.push('/eventos')}
            className="bg-white text-gray-900 px-6 py-3 rounded-xl font-semibold text-sm">
            ← Voltar
          </button>
        </div>
      </div>
    );
  }

  if (precisaGate) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 w-full max-w-md text-center text-gray-800">
          <div className="text-3xl mb-3">🔐</div>
          <h1 className="text-lg font-bold text-[#123b63]">Acesso ao Check-in</h1>
          <p className="text-sm text-gray-500 mt-2">Informe o e-mail autorizado para receber o link de acesso.</p>

          <form onSubmit={solicitarAcesso} className="mt-4 space-y-3">
            <input
              type="email"
              placeholder="email@exemplo.com"
              value={emailAcesso}
              onChange={e => setEmailAcesso(e.target.value)}
              className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#123b63]"
              required
            />
            <button
              type="submit"
              disabled={solicitando}
              className="w-full bg-[#123b63] text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-[#0f2a45] transition disabled:opacity-50">
              {solicitando ? 'Enviando...' : 'Enviar link de acesso'}
            </button>
          </form>

          {gateMsg && (
            <div className={`mt-4 text-sm rounded-lg px-3 py-2 border ${gateMsgTipo === 'error'
              ? 'text-red-700 bg-red-50 border-red-200'
              : 'text-emerald-700 bg-emerald-50 border-emerald-200'}`}>
              {gateMsg}
            </div>
          )}
          {linkSimulado && (
            <div className="mt-3 flex gap-2 items-center">
              <input
                readOnly
                value={linkSimulado}
                className="flex-1 min-w-0 border border-gray-200 rounded-lg px-3 py-2 text-xs font-mono"
              />
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(linkSimulado)}
                className="text-xs px-3 py-2 rounded-lg bg-emerald-600 text-white font-semibold hover:bg-emerald-700 transition">
                Copiar
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

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
          <button onClick={() => router.push('/eventos')}
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
              placeholder="🔍 Buscar por nome, CPF, WhatsApp ou e-mail..."
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

            {manualMsg && (
              <p className="text-amber-400 text-center mt-4 text-sm font-semibold">{manualMsg}</p>
            )}

            {!buscandoManual && buscaManual.trim().length > 0 && buscaManual.trim().length < MIN_BUSCA_MANUAL && (
              <p className="text-white/40 text-center mt-6 text-sm">Digite pelo menos 3 caracteres para buscar.</p>
            )}

            {!buscandoManual && buscaManual.trim().length >= MIN_BUSCA_MANUAL && resultadosManual.length === 0 && (
              <p className="text-white/40 text-center mt-6 text-sm">Não encontramos inscritos confirmados com esse termo.</p>
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
                      <p className="text-white/50 text-xs mt-1">
                        Pagamento: <span className="font-semibold">{PAGAMENTO_LABELS[ins.status_pagamento] ?? ins.status_pagamento}</span>
                        {' · '}Check-in: <span className="font-semibold">{ins.checkin_realizado ? 'Realizado' : 'Pendente'}</span>
                      </p>
                      {ins.checkin_realizado && (
                        <p className="text-emerald-400 text-xs font-semibold mt-1">
                          ✅ Check-in já realizado em {fmtDT(ins.checkin_at)}
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
