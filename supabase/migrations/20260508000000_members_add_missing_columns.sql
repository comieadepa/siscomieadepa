-- Migration: Adicionar colunas faltantes da tabela members
-- Campos usados no formulário mas ainda não criados no banco
-- Data: 2026-05-08

ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS instituicao_teologica VARCHAR(255),
  ADD COLUMN IF NOT EXISTS tem_funcao_igreja     BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN public.members.instituicao_teologica IS 'Instituição teológica onde cursou o seminário';
COMMENT ON COLUMN public.members.tem_funcao_igreja     IS 'Exerce alguma função na igreja (S/N)';
