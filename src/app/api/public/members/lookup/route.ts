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

function readCustomField(obj: Record<string, unknown> | null | undefined, keys: string[]) {
  if (!obj) return null;
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
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
    .select('name,email,email2,phone,whatsapp,celular,sexo,data_nascimento,supervisao_id,congregacao_id,congregacoes!congregacao_id(nome,campo_id),custom_fields,matricula,cargo_ministerial,pastor_presidente,pastor_auxiliar,jubilado,status,nome_conjuge,cpf_conjuge,data_nascimento_conjuge')
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
    email?: string | null;
    email2?: string | null;
    phone?: string | null;
    whatsapp?: string | null;
    celular?: string | null;
    sexo?: string | null;
    data_nascimento?: string | null;
    supervisao_id?: string | null;
    congregacao_id?: string | null;
    congregacoes?: { nome?: string | null; campo_id?: string | null } | null;
    custom_fields?: Record<string, unknown> | null;
    matricula?: string | null;
    cargo_ministerial?: string | null;
    pastor_presidente?: boolean | null;
    pastor_auxiliar?: boolean | null;
    jubilado?: boolean | null;
    status?: string | null;
    nome_conjuge?: string | null;
    cpf_conjuge?: string | null;
    data_nascimento_conjuge?: string | null;
  };

  // Normaliza sexo: aceita "MASCULINO"/"M" → "M" e "FEMININO"/"F" → "F"
  const sexoRaw = (row.sexo || '').toUpperCase();
  const sexoNorm = sexoRaw.startsWith('M') ? 'M' : sexoRaw.startsWith('F') ? 'F' : null;

  // campo_id pode vir via congregacao (FK) ou do custom_fields (texto histórico)
  const campoIdViaFk = row.congregacoes?.campo_id || null;
  const campoNomeViaCf = readCustomField(row.custom_fields, ['campo']);
  const supervisaoNomeViaCf = readCustomField(row.custom_fields, ['supervisao']);
  const email = row.email || row.email2 || readCustomField(row.custom_fields, ['email']);
  const whatsapp = row.whatsapp || readCustomField(row.custom_fields, ['whatsapp']);
  const telefone = row.phone || row.celular || readCustomField(row.custom_fields, ['celular', 'telefone', 'phone', 'mobile']);

  let supervisaoNome: string | null = null;
  if (row.supervisao_id) {
    const { data: supervisaoRow } = await supabase
      .from('supervisoes')
      .select('nome')
      .eq('id', row.supervisao_id)
      .maybeSingle();
    supervisaoNome = (supervisaoRow as { nome?: string | null } | null)?.nome?.trim() || null;
  }

  let campoNome: string | null = campoNomeViaCf;
  if (campoIdViaFk) {
    const { data: campoRow } = await supabase
      .from('campos')
      .select('nome')
      .eq('id', campoIdViaFk)
      .maybeSingle();
    campoNome = (campoRow as { nome?: string | null } | null)?.nome?.trim() || campoNomeViaCf;
  }

  return NextResponse.json({
    encontrado: true,
    nome: row.name || null,
    email,
    whatsapp,
    telefone,
    celular: row.celular || readCustomField(row.custom_fields, ['celular']),
    phone: row.phone || null,
    sexo: sexoNorm,
    data_nascimento: row.data_nascimento || null,
    supervisao_id: row.supervisao_id || null,
    supervisao_nome: supervisaoNome || supervisaoNomeViaCf,
    campo_id: campoIdViaFk,
    campo_nome: campoNome,
    congregacao_id: row.congregacao_id || null,
    congregacao_nome: row.congregacoes?.nome?.trim() || readCustomField(row.custom_fields, ['congregacao']),
    ...(includeMatricula ? { matricula: row.matricula || null } : {}),
    cargo_ministerial: row.cargo_ministerial || null,
    pastor_presidente: !!row.pastor_presidente,
    pastor_auxiliar: !!row.pastor_auxiliar,
    jubilado: !!row.jubilado,
    status: row.status || null,
    ...(includeMatricula ? {
      nome_conjuge: row.nome_conjuge || null,
      cpf_conjuge: row.cpf_conjuge || null,
      data_nascimento_conjuge: row.data_nascimento_conjuge || null,
    } : {}),
  });
}
