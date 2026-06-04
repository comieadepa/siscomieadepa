-- Preenche unique_id para membros que estão com NULL
-- Usa a mesma fórmula que o front-end gera como stableUniqueId:
--   UPPER(LEFT(REPLACE(id::text, '-', ''), 16))
-- Isso garante que QR Codes já impressos continuem funcionando.

UPDATE public.members
SET unique_id = UPPER(LEFT(REPLACE(id::text, '-', ''), 16))
WHERE unique_id IS NULL OR trim(unique_id) = '';
