-- Drop the existing check constraint on status_pagamento
ALTER TABLE public.evento_inscricoes
DROP CONSTRAINT IF EXISTS evento_inscricoes_status_pagamento_check;

-- Add the updated check constraint allowing 'pendente_complemento'
ALTER TABLE public.evento_inscricoes
ADD CONSTRAINT evento_inscricoes_status_pagamento_check
CHECK (status_pagamento IN ('pendente', 'pago', 'cancelado', 'isento', 'pendente_complemento'));
