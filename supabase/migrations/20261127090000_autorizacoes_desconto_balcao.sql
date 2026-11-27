-- ==============================================================================
-- Migration: Autorizações de Desconto no Balcão de Eventos (AGO)
-- Arquivo: supabase/migrations/20261127090000_autorizacoes_desconto_balcao.sql
-- ==============================================================================

-- 1. Ampliar a restrição de tipo da tabela evento_equipe para aceitar 'supervisor_descontos'
ALTER TABLE public.evento_equipe
  DROP CONSTRAINT IF EXISTS evento_equipe_tipo_check;

ALTER TABLE public.evento_equipe
  ADD CONSTRAINT evento_equipe_tipo_check
  CHECK (tipo IN ('operador', 'checkin', 'checkin_refeitorio', 'hospedagem', 'checkin_hospedagem', 'supervisor_descontos'));

-- 2. Tabela de Autorizações de Desconto
CREATE TABLE IF NOT EXISTS public.evento_desconto_autorizacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evento_id uuid NOT NULL REFERENCES public.eventos(id) ON DELETE CASCADE,
  
  -- Identificador único gerado na sessão do balcão (para idempotência e correlação)
  operacao_id text NOT NULL,
  
  -- Dados do inscrito no momento da solicitação
  nome_inscrito text NOT NULL,
  cpf text NULL,
  email text NULL,
  whatsapp text NULL,
  tipo_inscricao_id text NULL,
  modalidade_nome text NOT NULL,
  
  -- Valores financeiros em representação numérica segura (2 casas decimais)
  valor_original numeric(10,2) NOT NULL CHECK (valor_original >= 0),
  valor_desconto numeric(10,2) NOT NULL DEFAULT 0.00 CHECK (valor_desconto >= 0),
  valor_final numeric(10,2) NOT NULL CHECK (valor_final >= 0),
  
  -- Situação do ciclo de vida: pendente, autorizado, negado, cancelado
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'autorizado', 'negado', 'cancelado')),
  
  -- Operador solicitante (balcão)
  operador_id uuid NULL REFERENCES public.evento_equipe(id) ON DELETE SET NULL,
  operador_nome text NOT NULL,
  operador_email text NULL,
  
  -- Supervisor deliberador
  supervisor_id uuid NULL,
  supervisor_nome text NULL,
  supervisor_email text NULL,
  justificativa_supervisor text NULL,
  deliberado_em timestamptz NULL,
  
  -- Controle de utilização efetiva na inscrição
  utilizado boolean NOT NULL DEFAULT false,
  utilizado_em timestamptz NULL,
  inscricao_id uuid NULL REFERENCES public.evento_inscricoes(id) ON DELETE SET NULL,
  
  -- Metadados de auditoria e contingência
  solicitado_em timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- Invariante de integridade financeira: valor_desconto não pode exceder valor_original
  CONSTRAINT chk_desconto_nao_excede_original CHECK (valor_desconto <= valor_original),
  CONSTRAINT chk_valor_final_consistente CHECK (valor_final = valor_original - valor_desconto)
);

-- 3. Índices para consultas rápidas, listagens e polling
CREATE INDEX IF NOT EXISTS idx_evento_desconto_evento_status 
  ON public.evento_desconto_autorizacoes (evento_id, status);

CREATE INDEX IF NOT EXISTS idx_evento_desconto_operacao_id 
  ON public.evento_desconto_autorizacoes (operacao_id);

CREATE INDEX IF NOT EXISTS idx_evento_desconto_created_at 
  ON public.evento_desconto_autorizacoes (evento_id, created_at DESC);

-- Índice parcial para impedir múltiplas solicitações pendentes para a mesma operação
CREATE UNIQUE INDEX IF NOT EXISTS idx_evento_desconto_pendente_operacao
  ON public.evento_desconto_autorizacoes (operacao_id)
  WHERE status = 'pendente';

-- 4. Gatilho para atualizar updated_at automaticamente
CREATE OR REPLACE FUNCTION public.fn_evento_desconto_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_evento_desconto_updated_at ON public.evento_desconto_autorizacoes;
CREATE TRIGGER trg_evento_desconto_updated_at
  BEFORE UPDATE ON public.evento_desconto_autorizacoes
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_evento_desconto_updated_at();

-- 5. Habilitar Supabase Realtime para a tabela
ALTER PUBLICATION supabase_realtime ADD TABLE public.evento_desconto_autorizacoes;

-- 6. Habilitar RLS (com políticas seguras)
ALTER TABLE public.evento_desconto_autorizacoes ENABLE ROW LEVEL SECURITY;

-- Política de leitura: autenticados podem consultar solicitações de seus eventos
CREATE POLICY "Permitir leitura de autorizacoes por autenticados"
  ON public.evento_desconto_autorizacoes
  FOR SELECT
  TO authenticated
  USING (true);

-- Política de inserção/atualização via Service Role (as rotas de API controlam permissões com evento-guard)
CREATE POLICY "Permitir modificacoes via service role"
  ON public.evento_desconto_autorizacoes
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
