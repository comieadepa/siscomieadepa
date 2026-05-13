-- Migration: RLS restritivo para tabelas sensiveis
-- Objetivo: bloquear SELECT direto via client e manter acesso apenas via APIs server-side

DO $$
BEGIN
  IF to_regclass('public.supervisoes') IS NOT NULL THEN
    ALTER TABLE public.supervisoes ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "supervisoes_authenticated" ON public.supervisoes;
  END IF;

  IF to_regclass('public.campos') IS NOT NULL THEN
    ALTER TABLE public.campos ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "campos_authenticated" ON public.campos;
  END IF;

  IF to_regclass('public.congregacoes') IS NOT NULL THEN
    ALTER TABLE public.congregacoes ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "congregacoes_authenticated" ON public.congregacoes;
  END IF;

  IF to_regclass('public.members') IS NOT NULL THEN
    ALTER TABLE public.members ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "members_authenticated" ON public.members;
  END IF;

  IF to_regclass('public.employees') IS NOT NULL THEN
    ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "employees_authenticated" ON public.employees;
  END IF;

  IF to_regclass('public.permutas') IS NOT NULL THEN
    ALTER TABLE public.permutas ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "permutas_authenticated" ON public.permutas;
  END IF;

  IF to_regclass('public.consagracao_registros') IS NOT NULL THEN
    ALTER TABLE public.consagracao_registros ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "consagracao_registros_auth" ON public.consagracao_registros;
  END IF;

  IF to_regclass('public.member_history') IS NOT NULL THEN
    ALTER TABLE public.member_history ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "member_history_authenticated" ON public.member_history;
  END IF;

  IF to_regclass('public.juventude_comieadepa') IS NOT NULL THEN
    ALTER TABLE public.juventude_comieadepa ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "Authenticated users can manage juventude" ON public.juventude_comieadepa;
  END IF;

  IF to_regclass('public.hds') IS NOT NULL THEN
    ALTER TABLE public.hds ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "Authenticated users can manage hds" ON public.hds;
  END IF;

  IF to_regclass('public.cgadb_debitos') IS NOT NULL THEN
    ALTER TABLE public.cgadb_debitos ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "cgadb_debitos_authenticated" ON public.cgadb_debitos;
  END IF;
END $$;
