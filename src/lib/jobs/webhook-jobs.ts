import { SupabaseClient } from '@supabase/supabase-js';
import { sendEmail } from '@/services/email';
import { registrarHistoricoMinisterial } from '@/lib/historico-ministerial';
import { alocarLeitoParaInscricao } from '@/lib/hospedagem-alocacao-automatica';
import { cleanCpf } from '@/lib/cpf';

// ── Substitui {VAR} no template ──────────────────────────────
function subst(msg: string, vars: Record<string, string>): string {
  return msg.replace(/\{([A-Z_]+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
}

function formatarPeriodoEvento(dataInicio?: string | null, dataFim?: string | null): string | null {
  if (!dataInicio) return null;
  if (dataFim && dataFim !== dataInicio) return `${dataInicio} a ${dataFim}`;
  return dataInicio;
}

/**
 * Envia e-mail de confirmação de pagamento com deduplicação.
 * Usa evento_notificacoes (UNIQUE inscricao_id, tipo, gatilho) para garantir
 * que apenas um e-mail seja enviado por inscrição.
 */
async function enviarEmailComDeduplicacao(
  supabase: SupabaseClient,
  params: {
    inscricaoId: string;
    eventoId: string;
    nome: string;
    email: string;
    qrCode: string;
    nomeEvento: string;
    mensagemConfirmacao: string | null;
    linkWhatsapp: string | null;
  }
): Promise<void> {
  const { inscricaoId, eventoId, nome, email, qrCode, nomeEvento, mensagemConfirmacao, linkWhatsapp } = params;

  const assunto = `✅ Inscrição confirmada — ${nomeEvento}`;
  const vars = { NOME: nome, EVENTO: nomeEvento, QR_CODE: qrCode, LINK_GRUPO: linkWhatsapp ?? '(em breve)' };
  let mensagem = `Olá, ${nome}!\n\nSeu pagamento para o evento *${nomeEvento}* foi confirmado. ✅\n\n🎫 Código de check-in: ${qrCode}`;
  if (mensagemConfirmacao) mensagem += `\n\n${subst(mensagemConfirmacao, vars)}`;
  if (linkWhatsapp)        mensagem += `\n\n📲 Grupo do WhatsApp: ${linkWhatsapp}`;

  const { data: newRow, error: insErr } = await supabase
    .from('evento_notificacoes')
    .insert({
      evento_id:    eventoId,
      inscricao_id: inscricaoId,
      tipo:         'email',
      gatilho:      'pagamento_confirmado',
      status:       'pendente',
      assunto,
      mensagem,
    })
    .select('id')
    .single();

  let notifId: string;

  if (insErr || !newRow) {
    const { data: existing } = await supabase
      .from('evento_notificacoes')
      .select('id, status')
      .eq('inscricao_id', inscricaoId)
      .eq('tipo', 'email')
      .eq('gatilho', 'pagamento_confirmado')
      .single();

    if (!existing) {
      console.error(`[WEBHOOK JOBS] Falha ao registrar notificação para inscrição ${inscricaoId}:`, insErr?.message);
      return;
    }
    if ((existing as { id: string; status: string }).status === 'enviado') {
      console.log(`[WEBHOOK JOBS] E-mail já enviado para inscrição ${inscricaoId} — duplicata ignorada.`);
      return;
    }
    notifId = (existing as { id: string; status: string }).id;
  } else {
    notifId = newRow.id as string;
  }

  const resultado = await sendEmail({
    para: email,
    assunto,
    mensagem,
    nomeDestinatario: nome,
    fromEmail: 'inscricoes@siscomieadepa.org',
  });

  const { error: updErr } = await supabase
    .from('evento_notificacoes')
    .update({
      status:     resultado.sucesso ? 'enviado' : 'erro',
      enviado_em: resultado.sucesso ? new Date().toISOString() : null,
      erro:       resultado.sucesso ? null : (resultado.erro ?? 'Erro desconhecido'),
    })
    .eq('id', notifId);

  if (updErr) {
    console.error(`[WEBHOOK JOBS] Erro ao atualizar status da notificação ${notifId}:`, updErr.message);
  }

  if (!resultado.sucesso) {
    console.error(`[WEBHOOK JOBS] Falha ao enviar e-mail para ${email}:`, resultado.erro);
    throw new Error(resultado.erro ?? 'Erro ao enviar e-mail');
  }
}

/**
 * Enfileira um único job de webhook
 */
export async function enqueueWebhookJob(
  supabase: SupabaseClient,
  job: {
    job_type: string;
    entity_type: string;
    entity_id: string;
    external_event_id?: string;
    external_payment_id?: string;
    payload?: any;
  }
) {
  return enqueueWebhookJobs(supabase, [job]);
}

/**
 * Enfileira múltiplos jobs de webhook de forma idempotente (upsert/on conflict ignore)
 */
export async function enqueueWebhookJobs(
  supabase: SupabaseClient,
  jobs: Array<{
    job_type: string;
    entity_type: string;
    entity_id: string;
    external_event_id?: string;
    external_payment_id?: string;
    payload?: any;
  }>
) {
  if (jobs.length === 0) return;
  const rows = jobs.map(j => ({
    source: 'asaas',
    job_type: j.job_type,
    entity_type: j.entity_type,
    entity_id: j.entity_id,
    external_event_id: j.external_event_id ?? null,
    external_payment_id: j.external_payment_id ?? null,
    payload: j.payload ?? null,
    status: 'pending',
    attempts: 0,
    max_attempts: 5,
    available_at: new Date().toISOString(),
  }));

  const { error } = await supabase
    .from('webhook_jobs')
    .upsert(rows, {
      onConflict: 'source,job_type,entity_type,entity_id,external_payment_id',
      ignoreDuplicates: true,
    });

  if (error) {
    console.error('[WEBHOOK JOBS] Erro ao enfileirar jobs:', error.message);
    throw error;
  }
}

/**
 * Marca um job como concluído com sucesso
 */
export async function markJobDone(supabase: SupabaseClient, jobId: string) {
  await supabase
    .from('webhook_jobs')
    .update({
      status: 'done',
      processed_at: new Date().toISOString(),
      locked_at: null,
      locked_by: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId);
}

/**
 * Marca um job como falhado e calcula o próximo tempo de tentativa (backoff)
 */
export async function markJobFailed(supabase: SupabaseClient, job: any, errorMsg: string) {
  const nextAttempts = job.attempts + 1;
  const isDead = nextAttempts >= job.max_attempts;

  let availableAt = new Date();
  if (!isDead) {
    // Backoff sugerido:
    // attempt 1: +1 minuto (index 0)
    // attempt 2: +5 minutos (index 1)
    // attempt 3: +15 minutos (index 2)
    // attempt 4: +1 hora (index 3)
    // attempt 5: dead
    const backoffMinutes = [1, 5, 15, 60];
    const minutesToAdd = backoffMinutes[job.attempts] ?? 15;
    availableAt = new Date(Date.now() + minutesToAdd * 60 * 1000);
  }

  await supabase
    .from('webhook_jobs')
    .update({
      status: isDead ? 'dead' : 'failed',
      attempts: nextAttempts,
      last_error: errorMsg,
      locked_at: null,
      locked_by: null,
      available_at: availableAt.toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', job.id);
}

/**
 * Processa um único job baseado em seu tipo
 */
export async function processSingleWebhookJob(supabase: SupabaseClient, job: any): Promise<void> {
  const { job_type, entity_type, entity_id } = job;

  if (job_type === 'ALLOCATE_ACCOMMODATION') {
    if (entity_type === 'inscricao') {
      await alocarLeitoParaInscricao(supabase, entity_id);
    } else {
      throw new Error(`ALLOCATE_ACCOMMODATION não suporta entity_type ${entity_type}`);
    }
  } else if (job_type === 'SEND_CONFIRMATION_EMAIL') {
    if (entity_type === 'inscricao') {
      const { data: fullIns, error: insErr } = await supabase
        .from('evento_inscricoes')
        .select('id, nome_inscrito, email, qr_code, evento_id, ministro_id, cpf, tipo_inscricao')
        .eq('id', entity_id)
        .single();
      if (insErr || !fullIns) {
        throw new Error(`Inscrição ${entity_id} não encontrada: ${insErr?.message}`);
      }

      const { data: evData, error: evErr } = await supabase
        .from('eventos')
        .select('nome, mensagem_confirmacao, link_whatsapp, data_inicio, data_fim')
        .eq('id', fullIns.evento_id)
        .single();
      if (evErr || !evData) {
        throw new Error(`Evento ${fullIns.evento_id} não encontrado: ${evErr?.message}`);
      }

      if (fullIns.email) {
        await enviarEmailComDeduplicacao(supabase, {
          inscricaoId:         fullIns.id,
          eventoId:            fullIns.evento_id,
          nome:                fullIns.nome_inscrito,
          email:               fullIns.email,
          qrCode:              fullIns.qr_code,
          nomeEvento:          evData.nome,
          mensagemConfirmacao: evData.mensagem_confirmacao,
          linkWhatsapp:        evData.link_whatsapp,
        });
      } else {
        console.warn(`[WEBHOOK JOBS] Job ${job.id} ignorado por e-mail ausente.`);
      }
    } else {
      throw new Error(`SEND_CONFIRMATION_EMAIL não suporta entity_type ${entity_type}`);
    }
  } else if (job_type === 'REGISTER_MINISTERIAL_HISTORY') {
    if (entity_type === 'inscricao') {
      const { data: fullIns, error: insErr } = await supabase
        .from('evento_inscricoes')
        .select('id, nome_inscrito, email, qr_code, evento_id, ministro_id, cpf, tipo_inscricao')
        .eq('id', entity_id)
        .single();
      if (insErr || !fullIns) {
        throw new Error(`Inscrição ${entity_id} não encontrada: ${insErr?.message}`);
      }

      const { data: evData, error: evErr } = await supabase
        .from('eventos')
        .select('nome, mensagem_confirmacao, link_whatsapp, data_inicio, data_fim')
        .eq('id', fullIns.evento_id)
        .single();
      if (evErr || !evData) {
        throw new Error(`Evento ${fullIns.evento_id} não encontrado: ${evErr?.message}`);
      }

      const ministroId = fullIns.ministro_id || null;
      let resolvedId = ministroId;
      if (!resolvedId && fullIns.cpf) {
        const { data: membro } = await supabase
          .from('members')
          .select('id, cpf')
          .eq('cpf', cleanCpf(fullIns.cpf))
          .maybeSingle();
        if (membro?.id) resolvedId = membro.id;
      }

      if (resolvedId) {
        const periodo = formatarPeriodoEvento(
          evData.data_inicio,
          evData.data_fim,
        );
        await registrarHistoricoMinisterial({
          ministroId: resolvedId,
          tipo: 'inscricao_evento',
          titulo: 'Inscrição em evento',
          descricao: `Inscrição confirmada no evento "${evData.nome}"${periodo ? ` (${periodo})` : ''}${fullIns.tipo_inscricao ? ` — ${fullIns.tipo_inscricao}` : ''}.`,
          origem: 'evento_inscricao',
          referenciaId: fullIns.id,
        });
      } else {
        console.warn(`[WEBHOOK JOBS] Ministro não identificado para inscrição ${entity_id}.`);
      }
    } else {
      throw new Error(`REGISTER_MINISTERIAL_HISTORY não suporta entity_type ${entity_type}`);
    }
  } else {
    throw new Error(`Tipo de job desconhecido: ${job_type}`);
  }
}

/**
 * Busca e processa até 20 jobs pendentes/falhados disponíveis
 */
export async function processPendingWebhookJobs(supabase: SupabaseClient): Promise<number> {
  const lockId = Math.random().toString(36).substring(7);

  // 1. Busca jobs disponíveis
  const { data: jobsToLock, error: selectErr } = await supabase
    .from('webhook_jobs')
    .select('id, status, attempts')
    .in('status', ['pending', 'failed'])
    .lte('available_at', new Date().toISOString())
    .order('available_at', { ascending: true })
    .limit(20);

  if (selectErr || !jobsToLock || jobsToLock.length === 0) {
    return 0;
  }

  const ids = jobsToLock.map(j => j.id);

  // 2. Tenta fazer lock (marcar como processing e setar locked_at / locked_by)
  const { data: lockedJobs, error: lockErr } = await supabase
    .from('webhook_jobs')
    .update({
      status: 'processing',
      locked_at: new Date().toISOString(),
      locked_by: lockId,
      updated_at: new Date().toISOString(),
    })
    .in('id', ids)
    .in('status', ['pending', 'failed'])
    .select('*');

  if (lockErr || !lockedJobs || lockedJobs.length === 0) {
    return 0;
  }

  console.log(`[WEBHOOK JOBS] Encontrados e travados ${lockedJobs.length} jobs para processamento.`);

  let processedCount = 0;
  for (const job of lockedJobs) {
    const start = Date.now();
    console.log(`[WEBHOOK JOBS] ▶ Processando job ${job.id} | Tipo: ${job.job_type} | Entidade: ${job.entity_type}:${job.entity_id}`);
    try {
      await processSingleWebhookJob(supabase, job);
      await markJobDone(supabase, job.id);
      processedCount++;
      console.log(`[WEBHOOK JOBS] ✔ Job ${job.id} finalizado | Status: done | Tempo: ${Date.now() - start}ms`);
    } catch (err: any) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[WEBHOOK JOBS] ❌ Falha no job ${job.id}:`, errorMsg);
      try {
        await markJobFailed(supabase, job, errorMsg);
      } catch (markErr) {
        console.error(`[WEBHOOK JOBS] Erro crítico ao marcar falha do job ${job.id}:`, markErr);
      }
    }
  }

  return processedCount;
}
