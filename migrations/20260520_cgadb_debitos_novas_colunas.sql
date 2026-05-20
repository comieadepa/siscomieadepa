-- Migração: novas colunas na tabela cgadb_debitos
-- Data: 2026-05-20

-- 1. Tornar cpf e nome nullable (importar linhas sem CPF)
ALTER TABLE public.cgadb_debitos
  ALTER COLUMN cpf DROP NOT NULL,
  ALTER COLUMN nome DROP NOT NULL;

-- 2. Adicionar colunas celular e email
ALTER TABLE public.cgadb_debitos
  ADD COLUMN IF NOT EXISTS celular text,
  ADD COLUMN IF NOT EXISTS email   text;
