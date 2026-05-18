-- ============================================================
-- MEMBER HISTORY V2 — Adiciona campos para histórico dinâmico
-- ============================================================

ALTER TABLE public.member_history
  ADD COLUMN IF NOT EXISTS titulo        VARCHAR(500),
  ADD COLUMN IF NOT EXISTS origem        VARCHAR(100),
  ADD COLUMN IF NOT EXISTS referencia_id VARCHAR(255);

-- Índice de consulta por origem
CREATE INDEX IF NOT EXISTS idx_member_history_origem
  ON public.member_history (origem)
  WHERE origem IS NOT NULL;

-- Índice parcial de unicidade para evitar duplicatas automáticas.
-- Aplica-se apenas quando AMBOS origem e referencia_id são não-nulos,
-- permitindo múltiplos registros manuais sem restrição.
CREATE UNIQUE INDEX IF NOT EXISTS uq_member_history_dedup
  ON public.member_history (member_id, origem, referencia_id)
  WHERE referencia_id IS NOT NULL AND origem IS NOT NULL;
