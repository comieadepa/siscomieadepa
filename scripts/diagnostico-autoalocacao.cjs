const dotenv = require('dotenv');
dotenv.config({ path: '.env.local', quiet: true });
const { createClient } = require('@supabase/supabase-js');

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function main() {
  const sb = createClient(url, key);
  const sql = "SELECT 1;";
  
  const res1 = await sb.rpc('exec', { sql });
  console.log("exec result:", res1);

  const res2 = await sb.rpc('exec_sql', { sql });
  console.log("exec_sql result:", res2);
}

main();
