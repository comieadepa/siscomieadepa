-- Migration: Campos ministeriais faltantes para importação da planilha COMIEADEPA
-- Data: 2026-04-30
-- Referência: análise de mapeamento planilha → members

ALTER TABLE public.members
  -- Diácono
  ADD COLUMN IF NOT EXISTS diacono_data        DATE,
  ADD COLUMN IF NOT EXISTS diacono_local        VARCHAR(255),
  ADD COLUMN IF NOT EXISTS cert_diacono         VARCHAR(255),

  -- Presbítero
  ADD COLUMN IF NOT EXISTS presbitero_local     VARCHAR(255),
  ADD COLUMN IF NOT EXISTS presbitero_data      DATE,
  ADD COLUMN IF NOT EXISTS cert_presbitero      VARCHAR(255),

  -- Evangelista (certificados — os dados/local já existem)
  ADD COLUMN IF NOT EXISTS cert_evangelista     VARCHAR(255),
  ADD COLUMN IF NOT EXISTS cert_pastor          VARCHAR(255),

  -- Registro COMIEADEPA (coluna dedicada, além de custom_fields)
  ADD COLUMN IF NOT EXISTS registro_comieadepa  VARCHAR(50),

  -- Campos de situação / controle
  ADD COLUMN IF NOT EXISTS convencional         BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS apto_votar           BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS efetivo              BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS ministerial          BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS homologado           BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS jubilado             BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS data_jubilacao       DATE,
  ADD COLUMN IF NOT EXISTS data_falecimento     DATE,
  ADD COLUMN IF NOT EXISTS local_falecimento    VARCHAR(255),

  -- Transferências
  ADD COLUMN IF NOT EXISTS data_transferido_em  DATE,
  ADD COLUMN IF NOT EXISTS data_transferido_para VARCHAR(255),
  ADD COLUMN IF NOT EXISTS local_transferencia  VARCHAR(255),
  ADD COLUMN IF NOT EXISTS data_recebido_transferencia DATE,

  -- Credencial
  ADD COLUMN IF NOT EXISTS cred_validade        DATE,
  ADD COLUMN IF NOT EXISTS cred_vencida         BOOLEAN DEFAULT FALSE,

  -- Diretoria
  ADD COLUMN IF NOT EXISTS diretoria_cargo      VARCHAR(100),

  -- Família
  ADD COLUMN IF NOT EXISTS conjuge_foto_url     TEXT;

-- Comentários
COMMENT ON COLUMN public.members.diacono_data        IS 'Data de consagração como Diácono';
COMMENT ON COLUMN public.members.diacono_local       IS 'Local de consagração como Diácono';
COMMENT ON COLUMN public.members.cert_diacono        IS 'Número/referência do certificado de Diácono';
COMMENT ON COLUMN public.members.presbitero_local    IS 'Local de consagração como Presbítero';
COMMENT ON COLUMN public.members.presbitero_data     IS 'Data de consagração como Presbítero';
COMMENT ON COLUMN public.members.cert_presbitero     IS 'Número/referência do certificado de Presbítero';
COMMENT ON COLUMN public.members.cert_evangelista    IS 'Número/referência do certificado de Evangelista';
COMMENT ON COLUMN public.members.cert_pastor         IS 'Número/referência do certificado de Pastor';
COMMENT ON COLUMN public.members.registro_comieadepa IS 'Número de registro no COMIEADEPA';
COMMENT ON COLUMN public.members.convencional        IS 'Ministro convencional (S/N)';
COMMENT ON COLUMN public.members.apto_votar          IS 'Apto para votar em assembleias';
COMMENT ON COLUMN public.members.efetivo             IS 'Ministro efetivo';
COMMENT ON COLUMN public.members.ministerial         IS 'Na lista ministerial ativa';
COMMENT ON COLUMN public.members.homologado          IS 'Homologado pela convenção';
COMMENT ON COLUMN public.members.jubilado            IS 'Ministro jubilado';
COMMENT ON COLUMN public.members.data_jubilacao      IS 'Data de jubilação';
COMMENT ON COLUMN public.members.data_falecimento    IS 'Data de falecimento';
COMMENT ON COLUMN public.members.local_falecimento   IS 'Local de falecimento';
COMMENT ON COLUMN public.members.data_transferido_em IS 'Data em que foi transferido para outra convenção';
COMMENT ON COLUMN public.members.data_transferido_para IS 'Convenção/local para onde foi transferido';
COMMENT ON COLUMN public.members.local_transferencia  IS 'Local de origem/destino da transferência';
COMMENT ON COLUMN public.members.data_recebido_transferencia IS 'Data em que foi recebido por transferência';
COMMENT ON COLUMN public.members.cred_validade       IS 'Validade da credencial ministerial';
COMMENT ON COLUMN public.members.cred_vencida        IS 'Credencial vencida';
COMMENT ON COLUMN public.members.diretoria_cargo     IS 'Cargo ocupado na diretoria';
COMMENT ON COLUMN public.members.conjuge_foto_url    IS 'URL da foto do cônjuge';

-- Índices úteis para consultas
CREATE INDEX IF NOT EXISTS idx_members_registro_comieadepa ON public.members(registro_comieadepa);
CREATE INDEX IF NOT EXISTS idx_members_jubilado           ON public.members(jubilado);
CREATE INDEX IF NOT EXISTS idx_members_cred_validade      ON public.members(cred_validade);
