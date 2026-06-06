CREATE TABLE IF NOT EXISTS public.evento_autoalocacao_locks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evento_id uuid NOT NULL REFERENCES public.eventos(id) ON DELETE CASCADE,
  operacao text NOT NULL DEFAULT 'hospedagem_autoalocacao',
  locked_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '5 minutes'),
  locked_by text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (evento_id, operacao)
);

CREATE INDEX IF NOT EXISTS idx_evento_autoalocacao_locks_expires
  ON public.evento_autoalocacao_locks (expires_at);
