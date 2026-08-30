-- ============================================================
-- Migration: Ciclo de Vida da Credencial Física (Status Padronizados)
-- Data: 2026-06-14
-- Tabela: public.credencial_impressoes_solicitacoes
-- ============================================================

-- 1. Adiciona coluna de timestamp para quando a credencial fica disponível para retirada
ALTER TABLE public.credencial_impressoes_solicitacoes
  ADD COLUMN IF NOT EXISTS disponivel_retirada_em timestamptz;

-- 2. Migração de compatibilidade para registros históricos (se houver 'impresso')
UPDATE public.credencial_impressoes_solicitacoes
SET 
  status = 'disponivel_retirada',
  disponivel_retirada_em = COALESCE(disponivel_retirada_em, impresso_em, now()),
  updated_at = now()
WHERE status = 'impresso';

-- 3. Atualização da CHECK constraint de status
ALTER TABLE public.credencial_impressoes_solicitacoes
  DROP CONSTRAINT IF EXISTS credencial_impressoes_solicitacoes_status_check;

ALTER TABLE public.credencial_impressoes_solicitacoes
  ADD CONSTRAINT credencial_impressoes_solicitacoes_status_check
  CHECK (status IN (
    'aguardando_pagamento',
    'pago_pendente_impressao',
    'em_impressao',
    'disponivel_retirada',
    'entregue',
    'cancelado'
  ));

-- 4. Preservação e garantia de índices para alta performance
CREATE INDEX IF NOT EXISTS idx_cred_impr_ministro_id ON public.credencial_impressoes_solicitacoes (ministro_id);
CREATE INDEX IF NOT EXISTS idx_cred_impr_status      ON public.credencial_impressoes_solicitacoes (status);
CREATE INDEX IF NOT EXISTS idx_cred_impr_payment     ON public.credencial_impressoes_solicitacoes (asaas_payment_id);
CREATE INDEX IF NOT EXISTS idx_cred_impr_solic_em    ON public.credencial_impressoes_solicitacoes (solicitado_em DESC);
