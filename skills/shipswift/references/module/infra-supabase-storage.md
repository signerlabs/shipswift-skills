---
id: infra-supabase-storage
title: Supabase Storage Private Buckets + Signed URLs
description: Production-ready private file storage for a Supabase + Cloudflare Workers stack — a private bucket created as an idempotent SQL migration, server-side service_role uploads (the client never talks to Storage and never holds the service key), and on-demand signed URLs with short TTLs. IDOR-proof by construction — the object path is derived from the verified JWT ({userId}/{itemId}.jpg, never client-supplied) and ownership is checked through RLS before any URL is signed — with defense-in-depth RLS policies on storage.objects, orphan-object cleanup (Postgres ON DELETE CASCADE never touches Storage), and the pitfalls of public buckets and leaked signed URLs.
tier: free
tags: [Supabase, Storage, signed URL, private bucket, service_role, RLS, IDOR, storage.objects, file upload, Cloudflare Workers, Hono, migrations, orphan cleanup, image upload]
---

## What This Solves

User files — avatars, photos, attachments — are the easiest place to leak private data. A **public** Supabase bucket makes every object readable by anyone who has (or guesses) its URL, with no token required. Letting the client upload **directly** to Storage with the anon key pushes all validation onto Storage RLS alone, exposes your bucket layout to the client, and breaks the zero-dependency iOS guarantee of this stack. And even with a private bucket, a backend that signs URLs for whatever id the client sends is one missing ownership check away from serving one user's private photos to another (a classic IDOR).

This recipe closes all three holes with one consistent model:

- **Private bucket, as code** — the bucket (size limit, MIME allowlist, `public = false`) is an idempotent SQL migration in `supabase/migrations/`, reproducible on any project via `supabase db push`
- **Server-side uploads only** — the client POSTs bytes to your Worker; the Worker uploads with the `service_role` client. The client never talks to Storage and never holds any Supabase key
- **Signed URLs, on demand** — reads go through short-TTL signed URLs generated per request. The database stores the object **path**; URLs are minted fresh each time
- **IDOR-proof paths** — every object lives under `{userId}/...` where `userId` comes from the **verified JWT**, never from the request. Ownership is checked through RLS **before** any `service_role` Storage operation runs
- **Defense in depth** — RLS policies on `storage.objects` isolate owner folders even if some future code path talks to Storage with a user JWT

This recipe assumes the Workers + Supabase scaffolding from [infra-supabase](recipe://infra-supabase), the `serviceClient` / `userClient` factories and auth middleware from [auth-supabase-anonymous](recipe://auth-supabase-anonymous), and the RLS-isolated `profiles` + `items` schema from [infra-supabase-rls](recipe://infra-supabase-rls) — it adds the file-storage layer on top. (On the AWS stack, the counterpart is S3 + per-identity IAM paths in [infra-cdk](recipe://infra-cdk); read them side by side.)

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                          iOS Client                                │
│   (URLSession only — never talks to Storage, never holds a key)    │
└──────────────────────────────┬─────────────────────────────────────┘
               │ POST /v1/items/:id/photo      (raw bytes + Bearer JWT)
               │ GET  /v1/items/:id/photo-url  (Bearer JWT)
               ▼
┌──────────────────────────────────────────────────────────────────┐
│                 Cloudflare Workers  (Hono backend)                 │
│  1. verify JWT (identityMiddleware)                                │
│  2. ownership gate: userClient SELECT (RLS) → 404 if not owner     │
│  3. derive path from the token: {userId}/{itemId}.jpg              │
│  4. serviceClient → upload / createSignedUrl                       │
└──────────────────────────────┬─────────────────────────────────────┘
                               │ service_role (Storage API over HTTPS)
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│        Supabase Storage — PRIVATE bucket "item-photos"             │
│   public = false · file_size_limit 5MB · MIME allowlist            │
│   storage.objects RLS: owner-folder isolation (defense in depth)   │
└──────────────────────────────────────────────────────────────────┘
                               ▲
                               │ short-TTL signed URL — the ONLY way
                               │ the client ever reads an object
```

**Defense in depth — three independent guards, any one of which stops an IDOR:**

| Layer | Guard | What it stops |
|-------|-------|--------------|
| 1. Path derivation | object path is built from `authUser.userId` (verified JWT), never read from the request | a client naming another user's folder in an upload |
| 2. Ownership gate | `userClient` SELECT under RLS **before** any `service_role` Storage op — "not found" == "not yours" → 404 | signing/reading/writing objects for rows the caller does not own |
| 3. `storage.objects` RLS | owner-folder policies (`(storage.foldername(name))[1] = auth.uid()`) | any future code path that talks to Storage with a user JWT instead of going through the Worker |

> **Why the ownership gate matters**: the `service_role` client bypasses **all** RLS, on
> `storage.objects` included. Once you call `serviceClient`, nothing downstream protects you —
> so the RLS-enforced lookup (layer 2) must run **first**, while you are still acting as the
> user. This is the same "service_role is for system ops only, after the app has decided the
> caller is allowed" discipline as [infra-supabase-rls](recipe://infra-supabase-rls).

**Key decisions:**

| Decision | Choice | Why |
|----------|--------|-----|
| Bucket visibility | **Private** | public buckets serve every object to anyone with the URL — no token, no expiry |
| Upload path | **Server-side, service_role** | client stays dependency-free; server validates size/type; no Supabase key ever ships in the app |
| Read path | **Signed URL, minted on demand** | time-limited bearer link; DB stores only the object path |
| Path convention | **`{userId}/{itemId}.jpg`** | owner is the first folder segment → trivially checkable by both the Worker and `storage.objects` RLS |
| Signed URL TTL | **3600 s** | long enough for a session's image loads, short enough that a leaked URL dies quickly |

## Dependencies

This recipe is one SQL migration plus the two Supabase clients — no new packages beyond the [infra-supabase](recipe://infra-supabase) baseline.

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
# supabase-js provides the Storage API (upload / createSignedUrl / remove / list).
npm install @supabase/supabase-js
# The Supabase CLI applies the bucket migration. Install via Homebrew (npm -g is unsupported).
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

## Implementation

### Project Structure

```
your-server/
├── src/
│   ├── lib/
│   │   └── supabase.ts          # serviceClient (Storage ops) / userClient (RLS ownership gate)
│   ├── middleware/
│   │   └── auth.ts              # verifies the JWT before any path is derived from it
│   └── routes/
│       └── items.ts             # photo upload + signed-URL endpoints (this recipe)
└── supabase/
    └── migrations/
        └── 0002_storage.sql     # bucket + storage.objects RLS (this recipe)
```

### 1. Migration: create the private bucket (idempotent SQL)

The bucket is version-controlled like any other schema object. Inserting into `storage.buckets` with `on conflict do nothing` makes the migration replayable on a fresh project **and** safe to re-run against a project where the bucket was first created in the dashboard — it records the bucket's existence without clobbering console-set properties.

```sql
-- supabase/migrations/0002_storage.sql

-- ── 1) Private bucket for user photos — idempotent (skip if it already exists) ──
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'item-photos',
  'item-photos',
  false,                                -- PRIVATE — reads only via signed URLs
  5242880,                              -- 5 MB hard cap, enforced by Storage on every upload
  '{image/jpeg,image/png,image/heic}'   -- MIME allowlist, enforced by Storage on every upload
)
on conflict (id) do nothing;

-- ── 2) Column on the owning table: store the object PATH (never a signed URL) ──
alter table items add column if not exists photo_path text;
```

> `file_size_limit` and `allowed_mime_types` are enforced by the Storage API for **every**
> upload — `service_role` included — so they are a real backstop behind your Worker-level
> validation, not just documentation.

### 2. Storage RLS on `storage.objects` (defense in depth)

The primary data path (Worker → `service_role`) **bypasses** these policies, so they do not affect it. Their value is insurance: if any future code path ever talks to Storage with an anon or user JWT, it can still only touch objects under its own `{userId}/...` folder — cross-user reads and writes stay impossible.

The check: object names look like `{userId}/{itemId}.jpg`, and `(storage.foldername(name))[1]` extracts the first folder segment for comparison against `auth.uid()`. Same five RLS rules as [infra-supabase-rls](recipe://infra-supabase-rls): `(select auth.uid())` wrapping, `TO authenticated`, idempotent `drop policy if exists` + `create`.

```sql
-- Still in supabase/migrations/0002_storage.sql

drop policy if exists "item_photos_select_own" on storage.objects;
create policy "item_photos_select_own" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'item-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "item_photos_insert_own" on storage.objects;
create policy "item_photos_insert_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'item-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "item_photos_update_own" on storage.objects;
create policy "item_photos_update_own" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'item-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'item-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "item_photos_delete_own" on storage.objects;
create policy "item_photos_delete_own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'item-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
```

Apply with:

```bash
npm run db:push        # == supabase db push
```

### 3. Upload endpoint — `service_role` upload behind an RLS ownership gate

The client POSTs raw bytes (`Content-Type: image/jpeg`) to the Worker. The Worker verifies the JWT, proves ownership **through RLS**, derives the path from the token, and only then touches Storage as `service_role`.

```typescript
// src/routes/items.ts (photo endpoints — the CRUD part of this route lives in infra-supabase-rls)
import { Hono } from "hono";
import { serviceClient, userClient } from "../lib/supabase";
import { identityMiddleware } from "../middleware/auth";
import type { AppEnv } from "../types";

export const itemsRoute = new Hono<AppEnv>();
itemsRoute.use("*", identityMiddleware);   // any valid Supabase JWT, anonymous included

const PHOTO_BUCKET = "item-photos";
const SIGNED_URL_TTL = 3600;                  // seconds — signed URLs are bearer credentials, keep it short
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;     // Worker-level guard; the bucket limit is the backstop

// ── POST /v1/items/:id/photo — upload / replace the item's photo ──
// Request: Content-Type: image/jpeg, body = raw JPEG bytes.
itemsRoute.post("/:id/photo", async (c) => {
  const itemId = c.req.param("id");
  const { userId } = c.get("authUser");   // the path owner comes from the VERIFIED token only

  // 1) Ownership gate through RLS: userClient sees only the caller's rows, so
  //    "not found" == "not yours" → 404. This MUST run before any service_role
  //    Storage operation (service_role bypasses RLS — nothing downstream protects you).
  const user = userClient(c.env, c.get("accessToken"));
  const { data: item, error: itemErr } = await user
    .from("items")
    .select("id")
    .eq("id", itemId)
    .maybeSingle();
  if (itemErr) return c.json({ error: "Item lookup failed", detail: itemErr.message }, 500);
  if (!item) return c.json({ error: "Item not found or access denied" }, 404);

  // 2) Validate + read the binary body (Workers: arrayBuffer; upload() accepts ArrayBuffer).
  if (c.req.header("content-type") !== "image/jpeg") {
    return c.json({ error: "Content-Type must be image/jpeg" }, 415);
  }
  const bytes = await c.req.arrayBuffer();
  if (bytes.byteLength === 0) return c.json({ error: "Empty body — no image received" }, 400);
  if (bytes.byteLength > MAX_UPLOAD_BYTES) return c.json({ error: "File too large" }, 413);

  // 3) Upload to {userId}/{itemId}.jpg — the path is DERIVED, never client-supplied.
  //    upsert: true replaces the previous photo in place (same path → no orphan).
  const objectPath = `${userId}/${itemId}.jpg`;
  const svc = serviceClient(c.env);
  const { error: uploadErr } = await svc.storage
    .from(PHOTO_BUCKET)
    .upload(objectPath, bytes, { contentType: "image/jpeg", upsert: true });
  if (uploadErr) return c.json({ error: "Upload failed", detail: uploadErr.message }, 500);

  // 4) Persist the PATH (never a signed URL — URLs expire) via userClient, so RLS
  //    guards this write too.
  const { error: updateErr } = await user
    .from("items")
    .update({ photo_path: objectPath })
    .eq("id", itemId);
  if (updateErr) return c.json({ error: "Path update failed", detail: updateErr.message }, 500);

  // 5) Return a fresh signed URL so the client can render immediately (saves a round trip).
  const { data: signed, error: signErr } = await svc.storage
    .from(PHOTO_BUCKET)
    .createSignedUrl(objectPath, SIGNED_URL_TTL);
  if (signErr || !signed) return c.json({ error: "Signing failed", detail: signErr?.message }, 500);

  return c.json({ photoPath: objectPath, signedUrl: signed.signedUrl });
});
```

### 4. Signed-URL endpoint — verify ownership, then sign on demand

Signed URLs expire, so the client re-requests one whenever it needs to render the image. The route re-proves ownership through RLS on every call, plus a path-prefix check as a final guard before the `service_role` signature.

```typescript
// ── GET /v1/items/:id/photo-url — mint a fresh signed URL for the item's photo ──
itemsRoute.get("/:id/photo-url", async (c) => {
  const itemId = c.req.param("id");

  // Ownership gate through RLS (same as upload): fetch the caller's row or 404.
  const user = userClient(c.env, c.get("accessToken"));
  const { data: item, error: itemErr } = await user
    .from("items")
    .select("photo_path")
    .eq("id", itemId)
    .maybeSingle();
  if (itemErr) return c.json({ error: "Item lookup failed", detail: itemErr.message }, 500);
  if (!item) return c.json({ error: "Item not found or access denied" }, 404);
  if (!item.photo_path) return c.json({ error: "Item has no photo" }, 404);

  // Defense in depth: the first path segment must equal the caller's uid. On the happy
  // path this is always true (the upload endpoint wrote {userId}/{itemId}.jpg), but if
  // legacy dirty data or a future regression ever plants a foreign path, we still refuse
  // to sign a URL for someone else's private object (IDOR). 404, not 403 — do not leak
  // the object's existence.
  const { userId } = c.get("authUser");
  if ((item.photo_path as string).split("/")[0] !== userId) {
    return c.json({ error: "Item not found or access denied" }, 404);
  }

  // service_role signs the URL (reading a private object requires it).
  const svc = serviceClient(c.env);
  const { data: signed, error: signErr } = await svc.storage
    .from(PHOTO_BUCKET)
    .createSignedUrl(item.photo_path as string, SIGNED_URL_TTL);
  if (signErr || !signed) return c.json({ error: "Signing failed", detail: signErr?.message }, 500);

  return c.json({ signedUrl: signed.signedUrl });
});
```

### 5. Delete objects when rows go away (cascades never touch Storage)

Postgres `ON DELETE CASCADE` clears rows, but **Storage objects are not part of the cascade** — deleting an item row (or the whole user via `admin.deleteUser`) leaves the files behind: billable orphans that may contain personal data. Clean up at both deletion points.

```typescript
// ── DELETE /v1/items/:id — delete the row, then best-effort remove its object ──
itemsRoute.delete("/:id", async (c) => {
  const itemId = c.req.param("id");
  const user = userClient(c.env, c.get("accessToken"));
  // Returning photo_path from the delete tells us whether an object needs cleanup.
  const { data, error } = await user
    .from("items")
    .delete()
    .eq("id", itemId)
    .select("id, photo_path")
    .maybeSingle();
  if (error) return c.json({ error: "Delete failed", detail: error.message }, 500);
  if (!data) return c.json({ error: "Item not found or access denied" }, 404);

  // Best-effort: remove() reports failure via its return value (it does not throw).
  // A failure here only leaves an orphan for the periodic sweep — never fail the request.
  if (data.photo_path) {
    const svc = serviceClient(c.env);
    await svc.storage.from(PHOTO_BUCKET).remove([data.photo_path as string]);
  }
  return c.json({ deleted: data.id });
});
```

For account deletion, remove the user's whole folder **before** `admin.deleteUser` (see the delete flow in [auth-supabase-anonymous](recipe://auth-supabase-anonymous)):

```typescript
// src/routes/auth.ts — call before admin.deleteUser(userId) in DELETE /v1/auth/account.
import type { SupabaseClient } from "@supabase/supabase-js";

async function removeUserObjects(svc: SupabaseClient, userId: string): Promise<void> {
  // list() is NOT recursive — fine for flat {userId}/{itemId}.jpg paths.
  // If you nest folders (see Common Customizations #1), recurse into each subfolder.
  const { data: objects } = await svc.storage
    .from("item-photos")
    .list(userId, { limit: 1000 });
  if (objects && objects.length > 0) {
    await svc.storage
      .from("item-photos")
      .remove(objects.map((o) => `${userId}/${o.name}`));
  }
}
```

## Integration Checklist

### 1. Migration

- [ ] Bucket created via SQL migration with `public = false`, a `file_size_limit`, and an `allowed_mime_types` allowlist
- [ ] Migration is idempotent: bucket uses `on conflict (id) do nothing`; policies use `drop policy if exists` + `create`
- [ ] `storage.objects` owner-folder policies applied for all four verbs (select / insert / update / delete)
- [ ] Owning table stores the object **path** (`photo_path text`), never a URL
- [ ] `npm run db:push` applies cleanly to the linked project

### 2. Endpoints

- [ ] Upload endpoint: RLS ownership gate → Worker-level size/type validation → `service_role` upload → path persisted via `userClient`
- [ ] Object path is always `{userId}/...` with `userId` from the verified token — grep your routes for any client-supplied path reaching a Storage call
- [ ] Signed-URL endpoint re-proves ownership through RLS on every call and checks the path prefix before signing
- [ ] Delete flows (row delete + account delete) remove the corresponding objects

### 3. Clients + secrets

- [ ] Storage operations use `serviceClient` only **after** an RLS-enforced ownership check
- [ ] The `service_role` key lives only in `.dev.vars` / Cloudflare Secret ([infra-supabase](recipe://infra-supabase)) — never in the iOS app
- [ ] The iOS client renders images from signed URLs only; it holds no Supabase key and never calls Storage

### 4. IDOR test (must pass before shipping)

Two independent users (each via your `/v1/auth/anon`); user A owns `ITEM_A` with a photo:

```bash
TOKEN_A=... ; TOKEN_B=... ; ITEM_A=... ; A_UID=...

# 1) B requests a signed URL for A's item → 404 (RLS gate hides the row).
curl -s -o /dev/null -w "%{http_code}\n" \
  "$WORKER_URL/v1/items/$ITEM_A/photo-url" -H "Authorization: Bearer $TOKEN_B"
# Expected: 404

# 2) B uploads to A's item → 404 (ownership gate fires before any Storage op).
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  "$WORKER_URL/v1/items/$ITEM_A/photo" \
  -H "Authorization: Bearer $TOKEN_B" -H "Content-Type: image/jpeg" \
  --data-binary @photo.jpg
# Expected: 404

# 3) B reads A's object from Storage directly with a user JWT (bypassing your backend)
#    → blocked by the storage.objects RLS policies (defense in depth).
curl -s -o /dev/null -w "%{http_code}\n" \
  "$SUPABASE_URL/storage/v1/object/authenticated/item-photos/$A_UID/$ITEM_A.jpg" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN_B"
# Expected: NOT 200 (400/404)
```

## Common Customizations

### 1. Multiple photos per item

Nest one folder level: `{userId}/{itemId}/{photoId}.jpg`. The owner check is unchanged — `(storage.foldername(name))[1]` still extracts `{userId}` — and the DB side becomes a small `item_photos` child table (RLS via the forward-set pattern in [infra-supabase-rls](recipe://infra-supabase-rls)). Remember `list()` is non-recursive: account-deletion cleanup must recurse into each `{itemId}/` subfolder.

### 2. Accepting more image types

Validate the request `Content-Type` against an allowlist in the Worker, derive the file extension from it, and keep the bucket's `allowed_mime_types` in sync:

```typescript
const ALLOWED: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/heic": "heic",
};
const contentType = c.req.header("content-type") ?? "";
const ext = ALLOWED[contentType];
if (!ext) return c.json({ error: "Unsupported image type" }, 415);
const objectPath = `${userId}/${itemId}.${ext}`;
```

> When the extension can vary, delete the **old** `photo_path` after a successful upload if
> it differs from the new path — `upsert: true` only replaces an object at the *same* path,
> so `a.jpg` → `a.png` would otherwise leave `a.jpg` behind as an orphan.

### 3. Image transformations on signed URLs

Supabase can resize/transform on the fly at signing time (paid-plan feature):

```typescript
const { data } = await svc.storage.from(PHOTO_BUCKET).createSignedUrl(path, SIGNED_URL_TTL, {
  transform: { width: 400, height: 400, resize: "cover" },
});
```

Useful for thumbnails without storing multiple renditions.

### 4. Scheduled orphan sweep

Belt and braces for cleanup failures: a scheduled Worker ([Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)) that lists the bucket's top-level folders with `serviceClient`, compares each `{userId}` against `auth.users` (and each object against the owning table's `photo_path` values), and removes anything unreferenced. Run it daily; log what it deletes.

### 5. Batch-sign URLs for list views

Signing one URL per row in a 100-item list is 100 round trips to Storage. Use `createSignedUrls` (plural) to sign a batch of paths in one call, after filtering the list to the caller's rows via `userClient`:

```typescript
const paths = items.map((i) => i.photo_path).filter(Boolean) as string[];
const { data: signed } = await svc.storage.from(PHOTO_BUCKET).createSignedUrls(paths, SIGNED_URL_TTL);
```

## Known Pitfalls

### 1. Bucket created as public → every object is world-readable

**Symptom**: private user photos load in any browser via `/storage/v1/object/public/<bucket>/<path>` — no token, no expiry, forever.

**Cause**: the bucket was created with `public = true` (or toggled public in the dashboard "to make images load"). Public buckets serve every object to anyone who has or guesses the URL; with predictable paths like `{userId}/{itemId}.jpg`, guessing is enumeration.

**Fix**: `public = false` in the migration, reads only via signed URLs. If images "don't load", the fix is minting a signed URL server-side — never flipping the bucket public.

### 2. Storing the signed URL instead of the object path

**Symptom**: images render for about an hour after upload, then break everywhere (DB, caches, other devices) with 400/403 errors.

**Cause**: the signed URL — a time-limited credential — was persisted into the database as if it were the file's address.

**Fix**: store the object **path** (`photo_path`); mint a fresh signed URL on every read via the signed-URL endpoint. The URL is a disposable output, never state.

### 3. Signed URLs are bearer credentials — mind the leak surface

**Symptom**: someone who was never authenticated opens a user's private photo.

**Cause**: within its TTL a signed URL grants access to **anyone who holds it** — no JWT check, no RLS. URLs leak through chat messages, request logs, analytics, browser history, and referrer headers; and an issued URL **cannot be revoked** before it expires (short of deleting the object).

**Fix**: keep the TTL short (minutes-to-an-hour, matched to how long the client actually displays the image), generate on demand rather than handing out long-lived links, and never write signed URLs into logs or the database. Treat "sharing" as a product feature with its own endpoint, not as forwarding a signed URL.

### 4. Trusting a client-supplied object path → IDOR on write

**Symptom**: user B uploads into user A's folder (overwriting A's photo) by posting a crafted path or id.

**Cause**: the upload endpoint accepted a path (or built one from unverified input) instead of deriving it from the verified token.

**Fix**: the object path is always constructed server-side as `{authUser.userId}/...`. The client sends bytes and a row id — never a path. Layer 3 (`storage.objects` RLS) would also block this for user-JWT calls, but `service_role` uploads bypass it, which is exactly why the path must be derived, not received.

### 5. Signing URLs without an ownership check → IDOR on read

**Symptom**: user B fetches `/v1/items/<A's-id>/photo-url` and receives a working signed URL for A's private photo.

**Cause**: the endpoint went straight to `serviceClient.createSignedUrl` with the client's id. `service_role` bypasses RLS, so Storage happily signs for any object.

**Fix**: prove ownership **before** signing — the RLS-enforced `userClient` lookup (404 when the row is not the caller's), plus the path-prefix check as a final guard. Never let a `service_role` Storage call be reachable without an ownership decision in front of it.

### 6. `ON DELETE CASCADE` never deletes Storage objects → orphans

**Symptom**: storage usage (and cost) only ever grows; deleted users' photos still exist in the bucket — a data-retention and privacy problem, not just a billing one.

**Cause**: assuming the DB cascade covers files. Storage objects live outside Postgres; deleting `auth.users` → `profiles` → `items` rows leaves every uploaded object in place.

**Fix**: delete objects explicitly at both deletion points (row delete + account delete, Implementation §5), and run a scheduled orphan sweep (Common Customizations #4) to catch best-effort failures.

### 7. Re-running the bucket migration errors or clobbers dashboard settings

**Symptom**: `supabase db push` fails with a duplicate-key error on `storage.buckets`, or a re-applied migration silently resets a size limit that was tuned in the dashboard.

**Cause**: the migration used a bare `insert` (fails on re-apply) or an `upsert`/`update` (overwrites console-set properties).

**Fix**: `insert ... on conflict (id) do nothing` — records the bucket's existence idempotently without touching an existing bucket's properties. Policies pair `drop policy if exists` with `create` for the same reason (see the migration discipline in [infra-supabase](recipe://infra-supabase)).

### 8. Letting the client upload directly to Storage with the anon key

**Symptom**: the iOS app gains a Supabase dependency and embedded keys; server-side validation (size, type, ownership, rate limits) is skipped; the bucket layout becomes public client knowledge.

**Cause**: following generic Supabase tutorials that call `supabase.storage.upload()` from the app.

**Fix**: on this stack the client talks **only** to your Worker ([auth-supabase-anonymous](recipe://auth-supabase-anonymous)); uploads go through the Worker endpoint. The `storage.objects` RLS policies exist as insurance, not as an invitation to build a client-direct path.

### Production Readiness Checklist

- [ ] Bucket is **private** with `file_size_limit` + `allowed_mime_types` set in the migration
- [ ] `storage.objects` owner-folder RLS applied for all four verbs
- [ ] All Storage operations sit behind an RLS-enforced ownership gate; no `service_role` Storage call is reachable without one
- [ ] Object paths are derived server-side from the verified JWT — nothing client-supplied reaches a Storage call
- [ ] DB stores object paths only; signed URLs are minted per read with a short TTL and never logged or persisted
- [ ] Row-delete and account-delete flows remove the corresponding objects; a scheduled orphan sweep backs them up
- [ ] The two-token IDOR test passes: cross-user photo-url 404 · cross-user upload 404 · direct Storage read with a foreign user JWT blocked
