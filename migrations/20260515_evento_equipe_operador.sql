-- Ajustes para novo fluxo de equipe (operador/checkin)
ALTER TABLE evento_equipe
  ADD COLUMN IF NOT EXISTS nome text,
  ADD COLUMN IF NOT EXISTS criado_por uuid,
  ADD COLUMN IF NOT EXISTS atualizado_em timestamptz DEFAULT now();

UPDATE evento_equipe
  SET tipo = 'operador'
  WHERE tipo = 'admin';

UPDATE evento_equipe
  SET atualizado_em = COALESCE(atualizado_em, now())
  WHERE atualizado_em IS NULL;

ALTER TABLE evento_equipe
  DROP CONSTRAINT IF EXISTS evento_equipe_tipo_check;

ALTER TABLE evento_equipe
  ADD CONSTRAINT evento_equipe_tipo_check CHECK (tipo IN ('operador','checkin'));
