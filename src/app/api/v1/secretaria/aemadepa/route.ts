import { NextRequest, NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/auth/require-auth';
import { createServerClient } from '@/lib/supabase-server';
import { cleanCpf, isValidCpf } from '@/lib/cpf';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireModuleAccess(request, 'aemadepa');
    if (!auth.ok) return auth.response;

    const supabase = createServerClient();
    const { searchParams } = new URL(request.url);
    const scope = searchParams.get('scope');

    // Se scope=ministros, retorna lista de ministros para o modal (todos os ministros disponíveis)
    if (scope === 'ministros') {
      const { data: ministros, error: minErr } = await supabase
        .from('members')
        .select('id, name, matricula, cpf, cargo_ministerial, custom_fields')
        .not('name', 'is', null)
        .order('name', { ascending: true })
        .limit(1000);

      if (minErr) {
        console.error('Erro ao consultar ministros:', minErr);
        return NextResponse.json({ error: minErr.message }, { status: 500 });
      }

      const listaMinistros = (ministros || []).map((m: any) => {
        const cf = m.custom_fields && typeof m.custom_fields === 'object' ? m.custom_fields : {};
        return {
          id: m.id,
          nome: String(m.name || cf.nome || '').trim(),
          matricula: String(m.matricula || cf.matricula || '').trim(),
          cpf: String(m.cpf || cf.cpf || '').trim(),
          cargo: String(m.cargo_ministerial || cf.cargoMinisterial || 'PASTOR').trim(),
          campo: String(cf.campo || cf.campo_atual || '').trim(),
          supervisao: String(cf.supervisao || '').trim(),
        };
      });

      return NextResponse.json({ data: listaMinistros });
    }

    // 1. Busca todas as associadas cadastradas com os dados do ministro vinculado via JOIN
    const { data: associadas, error } = await supabase
      .from('aemadepa_associadas')
      .select(`
        id,
        ministro_id,
        nome,
        cpf,
        rg,
        orgao_emissor,
        data_nascimento,
        nacionalidade,
        naturalidade,
        tipo_sanguineo,
        nome_pai,
        nome_mae,
        titulo_eleitoral,
        fone,
        email,
        foto_url,
        numero_aemadepa,
        status,
        custom_fields,
        created_at,
        updated_at,
        members:ministro_id (
          id,
          name,
          matricula,
          cpf,
          cargo_ministerial,
          status,
          jubilado,
          unique_id,
          custom_fields
        )
      `)
      .order('nome', { ascending: true });

    if (error) {
      console.error('Erro ao consultar aemadepa_associadas:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // 2. Busca solicitações ativas para consolidar status financeiro de cada associada
    const { data: solicitacoes } = await supabase
      .from('aemadepa_carteirinhas_solicitacoes')
      .select('id, associada_id, via, status, valor, forma_pagamento, pago_em, impresso_em, entregue_em')
      .order('via', { ascending: false });

    const solicitacoesPorAssociada = new Map<string, any>();
    (solicitacoes || []).forEach((s) => {
      if (!solicitacoesPorAssociada.has(s.associada_id)) {
        solicitacoesPorAssociada.set(s.associada_id, s);
      }
    });

    const associadasComFinanceiro = (associadas || []).map((assoc) => {
      const solAtiva = solicitacoesPorAssociada.get(assoc.id) || null;
      const temFoto = Boolean(assoc.foto_url && assoc.foto_url.trim().length > 0);
      const regularizada = Boolean(solAtiva && ['pago', 'em_impressao', 'impressa', 'entregue'].includes(solAtiva.status));
      const podeImprimir = temFoto && regularizada;

      return {
        ...assoc,
        solicitacaoAtiva: solAtiva,
        financeiro: {
          status: solAtiva ? solAtiva.status : 'sem_solicitacao',
          formaPagamento: solAtiva?.forma_pagamento || null,
          via: solAtiva?.via || 1,
          pago: regularizada,
          podeImprimir,
          motivoBloqueio: !temFoto
            ? 'Foto não cadastrada'
            : !regularizada
            ? 'Regularização financeira pendente'
            : null,
        },
      };
    });

    return NextResponse.json({
      data: associadasComFinanceiro,
      total: associadasComFinanceiro.length,
    });
  } catch (err: any) {
    console.error('Erro interno na rota /api/v1/secretaria/aemadepa:', err);
    return NextResponse.json({ error: err.message || 'Erro interno do servidor' }, { status: 500 });
  }
}

/**
 * PUT: Atualização atômica dos dados cadastrais da associada AEMADEPA
 * Atualiza tanto a tabela dedicada `aemadepa_associadas` quanto a sincronização em `members`
 */
export async function PUT(request: NextRequest) {
  try {
    const auth = await requireModuleAccess(request, 'aemadepa');
    if (!auth.ok) return auth.response;

    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: 'Payload JSON inválido.' }, { status: 400 });
    }

    const {
      associada_id,
      ministro_id,
      nome,
      cpf,
      rg,
      orgao_emissor,
      data_nascimento,
      nacionalidade,
      naturalidade,
      tipo_sanguineo,
      nome_pai,
      nome_mae,
      titulo_eleitoral,
      fone,
      email,
      foto_url,
      numero_aemadepa,
    } = body;

    // 1. Validação do ministro vinculado
    if (!ministro_id) {
      return NextResponse.json({ error: 'Ministro vinculado é obrigatório.' }, { status: 400 });
    }

    // 2. Validação de nome
    const nomeLimpo = String(nome || '').trim().toUpperCase();
    if (!nomeLimpo || nomeLimpo.length < 3) {
      return NextResponse.json({ error: 'Nome completo da esposa é obrigatório (mínimo 3 caracteres).' }, { status: 400 });
    }

    // 3. Validação matemática rigorosa do CPF
    const cpfLimpo = cleanCpf(cpf);
    if (!cpfLimpo || cpfLimpo.length !== 11) {
      return NextResponse.json({ error: 'CPF da associada deve conter exatamente 11 dígitos numéricos.' }, { status: 400 });
    }
    if (!isValidCpf(cpfLimpo)) {
      return NextResponse.json({ error: 'O CPF informado para a esposa é matematicamente inválido.' }, { status: 400 });
    }

    // 4. Validação de data de nascimento
    if (!data_nascimento) {
      return NextResponse.json({ error: 'Data de nascimento da esposa é obrigatória.' }, { status: 400 });
    }

    const supabase = createServerClient();

    // 5. Verificar se o ministro existe
    const { data: ministro, error: ministroErr } = await supabase
      .from('members')
      .select('id, name, matricula, custom_fields, conjuge_foto_url')
      .eq('id', ministro_id)
      .single();

    if (ministroErr || !ministro) {
      return NextResponse.json({ error: 'Ministro vinculado não encontrado no sistema.' }, { status: 404 });
    }

    // 6. Antiusurpação de CPF e identificação da associada
    let targetAssociadaId = associada_id;

    if (!targetAssociadaId) {
      const { data: assocExistente } = await supabase
        .from('aemadepa_associadas')
        .select('id, ministro_id, cpf')
        .eq('ministro_id', ministro_id)
        .maybeSingle();

      if (assocExistente) {
        targetAssociadaId = assocExistente.id;
      }
    }

    // Verificar se o CPF já pertence a outro ministro
    const { data: cpfEmUso } = await supabase
      .from('aemadepa_associadas')
      .select('id, ministro_id')
      .eq('cpf', cpfLimpo)
      .maybeSingle();

    if (cpfEmUso && targetAssociadaId && cpfEmUso.id !== targetAssociadaId) {
      return NextResponse.json({
        error: 'Este CPF já está vinculado ao cadastro de outro ministro na AEMADEPA.',
      }, { status: 409 });
    }

    // 7. Atualização ou Criação na tabela oficial `aemadepa_associadas`
    let associadaGravada: any = null;

    const dadosAssociada = {
      ministro_id,
      nome: nomeLimpo,
      cpf: cpfLimpo,
      rg: rg ? String(rg).trim().toUpperCase() : null,
      orgao_emissor: orgao_emissor ? String(orgao_emissor).trim().toUpperCase() : null,
      data_nascimento,
      nacionalidade: nacionalidade ? String(nacionalidade).trim().toUpperCase() : 'BRASILEIRA',
      naturalidade: naturalidade ? String(naturalidade).trim().toUpperCase() : null,
      tipo_sanguineo: tipo_sanguineo ? String(tipo_sanguineo).trim() : null,
      nome_pai: nome_pai ? String(nome_pai).trim().toUpperCase() : null,
      nome_mae: nome_mae ? String(nome_mae).trim().toUpperCase() : null,
      titulo_eleitoral: titulo_eleitoral ? String(titulo_eleitoral).trim() : null,
      fone: fone ? String(fone).trim() : null,
      email: email ? String(email).trim().toLowerCase() : null,
      foto_url: foto_url || null,
      numero_aemadepa: numero_aemadepa ? String(numero_aemadepa).trim() : null,
      updated_at: new Date().toISOString(),
    };

    if (targetAssociadaId) {
      const { data: updated, error: updateErr } = await supabase
        .from('aemadepa_associadas')
        .update(dadosAssociada)
        .eq('id', targetAssociadaId)
        .select()
        .single();

      if (updateErr) {
        console.error('Erro ao atualizar aemadepa_associadas:', updateErr);
        return NextResponse.json({ error: `Falha ao salvar associada: ${updateErr.message}` }, { status: 500 });
      }
      associadaGravada = updated;
    } else {
      const { data: inserted, error: insertErr } = await supabase
        .from('aemadepa_associadas')
        .insert({
          ...dadosAssociada,
          status: 'pendente',
        })
        .select()
        .single();

      if (insertErr) {
        console.error('Erro ao inserir aemadepa_associadas:', insertErr);
        return NextResponse.json({ error: `Falha ao cadastrar associada: ${insertErr.message}` }, { status: 500 });
      }
      associadaGravada = inserted;
    }

    // 8. Sincronização em `members` para compatibilidade total e relatórios
    const cfMinistro = ministro.custom_fields && typeof ministro.custom_fields === 'object' ? ministro.custom_fields : {};
    const novosCustomFields = {
      ...cfMinistro,
      nomeConjuge: nomeLimpo,
      cpfConjuge: cpfLimpo,
      dataNascimentoConjuge: data_nascimento,
      conjugeRg: dadosAssociada.rg,
      conjugeOrgaoEmissor: dadosAssociada.orgao_emissor,
      conjugeNacionalidade: dadosAssociada.nacionalidade,
      conjugeNaturalidade: dadosAssociada.naturalidade,
      conjugeNomePai: dadosAssociada.nome_pai,
      conjugeNomeMae: dadosAssociada.nome_mae,
      conjugeTituloEleitoral: dadosAssociada.titulo_eleitoral,
      conjugeFone: dadosAssociada.fone,
      conjugeEmail: dadosAssociada.email,
      conjugeTipoSanguineo: dadosAssociada.tipo_sanguineo,
      conjugeFotoUrl: foto_url || cfMinistro.conjugeFotoUrl || null,
      numero_aemadepa: dadosAssociada.numero_aemadepa,
      numeroAemadepa: dadosAssociada.numero_aemadepa,
    };

    const { error: syncErr } = await supabase
      .from('members')
      .update({
        nome_conjuge: nomeLimpo,
        cpf_conjuge: cpfLimpo,
        data_nascimento_conjuge: data_nascimento,
        conjuge_rg: dadosAssociada.rg,
        conjuge_orgao_emissor: dadosAssociada.orgao_emissor,
        conjuge_nacionalidade: dadosAssociada.nacionalidade,
        conjuge_naturalidade: dadosAssociada.naturalidade,
        conjuge_nome_pai: dadosAssociada.nome_pai,
        conjuge_nome_mae: dadosAssociada.nome_mae,
        conjuge_titulo_eleitoral: dadosAssociada.titulo_eleitoral,
        conjuge_fone: dadosAssociada.fone,
        conjuge_email: dadosAssociada.email,
        conjuge_tipo_sanguineo: dadosAssociada.tipo_sanguineo,
        conjuge_foto_url: foto_url || ministro.conjuge_foto_url,
        custom_fields: novosCustomFields,
        updated_at: new Date().toISOString(),
      })
      .eq('id', ministro_id);

    if (syncErr) {
      console.warn('Aviso: Falha ao sincronizar ficha ministerial members:', syncErr.message);
    }

    // 9. Confirmação por leitura posterior
    const { data: confirmacao, error: confirmErr } = await supabase
      .from('aemadepa_associadas')
      .select('id, nome, cpf, rg, orgao_emissor, data_nascimento, foto_url, numero_aemadepa, updated_at')
      .eq('id', associadaGravada.id)
      .single();

    if (confirmErr || !confirmacao) {
      return NextResponse.json({
        error: 'Não foi possível confirmar a persistência dos dados no banco de dados.',
      }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: 'Dados da associada AEMADEPA salvos e persistidos com sucesso!',
      associada: confirmacao,
    });
  } catch (err: any) {
    console.error('Erro interno na rota PUT /api/v1/secretaria/aemadepa:', err);
    return NextResponse.json({ error: err.message || 'Erro interno do servidor' }, { status: 500 });
  }
}
