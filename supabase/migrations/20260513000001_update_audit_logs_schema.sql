-- ============================================================
-- Atualiza audit_logs para o schema esperado pela aplicação.
-- A tabela original tinha: user_id, action, resource_type,
-- resource_id, old_data, new_data, ip_address, user_agent,
-- created_at (timestamptz).
-- Adicionamos as colunas usadas pelo módulo de auditoria
-- mantendo as antigas para compatibilidade.
-- ============================================================

-- Novas colunas para o módulo de auditoria da aplicação
ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS usuario_email  TEXT,
  ADD COLUMN IF NOT EXISTS acao           TEXT,
  ADD COLUMN IF NOT EXISTS modulo         TEXT,
  ADD COLUMN IF NOT EXISTS area           TEXT,
  ADD COLUMN IF NOT EXISTS tabela_afetada TEXT,
  ADD COLUMN IF NOT EXISTS registro_id_str TEXT,
  ADD COLUMN IF NOT EXISTS descricao      TEXT,
  ADD COLUMN IF NOT EXISTS dados_anteriores JSONB,
  ADD COLUMN IF NOT EXISTS dados_novos    JSONB,
  ADD COLUMN IF NOT EXISTS status         TEXT DEFAULT 'sucesso',
  ADD COLUMN IF NOT EXISTS mensagem_erro  TEXT;

-- Índices adicionais para as novas colunas
CREATE INDEX IF NOT EXISTS idx_audit_logs_acao    ON public.audit_logs(acao);
CREATE INDEX IF NOT EXISTS idx_audit_logs_modulo  ON public.audit_logs(modulo);
CREATE INDEX IF NOT EXISTS idx_audit_logs_status  ON public.audit_logs(status);
CREATE INDEX IF NOT EXISTS idx_audit_logs_email   ON public.audit_logs(usuario_email);

-- Garantir que a policy de SELECT não bloqueie super-admin via service-role
-- (service_role já bypassa RLS, mas garantimos que authenticated possa ver)
DROP POLICY IF EXISTS "audit_logs_select_auth"  ON public.audit_logs;
DROP POLICY IF EXISTS "audit_logs_insert_all"   ON public.audit_logs;

CREATE POLICY "audit_logs_insert_all"
  ON public.audit_logs FOR INSERT
  WITH CHECK (true);

CREATE POLICY "audit_logs_select_auth"
  ON public.audit_logs FOR SELECT
  USING (auth.uid() IS NOT NULL);
