-- Renumera todos los leads de forma contigua: 1 … N (ascendente).
-- Fase 1: mueve a rango temporal alto para no chocar con el índice único.
-- Fase 2: asigna 1..N preservando el orden relativo actual.

update public.leads l
set lead_number = 2000000000 + s.rn
from (
  select
    id,
    row_number() over (
      order by coalesce(lead_number, 0) asc, created_at asc, id asc
    ) as rn
  from public.leads
) s
where l.id = s.id;

update public.leads l
set lead_number = s.rn
from (
  select
    id,
    row_number() over (order by lead_number asc, created_at asc, id asc) as rn
  from public.leads
) s
where l.id = s.id;
