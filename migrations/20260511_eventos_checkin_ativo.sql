-- Adiciona flag checkin_ativo ao evento
ALTER TABLE eventos
  ADD COLUMN IF NOT EXISTS checkin_ativo boolean NOT NULL DEFAULT false;
