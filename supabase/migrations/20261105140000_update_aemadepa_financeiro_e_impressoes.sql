-- ==============================================================================
-- SISCOMIEADEPA — MIGRATION: FASE FINANCEIRA AEMADEPA (VALIDADA E FINAL)
-- Arquivo: supabase/migrations/20261105140000_update_aemadepa_financeiro_e_impressoes.sql
-- Objetivo: 
--   1. Adicionar colunas de modalidade de pagamento (pix_asaas, a_vista, cortesia)
--   2. Adicionar auditoria de operador e motivo de cortesia vinculada a public.users(id)
--   3. Adequar constraints financeiras (cortesia = R$ 0,00 com motivo obrigatório >= 5 chars;
--      pix_asaas e a_vista = R$ 20,00)
--   4. Atualizar a função public.is_aemadepa_admin() para incluir 'aemadepa' e compatibilidade com 'admin'/'super'
--   5. Criar tabela imutável de histórico de impressões e reimpressões com proteção estrita RLS
--   6. Criar RPC atômica concorrente-segura quitar_aemadepa_carteirinha_admin:
--      - Validação de autorização RBAC do executor real (auth.uid() ou operador informado)
--      - Impedir falsificação de operador_id
--      - Bloqueio estrito de conversão para À Vista/Cortesia quando houver cobrança ASAAS
--        já emitida (asaas_payment_id presente) ou situação incerta (processando_cobranca / pendência de conciliação)
-- Status: PREPARADA (NÃO APLICADA — AGUARDANDO AUTORIZAÇÃO EXPRESSA).
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. ATUALIZAR FUNÇÃO HELPER DE SEGURANÇA RBAC: public.is_aemadepa_admin()
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_aemadepa_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.users u
        WHERE u.id = auth.uid()
          AND LOWER(TRIM(u.role)) IN ('super', 'admin', 'administrador', 'aemadepa')
    );
$$;

REVOKE ALL ON FUNCTION public.is_aemadepa_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_aemadepa_admin() FROM anon;
GRANT EXECUTE ON FUNCTION public.is_aemadepa_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_aemadepa_admin() TO service_role;

-- ------------------------------------------------------------------------------
-- 2. ADICIONAR COLUNAS FINANCEIRAS E DE AUDITORIA EM aemadepa_carteirinhas_solicitacoes
-- ------------------------------------------------------------------------------
ALTER TABLE public.aemadepa_carteirinhas_solicitacoes
    ADD COLUMN IF NOT EXISTS forma_pagamento VARCHAR(30) NOT NULL DEFAULT 'pix_asaas',
    ADD COLUMN IF NOT EXISTS operador_aprovacao_id UUID NULL REFERENCES public.users(id),
    ADD COLUMN IF NOT EXISTS motivo_cortesia TEXT NULL;

-- ------------------------------------------------------------------------------
-- 3. AJUSTAR CONSTRAINTS DE FORMA DE PAGAMENTO E VALOR
-- ------------------------------------------------------------------------------
ALTER TABLE public.aemadepa_carteirinhas_solicitacoes
    DROP CONSTRAINT IF EXISTS ck_aemadepa_cart_valor;

ALTER TABLE public.aemadepa_carteirinhas_solicitacoes
    DROP CONSTRAINT IF EXISTS ck_aemadepa_cart_forma_pagamento;

ALTER TABLE public.aemadepa_carteirinhas_solicitacoes
    ADD CONSTRAINT ck_aemadepa_cart_forma_pagamento 
        CHECK (forma_pagamento IN ('pix_asaas', 'a_vista', 'cortesia'));

ALTER TABLE public.aemadepa_carteirinhas_solicitacoes
    DROP CONSTRAINT IF EXISTS ck_aemadepa_cart_valor_forma;

ALTER TABLE public.aemadepa_carteirinhas_solicitacoes
    ADD CONSTRAINT ck_aemadepa_cart_valor_forma 
        CHECK (
            (forma_pagamento = 'cortesia' AND valor = 0.00 AND motivo_cortesia IS NOT NULL AND length(trim(motivo_cortesia)) >= 5) OR
            (forma_pagamento IN ('pix_asaas', 'a_vista') AND valor = 20.00)
        );

-- ------------------------------------------------------------------------------
-- 4. TABELA DE HISTÓRICO DE IMPRESSÕES E REIMPRESSÕES (IMUTÁVEL E AUDITÁVEL)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.aemadepa_carteirinhas_impressoes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    solicitacao_id UUID NOT NULL,
    associada_id UUID NOT NULL,
    ministro_id UUID NOT NULL,
    via INT NOT NULL,
    tipo VARCHAR(30) NOT NULL,
    motivo_reimpressao TEXT NULL,
    operador_id UUID NOT NULL REFERENCES public.users(id),
    impresso_em TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),

    -- Integridade referencial
    CONSTRAINT fk_aemadepa_impressoes_solicitacao
        FOREIGN KEY (solicitacao_id)
        REFERENCES public.aemadepa_carteirinhas_solicitacoes(id)
        ON DELETE RESTRICT,

    CONSTRAINT fk_aemadepa_impressoes_associada
        FOREIGN KEY (associada_id)
        REFERENCES public.aemadepa_associadas(id)
        ON DELETE RESTRICT,

    -- Restrições de tipo de impressão
    CONSTRAINT ck_aemadepa_impressao_tipo
        CHECK (tipo IN ('primeira_impressao', 'reimpressao')),

    -- Reimpressão exige justificativa obrigatória detalhada (mín. 5 chars)
    CONSTRAINT ck_aemadepa_impressao_motivo
        CHECK (tipo <> 'reimpressao' OR (motivo_reimpressao IS NOT NULL AND length(trim(motivo_reimpressao)) >= 5))
);

CREATE INDEX IF NOT EXISTS idx_aemadepa_cart_impressoes_solic
    ON public.aemadepa_carteirinhas_impressoes(solicitacao_id, impresso_em DESC);

CREATE INDEX IF NOT EXISTS idx_aemadepa_cart_impressoes_assoc
    ON public.aemadepa_carteirinhas_impressoes(associada_id, impresso_em DESC);

-- Habilitar RLS e garantir imutabilidade da trilha de auditoria
ALTER TABLE public.aemadepa_carteirinhas_impressoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "aemadepa_impressoes_select" ON public.aemadepa_carteirinhas_impressoes;
CREATE POLICY "aemadepa_impressoes_select"
    ON public.aemadepa_carteirinhas_impressoes
    FOR SELECT
    TO authenticated
    USING (public.is_aemadepa_admin());

DROP POLICY IF EXISTS "aemadepa_impressoes_insert" ON public.aemadepa_carteirinhas_impressoes;
CREATE POLICY "aemadepa_impressoes_insert"
    ON public.aemadepa_carteirinhas_impressoes
    FOR INSERT
    TO authenticated
    WITH CHECK (public.is_aemadepa_admin());

-- Proibição estrita de UPDATE e DELETE na trilha de impressões
DROP POLICY IF EXISTS "aemadepa_impressoes_no_update" ON public.aemadepa_carteirinhas_impressoes;
CREATE POLICY "aemadepa_impressoes_no_update"
    ON public.aemadepa_carteirinhas_impressoes
    FOR UPDATE
    TO authenticated
    USING (false);

DROP POLICY IF EXISTS "aemadepa_impressoes_no_delete" ON public.aemadepa_carteirinhas_impressoes;
CREATE POLICY "aemadepa_impressoes_no_delete"
    ON public.aemadepa_carteirinhas_impressoes
    FOR DELETE
    TO authenticated
    USING (false);

REVOKE ALL ON public.aemadepa_carteirinhas_impressoes FROM PUBLIC;
REVOKE ALL ON public.aemadepa_carteirinhas_impressoes FROM anon;
GRANT SELECT, INSERT ON public.aemadepa_carteirinhas_impressoes TO authenticated;
GRANT ALL ON public.aemadepa_carteirinhas_impressoes TO service_role;

-- ------------------------------------------------------------------------------
-- 5. RPC ATÔMICA CONCORRENTE-SEGURA: QUITAÇÃO MANUAL (À VISTA OU CORTESIA)
--    Garante:
--    a) Validação estrita de autorização RBAC do operador executor (anti-spoofing)
--    b) Bloqueio se houver cobrança ASAAS emitida (asaas_payment_id presente)
--       ou em estado incerto (processando_cobranca / pendência de conciliação)
--    c) SELECT FOR UPDATE serializando associada e solicitação ativa
--    d) Trava obrigatória de foto 3x4
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.quitar_aemadepa_carteirinha_admin(
    p_associada_id UUID,
    p_modalidade VARCHAR, -- 'a_vista' ou 'cortesia'
    p_operador_id UUID,
    p_justificativa_cortesia TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_exec_id UUID;
    v_operador RECORD;
    v_assoc RECORD;
    v_solic RECORD;
    v_proxima_via INT;
    v_agora TIMESTAMPTZ := timezone('utc'::text, now());
    v_idempotency_key VARCHAR;
    v_resultado_id UUID;
    v_resultado_via INT;
    v_resultado_status VARCHAR;
BEGIN
    -- 1. Identifica e valida o operador executor (anti-spoofing)
    -- Se executado via contexto de autenticação Supabase, auth.uid() é a autoridade canônica.
    -- Caso auth.uid() seja nulo (execução via service_role/backend server), p_operador_id é obrigatório.
    v_exec_id := COALESCE(auth.uid(), p_operador_id);

    IF v_exec_id IS NULL THEN
        RAISE EXCEPTION 'Operador não identificado. Ação não autorizada.' USING ERRCODE = '28000';
    END IF;

    -- Se auth.uid() estiver presente e divergir de p_operador_id, impede falsificação de operador
    IF auth.uid() IS NOT NULL AND p_operador_id IS NOT NULL AND auth.uid() <> p_operador_id THEN
        RAISE EXCEPTION 'Inconsistência de operador: spoofing detectado.' USING ERRCODE = '42501';
    END IF;

    -- Validação de perfil administrativo real do operador no banco
    SELECT id, role, is_active
    INTO v_operador
    FROM public.users
    WHERE id = v_exec_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Operador % não encontrado na base de usuários.', v_exec_id USING ERRCODE = '02000';
    END IF;

    IF v_operador.is_active IS FALSE THEN
        RAISE EXCEPTION 'Operador inativo no sistema.' USING ERRCODE = '42501';
    END IF;

    IF LOWER(TRIM(v_operador.role)) NOT IN ('super', 'admin', 'administrador', 'aemadepa') THEN
        RAISE EXCEPTION 'Acesso negado: Perfil % não possui permissão para operações financeiras da AEMADEPA.', v_operador.role USING ERRCODE = '42501';
    END IF;

    -- 2. Validação de parâmetros de modalidade
    IF p_modalidade NOT IN ('a_vista', 'cortesia') THEN
        RAISE EXCEPTION 'Modalidade inválida: %', p_modalidade USING ERRCODE = '22023';
    END IF;

    IF p_modalidade = 'cortesia' AND (p_justificativa_cortesia IS NULL OR length(trim(p_justificativa_cortesia)) < 5) THEN
        RAISE EXCEPTION 'A concessão de cortesia exige justificativa mínima de 5 caracteres.' USING ERRCODE = '22023';
    END IF;

    -- 3. Lock pessimista na associada para serialização estrita
    SELECT id, ministro_id, nome, foto_url
    INTO v_assoc
    FROM public.aemadepa_associadas
    WHERE id = p_associada_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Associada % não encontrada.', p_associada_id USING ERRCODE = '02000';
    END IF;

    -- 4. Trava de foto: obrigatória para autorizar emissão / regularização
    IF v_assoc.foto_url IS NULL OR length(trim(v_assoc.foto_url)) = 0 THEN
        RAISE EXCEPTION 'Não é permitido regularizar financeiramente associada sem foto 3x4 cadastrada.' USING ERRCODE = '22000';
    END IF;

    -- 5. Busca e trava solicitação ativa, se houver
    SELECT *
    INTO v_solic
    FROM public.aemadepa_carteirinhas_solicitacoes
    WHERE associada_id = p_associada_id
      AND status IN ('processando_cobranca', 'aguardando_pagamento', 'pago', 'em_impressao', 'impressa')
    ORDER BY via DESC
    LIMIT 1
    FOR UPDATE;

    -- 6. Se já existe solicitação, analisa conflitos de concorrência e integridade do ASAAS
    IF FOUND THEN
        -- Proteção 6.1: PIX com situação incerta
        IF v_solic.status = 'processando_cobranca' THEN
            RAISE EXCEPTION 'Existe uma cobrança PIX sendo processada no gateway para esta associada. Aguarde a conciliação antes de alterar a quitação.' USING ERRCODE = '55P03';
        END IF;

        -- Proteção 6.2: Já possui cobrança ASAAS emitida ativa (asaas_payment_id presente)
        -- Evita duplicidade de quitação e webhook tardio colidindo com baixa manual
        IF v_solic.asaas_payment_id IS NOT NULL AND length(trim(v_solic.asaas_payment_id)) > 0 THEN
            RAISE EXCEPTION 'Existe uma cobrança PIX ASAAS ativa (%) emitida para esta solicitação. Cancele ou concilie a cobrança oficial antes de registrar pagamento à vista ou cortesia.',
                v_solic.asaas_payment_id USING ERRCODE = '55P03';
        END IF;

        -- Proteção 6.3: Sobrecarga em cobrança já quitada
        IF v_solic.pago_em IS NOT NULL OR v_solic.status IN ('pago', 'em_impressao', 'impressa') THEN
            RAISE EXCEPTION 'A %ª via já se encontra quitada (status: %, forma: %). Não é permitida quitação concorrente.', 
                v_solic.via, v_solic.status, v_solic.forma_pagamento USING ERRCODE = '23505';
        END IF;

        -- Atualização atômica da solicitação existente (que estava 'aguardando_pagamento' SEM cobrança ASAAS vinculada)
        IF p_modalidade = 'a_vista' THEN
            UPDATE public.aemadepa_carteirinhas_solicitacoes
            SET status = 'pago',
                valor = 20.00,
                forma_pagamento = 'a_vista',
                operador_aprovacao_id = v_exec_id,
                pago_em = v_agora,
                updated_at = v_agora,
                observacoes = COALESCE(observacoes || E'\n', '') || '[À Vista] Quitação presencial confirmada no balcão.'
            WHERE id = v_solic.id
            RETURNING id, via, status INTO v_resultado_id, v_resultado_via, v_resultado_status;
        ELSE
            UPDATE public.aemadepa_carteirinhas_solicitacoes
            SET status = 'pago',
                valor = 0.00,
                forma_pagamento = 'cortesia',
                operador_aprovacao_id = v_exec_id,
                motivo_cortesia = trim(p_justificativa_cortesia),
                pago_em = v_agora,
                updated_at = v_agora,
                observacoes = COALESCE(observacoes || E'\n', '') || '[Cortesia Concedida] Motivo: ' || trim(p_justificativa_cortesia)
            WHERE id = v_solic.id
            RETURNING id, via, status INTO v_resultado_id, v_resultado_via, v_resultado_status;
        END IF;

    ELSE
        -- 7. Se não existia solicitação aberta, cria diretamente uma nova via quitada
        SELECT COALESCE(MAX(via), 0) + 1
        INTO v_proxima_via
        FROM public.aemadepa_carteirinhas_solicitacoes
        WHERE associada_id = p_associada_id;

        v_idempotency_key := 'cart:' || p_associada_id::text || ':v' || v_proxima_via::text || ':' || p_modalidade || ':' || extract(epoch from v_agora)::bigint;

        IF p_modalidade = 'a_vista' THEN
            INSERT INTO public.aemadepa_carteirinhas_solicitacoes (
                associada_id, ministro_id, valor, via, forma_pagamento, operador_aprovacao_id,
                idempotency_key, status, solicitado_em, pago_em, observacoes
            ) VALUES (
                p_associada_id, v_assoc.ministro_id, 20.00, v_proxima_via, 'a_vista', v_exec_id,
                v_idempotency_key, 'pago', v_agora, v_agora, '[À Vista] Nova via gerada com quitação presencial confirmada.'
            )
            RETURNING id, via, status INTO v_resultado_id, v_resultado_via, v_resultado_status;
        ELSE
            INSERT INTO public.aemadepa_carteirinhas_solicitacoes (
                associada_id, ministro_id, valor, via, forma_pagamento, operador_aprovacao_id,
                motivo_cortesia, idempotency_key, status, solicitado_em, pago_em, observacoes
            ) VALUES (
                p_associada_id, v_assoc.ministro_id, 0.00, v_proxima_via, 'cortesia', v_exec_id,
                trim(p_justificativa_cortesia), v_idempotency_key, 'pago', v_agora, v_agora, '[Cortesia Concedida] Motivo: ' || trim(p_justificativa_cortesia)
            )
            RETURNING id, via, status INTO v_resultado_id, v_resultado_via, v_resultado_status;
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'sucesso', true,
        'solicitacao_id', v_resultado_id,
        'via', v_resultado_via,
        'status', v_resultado_status,
        'modalidade', p_modalidade,
        'operador_id', v_exec_id
    );
END;
$$;

REVOKE ALL ON FUNCTION public.quitar_aemadepa_carteirinha_admin FROM PUBLIC;
REVOKE ALL ON FUNCTION public.quitar_aemadepa_carteirinha_admin FROM anon;
GRANT EXECUTE ON FUNCTION public.quitar_aemadepa_carteirinha_admin TO authenticated;
GRANT EXECUTE ON FUNCTION public.quitar_aemadepa_carteirinha_admin TO service_role;
