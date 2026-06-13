-- Add financial tracking fields for manual billing to conec_credenciamentos
ALTER TABLE public.conec_credenciamentos
ADD COLUMN IF NOT EXISTS data_pagamento timestamptz,
ADD COLUMN IF NOT EXISTS forma_pagamento text,
ADD COLUMN IF NOT EXISTS comprovante_url text,
ADD COLUMN IF NOT EXISTS observacoes_financeiras text;
