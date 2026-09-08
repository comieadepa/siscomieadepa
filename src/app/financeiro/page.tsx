'use client';

import PageLayout from '@/components/PageLayout';
import AccessRestricted from '@/components/AccessRestricted';
import { useRequireSupabaseAuth } from '@/hooks/useRequireSupabaseAuth';
import { useUserRole } from '@/hooks/useUserRole';
import { canAccessModule } from '@/lib/auth/roles';
import DashboardView from '@/components/financeiro/DashboardView';
import Link from 'next/link';

export default function FinanceiroDashboardPage() {
  const { loading: authLoading } = useRequireSupabaseAuth();
  const { role, loading: roleLoading } = useUserRole();
  const podeAcessar = canAccessModule(role, 'financeiro');

  if (authLoading || roleLoading) {
    return (
      <PageLayout title="Financeiro" description="" activeMenu="financeiro">
        <div className="flex items-center justify-center py-20 text-gray-400 text-sm">Carregando...</div>
      </PageLayout>
    );
  }

  if (!podeAcessar) {
    return (
      <PageLayout title="Financeiro" description="" activeMenu="financeiro">
        <AccessRestricted message="Você não tem permissão para acessar o módulo financeiro." />
      </PageLayout>
    );
  }

  return (
    <PageLayout title="Financeiro" description="Dashboard financeiro da organização" activeMenu="financeiro">
      <div className="w-full max-w-7xl mx-auto space-y-6">
        {/* ── Navegação do módulo ──────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-widest text-gray-400 mr-2">Módulo Financeiro</span>
          <Link href="/financeiro/lancamentos?aba=dashboard"
            className="px-4 py-1.5 rounded-full text-xs font-semibold bg-[#123b63] text-white shadow-sm">
            Dashboard
          </Link>
          <Link href="/financeiro/lancamentos?aba=contribuicao-estatutaria"
            className="px-4 py-1.5 rounded-full text-xs font-semibold border border-gray-300 text-gray-600 hover:bg-gray-50 transition">
            Contribuição Estatutária
          </Link>
          <Link href="/financeiro/lancamentos?aba=credenciais"
            className="px-4 py-1.5 rounded-full text-xs font-semibold border border-gray-300 text-gray-600 hover:bg-gray-50 transition">
            Credenciais
          </Link>
        </div>

        <DashboardView />
      </div>
    </PageLayout>
  );
}
