import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';

/**
 * GET /api/public/umadespa/validar-credencial/[codigo]
 * Validação pública de autenticidade da carteirinha UMADESPA via QR Code.
 * Diretriz LGPD: NÃO expõe CPF, dados de menores, contatos ou endereços pessoais.
 * Retorna apenas: Nome, Função, Campo, Supervisão, Situação Cadastral e Validade Oficial.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ codigo: string }> }
) {
  try {
    const { codigo: codigoRaw } = await params;
    const codigo = codigoRaw?.trim();

    if (!codigo || codigo.length < 2) {
      return NextResponse.json({ error: 'Código de autenticação inválido.' }, { status: 400 });
    }

    const supabase = createServerClient();

    // 1. Busca associado por ID (UUID), número UMADESPA ou matrícula
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(codigo);

    let query = supabase
      .from('umadespa_associados')
      .select(`
        id,
        nome,
        numero_umadespa,
        matricula,
        funcao,
        is_lideranca,
        status,
        foto_url,
        supervisao:supervisoes(nome),
        campo:campos(nome),
        congregacao:congregacoes(nome)
      `);

    if (isUuid) {
      query = query.eq('id', codigo);
    } else {
      query = query.or(`numero_umadespa.eq.${codigo},matricula.eq.${codigo}`);
    }

    const { data: associado, error } = await query.maybeSingle();

    if (error || !associado) {
      return NextResponse.json(
        { autentico: false, error: 'Credencial não localizada nos registros oficiais da UMADESPA.' },
        { status: 404 }
      );
    }

    // 2. Busca o histórico de solicitações para determinar a via efetivamente emitida e seu estado
    const { data: todasSolicitacoes } = await supabase
      .from('umadespa_carteirinhas_solicitacoes')
      .select('id, via, status, validade_data, pago_em, impresso_em, entregue_em, cancelado_em')
      .eq('associado_id', associado.id)
      .order('via', { ascending: false });

    // A via válida é a mais recente que foi efetivamente impressa ou entregue e não cancelada
    const viaEfetiva = todasSolicitacoes?.find(
      (s) => ['impressa', 'entregue'].includes(s.status)
    );

    // Identifica se há via substituída (ex: se existe via mais recente impressa/entregue)
    const ultimaSolicitacao = todasSolicitacoes?.[0] || null;

    let validadeStatus: 'valida' | 'expirada' | 'cancelada' | 'substituida' | 'aguardando_emissao' | 'sem_registro' = 'sem_registro';
    let dataValidade: string | null = null;
    let viaAtiva = 1;

    if (viaEfetiva) {
      viaAtiva = viaEfetiva.via;
      dataValidade = viaEfetiva.validade_data || null;

      if (viaEfetiva.cancelado_em || viaEfetiva.status === 'cancelada') {
        validadeStatus = 'cancelada';
      } else if (dataValidade) {
        const hoje = new Date().toISOString().slice(0, 10);
        validadeStatus = dataValidade >= hoje ? 'valida' : 'expirada';
      } else {
        validadeStatus = 'valida';
      }

      // Se a última solicitação for uma via superior já impressa/entregue, esta via anterior está substituída
      if (ultimaSolicitacao && ultimaSolicitacao.via > viaEfetiva.via && ['impressa', 'entregue'].includes(ultimaSolicitacao.status)) {
        // Se a busca inicial for específica por UUID ou se consultou a geral
        validadeStatus = 'substituida';
      }
    } else if (ultimaSolicitacao) {
      viaAtiva = ultimaSolicitacao.via;
      dataValidade = ultimaSolicitacao.validade_data || null;
      if (ultimaSolicitacao.status === 'cancelada') {
        validadeStatus = 'cancelada';
      } else {
        validadeStatus = 'aguardando_emissao';
      }
    }

    // Se o associado estiver inativo ou em regularização
    if (associado.status === 'inativo') {
      validadeStatus = 'cancelada';
    }

    // Retorno higienizado (LGPD compliance total)
    return NextResponse.json({
      autentico: true,
      registro: {
        nome: associado.nome,
        numero: associado.numero_umadespa || associado.matricula || associado.id.slice(0, 8).toUpperCase(),
        funcao: associado.funcao,
        isLideranca: associado.is_lideranca,
        supervisao: (associado.supervisao as any)?.nome || 'COMIEADEPA',
        campo: (associado.campo as any)?.nome || 'Pará',
        congregacao: (associado.congregacao as any)?.nome || null,
        fotoUrl: associado.foto_url || null,
        statusCadastral: associado.status,
        situacaoCredencial: validadeStatus,
        validade: dataValidade,
        via: viaAtiva,
      },
    });
  } catch (err: any) {
    console.error('[UMADESPA VALIDAR CREDENCIAL] Erro fatal:', err);
    return NextResponse.json({ error: 'Erro interno ao validar credencial.' }, { status: 500 });
  }
}
