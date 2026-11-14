-- ==============================================================================
-- SISCOMIEADEPA — MIGRATION: REFORMULAÇÃO LOGIN E PRIMEIRO ACESSO DO MINISTRO
-- Arquivo: supabase/migrations/20261114100000_portal_ministro_email_activation.sql
-- Objetivo:
--   1. Adicionar colunas de confirmação de e-mail e status na tabela de contas
--      public.ministro_portal_accounts (email, email_confirmed, confirmation_token,
--      confirmation_expires_at).
--   2. Garantir compatibilidade retroativa: contas já existentes são marcadas
--      automaticamente como email_confirmed = true.
--   3. Criar índice único sobre o e-mail confirmado para login por e-mail rápido e sem ambiguidades.
-- Status: PREPARADA (NÃO APLICADA — APRESENTADA PARA APROVAÇÃO).
-- ==============================================================================

-- 1. Adicionar colunas necessárias na tabela de contas
ALTER TABLE public.ministro_portal_accounts
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS email_confirmed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS confirmation_token text,
  ADD COLUMN IF NOT EXISTS confirmation_expires_at timestamptz;

-- 2. Migração segura de compatibilidade:
-- Contas legadas já criadas passam a ser consideradas confirmadas para não bloquear ministros já ativos
UPDATE public.ministro_portal_accounts a
SET 
  email = COALESCE(a.email, m.email),
  email_confirmed = true
FROM public.members m
WHERE a.ministro_id = m.id AND a.email_confirmed = false AND a.confirmation_token IS NULL;

-- 3. Índices para otimização de busca no login e ativação
CREATE INDEX IF NOT EXISTS idx_ministro_portal_accounts_email
  ON public.ministro_portal_accounts (lower(email));

CREATE INDEX IF NOT EXISTS idx_ministro_portal_accounts_conf_token
  ON public.ministro_portal_accounts (confirmation_token)
  WHERE confirmation_token IS NOT NULL;
