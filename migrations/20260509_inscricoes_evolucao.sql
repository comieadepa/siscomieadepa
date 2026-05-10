-- ============================================================
-- EVOLUÇÃO DE INSCRIÇÕES — Módulo Eventos
-- Tipos de inscrição, cupons, lotes, limites, brindes
-- ============================================================

-- ── 1. Novas colunas em `eventos` ────────────────────────────
ALTER TABLE eventos
  ADD COLUMN IF NOT EXISTS limite_hospedagem  integer   NULL,
  ADD COLUMN IF NOT EXISTS limite_brindes     integer   NULL;

-- ── 2. Novas colunas em `evento_inscricoes` ──────────────────
ALTER TABLE evento_inscricoes
  ADD COLUMN IF NOT EXISTS tipo_inscricao   text           NULL,
  ADD COLUMN IF NOT EXISTS valor_original   numeric(10,2)  NULL,
  ADD COLUMN IF NOT EXISTS cupom_codigo     text           NULL,
  ADD COLUMN IF NOT EXISTS desconto_valor   numeric(10,2)  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS valor_final      numeric(10,2)  NULL,
  ADD COLUMN IF NOT EXISTS direito_brinde   boolean        NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS lote_id         uuid           NULL;

-- ── 3. Tabela: evento_tipos_inscricao ────────────────────────
CREATE TABLE IF NOT EXISTS evento_tipos_inscricao (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  evento_id           uuid        NOT NULL REFERENCES eventos(id) ON DELETE CASCADE,
  nome                text        NOT NULL,
  valor               numeric(10,2) NOT NULL DEFAULT 0,
  inclui_alimentacao  boolean     NOT NULL DEFAULT false,
  inclui_hospedagem   boolean     NOT NULL DEFAULT false,
  ativo               boolean     NOT NULL DEFAULT true,
  ordem               smallint    NOT NULL DEFAULT 1,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_evt_tipos_evento ON evento_tipos_inscricao (evento_id);
ALTER TABLE evento_tipos_inscricao ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tipos_inscricao_select_public" ON evento_tipos_inscricao FOR SELECT USING (true);
CREATE POLICY "tipos_inscricao_write_service"  ON evento_tipos_inscricao USING (auth.role() = 'service_role');

-- ── 4. Tabela: evento_cupons ──────────────────────────────────
CREATE TABLE IF NOT EXISTS evento_cupons (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  evento_id     uuid        NOT NULL REFERENCES eventos(id) ON DELETE CASCADE,
  codigo        text        NOT NULL,
  tipo          text        NOT NULL CHECK (tipo IN ('percentual', 'valor_fixo')),
  valor         numeric(10,2) NOT NULL,
  limite_uso    integer     NULL,
  usados        integer     NOT NULL DEFAULT 0,
  ativo         boolean     NOT NULL DEFAULT true,
  validade      timestamptz NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (evento_id, codigo)
);
CREATE INDEX IF NOT EXISTS idx_evt_cupons_evento ON evento_cupons (evento_id);
ALTER TABLE evento_cupons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cupons_select_public" ON evento_cupons FOR SELECT USING (true);
CREATE POLICY "cupons_write_service"  ON evento_cupons USING (auth.role() = 'service_role');

-- ── 5. Tabela: evento_lotes_inscricao ────────────────────────
CREATE TABLE IF NOT EXISTS evento_lotes_inscricao (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  evento_id           uuid        NOT NULL REFERENCES eventos(id) ON DELETE CASCADE,
  codigo              text        NOT NULL UNIQUE,
  responsavel_nome    text        NOT NULL,
  responsavel_email   text        NULL,
  responsavel_whatsapp text       NULL,
  valor_total         numeric(10,2) NOT NULL DEFAULT 0,
  status_pagamento    text        NOT NULL DEFAULT 'pendente'
                        CHECK (status_pagamento IN ('pendente','pago','cancelado','isento')),
  asaas_payment_id    text        NULL,
  cupom_codigo        text        NULL,
  desconto_valor      numeric(10,2) NOT NULL DEFAULT 0,
  comprovante_url     text        NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_evt_lotes_evento ON evento_lotes_inscricao (evento_id);
ALTER TABLE evento_lotes_inscricao ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lotes_write_service"  ON evento_lotes_inscricao USING (auth.role() = 'service_role');

-- ── 6. FK de evento_inscricoes → lote ────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_inscricao_lote'
      AND conrelid = 'evento_inscricoes'::regclass
  ) THEN
    ALTER TABLE evento_inscricoes
      ADD CONSTRAINT fk_inscricao_lote
      FOREIGN KEY (lote_id) REFERENCES evento_lotes_inscricao(id) ON DELETE SET NULL;
  END IF;
END;
$$;

-- ── 7. Função: atribuir direito_brinde automaticamente ───────
CREATE OR REPLACE FUNCTION fn_atribuir_direito_brinde()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_limite   integer;
  v_usados   integer;
BEGIN
  -- Busca limite de brindes do evento
  SELECT limite_brindes INTO v_limite
  FROM eventos WHERE id = NEW.evento_id;

  IF v_limite IS NULL THEN
    -- Sem limite definido: todos têm direito
    NEW.direito_brinde := NEW.brinde;
    RETURN NEW;
  END IF;

  IF NOT NEW.brinde THEN
    NEW.direito_brinde := false;
    RETURN NEW;
  END IF;

  -- Conta quantos já têm direito ao brinde neste evento
  SELECT COUNT(*) INTO v_usados
  FROM evento_inscricoes
  WHERE evento_id = NEW.evento_id
    AND direito_brinde = true
    AND id != NEW.id;

  NEW.direito_brinde := (v_usados < v_limite);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_atribuir_brinde ON evento_inscricoes;
CREATE TRIGGER trg_atribuir_brinde
  BEFORE INSERT OR UPDATE OF brinde ON evento_inscricoes
  FOR EACH ROW EXECUTE FUNCTION fn_atribuir_direito_brinde();

-- ── 8. Função: ao pagar lote, atualiza todas as inscrições ──
CREATE OR REPLACE FUNCTION fn_sync_lote_pagamento()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status_pagamento IS DISTINCT FROM OLD.status_pagamento THEN
    UPDATE evento_inscricoes
    SET status_pagamento = NEW.status_pagamento,
        comprovante_url  = COALESCE(NEW.comprovante_url, comprovante_url)
    WHERE lote_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_lote ON evento_lotes_inscricao;
CREATE TRIGGER trg_sync_lote
  AFTER UPDATE OF status_pagamento ON evento_lotes_inscricao
  FOR EACH ROW EXECUTE FUNCTION fn_sync_lote_pagamento();
