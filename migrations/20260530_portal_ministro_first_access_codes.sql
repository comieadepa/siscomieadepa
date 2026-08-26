-- ============================================================
-- Migration: Portal do Ministro - Códigos de 1º Acesso (2FA OTP)
-- Data: 2026-05-30
-- ============================================================

CREATE TABLE IF NOT EXISTS public.ministro_portal_first_access_codes (
  id           uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  ministro_id  uuid        NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  codigo       text        NOT NULL,
  canal        text        NOT NULL CHECK (canal IN ('email', 'whatsapp')),
  destino      text        NOT NULL,
  tentativas   integer     NOT NULL DEFAULT 0,
  used         boolean     NOT NULL DEFAULT false,
  used_at      timestamptz,
  expires_at   timestamptz NOT NULL,
  ip_requested text,
  created_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ministro_fa_codes_ministro ON public.ministro_portal_first_access_codes (ministro_id);
CREATE INDEX IF NOT EXISTS idx_ministro_fa_codes_codigo   ON public.ministro_portal_first_access_codes (codigo);

ALTER TABLE public.ministro_portal_first_access_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ministro_fa_codes_service_only"
  ON public.ministro_portal_first_access_codes
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);
