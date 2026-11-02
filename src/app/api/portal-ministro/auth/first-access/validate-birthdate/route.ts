/**
 * POST /api/portal-ministro/auth/first-access/validate-birthdate
 * Descontinuado / Redirecionado para validate-registro:
 * A confirmação de primeiro acesso agora utiliza CPF + Registro Convencional / Matrícula
 * e link único no e-mail confiável previamente homologado, impedindo assunção de cadastro por terceiros.
 */

import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json(
    {
      error:
        'Endpoint descontinuado por segurança institucional. Utilize o Primeiro Acesso com CPF e Registro Convencional em /api/portal-ministro/auth/first-access/validate-registro.',
      codigo: 'USAR_VALIDATE_REGISTRO',
    },
    { status: 410 },
  );
}
