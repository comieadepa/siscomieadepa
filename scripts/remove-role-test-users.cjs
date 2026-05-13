#!/usr/bin/env node

require('dotenv').config({ path: '.env.local' });

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const confirm = process.env.CONFIRM_DELETE || '';

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing env: NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

if (confirm !== 'YES') {
  console.error('Safety stop: set CONFIRM_DELETE=YES to proceed.');
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

    const { error: delPublic } = await supabase.from('users').delete().eq('id', authUser.id);
    if (delPublic) {
      results.push({ email: u.email, role: u.role, status: 'error_public', detail: delPublic.message });
      continue;
    }

    const { error: delAuth } = await supabase.auth.admin.deleteUser(authUser.id);
    if (delAuth) {
      results.push({ email: u.email, role: u.role, status: 'error_auth', detail: delAuth.message });
      continue;
    }

    results.push({ email: u.email, role: u.role, status: 'deleted' });
  }

  console.log(JSON.stringify({ ok: true, results }, null, 2));
}

run().catch((err) => {
  console.error(err?.message || String(err));
  process.exit(1);
});
