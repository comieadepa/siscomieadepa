'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '@/components/Sidebar';

import { createClient } from '@/lib/supabase-client';

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

  useEffect(() => {
    const fetchTotais = async () => {
      const [{ count: cSup }, { count: cCampos }, { count: cCand }, { count: cMin }] = await Promise.all([
        supabase.from('supervisoes').select('*', { count: 'exact', head: true }).eq('is_active', true),
        supabase.from('campos').select('*', { count: 'exact', head: true }).eq('is_active', true),
        supabase.from('members').select('*', { count: 'exact', head: true }).eq('status', 'candidate'),
        supabase.from('members').select('*', { count: 'exact', head: true }).eq('status', 'active'),
      ]);
      setTotais({
        supervisao: String(cSup ?? 0),
        campos:     String(cCampos ?? 0),
        candidatos: String(cCand ?? 0),
        ministros:  String(cMin ?? 0),
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

        // Buscar role do usuário em public.users
        const { data: publicUser } = await supabase
          .from('users')
          .select('role')
          .eq('id', data.user.id)
          .maybeSingle();

        const nivel = publicUser?.role ? String(publicUser.role) : 'operator';

        const nomeLogado = data.user.user_metadata?.full_name || data.user.email || 'Usuário';
        const emailLogado = data.user.email || '';

        setUsuarioLogado({ nome: nomeLogado, email: emailLogado, nivel });

        // Buscar matrícula na tabela members pelo e-mail
        const { data: memberData } = await supabase
          .from('members')
          .select('matricula')
          .ilike('email', emailLogado)
          .maybeSingle();
        setMatricula(String(memberData?.matricula ?? ''));
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

  const handleLogout = () => {
    supabase.auth.signOut().finally(() => router.push('/'));
  };

  const getNivelExibicao = (nivel: string) => {
    const mapeamento: { [key: string]: string } = {
      'admin': 'Administrador',
      'manager': 'Gerente',
      'operator': 'Operador',
      'viewer': 'Visualizador'
    };
    return mapeamento[nivel] || nivel;
  };

  const getCorNivel = (nivel: string) => {
    const cores: { [key: string]: string } = {
      'admin': 'bg-red-100 text-red-800',
      'manager': 'bg-green-100 text-green-800',
      'operator': 'bg-blue-100 text-blue-800',
      'viewer': 'bg-gray-100 text-gray-800'
    };
    return cores[nivel] || 'bg-gray-100 text-gray-800';
  };

  if (authLoading) return <div className="p-8">Carregando...</div>;

  const toolbarItems: { label: string; icon: string; path: string; isImg?: boolean }[] = [
    { label: 'AGO',        icon: '🏛️',  path: '/eventos',              },
    { label: 'DESCONTO',   icon: '🏷️',  path: '/secretaria/cgadb',     },
    { label: 'COMISSÃO',   icon: '📋',  path: '/comissao',              },
    { label: 'USUÁRIOS',   icon: '🕵️', path: '/usuarios',              },
    { label: 'REGISTRO',   icon: '📒',  path: '/secretaria/membros',    },
    { label: 'CREDENCIAL', icon: '🪪',  path: '/configuracoes/cartoes', },
    { label: 'CARTAS',     icon: '📜',  path: '/secretaria/cartas',     },
    { label: 'CONEC',      icon: '/img/logo_conec.png', path: '/conec', isImg: true },
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
              {toolbarItems.map((item) => (
                <button
                  key={item.label}
                  onClick={() => router.push(item.path)}
                  className="flex flex-col items-center justify-center gap-1 w-14 h-14 md:w-16 md:h-16 rounded-lg border border-gray-200 bg-white text-[#0D2B4E] hover:shadow-md hover:scale-105 transition shrink-0"
                >
                  {item.isImg
                    ? <img src={item.icon} alt={item.label} className="w-7 h-7 md:w-8 md:h-8 object-contain" />
                    : <span className="text-xl md:text-2xl leading-none">{item.icon}</span>
                  }
                  <span className="text-[8px] md:text-[9px] font-bold tracking-wide text-center leading-tight">{item.label}</span>
                </button>
              ))}
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

        </div>
      </div>
    </div>
  );
}
