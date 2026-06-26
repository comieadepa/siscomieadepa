import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { requireEventoPermission } from '@/lib/evento-guard';

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
  foto_url: string | null;
  hospedagem: boolean | null;
  refeicoes_total: number | null;
  refeicoes_utilizadas: number | null;
  quantidade_refeicoes_total: number | null;
  quantidade_refeicoes_usadas: number | null;
  quantidade_refeicoes_saldo: number | null;
};

const SELECT_INSC = [
  'id', 'evento_id', 'nome_inscrito', 'cpf',
  'supervisao_id', 'campo_id', 'status_pagamento',
  'checkin_realizado', 'checkin_at', 'qr_code',
  'tipo_inscricao', 'alimentacao', 'foto_url', 'hospedagem',
  'refeicoes_total', 'refeicoes_utilizadas',
  'quantidade_refeicoes_total', 'quantidade_refeicoes_usadas', 'quantidade_refeicoes_saldo',
].join(',');

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;
  const { searchParams } = new URL(request.url);
  const qrToken  = (searchParams.get('token') || searchParams.get('qr') || '').trim();
  const modoRaw  = (searchParams.get('modo') || 'credenciamento').trim();
  const modo     = (['credenciamento', 'plenaria', 'refeitorio'].includes(modoRaw)
    ? modoRaw : 'credenciamento') as 'credenciamento' | 'plenaria' | 'refeitorio';

  // Data/sessão atual para plenária
  // data_plenaria: data de hoje no fuso UTC-3 (Brasil)
  const agora = new Date();
  const dataPlen = searchParams.get('data_plenaria')
    ?? new Date(agora.getTime() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const sessao = searchParams.get('sessao') ?? null;

  if (!qrToken) {
    return NextResponse.json(
      { error: 'token_ausente', message: 'QR Code não reconhecido.' },
      { status: 400 }
    );
  }

  const areaGuard = modo === 'refeitorio' ? 'refeitorio' : 'checkin';
  const guard = await requireEventoPermission(request, eventoId, areaGuard);
  if (!guard.ok) return guard.response;

  const supabase = createServerClient();

  // ── Busca evento ─────────────────────────────────────────
  const { data: evento } = await supabase
    .from('eventos')
    .select('id,nome,status,checkin_ativo,valor_inscricao')
    .eq('id', eventoId)
    .single();

  if (!evento) return NextResponse.json({ error: 'evento_nao_encontrado', message: 'Evento não encontrado.' }, { status: 404 });
  if (evento.status !== 'programado') return NextResponse.json({ error: 'evento_encerrado', message: 'Evento encerrado.' }, { status: 403 });
  if (evento.checkin_ativo !== true) return NextResponse.json({ error: 'checkin_desativado', message: 'Check-in desativado.' }, { status: 403 });

  // ── Busca inscrição pelo token ────────────────────────────
  let inscricao: InscricaoRow | null = null;

  const { data: byToken } = await supabase
    .from('evento_inscricoes')
    .select(SELECT_INSC)
    .eq('evento_id', eventoId)
    .or(`qr_code.eq.${qrToken},id.eq.${qrToken}`)
    .maybeSingle() as { data: InscricaoRow | null };

  inscricao = byToken;

  // Fallback: credencial permanente do ministro
  if (!inscricao) {
    const { data: qrRec } = await supabase
      .from('credencial_qr_tokens')
      .select('ministro_id')
      .eq('token', qrToken)
      .maybeSingle() as any;

    if (qrRec?.ministro_id) {
      // 1. Tenta buscar direto por ministro_id na tabela evento_inscricoes
      const { data: byMinistro } = await supabase
        .from('evento_inscricoes')
        .select(SELECT_INSC)
        .eq('evento_id', eventoId)
        .eq('ministro_id', qrRec.ministro_id)
        .maybeSingle() as { data: InscricaoRow | null };
      
      if (byMinistro) {
        inscricao = byMinistro;
      } else {
        // 2. Se não achar por ministro_id, tenta buscar por CPF obtido do members (tolerante a formato)
        const { data: ministro } = await supabase
          .from('members')
          .select('cpf')
          .eq('id', qrRec.ministro_id)
          .maybeSingle() as any;

        if (ministro?.cpf) {
          const cpfLimpo = String(ministro.cpf).replace(/\D/g, '');
          if (cpfLimpo) {
            const cpfFormatado = cpfLimpo.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
            const { data: byCpf } = await supabase
              .from('evento_inscricoes')
              .select(SELECT_INSC)
              .eq('evento_id', eventoId)
              .or(`cpf.eq.${cpfLimpo},cpf.eq.${cpfFormatado}`)
              .maybeSingle() as { data: InscricaoRow | null };
            inscricao = byCpf;
          }
        }
      }
    }
  }

  if (!inscricao) {
    // Verifica se existe em outro evento
    const { data: outra } = await supabase
      .from('evento_inscricoes')
      .select('id,nome_inscrito,evento_id,cpf,ministro_id')
      .or(`qr_code.eq.${qrToken},id.eq.${qrToken}`)
      .maybeSingle() as any;

    if (outra) {
      // O token pertence a outro evento. Vamos verificar se essa mesma pessoa tem inscrição no evento atual
      let inscricaoCompativel: InscricaoRow | null = null;

      if (outra.ministro_id) {
        const { data: byMinistro } = await supabase
          .from('evento_inscricoes')
          .select(SELECT_INSC)
          .eq('evento_id', eventoId)
          .eq('ministro_id', outra.ministro_id)
          .maybeSingle() as { data: InscricaoRow | null };
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
            .maybeSingle() as { data: InscricaoRow | null };
          if (byCpf) {
            inscricaoCompativel = byCpf;
          }
        }
      }

      if (inscricaoCompativel) {
        inscricao = inscricaoCompativel;
      } else {
        return NextResponse.json({ status: 'wrong_event', message: 'Inscrição não pertence a este evento.', inscricao: outra }, { status: 200 });
      }
    }
  }

  if (!inscricao) {
    return NextResponse.json({ status: 'not_found', message: 'Inscrição não localizada para este QR Code.' }, { status: 200 });
  }

  const ins = inscricao;

  // ── Contexto para PLENÁRIA ────────────────────────────────────────────────
  // Chave de duplicidade: evento_id + inscricao_id + data_plenaria + sessao
  // "Já registrado" bloqueia APENAS quando mesmo dia + mesma sessão.
  // Registro de dia anterior é INFORMATIVO — NÃO bloqueia novo check-in.
  let plenaria_hoje = false;
  let plenaria_hoje_at: string | null = null;
  let plenaria_hoje_operador: string | null = null;
  let plenaria_ultimo_at: string | null = null;
  let plenaria_ultimo_data: string | null = null;

  if (modo === 'plenaria') {
    // 1. Verifica se já registrou NESTA data/sessão (chave de bloqueio)
    const { data: presHoje } = await supabase
      .from('evento_checkins')
      .select('id,created_at,checkin_user')
      .eq('inscricao_id', ins.id)
      .eq('tipo_checkin', 'plenaria')
      .eq('data_plenaria', dataPlen)
      .eq('sessao', sessao)          // null == null em PostgreSQL com .eq() só se ambos forem null; Supabase trata .eq('sessao', null) como IS NULL
      .maybeSingle();

    if (presHoje) {
      plenaria_hoje = true;
      plenaria_hoje_at = (presHoje as any).created_at ?? null;
      plenaria_hoje_operador = (presHoje as any).checkin_user ?? null;
    }

    // 2. Busca último registro em QUALQUER data/sessão (apenas informativo)
    const { data: ultimoRegistro } = await supabase
      .from('evento_checkins')
      .select('id,created_at,data_plenaria')
      .eq('inscricao_id', ins.id)
      .eq('tipo_checkin', 'plenaria')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (ultimoRegistro && !plenaria_hoje) {
      // Só preenche histórico se NÃO for o registro de hoje/sessão atual
      plenaria_ultimo_at = (ultimoRegistro as any).created_at ?? null;
      plenaria_ultimo_data = (ultimoRegistro as any).data_plenaria ?? null;
    }
  }

  // ── Contexto para REFEITÓRIO ──────────────────────────────
  const eventoExigePagamento = (evento.valor_inscricao ?? 0) > 0;
  const statusPag = String(ins.status_pagamento || '').toLowerCase();
  const pagamentoPendente = eventoExigePagamento && !['pago', 'isento'].includes(statusPag);

  const total  = ins.quantidade_refeicoes_total ?? ins.refeicoes_total ?? 0;
  const usadas = ins.quantidade_refeicoes_usadas ?? ins.refeicoes_utilizadas ?? 0;
  const saldo  = ins.quantidade_refeicoes_saldo ?? Math.max(0, total - usadas);

  // ── Responde sem registrar nada ───────────────────────────
  return NextResponse.json({
    status: 'found',
    inscricao: ins,
    contexto: {
      modo,

      // Plenária — data e sessão em uso nesta leitura
      data_plenaria: dataPlen,
      sessao,

      // true = já registrou NESTA data/sessão → botão desabilitado
      plenaria_hoje,
      plenaria_hoje_at,
      plenaria_hoje_operador,

      // Informativo: último registro em outra data (não bloqueia)
      plenaria_ultimo_at,
      plenaria_ultimo_data,

      // Retrocompatibilidade (campo antigo, mantido para não quebrar nada)
      ja_presente_plenaria: plenaria_hoje,

      // Refeitório
      pagamento_pendente: pagamentoPendente,
      sem_alimentacao: !ins.alimentacao,
      refeicoes_total: total,
      refeicoes_usadas: usadas,
      refeicoes_saldo: saldo,
    },
  });
}
