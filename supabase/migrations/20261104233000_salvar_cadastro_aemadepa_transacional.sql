-- ==============================================================================
-- SISCOMIEADEPA — MIGRATION: OPERAÇÃO TRANSACIONAL ATÔMICA AEMADEPA
-- Arquivo: supabase/migrations/20261104233000_salvar_cadastro_aemadepa_transacional.sql
-- Objetivo: Salvar dados da associada e sincronizar ficha ministerial em única
--           transação PostgreSQL (RPC atômica com rollback automático em caso de erro).
-- Regras de Segurança:
-- 1. Impede que CPF já existente seja usurpado por outro ministro_id.
-- 2. Preserva o status atual da associada na edição (usa 'pendente' apenas no primeiro cadastro).
-- 3. search_path travado em public, pg_temp.
-- 4. Executável exclusivamente por service_role (backend autenticado com token HMAC).
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.salvar_cadastro_aemadepa_transacional(
    p_ministro_id UUID,
    p_operacao TEXT, -- 'primeiro_cadastro' ou 'edicao_esposa'
    p_nome TEXT,
    p_cpf TEXT,
    p_data_nascimento DATE,
    p_rg TEXT DEFAULT NULL,
    p_orgao_emissor TEXT DEFAULT NULL,
    p_nacionalidade TEXT DEFAULT 'BRASILEIRA',
    p_naturalidade TEXT DEFAULT NULL,
    p_tipo_sanguineo TEXT DEFAULT NULL,
    p_nome_pai TEXT DEFAULT NULL,
    p_nome_mae TEXT DEFAULT NULL,
    p_titulo_eleitoral TEXT DEFAULT NULL,
    p_fone TEXT DEFAULT NULL,
    p_email TEXT DEFAULT NULL,
    p_foto_url TEXT DEFAULT NULL,
    p_numero_aemadepa TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_clean_cpf TEXT;
    v_clean_nome TEXT;
    v_ministro RECORD;
    v_associada_existente RECORD;
    v_associada_id UUID;
    v_status_final TEXT;
    v_custom_fields JSONB;
BEGIN
    -- 1. Normalização e Validações Iniciais
    v_clean_cpf := regexp_replace(COALESCE(p_cpf, ''), '\D', '', 'g');
    v_clean_nome := trim(COALESCE(p_nome, ''));

    IF length(v_clean_cpf) <> 11 THEN
        RETURN jsonb_build_object('success', false, 'error', 'CPF da associada deve conter exatamente 11 dígitos.');
    END IF;

    IF length(v_clean_nome) < 3 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Nome da associada inválido ou muito curto.');
    END IF;

    IF p_data_nascimento IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Data de nascimento da associada é obrigatória.');
    END IF;

    -- 2. Verifica se o ministro existe
    SELECT * INTO v_ministro FROM public.members WHERE id = p_ministro_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Ministro vinculado não encontrado no sistema.');
    END IF;

    -- 3. Blindagem de Vínculo e Antiusurpação de CPF
    -- Verifica se já existe associada com este CPF
    SELECT * INTO v_associada_existente FROM public.aemadepa_associadas WHERE cpf = v_clean_cpf;

    IF FOUND THEN
        -- O CPF já existe na AEMADEPA: deve pertencer obrigatoriamente a este mesmo ministro!
        IF v_associada_existente.ministro_id <> p_ministro_id THEN
            RETURN jsonb_build_object(
                'success', false,
                'error', 'Este CPF já está cadastrado e vinculado a outro ministro. Regularização deve ser feita na Secretaria.'
            );
        END IF;

        -- Na edição, preserva o status atual da associada
        v_status_final := v_associada_existente.status;
        v_associada_id := v_associada_existente.id;
    ELSE
        -- CPF novo: verifica se o ministro já possui outra esposa associada cadastrada
        SELECT * INTO v_associada_existente FROM public.aemadepa_associadas WHERE ministro_id = p_ministro_id;
        IF FOUND THEN
            -- Ministro já possui associada mas com outro CPF: na edição com troca de CPF deve ser consistente
            IF p_operacao <> 'edicao_esposa' THEN
                RETURN jsonb_build_object(
                    'success', false,
                    'error', 'Este ministro já possui associada cadastrada. Utilize a opção de edição de dados.'
                );
            END IF;
            v_status_final := v_associada_existente.status;
            v_associada_id := v_associada_existente.id;
        ELSE
            -- Primeiro cadastro real: define status como 'pendente'
            v_status_final := 'pendente';
            v_associada_id := gen_random_uuid();
        END IF;
    END IF;

    -- 4. Operação Transacional na tabela aemadepa_associadas
    INSERT INTO public.aemadepa_associadas (
        id,
        ministro_id,
        nome,
        cpf,
        rg,
        orgao_emissor,
        data_nascimento,
        nacionalidade,
        naturalidade,
        tipo_sanguineo,
        nome_pai,
        nome_mae,
        titulo_eleitoral,
        fone,
        email,
        foto_url,
        numero_aemadepa,
        status,
        custom_fields,
        updated_at
    ) VALUES (
        v_associada_id,
        p_ministro_id,
        v_clean_nome,
        v_clean_cpf,
        nullif(trim(p_rg), ''),
        nullif(trim(p_orgao_emissor), ''),
        p_data_nascimento,
        COALESCE(nullif(trim(p_nacionalidade), ''), 'BRASILEIRA'),
        nullif(trim(p_naturalidade), ''),
        nullif(trim(p_tipo_sanguineo), ''),
        nullif(trim(p_nome_pai), ''),
        nullif(trim(p_nome_mae), ''),
        nullif(trim(p_titulo_eleitoral), ''),
        nullif(trim(p_fone), ''),
        nullif(trim(p_email), ''),
        nullif(trim(p_foto_url), ''),
        COALESCE(nullif(trim(p_numero_aemadepa), ''), v_associada_existente.numero_aemadepa),
        v_status_final,
        COALESCE(v_associada_existente.custom_fields, '{}'::jsonb) || jsonb_build_object(
            'origem_gravacao', 'rpc_transacional_aemadepa',
            'matricula_esposo', COALESCE(v_ministro.matricula, ''),
            'atualizado_em', timezone('utc', now())::text
        ),
        timezone('utc', now())
    )
    ON CONFLICT (id) DO UPDATE SET
        ministro_id = EXCLUDED.ministro_id,
        nome = EXCLUDED.nome,
        cpf = EXCLUDED.cpf,
        rg = EXCLUDED.rg,
        orgao_emissor = EXCLUDED.orgao_emissor,
        data_nascimento = EXCLUDED.data_nascimento,
        nacionalidade = EXCLUDED.nacionalidade,
        naturalidade = EXCLUDED.naturalidade,
        tipo_sanguineo = EXCLUDED.tipo_sanguineo,
        nome_pai = EXCLUDED.nome_pai,
        nome_mae = EXCLUDED.nome_mae,
        titulo_eleitoral = EXCLUDED.titulo_eleitoral,
        fone = EXCLUDED.fone,
        email = EXCLUDED.email,
        foto_url = COALESCE(EXCLUDED.foto_url, aemadepa_associadas.foto_url),
        numero_aemadepa = COALESCE(EXCLUDED.numero_aemadepa, aemadepa_associadas.numero_aemadepa),
        custom_fields = EXCLUDED.custom_fields,
        updated_at = timezone('utc', now());

    -- 5. Sincronização Atômica na ficha ministerial (members)
    v_custom_fields := COALESCE(v_ministro.custom_fields, '{}'::jsonb) || jsonb_build_object(
        'nomeConjuge', v_clean_nome,
        'cpfConjuge', v_clean_cpf,
        'dataNascimentoConjuge', p_data_nascimento::text,
        'conjugeRg', COALESCE(nullif(trim(p_rg), ''), ''),
        'conjugeOrgaoEmissor', COALESCE(nullif(trim(p_orgao_emissor), ''), ''),
        'conjugeNacionalidade', COALESCE(nullif(trim(p_nacionalidade), ''), 'BRASILEIRA'),
        'conjugeNaturalidade', COALESCE(nullif(trim(p_naturalidade), ''), ''),
        'conjugeNomePai', COALESCE(nullif(trim(p_nome_pai), ''), ''),
        'conjugeNomeMae', COALESCE(nullif(trim(p_nome_mae), ''), ''),
        'conjugeTituloEleitoral', COALESCE(nullif(trim(p_titulo_eleitoral), ''), ''),
        'conjugeFone', COALESCE(nullif(trim(p_fone), ''), ''),
        'conjugeEmail', COALESCE(nullif(trim(p_email), ''), ''),
        'conjugeTipoSanguineo', COALESCE(nullif(trim(p_tipo_sanguineo), ''), ''),
        'conjugeFotoUrl', COALESCE(nullif(trim(p_foto_url), ''), v_ministro.conjuge_foto_url, ''),
        'numero_aemadepa', COALESCE(nullif(trim(p_numero_aemadepa), ''), v_ministro.custom_fields->>'numero_aemadepa', ''),
        'numeroAemadepa', COALESCE(nullif(trim(p_numero_aemadepa), ''), v_ministro.custom_fields->>'numeroAemadepa', '')
    );

    UPDATE public.members
    SET
        nome_conjuge = v_clean_nome,
        cpf_conjuge = v_clean_cpf,
        data_nascimento_conjuge = p_data_nascimento,
        conjuge_rg = nullif(trim(p_rg), ''),
        conjuge_orgao_emissor = nullif(trim(p_orgao_emissor), ''),
        conjuge_nacionalidade = COALESCE(nullif(trim(p_nacionalidade), ''), 'BRASILEIRA'),
        conjuge_naturalidade = nullif(trim(p_naturalidade), ''),
        conjuge_nome_pai = nullif(trim(p_nome_pai), ''),
        conjuge_nome_mae = nullif(trim(p_nome_mae), ''),
        conjuge_titulo_eleitoral = nullif(trim(p_titulo_eleitoral), ''),
        conjuge_fone = nullif(trim(p_fone), ''),
        conjuge_email = nullif(trim(p_email), ''),
        conjuge_tipo_sanguineo = nullif(trim(p_tipo_sanguineo), ''),
        conjuge_foto_url = COALESCE(nullif(trim(p_foto_url), ''), conjuge_foto_url),
        custom_fields = v_custom_fields,
        updated_at = timezone('utc', now())
    WHERE id = p_ministro_id;

    RETURN jsonb_build_object(
        'success', true,
        'associada_id', v_associada_id,
        'status', v_status_final,
        'message', 'Cadastro e sincronização realizados com sucesso atômico.'
    );
EXCEPTION
    WHEN OTHERS THEN
        -- Qualquer exceção causa ROLLBACK automático no PostgreSQL
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Erro interno na transação: ' || SQLERRM
        );
END;
$$;

-- Restrição de privilégios de execução
REVOKE ALL ON FUNCTION public.salvar_cadastro_aemadepa_transacional(UUID, TEXT, TEXT, TEXT, DATE, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.salvar_cadastro_aemadepa_transacional(UUID, TEXT, TEXT, TEXT, DATE, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.salvar_cadastro_aemadepa_transacional(UUID, TEXT, TEXT, TEXT, DATE, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;
