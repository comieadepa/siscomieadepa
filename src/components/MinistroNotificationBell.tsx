'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Bell,
  X,
  CheckCircle2,
  IdCard,
  Calendar,
  CreditCard,
  MessageSquare,
  ChevronRight,
  CheckCheck,
} from 'lucide-react';

export interface NotificacaoItem {
  id: string;
  tipo: 'credencial' | 'financeiro' | 'evento' | 'comunicado';
  titulo: string;
  mensagem: string;
  linkAcao: string | null;
  lida: boolean;
  lidaEm: string | null;
  canal: string;
  createdAt: string;
}

const fmtDateShort = (isoString: string) => {
  if (!isoString) return '';
  const d = new Date(isoString);
  const hoje = new Date();
  const isHoje = d.toDateString() === hoje.toDateString();

  if (isHoje) {
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  return d.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export default function MinistroNotificationBell({ isDark = false }: { isDark?: boolean }) {
  const router = useRouter();
  const [notificacoes, setNotificacoes] = useState<NotificacaoItem[]>([]);
  const [totalNaoLidas, setTotalNaoLidas] = useState(0);
  const [showPanel, setShowPanel] = useState(false);
  const [loading, setLoading] = useState(false);
  const [marcandoTodas, setMarcandoTodas] = useState(false);

  const panelRef = useRef<HTMLDivElement | null>(null);

  // Busca notificações
  const carregarNotificacoes = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/portal-ministro/notificacoes?limit=25');
      if (!res.ok) return;
      const data = await res.json();
      setNotificacoes(data.notificacoes || []);
      setTotalNaoLidas(data.totalNaoLidas || 0);
    } catch (err) {
      console.error('[MinistroNotificationBell] Erro ao buscar notificações:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    carregarNotificacoes();

    // Polling a cada 30 segundos
    const interval = setInterval(carregarNotificacoes, 30000);
    return () => clearInterval(interval);
  }, [carregarNotificacoes]);

  // Fecha o painel ao clicar fora
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setShowPanel(false);
      }
    };
    if (showPanel) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showPanel]);

  // Marcar uma notificação como lida e navegar
  const handleItemClick = async (item: NotificacaoItem) => {
    if (!item.lida) {
      // Atualização otimista
      setNotificacoes((prev) =>
        prev.map((n) => (n.id === item.id ? { ...n, lida: true, lidaEm: new Date().toISOString() } : n)),
      );
      setTotalNaoLidas((prev) => Math.max(0, prev - 1));

      try {
        await fetch(`/api/portal-ministro/notificacoes/${item.id}/ler`, {
          method: 'PATCH',
        });
      } catch (err) {
        console.error('[MinistroNotificationBell] Erro ao marcar como lida:', err);
      }
    }

    if (item.linkAcao) {
      setShowPanel(false);
      router.push(item.linkAcao);
    }
  };

  // Marcar todas como lidas
  const handleMarcarTodasComoLidas = async () => {
    if (totalNaoLidas === 0 || marcandoTodas) return;
    setMarcandoTodas(true);

    // Atualização otimista
    setNotificacoes((prev) =>
      prev.map((n) => ({ ...n, lida: true, lidaEm: new Date().toISOString() })),
    );
    setTotalNaoLidas(0);

    try {
      await fetch('/api/portal-ministro/notificacoes/ler-todas', {
        method: 'PATCH',
      });
    } catch (err) {
      console.error('[MinistroNotificationBell] Erro ao marcar todas como lidas:', err);
    } finally {
      setMarcandoTodas(false);
    }
  };

  const getTipoVisual = (tipo: string) => {
    switch (tipo) {
      case 'credencial':
        return {
          icon: <IdCard size={16} className="text-blue-700" />,
          bg: 'bg-blue-100 border-blue-200',
          badge: 'Credencial',
        };
      case 'financeiro':
        return {
          icon: <CreditCard size={16} className="text-amber-700" />,
          bg: 'bg-amber-100 border-amber-200',
          badge: 'Financeiro',
        };
      case 'evento':
        return {
          icon: <Calendar size={16} className="text-purple-700" />,
          bg: 'bg-purple-100 border-purple-200',
          badge: 'Evento / AGO',
        };
      case 'comunicado':
      default:
        return {
          icon: <MessageSquare size={16} className="text-emerald-700" />,
          bg: 'bg-emerald-100 border-emerald-200',
          badge: 'Comunicado',
        };
    }
  };

  return (
    <div className="relative" ref={panelRef}>
      {/* Botão do Sino */}
      <button
        onClick={() => {
          setShowPanel(!showPanel);
          if (!showPanel) carregarNotificacoes();
        }}
        className={`relative p-2 rounded-xl transition-all ${
          isDark
            ? 'text-white/80 hover:text-white hover:bg-white/10'
            : 'text-gray-600 hover:text-[#0D2B4E] hover:bg-gray-100'
        }`}
        aria-label="Notificações"
      >
        <Bell size={20} />
        {totalNaoLidas > 0 && (
          <span className="absolute top-1 right-1 flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-black text-white bg-red-600 rounded-full ring-2 ring-white animate-pulse">
            {totalNaoLidas > 99 ? '99+' : totalNaoLidas}
          </span>
        )}
      </button>

      {/* Painel Popover de Notificações */}
      {showPanel && (
        <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white rounded-2xl shadow-2xl z-50 border border-gray-200 overflow-hidden animate-fadeIn">
          {/* Cabeçalho */}
          <div className="px-4 py-3 bg-gradient-to-r from-[#0D2B4E] to-[#1a4a7a] text-white flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bell size={16} className="text-blue-200" />
              <span className="font-bold text-sm">Notificações</span>
              {totalNaoLidas > 0 && (
                <span className="bg-red-500 text-white text-[10px] font-black px-2 py-0.5 rounded-full">
                  {totalNaoLidas} nova{totalNaoLidas > 1 ? 's' : ''}
                </span>
              )}
            </div>

            <div className="flex items-center gap-1">
              {totalNaoLidas > 0 && (
                <button
                  onClick={handleMarcarTodasComoLidas}
                  disabled={marcandoTodas}
                  title="Marcar todas como lidas"
                  className="text-xs text-blue-200 hover:text-white hover:underline flex items-center gap-1 px-2 py-1 rounded transition-colors disabled:opacity-50"
                >
                  <CheckCheck size={14} />
                  <span className="hidden sm:inline">Ler todas</span>
                </button>
              )}
              <button
                onClick={() => setShowPanel(false)}
                className="p-1 rounded-lg hover:bg-white/10 text-white/70 hover:text-white transition-colors"
                aria-label="Fechar"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {/* Lista de Notificações */}
          <div className="max-h-[380px] overflow-y-auto divide-y divide-gray-100">
            {loading && notificacoes.length === 0 ? (
              <div className="py-10 px-4 text-center">
                <div className="w-6 h-6 border-2 border-[#0D2B4E]/30 border-t-[#0D2B4E] rounded-full animate-spin mx-auto mb-2" />
                <p className="text-xs text-gray-500">Carregando notificações...</p>
              </div>
            ) : notificacoes.length === 0 ? (
              <div className="py-10 px-4 text-center">
                <CheckCircle2 size={36} className="mx-auto mb-2 text-gray-300" />
                <p className="text-sm font-semibold text-gray-600">Nenhuma notificação</p>
                <p className="text-xs text-gray-400 mt-0.5">Você está em dia com todos os comunicados!</p>
              </div>
            ) : (
              notificacoes.map((item) => {
                const visual = getTipoVisual(item.tipo);
                return (
                  <div
                    key={item.id}
                    onClick={() => handleItemClick(item)}
                    className={`p-3.5 transition-colors cursor-pointer hover:bg-gray-50 flex items-start gap-3 ${
                      !item.lida ? 'bg-blue-50/50' : 'bg-white opacity-85'
                    }`}
                  >
                    {/* Ícone contextual */}
                    <div
                      className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 border ${visual.bg}`}
                    >
                      {visual.icon}
                    </div>

                    {/* Conteúdo */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1 mb-0.5">
                        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                          {visual.badge}
                        </span>
                        <span className="text-[10px] text-gray-400 font-medium">
                          {fmtDateShort(item.createdAt)}
                        </span>
                      </div>

                      <p
                        className={`text-xs font-bold leading-snug truncate ${
                          !item.lida ? 'text-[#0D2B4E]' : 'text-gray-700'
                        }`}
                      >
                        {item.titulo}
                      </p>

                      <p className="text-[11px] text-gray-500 line-clamp-2 mt-0.5 leading-relaxed">
                        {item.mensagem}
                      </p>

                      {item.linkAcao && (
                        <div className="flex items-center gap-1 text-[11px] font-bold text-[#0D2B4E] mt-1.5 hover:underline">
                          <span>Acessar</span>
                          <ChevronRight size={12} />
                        </div>
                      )}
                    </div>

                    {/* Marcador de não lida */}
                    {!item.lida && (
                      <div className="w-2 h-2 rounded-full bg-blue-600 mt-2 flex-shrink-0" />
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Rodapé */}
          <div className="px-4 py-2.5 bg-gray-50 border-t border-gray-100 text-center">
            <p className="text-[10px] text-gray-400 font-medium">
              COMIEADEPA · Notificações Oficiais
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
