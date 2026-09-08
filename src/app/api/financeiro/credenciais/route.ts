import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { requireRole } from '@/lib/auth/require-auth';

const FINANCEIRO_ROLES = ['super', 'financeiro'] as const;

// GET /api/financeiro/credenciais?ano=2026
export async function GET(request: NextRequest) {
  try {
    const auth = await requireRole(request, FINANCEIRO_ROLES);
    if (!auth.ok) return auth.response;

    const supabase = createServerClient();
    const { searchParams } = new URL(request.url);
    const anoAtual = new Date().getFullYear();
    const ano = parseInt(searchParams.get('ano') ?? String(anoAtual), 10);

    const inicioAno = `${ano}-01-01T00:00:00.000Z`;
    const fimAno    = `${ano}-12-31T23:59:59.999Z`;

    // 1. Busca solicitações pagas no período
    const { data: solicitacoes, error } = await supabase
      .from('credencial_impressoes_solicitacoes')
      .select('id, ministro_id, valor_centavos, asaas_payment_id, status, solicitado_em, pago_em, updated_at')
      .gte('pago_em', inicioAno)
      .lte('pago_em', fimAno)
      .not('pago_em', 'is', null)
      .not('status', 'in', '("aguardando_pagamento","cancelado")')
      .order('pago_em', { ascending: false });

    if (error) {
      console.error('[financeiro/credenciais] Erro ao buscar solicitações:', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!solicitacoes || solicitacoes.length === 0) {
      return NextResponse.json({ data: [] });
    }

    // 2. Enriquece com dados do ministro (nome, matrícula, campo, supervisão)
    const ministroIds = [...new Set(solicitacoes.map(s => s.ministro_id).filter(Boolean))];
    const { data: membros } = await supabase
      .from('members')
      .select('id, name, matricula, custom_fields')
      .in('id', ministroIds);

    const membrosMap = new Map((membros ?? []).map(m => [m.id, m]));

    // 3. Monta payload final — 1 linha por solicitação (sem risco de multiplicação)
    const data = solicitacoes.map(s => {
      const membro = membrosMap.get(s.ministro_id);
      const cf = (membro?.custom_fields && typeof membro.custom_fields === 'object')
        ? (membro.custom_fields as Record<string, string>)
        : {};

      return {
        id:                s.id,
        ministro_id:       s.ministro_id,
        ministro_nome:     membro?.name    || 'Ministro não identificado',
        matricula:         membro?.matricula || cf.matricula || '',
        campo:             cf.campo       || '',
        supervisao:        cf.supervisao  || '',
        valor_centavos:    Number(s.valor_centavos) || 2000,
        asaas_payment_id:  s.asaas_payment_id || null,
        status:            s.status,
        solicitado_em:     s.solicitado_em,
        pago_em:           s.pago_em,
      };
    });

    return NextResponse.json({ data });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Erro interno';
    console.error('[financeiro/credenciais] Erro inesperado:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
