-- Adiciona colunas necessárias à tabela supervisoes
-- (equivalente ao arquivo em _archive, adaptado para schema single-tenant sem ministry_id)

-- 1. Converter codigo de VARCHAR para INTEGER (se ainda for VARCHAR)
--    Faz cast para TEXT primeiro para que o regex funcione independente do tipo atual
ALTER TABLE public.supervisoes
  ALTER COLUMN codigo TYPE INTEGER USING (
    CASE
      WHEN codigo::TEXT ~ '^\d+$' THEN codigo::TEXT::INTEGER
      ELSE NULL
    END
  );

-- 2. Adicionar colunas de supervisor e UF (usadas pelo formulário e pela importação CSV)
ALTER TABLE public.supervisoes
  ADD COLUMN IF NOT EXISTS uf VARCHAR(2),
  ADD COLUMN IF NOT EXISTS supervisor_matricula  VARCHAR(50),
  ADD COLUMN IF NOT EXISTS supervisor_nome       VARCHAR(255),
  ADD COLUMN IF NOT EXISTS supervisor_cpf        VARCHAR(20),
  ADD COLUMN IF NOT EXISTS supervisor_data_nascimento DATE,
  ADD COLUMN IF NOT EXISTS supervisor_cargo      VARCHAR(100),
  ADD COLUMN IF NOT EXISTS supervisor_celular    VARCHAR(20);

-- 3. Renomear supervisor_nome_snapshot para supervisor_nome caso esteja vazio
--    (migração segura: copia os dados do campo legado se supervisor_nome estiver vazio)
UPDATE public.supervisoes
  SET supervisor_nome = supervisor_nome_snapshot
  WHERE supervisor_nome IS NULL
    AND supervisor_nome_snapshot IS NOT NULL;

-- 4. Índice único em codigo (single-tenant — sem ministry_id)
CREATE UNIQUE INDEX IF NOT EXISTS idx_supervisoes_codigo_unique
  ON public.supervisoes (codigo)
  WHERE codigo IS NOT NULL;

-- 5. Índice para busca por supervisor_member_id (pode já existir — IF NOT EXISTS é seguro)
CREATE INDEX IF NOT EXISTS idx_supervisoes_supervisor_member_id
  ON public.supervisoes (supervisor_member_id);
