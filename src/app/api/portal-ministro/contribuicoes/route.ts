/**
 * GET /api/portal-ministro/contribuicoes
 * Retorna contribuições estatutárias do campo vinculado ao ministro.
 * Apenas para Pastores Presidentes.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { getMinistroSession, unauthorizedResponse } from '@/lib/ministro-session';

const MESES = [
  '', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

export async function GET(request: NextRequest) {
  const session = await getMinistroSession(request);
  if (!session) return unauthorizedResponse();

  const supabase = createServerClient();

  // Verifica se é Pastor Presidente
  const { data: ministro, error: mErr } = await supabase
    .from('members')
    .select('id, name, pastor_presidente, custom_fields')
    .eq('id', session.ministroId)
    .maybeSingle();

  if (mErr || !ministro) {
    return NextResponse.json({ error: 'Ministro não encontrado.' }, { status: 404 });
  }

  if (!ministro.pastor_presidente) {
    return NextResponse.json(
      { error: 'Área restrita a Pastores Presidentes.' },
      { status: 403 },
    );
  }

  const cf = (ministro.custom_fields && typeof ministro.custom_fields === 'object')
    ? ministro.custom_fields as Record<string, any>
    : {};

  const campNome = String(cf.campo || '');

  // Busca histórico de contribuições do campo do ministro (pelo nome do campo)
  const anoAtual = new Date().getFullYear();
  let query = supabase
    .from('contribuicoes_estatutarias')
    .select('id, mes, ano, valor, forma_pagamento, created_at, campo_nome, campo_id')
    .order('ano', { ascending: false })
    .order('mes', { ascending: false })
    .limit(36);

  // Tenta filtrar por campo_id ou campo_nome
  if (cf.campo_id) {
    query = query.eq('campo_id', cf.campo_id);
  } else if (campNome) {
    query = query.ilike('campo_nome', `%${campNome}%`);
  } else {
    // Tenta pelo pastor_member_id
    query = query.eq('pastor_member_id', session.ministroId);
  }

  const { data: contribuicoes, error: cErr } = await query;
  if (cErr) {
    console.error('[portal/contribuicoes]', cErr.message);
    return NextResponse.json({ data: [], statusMesAtual: null });
  }

  // Verifica se o mês atual está pago
  const mesAtual = new Date().getMonth() + 1;
  const pagoMesAtual = (contribuicoes || []).some(
    (c: any) => c.mes === mesAtual && c.ano === anoAtual,
  );

  const itens = (contribuicoes || []).map((c: any) => ({
    id: c.id,
    mes: c.mes,
    mesLabel: MESES[c.mes] || String(c.mes),
    ano: c.ano,
    valor: Number(c.valor),
    formaPagamento: c.forma_pagamento,
    criadoEm: c.created_at,
    campoNome: c.campo_nome,
  }));

  return NextResponse.json({
    data: itens,
    statusMesAtual: pagoMesAtual ? 'pago' : 'em_aberto',
    mesAtual,
    anoAtual,
    campoNome: campNome || contribuicoes?.[0]?.campo_nome || '',
  });
}
