import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { checkRateLimit } from '@/lib/rate-limit';

const LIMIT = 30;
const WINDOW_MS = 60_000;

function onlyDigits(value: string) {
  return (value || '').replace(/\D/g, '');
}

function getClientIp(request: NextRequest) {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]?.trim() || 'unknown';
  return request.headers.get('x-real-ip') || 'unknown';
}

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  const rate = checkRateLimit({
    key: `public/members/lookup:${ip}`,
    limit: LIMIT,
    windowMs: WINDOW_MS,
  });

  if (!rate.allowed) {
    return NextResponse.json(
      { error: 'Muitas tentativas. Tente novamente em instantes.' },
      {
        status: 429,
        headers: {
          'Retry-After': String(rate.retryAfterSeconds),
        },
      }
    );
  }

  const { searchParams } = new URL(request.url);
  const cpfParam = (searchParams.get('cpf') || '').trim();
  const includeMatricula = searchParams.get('includeMatricula') === 'true';
  const cpf = onlyDigits(cpfParam);

  if (cpf.length !== 11) {
    return NextResponse.json({ encontrado: false });
  }

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('members')
    .select('name,sexo,data_nascimento,supervisao_id,campo_id,congregacao_id,matricula,cargo_ministerial,pastor_presidente,pastor_auxiliar,jubilado,status')
    .eq('cpf', cpf)
    .limit(1);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data || data.length === 0) {
    return NextResponse.json({ encontrado: false });
  }

  const row = data[0] as {
    name?: string | null;
    sexo?: string | null;
    data_nascimento?: string | null;
    supervisao_id?: string | null;
    campo_id?: string | null;
    congregacao_id?: string | null;
    matricula?: string | null;
    cargo_ministerial?: string | null;
    pastor_presidente?: boolean | null;
    pastor_auxiliar?: boolean | null;
    jubilado?: boolean | null;
    status?: string | null;
  };

  return NextResponse.json({
    encontrado: true,
    nome: row.name || null,
    sexo: row.sexo || null,
    data_nascimento: row.data_nascimento || null,
    supervisao_id: row.supervisao_id || null,
    campo_id: row.campo_id || null,
    congregacao_id: row.congregacao_id || null,
    ...(includeMatricula ? { matricula: row.matricula || null } : {}),
    cargo_ministerial: row.cargo_ministerial || null,
    pastor_presidente: !!row.pastor_presidente,
    pastor_auxiliar: !!row.pastor_auxiliar,
    jubilado: !!row.jubilado,
    status: row.status || null,
  });
}
