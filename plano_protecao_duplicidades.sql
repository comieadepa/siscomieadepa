-- ==============================================================================
-- PLANO DE PROTEÇÃO ATÔMICA E SERIALIZADA CONTRA DUPLICIDADES PAGAS / CONFIRMADAS
-- (PROSPECTIVO - GARANTIA MATEMÁTICA VIA PG_ADVISORY_XACT_LOCK)
-- ==============================================================================

-- 1. Contexto do Histórico:
-- A base possui 21 casos históricos de CPFs com mais de uma inscrição 'pago'/'isento' em eventos passados
-- e 2 casos no evento atual 126ª AGO anteriores à implementação da trava.
-- Um índice único direto ("UNIQUE(evento_id, cpf) WHERE status_pagamento IN ('pago', 'isento')")
-- FALHARIA na hora de aplicar a DDL por causa dos registros históricos.

-- 2. Garantia de Concorrência Real:
-- Em nível READ COMMITTED do PostgreSQL, duas transações simultâneas que façam SELECT antes do INSERT/UPDATE
-- não enxergam uma à outra até o COMMIT. Portanto, um SELECT count(*) isolado sofreria Race Condition.
-- SOLUÇÃO ROBUSTA: O uso de pg_advisory_xact_lock() serializa no nível da transação qualquer tentativa
-- de confirmação para o mesmo par (evento_id + CPF normalizado).
-- A segunda transação é enfileirada no lock até a primeira comitar. Ao despertar, ela relê a tabela e vê a
-- confirmação recém-comitada, sendo imediatamente barrada pelo count > 0!

CREATE OR REPLACE FUNCTION fn_check_anti_duplicidade_cpf_evento()
RETURNS TRIGGER AS $$
DECLARE
  v_cpf_norm text;
  v_lock_key bigint;
  v_count integer;
BEGIN
  -- 1. REGRA DE PRESERVAÇÃO HISTÓRICA E OPERACIONAL:
  -- Se for um UPDATE e o registro já era 'pago' ou 'isento', e o trio crítico
  -- (status_pagamento, cpf e evento_id) permanecer inalterado,
  -- dispensa a validação de unicidade e permite a edição de outros campos operacionais
  -- (ex.: leito de hospedagem, check-in, credenciamento, crachá, alimentação).
  IF (TG_OP = 'UPDATE') THEN
    IF (OLD.status_pagamento IN ('pago', 'isento') 
        AND NEW.status_pagamento = OLD.status_pagamento 
        AND regexp_replace(COALESCE(NEW.cpf, ''), '\D', '', 'g') = regexp_replace(COALESCE(OLD.cpf, ''), '\D', '', 'g')
        AND NEW.evento_id = OLD.evento_id) THEN
      RETURN NEW;
    END IF;
  END IF;

  -- 2. Apenas atua se a inscrição estiver ingressando como 'pago' ou 'isento'
  IF (NEW.status_pagamento IN ('pago', 'isento')) THEN
    v_cpf_norm := regexp_replace(COALESCE(NEW.cpf, ''), '\D', '', 'g');

    IF length(v_cpf_norm) = 11 THEN
      -- Gera chave única de 64 bits para o lock transacional baseado em (evento_id + CPF normalizado)
      v_lock_key := (('x' || substr(md5(NEW.evento_id::text || ':' || v_cpf_norm), 1, 16))::bit(64)::bigint);

      -- Adquire lock consultivo transacional. Bloqueia qualquer transação concorrente
      -- que tente confirmar o mesmo CPF neste mesmo evento até o fim da transação atual (COMMIT/ROLLBACK).
      PERFORM pg_advisory_xact_lock(v_lock_key);

      -- Após serialização garantida pelo lock, verifica se JÁ EXISTE outra confirmada
      SELECT count(*) INTO v_count
      FROM evento_inscricoes
      WHERE evento_id = NEW.evento_id
        AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
        AND regexp_replace(COALESCE(cpf, ''), '\D', '', 'g') = v_cpf_norm
        AND status_pagamento IN ('pago', 'isento');

      IF v_count > 0 THEN
        RAISE EXCEPTION 'Já existe uma inscrição confirmada para este CPF neste evento.'
          USING ERRCODE = '23505';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- O trigger roda antes do INSERT ou UPDATE em evento_inscricoes monitorando status_pagamento, cpf e evento_id
DROP TRIGGER IF EXISTS trg_anti_duplicidade_cpf_evento ON evento_inscricoes;
CREATE TRIGGER trg_anti_duplicidade_cpf_evento
  BEFORE INSERT OR UPDATE OF status_pagamento, cpf, evento_id ON evento_inscricoes
  FOR EACH ROW
  EXECUTE FUNCTION fn_check_anti_duplicidade_cpf_evento();
