-- Migration: Novos campos no formulário de cadastro de ministros
-- Data: 2026-04-30

ALTER TABLE public.members
  -- Documentos Pessoais
  ADD COLUMN IF NOT EXISTS uf_rg VARCHAR(2),
  ADD COLUMN IF NOT EXISTS municipio_eleitoral VARCHAR(100),
  -- Contato / Acesso
  ADD COLUMN IF NOT EXISTS email2 VARCHAR(255),
  -- Dados Ministeriais
  ADD COLUMN IF NOT EXISTS posicao_no_campo VARCHAR(100),
  ADD COLUMN IF NOT EXISTS numero_cgadb VARCHAR(50),
  -- Consagração (campos fixos)
  ADD COLUMN IF NOT EXISTS local_batismo VARCHAR(255),
  ADD COLUMN IF NOT EXISTS data_filiacao DATE,
  ADD COLUMN IF NOT EXISTS diretoria BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS ev_autorizado_data DATE,
  ADD COLUMN IF NOT EXISTS ev_autorizado_local VARCHAR(255),
  ADD COLUMN IF NOT EXISTS ev_consagrado_data DATE,
  ADD COLUMN IF NOT EXISTS ev_consagrado_local VARCHAR(255),
  ADD COLUMN IF NOT EXISTS cons_missionario_data DATE,
  ADD COLUMN IF NOT EXISTS cons_missionario_local VARCHAR(255),
  ADD COLUMN IF NOT EXISTS orden_pastor_data DATE,
  ADD COLUMN IF NOT EXISTS orden_pastor_local VARCHAR(255),
  -- Registro Familiar (Cônjuge)
  ADD COLUMN IF NOT EXISTS conjuge_rg VARCHAR(20),
  ADD COLUMN IF NOT EXISTS conjuge_orgao_emissor VARCHAR(50),
  ADD COLUMN IF NOT EXISTS conjuge_nacionalidade VARCHAR(50),
  ADD COLUMN IF NOT EXISTS conjuge_naturalidade VARCHAR(100),
  ADD COLUMN IF NOT EXISTS conjuge_nome_pai VARCHAR(255),
  ADD COLUMN IF NOT EXISTS conjuge_nome_mae VARCHAR(255),
  ADD COLUMN IF NOT EXISTS conjuge_titulo_eleitoral VARCHAR(50),
  ADD COLUMN IF NOT EXISTS conjuge_fone VARCHAR(20),
  ADD COLUMN IF NOT EXISTS conjuge_email VARCHAR(255),
  ADD COLUMN IF NOT EXISTS conjuge_tipo_sanguineo VARCHAR(5),
  ADD COLUMN IF NOT EXISTS primeiro_casamento VARCHAR(3) DEFAULT 'SIM',
  ADD COLUMN IF NOT EXISTS qtd_filhos INTEGER DEFAULT 0;

-- Comentários descritivos
COMMENT ON COLUMN public.members.uf_rg IS 'UF do órgão expedidor do RG';
COMMENT ON COLUMN public.members.municipio_eleitoral IS 'Município do domicílio eleitoral';
COMMENT ON COLUMN public.members.email2 IS 'Segundo endereço de e-mail';
COMMENT ON COLUMN public.members.posicao_no_campo IS 'Posição/cargo do ministro no campo';
COMMENT ON COLUMN public.members.numero_cgadb IS 'Número de registro no CGADB';
COMMENT ON COLUMN public.members.local_batismo IS 'Local onde o ministro foi batizado';
COMMENT ON COLUMN public.members.data_filiacao IS 'Data de filiação à assembleia';
COMMENT ON COLUMN public.members.diretoria IS 'Indica se pertence à diretoria';
COMMENT ON COLUMN public.members.ev_autorizado_data IS 'Data da consagração como Evangelista Autorizado';
COMMENT ON COLUMN public.members.ev_autorizado_local IS 'Local da consagração como Evangelista Autorizado';
COMMENT ON COLUMN public.members.ev_consagrado_data IS 'Data da consagração como Evangelista Consagrado';
COMMENT ON COLUMN public.members.ev_consagrado_local IS 'Local da consagração como Evangelista Consagrado';
COMMENT ON COLUMN public.members.cons_missionario_data IS 'Data da consagração como Conselheiro Missionário';
COMMENT ON COLUMN public.members.cons_missionario_local IS 'Local da consagração como Conselheiro Missionário';
COMMENT ON COLUMN public.members.orden_pastor_data IS 'Data da ordenação pastoral';
COMMENT ON COLUMN public.members.orden_pastor_local IS 'Local da ordenação pastoral';
COMMENT ON COLUMN public.members.conjuge_rg IS 'RG do cônjuge';
COMMENT ON COLUMN public.members.conjuge_orgao_emissor IS 'Órgão emissor do RG do cônjuge';
COMMENT ON COLUMN public.members.conjuge_nacionalidade IS 'Nacionalidade do cônjuge';
COMMENT ON COLUMN public.members.conjuge_naturalidade IS 'Naturalidade do cônjuge';
COMMENT ON COLUMN public.members.conjuge_nome_pai IS 'Nome do pai do cônjuge';
COMMENT ON COLUMN public.members.conjuge_nome_mae IS 'Nome da mãe do cônjuge';
COMMENT ON COLUMN public.members.conjuge_titulo_eleitoral IS 'Título de eleitor do cônjuge';
COMMENT ON COLUMN public.members.conjuge_fone IS 'Telefone do cônjuge';
COMMENT ON COLUMN public.members.conjuge_email IS 'E-mail do cônjuge';
COMMENT ON COLUMN public.members.conjuge_tipo_sanguineo IS 'Tipo sanguíneo do cônjuge';
COMMENT ON COLUMN public.members.primeiro_casamento IS 'Indica se é o primeiro casamento (SIM/NAO)';
COMMENT ON COLUMN public.members.qtd_filhos IS 'Quantidade de filhos';
