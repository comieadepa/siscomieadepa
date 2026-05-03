-- Migration: Todas as colunas do archive possivelmente não aplicadas
-- Data: 2026-04-30
-- Execute no Supabase SQL Editor

ALTER TABLE public.members
  -- Contato
  ADD COLUMN IF NOT EXISTS celular                   VARCHAR(20),

  -- Dados pessoais adicionais
  ADD COLUMN IF NOT EXISTS tipo_sanguineo            VARCHAR(10),
  ADD COLUMN IF NOT EXISTS unique_id                 VARCHAR(20),
  ADD COLUMN IF NOT EXISTS uf_naturalidade           CHAR(2),

  -- Endereço adicional
  ADD COLUMN IF NOT EXISTS numero                    VARCHAR(20),

  -- Eleitoral
  ADD COLUMN IF NOT EXISTS titulo_eleitoral          VARCHAR(50),
  ADD COLUMN IF NOT EXISTS zona_eleitoral            VARCHAR(20),
  ADD COLUMN IF NOT EXISTS secao_eleitoral           VARCHAR(20),

  -- Vida espiritual
  ADD COLUMN IF NOT EXISTS data_batismo_aguas        DATE,
  ADD COLUMN IF NOT EXISTS data_batismo_espirito_santo DATE,

  -- Cônjuge
  ADD COLUMN IF NOT EXISTS nome_conjuge              VARCHAR(255),
  ADD COLUMN IF NOT EXISTS cpf_conjuge               VARCHAR(20),
  ADD COLUMN IF NOT EXISTS data_nascimento_conjuge   DATE,

  -- Ministerial
  ADD COLUMN IF NOT EXISTS procedencia_local         VARCHAR(255);
