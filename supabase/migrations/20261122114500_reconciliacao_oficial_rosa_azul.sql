-- ==============================================================================
-- SISCOMIEADEPA — 126ª AGO: RECONCILIAÇÃO OFICIAL DOS ALOJAMENTOS ROSA E AZUL
-- Arquivo: scratch/reconciliacao_oficial_rosa_azul_completa.sql
-- Homologação Final Corrigida com Inventário Físico Completo (124 posições Rosa)
-- Evento: 126ª AGO (ID: 4307ecd3-e74a-4855-9de7-c4e29216a190)
-- Alojamento Rosa: fbb5d408-e9de-42ee-bfb5-2d4f0d33a0d8
-- Alojamento Azul: b11eb773-384e-4e44-b605-0b9a6b861d57
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.executar_reconciliacao_oficial_rosa_azul(
  p_evento_id UUID DEFAULT '4307ecd3-e74a-4855-9de7-c4e29216a190'::UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_aloj_rosa_id UUID := 'fbb5d408-e9de-42ee-bfb5-2d4f0d33a0d8'::UUID;
  v_aloj_azul_id UUID := 'b11eb773-384e-4e44-b605-0b9a6b861d57'::UUID;
  
  v_total_alojamentos_bloqueados INT;
  v_total_rosa_inicial INT;
  v_total_azul_inicial INT;
  v_total_rosa_final   INT;
  v_total_azul_final   INT;
  
  v_total_estado_final    INT;
  v_total_estado_original INT;
  v_count_leitos_azul  INT;
  v_count_transferidos INT;
  v_count_renumerados  INT;
  
  v_rosa_total_leitos      INT;
  v_rosa_leitos_ocupados   INT;
  v_rosa_leitos_livres     INT;
  v_rosa_superiores_totais INT;
  v_rosa_inferiores_totais INT;
  v_rosa_colchoes_totais   INT;
  
  v_leito_conflito     RECORD;
  v_res_json           JSONB;
BEGIN
  -- 1. VALIDAÇÃO DE SEGURANÇA E ACESSO ADMINISTRATIVO
  IF current_user NOT IN ('postgres', 'service_role') THEN
    IF auth.role() <> 'authenticated' THEN
      RAISE EXCEPTION 'Acesso negado: execução requer privilégios administrativos.';
    END IF;
  END IF;

  -- 2. BLOQUEIO PESSIMISTA CONCORRENTE BIDIRECIONAL (FOR UPDATE)
  WITH lock_aloj AS (
    SELECT id FROM public.evento_alojamentos
     WHERE id IN (v_aloj_rosa_id, v_aloj_azul_id) AND evento_id = p_evento_id
     ORDER BY id
     FOR UPDATE
  )
  SELECT count(*) INTO v_total_alojamentos_bloqueados FROM lock_aloj;

  IF v_total_alojamentos_bloqueados <> 2 THEN
    RAISE EXCEPTION 'Abortado: Esperava encontrar e bloquear exatamente os 2 alojamentos (Rosa e Azul), mas foram bloqueados %.', v_total_alojamentos_bloqueados;
  END IF;

  PERFORM id FROM public.evento_hospedagens
    WHERE evento_id = p_evento_id AND alojamento_id IN (v_aloj_rosa_id, v_aloj_azul_id)
    FOR UPDATE;

  PERFORM id FROM public.evento_hospedagem_leitos
    WHERE evento_id = p_evento_id AND alojamento_id IN (v_aloj_rosa_id, v_aloj_azul_id)
    FOR UPDATE;

  -- 3. CRIAÇÃO E CARGA DA TABELA DOS 70 PARTICIPANTES HOMOLOGADOS
  CREATE TEMP TABLE tmp_participantes_esperados (
    hospedagem_id      UUID PRIMARY KEY,
    inscricao_id       UUID NOT NULL,
    alojamento_destino TEXT NOT NULL CHECK (alojamento_destino IN ('azul', 'rosa')),
    tipo_cama          TEXT NOT NULL CHECK (tipo_cama IN ('superior', 'inferior')),
    leito_antigo       TEXT NOT NULL,
    leito_novo         TEXT NOT NULL
  ) ON COMMIT DROP;

  INSERT INTO tmp_participantes_esperados (
    hospedagem_id, inscricao_id, alojamento_destino, tipo_cama, leito_antigo, leito_novo
  ) VALUES

    ('34fc15f6-bdd6-4658-ad1e-515b7d0c5a27'::UUID, '05602f2e-b772-497c-9d7c-c21f91b5ee72'::UUID, 'azul', 'superior', '054', '177'),
    ('3913e280-916e-4ba7-903e-424abc7e938f'::UUID, 'afe49534-29e3-41b4-903a-08d1956532df'::UUID, 'azul', 'superior', '055', '179'),
    ('5eefc3ff-14ff-4df3-aa54-3f54dc3a633c'::UUID, 'cbf3946a-dbc7-40af-b12a-d1a8913e10b4'::UUID, 'azul', 'superior', '058', '181'),
    ('2aa35c09-530f-4edd-96d3-3dfafdbde173'::UUID, '16b3bbda-6478-4f43-90f7-eb4b9206dd44'::UUID, 'azul', 'superior', '067', '183'),
    ('5eec4a36-523a-45b4-b16b-371f23a4d36e'::UUID, '2561ca8d-e1e1-4bab-91ac-f7332cdf1785'::UUID, 'azul', 'superior', '068', '185'),
    ('e43e5793-36ab-4ba2-b7ef-d6cc9e942c29'::UUID, 'f2816baa-dfca-4ac6-9ccd-ce88494e08c3'::UUID, 'rosa', 'inferior', '010', '002'),
    ('2babb7f1-87d2-4660-b6bd-eeff2f353607'::UUID, 'd2d84386-7e05-4bad-99bc-1dc37efea301'::UUID, 'rosa', 'inferior', '052', '004'),
    ('fc5e6a10-2c2b-4b97-b83a-d9ebe5e29bc9'::UUID, '4b360614-ba09-4534-9456-f40fc6181ba5'::UUID, 'rosa', 'inferior', '017', '006'),
    ('bafdfe09-3f92-49d9-8aa2-a164c8bf2585'::UUID, 'df42040c-8fc6-4b9d-9061-9c7d5688bfe8'::UUID, 'rosa', 'inferior', '033', '008'),
    ('3b99221e-5d8a-4212-a507-1a2a00307755'::UUID, '65e21b6b-b474-43b8-9557-1ba0b27893c4'::UUID, 'rosa', 'inferior', '056', '010'),
    ('2e9e0c13-cb1d-43e4-87ab-79c3b49ff054'::UUID, 'aece8c92-e239-4670-ae11-9764f8983a4e'::UUID, 'rosa', 'inferior', '016', '012'),
    ('9a04813c-9454-4c3d-8105-5ad5fdd33249'::UUID, '18d0abb4-f0fb-47ee-9d95-b110131636ae'::UUID, 'rosa', 'inferior', '020', '014'),
    ('c363f48c-cf36-4565-a6f6-04007632e954'::UUID, 'fed84af1-f431-4fda-8341-6a2e2e054ea5'::UUID, 'rosa', 'inferior', '035', '016'),
    ('38ed50ef-6238-440c-a041-c2fe615e6075'::UUID, 'bcb132af-31c2-4f03-8e07-686ab0cad6ca'::UUID, 'rosa', 'inferior', '043', '018'),
    ('ffe65b17-4dab-4925-a9f9-fe3b873200d3'::UUID, 'b2ab1662-4698-4e18-b235-2ea52a9aab95'::UUID, 'rosa', 'inferior', '040', '020'),
    ('06d77673-99f9-4357-b847-b7fdc4a2675a'::UUID, '8d4f03fd-73f1-43e4-8b9d-d5cb74437339'::UUID, 'rosa', 'inferior', '049', '022'),
    ('d2d39bfc-0bd9-4dbb-bd7b-0ed03ee5e677'::UUID, '6ee7ed68-13a8-4ae7-b469-1e046bb1ec32'::UUID, 'rosa', 'inferior', '057', '024'),
    ('9e688ea5-c26d-4bbb-90de-e1425b212eef'::UUID, '478a1a4f-871e-4d0f-9a22-14938ebe42a7'::UUID, 'rosa', 'inferior', '064', '026'),
    ('fc9df704-2e86-479a-afe0-cbfaba9a270f'::UUID, '06ad16b2-9835-40b9-9732-b148ee018983'::UUID, 'rosa', 'inferior', '060', '028'),
    ('8db9ec43-e2e7-4e22-8aac-e50e9cb18365'::UUID, '51ad918d-0674-45f8-bdc9-58a11cec008c'::UUID, 'rosa', 'inferior', '048', '030'),
    ('f18280d4-c60c-46f3-a1c2-db3e26cd622b'::UUID, '9b670112-3d04-488e-b8f0-1206333d21b0'::UUID, 'rosa', 'inferior', '002', '032'),
    ('8531dc50-c4c3-4675-89cd-faffcb4dd537'::UUID, '152bc440-8ecd-4622-b5f8-2fbbde9d896e'::UUID, 'rosa', 'inferior', '059', '034'),
    ('0effb0f3-9420-4f95-bbe7-e55ec8b7522b'::UUID, '434ffe11-22f8-4c32-92c8-123c9fe2426a'::UUID, 'rosa', 'inferior', '070', '036'),
    ('fcb65f07-0fef-4708-a418-70e42399df35'::UUID, '5ae0ade3-b140-498a-af64-19b606edaf4d'::UUID, 'rosa', 'inferior', '071', '038'),
    ('07403361-8625-4ab1-9d5f-1ca1a7b9aedb'::UUID, '32a142ab-7ff6-4918-8c35-d2ddd4cba69d'::UUID, 'rosa', 'inferior', '007', '040'),
    ('a0c55520-6adb-4d67-b006-0bbe17f962a6'::UUID, 'd5ba8ab6-6beb-4a4e-bef6-5ccbb2e01167'::UUID, 'rosa', 'inferior', '032', '042'),
    ('f0fb14c6-659f-4f79-86c2-cfa66d850157'::UUID, '25bd83c2-e41b-4c76-a5b7-d1609f88b5a6'::UUID, 'rosa', 'inferior', '044', '044'),
    ('d7e81b64-7095-46e4-b726-df725fd92c0a'::UUID, '04abc84c-c4a2-4e69-861b-742487dcb989'::UUID, 'rosa', 'inferior', '69', '046'),
    ('775ecaed-29f0-44b9-8592-2ddda3f2f4bf'::UUID, '264e84ce-bfd3-425e-bef6-63a7f6bb257a'::UUID, 'rosa', 'superior', '005', '001'),
    ('d1c47af3-1c1b-47f1-8fa9-f89a902e867c'::UUID, '63d28f31-b964-47e1-aa8a-f2d4dc067af3'::UUID, 'rosa', 'superior', '061', '003'),
    ('6406f96c-d745-40a6-b395-5e05e4a9c441'::UUID, 'd6921f23-7058-450e-8df9-bcdb37cabecc'::UUID, 'rosa', 'superior', '012', '005'),
    ('0cc6cae7-7d73-4b1e-b9eb-9920f18ce4e9'::UUID, '4f5003e9-e838-490f-b2b8-a28cdf1dc3b4'::UUID, 'rosa', 'superior', '027', '007'),
    ('a784c65e-8580-4558-9c97-1a05f7d9d126'::UUID, '3874fc42-11bf-473e-8031-455150500e31'::UUID, 'rosa', 'superior', '030', '009'),
    ('1c0af602-b341-426b-8ac4-b4e708b13451'::UUID, 'dbd84e71-9f01-49af-a724-25423e36d8f8'::UUID, 'rosa', 'superior', '042', '011'),
    ('90c66ac4-a122-4756-8c56-92a65f22aa6e'::UUID, '6d2fbfc2-caf2-4e22-8ba9-f3990558b3c4'::UUID, 'rosa', 'superior', '051', '013'),
    ('c72d5f73-3aa8-467d-8e94-d7b142f42cd2'::UUID, 'a367623b-364f-405a-900b-b180ecdcc71f'::UUID, 'rosa', 'superior', '053', '015'),
    ('b862eff6-5ac3-4f11-8106-7dafa8068424'::UUID, 'eba0b10b-07eb-4f47-b6cf-22dbccfb763f'::UUID, 'rosa', 'superior', '065', '017'),
    ('8f572a50-095f-4a45-a86e-97b0b81bc528'::UUID, '1158ff0d-ff6a-49dd-acae-b190c1b8766c'::UUID, 'rosa', 'superior', '066', '019'),
    ('017853cf-e90d-4353-a384-911159d211fc'::UUID, 'b9932c0b-9435-40db-b935-f03b2ffc3398'::UUID, 'rosa', 'superior', '001', '021'),
    ('9be3d3d4-96a2-4170-b177-86a422dbc4d2'::UUID, '17d10a26-89fc-49ff-87d7-036f6e88e583'::UUID, 'rosa', 'superior', '003', '023'),
    ('9c80baa5-1abe-41fe-982d-2642bf8f53ab'::UUID, 'f58121b5-4958-430f-b536-f8e367a158a5'::UUID, 'rosa', 'superior', '004', '025'),
    ('afd05789-408d-41d5-a4d7-f300b431eb69'::UUID, '30de1d5d-67c7-411c-8b54-440b73ad8543'::UUID, 'rosa', 'superior', '062', '027'),
    ('b6836643-ad86-48a4-848c-d019b0168797'::UUID, '2ad3611f-58fb-44bf-99a5-51e2dcdde1fc'::UUID, 'rosa', 'superior', '006', '029'),
    ('9583520b-fd72-4ec6-819e-e7a6c0af10db'::UUID, '7bfd31c0-c8cf-489d-882a-ad7a006d81cb'::UUID, 'rosa', 'superior', '008', '031'),
    ('f8035c22-d7b8-43f9-8242-22a6784f7681'::UUID, 'd29fd8d9-5161-4dde-b8b9-ebffda04676b'::UUID, 'rosa', 'superior', '009', '033'),
    ('8c5f9953-48ac-4386-8924-fc22f32ab388'::UUID, 'e5fd6d5b-a618-491d-a9e2-23f8fd328bb3'::UUID, 'rosa', 'superior', '063', '035'),
    ('d437be76-73bd-42b5-ac81-72680c4747c6'::UUID, '88264fc7-4a2b-49c6-a808-0ea7d6e7a7a7'::UUID, 'rosa', 'superior', '011', '037'),
    ('e0d5ae97-b80f-435c-b9ce-abbe37606722'::UUID, '7f46b2dc-82f4-4864-9c81-1ed52e32627f'::UUID, 'rosa', 'superior', '013', '039'),
    ('101c5def-3260-474c-95db-9f57b5f625f0'::UUID, '5df7fcbb-537a-4e59-9d8b-521f95bab741'::UUID, 'rosa', 'superior', '014', '041'),
    ('bba4df01-a410-4967-9a99-9faf4bf0542e'::UUID, '4083e9c1-b960-45a0-9022-9c67f8ecc38b'::UUID, 'rosa', 'superior', '015', '043'),
    ('6f784c81-9f38-42bc-9a1f-852b396962d4'::UUID, 'a6c32403-981f-4166-a17b-fcb63a6bce0b'::UUID, 'rosa', 'superior', '018', '045'),
    ('a4093136-5563-413b-ad32-c386af78aa22'::UUID, '48bae029-638c-43b5-b150-efa1f756dd04'::UUID, 'rosa', 'superior', '019', '047'),
    ('e375badb-ff40-44b7-a521-057db2b0d5ac'::UUID, 'ee4e6d67-eaf1-457b-8425-102252d5b5b6'::UUID, 'rosa', 'superior', '021', '049'),
    ('08856ae9-f206-4aaa-a7a7-d5b22539b955'::UUID, '25c7e390-9ba6-4290-9f19-299a699155d0'::UUID, 'rosa', 'superior', '022', '051'),
    ('23b2c54d-ea19-4d9d-9a89-e847dddafbb2'::UUID, 'fb0203ca-fa8b-4a90-a6a7-2ae6c0b70a7b'::UUID, 'rosa', 'superior', '023', '053'),
    ('8e79bda8-a5e8-458d-b67d-ae468ed3a9a2'::UUID, '71085a2b-9592-4f95-be1e-e7958de05d01'::UUID, 'rosa', 'superior', '024', '055'),
    ('29bf33d9-591c-4352-b615-d4d4f499221f'::UUID, '3da2a1af-7ab3-48ee-a5d0-ab6271b75924'::UUID, 'rosa', 'superior', '025', '057'),
    ('12b4b450-c94a-4daf-bca2-ba140b72ab79'::UUID, '3a21268f-d63d-46df-aaf9-12621cd01687'::UUID, 'rosa', 'superior', '026', '059'),
    ('f7e72198-2278-48f4-9e86-fedfd783b6a6'::UUID, 'fcd36166-206e-4e1e-a576-a6dfb3f5e473'::UUID, 'rosa', 'superior', '028', '061'),
    ('0ad7c2ad-54d0-4a76-898c-1881ebdbe8bb'::UUID, '9fd05285-3d4c-4b9d-9047-facf0777bd41'::UUID, 'rosa', 'superior', '031', '063'),
    ('a311e529-dd1f-466c-ae48-2d32dc76a83f'::UUID, '42f3cb14-e3df-40fc-ad54-726d1cdf203f'::UUID, 'rosa', 'superior', '034', '065'),
    ('d576391e-40a1-41c1-b556-c1ff37ec0ddb'::UUID, '6d51e7d6-5ad3-4a20-ae3f-e9bad4dd4cfc'::UUID, 'rosa', 'superior', '036', '067'),
    ('1ec50ded-fca9-41b3-9499-4d889b6c8531'::UUID, 'd8c45f05-69d6-4133-8e51-fc121f57cd12'::UUID, 'rosa', 'superior', '037', '069'),
    ('948ee1bf-9146-4296-a430-e9729739bcb3'::UUID, 'f9517584-75b5-4718-a4d8-c98b14a44ef9'::UUID, 'rosa', 'superior', '038', '071'),
    ('4991e39f-65f6-48ce-adcc-7c4372204510'::UUID, 'ec8ae7f9-5a6d-4d0b-959e-fc0475c88c03'::UUID, 'rosa', 'superior', '039', '073'),
    ('08c4f30c-8f8f-45c0-a888-277c8aa8bf4f'::UUID, '1fbef9d6-fc86-4b02-8832-90bd8b4975c8'::UUID, 'rosa', 'superior', '041', '075'),
    ('5d1a0af2-4ed8-4c26-bb06-004358903c5d'::UUID, 'b1e0bf71-1246-482e-9707-9cd473b92304'::UUID, 'rosa', 'superior', '045', '077'),
    ('86c97ea2-6afa-488f-a53c-d3435ed3d75c'::UUID, '2cf48414-aeba-4087-a82e-64ef0805d5a6'::UUID, 'rosa', 'superior', '046', '079'),
    ('b930d856-987e-41e0-ac22-48e3acc8cfe7'::UUID, '8f7b039c-7a87-4969-8509-d29f206e80df'::UUID, 'rosa', 'superior', '047', '081'),
    ('2cbdb864-87e2-4463-9f66-98e2be9a15b3'::UUID, '30bc6476-1a5b-41fd-9d00-1d8e8652ff1d'::UUID, 'rosa', 'superior', '050', '083')
;

  -- 4. VERIFICAÇÃO DE IDEMPOTÊNCIA E ESTADO DE EXECUÇÃO DOS 70 PARTICIPANTES
  SELECT count(*) INTO v_total_estado_final
    FROM tmp_participantes_esperados t
    JOIN public.evento_hospedagens h ON h.id = t.hospedagem_id
   WHERE h.evento_id = p_evento_id
     AND h.inscricao_id = t.inscricao_id
     AND h.numero_cama = t.leito_novo
     AND h.tipo_cama = t.tipo_cama
     AND h.alojamento_id = CASE WHEN t.alojamento_destino = 'azul' THEN v_aloj_azul_id ELSE v_aloj_rosa_id END
     AND h.status IN ('confirmada', 'checkin_realizado', 'checkout_realizado');

  IF v_total_estado_final = 70 THEN
    RETURN jsonb_build_object(
      'sucesso', true,
      'mensagem', 'Reconciliação já realizada anteriormente com sucesso para todos os 70 participantes (idempotência ativa).',
      'total_conferido', v_total_estado_final,
      'evento_id', p_evento_id,
      'data_verificacao', now()
    );
  END IF;

  SELECT count(*) INTO v_total_estado_original
    FROM tmp_participantes_esperados t
    JOIN public.evento_hospedagens h ON h.id = t.hospedagem_id
   WHERE h.evento_id = p_evento_id
     AND h.inscricao_id = t.inscricao_id
     AND h.alojamento_id = v_aloj_rosa_id
     AND h.numero_cama = t.leito_antigo
     AND h.tipo_cama = t.tipo_cama
     AND h.status IN ('confirmada', 'checkin_realizado', 'checkout_realizado');

  IF v_total_estado_original <> 70 THEN
    RAISE EXCEPTION 'Abortado por inconsistência de estado: Os participantes não estão nem no estado original completo (% de 70) nem no estado final reconciliado (% de 70).', 
      v_total_estado_original, v_total_estado_final;
  END IF;

  -- 5. VALIDAÇÃO DE CONDIÇÕES PRÉ-EXECUÇÃO
  SELECT count(*) INTO v_total_rosa_inicial
    FROM public.evento_hospedagens h
    JOIN public.evento_inscricoes i ON i.id = h.inscricao_id
   WHERE h.evento_id = p_evento_id
     AND h.alojamento_id = v_aloj_rosa_id
     AND h.status IN ('confirmada', 'checkin_realizado', 'checkout_realizado')
     AND i.status_pagamento IN ('pago', 'isento');

  IF v_total_rosa_inicial <> 70 THEN
    RAISE EXCEPTION 'Abortado: O Alojamento Rosa possui % participantes ativos/pagos, esperado exatamente 70.', v_total_rosa_inicial;
  END IF;

  SELECT count(*) INTO v_total_azul_inicial
    FROM public.evento_hospedagens h
    JOIN public.evento_inscricoes i ON i.id = h.inscricao_id
   WHERE h.evento_id = p_evento_id
     AND h.alojamento_id = v_aloj_azul_id
     AND h.status IN ('confirmada', 'checkin_realizado', 'checkout_realizado')
     AND i.status_pagamento IN ('pago', 'isento');

  IF v_total_azul_inicial <> 173 THEN
    RAISE EXCEPTION 'Abortado: O Alojamento Azul possui % participantes ativos/pagos, esperado exatamente 173.', v_total_azul_inicial;
  END IF;

  IF (
    SELECT count(*)
      FROM tmp_participantes_esperados t
      JOIN public.evento_hospedagens h 
        ON h.id = t.hospedagem_id 
       AND h.evento_id = p_evento_id
       AND h.alojamento_id = v_aloj_rosa_id
       AND h.numero_cama = t.leito_antigo
       AND h.tipo_cama = t.tipo_cama
       AND h.status IN ('confirmada', 'checkin_realizado', 'checkout_realizado')
      JOIN public.evento_inscricoes i 
        ON i.id = t.inscricao_id 
       AND i.id = h.inscricao_id
       AND i.status_pagamento IN ('pago', 'isento')
  ) <> 70 THEN
    RAISE EXCEPTION 'Abortado: Inconsistência nos pré-requisitos dos 70 participantes (hospedagem_id, inscricao_id, alojamento Rosa, leito_antigo, tipo_cama ou pagamento).';
  END IF;

  FOR v_leito_conflito IN
    SELECT l.numero
      FROM public.evento_hospedagem_leitos l
      JOIN tmp_participantes_esperados t ON t.alojamento_destino = 'azul' AND t.leito_novo = l.numero
     WHERE l.evento_id = p_evento_id
       AND l.alojamento_id = v_aloj_azul_id
       AND l.ocupado = true
  LOOP
    RAISE EXCEPTION 'Conflito de concorrência no Azul: Leito % já se encontra ocupado.', v_leito_conflito.numero;
  END LOOP;

  -- 6. EXECUÇÃO ATÔMICA DA RENUMERAÇÃO, TRANSFERÊNCIA E INVENTÁRIO DO ROSA
  -- 6.1 Limpa todos os leitos físicos anteriores do Rosa para reconstrução limpa e sem colisões
  DELETE FROM public.evento_hospedagem_leitos
   WHERE evento_id = p_evento_id
     AND alojamento_id = v_aloj_rosa_id;

  -- 6.2 Materializa rigorosamente as 124 posições físicas oficiais do Rosa (001 a 124) inicialmente desocupadas
  -- 42 superiores (ímpares 001-083), 42 inferiores (pares 002-084) e 40 colchões (085-124)
  INSERT INTO public.evento_hospedagem_leitos (
    evento_id, alojamento_id, inscricao_id, numero, tipo_leito, posicao, ocupado
  )
  SELECT
    p_evento_id,
    v_aloj_rosa_id,
    null,
    lpad(g.i::text, 3, '0'),
    CASE WHEN g.i >= 85 THEN 'colchonete' ELSE 'beliche' END,
    CASE WHEN g.i >= 85 THEN 'unico'
         WHEN g.i % 2 <> 0 THEN 'superior'
         ELSE 'inferior'
    END,
    false
  FROM generate_series(1, 124) AS g(i);

  -- 6.3 Atribui as 65 ocupações do Rosa aos leitos físicos oficiais correspondentes
  WITH up_leitos_rosa AS (
    UPDATE public.evento_hospedagem_leitos l
       SET ocupado      = true,
           inscricao_id = t.inscricao_id,
           posicao      = t.tipo_cama,
           tipo_leito   = 'beliche'
      FROM tmp_participantes_esperados t
     WHERE l.evento_id = p_evento_id
       AND l.alojamento_id = v_aloj_rosa_id
       AND l.numero = t.leito_novo
       AND t.alojamento_destino = 'rosa'
     RETURNING l.id
  )
  SELECT count(*) INTO v_count_renumerados FROM up_leitos_rosa;

  IF v_count_renumerados <> 65 THEN
    RAISE EXCEPTION 'Erro de integridade: Esperava vincular 65 leitos no Rosa, atualizados: %.', v_count_renumerados;
  END IF;

  -- 6.4 Atualiza as 65 hospedagens do Rosa com os números de cama oficiais
  UPDATE public.evento_hospedagens h
     SET numero_cama = t.leito_novo,
         tipo_cama   = t.tipo_cama
    FROM tmp_participantes_esperados t
   WHERE h.id = t.hospedagem_id
     AND h.evento_id = p_evento_id
     AND t.alojamento_destino = 'rosa';

  -- 6.5 Registra ocorrências de auditoria para renumeração no Rosa
  INSERT INTO public.evento_hospedagem_ocorrencias (
    evento_id, hospedagem_id, inscricao_id, tipo, descricao
  )
  SELECT
    p_evento_id,
    t.hospedagem_id,
    t.inscricao_id,
    'mudanca_leito',
    'Padronização oficial da 126 AGO no Alojamento Rosa. De: ' || t.leito_antigo || ' -> Para: ' || t.leito_novo || ' (' || t.tipo_cama || ')'
  FROM tmp_participantes_esperados t
  WHERE t.alojamento_destino = 'rosa'
    AND t.leito_antigo <> t.leito_novo;

  -- 6.6 Remove eventuais registros desocupados pré-existentes no Azul para os 5 leitos (177, 179, 181, 183, 185)
  DELETE FROM public.evento_hospedagem_leitos l
   USING tmp_participantes_esperados t
   WHERE l.evento_id = p_evento_id
     AND l.alojamento_id = v_aloj_azul_id
     AND l.numero = t.leito_novo
     AND l.ocupado = false
     AND t.alojamento_destino = 'azul';

  -- 6.7 Insere os 5 leitos ocupados de destino no Azul para as 5 participantes transferidas
  WITH ins_azul AS (
    INSERT INTO public.evento_hospedagem_leitos (
      evento_id, alojamento_id, inscricao_id, numero, tipo_leito, posicao, ocupado
    )
    SELECT
      p_evento_id, v_aloj_azul_id, t.inscricao_id, t.leito_novo, 'beliche', 'superior', true
    FROM tmp_participantes_esperados t
    WHERE t.alojamento_destino = 'azul'
    RETURNING id
  )
  SELECT count(*) INTO v_count_leitos_azul FROM ins_azul;

  IF v_count_leitos_azul <> 5 THEN
    RAISE EXCEPTION 'Falha de integridade/concorrência no Azul: Esperava alocar exatamente 5 leitos físicos, afetados: %.', v_count_leitos_azul;
  END IF;

  -- 6.8 Atualiza as 5 hospedagens para o Alojamento Azul
  WITH up_azul_hosp AS (
    UPDATE public.evento_hospedagens h
       SET alojamento_id = v_aloj_azul_id,
           numero_cama   = t.leito_novo,
           tipo_cama     = 'superior'
      FROM tmp_participantes_esperados t
     WHERE h.id = t.hospedagem_id
       AND h.evento_id = p_evento_id
       AND t.alojamento_destino = 'azul'
     RETURNING h.id
  )
  SELECT count(*) INTO v_count_transferidos FROM up_azul_hosp;

  IF v_count_transferidos <> 5 THEN
    RAISE EXCEPTION 'Erro de atualização: Esperava transferir 5 participantes para o Azul, atualizados: %.', v_count_transferidos;
  END IF;

  -- 6.9 Registra ocorrências de auditoria para as 5 transferências Rosa -> Azul
  INSERT INTO public.evento_hospedagem_ocorrencias (
    evento_id, hospedagem_id, inscricao_id, tipo, descricao
  )
  SELECT
    p_evento_id,
    t.hospedagem_id,
    t.inscricao_id,
    'mudanca_alojamento',
    'Transferência oficial Rosa -> Azul por rebalanceamento de capacidade. De: Rosa (' || t.leito_antigo || ') -> Para: Azul (' || t.leito_novo || ')'
  FROM tmp_participantes_esperados t
  WHERE t.alojamento_destino = 'azul';

  -- 7. VALIDAÇÃO DE CONSISTÊNCIA FINAL
  -- 7.1 Maria Cremilda deve estar rigorosamente no leito 046 inferior
  IF NOT EXISTS (
    SELECT 1 FROM public.evento_hospedagens h
      JOIN public.evento_inscricoes i ON i.id = h.inscricao_id
     WHERE h.evento_id = p_evento_id
       AND i.cpf = '64153649287'
       AND h.numero_cama = '046'
       AND h.tipo_cama = 'inferior'
       AND h.alojamento_id = v_aloj_rosa_id
       AND h.status IN ('confirmada', 'checkin_realizado', 'checkout_realizado')
  ) THEN
    RAISE EXCEPTION 'Erro de integridade: Maria Cremilda não está alocada no leito 046 inferior.';
  END IF;

  -- 7.2 Janara permanece rigorosamente no leito 175 superior do Azul
  IF NOT EXISTS (
    SELECT 1 FROM public.evento_hospedagens h
      JOIN public.evento_inscricoes i ON i.id = h.inscricao_id
     WHERE h.evento_id = p_evento_id
       AND i.cpf = '02672207232'
       AND h.numero_cama = '175'
       AND h.tipo_cama = 'superior'
       AND h.alojamento_id = v_aloj_azul_id
       AND h.status IN ('confirmada', 'checkin_realizado', 'checkout_realizado')
  ) THEN
    RAISE EXCEPTION 'Erro de integridade: Janara não está preservada no leito 175 do Azul.';
  END IF;

  -- 7.3 Ocupação final do Rosa deve ser rigorosamente 65
  SELECT count(*) INTO v_total_rosa_final
    FROM public.evento_hospedagens
   WHERE evento_id = p_evento_id 
     AND alojamento_id = v_aloj_rosa_id 
     AND status IN ('confirmada', 'checkin_realizado', 'checkout_realizado');

  IF v_total_rosa_final <> 65 THEN
    RAISE EXCEPTION 'Erro de integridade: Ocupação final do Rosa (%) difere de 65.', v_total_rosa_final;
  END IF;

  -- 7.4 Ocupação final do Azul deve ser rigorosamente 178 (173 iniciais + 5 transferidas)
  SELECT count(*) INTO v_total_azul_final
    FROM public.evento_hospedagens
   WHERE evento_id = p_evento_id 
     AND alojamento_id = v_aloj_azul_id 
     AND status IN ('confirmada', 'checkin_realizado', 'checkout_realizado');

  IF v_total_azul_final <> 178 THEN
    RAISE EXCEPTION 'Erro de integridade: Ocupação final do Azul (%) difere de 178.', v_total_azul_final;
  END IF;

  -- 7.5 Validação do inventário físico completo do Rosa: exatamente 124 posições (65 ocupadas e 59 livres)
  SELECT count(*) INTO v_rosa_total_leitos
    FROM public.evento_hospedagem_leitos
   WHERE evento_id = p_evento_id AND alojamento_id = v_aloj_rosa_id;

  IF v_rosa_total_leitos <> 124 THEN
    RAISE EXCEPTION 'Erro de integridade: O total de leitos físicos no Rosa (%) difere de 124.', v_rosa_total_leitos;
  END IF;

  SELECT count(*) INTO v_rosa_leitos_ocupados
    FROM public.evento_hospedagem_leitos
   WHERE evento_id = p_evento_id AND alojamento_id = v_aloj_rosa_id AND ocupado = true;

  IF v_rosa_leitos_ocupados <> 65 THEN
    RAISE EXCEPTION 'Erro de integridade: O total de leitos físicos ocupados no Rosa (%) difere de 65.', v_rosa_leitos_ocupados;
  END IF;

  SELECT count(*) INTO v_rosa_leitos_livres
    FROM public.evento_hospedagem_leitos
   WHERE evento_id = p_evento_id AND alojamento_id = v_aloj_rosa_id AND ocupado = false;

  IF v_rosa_leitos_livres <> 59 THEN
    RAISE EXCEPTION 'Erro de integridade: O total de leitos físicos livres no Rosa (%) difere de 59 vagas.', v_rosa_leitos_livres;
  END IF;

  SELECT count(*) INTO v_rosa_superiores_totais
    FROM public.evento_hospedagem_leitos
   WHERE evento_id = p_evento_id AND alojamento_id = v_aloj_rosa_id AND posicao = 'superior';

  IF v_rosa_superiores_totais <> 42 THEN
    RAISE EXCEPTION 'Erro de integridade: O total de posições superiores no Rosa (%) difere de 42.', v_rosa_superiores_totais;
  END IF;

  SELECT count(*) INTO v_rosa_inferiores_totais
    FROM public.evento_hospedagem_leitos
   WHERE evento_id = p_evento_id AND alojamento_id = v_aloj_rosa_id AND posicao = 'inferior';

  IF v_rosa_inferiores_totais <> 42 THEN
    RAISE EXCEPTION 'Erro de integridade: O total de posições inferiores no Rosa (%) difere de 42.', v_rosa_inferiores_totais;
  END IF;

  SELECT count(*) INTO v_rosa_colchoes_totais
    FROM public.evento_hospedagem_leitos
   WHERE evento_id = p_evento_id AND alojamento_id = v_aloj_rosa_id AND tipo_leito = 'colchonete';

  IF v_rosa_colchoes_totais <> 40 THEN
    RAISE EXCEPTION 'Erro de integridade: O total de colchões no Rosa (%) difere de 40.', v_rosa_colchoes_totais;
  END IF;

  -- 7.6 Confere contagem física de leitos ocupados no Azul (exatamente 178)
  IF (
    SELECT count(*) FROM public.evento_hospedagem_leitos
     WHERE evento_id = p_evento_id AND alojamento_id = v_aloj_azul_id AND ocupado = true
       AND inscricao_id IS NOT NULL
  ) <> 178 THEN
    RAISE EXCEPTION 'Erro de integridade: Total de leitos físicos ocupados com participante no Azul difere de 178.';
  END IF;

  v_res_json := jsonb_build_object(
    'sucesso', true,
    'evento_id', p_evento_id,
    'transferidos_azul', 5,
    'renumerados_rosa', 65,
    'total_final_rosa_ocupados', v_total_rosa_final,
    'total_final_rosa_vagas_livres', v_rosa_leitos_livres,
    'total_inventario_rosa', v_rosa_total_leitos,
    'total_final_azul_ocupados', v_total_azul_final,
    'data_execucao', now()
  );

  RETURN v_res_json;

EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Transação abortada. Nenhum dado foi modificado. Erro: %', SQLERRM;
END;
$$;

REVOKE ALL ON FUNCTION public.executar_reconciliacao_oficial_rosa_azul(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.executar_reconciliacao_oficial_rosa_azul(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.executar_reconciliacao_oficial_rosa_azul(UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.executar_reconciliacao_oficial_rosa_azul(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.executar_reconciliacao_oficial_rosa_azul(UUID) TO postgres;

-- Execução da rotina (Comente se desejar apenas compilar a função)
SELECT public.executar_reconciliacao_oficial_rosa_azul();
