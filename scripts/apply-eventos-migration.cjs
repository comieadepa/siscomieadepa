#!/usr/bin/env node
/**
 * Aplica migration 007 (Módulo de Eventos) via pg direto no banco Supabase
 * Uso: node scripts/apply-eventos-migration.cjs
 * Requer: DATABASE_URL no .env.local
 */

require('dotenv').config({ path: '.env.local' });
const fs   = require('fs');
const path = require('path');
const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('\n❌ DATABASE_URL não encontrada no .env.local');
  console.error('   Adicione a connection string do Supabase:');
  console.error('   Dashboard → Settings → Database → Connection string → URI');
  console.error('   Exemplo: DATABASE_URL=postgresql://postgres.xxxx:SENHA@aws-0-us-west-2.pooler.supabase.com:6543/postgres\n');
  process.exit(1);
}

const SQL_FILE = path.join(__dirname, '..', 'migrations', '007_create_eventos_module.sql');

async function run() {
  console.log('\n🚀 Aplicando Migration 007 — Módulo de Eventos\n');

  const sql = fs.readFileSync(SQL_FILE, 'utf-8');

  const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

  try {
    const client = await pool.connect();
    console.log('✅ Conectado ao banco Supabase');

    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('COMMIT');
      console.log('✅ Migration aplicada com sucesso!');
      console.log('\nTabelas criadas:');
      console.log('  ✔ eventos');
      console.log('  ✔ evento_inscricoes');
      console.log('  ✔ evento_checkins');
      console.log('  ✔ evento_equipe\n');
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('\n❌ Erro ao executar migration:', err.message);
      process.exit(1);
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('\n❌ Erro de conexão:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

run();
