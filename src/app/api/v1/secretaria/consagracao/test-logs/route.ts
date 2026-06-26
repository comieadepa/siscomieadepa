import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = createServerClient();

  try {
    // 1. Buscar os 2 membros recém-criados sem matrícula (ou com matrícula vazia/nula) que possuem processo_id nos custom_fields ou nome igual
    // Vamos fazer um select amplo na tabela members para encontrar registros sem matrícula
    const { data: membersSemMatricula, error: membersError } = await supabase
      .from('members')
      .select('id, name, cpf, matricula, cargo_ministerial, supervisao_id, congregacao_id, custom_fields, created_at')
      .is('matricula', null)
      .order('created_at', { ascending: false })
      .limit(10);

    // 2. Buscar o MAX real de matrícula numérica da tabela members
    const { data: allMembersWithMatricula, error: matriculasError } = await supabase
      .from('members')
      .select('matricula')
      .not('matricula', 'is', null);

    const matriculasNumericas = (allMembersWithMatricula || [])
      .map(m => parseInt(m.matricula) || 0)
      .filter(n => n > 0);
    const maxMatricula = matriculasNumericas.length > 0 ? Math.max(...matriculasNumericas) : 0;

    // 3. Encontrar os processos de origem no banco consagracao_registros para estes membros sem matrícula
    const processIds = (membersSemMatricula || [])
      .map(m => m.custom_fields?.consagracao_processo_id)
      .filter(Boolean);

    let processosOrigem: any[] = [];
    if (processIds.length > 0) {
      const { data: procs } = await supabase
        .from('consagracao_registros')
        .select('id, numero_processo, nome, cpf, cargo_pretendido, supervisao_id, campo_id, congregacao_id, member_id')
        .in('id', processIds);
      processosOrigem = procs || [];
    }

    // Buscar também se existem outros candidatos elegíveis
    const { data: elegiveis } = await supabase
      .from('consagracao_registros')
      .select('id, numero_processo, nome, status_processo, member_id')
      .eq('status_processo', 'homologar')
      .is('member_id', null);

    return NextResponse.json({
      ok: true,
      maxMatricula,
      membersSemMatricula: membersSemMatricula || [],
      membersError: membersError ? membersError.message : null,
      matriculasError: matriculasError ? matriculasError.message : null,
      processosOrigem,
      elegiveisCount: elegiveis?.length || 0,
      elegiveis: elegiveis || []
    });
  } catch (err: any) {
    return NextResponse.json({
      ok: false,
      error: err.message,
      stack: err.stack
    }, { status: 500 });
  }
}
