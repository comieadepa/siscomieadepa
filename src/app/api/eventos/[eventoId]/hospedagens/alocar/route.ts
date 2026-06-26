import { NextRequest, NextResponse } from 'next/server';
import { requireEventoPermission } from '@/lib/evento-guard';
import { materializarSetoresHospedagemAGO } from '@/lib/materializar-setores';
import { logDB } from '@/lib/audit';
import {
  calcularPrioridadeHospedagem,
  resolveGrupoHospedagemAGO,
  type InscricaoParaHospedagem,
} from '@/lib/hospedagem-helpers';
import {
  isElegivelAutoalocacao,
  resolveStatusOperacionalHospedagem,
} from '@/lib/hospedagem-operacional';
import { alocarLeitoParaInscricao } from '@/lib/hospedagem-alocacao-automatica';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;
  const guard = await requireEventoPermission(_req, eventoId, 'hospedagem');
  if (!guard.ok) return guard.response;
  const supabase = guard.ctx.supabaseAdmin;

  // 1. Busca o evento
  const { data: evento, error: errEv } = await supabase
    .from('eventos')
    .select('id, departamento, permite_hospedagem')
    .eq('id', eventoId)
    .single();

  if (errEv || !evento) {
    return NextResponse.json({ error: 'Evento nao encontrado' }, { status: 404 });
  }

  // 2. Busca se existem alojamentos cadastrados (todos)
  const { data: todosAlojamentos, error: errCount } = await supabase
    .from('evento_alojamentos')
    .select('id, nome, publico, sexo, total_vagas, camas_inferiores, camas_superiores, ativo')
    .eq('evento_id', eventoId);

  if (errCount) {
    return NextResponse.json({ error: errCount.message }, { status: 500 });
  }

  const totalAlojamentos = todosAlojamentos?.length ?? 0;

  // Cenário A — Não existem alojamentos cadastrados para eventos comuns
  if (evento.departamento !== 'AGO' && totalAlojamentos === 0) {
    await logDB({
      userId: guard.ctx.user?.id,
      userEmail: guard.ctx.user?.email ?? undefined,
      acao: 'EVENTO_SEM_ALOJAMENTOS_CONFIGURADOS',
      modulo: 'eventos',
      entidade: 'evento_hospedagens',
      entidadeId: eventoId,
      descricao: `[Hospedagem] EVENTO_SEM_ALOJAMENTOS_CONFIGURADOS. Não existem alojamentos cadastrados para o evento ${eventoId}. Mantendo status pago_sem_alocacao.`,
      request: _req,
    });

    const { data: pendentes } = await supabase
      .from('evento_hospedagens')
      .select('id, inscricao_id, evento_inscricoes(nome_inscrito, sexo)')
      .eq('evento_id', eventoId)
      .eq('status', 'pago_sem_alocacao');

    const detalheResultados = (pendentes ?? []).map(p => {
      const nome = (p.evento_inscricoes as any)?.nome_inscrito ?? 'Inscrito';
      return {
        inscricao_id: p.inscricao_id,
        nome_inscrito: nome,
        resultado: 'alojamentos_nao_configurados',
        motivo: 'Evento sem alojamentos cadastrados',
      };
    });

    return NextResponse.json({
      ok: true,
      processados: detalheResultados.length,
      confirmados: 0,
      lista_espera: 0,
      detalhes: detalheResultados,
      mensagem: 'EVENTO_SEM_ALOJAMENTOS_CONFIGURADOS',
    });
  }

  const lockTipo = 'hospedagem_autoalocacao';
  const lockOwnerToken = crypto.randomUUID();
  let lockAdquirido = false;

  await supabase
    .from('evento_autoalocacao_locks')
    .delete()
    .eq('evento_id', eventoId)
    .eq('operacao', lockTipo)
    .lt('expires_at', new Date().toISOString());

  const { error: errLock } = await supabase
    .from('evento_autoalocacao_locks')
    .insert({
      evento_id: eventoId,
      operacao: lockTipo,
      locked_by: lockOwnerToken,
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    });

  if (errLock) {
    if (errLock.code === '23505') {
      return NextResponse.json(
        { error: 'Autoalocacao ja esta em execucao para este evento. Aguarde finalizar.' },
        { status: 409 },
      );
    }
    if (errLock.code === '42P01') {
      return NextResponse.json(
        { error: 'Infra de lock da autoalocacao nao configurada. Aplique a migracao 20260606120000_create_evento_autoalocacao_locks.sql.' },
        { status: 500 },
      );
    }
    return NextResponse.json({ error: errLock.message }, { status: 500 });
  }

  lockAdquirido = true;

  const executarAutoalocacao = async () => {
    await logDB({
      userId: guard.ctx.user?.id,
      userEmail: guard.ctx.user?.email ?? undefined,
      acao: 'autoalocacao_iniciada',
      modulo: 'eventos',
      entidade: 'evento_hospedagens',
      entidadeId: eventoId,
      descricao: `[Hospedagem] Autoalocacao iniciada para evento ${eventoId}`,
      request: _req,
    });

    let alojamentosRaw = (todosAlojamentos ?? []).filter((a: any) => a.ativo);
    if (alojamentosRaw.length === 0 && evento.departamento === 'AGO') {
      await materializarSetoresHospedagemAGO(supabase, eventoId);
      const { data: recarregados } = await supabase
        .from('evento_alojamentos')
        .select('id,nome,publico,sexo,total_vagas,camas_inferiores,camas_superiores,ativo')
        .eq('evento_id', eventoId)
        .eq('ativo', true);
      alojamentosRaw = recarregados ?? [];
    }

    const { data: todasInscricoes } = await supabase
      .from('evento_inscricoes')
      .select(`
        id, nome_inscrito, sexo, data_nascimento, tipo_inscricao,
        status_pagamento,
        hosp_necessidade_especial, hosp_descricao_necessidade,
        hosp_cama_inferior, hosp_observacoes, grupo_hospedagem,
        hosp_possui_comorbidade, hosp_descricao_comorbidade
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
          semRegistro.map(i => {
            const isPago = ['pago', 'isento'].includes((i.status_pagamento || '').toLowerCase());
            const statusInicial = (evento.departamento !== 'AGO' && isPago) ? 'pago_sem_alocacao' : 'solicitada';
            return {
              evento_id:            eventoId,
              inscricao_id:         i.id,
              status:               statusInicial,
              prioridade:           calcularPrioridadeHospedagem(i as InscricaoParaHospedagem),
              necessidade_especial: Boolean(i.hosp_necessidade_especial),
              descricao_necessidade: i.hosp_descricao_necessidade ?? null,
              cama_inferior:        Boolean(i.hosp_cama_inferior),
              observacoes:          i.hosp_observacoes ?? null,
              grupo_hospedagem:     i.grupo_hospedagem ?? null,
              alocacao_automatica:  true,
            };
          }),
          { onConflict: 'inscricao_id' },
        );
      if (errUpsert) console.error('[alocar] upsert hospedagens:', errUpsert.message);
    }

    const { data: hospedagensRaw, error: errHosp } = await supabase
      .from('evento_hospedagens')
      .select(`
        id, prioridade, necessidade_especial, descricao_necessidade,
        cama_inferior, inscricao_id, grupo_hospedagem,
        status, alojamento_id, tipo_cama, numero_cama, observacoes,
        evento_inscricoes (
          id, nome_inscrito, sexo, data_nascimento, tipo_inscricao,
          status_pagamento,
          hosp_necessidade_especial, hosp_descricao_necessidade,
          hosp_cama_inferior, hosp_observacoes, grupo_hospedagem,
          hosp_possui_comorbidade, hosp_descricao_comorbidade
        )
      `)
      .eq('evento_id', eventoId);

    if (errHosp) return NextResponse.json({ error: errHosp.message }, { status: 500 });

    const pendentesPagamento: string[] = [];
    const atualizacoesPendencia: Array<PromiseLike<unknown>> = [];
    const atualizacoesGrupo: Array<PromiseLike<unknown>> = [];

    for (const hosp of hospedagensRaw ?? []) {
      const insc = hosp.evento_inscricoes as unknown as Record<string, unknown> | null;
      const statusPagamento = (insc?.status_pagamento as string | null) ?? null;
      const grupoAtual = (hosp.grupo_hospedagem as string | null) ?? (insc?.grupo_hospedagem as string | null) ?? null;
      if (!grupoAtual && insc) {
        const grupoCalculado = resolveGrupoHospedagemAGO({
          sexo: (insc.sexo as string | null) ?? null,
          data_nascimento: (insc.data_nascimento as string | null) ?? null,
          tipo_inscricao: (insc.tipo_inscricao as string | null) ?? null,
          hosp_necessidade_especial: Boolean(insc.hosp_necessidade_especial),
          hosp_possui_comorbidade: Boolean(insc.hosp_possui_comorbidade),
        });
        if (grupoCalculado) {
          atualizacoesGrupo.push(
            supabase
              .from('evento_inscricoes')
              .update({ grupo_hospedagem: grupoCalculado })
              .eq('id', hosp.inscricao_id as string)
              .eq('evento_id', eventoId),
          );
          atualizacoesGrupo.push(
            supabase
              .from('evento_hospedagens')
              .update({ grupo_hospedagem: grupoCalculado })
              .eq('id', hosp.id)
              .eq('evento_id', eventoId),
          );
          hosp.grupo_hospedagem = grupoCalculado;
          if (insc) insc.grupo_hospedagem = grupoCalculado;
        }
      }

      const oper = resolveStatusOperacionalHospedagem({
        status: hosp.status as string | null,
        status_pagamento: statusPagamento,
        alojamento_id: hosp.alojamento_id as string | null,
        tipo_cama: hosp.tipo_cama as string | null,
        numero_cama: hosp.numero_cama as string | null,
        hospedagem: true,
      });

      if (oper === 'aguardando_pagamento') {
        pendentesPagamento.push(hosp.inscricao_id as string);
        if (hosp.alojamento_id || hosp.numero_cama || hosp.tipo_cama) {
          atualizacoesPendencia.push(
            supabase
              .from('evento_hospedagens')
              .update({
                alojamento_id: null,
                tipo_cama: null,
                numero_cama: null,
                observacoes: `${String(hosp.observacoes ?? '').trim()} [AUTO] desalocado por pagamento pendente`.trim(),
              })
              .eq('id', hosp.id)
              .eq('evento_id', eventoId),
          );
          atualizacoesPendencia.push(
            supabase
              .from('evento_hospedagem_leitos')
              .delete()
              .eq('evento_id', eventoId)
              .eq('inscricao_id', hosp.inscricao_id as string),
          );
        }
      }
    }

    if (atualizacoesPendencia.length > 0) {
      await Promise.allSettled(atualizacoesPendencia);
    }

    if (atualizacoesGrupo.length > 0) {
      await Promise.allSettled(atualizacoesGrupo);
    }

    if (pendentesPagamento.length > 0) {
      await logDB({
        userId: guard.ctx.user?.id,
        userEmail: guard.ctx.user?.email ?? undefined,
        acao: 'hospedagem_nao_alocada_pagamento_pendente',
        modulo: 'eventos',
        entidade: 'evento_hospedagens',
        entidadeId: eventoId,
        descricao: `[Hospedagem] Inscricoes bloqueadas por pagamento pendente: ${pendentesPagamento.length}`,
        detalhes: { quantidade: pendentesPagamento.length },
        request: _req,
      });
    }



    const elegiveis = (hospedagensRaw ?? [])
      .filter(h => {
        const insc = h.evento_inscricoes as unknown as Record<string, unknown> | null;
        if (evento.departamento !== 'AGO') {
          const statusPag = (insc?.status_pagamento as string | null) ?? '';
          const isPago = ['pago', 'isento'].includes(statusPag.toLowerCase());
          const jaAlocado = !!h.alojamento_id;
          const statusValido = ['solicitada', 'pago_sem_alocacao', 'lista_espera'].includes(String(h.status || '').toLowerCase());
          return isPago && !jaAlocado && statusValido;
        }
        return isElegivelAutoalocacao({
          hospedagem: true,
          status: h.status as string | null,
          status_pagamento: (insc?.status_pagamento as string | null) ?? null,
          alojamento_id: h.alojamento_id as string | null,
          tipo_cama: h.tipo_cama as string | null,
          numero_cama: h.numero_cama as string | null,
        });
      })
      .sort((a, b) => {
        const pa = Number(a.prioridade ?? 0);
        const pb = Number(b.prioridade ?? 0);
        return pb - pa;
      });

    let alocadas_count = 0;
    let lista_espera_count = 0;
    let leitos_atribuidos = 0;

    const detalheResultados: Array<{
      inscricao_id: string;
      nome_inscrito: string;
      resultado: string;
      motivo: string;
    }> = [];

    // Processar no máximo 50 candidatos por requisição para evitar timeout (504) na Vercel
    const BATCH_LIMIT = 50;
    const batchToProcess = elegiveis.slice(0, BATCH_LIMIT);

    for (const hosp of batchToProcess) {
      const insc = hosp.evento_inscricoes as any;
      const nomeInscrito = insc?.nome_inscrito ?? 'Inscrito';
      
      const resAloc = await alocarLeitoParaInscricao(supabase, hosp.inscricao_id);
      
      if (resAloc.success || resAloc.status === 'alocada') {
        alocadas_count++;
        leitos_atribuidos++;
      } else if (resAloc.status === 'lista_espera') {
        lista_espera_count++;
      }

      detalheResultados.push({
        inscricao_id: hosp.inscricao_id,
        nome_inscrito: nomeInscrito,
        resultado: resAloc.status,
        motivo: resAloc.motivo,
      });
    }

    await logDB({
      userId: guard.ctx.user?.id,
      userEmail: guard.ctx.user?.email ?? undefined,
      acao: 'autoalocacao_concluida',
      modulo: 'eventos',
      entidade: 'evento_hospedagens',
      entidadeId: eventoId,
      descricao: `[Hospedagem] Lote de autoalocacao concluido. Processados neste lote: ${batchToProcess.length}. Restantes: ${elegiveis.length - batchToProcess.length}`,
      detalhes: {
        elegiveis: elegiveis.length,
        processados_lote: batchToProcess.length,
        alocadas: alocadas_count,
        lista_espera: lista_espera_count,
        leitos_atribuidos,
      },
      request: _req,
    });

    return NextResponse.json({
      ok: true,
      processados:      batchToProcess.length,
      confirmados:      alocadas_count,
      lista_espera:     lista_espera_count,
      leitos_atribuidos,
      aguardando_pagamento: pendentesPagamento.length,
      prioridade_sem_leito_inferior: 0,
      detalhes:         detalheResultados,
      total_pendentes:  elegiveis.length - batchToProcess.length,
    });
  };

  try {
    return await executarAutoalocacao();
  } finally {
    if (lockAdquirido) {
      await supabase
        .from('evento_autoalocacao_locks')
        .delete()
        .eq('evento_id', eventoId)
        .eq('operacao', lockTipo)
        .eq('locked_by', lockOwnerToken);
    }
  }
}
