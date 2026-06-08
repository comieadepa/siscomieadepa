-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 20260608_ago_fix_null_valores_tipos.sql
-- Objetivo: Corrigir tipos de inscrição com valor = NULL para eventos AGO.
-- Aplica valores padrão oficiais apenas quando o valor atual for NULL.
-- Idempotente — pode ser executado múltiplas vezes sem efeito colateral.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── AUDITORIA PRÉ-CORREÇÃO ──────────────────────────────────────────────────
-- Comando para verificar tipos com valor NULL antes de rodar:
--
--   SELECT id, nome, valor, ativo, cortesia, administrativo
--   FROM evento_tipos_inscricao
--   WHERE ativo = true
--   ORDER BY nome;
--
-- Se a coluna administrativo não existir ainda, rode antes:
--   ALTER TABLE evento_tipos_inscricao ADD COLUMN IF NOT EXISTS administrativo boolean NOT NULL DEFAULT false;

-- ── 1. PASTOR PRESIDENTE ────────────────────────────────────────────────────
UPDATE evento_tipos_inscricao
SET valor = 470
WHERE ativo = true
  AND valor IS NULL
  AND lower(unaccent(nome)) LIKE '%pastor presidente%'
  AND lower(unaccent(nome)) NOT LIKE '%esposa%'
  AND lower(unaccent(nome)) NOT LIKE '%viuva%';

-- ── 2. PASTOR AUXILIAR ──────────────────────────────────────────────────────
UPDATE evento_tipos_inscricao
SET valor = 210
WHERE ativo = true
  AND valor IS NULL
  AND lower(unaccent(nome)) LIKE '%pastor auxiliar%'
  AND lower(unaccent(nome)) NOT LIKE '%esposa%'
  AND lower(unaccent(nome)) NOT LIKE '%viuva%';

-- ── 3. ESPOSA DE PASTOR PRESIDENTE (exceto Campo Missionário — valor vem da config) ─
UPDATE evento_tipos_inscricao
SET valor = 210
WHERE ativo = true
  AND valor IS NULL
  AND lower(unaccent(nome)) LIKE '%esposa%'
  AND lower(unaccent(nome)) LIKE '%pastor presidente%'
  AND lower(unaccent(nome)) NOT LIKE '%campo%'
  AND lower(unaccent(nome)) NOT LIKE '%mission%';

-- ── 4. ESPOSA DE PASTOR AUXILIAR ────────────────────────────────────────────
UPDATE evento_tipos_inscricao
SET valor = 130
WHERE ativo = true
  AND valor IS NULL
  AND lower(unaccent(nome)) LIKE '%esposa%'
  AND lower(unaccent(nome)) LIKE '%pastor auxiliar%';

-- ── 5. JUVENTUDE / COMIEADEPA ───────────────────────────────────────────────
UPDATE evento_tipos_inscricao
SET valor = 130
WHERE ativo = true
  AND valor IS NULL
  AND (
    lower(unaccent(nome)) LIKE '%juventude%'
    OR lower(unaccent(nome)) LIKE '%comieadepa%'
  );

-- ── 6. VISITANTE ────────────────────────────────────────────────────────────
UPDATE evento_tipos_inscricao
SET valor = 210
WHERE ativo = true
  AND valor IS NULL
  AND lower(unaccent(nome)) LIKE '%visitante%';

-- ── 7. PASTOR JUBILADO — gratuito (valor explícito 0, não NULL) ─────────────
UPDATE evento_tipos_inscricao
SET valor = 0
WHERE ativo = true
  AND valor IS NULL
  AND lower(unaccent(nome)) LIKE '%pastor jubilado%'
  AND lower(unaccent(nome)) NOT LIKE '%esposa%'
  AND lower(unaccent(nome)) NOT LIKE '%viuva%';

-- ── 8. VIÚVA ────────────────────────────────────────────────────────────────
UPDATE evento_tipos_inscricao
SET valor = 0
WHERE ativo = true
  AND valor IS NULL
  AND lower(unaccent(nome)) LIKE '%viuva%';

-- ── 9. ESPOSA DE PASTOR JUBILADO ────────────────────────────────────────────
UPDATE evento_tipos_inscricao
SET valor = 0
WHERE ativo = true
  AND valor IS NULL
  AND lower(unaccent(nome)) LIKE '%esposa%'
  AND lower(unaccent(nome)) LIKE '%pastor jubilado%';

-- ── 10. ESPOSA DE PASTOR PRESIDENTE CAMPO MISSIONÁRIO ───────────────────────
-- Valor vem de configuracoes_ago.campo_missionario.valor_esposa no runtime.
-- Definimos 0 como sentinela para não acionar o fallback do titular,
-- pois o backend sobrescreve com o valor da config em seguida.
UPDATE evento_tipos_inscricao
SET valor = 0
WHERE ativo = true
  AND valor IS NULL
  AND lower(unaccent(nome)) LIKE '%esposa%'
  AND lower(unaccent(nome)) LIKE '%pastor presidente%'
  AND (
    lower(unaccent(nome)) LIKE '%campo%'
    OR lower(unaccent(nome)) LIKE '%mission%'
  );

-- ── AUDITORIA PÓS-CORREÇÃO ──────────────────────────────────────────────────
-- Verificar se ainda restam tipos com valor NULL:
--
--   SELECT id, nome, valor, ativo, cortesia, administrativo
--   FROM evento_tipos_inscricao
--   WHERE ativo = true AND valor IS NULL
--   ORDER BY nome;
--
-- Resultado esperado: 0 linhas.
