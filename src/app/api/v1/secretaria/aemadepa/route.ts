import { NextRequest, NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/auth/require-auth';
import { createServerClient } from '@/lib/supabase-server';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireModuleAccess(request, 'aemadepa');
    if (!auth.ok) return auth.response;

    const supabase = createServerClient();

    // Busca todas as associadas cadastradas com os dados do ministro vinculado via JOIN
    const { data: associadas, error } = await supabase
      .from('aemadepa_associadas')
      .select(`
        id,
        ministro_id,
        nome,
        cpf,
        rg,
        orgao_emissor,
        data_nascimento,
        nacionalidade,
        naturalidade,
        tipo_sanguineo,
        nome_pai,
        nome_mae,
        titulo_eleitoral,
        fone,
        email,
        foto_url,
        numero_aemadepa,
        status,
        custom_fields,
        created_at,
        updated_at,
        members:ministro_id (
          id,
          name,
          matricula,
          cpf,
          cargo_ministerial,
          status,
          jubilado,
          unique_id,
          custom_fields
        )
      `)
      .order('nome', { ascending: true });

    if (error) {
      console.error('Erro ao consultar aemadepa_associadas:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      data: associadas || [],
      total: associadas ? associadas.length : 0,
    });
  } catch (err: any) {
    console.error('Erro interno na rota /api/v1/secretaria/aemadepa:', err);
    return NextResponse.json({ error: err.message || 'Erro interno do servidor' }, { status: 500 });
  }
}
