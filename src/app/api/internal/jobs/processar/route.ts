import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { processPendingWebhookJobs } from '@/lib/jobs/webhook-jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CRON_SECRET = process.env.CRON_SECRET;

function authorize(request: NextRequest): boolean {
  if (!CRON_SECRET) {
    console.error('[CRON JOBS] CRON_SECRET não configurado.');
    return false;
  }
  const authHeader = request.headers.get('authorization');
  if (authHeader) {
    const token = authHeader.replace('Bearer ', '').trim();
    if (token === CRON_SECRET) return true;
  }
  const { searchParams } = new URL(request.url);
  const secretParam = searchParams.get('secret');
  if (secretParam && secretParam === CRON_SECRET) return true;

  return false;
}

async function handle(request: NextRequest) {
  const start = Date.now();
  console.log('[CRON JOBS] ▶ Iniciando execução da fila de jobs...');

  if (!authorize(request)) {
    console.warn('[CRON JOBS] Tentativa de acesso não autorizado.');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const supabase = createServerClient();
    const processedCount = await processPendingWebhookJobs(supabase);
    
    console.log(`[CRON JOBS] ⏹ Execução concluída. Jobs processados: ${processedCount} | Tempo total: ${Date.now() - start}ms`);
    return NextResponse.json({ ok: true, processed: processedCount, durationMs: Date.now() - start });
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[CRON JOBS] Erro na rota interna de processamento:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
