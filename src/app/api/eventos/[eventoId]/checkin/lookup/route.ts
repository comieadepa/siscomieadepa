import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { requireEventoPermission } from '@/lib/evento-guard';

type InscricaoRow = {
  id: string;
  evento_id: string;
  ministro_id: string | null;
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
  hospedagem: boolean | null;
  valor_final: number | null;
  valor_pago: number | null;
  refeicoes_total: number | null;
  refeicoes_utilizadas: number | null;
  quantidade_refeicoes_total: number | null;
  quantidade_refeicoes_usadas: number | null;
  quantidade_refeicoes_saldo: number | null;
  ministro_snapshot?: any;
  foto_url?: string | null;
  matricula?: string | null;
  cargo_ministerial?: string | null;
};

const SELECT_INSC = [
  'id', 'evento_id', 'ministro_id', 'nome_inscrito', 'cpf',
  'supervisao_id', 'campo_id', 'status_pagamento',
  'checkin_realizado', 'checkin_at', 'qr_code',
  'tipo_inscricao', 'alimentacao', 'hospedagem',
  'valor_final', 'valor_pago',
  'refeicoes_total', 'refeicoes_utilizadas',
  'quantidade_refeicoes_total', 'quantidade_refeicoes_usadas', 'quantidade_refeicoes_saldo',
  'ministro_snapshot',
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

  // Executa validação de evento e busca inicial de operador/local em paralelo com a busca de inscrição
  const equipeIdFromGuard = guard.ctx.equipe?.id;
  const equipeIdFromHeader = request.headers.get('x-evento-equipe-id')?.trim();
  const equipeIdFromQuery = searchParams.get('equipe_id')?.trim();
  const targetEquipeId = equipeIdFromGuard || equipeIdFromHeader || equipeIdFromQuery;

  const [eventoRes, opRowRes, byTokenRes] = await Promise.all([
    supabase
      .from('eventos')
      .select('id,nome,status,checkin_ativo,valor_inscricao')
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
      .maybeSingle() as unknown as Promise<{ data: InscricaoRow | null; error: any }>
  ]);

  const evento = eventoRes.data;
  if (!evento) return NextResponse.json({ error: 'evento_nao_encontrado', message: 'Evento não encontrado.' }, { status: 404 });
  if (evento.status !== 'programado') return NextResponse.json({ error: 'evento_encerrado', message: 'Evento encerrado.' }, { status: 403 });
  if (evento.checkin_ativo !== true) return NextResponse.json({ error: 'checkin_desativado', message: 'Check-in desativado.' }, { status: 403 });

  // ── Validação do Local Vinculado ao Operador ──────────────
  if (targetEquipeId) {
    const opRow = opRowRes.data;
    if (!opRow || !opRow.ativo) {
      return NextResponse.json({
        error: 'operador_inativo',
        message: 'Acesso do operador encerrado ou inativo.',
      }, { status: 403 });
    }

    if (opRow.tipo === 'checkin_refeitorio' && modo !== 'refeitorio') {
      return NextResponse.json({
        error: 'modalidade_incompativel',
        message: 'Operador de Refeitório autorizado exclusivamente para consumo de refeições.',
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
          error: 'local_nao_encontrado',
          message: 'Local vinculado ao operador não encontrado neste evento.',
        }, { status: 400 });
      }

      if (localRec.ativo !== true) {
        return NextResponse.json({
          error: 'local_inativo',
          message: `O local "${localRec.nome}" vinculado a este operador está inativo.`,
        }, { status: 400 });
      }

      if (modo === 'plenaria' && localRec.tipo !== 'plenaria') {
        return NextResponse.json({
          error: 'modalidade_incompativel',
          message: `Operação incompatível: este terminal está vinculado ao restaurante "${localRec.nome}". Mude para o modo Refeitório.`,
        }, { status: 400 });
      }

      if (modo === 'refeitorio' && localRec.tipo !== 'refeitorio') {
        return NextResponse.json({
          error: 'modalidade_incompativel',
          message: `Operação incompatível: este terminal está vinculado à plenária "${localRec.nome}". Mude para o modo Plenária.`,
        }, { status: 400 });
      }
    }
  }

  // ── Busca inscrição pelo token ────────────────────────────
  let inscricao: InscricaoRow | null = byTokenRes.data;

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
    // Executa em paralelo a checagem de hoje e a busca do último registro
    const [presHojeRes, ultimoRegistroRes] = await Promise.all([
      supabase
        .from('evento_checkins')
        .select('id,created_at,checkin_user')
        .eq('inscricao_id', ins.id)
        .eq('tipo_checkin', 'plenaria')
        .eq('data_plenaria', dataPlen)
        .eq('sessao', sessao)
        .maybeSingle(),
      supabase
        .from('evento_checkins')
        .select('id,created_at,data_plenaria')
        .eq('inscricao_id', ins.id)
        .eq('tipo_checkin', 'plenaria')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
    ]);

    const presHoje = presHojeRes.data;
    if (presHoje) {
      plenaria_hoje = true;
      plenaria_hoje_at = (presHoje as any).created_at ?? null;
      plenaria_hoje_operador = (presHoje as any).checkin_user ?? null;
    }

    const ultimoRegistro = ultimoRegistroRes.data;
    if (ultimoRegistro && !plenaria_hoje) {
      plenaria_ultimo_at = (ultimoRegistro as any).created_at ?? null;
      plenaria_ultimo_data = (ultimoRegistro as any).data_plenaria ?? null;
    }
  }

  // ── Contexto Geral e Financeiro ──────────────────────────
  const statusPag = String(ins.status_pagamento || '').toLowerCase();
  const valorFinal = Number(ins.valor_final ?? ins.valor_pago ?? 0);
  const valorEvento = Number(evento.valor_inscricao ?? 0);
  const exigePagamento = valorFinal > 0 || valorEvento > 0;
  const pagamentoPendente = exigePagamento && !['pago', 'isento'].includes(statusPag);
  const aptoCheckin = !pagamentoPendente;

  const total  = ins.quantidade_refeicoes_total ?? ins.refeicoes_total ?? 0;
  const usadas = ins.quantidade_refeicoes_usadas ?? ins.refeicoes_utilizadas ?? 0;
  const saldo  = ins.quantidade_refeicoes_saldo ?? Math.max(0, total - usadas);

  // ── Enriquecimento de foto, matrícula e cargo se vinculado a ministro ──
  const snapshot = ins.ministro_snapshot;
  let fotoUrl: string | null = null;
  let matricula: string | null = snapshot?.matricula ? String(snapshot.matricula) : null;
  let cargoMinisterial: string | null = snapshot?.cargo ? String(snapshot.cargo) : null;

  const targetMemberId = ins.ministro_id || snapshot?.ministro_id;
  if (targetMemberId) {
    const { data: memberData } = await supabase
      .from('members')
      .select('foto_url, matricula, cargo_ministerial, custom_fields')
      .eq('id', targetMemberId)
      .maybeSingle() as any;

    if (memberData) {
      fotoUrl = memberData.foto_url || memberData.custom_fields?.fotoUrl || null;
      if (!matricula && memberData.matricula) matricula = String(memberData.matricula);
      if (!cargoMinisterial && memberData.cargo_ministerial) cargoMinisterial = String(memberData.cargo_ministerial);
    }
  } else if (ins.cpf) {
    const cpfLimpo = String(ins.cpf).replace(/\D/g, '');
    if (cpfLimpo) {
      const cpfFormatado = cpfLimpo.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
      const { data: memberData } = await supabase
        .from('members')
        .select('foto_url, matricula, cargo_ministerial, custom_fields')
        .or(`cpf.eq.${cpfLimpo},cpf.eq.${cpfFormatado}`)
        .maybeSingle() as any;

      if (memberData) {
        fotoUrl = memberData.foto_url || memberData.custom_fields?.fotoUrl || null;
        if (!matricula && memberData.matricula) matricula = String(memberData.matricula);
        if (!cargoMinisterial && memberData.cargo_ministerial) cargoMinisterial = String(memberData.cargo_ministerial);
      }
    }
  }

  const insEnriquecida: InscricaoRow = {
    ...ins,
    foto_url: fotoUrl,
    matricula,
    cargo_ministerial: cargoMinisterial,
  };

  // ── Responde sem registrar nada ───────────────────────────
  return NextResponse.json({
    status: 'found',
    inscricao: insEnriquecida,
    contexto: {
      modo,

      // Elegibilidade de Check-in
      apto_checkin: aptoCheckin,
      pagamento_pendente: pagamentoPendente,

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
      sem_alimentacao: !ins.alimentacao,
      refeicoes_total: total,
      refeicoes_usadas: usadas,
      refeicoes_saldo: saldo,
    },
  });
}
