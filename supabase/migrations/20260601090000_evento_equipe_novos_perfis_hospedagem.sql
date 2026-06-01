-- Novos perfis de equipe para eventos AGO
-- operador, checkin, hospedagem, checkin_hospedagem

ALTER TABLE public.evento_equipe
  DROP CONSTRAINT IF EXISTS evento_equipe_tipo_check;

ALTER TABLE public.evento_equipe
  ADD CONSTRAINT evento_equipe_tipo_check
  CHECK (tipo IN ('operador', 'checkin', 'hospedagem', 'checkin_hospedagem'));
