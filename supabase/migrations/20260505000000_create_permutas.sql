-- ============================================================
-- PERMUTAS
-- Registro de permutas de ministros entre campos
-- ============================================================
CREATE TABLE IF NOT EXISTS public.permutas (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo_processo       INT NOT NULL,
  ano                   INT NOT NULL,
  data_processo         DATE,
  ministro_id           UUID REFERENCES public.members(id) ON DELETE SET NULL,
  ministro_nome         VARCHAR(255) NOT NULL,
  ministro_matricula    VARCHAR(50),
  ministro_cpf          VARCHAR(20),
  supervisao_origem_id  UUID REFERENCES public.supervisoes(id) ON DELETE SET NULL,
  supervisao_origem_nome VARCHAR(255),
  campo_origem_id       UUID REFERENCES public.campos(id) ON DELETE SET NULL,
  campo_origem_nome     VARCHAR(255),
  supervisao_destino_id UUID REFERENCES public.supervisoes(id) ON DELETE SET NULL,
  supervisao_destino_nome VARCHAR(255),
  campo_destino_id      UUID REFERENCES public.campos(id) ON DELETE SET NULL,
  campo_destino_nome    VARCHAR(255),
  data_posse            DATE,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_permutas_codigo_ano ON public.permutas(codigo_processo, ano);
CREATE INDEX IF NOT EXISTS idx_permutas_ministro_id ON public.permutas(ministro_id);
CREATE INDEX IF NOT EXISTS idx_permutas_created_at ON public.permutas(created_at);

ALTER TABLE public.permutas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "permutas_authenticated" ON public.permutas;
CREATE POLICY "permutas_authenticated" ON public.permutas FOR ALL USING (auth.uid() IS NOT NULL);

DROP TRIGGER IF EXISTS trg_permutas_updated_at ON public.permutas;
CREATE TRIGGER trg_permutas_updated_at BEFORE UPDATE ON public.permutas
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
