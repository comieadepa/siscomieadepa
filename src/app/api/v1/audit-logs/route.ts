import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createServerClientFromRequest } from '@/lib/supabase-server'

export async function POST(request: NextRequest) {
  try {
    const authClient = createServerClientFromRequest(request)
    const adminClient = createServerClient()

    // Obter usuário
    const {
      data: { user },
    } = await authClient.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
    }

    // Parse do body
    const body = await request.json()

    // Obter IP
    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0] ||
      request.headers.get('x-real-ip') ||
      'desconhecido'

    // Obter User Agent
    const userAgent = request.headers.get('user-agent') || 'desconhecido'

    const tryInsert = async (payload: Record<string, any>) => {
      const { error } = await adminClient.from('audit_logs').insert(payload)
      return error || null
    }

    // Inserir log com mapeamento para schema real da tabela
    let error = await tryInsert({
      user_id: user.id,
      usuario_email: body.usuario_email || user.email,
      action: body.acao || body.action || 'outro',
      resource_type: body.modulo || body.resource_type || 'sistema',
      resource_id: body.registro_id || null,
      acao: body.acao,
      modulo: body.modulo,
      area: body.area,
      tabela_afetada: body.tabela_afetada,
      descricao: body.descricao,
      dados_anteriores: body.dados_anteriores || null,
      dados_novos: body.dados_novos || null,
      old_data: body.dados_anteriores || null,
      new_data: body.dados_novos || null,
      ip_address: ip,
      user_agent: userAgent,
      status: body.status || 'sucesso',
      mensagem_erro: body.mensagem_erro,
    })

    if (!error) {
      return NextResponse.json({ success: true, message: 'Log registrado' })
    }

    // Se tabela não existe, ignorar silenciosamente
    if (error.code === 'PGRST116' || error.message?.includes('not found') || error.message?.includes('does not exist')) {
      return NextResponse.json(
        { message: 'Tabela ainda não existe, será criada na próxima requisição' },
        { status: 202 },
      )
    }

    console.error('Falha ao registrar auditoria:', error)
    return NextResponse.json(
      { success: false, message: 'Falha ao registrar auditoria' },
      { status: 200 },
    )
  } catch (error) {
    console.error('Erro ao registrar auditoria:', error)
    return NextResponse.json(
      { success: false, message: 'Falha ao registrar auditoria' },
      { status: 200 },
    )
  }
}

export async function GET(request: NextRequest) {
  try {
    const supabase = createServerClientFromRequest(request)

    // Obter usuário
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
    }

    // Obter query params
    const { searchParams } = new URL(request.url)
    const acao = searchParams.get('acao')
    const modulo = searchParams.get('modulo')
    const status = searchParams.get('status')
    const usuario_email = searchParams.get('usuario_email')
    const dataInicio = searchParams.get('dataInicio')
    const dataFim = searchParams.get('dataFim')

    // Montar query — sem filtro por usuário; a auditoria é acessível só a super (RLS + role check na página)
    let query = supabase
      .from('audit_logs')
      .select('*')

    // Aplicar filtros
    if (acao) query = query.eq('acao', acao)
    if (modulo) query = query.eq('modulo', modulo)
    if (status) query = query.eq('status', status)
    if (usuario_email) query = query.ilike('usuario_email', `%${usuario_email}%`)

    // Filtro de data
    if (dataInicio) query = query.gte('created_at', dataInicio)
    if (dataFim) query = query.lte('created_at', dataFim)

    // Ordenar e limitar
    const { data, error } = await query
      .order('created_at', { ascending: false })
      .limit(500)

    if (error) {
      // Se tabela não existe
      if (error.code === 'PGRST116' || error.message?.includes('not found')) {
        return NextResponse.json(
          { logs: [], message: 'Tabela será criada automaticamente' },
          { status: 200 },
        )
      }
      throw error
    }

    return NextResponse.json({ logs: data || [] })
  } catch (error) {
    console.error('Erro ao buscar auditoria:', error)
    return NextResponse.json(
      { error: 'Erro ao buscar logs' },
      { status: 500 },
    )
  }
}
