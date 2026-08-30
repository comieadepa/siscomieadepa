/**
 * GET /api/portal-ministro/credencial
 * Endpoint unificado da Central de Credencial do Ministro.
 * Retorna dados da credencial digital, status ministerial, status do documento,
 * pedido de impressão ativo e histórico de solicitações.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { getMinistroSession, unauthorizedResponse } from '@/lib/ministro-session';

const STATUS_LABELS: Record<string, string> = {
  aguardando_pagamento: 'Aguardando Pagamento',
  pago_pendente_impressao: 'Pago — Em Fila de Produção',
  em_impressao: 'Em Impressão',
  disponivel_retirada: 'Disponível para Retirada',
  entregue: 'Entregue',
  cancelado: 'Cancelado',
};

export async function GET(request: NextRequest) {
  const session = await getMinistroSession(request);
  if (!session) return unauthorizedResponse();

  const supabase = createServerClient();

  // 1. Busca dados cadastrais e de credencial do ministro autenticado
  const { data: ministro, error } = await supabase
    .from('members')
    .select('id, name, matricula, unique_id, cred_validade, created_at, status, foto_url, cargo_ministerial, custom_fields')
    .eq('id', session.ministroId)
    .maybeSingle();

  if (error || !ministro) {
    return NextResponse.json({ error: 'Ministro não encontrado.' }, { status: 404 });
  }

  const cf = (ministro.custom_fields && typeof ministro.custom_fields === 'object')
    ? (ministro.custom_fields as Record<string, any>)
    : {};

  const validadeStr = (ministro.cred_validade || cf.dataValidadeCredencial || cf.validade || null) as string | null;
  const dataEmissaoStr = (cf.dataEmissao || ministro.created_at || null) as string | null;

  const hoje = new Date();
  const validade = validadeStr ? new Date(validadeStr) : null;

  // 2. Status Ministerial (ATIVO / INATIVO)
  const statusMinisterial: 'ATIVO' | 'INATIVO' = ministro.status === 'active' ? 'ATIVO' : 'INATIVO';

  // 3. Status da Credencial (NAO_EMITIDA / VALIDA / VENCIDA)
  let statusCredencial: 'NAO_EMITIDA' | 'VALIDA' | 'VENCIDA' = 'NAO_EMITIDA';
  if (validade) {
    if (validade >= hoje && ministro.status === 'active') {
      statusCredencial = 'VALIDA';
    } else {
      statusCredencial = 'VENCIDA';
    }
  }

  // Compatibilidade legada para interfaces existentes ('ativa' | 'vencida' | 'pendente')
  const statusCredencialLegacy: 'ativa' | 'vencida' | 'pendente' =
    statusCredencial === 'VALIDA'
      ? 'ativa'
      : statusCredencial === 'VENCIDA'
      ? 'vencida'
      : 'pendente';

  const credencialUrl = ministro.unique_id
    ? `${process.env.NEXT_PUBLIC_APP_URL || ''}/autentica_qrcode-05985642/${ministro.unique_id}`
    : null;

  // 4. Busca histórico de pedidos de impressão do ministro (isolamento por session.ministroId)
  const { data: pedidosRaw } = await supabase
    .from('credencial_impressoes_solicitacoes')
    .select('id, status, valor_centavos, asaas_payment_id, solicitado_em, pago_em, em_impressao_em, disponivel_retirada_em, impresso_em, entregue_em, cancelado_em')
    .eq('ministro_id', session.ministroId)
    .order('solicitado_em', { ascending: false })
    .limit(10);

  const historicoPedidos = (pedidosRaw || []).map((p: any) => ({
    id: p.id,
    status: p.status,
    statusLabel: STATUS_LABELS[p.status] || p.status,
    valor: (p.valor_centavos || 2000) / 100,
    asaasPaymentId: p.asaas_payment_id || null,
    solicitadoEm: p.solicitado_em,
    pagoEm: p.pago_em || null,
    emImpressaoEm: p.em_impressao_em || null,
    disponivelRetiradaEm: p.disponivel_retirada_em || p.impresso_em || null,
    impressoEm: p.impresso_em || null,
    entregueEm: p.entregue_em || null,
    canceladoEm: p.cancelado_em || null,
  }));

  // Identifica o último pedido ativo em andamento (se houver)
  const STATUS_ATIVOS = ['aguardando_pagamento', 'pago_pendente_impressao', 'em_impressao', 'disponivel_retirada'];
  const pedidoAtual = historicoPedidos.find((p) => STATUS_ATIVOS.includes(p.status)) || null;

  return NextResponse.json({
    // Dados Cadastrais e Institucionais
    ministro: {
      id: ministro.id,
      nome: ministro.name,
      matricula: ministro.matricula || cf.matricula || null,
      cargo: ministro.cargo_ministerial || cf.cargoMinisterial || null,
      campo: cf.campo || null,
      supervisao: cf.supervisao || null,
      fotoUrl: ministro.foto_url || cf.fotoUrl || null,
    },

    // 1. Status Ministerial
    statusMinisterial,

    // 2. Status da Credencial
    statusCredencial,
    statusCredencialLegacy, // retrocompatibilidade

    // Dados da Credencial Digital
    dataValidade: validadeStr,
    dataEmissao: dataEmissaoStr,
    uniqueId: ministro.unique_id,
    credencialUrl,

    // 3. Pedido Atual de Impressão (em andamento)
    pedidoAtual,

    // 4. Histórico de Pedidos
    historicoPedidos,
  });
}
