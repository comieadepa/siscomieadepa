-- ============================================================
-- Migration: Triggers automáticos de auditoria
-- Tabelas cobertas: members, eventos, evento_inscricoes,
--   evento_checkins, admin_users
-- Estratégia: função genérica audit_log_trigger() detecta a
--   tabela, a operação e insere em public.audit_logs.
--   user_id vem do auth.uid() — funciona quando RLS está ativo;
--   quando service_role é usado, user_id fica NULL mas a linha
--   ainda é registrada com os dados da operação.
-- ============================================================

-- 1. FUNÇÃO GENÉRICA DE TRIGGER ---------------------------------

CREATE OR REPLACE FUNCTION public.fn_audit_log()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_acao      TEXT;
  v_modulo    TEXT;
  v_descricao TEXT;
  v_old       JSONB;
  v_new       JSONB;
  v_email     TEXT;
  v_id        TEXT;
BEGIN
  -- Ação
  v_acao := CASE TG_OP
    WHEN 'INSERT' THEN 'criar'
    WHEN 'UPDATE' THEN 'editar'
    WHEN 'DELETE' THEN 'deletar'
  END;

  -- Módulo por tabela
  v_modulo := CASE TG_TABLE_NAME
    WHEN 'members'             THEN 'membros'
    WHEN 'eventos'             THEN 'eventos'
    WHEN 'evento_inscricoes'   THEN 'inscricoes'
    WHEN 'evento_checkins'     THEN 'checkin'
    WHEN 'admin_users'         THEN 'usuarios'
    WHEN 'evento_equipe'       THEN 'eventos'
    WHEN 'evento_financeiro'   THEN 'financeiro'
    WHEN 'secretaria_cgadb'    THEN 'secretaria'
    ELSE TG_TABLE_NAME
  END;

  -- Dados anterior/novo (sem campos sensíveis)
  IF TG_OP = 'DELETE' THEN
    v_old := to_jsonb(OLD) - 'password' - 'senha' - 'token' - 'cpf' - 'rg';
    v_new := NULL;
    v_email := COALESCE(
      (OLD::jsonb ->> 'email'),
      (OLD::jsonb ->> 'usuario_email')
    );
    v_id := COALESCE(
      (OLD::jsonb ->> 'id'),
      (OLD::jsonb ->> 'uuid')
    );
  ELSIF TG_OP = 'UPDATE' THEN
    v_old := to_jsonb(OLD) - 'password' - 'senha' - 'token' - 'cpf' - 'rg';
    v_new := to_jsonb(NEW) - 'password' - 'senha' - 'token' - 'cpf' - 'rg';
    v_email := COALESCE(
      (NEW::jsonb ->> 'email'),
      (NEW::jsonb ->> 'usuario_email')
    );
    v_id := COALESCE(
      (NEW::jsonb ->> 'id'),
      (NEW::jsonb ->> 'uuid')
    );
  ELSE -- INSERT
    v_old := NULL;
    v_new := to_jsonb(NEW) - 'password' - 'senha' - 'token' - 'cpf' - 'rg';
    v_email := COALESCE(
      (NEW::jsonb ->> 'email'),
      (NEW::jsonb ->> 'usuario_email')
    );
    v_id := COALESCE(
      (NEW::jsonb ->> 'id'),
      (NEW::jsonb ->> 'uuid')
    );
  END IF;

  -- Descrição amigável
  v_descricao := CASE TG_OP
    WHEN 'INSERT' THEN 'Registro criado em ' || TG_TABLE_NAME
    WHEN 'UPDATE' THEN 'Registro atualizado em ' || TG_TABLE_NAME
    WHEN 'DELETE' THEN 'Registro removido de ' || TG_TABLE_NAME
  END;

  -- Adicionar nome se disponível
  IF (COALESCE(v_new, v_old) ->> 'name') IS NOT NULL THEN
    v_descricao := v_descricao || ': ' || COALESCE(v_new ->> 'name', v_old ->> 'name');
  ELSIF (COALESCE(v_new, v_old) ->> 'nome') IS NOT NULL THEN
    v_descricao := v_descricao || ': ' || COALESCE(v_new ->> 'nome', v_old ->> 'nome');
  END IF;

  -- Inserir log
  INSERT INTO public.audit_logs (
    user_id,
    usuario_email,
    action,
    resource_type,
    resource_id,
    acao,
    modulo,
    tabela_afetada,
    descricao,
    dados_anteriores,
    dados_novos,
    old_data,
    new_data,
    status
  ) VALUES (
    auth.uid(),
    v_email,
    v_acao,
    TG_TABLE_NAME,
    v_id,
    v_acao,
    v_modulo,
    TG_TABLE_NAME,
    v_descricao,
    v_old,
    v_new,
    v_old,
    v_new,
    'sucesso'
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- 2. APLICAR TRIGGERS NAS TABELAS --------------------------------

-- members (ministros / pastores)
DROP TRIGGER IF EXISTS trg_audit_members ON public.members;
CREATE TRIGGER trg_audit_members
  AFTER INSERT OR UPDATE OR DELETE ON public.members
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_log();

-- eventos
DROP TRIGGER IF EXISTS trg_audit_eventos ON public.eventos;
CREATE TRIGGER trg_audit_eventos
  AFTER INSERT OR UPDATE OR DELETE ON public.eventos
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_log();

-- evento_inscricoes
DROP TRIGGER IF EXISTS trg_audit_evento_inscricoes ON public.evento_inscricoes;
CREATE TRIGGER trg_audit_evento_inscricoes
  AFTER INSERT OR UPDATE OR DELETE ON public.evento_inscricoes
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_log();

-- evento_checkins
DROP TRIGGER IF EXISTS trg_audit_evento_checkins ON public.evento_checkins;
CREATE TRIGGER trg_audit_evento_checkins
  AFTER INSERT OR UPDATE OR DELETE ON public.evento_checkins
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_log();

-- admin_users (gestão de usuários do sistema)
DROP TRIGGER IF EXISTS trg_audit_admin_users ON public.admin_users;
CREATE TRIGGER trg_audit_admin_users
  AFTER INSERT OR UPDATE OR DELETE ON public.admin_users
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_log();

-- evento_equipe (convites e membros de equipe)
DROP TRIGGER IF EXISTS trg_audit_evento_equipe ON public.evento_equipe;
CREATE TRIGGER trg_audit_evento_equipe
  AFTER INSERT OR UPDATE OR DELETE ON public.evento_equipe
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_log();
