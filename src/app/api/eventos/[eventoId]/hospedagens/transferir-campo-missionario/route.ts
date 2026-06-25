import { NextRequest, NextResponse } from 'next/server';
import { requireEventoPermission } from '@/lib/evento-guard';
import { logDB } from '@/lib/audit';

/**
 * POST /api/eventos/[eventoId]/hospedagens/transferir-campo-missionario
 * Executa ou exibe a prévia da transferência segura de hospedagem dos inscritos de "CAMPO MISSIONÁRIO".
 * Body: { action: 'preview' | 'execute', operador?: string }
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
  const { action, operador } = body as {
    action?: 'preview' | 'execute';
    operador?: string;
  };

  if (!action || !['preview', 'execute'].includes(action)) {
    return NextResponse.json(
      { error: 'Ação inválida. Use "preview" ou "execute".' },
      { status: 400 },
    );
  }

  // 1. Buscar todos os alojamentos do grupo Pastor Presidente que sejam "Prédio AAME" ou "Prédio NOVO"
  const { data: alojamentos, error: alojError } = await supabase
    .from('evento_alojamentos')
    .select('id, nome, publico, sexo, total_vagas, camas_inferiores, camas_superiores, ativo')
    .eq('evento_id', eventoId)
    .eq('publico', 'presidentes')
    .eq('ativo', true)
    .or('nome.ilike.%AAME%,nome.ilike.%NOVO%');

  if (alojError) {
    return NextResponse.json({ error: `Erro ao buscar alojamentos: ${alojError.message}` }, { status: 500 });
  }

  const alojamentosDestino = alojamentos ?? [];
  const alojamentosDestinoIds = alojamentosDestino.map(a => a.id);

  if (alojamentosDestino.length === 0) {
    return NextResponse.json(
      { error: 'Nenhum alojamento de Pastor Presidente (Prédio AAME ou Prédio NOVO) cadastrado ou ativo.' },
      { status: 404 },
    );
  }

  // 2. Buscar todas as alocações ativas nesses alojamentos de destino para calcular vagas restantes em tempo real
  const { data: hospedagensDestino, error: hospDestError } = await supabase
    .from('evento_hospedagens')
    .select('id, alojamento_id, status, tipo_cama')
    .eq('evento_id', eventoId)
    .in('alojamento_id', alojamentosDestinoIds)
    .in('status', ['confirmada', 'alocada', 'checkin_realizado', 'checkout_realizado']);

  if (hospDestError) {
    return NextResponse.json({ error: `Erro ao calcular ocupação dos destinos: ${hospDestError.message}` }, { status: 500 });
  }

  // Mapa de ocupação por alojamento
  const ocupacaoAloj = new Map<string, { total: number; inferior: number; superior: number }>();
  alojamentosDestino.forEach(a => {
    ocupacaoAloj.set(a.id, { total: 0, inferior: 0, superior: 0 });
  });

  (hospedagensDestino ?? []).forEach(h => {
    if (h.alojamento_id && ocupacaoAloj.has(h.alojamento_id)) {
      const current = ocupacaoAloj.get(h.alojamento_id)!;
      current.total += 1;
      if (h.tipo_cama === 'inferior') current.inferior += 1;
      if (h.tipo_cama === 'superior') current.superior += 1;
    }
  });

  // 3. Buscar os inscritos elegíveis para a transferência
  // Regra: tipo_inscricao contém "CAMPO MISSIONÁRIO", status_pagamento em (pago, isento), hospedagem = true,
  // e atualmente alocado em um alojamento cujo público NÃO é "presidentes" (ou seja, alojamento_id é diferente dos destinos ou público != presidentes)
  
  // Como as inscrições e hospedagens estão em tabelas separadas, vamos ler as inscrições elegíveis
  let inscricoesElegiveis: any[] = [];
  let insFrom = 0;
  const limit = 1000;
  let insHasMore = true;

  while (insHasMore) {
    const { data: pageData, error: insErr } = await supabase
      .from('evento_inscricoes')
      .select(`
        id, nome_inscrito, cpf, sexo, data_nascimento, tipo_inscricao, status_pagamento,
        hosp_necessidade_especial, hosp_cama_inferior, hosp_possui_comorbidade
      `)
      .eq('evento_id', eventoId)
      .eq('hospedagem', true)
      .in('status_pagamento', ['pago', 'isento'])
      .range(insFrom, insFrom + limit - 1);

    if (insErr) {
      return NextResponse.json({ error: `Erro ao ler inscrições: ${insErr.message}` }, { status: 500 });
    }

    if (pageData && pageData.length > 0) {
      // Filtrar em memória por "CAMPO MISSIONÁRIO"
      const filtradas = pageData.filter(insc => {
        const cat = (insc.tipo_inscricao ?? '').toLowerCase();
        return cat.includes('campo missionario') || cat.includes('campo missionário');
      });
      inscricoesElegiveis = [...inscricoesElegiveis, ...filtradas];
      
      if (pageData.length < limit) insHasMore = false;
      else insFrom += limit;
    } else {
      insHasMore = false;
    }
  }

  if (inscricoesElegiveis.length === 0) {
    return NextResponse.json({
      action,
      totalEncontrados: 0,
      candidatos: [],
      alojamentosDestino: alojamentosDestino.map(a => {
        const ocup = ocupacaoAloj.get(a.id) || { total: 0, inferior: 0, superior: 0 };
        return {
          id: a.id,
          nome: a.nome,
          total_vagas: a.total_vagas,
          vagas_livres: Math.max(0, a.total_vagas - ocup.total),
        };
      }),
      transferidos: [],
      semVaga: [],
      erros: [],
      leitosLiberados: 0,
    });
  }

  const inscricaoIds = inscricoesElegiveis.map(i => i.id);

  // Buscar alocações atuais dessas inscrições
  const { data: alocaçõesAtuais, error: alocError } = await supabase
    .from('evento_hospedagens')
    .select(`
      id, inscricao_id, alojamento_id, tipo_cama, numero_cama, status,
      evento_alojamentos ( id, nome, publico )
    `)
    .eq('evento_id', eventoId)
    .in('inscricao_id', inscricaoIds);

  if (alocError) {
    return NextResponse.json({ error: `Erro ao buscar alocações atuais: ${alocError.message}` }, { status: 500 });
  }

  // Filtrar apenas quem está alocado incorretamente (ou seja, alojamento_id cadastrado, mas público != 'presidentes')
  const candidatosTransferencia: any[] = [];
  (alocaçõesAtuais ?? []).forEach(aloc => {
    const insc = inscricoesElegiveis.find(i => i.id === aloc.inscricao_id);
    if (!insc) return;

    const alojAtual = aloc.evento_alojamentos as any;
    const publicoAtual = alojAtual?.publico ?? '';

    // Só transferir se estiver alocado em algo que não seja "presidentes"
    if (aloc.alojamento_id && publicoAtual !== 'presidentes') {
      candidatosTransferencia.push({
        inscricao: insc,
        alocacao: aloc,
        alojamentoAtualNome: alojAtual?.nome ?? 'Desconhecido',
        alojamentoAtualId: aloc.alojamento_id,
        tipoCamaAtual: aloc.tipo_cama,
        numeroCamaAtual: aloc.numero_cama,
      });
    }
  });

  // Se for apenas prévia, simular e responder
  if (action === 'preview') {
    const previewCandidatos = candidatosTransferencia.map(c => {
      // Tenta achar um alojamento de destino com vaga livre do mesmo sexo
      const sexoInsc = (c.inscricao.sexo ?? '').toUpperCase();
      const alojCompativel = alojamentosDestino.find(a => {
        // Verifica sexo
        if (a.sexo && a.sexo !== sexoInsc) return false;
        // Verifica se tem vaga livre na simulação
        const ocup = ocupacaoAloj.get(a.id)!;
        const vagasLivres = a.total_vagas - ocup.total;
        return vagasLivres > 0;
      });

      // Se achou, simula a ocupação para o próximo candidato não pegar a mesma vaga se estiver escasso
      if (alojCompativel) {
        const ocup = ocupacaoAloj.get(alojCompativel.id)!;
        ocup.total += 1;
      }

      return {
        inscricao_id: c.inscricao.id,
        nome_inscrito: c.inscricao.nome_inscrito,
        sexo: c.inscricao.sexo,
        tipo_inscricao: c.inscricao.tipo_inscricao,
        alojamento_atual_nome: c.alojamentoAtualNome,
        alojamento_destino_provavel: alojCompativel ? alojCompativel.nome : 'Sem vaga disponível',
        alojamento_destino_provavel_id: alojCompativel ? alojCompativel.id : null,
      };
    });

    // Resetar ocupação para mostrar as vagas livres reais atuais na resposta
    const totalAlojamentosComVagas = alojamentosDestino.map(a => {
      // Recalcula ocupação real (sem a simulação cumulativa)
      const realOcup = (hospedagensDestino ?? []).filter(h => h.alojamento_id === a.id).length;
      return {
        id: a.id,
        nome: a.nome,
        total_vagas: a.total_vagas,
        vagas_livres: Math.max(0, a.total_vagas - realOcup),
      };
    });

    return NextResponse.json({
      action,
      totalEncontrados: candidatosTransferencia.length,
      candidatos: previewCandidatos,
      alojamentosDestino: totalAlojamentosComVagas,
    });
  }

  // --- MODO EXECUÇÃO ---
  // Executar de forma ultra segura e transacional item por item
  const transferidos: any[] = [];
  const semVaga: any[] = [];
  const erros: any[] = [];
  let leitosLiberadosContador = 0;

  for (const cand of candidatosTransferencia) {
    const insc = cand.inscricao;
    const aloc = cand.alocacao;
    const sexoInsc = (insc.sexo ?? '').toUpperCase();

    // Encontrar alojamento destino compatível com vaga livre em tempo real
    let alojDestinoEscolhido: typeof alojamentosDestino[0] | null = null;
    for (const a of alojamentosDestino) {
      if (a.sexo && a.sexo !== sexoInsc) continue;
      
      const ocup = ocupacaoAloj.get(a.id)!;
      if (a.total_vagas - ocup.total > 0) {
        alojDestinoEscolhido = a;
        break;
      }
    }

    if (!alojDestinoEscolhido) {
      // Marcar como necessita_transferencia ou apenas registrar que ficou sem vaga
      // Conforme regra 5: "Não remover a alocação antiga automaticamente, marcar como necessita_transferencia ou retornar erro"
      // Vamos adicionar observação na hospedagem marcando a necessidade
      const obsAtual = aloc.observacoes ? `${aloc.observacoes} | ` : '';
      await supabase
        .from('evento_hospedagens')
        .update({
          observacoes: `${obsAtual}NECESSITA_TRANSFERENCIA: Sem vaga no grupo Pastor Presidente.`,
        })
        .eq('id', aloc.id);

      semVaga.push({
        inscricao_id: insc.id,
        nome_inscrito: insc.nome_inscrito,
        motivo: 'Sem vaga disponível no grupo Pastor Presidente (Prédio AAME / NOVO).',
      });
      continue;
    }

    try {
      const novoAlojamentoId = alojDestinoEscolhido.id;

      // 1. Liberar o leito antigo de forma correta
      if (cand.alojamentoAtualId) {
        const { error: releaseErr } = await supabase
          .from('evento_hospedagem_leitos')
          .update({ ocupado: false, inscricao_id: null })
          .eq('evento_id', eventoId)
          .eq('inscricao_id', insc.id);

        if (releaseErr) throw new Error(`Erro ao liberar leito antigo: ${releaseErr.message}`);
        leitosLiberadosContador++;
      }

      // 2. Calcular número sequencial no novo alojamento
      const { data: leitosExist, error: leitosErr } = await supabase
        .from('evento_hospedagem_leitos')
        .select('numero')
        .eq('evento_id', eventoId)
        .eq('alojamento_id', novoAlojamentoId);

      if (leitosErr) throw new Error(`Erro ao listar leitos existentes: ${leitosErr.message}`);

      const maxNum = Math.max(0, ...((leitosExist ?? []).map(l => parseInt(l.numero) || 0)));
      const novoNumero = String(maxNum + 1);

      // Decidir posição da cama
      const precisaCamaInferior = insc.hosp_cama_inferior || insc.hosp_necessidade_especial;
      const posicao: 'inferior' | 'superior' | 'unico' = precisaCamaInferior ? 'inferior' : 'superior';

      // 3. Criar/atribuir o novo leito no alojamento correto
      const { error: upsertLeitoErr } = await supabase
        .from('evento_hospedagem_leitos')
        .upsert(
          [{
            evento_id:     eventoId,
            alojamento_id: novoAlojamentoId,
            inscricao_id:  insc.id,
            numero:        novoNumero,
            tipo_leito:    'beliche',
            posicao,
            ocupado:       true,
          }],
          { onConflict: 'inscricao_id' },
        );

      if (upsertLeitoErr) throw new Error(`Erro ao ocupar novo leito: ${upsertLeitoErr.message}`);

      // 4. Atualizar o registro do evento_hospedagens
      const { error: updateHospErr } = await supabase
        .from('evento_hospedagens')
        .update({
          alojamento_id:       novoAlojamentoId,
          tipo_cama:           posicao,
          numero_cama:         novoNumero,
          alocacao_automatica: false,
          status:              'alocada',
          grupo_hospedagem:    'Pastor Presidente / Pastor Jubilado',
        })
        .eq('id', aloc.id)
        .eq('evento_id', eventoId);

      if (updateHospErr) throw new Error(`Erro ao atualizar dados de hospedagem: ${updateHospErr.message}`);

      // 5. Registrar logs e auditoria da transferência
      await supabase
        .from('evento_hospedagem_ocorrencias')
        .insert({
          evento_id:    eventoId,
          hospedagem_id: aloc.id,
          inscricao_id: insc.id,
          tipo:         'mudanca_alojamento',
          descricao:    `Transferência segura automática de Campo Missionário alocado incorretamente. De: ${cand.alojamentoAtualNome} (Leito: ${cand.numeroCamaAtual || '?'}) -> Para: ${alojDestinoEscolhido.nome} (Leito: ${novoNumero}).`,
          operador:     operador?.trim() || 'Sistema (Rotina Automática)',
        });

      await logDB({
        userId: guard.ctx.user?.id,
        userEmail: guard.ctx.user?.email ?? undefined,
        acao: 'ajuste_manual_hospedagem',
        modulo: 'eventos',
        entidade: 'evento_hospedagens',
        entidadeId: aloc.id,
        descricao: '[Hospedagem] Transferência segura automática de Campo Missionário',
        detalhes: {
          evento_id: eventoId,
          inscricao_id: insc.id,
          de_alojamento: cand.alojamentoAtualNome,
          para_alojamento: alojDestinoEscolhido.nome,
          novo_leito: novoNumero,
        },
        request: req,
      });

      // Atualizar ocupação em memória para o próximo loop
      const ocup = ocupacaoAloj.get(novoAlojamentoId)!;
      ocup.total += 1;

      transferidos.push({
        inscricao_id: insc.id,
        nome_inscrito: insc.nome_inscrito,
        de_alojamento: cand.alojamentoAtualNome,
        para_alojamento: alojDestinoEscolhido.nome,
        leito: novoNumero,
      });

    } catch (e: any) {
      erros.push({
        inscricao_id: insc.id,
        nome_inscrito: insc.nome_inscrito,
        erro: e.message || 'Erro desconhecido',
      });
    }
  }

  return NextResponse.json({
    action,
    transferidos,
    semVaga,
    erros,
    leitosLiberados: leitosLiberadosContador,
  });
}
