# Despliegue a producción — TuSalud CRM

## 1. Crear proyecto Supabase (separado de Oxxus)

1. Entra a [supabase.com/dashboard](https://supabase.com/dashboard)
2. **New project** → nombre: `tusalud-crm`
3. Guarda la contraseña de la base de datos

## 2. Aplicar migraciones

En **SQL Editor**, ejecuta en orden los archivos de `supabase/migrations/`:

1. `001_initial_schema.sql`
2. `002_weekly_payments.sql`
3. `003_users_meta.sql`
4. `004_history_settings_auth.sql`

O con CLI:

```bash
npx supabase login
npx supabase link --project-ref TU_PROJECT_REF
npx supabase db push
```

## 3. Configurar Auth

En Supabase → **Authentication** → **Providers** → Email:

- Desactiva **Confirm email** (para login directo del equipo)
- Desactiva **Allow new users to sign up**: los usuarios solo los crea un admin desde la app (Edge Function `admin-create-user`, desplegada desde `supabase/functions/admin-create-user`).

## 4. Variables de entorno

Copia `.env.example` a `.env` y completa:

```env
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

Seed del equipo:

```bash
node scripts/seed-supabase.mjs
```

Eliminar cuentas demo antiguas (`@tusalud.com`):

```bash
node scripts/remove-demo-users.mjs
```

## 5. Deploy en Vercel

### Opción A — Git conectado (recomendado)

1. Repo: `https://github.com/abloodykpaw/tusalud-ensurance-crm` (rama `main`)
2. En GitHub → **Settings** → **Applications** → **Vercel** → **Configure**
3. En **Repository access**, agrega `tusalud-ensurance-crm` (repo privado)
4. En Vercel → proyecto **tusalud-crm** → **Settings** → **Git** → **Connect**
5. Selecciona el repo y rama `main` — cada `git push` despliega automáticamente

```bash
npx vercel git connect https://github.com/abloodykpaw/tusalud-ensurance-crm.git
```

### Opción B — Deploy manual (CLI)

```bash
npx vercel pull --yes --environment=production
npx vercel build --prod --yes
npx vercel deploy --prebuilt --prod --yes
```

### Variables de entorno en Vercel

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Framework: **Vite** · Build: `npm run build` · Output: `dist`

## 6. Dominio recomendado

| Dominio | Uso |
|---------|-----|
| **`crm.tusaludensurance.com`** | Recomendado — claro y profesional |
| `app.tusaludensurance.com` | Alternativa genérica |

En Vercel → **Settings** → **Domains** → agrega el subdominio.

En tu registrador (GoDaddy, Namecheap, etc.):

```
Tipo: CNAME
Nombre: crm
Valor: cname.vercel-dns.com
```

## 7. Verificar

- Login: `abloody` / contraseña del equipo (creada en Supabase Auth)
- Los datos operativos se guardan en Supabase (no en `localStorage`)
- Sin variables de entorno, la app funciona en local con datos demo en `localStorage`

## 8. Seguridad y datos

### Contraseñas (ya en base de datos)

Las contraseñas **no** van en `public.profiles`. Supabase Auth las guarda en `auth.users` con **hash bcrypt**. La app solo envía usuario + contraseña al login; nunca se sincronizan al frontend ni a tablas públicas.

| Dónde | Qué se guarda |
|-------|----------------|
| `auth.users` (Supabase) | Contraseña hasheada |
| `public.profiles` | Nombre, usuario, rol, email de contacto |
| `localStorage` (opcional) | Solo usuario recordado si marcas “Recordar” — **sin contraseña** |
| Sesión Supabase | JWT + refresh token (login persistente hasta cerrar sesión) |

### Qué datos están en Supabase hoy

| Tabla | Contenido |
|-------|-----------|
| `profiles` | Equipo, roles, teléfono |
| `leads` | Contactos, teléfonos, notas |
| `report_entries` | Reportes y archivos (texto/base64) |
| `weekly_payments` | Datos Zelle, montos, capturas |
| `weekly_tasks` / `task_progress` | Tareas y avances |
| `history_events` | Auditoría de acciones |

### RLS (Row Level Security)

Todas las tablas tienen RLS activo. Desde la migración `019_security_hardening.sql`:

- **Agentes**: ven sus leads, tareas, pagos y los reportes asignados. En leads solo cambian estado y notas; en pagos solo envían sus datos Zelle. No pueden validar tareas, marcar pagos ni cambiar su rol.
- **Nómina**: valida pruebas y gestiona pagos Zelle. No vincula cartas.
- **Admin / encargado**: acceso de staff. Solo admin cambia roles/estados, ajustes y la semana.
- **Metas de cartas**: se calculan en la base (trigger) y se acreditan al agente asignado al lead.
- **Comprobantes de pago**: bucket privado `payment-receipts` (imágenes/PDF, máx. 5 MB), visibles con URL firmada.

Revisar políticas en `supabase/migrations/` antes de ampliar el equipo.

### Checklist antes de producción real

- [ ] Rotar la contraseña compartida actual: una contraseña propia (mín. 10 caracteres) por persona
- [ ] Authentication → desactivar **Allow new users to sign up**
- [ ] `SUPABASE_SERVICE_ROLE_KEY` solo en `.env` local y scripts — **nunca** en Vercel ni en el repo
- [ ] Confirmar variables `VITE_*` en Vercel (Production)
- [ ] Supabase → **Authentication** → **URL Configuration**: Site URL = tu dominio Vercel o `crm.tusaludensurance.com`
- [ ] Supabase → **Database** → activar backups (plan Pro) o export manual periódico
- [ ] Vercel → **Deployment Protection** (opcional): contraseña mientras usas dominio de prueba
- [ ] Rotar contraseñas si alguien del equipo sale

### Dominio de prueba → dominio propio

Mientras usas `tusalud-crm.vercel.app`:

1. Funciona igual que producción; HTTPS incluido
2. Puedes añadir **Vercel Authentication** o contraseña de preview para que no sea público
3. Cuando tengas `crm.tusaludensurance.com`:
   - Vercel → Domains → agregar CNAME
   - Supabase → Auth → Site URL y Redirect URLs con el nuevo dominio
   - Sin cambios de código

## Costo estimado

- Vercel Hobby: $0
- Supabase Free: $0 (hasta ~50k usuarios activos/mes)
- Dominio `.com`: ~$12/año
