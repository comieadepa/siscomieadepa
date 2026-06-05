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
    .select('id,name,sexo,data_nascimento,supervisao_id,campo_id,congregacao_id,matricula,cargo_ministerial,pastor_presidente,pastor_auxiliar,jubilado,status,nome_conjuge,cpf_conjuge,data_nascimento_conjuge')
    .eq('cpf', cpf)
    .limit(1);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (data && data.length > 0) {
    const row = data[0];
    return NextResponse.json({
      encontrado: true,
      lookup_kind: 'ministro',
      nome: row.name || null,
      sexo: row.sexo || null,
      data_nascimento: row.data_nascimento || null,
      supervisao_id: row.supervisao_id || null,
      campo_id: row.campo_id || null,
      congregacao_id: row.congregacao_id || null,
      cargo_ministerial: row.cargo_ministerial || null,
      pastor_presidente: !!row.pastor_presidente,
      pastor_auxiliar: !!row.pastor_auxiliar,
      jubilado: !!row.jubilado,
      status: row.status || null,
      nome_conjuge: row.nome_conjuge || null,
      cpf_conjuge: row.cpf_conjuge || null,
      data_nascimento_conjuge: row.data_nascimento_conjuge || null,
      ...(includeMatricula ? { matricula: row.matricula || null } : {}),
    });
  }

  // Se não encontrou pelo CPF do membro, busca pelo CPF do cônjuge
  const { data: conjData, error: conjError } = await supabase
    .from('members')
    .select('id,name,sexo,data_nascimento,supervisao_id,campo_id,congregacao_id,matricula,cargo_ministerial,pastor_presidente,pastor_auxiliar,jubilado,status,nome_conjuge,cpf_conjuge,data_nascimento_conjuge')
    .eq('cpf_conjuge', cpf)
    .limit(1);

  if (conjError) {
    return NextResponse.json({ error: conjError.message }, { status: 500 });
  }

  if (conjData && conjData.length > 0) {
    const row = conjData[0];
    const conjugeJubilado = !!row.jubilado;
    
    // Se o cônjuge (titular) for jubilado, valida como esposa de jubilado
    return NextResponse.json({
      encontrado: true,
      lookup_kind: conjugeJubilado ? 'conjuge_jubilado' : null,
      conjuge_jubilado_validado: conjugeJubilado,
      conjuge_de_ministro_id: row.id,
      conjuge_de_nome: row.name,
      nome: row.nome_conjuge || null,
      sexo: 'F',
      data_nascimento: row.data_nascimento_conjuge || null,
      supervisao_id: row.supervisao_id || null,
      campo_id: row.campo_id || null,
      status: row.status || null,
    });
  }

  return NextResponse.json({ encontrado: false });
}
