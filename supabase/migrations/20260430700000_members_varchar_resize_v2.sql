-- Migration: Aumentar VARCHAR(20) nas colunas adicionadas em 20260430300000
-- Necessário após reverter mapeamentos cf→direct no importador CSV
-- Data: 2026-05-01

ALTER TABLE public.members
  ALTER COLUMN unique_id          TYPE VARCHAR(100),
  ALTER COLUMN numero             TYPE VARCHAR(50),
  ALTER COLUMN zona_eleitoral     TYPE VARCHAR(50),
  ALTER COLUMN secao_eleitoral    TYPE VARCHAR(50),
  ALTER COLUMN cpf_conjuge        TYPE VARCHAR(30),
  ALTER COLUMN tipo_sanguineo     TYPE VARCHAR(20);
