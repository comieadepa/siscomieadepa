import { NextRequest, NextResponse } from 'next/server';
import { requireEventoPermission } from '@/lib/evento-guard';
import { logDB } from '@/lib/audit';

/**
 * POST /api/eventos/[eventoId]/hospedagens/emergencial/leitos
 * Acrescenta leitos emergenciais a um alojamento existente.
 * Numeração automática com prefixo emergencial ('E' ou derivado) sem colidir com leitos existentes.
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
    alojamento_id,
    camas_inferiores = 0,
    camas_superiores = 0,
    colchonetes = 0,
    prefixo_leito = 'E',
  } = body;

  if (!alojamento_id) {
    return NextResponse.json({ error: 'alojamento_id é obrigatório.' }, { status: 400 });
  }

  const numInf = Math.max(0, parseInt(String(camas_inferiores), 10) || 0);
  const numSup = Math.max(0, parseInt(String(camas_superiores), 10) || 0);
  const numColch = Math.max(0, parseInt(String(colchonetes), 10) || 0);
  const totalNovosLeitos = numInf + numSup + numColch;

  if (totalNovosLeitos <= 0) {
    return NextResponse.json({ error: 'Informe ao menos 1 leito para adicionar.' }, { status: 400 });
  }

  // 1. Busca alojamento
  const { data: aloj, error: errAloj } = await supabase
    .from('evento_alojamentos')
    .select('id, nome, total_vagas, camas_inferiores, camas_superiores, colchonetes')
    .eq('id', alojamento_id)
    .eq('evento_id', eventoId)
    .single();

  if (errAloj || !aloj) {
    return NextResponse.json({ error: 'Alojamento não encontrado.' }, { status: 404 });
  }

  const prefixo = (prefixo_leito || 'E').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

  try {
    // 2. Busca todos os números de leitos já cadastrados no evento para evitar qualquer colisão
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
        alojamento_id,
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
        alojamento_id,
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
        alojamento_id,
        numero: gerarProximoNumero(),
        tipo_leito: 'colchonete',
        posicao: 'colchonete',
        ocupado: false,
        inscricao_id: null,
      });
    }

    // 3. Inserir leitos novos
    const leitosComEmergencial = leitosParaInserir.map(l => ({ ...l, is_emergencial: true }));
    const { error: errInsertLeitos } = await supabase
      .from('evento_hospedagem_leitos')
      .insert(leitosComEmergencial);

    if (errInsertLeitos) {
      if (errInsertLeitos.message?.includes('is_emergencial')) {
        // Fallback sem a coluna is_emergencial
        const { error: errFallback } = await supabase
          .from('evento_hospedagem_leitos')
          .insert(leitosParaInserir);

        if (errFallback) {
          throw new Error(`Falha ao inserir novos leitos: ${errFallback.message}`);
        }
      } else {
        throw new Error(`Falha ao inserir novos leitos: ${errInsertLeitos.message}`);
      }
    }

    // 4. Registrar auditoria detalhada
    await logDB({
      userId: guard.ctx.user?.id,
      userEmail: guard.ctx.user?.email ?? undefined,
      acao: 'adicionar_leitos_emergenciais',
      modulo: 'hospedagem',
      entidade: 'evento_hospedagem_leitos',
      entidadeId: alojamento_id,
      descricao: `[Emergencial] Adicionados ${totalNovosLeitos} leitos emergenciais ao alojamento "${aloj.nome}" (Inf: ${numInf}, Sup: ${numSup}, Colch: ${numColch}).`,
      detalhes: {
        alojamento_id,
        alojamento_nome: aloj.nome,
        total_adicionados: totalNovosLeitos,
        camas_inferiores: numInf,
        camas_superiores: numSup,
        colchonetes: numColch,
        prefixo,
        operador: guard.ctx.user?.email ?? 'coordenacao',
      },
      request,
    });

    return NextResponse.json({
      ok: true,
      alojamento_id,
      alojamento_nome: aloj.nome,
      adicionados: totalNovosLeitos,
      numeros_gerados: leitosParaInserir.map(l => l.numero),
      mensagem: `${totalNovosLeitos} leitos emergenciais adicionados com sucesso ao ${aloj.nome}!`,
    });
  } catch (error: any) {
    console.error('[Emergencial] Erro ao adicionar leitos emergenciais:', error);
    return NextResponse.json({ error: error.message || 'Erro interno ao adicionar leitos.' }, { status: 500 });
  }
}
