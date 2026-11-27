import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { cleanCpf, isValidCpf } from '@/lib/cpf';
import { signUmadespaToken } from '@/lib/umadespa';
import { consumeDistributedRateLimit } from '@/lib/rate-limit-distributed';

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutos

function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.headers.get('x-real-ip') || 'unknown-ip';
}

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
 * POST /api/public/umadespa/validar-acesso
 * Valida o acesso do jovem através do desafio de segurança (CPF + Data de Nascimento).
 * Retorna token HMAC temporário (15 min) para prosseguir com visualização, atualização ou pedido de carteirinha.
 * Protegido contra enumeração e brute-force com rate limiting distribuído.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: 'Parâmetros inválidos.' }, { status: 400 });
    }

    const { cpf, dataNascimento } = body;

    const cpfLimpo = cleanCpf(cpf);
    if (!cpfLimpo || cpfLimpo.length !== 11 || !isValidCpf(cpfLimpo)) {
      return NextResponse.json({ error: 'Informe um CPF válido com 11 dígitos.' }, { status: 400 });
    }

    const dataNascNorm = normalizeDate(dataNascimento);
    if (!dataNascNorm) {
      return NextResponse.json({ error: 'Informe uma Data de Nascimento válida (DD/MM/AAAA).' }, { status: 400 });
    }

    // Rate Limiting distribuído por IP + CPF
    const ip = getClientIp(request);
    const rateLimitKey = `umadespa_auth:${ip}:${cpfLimpo}`;
    const rateLimit = await consumeDistributedRateLimit({
      key: rateLimitKey,
      limit: MAX_ATTEMPTS,
      windowMs: WINDOW_MS,
    });

    if (!rateLimit.allowed) {
      return NextResponse.json(
        {
          error: 'Muitas tentativas incorretas. Por segurança, aguarde alguns minutos antes de tentar novamente.',
          retryAfterSeconds: rateLimit.retryAfterSeconds,
        },
        { status: 429 }
      );
    }

    const supabase = createServerClient();

    // Consulta cadastro existente do associado
    const { data: associado, error } = await supabase
      .from('umadespa_associados')
      .select(`
        id,
        nome,
        cpf,
        data_nascimento,
        status,
        fone,
        email,
        foto_url,
        funcao,
        is_lideranca,
        menor_idade,
        supervisao_id,
        campo_id,
        congregacao_id,
        supervisao:supervisoes(id, nome),
        campo:campos(id, nome),
        congregacao:congregacoes(id, nome)
      `)
      .eq('cpf', cpfLimpo)
      .maybeSingle();

    if (error) {
      console.error('[UMADESPA PUBLIC AUTH] Erro ao consultar associado:', error);
      return NextResponse.json({ error: 'Erro ao verificar cadastro.' }, { status: 500 });
    }

    // Se não encontrou cadastro, indica que o jovem pode se cadastrar (Primeiro Acesso)
    if (!associado) {
      // Gera token temporário de pré-autorização para cadastro inicial
      const tokenPre = signUmadespaToken('novo', 'primeiro_cadastro');

      return NextResponse.json({
        existe: false,
        token: tokenPre,
        cpf: cpfLimpo,
        dataNascimento: dataNascNorm,
        mensagem: 'Cadastro não localizado. Você pode prosseguir com a ficha de inscrição inicial.',
      });
    }

    // Se já existe cadastro, compara a data de nascimento
    const dbDataNascNorm = normalizeDate(associado.data_nascimento);
    if (dbDataNascNorm !== dataNascNorm) {
      // Resposta genérica para mitigar enumeração de dados
      return NextResponse.json(
        {
          error: 'Os dados informados não conferem com os registros. Verifique o CPF e a Data de Nascimento.',
        },
        { status: 401 }
      );
    }

    // Gera token de sessão HMAC válido por 15 minutos
    const token = signUmadespaToken(associado.id, 'edicao_associado');

    // Busca última carteirinha solicitada
    const { data: ultimasCarteirinhas } = await supabase
      .from('umadespa_carteirinhas_solicitacoes')
      .select('id, via, valor, validade_data, status, solicitado_em, pago_em, impresso_em, entregue_em')
      .eq('associado_id', associado.id)
      .order('via', { ascending: false })
      .limit(1);

    const carteirinhaAtual = ultimasCarteirinhas && ultimasCarteirinhas.length > 0 ? ultimasCarteirinhas[0] : null;

    return NextResponse.json({
      existe: true,
      token,
      associado: {
        id: associado.id,
        nome: associado.nome,
        cpf: associado.cpf,
        data_nascimento: associado.data_nascimento,
        status: associado.status,
        fone: associado.fone,
        email: associado.email,
        foto_url: associado.foto_url,
        funcao: associado.funcao,
        is_lideranca: associado.is_lideranca,
        menor_idade: associado.menor_idade,
        supervisao: associado.supervisao,
        campo: associado.campo,
        congregacao: associado.congregacao,
        carteirinha_atual: carteirinhaAtual,
      },
    });
  } catch (err: any) {
    console.error('[UMADESPA PUBLIC AUTH] Erro fatal em /validar-acesso:', err);
    return NextResponse.json({ error: 'Erro interno ao processar validação.' }, { status: 500 });
  }
}
