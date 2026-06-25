'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
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
    hospedagem: boolean;
    alimentacao: boolean | string | null;
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

  const inputRef  = useRef<HTMLInputElement>(null);

  const [query,          setQuery]          = useState('');
  const [buscando,       setBuscando]       = useState(false);
  const [searchResults,  setSearchResults]  = useState<CheckinData[]>([]);
  const [data,           setData]           = useState<CheckinData | null>(null);
  const [erro,           setErro]           = useState<string | null>(null);
  const [equipeSessao,   setEquipeSessaoState] = useState<EquipeSession | null>(null);
  const [emailAcesso,    setEmailAcesso]    = useState('');
  const [solicitandoAcesso, setSolicitandoAcesso] = useState(false);
  const [operador,       setOperador]       = useState('');
  const [confirmando,    setConfirmando]    = useState(false);
  const [sucessoMsg,     setSucessoMsg]     = useState<string | null>(null);
  const [verificandoSessao, setVerificandoSessao] = useState(true);

  const precisaGate = !verificandoSessao && !equipeSessao;

  useEffect(() => {
    const sess = getEquipeSession();
    if (sess && sess.eventoId === eventoId && (sess.tipo === 'checkin_hospedagem' || sess.tipo === 'hospedagem' || sess.tipo === 'operador' || sess.tipo === 'checkin')) {
      setEquipeSessaoState(sess);
    } else {
      setEquipeSessaoState(null);
    }
    setVerificandoSessao(false);
  }, [eventoId]);

  async function solicitarAcesso() {
    const emailTrimmed = emailAcesso.trim().toLowerCase();
    if (!emailTrimmed) {
      setErro('Informe o e-mail cadastrado na equipe do evento.');
      return;
    }
    if (!/\S+@\S+\.\S+/.test(emailTrimmed)) {
      setErro('E-mail inválido.');
      return;
    }
    setSolicitandoAcesso(true);
    setErro(null);
    try {
      const res = await fetch(`/api/eventos/${eventoId}/equipe/acesso-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailTrimmed, funcao: 'checkin_hospedagem' }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        setErro((json as { error?: string }).error || 'E-mail não autorizado para esta função.');
        return;
      }
      const sessao: EquipeSession = {
        eventoId,
        equipeId: json.equipe_id as string,
        tipo: (json.tipo as EquipeSession['tipo']) ?? 'checkin_hospedagem',
        expiraEm: (json.expira_em as string) || new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
        email: emailTrimmed,
        nome: (json.nome as string | null) ?? undefined,
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
      setSearchResults([]);
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
    setSearchResults([]);
    setSucessoMsg(null);
    try {
      const headers: Record<string, string> = {};
      if (equipeSessao?.equipeId) {
        headers['x-evento-equipe-id'] = equipeSessao.equipeId;
      }
      const res = await fetch(
        `/api/eventos/${eventoId}/hospedagens/checkin?q=${encodeURIComponent(trimmed)}${equipeSessao ? `&equipe_id=${encodeURIComponent(equipeSessao.equipeId)}` : ''}`,
        { headers }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Não encontrado.');
      
      const list = (json.results || []) as CheckinData[];
      setSearchResults(list);
      
      if (list.length === 1) {
        setData(list[0]);
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao buscar.');
    } finally {
      setBuscando(false);
    }
  }, [eventoId, equipeSessao]);

  async function confirmar(acao: 'checkin' | 'checkout') {
    if (!data) return;
    setConfirmando(true);
    setErro(null);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (equipeSessao?.equipeId) {
        headers['x-evento-equipe-id'] = equipeSessao.equipeId;
      }
      const res = await fetch(`/api/eventos/${eventoId}/hospedagens/checkin`, {
        method: 'POST',
        headers,
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

  const status = data?.hospedagem?.status;
  const pagoConfirmado = data && ['pago', 'isento'].includes(data.inscricao.status_pagamento);
  const temHospedagemSolicitada = data?.inscricao.hospedagem === true;
  
  // Condições de bloqueio e liberação de check-in
  const bloqueadoPorPagamento = data && !pagoConfirmado;
  const bloqueadoPorSemHospedagem = data && !temHospedagemSolicitada;
  const podeCheckin = data && temHospedagemSolicitada && pagoConfirmado && data.hospedagem && !['checkin_realizado','checkout_realizado','lista_espera','cancelada'].includes(status ?? '');
  const podeCheckout = data && status === 'checkin_realizado';

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
            Digite nome, CPF ou código da inscrição
          </p>
          <div className="flex gap-2">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') buscar(query); }}
              placeholder="Digite nome, CPF ou código da inscrição..."
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

        {/* Múltiplos resultados */}
        {searchResults.length > 1 && !data && !sucessoMsg && (
          <div className="w-full bg-white rounded-2xl shadow-lg p-5 space-y-3">
            <h2 className="text-sm font-bold text-gray-700 border-b pb-2">
              Resultados encontrados ({searchResults.length}):
            </h2>
            <div className="max-h-60 overflow-y-auto divide-y divide-gray-100">
              {searchResults.map(res => (
                <button
                  key={res.inscricao.id}
                  onClick={() => setData(res)}
                  className="w-full text-left py-3 px-2 hover:bg-gray-50 flex flex-col gap-1 transition rounded-lg"
                >
                  <span className="font-bold text-gray-800 text-sm">{res.inscricao.nome}</span>
                  <span className="text-xs text-gray-500 flex gap-2">
                    <span>CPF: {res.inscricao.cpf ?? '—'}</span>
                    <span>·</span>
                    <span>{res.inscricao.categoria ?? '—'}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Card do participante selecionado */}
        {data && !sucessoMsg && (
          <div className="w-full bg-white rounded-2xl shadow-lg overflow-hidden">
            {/* Cabeçalho */}
            <div className="bg-[#123b63] px-5 py-4 flex justify-between items-start">
              <div>
                <p className="text-white font-black text-lg leading-tight">{data.inscricao.nome}</p>
                <p className="text-blue-200 text-xs mt-0.5">{data.inscricao.categoria ?? '—'} · {data.inscricao.sexo === 'M' ? 'Masculino' : data.inscricao.sexo === 'F' ? 'Feminino' : '—'}</p>
              </div>
              {searchResults.length > 1 && (
                <button
                  onClick={() => setData(null)}
                  className="text-xs bg-white/20 hover:bg-white/35 text-white font-semibold px-2.5 py-1 rounded-lg transition"
                >
                  Voltar à lista
                </button>
              )}
            </div>

            {/* Status */}
            <div className="px-5 pt-4 flex gap-2 flex-wrap">
              <span className={`text-xs font-bold px-3 py-1 rounded-full ${
                status === 'checkin_realizado'  ? 'bg-emerald-100 text-emerald-700' :
                status === 'checkout_realizado' ? 'bg-gray-100 text-gray-600'      :
                status === 'confirmada'         ? 'bg-blue-100 text-blue-700'      :
                status === 'lista_espera'       ? 'bg-orange-100 text-orange-700'  :
                'bg-yellow-100 text-yellow-700'
              }`}>
                {STATUS_LABEL[status ?? ''] ?? 'Não Alocado'}
              </span>
              
              <span className={`text-xs font-bold px-3 py-1 rounded-full ${
                pagoConfirmado ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
              }`}>
                💳 Pagamento: {String(data.inscricao.status_pagamento).toUpperCase()}
              </span>
            </div>

            {/* Detalhes */}
            <div className="px-5 py-4 space-y-2">
              {[
                { label: 'CPF',           value: data.inscricao.cpf ?? '—' },
                { label: 'Hospedagem Solicitada', value: temHospedagemSolicitada ? 'Sim' : 'Não' },
                { label: 'Alojamento',    value: data.hospedagem?.alojamento_nome ?? 'Não alocado' },
                { label: 'Leito nº',      value: data.hospedagem?.numero_cama ?? data.leito?.numero ?? '—' },
                { label: 'Tipo de leito', value: data.leito ? TIPO_LEITO[data.leito.tipo_leito] ?? data.leito.tipo_leito : (data.hospedagem?.tipo_cama ?? '—') },
                { label: 'Posição',       value: data.leito ? POSICAO[data.leito.posicao] ?? data.leito.posicao : '—' },
                { label: 'Alimentação',   value: data.inscricao.alimentacao === true || String(data.inscricao.alimentacao).toLowerCase() === 'sim' ? 'Sim' : 'Não' },
              ].map(r => (
                <div key={r.label} className="flex justify-between items-baseline border-b border-gray-55 pb-1.5">
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

            {/* Alertas e Botões */}
            <div className="px-5 pb-5 flex flex-col gap-3">
              
              {bloqueadoPorPagamento && (
                <div className="bg-red-50 border border-red-200 text-red-850 rounded-xl px-4 py-3.5 text-sm font-semibold text-center">
                  ⚠️ Inscrição encontrada, mas hospedagem não liberada porque o pagamento ainda está pendente.
                </div>
              )}

              {bloqueadoPorSemHospedagem && !bloqueadoPorPagamento && (
                <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-xl px-4 py-3.5 text-sm font-semibold text-center">
                  ⚠️ Inscrição encontrada, mas não possui hospedagem solicitada.
                </div>
              )}

              {temHospedagemSolicitada && pagoConfirmado && data.hospedagem === null && (
                <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-xl px-4 py-3 text-sm text-center">
                  ⚠️ Participante ainda não foi alocado em nenhum alojamento. Aloque no painel operacional antes de fazer check-in.
                </div>
              )}

              {podeCheckin && (
                <button
                  onClick={() => confirmar('checkin')}
                  disabled={confirmando}
                  className="w-full bg-emerald-600 text-white py-4 rounded-xl font-black text-base hover:bg-emerald-700 transition disabled:opacity-50 tracking-wide"
                >
                  {confirmando ? '⏳ Registrando...' : '✅ CONFIRMAR CHECK-IN DE HOSPEDAGEM'}
                </button>
              )}

              {podeCheckout && (
                <button
                  onClick={() => confirmar('checkout')}
                  disabled={confirmando}
                  className="w-full bg-rose-600 text-white py-4 rounded-xl font-black text-base hover:bg-rose-700 transition disabled:opacity-50 tracking-wide"
                >
                  {confirmando ? '⏳ Registrando...' : '🔴 CONFIRMAR SAÍDA (CHECK-OUT)'}
                </button>
              )}

              {status === 'checkout_realizado' && (
                <div className="bg-gray-100 text-gray-500 rounded-xl px-4 py-3 text-sm text-center">
                  Check-out já realizado para este participante.
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
        {!data && searchResults.length <= 1 && !buscando && !erro && !sucessoMsg && (
          <div className="text-white/50 text-center text-sm mt-4">
            <p className="text-5xl mb-3">🔍</p>
            <p>Digite o nome, CPF ou código do participante acima</p>
          </div>
        )}
      </main>
    </div>
  );
}
