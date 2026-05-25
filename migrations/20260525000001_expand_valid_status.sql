-- Expande a constraint valid_status em members para incluir todos os valores usados pela aplicação
-- Causa: 'desligado', 'jubilado', 'em_processo', 'falecido' eram rejeitados pelo banco

ALTER TABLE public.members DROP CONSTRAINT IF EXISTS valid_status;

ALTER TABLE public.members ADD CONSTRAINT valid_status CHECK (
  status IN (
    'active',       -- legado: ativo
    'inactive',     -- legado: inativo
    'deceased',     -- legado: falecido
    'transferred',  -- legado: transferido
    'desligado',
    'jubilado',
    'em_processo',
    'falecido'
  )
);
