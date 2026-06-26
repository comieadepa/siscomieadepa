import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';

export async function GET() {
  try {
    const supabase = createServerClient();

    console.log('=== INICIANDO SINCRO DE HOSPEDAGENS COM LEITOS ===');

    // 1. Encontrar o evento UMADESPA
    const { data: eventos, error: errEv } = await supabase
      .from('eventos')
      .select('id, nome, departamento');
    if (errEv) throw errEv;

    const umadespa = (eventos || []).find(e => e.departamento === 'UMADESPA' || e.nome.includes('UMADESPA'));
    if (!umadespa) {
      return NextResponse.json({ error: 'Evento UMADESPA não encontrado.' }, { status: 404 });
    }
    const eventId = umadespa.id;

    // 2. Buscar todos os leitos ocupados com inscricao_id do evento
    const { data: leitos, error: errLeitos } = await supabase
      .from('evento_hospedagem_leitos')
      .select('*')
      .eq('evento_id', eventId)
      .eq('ocupado', true)
      .not('inscricao_id', 'is', null);
    if (errLeitos) throw errLeitos;

    // 3. Buscar hospedagens existentes do evento
    const { data: hospedagens, error: errHosp } = await supabase
      .from('evento_hospedagens')
      .select('*')
      .eq('evento_id', eventId);
    if (errHosp) throw errHosp;

    const hospMap = new Map();
    hospedagens.forEach(h => {
      hospMap.set(h.inscricao_id, h);
    });

    let sincronizados = 0;
    let criados = 0;
    let ignorados = 0;

    for (const leito of leitos) {
      const inscId = leito.inscricao_id;
      const alojId = leito.alojamento_id;
      const numeroCama = leito.numero;
      const tipoCama = leito.posicao === 'unico' ? null : leito.posicao;

      const hospExistente = hospMap.get(inscId);

      if (hospExistente) {
        // Verifica se já está sincronizado
        if (
          hospExistente.alojamento_id === alojId &&
          hospExistente.numero_cama === numeroCama &&
          hospExistente.tipo_cama === tipoCama &&
          hospExistente.status === 'confirmada'
        ) {
          ignorados++;
          continue;
        }

        // Atualizar
        const { error: errUpdate } = await supabase
          .from('evento_hospedagens')
          .update({
            alojamento_id: alojId,
            numero_cama: numeroCama,
            tipo_cama: tipoCama,
            status: 'confirmada',
            alocacao_automatica: true
          })
          .eq('id', hospExistente.id);

        if (errUpdate) {
          console.error(`Erro ao atualizar hospedagem ${hospExistente.id}:`, errUpdate.message);
        } else {
          sincronizados++;
        }
      } else {
        // Criar
        const { error: errInsert } = await supabase
          .from('evento_hospedagens')
          .insert({
            evento_id: eventId,
            inscricao_id: inscId,
            alojamento_id: alojId,
            numero_cama: numeroCama,
            tipo_cama: tipoCama,
            status: 'confirmada',
            alocacao_automatica: true
          });

        if (errInsert) {
          console.error(`Erro ao criar hospedagem para inscricao ${inscId}:`, errInsert.message);
        } else {
          criados++;
        }
      }
    }

    return NextResponse.json({
      success: true,
      evento: {
        id: eventId,
        nome: umadespa.nome,
      },
      contagem: {
        registros_sincronizados: sincronizados,
        registros_criados: criados,
        registros_ignorados: ignorados,
        status_utilizado: 'confirmada'
      }
    });

  } catch (error: any) {
    return NextResponse.json({ error: error.message || error }, { status: 500 });
  }
}
