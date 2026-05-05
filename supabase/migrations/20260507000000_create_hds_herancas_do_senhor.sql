-- Migration: Criar tabela HDS (Heranças do Senhor)
-- Todos os filhos de pastores são cadastrados aqui.
-- A tabela juventude_comieadepa recebe apenas os que têm 12–32 anos e não constam em members.
-- Data: 2026-05-07

-- ── 1. Tabela HDS ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.hds (
  id              uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  membro_id       uuid        NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  ministry_id     uuid,
  nome            text        NOT NULL,
  sexo            text        CHECK (sexo IN ('MASCULINO','FEMININO')),
  data_nascimento date        NOT NULL,  -- obrigatório para calcular elegibilidade juventude
  cpf             text,
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hds_membro_id ON public.hds(membro_id);

-- RLS
ALTER TABLE public.hds ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can manage hds" ON public.hds;
CREATE POLICY "Authenticated users can manage hds"
  ON public.hds
  FOR ALL
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- ── 2. Adicionar FK em juventude_comieadepa apontando para hds ───────────────
-- Quando o registro HDS for deletado, a entrada em juventude_comieadepa
-- é deletada em cascata automaticamente.
ALTER TABLE public.juventude_comieadepa
  ADD COLUMN IF NOT EXISTS hds_id uuid REFERENCES public.hds(id) ON DELETE CASCADE;

-- Nota: data_nascimento em juventude_comieadepa é validada no nível da aplicação
-- (obrigatória para calcular elegibilidade 12-32 anos), mas não como NOT NULL
-- no banco para preservar registros históricos existentes.
