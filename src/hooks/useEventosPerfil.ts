/**
 * useEventosPerfil
 *
 * Identifica o perfil do usuário logado e retorna:
 * - nivelSistema: nível global do usuário (super, admin, inscricao, …)
 * - isGlobal: true para super/admin — vê todos os eventos sem restrição
 * - permissaoEvento: para nível 'inscricao', a permissão máxima do usuário
 *   ('admin_evento' | 'operador' | 'checkin' | 'checkin_refeitorio' | null)
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
import { getEquipeSession } from '@/lib/equipe-session';
import {
  getEventoTabsPermitidas,
  normalizeEventoRole,
  resolveEventoPermissoes,
  type EventoRole,
  type EventoTabId,
} from '@/lib/eventos/evento-permissions';
import { normalizeRole } from '@/lib/auth/roles';

export type TabEventoId = EventoTabId;

const TABS_GLOBAL: TabEventoId[] = getEventoTabsPermitidas('admin_evento');

export interface EventosPerfil {
  loading: boolean;
  userId: string | null;
  nivelSistema: string | null;
  isGlobal: boolean;
  /** Departamento do usuário (lido de user_metadata.subcategoria) — preenchido apenas para nível 'inscricao' */
  departamentoUsuario: string | null;
  /** true quando nivel=inscricao e tem departamento: administra todos os eventos do próprio dept */
  isDeptAdmin: boolean;
  permissaoEvento: EventoRole | null;
  eventoIds: string[] | null;          // null = sem restrição
  permissoesPorEvento: Record<string, EventoRole>;
  podeNovoEvento: boolean;
  podeEditar: boolean;
  podeVerFinanceiro: boolean;
  podeEditarEvento: boolean;
  podeCriarEquipe: boolean;
  podeConfiguracoes: boolean;
  podeBackup: boolean;
  podeRelatorios: boolean;
  podeComunicacao: boolean;
  podeCertificados: boolean;
  podeHospedagem: boolean;
  podeProgramacao: boolean;
  podeEditarInscricoes: boolean;
  podeRemoverInscricao: boolean;
  podeMoverInscricao: boolean;
  somenteCheckin: boolean;
  somenteRefeitorio: boolean;
  tabsPermitidas: TabEventoId[];
  tabsPermitidasParaEvento: (eventoId: string) => TabEventoId[];
  /** Verifica se o usuário tem acesso a um evento específico */
  podeAcessarEvento: (eventoId: string) => boolean;
  /** Retorna a permissão para um evento específico (ou a global) */
  permissaoParaEvento: (eventoId: string) => EventoRole | null;
}

export function useEventosPerfil(): EventosPerfil {
  const supabase = useMemo(() => createClient(), []);
  const [loading,              setLoading]              = useState(true);
  const [userId,               setUserId]               = useState<string | null>(null);
  const [nivelSistema,         setNivelSistema]         = useState<string | null>(null);
  const [departamentoUsuario,  setDepartamentoUsuario]  = useState<string | null>(null);
  const [permissoesPorEvento,  setPermissoesPorEvento]  = useState<Record<string, EventoRole>>({});
  const [eventoIds,            setEventoIds]            = useState<string[] | null>(null);
  const [hasExplicitPerms,     setHasExplicitPerms]     = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function resolve() {
      try {
        const { data: authData } = await supabase.auth.getUser();
        const user = authData?.user;
        if (!user || cancelled) {
          setHasExplicitPerms(false);
          const sess = getEquipeSession();
          if (sess && !cancelled) {
            const perm = normalizeEventoRole(sess.tipo);
            if (!perm) return;
            setPermissoesPorEvento({ [sess.eventoId]: perm });
            setEventoIds([sess.eventoId]);
          }
          return;
        }

        // 1. Determina nível do usuário
        let nivelRaw: string = (user.user_metadata?.nivel as string | undefined) || '';

        // Fallback via API se user_metadata não tiver nivel
        if (!nivelRaw) {
          try {
            const { data: sessData } = await supabase.auth.getSession();
            const token = sessData.session?.access_token;
            if (token) {
              const res = await fetch('/api/auth/me', {
                headers: { Authorization: `Bearer ${token}` },
              });
              if (res.ok) {
                const json = await res.json() as { nivel?: string };
                nivelRaw = json.nivel || 'admin';
              }
            }
          } catch {
            nivelRaw = 'admin';
          }
        }

        const nivel = normalizeRole(nivelRaw) || 'administrador';

        if (cancelled) return;
        setUserId(user.id);
        setNivelSistema(nivel);

        // Departamento do usuário (subcategoria no user_metadata)
        const departamento = (user.user_metadata?.subcategoria as string | undefined) || '';
        if (departamento) setDepartamentoUsuario(departamento);

        // 2. Se global (super/admin), não precisa buscar vínculos
        const isGlobal = nivel === 'super' || nivel === 'administrador';
        if (isGlobal) {
          setHasExplicitPerms(false);
          setEventoIds(null);
          setPermissoesPorEvento({});
          setLoading(false);
          return;
        }

        // 2b. Se admin de departamento (inscricao + subcategoria = TODOS), acessa todos os eventos do dept
        const isDeptAdmin = nivel === 'inscricao' && departamento === 'TODOS';
        if (isDeptAdmin) {
          setHasExplicitPerms(false);
          setEventoIds(null); // sem restrição por ID — filtro por dept feito na query
          setPermissoesPorEvento({});
          setLoading(false);
          return;
        }

        // 3. Busca múltiplos eventos permitidos para o usuário de inscrição
        const { data: permitidos } = await supabase
          .from('usuario_eventos_permitidos')
          .select('evento_id')
          .eq('usuario_id', user.id);

        const map: Record<string, EventoRole> = {};
        const ids: string[] = [];

        if (permitidos && permitidos.length > 0) {
          setHasExplicitPerms(true);
          for (const p of permitidos) {
            map[p.evento_id] = 'admin_evento';
            ids.push(p.evento_id);
          }
        } else {
          setHasExplicitPerms(false);
          if (nivel === 'inscricao' && departamento) {
            // Fallback por subcategoria
            if (departamento.includes('-') || departamento.length > 15) {
              // Se subcategoria for exatamente o UUID de um evento
              map[departamento] = 'admin_evento';
              ids.push(departamento);
            } else {
              // Se for nome de departamento (AGO, UMADESPA, etc), buscamos os eventos correspondentes
              const { data: evsFiltrados } = await supabase
                .from('eventos')
                .select('id')
                .eq('departamento', departamento);
              for (const e of (evsFiltrados || [])) {
                map[e.id] = 'admin_evento';
                ids.push(e.id);
              }
            }
          }
        }

        // Também busca em usuario_eventos para perfis como equipe/operadores
        const { data: vinculos } = await supabase
          .from('usuario_eventos')
          .select('evento_id, permissao')
          .eq('user_id', user.id);

        for (const v of (vinculos || [])) {
          const perm = normalizeEventoRole(v.permissao as string | null | undefined);
          if (!perm) continue;
          map[v.evento_id] = perm;
          if (!ids.includes(v.evento_id)) {
            ids.push(v.evento_id);
          }
        }

        setPermissoesPorEvento(map);
        setEventoIds(ids);

        // Também verifica sessão de equipe (acesso sem conta Supabase)
        // Funciona mesmo quando o usuário está autenticado no Supabase
        const equipeSess = getEquipeSession();
        if (equipeSess && !cancelled) {
          const sessPerm = normalizeEventoRole(equipeSess.tipo);
          if (sessPerm && !map[equipeSess.eventoId]) {
            map[equipeSess.eventoId] = sessPerm;
            ids.push(equipeSess.eventoId);
            setPermissoesPorEvento({ ...map });
            setEventoIds([...ids]);
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    resolve();
    return () => { cancelled = true; };
  }, [supabase]);

  // ── Derivações ────────────────────────────────────────────
  const isGlobal    = nivelSistema === 'super' || nivelSistema === 'administrador';
  const isDeptAdmin = nivelSistema === 'inscricao' && 
                      !!departamentoUsuario && 
                      !hasExplicitPerms && 
                      !(departamentoUsuario.includes('-') || departamentoUsuario.length > 15);

  // Permissão mais ampla do usuário (para decidir tabs padrão)
  const permissaoEvento = useMemo<EventoRole | null>(() => {
    if (isGlobal || isDeptAdmin) return 'admin_evento';
    const perms = Object.values(permissoesPorEvento);
    if (perms.includes('admin_evento')) return 'admin_evento';
    if (perms.includes('operador'))     return 'operador';
    if (perms.includes('hospedagem'))   return 'hospedagem';
    if (perms.includes('checkin_hospedagem')) return 'checkin_hospedagem';
    if (perms.includes('checkin_refeitorio')) return 'checkin_refeitorio';
    if (perms.includes('checkin'))      return 'checkin';
    return null;
  }, [isGlobal, isDeptAdmin, permissoesPorEvento]);

  const podeNovoEvento    = isGlobal || isDeptAdmin;
  const perms = resolveEventoPermissoes({ perm: permissaoEvento, isGlobal, isDeptAdmin });
  const podeEditarEvento  = perms.podeEditarEvento;
  const podeEditar        = podeEditarEvento;
  const podeVerFinanceiro = perms.podeFinanceiro;

  const tabsPermitidas: TabEventoId[] = isGlobal || isDeptAdmin
    ? TABS_GLOBAL
    : permissaoEvento
      ? getEventoTabsPermitidas(permissaoEvento)
      : [];

  function podeAcessarEvento(eventoId: string): boolean {
    // isDeptAdmin: acesso liberado aqui — verificação por dept feita na página após carregar evento
    if (isGlobal || isDeptAdmin) return true;
    return eventoId in permissoesPorEvento;
  }

  function permissaoParaEvento(eventoId: string): EventoRole | null {
    if (isGlobal || isDeptAdmin) return 'admin_evento';
    return permissoesPorEvento[eventoId] ?? null;
  }

  function tabsPermitidasParaEvento(eventoId: string): TabEventoId[] {
    if (isGlobal || isDeptAdmin) return TABS_GLOBAL;
    const perm = permissaoParaEvento(eventoId);
    return perm ? getEventoTabsPermitidas(perm) : [];
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
    podeEditarEvento,
    podeCriarEquipe: perms.podeCriarEquipe,
    podeConfiguracoes: perms.podeConfiguracoes,
    podeBackup: perms.podeBackup,
    podeRelatorios: perms.podeRelatorios,
    podeComunicacao: perms.podeComunicacao,
    podeCertificados: perms.podeCertificados,
    podeHospedagem: perms.podeHospedagem,
    podeProgramacao: perms.podeProgramacao,
    podeEditarInscricoes: perms.podeEditarInscricoes,
    podeRemoverInscricao: perms.podeRemoverInscricao,
    podeMoverInscricao: perms.podeMoverInscricao,
    somenteCheckin: perms.somenteCheckin,
    somenteRefeitorio: perms.somenteRefeitorio,
    tabsPermitidas,
    tabsPermitidasParaEvento,
    podeAcessarEvento,
    permissaoParaEvento,
  };
}
