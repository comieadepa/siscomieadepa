-- ============================================================
-- Migration: Notificações do Portal do Ministro
-- Data: 2026-06-15
-- Tabela: public.ministro_portal_notificacoes
-- ============================================================

-- 1. Criação da tabela de notificações do ministro
CREATE TABLE IF NOT EXISTS public.ministro_portal_notificacoes (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  ministro_id uuid        NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  tipo        text        NOT NULL
                          CHECK (tipo IN (
                            'credencial',
                            'financeiro',
                            'evento',
                            'comunicado'
                          )),
  titulo      text        NOT NULL,
  mensagem    text        NOT NULL,
  link_acao   text,
  lida        boolean     NOT NULL DEFAULT false,
  lida_em     timestamptz,
  canal       text        NOT NULL DEFAULT 'in_app'
                          CHECK (canal IN (
                            'in_app',
                            'email',
                            'ambos'
                          )),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- 2. Índices para consultas rápidas e filtragem por ministro / status de leitura
CREATE INDEX IF NOT EXISTS idx_min_notif_ministro_id      ON public.ministro_portal_notificacoes (ministro_id);
CREATE INDEX IF NOT EXISTS idx_min_notif_ministro_lida    ON public.ministro_portal_notificacoes (ministro_id, lida);
CREATE INDEX IF NOT EXISTS idx_min_notif_ministro_created ON public.ministro_portal_notificacoes (ministro_id, created_at DESC);

-- 3. Habilita Row Level Security (RLS)
ALTER TABLE public.ministro_portal_notificacoes ENABLE ROW LEVEL SECURITY;

-- 4. Políticas de Acesso
-- Service Role tem acesso irrestrito para inserção e gestão server-side
DROP POLICY IF EXISTS "min_notif_service_role_all" ON public.ministro_portal_notificacoes;
CREATE POLICY "min_notif_service_role_all"
  ON public.ministro_portal_notificacoes
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
