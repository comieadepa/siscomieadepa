import { NextRequest, NextResponse } from 'next/server';
import { requireEventoPermission } from '@/lib/evento-guard';
import { logDB } from '@/lib/audit';

/**
 * POST /api/eventos/[eventoId]/hospedagens/emergencial/alojamento
 * Cria um Alojamento Emergencial exclusivo para contingência administrativa na 126ª AGO.
 * Permissão: 'hospedagem' (exclusivo coordenador/admin)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;
  const guard = await requireEventoPermission(request, eventoId, 'hospedagem');
  if (!guard.ok) return guard.response;

  const supabase = guard.ctx.supabaseAdmin;
  const body = await request.json().catch(() => ({}));
  const {
    nome,
    sexo,
    publico,
    camas_inferiores = 0,
    camas_superiores = 0,
    colchonetes = 0,
    prefixo_leito = 'E',
  } = body;

  const nomeTrim = (nome || '').trim();
  if (!nomeTrim) {
    return NextResponse.json({ error: 'O nome do alojamento emergencial é obrigatório.' }, { status: 400 });
  }

  const numInf = Math.max(0, parseInt(String(camas_inferiores), 10) || 0);
  const numSup = Math.max(0, parseInt(String(camas_superiores), 10) || 0);
  const numColch = Math.max(0, parseInt(String(colchonetes), 10) || 0);
  const totalVagas = numInf + numSup + numColch;

  if (totalVagas <= 0) {
    return NextResponse.json({ error: 'Informe ao menos 1 leito ou colchonete para o alojamento emergencial.' }, { status: 400 });
  }

  const publicoTrim = (publico || 'CONTINGÊNCIA ADMINISTRATIVA').trim();
  const sexoVal = sexo === 'F' ? 'F' : sexo === 'M' ? 'M' : 'MISTO';
  const prefixo = (prefixo_leito || 'E').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

  try {
    // 1. Criar registro do alojamento emergencial
    // Para manter compatibilidade retroativa total com ou sem a coluna is_emergencial no banco:
    const payloadAloj: any = {
      evento_id: eventoId,
      nome: `[EMERGENCIAL] ${nomeTrim.replace(/^\[EMERGENCIAL\]\s*/i, '')}`.toUpperCase(),
      publico: publicoTrim.toUpperCase(),
      sexo: sexoVal,
      total_vagas: totalVagas,
      camas_inferiores: numInf,
      camas_superiores: numSup,
      colchonetes: numColch,
      ativo: true,
      origem: 'emergencial',
    };

    // Tenta com is_emergencial se a coluna existir, senão prossegue sem quebrar
    let alojId: string | null = null;
    const { data: alojCriado, error: errAloj } = await supabase
      .from('evento_alojamentos')
      .insert({ ...payloadAloj, is_emergencial: true })
      .select()
      .single();

    if (errAloj) {
      // Se falhou por ausência de coluna is_emergencial, insere sem ela
      if (errAloj.message?.includes('is_emergencial')) {
        const { data: alojFallback, error: errFallback } = await supabase
          .from('evento_alojamentos')
          .insert(payloadAloj)
          .select()
          .single();

        if (errFallback) {
          throw new Error(`Falha ao registrar alojamento emergencial: ${errFallback.message}`);
        }
        alojId = alojFallback.id;
      } else {
        throw new Error(`Falha ao registrar alojamento emergencial: ${errAloj.message}`);
      }
    } else {
      alojId = alojCriado.id;
    }

    if (!alojId) throw new Error('ID do alojamento emergencial não gerado.');

    // 2. Gerar leitos sem duplicidade de numeração
    // Busca numerações já existentes no evento para este prefixo
    const { data: leitosExistentes } = await supabase
      .from('evento_hospedagem_leitos')
      .select('numero')
      .eq('evento_id', eventoId);

    const numerosUsados = new Set<string>((leitosExistentes || []).map((l: any) => String(l.numero).toUpperCase()));

    const leitosParaInserir: any[] = [];
    let contadorSeq = 1;

    function gerarProximoNumero(): string {
      while (true) {
        const numFormatado = `${prefixo}${String(contadorSeq).padStart(3, '0')}`;
        contadorSeq++;
        if (!numerosUsados.has(numFormatado)) {
          numerosUsados.add(numFormatado);
          return numFormatado;
        }
      }
    }

    // Camas inferiores
    for (let i = 0; i < numInf; i++) {
      leitosParaInserir.push({
        evento_id: eventoId,
        alojamento_id: alojId,
        numero: gerarProximoNumero(),
        tipo_leito: 'beliche',
        posicao: 'inferior',
        ocupado: false,
        inscricao_id: null,
      });
    }

    // Camas superiores
    for (let i = 0; i < numSup; i++) {
      leitosParaInserir.push({
        evento_id: eventoId,
        alojamento_id: alojId,
        numero: gerarProximoNumero(),
        tipo_leito: 'beliche',
        posicao: 'superior',
        ocupado: false,
        inscricao_id: null,
      });
    }

    // Colchonetes
    for (let i = 0; i < numColch; i++) {
      leitosParaInserir.push({
        evento_id: eventoId,
        alojamento_id: alojId,
        numero: gerarProximoNumero(),
        tipo_leito: 'colchonete',
        posicao: 'colchonete',
        ocupado: false,
        inscricao_id: null,
      });
    }

    // Inserir leitos em lotes
    if (leitosParaInserir.length > 0) {
      // Tenta primeiro com is_emergencial: true
      const leitosComEmergencial = leitosParaInserir.map(l => ({ ...l, is_emergencial: true }));
      const { error: errLeitos } = await supabase
        .from('evento_hospedagem_leitos')
        .insert(leitosComEmergencial);

      if (errLeitos) {
        if (errLeitos.message?.includes('is_emergencial')) {
          // Fallback sem a coluna is_emergencial
          const { error: errFallbackLeitos } = await supabase
            .from('evento_hospedagem_leitos')
            .insert(leitosParaInserir);

          if (errFallbackLeitos) {
            throw new Error(`Falha ao gerar leitos do alojamento emergencial: ${errFallbackLeitos.message}`);
          }
        } else {
          throw new Error(`Falha ao gerar leitos do alojamento emergencial: ${errLeitos.message}`);
        }
      }
    }

    // 3. Registrar auditoria detalhada
    await logDB({
      userId: guard.ctx.user?.id,
      userEmail: guard.ctx.user?.email ?? undefined,
      acao: 'criar_alojamento_emergencial',
      modulo: 'hospedagem',
      entidade: 'evento_alojamentos',
      entidadeId: alojId,
      descricao: `[Emergencial] Alojamento emergencial "${payloadAloj.nome}" criado com ${totalVagas} leitos (Inf: ${numInf}, Sup: ${numSup}, Colch: ${numColch}).`,
      detalhes: {
        alojamento_id: alojId,
        nome: payloadAloj.nome,
        total_vagas: totalVagas,
        camas_inferiores: numInf,
        camas_superiores: numSup,
        colchonetes: numColch,
        prefixo,
        leitos_criados: leitosParaInserir.length,
        operador: guard.ctx.user?.email ?? 'coordenacao',
      },
      request,
    });

    return NextResponse.json({
      ok: true,
      alojamento_id: alojId,
      nome: payloadAloj.nome,
      total_vagas: totalVagas,
      leitos_criados: leitosParaInserir.length,
      mensagem: `Alojamento Emergencial criado com sucesso com ${leitosParaInserir.length} leitos!`,
    });
  } catch (error: any) {
    console.error('[Emergencial] Erro ao criar alojamento emergencial:', error);
    return NextResponse.json({ error: error.message || 'Erro interno ao criar alojamento emergencial.' }, { status: 500 });
  }
}
