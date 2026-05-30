/**
 * GET /api/portal-ministro/dashboard
 * Retorna dados extras para o dashboard do ministro:
 * próxima AGO, próximo evento e central de pendências.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { getMinistroSession, unauthorizedResponse } from '@/lib/ministro-session';

export async function GET(request: NextRequest) {
  const session = await getMinistroSession(request);
  if (!session) return unauthorizedResponse();

  const supabase = createServerClient();
  const hoje = new Date().toISOString().slice(0, 10);

  // Dados do ministro para verificar pendências
  const { data: ministro } = await supabase
    .from('members')
    .select('id, data_validade_credencial, status, pastor_presidente, telefone, email')
    .eq('id', session.ministroId)
    .maybeSingle();

  // Próxima AGO
  const { data: proximaAgo } = await supabase
    .from('eventos')
    .select('id, nome, data_inicio, data_fim, local, cidade, status')
    .eq('departamento', 'AGO')
    .gte('data_inicio', hoje)
    .in('status', ['programado', 'aberto'])
    .order('data_inicio', { ascending: true })
    .limit(1)
    .maybeSingle();

  // Próximo evento geral (qualquer departamento)
  const { data: proximoEvento } = await supabase
    .from('eventos')
    .select('id, nome, data_inicio, data_fim, local, cidade, departamento, status')
    .gte('data_inicio', hoje)
    .in('status', ['programado', 'aberto'])
    .order('data_inicio', { ascending: true })
    .limit(1)
    .maybeSingle();

  // Central de pendências
  const pendencias: { tipo: string; mensagem: string; urgente: boolean }[] = [];

  if (ministro) {
    const validade = ministro.data_validade_credencial
      ? new Date(ministro.data_validade_credencial as string)
      : null;
    const hoje30 = new Date(Date.now() + 30 * 24 * 3600 * 1000);

    if (!validade) {
      pendencias.push({
        tipo: 'credencial',
        mensagem: 'Credencial ainda não emitida. Contate a secretaria.',
        urgente: true,
      });
    } else if (validade < new Date()) {
      pendencias.push({
        tipo: 'credencial',
        mensagem: `Credencial vencida desde ${validade.toLocaleDateString('pt-BR')}. Regularize com a secretaria.`,
        urgente: true,
      });
    } else if (validade < hoje30) {
      pendencias.push({
        tipo: 'credencial',
        mensagem: `Credencial vence em ${validade.toLocaleDateString('pt-BR')}. Renove em breve.`,
        urgente: false,
      });
    }

    // Contribuição estatutária (apenas para PP)
    if (ministro.pastor_presidente) {
      const mesAtual = new Date().getMonth() + 1;
      const anoAtual = new Date().getFullYear();
      const { data: contrib } = await supabase
        .from('contribuicoes_estatutarias')
        .select('id')
        .eq('mes', mesAtual)
        .eq('ano', anoAtual)
        .maybeSingle();

      if (!contrib) {
        pendencias.push({
          tipo: 'contribuicao',
          mensagem: 'Contribuição estatutária do mês atual não registrada.',
          urgente: false,
        });
      }
    }

    // Dados cadastrais incompletos
    if (!ministro.telefone && !ministro.email) {
      pendencias.push({
        tipo: 'cadastro',
        mensagem: 'Dados de contato incompletos. Solicite atualização cadastral.',
        urgente: false,
      });
    }
  }

  return NextResponse.json({
    proximaAgo: proximaAgo ?? null,
    proximoEvento: proximoEvento ?? null,
    pendencias,
  });
}
