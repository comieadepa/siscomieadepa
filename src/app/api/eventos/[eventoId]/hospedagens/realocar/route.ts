import { NextRequest, NextResponse } from 'next/server';
import { requireEventoPermission } from '@/lib/evento-guard';
import { logDB } from '@/lib/audit';

/**
 * POST /api/eventos/[eventoId]/hospedagens/realocar
 * Move participante para outro alojamento/leito.
 * Body: { hospedagem_id, novo_alojamento_id, novo_tipo_cama?, novo_numero_cama?, motivo?, operador? }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> },
) {
  const { eventoId } = await params;
  const guard = await requireEventoPermission(req, eventoId, 'hospedagem');
  if (!guard.ok) return guard.response;
  const supabase = guard.ctx.supabaseAdmin;

  const body = await req.json().catch(() => ({}));
  const {
    hospedagem_id,
    novo_alojamento_id,
    novo_tipo_cama,
    novo_numero_cama,
    motivo,
    operador,
  } = body as {
    hospedagem_id?: string;
    novo_alojamento_id?: string;
    novo_tipo_cama?: string;
    novo_numero_cama?: string;
    motivo?: string;
    operador?: string;
  };

  if (!hospedagem_id || !novo_alojamento_id) {
    return NextResponse.json(
      { error: 'hospedagem_id e novo_alojamento_id são obrigatórios.' },
      { status: 400 },
    );
  }

  // Busca hospedagem atual
  const { data: hospedagem } = await supabase
    .from('evento_hospedagens')
    .select('id, inscricao_id, alojamento_id, tipo_cama, numero_cama, status')
    .eq('id', hospedagem_id)
    .eq('evento_id', eventoId)
    .maybeSingle();

  if (!hospedagem) {
    return NextResponse.json({ error: 'Hospedagem não encontrada.' }, { status: 404 });
  }

  // Verifica alojamento destino e vagas
  const { data: aloj } = await supabase
    .from('evento_alojamentos')
    .select('id, nome, total_vagas, camas_inferiores, camas_superiores, setor_key, origem')
    .eq('id', novo_alojamento_id)
    .eq('evento_id', eventoId)
    .maybeSingle();

  if (!aloj) {
    return NextResponse.json({ error: 'Alojamento destino não encontrado.' }, { status: 404 });
  }

  // Para eventos AGO, valida se o alojamento destino pertence à projeção oficial sincronizada (Regra 6)
  const { data: eventoCheck } = await supabase
    .from('eventos')
    .select('departamento, configuracoes_ago')
    .eq('id', eventoId)
    .single();

  const isAGO = eventoCheck?.departamento === 'AGO' || Boolean((eventoCheck?.configuracoes_ago as any)?.setores?.length);
  if (isAGO && !aloj.setor_key && aloj.origem !== 'configuracoes_ago') {
    return NextResponse.json(
      { error: 'Para eventos AGO, a realocação só pode ser realizada para alojamentos oficiais sincronizados.' },
      { status: 400 }
    );
  }

  const { count: ocupTotal } = await supabase
    .from('evento_hospedagens')
    .select('id', { count: 'exact', head: true })
    .eq('alojamento_id', novo_alojamento_id)
    .in('status', ['confirmada', 'checkin_realizado', 'checkout_realizado'])
    .neq('id', hospedagem_id);

  if ((ocupTotal ?? 0) >= aloj.total_vagas) {
    return NextResponse.json(
      { error: 'Alojamento destino sem vagas disponíveis.' },
      { status: 409 },
    );
  }

  // Tenta executar via RPC atômica caso a função esteja instalada no banco
  const { data: rpcData, error: rpcError } = await supabase.rpc('realocar_participante_hospedagem_atomica', {
    p_evento_id: eventoId,
    p_hospedagem_id: hospedagem_id,
    p_novo_alojamento_id: novo_alojamento_id,
    p_novo_tipo_cama: novo_tipo_cama || null,
    p_novo_numero_cama: novo_numero_cama?.trim() || null,
    p_motivo: motivo?.trim() || null,
    p_operador: operador?.trim() || null,
  } as any);

  if (!rpcError && rpcData?.sucesso) {
    await logDB({
      userId: guard.ctx.user?.id,
      userEmail: guard.ctx.user?.email ?? undefined,
      acao: 'ajuste_manual_hospedagem',
      modulo: 'eventos',
      entidade: 'evento_hospedagens',
      entidadeId: hospedagem_id,
      descricao: '[Hospedagem] Realocacao manual atomica via RPC',
      detalhes: {
        evento_id: eventoId,
        inscricao_id: hospedagem.inscricao_id,
        novo_alojamento_id,
        novo_tipo_cama: rpcData.tipo_cama ?? null,
        novo_numero_cama: rpcData.novo_numero_leito,
        motivo: motivo ?? null,
      },
      request: req,
    });
    return NextResponse.json({ ok: true, novo_numero_leito: rpcData.novo_numero_leito });
  }

  // Se a RPC falhar por erro de regra de negócio, propaga o erro imediatamente
  if (rpcError && !rpcError.message.includes('function public.realocar_participante_hospedagem_atomica') && !rpcError.message.includes('does not exist')) {
    return NextResponse.json({ error: rpcError.message.replace(/^Erro na transação de realocação:\s*/, '') }, { status: 400 });
  }

  // 1. Libera leito antigo
  if (hospedagem.alojamento_id) {
    await supabase
      .from('evento_hospedagem_leitos')
      .update({ ocupado: false, inscricao_id: null })
      .eq('evento_id', eventoId)
      .eq('inscricao_id', hospedagem.inscricao_id);
  }

  // 2. Busca leitos já cadastrados no alojamento destino
  const { data: leitosExist } = await supabase
    .from('evento_hospedagem_leitos')
    .select('id, numero, posicao, ocupado, inscricao_id')
    .eq('evento_id', eventoId)
    .eq('alojamento_id', novo_alojamento_id);

  const posicaoDesejada: 'inferior' | 'superior' | 'unico' =
    novo_tipo_cama === 'inferior' ? 'inferior'
    : novo_tipo_cama === 'superior' ? 'superior'
    : 'unico';

  // Verifica se o alojamento opera com beliches (camas inferiores ou superiores configuradas)
  const isAlojamentoBeliche = (aloj.camas_inferiores > 0 || (aloj as any).camas_superiores > 0);

  // Paridade estrita é regra física exclusiva do Alojamento Rosa
  const isRosa = aloj.nome?.toUpperCase().includes('ROSA');
  const isPar = (n: number) => n % 2 === 0;
  const isNumeroCompativel = (num: number, pos: string) => {
    if (!isRosa || pos === 'unico') return true;
    if (pos === 'inferior') return isPar(num);
    if (pos === 'superior') return !isPar(num);
    return true;
  };

  let leitoEscolhido: { id?: string; numero: string; posicao: 'inferior' | 'superior' | 'unico' } | null = null;

  // 2.0 Se o operador forneceu um número de leito específico manualmente
  if (novo_numero_cama?.trim()) {
    const numLimpo = novo_numero_cama.trim();
    const numInt = parseInt(numLimpo, 10);
    if (isNaN(numInt) || numInt <= 0 || numInt > aloj.total_vagas) {
      if (hospedagem.alojamento_id && hospedagem.numero_cama) {
        await supabase
          .from('evento_hospedagem_leitos')
          .update({ ocupado: true, inscricao_id: hospedagem.inscricao_id })
          .eq('evento_id', eventoId)
          .eq('alojamento_id', hospedagem.alojamento_id)
          .eq('numero', hospedagem.numero_cama);
      }
      return NextResponse.json(
        { error: `Número de leito inválido: ${numLimpo}. Deve ser entre 1 e ${aloj.total_vagas}.` },
        { status: 400 }
      );
    }

    if (!isNumeroCompativel(numInt, posicaoDesejada)) {
      if (hospedagem.alojamento_id && hospedagem.numero_cama) {
        await supabase
          .from('evento_hospedagem_leitos')
          .update({ ocupado: true, inscricao_id: hospedagem.inscricao_id })
          .eq('evento_id', eventoId)
          .eq('alojamento_id', hospedagem.alojamento_id)
          .eq('numero', hospedagem.numero_cama);
      }
      return NextResponse.json(
        { error: `Inconsistência de paridade: o leito ${numLimpo} não é compatível com a posição ${posicaoDesejada}.` },
        { status: 422 }
      );
    }

    const padSize = String(aloj.total_vagas).length > 2 ? 3 : 3;
    const numFormatado = String(numInt).padStart(padSize, '0');

    // Verifica se já está ocupado por outro participante
    const leitoConflito = (leitosExist ?? []).find(l => {
      const n = parseInt(l.numero, 10);
      return (n === numInt || l.numero === numFormatado || l.numero === numLimpo) && l.ocupado && l.inscricao_id !== hospedagem.inscricao_id;
    });

    if (leitoConflito) {
      if (hospedagem.alojamento_id && hospedagem.numero_cama) {
        await supabase
          .from('evento_hospedagem_leitos')
          .update({ ocupado: true, inscricao_id: hospedagem.inscricao_id })
          .eq('evento_id', eventoId)
          .eq('alojamento_id', hospedagem.alojamento_id)
          .eq('numero', hospedagem.numero_cama);
      }
      return NextResponse.json(
        { error: `O leito ${numFormatado} já está ocupado no alojamento selecionado.` },
        { status: 409 }
      );
    }

    const leitoLivreCorrespondente = (leitosExist ?? []).find(l => {
      const n = parseInt(l.numero, 10);
      return (n === numInt || l.numero === numFormatado || l.numero === numLimpo) && !l.ocupado;
    });

    leitoEscolhido = {
      id: leitoLivreCorrespondente?.id,
      numero: numFormatado,
      posicao: posicaoDesejada,
    };
  }

  // 2.1 Verifica se já existe um leito físico livre no banco compatível com a posição desejada e paridade
  if (!leitoEscolhido) {
    const leitosLivresCompativeis = (leitosExist ?? []).filter(l => {
      if (l.ocupado) return false;
      const n = parseInt(l.numero, 10);
      if (isNaN(n)) return false;
      // Se beliche, valida paridade e posição física real no banco
      if (isAlojamentoBeliche && posicaoDesejada !== 'unico') {
        const posBancoOk = l.posicao === posicaoDesejada;
        const paridadeOk = isNumeroCompativel(n, posicaoDesejada);
        return posBancoOk && paridadeOk;
      }
      return l.posicao === posicaoDesejada || posicaoDesejada === 'unico';
    });

    if (leitosLivresCompativeis.length > 0) {
      // Ordena pelo menor número de leito
      leitosLivresCompativeis.sort((a, b) => (parseInt(a.numero, 10) || 0) - (parseInt(b.numero, 10) || 0));
      const prim = leitosLivresCompativeis[0];
      leitoEscolhido = {
        id: prim.id,
        numero: prim.numero,
        posicao: posicaoDesejada,
      };
    } else {
      // 2.2 Se não há leito livre existente, calcula o próximo número sequencial compatível
      const numerosOcupados = new Set(
        (leitosExist ?? [])
          .filter(l => l.ocupado)
          .map(l => parseInt(l.numero, 10))
          .filter(n => !isNaN(n))
      );

      const startNum = (isAlojamentoBeliche && posicaoDesejada === 'inferior') ? 2 : 1;
      const step = (isAlojamentoBeliche && (posicaoDesejada === 'inferior' || posicaoDesejada === 'superior')) ? 2 : 1;
      let candidateNum: number | null = null;

      for (let n = startNum; n <= aloj.total_vagas; n += step) {
        if (!numerosOcupados.has(n)) {
          if (isNumeroCompativel(n, posicaoDesejada)) {
            candidateNum = n;
            break;
          }
        }
      }

      if (!candidateNum) {
        // Reverte a liberação do leito antigo antes de retornar erro
        if (hospedagem.alojamento_id && hospedagem.numero_cama) {
          await supabase
            .from('evento_hospedagem_leitos')
            .update({ ocupado: true, inscricao_id: hospedagem.inscricao_id })
            .eq('evento_id', eventoId)
            .eq('alojamento_id', hospedagem.alojamento_id)
            .eq('numero', hospedagem.numero_cama);
        }
        return NextResponse.json(
          { error: `Não há leito ${posicaoDesejada} disponível no alojamento selecionado.` },
          { status: 409 }
        );
      }

      const padSize = String(aloj.total_vagas).length > 2 ? 3 : 3;
      const numFormatado = String(candidateNum).padStart(padSize, '0');
      leitoEscolhido = {
        numero: numFormatado,
        posicao: posicaoDesejada,
      };
    }
  }

  const novoNumero = leitoEscolhido.numero;
  const posicao = leitoEscolhido.posicao;

  // 3. Reserva / cadastra o leito no alojamento destino
  if (leitoEscolhido.id) {
    const { error: leitoErr } = await supabase
      .from('evento_hospedagem_leitos')
      .update({
        ocupado: true,
        inscricao_id: hospedagem.inscricao_id,
        posicao,
        tipo_leito: isAlojamentoBeliche ? 'beliche' : 'individual',
      })
      .eq('id', leitoEscolhido.id);

    if (leitoErr) {
      return NextResponse.json({ error: 'Erro ao reservar leito existente: ' + leitoErr.message }, { status: 500 });
    }
  } else {
    const { error: leitoErr } = await supabase
      .from('evento_hospedagem_leitos')
      .upsert(
        [{
          evento_id:     eventoId,
          alojamento_id: novo_alojamento_id,
          inscricao_id:  hospedagem.inscricao_id,
          numero:        novoNumero,
          tipo_leito:    isAlojamentoBeliche ? 'beliche' : 'individual',
          posicao,
          ocupado:       true,
        }],
        { onConflict: 'inscricao_id' },
      );

    if (leitoErr) {
      return NextResponse.json({ error: 'Erro ao criar leito: ' + leitoErr.message }, { status: 500 });
    }
  }

  // 4. Atualiza hospedagem
  const { error } = await supabase
    .from('evento_hospedagens')
    .update({
      alojamento_id:       novo_alojamento_id,
      tipo_cama:           novo_tipo_cama    || null,
      numero_cama:         novoNumero,
      alocacao_automatica: false,
    })
    .eq('id', hospedagem_id)
    .eq('evento_id', eventoId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // 5. Registra ocorrência de realocação (garantindo tipo válido na constraint)
  const tipoOcorrencia = hospedagem.alojamento_id === novo_alojamento_id ? 'mudanca_leito' : 'mudanca_alojamento';
  await supabase
    .from('evento_hospedagem_ocorrencias')
    .insert({
      evento_id:    eventoId,
      hospedagem_id,
      inscricao_id: hospedagem.inscricao_id,
      tipo:         tipoOcorrencia,
      descricao:    motivo?.trim() || `Realocação administrativa de leito (De: ${hospedagem.numero_cama ?? 's/n'} -> Para: ${novoNumero})`,
      operador:     operador?.trim() || null,
    });

  await logDB({
    userId: guard.ctx.user?.id,
    userEmail: guard.ctx.user?.email ?? undefined,
    acao: 'ajuste_manual_hospedagem',
    modulo: 'eventos',
    entidade: 'evento_hospedagens',
    entidadeId: hospedagem_id,
    descricao: '[Hospedagem] Realocacao manual de participante',
    detalhes: {
      evento_id: eventoId,
      inscricao_id: hospedagem.inscricao_id,
      novo_alojamento_id,
      novo_tipo_cama: novo_tipo_cama ?? null,
      novo_numero_cama: novoNumero,
      motivo: motivo ?? null,
    },
    request: req,
  });

  return NextResponse.json({ ok: true, novo_numero_leito: novoNumero });
}
