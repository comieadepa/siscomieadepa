const dotenv = require('dotenv');
dotenv.config({ path: '.env.local', quiet: true });

const { createClient } = require('@supabase/supabase-js');

const APP_URL = process.env.CARGA_APP_URL || 'http://localhost:3001';
const EVENTO_ID = process.env.CARGA_EVENTO_ID || '8940f4e1-f00b-4115-a4f5-0e912332174c';

function norm(v) {
  return String(v || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function findTipoName(tipos, regex, fallback = null) {
  const found = tipos.find((t) => regex.test(norm(t.nome)));
  return found ? found.nome : fallback;
}

function extractCampoMissionarioConfig(conf) {
  if (!conf || typeof conf !== 'object') {
    return { enabled: false, valor_pastor_presidente: 0, valor_esposa: 0 };
  }

  const cm = conf.campo_missionario && typeof conf.campo_missionario === 'object'
    ? conf.campo_missionario
    : null;

  if (cm) {
    return {
      enabled: !!cm.enabled,
      valor_pastor_presidente: Number(cm.valor_pastor_presidente || 0),
      valor_esposa: Number(cm.valor_esposa || 0),
    };
  }

  return {
    enabled: !!conf.habilitar_desconto_campo_missionario,
    valor_pastor_presidente: Number(conf.valor_pastor_presidente_campo_missionario || 0),
    valor_esposa: Number(conf.valor_esposa_campo_missionario || 0),
  };
}

async function postInscricao(payload) {
  const resp = await fetch(`${APP_URL}/api/eventos/inscricao`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const json = await resp.json().catch(() => ({}));
  return { status: resp.status, body: json };
}

async function carregarInscricoesPorLote(sb, loteId) {
  const { data, error } = await sb
    .from('evento_inscricoes')
    .select('id,nome_inscrito,tipo_inscricao,valor_original,valor_final,alimentacao,quantidade_refeicoes_total,lote_id')
    .eq('lote_id', loteId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return data || [];
}

async function carregarInscricaoPorNome(sb, eventoId, nome) {
  const { data, error } = await sb
    .from('evento_inscricoes')
    .select('id,nome_inscrito,tipo_inscricao,valor_original,valor_final,alimentacao,quantidade_refeicoes_total,lote_id')
    .eq('evento_id', eventoId)
    .eq('nome_inscrito', nome)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data || null;
}

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios.');
  }

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: evento, error: evErr } = await sb
    .from('eventos')
    .select('id,slug,inscricoes_abertas,configuracoes_ago')
    .eq('id', EVENTO_ID)
    .single();
  if (evErr || !evento) throw new Error(`Evento não encontrado: ${evErr?.message || 'n/a'}`);

  const cmConf = extractCampoMissionarioConfig(evento.configuracoes_ago || {});
  if (!cmConf.enabled) {
    throw new Error('Configuração de Campo Missionário está desabilitada para este evento.');
  }

  const { data: tipos, error: tiposErr } = await sb
    .from('evento_tipos_inscricao')
    .select('nome,valor')
    .eq('evento_id', EVENTO_ID)
    .eq('ativo', true);
  if (tiposErr || !tipos || tipos.length === 0) throw new Error(`Sem tipos ativos: ${tiposErr?.message || 'n/a'}`);

  const tipoPP = findTipoName(tipos, /pastor presidente/);
  const tipoEsposaPP = findTipoName(tipos, /esposa de pastor presidente/);
  const tipoVisitante = findTipoName(tipos, /visitante/);
  const tipoExtraDiferente = findTipoName(tipos, /esposa de pastor auxiliar|juventude|visitante/);

  if (!tipoPP || !tipoEsposaPP || !tipoVisitante || !tipoExtraDiferente) {
    throw new Error('Tipos necessários para os testes não encontrados no evento.');
  }

  const { data: membrosPP, error: memErr } = await sb
    .from('members')
    .select('id,name,cpf,status,pastor_presidente,pastor_auxiliar,jubilado,supervisao_id')
    .eq('pastor_presidente', true)
    .not('cpf', 'is', null)
    .limit(300);
  if (memErr) throw new Error(`Erro consultando membros: ${memErr.message}`);

  const { data: campos, error: camposErr } = await sb
    .from('campos')
    .select('id,is_campo_missionario')
    .limit(5000);
  if (camposErr) throw new Error(`Erro consultando campos: ${camposErr.message}`);

  const campoMap = new Map((campos || []).map((c) => [c.id, !!c.is_campo_missionario]));

  const ativo = (m) => {
    const s = String(m.status || '').toLowerCase();
    return s === 'active' || s === 'ativo';
  };

  const cpfDigits = (v) => String(v || '').replace(/\D/g, '');
  const membroPorCpf = (cpf, lista) => {
    const alvo = cpfDigits(cpf);
    if (!alvo) return null;
    return (lista || []).find((m) => cpfDigits(m.cpf) === alvo) || null;
  };

  const { data: candidatosInsc, error: candErr } = await sb
    .from('evento_inscricoes')
    .select('cpf,campo_id,supervisao_id')
    .eq('evento_id', EVENTO_ID)
    .not('cpf', 'is', null)
    .not('campo_id', 'is', null)
    .not('supervisao_id', 'is', null)
    .limit(500);
  if (candErr) throw new Error(`Erro consultando inscrições para candidatos: ${candErr.message}`);

  const combinados = [];
  for (const c of candidatosInsc || []) {
    const m = membroPorCpf(c.cpf, membrosPP || []);
    if (!m || !ativo(m)) continue;
    combinados.push({
      ...m,
      campo_id: c.campo_id,
      supervisao_id: c.supervisao_id || m.supervisao_id || null,
      is_campo_missionario: !!campoMap.get(c.campo_id),
    });
  }

  let pastorCM = combinados.find((m) => m.is_campo_missionario === true) || null;
  let pastorComum = combinados.find((m) => m.is_campo_missionario === false) || null;

  let membroPromovidoTemp = null;
  if (!pastorCM && !pastorComum) {
    const { data: membrosAtivos, error: memAtErr } = await sb
      .from('members')
      .select('id,name,cpf,status,pastor_presidente,pastor_auxiliar,jubilado,supervisao_id')
      .not('cpf', 'is', null)
      .limit(400);
    if (memAtErr) throw new Error(`Erro consultando membros ativos para fallback: ${memAtErr.message}`);

    const candidatoInsc = (candidatosInsc || []).find((c) => {
      const mem = membroPorCpf(c.cpf, membrosAtivos || []);
      return !!mem && ativo(mem);
    }) || null;
    const candidato = candidatoInsc ? membroPorCpf(candidatoInsc.cpf, membrosAtivos || []) : null;
    if (!candidato) {
      throw new Error('Não foi encontrado ministro ativo para fallback dos testes.');
    }

    membroPromovidoTemp = {
      id: candidato.id,
      pastor_presidente: !!candidato.pastor_presidente,
      pastor_auxiliar: !!candidato.pastor_auxiliar,
      jubilado: !!candidato.jubilado,
    };

    const { error: upMemErr } = await sb
      .from('members')
      .update({ pastor_presidente: true })
      .eq('id', candidato.id);
    if (upMemErr) throw new Error(`Falha ao promover membro para Pastor Presidente temporário: ${upMemErr.message}`);

    const inscDoCandidato = (candidatosInsc || []).find((c) => cpfDigits(c.cpf) === cpfDigits(candidato.cpf));
    if (!inscDoCandidato) throw new Error('Não foi possível localizar campo do membro promovido temporariamente.');

    pastorComum = {
      ...candidato,
      campo_id: inscDoCandidato.campo_id,
      supervisao_id: inscDoCandidato.supervisao_id || candidato.supervisao_id || null,
      is_campo_missionario: !!campoMap.get(inscDoCandidato.campo_id),
    };
  }

  let campoCmTemporarioId = null;
  let campoCmTemporarioOriginal = null;

  if (!pastorCM) {
    if (!pastorComum) {
      throw new Error('Não foi encontrado Pastor Presidente ativo para os testes.');
    }
    campoCmTemporarioId = pastorComum.campo_id;
    campoCmTemporarioOriginal = !!campoMap.get(campoCmTemporarioId);
    const { error: upCampoErr } = await sb
      .from('campos')
      .update({ is_campo_missionario: true })
      .eq('id', campoCmTemporarioId);
    if (upCampoErr) throw new Error(`Falha ao preparar campo missionário temporário: ${upCampoErr.message}`);

    pastorCM = { ...pastorComum, is_campo_missionario: true };
  }

  if (!pastorComum) {
    pastorComum = combinados.find((m) => m.id !== pastorCM.id) || null;
  }

  if (!pastorComum) {
    // Se só existe um candidato, ele será usado no fluxo comum após restaurar o campo.
    pastorComum = { ...pastorCM };
  }

  const estadoOriginalInscricoesAbertas = !!evento.inscricoes_abertas;
  if (!estadoOriginalInscricoesAbertas) {
    const { error: upOpenErr } = await sb.from('eventos').update({ inscricoes_abertas: true }).eq('id', EVENTO_ID);
    if (upOpenErr) throw new Error(`Falha ao abrir inscrições para teste: ${upOpenErr.message}`);
  }

  const ts = Date.now();
  const resultados = [];

  try {
    const nomeA = `[TESTE_CM] A_SOZINHO_${ts}`;
    const payloadA = {
      slug: evento.slug,
      nome_inscrito: nomeA,
      cpf: String(pastorCM.cpf),
      sexo: 'M',
      data_nascimento: '1980-01-01',
      supervisao_id: pastorCM.supervisao_id,
      campo_id: pastorCM.campo_id,
      tipo_inscricao: tipoPP,
      hospedagem: false,
      participantes: [],
    };
    const respA = await postInscricao(payloadA);
    const rowA = await carregarInscricaoPorNome(sb, EVENTO_ID, nomeA);
    resultados.push({
      teste: 'A',
      descricao: 'Pastor Presidente CM sozinho',
      status_http: respA.status,
      esperado_total: cmConf.valor_pastor_presidente,
      valor_salvo: rowA ? Number(rowA.valor_final || 0) : null,
      passou: respA.status === 200 && rowA && Number(rowA.valor_final || 0) === Number(cmConf.valor_pastor_presidente || 0),
      resposta: respA.body,
    });

    const nomeB = `[TESTE_CM] B_CASAL_${ts}`;
    const payloadB = {
      slug: evento.slug,
      nome_inscrito: nomeB,
      cpf: String(pastorCM.cpf),
      sexo: 'M',
      data_nascimento: '1980-01-01',
      supervisao_id: pastorCM.supervisao_id,
      campo_id: pastorCM.campo_id,
      tipo_inscricao: tipoPP,
      hospedagem: false,
      incluir_esposa: true,
      esposa: {
        nome_inscrito: `${nomeB}_ESPOSA`,
        cpf: null,
        sexo: 'F',
        data_nascimento: '1982-02-02',
        whatsapp: null,
        tipo_inscricao: 'Esposa de Pastor Presidente Campo Missionário',
        hospedagem: false,
      },
    };
    const respB = await postInscricao(payloadB);
    const loteB = respB.body?.loteId || null;
    const rowsB = loteB ? await carregarInscricoesPorLote(sb, loteB) : [];
    const totalB = rowsB.reduce((acc, r) => acc + Number(r.valor_final || 0), 0);
    resultados.push({
      teste: 'B',
      descricao: 'Pastor Presidente CM + esposa',
      status_http: respB.status,
      esperado_total: Number(cmConf.valor_pastor_presidente || 0) + Number(cmConf.valor_esposa || 0),
      total_lote: totalB,
      qtd_inscricoes_lote: rowsB.length,
      passou: respB.status === 200 && rowsB.length === 2 && totalB === (Number(cmConf.valor_pastor_presidente || 0) + Number(cmConf.valor_esposa || 0)),
      resposta: respB.body,
    });

    const nomeC = `[TESTE_CM] C_TERCEIRO_${ts}`;
    const payloadC = {
      slug: evento.slug,
      nome_inscrito: nomeC,
      cpf: String(pastorCM.cpf),
      sexo: 'M',
      data_nascimento: '1980-01-01',
      supervisao_id: pastorCM.supervisao_id,
      campo_id: pastorCM.campo_id,
      tipo_inscricao: tipoPP,
      hospedagem: false,
      participantes: [
        {
          nome_inscrito: `${nomeC}_EXTRA_1`,
          cpf: null,
          sexo: 'F',
          data_nascimento: '1988-08-08',
          supervisao_id: pastorCM.supervisao_id,
          campo_id: pastorCM.campo_id,
          tipo_inscricao: tipoVisitante,
          hospedagem: false,
        },
      ],
    };
    const respC = await postInscricao(payloadC);
    resultados.push({
      teste: 'C',
      descricao: 'Pastor Presidente CM tentando adicionar terceiro participante',
      status_http: respC.status,
      erro: respC.body?.error || null,
      passou: respC.status === 400 && respC.body?.error === 'Campo Missionário permite inscrição apenas do Pastor Presidente e, opcionalmente, sua esposa.',
      resposta: respC.body,
    });

    if (campoCmTemporarioId) {
      await sb
        .from('campos')
        .update({ is_campo_missionario: campoCmTemporarioOriginal })
        .eq('id', campoCmTemporarioId);
      pastorComum = { ...pastorComum, campo_id: campoCmTemporarioId, is_campo_missionario: !!campoCmTemporarioOriginal };
    }

    const nomeD = `[TESTE_CM] D_COMUM_${ts}`;
    const payloadD = {
      slug: evento.slug,
      nome_inscrito: nomeD,
      cpf: String(pastorComum.cpf),
      sexo: 'M',
      data_nascimento: '1980-01-01',
      supervisao_id: pastorComum.supervisao_id,
      campo_id: pastorComum.campo_id,
      tipo_inscricao: tipoPP,
      hospedagem: false,
      participantes: [
        {
          nome_inscrito: `${nomeD}_EXTRA_1`,
          cpf: null,
          sexo: 'F',
          data_nascimento: '1988-08-08',
          supervisao_id: pastorComum.supervisao_id,
          campo_id: pastorComum.campo_id,
          tipo_inscricao: tipoVisitante,
          hospedagem: false,
        },
      ],
    };
    const respD = await postInscricao(payloadD);
    const loteD = respD.body?.loteId || null;
    const rowsD = loteD ? await carregarInscricoesPorLote(sb, loteD) : [];
    resultados.push({
      teste: 'D',
      descricao: 'Pastor Presidente comum segue fluxo normal',
      status_http: respD.status,
      qtd_inscricoes_lote: rowsD.length,
      passou: respD.status === 200 && !!loteD && rowsD.length === 2,
      resposta: respD.body,
    });

    const nomeE = `[TESTE_CM] E_LOTE_COMUM_${ts}`;
    const payloadE = {
      slug: evento.slug,
      nome_inscrito: nomeE,
      cpf: String(pastorComum.cpf),
      sexo: 'M',
      data_nascimento: '1980-01-01',
      supervisao_id: pastorComum.supervisao_id,
      campo_id: pastorComum.campo_id,
      tipo_inscricao: tipoPP,
      hospedagem: false,
      participantes: [
        {
          nome_inscrito: `${nomeE}_EXTRA_1`,
          cpf: null,
          sexo: 'F',
          data_nascimento: '1988-08-08',
          supervisao_id: pastorComum.supervisao_id,
          campo_id: pastorComum.campo_id,
          tipo_inscricao: tipoEsposaPP,
          hospedagem: false,
        },
        {
          nome_inscrito: `${nomeE}_EXTRA_2`,
          cpf: null,
          sexo: 'F',
          data_nascimento: '1986-06-06',
          supervisao_id: pastorComum.supervisao_id,
          campo_id: pastorComum.campo_id,
          tipo_inscricao: tipoExtraDiferente,
          hospedagem: false,
        },
      ],
    };
    const respE = await postInscricao(payloadE);
    const loteE = respE.body?.loteId || null;
    const rowsE = loteE ? await carregarInscricoesPorLote(sb, loteE) : [];
    const totalE = rowsE.reduce((acc, r) => acc + Number(r.valor_final || 0), 0);
    const esperadoE = rowsE.reduce((acc, r) => acc + Number(r.valor_original || 0), 0);

    resultados.push({
      teste: 'E',
      descricao: 'Lote comum sem Campo Missionário aceita múltiplos e soma valores individuais',
      status_http: respE.status,
      qtd_inscricoes_lote: rowsE.length,
      total_lote: totalE,
      esperado_pela_soma_individual: esperadoE,
      passou: respE.status === 200 && rowsE.length === 3 && totalE === esperadoE,
      resposta: respE.body,
      registros: rowsE,
    });
  } finally {
    if (membroPromovidoTemp) {
      await sb
        .from('members')
        .update({
          pastor_presidente: membroPromovidoTemp.pastor_presidente,
          pastor_auxiliar: membroPromovidoTemp.pastor_auxiliar,
          jubilado: membroPromovidoTemp.jubilado,
        })
        .eq('id', membroPromovidoTemp.id);
    }
    if (campoCmTemporarioId) {
      await sb
        .from('campos')
        .update({ is_campo_missionario: campoCmTemporarioOriginal })
        .eq('id', campoCmTemporarioId);
    }
    if (!estadoOriginalInscricoesAbertas) {
      await sb.from('eventos').update({ inscricoes_abertas: false }).eq('id', EVENTO_ID);
    }
  }

  const aprovados = resultados.filter((r) => !!r.passou).length;
  const reprovados = resultados.length - aprovados;

  console.log(JSON.stringify({
    evento_id: EVENTO_ID,
    app_url: APP_URL,
    configuracao_campo_missionario: cmConf,
    resultados,
    resumo: {
      total_testes: resultados.length,
      aprovados,
      reprovados,
    },
  }, null, 2));
}

main().catch((e) => {
  console.error('ERRO_TESTE_CAMPO_MISSIONARIO_AGO:', e.message);
  process.exit(1);
});
