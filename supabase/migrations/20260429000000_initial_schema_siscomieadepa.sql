-- ============================================================
-- SISCOMIEADEPA - Schema Inicial
-- Sistema Single-Tenant (uma instituicao unica)
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Funcao generica para updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $func$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$func$ LANGUAGE plpgsql;

-- ============================================================
-- ADMIN_USERS (Painel administrativo do sistema)
-- ============================================================
CREATE TABLE public.admin_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash TEXT,
  name VARCHAR(255),
  role VARCHAR(50) NOT NULL DEFAULT 'admin',
  status VARCHAR(20) NOT NULL DEFAULT 'ATIVO',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT valid_role CHECK (role IN ('admin','financeiro','suporte')),
  CONSTRAINT valid_status CHECK (status IN ('ATIVO','INATIVO'))
);

ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_users_service_only" ON public.admin_users USING (true);

-- ============================================================
-- USERS (Usuarios do sistema - vinculados ao auth.users)
-- ============================================================
CREATE TABLE public.users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL UNIQUE,
  name VARCHAR(255),
  role VARCHAR(50) DEFAULT 'operator',
  is_active BOOLEAN DEFAULT true,
  last_activity TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT valid_role CHECK (role IN ('admin','manager','operator','viewer'))
);

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_own" ON public.users FOR ALL USING (id = auth.uid());
CREATE POLICY "users_admin_all" ON public.users FOR ALL
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin','manager')));

CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- CONFIGURATIONS (Configuracoes gerais do sistema)
-- ============================================================
CREATE TABLE public.configurations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key VARCHAR(100) NOT NULL UNIQUE,
  value JSONB,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.configurations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "config_authenticated_read" ON public.configurations FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "config_admin_write" ON public.configurations FOR ALL
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin','manager')));

CREATE TRIGGER trg_configurations_updated_at BEFORE UPDATE ON public.configurations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- SUPERVISOES
-- ============================================================
CREATE TABLE public.supervisoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome VARCHAR(255) NOT NULL UNIQUE,
  codigo VARCHAR(20),
  codigo_uf VARCHAR(2),
  is_active BOOLEAN DEFAULT true,
  supervisor_member_id UUID,
  supervisor_nome_snapshot VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_supervisoes_is_active ON public.supervisoes(is_active);

ALTER TABLE public.supervisoes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "supervisoes_authenticated" ON public.supervisoes FOR ALL USING (auth.uid() IS NOT NULL);

CREATE TRIGGER trg_supervisoes_updated_at BEFORE UPDATE ON public.supervisoes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- CAMPOS
-- ============================================================
CREATE TABLE public.campos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supervisao_id UUID REFERENCES public.supervisoes(id) ON DELETE SET NULL,
  nome VARCHAR(255) NOT NULL,
  codigo VARCHAR(20),
  is_sede BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_campos_supervisao_id ON public.campos(supervisao_id);
CREATE INDEX idx_campos_is_active ON public.campos(is_active);

ALTER TABLE public.campos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "campos_authenticated" ON public.campos FOR ALL USING (auth.uid() IS NOT NULL);

CREATE TRIGGER trg_campos_updated_at BEFORE UPDATE ON public.campos
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- CONGREGACOES
-- ============================================================
CREATE TABLE public.congregacoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supervisao_id UUID REFERENCES public.supervisoes(id) ON DELETE SET NULL,
  campo_id UUID REFERENCES public.campos(id) ON DELETE SET NULL,
  nome VARCHAR(255) NOT NULL,
  codigo VARCHAR(20),
  endereco VARCHAR(500),
  complemento VARCHAR(255),
  bairro VARCHAR(100),
  cidade VARCHAR(100),
  uf VARCHAR(2),
  cep VARCHAR(10),
  telefone VARCHAR(20),
  dirigente_nome VARCHAR(255),
  dirigente_member_id UUID,
  tipo_imovel VARCHAR(100),
  foto_imovel_url VARCHAR(500),
  is_sede BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_congregacoes_supervisao_id ON public.congregacoes(supervisao_id);
CREATE INDEX idx_congregacoes_campo_id ON public.congregacoes(campo_id);
CREATE INDEX idx_congregacoes_is_active ON public.congregacoes(is_active);

ALTER TABLE public.congregacoes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "congregacoes_authenticated" ON public.congregacoes FOR ALL USING (auth.uid() IS NOT NULL);

CREATE TRIGGER trg_congregacoes_updated_at BEFORE UPDATE ON public.congregacoes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- MEMBERS (Membros)
-- ============================================================
CREATE TABLE public.members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  congregacao_id UUID REFERENCES public.congregacoes(id) ON DELETE SET NULL,
  supervisao_id UUID REFERENCES public.supervisoes(id) ON DELETE SET NULL,

  -- Identificacao
  matricula VARCHAR(50),
  tipo_cadastro VARCHAR(50) DEFAULT 'membro',
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  phone VARCHAR(20),
  whatsapp VARCHAR(20),
  cpf VARCHAR(20),
  rg VARCHAR(20),
  orgao_emissor VARCHAR(50),

  -- Dados pessoais
  birth_date DATE,
  gender VARCHAR(20),
  estado_civil VARCHAR(50),
  naturalidade VARCHAR(100),
  nacionalidade VARCHAR(100),
  nome_pai VARCHAR(255),
  nome_mae VARCHAR(255),
  occupation VARCHAR(255),
  escolaridade VARCHAR(100),

  -- Endereco
  address VARCHAR(500),
  complement VARCHAR(255),
  bairro VARCHAR(100),
  city VARCHAR(100),
  state VARCHAR(2),
  zipcode VARCHAR(20),
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,

  -- Ministerio
  member_since DATE DEFAULT CURRENT_DATE,
  data_batismo DATE,
  data_casamento DATE,
  role VARCHAR(100),
  divisao_1 VARCHAR(100),
  divisao_2 VARCHAR(100),
  divisao_3 VARCHAR(100),
  status VARCHAR(50) NOT NULL DEFAULT 'active',

  -- Foto e extras
  foto_url VARCHAR(500),
  custom_fields JSONB DEFAULT '{}',
  notes TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT valid_status CHECK (status IN ('active','inactive','deceased','transferred'))
);

CREATE INDEX idx_members_congregacao_id ON public.members(congregacao_id);
CREATE INDEX idx_members_supervisao_id ON public.members(supervisao_id);
CREATE INDEX idx_members_cpf ON public.members(cpf);
CREATE INDEX idx_members_status ON public.members(status);
CREATE INDEX idx_members_tipo_cadastro ON public.members(tipo_cadastro);
CREATE INDEX idx_members_name ON public.members USING GIN (name gin_trgm_ops);

ALTER TABLE public.members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members_authenticated" ON public.members FOR ALL USING (auth.uid() IS NOT NULL);

CREATE TRIGGER trg_members_updated_at BEFORE UPDATE ON public.members
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- EMPLOYEES (Funcionarios)
-- ============================================================
CREATE TABLE public.employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  grupo VARCHAR(100) NOT NULL,
  funcao VARCHAR(100) NOT NULL,
  data_admissao DATE NOT NULL,
  email VARCHAR(255),
  telefone VARCHAR(20),
  whatsapp VARCHAR(20),
  rg VARCHAR(20),
  endereco VARCHAR(500),
  cep VARCHAR(20),
  bairro VARCHAR(100),
  cidade VARCHAR(100),
  uf VARCHAR(2),
  banco VARCHAR(50),
  agencia VARCHAR(20),
  conta_corrente VARCHAR(20),
  pix VARCHAR(255),
  obs TEXT,
  status VARCHAR(50) NOT NULL DEFAULT 'ATIVO',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT valid_status CHECK (status IN ('ATIVO','INATIVO'))
);

CREATE INDEX idx_employees_member_id ON public.employees(member_id);
CREATE INDEX idx_employees_status ON public.employees(status);
CREATE INDEX idx_employees_grupo ON public.employees(grupo);

ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
CREATE POLICY "employees_authenticated" ON public.employees FOR ALL USING (auth.uid() IS NOT NULL);

CREATE TRIGGER trg_employees_updated_at BEFORE UPDATE ON public.employees
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- CARTOES_TEMPLATES
-- ============================================================
CREATE TABLE public.cartoes_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  tipo VARCHAR(50),
  description TEXT,
  template_data JSONB NOT NULL DEFAULT '{}',
  preview_url VARCHAR(500),
  is_default BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.cartoes_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cartoes_templates_authenticated" ON public.cartoes_templates FOR ALL USING (auth.uid() IS NOT NULL);

CREATE TRIGGER trg_cartoes_templates_updated_at BEFORE UPDATE ON public.cartoes_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- CARTOES_GERADOS
-- ============================================================
CREATE TABLE public.cartoes_gerados (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  template_id UUID REFERENCES public.cartoes_templates(id) ON DELETE SET NULL,
  pdf_url VARCHAR(500),
  qr_code_data VARCHAR(500),
  generated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  printed_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_cartoes_gerados_member_id ON public.cartoes_gerados(member_id);
CREATE INDEX idx_cartoes_gerados_created_at ON public.cartoes_gerados(created_at);

ALTER TABLE public.cartoes_gerados ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cartoes_gerados_authenticated" ON public.cartoes_gerados FOR ALL USING (auth.uid() IS NOT NULL);

-- ============================================================
-- AUDIT_LOGS
-- ============================================================
CREATE TABLE public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action VARCHAR(100) NOT NULL,
  resource_type VARCHAR(100) NOT NULL,
  resource_id UUID,
  old_data JSONB,
  new_data JSONB,
  ip_address INET,
  user_agent VARCHAR(500),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_user_id ON public.audit_logs(user_id);
CREATE INDEX idx_audit_logs_resource ON public.audit_logs(resource_type, resource_id);
CREATE INDEX idx_audit_logs_created_at ON public.audit_logs(created_at DESC);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit_logs_insert_all" ON public.audit_logs FOR INSERT WITH CHECK (true);
CREATE POLICY "audit_logs_select_auth" ON public.audit_logs FOR SELECT USING (auth.uid() IS NOT NULL);

-- ============================================================
-- SUPPORT_TICKETS
-- ============================================================
CREATE TABLE public.support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ticket_number VARCHAR(20) UNIQUE,
  subject VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  category VARCHAR(50) NOT NULL DEFAULT 'general',
  priority VARCHAR(50) DEFAULT 'medium',
  status VARCHAR(50) DEFAULT 'open',
  resolution_notes TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_support_tickets_status ON public.support_tickets(status);
CREATE INDEX idx_support_tickets_created_at ON public.support_tickets(created_at);

ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tickets_authenticated" ON public.support_tickets FOR ALL USING (auth.uid() IS NOT NULL);

CREATE TRIGGER trg_support_tickets_updated_at BEFORE UPDATE ON public.support_tickets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- SUPPORT_TICKET_MESSAGES
-- ============================================================
CREATE TABLE public.support_ticket_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  message TEXT NOT NULL,
  is_internal BOOLEAN DEFAULT false,
  attachments JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ticket_messages_ticket_id ON public.support_ticket_messages(ticket_id);

ALTER TABLE public.support_ticket_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ticket_messages_authenticated" ON public.support_ticket_messages FOR ALL USING (auth.uid() IS NOT NULL);

-- ============================================================
-- PRE_REGISTRATIONS (Solicita oes de acesso / leads)
-- ============================================================
CREATE TABLE public.pre_registrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ministry_name VARCHAR(255) NOT NULL,
  pastor_name VARCHAR(255) NOT NULL,
  responsible_name VARCHAR(255),
  email VARCHAR(255) NOT NULL,
  whatsapp VARCHAR(30),
  phone VARCHAR(30),
  website VARCHAR(255),
  cpf_cnpj VARCHAR(20),
  quantity_temples INTEGER DEFAULT 1,
  quantity_members INTEGER DEFAULT 0,
  status VARCHAR(50) DEFAULT 'pending',
  trial_expires_at TIMESTAMPTZ,
  trial_days INTEGER DEFAULT 7,
  address_street VARCHAR(255),
  address_number VARCHAR(20),
  address_complement VARCHAR(255),
  address_city VARCHAR(100),
  address_state VARCHAR(2),
  address_zip VARCHAR(10),
  description TEXT,
  plan VARCHAR(50) DEFAULT 'starter',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_pre_registrations_status ON public.pre_registrations(status);
CREATE INDEX idx_pre_registrations_email ON public.pre_registrations(email);

ALTER TABLE public.pre_registrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pre_reg_insert_public" ON public.pre_registrations FOR INSERT WITH CHECK (true);
CREATE POLICY "pre_reg_select_auth" ON public.pre_registrations FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "pre_reg_update_auth" ON public.pre_registrations FOR UPDATE USING (auth.uid() IS NOT NULL);

-- ============================================================
-- ADMIN_NOTIFICATIONS
-- ============================================================
CREATE TABLE public.admin_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type VARCHAR(100) NOT NULL,
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  data JSONB,
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  read_at TIMESTAMPTZ
);

ALTER TABLE public.admin_notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_notif_authenticated" ON public.admin_notifications FOR ALL USING (auth.uid() IS NOT NULL);

-- ============================================================
-- BATISMO_AGENDAMENTOS
-- ============================================================
CREATE TABLE public.batismo_agendamentos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  data_evento DATE NOT NULL,
  horario TIME,
  local VARCHAR(255),
  observacoes TEXT,
  status VARCHAR(50) DEFAULT 'agendado',
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.batismo_agendamentos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "batismo_agendamentos_auth" ON public.batismo_agendamentos FOR ALL USING (auth.uid() IS NOT NULL);

CREATE TRIGGER trg_batismo_agend_updated_at BEFORE UPDATE ON public.batismo_agendamentos
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- BATISMO_CADASTROS
-- ============================================================
CREATE TABLE public.batismo_cadastros (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agendamento_id UUID REFERENCES public.batismo_agendamentos(id) ON DELETE SET NULL,
  member_id UUID REFERENCES public.members(id) ON DELETE SET NULL,
  nome VARCHAR(255) NOT NULL,
  data_nascimento DATE,
  cpf VARCHAR(20),
  telefone VARCHAR(20),
  email VARCHAR(255),
  endereco TEXT,
  nome_pai VARCHAR(255),
  nome_mae VARCHAR(255),
  data_batismo DATE,
  observacoes TEXT,
  status VARCHAR(50) DEFAULT 'cadastrado',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_batismo_cadastros_member_id ON public.batismo_cadastros(member_id);
CREATE INDEX idx_batismo_cadastros_nome ON public.batismo_cadastros(nome);

ALTER TABLE public.batismo_cadastros ENABLE ROW LEVEL SECURITY;
CREATE POLICY "batismo_cadastros_auth" ON public.batismo_cadastros FOR ALL USING (auth.uid() IS NOT NULL);

CREATE TRIGGER trg_batismo_cadastros_updated_at BEFORE UPDATE ON public.batismo_cadastros
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- BATISMO_REGISTROS
-- ============================================================
CREATE TABLE public.batismo_registros (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agendamento_id UUID REFERENCES public.batismo_agendamentos(id) ON DELETE SET NULL,
  cadastro_id UUID REFERENCES public.batismo_cadastros(id) ON DELETE SET NULL,
  member_id UUID REFERENCES public.members(id) ON DELETE SET NULL,
  data_batismo DATE NOT NULL,
  local VARCHAR(255),
  ministro VARCHAR(255),
  certificado_url VARCHAR(500),
  status VARCHAR(50) DEFAULT 'realizado',
  observacoes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.batismo_registros ENABLE ROW LEVEL SECURITY;
CREATE POLICY "batismo_registros_auth" ON public.batismo_registros FOR ALL USING (auth.uid() IS NOT NULL);

-- ============================================================
-- CASAMENTOS_AGENDAMENTOS
-- ============================================================
CREATE TABLE public.casamentos_agendamentos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  data_evento DATE NOT NULL,
  horario TIME,
  local VARCHAR(255),
  observacoes TEXT,
  status VARCHAR(50) DEFAULT 'agendado',
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.casamentos_agendamentos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "casamentos_agendamentos_auth" ON public.casamentos_agendamentos FOR ALL USING (auth.uid() IS NOT NULL);

CREATE TRIGGER trg_casamentos_agend_updated_at BEFORE UPDATE ON public.casamentos_agendamentos
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- CASAMENTOS_CADASTROS
-- ============================================================
CREATE TABLE public.casamentos_cadastros (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agendamento_id UUID REFERENCES public.casamentos_agendamentos(id) ON DELETE SET NULL,
  noivo_nome VARCHAR(255) NOT NULL,
  noiva_nome VARCHAR(255) NOT NULL,
  noivo_member_id UUID REFERENCES public.members(id) ON DELETE SET NULL,
  noiva_member_id UUID REFERENCES public.members(id) ON DELETE SET NULL,
  noivo_cpf VARCHAR(20),
  noiva_cpf VARCHAR(20),
  noivo_telefone VARCHAR(20),
  noiva_telefone VARCHAR(20),
  data_casamento DATE,
  local VARCHAR(255),
  observacoes TEXT,
  status VARCHAR(50) DEFAULT 'cadastrado',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.casamentos_cadastros ENABLE ROW LEVEL SECURITY;
CREATE POLICY "casamentos_cadastros_auth" ON public.casamentos_cadastros FOR ALL USING (auth.uid() IS NOT NULL);

CREATE TRIGGER trg_casamentos_cadastros_updated_at BEFORE UPDATE ON public.casamentos_cadastros
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- CASAMENTOS_REGISTROS
-- ============================================================
CREATE TABLE public.casamentos_registros (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agendamento_id UUID REFERENCES public.casamentos_agendamentos(id) ON DELETE SET NULL,
  cadastro_id UUID REFERENCES public.casamentos_cadastros(id) ON DELETE SET NULL,
  noivo_member_id UUID REFERENCES public.members(id) ON DELETE SET NULL,
  noiva_member_id UUID REFERENCES public.members(id) ON DELETE SET NULL,
  data_casamento DATE NOT NULL,
  local VARCHAR(255),
  ministro VARCHAR(255),
  certificado_url VARCHAR(500),
  status VARCHAR(50) DEFAULT 'realizado',
  observacoes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.casamentos_registros ENABLE ROW LEVEL SECURITY;
CREATE POLICY "casamentos_registros_auth" ON public.casamentos_registros FOR ALL USING (auth.uid() IS NOT NULL);

-- ============================================================
-- CONSAGRACAO_REGISTROS
-- ============================================================
CREATE TABLE public.consagracao_registros (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID REFERENCES public.members(id) ON DELETE SET NULL,
  numero VARCHAR(50),
  nome VARCHAR(255) NOT NULL,
  cpf VARCHAR(20),
  data_consagracao DATE,
  cargo VARCHAR(100),
  ministro_consagrador VARCHAR(255),
  local VARCHAR(255),
  congregacao_origem VARCHAR(255),
  supervisor_origem VARCHAR(255),
  observacoes TEXT,
  certificado_url VARCHAR(500),
  status VARCHAR(50) DEFAULT 'ativo',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_consagracao_registros_member_id ON public.consagracao_registros(member_id);
CREATE INDEX idx_consagracao_registros_cpf ON public.consagracao_registros(cpf);
CREATE INDEX idx_consagracao_registros_status ON public.consagracao_registros(status);

ALTER TABLE public.consagracao_registros ENABLE ROW LEVEL SECURITY;
CREATE POLICY "consagracao_registros_auth" ON public.consagracao_registros FOR ALL USING (auth.uid() IS NOT NULL);

CREATE TRIGGER trg_consagracao_updated_at BEFORE UPDATE ON public.consagracao_registros
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- APRESENTACAO_CRIANCAS_AGENDAMENTOS
-- ============================================================
CREATE TABLE public.apresentacao_criancas_agendamentos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  data_evento DATE NOT NULL,
  horario TIME,
  local VARCHAR(255),
  observacoes TEXT,
  status VARCHAR(50) DEFAULT 'agendado',
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.apresentacao_criancas_agendamentos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "apresentacao_agend_auth" ON public.apresentacao_criancas_agendamentos FOR ALL USING (auth.uid() IS NOT NULL);

-- ============================================================
-- APRESENTACAO_CRIANCAS_REGISTROS
-- ============================================================
CREATE TABLE public.apresentacao_criancas_registros (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agendamento_id UUID REFERENCES public.apresentacao_criancas_agendamentos(id) ON DELETE SET NULL,
  member_id UUID REFERENCES public.members(id) ON DELETE SET NULL,
  nome_crianca VARCHAR(255) NOT NULL,
  data_nascimento DATE,
  nome_pai VARCHAR(255),
  nome_mae VARCHAR(255),
  telefone_contato VARCHAR(20),
  observacoes TEXT,
  status VARCHAR(50) DEFAULT 'realizado',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.apresentacao_criancas_registros ENABLE ROW LEVEL SECURITY;
CREATE POLICY "apresentacao_reg_auth" ON public.apresentacao_criancas_registros FOR ALL USING (auth.uid() IS NOT NULL);

-- ============================================================
-- RATE_LIMIT_BUCKETS
-- ============================================================
CREATE TABLE public.rate_limit_buckets (
  key VARCHAR(255) PRIMARY KEY,
  tokens DOUBLE PRECISION NOT NULL DEFAULT 10,
  last_refill TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.rate_limit_buckets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rate_limit_service_only" ON public.rate_limit_buckets USING (true);

CREATE OR REPLACE FUNCTION public.consume_rate_limit(
  p_key TEXT,
  p_max_tokens DOUBLE PRECISION DEFAULT 10,
  p_refill_rate DOUBLE PRECISION DEFAULT 1,
  p_cost DOUBLE PRECISION DEFAULT 1
) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER AS $func$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_tokens DOUBLE PRECISION;
  v_elapsed DOUBLE PRECISION;
  v_last_refill TIMESTAMPTZ;
BEGIN
  INSERT INTO public.rate_limit_buckets (key, tokens, last_refill)
  VALUES (p_key, p_max_tokens - p_cost, v_now)
  ON CONFLICT (key) DO UPDATE
    SET
      tokens = LEAST(p_max_tokens,
                rate_limit_buckets.tokens
                + EXTRACT(EPOCH FROM (v_now - rate_limit_buckets.last_refill)) * p_refill_rate
               ) - p_cost,
      last_refill = v_now
  RETURNING tokens INTO v_tokens;

  RETURN v_tokens >= 0;
END;
$func$;

-- ============================================================
-- PUBLIC_API_EVENTS
-- ============================================================
CREATE TABLE public.public_api_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type VARCHAR(100) NOT NULL,
  payload JSONB,
  ip_address INET,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.public_api_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_api_events_insert" ON public.public_api_events FOR INSERT WITH CHECK (true);
CREATE POLICY "public_api_events_select_auth" ON public.public_api_events FOR SELECT USING (auth.uid() IS NOT NULL);

-- ============================================================
-- VIEW UTIL: employees com info do membro
-- ============================================================
CREATE OR REPLACE VIEW public.employees_with_member_info AS
SELECT
  e.id, e.member_id, e.grupo, e.funcao, e.data_admissao,
  e.email, e.telefone, e.whatsapp, e.rg,
  e.endereco, e.cep, e.bairro, e.cidade, e.uf,
  e.banco, e.agencia, e.conta_corrente, e.pix,
  e.obs, e.status, e.created_at, e.updated_at,
  m.name AS member_name,
  m.cpf AS member_cpf,
  m.phone AS member_phone,
  m.birth_date AS member_birth_date
FROM public.employees e
LEFT JOIN public.members m ON e.member_id = m.id;

-- ============================================================
-- FUNCAO: tamanho do banco
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_database_size_bytes()
RETURNS BIGINT LANGUAGE sql SECURITY DEFINER AS $func$
  SELECT pg_database_size(current_database());
$func$;

-- ============================================================
-- FUNCAO: schema de tabela (para admin)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_table_schema(p_table_name TEXT)
RETURNS TABLE(column_name TEXT, data_type TEXT, is_nullable TEXT)
LANGUAGE sql SECURITY DEFINER AS $func$
  SELECT column_name::TEXT, data_type::TEXT, is_nullable::TEXT
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = p_table_name
  ORDER BY ordinal_position;
$func$;