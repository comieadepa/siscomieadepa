-- ==============================================================================
-- CORREÇÃO PONTUAL: tipos_leito como JSONB em evento_alojamentos
-- Arquivo: scratch/rpc_alocar_hospedagem_atomica_definitiva.sql
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.alocar_hospedagem_atomica(
  p_evento_id UUID,
  p_inscricao_id UUID,
  p_alojamento_id UUID,
  p_tipo_cama TEXT,             -- 'inferior', 'superior' ou 'colchonete'
  p_prioridade INT DEFAULT 0,
  p_origem_alocacao TEXT DEFAULT 'sistema' -- 'individual', 'webhook_pagamento', 'processar_pendencias'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role TEXT;
  v_is_service_role BOOLEAN;

  v_inscricao RECORD;
  v_hospedagem RECORD;
  v_has_hospedagem BOOLEAN;
  v_alojamento RECORD;
  v_leito_existente RECORD;
  v_leito_livre RECORD;
  
  v_posicao_desejada TEXT;
  v_numero_cama TEXT;
  v_leito_id UUID;
  v_tipo_leito_cad TEXT;
  v_posicao_cad TEXT;

  v_ocupados_total INT;
  v_ocupados_tipo INT;
  v_limite_total INT;
  v_limite_tipo INT;

  v_sexo_insc TEXT;
  v_tipo_insc TEXT;
  v_grupo_aloj TEXT;
  v_pub_aloj TEXT;
  v_grupo_compativel BOOLEAN;
  v_admite_beliche BOOLEAN;
  v_admite_colchonete BOOLEAN;
  v_exige_cama_inferior BOOLEAN;
BEGIN
  -- 1. SEGURANÇA: Exclusivo service_role
  v_role := auth.role();
  v_is_service_role := (v_role = 'service_role');

  IF NOT v_is_service_role THEN
    RAISE EXCEPTION 'Acesso negado: a execucao desta funcao e restrita exclusivamente ao service_role do backend.';
  END IF;

  -- 2. BLOQUEIO PESSIMISTA DA INSCRIÇÃO
  SELECT * INTO v_inscricao
  FROM public.evento_inscricoes
  WHERE id = p_inscricao_id AND evento_id = p_evento_id
  FOR UPDATE;

  IF v_inscricao.id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', 'erro',
      'motivo', 'Inscricao nao encontrada para o evento informado.'
    );
  END IF;

  IF NOT COALESCE(v_inscricao.hospedagem, false) THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', 'recusado',
      'motivo', 'Participante nao solicitou hospedagem na inscricao.'
    );
  END IF;

  IF LOWER(COALESCE(v_inscricao.status_pagamento, '')) = 'cancelado' THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', 'recusado',
      'motivo', 'Inscricao cancelada. Proibida a alocacao ou reativacao automatica.'
    );
  END IF;

  IF LOWER(COALESCE(v_inscricao.status_pagamento, '')) NOT IN ('pago', 'isento') THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', 'recusado',
      'motivo', 'Inscricao com pagamento pendente (Status: ' || COALESCE(v_inscricao.status_pagamento, 'null') || ').'
    );
  END IF;

  -- 3. BLOQUEIO PESSIMISTA DA HOSPEDAGEM E PROTEÇÃO DE CHECK-IN DA HOSPEDAGEM
  SELECT * INTO v_hospedagem
  FROM public.evento_hospedagens
  WHERE inscricao_id = p_inscricao_id AND evento_id = p_evento_id
  FOR UPDATE;

  v_has_hospedagem := (v_hospedagem.id IS NOT NULL);

  IF v_has_hospedagem AND v_hospedagem.status = 'cancelada' THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', 'recusado',
      'motivo', 'Hospedagem cancelada pelo operador. Proibida reativacao automatica.'
    );
  END IF;

  -- Proteção estrita do check-in / check-out DA HOSPEDAGEM:
  -- Só bloqueia se o participante já possuir leito físico atribuído e check-in efetuado.
  -- Se foi marcado check-in por engano sem possuir cama/alojamento (ex: pelo check-in geral do evento),
  -- a alocação assistida é permitida para completar a atribuição do leito físico sem corromper o check-in.
  IF v_has_hospedagem AND v_hospedagem.numero_cama IS NOT NULL AND v_hospedagem.alojamento_id IS NOT NULL AND (v_hospedagem.status IN ('checkin_realizado', 'checkout_realizado') OR v_hospedagem.checkin_at IS NOT NULL OR v_hospedagem.checkout_at IS NOT NULL) THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', 'preservado',
      'motivo', 'Participante com check-in ou check-out de hospedagem ja efetuado na acomodacao. Registro protegido contra alteracoes automaticas.'
    );
  END IF;

  -- 4. IDEMPOTÊNCIA SOMENTE LEITURA ESTREITA
  SELECT * INTO v_leito_existente
  FROM public.evento_hospedagem_leitos
  WHERE inscricao_id = p_inscricao_id AND evento_id = p_evento_id AND ocupado = true
  LIMIT 1;

  IF v_leito_existente.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'status', 'ja_alocado',
      'motivo', 'Participante ja possui leito fisico reservado no alojamento.',
      'detalhes', jsonb_build_object(
        'hospedagem_id', v_hospedagem.id,
        'leito_id', v_leito_existente.id,
        'alojamento_id', v_leito_existente.alojamento_id,
        'numero_cama', v_leito_existente.numero,
        'tipo_cama', CASE 
          WHEN v_leito_existente.posicao IN ('inferior', 'superior') THEN v_leito_existente.posicao 
          ELSE v_leito_existente.tipo_leito 
        END,
        'somente_leitura', true
      )
    );
  END IF;

  IF v_has_hospedagem AND v_hospedagem.alojamento_id IS NOT NULL AND v_hospedagem.status IN ('confirmada', 'solicitada') AND v_hospedagem.numero_cama IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'status', 'ja_alocado',
      'motivo', 'Participante ja possui hospedagem alocada com numero de cama atribuido.',
      'detalhes', jsonb_build_object(
        'hospedagem_id', v_hospedagem.id,
        'alojamento_id', v_hospedagem.alojamento_id,
        'numero_cama', v_hospedagem.numero_cama,
        'tipo_cama', v_hospedagem.tipo_cama,
        'somente_leitura', true
      )
    );
  END IF;

  -- 5. BLOQUEIO PESSIMISTA DO ALOJAMENTO (LOCK COMPARTILHADO EM TODOS OS FLUXOS)
  SELECT * INTO v_alojamento
  FROM public.evento_alojamentos
  WHERE id = p_alojamento_id AND evento_id = p_evento_id
  FOR UPDATE;

  IF v_alojamento.id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', 'erro',
      'motivo', 'Alojamento de destino nao encontrado para o evento informado.'
    );
  END IF;

  IF NOT COALESCE(v_alojamento.ativo, true) THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', 'recusado',
      'motivo', 'Alojamento destino esta inativo no sistema.'
    );
  END IF;

  -- 6. VALIDAÇÃO DE GÊNERO, GRUPOS E PRIORIDADES OFICIAIS
  v_sexo_insc := LOWER(COALESCE(v_inscricao.sexo, ''));
  v_pub_aloj := LOWER(COALESCE(v_alojamento.publico, ''));

  -- Validação de Sexo considerando publico ou coluna sexo do alojamento
  IF (v_pub_aloj = 'masculino' OR v_pub_aloj = 'masculino_geral' OR v_pub_aloj = 'jubilados' OR v_alojamento.sexo = 'M') AND v_sexo_insc NOT IN ('m', 'masculino') THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', 'recusado',
      'motivo', 'Incompatibilidade de sexo: alojamento masculino para inscricao feminina.'
    );
  END IF;

  IF (v_pub_aloj = 'feminino' OR v_alojamento.sexo = 'F') AND v_sexo_insc NOT IN ('f', 'feminino') THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', 'recusado',
      'motivo', 'Incompatibilidade de sexo: alojamento feminino para inscricao masculina.'
    );
  END IF;

  v_tipo_insc := LOWER(COALESCE(v_inscricao.tipo_inscricao, ''));
  v_grupo_aloj := LOWER(COALESCE(v_alojamento.grupo_permitido, ''));

  v_grupo_compativel := false;
  IF (v_pub_aloj = 'feminino' OR v_alojamento.sexo = 'F') AND v_sexo_insc IN ('f', 'feminino') THEN
    -- Alojamentos femininos oficiais (Rosa e Azul): aceitam exclusivamente participantes femininas
    v_grupo_compativel := true;
  ELSIF (v_pub_aloj IN ('masculino', 'masculino_geral', 'jubilados') OR v_alojamento.sexo = 'M') AND v_sexo_insc IN ('m', 'masculino') THEN
    -- Mapeamento estrito dos 3 setores masculinos oficiais:
    IF v_grupo_aloj ILIKE '%presidente%' OR v_grupo_aloj ILIKE '%jubilado%' THEN
      -- Prédio Novo e AAME: Exclusivo para Pastores Presidentes e Jubilados
      IF v_tipo_insc ILIKE '%presidente%' OR v_tipo_insc ILIKE '%jubilado%' THEN
        v_grupo_compativel := true;
      END IF;
    ELSIF v_grupo_aloj ILIKE '%auxiliar%' OR v_grupo_aloj ILIKE '%juventude%' THEN
      -- Mário Covas: Exclusivo para Pastores Auxiliares e Juventude
      IF v_tipo_insc ILIKE '%auxiliar%' OR v_tipo_insc ILIKE '%juventude%' THEN
        v_grupo_compativel := true;
      END IF;
    END IF;
  END IF;

  IF NOT v_grupo_compativel THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', 'recusado',
      'motivo', 'Incompatibilidade de grupo: participante (' || v_tipo_insc || ') nao pertence ao grupo do setor (' || v_grupo_aloj || ').'
    );
  END IF;

  -- Validação de prioridade e obrigatoriedade de cama inferior
  v_exige_cama_inferior := COALESCE(v_inscricao.hosp_necessidade_especial, false) OR COALESCE(v_inscricao.hosp_cama_inferior, false);

  IF v_exige_cama_inferior AND p_tipo_cama <> 'inferior' THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', 'recusado',
      'motivo', 'Participante com prioridade (PCD/Idoso/Necessidade Especial) requer obrigatoriamente leito inferior.'
    );
  END IF;

  -- 7. VALIDAÇÃO DE TIPOS DE LEITO AUTORIZADOS (Tratamento robusto de JSONB / TEXT[])
  IF v_alojamento.tipos_leito IS NULL THEN
    v_admite_beliche := true;
    v_admite_colchonete := (COALESCE(v_alojamento.colchonetes, 0) > 0);
  ELSIF pg_typeof(v_alojamento.tipos_leito)::text = 'jsonb' THEN
    v_admite_beliche := (v_alojamento.tipos_leito @> '"beliche"'::jsonb);
    v_admite_colchonete := (v_alojamento.tipos_leito @> '"colchonete"'::jsonb);
  ELSE
    v_admite_beliche := ('beliche' = ANY(v_alojamento.tipos_leito::text[]));
    v_admite_colchonete := ('colchonete' = ANY(v_alojamento.tipos_leito::text[]));
  END IF;

  IF p_tipo_cama IN ('inferior', 'superior') THEN
    v_posicao_desejada := p_tipo_cama;
    v_tipo_leito_cad := 'beliche';
    v_posicao_cad := p_tipo_cama;
    
    IF NOT v_admite_beliche THEN
      RETURN jsonb_build_object(
        'success', false,
        'status', 'recusado',
        'motivo', 'O alojamento nao admite leitos do tipo beliche.'
      );
    END IF;
  ELSIF p_tipo_cama = 'colchonete' THEN
    v_posicao_desejada := 'unico';
    v_tipo_leito_cad := 'colchonete';
    v_posicao_cad := 'unico';

    IF NOT v_admite_colchonete THEN
      RETURN jsonb_build_object(
        'success', false,
        'status', 'recusado',
        'motivo', 'O alojamento nao admite leitos do tipo colchonete (capacidade ZERO para colchonetes).'
      );
    END IF;
  ELSE
    RETURN jsonb_build_object(
      'success', false,
      'status', 'erro',
      'motivo', 'Tipo de leito solicitado invalido: ' || COALESCE(p_tipo_cama, 'null')
    );
  END IF;

  -- 8. CONTABILIZAÇÃO CONSERVADORA DE OCUPAÇÃO (SEM DEDUPLICAR INSCRIÇÕES DIFERENTES)
  v_limite_total := COALESCE(v_alojamento.total_vagas, 0);

  IF p_tipo_cama = 'inferior' THEN
    v_limite_tipo := COALESCE(v_alojamento.camas_inferiores, 0);
  ELSIF p_tipo_cama = 'superior' THEN
    v_limite_tipo := COALESCE(v_alojamento.camas_superiores, 0);
  ELSIF p_tipo_cama = 'colchonete' THEN
    v_limite_tipo := COALESCE(v_alojamento.colchonetes, 0);
  END IF;

  IF v_limite_tipo <= 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', 'recusado',
      'motivo', 'O alojamento possui capacidade ZERO para o tipo de leito solicitado (' || p_tipo_cama || ').'
    );
  END IF;

  -- Total de ocupações distintas (preserva órfãos e não deduplica pessoas diferentes)
  SELECT COUNT(DISTINCT ocupacao_chave) INTO v_ocupados_total
  FROM (
    SELECT 'insc:' || l.inscricao_id::text AS ocupacao_chave
    FROM public.evento_hospedagem_leitos l
    WHERE l.alojamento_id = p_alojamento_id AND l.ocupado = true AND l.inscricao_id IS NOT NULL
    UNION
    SELECT 'leito_orfao:' || l.id::text AS ocupacao_chave
    FROM public.evento_hospedagem_leitos l
    WHERE l.alojamento_id = p_alojamento_id AND l.ocupado = true AND l.inscricao_id IS NULL
    UNION
    SELECT 'insc:' || h.inscricao_id::text AS ocupacao_chave
    FROM public.evento_hospedagens h
    WHERE h.alojamento_id = p_alojamento_id
      AND h.status IN ('confirmada', 'checkin_realizado', 'checkout_realizado')
  ) sub_tot;

  IF v_ocupados_total >= v_limite_total THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', 'lista_espera',
      'motivo', 'Capacidade total do alojamento esgotada (' || v_ocupados_total || '/' || v_limite_total || ').'
    );
  END IF;

  -- Ocupados por tipo de leito
  IF p_tipo_cama IN ('inferior', 'superior') THEN
    SELECT COUNT(DISTINCT ocupacao_chave) INTO v_ocupados_tipo
    FROM (
      SELECT 'insc:' || l.inscricao_id::text AS ocupacao_chave
      FROM public.evento_hospedagem_leitos l
      WHERE l.alojamento_id = p_alojamento_id AND l.ocupado = true AND l.tipo_leito = 'beliche' AND l.posicao = v_posicao_desejada AND l.inscricao_id IS NOT NULL
      UNION
      SELECT 'leito_orfao:' || l.id::text AS ocupacao_chave
      FROM public.evento_hospedagem_leitos l
      WHERE l.alojamento_id = p_alojamento_id AND l.ocupado = true AND l.tipo_leito = 'beliche' AND l.posicao = v_posicao_desejada AND l.inscricao_id IS NULL
      UNION
      SELECT 'insc:' || h.inscricao_id::text AS ocupacao_chave
      FROM public.evento_hospedagens h
      WHERE h.alojamento_id = p_alojamento_id
        AND h.status IN ('confirmada', 'checkin_realizado', 'checkout_realizado')
        AND h.tipo_cama = p_tipo_cama
    ) sub_tip;
  ELSE
    SELECT COUNT(DISTINCT ocupacao_chave) INTO v_ocupados_tipo
    FROM (
      SELECT 'insc:' || l.inscricao_id::text AS ocupacao_chave
      FROM public.evento_hospedagem_leitos l
      WHERE l.alojamento_id = p_alojamento_id AND l.ocupado = true AND l.tipo_leito = 'colchonete' AND l.inscricao_id IS NOT NULL
      UNION
      SELECT 'leito_orfao:' || l.id::text AS ocupacao_chave
      FROM public.evento_hospedagem_leitos l
      WHERE l.alojamento_id = p_alojamento_id AND l.ocupado = true AND l.tipo_leito = 'colchonete' AND l.inscricao_id IS NULL
      UNION
      SELECT 'insc:' || h.inscricao_id::text AS ocupacao_chave
      FROM public.evento_hospedagens h
      WHERE h.alojamento_id = p_alojamento_id
        AND h.status IN ('confirmada', 'checkin_realizado', 'checkout_realizado')
        AND h.tipo_cama = 'colchonete'
    ) sub_col;
  END IF;

  IF v_ocupados_tipo >= v_limite_tipo THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', 'lista_espera',
      'motivo', 'Vagas esgotadas para o tipo de leito solicitado (' || p_tipo_cama || ': ' || v_ocupados_tipo || '/' || v_limite_tipo || ').'
    );
  END IF;

  -- 9. SELEÇÃO DE LEITO FÍSICO HOMOLOGADO:
  SELECT * INTO v_leito_livre
  FROM public.evento_hospedagem_leitos l
  WHERE l.alojamento_id = p_alojamento_id
    AND l.ocupado = false
    AND l.inscricao_id IS NULL
    AND l.tipo_leito = v_tipo_leito_cad
    AND (
      (p_tipo_cama = 'colchonete') OR 
      (l.posicao = v_posicao_desejada)
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.evento_hospedagens h
      WHERE h.alojamento_id = p_alojamento_id
        AND h.numero_cama = l.numero
        AND h.status IN ('confirmada', 'checkin_realizado', 'checkout_realizado')
    )
  ORDER BY l.numero ASC, l.id ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  -- DESATIVAÇÃO DE JIT SEM MAPA FÍSICO CONFIRMADO
  IF v_leito_livre.id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', 'lista_espera',
      'motivo', 'Nao ha leito fisico homologado e desocupado disponivel para ' || p_tipo_cama || ' neste setor. Materializacao sob demanda desativada para numeros nao homologados.'
    );
  END IF;

  v_leito_id := v_leito_livre.id;
  v_numero_cama := v_leito_livre.numero;

  -- 10. EFETIVAÇÃO DA RESERVA E GRAVAÇÃO DA HOSPEDAGEM
  UPDATE public.evento_hospedagem_leitos
  SET ocupado = true,
      inscricao_id = p_inscricao_id
  WHERE id = v_leito_id;

  IF v_has_hospedagem THEN
    UPDATE public.evento_hospedagens
    SET alojamento_id = p_alojamento_id,
        tipo_cama = p_tipo_cama,
        numero_cama = v_numero_cama,
        status = CASE WHEN status = 'checkin_realizado' THEN 'checkin_realizado' ELSE 'confirmada' END,
        prioridade = p_prioridade,
        necessidade_especial = COALESCE(v_inscricao.hosp_necessidade_especial, false),
        descricao_necessidade = v_inscricao.hosp_descricao_necessidade,
        cama_inferior = COALESCE(v_inscricao.hosp_cama_inferior, false),
        observacoes = COALESCE(observacoes, '') || ' [Alocacao atomica via ' || p_origem_alocacao || ']'
    WHERE id = v_hospedagem.id;
  ELSE
    INSERT INTO public.evento_hospedagens (
      evento_id, inscricao_id, alojamento_id, tipo_cama, numero_cama,
      status, prioridade, necessidade_especial, descricao_necessidade, cama_inferior,
      observacoes, created_at
    ) VALUES (
      p_evento_id, p_inscricao_id, p_alojamento_id, p_tipo_cama, v_numero_cama,
      'confirmada', p_prioridade, COALESCE(v_inscricao.hosp_necessidade_especial, false),
      v_inscricao.hosp_descricao_necessidade, COALESCE(v_inscricao.hosp_cama_inferior, false),
      'Alocacao atomica via ' || p_origem_alocacao, NOW()
    ) RETURNING id INTO v_hospedagem.id;
  END IF;

  -- 11. RETORNO DE SUCESSO COMPLETO
  RETURN jsonb_build_object(
    'success', true,
    'status', 'alocado',
    'motivo', 'Alocacao efetuada com sucesso com protecao atomica.',
    'detalhes', jsonb_build_object(
      'hospedagem_id', v_hospedagem.id,
      'leito_id', v_leito_id,
      'alojamento_id', p_alojamento_id,
      'numero_cama', v_numero_cama,
      'tipo_cama', p_tipo_cama,
      'posicao', v_posicao_desejada,
      'origem', p_origem_alocacao
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.alocar_hospedagem_atomica(UUID, UUID, UUID, TEXT, INT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.alocar_hospedagem_atomica(UUID, UUID, UUID, TEXT, INT, TEXT) FROM authenticated;
REVOKE ALL ON FUNCTION public.alocar_hospedagem_atomica(UUID, UUID, UUID, TEXT, INT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.alocar_hospedagem_atomica(UUID, UUID, UUID, TEXT, INT, TEXT) TO service_role;
