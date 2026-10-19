-- ==============================================================================
-- SISCOMIEADEPA — MIGRATION: SETORES DE PLENÁRIA E RESTAURANTES POR EVENTO
-- Arquivo: supabase/migrations/20261019170000_create_evento_locais_checkin.sql
-- Objetivo: Cadastro flexível de plenárias e restaurantes por evento,
--           com rastreabilidade estrita, integridade referencial e RLS robusto.
-- Versão: 3.0 (Hardening RLS com Fontes Confiáveis de Banco)
-- Status: PREPARAÇÃO (NÃO EXECUTADA). Aguardando autorização explícita.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. TABELA PRINCIPAL: evento_locais_checkin
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.evento_locais_checkin (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    evento_id UUID NOT NULL REFERENCES public.eventos(id) ON DELETE RESTRICT,
    tipo VARCHAR(30) NOT NULL,
    nome VARCHAR(120) NOT NULL,
    descricao TEXT NULL,
    ativo BOOLEAN NOT NULL DEFAULT true,
    ordem INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Constraints de validação de domínio
    CONSTRAINT ck_evento_locais_tipo CHECK (tipo IN ('plenaria', 'refeitorio')),
    CONSTRAINT ck_evento_locais_nome_not_empty CHECK (length(trim(nome)) > 0),
    
    -- Chave composta necessária para garantir integridade multi-evento nas FKs dependentes
    CONSTRAINT uq_evento_locais_id_evento UNIQUE (id, evento_id)
);

COMMENT ON TABLE public.evento_locais_checkin IS 'Setores de plenária e restaurantes cadastrados por evento para operação de check-in.';
COMMENT ON COLUMN public.evento_locais_checkin.tipo IS 'Modalidade do local: plenaria ou refeitorio.';
COMMENT ON COLUMN public.evento_locais_checkin.ativo IS 'Controle de ativação lógica. Inativação preserva histórico e impede novos registros.';
COMMENT ON CONSTRAINT uq_evento_locais_id_evento ON public.evento_locais_checkin IS 'Garante que id e evento_id sejam referenciáveis como par único para blindagem multi-evento.';

-- ------------------------------------------------------------------------------
-- 2. TRIGGER DE ATUALIZAÇÃO AUTOMÁTICA DE updated_at
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'trg_evento_locais_checkin_updated_at'
    ) THEN
        CREATE TRIGGER trg_evento_locais_checkin_updated_at
            BEFORE UPDATE ON public.evento_locais_checkin
            FOR EACH ROW
            EXECUTE FUNCTION public.set_updated_at();
    END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 3. ÍNDICES DE ALTA PERFORMANCE
-- ------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_evento_locais_lookup
    ON public.evento_locais_checkin (evento_id, tipo, ativo, ordem);

-- ------------------------------------------------------------------------------
-- 4. POLÍTICAS DE SEGURANÇA (ROW LEVEL SECURITY - RLS)
--    Fonte de autorização 100% confiável: tabelas do banco (users, usuario_eventos,
--    usuario_eventos_permitidos), sem depender de metadados editáveis no client.
-- ------------------------------------------------------------------------------
ALTER TABLE public.evento_locais_checkin ENABLE ROW LEVEL SECURITY;

-- 4.1. Limpeza preventiva de todas as políticas anteriores / legadas
DROP POLICY IF EXISTS "evento_locais_all_service_role" ON public.evento_locais_checkin;
DROP POLICY IF EXISTS "evento_locais_service_role_all" ON public.evento_locais_checkin;
DROP POLICY IF EXISTS "evento_locais_admin_global_all" ON public.evento_locais_checkin;
DROP POLICY IF EXISTS "evento_locais_modify_authenticated" ON public.evento_locais_checkin;
DROP POLICY IF EXISTS "evento_locais_gestores_evento_all" ON public.evento_locais_checkin;
DROP POLICY IF EXISTS "evento_locais_gestor_evento_all" ON public.evento_locais_checkin;
DROP POLICY IF EXISTS "evento_locais_evento_gestores_modify" ON public.evento_locais_checkin;
DROP POLICY IF EXISTS "evento_locais_select_authenticated" ON public.evento_locais_checkin;
DROP POLICY IF EXISTS "evento_locais_operadores_select" ON public.evento_locais_checkin;
DROP POLICY IF EXISTS "evento_locais_evento_autorizado_select" ON public.evento_locais_checkin;
DROP POLICY IF EXISTS "evento_locais_autorizados_select" ON public.evento_locais_checkin;

-- 4.2. Service Role: Acesso total para requisições server-side com service_role key
CREATE POLICY "evento_locais_service_role_all"
    ON public.evento_locais_checkin
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- 4.3. Administradores Globais do Sistema:
-- Consulta e gestão total verificada diretamente na tabela public.users (campo role).
-- Exige usuário ativo e papel administrativo global confiável.
CREATE POLICY "evento_locais_admin_global_all"
    ON public.evento_locais_checkin
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.users u
            WHERE u.id = auth.uid()
              AND u.is_active = true
              AND u.role IN ('super', 'admin', 'administrador')
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.users u
            WHERE u.id = auth.uid()
              AND u.is_active = true
              AND u.role IN ('super', 'admin', 'administrador')
        )
    );

-- 4.4. Gestores Administrativos do Evento Específico (Escrita e Gestão Total do Evento):
-- Restrito EXCLUSIVAMENTE a usuários com permissão 'admin_evento' em public.usuario_eventos
-- vinculados estritamente ao evento do setor.
-- OPERADORES, ATENDENTES E USUÁRIOS DE OUTROS EVENTOS NÃO TÊM PERMISSÃO DE ESCRITA.
CREATE POLICY "evento_locais_gestor_evento_all"
    ON public.evento_locais_checkin
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.usuario_eventos ue
            WHERE ue.user_id = auth.uid()
              AND ue.evento_id = evento_locais_checkin.evento_id
              AND ue.permissao = 'admin_evento'
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.usuario_eventos ue
            WHERE ue.user_id = auth.uid()
              AND ue.evento_id = evento_locais_checkin.evento_id
              AND ue.permissao = 'admin_evento'
        )
    );

-- 4.5. Consulta Autorizada do Evento (SELECT SOMENTE):
-- Permite leitura de setores aos operadores de checkin/equipe (usuario_eventos)
-- e aos usuários de atendimento/inscrição (usuario_eventos_permitidos) para o evento específico.
-- NENHUM DESTES USUÁRIOS PODE INSERIR, ALTERAR OU DELETAR SETORES.
CREATE POLICY "evento_locais_autorizados_select"
    ON public.evento_locais_checkin
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.usuario_eventos ue
            WHERE ue.user_id = auth.uid()
              AND ue.evento_id = evento_locais_checkin.evento_id
        )
        OR EXISTS (
            SELECT 1 FROM public.usuario_eventos_permitidos uep
            WHERE uep.usuario_id = auth.uid()
              AND uep.evento_id = evento_locais_checkin.evento_id
        )
    );

-- ------------------------------------------------------------------------------
-- 5. EVOLUÇÃO DE TABELAS OPERACIONAIS (FKs COMPOSTAS COM BLINDAGEM DE INTEGRIDADE)
-- ------------------------------------------------------------------------------

-- 5.1. Tabela: evento_equipe (Vínculo de Operador / Terminal ao Setor)
ALTER TABLE public.evento_equipe
    ADD COLUMN IF NOT EXISTS local_id UUID NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_evento_equipe_local_composite'
    ) THEN
        ALTER TABLE public.evento_equipe
            ADD CONSTRAINT fk_evento_equipe_local_composite
            FOREIGN KEY (local_id, evento_id)
            REFERENCES public.evento_locais_checkin(id, evento_id)
            ON DELETE RESTRICT
            NOT VALID;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_evento_equipe_local_id
    ON public.evento_equipe (local_id);

-- 5.2. Tabela: evento_checkins (Log de Presenças / Plenárias)
ALTER TABLE public.evento_checkins
    ADD COLUMN IF NOT EXISTS local_id UUID NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_evento_checkins_local_composite'
    ) THEN
        ALTER TABLE public.evento_checkins
            ADD CONSTRAINT fk_evento_checkins_local_composite
            FOREIGN KEY (local_id, evento_id)
            REFERENCES public.evento_locais_checkin(id, evento_id)
            ON DELETE RESTRICT
            NOT VALID;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_evento_checkins_local_lookup
    ON public.evento_checkins (evento_id, local_id, tipo_checkin, data_plenaria);

-- 5.3. Tabela: evento_refeicoes_consumo (Log Auditável de Débitos Alimentares)
ALTER TABLE public.evento_refeicoes_consumo
    ADD COLUMN IF NOT EXISTS local_id UUID NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_evento_refeicoes_local_composite'
    ) THEN
        ALTER TABLE public.evento_refeicoes_consumo
            ADD CONSTRAINT fk_evento_refeicoes_local_composite
            FOREIGN KEY (local_id, evento_id)
            REFERENCES public.evento_locais_checkin(id, evento_id)
            ON DELETE RESTRICT
            NOT VALID;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_evento_refeicoes_local_lookup
    ON public.evento_refeicoes_consumo (evento_id, local_id, data_hora);
