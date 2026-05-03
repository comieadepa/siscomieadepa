-- Migration: Aumentar tamanho de colunas VARCHAR(20) que podem receber valores maiores
-- Data: 2026-04-30

ALTER TABLE public.members
  ALTER COLUMN phone      TYPE VARCHAR(50),
  ALTER COLUMN celular    TYPE VARCHAR(50),
  ALTER COLUMN whatsapp   TYPE VARCHAR(50),
  ALTER COLUMN rg         TYPE VARCHAR(50),
  ALTER COLUMN cpf        TYPE VARCHAR(30),
  ALTER COLUMN cep        TYPE VARCHAR(20);
