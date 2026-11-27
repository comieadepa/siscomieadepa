import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { cleanCpf, isValidCpf } from '@/lib/cpf';
import {
  verifyUmadespaToken,
  validarElegibilidadeUmadespa,
  sanitizarFuncaoCadastro,
  validarHierarquiaEclesiastica,
} from '@/lib/umadespa';

/**
 * POST /api/public/umadespa/cadastro
 * Criação ou atualização do cadastro público do jovem.
 * Exige token HMAC gerado pelo endpoint /validar-acesso para garantir integridade.
 * Aplica trava de idade pública <= 30 anos e força a função para 'Membro'.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: 'Corpo da requisição inválido.' }, { status: 400 });
    }

    const {
      token,
      associadoId,
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
      responsavel_nome,
      responsavel_cpf,
      responsavel_fone,
      responsavel_termo_aceite,
    } = body;

    const authToken = request.headers.get('x-umadespa-token') || token;
    const cpfLimpo = cleanCpf(cpf);

    if (!cpfLimpo || cpfLimpo.length !== 11 || !isValidCpf(cpfLimpo)) {
      return NextResponse.json({ error: 'CPF inválido.' }, { status: 422 });
    }

    // 1. Validação de segurança via Token HMAC
    const idParaVerificacao = associadoId && associadoId !== 'novo' ? associadoId : 'novo';
    const tokenValido = verifyUmadespaToken(authToken, idParaVerificacao);

    if (!tokenValido.valid) {
      return NextResponse.json(
        { error: 'Sessão expirada ou não autorizada. Valide seus dados novamente no início.' },
        { status: 401 }
      );
    }

    // 2. Validação de campos essenciais
    if (!nome || String(nome).trim().length < 3) {
      return NextResponse.json({ error: 'Nome completo é obrigatório (mínimo 3 caracteres).' }, { status: 422 });
    }

    if (!data_nascimento) {
      return NextResponse.json({ error: 'Data de nascimento é obrigatória.' }, { status: 422 });
    }

    if (!supervisao_id || !campo_id) {
      return NextResponse.json({ error: 'Supervisão e Campo são de preenchimento obrigatório.' }, { status: 422 });
    }

    // 3. Validação de Hierarquia Eclesiástica
    const hierarquia = await validarHierarquiaEclesiastica({
      supervisaoId: supervisao_id,
      campoId: campo_id,
      congregacaoId: congregacao_id || null,
    });
    if (!hierarquia.valido) {
      return NextResponse.json({ error: hierarquia.erro }, { status: 422 });
    }

    // 4. Validação estrita de Elegibilidade Pública (<= 30 anos e termo para menores)
    const respCpfLimpo = responsavel_cpf ? cleanCpf(responsavel_cpf) : null;
    const elegibilidade = validarElegibilidadeUmadespa({
      dataNascimento: data_nascimento,
      origemCadastro: 'publico',
      responsavelNome: responsavel_nome,
      responsavelCpf: respCpfLimpo || undefined,
      responsavelFone: responsavel_fone,
      responsavelTermoAceite: responsavel_termo_aceite === true,
    });

    if (!elegibilidade.valido) {
      return NextResponse.json({ error: elegibilidade.erros.join(' ') }, { status: 422 });
    }

    // 5. Sanitização de Função: público é FORÇADO a Membro (is_lideranca: false)
    const funcaoSanitizada = sanitizarFuncaoCadastro({
      funcao: body.funcao,
      isLideranca: false,
      origemCadastro: 'publico',
    });

    const supabase = createServerClient();

    // 6. Verifica duplicidade se for novo cadastro
    const { data: existente } = await supabase
      .from('umadespa_associados')
      .select('id, nome')
      .eq('cpf', cpfLimpo)
      .maybeSingle();

    if (idParaVerificacao === 'novo' && existente) {
      return NextResponse.json(
        { error: 'Já existe um jovem cadastrado com este CPF. Acesse com sua data de nascimento para consultar seus dados.' },
        { status: 409 }
      );
    }

    if (idParaVerificacao !== 'novo' && existente && existente.id !== idParaVerificacao) {
      return NextResponse.json(
        { error: 'Conflito de dados: o CPF informado pertence a outro cadastro.' },
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
      funcao: funcaoSanitizada.funcao,
      is_lideranca: false, // Invariante público: nunca concede liderança
      origem_cadastro: 'publico',
      status: 'ativo',
    };

    let salvo = null;

    if (idParaVerificacao === 'novo') {
      const { data: criado, error: insErr } = await supabase
        .from('umadespa_associados')
        .insert([payload])
        .select('*')
        .single();

      if (insErr || !criado) {
        console.error('[UMADESPA PUBLIC CADASTRO] Erro ao criar:', insErr);
        return NextResponse.json({ error: insErr?.message || 'Erro ao realizar cadastro.' }, { status: 500 });
      }
      salvo = criado;
    } else {
      const { data: atualizado, error: updErr } = await supabase
        .from('umadespa_associados')
        .update(payload)
        .eq('id', idParaVerificacao)
        .select('*')
        .single();

      if (updErr || !atualizado) {
        console.error('[UMADESPA PUBLIC CADASTRO] Erro ao atualizar:', updErr);
        return NextResponse.json({ error: updErr?.message || 'Erro ao atualizar dados.' }, { status: 500 });
      }
      salvo = atualizado;
    }

    return NextResponse.json({
      success: true,
      data: salvo,
      mensagem: 'Cadastro realizado com sucesso!',
    });
  } catch (err: any) {
    console.error('[UMADESPA PUBLIC CADASTRO] Erro fatal:', err);
    return NextResponse.json({ error: 'Erro interno ao processar cadastro.' }, { status: 500 });
  }
}
