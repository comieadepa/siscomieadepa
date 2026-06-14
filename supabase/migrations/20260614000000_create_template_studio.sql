-- Create document_templates table
CREATE TABLE IF NOT EXISTS public.document_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  descricao text,
  modulo text NOT NULL,
  tipo_documento text NOT NULL,
  background_url text,
  largura numeric(10,2) NOT NULL DEFAULT 1123.00,
  altura numeric(10,2) NOT NULL DEFAULT 794.00,
  orientacao text NOT NULL DEFAULT 'landscape',
  elementos jsonb NOT NULL DEFAULT '[]',
  ativo boolean NOT NULL DEFAULT true,
  versao integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

-- Create document_tokens table for validation
CREATE TABLE IF NOT EXISTS public.document_tokens (
  token text PRIMARY KEY DEFAULT encode(gen_random_bytes(16), 'hex'),
  template_id uuid NOT NULL REFERENCES public.document_templates(id),
  document_type text NOT NULL,
  reference_id uuid NOT NULL,
  dados_publicos jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz
);

-- Indexing for lookup speed
CREATE INDEX IF NOT EXISTS idx_document_templates_modulo ON public.document_templates(modulo) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_document_tokens_ref ON public.document_tokens(reference_id, document_type);

-- Enable RLS and setup permissive policies for authenticated users
ALTER TABLE public.document_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "document_templates_select" ON public.document_templates FOR SELECT TO authenticated USING (true);
CREATE POLICY "document_templates_all" ON public.document_templates FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "document_tokens_select_anon" ON public.document_tokens FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "document_tokens_all" ON public.document_tokens FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Seed default certificate template
INSERT INTO public.document_templates (
  id,
  nome,
  descricao,
  modulo,
  tipo_documento,
  background_url,
  largura,
  altura,
  orientacao,
  elementos,
  ativo,
  versao
) VALUES (
  '12345678-1234-1234-1234-123456789abc',
  'Certificado de Credenciamento Padrão CONEC',
  'Template padrão inicial do certificado de credenciamento do CONEC',
  'conec',
  'certificado_credenciamento',
  '/img/cert_credenciamento.jpg',
  1123,
  794,
  'landscape',
  '[
    {
      "id": "nome_instituicao",
      "tipo": "text_dynamic",
      "placeholder": "nome_instituicao",
      "x": 15.0,
      "y": 49.0,
      "width": 70.0,
      "height": 4.5,
      "styles": {
        "fontSize": "26px",
        "fontWeight": "bold",
        "textAlign": "center",
        "fontFamily": "sans-serif"
      }
    },
    {
      "id": "cnpj",
      "tipo": "text_dynamic",
      "placeholder": "cnpj",
      "x": 35.0,
      "y": 54.0,
      "width": 30.0,
      "height": 3.0,
      "styles": {
        "fontSize": "14px",
        "textAlign": "center",
        "fontFamily": "sans-serif"
      }
    },
    {
      "id": "numero_registro",
      "tipo": "text_dynamic",
      "placeholder": "numero_registro",
      "x": 15.0,
      "y": 80.0,
      "width": 20.0,
      "height": 3.0,
      "styles": {
        "fontSize": "14px",
        "fontWeight": "bold",
        "textAlign": "left",
        "fontFamily": "sans-serif"
      }
    },
    {
      "id": "data_credenciamento",
      "tipo": "text_dynamic",
      "placeholder": "data_credenciamento",
      "x": 15.0,
      "y": 83.0,
      "width": 25.0,
      "height": 3.0,
      "styles": {
        "fontSize": "14px",
        "fontWeight": "bold",
        "textAlign": "left",
        "fontFamily": "sans-serif"
      }
    },
    {
      "id": "validade",
      "tipo": "text_dynamic",
      "placeholder": "validade",
      "x": 15.0,
      "y": 86.0,
      "width": 20.0,
      "height": 3.0,
      "styles": {
        "fontSize": "14px",
        "fontWeight": "bold",
        "textAlign": "left",
        "fontFamily": "sans-serif"
      }
    },
    {
      "id": "qr_code_validacao",
      "tipo": "qrcode",
      "placeholder": "qr_code_validacao",
      "x": 78.0,
      "y": 76.0,
      "width": 10.0,
      "height": 10.0,
      "styles": {}
    }
  ]'::jsonb,
  true,
  1
) ON CONFLICT (id) DO NOTHING;
