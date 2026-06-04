-- =============================================================================
-- Compatibilidade com códigos legados Bubble (formato: {timestamp}x{digits})
-- =============================================================================
-- Problema identificado:
--   1. unique_id era VARCHAR(20) — insuficiente para códigos Bubble (32 chars)
--   2. Membros importados do Bubble têm o código em custom_fields->>'uniqueId'
--      e unique_id NULL (código não cabe na coluna)
--
-- Correções:
--   1. Alarga unique_id para VARCHAR(50)
--   2. Copia custom_fields->>'uniqueId' → unique_id onde ainda está NULL
--   3. Cria índice GIN parcial em custom_fields para buscas JSONB eficientes
-- =============================================================================

-- 1. Alarga a coluna unique_id para suportar códigos Bubble (32 chars)
ALTER TABLE public.members
  ALTER COLUMN unique_id TYPE VARCHAR(50);

-- 2. Preenche unique_id para membros Bubble (código em custom_fields->>'uniqueId')
UPDATE public.members
SET unique_id = custom_fields->>'uniqueId'
WHERE (unique_id IS NULL OR trim(unique_id) = '')
  AND custom_fields->>'uniqueId' IS NOT NULL
  AND trim(custom_fields->>'uniqueId') <> '';

-- 3. Para membros que ainda têm unique_id NULL e não têm código Bubble,
--    usa o fallback UUID (primeiros 16 chars sem hífens, maiúsculas)
UPDATE public.members
SET unique_id = UPPER(LEFT(REPLACE(id::text, '-', ''), 16))
WHERE unique_id IS NULL OR trim(unique_id) = '';

-- 4. Índice para busca eficiente por custom_fields->>'uniqueId' (Bubble legacy)
CREATE INDEX IF NOT EXISTS idx_members_cf_uniqueid
  ON public.members ((custom_fields->>'uniqueId'))
  WHERE custom_fields->>'uniqueId' IS NOT NULL;

-- 5. Índice para a coluna unique_id (pode já existir, usa IF NOT EXISTS)
CREATE INDEX IF NOT EXISTS idx_members_unique_id
  ON public.members (unique_id)
  WHERE unique_id IS NOT NULL;
