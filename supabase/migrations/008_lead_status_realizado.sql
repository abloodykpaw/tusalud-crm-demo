-- Añade estado "realizado" para que agentes marquen leads completados
ALTER TYPE public.lead_status ADD VALUE IF NOT EXISTS 'realizado';
