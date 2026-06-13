-- Add Asaas integration fields to conec_credenciamentos table
ALTER TABLE public.conec_credenciamentos
ADD COLUMN IF NOT EXISTS asaas_invoice_url text,
ADD COLUMN IF NOT EXISTS asaas_pix_qrcode text,
ADD COLUMN IF NOT EXISTS asaas_status text;
