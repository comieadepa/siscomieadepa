-- ============================================================
-- Migration: Portal do Ministro v2
-- Data: 2026-05-28
-- Adiciona: contas com senha, tokens QR, status em_impressao
-- ============================================================

-- 1. Tabela de contas do portal (senha com hash bcrypt)
CREATE TABLE IF NOT EXISTS public.ministro_portal_accounts (
  ministro_id uuid        PRIMARY KEY,
  senha_hash  text        NOT NULL,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

ALTER TABLE public.ministro_portal_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "portal_accounts_service_only"
  ON public.ministro_portal_accounts
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- 2. Tokens de validação de credencial (QR Code)
CREATE TABLE IF NOT EXISTS public.credencial_qr_tokens (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  ministro_id uuid        NOT NULL,
  token       text        NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL DEFAULT (now() + interval '1 year'),
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cred_qr_token    ON public.credencial_qr_tokens (token);
CREATE INDEX IF NOT EXISTS idx_cred_qr_ministro ON public.credencial_qr_tokens (ministro_id);

ALTER TABLE public.credencial_qr_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cred_qr_tokens_service_only"
  ON public.credencial_qr_tokens
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- Política de leitura pública para validação via token
CREATE POLICY "cred_qr_tokens_public_read"
  ON public.credencial_qr_tokens
  FOR SELECT TO anon
  USING (true);

-- 3. Adicionar coluna em_impressao_em à tabela de solicitações
ALTER TABLE public.credencial_impressoes_solicitacoes
  ADD COLUMN IF NOT EXISTS em_impressao_em timestamptz;

-- Atualizar a CHECK constraint de status para incluir em_impressao
-- PostgreSQL gera automaticamente o nome da constraint no padrão {tabela}_{coluna}_check
ALTER TABLE public.credencial_impressoes_solicitacoes
  DROP CONSTRAINT IF EXISTS credencial_impressoes_solicitacoes_status_check;

ALTER TABLE public.credencial_impressoes_solicitacoes
  ADD CONSTRAINT credencial_impressoes_solicitacoes_status_check
  CHECK (status IN (
    'aguardando_pagamento',
    'pago_pendente_impressao',
    'em_impressao',
    'impresso',
    'entregue',
    'cancelado'
  ));
