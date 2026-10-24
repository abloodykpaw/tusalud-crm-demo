# Leads separados por perfil de reporte — pasos para producción (Cursor)

Fecha: 2026-10-12 · Base: `main` @ 7a761f2 · Estado: cambios **sin commit** en el working tree, `npx tsc --noEmit` OK, `npm run build` OK. La migración 020 **no está aplicada** (verificado: `column leads.report_target_id does not exist`).

## Cómo aplicar este documento

- Sigue los pasos **en orden**. La migración (paso 1) va **antes** de desplegar el código (paso 4): si el código sale primero, importar Excel falla con `column report_target_id does not exist`.
- No toques `scripts/upload-one-carta.mjs` (cambios locales del usuario, ajenos a esto). No lo incluyas en el commit.
- No edites migraciones existentes. No vuelvas a publicar reportes (ver «Ya hecho en producción»).

## Qué hace el cambio

En **Leads**, cuando un agente tiene 2+ perfiles de reporte (hoy: Jesmary → Cynthia y Valeria), sus leads se muestran en una sección por perfil, cada una con sus carpetas por día y la píldora `realizados/total`. Aplica al agente en su cuenta y al admin/encargado cuando filtra por ese agente.

| Archivo | Cambio |
|---|---|
| `supabase/migrations/020_lead_report_target.sql` | Nueva columna `leads.report_target_id` (FK a `report_targets`, `on delete set null`), índice, `leads_guard` actualizado (agentes no pueden cambiarla) y relleno de los leads existentes. Idempotente. |
| `src/lib/types.ts` | `Lead.reportTargetId?: string \| null` |
| `src/lib/supabase-sync.ts` | `leadToDbRow` / pull mapean `report_target_id`; nueva `updateLeadsReportTarget(ids, targetId)`. `updateLeadRow` **no** envía la columna a propósito (las ediciones de estado/notas de agentes no dependen de ella). |
| `src/lib/store.tsx` | `setLeadsReportTarget(leadIds, targetId)` (solo admin/encargado, con historial y rollback). `upsertLeads` conserva el perfil de un lead ya existente. |
| `src/views/LeadsView.tsx` | Importación guarda `reportTargetId` del perfil elegido; agrupación por perfil; selector «Perfil de reporte» en el panel del lead (staff) / texto (agente). |
| `src/styles.css` | Estilos `.lead-profile-*`. |

## Ya hecho en producción (no repetir)

- Perfil de reporte **Valeria** creado (`ce947f94-9d35-46e3-ab33-145d1f6b1176`) y asignado a Jesmary por el usuario.
- Reporte «Leads Nuevos de 199 Personas» republicado en **Cynthia** (`report_entries.id = e8f1eef9-eb0c-42a2-934a-88d9fd542299`, archivo `Leads Cinthya.txt`).

---

## Paso 1 — Aplicar la migración 020

- **Cómo:** ejecuta `supabase/migrations/020_lead_report_target.sql` completo en Supabase (SQL Editor, MCP de Supabase o `pg` con `DATABASE_URL`, como hacen los `scripts/apply-*.mjs`).
- **Listo cuando:** esta consulta devuelve `true`:
```sql
select exists (
  select 1 from information_schema.columns
   where table_schema = 'public' and table_name = 'leads' and column_name = 'report_target_id'
) and (select prosrc like '%report_target_id%' from pg_proc where proname = 'leads_guard');
```

## Paso 2 — Verificar el relleno de leads existentes

```sql
select coalesce(t.name, 'SIN PERFIL') as perfil, p.full_name as agente, l.source, count(*)
  from public.leads l
  left join public.report_targets t on t.id = l.report_target_id
  left join public.profiles p on p.id = l.assigned_agent_id
 group by 1, 2, 3
 order by 2, 1;
```

- **Listo cuando** coincide con esto (simulado sobre los datos reales; si se importaron leads después, puede haber filas nuevas):

| perfil | agente | source | count |
|---|---|---|---|
| Cristhyam | Kennedy | Excel · LEAD1000_2026-09-02_MMDDYYYY.xlsx | 990 |
| Cristhyam | Kennedy | Excel · FAMILIAS3y4_2026-09-28.xlsx | 415 |
| Cristhyam | Kennedy | Excel · Leads275_2026-10-12.xlsx | 275 |
| Cynthia | Jesmary | Excel · Leads Cinthya.xlsx | 199 |
| Valeria | Jesmary | Excel · leads valeria.xlsx | 195 |

  y **ninguna** fila `SIN PERFIL`. Si aparece alguna, no inventes un perfil: repórtalo al usuario (se puede corregir luego desde el panel del lead).

## Paso 3 — Comprobar el build

- `npx tsc --noEmit` y `npm run build` deben pasar (el aviso de chunks > 500 kB ya existía).

## Paso 4 — Commit y despliegue

- Commit solo de estos archivos:
```bash
git add supabase/migrations/020_lead_report_target.sql src/lib/types.ts src/lib/supabase-sync.ts src/lib/store.tsx src/views/LeadsView.tsx src/styles.css docs/PERFILES-LEADS-CURSOR.md
git commit -m "Leads: separar por perfil de reporte cuando el agente tiene 2+ perfiles; perfil del lote al importar (020)"
git push origin main
```
- Si Vercel está conectado al repo, el push despliega solo. Si no, despliega con la Opción B de `DEPLOY.md`:
```bash
npx vercel pull --yes --environment=production
npx vercel build --prod --yes
npx vercel deploy --prebuilt --prod --yes
```
- **Listo cuando:** el despliegue de producción con este commit está en estado *Ready*.

## Paso 5 — Prueba en producción

1. Admin → **Leads** → filtro de agente **Jesmary**: dos secciones, **Cynthia** (199) y **Valeria** (195), cada una con su carpeta del día.
2. Abre un lead: el panel muestra el selector **Perfil de reporte** con el perfil correcto. No lo cambies salvo para probar y devuélvelo a su valor.
3. Filtro **Todos los agentes**: la vista sigue sin secciones, como antes.
4. Cuenta de agente (Jesmary): ve las mismas dos secciones; en el panel el perfil sale como texto, sin selector.
5. **Reportes → Cynthia**: «Leads Nuevos de 199 Personas» visible.

- **Listo cuando:** los 5 puntos se cumplen. No importes Excel de prueba en producción.

## Si algo falla

- `column report_target_id does not exist` al importar → el paso 1 no se aplicó en esa base; aplícalo (no hace falta redesplegar).
- Revertir el código no requiere tocar la base: la columna extra es inocua para la versión anterior.
