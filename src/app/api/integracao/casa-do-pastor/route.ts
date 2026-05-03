import { NextRequest, NextResponse } from 'next/server';

// Credenciais ACP — Casa do Pastor
const ACP_URL = 'https://api.acp.net.br/api/cadastros/busca';
const ACP_CLIENT_ID = process.env.ACP_CLIENT_ID ?? '3b194298-4f3e-4b87-8103-d0d415e';
const ACP_CLIENT_SECRET = process.env.ACP_CLIENT_SECRET ?? '163d9550a7fa9631f1fd509a6823c4';

export async function GET(req: NextRequest) {
  const cpf = req.nextUrl.searchParams.get('cpf')?.replace(/\D/g, '') ?? '';

  if (cpf.length !== 11) {
    return NextResponse.json({ error: 'CPF inválido' }, { status: 400 });
  }

  try {
    const params = new URLSearchParams({ tipo: 'cpf', argumento: cpf });
    const res = await fetch(`${ACP_URL}?${params.toString()}`, {
      method: 'GET',
      headers: {
        'ClientId': ACP_CLIENT_ID,
        'ClientSecret': ACP_CLIENT_SECRET,
        'Accept': 'application/json',
      },
      cache: 'no-store',
    });

    if (!res.ok) {
      return NextResponse.json({ error: `API ACP retornou ${res.status}` }, { status: res.status });
    }

    const data = await res.json();

    // Payload real: { cadastro: { adimplete: boolean, ... } }
    // Nota: campo tem typo na API da ACP (“adimplete” em vez de “adimplente”)
    const cadastro = data?.cadastro;

    let status: 'adimplente' | 'inadimplente' | 'nao_encontrado';
    if (!cadastro) {
      status = 'nao_encontrado';
    } else if (cadastro.adimplete === true) {
      status = 'adimplente';
    } else if (cadastro.adimplete === false) {
      status = 'inadimplente';
    } else {
      status = 'nao_encontrado';
    }

    return NextResponse.json({ status, cadastro });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Erro desconhecido' }, { status: 500 });
  }
}
