import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing Supabase environment variables in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  }
});

async function run() {
  const targetEmail = 'adm@comieadepa.org';
  console.log(`Checking user in database: ${targetEmail}`);
  
  try {
    // 1. Check in auth.users using admin auth API
    const { data: { users }, error: authError } = await supabase.auth.admin.listUsers();
    if (authError) {
      console.error('Error listing auth users:', authError);
    } else {
      const authUser = users.find(u => u.email?.toLowerCase() === targetEmail.toLowerCase());
      if (authUser) {
        console.log('User found in auth.users:', {
          id: authUser.id,
          email: authUser.email,
          role: authUser.role,
          last_sign_in_at: authUser.last_sign_in_at,
          created_at: authUser.created_at,
          user_metadata: authUser.user_metadata,
          confirmed_at: authUser.confirmed_at,
          email_confirmed_at: authUser.email_confirmed_at,
        });
      } else {
        console.log('User NOT found in auth.users. Available emails in Auth:', users.map(u => u.email));
      }
    }

    // 2. Check in public.usuarios table
    const { data: dbUser, error: dbError } = await supabase
      .from('usuarios')
      .select('*')
      .ilike('email', targetEmail)
      .single();

    if (dbError) {
      console.log('Note/Error querying public.usuarios table:', dbError.message);
    } else {
      console.log('User found in public.usuarios table:', {
        id: dbUser.id,
        email: dbUser.email,
        nivel: dbUser.nivel,
        nome: dbUser.nome,
        ativo: dbUser.ativo
      });
    }

  } catch (err) {
    console.error('Unexpected error:', err);
  }
}

run();
