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

  // ── Valida evento ────────────────────────────────────────
  const { data: evento } = await supabase
    .from('eventos')
    .select('id,status,checkin_ativo,valor_inscricao')
    .eq('id', eventoId)
    .single();
  if (!evento) return NextResponse.json({ error: 'Evento nao encontrado.' }, { status: 404 });
  const evRow = evento as EventoRow;
  if (evRow.status !== 'programado')
    return NextResponse.json({ error: 'Evento encerrado ou cancelado.' }, { status: 403 });
  if (evRow.checkin_ativo !== true)
    return NextResponse.json({ error: 'Check-in desativado.' }, { status: 403 });

  // ── Busca inscricao ──────────────────────────────────────
  let targetQrToken = qrToken;
  let { data: inscricao } = (await supabase
    .from('evento_inscricoes')
    .select(SELECT_INSC)
    .eq('evento_id', eventoId)
    .or(`qr_code.eq.${targetQrToken},id.eq.${targetQrToken}`)
    .maybeSingle()) as any;

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
        return NextResponse.json({
          status: 'wrong_event',
          inscricao: outra,
          debug: {
            requestedEventoId: eventoId,
            outraEventoId: outra.evento_id,
            qrToken: qrToken,
            byTokenIsNull: true
          }
        }, { status: 200 });
      }
    }
  }

  if (!inscricao) {
    return NextResponse.json({ status: 'invalid' }, { status: 200 });
  }

  const ins = inscricao as unknown as InscricaoRow;

  // ── MODO CREDENCIAMENTO ──────────────────────────────────
  if (tipoCheckin === 'credenciamento') {
    if (ins.checkin_realizado) {
      return NextResponse.json({ status: 'already', inscricao: ins }, { status: 200 });
    }
    const now = new Date().toISOString();
    const { error: updError } = await supabase
      .from('evento_inscricoes')
      .update({ checkin_realizado: true, checkin_at: now })
      .eq('id', ins.id);
    if (updError) return NextResponse.json({ error: 'Erro ao registrar check-in.' }, { status: 500 });
    await supabase.from('evento_checkins').insert([{
      evento_id: eventoId, inscricao_id: ins.id,
      metodo: 'qrcode', tipo_checkin: 'credenciamento', checkin_user: checkinUser,
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
      evento_id: eventoId, inscricao_id: ins.id,
      metodo: 'qrcode', tipo_checkin: 'plenaria',
      data_plenaria: dataPlenaria,
      sessao: sessaoPlenaria,
      checkin_user: checkinUser,
    }]);
    if (insErr) return NextResponse.json({ error: 'Erro ao registrar presenca.' }, { status: 500 });
    return NextResponse.json({ status: 'success', inscricao: ins, data_plenaria: dataPlenaria });
  }

  // ── MODO REFEITORIO ──────────────────────────────────────
  if (tipoCheckin === 'refeitorio') {
    const eventoExigePagamento = (evRow.valor_inscricao ?? 0) > 0;
    const statusPagamento = String(ins.status_pagamento || '').toLowerCase();
    if (eventoExigePagamento && !['pago', 'isento'].includes(statusPagamento)) {
      return NextResponse.json({ status: 'pagamento_pendente', inscricao: ins }, { status: 200 });
    }

    if (!ins.alimentacao) {
      return NextResponse.json({ status: 'sem_alimentacao', inscricao: ins }, { status: 200 });
    }

    const total = ins.quantidade_refeicoes_total ?? ins.refeicoes_total ?? 0;
    const usadas = ins.quantidade_refeicoes_usadas ?? ins.refeicoes_utilizadas ?? 0;
    const saldoAtual = ins.quantidade_refeicoes_saldo ?? Math.max(0, total - usadas);

    if (saldoAtual <= 0) {
      return NextResponse.json({ status: 'sem_saldo', inscricao: ins, saldo_antes: 0, saldo_depois: 0 }, { status: 200 });
    }

    const { data: consumoRecente } = await supabase
      .from('evento_refeicoes_consumo')
      .select('id,data_hora,saldo_antes,saldo_depois')
      .eq('evento_id', eventoId)
      .eq('inscricao_id', ins.id)
      .eq('origem', 'refeitorio')
      .order('data_hora', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (consumoRecente) {
      const deltaMs = Date.now() - new Date(consumoRecente.data_hora).getTime();
      if (deltaMs >= 0 && deltaMs <= 20_000) {
        return NextResponse.json({
          status: 'duplicate_rapida',
          inscricao: ins,
          saldo_antes: consumoRecente.saldo_antes,
          saldo_depois: consumoRecente.saldo_depois,
          ultima_leitura_em: consumoRecente.data_hora,
        }, { status: 200 });
      }
    }

    const saldoDepois = saldoAtual - 1;

    const { data: updatedInsc, error: updErr } = await supabase
      .from('evento_inscricoes')
      .update({
        quantidade_refeicoes_total: total,
        quantidade_refeicoes_usadas: usadas + 1,
        quantidade_refeicoes_saldo: saldoDepois,
        refeicoes_total: total,
        refeicoes_utilizadas: usadas + 1,
      })
      .eq('id', ins.id)
      .select('id,quantidade_refeicoes_total,quantidade_refeicoes_usadas,quantidade_refeicoes_saldo,refeicoes_total,refeicoes_utilizadas')
      .single();

    if (updErr || !updatedInsc)
      return NextResponse.json({ error: 'Erro ao debitar refeicao.' }, { status: 500 });

    await supabase.from('evento_refeicoes_consumo').insert([{
      evento_id: eventoId,
      inscricao_id: ins.id,
      qr_code: qrToken,
      tipo_consumo: 'refeicao',
      operador_id: guard.ctx.user?.id ?? null,
      origem: 'refeitorio',
      saldo_antes: saldoAtual,
      saldo_depois: saldoDepois,
    }]);

    await supabase.from('evento_checkins').insert([{
      evento_id: eventoId, inscricao_id: ins.id,
      metodo: 'qrcode', tipo_checkin: 'refeitorio',
      saldo_antes: saldoAtual, saldo_depois: saldoDepois,
      checkin_user: checkinUser,
    }]);

    return NextResponse.json({
      status: 'success',
      inscricao: {
        ...ins,
        quantidade_refeicoes_total: total,
        quantidade_refeicoes_usadas: usadas + 1,
        quantidade_refeicoes_saldo: saldoDepois,
        refeicoes_total: total,
        refeicoes_utilizadas: usadas + 1,
      },
      saldo_antes: saldoAtual,
      saldo_depois: saldoDepois,
    });
  }

  return NextResponse.json({ error: 'Modo invalido.' }, { status: 400 });
}
