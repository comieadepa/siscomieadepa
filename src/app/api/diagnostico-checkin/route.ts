import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';

const SELECT_INSC = [
  'id', 'evento_id', 'nome_inscrito', 'cpf',
  'supervisao_id', 'campo_id', 'status_pagamento',
  'checkin_realizado', 'checkin_at', 'qr_code',
  'tipo_inscricao', 'alimentacao', 'hospedagem',
  'refeicoes_total', 'refeicoes_utilizadas',
  'quantidade_refeicoes_total', 'quantidade_refeicoes_usadas', 'quantidade_refeicoes_saldo',
].join(',');

export async function GET() {
  try {
    const supabase = createServerClient();

    const { data, error } = await supabase
      .from('evento_inscricoes')
      .select(SELECT_INSC)
      .limit(1);

    return NextResponse.json({
      success: true,
      error_objeto: error,
      mensagem_erro: error?.message || null,
      data_sample: data
    });

  } catch (error: any) {
    return NextResponse.json({ error: error.message || error }, { status: 500 });
  }
}
