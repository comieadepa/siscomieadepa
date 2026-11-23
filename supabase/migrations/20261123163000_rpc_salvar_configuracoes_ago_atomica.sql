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

      IF v_camas_superiores < v_ocup_efetiva_sup THEN
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
