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
// Cria ou substitui os 3 tipos de inscrição de um evento (admin)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;
  const guard = await requireEventoPermission(request, eventoId, 'configuracoes');
  if (!guard.ok) return guard.response;
  const body  = await request.json();
  const tipos = body?.tipos as Array<{
    id?: string;
    nome: string;
    valor: number;
    inclui_alimentacao: boolean;
    inclui_hospedagem: boolean;
    cortesia: boolean;
    limite_vagas: number | null;
    quantidade_refeicoes: number;
    administrativo: boolean;
    ativo: boolean;
    ordem: number;
  }>;

  if (!Array.isArray(tipos) || tipos.length === 0) {
    return NextResponse.json({ error: 'Nenhum tipo informado.' }, { status: 400 });
  }

  const supabase = guard.ctx.supabaseAdmin;

  // Busca o departamento do evento para checar se é AGO
  const { data: evento, error: eventoError } = await supabase
    .from('eventos')
    .select('departamento')
    .eq('id', eventoId)
    .single();

  if (eventoError) {
    return NextResponse.json({ error: 'Evento não encontrado.' }, { status: 404 });
  }
  const isAGO = evento?.departamento === 'AGO';

  // Valida quantidade_refeicoes apenas para eventos AGO quando inclui_alimentacao = true
  if (isAGO) {
    for (const t of tipos) {
      if (!t.administrativo && t.inclui_alimentacao && !(t.quantidade_refeicoes > 0)) {
        return NextResponse.json(
          { error: `Tipo "${t.nome}": informe a quantidade de refeicoes (> 0) quando alimentacao esta marcada.` },
          { status: 400 }
        );
      }
    }
  }

  // Apenas faz UPDATE por ID para os tipos existentes passados no payload
  for (const t of tipos) {
    if (t.id) {
      const { error: updateError } = await supabase
        .from('evento_tipos_inscricao')
        .update({
          nome:                 normalizeUppercase(String(t.nome || '')),
          valor:                t.cortesia ? 0 : (t.valor ?? 0),
          inclui_alimentacao:   t.inclui_alimentacao,
          inclui_hospedagem:    t.inclui_hospedagem,
          cortesia:             t.cortesia ?? false,
          limite_vagas:         t.limite_vagas ?? null,
          quantidade_refeicoes: t.inclui_alimentacao ? (t.quantidade_refeicoes ?? 0) : 0,
          ativo:                t.ativo,
        })
        .eq('id', t.id);

      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 500 });
      }
    }
  }

  return NextResponse.json({ sucesso: true });
}

