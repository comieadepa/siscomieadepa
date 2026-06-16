-- Migration: Criar tabela de cupons de desconto (Sprint 1)
-- Criado em: 2026-06-16

CREATE TABLE IF NOT EXISTS public.evento_cupons (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    evento_id uuid NOT NULL REFERENCES public.eventos(id) ON DELETE CASCADE,
    codigo text NOT NULL,
    tipo_desconto text NOT NULL CHECK (tipo_desconto IN ('fixo', 'percentual')),
    valor numeric(10,2) NOT NULL CHECK (valor >= 0),
    limite_usos integer,
    usos_atuais integer NOT NULL DEFAULT 0,
    validade_inicio timestamptz,
    validade_fim timestamptz,
    ativo boolean NOT NULL DEFAULT true,
    aplicar_todos_tipos boolean NOT NULL DEFAULT true,
    tipos_permitidos jsonb NOT NULL DEFAULT '[]',
    permite_acumular boolean NOT NULL DEFAULT false,
    observacoes text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- UNIQUE(evento_id, lower(codigo))
CREATE UNIQUE INDEX IF NOT EXISTS uq_evento_cupom_codigo_lower 
    ON public.evento_cupons (evento_id, lower(codigo));

-- Habilitar RLS
ALTER TABLE public.evento_cupons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read" ON public.evento_cupons;
CREATE POLICY "Allow public read" ON public.evento_cupons
    FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS "Allow authenticated write" ON public.evento_cupons;
CREATE POLICY "Allow authenticated write" ON public.evento_cupons
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Índices necessários
CREATE INDEX IF NOT EXISTS idx_evento_cupons_evento_id ON public.evento_cupons(evento_id);
CREATE INDEX IF NOT EXISTS idx_evento_cupons_codigo ON public.evento_cupons(codigo);
