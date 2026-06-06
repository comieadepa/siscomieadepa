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
    .select('name,email,email2,phone,whatsapp,celular,sexo,data_nascimento,supervisao_id,congregacao_id,congregacoes!congregacao_id(nome,campo_id),custom_fields,matricula,cargo_ministerial,pastor_presidente,pastor_auxiliar,jubilado,status,estado_civil,nome_conjuge,cpf_conjuge,data_nascimento_conjuge')
    .eq('cpf', cpf)
    .limit(1);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data || data.length === 0) {
    const { data: conjugeRows, error: conjugeErr } = await supabase
      .from('members')
      .select('id,name,status,jubilado,estado_civil,nome_conjuge,cpf_conjuge,data_nascimento_conjuge,supervisao_id,congregacao_id,congregacoes!congregacao_id(nome,campo_id),custom_fields')
      .eq('jubilado', true)
      .in('status', ['active', 'ativo'])
      .eq('cpf_conjuge', cpf)
      .limit(5);

    if (conjugeErr) {
      return NextResponse.json({ error: conjugeErr.message }, { status: 500 });
    }

    const conjugeRow = (conjugeRows ?? []).find((r) => {
      const nomeConjuge = String((r as any).nome_conjuge || '').trim();
      const cpfConjuge = onlyDigits(String((r as any).cpf_conjuge || ''));
      const estadoCivilNorm = String((r as any).estado_civil || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
      return !!nomeConjuge
        && cpfConjuge.length === 11
        && cpfConjuge === cpf
        && (estadoCivilNorm.includes('casad'));
    }) as {
      id?: string | null;
      name?: string | null;
      status?: string | null;
      nome_conjuge?: string | null;
      cpf_conjuge?: string | null;
      data_nascimento_conjuge?: string | null;
      supervisao_id?: string | null;
      congregacao_id?: string | null;
      congregacoes?: { nome?: string | null; campo_id?: string | null } | null;
      custom_fields?: Record<string, unknown> | null;
    } | undefined;

    if (!conjugeRow) {
      return NextResponse.json({ encontrado: false });
    }

    const campoIdViaFkConjuge = conjugeRow.congregacoes?.campo_id || null;
    const campoNomeViaCfConjuge = readCustomField(conjugeRow.custom_fields, ['campo']);
    const supervisaoNomeViaCfConjuge = readCustomField(conjugeRow.custom_fields, ['supervisao']);

    let supervisaoNomeConjuge: string | null = null;
    if (conjugeRow.supervisao_id) {
      const { data: supervisaoRow } = await supabase
        .from('supervisoes')
        .select('nome')
        .eq('id', conjugeRow.supervisao_id)
        .maybeSingle();
      supervisaoNomeConjuge = (supervisaoRow as { nome?: string | null } | null)?.nome?.trim() || null;
    }

    let campoNomeConjuge: string | null = campoNomeViaCfConjuge;
    if (campoIdViaFkConjuge) {
      const { data: campoRow } = await supabase
        .from('campos')
        .select('nome')
        .eq('id', campoIdViaFkConjuge)
        .maybeSingle();
      campoNomeConjuge = (campoRow as { nome?: string | null } | null)?.nome?.trim() || campoNomeViaCfConjuge;
    }

    return NextResponse.json({
      encontrado: true,
      lookup_kind: 'conjuge_jubilado',
      conjuge_jubilado_validado: true,
      nome: conjugeRow.nome_conjuge || null,
      sexo: 'F',
      data_nascimento: conjugeRow.data_nascimento_conjuge || null,
      supervisao_id: conjugeRow.supervisao_id || null,
      supervisao_nome: supervisaoNomeConjuge || supervisaoNomeViaCfConjuge,
      campo_id: campoIdViaFkConjuge,
      campo_nome: campoNomeConjuge,
      congregacao_id: conjugeRow.congregacao_id || null,
      congregacao_nome: conjugeRow.congregacoes?.nome?.trim() || readCustomField(conjugeRow.custom_fields, ['congregacao']),
      conjuge_de_ministro_id: conjugeRow.id || null,
      conjuge_de_nome: conjugeRow.name || null,
      status: conjugeRow.status || null,
      jubilado: false,
      pastor_presidente: false,
      pastor_auxiliar: false,
    });
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
    estado_civil?: string | null;
    nome_conjuge?: string | null;
    cpf_conjuge?: string | null;
    data_nascimento_conjuge?: string | null;
  };

  // Normaliza sexo: aceita "MASCULINO"/"M" → "M" e "FEMININO"/"F" → "F"
  const sexoRaw = (row.sexo || '').toUpperCase();
  let sexoNorm = sexoRaw.startsWith('M') ? 'M' : sexoRaw.startsWith('F') ? 'F' : null;
  if (!sexoNorm) {
    // Se não tiver sexo no cadastro, mas for ministro (tem cargo ou matrícula), assume-se Masculino
    if (row.cargo_ministerial || row.matricula) {
      sexoNorm = 'M';
    }
  }

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
    lookup_kind: 'ministro',
    conjuge_jubilado_validado: false,
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
