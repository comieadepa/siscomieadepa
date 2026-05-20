-- Suporte ao formato especial AGO (Assembleia Geral Ordinária)
-- Adiciona campos de cortesia e limite por categoria + configurações AGO no evento

-- 1. Tipos de inscrição: campos AGO
ALTER TABLE evento_tipos_inscricao
  ADD COLUMN IF NOT EXISTS cortesia boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS limite_vagas integer NULL;

-- 2. Eventos: configurações específicas da AGO (hospedagem, grupos, regras)
ALTER TABLE eventos
  ADD COLUMN IF NOT EXISTS configuracoes_ago jsonb DEFAULT NULL;

-- 3. Comentários
COMMENT ON COLUMN evento_tipos_inscricao.cortesia
  IS 'Se true, categoria tem inscrição gratuita (Jubilado, Viúva, etc.)';
COMMENT ON COLUMN evento_tipos_inscricao.limite_vagas
  IS 'Limite de vagas para esta categoria. NULL = ilimitado.';
COMMENT ON COLUMN eventos.configuracoes_ago
  IS 'Configurações especiais para eventos AGO: hospedagem, grupos, regras de preferência de leito.';
