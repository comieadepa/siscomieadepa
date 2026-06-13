-- Create conec_instituicoes table
CREATE TABLE IF NOT EXISTS public.conec_instituicoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome_instituicao text NOT NULL,
  cnpj text NOT NULL UNIQUE,
  nome_representante text NOT NULL,
  cpf_representante text NOT NULL,
  email_representante text NOT NULL,
  telefone_representante text,
  whatsapp text,
  cep text,
  logradouro text,
  numero text,
  complemento text,
  bairro text,
  cidade text,
  estado text,
  status text NOT NULL DEFAULT 'ativo',
  observacoes_internas text,
  asaas_customer_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

-- Create conec_credenciamentos table
CREATE TABLE IF NOT EXISTS public.conec_credenciamentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instituicao_id uuid NOT NULL REFERENCES public.conec_instituicoes(id),
  ano_referencia integer NOT NULL,
  numero_registro text UNIQUE,
  data_inicio date NOT NULL,
  data_fim date NOT NULL,
  data_emissao timestamptz,
  status_credenciamento text NOT NULL DEFAULT 'aguardando_pagamento',
  status_pagamento text NOT NULL DEFAULT 'pendente',
  valor numeric(10,2) NOT NULL DEFAULT 800.00,
  asaas_payment_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

-- Indices for performance
CREATE INDEX IF NOT EXISTS idx_conec_instituicoes_cnpj ON public.conec_instituicoes(cnpj) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_conec_credenciamentos_inst ON public.conec_credenciamentos(instituicao_id) WHERE deleted_at IS NULL;

-- Setup update_updated_at_column triggers
DROP TRIGGER IF EXISTS tr_conec_instituicoes_updated_at ON public.conec_instituicoes;
CREATE TRIGGER tr_conec_instituicoes_updated_at
  BEFORE UPDATE ON public.conec_instituicoes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS tr_conec_credenciamentos_updated_at ON public.conec_credenciamentos;
CREATE TRIGGER tr_conec_credenciamentos_updated_at
  BEFORE UPDATE ON public.conec_credenciamentos
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
