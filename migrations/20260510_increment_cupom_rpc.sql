-- ============================================================
-- Função: increment_cupom_usados
-- Incrementa atomicamente o contador de usos de cupom
-- ============================================================
CREATE OR REPLACE FUNCTION increment_cupom_usados(
  p_evento_id uuid,
  p_codigo    text,
  p_qtd       integer DEFAULT 1
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  UPDATE evento_cupons
  SET usados = usados + p_qtd
  WHERE evento_id = p_evento_id
    AND codigo    = p_codigo;
$$;
