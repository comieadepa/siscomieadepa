import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { requireRole } from '@/lib/auth/require-auth';

const FINANCEIRO_ROLES = ['super', 'financeiro'] as const;

const MESES_LABEL = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

// GET /api/financeiro/dashboard?ano=2026
export async function GET(request: NextRequest) {
  try {
    const auth = await requireRole(request, FINANCEIRO_ROLES);
    if (!auth.ok) return auth.response;

    const supabase = createServerClient();
    const { searchParams } = new URL(request.url);
    const hoje = new Date();
    const anoCorrente = hoje.getFullYear();
    const anoAtual = parseInt(searchParams.get('ano') ?? String(anoCorrente), 10);
    // mesAtual: mês real se estiver no ano corrente; dezembro se for ano histórico
    const mesAtual = anoAtual === anoCorrente ? hoje.getMonth() + 1 : 12;
    const anoAnterior = anoAtual - 1;

    // ── Busca todos os registros do ano atual e anterior ─────────────────
    const [resAtual, resAnterior] = await Promise.all([
      supabase
        .from('contribuicoes_estatutarias')
        .select('id,campo_id,campo_nome,supervisao_id,supervisao_nome,pastor_nome,mes,ano,valor,forma_pagamento,contato,created_at')
        .eq('ano', anoAtual)
        .order('created_at', { ascending: false }),
      supabase
        .from('contribuicoes_estatutarias')
        .select('valor,mes')
        .eq('ano', anoAnterior),
    ]);

    if (resAtual.error) {
      return NextResponse.json({ error: resAtual.error.message }, { status: 500 });
    }
    if (resAnterior.error) {
      return NextResponse.json({ error: resAnterior.error.message }, { status: 500 });
    }

    const contrib = (resAtual.data ?? []).map(r => ({
      ...r,
      valor: Number(r.valor) || 0,
    })) as Array<{
      id: string; campo_id: string | null; campo_nome: string;
      supervisao_id: string | null; supervisao_nome: string;
      pastor_nome?: string | null; mes: number; ano: number;
      valor: number; forma_pagamento: string; contato?: string | null;
      created_at: string;
    }>;
    const contribAnterior = (resAnterior.data ?? []).map(r => ({
      ...r,
      valor: Number(r.valor) || 0,
    }));

    // ── KPIs básicos ─────────────────────────────────────────────────────
    const totalAno = contrib.reduce((s, c) => s + (c.valor ?? 0), 0);
    const totalMes = contrib.filter(c => c.mes === mesAtual).reduce((s, c) => s + (c.valor ?? 0), 0);
    const totalAnoAnterior = contribAnterior.reduce((s, c) => s + c.valor, 0);
    const totalMesAnterior = contribAnterior.filter(c => c.mes === mesAtual).reduce((s, c) => s + c.valor, 0);

    const camposSet     = new Set(contrib.map(c => c.campo_id ?? c.campo_nome));
    const supervisoesSet = new Set(contrib.map(c => c.supervisao_id ?? c.supervisao_nome));
    const mesesComDados = new Set(contrib.map(c => c.mes));

    const totalCampos      = camposSet.size;
    const totalSupervisoes = supervisoesSet.size;
    const mediaMonsal      = mesesComDados.size > 0 ? totalAno / mesesComDados.size : 0;
    const totalRegistros   = contrib.length;

    // ── Arrecadação por mês ──────────────────────────────────────────────
    const porMes = MESES_LABEL.map((label, i) => {
      const mes = i + 1;
      const total = contrib.filter(c => c.mes === mes).reduce((s, c) => s + (c.valor ?? 0), 0);
      const totalAnt = contribAnterior.filter(c => c.mes === mes).reduce((s, c) => s + c.valor, 0);
      return { mes, label, total, totalAnterior: totalAnt };
    });

    // ── Por forma de pagamento ───────────────────────────────────────────
    const formaMap = new Map<string, { total: number; count: number }>();
    contrib.forEach(c => {
      const forma = c.forma_pagamento || 'OUTROS';
      const prev = formaMap.get(forma) ?? { total: 0, count: 0 };
      formaMap.set(forma, { total: prev.total + (c.valor ?? 0), count: prev.count + 1 });
    });
    const porForma = Array.from(formaMap.entries())
      .map(([forma, { total, count }]) => ({ forma, total, count }))
      .sort((a, b) => b.total - a.total);

    // ── Por supervisão ───────────────────────────────────────────────────
    const supMap = new Map<string, { nome: string; total: number; count: number }>();
    contrib.forEach(c => {
      const key = c.supervisao_id ?? c.supervisao_nome ?? 'Sem Supervisão';
      const nome = c.supervisao_nome || 'Sem Supervisão';
      const prev = supMap.get(key) ?? { nome, total: 0, count: 0 };
      supMap.set(key, { nome, total: prev.total + (c.valor ?? 0), count: prev.count + 1 });
    });
    const porSupervisao = Array.from(supMap.values())
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);

    // ── Últimos 10 lançamentos ───────────────────────────────────────────
    const recentes = contrib.slice(0, 10);

    // ── Inadimplência: campos que contribuíram em algum mês mas não no mês atual ──
    const camposQueContribuiram = new Set(
      contrib.filter(c => c.mes !== mesAtual).map(c => c.campo_id ?? c.campo_nome)
    );
    const camposComMesAtual = new Set(
      contrib.filter(c => c.mes === mesAtual).map(c => c.campo_id ?? c.campo_nome)
    );
    const camposInadimplentes = Array.from(camposQueContribuiram)
      .filter(id => !camposComMesAtual.has(id))
      .map(id => contrib.find(c => (c.campo_id ?? c.campo_nome) === id)?.campo_nome ?? id)
      .filter((v, i, a) => a.indexOf(v) === i)
      .slice(0, 10);

    const supervisoesComMesAtual = new Set(
      contrib.filter(c => c.mes === mesAtual).map(c => c.supervisao_id ?? c.supervisao_nome)
    );
    const todasSupervisoes = Array.from(supervisoesSet);
    const supervisoesSemMes = todasSupervisoes
      .filter(id => !supervisoesComMesAtual.has(id))
      .map(id => contrib.find(c => (c.supervisao_id ?? c.supervisao_nome) === id)?.supervisao_nome ?? id)
      .filter((v, i, a) => a.indexOf(v) === i);

    const maiorContribuicaoMes = contrib
      .filter(c => c.mes === mesAtual)
      .sort((a, b) => b.valor - a.valor)[0] ?? null;

    return NextResponse.json({
      kpis: {
        totalAno,
        totalMes,
        totalAnoAnterior,
        totalMesAnterior,
        totalCampos,
        totalSupervisoes,
        mediaMonsal,
        totalRegistros,
        mesAtual,
        anoAtual,
      },
      porMes,
      porForma,
      porSupervisao,
      recentes,
      inadimplentes: {
        campos: camposInadimplentes,
        supervisoes: supervisoesSemMes,
        maiorContribuicaoMes,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Erro interno';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
