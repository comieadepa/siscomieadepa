'use client';

import AccessRestricted from '@/components/AccessRestricted';
import LoadingTransition from '@/components/LoadingTransition';
import { useRequireSupabaseAuth } from '@/hooks/useRequireSupabaseAuth';
import { useUserRole } from '@/hooks/useUserRole';
import { canAccessModule } from '@/lib/auth/roles';

export default function UmadespaLayout({ children }: { children: React.ReactNode }) {
  const { loading: authLoading } = useRequireSupabaseAuth();
  const { role, loading: roleLoading } = useUserRole();

  const permitido = canAccessModule(role, 'umadespa');

  if (authLoading || roleLoading) {
    return (
      <LoadingTransition
        mensagem="Carregando UMADESPA..."
        subtitulo="SISCOMIEADEPA — Juventude"
        fullScreen={true}
      />
    );
  }

  if (!permitido) {
    return (
      <AccessRestricted
        message="Você não tem permissão para acessar o módulo UMADESPA."
      />
    );
  }

  return <>{children}</>;
}
