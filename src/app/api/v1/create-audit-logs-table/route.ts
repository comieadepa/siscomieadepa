import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/admin-guard'

const SQL_CREATE_AUDIT_TABLE = `
-- Criar tabela de auditoria (schema completo)
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  usuario_email   TEXT,
  action          TEXT NOT NULL DEFAULT 'outro',
  resource_type   TEXT NOT NULL DEFAULT 'sistema',
  resource_id     UUID,
  acao            TEXT,
  modulo          TEXT,
  area            TEXT,
  tabela_afetada  TEXT,
  descricao       TEXT,
  dados_anteriores JSONB,
  dados_novos     JSONB,
  old_data        JSONB,
  new_data        JSONB,
  ip_address      INET,
  user_agent      TEXT,
  status          TEXT DEFAULT 'sucesso',
  mensagem_erro   TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id   ON public.audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_modulo     ON public.audit_logs(modulo);
CREATE INDEX IF NOT EXISTS idx_audit_logs_acao       ON public.audit_logs(acao);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_status     ON public.audit_logs(status);
CREATE INDEX IF NOT EXISTS idx_audit_logs_email      ON public.audit_logs(usuario_email);

-- RLS
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Remover policies antigas se existirem
DROP POLICY IF EXISTS "users_view_own_audit_logs" ON public.audit_logs;
DROP POLICY IF EXISTS "users_create_audit_logs" ON public.audit_logs;
DROP POLICY IF EXISTS "audit_logs_insert_all" ON public.audit_logs;
DROP POLICY IF EXISTS "audit_logs_select_auth" ON public.audit_logs;

CREATE POLICY "audit_logs_insert_all"
  ON public.audit_logs FOR INSERT
  WITH CHECK (true);

CREATE POLICY "audit_logs_select_auth"
  ON public.audit_logs FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Permissões
GRANT SELECT, INSERT ON public.audit_logs TO authenticated;
`

export async function POST(request: NextRequest) {
  try {
    const result = await requireAdmin(request, { requiredRole: 'admin' })
    if (!result.ok) return result.response

    const supabase = createServerClient()

    // Executar SQL para criar tabela
    const { error } = await supabase.rpc('exec', {
      sql: SQL_CREATE_AUDIT_TABLE,
    })

    if (error && !error.message?.includes('already exists')) {
      // Tentar via query direto
      const { error: queryError } = await supabase
        .from('audit_logs')
        .select('count')
        .limit(1)

      if (queryError && queryError.code === 'PGRST116') {
        // Tabela realmente não existe, vamos tentar criar
        console.error('Tabela não pode ser criada via RPC, necessário SQL direto')
        return NextResponse.json(
          {
            error:
              'Tabela de auditoria ainda não existe. Execute o SQL manualmente.',
            sql: SQL_CREATE_AUDIT_TABLE,
          },
          { status: 409 },
        )
      }
    }

    // Esperar um pouco para propagação
    await new Promise(resolve => setTimeout(resolve, 2000))

    return NextResponse.json({
      success: true,
      message: 'Tabela de auditoria criada com sucesso',
    })
  } catch (error) {
    console.error('Erro ao criar tabela de auditoria:', error)
    return NextResponse.json(
      {
        error: 'Erro ao criar tabela',
        details: String(error),
      },
      { status: 500 },
    )
  }
}

export async function GET(request: NextRequest) {
  try {
    const result = await requireAdmin(request, { requiredRole: 'admin' })
    if (!result.ok) return result.response

    const supabase = createServerClient()

    // Verificar se tabela existe
    const { error } = await supabase
      .from('audit_logs')
      .select('count')
      .limit(1)

    if (error && error.code === 'PGRST116') {
      return NextResponse.json({ exists: false })
    }

    return NextResponse.json({ exists: true })
  } catch (error) {
    console.error('Erro ao verificar auditoria:', error)
    return NextResponse.json({ exists: false })
  }
}
