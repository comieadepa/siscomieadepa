-- Migration: Colunas ministeriais restantes (cargo_ministerial, qual_funcao, etc.)
-- Data: 2026-04-30
-- Execute no Supabase SQL Editor

ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS cargo_ministerial        VARCHAR(100),
  ADD COLUMN IF NOT EXISTS qual_funcao              VARCHAR(255),
  ADD COLUMN IF NOT EXISTS setor_departamento       VARCHAR(255),
  ADD COLUMN IF NOT EXISTS observacoes_ministeriais TEXT,
  ADD COLUMN IF NOT EXISTS procedencia              VARCHAR(100),
  ADD COLUMN IF NOT EXISTS curso_teologico          VARCHAR(255),
  ADD COLUMN IF NOT EXISTS pastor_auxiliar          BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN public.members.cargo_ministerial        IS 'Cargo ministerial (Pastor, Evangelista, Diácono…)';
COMMENT ON COLUMN public.members.qual_funcao              IS 'Qual a função exercida';
COMMENT ON COLUMN public.members.setor_departamento       IS 'Setor/departamento';
COMMENT ON COLUMN public.members.observacoes_ministeriais IS 'Observações do cadastro ministerial/teologia';
COMMENT ON COLUMN public.members.procedencia              IS 'Procedência ministerial';
COMMENT ON COLUMN public.members.curso_teologico          IS 'Curso teológico cursado';
COMMENT ON COLUMN public.members.pastor_auxiliar          IS 'É pastor auxiliar (S/N)';

CREATE INDEX IF NOT EXISTS idx_members_cargo_ministerial ON public.members(cargo_ministerial);
