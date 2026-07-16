---
id: infra-supabase-rls
title: Supabase Row Level Security (RLS) Data Isolation
description: Production-ready Row Level Security patterns for a Supabase + Cloudflare Workers stack — the database-layer isolation primitive that makes cross-user data leaks impossible even when a route is buggy or someone talks to PostgREST directly. Covers the owner-isolation table skeleton (1:1 profile + one-to-many children), the five load-bearing RLS rules ((select auth.uid()) wrapping, TO authenticated, forward-set child subqueries, indexing policy columns, trusting only auth.uid()/app_metadata), the service_role (bypass RLS) vs user-JWT (RLS enforced) client split, server-side owner_id injection, public read-only tables whose writes funnel through service_role, and a two-token cross-access isolation test that must return 403/empty.
tier: free
tags: [Supabase, RLS, Row Level Security, Postgres, auth.uid, service_role, PostgREST, data isolation, IDOR, multi-tenant, migrations, security, Cloudflare Workers, Hono]
---

## What This Solves

Filtering per-user data with an application-layer `WHERE owner_id = ...` clause is one bug away from a full horizontal-privilege-escalation leak. Forget the clause in one route, mistype a join, expose one `service_role`-backed endpoint without a manual filter — and every user can read every other user's rows. Worse, on a Supabase stack the client can talk to PostgREST directly (the REST endpoint is public), so "I only ever call my own backend" is not a security boundary at all.

Row Level Security (RLS) moves isolation **into the database**. Every row carries an owner; every policy is a predicate the database evaluates on every read and write. Get it right once and:

- **Leaks become impossible by construction** — even a buggy route, or a client hitting PostgREST directly with a valid but low-privilege JWT, cannot see or touch another user's rows. The database itself refuses them.
- **Routes stay clean** — with the user-JWT client you never hand-write `WHERE owner_id`. You `select("*")` and RLS returns only the caller's rows.
- **Anonymous users are first-class** — a Supabase anonymous sign-in issues a *real* signed JWT (`role: authenticated`, `is_anonymous: true`), so anonymous users hit the same `TO authenticated` policies and safely read/write **their own** data (see [auth-supabase-anonymous](recipe://auth-supabase-anonymous)).
- **Defense in depth** — RLS is the last and hardest line behind JWT verification and server-side `owner_id` injection; each layer independently prevents an IDOR.

This is the security core of the [infra-supabase](recipe://infra-supabase) stack. Where [infra-cdk](recipe://infra-cdk) isolates data with application-layer `WHERE` clauses over Aurora (the app is the only trusted boundary), Supabase pushes the boundary down to Postgres — read the two side by side. This recipe assumes you already have the Workers + Supabase scaffolding from [infra-supabase](recipe://infra-supabase) and the `serviceClient` / `userClient` factories from [auth-supabase-anonymous](recipe://auth-supabase-anonymous); it focuses only on the RLS layer.

## Architecture

RLS is enforced at the database, keyed off the caller's *verified* JWT. The Worker chooses which client to use, and that choice decides whether RLS applies:

```
                 Authorization: Bearer <user JWT>
iOS ──REST──▶ Worker (jose verifies sig + iss + aud) ──┐
                                                       │
        ┌──────────────────────────────────────────────┴─────────────────────────┐
        │                                                                          │
        ▼  userClient(anon key + user JWT)                    serviceClient(service_role) ▼
   PostgREST runs as role=authenticated, sub=<uid>       PostgREST runs as role=service_role
        │                                                                          │
        ▼                                                                          ▼
 ┌───────────────────────────────────────────┐                   ┌──────────────────────────┐
 │ Postgres — RLS ENFORCED, evaluated per row  │                   │ RLS BYPASSED               │
 │   using ( (select auth.uid()) = owner_id )  │                   │ system operations ONLY:    │
 │   with check ( (select auth.uid()) = owner_id )                 │ anon sign-in, profile init,│
 │ → caller sees / writes ONLY its own rows    │                   │ public-table upsert, cleanup│
 └───────────────────────────────────────────┘                   └──────────────────────────┘
```

**Defense in depth — three independent guards, any one of which stops an IDOR:**

| Layer | Guard | What it stops |
|-------|-------|--------------|
| 1. Middleware | `jose` verifies the JWT signature + issuer + `audience: "authenticated"` | Forged / tampered tokens (a hand-crafted `{"sub":"<victim>"}`) |
| 2. Route | `owner_id` is **injected from `authUser.userId`**, never read from the request body | A client claiming to own another user's data |
| 3. Database (RLS) | `using` / `with check` on `(select auth.uid())` | Everything that slips past layers 1–2 — a buggy route, a forgotten filter, or a client hitting PostgREST directly |

> **The point of layer 3**: layers 1–2 live in code you can get wrong. RLS lives in the database and is evaluated unconditionally. It is the reason a single missed `WHERE` clause is a no-op instead of a breach.

**Client roles (the split that decides whether RLS applies):**

| Client | Credential | RLS | Use for |
|--------|-----------|-----|---------|
| `userClient` | anon key + the request's **user JWT** | **ENFORCED** (role `authenticated`) | ALL per-user data reads/writes — never hand-write `WHERE owner_id` |
| `serviceClient` | **`service_role`** key in the `Authorization` header | **BYPASSED** | System ops only: anonymous sign-in, profile-row init, public-table upsert, cleanup |
| `anonClient` | anon key only, no user token | ENFORCED (role `anon`) | Token-less GoTrue ops (e.g. refresh); can read `TO anon` public tables |

## Dependencies

This recipe is pure Postgres (RLS in SQL migrations) plus the two Supabase clients — no new packages beyond the [infra-supabase](recipe://infra-supabase) baseline.

```json
{
  "dependencies": {
    "@supabase/supabase-js": "^2.45.0"
  },
  "devDependencies": {
    "supabase": "^1.200.0"
  }
}
```

Install with:

```bash
# supabase-js provides userClient (RLS-enforcing) and serviceClient (RLS-bypassing).
npm install @supabase/supabase-js
# The Supabase CLI applies the RLS migrations. Install via Homebrew (npm -g is unsupported).
brew install supabase/tap/supabase
```

Add the migration script to your `package.json`:

```json
{
  "scripts": {
    "db:push": "supabase db push"
  }
}
```

> RLS policies are DDL — they must be applied through `supabase db push` (or the SQL Editor), **not** via the PostgREST `service_role` client. See [infra-supabase](recipe://infra-supabase) for the full migration workflow.

## Implementation

### Project Structure

```
your-server/
├── src/
│   ├── lib/
│   │   └── supabase.ts          # serviceClient (bypass RLS) / userClient (RLS enforced)
│   ├── middleware/
│   │   └── auth.ts              # verifies the JWT before any claim is trusted
│   └── routes/
│       └── items.ts             # business route — uses userClient, injects owner_id
└── supabase/
    └── migrations/
        ├── 0001_init.sql        # tables + RLS (owner isolation)
        └── 0004_public.sql      # public read-only table (writes funnel through service_role)
```

### 1. Owner-isolation table skeleton (the minimal shape)

Three tables cover almost every app: a `profiles` row 1:1 with the auth user, a one-to-many child (`items`), and a grandchild (`item_events`) that has **no `owner_id` of its own** and derives ownership through its parent.

```sql
-- supabase/migrations/0001_init.sql

-- profiles — 1:1 with auth.users; id REUSES the auth user id (not a separate PK).
-- This is what makes (select auth.uid()) = id work directly.
create table if not exists profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  email        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- items — one-to-many under a profile. Key business tables by owner_id (a stable UUID
-- that equals auth.uid()), NEVER by anything the client supplies.
create table if not exists items (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references profiles(id) on delete cascade,
  title      text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_items_owner_id on items (owner_id);   -- rule #4: index policy columns

-- item_events — grandchild (one-to-many under items). Deliberately NO owner_id column:
-- ownership is derived through the parent item via a forward-set subquery (rule #3).
create table if not exists item_events (
  id         uuid primary key default gen_random_uuid(),
  item_id    uuid not null references items(id) on delete cascade,
  kind       text not null,
  note       text,
  created_at timestamptz not null default now()
);
create index if not exists idx_item_events_item_id on item_events (item_id);
```

> **`on delete cascade` chains deletes**: deleting the `auth.users` row (account deletion) cascades `profiles → items → item_events`, so `admin.deleteUser(userId)` cleans the whole tree in one call. See the delete flow in [auth-supabase-anonymous](recipe://auth-supabase-anonymous).

### 2. The five RLS rules (write these wrong = leak or slow query)

Every policy in this recipe obeys these five rules. They are not stylistic — each prevents a specific, real failure.

```sql
-- ── profiles: user can read / update ONLY its own row ──
-- The profile row is INSERTed by the backend via service_role (which bypasses RLS), so there
-- is deliberately NO insert/delete policy for authenticated users.
alter table profiles enable row level security;

drop policy if exists "profiles_select_own" on profiles;
create policy "profiles_select_own" on profiles
  for select
  to authenticated                          -- rule #2
  using ( (select auth.uid()) = id );        -- rule #1

drop policy if exists "profiles_update_own" on profiles;
create policy "profiles_update_own" on profiles
  for update
  to authenticated
  using ( (select auth.uid()) = id )
  with check ( (select auth.uid()) = id );   -- rule (with check): also gate the NEW row

-- ── items: user reads / writes ONLY rows where owner_id = itself ──
alter table items enable row level security;

drop policy if exists "items_all_own" on items;
create policy "items_all_own" on items
  for all                                    -- select + insert + update + delete
  to authenticated
  using ( (select auth.uid()) = owner_id )
  with check ( (select auth.uid()) = owner_id );
```

**Rule 1 — wrap `auth.uid()` in `(select auth.uid())`.** Postgres treats a bare `auth.uid()` as a per-row volatile call and re-evaluates it for every row scanned; wrapping it in a scalar subquery lets the planner cache it as an *init-plan* (computed once per query). On a large table the bare form turns a policy into a per-row function call. Always `(select auth.uid())`.

**Rule 2 — every policy carries `TO authenticated`.** Without a role, a policy applies to *all* roles including the unauthenticated `anon` role. `TO authenticated` stops the anon role at step one. (A Supabase **anonymous sign-in** issues a real JWT with `role: authenticated`, so anonymous users still match these policies and read/write their own data — that is intentional; see [auth-supabase-anonymous](recipe://auth-supabase-anonymous).)

**Rule 3 — child tables use a forward-set subquery, not a join.**

```sql
-- item_events has no owner_id; ownership flows through the parent item.
alter table item_events enable row level security;

drop policy if exists "item_events_all_own" on item_events;
create policy "item_events_all_own" on item_events
  for all
  to authenticated
  using     ( item_id in (select id from items where owner_id = (select auth.uid())) )
  with check ( item_id in (select id from items where owner_id = (select auth.uid())) );
```

The `id in (select ...)` **forward set** (build the set of the user's item ids, then test membership) plans far better than a correlated `exists (... where items.id = item_events.item_id ...)` join inside a policy. For great-grandchildren, nest the same pattern one level deeper.

**Rule 4 — index every column a policy touches.** RLS predicates run on every access, so `owner_id` (on `items`) and `item_id` (on `item_events`) each need an index (both created above). Unindexed policy columns turn every RLS check into a sequential scan.

**Rule 5 — authorize only on `auth.uid()` and `app_metadata`, never `user_metadata`.** `auth.uid()` comes from the signed JWT's `sub`. `app_metadata` is server-controlled (written via the admin API / `service_role`) and the user cannot change it. `user_metadata` is **client-writable** — using it in a policy lets a user grant themselves access. To gate on a server-set flag:

```sql
-- app_metadata is safe (server-set); user_metadata is NOT (client-writable) → never use it in authz.
create policy "items_staff_read_all" on items
  for select
  to authenticated
  using ( (auth.jwt() -> 'app_metadata' ->> 'role') = 'staff' );
```

> **`with check` vs `using`**: `using` filters which existing rows a statement can *see/target* (SELECT/UPDATE/DELETE); `with check` validates the *new* row values (INSERT/UPDATE). An UPDATE policy needs **both** — `using` so a user can only target their own rows, `with check` so they cannot rewrite `owner_id` to someone else's on the way out. Omitting `with check` on a writable policy is a silent hole.

### 3. Public read-only tables (writes funnel through `service_role`)

Some data is global and public (a directory, a catalog), not user-private. The isolation model is different: **public read + no user-facing write policy at all.** Every write goes through a backend `service_role` endpoint that validates field-by-field.

```sql
-- supabase/migrations/0004_public.sql
create table if not exists listings (
  id          text primary key,                 -- stable external id, not a per-user uuid
  name        text not null,
  address     text not null default '',
  phone       text,                              -- the ONE crowd-writable field (via a service_role endpoint)
  active      boolean not null default true,     -- soft delete
  updated_at  timestamptz not null default now()
);
create index if not exists idx_listings_active on listings (active);

alter table listings enable row level security;

-- ① Public read: anon + authenticated may SELECT (a logged-out user can still browse).
drop policy if exists "listings_public_read" on listings;
create policy "listings_public_read" on listings
  for select
  to anon, authenticated
  using ( true );

-- ② NO user-facing write policy. Clean up any legacy one so re-apply is idempotent.
--    ALL writes funnel through the backend service_role.
drop policy if exists "listings_user_update" on listings;
```

> **Why deliberately no `authenticated` UPDATE policy** — the load-bearing safety decision: RLS is **row-level**, it cannot restrict *which columns* an UPDATE touches. If you opened an `authenticated` UPDATE policy so users could crowd-fill `phone`, a user could take their (freely obtainable) anonymous JWT, skip your backend, `PATCH` PostgREST directly, and overwrite the authoritative `name` / `address` fields too. The only safe design for a partially-writable public table is: **no user UPDATE policy at all**, and route the one writable field through a `service_role` endpoint that writes exactly that one column (e.g. only when `phone IS NULL`). Authoritative fields are upserted by a pipeline (also `service_role`), and removals are soft (`active = false`).

### 4. The client split (`src/lib/supabase.ts`)

This factory is the hinge of the whole model: `serviceClient` bypasses RLS, `userClient` enforces it. Using the wrong one is how leaks happen. (Full factory including `anonClient` in [infra-supabase](recipe://infra-supabase) / [auth-supabase-anonymous](recipe://auth-supabase-anonymous).)

```typescript
// src/lib/supabase.ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../types";

const STATELESS_AUTH = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
} as const;

/**
 * service_role client — bypasses ALL RLS. System operations ONLY (anon sign-in, profile-row
 * init, public-table upsert, cleanup). NEVER for per-user reads/writes.
 * The key MUST go in the Authorization header: PostgREST decides the role from Authorization
 * (not apikey), so passing the sb_secret_ key only as the createClient 2nd arg can leave the
 * request bound to an RLS-constrained role, and your system op gets blocked by RLS.
 */
export function serviceClient(env: Env): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    ...STATELESS_AUTH,
    global: { headers: { Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` } },
  });
}

/**
 * User-JWT client — runs as the request's user, so RLS is enforced automatically.
 * Use for ALL per-user data. You never hand-write `WHERE owner_id`; RLS does it.
 * @param accessToken a Supabase access token already verified by the auth middleware.
 */
export function userClient(env: Env, accessToken: string): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    ...STATELESS_AUTH,
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}
```

### 5. Business route (`src/routes/items.ts`) — RLS + server-side `owner_id` injection

With `userClient`, the route is trivial and safe: no filter on read, and on write the `owner_id` comes from the **verified token**, never the request body.

```typescript
// src/routes/items.ts
import { Hono } from "hono";
import { z } from "zod";
import { userClient } from "../lib/supabase";
import { identityMiddleware } from "../middleware/auth";
import type { AppEnv } from "../types";

export const itemsRoute = new Hono<AppEnv>();
itemsRoute.use("*", identityMiddleware);   // any valid Supabase JWT, anonymous included

// LIST — RLS returns ONLY this user's rows. Note: no `.eq("owner_id", ...)`.
itemsRoute.get("/", async (c) => {
  const supabase = userClient(c.env, c.get("accessToken"));
  const { data, error } = await supabase
    .from("items")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ items: data });
});

const createSchema = z.object({ title: z.string().min(1).max(200) });

// CREATE — owner_id is INJECTED from the verified token, NEVER read from the client body.
// (If a client did send owner_id, the WITH CHECK policy would reject a foreign one anyway —
// but injecting server-side means the client cannot even express another owner.)
itemsRoute.post("/", async (c) => {
  const parsed = createSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Invalid body", issues: parsed.error.issues }, 400);
  const { userId } = c.get("authUser");
  const supabase = userClient(c.env, c.get("accessToken"));
  const { data, error } = await supabase
    .from("items")
    .insert({ owner_id: userId, title: parsed.data.title })   // owner_id from authUser, not the body
    .select()
    .single();
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ item: data }, 201);
});
```

## Testing RLS Isolation

The one test that proves RLS works: two different users, each with their own token, must **not** be able to read or write each other's rows. Do it against PostgREST directly (that is the real threat model — a client bypassing your backend). RLS behaves differently per verb, and knowing the difference is the test:

- **SELECT** of someone else's rows → **filtered out** (empty result, *not* a 403). Reads are silently narrowed.
- **INSERT/UPDATE** that violates `with check` → **403** (`new row violates row-level security policy`).
- **UPDATE/DELETE** targeting rows you cannot see (`using` fails) → **0 rows affected**.

```bash
# Get two independent user tokens (each from an anonymous sign-in / your /v1/auth/anon).
ANON_KEY=sb_publishable_...
TOKEN_A=...   # user A's access token,  A_UID  = A's auth.uid()
TOKEN_B=...   # user B's access token

# 1) User A creates a row.
A_ITEM=$(curl -s -X POST "$SUPABASE_URL/rest/v1/items" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" \
  -d "{\"owner_id\":\"$A_UID\",\"title\":\"A's secret\"}" | python3 -c 'import sys,json;print(json.load(sys.stdin)[0]["id"])')

# 2) User B lists items → MUST NOT contain A's row (RLS filters SELECT to B's own rows).
curl -s "$SUPABASE_URL/rest/v1/items?select=*" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN_B"
# Expected: [] (or only B's own rows) — A's row is invisible.

# 3) User B tries to fetch A's row by id → empty, NOT the row.
curl -s "$SUPABASE_URL/rest/v1/items?id=eq.$A_ITEM&select=*" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN_B"
# Expected: []

# 4) User B tries to hijack A's row → 0 rows changed (using() hides it from the UPDATE).
curl -s -X PATCH "$SUPABASE_URL/rest/v1/items?id=eq.$A_ITEM" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN_B" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" \
  -d '{"title":"hijacked"}'
# Expected: [] — A's data is untouched.

# 5) User B tries to INSERT a row owned by A → 403 (violates WITH CHECK).
curl -s -o /dev/null -w "%{http_code}\n" -X POST "$SUPABASE_URL/rest/v1/items" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN_B" \
  -H "Content-Type: application/json" \
  -d "{\"owner_id\":\"$A_UID\",\"title\":\"forged\"}"
# Expected: 403
```

You can also reproduce this deterministically in the SQL Editor / a local `supabase start` by impersonating a user without a real token:

```sql
-- Simulate "user B reads items": set role + JWT claims, then query.
set local role authenticated;
set local request.jwt.claims = '{"sub":"<B_UID>","role":"authenticated"}';
select * from items;                 -- returns ONLY B's rows
reset role;
```

## Integration Checklist

### 1. Schema + policies

- [ ] `profiles.id` is `uuid primary key references auth.users(id) on delete cascade` (reuses the auth id)
- [ ] Business tables carry `owner_id uuid not null references profiles(id) on delete cascade`
- [ ] Child tables derive ownership through the parent (no redundant `owner_id`)
- [ ] `alter table ... enable row level security;` on **every** user-data table
- [ ] Every policy: `(select auth.uid())` wrapped · `TO authenticated` · child tables use `id in (select ...)`
- [ ] Every writable policy has **both** `using` and `with check`
- [ ] Every column a policy touches (`owner_id`, parent `id`) is indexed
- [ ] No policy references `user_metadata` (client-writable); authz uses only `auth.uid()` / `app_metadata`
- [ ] Policies written idempotently (`drop policy if exists` then `create`); `npm run db:push` applies cleanly

### 2. Clients + routes

- [ ] Per-user reads/writes use `userClient(env, accessToken)` — never `serviceClient`
- [ ] `serviceClient` used ONLY for system ops (anon sign-in, profile init, public-table upsert, cleanup)
- [ ] `owner_id` is injected from `authUser.userId`, never read from the request body
- [ ] `service_role`-backed endpoints that return lists **manually strip** other users' identifying fields (RLS does not apply under `service_role`)

### 3. Public read-only tables

- [ ] Public table has a `for select to anon, authenticated using (true)` policy
- [ ] **No** `insert/update/delete` policy for `anon` / `authenticated`
- [ ] All writes go through a `service_role` endpoint that validates field-by-field
- [ ] Removals are soft (`active = false`), not hard deletes

### 4. Isolation test (must pass before shipping)

- [ ] Two different users' tokens cannot SELECT each other's rows (empty, not the data)
- [ ] A cross-owner UPDATE/DELETE affects 0 rows
- [ ] A cross-owner INSERT (forged `owner_id`) returns 403
- [ ] Test is run against **PostgREST directly**, not only through your backend

## Common Customizations

### 1. Let the database fill `owner_id` automatically

Set a column default so you don't even inject `owner_id` in the route (and the `with check` still guards it):

```sql
alter table items alter column owner_id set default auth.uid();
```

Now `insert({ title })` is enough — Postgres fills `owner_id` with the caller's id. Keep the `with check` policy; the default is a convenience, not the guard.

### 2. Read-only shared data within a group / household

Add a membership table and reference it in the `using` clause with the same forward-set pattern:

```sql
using ( owner_id in (select member_id from group_members
                     where group_id in (select group_id from group_members
                                        where member_id = (select auth.uid()))) )
```

Index `group_members(member_id)` and `group_members(group_id)`.

### 3. Soft delete with RLS

Add `deleted_at timestamptz` and fold it into the read policy so soft-deleted rows disappear from reads but remain for recovery:

```sql
using ( (select auth.uid()) = owner_id and deleted_at is null )
```

### 4. Storage objects scoped by user id

RLS also governs `storage.objects`. Store per-user files under a `{userId}/...` path and enforce it with a policy, uploading through a `service_role` endpoint that derives the path server-side (never trust a client path → prevents IDOR). Full pattern: [infra-supabase-storage](recipe://infra-supabase-storage).

## Known Pitfalls

### 1. RLS enabled but no policy → everything is denied (or the reverse: a policy but RLS off)

**Symptom**: after `enable row level security`, every query returns empty even for the owner. Or: policies exist but data still leaks.

**Cause**: `enable row level security` with **no** policy denies all access to non-owning roles (default-deny). Conversely, writing policies but **forgetting** `enable row level security` means the policies are dormant and the table is wide open.

**Fix**: always pair them — `enable row level security` **and** at least one policy per verb you allow. Verify with `select relrowsecurity from pg_class where relname = 'items';` (must be `t`).

### 2. `using (true)` on a user-data table → full leak

**Symptom**: every user sees every row.

**Cause**: a permissive `using ( true )` (often copied from a public-table policy, or left in as a "temporary" open policy) applied to a user-owned table.

**Fix**: `using ( true )` belongs **only** on genuinely public read-only tables. User-data policies must always predicate on `(select auth.uid())`. Grep your migrations for `using ( true )` / `using (true)` and confirm each is on a public table.

### 3. Policy with no `TO` role → applies to `anon` too

**Symptom**: a logged-out client (anon key only) can read rows it should not.

**Cause**: omitting `TO authenticated`, so the policy applies to all roles including `anon`.

**Fix**: add `TO authenticated` to every user-data policy. Only public read-only tables should list `TO anon` (and then `for select` only).

### 4. `with check` omitted on a writable policy → owner reassignment

**Symptom**: a user can UPDATE their own row and change its `owner_id` to another user's, "giving away" or planting a row.

**Cause**: an UPDATE (or `for all`) policy with only `using` and no `with check`. `using` gates which rows are targeted; only `with check` validates the new values.

**Fix**: every writable policy needs `with check ( (select auth.uid()) = owner_id )` in addition to `using`.

### 5. `service_role` used for per-user reads → RLS silently bypassed

**Symptom**: a list endpoint returns *everyone's* rows; no error, no leak warning.

**Cause**: the route used `serviceClient` (which bypasses RLS) for a per-user query, so the isolation you thought RLS gave you never ran.

**Fix**: per-user data always goes through `userClient`. Reserve `serviceClient` for system ops. Any endpoint that legitimately uses `serviceClient` and returns data to clients (feeds built server-side) must **manually filter/strip** other users' fields — RLS will not save you there.

### 6. Bare `auth.uid()` (not wrapped) → per-row re-evaluation

**Symptom**: queries on a large table are slow; `EXPLAIN` shows the auth function called per row.

**Cause**: `using ( auth.uid() = owner_id )` re-evaluates `auth.uid()` for every scanned row.

**Fix**: wrap it — `using ( (select auth.uid()) = owner_id )` — so the planner caches it as an init-plan (computed once).

### 7. Authorizing on `user_metadata` → self-granted privileges

**Symptom**: a user elevates their own access (e.g. flips themselves to "premium" or "staff").

**Cause**: a policy reads `auth.jwt() -> 'user_metadata'`, which the user can write via the client SDK.

**Fix**: authorize only on `auth.uid()` and `app_metadata` (server-set, admin-only). Treat `user_metadata` as untrusted, client-supplied data.

### 8. Opening an `authenticated` UPDATE on a partially-writable public table → authoritative fields tampered

**Symptom**: a public directory's authoritative fields (name/address) get overwritten by clients.

**Cause**: to let users crowd-fill one field, an `authenticated` UPDATE policy was added — but RLS is row-level and cannot restrict *which columns* an UPDATE touches, so a client `PATCH`ing PostgREST directly can rewrite any column.

**Fix**: give public tables **no** user-facing write policy. Route the one writable field through a `service_role` backend endpoint that writes exactly that column (and only under the right precondition). See implementation §3.

### 9. Child-table policy uses a correlated join instead of a forward set

**Symptom**: queries on grandchild tables are slow under load.

**Cause**: a policy written as `exists (select 1 from items where items.id = item_events.item_id and ...)` forces a correlated subquery per row.

**Fix**: use the forward-set membership test `item_id in (select id from items where owner_id = (select auth.uid()))` and index the join columns.

## Production Readiness Checklist

- [ ] RLS enabled on **every** user-data table, verified via `pg_class.relrowsecurity`
- [ ] All five rules hold on every policy (wrap · `TO` role · forward-set children · indexed columns · no `user_metadata`)
- [ ] Every writable policy has both `using` and `with check`
- [ ] No stray `using ( true )` outside genuinely public tables
- [ ] Per-user data flows exclusively through `userClient`; `service_role` limited to system ops
- [ ] `service_role`-backed list endpoints strip other users' identifying fields
- [ ] Public read-only tables: `select` for `anon`/`authenticated`, no user write policy, writes via `service_role`
- [ ] Two-token cross-access isolation test passes against PostgREST directly (SELECT empty · UPDATE/DELETE 0 rows · forged INSERT 403)
- [ ] Storage objects (if any) isolated by user-id path with RLS on `storage.objects` ([infra-supabase-storage](recipe://infra-supabase-storage))
