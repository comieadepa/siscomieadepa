-- Create webhook_jobs table for queue processing
CREATE TABLE IF NOT EXISTS public.webhook_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL DEFAULT 'asaas',
  job_type text NOT NULL,
  entity_type text NOT NULL, -- 'inscricao' | 'lote' | 'pagamento'
  entity_id uuid NOT NULL,
  external_event_id text,
  external_payment_id text,
  payload jsonb,
  status text NOT NULL DEFAULT 'pending', -- 'pending' | 'processing' | 'done' | 'failed' | 'dead'
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  last_error text,
  locked_at timestamptz,
  locked_by text,
  available_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT valid_status CHECK (status IN ('pending', 'processing', 'done', 'failed', 'dead')),
  CONSTRAINT uq_webhook_jobs_idempotency UNIQUE (source, job_type, entity_type, entity_id, external_payment_id)
);

-- Performance Indexes
CREATE INDEX IF NOT EXISTS idx_webhook_jobs_status_available ON public.webhook_jobs (status, available_at) WHERE status IN ('pending', 'failed');
CREATE INDEX IF NOT EXISTS idx_webhook_jobs_entity ON public.webhook_jobs (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_webhook_jobs_external_event ON public.webhook_jobs (external_event_id);

-- Setup update_updated_at_column trigger
DROP TRIGGER IF EXISTS tr_webhook_jobs_updated_at ON public.webhook_jobs;
CREATE TRIGGER tr_webhook_jobs_updated_at
  BEFORE UPDATE ON public.webhook_jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
