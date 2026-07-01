import { NextRequest, NextResponse } from 'next/server';
import { requireEventoPermission } from '@/lib/evento-guard';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;
  const guard = await requireEventoPermission(request, eventoId, 'relatorios_ago');
  if (!guard.ok) return guard.response;

  const supabase = guard.ctx.supabaseAdmin;

  try {
    const body = await request.json();
    const {
      inscricao_id,
      ministro_id,
      nome_ministro,
      matricula,
      cpf,
      status_frequencia,
      percentual_presenca,
      dias_presentes,
      dias_ausentes,
      motivo,
      texto_final,
      dias_detalhes,
    } = body;

    if (!inscricao_id) {
      return NextResponse.json(
        { error: 'Não é possível salvar rascunho de carta para ministro não inscrito no evento.' },
        { status: 400 }
      );
    }

    // 1. Verificar duplicidade: se já existe um rascunho para este evento + ministro
    let query = supabase
      .from('ago_cartas_advertencia')
      .select('id, status')
      .eq('evento_id', eventoId)
      .eq('inscricao_id', inscricao_id)
      .eq('status', 'rascunho');

    const { data: existente, error: queryErr } = await query.maybeSingle();

    if (queryErr) {
      return NextResponse.json({ error: queryErr.message }, { status: 500 });
    }

    // Serializar todos os metadados solicitados e o texto da carta no campo texto_final
    const payloadMetadata = {
      nome_ministro,
      matricula,
      cpf,
      status_frequencia,
      percentual_presenca,
      dias_presentes,
      dias_ausentes,
      dias_detalhes,
    };

    // Salvamos a carta formatada e inserimos os metadados JSON estruturados no final do campo texto_final
    const textoComMetadata = `${texto_final.trim()}\n\n---METADADOS_CARTA---\n${JSON.stringify(payloadMetadata)}`;

    if (existente) {
      // Atualizar rascunho existente
      const { data: atualizada, error: updateErr } = await supabase
        .from('ago_cartas_advertencia')
        .update({
          ministro_id: ministro_id || null,
          motivo: (motivo || '').trim(),
          texto_final: textoComMetadata,
          created_at: new Date().toISOString(),
        })
        .eq('id', existente.id)
        .select('id, status')
        .single();

      if (updateErr) {
        return NextResponse.json({ error: updateErr.message }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        message: 'Rascunho atualizado com sucesso.',
        carta: atualizada,
        atualizada: true,
      });
    } else {
      // Inserir novo rascunho
      const { data: nova, error: insertErr } = await supabase
        .from('ago_cartas_advertencia')
        .insert([{
          evento_id: eventoId,
          inscricao_id,
          ministro_id: ministro_id || null,
          motivo: (motivo || '').trim(),
          texto_final: textoComMetadata,
          status: 'rascunho',
        }])
        .select('id, status')
        .single();

      if (insertErr) {
        return NextResponse.json({ error: insertErr.message }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        message: 'Rascunho criado com sucesso.',
        carta: nova,
        atualizada: false,
      }, { status: 201 });
    }

  } catch (error: any) {
    console.error('Erro ao salvar rascunho de carta:', error);
    return NextResponse.json({ error: error?.message || 'Erro interno do servidor.' }, { status: 500 });
  }
}
