import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const cpf = searchParams.get('cpf') || '45927200249';

  // Usando a mesma conexao que o server usa normalmente
  const supabase = createServerClient();
  
  const { data: memberSimple } = await supabase
    .from('members')
    .select('id, name, cpf')
    .eq('cpf', cpf)
    .maybeSingle();

  const cpfFormatado = cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  const { data: memberFormatted } = await supabase
    .from('members')
    .select('id, name, cpf')
    .eq('cpf', cpfFormatado)
    .maybeSingle();

  // Testando busca por like
  const { data: memberLike } = await supabase
    .from('members')
    .select('id, name, cpf')
    .ilike('cpf', `%${cpf}%`)
    .limit(5);

  return NextResponse.json({
    cpf_consultado: cpf,
    cpf_formatado: cpfFormatado,
    simple_result: memberSimple,
    formatted_result: memberFormatted,
    like_result: memberLike,
  });
}
