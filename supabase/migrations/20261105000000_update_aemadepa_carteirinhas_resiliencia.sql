-- ==============================================================================
-- SISCOMIEADEPA — MIGRATION: AJUSTE DE RESILIÊNCIA E CONCILIAÇÃO AEMADEPA
-- Arquivo: supabase/migrations/20261105000000_update_aemadepa_carteirinhas_resiliencia.sql
-- Objetivo: Adicionar estado 'processando_cobranca' e colunas de controle de
--           tentativas/erros transitórios para evitar deleção compensatória,
--           suportar reconciliação segura e concorrência garantida.
-- Status: PREPARADA (NÃO APLICADA — AGUARDANDO AUTORIZAÇÃO EXPRESSA).
-- ==============================================================================

-- 1. Atualizar Constraint de Status para incluir 'processando_cobranca'
ALTER TABLE public.aemadepa_carteirinhas_solicitacoes
    DROP CONSTRAINT IF EXISTS ck_aemadepa_cart_status;

ALTER TABLE public.aemadepa_carteirinhas_solicitacoes
    ADD CONSTRAINT ck_aemadepa_cart_status CHECK (
        status IN (
            'processando_cobranca',
            'aguardando_pagamento',
            'pago',
            'em_impressao',
            'impressa',
            'entregue',
            'cancelada'
        )
    );

-- 2. Atualizar Índice de Unicidade de Solicitação Ativa
--    Inclui 'processando_cobranca' para impedir qualquer segunda solicitação enquanto
--    a criação da cobrança estiver em andamento ou incerta.
DROP INDEX IF EXISTS public.uq_aemadepa_cart_solicitacao_ativa;

CREATE UNIQUE INDEX uq_aemadepa_cart_solicitacao_ativa 
    ON public.aemadepa_carteirinhas_solicitacoes (associada_id)
    WHERE status IN ('processando_cobranca', 'aguardando_pagamento', 'pago', 'em_impressao', 'impressa');

-- 3. Adicionar colunas de rastreabilidade para conciliação e falhas transitórias
ALTER TABLE public.aemadepa_carteirinhas_solicitacoes
    ADD COLUMN IF NOT EXISTS tentativas_cobranca INT NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS ultimo_erro_gateway TEXT NULL,
    ADD COLUMN IF NOT EXISTS conciliado_em TIMESTAMPTZ NULL;
