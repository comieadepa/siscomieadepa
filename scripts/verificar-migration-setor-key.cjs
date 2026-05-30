#!/usr/bin/env node
/**
 * Verifica e aplica migration via Supabase REST (sem exec_sql).
 * Usa SELECT em information_schema para checar colunas.
 */

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(url, key);

async function verificarColunas() {
  const colunasTeste = ['setor_key', 'origem', 'grupo_permitido', 'tipos_leito', 'leitos_inferiores'];
  const ausentes = [];

  for (const col of colunasTeste) {
    // Tenta selecionar; erro 42703 = coluna inexistente
    const { error } = await supabase
      .from('evento_alojamentos')
      .select(col)
      .limit(1);
    
    if (error?.code === 'PGRST204' || error?.message?.includes(col)) {
      ausentes.push(col);
    } else if (error && !error.message?.includes('Results contain 0 rows')) {
      // coluna existe mas tabela vazia – OK
    }
  }

  return ausentes;
}

async function main() {
  console.log('🔍  Verificando colunas em evento_alojamentos …\n');
  
  // Testa coluna nova
  const { error: testErr } = await supabase
    .from('evento_alojamentos')
    .select('id, setor_key, origem, grupo_permitido, tipos_leito, leitos_inferiores')
    .limit(1);

  if (!testErr) {
    console.log('✅  Todas as colunas já existem! Migration já foi aplicada.');
    return;
  }

  console.log('❌  Colunas ausentes detectadas.');
  console.log(`   Erro: ${testErr.message}\n`);
  
  // Tenta usar o endpoint run-migration se disponível
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  console.log(`\nComo aplicar a migration:\n`);
  console.log('━'.repeat(60));
  console.log('OPÇÃO 1 — Supabase SQL Editor (dashboard.supabase.com):');
  console.log('  Cole e execute o seguinte SQL:\n');
  console.log(`ALTER TABLE evento_alojamentos ADD COLUMN IF NOT EXISTS setor_key        text;
ALTER TABLE evento_alojamentos ADD COLUMN IF NOT EXISTS origem            text;
ALTER TABLE evento_alojamentos ADD COLUMN IF NOT EXISTS grupo_permitido   text;
ALTER TABLE evento_alojamentos ADD COLUMN IF NOT EXISTS tipos_leito       jsonb;
ALTER TABLE evento_alojamentos ADD COLUMN IF NOT EXISTS leitos_inferiores integer DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS idx_alojamentos_evento_setor_key
  ON evento_alojamentos (evento_id, setor_key)
  WHERE setor_key IS NOT NULL;`);
  console.log('\n' + '━'.repeat(60));
  console.log('OPÇÃO 2 — Supabase CLI (precisa da senha do banco):');
  console.log('  supabase db push  (configure SUPABASE_DB_PASSWORD no .env.local)');
  console.log('━'.repeat(60));
}

main().catch(e => { console.error(e); process.exit(1); });
