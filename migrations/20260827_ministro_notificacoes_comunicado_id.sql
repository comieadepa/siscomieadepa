-- ============================================================
-- Migration: Adiciona comunicado_id em ministro_portal_notificacoes
-- Data: 2026-08-27
-- Tabela: public.ministro_portal_notificacoes
-- ============================================================

ALTER TABLE public.ministro_portal_notificacoes
  ADD COLUMN IF NOT EXISTS comunicado_id uuid NULL
  REFERENCES public.comunicados(id)
  ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_min_notif_comunicado
  ON public.ministro_portal_notificacoes(ministro_id, comunicado_id);
