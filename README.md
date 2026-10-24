# TuSalud CRM — Demo pública

CRM operativo de ejemplo (roles, leads, reportes, tareas semanales, pagos).  
**Datos 100 % ficticios.** No contiene información de clientes reales.

Live: _(se publica en Vercel tras el push)_

## Probar en 30 segundos

1. Abre el sitio desplegado.
2. Entra con cualquiera de estos usuarios (misma contraseña):

| Usuario | Rol | Password |
|---|---|---|
| `admin` | Admin | `Demo2026!` |
| `maria` | Agente | `Demo2026!` |
| `carlos` | Agente | `Demo2026!` |
| `elena` | Nómina | `Demo2026!` |

Esta demo corre **sin Supabase** (modo local / `localStorage`) para que cualquiera la explore. El código completo de sync con Supabase + migraciones está en `src/lib/` y `supabase/` por si quieres desplegar tu propia instancia.

## Stack

- React 19 + Vite + TypeScript
- Supabase (Auth, Postgres, RLS) — opcional en esta demo
- Roles: admin · encargado · agente · nómina

## Local

```bash
npm install
npm run dev
```

Abre http://localhost:5173 — sin variables de entorno.

Para modo cloud (opcional):

```bash
cp .env.example .env
# VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY de un proyecto NUEVO (nunca producción)
npm run seed:supabase
```

## Autor

[Edjouner Rojas](https://github.com/abloodykpaw) · [Portafolio](https://abloodykpaw.github.io/portafolio/)
