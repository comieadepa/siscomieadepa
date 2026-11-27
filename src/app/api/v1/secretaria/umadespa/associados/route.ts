import { NextRequest, NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/auth/require-auth';
import { createServerClient } from '@/lib/supabase-server';
import { cleanCpf, isValidCpf } from '@/lib/cpf';
import {
  validarElegibilidadeUmadespa,
  sanitizarFuncaoCadastro,
  validarHierarquiaEclesiastica,
} from '@/lib/umadespa';
import { registrarAuditoria } from '@/lib/audit';

/**
 * GET /api/v1/secretaria/umadespa/associados
 * Lista associados da UMADESPA com filtros e paginação segura
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireModuleAccess(request, 'umadespa');
    if (!auth.ok) return auth.response;

    const supabase = createServerClient();
    const { searchParams } = new URL(request.url);

    const busca = searchParams.get('busca')?.trim() || '';
    const status = searchParams.get('status')?.trim() || '';
    const supervisaoId = searchParams.get('supervisaoId')?.trim() || '';
    const campoId = searchParams.get('campoId')?.trim() || '';
    const lideranca = searchParams.get('lideranca');
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '50', 10)));
    const offset = (page - 1) * limit;

    let query = supabase
      .from('umadespa_associados')
      .select(`
        id,
        numero_umadespa,
        matricula,
        nome,
        cpf,
        rg,
        orgao_emissor,
        data_nascimento,
        sexo,
        nacionalidade,
        naturalidade,
        tipo_sanguineo,
        nome_pai,
        nome_mae,
        titulo_eleitoral,
        menor_idade,
        responsavel_nome,
        responsavel_cpf,
        responsavel_fone,
        fone,
        email,
        foto_url,
        funcao,
        is_lideranca,
        cargo_detalhe,
        origem_cadastro,
        status,
        custom_fields,
        created_at,
        updated_at,
        supervisao:supervisoes(id, nome, codigo),
        campo:campos(id, nome),
        congregacao:congregacoes(id, nome)
      `, { count: 'exact' });

    if (busca) {
      const cleanBuscaCpf = cleanCpf(busca);
      if (cleanBuscaCpf.length >= 3) {
        query = query.or(`nome.ilike.%${busca}%,cpf.ilike.%${cleanBuscaCpf}%`);
      } else {
        query = query.ilike('nome', `%${busca}%`);
      }
    }

    if (status && status !== 'todos') {
      query = query.eq('status', status);
    }

    if (supervisaoId) {
      query = query.eq('supervisao_id', supervisaoId);
    }

    if (campoId) {
      query = query.eq('campo_id', campoId);
    }

    if (lideranca === 'true') {
      query = query.eq('is_lideranca', true);
    } else if (lideranca === 'false') {
      query = query.eq('is_lideranca', false);
    }

    query = query
      .order('nome', { ascending: true })
      .range(offset, offset + limit - 1);

    const { data: associados, count, error } = await query;

    if (error) {
      console.error('[UMADESPA ADMIN API] Erro ao listar associados:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Busca última solicitação de carteirinha para cada associado retornado
    const associadoIds = (associados || []).map((a: any) => a.id);
    let solicitacoesMap = new Map<string, any>();

    if (associadoIds.length > 0) {
      const { data: solicitacoes } = await supabase
        .from('umadespa_carteirinhas_solicitacoes')
        .select('id, associado_id, via, status, valor, solicitado_em, pago_em, impresso_em, entregue_em')
        .in('associado_id', associadoIds)
        .order('via', { ascending: false });

      (solicitacoes || []).forEach((s) => {
        if (!solicitacoesMap.has(s.associado_id)) {
          solicitacoesMap.set(s.associado_id, s);
        }
      });
    }

    const resultado = (associados || []).map((a: any) => ({
      ...a,
      carteirinha_atual: solicitacoesMap.get(a.id) || null,
    }));

    return NextResponse.json({
      data: resultado,
      total: count || 0,
      page,
      limit,
      totalPages: Math.ceil((count || 0) / limit),
    });
  } catch (err: any) {
    console.error('[UMADESPA ADMIN API] Erro fatal em GET /associados:', err);
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 });
  }
}

/**
 * POST /api/v1/secretaria/umadespa/associados
 * Cadastro administrativo de associado ou líder da UMADESPA
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireModuleAccess(request, 'umadespa');
    if (!auth.ok) return auth.response;

    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: 'Corpo da requisição inválido.' }, { status: 400 });
    }

    const {
      nome,
      cpf,
      rg,
      orgao_emissor,
      data_nascimento,
      sexo,
      nacionalidade,
      naturalidade,
      tipo_sanguineo,
      nome_pai,
      nome_mae,
      titulo_eleitoral,
      supervisao_id,
      campo_id,
      congregacao_id,
      fone,
      email,
      foto_url,
      funcao,
      cargo_detalhe,
      responsavel_nome,
      responsavel_cpf,
      responsavel_fone,
      responsavel_termo_aceite,
      status,
    } = body;

    // 1. Validação de campos essenciais
    if (!nome || String(nome).trim().length < 3) {
      return NextResponse.json({ error: 'Nome completo é obrigatório (mínimo 3 caracteres).' }, { status: 422 });
    }

    const cpfLimpo = cleanCpf(cpf);
    if (!cpfLimpo || cpfLimpo.length !== 11 || !isValidCpf(cpfLimpo)) {
      return NextResponse.json({ error: 'CPF inválido.' }, { status: 422 });
    }

    if (!data_nascimento) {
      return NextResponse.json({ error: 'Data de nascimento é obrigatória.' }, { status: 422 });
    }

    if (!supervisao_id || !campo_id) {
      return NextResponse.json({ error: 'Supervisão e Campo são obrigatórios.' }, { status: 422 });
    }

    // 2. Validação hierárquica eclesiástica
    const hierarquia = await validarHierarquiaEclesiastica({
      supervisaoId: supervisao_id,
      campoId: campo_id,
      congregacaoId: congregacao_id || null,
    });
    if (!hierarquia.valido) {
      return NextResponse.json({ error: hierarquia.erro }, { status: 422 });
    }

    // 3. Validação de elegibilidade (modo admin permite líderes > 30 anos)
    const respCpfLimpo = responsavel_cpf ? cleanCpf(responsavel_cpf) : null;
    const elegibilidade = validarElegibilidadeUmadespa({
      dataNascimento: data_nascimento,
      origemCadastro: 'administrativo',
      responsavelNome: responsavel_nome,
      responsavelCpf: respCpfLimpo || undefined,
      responsavelFone: responsavel_fone,
      responsavelTermoAceite: responsavel_termo_aceite === true,
    });

    if (!elegibilidade.valido) {
      return NextResponse.json({ error: elegibilidade.erros.join(' ') }, { status: 422 });
    }

    // 4. Sanitização de Função (modo admin permite liderança)
    const funcaoDefinida = sanitizarFuncaoCadastro({
      funcao,
      isLideranca: body.is_lideranca,
      origemCadastro: 'administrativo',
    });

    const supabase = createServerClient();

    // 5. Verificação de unicidade de CPF
    const { data: existente } = await supabase
      .from('umadespa_associados')
      .select('id, nome')
      .eq('cpf', cpfLimpo)
      .maybeSingle();

    if (existente) {
      return NextResponse.json(
        { error: `Já existe um associado cadastrado com este CPF (${existente.nome}).` },
        { status: 409 }
      );
    }

    const payload = {
      nome: String(nome).trim().toUpperCase(),
      cpf: cpfLimpo,
      rg: rg ? String(rg).trim() : null,
      orgao_emissor: orgao_emissor ? String(orgao_emissor).trim().toUpperCase() : null,
      data_nascimento,
      sexo: sexo === 'FEMININO' ? 'FEMININO' : 'MASCULINO',
      nacionalidade: nacionalidade ? String(nacionalidade).trim().toUpperCase() : 'BRASILEIRA',
      naturalidade: naturalidade ? String(naturalidade).trim().toUpperCase() : null,
      tipo_sanguineo: tipo_sanguineo ? String(tipo_sanguineo).trim().toUpperCase() : null,
      nome_pai: nome_pai ? String(nome_pai).trim().toUpperCase() : null,
      nome_mae: nome_mae ? String(nome_mae).trim().toUpperCase() : null,
      titulo_eleitoral: titulo_eleitoral ? String(titulo_eleitoral).trim() : null,
      supervisao_id,
      campo_id,
      congregacao_id: congregacao_id || null,
      menor_idade: elegibilidade.menorIdade,
      responsavel_nome: elegibilidade.menorIdade ? String(responsavel_nome).trim().toUpperCase() : null,
      responsavel_cpf: elegibilidade.menorIdade && respCpfLimpo ? respCpfLimpo : null,
      responsavel_fone: elegibilidade.menorIdade ? String(responsavel_fone).trim() : null,
      responsavel_termo_aceite: elegibilidade.menorIdade ? responsavel_termo_aceite === true : false,
      fone: fone ? String(fone).trim() : null,
      email: email ? String(email).trim().toLowerCase() : null,
      foto_url: foto_url || null,
      funcao: funcaoDefinida.funcao,
      is_lideranca: funcaoDefinida.isLideranca,
      cargo_detalhe: cargo_detalhe ? String(cargo_detalhe).trim() : null,
      origem_cadastro: 'administrativo',
      status: status && ['ativo', 'pendente', 'regularizacao'].includes(status) ? status : 'ativo',
    };

    const { data: novo, error: insErr } = await supabase
      .from('umadespa_associados')
      .insert([payload])
      .select('*')
      .single();

    if (insErr || !novo) {
      console.error('[UMADESPA ADMIN API] Erro ao inserir associado:', insErr);
      return NextResponse.json({ error: insErr?.message || 'Erro ao salvar associado.' }, { status: 500 });
    }

    // Se cadastrado com liderança, audita no histórico
    if (novo.is_lideranca) {
      await supabase.from('umadespa_funcoes_historico').insert([
        {
          associado_id: novo.id,
          funcao_anterior: null,
          funcao_nova: novo.funcao,
          is_lideranca: true,
          alterado_por: auth.ctx.userId,
          motivo: 'Cadastro inicial administrativo com função de liderança',
        },
      ]);
    }

    await registrarAuditoria({
      userId: auth.ctx.userId,
      userEmail: auth.ctx.user.email,
      modulo: 'secretaria',
      acao: 'criar',
      entidade: 'umadespa_associados',
      entidadeId: novo.id,
      descricao: `Novo associado UMADESPA cadastrado: ${novo.nome}`,
    });

    return NextResponse.json({ data: novo }, { status: 201 });
  } catch (err: any) {
    console.error('[UMADESPA ADMIN API] Erro fatal em POST /associados:', err);
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 });
  }
}
