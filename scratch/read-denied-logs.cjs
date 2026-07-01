const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

console.log('URL:', process.env.NEXT_PUBLIC_SUPABASE_URL);
console.log('KEY length:', process.env.SUPABASE_SERVICE_ROLE_KEY?.length);
process.exit(0);

async function main() {
  const { data, error } = await supabase
    .from('audit_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) {
    console.error(error);
    return;
  }
  console.log(JSON.stringify(data, null, 2));
}

main();
