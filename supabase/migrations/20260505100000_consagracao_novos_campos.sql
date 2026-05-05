-- ============================================================
-- CONSAGRACAO_REGISTROS - Novos campos para importação CSV
-- ============================================================

ALTER TABLE public.consagracao_registros
  -- Endereço
  ADD COLUMN IF NOT EXISTS endereco           VARCHAR(255),
  ADD COLUMN IF NOT EXISTS numero_endereco    VARCHAR(20),
  ADD COLUMN IF NOT EXISTS bairro             VARCHAR(100),
  ADD COLUMN IF NOT EXISTS complemento        VARCHAR(100),
  ADD COLUMN IF NOT EXISTS cidade             VARCHAR(100),
  ADD COLUMN IF NOT EXISTS uf_endereco        VARCHAR(2),
  ADD COLUMN IF NOT EXISTS cep                VARCHAR(10),

  -- Dados ministeriais extras
  ADD COLUMN IF NOT EXISTS cargo_anterior     VARCHAR(100),
  ADD COLUMN IF NOT EXISTS mat_pr_solicitante VARCHAR(50),

  -- Formação
  ADD COLUMN IF NOT EXISTS escolaridade       VARCHAR(100),
  ADD COLUMN IF NOT EXISTS curso_teologico    VARCHAR(255),

  -- Controle
  ADD COLUMN IF NOT EXISTS doc_pendente       BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS data_registro      DATE,

  -- Campos adicionais que já existem na página mas faltavam na tabela
  ADD COLUMN IF NOT EXISTS tipo_registro      VARCHAR(50),
  ADD COLUMN IF NOT EXISTS numero_processo    VARCHAR(50),
  ADD COLUMN IF NOT EXISTS data_processo      DATE,
  ADD COLUMN IF NOT EXISTS data_nascimento    DATE,
  ADD COLUMN IF NOT EXISTS sexo               VARCHAR(20),
  ADD COLUMN IF NOT EXISTS rg                 VARCHAR(50),
  ADD COLUMN IF NOT EXISTS orgao_emissor      VARCHAR(50),
  ADD COLUMN IF NOT EXISTS estado_civil       VARCHAR(50),
  ADD COLUMN IF NOT EXISTS nacionalidade      VARCHAR(100),
  ADD COLUMN IF NOT EXISTS naturalidade       VARCHAR(100),
  ADD COLUMN IF NOT EXISTS uf                 VARCHAR(2),
  ADD COLUMN IF NOT EXISTS email              VARCHAR(255),
  ADD COLUMN IF NOT EXISTS telefone           VARCHAR(30),
  ADD COLUMN IF NOT EXISTS nome_pai           VARCHAR(255),
  ADD COLUMN IF NOT EXISTS nome_mae           VARCHAR(255),
  ADD COLUMN IF NOT EXISTS nome_conjuge       VARCHAR(255),
  ADD COLUMN IF NOT EXISTS matricula          VARCHAR(50),
  ADD COLUMN IF NOT EXISTS supervisao_id      UUID REFERENCES public.supervisoes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS campo_id           UUID REFERENCES public.campos(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS congregacao_id     UUID REFERENCES public.congregacoes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cargo_ocupa        VARCHAR(100),
  ADD COLUMN IF NOT EXISTS cargo_pretendido   VARCHAR(100),
  ADD COLUMN IF NOT EXISTS pastor_solicitante VARCHAR(255),
  ADD COLUMN IF NOT EXISTS origem_instituicao VARCHAR(255),
  ADD COLUMN IF NOT EXISTS origem_cidade      VARCHAR(100),
  ADD COLUMN IF NOT EXISTS origem_uf          VARCHAR(2),
  ADD COLUMN IF NOT EXISTS origem_data_consagracao DATE,
  ADD COLUMN IF NOT EXISTS data_autorizacao   DATE,
  ADD COLUMN IF NOT EXISTS status_processo    VARCHAR(50) DEFAULT 'em_processo',
  ADD COLUMN IF NOT EXISTS foto_url           VARCHAR(500),
  ADD COLUMN IF NOT EXISTS regiao             VARCHAR(100);
