-- ============================================================
-- MÓDULO HOSPEDAGEM AGO
-- Alojamentos, solicitações de hospedagem, campos AGO em inscrições
-- ============================================================

-- ── 1. Novas colunas em evento_inscricoes (campos AGO) ────────
ALTER TABLE evento_inscricoes
  ADD COLUMN IF NOT EXISTS hosp_necessidade_especial  boolean        NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS hosp_descricao_necessidade text           NULL,
  ADD COLUMN IF NOT EXISTS hosp_cama_inferior         boolean        NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS hosp_observacoes           text           NULL;

-- ── 2. Tabela: evento_alojamentos ────────────────────────────
CREATE TABLE IF NOT EXISTS evento_alojamentos (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  evento_id        uuid        NOT NULL REFERENCES eventos(id) ON DELETE CASCADE,
  nome             text        NOT NULL,
  publico          text        NOT NULL,
  -- feminino | presidentes | jubilados | masculino_geral | misto
  sexo             text        NULL,
  -- M | F | null (misto)
  total_vagas      integer     NOT NULL DEFAULT 0,
  camas_inferiores integer     NOT NULL DEFAULT 0,
  camas_superiores integer     NOT NULL DEFAULT 0,
  ativo            boolean     NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_evt_alojamentos_evento ON evento_alojamentos (evento_id);
ALTER TABLE evento_alojamentos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "alojamentos_select_public" ON evento_alojamentos FOR SELECT USING (true);
CREATE POLICY "alojamentos_write_service" ON evento_alojamentos USING (auth.role() = 'service_role');

-- ── 3. Tabela: evento_hospedagens ────────────────────────────
CREATE TABLE IF NOT EXISTS evento_hospedagens (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  evento_id             uuid        NOT NULL REFERENCES eventos(id) ON DELETE CASCADE,
  inscricao_id          uuid        NOT NULL REFERENCES evento_inscricoes(id) ON DELETE CASCADE,
  alojamento_id         uuid        NULL REFERENCES evento_alojamentos(id),
  status                text        NOT NULL DEFAULT 'solicitada'
                          CHECK (status IN ('solicitada','confirmada','lista_espera','recusada')),
  prioridade            integer     NOT NULL DEFAULT 0,
  necessidade_especial  boolean     NOT NULL DEFAULT false,
  descricao_necessidade text        NULL,
  cama_inferior         boolean     NOT NULL DEFAULT false,
  tipo_cama             text        NULL
                          CHECK (tipo_cama IN ('inferior','superior')),
  numero_cama           text        NULL,
  observacoes           text        NULL,
  alocacao_automatica   boolean     NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (inscricao_id)
);
CREATE INDEX IF NOT EXISTS idx_evt_hospedagens_evento      ON evento_hospedagens (evento_id);
CREATE INDEX IF NOT EXISTS idx_evt_hospedagens_alojamento  ON evento_hospedagens (alojamento_id);
CREATE INDEX IF NOT EXISTS idx_evt_hospedagens_status      ON evento_hospedagens (status);
ALTER TABLE evento_hospedagens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "hospedagens_select_service" ON evento_hospedagens FOR SELECT USING (auth.role() = 'service_role');
CREATE POLICY "hospedagens_write_service"  ON evento_hospedagens USING (auth.role() = 'service_role');

-- ── 4. View materializada para contagem de vagas ─────────────
-- Usada para verificar vagas disponíveis por alojamento em tempo real
CREATE OR REPLACE VIEW v_vagas_alojamento AS
SELECT
  a.id                                                          AS alojamento_id,
  a.evento_id,
  a.nome,
  a.publico,
  a.sexo,
  a.total_vagas,
  a.camas_inferiores,
  a.camas_superiores,
  COUNT(h.id) FILTER (WHERE h.status IN ('confirmada'))        AS ocupadas,
  COUNT(h.id) FILTER (WHERE h.tipo_cama = 'inferior' AND h.status = 'confirmada') AS inferiores_usadas,
  COUNT(h.id) FILTER (WHERE h.tipo_cama = 'superior' AND h.status = 'confirmada') AS superiores_usadas,
  a.total_vagas   - COUNT(h.id) FILTER (WHERE h.status = 'confirmada')            AS vagas_livres,
  a.camas_inferiores - COUNT(h.id) FILTER (WHERE h.tipo_cama = 'inferior' AND h.status = 'confirmada') AS inferiores_livres,
  a.camas_superiores - COUNT(h.id) FILTER (WHERE h.tipo_cama = 'superior' AND h.status = 'confirmada') AS superiores_livres
FROM evento_alojamentos a
LEFT JOIN evento_hospedagens h ON h.alojamento_id = a.id
GROUP BY a.id;
