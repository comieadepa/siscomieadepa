-- ============================================================
-- Migration: Portal do Ministro - Recuperação de Senha
-- Data: 2026-05-29
-- ============================================================

CREATE TABLE IF NOT EXISTS public.ministro_portal_password_resets (
  id           uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  ministro_id  uuid        NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  token        text        NOT NULL UNIQUE,
  expires_at   timestamptz NOT NULL,
  used         boolean     NOT NULL DEFAULT false,
  used_at      timestamptz,
  ip_requested text,
  created_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ministro_pw_reset_token    ON public.ministro_portal_password_resets (token);
CREATE INDEX IF NOT EXISTS idx_ministro_pw_reset_ministro ON public.ministro_portal_password_resets (ministro_id);

ALTER TABLE public.ministro_portal_password_resets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ministro_pw_resets_service_only"
  ON public.ministro_portal_password_resets
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);
