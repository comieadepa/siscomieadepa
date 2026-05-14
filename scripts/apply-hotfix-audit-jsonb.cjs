#!/usr/bin/env node
// Aplica o hotfix da função fn_audit_log no banco de produção
// Corrige: cannot cast type members to jsonb

const fs = require('fs');
const path = require('path');

const SUPABASE_URL = 'https://wtifljxpoinpbzyugrfc.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_ROLE_KEY) {
  console.error('❌ Defina SUPABASE_SERVICE_ROLE_KEY no ambiente');
  process.exit(1);
}

const sql = fs.readFileSync(
  path.join(__dirname, '../supabase/migrations/20260514000000_fix_audit_trigger_jsonb_cast.sql'),
  'utf-8'
);

async function apply() {
  console.log('🔧 Aplicando hotfix: fn_audit_log jsonb cast...');

  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({ sql_query: sql }),
  });

  if (res.ok) {
    console.log('✅ Hotfix aplicado com sucesso!');
    return;
  }

  const body = await res.text();
  // exec_sql não disponível (404/404) — tentar via pg direto
  if (res.status === 404) {
    console.warn('⚠️  RPC exec_sql não encontrada. Aplique manualmente no SQL Editor do Supabase:');
    console.warn('   https://supabase.com/dashboard/project/wtifljxpoinpbzyugrfc/sql/new');
    console.warn('\n--- SQL ---\n');
    console.log(sql);
  } else {
    console.error(`❌ Erro ${res.status}: ${body}`);
    process.exit(1);
  }
}

apply();
