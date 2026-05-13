/**
 * Helper central de auditoria.
 * Chame registrarAuditoria() em ações importantes do sistema.
 * - Nunca registra senhas, tokens ou chaves.
 * - CPFs devem ser mascarados antes de passar em `detalhes`.
 * - Fire-and-forget: erros de log não propagam para o caller.
 */

export interface AuditoriaParams {
  userId?: string;
  userEmail?: string;
  acao:
    | 'criar'
    | 'editar'
    | 'deletar'
    | 'visualizar'
    | 'exportar'
    | 'importar'
    | 'login'
    | 'logout'
    | 'checkin'
    | 'enviar_certificado'
    | 'baixa_financeira'
    | 'alterar_permissoes'
    | 'upload'
    | 'download'
    | 'erro_critico'
    | string;
  modulo:
    | 'eventos'
    | 'inscricoes'
    | 'financeiro'
    | 'membros'
    | 'secretaria'
    | 'usuarios'
    | 'configuracoes'
    | 'certificados'
    | 'checkin'
    | 'etiquetas'
    | 'auditoria'
    | 'auth'
    | string;
  entidade?: string;
  entidadeId?: string;
  descricao?: string;
  status?: 'sucesso' | 'erro' | 'aviso';
  detalhes?: Record<string, unknown>;
  mensagemErro?: string;
  /** IP do cliente — preencher quando disponível (em route handlers) */
  ip?: string;
  userAgent?: string;
}

/**
 * Registra uma entrada de auditoria via API route.
 * Deve ser chamado do lado do servidor (route handlers / Server Actions).
 *
 * @example
 * await registrarAuditoria({ userId: user.id, userEmail: user.email, acao: 'criar', modulo: 'eventos', entidadeId: evento.id });
 */
export async function registrarAuditoria(
  params: AuditoriaParams,
  requestOrBaseUrl?: Request | string,
): Promise<void> {
  try {
    // Determinar base URL
    let baseUrl = 'http://localhost:3000';
    if (typeof requestOrBaseUrl === 'string') {
      baseUrl = requestOrBaseUrl;
    } else if (requestOrBaseUrl instanceof Request) {
      const u = new URL(requestOrBaseUrl.url);
      baseUrl = `${u.protocol}//${u.host}`;
    } else if (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_APP_URL) {
      baseUrl = process.env.NEXT_PUBLIC_APP_URL;
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Encaminhar authorization se disponível na request original
    if (requestOrBaseUrl instanceof Request) {
      const auth = requestOrBaseUrl.headers.get('authorization');
      if (auth) headers['authorization'] = auth;
      const cookie = requestOrBaseUrl.headers.get('cookie');
      if (cookie) headers['cookie'] = cookie;
    }

    await fetch(`${baseUrl}/api/v1/audit-logs`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        usuario_email: params.userEmail,
        acao: params.acao,
        modulo: params.modulo,
        area: params.entidade,
        tabela_afetada: params.entidade,
        registro_id: params.entidadeId,
        descricao: params.descricao,
        dados_novos: params.detalhes ?? null,
        status: params.status ?? 'sucesso',
        mensagem_erro: params.mensagemErro,
      }),
    });
  } catch {
    // Logs de auditoria nunca devem quebrar o fluxo principal
  }
}

/**
 * Mascara um CPF para exibição segura: "123.456.789-00" → "123.***.***-00"
 */
export function mascaraCpf(cpf: string | null | undefined): string {
  if (!cpf) return '—';
  const limpo = cpf.replace(/\D/g, '');
  if (limpo.length !== 11) return '***';
  return `${limpo.slice(0, 3)}.***.***-${limpo.slice(9)}`;
}
