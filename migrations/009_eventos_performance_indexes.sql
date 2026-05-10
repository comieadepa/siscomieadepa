-- Migration 009: Índices de performance para o módulo Eventos
-- Aplicar via Supabase SQL Editor
-- Execute este arquivo em DOIS passos separados (ver abaixo).

-- ══════════════════════════════════════════════════════════════
-- PASSO 1: Execute este bloco PRIMEIRO (extensão pg_trgm)
-- ══════════════════════════════════════════════════════════════
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ══════════════════════════════════════════════════════════════
-- PASSO 2: Execute este bloco DEPOIS do passo 1
-- ══════════════════════════════════════════════════════════════

-- ── evento_inscricoes ─────────────────────────────────────────
-- Índice no qr_code (busca exata por token — mais crítico)
CREATE INDEX IF NOT EXISTS idx_evento_inscricoes_qr_code
  ON public.evento_inscricoes (qr_code)
  WHERE qr_code IS NOT NULL;

-- Índice composto evento_id + checkin para relatórios de check-in
CREATE INDEX IF NOT EXISTS idx_evento_inscricoes_evento_checkin
  ON public.evento_inscricoes (evento_id, checkin_realizado);

-- Índice no CPF para busca manual rápida
CREATE INDEX IF NOT EXISTS idx_evento_inscricoes_cpf
  ON public.evento_inscricoes (cpf)
  WHERE cpf IS NOT NULL;

-- Índice no nome para busca textual (ILIKE %query%) — requer pg_trgm
CREATE INDEX IF NOT EXISTS idx_evento_inscricoes_nome_trgm
  ON public.evento_inscricoes USING gin (nome_inscrito gin_trgm_ops);

-- Índice no status_pagamento para filtros financeiros
CREATE INDEX IF NOT EXISTS idx_evento_inscricoes_status_pag
  ON public.evento_inscricoes (evento_id, status_pagamento);

-- ── evento_checkins ────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_evento_checkins_evento_id
  ON public.evento_checkins (evento_id);

CREATE INDEX IF NOT EXISTS idx_evento_checkins_inscricao_id
  ON public.evento_checkins (inscricao_id);

-- ── usuario_eventos ────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_usuario_eventos_user_id
  ON public.usuario_eventos (user_id);

CREATE INDEX IF NOT EXISTS idx_usuario_eventos_evento_id
  ON public.usuario_eventos (evento_id);
