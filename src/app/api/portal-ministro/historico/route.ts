/**
 * GET /api/portal-ministro/historico
 * Retorna histórico ministerial do ministro autenticado.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { getMinistroSession, unauthorizedResponse } from '@/lib/ministro-session';

const TIPO_LABEL: Record<string, string> = {
  credencial_emitida:        'Credencial emitida',
  carta_emitida:             'Carta ministerial',
  progressao_ministerial:    'Progressão ministerial',
  consagracao:               'Consagração / Ordenação',
  apresentacao:              'Apresentação ministerial',
  deliberacao_comissao:      'Deliberação em comissão',
  assumiu_pastor_presidente: 'Assumiu como Pastor Presidente',
  transferencia:             'Transferência ministerial',
  mudanca_de_campo:          'Mudança de campo',
  jubilacao:                 'Jubilação',
  reativacao:                'Reativação',
  desligamento:              'Desligamento',
  observacao_manual:         'Observação',
};

export async function GET(request: NextRequest) {
  const session = await getMinistroSession(request);
  if (!session) return unauthorizedResponse();

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('historico_ministerial')
    .select('id, tipo, titulo, descricao, ocorrencia, created_at, origem')
    .eq('member_id', session.ministroId)
    .order('ocorrencia', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    console.error('[portal/historico]', error.message);
    return NextResponse.json({ data: [] });
  }

  const items = (data || []).map((row: any) => ({
    id: row.id,
    tipo: row.tipo,
    tipoLabel: TIPO_LABEL[row.tipo] || row.tipo || 'Registro',
    titulo: row.titulo || null,
    descricao: row.descricao,
    ocorrencia: row.ocorrencia,
    criadoEm: row.created_at,
  }));

  return NextResponse.json({ data: items });
}
