'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { useMinistro } from '../ministro-context';
import {
  Menu,
  Bell,
  Calendar,
  Award,
  MessageSquare,
  Coins,
  FileText,
  BookOpen,
  IdCard,
  Headphones,
  Info,
  Home,
  User,
  X,
  ChevronRight,
  LogOut,
  ExternalLink,
  ShieldCheck,
  CheckCircle2,
  Clock
} from 'lucide-react';

export default function AplicativoDoMinistroPage() {
  const router = useRouter();
  const { ministro } = useMinistro();

  // Estados dos modais / gavetas
  const [menuOpen, setMenuOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'inicio' | 'eventos' | 'comunicados' | 'perfil'>('inicio');
  const [infoModal, setInfoModal] = useState<{
    open: boolean;
    title: string;
    description: string;
    icon?: any;
    accentColor?: string;
    actionLabel?: string;
    actionUrl?: string;
  }>({
    open: false,
    title: '',
    description: '',
  });

  // Notificações e Comunicados reais do ministro
  const [unreadCount, setUnreadCount] = useState(0);
  const [notificacoes, setNotificacoes] = useState<any[]>([]);
  const [loadingNotifs, setLoadingNotifs] = useState(false);

  // Registro do Service Worker para PWA
  useEffect(() => {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch((err) => {
        console.debug('ServiceWorker registration error:', err);
      });
    }
  }, []);

  // Busca notificações e comunicados do ministro
  const fetchNotificacoes = useCallback(async () => {
    try {
      setLoadingNotifs(true);
      const res = await fetch('/api/portal-ministro/notificacoes?limit=15');
      if (res.ok) {
        const data = await res.json();
        setNotificacoes(data.notificacoes || []);
        setUnreadCount(data.totalNaoLidas || 0);
      }
    } catch (e) {
      console.debug('Erro ao carregar notificações:', e);
    } finally {
      setLoadingNotifs(false);
    }
  }, []);

  useEffect(() => {
    fetchNotificacoes();
  }, [fetchNotificacoes]);

  const handleLogout = async () => {
    await fetch('/api/portal-ministro/auth/logout', { method: 'POST' });
    router.push('/portal-ministro/login');
  };

  const handleOpenCard = (cardKey: string) => {
    switch (cardKey) {
      case 'eventos':
        router.push('/portal-ministro/eventos');
        break;
      case 'certificados':
        router.push('/portal-ministro/certificados');
        break;
      case 'comunicados':
        setNotifOpen(true);
        break;
      case 'contribuicao':
        if (ministro?.isPastorPresidente) {
          router.push('/portal-ministro/contribuicoes');
        } else {
          setInfoModal({
            open: true,
            title: 'Contribuição Estatutária',
            description: 'A contribuição estatutária é gerenciada exclusivamente pelo Pastor Presidente titular do campo ministerial homologado na Convenção.',
            accentColor: '#BD8724',
          });
        }
        break;
      case 'consagracao':
        setInfoModal({
          open: true,
          title: 'Processos de Consagração',
          description: ministro?.isPastorPresidente
            ? `Como Pastor Presidente do campo ${ministro.campo || 'vinculado'}, os formulários de indicação e acompanhamento de candidatos para a próxima AGEO estão sendo centralizados com validação eletrônica pela Secretaria Geral.`
            : 'Seus dados e históricos de consagração estão integrados ao SISCOMIEADEPA. Novas etapas de consagração e homologação são processadas via Secretaria Geral.',
          accentColor: '#BD8724',
          actionLabel: 'Ver Histórico Ministerial',
          actionUrl: '/portal-ministro/historico',
        });
        break;
      case 'documentos':
        setInfoModal({
          open: true,
          title: 'Documentos e Normas',
          description: 'Estatuto Geral da COMIEADEPA, Regimento Interno, resoluções da Mesa Diretora e orientações convencionais vigentes.',
          actionLabel: 'Consultar Secretaria Geral',
          actionUrl: 'https://comieadepa.org.br',
        });
        break;
      case 'dados':
        setActiveTab('perfil');
        break;
      case 'suporte':
        setInfoModal({
          open: true,
          title: 'Suporte e Ajuda',
          description: 'Precisa de suporte com seu cadastro, credencial ou acesso? A equipe técnica e a Secretaria Geral da COMIEADEPA atendem pelo canal oficial de suporte.',
          actionLabel: 'Abrir Suporte no WhatsApp',
          actionUrl: 'https://wa.me/5591981234567?text=Ol%C3%A1%2C%20preciso%20de%20suporte%20no%20Aplicativo%20do%20Ministro',
        });
        break;
      case 'sobre':
        setInfoModal({
          open: true,
          title: 'Sobre o Aplicativo',
          description: 'Aplicativo do Ministro — Versão 1.0 PWA\nConvenção dos Ministros das Assembleias de Deus no Estado do Pará (COMIEADEPA).\n\nIntegrado em tempo real ao SISCOMIEADEPA com segurança de nível bancário e autenticação criptografada.',
        });
        break;
      default:
        break;
    }
  };

  const isAtivo = ministro?.status === 'active';

  return (
    <div className="min-h-screen bg-[#071D36] text-[#10243C] flex justify-center selection:bg-amber-400 selection:text-blue-950 font-sans">
      {/* Container Principal Mobile-First: 100vw no celular, max 430px em desktop, max 600px em tablet */}
      <div className="w-full max-w-[430px] md:max-w-[600px] min-h-screen relative flex flex-col shadow-2xl bg-[#EAF3FF] overflow-x-hidden">
        
        {/* CAMADA DO BACKGROUND OFICIAL /img/bg_app1.png */}
        <div
          className="absolute inset-0 pointer-events-none z-0"
          style={{
            backgroundImage: "url('/img/bg_app1.png')",
            backgroundPosition: 'center top',
            backgroundRepeat: 'no-repeat',
            backgroundSize: '100% auto',
          }}
          aria-hidden="true"
        />

        {/* ── CABEÇALHO SUPERIOR (Altura funcional 64px + safe area) ── */}
        <header
          className="relative z-10 w-full px-[18px] flex items-center justify-between"
          style={{
            paddingTop: 'calc(env(safe-area-inset-top, 0px) + 12px)',
            minHeight: '64px',
          }}
        >
          {/* Menu Hambúrguer (42x42px) */}
          <button
            onClick={() => setMenuOpen(true)}
            aria-label="Abrir Menu Lateral"
            className="w-[42px] h-[42px] rounded-xl flex items-center justify-center text-white bg-white/10 hover:bg-white/20 active:scale-95 transition-all backdrop-blur-sm shadow-sm"
          >
            <Menu size={22} strokeWidth={2.2} />
          </button>

          {/* Identidade COMIEADEPA Centralizada */}
          <div className="flex-1 flex flex-col items-center justify-center px-2">
            <div className="flex items-center gap-2">
              <Image
                src="/img/logo_comieadepa.png"
                alt="COMIEADEPA"
                width={36}
                height={36}
                priority
                className="object-contain drop-shadow-md"
                style={{ height: '36px', width: 'auto' }}
              />
              <div className="text-left leading-none">
                <span className="block text-white font-extrabold text-[17px] tracking-tight drop-shadow-sm">
                  COMIEADEPA
                </span>
                <span className="block text-white/90 text-[8.5px] font-medium tracking-tight whitespace-nowrap drop-shadow-sm">
                  Convenção das Assembleias de Deus no Pará
                </span>
              </div>
            </div>
          </div>

          {/* Botão Sino Notificações (42x42px) */}
          <button
            onClick={() => setNotifOpen(true)}
            aria-label="Notificações"
            className="w-[42px] h-[42px] rounded-xl flex items-center justify-center text-white bg-white/10 hover:bg-white/20 active:scale-95 transition-all relative backdrop-blur-sm shadow-sm"
          >
            <Bell size={21} strokeWidth={2.2} />
            {unreadCount > 0 && (
              <span className="absolute top-2 right-2 w-[8px] h-[8px] rounded-full bg-[#E74747] ring-2 ring-[#0D2B4E] animate-pulse" />
            )}
          </button>
        </header>

        {/* ── CONTEÚDO PRINCIPAL ROLÁVEL ── */}
        <main
          className="relative z-10 flex-1 px-4 pt-2 flex flex-col"
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 90px)' }}
        >
          {activeTab === 'inicio' && (
            <>
              {/* ── APRESENTAÇÃO 'Aplicativo do Ministro' ── */}
              <section className="pt-2 pb-3 px-1 flex items-center gap-3">
                {/* Acento vertical dourado 4x52px, cor #E5B84C */}
                <div
                  className="w-[4px] h-[50px] rounded-[4px] flex-shrink-0 shadow-sm"
                  style={{ backgroundColor: '#E5B84C' }}
                />
                <div className="flex flex-col text-left drop-shadow-md">
                  <span className="text-white text-[22px] leading-[26px] font-bold tracking-tight">
                    Aplicativo do
                  </span>
                  <span className="text-white text-[30px] leading-[34px] font-extrabold tracking-tight">
                    Ministro
                  </span>
                </div>
              </section>

              {/* ── CARD DO MINISTRO ── */}
              <section
                className="w-full rounded-[20px] p-[14px] text-white shadow-xl transition-all"
                style={{
                  background: 'linear-gradient(120deg, #092C54 0%, #154C82 100%)',
                  boxShadow: '0 8px 24px rgba(9, 44, 84, 0.35)',
                }}
              >
                <div className="flex items-center gap-3">
                  {/* Avatar Circular 70x70px */}
                  <div className="w-[70px] h-[70px] rounded-full overflow-hidden flex-shrink-0 ring-2 ring-white/30 bg-[#061B35] shadow-md flex items-center justify-center">
                    {ministro?.fotoUrl ? (
                      <img
                        src={ministro.fotoUrl}
                        alt={ministro.nome}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full bg-gradient-to-br from-[#1D64A4] to-[#092A50] flex items-center justify-center text-white font-bold text-2xl">
                        {ministro?.nome?.charAt(0) || 'M'}
                      </div>
                    )}
                  </div>

                  {/* Informações Centrais */}
                  <div className="flex-1 min-w-0 pr-1">
                    <h1 className="text-[17px] font-bold text-white leading-tight line-clamp-2">
                      {ministro?.nome || 'Carregando...'}
                    </h1>
                    <p className="text-[12px] text-[#D6E4F2] font-normal leading-tight mt-1 truncate">
                      {ministro?.cargo || 'Ministro'} {ministro?.matricula ? `– Reg. ${ministro.matricula}` : '– COMIEADEPA'}
                    </p>
                    {ministro?.campo && (
                      <p className="text-[11px] text-[#9FBEDC] font-light truncate mt-0.5">
                        {ministro.campo}
                      </p>
                    )}
                  </div>

                  {/* Chip de Status (Altura 26px, verde #45D17A se active) */}
                  <div className="flex-shrink-0 self-center">
                    <div
                      className="h-[26px] px-2.5 rounded-full flex items-center gap-1.5 text-[11px] font-semibold tracking-wide shadow-sm"
                      style={{ backgroundColor: '#153F63' }}
                    >
                      <span
                        className="w-[7px] h-[7px] rounded-full"
                        style={{ backgroundColor: isAtivo ? '#45D17A' : '#F59E0B' }}
                      />
                      <span className="text-white/95">
                        {isAtivo ? 'Ativo' : 'Pendente'}
                      </span>
                    </div>
                  </div>
                </div>
              </section>

              {/* ── GRADE PRINCIPAL DE SERVIÇOS (3 Colunas) ── */}
              <section className="mt-[18px] pb-4">
                <div className="grid grid-cols-3 gap-[10px]">
                  
                  {/* 1. Eventos e AGOEs */}
                  <button
                    onClick={() => handleOpenCard('eventos')}
                    className="flex flex-col items-center justify-center min-h-[116px] p-[10px_6px] rounded-[17px] bg-[rgba(255,255,255,0.94)] border border-[rgba(255,255,255,0.9)] shadow-[0_5px_16px_rgba(15,55,100,0.12)] active:scale-95 transition-all text-center group"
                  >
                    <div className="w-[34px] h-[34px] flex items-center justify-center text-[#123B69] group-hover:scale-110 transition-transform">
                      <Calendar size={28} strokeWidth={2.2} />
                    </div>
                    <span className="mt-[9px] text-[12px] font-[650] leading-[15px] text-[#10243C] line-clamp-3">
                      Eventos e AGOEs
                    </span>
                  </button>

                  {/* 2. Meus Certificados */}
                  <button
                    onClick={() => handleOpenCard('certificados')}
                    className="flex flex-col items-center justify-center min-h-[116px] p-[10px_6px] rounded-[17px] bg-[rgba(255,255,255,0.94)] border border-[rgba(255,255,255,0.9)] shadow-[0_5px_16px_rgba(15,55,100,0.12)] active:scale-95 transition-all text-center group"
                  >
                    <div className="w-[34px] h-[34px] flex items-center justify-center text-[#123B69] group-hover:scale-110 transition-transform">
                      <Award size={28} strokeWidth={2.2} />
                    </div>
                    <span className="mt-[9px] text-[12px] font-[650] leading-[15px] text-[#10243C] line-clamp-3">
                      Meus Certificados
                    </span>
                  </button>

                  {/* 3. Comunicados da Convenção */}
                  <button
                    onClick={() => handleOpenCard('comunicados')}
                    className="relative flex flex-col items-center justify-center min-h-[116px] p-[10px_6px] rounded-[17px] bg-[rgba(255,255,255,0.94)] border border-[rgba(255,255,255,0.9)] shadow-[0_5px_16px_rgba(15,55,100,0.12)] active:scale-95 transition-all text-center group"
                  >
                    {unreadCount > 0 && (
                      <span className="absolute top-2 right-2 w-[9px] h-[9px] rounded-full bg-[#E74747] ring-2 ring-white" />
                    )}
                    <div className="w-[34px] h-[34px] flex items-center justify-center text-[#123B69] group-hover:scale-110 transition-transform">
                      <MessageSquare size={28} strokeWidth={2.2} />
                    </div>
                    <span className="mt-[9px] text-[12px] font-[650] leading-[15px] text-[#10243C] line-clamp-3">
                      Comunicados da Convenção
                    </span>
                  </button>

                  {/* 4. Contribuição Estatutária (Exibida SOMENTE para Pastor Presidente com autorização) */}
                  {ministro?.isPastorPresidente && (
                    <button
                      onClick={() => handleOpenCard('contribuicao')}
                      className="flex flex-col items-center justify-center min-h-[116px] p-[10px_6px] rounded-[17px] bg-[rgba(255,250,240,0.96)] border border-[#F3DFC1] shadow-[0_5px_16px_rgba(189,135,36,0.15)] active:scale-95 transition-all text-center group"
                    >
                      <div className="w-[34px] h-[34px] flex items-center justify-center text-[#BD8724] group-hover:scale-110 transition-transform">
                        <Coins size={28} strokeWidth={2.2} />
                      </div>
                      <span className="mt-[9px] text-[12px] font-[650] leading-[15px] text-[#80530B] line-clamp-3">
                        Contribuição Estatutária
                      </span>
                    </button>
                  )}

                  {/* 5. Processos de Consagração */}
                  <button
                    onClick={() => handleOpenCard('consagracao')}
                    className="flex flex-col items-center justify-center min-h-[116px] p-[10px_6px] rounded-[17px] bg-[rgba(255,250,240,0.96)] border border-[#F3DFC1] shadow-[0_5px_16px_rgba(189,135,36,0.15)] active:scale-95 transition-all text-center group"
                  >
                    <div className="w-[34px] h-[34px] flex items-center justify-center text-[#BD8724] group-hover:scale-110 transition-transform">
                      <FileText size={28} strokeWidth={2.2} />
                    </div>
                    <span className="mt-[9px] text-[12px] font-[650] leading-[15px] text-[#80530B] line-clamp-3">
                      Processos de Consagração
                    </span>
                  </button>

                  {/* 6. Documentos e Normas */}
                  <button
                    onClick={() => handleOpenCard('documentos')}
                    className="flex flex-col items-center justify-center min-h-[116px] p-[10px_6px] rounded-[17px] bg-[rgba(255,255,255,0.94)] border border-[rgba(255,255,255,0.9)] shadow-[0_5px_16px_rgba(15,55,100,0.12)] active:scale-95 transition-all text-center group"
                  >
                    <div className="w-[34px] h-[34px] flex items-center justify-center text-[#123B69] group-hover:scale-110 transition-transform">
                      <BookOpen size={28} strokeWidth={2.2} />
                    </div>
                    <span className="mt-[9px] text-[12px] font-[650] leading-[15px] text-[#10243C] line-clamp-3">
                      Documentos e Normas
                    </span>
                  </button>

                  {/* 7. Meus Dados Ministeriais */}
                  <button
                    onClick={() => handleOpenCard('dados')}
                    className="flex flex-col items-center justify-center min-h-[116px] p-[10px_6px] rounded-[17px] bg-[rgba(255,255,255,0.94)] border border-[rgba(255,255,255,0.9)] shadow-[0_5px_16px_rgba(15,55,100,0.12)] active:scale-95 transition-all text-center group"
                  >
                    <div className="w-[34px] h-[34px] flex items-center justify-center text-[#123B69] group-hover:scale-110 transition-transform">
                      <IdCard size={28} strokeWidth={2.2} />
                    </div>
                    <span className="mt-[9px] text-[12px] font-[650] leading-[15px] text-[#10243C] line-clamp-3">
                      Meus Dados Ministeriais
                    </span>
                  </button>

                  {/* 8. Suporte e Ajuda */}
                  <button
                    onClick={() => handleOpenCard('suporte')}
                    className="flex flex-col items-center justify-center min-h-[116px] p-[10px_6px] rounded-[17px] bg-[rgba(255,255,255,0.94)] border border-[rgba(255,255,255,0.9)] shadow-[0_5px_16px_rgba(15,55,100,0.12)] active:scale-95 transition-all text-center group"
                  >
                    <div className="w-[34px] h-[34px] flex items-center justify-center text-[#123B69] group-hover:scale-110 transition-transform">
                      <Headphones size={28} strokeWidth={2.2} />
                    </div>
                    <span className="mt-[9px] text-[12px] font-[650] leading-[15px] text-[#10243C] line-clamp-3">
                      Suporte e Ajuda
                    </span>
                  </button>

                  {/* 9. Sobre o Aplicativo */}
                  <button
                    onClick={() => handleOpenCard('sobre')}
                    className="flex flex-col items-center justify-center min-h-[116px] p-[10px_6px] rounded-[17px] bg-[rgba(255,255,255,0.94)] border border-[rgba(255,255,255,0.9)] shadow-[0_5px_16px_rgba(15,55,100,0.12)] active:scale-95 transition-all text-center group"
                  >
                    <div className="w-[34px] h-[34px] flex items-center justify-center text-[#123B69] group-hover:scale-110 transition-transform">
                      <Info size={28} strokeWidth={2.2} />
                    </div>
                    <span className="mt-[9px] text-[12px] font-[650] leading-[15px] text-[#10243C] line-clamp-3">
                      Sobre o Aplicativo
                    </span>
                  </button>

                </div>
              </section>
            </>
          )}

          {/* ABA EVENTOS */}
          {activeTab === 'eventos' && (
            <div className="space-y-4 pt-4">
              <div className="bg-white/90 backdrop-blur-md p-5 rounded-2xl shadow-sm border border-white">
                <h2 className="text-lg font-bold text-[#092A50] flex items-center gap-2">
                  <Calendar size={20} className="text-[#1D64A4]" /> Eventos e AGOEs
                </h2>
                <p className="text-xs text-gray-600 mt-1">
                  Consulte os eventos oficiais da COMIEADEPA e suas inscrições vinculadas.
                </p>
                <div className="mt-4 pt-3 border-t border-gray-100 flex flex-col gap-2">
                  <button
                    onClick={() => router.push('/portal-ministro/eventos')}
                    className="w-full py-2.5 px-4 bg-[#092A50] hover:bg-[#123F72] text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 shadow-sm"
                  >
                    Acessar Módulo Completo de Eventos <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ABA COMUNICADOS */}
          {activeTab === 'comunicados' && (
            <div className="space-y-3 pt-4">
              <div className="bg-white/90 backdrop-blur-md p-4 rounded-2xl shadow-sm border border-white">
                <h2 className="text-base font-bold text-[#092A50] flex items-center gap-2 mb-3">
                  <MessageSquare size={18} className="text-[#1D64A4]" /> Comunicados Oficiais
                </h2>
                {notificacoes.length === 0 ? (
                  <div className="text-center py-8 text-gray-500 text-xs">
                    Nenhum comunicado no momento.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {notificacoes.map((n) => (
                      <div
                        key={n.id}
                        className={`p-3 rounded-xl border text-left text-xs transition ${
                          n.lida ? 'bg-gray-50/80 border-gray-100 text-gray-700' : 'bg-blue-50/80 border-blue-200 text-[#092A50] font-medium'
                        }`}
                      >
                        <div className="flex items-center justify-between font-bold text-xs">
                          <span>{n.titulo}</span>
                          <span className="text-[10px] text-gray-400 font-normal">
                            {new Date(n.createdAt).toLocaleDateString('pt-BR')}
                          </span>
                        </div>
                        <p className="text-[11px] text-gray-600 mt-1 leading-snug">
                          {n.mensagem}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ABA PERFIL / DADOS MINISTERIAIS */}
          {activeTab === 'perfil' && (
            <div className="space-y-3 pt-4">
              <div className="bg-white/95 backdrop-blur-md p-5 rounded-2xl shadow-sm border border-white space-y-4">
                <div className="flex items-center gap-3 pb-3 border-b border-gray-100">
                  <div className="w-14 h-14 rounded-full overflow-hidden bg-blue-900 text-white flex items-center justify-center font-bold text-xl flex-shrink-0">
                    {ministro?.fotoUrl ? (
                      <img src={ministro.fotoUrl} alt={ministro.nome} className="w-full h-full object-cover" />
                    ) : (
                      ministro?.nome?.charAt(0) || 'M'
                    )}
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-bold text-sm text-[#092A50] truncate">{ministro?.nome}</h3>
                    <p className="text-xs text-gray-500">{ministro?.cargo}</p>
                    <p className="text-[11px] text-amber-700 font-medium">Matrícula: {ministro?.matricula || '—'}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="bg-gray-50 p-2.5 rounded-xl border border-gray-100">
                    <span className="text-gray-400 text-[10px] block">CPF Mascarado</span>
                    <span className="font-semibold text-gray-800">{ministro?.cpfMascarado || '—'}</span>
                  </div>
                  <div className="bg-gray-50 p-2.5 rounded-xl border border-gray-100">
                    <span className="text-gray-400 text-[10px] block">Campo Ministerial</span>
                    <span className="font-semibold text-gray-800 truncate block">{ministro?.campo || '—'}</span>
                  </div>
                  <div className="bg-gray-50 p-2.5 rounded-xl border border-gray-100">
                    <span className="text-gray-400 text-[10px] block">Supervisão</span>
                    <span className="font-semibold text-gray-800 truncate block">{ministro?.supervisao || '—'}</span>
                  </div>
                  <div className="bg-gray-50 p-2.5 rounded-xl border border-gray-100">
                    <span className="text-gray-400 text-[10px] block">Status Convencional</span>
                    <span className="font-semibold text-green-700 flex items-center gap-1">
                      <CheckCircle2 size={12} /> {isAtivo ? 'Ativo' : 'Pendente'}
                    </span>
                  </div>
                </div>

                <div className="pt-2 flex flex-col gap-2">
                  <button
                    onClick={() => router.push('/portal-ministro/credencial')}
                    className="w-full py-2.5 px-3 bg-[#092A50] hover:bg-[#123F72] text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-2 shadow-sm"
                  >
                    <IdCard size={15} /> Ver Minha Credencial Digital
                  </button>
                  <button
                    onClick={() => router.push('/portal-ministro/historico')}
                    className="w-full py-2.5 px-3 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-xl text-xs font-semibold flex items-center justify-center gap-2"
                  >
                    <Clock size={15} /> Histórico Ministerial Completo
                  </button>
                </div>
              </div>
            </div>
          )}
        </main>

        {/* ── NAVEGAÇÃO INFERIOR FIXA (Altura 68px + safe area) ── */}
        <nav
          className="fixed bottom-0 left-0 right-0 z-30 flex justify-center pointer-events-none"
        >
          <div
            className="w-full max-w-[430px] md:max-w-[600px] pointer-events-auto rounded-t-[20px] shadow-[0_-4px_18px_rgba(7,33,68,0.2)] px-3 flex items-center justify-around"
            style={{
              background: 'linear-gradient(110deg, #092A50 0%, #123F72 100%)',
              height: 'calc(68px + env(safe-area-inset-bottom, 0px))',
              paddingBottom: 'env(safe-area-inset-bottom, 0px)',
            }}
          >
            {/* 1. Início */}
            <button
              onClick={() => setActiveTab('inicio')}
              className={`flex flex-col items-center justify-center flex-1 py-1 relative transition-colors ${
                activeTab === 'inicio' ? 'text-[#F4C45B]' : 'text-white/80 hover:text-white'
              }`}
            >
              <Home size={23} strokeWidth={activeTab === 'inicio' ? 2.5 : 2} />
              <span className="text-[11px] font-semibold mt-0.5 tracking-tight">Início</span>
              {activeTab === 'inicio' && (
                <span
                  className="absolute bottom-0 w-8 h-[3px] rounded-full"
                  style={{ backgroundColor: '#F4C45B' }}
                />
              )}
            </button>

            {/* 2. Eventos */}
            <button
              onClick={() => setActiveTab('eventos')}
              className={`flex flex-col items-center justify-center flex-1 py-1 relative transition-colors ${
                activeTab === 'eventos' ? 'text-[#F4C45B]' : 'text-white/80 hover:text-white'
              }`}
            >
              <Calendar size={23} strokeWidth={activeTab === 'eventos' ? 2.5 : 2} />
              <span className="text-[11px] font-semibold mt-0.5 tracking-tight">Eventos</span>
              {activeTab === 'eventos' && (
                <span
                  className="absolute bottom-0 w-8 h-[3px] rounded-full"
                  style={{ backgroundColor: '#F4C45B' }}
                />
              )}
            </button>

            {/* 3. Comunicados */}
            <button
              onClick={() => setActiveTab('comunicados')}
              className={`flex flex-col items-center justify-center flex-1 py-1 relative transition-colors ${
                activeTab === 'comunicados' ? 'text-[#F4C45B]' : 'text-white/80 hover:text-white'
              }`}
            >
              <div className="relative">
                <FileText size={23} strokeWidth={activeTab === 'comunicados' ? 2.5 : 2} />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 w-[7px] h-[7px] rounded-full bg-[#E74747]" />
                )}
              </div>
              <span className="text-[11px] font-semibold mt-0.5 tracking-tight">Comunicados</span>
              {activeTab === 'comunicados' && (
                <span
                  className="absolute bottom-0 w-8 h-[3px] rounded-full"
                  style={{ backgroundColor: '#F4C45B' }}
                />
              )}
            </button>

            {/* 4. Perfil */}
            <button
              onClick={() => setActiveTab('perfil')}
              className={`flex flex-col items-center justify-center flex-1 py-1 relative transition-colors ${
                activeTab === 'perfil' ? 'text-[#F4C45B]' : 'text-white/80 hover:text-white'
              }`}
            >
              <User size={23} strokeWidth={activeTab === 'perfil' ? 2.5 : 2} />
              <span className="text-[11px] font-semibold mt-0.5 tracking-tight">Perfil</span>
              {activeTab === 'perfil' && (
                <span
                  className="absolute bottom-0 w-8 h-[3px] rounded-full"
                  style={{ backgroundColor: '#F4C45B' }}
                />
              )}
            </button>
          </div>
        </nav>

        {/* ── GAVETA LATERAL (MENU HAMBÚRGUER) ── */}
        {menuOpen && (
          <div className="fixed inset-0 z-50 flex justify-center bg-black/60 backdrop-blur-sm animate-fade-in">
            <div className="w-full max-w-[430px] md:max-w-[600px] h-full flex flex-col justify-between bg-[#092A50] text-white p-6 shadow-2xl">
              <div>
                <div className="flex items-center justify-between pb-6 border-b border-white/10">
                  <div className="flex items-center gap-3">
                    <Image
                      src="/img/logo_comieadepa.png"
                      alt="COMIEADEPA"
                      width={38}
                      height={38}
                      className="object-contain"
                    />
                    <div>
                      <p className="font-extrabold text-sm leading-tight">COMIEADEPA</p>
                      <p className="text-blue-300 text-[10px] tracking-wider uppercase">Aplicativo do Ministro</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setMenuOpen(false)}
                    className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition"
                  >
                    <X size={20} />
                  </button>
                </div>

                <div className="py-4 space-y-1">
                  <button
                    onClick={() => { setMenuOpen(false); setActiveTab('inicio'); }}
                    className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-white/10 text-xs font-semibold text-left transition"
                  >
                    <Home size={18} className="text-amber-400" /> Início do Aplicativo
                  </button>
                  <button
                    onClick={() => { setMenuOpen(false); router.push('/portal-ministro/credencial'); }}
                    className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-white/10 text-xs font-semibold text-left transition"
                  >
                    <IdCard size={18} className="text-blue-300" /> Minha Credencial
                  </button>
                  <button
                    onClick={() => { setMenuOpen(false); router.push('/portal-ministro/eventos'); }}
                    className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-white/10 text-xs font-semibold text-left transition"
                  >
                    <Calendar size={18} className="text-blue-300" /> Meus Eventos e Inscrições
                  </button>
                  <button
                    onClick={() => { setMenuOpen(false); router.push('/portal-ministro/certificados'); }}
                    className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-white/10 text-xs font-semibold text-left transition"
                  >
                    <Award size={18} className="text-blue-300" /> Certificados
                  </button>
                  <button
                    onClick={() => { setMenuOpen(false); router.push('/portal-ministro/historico'); }}
                    className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-white/10 text-xs font-semibold text-left transition"
                  >
                    <Clock size={18} className="text-blue-300" /> Histórico Ministerial
                  </button>
                  <button
                    onClick={() => { setMenuOpen(false); router.push('/portal-ministro/dashboard'); }}
                    className="w-full flex items-center gap-3 px-3 py-3 rounded-xl bg-white/5 hover:bg-white/15 text-xs font-semibold text-left transition text-blue-200 mt-2"
                  >
                    <ExternalLink size={18} className="text-blue-400" /> Acessar Portal Web Clássico
                  </button>
                </div>
              </div>

              <div className="pt-4 border-t border-white/10">
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-red-600/20 hover:bg-red-600/30 text-red-300 text-xs font-bold transition"
                >
                  <LogOut size={16} /> Encerrar Sessão
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── MODAL DE NOTIFICAÇÕES / COMUNICADOS ── */}
        {notifOpen && (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm animate-fade-in">
            <div className="w-full max-w-[430px] md:max-w-[600px] max-h-[85vh] bg-white rounded-t-[24px] p-5 flex flex-col shadow-2xl">
              <div className="flex items-center justify-between pb-3 border-b border-gray-100">
                <div className="flex items-center gap-2">
                  <Bell size={18} className="text-[#092A50]" />
                  <h3 className="font-bold text-sm text-[#092A50]">Notificações e Avisos</h3>
                </div>
                <button
                  onClick={() => setNotifOpen(false)}
                  className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto py-3 space-y-2">
                {loadingNotifs ? (
                  <div className="py-8 text-center text-xs text-gray-400">Carregando...</div>
                ) : notificacoes.length === 0 ? (
                  <div className="py-10 text-center text-xs text-gray-500">
                    Você não possui avisos pendentes.
                  </div>
                ) : (
                  notificacoes.map((item) => (
                    <div
                      key={item.id}
                      className={`p-3 rounded-xl border text-left text-xs ${
                        item.lida ? 'bg-gray-50 border-gray-100' : 'bg-blue-50/70 border-blue-200'
                      }`}
                    >
                      <div className="flex justify-between items-center font-bold text-gray-900">
                        <span>{item.titulo}</span>
                        <span className="text-[10px] text-gray-400 font-normal">
                          {new Date(item.createdAt).toLocaleDateString('pt-BR')}
                        </span>
                      </div>
                      <p className="text-[11px] text-gray-600 mt-1 leading-snug">{item.mensagem}</p>
                    </div>
                  ))
                )}
              </div>

              <button
                onClick={() => setNotifOpen(false)}
                className="w-full py-2.5 bg-[#092A50] text-white rounded-xl text-xs font-bold mt-2"
              >
                Fechar
              </button>
            </div>
          </div>
        )}

        {/* ── MODAL INFORMATIVO (ESTADOS / DETALHES) ── */}
        {infoModal.open && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
            <div className="w-full max-w-sm bg-white rounded-2xl p-6 shadow-2xl text-center space-y-4">
              <div
                className="w-12 h-12 rounded-full mx-auto flex items-center justify-center text-white shadow-md"
                style={{ backgroundColor: infoModal.accentColor || '#092A50' }}
              >
                <ShieldCheck size={26} />
              </div>

              <h3 className="text-base font-bold text-[#092A50] leading-tight">
                {infoModal.title}
              </h3>

              <p className="text-xs text-gray-600 whitespace-pre-line leading-relaxed">
                {infoModal.description}
              </p>

              <div className="pt-2 flex flex-col gap-2">
                {infoModal.actionUrl && infoModal.actionLabel && (
                  <button
                    onClick={() => {
                      if (infoModal.actionUrl?.startsWith('http')) {
                        window.open(infoModal.actionUrl, '_blank');
                      } else {
                        router.push(infoModal.actionUrl!);
                      }
                      setInfoModal({ open: false, title: '', description: '' });
                    }}
                    className="w-full py-2.5 px-4 rounded-xl text-white text-xs font-bold shadow-sm transition"
                    style={{ backgroundColor: infoModal.accentColor || '#092A50' }}
                  >
                    {infoModal.actionLabel}
                  </button>
                )}
                <button
                  onClick={() => setInfoModal({ open: false, title: '', description: '' })}
                  className="w-full py-2.5 px-4 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-semibold transition"
                >
                  Entendi
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
