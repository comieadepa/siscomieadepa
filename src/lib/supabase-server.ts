/**
 * CLIENTE SUPABASE PARA SERVIDOR (service_role key)
 * Acesso TOTAL ao banco de dados (ignora RLS)
 * 
 * Arquivo: src/lib/supabase-server.ts
 * Uso: API routes, funções administrativas
 * ⚠️  NUNCA exponha este cliente ao frontend!
 */

import { createClient } from '@supabase/supabase-js'
import { createServerClient as createSSRServerClient } from '@supabase/ssr'
import { NextRequest } from 'next/server'
import { cookies } from 'next/headers'

export function createServerClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return createClient(
    supabaseUrl!,
    serviceRoleKey!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  )
}

export function createServerClientFromRequest(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  const authHeader = request.headers.get('Authorization') || request.headers.get('authorization') || ''
  const token = authHeader.replace(/^Bearer\s+/i, '')

  return createClient(
    supabaseUrl!,
    anonKey!,
    {
      global: {
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: anonKey || '',
        },
      },
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    }
  )
}

/**
 * createServerClientFromCookies
 * Lê a sessão do usuário a partir dos cookies do browser (padrão @supabase/ssr).
 * Use em API Routes do App Router que precisam validar o usuário autenticado.
 * O browser envia os cookies automaticamente em requisições fetch() same-origin.
 */
export async function createServerClientFromCookies() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
  const anonKey    = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
  const cookieStore = await cookies();
  return createSSRServerClient(supabaseUrl, anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: () => { /* read-only em API routes */ },
    },
  });
}
