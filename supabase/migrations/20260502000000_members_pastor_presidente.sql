-- Migration: Adiciona coluna pastor_presidente na tabela members
-- Data: 2026-05-02

ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS pastor_presidente BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN public.members.pastor_presidente IS 'É pastor presidente (S/N)';
