-- Adiciona colunas template_key e tipo_cadastro à tabela cartoes_templates
-- Necessário para o módulo de sincronização de templates de cartão

ALTER TABLE public.cartoes_templates
  ADD COLUMN IF NOT EXISTS template_key TEXT,
  ADD COLUMN IF NOT EXISTS tipo_cadastro TEXT;

-- Backfill para linhas já existentes
UPDATE public.cartoes_templates
  SET template_key = id::text
  WHERE template_key IS NULL;

UPDATE public.cartoes_templates
  SET tipo_cadastro = COALESCE(tipo, 'ministro')
  WHERE tipo_cadastro IS NULL;

-- Índice único para permitir upsert por template_key
CREATE UNIQUE INDEX IF NOT EXISTS idx_cartoes_templates_template_key
  ON public.cartoes_templates(template_key)
  WHERE template_key IS NOT NULL;
