import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';

export async function GET() {
  const supabase = createServerClient();
  
  // Find UMADESPA event
  const { data: eventos } = await supabase
    .from('eventos')
    .select('id, nome, departamento');
    
  const umadespa = (eventos || []).find(e => e.departamento === 'UMADESPA' || e.nome.includes('UMADESPA'));
  
  if (!umadespa) {
    return NextResponse.json({ error: 'UMADESPA not found', eventos });
  }

  const { data: leitos } = await supabase
    .from('evento_hospedagem_leitos')
    .select('*')
    .eq('evento_id', umadespa.id);

  const { data: hospedagens } = await supabase
    .from('evento_hospedagens')
    .select('*')
    .eq('evento_id', umadespa.id);

  return NextResponse.json({
    event: umadespa,
    total_leitos: leitos?.length,
    total_hospedagens: hospedagens?.length,
    leitos: leitos?.slice(0, 20),
    hospedagens: hospedagens?.slice(0, 20),
  });
}
