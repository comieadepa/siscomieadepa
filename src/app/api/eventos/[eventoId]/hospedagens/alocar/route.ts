import { NextRequest, NextResponse } from 'next/server';
import { requireEventoAccess } from '@/lib/evento-guard';
import {
  calcularPrioridadeHospedagem,
  sugerirAlojamento,
  grupoMatchesAlojamento,
  type Alojamento,
  type InscricaoParaHospedagem,
} from '@/lib/hospedagem-helpers';

/**
 * POST /api/eventos/[eventoId]/hospedagens/alocar
 *
 * Autoalocação inteligente AGO — Fase 6:
 * 1. Materializa registros evento_hospedagens ausentes
 * 2. Filtra alojamentos por grupo_hospedagem (matching semântico)
 * 3. Ordena alojamentos por menor taxa de ocupação (load balance)
 * 4. Prioriza: necessidade_especial > cama_inferior > idade > prioridade
 * 5. Cria entradas em evento_hospedagem_leitos com numeração sequencial
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;
  const guard = await requireEventoAccess(_req, eventoId);
  if (!guard.ok) return guard.response;
  if (!guard.ctx.perms.podeHospedagem) {
    return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
  }
  const supabase = guard.ctx.supabaseAdmin;

  // ── 1. Alojamentos ativos ────────────────────────────────────
  const { data: alojamentosRaw, error: errAloj } = await supabase
    .from('evento_alojamentos')
    .select('id,nome,publico,sexo,total_vagas,camas_inferiores,camas_superiores,ativo')
    .eq('evento_id', eventoId)
    .eq('ativo', true);

  if (errAloj) return NextResponse.json({ error: errAloj.message }, { status: 500 });

  // ── 2. Materializa registros ausentes em evento_hospedagens ──
  const { data: todasInscricoes } = await supabase
    .from('evento_inscricoes')
    .select(`
      id, nome_inscrito, sexo, data_nascimento, tipo_inscricao,
      hosp_necessidade_especial, hosp_descricao_necessidade,
      hosp_cama_inferior, hosp_observacoes, grupo_hospedagem
    `)
    .eq('evento_id', eventoId)
    .eq('hospedagem', true);

  const { data: hospExistentes } = await supabase
    .from('evento_hospedagens')
    .select('inscricao_id')
    .eq('evento_id', eventoId);

  const idsComRegistro = new Set((hospExistentes ?? []).map(h => h.inscricao_id));
  const semRegistro = (todasInscricoes ?? []).filter(i => !idsComRegistro.has(i.id));

  if (semRegistro.length > 0) {
    const { error: errUpsert } = await supabase
      .from('evento_hospedagens')
      .upsert(
        semRegistro.map(i => ({
          evento_id:            eventoId,
          inscricao_id:         i.id,
          status:               'solicitada',
          prioridade:           calcularPrioridadeHospedagem(i as InscricaoParaHospedagem),
          necessidade_especial: Boolean(i.hosp_necessidade_especial),
          descricao_necessidade: i.hosp_descricao_necessidade ?? null,
          cama_inferior:        Boolean(i.hosp_cama_inferior),
          observacoes:          i.hosp_observacoes ?? null,
          grupo_hospedagem:     i.grupo_hospedagem ?? null,
          alocacao_automatica:  false,
        })),
        { onConflict: 'inscricao_id' },
      );
    if (errUpsert) console.error('[alocar] upsert hospedagens:', errUpsert.message);
  }

  // ── 3. Busca pendentes após materialização ───────────────────
  const { data: pendentes, error: errHosp } = await supabase
    .from('evento_hospedagens')
    .select(`
      id, prioridade, necessidade_especial, descricao_necessidade,
      cama_inferior, inscricao_id, grupo_hospedagem,
      evento_inscricoes (
        id, nome_inscrito, sexo, data_nascimento, tipo_inscricao,
        hosp_necessidade_especial, hosp_descricao_necessidade,
        hosp_cama_inferior, hosp_observacoes, grupo_hospedagem
      )
    `)
    .eq('evento_id', eventoId)
    .eq('status', 'solicitada')
    .order('prioridade', { ascending: false });

  if (errHosp) return NextResponse.json({ error: errHosp.message }, { status: 500 });

  // ── 4. Mapa de vagas baseado em confirmados ──────────────────
  const { data: confirmadosDb } = await supabase
    .from('evento_hospedagens')
    .select('alojamento_id, tipo_cama')
    .eq('evento_id', eventoId)
    .eq('status', 'confirmada');

  const vagasMap: Record<string, { total: number; inferiores: number; superiores: number }> = {};
  for (const aloj of alojamentosRaw ?? []) {
    const conf = (confirmadosDb ?? []).filter(c => c.alojamento_id === aloj.id);
    vagasMap[aloj.id] = {
      total:      aloj.total_vagas      - conf.length,
      inferiores: aloj.camas_inferiores - conf.filter(c => c.tipo_cama === 'inferior').length,
      superiores: aloj.camas_superiores - conf.filter(c => c.tipo_cama === 'superior').length,
    };
  }

  // ── 5. Numeração sequencial de leitos por alojamento ────────
  const { data: leitosExistentes } = await supabase
    .from('evento_hospedagem_leitos')
    .select('alojamento_id, numero')
    .eq('evento_id', eventoId);

  const leitoNumMap: Record<string, number> = {};
  for (const l of leitosExistentes ?? []) {
    const num = parseInt(l.numero) || 0;
    if ((leitoNumMap[l.alojamento_id] ?? 0) < num) {
      leitoNumMap[l.alojamento_id] = num;
    }
  }

  // ── 6. Array de alojamentos com vagas calculadas ─────────────
  const alojamentos: Alojamento[] = (alojamentosRaw ?? []).map(a => ({
    ...a,
    evento_id:         eventoId,
    vagas_livres:      vagasMap[a.id]?.total      ?? 0,
    inferiores_livres: vagasMap[a.id]?.inferiores ?? 0,
    superiores_livres: vagasMap[a.id]?.superiores ?? 0,
  })) as unknown as Alojamento[];

  let confirmados_count = 0;
  let lista_espera_count = 0;
  let leitos_atribuidos = 0;

  // ── 7. Loop de alocação com grupo_hospedagem e load balance ──
  for (const hosp of pendentes ?? []) {
    const insc = hosp.evento_inscricoes as unknown as (InscricaoParaHospedagem & { grupo_hospedagem?: string | null }) | null;
    if (!insc) continue;

    const prioridade = calcularPrioridadeHospedagem(insc);

    // Atualiza vagas_livres nos objetos a cada iteração
    for (const a of alojamentos) {
      a.vagas_livres      = vagasMap[a.id]?.total      ?? 0;
      a.inferiores_livres = vagasMap[a.id]?.inferiores ?? 0;
      a.superiores_livres = vagasMap[a.id]?.superiores ?? 0;
    }

    // Grupo preferido pela inscrição
    const grupoHosp = insc.grupo_hospedagem ?? (hosp.grupo_hospedagem as string | null) ?? null;

    // Filtra por grupo e ordena por menor taxa de ocupação (load balance)
    const candidatos = alojamentos
      .filter(a => grupoMatchesAlojamento(grupoHosp, a))
      .sort((a, b) => {
        const ratioA = a.total_vagas > 0 ? (a.total_vagas - (a.vagas_livres ?? 0)) / a.total_vagas : 1;
        const ratioB = b.total_vagas > 0 ? (b.total_vagas - (b.vagas_livres ?? 0)) / b.total_vagas : 1;
        return ratioA - ratioB;
      });

    const sugestao = sugerirAlojamento(insc, candidatos, prioridade);

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
      const alojId = sugestao.alojamento_id;

      leitoNumMap[alojId] = (leitoNumMap[alojId] ?? 0) + 1;
      const numeroCama = String(leitoNumMap[alojId]);
      const posicao: 'inferior' | 'superior' | 'unico' =
        sugestao.tipo_cama === 'inferior' ? 'inferior'
        : sugestao.tipo_cama === 'superior' ? 'superior'
        : 'unico';

      // Atualiza numero_cama na hospedagem
      await supabase
        .from('evento_hospedagens')
        .update({ numero_cama: numeroCama })
        .eq('id', hosp.id);

      // Cria/atualiza leito individual
      const { error: errLeito } = await supabase
        .from('evento_hospedagem_leitos')
        .upsert(
          [{
            evento_id:     eventoId,
            alojamento_id: alojId,
            inscricao_id:  hosp.inscricao_id,
            numero:        numeroCama,
            tipo_leito:    'beliche',
            posicao,
            ocupado:       true,
          }],
          { onConflict: 'inscricao_id' },
        );

      if (errLeito) {
        console.error('[alocar] leito upsert:', errLeito.message);
      } else {
        leitos_atribuidos++;
      }

      vagasMap[alojId].total--;
      if (sugestao.tipo_cama === 'inferior') vagasMap[alojId].inferiores--;
      if (sugestao.tipo_cama === 'superior') vagasMap[alojId].superiores--;
      confirmados_count++;
    } else {
      lista_espera_count++;
    }
  }

  console.log(
    `[autoalocacao] evento=${eventoId} processados=${(pendentes ?? []).length}` +
    ` confirmados=${confirmados_count} lista_espera=${lista_espera_count} leitos=${leitos_atribuidos}`,
  );

  return NextResponse.json({
    ok: true,
    processados:      (pendentes ?? []).length,
    confirmados:      confirmados_count,
    lista_espera:     lista_espera_count,
    leitos_atribuidos,
  });
}
