-- Migration: Ajuste na tabela evento_cupons e evento_inscricoes (Sprint 2)
-- Criado em: 2026-06-16

ALTER TABLE public.evento_cupons ADD COLUMN IF NOT EXISTS permite_acumular boolean NOT NULL DEFAULT false;
ALTER TABLE public.evento_inscricoes ADD COLUMN IF NOT EXISTS cupom_id uuid NULL REFERENCES public.evento_cupons(id) ON DELETE SET NULL;
