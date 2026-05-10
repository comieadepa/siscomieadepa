import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import {
  calcularPrioridadeHospedagem,
  sugerirAlojamento,
  type Alojamento,
  type InscricaoParaHospedagem,
} from '@/lib/hospedagem-helpers';

/**
 * POST /api/eventos/[eventoId]/hospedagens/alocar
 *
 * Executa autoalocação de todas as hospedagens com status 'solicitada'.
 * Ordena por prioridade decrescente e tenta alocar em alojamentos compatíveis.
 * Atualiza status para 'confirmada' ou 'lista_espera'.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;
  const supabase = createServerClient();

  // Busca alojamentos ativos com vagas
  const { data: alojamentosRaw, error: errAloj } = await supabase
    .from('evento_alojamentos')
    .select('id,nome,publico,sexo,total_vagas,camas_inferiores,camas_superiores,ativo')
    .eq('evento_id', eventoId)
    .eq('ativo', true);

  if (errAloj) return NextResponse.json({ error: errAloj.message }, { status: 500 });

  // Busca hospedagens pendentes (status = 'solicitada'), ordenadas por prioridade desc
  const { data: pendentes, error: errHosp } = await supabase
    .from('evento_hospedagens')
    .select(`
      id, prioridade, necessidade_especial, descricao_necessidade, cama_inferior,
      inscricao_id,
      evento_inscricoes (
        id, nome_inscrito, sexo, data_nascimento, tipo_inscricao,
        hosp_necessidade_especial, hosp_descricao_necessidade,
        hosp_cama_inferior, hosp_observacoes
      )
    `)
    .eq('evento_id', eventoId)
    .eq('status', 'solicitada')
    .order('prioridade', { ascending: false });

  if (errHosp) return NextResponse.json({ error: errHosp.message }, { status: 500 });

  // Busca contagem atual de ocupação por alojamento (confirmados)
  const { data: confirmados } = await supabase
    .from('evento_hospedagens')
    .select('alojamento_id, tipo_cama')
    .eq('evento_id', eventoId)
    .eq('status', 'confirmada');

  // Mapa mutável de vagas (atualizado a cada alocação no loop)
  const vagasMap: Record<string, { total: number; inferiores: number; superiores: number }> = {};

  for (const aloj of alojamentosRaw ?? []) {
    const conf = (confirmados ?? []).filter(c => c.alojamento_id === aloj.id);
    vagasMap[aloj.id] = {
      total:      aloj.total_vagas      - conf.length,
      inferiores: aloj.camas_inferiores - conf.filter(c => c.tipo_cama === 'inferior').length,
      superiores: aloj.camas_superiores - conf.filter(c => c.tipo_cama === 'superior').length,
    };
  }

  const alojamentos = (alojamentosRaw ?? []).map(a => ({
    ...a,
    evento_id: eventoId,
    vagas_livres:      vagasMap[a.id]?.total      ?? 0,
    inferiores_livres: vagasMap[a.id]?.inferiores ?? 0,
    superiores_livres: vagasMap[a.id]?.superiores ?? 0,
  })) as unknown as Alojamento[];

  let confirmados_count = 0;
  let lista_espera_count = 0;

  for (const hosp of pendentes ?? []) {
    const insc = hosp.evento_inscricoes as unknown as InscricaoParaHospedagem | null;
    if (!insc) continue;

    // Re-calcular prioridade
    const prioridade = calcularPrioridadeHospedagem(insc);

    // Atualiza vagas_livres nos objetos alojamento a cada iteração
    for (const a of alojamentos) {
      a.vagas_livres      = vagasMap[a.id]?.total      ?? 0;
      a.inferiores_livres = vagasMap[a.id]?.inferiores ?? 0;
      a.superiores_livres = vagasMap[a.id]?.superiores ?? 0;
    }

    const sugestao = sugerirAlojamento(insc, alojamentos, prioridade);

    // Atualiza a hospedagem
    await supabase
      .from('evento_hospedagens')
      .update({
        alojamento_id:       sugestao.alojamento_id,
        tipo_cama:           sugestao.tipo_cama,
        status:              sugestao.status,
        prioridade:          sugestao.prioridade,
        alocacao_automatica: true,
      })
      .eq('id', hosp.id);

    if (sugestao.status === 'confirmada' && sugestao.alojamento_id) {
      // Desconta da disponibilidade local
      vagasMap[sugestao.alojamento_id].total--;
      if (sugestao.tipo_cama === 'inferior') vagasMap[sugestao.alojamento_id].inferiores--;
      if (sugestao.tipo_cama === 'superior') vagasMap[sugestao.alojamento_id].superiores--;
      confirmados_count++;
    } else {
      lista_espera_count++;
    }
  }

  return NextResponse.json({
    ok: true,
    processados: (pendentes ?? []).length,
    confirmados: confirmados_count,
    lista_espera: lista_espera_count,
  });
}
