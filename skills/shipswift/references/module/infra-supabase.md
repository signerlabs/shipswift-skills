---
id: infra-supabase
title: Supabase + Cloudflare Workers Infrastructure
description: Production-ready serverless infrastructure using Supabase (managed Postgres + Auth + Storage) and Cloudflare Workers (Hono backend) — the zero-VPC, zero-server counterpart to the AWS CDK stack. Covers Supabase CLI migrations, the immutable-region rule, secret management (.dev.vars / Cloudflare Secret, never git), Workers deployment via wrangler, and dual-mode JWT verification (JWKS ES256 preferred, HS256 fallback).
tier: free
tags: [Supabase, Cloudflare Workers, wrangler, Hono, infrastructure, migrations, Supabase CLI, secrets, JWKS, HS256, deployment, serverless, Postgres, RLS]
---

## What This Solves

Manually clicking through the Supabase dashboard and pasting SQL into the SQL Editor is error-prone, unrepeatable, and impossible to version control. As your app grows you will need to reproduce your schema for a staging project, a second app, or a fresh region — and "remember which buttons I clicked" does not scale.

This recipe defines the entire **Supabase + Cloudflare Workers** stack as code:

- **Reproducibility** — `supabase db push` replays every migration onto a fresh project; `wrangler deploy` ships the backend from source
- **Version control** — schema changes are timestamped SQL files in git, reviewed in the same PR as application code
- **No servers, no VPC** — Supabase is managed Postgres/Auth/Storage over HTTPS; Workers run at the edge. There is nothing to patch, no NAT Gateway, no connection pool to size
- **Secret hygiene by construction** — a single rule (`.dev.vars` locally, Cloudflare Secret in prod, never git) keeps the RLS-bypassing `service_role` key out of every tracked file
- **Cost floor near zero** — both platforms have generous free tiers; you pay per request, not per idle hour

This is the **serverless counterpart** to [infra-cdk](recipe://infra-cdk). Read them side by side: where CDK provisions a VPC + Aurora + App Runner + Cognito + API Gateway (rich control, ~$80/mo floor, minutes to deploy), this stack trades that control for a managed BaaS that has no idle cost and deploys in seconds. Choose CDK when you need VPC-private resources, fine-grained IAM, or AWS-native services; choose Supabase + Workers for indie iOS apps that want the shortest path from `git push` to production.

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                          iOS Client                                │
│              (URLSession only — never talks to Supabase)           │
└──────────────────────────────┬─────────────────────────────────────┘
                               │ HTTPS (REST + Bearer JWT)
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│                 Cloudflare Workers  (Hono backend)                 │
│   src/index.ts → routes → middleware (verify JWT) → supabase-js    │
│   compatibility_flags: ["nodejs_compat"]                           │
└───────────────┬───────────────────────────────┬────────────────────┘
                │ service_role (bypass RLS)      │ user JWT (RLS on)
                ▼                                ▼
┌──────────────────────────────────────────────────────────────────┐
│                        Supabase project                            │
│   Auth (GoTrue)   ·   Postgres + RLS   ·   Storage (private)       │
│   region: chosen at creation — IMMUTABLE                           │
└──────────────────────────────────────────────────────────────────┘

        Deploy / provision path (two independent pipelines):
        ┌─────────────────────┐        ┌──────────────────────────┐
        │  supabase CLI       │        │  wrangler / GitHub CI     │
        │  db push → Postgres │        │  deploy → Workers runtime │
        └─────────────────────┘        └──────────────────────────┘
```

**Component roles:**

| Component | Purpose | Why this one |
|-----------|---------|-------------|
| **Cloudflare Workers** | Backend runtime | Edge-deployed, scales to zero, auto-deploy from GitHub, no server to manage |
| **Supabase Postgres** | Database + RLS | Managed Postgres with Row Level Security as the isolation primitive |
| **Supabase Auth (GoTrue)** | Authentication | Anonymous sign-in + Sign in with Apple + real signed JWTs |
| **Supabase Storage** | File storage | S3-compatible object store with private buckets + signed URLs |
| **Supabase CLI** | Schema-as-code | `db push` replays timestamped migrations onto any project |
| **wrangler** | Deploy + secrets | `deploy` ships the Worker; `secret put` sets encrypted runtime vars |
| **.dev.vars** | Local secrets | Gitignored file feeding `c.env` during `wrangler dev` |
| **Cloudflare Secret** | Prod secrets | Encrypted, injected at runtime; never in `wrangler.jsonc` or git |
| **jose** | JWT verification | Verifies Supabase JWTs against JWKS (ES256) or the legacy secret (HS256) |

> **iOS stays dependency-free**: the client only ever talks to the Worker over REST. It never imports `supabase-swift` and never holds the `service_role` key. The Worker is the only thing that touches Supabase. See [auth-supabase-anonymous](recipe://auth-supabase-anonymous).

## Dependencies

```json
{
  "dependencies": {
    "hono": "^4.12.5",
    "@supabase/supabase-js": "^2.58.0",
    "jose": "^6.1.3",
    "zod": "^4.3.6"
  },
  "devDependencies": {
    "wrangler": "^4.40.0",
    "supabase": "^2.0.0",
    "@cloudflare/workers-types": "^4.20260101.0",
    "typescript": "^5.7.2"
  }
}
```

Install with:

```bash
npm install hono @supabase/supabase-js jose zod
npm install --save-dev wrangler @cloudflare/workers-types typescript
# Supabase CLI: install as a dev dependency (above) OR globally via Homebrew.
# Do NOT `npm install -g supabase` — the npm global install is unsupported.
brew install supabase/tap/supabase
```

Add scripts to your `package.json`:

```json
{
  "scripts": {
    "typecheck": "tsc --noEmit",
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "db:push": "supabase db push",
    "cf-typegen": "wrangler types"
  }
}
```

> **Module resolution**: on Workers use `"moduleResolution": "Bundler"` in `tsconfig.json` (with `@cloudflare/workers-types`), **not** `NodeNext`. This is the biggest divergence from a Node/App-Runner backend — do not copy Node import ergonomics onto Workers.

## Implementation

### Project Structure

```
your-server/
├── src/
│   ├── index.ts                 # Workers entry — `export default app`
│   ├── types.ts                 # Env (c.env bindings) + AppEnv + zod schemas
│   ├── lib/
│   │   └── supabase.ts          # serviceClient / userClient / anonClient factories
│   ├── middleware/
│   │   └── auth.ts              # JWT verification (JWKS ES256 / HS256)
│   └── routes/                  # business routes (Hono)
├── supabase/
│   ├── config.toml              # Supabase CLI config (auth toggles, local ports)
│   ├── migrations/              # timestamped SQL — the schema source of truth
│   │   ├── 0001_init.sql
│   │   └── 0002_storage.sql
│   └── .temp/linked-project.json  # written by `supabase link` (gitignored)
├── wrangler.jsonc               # Workers config (name, main, compat flags, vars)
├── .dev.vars                    # local secrets (GITIGNORED)
├── .dev.vars.example            # committed template (placeholder values only)
├── tsconfig.json
└── package.json
```

### 1. Supabase project setup (region is immutable)

Create the project once, in the correct region:

```bash
# Log in and create (or do it in the dashboard — the region prompt is the load-bearing step).
supabase login
# Region is chosen at creation and CANNOT be changed afterwards. Pick your users' region.
# e.g. Singapore = ap-southeast-1 for SG/SEA users, us-east-1 for US, etc.
```

Then link your local repo to the hosted project so `db push` knows where to go:

```bash
# project-ref is the subdomain of your Supabase URL: https://<project-ref>.supabase.co
supabase link --project-ref <project-ref>
# writes supabase/.temp/linked-project.json (gitignore it)
```

`supabase/config.toml` captures the auth configuration as code:

```toml
# supabase/config.toml — used by the CLI (local `supabase start`, `supabase db push`).
# region is NOT set here — it is chosen at project creation and is IMMUTABLE.

[auth]
enabled = true
jwt_expiry = 3600
enable_refresh_token_rotation = true
refresh_token_reuse_interval = 10

# Anonymous sign-in (zero-friction first launch).
enable_anonymous_sign_ins = true

[auth.rate_limit]
anonymous_users = 30   # per-IP anonymous sign-ins per hour (anti-abuse)

# Sign in with Apple (iOS-only native id_token flow — no Services ID / .p8 needed).
[auth.external.apple]
enabled = false                       # local placeholder; enable + fill bundle id in the console
client_id = "com.yourcompany.app"
secret = ""
```

### 2. Migrations: schema as timestamped SQL

Every schema change is a numbered file in `supabase/migrations/`. Two ways to author them:

```bash
# A. Generate a diff from local changes (if you use `supabase start` locally):
supabase db diff -f add_items_table   # writes supabase/migrations/<ts>_add_items_table.sql

# B. Hand-write the file (common for RLS-heavy changes you want to control precisely):
#    create supabase/migrations/0003_add_index.sql and write the SQL yourself.

# Apply all pending migrations to the LINKED hosted project:
npm run db:push        # == supabase db push
```

**Write every migration idempotently** so re-applying (SQL Editor by hand / CI / `db push` twice) never errors:

```sql
-- Tables: if not exists.  Indexes: if not exists.  Columns: add column if not exists.
-- Policies: drop policy if exists <name> ... then create — RLS has no "create or replace".
create table if not exists items (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references profiles(id) on delete cascade,
  title      text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_items_owner_id on items (owner_id);

drop policy if exists "items_all_own" on items;
create policy "items_all_own" on items
  for all to authenticated
  using ( (select auth.uid()) = owner_id )
  with check ( (select auth.uid()) = owner_id );
```

> **Pure DDL that PostgREST can't run** (e.g. `alter table ... drop column`) must go through `supabase db push` or the SQL Editor — you cannot apply it with the `service_role` REST client. Full RLS patterns live in [infra-supabase-rls](recipe://infra-supabase-rls); Storage buckets in [infra-supabase-storage](recipe://infra-supabase-storage).

### 3. Cloudflare Workers configuration

```jsonc
// wrangler.jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "your-app-server",
  "main": "src/index.ts",
  "compatibility_date": "2025-05-01",
  // supabase-js relies on some Node built-ins on Workers → nodejs_compat is REQUIRED.
  "compatibility_flags": ["nodejs_compat"],
  "observability": { "enabled": true },

  // Non-sensitive plaintext vars only. Secrets NEVER go here (see below).
  "vars": {
    "APP_ENV": "production"
  }
}
```

The typed bindings (`c.env`) mirror `wrangler.jsonc` + your secrets:

```typescript
// src/types.ts
export interface Env {
  SUPABASE_URL: string;               // https://<project-ref>.supabase.co
  SUPABASE_SERVICE_ROLE_KEY: string;  // bypasses RLS; server-side secret, never shipped
  SUPABASE_ANON_KEY: string;          // apikey for the user-JWT / anon clients
  SUPABASE_JWT_SECRET?: string;       // optional: HS256 legacy secret; ES256 uses JWKS
}
```

> On Workers you read config from **`c.env`** (Hono Bindings), **not** `process.env`. There is no `process.env` at the edge.

### 4. Secret management (the one rule that keeps you safe)

The `service_role` key bypasses **all** RLS — a leak is a full-database compromise. It, the anon key, and the optional JWT secret follow one rule: **`.dev.vars` locally, Cloudflare Secret in prod, never git.**

```bash
# .dev.vars  — GITIGNORED. Feeds c.env during `wrangler dev`. Real values live here locally only.
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=sb_secret_...
SUPABASE_ANON_KEY=sb_publishable_...
# SUPABASE_JWT_SECRET=...   # only if the project still uses HS256
```

Commit a **`.dev.vars.example`** with placeholder values so teammates know the shape, and confirm `.dev.vars` is in `.gitignore`. For production, set each secret as an encrypted Cloudflare Secret:

```bash
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put SUPABASE_ANON_KEY
# npx wrangler secret put SUPABASE_JWT_SECRET   # only if the project still uses HS256
```

Or in the dashboard: **Workers & Pages → your-worker → Settings → Variables and Secrets** → add as type **Secret** (the encrypted, runtime section — NOT the plaintext "build" vars).

### 5. Client factories (service_role vs user-JWT vs anon)

```typescript
// src/lib/supabase.ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../types";

// Workers has no localStorage / persistent session — keep the client stateless.
const STATELESS_AUTH = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
} as const;

/**
 * service_role client — bypasses ALL RLS. System operations ONLY (anonymous sign-in,
 * profile-row init, Storage uploads, cleanup). Never per-user reads/writes.
 * The key must be placed explicitly in the Authorization header to reliably bypass RLS:
 * PostgREST decides the role from Authorization (not apikey), so relying on the createClient
 * 2nd arg alone can leave requests bound to an RLS-constrained role.
 */
export function serviceClient(env: Env): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    ...STATELESS_AUTH,
    global: { headers: { Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` } },
  });
}

/** User-JWT client — runs as the request's user, so RLS is enforced automatically. */
export function userClient(env: Env, accessToken: string): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    ...STATELESS_AUTH,
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

/** Anon client — anon key only, no user Authorization. Used for GoTrue ops without a token
 *  yet (e.g. refreshSession, where the refresh_token IS the credential). */
export function anonClient(env: Env): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, STATELESS_AUTH);
}
```

> Workers talk to Supabase over PostgREST-over-HTTP, not a raw Postgres TCP socket, so there is **no connection pool to exhaust** — creating a fresh client per request is safe and recommended. This is a key difference from the Aurora + RDS Proxy model in [infra-cdk](recipe://infra-cdk), where connection storms are a real risk.

### 6. JWT verification: JWKS (ES256) preferred, HS256 fallback

The middleware verifies the Supabase JWT against the project's JWKS (asymmetric ES256, best for edge) or the legacy symmetric secret (HS256). Leaving `SUPABASE_JWT_SECRET` empty selects JWKS.

```typescript
// src/middleware/auth.ts (verification core — full three-level middleware in auth-supabase-anonymous)
import * as jose from "jose";
import type { AuthUser, Env } from "../types";

// jose's createRemoteJWKSet has a built-in cache + key rotation, so it MUST be reused across
// requests. A module-level Map survives across requests in the same Workers isolate.
const jwksCache = new Map<string, ReturnType<typeof jose.createRemoteJWKSet>>();
function getJwks(supabaseUrl: string) {
  let set = jwksCache.get(supabaseUrl);
  if (!set) {
    set = jose.createRemoteJWKSet(new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`));
    jwksCache.set(supabaseUrl, set);
  }
  return set;
}

export async function verifySupabaseToken(env: Env, token: string): Promise<AuthUser> {
  const opts: jose.JWTVerifyOptions = {
    issuer: `${env.SUPABASE_URL}/auth/v1`,
    audience: "authenticated",   // Supabase access tokens always carry aud = "authenticated"
  };
  let payload: jose.JWTPayload;
  if (env.SUPABASE_JWT_SECRET && env.SUPABASE_JWT_SECRET.length > 0) {
    // HS256 legacy symmetric secret.
    payload = (await jose.jwtVerify(token, new TextEncoder().encode(env.SUPABASE_JWT_SECRET), opts)).payload;
  } else {
    // ES256 asymmetric via JWKS (recommended).
    payload = (await jose.jwtVerify(token, getJwks(env.SUPABASE_URL), opts)).payload;
  }
  if (!payload.sub) throw new Error("token missing sub claim");
  return {
    userId: payload.sub,
    email: typeof payload.email === "string" ? payload.email : undefined,
    isAnonymous: payload.is_anonymous === true,
  };
}
```

### 7. Deploy

```bash
# Preview locally (needs .dev.vars + a real Supabase project — supabase-js calls out over HTTPS).
npm run dev

# Push schema first, then the Worker.
npm run db:push
npm run deploy        # == wrangler deploy
```

For hands-off deploys, connect the GitHub repo in **Workers & Pages → Create → Connect to Git**; every push to the production branch redeploys automatically (the Workers analogue of App Runner auto-deploy).

## Integration Checklist

### 1. Tooling

```bash
npm install hono @supabase/supabase-js jose zod
npm install --save-dev wrangler @cloudflare/workers-types typescript
brew install supabase/tap/supabase
```

### 2. Supabase project (one-time)

```bash
supabase login
# Create the project in the correct region (IMMUTABLE) — dashboard or CLI.
supabase link --project-ref <project-ref>
```

- [ ] Project created in the **correct, immutable region**
- [ ] (Recommended) migrated to **ES256** signing keys; `SUPABASE_JWT_SECRET` left empty
- [ ] `supabase/config.toml` committed with auth toggles

### 3. Schema

- [ ] Migrations authored idempotently in `supabase/migrations/`
- [ ] `npm run db:push` applies cleanly to the linked project
- [ ] RLS enabled on every user-data table (see [infra-supabase-rls](recipe://infra-supabase-rls))

### 4. Secrets

- [ ] `.dev.vars` populated locally and confirmed in `.gitignore`
- [ ] `.dev.vars.example` committed with placeholders only
- [ ] All secrets set in Cloudflare as **Secret** type (`wrangler secret put` or dashboard)
- [ ] `grep -rn "sb_secret_\|service_role" .` returns nothing in tracked files

### 5. Deploy

- [ ] `npm run typecheck` passes
- [ ] `npm run deploy` succeeds; `/health` returns 200
- [ ] (Optional) GitHub connected for auto-deploy on push

## Common Customizations

### 1. Local Supabase for offline development

```bash
supabase start        # spins up Postgres + Auth + Storage in Docker locally
supabase db reset     # re-applies all migrations onto the local DB from scratch
supabase stop
```

Point `.dev.vars` at the local URL/keys that `supabase start` prints. Useful for iterating on migrations without touching the hosted project.

### 2. Staging + production projects

Create a second Supabase project (its own immutable region/ref) and a second Worker (or a Worker environment). Keep one set of migrations; `supabase link` to whichever project you are pushing to. Never share the `service_role` key across environments.

### 3. Scheduled cleanup with pg_cron

Anonymous users accumulate. Schedule a Postgres job to delete *empty, expired* anonymous users (verify no data first). Enable the extension first: Supabase Dashboard → Database → Extensions → **pg_cron** (otherwise `schema "cron" does not exist`):

```sql
select cron.schedule('purge-empty-anon', '0 3 * * *', $$
  delete from auth.users u
  where u.is_anonymous = true
    and u.created_at < now() - interval '30 days'
    and not exists (select 1 from items i where i.owner_id = u.id)
$$);
```

### 4. Rate limiting / WAF at the edge

Add **Rate Limiting Rules** / **WAF** in front of the Worker (dashboard → Security). This is the Cloudflare analogue of putting API Gateway in front of App Runner in [infra-cdk](recipe://infra-cdk).

## Known Pitfalls

### 1. Supabase project region is immutable

**Symptom**: latency is poor for your users, or a compliance requirement is unmet, and you cannot change it.

**Fix**: the region is chosen at project creation and **cannot be changed afterwards**. Pick it correctly on step one. Moving regions later means creating a new project and migrating data.

### 2. Missing `nodejs_compat` → supabase-js crashes on Workers

**Symptom**: runtime error about a missing Node built-in (e.g. `stream`, `crypto`) as soon as a route calls supabase-js.

**Fix**: set `"compatibility_flags": ["nodejs_compat"]` in `wrangler.jsonc`. supabase-js depends on Node polyfills that Workers only exposes behind this flag.

### 3. Using `process.env` instead of `c.env`

**Symptom**: `undefined` config at the edge; secrets never load.

**Fix**: Workers inject bindings into the Hono context. Read `c.env.SUPABASE_URL`, never `process.env`. Type them in `Env` (`src/types.ts`).

### 4. `service_role` key committed to git or shipped to the client

**Symptom**: full-database compromise — the key bypasses every RLS policy.

**Fix**: the key lives **only** in `.dev.vars` (gitignored) and Cloudflare Secret. It is never in `wrangler.jsonc`, never in a tracked file, never in the iOS app. `.dev.vars.example` carries placeholders only.

### 5. Secret set as a plaintext "build" var instead of a runtime Secret

**Symptom**: the secret is visible in the dashboard and/or logs; it does not reach `c.env` at runtime as expected.

**Fix**: use `wrangler secret put` or the dashboard's **Variables and Secrets → Secret** (encrypted, runtime) section. Do not paste secrets into `vars` in `wrangler.jsonc` (those are plaintext, build-time).

### 6. `service_role` used to reliably bypass RLS but requests still hit RLS

**Symptom**: a system operation (e.g. initializing a profile row) is unexpectedly blocked by RLS.

**Cause**: with the new `sb_secret_` key format, passing the key only as the createClient `apikey` arg does not always set the PostgREST role — requests fall back to an RLS-constrained role.

**Fix**: put the key explicitly in the `Authorization: Bearer` header (as `serviceClient` does above). PostgREST decides the role from `Authorization`, not `apikey`.

### 7. Migration applied by hand diverges from the file

**Symptom**: a fresh project (or teammate) can't reproduce the schema; something works only on your project.

**Fix**: every schema change is a file in `supabase/migrations/`, applied with `supabase db push`. Never make a change only in the dashboard SQL Editor without capturing it as a migration. Write files idempotently so re-apply is a no-op.

### 8. `npm install -g supabase` fails or misbehaves

**Symptom**: the global npm install of the Supabase CLI errors or is flagged unsupported.

**Fix**: install the CLI via Homebrew (`brew install supabase/tap/supabase`) or as a project devDependency. The npm global install path is not supported.

### Production Readiness Checklist

- [ ] Project in the correct **immutable** region, migrated to **ES256** signing keys
- [ ] RLS enabled and tested on every user-data table ([infra-supabase-rls](recipe://infra-supabase-rls))
- [ ] Private buckets + signed URLs for any user files ([infra-supabase-storage](recipe://infra-supabase-storage))
- [ ] All secrets are Cloudflare **Secret** type; nothing sensitive in git or `wrangler.jsonc`
- [ ] `enable_refresh_token_rotation = true` and an anonymous-sign-in rate limit set
- [ ] Edge Rate Limiting / WAF in front of the Worker
- [ ] `pg_cron` job purging empty, expired anonymous users
- [ ] Workers observability enabled; a staging project separate from production
