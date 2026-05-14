import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { requireModuleAccess } from '@/lib/auth/require-auth';

const PAGE_LIMIT = 1000;

type MemberRow = {
  id: string;
  name: string | null;
  cpf: string | null;
  numero_cgadb?: string | null;
  custom_fields?: Record<string, unknown> | null;
};

type DebitoRow = {
  id: string;
  cpf: string | null;
  nome: string | null;
  registro: string | null;
  ano: number | null;
  valor: number | null;
  status: string | null;
  imported_at: string | null;
};

const normalizeCpf = (cpf?: string | null) => (cpf || '').replace(/\D/g, '');

const fmtNumber = (v: number) => Number.isFinite(v) ? v : 0;

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
      .select('id,name,cpf,numero_cgadb,custom_fields')
      .or('status.eq.active,tipo_cadastro.eq.ministro')
      .order('name')
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
      .select('id,cpf,nome,registro,ano,valor,status,imported_at')
      .order('ano', { ascending: false })
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
  const auth = await requireModuleAccess(request, 'cgadb');
  if (!auth.ok) return auth.response;

  try {
    const supabase = createServerClient();

    const [members, debitos] = await Promise.all([
      fetchAllMembers(supabase),
      fetchAllDebitos(supabase),
    ]);

    const memberByCpf = new Map<string, MemberRow>();
    for (const m of members) {
      const cpf = normalizeCpf(m.cpf);
      if (cpf) memberByCpf.set(cpf, m);
    }

    const debitosByCpf = new Map<string, DebitoRow[]>();
    const debitosPorAno = new Map<number, { totalValor: number; cpfs: Set<string> }>();
    let totalDebitoGeral = 0;
    let ultimaAtualizacao: string | null = null;

    for (const d of debitos) {
      const cpf = normalizeCpf(d.cpf);
      if (!cpf) continue;
      if (!debitosByCpf.has(cpf)) debitosByCpf.set(cpf, []);
      debitosByCpf.get(cpf)!.push(d);

      const valor = fmtNumber(d.valor ?? 0);
      totalDebitoGeral += valor;

      if (d.ano) {
        const entry = debitosPorAno.get(d.ano) ?? { totalValor: 0, cpfs: new Set<string>() };
        entry.totalValor += valor;
        entry.cpfs.add(cpf);
        debitosPorAno.set(d.ano, entry);
      }

      if (d.imported_at) {
        if (!ultimaAtualizacao || new Date(d.imported_at) > new Date(ultimaAtualizacao)) {
          ultimaAtualizacao = d.imported_at;
        }
      }
    }

    const currentYear = new Date().getFullYear();
    const limiteAnoAntigo = currentYear - 2;

    let totalMinistros = members.length;
    let totalNaoRegistrado = 0;
    let ministrosComDebito = 0;
    let ministrosSemDebito = 0;
    let ministrosComDebitosAntigos = 0;

    const maioresDebitos: Array<{
      nome: string;
      supervisao: string;
      anos: number[];
      total: number;
      status: string;
      registro: string | null;
    }> = [];

    const supervisaoMap = new Map<string, { totalValor: number; cpfs: Set<string> }>();

    for (const m of members) {
      const cpf = normalizeCpf(m.cpf);
      const registro = getRegistroCgadb(m);
      const registrado = registro.length > 0;
      if (!registrado) totalNaoRegistrado += 1;

      const debs = cpf ? debitosByCpf.get(cpf) || [] : [];
      const total = debs.reduce((acc, d) => acc + fmtNumber(d.valor ?? 0), 0);
      const anos = debs.map((d) => d.ano || 0).filter(Boolean) as number[];
      const anosUnicos = Array.from(new Set(anos)).sort((a, b) => b - a);
      const status = (debs.find((d) => d.status)?.status || '').toUpperCase();

      if (registrado) {
        if (debs.length > 0) ministrosComDebito += 1;
        else ministrosSemDebito += 1;
      }

      if (debs.some((d) => (d.ano ?? 0) <= limiteAnoAntigo)) {
        ministrosComDebitosAntigos += 1;
      }

      const supervisao = String((m.custom_fields as Record<string, unknown>)?.supervisao || 'Sem Supervisão');
      if (debs.length > 0) {
        const entry = supervisaoMap.get(supervisao) ?? { totalValor: 0, cpfs: new Set<string>() };
        entry.totalValor += total;
        if (cpf) entry.cpfs.add(cpf);
        supervisaoMap.set(supervisao, entry);

        maioresDebitos.push({
          nome: String(m.name || '—'),
          supervisao,
          anos: anosUnicos,
          total,
          status: status || '—',
          registro: registro || null,
        });
      }
    }

    const maioresDebitosOrdenados = maioresDebitos
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);

    const supervisoesCriticas = Array.from(supervisaoMap.entries())
      .map(([supervisao, info]) => ({
        supervisao,
        totalDevedores: info.cpfs.size,
        totalValor: info.totalValor,
      }))
      .sort((a, b) => b.totalValor - a.totalValor)
      .slice(0, 10)
      .map((item) => ({
        ...item,
        percentual: totalDebitoGeral > 0 ? (item.totalValor / totalDebitoGeral) * 100 : 0,
      }));

    const porAno = Array.from(debitosPorAno.entries())
      .map(([ano, info]) => ({
        ano,
        totalDevedores: info.cpfs.size,
        totalValor: info.totalValor,
      }))
      .sort((a, b) => b.ano - a.ano);

    const alertas = {
      maiorDebito: maioresDebitosOrdenados[0]
        ? {
            nome: maioresDebitosOrdenados[0].nome,
            total: maioresDebitosOrdenados[0].total,
            supervisao: maioresDebitosOrdenados[0].supervisao,
            anos: maioresDebitosOrdenados[0].anos,
          }
        : null,
      supervisaoMaiorDebito: supervisoesCriticas[0]
        ? {
            supervisao: supervisoesCriticas[0].supervisao,
            total: supervisoesCriticas[0].totalValor,
            totalDevedores: supervisoesCriticas[0].totalDevedores,
          }
        : null,
      debitosAntigos: ministrosComDebitosAntigos,
      naoRegistrados: totalNaoRegistrado,
      ultimaAtualizacao,
    };

    const totalMinistrosRegistrados = totalMinistros - totalNaoRegistrado;
    const inadimplencia = totalMinistros > 0 ? (ministrosComDebito / totalMinistros) * 100 : 0;

    return NextResponse.json({
      kpis: {
        totalMinistros,
        ministrosComDebito,
        ministrosSemDebito,
        totalDebitoGeral,
        inadimplencia,
        totalNaoRegistrado,
        totalMinistrosRegistrados,
      },
      situacao: [
        { label: 'Com débito', value: ministrosComDebito },
        { label: 'Sem débito', value: ministrosSemDebito },
        { label: 'Não registrado', value: totalNaoRegistrado },
      ],
      porAno,
      porSupervisao: supervisoesCriticas,
      maioresDebitos: maioresDebitosOrdenados,
      supervisoesCriticas,
      alertas,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro interno';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
