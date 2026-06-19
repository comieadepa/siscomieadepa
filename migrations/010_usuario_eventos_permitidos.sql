-- ============================================================
-- Migration 010 — Permissões de múltiplos eventos para usuários de Inscrição
-- Criado em: 19/06/2026
-- Tabela: usuario_eventos_permitidos
-- ============================================================

CREATE TABLE IF NOT EXISTS public.usuario_eventos_permitidos (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  usuario_id  uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  evento_id   uuid        NOT NULL REFERENCES public.eventos(id) ON DELETE CASCADE,
  created_at  timestamptz DEFAULT now(),
  UNIQUE (usuario_id, evento_id)
);

-- Índices
CREATE INDEX IF NOT EXISTS usuario_eventos_permitidos_user_idx   ON public.usuario_eventos_permitidos (usuario_id);
CREATE INDEX IF NOT EXISTS usuario_eventos_permitidos_evento_idx ON public.usuario_eventos_permitidos (evento_id);

-- RLS
ALTER TABLE public.usuario_eventos_permitidos ENABLE ROW LEVEL SECURITY;

-- Super/admin pode ver e gerenciar todos
CREATE POLICY "super_admin_all_usuario_eventos_permitidos"
  ON public.usuario_eventos_permitidos
  FOR ALL
  USING (
    (auth.jwt() ->> 'user_metadata')::jsonb ->> 'nivel' IN ('super', 'admin')
  );

-- Usuário vê somente seus próprios vínculos
CREATE POLICY "usuario_ve_proprios_vinculos_permitidos"
  ON public.usuario_eventos_permitidos
  FOR SELECT
  USING (auth.uid() = usuario_id);

-- Migração de usuários antigos
DO $$
DECLARE
  u record;
  e record;
  subc text;
  evt_id uuid;
BEGIN
  -- Percorre todos os usuários no auth.users que têm nível inscrição
  FOR u IN 
    SELECT id, raw_user_meta_data->>'subcategoria' as subcategoria 
    FROM auth.users 
    WHERE raw_user_meta_data->>'nivel' = 'inscricao'
  LOOP
    subc := u.subcategoria;
    IF subc IS NOT NULL AND subc <> '' AND subc <> 'TODOS' THEN
      -- Se a subcategoria for um UUID de evento válido
      IF subc ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        -- Verifica se o evento existe
        SELECT id INTO evt_id FROM public.eventos WHERE id = subc::uuid;
        IF evt_id IS NOT NULL THEN
          INSERT INTO public.usuario_eventos_permitidos (usuario_id, evento_id)
          VALUES (u.id, evt_id)
          ON CONFLICT (usuario_id, evento_id) DO NOTHING;
        END IF;
      ELSE
        -- Se for uma subcategoria baseada em departamento (ex: AGO, UMADESPA, etc.)
        -- Busca todos os eventos desse departamento e vincula ao usuário
        FOR e IN SELECT id FROM public.eventos WHERE departamento = subc LOOP
          INSERT INTO public.usuario_eventos_permitidos (usuario_id, evento_id)
          VALUES (u.id, e.id)
          ON CONFLICT (usuario_id, evento_id) DO NOTHING;
        END LOOP;
      END IF;
    END IF;
  END LOOP;
END $$;
