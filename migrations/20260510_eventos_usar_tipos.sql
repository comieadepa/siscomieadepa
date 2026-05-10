-- Adiciona flag para controlar se o evento usa tipos de inscrição ou valor único
ALTER TABLE eventos
  ADD COLUMN IF NOT EXISTS usar_tipos_inscricao boolean NOT NULL DEFAULT false;
