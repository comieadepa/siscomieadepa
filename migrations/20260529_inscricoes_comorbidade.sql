-- Migration: Adiciona campos de comorbidade/saúde em evento_inscricoes
-- Data: 2026-05-29
-- Motivo: Inscrição AGO precisa coletar comorbidade separadamente da necessidade especial

ALTER TABLE evento_inscricoes
  ADD COLUMN IF NOT EXISTS hosp_possui_comorbidade    boolean  NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS hosp_descricao_comorbidade text     NULL;

COMMENT ON COLUMN evento_inscricoes.hosp_possui_comorbidade    IS 'Participante possui comorbidade relevante para hospedagem';
COMMENT ON COLUMN evento_inscricoes.hosp_descricao_comorbidade IS 'Descrição da comorbidade (diabetes, pressão, cardíaco, etc.)';
