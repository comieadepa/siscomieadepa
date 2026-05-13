#!/usr/bin/env node

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
  { email: 'teste.super@siscomieadepa.org', role: 'super', nivel: 'super', name: 'TESTE Super' },
  { email: 'teste.admin@siscomieadepa.org', role: 'admin', nivel: 'administrador', name: 'TESTE Administrador' },
  { email: 'teste.comissao@siscomieadepa.org', role: 'comissao', nivel: 'comissao', name: 'TESTE Comissao' },
  { email: 'teste.inscricao@siscomieadepa.org', role: 'inscricao', nivel: 'inscricao', name: 'TESTE Inscricao' },
  { email: 'teste.financeiro@siscomieadepa.org', role: 'financeiro', nivel: 'financeiro', name: 'TESTE Financeiro' },
  { email: 'teste.cgadb@siscomieadepa.org', role: 'cgadb', nivel: 'cgadb', name: 'TESTE CGADB' },
];

async function run() {
  const list = await supabase.auth.admin.listUsers({ page: 1, perPage: 2000 });
  const map = new Map((list.data?.users || []).map((u) => [String(u.email || '').toLowerCase(), u]));

  const results = [];

  for (const u of users) {
    const key = u.email.toLowerCase();
    let authUser = map.get(key);

    if (!authUser) {
      const { data, error } = await supabase.auth.admin.createUser({
        email: u.email,
        password,
        email_confirm: true,
        user_metadata: { nivel: u.nivel, name: u.name, test: true, tag: 'rls-validation' },
      });

      if (error || !data?.user) {
        results.push({ email: u.email, status: 'error', detail: error?.message || 'create failed' });
        continue;
      }

      authUser = data.user;
      results.push({ email: u.email, status: 'created' });
    } else {
      await supabase.auth.admin.updateUserById(authUser.id, {
        user_metadata: { ...(authUser.user_metadata || {}), nivel: u.nivel, name: u.name, test: true, tag: 'rls-validation' },
      });
      results.push({ email: u.email, status: 'existing' });
    }

    await supabase.from('users').upsert({
      id: authUser.id,
      email: u.email,
      name: u.name,
      role: u.role,
      is_active: true,
    });
  }

  console.log(JSON.stringify({ ok: true, results }, null, 2));
}

run().catch((err) => {
  console.error(err?.message || String(err));
  process.exit(1);
});
