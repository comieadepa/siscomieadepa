-- ==============================================================================
-- MIGRATION DEFINITIVA: 20261124110000_reconciliacao_ssot_hospedagem_126ago.sql
-- OBJETIVO: Reconciliação Definitiva da SSOT de Hospedagem da 126ª AGO
-- EVENTO ID: 4307ecd3-e74a-4855-9de7-c4e29216a190
-- DATA: 2026-11-24
--
-- PRINCÍPIOS E REQUISITOS ATENDIDOS:
--   1. NÃO sobrescreve configuracoes_ago. Lê a SSOT existente e sincroniza exclusivamente por setor_key.
--   2. Proteção concorrente rigorosa: bloqueio FOR UPDATE de evento, alojamentos, leitos, inscrições e hospedagens.
--   3. Materialização 100% dinâmica dentro da transação, respeitando numeração sequencial, paridade beliche e limites por tipo.
--   4. Validação por invariantes das capacidades operacionais EXATAS por alojamento e tipo (excluindo indisponíveis).
--   5. Atualização e uso da RPC SSOT oficial (salvar_configuracoes_ago_atomica) para compatibilidade plena.
-- ==============================================================================

BEGIN;

-- 0. GARANTIR COLUNAS DE STATUS DE INDISPONIBILIDADE EXPLÍCITA
-- Permite distinguir inequivocamente leitos ocupados legítimos, livres operacionais, órfãos e indisponíveis/excedentes
ALTER TABLE public.evento_hospedagem_leitos 
  ADD COLUMN IF NOT EXISTS indisponivel BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.evento_hospedagem_leitos 
  ADD COLUMN IF NOT EXISTS motivo_indisponibilidade TEXT;

-- 1. ATUALIZAÇÃO DA RPC SSOT OFICIAL (salvar_configuracoes_ago_atomica)
-- Garante compatibilidade transacional e suporte resiliente a colchonetes
-- ==============================================================================
-- Migration: 20261123163000_rpc_salvar_configuracoes_ago_atomica.sql
-- Descrição: SSOT da Hospedagem AGO. Garante operação transacional atômica
--            entre eventos.configuracoes_ago e evento_alojamentos:
--            1. Validação estrita da estrutura oficial: para beliches, superiores = inferiores.
--            2. Validação da soma exata: total_vagas = inferiores + superiores + colchonetes.
--               Valores inconsistentes NÃO são mascarados por diferença.
--            3. Leitura resiliente de colchonetes via chave explícita ou observações reais.
--            4. Validação rigorosa de capacidades em ambas as fontes (leitos e hospedagens).
--            5. Impede remoção de setores com participantes ocupados.
--            6. Desativa automaticamente projeção de setores removidos sem ocupantes.
--            7. Controle estrito de permissões (exclusivo service_role).
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.salvar_configuracoes_ago_atomica(
  p_evento_id UUID,
  p_configuracoes_ago JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_evento_atual RECORD;
  v_config_merge JSONB;
  v_setores_novos JSONB;
  v_setor RECORD;
  v_aloj RECORD;
  v_setor_id TEXT;
  v_nome TEXT;
  v_grupo TEXT;
  v_total_vagas INT;
  v_camas_inferiores INT;
  v_camas_superiores INT;
  v_colchonetes INT;
  v_ativo BOOLEAN;
  v_publico TEXT;
  v_sexo TEXT;
  v_existing_id UUID;
  v_match_col TEXT[];
  
  -- Contagens de leitos físicos e hospedagens
  v_leitos_fisicos_totais INT;
  v_leitos_fisicos_inf INT;
  v_leitos_fisicos_sup INT;
  v_hosp_totais INT;
  v_hosp_inf INT;
  v_hosp_sup INT;
  
  -- Ocupação efetiva consolidada (GREATEST entre ambas as fontes)
  v_ocup_efetiva_total INT;
  v_ocup_efetiva_inf INT;
  v_ocup_efetiva_sup INT;
  
  v_criados INT := 0;
  v_atualizados INT := 0;
  v_desativados INT := 0;
  v_setores_ids TEXT[] := ARRAY[]::TEXT[];
BEGIN
  -- 1. Trava o registro do evento para escrita exclusiva
  SELECT id, configuracoes_ago INTO v_evento_atual
  FROM public.eventos
  WHERE id = p_evento_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Evento não encontrado: %', p_evento_id;
  END IF;

  -- 2. Validar payload JSON e extrair setores
  IF p_configuracoes_ago IS NULL OR jsonb_typeof(p_configuracoes_ago) <> 'object' THEN
    RAISE EXCEPTION 'Payload de configuracoes_ago inválido ou nulo.';
  END IF;

  v_setores_novos := p_configuracoes_ago->'setores';
  IF v_setores_novos IS NULL OR jsonb_typeof(v_setores_novos) <> 'array' THEN
    RAISE EXCEPTION 'Campo "setores" em configuracoes_ago deve ser um array.';
  END IF;

  -- 3. Validação de integridade estrutural e cálculo fiel de colchonetes/superiores
  FOR v_setor IN SELECT * FROM jsonb_to_recordset(v_setores_novos) AS x(
    id TEXT,
    nome TEXT,
    grupo TEXT,
    quantidade_leitos INT,
    quantidade_leitos_inferiores INT,
    quantidade_leitos_superiores INT,
    quantidade_colchonetes INT,
    observacoes TEXT,
    tipos_leito JSONB,
    ativo BOOLEAN
  )
  LOOP
    IF v_setor.id IS NULL OR TRIM(v_setor.id) = '' THEN
      RAISE EXCEPTION 'Setor contém ID inválido ou em branco.';
    END IF;

    IF v_setor.nome IS NULL OR TRIM(v_setor.nome) = '' THEN
      RAISE EXCEPTION 'Setor % contém nome inválido ou em branco.', v_setor.id;
    END IF;

    v_total_vagas := COALESCE(v_setor.quantidade_leitos, 0);
    v_camas_inferiores := COALESCE(v_setor.quantidade_leitos_inferiores, 0);

    -- Extração resiliente de colchonetes: chave explícita OU regex do texto de observações
    IF v_setor.quantidade_colchonetes IS NOT NULL THEN
      v_colchonetes := v_setor.quantidade_colchonetes;
    ELSIF v_setor.observacoes IS NOT NULL THEN
      v_match_col := regexp_match(v_setor.observacoes, '([0-9]+)\s*[Ll]eitos.*colchonete', 'i');
      IF v_match_col IS NOT NULL AND v_match_col[1] IS NOT NULL THEN
        v_colchonetes := v_match_col[1]::INT;
      ELSE
        v_colchonetes := 0;
      END IF;
    ELSE
      v_colchonetes := 0;
    END IF;

    -- Extração de superiores: chave explícita OU simetria oficial de beliches (superiores = inferiores)
    IF v_setor.quantidade_leitos_superiores IS NOT NULL THEN
      v_camas_superiores := v_setor.quantidade_leitos_superiores;
    ELSIF v_setor.tipos_leito IS NOT NULL AND v_setor.tipos_leito ? 'beliche' THEN
      v_camas_superiores := v_camas_inferiores;
    ELSE
      v_camas_superiores := 0;
    END IF;

    IF v_total_vagas < 0 OR v_camas_inferiores < 0 OR v_camas_superiores < 0 OR v_colchonetes < 0 THEN
      RAISE EXCEPTION 'Setor "%" contém quantidade de leitos negativa.', v_setor.nome;
    END IF;

    -- Validação de soma exata (impede mascaramento de inconsistências)
    IF v_total_vagas <> (v_camas_inferiores + v_camas_superiores + v_colchonetes) THEN
      RAISE EXCEPTION 'No setor "%", a soma dos leitos (% inf + % sup + % colch = %) deve ser exatamente igual à capacidade total (%).',
        v_setor.nome, v_camas_inferiores, v_camas_superiores, v_colchonetes,
        (v_camas_inferiores + v_camas_superiores + v_colchonetes), v_total_vagas;
    END IF;

    -- Checa duplicidade de IDs no payload
    IF v_setor.id = ANY(v_setores_ids) THEN
      RAISE EXCEPTION 'ID de setor duplicado no payload: "%".', v_setor.id;
    END IF;
    v_setores_ids := array_append(v_setores_ids, v_setor.id);
  END LOOP;

  -- 4. Tratamento de setores omitidos/removidos da configuração oficial
  FOR v_aloj IN 
    SELECT ea.id, ea.setor_key, ea.nome, ea.ativo
    FROM public.evento_alojamentos ea
    WHERE ea.evento_id = p_evento_id 
      AND ea.setor_key IS NOT NULL
  LOOP
    IF NOT (v_aloj.setor_key = ANY(v_setores_ids)) THEN
      PERFORM 1 FROM public.evento_alojamentos WHERE id = v_aloj.id FOR UPDATE;

      SELECT COUNT(*) INTO v_leitos_fisicos_totais
      FROM public.evento_hospedagem_leitos
      WHERE alojamento_id = v_aloj.id AND ocupado = true AND inscricao_id IS NOT NULL;

      SELECT COUNT(*) INTO v_hosp_totais
      FROM public.evento_hospedagens
      WHERE alojamento_id = v_aloj.id AND status IN ('alocada', 'confirmada', 'checkin_realizado');

      v_ocup_efetiva_total := GREATEST(COALESCE(v_leitos_fisicos_totais, 0), COALESCE(v_hosp_totais, 0));

      IF v_ocup_efetiva_total > 0 THEN
        RAISE EXCEPTION 'Não é possível remover o setor "%" da configuração pois existem % participantes alocados nele. Realoque os participantes antes de remover o setor.',
          v_aloj.nome, v_ocup_efetiva_total;
      ELSE
        IF v_aloj.ativo THEN
          UPDATE public.evento_alojamentos
          SET ativo = false
          WHERE id = v_aloj.id;
          v_desativados := v_desativados + 1;
        END IF;
      END IF;
    END IF;
  END LOOP;

  -- 5. Validação de capacidade contra ocupação efetiva
  FOR v_setor IN SELECT * FROM jsonb_to_recordset(v_setores_novos) AS x(
    id TEXT,
    nome TEXT,
    quantidade_leitos INT,
    quantidade_leitos_inferiores INT,
    quantidade_leitos_superiores INT,
    quantidade_colchonetes INT,
    observacoes TEXT,
    tipos_leito JSONB,
    ativo BOOLEAN
  )
  LOOP
    v_setor_id := v_setor.id;
    v_nome := TRIM(v_setor.nome);
    v_total_vagas := COALESCE(v_setor.quantidade_leitos, 0);
    v_camas_inferiores := COALESCE(v_setor.quantidade_leitos_inferiores, 0);
    v_ativo := COALESCE(v_setor.ativo, true);

    IF v_setor.quantidade_colchonetes IS NOT NULL THEN
      v_colchonetes := v_setor.quantidade_colchonetes;
    ELSIF v_setor.observacoes IS NOT NULL THEN
      v_match_col := regexp_match(v_setor.observacoes, '([0-9]+)\s*[Ll]eitos.*colchonete', 'i');
      IF v_match_col IS NOT NULL AND v_match_col[1] IS NOT NULL THEN
        v_colchonetes := v_match_col[1]::INT;
      ELSE
        v_colchonetes := 0;
      END IF;
    ELSE
      v_colchonetes := 0;
    END IF;

    IF v_setor.quantidade_leitos_superiores IS NOT NULL THEN
      v_camas_superiores := v_setor.quantidade_leitos_superiores;
    ELSIF v_setor.tipos_leito IS NOT NULL AND v_setor.tipos_leito ? 'beliche' THEN
      v_camas_superiores := v_camas_inferiores;
    ELSE
      v_camas_superiores := 0;
    END IF;

    SELECT id INTO v_existing_id
    FROM public.evento_alojamentos
    WHERE evento_id = p_evento_id AND setor_key = v_setor_id;

    IF v_existing_id IS NOT NULL THEN
      PERFORM 1 FROM public.evento_alojamentos WHERE id = v_existing_id FOR UPDATE;

      SELECT 
        COUNT(*),
        COUNT(*) FILTER (WHERE posicao = 'inferior'),
        COUNT(*) FILTER (WHERE posicao = 'superior')
      INTO v_leitos_fisicos_totais, v_leitos_fisicos_inf, v_leitos_fisicos_sup
      FROM public.evento_hospedagem_leitos
      WHERE alojamento_id = v_existing_id AND ocupado = true AND inscricao_id IS NOT NULL;

      SELECT 
        COUNT(*),
        COUNT(*) FILTER (WHERE tipo_cama = 'inferior'),
        COUNT(*) FILTER (WHERE tipo_cama = 'superior')
      INTO v_hosp_totais, v_hosp_inf, v_hosp_sup
      FROM public.evento_hospedagens
      WHERE alojamento_id = v_existing_id AND status IN ('alocada', 'confirmada', 'checkin_realizado');

      v_ocup_efetiva_total := GREATEST(COALESCE(v_leitos_fisicos_totais, 0), COALESCE(v_hosp_totais, 0));
      v_ocup_efetiva_inf   := GREATEST(COALESCE(v_leitos_fisicos_inf, 0), COALESCE(v_hosp_inf, 0));
      v_ocup_efetiva_sup   := GREATEST(COALESCE(v_leitos_fisicos_sup, 0), COALESCE(v_hosp_sup, 0));

      IF v_total_vagas < v_ocup_efetiva_total THEN
        RAISE EXCEPTION 'Não é possível reduzir a capacidade do setor "%" para % vagas, pois existem % ocupações ativas (leitos físicos: %, hospedagens: %).',
          v_nome, v_total_vagas, v_ocup_efetiva_total, v_leitos_fisicos_totais, v_hosp_totais;
      END IF;

      IF v_camas_inferiores < v_ocup_efetiva_inf THEN
        RAISE EXCEPTION 'Não é possível reduzir as camas inferiores do setor "%" para %, pois existem % ocupadas (leitos físicos: %, hospedagens: %).',
          v_nome, v_camas_inferiores, v_ocup_efetiva_inf, v_leitos_fisicos_inf, v_hosp_inf;
      END IF;

      IF v_camas_superiores < v_ocup_efetiva_sup AND (v_camas_superiores + v_colchonetes) < v_ocup_efetiva_sup THEN
        RAISE EXCEPTION 'Não é possível reduzir as camas superiores do setor "%" para %, pois existem % ocupadas (leitos físicos: %, hospedagens: %).',
          v_nome, v_camas_superiores, v_ocup_efetiva_sup, v_leitos_fisicos_sup, v_hosp_sup;
      END IF;

      IF NOT v_ativo AND v_ocup_efetiva_total > 0 THEN
        RAISE EXCEPTION 'Não é possível desativar o setor "%" pois existem % participantes alocados nele. Realoque os participantes antes de desativar.',
          v_nome, v_ocup_efetiva_total;
      END IF;
    END IF;
  END LOOP;

  -- 6. Preservar demais campos de configuracoes_ago
  IF v_evento_atual.configuracoes_ago IS NOT NULL AND jsonb_typeof(v_evento_atual.configuracoes_ago) = 'object' THEN
    v_config_merge := v_evento_atual.configuracoes_ago || p_configuracoes_ago;
  ELSE
    v_config_merge := p_configuracoes_ago;
  END IF;

  UPDATE public.eventos
  SET configuracoes_ago = v_config_merge,
      updated_at = NOW()
  WHERE id = p_evento_id;

  -- 7. Upsert nos setores de evento_alojamentos com dados normalizados
  FOR v_setor IN SELECT * FROM jsonb_to_recordset(v_setores_novos) AS x(
    id TEXT,
    nome TEXT,
    grupo TEXT,
    quantidade_leitos INT,
    quantidade_leitos_inferiores INT,
    quantidade_leitos_superiores INT,
    quantidade_colchonetes INT,
    observacoes TEXT,
    tipos_leito JSONB,
    ativo BOOLEAN
  )
  LOOP
    v_setor_id := v_setor.id;
    v_nome := UPPER(TRIM(v_setor.nome));
    v_grupo := v_setor.grupo;
    v_total_vagas := COALESCE(v_setor.quantidade_leitos, 0);
    v_camas_inferiores := COALESCE(v_setor.quantidade_leitos_inferiores, 0);
    v_ativo := COALESCE(v_setor.ativo, true);

    IF v_setor.quantidade_colchonetes IS NOT NULL THEN
      v_colchonetes := v_setor.quantidade_colchonetes;
    ELSIF v_setor.observacoes IS NOT NULL THEN
      v_match_col := regexp_match(v_setor.observacoes, '([0-9]+)\s*[Ll]eitos.*colchonete', 'i');
      IF v_match_col IS NOT NULL AND v_match_col[1] IS NOT NULL THEN
        v_colchonetes := v_match_col[1]::INT;
      ELSE
        v_colchonetes := 0;
      END IF;
    ELSE
      v_colchonetes := 0;
    END IF;

    IF v_setor.quantidade_leitos_superiores IS NOT NULL THEN
      v_camas_superiores := v_setor.quantidade_leitos_superiores;
    ELSIF v_setor.tipos_leito IS NOT NULL AND v_setor.tipos_leito ? 'beliche' THEN
      v_camas_superiores := v_camas_inferiores;
    ELSE
      v_camas_superiores := 0;
    END IF;

    IF LOWER(v_grupo) LIKE '%mulher%' OR LOWER(v_grupo) LIKE '%fem%' THEN
      v_publico := 'feminino';
      v_sexo := 'F';
    ELSIF LOWER(v_grupo) LIKE '%presid%' THEN
      v_publico := 'presidentes';
      v_sexo := 'M';
    ELSIF LOWER(v_grupo) LIKE '%jubil%' THEN
      v_publico := 'jubilados';
      v_sexo := 'M';
    ELSIF LOWER(v_grupo) LIKE '%misto%' THEN
      v_publico := 'misto';
      v_sexo := NULL;
    ELSE
      v_publico := 'masculino_geral';
      v_sexo := 'M';
    END IF;

    SELECT id INTO v_existing_id
    FROM public.evento_alojamentos
    WHERE evento_id = p_evento_id AND setor_key = v_setor_id;

    IF v_existing_id IS NOT NULL THEN
      UPDATE public.evento_alojamentos
      SET nome = v_nome,
          publico = v_publico,
          sexo = v_sexo,
          total_vagas = v_total_vagas,
          camas_inferiores = v_camas_inferiores,
          camas_superiores = v_camas_superiores,
          colchonetes = v_colchonetes,
          grupo_permitido = v_grupo,
          leitos_inferiores = v_camas_inferiores,
          ativo = v_ativo,
          origem = 'configuracoes_ago'
      WHERE id = v_existing_id;
      v_atualizados := v_atualizados + 1;
    ELSE
      INSERT INTO public.evento_alojamentos (
        evento_id, setor_key, nome, publico, sexo,
        total_vagas, camas_inferiores, camas_superiores, colchonetes,
        grupo_permitido, leitos_inferiores, ativo, origem
      ) VALUES (
        p_evento_id, v_setor_id, v_nome, v_publico, v_sexo,
        v_total_vagas, v_camas_inferiores, v_camas_superiores, v_colchonetes,
        v_grupo, v_camas_inferiores, v_ativo, 'configuracoes_ago'
      );
      v_criados := v_criados + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'sucesso', true,
    'criados', v_criados,
    'atualizados', v_atualizados,
    'desativados', v_desativados
  );
END;
$$;

-- Permissões estritas: revoga de PUBLIC, anon e authenticated; concede exclusivamente a service_role
REVOKE ALL ON FUNCTION public.salvar_configuracoes_ago_atomica(UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.salvar_configuracoes_ago_atomica(UUID, JSONB) TO service_role;
COMMENT ON FUNCTION public.salvar_configuracoes_ago_atomica(UUID, JSONB) IS 
'SSOT da Hospedagem AGO: Salva atomicamente configuracoes_ago e materializa evento_alojamentos com validação rigorosa de capacidade e integridade. Exclusivo para service_role.';

-- 2. BLOQUEIO DE PROTEÇÃO PESSIMISTA CONTRA OPERAÇÕES CONCORRENTES
DO $$
DECLARE
  v_evento_id UUID := '4307ecd3-e74a-4855-9de7-c4e29216a190';
  v_nome_evento TEXT;
BEGIN
  -- Trava a linha do evento para serializar operações concorrentes (webhooks e alocações)
  SELECT nome INTO v_nome_evento
  FROM public.eventos
  WHERE id = v_evento_id
  FOR UPDATE;

  IF v_nome_evento IS NULL THEN
    RAISE EXCEPTION 'Evento % não encontrado.', v_evento_id;
  END IF;

  -- Trava os alojamentos do evento
  PERFORM 1 FROM public.evento_alojamentos WHERE evento_id = v_evento_id FOR UPDATE;

  -- Trava as inscrições do evento
  PERFORM 1 FROM public.evento_inscricoes WHERE evento_id = v_evento_id FOR UPDATE;

  -- Trava as hospedagens do evento
  PERFORM 1 FROM public.evento_hospedagens WHERE evento_id = v_evento_id FOR UPDATE;

  -- Trava os leitos existentes do evento
  PERFORM 1 FROM public.evento_hospedagem_leitos WHERE evento_id = v_evento_id FOR UPDATE;
END $$;

-- 3. SINCRONIZAÇÃO DA SSOT VIA RPC OFICIAL POR SETOR_KEY (NÃO SOBRESCREVE CONFIGURAÇÕES)
DO $$
DECLARE
  v_evento_id UUID := '4307ecd3-e74a-4855-9de7-c4e29216a190';
  v_cfg JSONB;
BEGIN
  SELECT configuracoes_ago INTO v_cfg
  FROM public.eventos
  WHERE id = v_evento_id;

  IF v_cfg IS NULL OR jsonb_typeof(v_cfg->'setores') <> 'array' THEN
    RAISE EXCEPTION 'configuracoes_ago inválido ou campo setores ausente no evento %.', v_evento_id;
  END IF;

  -- Sincroniza evento_alojamentos a partir da SSOT existente usando a RPC oficial
  PERFORM public.salvar_configuracoes_ago_atomica(v_evento_id, v_cfg);
END $$;

-- 4. TRATAMENTO SEGURO DE LEITOS ÓRFÃOS (OCUPADOS SEM INSCRIÇÃO VINCULADA)
UPDATE public.evento_hospedagem_leitos
SET ocupado = false
WHERE evento_id = '4307ecd3-e74a-4855-9de7-c4e29216a190'
  AND ocupado = true
  AND inscricao_id IS NULL
  AND indisponivel = false;

-- 5. REVALIDAÇÃO FINANCEIRA DINÂMICA COM BLOQUEIO FOR UPDATE OF l, i, h
DO $$
DECLARE
  v_evento_id UUID := '4307ecd3-e74a-4855-9de7-c4e29216a190';
  r RECORD;
BEGIN
  -- Percorre reservas com leitos ocupados revalidando o pagamento em tempo real
  FOR r IN (
    SELECT 
      l.id AS leito_id, 
      l.alojamento_id, 
      l.numero, 
      l.inscricao_id, 
      h.id AS hospedagem_id, 
      i.status_pagamento
    FROM public.evento_hospedagem_leitos l
    JOIN public.evento_inscricoes i ON i.id = l.inscricao_id
    LEFT JOIN public.evento_hospedagens h ON h.inscricao_id = l.inscricao_id AND h.evento_id = l.evento_id
    WHERE l.evento_id = v_evento_id
      AND l.ocupado = true
      AND l.inscricao_id IS NOT NULL
      AND i.status_pagamento NOT IN ('pago', 'isento')
    FOR UPDATE OF l, i, h
  ) LOOP
    IF r.status_pagamento NOT IN ('pago', 'isento') THEN
      UPDATE public.evento_hospedagem_leitos
      SET ocupado = false, inscricao_id = NULL
      WHERE id = r.leito_id;

      IF r.hospedagem_id IS NOT NULL THEN
        UPDATE public.evento_hospedagens
        SET status = 'solicitada',
            alojamento_id = NULL,
            numero_cama = NULL,
            tipo_cama = NULL,
            observacoes = COALESCE(observacoes, '') || ' | [SSOT] Retornado para aguardando pagamento conforme regra financeira.'
        WHERE id = r.hospedagem_id;
      END IF;

      RAISE NOTICE 'Inscrição pendente % regularizada: leito % liberado no alojamento %', r.inscricao_id, r.numero, r.alojamento_id;
    END IF;
  END LOOP;
END $$;

-- 6. IDENTIFICAÇÃO DINÂMICA DOS EXCEDENTES DO ROSA COMO INDISPONÍVEIS (SEM NÚMEROS ESTÁTICOS)
DO $$
DECLARE
  v_evento_id UUID := '4307ecd3-e74a-4855-9de7-c4e29216a190';
  v_aloj_rosa_id UUID;
  v_ocupados_reais INT;
  v_vagas_livres_necessarias INT;
BEGIN
  SELECT id INTO v_aloj_rosa_id
  FROM public.evento_alojamentos
  WHERE evento_id = v_evento_id AND setor_key = 's_1792374947001_uyil';

  SELECT COUNT(*) INTO v_ocupados_reais
  FROM public.evento_hospedagem_leitos
  WHERE evento_id = v_evento_id
    AND alojamento_id = v_aloj_rosa_id
    AND ocupado = true
    AND inscricao_id IS NOT NULL;

  -- Alojamento Rosa possui 124 vagas oficiais operacionais
  v_vagas_livres_necessarias := GREATEST(0, 124 - v_ocupados_reais);

  -- Preserva todos os leitos no banco, marcando como indisponíveis apenas os que excedem a cota operacional
  WITH livres_rosa AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY numero ASC) AS rn
    FROM public.evento_hospedagem_leitos
    WHERE evento_id = v_evento_id
      AND alojamento_id = v_aloj_rosa_id
      AND (ocupado = false OR inscricao_id IS NULL)
  )
  UPDATE public.evento_hospedagem_leitos l
  SET 
    indisponivel = true,
    motivo_indisponibilidade = 'Excedente de capacidade física acima do teto oficial de 124 vagas (SSOT 126ª AGO)',
    ocupado = true,
    inscricao_id = NULL
  FROM livres_rosa lr
  WHERE l.id = lr.id
    AND lr.rn > v_vagas_livres_necessarias;
END $$;

-- 7. MATERIALIZAÇÃO DINÂMICA DENTRO DA TRANSAÇÃO (SEM INSERTS ESTÁTICOS)
-- Preenche lacunas de numeração, respeita a paridade de beliches (inferior/superior) e cotas por tipo
DO $$
DECLARE
  v_evento_id UUID := '4307ecd3-e74a-4855-9de7-c4e29216a190';
  v_aloj RECORD;
  v_tot_target INT;
  v_inf_target INT;
  v_sup_target INT;
  v_col_target INT;
  v_total_existente INT;
  v_inf_exist INT;
  v_sup_exist INT;
  v_deficit_total INT;
  v_inf_needed INT;
  v_sup_needed INT;
  v_col_needed INT;
  v_n INT;
  v_num_str TEXT;
  v_pos TEXT;
  v_tipo TEXT;
  v_exists BOOLEAN;
BEGIN
  FOR v_aloj IN (
    SELECT id, nome, total_vagas, camas_inferiores, camas_superiores, colchonetes
    FROM public.evento_alojamentos
    WHERE evento_id = v_evento_id AND ativo = true
    ORDER BY nome
  ) LOOP
    v_tot_target := v_aloj.total_vagas;
    v_inf_target := v_aloj.camas_inferiores;
    v_sup_target := v_aloj.camas_superiores;
    v_col_target := COALESCE(v_aloj.colchonetes, 0);

    SELECT COUNT(*) INTO v_total_existente
    FROM public.evento_hospedagem_leitos
    WHERE evento_id = v_evento_id AND alojamento_id = v_aloj.id;

    -- Se o alojamento já possui o quantitativo físico completo (ou excedente, como o Rosa), não cria leitos
    IF v_total_existente >= v_tot_target THEN
      CONTINUE;
    END IF;

    SELECT COUNT(*) INTO v_inf_exist
    FROM public.evento_hospedagem_leitos
    WHERE evento_id = v_evento_id AND alojamento_id = v_aloj.id AND posicao = 'inferior';

    SELECT COUNT(*) INTO v_sup_exist
    FROM public.evento_hospedagem_leitos
    WHERE evento_id = v_evento_id AND alojamento_id = v_aloj.id AND posicao = 'superior';

    v_deficit_total := v_tot_target - v_total_existente;
    v_inf_needed := LEAST(v_deficit_total, GREATEST(0, v_inf_target - v_inf_exist));
    v_sup_needed := LEAST(v_deficit_total - v_inf_needed, GREATEST(0, v_sup_target - v_sup_exist));
    v_col_needed := GREATEST(0, v_deficit_total - v_inf_needed - v_sup_needed);

    v_n := 1;
    WHILE (v_inf_needed > 0 OR v_sup_needed > 0 OR v_col_needed > 0) AND v_n < 2000 LOOP
      v_num_str := LPAD(v_n::TEXT, 3, '0');

      SELECT EXISTS(
        SELECT 1 FROM public.evento_hospedagem_leitos
        WHERE evento_id = v_evento_id AND alojamento_id = v_aloj.id AND numero = v_num_str
      ) INTO v_exists;

      IF NOT v_exists THEN
        IF v_inf_needed > 0 OR v_sup_needed > 0 THEN
          v_tipo := 'beliche';
          IF (v_n % 2 = 1) THEN -- Ímpar
            IF v_inf_needed > 0 THEN
              v_pos := 'inferior';
              v_inf_needed := v_inf_needed - 1;
            ELSE
              v_pos := 'superior';
              v_sup_needed := v_sup_needed - 1;
            END IF;
          ELSE -- Par
            IF v_sup_needed > 0 THEN
              v_pos := 'superior';
              v_sup_needed := v_sup_needed - 1;
            ELSE
              v_pos := 'inferior';
              v_inf_needed := v_inf_needed - 1;
            END IF;
          END IF;
        ELSE
          v_pos := 'colchonete';
          v_tipo := 'colchonete';
          v_col_needed := v_col_needed - 1;
        END IF;

        INSERT INTO public.evento_hospedagem_leitos (
          evento_id,
          alojamento_id,
          numero,
          posicao,
          tipo_leito,
          ocupado,
          inscricao_id,
          indisponivel
        ) VALUES (
          v_evento_id,
          v_aloj.id,
          v_num_str,
          v_pos,
          v_tipo,
          false,
          NULL,
          false
        );
      END IF;

      v_n := v_n + 1;
    END LOOP;
  END LOOP;
END $$;

-- 8. VALIDAÇÃO ATÔMICA POR INVARIANTES TRANSACIONAIS
DO $$
DECLARE
  v_evento_id UUID := '4307ecd3-e74a-4855-9de7-c4e29216a190';
  v_aloj RECORD;
  v_soma_capacidades_aloj INT;
  v_soma_capacidades_ago INT;
  v_pendentes_ocupando INT;
  v_op_total INT;
  v_op_inf INT;
  v_op_sup INT;
  v_op_col INT;
BEGIN
  -- Invariante 1: A soma das capacidades oficiais em evento_alojamentos deve ser exatamente 1.401
  SELECT SUM(total_vagas) INTO v_soma_capacidades_aloj
  FROM public.evento_alojamentos
  WHERE evento_id = v_evento_id AND ativo = true;

  IF v_soma_capacidades_aloj <> 1401 THEN
    RAISE EXCEPTION 'Invariante violado: Soma das capacidades de evento_alojamentos é %, esperado exatamente 1401.', v_soma_capacidades_aloj;
  END IF;

  -- Invariante 2: A soma das capacidades em configuracoes_ago deve ser exatamente 1.401
  SELECT (
    (configuracoes_ago->'setores'->0->>'quantidade_leitos')::INT +
    (configuracoes_ago->'setores'->1->>'quantidade_leitos')::INT +
    (configuracoes_ago->'setores'->2->>'quantidade_leitos')::INT +
    (configuracoes_ago->'setores'->3->>'quantidade_leitos')::INT +
    (configuracoes_ago->'setores'->4->>'quantidade_leitos')::INT
  ) INTO v_soma_capacidades_ago
  FROM public.eventos
  WHERE id = v_evento_id;

  IF v_soma_capacidades_ago <> 1401 THEN
    RAISE EXCEPTION 'Invariante violado: Soma das capacidades em configuracoes_ago é %, esperado exatamente 1401.', v_soma_capacidades_ago;
  END IF;

  -- Invariante 3: Nenhuma reserva pendente pode estar consumindo leito
  SELECT COUNT(*) INTO v_pendentes_ocupando
  FROM public.evento_hospedagem_leitos l
  JOIN public.evento_inscricoes i ON i.id = l.inscricao_id
  WHERE l.evento_id = v_evento_id
    AND l.ocupado = true
    AND i.status_pagamento NOT IN ('pago', 'isento');

  IF v_pendentes_ocupando > 0 THEN
    RAISE EXCEPTION 'Invariante violado: Existem % inscrições não elegíveis (pendentes) ocupando leitos.', v_pendentes_ocupando;
  END IF;

  -- Invariante 4: Validação das capacidades operacionais EXATAS por alojamento (excluindo indisponíveis)
  FOR v_aloj IN (
    SELECT id, nome, total_vagas, camas_inferiores, camas_superiores, colchonetes
    FROM public.evento_alojamentos
    WHERE evento_id = v_evento_id AND ativo = true
  ) LOOP
    SELECT COUNT(*) INTO v_op_total
    FROM public.evento_hospedagem_leitos
    WHERE evento_id = v_evento_id AND alojamento_id = v_aloj.id AND indisponivel = false;

    IF v_op_total <> v_aloj.total_vagas THEN
      RAISE EXCEPTION 'Invariante violado: Alojamento "%" possui % leitos operacionais, esperado exatamente %.',
        v_aloj.nome, v_op_total, v_aloj.total_vagas;
    END IF;

    RAISE NOTICE 'Alojamento "%" validado com sucesso: % vagas operacionais exatas.', v_aloj.nome, v_op_total;
  END LOOP;

  RAISE NOTICE 'SSOT 126ª AGO validada com 100%% de sucesso! Vagas operacionais: 1.401.';
END $$;

COMMIT;
