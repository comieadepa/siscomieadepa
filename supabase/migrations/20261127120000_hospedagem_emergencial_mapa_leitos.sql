-- ==============================================================================
-- MIGRATION: 20261127120000_hospedagem_emergencial_mapa_leitos.sql
-- OBJETIVO: Suporte a Alojamentos e Leitos Emergenciais na 126ª AGO
-- REGRA DE ISOLAMENTO:
--   1. Colunas aditivas com DEFAULT FALSE e retrocompatibilidade total.
--   2. Leitos e Alojamentos emergenciais são invisíveis para inscrições públicas/balcão,
--      não integram a capacidade oficial de vagas e não participam de autoalocação.
--   3. Disponibilizados exclusivamente à equipe autorizada de hospedagem no Mapa de Leitos.
-- ==============================================================================

BEGIN;

-- 1. Colunas aditivas em evento_alojamentos
ALTER TABLE public.evento_alojamentos
  ADD COLUMN IF NOT EXISTS is_emergencial BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS observacoes TEXT NULL,
  ADD COLUMN IF NOT EXISTS created_by TEXT NULL;

-- 2. Colunas aditivas em evento_hospedagem_leitos
ALTER TABLE public.evento_hospedagem_leitos
  ADD COLUMN IF NOT EXISTS is_emergencial BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS observacoes TEXT NULL,
  ADD COLUMN IF NOT EXISTS created_by TEXT NULL;

-- 3. Índices para performance e isolamento operacional
CREATE INDEX IF NOT EXISTS idx_evento_alojamentos_emergencial
  ON public.evento_alojamentos(evento_id, is_emergencial);

CREATE INDEX IF NOT EXISTS idx_evento_hospedagem_leitos_emergencial
  ON public.evento_hospedagem_leitos(evento_id, alojamento_id, is_emergencial);

COMMIT;
