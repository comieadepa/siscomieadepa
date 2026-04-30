-- Fix: recursão infinita nas policies RLS
-- users_admin_all referenciava public.users dentro da própria policy
-- config_admin_write idem

-- Corrige policy da tabela users (remover recursão)
DROP POLICY IF EXISTS "users_admin_all" ON public.users;
CREATE POLICY "users_admin_all" ON public.users FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.admin_users au
      WHERE au.email = (SELECT email FROM auth.users WHERE id = auth.uid())
      AND au.status = 'ATIVO'
    )
    OR id = auth.uid()
  );

-- Corrige policy da tabela configurations (remover referência a public.users)
DROP POLICY IF EXISTS "config_admin_write" ON public.configurations;
CREATE POLICY "config_admin_write" ON public.configurations FOR ALL
  USING (auth.uid() IS NOT NULL);
