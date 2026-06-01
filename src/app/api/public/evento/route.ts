import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const slug = (searchParams.get('slug') || '').trim();

  if (!slug) {
    return NextResponse.json({ error: 'slug obrigatorio' }, { status: 400 });
  }

  const supabase = createServerClient();
  const { data: evento, error } = await supabase
    .from('eventos')
    .select('id,nome,slug,descricao,departamento,data_inicio,data_fim,local,cidade,banner_url,valor_inscricao,permite_hospedagem,permite_alimentacao,permite_brinde,gerar_certificado,link_whatsapp,mensagem_confirmacao,inscricoes_abertas,limite_vagas,limite_hospedagem,limite_brindes,publico_alvo,usar_tipos_inscricao,status,suporte_nome,suporte_whatsapp,configuracoes_ago')
    .eq('slug', slug)
    .single();

  if (error || !evento) {
    return NextResponse.json({ error: 'Evento nao encontrado' }, { status: 404 });
  }

  const { data: tipos } = await supabase
    .from('evento_tipos_inscricao')
    .select('id,nome,valor,inclui_alimentacao,inclui_hospedagem,cortesia,limite_vagas,ordem')
    .eq('evento_id', evento.id)
    .eq('ativo', true)
    .order('ordem');

  const { data: cuponsAtivos } = await supabase
    .from('evento_cupons')
    .select('id')
    .eq('evento_id', evento.id)
    .eq('ativo', true)
    .limit(1);

  let totalInscritos: number | null = null;
  if (evento.limite_vagas) {
    const { count } = await supabase
      .from('evento_inscricoes')
      .select('id', { count: 'exact', head: true })
      .eq('evento_id', evento.id);
    totalInscritos = count ?? 0;
  }

  let vagasHospedagem: number | null = null;
  if (evento.limite_hospedagem) {
    const { count: hospCount } = await supabase
      .from('evento_inscricoes')
      .select('id', { count: 'exact', head: true })
      .eq('evento_id', evento.id)
      .eq('hospedagem', true);
    const usadas = hospCount ?? 0;
    vagasHospedagem = Math.max(0, evento.limite_hospedagem - usadas);
  }

  return NextResponse.json({
    evento,
    tipos: tipos ?? [],
    totalInscritos,
    vagasHospedagem,
    possuiCupomAtivo: (cuponsAtivos ?? []).length > 0,
  });
}
