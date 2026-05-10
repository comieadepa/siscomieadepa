import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, createServerClientFromCookies } from '@/lib/supabase-server';

const DEPTS = ['AGO', 'UMADESPA', 'COADESPA', 'SEIADEPA', 'AVULSO'];

// ─── Tipos internos ────────────────────────────────────────────
interface InscRow {
  evento_id: string;
  status_pagamento: string;
  valor_pago: number | null;
  checkin_realizado: boolean;
  certificado_enviado: boolean;
  hospedagem: boolean;
  created_at: string;
}

interface EventoRow {
  id: string;
  nome: string;
  slug: string;
  departamento: string;
  status: string;
  banner_url: string | null;
  data_inicio: string;
  data_fim: string;
  limite_vagas: number | null;
  limite_hospedagem: number | null;
  gerar_certificado: boolean;
  valor_inscricao: number;
  inscricoes_abertas: boolean;
}

interface StatsEvento {
  inscritos: number;
  presentes: number;
  pagos: number;
  pendentes: number;
  arrecadacao: number;
  hospedagem_usada: number;
  certificados: number;
}

// ─── Handler ────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  // ── Auth: apenas super/admin ──
  const userClient = await createServerClientFromCookies();
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

  const nivel = (user.user_metadata?.nivel as string | undefined) ?? '';
  if (!['super', 'admin'].includes(nivel)) {
    return NextResponse.json({ error: 'Acesso negado' }, { status: 403 });
  }

  const supabase = createServerClient();

  // ── Filtros ──
  const { searchParams } = new URL(req.url);
  const ano          = searchParams.get('ano')          ?? String(new Date().getFullYear());
  const depto        = searchParams.get('departamento') ?? '';
  const statusFiltro = searchParams.get('status')       ?? '';

  // ── Query eventos ──
  let query = supabase
    .from('eventos')
    .select('id, nome, slug, departamento, status, banner_url, data_inicio, data_fim, limite_vagas, limite_hospedagem, gerar_certificado, valor_inscricao, inscricoes_abertas')
    .gte('data_inicio', `${ano}-01-01`)
    .lte('data_inicio', `${ano}-12-31`)
    .order('data_inicio', { ascending: false });

  if (depto)        query = query.eq('departamento', depto);
  if (statusFiltro) query = query.eq('status', statusFiltro);

  const { data: eventosRaw, error: errEvt } = await query;
  if (errEvt) return NextResponse.json({ error: errEvt.message }, { status: 500 });

  const eventos = (eventosRaw ?? []) as EventoRow[];

  // Resposta vazia quando não há eventos
  if (eventos.length === 0) {
    return NextResponse.json({
      resumo: {
        total_eventos: 0, eventos_ativos: 0, eventos_encerrados: 0,
        inscricoes_totais: 0, presentes_totais: 0, pendentes_pagamento: 0,
        valor_arrecadado: 0, certificados_emitidos: 0,
      },
      por_departamento: DEPTS.map(d => ({
        dept: d, total_eventos: 0, inscritos: 0, presentes: 0,
        arrecadacao: 0, hospedagem: 0, pendencias: 0,
      })),
      eventos_ativos: [],
      alertas: [],
      evolucao_diaria: buildEvoluoVazia(),
      anos_disponiveis: [Number(ano)],
    });
  }

  const eventoIds = eventos.map(e => e.id);

  // ── Query inscrições ──
  const { data: inscRaw } = await supabase
    .from('evento_inscricoes')
    .select('evento_id, status_pagamento, valor_pago, checkin_realizado, certificado_enviado, hospedagem, created_at')
    .in('evento_id', eventoIds);

  const insc = (inscRaw ?? []) as InscRow[];

  // ── Agrega por evento ──
  const statsMap: Record<string, StatsEvento> = {};
  for (const i of insc) {
    const s: StatsEvento = statsMap[i.evento_id] ?? {
      inscritos: 0, presentes: 0, pagos: 0, pendentes: 0,
      arrecadacao: 0, hospedagem_usada: 0, certificados: 0,
    };
    s.inscritos++;
    if (i.checkin_realizado) s.presentes++;
    if (['pago', 'isento'].includes(i.status_pagamento)) {
      s.pagos++;
      s.arrecadacao += i.valor_pago ?? 0;
    }
    if (i.status_pagamento === 'pendente') s.pendentes++;
    if (i.hospedagem) s.hospedagem_usada++;
    if (i.certificado_enviado) s.certificados++;
    statsMap[i.evento_id] = s;
  }

  // ── Resumo geral ──
  const resumo = {
    total_eventos:        eventos.length,
    eventos_ativos:       eventos.filter(e => e.status === 'programado').length,
    eventos_encerrados:   eventos.filter(e => e.status === 'realizado').length,
    inscricoes_totais:    insc.length,
    presentes_totais:     insc.filter(i => i.checkin_realizado).length,
    pendentes_pagamento:  insc.filter(i => i.status_pagamento === 'pendente').length,
    valor_arrecadado:     insc
      .filter(i => ['pago', 'isento'].includes(i.status_pagamento))
      .reduce((acc, i) => acc + (i.valor_pago ?? 0), 0),
    certificados_emitidos: insc.filter(i => i.certificado_enviado).length,
  };

  // ── Por departamento ──
  const por_departamento = DEPTS.map(dept => {
    const dIds = eventos.filter(e => e.departamento === dept).map(e => e.id);
    const dInsc = insc.filter(i => dIds.includes(i.evento_id));
    return {
      dept,
      total_eventos: dIds.length,
      inscritos:    dInsc.length,
      presentes:    dInsc.filter(i => i.checkin_realizado).length,
      arrecadacao:  dInsc
        .filter(i => ['pago', 'isento'].includes(i.status_pagamento))
        .reduce((acc, i) => acc + (i.valor_pago ?? 0), 0),
      hospedagem:  dInsc.filter(i => i.hospedagem).length,
      pendencias:  dInsc.filter(i => i.status_pagamento === 'pendente').length,
    };
  });

  // ── Eventos ativos ──
  const hoje = new Date().toISOString().split('T')[0];
  const eventos_ativos = eventos
    .filter(e => e.status === 'programado')
    .map(e => {
      const s = statsMap[e.id] ?? { inscritos: 0, presentes: 0, arrecadacao: 0, hospedagem_usada: 0 };
      return {
        id: e.id, nome: e.nome, slug: e.slug,
        departamento: e.departamento,
        banner_url: e.banner_url,
        data_inicio: e.data_inicio, data_fim: e.data_fim,
        total_inscritos: s.inscritos,
        presentes: s.presentes,
        arrecadacao: s.arrecadacao,
        pct_presenca: s.inscritos > 0 ? Math.round((s.presentes / s.inscritos) * 100) : 0,
        limite_vagas: e.limite_vagas,
        limite_hospedagem: e.limite_hospedagem,
        hospedagem_usada: s.hospedagem_usada,
      };
    });

  // ── Alertas ──
  type NivelAlerta = 'danger' | 'warning' | 'info';
  const alertas: {
    tipo: string; mensagem: string; nivel: NivelAlerta;
    evento_id?: string; evento_nome?: string;
  }[] = [];

  for (const e of eventos) {
    const s = statsMap[e.id] ?? {
      inscritos: 0, presentes: 0, pagos: 0, pendentes: 0,
      arrecadacao: 0, hospedagem_usada: 0, certificados: 0,
    };

    if (e.status !== 'programado') continue;

    // Hospedagem lotada
    if (e.limite_hospedagem && s.hospedagem_usada >= e.limite_hospedagem) {
      alertas.push({ tipo: 'hospedagem_lotada', nivel: 'danger',
        mensagem: `Hospedagem lotada (${s.hospedagem_usada}/${e.limite_hospedagem})`,
        evento_id: e.id, evento_nome: e.nome });
    }

    // Vagas acabando (≥ 90%)
    if (e.limite_vagas && s.inscritos >= Math.floor(e.limite_vagas * 0.9)) {
      alertas.push({ tipo: 'vagas_acabando', nivel: 'warning',
        mensagem: `Vagas acabando — ${s.inscritos}/${e.limite_vagas}`,
        evento_id: e.id, evento_nome: e.nome });
    }

    // Muitos pendentes (> 30% dos inscritos)
    if (s.inscritos > 5 && s.pendentes > s.inscritos * 0.3) {
      alertas.push({ tipo: 'pendentes', nivel: 'warning',
        mensagem: `${s.pendentes} pagtos pendentes (${Math.round((s.pendentes / s.inscritos) * 100)}%)`,
        evento_id: e.id, evento_nome: e.nome });
    }

    // Evento com data chegada e sem check-in
    if (e.data_inicio <= hoje && s.inscritos > 0 && s.presentes === 0) {
      alertas.push({ tipo: 'sem_checkin', nivel: 'warning',
        mensagem: `Evento iniciado mas sem check-ins registrados`,
        evento_id: e.id, evento_nome: e.nome });
    }

    // Certificados pendentes
    if (e.gerar_certificado && s.presentes > 0 && s.certificados < s.presentes) {
      alertas.push({ tipo: 'certificados_pendentes', nivel: 'info',
        mensagem: `${s.presentes - s.certificados} certificados ainda não emitidos`,
        evento_id: e.id, evento_nome: e.nome });
    }
  }

  // ── Evolução diária (últimos 30 dias) ──
  const evolucao_diaria = buildEvolucaoDiaria(insc);

  return NextResponse.json({
    resumo,
    por_departamento,
    eventos_ativos,
    alertas,
    evolucao_diaria,
  });
}

// ── Helpers ─────────────────────────────────────────────────────
function buildEvolucaoDiaria(insc: InscRow[]) {
  const agora = new Date();
  const inicio = new Date(agora);
  inicio.setDate(inicio.getDate() - 29);
  const inicioStr = inicio.toISOString().split('T')[0];

  const mapa: Record<string, number> = {};
  for (const i of insc) {
    const dia = i.created_at.split('T')[0];
    if (dia >= inicioStr) {
      mapa[dia] = (mapa[dia] ?? 0) + 1;
    }
  }

  const resultado: { data: string; inscricoes: number }[] = [];
  for (let d = 0; d < 30; d++) {
    const dt = new Date(inicio);
    dt.setDate(dt.getDate() + d);
    const key = dt.toISOString().split('T')[0];
    resultado.push({ data: key, inscricoes: mapa[key] ?? 0 });
  }
  return resultado;
}

function buildEvoluoVazia() {
  const agora = new Date();
  const inicio = new Date(agora);
  inicio.setDate(inicio.getDate() - 29);
  return Array.from({ length: 30 }, (_, d) => {
    const dt = new Date(inicio);
    dt.setDate(dt.getDate() + d);
    return { data: dt.toISOString().split('T')[0], inscricoes: 0 };
  });
}
