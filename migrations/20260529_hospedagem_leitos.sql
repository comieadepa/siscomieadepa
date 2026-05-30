-- Fase 6 — Controle individual de leitos AGO
-- Aplique no SQL Editor do Supabase após 20260529_grupo_hospedagem.sql

CREATE TABLE IF NOT EXISTS evento_hospedagem_leitos (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  evento_id     uuid        NOT NULL REFERENCES eventos(id)            ON DELETE CASCADE,
  alojamento_id uuid        NOT NULL REFERENCES evento_alojamentos(id) ON DELETE CASCADE,
  inscricao_id  uuid        REFERENCES evento_inscricoes(id)           ON DELETE SET NULL,
  numero        text        NOT NULL,
  tipo_leito    text        NOT NULL DEFAULT 'beliche'
                  CHECK (tipo_leito IN ('beliche', 'colchonete', 'rede', 'cama')),
  posicao       text        NOT NULL DEFAULT 'unico'
                  CHECK (posicao IN ('superior', 'inferior', 'unico')),
  ocupado       boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (inscricao_id)
);

CREATE INDEX IF NOT EXISTS idx_hospedagem_leitos_evento
  ON evento_hospedagem_leitos (evento_id);
CREATE INDEX IF NOT EXISTS idx_hospedagem_leitos_alojamento
  ON evento_hospedagem_leitos (alojamento_id);

COMMENT ON TABLE evento_hospedagem_leitos
  IS 'Controle de leitos individuais de hospedagem AGO. Um registro por inscrição confirmada.';
