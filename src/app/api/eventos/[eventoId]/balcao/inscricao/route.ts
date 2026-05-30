import { NextRequest, NextResponse } from 'next/server';
import { requireEventoAccess } from '@/lib/evento-guard';
import { normalizePayloadUppercase } from '@/lib/text';
import { logDB } from '@/lib/audit';
import { calcularPrioridadeHospedagem } from '@/lib/hospedagem-helpers';
import { createOrFindAsaasCustomer, createEventoPayment } from '@/lib/asaas';
import { cleanCpf } from '@/lib/cpf';
import { generateQRCodeToken } from '@/lib/qrcode-token';

const VENCIMENTO_DIAS = 3;

function dueDateFromNow(dias = VENCIMENTO_DIAS): string {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

async function incrementarCupom(
  supabase: Awaited<ReturnType<typeof import('@/lib/supabase-server').createServerClient>>,
  eventoId: string,
  codigo: string
) {
  const { data: cup } = await supabase
    .from('evento_cupons')
    .select('usados')
    .eq('evento_id', eventoId)
    .eq('codigo', codigo)
    .single();
  if (cup) {
    await supabase
      .from('evento_cupons')
      .update({ usados: cup.usados + 1 })
      .eq('evento_id', eventoId)
      .eq('codigo', codigo);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;

  const guard = await requireEventoAccess(request, eventoId);
  if (!guard.ok) return guard.response;

  if (guard.ctx.perms.somenteCheckin) {
    return NextResponse.json({ error: 'Acesso negado. Permissão insuficiente.' }, { status: 403 });
  }

  const supabase = guard.ctx.supabaseAdmin;
  const operadorId = guard.ctx.user.id;
  const operadorEmail = guard.ctx.user.email ?? undefined;

  try {
    const body = await request.json() as Record<string, unknown>;
    const {
      nome_inscrito,
      cpf,
      email,
      whatsapp,
      sexo,
      data_nascimento,
      supervisao_id,
      campo_id,
      hospedagem,
      alimentacao,
      brinde,
      tipo_inscricao,
      cupom_codigo,
      valor_original,
      desconto_valor,
      valor_final,
      forma_pagamento,
      observacoes,
      qr_code,
      hosp_necessidade_especial,
      hosp_descricao_necessidade,
      hosp_cama_inferior,
      hosp_observacoes,
      grupo_hospedagem,
    } = body;

    if (!nome_inscrito || !String(nome_inscrito).trim() || !supervisao_id) {
      return NextResponse.json({ error: 'Nome e Supervisão são obrigatórios.' }, { status: 400 });
    }

    // Busca dados completos do evento
    const { data: evento } = await supabase
      .from('eventos')
      .select('id,nome,slug,departamento,configuracoes_ago,inscricoes_abertas,status')
      .eq('id', eventoId)
      .single();

    if (!evento) {
      return NextResponse.json({ error: 'Evento não encontrado.' }, { status: 404 });
    }

    // Determina forma e status de pagamento
    const formaStr = String(forma_pagamento ?? '');
    const vFinal = typeof valor_final === 'number' ? valor_final : 0;
    const vOriginal = typeof valor_original === 'number' ? valor_original : 0;
    const vDesconto = typeof desconto_valor === 'number' ? desconto_valor : 0;
    const isGratuito = vFinal <= 0 || formaStr === 'isento';
    const isAsaas = formaStr === 'asaas' && !isGratuito;
    const isPresencial = !isAsaas && !isGratuito;

    const statusPag = isGratuito ? 'isento'
      : isAsaas ? 'pendente'
      : 'pago';

    const formaPagSalva = isGratuito ? null
      : formaStr === 'pix_manual' ? 'pix'
      : formaStr === 'asaas' ? 'pix'   // sobrescrito após criação ASAAS
      : formaStr;

    // CPF limpo
    const cpfLimpo = cpf ? String(cpf).replace(/\D/g, '') : null;

    // Snapshot ministerial (AGO)
    let ministroSnapshot: Record<string, unknown> | null = null;
    if (cpfLimpo && (evento as any).departamento === 'AGO') {
      const { data: membro } = await supabase
        .from('members')
        .select('id,name,cpf,matricula,data_nascimento,campo_id,supervisao_id,status,cargo_ministerial,pastor_presidente,pastor_auxiliar,jubilado')
        .eq('cpf', cpfLimpo)
        .maybeSingle();
      if (membro) {
        let isCampoMissionario = false;
        let campoNome: string | null = null;
        if ((membro as any).campo_id) {
          const { data: campoData } = await supabase
            .from('campos')
            .select('nome,is_campo_missionario')
            .eq('id', (membro as any).campo_id)
            .maybeSingle();
          if (campoData) {
            isCampoMissionario = !!(campoData as any).is_campo_missionario;
            campoNome = (campoData as any).nome ?? null;
          }
        }
        ministroSnapshot = {
          ministro_id:        (membro as any).id,
          nome:               (membro as any).name,
          cpf:                (membro as any).cpf,
          matricula:          (membro as any).matricula ?? null,
          campo:              campoNome,
          campo_id:           (membro as any).campo_id ?? null,
          supervisao_id:      (membro as any).supervisao_id ?? null,
          status_ministerial: (membro as any).status ?? null,
          cargo:              (membro as any).cargo_ministerial ?? null,
          is_pastor_presidente:  !!((membro as any).pastor_presidente),
          is_pastor_auxiliar:    !!((membro as any).pastor_auxiliar),
          is_pastor_jubilado:    !!((membro as any).jubilado),
          is_campo_missionario:  isCampoMissionario,
        };
      }
    }

    // QR code
    const qrFinal = qr_code ? String(qr_code) : generateQRCodeToken();
    const cupomCodigo = cupom_codigo
      ? String(cupom_codigo).trim().toUpperCase()
      : null;

    // Monta payload
    const inscricaoPayload = normalizePayloadUppercase({
      evento_id:        eventoId,
      nome_inscrito:    String(nome_inscrito).trim(),
      cpf:              cpfLimpo || null,
      email:            email ? String(email).trim() : null,
      whatsapp:         whatsapp ? String(whatsapp).trim() : null,
      sexo:             sexo || null,
      data_nascimento:  data_nascimento || null,
      supervisao_id:    supervisao_id || null,
      campo_id:         campo_id || null,
      hospedagem:       !!hospedagem,
      alimentacao:      !!alimentacao,
      brinde:           !!brinde,
      tipo_inscricao:   tipo_inscricao || null,
      valor_original:   vOriginal,
      cupom_codigo:     cupomCodigo,
      desconto_valor:   vDesconto,
      valor_final:      vFinal,
      valor_pago:       isGratuito ? 0 : isPresencial ? vFinal : 0,
      status_pagamento: statusPag,
      forma_pagamento:  formaPagSalva,
      observacoes:      observacoes ? String(observacoes).trim() : null,
      qr_code:          qrFinal,
      operador_id:      operadorId,
      ministro_snapshot: ministroSnapshot,
      hosp_necessidade_especial:  !!hosp_necessidade_especial,
      hosp_descricao_necessidade: hosp_descricao_necessidade
        ? String(hosp_descricao_necessidade).trim()
        : null,
      hosp_cama_inferior:  !!hosp_cama_inferior,
      hosp_observacoes:    hosp_observacoes ? String(hosp_observacoes).trim() : null,
      grupo_hospedagem:    grupo_hospedagem ? String(grupo_hospedagem).trim() : null,
      lgpd_aceito:         true,
      lgpd_aceito_em:      new Date().toISOString(),
    });

    // Insere via service role (bypassa RLS)
    const { data: inscricao, error: insErr } = await supabase
      .from('evento_inscricoes')
      .insert([inscricaoPayload])
      .select('id,nome_inscrito,cpf,supervisao_id,campo_id,status_pagamento,hospedagem,alimentacao,brinde,qr_code,checkin_realizado')
      .single();

    if (insErr || !inscricao) {
      console.error('[BALCAO] Erro ao inserir inscrição:', insErr);
      return NextResponse.json({ error: 'Erro ao salvar inscrição.' }, { status: 500 });
    }

    const inscricaoId = (inscricao as any).id as string;

    // Incrementa cupom
    if (cupomCodigo) {
      await incrementarCupom(supabase, eventoId, cupomCodigo);
    }

    // Hospedagem AGO
    if (!!hospedagem && (evento as any).departamento === 'AGO') {
      const prioridade = calcularPrioridadeHospedagem({
        id:                         inscricaoId,
        nome_inscrito:              String(nome_inscrito).trim(),
        sexo:                       sexo ? String(sexo) : null,
        data_nascimento:            data_nascimento ? String(data_nascimento) : null,
        tipo_inscricao:             tipo_inscricao ? String(tipo_inscricao) : null,
        hosp_necessidade_especial:  !!hosp_necessidade_especial,
        hosp_descricao_necessidade: hosp_descricao_necessidade
          ? String(hosp_descricao_necessidade).trim()
          : null,
        hosp_cama_inferior: !!hosp_cama_inferior,
        hosp_observacoes:   hosp_observacoes ? String(hosp_observacoes).trim() : null,
      });
      await supabase.from('evento_hospedagens').insert([
        normalizePayloadUppercase({
          evento_id:            eventoId,
          inscricao_id:         inscricaoId,
          status:               'solicitada',
          prioridade,
          necessidade_especial: !!hosp_necessidade_especial,
          descricao_necessidade: hosp_descricao_necessidade
            ? String(hosp_descricao_necessidade).trim()
            : null,
          cama_inferior:  !!hosp_cama_inferior,
          observacoes:    hosp_observacoes ? String(hosp_observacoes).trim() : null,
          grupo_hospedagem: grupo_hospedagem ? String(grupo_hospedagem).trim() : null,
          alocacao_automatica: true,
        }),
      ]);
    }

    // Auditoria (fire-and-forget)
    void logDB({
      userId:      operadorId,
      userEmail:   operadorEmail,
      acao:        'criar_inscricao_balcao',
      modulo:      'eventos',
      entidade:    'evento_inscricoes',
      entidadeId:  inscricaoId,
      descricao:   `[Balcão] Nova inscrição: ${String(nome_inscrito).trim()} — ${(evento as any).nome}`,
      detalhes: {
        evento_id:        eventoId,
        forma_pagamento:  formaStr,
        valor_final:      vFinal,
        status_pagamento: statusPag,
        operador_id:      operadorId,
      },
      request,
    });

    // ASAAS: cria cobrança
    if (isAsaas) {
      try {
        const customerId = await createOrFindAsaasCustomer({
          nome:     String(nome_inscrito).trim(),
          email:    email ? String(email).trim() : null,
          cpf:      cleanCpf(cpfLimpo ?? ''),
          whatsapp: whatsapp ? String(whatsapp) : null,
        });

        const pagamento = await createEventoPayment({
          customerId,
          value:             vFinal,
          dueDate:           dueDateFromNow(),
          description:       `Inscrição Balcão — ${(evento as any).nome}${tipo_inscricao ? ` (${tipo_inscricao})` : ''}`,
          externalReference: inscricaoId,
        });

        await supabase
          .from('evento_inscricoes')
          .update({
            asaas_payment_id: pagamento.id,
            forma_pagamento:  'pix',
            invoice_url:      pagamento.invoiceUrl,
            pix_copia_cola:   pagamento.pixCopiaECola,
            pix_qr_code:      pagamento.pixQrCode,
            asaas_due_date:   dueDateFromNow(),
          })
          .eq('id', inscricaoId);

        return NextResponse.json({
          inscricaoId,
          inscricao,
          statusPagamento: 'aguardando_pagamento',
          pagamento: {
            invoiceUrl:    pagamento.invoiceUrl,
            pixCopiaECola: pagamento.pixCopiaECola,
            valor:         vFinal,
          },
        });
      } catch (asaasErr) {
        const msg = asaasErr instanceof Error ? asaasErr.message : String(asaasErr);
        console.error('[BALCAO ASAAS] Erro ao criar cobrança:', msg);
        return NextResponse.json({
          inscricaoId,
          inscricao,
          statusPagamento: 'pendente',
          pagamento:       null,
          asaasError:      'Cobrança ASAAS não gerada. Use outra forma de pagamento.',
        });
      }
    }

    return NextResponse.json({
      inscricaoId,
      inscricao,
      statusPagamento: statusPag,
      pagamento:       null,
    });
  } catch (err) {
    console.error('[BALCAO] Erro inesperado:', err);
    return NextResponse.json({ error: 'Erro inesperado no servidor.' }, { status: 500 });
  }
}
