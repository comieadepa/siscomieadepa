import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const envInfo = {
    supabaseUrl,
    hasServiceKey: !!serviceKey,
    serviceKeyLength: serviceKey ? serviceKey.length : 0,
    serviceKeyFirstChars: serviceKey ? serviceKey.slice(0, 10) + '...' : 'none'
  };

  try {
    const supabase = createServerClient();

    // 1. Query latest audit logs for regularizar_homologados_legados
    const { data: logs, error: logsError } = await supabase
      .from('audit_logs')
      .select('*')
      .eq('action', 'regularizar_homologados_legados')
      .order('created_at', { ascending: false })
      .limit(10);

    // 2. Query some eligible records
    const { data: elegiveis, error: elegiveisError } = await supabase
      .from('consagracao_registros')
      .select('id, numero_processo, nome, cpf, status_processo, member_id')
      .eq('status_processo', 'homologar')
      .is('member_id', null)
      .limit(5);

    // 3. Query all distinct status values in consagracao_registros
    const { data: allStatuses, error: statusesError } = await supabase
      .from('consagracao_registros')
      .select('status_processo');

    const statusCounts: Record<string, number> = {};
    if (allStatuses) {
      allStatuses.forEach(r => {
        const status = String(r.status_processo || 'unknown');
        statusCounts[status] = (statusCounts[status] || 0) + 1;
      });
    }

    return NextResponse.json({
      ok: true,
      envInfo,
      logs: logs || [],
      logsError: logsError ? logsError.message : null,
      elegiveis: elegiveis || [],
      elegiveisError: elegiveisError ? elegiveisError.message : null,
      statusCounts,
      statusesError: statusesError ? statusesError.message : null
    });
  } catch (err: any) {
    return NextResponse.json({
      ok: false,
      envInfo,
      error: err.message,
      stack: err.stack
    }, { status: 500 });
  }
}
