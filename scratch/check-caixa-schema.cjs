const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function main() {
  const { data, error } = await supabase
    .from('evento_caixa_sessoes')
    .select('*')
    .limit(1);
  
  if (error) {
    console.error('Error fetching columns:', error);
  } else {
    console.log('Sample row / columns:', data);
  }
}

main();
