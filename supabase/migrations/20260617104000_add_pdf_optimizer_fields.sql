-- Migration: Add PDF Optimizer columns to documents/files tables
-- Date: 2026-06-17

DO $$
BEGIN
    -- 1. Table: candidato_documentos
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'candidato_documentos') THEN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'candidato_documentos' AND column_name = 'arquivo_original_bytes') THEN
            ALTER TABLE public.candidato_documentos ADD COLUMN arquivo_original_bytes BIGINT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'candidato_documentos' AND column_name = 'arquivo_otimizado_bytes') THEN
            ALTER TABLE public.candidato_documentos ADD COLUMN arquivo_otimizado_bytes BIGINT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'candidato_documentos' AND column_name = 'percentual_reducao') THEN
            ALTER TABLE public.candidato_documentos ADD COLUMN percentual_reducao NUMERIC(5,2);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'candidato_documentos' AND column_name = 'processado_em') THEN
            ALTER TABLE public.candidato_documentos ADD COLUMN processado_em TIMESTAMPTZ;
        END IF;
    END IF;

    -- 2. Table: arquivos
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'arquivos') THEN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'arquivos' AND column_name = 'arquivo_original_bytes') THEN
            ALTER TABLE public.arquivos ADD COLUMN arquivo_original_bytes BIGINT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'arquivos' AND column_name = 'arquivo_otimizado_bytes') THEN
            ALTER TABLE public.arquivos ADD COLUMN arquivo_otimizado_bytes BIGINT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'arquivos' AND column_name = 'percentual_reducao') THEN
            ALTER TABLE public.arquivos ADD COLUMN percentual_reducao NUMERIC(5,2);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'arquivos' AND column_name = 'processado_em') THEN
            ALTER TABLE public.arquivos ADD COLUMN processado_em TIMESTAMPTZ;
        END IF;
    END IF;
END $$;
