import { NextRequest, NextResponse } from 'next/server';
import { requireEventoPermission } from '@/lib/evento-guard';
import { getCpfSearchVariants } from '@/lib/cpf';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;
  const guard = await requireEventoPermission(request, eventoId, 'hospedagem');
  if (!guard.ok) return guard.response;

  const { searchParams } = new URL(request.url);
  const q = (searchParams.get('q') || '').trim();

  if (!q) {
    return NextResponse.json({ error: 'Termo de busca (q) é obrigatório.' }, { status: 400 });
  }

  const supabase = guard.ctx.supabaseAdmin;

  let query = supabase
    .from('evento_inscricoes')
    .select(`
      id, nome_inscrito, cpf, sexo, data_nascimento,
      supervisao_id, campo_id, tipo_inscricao, status_pagamento,
      hospedagem,
      hosp_necessidade_especial, hosp_descricao_necessidade,
      hosp_cama_inferior, hosp_observacoes,
      hosp_possui_comorbidade, hosp_descricao_comorbidade,
      grupo_hospedagem
    `)
    .eq('evento_id', eventoId)
    .eq('status_pagamento', 'pago');

  const cpfVariants = getCpfSearchVariants(q);
  const orClauses = [`nome_inscrito.ilike.%${q}%`];
  for (const variant of cpfVariants) {
    orClauses.push(`cpf.ilike.%${variant}%`);
  }
  query = query.or(orClauses.join(','));

  const { data: inscricoes, error } = await query.limit(20);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ inscricoes });
}
