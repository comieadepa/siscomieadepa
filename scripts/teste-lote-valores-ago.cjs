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

function genCpfBase9(seed) {
  const out = [];
  let n = seed;
  for (let i = 0; i < 9; i++) {
    n = (n * 9301 + 49297) % 233280;
    out.push(n % 10);
  }
  return out;
}

function calcDv(nums) {
  const soma1 = nums.reduce((acc, d, i) => acc + d * (10 - i), 0);
  let dv1 = (soma1 * 10) % 11;
  if (dv1 === 10) dv1 = 0;
  const soma2 = [...nums, dv1].reduce((acc, d, i) => acc + d * (11 - i), 0);
  let dv2 = (soma2 * 10) % 11;
  if (dv2 === 10) dv2 = 0;
  return [dv1, dv2];
}

function gerarCpf(seed) {
  const b9 = genCpfBase9(seed);
  const [d1, d2] = calcDv(b9);
  return [...b9, d1, d2].join('');
}

function findTipoName(tipos, regex, fallback = null) {
  const found = tipos.find(t => regex.test(norm(t.nome)));
  return found ? found.nome : fallback;
}

async function runScenario(sb, ctx, scenario) {
  const { slug, supervisao_id, campo_id, campo_missionario_id, tipos } = ctx;
  const now = Date.now();
  const titularCpf = gerarCpf(now % 100000 + scenario.seed);
  const extraCpf = gerarCpf((now % 100000) + scenario.seed + 999);

  const titularTipo = scenario.titularTipo(tipos);
  const extraTipo = scenario.extraTipo(tipos);
  if (!titularTipo || !extraTipo) {
    return {
      nome: scenario.nome,
      status: 'skipped',
      motivo: 'Tipos obrigatórios não encontrados no evento.',
    };
  }

  const titularCampo = scenario.usarCampoMissionario ? (campo_missionario_id || campo_id) : campo_id;
  const extraCampo = scenario.usarCampoMissionario ? (campo_missionario_id || campo_id) : campo_id;

  const payload = {
    slug,
    nome_inscrito: `[TESTE_LOTE_VALOR] ${scenario.nome} TITULAR`,
    cpf: titularCpf,
    email: `teste.${scenario.seed}.${now}@mail.test`,
    whatsapp: '91999990000',
    sexo: scenario.titularSexo || 'M',
    data_nascimento: scenario.titularNascimento || '1980-01-01',
    supervisao_id,
    campo_id: titularCampo,
    tipo_inscricao: titularTipo,
    hospedagem: !!scenario.titularHospedagem,
    participantes: [
      {
        nome_inscrito: `[TESTE_LOTE_VALOR] ${scenario.nome} EXTRA`,
        cpf: extraCpf,
        email: `teste.extra.${scenario.seed}.${now}@mail.test`,
        whatsapp: '91999990001',
        sexo: scenario.extraSexo || 'F',
        data_nascimento: scenario.extraNascimento || '1982-02-02',
        supervisao_id,
        campo_id: extraCampo,
        tipo_inscricao: extraTipo,
        hospedagem: !!scenario.extraHospedagem,
      },
    ],
  };

  const resp = await fetch(`${APP_URL}/api/eventos/inscricao`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const json = await resp.json().catch(() => ({}));

  if (!resp.ok || !json.loteId) {
    return {
      nome: scenario.nome,
      status: 'error',
      http: resp.status,
      payload_enviado: {
        titular_tipo: titularTipo,
        extra_tipo: extraTipo,
      },
      resposta: json,
    };
  }

  const { data: rows, error: rowsErr } = await sb
    .from('evento_inscricoes')
    .select('nome_inscrito,tipo_inscricao,valor_original,desconto_valor,valor_final,lote_id')
    .eq('lote_id', json.loteId)
    .order('created_at', { ascending: true });

  if (rowsErr) {
    return {
      nome: scenario.nome,
      status: 'error',
      http: resp.status,
      loteId: json.loteId,
      resposta: json,
      erro_consulta: rowsErr.message,
    };
  }

  const byTipo = new Map((rows || []).map(r => [r.tipo_inscricao, r]));
  const titularRow = byTipo.get(titularTipo) || null;
  const extraRow = byTipo.get(extraTipo) || null;
  const totalCalculado = (rows || []).reduce((acc, r) => acc + Number(r.valor_final || 0), 0);

  return {
    nome: scenario.nome,
    status: 'ok',
    loteId: json.loteId,
    payload_antes: {
      titular_tipo: titularTipo,
      extra_tipo: extraTipo,
      total_visual_enviado: null,
    },
    payload_depois: {
      registros: rows,
      total_lote_calculado: totalCalculado,
      titular_valor: titularRow ? Number(titularRow.valor_final || 0) : null,
      extra_valor: extraRow ? Number(extraRow.valor_final || 0) : null,
    },
    resposta_api: {
      status: resp.status,
      pagamento: json.pagamento || null,
      asaasError: json.asaasError || null,
    },
  };
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
    .select('id,slug')
    .eq('id', EVENTO_ID)
    .single();
  if (evErr || !evento) throw new Error(`Evento não encontrado: ${evErr?.message || 'n/a'}`);

  const { data: ref, error: refErr } = await sb
    .from('evento_inscricoes')
    .select('supervisao_id,campo_id')
    .eq('evento_id', EVENTO_ID)
    .not('supervisao_id', 'is', null)
    .not('campo_id', 'is', null)
    .limit(1)
    .maybeSingle();
  if (refErr || !ref) throw new Error(`Sem supervisão/campo de referência: ${refErr?.message || 'n/a'}`);

  const { data: cm } = await sb
    .from('campos')
    .select('id')
    .eq('is_campo_missionario', true)
    .limit(1)
    .maybeSingle();

  const { data: tipos, error: tiposErr } = await sb
    .from('evento_tipos_inscricao')
    .select('nome,valor')
    .eq('evento_id', EVENTO_ID)
    .eq('ativo', true);
  if (tiposErr || !tipos || tipos.length === 0) throw new Error(`Sem tipos de inscrição ativos: ${tiposErr?.message || 'n/a'}`);

  const scenarios = [
    {
      nome: 'CENARIO_A_PP_ESPOSA_PP',
      seed: 11,
      usarCampoMissionario: false,
      titularSexo: 'M',
      extraSexo: 'F',
      titularTipo: (ts) => findTipoName(ts, /pastor presidente$/),
      extraTipo: (ts) => findTipoName(ts, /esposa de pastor presidente/),
    },
    {
      nome: 'CENARIO_B_PA_ESPOSA_PA',
      seed: 22,
      usarCampoMissionario: false,
      titularSexo: 'M',
      extraSexo: 'F',
      titularTipo: (ts) => findTipoName(ts, /pastor auxiliar/),
      extraTipo: (ts) => findTipoName(ts, /esposa de pastor auxiliar/),
    },
    {
      nome: 'CENARIO_C_PP_CM_ESPOSA_CM',
      seed: 33,
      usarCampoMissionario: true,
      titularSexo: 'M',
      extraSexo: 'F',
      titularTipo: (ts) => findTipoName(ts, /pastor presidente/),
      extraTipo: (ts) => findTipoName(ts, /esposa de pastor presidente/),
    },
    {
      nome: 'CENARIO_D_RESP_VISITANTE',
      seed: 44,
      usarCampoMissionario: false,
      titularSexo: 'M',
      extraSexo: 'F',
      titularTipo: (ts) => findTipoName(ts, /pastor auxiliar|pastor presidente|jovem|juventude/),
      extraTipo: (ts) => findTipoName(ts, /visitante/),
    },
  ];

  const ctx = {
    slug: evento.slug,
    supervisao_id: ref.supervisao_id,
    campo_id: ref.campo_id,
    campo_missionario_id: cm?.id || null,
    tipos,
  };

  const resultados = [];
  for (const sc of scenarios) {
    const r = await runScenario(sb, ctx, sc);
    resultados.push(r);
  }

  console.log(JSON.stringify({
    evento_id: EVENTO_ID,
    app_url: APP_URL,
    tipos_disponiveis: tipos.map(t => ({ nome: t.nome, valor: t.valor })),
    resultados,
  }, null, 2));
}

main().catch((e) => {
  console.error('ERRO_TESTE_LOTE_VALORES_AGO:', e.message);
  process.exit(1);
});
