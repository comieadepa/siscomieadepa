'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase-client';
import { normalizeRole } from '@/lib/auth/roles';

interface SidebarProps {
  activeMenu: string;
  setActiveMenu: (id: string) => void;
}

// Quais menus de topo (por id) cada nível pode ver. 'super' vê tudo.
const MENU_POR_NIVEL: Record<string, string[]> = {
  super: ['*'],
  administrador: ['dashboard', 'secretaria', 'cgadb', 'comissao', 'patrimonio', 'missoes', 'configuracoes', 'eventos'],
  cgadb: ['cgadb'],
  comissao: ['dashboard', 'secretaria', 'comissao'],
  inscricao: ['eventos'],
  financeiro: ['financeiro'],
};

// Submenus que exigem nível ALÉM da visibilidade do menu pai.
// Se o id do submenu não estiver aqui, ele herda a visibilidade do pai.
const SUBMENU_RESTRICAO: Record<string, string[]> = {
  funcionarios: ['super', 'administrador'],
};

function menuVisivel(nivel: string | null, menuId: string): boolean {
  if (!nivel) return true; // enquanto carrega, mostra tudo
  const permitidos = MENU_POR_NIVEL[nivel];
  if (!permitidos) return true; // nivel desconhecido → mostra tudo
  if (permitidos.includes('*')) return true;
  return permitidos.includes(menuId);
}

function submenuVisivel(nivel: string | null, submenuId: string): boolean {
  if (!nivel) return true;
  if (nivel === 'super') return true;
  const restricao = SUBMENU_RESTRICAO[submenuId];
  if (!restricao) return true; // sem restrição extra: herda visibilidade do pai
  return restricao.includes(nivel);
}

export default function Sidebar({ activeMenu, setActiveMenu }: SidebarProps) {
  const router = useRouter();
  const supabase = createClient();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [nivelUsuario, setNivelUsuario] = useState<string | null>(null);
  const [expandedMenu, setExpandedMenu] = useState<string | null>(null);

  useEffect(() => {
    const fetchSession = async () => {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token || '';
      const rawNivel = (data.session?.user?.user_metadata?.nivel || data.session?.user?.user_metadata?.role) as string | undefined;
      let normalized = normalizeRole(rawNivel);

      if (!normalized && token) {
        const res = await fetch('/api/auth/me', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const json = (await res.json()) as { nivel?: string | null };
          normalized = normalizeRole(json.nivel || undefined);
        }
      }

      setNivelUsuario(normalized ?? null);
    };
    fetchSession();
  }, [supabase]);

  // Abre automaticamente o menu pai quando um submenu está ativo
  useEffect(() => {
    const menusComSubmenu: Record<string, string[]> = {
      secretaria: ['estrutura-hierarquica', 'membros', 'funcionarios', 'consagracao', 'cartas', 'certificados', 'permutas'],
      eventos: ['eventos-lista', 'eventos-dashboard'],
      configuracoes: ['config-geral', 'importar-membros', 'config-certificados', 'config-cartoes'],
    };
    for (const [parent, children] of Object.entries(menusComSubmenu)) {
      if (children.includes(activeMenu)) {
        setExpandedMenu(parent);
        return;
      }
    }
  }, [activeMenu]);

  const allMenuItems = [
    { id: 'dashboard', label: 'Dashboard', icon: '📊', path: '/dashboard' },
    {
      id: 'secretaria',
      label: 'Secretaria',
      icon: '📝',
      path: '/secretaria',
      submenu: [
        { id: 'estrutura-hierarquica', label: 'Supervisões e Campos', icon: '🗂️', path: '/secretaria/estrutura-hierarquica' },
        { id: 'membros', label: 'Ministros', icon: '👥', path: '/secretaria/membros' },
        { id: 'funcionarios', label: 'Funcionários', icon: '👔', path: '/secretaria/funcionarios' },
        { id: 'consagracao', label: 'Consagração (obreiros)', icon: '🙏', path: '/secretaria/consagracao' },
        { id: 'cartas', label: 'Cartas ministeriais', icon: '📜', path: '/secretaria/cartas' },
        { id: 'certificados', label: 'Certificados', icon: '🎓', path: '/secretaria/certificados' },
        { id: 'permutas', label: 'Permutas', icon: '🔄', path: '/secretaria/permutas' },
      ]
    },
    { id: 'cgadb', label: 'Débitos CGADB', icon: '🔴', path: '/secretaria/cgadb' },
    { id: 'financeiro', label: 'Financeiro', icon: '💳', path: '/financeiro' },
    {
      id: 'eventos',
      label: 'Eventos',
      icon: '📅',
      path: '/eventos',
      submenu: [
        { id: 'eventos-dashboard', label: 'Dashboard Geral',   icon: '📊', path: '/eventos/dashboard' },
        { id: 'eventos-lista',     label: 'Todos os Eventos',  icon: '📋', path: '/eventos' },
      ],
    },
    { id: 'comissao', label: 'Comissão', icon: '👥', path: '/comissao' },
    { id: 'patrimonio', label: 'Patrimônio', icon: '🏢', path: '/patrimonio' },
    { id: 'missoes', label: 'Missões', icon: '✈️', path: '/missoes' },
    { id: 'auditoria', label: 'Auditoria', icon: '✅', path: '/auditoria' },
    { id: 'usuarios', label: 'Usuários', icon: '👤', path: '/usuarios' },
    {
      id: 'configuracoes',
      label: 'Configurações',
      icon: '⚙️',
      path: '/configuracoes',
      submenu: [
        { id: 'config-geral', label: 'Geral', icon: '⚙️', path: '/configuracoes' },
        { id: 'importar-membros', label: 'Importar Ministros', icon: '📥', path: '/secretaria/membros/importar' },
        { id: 'config-certificados', label: 'Certificados', icon: '🎓', path: '/configuracoes/certificados' },
        { id: 'config-cartoes', label: 'Cartões', icon: '🎫', path: '/configuracoes/cartoes' },
      ]
    },
  ];

  // Filtra menus de topo por nível; submenus herdam o pai e aplicam apenas restrições extras
  const menuItems = allMenuItems
    .filter(i => menuVisivel(nivelUsuario, i.id))
    .map(i => {
      if ((i as { submenu?: { id: string }[] }).submenu) {
        return {
          ...i,
          submenu: (i as { submenu: { id: string }[] }).submenu.filter(s => submenuVisivel(nivelUsuario, s.id)),
        };
      }
      return i;
    });

  const handleNavigate = (id: string, path: string) => {
    let targetPath = path;
    if (id === 'eventos') {
      const isAdmin = nivelUsuario === 'administrador' || nivelUsuario === 'super';
      targetPath = isAdmin ? '/eventos/dashboard' : '/eventos';
    }
    setActiveMenu(id);
    router.push(targetPath);
    setIsMobileMenuOpen(false);
  };

  const sidebarContent = (
    <div className="w-64 bg-[#0D2B4E] text-white shadow-xl flex flex-col h-full">
      {/* LOGO */}
      <div className="p-6 border-b border-white/20 flex items-center justify-center bg-[#0A1F3A]">
        <img
          src="/img/logo_comieadepa2.png"
          alt="SISCOMIEADEPA"
          className="h-16 object-contain"
        />
      </div>

      {/* MENU */}
      <nav className="flex-1 px-0 py-4 overflow-y-auto">
        <div className="space-y-0">
          {menuItems.map((item) => {
            type SubItem = { id: string; label: string; icon: string; path: string };
            type ItemWithSub = { id: string; label: string; icon: string; path: string; submenu?: SubItem[] };
            const typedItem = item as ItemWithSub;
            const hasSubmenu = Array.isArray(typedItem.submenu) && typedItem.submenu.length > 0;
            const isExpanded = expandedMenu === item.id;
            const submenuItems: SubItem[] = hasSubmenu ? (typedItem.submenu as SubItem[]) : [];
            const submenuActive = submenuItems.some(s => activeMenu === s.id);
            return (
              <div key={item.id}>
                <button
                  onClick={() => {
                    if (hasSubmenu) {
                      setExpandedMenu(isExpanded ? null : item.id);
                    } else {
                      handleNavigate(item.id, item.path);
                    }
                  }}
                  className={`w-full flex items-center gap-3 px-4 py-3 transition border-l-4 ${
                    activeMenu === item.id || submenuActive
                      ? 'border-[#F39C12] bg-[#1A5276] text-white font-semibold'
                      : 'border-transparent text-white/80 hover:bg-[#1A3A5C] hover:text-white'
                  }`}
                >
                  <span className="text-lg w-6 text-center">{item.icon}</span>
                  <span className="text-sm font-medium flex-1 text-left">{item.label}</span>
                  {hasSubmenu && (
                    <span className="text-xs text-white/50">{isExpanded ? '▲' : '▼'}</span>
                  )}
                </button>
                {hasSubmenu && isExpanded && (
                  <div className="bg-[#0A1F3A] border-l-4 border-[#F39C12]/30">
                    {submenuItems.map(sub => (
                      <button
                        key={sub.id}
                        onClick={() => handleNavigate(sub.id, sub.path)}
                        className={`w-full flex items-center gap-3 pl-10 pr-4 py-2.5 transition text-sm ${
                          activeMenu === sub.id
                            ? 'bg-[#1A5276] text-white font-semibold'
                            : 'text-white/70 hover:bg-[#1A3A5C] hover:text-white'
                        }`}
                      >
                        <span className="text-sm w-5 text-center">{sub.icon}</span>
                        <span className="text-xs font-medium flex-1 text-left">{sub.label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </nav>

      {/* FOOTER */}
      <div className="p-4 border-t border-white/20 space-y-3 bg-[#0A1F3A]">
        <button
          onClick={() => {
            supabase.auth.signOut().finally(() => router.push('/'));
          }}
          className="w-full px-4 py-2 bg-[#C0392B] text-white rounded-lg font-semibold hover:bg-[#a93226] transition"
        >
          Sair
        </button>
        <p className="text-center text-xs text-white/60">SISCOMIEADEPA v1.0</p>
      </div>
    </div>
  );

  return (
    <>
      <button
        onClick={() => setIsMobileMenuOpen((open) => !open)}
        className="md:hidden fixed left-4 top-4 z-50 p-2 bg-white rounded-lg shadow-md text-[#0D2B4E] hover:bg-gray-100 transition"
        aria-label="Menu"
        aria-expanded={isMobileMenuOpen}
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      {isMobileMenuOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/50 z-40 md:hidden"
            onClick={() => setIsMobileMenuOpen(false)}
          />
          <div className="fixed left-0 top-0 h-full z-50 md:hidden">
            {sidebarContent}
          </div>
        </>
      )}

      <div className="hidden md:flex h-screen">
        {sidebarContent}
      </div>
    </>
  );
}
