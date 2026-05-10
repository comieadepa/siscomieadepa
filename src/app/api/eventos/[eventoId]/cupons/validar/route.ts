import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';

// POST /api/eventos/[eventoId]/cupons/validar
// Body: { codigo: string, valor_base: number }
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;
  try {
    const body        = await request.json();
    const codigo      = String(body?.codigo ?? '').trim().toUpperCase();
    const valorBase   = Number(body?.valor_base ?? 0);

    if (!codigo) {
      return NextResponse.json({ valido: false, erro: 'Código não informado.' }, { status: 400 });
    }

    const supabase = createServerClient();

    const { data: cupom, error } = await supabase
      .from('evento_cupons')
      .select('id, codigo, tipo, valor, limite_uso, usados, ativo, validade')
      .eq('evento_id', eventoId)
      .eq('codigo',    codigo)
      .single();

    if (error || !cupom) {
      return NextResponse.json({ valido: false, erro: 'Cupom não encontrado.' });
    }

    if (!cupom.ativo) {
      return NextResponse.json({ valido: false, erro: 'Cupom inativo.' });
    }

    if (cupom.validade && new Date(cupom.validade) < new Date()) {
      return NextResponse.json({ valido: false, erro: 'Cupom expirado.' });
    }

    if (cupom.limite_uso !== null && cupom.usados >= cupom.limite_uso) {
      return NextResponse.json({ valido: false, erro: 'Cupom esgotado.' });
    }

    // Calcula desconto
    let desconto = 0;
    if (cupom.tipo === 'percentual') {
      desconto = Math.round((valorBase * cupom.valor / 100) * 100) / 100;
    } else {
      desconto = Math.min(cupom.valor, valorBase);
    }

    const valorFinal = Math.max(0, valorBase - desconto);

    return NextResponse.json({
      valido:      true,
      cupomId:     cupom.id,
      codigo:      cupom.codigo,
      tipo:        cupom.tipo,
      valorCupom:  cupom.valor,
      desconto,
      valorFinal,
    });
  } catch (err: unknown) {
    return NextResponse.json({ valido: false, erro: 'Erro ao validar cupom.' }, { status: 500 });
  }
}
