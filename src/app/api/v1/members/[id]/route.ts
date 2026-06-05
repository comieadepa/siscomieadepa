/**
 * API ROUTE: Operações em Membro Individual
 * GET /api/v1/members/:id  - Obter um membro
 * PUT /api/v1/members/:id  - Atualizar membro
 * DELETE /api/v1/members/:id - Deletar membro
 */

import { normalizePayloadToUppercase } from '@/lib/uppercase-normalizer'
import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/require-auth'
import { createServerClient } from '@/lib/supabase-server'

const MEMBERS_ROLES = ['super', 'administrador', 'comissao'] as const

/**
 * GET: Obter um membro pelo ID
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const auth = await requireRole(request, MEMBERS_ROLES)
    if (!auth.ok) return auth.response
    const supabase = createServerClient()

    const { data, error } = await supabase
      .from('members')
      .select('*')
      .eq('id', id)
      .single()

    if (error) {
      return NextResponse.json(
        { error: 'Membro não encontrado' },
        { status: 404 }
      )
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('GET /api/v1/members/:id:', error)
    return NextResponse.json(
      { error: 'Erro interno do servidor' },
      { status: 500 }
    )
  }
}

/**
 * PUT: Atualizar membro
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const body = await request.json()
    const normalizedBody = normalizePayloadToUppercase(body, {
      preserveKeys: [
        'member_since',
        'data_nascimento',
        'data_nascimento_conjuge',
        'data_batismo_aguas',
        'data_batismo_espirito_santo',
        'data_filiacao',
        'ev_autorizado_data',
        'ev_consagrado_data',
        'cons_missionario_data',
        'orden_pastor_data',
        'dados_cargos',
        'latitude',
        'longitude',
        'cargo_ministerial',
        'procedencia',
        'qtd_filhos',
        'diretoria',
        'primeiro_casamento',
        'conjuge_foto_url',
        'cred_validade',
      ],
    })
    const auth = await requireRole(request, MEMBERS_ROLES)
    if (!auth.ok) return auth.response
    const supabase = createServerClient()

    // Verificar se membro existe
    const { data: existing } = await supabase
      .from('members')
      .select('id')
      .eq('id', id)
      .single()

    if (!existing) {
      return NextResponse.json(
        { error: 'Membro não encontrado' },
        { status: 404 }
      )
    }

    const payload = {
      name: normalizedBody.name,
      email: typeof normalizedBody.email === 'string' ? normalizedBody.email.toLowerCase() : normalizedBody.email ?? null,
      phone: normalizedBody.phone ?? null,
      cpf: normalizedBody.cpf ?? null,
      // Aba Dados
      matricula: normalizedBody.matricula ?? null,
      unique_id: normalizedBody.unique_id ?? null,
      tipo_cadastro: normalizedBody.tipo_cadastro ?? null,
      data_nascimento: normalizedBody.data_nascimento ?? null,
      sexo: normalizedBody.sexo ?? null,
      tipo_sanguineo: normalizedBody.tipo_sanguineo ?? null,
      escolaridade: normalizedBody.escolaridade ?? null,
      estado_civil: normalizedBody.estado_civil ?? null,
      nome_conjuge: normalizedBody.nome_conjuge ?? null,
      cpf_conjuge: normalizedBody.cpf_conjuge ?? null,
      data_nascimento_conjuge: normalizedBody.data_nascimento_conjuge ?? null,
      nome_pai: normalizedBody.nome_pai ?? null,
      nome_mae: normalizedBody.nome_mae ?? null,
      rg: normalizedBody.rg ?? null,
      uf_rg: normalizedBody.uf_rg ?? null,
      orgao_emissor: normalizedBody.orgao_emissor ?? null,
      nacionalidade: normalizedBody.nacionalidade ?? null,
      naturalidade: normalizedBody.naturalidade ?? null,
      uf_naturalidade: normalizedBody.uf_naturalidade ?? null,
      titulo_eleitoral: normalizedBody.titulo_eleitoral ?? null,
      zona_eleitoral: normalizedBody.zona_eleitoral ?? null,
      secao_eleitoral: normalizedBody.secao_eleitoral ?? null,
      municipio_eleitoral: normalizedBody.municipio_eleitoral ?? null,
      email2: typeof normalizedBody.email2 === 'string' ? normalizedBody.email2.toLowerCase() : null,
      posicao_no_campo: normalizedBody.posicao_no_campo ?? null,
      numero_cgadb: normalizedBody.numero_cgadb ?? null,
      data_batismo_aguas: normalizedBody.data_batismo_aguas ?? null,
      data_batismo_espirito_santo: normalizedBody.data_batismo_espirito_santo ?? null,
      // Aba Endereço
      cep: normalizedBody.cep ?? null,
      logradouro: normalizedBody.logradouro ?? null,
      numero: normalizedBody.numero ?? null,
      bairro: normalizedBody.bairro ?? null,
      complemento: normalizedBody.complemento ?? null,
      cidade: normalizedBody.cidade ?? null,
      estado: normalizedBody.estado ?? null,
      // Aba Contato
      celular: normalizedBody.celular ?? null,
      whatsapp: normalizedBody.whatsapp ?? null,
      // Geolocalização
      supervisao_id: normalizedBody.supervisao_id ?? null,
      congregacao_id: normalizedBody.congregacao_id ?? null,
      latitude: typeof normalizedBody.latitude === 'number' ? normalizedBody.latitude : null,
      longitude: typeof normalizedBody.longitude === 'number' ? normalizedBody.longitude : null,
      // Aba Ministerial
      profissao: normalizedBody.profissao ?? null,
      curso_teologico: normalizedBody.curso_teologico ?? null,
      instituicao_teologica: normalizedBody.instituicao_teologica ?? null,
      pastor_auxiliar: normalizedBody.pastor_auxiliar ?? false,
      pastor_presidente: normalizedBody.pastor_presidente ?? false,
      procedencia: normalizedBody.procedencia ?? null,
      procedencia_local: normalizedBody.procedencia_local ?? null,
      cargo_ministerial: normalizedBody.cargo_ministerial ?? null,
      tem_funcao_igreja: normalizedBody.tem_funcao_igreja ?? false,
      qual_funcao: normalizedBody.qual_funcao ?? null,
      setor_departamento: normalizedBody.setor_departamento ?? null,
      observacoes_ministeriais: normalizedBody.observacoes_ministeriais ?? null,
      cred_validade: normalizedBody.cred_validade ?? null,
      // Dados de Consagração
      local_batismo: normalizedBody.local_batismo ?? null,
      data_filiacao: normalizedBody.data_filiacao ?? null,
      diretoria: normalizedBody.diretoria ?? false,
      diretoria_cargo: normalizedBody.diretoria_cargo ?? null,
      ev_autorizado_data: normalizedBody.ev_autorizado_data ?? null,
      ev_autorizado_local: normalizedBody.ev_autorizado_local ?? null,
      ev_consagrado_data: normalizedBody.ev_consagrado_data ?? null,
      ev_consagrado_local: normalizedBody.ev_consagrado_local ?? null,
      cons_missionario_data: normalizedBody.cons_missionario_data ?? null,
      cons_missionario_local: normalizedBody.cons_missionario_local ?? null,
      orden_pastor_data: normalizedBody.orden_pastor_data ?? null,
      orden_pastor_local: normalizedBody.orden_pastor_local ?? null,
      // Registro Familiar
      conjuge_rg: normalizedBody.conjuge_rg ?? null,
      conjuge_orgao_emissor: normalizedBody.conjuge_orgao_emissor ?? null,
      conjuge_nacionalidade: normalizedBody.conjuge_nacionalidade ?? null,
      conjuge_naturalidade: normalizedBody.conjuge_naturalidade ?? null,
      conjuge_nome_pai: normalizedBody.conjuge_nome_pai ?? null,
      conjuge_nome_mae: normalizedBody.conjuge_nome_mae ?? null,
      conjuge_titulo_eleitoral: normalizedBody.conjuge_titulo_eleitoral ?? null,
      conjuge_fone: normalizedBody.conjuge_fone ?? null,
      conjuge_email: typeof normalizedBody.conjuge_email === 'string' ? normalizedBody.conjuge_email.toLowerCase() : null,
      conjuge_tipo_sanguineo: normalizedBody.conjuge_tipo_sanguineo ?? null,
      conjuge_foto_url: normalizedBody.conjuge_foto_url ?? null,
      primeiro_casamento: normalizedBody.primeiro_casamento ?? 'SIM',
      qtd_filhos: typeof normalizedBody.qtd_filhos === 'number' ? normalizedBody.qtd_filhos : 0,
      // Aba Foto — só atualiza se o campo foi enviado explicitamente; caso contrário preserva o valor atual
      ...('foto_url' in normalizedBody ? { foto_url: normalizedBody.foto_url ?? null } : {}),
      // Sistema
      member_since: normalizedBody.member_since ?? undefined,
      role: normalizedBody.role ?? null,
      status: normalizedBody.status ?? undefined,
      custom_fields: normalizedBody.custom_fields ?? {},
      observacoes: normalizedBody.observacoes ?? null,
      updated_at: new Date().toISOString(),
    }

    // Atualizar
    let { data, error } = await supabase
      .from('members')
      .update(payload)
      .eq('id', id)
      .select()



    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      )
    }

    if (!data || data.length === 0) {
      return NextResponse.json(
        { error: 'Nenhuma linha atualizada' },
        { status: 404 }
      )
    }

    return NextResponse.json(data[0])
  } catch (error) {
    console.error('PUT /api/v1/members/:id:', error)
    return NextResponse.json(
      { error: 'Erro interno do servidor' },
      { status: 500 }
    )
  }
}

/**
 * PATCH: Atualizar campos parciais de membro
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const auth = await requireRole(request, MEMBERS_ROLES)
    if (!auth.ok) return auth.response
    const supabase = createServerClient()

    const body = await request.json().catch(() => null as any)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Payload invalido' }, { status: 400 })
    }

    const updates: Record<string, any> = {}
    if ('custom_fields' in body) updates.custom_fields = body.custom_fields ?? {}
    if ('status' in body) updates.status = body.status ?? null
    if ('jubilado' in body) updates.jubilado = body.jubilado ?? false
    if ('observacoes' in body) updates.observacoes = body.observacoes ?? null

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'Nenhuma atualizacao enviada' }, { status: 400 })
    }

    updates.updated_at = new Date().toISOString()

    const { data, error } = await supabase
      .from('members')
      .update(updates)
      .eq('id', id)
      .select('*')
      .maybeSingle()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    if (!data) {
      return NextResponse.json({ error: 'Membro não encontrado' }, { status: 404 })
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('PATCH /api/v1/members/:id:', error)
    return NextResponse.json(
      { error: 'Erro interno do servidor' },
      { status: 500 }
    )
  }
}

/**
 * DELETE: Deletar membro
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const auth = await requireRole(request, MEMBERS_ROLES)
    if (!auth.ok) return auth.response
    const supabase = createServerClient()

    // Verificar se existe
    const { data: existing } = await supabase
      .from('members')
      .select('id')
      .eq('id', id)
      .single()

    if (!existing) {
      return NextResponse.json(
        { error: 'Membro não encontrado' },
        { status: 404 }
      )
    }

    // Deletar
    const { error } = await supabase
      .from('members')
      .delete()
      .eq('id', id)

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      )
    }

    return NextResponse.json({ success: true, deleted_id: id })
  } catch (error) {
    console.error('DELETE /api/v1/members/:id:', error)
    return NextResponse.json(
      { error: 'Erro interno do servidor' },
      { status: 500 }
    )
  }
}
