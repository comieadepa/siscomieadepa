import { NextRequest, NextResponse } from 'next/server';
import { SupabaseClient } from '@supabase/supabase-js';
import { createServerClient } from '@/lib/supabase-server';
import { sendEmail } from '@/services/email';
import { registrarHistoricoMinisterial } from '@/lib/historico-ministerial';
import { cleanCpf } from '@/lib/cpf';

const ASAAS_WEBHOOK_TOKEN = process.env.ASAAS_WEBHOOK_TOKEN;

function resolveToken(request: NextRequest): string | null {
  const direct = request.headers.get('asaas-access-token') || request.headers.get('access_token');
  if (direct) return direct;
  const auth = request.headers.get('authorization');
  if (!auth) return null;
  return auth.replace('Bearer ', '');
}

// ── Substitui {VAR} no template ──────────────────────────────
function subst(msg: string, vars: Record<string, string>): string {
  return msg.replace(/\{([A-Z_]+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
}

const EVENTOS_PAGAMENTO_CONFIRMADO = new Set([
  'PAYMENT_RECEIVED',
  'PAYMENT_CONFIRMED',
  'PAYMENT_RECEIVED_IN_CASH',
]);

function formatarPeriodoEvento(dataInicio?: string | null, dataFim?: string | null): string | null {
  if (!dataInicio) return null;
  if (dataFim && dataFim !== dataInicio) return `${dataInicio} a ${dataFim}`;
  return dataInicio;
}

/**
 * Envia e-mail de confirmação de pagamento com deduplicação.
 * Usa evento_notificacoes (UNIQUE inscricao_id, tipo, gatilho) para garantir
 * que apenas um e-mail seja enviado por inscrição, mesmo com webhooks duplicados.
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

  // 1. Tenta inserir registro 'pendente'. A constraint UNIQUE (inscricao_id, tipo, gatilho)
  //    rejeita silenciosamente duplicatas — isso é a trava de idempotência.
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
    // Conflict: registro já existe — verifica status atual
    const { data: existing } = await supabase
      .from('evento_notificacoes')
      .select('id, status')
      .eq('inscricao_id', inscricaoId)
      .eq('tipo', 'email')
      .eq('gatilho', 'pagamento_confirmado')
      .single();

    if (!existing) {
      console.error(`[WEBHOOK] Falha ao registrar notificação para inscrição ${inscricaoId}:`, insErr?.message);
      return;
    }
    if ((existing as { id: string; status: string }).status === 'enviado') {
      console.log(`[WEBHOOK] E-mail já enviado para inscrição ${inscricaoId} — duplicata ignorada.`);
      return;
    }
    notifId = (existing as { id: string; status: string }).id;
  } else {
    notifId = newRow.id as string;
  }

  // 2. Envia e-mail
  const resultado = await sendEmail({
    para: email,
    assunto,
    mensagem,
    nomeDestinatario: nome,
    fromEmail: 'inscricoes@siscomieadepa.org',
  });

  // 3. Registra resultado na tabela
  const { error: updErr } = await supabase
    .from('evento_notificacoes')
    .update({
      status:     resultado.sucesso ? 'enviado' : 'erro',
      enviado_em: resultado.sucesso ? new Date().toISOString() : null,
      erro:       resultado.sucesso ? null : (resultado.erro ?? 'Erro desconhecido'),
    })
    .eq('id', notifId);

  if (updErr) {
    console.error(`[WEBHOOK] Erro ao atualizar status da notificação ${notifId}:`, updErr.message);
  }

  if (!resultado.sucesso) {
    console.error(`[WEBHOOK] Falha ao enviar e-mail para ${email}:`, resultado.erro);
  }
}

export async function POST(request: NextRequest) {
  try {
    // 1. Valida token
    if (!ASAAS_WEBHOOK_TOKEN) {
      console.error('[EVENTOS WEBHOOK] ASAAS_WEBHOOK_TOKEN não configurado');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const token = resolveToken(request);
    if (!token || token !== ASAAS_WEBHOOK_TOKEN) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Lê payload
    const payload = await request.json();
    const event   = String(payload?.event || '').toUpperCase();
    const payment = payload?.payment;
    const asaasId = payment?.id;

    if (!asaasId) {
      return NextResponse.json({ error: 'Payment ID ausente' }, { status: 400 });
    }

    console.log('[EVENTOS WEBHOOK] Evento recebido:', event, asaasId);

    // 3. Mapeamento de status
    const statusMap: Record<string, string> = {
      PAYMENT_CONFIRMED:       'pago',
      PAYMENT_RECEIVED:        'pago',
      PAYMENT_RECEIVED_IN_CASH:'pago',
      PAYMENT_OVERDUE:         'pendente',  // Vencido mas ainda pendente (não cancela)
      PAYMENT_DELETED:         'cancelado',
      PAYMENT_CANCELED:        'cancelado',
      PAYMENT_REFUNDED:        'cancelado',
    };

    const novoStatus = statusMap[event];
    if (!novoStatus) {
      // Evento não mapeado — aceita sem processar
      return NextResponse.json({ received: true, action: 'ignored' });
    }

    const supabase = createServerClient();

    // 4. Verifica se é cobrança de lote (externalReference inicia com "lote:")
    const extRef = String(payment?.externalReference ?? '');
    if (extRef.startsWith('lote:')) {
      const loteId = extRef.slice(5);
      const updateLote: Record<string, unknown> = { status_pagamento: novoStatus };
      if (novoStatus === 'pago') updateLote.comprovante_url = payment.transactionReceiptUrl ?? null;

      const { error: loteErr } = await supabase
        .from('evento_lotes_inscricao')
        .update(updateLote)
        .eq('id', loteId);

      if (loteErr) {
        console.error('[EVENTOS WEBHOOK] Erro ao atualizar lote:', loteErr.message);
        return NextResponse.json({ error: loteErr.message }, { status: 500 });
      }
      // O trigger fn_sync_lote_pagamento cuida de atualizar as inscrições do lote
      console.log('[EVENTOS WEBHOOK] Lote atualizado:', loteId, '→', novoStatus);

      // E-mails individuais para participantes do lote (com deduplicação por inscrição)
      if (novoStatus === 'pago') {
        try {
          const { data: loteIns } = await supabase
            .from('evento_inscricoes')
            .select('id, nome_inscrito, email, qr_code, evento_id, ministro_id, cpf, tipo_inscricao')
            .eq('lote_id', loteId);
          if (loteIns && loteIns.length > 0) {
            const firstRow = loteIns[0] as unknown as Record<string, unknown>;
            const { data: evData } = await supabase
              .from('eventos')
              .select('nome, mensagem_confirmacao, link_whatsapp, data_inicio, data_fim')
              .eq('id', firstRow.evento_id as string)
              .single();
            const evRow = evData as unknown as Record<string, unknown> | null;
            if (evRow) {
              for (const li of loteIns) {
                const row = li as unknown as Record<string, unknown>;
                if (row.email) {
                  await enviarEmailComDeduplicacao(supabase, {
                    inscricaoId:         row.id as string,
                    eventoId:            row.evento_id as string,
                    nome:                row.nome_inscrito as string,
                    email:               row.email as string,
                    qrCode:              row.qr_code as string,
                    nomeEvento:          evRow.nome as string,
                    mensagemConfirmacao: evRow.mensagem_confirmacao as string | null,
                    linkWhatsapp:        evRow.link_whatsapp as string | null,
                  });
                }
              }

              if (EVENTOS_PAGAMENTO_CONFIRMADO.has(event)) {
                const cpfs = loteIns
                  .map(li => cleanCpf((li as { cpf?: string | null }).cpf))
                  .filter(c => c.length === 11);
                const { data: membros } = await supabase
                  .from('members')
                  .select('id, cpf')
                  .in('cpf', cpfs);
                const memberMap = new Map(
                  (membros ?? []).map(m => [cleanCpf((m as { cpf?: string | null }).cpf), (m as { id: string }).id])
                );
                const periodo = formatarPeriodoEvento(
                  evRow.data_inicio as string | null,
                  evRow.data_fim as string | null,
                );

                for (const li of loteIns) {
                  const row = li as unknown as { id: string; ministro_id?: string | null; cpf?: string | null; tipo_inscricao?: string | null };
                  const ministroId = row.ministro_id || memberMap.get(cleanCpf(row.cpf));
                  if (!ministroId) continue;
                  await registrarHistoricoMinisterial({
                    ministroId,
                    tipo: 'inscricao_evento',
                    titulo: 'Inscrição em evento',
                    descricao: `Inscrição confirmada no evento "${evRow.nome as string}"${periodo ? ` (${periodo})` : ''}${row.tipo_inscricao ? ` — ${row.tipo_inscricao}` : ''}.`,
                    origem: 'evento_inscricao',
                    referenciaId: row.id,
                  });
                }
              }
            }
          }
        } catch (emailErr) {
          console.error('[EVENTOS WEBHOOK] Erro ao enviar e-mails do lote:', emailErr);
        }
      }

      return NextResponse.json({ received: true, loteId, status: novoStatus });
    }

    // 4b. Localiza inscrição individual pelo asaas_payment_id
    const { data: ins, error: findErr } = await supabase
      .from('evento_inscricoes')
      .select('id, status_pagamento, evento_id, ministro_id, cpf, tipo_inscricao')
      .eq('asaas_payment_id', asaasId)
      .maybeSingle();

    if (findErr) {
      console.error('[EVENTOS WEBHOOK] Erro ao buscar inscrição:', findErr.message);
      return NextResponse.json({ error: findErr.message }, { status: 500 });
    }

    if (!ins) {
      // Pode ser cobrança de outro módulo (payments) — aceita sem erro
      return NextResponse.json({ received: true, action: 'not_found_in_eventos' });
    }

    // 5. Não regride status (pago → pendente não acontece)
    if (ins.status_pagamento === 'pago' && novoStatus !== 'cancelado') {
      return NextResponse.json({ received: true, action: 'already_paid' });
    }

    // 6. Monta update
    const updateData: Record<string, unknown> = {
      status_pagamento: novoStatus,
    };

    if (novoStatus === 'pago') {
      updateData.valor_pago    = payment.value ?? 0;
      updateData.comprovante_url = payment.transactionReceiptUrl ?? null;
    }

    const { error: updErr } = await supabase
      .from('evento_inscricoes')
      .update(updateData)
      .eq('id', ins.id);

    if (updErr) {
      console.error('[EVENTOS WEBHOOK] Erro ao atualizar inscrição:', updErr.message);
      return NextResponse.json({ error: updErr.message }, { status: 500 });
    }

    console.log('[EVENTOS WEBHOOK] Inscrição atualizada:', ins.id, '→', novoStatus);

    // E-mail de confirmação quando pago (com deduplicação)
    if (novoStatus === 'pago') {
      try {
        const { data: fullIns } = await supabase
          .from('evento_inscricoes')
          .select('id, nome_inscrito, email, qr_code, evento_id, ministro_id, cpf, tipo_inscricao')
          .eq('id', ins.id)
          .single();
        const fullRow = fullIns as unknown as Record<string, unknown> | null;
        let evRow: Record<string, unknown> | null = null;
        if (fullRow) {
          const { data: evData } = await supabase
            .from('eventos')
            .select('nome, mensagem_confirmacao, link_whatsapp, data_inicio, data_fim')
            .eq('id', fullRow.evento_id as string)
            .single();
          evRow = evData as unknown as Record<string, unknown> | null;
        }

        if (fullRow?.email && evRow) {
          await enviarEmailComDeduplicacao(supabase, {
            inscricaoId:         fullRow.id as string,
            eventoId:            fullRow.evento_id as string,
            nome:                fullRow.nome_inscrito as string,
            email:               fullRow.email as string,
            qrCode:              fullRow.qr_code as string,
            nomeEvento:          evRow.nome as string,
            mensagemConfirmacao: evRow.mensagem_confirmacao as string | null,
            linkWhatsapp:        evRow.link_whatsapp as string | null,
          });
        }

        if (EVENTOS_PAGAMENTO_CONFIRMADO.has(event) && fullRow && evRow) {
          const ministroId = (fullRow.ministro_id as string | null) || null;
          let resolvedId = ministroId;
          if (!resolvedId && fullRow.cpf) {
            const { data: membro } = await supabase
              .from('members')
              .select('id, cpf')
              .eq('cpf', cleanCpf(fullRow.cpf as string))
              .maybeSingle();
            if (membro?.id) resolvedId = membro.id as string;
          }

          if (resolvedId) {
            const periodo = formatarPeriodoEvento(
              evRow.data_inicio as string | null,
              evRow.data_fim as string | null,
            );
            await registrarHistoricoMinisterial({
              ministroId: resolvedId,
              tipo: 'inscricao_evento',
              titulo: 'Inscrição em evento',
              descricao: `Inscrição confirmada no evento "${evRow.nome as string}"${periodo ? ` (${periodo})` : ''}${fullRow.tipo_inscricao ? ` — ${String(fullRow.tipo_inscricao)}` : ''}.`,
              origem: 'evento_inscricao',
              referenciaId: fullRow.id as string,
            });
          }
        }
      } catch (emailErr) {
        console.error('[EVENTOS WEBHOOK] Erro ao enviar e-mail de confirmação:', emailErr);
      }
    }

    return NextResponse.json({ received: true, inscricaoId: ins.id, status: novoStatus });

  } catch (err: any) {
    console.error('[EVENTOS WEBHOOK] Erro inesperado:', err.message);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
