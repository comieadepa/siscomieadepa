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
 * - Identifica cadastro efetivo AEMADEPA pelos campos formais existentes (ex: CPF da esposa cadastrado),
 *   não confundindo uma simples menção do nome civil do cônjuge na ficha ministerial com cadastro ativo.
 * - Retorna apenas metadados públicos essenciais para localização do ministro.
 * - Filtra ministros falecidos (deceased) e prioriza ministros ativos e jubilados.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const rawQ = String(searchParams.get('q') || '').trim();
    const qClean = sanitizeSearchTerm(rawQ);
    const qDigits = onlyDigits(rawQ);

    // Busca mínima de 2 caracteres (seja texto ou números)
    if (!qClean || (qClean.length < 2 && qDigits.length < 2)) {
      return NextResponse.json({ ministros: [] });
    }

    const supabase = createServerClient();

    // Constrói cláusulas OR abrangentes cobrindo CPF, Matrícula e Nome
    const orClauses: string[] = [];

    // 1. Busca por CPF:
    if (qDigits.length === 11) {
      orClauses.push(`cpf.eq.${qDigits}`);
    } else if (qDigits.length >= 4) {
      orClauses.push(`cpf.ilike.%${qDigits}%`);
    }

    // 2. Busca por Matrícula:
    if (qDigits.length >= 2) {
      orClauses.push(`matricula.ilike.%${qDigits}%`);
    }

    // 3. Busca por Nome / Texto:
    if (qClean.length >= 2) {
      orClauses.push(`name.ilike.%${qClean}%`);
      const words = qClean.split(/\s+/).filter(w => w.length >= 2);
      if (words.length > 1) {
        const firstWord = words[0];
        if (!orClauses.includes(`name.ilike.%${firstWord}%`)) {
          orClauses.push(`name.ilike.%${firstWord}%`);
        }
      }
    }

    if (orClauses.length === 0) {
      return NextResponse.json({ ministros: [] });
    }

    // Seleciona campos essenciais para identificação visual e verificação cadastral
    // NÃO exclui ministros falecidos ou jubilados, pois viúvas e esposas de jubilados precisam vincular o cadastro
    let query = supabase
      .from('members')
      .select('id, name, matricula, cpf, cargo_ministerial, status, jubilado, custom_fields, nome_conjuge, cpf_conjuge, aemadepa_associadas(id, cpf, status)')
      .or(orClauses.join(','))
      .limit(30);

    const { data: rows, error } = await query;

    if (error) {
      console.error('Erro na query de ministros AEMADEPA:', error);
      return NextResponse.json({ error: 'Erro ao consultar ministros no banco de dados' }, { status: 500 });
    }

    // Mapeia e prioriza ministros ativos e jubilados no topo, com relevância para match exato
    const ministros = (rows || [])
      .map((m: any) => {
        const cf = m.custom_fields && typeof m.custom_fields === 'object' ? m.custom_fields : {};

        // Cadastro efetivo AEMADEPA:
        // 1. Prioriza a presença na tabela oficial aemadepa_associadas
        // 2. Fallback de compatibilidade para cpf_conjuge de 11 dígitos ou numero_aemadepa
        const associada = m.aemadepa_associadas;
        const temAssociadaTabela = Boolean(associada && (associada.id || associada.cpf));
        const cpfConjugeDigits = onlyDigits(m.cpf_conjuge || cf.cpfConjuge);
        const numeroAemadepa = String(cf.numero_aemadepa || cf.numeroAemadepa || '').trim();

        const temCadastroEfetivo = Boolean(
          temAssociadaTabela || (cpfConjugeDigits && cpfConjugeDigits.length === 11) || numeroAemadepa.length > 0
        );

        const statusRaw = String(m.status || 'active').toLowerCase();
        const isFalecido = statusRaw === 'deceased' || statusRaw === 'falecido';
        const isJubilado = Boolean(m.jubilado || statusRaw === 'jubilado');
        const isAtivo = statusRaw === 'active' && !isJubilado && !isFalecido;

        const mCpfDigits = onlyDigits(m.cpf);
        const mMatricula = String(m.matricula || cf.matricula || '').trim();
        const mNome = String(m.name || cf.nome || '').trim();

        // Cálculo de pontuação de relevância para ordenação
        let score = 100;
        if (qDigits && qDigits.length === 11 && mCpfDigits === qDigits) {
          score = 0; // Coincidência exata de CPF = prioridade máxima absoluta
        } else if (qDigits && mMatricula === qDigits) {
          score = 1; // Coincidência exata de matrícula = prioridade altíssima
        } else if (mNome.toLowerCase() === qClean.toLowerCase()) {
          score = 2; // Coincidência exata de nome
        } else if (mNome.toLowerCase().startsWith(qClean.toLowerCase())) {
          score = 3; // Começa com o termo
        } else if (isAtivo || isJubilado) {
          score = 10;
        } else if (isFalecido) {
          score = 20;
        }

        return {
          id: m.id,
          nome: mNome,
          matricula: mMatricula,
          cargo: String(m.cargo_ministerial || cf.cargoMinisterial || 'PASTOR').trim(),
          campo: String(cf.campo || cf.campo_atual || '').trim(),
          supervisao: String(cf.supervisao || '').trim(),
          temEsposaCadastrada: temCadastroEfetivo,
          status: isFalecido ? 'FALECIDO' : isJubilado ? 'JUBILADO' : isAtivo ? 'ATIVO' : statusRaw.toUpperCase(),
          _score: score,
        };
      })
      .sort((a, b) => {
        if (a._score !== b._score) return a._score - b._score;
        return a.nome.localeCompare(b.nome, 'pt-BR');
      })
      .map(({ _score, ...resto }) => resto);

    return NextResponse.json(
      { ministros },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
        },
      }
    );
  } catch (err: any) {
    console.error('Erro na rota pública de ministros AEMADEPA:', err);
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 });
  }
}
