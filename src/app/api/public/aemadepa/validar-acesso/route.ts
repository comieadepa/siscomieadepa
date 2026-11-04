import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { signAemadepaToken } from '@/lib/aemadepa-token';
import { consumeDistributedRateLimit } from '@/lib/rate-limit-distributed';

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // Janela e bloqueio de 15 minutos (900s)

function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.headers.get('x-real-ip') || 'unknown-ip';
}

function onlyDigits(value: string | null | undefined): string {
  return (value || '').replace(/\D/g, '');
}

/**
 * Normaliza qualquer data (YYYY-MM-DD, DD/MM/YYYY, ISO string) para YYYY-MM-DD
 */
function normalizeDate(raw: string | null | undefined): string {
  if (!raw) return '';
  const str = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    return str.slice(0, 10);
  }
  const match = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (match) {
    const dia = match[1].padStart(2, '0');
    const mes = match[2].padStart(2, '0');
    const ano = match[3];
    return `${ano}-${mes}-${dia}`;
  }
  return '';
}

/**
 * POST /api/public/aemadepa/validar-acesso
 * Valida o desafio de CPF + Data de Nascimento no servidor.
 * Protegido por rate limiting distribuído sincronizado entre lambdas da Vercel (Supabase RPC).
 *
 * Regras estritas de conformidade LGPD:
 * 1. Se a esposa JÁ estiver cadastrada: exige exclusivamente CPF + nascimento DELA.
 * 2. Se for primeiro cadastro: exige CPF + nascimento do ministro (esposo).
 * 3. Cadastros legados sem CPF/nascimento da esposa cadastrados devem seguir regularização administrativa,
 *    sem exposição pública ou alternativas de bypass.
 * 4. Não informa qual campo está incorreto para prevenir enumeração/ataques.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: 'Parâmetros inválidos' }, { status: 400 });
    }

    const { ministroId, cpf, dataNascimento } = body;

    if (!ministroId || !cpf || !dataNascimento) {
      return NextResponse.json(
        { error: 'Informe o CPF e a Data de Nascimento para validação.' },
        { status: 400 }
      );
    }

    const ip = getClientIp(request);
    const rateLimitKey = `aemadepa_auth:${ip}:${ministroId}`;

    // Rate Limit Distribuído entre instâncias da Vercel (5 tentativas em 15 minutos)
    const rateCheck = await consumeDistributedRateLimit({
      key: rateLimitKey,
      limit: MAX_ATTEMPTS,
      windowMs: WINDOW_MS,
    });

    if (!rateCheck.allowed) {
      const waitMin = Math.max(Math.ceil((rateCheck.retryAfterSeconds || 60) / 60), 1);
      return NextResponse.json(
        {
          error: `Muitas tentativas incorretas. Por segurança, tente novamente em ${waitMin} minuto(s).`,
        },
        {
          status: 429,
          headers: {
            'Retry-After': String(rateCheck.retryAfterSeconds || 900),
          },
        }
      );
    }

    const inputCpfDigits = onlyDigits(cpf);
    const inputDataNorm = normalizeDate(dataNascimento);

    if (inputCpfDigits.length !== 11 || !inputDataNorm) {
      return NextResponse.json(
        { error: 'Dados não conferem. Verifique o CPF e a data de nascimento informados.' },
        { status: 403 }
      );
    }

    const supabase = createServerClient();
    const { data: membro, error } = await supabase
      .from('members')
      .select('*')
      .eq('id', ministroId)
      .single();

    if (error || !membro) {
      return NextResponse.json(
        { error: 'Dados não conferem. Verifique o CPF e a data de nascimento informados.' },
        { status: 403 }
      );
    }

    const cf = membro.custom_fields && typeof membro.custom_fields === 'object' ? membro.custom_fields : {};
    const nomeEsposa = String(membro.nome_conjuge || cf.nomeConjuge || '').trim();
    const temEsposa = Boolean(nomeEsposa && nomeEsposa.length > 0);

    let match = false;
    let operacao: 'primeiro_cadastro' | 'edicao_esposa' = temEsposa ? 'edicao_esposa' : 'primeiro_cadastro';

    if (temEsposa) {
      // Caso 1: Esposa já cadastrada
      // Validação estrita e exclusiva: CPF e Data de Nascimento DELA
      const dbCpfEsposa = onlyDigits(membro.cpf_conjuge || cf.cpfConjuge);
      const dbDataNascEsposa = normalizeDate(membro.data_nascimento_conjuge || cf.dataNascimentoConjuge);

      if (dbCpfEsposa && dbDataNascEsposa) {
        if (inputCpfDigits === dbCpfEsposa && inputDataNorm === dbDataNascEsposa) {
          match = true;
        }
      } else {
        // Registro legado sem CPF ou sem Data de Nascimento da esposa no banco:
        // Por diretriz de segurança e privacidade, bloqueia acesso público e orienta regularização
        return NextResponse.json(
          {
            error:
              'Cadastro existente com pendência de regularização cadastral. Por favor, entre em contato com a Secretaria da COMIEADEPA / AEMADEPA para atualizar seus dados com segurança.',
            requerRegularizacao: true,
          },
          { status: 403 }
        );
      }
    } else {
      // Caso 2: Primeiro cadastro da esposa
      // Validação obrigatória dos dados oficiais do ministro (esposo)
      const dbCpfMinistro = onlyDigits(membro.cpf || cf.cpf);
      const dbDataNascMinistro = normalizeDate(membro.data_nascimento || cf.dataNascimento);

      if (dbCpfMinistro && dbDataNascMinistro) {
        if (inputCpfDigits === dbCpfMinistro && inputDataNorm === dbDataNascMinistro) {
          match = true;
        }
      }
    }

    if (!match) {
      return NextResponse.json(
        { error: 'Dados não conferem. Verifique o CPF e a data de nascimento informados.' },
        { status: 403 }
      );
    }

    // Sucesso na autenticação do desafio!
    const token = signAemadepaToken(ministroId, operacao);

    // Se for edição, libera os dados pessoais da esposa para preenchimento seguro do formulário
    let dadosEsposa = null;
    if (operacao === 'edicao_esposa') {
      dadosEsposa = {
        nome: nomeEsposa,
        cpf: String(membro.cpf_conjuge || cf.cpfConjuge || '').trim(),
        rg: String(membro.conjuge_rg || cf.conjugeRg || '').trim(),
        orgao_emissor: String(membro.conjuge_orgao_emissor || cf.conjugeOrgaoEmissor || '').trim(),
        data_nascimento: normalizeDate(membro.data_nascimento_conjuge || cf.dataNascimentoConjuge),
        nacionalidade: String(membro.conjuge_nacionalidade || cf.conjugeNacionalidade || 'BRASILEIRA').trim(),
        naturalidade: String(membro.conjuge_naturalidade || cf.conjugeNaturalidade || '').trim(),
        nome_pai: String(membro.conjuge_nome_pai || cf.conjugeNomePai || '').trim(),
        nome_mae: String(membro.conjuge_nome_mae || cf.conjugeNomeMae || '').trim(),
        titulo_eleitoral: String(membro.conjuge_titulo_eleitoral || cf.conjugeTituloEleitoral || '').trim(),
        fone: String(membro.conjuge_fone || cf.conjugeFone || '').trim(),
        email: String(membro.conjuge_email || cf.conjugeEmail || '').trim(),
        tipo_sanguineo: String(membro.conjuge_tipo_sanguineo || cf.conjugeTipoSanguineo || '').trim(),
        foto_url: membro.conjuge_foto_url || cf.conjugeFotoUrl || null,
      };
    }

    return NextResponse.json({
      success: true,
      token,
      operacao,
      dadosEsposa,
    });
  } catch (err: any) {
    console.error('Erro na validação de acesso AEMADEPA:', err);
    return NextResponse.json({ error: 'Erro interno do servidor ao validar acesso.' }, { status: 500 });
  }
}
