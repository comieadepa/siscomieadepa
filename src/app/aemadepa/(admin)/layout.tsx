'use client';

import AccessRestricted from '@/components/AccessRestricted';
import { useRequireSupabaseAuth } from '@/hooks/useRequireSupabaseAuth';
import { useUserRole } from '@/hooks/useUserRole';
import { canAccessModule } from '@/lib/auth/roles';

export default function AemadepaLayout({ children }: { children: React.ReactNode }) {
  const { loading: authLoading } = useRequireSupabaseAuth();
  const { role, loading: roleLoading } = useUserRole();

  const permitido = canAccessModule(role, 'aemadepa');

  if (authLoading || roleLoading) return <div className="p-8">Carregando...</div>;

  if (!permitido) {
    return (
      <AccessRestricted
        message="Você não tem permissão para acessar o módulo AEMADEPA."
      />
    );
  }

  return <>{children}</>;
}
