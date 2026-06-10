-- Migration: Add categoria_registro to consagracao_registros table
ALTER TABLE public.consagracao_registros ADD COLUMN IF NOT EXISTS categoria_registro VARCHAR(100);
