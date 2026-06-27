'use client';

import Sidebar from '@/components/Sidebar';
import { ReactNode, useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase-client';
import { getEquipeSession } from '@/lib/equipe-session';

interface PageLayoutProps {
  title: string;
  description: string;
  children: ReactNode;
  activeMenu?: string;
  hideSidebar?: boolean;
}

export default function PageLayout({
  title,
  description,
  children,
  activeMenu = 'dashboard',
  hideSidebar = false
}: PageLayoutProps) {
  const [sidebarActive, setSidebarActive] = useState(activeMenu);
  const [usuarioEmail, setUsuarioEmail] = useState<string | null>(null);
  const [usuarioNome, setUsuarioNome] = useState<string | null>(null);
  const [usuarioNivel, setUsuarioNivel] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }: any) => {
      const user = data.session?.user;
      if (!user) return;
      setUsuarioEmail(user.email ?? null);
      const meta = user.user_metadata as Record<string, string> | undefined;
      setUsuarioNome(meta?.nome || meta?.name || meta?.full_name || null);
      setUsuarioNivel(meta?.nivel || meta?.role || null);
    });
  }, []);

  const [isHospedagemEquipe, setIsHospedagemEquipe] = useState(false);

  useEffect(() => {
    // Check if the current user session is an active team session for 'hospedagem'
    const equipeSessao = getEquipeSession();
    if (equipeSessao && (equipeSessao.tipo === 'hospedagem' || equipeSessao.tipo === 'checkin_hospedagem')) {
      setIsHospedagemEquipe(true);
    }
  }, []);

  return (
    <div className="flex min-h-screen bg-gray-100 overflow-x-hidden">
      {/* SIDEBAR */}
      {!hideSidebar && !isHospedagemEquipe && <Sidebar activeMenu={sidebarActive} setActiveMenu={setSidebarActive} />}

      {/* MAIN CONTENT */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {/* HEADER */}
        <div className="bg-white shadow-sm border-b border-gray-200 px-4 sm:px-6 py-4 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-[#123b63]">{title}</h1>
            <p className="text-gray-600 text-xs sm:text-sm mt-1">{description}</p>
          </div>

          {usuarioEmail && (
            <div className="flex items-center gap-3 bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 shadow-sm flex-shrink-0">
              <div className="w-9 h-9 rounded-full bg-[#0D2B4E] flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                {(usuarioNome || usuarioEmail).charAt(0).toUpperCase()}
              </div>
              <div className="text-right">
                {usuarioNome && <p className="text-sm font-semibold text-gray-800 leading-tight">{usuarioNome}</p>}
                <p className="text-xs text-gray-500 leading-tight">{usuarioEmail}</p>
                {usuarioNivel && (
                  <p className="text-xs font-medium text-blue-600 mt-0.5 capitalize">{usuarioNivel}</p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* CONTENT */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-6">
          {children}
        </div>
      </div>
    </div>
  );
}
