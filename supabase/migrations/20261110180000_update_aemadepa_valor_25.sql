-- ==============================================================================
-- MIGRAÇÃO: Atualização do Valor Oficial da Carteirinha AEMADEPA para R$ 25,00
-- Data: 2026-11-10
--
-- Objetivos:
-- 1. Atualizar o valor padrão (DEFAULT) da coluna valor para 25.00
-- 2. Atualizar a constraint ck_aemadepa_cart_valor_forma para aceitar tanto 20.00
--    (histórico/legado imutável) quanto 25.00 (novo valor oficial), além de 0.00 (cortesia)
-- 3. Atualizar a RPC quitar_aemadepa_carteirinha_admin para aplicar 25.00 nos novos
--    pagamentos à vista ou 2ª via sem afetar registros quitados anteriores
-- ==============================================================================

-- 1. Atualizar DEFAULT da coluna valor para 25.00
ALTER TABLE public.aemadepa_carteirinhas_solicitacoes
    ALTER COLUMN valor SET DEFAULT 25.00;

-- 2. Atualizar constraint de validação de valor e forma de pagamento
-- Permite:
-- - Cortesia: valor = 0.00 com justificativa >= 5 caracteres
-- - Pagamentos pix_asaas e a_vista: valor = 25.00 (novo padrão) OU 20.00 (preservação do histórico e de cobranças já emitidas)
ALTER TABLE public.aemadepa_carteirinhas_solicitacoes
    DROP CONSTRAINT IF EXISTS ck_aemadepa_cart_valor_forma;

ALTER TABLE public.aemadepa_carteirinhas_solicitacoes
    ADD CONSTRAINT ck_aemadepa_cart_valor_forma 
        CHECK (
            (forma_pagamento = 'cortesia' AND valor = 0.00 AND motivo_cortesia IS NOT NULL AND length(trim(motivo_cortesia)) >= 5) OR
            (forma_pagamento IN ('pix_asaas', 'a_vista') AND (valor = 25.00 OR valor = 20.00))
        );

-- 3. Atualizar RPC de regularização financeira no painel
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
    v_exec_id := COALESCE(auth.uid(), p_operador_id);

    IF v_exec_id IS NULL THEN
        RAISE EXCEPTION 'Operador não identificado. Ação não autorizada.' USING ERRCODE = '28000';
    END IF;

    IF auth.uid() IS NOT NULL AND p_operador_id IS NOT NULL AND auth.uid() <> p_operador_id THEN
        RAISE EXCEPTION 'Inconsistência de operador: spoofing detectado.' USING ERRCODE = '42501';
    END IF;

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

    -- Trava obrigatória de foto 3x4
    IF v_assoc.foto_url IS NULL OR length(trim(v_assoc.foto_url)) = 0 THEN
        RAISE EXCEPTION 'Não é permitido regularizar financeiramente associada sem foto 3x4 cadastrada.' USING ERRCODE = '22000';
    END IF;

    -- 4. Busca e trava a solicitação ativa (se existir)
    SELECT id, via, status, forma_pagamento, valor, asaas_payment_id, pago_em, observacoes
    INTO v_solic
    FROM public.aemadepa_carteirinhas_solicitacoes
    WHERE associada_id = p_associada_id
      AND status IN ('processando_cobranca', 'aguardando_pagamento', 'pago', 'em_impressao', 'impressa')
    ORDER BY via DESC
    LIMIT 1
    FOR UPDATE;

    -- 5. Validações de integridade financeira
    IF v_solic.id IS NOT NULL THEN
        IF v_solic.status = 'processando_cobranca' THEN
            RAISE EXCEPTION 'Existe uma requisição de cobrança ASAAS em processamento no gateway para esta associada. Aguarde a finalização.' USING ERRCODE = '55P03';
        END IF;

        IF v_solic.asaas_payment_id IS NOT NULL AND length(trim(v_solic.asaas_payment_id)) > 0 THEN
            RAISE EXCEPTION 'Existe uma cobrança PIX ASAAS ativa (%) emitida para esta solicitação. É proibido dar baixa manual sem conciliar ou cancelar a cobrança oficial prévia.', 
                v_solic.asaas_payment_id USING ERRCODE = '23505';
        END IF;

        IF v_solic.pago_em IS NOT NULL OR v_solic.status IN ('pago', 'em_impressao', 'impressa') THEN
            RAISE EXCEPTION 'A %ª via já se encontra quitada (status: %, forma: %). Não é permitida quitação concorrente.', 
                v_solic.via, v_solic.status, v_solic.forma_pagamento USING ERRCODE = '23505';
        END IF;

        -- Atualização atômica da solicitação existente
        IF p_modalidade = 'a_vista' THEN
            UPDATE public.aemadepa_carteirinhas_solicitacoes
            SET status = 'pago',
                valor = 25.00,
                forma_pagamento = 'a_vista',
                operador_aprovacao_id = v_exec_id,
                pago_em = v_agora,
                updated_at = v_agora,
                observacoes = COALESCE(observacoes || E'\n', '') || '[À Vista] Quitação presencial confirmada no balcão (R$ 25,00).'
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
        -- 6. Se não existia solicitação aberta, cria diretamente uma nova via quitada
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
                p_associada_id, v_assoc.ministro_id, 25.00, v_proxima_via, 'a_vista', v_exec_id,
                v_idempotency_key, 'pago', v_agora, v_agora, '[À Vista] Nova via gerada com quitação presencial confirmada (R$ 25,00).'
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
        'valor', CASE WHEN p_modalidade = 'a_vista' THEN 25.00 ELSE 0.00 END
    );
END;
$$;
