import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';

export async function GET() {
  try {
    const supabase = createServerClient();

    // 1. Busca todas as inscrições para "Gezael Rocha de Sousa"
    const { data: inscricoes, error: errInsc } = await supabase
      .from('evento_inscricoes')
      .select('id, nome_inscrito, evento_id, qr_code, status_pagamento, eventos(nome, departamento)')
      .ilike('nome_inscrito', '%Gezael%');
    if (errInsc) throw errInsc;

    // 2. Busca todas as credenciais QR permanentes se existirem
    const { data: members, error: errMem } = await supabase
      .from('members')
      .select('id, nome, cpf, matricula')
      .ilike('nome', '%Gezael%');
    if (errMem) throw errMem;

    let qrTokens: any[] = [];
    if (members && members.length > 0) {
      const memberIds = members.map(m => m.id);
      const { data: tokens, error: errTok } = await supabase
        .from('credencial_qr_tokens')
        .select('*')
        .in('ministro_id', memberIds);
      if (errTok) throw errTok;
      qrTokens = tokens || [];
    }

    return NextResponse.json({
      success: true,
      mensagem: "Diagnóstico de Inscrições para Gezael Rocha de Sousa",
      inscricoes_encontradas: inscricoes.map(ins => ({
        id: ins.id,
        nome: ins.nome_inscrito,
        evento_id: ins.evento_id,
        evento_nome: (ins.eventos as any)?.nome,
        departamento: (ins.eventos as any)?.departamento,
        qr_code: ins.qr_code,
        status_pagamento: ins.status_pagamento,
      })),
      cadastro_membro: members.map(m => {
        const tokensDoMembro = qrTokens.filter(t => t.ministro_id === m.id);
        return {
          id: m.id,
          nome: m.nome,
          cpf: m.cpf ? '***' + String(m.cpf).slice(-4) : null,
          matricula: m.matricula,
          tokens_permanentes: tokensDoMembro.map(t => t.token),
        };
      })
    });

  } catch (error: any) {
    return NextResponse.json({ error: error.message || error }, { status: 500 });
  }
}
