-- ==============================================================================
-- Migration: Compatibilidade e Resiliência de Colunas - Descontos no Balcão
-- Arquivo: supabase/migrations/20261127133000_compatibilidade_descontos_balcao.sql
-- ==============================================================================

-- 1. Assegurar colunas com nomes padronizados e aliases na tabela evento_desconto_autorizacoes
-- Esta migration é estritamente incremental e idempotente. Não remove nem altera dados.

DO $$
BEGIN
  -- operador_nome (alias/sincronizado com solicitante_nome)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'evento_desconto_autorizacoes' 
      AND column_name = 'operador_nome'
  ) THEN
    ALTER TABLE public.evento_desconto_autorizacoes 
      ADD COLUMN operador_nome text NULL;
  END IF;

  -- operador_email (alias/sincronizado com solicitante_email)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'evento_desconto_autorizacoes' 
      AND column_name = 'operador_email'
  ) THEN
    ALTER TABLE public.evento_desconto_autorizacoes 
      ADD COLUMN operador_email text NULL;
  END IF;

  -- operador_id (uuid do operador)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'evento_desconto_autorizacoes' 
      AND column_name = 'operador_id'
  ) THEN
    ALTER TABLE public.evento_desconto_autorizacoes 
      ADD COLUMN operador_id uuid NULL;
  END IF;

  -- solicitante_operador_id (garantir existência)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'evento_desconto_autorizacoes' 
      AND column_name = 'solicitante_operador_id'
  ) THEN
    ALTER TABLE public.evento_desconto_autorizacoes 
      ADD COLUMN solicitante_operador_id uuid NULL;
  END IF;

  -- solicitante_nome (garantir existência)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'evento_desconto_autorizacoes' 
      AND column_name = 'solicitante_nome'
  ) THEN
    ALTER TABLE public.evento_desconto_autorizacoes 
      ADD COLUMN solicitante_nome text NULL;
  END IF;

  -- solicitante_email (garantir existência)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'evento_desconto_autorizacoes' 
      AND column_name = 'solicitante_email'
  ) THEN
    ALTER TABLE public.evento_desconto_autorizacoes 
      ADD COLUMN solicitante_email text NULL;
  END IF;

  -- supervisor_id (alias/sincronizado com supervisor_user_id)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'evento_desconto_autorizacoes' 
      AND column_name = 'supervisor_id'
  ) THEN
    ALTER TABLE public.evento_desconto_autorizacoes 
      ADD COLUMN supervisor_id uuid NULL;
  END IF;

  -- supervisor_user_id (garantir existência)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'evento_desconto_autorizacoes' 
      AND column_name = 'supervisor_user_id'
  ) THEN
    ALTER TABLE public.evento_desconto_autorizacoes 
      ADD COLUMN supervisor_user_id uuid NULL;
  END IF;

  -- justificativa_supervisor (alias/sincronizado com motivo_deliberacao)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'evento_desconto_autorizacoes' 
      AND column_name = 'justificativa_supervisor'
  ) THEN
    ALTER TABLE public.evento_desconto_autorizacoes 
      ADD COLUMN justificativa_supervisor text NULL;
  END IF;

  -- motivo_deliberacao (garantir existência)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'evento_desconto_autorizacoes' 
      AND column_name = 'motivo_deliberacao'
  ) THEN
    ALTER TABLE public.evento_desconto_autorizacoes 
      ADD COLUMN motivo_deliberacao text NULL;
  END IF;

  -- motivo_solicitacao (garantir existência)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'evento_desconto_autorizacoes' 
      AND column_name = 'motivo_solicitacao'
  ) THEN
    ALTER TABLE public.evento_desconto_autorizacoes 
      ADD COLUMN motivo_solicitacao text NULL;
  END IF;

END $$;

-- 2. Gatilho de sincronização bidirecional transparente entre aliases
CREATE OR REPLACE FUNCTION public.fn_sync_evento_desconto_autorizacoes_aliases()
RETURNS trigger AS $$
BEGIN
  -- Sincronizar operador / solicitante
  IF NEW.operador_nome IS NOT NULL AND NEW.solicitante_nome IS NULL THEN
    NEW.solicitante_nome := NEW.operador_nome;
  ELSIF NEW.solicitante_nome IS NOT NULL AND NEW.operador_nome IS NULL THEN
    NEW.operador_nome := NEW.solicitante_nome;
  END IF;

  IF NEW.operador_email IS NOT NULL AND NEW.solicitante_email IS NULL THEN
    NEW.solicitante_email := NEW.operador_email;
  ELSIF NEW.solicitante_email IS NOT NULL AND NEW.operador_email IS NULL THEN
    NEW.operador_email := NEW.solicitante_email;
  END IF;

  IF NEW.operador_id IS NOT NULL AND NEW.solicitante_operador_id IS NULL THEN
    NEW.solicitante_operador_id := NEW.operador_id;
  ELSIF NEW.solicitante_operador_id IS NOT NULL AND NEW.operador_id IS NULL THEN
    NEW.operador_id := NEW.solicitante_operador_id;
  END IF;

  -- Sincronizar supervisor
  IF NEW.supervisor_id IS NOT NULL AND NEW.supervisor_user_id IS NULL THEN
    NEW.supervisor_user_id := NEW.supervisor_id;
  ELSIF NEW.supervisor_user_id IS NOT NULL AND NEW.supervisor_id IS NULL THEN
    NEW.supervisor_id := NEW.supervisor_user_id;
  END IF;

  -- Sincronizar justificativa / motivo
  IF NEW.justificativa_supervisor IS NOT NULL AND NEW.motivo_deliberacao IS NULL THEN
    NEW.motivo_deliberacao := NEW.justificativa_supervisor;
  ELSIF NEW.motivo_deliberacao IS NOT NULL AND NEW.justificativa_supervisor IS NULL THEN
    NEW.justificativa_supervisor := NEW.motivo_deliberacao;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_evento_desconto_aliases ON public.evento_desconto_autorizacoes;
CREATE TRIGGER trg_sync_evento_desconto_aliases
  BEFORE INSERT OR UPDATE ON public.evento_desconto_autorizacoes
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_sync_evento_desconto_autorizacoes_aliases();

-- 3. Notificar recarga de schema cache do PostgREST
NOTIFY pgrst, 'reload schema';
