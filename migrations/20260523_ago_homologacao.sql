-- ============================================================
-- AGO: Homologação de Frequência
-- ============================================================

CREATE TABLE IF NOT EXISTS evento_ago_homologacao (
  id                       uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  evento_id                uuid         NOT NULL REFERENCES eventos(id) ON DELETE CASCADE,
  inscricao_id             uuid         NOT NULL REFERENCES evento_inscricoes(id) ON DELETE CASCADE,
  ministro_id              text         NULL,
  nome                     text         NOT NULL,
  matricula                text         NULL,
  campo                    text         NULL,
  supervisao               text         NULL,
  categoria                text         NULL,
  total_plenarias          integer      NOT NULL DEFAULT 0,
  presencas                integer      NOT NULL DEFAULT 0,
  faltas                   integer      NOT NULL DEFAULT 0,
  percentual_frequencia    numeric(5,2) NOT NULL DEFAULT 0,
  status                   text         NOT NULL DEFAULT 'pendente_analise',
  motivo_justificativa     text         NULL,
  observacao_justificativa text         NULL,
  usuario_responsavel_id   text         NULL,
  usuario_responsavel_nome text         NULL,
  homologado_em            timestamptz  NULL,
  historico_registrado     boolean      NOT NULL DEFAULT false,
  created_at               timestamptz  NOT NULL DEFAULT now(),
  updated_at               timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT ago_homologacao_status_check
    CHECK (status IN ('pendente_analise', 'regular', 'ausente', 'ausencia_justificada', 'dispensado')),
  UNIQUE (evento_id, inscricao_id)
);

ALTER TABLE evento_ago_homologacao ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_ago_homologacao_evento  ON evento_ago_homologacao(evento_id);
CREATE INDEX IF NOT EXISTS idx_ago_homologacao_status  ON evento_ago_homologacao(evento_id, status);
CREATE INDEX IF NOT EXISTS idx_ago_homologacao_ministro ON evento_ago_homologacao(ministro_id);

-- Adiciona matricula na tabela de frequencia_final (para lookups futuros)
ALTER TABLE evento_ago_frequencia_final ADD COLUMN IF NOT EXISTS matricula text NULL;
