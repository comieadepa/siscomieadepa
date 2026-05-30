-- ============================================================
-- Materialização de setores AGO → evento_alojamentos
-- Adiciona campos para rastrear origem e chave de sincronização
-- ============================================================

ALTER TABLE evento_alojamentos ADD COLUMN IF NOT EXISTS setor_key        text;
ALTER TABLE evento_alojamentos ADD COLUMN IF NOT EXISTS origem            text;
ALTER TABLE evento_alojamentos ADD COLUMN IF NOT EXISTS grupo_permitido   text;
ALTER TABLE evento_alojamentos ADD COLUMN IF NOT EXISTS tipos_leito       jsonb;
ALTER TABLE evento_alojamentos ADD COLUMN IF NOT EXISTS leitos_inferiores integer DEFAULT 0;

-- Índice único para upsert idempotente por (evento_id, setor_key).
-- Partial index: só válido quando setor_key IS NOT NULL,
-- evitando conflito com alojamentos criados manualmente.
CREATE UNIQUE INDEX IF NOT EXISTS idx_alojamentos_evento_setor_key
  ON evento_alojamentos (evento_id, setor_key)
  WHERE setor_key IS NOT NULL;
