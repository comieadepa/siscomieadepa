-- Create table: evento_caixa_sessoes
CREATE TABLE IF NOT EXISTS public.evento_caixa_sessoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evento_id uuid NOT NULL REFERENCES public.eventos(id),
  operador_id uuid NULL REFERENCES public.evento_equipe(id) ON DELETE SET NULL,
  operador_nome text NULL,
  data_abertura timestamptz DEFAULT now(),
  data_fechamento timestamptz NULL,
  status text DEFAULT 'aberto' CHECK (status IN ('aberto', 'fechado', 'conferido')),
  saldo_dinheiro_informado numeric(10,2) NULL,
  saldo_dinheiro_esperado numeric(10,2) NULL,
  divergencia_dinheiro numeric(10,2) NULL,
  fechado_por uuid NULL,
  observacoes text NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create table: evento_caixa_sangrias
CREATE TABLE IF NOT EXISTS public.evento_caixa_sangrias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evento_id uuid NOT NULL REFERENCES public.eventos(id),
  caixa_sessao_id uuid NOT NULL REFERENCES public.evento_caixa_sessoes(id) ON DELETE RESTRICT,
  operador_id uuid NULL REFERENCES public.evento_equipe(id) ON DELETE SET NULL,
  valor numeric(10,2) NOT NULL,
  forma_pagamento text DEFAULT 'dinheiro',
  observacao text NULL,
  retirado_por text NULL,
  recebido_por text NULL,
  registrado_por uuid NULL,
  status text DEFAULT 'registrada' CHECK (status IN ('registrada', 'conferida', 'cancelada')),
  created_at timestamptz DEFAULT now(),
  conferido_em timestamptz NULL,
  conferido_por uuid NULL
);

-- Alter table: public.evento_inscricoes
ALTER TABLE public.evento_inscricoes
  ADD COLUMN IF NOT EXISTS origem text DEFAULT 'publico',
  ADD COLUMN IF NOT EXISTS operador_id uuid NULL REFERENCES public.evento_equipe(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS operador_nome text NULL,
  ADD COLUMN IF NOT EXISTS caixa_sessao_id uuid NULL REFERENCES public.evento_caixa_sessoes(id) ON DELETE SET NULL;

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_caixa_sessoes_lookup ON public.evento_caixa_sessoes(evento_id, operador_id, status);
CREATE INDEX IF NOT EXISTS idx_caixa_sangrias_lookup ON public.evento_caixa_sangrias(evento_id, caixa_sessao_id);
CREATE INDEX IF NOT EXISTS idx_evento_inscricoes_caixa ON public.evento_inscricoes(caixa_sessao_id);
CREATE INDEX IF NOT EXISTS idx_evento_inscricoes_operador ON public.evento_inscricoes(operador_id);
