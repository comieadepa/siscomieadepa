/**
 * useEventosPerfil
 *
 * Identifica o perfil do usuário logado e retorna:
 * - nivelSistema: nível global do usuário (super, admin, inscricao, …)
 * - isGlobal: true para super/admin — vê todos os eventos sem restrição
 * - permissaoEvento: para nível 'inscricao', a permissão máxima do usuário
 *   ('admin_evento' | 'operador' | 'checkin' | null)
 * - eventoIds: lista de IDs de eventos acessíveis (null = sem restrição)
 * - permissoesPorEvento: mapa eventoId → permissao para verificação granular
 * - podeNovoEvento: se pode criar novos eventos
 * - podeVerFinanceiro: se pode ver aba/cards financeiros
 * - tabsPermitidas: quais abas de /eventos/[id] o usuário pode acessar
 * - loading: enquanto resolve
 */

'use client';

import { useState, useEffect, useMemo } from 'react';
import { createClient } from '@/lib/supabase-client';

export type PermissaoEvento = 'admin_evento' | 'operador' | 'checkin';

export type TabEventoId =
  | 'inscritos'
  | 'inscricao-manual'
  | 'checkin'
  | 'etiquetas'
  | 'financeiro'
  | 'relatorios'
  | 'comunicacao'
  | 'equipe'
  | 'configuracoes'
  | 'hospedagem'
  | 'backup'
  | 'programacao'
  | 'certificados';

// Quais abas cada permissão pode acessar
const TABS_POR_PERMISSAO: Record<PermissaoEvento, TabEventoId[]> = {
  admin_evento: ['inscritos', 'inscricao-manual', 'checkin', 'etiquetas', 'financeiro', 'relatorios', 'comunicacao', 'equipe', 'configuracoes', 'hospedagem', 'backup', 'programacao', 'certificados'],
  operador:     ['inscritos', 'inscricao-manual', 'checkin', 'etiquetas', 'relatorios', 'hospedagem', 'backup', 'programacao'],
  checkin:      ['checkin'],
};

const TABS_GLOBAL: TabEventoId[] = [
  'inscritos', 'inscricao-manual', 'checkin', 'etiquetas', 'financeiro', 'relatorios', 'comunicacao', 'equipe', 'configuracoes', 'hospedagem', 'backup', 'programacao', 'certificados',
];

export interface EventosPerfil {
  loading: boolean;
  userId: string | null;
  nivelSistema: string | null;
  isGlobal: boolean;
  /** Departamento do usuário (lido de user_metadata.subcategoria) — preenchido apenas para nível 'inscricao' */
  departamentoUsuario: string | null;
  /** true quando nivel=inscricao e tem departamento: administra todos os eventos do próprio dept */
  isDeptAdmin: boolean;
  permissaoEvento: PermissaoEvento | null;
  eventoIds: string[] | null;          // null = sem restrição
  permissoesPorEvento: Record<string, PermissaoEvento>;
  podeNovoEvento: boolean;
  podeEditar: boolean;
  podeVerFinanceiro: boolean;
  tabsPermitidas: TabEventoId[];
  /** Verifica se o usuário tem acesso a um evento específico */
  podeAcessarEvento: (eventoId: string) => boolean;
  /** Retorna a permissão para um evento específico (ou a global) */
  permissaoParaEvento: (eventoId: string) => PermissaoEvento | null;
}

export function useEventosPerfil(): EventosPerfil {
  const supabase = useMemo(() => createClient(), []);
  const [loading,              setLoading]              = useState(true);
  const [userId,               setUserId]               = useState<string | null>(null);
  const [nivelSistema,         setNivelSistema]         = useState<string | null>(null);
  const [departamentoUsuario,  setDepartamentoUsuario]  = useState<string | null>(null);
  const [permissoesPorEvento,  setPermissoesPorEvento]  = useState<Record<string, PermissaoEvento>>({});
  const [eventoIds,            setEventoIds]            = useState<string[] | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function resolve() {
      try {
        const { data: authData } = await supabase.auth.getUser();
        const user = authData?.user;
        if (!user || cancelled) return;

        // 1. Determina nível do usuário
        let nivel: string = (user.user_metadata?.nivel as string | undefined) || '';

        // Fallback via API se user_metadata não tiver nivel
        if (!nivel) {
          try {
            const { data: sessData } = await supabase.auth.getSession();
            const token = sessData.session?.access_token;
            if (token) {
              const res = await fetch('/api/auth/me', {
                headers: { Authorization: `Bearer ${token}` },
              });
              if (res.ok) {
                const json = await res.json() as { nivel?: string };
                nivel = json.nivel || 'admin';
              }
            }
          } catch {
            nivel = 'admin';
          }
        }

        if (cancelled) return;
        setUserId(user.id);
        setNivelSistema(nivel);

        // Departamento do usuário (subcategoria no user_metadata)
        const departamento = (user.user_metadata?.subcategoria as string | undefined) || '';
        if (departamento) setDepartamentoUsuario(departamento);

        // 2. Se global (super/admin), não precisa buscar vínculos
        const isGlobal = nivel === 'super' || nivel === 'admin';
        if (isGlobal) {
          setEventoIds(null);
          setPermissoesPorEvento({});
          setLoading(false);
          return;
        }

        // 2b. Se admin de departamento (inscricao + subcategoria), acessa todos os eventos do dept
        const isDeptAdmin = nivel === 'inscricao' && !!departamento;
        if (isDeptAdmin) {
          setEventoIds(null); // sem restrição por ID — filtro por dept feito na query
          setPermissoesPorEvento({});
          setLoading(false);
          return;
        }

        // 3. Busca vínculos usuario_eventos para usuário 'inscricao'
        const { data: vinculos } = await supabase
          .from('usuario_eventos')
          .select('evento_id, permissao')
          .eq('user_id', user.id);

        if (cancelled) return;

        const map: Record<string, PermissaoEvento> = {};
        const ids: string[] = [];
        for (const v of (vinculos || [])) {
          map[v.evento_id] = v.permissao as PermissaoEvento;
          ids.push(v.evento_id);
        }

        setPermissoesPorEvento(map);
        setEventoIds(ids);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    resolve();
    return () => { cancelled = true; };
  }, [supabase]);

  // ── Derivações ────────────────────────────────────────────
  const isGlobal    = nivelSistema === 'super' || nivelSistema === 'admin';
  const isDeptAdmin = nivelSistema === 'inscricao' && !!departamentoUsuario;

  // Permissão mais ampla do usuário (para decidir tabs padrão)
  const permissaoEvento = useMemo<PermissaoEvento | null>(() => {
    if (isGlobal || isDeptAdmin) return 'admin_evento';
    const perms = Object.values(permissoesPorEvento);
    if (perms.includes('admin_evento')) return 'admin_evento';
    if (perms.includes('operador'))     return 'operador';
    if (perms.includes('checkin'))      return 'checkin';
    return null;
  }, [isGlobal, isDeptAdmin, permissoesPorEvento]);

  const podeNovoEvento    = isGlobal || isDeptAdmin;
  const podeEditar        = isGlobal || isDeptAdmin || permissaoEvento === 'admin_evento';
  const podeVerFinanceiro = isGlobal || isDeptAdmin || permissaoEvento === 'admin_evento';

  const tabsPermitidas: TabEventoId[] = isGlobal || isDeptAdmin
    ? TABS_GLOBAL
    : permissaoEvento
      ? TABS_POR_PERMISSAO[permissaoEvento]
      : [];

  function podeAcessarEvento(eventoId: string): boolean {
    // isDeptAdmin: acesso liberado aqui — verificação por dept feita na página após carregar evento
    if (isGlobal || isDeptAdmin) return true;
    return eventoId in permissoesPorEvento;
  }

  function permissaoParaEvento(eventoId: string): PermissaoEvento | null {
    if (isGlobal || isDeptAdmin) return 'admin_evento';
    return permissoesPorEvento[eventoId] ?? null;
  }

  return {
    loading,
    userId,
    nivelSistema,
    isGlobal,
    departamentoUsuario,
    isDeptAdmin,
    permissaoEvento,
    eventoIds,
    permissoesPorEvento,
    podeNovoEvento,
    podeEditar,
    podeVerFinanceiro,
    tabsPermitidas,
    podeAcessarEvento,
    permissaoParaEvento,
  };
}
