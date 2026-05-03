-- Migration: Renomear colunas members de inglês para português (archive não aplicado)
-- Data: 2026-04-30
-- Execute no Supabase SQL Editor
-- Usa DO blocks para não quebrar se já foram renomeadas

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='members' AND column_name='birth_date') THEN
    ALTER TABLE public.members RENAME COLUMN birth_date TO data_nascimento;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='members' AND column_name='gender') THEN
    ALTER TABLE public.members RENAME COLUMN gender TO sexo;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='members' AND column_name='address') THEN
    ALTER TABLE public.members RENAME COLUMN address TO logradouro;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='members' AND column_name='city') THEN
    ALTER TABLE public.members RENAME COLUMN city TO cidade;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='members' AND column_name='state') THEN
    ALTER TABLE public.members RENAME COLUMN state TO estado;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='members' AND column_name='zipcode') THEN
    ALTER TABLE public.members RENAME COLUMN zipcode TO cep;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='members' AND column_name='notes') THEN
    ALTER TABLE public.members RENAME COLUMN notes TO observacoes;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='members' AND column_name='occupation') THEN
    ALTER TABLE public.members RENAME COLUMN occupation TO profissao;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='members' AND column_name='complement') THEN
    ALTER TABLE public.members RENAME COLUMN complement TO complemento;
  END IF;
END $$;
