'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';

import { createClient } from '@/lib/supabase-client';
import { authenticatedFetch } from '@/lib/api-client';

type MainDashboardData = {
  secretaria: {
    ministrosAtivos: number;
    campos: number;
    supervisoes: number;
    candidatos: number;
    credenciaisEmitidas: number;
    cartasEmitidas: number | null;
    cartasDisponiveis: boolean;
    ministrosInativos: number;
    transferidos: number;
    credenciaisVencidas: number;
    registrosRecentes: number;
    janelaRecentesDias: number;
  };
  cgadb: {
    registrados: number;
    naoRegistrados: number;
    comDebito: number;
    semDebito: number;
    regularidadePct: number;
  };
  eventos: {
    eventosAbertos: number;
    inscricoesAtivas: number;
    proximoEvento: { nome: string; dataInicio: string | null } | null;
    inscritosEventosAbertos: number;
  };
  graficos: {
    cgadbSituacao: { label: string; value: number }[];
    ministrosPorSupervisao: { supervisao: string; total: number }[];
    eventosPorMes: { mes: string; total: number }[];
  };
  ultimosRegistros: { nome: string; tipo: string | null; status: string | null; criadoEm: string | null }[];
  updatedAt: string;
};

export default function DashboardPage() {
  const router = useRouter();
  const supabase = createClient();
  const [activeMenu, setActiveMenu] = useState('dashboard');
  const [dataAtual, setDataAtual] = useState('');
  const [usuarioLogado, setUsuarioLogado] = useState<{
    nome: string;
    email: string;
    nivel: string;
  } | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [totais, setTotais] = useState({ supervisao: '—', campos: '—', candidatos: '—', ministros: '—' });
  const [matricula, setMatricula] = useState<string>('');
  const [mainData, setMainData] = useState<MainDashboardData | null>(null);
  const [mainLoading, setMainLoading] = useState(true);
  const [mainReloading, setMainReloading] = useState(false);
  const [mainError, setMainError] = useState('');

  useEffect(() => {
    const fetchTotais = async () => {
      const res = await authenticatedFetch('/api/v1/dashboard/metrics');
      if (!res.ok) return;
      const json = await res.json().catch(() => null as any);
      setTotais({
        supervisao: String(json?.supervisoes ?? 0),
        campos:     String(json?.campos ?? 0),
        candidatos: String(json?.candidatos ?? 0),
        ministros:  String(json?.ministros ?? 0),
      });
    };
    fetchTotais().catch(() => null);
  }, []);

  useEffect(() => {
    const run = async () => {
      try {
        const { data } = await supabase.auth.getUser();

        if (!data.user) {
          router.push('/login');
          return;
        }

        // 1) Tenta user_metadata.nivel (gravado na criação/edição via /usuarios)
        // 2) Se vazio, chama /api/auth/me que lê public.users via admin e sincroniza automaticamente
        let nivel: string = (data.user.user_metadata?.nivel as string | undefined) || '';
        if (!nivel) {
          try {
            const { data: sessionData } = await supabase.auth.getSession();
            const token = sessionData.session?.access_token || '';
            if (token) {
              const res = await fetch('/api/auth/me', {
                headers: { Authorization: `Bearer ${token}` },
              });
              if (res.ok) {
                const json = await res.json() as { nivel?: string };
                nivel = json.nivel || 'administrador';
              }
            }
          } catch {
            nivel = 'administrador';
          }
        }

        const nomeLogado = data.user.user_metadata?.full_name || data.user.email || 'Usuário';
        const emailLogado = data.user.email || '';

        setUsuarioLogado({ nome: nomeLogado, email: emailLogado, nivel });

        // Buscar matrícula na tabela members pelo e-mail
        if (emailLogado) {
          const memberRes = await authenticatedFetch(`/api/v1/members/lookup?email=${encodeURIComponent(emailLogado)}&limit=1`);
          if (memberRes.ok) {
            const memberJson = await memberRes.json().catch(() => null as any);
            const member = (memberJson?.data ?? [])[0] as { matricula?: string | null } | undefined;
            setMatricula(String(member?.matricula ?? ''));
          }
        }
      } finally {
        setAuthLoading(false);
      }
    };

    run();
  }, [router]);

  useEffect(() => {
    const formatarData = () => {
      const agora = new Date();
      const dias = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
      const meses = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
      
      const diaSemana = dias[agora.getDay()];
      const dia = agora.getDate();
      const mes = meses[agora.getMonth()];
      const ano = agora.getFullYear();
      const horas = String(agora.getHours()).padStart(2, '0');
      const minutos = String(agora.getMinutes()).padStart(2, '0');
      
      return `${diaSemana}, ${dia} de ${mes} de ${ano} - ${horas}:${minutos}`;
    };
    
    setDataAtual(formatarData());
    
    // Atualizar a cada minuto
    const intervalo = setInterval(() => {
      setDataAtual(formatarData());
    }, 60000);
    
    return () => clearInterval(intervalo);
  }, []);

  const loadMainData = useCallback(async (isReload = false) => {
    if (isReload) setMainReloading(true);
    else setMainLoading(true);
    setMainError('');

    try {
      const res = await authenticatedFetch('/api/dashboard/main');
      const json = await res.json().catch(() => null as unknown);
      if (!res.ok) {
        const errMsg = (json && typeof json === 'object' && 'error' in json)
          ? String((json as { error?: string }).error || 'Falha ao carregar dados.')
          : 'Falha ao carregar dados.';
        setMainError(errMsg);
        setMainData(null);
        return;
      }
      setMainData(json as MainDashboardData);
    } catch {
      setMainError('Falha de conexao. Verifique sua internet e tente novamente.');
      setMainData(null);
    } finally {
      setMainLoading(false);
      setMainReloading(false);
    }
  }, []);

  useEffect(() => {
    if (!authLoading) {
      loadMainData(false);
    }
  }, [authLoading, loadMainData]);

  const handleLogout = () => {
    supabase.auth.signOut().finally(() => router.push('/'));
  };

  const getNivelExibicao = (nivel: string) => {
    const mapeamento: { [key: string]: string } = {
      'super': 'Super',
      'administrador': 'Administrador',
      'cgadb': 'CGADB',
      'comissao': 'Comissão',
      'inscricao': 'Inscrição',
      'financeiro': 'Financeiro',
      'admin': 'Administrador',
      'manager': 'Gerente',
      'operator': 'Operador',
      'viewer': 'Visualizador'
    };
    return mapeamento[nivel] || nivel;
  };

  const getCorNivel = (nivel: string) => {
    const cores: { [key: string]: string } = {
      'super': 'bg-yellow-100 text-yellow-800',
      'administrador': 'bg-purple-100 text-purple-800',
      'cgadb': 'bg-red-100 text-red-800',
      'comissao': 'bg-indigo-100 text-indigo-800',
      'inscricao': 'bg-teal-100 text-teal-800',
      'financeiro': 'bg-blue-100 text-blue-800',
      'admin': 'bg-red-100 text-red-800',
      'manager': 'bg-green-100 text-green-800',
      'operator': 'bg-blue-100 text-blue-800',
      'viewer': 'bg-gray-100 text-gray-800'
    };
    return cores[nivel] || 'bg-gray-100 text-gray-800';
  };

  const formatDateShort = (value?: string | null) => {
    if (!value) return '—';
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return '—';
    return dt.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
  };

  const CORES_CGADB = ['#C0392B', '#16A34A', '#F39C12'];

  if (authLoading) return <div className="p-8">Carregando...</div>;

  const isSuper = usuarioLogado?.nivel === 'super';

  const toolbarItems: { label: string; icon: string; path: string; isImg?: boolean; requiresSuper?: boolean }[] = [
    { label: 'AGO',        icon: '/img/125ago.jpg', path: '/eventos', isImg: true, requiresSuper: true },
    { label: 'DESCONTO',   icon: '🏷️',  path: '/secretaria/cgadb',     requiresSuper: true },
    { label: 'COMISSÃO',   icon: '📋',  path: '/comissao',              requiresSuper: true },
    { label: 'USUÁRIOS',   icon: '🕵️', path: '/usuarios',              requiresSuper: true },
    { label: 'REGISTRO',   icon: '📒',  path: '/secretaria/membros',    requiresSuper: true },
    { label: 'CREDENCIAL', icon: '🪪',  path: '/credenciais', },
    { label: 'CARTAS',     icon: '📜',  path: '/secretaria/cartas',     },
    { label: 'CONEC',      icon: '/img/logo_conec.png', path: '/conec', isImg: true, requiresSuper: true },
  ];

  return (
    <div className="flex h-screen bg-[#EEF2F7]">
      <Sidebar activeMenu={activeMenu} setActiveMenu={setActiveMenu} />

      {/* MAIN CONTENT */}
      <div className="flex-1 overflow-auto">
        <div className="p-3 md:p-6">

          {/* ── BOAS-VINDAS + USUÁRIO (mobile: empilhado | desktop: linha) ── */}
          <div className="relative overflow-hidden bg-gradient-to-r from-[#0D2B4E] via-[#1A3A5C] to-[#1A5276] rounded-xl shadow-md px-5 py-4 mb-4 flex flex-col md:flex-row md:items-center gap-3">

            {/* Círculos decorativos */}
            <div className="absolute -right-8 -top-8 w-36 h-36 rounded-full bg-white/5 pointer-events-none" />
            <div className="absolute right-16 -bottom-10 w-28 h-28 rounded-full bg-white/5 pointer-events-none" />
            <div className="absolute right-4 top-2 w-10 h-10 rounded-full bg-[#F39C12]/20 pointer-events-none" />

            {/* Boas-vindas */}
            <div className="flex-1 min-w-0 z-10">
              <p className="text-[10px] font-semibold text-white/50 uppercase tracking-widest leading-none mb-1">Seja bem-vindo(a)</p>
              <p className="text-base md:text-lg font-bold text-white leading-tight break-words">
                &ldquo;<span className="text-[#F39C12]">{usuarioLogado?.nome?.toUpperCase() ?? ''}</span>&rdquo;
              </p>
              {matricula && (
                <p className="text-xs text-white/60 leading-tight mt-0.5">
                  Matrícula: <span className="font-semibold text-white">{matricula}</span>
                </p>
              )}
              <p className="text-white/40 text-xs mt-1 leading-tight">{dataAtual}</p>
            </div>

            {/* Separador vertical (só desktop) */}
            <div className="hidden md:block w-px h-14 bg-white/20 shrink-0" />

            {/* Usuário + Sair */}
            {usuarioLogado && (
              <div className="flex items-center justify-between md:justify-end gap-3 shrink-0 z-10">
                <div className="text-left md:text-right">
                  <p className="text-xs font-semibold text-white">{usuarioLogado.nome}</p>
                  <p className="text-[11px] text-white/60">{usuarioLogado.email}</p>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${getCorNivel(usuarioLogado.nivel)}`}>
                    {getNivelExibicao(usuarioLogado.nivel)}
                  </span>
                </div>
                <button
                  onClick={handleLogout}
                  className="px-3 py-2 bg-[#C0392B] text-white rounded-lg hover:bg-[#a93226] transition font-semibold text-sm shrink-0"
                >
                  Sair
                </button>
              </div>
            )}
          </div>

          {/* ── TOOLBAR DE ATALHOS ── */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 px-3 py-3 mb-4 overflow-x-auto">
            <div className="flex gap-2 min-w-max md:min-w-0 md:flex-wrap md:justify-center">
              {toolbarItems.map((item) => {
                const disabled = item.requiresSuper && !isSuper;
                return (
                  <button
                    key={item.label}
                    onClick={() => { if (!disabled) router.push(item.path); }}
                    disabled={disabled}
                    title={disabled ? 'Acesso nao autorizado!' : item.label}
                    className={`flex flex-col items-center justify-center gap-1 w-14 h-14 md:w-16 md:h-16 rounded-lg border border-gray-200 bg-white text-[#0D2B4E] transition shrink-0 ${disabled ? 'opacity-40 cursor-not-allowed' : 'hover:shadow-md hover:scale-105'}`}
                  >
                    {item.isImg
                      ? (
                        <img
                          src={item.icon}
                          alt={item.label}
                          className={item.label === 'AGO'
                            ? 'w-10 h-10 md:w-12 md:h-12 object-contain'
                            : 'w-7 h-7 md:w-8 md:h-8 object-contain'}
                        />
                      )
                      : <span className="text-xl md:text-2xl leading-none">{item.icon}</span>
                    }
                    {item.label === 'AGO'
                      ? <span className="sr-only">{item.label}</span>
                      : <span className="text-[8px] md:text-[9px] font-bold tracking-wide text-center leading-tight">{item.label}</span>
                    }
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── STATS CARDS ── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            {[
              {
                label: 'Total de Supervisão',
                value: totais.supervisao,
                key: 'supervisao',
                icon: '🏛️',
                accent: '#0D2B4E',
                bg: 'from-[#0D2B4E] to-[#1A5276]',
              },
              {
                label: 'Total de Campos',
                value: totais.campos,
                key: 'campos',
                icon: '⛪',
                accent: '#1A5276',
                bg: 'from-[#1A5276] to-[#2980B9]',
              },
              {
                label: 'Total de Candidatos',
                value: totais.candidatos,
                key: 'candidatos',
                icon: '📋',
                accent: '#F39C12',
                bg: 'from-[#F39C12] to-[#F1C40F]',
              },
              {
                label: 'Ministros Ativos',
                value: totais.ministros,
                key: 'ministros',
                icon: '✝️',
                accent: '#00BCD4',
                bg: 'from-[#00838F] to-[#00BCD4]',
              },
            ].map((card) => (
              <div
                key={card.key}
                className={`relative overflow-hidden rounded-xl shadow-md bg-gradient-to-br ${card.bg} p-4 md:p-5 flex flex-col justify-between min-h-[100px]`}
              >
                {/* Círculo decorativo de fundo */}
                <div className="absolute -right-4 -top-4 w-20 h-20 rounded-full bg-white/10" />
                <div className="absolute -right-2 -bottom-6 w-16 h-16 rounded-full bg-white/10" />

                {/* Ícone + Label */}
                <div className="flex items-center gap-2 z-10">
                  <span className="text-xl leading-none">{card.icon}</span>
                  <span className="text-[10px] md:text-xs font-semibold text-white/80 uppercase tracking-wider leading-tight">{card.label}</span>
                </div>

                {/* Número */}
                <p className="text-3xl md:text-4xl font-extrabold text-white leading-none mt-3 z-10">{card.value}</p>
              </div>
            ))}
          </div>

          {/* ── NOVAS SECOES INSTITUCIONAIS ── */}
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm md:text-base font-bold text-[#0D2B4E]">Resumo institucional</h2>
                <p className="text-xs text-gray-500">Secretaria, CGADB e eventos (sem dados financeiros)</p>
              </div>
              <button
                onClick={() => loadMainData(true)}
                className="px-3 py-2 rounded-lg bg-[#0D2B4E] text-white text-xs font-semibold hover:bg-[#0b243f] transition disabled:opacity-60"
                disabled={mainReloading}
              >
                {mainReloading ? 'Atualizando...' : 'Atualizar'}
              </button>
            </div>

            {mainError && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-4 flex items-start gap-3">
                <span className="text-red-500 text-lg">⚠️</span>
                <div>
                  <p className="text-sm font-bold text-red-700">Erro ao carregar dados institucionais</p>
                  <p className="text-sm text-red-600 mt-0.5">{mainError}</p>
                  <button
                    onClick={() => loadMainData(true)}
                    className="mt-2 text-xs font-semibold text-red-700 underline hover:no-underline"
                  >
                    Tentar novamente
                  </button>
                </div>
              </div>
            )}

            {mainLoading ? (
              <div className="space-y-4 animate-pulse">
                <div className="bg-white border border-gray-200 rounded-xl p-4 md:p-5">
                  <div className="h-3 bg-gray-100 rounded w-1/4 mb-4" />
                  <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
                    {Array.from({ length: 6 }).map((_, idx) => (
                      <div key={`sec-skel-${idx}`} className="h-20 bg-gray-100 rounded-lg" />
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="h-48 bg-white border border-gray-200 rounded-xl" />
                  <div className="h-48 bg-white border border-gray-200 rounded-xl" />
                </div>
                <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                  {Array.from({ length: 3 }).map((_, idx) => (
                    <div key={`chart-skel-${idx}`} className="h-64 bg-white border border-gray-200 rounded-xl" />
                  ))}
                </div>
                <div className="h-52 bg-white border border-gray-200 rounded-xl" />
              </div>
            ) : !mainData ? (
              <div className="bg-white border border-gray-200 rounded-xl px-4 py-6 text-center text-sm text-gray-500">
                Nenhum dado institucional disponivel no momento.
              </div>
            ) : (
              <>
                {/* Secretaria */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 md:p-5">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="text-sm font-bold text-gray-800">Secretaria</h3>
                      <p className="text-xs text-gray-500">Indicadores institucionais</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
                    {[
                      { label: 'Credenciais emitidas', value: mainData.secretaria.credenciaisEmitidas, icon: '🪪' },
                      {
                        label: 'Cartas emitidas',
                        value: mainData.secretaria.cartasDisponiveis
                          ? (mainData.secretaria.cartasEmitidas ?? 0)
                          : 'N/D',
                        icon: '📜',
                        helper: mainData.secretaria.cartasDisponiveis ? '' : 'Sem base no sistema',
                      },
                      { label: 'Credenciais vencidas', value: mainData.secretaria.credenciaisVencidas, icon: '⏳' },
                      { label: 'Ministros inativos', value: mainData.secretaria.ministrosInativos, icon: '⛔' },
                      { label: 'Transferidos', value: mainData.secretaria.transferidos, icon: '🔁' },
                      {
                        label: 'Cadastros recentes',
                        value: mainData.secretaria.registrosRecentes,
                        icon: '🆕',
                        helper: `Ultimos ${mainData.secretaria.janelaRecentesDias} dias`,
                      },
                    ].map((item) => (
                      <div
                        key={item.label}
                        className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-3 flex flex-col gap-2"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">{item.label}</span>
                          <span className="text-base">{item.icon}</span>
                        </div>
                        <p className="text-xl font-bold text-[#0D2B4E]">{item.value}</p>
                        {item.helper && (
                          <span className="text-[10px] text-gray-400">{item.helper}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Graficos */}
                <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                  <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 md:p-5">
                    <h3 className="text-sm font-bold text-gray-800">Situacao CGADB</h3>
                    <p className="text-xs text-gray-500">Distribuicao geral</p>
                    {mainData.graficos.cgadbSituacao.length > 0 ? (
                      <div className="h-56 mt-4">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={mainData.graficos.cgadbSituacao}
                              dataKey="value"
                              nameKey="label"
                              innerRadius={50}
                              outerRadius={90}
                              paddingAngle={3}
                            >
                              {mainData.graficos.cgadbSituacao.map((_, idx) => (
                                <Cell key={`cgadb-${idx}`} fill={CORES_CGADB[idx % CORES_CGADB.length]} />
                              ))}
                            </Pie>
                            <Tooltip />
                            <Legend verticalAlign="bottom" height={32} iconType="circle" />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    ) : (
                      <div className="h-40 flex items-center justify-center text-sm text-gray-400">
                        Sem dados para exibir
                      </div>
                    )}
                  </div>

                  <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 md:p-5">
                    <h3 className="text-sm font-bold text-gray-800">Ministros por supervisao</h3>
                    <p className="text-xs text-gray-500">Top supervisoes</p>
                    {mainData.graficos.ministrosPorSupervisao.length > 0 ? (
                      <div className="h-56 mt-4">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={mainData.graficos.ministrosPorSupervisao} margin={{ left: 0, right: 10 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                            <XAxis dataKey="supervisao" tick={{ fontSize: 10, fill: '#64748b' }} interval={0} />
                            <YAxis tick={{ fontSize: 10, fill: '#64748b' }} />
                            <Tooltip />
                            <Bar dataKey="total" fill="#1A5276" radius={[6, 6, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    ) : (
                      <div className="h-40 flex items-center justify-center text-sm text-gray-400">
                        Sem dados para exibir
                      </div>
                    )}
                  </div>

                  <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 md:p-5">
                    <h3 className="text-sm font-bold text-gray-800">Eventos por mes</h3>
                    <p className="text-xs text-gray-500">Calendario institucional</p>
                    {mainData.graficos.eventosPorMes.length > 0 ? (
                      <div className="h-56 mt-4">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={mainData.graficos.eventosPorMes} margin={{ left: 0, right: 10 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                            <XAxis dataKey="mes" tick={{ fontSize: 10, fill: '#64748b' }} />
                            <YAxis tick={{ fontSize: 10, fill: '#64748b' }} />
                            <Tooltip />
                            <Bar dataKey="total" fill="#0D2B4E" radius={[6, 6, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    ) : (
                      <div className="h-40 flex items-center justify-center text-sm text-gray-400">
                        Sem dados para exibir
                      </div>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {/* CGADB */}
                  <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 md:p-5">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h3 className="text-sm font-bold text-gray-800">CGADB</h3>
                        <p className="text-xs text-gray-500">Regularidade e registros</p>
                      </div>
                      <button
                        onClick={() => router.push('/secretaria/cgadb')}
                        className="text-xs font-semibold text-blue-600 hover:underline"
                      >
                        Ver CGADB
                      </button>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      {[
                        { label: 'Registrados', value: mainData.cgadb.registrados },
                        { label: 'Nao registrados', value: mainData.cgadb.naoRegistrados },
                        { label: 'Com debito', value: mainData.cgadb.comDebito },
                        { label: 'Sem debito', value: mainData.cgadb.semDebito },
                        { label: 'Regularidade', value: `${mainData.cgadb.regularidadePct.toFixed(1)}%` },
                      ].map((item) => (
                        <div key={item.label} className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-3">
                          <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">{item.label}</p>
                          <p className="text-lg font-bold text-[#0D2B4E] mt-1">{item.value}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Eventos */}
                  <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 md:p-5">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h3 className="text-sm font-bold text-gray-800">Eventos abertos</h3>
                        <p className="text-xs text-gray-500">Inscricoes e proximas datas</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-3">
                        <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Eventos abertos</p>
                        <p className="text-lg font-bold text-[#0D2B4E] mt-1">{mainData.eventos.eventosAbertos}</p>
                      </div>
                      <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-3">
                        <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Inscricoes efetivadas</p>
                        <p className="text-lg font-bold text-[#0D2B4E] mt-1">{mainData.eventos.inscricoesAtivas}</p>
                      </div>
                      <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-3">
                        <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Proximo evento</p>
                        <p className="text-sm font-bold text-[#0D2B4E] mt-1">
                          {mainData.eventos.proximoEvento
                            ? mainData.eventos.proximoEvento.nome
                            : 'Sem eventos'}
                        </p>
                        <p className="text-[10px] text-gray-500">
                          {mainData.eventos.proximoEvento
                            ? formatDateShort(mainData.eventos.proximoEvento.dataInicio)
                            : '—'}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 md:p-5">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="text-sm font-bold text-gray-800">Ultimos registros da secretaria</h3>
                      <p className="text-xs text-gray-500">Cadastro recente de ministros</p>
                    </div>
                    <span className="text-[10px] text-gray-400">Atualizado agora</span>
                  </div>
                  {mainData.ultimosRegistros.length > 0 ? (
                    <div className="space-y-3">
                      {mainData.ultimosRegistros.map((item, idx) => (
                        <div key={`${item.nome}-${idx}`} className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-semibold text-gray-700">{item.nome}</p>
                            <p className="text-[11px] text-gray-500">
                              {item.tipo || 'Sem tipo'}{item.status ? ` • ${item.status}` : ''}
                            </p>
                          </div>
                          <span className="text-[11px] text-gray-400">{formatDateShort(item.criadoEm)}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-sm text-gray-400 text-center py-6">Sem registros recentes</div>
                  )}
                </div>
              </>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
