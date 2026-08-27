/**
 * POST /api/portal-ministro/auth/first-access/request-code
 * Rota descontinuada: O primeiro acesso foi simplificado para validação direta de identidade.
 */

import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json(
    { error: 'Endpoint descontinuado. O primeiro acesso não requer mais envio de código por WhatsApp ou e-mail.' },
    { status: 410 },
  );
}
