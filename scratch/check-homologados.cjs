const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Manually parse .env.local
const envPath = path.join(__dirname, '../.env.local');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match) {
      const key = match[1];
      let value = match[2] || '';
      // Remove surrounding quotes if any
      if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
      if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
      process.env[key] = value;
    }
  });
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase environment variables in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  console.log('--- DB Check for Regularizar Homologados ---');
  
  // 1. Total records in consagracao_registros
  const { count: total, error: err1 } = await supabase
    .from('consagracao_registros')
    .select('*', { count: 'exact', head: true });
    
  if (err1) {
    console.error('Error counting consagracao_registros:', err1);
    return;
  }
  console.log('Total records in consagracao_registros:', total);

  // 2. Count by status_processo
  const { data: statusGroup, error: err2 } = await supabase
    .from('consagracao_registros')
    .select('status_processo');
    
  if (err2) {
    console.error('Error grouping by status:', err2);
  } else {
    const counts = {};
    statusGroup.forEach(r => {
      counts[r.status_processo] = (counts[r.status_processo] || 0) + 1;
    });
    console.log('Records by status_processo:', counts);
  }

  // 3. Count candidates with status_processo = 'homologar' and member_id is null
  const { data: elegiveis, error: err3 } = await supabase
    .from('consagracao_registros')
    .select('id, numero_processo, nome, status_processo, member_id')
    .eq('status_processo', 'homologar')
    .is('member_id', null);

  if (err3) {
    console.error('Error fetching elegiveis:', err3);
  } else {
    console.log(`Eligible for regularization (status_processo = 'homologar', member_id = null): ${elegiveis.length}`);
    if (elegiveis.length > 0) {
      console.log('First 5 eligible records:', elegiveis.slice(0, 5));
    }
  }
}

run();
