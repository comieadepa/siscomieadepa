'use client';

import { useState, useEffect, useRef, useMemo, useCallback, type FormEvent } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useEventosPerfil } from '@/hooks/useEventosPerfil';
import { useRequireSupabaseAuth } from '@/hooks/useRequireSupabaseAuth';
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
  | 'sem_saldo'
  | 'already_plenaria';

interface ResultadoScan {
  estado: EstadoScan;
  inscricao?: Inscricao;
  nomeSup?: string;
  nomeCampo?: string;
  saldoRestante?: number | null;
  dataPlenaria?: string;
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
  const { user, loading: authLoading } = useRequireSupabaseAuth({ allowEquipeSession: { eventoId: id }, allowAnonymous: true });
  const perfil = useEventosPerfil();
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [equipeSessao, setEquipeSessao] = useState<EquipeSession | null>(null);
  const [codigoAcesso, setCodigoAcesso] = useState('');
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

  // Estado do scanner
  const [scannerAtivo,  setScannerAtivo]  = useState(false);
  const [resultado,     setResultado]     = useState<ResultadoScan | null>(null);
  const [processando,   setProcessando]   = useState(false);
  const [ultimoQr, setUltimoQr] = useState<{ raw: string; token: string } | null>(null);
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

  const [cameraMsg, setCameraMsg] = useState<string | null>(null);
  const cameraErroRef = useRef<string | null>(null);
  const iniciandoRef = useRef(false);

  const semAcessoDireto = !authLoading && !perfil.loading && !perfil.isGlobal && !!id && !perfil.podeAcessarEvento(id);
  const precisaGate = !authLoading && !perfil.loading && !equipeSessao && (!user || semAcessoDireto);

  useEffect(() => {
    const sess = getEquipeSession();
    if (sess && sess.eventoId === id && sess.tipo === 'checkin') {
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

  const validarSessaoEquipe = useCallback(async (): Promise<Evento | null> => {
    if (!equipeSessao || !id) return null;
    try {
      const res = await fetch(`/api/eventos/${id}/checkin/validar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ equipe_id: equipeSessao.equipeId }),
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
  }, [equipeSessao, id]);

  // ── Carrega evento e dados base ───────────────────────────
  useEffect(() => {
    if (authLoading || perfil.loading) return;

    if (precisaGate) {
      setLoadingEvento(false);
      return;
    }

    // Gate de acesso (departamento admin com evento de outro dept)

    async function load() {
      let eventoEquipe: Evento | null = null;
      if (equipeSessao) {
        eventoEquipe = await validarSessaoEquipe();
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
      // Gate de departamento: isDeptAdmin só acessa eventos do seu dept (exceto subcategoria TODOS)
      if (eventoData && perfil.isDeptAdmin && perfil.departamentoUsuario !== 'TODOS' && eventoData.departamento !== perfil.departamentoUsuario) {
        setAcessoMotivo('nao_autorizado');
        setAcessoNegado(true); setLoadingEvento(false); return;
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
  }, [authLoading, perfil.loading, perfil.isGlobal, perfil.isDeptAdmin, perfil.departamentoUsuario, id, supabase, precisaGate, perfil.podeAcessarEvento, carregarContadores, equipeSessao, validarSessaoEquipe]);

  async function solicitarAcesso(e: FormEvent) {
    e.preventDefault();
    setGateMsg(null);
    setGateMsgTipo('success');
    if (!id) {
      setGateMsg('Evento invalido.');
      setGateMsgTipo('error');
      return;
    }
    const codigo = codigoAcesso.trim();
    if (!codigo) {
      setGateMsg('Informe o codigo de acesso.');
      setGateMsgTipo('error');
      return;
    }
    if (!/^\d{4}$/.test(codigo)) {
      setGateMsg('Codigo invalido. Use os 4 digitos enviados por e-mail.');
      setGateMsgTipo('error');
      return;
    }

    setSolicitando(true);
    try {
      const res = await fetch(`/api/eventos/${id}/checkin/solicitar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigo }),
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
      };
      setEquipeSession(sessao);
      setEquipeSessao(sessao);
      setAcessoNegado(false);
      setAcessoMotivo(null);
      setLoadingEvento(true); // força spinner enquanto o evento carrega após gate
      setCodigoAcesso('');
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

  // ── Processa QR Code lido ─────────────────────────────────
  async function onQRCodeSuccess(qrText: string) {
    if (ignorandoRef.current || processando) return;
    ignorandoRef.current = true;
    setProcessando(true);
    emitirSom('leitura');

    // Pausa o scanner enquanto processa
    if (scannerRef.current) {
      try {
        await (scannerRef.current as { pause: () => void }).pause();
      } catch { /* ignora */ }
    }

    try {
      const rawText = String(qrText || '').trim();
      const qrToken = extractQrToken(rawText);
      setUltimoQr({ raw: rawText, token: qrToken });
      if (!qrToken) {
        setResultado({ estado: 'invalid' });
        emitirSom('erro');
        vibrar('erro');
        setTimeout(() => voltarParaScan(), 4000);
        return;
      }

      const res = await fetch(`/api/eventos/${id}/checkin/registrar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          qr: qrToken,
          equipe_id: equipeSessao?.equipeId,
          tipo_checkin: modoCheckin,
          data_plenaria: modoCheckin === 'plenaria' ? new Date().toISOString().slice(0, 10) : undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        setResultado({ estado: 'invalid' });
        emitirSom('erro');
        vibrar('erro');
        setTimeout(() => voltarParaScan(), 1500);
        return;
      }

      const status = (json?.status as EstadoScan | undefined) ?? 'invalid';
      const inscricao = (json?.inscricao as Inscricao | undefined) ?? undefined;

      if (status === 'invalid' || !inscricao) {
        setResultado({ estado: 'invalid' });
        emitirSom('erro');
        vibrar('erro');
        setTimeout(() => voltarParaScan(), 1500);
        return;
      }

      const nomeSup   = supervisoes.find(s => s.id === inscricao.supervisao_id)?.nome ?? '-';
      const nomeCampo = campos.find(c => c.id === inscricao.campo_id)?.nome ?? '-';

      if (status === 'wrong_event') {
        setResultado({ estado: 'wrong_event', inscricao, nomeSup, nomeCampo });
        emitirSom('erro');
        vibrar('erro');
        setTimeout(() => voltarParaScan(), 2000);
        return;
      }

      if (status === 'already') {
        setResultado({ estado: 'already', inscricao, nomeSup, nomeCampo });
        emitirSom('erro');
        vibrar('erro');
        setTimeout(() => voltarParaScan(), 2000);
        return;
      }

      if (status === 'sem_saldo') {
        setResultado({ estado: 'sem_saldo', inscricao, nomeSup, nomeCampo, saldoRestante: 0 });
        emitirSom('erro');
        vibrar('erro');
        setTimeout(() => voltarParaScan(), 3000);
        return;
      }

      if (status === 'already_plenaria') {
        setResultado({ estado: 'already_plenaria', inscricao, nomeSup, nomeCampo, dataPlenaria: (json?.data_plenaria as string | undefined) });
        emitirSom('erro');
        vibrar('erro');
        setTimeout(() => voltarParaScan(), 2500);
        return;
      }

      setResultado({ estado: 'success', inscricao, nomeSup, nomeCampo, saldoRestante: (json?.saldo_depois as number | null | undefined) ?? null });
      emitirSom('sucesso');
      vibrar('sucesso');
      void carregarContadores();
      setTimeout(() => voltarParaScan(), 1500);

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

  // ── Gate de e-mail (verificado ANTES de acessoNegado, pois evento ainda é null neste ponto) ──
  if (precisaGate) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 w-full max-w-md text-center text-gray-800">
          <div className="text-3xl mb-3">🔐</div>
          <h1 className="text-lg font-bold text-[#123b63]">Acesso ao Check-in</h1>
          <p className="text-sm text-gray-500 mt-2">Informe o codigo de 4 digitos enviado por e-mail.</p>

          <form onSubmit={solicitarAcesso} className="mt-4 space-y-3">
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={4}
              placeholder="0000"
              value={codigoAcesso}
              onChange={e => setCodigoAcesso(e.target.value.replace(/\D/g, '').slice(0, 4))}
              className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#123b63] text-center tracking-widest"
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
      sem_saldo: {
        bg: 'bg-red-900',
        icon: '🚫',
        titulo: 'SEM REFEIÇÕES DISPONÍVEIS',
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
        <p className={cfg.tituloCls + ' text-center mb-6'}>{cfg.titulo}</p>

        {(estado === 'invalid' || estado === 'wrong_event') && ultimoQr && (
          <div className="text-white/80 text-xs text-center max-w-sm break-all">
            <p>Texto lido: {ultimoQr.raw || '-'}</p>
            <p>Token extraido: {ultimoQr.token || '-'}</p>
          </div>
        )}

        {inscricao && (estado === 'success' || estado === 'already' || estado === 'wrong_event' || estado === 'sem_saldo' || estado === 'already_plenaria') && (
          <div className="bg-white/20 rounded-2xl p-6 text-white text-center max-w-sm w-full">
            <p className="text-2xl font-bold mb-1">{inscricao.nome_inscrito}</p>
            {ns && <p className="text-sm opacity-80">{ns}</p>}
            {nc && <p className="text-sm opacity-80">{nc}</p>}
            {estado === 'already' && inscricao.checkin_at && (
              <p className="mt-3 text-sm bg-white/20 rounded-lg px-3 py-2">
                Check-in em: {fmtDT(inscricao.checkin_at)}
              </p>
            )}
            {estado === 'success' && resultado?.saldoRestante != null && (
              <p className="mt-3 text-sm bg-white/20 rounded-lg px-3 py-2">
                🍽️ Refeições restantes: <strong>{resultado.saldoRestante}</strong>
              </p>
            )}
            {estado === 'sem_saldo' && (
              <p className="mt-3 text-sm bg-white/20 rounded-lg px-3 py-2">
                Todas as refeições já foram utilizadas.
              </p>
            )}
            {estado === 'already_plenaria' && resultado?.dataPlenaria && (
              <p className="mt-3 text-sm bg-white/20 rounded-lg px-3 py-2">
                Presença já registrada em: {resultado.dataPlenaria}
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

      {/* ── MODO CHECKIN (Credenciamento / Plenária / Refeitório) ─ */}
      <div className="flex border-b border-white/10 flex-shrink-0 bg-[#0D2B4E]">
        {(['credenciamento', 'plenaria', 'refeitorio'] as const).map(m => (
          <button
            key={m}
            onClick={() => setModoCheckin(m)}
            className={`flex-1 py-2 text-xs font-bold uppercase transition ${modoCheckin === m ? 'text-emerald-400 border-b-2 border-emerald-400' : 'text-white/50'}`}
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
