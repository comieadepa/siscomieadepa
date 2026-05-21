-- Limpeza: Migrar inscrições com tipo 'Campo Missionário' para 'Pastor Presidente'
-- Esta categoria era incorreta — Campo Missionário é característica do campo, não do inscrito.

UPDATE public.evento_inscricoes
SET tipo_inscricao = 'PASTOR PRESIDENTE'
WHERE UPPER(tipo_inscricao) LIKE '%CAMPO MISSION%';

-- Remover tipos de inscrição 'Campo Missionário' da tabela evento_tipos_inscricao
DELETE FROM public.evento_tipos_inscricao
WHERE UPPER(TRIM(nome)) LIKE '%CAMPO MISSION%';
