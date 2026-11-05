-- ==============================================================================
-- SISCOMIEADEPA — MIGRATION: SOLICITAÇÕES DE CARTEIRINHAS AEMADEPA
-- Arquivo: supabase/migrations/20261104234000_create_aemadepa_carteirinhas_solicitacoes.sql
-- Objetivo: Estrutura financeira e operacional para pedidos de carteirinhas
--           da AEMADEPA (R$ 20,00 via PIX/ASAAS), controle estrito de integridade
--           ministerial, sequenciamento de vias concorrente-seguro,
--           idempotência no ASAAS e bloqueio de exclusões.
-- Status: PREPARADA (NÃO APLICADA — AGUARDANDO AUTORIZAÇÃO EXPRESSA).
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. GARANTIR CONSTRAINT COMPOSTA EM aemadepa_associadas (SE NÃO EXISTIR)
--    Permite FK composta garantindo que ministro_id pertença estritamente à associada_id
-- ------------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'uq_aemadepa_associada_ministro'
          AND conrelid = 'public.aemadepa_associadas'::regclass
    ) THEN
        ALTER TABLE public.aemadepa_associadas
            ADD CONSTRAINT uq_aemadepa_associada_ministro UNIQUE (id, ministro_id);
    END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 2. TABELA PRINCIPAL: aemadepa_carteirinhas_solicitacoes
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.aemadepa_carteirinhas_solicitacoes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    associada_id UUID NOT NULL,
    ministro_id UUID NOT NULL,

    -- Chave composta de integridade ministerial estrita
    CONSTRAINT fk_aemadepa_cart_associada_ministro
        FOREIGN KEY (associada_id, ministro_id)
        REFERENCES public.aemadepa_associadas(id, ministro_id)
        ON DELETE RESTRICT,

    -- Informações Financeiras (R$ 20,00 fixo por emissão)
    valor NUMERIC(10, 2) NOT NULL DEFAULT 20.00,
    via INT NOT NULL DEFAULT 1,

    -- Idempotência de Cobrança ASAAS (antes e depois da criação no gateway)
    -- idempotency_key: chave determinística gerada pelo backend (ex: 'cart:<associada_id>:v<via>')
    idempotency_key VARCHAR(120) NOT NULL,
    asaas_payment_id VARCHAR(100) NULL,
    asaas_customer_id VARCHAR(100) NULL,
    pix_copia_cola TEXT NULL,
    pix_qr_code_url TEXT NULL,
    invoice_url TEXT NULL,

    -- Ciclo de Vida e Estados Operacionais:
    -- aguardando_pagamento -> pago -> em_impressao -> impressa -> entregue (ou cancelada)
    status VARCHAR(30) NOT NULL DEFAULT 'aguardando_pagamento',

    -- Rastreabilidade Temporal
    solicitado_em TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    pago_em TIMESTAMPTZ NULL,
    impresso_em TIMESTAMPTZ NULL,
    entregue_em TIMESTAMPTZ NULL,
    cancelado_em TIMESTAMPTZ NULL,
    motivo_cancelamento TEXT NULL,

    -- Rastreabilidade de Entrega e Auditoria
    entregue_por UUID NULL REFERENCES public.users(id) ON DELETE SET NULL,
    entregue_para VARCHAR(255) NULL,
    observacoes TEXT NULL,

    -- Timestamps padrão
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),

    -- Constraints de Integridade e Domínio
    CONSTRAINT ck_aemadepa_cart_valor CHECK (valor = 20.00),
    CONSTRAINT ck_aemadepa_cart_via CHECK (via >= 1),
    CONSTRAINT ck_aemadepa_cart_status CHECK (
        status IN (
            'aguardando_pagamento',
            'pago',
            'em_impressao',
            'impressa',
            'entregue',
            'cancelada'
        )
    ),
    -- Bloqueio de cancelamento indevido de pedido pago (integridade financeira)
    CONSTRAINT ck_aemadepa_cart_cancelamento_seguro CHECK (
        (status <> 'cancelada') OR (pago_em IS NULL)
    ),
    -- Idempotência: chave única por tentativa de cobrança
    CONSTRAINT uq_aemadepa_cart_idempotency_key UNIQUE (idempotency_key),
    -- Sequência de vias: uma associada não pode ter o mesmo número de via duplicado
    CONSTRAINT uq_aemadepa_cart_associada_via UNIQUE (associada_id, via)
);

-- ------------------------------------------------------------------------------
-- 3. ÍNDICES DE PERFORMANCE E INTEGRIDADE
-- ------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_aemadepa_cart_associada_id 
    ON public.aemadepa_carteirinhas_solicitacoes (associada_id);

CREATE INDEX IF NOT EXISTS idx_aemadepa_cart_ministro_id 
    ON public.aemadepa_carteirinhas_solicitacoes (ministro_id);

CREATE INDEX IF NOT EXISTS idx_aemadepa_cart_status 
    ON public.aemadepa_carteirinhas_solicitacoes (status);

-- Idempotência ASAAS por payment ID
CREATE UNIQUE INDEX IF NOT EXISTS uq_aemadepa_cart_asaas_payment_id 
    ON public.aemadepa_carteirinhas_solicitacoes (asaas_payment_id)
    WHERE asaas_payment_id IS NOT NULL;

-- REGRA ANTI-DUPLICIDADE SOB CONCORRÊNCIA:
-- Bloqueia a abertura de múltiplos pedidos ativos para a mesma associada.
-- Uma nova solicitação (segunda via) só pode ser aberta quando o pedido anterior
-- estiver com status 'entregue' ou 'cancelada'.
CREATE UNIQUE INDEX IF NOT EXISTS uq_aemadepa_cart_solicitacao_ativa 
    ON public.aemadepa_carteirinhas_solicitacoes (associada_id)
    WHERE status IN ('aguardando_pagamento', 'pago', 'em_impressao', 'impressa');

-- ------------------------------------------------------------------------------
-- 4. FUNÇÃO E TRIGGER: SEQUENCIAMENTO AUTOMÁTICO E SEGURO DE VIAS
--    Garante que a via seja sequencial (1, 2, 3...) travando o registro da associada
--    (FOR UPDATE) para evitar race conditions sob solicitações simultâneas.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_aemadepa_carteirinha_via()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_proxima_via INT;
BEGIN
    -- Bloqueio pessimista no registro da associada para serializar emissões concorrentes
    PERFORM 1 FROM public.aemadepa_associadas WHERE id = NEW.associada_id FOR UPDATE;

    -- Calcula a próxima via disponível para esta associada
    SELECT COALESCE(MAX(via), 0) + 1
    INTO v_proxima_via
    FROM public.aemadepa_carteirinhas_solicitacoes
    WHERE associada_id = NEW.associada_id;

    -- Atribui a via calculada caso não venha informada explicitamente
    IF NEW.via IS NULL OR NEW.via <= 1 THEN
        NEW.via := v_proxima_via;
    END IF;

    -- Se a chave de idempotência não for preenchida, gera um padrão determinístico
    IF NEW.idempotency_key IS NULL OR trim(NEW.idempotency_key) = '' THEN
        NEW.idempotency_key := 'cart:' || NEW.associada_id::text || ':via' || NEW.via::text || ':' || extract(epoch from now())::bigint;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_aemadepa_cart_via ON public.aemadepa_carteirinhas_solicitacoes;
CREATE TRIGGER trg_aemadepa_cart_via
    BEFORE INSERT ON public.aemadepa_carteirinhas_solicitacoes
    FOR EACH ROW
    EXECUTE FUNCTION public.set_aemadepa_carteirinha_via();

-- Trigger para updated_at automático
DROP TRIGGER IF EXISTS trg_aemadepa_cart_updated_at ON public.aemadepa_carteirinhas_solicitacoes;
CREATE TRIGGER trg_aemadepa_cart_updated_at
    BEFORE UPDATE ON public.aemadepa_carteirinhas_solicitacoes
    FOR EACH ROW
    EXECUTE FUNCTION public.set_aemadepa_updated_at();

-- ------------------------------------------------------------------------------
-- 5. POLÍTICAS DE SEGURANÇA (ROW LEVEL SECURITY)
-- ------------------------------------------------------------------------------
ALTER TABLE public.aemadepa_carteirinhas_solicitacoes ENABLE ROW LEVEL SECURITY;

-- SELECT: Acesso exclusivo aos perfis administrativos autorizados da Secretaria
DROP POLICY IF EXISTS "aemadepa_cart_select_admin" ON public.aemadepa_carteirinhas_solicitacoes;
CREATE POLICY "aemadepa_cart_select_admin"
    ON public.aemadepa_carteirinhas_solicitacoes
    FOR SELECT
    TO authenticated
    USING (public.is_aemadepa_admin());

-- INSERT: Perfis administrativos via painel ou service_role/RPCs autorizadas
DROP POLICY IF EXISTS "aemadepa_cart_insert_admin" ON public.aemadepa_carteirinhas_solicitacoes;
CREATE POLICY "aemadepa_cart_insert_admin"
    ON public.aemadepa_carteirinhas_solicitacoes
    FOR INSERT
    TO authenticated
    WITH CHECK (public.is_aemadepa_admin());

-- UPDATE: Somente administradores (mudança de status para impressão, entrega, etc.)
DROP POLICY IF EXISTS "aemadepa_cart_update_admin" ON public.aemadepa_carteirinhas_solicitacoes;
CREATE POLICY "aemadepa_cart_update_admin"
    ON public.aemadepa_carteirinhas_solicitacoes
    FOR UPDATE
    TO authenticated
    USING (public.is_aemadepa_admin())
    WITH CHECK (public.is_aemadepa_admin());

-- DELETE: Proibição estrita de deleção física (auditoria fiscal/financeira)
DROP POLICY IF EXISTS "aemadepa_cart_delete_admin" ON public.aemadepa_carteirinhas_solicitacoes;
CREATE POLICY "aemadepa_cart_delete_admin"
    ON public.aemadepa_carteirinhas_solicitacoes
    FOR DELETE
    TO authenticated
    USING (false);

-- Permissões explícitas de GRANT
REVOKE ALL ON public.aemadepa_carteirinhas_solicitacoes FROM PUBLIC;
REVOKE ALL ON public.aemadepa_carteirinhas_solicitacoes FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.aemadepa_carteirinhas_solicitacoes TO authenticated;
GRANT ALL ON public.aemadepa_carteirinhas_solicitacoes TO service_role;
