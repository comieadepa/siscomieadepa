#!/usr/bin/env node
/**
 * Aplica migration 20260529_alojamentos_setor_key via Supabase RPC.
 * Uso: node scripts/apply-setor-key-migration.cjs
 */

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('❌  NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não definidos em .env.local');
  process.exit(1);
}

const supabase = createClient(url, key);

const SQL = `
ALTER TABLE evento_alojamentos ADD COLUMN IF NOT EXISTS setor_key        text;
ALTER TABLE evento_alojamentos ADD COLUMN IF NOT EXISTS origem            text;
ALTER TABLE evento_alojamentos ADD COLUMN IF NOT EXISTS grupo_permitido   text;
ALTER TABLE evento_alojamentos ADD COLUMN IF NOT EXISTS tipos_leito       jsonb;
ALTER TABLE evento_alojamentos ADD COLUMN IF NOT EXISTS leitos_inferiores integer DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS idx_alojamentos_evento_setor_key
  ON evento_alojamentos (evento_id, setor_key)
  WHERE setor_key IS NOT NULL;
`;

async function run() {
  console.log('⏳  Aplicando migration 20260529_alojamentos_setor_key …');

  // Tenta via rpc exec_sql (função precisa existir no Supabase)
  const { error } = await supabase.rpc('exec_sql', { sql: SQL });

  if (error) {
    // Fallback: aplica coluna por coluna via REST (sem exec_sql)
    console.warn('⚠️   rpc exec_sql indisponível:', error.message);
    console.log('➡️   Tentando colunas individualmente via PostgreSQL REST…');

    const stmts = SQL.split(';').map(s => s.trim()).filter(Boolean);
    let ok = 0, fail = 0;
    for (const stmt of stmts) {
      const { error: e2 } = await supabase.rpc('exec_sql', { sql: stmt + ';' });
      if (e2) { console.error(`  ✗  ${stmt.slice(0, 80)}…\n     ${e2.message}`); fail++; }
      else { console.log(`  ✓  ${stmt.slice(0, 80)}`); ok++; }
    }
    if (fail > 0) {
      console.error(`\n❌  ${fail} instrução(ões) falharam. Aplique manualmente no SQL Editor do Supabase.`);
      printManual();
      process.exit(1);
    }
  }

  console.log('\n✅  Migration aplicada com sucesso!');
  await verificar();
}

async function verificar() {
  console.log('\n🔍  Verificando colunas em evento_alojamentos …');
  const { data, error } = await supabase
    .from('event_alojamentos')
    .select('setor_key')
    .limit(1);

  // Basta testar sem erro; 0 linhas é esperado
  if (error && error.code === '42703') {
    console.error('❌  Coluna setor_key não encontrada — migration não foi aplicada.');
    printManual();
    process.exit(1);
  }
  console.log('✓  Coluna setor_key presente.');
}

function printManual() {
  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Cole o SQL abaixo no Supabase → SQL Editor e execute:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${SQL}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
}

run().catch(err => { console.error('Erro inesperado:', err); process.exit(1); });
