-- ==============================================================================
-- MIGRATION: 20261027123000_registrar_consumo_refeicao_atomico.sql
-- OBJETIVO: Operação Transacional Atômica com Row-Lock para Débito Alimentar
-- PREVINE: Débitos concorrentes, saldo negativo, perda de atualização e escrita parcial
-- SEGURANÇA: Validação estrita de evento, inscrição, operador, local_id e modalidade
-- IDEMPOTÊNCIA: Campo estrutural idempotency_key com índice único parcial
-- PERMISSÕES: EXCLUSIVAMENTE service_role e postgres (revogado de authenticated e public)
-- ==============================================================================

-- 1. ALTERAÇÃO ESTRUTURAL: Campo próprio para chave de idempotência com índice único parcial
ALTER TABLE public.evento_refeicoes_consumo
    ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_evento_refeicoes_idempotency_key
    ON public.evento_refeicoes_consumo (idempotency_key)
    WHERE idempotency_key IS NOT NULL;

-- 2. FUNÇÃO TRANSACIONAL ATÔMICA
CREATE OR REPLACE FUNCTION public.registrar_consumo_refeicao_atomico(
    p_evento_id UUID,
    p_inscricao_id UUID,
    p_qr_code TEXT,
    p_equipe_id UUID,
    p_user_id UUID,
    p_checkin_user TEXT,
    p_idempotency_key TEXT DEFAULT NULL,
    p_janela_duplicidade_segundos INT DEFAULT 20
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_evento RECORD;
    v_op RECORD;
    v_local RECORD;
    v_insc RECORD;
    v_consumo_recente RECORD;
    v_resolved_local_id UUID := NULL;
    v_clean_idempotency_key TEXT := NULL;
    v_status_pag TEXT;
    v_valor_final NUMERIC;
    v_exige_pagamento BOOLEAN;
    v_saldo_antes INT;
    v_saldo_depois INT;
    v_total INT;
    v_usadas INT;
    v_delta_segundos NUMERIC;
    v_consumo_id UUID;
    v_checkin_id UUID;
BEGIN
    -- Limpeza defensiva da chave de idempotência
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
        v_clean_idempotency_key := btrim(p_idempotency_key);
    END IF;

    -- 1. Validação server-side do Evento (não confia em parâmetros externos)
    SELECT id, status, checkin_ativo
    INTO v_evento
    FROM public.eventos
    WHERE id = p_evento_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('sucesso', false, 'status', 'evento_nao_encontrado', 'mensagem', 'Evento não encontrado.');
    END IF;

    IF v_evento.status <> 'programado' THEN
        RETURN jsonb_build_object('sucesso', false, 'status', 'evento_encerrado', 'mensagem', 'Evento encerrado ou cancelado.');
    END IF;

    IF v_evento.checkin_ativo IS NOT TRUE THEN
        RETURN jsonb_build_object('sucesso', false, 'status', 'checkin_desativado', 'mensagem', 'Check-in desativado para este evento.');
    END IF;

    -- 2. Validação server-side do Operador de Equipe e Local vinculado
    -- Se p_equipe_id for fornecido (terminal de operador de campo)
    IF p_equipe_id IS NOT NULL THEN
        SELECT id, evento_id, tipo, ativo, local_id
        INTO v_op
        FROM public.evento_equipe
        WHERE id = p_equipe_id AND evento_id = p_evento_id;

        IF NOT FOUND OR v_op.ativo IS NOT TRUE THEN
            RETURN jsonb_build_object('sucesso', false, 'status', 'operador_inativo', 'mensagem', 'Operador não autorizado ou inativo.');
        END IF;

        IF v_op.local_id IS NOT NULL THEN
            SELECT id, evento_id, tipo, nome, ativo
            INTO v_local
            FROM public.evento_locais_checkin
            WHERE id = v_op.local_id AND evento_id = p_evento_id;

            IF NOT FOUND THEN
                RETURN jsonb_build_object('sucesso', false, 'status', 'local_nao_encontrado', 'mensagem', 'Local vinculado ao operador não encontrado neste evento.');
            END IF;

            IF v_local.ativo IS NOT TRUE THEN
                RETURN jsonb_build_object('sucesso', false, 'status', 'local_inativo', 'mensagem', 'O local vinculado a este operador está inativo.');
            END IF;

            IF v_local.tipo <> 'refeitorio' THEN
                RETURN jsonb_build_object('sucesso', false, 'status', 'modalidade_incompativel', 'mensagem', 'Operação incompatível: este terminal está vinculado a uma plenária e não pode debitar refeições.');
            END IF;

            v_resolved_local_id := v_local.id;
        END IF;
    ELSE
        -- Operação administrativa global: p_equipe_id é NULL, o local é NULL
        v_resolved_local_id := NULL;
    END IF;

    -- 3. Idempotência por campo próprio estrutural (idempotency_key)
    IF v_clean_idempotency_key IS NOT NULL THEN
        SELECT id, saldo_antes, saldo_depois, data_hora
        INTO v_consumo_recente
        FROM public.evento_refeicoes_consumo
        WHERE idempotency_key = v_clean_idempotency_key
        LIMIT 1;

        IF FOUND THEN
            RETURN jsonb_build_object(
                'sucesso', true,
                'status', 'success',
                'idempotente', true,
                'mensagem', 'Operação já confirmada anteriormente com esta chave de leitura.',
                'saldo_antes', v_consumo_recente.saldo_antes,
                'saldo_depois', v_consumo_recente.saldo_depois,
                'consumo_id', v_consumo_recente.id
            );
        END IF;
    END IF;

    -- 4. Trava Atômica Exclusiva da Linha da Inscrição (FOR UPDATE)
    SELECT
        id,
        evento_id,
        nome_inscrito,
        alimentacao,
        status_pagamento,
        valor_final,
        valor_pago,
        tipo_inscricao,
        COALESCE(quantidade_refeicoes_total, refeicoes_total, 0) AS total,
        COALESCE(quantidade_refeicoes_usadas, refeicoes_utilizadas, 0) AS usadas,
        COALESCE(quantidade_refeicoes_saldo, 0) AS saldo
    INTO v_insc
    FROM public.evento_inscricoes
    WHERE id = p_inscricao_id AND evento_id = p_evento_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('sucesso', false, 'status', 'not_found', 'mensagem', 'Inscrição não encontrada para este evento.');
    END IF;

    -- 5. Validação de Alimentação Habilitada
    IF v_insc.alimentacao IS NOT TRUE THEN
        RETURN jsonb_build_object('sucesso', false, 'status', 'sem_alimentacao', 'mensagem', 'Inscrição não possui alimentação inclusa.');
    END IF;

    -- 6. Validação de Regularidade Financeira (Alinhada exatamente às regras vigentes da inscrição)
    -- Participante isento, cortesia ou com modalidade gratuita (valor_final = 0) é SEMPRE liberado
    v_status_pag := LOWER(COALESCE(v_insc.status_pagamento, ''));
    v_valor_final := COALESCE(v_insc.valor_final, v_insc.valor_pago, 0);
    v_exige_pagamento := (v_valor_final > 0);

    IF v_exige_pagamento AND v_status_pag NOT IN ('pago', 'isento') THEN
        RETURN jsonb_build_object('sucesso', false, 'status', 'pagamento_pendente', 'mensagem', 'Aguarde a confirmação do pagamento para liberar o acesso.');
    END IF;

    -- 7. Proteção contra Leituras Concorrentes ou Duplicadas Rápidas (Janela temporal anti-duplo clique)
    SELECT id, data_hora, saldo_antes, saldo_depois
    INTO v_consumo_recente
    FROM public.evento_refeicoes_consumo
    WHERE evento_id = p_evento_id
      AND inscricao_id = p_inscricao_id
      AND origem = 'refeitorio'
    ORDER BY data_hora DESC
    LIMIT 1;

    IF FOUND THEN
        v_delta_segundos := EXTRACT(EPOCH FROM (clock_timestamp() - v_consumo_recente.data_hora));
        IF v_delta_segundos >= 0 AND v_delta_segundos <= p_janela_duplicidade_segundos THEN
            RETURN jsonb_build_object(
                'sucesso', false,
                'status', 'duplicate_rapida',
                'mensagem', 'Check-in repetido em menos de ' || p_janela_duplicidade_segundos || ' segundos. Aguarde um instante.',
                'saldo_antes', v_consumo_recente.saldo_antes,
                'saldo_depois', v_consumo_recente.saldo_depois,
                'ultima_leitura_em', v_consumo_recente.data_hora
            );
        END IF;
    END IF;

    -- 8. Validação e Cálculo de Saldo
    v_total := v_insc.total;
    v_usadas := v_insc.usadas;
    v_saldo_antes := GREATEST(0, v_total - v_usadas);

    IF v_insc.saldo < v_saldo_antes THEN
        v_saldo_antes := v_insc.saldo;
    END IF;

    IF v_saldo_antes <= 0 THEN
        RETURN jsonb_build_object(
            'sucesso', false,
            'status', 'sem_saldo',
            'mensagem', 'Inscrição sem saldo de refeições disponíveis.',
            'saldo_antes', 0,
            'saldo_depois', 0
        );
    END IF;

    -- 9. Decremento Atômico de 1 unidade
    v_saldo_depois := v_saldo_antes - 1;
    v_usadas := v_usadas + 1;

    UPDATE public.evento_inscricoes
    SET
        quantidade_refeicoes_total = v_total,
        quantidade_refeicoes_usadas = v_usadas,
        quantidade_refeicoes_saldo = v_saldo_depois,
        refeicoes_total = v_total,
        refeicoes_utilizadas = v_usadas
    WHERE id = p_inscricao_id;

    -- 10. Gravação em evento_refeicoes_consumo (Preserva qr_code original e grava chave de idempotência)
    INSERT INTO public.evento_refeicoes_consumo (
        evento_id,
        inscricao_id,
        qr_code,
        tipo_consumo,
        operador_id,
        origem,
        saldo_antes,
        saldo_depois,
        local_id,
        idempotency_key
    ) VALUES (
        p_evento_id,
        p_inscricao_id,
        p_qr_code,
        'refeicao',
        p_user_id,
        'refeitorio',
        v_saldo_antes,
        v_saldo_depois,
        v_resolved_local_id,
        v_clean_idempotency_key
    ) RETURNING id INTO v_consumo_id;

    -- 11. Gravação em evento_checkins (Registro Oficial de Acesso)
    INSERT INTO public.evento_checkins (
        evento_id,
        inscricao_id,
        metodo,
        tipo_checkin,
        saldo_antes,
        saldo_depois,
        checkin_user,
        local_id
    ) VALUES (
        p_evento_id,
        p_inscricao_id,
        'qrcode',
        'refeitorio',
        v_saldo_antes,
        v_saldo_depois,
        p_checkin_user,
        v_resolved_local_id
    ) RETURNING id INTO v_checkin_id;

    -- Retorno Oficial Consolidado
    RETURN jsonb_build_object(
        'sucesso', true,
        'status', 'success',
        'saldo_antes', v_saldo_antes,
        'saldo_depois', v_saldo_depois,
        'quantidade_refeicoes_total', v_total,
        'quantidade_refeicoes_usadas', v_usadas,
        'consumo_id', v_consumo_id,
        'checkin_id', v_checkin_id
    );
END;
$$;

-- 3. PERMISSÕES DE EXECUÇÃO: EXCLUSIVAMENTE service_role e postgres
-- Revoga qualquer permissão prévia ou herdada concedida a PUBLIC, anon ou authenticated
REVOKE ALL ON FUNCTION public.registrar_consumo_refeicao_atomico(UUID, UUID, TEXT, UUID, UUID, TEXT, TEXT, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.registrar_consumo_refeicao_atomico(UUID, UUID, TEXT, UUID, UUID, TEXT, TEXT, INT) FROM anon;
REVOKE ALL ON FUNCTION public.registrar_consumo_refeicao_atomico(UUID, UUID, TEXT, UUID, UUID, TEXT, TEXT, INT) FROM authenticated;

-- Permite execução estritamente pela API backend server-side com a service_role key
GRANT EXECUTE ON FUNCTION public.registrar_consumo_refeicao_atomico(UUID, UUID, TEXT, UUID, UUID, TEXT, TEXT, INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.registrar_consumo_refeicao_atomico(UUID, UUID, TEXT, UUID, UUID, TEXT, TEXT, INT) TO postgres;
