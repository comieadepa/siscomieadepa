import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';

export async function GET() {
  try {
    const supabase = createServerClient();

    // Busca as inscrições de Gezael com todas as colunas relevantes
    const { data: inscricoes, error: errInsc } = await supabase
      .from('evento_inscricoes')
      .select('id, nome_inscrito, evento_id, cpf, ministro_id, qr_code, status_pagamento')
      .ilike('nome_inscrito', '%Gezael%');
    if (errInsc) throw errInsc;

    // Busca o membro Gezael na tabela members
    const { data: members, error: errMem } = await supabase
      .from('members')
      .select('id, name, cpf, matricula')
      .ilike('name', '%Gezael%');
    if (errMem) throw errMem;

    return NextResponse.json({
      success: true,
      inscricoes,
      members
    });

  } catch (error: any) {
    return NextResponse.json({ error: error.message || error }, { status: 500 });
  }
}
