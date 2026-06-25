'use client';

import { useState, useEffect, useMemo, useRef, type ComponentType } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase-client';
import { normalizeRole } from '@/lib/auth/roles';
import { getEquipeSession } from '@/lib/equipe-session';
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Building2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  CreditCard,
  FileText,
  LogOut,
  Settings,
  ShieldCheck,
  Users,
} from 'lucide-react';

interface SidebarProps {
  activeMenu: string;
  setActiveMenu: (id: string) => void;
}

type IconType = ComponentType<{ size?: number; className?: string }>;

type SubItem = {
  id: string;
  label: string;
  icon: IconType;
  path: string;
  badge?: number | string | null;
};

type MenuItem = {
  id: string;
  label: string;
  icon: IconType;
  path: string;
  badge?: number | string | null;
  submenu?: SubItem[];
};

type MenuSection = {
  label: string;
  items: MenuItem[];
};

// Quais menus de topo (por id) cada nível pode ver. 'super' vê tudo.
const MENU_POR_NIVEL: Record<string, string[]> = {
  super: ['*'],
  administrador: ['dashboard', 'secretaria', 'cgadb', 'comissao', 'patrimonio', 'missoes', 'configuracoes'],
  cgadb: ['cgadb'],
  comissao: ['dashboard', 'secretaria', 'comissao'],
  inscricao: ['eventos'],
  financeiro: ['financeiro'],
};

// Submenus que exigem nível ALÉM da visibilidade do menu pai.
// Se o id do submenu não estiver aqui, ele herda a visibilidade do pai.
const SUBMENU_RESTRICAO: Record<string, string[]> = {
  funcionarios: ['super', 'administrador'],
  'importar-membros': ['super'],
  'config-certificados': ['super'],
  'config-cartoes': ['super'],
};

function menuVisivel(nivel: string | null, menuId: string): boolean {
  if (!nivel) return false; // enquanto carrega, não mostra nada (evita flash de menu completo)
  const permitidos = MENU_POR_NIVEL[nivel];
  if (!permitidos) return false; // nivel desconhecido → acesso negado por padrão
  if (permitidos.includes('*')) return true;
  return permitidos.includes(menuId);
}

function submenuVisivel(nivel: string | null, submenuId: string): boolean {
  if (!nivel) return false;
  if (nivel === 'super') return true;
  const restricao = SUBMENU_RESTRICAO[submenuId];
  if (!restricao) return true; // sem restrição extra: herda visibilidade do pai
  return restricao.includes(nivel);
}

export default function Sidebar({ activeMenu, setActiveMenu }: SidebarProps) {
  const router = useRouter();
  const supabase = createClient();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [nivelUsuario, setNivelUsuario] = useState<string | null>(null);
  const [expandedMenu, setExpandedMenu] = useState<string | null>(null);
  const sidebarRef = useRef<HTMLDivElement | null>(null);

  const isCollapsedMode = isCollapsed && !isMobileMenuOpen;

  const getSidebarWidthClass = (collapsed: boolean) => (collapsed ? 'w-[78px]' : 'w-[276px]');

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

  useEffect(() => {
    const saved = localStorage.getItem('siscomieadepa.sidebar.collapsed');
    setIsCollapsed(saved === '1');
  }, []);

  useEffect(() => {
    localStorage.setItem('siscomieadepa.sidebar.collapsed', isCollapsed ? '1' : '0');
  }, [isCollapsed]);

  // Abre automaticamente o menu pai quando um submenu está ativo
  useEffect(() => {
    const menusComSubmenu: Record<string, string[]> = {
      secretaria: ['estrutura-hierarquica', 'membros', 'funcionarios', 'consagracao', 'cartas', 'permutas', 'impressoes-credenciais'],
      cgadb: ['cgadb-dashboard', 'cgadb-debitos', 'cgadb-relatorios', 'cgadb-historico'],
      configuracoes: ['config-geral', 'importar-membros', 'config-certificados', 'config-cartoes', 'config-video-presidente'],
    };
    for (const [parent, children] of Object.entries(menusComSubmenu)) {
      if (children.includes(activeMenu)) {
        setExpandedMenu(parent);
        return;
      }
    }
  }, [activeMenu]);

  const menuBadges = useMemo<Record<string, number | string>>(() => ({}), []);

  const menuSectionsBase: MenuSection[] = useMemo(() => ([
    {
      label: 'GESTÃO',
      items: [
        { id: 'dashboard', label: 'Dashboard', icon: BarChart3, path: '/dashboard' },
        {
          id: 'secretaria',
          label: 'Secretaria',
          icon: FileText,
          path: '/secretaria',
          submenu: [
            { id: 'estrutura-hierarquica', label: 'Supervisões e Campos', icon: Building2, path: '/secretaria/estrutura-hierarquica' },
            { id: 'membros', label: 'Ministros', icon: Users, path: '/secretaria/membros' },
            { id: 'funcionarios', label: 'Funcionários', icon: Users, path: '/secretaria/funcionarios' },
            { id: 'consagracao', label: 'Consagração (obreiros)', icon: FileText, path: '/secretaria/consagracao' },
            { id: 'cartas', label: 'Cartas ministeriais', icon: FileText, path: '/secretaria/cartas' },
            // { id: 'certificados', label: 'Certificados', icon: ShieldCheck, path: '/secretaria/certificados' },
            { id: 'permutas', label: 'Permutas', icon: ArrowRight, path: '/secretaria/permutas' },
            { id: 'impressoes-credenciais', label: 'Impressões de Credenciais', icon: CreditCard, path: '/secretaria/impressoes-credenciais' },
          ],
        },
        { id: 'conec', label: 'CONEC', icon: ShieldCheck, path: '/secretaria/conec' },
        {
          id: 'cgadb',
          label: 'Débitos CGADB',
          icon: AlertTriangle,
          path: '/secretaria/cgadb',
          submenu: [
            { id: 'cgadb-dashboard', label: 'Dashboard', icon: BarChart3, path: '/secretaria/cgadb' },
            { id: 'cgadb-debitos', label: 'Débitos', icon: AlertTriangle, path: '/secretaria/cgadb/debitos' },
            { id: 'cgadb-relatorios', label: 'Relatórios', icon: FileText, path: '/secretaria/cgadb/relatorios' },
            { id: 'cgadb-historico', label: 'Histórico', icon: Clock, path: '/secretaria/cgadb/historico' },
          ],
        },
        { id: 'financeiro', label: 'Financeiro', icon: CreditCard, path: '/financeiro' },
        { id: 'eventos', label: 'Eventos', icon: Clock, path: '/eventos', badge: menuBadges.eventos ?? null },
        { id: 'comissao', label: 'Comissão', icon: Users, path: '/comissao' },
        { id: 'patrimonio', label: 'Patrimônio', icon: Building2, path: '/patrimonio' },
        { id: 'missoes', label: 'Missões', icon: ArrowRight, path: '/missoes' },
      ],
    },
    {
      label: 'ADMINISTRAÇÃO',
      items: [
        { id: 'auditoria', label: 'Auditoria', icon: ShieldCheck, path: '/auditoria', badge: menuBadges.auditoria ?? null },
        { id: 'usuarios', label: 'Usuários', icon: Users, path: '/usuarios' },
        {
          id: 'configuracoes',
          label: 'Configurações',
          icon: Settings,
          path: '/configuracoes',
          submenu: [
            { id: 'config-geral', label: 'Geral', icon: Settings, path: '/configuracoes' },
            { id: 'importar-membros', label: 'Importar Ministros', icon: ArrowRight, path: '/secretaria/membros/importar' },
            { id: 'config-certificados', label: 'Template Studio', icon: ShieldCheck, path: '/configuracoes/certificados' },
            { id: 'config-cartoes', label: 'Cartões', icon: FileText, path: '/configuracoes/cartoes' },
            { id: 'config-video-presidente', label: 'Vídeo Palavra do Presidente', icon: FileText, path: '/configuracoes/video-presidente' },
          ],
        },
      ],
    },
  ]), [menuBadges]);

  const menuSections = useMemo(() => (
    menuSectionsBase
      .map((section) => {
        const items = section.items
          .filter((item) => menuVisivel(nivelUsuario, item.id))
          .map((item) => {
            if (item.submenu) {
              return {
                ...item,
                submenu: item.submenu.filter((sub) => submenuVisivel(nivelUsuario, sub.id)),
              };
            }
            return item;
          });
        if (items.length === 0) return null;
        return { ...section, items };
      })
      .filter(Boolean) as MenuSection[]
  ), [menuSectionsBase, nivelUsuario]);

  const handleNavigate = (id: string, path: string) => {
    let targetPath = path;
    setActiveMenu(id);
    router.push(targetPath);
    setIsMobileMenuOpen(false);
  };

  const renderBadge = (badge?: number | string | null, collapsed = false) => {
    if (badge === undefined || badge === null || badge === 0 || badge === '0') return null;
    if (collapsed) {
      return (
        <span className="absolute -top-1 -right-1 rounded-full bg-red-500 text-white text-[9px] font-bold px-1.5 py-0.5 shadow">
          {badge}
        </span>
      );
    }
    return (
      <span className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-500 text-white shadow">
        {badge}
      </span>
    );
  };

  const renderSidebar = (collapsed: boolean, extraClasses = '') => (
    <div
      ref={sidebarRef}
      className={`min-h-screen h-screen flex flex-col justify-between overflow-y-auto overflow-x-hidden text-white shadow-xl border-r border-white/10 bg-gradient-to-b from-[#0D2B4E] via-[#0B2744] to-[#0A1F3A] transition-[width] duration-300 ${
        getSidebarWidthClass(collapsed)
      } ${extraClasses}`}
      data-collapsed={collapsed ? 'true' : 'false'}
    >
      {/* TOPO */}
      <div className={`px-4 ${collapsed ? 'py-5' : 'py-4'} border-b border-white/10 bg-[#0A1F3A]/60`}>
        <div className={`flex items-center ${collapsed ? 'justify-center' : 'justify-between'} gap-3`}>
          <div className="flex items-center gap-3">
            <img
              src="/img/logo_comieadepa2.png"
              alt="SISCOMIEADEPA"
              className={`object-contain ${collapsed ? 'h-10' : 'h-12'} transition-all`}
            />
          </div>
          {!collapsed && (
            <button
              onClick={() => setIsCollapsed(true)}
              title="Recolher menu"
              className="hidden md:flex items-center justify-center w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 transition"
              aria-label="Recolher menu"
            >
              <ChevronLeft size={16} className="text-white/70" />
            </button>
          )}
        </div>
        {collapsed && (
          <button
            onClick={() => setIsCollapsed(false)}
            title="Expandir menu"
            className="hidden md:flex items-center justify-center w-full mt-3 h-9 rounded-lg bg-white/5 hover:bg-white/10 transition"
            aria-label="Expandir menu"
          >
            <ChevronRight size={16} className="text-white/70" />
          </button>
        )}
      </div>

      {/* MENU */}
      <nav className="flex-1 min-h-0 px-2 py-4 overflow-y-auto">
        <div className="space-y-4">
          {menuSections.map((section) => (
            <div key={section.label}>
              {!collapsed && (
                <p className="px-3 text-[10px] font-bold uppercase tracking-[0.25em] text-white/40 mb-2">
                  {section.label}
                </p>
              )}
              <div className="space-y-1.5">
                {section.items.map((item) => {
                  const hasSubmenu = Array.isArray(item.submenu) && item.submenu.length > 0;
                  const isExpanded = expandedMenu === item.id;
                  const submenuItems = hasSubmenu ? (item.submenu as SubItem[]) : [];
                  const submenuActive = submenuItems.some((s) => activeMenu === s.id);
                  const isActive = activeMenu === item.id || submenuActive;
                  const Icon = item.icon;

                  return (
                    <div key={item.id} className="relative">
                      <button
                        onClick={() => {
                          if (hasSubmenu) {
                            if (item.id === 'cgadb' && !submenuActive) {
                              handleNavigate('cgadb-dashboard', item.path);
                            }
                            setExpandedMenu(isExpanded ? null : item.id);
                          } else {
                            handleNavigate(item.id, item.path);
                          }
                        }}
                        className={`group relative w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 ${
                          isActive
                            ? 'bg-white/10 text-white shadow-[0_0_16px_rgba(18,59,99,0.35)]'
                            : 'text-white/70 hover:text-white hover:bg-white/5'
                        }`}
                        aria-expanded={hasSubmenu ? isExpanded : undefined}
                        aria-current={isActive ? 'page' : undefined}
                        title={collapsed ? item.label : undefined}
                      >
                        <span
                          className={`absolute left-0 top-1/2 -translate-y-1/2 h-6 w-1 rounded-r ${
                            isActive
                              ? 'bg-[#F39C12] shadow-[0_0_10px_rgba(243,156,18,0.6)]'
                              : 'bg-transparent group-hover:bg-[#F39C12]/40'
                          }`}
                        />
                        <span
                          className={`relative flex items-center justify-center w-9 h-9 rounded-md transition ${
                            isActive ? 'bg-white/10' : 'bg-white/5 group-hover:bg-white/10'
                          }`}
                        >
                          <Icon size={18} className="text-white" />
                          {renderBadge(item.badge, collapsed)}
                        </span>
                        {!collapsed && (
                          <span className="text-sm font-semibold flex-1 text-left">
                            {item.label}
                          </span>
                        )}
                        {!collapsed && item.badge && renderBadge(item.badge)}
                        {hasSubmenu && !collapsed && (
                          <ChevronDown
                            size={14}
                            className={`text-white/60 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                          />
                        )}
                        {collapsed && (
                          <span className="pointer-events-none absolute left-full ml-3 top-1/2 -translate-y-1/2 rounded-md bg-[#0A1F3A] px-2.5 py-1 text-[11px] font-semibold text-white/90 opacity-0 shadow-lg border border-white/10 transition group-hover:opacity-100">
                            {item.label}
                          </span>
                        )}
                      </button>

                      {/* Submenu expandido (desktop) */}
                      {hasSubmenu && !collapsed && (
                        <div
                          className={`overflow-hidden transition-[max-height,opacity,transform] duration-300 ${
                            isExpanded ? 'max-h-96 opacity-100 translate-y-0' : 'max-h-0 opacity-0 -translate-y-1'
                          }`}
                        >
                          <div className="mt-1 ml-4 pl-4 border-l border-white/10 space-y-1">
                            {submenuItems.map((sub) => {
                              const SubIcon = sub.icon;
                              const subActive = activeMenu === sub.id;
                              return (
                                <button
                                  key={sub.id}
                                  onClick={() => handleNavigate(sub.id, sub.path)}
                                  className={`group relative w-full flex items-center gap-2 rounded-md px-2.5 py-2 text-xs transition ${
                                    subActive
                                      ? 'bg-white/10 text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]'
                                      : 'text-white/60 hover:text-white hover:bg-white/5'
                                  }`}
                                >
                                  <span
                                    className={`absolute left-0 top-1/2 -translate-y-1/2 h-4 w-0.5 rounded-r ${
                                      subActive ? 'bg-[#F39C12]' : 'bg-transparent group-hover:bg-[#F39C12]/40'
                                    }`}
                                  />
                                  <SubIcon size={14} className="text-white/80" />
                                  <span className="flex-1 text-left">{sub.label}</span>
                                  {renderBadge(sub.badge)}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Submenu flutuante (modo recolhido) */}
                      {hasSubmenu && collapsed && isExpanded && (
                        <div className="absolute left-full top-0 ml-3 min-w-[210px] rounded-xl bg-[#0A1F3A] border border-white/10 shadow-2xl p-2 z-50">
                          <p className="px-2 pb-1 text-[10px] uppercase tracking-[0.25em] text-white/50">
                            {item.label}
                          </p>
                          {submenuItems.map((sub) => {
                            const SubIcon = sub.icon;
                            const subActive = activeMenu === sub.id;
                            return (
                              <button
                                key={sub.id}
                                onClick={() => handleNavigate(sub.id, sub.path)}
                                className={`group w-full flex items-center gap-2 rounded-md px-2.5 py-2 text-xs transition ${
                                  subActive
                                    ? 'bg-white/10 text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]'
                                    : 'text-white/60 hover:text-white hover:bg-white/5'
                                }`}
                              >
                                <SubIcon size={14} className="text-white/80" />
                                <span className="flex-1 text-left">{sub.label}</span>
                                {renderBadge(sub.badge)}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </nav>

      {/* FOOTER */}
      <div className="px-4 py-4 border-t border-white/10 bg-[#0A1F3A]/70 space-y-3">
        <button
          onClick={async () => {
            try {
              const { data: { session } } = await supabase.auth.getSession();
              if (session?.access_token) {
                await fetch('/api/v1/audit-logs', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${session.access_token}`,
                  },
                  body: JSON.stringify({
                    acao: 'logout',
                    modulo: 'auth',
                    descricao: `Logout realizado por ${session.user?.email ?? ''}`,
                    usuario_email: session.user?.email,
                    status: 'sucesso',
                  }),
                });
              }
            } catch {
              // silencioso
            }
            supabase.auth.signOut().finally(() => router.push('/'));
          }}
          className={`w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-semibold transition ${
            collapsed
              ? 'bg-[#C0392B]/80 hover:bg-[#C0392B]'
              : 'bg-[#C0392B] hover:bg-[#a93226]'
          }`}
        >
          <LogOut size={16} />
          {!collapsed && 'Sair'}
        </button>
        <p className={`text-center text-[10px] text-white/50 ${collapsed ? 'hidden' : ''}`}>
          SISCOMIEADEPA v1.0
        </p>
      </div>
    </div>
  );

  const [isHospedagemEquipe, setIsHospedagemEquipe] = useState(false);

  useEffect(() => {
    const sess = getEquipeSession();
    if (sess && (sess.tipo === 'hospedagem' || sess.tipo === 'checkin_hospedagem')) {
      setIsHospedagemEquipe(true);
    }
  }, []);

  if (isHospedagemEquipe) {
    return null;
  }

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

      {/* Mobile Drawer */}
      <div
        className={`fixed inset-0 bg-black/50 z-40 md:hidden transition-opacity duration-300 ${
          isMobileMenuOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        onClick={() => setIsMobileMenuOpen(false)}
      />
      <div
        className={`fixed left-0 top-0 h-screen min-h-screen z-50 md:hidden transform transition-transform duration-300 ${
          isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {renderSidebar(false)}
      </div>

      {/* Desktop */}
      <div className={`hidden md:block ${getSidebarWidthClass(isCollapsedMode)} min-h-screen shrink-0`} aria-hidden="true" />
      {renderSidebar(isCollapsedMode, 'fixed left-0 top-0 z-40 hidden md:flex')}
    </>
  );
}
