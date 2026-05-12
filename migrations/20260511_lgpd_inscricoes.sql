-- Adiciona campos LGPD nas inscricoes
ALTER TABLE public.evento_inscricoes
  ADD COLUMN IF NOT EXISTS lgpd_aceito boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS lgpd_aceito_em timestamptz;
