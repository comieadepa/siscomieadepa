-- ==============================================================================
-- DEFINIÇÃO OFICIAL DA RPC ALOCAR_HOSPEDAGEM_ATOMICA (INSTALADA EM PRODUÇÃO)
-- Arquivo: supabase/migrations/20261126194500_alocar_hospedagem_atomica_oficial.sql
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.alocar_hospedagem_atomica(
  p_evento_id UUID,
  p_inscricao_id UUID,
  p_alojamento_id UUID,
  p_tipo_cama TEXT,             -- 'inferior', 'superior' ou 'colchonete'
  p_prioridade INT DEFAULT 0,
  p_origem_alocacao TEXT DEFAULT 'sistema'
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
  v_posicao_cad TEXT;

  v_sexo_insc TEXT;
  v_tipo_insc TEXT;
  v_grupo_aloj TEXT;
  v_pub_aloj TEXT;
  v_grupo_compativel BOOLEAN;
BEGIN
  -- 0. SEGURANÇA E CONTEXTO DE EXECUÇÃO
  v_role := current_setting('request.jwt.claim.role', true);
  v_is_service_role := (v_role = 'service_role');

  -- 1. BUSCA INSCRIÇÃO
  SELECT * INTO v_inscricao
  FROM public.evento_inscricoes
  WHERE id = p_inscricao_id AND evento_id = p_evento_id;

  IF v_inscricao.id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', 'erro',
      'motivo', 'Inscricao nao encontrada para o evento informado.'
    );
  END IF;

  -- 2. VALIDAÇÃO DE PAGAMENTO
  IF COALESCE(v_inscricao.status_pagamento, '') NOT IN ('pago', 'isento', 'confirmado') THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', 'recusado',
      'motivo', 'Inscricao com pagamento pendente (Status: ' || COALESCE(v_inscricao.status_pagamento, 'null') || ').'
    );
  END IF;

  -- 3. BLOQUEIO PESSIMISTA DA HOSPEDAGEM E PROTEÇÃO DE CHECK-IN
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
          WHEN v_leito_existente.tipo_leito = 'colchonete' THEN 'colchonete'
          ELSE v_leito_existente.posicao
        END
      )
    );
  END IF;

  -- 5. BUSCA E LOCK NO ALOJAMENTO DE DESTINO
  SELECT * INTO v_alojamento
  FROM public.evento_alojamentos
  WHERE id = p_alojamento_id AND evento_id = p_evento_id;

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

  -- 6. VALIDAÇÃO DE GÊNERO E GRUPOS (COM SUPORTE A VISITANTE E APOIO MASCULINOS)
  v_sexo_insc := LOWER(COALESCE(v_inscricao.sexo, ''));
  v_pub_aloj := LOWER(COALESCE(v_alojamento.publico, ''));

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
    v_grupo_compativel := true;
  ELSIF (v_pub_aloj IN ('masculino', 'masculino_geral', 'jubilados') OR v_alojamento.sexo = 'M') AND v_sexo_insc IN ('m', 'masculino') THEN
    IF v_grupo_aloj ILIKE '%presidente%' OR v_grupo_aloj ILIKE '%jubilado%' THEN
      IF v_tipo_insc ILIKE '%presidente%' OR v_tipo_insc ILIKE '%jubilado%' THEN
        v_grupo_compativel := true;
      END IF;
    ELSIF v_grupo_aloj ILIKE '%auxiliar%' OR v_grupo_aloj ILIKE '%juventude%' THEN
      -- PONTO HOMOLOGADO: Pastores Auxiliares, Juventude, Equipe de Apoio e Visitantes masculinos
      IF v_tipo_insc ILIKE '%auxiliar%' OR v_tipo_insc ILIKE '%juventude%' OR v_tipo_insc ILIKE '%jovem%' 
         OR v_tipo_insc ILIKE '%apoio%' OR v_tipo_insc ILIKE '%visitante%' THEN
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

  -- 7. SELEÇÃO ATÔMICA DO LEITO FÍSICO COM SKIP LOCKED
  v_posicao_desejada := LOWER(COALESCE(p_tipo_cama, 'superior'));

  IF v_posicao_desejada = 'colchonete' THEN
    SELECT * INTO v_leito_livre
    FROM public.evento_hospedagem_leitos
    WHERE alojamento_id = p_alojamento_id
      AND evento_id = p_evento_id
      AND tipo_leito = 'colchonete'
      AND ocupado = false
    ORDER BY numero ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED;
  ELSE
    SELECT * INTO v_leito_livre
    FROM public.evento_hospedagem_leitos
    WHERE alojamento_id = p_alojamento_id
      AND evento_id = p_evento_id
      AND tipo_leito = 'beliche'
      AND posicao = v_posicao_desejada
      AND ocupado = false
    ORDER BY numero ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED;

    IF v_leito_livre.id IS NULL AND NOT COALESCE(v_inscricao.hosp_cama_inferior, false) THEN
      SELECT * INTO v_leito_livre
      FROM public.evento_hospedagem_leitos
      WHERE alojamento_id = p_alojamento_id
        AND evento_id = p_evento_id
        AND tipo_leito = 'beliche'
        AND ocupado = false
      ORDER BY 
        CASE WHEN posicao = 'superior' THEN 1 ELSE 2 END,
        numero ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED;
    END IF;
  END IF;

  IF v_leito_livre.id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', 'lotado',
      'motivo', 'Nenhum leito fisico compativel e desocupado disponivel no alojamento selecionado.'
    );
  END IF;

  -- 8. EFETIVAÇÃO ATÔMICA DO LEITO
  UPDATE public.evento_hospedagem_leitos
  SET ocupado = true,
      inscricao_id = p_inscricao_id
  WHERE id = v_leito_livre.id;

  -- 9. GRAVAÇÃO NA TABELA evento_hospedagens
  v_posicao_cad := CASE 
    WHEN v_leito_livre.tipo_leito = 'colchonete' THEN 'colchonete'
    ELSE v_leito_livre.posicao
  END;

  IF v_has_hospedagem THEN
    UPDATE public.evento_hospedagens
    SET alojamento_id = p_alojamento_id,
        tipo_cama = v_posicao_cad,
        numero_cama = v_leito_livre.numero,
        status = 'confirmada',
        alocacao_automatica = true
    WHERE id = v_hospedagem.id;
  ELSE
    INSERT INTO public.evento_hospedagens (
      evento_id,
      inscricao_id,
      alojamento_id,
      tipo_cama,
      numero_cama,
      status,
      prioridade,
      necessidade_especial,
      cama_inferior,
      alocacao_automatica,
      grupo_hospedagem
    ) VALUES (
      p_evento_id,
      p_inscricao_id,
      p_alojamento_id,
      v_posicao_cad,
      v_leito_livre.numero,
      'confirmada',
      p_prioridade,
      COALESCE(v_inscricao.hosp_necessidade_especial, false),
      COALESCE(v_inscricao.hosp_cama_inferior, false),
      true,
      v_alojamento.grupo_permitido
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'status', 'alocado',
    'motivo', 'Leito reservado com sucesso.',
    'detalhes', jsonb_build_object(
      'alojamento_id', p_alojamento_id,
      'alojamento_nome', v_alojamento.nome,
      'leito_id', v_leito_livre.id,
      'numero_cama', v_leito_livre.numero,
      'tipo_cama', v_posicao_cad
    )
  );
END;
$$;
