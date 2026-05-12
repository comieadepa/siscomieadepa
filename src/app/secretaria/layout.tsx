'use client';

import { usePathname } from 'next/navigation';
import AccessRestricted from '@/components/AccessRestricted';
import { useRequireSupabaseAuth } from '@/hooks/useRequireSupabaseAuth';
import { useUserRole } from '@/hooks/useUserRole';
import { canAccessModule } from '@/lib/auth/roles';

export default function SecretariaLayout({ children }: { children: React.ReactNode }) {
  const { loading: authLoading } = useRequireSupabaseAuth();
  const { role, loading: roleLoading } = useUserRole();
  const pathname = usePathname() || '';
  const isCgadb = pathname.includes('/secretaria/cgadb');
  const permitido = isCgadb
    ? canAccessModule(role, 'cgadb')
    : canAccessModule(role, 'secretaria');

  if (authLoading || roleLoading) return <div className="p-8">Carregando...</div>;

  if (!permitido) {
    return (
      <AccessRestricted
        message={
          isCgadb
            ? 'Voce nao tem permissao para acessar o modulo CGADB.'
            : 'Voce nao tem permissao para acessar a Secretaria.'
        }
      />
    );
  }

  return <>{children}</>;
}
