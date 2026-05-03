-- Migration: Adicionar UNIQUE constraint no CPF da tabela members
-- Necessário para o upsert ON CONFLICT (cpf) funcionar na importação
-- Data: 2026-04-30

-- Remove duplicatas de CPF mantendo o registro mais antigo (menor created_at)
DELETE FROM public.members
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY cpf ORDER BY created_at ASC) AS rn
    FROM public.members
    WHERE cpf IS NOT NULL AND cpf <> ''
  ) t
  WHERE rn > 1
);

-- Cria o índice único (permite NULL — ministros sem CPF ainda podem existir)
CREATE UNIQUE INDEX IF NOT EXISTS idx_members_cpf_unique
  ON public.members (cpf)
  WHERE cpf IS NOT NULL AND cpf <> '';
