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

    // Limites de data UTC para consultas de ano
    const inicioAnoAtual = `${anoAtual}-01-01T00:00:00.000Z`;
    const fimAnoAtual = `${anoAtual}-12-31T23:59:59.999Z`;

    const inicioAnoAnterior = `${anoAnterior}-01-01T00:00:00.000Z`;
    const fimAnoAnterior = `${anoAnterior}-12-31T23:59:59.999Z`;

    // ── 1. Executa consultas independentes em paralelo ─────────────────────
    const [
      resContribAtual,
      resContribAnterior,
      resCredAtual,
      resCredAnterior,
    ] = await Promise.all([
      // Contribuições estatutárias do ano atual
      supabase
        .from('contribuicoes_estatutarias')
        .select('id,campo_id,campo_nome,supervisao_id,supervisao_nome,pastor_nome,mes,ano,valor,forma_pagamento,contato,created_at')
        .eq('ano', anoAtual)
        .order('created_at', { ascending: false }),

      // Contribuições estatutárias do ano anterior
      supabase
        .from('contribuicoes_estatutarias')
        .select('valor,mes')
        .eq('ano', anoAnterior),

      // Taxas de credencial física pagas do ano atual
      supabase
        .from('credencial_impressoes_solicitacoes')
        .select('id,ministro_id,valor_centavos,pago_em,status,asaas_payment_id')
        .gte('pago_em', inicioAnoAtual)
        .lte('pago_em', fimAnoAtual)
        .not('pago_em', 'is', null)
        .not('status', 'in', '("aguardando_pagamento","cancelado")')
        .order('pago_em', { ascending: false }),

      // Taxas de credencial física pagas do ano anterior
      supabase
        .from('credencial_impressoes_solicitacoes')
        .select('valor_centavos,pago_em')
        .gte('pago_em', inicioAnoAnterior)
        .lte('pago_em', fimAnoAnterior)
        .not('pago_em', 'is', null)
        .not('status', 'in', '("aguardando_pagamento","cancelado")'),
    ]);

    if (resContribAtual.error) {
      console.error('[financeiro/dashboard] Erro contribuições ano atual:', resContribAtual.error.message);
      return NextResponse.json({ error: resContribAtual.error.message }, { status: 500 });
    }
    if (resContribAnterior.error) {
      console.error('[financeiro/dashboard] Erro contribuições ano anterior:', resContribAnterior.error.message);
      return NextResponse.json({ error: resContribAnterior.error.message }, { status: 500 });
    }
    if (resCredAtual.error) {
      console.error('[financeiro/dashboard] Erro credenciais ano atual:', resCredAtual.error.message);
    }
    if (resCredAnterior.error) {
      console.error('[financeiro/dashboard] Erro credenciais ano anterior:', resCredAnterior.error.message);
    }

    // ── 2. Enriquecimento dos ministros das credenciais do ano atual ───────
    const credenciaisAtual = resCredAtual.data ?? [];
    const ministroIds = [...new Set(credenciaisAtual.map(c => c.ministro_id).filter(Boolean))];

    let membrosMap = new Map<string, any>();
    if (ministroIds.length > 0) {
      const { data: membros } = await supabase
        .from('members')
        .select('id, name, campo_id, supervisao_id, custom_fields')
        .in('id', ministroIds);

      membrosMap = new Map((membros ?? []).map(m => [m.id, m]));
    }

    // ── 3. Normalização dos itens de receita do ano atual ───────────────────
    const itensContrib = (resContribAtual.data ?? []).map(r => ({
      id: r.id,
      campo_id: r.campo_id ?? null,
      campo_nome: r.campo_nome,
      supervisao_id: r.supervisao_id ?? null,
      supervisao_nome: r.supervisao_nome,
      pastor_nome: r.pastor_nome ?? null,
      mes: Number(r.mes),
      ano: Number(r.ano),
      valor: Number(r.valor) || 0,
      forma_pagamento: r.forma_pagamento || 'A VISTA',
      contato: r.contato ?? null,
      created_at: r.created_at,
      tipo_origem: 'contribuicao_estatutaria',
    }));

    const itensCredencial = credenciaisAtual.map(c => {
      const pagoEm = new Date(c.pago_em);
      const mes = pagoEm.getMonth() + 1;
      const valor = (Number(c.valor_centavos) || 2000) / 100;
      const membro = membrosMap.get(c.ministro_id);
      const cf = (membro?.custom_fields && typeof membro.custom_fields === 'object')
        ? (membro.custom_fields as Record<string, any>)
        : {};

      const ministroNome = membro?.name || 'Ministro';
      const campoNome = cf.campo || 'Secretaria Geral';
      const supervisaoNome = cf.supervisao || 'Secretaria Geral';

      return {
        id: `cred_${c.id}`,
        campo_id: membro?.campo_id ?? null,
        campo_nome: `Taxa de Credencial — ${ministroNome} (${campoNome})`,
        supervisao_id: membro?.supervisao_id ?? null,
        supervisao_nome: supervisaoNome,
        pastor_nome: ministroNome,
        mes,
        ano: anoAtual,
        valor,
        forma_pagamento: 'ASAAS',
        contato: null,
        created_at: c.pago_em,
        tipo_origem: 'taxa_credencial',
      };
    });

    // Unifica todas as receitas do ano atual e ordena cronologicamente
    const todasReceitasAtual = [...itensContrib, ...itensCredencial].sort((a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    // ── 4. Normalização das receitas do ano anterior ───────────────────────
    const contribAnterior = (resContribAnterior.data ?? []).map(r => ({
      valor: Number(r.valor) || 0,
      mes: Number(r.mes),
    }));

    const credenciaisAnterior = (resCredAnterior.data ?? []).map(c => {
      const pagoEm = new Date(c.pago_em);
      return {
        valor: (Number(c.valor_centavos) || 2000) / 100,
        mes: pagoEm.getMonth() + 1,
      };
    });

    const todasReceitasAnterior = [...contribAnterior, ...credenciaisAnterior];

    // ── 5. KPIs Consolidados ───────────────────────────────────────────────
    const totalAno = todasReceitasAtual.reduce((s, c) => s + (c.valor ?? 0), 0);
    const totalMes = todasReceitasAtual.filter(c => c.mes === mesAtual).reduce((s, c) => s + (c.valor ?? 0), 0);
    const totalAnoAnterior = todasReceitasAnterior.reduce((s, c) => s + c.valor, 0);
    const totalMesAnterior = todasReceitasAnterior.filter(c => c.mes === mesAtual).reduce((s, c) => s + c.valor, 0);

    const camposSet = new Set(todasReceitasAtual.map(c => c.campo_id ?? c.campo_nome));
    const supervisoesSet = new Set(todasReceitasAtual.map(c => c.supervisao_id ?? c.supervisao_nome));
    const mesesComDados = new Set(todasReceitasAtual.map(c => c.mes));

    const totalCampos = camposSet.size;
    const totalSupervisoes = supervisoesSet.size;
    const mediaMonsal = mesesComDados.size > 0 ? totalAno / mesesComDados.size : 0;
    const totalRegistros = todasReceitasAtual.length;

    // ── 6. Arrecadação por mês (1 a 12) ────────────────────────────────────
    const porMes = MESES_LABEL.map((label, i) => {
      const mes = i + 1;
      const total = todasReceitasAtual.filter(c => c.mes === mes).reduce((s, c) => s + (c.valor ?? 0), 0);
      const totalAnt = todasReceitasAnterior.filter(c => c.mes === mes).reduce((s, c) => s + c.valor, 0);
      return { mes, label, total, totalAnterior: totalAnt };
    });

    // ── 7. Por forma de pagamento ──────────────────────────────────────────
    const formaMap = new Map<string, { total: number; count: number }>();
    todasReceitasAtual.forEach(c => {
      const forma = c.forma_pagamento || 'OUTROS';
      const prev = formaMap.get(forma) ?? { total: 0, count: 0 };
      formaMap.set(forma, { total: prev.total + (c.valor ?? 0), count: prev.count + 1 });
    });
    const porForma = Array.from(formaMap.entries())
      .map(([forma, { total, count }]) => ({ forma, total, count }))
      .sort((a, b) => b.total - a.total);

    // ── 8. Por supervisão ──────────────────────────────────────────────────
    const supMap = new Map<string, { nome: string; total: number; count: number }>();
    todasReceitasAtual.forEach(c => {
      const key = c.supervisao_id ?? c.supervisao_nome ?? 'Sem Supervisão';
      const nome = c.supervisao_nome || 'Sem Supervisão';
      const prev = supMap.get(key) ?? { nome, total: 0, count: 0 };
      supMap.set(key, { nome, total: prev.total + (c.valor ?? 0), count: prev.count + 1 });
    });
    const porSupervisao = Array.from(supMap.values())
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);

    // ── 9. Últimos lançamentos consolidados ─────────────────────────────────
    const recentes = todasReceitasAtual.slice(0, 10);

    // ── 10. Inadimplência (calculada estritamente sobre Contribuições de Campos) ──
    const camposQueContribuiram = new Set(
      itensContrib.filter(c => c.mes !== mesAtual).map(c => c.campo_id ?? c.campo_nome)
    );
    const camposComMesAtual = new Set(
      itensContrib.filter(c => c.mes === mesAtual).map(c => c.campo_id ?? c.campo_nome)
    );
    const camposInadimplentes = Array.from(camposQueContribuiram)
      .filter(id => !camposComMesAtual.has(id))
      .map(id => itensContrib.find(c => (c.campo_id ?? c.campo_nome) === id)?.campo_nome ?? id)
      .filter((v, i, a) => a.indexOf(v) === i)
      .slice(0, 10);

    const supervisoesContribSet = new Set(itensContrib.map(c => c.supervisao_id ?? c.supervisao_nome));
    const supervisoesComMesAtual = new Set(
      itensContrib.filter(c => c.mes === mesAtual).map(c => c.supervisao_id ?? c.supervisao_nome)
    );
    const todasSupervisoesContrib = Array.from(supervisoesContribSet);
    const supervisoesSemMes = todasSupervisoesContrib
      .filter(id => !supervisoesComMesAtual.has(id))
      .map(id => itensContrib.find(c => (c.supervisao_id ?? c.supervisao_nome) === id)?.supervisao_nome ?? id)
      .filter((v, i, a) => a.indexOf(v) === i);

    const maiorContribuicaoMes = itensContrib
      .filter(c => c.mes === mesAtual)
      .sort((a, b) => b.valor - a.valor)[0] ?? null;

    // ── 11. Retorno JSON 100% compatível ───────────────────────────────────
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
    console.error('[financeiro/dashboard] Erro inesperado:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
