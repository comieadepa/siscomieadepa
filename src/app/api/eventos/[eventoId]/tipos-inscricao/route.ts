import { NextRequest, NextResponse } from 'next/server';
import { requireEventoPermission } from '@/lib/evento-guard';
import { normalizeUppercase } from '@/lib/text';

// GET /api/eventos/[eventoId]/tipos-inscricao
// Lista os tipos de inscrição ativos de um evento (público)
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;
  const guard = await requireEventoPermission(_req, eventoId, 'configuracoes');
  if (!guard.ok) return guard.response;
  const supabase = guard.ctx.supabaseAdmin;
  const { data, error } = await supabase
    .from('evento_tipos_inscricao')
    .select('id, nome, valor, inclui_alimentacao, inclui_hospedagem, cortesia, limite_vagas, quantidade_refeicoes, ordem, administrativo')
    .eq('evento_id', eventoId)
    .eq('ativo', true)
    .order('ordem');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ tipos: data ?? [] });
}

// POST /api/eventos/[eventoId]/tipos-inscricao
// Cria ou atualiza os tipos de inscrição de um evento (admin)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;
  const guard = await requireEventoPermission(request, eventoId, 'configuracoes');
  if (!guard.ok) return guard.response;
  const body  = await request.json().catch(() => null);
  const tipos = body?.tipos as Array<{
    id?: string;
    nome: string;
    valor: number;
    inclui_alimentacao: boolean;
    inclui_hospedagem: boolean;
    cortesia?: boolean;
    limite_vagas?: number | null;
    quantidade_refeicoes?: number;
    administrativo?: boolean;
    ativo?: boolean;
    ordem?: number;
  }>;

  if (!Array.isArray(tipos) || tipos.length === 0) {
    return NextResponse.json({ error: 'Nenhum tipo informado.' }, { status: 400 });
  }

  const supabase = guard.ctx.supabaseAdmin;

  // Busca o departamento do evento para checar se é AGO
  const { data: evento, error: eventoError } = await supabase
    .from('eventos')
    .select('id, departamento')
    .eq('id', eventoId)
    .single();

  if (eventoError || !evento) {
    return NextResponse.json({ error: 'Evento não encontrado.' }, { status: 404 });
  }
  const isAGO = evento?.departamento === 'AGO';

  // Validação preliminar do payload (nomes não-vazios, unicidade no payload e regras de refeição AGO)
  const seenNames = new Set<string>();
  for (const t of tipos) {
    const nomeNorm = normalizeUppercase(String(t.nome || '').trim());
    if (!nomeNorm) {
      return NextResponse.json(
        { error: 'O nome do tipo de inscrição é obrigatório.' },
        { status: 400 }
      );
    }
    if (seenNames.has(nomeNorm)) {
      return NextResponse.json(
        { error: `Tipo de inscrição duplicado no envio: "${t.nome}". Cada tipo deve ter um nome único.` },
        { status: 400 }
      );
    }
    seenNames.add(nomeNorm);

    // Valida quantidade_refeicoes apenas para eventos AGO quando inclui_alimentacao = true
    if (isAGO) {
      if (!t.administrativo && t.inclui_alimentacao && !(t.quantidade_refeicoes && t.quantidade_refeicoes > 0)) {
        return NextResponse.json(
          { error: `Tipo "${t.nome}": informe a quantidade de refeicoes (> 0) quando alimentacao esta marcada.` },
          { status: 400 }
        );
      }
    }
  }

  // Busca tipos já existentes vinculados a este evento para validar tenant e reuso seguro por nome
  const { data: existingTipos, error: existingError } = await supabase
    .from('evento_tipos_inscricao')
    .select('id, nome')
    .eq('evento_id', eventoId);

  if (existingError) {
    return NextResponse.json({ error: `Erro ao consultar tipos existentes: ${existingError.message}` }, { status: 500 });
  }

  const existingMapById = new Map<string, { id: string; nome: string }>();
  const existingMapByName = new Map<string, { id: string; nome: string }>();
  for (const item of (existingTipos || [])) {
    existingMapById.set(item.id, item);
    existingMapByName.set(normalizeUppercase(item.nome || ''), item);
  }

  // Valida que nenhum ID enviado pertença a outro evento (isolamento de tenant)
  for (const t of tipos) {
    if (t.id && !existingMapById.has(t.id)) {
      return NextResponse.json(
        { error: `Tipo de inscrição com ID "${t.id}" não pertence a este evento.` },
        { status: 400 }
      );
    }
  }

  let inseridos = 0;
  let atualizados = 0;

  for (let i = 0; i < tipos.length; i++) {
    const t = tipos[i];
    const nomeNorm = normalizeUppercase(String(t.nome || '').trim());
    const valor = t.cortesia ? 0 : Math.max(0, Number(t.valor) || 0);
    const incluiAlim = !!t.inclui_alimentacao;
    const incluiHosp = !!t.inclui_hospedagem;
    const cortesia = !!t.cortesia;
    const limiteVagas = (t.limite_vagas !== undefined && t.limite_vagas !== null) ? Number(t.limite_vagas) : null;
    const qtdRefeicoes = incluiAlim ? (Number(t.quantidade_refeicoes) || 0) : 0;
    const administrativo = !!t.administrativo;
    const ativo = t.ativo !== false;
    const ordem = (t.ordem !== undefined && t.ordem !== null) ? Number(t.ordem) : (i + 1);

    // Se possui ID válido para este evento -> UPDATE
    if (t.id && existingMapById.has(t.id)) {
      const { error: updateError } = await supabase
        .from('evento_tipos_inscricao')
        .update({
          nome:                 nomeNorm,
          valor:                valor,
          inclui_alimentacao:   incluiAlim,
          inclui_hospedagem:    incluiHosp,
          cortesia:             cortesia,
          limite_vagas:         limiteVagas,
          quantidade_refeicoes: qtdRefeicoes,
          administrativo:       administrativo,
          ativo:                ativo,
          ordem:                ordem,
        })
        .eq('id', t.id)
        .eq('evento_id', eventoId);

      if (updateError) {
        return NextResponse.json({ error: `Erro ao atualizar tipo "${t.nome}": ${updateError.message}` }, { status: 500 });
      }
      atualizados++;
    } else {
      // Se não enviou ID mas já existe tipo com o mesmo nome para o evento -> UPDATE
      const matchByName = existingMapByName.get(nomeNorm);
      if (matchByName) {
        const { error: updateError } = await supabase
          .from('evento_tipos_inscricao')
          .update({
            nome:                 nomeNorm,
            valor:                valor,
            inclui_alimentacao:   incluiAlim,
            inclui_hospedagem:    incluiHosp,
            cortesia:             cortesia,
            limite_vagas:         limiteVagas,
            quantidade_refeicoes: qtdRefeicoes,
            administrativo:       administrativo,
            ativo:                ativo,
            ordem:                ordem,
          })
          .eq('id', matchByName.id)
          .eq('evento_id', eventoId);

        if (updateError) {
          return NextResponse.json({ error: `Erro ao atualizar tipo "${t.nome}": ${updateError.message}` }, { status: 500 });
        }
        atualizados++;
      } else {
        // Novo registro -> INSERT seguro
        const { error: insertError } = await supabase
          .from('evento_tipos_inscricao')
          .insert({
            evento_id:            eventoId,
            nome:                 nomeNorm,
            valor:                valor,
            inclui_alimentacao:   incluiAlim,
            inclui_hospedagem:    incluiHosp,
            cortesia:             cortesia,
            limite_vagas:         limiteVagas,
            quantidade_refeicoes: qtdRefeicoes,
            administrativo:       administrativo,
            ativo:                ativo,
            ordem:                ordem,
          });

        if (insertError) {
          return NextResponse.json({ error: `Erro ao inserir tipo "${t.nome}": ${insertError.message}` }, { status: 500 });
        }
        inseridos++;
      }
    }
  }

  if (inseridos === 0 && atualizados === 0) {
    return NextResponse.json({ error: 'Nenhum tipo de inscrição foi persistido.' }, { status: 400 });
  }

  return NextResponse.json({
    sucesso: true,
    inseridos,
    atualizados,
    total: inseridos + atualizados,
  });
}

