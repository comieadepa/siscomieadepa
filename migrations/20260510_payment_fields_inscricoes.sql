-- ============================================================
-- Adiciona campos de pagamento ASAAS a evento_inscricoes e
-- evento_lotes_inscricao para segunda via sem consultar a API.
-- ============================================================

-- ── evento_inscricoes ─────────────────────────────────────────
ALTER TABLE evento_inscricoes
  ADD COLUMN IF NOT EXISTS invoice_url    text        NULL,
  ADD COLUMN IF NOT EXISTS pix_copia_cola text        NULL,
  ADD COLUMN IF NOT EXISTS pix_qr_code    text        NULL,
  ADD COLUMN IF NOT EXISTS asaas_due_date date        NULL;

-- ── evento_lotes_inscricao ────────────────────────────────────
ALTER TABLE evento_lotes_inscricao
  ADD COLUMN IF NOT EXISTS invoice_url    text        NULL,
  ADD COLUMN IF NOT EXISTS pix_copia_cola text        NULL,
  ADD COLUMN IF NOT EXISTS pix_qr_code    text        NULL,
  ADD COLUMN IF NOT EXISTS asaas_due_date date        NULL;
