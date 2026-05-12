-- ══════════════════════════════════════════════════════════════
--  Migração: Editor visual de certificados — elementos_json
--  Data: 2026-05-11
-- ══════════════════════════════════════════════════════════════

-- Adiciona coluna elementos_json para o editor visual de posicionamento
ALTER TABLE evento_certificado_config
  ADD COLUMN IF NOT EXISTS elementos_json jsonb NULL;

-- Adiciona coluna background_url como alias preferido (mantém arte_url por compat)
ALTER TABLE evento_certificado_config
  ADD COLUMN IF NOT EXISTS background_url text NULL;

-- Cria bucket de storage para artes de certificado (se não existir)
-- Executar manualmente no Supabase Dashboard se storage não estiver configurado:
-- INSERT INTO storage.buckets (id, name, public) VALUES ('cert-backgrounds', 'cert-backgrounds', true)
-- ON CONFLICT DO NOTHING;
