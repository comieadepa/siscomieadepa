-- ==============================================================================
-- SISCOMIEADEPA — MIGRATION: MÓDULO UMADESPA (FUNDAÇÃO MODULAR)
-- Arquivo: supabase/migrations/20261119120000_create_umadespa_schema.sql
-- Objetivo: Estrutura isolada para gestão da UMADESPA (União de Mocidade das AD no Pará):
--           1. Tabela de configurações da UMADESPA (taxas 1ª/2ª via, validade, elegibilidade).
--           2. Tabela de associados da UMADESPA (dados pessoais, vínculos hierárquicos, liderança).
--           3. Tabela de histórico de funções/liderança para auditoria.
--           4. Tabela de solicitações de carteirinhas com versionamento de via e taxas históricas.
--           5. Índices de alta performance, constraints e RLS restritiva ao RBAC.
-- Status: PREPARAÇÃO LOTE 1 (NÃO EXECUTADA EM PRODUÇÃO — AGUARDANDO APROVAÇÃO).
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. ATUALIZAÇÃO DA CONSTRAINT DE ROLES EM public.users
-- ------------------------------------------------------------------------------
ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS valid_role;

ALTER TABLE public.users
  ADD CONSTRAINT valid_role
    CHECK (role IN ('super', 'admin', 'cgadb', 'comissao', 'inscricao', 'financeiro', 'aemadepa', 'umadespa'));

-- ------------------------------------------------------------------------------
-- 2. TABELA DE CONFIGURAÇÕES: umadespa_configuracoes
--    Permite configurar valores de taxas e validade sem hardcode.
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.umadespa_configuracoes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ano_exercicio INT NOT NULL,
    taxa_primeira_via NUMERIC(10, 2) NOT NULL DEFAULT 25.00,
    taxa_segunda_via NUMERIC(10, 2) NOT NULL DEFAULT 25.00,
    meses_validade_carteirinha INT NOT NULL DEFAULT 24, -- Validade padrão de 2 anos
    idade_maxima_cadastro_publico INT NOT NULL DEFAULT 30, -- Limite inclusivo de 30 anos
    permite_cadastro_publico BOOLEAN NOT NULL DEFAULT true,
    chave_pix_manual VARCHAR(150) NULL,
    instrucoes_pagamento TEXT NULL,
    criado_por UUID NULL REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),

    CONSTRAINT ck_umadespa_cfg_taxas CHECK (taxa_primeira_via >= 0 AND taxa_segunda_via >= 0),
    CONSTRAINT ck_umadespa_cfg_validade CHECK (meses_validade_carteirinha >= 1 AND meses_validade_carteirinha <= 120),
    CONSTRAINT ck_umadespa_cfg_idade CHECK (idade_maxima_cadastro_publico >= 12 AND idade_maxima_cadastro_publico <= 99),
    CONSTRAINT uq_umadespa_cfg_exercicio UNIQUE (ano_exercicio)
);

COMMENT ON TABLE public.umadespa_configuracoes IS 'Parâmetros operacionais e taxas vigentes da UMADESPA por exercício.';

-- Insere configuração padrão para o ano corrente se não existir
INSERT INTO public.umadespa_configuracoes (
    ano_exercicio,
    taxa_primeira_via,
    taxa_segunda_via,
    meses_validade_carteirinha,
    idade_maxima_cadastro_publico,
    permite_cadastro_publico
)
VALUES (
    EXTRACT(YEAR FROM now())::INT,
    25.00,
    25.00,
    24,
    30,
    true
)
ON CONFLICT (ano_exercicio) DO NOTHING;

-- ------------------------------------------------------------------------------
-- 3. TABELA PRINCIPAL: umadespa_associados
--    Cadastro autônomo de jovens e líderes com vínculo eclesiástico estrito.
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.umadespa_associados (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    numero_umadespa VARCHAR(50) NULL,
    matricula VARCHAR(50) NULL,

    -- Vínculo Eclesiástico Hierárquico Obrigatório
    supervisao_id UUID NOT NULL REFERENCES public.supervisoes(id) ON DELETE RESTRICT,
    campo_id UUID NOT NULL REFERENCES public.campos(id) ON DELETE RESTRICT,
    congregacao_id UUID NULL REFERENCES public.congregacoes(id) ON DELETE SET NULL,

    -- Dados Pessoais do Jovem (LGPD)
    nome VARCHAR(255) NOT NULL,
    cpf VARCHAR(11) NOT NULL, -- Estritamente 11 dígitos numéricos
    rg VARCHAR(50) NULL,
    orgao_emissor VARCHAR(50) NULL,
    data_nascimento DATE NOT NULL,
    sexo VARCHAR(20) NOT NULL DEFAULT 'MASCULINO',
    nacionalidade VARCHAR(100) NOT NULL DEFAULT 'BRASILEIRA',
    naturalidade VARCHAR(150) NULL,
    tipo_sanguineo VARCHAR(10) NULL,

    -- Filiação e Eleitoral
    nome_pai VARCHAR(255) NULL,
    nome_mae VARCHAR(255) NULL,
    titulo_eleitoral VARCHAR(50) NULL,

    -- Menor de Idade / Responsável Legal
    menor_idade BOOLEAN NOT NULL DEFAULT false,
    responsavel_nome VARCHAR(255) NULL,
    responsavel_cpf VARCHAR(11) NULL,
    responsavel_fone VARCHAR(30) NULL,
    responsavel_termo_aceite BOOLEAN NOT NULL DEFAULT false,

    -- Contato e Fotografia Oficial
    fone VARCHAR(30) NULL,
    email VARCHAR(150) NULL,
    foto_url TEXT NULL,

    -- Função e Liderança Eclesiástica
    -- Membro (padrão inicial do público), Lider de Mocidade, Coordenador, etc.
    funcao VARCHAR(100) NOT NULL DEFAULT 'Membro',
    is_lideranca BOOLEAN NOT NULL DEFAULT false,
    cargo_detalhe VARCHAR(150) NULL, -- ex: Diretor de Louvor, Regente

    -- Situação Operacional do Cadastro
    origem_cadastro VARCHAR(30) NOT NULL DEFAULT 'publico', -- 'publico' ou 'administrativo'
    status VARCHAR(30) NOT NULL DEFAULT 'pendente',

    -- Metadados e Auditoria
    custom_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),

    -- Restrições de Domínio e Integridade
    CONSTRAINT ck_umadespa_cpf_digits CHECK (cpf ~ '^[0-9]{11}$'),
    CONSTRAINT ck_umadespa_nome_min CHECK (length(trim(nome)) >= 3),
    CONSTRAINT ck_umadespa_status CHECK (status IN ('ativo', 'pendente', 'inativo', 'regularizacao')),
    CONSTRAINT ck_umadespa_origem CHECK (origem_cadastro IN ('publico', 'administrativo')),
    CONSTRAINT ck_umadespa_sexo CHECK (sexo IN ('MASCULINO', 'FEMININO')),
    CONSTRAINT ck_umadespa_responsavel_menor CHECK (
        (menor_idade = false) OR 
        (menor_idade = true AND responsavel_nome IS NOT NULL AND length(trim(responsavel_nome)) >= 3)
    ),
    CONSTRAINT uq_umadespa_cpf UNIQUE (cpf)
);

COMMENT ON TABLE public.umadespa_associados IS 'Cadastro de membros e líderes da UMADESPA com vínculos eclesiásticos hierárquicos.';

-- ------------------------------------------------------------------------------
-- 4. ÍNDICES DE ALTA PERFORMANCE PARA umadespa_associados
-- ------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_umadespa_cpf ON public.umadespa_associados (cpf);
CREATE INDEX IF NOT EXISTS idx_umadespa_nome ON public.umadespa_associados (nome);
CREATE INDEX IF NOT EXISTS idx_umadespa_status ON public.umadespa_associados (status);
CREATE INDEX IF NOT EXISTS idx_umadespa_supervisao_id ON public.umadespa_associados (supervisao_id);
CREATE INDEX IF NOT EXISTS idx_umadespa_campo_id ON public.umadespa_associados (campo_id);
CREATE INDEX IF NOT EXISTS idx_umadespa_congregacao_id ON public.umadespa_associados (congregacao_id);
CREATE INDEX IF NOT EXISTS idx_umadespa_funcao ON public.umadespa_associados (funcao);
CREATE INDEX IF NOT EXISTS idx_umadespa_data_nascimento ON public.umadespa_associados (data_nascimento);

-- ------------------------------------------------------------------------------
-- 5. TABELA DE HISTÓRICO DE FUNÇÕES: umadespa_funcoes_historico
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.umadespa_funcoes_historico (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    associado_id UUID NOT NULL REFERENCES public.umadespa_associados(id) ON DELETE CASCADE,
    funcao_anterior VARCHAR(100) NULL,
    funcao_nova VARCHAR(100) NOT NULL,
    is_lideranca BOOLEAN NOT NULL DEFAULT false,
    alterado_por UUID NULL REFERENCES public.users(id) ON DELETE SET NULL,
    motivo TEXT NULL,
    data_inicio TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_umadespa_hist_associado ON public.umadespa_funcoes_historico (associado_id);

-- ------------------------------------------------------------------------------
-- 6. TABELA DE SOLICITAÇÕES DE CARTEIRINHAS: umadespa_carteirinhas_solicitacoes
--    Idempotência, controle de vias, histórico de taxa e validade aplicada.
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.umadespa_carteirinhas_solicitacoes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    associado_id UUID NOT NULL REFERENCES public.umadespa_associados(id) ON DELETE RESTRICT,

    -- Dados Financeiros Históricos (gravados no momento do pedido)
    via INT NOT NULL DEFAULT 1,
    valor NUMERIC(10, 2) NOT NULL,
    validade_meses INT NOT NULL DEFAULT 24,
    validade_data DATE NULL,

    -- Idempotência e Gateway ASAAS
    idempotency_key VARCHAR(120) NOT NULL,
    asaas_payment_id VARCHAR(100) NULL,
    asaas_customer_id VARCHAR(100) NULL,
    pix_copia_cola TEXT NULL,
    pix_qr_code_url TEXT NULL,
    invoice_url TEXT NULL,

    -- Estados Operacionais do Ciclo de Vida
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

    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),

    CONSTRAINT ck_umadespa_cart_via CHECK (via >= 1),
    CONSTRAINT ck_umadespa_cart_valor CHECK (valor >= 0),
    CONSTRAINT ck_umadespa_cart_status CHECK (
        status IN (
            'aguardando_pagamento',
            'processando_pagamento',
            'pago',
            'em_impressao',
            'impressa',
            'entregue',
            'cancelada'
        )
    ),
    CONSTRAINT uq_umadespa_cart_idempotency UNIQUE (idempotency_key)
);

COMMENT ON TABLE public.umadespa_carteirinhas_solicitacoes IS 'Pedidos operacionais e financeiros de carteirinhas físicas da UMADESPA com histórico de taxas.';

CREATE INDEX IF NOT EXISTS idx_umadespa_cart_associado ON public.umadespa_carteirinhas_solicitacoes (associado_id);
CREATE INDEX IF NOT EXISTS idx_umadespa_cart_status ON public.umadespa_carteirinhas_solicitacoes (status);
CREATE INDEX IF NOT EXISTS idx_umadespa_cart_asaas_pid ON public.umadespa_carteirinhas_solicitacoes (asaas_payment_id);
CREATE INDEX IF NOT EXISTS idx_umadespa_cart_solicitado_em ON public.umadespa_carteirinhas_solicitacoes (solicitado_em);

-- Impedir concorrência: Apenas 1 pedido pendente por associado
CREATE UNIQUE INDEX IF NOT EXISTS uq_umadespa_cart_ativa_idx
    ON public.umadespa_carteirinhas_solicitacoes (associado_id)
    WHERE status IN ('aguardando_pagamento', 'processando_pagamento');

-- ------------------------------------------------------------------------------
-- 7. TRIGGERS DE ATUALIZAÇÃO AUTOMÁTICA DE updated_at
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_umadespa_updated_at()
RETURNS TRIGGER
SET search_path = public, pg_temp
AS $$
BEGIN
    NEW.updated_at = timezone('utc', now());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_umadespa_associados_updated_at ON public.umadespa_associados;
CREATE TRIGGER trg_umadespa_associados_updated_at
    BEFORE UPDATE ON public.umadespa_associados
    FOR EACH ROW
    EXECUTE FUNCTION public.set_umadespa_updated_at();

DROP TRIGGER IF EXISTS trg_umadespa_configuracoes_updated_at ON public.umadespa_configuracoes;
CREATE TRIGGER trg_umadespa_configuracoes_updated_at
    BEFORE UPDATE ON public.umadespa_configuracoes
    FOR EACH ROW
    EXECUTE FUNCTION public.set_umadespa_updated_at();

DROP TRIGGER IF EXISTS trg_umadespa_carteirinhas_updated_at ON public.umadespa_carteirinhas_solicitacoes;
CREATE TRIGGER trg_umadespa_carteirinhas_updated_at
    BEFORE UPDATE ON public.umadespa_carteirinhas_solicitacoes
    FOR EACH ROW
    EXECUTE FUNCTION public.set_umadespa_updated_at();

-- ------------------------------------------------------------------------------
-- 8. POLÍTICAS DE SEGURANÇA ROW LEVEL SECURITY (RLS)
-- ------------------------------------------------------------------------------
ALTER TABLE public.umadespa_configuracoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.umadespa_associados ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.umadespa_funcoes_historico ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.umadespa_carteirinhas_solicitacoes ENABLE ROW LEVEL SECURITY;

-- 8.1 umadespa_configuracoes
DROP POLICY IF EXISTS "Qualquer autenticado le configuracoes da UMADESPA" ON public.umadespa_configuracoes;
CREATE POLICY "Qualquer autenticado le configuracoes da UMADESPA"
    ON public.umadespa_configuracoes FOR SELECT
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS "Apenas admin e umadespa gerenciam configuracoes da UMADESPA" ON public.umadespa_configuracoes;
CREATE POLICY "Apenas admin e umadespa gerenciam configuracoes da UMADESPA"
    ON public.umadespa_configuracoes FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.users u
            WHERE u.id = auth.uid()
              AND u.role IN ('super', 'admin', 'administrador', 'umadespa')
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.users u
            WHERE u.id = auth.uid()
              AND u.role IN ('super', 'admin', 'administrador', 'umadespa')
        )
    );

-- 8.2 umadespa_associados
DROP POLICY IF EXISTS "Administracao e UMADESPA gerenciam associados" ON public.umadespa_associados;
CREATE POLICY "Administracao e UMADESPA gerenciam associados"
    ON public.umadespa_associados FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.users u
            WHERE u.id = auth.uid()
              AND u.role IN ('super', 'admin', 'administrador', 'secretaria', 'umadespa')
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.users u
            WHERE u.id = auth.uid()
              AND u.role IN ('super', 'admin', 'administrador', 'secretaria', 'umadespa')
        )
    );

-- 8.3 umadespa_carteirinhas_solicitacoes
DROP POLICY IF EXISTS "Administracao e UMADESPA gerenciam solicitacoes" ON public.umadespa_carteirinhas_solicitacoes;
CREATE POLICY "Administracao e UMADESPA gerenciam solicitacoes"
    ON public.umadespa_carteirinhas_solicitacoes FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.users u
            WHERE u.id = auth.uid()
              AND u.role IN ('super', 'admin', 'administrador', 'secretaria', 'financeiro', 'umadespa')
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.users u
            WHERE u.id = auth.uid()
              AND u.role IN ('super', 'admin', 'administrador', 'secretaria', 'financeiro', 'umadespa')
        )
    );
