-- ============================================================
-- FASE 7 — Check-in, Ocupação Real e Operação dos Alojamentos
-- ============================================================

-- 1. Novos campos em evento_hospedagens
ALTER TABLE evento_hospedagens
  ADD COLUMN IF NOT EXISTS checkin_at        timestamptz,
  ADD COLUMN IF NOT EXISTS checkout_at       timestamptz,
  ADD COLUMN IF NOT EXISTS checkin_operador  text,
  ADD COLUMN IF NOT EXISTS checkout_operador text;

-- 2. Atualizar constraint de status (novos valores)
ALTER TABLE evento_hospedagens
  DROP CONSTRAINT IF EXISTS evento_hospedagens_status_check;

ALTER TABLE evento_hospedagens
  ADD CONSTRAINT evento_hospedagens_status_check
  CHECK (status IN (
    'solicitada',
    'alocada',
    'confirmada',
    'checkin_realizado',
    'checkout_realizado',
    'lista_espera',
    'cancelada'
  ));

-- 3. Tabela de ocorrências de hospedagem
CREATE TABLE IF NOT EXISTS evento_hospedagem_ocorrencias (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  evento_id     uuid        NOT NULL REFERENCES eventos(id)            ON DELETE CASCADE,
  hospedagem_id uuid        NOT NULL REFERENCES evento_hospedagens(id) ON DELETE CASCADE,
  inscricao_id  uuid                 REFERENCES evento_inscricoes(id)  ON DELETE SET NULL,
  tipo          text        NOT NULL
    CHECK (tipo IN (
      'mudanca_leito',
      'mudanca_alojamento',
      'atendimento_medico',
      'dano_patrimonio',
      'observacao_geral'
    )),
  descricao     text,
  operador      text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hosp_ocorr_evento     ON evento_hospedagem_ocorrencias (evento_id);
CREATE INDEX IF NOT EXISTS idx_hosp_ocorr_hospedagem ON evento_hospedagem_ocorrencias (hospedagem_id);
CREATE INDEX IF NOT EXISTS idx_hosp_ocorr_inscricao  ON evento_hospedagem_ocorrencias (inscricao_id);
