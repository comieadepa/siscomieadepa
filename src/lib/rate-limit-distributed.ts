import { createServerClient } from '@/lib/supabase-server';

export type DistributedRateLimitResult = {
  allowed: boolean;
  retryAfterSeconds: number;
  source: 'db';
};

/**
 * Consome limite de taxa distribuído no banco Supabase (`public.rate_limit_buckets`)
 * via RPC atômica `public.consume_rate_limit`.
 * Funciona de forma centralizada e sincronizada entre instâncias e lambdas serverless em produção (Vercel).
 *
 * Diretriz de Falha Segura (Fail-Closed para Autenticação):
 * Se a infraestrutura de rate limit estiver indisponível ou retornar erro, a requisição é bloqueada
 * (não permitindo bypass ou fallback permissivo em memória), protegendo os endpoints contra força bruta.
 */
export async function consumeDistributedRateLimit(params: {
  key: string;
  limit: number;
  windowMs: number;
}): Promise<DistributedRateLimitResult> {
  const windowSeconds = Math.max(Math.floor(params.windowMs / 1000), 1);
  const refillRate = params.limit / windowSeconds;

  try {
    const supabase = createServerClient();
    const { data: allowed, error } = await supabase.rpc('consume_rate_limit', {
      p_key: params.key,
      p_max_tokens: params.limit,
      p_refill_rate: refillRate,
      p_cost: 1,
    });

    if (error || typeof allowed !== 'boolean') {
      console.error('[rate-limit-distributed] Erro na RPC de rate limit (Falha Segura Ativada):', error?.message);
      // Falha Segura: bloqueia temporariamente a requisição em vez de permitir bypass
      return {
        allowed: false,
        retryAfterSeconds: 15,
        source: 'db',
      };
    }

    return {
      allowed,
      retryAfterSeconds: allowed ? 0 : Math.ceil(1 / refillRate),
      source: 'db',
    };
  } catch (err: unknown) {
    console.error('[rate-limit-distributed] Exceção na verificação distribuída (Falha Segura Ativada):', err);
    // Falha Segura: bloqueia temporariamente a requisição em vez de permitir bypass
    return {
      allowed: false,
      retryAfterSeconds: 15,
      source: 'db',
    };
  }
}
