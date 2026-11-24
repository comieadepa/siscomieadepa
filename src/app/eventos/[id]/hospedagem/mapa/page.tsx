'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { getEquipeSession, clearEquipeSession, setEquipeSession } from '@/lib/equipe-session';
import type { EquipeSession } from '@/lib/equipe-session';

// ─── Interfaces ─────────────────────────────────────────────────────────────

interface Alojamento {
  id: string;
  nome: string;
  publico: string | null;
  total_vagas: number;
  camas_inferiores: number;
  camas_superiores: number;
  colchonetes?: number;
  ativo: boolean;
  total_leitos_fisicos?: number;
}

interface ParticipanteInfo {
  id: string;
  nome_inscrito: string;
  cpf: string | null;
  tipo_inscricao?: string | null;
  status_pagamento?: string | null;
  supervisao_id?: string | null;
  campo_id?: string | null;
}

interface HospedagemInfo {
  id: string;
  status: string;
  checkin_at: string | null;
  checkout_at: string | null;
  checkin_operador: string | null;
  checkout_operador: string | null;
}

interface LeitoItem {
  id: string;
  numero: string;
  posicao: 'inferior' | 'superior' | 'unico' | string;
  tipo_leito: string;
  ocupado: boolean;
  alojamento_id: string;
  inscricao_id: string | null;
  participante?: ParticipanteInfo | null;
  hospedagem?: HospedagemInfo | null;
  estadoCheckin: 'livre' | 'reservado' | 'entrada' | 'saida';
}

// ─── Componente Principal ───────────────────────────────────────────────────

export default function MapaCheckinMobilePage() {
  const params = useParams();
  const router = useRouter();
  const eventoId = (params?.id as string) || '';

  const inputEmailRef = useRef<HTMLInputElement>(null);
  const inputSenhaRef = useRef<HTMLInputElement>(null);

  // Hidratação e Sessão de Equipe (mesmo fluxo da tela /checkin oficial)
  const [mounted, setMounted] = useState(false);
  const [equipeSessao, setEquipeSessao] = useState<EquipeSession | null>(null);
  const [isAdminGeral, setIsAdminGeral] = useState(false);
  const [verificandoSessao, setVerificandoSessao] = useState(true);

  // Formulário de acesso da equipe com credenciais reais
  const [emailAcesso, setEmailAcesso] = useState('');
  const [senhaAcesso, setSenhaAcesso] = useState('');
  const [solicitandoAcesso, setSolicitandoAcesso] = useState(false);
  const [erroLogin, setErroLogin] = useState<string | null>(null);

  // Dados do evento e alojamentos
  const [eventoNome, setEventoNome] = useState('126ª AGO DA COMIEADEPA');
  const [alojamentos, setAlojamentos] = useState<Alojamento[]>([]);
  const [alojamentoAtivo, setAlojamentoAtivo] = useState<Alojamento | null>(null);
  const [carregandoAlojamentos, setCarregandoAlojamentos] = useState(false);

  // Leitos físicos reais carregados da API
  const [todosLeitos, setTodosLeitos] = useState<LeitoItem[]>([]);
  const [carregandoLeitos, setCarregandoLeitos] = useState(false);
  const [erroCarregamento, setErroCarregamento] = useState<string | null>(null);

  // Filtros de visualização mobile
  const [filtroEstado, setFiltroEstado] = useState<'todos' | 'livre' | 'reservado' | 'entrada' | 'saida'>('todos');
  const [filtroPosicao, setFiltroPosicao] = useState<'todas' | 'inferior' | 'superior' | 'colchonete'>('todas');
  const [buscaTermo, setBuscaTermo] = useState('');

  // Ficha Mobile do Participante (Drawer/Modal)
  const [leitoSelecionado, setLeitoSelecionado] = useState<LeitoItem | null>(null);

  // Toast de simulação visual (Etapa 1)
  const [toastSimulacao, setToastSimulacao] = useState<string | null>(null);

  // Perfil de acesso operacional derivado da sessão legítima ou admin global
  const isPerfilAdminHospedagem = isAdminGeral || equipeSessao?.tipo === 'hospedagem';

  // 1. Verificar Sessão no cliente após montagem (com validação estrita de UUID)
  useEffect(() => {
    setMounted(true);
    const sess = getEquipeSession();

    // Um ID de equipe válido no banco DEVE ser um UUID válido
    const isUuid = Boolean(
      sess?.equipeId &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sess.equipeId)
    );

    if (
      sess &&
      isUuid &&
      sess.eventoId === eventoId &&
      (sess.tipo === 'checkin_hospedagem' || sess.tipo === 'hospedagem' || sess.tipo === 'operador' || sess.tipo === 'checkin')
    ) {
      setEquipeSessao(sess);
    } else {
      // Limpa qualquer sessão legada, expirada ou com ID inválido do localStorage
      if (sess && !isUuid) {
        clearEquipeSession();
      }
      setEquipeSessao(null);
    }

    // Também verifica se o usuário possui sessão administrativa global (cookie)
    async function checarAuthGlobal() {
      try {
        const { createClient } = await import('@/lib/supabase-client');
        const supabase = createClient();
        const { data } = await supabase.auth.getUser();
        if (data?.user) {
          setIsAdminGeral(true);
        }
      } catch {
        // ignora se não autenticado globalmente
      } finally {
        setVerificandoSessao(false);
      }
    }

    checarAuthGlobal();
  }, [eventoId]);

  // Foca no campo de e-mail se precisar de gate
  useEffect(() => {
    if (mounted && !verificandoSessao && !equipeSessao && !isAdminGeral) {
      inputEmailRef.current?.focus();
    }
  }, [mounted, verificandoSessao, equipeSessao, isAdminGeral]);

  // 2. Fluxo oficial de autenticação da equipe por credenciais reais (E-mail + Senha)
  async function fazerLoginEquipe(e?: React.FormEvent) {
    if (e) e.preventDefault();
    const emailTrimmed = emailAcesso.trim().toLowerCase();
    const senhaTrimmed = senhaAcesso.trim();

    if (!emailTrimmed || !senhaTrimmed) {
      setErroLogin('Informe o e-mail e a senha cadastrados na equipe.');
      return;
    }
    if (!/\S+@\S+\.\S+/.test(emailTrimmed)) {
      setErroLogin('E-mail inválido.');
      return;
    }

    setSolicitandoAcesso(true);
    setErroLogin(null);
    setErroCarregamento(null);

    try {
      const res = await fetch(`/api/eventos/${eventoId}/equipe/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailTrimmed, senha: senhaTrimmed, funcao: 'hospedagem' }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        setErroLogin(json.error || 'Credenciais inválidas para o acesso à Hospedagem.');
        return;
      }

      if (json.evento_nome) {
        setEventoNome(json.evento_nome);
      }

      const novaSessao: EquipeSession = {
        eventoId,
        equipeId: json.equipe_id as string,
        tipo: (json.tipo as EquipeSession['tipo']) ?? 'hospedagem',
        expiraEm: (json.expira_em as string) || new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
        email: emailTrimmed,
        nome: (json.nome as string | null) ?? undefined,
      };

      setEquipeSession(novaSessao);
      setEquipeSessao(novaSessao);
    } catch {
      setErroLogin('Erro ao processar login de equipe. Verifique sua conexão.');
    } finally {
      setSolicitandoAcesso(false);
    }
  }

  function sairSessao() {
    clearEquipeSession();
    setEquipeSessao(null);
    setIsAdminGeral(false);
    setTodosLeitos([]);
    setAlojamentos([]);
    setAlojamentoAtivo(null);
    setErroCarregamento(null);
  }

  // 3. Carregar dados reais através das APIs Autenticadas existentes com a credencial da sessão
  const carregarDadosCompletos = useCallback(async () => {
    if (!eventoId) return;
    if (!equipeSessao && !isAdminGeral) return;

    setCarregandoAlojamentos(true);
    setCarregandoLeitos(true);
    setErroCarregamento(null);

    const headers: Record<string, string> = {};
    let qs = '';

    if (equipeSessao?.equipeId) {
      headers['x-evento-equipe-id'] = equipeSessao.equipeId;
      qs = `?equipe_id=${encodeURIComponent(equipeSessao.equipeId)}`;
    }

    try {
      // 3.1. Carrega Alojamentos Oficiais via API autenticada
      const resAlojs = await fetch(`/api/eventos/${eventoId}/alojamentos${qs}`, {
        headers,
      });

      if (!resAlojs.ok) {
        // Se a sessão expirou ou for inválida (403), expurga e direciona ao login
        if (resAlojs.status === 403 || resAlojs.status === 401) {
          clearEquipeSession();
          setEquipeSessao(null);
        }
        const errJson = await resAlojs.json().catch(() => ({}));
        throw new Error(errJson.error || `Erro ${resAlojs.status} ao consultar alojamentos.`);
      }

      const dataAlojs = await resAlojs.json();
      const rawAlojsList: any[] = dataAlojs.alojamentos || [];

      // 3.2. Carrega Leitos Físicos Reais via API autenticada
      const resLeitos = await fetch(`/api/eventos/${eventoId}/hospedagens/leitos${qs}`, {
        headers,
      });

      if (!resLeitos.ok) {
        if (resLeitos.status === 403 || resLeitos.status === 401) {
          clearEquipeSession();
          setEquipeSessao(null);
        }
        const errJson = await resLeitos.json().catch(() => ({}));
        throw new Error(errJson.error || `Erro ${resLeitos.status} ao consultar leitos.`);
      }

      const dataLeitos = await resLeitos.json();
      const rawLeitosList: any[] = dataLeitos.leitos || [];

      // Mapeia os leitos com dados de participantes e status operacional
      const processados: LeitoItem[] = rawLeitosList.map((l: any) => {
        const insc = Array.isArray(l.evento_inscricoes)
          ? l.evento_inscricoes[0] ?? null
          : l.evento_inscricoes ?? null;
        const hosp = l.hospedagem ?? null;

        let estado: 'livre' | 'reservado' | 'entrada' | 'saida' = 'livre';

        if (l.ocupado && l.inscricao_id) {
          if (hosp?.checkout_at || hosp?.status === 'checkout_realizado') {
            estado = 'saida';
          } else if (hosp?.checkin_at || hosp?.status === 'checkin_realizado') {
            estado = 'entrada';
          } else {
            estado = 'reservado';
          }
        } else {
          estado = 'livre';
        }

        return {
          id: l.id,
          numero: String(l.numero || '000'),
          posicao: (l.posicao as any) || 'inferior',
          tipo_leito: l.tipo_leito || 'beliche',
          ocupado: Boolean(l.ocupado && l.inscricao_id),
          alojamento_id: l.alojamento_id,
          inscricao_id: l.inscricao_id,
          participante: insc,
          hospedagem: hosp,
          estadoCheckin: estado,
        };
      });

      // Ordenação física natural por número e posição
      processados.sort((a, b) => {
        const numA = parseInt(a.numero.replace(/\D/g, ''), 10) || 0;
        const numB = parseInt(b.numero.replace(/\D/g, ''), 10) || 0;
        if (numA !== numB) return numA - numB;
        const compStr = a.numero.localeCompare(b.numero, undefined, { numeric: true });
        if (compStr !== 0) return compStr;
        const posOrder: Record<string, number> = { inferior: 1, superior: 2, colchonete: 3, unico: 4 };
        return (posOrder[a.posicao] || 99) - (posOrder[b.posicao] || 99);
      });

      // Contagem de leitos físicos reais por alojamento
      const countsMap = new Map<string, number>();
      processados.forEach(leito => {
        countsMap.set(leito.alojamento_id, (countsMap.get(leito.alojamento_id) || 0) + 1);
      });

      const alojsFormatados: Alojamento[] = rawAlojsList.map(a => ({
        id: a.id,
        nome: a.nome,
        publico: a.publico,
        total_vagas: a.total_vagas,
        camas_inferiores: a.camas_inferiores,
        camas_superiores: a.camas_superiores,
        colchonetes: a.colchonetes,
        ativo: Boolean(a.ativo),
        total_leitos_fisicos: countsMap.get(a.id) || 0,
      }));

      setAlojamentos(alojsFormatados);
      setTodosLeitos(processados);

      // Define alojamento ativo inicial
      if (alojsFormatados.length > 0) {
        setAlojamentoAtivo(prev => {
          if (prev) {
            const aindaExiste = alojsFormatados.find(a => a.id === prev.id);
            if (aindaExiste) return aindaExiste;
          }
          const azul = alojsFormatados.find(a => a.nome.includes('AZUL'));
          return azul || alojsFormatados[0];
        });
      }
    } catch (err: any) {
      console.error('Erro ao carregar dados de hospedagem:', err);
      setErroCarregamento(err.message || 'Erro ao carregar dados de hospedagem.');
    } finally {
      setCarregandoAlojamentos(false);
      setCarregandoLeitos(false);
    }
  }, [eventoId, equipeSessao, isAdminGeral]);

  useEffect(() => {
    if (mounted && (equipeSessao || isAdminGeral)) {
      carregarDadosCompletos();
    }
  }, [mounted, equipeSessao, isAdminGeral, carregarDadosCompletos]);

  // 4. Leitos pertencentes ao alojamento selecionado
  const leitosDoAlojamentoAtivo = useMemo(() => {
    if (!alojamentoAtivo) return [];
    return todosLeitos.filter(l => l.alojamento_id === alojamentoAtivo.id);
  }, [todosLeitos, alojamentoAtivo]);

  // 5. Estatísticas exclusivas dos leitos físicos cadastrados no alojamento ativo
  const statsAlojamento = useMemo(() => {
    const total = leitosDoAlojamentoAtivo.length;
    const livres = leitosDoAlojamentoAtivo.filter(l => l.estadoCheckin === 'livre').length;
    const reservados = leitosDoAlojamentoAtivo.filter(l => l.estadoCheckin === 'reservado').length;
    const entradas = leitosDoAlojamentoAtivo.filter(l => l.estadoCheckin === 'entrada').length;
    const saidas = leitosDoAlojamentoAtivo.filter(l => l.estadoCheckin === 'saida').length;
    return { total, livres, reservados, entradas, saidas };
  }, [leitosDoAlojamentoAtivo]);

  // 6. Filtragem de Leitos na tela mobile
  const leitosFiltrados = useMemo(() => {
    return leitosDoAlojamentoAtivo.filter(l => {
      // Filtro por Estado (Cor)
      if (filtroEstado !== 'todos' && l.estadoCheckin !== filtroEstado) return false;

      // Filtro por Posição
      if (filtroPosicao === 'inferior' && l.posicao !== 'inferior') return false;
      if (filtroPosicao === 'superior' && l.posicao !== 'superior') return false;
      if (filtroPosicao === 'colchonete' && l.tipo_leito !== 'colchonete' && l.posicao !== 'colchonete') return false;

      // Busca por número ou nome
      if (buscaTermo.trim()) {
        const termo = buscaTermo.trim().toLowerCase();
        const numMatch = l.numero.toLowerCase().includes(termo);
        const nomeMatch = l.participante?.nome_inscrito?.toLowerCase().includes(termo);
        const cpfMatch = l.participante?.cpf?.includes(termo);
        if (!numMatch && !nomeMatch && !cpfMatch) return false;
      }

      return true;
    });
  }, [leitosDoAlojamentoAtivo, filtroEstado, filtroPosicao, buscaTermo]);

  // 7. Simulação visual das ações (Etapa 1 - Sem gravação)
  function dispararAcaoVisual(acao: string) {
    let msg = `[SIMULAÇÃO ETAPA 1] Ação "${acao}" acionada visualmente. Nenhuma alteração gravada.`;
    if (acao === 'Solicitar Troca') {
      msg = `[SIMULAÇÃO ETAPA 1] Solicitação de troca registrada para coordenação de hospedagem. Sem alteração real.`;
    } else if (acao === 'Solicitar Cancelamento') {
      msg = `[SIMULAÇÃO ETAPA 1] Solicitação de cancelamento registrada para coordenação de hospedagem. Sem alteração real.`;
    }
    setToastSimulacao(msg);
    setTimeout(() => {
      setToastSimulacao(null);
    }, 4500);
  }

  // ─── TELA DE CARREGAMENTO INICIAL ─────────────────────────────────────────
  if (!mounted || verificandoSessao) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col justify-center items-center p-4">
        <div className="text-center space-y-3">
          <div className="w-12 h-12 bg-blue-100 text-[#0D2B4E] rounded-2xl flex items-center justify-center text-2xl mx-auto animate-pulse">
            🛏️
          </div>
          <p className="text-xs font-bold text-gray-600">Verificando sessão de hospedagem...</p>
        </div>
      </div>
    );
  }

  // ─── GATE DE ACESSO MOBILE SEGURO COM CREDENCIAIS REAIS ──────────────────
  if (!equipeSessao && !isAdminGeral) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-[#0D2B4E] to-[#123b63] flex flex-col justify-center items-center p-4">
        <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 text-center space-y-4">
          <div className="w-14 h-14 bg-blue-50 text-[#0D2B4E] rounded-2xl flex items-center justify-center text-3xl mx-auto shadow-sm">
            🛏️
          </div>
          <div>
            <h1 className="text-xl font-black text-gray-900">Mapa de Leitos Mobile</h1>
            <p className="text-xs text-gray-500 mt-1">126ª AGO • Hospedagem e Check-in</p>
          </div>

          {erroLogin && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs font-semibold text-left">
              ⚠️ {erroLogin}
            </div>
          )}

          <form onSubmit={fazerLoginEquipe} className="space-y-3 text-left">
            <div>
              <label className="block text-[11px] font-bold text-gray-700 uppercase mb-1">
                E-mail cadastrado
              </label>
              <input
                ref={inputEmailRef}
                type="email"
                value={emailAcesso}
                onChange={e => setEmailAcesso(e.target.value)}
                placeholder="seu.email@exemplo.com"
                required
                className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-[#0D2B4E]"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-gray-700 uppercase mb-1">
                Senha da equipe
              </label>
              <input
                ref={inputSenhaRef}
                type="password"
                value={senhaAcesso}
                onChange={e => setSenhaAcesso(e.target.value)}
                placeholder="••••••••"
                required
                className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-[#0D2B4E]"
              />
            </div>

            <button
              type="submit"
              disabled={solicitandoAcesso}
              className="w-full bg-[#0D2B4E] hover:bg-[#0a2340] text-white py-2.5 rounded-xl font-bold text-sm shadow transition disabled:opacity-50"
            >
              {solicitandoAcesso ? 'Autenticando...' : 'Acessar Mapa de Leitos'}
            </button>
          </form>

          <p className="text-[11px] text-gray-400">
            Acesso restrito com autenticação oficial para membros cadastrados da equipe de Hospedagem ou Check-in de Hospedagem.
          </p>

          <div className="pt-2 border-t border-gray-100 flex flex-col gap-1.5 text-center">
            <button
              onClick={() => router.push(`/admin/login?next=/eventos/${eventoId}/hospedagem/mapa`)}
              className="text-xs text-[#0D2B4E] hover:underline font-semibold"
            >
              👑 Entrar como Administrador Geral do Sistema
            </button>

            <button
              onClick={() => router.push(`/eventos/${eventoId}`)}
              className="text-xs text-gray-400 hover:text-gray-600 underline pt-1 block mx-auto"
            >
              ← Voltar para o Evento
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── TELA PRINCIPAL DO MAPA MOBILE ────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col max-w-md mx-auto sm:max-w-xl md:max-w-2xl border-x border-gray-200 shadow-sm select-none">
      
      {/* ── Top Bar Sticky ────────────────────────────────────────── */}
      <header className="sticky top-0 z-20 bg-[#0D2B4E] text-white px-4 py-3 shadow-md flex items-center justify-between">
        <div className="min-w-0 pr-2">
          <div className="flex items-center gap-2">
            <span className="text-lg">🛏️</span>
            <h1 className="text-sm font-black truncate leading-tight">Mapa de Leitos • 126ª AGO</h1>
          </div>
          <p className="text-[10px] text-blue-200 truncate mt-0.5">
            {equipeSessao?.nome ? `${equipeSessao.nome} • ` : isAdminGeral ? 'Administrador Geral • ' : ''}{eventoNome}
          </p>
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          {/* Badge Oficial do Perfil Autenticado */}
          <span
            className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full ${
              isPerfilAdminHospedagem
                ? 'bg-amber-400 text-amber-950'
                : 'bg-teal-400 text-teal-950'
            }`}
          >
            {isAdminGeral ? '👑 Administrador' : isPerfilAdminHospedagem ? '👑 Hospedagem' : '📱 Check-in Hosp.'}
          </span>

          {/* Botão de recarregar */}
          <button
            onClick={carregarDadosCompletos}
            title="Atualizar leitos"
            className="p-1.5 bg-white/10 hover:bg-white/20 rounded-lg text-xs"
          >
            🔄
          </button>

          {/* Link para busca tradicional de check-in */}
          <button
            onClick={() => router.push(`/eventos/${eventoId}/hospedagem/checkin`)}
            title="Ir para busca por Nome/CPF"
            className="p-1.5 bg-white/10 hover:bg-white/20 rounded-lg text-xs"
          >
            🔍
          </button>

          {/* Botão de sair */}
          <button
            onClick={sairSessao}
            title="Sair da sessão"
            className="p-1.5 bg-red-500/20 hover:bg-red-500/40 text-red-200 rounded-lg text-xs"
          >
            ✕
          </button>
        </div>
      </header>

      {/* ── Toast de Simulação Visual (Etapa 1) ─────────────────────── */}
      {toastSimulacao && (
        <div className="fixed top-14 inset-x-4 z-50 max-w-sm mx-auto p-3 bg-amber-600 text-white rounded-xl shadow-xl text-xs font-bold flex items-center justify-between animate-bounce">
          <span>⚠️ {toastSimulacao}</span>
          <button onClick={() => setToastSimulacao(null)} className="ml-2 text-white/80 hover:text-white">✕</button>
        </div>
      )}

      {/* ── Seletor Suspenso Exclusivo dos Cinco Alojamentos Reais do Banco ── */}
      <section className="bg-white border-b border-gray-200 px-4 py-2.5 shadow-sm">
        <label htmlFor="select-alojamento" className="block text-[10px] font-black uppercase tracking-wider text-gray-500 mb-1">
          🏢 Alojamento Selecionado
        </label>
        <div className="relative">
          <select
            id="select-alojamento"
            value={alojamentoAtivo?.id || ''}
            onChange={e => {
              const selected = alojamentos.find(a => a.id === e.target.value);
              if (selected) setAlojamentoAtivo(selected);
            }}
            disabled={carregandoAlojamentos || alojamentos.length === 0}
            aria-label="Selecionar alojamento"
            className="w-full pl-3.5 pr-10 py-2.5 bg-gray-50 hover:bg-gray-100 border border-gray-300 rounded-xl text-xs sm:text-sm font-black text-[#0D2B4E] focus:outline-none focus:ring-2 focus:ring-[#0D2B4E] focus:bg-white transition cursor-pointer appearance-none shadow-sm"
          >
            {carregandoAlojamentos ? (
              <option value="">Carregando alojamentos...</option>
            ) : alojamentos.length === 0 ? (
              <option value="">Nenhum alojamento encontrado</option>
            ) : (
              alojamentos.map(aloj => (
                <option key={aloj.id} value={aloj.id}>
                  {aloj.nome} ({aloj.total_leitos_fisicos ?? 0} leitos físicos cadastrados)
                </option>
              ))
            )}
          </select>
          <div className="absolute inset-y-0 right-0 pr-3.5 flex items-center pointer-events-none text-gray-500 text-xs">
            ▼
          </div>
        </div>
      </section>

      {/* ── Resumo Rápido & Legenda de Cores (Clicáveis como filtro) ── */}
      <section className="bg-white px-4 py-3 border-b border-gray-200 space-y-2.5">
        <div className="flex items-center justify-between text-xs font-bold text-gray-700">
          <span>{alojamentoAtivo?.nome ?? 'Selecione o alojamento'}</span>
          <span className="text-gray-500 text-[11px] font-medium">
            {statsAlojamento.total} leitos físicos cadastrados
          </span>
        </div>

        {/* Grade de Legenda com contadores reais */}
        <div className="grid grid-cols-4 gap-1.5">
          {/* Branco: Livre */}
          <button
            onClick={() => setFiltroEstado(prev => prev === 'livre' ? 'todos' : 'livre')}
            className={`p-2 rounded-xl text-center border transition flex flex-col items-center justify-center ${
              filtroEstado === 'livre' ? 'ring-2 ring-blue-500 bg-gray-50' : 'bg-white hover:bg-gray-50'
            } border-gray-300 text-gray-800`}
          >
            <span className="text-[10px] uppercase font-bold text-gray-400">⚪ Livre</span>
            <span className="text-base font-black text-gray-700">{statsAlojamento.livres}</span>
          </button>

          {/* Azul Escuro: Reservado sem entrada */}
          <button
            onClick={() => setFiltroEstado(prev => prev === 'reservado' ? 'todos' : 'reservado')}
            className={`p-2 rounded-xl text-center border transition flex flex-col items-center justify-center ${
              filtroEstado === 'reservado' ? 'ring-2 ring-yellow-400' : ''
            } bg-[#0D2B4E] border-[#0D2B4E] text-white`}
          >
            <span className="text-[10px] uppercase font-bold text-blue-200">🔵 Reservado</span>
            <span className="text-base font-black text-white">{statsAlojamento.reservados}</span>
          </button>

          {/* Verde: Entrada Registrada */}
          <button
            onClick={() => setFiltroEstado(prev => prev === 'entrada' ? 'todos' : 'entrada')}
            className={`p-2 rounded-xl text-center border transition flex flex-col items-center justify-center ${
              filtroEstado === 'entrada' ? 'ring-2 ring-blue-500' : ''
            } bg-emerald-600 border-emerald-600 text-white`}
          >
            <span className="text-[10px] uppercase font-bold text-emerald-100">🟢 Entrada</span>
            <span className="text-base font-black text-white">{statsAlojamento.entradas}</span>
          </button>

          {/* Âmbar/Vermelho: Saída Registrada */}
          <button
            onClick={() => setFiltroEstado(prev => prev === 'saida' ? 'todos' : 'saida')}
            className={`p-2 rounded-xl text-center border transition flex flex-col items-center justify-center ${
              filtroEstado === 'saida' ? 'ring-2 ring-blue-500' : ''
            } bg-amber-700 border-amber-700 text-white`}
          >
            <span className="text-[10px] uppercase font-bold text-amber-200">🔴 Saída</span>
            <span className="text-base font-black text-white">{statsAlojamento.saidas}</span>
          </button>
        </div>

        {/* Filtros rápidos: Posição e Busca */}
        <div className="flex items-center gap-2 pt-1">
          <div className="flex-1 relative">
            <span className="absolute inset-y-0 left-0 pl-2.5 flex items-center text-gray-400 text-xs">🔍</span>
            <input
              type="text"
              value={buscaTermo}
              onChange={e => setBuscaTermo(e.target.value)}
              placeholder="Buscar leito ou nome..."
              className="w-full pl-7 pr-3 py-1.5 rounded-lg border border-gray-200 text-xs focus:outline-none focus:ring-1 focus:ring-[#0D2B4E]"
            />
          </div>

          <select
            value={filtroPosicao}
            onChange={e => setFiltroPosicao(e.target.value as any)}
            className="px-2.5 py-1.5 rounded-lg border border-gray-200 text-xs font-semibold bg-gray-50 text-gray-700 focus:outline-none"
          >
            <option value="todas">Todos leitos</option>
            <option value="inferior">⬇ Inferiores</option>
            <option value="superior">⬆ Superiores</option>
            <option value="colchonete">🛏️ Colchonetes</option>
          </select>
        </div>

        {/* Recurso auxiliar: Busca tradicional por CPF/Nome */}
        <div className="flex items-center justify-between pt-1 border-t border-gray-100 text-[11px]">
          <span className="text-gray-400">Busca tradicional preservada:</span>
          <button
            onClick={() => router.push(`/eventos/${eventoId}/hospedagem/checkin`)}
            className="text-[#0D2B4E] hover:underline font-bold flex items-center gap-1 py-0.5 px-2 bg-blue-50 hover:bg-blue-100 rounded-lg transition"
          >
            <span>🔍</span>
            <span>Buscar por CPF / Nome</span>
          </button>
        </div>
      </section>

      {/* ── Grade Touch de Leitos Físicos Cadastrados ────────────────── */}
      <main className="flex-1 p-3 overflow-y-auto">
        {carregandoLeitos ? (
          <div className="text-center py-16 text-gray-400 space-y-2">
            <div className="animate-spin text-3xl">⏳</div>
            <p className="text-xs">Carregando leitos físicos cadastrados...</p>
          </div>
        ) : erroCarregamento ? (
          <div className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-xl text-center text-xs space-y-3">
            <p className="font-bold">⚠️ Falha no carregamento dos dados:</p>
            <p>{erroCarregamento}</p>
            <div className="flex gap-2 justify-center pt-1">
              <button
                onClick={carregarDadosCompletos}
                className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-bold hover:bg-red-700 transition"
              >
                Tentar novamente
              </button>
              <button
                onClick={sairSessao}
                className="px-3 py-1.5 bg-[#0D2B4E] text-white rounded-lg text-xs font-bold hover:bg-[#081e36] transition"
              >
                Entrar com e-mail
              </button>
            </div>
          </div>
        ) : leitosFiltrados.length === 0 ? (
          <div className="text-center py-16 text-gray-400 space-y-2">
            <div className="text-3xl">🛏️</div>
            <p className="text-xs font-medium">Nenhum leito encontrado com os filtros atuais.</p>
          </div>
        ) : (
          <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
            {leitosFiltrados.map(leito => {
              // Estilo do quadrado por estado real
              let cardStyle = '';
              let badgePos = '';

              if (leito.estadoCheckin === 'livre') {
                cardStyle = 'bg-white border-2 border-gray-300 text-gray-800 shadow-sm active:bg-gray-100';
              } else if (leito.estadoCheckin === 'reservado') {
                cardStyle = 'bg-[#0D2B4E] border-2 border-[#0D2B4E] text-white shadow active:bg-[#081e36]';
              } else if (leito.estadoCheckin === 'entrada') {
                cardStyle = 'bg-emerald-600 border-2 border-emerald-600 text-white shadow active:bg-emerald-700';
              } else if (leito.estadoCheckin === 'saida') {
                cardStyle = 'bg-amber-700 border-2 border-amber-700 text-white shadow active:bg-amber-800';
              }

              // Posição
              if (leito.tipo_leito === 'colchonete') {
                badgePos = 'COL';
              } else if (leito.posicao === 'inferior') {
                badgePos = '↓ INF';
              } else if (leito.posicao === 'superior') {
                badgePos = '↑ SUP';
              } else {
                badgePos = 'ÚNICO';
              }

              return (
                <button
                  key={leito.id}
                  onClick={() => setLeitoSelecionado(leito)}
                  className={`min-h-[68px] rounded-xl flex flex-col items-center justify-between p-1.5 transition transform active:scale-95 ${cardStyle}`}
                >
                  <span className="text-[9px] font-black tracking-tight opacity-90">{badgePos}</span>
                  <span className="text-lg font-black leading-none">{leito.numero}</span>
                  <span className="text-[8px] truncate max-w-full font-bold opacity-80">
                    {leito.ocupado && leito.participante
                      ? leito.participante.nome_inscrito.split(' ')[0]
                      : 'LIVRE'}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </main>

      {/* ── Ficha Mobile do Participante (Drawer BottomSheet) ────────── */}
      {leitoSelecionado && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60 backdrop-blur-xs">
          {/* Fundo clicável para fechar */}
          <div
            className="flex-1"
            onClick={() => setLeitoSelecionado(null)}
          />

          {/* Painel deslizante inferior */}
          <div className="bg-white rounded-t-3xl shadow-2xl p-5 max-w-md mx-auto sm:max-w-xl w-full max-h-[85vh] overflow-y-auto space-y-4 animate-slide-up">
            
            {/* Header do Drawer */}
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div className="flex items-center gap-2.5">
                <div
                  className={`w-10 h-10 rounded-xl flex items-center justify-center font-black text-sm text-white ${
                    leitoSelecionado.estadoCheckin === 'livre'
                      ? 'bg-gray-400'
                      : leitoSelecionado.estadoCheckin === 'reservado'
                      ? 'bg-[#0D2B4E]'
                      : leitoSelecionado.estadoCheckin === 'entrada'
                      ? 'bg-emerald-600'
                      : 'bg-amber-700'
                  }`}
                >
                  {leitoSelecionado.numero}
                </div>
                <div>
                  <h3 className="text-sm font-black text-gray-900 leading-tight">
                    Leito {leitoSelecionado.numero} ({leitoSelecionado.posicao.toUpperCase()})
                  </h3>
                  <p className="text-[11px] text-gray-500">{alojamentoAtivo?.nome}</p>
                </div>
              </div>

              <button
                onClick={() => setLeitoSelecionado(null)}
                className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600 flex items-center justify-center font-bold text-sm"
              >
                ✕
              </button>
            </div>

            {/* Situação Real do Leito */}
            {leitoSelecionado.estadoCheckin === 'livre' ? (
              <div className="p-4 bg-gray-50 rounded-2xl text-center space-y-2 border border-dashed border-gray-300">
                <div className="text-2xl">🟢</div>
                <p className="text-sm font-bold text-gray-800">Leito Físico Livre</p>
                <p className="text-xs text-gray-500">
                  Este leito está cadastrado e disponível para alocação no {alojamentoAtivo?.nome}.
                </p>
              </div>
            ) : (
              <div className="space-y-3.5">
                {/* Badge de Situação Real */}
                <div className="flex items-center justify-between bg-gray-50 p-3 rounded-2xl border border-gray-200">
                  <span className="text-xs font-bold text-gray-600">Situação Real:</span>
                  <span
                    className={`text-xs font-black px-3 py-1 rounded-full ${
                      leitoSelecionado.estadoCheckin === 'reservado'
                        ? 'bg-blue-100 text-[#0D2B4E]'
                        : leitoSelecionado.estadoCheckin === 'entrada'
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-amber-100 text-amber-900'
                    }`}
                  >
                    {leitoSelecionado.estadoCheckin === 'reservado'
                      ? '🔵 Reservado (Aguardando Entrada)'
                      : leitoSelecionado.estadoCheckin === 'entrada'
                      ? '🟢 Presente (Entrada Registrada)'
                      : '🔴 Saída Registrada'}
                  </span>
                </div>

                {/* Dados do Participante */}
                <div className="bg-gray-50 p-4 rounded-2xl border border-gray-200 space-y-2 text-xs">
                  <div>
                    <span className="text-gray-400 font-bold uppercase text-[10px] block">Nome do Participante</span>
                    <strong className="text-sm text-gray-900 font-black">
                      {leitoSelecionado.participante?.nome_inscrito || 'Participante Alocado'}
                    </strong>
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-1 border-t border-gray-200/60">
                    <div>
                      <span className="text-gray-400 font-bold uppercase text-[10px] block">CPF</span>
                      <span className="text-gray-700 font-semibold font-mono">
                        {leitoSelecionado.participante?.cpf
                          ? `${leitoSelecionado.participante.cpf.slice(0, 3)}.***.***-${leitoSelecionado.participante.cpf.slice(-2)}`
                          : 'Não informado'}
                      </span>
                    </div>

                    <div>
                      <span className="text-gray-400 font-bold uppercase text-[10px] block">Categoria / Cargo</span>
                      <span className="text-gray-700 font-semibold">
                        {leitoSelecionado.participante?.tipo_inscricao || 'Participante'}
                      </span>
                    </div>
                  </div>

                  <div className="pt-1 border-t border-gray-200/60 flex items-center justify-between">
                    <div>
                      <span className="text-gray-400 font-bold uppercase text-[10px] block">Leito Físico</span>
                      <span className="text-gray-900 font-black text-sm">
                        Leito {leitoSelecionado.numero}
                      </span>
                    </div>

                    <div className="text-right">
                      <span className="text-gray-400 font-bold uppercase text-[10px] block">Tipo de Leito</span>
                      <span className="text-gray-700 font-semibold text-xs capitalize">
                        {leitoSelecionado.tipo_leito} • {leitoSelecionado.posicao}
                      </span>
                    </div>
                  </div>

                  {/* Informações de Check-in Real */}
                  <div className="pt-2 border-t border-gray-200/60 text-[11px] space-y-1">
                    {leitoSelecionado.hospedagem?.checkin_at ? (
                      <p className="text-emerald-700">
                        ✅ <strong>Entrada:</strong> {new Date(leitoSelecionado.hospedagem.checkin_at).toLocaleString('pt-BR')}
                        {leitoSelecionado.hospedagem.checkin_operador && ` por ${leitoSelecionado.hospedagem.checkin_operador}`}
                      </p>
                    ) : (
                      <p className="text-blue-800">
                        ⏳ <strong>Aguardando entrada</strong> na portaria do alojamento.
                      </p>
                    )}

                    {leitoSelecionado.hospedagem?.checkout_at && (
                      <p className="text-amber-800">
                        🔴 <strong>Saída:</strong> {new Date(leitoSelecionado.hospedagem.checkout_at).toLocaleString('pt-BR')}
                        {leitoSelecionado.hospedagem.checkout_operador && ` por ${leitoSelecionado.hospedagem.checkout_operador}`}
                      </p>
                    )}
                  </div>
                </div>

                {/* ── Ações Visuais (Etapa 1: Apenas apresentação, sem gravação) ── */}
                <div className="space-y-2 pt-1">
                  <div className="grid grid-cols-2 gap-2">
                    {/* Botão Entrada */}
                    <button
                      onClick={() => dispararAcaoVisual('Confirmar Entrada')}
                      className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2.5 px-3 rounded-xl text-xs shadow-sm flex items-center justify-center gap-1.5 transition"
                    >
                      <span>🟢</span>
                      <span>Registrar Entrada</span>
                    </button>

                    {/* Botão Saída */}
                    <button
                      onClick={() => dispararAcaoVisual('Registrar Saída')}
                      className="w-full bg-amber-700 hover:bg-amber-800 text-white font-bold py-2.5 px-3 rounded-xl text-xs shadow-sm flex items-center justify-center gap-1.5 transition"
                    >
                      <span>🔴</span>
                      <span>Registrar Saída</span>
                    </button>
                  </div>

                  {/* Ações de Troca e Cancelamento conforme o Perfil Real */}
                  {isPerfilAdminHospedagem ? (
                    <div className="grid grid-cols-2 gap-2 pt-1 border-t border-gray-200">
                      <button
                        onClick={() => dispararAcaoVisual('Trocar Leito')}
                        className="w-full bg-blue-50 hover:bg-blue-100 text-[#0D2B4E] border border-blue-200 font-bold py-2 px-3 rounded-xl text-xs flex items-center justify-center gap-1.5 transition"
                      >
                        <span>🔄</span>
                        <span>Trocar Leito</span>
                      </button>

                      <button
                        onClick={() => dispararAcaoVisual('Cancelar Alocação')}
                        className="w-full bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-bold py-2 px-3 rounded-xl text-xs flex items-center justify-center gap-1.5 transition"
                      >
                        <span>❌</span>
                        <span>Cancelar</span>
                      </button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2 pt-1 border-t border-gray-200">
                      <button
                        onClick={() => dispararAcaoVisual('Solicitar Troca')}
                        className="w-full bg-blue-50 hover:bg-blue-100 text-blue-800 border border-blue-200 font-bold py-2 px-3 rounded-xl text-xs flex items-center justify-center gap-1.5 transition"
                      >
                        <span>🔄</span>
                        <span>Solicitar Troca</span>
                      </button>

                      <button
                        onClick={() => dispararAcaoVisual('Solicitar Cancelamento')}
                        className="w-full bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 font-bold py-2 px-3 rounded-xl text-xs flex items-center justify-center gap-1.5 transition"
                      >
                        <span>⚠️</span>
                        <span>Solicitar Cancelamento</span>
                      </button>
                    </div>
                  )}

                  <p className="text-[10px] text-center text-gray-400 italic">
                    Etapa 1: Ações visuais demonstrativas sem gravação no banco de dados.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
