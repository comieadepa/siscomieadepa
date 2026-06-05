import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, createServerClientFromCookies } from '@/lib/supabase-server';
import { normalizeEventoRole, resolveEventoPermissoes, type EventoRole } from '@/lib/evento-permissions';
import { normalizeRole } from '@/lib/auth/roles';
import { alocarLeitoParaInscricao } from '@/lib/hospedagem-alocacao-automatica';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ inscricaoId: string }> }
) {
  const { inscricaoId } = await params;

  if (!inscricaoId) {
    return NextResponse.json({ error: 'inscricaoId ausente' }, { status: 400 });
  }

  // Autentica o usuário via cookies
  const userClient = await createServerClientFromCookies();
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Nao autorizado.' }, { status: 401 });
  }

  const supabaseAdmin = createServerClient();

  // Busca a inscrição para obter evento_id e lote_id
  const { data: ins, error: insError } = await supabaseAdmin
    .from('evento_inscricoes')
    .select('id, evento_id, lote_id, status_pagamento')
    .eq('id', inscricaoId)
    .single();

  if (insError || !ins) {
    return NextResponse.json({ error: 'Inscrição não encontrada' }, { status: 404 });
  }

  if (ins.status_pagamento === 'pago' || ins.status_pagamento === 'isento') {
    return NextResponse.json({ error: 'Inscrição já está paga/isenta' }, { status: 400 });
  }

  // Verifica permissão do usuário no evento
  const nivelRaw = (user.user_metadata?.nivel as string | undefined) ?? '';
  const nivel = normalizeRole(nivelRaw);
  const departamento = (user.user_metadata?.subcategoria as string | undefined) ?? '';
  const isGlobal = nivel === 'super' || nivel === 'administrador';
  const isDeptAdmin = nivel === 'inscricao' && !!departamento;

  let permissao: EventoRole | null = null;

  if (isGlobal || isDeptAdmin) {
    permissao = 'admin_evento';
  } else {
    const { data: vinculo } = await supabaseAdmin
      .from('usuario_eventos')
      .select('permissao')
      .eq('user_id', user.id)
      .eq('evento_id', ins.evento_id)
      .maybeSingle();
    permissao = normalizeEventoRole((vinculo as { permissao?: string | null } | null)?.permissao ?? null);
  }

  if (!permissao) {
    return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
  }

  const perms = resolveEventoPermissoes({ perm: permissao, isGlobal, isDeptAdmin });
  if (!perms.podeEditarEvento) {
    return NextResponse.json({ error: 'Sem permissão para editar este evento.' }, { status: 403 });
  }

  // Aplica a baixa manual usando service role (ignora RLS)
  if (ins.lote_id) {
    // Atualiza todas as inscrições do lote
    const { error: inscsError } = await supabaseAdmin
      .from('evento_inscricoes')
      .update({ status_pagamento: 'pago' })
      .eq('lote_id', ins.lote_id);

    if (inscsError) {
      return NextResponse.json({ error: inscsError.message }, { status: 500 });
    }

    // Atualiza o registro do lote
    const { error: loteError } = await supabaseAdmin
      .from('evento_lotes_inscricao')
      .update({ status_pagamento: 'pago' })
      .eq('id', ins.lote_id);

    if (loteError) {
      return NextResponse.json({ error: loteError.message }, { status: 500 });
    }

    // Executa autoalocacao de hospedagem para todos do lote
    const { data: loteInscs } = await supabaseAdmin
      .from('evento_inscricoes')
      .select('id')
      .eq('lote_id', ins.lote_id);

    for (const li of loteInscs ?? []) {
      await alocarLeitoParaInscricao(supabaseAdmin, li.id);
    }
  } else {
    const { error: updateError } = await supabaseAdmin
      .from('evento_inscricoes')
      .update({ status_pagamento: 'pago' })
      .eq('id', inscricaoId);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    // Executa autoalocacao de hospedagem para a inscricao individual
    await alocarLeitoParaInscricao(supabaseAdmin, inscricaoId);
  }

  return NextResponse.json({ success: true });
}
