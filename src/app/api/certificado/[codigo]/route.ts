import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';

// GET /api/certificado/[codigo]
// Página pública — valida o código e retorna dados do certificado (se elegível)
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ codigo: string }> }
) {
  const supabase = createServerClient();
  const { codigo: codigoRaw } = await params;
  const codigo = String(codigoRaw).trim().toUpperCase();

  if (!codigo) {
    return NextResponse.json({ error: 'Código inválido.' }, { status: 400 });
  }

  // Busca inscrição pelo qr_code
  const { data: inscricao, error: insError } = await supabase
    .from('evento_inscricoes')
    .select([
      'id', 'evento_id', 'nome_inscrito', 'cpf', 'supervisao_id', 'campo_id',
      'tipo_inscricao', 'status_pagamento', 'checkin_realizado',
      'certificado_enviado', 'qr_code', 'created_at',
    ].join(','))
    .eq('qr_code', codigo)
    .maybeSingle();

  if (insError) return NextResponse.json({ error: insError.message }, { status: 500 });

  if (!inscricao) {
    return NextResponse.json({
      valido: false,
      motivo: 'Código de inscrição não encontrado.',
    }, { status: 404 });
  }

  const insc = inscricao as unknown as {
    id: string; evento_id: string; nome_inscrito: string; cpf: string | null;
    supervisao_id: string | null; campo_id: string | null;
    tipo_inscricao: string | null; status_pagamento: string;
    checkin_realizado: boolean; certificado_enviado: boolean;
    qr_code: string; created_at: string;
  };

  // Verifica elegibilidade
  const pagamentoOk = ['pago', 'isento'].includes(insc.status_pagamento);
  if (!pagamentoOk) {
    return NextResponse.json({
      valido: false,
      motivo: 'Inscrição com pagamento pendente — certificado não disponível.',
    });
  }
  if (!insc.checkin_realizado) {
    return NextResponse.json({
      valido: false,
      motivo: 'Check-in não realizado — certificado não disponível.',
    });
  }

  // Busca evento e configuração do certificado
  const [evRes, cfgRes, supRes, camRes] = await Promise.all([
    supabase
      .from('eventos')
      .select('id,nome,slug,departamento,data_inicio,data_fim,local,cidade,gerar_certificado,suporte_nome,suporte_whatsapp')
      .eq('id', insc.evento_id)
      .single(),
    supabase
      .from('evento_certificado_config')
      .select('*')
      .eq('evento_id', insc.evento_id)
      .maybeSingle(),
    supabase.from('supervisoes').select('id,nome').eq('id', insc.supervisao_id ?? '').maybeSingle(),
    supabase.from('campos').select('id,nome').eq('id', insc.campo_id ?? '').maybeSingle(),
  ]);

  if (!evRes.data) {
    return NextResponse.json({ valido: false, motivo: 'Evento não encontrado.' }, { status: 404 });
  }

  if (!evRes.data.gerar_certificado) {
    return NextResponse.json({
      valido: false,
      motivo: 'Este evento não emite certificados.',
    });
  }

  // Verifica prazo de 48h após data_fim
  const evento = evRes.data;
  const dataFimStr = evento.data_fim ?? evento.data_inicio;
  const dataFim = new Date(`${dataFimStr}T23:59:59-03:00`);
  const prazoExpiracao = new Date(dataFim.getTime() + 48 * 60 * 60 * 1000);
  const expirado = new Date() > prazoExpiracao;

  if (expirado) {
    return NextResponse.json({
      valido: false,
      expirado: true,
      suporte_nome:      evento.suporte_nome ?? null,
      suporte_whatsapp:  evento.suporte_whatsapp ?? null,
      motivo: 'O prazo para emissão online deste certificado expirou. Entre em contato com a organização do evento para solicitar uma nova emissão.',
    });
  }
  const fmtData = (d: string | null) => {
    if (!d) return '';
    const [y, m, day] = d.split('-');
    return `${day}/${m}/${y}`;
  };
  const dataEvento = evento.data_inicio === evento.data_fim
    ? fmtData(evento.data_inicio)
    : `${fmtData(evento.data_inicio)} a ${fmtData(evento.data_fim)}`;

  return NextResponse.json({
    valido: true,
    config: cfgRes.data ?? null,
    prazo_expiracao: prazoExpiracao.toISOString(),
    dados: {
      nome:        insc.nome_inscrito,
      evento:      evento.nome,
      data_evento: dataEvento,
      cargo:       insc.tipo_inscricao ?? null,
      supervisao:  supRes.data?.nome ?? null,
      campo:       camRes.data?.nome ?? null,
      codigo:      insc.qr_code ?? codigo,
      cpf:         insc.cpf ?? null,
    },
  });
}
