#!/usr/bin/env node
/**
 * Aplica migration do módulo CONEC via pg.
 * Uso: node scripts/apply-conec-migration.cjs
 */

require('dotenv').config({ path: '.env.local' });
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const SQL_FILE = path.join(__dirname, '..', 'migrations', '20260613_create_conec_mvp_schema.sql');
const SQL = fs.readFileSync(SQL_FILE, 'utf-8');

const connections = [
  'postgresql://postgres.wtifljxpoinpbzyugrfc:Alcantara2024@aws-1-us-west-2.pooler.supabase.com:6543/postgres',
  'postgresql://postgres.wtifljxpoinpbzyugrfc:Alcantara2024@aws-1-us-west-2.pooler.supabase.com:5432/postgres',
  'postgresql://postgres.wtifljxpoinpbzyugrfc:siscomieadepa2026@aws-1-us-west-2.pooler.supabase.com:6543/postgres',
  'postgresql://postgres.wtifljxpoinpbzyugrfc:siscomieadepa2026@aws-1-us-west-2.pooler.supabase.com:5432/postgres'
];

async function tryConnectAndRun() {
  for (const connectionString of connections) {
    console.log(`Tentando conectar com: ${connectionString.replace(/:[^@:]*@/, ':***@')}`);
    const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 5000 });
    try {
      const client = await pool.connect();
      console.log('✅ Conectado com sucesso!');
      try {
        await client.query('BEGIN');
        await client.query(SQL);
        await client.query('COMMIT');
        console.log('✅ Migration aplicada com sucesso!');
        await pool.end();
        return;
      } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ Erro ao executar SQL:', err.message);
        await pool.end();
        process.exit(1);
      }
    } catch (err) {
      console.error('❌ Falha na conexão:', err.message);
      await pool.end();
    }
  }
  console.error('❌ Nenhuma conexão funcionou.');
  process.exit(1);
}

tryConnectAndRun();
