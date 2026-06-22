'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useRequireSupabaseAuth } from '@/hooks/useRequireSupabaseAuth';
import { useEventosPerfil } from '@/hooks/useEventosPerfil';
import { clearEquipeSession, getEquipeSession, setEquipeSession } from '@/lib/equipe-session';
import type { EquipeSession } from '@/lib/equipe-session';

// ─── Tipos ───────────────────────────────────────────────────
interface CheckinData {
  inscricao: {
    id: string;
    nome: string;
    cpf: string | null;
    sexo: string | null;
    categoria: string | null;
    supervisao_id: string | null;
    campo_id: string | null;
    status_pagamento: string;
  };
  hospedagem: {
    id: string;
    status: string;
    alojamento_nome: string | null;
    tipo_cama: string | null;
    numero_cama: string | null;
    checkin_at: string | null;
    checkout_at: string | null;
    checkin_operador: string | null;
    checkout_operador: string | null;
  } | null;
  leito: {
    numero: string;
    tipo_leito: string;
    posicao: string;
  } | null;
}

const STATUS_LABEL: Record<string, string> = {
  solicitada:        '📋 Solicitada',
  alocada:           '🏠 Alocada',
  confirmada:        '✅ Confirmada',
  checkin_realizado: '🟢 Check-in realizado',
  checkout_realizado:'🔴 Check-out realizado',
  lista_espera:      '⏳ Lista de espera',
  cancelada:         '❌ Cancelada',
};

const TIPO_LEITO: Record<string, string> = {
  beliche:    'Beliche',
  colchonete: 'Colchonete',
  rede:       'Rede',
  cama:       'Cama',
};

const POSICAO: Record<string, string> = {
  superior: '⬆ Superior',
  inferior: '⬇ Inferior',
  unico:    'Único',
};

// ─── Componente ──────────────────────────────────────────────
export default function HospedagemCheckinPage() {
  const params  = useParams<{ id: string }>();
  const router  = useRouter();
  const eventoId = params.id;
  const { user, loading: authLoading } = useRequireSupabaseAuth({ allowEquipeSession: { eventoId }, allowAnonymous: true });
  const perfil = useEventosPerfil();

  const inputRef  = useRef<HTMLInputElement>(null);

  const [query,        setQuery]        = useState('');
  const [buscando,     setBuscando]     = useState(false);
  const [data,         setData]         = useState<CheckinData | null>(null);
  const [erro,         setErro]         = useState<string | null>(null);
  const [equipeSessao, setEquipeSessaoState] = useState<EquipeSession | null>(null);
  const [emailAcesso, setEmailAcesso] = useState('');
  const [solicitandoAcesso, setSolicitandoAcesso] = useState(false);
  const [operador,     setOperador]     = useState('');
  const [confirmando,  setConfirmando]  = useState(false);
  const [sucessoMsg,   setSucessoMsg]   = useState<string | null>(null);

  const semAcessoDireto = !authLoading && !perfil.loading && !perfil.isGlobal && !!eventoId && !perfil.podeAcessarEvento(eventoId);
  const permissaoEvento = eventoId ? perfil.permissaoParaEvento(eventoId) : null;
  const rolesPermitidos = ['admin_evento', 'operador', 'checkin', 'hospedagem', 'checkin_hospedagem'];
  const perfilBloqueado = !perfil.loading && !perfil.isGlobal && !equipeSessao && !!permissaoEvento && !rolesPermitidos.includes(permissaoEvento);
  const precisaGate = !authLoading && !perfil.loading && !equipeSessao && (!user || semAcessoDireto);

  useEffect(() => {
    const sess = getEquipeSession();
    if (sess && sess.eventoId === eventoId && (sess.tipo === 'checkin_hospedagem' || sess.tipo === 'hospedagem' || sess.tipo === 'operador' || sess.tipo === 'checkin')) {
      setEquipeSessaoState(sess);
    } else {
      setEquipeSessaoState(null);
    }
  }, [eventoId]);

  async function solicitarAcesso() {
    if (!emailAcesso.trim()) {
      setErro('Informe o e-mail cadastrado.');
      return;
    }
    setSolicitandoAcesso(true);
    setErro(null);
    try {
      const res = await fetch(`/api/eventos/${eventoId}/checkin/solicitar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailAcesso.trim(), funcao: 'checkin_hospedagem' }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        setErro((json as { error?: string }).error || 'E-mail não autorizado para esta função.');
        return;
      }
      const sessao: EquipeSession = {
        eventoId,
        equipeId: json.equipe_id as string,
        tipo: 'checkin_hospedagem',
        expiraEm: (json.expira_em as string) || new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
      };
      setEquipeSession(sessao);
      setEquipeSessaoState(sessao);
    } catch {
      setErro('Erro ao validar acesso.');
    } finally {
      setSolicitandoAcesso(false);
    }
  }

  // Foca no input ao montar
  useEffect(() => { inputRef.current?.focus(); }, []);

  // Limpa mensagem de sucesso após 3s
  useEffect(() => {
    if (!sucessoMsg) return;
    const t = setTimeout(() => {
      setSucessoMsg(null);
      setData(null);
      setQuery('');
      inputRef.current?.focus();
    }, 3000);
    return () => clearTimeout(t);
  }, [sucessoMsg]);

  const buscar = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    setBuscando(true);
    setErro(null);
    setData(null);
    setSucessoMsg(null);
    try {
      const res = await fetch(
        `/api/eventos/${eventoId}/hospedagens/checkin?q=${encodeURIComponent(trimmed)}${equipeSessao ? `&equipe_id=${encodeURIComponent(equipeSessao.equipeId)}` : ''}`,
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Não encontrado.');
      setData(json as CheckinData);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao buscar.');
    } finally {
      setBuscando(false);
    }
  }, [eventoId]);

  async function confirmar(acao: 'checkin' | 'checkout') {
    if (!data) return;
    setConfirmando(true);
    setErro(null);
    try {
      const res = await fetch(`/api/eventos/${eventoId}/hospedagens/checkin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inscricao_id: data.inscricao.id,
          acao,
          operador: operador.trim() || null,
          equipe_id: equipeSessao?.equipeId || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Erro ao confirmar.');
      setSucessoMsg(
        acao === 'checkin'
          ? `✅ Check-in registrado para ${data.inscricao.nome}!`
          : `🔴 Check-out registrado para ${data.inscricao.nome}!`,
      );
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro.');
    } finally {
      setConfirmando(false);
    }
  }

  const status  = data?.hospedagem?.status;
  const podeCheckin  = data?.hospedagem && !['checkin_realizado','checkout_realizado','lista_espera','cancelada'].includes(status ?? '');
  const podeCheckout = status === 'checkin_realizado';

  if (precisaGate) {
    return (
      <div className="min-h-screen bg-[#0D2B4E] flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg w-full max-w-md p-6">
          <h1 className="text-lg font-bold text-[#123b63] mb-2">Acesso ao Check-in de Hospedagem</h1>
          <p className="text-sm text-gray-600 mb-4">Informe o e-mail cadastrado na equipe do evento.</p>
          {erro && <div className="mb-3 bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm">{erro}</div>}
          <div className="space-y-3">
            <input
              type="email"
              value={emailAcesso}
              onChange={(e) => setEmailAcesso(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              placeholder="email@exemplo.com"
            />
            <button
              onClick={solicitarAcesso}
              disabled={solicitandoAcesso}
              className="w-full bg-[#123b63] text-white rounded-lg py-2 text-sm font-semibold hover:bg-[#0f2a45] disabled:opacity-50"
            >
              {solicitandoAcesso ? 'Validando...' : 'Entrar'}
            </button>
            <button
              onClick={() => { clearEquipeSession(); router.push(`/eventos/${eventoId}`); }}
              className="w-full border border-gray-300 rounded-lg py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              Voltar
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (perfilBloqueado) {
    return (
      <div className="min-h-screen bg-[#0D2B4E] flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg w-full max-w-md p-6 text-center">
          <h1 className="text-lg font-bold text-[#123b63] mb-2">Acesso não autorizado para esta função.</h1>
          <p className="text-sm text-gray-600">Use o acesso de Hospedagem ou Check-in de Hospedagem.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0D2B4E] flex flex-col">
      {/* Header */}
      <header className="bg-[#0a1e38] border-b border-white/10 px-4 py-3 flex items-center gap-4">
        <button
          onClick={() => router.back()}
          className="text-white/70 hover:text-white text-xl leading-none"
        >
          ←
        </button>
        <h1 className="text-white font-bold text-lg tracking-tight flex-1">
          🛏️ Check-in de Hospedagem
        </h1>
      </header>

      <main className="flex-1 flex flex-col items-center justify-start p-4 sm:p-8 gap-6 max-w-lg mx-auto w-full">

        {/* Input de busca */}
        <div className="w-full bg-white rounded-2xl shadow-lg p-5 space-y-4">
          <p className="text-sm text-gray-500 text-center">
            Digite o CPF ou ID da inscrição
          </p>
          <div className="flex gap-2">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') buscar(query); }}
              placeholder="CPF ou ID da inscrição…"
              className="flex-1 border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#123b63]"
            />
            <button
              onClick={() => buscar(query)}
              disabled={buscando || !query.trim()}
              className="bg-[#123b63] text-white px-5 py-3 rounded-xl font-bold text-sm hover:bg-[#0f2a45] transition disabled:opacity-40"
            >
              {buscando ? '⏳' : '🔍'}
            </button>
          </div>

          {erro && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm font-medium">
              ⚠️ {erro}
            </div>
          )}
        </div>

        {/* Sucesso */}
        {sucessoMsg && (
          <div className="w-full bg-emerald-500 text-white rounded-2xl shadow-lg p-6 text-center font-bold text-lg">
            {sucessoMsg}
          </div>
        )}

        {/* Card do participante */}
        {data && !sucessoMsg && (
          <div className="w-full bg-white rounded-2xl shadow-lg overflow-hidden">
            {/* Cabeçalho */}
            <div className="bg-[#123b63] px-5 py-4">
              <p className="text-white font-black text-lg leading-tight">{data.inscricao.nome}</p>
              <p className="text-blue-200 text-xs mt-0.5">{data.inscricao.categoria ?? '—'} · {data.inscricao.sexo === 'M' ? 'Masculino' : data.inscricao.sexo === 'F' ? 'Feminino' : '—'}</p>
            </div>

            {/* Status */}
            <div className="px-5 pt-4">
              <span className={`text-sm font-bold px-3 py-1 rounded-full ${
                status === 'checkin_realizado'  ? 'bg-emerald-100 text-emerald-700' :
                status === 'checkout_realizado' ? 'bg-gray-100 text-gray-600'      :
                status === 'confirmada'         ? 'bg-blue-100 text-blue-700'      :
                status === 'lista_espera'       ? 'bg-orange-100 text-orange-700'  :
                'bg-yellow-100 text-yellow-700'
              }`}>
                {STATUS_LABEL[status ?? ''] ?? status}
              </span>
            </div>

            {/* Detalhes */}
            <div className="px-5 py-4 space-y-2">
              {[
                { label: 'CPF',           value: data.inscricao.cpf ?? '—' },
                { label: 'Alojamento',    value: data.hospedagem?.alojamento_nome ?? 'Não alocado' },
                { label: 'Leito nº',      value: data.hospedagem?.numero_cama ?? data.leito?.numero ?? '—' },
                { label: 'Tipo de leito', value: data.leito ? TIPO_LEITO[data.leito.tipo_leito] ?? data.leito.tipo_leito : (data.hospedagem?.tipo_cama ?? '—') },
                { label: 'Posição',       value: data.leito ? POSICAO[data.leito.posicao] ?? data.leito.posicao : '—' },
              ].map(r => (
                <div key={r.label} className="flex justify-between items-baseline border-b border-gray-50 pb-1.5">
                  <span className="text-xs text-gray-500 font-medium">{r.label}</span>
                  <span className="text-sm font-semibold text-gray-800">{r.value}</span>
                </div>
              ))}

              {data.hospedagem?.checkin_at && (
                <div className="flex justify-between items-baseline border-b border-gray-50 pb-1.5">
                  <span className="text-xs text-gray-500 font-medium">Check-in em</span>
                  <span className="text-xs font-semibold text-emerald-700">
                    {new Date(data.hospedagem.checkin_at).toLocaleString('pt-BR')}
                    {data.hospedagem.checkin_operador ? ` · ${data.hospedagem.checkin_operador}` : ''}
                  </span>
                </div>
              )}
              {data.hospedagem?.checkout_at && (
                <div className="flex justify-between items-baseline pb-1.5">
                  <span className="text-xs text-gray-500 font-medium">Check-out em</span>
                  <span className="text-xs font-semibold text-rose-700">
                    {new Date(data.hospedagem.checkout_at).toLocaleString('pt-BR')}
                    {data.hospedagem.checkout_operador ? ` · ${data.hospedagem.checkout_operador}` : ''}
                  </span>
                </div>
              )}
            </div>

            {/* Operador */}
            {(podeCheckin || podeCheckout) && (
              <div className="px-5 pb-3">
                <input
                  type="text"
                  value={operador}
                  onChange={e => setOperador(e.target.value)}
                  placeholder="Operador responsável (opcional)"
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#123b63]"
                />
              </div>
            )}

            {/* Botões */}
            <div className="px-5 pb-5 flex flex-col gap-3">
              {data.hospedagem === null && (
                <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-4 py-3 text-sm text-center">
                  ⚠️ Participante ainda não foi alocado em nenhum alojamento.
                </div>
              )}

              {podeCheckin && (
                <button
                  onClick={() => confirmar('checkin')}
                  disabled={confirmando}
                  className="w-full bg-emerald-600 text-white py-4 rounded-xl font-black text-base hover:bg-emerald-700 transition disabled:opacity-50 tracking-wide"
                >
                  {confirmando ? '⏳ Registrando...' : '✅ CONFIRMAR ENTRADA'}
                </button>
              )}

              {podeCheckout && (
                <button
                  onClick={() => confirmar('checkout')}
                  disabled={confirmando}
                  className="w-full bg-rose-600 text-white py-4 rounded-xl font-black text-base hover:bg-rose-700 transition disabled:opacity-50 tracking-wide"
                >
                  {confirmando ? '⏳ Registrando...' : '🔴 CONFIRMAR SAÍDA'}
                </button>
              )}

              {status === 'checkout_realizado' && (
                <div className="bg-gray-100 text-gray-500 rounded-xl px-4 py-3 text-sm text-center">
                  Participante já realizou check-out.
                </div>
              )}
              {status === 'lista_espera' && (
                <div className="bg-orange-50 border border-orange-200 text-orange-700 rounded-xl px-4 py-3 text-sm text-center">
                  ⏳ Participante está na lista de espera. Aloque antes de fazer check-in.
                </div>
              )}
            </div>
          </div>
        )}

        {/* Sem dados */}
        {!data && !buscando && !erro && !sucessoMsg && (
          <div className="text-white/50 text-center text-sm mt-4">
            <p className="text-5xl mb-3">🔍</p>
            <p>Digite o CPF ou ID do participante acima</p>
          </div>
        )}
      </main>
    </div>
  );
}
