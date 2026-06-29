import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';

// POST /api/eventos/[eventoId]/balcao/cupom
// Validação de cupom no balcão
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;
  try {
    const body = await request.json();
    const codigo = String(body.codigo ?? '').trim().toUpperCase();
    const subtotal = Number(body.subtotal ?? 0);
    const tipoInscricao = String(body.tipo_inscricao ?? '').trim();

    if (!codigo) {
      return NextResponse.json({ ok: false, erro: 'Código do cupom não informado.' }, { status: 400 });
    }

    const supabase = createServerClient();

    // 1. Buscar primeiro na tabela de cupons globais
    const { data: cupomGlobal, error: errGlobal } = await supabase
      .from('evento_cupons')
      .select('id, codigo, tipo_desconto, valor, limite_usos, usos_atuais, ativo, validade_inicio, validade_fim')
      .eq('evento_id', eventoId)
      .ilike('codigo', codigo)
      .maybeSingle();

    if (!errGlobal && cupomGlobal) {
      // Validar ativo
      if (!cupomGlobal.ativo) {
        return NextResponse.json({ ok: false, erro: 'Cupom inativo.' });
      }

      // Validar vigência
      const agora = new Date();
      if (cupomGlobal.validade_inicio && new Date(cupomGlobal.validade_inicio) > agora) {
        return NextResponse.json({ ok: false, erro: 'Cupom ainda não está ativo.' });
      }
      if (cupomGlobal.validade_fim && new Date(cupomGlobal.validade_fim) < agora) {
        return NextResponse.json({ ok: false, erro: 'Cupom expirado.' });
      }

      // Validar limite de usos
      if (cupomGlobal.limite_usos !== null && cupomGlobal.limite_usos !== undefined && cupomGlobal.usos_atuais >= cupomGlobal.limite_usos) {
        return NextResponse.json({ ok: false, erro: 'Cupom esgotado.' });
      }

      // Calcular valor do desconto
      let valor_desconto = 0;
      if (cupomGlobal.tipo_desconto === 'percentual') {
        valor_desconto = Math.round((subtotal * cupomGlobal.valor / 100) * 100) / 100;
      } else {
        valor_desconto = Number(cupomGlobal.valor || 0);
      }

      const descontoAplicado = Math.min(valor_desconto, subtotal);
      const totalFinal = Math.max(0, subtotal - descontoAplicado);

      return NextResponse.json({
        ok: true,
        cupom: {
          id: cupomGlobal.id,
          codigo: cupomGlobal.codigo,
          valor_desconto: descontoAplicado,
        },
        subtotal,
        desconto: descontoAplicado,
        total: totalFinal,
      });
    }

    // 2. Se não encontrou global, buscar desconto específico de tipo de inscrição nas configuracoes_ago do evento
    const { data: evento } = await supabase
      .from('eventos')
      .select('configuracoes_ago')
      .eq('id', eventoId)
      .maybeSingle();

    const confAgo = evento?.configuracoes_ago as Record<string, any> | null;
    const descontosTipos = confAgo?.descontos_tipos || {};

    let tipoComDescontoMatch = null;
    let nomeTipoMatch = '';

    for (const [tipoNome, info] of Object.entries(descontosTipos)) {
      const item = info as any;
      if (item.desconto_codigo && item.desconto_codigo.trim().toUpperCase() === codigo) {
        tipoComDescontoMatch = item;
        nomeTipoMatch = tipoNome;
        break;
      }
    }

    if (!tipoComDescontoMatch) {
      return NextResponse.json({ ok: false, erro: 'Cupom não encontrado.' });
    }

    // Validar se está ativo
    if (tipoComDescontoMatch.desconto_ativo === false) {
      return NextResponse.json({ ok: false, erro: 'Cupom inativo.' });
    }

    // Validar se o usuário selecionou o tipo de inscrição correspondente
    if (!tipoInscricao) {
      return NextResponse.json({ ok: false, erro: 'Selecione um tipo de inscrição para validar este desconto.' });
    }

    if (nomeTipoMatch.toUpperCase() !== tipoInscricao.toUpperCase()) {
      return NextResponse.json({
        ok: false,
        erro: `Este código de desconto é específico para a categoria: ${nomeTipoMatch}.`
      });
    }

    // Calcular o desconto (valor fixo em R$)
    const valor_desconto = Number(tipoComDescontoMatch.desconto_valor || 0);
    if (valor_desconto <= 0) {
      return NextResponse.json({ ok: false, erro: 'Valor do desconto é inválido.' });
    }

    const descontoAplicado = Math.min(valor_desconto, subtotal);
    const totalFinal = Math.max(0, subtotal - descontoAplicado);

    return NextResponse.json({
      ok: true,
      cupom: {
        id: `tipo_${nomeTipoMatch}`,
        codigo: tipoComDescontoMatch.desconto_codigo,
        valor_desconto: descontoAplicado,
        tipo_inscricao: nomeTipoMatch,
      },
      subtotal,
      desconto: descontoAplicado,
      total: totalFinal,
    });
  } catch (err: unknown) {
    return NextResponse.json({ ok: false, erro: 'Erro ao validar cupom.' }, { status: 500 });
  }
}
