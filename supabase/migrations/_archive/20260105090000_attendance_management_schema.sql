-- ============================================
-- ATTENDANCE MANAGEMENT SYSTEM
-- Tabelas para gerenciar atendimento de pré-cadastros
-- ============================================

-- Pre-criar pre_registrations aqui pois é referenciada por FK abaixo.
-- A migração 20260330090000 também usa IF NOT EXISTS e apenas pulará.
CREATE TABLE IF NOT EXISTS public.pre_registrations (
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
  trial_expires_at TIMESTAMP WITH TIME ZONE,
  trial_days INTEGER DEFAULT 7,
  address_street VARCHAR(255),
  address_number VARCHAR(20),
  address_complement VARCHAR(255),
  address_city VARCHAR(100),
  address_state VARCHAR(2),
  address_zip VARCHAR(10),
  description TEXT,
  plan VARCHAR(50) DEFAULT 'starter',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pre_registrations_status ON public.pre_registrations(status);
CREATE INDEX IF NOT EXISTS idx_pre_registrations_email ON public.pre_registrations(email);
CREATE INDEX IF NOT EXISTS idx_pre_registrations_cpf_cnpj ON public.pre_registrations(cpf_cnpj);

-- ============================================
-- 1. ATTENDANCE_STATUS (Status de Atendimento)
-- ============================================

CREATE TABLE public.attendance_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pre_registration_id UUID NOT NULL REFERENCES public.pre_registrations(id) ON DELETE CASCADE,
  
  -- Status do atendimento
  status VARCHAR(50) NOT NULL DEFAULT 'not_contacted', -- not_contacted, in_progress, budget_sent, contract_generating, finalized_positive, finalized_negative
  
  -- Rastreamento
  assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  last_contact_at TIMESTAMP,
  next_followup_at TIMESTAMP,
  
  -- Observações
  notes TEXT,
  
  -- Timestamps
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_attendance_status_pre_registration_id ON public.attendance_status(pre_registration_id);
CREATE INDEX idx_attendance_status_status ON public.attendance_status(status);
CREATE INDEX idx_attendance_status_assigned_to ON public.attendance_status(assigned_to);

-- ============================================
-- 2. ATTENDANCE_HISTORY (Histórico de Atendimento)
-- ============================================

CREATE TABLE public.attendance_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attendance_status_id UUID NOT NULL REFERENCES public.attendance_status(id) ON DELETE CASCADE,
  
  -- Mudança de status
  from_status VARCHAR(50),
  to_status VARCHAR(50) NOT NULL,
  
  -- Quem fez a mudança
  changed_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  
  -- Descrição da mudança
  notes TEXT,
  
  -- Timestamps
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_attendance_history_attendance_status_id ON public.attendance_history(attendance_status_id);
CREATE INDEX idx_attendance_history_changed_by ON public.attendance_history(changed_by);
CREATE INDEX idx_attendance_history_created_at ON public.attendance_history(created_at);

-- ============================================
-- 3. TEST_CREDENTIALS (Credenciais de Teste)
-- ============================================

CREATE TABLE public.test_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pre_registration_id UUID NOT NULL REFERENCES public.pre_registrations(id) ON DELETE CASCADE,
  
  -- Credenciais
  username VARCHAR(100) NOT NULL,
  password VARCHAR(255) NOT NULL,
  temp_ministry_id UUID REFERENCES public.ministries(id) ON DELETE SET NULL,
  
  -- Status
  is_active BOOLEAN DEFAULT true,
  accessed_at TIMESTAMP,
  access_count INTEGER DEFAULT 0,
  
  -- Validade
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP + INTERVAL '7 days'
);

CREATE INDEX idx_test_credentials_pre_registration_id ON public.test_credentials(pre_registration_id);
CREATE INDEX idx_test_credentials_username ON public.test_credentials(username);
CREATE UNIQUE INDEX idx_test_credentials_unique ON public.test_credentials(pre_registration_id) WHERE is_active = true;

-- ============================================
-- 4. GENERATED_CONTRACTS (Contratos Gerados)
-- ============================================

CREATE TABLE public.generated_contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pre_registration_id UUID NOT NULL REFERENCES public.pre_registrations(id) ON DELETE CASCADE,
  
  -- Contrato
  contract_number VARCHAR(50) UNIQUE NOT NULL,
  contract_type VARCHAR(50) DEFAULT 'standard', -- standard, enterprise, custom
  
  -- Documento
  file_url VARCHAR(500),
  file_name VARCHAR(255),
  file_size_bytes INTEGER,
  
  -- Status
  status VARCHAR(50) DEFAULT 'draft', -- draft, generated, sent, signed, archived
  sent_at TIMESTAMP,
  signed_at TIMESTAMP,
  signed_by_name VARCHAR(255),
  
  -- Metadados
  contract_data JSONB, -- Dados usados para gerar contrato
  generated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  
  -- Timestamps
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_generated_contracts_pre_registration_id ON public.generated_contracts(pre_registration_id);
CREATE INDEX idx_generated_contracts_status ON public.generated_contracts(status);
CREATE INDEX idx_generated_contracts_generated_by ON public.generated_contracts(generated_by);

-- ============================================
-- ALTER pre_registrations TABLE
-- Adicionar coluna de quantidade de templos e membros
-- ============================================

ALTER TABLE public.pre_registrations 
ADD COLUMN IF NOT EXISTS quantity_temples INTEGER DEFAULT 1,
ADD COLUMN IF NOT EXISTS quantity_members INTEGER DEFAULT 0;

-- ============================================
-- RLS POLICIES (Será configurado manualmente)
-- ============================================

-- As RLS Policies serão adicionadas após validar a estrutura correta
-- de admin_users. Por enquanto, deixando sem RLS para permitir testes.
--
-- Tabelas que precisam RLS:
-- - attendance_status (apenas admins)
-- - attendance_history (apenas admins)
-- - test_credentials (apenas admins)
-- - generated_contracts (apenas admins)
