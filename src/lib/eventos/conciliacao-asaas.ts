import { SupabaseClient } from '@supabase/supabase-js';
import { asaasFetch, AsaasApiError } from '@/lib/asaas';
import { logDB, mascaraCpf } from '@/lib/audit';
import { alocarLeitoParaInscricao } from '@/lib/hospedagem-alocacao-automatica';
import { enqueueWebhookJobs } from '@/lib/jobs/webhook-jobs';

export interface ItemConciliacaoPreview {
  id: string; // ID local da entidade (inscrição, lote ou ordem)
  tipo_entidade: 'inscricao' | 'lote' | 'complemento';
  participante_nome: string;
  participante_cpf: string | null;
  asaas_payment_id: string;
  valor_sistema: number;
  valor_asaas: number;
  status_sistema: string;
  status_asaas: string;
  pago_no_asaas: boolean;
  elegivel: boolean;
  motivo_bloqueio?: string;
  data_pagamento_asaas?: string | null;
  forma_pagamento_asaas?: string | null;
}

export interface ResultadoConciliacaoPreview {
  evento_id: string;
  total_consultadas_sistema: number;
  total_pagamentos_asaas: number;
  total_elegiveis: number;
  total_ambiguos_ou_bloqueados: number;
  total_erros: number;
  itens: ItemConciliacaoPreview[];
  erros: Array<{ asaas_payment_id: string; mensagem: string }>;
}

export interface ResultadoRegularizacaoItem {
  id: string;
  tipo_entidade: 'inscricao' | 'lote' | 'complemento';
  asaas_payment_id: string;
  sucesso: boolean;
  erro?: string;
}

export interface ResultadoRegularizacaoLote {
  evento_id: string;
  total_processados: number;
  total_sucessos: number;
  total_falhas: number;
  detalhes: ResultadoRegularizacaoItem[];
}

/** Status oficiais do Asaas que representam pagamento confirmado / quitado */
export const ASAAS_STATUS_PAGOS = new Set([
  'RECEIVED',
  'CONFIRMED',
  'RECEIVED_IN_CASH',
]);

/** Status do Asaas que representam estorno / cancelamento / chargeback */
export const ASAAS_STATUS_CANCELADOS_OU_ESTORNADOS = new Set([
  'REFUNDED',
  'REFUND_REQUESTED',
  'REFUND_IN_PROGRESS',
  'CHARGEBACK_REQUESTED',
  'CHARGEBACK_DISPUTE',
  'AWAITING_CHARGEBACK_REVERSAL',
  'DUNNING_REQUESTED',
  'CANCELED',
]);

/**
 * Consulta cobrança no Asaas com tratamento de erro
 */
export async function consultarCobrancaAsaas(paymentId: string): Promise<Record<string, any>> {
  return asaasFetch(`/payments/${paymentId}`, { method: 'GET' });
}

/**
 * Consulta prévia de conciliação para um evento.
 * NÃO altera nenhum registro no banco de dados.
 */
export async function previewConciliacaoEvento(
  supabase: SupabaseClient,
  eventoId: string
): Promise<ResultadoConciliacaoPreview> {
  const itens: ItemConciliacaoPreview[] = [];
  const erros: Array<{ asaas_payment_id: string; mensagem: string }> = [];

  // 1. Inscrições individuais com asaas_payment_id
  const { data: inscricoes, error: insErr } = await supabase
    .from('evento_inscricoes')
    .select('id, nome_inscrito, cpf, asaas_payment_id, valor_final, valor_pago, status_pagamento, lote_id')
    .eq('evento_id', eventoId)
    .not('asaas_payment_id', 'is', null);

  if (insErr) {
    throw new Error(`Erro ao buscar inscrições para conciliação: ${insErr.message}`);
  }

  // 2. Lotes de inscrição com asaas_payment_id
  const { data: lotes, error: lotesErr } = await supabase
    .from('evento_lotes_inscricao')
    .select('id, codigo, responsavel_nome, asaas_payment_id, valor_total, status_pagamento')
    .eq('evento_id', eventoId)
    .not('asaas_payment_id', 'is', null);

  if (lotesErr) {
    throw new Error(`Erro ao buscar lotes para conciliação: ${lotesErr.message}`);
  }

  // 3. Ordens de pagamento (complementos) vinculadas ao evento
  const { data: ordens, error: ordErr } = await supabase
    .from('evento_ordens_pagamento')
    .select('id, inscricao_id, asaas_payment_id, valor, status, tipo_ordem')
    .eq('evento_id', eventoId)
    .not('asaas_payment_id', 'is', null);

  if (ordErr) {
    throw new Error(`Erro ao buscar ordens de pagamento para conciliação: ${ordErr.message}`);
  }

  // Monta mapa de inscrições para lookup rápido de ordens
  const inscricoesMap = new Map((inscricoes || []).map(i => [i.id, i]));

  // Coleta lista única de entidades pendentes para checagem no Asaas
  type EntidadeAlvo = {
    id: string;
    tipo: 'inscricao' | 'lote' | 'complemento';
    nome: string;
    cpf: string | null;
    asaasId: string;
    valorSistema: number;
    statusSistema: string;
    inscricaoOriginal?: any;
  };

  const entidadesAlvo: EntidadeAlvo[] = [];

  // Inscrições individuais (que não sejam de lote, já que o lote é a unidade financeira)
  for (const ins of inscricoes || []) {
    if (!ins.asaas_payment_id) continue;
    // Se a inscrição já está paga no sistema, não precisa verificar no Asaas
    if (ins.status_pagamento === 'pago' || ins.status_pagamento === 'isento') continue;

    entidadesAlvo.push({
      id: ins.id,
      tipo: 'inscricao',
      nome: ins.nome_inscrito || 'Inscrito',
      cpf: ins.cpf,
      asaasId: ins.asaas_payment_id,
      valorSistema: Number(ins.valor_final ?? ins.valor_pago ?? 0),
      statusSistema: ins.status_pagamento,
      inscricaoOriginal: ins,
    });
  }

  // Lotes
  for (const lote of lotes || []) {
    if (!lote.asaas_payment_id) continue;
    if (lote.status_pagamento === 'pago') continue;

    entidadesAlvo.push({
      id: lote.id,
      tipo: 'lote',
      nome: `Lote ${lote.codigo || ''} - ${lote.responsavel_nome || 'Grupo'}`,
      cpf: null,
      asaasId: lote.asaas_payment_id,
      valorSistema: Number(lote.valor_total ?? 0),
      statusSistema: lote.status_pagamento,
    });
  }

  // Ordens complementares
  for (const ord of ordens || []) {
    if (!ord.asaas_payment_id) continue;
    if (ord.status === 'pago') continue;

    const insDona = ord.inscricao_id ? inscricoesMap.get(ord.inscricao_id) : null;
    entidadesAlvo.push({
      id: ord.id,
      tipo: 'complemento',
      nome: insDona ? `${insDona.nome_inscrito} (Complemento)` : `Ordem Complementar ${ord.id.slice(0, 8)}`,
      cpf: insDona?.cpf ?? null,
      asaasId: ord.asaas_payment_id,
      valorSistema: Number(ord.valor ?? 0),
      statusSistema: ord.status,
      inscricaoOriginal: insDona,
    });
  }

  // Limite e paginação defensiva: processa em lotes de até 5 requisições concorrentes
  const CONCURRENCY_LIMIT = 5;
  let authErrorDetected: string | null = null;

  for (let i = 0; i < entidadesAlvo.length; i += CONCURRENCY_LIMIT) {
    // Se já detectamos falha geral de autenticação/chave no Asaas, interrompe para não sobrecarregar
    if (authErrorDetected) break;

    const chunk = entidadesAlvo.slice(i, i + CONCURRENCY_LIMIT);
    await Promise.all(
      chunk.map(async alvo => {
        try {
          const cobranca = await consultarCobrancaAsaas(alvo.asaasId);
          const asaasStatus = String(cobranca?.status || '').toUpperCase();
          const valorAsaas = Number(cobranca?.value ?? 0);
          const isPago = ASAAS_STATUS_PAGOS.has(asaasStatus);
          const isCanceladoEstornado = ASAAS_STATUS_CANCELADOS_OU_ESTORNADOS.has(asaasStatus);

          let elegivel = false;
          let motivoBloqueio: string | undefined;

          if (isPago) {
            // Validação de correspondência de valor com tolerância razoável (por causa de taxas/descontos cupom)
            if (valorAsaas <= 0) {
              elegivel = false;
              motivoBloqueio = 'Valor no Asaas é zero ou inválido.';
            } else if (Math.abs(valorAsaas - alvo.valorSistema) > 5.0 && alvo.valorSistema > 0) {
              // Diferença substancial de valor entre sistema e cobrança
              elegivel = false;
              motivoBloqueio = `Divergência de valor incompatível (Sistema: R$ ${alvo.valorSistema.toFixed(2)}, Asaas: R$ ${valorAsaas.toFixed(2)}). Requer análise manual.`;
            } else {
              elegivel = true;
            }
          } else if (isCanceladoEstornado) {
            elegivel = false;
            motivoBloqueio = `Cobrança com situação conflitante no Asaas (${asaasStatus}). Requer análise manual.`;
          } else {
            elegivel = false;
            motivoBloqueio = `Cobrança ainda não confirmada no Asaas (Status atual: ${asaasStatus}).`;
          }

          itens.push({
            id: alvo.id,
            tipo_entidade: alvo.tipo,
            participante_nome: alvo.nome,
            participante_cpf: alvo.cpf,
            asaas_payment_id: alvo.asaasId,
            valor_sistema: alvo.valorSistema,
            valor_asaas: valorAsaas,
            status_sistema: alvo.statusSistema,
            status_asaas: asaasStatus,
            pago_no_asaas: isPago,
            elegivel,
            motivo_bloqueio: motivoBloqueio,
            data_pagamento_asaas: cobranca?.paymentDate || cobranca?.confirmedDate || null,
            forma_pagamento_asaas: cobranca?.billingType || null,
          });
        } catch (err: any) {
          console.error(`[CONCILIACAO ASAAS] Erro ao consultar ${alvo.asaasId}:`, err.message);
          if (err instanceof AsaasApiError && (err.status === 401 || err.status === 403)) {
            authErrorDetected = `Falha de autenticação no Asaas (HTTP ${err.status}): ${err.detail || 'Chave de API inválida ou não autorizada.'}`;
          }
          erros.push({
            asaas_payment_id: alvo.asaasId,
            mensagem: err instanceof AsaasApiError ? `Asaas HTTP ${err.status}: ${err.detail}` : err.message,
          });
        }
      })
    );
  }

  // Se houve erro de autenticação (HTTP 401/403), propaga erro explícito para não apresentar dados falsos
  if (authErrorDetected) {
    throw new Error(authErrorDetected);
  }

  const totalElegiveis = itens.filter(it => it.elegivel).length;
  const totalBloqueados = itens.filter(it => !it.elegivel).length;

  return {
    evento_id: eventoId,
    total_consultadas_sistema: entidadesAlvo.length,
    total_pagamentos_asaas: itens.filter(it => it.pago_no_asaas).length,
    total_elegiveis: totalElegiveis,
    total_ambiguos_ou_bloqueados: totalBloqueados,
    total_erros: erros.length,
    itens,
    erros,
  };
}

/**
 * Regulariza em lote os pagamentos comprovadamente confirmados no Asaas.
 * Reutiliza exatamente o pipeline de atualização e efeitos colaterais oficiais
 * (autoalocação de hospedagem, enfileiramento de jobs de e-mail/notificação e log de auditoria).
 */
export async function regularizarPagamentosConfirmados(
  supabase: SupabaseClient,
  eventoId: string,
  usuarioOperador: { id: string; email?: string }
): Promise<ResultadoRegularizacaoLote> {
  // 1. Gera o preview fresco para garantir que nada mudou
  const preview = await previewConciliacaoEvento(supabase, eventoId);
  const elegiveis = preview.itens.filter(it => it.elegivel);

  const detalhes: ResultadoRegularizacaoItem[] = [];
  let totalSucessos = 0;
  let totalFalhas = 0;

  for (const item of elegiveis) {
    try {
      if (item.tipo_entidade === 'inscricao') {
        // Idempotência
        const { data: insAtual, error: insErr } = await supabase
          .from('evento_inscricoes')
          .select('id, status_pagamento, valor_final, valor_pago')
          .eq('id', item.id)
          .single();

        if (insErr || !insAtual) {
          throw new Error('Inscrição não encontrada no momento da baixa.');
        }

        if (insAtual.status_pagamento === 'pago') {
          // Já pago por concorrência — idempotência garantida
          detalhes.push({
            id: item.id,
            tipo_entidade: item.tipo_entidade,
            asaas_payment_id: item.asaas_payment_id,
            sucesso: true,
          });
          totalSucessos++;
          continue;
        }

        const updateData: Record<string, unknown> = {
          status_pagamento: 'pago',
          valor_pago: item.valor_asaas > 0 ? item.valor_asaas : insAtual.valor_final,
        };

        const { error: updErr } = await supabase
          .from('evento_inscricoes')
          .update(updateData)
          .eq('id', item.id);

        if (updErr) {
          throw updErr;
        }

        // Autoalocação imediata de leito
        try {
          await alocarLeitoParaInscricao(supabase, item.id);
        } catch (alocErr: any) {
          console.error(`[CONCILIACAO] Falha autoalocacao leito ${item.id}:`, alocErr.message);
        }

        // Jobs de confirmação assíncronos (e-mail, histórico)
        try {
          await enqueueWebhookJobs(supabase, [
            { job_type: 'ALLOCATE_ACCOMMODATION', entity_type: 'inscricao', entity_id: item.id, external_event_id: eventoId, external_payment_id: item.asaas_payment_id },
            { job_type: 'SEND_CONFIRMATION_EMAIL', entity_type: 'inscricao', entity_id: item.id, external_event_id: eventoId, external_payment_id: item.asaas_payment_id },
            { job_type: 'REGISTER_MINISTERIAL_HISTORY', entity_type: 'inscricao', entity_id: item.id, external_event_id: eventoId, external_payment_id: item.asaas_payment_id },
          ]);
        } catch (jobErr: any) {
          console.error(`[CONCILIACAO] Falha enqueue jobs ${item.id}:`, jobErr.message);
        }

        // Log de auditoria individual
        await logDB({
          userId: usuarioOperador.id,
          userEmail: usuarioOperador.email,
          acao: 'baixa_financeira',
          modulo: 'eventos',
          entidade: 'evento_inscricoes',
          entidadeId: item.id,
          descricao: `Conciliação Asaas: Inscrição baixada como PAGO após confirmação Asaas (${item.asaas_payment_id})`,
          status: 'sucesso',
          detalhes: {
            evento_id: eventoId,
            origem: 'conciliacao_asaas',
            asaas_payment_id: item.asaas_payment_id,
            valor_pago: updateData.valor_pago,
            cpf_mascarado: mascaraCpf(item.participante_cpf),
          },
        });

        detalhes.push({
          id: item.id,
          tipo_entidade: item.tipo_entidade,
          asaas_payment_id: item.asaas_payment_id,
          sucesso: true,
        });
        totalSucessos++;

      } else if (item.tipo_entidade === 'lote') {
        // Lote de inscrições
        const { data: loteAtual, error: loteErr } = await supabase
          .from('evento_lotes_inscricao')
          .select('id, status_pagamento')
          .eq('id', item.id)
          .single();

        if (loteErr || !loteAtual) {
          throw new Error('Lote não encontrado no momento da baixa.');
        }

        if (loteAtual.status_pagamento === 'pago') {
          detalhes.push({
            id: item.id,
            tipo_entidade: item.tipo_entidade,
            asaas_payment_id: item.asaas_payment_id,
            sucesso: true,
          });
          totalSucessos++;
          continue;
        }

        // Atualiza lote (o trigger fn_sync_lote_pagamento atualiza as inscrições filhas)
        const { error: updLoteErr } = await supabase
          .from('evento_lotes_inscricao')
          .update({ status_pagamento: 'pago' })
          .eq('id', item.id);

        if (updLoteErr) {
          throw updLoteErr;
        }

        // Autoalocação e jobs para membros do lote
        const { data: loteInscs } = await supabase
          .from('evento_inscricoes')
          .select('id')
          .eq('lote_id', item.id);

        for (const li of loteInscs || []) {
          try {
            await alocarLeitoParaInscricao(supabase, li.id);
          } catch (e: any) {
            console.error(`[CONCILIACAO] Falha autoalocacao lote ins ${li.id}:`, e.message);
          }
        }

        if (loteInscs && loteInscs.length > 0) {
          const jobs = loteInscs.map(li => ({
            job_type: 'SEND_CONFIRMATION_EMAIL' as const,
            entity_type: 'inscricao' as const,
            entity_id: li.id,
            external_event_id: eventoId,
            external_payment_id: item.asaas_payment_id,
          }));
          try {
            await enqueueWebhookJobs(supabase, jobs);
          } catch (e: any) {
            console.error('[CONCILIACAO] Falha enqueue jobs lote:', e.message);
          }
        }

        await logDB({
          userId: usuarioOperador.id,
          userEmail: usuarioOperador.email,
          acao: 'baixa_financeira',
          modulo: 'eventos',
          entidade: 'evento_lotes_inscricao',
          entidadeId: item.id,
          descricao: `Conciliação Asaas: Lote baixado como PAGO após confirmação Asaas (${item.asaas_payment_id})`,
          status: 'sucesso',
          detalhes: {
            evento_id: eventoId,
            origem: 'conciliacao_asaas',
            asaas_payment_id: item.asaas_payment_id,
            valor: item.valor_asaas,
          },
        });

        detalhes.push({
          id: item.id,
          tipo_entidade: item.tipo_entidade,
          asaas_payment_id: item.asaas_payment_id,
          sucesso: true,
        });
        totalSucessos++;

      } else if (item.tipo_entidade === 'complemento') {
        // Ordem complementar
        const { data: ordemAtual, error: ordErr } = await supabase
          .from('evento_ordens_pagamento')
          .select('id, inscricao_id, status, valor')
          .eq('id', item.id)
          .single();

        if (ordErr || !ordemAtual) {
          throw new Error('Ordem complementar não encontrada.');
        }

        if (ordemAtual.status === 'pago') {
          detalhes.push({
            id: item.id,
            tipo_entidade: item.tipo_entidade,
            asaas_payment_id: item.asaas_payment_id,
            sucesso: true,
          });
          totalSucessos++;
          continue;
        }

        // Atualiza ordem
        await supabase
          .from('evento_ordens_pagamento')
          .update({ status: 'pago', paid_at: new Date().toISOString() })
          .eq('id', item.id);

        // Se a inscrição associada estava pendente pelo complemento, atualiza status e valor_pago
        if (ordemAtual.inscricao_id) {
          const { data: insDona } = await supabase
            .from('evento_inscricoes')
            .select('id, valor_pago, status_pagamento')
            .eq('id', ordemAtual.inscricao_id)
            .single();

          if (insDona) {
            const novoValorPago = Number(insDona.valor_pago || 0) + Number(ordemAtual.valor || 0);
            await supabase
              .from('evento_inscricoes')
              .update({
                status_pagamento: 'pago',
                valor_pago: novoValorPago,
              })
              .eq('id', insDona.id);

            try {
              await alocarLeitoParaInscricao(supabase, insDona.id);
            } catch (alocErr: any) {
              console.error(`[CONCILIACAO] Falha autoalocacao complemento ${insDona.id}:`, alocErr.message);
            }
          }
        }

        await logDB({
          userId: usuarioOperador.id,
          userEmail: usuarioOperador.email,
          acao: 'baixa_financeira',
          modulo: 'eventos',
          entidade: 'evento_ordens_pagamento',
          entidadeId: item.id,
          descricao: `Conciliação Asaas: Ordem complementar baixada como PAGO (${item.asaas_payment_id})`,
          status: 'sucesso',
          detalhes: {
            evento_id: eventoId,
            origem: 'conciliacao_asaas',
            asaas_payment_id: item.asaas_payment_id,
            valor: item.valor_asaas,
          },
        });

        detalhes.push({
          id: item.id,
          tipo_entidade: item.tipo_entidade,
          asaas_payment_id: item.asaas_payment_id,
          sucesso: true,
        });
        totalSucessos++;
      }
    } catch (err: any) {
      console.error(`[CONCILIACAO REGULARIZACAO] Erro ao regularizar ${item.id}:`, err.message);
      totalFalhas++;
      detalhes.push({
        id: item.id,
        tipo_entidade: item.tipo_entidade,
        asaas_payment_id: item.asaas_payment_id,
        sucesso: false,
        erro: err.message,
      });
    }
  }

  // Log final da operação de conciliação em lote
  await logDB({
    userId: usuarioOperador.id,
    userEmail: usuarioOperador.email,
    acao: 'conciliacao_asaas_lote',
    modulo: 'eventos',
    entidade: 'eventos',
    entidadeId: eventoId,
    descricao: `Conciliação Asaas concluída: ${totalSucessos} pagamentos regularizados, ${totalFalhas} falhas.`,
    status: totalFalhas === 0 ? 'sucesso' : 'aviso',
    detalhes: {
      evento_id: eventoId,
      total_processados: elegiveis.length,
      total_sucessos: totalSucessos,
      total_falhas: totalFalhas,
    },
  });

  return {
    evento_id: eventoId,
    total_processados: elegiveis.length,
    total_sucessos: totalSucessos,
    total_falhas: totalFalhas,
    detalhes,
  };
}
