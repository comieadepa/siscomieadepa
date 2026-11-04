-- Migration: 20261104_modulo_comissoes_fase1.sql
-- Descrição: Estrutura inicial do módulo de Comissões e Grupos de Trabalho com histórico de integrantes, RLS seguro e RPC transacional

-- 1. Tabela de Comissões
CREATE TABLE IF NOT EXISTS public.comissoes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome VARCHAR(255) NOT NULL,
    sigla VARCHAR(50),
    finalidade TEXT NOT NULL,
    tipo VARCHAR(50) NOT NULL DEFAULT 'permanente' CHECK (tipo IN ('permanente', 'temporaria', 'especial', 'ago')),
    status VARCHAR(50) NOT NULL DEFAULT 'ativa' CHECK (status IN ('ativa', 'inativa', 'concluida', 'suspensa')),
    ato_nomeacao VARCHAR(100), -- Ex: Portaria 001/2026, Resolução da Mesa, Ata AGO
    data_inicio DATE NOT NULL DEFAULT CURRENT_DATE,
    data_fim DATE,
    ano_referencia INTEGER DEFAULT EXTRACT(YEAR FROM CURRENT_DATE),
    evento_id UUID REFERENCES public.eventos(id) ON DELETE SET NULL, -- Vínculo opcional com AGO/Evento
    observacoes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    deleted_at TIMESTAMPTZ -- Soft delete
);

-- Índices de comissões
CREATE INDEX IF NOT EXISTS idx_comissoes_status ON public.comissoes(status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_comissoes_tipo ON public.comissoes(tipo) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_comissoes_evento ON public.comissoes(evento_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_comissoes_ano ON public.comissoes(ano_referencia) WHERE deleted_at IS NULL;

-- 2. Tabela de Integrantes da Comissão (Composição e Histórico)
CREATE TABLE IF NOT EXISTS public.comissao_integrantes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    comissao_id UUID NOT NULL REFERENCES public.comissoes(id) ON DELETE RESTRICT,
    ministro_id UUID NOT NULL REFERENCES public.members(id) ON DELETE RESTRICT,
    cargo VARCHAR(100) NOT NULL, -- 'Presidente', 'Vice-Presidente', 'Relator', '1º Secretário', '2º Secretário', 'Membro' ou cargo customizado
    ordem_hierarquia INTEGER NOT NULL DEFAULT 99, -- 1=Presidente, 2=Vice, 3=Relator, etc.
    status VARCHAR(50) NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'substituido', 'licenciado', 'desligado')),
    data_entrada DATE NOT NULL DEFAULT CURRENT_DATE,
    data_saida DATE,
    motivo_saida TEXT,
    substituido_por_id UUID REFERENCES public.members(id) ON DELETE RESTRICT,
    observacoes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    deleted_at TIMESTAMPTZ -- Soft delete
);

-- Índices de integrantes
CREATE INDEX IF NOT EXISTS idx_comissao_integrantes_comissao ON public.comissao_integrantes(comissao_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_comissao_integrantes_ministro ON public.comissao_integrantes(ministro_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_comissao_integrantes_status ON public.comissao_integrantes(status) WHERE deleted_at IS NULL;

-- 3. Índice ÚNICO parcial para impedir duplicidade de designações ativas do mesmo ministro na mesma comissão
CREATE UNIQUE INDEX IF NOT EXISTS uq_comissao_integrante_ativo
ON public.comissao_integrantes (comissao_id, ministro_id)
WHERE status = 'ativo' AND deleted_at IS NULL;

-- 4. Reutilização dos triggers de updated_at com a função padrão existente no schema public.set_updated_at()
DROP TRIGGER IF EXISTS trg_comissoes_updated_at ON public.comissoes;
CREATE TRIGGER trg_comissoes_updated_at
BEFORE UPDATE ON public.comissoes
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_comissao_integrantes_updated_at ON public.comissao_integrantes;
CREATE TRIGGER trg_comissao_integrantes_updated_at
BEFORE UPDATE ON public.comissao_integrantes
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

-- 5. Habilitar Row Level Security (RLS)
ALTER TABLE public.comissoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comissao_integrantes ENABLE ROW LEVEL SECURITY;

-- 5.1 Políticas de RLS para comissoes
-- Leitura: 'super', 'administrador', 'comissao'
CREATE POLICY "Leitura de comissoes por perfis autorizados"
ON public.comissoes FOR SELECT
TO authenticated
USING (
    deleted_at IS NULL
    AND (
        auth.jwt() ->> 'role' IN ('super', 'administrador', 'comissao')
        OR (auth.jwt() -> 'user_metadata' ->> 'role') IN ('super', 'administrador', 'comissao')
    )
);

-- Escrita administrativa exclusiva: apenas 'super' e 'administrador'
CREATE POLICY "Gerenciamento de comissoes por administradores"
ON public.comissoes FOR INSERT
TO authenticated
WITH CHECK (
    auth.jwt() ->> 'role' IN ('super', 'administrador')
    OR (auth.jwt() -> 'user_metadata' ->> 'role') IN ('super', 'administrador')
);

CREATE POLICY "Atualizacao de comissoes por administradores"
ON public.comissoes FOR UPDATE
TO authenticated
USING (
    auth.jwt() ->> 'role' IN ('super', 'administrador')
    OR (auth.jwt() -> 'user_metadata' ->> 'role') IN ('super', 'administrador')
)
WITH CHECK (
    auth.jwt() ->> 'role' IN ('super', 'administrador')
    OR (auth.jwt() -> 'user_metadata' ->> 'role') IN ('super', 'administrador')
);

CREATE POLICY "Exclusao de comissoes por administradores"
ON public.comissoes FOR DELETE
TO authenticated
USING (
    auth.jwt() ->> 'role' IN ('super', 'administrador')
    OR (auth.jwt() -> 'user_metadata' ->> 'role') IN ('super', 'administrador')
);

-- 5.2 Políticas de RLS para comissao_integrantes
-- Leitura: 'super', 'administrador', 'comissao'
CREATE POLICY "Leitura de integrantes por perfis autorizados"
ON public.comissao_integrantes FOR SELECT
TO authenticated
USING (
    deleted_at IS NULL
    AND (
        auth.jwt() ->> 'role' IN ('super', 'administrador', 'comissao')
        OR (auth.jwt() -> 'user_metadata' ->> 'role') IN ('super', 'administrador', 'comissao')
    )
);

-- Escrita administrativa exclusiva: apenas 'super' e 'administrador'
CREATE POLICY "Insercao de integrantes por administradores"
ON public.comissao_integrantes FOR INSERT
TO authenticated
WITH CHECK (
    auth.jwt() ->> 'role' IN ('super', 'administrador')
    OR (auth.jwt() -> 'user_metadata' ->> 'role') IN ('super', 'administrador')
);

CREATE POLICY "Atualizacao de integrantes por administradores"
ON public.comissao_integrantes FOR UPDATE
TO authenticated
USING (
    auth.jwt() ->> 'role' IN ('super', 'administrador')
    OR (auth.jwt() -> 'user_metadata' ->> 'role') IN ('super', 'administrador')
)
WITH CHECK (
    auth.jwt() ->> 'role' IN ('super', 'administrador')
    OR (auth.jwt() -> 'user_metadata' ->> 'role') IN ('super', 'administrador')
);

CREATE POLICY "Exclusao de integrantes por administradores"
ON public.comissao_integrantes FOR DELETE
TO authenticated
USING (
    auth.jwt() ->> 'role' IN ('super', 'administrador')
    OR (auth.jwt() -> 'user_metadata' ->> 'role') IN ('super', 'administrador')
);

-- 6. RPC PostgreSQL Transacional e Segura: substituir_integrante_comissao
-- Executa de forma atômica (tudo ou nada) a transição de um ministro anterior para um novo sucessor
CREATE OR REPLACE FUNCTION public.substituir_integrante_comissao(
    p_comissao_id UUID,
    p_integrante_anterior_id UUID,
    p_novo_ministro_id UUID,
    p_cargo VARCHAR,
    p_ordem_hierarquia INTEGER,
    p_data_substituicao DATE,
    p_motivo_substituicao TEXT,
    p_observacoes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_comissao RECORD;
    v_integrante_anterior RECORD;
    v_novo_ministro RECORD;
    v_ja_ativo UUID;
    v_novo_integrante_id UUID;
    v_data_efetiva DATE;
    v_result JSONB;
BEGIN
    -- 1. Validar e travar comissão (controle de concorrência)
    SELECT id, nome, status, deleted_at
    INTO v_comissao
    FROM public.comissoes
    WHERE id = p_comissao_id
    FOR UPDATE;

    IF NOT FOUND OR v_comissao.deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'COMISSAO_NOT_FOUND: Comissão não encontrada ou inativa.';
    END IF;

    -- 2. Validar e travar integrante anterior (garantir status ativo e comissão correta)
    SELECT id, comissao_id, ministro_id, cargo, status, deleted_at
    INTO v_integrante_anterior
    FROM public.comissao_integrantes
    WHERE id = p_integrante_anterior_id
      AND comissao_id = p_comissao_id
    FOR UPDATE;

    IF NOT FOUND OR v_integrante_anterior.deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'INTEGRANTE_NOT_FOUND: Integrante a ser substituído não foi encontrado nesta comissão.';
    END IF;

    IF v_integrante_anterior.status <> 'ativo' THEN
        RAISE EXCEPTION 'INTEGRANTE_NOT_ACTIVE: Integrante já se encontra com status % e não pode ser substituído.', v_integrante_anterior.status;
    END IF;

    -- 3. Validar novo ministro no cadastro oficial members
    SELECT id, name, cpf
    INTO v_novo_ministro
    FROM public.members
    WHERE id = p_novo_ministro_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'MINISTRO_NOT_FOUND: Ministro sucessor não encontrado no cadastro oficial.';
    END IF;

    IF v_integrante_anterior.ministro_id = p_novo_ministro_id THEN
        RAISE EXCEPTION 'SAME_MINISTER: O ministro sucessor não pode ser o mesmo ministro já designado.';
    END IF;

    -- 4. Verificar se o novo ministro já está ativo nesta comissão
    SELECT id
    INTO v_ja_ativo
    FROM public.comissao_integrantes
    WHERE comissao_id = p_comissao_id
      AND ministro_id = p_novo_ministro_id
      AND status = 'ativo'
      AND deleted_at IS NULL;

    IF FOUND THEN
        RAISE EXCEPTION 'MINISTRO_ALREADY_ACTIVE: O ministro % já possui designação ativa nesta comissão.', v_novo_ministro.name;
    END IF;

    v_data_efetiva := COALESCE(p_data_substituicao, CURRENT_DATE);

    -- 5. Atualizar o integrante anterior para status 'substituido'
    UPDATE public.comissao_integrantes
    SET status = 'substituido',
        data_saida = v_data_efetiva,
        motivo_saida = COALESCE(p_motivo_substituicao, 'Substituído por ' || v_novo_ministro.name),
        substituido_por_id = p_novo_ministro_id,
        updated_at = timezone('utc'::text, now())
    WHERE id = p_integrante_anterior_id;

    -- 6. Inserir o novo integrante com o cargo e hierarquia
    INSERT INTO public.comissao_integrantes (
        comissao_id,
        ministro_id,
        cargo,
        ordem_hierarquia,
        status,
        data_entrada,
        observacoes,
        created_at,
        updated_at
    ) VALUES (
        p_comissao_id,
        p_novo_ministro_id,
        TRIM(p_cargo),
        COALESCE(p_ordem_hierarquia, 99),
        'ativo',
        v_data_efetiva,
        TRIM(p_observacoes),
        timezone('utc'::text, now()),
        timezone('utc'::text, now())
    )
    RETURNING id INTO v_novo_integrante_id;

    -- 7. Retornar payload estruturado com IDs e dados para resposta e auditoria
    v_result := jsonb_build_object(
        'success', true,
        'comissao_id', p_comissao_id,
        'integrante_anterior_id', p_integrante_anterior_id,
        'novo_integrante_id', v_novo_integrante_id,
        'novo_ministro_id', p_novo_ministro_id,
        'novo_ministro_nome', v_novo_ministro.name,
        'cargo', TRIM(p_cargo),
        'data_substituicao', v_data_efetiva
    );

    RETURN v_result;
END;
$$;

-- Permissões de execução da RPC: restrita EXCLUSIVAMENTE ao backend (service_role)
-- Revoga expressamente EXECUTE de PUBLIC, anon e authenticated
REVOKE ALL ON FUNCTION public.substituir_integrante_comissao(UUID, UUID, UUID, VARCHAR, INTEGER, DATE, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.substituir_integrante_comissao(UUID, UUID, UUID, VARCHAR, INTEGER, DATE, TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.substituir_integrante_comissao(UUID, UUID, UUID, VARCHAR, INTEGER, DATE, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.substituir_integrante_comissao(UUID, UUID, UUID, VARCHAR, INTEGER, DATE, TEXT, TEXT) TO service_role;
