import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';

function onlyDigits(value: string | null | undefined): string {
  return (value || '').replace(/\D/g, '');
}

/**
 * Sanitiza o termo de busca para PostgreSQL Websearch / ILIKE
 */
function sanitizeSearchTerm(term: string): string {
  return term.replace(/[%_,]/g, ' ').trim();
}

/**
 * GET /api/public/aemadepa/ministros?q=termo
 * Rota pública para busca dinâmica de ministros por nome ou matrícula.
 *
 * Em conformidade com a LGPD e as regras de segurança do SISCOMIEADEPA:
 * - NUNCA retorna CPFs, telefones, e-mails ou documentos de ninguém.
 * - NUNCA expõe dados pessoais da esposa nesta rota (mesmo com busca por ID).
 * - Retorna apenas metadados públicos essenciais para localização do ministro.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const q = sanitizeSearchTerm(searchParams.get('q') || '');

    // Busca mínima de 2 caracteres
    if (!q || q.length < 2) {
      return NextResponse.json({ ministros: [] });
    }

    const supabase = createServerClient();
    const qDigits = onlyDigits(q);

    // Seleciona apenas os campos estritamente necessários para identificação visual
    let query = supabase
      .from('members')
      .select('id, name, matricula, cargo_ministerial, status, jubilado, custom_fields, nome_conjuge')
      .limit(25);

    const orClauses: string[] = [
      `name.ilike.%${q}%`,
      `matricula.ilike.%${q}%`,
    ];

    if (qDigits && qDigits.length >= 4) {
      orClauses.push(`matricula.ilike.%${qDigits}%`);
    }

    query = query.or(orClauses.join(','));

    const { data: rows, error } = await query;

    if (error) {
      console.error('Erro na query de ministros AEMADEPA:', error);
      return NextResponse.json({ error: 'Erro ao consultar ministros' }, { status: 500 });
    }

    const ministros = (rows || []).map((m: any) => {
      const cf = m.custom_fields && typeof m.custom_fields === 'object' ? m.custom_fields : {};
      const nomeEsposa = String(m.nome_conjuge || cf.nomeConjuge || '').trim();
      const temEsposa = Boolean(nomeEsposa && nomeEsposa.length > 0);

      return {
        id: m.id,
        nome: String(m.name || cf.nome || '').trim(),
        matricula: String(m.matricula || cf.matricula || '').trim(),
        cargo: String(m.cargo_ministerial || cf.cargoMinisterial || 'PASTOR').trim(),
        campo: String(cf.campo || '').trim(),
        supervisao: String(cf.supervisao || '').trim(),
        temEsposaCadastrada: temEsposa,
        status: m.jubilado ? 'JUBILADO' : String(m.status || 'ATIVO').toUpperCase(),
      };
    });

    return NextResponse.json({ ministros });
  } catch (err: any) {
    console.error('Erro na rota pública de ministros AEMADEPA:', err);
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 });
  }
}
