# Squee Online

A fully ESM TypeScript monorepo built for Node.js 24 with pnpm workspaces and Turborepo.

## Architecture

- `apps/web` — React 19 and React Router 8 Framework Mode with SSR, Vite 8, TanStack Query,
  Tailwind CSS 4, shadcn/ui, and CSS Modules.
- `apps/api` — separately deployable Hono Node service. Its only public package export is
  `@repo/api/client`.
- `apps/worker` — independently deployable background process and future PostgreSQL job consumer.
- `packages/auth` — Better Auth server factory, browser client, and schema-generation config.
- `packages/db` — PostgreSQL schema, migrations, and Drizzle client for server-side applications.
- `packages/env` — Zod-validated server environment contracts.
- `packages/object-storage` — lifecycle-managed S3-compatible object-storage client factory.
- `packages/config` — shared TypeScript and Vitest configuration.
- `packages/test-utils` — fixtures and MSW handlers.
- `tooling/scripts` — repository-specific scripts.

The browser and React Router SSR process both call the Hono contract. They never import database or API
server modules. In production, route `/api/auth/*` to the Hono service without rewriting the path.
Route the remaining `/api/*` requests to Hono with the `/api` prefix stripped, and route all other
requests to the web service.

## Requirements

- Node.js 24 LTS
- pnpm 11.15.1 (activate with `corepack enable`)
- Docker or another PostgreSQL 18-compatible server for local API-backed development

## Start locally

```bash
cp .env.example .env
# Set PostgreSQL, Better Auth, and dedicated development S3 credentials in .env before continuing.
# Suggested generators: `openssl rand -hex 24` for the password and
# `openssl rand -base64 32` for the authentication secret.
docker compose up -d postgres
pnpm install
pnpm db:migrate
pnpm dev
```

Docker Compose reads the root `.env` automatically. `POSTGRES_DB` and `POSTGRES_USER` default to
`squee_online`, and `POSTGRES_PORT` defaults to `5432`. Set `POSTGRES_PASSWORD` before the database is
initialized; the official image rejects an empty password. Local dev, migration, studio, and
auth-generation commands load this file and derive a correctly encoded `DATABASE_URL` from the
PostgreSQL settings. An explicitly supplied `DATABASE_URL` takes precedence. API startup also requires
a unique `BETTER_AUTH_SECRET` of at least 32 characters. Production start commands do not load the
local file and must receive both values from the deployment platform.

The API environment also requires an explicit private S3-compatible bucket, endpoint, region, access
key, and secret key. Local development must use a dedicated non-production bucket and credentials;
production must inject a different bucket and credentials through its runtime or mounted secrets.
There are no production storage fallbacks. Hetzner uses location-specific HTTPS endpoints and
virtual-hosted bucket addressing, so keep `S3_FORCE_PATH_STYLE=false`; set it explicitly only for a
provider that requires path-style requests.

PostgreSQL applies its initialization variables only when creating a new data directory. If you
change these values after the `postgres-18-data` volume has been initialized, update the existing
role/database or recreate the local volume before starting PostgreSQL again.

The web app runs at `http://localhost:5173`; the API runs at `http://localhost:3001`. Vite proxies
same-origin browser requests from `/api` to the API. `API_INTERNAL_URL` is used for server-side calls.
The worker runs as a separate headless process under `pnpm dev`; its polling interval defaults to one
second and can be changed with `WORKER_POLL_INTERVAL_MS`. Until the jobs repository is implemented,
the poll callback intentionally performs no work while preserving the production process lifecycle.

## Commands

```bash
pnpm build          # all production builds through Turborepo
pnpm typecheck      # authoritative TypeScript project checks
pnpm lint           # Oxlint
pnpm lint:types     # type-aware Oxlint
pnpm format         # Oxfmt write mode
pnpm format:check   # Oxfmt check mode
pnpm test           # Vitest unit and integration tests
pnpm test:e2e       # Playwright browser tests with a hermetic API server
pnpm --filter @repo/worker dev    # worker process only
pnpm auth:generate  # regenerate Better Auth's committed Drizzle schema
pnpm db:generate    # generate Drizzle migrations after schema changes
pnpm db:migrate     # apply Drizzle migrations
pnpm db:studio      # open Drizzle Studio
```

Add shadcn/ui primitives directly to the web app from the repository root:

```bash
pnpm dlx shadcn@latest add button -c apps/web
```

After changing Better Auth methods or plugins, run `pnpm auth:generate`, review the generated schema,
then run `pnpm db:generate` to create the SQL migration.

Run `pnpm changeset` only when changing a package that has intentionally been made publishable. Current
workspaces are private and are excluded from versioning and publishing.
