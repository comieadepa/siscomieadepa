-- Campos de convite e acesso para equipe do evento
ALTER TABLE evento_equipe
  ADD COLUMN IF NOT EXISTS convite_token text,
  ADD COLUMN IF NOT EXISTS convite_expira_em timestamptz,
  ADD COLUMN IF NOT EXISTS convite_usado_em timestamptz,
  ADD COLUMN IF NOT EXISTS ultimo_acesso_em timestamptz;

-- Index para lookup por token
CREATE INDEX IF NOT EXISTS idx_evento_equipe_convite_token
  ON evento_equipe (convite_token);
