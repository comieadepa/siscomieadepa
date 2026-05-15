import { NextRequest, NextResponse } from 'next/server';

export async function POST(_request: NextRequest) {
  return NextResponse.json(
    { error: 'Fluxo antigo desativado. Use o cadastro direto no painel do evento.' },
    { status: 410 }
  );
}
