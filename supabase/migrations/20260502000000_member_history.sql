-- ============================================================
-- MEMBER HISTORY — Histórico de atividades relevantes do ministro
-- ============================================================

CREATE TABLE IF NOT EXISTS public.member_history (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id    UUID NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  tipo         VARCHAR(100) NOT NULL,   -- ex: 'Manual', 'Documento adicionado', 'Credencial emitida', ...
  descricao    TEXT NOT NULL,
  usuario_nome VARCHAR(255),
  usuario_id   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ocorrencia   DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_member_history_member_id  ON public.member_history(member_id);
CREATE INDEX idx_member_history_created_at ON public.member_history(created_at);

ALTER TABLE public.member_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "member_history_authenticated"
  ON public.member_history FOR ALL
  USING (auth.uid() IS NOT NULL);
