-- ============================================================
-- AGO: Fechamento Operacional
-- ============================================================

-- 1. Coluna encerrado_em em eventos
ALTER TABLE eventos
  ADD COLUMN IF NOT EXISTS encerrado_em timestamptz NULL;

-- 2. Snapshot de dados ministeriais na inscrição
ALTER TABLE evento_inscricoes
  ADD COLUMN IF NOT EXISTS ministro_snapshot jsonb DEFAULT NULL;

-- 3. Atualiza constraint de status para incluir 'encerrado'
DO $$
BEGIN
  ALTER TABLE eventos DROP CONSTRAINT IF EXISTS eventos_status_check;
  ALTER TABLE eventos ADD CONSTRAINT eventos_status_check
    CHECK (status IN ('programado', 'realizado', 'cancelado', 'encerrado'));
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Nao foi possivel atualizar constraint de status: %', SQLERRM;
END $$;

-- 4. Tabela de frequência final consolidada
CREATE TABLE IF NOT EXISTS evento_ago_frequencia_final (
  id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  evento_id        uuid         NOT NULL REFERENCES eventos(id) ON DELETE CASCADE,
  inscricao_id     uuid         NOT NULL REFERENCES evento_inscricoes(id) ON DELETE CASCADE,
  ministro_id      text         NULL,
  nome             text         NOT NULL,
  categoria        text         NULL,
  campo            text         NULL,
  supervisao       text         NULL,
  total_plenarias  integer      NOT NULL DEFAULT 0,
  presencas        integer      NOT NULL DEFAULT 0,
  faltas           integer      NOT NULL DEFAULT 0,
  percentual_frequencia numeric(5,2) NOT NULL DEFAULT 0,
  created_at       timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (evento_id, inscricao_id)
);
ALTER TABLE evento_ago_frequencia_final ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_ago_freq_final_evento ON evento_ago_frequencia_final(evento_id);

-- 5. Tabela de ausentes gerada no encerramento
CREATE TABLE IF NOT EXISTS evento_ago_ausentes (
  id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  evento_id        uuid         NOT NULL REFERENCES eventos(id) ON DELETE CASCADE,
  inscricao_id     uuid         NOT NULL REFERENCES evento_inscricoes(id) ON DELETE CASCADE,
  nome             text         NOT NULL,
  cpf              text         NULL,
  campo            text         NULL,
  supervisao       text         NULL,
  categoria        text         NULL,
  percentual_frequencia numeric(5,2) NOT NULL DEFAULT 0,
  faltas           integer      NOT NULL DEFAULT 0,
  selecionado_para_advertencia boolean NOT NULL DEFAULT false,
  created_at       timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (evento_id, inscricao_id)
);
ALTER TABLE evento_ago_ausentes ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_ago_ausentes_evento ON evento_ago_ausentes(evento_id);
