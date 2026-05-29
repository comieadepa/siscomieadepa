-- ============================================================
-- Migration: Portal do Ministro
-- Criado em: 2026-05-27
-- ============================================================

-- 1. Sessões do portal do ministro (auth por CPF + data_nascimento)
CREATE TABLE IF NOT EXISTS public.ministro_portal_sessions (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  ministro_id uuid        NOT NULL,
  token       uuid        DEFAULT gen_random_uuid() UNIQUE NOT NULL,
  expires_at  timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ministro_sessions_token       ON public.ministro_portal_sessions (token);
CREATE INDEX IF NOT EXISTS idx_ministro_sessions_ministro_id ON public.ministro_portal_sessions (ministro_id);
CREATE INDEX IF NOT EXISTS idx_ministro_sessions_expires_at  ON public.ministro_portal_sessions (expires_at);

-- RLS — acesso apenas via service role (API routes)
ALTER TABLE public.ministro_portal_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ministro_sessions_service_only"
  ON public.ministro_portal_sessions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 2. Solicitações de impressão de credencial
CREATE TABLE IF NOT EXISTS public.credencial_impressoes_solicitacoes (
  id                  uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  ministro_id         uuid        NOT NULL,
  asaas_payment_id    text,
  asaas_customer_id   text,
  valor_centavos      integer     NOT NULL DEFAULT 2000,
  status              text        NOT NULL DEFAULT 'aguardando_pagamento'
                      CHECK (status IN (
                        'aguardando_pagamento',
                        'pago_pendente_impressao',
                        'impresso',
                        'entregue',
                        'cancelado'
                      )),
  solicitado_em       timestamptz DEFAULT now(),
  pago_em             timestamptz,
  impresso_em         timestamptz,
  entregue_em         timestamptz,
  cancelado_em        timestamptz,
  observacoes         text,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cred_impr_ministro_id ON public.credencial_impressoes_solicitacoes (ministro_id);
CREATE INDEX IF NOT EXISTS idx_cred_impr_status      ON public.credencial_impressoes_solicitacoes (status);
CREATE INDEX IF NOT EXISTS idx_cred_impr_payment     ON public.credencial_impressoes_solicitacoes (asaas_payment_id);

ALTER TABLE public.credencial_impressoes_solicitacoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cred_impr_service_only"
  ON public.credencial_impressoes_solicitacoes
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Trigger para atualizar updated_at
CREATE OR REPLACE FUNCTION public.update_cred_impr_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cred_impr_updated_at ON public.credencial_impressoes_solicitacoes;
CREATE TRIGGER trg_cred_impr_updated_at
  BEFORE UPDATE ON public.credencial_impressoes_solicitacoes
  FOR EACH ROW EXECUTE FUNCTION public.update_cred_impr_updated_at();

-- 3. Configuração de vídeo (Palavra do Presidente)
CREATE TABLE IF NOT EXISTS public.portal_video_config (
  id          serial      PRIMARY KEY,
  titulo      text        NOT NULL DEFAULT 'Palavra do Presidente',
  descricao   text,
  url_video   text,
  ativo       boolean     NOT NULL DEFAULT true,
  updated_at  timestamptz DEFAULT now(),
  updated_by  text
);

-- Garantir apenas 1 registro de configuração
CREATE UNIQUE INDEX IF NOT EXISTS portal_video_config_singleton ON public.portal_video_config ((true));

ALTER TABLE public.portal_video_config ENABLE ROW LEVEL SECURITY;

-- Leitura pública (portal ministro chama via service role, ok)
CREATE POLICY "video_config_select"
  ON public.portal_video_config
  FOR SELECT
  TO service_role
  USING (true);

CREATE POLICY "video_config_all_service"
  ON public.portal_video_config
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Inserir configuração padrão
INSERT INTO public.portal_video_config (titulo, descricao, url_video, ativo)
VALUES ('Palavra do Presidente', null, null, false)
ON CONFLICT DO NOTHING;

-- Limpeza de sessões expiradas (pode ser chamada por cron ou job)
CREATE OR REPLACE FUNCTION public.cleanup_ministro_sessions()
RETURNS void LANGUAGE sql AS $$
  DELETE FROM public.ministro_portal_sessions WHERE expires_at < now();
$$;
