import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const slug = (searchParams.get('slug') || '').trim();

  if (!slug) {
    return NextResponse.json({ error: 'slug obrigatorio' }, { status: 400 });
  }

  const supabase = createServerClient();
  const { data: evento, error } = await supabase
    .from('eventos')
    .select('id,nome,slug,descricao,departamento,data_inicio,data_fim,local,cidade,banner_url,valor_inscricao,permite_hospedagem,permite_alimentacao,permite_brinde,gerar_certificado,link_whatsapp,mensagem_confirmacao,inscricoes_abertas,limite_vagas,limite_hospedagem,limite_brindes,publico_alvo,usar_tipos_inscricao,status,suporte_nome,suporte_whatsapp,configuracoes_ago,tipo_inscricao_avulso')
    .eq('slug', slug)
    .single();

  if (error || !evento) {
    return NextResponse.json({ error: 'Evento nao encontrado' }, { status: 404 });
  }

  const { data: tipos } = await supabase
    .from('evento_tipos_inscricao')
    .select('id,nome,valor,inclui_alimentacao,inclui_hospedagem,ordem,quantidade_refeicoes,cortesia')
    .eq('evento_id', evento.id)
    .eq('ativo', true)
    .order('ordem');

  // Verifica se há cupons ativos para este evento
  const { count: cuponsAtivos } = await supabase
    .from('evento_cupons')
    .select('id', { count: 'exact', head: true })
    .eq('evento_id', evento.id)
    .eq('ativo', true);
  const possuiCupomAtivo = (cuponsAtivos ?? 0) > 0;

  let totalInscritos: number | null = null;
  if (evento.limite_vagas) {
    const { count } = await supabase
      .from('evento_inscricoes')
      .select('id', { count: 'exact', head: true })
      .eq('evento_id', evento.id);
    totalInscritos = count ?? 0;
  }

  let vagasHospedagem: number | null = null;
  if (evento.limite_hospedagem) {
    const { count: hospCount } = await supabase
      .from('evento_inscricoes')
      .select('id', { count: 'exact', head: true })
      .eq('evento_id', evento.id)
      .eq('hospedagem', true);
    const usadas = hospCount ?? 0;
    vagasHospedagem = Math.max(0, evento.limite_hospedagem - usadas);
  }

  let capacidadePorGrupo: Record<string, number> = {};
  let vagasPorGrupo: Record<string, number> = {};
  let filaEsperaPorGrupo: Record<string, number> = {};

  if (evento.departamento === 'AGO' && evento.permite_hospedagem) {
    const { data: alojamentosRaw } = await supabase
      .from('evento_alojamentos')
      .select('id, publico, total_vagas, ativo, is_emergencial')
      .eq('evento_id', evento.id)
      .eq('ativo', true);

    // Isolamento estrito: leitos e alojamentos emergenciais NUNCA integram a capacidade de inscrição pública
    const alojamentos = (alojamentosRaw ?? []).filter((a: any) => !a.is_emergencial);

    // Consulta hospedagens ativas (confirmada, alocada, checkin_realizado e solicitadas pendentes com inscrição não cancelada)
    // Preserva consistência integral com o backend de validação de inscrição com paginação completa
    const hospAtivas: Array<{ id: string; status: string; alojamento_id: string | null; grupo_hospedagem: string | null }> = [];
    let hospFrom = 0;
    const HOSP_PAGE_SIZE = 1000;
    while (true) {
      const { data, error } = await supabase
        .from('evento_hospedagens')
        .select('id, status, alojamento_id, grupo_hospedagem, evento_inscricoes!inner(status_pagamento)')
        .eq('evento_id', evento.id)
        .in('status', ['solicitada', 'confirmada', 'alocada', 'checkin_realizado', 'checkout_realizado'])
        .neq('evento_inscricoes.status_pagamento', 'cancelado')
        .range(hospFrom, hospFrom + HOSP_PAGE_SIZE - 1);
      if (error || !data) break;
      hospAtivas.push(...(data as any));
      if (data.length < HOSP_PAGE_SIZE) break;
      hospFrom += HOSP_PAGE_SIZE;
    }

    const PUBLICO_GRUPO: Record<string, string> = {
      presidentes:     'Pastor Presidente / Pastor Jubilado',
      jubilados:       'Pastor Presidente / Pastor Jubilado',
      masculino_geral: 'Pastor Auxiliar / Juventude',
      feminino:        'Mulheres',
      misto:           'Misto',
    };

    capacidadePorGrupo = {
      'Mulheres': 0,
      'Pastor Presidente / Pastor Jubilado': 0,
      'Pastor Auxiliar / Juventude': 0,
      'Misto': 0,
    };

    const ocupadosPorGrupo: Record<string, number> = {
      'Mulheres': 0,
      'Pastor Presidente / Pastor Jubilado': 0,
      'Pastor Auxiliar / Juventude': 0,
      'Misto': 0,
    };

    const alojamentoGrupoMap = new Map<string, string>();
    for (const aloj of alojamentos ?? []) {
      const gp = PUBLICO_GRUPO[aloj.publico] ?? 'Misto';
      capacidadePorGrupo[gp] = (capacidadePorGrupo[gp] ?? 0) + (aloj.total_vagas ?? 0);
      alojamentoGrupoMap.set(aloj.id, gp);
    }

    for (const hosp of hospAtivas ?? []) {
      if (hosp.alojamento_id) {
        const gp = alojamentoGrupoMap.get(hosp.alojamento_id) ?? hosp.grupo_hospedagem ?? 'Misto';
        ocupadosPorGrupo[gp] = (ocupadosPorGrupo[gp] ?? 0) + 1;
      } else if (hosp.grupo_hospedagem) {
        const gp = hosp.grupo_hospedagem;
        ocupadosPorGrupo[gp] = (ocupadosPorGrupo[gp] ?? 0) + 1;
      }
    }

    const grupos = ['Mulheres', 'Pastor Presidente / Pastor Jubilado', 'Pastor Auxiliar / Juventude', 'Misto'];
    for (const g of grupos) {
      vagasPorGrupo[g] = Math.max(0, capacidadePorGrupo[g] - ocupadosPorGrupo[g]);
    }

    const { data: waitlistHosp } = await supabase
      .from('evento_hospedagens')
      .select('grupo_hospedagem')
      .eq('evento_id', evento.id)
      .eq('status', 'lista_espera');

    for (const g of grupos) {
      filaEsperaPorGrupo[g] = 0;
    }
    for (const wh of waitlistHosp ?? []) {
      const gp = wh.grupo_hospedagem ?? 'Misto';
      filaEsperaPorGrupo[gp] = (filaEsperaPorGrupo[gp] ?? 0) + 1;
    }
  }

  return NextResponse.json({
    evento: { ...evento, possuiCupomAtivo },
    tipos: tipos ?? [],
    totalInscritos,
    vagasHospedagem,
    capacidadePorGrupo,
    vagasPorGrupo,
    filaEsperaPorGrupo,
  });
}
