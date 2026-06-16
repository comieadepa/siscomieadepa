-- Migration: Criar tabela de ordens de pagamento complementares
-- Criado em: 2026-06-16

CREATE TABLE IF NOT EXISTS public.evento_ordens_pagamento (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    inscricao_id uuid REFERENCES public.evento_inscricoes(id) ON DELETE SET NULL,
    lote_id uuid REFERENCES public.evento_lotes_inscricao(id) ON DELETE SET NULL,
    evento_id uuid NOT NULL REFERENCES public.eventos(id) ON DELETE RESTRICT,
    tipo_ordem text NOT NULL CHECK (tipo_ordem IN ('principal', 'complemento')),
    valor numeric NOT NULL CHECK (valor >= 0),
    status text NOT NULL CHECK (status IN ('pendente', 'pago', 'cancelado')) DEFAULT 'pendente',
    asaas_payment_id text UNIQUE,
    invoice_url text,
    pix_copia_cola text,
    pix_qr_code text,
    descricao text,
    metadata jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    paid_at timestamptz
);

-- Habilitar RLS
ALTER TABLE public.evento_ordens_pagamento ENABLE ROW LEVEL SECURITY;

-- Criar políticas de segurança RLS
DROP POLICY IF EXISTS "Allow authenticated read" ON public.evento_ordens_pagamento;
CREATE POLICY "Allow authenticated read" ON public.evento_ordens_pagamento
    FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Allow authenticated insert/update" ON public.evento_ordens_pagamento;
CREATE POLICY "Allow authenticated insert/update" ON public.evento_ordens_pagamento
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Índices de Performance
CREATE INDEX IF NOT EXISTS idx_ordens_inscricao ON public.evento_ordens_pagamento(inscricao_id);
CREATE INDEX IF NOT EXISTS idx_ordens_evento ON public.evento_ordens_pagamento(evento_id);
CREATE INDEX IF NOT EXISTS idx_ordens_asaas ON public.evento_ordens_pagamento(asaas_payment_id);
