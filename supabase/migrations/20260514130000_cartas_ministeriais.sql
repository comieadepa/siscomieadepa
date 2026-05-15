-- Tabela de cartas ministeriais
CREATE TABLE IF NOT EXISTS public.cartas_ministeriais (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero VARCHAR(40) NOT NULL,
  tipo VARCHAR(32) NOT NULL,
  ministro_id UUID NULL,
  ministro_nome TEXT NOT NULL,
  matricula TEXT NULL,
  cpf TEXT NULL,
  rg TEXT NULL,
  dados_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  texto_final TEXT NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'emitida',
  emitido_por UUID NULL,
  emitido_por_nome TEXT NULL,
  emitido_por_email TEXT NULL,
  emitido_em TIMESTAMPTZ NULL,
  cancelado_por UUID NULL,
  cancelado_em TIMESTAMPTZ NULL,
  motivo_cancelamento TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cartas_ministeriais_numero_key UNIQUE (numero),
  CONSTRAINT cartas_ministeriais_status_check CHECK (status IN ('emitida', 'pendente', 'cancelada'))
);

CREATE INDEX IF NOT EXISTS idx_cartas_ministeriais_status ON public.cartas_ministeriais(status);
CREATE INDEX IF NOT EXISTS idx_cartas_ministeriais_emitido_em ON public.cartas_ministeriais(emitido_em);
CREATE INDEX IF NOT EXISTS idx_cartas_ministeriais_ministro_nome ON public.cartas_ministeriais(ministro_nome);

ALTER TABLE public.cartas_ministeriais ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cartas_ministeriais_authenticated" ON public.cartas_ministeriais
  FOR ALL USING (auth.uid() IS NOT NULL);

DROP TRIGGER IF EXISTS trg_cartas_ministeriais_updated_at ON public.cartas_ministeriais;
CREATE TRIGGER trg_cartas_ministeriais_updated_at
  BEFORE UPDATE ON public.cartas_ministeriais
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
