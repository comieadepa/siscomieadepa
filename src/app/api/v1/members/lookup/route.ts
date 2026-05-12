import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { requireRole } from '@/lib/auth/require-auth';

const LOOKUP_ROLES = ['super', 'administrador', 'comissao', 'inscricao', 'financeiro', 'cgadb'] as const;

function onlyDigits(value: string) {
  return (value || '').replace(/\D/g, '');
}

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, LOOKUP_ROLES);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const search = (searchParams.get('search') || '').trim();
  const cpfParam = (searchParams.get('cpf') || '').trim();
  const emailParam = (searchParams.get('email') || '').trim();
  const idsParam = (searchParams.get('ids') || '').trim();
  const idParam = (searchParams.get('id') || '').trim();
  const limitParam = Number(searchParams.get('limit') || '10');
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 100) : 10;

  const supabase = createServerClient();
  let query = supabase
    .from('members')
    .select('*')
    .limit(limit);

  if (cpfParam) {
    const cpfDigits = onlyDigits(cpfParam);
    if (cpfDigits) {
      query = query.eq('cpf', cpfDigits);
    }
  } else if (emailParam) {
    query = query.ilike('email', emailParam.toLowerCase());
  } else if (idParam) {
    query = query.eq('id', idParam);
  } else if (idsParam) {
    const ids = idsParam.split(',').map((value) => value.trim()).filter(Boolean);
    if (ids.length > 0) {
      query = query.in('id', ids);
    }
  } else if (search) {
    const cpfDigits = onlyDigits(search);
    if (cpfDigits) {
      query = query.or(`name.ilike.%${search}%,cpf.like.%${cpfDigits}%`);
    } else {
      query = query.ilike('name', `%${search}%`);
    }
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const mapped = (data ?? []).map((row) => {
    const record = row as Record<string, unknown>;
    const nome = (record.nome ?? record.name ?? null) as string | null;
    const celular = (record.celular ?? record.phone ?? null) as string | null;
    const dataNascimento = (record.data_nascimento ?? record.birth_date ?? null) as string | null;
    const sexo = (record.sexo ?? record.gender ?? null) as string | null;
    const profissao = (record.profissao ?? record.occupation ?? null) as string | null;

    return {
      id: record.id as string,
      name: (record.name ?? nome ?? null) as string | null,
      nome,
      cpf: (record.cpf ?? null) as string | null,
      matricula: (record.matricula ?? null) as string | null,
      data_nascimento: dataNascimento,
      sexo,
      role: (record.role ?? record.tipo_cadastro ?? null) as string | null,
      profissao,
      phone: (record.phone ?? celular ?? null) as string | null,
      celular,
      whatsapp: (record.whatsapp ?? null) as string | null,
      email: (record.email ?? null) as string | null,
      supervisao: (record.supervisao ?? null) as string | null,
      supervisao_id: (record.supervisao_id ?? null) as string | null,
      campo: (record.campo ?? null) as string | null,
      campo_id: (record.campo_id ?? null) as string | null,
      cargo_ministerial: (record.cargo_ministerial ?? null) as string | null,
      tipo_cadastro: (record.tipo_cadastro ?? record.role ?? null) as string | null,
      status: (record.status ?? null) as string | null,
      custom_fields: (record.custom_fields ?? null) as unknown,
    };
  });

  return NextResponse.json({ data: mapped });
}
