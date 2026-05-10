-- ============================================================
-- Migration 007 — Módulo de Eventos
-- Criado em: 09/05/2026
-- Tabelas: eventos, evento_inscricoes, evento_checkins, evento_equipe
-- ============================================================

-- ============================================================
-- 1. TABELA: eventos
-- ============================================================
CREATE TABLE IF NOT EXISTS public.eventos (
  id                    uuid          DEFAULT gen_random_uuid() PRIMARY KEY,
  nome                  text          NOT NULL,
  slug                  text          NOT NULL,
  descricao             text,
  departamento          text          NOT NULL CHECK (departamento IN ('AGO','COADESPA','UMADESPA','SEIADEPA','AVULSO')),
  data_inicio           date          NOT NULL,
  data_fim              date          NOT NULL,
  local                 text,
  cidade                text,
  supervisao_id         uuid          NULL REFERENCES public.supervisoes(id) ON DELETE SET NULL,
  campo_id              uuid          NULL REFERENCES public.campos(id) ON DELETE SET NULL,
  banner_url            text,
  valor_inscricao       numeric(10,2) DEFAULT 0,
  permite_hospedagem    boolean       DEFAULT false,
  permite_alimentacao   boolean       DEFAULT false,
  permite_brinde        boolean       DEFAULT false,
  gerar_certificado     boolean       DEFAULT false,
  link_whatsapp         text,
  mensagem_confirmacao  text,
  inscricoes_abertas    boolean       DEFAULT false,
  limite_vagas          integer       NULL,
  publico_alvo          text,
  status                text          DEFAULT 'programado' CHECK (status IN ('programado','realizado','cancelado')),
  created_at            timestamptz   DEFAULT now(),
  updated_at            timestamptz   DEFAULT now()
);

-- Slug único
CREATE UNIQUE INDEX IF NOT EXISTS eventos_slug_idx
  ON public.eventos (slug);

-- Índices de busca
CREATE INDEX IF NOT EXISTS eventos_departamento_idx   ON public.eventos (departamento);
CREATE INDEX IF NOT EXISTS eventos_status_idx         ON public.eventos (status);
CREATE INDEX IF NOT EXISTS eventos_data_inicio_idx    ON public.eventos (data_inicio);
CREATE INDEX IF NOT EXISTS eventos_supervisao_idx     ON public.eventos (supervisao_id);
CREATE INDEX IF NOT EXISTS eventos_campo_idx          ON public.eventos (campo_id);

-- Trigger updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER eventos_set_updated_at
  BEFORE UPDATE ON public.eventos
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS
ALTER TABLE public.eventos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "eventos_select" ON public.eventos
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "eventos_insert" ON public.eventos
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "eventos_update" ON public.eventos
  FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "eventos_delete" ON public.eventos
  FOR DELETE USING (auth.role() = 'authenticated');

-- ============================================================
-- 2. TABELA: evento_inscricoes
-- ============================================================
CREATE TABLE IF NOT EXISTS public.evento_inscricoes (
  id                    uuid          DEFAULT gen_random_uuid() PRIMARY KEY,
  evento_id             uuid          NOT NULL REFERENCES public.eventos(id) ON DELETE CASCADE,
  ministro_id           uuid          NULL,
  nome_inscrito         text          NOT NULL,
  cpf                   text,
  email                 text,
  telefone              text,
  whatsapp              text,
  sexo                  text,
  data_nascimento       date,
  supervisao_id         uuid          NULL REFERENCES public.supervisoes(id) ON DELETE SET NULL,
  campo_id              uuid          NULL REFERENCES public.campos(id) ON DELETE SET NULL,
  hospedagem            boolean       DEFAULT false,
  alimentacao           boolean       DEFAULT false,
  brinde                boolean       DEFAULT false,
  valor_pago            numeric(10,2) DEFAULT 0,
  status_pagamento      text          DEFAULT 'pendente' CHECK (status_pagamento IN ('pendente','pago','isento','cancelado')),
  forma_pagamento       text,
  asaas_payment_id      text,
  comprovante_url       text,
  qr_code               text,
  checkin_realizado     boolean       DEFAULT false,
  checkin_at            timestamptz   NULL,
  etiqueta_impressa     boolean       DEFAULT false,
  certificado_enviado   boolean       DEFAULT false,
  observacoes           text,
  created_at            timestamptz   DEFAULT now(),
  updated_at            timestamptz   DEFAULT now()
);

-- Índices
CREATE INDEX IF NOT EXISTS inscricoes_evento_idx           ON public.evento_inscricoes (evento_id);
CREATE INDEX IF NOT EXISTS inscricoes_cpf_idx              ON public.evento_inscricoes (cpf);
CREATE INDEX IF NOT EXISTS inscricoes_status_pagamento_idx ON public.evento_inscricoes (status_pagamento);
CREATE INDEX IF NOT EXISTS inscricoes_supervisao_idx       ON public.evento_inscricoes (supervisao_id);
CREATE INDEX IF NOT EXISTS inscricoes_campo_idx            ON public.evento_inscricoes (campo_id);

-- Trigger updated_at
CREATE TRIGGER evento_inscricoes_set_updated_at
  BEFORE UPDATE ON public.evento_inscricoes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS
ALTER TABLE public.evento_inscricoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "inscricoes_select" ON public.evento_inscricoes
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "inscricoes_insert" ON public.evento_inscricoes
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "inscricoes_update" ON public.evento_inscricoes
  FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "inscricoes_delete" ON public.evento_inscricoes
  FOR DELETE USING (auth.role() = 'authenticated');

-- ============================================================
-- 3. TABELA: evento_checkins
-- ============================================================
CREATE TABLE IF NOT EXISTS public.evento_checkins (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  evento_id     uuid        NOT NULL REFERENCES public.eventos(id) ON DELETE CASCADE,
  inscricao_id  uuid        NOT NULL REFERENCES public.evento_inscricoes(id) ON DELETE CASCADE,
  operador_id   uuid        NULL,
  metodo        text        DEFAULT 'qrcode' CHECK (metodo IN ('qrcode','manual')),
  created_at    timestamptz DEFAULT now()
);

-- Índices
CREATE INDEX IF NOT EXISTS checkins_evento_idx    ON public.evento_checkins (evento_id);
CREATE INDEX IF NOT EXISTS checkins_inscricao_idx ON public.evento_checkins (inscricao_id);

-- RLS
ALTER TABLE public.evento_checkins ENABLE ROW LEVEL SECURITY;

CREATE POLICY "checkins_select" ON public.evento_checkins
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "checkins_insert" ON public.evento_checkins
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- ============================================================
-- 4. TABELA: evento_equipe
-- ============================================================
CREATE TABLE IF NOT EXISTS public.evento_equipe (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  evento_id   uuid        NOT NULL REFERENCES public.eventos(id) ON DELETE CASCADE,
  email       text        NOT NULL,
  senha_hash  text        NULL,
  tipo        text        NOT NULL CHECK (tipo IN ('admin','checkin')),
  ativo       boolean     DEFAULT true,
  created_at  timestamptz DEFAULT now()
);

-- Índices
CREATE INDEX IF NOT EXISTS equipe_evento_idx ON public.evento_equipe (evento_id);
CREATE INDEX IF NOT EXISTS equipe_email_idx  ON public.evento_equipe (email);

-- RLS
ALTER TABLE public.evento_equipe ENABLE ROW LEVEL SECURITY;

CREATE POLICY "equipe_select" ON public.evento_equipe
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "equipe_insert" ON public.evento_equipe
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "equipe_update" ON public.evento_equipe
  FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "equipe_delete" ON public.evento_equipe
  FOR DELETE USING (auth.role() = 'authenticated');
