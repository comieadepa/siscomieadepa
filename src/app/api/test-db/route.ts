import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';

export async function GET() {
  const supabase = createServerClient();
  
  // 1. Get auth user
  const { data: usersData, error: userError } = await supabase.auth.admin.listUsers();
  if (userError) {
    return NextResponse.json({ error: 'Failed to list users: ' + userError.message });
  }

  const targetUser = usersData.users.find(u => u.email === 'pr.fabiolimamissoes@gmail.com');
  if (!targetUser) {
    return NextResponse.json({ error: 'User pr.fabiolimamissoes@gmail.com not found' });
  }

  // 2. Get usuario_eventos
  const { data: vinculos } = await supabase
    .from('usuario_eventos')
    .select('*')
    .eq('user_id', targetUser.id);

  // 3. Get usuario_eventos_permitidos
  const { data: permitidos } = await supabase
    .from('usuario_eventos_permitidos')
    .select('*')
    .eq('usuario_id', targetUser.id);

  // 4. Get departments
  const { data: depts } = await supabase
    .from('usuario_departamentos')
    .select('*')
    .eq('user_id', targetUser.id);

  // 5. Get team records
  const { data: equipe } = await supabase
    .from('evento_equipe')
    .select('*')
    .eq('email', 'pr.fabiolimamissoes@gmail.com');

  return NextResponse.json({
    user: {
      id: targetUser.id,
      email: targetUser.email,
      user_metadata: targetUser.user_metadata,
      app_metadata: targetUser.app_metadata
    },
    vinculos,
    permitidos,
    depts,
    equipe
  });
}
