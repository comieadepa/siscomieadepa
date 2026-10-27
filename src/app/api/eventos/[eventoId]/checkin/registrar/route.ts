import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { requireEventoPermission } from '@/lib/evento-guard';

type EventoRow = {
  id: string;
  status: 'programado' | 'realizado' | 'cancelado';
  checkin_ativo: boolean | null;
  valor_inscricao: number | null;
};

type InscricaoRow = {
  id: string;
  evento_id: string;
  nome_inscrito: string;
  cpf: string | null;
  supervisao_id: string | null;
  campo_id: string | null;
  status_pagamento: string;
  checkin_realizado: boolean;
  checkin_at: string | null;
  qr_code: string | null;
  tipo_inscricao: string | null;
  alimentacao: boolean | null;
  valor_final: number | null;
  valor_pago: number | null;
  refeicoes_total: number | null;
  refeicoes_utilizadas: number | null;
  quantidade_refeicoes_total: number | null;
  quantidade_refeicoes_usadas: number | null;
  quantidade_refeicoes_saldo: number | null;
};

type TipoCheckin = 'credenciamento' | 'plenaria' | 'refeitorio';

const SELECT_INSC = [
  'id', 'evento_id', 'nome_inscrito', 'cpf',
  'supervisao_id', 'campo_id', 'status_pagamento',
  'checkin_realizado', 'checkin_at', 'qr_code',
  'tipo_inscricao', 'alimentacao',
  'valor_final', 'valor_pago',
  'refeicoes_total', 'refeicoes_utilizadas',
  'quantidade_refeicoes_total', 'quantidade_refeicoes_usadas', 'quantidade_refeicoes_saldo',
].join(',');

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;
  let body: {
    qr?: string;
    equipe_id?: string;
    tipo_checkin?: TipoCheckin;
    modo?: TipoCheckin;
    data_plenaria?: string;
    checkin_user?: string;
    sessao?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body invalido.' }, { status: 400 });
  }

  const qrToken      = String(body.qr || '').trim();
  const modoRaw = String(body.tipo_checkin || body.modo || '').trim();
  const tipoCheckin: TipoCheckin = (['credenciamento', 'plenaria', 'refeitorio'].includes(modoRaw)
    ? (modoRaw as TipoCheckin)
    : 'credenciamento');
  const dataPlenaria = body.data_plenaria ?? new Date().toISOString().slice(0, 10);
  const checkinUser  = body.checkin_user ?? null;
  const sessaoPlenaria = body.sessao ? String(body.sessao) : null;

  if (!qrToken) return NextResponse.json({ error: 'QR obrigatorio.' }, { status: 400 });

  const supabase = createServerClient();

  const areaGuard = tipoCheckin === 'refeitorio' ? 'refeitorio' : 'checkin';
  const guard = await requireEventoPermission(request, eventoId, areaGuard);
  if (!guard.ok) return guard.response;

  // ── Busca em paralelo: Evento, Operador de Equipe e Inscrição por QR/ID ────
  let resolvedLocalId: string | null = null;
  const equipeIdFromGuard = guard.ctx.equipe?.id;
  const equipeIdFromHeader = request.headers.get('x-evento-equipe-id')?.trim();
  const equipeIdFromBody = typeof body.equipe_id === 'string' ? body.equipe_id.trim() : null;
  const targetEquipeId = equipeIdFromGuard || equipeIdFromHeader || equipeIdFromBody;

  const [eventoRes, opRowRes, byTokenRes] = await Promise.all([
    supabase
      .from('eventos')
      .select('id,status,checkin_ativo,valor_inscricao')
      .eq('id', eventoId)
      .single(),
    targetEquipeId
      ? supabase
          .from('evento_equipe')
          .select('id,evento_id,tipo,ativo,local_id')
          .eq('id', targetEquipeId)
          .eq('evento_id', eventoId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase
      .from('evento_inscricoes')
      .select(SELECT_INSC)
      .eq('evento_id', eventoId)
      .or(`qr_code.eq.${qrToken},id.eq.${qrToken}`)
      .maybeSingle()
  ]);

  const evento = eventoRes.data;
  if (!evento) return NextResponse.json({ error: 'Evento nao encontrado.' }, { status: 404 });
  const evRow = evento as EventoRow;
  if (evRow.status !== 'programado')
    return NextResponse.json({ error: 'Evento encerrado ou cancelado.' }, { status: 403 });
  if (evRow.checkin_ativo !== true)
    return NextResponse.json({ error: 'Check-in desativado.' }, { status: 403 });

  // ── Determinação e Validação Rigorosa do Local do Operador ────
  if (targetEquipeId) {
    const opRow = opRowRes.data;
    if (!opRow || !opRow.ativo) {
      return NextResponse.json({ error: 'Operador não autorizado ou inativo.' }, { status: 403 });
    }

    if (opRow.tipo === 'checkin_refeitorio' && tipoCheckin !== 'refeitorio') {
      return NextResponse.json({
        error: 'Operador de Refeitório autorizado exclusivamente para consumo de refeições.',
      }, { status: 403 });
    }

    if (opRow.local_id) {
      const { data: localRec } = await supabase
        .from('evento_locais_checkin')
        .select('id,evento_id,tipo,nome,ativo')
        .eq('id', opRow.local_id)
        .eq('evento_id', eventoId)
        .maybeSingle();

      if (!localRec) {
        return NextResponse.json({
          error: 'Local vinculado ao operador não encontrado neste evento.',
        }, { status: 400 });
      }

      if (localRec.ativo !== true) {
        return NextResponse.json({
          error: `O local "${localRec.nome}" vinculado a este operador está inativo.`,
        }, { status: 400 });
      }

      if (tipoCheckin === 'plenaria' && localRec.tipo !== 'plenaria') {
        return NextResponse.json({
          error: `Operação incompatível: este operador está vinculado ao restaurante "${localRec.nome}" e não pode registrar presença em plenária.`,
        }, { status: 400 });
      }

      if (tipoCheckin === 'refeitorio' && localRec.tipo !== 'refeitorio') {
        return NextResponse.json({
          error: `Operação incompatível: este operador está vinculado à plenária "${localRec.nome}" e não pode registrar consumo de refeições.`,
        }, { status: 400 });
      }

      resolvedLocalId = localRec.id;
    } else {
      resolvedLocalId = null;
    }
  } else {
    resolvedLocalId = null;
  }

  // ── Inscrição identificada ou fallback ────────────────────
  let targetQrToken = qrToken;
  let inscricao = byTokenRes.data as any;

  // Se não encontrou a inscrição diretamente pelo token, tenta buscar se o token é uma Credencial de Ministro permanente
  if (!inscricao) {
    const { data: qrTokenRecord } = (await supabase
      .from('credencial_qr_tokens')
      .select('ministro_id')
      .eq('token', qrToken)
      .maybeSingle()) as any;

    if (qrTokenRecord?.ministro_id) {
      // 1. Tenta buscar direto por ministro_id na tabela evento_inscricoes
      const { data: byMinistro } = await supabase
        .from('evento_inscricoes')
        .select(SELECT_INSC)
        .eq('evento_id', eventoId)
        .eq('ministro_id', qrTokenRecord.ministro_id)
        .maybeSingle() as any;

      if (byMinistro) {
        inscricao = byMinistro;
        targetQrToken = byMinistro.qr_code || targetQrToken;
      } else {
        // 2. Se não achar por ministro_id, tenta buscar por CPF obtido do members (tolerante a formato)
        const { data: ministro } = (await supabase
          .from('members')
          .select('cpf')
          .eq('id', qrTokenRecord.ministro_id)
          .maybeSingle()) as any;

        if (ministro?.cpf) {
          const cpfLimpo = String(ministro.cpf).replace(/\D/g, '');
          if (cpfLimpo) {
            const cpfFormatado = cpfLimpo.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
            const { data: byCpf } = await supabase
              .from('evento_inscricoes')
              .select(SELECT_INSC)
              .eq('evento_id', eventoId)
              .or(`cpf.eq.${cpfLimpo},cpf.eq.${cpfFormatado}`)
              .maybeSingle() as any;

            if (byCpf) {
              inscricao = byCpf;
              targetQrToken = byCpf.qr_code || targetQrToken;
            }
          }
        }
      }
    }
  }

  if (!inscricao) {
    // Verifica se o token pertence a uma inscrição de outro evento
    const { data: outra } = await supabase
      .from('evento_inscricoes')
      .select('id,nome_inscrito,evento_id,cpf,ministro_id')
      .or(`qr_code.eq.${qrToken},id.eq.${qrToken}`)
      .maybeSingle() as any;

    if (outra) {
      // O token pertence a outro evento. Vamos verificar se essa mesma pessoa tem inscrição no evento atual
      let inscricaoCompativel: any = null;

      if (outra.ministro_id) {
        const { data: byMinistro } = await supabase
          .from('evento_inscricoes')
          .select(SELECT_INSC)
          .eq('evento_id', eventoId)
          .eq('ministro_id', outra.ministro_id)
          .maybeSingle() as any;
        if (byMinistro) {
          inscricaoCompativel = byMinistro;
        }
      }

      if (!inscricaoCompativel && outra.cpf) {
        const cpfLimpo = String(outra.cpf).replace(/\D/g, '');
        if (cpfLimpo) {
          const cpfFormatado = cpfLimpo.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
          const { data: byCpf } = await supabase
            .from('evento_inscricoes')
            .select(SELECT_INSC)
            .eq('evento_id', eventoId)
            .or(`cpf.eq.${cpfLimpo},cpf.eq.${cpfFormatado}`)
            .maybeSingle() as any;
          if (byCpf) {
            inscricaoCompativel = byCpf;
          }
        }
      }

      if (inscricaoCompativel) {
        inscricao = inscricaoCompativel;
        targetQrToken = inscricaoCompativel.qr_code || targetQrToken;
      } else {
        return NextResponse.json({ status: 'wrong_event', inscricao: outra }, { status: 200 });
      }
    }
  }

  if (!inscricao) {
    return NextResponse.json({ status: 'invalid' }, { status: 200 });
  }

  const ins = inscricao as unknown as InscricaoRow;

  // ── VALIDAÇÃO DE PAGAMENTO / REGULARIDADE ─────────────────
  const statusPagamento = String(ins.status_pagamento || '').toLowerCase();
  const valorFinal = Number(ins.valor_final ?? ins.valor_pago ?? 0);
  const valorEvento = Number(evRow.valor_inscricao ?? 0);
  const exigePagamento = valorFinal > 0 || valorEvento > 0;
  const isApto = !exigePagamento || ['pago', 'isento'].includes(statusPagamento);

  if (!isApto) {
    return NextResponse.json({ status: 'pagamento_pendente', inscricao: ins }, { status: 200 });
  }

  // ── MODO CREDENCIAMENTO ──────────────────────────────────
  if (tipoCheckin === 'credenciamento') {
    if (ins.checkin_realizado) {
      return NextResponse.json({ status: 'already', inscricao: ins }, { status: 200 });
    }
    const now = new Date().toISOString();
    // Atualização com condição defensiva para evitar corrida de credenciamento
    const { data: updated, error: updError } = await supabase
      .from('evento_inscricoes')
      .update({ checkin_realizado: true, checkin_at: now })
      .eq('id', ins.id)
      .eq('checkin_realizado', false)
      .select('id')
      .maybeSingle();

    if (updError) return NextResponse.json({ error: 'Erro ao registrar check-in.' }, { status: 500 });
    if (!updated) {
      return NextResponse.json({ status: 'already', inscricao: { ...ins, checkin_realizado: true } }, { status: 200 });
    }

    await supabase.from('evento_checkins').insert([{
      evento_id: eventoId,
      inscricao_id: ins.id,
      metodo: 'qrcode',
      tipo_checkin: 'credenciamento',
      checkin_user: checkinUser,
      local_id: resolvedLocalId,
    }]);
    return NextResponse.json({ status: 'success', inscricao: { ...ins, checkin_realizado: true, checkin_at: now } });
  }

  // ── MODO PLENARIA ────────────────────────────────────────
  if (tipoCheckin === 'plenaria') {
    const { data: jaPresente } = await supabase
      .from('evento_checkins')
      .select('id')
      .eq('inscricao_id', ins.id)
      .eq('tipo_checkin', 'plenaria')
      .eq('data_plenaria', dataPlenaria)
      .eq('sessao', sessaoPlenaria)
      .maybeSingle();

    if (jaPresente) {
      return NextResponse.json({ status: 'already_plenaria', inscricao: ins, data_plenaria: dataPlenaria }, { status: 200 });
    }

    const { error: insErr } = await supabase.from('evento_checkins').insert([{
      evento_id: eventoId,
      inscricao_id: ins.id,
      metodo: 'qrcode',
      tipo_checkin: 'plenaria',
      data_plenaria: dataPlenaria,
      sessao: sessaoPlenaria,
      checkin_user: checkinUser,
      local_id: resolvedLocalId,
    }]);
    if (insErr) return NextResponse.json({ error: 'Erro ao registrar presenca.' }, { status: 500 });
    return NextResponse.json({ status: 'success', inscricao: ins, data_plenaria: dataPlenaria });
  }

  // ── MODO REFEITORIO ──────────────────────────────────────
  if (tipoCheckin === 'refeitorio') {
    if (!ins.alimentacao) {
      return NextResponse.json({ status: 'sem_alimentacao', inscricao: ins }, { status: 200 });
    }

    // Geração de chave de idempotência segura para a leitura
    const idempotencyKey = body.qr ? String(body.qr).trim() : null;

    // Execução EXCLUSIVA via RPC Transacional Atômica no PostgreSQL
    const { data: rpcRes, error: rpcErr } = await supabase.rpc('registrar_consumo_refeicao_atomico', {
      p_evento_id: eventoId,
      p_inscricao_id: ins.id,
      p_qr_code: qrToken,
      p_equipe_id: guard.ctx.equipe?.id ?? null,
      p_user_id: guard.ctx.user?.id ?? null,
      p_checkin_user: checkinUser,
      p_idempotency_key: idempotencyKey,
      p_janela_duplicidade_segundos: 20,
    } as any);

    if (rpcErr) {
      console.error('[CHECKIN REFEITORIO RPC ERRO]', rpcErr);
      return NextResponse.json(
        {
          error: 'Operação transacional de refeição indisponível no servidor. Nenhum débito foi realizado.',
          detalhe: rpcErr.message,
        },
        { status: 503 }
      );
    }

    const resObj = typeof rpcRes === 'string' ? JSON.parse(rpcRes) : rpcRes;
    if (!resObj || !resObj.sucesso) {
      return NextResponse.json(
        {
          status: resObj?.status || 'invalid',
          inscricao: ins,
          saldo_antes: resObj?.saldo_antes ?? 0,
          saldo_depois: resObj?.saldo_depois ?? 0,
          error: resObj?.mensagem || 'Não foi possível registrar o consumo de refeição.',
          ultima_leitura_em: resObj?.ultima_leitura_em,
        },
        { status: 200 }
      );
    }

    return NextResponse.json({
      status: 'success',
      inscricao: {
        ...ins,
        quantidade_refeicoes_total: resObj.quantidade_refeicoes_total ?? ins.quantidade_refeicoes_total,
        quantidade_refeicoes_usadas: resObj.quantidade_refeicoes_usadas ?? ((ins.quantidade_refeicoes_usadas ?? 0) + 1),
        quantidade_refeicoes_saldo: resObj.saldo_depois,
        refeicoes_total: resObj.quantidade_refeicoes_total ?? ins.refeicoes_total,
        refeicoes_utilizadas: resObj.quantidade_refeicoes_usadas ?? ((ins.refeicoes_utilizadas ?? 0) + 1),
      },
      saldo_antes: resObj.saldo_antes,
      saldo_depois: resObj.saldo_depois,
    });
  }

  return NextResponse.json({ error: 'Modo invalido.' }, { status: 400 });
}
