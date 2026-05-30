'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import {
  LayoutDashboard,
  IdCard,
  History,
  DollarSign,
  Printer,
  LogOut,
  Menu,
  X,
  ChevronRight,
} from 'lucide-react';
import { MinistroContext, type MinistroData } from './ministro-context';

const NAV_ITEMS = [
  { href: '/portal-ministro/dashboard', label: 'Início', icon: LayoutDashboard },
  { href: '/portal-ministro/credencial', label: 'Minha Credencial', icon: IdCard },
  { href: '/portal-ministro/historico', label: 'Histórico', icon: History },
  { href: '/portal-ministro/impressao', label: 'Solicitar Impressão', icon: Printer },
];

const NAV_PASTOR = {
  href: '/portal-ministro/contribuicoes',
  label: 'Contribuição Estatutária',
  icon: DollarSign,
};

export default function PortalMinistroLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname() || '';
  const [ministro, setMinistro] = useState<MinistroData | null>(null);
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    const isLogin = pathname.startsWith('/portal-ministro/login');
    if (isLogin) { setLoading(false); return; }

    fetch('/api/portal-ministro/auth/me')
      .then(async (res) => {
        if (!res.ok) {
          router.replace('/portal-ministro/login');
          return;
        }
        const data = await res.json();
        setMinistro(data);
        setLoading(false);
      })
      .catch(() => {
        router.replace('/portal-ministro/login');
      });
  }, [pathname, router]);

  const handleLogout = async () => {
    await fetch('/api/portal-ministro/auth/logout', { method: 'POST' });
    router.push('/portal-ministro/login');
  };

  const isLogin = pathname.startsWith('/portal-ministro/login');
  if (isLogin) return <>{children}</>;
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#0D2B4E] to-[#1a4a7a]">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-white/20 border-t-white rounded-full animate-spin mx-auto mb-4" />
          <p className="text-white/60 text-sm font-medium">Carregando portal...</p>
        </div>
      </div>
    );
  }
  if (!ministro) return null;

  const navItems = ministro.isPastorPresidente
    ? [...NAV_ITEMS, NAV_PASTOR]
    : NAV_ITEMS;

  const renderNavLinks = (onClose?: () => void) => (
    <nav className="flex flex-col gap-1">
      {navItems.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(href + '/');
        return (
          <Link
            key={href}
            href={href}
            onClick={onClose}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-150 ${
              active
                ? 'bg-white text-[#0D2B4E] shadow-md shadow-black/10'
                : 'text-blue-100 hover:bg-white/10 hover:text-white'
            }`}
          >
            <Icon size={18} />
            <span className="flex-1">{label}</span>
            {active && <ChevronRight size={14} className="opacity-40" />}
          </Link>
        );
      })}
    </nav>
  );

  const renderSidebar = (onClose?: () => void) => (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-white/10 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Image
            src="/img/logo_comieadepa.png"
            alt="COMIEADEPA"
            width={38}
            height={38}
            className="rounded-lg"
            style={{ width: '38px', height: 'auto' }}
          />
          <div>
            <p className="text-white font-bold text-sm leading-tight tracking-tight">COMIEADEPA</p>
            <p className="text-blue-300 text-[10px] uppercase tracking-widest">Portal do Ministro</p>
          </div>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-white/10 text-white/50 hover:text-white transition-colors"
          >
            <X size={18} />
          </button>
        )}
      </div>

      {/* Cartão do ministro */}
      <div className="px-4 py-3 border-b border-white/10">
        <div className="flex items-center gap-3 bg-white/10 rounded-xl px-3 py-3">
          {ministro.fotoUrl ? (
            <img
              src={ministro.fotoUrl}
              alt={ministro.nome}
              className="w-11 h-11 rounded-full object-cover ring-2 ring-white/30 flex-shrink-0"
            />
          ) : (
            <div className="w-11 h-11 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white font-bold text-lg flex-shrink-0">
              {ministro.nome?.charAt(0) ?? '?'}
            </div>
          )}
          <div className="min-w-0">
            <p className="text-white font-semibold text-sm truncate leading-tight">{ministro.nome}</p>
            <p className="text-blue-200 text-xs truncate mt-0.5">{ministro.cargo || 'Ministro'}</p>
          </div>
        </div>
      </div>

      {/* Navegação */}
      <div className="flex-1 px-3 py-4 overflow-y-auto">
        {renderNavLinks(onClose)}
      </div>

      {/* Sair */}
      <div className="px-3 pb-5 pt-3 border-t border-white/10">
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-red-300 hover:bg-red-500/20 hover:text-red-200 transition-all w-full group"
        >
          <LogOut size={18} className="group-hover:translate-x-0.5 transition-transform" />
          Sair do Portal
        </button>
      </div>
    </div>
  );

  return (
    <MinistroContext.Provider value={{ ministro, loading: false }}>
      <div className="min-h-screen bg-gray-50">
        {/* Sidebar desktop — fixed */}
        <aside className="hidden md:block fixed inset-y-0 left-0 w-64 bg-[#0D2B4E] z-30 overflow-y-auto">
          {renderSidebar()}
        </aside>

        {/* Backdrop mobile */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 md:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Drawer mobile */}
        <aside
          className="fixed top-0 left-0 h-full w-72 bg-[#0D2B4E] z-50 md:hidden transition-transform duration-300 ease-in-out"
          style={{ transform: sidebarOpen ? 'translateX(0)' : 'translateX(-100%)' }}
        >
          {renderSidebar(() => setSidebarOpen(false))}
        </aside>

        {/* Área de conteúdo */}
        <div className="md:ml-64 flex flex-col min-h-screen">
          {/* Topbar mobile */}
          <header className="md:hidden bg-[#0D2B4E] px-4 py-3.5 flex items-center justify-between sticky top-0 z-20 shadow-lg">
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-2 rounded-xl hover:bg-white/10 transition-colors text-white"
              aria-label="Abrir menu"
            >
              <Menu size={22} />
            </button>
            <div className="flex items-center gap-2.5">
              <Image
                src="/img/logo_comieadepa.png"
                alt="COMIEADEPA"
                width={26}
                height={26}
                style={{ width: '26px', height: 'auto' }}
              />
              <span className="text-white font-bold text-sm tracking-tight">Portal do Ministro</span>
            </div>
            <div className="w-10" />
          </header>

          {/* Conteúdo da página */}
          <main className="flex-1 p-4 md:p-8">
            {children}
          </main>
        </div>
      </div>
    </MinistroContext.Provider>
  );
}
