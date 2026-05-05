-- Adiciona colunas do Presidente do Campo à tabela campos
-- (necessário para importação da planilha COMIEADEPA)

ALTER TABLE public.campos
  ADD COLUMN IF NOT EXISTS presidente_nome       VARCHAR(255),
  ADD COLUMN IF NOT EXISTS presidente_cpf        VARCHAR(14),
  ADD COLUMN IF NOT EXISTS presidente_matricula  VARCHAR(50),
  ADD COLUMN IF NOT EXISTS presidente_data_posse DATE;

-- Índice para facilitar buscas por presidente
CREATE INDEX IF NOT EXISTS idx_campos_presidente_nome
  ON public.campos (presidente_nome);
