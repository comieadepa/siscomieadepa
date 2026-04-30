/**
 * API ROUTE: Listar / Criar Membros
 * GET  /api/v1/members
 * POST /api/v1/members
 *
 * Multi-tenancy:
 * - O `ministry_id` é resolvido no servidor a partir do usuário autenticado (ministry_users).
 * - Evita depender de `ministry_id` vindo do cliente.
 */

import { createServerClientFromRequest } from '@/lib/supabase-server'
import { normalizePayloadToUppercase } from '@/lib/uppercase-normalizer'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  try {
    const supabase = createServerClientFromRequest(request)

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Extrair query params
    const searchParams = request.nextUrl.searchParams
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '20')
    const status = searchParams.get('status')
    const search = searchParams.get('search')
    const tipoCadastro = searchParams.get('tipoCadastro')

    const offset = (page - 1) * limit

    // Construir query
    let query = supabase
      .from('members')
      .select('*', { count: 'exact' })

    // Aplicar filtros
    if (status) {
      query = query.eq('status', status)
    }

    if (search) {
      query = query.ilike('name', `%${search}%`)
    }

    if (tipoCadastro) {
      const tipo = String(tipoCadastro).toLowerCase()
      query = query.eq('role', tipo)
    }

    // Aplicar paginação
    query = query.range(offset, offset + limit - 1)

    // Ordenar por data de criação (ordenação numérica de matrícula feita no cliente)
    query = query.order('created_at', { ascending: true })

    const { data, error, count } = await query

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      )
    }

    return NextResponse.json({
      data,
      pagination: {
        page,
        limit,
        total: count || 0,
        total_pages: Math.ceil((count || 0) / limit),
      },
    })
  } catch (error) {
    console.error('GET /api/v1/members:', error)
    return NextResponse.json(
      { error: 'Erro interno do servidor' },
      { status: 500 }
    )
  }
}

/**
 * API ROUTE: Criar Membro
 * POST /api/v1/members
 * 
 * Body esperado:
 * {
 *   "name": "João Silva",
 *   "email": "joao@exemplo.com",
 *   "phone": "11999999999",
 *   "cpf": "12345678901",
 *   "birth_date": "1990-01-15",
 *   "gender": "M",
 *   "marital_status": "single",
 *   "address": "Rua X, 123",
 *   "city": "São Paulo",
 *   "state": "SP"
 * }
 * 
 * ⚠️  Necessário estar autenticado e ter ministry_id no JWT
 */

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerClientFromRequest(request)

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const normalizedBody = normalizePayloadToUppercase(body, {
      preserveKeys: [
        'member_since',
        'data_nascimento',
        'data_nascimento_conjuge',
        'data_batismo_aguas',
        'data_batismo_espirito_santo',
        'data_consagracao',
        'data_emissao',
        'data_validade_credencial',
        'data_filiacao',
        'ev_autorizado_data',
        'ev_consagrado_data',
        'cons_missionario_data',
        'orden_pastor_data',
        'latitude',
        'longitude',
        'cargoMinisterial',
        'cargo_ministerial',
        'procedencia',
        'dados_cargos',
        'qtd_filhos',
        'diretoria',
        'primeiro_casamento',
      ],
    })

    // Validar campos obrigatórios
    if (!normalizedBody.name) {
      return NextResponse.json(
        { error: 'Nome é obrigatório' },
        { status: 400 }
      )
    }

    // Inserir membro
    const { data, error } = await supabase
      .from('members')
      .insert([
        {
          name: normalizedBody.name,
          email: typeof normalizedBody.email === 'string' ? normalizedBody.email.toLowerCase() : normalizedBody.email || null,
          phone: normalizedBody.phone || null,
          cpf: normalizedBody.cpf || null,
          data_consagracao: normalizedBody.data_consagracao || null,
          data_emissao: normalizedBody.data_emissao || null,
          data_validade_credencial: normalizedBody.data_validade_credencial || null,
          // Aba Dados
          matricula: normalizedBody.matricula || null,
          unique_id: normalizedBody.unique_id || null,
          tipo_cadastro: normalizedBody.tipo_cadastro || 'ministro',
          data_nascimento: normalizedBody.data_nascimento || null,
          sexo: normalizedBody.sexo || null,
          tipo_sanguineo: normalizedBody.tipo_sanguineo || null,
          escolaridade: normalizedBody.escolaridade || null,
          estado_civil: normalizedBody.estado_civil || null,
          nome_conjuge: normalizedBody.nome_conjuge || null,
          cpf_conjuge: normalizedBody.cpf_conjuge || null,
          data_nascimento_conjuge: normalizedBody.data_nascimento_conjuge || null,
          nome_pai: normalizedBody.nome_pai || null,
          nome_mae: normalizedBody.nome_mae || null,
          rg: normalizedBody.rg || null,
          uf_rg: normalizedBody.uf_rg || null,
          orgao_emissor: normalizedBody.orgao_emissor || null,
          nacionalidade: normalizedBody.nacionalidade || null,
          naturalidade: normalizedBody.naturalidade || null,
          uf_naturalidade: normalizedBody.uf_naturalidade || null,
          titulo_eleitoral: normalizedBody.titulo_eleitoral || null,
          zona_eleitoral: normalizedBody.zona_eleitoral || null,
          secao_eleitoral: normalizedBody.secao_eleitoral || null,
          municipio_eleitoral: normalizedBody.municipio_eleitoral || null,
          email2: typeof normalizedBody.email2 === 'string' ? normalizedBody.email2.toLowerCase() : null,
          posicao_no_campo: normalizedBody.posicao_no_campo || null,
          numero_cgadb: normalizedBody.numero_cgadb || null,
          data_batismo_aguas: normalizedBody.data_batismo_aguas || null,
          data_batismo_espirito_santo: normalizedBody.data_batismo_espirito_santo || null,
          // Aba Endereço
          cep: normalizedBody.cep || null,
          logradouro: normalizedBody.logradouro || null,
          numero: normalizedBody.numero || null,
          bairro: normalizedBody.bairro || null,
          complemento: normalizedBody.complemento || null,
          cidade: normalizedBody.cidade || null,
          estado: normalizedBody.estado || null,
          // Aba Contato
          celular: normalizedBody.celular || null,
          whatsapp: normalizedBody.whatsapp || null,
          // Geolocalização
          congregacao_id: normalizedBody.congregacao_id || null,
          latitude: typeof normalizedBody.latitude === 'number' ? normalizedBody.latitude : null,
          longitude: typeof normalizedBody.longitude === 'number' ? normalizedBody.longitude : null,
          // Aba Ministerial
          profissao: normalizedBody.profissao || null,
          curso_teologico: normalizedBody.curso_teologico || null,
          instituicao_teologica: normalizedBody.instituicao_teologica || null,
          pastor_auxiliar: normalizedBody.pastor_auxiliar ?? false,
          procedencia: normalizedBody.procedencia || null,
          procedencia_local: normalizedBody.procedencia_local || null,
          cargo_ministerial: normalizedBody.cargo_ministerial || null,
          dados_cargos: normalizedBody.dados_cargos || {},
          tem_funcao_igreja: normalizedBody.tem_funcao_igreja ?? false,
          qual_funcao: normalizedBody.qual_funcao || null,
          setor_departamento: normalizedBody.setor_departamento || null,
          observacoes_ministeriais: normalizedBody.observacoes_ministeriais || null,
          // Aba Foto
          foto_url: normalizedBody.foto_url || null,
          // Dados de Consagração
          local_batismo: normalizedBody.local_batismo || null,
          data_filiacao: normalizedBody.data_filiacao || null,
          diretoria: normalizedBody.diretoria ?? false,
          ev_autorizado_data: normalizedBody.ev_autorizado_data || null,
          ev_autorizado_local: normalizedBody.ev_autorizado_local || null,
          ev_consagrado_data: normalizedBody.ev_consagrado_data || null,
          ev_consagrado_local: normalizedBody.ev_consagrado_local || null,
          cons_missionario_data: normalizedBody.cons_missionario_data || null,
          cons_missionario_local: normalizedBody.cons_missionario_local || null,
          orden_pastor_data: normalizedBody.orden_pastor_data || null,
          orden_pastor_local: normalizedBody.orden_pastor_local || null,
          // Registro Familiar
          conjuge_rg: normalizedBody.conjuge_rg || null,
          conjuge_orgao_emissor: normalizedBody.conjuge_orgao_emissor || null,
          conjuge_nacionalidade: normalizedBody.conjuge_nacionalidade || null,
          conjuge_naturalidade: normalizedBody.conjuge_naturalidade || null,
          conjuge_nome_pai: normalizedBody.conjuge_nome_pai || null,
          conjuge_nome_mae: normalizedBody.conjuge_nome_mae || null,
          conjuge_titulo_eleitoral: normalizedBody.conjuge_titulo_eleitoral || null,
          conjuge_fone: normalizedBody.conjuge_fone || null,
          conjuge_email: typeof normalizedBody.conjuge_email === 'string' ? normalizedBody.conjuge_email.toLowerCase() : null,
          conjuge_tipo_sanguineo: normalizedBody.conjuge_tipo_sanguineo || null,
          primeiro_casamento: normalizedBody.primeiro_casamento || 'SIM',
          qtd_filhos: typeof normalizedBody.qtd_filhos === 'number' ? normalizedBody.qtd_filhos : 0,
          // Sistema
          member_since: normalizedBody.member_since || new Date(),
          role: normalizedBody.role || null,
          status: normalizedBody.status || 'active',
          custom_fields: normalizedBody.custom_fields || {},
          observacoes: normalizedBody.observacoes || null,
        },
      ])
      .select()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json(data[0], { status: 201 })
  } catch (error) {
    console.error('POST /api/v1/members:', error)
    return NextResponse.json(
      { error: 'Erro interno do servidor' },
      { status: 500 }
    )
  }
}
