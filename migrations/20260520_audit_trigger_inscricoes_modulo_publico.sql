-- Corrige módulo do trigger de auditoria para evento_inscricoes
-- Inscrições de eventos vêm da página pública, portanto devem aparecer
-- como módulo 'publico' na auditoria, não 'inscricoes'.

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
    WHEN 'evento_inscricoes'   THEN 'publico'
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
    -- Para tabelas onde 'email' pertence ao registro (não ao editor), usar só usuario_email
    v_email := CASE
      WHEN TG_TABLE_NAME IN ('members') THEN (to_jsonb(OLD) ->> 'usuario_email')
      ELSE COALESCE((to_jsonb(OLD) ->> 'email'), (to_jsonb(OLD) ->> 'usuario_email'))
    END;
    v_id := COALESCE(
      (to_jsonb(OLD) ->> 'id'),
      (to_jsonb(OLD) ->> 'uuid')
    );
  ELSIF TG_OP = 'UPDATE' THEN
    v_old := to_jsonb(OLD) - 'password' - 'senha' - 'token' - 'cpf' - 'rg';
    v_new := to_jsonb(NEW) - 'password' - 'senha' - 'token' - 'cpf' - 'rg';
    v_email := CASE
      WHEN TG_TABLE_NAME IN ('members') THEN (to_jsonb(NEW) ->> 'usuario_email')
      ELSE COALESCE((to_jsonb(NEW) ->> 'email'), (to_jsonb(NEW) ->> 'usuario_email'))
    END;
    v_id := COALESCE(
      (to_jsonb(NEW) ->> 'id'),
      (to_jsonb(NEW) ->> 'uuid')
    );
  ELSE -- INSERT
    v_old := NULL;
    v_new := to_jsonb(NEW) - 'password' - 'senha' - 'token' - 'cpf' - 'rg';
    v_email := CASE
      WHEN TG_TABLE_NAME IN ('members') THEN (to_jsonb(NEW) ->> 'usuario_email')
      ELSE COALESCE((to_jsonb(NEW) ->> 'email'), (to_jsonb(NEW) ->> 'usuario_email'))
    END;
    v_id := COALESCE(
      (to_jsonb(NEW) ->> 'id'),
      (to_jsonb(NEW) ->> 'uuid')
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
    CASE WHEN v_id IS NOT NULL THEN v_id::uuid ELSE NULL END,
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
