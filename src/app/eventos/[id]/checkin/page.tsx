'use client';

import { useState, useEffect, useRef, useMemo, useCallback, type FormEvent } from 'react';
import { useRouter, useParams, usePathname, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase-client';
import { clearEquipeSession, getEquipeSession, setEquipeSession } from '@/lib/equipe-session';
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
}

interface PendingConfirm {
  inscricao: Inscricao & {
    foto_url?: string | null;
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
    // true = mesmo dia + mesma sessão → bloqueia confirmação
    plenaria_hoje: boolean;
    plenaria_hoje_at: string | null;       // horário do registro da sessão atual
    plenaria_hoje_operador: string | null;  // operador do registro da sessão atual
    // último registro em dia/sessão diferente → apenas informativo
    plenaria_ultimo_at: string | null;
    plenaria_ultimo_data: string | null;
    // retrocompatibilidade
    ja_presente_plenaria: boolean;
    // Refeitório
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

/**
 * Extrai o token do QR Code em qualquer formato:
 *  - token puro / UUID puro
 *  - https://app.siscomieadepa.org/qr/{token}
 *  - qualquer URL com /qr/{token} no path
 *  - ?token=... / ?id=... / ?qr=... / ?code=...
 */
function extractQrToken(raw: string): string | null {
  const value = decodeURIComponent(raw.trim()).trim();
  if (!value) return null;

  // Não é URL — retorna direto (UUID, token curto, etc.)
  if (!/^https?:\/\//i.test(value)) {
    return value || null;
  }

  try {
    const url = new URL(value);
    // 1. Querystring prioritária
    const fromQuery =
      url.searchParams.get('token') ||
      url.searchParams.get('id') ||
      url.searchParams.get('qr') ||
      url.searchParams.get('code');
    if (fromQuery) return fromQuery.trim();

    // 2. Segmento /qr/{token}
    const match = url.pathname.match(/\/qr\/([^/?#]+)/i);
    if (match?.[1]) return decodeURIComponent(match[1]).trim();

    // 3. Último segmento do path (nunca retorna URL inteira)
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length) return decodeURIComponent(parts[parts.length - 1]).trim();

    return null; // URL sem path reconhecível
  } catch {
    return value; // fallback: retorna como está
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
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const supabase = useMemo(() => createClient(), []);

  const [equipeSessao, setEquipeSessao] = useState<EquipeSession | null>(null);
  const [emailAcesso, setEmailAcesso] = useState('');
  const [solicitando, setSolicitando] = useState(false);
  const [gateMsg, setGateMsg] = useState<string | null>(null);
  const [gateMsgTipo, setGateMsgTipo] = useState<'success' | 'error'>('success');

  const [evento,      setEvento]      = useState<Evento | null>(null);
  const [supervisoes, setSupervisoes] = useState<Supervisao[]>([]);
  const [campos,      setCampos]      = useState<Campo[]>([]);
  const [loadingEvento, setLoadingEvento] = useState(true);
  const [acessoNegado,  setAcessoNegado]  = useState(false);
  const [acessoMotivo,  setAcessoMotivo]  = useState<AcessoMotivo | null>(null);

  // Contadores em tempo real
  const [totalCheckins, setTotalCheckins] = useState(0);
  const [ultimosCheckins, setUltimosCheckins] = useState<Inscricao[]>([]);

  // Modo de check-in
  const [modoCheckin, setModoCheckin] = useState<'credenciamento' | 'plenaria' | 'refeitorio'>('credenciamento');

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

  // Estado do scanner
  const [scannerAtivo,  setScannerAtivo]  = useState(false);
  const [resultado,     setResultado]     = useState<ResultadoScan | null>(null);
  const [processando,   setProcessando]   = useState(false);
  const [ultimoQr, setUltimoQr] = useState<{ raw: string; token: string | null } | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const scannerRef = useRef<unknown>(null);
  const scannerElementId = 'qr-scanner-region';
  const ignorandoRef = useRef(false); // evita double-scan
  const lastTokenRef = useRef<{ token: string; at: number } | null>(null); // anti-duplicidade 3s

  // Busca manual
  const [modoManual,  setModoManual]  = useState(false);
  const [buscaManual, setBuscaManual] = useState('');
  const [resultadosManual, setResultadosManual] = useState<Inscricao[]>([]);
  const [buscandoManual,   setBuscandoManual]   = useState(false);
  const [manualMsg,        setManualMsg]        = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [cameraMsg, setCameraMsg] = useState<string | null>(null);
  const cameraErroRef = useRef<string | null>(null);
  const iniciandoRef = useRef(false);
  const [verificandoSessao, setVerificandoSessao] = useState(true);

  const precisaGate = !verificandoSessao && !equipeSessao;

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
          setGateMsg('E-mail nao autorizado para este evento.');
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

  // ── Carrega evento e dados base ───────────────────────────
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
          : supabase.from('eventos').select('id,nome,slug,departamento,data_inicio,data_fim,status,checkin_ativo').eq('id', id).single(),
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

  async function solicitarAcesso(e: FormEvent) {
    e.preventDefault();
    setGateMsg(null);
    setGateMsgTipo('success');
    if (!id) {
      setGateMsg('Evento invalido.');
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
      setLoadingEvento(true); // força spinner enquanto o evento carrega após gate
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

  const stopScanner = useCallback(async (atualizarEstado = true) => {
    if (scannerRef.current) {
      const inst = scannerRef.current as { stop?: () => Promise<void>; clear?: () => Promise<void> };
      scannerRef.current = null;
      try { if (inst.stop) await inst.stop(); } catch { /* ignora */ }
      try { if (inst.clear) await inst.clear(); } catch { /* ignora */ }
    }
    cameraErroRef.current = null;
    if (atualizarEstado) setScannerAtivo(false);
  }, []);

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
        setCameraMsg('Area da camera nao encontrada.');
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
          return; // erros comuns de leitura, nao sao falha de camera
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

  // ── Cleanup do scanner ───────────────────────────────────
  useEffect(() => {
    return () => { void stopScanner(false); };
  }, [stopScanner]);

  // ── FASE 1: Lê QR → Lookup (sem registrar) ───────────────
  async function onQRCodeSuccess(qrText: string) {
    if (ignorandoRef.current || processando || pendingConfirm) return;

    // Anti-duplicidade: ignora mesmo token por 3 segundos
    const rawText = String(qrText || '').trim();
    const qrToken = extractQrToken(rawText);
    if (qrToken && lastTokenRef.current) {
      const deltaMs = Date.now() - lastTokenRef.current.at;
      if (lastTokenRef.current.token === qrToken && deltaMs < 3000) return;
    }
    if (qrToken) lastTokenRef.current = { token: qrToken, at: Date.now() };

    ignorandoRef.current = true;
    setProcessando(true);
    emitirSom('leitura');

    // Pausa o scanner enquanto processa
    if (scannerRef.current) {
      try { await (scannerRef.current as { pause: () => void }).pause(); } catch { /* ignora */ }
    }

    setUltimoQr({ raw: rawText, token: qrToken });

    if (!qrToken) {
      setResultado({ estado: 'invalid', message: 'QR Code não reconhecido.' });
      emitirSom('erro'); vibrar('erro');
      setProcessando(false);
      setTimeout(() => voltarParaScan(), 3000);
      return;
    }

    try {
      const dataPlenaria = new Date().toISOString().slice(0, 10);
      const params = new URLSearchParams({
        token: qrToken,
        modo: modoCheckin,
        data_plenaria: dataPlenaria,
      });
      const headers: Record<string, string> = {};
      if (equipeSessao?.equipeId) headers['x-evento-equipe-id'] = equipeSessao.equipeId;

      const res = await fetch(`/api/eventos/${id}/checkin/lookup?${params}`, { headers });
      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        setResultado({ estado: 'invalid', message: json?.message || 'Erro ao consultar inscrição.' });
        emitirSom('erro'); vibrar('erro');
        setTimeout(() => voltarParaScan(), 3000);
        return;
      }

      const status: string = json?.status ?? 'not_found';

      if (status === 'not_found') {
        setResultado({ estado: 'invalid', message: json?.message || 'Inscrição não localizada para este QR Code.' });
        emitirSom('erro'); vibrar('erro');
        setTimeout(() => voltarParaScan(), 3000);
        return;
      }

      if (status === 'wrong_event') {
        const ins = json?.inscricao as Inscricao;
        setResultado({ estado: 'wrong_event', inscricao: ins, message: 'Inscrição não pertence a este evento.' });
        emitirSom('erro'); vibrar('erro');
        setTimeout(() => voltarParaScan(), 3000);
        return;
      }

      const ins = json?.inscricao as Inscricao & { foto_url?: string | null; tipo_inscricao?: string | null; alimentacao?: boolean | null; hospedagem?: boolean | null; quantidade_refeicoes_total?: number | null; quantidade_refeicoes_usadas?: number | null; quantidade_refeicoes_saldo?: number | null; };
      const ctx = json?.contexto as PendingConfirm['contexto'];
      const nomeSup   = supervisoes.find(s => s.id === ins.supervisao_id)?.nome ?? '-';
      const nomeCampo = campos.find(c => c.id === ins.campo_id)?.nome ?? '-';

      // Exibe card de confirmação (SEM registrar nada ainda)
      setPendingConfirm({ inscricao: ins, qrToken, nomeSup, nomeCampo, contexto: ctx });

    } catch {
      setResultado({ estado: 'invalid', message: 'Erro de conexão ao consultar inscrição.' });
      emitirSom('erro'); vibrar('erro');
      setTimeout(() => voltarParaScan(), 3000);
    } finally {
      setProcessando(false);
    }
  }

  // ── FASE 2: Operador confirma → registrar ─────────────────
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
        setResultado({ estado: 'invalid', message: json?.message || 'Erro ao registrar.' });
        emitirSom('erro'); vibrar('erro');
        setTimeout(() => voltarParaScan(), 3000);
        return;
      }

      const status = (json?.status as EstadoScan | undefined) ?? 'invalid';

      if (status === 'already' || status === 'already_plenaria') {
        setResultado({ estado: status, inscricao, nomeSup, nomeCampo, dataPlenaria: json?.data_plenaria });
        emitirSom('erro'); vibrar('erro');
        setTimeout(() => voltarParaScan(), 3000);
        return;
      }

      if (status === 'sem_saldo' || status === 'sem_alimentacao' || status === 'pagamento_pendente' || status === 'duplicate_rapida') {
        setResultado({ estado: status, inscricao, nomeSup, nomeCampo, saldoRestante: json?.saldo_depois ?? null });
        emitirSom('erro'); vibrar('erro');
        setTimeout(() => voltarParaScan(), 3000);
        return;
      }

      setResultado({
        estado: 'success',
        inscricao: json?.inscricao ?? inscricao,
        nomeSup,
        nomeCampo,
        saldoRestante: json?.saldo_depois ?? null,
      });
      emitirSom('sucesso'); vibrar('sucesso');
      void carregarContadores();
      setTimeout(() => voltarParaScan(), 2000);

    } catch {
      setPendingConfirm(null);
      setResultado({ estado: 'invalid', message: 'Erro de conexão ao confirmar.' });
      emitirSom('erro'); vibrar('erro');
      setTimeout(() => voltarParaScan(), 3000);
    } finally {
      setConfirmando(false);
    }
  }

  function cancelarConfirmacao() {
    setPendingConfirm(null);
    voltarParaScan();
  }

  function voltarParaScan() {
    setResultado(null);
    setPendingConfirm(null);
    ignorandoRef.current = false;
    if (scannerRef.current) {
      try { (scannerRef.current as { resume: () => void }).resume(); } catch { /* ignora */ }
    }
  }

  // ── Check-in manual ───────────────────────────────────────
  async function fazerCheckinManual(inscricao: Inscricao) {
    if (inscricao.checkin_realizado || processando) return;
    setProcessando(true);
    const now = new Date().toISOString();
    try {
      if (equipeSessao) {
        const ok = await validarSessaoEquipe(equipeSessao);
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

  // ── Gate de e-mail (verificado ANTES de acessoNegado, pois evento ainda é null neste ponto) ──
  if (precisaGate) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 w-full max-w-md text-center text-gray-800">
          <div className="text-3xl mb-3">🔐</div>
          <h1 className="text-lg font-bold text-[#123b63]">Acesso ao Check-in</h1>
          <p className="text-sm text-gray-500 mt-2">Informe o e-mail cadastrado na equipe do evento.</p>

          <form onSubmit={solicitarAcesso} className="mt-4 space-y-3">
            <input
              type="email"
              placeholder="seu-email@exemplo.com"
              value={emailAcesso}
              onChange={e => setEmailAcesso(e.target.value)}
              className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#123b63] text-center"
              required
            />
            <button
              type="submit"
              disabled={solicitando}
              className="w-full bg-[#123b63] text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-[#0f2a45] transition disabled:opacity-50">
              {solicitando ? 'Validando...' : 'Liberar acesso'}
            </button>
          </form>

          {gateMsg && (
            <div className={`mt-4 text-sm rounded-lg px-3 py-2 border ${gateMsgTipo === 'error'
              ? 'text-red-700 bg-red-50 border-red-200'
              : 'text-emerald-700 bg-emerald-50 border-emerald-200'}`}>
              {gateMsg}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (verificandoSessao || loadingEvento) {
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

  // ═══════════════════════════════════════════════════════════
  // CARD DE CONFIRMAÇÃO (Fase 1 → aguarda operador confirmar)
  // ═══════════════════════════════════════════════════════════
  const CardConfirmacao = () => {
    if (!pendingConfirm) return null;
    const { inscricao: ins, nomeSup: ns, nomeCampo: nc, contexto: ctx } = pendingConfirm;
    const isRefeitorio = modoCheckin === 'refeitorio';
    const isPlenaria   = modoCheckin === 'plenaria';
    const statusPago   = ['pago', 'isento'].includes(String(ins.status_pagamento || '').toLowerCase());

    const statusColor = statusPago ? 'bg-emerald-500' : 'bg-amber-500';
    const statusLabel = PAGAMENTO_LABELS[ins.status_pagamento] ?? ins.status_pagamento;

    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center p-4 bg-gray-950/95">
        <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl overflow-hidden">
          {/* Cabeçalho colorido */}
          <div className="bg-[#0D2B4E] px-6 py-4 text-center">
            <p className="text-white/70 text-xs font-semibold uppercase tracking-widest mb-1">
              {isPlenaria ? '🏛️ Check-in Plenária' : isRefeitorio ? '🍽️ Refeição' : '🎫 Credenciamento'}
            </p>
            <p className="text-white text-xl font-black leading-tight">{ins.nome_inscrito}</p>
          </div>

          {/* Foto (se existir) */}
          {ins.foto_url && (
            <div className="flex justify-center -mt-1 bg-[#0D2B4E] pb-3">
              <img
                src={ins.foto_url}
                alt={ins.nome_inscrito}
                className="w-20 h-20 rounded-full object-cover border-4 border-white shadow-lg"
                onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
            </div>
          )}

          {/* Dados */}
          <div className="px-5 py-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Supervisão</span>
              <span className="font-semibold text-gray-900 text-right max-w-[60%]">{ns}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Campo</span>
              <span className="font-semibold text-gray-900 text-right max-w-[60%]">{nc}</span>
            </div>
            {ins.tipo_inscricao && (
              <div className="flex justify-between">
                <span className="text-gray-500">Tipo</span>
                <span className="font-semibold text-gray-900">{ins.tipo_inscricao}</span>
              </div>
            )}
            <div className="flex justify-between items-center">
              <span className="text-gray-500">Pagamento</span>
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full text-white ${statusColor}`}>
                {statusLabel}
              </span>
            </div>
            {ins.hospedagem !== undefined && (
              <div className="flex justify-between">
                <span className="text-gray-500">Hospedagem</span>
                <span className="font-semibold">{ins.hospedagem ? '✅ Sim' : '—'}</span>
              </div>
            )}
            {ins.alimentacao !== undefined && (
              <div className="flex justify-between">
                <span className="text-gray-500">Alimentação</span>
                <span className="font-semibold">{ins.alimentacao ? '✅ Sim' : '❌ Não'}</span>
              </div>
            )}
            {isRefeitorio && (
              <div className="mt-2 bg-gray-50 rounded-xl px-4 py-3 flex justify-around text-center">
                <div>
                  <p className="text-xs text-gray-400">Total</p>
                  <p className="text-xl font-black text-gray-800">{ctx.refeicoes_total}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">Usadas</p>
                  <p className="text-xl font-black text-amber-600">{ctx.refeicoes_usadas}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">Saldo</p>
                  <p className={`text-xl font-black ${ctx.refeicoes_saldo > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {ctx.refeicoes_saldo}
                  </p>
                </div>
              </div>
            )}
            {/* Plenária: já registrou HOJE nesta sessão — bloqueia */}
            {isPlenaria && ctx.plenaria_hoje && (
              <div className="bg-red-50 border border-red-300 rounded-xl px-3 py-3 text-center">
                <p className="text-red-800 text-xs font-black">🚫 Participante já registrado nesta plenária.</p>
                {ctx.plenaria_hoje_at && (
                  <p className="text-red-700 text-xs mt-1">
                    Registrado em: {new Date(ctx.plenaria_hoje_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                    {ctx.plenaria_hoje_operador ? ` · por ${ctx.plenaria_hoje_operador}` : ''}
                  </p>
                )}
              </div>
            )}

            {/* Plenária: registrou em dia ANTERIOR — apenas informativo, não bloqueia */}
            {isPlenaria && !ctx.plenaria_hoje && ctx.plenaria_ultimo_at && (
              <div className="bg-blue-50 border border-blue-200 rounded-xl px-3 py-2 text-blue-800 text-xs text-center">
                ℹ️ Último registro: {new Date(ctx.plenaria_ultimo_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                {ctx.plenaria_ultimo_data ? ` (dia ${ctx.plenaria_ultimo_data})` : ''}
              </div>
            )}
            {ins.checkin_realizado && modoCheckin === 'credenciamento' && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-amber-800 text-xs font-semibold text-center">
                ⚠️ Check-in já realizado em {fmtDT(ins.checkin_at)}
              </div>
            )}
            {ctx.pagamento_pendente && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-red-800 text-xs font-semibold text-center">
                💳 Pagamento pendente — refeição bloqueada
              </div>
            )}
            {ctx.sem_alimentacao && isRefeitorio && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-red-800 text-xs font-semibold text-center">
                ⛔ Esta inscrição não inclui alimentação
              </div>
            )}
          </div>

          {/* Botões */}
          <div className="px-5 pb-5 flex flex-col gap-3">
            <button
              onClick={() => void confirmarCheckin()}
              disabled={confirmando || (isPlenaria && ctx.plenaria_hoje)}
              className={`w-full active:scale-95 disabled:opacity-50 text-white font-black text-lg py-4 rounded-2xl shadow-lg transition ${
                isPlenaria && ctx.plenaria_hoje
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-emerald-500 hover:bg-emerald-400'
              }`}
            >
              {confirmando
                ? '⏳ Registrando...'
                : isPlenaria && ctx.plenaria_hoje
                  ? '🚫 Já registrado nesta plenária'
                  : isRefeitorio
                    ? '✅ Confirmar Refeição'
                    : isPlenaria && ctx.plenaria_ultimo_at
                      ? '✅ Registrar nova presença (novo dia)'
                      : '✅ Confirmar Check-in'}
            </button>
            <button
              onClick={cancelarConfirmacao}
              disabled={confirmando}
              className="w-full bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold py-3 rounded-2xl transition text-sm"
            >
              ✕ Cancelar / Ler outro QR
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ═══════════════════════════════════════════════════════════
  // OVERLAY DE RESULTADO (Fase 2 → feedback após confirmação)
  // ═══════════════════════════════════════════════════════════
  const OverlayResultado = () => {
    if (!resultado) return null;
    const { estado, inscricao, nomeSup: ns, nomeCampo: nc, message } = resultado;

    const configs: Record<EstadoScan, { bg: string; icon: string; titulo: string; tituloCls: string }> = {
      success: {
        bg: 'bg-emerald-600',
        icon: '✅',
        titulo: modoCheckin === 'refeitorio' ? 'REFEIÇÃO LIBERADA' : 'CHECK-IN CONFIRMADO',
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
        titulo: message || 'QR Code não reconhecido.',
        tituloCls: 'text-white text-xl font-black tracking-wide',
      },
      wrong_event: {
        bg: 'bg-orange-700',
        icon: '🚫',
        titulo: 'INSCRIÇÃO NÃO PERTENCE A ESTE EVENTO',
        tituloCls: 'text-white text-xl font-black tracking-wide',
      },
      sem_saldo: {
        bg: 'bg-red-900',
        icon: '🚫',
        titulo: 'SEM REFEIÇÕES DISPONÍVEIS',
        tituloCls: 'text-white text-2xl font-black tracking-wide',
      },
      sem_alimentacao: {
        bg: 'bg-red-900',
        icon: '⛔',
        titulo: 'INSCRIÇÃO SEM ALIMENTAÇÃO',
        tituloCls: 'text-white text-2xl font-black tracking-wide',
      },
      pagamento_pendente: {
        bg: 'bg-orange-800',
        icon: '💳',
        titulo: 'PAGAMENTO NÃO CONFIRMADO',
        tituloCls: 'text-white text-2xl font-black tracking-wide',
      },
      duplicate_rapida: {
        bg: 'bg-slate-800',
        icon: '⏱️',
        titulo: 'LEITURA REPETIDA — AGUARDE',
        tituloCls: 'text-white text-2xl font-black tracking-wide',
      },
      already_plenaria: {
        bg: 'bg-orange-700',
        icon: '📋',
        titulo: 'PRESENÇA JÁ REGISTRADA HOJE',
        tituloCls: 'text-white text-2xl font-black tracking-wide',
      },
      idle: { bg: '', icon: '', titulo: '', tituloCls: '' },
      processing: { bg: '', icon: '', titulo: '', tituloCls: '' },
    };

    const cfg = configs[estado];

    return (
      <div className={`fixed inset-0 z-50 flex flex-col items-center justify-center p-8 ${cfg.bg}`}
        onClick={voltarParaScan}>
        <span className="text-8xl mb-6 block animate-bounce">{cfg.icon}</span>
        <p className={cfg.tituloCls + ' text-center mb-4'}>{cfg.titulo}</p>

        {estado === 'invalid' && ultimoQr && (
          <div className="text-white/70 text-xs text-center max-w-sm break-all mt-2">
            <p>Token lido: {ultimoQr.token || ultimoQr.raw || '-'}</p>
          </div>
        )}

        {inscricao && (['success','already','wrong_event','sem_saldo','sem_alimentacao','pagamento_pendente','duplicate_rapida','already_plenaria'] as EstadoScan[]).includes(estado) && (
          <div className="bg-white/20 rounded-2xl p-5 text-white text-center max-w-sm w-full">
            <p className="text-2xl font-bold mb-1">{inscricao.nome_inscrito}</p>
            {ns && <p className="text-sm opacity-80">{ns}</p>}
            {nc && <p className="text-sm opacity-80">{nc}</p>}
            {estado === 'already' && inscricao.checkin_at && (
              <p className="mt-3 text-sm bg-white/20 rounded-lg px-3 py-2">Check-in em: {fmtDT(inscricao.checkin_at)}</p>
            )}
            {estado === 'success' && resultado?.saldoRestante != null && (
              <p className="mt-3 text-sm bg-white/20 rounded-lg px-3 py-2">🍽️ Refeições restantes: <strong>{resultado.saldoRestante}</strong></p>
            )}
            {estado === 'already_plenaria' && resultado?.dataPlenaria && (
              <p className="mt-3 text-sm bg-white/20 rounded-lg px-3 py-2">Presença já registrada em: {resultado.dataPlenaria}</p>
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
      <CardConfirmacao />
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

      {/* ── MODO CHECKIN (Credenciamento / Plenária / Refeitório) ─ */}
      <div className="flex border-b border-white/10 flex-shrink-0 bg-[#0D2B4E]">
        {(['credenciamento', 'plenaria', 'refeitorio'] as const).map(m => (
          <button
            key={m}
            onClick={() => { if (!modoForcado) setModoCheckin(m); }}
            disabled={!!modoForcado}
            className={`flex-1 py-2 text-xs font-bold uppercase transition ${modoCheckin === m ? 'text-emerald-400 border-b-2 border-emerald-400' : 'text-white/50'} ${modoForcado ? 'opacity-90 cursor-default' : ''}`}
          >
            {m === 'credenciamento' ? '🎫 Entrada' : m === 'plenaria' ? '🏛️ Plenária' : '🍽️ Refeitório'}
          </button>
        ))}
      </div>

      {/* ── MODO MANUAL / CÂMERA toggle ─────────────────────── */}
      <div className="flex border-b border-white/10 flex-shrink-0">
        <button
          onClick={() => { setModoManual(false); setBuscaManual(''); setResultadosManual([]); void iniciarScanner(); }}
          className={`flex-1 py-3 text-sm font-semibold transition ${!modoManual ? 'text-emerald-400 border-b-2 border-emerald-400' : 'text-white/50'}`}>
          📷 Câmera
        </button>
        <button
          onClick={() => { setModoManual(true); void stopScanner(); setResultado(null); setCameraMsg(null); }}
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
                  onClick={() => { void iniciarScanner(); }}
                  className="bg-emerald-500 hover:bg-emerald-400 text-white font-bold py-5 px-12 rounded-2xl text-lg shadow-xl transition active:scale-95">
                  Iniciar Scanner
                </button>
                {cameraMsg && (
                  <p className="text-amber-400 text-center mt-6 text-sm font-semibold">{cameraMsg}</p>
                )}
              </div>
            ) : (
              <div className="w-full">
                {/* Região do scanner html5-qrcode */}
                <div id={scannerElementId} className="w-full" />
                <div className="px-4 py-3 flex justify-center">
                  <button
                    onClick={() => { void stopScanner(); setCameraMsg(null); }}
                    className="text-sm text-white/50 hover:text-white underline">
                    Parar câmera
                  </button>
                </div>
                {cameraMsg && (
                  <p className="text-amber-400 text-center mt-2 text-sm font-semibold px-4">{cameraMsg}</p>
                )}
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
