-- Fix: Make user_id nullable in pre_registrations table
-- This allows storing contact requests without creating a user first

-- Drop the UNIQUE constraint on user_id if it exists
ALTER TABLE public.pre_registrations 
DROP CONSTRAINT IF EXISTS pre_registrations_user_id_key;

-- Alter the column to allow NULL
ALTER TABLE public.pre_registrations 
ALTER COLUMN user_id DROP NOT NULL;

-- Drop any existing FK on user_id before adding the named one
DO $$
DECLARE
  c TEXT;
BEGIN
  SELECT tc.constraint_name INTO c
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
    AND tc.table_schema = kcu.table_schema
  WHERE tc.constraint_type = 'FOREIGN KEY'
    AND tc.table_schema = 'public'
    AND tc.table_name = 'pre_registrations'
    AND kcu.column_name = 'user_id'
    AND tc.constraint_name <> 'fk_pre_registrations_user_id'
  LIMIT 1;

  IF c IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.pre_registrations DROP CONSTRAINT ' || quote_ident(c);
  END IF;
END $$;

-- Add the named FK with ON DELETE CASCADE (if not already there)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_type = 'FOREIGN KEY'
      AND table_schema = 'public'
      AND table_name = 'pre_registrations'
      AND constraint_name = 'fk_pre_registrations_user_id'
  ) THEN
    ALTER TABLE public.pre_registrations 
    ADD CONSTRAINT fk_pre_registrations_user_id 
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Create index for faster lookups (NULL values are included in indexes)
CREATE INDEX IF NOT EXISTS idx_pre_registrations_user_id_nullable ON public.pre_registrations(user_id);
