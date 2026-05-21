-- ============================================================
-- AGO: Deliberações Oficiais
-- ============================================================

CREATE TABLE IF NOT EXISTS evento_ago_deliberacoes (
  id                    uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  evento_id             uuid         NOT NULL REFERENCES eventos(id) ON DELETE CASCADE,
  -- Ministro envolvido (pode ser externo, sem registro em members)
  ministro_id           text         NULL,
  ministro_nome         text         NOT NULL,
  ministro_matricula    text         NULL,
  ministro_campo        text         NULL,
  ministro_supervisao   text         NULL,
  -- Tipo e data
  tipo                  text         NOT NULL,
  data_deliberacao      date         NULL,
  -- Situações antes/depois
  situacao_anterior     text         NULL,
  situacao_nova         text         NULL,
  -- Metadados
  observacao            text         NULL,
  numero_ata            text         NULL,
  -- Fluxo de aprovação
  status                text         NOT NULL DEFAULT 'rascunho',
  aprovado_em           timestamptz  NULL,
  aprovado_por_id       text         NULL,
  aprovado_por_nome     text         NULL,
  aplicado_em           timestamptz  NULL,
  aplicado_por_id       text         NULL,
  aplicado_por_nome     text         NULL,
  -- Auditoria de criação
  created_by_id         text         NULL,
  created_by_nome       text         NULL,
  created_at            timestamptz  NOT NULL DEFAULT now(),
  updated_at            timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT deliberacao_status_check
    CHECK (status IN ('rascunho', 'aprovado', 'aplicado')),
  CONSTRAINT deliberacao_tipo_check
    CHECK (tipo IN (
      'consagracao',
      'ordenacao',
      'separacao_ministerio',
      'recebimento',
      'transferencia',
      'jubilacao',
      'mudanca_cargo',
      'aprovacao_candidato',
      'exclusao',
      'observacao_geral'
    ))
);

ALTER TABLE evento_ago_deliberacoes ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_ago_deliberacoes_evento  ON evento_ago_deliberacoes(evento_id);
CREATE INDEX IF NOT EXISTS idx_ago_deliberacoes_tipo    ON evento_ago_deliberacoes(evento_id, tipo);
CREATE INDEX IF NOT EXISTS idx_ago_deliberacoes_status  ON evento_ago_deliberacoes(evento_id, status);
CREATE INDEX IF NOT EXISTS idx_ago_deliberacoes_ministro ON evento_ago_deliberacoes(ministro_id);
