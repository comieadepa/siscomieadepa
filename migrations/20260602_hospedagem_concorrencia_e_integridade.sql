-- ============================================================
-- HOSPEDAGEM AGO: PROTECAO DE CONCORRENCIA E INTEGRIDADE
-- ============================================================

-- 1) Lock de autoalocacao por evento (mutex no banco)
CREATE TABLE IF NOT EXISTS evento_autoalocacao_locks (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  evento_id    uuid        NOT NULL REFERENCES eventos(id) ON DELETE CASCADE,
  tipo         text        NOT NULL DEFAULT 'autoalocacao_hospedagem',
  owner_token  text        NOT NULL,
  expires_at   timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (evento_id, tipo)
);

CREATE INDEX IF NOT EXISTS idx_autoaloc_locks_expires
  ON evento_autoalocacao_locks (expires_at);

COMMENT ON TABLE evento_autoalocacao_locks
  IS 'Mutex de autoalocacao por evento para evitar execucoes concorrentes.';

-- 2) Garantir unicidade de leito ocupado (inclui posicao)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM evento_hospedagem_leitos
    WHERE ocupado = true
    GROUP BY evento_id, alojamento_id, numero, posicao
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Nao foi possivel criar unicidade de leito: existem duplicidades ativas em evento_hospedagem_leitos.';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_hospedagem_leito_ocupado_unico
  ON evento_hospedagem_leitos (evento_id, alojamento_id, numero, posicao)
  WHERE ocupado = true;

-- 3) Garantir uma hospedagem por inscricao (regra atual)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'ux_evento_hospedagens_inscricao_unica'
  ) THEN
    CREATE UNIQUE INDEX ux_evento_hospedagens_inscricao_unica
      ON evento_hospedagens (inscricao_id);
  END IF;
END $$;
