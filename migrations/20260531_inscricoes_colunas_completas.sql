-- ============================================================
-- Migration: Adiciona todas as colunas faltantes em evento_inscricoes
-- Idempotente: usa ADD COLUMN IF NOT EXISTS
-- Aplicar no SQL Editor do Supabase
-- ============================================================

-- Colunas de tipo/valor/lote (20260509_inscricoes_evolucao)
ALTER TABLE public.evento_inscricoes
  ADD COLUMN IF NOT EXISTS tipo_inscricao   text          NULL,
  ADD COLUMN IF NOT EXISTS valor_original   numeric(10,2) NULL,
  ADD COLUMN IF NOT EXISTS cupom_codigo     text          NULL,
  ADD COLUMN IF NOT EXISTS desconto_valor   numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS valor_final      numeric(10,2) NULL,
  ADD COLUMN IF NOT EXISTS direito_brinde   boolean       NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS lote_id          uuid          NULL;

-- Operador que realizou a inscrição
ALTER TABLE public.evento_inscricoes
  ADD COLUMN IF NOT EXISTS operador_id      uuid          NULL;

-- Campos de pagamento ASAAS (20260510_payment_fields_inscricoes)
ALTER TABLE public.evento_inscricoes
  ADD COLUMN IF NOT EXISTS invoice_url      text NULL,
  ADD COLUMN IF NOT EXISTS pix_copia_cola   text NULL,
  ADD COLUMN IF NOT EXISTS pix_qr_code      text NULL,
  ADD COLUMN IF NOT EXISTS asaas_due_date   date NULL;

-- LGPD (20260511_lgpd_inscricoes)
ALTER TABLE public.evento_inscricoes
  ADD COLUMN IF NOT EXISTS lgpd_aceito      boolean      DEFAULT false,
  ADD COLUMN IF NOT EXISTS lgpd_aceito_em   timestamptz  NULL;

-- Hospedagem AGO (20260509_hospedagem_ago)
ALTER TABLE public.evento_inscricoes
  ADD COLUMN IF NOT EXISTS hosp_necessidade_especial    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS hosp_descricao_necessidade   text    NULL,
  ADD COLUMN IF NOT EXISTS hosp_cama_inferior           boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS hosp_observacoes             text    NULL;

-- Snapshot ministerial (20260522_ago_fechamento)
ALTER TABLE public.evento_inscricoes
  ADD COLUMN IF NOT EXISTS ministro_snapshot jsonb DEFAULT NULL;

-- Grupo de hospedagem (20260529_grupo_hospedagem)
ALTER TABLE public.evento_inscricoes
  ADD COLUMN IF NOT EXISTS grupo_hospedagem text NULL;

-- Comorbidade (20260529_inscricoes_comorbidade)
ALTER TABLE public.evento_inscricoes
  ADD COLUMN IF NOT EXISTS hosp_possui_comorbidade      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS hosp_descricao_comorbidade   text    NULL;
