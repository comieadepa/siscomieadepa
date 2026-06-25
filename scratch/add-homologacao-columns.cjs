require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('❌ NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not defined in .env.local');
  process.exit(1);
}

const supabase = createClient(url, key);

async function run() {
  console.log('⏳ Running ALTER TABLE statements via Supabase RPC...');
  const SQL = `
    ALTER TABLE public.consagracao_registros ADD COLUMN IF NOT EXISTS drive_folder_id VARCHAR(255);
    ALTER TABLE public.consagracao_registros ADD COLUMN IF NOT EXISTS homologado_em TIMESTAMPTZ;
    ALTER TABLE public.consagracao_registros ADD COLUMN IF NOT EXISTS homologado_por UUID REFERENCES auth.users(id) ON DELETE SET NULL;

    ALTER TABLE public.candidato_documentos ADD COLUMN IF NOT EXISTS member_id UUID REFERENCES public.members(id) ON DELETE SET NULL;
    ALTER TABLE public.candidato_documentos ADD COLUMN IF NOT EXISTS drive_folder_id VARCHAR(255);
    ALTER TABLE public.candidato_documentos ADD COLUMN IF NOT EXISTS homologado_em TIMESTAMPTZ;
    ALTER TABLE public.candidato_documentos ADD COLUMN IF NOT EXISTS homologado_por UUID REFERENCES auth.users(id) ON DELETE SET NULL;
  `;
  const { data, error } = await supabase.rpc('exec_sql', { sql: SQL });
  if (error) {
    console.error('❌ Error executing SQL via RPC:', error.message);
    process.exit(1);
  }
  console.log('✅ Audit columns added successfully!');
}

run();
