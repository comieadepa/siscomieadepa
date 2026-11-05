-- ==============================================================================
-- SISCOMIEADEPA — MIGRATION: TABELA PRÓPRIA AEMADEPA ASSOCIADAS
-- Arquivo: supabase/migrations/20261104230000_create_aemadepa_associadas.sql
-- Objetivo: Estrutura dedicada para associadas da AEMADEPA, vinculada a members,
--           com normalização estrita de CPF, constraints, RLS restritiva ao RBAC
--           administrativo ('super', 'admin', 'administrador', 'secretaria') e
--           função de sincronização segura com search_path imutável.
-- Status: PREPARAÇÃO FASE 2 (VALIDADA — AGUARDANDO AUTORIZAÇÃO DE APLICAÇÃO).
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. TABELA PRINCIPAL: aemadepa_associadas
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.aemadepa_associadas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ministro_id UUID NOT NULL REFERENCES public.members(id) ON DELETE RESTRICT,

    -- Identificação AEMADEPA
    numero_aemadepa VARCHAR(50) NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'pendente',

    -- Dados Pessoais da Associada (LGPD)
    nome VARCHAR(255) NOT NULL,
    cpf VARCHAR(11) NOT NULL, -- Estritamente 11 dígitos numéricos
    rg VARCHAR(50) NULL,
    orgao_emissor VARCHAR(50) NULL,
    data_nascimento DATE NOT NULL,
    nacionalidade VARCHAR(100) NOT NULL DEFAULT 'BRASILEIRA',
    naturalidade VARCHAR(150) NULL,
    tipo_sanguineo VARCHAR(10) NULL,

    -- Filiação e Eleitoral
    nome_pai VARCHAR(255) NULL,
    nome_mae VARCHAR(255) NULL,
    titulo_eleitoral VARCHAR(50) NULL,

    -- Contato e Fotografia Oficial
    fone VARCHAR(30) NULL,
    email VARCHAR(150) NULL,
    foto_url TEXT NULL,

    -- Extensibilidade e Metadados
    custom_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),

    -- Restrições de Domínio e Integridade
    CONSTRAINT ck_aemadepa_status CHECK (status IN ('ativo', 'pendente', 'inativo', 'regularizacao')),
    CONSTRAINT ck_aemadepa_cpf_digits CHECK (cpf ~ '^[0-9]{11}$'),
    CONSTRAINT ck_aemadepa_nome_not_empty CHECK (length(trim(nome)) >= 3),
    CONSTRAINT uq_aemadepa_cpf UNIQUE (cpf),
    CONSTRAINT uq_aemadepa_ministro UNIQUE (ministro_id)
);

COMMENT ON TABLE public.aemadepa_associadas IS 'Cadastro próprio e exclusivo de associadas da AEMADEPA, com vínculo oficial ao ministro em members.';
COMMENT ON COLUMN public.aemadepa_associadas.cpf IS 'CPF da associada normalizado com exatamente 11 dígitos numéricos.';
COMMENT ON COLUMN public.aemadepa_associadas.ministro_id IS 'Chave estrangeira para o registro oficial do ministro esposo em public.members.';
COMMENT ON COLUMN public.aemadepa_associadas.status IS 'Situação cadastral: ativo, pendente, inativo ou regularizacao.';

-- ------------------------------------------------------------------------------
-- 2. ÍNDICES DE ALTA PERFORMANCE (Compatíveis com PostgreSQL padrão)
-- ------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_aemadepa_ministro_id ON public.aemadepa_associadas (ministro_id);
CREATE INDEX IF NOT EXISTS idx_aemadepa_cpf ON public.aemadepa_associadas (cpf);
CREATE INDEX IF NOT EXISTS idx_aemadepa_status ON public.aemadepa_associadas (status);
CREATE INDEX IF NOT EXISTS idx_aemadepa_nome_idx ON public.aemadepa_associadas (nome);

-- ------------------------------------------------------------------------------
-- 3. TRIGGER AUTOMÁTICA DE updated_at
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_aemadepa_updated_at()
RETURNS TRIGGER
SET search_path = public, pg_temp
AS $$
BEGIN
    NEW.updated_at = timezone('utc', now());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_aemadepa_associadas_updated_at ON public.aemadepa_associadas;
CREATE TRIGGER trg_aemadepa_associadas_updated_at
    BEFORE UPDATE ON public.aemadepa_associadas
    FOR EACH ROW
    EXECUTE FUNCTION public.set_aemadepa_updated_at();

-- ------------------------------------------------------------------------------
-- 4. SEGURANÇA E POLÍTICAS DE RLS (ROW LEVEL SECURITY)
-- ------------------------------------------------------------------------------
ALTER TABLE public.aemadepa_associadas ENABLE ROW LEVEL SECURITY;

-- 4.1 Bloqueio Restritivo Geral para Anônimos
DROP POLICY IF EXISTS "aemadepa_bloqueio_anonimo" ON public.aemadepa_associadas;
CREATE POLICY "aemadepa_bloqueio_anonimo"
    ON public.aemadepa_associadas
    AS RESTRICTIVE
    FOR ALL
    TO anon
    USING (false);

-- 4.2 Função auxiliar de checagem RBAC (evita problemas de recursão/permissão em public.users)
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
          AND LOWER(TRIM(u.role)) IN ('super', 'admin', 'administrador', 'secretaria')
    );
$$;

REVOKE ALL ON FUNCTION public.is_aemadepa_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_aemadepa_admin() FROM anon;
GRANT EXECUTE ON FUNCTION public.is_aemadepa_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_aemadepa_admin() TO service_role;

-- 4.3 Políticas por operação (SELECT, INSERT, UPDATE, DELETE)
DROP POLICY IF EXISTS "aemadepa_select_policy" ON public.aemadepa_associadas;
CREATE POLICY "aemadepa_select_policy"
    ON public.aemadepa_associadas
    FOR SELECT
    TO authenticated
    USING (public.is_aemadepa_admin());

DROP POLICY IF EXISTS "aemadepa_insert_policy" ON public.aemadepa_associadas;
CREATE POLICY "aemadepa_insert_policy"
    ON public.aemadepa_associadas
    FOR INSERT
    TO authenticated
    WITH CHECK (public.is_aemadepa_admin());

DROP POLICY IF EXISTS "aemadepa_update_policy" ON public.aemadepa_associadas;
CREATE POLICY "aemadepa_update_policy"
    ON public.aemadepa_associadas
    FOR UPDATE
    TO authenticated
    USING (public.is_aemadepa_admin())
    WITH CHECK (public.is_aemadepa_admin());

DROP POLICY IF EXISTS "aemadepa_delete_policy" ON public.aemadepa_associadas;
CREATE POLICY "aemadepa_delete_policy"
    ON public.aemadepa_associadas
    FOR DELETE
    TO authenticated
    USING (public.is_aemadepa_admin());

-- ------------------------------------------------------------------------------
-- 5. FUNÇÃO DE SINCRONIZAÇÃO SEGURA (PREPARADA, NÃO ATIVADA VIA TRIGGER NA FASE 2)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_aemadepa_to_members(p_associada_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    rec RECORD;
BEGIN
    SELECT * INTO rec FROM public.aemadepa_associadas WHERE id = p_associada_id;
    IF NOT FOUND THEN
        RETURN;
    END IF;

    UPDATE public.members
    SET
        nome_conjuge = rec.nome,
        cpf_conjuge = rec.cpf,
        data_nascimento_conjuge = rec.data_nascimento::text,
        conjuge_rg = rec.rg,
        conjuge_orgao_emissor = rec.orgao_emissor,
        conjuge_nacionalidade = rec.nacionalidade,
        conjuge_naturalidade = rec.naturalidade,
        conjuge_nome_pai = rec.nome_pai,
        conjuge_nome_mae = rec.nome_mae,
        conjuge_titulo_eleitoral = rec.titulo_eleitoral,
        conjuge_fone = rec.fone,
        conjuge_email = rec.email,
        conjuge_tipo_sanguineo = rec.tipo_sanguineo,
        conjuge_foto_url = COALESCE(rec.foto_url, conjuge_foto_url),
        custom_fields = COALESCE(custom_fields, '{}'::jsonb) || jsonb_build_object(
            'nomeConjuge', rec.nome,
            'cpfConjuge', rec.cpf,
            'dataNascimentoConjuge', rec.data_nascimento::text,
            'conjugeRg', COALESCE(rec.rg, ''),
            'conjugeOrgaoEmissor', COALESCE(rec.orgao_emissor, ''),
            'conjugeFone', COALESCE(rec.fone, ''),
            'conjugeEmail', COALESCE(rec.email, ''),
            'conjugeTipoSanguineo', COALESCE(rec.tipo_sanguineo, ''),
            'conjugeNacionalidade', COALESCE(rec.nacionalidade, 'BRASILEIRA'),
            'conjugeNaturalidade', COALESCE(rec.naturalidade, ''),
            'conjugeNomePai', COALESCE(rec.nome_pai, ''),
            'conjugeNomeMae', COALESCE(rec.nome_mae, ''),
            'conjugeTituloEleitoral', COALESCE(rec.titulo_eleitoral, ''),
            'conjugeFotoUrl', COALESCE(rec.foto_url, ''),
            'numero_aemadepa', COALESCE(rec.numero_aemadepa, ''),
            'numeroAemadepa', COALESCE(rec.numero_aemadepa, '')
        ),
        updated_at = timezone('utc', now())
    WHERE id = rec.ministro_id
      AND (
        nome_conjuge IS DISTINCT FROM rec.nome OR
        cpf_conjuge IS DISTINCT FROM rec.cpf OR
        data_nascimento_conjuge IS DISTINCT FROM rec.data_nascimento::text OR
        conjuge_rg IS DISTINCT FROM rec.rg OR
        conjuge_fone IS DISTINCT FROM rec.fone OR
        conjuge_email IS DISTINCT FROM rec.email OR
        conjuge_foto_url IS DISTINCT FROM rec.foto_url OR
        COALESCE(custom_fields->>'numero_aemadepa', '') IS DISTINCT FROM COALESCE(rec.numero_aemadepa, '')
      );
END;
$$;

-- Restrição de privilégios da função de sincronização
REVOKE ALL ON FUNCTION public.sync_aemadepa_to_members(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_aemadepa_to_members(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.sync_aemadepa_to_members(UUID) TO service_role;

-- ------------------------------------------------------------------------------
-- 6. DOCUMENTAÇÃO TÉCNICA: SINCRONIZAÇÃO REVERSA FUTURA (MEMBERS -> AEMADEPA)
-- ------------------------------------------------------------------------------
-- 1) A futura sincronização reversa usará comparação IS DISTINCT FROM para evitar recursão.
-- 2) Nenhuma trigger automática bidirecional está ativada nesta fase.

-- ------------------------------------------------------------------------------
-- 7. ESTRATÉGIA DE REVERSÃO NÃO-DESTRUTIVA (ROLLBACK CONSERVATIVO)
-- ------------------------------------------------------------------------------
-- Em caso de reversão necessária:
--   ALTER TABLE public.aemadepa_associadas RENAME TO aemadepa_associadas_backup_rollback;
-- Os dados de members continuam 100% operacionais e intactos.
