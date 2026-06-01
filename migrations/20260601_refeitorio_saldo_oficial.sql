-- Regra oficial de alimentacao por categoria + trilha de consumo de refeitorio

-- 1) Colunas oficiais de saldo de refeicoes na inscricao
ALTER TABLE public.evento_inscricoes
  ADD COLUMN IF NOT EXISTS quantidade_refeicoes_total integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS quantidade_refeicoes_usadas integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS quantidade_refeicoes_saldo integer NOT NULL DEFAULT 0;

-- Backfill a partir das colunas legadas (quando existirem)
UPDATE public.evento_inscricoes
SET
  quantidade_refeicoes_total = COALESCE(refeicoes_total, 0),
  quantidade_refeicoes_usadas = COALESCE(refeicoes_utilizadas, 0),
  quantidade_refeicoes_saldo = GREATEST(0, COALESCE(refeicoes_total, 0) - COALESCE(refeicoes_utilizadas, 0))
WHERE
  COALESCE(quantidade_refeicoes_total, 0) = 0
  AND COALESCE(quantidade_refeicoes_usadas, 0) = 0
  AND COALESCE(quantidade_refeicoes_saldo, 0) = 0;

ALTER TABLE public.evento_inscricoes
  DROP CONSTRAINT IF EXISTS evento_inscricoes_refeicoes_nao_negativas_chk;

ALTER TABLE public.evento_inscricoes
  ADD CONSTRAINT evento_inscricoes_refeicoes_nao_negativas_chk
  CHECK (
    quantidade_refeicoes_total >= 0
    AND quantidade_refeicoes_usadas >= 0
    AND quantidade_refeicoes_saldo >= 0
    AND quantidade_refeicoes_usadas <= quantidade_refeicoes_total
    AND quantidade_refeicoes_saldo <= quantidade_refeicoes_total
  );

CREATE INDEX IF NOT EXISTS idx_evento_inscricoes_refeicoes_saldo
  ON public.evento_inscricoes (evento_id, quantidade_refeicoes_saldo);

ALTER TABLE public.evento_checkins
  ADD COLUMN IF NOT EXISTS sessao text NULL;

-- 2) Historico de consumo de refeicoes
CREATE TABLE IF NOT EXISTS public.evento_refeicoes_consumo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evento_id uuid NOT NULL REFERENCES public.eventos(id) ON DELETE CASCADE,
  inscricao_id uuid NOT NULL REFERENCES public.evento_inscricoes(id) ON DELETE CASCADE,
  qr_code text NULL,
  tipo_consumo text NOT NULL DEFAULT 'refeicao',
  data_hora timestamptz NOT NULL DEFAULT now(),
  operador_id uuid NULL,
  origem text NOT NULL DEFAULT 'refeitorio',
  saldo_antes integer NOT NULL DEFAULT 0,
  saldo_depois integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT evento_refeicoes_consumo_tipo_chk CHECK (tipo_consumo IN ('refeicao')),
  CONSTRAINT evento_refeicoes_consumo_origem_chk CHECK (origem IN ('refeitorio')),
  CONSTRAINT evento_refeicoes_consumo_saldos_chk CHECK (saldo_antes >= 0 AND saldo_depois >= 0)
);

CREATE INDEX IF NOT EXISTS idx_refeicoes_consumo_evento_data
  ON public.evento_refeicoes_consumo (evento_id, data_hora DESC);

CREATE INDEX IF NOT EXISTS idx_refeicoes_consumo_inscricao_data
  ON public.evento_refeicoes_consumo (inscricao_id, data_hora DESC);

-- 3) Prepara RBAC para area/perfil de refeitorio
ALTER TABLE public.evento_equipe
  DROP CONSTRAINT IF EXISTS evento_equipe_tipo_check;

ALTER TABLE public.evento_equipe
  ADD CONSTRAINT evento_equipe_tipo_check
  CHECK (tipo IN ('operador', 'checkin', 'hospedagem', 'checkin_hospedagem', 'checkin_refeitorio'));

ALTER TABLE public.usuario_eventos
  DROP CONSTRAINT IF EXISTS usuario_eventos_permissao_check;

ALTER TABLE public.usuario_eventos
  ADD CONSTRAINT usuario_eventos_permissao_check
  CHECK (permissao IN ('admin_evento', 'operador', 'checkin', 'hospedagem', 'checkin_hospedagem', 'checkin_refeitorio'));
