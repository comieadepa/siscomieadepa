-- ============================================================
-- Adiciona campos de suporte do evento à tabela eventos.
-- Usados na página pública, IA e comunicação.
-- ============================================================

ALTER TABLE eventos
  ADD COLUMN IF NOT EXISTS suporte_nome      text NULL,
  ADD COLUMN IF NOT EXISTS suporte_whatsapp  text NULL;
