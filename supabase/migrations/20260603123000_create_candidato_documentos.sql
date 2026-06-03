-- ============================================================
-- CANDIDATO_DOCUMENTOS - Documentos digitais de candidatos à consagração
-- ============================================================

CREATE TABLE IF NOT EXISTS public.candidato_documentos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidato_id UUID NOT NULL REFERENCES public.consagracao_registros(id) ON DELETE CASCADE,
  tipo_documento VARCHAR(100) NOT NULL,
  nome_arquivo VARCHAR(255) NOT NULL,
  drive_file_id VARCHAR(255) NOT NULL,
  drive_url VARCHAR(500),
  mime_type VARCHAR(120),
  tamanho BIGINT,
  uploaded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_candidato_documentos_candidato
  ON public.candidato_documentos(candidato_id);

CREATE INDEX IF NOT EXISTS idx_candidato_documentos_created_at
  ON public.candidato_documentos(created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_candidato_documentos_drive_file_id
  ON public.candidato_documentos(drive_file_id);

ALTER TABLE public.candidato_documentos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS candidato_documentos_auth ON public.candidato_documentos;
CREATE POLICY candidato_documentos_auth
  ON public.candidato_documentos FOR ALL
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);
