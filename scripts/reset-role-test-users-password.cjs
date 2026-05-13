#!/usr/bin/env node

require('dotenv').config({ path: '.env.local' });

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const password = process.env.TEST_PASSWORD || '';

if (!supabaseUrl || !supabaseServiceKey || !password) {
  console.error('Missing env: NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TEST_PASSWORD');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const users = [
  { email: 'teste.super@siscomieadepa.org', role: 'super' },
  { email: 'teste.admin@siscomieadepa.org', role: 'admin' },
  { email: 'teste.comissao@siscomieadepa.org', role: 'comissao' },
  { email: 'teste.inscricao@siscomieadepa.org', role: 'inscricao' },
  { email: 'teste.financeiro@siscomieadepa.org', role: 'financeiro' },
  { email: 'teste.cgadb@siscomieadepa.org', role: 'cgadb' },
];

async function run() {
  const list = await supabase.auth.admin.listUsers({ page: 1, perPage: 2000 });
  const map = new Map((list.data?.users || []).map((u) => [String(u.email || '').toLowerCase(), u]));

  const results = [];

  for (const u of users) {
    const key = u.email.toLowerCase();
    const authUser = map.get(key);

    if (!authUser) {
      results.push({ email: u.email, role: u.role, status: 'not_found' });
      continue;
    }

    const meta = authUser.user_metadata || {};
    const isTest = meta.test === true || meta.tag === 'rls-validation';
    if (!isTest) {
      results.push({ email: u.email, role: u.role, status: 'skipped_not_test' });
      continue;
    }

    const { error } = await supabase.auth.admin.updateUserById(authUser.id, {
      password,
      user_metadata: { ...meta, test: true, tag: 'rls-validation' },
    });

    if (error) {
      results.push({ email: u.email, role: u.role, status: 'error', detail: error.message });
      continue;
    }

    results.push({ email: u.email, role: u.role, status: 'updated' });
  }

  console.log(JSON.stringify({ ok: true, results }, null, 2));
}

run().catch((err) => {
  console.error(err?.message || String(err));
  process.exit(1);
});
