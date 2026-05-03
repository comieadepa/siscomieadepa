-- Adiciona campo jubilado (boolean) na tabela members
ALTER TABLE public.members ADD COLUMN IF NOT EXISTS jubilado BOOLEAN DEFAULT FALSE;
COMMENT ON COLUMN public.members.jubilado IS 'Pastor jubilado (continua ATIVO mas com status especial)';

-- Expande o campo status para aceitar os novos valores
-- O tipo atual é text; garante que os valores esperados sejam documentados
COMMENT ON COLUMN public.members.status IS 'Status do membro: active, inactive, desligado, em_processo, falecido';
