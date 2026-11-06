'use client';

import { usePathname } from 'next/navigation';
import AccessRestricted from '@/components/AccessRestricted';
import LoadingTransition from '@/components/LoadingTransition';
import { useRequireSupabaseAuth } from '@/hooks/useRequireSupabaseAuth';
import { useUserRole } from '@/hooks/useUserRole';
import { canAccessModule } from '@/lib/auth/roles';

export default function ConfiguracoesLayout({ children }: { children: React.ReactNode }) {
  const { loading: authLoading } = useRequireSupabaseAuth();
  const { role, loading: roleLoading } = useUserRole();
  const pathname = usePathname() || '';
  const permitido = canAccessModule(role, 'configuracoes');
  const superOnly =
    pathname.includes('/configuracoes/plano') ||
    pathname.includes('/configuracoes/faturas') ||
    pathname.includes('/configuracoes/perfil-ministerio');

  if (authLoading || roleLoading) return <LoadingTransition mensagem="Carregando Configurações..." subtitulo="SISCOMIEADEPA" fullScreen={true} />;

  if (!permitido) {
    return (
      <AccessRestricted message="Voce nao tem permissao para acessar as configuracoes." />
    );
  }

  if (superOnly && role !== 'super') {
    return (
      <AccessRestricted message="Acesso restrito: configuracao exclusiva para super." />
    );
  }

  return <>{children}</>;
}
