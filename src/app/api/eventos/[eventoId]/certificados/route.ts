import { NextRequest, NextResponse } from 'next/server';
import { requireEventoPermission } from '@/lib/evento-guard';

// GET /api/eventos/[eventoId]/certificados
// Retorna inscrições elegíveis para certificado (pago/isento + checkin)
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;
  const guard = await requireEventoPermission(_req, eventoId, 'certificados');
  if (!guard.ok) return guard.response;

  const supabase = guard.ctx.supabaseAdmin;

  // Verifica se o evento tem certificado habilitado
  const { data: evento } = await supabase
    .from('eventos')
    .select('id, gerar_certificado, nome')
    .eq('id', eventoId)
    .single();

  if (!evento) return NextResponse.json({ error: 'Evento não encontrado.' }, { status: 404 });

  // Busca inscricoes elegíveis
  const { data: inscricoes, error } = await supabase
    .from('evento_inscricoes')
    .select([
      'id', 'nome_inscrito', 'cpf', 'email', 'whatsapp',
      'supervisao_id', 'campo_id',
      'tipo_inscricao', 'status_pagamento',
      'checkin_realizado', 'checkin_at',
      'certificado_enviado', 'qr_code',
      'created_at',
    ].join(','))
    .eq('evento_id', eventoId)
    .in('status_pagamento', ['pago', 'isento'])
    .order('nome_inscrito');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  type InscRow = {
    id: string; nome_inscrito: string; cpf: string | null; email: string | null; whatsapp: string | null;
    supervisao_id: string | null; campo_id: string | null; tipo_inscricao: string | null;
    status_pagamento: string; checkin_realizado: boolean; checkin_at: string | null;
    certificado_enviado: boolean; qr_code: string | null; created_at: string;
  };
  const todas = (inscricoes ?? []) as unknown as InscRow[];
  const elegiveis  = todas.filter(i => i.checkin_realizado);
  const pendentes  = elegiveis.filter(i => !i.certificado_enviado);
  const gerados    = elegiveis.filter(i => i.certificado_enviado);
  const semCheckin = todas.filter(i => !i.checkin_realizado);

  return NextResponse.json({
    gerar_certificado: evento.gerar_certificado,
    stats: {
      total_pago_isento: todas.length,
      elegiveis:  elegiveis.length,
      pendentes:  pendentes.length,
      gerados:    gerados.length,
      sem_checkin: semCheckin.length,
    },
    inscricoes: elegiveis,
    sem_checkin: semCheckin,
  });
}
