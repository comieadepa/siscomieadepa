/**
 * HOOKS REACT para usar API de Membros
 * Arquivo: src/hooks/useMembers.ts
 * 
 * Exemplos de uso:
 * const { members, loading, error, createMember, updateMember, deleteMember } = useMembers()
 */

'use client'

import { useCallback, useState } from 'react'
import type { Member, CreateMemberRequest, UpdateMemberRequest } from '@/types/supabase'
import { createClient } from '@/lib/supabase-client'

// Cache em memória: persiste enquanto o browser não recarrega a página.
// Permite exibição imediata ao voltar para a tela de membros.
const _cache: { members: Member[]; ts: number } = { members: [], ts: 0 };
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos

function isCacheFresh() {
  return _cache.members.length > 0 && Date.now() - _cache.ts < CACHE_TTL_MS;
}

function invalidateCache() {
  _cache.members = [];
  _cache.ts = 0;
}

async function getAccessTokenOrThrow() {
  const supabase = createClient()
  const { data } = await supabase.auth.getSession()
  let token = data.session?.access_token

  // getSession pode retornar null durante a hidratação inicial (SSR/storage ainda não lido).
  // Tentativa extra com refreshSession para garantir que o token seja recuperado.
  if (!token) {
    const { data: refreshed } = await supabase.auth.refreshSession()
    token = refreshed.session?.access_token
  }

  if (!token) throw new Error('Não autenticado')
  return token
}

export function useMembers() {
  const [members, setMembers] = useState<Member[]>(() => _cache.members)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Listar membros
  const fetchMembers = useCallback(
    async (page = 1, limit = 20, filters?: { status?: string; search?: string; tipoCadastro?: string }) => {
      // Se o cache estiver fresco e não houver filtros específicos, usa cache sem request
      const hasFilters = filters?.status || filters?.search || filters?.tipoCadastro;
      if (!hasFilters && isCacheFresh()) {
        setMembers(_cache.members);
        return { data: _cache.members, pagination: { page: 1, limit: _cache.members.length, total: _cache.members.length, total_pages: 1 } };
      }

      try {
        setLoading(true)
        setError(null)

        const params = new URLSearchParams({
          page: page.toString(),
          limit: limit.toString(),
          ...(filters?.status && { status: filters.status }),
          ...(filters?.search && { search: filters.search }),
          ...(filters?.tipoCadastro && { tipoCadastro: filters.tipoCadastro }),
        })

        const accessToken = await getAccessTokenOrThrow()

        const response = await fetch(`/api/v1/members?${params}`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
        })

        if (!response.ok) {
          const errorData = await response
            .json()
            .catch(() => ({} as any))

          const message =
            (errorData && typeof errorData.error === 'string' && errorData.error) ||
            'Erro ao carregar membros'

          // Caso comum em ambiente de trial/onboarding: usuário autenticado, mas ainda sem vínculo em ministry_users
          if (response.status === 403 && errorData?.code === 'NO_MINISTRY') {
            setMembers([])
            setError(message)
            return {
              data: [],
              pagination: {
                page,
                limit,
                total: 0,
                total_pages: 0,
              },
            }
          }

          throw new Error(message)
        }

        const data = await response.json()
        setMembers(data.data)
        // Atualizar cache em memória
        if (!hasFilters) {
          _cache.members = data.data;
          _cache.ts = Date.now();
        }

        return data
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Erro desconhecido'
        setError(message)
        throw err
      } finally {
        setLoading(false)
      }
    },
    []
  )

  // Obter um membro
  const getMember = useCallback(async (id: string) => {
    try {
      const accessToken = await getAccessTokenOrThrow()
      const response = await fetch(`/api/v1/members/${id}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      })

      if (!response.ok) {
        throw new Error('Membro não encontrado')
      }

      return await response.json()
    } catch (err) {
      throw err
    }
  }, [])

  // Criar membro
  const createMember = useCallback(
    async (data: CreateMemberRequest) => {
      try {
        setLoading(true)
        setError(null)

        const accessToken = await getAccessTokenOrThrow()

        const response = await fetch('/api/v1/members', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify(data),
        })

        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(errorData.error || 'Erro ao criar membro')
        }

        const newMember = await response.json()
        setMembers((prev) => {
          const next = [...prev, newMember];
          _cache.members = next; _cache.ts = Date.now();
          return next;
        })

        return newMember
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Erro desconhecido'
        setError(message)
        throw err
      } finally {
        setLoading(false)
      }
    },
    []
  )

  // Atualizar membro
  const updateMember = useCallback(
    async (id: string, data: UpdateMemberRequest) => {
      try {
        setLoading(true)
        setError(null)

        const accessToken = await getAccessTokenOrThrow()

        const response = await fetch(`/api/v1/members/${id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify(data),
        })

        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(errorData.error || 'Erro ao atualizar membro')
        }

        const updated = await response.json()
        setMembers((prev) => {
          const next = prev.map((member) => (member.id === id ? updated : member));
          _cache.members = next; _cache.ts = Date.now();
          return next;
        })

        return updated
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Erro desconhecido'
        setError(message)
        throw err
      } finally {
        setLoading(false)
      }
    },
    []
  )

  // Deletar membro
  const deleteMember = useCallback(
    async (id: string) => {
      try {
        setLoading(true)
        setError(null)

        const accessToken = await getAccessTokenOrThrow()

        const response = await fetch(`/api/v1/members/${id}`, {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        })

        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(errorData.error || 'Erro ao deletar membro')
        }

        setMembers((prev) => {
          const next = prev.filter((member) => member.id !== id);
          _cache.members = next; _cache.ts = Date.now();
          return next;
        })

        return true
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Erro desconhecido'
        setError(message)
        throw err
      } finally {
        setLoading(false)
      }
    },
    []
  )

  // Limpar erro
  const clearError = useCallback(() => {
    setError(null)
  }, [])

  return {
    members,
    loading,
    error,
    clearError,
    fetchMembers,
    getMember,
    createMember,
    updateMember,
    deleteMember,
  }
}
