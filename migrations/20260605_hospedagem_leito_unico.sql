-- ============================================================
-- HOSPEDAGEM AGO: INDICE DE UNICIDADE POR NUMERO DE LEITO
-- ============================================================

-- Garante que não haja duplicidade de leito ocupado por número (desconsiderando a posição beliche)
CREATE UNIQUE INDEX IF NOT EXISTS ux_hospedagem_leito_ocupado_numero_unico
  ON evento_hospedagem_leitos (evento_id, alojamento_id, numero)
  WHERE ocupado = true;
