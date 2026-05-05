-- Migration: Aumentar tamanho de colunas VARCHAR(20) que podem receber valores maiores
-- Data: 2026-04-30
-- Nota: view employees_with_member_info depende de phone; precisa ser dropada e recriada

DROP VIEW IF EXISTS public.employees_with_member_info;

ALTER TABLE public.members
  ALTER COLUMN phone      TYPE VARCHAR(50),
  ALTER COLUMN celular    TYPE VARCHAR(50),
  ALTER COLUMN whatsapp   TYPE VARCHAR(50),
  ALTER COLUMN rg         TYPE VARCHAR(50),
  ALTER COLUMN cpf        TYPE VARCHAR(30),
  ALTER COLUMN cep        TYPE VARCHAR(20);

CREATE OR REPLACE VIEW public.employees_with_member_info AS
SELECT
  e.id, e.member_id, e.grupo, e.funcao, e.data_admissao,
  e.email, e.telefone, e.whatsapp, e.rg,
  e.endereco, e.cep, e.bairro, e.cidade, e.uf,
  e.banco, e.agencia, e.conta_corrente, e.pix,
  e.obs, e.status, e.created_at, e.updated_at,
  m.name AS member_name,
  m.cpf AS member_cpf,
  m.phone AS member_phone,
  m.data_nascimento AS member_birth_date
FROM public.employees e
LEFT JOIN public.members m ON e.member_id = m.id;
