import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const supabase = createServerClient();
  const { token } = await params;

  if (!token) {
    return NextResponse.json({ error: 'Token inválido.' }, { status: 400 });
  }

  try {
    // 1. Buscar o token na tabela document_tokens
    const { data: docToken, error: tokenError } = await supabase
      .from('document_tokens')
      .select('reference_id, document_type, dados_publicos')
      .eq('token', token)
      .maybeSingle();

    if (tokenError || !docToken) {
      return NextResponse.json({ error: 'Credenciamento não pôde ser validado.' }, { status: 404 });
    }

    // 2. Buscar o credenciamento para obter os dados mais atualizados e consistentes
    const { data: cred, error: credError } = await supabase
      .from('conec_credenciamentos')
      .select('*')
      .eq('id', docToken.reference_id)
      .is('deleted_at', null)
      .maybeSingle();

    if (credError || !cred) {
      return NextResponse.json({ error: 'Credenciamento não pôde ser validado.' }, { status: 404 });
    }

    // 3. Buscar a instituição
    const { data: inst, error: instError } = await supabase
      .from('conec_instituicoes')
      .select('*')
      .eq('id', cred.instituicao_id)
      .is('deleted_at', null)
      .maybeSingle();

    if (instError || !inst) {
      return NextResponse.json({ error: 'Credenciamento não pôde ser validado.' }, { status: 404 });
    }

    return NextResponse.json({
      nome_instituicao: inst.nome_instituicao,
      cnpj: inst.cnpj,
      nome_representante: inst.nome_representante,
      cidade: inst.cidade,
      estado: inst.estado,
      numero_registro: cred.numero_registro,
      data_emissao: cred.data_emissao || cred.data_inicio,
      data_fim: cred.data_fim,
      status: cred.status_credenciamento,
    });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: err.message || 'Erro ao validar credenciamento.' }, { status: 500 });
  }
}
