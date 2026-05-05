-- Migration: Criar tabela de registro de filhos (Juventude COMIEADEPA)
-- Data: 2026-05-06

CREATE TABLE IF NOT EXISTS public.juventude_comieadepa (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  membro_id   uuid        NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  ministry_id uuid,
  nome        text        NOT NULL,
  sexo        text,
  data_nascimento date,
  cpf         text,
  created_at  timestamptz DEFAULT now()
);

-- Índice para buscar por membro
CREATE INDEX IF NOT EXISTS idx_juventude_membro_id ON public.juventude_comieadepa(membro_id);

-- RLS
ALTER TABLE public.juventude_comieadepa ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can manage juventude" ON public.juventude_comieadepa;
CREATE POLICY "Authenticated users can manage juventude"
  ON public.juventude_comieadepa
  FOR ALL
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);
