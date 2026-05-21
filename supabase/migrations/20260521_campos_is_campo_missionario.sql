-- Migration: Campo Missionário — característica do Campo (não do ministro)
-- "Campo Missionário NÃO é uma categoria de pessoa. É uma característica do CAMPO."

ALTER TABLE public.campos
  ADD COLUMN IF NOT EXISTS is_campo_missionario BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.campos.is_campo_missionario
  IS 'Indica se este campo é um Campo Missionário. Quando verdadeiro, Pastores Presidentes deste campo podem receber valor diferenciado na AGO.';

CREATE INDEX IF NOT EXISTS idx_campos_is_campo_missionario
  ON public.campos (is_campo_missionario)
  WHERE is_campo_missionario = true;
