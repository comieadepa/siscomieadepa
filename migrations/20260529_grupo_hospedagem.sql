-- Adiciona campo grupo_hospedagem nas inscrições e nas alocações de hospedagem
-- Permite ao inscrito indicar o grupo (ex: Presidentes, Jubilados, Feminino, etc.)

ALTER TABLE evento_inscricoes
  ADD COLUMN IF NOT EXISTS grupo_hospedagem text NULL;

COMMENT ON COLUMN evento_inscricoes.grupo_hospedagem
  IS 'Grupo de hospedagem selecionado pelo inscrito (ex: Presidentes, Jubilados, Feminino)';

ALTER TABLE evento_hospedagens
  ADD COLUMN IF NOT EXISTS grupo_hospedagem text NULL;

COMMENT ON COLUMN evento_hospedagens.grupo_hospedagem
  IS 'Grupo de hospedagem da alocação, espelhado da inscrição';
