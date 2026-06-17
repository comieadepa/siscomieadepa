import { NextRequest, NextResponse } from 'next/server';
import { requireEventoPermission } from '@/lib/evento-guard';
import { materializarSetoresHospedagemAGO } from '@/lib/materializar-setores';
import { logDB } from '@/lib/audit';
import {
  calcularPrioridadeHospedagem,
  resolveGrupoHospedagemAGO,
  sugerirAlojamento,
  grupoMatchesAlojamento,
  type Alojamento,
  type InscricaoParaHospedagem,
} from '@/lib/hospedagem-helpers';
import {
  formatarNumeroLeitoSequencial,
  isElegivelAutoalocacao,
  resolveStatusOperacionalHospedagem,
} from '@/lib/hospedagem-operacional';

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

    return NextResponse.json({
      ok: true,
      processados: 0,
      confirmados: 0,
      lista_espera: 0,
      leitos_atribuidos: 0,
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

    const { data: ocupantesDb } = await supabase
      .from('evento_hospedagens')
      .select('alojamento_id, tipo_cama')
      .eq('evento_id', eventoId)
      .in('status', ['alocada', 'confirmada', 'checkin_realizado'])
      .not('alojamento_id', 'is', null);

    const vagasMap: Record<string, { total: number; inferiores: number; superiores: number }> = {};
    for (const aloj of alojamentosRaw ?? []) {
      const conf = (ocupantesDb ?? []).filter(c => c.alojamento_id === aloj.id);
      vagasMap[aloj.id] = {
        total:      aloj.total_vagas      - conf.length,
        inferiores: aloj.camas_inferiores - conf.filter(c => c.tipo_cama === 'inferior').length,
        superiores: aloj.camas_superiores - conf.filter(c => c.tipo_cama === 'superior').length,
      };
    }

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

    const alojamentos: Alojamento[] = (alojamentosRaw ?? []).map(a => ({
      ...a,
      evento_id:         eventoId,
      vagas_livres:      vagasMap[a.id]?.total      ?? 0,
      inferiores_livres: vagasMap[a.id]?.inferiores ?? 0,
      superiores_livres: vagasMap[a.id]?.superiores ?? 0,
    })) as unknown as Alojamento[];

    const elegiveis = (hospedagensRaw ?? [])
      .filter(h => {
        const insc = h.evento_inscricoes as unknown as Record<string, unknown> | null;
        if (evento.departamento !== 'AGO') {
          // Processar apenas registros com status pago_sem_alocacao
          return h.status === 'pago_sem_alocacao';
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

    const chunkArray = <T,>(items: T[], chunkSize: number): T[][] => {
      if (items.length === 0) return [];
      const size = Math.max(1, chunkSize);
      const chunks: T[][] = [];
      for (let i = 0; i < items.length; i += size) {
        chunks.push(items.slice(i, i + size));
      }
      return chunks;
    };

    let alocadas_count = 0;
    let lista_espera_count = 0;
    let leitos_atribuidos = 0;
    let prioridadeSemInferior = 0;
    let semVaga = 0;

    type HospedagemUpdateRow = {
      id: string;
      status: string;
      alojamento_id: string | null;
      tipo_cama: string | null;
      numero_cama: string | null;
      prioridade?: number;
      observacoes?: string | null;
      alocacao_automatica: boolean;
    };

    const hospedagensParaAtualizar: HospedagemUpdateRow[] = [];
    const leitosParaInserir: Array<{
      evento_id: string;
      alojamento_id: string;
      inscricao_id: string;
      numero: string;
      tipo_leito: 'beliche';
      posicao: 'inferior' | 'superior' | 'unico';
      ocupado: boolean;
    }> = [];
    const leitosParaLiberar: string[] = [];

    for (const hosp of elegiveis) {
      const insc = hosp.evento_inscricoes as unknown as (InscricaoParaHospedagem & { grupo_hospedagem?: string | null }) | null;
      if (!insc) continue;

      const prioridade = calcularPrioridadeHospedagem(insc);

      for (const a of alojamentos) {
        a.vagas_livres      = vagasMap[a.id]?.total      ?? 0;
        a.inferiores_livres = vagasMap[a.id]?.inferiores ?? 0;
        a.superiores_livres = vagasMap[a.id]?.superiores ?? 0;
      }

      const grupoHosp = insc.grupo_hospedagem ?? (hosp.grupo_hospedagem as string | null) ?? null;
      const candidatos = alojamentos
        .filter(a => grupoMatchesAlojamento(grupoHosp, a))
        .sort((a, b) => {
          const ratioA = a.total_vagas > 0 ? (a.total_vagas - (a.vagas_livres ?? 0)) / a.total_vagas : 1;
          const ratioB = b.total_vagas > 0 ? (b.total_vagas - (b.vagas_livres ?? 0)) / b.total_vagas : 1;
          return ratioA - ratioB;
        });

      const sugestao = sugerirAlojamento(insc, candidatos, prioridade);

      if (!sugestao.alojamento_id || sugestao.status === 'lista_espera') {
        hospedagensParaAtualizar.push({
          id: hosp.id as string,
          status: 'lista_espera',
          alojamento_id: null,
          tipo_cama: null,
          numero_cama: null,
          alocacao_automatica: true,
        });
        leitosParaLiberar.push(hosp.inscricao_id as string);
        semVaga++;
        lista_espera_count++;
        continue;
      }

      const alojId = sugestao.alojamento_id;
      leitoNumMap[alojId] = (leitoNumMap[alojId] ?? 0) + 1;
      const numeroCama = formatarNumeroLeitoSequencial(leitoNumMap[alojId]);
      const posicao: 'inferior' | 'superior' | 'unico' =
        sugestao.tipo_cama === 'inferior' ? 'inferior'
        : sugestao.tipo_cama === 'superior' ? 'superior'
        : 'unico';

      const alertaInferior = !!sugestao.prioridadeInferiorNaoAtendida;
      if (alertaInferior) prioridadeSemInferior++;

      const observacaoAtual = String(hosp.observacoes ?? '').trim();
      const alertaTxt = alertaInferior ? 'PRIORIDADE SEM LEITO INFERIOR DISPONIVEL' : '';
      const observacaoNova = [observacaoAtual, alertaTxt].filter(Boolean).join(' | ') || null;

      hospedagensParaAtualizar.push({
        id: hosp.id as string,
        alojamento_id: alojId,
        tipo_cama: sugestao.tipo_cama,
        numero_cama: numeroCama,
        status: 'alocada',
        prioridade: sugestao.prioridade,
        observacoes: observacaoNova,
        alocacao_automatica: true,
      });

      leitosParaInserir.push({
        evento_id: eventoId,
        alojamento_id: alojId,
        inscricao_id: hosp.inscricao_id as string,
        numero: numeroCama,
        tipo_leito: 'beliche',
        posicao,
        ocupado: true,
      });
      leitos_atribuidos++;

      vagasMap[alojId].total--;
      if (sugestao.tipo_cama === 'inferior') vagasMap[alojId].inferiores--;
      if (sugestao.tipo_cama === 'superior') vagasMap[alojId].superiores--;
      alocadas_count++;
    }

    // Persiste decisões
    for (const batch of chunkArray(hospedagensParaAtualizar, 40)) {
      const resultados = await Promise.allSettled(
        batch.map(row =>
          supabase
            .from('evento_hospedagens')
            .update({
              status: row.status,
              alojamento_id: row.alojamento_id,
              tipo_cama: row.tipo_cama,
              numero_cama: row.numero_cama,
              prioridade: row.prioridade,
              observacoes: row.observacoes,
              alocacao_automatica: row.alocacao_automatica,
            })
            .eq('id', row.id)
            .eq('evento_id', eventoId),
        ),
      );

      const houveErro = resultados.some(r => {
        if (r.status === 'rejected') return true;
        const erro = (r.value as { error?: { message?: string } | null }).error;
        return !!erro;
      });

      if (houveErro) {
        return NextResponse.json({ error: 'Falha ao persistir atualizacoes de hospedagem.' }, { status: 500 });
      }
    }

    if (leitosParaLiberar.length > 0) {
      for (const batch of chunkArray(leitosParaLiberar, 500)) {
        const { error: errDelete } = await supabase
          .from('evento_hospedagem_leitos')
          .delete()
          .eq('evento_id', eventoId)
          .in('inscricao_id', batch);
        if (errDelete) {
          return NextResponse.json({ error: errDelete.message }, { status: 500 });
        }
      }
    }

    const inscricoesComLeitoNovo = Array.from(new Set(leitosParaInserir.map(l => l.inscricao_id)));
    if (inscricoesComLeitoNovo.length > 0) {
      for (const batch of chunkArray(inscricoesComLeitoNovo, 500)) {
        const { error: errDeletePrevio } = await supabase
          .from('evento_hospedagem_leitos')
          .delete()
          .eq('evento_id', eventoId)
          .in('inscricao_id', batch);
        if (errDeletePrevio) {
          return NextResponse.json({ error: errDeletePrevio.message }, { status: 500 });
        }
      }
    }

    for (const batch of chunkArray(leitosParaInserir, 300)) {
      const { error: errLeitos } = await supabase
        .from('evento_hospedagem_leitos')
        .insert(batch);
      if (errLeitos) {
        if (errLeitos.code === '23505') {
          return NextResponse.json(
            { error: 'Conflito de leito detectado durante a autoalocacao. Tente novamente.' },
            { status: 409 },
          );
        }
        return NextResponse.json({ error: errLeitos.message }, { status: 500 });
      }
    }

    await logDB({
      userId: guard.ctx.user?.id,
      userEmail: guard.ctx.user?.email ?? undefined,
      acao: 'hospedagem_alocada',
      modulo: 'eventos',
      entidade: 'evento_hospedagens',
      entidadeId: eventoId,
      descricao: `[Hospedagem] Alocacoes automaticas realizadas: ${alocadas_count}`,
      detalhes: { quantidade: alocadas_count },
      request: _req,
    });

    await logDB({
      userId: guard.ctx.user?.id,
      userEmail: guard.ctx.user?.email ?? undefined,
      acao: 'autoalocacao_concluida',
      modulo: 'eventos',
      entidade: 'evento_hospedagens',
      entidadeId: eventoId,
      descricao: `[Hospedagem] Autoalocacao concluida no evento ${eventoId}`,
      detalhes: {
        elegiveis: elegiveis.length,
        alocadas: alocadas_count,
        lista_espera: lista_espera_count,
        leitos_atribuidos,
        aguardando_pagamento: pendentesPagamento.length,
        prioridade_sem_leito_inferior: prioridadeSemInferior,
      },
      request: _req,
    });

    return NextResponse.json({
      ok: true,
      processados:      elegiveis.length,
      confirmados:      alocadas_count,
      lista_espera:     lista_espera_count,
      leitos_atribuidos,
      aguardando_pagamento: pendentesPagamento.length,
      prioridade_sem_leito_inferior: prioridadeSemInferior,
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
