import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';

interface CsvRow {
  ano: number;
  codigo_processo: number;
  data_processo: string | null;
  data_posse: string | null;
  ministro_nome: string;
  ministro_cpf: string;
  ministro_matricula: string;
  campo_origem_nome: string;
  supervisao_origem_nome: string;
  campo_destino_nome: string;
  supervisao_destino_nome: string;
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerClient();
    const body = await request.json();
    const rows: CsvRow[] = body?.rows || [];

    if (!rows.length) {
      return NextResponse.json({ error: 'Nenhum registro para importar.' }, { status: 400 });
    }

    // Monta registros para insert, ignorando duplicatas (codigo_processo + ano)
    const registros = rows.map(r => ({
      codigo_processo: r.codigo_processo,
      ano: r.ano,
      data_processo: r.data_processo || null,
      data_posse: r.data_posse || null,
      ministro_nome: r.ministro_nome || '',
      ministro_cpf: r.ministro_cpf || '',
      ministro_matricula: r.ministro_matricula || '',
      campo_origem_nome: r.campo_origem_nome || '',
      supervisao_origem_nome: r.supervisao_origem_nome || '',
      campo_destino_nome: r.campo_destino_nome || '',
      supervisao_destino_nome: r.supervisao_destino_nome || '',
    }));

    const { data, error } = await supabase
      .from('permutas')
      .upsert(registros, { onConflict: 'codigo_processo,ano', ignoreDuplicates: false })
      .select();

    if (error) throw new Error(error.message);

    return NextResponse.json({ importados: data?.length ?? registros.length });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Erro interno';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
