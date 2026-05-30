-- Migration: adiciona coluna administrativo em evento_tipos_inscricao
-- Categorias administrativas são usadas internamente (ex: Esposa de Pastor Presidente Campo Missionário)
-- e não aparecem no seletor público nem no balcão.

ALTER TABLE evento_tipos_inscricao
  ADD COLUMN IF NOT EXISTS administrativo boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN evento_tipos_inscricao.administrativo
  IS 'Se true, categoria é administrativa (uso interno). Não aparece no seletor público nem no balcão geral.';
