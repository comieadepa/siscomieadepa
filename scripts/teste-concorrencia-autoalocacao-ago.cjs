const dotenv = require('dotenv');
dotenv.config({ path: '.env.local', quiet: true });

const { createClient } = require('@supabase/supabase-js');

const EVENTO_ID = process.env.CARGA_EVENTO_ID || '8940f4e1-f00b-4115-a4f5-0e912332174c';
const APP_URL = process.env.CARGA_APP_URL || 'http://localhost:3001';

function assertEnv(name) {
  if (!process.env[name]) {
    throw new Error(`Variavel obrigatoria ausente: ${name}`);
  }
}

async function criarEquipeTemp(sb) {
  const emailTmp = `tmp-concorrencia-${Date.now()}@tmp.local`;
  const { data, error } = await sb
    .from('evento_equipe')
    .insert({
      evento_id: EVENTO_ID,
      email: emailTmp,
      tipo: 'hospedagem',
      ativo: true,
      nome: 'teste-concorrencia-autoalocacao-temp',
      convite_expira_em: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    })
    .select('id')
    .single();

  if (error) throw new Error(`Falha criando equipe temporaria: ${error.message}`);
  return data.id;
}

async function removerEquipeTemp(sb, equipeId) {
  await sb.from('evento_equipe').delete().eq('id', equipeId).eq('evento_id', EVENTO_ID);
}

async function chamarAutoalocacao(equipeId) {
  const started = Date.now();
  const resp = await fetch(
    `${APP_URL}/api/eventos/${EVENTO_ID}/hospedagens/alocar?equipe_id=${encodeURIComponent(equipeId)}`,
    { method: 'POST' },
  );
  let body;
  try {
    body = await resp.json();
  } catch {
    body = { error: 'Resposta nao JSON' };
  }
  return {
    status: resp.status,
    tempo_ms: Date.now() - started,
    body,
  };
}

async function queryDuplicidadeLeitos(sb) {
  const { data, error } = await sb
    .from('evento_hospedagem_leitos')
    .select('evento_id,alojamento_id,numero,posicao,ocupado')
    .eq('evento_id', EVENTO_ID)
    .eq('ocupado', true);

  if (error) throw new Error(`Falha consultando leitos: ${error.message}`);

  const counter = new Map();
  for (const row of data || []) {
    const key = `${row.evento_id}|${row.alojamento_id}|${row.numero}|${row.posicao}`;
    counter.set(key, (counter.get(key) || 0) + 1);
  }

  const duplicados = [];
  for (const [key, count] of counter.entries()) {
    if (count > 1) {
      const [evento_id, alojamento_id, numero, posicao] = key.split('|');
      duplicados.push({ evento_id, alojamento_id, numero, posicao, count });
    }
  }
  return duplicados;
}

async function main() {
  assertEnv('SUPABASE_URL');
  assertEnv('SUPABASE_SERVICE_ROLE_KEY');

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const equipeId = await criarEquipeTemp(sb);
  try {
    const [r1, r2] = await Promise.all([chamarAutoalocacao(equipeId), chamarAutoalocacao(equipeId)]);

    const statuses = [r1.status, r2.status].sort((a, b) => a - b);
    const esperado = statuses[0] === 200 && statuses[1] === 409;

    const duplicados = await queryDuplicidadeLeitos(sb);

    const output = {
      evento_id: EVENTO_ID,
      resultados: [r1, r2],
      validacao_concorrencia: {
        esperado_um_200_um_409: esperado,
        statuses,
      },
      integridade_leitos: {
        duplicidades: duplicados,
        total_duplicidades: duplicados.length,
      },
    };

    console.log(JSON.stringify(output, null, 2));

    if (!esperado || duplicados.length > 0) {
      process.exitCode = 2;
    }
  } finally {
    await removerEquipeTemp(sb, equipeId);
  }
}

main().catch((err) => {
  console.error('ERRO_TESTE_CONCORRENCIA_AUTOALOCACAO:', err.message);
  process.exit(1);
});
