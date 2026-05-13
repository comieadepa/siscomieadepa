-- Adiciona colunas de convite/acesso à tabela evento_equipe
-- Necessário para o fluxo de convite por link da equipe do evento

ALTER TABLE public.evento_equipe
  ADD COLUMN IF NOT EXISTS convite_token      text,
  ADD COLUMN IF NOT EXISTS convite_expira_em  timestamptz,
  ADD COLUMN IF NOT EXISTS convite_usado_em   timestamptz,
  ADD COLUMN IF NOT EXISTS ultimo_acesso_em   timestamptz;

-- Index para lookup rápido por token (usado na validação do convite)
CREATE INDEX IF NOT EXISTS idx_evento_equipe_convite_token
  ON public.evento_equipe (convite_token)
  WHERE convite_token IS NOT NULL;
