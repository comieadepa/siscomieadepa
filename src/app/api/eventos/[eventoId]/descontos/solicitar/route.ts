import { NextRequest, NextResponse } from 'next/server';
import { requireEventoPermission } from '@/lib/evento-guard';
import { logDB } from '@/lib/audit';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;
  const guard = await requireEventoPermission(request, eventoId, 'inscricoes');
  if (!guard.ok) return guard.response;

  try {
    const body = await request.json();
    const {
      operacao_id,
      nome_inscrito,
      cpf,
      email,
      whatsapp,
      tipo_inscricao_id,
      modalidade_nome,
      valor_original,
      operador_nome,
      operador_email,
    } = body;

    // 1. Validações básicas de payload
    if (!operacao_id || typeof operacao_id !== 'string') {
      return NextResponse.json({ error: 'Identificador único da operação é obrigatório.' }, { status: 400 });
    }
    if (!nome_inscrito || typeof nome_inscrito !== 'string' || !nome_inscrito.trim()) {
      return NextResponse.json({ error: 'Nome do participante é obrigatório.' }, { status: 400 });
    }
    if (!modalidade_nome || typeof modalidade_nome !== 'string' || !modalidade_nome.trim()) {
      return NextResponse.json({ error: 'Modalidade de inscrição é obrigatória.' }, { status: 400 });
    }

    const valorOriginalNum = Number(valor_original);
    if (isNaN(valorOriginalNum) || valorOriginalNum <= 0) {
      return NextResponse.json({ error: 'Valor original deve ser maior que zero para solicitar desconto.' }, { status: 400 });
    }

    const valorOriginalFix = Math.round(valorOriginalNum * 100) / 100;
    const admin = guard.ctx.supabaseAdmin;

    // 2. Impedir solicitações pendentes duplicadas para a mesma operação
    const { data: existentePendente } = await admin
      .from('evento_desconto_autorizacoes')
      .select('id, status, created_at')
      .eq('evento_id', eventoId)
      .eq('operacao_id', operacao_id.trim())
      .eq('status', 'pendente')
      .maybeSingle();

    if (existentePendente) {
      return NextResponse.json(
        {
          error: 'Já existe uma solicitação de desconto pendente para esta operação. Aguarde a deliberação ou cancele-a.',
          solicitacao_id: existentePendente.id
        },
        { status: 409 }
      );
    }

    // 3. Obter dados do operador a partir do contexto de autenticação
    const opNome = operador_nome?.trim() || guard.ctx.equipe?.id ? 'Operador Balcão' : (guard.ctx.user?.user_metadata?.nome || guard.ctx.user?.email || 'Operador Balcão');
    const opEmail = operador_email?.trim() || guard.ctx.user?.email || null;
    const opId = guard.ctx.equipe?.id || null;

    // 4. Inserir solicitação no banco
    const { data: novaSolicitacao, error: insertErr } = await admin
      .from('evento_desconto_autorizacoes')
      .insert({
        evento_id: eventoId,
        operacao_id: operacao_id.trim(),
        nome_inscrito: nome_inscrito.trim().toUpperCase(),
        cpf: cpf ? String(cpf).replace(/\D/g, '') : null,
        email: email ? String(email).trim().toLowerCase() : null,
        whatsapp: whatsapp ? String(whatsapp).replace(/\D/g, '') : null,
        tipo_inscricao_id: tipo_inscricao_id || null,
        modalidade_nome: modalidade_nome.trim(),
        valor_original: valorOriginalFix,
        valor_desconto: 0.00,
        valor_final: valorOriginalFix,
        status: 'pendente',
        operador_id: opId,
        operador_nome: opNome,
        operador_email: opEmail,
      })
      .select('*')
      .single();

    if (insertErr || !novaSolicitacao) {
      console.error('[DESCONTO SOLICITAR] Erro ao gravar solicitação:', insertErr);
      return NextResponse.json({ error: 'Erro ao registrar solicitação de desconto.', details: insertErr?.message }, { status: 500 });
    }

    void logDB({
      userId: guard.ctx.user?.id,
      userEmail: opEmail || undefined,
      acao: 'solicitar_desconto_balcao',
      modulo: 'eventos',
      entidade: 'evento_desconto_autorizacoes',
      entidadeId: novaSolicitacao.id,
      descricao: `Solicitação de desconto para ${nome_inscrito} no valor original de R$ ${valorOriginalFix.toFixed(2)}.`,
      status: 'sucesso',
      detalhes: {
        evento_id: eventoId,
        solicitacao_id: novaSolicitacao.id,
        operacao_id,
        valor_original: valorOriginalFix,
      },
      request,
    });

    return NextResponse.json({
      success: true,
      solicitacao: novaSolicitacao,
    });
  } catch (err: any) {
    console.error('[DESCONTO SOLICITAR] Falha geral:', err);
    return NextResponse.json({ error: 'Falha interna ao processar solicitação de desconto.' }, { status: 500 });
  }
}
