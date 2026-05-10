-- ============================================================
-- Migration 008 — Controle de acesso por usuário/evento
-- Criado em: 09/05/2026
-- Tabela: usuario_eventos
-- Vincula usuários do nível 'inscricao' a eventos específicos
-- com um nível de permissão: admin_evento | operador | checkin
-- ============================================================

CREATE TABLE IF NOT EXISTS public.usuario_eventos (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  evento_id   uuid        NOT NULL REFERENCES public.eventos(id) ON DELETE CASCADE,
  permissao   text        NOT NULL CHECK (permissao IN ('admin_evento', 'operador', 'checkin')),
  created_at  timestamptz DEFAULT now(),
  UNIQUE (user_id, evento_id)
);

-- Índices
CREATE INDEX IF NOT EXISTS usuario_eventos_user_idx   ON public.usuario_eventos (user_id);
CREATE INDEX IF NOT EXISTS usuario_eventos_evento_idx ON public.usuario_eventos (evento_id);

-- RLS
ALTER TABLE public.usuario_eventos ENABLE ROW LEVEL SECURITY;

-- Super/admin pode ver e gerenciar todos
CREATE POLICY "super_admin_all_usuario_eventos"
  ON public.usuario_eventos
  FOR ALL
  USING (
    (auth.jwt() ->> 'user_metadata')::jsonb ->> 'nivel' IN ('super', 'admin')
  );

-- Usuário vê somente seus próprios vínculos
CREATE POLICY "usuario_ve_proprios_vinculos"
  ON public.usuario_eventos
  FOR SELECT
  USING (auth.uid() = user_id);

COMMENT ON TABLE public.usuario_eventos IS
  'Vincula usuários nível inscricao a eventos com permissão: admin_evento, operador ou checkin';
COMMENT ON COLUMN public.usuario_eventos.permissao IS
  'admin_evento: acesso total ao evento (sem criar novos);
   operador: inscritos, inscrição manual, etiquetas, check-in (sem financeiro);
   checkin: apenas check-in';
