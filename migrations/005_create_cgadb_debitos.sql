-- Tabela para armazenar os débitos CGADB importados via CSV
CREATE TABLE IF NOT EXISTS public.cgadb_debitos (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  cpf text NOT NULL,
  registro text,
  nome text NOT NULL,
  convencao text,
  ano integer,
  valor numeric(10, 2),
  status text,
  imported_at timestamptz DEFAULT now(),
  CONSTRAINT cgadb_debitos_cpf_ano_unique UNIQUE (cpf, ano)
);

-- Índices para buscas rápidas
CREATE INDEX IF NOT EXISTS cgadb_debitos_cpf_idx ON public.cgadb_debitos (cpf);
CREATE INDEX IF NOT EXISTS cgadb_debitos_ano_idx ON public.cgadb_debitos (ano);

-- Habilitar RLS
ALTER TABLE public.cgadb_debitos ENABLE ROW LEVEL SECURITY;

-- Policy: usuários autenticados podem ler e inserir
CREATE POLICY "cgadb_debitos_select" ON public.cgadb_debitos
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "cgadb_debitos_insert" ON public.cgadb_debitos
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "cgadb_debitos_update" ON public.cgadb_debitos
  FOR UPDATE TO authenticated USING (true);

CREATE POLICY "cgadb_debitos_delete" ON public.cgadb_debitos
  FOR DELETE TO authenticated USING (true);
