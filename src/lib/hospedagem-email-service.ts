import { SupabaseClient } from '@supabase/supabase-js';
import { sendEmail } from '@/services/email';

export interface DadosHospedagemConfirmada {
  alojamentoNome: string;
  leitoNumero: string;
  tipoCama: string;
  endereco?: string | null;
  orientacoes?: string | null;
}

export interface EnviarEmailComplementarParams {
  inscricaoId: string;
  forceReenvio?: boolean;
}

/**
 * Validação simplificada de e-mail RFC 5322
 */
function isValidEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const clean = email.trim();
  return /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(clean);
}

/**
 * Busca de forma segura os dados reais de hospedagem confirmada associados a uma inscrição.
 * Retorna null se não houver hospedagem, se não for confirmada ou se não tiver leito/alojamento completos.
 * 
 * Regra de Endereço:
 * Não confunde o local geral do evento com endereço do alojamento.
 * Utiliza estritamente campos específicos de endereço do alojamento quando disponíveis.
 * Se o alojamento não possuir endereço próprio cadastrado, o campo é retornado null.
 */
export async function obterDadosHospedagemConfirmada(
  supabase: SupabaseClient,
  inscricaoId: string
): Promise<DadosHospedagemConfirmada | null> {
  const { data: hosp, error } = await supabase
    .from('evento_hospedagens')
    .select(`
      id,
      status,
      alojamento_id,
      numero_cama,
      tipo_cama,
      observacoes,
      evento_alojamentos (
        id,
        nome,
        publico,
        sexo
      )
    `)
    .eq('inscricao_id', inscricaoId)
    .maybeSingle();

  if (error || !hosp) return null;

  // Regra 6: Não informar hospedagem como confirmada quando estiver solicitada, pendente ou em lista de espera
  if (hosp.status !== 'confirmada') return null;

  const aloj = hosp.evento_alojamentos as { id?: string; nome?: string; endereco?: string } | null;
  const alojNome = aloj?.nome?.trim();
  const leitoNum = hosp.numero_cama ? String(hosp.numero_cama).trim() : null;

  if (!alojNome || !leitoNum) return null;

  const tipoCamaDesc = hosp.tipo_cama === 'inferior'
    ? 'Cama de Baixo (Inferior)'
    : hosp.tipo_cama === 'superior'
      ? 'Cama de Cima (Superior)'
      : hosp.tipo_cama
        ? String(hosp.tipo_cama)
        : 'Padrão';

  // Endereço específico do alojamento (se existir coluna ou cadastro próprio)
  const enderecoAlojamento = aloj?.endereco ? String(aloj.endereco).trim() : null;

  return {
    alojamentoNome: alojNome,
    leitoNumero: leitoNum,
    tipoCama: tipoCamaDesc,
    endereco: enderecoAlojamento,
    orientacoes: hosp.observacoes?.trim() || null,
  };
}

/**
 * Formata o bloco institucional de dados da hospedagem para inclusão no corpo do e-mail.
 * Respeita a regra estrita: NUNCA insere local geral do evento como se fosse endereço do alojamento.
 */
export function formatarBlocoHospedagem(dados: DadosHospedagemConfirmada): string {
  const linhas: string[] = [
    '🏨 *DADOS DA HOSPEDAGEM CONFIRMADA*',
    `• Alojamento: ${dados.alojamentoNome}`,
    `• Leito / Cama Nº: ${dados.leitoNumero}`,
    `• Posição / Tipo: ${dados.tipoCama}`,
  ];

  // Apenas inclui endereço se for o endereço REAL cadastrado especificamente para o alojamento
  if (dados.endereco?.trim()) {
    linhas.push(`• Endereço do Alojamento: ${dados.endereco.trim()}`);
  }

  if (dados.orientacoes?.trim()) {
    linhas.push(`• Observações / Orientações: ${dados.orientacoes.trim()}`);
  }

  linhas.push('Apresente este informativo e seu código de check-in na recepção do alojamento.');
  return linhas.join('\n');
}

/**
 * Envia e-mail complementar exclusivo de confirmação de hospedagem quando a alocação
 * ocorrer posteriormente ao envio do e-mail inicial de pagamento/inscrição.
 *
 * Implementa deduplicação atômica real no banco:
 * 1. Verifica se o e-mail de confirmação de pagamento já continha a hospedagem.
 * 2. Faz INSERT com garantia atômica de unicidade através da tabela 'webhook_jobs'
 *    (CONSTRAINT uq_webhook_jobs_idempotency: source, job_type, entity_type, entity_id, external_payment_id)
 *    garantindo que chamadas simultâneas (webhook, cron, retry) sejam bloqueadas a nível de banco.
 */
export async function enviarEmailHospedagemComplementar(
  supabase: SupabaseClient,
  params: EnviarEmailComplementarParams
): Promise<{ enviado: boolean; motivo: string }> {
  const { inscricaoId, forceReenvio = false } = params;

  // 1. Busca dados da inscrição
  const { data: inscricao, error: insErr } = await supabase
    .from('evento_inscricoes')
    .select('id, evento_id, nome_inscrito, email, qr_code, status_pagamento')
    .eq('id', inscricaoId)
    .maybeSingle();

  if (insErr || !inscricao) {
    return { enviado: false, motivo: 'Inscrição não encontrada' };
  }

  const emailLimpo = inscricao.email ? inscricao.email.trim() : '';
  if (!isValidEmail(emailLimpo)) {
    return { enviado: false, motivo: 'E-mail do participante inválido ou ausente' };
  }

  // 2. Busca dados de hospedagem confirmada
  const dadosHosp = await obterDadosHospedagemConfirmada(supabase, inscricaoId);
  if (!dadosHosp) {
    return { enviado: false, motivo: 'Hospedagem não está confirmada com leito e alojamento' };
  }

  // 3. Deduplicação e Concorrência Atômica no Banco:
  if (!forceReenvio) {
    // 3a. Verifica se o e-mail principal de pagamento já continha hospedagem
    const { data: notifPagamento } = await supabase
      .from('evento_notificacoes')
      .select('id, status, mensagem')
      .eq('inscricao_id', inscricaoId)
      .eq('tipo', 'email')
      .eq('gatilho', 'pagamento_confirmado')
      .maybeSingle();

    if (notifPagamento && notifPagamento.mensagem?.includes('DADOS DA HOSPEDAGEM CONFIRMADA')) {
      return { enviado: false, motivo: 'Informativo de hospedagem já incluído no e-mail principal enviado' };
    }

    // 3b. Reserva atômica de concorrência com constraint UNIQUE no banco
    const { error: lockErr } = await supabase
      .from('webhook_jobs')
      .insert({
        source: 'hospedagem',
        job_type: 'SEND_ACCOMMODATION_EMAIL',
        entity_type: 'inscricao',
        entity_id: inscricaoId,
        external_payment_id: `leito_${dadosHosp.leitoNumero}`,
        status: 'processing',
        locked_at: new Date().toISOString(),
        locked_by: 'email_hospedagem_service',
      });

    if (lockErr) {
      if (lockErr.code === '23505') {
        // Conflito de chave única atômica disparado pelo Postgres
        return { enviado: false, motivo: 'Envio complementar bloqueado por concorrência atômica no banco (já despachado ou em andamento)' };
      }
      console.warn(`[HOSPEDAGEM EMAIL] Aviso na trava atômica de lock: ${lockErr.message}`);
    }
  }

  // 4. Busca dados do evento
  const { data: evento } = await supabase
    .from('eventos')
    .select('nome, link_whatsapp')
    .eq('id', inscricao.evento_id)
    .maybeSingle();

  const nomeEvento = evento?.nome?.trim() || 'Evento COMIEADEPA';
  const blocoHospedagem = formatarBlocoHospedagem(dadosHosp);

  const assunto = `🏨 Hospedagem Confirmada — ${nomeEvento}`;
  let mensagem = `[HOSPEDAGEM_CONFIRMADA]\n` +
    `Olá, ${inscricao.nome_inscrito}!\n\n` +
    `Sua hospedagem para o evento *${nomeEvento}* foi confirmada com sucesso! ✅\n\n` +
    `🎫 Código de Check-in: ${inscricao.qr_code ?? '-'}\n\n` +
    `${blocoHospedagem}`;

  if (evento?.link_whatsapp) {
    mensagem += `\n\n📲 Grupo do WhatsApp: ${evento.link_whatsapp}`;
  }

  // 5. Registro em evento_notificacoes e envio via Resend
  const idempotencyKey = `hospedagem_${inscricaoId}_${dadosHosp.leitoNumero}`;

  const { data: newRow, error: insNotifErr } = await supabase
    .from('evento_notificacoes')
    .insert({
      evento_id: inscricao.evento_id,
      inscricao_id: inscricaoId,
      tipo: 'email',
      gatilho: 'manual',
      status: 'pendente',
      assunto,
      mensagem,
    })
    .select('id')
    .single();

  let notifId: string;
  if (insNotifErr || !newRow) {
    const { data: existing } = await supabase
      .from('evento_notificacoes')
      .select('id, status')
      .eq('inscricao_id', inscricaoId)
      .eq('tipo', 'email')
      .eq('gatilho', 'manual')
      .single();

    if (!existing) {
      return { enviado: false, motivo: `Falha ao registrar notificação: ${insNotifErr?.message}` };
    }
    notifId = existing.id;
  } else {
    notifId = newRow.id;
  }

  // 6. Despacho seguro via Resend com cabeçalho Idempotency-Key
  const resultado = await sendEmail({
    para: emailLimpo,
    assunto,
    mensagem,
    nomeDestinatario: inscricao.nome_inscrito,
    fromEmail: 'inscricoes@siscomieadepa.org',
    idempotencyKey,
  });

  const isTimeout = resultado.erro?.startsWith('TIMEOUT_OU_FALHA_REDE');
  const updateData: Record<string, unknown> = {
    status: resultado.sucesso ? 'enviado' : 'erro',
    enviado_em: resultado.sucesso ? new Date().toISOString() : null,
    erro: resultado.sucesso ? null : (resultado.erro ?? 'Erro desconhecido'),
  };

  if (!resultado.sucesso && isTimeout) {
    updateData.status = 'pendente';
    updateData.erro = `Possível envio em andamento (timeout de rede): ${resultado.erro}`;
  }

  await supabase
    .from('evento_notificacoes')
    .update(updateData)
    .eq('id', notifId);

  // Atualiza status do lock atômico em webhook_jobs
  await supabase
    .from('webhook_jobs')
    .update({
      status: resultado.sucesso ? 'done' : (isTimeout ? 'pending' : 'failed'),
      last_error: resultado.erro || null,
      processed_at: resultado.sucesso ? new Date().toISOString() : null,
    })
    .eq('job_type', 'SEND_ACCOMMODATION_EMAIL')
    .eq('entity_id', inscricaoId);

  if (!resultado.sucesso) {
    return { enviado: false, motivo: resultado.erro ?? 'Falha ao despachar e-mail via Resend' };
  }

  return { enviado: true, motivo: 'E-mail complementar enviado com sucesso' };
}
