-- ==============================================================================
-- SINCRONIZAÇÃO OFICIAL DOS 5 ALOJAMENTOS DA 126ª AGO (1.401 VAGAS)
-- Arquivo: scratch/sync_alojamentos_ssot_oficial.sql
-- Preserva integralmente todas as reservas, check-ins e pagamentos existentes.
-- ==============================================================================

-- 1. Alojamento Rosa: 124 vagas (42 Inf, 42 Sup, 40 Colch)
UPDATE public.evento_alojamentos
SET total_vagas = 124,
    camas_inferiores = 42,
    camas_superiores = 42,
    colchonetes = 40,
    leitos_inferiores = 42
WHERE id = 'fbb5d408-e9de-42ee-bfb5-2d4f0d33a0d8'
  AND evento_id = '4307ecd3-e74a-4855-9de7-c4e29216a190';

-- 2. Alojamento Azul: 306 vagas (129 Inf, 129 Sup, 48 Colch)
UPDATE public.evento_alojamentos
SET total_vagas = 306,
    camas_inferiores = 129,
    camas_superiores = 129,
    colchonetes = 48,
    leitos_inferiores = 129
WHERE id = 'b11eb773-384e-4e44-b605-0b9a6b861d57'
  AND evento_id = '4307ecd3-e74a-4855-9de7-c4e29216a190';

-- 3. Alojamento Prédio Novo: 276 vagas (138 Inf, 138 Sup, 0 Colch)
UPDATE public.evento_alojamentos
SET total_vagas = 276,
    camas_inferiores = 138,
    camas_superiores = 138,
    colchonetes = 0,
    leitos_inferiores = 138
WHERE id = 'bd540db2-284b-4176-915e-776cf1de8b09'
  AND evento_id = '4307ecd3-e74a-4855-9de7-c4e29216a190';

-- 4. Alojamento Prédio AAME: 155 vagas (62 Inf, 62 Sup, 31 Colch)
UPDATE public.evento_alojamentos
SET total_vagas = 155,
    camas_inferiores = 62,
    camas_superiores = 62,
    colchonetes = 31,
    leitos_inferiores = 62
WHERE id = 'c6998495-cfa5-4fea-8354-3dc32eb27759'
  AND evento_id = '4307ecd3-e74a-4855-9de7-c4e29216a190';

-- 5. Prédio Mário Covas: 540 vagas (245 Inf, 245 Sup, 50 Colch)
UPDATE public.evento_alojamentos
SET total_vagas = 540,
    camas_inferiores = 245,
    camas_superiores = 245,
    colchonetes = 50,
    leitos_inferiores = 245
WHERE id = 'c8449108-6920-4642-83dd-66792752e138'
  AND evento_id = '4307ecd3-e74a-4855-9de7-c4e29216a190';
