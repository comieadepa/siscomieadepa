'use client';

import { useState, useEffect, useRef, useMemo, useCallback, type FormEvent } from 'react';
import { useRouter, useParams, usePathname, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase-client';
import { clearEquipeSession, getEquipeSession, setEquipeSession } from '@/lib/equipe-session';
import type { EquipeSession } from '@/lib/equipe-session';
import { authenticatedFetch } from '@/lib/api-client';
import {
  Menu,
  X,
  Flashlight,
  QrCode,
  Calendar,
  MapPin,
  Utensils,
  Users,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  Search,
  User,
  Ticket,
  FileText,
  LogOut,
  ChevronRight,
  ShieldCheck,
  Square,
  Play,
  Check,
  ChevronLeft,
} from 'lucide-react';

// ─── Tipos ────────────────────────────────────────────────────
interface Evento {
  id: string;
  nome: string;
  slug: string;
  departamento: string;
  data_inicio: string;
  data_fim: string;
  status: 'programado' | 'realizado' | 'cancelado';
  checkin_ativo: boolean | null;
  valor_inscricao?: number | null;
}

interface Inscricao {
  id: string;
  evento_id: string;
  nome_inscrito: string;
  cpf: string | null;
  supervisao_id: string | null;
  campo_id: string | null;
  status_pagamento: string;
  checkin_realizado: boolean;
  checkin_at: string | null;
  qr_code: string | null;
  tipo_inscricao?: string | null;
  valor_final?: number | null;
  valor_pago?: number | null;
  foto_url?: string | null;
  matricula?: string | null;
  cargo_ministerial?: string | null;
  alimentacao?: boolean | null;
  hospedagem?: boolean | null;
}

interface Supervisao { id: string; nome: string; }
interface Campo      { id: string; nome: string; }

type EstadoScan =
  | 'idle'
  | 'processing'
  | 'success'
  | 'already'
  | 'invalid'
  | 'wrong_event'
  | 'sem_alimentacao'
  | 'pagamento_pendente'
  | 'duplicate_rapida'
  | 'sem_saldo'
  | 'already_plenaria';

interface ResultadoScan {
  estado: EstadoScan;
  inscricao?: Inscricao;
  nomeSup?: string;
  nomeCampo?: string;
  saldoRestante?: number | null;
  dataPlenaria?: string;
  message?: string;
  bloqueadoMotivo?: string;
}

interface PendingConfirm {
  inscricao: Inscricao & {
    foto_url?: string | null;
    matricula?: string | null;
    cargo_ministerial?: string | null;
    tipo_inscricao?: string | null;
    alimentacao?: boolean | null;
    hospedagem?: boolean | null;
    quantidade_refeicoes_total?: number | null;
    quantidade_refeicoes_usadas?: number | null;
    quantidade_refeicoes_saldo?: number | null;
  };
  qrToken: string;
  nomeSup: string;
  nomeCampo: string;
  contexto: {
    modo: string;
    data_plenaria: string;
    sessao: string | null;
    plenaria_hoje: boolean;
    plenaria_hoje_at: string | null;
    plenaria_hoje_operador: string | null;
    plenaria_ultimo_at: string | null;
    plenaria_ultimo_data: string | null;
    ja_presente_plenaria: boolean;
    apto_checkin?: boolean;
    pagamento_pendente: boolean;
    sem_alimentacao: boolean;
    refeicoes_total: number;
    refeicoes_usadas: number;
    refeicoes_saldo: number;
  };
}

type AcessoMotivo = 'nao_autorizado' | 'evento_encerrado' | 'checkin_desativado';

// ─── Helpers ─────────────────────────────────────────────────
const fmtDT = (d: string | null) => {
  if (!d) return '-';
  try {
    return new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return d;
  }
};

const fmtHora = (d: string | null) => {
  if (!d) return '';
  try {
    return new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
};

const maskCpf = (cpf: string | null | undefined): string => {
  if (!cpf) return '';
  const clean = cpf.replace(/\D/g, '');
  if (clean.length === 11) {
    return `***.${clean.slice(3, 6)}.${clean.slice(6, 9)}-**`;
  }
  return cpf;
};

const formatEventoPeriodo = (inicio?: string, fim?: string, local?: string) => {
  if (!inicio) return local || '';
  try {
    const dIni = new Date(inicio);
    const dFim = fim ? new Date(fim) : null;
    const diaIni = String(dIni.getUTCDate()).padStart(2, '0');
    const mesIni = String(dIni.getUTCMonth() + 1).padStart(2, '0');
    const ano = dFim ? dFim.getUTCFullYear() : dIni.getUTCFullYear();
    let str = `${diaIni}/${mesIni}`;
    if (dFim) {
      const diaFim = String(dFim.getUTCDate()).padStart(2, '0');
      const mesFim = String(dFim.getUTCMonth() + 1).padStart(2, '0');
      str += ` a ${diaFim}/${mesFim}/${ano}`;
    } else {
      str += `/${ano}`;
    }
    return local ? `${str} · ${local}` : str;
  } catch {
    return local || '';
  }
};

const PAGAMENTO_LABELS: Record<string, string> = {
  pago: 'PAGO',
  isento: 'ISENTO',
  pendente: 'PENDENTE',
  cancelado: 'CANCELADO',
};

const MIN_BUSCA_MANUAL = 3;
const DEBOUNCE_MANUAL_MS = 350;

function extractQrToken(raw: string): string | null {
  const value = decodeURIComponent(raw.trim()).trim();
  if (!value) return null;

  if (!/^https?:\/\//i.test(value)) {
    return value || null;
  }

  try {
    const url = new URL(value);
    const fromQuery =
      url.searchParams.get('token') ||
      url.searchParams.get('id') ||
      url.searchParams.get('qr') ||
      url.searchParams.get('code');
    if (fromQuery) return fromQuery.trim();

    const match = url.pathname.match(/\/qr\/([^/?#]+)/i);
    if (match?.[1]) return decodeURIComponent(match[1]).trim();

    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length) return decodeURIComponent(parts[parts.length - 1]).trim();

    return null;
  } catch {
    return value;
  }
}

function emitirSom(tipo: 'sucesso' | 'erro' | 'leitura') {
  try {
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    if (tipo === 'sucesso') {
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.setValueAtTime(1100, ctx.currentTime + 0.1);
    } else if (tipo === 'erro') {
      osc.frequency.setValueAtTime(220, ctx.currentTime);
      osc.frequency.setValueAtTime(180, ctx.currentTime + 0.1);
    } else {
      osc.frequency.setValueAtTime(700, ctx.currentTime);
    }
    const volume = tipo === 'leitura' ? 0.6 : 0.3;
    const duracao = tipo === 'leitura' ? 0.6 : 0.4;
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duracao);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duracao);
  } catch {
    // Silencioso se AudioContext indisponível
  }
}

function vibrar(tipo: 'sucesso' | 'erro') {
  if (!navigator.vibrate) return;
  if (tipo === 'sucesso') navigator.vibrate([100, 50, 100]);
  else navigator.vibrate([200, 100, 200, 100, 200]);
}

// ─── Componente Principal ─────────────────────────────────────
export default function CheckinMobilePage() {
  const params = useParams();
  const id = params?.id as string;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const supabase = useMemo(() => createClient(), []);

  // Sessão de equipe e gate de acesso
  const [equipeSessao, setEquipeSessao] = useState<EquipeSession | null>(null);
  const [emailAcesso, setEmailAcesso] = useState('');
  const [solicitando, setSolicitando] = useState(false);
  const [gateMsg, setGateMsg] = useState<string | null>(null);
  const [gateMsgTipo, setGateMsgTipo] = useState<'success' | 'error'>('success');

  // Evento e estrutura
  const [evento, setEvento] = useState<Evento | null>(null);
  const [supervisoes, setSupervisoes] = useState<Supervisao[]>([]);
  const [campos, setCampos] = useState<Campo[]>([]);
  const [loadingEvento, setLoadingEvento] = useState(true);
  const [acessoNegado, setAcessoNegado] = useState(false);
  const [acessoMotivo, setAcessoMotivo] = useState<AcessoMotivo | null>(null);

  // Contadores e histórico
  const [totalCheckins, setTotalCheckins] = useState(0);
  const [ultimosCheckins, setUltimosCheckins] = useState<Inscricao[]>([]);

  // Modos de visualização e drawers
  const [modoCheckin, setModoCheckin] = useState<'credenciamento' | 'plenaria' | 'refeitorio'>('credenciamento');
  const [modoManual, setModoManual] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [historicoOpen, setHistoricoOpen] = useState(false);

  // Modo forçado por URL
  const modoForcado = useMemo<'credenciamento' | 'plenaria' | 'refeitorio' | null>(() => {
    if (pathname?.endsWith('/checkin/credenciamento')) return 'credenciamento';
    if (pathname?.endsWith('/checkin/plenaria')) return 'plenaria';
    if (pathname?.endsWith('/checkin/refeitorio')) return 'refeitorio';
    const modoParam = searchParams?.get('modo');
    if (modoParam === 'credenciamento' || modoParam === 'plenaria' || modoParam === 'refeitorio') return modoParam;
    return null;
  }, [pathname, searchParams]);

  useEffect(() => {
    if (modoForcado) setModoCheckin(modoForcado);
  }, [modoForcado]);

  // Scanner de Câmera
  const [scannerAtivo, setScannerAtivo] = useState(false);
  const [resultado, setResultado] = useState<ResultadoScan | null>(null);
  const [processando, setProcessando] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [cameraMsg, setCameraMsg] = useState<string | null>(null);

  const scannerRef = useRef<unknown>(null);
  const scannerElementId = 'qr-scanner-region';
  const ignorandoRef = useRef(false);
  const lastTokenRef = useRef<{ token: string; at: number } | null>(null);
  const cameraErroRef = useRef<string | null>(null);
  const iniciandoRef = useRef(false);

  // Busca Manual
  const [buscaManual, setBuscaManual] = useState('');
  const [resultadosManual, setResultadosManual] = useState<Inscricao[]>([]);
  const [buscandoManual, setBuscandoManual] = useState(false);
  const [manualMsg, setManualMsg] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [verificandoSessao, setVerificandoSessao] = useState(true);
  const precisaGate = !verificandoSessao && !equipeSessao;

  // ── Verifica Sessão da Equipe ──────────────────────────────
  useEffect(() => {
    const sess = getEquipeSession();
    if (sess && sess.eventoId === id && (sess.tipo === 'checkin' || sess.tipo === 'checkin_refeitorio' || sess.tipo === 'operador')) {
      setEquipeSessao(sess);
    } else {
      setEquipeSessao(null);
    }
    setVerificandoSessao(false);
  }, [id]);

  const carregarContadores = useCallback(async () => {
    if (!id) return;
    try {
      const { data, count } = await supabase
        .from('evento_inscricoes')
        .select('id,nome_inscrito,cpf,supervisao_id,campo_id,status_pagamento,checkin_realizado,checkin_at,qr_code,evento_id,tipo_inscricao,foto_url', { count: 'exact' })
        .eq('evento_id', id)
        .eq('checkin_realizado', true)
        .order('checkin_at', { ascending: false })
        .limit(25);
      setTotalCheckins(count ?? 0);
      setUltimosCheckins((data ?? []) as Inscricao[]);
    } catch (err) {
      console.warn('Erro ao carregar contadores:', err);
    }
  }, [id, supabase]);

  const validarSessaoEquipe = useCallback(async (sess: EquipeSession): Promise<Evento | null> => {
    if (!sess || !id) return null;
    try {
      const res = await fetch(`/api/eventos/${id}/checkin/validar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ equipe_id: sess.equipeId, area: modoCheckin === 'refeitorio' ? 'refeitorio' : 'checkin' }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        const erro = (json?.error as string | undefined) || '';
        if (erro.includes('Evento encerrado')) {
          setAcessoMotivo('evento_encerrado');
          setAcessoNegado(true);
        } else if (erro.includes('Check-in desativado')) {
          setAcessoMotivo('checkin_desativado');
          setAcessoNegado(true);
        } else if (erro.toLowerCase().includes('nao autorizado')) {
          setGateMsg('E-mail não autorizado para este evento.');
          setGateMsgTipo('error');
        } else {
          setGateMsg('Seu acesso ao check-in foi encerrado.');
          setGateMsgTipo('error');
        }
        throw new Error('Sessao invalida');
      }
      return (json?.evento as Evento) || null;
    } catch {
      clearEquipeSession();
      setEquipeSessao(null);
      setScannerAtivo(false);
      setAcessoNegado(false);
      setLoadingEvento(false);
      return null;
    }
  }, [id, modoCheckin]);

  // ── Carrega Evento e Estrutura ─────────────────────────────
  useEffect(() => {
    if (verificandoSessao) return;

    if (precisaGate) {
      setLoadingEvento(false);
      return;
    }

    async function load() {
      let eventoEquipe: Evento | null = null;
      if (equipeSessao) {
        eventoEquipe = await validarSessaoEquipe(equipeSessao);
        if (!eventoEquipe) return;
      }
      const [evRes, estruturaRes] = await Promise.all([
        eventoEquipe
          ? Promise.resolve({ data: eventoEquipe })
          : supabase.from('eventos').select('id,nome,slug,departamento,data_inicio,data_fim,status,checkin_ativo,valor_inscricao').eq('id', id).single(),
        authenticatedFetch('/api/v1/estrutura'),
      ]);
      const eventoData = (evRes as { data?: Evento | null }).data ?? null;
      if (eventoData && eventoData.status !== 'programado') {
        setAcessoMotivo('evento_encerrado');
        setAcessoNegado(true);
        setLoadingEvento(false);
        return;
      }
      if (eventoData && eventoData.checkin_ativo !== true) {
        setAcessoMotivo('checkin_desativado');
        setAcessoNegado(true);
        setLoadingEvento(false);
        return;
      }
      if (eventoData) setEvento(eventoData);
      if (estruturaRes.ok) {
        const estrutura = await estruturaRes.json().catch(() => null as any);
        setSupervisoes((estrutura?.supervisoes as Supervisao[]) || []);
        setCampos((estrutura?.campos as Campo[]) || []);
      }
      setLoadingEvento(false);
      await carregarContadores();
    }
    load();
  }, [verificandoSessao, id, supabase, precisaGate, carregarContadores, equipeSessao, validarSessaoEquipe]);

  // ── Solicita Acesso Equipe ─────────────────────────────────
  async function solicitarAcesso(e: FormEvent) {
    e.preventDefault();
    setGateMsg(null);
    setGateMsgTipo('success');
    if (!id) {
      setGateMsg('Evento inválido.');
      setGateMsgTipo('error');
      return;
    }
    const email = emailAcesso.trim().toLowerCase();
    if (!email) {
      setGateMsg('Informe o e-mail cadastrado.');
      setGateMsgTipo('error');
      return;
    }
    if (!/\S+@\S+\.\S+/.test(email)) {
      setGateMsg('E-mail inválido.');
      setGateMsgTipo('error');
      return;
    }

    setSolicitando(true);
    try {
      const res = await fetch(`/api/eventos/${id}/checkin/solicitar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          funcao: modoCheckin === 'refeitorio' ? 'checkin_refeitorio' : 'checkin',
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setGateMsg(json.error || 'Erro ao enviar acesso.');
        setGateMsgTipo('error');
        return;
      }
      const expiraEm = json.expira_em || new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
      const sessao: EquipeSession = {
        eventoId: id,
        equipeId: json.equipe_id,
        tipo: 'checkin',
        expiraEm,
        email,
      };
      setEquipeSession(sessao);
      setEquipeSessao(sessao);
      setAcessoNegado(false);
      setAcessoMotivo(null);
      setLoadingEvento(true);
      setEmailAcesso('');
      setGateMsg('Acesso liberado. Abrindo check-in...');
      setGateMsgTipo('success');
    } catch {
      setGateMsg('Erro ao validar acesso.');
      setGateMsgTipo('error');
    } finally {
      setSolicitando(false);
    }
  }

  // ── Controle de Câmera e Lanterna ─────────────────────────
  const stopScanner = useCallback(async (atualizarEstado = true) => {
    if (scannerRef.current) {
      const inst = scannerRef.current as { stop?: () => Promise<void>; clear?: () => Promise<void> };
      scannerRef.current = null;
      try { if (inst.stop) await inst.stop(); } catch { /* ignora */ }
      try { if (inst.clear) await inst.clear(); } catch { /* ignora */ }
    }
    cameraErroRef.current = null;
    setTorchOn(false);
    if (atualizarEstado) setScannerAtivo(false);
  }, []);

  const toggleTorch = async () => {
    try {
      const video = document.querySelector<HTMLVideoElement>('#qr-scanner-region video');
      if (video?.srcObject) {
        const stream = video.srcObject as MediaStream;
        const track = stream.getVideoTracks()[0];
        if (track) {
          const caps = (track.getCapabilities?.() || {}) as { torch?: boolean };
          if (caps.torch) {
            const proximo = !torchOn;
            await track.applyConstraints({
              advanced: [{ torch: proximo } as MediaTrackConstraintSet],
            });
            setTorchOn(proximo);
            return;
          }
        }
      }
    } catch (e) {
      console.warn('Erro ao acionar lanterna:', e);
    }
    setTorchOn(prev => !prev);
  };

  async function iniciarScanner() {
    if (iniciandoRef.current) return;
    iniciandoRef.current = true;
    setCameraMsg(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraMsg('Seu navegador não suporta acesso à câmera.');
      iniciandoRef.current = false;
      return;
    }
    try {
      setScannerAtivo(true);
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

      const { Html5Qrcode } = await import('html5-qrcode');
      if (!document.getElementById(scannerElementId)) {
        setCameraMsg('Área da câmera não encontrada.');
        await stopScanner();
        iniciandoRef.current = false;
        return;
      }

      const html5 = new Html5Qrcode(scannerElementId);
      scannerRef.current = html5;

      const onScanError = (err: unknown) => {
        const msg = String(err || '').trim();
        if (!msg) return;
        const lower = msg.toLowerCase();
        if (
          lower.includes('notfound') ||
          lower.includes('no multiformat') ||
          lower.includes('parse error') ||
          lower.includes('checksum') ||
          lower.includes('format exception')
        ) {
          return;
        }
        if (cameraErroRef.current === msg) return;
        cameraErroRef.current = msg;
        setCameraMsg(`Erro ao abrir a câmera: ${msg}`);
      };

      await html5.start(
        { facingMode: 'environment' },
        {
          fps: 10,
          qrbox: { width: 260, height: 260 },
          aspectRatio: 1.0,
        },
        onQRCodeSuccess,
        onScanError
      );
    } catch (err) {
      const msg = String(err || '').trim();
      const finalMsg = msg ? `Erro ao abrir a câmera: ${msg}` : 'Erro ao abrir a câmera.';
      setCameraMsg(finalMsg);
      await stopScanner();
    } finally {
      iniciandoRef.current = false;
    }
  }

  useEffect(() => {
    return () => { void stopScanner(false); };
  }, [stopScanner]);

  // ── Auto-start scanner ao carregar ─────────────────────────
  useEffect(() => {
    if (!loadingEvento && !acessoNegado && !precisaGate && !modoManual && !scannerAtivo) {
      void iniciarScanner();
    }
  }, [loadingEvento, acessoNegado, precisaGate, modoManual]);

  // ── FASE 1: Leitura QR → Lookup com Validação Backend ───────
  async function consultarInscricao(tokenOuId: string) {
    if (ignorandoRef.current || processando || pendingConfirm) return;

    ignorandoRef.current = true;
    setProcessando(true);
    emitirSom('leitura');

    if (scannerRef.current) {
      try { await (scannerRef.current as { pause: () => void }).pause(); } catch { /* ignora */ }
    }

    try {
      const dataPlenaria = new Date().toISOString().slice(0, 10);
      const params = new URLSearchParams({
        token: tokenOuId,
        modo: modoCheckin,
        data_plenaria: dataPlenaria,
      });
      const headers: Record<string, string> = {};
      if (equipeSessao?.equipeId) headers['x-evento-equipe-id'] = equipeSessao.equipeId;

      const res = await fetch(`/api/eventos/${id}/checkin/lookup?${params}`, { headers });
      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        setResultado({
          estado: 'invalid',
          message: json?.message || 'QR Code não reconhecido ou inválido.',
          bloqueadoMotivo: json?.message || 'Não foi possível validar esta credencial no sistema.',
        });
        emitirSom('erro');
        vibrar('erro');
        return;
      }

      const status: string = json?.status ?? 'not_found';

      if (status === 'not_found') {
        setResultado({
          estado: 'invalid',
          message: json?.message || 'Inscrição não localizada para este QR Code.',
          bloqueadoMotivo: 'Esta credencial não foi localizada no cadastro do evento.',
        });
        emitirSom('erro');
        vibrar('erro');
        return;
      }

      if (status === 'wrong_event') {
        const ins = json?.inscricao as Inscricao;
        setResultado({
          estado: 'wrong_event',
          inscricao: ins,
          message: 'Inscrição não pertence a este evento.',
          bloqueadoMotivo: 'Esta credencial pertence a outro evento da COMIEADEPA.',
        });
        emitirSom('erro');
        vibrar('erro');
        return;
      }

      const ins = json?.inscricao as PendingConfirm['inscricao'];
      const ctx = json?.contexto as PendingConfirm['contexto'];
      const nomeSup   = supervisoes.find(s => s.id === ins.supervisao_id)?.nome ?? '-';
      const nomeCampo = campos.find(c => c.id === ins.campo_id)?.nome ?? '-';

      // ── Bloqueio 1: Pagamento Pendente / Cancelado ──────────
      if (ctx.pagamento_pendente || String(ins.status_pagamento || '').toLowerCase() === 'cancelado') {
        setResultado({
          estado: 'pagamento_pendente',
          inscricao: ins,
          nomeSup,
          nomeCampo,
          bloqueadoMotivo: ctx.pagamento_pendente
            ? 'Aguarde a confirmação do pagamento para liberar o acesso.'
            : 'Esta inscrição foi cancelada no sistema.',
        });
        emitirSom('erro');
        vibrar('erro');
        return;
      }

      // ── Bloqueio 2: Check-in já realizado (Entrada) ─────────
      if (modoCheckin === 'credenciamento' && ins.checkin_realizado) {
        setResultado({
          estado: 'already',
          inscricao: ins,
          nomeSup,
          nomeCampo,
          bloqueadoMotivo: `Check-in de entrada já realizado em ${fmtDT(ins.checkin_at)}.`,
        });
        emitirSom('erro');
        vibrar('erro');
        return;
      }

      // ── Bloqueio 3: Presença já registrada hoje (Plenária) ───
      if (modoCheckin === 'plenaria' && ctx.plenaria_hoje) {
        setResultado({
          estado: 'already_plenaria',
          inscricao: ins,
          nomeSup,
          nomeCampo,
          dataPlenaria: ctx.data_plenaria,
          bloqueadoMotivo: `Participante já registrou presença nesta plenária${ctx.plenaria_hoje_operador ? ` por ${ctx.plenaria_hoje_operador}` : ''}.`,
        });
        emitirSom('erro');
        vibrar('erro');
        return;
      }

      // ── Bloqueio 4: Sem alimentação ou sem saldo (Refeitório) 
      if (modoCheckin === 'refeitorio' && (ctx.sem_alimentacao || ctx.refeicoes_saldo <= 0)) {
        setResultado({
          estado: ctx.sem_alimentacao ? 'sem_alimentacao' : 'sem_saldo',
          inscricao: ins,
          nomeSup,
          nomeCampo,
          saldoRestante: ctx.refeicoes_saldo,
          bloqueadoMotivo: ctx.sem_alimentacao
            ? 'Esta inscrição não possui alimentação inclusa.'
            : 'Inscrição sem saldo de refeições disponíveis.',
        });
        emitirSom('erro');
        vibrar('erro');
        return;
      }

      // ── Habilitado: Exibe Tela de Participante Encontrado ───
      setPendingConfirm({
        inscricao: ins,
        qrToken: tokenOuId,
        nomeSup,
        nomeCampo,
        contexto: ctx,
      });

    } catch {
      setResultado({
        estado: 'invalid',
        message: 'Erro de conexão ao consultar inscrição.',
        bloqueadoMotivo: 'Falha de comunicação com o servidor de check-in.',
      });
      emitirSom('erro');
      vibrar('erro');
    } finally {
      setProcessando(false);
    }
  }

  async function onQRCodeSuccess(qrText: string) {
    if (ignorandoRef.current || processando || pendingConfirm || resultado) return;

    const rawText = String(qrText || '').trim();
    const qrToken = extractQrToken(rawText);

    if (qrToken && lastTokenRef.current) {
      const deltaMs = Date.now() - lastTokenRef.current.at;
      if (lastTokenRef.current.token === qrToken && deltaMs < 3000) return;
    }
    if (qrToken) lastTokenRef.current = { token: qrToken, at: Date.now() };

    if (!qrToken) {
      setResultado({
        estado: 'invalid',
        message: 'QR Code não reconhecido.',
        bloqueadoMotivo: 'Código lido não possui formato válido de credencial.',
      });
      emitirSom('erro');
      vibrar('erro');
      return;
    }

    await consultarInscricao(qrToken);
  }

  // ── FASE 2: Confirmação Efetiva no Backend ───────────────────
  async function confirmarCheckin() {
    if (!pendingConfirm || confirmando) return;
    setConfirmando(true);

    const { inscricao, qrToken, nomeSup, nomeCampo, contexto } = pendingConfirm;

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (equipeSessao?.equipeId) headers['x-evento-equipe-id'] = equipeSessao.equipeId;

      const res = await fetch(`/api/eventos/${id}/checkin/registrar`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          qr: qrToken,
          equipe_id: equipeSessao?.equipeId,
          tipo_checkin: modoCheckin,
          data_plenaria: contexto.data_plenaria,
          sessao: contexto.sessao,
        }),
      });
      const json = await res.json().catch(() => ({}));

      setPendingConfirm(null);

      if (!res.ok) {
        setResultado({
          estado: 'invalid',
          inscricao,
          nomeSup,
          nomeCampo,
          bloqueadoMotivo: json?.message || 'Erro ao registrar check-in no sistema.',
        });
        emitirSom('erro');
        vibrar('erro');
        return;
      }

      const status = (json?.status as EstadoScan | undefined) ?? 'invalid';

      if (status === 'already' || status === 'already_plenaria') {
        setResultado({
          estado: status,
          inscricao,
          nomeSup,
          nomeCampo,
          dataPlenaria: json?.data_plenaria,
          bloqueadoMotivo: status === 'already'
            ? 'Check-in de entrada já havia sido realizado anteriormente.'
            : 'Presença já registrada para este participante nesta sessão.',
        });
        emitirSom('erro');
        vibrar('erro');
        return;
      }

      if (status === 'sem_saldo' || status === 'sem_alimentacao' || status === 'pagamento_pendente' || status === 'duplicate_rapida') {
        setResultado({
          estado: status,
          inscricao,
          nomeSup,
          nomeCampo,
          saldoRestante: json?.saldo_depois ?? null,
          bloqueadoMotivo: status === 'pagamento_pendente'
            ? 'Aguarde a confirmação do pagamento para liberar o acesso.'
            : status === 'sem_saldo'
              ? 'Inscrição sem saldo de refeições disponíveis.'
              : status === 'duplicate_rapida'
                ? 'Check-in repetido em menos de 10 segundos. Aguarde um instante.'
                : 'Esta inscrição não inclui alimentação.',
        });
        emitirSom('erro');
        vibrar('erro');
        return;
      }

      // Sucesso Real Confirmado pelo Backend!
      setResultado({
        estado: 'success',
        inscricao: json?.inscricao ?? inscricao,
        nomeSup,
        nomeCampo,
        saldoRestante: json?.saldo_depois ?? null,
      });
      emitirSom('sucesso');
      vibrar('sucesso');
      void carregarContadores();

    } catch {
      setPendingConfirm(null);
      setResultado({
        estado: 'invalid',
        message: 'Erro de conexão ao confirmar check-in.',
        bloqueadoMotivo: 'Falha de comunicação com o servidor ao confirmar.',
      });
      emitirSom('erro');
      vibrar('erro');
    } finally {
      setConfirmando(false);
    }
  }

  function voltarParaScan() {
    setResultado(null);
    setPendingConfirm(null);
    ignorandoRef.current = false;
    if (scannerRef.current) {
      try { (scannerRef.current as { resume: () => void }).resume(); } catch { /* ignora */ }
    }
  }

  function cancelarConfirmacao() {
    setPendingConfirm(null);
    voltarParaScan();
  }

  // ── Busca Manual com Debounce ──────────────────────────────
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
        ];
        if (cpfLimpo.length >= MIN_BUSCA_MANUAL) {
          filtros.push(`cpf.ilike.%${cpfLimpo}%`);
        }
        const { data } = await supabase
          .from('evento_inscricoes')
          .select('id,evento_id,nome_inscrito,cpf,supervisao_id,campo_id,status_pagamento,checkin_realizado,checkin_at,qr_code,tipo_inscricao,valor_final,valor_pago,foto_url,alimentacao,hospedagem')
          .eq('evento_id', id)
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

  // ── Render: Gate de Acesso Equipe ──────────────────────────
  if (precisaGate) {
    return (
      <div className="min-h-screen bg-[#08101E] flex items-center justify-center p-6 text-white font-sans">
        <div className="bg-[#0F1E36] border border-white/10 rounded-3xl shadow-2xl p-8 w-full max-w-md text-center">
          <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto mb-5 shadow-[0_0_20px_rgba(16,185,129,0.2)]">
            <ShieldCheck className="w-8 h-8" />
          </div>
          <h1 className="text-xl font-bold text-white tracking-wide">Acesso ao Check-in</h1>
          <p className="text-xs text-slate-400 mt-2 leading-relaxed">
            Informe o e-mail cadastrado na equipe do evento para liberar o terminal de leitura.
          </p>

          <form onSubmit={solicitarAcesso} className="mt-6 space-y-4">
            <input
              type="email"
              placeholder="seu-email@exemplo.com"
              value={emailAcesso}
              onChange={e => setEmailAcesso(e.target.value)}
              className="w-full bg-[#08101E] border border-white/15 rounded-2xl px-4 py-3.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400 text-center transition"
              required
            />
            <button
              type="submit"
              disabled={solicitando}
              className="w-full bg-emerald-500 hover:bg-emerald-400 active:scale-95 text-white py-3.5 rounded-2xl text-sm font-bold shadow-lg shadow-emerald-500/25 transition disabled:opacity-50">
              {solicitando ? 'Validando acesso...' : 'Liberar terminal'}
            </button>
          </form>

          {gateMsg && (
            <div className={`mt-5 text-xs rounded-xl px-4 py-3 border font-medium ${gateMsgTipo === 'error'
              ? 'text-red-300 bg-red-950/60 border-red-800'
              : 'text-emerald-300 bg-emerald-950/60 border-emerald-800'}`}>
              {gateMsg}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Render: Carregando ─────────────────────────────────────
  if (verificandoSessao || loadingEvento) {
    return (
      <div className="min-h-screen bg-[#08101E] flex items-center justify-center font-sans">
        <div className="text-center text-white">
          <div className="w-12 h-12 border-4 border-emerald-400 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-xs text-slate-400 tracking-wider uppercase font-semibold">Carregando Check-in...</p>
        </div>
      </div>
    );
  }

  // ── Render: Acesso Negado / Evento Inativo ─────────────────
  if (acessoNegado || !evento) {
    const mensagens: Record<AcessoMotivo, { titulo: string; corpo: string }> = {
      nao_autorizado: {
        titulo: 'Acesso não autorizado',
        corpo: 'Você não possui permissão para operar o check-in deste evento.',
      },
      evento_encerrado: {
        titulo: 'Evento encerrado',
        corpo: 'Este evento foi finalizado ou cancelado pela administração.',
      },
      checkin_desativado: {
        titulo: 'Check-in desativado',
        corpo: 'O check-in deste evento ainda não foi iniciado. Aguarde a liberação pela organização.',
      },
    };
    const msg = mensagens[acessoMotivo || 'nao_autorizado'];
    return (
      <div className="min-h-screen bg-[#08101E] flex items-center justify-center p-6 text-white font-sans">
        <div className="bg-[#0F1E36] border border-white/10 rounded-3xl p-8 text-center max-w-sm w-full shadow-2xl">
          <div className="w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-400 flex items-center justify-center mx-auto mb-4 shadow-[0_0_20px_rgba(239,68,68,0.2)]">
            <XCircle className="w-8 h-8" />
          </div>
          <p className="text-white font-bold text-lg mb-2">{msg.titulo}</p>
          <p className="text-slate-400 text-xs mb-6 leading-relaxed">{msg.corpo}</p>
          <button
            onClick={() => router.push('/eventos')}
            className="w-full bg-slate-800 hover:bg-slate-700 text-white py-3 rounded-2xl font-semibold text-xs border border-white/10 transition">
            ← Voltar para Eventos
          </button>
        </div>
      </div>
    );
  }

  const periodoFormatado = formatEventoPeriodo(evento.data_inicio, evento.data_fim, evento.departamento);

  // ═══════════════════════════════════════════════════════════
  // SCREEN 3: TELA DE PARTICIPANTE ENCONTRADO
  // ═══════════════════════════════════════════════════════════
  const TelaParticipanteEncontrado = () => {
    if (!pendingConfirm) return null;
    const { inscricao: ins, nomeSup: ns, nomeCampo: nc, contexto: ctx } = pendingConfirm;
    const isRefeitorio = modoCheckin === 'refeitorio';
    const isPlenaria   = modoCheckin === 'plenaria';

    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-[#08101E]/95 backdrop-blur-md overflow-y-auto p-4 sm:p-6 animate-in fade-in duration-200">
        <div className="w-full max-w-md mx-auto my-auto flex flex-col">
          {/* Top Bar com Voltar */}
          <div className="flex items-center gap-3 mb-4">
            <button
              onClick={cancelarConfirmacao}
              disabled={confirmando}
              className="w-10 h-10 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-center text-white transition active:scale-95"
            >
              <ChevronLeft className="w-6 h-6" />
            </button>
            <h2 className="text-base font-bold text-white tracking-wide">Participante encontrado</h2>
          </div>

          {/* Card Central */}
          <div className="bg-[#0F1E36] border border-white/10 rounded-3xl p-6 shadow-2xl space-y-5 text-white">
            {/* Foto e Badge Superior */}
            <div className="flex flex-col items-center text-center">
              <div className="w-24 h-24 rounded-2xl overflow-hidden border-2 border-emerald-400/50 bg-slate-800 shadow-[0_0_20px_rgba(16,185,129,0.25)] flex items-center justify-center mb-3">
                {ins.foto_url ? (
                  <img
                    src={ins.foto_url}
                    alt={ins.nome_inscrito}
                    className="w-full h-full object-cover"
                    onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                ) : (
                  <User className="w-12 h-12 text-slate-500" />
                )}
              </div>

              {/* Badge de Inscrição Confirmada */}
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-xs font-bold tracking-wide uppercase mb-2">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Inscrição Confirmada
              </div>

              {/* Nome do Participante */}
              <h3 className="text-lg font-black text-white uppercase leading-snug max-w-xs">{ins.nome_inscrito}</h3>

              {/* Badges de Cargo e Matrícula */}
              <div className="flex flex-wrap items-center justify-center gap-2 mt-2">
                {(ins.cargo_ministerial || ins.tipo_inscricao) && (
                  <span className="px-2.5 py-1 rounded-lg bg-blue-500/20 border border-blue-500/30 text-blue-300 text-[11px] font-bold uppercase tracking-wider">
                    {ins.cargo_ministerial || ins.tipo_inscricao}
                  </span>
                )}
                {ins.matricula && (
                  <span className="px-2.5 py-1 rounded-lg bg-slate-800 border border-white/10 text-slate-300 text-[11px] font-semibold">
                    REG. {ins.matricula}
                  </span>
                )}
              </div>

              {/* Local / Campo e Supervisão */}
              <div className="flex items-center gap-1.5 text-xs text-slate-400 mt-2 font-medium">
                <MapPin className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>{ns} · {nc}</span>
              </div>
            </div>

            {/* Divisor */}
            <div className="h-px bg-white/10" />

            {/* Detalhes Informativos */}
            <div className="space-y-2.5 text-xs">
              <div className="flex justify-between items-center py-1">
                <span className="text-slate-400">Evento</span>
                <span className="font-semibold text-white text-right max-w-[65%] truncate">{evento.nome}</span>
              </div>
              <div className="flex justify-between items-center py-1">
                <span className="text-slate-400">Categoria</span>
                <span className="font-semibold text-white">{ins.tipo_inscricao || ins.cargo_ministerial || 'Participante'}</span>
              </div>
              <div className="flex justify-between items-center py-1">
                <span className="text-slate-400">Alimentação</span>
                <span className={`font-semibold ${ins.alimentacao ? 'text-emerald-400' : 'text-slate-400'}`}>
                  {isRefeitorio ? `${ctx.refeicoes_saldo} refeições disponíveis` : ins.alimentacao ? '15 refeições inclusas' : 'Não inclusa'}
                </span>
              </div>
              <div className="flex justify-between items-center py-1">
                <span className="text-slate-400">Hospedagem</span>
                <span className="font-semibold text-slate-300">{ins.hospedagem ? 'Inclusa' : 'Não solicitada'}</span>
              </div>
            </div>

            {/* Painel Especial para Refeitório */}
            {isRefeitorio && (
              <div className="bg-[#08101E] border border-white/10 rounded-2xl p-3.5 flex justify-around text-center">
                <div>
                  <p className="text-[10px] text-slate-400 uppercase tracking-wider">Total</p>
                  <p className="text-lg font-black text-white">{ctx.refeicoes_total}</p>
                </div>
                <div>
                  <p className="text-[10px] text-slate-400 uppercase tracking-wider">Usadas</p>
                  <p className="text-lg font-black text-amber-400">{ctx.refeicoes_usadas}</p>
                </div>
                <div>
                  <p className="text-[10px] text-slate-400 uppercase tracking-wider">Saldo</p>
                  <p className={`text-lg font-black ${ctx.refeicoes_saldo > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {ctx.refeicoes_saldo}
                  </p>
                </div>
              </div>
            )}

            {/* Painel Especial para Plenária */}
            {isPlenaria && !ctx.plenaria_hoje && ctx.plenaria_ultimo_at && (
              <div className="bg-blue-950/50 border border-blue-800/60 rounded-2xl p-3 text-center text-xs text-blue-300">
                Última presença: {new Date(ctx.plenaria_ultimo_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
              </div>
            )}

            {/* Botões de Ação */}
            <div className="pt-2 space-y-3">
              <button
                onClick={() => void confirmarCheckin()}
                disabled={confirmando}
                className="w-full bg-emerald-500 hover:bg-emerald-400 active:scale-95 text-white font-black py-4 rounded-2xl shadow-lg shadow-emerald-500/25 transition flex items-center justify-center gap-2 text-base disabled:opacity-50"
              >
                {confirmando ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Confirmando...</span>
                  </>
                ) : (
                  <>
                    <Check className="w-5 h-5" />
                    <span>
                      {isRefeitorio ? 'Confirmar Refeição' : isPlenaria ? 'Confirmar Presença na Plenária' : 'Confirmar Check-in'}
                    </span>
                  </>
                )}
              </button>

              <button
                onClick={cancelarConfirmacao}
                disabled={confirmando}
                className="w-full bg-white/5 hover:bg-white/10 text-slate-300 font-semibold py-3 rounded-2xl border border-white/10 transition text-xs"
              >
                Cancelar / Voltar
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // ═══════════════════════════════════════════════════════════
  // SCREEN 4: CHECK-IN REALIZADO COM SUCESSO!
  // ═══════════════════════════════════════════════════════════
  const TelaSucesso = () => {
    if (!resultado || resultado.estado !== 'success') return null;
    const ins = resultado.inscricao;
    const isRefeitorio = modoCheckin === 'refeitorio';
    const isPlenaria   = modoCheckin === 'plenaria';

    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-[#08101E] overflow-y-auto p-4 sm:p-6 animate-in zoom-in-95 duration-200">
        <div className="w-full max-w-md mx-auto my-auto flex flex-col items-center text-center">
          {/* Círculo Verde com Pulso */}
          <div className="w-20 h-20 rounded-full bg-emerald-500/20 border-2 border-emerald-400 text-emerald-400 flex items-center justify-center shadow-[0_0_35px_rgba(16,185,129,0.35)] mb-4">
            <CheckCircle2 className="w-10 h-10" />
          </div>

          <h2 className="text-xl font-bold text-white tracking-wide">Check-in realizado com sucesso!</h2>
          <p className="text-xs text-slate-400 mt-1">Acesso liberado e registrado na portaria do evento.</p>

          {/* Mini Card do Participante */}
          {ins && (
            <div className="w-full bg-[#0F1E36] border border-white/10 rounded-2xl p-4 mt-5 flex items-center gap-3.5 text-left shadow-xl">
              <div className="w-12 h-12 rounded-xl overflow-hidden bg-slate-800 border border-emerald-400/40 flex items-center justify-center shrink-0">
                {ins.foto_url ? (
                  <img src={ins.foto_url} alt={ins.nome_inscrito} className="w-full h-full object-cover" />
                ) : (
                  <User className="w-6 h-6 text-slate-500" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-white truncate uppercase">{ins.nome_inscrito}</p>
                <div className="flex items-center gap-1.5 mt-1">
                  {(ins.cargo_ministerial || ins.tipo_inscricao) && (
                    <span className="px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 text-[10px] font-bold uppercase">
                      {ins.cargo_ministerial || ins.tipo_inscricao}
                    </span>
                  )}
                  {ins.matricula && (
                    <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 text-[10px] font-semibold">
                      REG. {ins.matricula}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Lista de Detalhes da Leitura */}
          <div className="w-full bg-[#0F1E36]/60 border border-white/10 rounded-2xl p-4 space-y-3 mt-3 text-xs text-left">
            <div className="flex items-center gap-2.5 text-slate-300">
              <Calendar className="w-4 h-4 text-emerald-400 shrink-0" />
              <span className="truncate">{evento.nome}</span>
            </div>
            <div className="flex items-center gap-2.5 text-slate-300">
              <Clock className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</span>
            </div>
            <div className="flex items-center gap-2.5 text-slate-300">
              <Ticket className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Tipo de check-in: <strong className="text-white">{isRefeitorio ? 'Refeitório' : isPlenaria ? 'Plenária' : 'Entrada'}</strong></span>
            </div>
            {isRefeitorio && resultado.saldoRestante != null && (
              <div className="flex items-center gap-2.5 text-slate-300">
                <Utensils className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>Saldo restante: <strong className="text-emerald-400">{resultado.saldoRestante} refeições</strong></span>
              </div>
            )}
          </div>

          {/* Botão Novo Check-in */}
          <button
            onClick={voltarParaScan}
            className="w-full bg-emerald-500 hover:bg-emerald-400 active:scale-95 text-white font-black py-4 rounded-2xl shadow-lg shadow-emerald-500/25 transition flex items-center justify-center gap-2 mt-6 text-sm"
          >
            <Square className="w-4 h-4" />
            <span>Novo Check-in</span>
          </button>
        </div>
      </div>
    );
  };

  // ═══════════════════════════════════════════════════════════
  // SCREEN 5: CREDENCIAMENTO BLOQUEADO
  // ═══════════════════════════════════════════════════════════
  const TelaBloqueio = () => {
    if (!resultado || resultado.estado === 'success' || resultado.estado === 'idle' || resultado.estado === 'processing') return null;
    const { estado, inscricao: ins, bloqueadoMotivo } = resultado;

    const labelBadge =
      estado === 'pagamento_pendente'
        ? 'PAGAMENTO PENDENTE'
        : estado === 'already'
          ? 'CHECK-IN JÁ REALIZADO'
          : estado === 'already_plenaria'
            ? 'PRESENÇA JÁ REGISTRADA HOJE'
            : estado === 'sem_saldo' || estado === 'sem_alimentacao'
              ? 'SEM REFEIÇÕES DISPONÍVEIS'
              : estado === 'wrong_event'
                ? 'OUTRO EVENTO'
                : 'QR CODE INVÁLIDO';

    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-[#08101E] overflow-y-auto p-4 sm:p-6 animate-in zoom-in-95 duration-200">
        <div className="w-full max-w-md mx-auto my-auto flex flex-col items-center text-center">
          {/* Círculo Vermelho de Bloqueio */}
          <div className="w-20 h-20 rounded-full bg-red-500/20 border-2 border-red-500 text-red-500 flex items-center justify-center shadow-[0_0_35px_rgba(239,68,68,0.35)] mb-4">
            <XCircle className="w-10 h-10" />
          </div>

          <h2 className="text-xl font-bold text-white tracking-wide">Credenciamento bloqueado</h2>
          <p className="text-xs text-slate-400 mt-1">Esta inscrição não está habilitada para check-in.</p>

          {/* Mini Card do Participante */}
          {ins && (
            <div className="w-full bg-[#0F1E36] border border-white/10 rounded-2xl p-4 mt-5 flex items-center gap-3.5 text-left shadow-xl">
              <div className="w-12 h-12 rounded-xl overflow-hidden bg-slate-800 border border-red-500/40 flex items-center justify-center shrink-0">
                {ins.foto_url ? (
                  <img src={ins.foto_url} alt={ins.nome_inscrito} className="w-full h-full object-cover" />
                ) : (
                  <User className="w-6 h-6 text-slate-500" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-white truncate uppercase">{ins.nome_inscrito}</p>
                <div className="mt-1">
                  <span className="px-2 py-0.5 rounded bg-red-500/20 text-red-300 text-[10px] font-bold uppercase tracking-wider">
                    {labelBadge}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Linhas Informativas */}
          {ins && (
            <div className="w-full bg-[#0F1E36]/60 border border-white/10 rounded-2xl p-4 space-y-2 mt-3 text-xs text-left">
              <div className="flex justify-between">
                <span className="text-slate-400">Evento</span>
                <span className="font-semibold text-white max-w-[65%] truncate">{evento.nome}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Categoria</span>
                <span className="font-semibold text-white">{ins.tipo_inscricao || ins.cargo_ministerial || 'Participante'}</span>
              </div>
              {ins.valor_final != null && ins.valor_final > 0 && (
                <div className="flex justify-between">
                  <span className="text-slate-400">Valor</span>
                  <span className="font-semibold text-white">R$ {Number(ins.valor_final).toFixed(2).replace('.', ',')}</span>
                </div>
              )}
            </div>
          )}

          {/* Card de Alerta com Motivo Real */}
          <div className="w-full bg-red-950/60 border border-red-800/80 rounded-2xl p-4 flex items-start gap-3 text-left mt-4 text-red-200 text-xs shadow-lg">
            <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
            <p className="leading-relaxed">
              {bloqueadoMotivo || 'Verifique o status da inscrição com a coordenação do evento.'}
            </p>
          </div>

          {/* Botão Voltar */}
          <button
            onClick={voltarParaScan}
            className="w-full bg-slate-800 hover:bg-slate-700 active:scale-95 text-white font-semibold py-4 rounded-2xl border border-white/10 transition mt-6 text-sm"
          >
            Voltar para câmera
          </button>
        </div>
      </div>
    );
  };

  // ═══════════════════════════════════════════════════════════
  // SCREEN 6: MODAL / SHEET DE ÚLTIMOS CHECK-INS
  // ═══════════════════════════════════════════════════════════
  const ModalHistorico = () => {
    if (!historicoOpen) return null;

    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-[#08101E]/95 backdrop-blur-md animate-in fade-in duration-200">
        <div className="w-full max-w-md mx-auto flex flex-col h-full p-4 sm:p-6">
          {/* Header do Sheet */}
          <div className="flex items-center justify-between pb-4 border-b border-white/10">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setHistoricoOpen(false)}
                className="w-10 h-10 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-center text-white transition active:scale-95"
              >
                <ChevronLeft className="w-6 h-6" />
              </button>
              <div>
                <h2 className="text-base font-bold text-white tracking-wide">Últimos Check-ins</h2>
                <p className="text-xs text-slate-400">{totalCheckins} check-ins realizados</p>
              </div>
            </div>
          </div>

          {/* Lista com scroll */}
          <div className="flex-1 overflow-y-auto py-4 space-y-2.5">
            {ultimosCheckins.length === 0 ? (
              <div className="py-16 text-center text-slate-400 text-xs">
                Nenhum check-in registrado recentemente.
              </div>
            ) : (
              ultimosCheckins.map(ins => (
                <div
                  key={ins.id}
                  className="bg-[#0F1E36] border border-white/10 rounded-2xl p-3.5 flex items-center gap-3 shadow-sm"
                >
                  <div className="w-10 h-10 rounded-full bg-slate-800 border border-emerald-400/30 overflow-hidden flex items-center justify-center shrink-0">
                    {ins.foto_url ? (
                      <img src={ins.foto_url} alt={ins.nome_inscrito} className="w-full h-full object-cover" />
                    ) : (
                      <User className="w-5 h-5 text-slate-500" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-white uppercase truncate">{ins.nome_inscrito}</p>
                    <p className="text-[11px] text-slate-400 truncate">
                      {ins.tipo_inscricao || 'Participante'} · {nomeSup(ins.supervisao_id)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[11px] text-slate-400 font-medium">{fmtHora(ins.checkin_at)}</span>
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    );
  };

  // ═══════════════════════════════════════════════════════════
  // SCREEN 7: DRAWER DE NAVEGAÇÃO / MENU LATERAL
  // ═══════════════════════════════════════════════════════════
  const DrawerMenu = () => {
    if (!menuOpen) return null;

    return (
      <div className="fixed inset-0 z-50 flex">
        {/* Backdrop */}
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-sm transition-opacity"
          onClick={() => setMenuOpen(false)}
        />

        {/* Painel lateral */}
        <div className="relative w-full max-w-xs bg-[#08101E] border-r border-white/10 h-full flex flex-col p-6 z-10 shadow-2xl text-white animate-in slide-in-from-left duration-200">
          {/* Header do Drawer */}
          <div className="flex items-start justify-between pb-6 border-b border-white/10">
            <div>
              <p className="text-[10px] text-emerald-400 font-bold uppercase tracking-widest">Portal Check-in</p>
              <h2 className="text-sm font-bold text-white mt-1 leading-snug">{evento.nome}</h2>
              <p className="text-xs text-slate-400 mt-1">{periodoFormatado}</p>
            </div>
            <button
              onClick={() => setMenuOpen(false)}
              className="p-1 rounded-lg text-slate-400 hover:text-white transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Links de Navegação */}
          <div className="flex-1 py-6 space-y-2">
            <button
              onClick={() => { setModoCheckin('credenciamento'); setMenuOpen(false); }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-xs font-semibold transition ${
                modoCheckin === 'credenciamento'
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                  : 'text-slate-300 hover:bg-white/5'
              }`}
            >
              <QrCode className="w-4 h-4" />
              <span>Check-in Entrada</span>
            </button>

            <button
              onClick={() => { setModoCheckin('plenaria'); setMenuOpen(false); }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-xs font-semibold transition ${
                modoCheckin === 'plenaria'
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                  : 'text-slate-300 hover:bg-white/5'
              }`}
            >
              <Users className="w-4 h-4" />
              <span>Plenária</span>
            </button>

            <button
              onClick={() => { setModoCheckin('refeitorio'); setMenuOpen(false); }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-xs font-semibold transition ${
                modoCheckin === 'refeitorio'
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                  : 'text-slate-300 hover:bg-white/5'
              }`}
            >
              <Utensils className="w-4 h-4" />
              <span>Refeitório</span>
            </button>

            <button
              onClick={() => { setHistoricoOpen(true); setMenuOpen(false); }}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-xs font-semibold text-slate-300 hover:bg-white/5 transition"
            >
              <FileText className="w-4 h-4" />
              <span>Relatórios</span>
            </button>

            <button
              onClick={() => { setHistoricoOpen(true); setMenuOpen(false); }}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-xs font-semibold text-slate-300 hover:bg-white/5 transition"
            >
              <Clock className="w-4 h-4" />
              <span>Histórico de Check-ins</span>
            </button>
          </div>

          {/* Rodapé com Logo COMIEADEPA */}
          <div className="pt-6 border-t border-white/10 flex flex-col items-center text-center">
            <img
              src="/img/logo_comieadepa.png"
              alt="COMIEADEPA"
              className="h-10 w-auto object-contain opacity-80 mb-2"
              onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
            <p className="text-[10px] text-slate-500">Sistema SISCOMIEADEPA · v1.0.0</p>
            {equipeSessao?.email && (
              <p className="text-[10px] text-slate-400 mt-1 truncate max-w-full">
                Operador: {equipeSessao.email}
              </p>
            )}
            <button
              onClick={() => {
                clearEquipeSession();
                setEquipeSessao(null);
                setMenuOpen(false);
              }}
              className="mt-3 text-xs text-red-400 hover:text-red-300 flex items-center gap-1.5 transition"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Encerrar sessão</span>
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ═══════════════════════════════════════════════════════════
  // RENDER PRINCIPAL (LAYOUT)
  // ═══════════════════════════════════════════════════════════
  return (
    <div className="min-h-screen bg-[#08101E] text-white font-sans flex flex-col selection:bg-emerald-500 selection:text-white">
      {/* Estilos para animação laser e customização da câmera */}
      <style jsx global>{`
        @keyframes scanLaser {
          0% { top: 8%; opacity: 0.6; }
          50% { top: 92%; opacity: 1; }
          100% { top: 8%; opacity: 0.6; }
        }
        .animate-scan-laser {
          animation: scanLaser 2.2s ease-in-out infinite;
        }
        #qr-scanner-region {
          border: none !important;
          background: #000 !important;
          position: relative;
        }
        #qr-scanner-region video {
          width: 100% !important;
          height: 100% !important;
          object-fit: cover !important;
          border-radius: 1.5rem !important;
        }
        #qr-scanner-region img,
        #qr-scanner-region span,
        #qr-scanner-region button {
          display: none !important;
        }
      `}</style>

      {/* Modais e Overlays */}
      <TelaParticipanteEncontrado />
      <TelaSucesso />
      <TelaBloqueio />
      <ModalHistorico />
      <DrawerMenu />

      {/* ── CABEÇALHO DO EVENTO ───────────────────────────────── */}
      <header className="bg-[#0D1D35] border-b border-white/10 px-4 py-3.5 flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => setMenuOpen(true)}
            className="w-9 h-9 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-center text-white transition active:scale-95 shrink-0"
            aria-label="Menu"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="min-w-0">
            <h1 className="text-sm font-bold text-white uppercase tracking-tight truncate leading-tight">
              {evento.nome}
            </h1>
            <p className="text-[11px] text-slate-400 truncate flex items-center gap-1 mt-0.5">
              <MapPin className="w-3 h-3 text-emerald-400 shrink-0" />
              <span>{periodoFormatado}</span>
            </p>
          </div>
        </div>

        {/* Contador de Check-ins Badge */}
        <button
          onClick={() => setHistoricoOpen(true)}
          className="bg-[#08101E] border border-white/10 hover:border-emerald-400/40 rounded-2xl px-3 py-1.5 flex flex-col items-end transition shrink-0"
        >
          <span className="text-[9px] text-slate-400 uppercase tracking-widest font-semibold leading-none">
            Check-ins
          </span>
          <span className="text-base font-black text-emerald-400 leading-none mt-1">
            {totalCheckins}
          </span>
        </button>
      </header>

      {/* ── ABAS DE MODO (Entrada / Plenária / Refeitório) ─────── */}
      <nav className="bg-[#0D1D35] px-2 flex border-b border-white/10 shrink-0">
        {(['credenciamento', 'plenaria', 'refeitorio'] as const).map(m => {
          const ativo = modoCheckin === m;
          const label = m === 'credenciamento' ? 'Entrada' : m === 'plenaria' ? 'Plenária' : 'Refeitório';
          const Icon = m === 'credenciamento' ? Calendar : m === 'plenaria' ? Users : Utensils;

          return (
            <button
              key={m}
              onClick={() => { if (!modoForcado) setModoCheckin(m); }}
              disabled={!!modoForcado}
              className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 border-b-2 transition ${
                ativo
                  ? 'border-emerald-400 text-emerald-400'
                  : 'border-transparent text-slate-400 hover:text-white'
              } ${modoForcado ? 'cursor-default' : ''}`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{label}</span>
            </button>
          );
        })}
      </nav>

      {/* ── TOGGLE CÂMERA / MANUAL ───────────────────────────── */}
      <div className="px-4 py-3 shrink-0">
        <div className="max-w-xs mx-auto bg-[#0F1E36] border border-white/10 rounded-2xl p-1 flex">
          <button
            onClick={() => {
              setModoManual(false);
              setBuscaManual('');
              setResultadosManual([]);
              void iniciarScanner();
            }}
            className={`flex-1 py-2 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 ${
              !modoManual
                ? 'bg-slate-800 text-emerald-400 shadow border border-emerald-500/20'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Square className="w-3.5 h-3.5" />
            <span>Câmera</span>
          </button>
          <button
            onClick={() => {
              setModoManual(true);
              void stopScanner();
              setResultado(null);
            }}
            className={`flex-1 py-2 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 ${
              modoManual
                ? 'bg-slate-800 text-emerald-400 shadow border border-emerald-500/20'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Search className="w-3.5 h-3.5" />
            <span>Manual</span>
          </button>
        </div>
      </div>

      {/* ── CORPO PRINCIPAL ──────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto px-4 pb-6">
        {/* ═══ MODO CÂMERA (SCREEN 1) ═══════════════════════════ */}
        {!modoManual && (
          <div className="max-w-sm mx-auto flex flex-col items-center">
            {/* Viewfinder da Câmera */}
            <div className="w-full aspect-square relative rounded-3xl overflow-hidden bg-black border border-white/10 shadow-2xl flex items-center justify-center">
              {/* Elemento Html5Qrcode */}
              <div id={scannerElementId} className="w-full h-full" />

              {/* Botão de Lanterna Flutuante */}
              <button
                onClick={toggleTorch}
                className={`absolute top-3.5 right-3.5 z-20 w-10 h-10 rounded-full backdrop-blur-md border border-white/15 flex items-center justify-center transition active:scale-95 shadow-lg ${
                  torchOn ? 'bg-amber-400 text-black' : 'bg-black/60 text-white'
                }`}
                title="Alternar lanterna"
              >
                <Flashlight className="w-4 h-4" />
              </button>

              {/* Cantoneiras Verdes e Laser */}
              {scannerAtivo && (
                <div className="absolute inset-0 pointer-events-none z-10 p-7">
                  <div className="relative w-full h-full">
                    {/* Cantoneira Superior Esquerda */}
                    <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-emerald-400 rounded-tl-xl" />
                    {/* Cantoneira Superior Direita */}
                    <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-emerald-400 rounded-tr-xl" />
                    {/* Cantoneira Inferior Esquerda */}
                    <div className="absolute bottom-12 left-0 w-8 h-8 border-b-4 border-l-4 border-emerald-400 rounded-bl-xl" />
                    {/* Cantoneira Inferior Direita */}
                    <div className="absolute bottom-12 right-0 w-8 h-8 border-b-4 border-r-4 border-emerald-400 rounded-br-xl" />

                    {/* Laser de Leitura Animado */}
                    <div className="absolute left-2 right-2 h-0.5 bg-gradient-to-r from-transparent via-emerald-400 to-transparent shadow-[0_0_12px_#10b981] animate-scan-laser" />
                  </div>
                </div>
              )}

              {/* Banner Inferior de Instrução sobreposto */}
              <div className="absolute bottom-3 left-3 right-3 z-20 bg-black/75 backdrop-blur-md border border-white/10 py-2.5 px-3 rounded-2xl flex items-center justify-center gap-2 text-[11px] text-white/90 text-center font-medium shadow-lg">
                <QrCode className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>Posicione o QR Code da credencial no centro da câmera</span>
              </div>

              {/* Fallback se câmera parada */}
              {!scannerAtivo && (
                <div className="absolute inset-0 bg-[#08101E] flex flex-col items-center justify-center p-6 text-center z-10">
                  <QrCode className="w-12 h-12 text-slate-500 mb-3" />
                  <p className="text-xs text-slate-400 mb-4">Câmera desativada</p>
                  <button
                    onClick={() => void iniciarScanner()}
                    className="bg-emerald-500 hover:bg-emerald-400 active:scale-95 text-white font-bold px-6 py-3 rounded-2xl text-xs shadow-lg shadow-emerald-500/20 transition flex items-center gap-2"
                  >
                    <Play className="w-3.5 h-3.5" />
                    <span>Iniciar câmera</span>
                  </button>
                </div>
              )}
            </div>

            {/* Mensagem de Erro de Câmera */}
            {cameraMsg && (
              <p className="text-amber-400 text-center mt-3 text-xs font-semibold px-2">{cameraMsg}</p>
            )}

            {/* Controles Inferiores da Câmera (Screen 1 footer) */}
            <div className="w-full flex items-center justify-between gap-3 mt-4">
              <button
                onClick={() => setHistoricoOpen(true)}
                className="flex-1 bg-[#0F1E36] hover:bg-slate-800 border border-white/10 rounded-2xl py-3 px-4 text-xs font-semibold text-slate-200 flex items-center justify-between transition active:scale-95 shadow-sm"
              >
                <span className="flex items-center gap-2">
                  <Clock className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Últimos Check-ins</span>
                </span>
                <ChevronRight className="w-4 h-4 text-slate-400" />
              </button>

              <button
                onClick={() => {
                  if (scannerAtivo) {
                    void stopScanner();
                  } else {
                    void iniciarScanner();
                  }
                }}
                className="bg-[#0F1E36] hover:bg-slate-800 border border-white/10 rounded-2xl py-3 px-4 text-xs font-semibold text-slate-300 transition active:scale-95 shadow-sm"
              >
                {scannerAtivo ? 'Parar câmera' : 'Ativar câmera'}
              </button>
            </div>

            {/* Quick Preview dos Últimos 3 Check-ins */}
            <div className="w-full mt-6">
              <div className="flex items-center justify-between mb-2.5">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Recentes</h3>
                <button
                  onClick={() => setHistoricoOpen(true)}
                  className="text-[11px] text-emerald-400 hover:underline font-semibold"
                >
                  Ver todos
                </button>
              </div>

              {ultimosCheckins.length === 0 ? (
                <div className="bg-[#0F1E36]/40 border border-white/5 rounded-2xl p-4 text-center text-slate-500 text-xs">
                  Nenhum check-in realizado ainda neste terminal.
                </div>
              ) : (
                <div className="space-y-2">
                  {ultimosCheckins.slice(0, 3).map(ins => (
                    <div
                      key={ins.id}
                      className="bg-[#0F1E36] border border-white/10 rounded-2xl p-3 flex items-center justify-between gap-2 shadow-sm"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 rounded-full bg-slate-800 border border-emerald-400/20 overflow-hidden flex items-center justify-center shrink-0">
                          {ins.foto_url ? (
                            <img src={ins.foto_url} alt={ins.nome_inscrito} className="w-full h-full object-cover" />
                          ) : (
                            <User className="w-4 h-4 text-slate-500" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-white uppercase truncate">{ins.nome_inscrito}</p>
                          <p className="text-[10px] text-slate-400 truncate">{nomeSup(ins.supervisao_id)}</p>
                        </div>
                      </div>
                      <span className="text-[10px] text-slate-400 font-medium shrink-0">{fmtHora(ins.checkin_at)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ═══ MODO MANUAL (SCREEN 2) ═══════════════════════════ */}
        {modoManual && (
          <div className="max-w-sm mx-auto space-y-4">
            {/* Header da Busca */}
            <div>
              <h2 className="text-lg font-bold text-white tracking-wide">Consultar credencial</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Digite o código, CPF ou número da inscrição para realizar o check-in.
              </p>
            </div>

            {/* Input de Busca */}
            <div className="relative">
              <div className="relative flex items-center bg-[#0F1E36] border border-white/10 focus-within:border-emerald-400 focus-within:ring-1 focus-within:ring-emerald-400 rounded-2xl px-4 py-3.5 transition shadow-inner">
                <Search className="w-4 h-4 text-slate-400 mr-2.5 shrink-0" />
                <input
                  type="text"
                  placeholder="Código, CPF ou inscrição"
                  value={buscaManual}
                  onChange={e => setBuscaManual(e.target.value)}
                  autoFocus
                  className="w-full bg-transparent text-white placeholder-slate-500 text-sm focus:outline-none"
                />
                {buscaManual && (
                  <button
                    onClick={() => setBuscaManual('')}
                    className="p-1 rounded-full text-slate-400 hover:text-white"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Botão Primário Verde da Tela 2 */}
              <button
                onClick={() => {
                  if (buscaManual.trim().length >= MIN_BUSCA_MANUAL && resultadosManual.length > 0) {
                    void consultarInscricao(resultadosManual[0].qr_code || resultadosManual[0].id);
                  }
                }}
                disabled={buscandoManual || buscaManual.trim().length < MIN_BUSCA_MANUAL}
                className="w-full bg-emerald-500 hover:bg-emerald-400 active:scale-95 text-white font-bold py-3.5 px-4 rounded-2xl text-xs shadow-lg shadow-emerald-500/20 transition flex items-center justify-center gap-2 mt-3 disabled:opacity-40"
              >
                <Search className="w-4 h-4" />
                <span>Buscar Participante</span>
              </button>
            </div>

            {/* Indicador de carregamento */}
            {buscandoManual && (
              <div className="flex justify-center py-4">
                <div className="w-6 h-6 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
              </div>
            )}

            {/* Feedback de busca curta */}
            {!buscandoManual && buscaManual.trim().length > 0 && buscaManual.trim().length < MIN_BUSCA_MANUAL && (
              <p className="text-slate-500 text-center text-xs py-2">
                Digite pelo menos {MIN_BUSCA_MANUAL} caracteres para buscar.
              </p>
            )}

            {/* Feedback sem resultados */}
            {!buscandoManual && buscaManual.trim().length >= MIN_BUSCA_MANUAL && resultadosManual.length === 0 && (
              <div className="bg-[#0F1E36]/40 border border-white/5 rounded-2xl p-6 text-center text-slate-400 text-xs">
                Nenhum participante localizado com esse termo.
              </div>
            )}

            {/* Lista de Resultados */}
            <div className="space-y-2.5 pt-2">
              {resultadosManual.map(ins => {
                const isPago = ['pago', 'isento'].includes(String(ins.status_pagamento || '').toLowerCase());

                return (
                  <div
                    key={ins.id}
                    className="bg-[#0F1E36] border border-white/10 rounded-2xl p-4 shadow-sm hover:border-emerald-500/30 transition flex flex-col gap-2.5"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-10 h-10 rounded-xl bg-slate-800 border border-white/10 overflow-hidden flex items-center justify-center shrink-0">
                          {ins.foto_url ? (
                            <img src={ins.foto_url} alt={ins.nome_inscrito} className="w-full h-full object-cover" />
                          ) : (
                            <User className="w-5 h-5 text-slate-500" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-white uppercase truncate">{ins.nome_inscrito}</p>
                          <p className="text-[11px] text-slate-400 truncate">
                            {nomeSup(ins.supervisao_id)} · {nomeCampo(ins.campo_id)}
                          </p>
                          {ins.cpf && (
                            <p className="text-[10px] text-slate-500 mt-0.5">CPF: {maskCpf(ins.cpf)}</p>
                          )}
                        </div>
                      </div>

                      {/* Status Pagamento Pill */}
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase shrink-0 ${
                        isPago ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                      }`}>
                        {PAGAMENTO_LABELS[ins.status_pagamento] ?? ins.status_pagamento}
                      </span>
                    </div>

                    {/* Botão de Consultar / Check-in */}
                    <button
                      onClick={() => void consultarInscricao(ins.qr_code || ins.id)}
                      disabled={processando}
                      className="w-full bg-slate-800 hover:bg-emerald-500 hover:text-white text-slate-200 py-2.5 px-3 rounded-xl text-xs font-semibold border border-white/10 transition active:scale-95 flex items-center justify-center gap-1.5"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>{ins.checkin_realizado && modoCheckin === 'credenciamento' ? 'Ver Check-in' : 'Realizar Check-in'}</span>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
