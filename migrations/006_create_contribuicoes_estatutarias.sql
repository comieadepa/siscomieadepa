-- Tabela para registrar pagamentos de Contribuição Estatutária dos campos
CREATE TABLE IF NOT EXISTS public.contribuicoes_estatutarias (
  id              uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  campo_id        uuid,
  campo_nome      text        NOT NULL,
  supervisao_id   uuid,
  supervisao_nome text        NOT NULL,
  pastor_member_id uuid,
  pastor_nome     text,
  mes             integer     NOT NULL CHECK (mes BETWEEN 1 AND 12),
  ano             integer     NOT NULL,
  valor           numeric(10, 2) DEFAULT 0,
  forma_pagamento text        DEFAULT 'A VISTA',
  contato         text,
  created_at      timestamptz DEFAULT now()
);

-- Garante que não haja dois registros do mesmo campo no mesmo mês/ano
CREATE UNIQUE INDEX IF NOT EXISTS contrib_est_campo_mes_ano_idx
  ON public.contribuicoes_estatutarias (campo_id, mes, ano);

-- Índices de busca
CREATE INDEX IF NOT EXISTS contrib_est_ano_idx          ON public.contribuicoes_estatutarias (ano);
CREATE INDEX IF NOT EXISTS contrib_est_supervisao_idx   ON public.contribuicoes_estatutarias (supervisao_id);
CREATE INDEX IF NOT EXISTS contrib_est_campo_idx        ON public.contribuicoes_estatutarias (campo_id);

-- RLS
ALTER TABLE public.contribuicoes_estatutarias ENABLE ROW LEVEL SECURITY;

CREATE POLICY "contrib_est_select" ON public.contribuicoes_estatutarias
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "contrib_est_insert" ON public.contribuicoes_estatutarias
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "contrib_est_update" ON public.contribuicoes_estatutarias
  FOR UPDATE TO authenticated USING (true);

CREATE POLICY "contrib_est_delete" ON public.contribuicoes_estatutarias
  FOR DELETE TO authenticated USING (true);
