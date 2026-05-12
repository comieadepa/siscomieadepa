'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase-client'
import { getEquipeSession } from '@/lib/equipe-session'

export function useRequireSupabaseAuth(options?: { redirectTo?: string; allowEquipeSession?: { eventoId?: string }; allowAnonymous?: boolean }) {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])

  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const redirectTo = options?.redirectTo || '/'

    const run = async () => {
      try {
        if (options?.allowEquipeSession) {
          const sess = getEquipeSession()
          const eventoId = options.allowEquipeSession.eventoId
          if (sess && (!eventoId || sess.eventoId === eventoId)) {
            setLoading(false)
            return
          }
        }

        const { data } = await supabase.auth.getUser()
        if (!data.user) {
          if (options?.allowAnonymous) {
            setLoading(false)
            return
          }
          router.push(redirectTo)
          return
        }
        setUser(data.user)
      } finally {
        setLoading(false)
      }
    }

    run()
  }, [router, supabase, options?.redirectTo, options?.allowEquipeSession?.eventoId])

  return { user, loading }
}
