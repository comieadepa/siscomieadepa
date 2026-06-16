import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';

// GET /api/eventos/[eventoId]/cupons/validar?codigo=...&tipo_inscricao_id=...
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;
  try {
    const { searchParams } = new URL(request.url);
    const codigo = String(searchParams.get('codigo') ?? '').trim();
    const tipoInscricaoId = String(searchParams.get('tipo_inscricao_id') ?? '').trim();

    if (!codigo) {
      return NextResponse.json({ valido: false, erro: 'Código não informado.' }, { status: 400 });
    }

    const supabase = createServerClient();

    // 1. Buscar o cupom (case-insensitive usando ilike)
    const { data: cupom, error } = await supabase
      .from('evento_cupons')
      .select('id, codigo, tipo_desconto, valor, limite_usos, usos_atuais, ativo, validade_inicio, validade_fim, aplicar_todos_tipos, tipos_permitidos, permite_acumular')
      .eq('evento_id', eventoId)
      .ilike('codigo', codigo)
      .maybeSingle();

    if (error || !cupom) {
      return NextResponse.json({ valido: false, erro: 'Cupom não encontrado.' });
    }

    // 2. Validar ativo
    if (!cupom.ativo) {
      return NextResponse.json({ valido: false, erro: 'Cupom inativo.' });
    }

    // 3. Validar vigência
    const agora = new Date();
    if (cupom.validade_inicio && new Date(cupom.validade_inicio) > agora) {
      return NextResponse.json({ valido: false, erro: 'Cupom ainda não está ativo.' });
    }
    if (cupom.validade_fim && new Date(cupom.validade_fim) < agora) {
      return NextResponse.json({ valido: false, erro: 'Cupom expirado.' });
    }

    // 4. Validar limite de usos
    if (cupom.limite_usos !== null && cupom.limite_usos !== undefined && cupom.usos_atuais >= cupom.limite_usos) {
      return NextResponse.json({ valido: false, erro: 'Cupom esgotado.' });
    }

    // 5. Obter o valor do tipo de inscrição para calcular o valor_desconto
    let valorBase = 0;
    if (tipoInscricaoId) {
      const { data: tipoInsc, error: tipoInscErr } = await supabase
        .from('evento_tipos_inscricao')
        .select('valor')
        .eq('id', tipoInscricaoId)
        .eq('evento_id', eventoId)
        .single();

      if (tipoInscErr || !tipoInsc) {
        return NextResponse.json({ valido: false, erro: 'Tipo de inscrição inválido para este evento.' });
      }
      valorBase = Number(tipoInsc.valor);
    }

    // 6. Validar se o tipo de inscrição está dentro dos tipos_permitidos se aplicar_todos_tipos = false
    if (!cupom.aplicar_todos_tipos) {
      if (!tipoInscricaoId) {
        return NextResponse.json({ valido: false, erro: 'Este cupom exige um tipo de inscrição específico.' });
      }
      const tiposPermitidos = Array.isArray(cupom.tipos_permitidos) ? cupom.tipos_permitidos : [];
      if (!tiposPermitidos.includes(tipoInscricaoId)) {
        return NextResponse.json({ valido: false, erro: 'Cupom não aplicável a este tipo de inscrição.' });
      }
    }

    // 7. Calcular o valor_desconto
    let valor_desconto = 0;
    if (cupom.tipo_desconto === 'percentual') {
      valor_desconto = Math.round((valorBase * cupom.valor / 100) * 100) / 100;
    } else {
      valor_desconto = Math.min(cupom.valor, valorBase);
    }

    return NextResponse.json({
      valido: true,
      cupom_id: cupom.id,
      codigo: cupom.codigo,
      tipo_desconto: cupom.tipo_desconto,
      valor: Number(cupom.valor),
      valor_desconto,
      permite_acumular: !!cupom.permite_acumular,
    });
  } catch (err: unknown) {
    return NextResponse.json({ valido: false, erro: 'Erro ao validar cupom.' }, { status: 500 });
  }
}
