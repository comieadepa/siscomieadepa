import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { requireRole } from '@/lib/auth/require-auth';

const DASHBOARD_ROLES = ['super', 'administrador', 'comissao', 'inscricao', 'financeiro', 'cgadb'] as const;
const PAGE_LIMIT = 1000;

type MemberRow = {
  cpf: string | null;
  numero_cgadb?: string | null;
  custom_fields?: Record<string, unknown> | null;
};

type DebitoRow = {
  cpf: string | null;
};

type EventoRow = {
  id: string;
  nome: string;
  status: string | null;
  inscricoes_abertas: boolean | null;
  data_inicio: string | null;
};

type InscricaoRow = {
  evento_id: string;
  status_pagamento: string | null;
};

const normalizeCpf = (cpf?: string | null) => (cpf || '').replace(/\D/g, '');

function getRegistroCgadb(member: MemberRow): string {
  const cf = (member.custom_fields || {}) as Record<string, unknown>;
  const candidates = [
    member.numero_cgadb,
    cf.numero_cgadb as string | undefined,
    cf.registro_cgadb as string | undefined,
    cf.registro as string | undefined,
  ];
  return (candidates.find((v) => typeof v === 'string' && v.trim().length > 0) || '').trim();
}

async function fetchAllMembers(supabase: ReturnType<typeof createServerClient>) {
  const data: MemberRow[] = [];
  let offset = 0;

  while (true) {
    const { data: batch, error } = await supabase
      .from('members')
      .select('cpf,numero_cgadb,custom_fields')
      .or('status.eq.active,tipo_cadastro.eq.ministro')
      .range(offset, offset + PAGE_LIMIT - 1);

    if (error) throw new Error(error.message);
    const rows = (batch || []) as MemberRow[];
    data.push(...rows);
    if (rows.length < PAGE_LIMIT) break;
    offset += PAGE_LIMIT;
  }

  return data;
}

async function fetchAllDebitos(supabase: ReturnType<typeof createServerClient>) {
  const data: DebitoRow[] = [];
  let offset = 0;

  while (true) {
    const { data: batch, error } = await supabase
      .from('cgadb_debitos')
      .select('cpf')
      .range(offset, offset + PAGE_LIMIT - 1);

    if (error) throw new Error(error.message);
    const rows = (batch || []) as DebitoRow[];
    data.push(...rows);
    if (rows.length < PAGE_LIMIT) break;
    offset += PAGE_LIMIT;
  }

  return data;
}

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, DASHBOARD_ROLES);
  if (!auth.ok) return auth.response;

  try {
    const supabase = createServerClient();

    const dataLimite = new Date();
    dataLimite.setDate(dataLimite.getDate() - 30);
    const isoLimite = dataLimite.toISOString();

    const [
      supRes,
      camRes,
      candRes,
      actRes,
      credRes,
      inatRes,
      transfRes,
      vencRes,
      recentRes,
    ] = await Promise.all([
      supabase.from('supervisoes').select('id', { count: 'exact', head: true }).eq('is_active', true),
      supabase.from('campos').select('id', { count: 'exact', head: true }).eq('is_active', true),
      supabase.from('members').select('id', { count: 'exact', head: true }).eq('status', 'candidate'),
      supabase.from('members').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      supabase.from('cartoes_gerados').select('id', { count: 'exact', head: true }),
      supabase.from('members').select('id', { count: 'exact', head: true }).eq('status', 'inactive'),
      supabase.from('members').select('id', { count: 'exact', head: true }).eq('status', 'transferred'),
      supabase.from('members').select('id', { count: 'exact', head: true }).eq('cred_vencida', true),
      supabase.from('members').select('id', { count: 'exact', head: true }).gte('created_at', isoLimite),
    ]);

    if (supRes.error) throw new Error(supRes.error.message);
    if (camRes.error) throw new Error(camRes.error.message);
    if (candRes.error) throw new Error(candRes.error.message);
    if (actRes.error) throw new Error(actRes.error.message);
    if (credRes.error) throw new Error(credRes.error.message);
    if (inatRes.error) throw new Error(inatRes.error.message);
    if (transfRes.error) throw new Error(transfRes.error.message);
    if (vencRes.error) throw new Error(vencRes.error.message);
    if (recentRes.error) throw new Error(recentRes.error.message);

    const [members, debitos] = await Promise.all([
      fetchAllMembers(supabase),
      fetchAllDebitos(supabase),
    ]);

    const debitosCpf = new Set<string>();
    for (const d of debitos) {
      const cpf = normalizeCpf(d.cpf);
      if (cpf) debitosCpf.add(cpf);
    }

    let registrados = 0;
    let naoRegistrados = 0;
    let comDebito = 0;
    let semDebito = 0;

    const supervisaoMap = new Map<string, number>();

    for (const m of members) {
      const registro = getRegistroCgadb(m);
      const isRegistrado = registro.length > 0;
      const cpf = normalizeCpf(m.cpf);
      const hasDebito = cpf ? debitosCpf.has(cpf) : false;

      if (isRegistrado) registrados += 1;
      else naoRegistrados += 1;

      if (isRegistrado) {
        if (hasDebito) comDebito += 1;
        else semDebito += 1;
      }

      const supervisao = String(((m.custom_fields || {}) as Record<string, unknown>).supervisao || 'Sem Supervisao');
      supervisaoMap.set(supervisao, (supervisaoMap.get(supervisao) || 0) + 1);
    }

    const supervisoesOrdenadas = Array.from(supervisaoMap.entries())
      .map(([supervisao, total]) => ({ supervisao, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 8);

    const regularidadePct = registrados > 0 ? (semDebito / registrados) * 100 : 0;

    const anoAtual = new Date().getFullYear();
    const { data: eventosRaw, error: eventosError } = await supabase
      .from('eventos')
      .select('id,nome,status,inscricoes_abertas,data_inicio')
      .gte('data_inicio', `${anoAtual}-01-01`)
      .lte('data_inicio', `${anoAtual}-12-31`)
      .order('data_inicio', { ascending: true });

    if (eventosError) throw new Error(eventosError.message);

    const eventos = (eventosRaw || []) as EventoRow[];
    const eventosAbertos = eventos.filter((e) => e.status === 'programado' && e.inscricoes_abertas);
    const openIds = eventosAbertos.map((e) => e.id);

    let inscricoes: InscricaoRow[] = [];
    if (openIds.length > 0) {
      const { data: inscRaw, error: inscError } = await supabase
        .from('evento_inscricoes')
        .select('evento_id,status_pagamento')
        .in('evento_id', openIds);
      if (inscError) throw new Error(inscError.message);
      inscricoes = (inscRaw || []) as InscricaoRow[];
    }

    const inscricoesAtivas = inscricoes.filter((i) => i.status_pagamento !== 'cancelado').length;
    const inscritosEventosAbertos = inscricoes.length;

    const hoje = new Date().toISOString().split('T')[0];
    const proximoEvento = eventosAbertos.find((e) => e.data_inicio && e.data_inicio >= hoje) || null;

    const meses = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    const eventosPorMesBase = Array.from({ length: 12 }, (_, idx) => ({
      mes: meses[idx],
      total: 0,
    }));

    for (const e of eventos) {
      if (!e.data_inicio) continue;
      const dt = new Date(e.data_inicio);
      if (Number.isNaN(dt.getTime())) continue;
      const idx = dt.getMonth();
      if (eventosPorMesBase[idx]) eventosPorMesBase[idx].total += 1;
    }

    const { data: recentesRaw, error: recentesError } = await supabase
      .from('members')
      .select('name,tipo_cadastro,status,created_at')
      .order('created_at', { ascending: false })
      .limit(5);

    if (recentesError) throw new Error(recentesError.message);

    const ultimosRegistros = (recentesRaw || []).map((row) => ({
      nome: String(row.name || 'Sem nome'),
      tipo: row.tipo_cadastro ? String(row.tipo_cadastro) : null,
      status: row.status ? String(row.status) : null,
      criadoEm: row.created_at ? String(row.created_at) : null,
    }));

    return NextResponse.json({
      secretaria: {
        ministrosAtivos: actRes.count ?? 0,
        campos: camRes.count ?? 0,
        supervisoes: supRes.count ?? 0,
        candidatos: candRes.count ?? 0,
        credenciaisEmitidas: credRes.count ?? 0,
        cartasEmitidas: null,
        cartasDisponiveis: false,
        ministrosInativos: inatRes.count ?? 0,
        transferidos: transfRes.count ?? 0,
        credenciaisVencidas: vencRes.count ?? 0,
        registrosRecentes: recentRes.count ?? 0,
        janelaRecentesDias: 30,
      },
      cgadb: {
        registrados,
        naoRegistrados,
        comDebito,
        semDebito,
        regularidadePct,
      },
      eventos: {
        eventosAbertos: eventosAbertos.length,
        inscricoesAtivas,
        proximoEvento: proximoEvento
          ? { nome: proximoEvento.nome, dataInicio: proximoEvento.data_inicio }
          : null,
        inscritosEventosAbertos,
      },
      graficos: {
        cgadbSituacao: [
          { label: 'Com debito', value: comDebito },
          { label: 'Sem debito', value: semDebito },
          { label: 'Nao registrado', value: naoRegistrados },
        ],
        ministrosPorSupervisao: supervisoesOrdenadas,
        eventosPorMes: eventosPorMesBase,
      },
      ultimosRegistros,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro interno';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
