#!/usr/bin/env node
/**
 * Aplica migration de unicidade de leitos via Supabase RPC.
 * Uso: node scripts/apply-leito-unico-migration.cjs
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_hospedagem_leito_ocupado_numero_unico
  ON evento_hospedagem_leitos (evento_id, alojamento_id, numero)
  WHERE ocupado = true;
`;

async function run() {
  console.log('⏳  Aplicando migration 20260605_hospedagem_leito_unico …');

  let error = null;

  try {
    const res = await supabase.rpc('exec', { sql: SQL });
    error = res.error;
  } catch (err) {
    error = err;
  }

  if (error) {
    console.log('⚠️   rpc exec falhou. Tentando exec_sql...');
    try {
      const res2 = await supabase.rpc('exec_sql', { sql: SQL });
      error = res2.error;
    } catch (err2) {
      error = err2;
    }
  }

  if (error) {
    console.error('❌  Falha ao executar via RPC:', error.message || error);
    console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Cole o SQL abaixo no Supabase → SQL Editor e execute:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${SQL}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    process.exit(1);
  }

  console.log('✅  Migration aplicada com sucesso!');
}

run().catch(err => { console.error('Erro inesperado:', err); process.exit(1); });
