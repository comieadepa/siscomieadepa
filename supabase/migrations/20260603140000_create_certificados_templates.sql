-- ============================================================
-- CERTIFICADOS_TEMPLATES
-- ============================================================
CREATE TABLE IF NOT EXISTS public.certificados_templates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ministry_id   TEXT NOT NULL,
  template_key  TEXT NOT NULL,
  name          VARCHAR(255) NOT NULL,
  description   TEXT,
  template_data JSONB NOT NULL DEFAULT '{}',
  preview_url   VARCHAR(500),
  is_default    BOOLEAN DEFAULT false,
  is_active     BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_certificados_templates_ministry_key UNIQUE (ministry_id, template_key)
);

ALTER TABLE public.certificados_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "certificados_templates_authenticated"
  ON public.certificados_templates
  FOR ALL
  USING (auth.uid() IS NOT NULL);

CREATE TRIGGER trg_certificados_templates_updated_at
  BEFORE UPDATE ON public.certificados_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
