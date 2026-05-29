'use client';

import { useEffect, useState, createContext, useContext } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
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

export interface MinistroData {
  id: string;
  nome: string;
  matricula: string | null;
  cpfMascarado: string;
  cargo: string;
  status: string;
  supervisao: string;
  campo: string;
  fotoUrl: string | null;
  isPastorPresidente: boolean;
  uniqueId: string | null;
  dataValidadeCredencial: string | null;
}

interface MinistroContextType {
  ministro: MinistroData | null;
  loading: boolean;
}

export const MinistroContext = createContext<MinistroContextType>({ ministro: null, loading: true });
export const useMinistro = () => useContext(MinistroContext);

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
        if (res.status === 401) {
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
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-gray-500">Carregando...</div>
      </div>
    );
  }
  if (!ministro) return null;

  const navItems = ministro.isPastorPresidente
    ? [...NAV_ITEMS, NAV_PASTOR]
    : NAV_ITEMS;

  const NavLinks = ({ onClose }: { onClose?: () => void }) => (
    <nav className="flex flex-col gap-1 mt-2">
      {navItems.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(href + '/');
        return (
          <Link
            key={href}
            href={href}
            onClick={onClose}
            className={`flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              active
                ? 'bg-white/20 text-white'
                : 'text-blue-100 hover:bg-white/10 hover:text-white'
            }`}
          >
            <Icon size={18} />
            {label}
            {active && <ChevronRight size={14} className="ml-auto" />}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <MinistroContext.Provider value={{ ministro, loading: false }}>
      <div className="min-h-screen flex bg-gray-50">
        {/* Sidebar desktop */}
        <aside className="hidden md:flex flex-col w-64 bg-[#0D2B4E] text-white min-h-screen">
          <div className="px-6 py-5 border-b border-white/10">
            <p className="text-xs text-blue-300 uppercase tracking-wider font-semibold">Portal do Ministro</p>
            <p className="text-white font-semibold text-sm mt-1 truncate">{ministro.nome}</p>
            {ministro.cargo && <p className="text-blue-200 text-xs truncate">{ministro.cargo}</p>}
          </div>
          <div className="flex-1 px-3 py-4">
            <NavLinks />
          </div>
          <div className="px-3 pb-6">
            <button
              onClick={handleLogout}
              className="flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium text-blue-100 hover:bg-white/10 hover:text-white transition-colors w-full"
            >
              <LogOut size={18} />
              Sair
            </button>
          </div>
        </aside>

        {/* Mobile overlay */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 bg-black/50 z-40 md:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Sidebar mobile */}
        <aside
          className={`fixed top-0 left-0 h-full w-64 bg-[#0D2B4E] text-white z-50 transform transition-transform duration-300 md:hidden ${
            sidebarOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <div className="px-6 py-5 border-b border-white/10 flex items-center justify-between">
            <div>
              <p className="text-xs text-blue-300 uppercase tracking-wider font-semibold">Portal do Ministro</p>
              <p className="text-white font-semibold text-sm mt-1 truncate">{ministro.nome}</p>
            </div>
            <button onClick={() => setSidebarOpen(false)} className="text-white/70 hover:text-white">
              <X size={20} />
            </button>
          </div>
          <div className="flex-1 px-3 py-4">
            <NavLinks onClose={() => setSidebarOpen(false)} />
          </div>
          <div className="px-3 pb-6">
            <button
              onClick={handleLogout}
              className="flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium text-blue-100 hover:bg-white/10 transition-colors w-full"
            >
              <LogOut size={18} />
              Sair
            </button>
          </div>
        </aside>

        {/* Main */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Mobile topbar */}
          <header className="md:hidden bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 sticky top-0 z-30">
            <button onClick={() => setSidebarOpen(true)} className="text-gray-600">
              <Menu size={22} />
            </button>
            <span className="font-semibold text-[#0D2B4E] text-sm">Portal do Ministro</span>
          </header>
          <main className="flex-1 p-4 md:p-6">{children}</main>
        </div>
      </div>
    </MinistroContext.Provider>
  );
}
