'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect, useCallback } from 'react'
import { useRequireSupabaseAuth } from '@/hooks/useRequireSupabaseAuth'
import Sidebar from '@/components/Sidebar'
import AccessRestricted from '@/components/AccessRestricted'
import { useUserRole } from '@/hooks/useUserRole'
import { canAccessModule } from '@/lib/auth/roles'

type AuditLog = {
  id: string
  user_id?: string
  usuario_email: string | null
  acao: string | null
  action?: string | null
  modulo: string | null
  area: string | null
  descricao: string | null
  status: string
  created_at: string
  ip_address?: string | null
  user_agent?: string | null
  tabela_afetada?: string | null
  dados_anteriores?: Record<string, unknown> | null
  dados_novos?: Record<string, unknown> | null
  mensagem_erro?: string | null
}

type Stats = {
  total: number
  erros: number
  avisos: number
  sucessos: number
  acaoMaisFrequente: string | null
  usuarioMaisAtivo: string | null
}

const ACOES = ['criar','editar','deletar','visualizar','exportar','importar','login','logout','checkin','enviar_certificado','baixa_financeira','alterar_permissoes','upload','download','erro_critico']
const MODULOS = ['eventos','inscricoes','financeiro','membros','secretaria','usuarios','configuracoes','certificados','checkin','etiquetas','auth','auditoria']

const ACAO_ICONS: Record<string, string> = {
  criar: '➕', editar: '✏️', deletar: '🗑️', visualizar: '👁️',
  exportar: '📤', importar: '📥', login: '🔓', logout: '🔒',
  checkin: '✅', enviar_certificado: '🎓', baixa_financeira: '💰',
  alterar_permissoes: '🔑', upload: '⬆️', download: '⬇️', erro_critico: '🚨',
}

const PERIODO_DIAS: Record<string, number | null> = {
  hoje: 0, '7dias': 7, '30dias': 30, '90dias': 90, todos: null,
}

const PAGE_SIZE = 50

function calcStats(logs: AuditLog[]): Stats {
  const total = logs.length
  const erros = logs.filter(l => l.status === 'erro').length
  const avisos = logs.filter(l => l.status === 'aviso').length
  const sucessos = logs.filter(l => l.status === 'sucesso').length

  const acaoCount: Record<string, number> = {}
  const userCount: Record<string, number> = {}
  for (const l of logs) {
    if (l.acao) acaoCount[l.acao] = (acaoCount[l.acao] ?? 0) + 1
    const email = l.usuario_email
    if (email) userCount[email] = (userCount[email] ?? 0) + 1
  }

  const acaoMaisFrequente = Object.entries(acaoCount).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  const usuarioMaisAtivo = Object.entries(userCount).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null

  return { total, erros, avisos, sucessos, acaoMaisFrequente, usuarioMaisAtivo }
}

export default function AuditoriaPage() {
  const { loading: authLoading } = useRequireSupabaseAuth()
  const { role, loading: roleLoading } = useUserRole()

  const [activeMenu, setActiveMenu] = useState('auditoria')
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [stats, setStats] = useState<Stats | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const [busca, setBusca] = useState('')

  // Filtros
  const [filtroAcao, setFiltroAcao] = useState('todos')
  const [filtroModulo, setFiltroModulo] = useState('todos')
  const [filtroStatus, setFiltroStatus] = useState('todos')
  const [filtroPeriodo, setFiltroPeriodo] = useState('7dias')
  const [filtroUsuario, setFiltroUsuario] = useState('')

  const podeAcessar = canAccessModule(role, 'auditoria')

  const carregarLogs = useCallback(async () => {
    try {
      setLoading(true)
      setError('')
      setPage(0)

      const params = new URLSearchParams()
      if (filtroAcao !== 'todos') params.set('acao', filtroAcao)
      if (filtroModulo !== 'todos') params.set('modulo', filtroModulo)
      if (filtroStatus !== 'todos') params.set('status', filtroStatus)
      if (filtroUsuario.trim()) params.set('usuario_email', filtroUsuario.trim())

      const dias = PERIODO_DIAS[filtroPeriodo]
      if (dias !== null) {
        const d = new Date()
        if (dias === 0) d.setHours(0, 0, 0, 0)
        else d.setDate(d.getDate() - dias)
        params.set('dataInicio', d.toISOString())
      }

      const res = await fetch(`/api/v1/audit-logs?${params.toString()}`)
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData?.error || `HTTP ${res.status}`)
      }
      const data = await res.json()
      const fetched: AuditLog[] = data.logs ?? []
      setLogs(fetched)
      setStats(calcStats(fetched))
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro desconhecido'
      setError('Erro ao carregar logs: ' + msg)
    } finally {
      setLoading(false)
    }
  }, [filtroAcao, filtroModulo, filtroStatus, filtroPeriodo, filtroUsuario])

  useEffect(() => {
    if (authLoading || roleLoading || !podeAcessar) return
    carregarLogs()
  }, [authLoading, roleLoading, podeAcessar, carregarLogs])

  const exportarCSV = () => {
    const linhas = [
      ['Data/Hora', 'Usuário', 'Ação', 'Módulo', 'Área', 'Tabela', 'Status', 'Descrição', 'IP'].join(';'),
      ...logs.map(l =>
        [
          new Date(l.created_at).toLocaleString('pt-BR'),
          l.usuario_email ?? '',
          l.acao ?? '',
          l.modulo ?? '',
          l.area ?? '',
          l.tabela_afetada ?? '',
          l.status,
          (l.descricao ?? '').replace(/;/g, ','),
          l.ip_address ?? '',
        ].join(';')
      ),
    ]
    const blob = new Blob(['\uFEFF' + linhas.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `auditoria_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Filtro local de busca (texto livre)
  const logsFiltrados = busca.trim()
    ? logs.filter(
        l =>
          l.descricao?.toLowerCase().includes(busca.toLowerCase()) ||
          l.usuario_email?.toLowerCase().includes(busca.toLowerCase()) ||
          l.acao?.toLowerCase().includes(busca.toLowerCase()) ||
          l.modulo?.toLowerCase().includes(busca.toLowerCase())
      )
    : logs

  const totalPaginas = Math.ceil(logsFiltrados.length / PAGE_SIZE)
  const logsNaPagina = logsFiltrados.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  const formatarData = (data: string) =>
    new Date(data).toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })

  const statusBadge = (status: string) => {
    switch (status) {
      case 'sucesso': return 'bg-green-100 text-green-800 border-green-200'
      case 'erro':    return 'bg-red-100 text-red-800 border-red-200'
      case 'aviso':   return 'bg-yellow-100 text-yellow-800 border-yellow-200'
      default:        return 'bg-gray-100 text-gray-700 border-gray-200'
    }
  }

  const statusBorderColor = (status: string) => {
    switch (status) {
      case 'sucesso': return '#10b981'
      case 'erro':    return '#ef4444'
      case 'aviso':   return '#f59e0b'
      default:        return '#d1d5db'
    }
  }

  if (authLoading || roleLoading) {
    return (
      <div className="flex min-h-screen bg-gray-100">
        <Sidebar activeMenu={activeMenu} setActiveMenu={setActiveMenu} />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-gray-500">Carregando...</div>
        </div>
      </div>
    )
  }

  if (!podeAcessar) {
    return (
      <div className="flex min-h-screen bg-gray-100">
        <Sidebar activeMenu={activeMenu} setActiveMenu={setActiveMenu} />
        <div className="flex-1 p-6">
          <AccessRestricted message="Você não tem permissão para acessar a auditoria." />
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen bg-gradient-to-br from-[#f8f9fa] to-[#e9ecef]">
      <Sidebar activeMenu={activeMenu} setActiveMenu={setActiveMenu} />

      <div className="flex-1 p-6 overflow-auto">
        <div className="max-w-7xl mx-auto space-y-6">

          {/* HEADER */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-[#123b63]">Auditoria</h1>
              <p className="text-gray-500 mt-1">Registro completo de ações e atividades no sistema</p>
            </div>
            {!loading && logs.length > 0 && (
              <button
                onClick={exportarCSV}
                className="flex items-center gap-2 px-4 py-2 bg-[#123b63] text-white rounded-lg hover:bg-[#0e2d4e] transition text-sm font-medium shadow"
              >
                📥 Exportar CSV
              </button>
            )}
          </div>

          {/* STATS CARDS */}
          {stats && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-white rounded-xl shadow p-4 border-l-4 border-blue-400">
                <p className="text-xs text-gray-500 uppercase tracking-wide">Total de Logs</p>
                <p className="text-3xl font-bold text-gray-800 mt-1">{stats.total.toLocaleString('pt-BR')}</p>
              </div>
              <div className="bg-white rounded-xl shadow p-4 border-l-4 border-green-400">
                <p className="text-xs text-gray-500 uppercase tracking-wide">Sucesso</p>
                <p className="text-3xl font-bold text-green-700 mt-1">{stats.sucessos.toLocaleString('pt-BR')}</p>
              </div>
              <div className="bg-white rounded-xl shadow p-4 border-l-4 border-red-400">
                <p className="text-xs text-gray-500 uppercase tracking-wide">Erros</p>
                <p className="text-3xl font-bold text-red-700 mt-1">{stats.erros.toLocaleString('pt-BR')}</p>
              </div>
              <div className="bg-white rounded-xl shadow p-4 border-l-4 border-yellow-400">
                <p className="text-xs text-gray-500 uppercase tracking-wide">Avisos</p>
                <p className="text-3xl font-bold text-yellow-700 mt-1">{stats.avisos.toLocaleString('pt-BR')}</p>
              </div>
              {stats.acaoMaisFrequente && (
                <div className="bg-white rounded-xl shadow p-4 border-l-4 border-purple-400 md:col-span-2">
                  <p className="text-xs text-gray-500 uppercase tracking-wide">Ação mais frequente</p>
                  <p className="text-lg font-bold text-gray-800 mt-1 capitalize">{stats.acaoMaisFrequente}</p>
                </div>
              )}
              {stats.usuarioMaisAtivo && (
                <div className="bg-white rounded-xl shadow p-4 border-l-4 border-indigo-400 md:col-span-2">
                  <p className="text-xs text-gray-500 uppercase tracking-wide">Usuário mais ativo</p>
                  <p className="text-lg font-bold text-gray-800 mt-1 truncate">{stats.usuarioMaisAtivo}</p>
                </div>
              )}
            </div>
          )}

          {/* FILTROS */}
          <div className="bg-white rounded-xl shadow p-5">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Ação</label>
                <select value={filtroAcao} onChange={e => setFiltroAcao(e.target.value)}
                  className="w-full px-2 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:border-[#0284c7]">
                  <option value="todos">Todas</option>
                  {ACOES.map(a => (
                    <option key={a} value={a}>{a.replace(/_/g, ' ')}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Módulo</label>
                <select value={filtroModulo} onChange={e => setFiltroModulo(e.target.value)}
                  className="w-full px-2 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:border-[#0284c7]">
                  <option value="todos">Todos</option>
                  {MODULOS.map(m => (
                    <option key={m} value={m}>{m.charAt(0).toUpperCase() + m.slice(1)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Status</label>
                <select value={filtroStatus} onChange={e => setFiltroStatus(e.target.value)}
                  className="w-full px-2 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:border-[#0284c7]">
                  <option value="todos">Todos</option>
                  <option value="sucesso">Sucesso</option>
                  <option value="erro">Erro</option>
                  <option value="aviso">Aviso</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Período</label>
                <select value={filtroPeriodo} onChange={e => setFiltroPeriodo(e.target.value)}
                  className="w-full px-2 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:border-[#0284c7]">
                  <option value="hoje">Hoje</option>
                  <option value="7dias">Últimos 7 dias</option>
                  <option value="30dias">Últimos 30 dias</option>
                  <option value="90dias">Últimos 90 dias</option>
                  <option value="todos">Todos</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Usuário</label>
                <input type="text" value={filtroUsuario} onChange={e => setFiltroUsuario(e.target.value)}
                  placeholder="Email..." className="w-full px-2 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:border-[#0284c7]" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Busca livre</label>
                <input type="text" value={busca} onChange={e => setBusca(e.target.value)}
                  placeholder="Descrição, ação..." className="w-full px-2 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:border-[#0284c7]" />
              </div>
            </div>
          </div>

          {/* ERRO */}
          {error && (
            <div className="p-4 bg-red-50 border-l-4 border-red-400 rounded-lg">
              <p className="text-red-800 font-semibold">{error}</p>
              <button onClick={carregarLogs} className="mt-2 text-sm underline text-red-700">Tentar novamente</button>
            </div>
          )}

          {/* TABELA */}
          {loading ? (
            <div className="bg-white rounded-xl shadow p-12 text-center">
              <div className="text-3xl animate-spin inline-block mb-3">⏳</div>
              <p className="text-gray-500">Carregando logs de auditoria...</p>
            </div>
          ) : logsFiltrados.length === 0 ? (
            <div className="bg-white rounded-xl shadow p-12 text-center">
              <p className="text-5xl mb-4">🔍</p>
              <p className="text-gray-600 font-medium">Nenhum log encontrado</p>
              <p className="text-gray-400 text-sm mt-1">Tente ajustar os filtros ou o período</p>
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                <p className="text-sm text-gray-500">
                  {logsFiltrados.length.toLocaleString('pt-BR')} registro{logsFiltrados.length !== 1 ? 's' : ''}
                  {totalPaginas > 1 && ` — página ${page + 1} de ${totalPaginas}`}
                </p>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide border-b border-gray-100">
                    <tr>
                      <th className="px-4 py-3 text-left">Data/Hora</th>
                      <th className="px-4 py-3 text-left">Usuário</th>
                      <th className="px-4 py-3 text-left">Ação</th>
                      <th className="px-4 py-3 text-left">Módulo</th>
                      <th className="px-4 py-3 text-left">Status</th>
                      <th className="px-4 py-3 text-left">Descrição</th>
                      <th className="px-4 py-3 text-left">IP</th>
                      <th className="px-4 py-3"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {logsNaPagina.map(log => (
                      <>
                        <tr
                          key={log.id}
                          className="hover:bg-gray-50 transition-colors cursor-pointer"
                          style={{ borderLeft: `3px solid ${statusBorderColor(log.status)}` }}
                          onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
                        >
                          <td className="px-4 py-3 whitespace-nowrap text-gray-600 font-mono text-xs">
                            {formatarData(log.created_at)}
                          </td>
                          <td className="px-4 py-3 max-w-[180px] truncate text-gray-700 text-xs">
                            {log.usuario_email ?? '—'}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className="flex items-center gap-1">
                              <span>{ACAO_ICONS[log.acao ?? ''] ?? '📝'}</span>
                              <span className="capitalize text-gray-700">{log.acao ?? '—'}</span>
                            </span>
                          </td>
                          <td className="px-4 py-3 capitalize text-gray-600">{log.modulo ?? '—'}</td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${statusBadge(log.status)}`}>
                              {log.status}
                            </span>
                          </td>
                          <td className="px-4 py-3 max-w-[250px] truncate text-gray-500 text-xs">
                            {log.descricao ?? '—'}
                          </td>
                          <td className="px-4 py-3 text-gray-400 font-mono text-xs whitespace-nowrap">
                            {log.ip_address ?? '—'}
                          </td>
                          <td className="px-4 py-3 text-gray-400 text-xs">
                            {(log.dados_anteriores || log.dados_novos || log.mensagem_erro) ? (
                              <span className="text-blue-500">{expandedId === log.id ? '▲' : '▼'}</span>
                            ) : null}
                          </td>
                        </tr>
                        {expandedId === log.id && (
                          <tr key={`${log.id}-detail`} className="bg-blue-50">
                            <td colSpan={8} className="px-6 py-4">
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {log.mensagem_erro && (
                                  <div className="md:col-span-2">
                                    <p className="text-xs font-bold text-red-600 uppercase mb-1">Mensagem de Erro</p>
                                    <pre className="bg-red-50 border border-red-200 rounded p-2 text-xs text-red-700 whitespace-pre-wrap">{log.mensagem_erro}</pre>
                                  </div>
                                )}
                                {log.dados_anteriores && (
                                  <div>
                                    <p className="text-xs font-bold text-gray-500 uppercase mb-1">Dados Anteriores</p>
                                    <pre className="bg-gray-100 rounded p-2 text-xs text-gray-700 overflow-auto max-h-40 whitespace-pre-wrap">
                                      {JSON.stringify(log.dados_anteriores, null, 2)}
                                    </pre>
                                  </div>
                                )}
                                {log.dados_novos && (
                                  <div>
                                    <p className="text-xs font-bold text-gray-500 uppercase mb-1">Dados Novos</p>
                                    <pre className="bg-gray-100 rounded p-2 text-xs text-gray-700 overflow-auto max-h-40 whitespace-pre-wrap">
                                      {JSON.stringify(log.dados_novos, null, 2)}
                                    </pre>
                                  </div>
                                )}
                                {log.tabela_afetada && (
                                  <div>
                                    <p className="text-xs font-bold text-gray-500 uppercase mb-1">Tabela Afetada</p>
                                    <code className="bg-gray-200 px-2 py-1 rounded text-xs text-gray-800">{log.tabela_afetada}</code>
                                  </div>
                                )}
                                {log.user_agent && (
                                  <div>
                                    <p className="text-xs font-bold text-gray-500 uppercase mb-1">User Agent</p>
                                    <p className="text-xs text-gray-600 break-words">{log.user_agent}</p>
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* PAGINAÇÃO */}
              {totalPaginas > 1 && (
                <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between">
                  <button
                    onClick={() => setPage(p => Math.max(0, p - 1))}
                    disabled={page === 0}
                    className="px-3 py-1 text-sm border border-gray-300 rounded-lg disabled:opacity-40 hover:bg-gray-50 transition"
                  >
                    ← Anterior
                  </button>
                  <div className="flex gap-1">
                    {Array.from({ length: Math.min(totalPaginas, 7) }, (_, i) => {
                      const pageNum = totalPaginas <= 7 ? i : page < 4 ? i : page > totalPaginas - 4 ? totalPaginas - 7 + i : page - 3 + i
                      return (
                        <button
                          key={pageNum}
                          onClick={() => setPage(pageNum)}
                          className={`w-8 h-8 text-sm rounded-lg transition ${pageNum === page ? 'bg-[#123b63] text-white' : 'border border-gray-300 hover:bg-gray-50'}`}
                        >
                          {pageNum + 1}
                        </button>
                      )
                    })}
                  </div>
                  <button
                    onClick={() => setPage(p => Math.min(totalPaginas - 1, p + 1))}
                    disabled={page >= totalPaginas - 1}
                    className="px-3 py-1 text-sm border border-gray-300 rounded-lg disabled:opacity-40 hover:bg-gray-50 transition"
                  >
                    Próxima →
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
