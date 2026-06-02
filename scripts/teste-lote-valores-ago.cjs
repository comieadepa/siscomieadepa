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
  const titularTipo = scenario.titularTipo(tipos);
  const extras = scenario.extras || [];

  if (!titularTipo) {
    return {
      nome: scenario.nome,
      status: 'skipped',
      motivo: 'Tipo obrigatório do titular não encontrado no evento.',
    };
  }

  const extrasResolvidos = [];
  for (let i = 0; i < extras.length; i++) {
    const ex = extras[i];
    const tipo = ex.omitirTipo ? null : ex.tipo(tipos);
    if (!ex.omitirTipo && !tipo) {
      return {
        nome: scenario.nome,
        status: 'skipped',
        motivo: `Tipo obrigatório do extra ${i + 1} não encontrado no evento.`,
      };
    }
    extrasResolvidos.push({ ...ex, tipo });
  }

  const titularCampo = scenario.usarCampoMissionario ? (campo_missionario_id || campo_id) : campo_id;
  const campoExtraDefault = scenario.usarCampoMissionario ? (campo_missionario_id || campo_id) : campo_id;

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
    participantes: extrasResolvidos.map((ex, idx) => {
      const extraCpf = gerarCpf((now % 100000) + scenario.seed + 999 + idx);
      const out = {
        nome_inscrito: `[TESTE_LOTE_VALOR] ${scenario.nome} EXTRA ${idx + 1}`,
        cpf: extraCpf,
        email: `teste.extra.${scenario.seed}.${idx}.${now}@mail.test`,
        whatsapp: `91999990${String(idx).padStart(3, '0')}`,
        sexo: ex.sexo || 'F',
        data_nascimento: ex.data_nascimento || '1982-02-02',
        supervisao_id,
        campo_id: ex.usarCampoMissionario ? (campo_missionario_id || campo_id) : campoExtraDefault,
        hospedagem: !!ex.hospedagem,
      };
      if (!ex.omitirTipo) out.tipo_inscricao = ex.tipo;
      return out;
    }),
  };

  const resp = await fetch(`${APP_URL}/api/eventos/inscricao`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const json = await resp.json().catch(() => ({}));

  if (scenario.expectedErrorStatus) {
    const passou = resp.status === scenario.expectedErrorStatus;
    return {
      nome: scenario.nome,
      status: passou ? 'ok' : 'error',
      http: resp.status,
      esperado_http: scenario.expectedErrorStatus,
      resposta: json,
    };
  }

  if (!resp.ok || !json.loteId) {
    return {
      nome: scenario.nome,
      status: 'error',
      http: resp.status,
      payload_enviado: {
        titular_tipo: titularTipo,
        extras_tipos: extrasResolvidos.map(ex => ex.tipo),
      },
      resposta: json,
    };
  }

  const { data: rows, error: rowsErr } = await sb
    .from('evento_inscricoes')
    .select('nome_inscrito,tipo_inscricao,valor_original,desconto_valor,valor_final,alimentacao,quantidade_refeicoes_total,quantidade_refeicoes_saldo,hospedagem,lote_id')
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

  const byNome = new Map((rows || []).map(r => [r.nome_inscrito, r]));
  const titularRow = byNome.get(`[TESTE_LOTE_VALOR] ${scenario.nome} TITULAR`) || null;
  const extrasRows = extrasResolvidos.map((_, idx) => byNome.get(`[TESTE_LOTE_VALOR] ${scenario.nome} EXTRA ${idx + 1}`) || null);
  const totalCalculado = (rows || []).reduce((acc, r) => acc + Number(r.valor_final || 0), 0);

  return {
    nome: scenario.nome,
    status: 'ok',
    loteId: json.loteId,
    payload_antes: {
      titular_tipo: titularTipo,
      extras_tipos: extrasResolvidos.map(ex => ex.tipo),
      total_visual_enviado: null,
    },
    payload_depois: {
      registros: rows,
      total_lote_calculado: totalCalculado,
      titular_valor: titularRow ? Number(titularRow.valor_final || 0) : null,
      extras_valores: extrasRows.map(r => (r ? Number(r.valor_final || 0) : null)),
      extras_alimentacao: extrasRows.map(r => (r ? !!r.alimentacao : null)),
      extras_refeicoes_total: extrasRows.map(r => (r ? Number(r.quantidade_refeicoes_total || 0) : null)),
      extras_refeicoes_saldo: extrasRows.map(r => (r ? Number(r.quantidade_refeicoes_saldo || 0) : null)),
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
    .select('nome,valor,inclui_alimentacao,quantidade_refeicoes')
    .eq('evento_id', EVENTO_ID)
    .eq('ativo', true);
  if (tiposErr || !tipos || tipos.length === 0) throw new Error(`Sem tipos de inscrição ativos: ${tiposErr?.message || 'n/a'}`);

  const tipoComAlimentacao = tipos.find(t => !!t.inclui_alimentacao && Number(t.quantidade_refeicoes || 0) > 0) || null;
  const tipoSemAlimentacao = tipos.find(t => !t.inclui_alimentacao) || null;

  const scenarios = [
    {
      nome: 'CENARIO_A_PP_ESPOSA_PP',
      seed: 11,
      usarCampoMissionario: false,
      titularTipo: (ts) => findTipoName(ts, /pastor presidente$/),
      extras: [
        {
          sexo: 'F',
          tipo: (ts) => findTipoName(ts, /esposa de pastor presidente/),
        },
      ],
    },
    {
      nome: 'CENARIO_B_PP_VISITANTE',
      seed: 22,
      usarCampoMissionario: false,
      titularTipo: (ts) => findTipoName(ts, /pastor presidente/),
      extras: [
        {
          sexo: 'F',
          tipo: (ts) => findTipoName(ts, /visitante/),
        },
      ],
    },
    {
      nome: 'CENARIO_C_PP_2_EXTRAS',
      seed: 33,
      usarCampoMissionario: false,
      titularTipo: (ts) => findTipoName(ts, /pastor presidente/),
      extras: [
        {
          sexo: 'F',
          tipo: (ts) => findTipoName(ts, /esposa de pastor presidente/),
        },
        {
          sexo: 'F',
          tipo: (ts) => findTipoName(ts, /visitante|esposa de pastor auxiliar|juventude/),
        },
      ],
    },
    {
      nome: 'CENARIO_D_EXTRA_SEM_TIPO',
      seed: 44,
      usarCampoMissionario: false,
      titularTipo: (ts) => findTipoName(ts, /pastor presidente/),
      extras: [
        {
          sexo: 'F',
          omitirTipo: true,
          tipo: () => null,
        },
      ],
      expectedErrorStatus: 400,
    },
    {
      nome: 'CENARIO_E_EXTRA_COM_ALIMENTACAO',
      seed: 55,
      usarCampoMissionario: false,
      titularTipo: (ts) => findTipoName(ts, /pastor presidente/),
      extras: [
        {
          sexo: 'F',
          tipo: () => tipoComAlimentacao?.nome || null,
        },
      ],
    },
    {
      nome: 'CENARIO_F_EXTRA_SEM_ALIMENTACAO',
      seed: 66,
      usarCampoMissionario: false,
      titularTipo: (ts) => findTipoName(ts, /pastor presidente/),
      extras: [
        {
          sexo: 'F',
          tipo: () => tipoSemAlimentacao?.nome || null,
        },
      ],
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
