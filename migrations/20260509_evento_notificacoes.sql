-- ============================================================
-- AUTOMAÇÕES DE COMUNICAÇÃO — Módulo Eventos
-- Tabela de fila + triggers automáticos
-- ============================================================

-- 1. Tabela principal da fila
CREATE TABLE IF NOT EXISTS evento_notificacoes (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  evento_id       uuid        NOT NULL REFERENCES eventos(id) ON DELETE CASCADE,
  inscricao_id    uuid        NOT NULL REFERENCES evento_inscricoes(id) ON DELETE CASCADE,
  tipo            text        NOT NULL CHECK (tipo IN ('email', 'whatsapp')),
  status          text        NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'enviado', 'erro')),
  assunto         text,
  mensagem        text        NOT NULL,
  erro            text,
  enviado_em      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),

  -- Idempotência: impede duplicata do mesmo evento/inscricao/tipo de gatilho
  gatilho         text        NOT NULL CHECK (gatilho IN ('inscricao_criada', 'pagamento_confirmado', 'checkin_realizado', 'manual')),
  UNIQUE (inscricao_id, tipo, gatilho)
);

CREATE INDEX IF NOT EXISTS idx_evt_notif_evento    ON evento_notificacoes (evento_id);
CREATE INDEX IF NOT EXISTS idx_evt_notif_inscricao ON evento_notificacoes (inscricao_id);
CREATE INDEX IF NOT EXISTS idx_evt_notif_status    ON evento_notificacoes (status);

-- RLS
ALTER TABLE evento_notificacoes ENABLE ROW LEVEL SECURITY;

-- Apenas service_role acessa (API routes server-side)
CREATE POLICY "notificacoes_service_only" ON evento_notificacoes
  USING (auth.role() = 'service_role');

-- ============================================================
-- 2. Função utilitária: monta mensagem a partir do template
--    do evento (mensagem_confirmacao) ou usa texto padrão.
-- ============================================================
CREATE OR REPLACE FUNCTION fn_build_notif_message(
  p_gatilho       text,
  p_nome          text,
  p_evento_nome   text,
  p_qr_code       text,
  p_link_grupo    text,
  p_status_pag    text,
  p_local         text,
  p_data_evento   text,
  p_template      text   -- mensagem_confirmacao do evento (pode ser null)
) RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_msg text;
BEGIN
  -- Base: usa template do evento se disponível, senão usa padrão por gatilho
  IF p_template IS NOT NULL AND p_gatilho = 'inscricao_criada' THEN
    v_msg := p_template;
  ELSIF p_gatilho = 'inscricao_criada' THEN
    v_msg := 'Olá, {NOME}! Sua inscrição no evento {EVENTO} foi realizada com sucesso. Código: {QR_CODE}. Status de pagamento: {STATUS_PAGAMENTO}.';
  ELSIF p_gatilho = 'pagamento_confirmado' THEN
    v_msg := 'Olá, {NOME}! Seu pagamento para o evento {EVENTO} foi confirmado. Código de acesso: {QR_CODE}.';
  ELSIF p_gatilho = 'checkin_realizado' THEN
    v_msg := 'Olá, {NOME}! Sua presença no evento {EVENTO} foi registrada. Bem-vindo(a)!';
  ELSE
    v_msg := 'Olá, {NOME}! Mensagem do evento {EVENTO}.';
  END IF;

  -- Substitui variáveis
  v_msg := replace(v_msg, '{NOME}',             COALESCE(p_nome,        ''));
  v_msg := replace(v_msg, '{EVENTO}',           COALESCE(p_evento_nome, ''));
  v_msg := replace(v_msg, '{QR_CODE}',          COALESCE(p_qr_code,     ''));
  v_msg := replace(v_msg, '{LINK_GRUPO}',       COALESCE(p_link_grupo,  ''));
  v_msg := replace(v_msg, '{STATUS_PAGAMENTO}', COALESCE(p_status_pag,  ''));
  v_msg := replace(v_msg, '{LOCAL}',            COALESCE(p_local,       ''));
  v_msg := replace(v_msg, '{DATA_EVENTO}',      COALESCE(p_data_evento, ''));

  RETURN v_msg;
END;
$$;

-- ============================================================
-- 3. Função de trigger: INSCRIÇÃO CRIADA
-- ============================================================
CREATE OR REPLACE FUNCTION fn_trigger_notif_inscricao_criada()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_evento   eventos%ROWTYPE;
  v_msg      text;
BEGIN
  -- Carrega dados do evento
  SELECT * INTO v_evento FROM eventos WHERE id = NEW.evento_id;

  -- Monta mensagem
  v_msg := fn_build_notif_message(
    'inscricao_criada',
    NEW.nome_inscrito,
    v_evento.nome,
    COALESCE(NEW.qr_code, ''),
    COALESCE(v_evento.link_whatsapp, ''),
    COALESCE(NEW.status_pagamento, 'pendente'),
    COALESCE(v_evento.local, ''),
    COALESCE(v_evento.data_inicio::text, ''),
    v_evento.mensagem_confirmacao
  );

  -- Insere na fila (email)
  INSERT INTO evento_notificacoes
    (evento_id, inscricao_id, tipo, gatilho, assunto, mensagem)
  VALUES
    (NEW.evento_id, NEW.id, 'email', 'inscricao_criada',
     'Confirmação de Inscrição — ' || v_evento.nome,
     v_msg)
  ON CONFLICT (inscricao_id, tipo, gatilho) DO NOTHING;

  -- Insere na fila (whatsapp) — apenas se tiver número
  IF NEW.whatsapp IS NOT NULL THEN
    INSERT INTO evento_notificacoes
      (evento_id, inscricao_id, tipo, gatilho, assunto, mensagem)
    VALUES
      (NEW.evento_id, NEW.id, 'whatsapp', 'inscricao_criada',
       'Confirmação de Inscrição',
       v_msg)
    ON CONFLICT (inscricao_id, tipo, gatilho) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

-- ============================================================
-- 4. Função de trigger: PAGAMENTO CONFIRMADO
-- ============================================================
CREATE OR REPLACE FUNCTION fn_trigger_notif_pagamento_confirmado()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_evento   eventos%ROWTYPE;
  v_msg      text;
BEGIN
  -- Dispara somente quando status_pagamento muda para 'pago'
  IF (TG_OP = 'UPDATE') AND
     (OLD.status_pagamento IS DISTINCT FROM 'pago') AND
     (NEW.status_pagamento = 'pago') THEN

    SELECT * INTO v_evento FROM eventos WHERE id = NEW.evento_id;

    v_msg := fn_build_notif_message(
      'pagamento_confirmado',
      NEW.nome_inscrito,
      v_evento.nome,
      COALESCE(NEW.qr_code, ''),
      COALESCE(v_evento.link_whatsapp, ''),
      'Pago',
      COALESCE(v_evento.local, ''),
      COALESCE(v_evento.data_inicio::text, ''),
      NULL  -- usa texto padrão para pagamento
    );

    INSERT INTO evento_notificacoes
      (evento_id, inscricao_id, tipo, gatilho, assunto, mensagem)
    VALUES
      (NEW.evento_id, NEW.id, 'email', 'pagamento_confirmado',
       'Pagamento Confirmado — ' || v_evento.nome,
       v_msg)
    ON CONFLICT (inscricao_id, tipo, gatilho) DO NOTHING;

    IF NEW.whatsapp IS NOT NULL THEN
      INSERT INTO evento_notificacoes
        (evento_id, inscricao_id, tipo, gatilho, assunto, mensagem)
      VALUES
        (NEW.evento_id, NEW.id, 'whatsapp', 'pagamento_confirmado',
         'Pagamento Confirmado',
         v_msg)
      ON CONFLICT (inscricao_id, tipo, gatilho) DO NOTHING;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- ============================================================
-- 5. Função de trigger: CHECK-IN REALIZADO
-- ============================================================
CREATE OR REPLACE FUNCTION fn_trigger_notif_checkin_realizado()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_evento   eventos%ROWTYPE;
  v_msg      text;
BEGIN
  -- Dispara somente quando checkin_realizado muda para true
  IF (TG_OP = 'UPDATE') AND
     (OLD.checkin_realizado IS DISTINCT FROM TRUE) AND
     (NEW.checkin_realizado = TRUE) THEN

    SELECT * INTO v_evento FROM eventos WHERE id = NEW.evento_id;

    v_msg := fn_build_notif_message(
      'checkin_realizado',
      NEW.nome_inscrito,
      v_evento.nome,
      COALESCE(NEW.qr_code, ''),
      COALESCE(v_evento.link_whatsapp, ''),
      COALESCE(NEW.status_pagamento, ''),
      COALESCE(v_evento.local, ''),
      COALESCE(v_evento.data_inicio::text, ''),
      NULL
    );

    IF NEW.whatsapp IS NOT NULL THEN
      INSERT INTO evento_notificacoes
        (evento_id, inscricao_id, tipo, gatilho, assunto, mensagem)
      VALUES
        (NEW.evento_id, NEW.id, 'whatsapp', 'checkin_realizado',
         'Presença Confirmada',
         v_msg)
      ON CONFLICT (inscricao_id, tipo, gatilho) DO NOTHING;
    END IF;

    -- email apenas se estiver pago (não spam)
    IF NEW.status_pagamento = 'pago' OR NEW.status_pagamento = 'isento' THEN
      INSERT INTO evento_notificacoes
        (evento_id, inscricao_id, tipo, gatilho, assunto, mensagem)
      VALUES
        (NEW.evento_id, NEW.id, 'email', 'checkin_realizado',
         'Presença Confirmada — ' || v_evento.nome,
         v_msg)
      ON CONFLICT (inscricao_id, tipo, gatilho) DO NOTHING;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- ============================================================
-- 6. Attach triggers
-- ============================================================
DROP TRIGGER IF EXISTS trg_notif_inscricao_criada      ON evento_inscricoes;
DROP TRIGGER IF EXISTS trg_notif_pagamento_confirmado  ON evento_inscricoes;
DROP TRIGGER IF EXISTS trg_notif_checkin_realizado     ON evento_inscricoes;

CREATE TRIGGER trg_notif_inscricao_criada
  AFTER INSERT ON evento_inscricoes
  FOR EACH ROW EXECUTE FUNCTION fn_trigger_notif_inscricao_criada();

CREATE TRIGGER trg_notif_pagamento_confirmado
  AFTER UPDATE OF status_pagamento ON evento_inscricoes
  FOR EACH ROW EXECUTE FUNCTION fn_trigger_notif_pagamento_confirmado();

CREATE TRIGGER trg_notif_checkin_realizado
  AFTER UPDATE OF checkin_realizado ON evento_inscricoes
  FOR EACH ROW EXECUTE FUNCTION fn_trigger_notif_checkin_realizado();
