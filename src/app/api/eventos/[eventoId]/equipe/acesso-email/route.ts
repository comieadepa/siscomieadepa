import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { logDB } from '@/lib/audit';

/**
 * POST /api/eventos/[eventoId]/equipe/acesso-email
 *
 * Valida o e-mail do operador na equipe do evento SEM exigir senha.
 * Retorna equipe_id e expira_em para criação de sessão local.
 *
 * Funções aceitas: 'checkin' | 'hospedagem' | 'checkin_hospedagem' | 'checkin_refeitorio' | 'operador'
 * Regra de compatibilidade por funcao solicitada:
 *   - 'hospedagem'         → tipos aceitos: hospedagem, checkin_hospedagem, operador
 *   - 'checkin_hospedagem' → tipos aceitos: checkin_hospedagem, hospedagem, operador
 *   - 'checkin'            → tipos aceitos: checkin, checkin_refeitorio, operador
 *   - 'checkin_refeitorio' → tipos aceitos: checkin_refeitorio, checkin, operador
 *   - 'operador'           → tipos aceitos: operador
 */

type FuncaoSolicitada =
  | 'checkin'
  | 'hospedagem'
  | 'checkin_hospedagem'
  | 'checkin_refeitorio'
  | 'operador';

type TipoEquipe =
  | 'operador'
  | 'checkin'
  | 'checkin_refeitorio'
  | 'hospedagem'
  | 'checkin_hospedagem';

type EventoRow = {
  id: string;
  nome: string;
  status: 'programado' | 'realizado' | 'cancelado';
  data_fim: string | null;
};

type EquipeRow = {
  id: string;
  evento_id: string;
  email: string;
  nome: string | null;
  tipo: TipoEquipe;
  ativo: boolean;
};

const TIPOS_COMPATIVEIS: Record<FuncaoSolicitada, TipoEquipe[]> = {
  hospedagem:         ['hospedagem', 'checkin_hospedagem', 'operador'],
  checkin_hospedagem: ['checkin_hospedagem', 'hospedagem', 'operador'],
  checkin:            ['checkin', 'checkin_refeitorio', 'operador'],
  checkin_refeitorio: ['checkin_refeitorio', 'checkin', 'operador'],
  operador:           ['operador'],
};

function calcExpiraEm(dataFim: string | null): string {
  const base = dataFim
    ? (() => {
        const [y, m, d] = dataFim.split('-').map(Number);
        return new Date(Date.UTC(y, (m || 1) - 1, d || 1, 23, 59, 59, 999));
      })()
    : new Date();
  return new Date(base.getTime() + 48 * 60 * 60 * 1000).toISOString();
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;

  let body: { email?: string; funcao?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body inválido.' }, { status: 400 });
  }

  const email = (body.email || '').trim().toLowerCase();
  const funcaoRaw = (body.funcao || '').trim() as FuncaoSolicitada;
  const funcao: FuncaoSolicitada = Object.keys(TIPOS_COMPATIVEIS).includes(funcaoRaw)
    ? funcaoRaw
    : 'checkin';

  if (!email) {
    return NextResponse.json({ error: 'E-mail obrigatório.' }, { status: 400 });
  }
  if (!/\S+@\S+\.\S+/.test(email)) {
    return NextResponse.json({ error: 'E-mail inválido.' }, { status: 400 });
  }

  const supabase = createServerClient();

  // ── Valida o evento ───────────────────────────────────────
  const { data: evento } = await supabase
    .from('eventos')
    .select('id,nome,status,data_fim')
    .eq('id', eventoId)
    .single();

  if (!evento) {
    return NextResponse.json({ error: 'Evento não encontrado.' }, { status: 404 });
  }
  if ((evento as EventoRow).status !== 'programado') {
    return NextResponse.json({ error: 'Evento encerrado ou cancelado.' }, { status: 403 });
  }

  const ev = evento as EventoRow;

  // ── Busca equipe pelo e-mail — aceita tipos compatíveis ───
  const tiposAceitos = TIPOS_COMPATIVEIS[funcao];

  const { data: equipeRows } = await supabase
    .from('evento_equipe')
    .select('id,evento_id,email,nome,tipo,ativo')
    .eq('evento_id', eventoId)
    .eq('email', email)
    .in('tipo', tiposAceitos);

  const equipe = ((equipeRows ?? []) as EquipeRow[]).find(e => e.ativo === true) ?? null;

  // ── Registro de auditoria ─────────────────────────────────
  const permitido = !!equipe;
  void logDB({
    acao: 'login_equipe_email',
    modulo: 'eventos',
    entidade: 'evento_equipe',
    entidadeId: equipe?.id,
    userEmail: email,
    descricao: permitido
      ? `Acesso por e-mail autorizado para função "${funcao}".`
      : `Tentativa de acesso por e-mail negada para função "${funcao}".`,
    status: permitido ? 'sucesso' : 'erro',
    detalhes: {
      eventoId,
      email,
      funcao,
      tiposAceitos,
      equipeId: equipe?.id ?? null,
      resultado: permitido ? 'permitido' : 'negado',
      dataHora: new Date().toISOString(),
    },
    request,
  });

  if (!equipe) {
    return NextResponse.json(
      { error: 'E-mail não autorizado para este evento.' },
      { status: 403 }
    );
  }

  // ── Atualiza último acesso ────────────────────────────────
  const now = new Date().toISOString();
  void supabase
    .from('evento_equipe')
    .update({ ultimo_acesso_em: now, atualizado_em: now })
    .eq('id', equipe.id);

  return NextResponse.json({
    ok: true,
    equipe_id: equipe.id,
    tipo: equipe.tipo,
    nome: equipe.nome ?? null,
    email: equipe.email,
    evento_nome: ev.nome,
    expira_em: calcExpiraEm(ev.data_fim),
  });
}
