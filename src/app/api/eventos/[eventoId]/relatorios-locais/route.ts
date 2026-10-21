import { NextRequest, NextResponse } from 'next/server';
import { requireEventoPermission } from '@/lib/evento-guard';

const formatterBelemDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Belem',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const formatterBelemDateTime = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Belem',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

const DIAS_SEMANA_ABREV = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function toBelemDate(isoStr: string | null | undefined): string {
  if (!isoStr) return '';
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return String(isoStr).slice(0, 10);
    return formatterBelemDate.format(d);
  } catch {
    return String(isoStr).slice(0, 10);
  }
}

function toBelemDateTime(isoStr: string | null | undefined): string {
  if (!isoStr) return '-';
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return String(isoStr);
    return formatterBelemDateTime.format(d);
  } catch {
    return String(isoStr);
  }
}

async function fetchAllRows<T>(
  queryBuilder: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const PAGE = 1000;
  const result: T[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await queryBuilder(from, from + PAGE - 1);
    if (error) throw error;
    const rows = data ?? [];
    result.push(...rows);
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return result;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;
  if (!eventoId) {
    return NextResponse.json({ error: 'eventoId obrigatorio.' }, { status: 400 });
  }

  // 1. Autorização server-side
  const guard = await requireEventoPermission(request, eventoId, 'relatorios');
  if (!guard.ok) return guard.response;
  const supabase = guard.ctx.supabaseAdmin;

  const { searchParams } = new URL(request.url);
  const visao = searchParams.get('visao') || 'plenarias'; // 'plenarias' | 'restaurantes'
  const localIdParam = searchParams.get('local_id') || '';
  const dataParam = searchParams.get('data') || '';
  const dataInicioParam = searchParams.get('data_inicio') || '';
  const dataFimParam = searchParams.get('data_fim') || '';
  const sessaoParam = searchParams.get('sessao') || '';

  // 2. Buscar informações do evento
  const { data: evento } = await supabase
    .from('eventos')
    .select('id, nome, data_inicio, data_fim, departamento')
    .eq('id', eventoId)
    .single();

  if (!evento) {
    return NextResponse.json({ error: 'Evento não encontrado.' }, { status: 404 });
  }

  // 3. Buscar TODOS os locais cadastrados para o evento (inclusive inativos para manter histórico)
  const { data: locaisTodos } = await supabase
    .from('evento_locais_checkin')
    .select('id, evento_id, tipo, nome, descricao, ativo, ordem')
    .eq('evento_id', eventoId)
    .order('ordem', { ascending: true })
    .order('nome', { ascending: true });

  const mapaLocais = new Map<string, { id: string; nome: string; tipo: string; ativo: boolean }>();
  (locaisTodos || []).forEach(loc => {
    mapaLocais.set(loc.id, loc);
  });

  // ─────────────────────────────────────────────────────────────
  // VISÃO 1: PRESENÇAS POR PLENÁRIA
  // ─────────────────────────────────────────────────────────────
  if (visao === 'plenarias') {
    const locaisPlenaria = (locaisTodos || []).filter(l => l.tipo === 'plenaria');

    // Montar consulta de evento_checkins
    // Considerar EXCLUSIVAMENTE tipo_checkin = 'plenaria' (evitando logs auxiliares de credenciamento)
    let checkinRows: any[] = [];
    try {
      checkinRows = await fetchAllRows<any>((from, to) => {
        let q = supabase
          .from('evento_checkins')
          .select(`
            id,
            created_at,
            data_plenaria,
            sessao,
            local_id,
            checkin_user,
            inscricao_id,
            evento_inscricoes (
              id,
              nome_inscrito,
              cpf,
              tipo_inscricao,
              supervisao_id,
              campo_id,
              ministro_snapshot
            )
          `)
          .eq('evento_id', eventoId)
          .eq('tipo_checkin', 'plenaria')
          .order('created_at', { ascending: false });

        if (localIdParam) {
          if (localIdParam === '__sem_local__') {
            q = q.is('local_id', null);
          } else {
            q = q.eq('local_id', localIdParam);
          }
        }

        if (dataParam) {
          q = q.eq('data_plenaria', dataParam);
        }

        if (sessaoParam) {
          q = q.eq('sessao', sessaoParam);
        }

        return q.range(from, to) as unknown as PromiseLike<{ data: any[] | null; error: unknown }>;
      });
    } catch (err: any) {
      console.error('Erro ao buscar presencas plenaria:', err);
      return NextResponse.json({ error: 'Erro ao consultar presenças da plenária.' }, { status: 500 });
    }

    // Listas disponíveis para filtros
    const datasDisponiveisSet = new Set<string>();
    const sessoesDisponiveisSet = new Set<string>();

    // Processar registros
    const distribuicaoLocaisMap = new Map<string, { id: string; nome: string; ativo: boolean | null; total: number }>();
    const distribuicaoSessoesMap = new Map<string, number>();
    const distribuicaoDatasMap = new Map<string, number>();
    const participantesUnicosSet = new Set<string>();

    // Inicializar distribuição com todos os locais de plenária cadastrados
    locaisPlenaria.forEach(loc => {
      distribuicaoLocaisMap.set(loc.id, {
        id: loc.id,
        nome: loc.nome,
        ativo: loc.ativo,
        total: 0,
      });
    });

    const listaFormatada = checkinRows.map(row => {
      const loc = row.local_id ? mapaLocais.get(row.local_id) : null;
      const localNome = loc ? loc.nome : 'Local não especificado';
      const localAtivo = loc ? loc.ativo : null;
      const insc = Array.isArray(row.evento_inscricoes) ? row.evento_inscricoes[0] : row.evento_inscricoes;

      if (row.data_plenaria) datasDisponiveisSet.add(row.data_plenaria);
      if (row.sessao) sessoesDisponiveisSet.add(row.sessao);
      if (row.inscricao_id) participantesUnicosSet.add(row.inscricao_id);

      // Contagem por local
      const kLocal = row.local_id || '__sem_local__';
      const itemLocal = distribuicaoLocaisMap.get(kLocal) ?? {
        id: kLocal,
        nome: localNome,
        ativo: localAtivo,
        total: 0,
      };
      itemLocal.total += 1;
      distribuicaoLocaisMap.set(kLocal, itemLocal);

      // Contagem por sessão
      const kSessao = row.sessao || 'Sessão Única / Não informada';
      distribuicaoSessoesMap.set(kSessao, (distribuicaoSessoesMap.get(kSessao) ?? 0) + 1);

      // Contagem por data
      const kData = row.data_plenaria || toBelemDate(row.created_at);
      distribuicaoDatasMap.set(kData, (distribuicaoDatasMap.get(kData) ?? 0) + 1);

      return {
        id: row.id,
        created_at: row.created_at,
        horario_belem: toBelemDateTime(row.created_at),
        data_plenaria: row.data_plenaria || toBelemDate(row.created_at),
        sessao: row.sessao || null,
        local_id: row.local_id || null,
        local_nome: localNome,
        local_ativo: localAtivo,
        operador: row.checkin_user || '-',
        inscricao_id: row.inscricao_id,
        nome_inscrito: insc?.nome_inscrito || 'Participante não localizado',
        cpf: insc?.cpf || null,
        tipo_inscricao: insc?.tipo_inscricao || (insc?.ministro_snapshot as any)?.cargo || 'Geral',
        matricula: (insc?.ministro_snapshot as any)?.matricula || null,
        supervisao_id: insc?.supervisao_id || null,
        campo_id: insc?.campo_id || null,
      };
    });

    const distribuicaoLocais = Array.from(distribuicaoLocaisMap.values()).sort((a, b) => {
      if (a.id === '__sem_local__') return 1;
      if (b.id === '__sem_local__') return -1;
      return a.nome.localeCompare(b.nome);
    });

    const distribuicaoSessoes = Array.from(distribuicaoSessoesMap.entries())
      .map(([sessao, total]) => ({ sessao, total }))
      .sort((a, b) => a.sessao.localeCompare(b.sessao));

    const distribuicaoDatas = Array.from(distribuicaoDatasMap.entries())
      .map(([data, total]) => ({ data, total }))
      .sort((a, b) => a.data.localeCompare(b.data));

    return NextResponse.json({
      ok: true,
      visao: 'plenarias',
      evento,
      totais: {
        total_presencas: checkinRows.length,
        participantes_unicos: participantesUnicosSet.size,
      },
      filtros_disponiveis: {
        locais: locaisPlenaria.map(l => ({ id: l.id, nome: l.nome, ativo: l.ativo })),
        tem_registros_sem_local: distribuicaoLocaisMap.has('__sem_local__') && (distribuicaoLocaisMap.get('__sem_local__')?.total ?? 0) > 0,
        datas: Array.from(datasDisponiveisSet).sort(),
        sessoes: Array.from(sessoesDisponiveisSet).sort(),
      },
      distribuicao_locais: distribuicaoLocais,
      distribuicao_sessoes: distribuicaoSessoes,
      distribuicao_datas: distribuicaoDatas,
      registros: listaFormatada,
    });
  }

  // ─────────────────────────────────────────────────────────────
  // VISÃO 2: CONSUMO POR RESTAURANTE / REFEITÓRIO
  // ─────────────────────────────────────────────────────────────
  const locaisRestaurante = (locaisTodos || []).filter(l => l.tipo === 'refeitorio');

  // Fonte oficial: evento_refeicoes_consumo (1 consumo = 1 unidade debitada)
  let consumoRows: any[] = [];
  try {
    consumoRows = await fetchAllRows<any>((from, to) => {
      let q = supabase
        .from('evento_refeicoes_consumo')
        .select(`
          id,
          data_hora,
          saldo_antes,
          saldo_depois,
          local_id,
          operador_id,
          qr_code,
          inscricao_id,
          evento_inscricoes (
            id,
            nome_inscrito,
            cpf,
            tipo_inscricao,
            supervisao_id,
            campo_id,
            ministro_snapshot
          )
        `)
        .eq('evento_id', eventoId)
        .eq('tipo_consumo', 'refeicao')
        .order('data_hora', { ascending: false });

      if (localIdParam) {
        if (localIdParam === '__sem_local__') {
          q = q.is('local_id', null);
        } else {
          q = q.eq('local_id', localIdParam);
        }
      }

      return q.range(from, to) as unknown as PromiseLike<{ data: any[] | null; error: unknown }>;
    });
  } catch (err: any) {
    console.error('Erro ao buscar consumo de refeicoes:', err);
    return NextResponse.json({ error: 'Erro ao consultar consumo de refeições.' }, { status: 500 });
  }

  // Filtragem por período/data no fuso de Belém
  const dataHojeBelem = formatterBelemDate.format(new Date());

  const filtradosPorData = consumoRows.filter(row => {
    const diaBelem = toBelemDate(row.data_hora);
    if (dataParam && diaBelem !== dataParam) return false;
    if (dataInicioParam && diaBelem < dataInicioParam) return false;
    if (dataFimParam && diaBelem > dataFimParam) return false;
    return true;
  });

  const distribuicaoRestaurantesMap = new Map<string, { id: string; nome: string; ativo: boolean | null; total: number; percentual: number }>();
  const consumoPorDiaMap = new Map<string, number>();
  const participantesAtendidosSet = new Set<string>();
  const datasDisponiveisSet = new Set<string>();

  // Inicializar com todos os restaurantes cadastrados
  locaisRestaurante.forEach(loc => {
    distribuicaoRestaurantesMap.set(loc.id, {
      id: loc.id,
      nome: loc.nome,
      ativo: loc.ativo,
      total: 0,
      percentual: 0,
    });
  });

  let totalHoje = 0;
  const totalGeral = filtradosPorData.length;

  const listaFormatada = filtradosPorData.map(row => {
    const loc = row.local_id ? mapaLocais.get(row.local_id) : null;
    const localNome = loc ? loc.nome : 'Local não especificado';
    const localAtivo = loc ? loc.ativo : null;
    const insc = Array.isArray(row.evento_inscricoes) ? row.evento_inscricoes[0] : row.evento_inscricoes;
    const diaBelem = toBelemDate(row.data_hora);

    datasDisponiveisSet.add(diaBelem);
    if (row.inscricao_id) participantesAtendidosSet.add(row.inscricao_id);
    if (diaBelem === dataHojeBelem) totalHoje += 1;

    // Contagem por restaurante
    const kLocal = row.local_id || '__sem_local__';
    const itemRest = distribuicaoRestaurantesMap.get(kLocal) ?? {
      id: kLocal,
      nome: localNome,
      ativo: localAtivo,
      total: 0,
      percentual: 0,
    };
    itemRest.total += 1;
    distribuicaoRestaurantesMap.set(kLocal, itemRest);

    // Contagem por dia
    consumoPorDiaMap.set(diaBelem, (consumoPorDiaMap.get(diaBelem) ?? 0) + 1);

    return {
      id: row.id,
      data_hora: row.data_hora,
      horario_belem: toBelemDateTime(row.data_hora),
      dia_belem: diaBelem,
      local_id: row.local_id || null,
      local_nome: localNome,
      local_ativo: localAtivo,
      saldo_antes: row.saldo_antes,
      saldo_depois: row.saldo_depois,
      inscricao_id: row.inscricao_id,
      nome_inscrito: insc?.nome_inscrito || 'Participante não localizado',
      cpf: insc?.cpf || null,
      tipo_inscricao: insc?.tipo_inscricao || (insc?.ministro_snapshot as any)?.cargo || 'Geral',
      matricula: (insc?.ministro_snapshot as any)?.matricula || null,
      supervisao_id: insc?.supervisao_id || null,
      campo_id: insc?.campo_id || null,
    };
  });

  // Calcular percentuais por restaurante
  const distribuicaoRestaurantes = Array.from(distribuicaoRestaurantesMap.values()).map(r => ({
    ...r,
    percentual: totalGeral > 0 ? Math.round((r.total / totalGeral) * 100) : 0,
  })).sort((a, b) => {
    if (a.id === '__sem_local__') return 1;
    if (b.id === '__sem_local__') return -1;
    return a.nome.localeCompare(b.nome);
  });

  // Dias ordenados
  const consumoPorDia = Array.from(consumoPorDiaMap.entries())
    .map(([dataStr, total]) => {
      let diaMes = dataStr.slice(5).replace('-', '/');
      let diaSemana = '';
      try {
        const [y, m, d] = dataStr.split('-').map(Number);
        const dt = new Date(y, m - 1, d);
        diaMes = `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
        diaSemana = DIAS_SEMANA_ABREV[dt.getDay()] || '';
      } catch {
        // Fallback
      }
      return {
        data: dataStr,
        dia_formatado: `${diaMes} (${diaSemana})`,
        total,
        percentual: totalGeral > 0 ? Math.round((total / totalGeral) * 100) : 0,
      };
    })
    .sort((a, b) => a.data.localeCompare(b.data));

  return NextResponse.json({
    ok: true,
    visao: 'restaurantes',
    evento,
    totais: {
      total_refeicoes: totalGeral,
      total_hoje: totalHoje,
      participantes_atendidos: participantesAtendidosSet.size,
    },
    filtros_disponiveis: {
      locais: locaisRestaurante.map(l => ({ id: l.id, nome: l.nome, ativo: l.ativo })),
      tem_registros_sem_local: distribuicaoRestaurantesMap.has('__sem_local__') && (distribuicaoRestaurantesMap.get('__sem_local__')?.total ?? 0) > 0,
      datas: Array.from(datasDisponiveisSet).sort(),
    },
    consumo_por_dia: consumoPorDia,
    distribuicao_restaurantes: distribuicaoRestaurantes,
    registros: listaFormatada,
  });
}
