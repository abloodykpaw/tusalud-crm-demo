# Auditoría TuSalud CRM — plan de cambios para Cursor

Fecha: 2026-10-06 · Base: `main` @ 728a9b2 · Estado: `tsc` OK, `vite build` OK (bundle JS único de 987 KB), `npm audit`: 1 alta (`xlsx`).

## Cómo aplicar este documento

- Aplica por fases en orden (F0 → F4). Cada ítem tiene **Dónde**, **Problema**, **Arreglo** y **Listo cuando**.
- Las migraciones nuevas van en `supabase/migrations/019_*.sql`, `020_*.sql`, … (nunca edites las existentes).
- Tras cada fase: `npx tsc --noEmit` y `npm run build` deben pasar. Prueba con los 4 roles (admin, encargado, nómina, agente).
- No toques `scripts/upload-one-carta.mjs` (tiene cambios locales sin commit del usuario).
- Mantén el estilo del código: español en UI y comentarios, `useStore()` como fuente de verdad, alias `@/`.

---

## F0 — Seguridad (crítico, hacer primero)

El frontend valida permisos, pero la base de datos (RLS) permite casi todo. Como la anon key está en el bundle, cualquier usuario autenticado puede llamar a PostgREST directamente y saltarse la UI.

### F0.1 Cualquiera puede registrarse como admin
- **Dónde:** `supabase/migrations/005_username_login.sql` (`handle_new_user` toma `raw_user_meta_data->>'role'`), `src/lib/store.tsx:2287` (`createUser` usa `sb.auth.signUp` desde el navegador, así que los registros públicos tienen que estar activos).
- **Problema:** con la anon key pública, `supabase.auth.signUp({ email, password, options: { data: { role: "admin" } } })` crea un perfil admin.
- **Arreglo:**
  1. Migración `019_security_hardening.sql`: redefinir `handle_new_user` para que **siempre** inserte `role = 'agente'` e ignore el rol de la metadata.
  2. Crear la Edge Function `supabase/functions/admin-create-user/index.ts`: verifica el JWT del llamante, comprueba en `profiles` que sea admin y luego usa `auth.admin.createUser({ email, password, email_confirm: true, user_metadata })` con la service role y hace `update profiles set role, username, phone, email`.
  3. `createUser` en `store.tsx` pasa a llamar `sb.functions.invoke("admin-create-user", { body })`.
  4. En DEPLOY.md: documentar **desactivar "Allow new users to sign up"** en Supabase Auth.
- **Listo cuando:** un `signUp` con la anon key falla (registros desactivados) y, si no fallara, no crearía un admin; el admin crea usuarios sin perder su sesión (ver F1.1).

### F0.2 Un agente puede volverse admin
- **Dónde:** policy `profiles_update_self` (001) y `profiles_update_staff` (011).
- **Problema:** `update profiles set role='admin' where id = auth.uid()` está permitido. El encargado también puede cambiar roles.
- **Arreglo (en 019):**
```sql
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
$$;

create or replace function public.profiles_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if; -- service role / SQL editor
  if not public.is_admin() and (
       new.role     is distinct from old.role
    or new.status   is distinct from old.status
    or new.username is distinct from old.username
    or new.id       is distinct from old.id
  ) then
    raise exception 'Solo admin puede cambiar rol, estado o usuario';
  end if;
  return new;
end $$;

drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.profiles_guard();
```
- **Listo cuando:** un agente o encargado que intenta cambiar su `role` por API recibe un error.

### F0.3 El agente puede autovalidar tareas y marcarse como pagado
- **Dónde:** `tasks_agent_update` (001), `payments_agent_update_zelle` y `payments_agent_insert` (002/011), `leads_agent_update` (001).
- **Problema:** el agente puede poner `proofs_validated = true`, `goal_current = goal_target`, `status = 'sent'` o `paid_amount`, y reasignar leads (`assigned_agent_id`). Eso salta los candados de pago.
- **Arreglo (en 019): triggers `BEFORE UPDATE/INSERT` que restringen columnas para quien no sea payroll** (`public.is_payroll()`; `auth.uid() is null` siempre pasa):
  - `weekly_tasks`: un no-payroll solo puede cambiar `status`, y nunca reabrir una tarea con `proofs_validated`. Bloquear `proofs_validated`, `assigned_to`, `created_by`, `title`, `description`, `due_date`, `week_start`, `goal_type` y `goal_target`. `goal_current` deja de escribirlo el cliente (ver F1.6).
  - `weekly_payments`: un no-payroll solo puede `INSERT` con `status = 'ready'` y los campos de pago en null. En `UPDATE` solo puede tocar `zelle_*`, y solo cuando `old.status = 'awaiting_data'` y `new.status = 'data_received'`.
  - `leads`: un no-staff solo puede cambiar `status` y `notes` de sus leads. Bloquear `assigned_agent_id`, `lead_number`, nombres, contacto y `raw_data`.
- **Listo cuando:** con el JWT de un agente, cada uno de esos `update` por API falla y el flujo normal de la UI sigue funcionando.

### F0.4 Nómina no puede escribir lo que la UI le deja hacer (fallos silenciosos)
- **Dónde:** `is_staff()` (001) solo incluye admin y encargado. La app trata a nómina como staff (`store.tsx:724`).
- **Problema:** cuando nómina "valida pruebas" (`validateTaskProofs`), vincula cartas (`linkCartaToLead`), activa la simulación de ventanas o avanza la semana, la escritura **afecta 0 filas sin error** (PostgREST no falla en un UPDATE sin filas). La UI muestra el cambio y el siguiente pull lo revierte. Esto encaja con el síntoma del commit 728a9b2 ("validar pruebas no se perdía").
- **Arreglo:**
  1. Policy nueva: `weekly_tasks` UPDATE para `is_payroll()`. El trigger de F0.3 limita a nómina a `proofs_validated` y `status`.
  2. Decidir si nómina puede vincular cartas. Si no, quitar `nomina` en `store.tsx:1644`. Si sí, añadir la policy.
  3. `app_settings`: solo admin (ver F1.9). Ocultar los controles a quien no tenga permiso.
  4. **Todas** las funciones de `src/lib/supabase-sync.ts` que hacen `.update(...).eq("id", …)` deben añadir `.select("id")` y lanzar `Error("Sin permiso o fila inexistente")` si `data.length === 0`.
- **Listo cuando:** nómina valida pruebas, refresca y sigue validado; una escritura sin permiso muestra un error en lugar de "funcionar" y revertirse.

### F0.5 Lecturas demasiado abiertas (PII)
- **Dónde:** `entries_read`, `entry_names_read`, `progress_read` y `history_read` usan `using (true)`. `entry_names_insert` usa `with check (true)`.
- **Problema:** cualquier agente lee todas las cartas (PDF con datos personales en `file_content`), todo el historial y puede insertar nombres en reportes ajenos.
- **Arreglo (en 019):**
  - `report_entries` SELECT: `public.is_payroll() or uploaded_by = auth.uid() or exists (select 1 from report_targets t where t.id = target_id and t.assigned_agent_id = auth.uid())`.
  - `report_entry_names` SELECT/INSERT: mediante `exists` sobre `report_entries`, con la misma regla (INSERT: dueño de la entrada o staff).
  - `task_progress` SELECT: dueño de la tarea o payroll.
  - `history_events` SELECT: `public.is_payroll()` (el filtro fino por módulo sigue en `src/lib/history.ts`).
- **Listo cuando:** `scripts/verify-report-rls.mjs` (o uno nuevo) confirma que un agente sin reportes asignados ve 0 cartas.

### F0.6 La ventana de 5 minutos solo existe en el cliente
- **Dónde:** `entries_update_own` (009), `entries_delete_staff` (001), `src/lib/reportUpload.ts:247`.
- **Arreglo:** en las policies de UPDATE/DELETE de `report_entries` y `report_entry_names`: `public.is_admin() or (created_at > now() - interval '5 minutes' and (uploaded_by = auth.uid() or public.current_role() = 'encargado'))`. Como el validador de integridad (`store.tsx:469`) parchea `linked_lead_id` fuera de esa ventana, ejecútalo **solo si `user.role === 'admin'`** o muévelo a una función `security definer` (`repair_carta_links()`).

### F0.7 Contraseñas
- **Dónde:** `src/views/UsuariosView.tsx:41` (se precarga `TuSalud2026!` en un input visible), `src/views/UsuariosView.tsx:247` (input sin `type="password"`), `src/lib/store.tsx:80-89`, `src/lib/seed.ts`.
- **Arreglo:** campo vacío con `type="password"`, botón "Generar contraseña segura" (`crypto.getRandomValues`, 14+ caracteres) y botón para copiar. Mínimo 10 caracteres validado en cliente y en la Edge Function. Las credenciales demo quedan solo en modo local (ya está así con `isSupabaseEnabled`). En DEPLOY.md: rotar la contraseña compartida actual de todos los usuarios.

### F0.8 Cabeceras de seguridad
- **Dónde:** `vercel.json`.
- **Arreglo:** añadir `headers` con `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()` y una CSP que permita `self`, `fonts.googleapis.com`, `fonts.gstatic.com` y `https://*.supabase.co wss://*.supabase.co` en `connect-src`.

### F0.9 Dependencia vulnerable
- **Dónde:** `package.json` → `xlsx@0.18.5` (prototype pollution + ReDoS, sin fix en npm).
- **Arreglo:** cambiar a `"xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"` y cargarlo con `await import("xlsx")` solo en `ImportView` (ver F2.1).

---

## F1 — Bugs de lógica y datos

### F1.1 Crear un usuario cambia la sesión del admin
- **Dónde:** `src/lib/store.tsx:2287`.
- **Problema:** `auth.signUp` en supabase-js v2 guarda la sesión del usuario nuevo cuando no hay confirmación por email. El admin queda autenticado (token) como el usuario creado, el `update profiles` siguiente corre con ese token y las escrituras posteriores del "admin" fallan por RLS.
- **Arreglo:** lo resuelve F0.1 (Edge Function). Quitar todo `signUp` del cliente.

### F1.2 El historial nunca se guarda en la nube
- **Dónde:** `withHistory` (`store.tsx:261`) solo modifica el estado local. Ninguna función inserta en `history_events`. `pullAppData` (`supabase-sync.ts:553`) reemplaza `historyEvents` cada 20 s.
- **Problema:** en producción, Historial está vacío o los eventos desaparecen al refrescar. Login y logout tampoco quedan registrados.
- **Arreglo:** crear `insertHistoryEvents(events)` en `supabase-sync.ts`. En `persist`, detectar los eventos nuevos (ids que no estaban en `base.historyEvents`) y enviarlos en un solo insert. Mejor a medio plazo: triggers de auditoría en la base para las tablas críticas (pagos, validaciones, roles). Historial con paginación (`range`) en lugar de `limit(200)`.
- **Listo cuando:** un evento creado en una pestaña aparece en otra pestaña o dispositivo y sobrevive a F5.

### F1.3 Los errores de guardado son invisibles
- **Dónde:** `cloudSafe` (`store.tsx:317`) solo hace `console.error`. Lo usan `updateLead`, `assignLead(s)`, `addTask`, `editTask`, `updateTaskStatus`, `addTaskProgress`, `validateTaskProofs`, `upsertPayment`, `updateUserRole/Status`, `assignReportTarget`, `createReportTarget`, `setForcePaymentWindow` y `advanceWeek`.
- **Problema:** la UI dice "Pago marcado como enviado" o "Tarea actualizada" aunque la base lo haya rechazado, y a los 12–20 s el cambio desaparece.
- **Arreglo:** `cloudSafe` recibe un `rollback: (prev) => AppData` y un callback de error. En el fallo: revertir el estado y mostrar un toast de error (ver F3.3). Las acciones de UI que hoy son síncronas y devuelven `{ ok }` deben devolver `Promise<{ ok, error }>` y la vista debe esperar la respuesta antes del toast de éxito.

### F1.4 Closure obsoleto en la carga de cartas
- **Dónde:** `store.tsx:1079`. `addReportEntries` usa `data.leads` en `filterDuplicateConsentUploads` y `planConsentLeadSync`, pero no lo tiene en las dependencias.
- **Problema:** el emparejamiento carta→lead puede usar leads viejos, así que no marca "realizado" o marca mal tras una importación reciente.
- **Arreglo:** leer siempre de `dataRef.current` dentro de las acciones asíncronas (`addReportEntries`, `updateReportEntry`, `linkCartaToLead`, `addLeads`, `upsertLeads`). Añadir ESLint con `react-hooks/exhaustive-deps` (F4.2) para que no vuelva a pasar.

### F1.5 `persist` re-ejecuta updaters con efectos secundarios
- **Dónde:** `store.tsx:457-463` y `logout` (`store.tsx:665`, que llama `persist` dentro del updater de `setUser`).
- **Problema:** si `prev !== base`, el updater se ejecuta 2 veces y los arrays externos (`touched`, `touchedTasks`, `markedLeads`) acumulan duplicados. En logout, StrictMode duplica el evento.
- **Arreglo:** los updaters deben ser puros y devolver `{ next, sideData }`. En `persist`, aplicar siempre sobre `dataRef.current` y hacer `setData(next)` directamente (sin reaplicar). En logout: leer `user` del closure y llamar `persist` fuera de `setUser`.

### F1.6 El progreso de metas es frágil y se puede manipular
- **Dónde:** `bumpConsentRealizadoGoals` (`taskGoals.ts`), `store.tsx:899-935` y `store.tsx:1600-1619`.
- **Problemas:**
  1. `goal_current` se calcula en el cliente y se escribe como valor absoluto, así que dos clientes simultáneos pierden o duplican progreso.
  2. Es inconsistente: al subir cartas se acredita a **quien sube** (`sessionUser.id`); al marcar realizado se acredita al **agente asignado al lead**. Si un admin o encargado sube la carta, el agente no recibe crédito.
  3. `markLeadsRealizado` sube la meta "cartas→realizado" **sin carta**, así que el agente puede llegar a la meta (y al pago) con solo marcar leads.
- **Arreglo:** mover el conteo a la base. Trigger en `report_entries` (INSERT/UPDATE de `linked_lead_id`, tipo consent) que recalcula `goal_current = count(cartas vinculadas a leads del agente asignado, con report_date en el rango de la tarea)`. Así es idempotente y no hay carreras. Quitar el bump del cliente en `markLeadsRealizado`. **Regla de negocio a confirmar con el usuario:** el crédito va al agente asignado al lead (recomendado).

### F1.7 Las ventanas de pago usan la hora del navegador, no la de Caracas
- **Dónde:** `getPaymentPhase` (`weekCalendar.ts:173`) usa `now.getDay()` y `now.getHours()`.
- **Arreglo:** obtener el día y la hora con `Intl.DateTimeFormat("en-US", { timeZone: "America/Caracas", weekday: "short", hour: "numeric", hourCycle: "h23" }).formatToParts(now)`. Lo mismo con `isSundayAssign`. Añadir tests (F4.3).

### F1.8 "Iniciar nueva semana" salta semanas y no pide confirmación
- **Dónde:** `PagosView.tsx:493`, `advanceWeek` (`store.tsx:2102`), `rollWeekForward` (`weekCalendar.ts:74`).
- **Problema:** la semana ya avanza sola con el calendario. El botón manual la adelanta una semana más, y `rollWeekForward` nunca retrocede, así que la semana queda desfasada para siempre. Basta un clic sin confirmar. Además el evento usa el tipo `payment_window_forced`.
- **Arreglo:** quitar el botón, o dejarlo solo para admin, con un diálogo de confirmación y deshabilitado si `currentWeekStart > operativeWeekStartFor(now)`. Añadir el tipo de historial `week_advanced`.

### F1.9 La simulación de ventanas es global y está en producción
- **Dónde:** `PagosView.tsx:484` y `app_settings.force_payment_window`.
- **Problema:** cualquier usuario de payroll abre las ventanas de pago para todos los usuarios.
- **Arreglo:** mostrar el switch solo si `import.meta.env.DEV` o el usuario es admin. Mostrar un banner visible ("Modo simulación activo") cuando esté encendido.

### F1.10 Pagos: comprobante simulado y monto en texto
- **Dónde:** `PagosView.tsx:843-852` (la "captura simulada" solo cambia un nombre), `paid_amount text`, `$450.00` hardcodeado en 3 sitios.
- **Arreglo:** subida real a Supabase Storage (bucket privado `payment-receipts`, ruta `{agentId}/{weekStart}.{ext}`, solo imágenes/PDF, máx. 5 MB) y guardar `screenshot_path`. Monto con `<input type="number" step="0.01">`; migración a `paid_amount numeric(10,2)`. El monto por defecto pasa a ser un ajuste (`app_settings.default_weekly_amount`). El comprobante se ve con signed URL.
- **Además:** `requestPaymentData` y `markPaymentSent` (`store.tsx:2166`, `store.tsx:2227`) retornan en silencio si no se cumplen las condiciones, pero la vista igual muestra "enviado". Deben devolver `{ ok, error }`.

### F1.11 Formulario de tarea: "agente" aparece elegido pero está vacío
- **Dónde:** `TareasView.tsx:151` (`useState(agents[0]?.id || "")`). Con Supabase, `agents` está vacío al montar y el `<select>` muestra el primer agente visualmente aunque el valor sea `""`.
- **Arreglo:** añadir `<option value="">Selecciona un agente…</option>`, o un `useEffect` que fije el primero cuando cargue `agents`. Restringir la fecha con `min` y `max` (lunes a viernes de la semana actual) y mostrar el día de la semana elegido.

### F1.12 Dashboard: datos fijos y conteos incorrectos
- **Dónde:** `DashboardView.tsx:171` (`"Semana 35"` hardcodeado), `DashboardView.tsx:11-12` (el agente ve el conteo de **todas** sus tareas históricas, no las de la semana) y `DashboardView.tsx:163` (`pendingTasks` global).
- **Arreglo:** usar `weekNumber` del store y `tasksInWeek(..., currentWeekStart)` en todos los contadores.

### F1.13 El botón "Reset" aparece en producción
- **Dónde:** `AppShell.tsx:300`. Se ve para **todos** los roles en escritorio. En modo Supabase carga los datos demo en memoria y pone `user = null` **sin** `signOut`.
- **Arreglo:** renderizarlo solo si `!isSupabaseEnabled`.

### F1.14 Toasts: siempre "éxito" y con ids que chocan
- **Dónde:** `components/Toast.tsx`. Todos muestran el ícono de check (incluidos los errores) y `id = Date.now()` duplica keys con dos toasts en el mismo milisegundo.
- **Arreglo:** ver F3.3.

### F1.15 Otros bugs menores
- `store.tsx:332` bootstrap: si el perfil está inactivo, hacer `signOut()` (hoy la sesión de Supabase queda viva).
- `store.tsx:582` login: `lastAccess` nunca se guarda. Llamar `updateProfileRow(id, { last_access })`.
- `supabase-sync.ts:286` `pushReportEntry`: insertar la entrada y después los nombres no es atómico (si fallan los nombres queda una entrada huérfana). Crear la RPC `create_report_entry(entry jsonb, names text[])` en una transacción.
- `reportUpload.ts:131` `triggerDownload`: `revokeObjectURL` inmediato puede abortar la descarga en Safari/Firefox. Usar `setTimeout(() => URL.revokeObjectURL(url), 1000)`.
- `taskGoals.ts:4`: la regex de autocompletar cierra la tarea con "**no** está listo" o "casi terminado". Sustituir por una casilla explícita "Marcar como terminada" en el modal de progreso.
- `ReportesView.tsx:910`: `refreshReports` depende de `data.profiles`, que cambia de referencia en cada pull, así que se dispara otra descarga de reportes cada 20 s. Depender solo de `targetId` y usar un ref para los perfiles.
- `store.tsx:1381` y `store.tsx:1446` numeración de leads del día: dos importaciones simultáneas pueden repetir números. Asignarlos en la base (RPC `next_lead_numbers(day, n)` con `pg_advisory_xact_lock`).
- `i18n.tsx`: errata `"Importación de leaks Excel"` → `leads`.
- `store.tsx:709-711`: la vista previa de agente está fijada al usuario `kennedy`. Permitir elegir el agente en el menú "Ver como".

---

## F2 — Rendimiento

### F2.1 Bundle de 987 KB en un solo chunk
- `React.lazy` + `Suspense` por vista en `App.tsx` (Leads, Reportes, Pagos, Tareas, Usuarios, Historial, Agentes).
- `xlsx` solo con `await import("xlsx")` dentro del handler de archivo de `ImportView`.
- `vite.config.ts`: `build.rollupOptions.output.manualChunks` → `{ react: ["react","react-dom"], supabase: ["@supabase/supabase-js"] }`.
- **Listo cuando:** el chunk inicial pesa < 300 KB y no sale el warning de Vite.

### F2.2 Descarga completa de toda la base cada 20 s y con cada evento Realtime
- **Dónde:** `store.tsx:365-434` → `pullAppData()` trae todos los leads (con `raw_data`), reportes, nombres, tareas, progreso y pagos. Cada cambio de **cualquier** usuario dispara otra descarga completa en **todos** los clientes.
- **Arreglo (incremental):** aplicar el payload de `postgres_changes` (`INSERT/UPDATE/DELETE`) directamente sobre el estado por tabla (`applyRealtimeChange(table, payload)`), y hacer un pull completo solo al volver de segundo plano o cada 5 min como respaldo. Quitar el `skipPullUntilRef` de 12 s (con parches por fila deja de hacer falta). Para `report_entry_names`, agrupar con debounce.

### F2.3 Los PDF se guardan como base64 en una columna de texto
- **Dónde:** `report_entries.file_content` (hasta 8 MB por carta, +33 % por base64).
- **Arreglo:** bucket privado `consent-letters` en Supabase Storage. Subir el `File` directo (`{targetId}/{entryId}.pdf`), guardar `file_path` y descargar con `createSignedUrl`. Hash: calcular SHA-256 de los **bytes** del archivo en el cliente y guardarlo en `content_hash`. Script de migración que mueve los `file_content` existentes a Storage y recalcula el hash sobre los bytes (el hash actual es del string data-URL; recalcular todos para que el índice único siga siendo coherente). Después, `file_content = null`.

### F2.4 Renders costosos
- `LeadsView.tsx:382` `canEditLead` y `agentName` hacen `data.leads.find` / `data.profiles.find` por fila (O(n²)). Usar `useMemo(() => new Map(...))`.
- Búsqueda de leads (`LeadsView.tsx:267`): `useDeferredValue(q)` y normalizar teléfonos (quitar no-dígitos en ambos lados).
- `ReportesView.tsx:73`: cada tarjeta crea su propio `setInterval` de 1 s. Usar un único hook `useNow(1000)` compartido, activo solo si alguna tarjeta está dentro de la ventana.
- Listas largas (leads, historial): virtualizar con `@tanstack/react-virtual` en lugar de "Ver más +20".
- `getAgentStats` depende de todo `data`: memorizar por `[data.tasks, data.leads, currentWeekStart]`.

---

## F3 — UX/UI moderna

### F3.1 Rutas reales (URL)
Hoy la vista vive en `useState` (`App.tsx:35`): F5 vuelve al dashboard, el botón "atrás" sale de la app y no se pueden compartir enlaces. Usar hash routing ligero (`#/leads`, `#/reportes/:targetId`, `#/agentes/:id`) con `useSyncExternalStore` sobre `hashchange`, o `react-router` v7. Mantener las mismas reglas de acceso de `navigate()`.

### F3.2 Sistema de diálogos accesible
Los drawers (`PaymentDrawer` y los de Tareas/Leads) no tienen `role="dialog"`, `aria-modal`, foco atrapado, cierre con Escape ni devolución del foco. Crear `components/Dialog.tsx` (se puede usar `<dialog>` nativo + `showModal()`) y `components/ConfirmDialog.tsx` para reemplazar `window.confirm` (`ReportesView.tsx:148`) y confirmar acciones destructivas (eliminar, nueva semana, desactivar usuario, cambiar rol).

### F3.3 Toasts modernos
`toast.success / toast.error / toast.info` con ícono y color por tipo, `aria-live="polite"` (`assertive` para errores), id con `crypto.randomUUID()`, pausa al pasar el mouse, botón cerrar y acción opcional ("Deshacer" en asignaciones masivas y en "marcar realizado").

### F3.4 Indicador de sincronización
Una pastilla en la topbar: "Guardado ✓", "Guardando…", "Sin conexión" o "Error, reintentar". Escuchar `online/offline` y el estado del canal Realtime. Sustituye al texto fijo "Operación activa" del dashboard.

### F3.5 Estados de carga y vacíos
Reemplazar "Cargando TuSalud CRM…" y los paneles vacíos por skeletons (tarjetas y filas) mientras llega el primer `pullAppData` (hoy el usuario ve ceros y listas vacías durante varios segundos).

### F3.6 Tema sin parpadeo
Añadir un script inline en `index.html`, antes de los estilos, que lea `localStorage["tusalud-theme"]` o `prefers-color-scheme` y fije `data-theme` en `<html>`. Actualizar `meta[name=theme-color]` según el tema.

### F3.7 Accesibilidad
- `TareasView.tsx:40`: `.task-check` es un `<div onClick>`. Cambiarlo a `<button aria-pressed>`.
- `styles.css:308`, `styles.css:1761` y `styles.css:2957`: `outline: none` sin reemplazo. Añadir un estilo `:focus-visible` global (anillo teal de 2 px).
- Añadir `@media (prefers-reduced-motion: reduce)` que desactive las animaciones (`slideUp`, `day-folder-unfold`, `pulse`, `sync-pulse`).
- Inputs sin `<label htmlFor>` en Pagos, Tareas y Usuarios. Asociarlos.
- Los emojis de íconos (`🔒 📝 📷 🛡`) necesitan `aria-hidden`, o reemplazarlos por los SVG de `Icons.tsx` para que el estilo sea consistente.

### F3.8 Quitar estilos inline y usar tokens
Hay unos 150 `style={{…}}` (Pagos 39, Reportes 28, Tareas 28, Leads 23, Usuarios 19). Pasarlos a clases en `styles.css` usando los tokens existentes (`--teal`, `--muted`, `--line`…). Componentes reutilizables: `<Avatar name>` (la lógica de iniciales está copiada 4 veces), `<ProgressBar value max>` (meta de tarea), `<KeyValueRows>` (data-box/status-card) y `<SectionLabel>`.

### F3.9 i18n completo
El selector ES/EN existe, pero Pagos, Tareas, Leads, Reportes y Usuarios tienen el texto en español hardcodeado, así que en EN la app queda a medias. Pasar los strings a `i18n.tsx`, o quitar EN hasta completarlo. Usar `Intl.NumberFormat` para montos e `Intl.DateTimeFormat` según el locale.

### F3.10 Mejoras de producto con buen retorno
- **Búsqueda global ⌘K / Ctrl+K:** leads (por #, nombre o teléfono), agentes, reportes y acciones ("Nueva tarea", "Importar").
- **Notificación en vivo al agente** cuando le piden datos Zelle o le validan una tarea (toast vía Realtime + contador en la nav de Pagos/Tareas).
- **PWA:** `manifest.webmanifest` + íconos (ya existen las metas `mobile-web-app-capable`, pero falta el manifest) para instalar en el móvil.
- **Exportar CSV** de leads filtrados y del historial de pagos (staff).
- **Barra de acciones masivas fija** en Leads al seleccionar (contador + asignar + realizado + deshacer).
- **Dashboard staff:** gráfico semanal de cartas→realizado por agente y estado de la cola de pagos (barras simples en SVG, sin librería pesada).

---

## F4 — Calidad e infraestructura

### F4.1 Separar `store.tsx` (2570 líneas)
Dividirlo por dominio sin cambiar la API pública de `useStore()`: `store/auth.ts`, `store/leads.ts`, `store/reports.ts`, `store/tasks.ts`, `store/payments.ts`, `store/users.ts`, `store/sync.ts` (pull/realtime) y `store/history.ts`. Cada módulo exporta un hook interno que recibe `{ persist, dataRef, user, notify }`. Hacerlo **después** de F0–F1 para no mezclar refactor con fixes.

### F4.2 ESLint + Prettier
`eslint` con `typescript-eslint`, `eslint-plugin-react-hooks` (`exhaustive-deps` como error) y `eslint-plugin-jsx-a11y`. Script `"lint"` en `package.json`. Corregir los warnings de dependencias de hooks (encontrará F1.4).

### F4.3 Tests (Vitest)
Empezar por la lógica pura, que es donde están las reglas de negocio:
- `weekCalendar.ts`: `getPaymentPhase` en zona Caracas (jueves 17:59 / 18:00, viernes), `rollWeekForward`, `operativeWeekStartFor` en sábado y domingo.
- `cartaLeadSync.ts`: `fuzzyPersonMatch`, `extractPersonFromCartaLabel` (prefijos, "(1)", "copia"), `resolveConsentLeadLink` con homónimos y `#N`.
- `taskGoals.ts` y `lead-dependents.ts` (`leadMatchKey`).
- Script `"test": "vitest run"` y ejecutarlo en `build` o en CI.

### F4.4 CI
GitHub Action: `npm ci && npm run lint && npx tsc --noEmit && npm test && npm run build`.

### F4.5 Limpieza del repo
- `scripts/` tiene unos 30 scripts de un solo uso con IDs fijos. Moverlos a `scripts/archive/` y documentar los vigentes en el README.
- `preview/` y `previews/`: mover a `docs/design/` o excluirlos del deploy (verificar `.vercelignore`).
- Quitar `pushAppData` (`supabase-sync.ts:710`, código muerto y peligroso porque hace upsert masivo) y `fetchNextLeadNumber` si no se usa.
- README: las credenciales demo (`admin@tusalud.com / demo123`) no coinciden con el código (`abloody / TuSalud2026!`). Actualizarlo.
- `.gitignore`: la línea `.env*` final duplica `.env.*` y anula `!.env.example`. Dejar solo el bloque correcto.

---

## Orden sugerido de PRs

1. **PR-1 Seguridad DB:** migración 019 (F0.1–F0.6) + Edge Function + `createUser`. Probar con los 4 roles por API.
2. **PR-2 Escrituras confiables:** F0.4.4 (`.select` + error en 0 filas), F1.3 (rollback + toast de error), F1.2 (historial en la nube), F3.3 (toasts).
3. **PR-3 Lógica de negocio:** F1.6–F1.12 (metas en la base, zona Caracas, semana, pagos con Storage).
4. **PR-4 Rendimiento:** F2.1–F2.4 (code-split, Realtime incremental, PDFs a Storage).
5. **PR-5 UX:** F3.1–F3.9.
6. **PR-6 Calidad:** F4.x (lint, tests, CI y después el refactor del store).
