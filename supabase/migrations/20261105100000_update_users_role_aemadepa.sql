-- =============================================================================
-- Migration: Atualiza constraint valid_role na tabela public.users para incluir 'aemadepa'
-- Roles canônicos suportados: super, admin, cgadb, comissao, inscricao, financeiro, aemadepa
-- =============================================================================

ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS valid_role;

ALTER TABLE public.users
  ADD CONSTRAINT valid_role
    CHECK (role IN ('super', 'admin', 'cgadb', 'comissao', 'inscricao', 'financeiro', 'aemadepa'));
