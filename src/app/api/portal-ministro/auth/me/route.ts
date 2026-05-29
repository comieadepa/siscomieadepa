/**
 * GET /api/portal-ministro/auth/me
 * Retorna dados do ministro autenticado.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { getMinistroSession, unauthorizedResponse } from '@/lib/ministro-session';

const maskCpf = (cpf: string | null | undefined): string => {
  if (!cpf) return '';
  const digits = cpf.replace(/\D/g, '');
  if (digits.length !== 11) return cpf;
  return `${digits.slice(0, 3)}.***.***-${digits.slice(9)}`;
};

export async function GET(request: NextRequest) {
  const session = await getMinistroSession(request);
  if (!session) return unauthorizedResponse();

  const supabase = createServerClient();
  const { data: ministro, error } = await supabase
    .from('members')
    .select(`
      id, name, matricula, cpf, cargo_ministerial, status,
      foto_url, data_nascimento, data_validade_credencial, data_emissao,
      pastor_presidente, custom_fields, unique_id
    `)
    .eq('id', session.ministroId)
    .maybeSingle();

  if (error || !ministro) {
    return NextResponse.json({ error: 'Ministro não encontrado.' }, { status: 404 });
  }

  const cf = (ministro.custom_fields && typeof ministro.custom_fields === 'object')
    ? ministro.custom_fields as Record<string, any>
    : {};

  return NextResponse.json({
    id: ministro.id,
    nome: ministro.name,
    matricula: ministro.matricula,
    cpfMascarado: maskCpf(ministro.cpf),
    cargo: ministro.cargo_ministerial || cf.cargoMinisterial || cf.cargo_ministerial || '',
    status: ministro.status,
    supervisao: cf.supervisao || '',
    campo: cf.campo || '',
    congregacao: cf.congregacao || '',
    fotoUrl: ministro.foto_url || cf.fotoUrl || null,
    dataNascimento: ministro.data_nascimento,
    dataValidadeCredencial: ministro.data_validade_credencial,
    dataEmissao: ministro.data_emissao,
    isPastorPresidente: !!ministro.pastor_presidente,
    uniqueId: ministro.unique_id,
  });
}
