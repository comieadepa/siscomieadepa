-- Criar tabela de auditoria
-- Dependencias de FK e policies complexas sao adicionadas em migracoes posteriores
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID,
  usuario_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  usuario_email VARCHAR(255),
  acao VARCHAR(50) NOT NULL,
  modulo VARCHAR(100) NOT NULL,
  area VARCHAR(100),
  tabela_afetada VARCHAR(100),
  registro_id UUID,
  descricao TEXT,
  dados_anteriores JSONB,
  dados_novos JSONB,
  ip_address INET,
  user_agent TEXT,
  status VARCHAR(20) DEFAULT 'sucesso',
  mensagem_erro TEXT,
  data_criacao TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT valid_acao CHECK (acao IN ('criar', 'editar', 'deletar', 'visualizar', 'exportar', 'importar', 'responder', 'atualizar_status', 'atualizar_permissoes', 'login', 'logout', 'download', 'upload', 'outro')),
  CONSTRAINT valid_status CHECK (status IN ('sucesso', 'erro', 'aviso'))
);

CREATE INDEX IF NOT EXISTS idx_audit_empresa ON public.audit_logs(empresa_id);
CREATE INDEX IF NOT EXISTS idx_audit_usuario ON public.audit_logs(usuario_id);
CREATE INDEX IF NOT EXISTS idx_audit_modulo ON public.audit_logs(modulo);
CREATE INDEX IF NOT EXISTS idx_audit_acao ON public.audit_logs(acao);
CREATE INDEX IF NOT EXISTS idx_audit_data ON public.audit_logs(data_criacao DESC);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Sistema registra acoes"
  ON public.audit_logs FOR INSERT WITH CHECK (true);

CREATE POLICY "Autenticados veem todos os logs"
  ON public.audit_logs FOR SELECT USING (auth.uid() IS NOT NULL);

GRANT SELECT, INSERT ON public.audit_logs TO authenticated;
GRANT SELECT ON public.audit_logs TO anon;
