const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const { data: user } = await supabase.auth.admin.listUsers();
  const target = user.users.find(u => u.email === 'pr.fabiolimamissoes@gmail.com');
  console.log('User:', target);

  if (target) {
    const { data: vinculos } = await supabase
      .from('usuario_eventos')
      .select('*')
      .eq('user_id', target.id);
    console.log('Vinculos:', vinculos);
  }
}
run();
