-- Migration: Adiciona a coluna tipo_inscricao_avulso na tabela eventos
-- Permite configurar a modalidade de inscricao de eventos avulsos: individual, casal ou individual_casal.

ALTER TABLE public.eventos
ADD COLUMN IF NOT EXISTS tipo_inscricao_avulso TEXT NOT NULL DEFAULT 'individual';

-- Adiciona a restricao CHECK para garantir apenas os valores permitidos
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'check_eventos_tipo_inscricao_avulso'
  ) THEN
    ALTER TABLE public.eventos
    ADD CONSTRAINT check_eventos_tipo_inscricao_avulso
    CHECK (tipo_inscricao_avulso IN ('individual', 'casal', 'individual_casal'));
  END IF;
END $$;
