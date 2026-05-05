-- =============================================================================
-- Migration: Atualiza roles da tabela public.users
-- Novos roles: super, admin, cgadb, comissao, inscricao, financeiro
-- =============================================================================

-- 1. Remover constraint antiga
ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS valid_role;

-- 2. Migrar valores legados para equivalentes novos
UPDATE public.users SET role = 'admin'     WHERE role IN ('manager', 'operator', 'viewer') OR role IS NULL;

-- 3. Atualizar o default
ALTER TABLE public.users
  ALTER COLUMN role SET DEFAULT 'admin';

-- 4. Adicionar nova constraint com os roles atuais
ALTER TABLE public.users
  ADD CONSTRAINT valid_role
    CHECK (role IN ('super', 'admin', 'cgadb', 'comissao', 'inscricao', 'financeiro'));

-- 5. Garantir NOT NULL na coluna role
UPDATE public.users SET role = 'admin' WHERE role IS NULL;
ALTER TABLE public.users ALTER COLUMN role SET NOT NULL;
