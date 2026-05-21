-- ============================================================
-- Migration: AGO alimentacao, controle de refeicoes e plenarias
-- ============================================================

-- 1. Quantidade de refeicoes por tipo de inscricao
ALTER TABLE evento_tipos_inscricao
  ADD COLUMN IF NOT EXISTS quantidade_refeicoes integer NOT NULL DEFAULT 0;

-- 2. Saldo de refeicoes por inscricao
ALTER TABLE evento_inscricoes
  ADD COLUMN IF NOT EXISTS refeicoes_total    integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS refeicoes_utilizadas integer NOT NULL DEFAULT 0;

-- 3. Tipo de check-in e campos auxiliares em evento_checkins
ALTER TABLE evento_checkins
  ADD COLUMN IF NOT EXISTS tipo_checkin  text    NOT NULL DEFAULT 'credenciamento',
  ADD COLUMN IF NOT EXISTS saldo_antes   integer NULL,
  ADD COLUMN IF NOT EXISTS saldo_depois  integer NULL,
  ADD COLUMN IF NOT EXISTS data_plenaria date    NULL,
  ADD COLUMN IF NOT EXISTS observacao    text    NULL,
  ADD COLUMN IF NOT EXISTS checkin_user  text    NULL;

-- Constraint de tipo (seguro de re-aplicar)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'evento_checkins_tipo_chk'
  ) THEN
    ALTER TABLE evento_checkins
      ADD CONSTRAINT evento_checkins_tipo_chk
      CHECK (tipo_checkin IN ('credenciamento', 'plenaria', 'refeitorio'));
  END IF;
END $$;

-- 4. Indice unico: impede presenca duplicada na mesma plenaria
CREATE UNIQUE INDEX IF NOT EXISTS idx_checkins_plenaria_unica
  ON evento_checkins (inscricao_id, data_plenaria)
  WHERE tipo_checkin = 'plenaria' AND data_plenaria IS NOT NULL;

-- 5. Indice para consultas de refeitorio
CREATE INDEX IF NOT EXISTS idx_checkins_refeitorio
  ON evento_checkins (evento_id, inscricao_id)
  WHERE tipo_checkin = 'refeitorio';

-- 6. Tabela de cartas de advertencia AGO
CREATE TABLE IF NOT EXISTS ago_cartas_advertencia (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  evento_id    uuid        NOT NULL REFERENCES eventos(id) ON DELETE CASCADE,
  inscricao_id uuid        NOT NULL REFERENCES evento_inscricoes(id) ON DELETE CASCADE,
  ministro_id  uuid        NULL,
  motivo       text        NOT NULL DEFAULT '',
  texto_final  text        NOT NULL DEFAULT '',
  status       text        NOT NULL DEFAULT 'rascunho',
  enviado_para text        NULL,
  enviado_em   timestamptz NULL,
  criado_por   uuid        NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ago_cartas_status_chk CHECK (status IN ('rascunho', 'enviada', 'cancelada'))
);

CREATE INDEX IF NOT EXISTS idx_ago_cartas_evento    ON ago_cartas_advertencia(evento_id);
CREATE INDEX IF NOT EXISTS idx_ago_cartas_inscricao ON ago_cartas_advertencia(inscricao_id);

ALTER TABLE ago_cartas_advertencia ENABLE ROW LEVEL SECURITY;
