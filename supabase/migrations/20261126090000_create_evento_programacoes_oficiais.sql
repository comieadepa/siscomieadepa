-- Migration: Criação da tabela evento_programacoes_oficiais e configuração do Storage
-- Pronta para execução no SQL Editor do Supabase após revisão.

-- 1. Tabela principal
CREATE TABLE IF NOT EXISTS public.evento_programacoes_oficiais (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evento_id uuid NOT NULL REFERENCES public.eventos(id) ON DELETE CASCADE,
  plenaria_key text NOT NULL CHECK (plenaria_key IN ('ministros', 'aemadepa', 'umadespa')),
  plenaria_nome text NOT NULL,
  status text NOT NULL DEFAULT 'sem_programacao' CHECK (status IN ('sem_programacao', 'rascunho', 'publicada')),
  arquivo_nome text,
  arquivo_path text,
  arquivo_url text,
  arquivo_tamanho integer,
  texto_extraido text,
  atualizado_por uuid,
  publicado_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_evento_plenaria UNIQUE (evento_id, plenaria_key)
);

CREATE INDEX IF NOT EXISTS idx_evento_programacoes_oficiais_evento_status
  ON public.evento_programacoes_oficiais (evento_id, status);

ALTER TABLE public.evento_programacoes_oficiais ENABLE ROW LEVEL SECURITY;

-- 2. Políticas RLS da tabela
DROP POLICY IF EXISTS "Leitura publica de programacoes publicadas" ON public.evento_programacoes_oficiais;
CREATE POLICY "Leitura publica de programacoes publicadas"
  ON public.evento_programacoes_oficiais
  FOR SELECT
  USING (status = 'publicada');

DROP POLICY IF EXISTS "Service role acesso total programacoes oficiais" ON public.evento_programacoes_oficiais;
CREATE POLICY "Service role acesso total programacoes oficiais"
  ON public.evento_programacoes_oficiais
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 3. Configuração do Bucket no Supabase Storage (eventos-programacoes)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'eventos-programacoes',
  'eventos-programacoes',
  false,
  4194304, -- 4MB (compatível com limite serverless da Vercel)
  ARRAY['application/pdf']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 4. Políticas do Storage: leitura pública apenas de PDFs vinculados a programações publicadas
DROP POLICY IF EXISTS "Leitura publica de PDFs publicados" ON storage.objects;
CREATE POLICY "Leitura publica de PDFs publicados"
  ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'eventos-programacoes'
    AND EXISTS (
      SELECT 1
      FROM public.evento_programacoes_oficiais p
      WHERE p.arquivo_path = storage.objects.name
        AND p.status = 'publicada'
    )
  );

DROP POLICY IF EXISTS "Service role gerencia PDFs de programacoes" ON storage.objects;
CREATE POLICY "Service role gerencia PDFs de programacoes"
  ON storage.objects
  FOR ALL
  TO service_role
  USING (bucket_id = 'eventos-programacoes')
  WITH CHECK (bucket_id = 'eventos-programacoes');
