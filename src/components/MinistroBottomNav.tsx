'use client';

import { usePathname, useRouter } from 'next/navigation';
import {
  Home,
  IdCard,
  Calendar,
  Award,
  History,
  Menu,
} from 'lucide-react';

interface MinistroBottomNavProps {
  isPastorPresidente?: boolean;
  onOpenMenu?: () => void;
  // Suporte opcional a abas internas (como na página /app)
  activeTab?: 'inicio' | 'eventos' | 'comunicados' | 'perfil';
  onTabChange?: (tab: 'inicio' | 'eventos' | 'comunicados' | 'perfil') => void;
  unreadCount?: number;
}

export default function MinistroBottomNav({
  isPastorPresidente: _isPastorPresidente = false,
  onOpenMenu,
  activeTab,
  onTabChange,
  unreadCount = 0,
}: MinistroBottomNavProps) {
  const pathname = usePathname() || '';
  const router = useRouter();

  const isAppRoot = pathname === '/app';

  // Navegação mobile unificada:
  // 1. Início (/app ou tab 'inicio')
  // 2. Credencial (/portal-ministro/credencial)
  // 3. Eventos (/portal-ministro/eventos ou tab 'eventos' em /app)
  // 4. Certificados (/portal-ministro/certificados)
  // 5. Histórico (/portal-ministro/historico)
  // 6. Comunicados (/app tab 'comunicados')
  // 7. Mais / Menu (gaveta com Contribuição, Perfil, etc)

  const items = [
    {
      key: 'inicio',
      label: 'Início',
      icon: Home,
      href: '/app',
      isActive: isAppRoot ? activeTab === 'inicio' : (pathname === '/app' || pathname === '/portal-ministro/dashboard'),
      onClick: () => {
        if (isAppRoot && onTabChange) {
          onTabChange('inicio');
        } else {
          router.push('/app');
        }
      },
    },
    {
      key: 'credencial',
      label: 'Credencial',
      icon: IdCard,
      href: '/portal-ministro/credencial',
      isActive: pathname.startsWith('/portal-ministro/credencial'),
      onClick: () => router.push('/portal-ministro/credencial'),
    },
    {
      key: 'eventos',
      label: 'Eventos',
      icon: Calendar,
      href: '/portal-ministro/eventos',
      isActive: pathname.startsWith('/portal-ministro/eventos') || (isAppRoot && activeTab === 'eventos'),
      onClick: () => {
        if (isAppRoot && onTabChange) {
          onTabChange('eventos');
        } else {
          router.push('/portal-ministro/eventos');
        }
      },
    },
    {
      key: 'certificados',
      label: 'Certificados',
      icon: Award,
      href: '/portal-ministro/certificados',
      isActive: pathname.startsWith('/portal-ministro/certificados'),
      onClick: () => router.push('/portal-ministro/certificados'),
    },
    {
      key: 'historico',
      label: 'Histórico',
      icon: History,
      href: '/portal-ministro/historico',
      isActive: pathname.startsWith('/portal-ministro/historico'),
      onClick: () => router.push('/portal-ministro/historico'),
    },
  ];

  return (
    <nav
      aria-label="Navegação inferior mobile"
      className="md:hidden fixed bottom-0 left-0 right-0 z-40 flex justify-center pointer-events-none select-none"
    >
      <div
        className="w-full max-w-md pointer-events-auto rounded-t-2xl shadow-[0_-4px_22px_rgba(7,33,68,0.28)] px-1.5 flex items-center justify-around border-t border-white/10"
        style={{
          background: 'linear-gradient(110deg, #092A50 0%, #103866 100%)',
          height: 'calc(62px + env(safe-area-inset-bottom, 0px))',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }}
      >
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.key}
              onClick={item.onClick}
              className={`flex flex-col items-center justify-center flex-1 py-1 relative transition-all duration-150 active:scale-95 ${
                item.isActive ? 'text-[#F4C45B]' : 'text-white/75 hover:text-white'
              }`}
            >
              <div className="relative">
                <Icon size={20} strokeWidth={item.isActive ? 2.5 : 2} />
              </div>
              <span className="text-[10px] font-semibold mt-0.5 tracking-tight truncate max-w-[58px]">
                {item.label}
              </span>
              {item.isActive && (
                <span
                  className="absolute bottom-0 w-6 h-[2.5px] rounded-full"
                  style={{ backgroundColor: '#F4C45B' }}
                />
              )}
            </button>
          );
        })}

        {/* Botão de Menu para mais opções (Contribuições, Perfil, PVC, Sair) */}
        {onOpenMenu && (
          <button
            onClick={onOpenMenu}
            className="flex flex-col items-center justify-center flex-1 py-1 relative text-white/75 hover:text-white transition-all duration-150 active:scale-95"
            aria-label="Mais opções"
          >
            <div className="relative">
              <Menu size={20} strokeWidth={2} />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1.5 w-2 h-2 rounded-full bg-red-500 ring-2 ring-[#092A50]" />
              )}
            </div>
            <span className="text-[10px] font-semibold mt-0.5 tracking-tight">
              Mais
            </span>
          </button>
        )}
      </div>
    </nav>
  );
}
