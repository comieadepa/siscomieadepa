-- ============================================================
-- Migration: Comunicados Oficiais da Convenção
-- Data: 2026-08-27
-- Tabela: public.comunicados
-- ============================================================

-- 1. Criação da tabela matriz de comunicados
CREATE TABLE IF NOT EXISTS public.comunicados (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo        text        NOT NULL,
  mensagem      text        NOT NULL,
  link_acao     text,
  canal         text        NOT NULL DEFAULT 'in_app'
                            CHECK (canal IN ('in_app', 'email', 'ambos')),
  publico_tipo  text        NOT NULL DEFAULT 'todos'
                            CHECK (publico_tipo IN (
                              'todos',
                              'pastores_presidentes',
                              'supervisao',
                              'campo',
                              'cargo'
                            )),
  supervisao_id uuid        REFERENCES public.supervisoes(id) ON DELETE SET NULL,
  campo_id      uuid        REFERENCES public.campos(id) ON DELETE SET NULL,
  cargo_alvo    text,
  autor_id      uuid        REFERENCES public.users(id) ON DELETE SET NULL,
  enviado_em    timestamptz NOT NULL DEFAULT now(),
  total_alvos   integer     NOT NULL DEFAULT 0
);

-- 2. Índices para consultas de histórico, filtragem por público e ordenação temporal
CREATE INDEX IF NOT EXISTS idx_comunicados_publico_tipo  ON public.comunicados (publico_tipo);
CREATE INDEX IF NOT EXISTS idx_comunicados_supervisao_id ON public.comunicados (supervisao_id);
CREATE INDEX IF NOT EXISTS idx_comunicados_campo_id      ON public.comunicados (campo_id);
CREATE INDEX IF NOT EXISTS idx_comunicados_enviado_em    ON public.comunicados (enviado_em DESC);

-- 3. Habilita Row Level Security (RLS)
ALTER TABLE public.comunicados ENABLE ROW LEVEL SECURITY;

-- 4. Política de Acesso para Service Role (server-side)
DROP POLICY IF EXISTS "comunicados_service_role_all" ON public.comunicados;
CREATE POLICY "comunicados_service_role_all"
  ON public.comunicados
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
