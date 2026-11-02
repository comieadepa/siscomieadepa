/**
 * POST /api/portal-ministro/auth/first-access/verify-and-create
 * Descontinuado / Protegido contra assunção indevida de cadastro:
 * A criação de senha no Primeiro Acesso agora exige validação prévia de titularidade
 * via link único enviado ao e-mail confiável previamente homologado na Secretaria Geral.
 *
 * Utilize:
 * 1. POST /api/portal-ministro/auth/first-access/validate-registro (valida CPF + Registro Convencional e envia link)
 * 2. POST /api/portal-ministro/auth/reset-password (define a senha usando o token único recebido no e-mail)
 */

import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json(
    {
      error:
        'Fluxo de primeiro acesso atualizado por segurança institucional. O primeiro acesso agora exige confirmação única via link enviado ao seu e-mail convencional previamente cadastrado na Secretaria Geral.',
      codigo: 'FLUXO_PRIMEIRO_ACESSO_SEGURO_EXIGIDO',
    },
    { status: 403 },
  );
}
