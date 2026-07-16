---
id: auth-supabase-anonymous
title: Anonymous-First Authentication with Supabase
description: Anonymous-first authentication for iOS apps — users access core features immediately without signing in, then optionally link Sign in with Apple which keeps the SAME user id (zero data migration). Uses Supabase anonymous sign-in for a real signed JWT, Hono middleware for three-level access control, dual-mode JWT verification (JWKS ES256 preferred, HS256 fallback), and a dependency-free iOS client built on URLSession (no supabase-swift).
tier: free
tags: [authentication, Supabase, anonymous, guest, Sign in with Apple, linkIdentity, RLS, JWT, JWKS, middleware, Hono, Cloudflare Workers, zero-dependency, data migration]
---

## What This Solves

Provides anonymous-first authentication for iOS apps where users can start using core features immediately without creating an account. On first launch the app calls the backend, which does a Supabase **anonymous sign-in** — the user gets a *real*, cryptographically signed JWT (`is_anonymous: true`, `role: authenticated`) and a stable `user id` right away. Later the user can optionally **Sign in with Apple**, which is linked to the *same* Supabase user via `linkIdentity` — the `user id` never changes, so **there is zero data migration**. The backend uses Hono middleware with three access levels: public, identity-required (anonymous + authenticated), and auth-required (non-anonymous / linked only).

> **Choosing between auth recipes**: This recipe is for apps that let users try core features
> without signing in first (e.g., utility apps, content apps, freemium tools) on a **Supabase +
> Cloudflare Workers** stack. If you are on **AWS** (Cognito + App Runner), use
> [auth-cognito-anonymous](recipe://auth-cognito-anonymous) instead. The two recipes are
> deliberately structured the same way so you can read them side by side. The key difference:
> Cognito Identity Pool assigns a *different* Identity ID to anonymous vs. authenticated
> sessions, so signing in requires a `POST /v1/auth/sync` data-migration step; Supabase keeps
> the **same `user id`** across `linkIdentity`, so linking Apple needs **no migration at all**.

## Architecture

```
iOS App (zero-dependency — URLSession only, no supabase-swift)
  SWUserManager (@MainActor @Observable)
    |--- SWAPIClient       (URLSession + Bearer + 401 refresh-and-replay)
    |--- SWKeychainStore   (access / refresh token persistence)
    |--- Sign in with Apple (native ASAuthorization + nonce)
    |
    v   (REST only — iOS NEVER talks to Supabase directly → stays dependency-free)
Cloudflare Workers (Hono backend)
    |--- Level 0: Public              (no token)
    |--- Level 1: identityMiddleware  (any valid Supabase JWT, incl. anonymous)
    |--- Level 2: authMiddleware      (non-anonymous / linked identity only)
    |--- POST   /v1/auth/anon      (anonymous sign-in → signed JWT)
    |--- POST   /v1/auth/refresh   (rotate session)
    |--- POST   /v1/auth/link      (SIWA linkIdentity — SAME user id, zero migration)
    |--- DELETE /v1/auth/account   (permanent delete + cascade)
    |
    v   (service_role client for system ops / user-JWT client for per-user data)
Supabase
    |--- Auth (GoTrue): anonymous user + linkIdentity + Apple provider
    |--- Postgres + RLS: profiles (1:1 with auth.users) + business tables (owner_id)
```

### Why Anonymous-First?

| Criteria | Anonymous-First | Login-Required |
|----------|----------------|----------------|
| User friction | Zero — instant access | High — must create account first |
| Conversion funnel | Try before committing | Must commit upfront |
| Data persistence | Real signed JWT tracks the user's data from launch 1 | Only after account creation |
| Best for | Utility apps, content apps, freemium | Social apps, enterprise tools |
| Complexity | Lower on Supabase (linkIdentity = zero migration) | Lower (no anonymous state) |

### Three access levels (and how they differ from Cognito)

| Level | Middleware | Who passes | Reads | Writes |
|-------|-----------|-----------|-------|--------|
| 0 | *(none)* | anyone | public data | — |
| 1 | `identityMiddleware` | any valid Supabase JWT, **including anonymous** | own data | **own data (yes — anonymous can write)** |
| 2 | `authMiddleware` | non-anonymous (linked identity) only | own data | own data + graduated-only ops |

> **Key divergence from [auth-cognito-anonymous](recipe://auth-cognito-anonymous)**: on Cognito
> the anonymous layer is **read-only**, because an anonymous user only carries a forgeable
> `X-Identity-Id` header (no verifiable token). On **Supabase, an anonymous user carries a real,
> signature-verified JWT** (`is_anonymous: true`, `role: authenticated`), so their writes can be
> safely isolated by Row Level Security. That is why Level 1 here permits writes. Level 2 is
> reserved for operations that require a *graduated* (non-anonymous) identity — e.g. anything you
> only want to allow after the user has linked Apple. This is a genuine architectural difference;
> do not copy Cognito's "anonymous is read-only" rule onto this stack.

## Dependencies

### iOS

| Requirement | Notes |
|-------------|-------|
| **None (zero third-party dependencies)** | The client talks to your Hono backend over REST using **system frameworks only**: `Foundation` (URLSession + Codable), `Security` (Keychain), `AuthenticationServices` (`SignInWithAppleButton`), `CryptoKit` (SHA-256 for the SIWA nonce). **Do not add `supabase-swift`** — keeping the Hono REST layer in front is what preserves the zero-dependency guarantee. |

### Backend (npm)

| Package | Purpose |
|---------|---------|
| `hono` | Web framework with middleware support (runs on Cloudflare Workers) |
| `@supabase/supabase-js` | Supabase client (GoTrue auth + PostgREST); talks HTTP, safe on Workers |
| `jose` | **Required** — verifies the Supabase JWT signature against the JWKS (ES256) or the legacy secret (HS256). Never trust an unverified token. |
| `zod` | Request validation (optional but recommended) |

## Implementation

### iOS

The iOS implementation uses `SWUserManager` as the central state manager. Unlike the Cognito recipe (which delegates to the Amplify SDK), the Supabase client is **fully dependency-free**: it implements token storage, the anonymous/refresh/link flows, and Sign in with Apple itself, talking only to your Hono backend over `URLSession`.

#### 1. SWUserManager.swift — Session state, token storage, API client, and auth orchestration

```swift
import Foundation
import Security

// MARK: - Session State

/// User session state for anonymous-first authentication.
enum SWSessionState: Equatable {
    case loading
    case anonymous(userId: String)
    case authenticated(userId: String, email: String?)
    case error(message: String)

    var isSignedIn: Bool {
        if case .authenticated = self { return true }
        return false
    }

    var isAnonymous: Bool {
        if case .anonymous = self { return true }
        return false
    }

    var userId: String? {
        switch self {
        case .anonymous(let id): return id
        case .authenticated(let id, _): return id
        default: return nil
        }
    }
}

// MARK: - Service Error

enum SWServiceError: Error, LocalizedError {
    case invalidURL
    case unauthorized                     // 401: token expired / invalid → upper layer refreshes
    case http(status: Int, body: String?) // other non-2xx
    case decoding(Error)
    case transport(Error)                 // URLSession transport failure (offline, etc.)

    var errorDescription: String? {
        switch self {
        case .invalidURL: return "Invalid request URL"
        case .unauthorized: return "Session expired"
        case .http(let status, let body): return "Server error \(status)" + (body.map { ": \($0)" } ?? "")
        case .decoding: return "Failed to parse server response"
        case .transport(let e): return e.localizedDescription
        }
    }
}

// MARK: - Auth response DTOs (match the Hono backend, camelCase)

/// /v1/auth/anon and /v1/auth/refresh share this shape.
struct SWAuthTokenResponse: Decodable {
    let userId: String
    let accessToken: String
    let refreshToken: String
    let isAnonymous: Bool
}

/// /v1/auth/link response. `user id` stays the same on first link ("linked").
struct SWAppleLinkResponse: Decodable {
    /// "linked"    = Apple bound to the current anonymous user (first time, user id unchanged).
    /// "signed_in" = that Apple id was already bound to ANOTHER user → signed back into it
    ///               (new device / reinstall recovery), tokens returned so the client switches.
    let mode: String
    let userId: String?
    let email: String?
    let isAnonymous: Bool
    let accessToken: String?   // only present in "signed_in" mode
    let refreshToken: String?
}

// MARK: - Keychain (zero-dependency, pure Security framework)

/// Tokens MUST live in the Keychain (not UserDefaults): they survive process kill
/// and are protected by system-level encryption.
enum SWKeychainStore {
    private static let service = "com.yourcompany.app.auth"

    enum Key {
        static let accessToken = "accessToken"
        static let refreshToken = "refreshToken"
    }

    static func read(_ key: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data,
              let str = String(data: data, encoding: .utf8) else { return nil }
        return str
    }

    static func save(_ value: String, for key: String) {
        guard let data = value.data(using: .utf8) else { return }
        let base: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]
        let update = SecItemUpdate(base as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if update == errSecItemNotFound {
            var add = base
            add[kSecValueData as String] = data
            // This device only, readable after first unlock — do NOT sync via iCloud Keychain
            // (avoids the same token showing up on multiple devices).
            add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            SecItemAdd(add as CFDictionary, nil)
        }
    }

    static func delete(_ key: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]
        SecItemDelete(query as CFDictionary)
    }
}

// MARK: - API Client

enum SWHTTPMethod: String { case get = "GET", post = "POST", patch = "PATCH", delete = "DELETE" }

/// Zero-dependency HTTP client. Decoupled from SWUserManager via two injected closures
/// (avoids a retain cycle): `tokenProvider` returns the current access token,
/// `refreshHandler` is invoked on 401 and returns a fresh access token (or throws).
final class SWAPIClient {
    static let baseURL = URL(string: "https://your-app.your-subdomain.workers.dev")!

    private let session: URLSession
    private static let decoder = JSONDecoder()
    private static let encoder = JSONEncoder()

    var tokenProvider: () -> String? = { nil }
    var refreshHandler: () async throws -> String = { throw SWServiceError.unauthorized }

    init(session: URLSession = .shared) { self.session = session }

    /// Authenticated request: attaches the Bearer token; on 401 it refreshes and replays ONCE.
    func authorizedRequest<Response: Decodable>(
        _ path: String, method: SWHTTPMethod, body: Encodable? = nil
    ) async throws -> Response {
        do {
            return try await send(path, method: method, body: body, token: tokenProvider())
        } catch SWServiceError.unauthorized {
            let newToken = try await refreshHandler()
            return try await send(path, method: method, body: body, token: newToken)
        }
    }

    /// Public request (used by /auth/anon and /auth/refresh — no token).
    func publicRequest<Response: Decodable>(
        _ path: String, method: SWHTTPMethod, body: Encodable? = nil
    ) async throws -> Response {
        try await send(path, method: method, body: body, token: nil)
    }

    private func send<Response: Decodable>(
        _ path: String, method: SWHTTPMethod, body: Encodable?, token: String?
    ) async throws -> Response {
        guard let url = URL(string: path, relativeTo: Self.baseURL) else { throw SWServiceError.invalidURL }
        var request = URLRequest(url: url)
        request.httpMethod = method.rawValue
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body { request.httpBody = try Self.encoder.encode(SWAnyEncodable(body)) }

        let data: Data, response: URLResponse
        do { (data, response) = try await session.data(for: request) }
        catch { throw SWServiceError.transport(error) }

        guard let http = response as? HTTPURLResponse else { throw SWServiceError.invalidURL }
        switch http.statusCode {
        case 200..<300:
            do { return try Self.decoder.decode(Response.self, from: data) }
            catch { throw SWServiceError.decoding(error) }
        case 401:
            throw SWServiceError.unauthorized
        default:
            throw SWServiceError.http(status: http.statusCode, body: String(data: data, encoding: .utf8))
        }
    }
}

/// Type-erased Encodable so `send` can take any body.
struct SWAnyEncodable: Encodable {
    private let encodeClosure: (Encoder) throws -> Void
    init(_ wrapped: Encodable) { encodeClosure = wrapped.encode }
    func encode(to encoder: Encoder) throws { try encodeClosure(encoder) }
}

// MARK: - User Manager

@MainActor
@Observable
final class SWUserManager {

    var sessionState: SWSessionState = .loading
    private(set) var userId: String?

    private let client: SWAPIClient
    private var accessToken: String?
    private var refreshToken: String?

    /// In-flight refresh task. Non-nil means a refresh is already running; concurrent 401s
    /// await the SAME task instead of each firing their own (prevents a "refresh storm"
    /// where parallel refreshes invalidate each other's rotated tokens).
    private var refreshTask: Task<String, Error>?

    /// "Has installed" flag in UserDefaults. UserDefaults is cleared on app uninstall
    /// (the Keychain is NOT), so a missing flag == fresh install → clear stale tokens.
    private static let hasInstalledFlagKey = "com.yourcompany.app.hasInstalledFlag"

    init(client: SWAPIClient = SWAPIClient()) {
        self.client = client
    }

    // MARK: - Bootstrap

    /// First-launch bootstrap: reuse an existing token if present (do NOT create a new
    /// anonymous user every launch), otherwise anonymous sign-in.
    func bootstrap() async {
        sessionState = .loading

        // Fresh-install detection: clear any Keychain token left behind by a previous install
        // so "delete app" == 100% new anonymous user (predictable behavior).
        if !UserDefaults.standard.bool(forKey: Self.hasInstalledFlagKey) {
            SWKeychainStore.delete(SWKeychainStore.Key.accessToken)
            SWKeychainStore.delete(SWKeychainStore.Key.refreshToken)
            UserDefaults.standard.set(true, forKey: Self.hasInstalledFlagKey)
        }

        // Wire the client's closures BEFORE any authorized call.
        client.tokenProvider = { [weak self] in self?.accessToken }
        client.refreshHandler = { [weak self] in
            guard let self else { throw SWServiceError.unauthorized }
            return try await self.refresh()
        }

        do {
            if let at = SWKeychainStore.read(SWKeychainStore.Key.accessToken),
               let rt = SWKeychainStore.read(SWKeychainStore.Key.refreshToken) {
                // Reuse existing tokens. (Optionally refresh here to hydrate user id / email.)
                accessToken = at
                refreshToken = rt
                _ = try await refresh() // rotates + gives us a fresh isAnonymous/email
            } else {
                try await anonLogin()
            }
        } catch {
            sessionState = .error(message: "Sign-in failed. Please retry.")
        }
    }

    // MARK: - Anonymous sign-in

    private func anonLogin() async throws {
        let resp: SWAuthTokenResponse = try await client.publicRequest("/v1/auth/anon", method: .post)
        persist(resp)
    }

    // MARK: - Refresh (concurrency-safe)

    /// Rotate tokens using the refresh token. Reuses an in-flight task so concurrent 401s
    /// trigger only one real refresh.
    func refresh() async throws -> String {
        if let task = refreshTask { return try await task.value }
        let task = Task<String, Error> { [self] in
            defer { refreshTask = nil }
            return try await performRefresh()
        }
        refreshTask = task
        return try await task.value
    }

    private func performRefresh() async throws -> String {
        guard let currentRefresh = refreshToken else { return try await reAnon() }
        do {
            let resp: SWAuthTokenResponse = try await client.publicRequest(
                "/v1/auth/refresh", method: .post, body: ["refreshToken": currentRefresh]
            )
            persist(resp)
            return resp.accessToken
        } catch SWServiceError.unauthorized {
            // Only a DEFINITIVE 401 (refresh token expired / revoked) falls back to a new
            // anonymous user — the old anonymous identity is genuinely unrecoverable.
            return try await reAnon()
        } catch {
            // Transient failure (offline / 5xx / decode): rethrow, NEVER re-anon. Re-anon on a
            // transient error would turn a recoverable blip into permanent data loss (the old
            // token stays in the Keychain and the next attempt can still succeed).
            throw error
        }
    }

    private func reAnon() async throws -> String {
        try await anonLogin()
        guard let token = accessToken else { throw SWServiceError.unauthorized }
        return token
    }

    // MARK: - Sign in with Apple (link — same user id, zero migration)

    /// Link Apple to the current user via the backend (POST /v1/auth/link, needs current token).
    /// Returns the response so the caller can react to the dual-path result.
    func linkApple(idToken: String, nonce: String?, fullName: String?) async throws -> SWAppleLinkResponse {
        struct LinkBody: Encodable { let appleIdToken: String; let nonce: String?; let fullName: String? }
        let resp: SWAppleLinkResponse = try await client.authorizedRequest(
            "/v1/auth/link", method: .post,
            body: LinkBody(appleIdToken: idToken, nonce: nonce, fullName: fullName)
        )
        // "signed_in": that Apple id was already bound to another user → switch to its session
        // (new device / reinstall recovery). Replace tokens in memory + Keychain.
        if resp.mode == "signed_in", let at = resp.accessToken, let rt = resp.refreshToken {
            accessToken = at
            refreshToken = rt
            userId = resp.userId
            SWKeychainStore.save(at, for: SWKeychainStore.Key.accessToken)
            SWKeychainStore.save(rt, for: SWKeychainStore.Key.refreshToken)
        }
        if let id = resp.userId ?? userId {
            sessionState = .authenticated(userId: id, email: resp.email)
        }
        return resp
    }

    // MARK: - Delete account (irreversible)

    /// Permanently delete the current account, then immediately anonymous-sign-in again so the
    /// app keeps working (equivalent to a brand-new anonymous user).
    func deleteAccount() async throws {
        struct Deleted: Decodable { let deleted: String }
        let _: Deleted = try await client.authorizedRequest("/v1/auth/account", method: .delete)
        SWKeychainStore.delete(SWKeychainStore.Key.accessToken)
        SWKeychainStore.delete(SWKeychainStore.Key.refreshToken)
        accessToken = nil; refreshToken = nil; userId = nil
        try await anonLogin()
    }

    // MARK: - Persistence

    private func persist(_ resp: SWAuthTokenResponse) {
        accessToken = resp.accessToken
        refreshToken = resp.refreshToken
        userId = resp.userId
        SWKeychainStore.save(resp.accessToken, for: SWKeychainStore.Key.accessToken)
        SWKeychainStore.save(resp.refreshToken, for: SWKeychainStore.Key.refreshToken)
        sessionState = resp.isAnonymous
            ? .anonymous(userId: resp.userId)
            : .authenticated(userId: resp.userId, email: nil)
    }
}
```

#### 2. App.swift — Auth-driven navigation (no SDK initialization)

Unlike the Cognito recipe there is no SDK to configure — no `Amplify.configure()`, no `amplifyconfiguration.json`. The manager bootstraps itself against your backend.

```swift
import SwiftUI

@main
struct MyApp: App {
    @State private var userManager = SWUserManager()

    var body: some Scene {
        WindowGroup {
            Group {
                switch userManager.sessionState {
                case .loading:
                    ProgressView("Loading…")
                case .anonymous:
                    MainView()   // anonymous users can use core features immediately
                case .authenticated:
                    MainView()   // linked users get full features
                case .error(let message):
                    SWAuthErrorView(message: message) {
                        Task { await userManager.bootstrap() }
                    }
                }
            }
            .environment(userManager)
            .task { await userManager.bootstrap() }
        }
    }
}

/// Error view with a retry button, shown when bootstrap fails.
struct SWAuthErrorView: View {
    let message: String
    let onRetry: () -> Void
    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "wifi.exclamationmark").font(.system(size: 48)).foregroundStyle(.secondary)
            Text("Connection Issue").font(.title2).fontWeight(.semibold)
            Text(message).foregroundStyle(.secondary).multilineTextAlignment(.center)
            Button("Try Again", action: onRetry).buttonStyle(.borderedProminent).controlSize(.large)
        }
        .padding()
    }
}
```

#### 3. SWSignInWithApple.swift — Native Sign in with Apple (nonce + linkIdentity)

This is where the Supabase stack differs most from Cognito on the client. Cognito's Amplify SDK wraps Sign in with Apple behind Hosted UI; here the client uses the **native** `SignInWithAppleButton`, generates the anti-replay nonce itself, and hands the resulting `idToken` to the backend's `/v1/auth/link` endpoint. Still zero third-party dependencies.

```swift
import SwiftUI
import AuthenticationServices
import CryptoKit

/// Sign-in sheet: native SignInWithAppleButton + anti-replay nonce, calls SWUserManager.linkApple.
struct SWSignInSheet: View {
    @Environment(SWUserManager.self) private var userManager
    @Environment(\.dismiss) private var dismiss

    /// Raw nonce: generated in onRequest, forwarded to the backend in onCompletion for verification.
    @State private var currentNonce: String?

    var body: some View {
        VStack(spacing: 24) {
            Text("Sign in to keep your data safe across devices.")
                .multilineTextAlignment(.center)

            SignInWithAppleButton(.signIn) { request in
                let nonce = randomNonceString()
                currentNonce = nonce
                request.requestedScopes = [.fullName, .email]
                request.nonce = sha256(nonce)   // Apple bakes the HASH into the idToken; backend verifies against the RAW nonce
            } onCompletion: { result in
                handleAppleAuth(result)
            }
            .signInWithAppleButtonStyle(.black)
            .frame(height: 50)
        }
        .padding(24)
    }

    private func handleAppleAuth(_ result: Result<ASAuthorization, Error>) {
        switch result {
        case .success(let auth):
            guard let credential = auth.credential as? ASAuthorizationAppleIDCredential,
                  let tokenData = credential.identityToken,
                  let idToken = String(data: tokenData, encoding: .utf8) else { return }
            // Apple returns fullName ONLY on the first authorization; capture and upload it once.
            let fullName = [credential.fullName?.givenName, credential.fullName?.familyName]
                .compactMap { $0 }.joined(separator: " ")
            Task {
                do {
                    _ = try await userManager.linkApple(
                        idToken: idToken, nonce: currentNonce,
                        fullName: fullName.isEmpty ? nil : fullName
                    )
                    dismiss()
                } catch {
                    // Surface the error to the user (toast / alert).
                }
            }
        case .failure(let error):
            // User cancellation is not an error.
            if let e = error as? ASAuthorizationError, e.code == .canceled { return }
        }
    }

    // MARK: - SIWA nonce helpers (anti-replay: SHA256(rawNonce) → Apple, rawNonce → backend)

    private func randomNonceString(length: Int = 32) -> String {
        let charset: [Character] = Array("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-._")
        return String((0..<length).compactMap { _ in charset.randomElement() })
    }

    private func sha256(_ input: String) -> String {
        SHA256.hash(data: Data(input.utf8)).map { String(format: "%02x", $0) }.joined()
    }
}
```

### Backend

#### 1. src/lib/supabase.ts — Client factory (service_role vs user-JWT vs anon)

Supabase gives you three distinct clients with different trust levels. Getting this split right is the foundation of the security model.

```typescript
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../types";

/// Stateless auth options (Workers has no localStorage / persistent session).
const STATELESS_AUTH = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
} as const;

/**
 * service_role client — bypasses ALL Row Level Security. Use ONLY for system operations:
 * anonymous sign-in, profile-row initialization, Apple linking, Storage uploads, cleanup.
 * The service_role key must NEVER be shipped to the client and NEVER committed to git.
 *
 * Note: the key must be placed explicitly in the Authorization header to reliably bypass RLS.
 * PostgREST decides the role from the Authorization header (not the apikey), so relying on
 * the createClient 2nd arg alone can leave requests bound to an RLS-constrained role.
 */
export function serviceClient(env: Env): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    ...STATELESS_AUTH,
    global: { headers: { Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` } },
  });
}

/**
 * User-JWT client — runs as the request's user, so RLS is enforced automatically.
 * Use for ALL per-user data reads/writes; you never hand-write `WHERE owner_id = ...`.
 * @param accessToken a Supabase access token already verified by the auth middleware.
 */
export function userClient(env: Env, accessToken: string): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    ...STATELESS_AUTH,
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

/**
 * Anon client — anon/public key only, no user Authorization. Used for user-scope GoTrue
 * operations that have no access token yet (currently only refreshSession: the refresh_token
 * IS the credential). Do NOT reuse serviceClient here — GoTrue rejects token refresh under the
 * service role.
 */
export function anonClient(env: Env): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, STATELESS_AUTH);
}
```

#### 2. src/middleware/auth.ts — Three-level access control + dual-mode JWT verification

> **SECURITY — read this first**: the `Authorization: Bearer <jwt>` token **must** be
> cryptographically verified (signature + issuer + audience) before you trust any claim inside
> it. Never `base64`-decode a Supabase JWT and trust its `sub` / `email` — a client can forge
> `{"sub":"<someone-else's-id>"}` trivially and impersonate other users. The middleware below
> uses `jose` to verify against the Supabase **JWKS** (ES256, recommended) or the legacy **JWT
> secret** (HS256), checking the issuer and `audience: "authenticated"`.

```typescript
import { createMiddleware } from "hono/factory";
import * as jose from "jose";
import type { AppEnv, AuthUser, Env } from "../types";

// ---------------------------------------------------------------------------
// JWKS cache, keyed by SUPABASE_URL.
// jose's createRemoteJWKSet has a built-in in-memory cache + automatic key rotation, so it
// MUST be reused across requests. A module-level variable survives across requests in the same
// Workers isolate — exactly the cache lifetime we want. Rebuilding it per request would drop
// the cache and hit the JWKS endpoint every time.
// ---------------------------------------------------------------------------
const jwksCache = new Map<string, ReturnType<typeof jose.createRemoteJWKSet>>();

function getJwks(supabaseUrl: string): ReturnType<typeof jose.createRemoteJWKSet> {
  let set = jwksCache.get(supabaseUrl);
  if (!set) {
    set = jose.createRemoteJWKSet(new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`));
    jwksCache.set(supabaseUrl, set);
  }
  return set;
}

/** A Supabase access token's issuer is https://<ref>.supabase.co/auth/v1 */
function expectedIssuer(supabaseUrl: string): string {
  return `${supabaseUrl}/auth/v1`;
}

/**
 * Verify a Supabase access token: signature + issuer + audience.
 * Prefers JWKS (ES256, asymmetric — best for serverless/edge); falls back to HS256 when the
 * project still uses the legacy symmetric secret (SUPABASE_JWT_SECRET). Returns the verified
 * AuthUser or throws. NEVER trust the payload without going through this function.
 */
async function verifySupabaseToken(env: Env, token: string): Promise<AuthUser> {
  const verifyOptions: jose.JWTVerifyOptions = {
    issuer: expectedIssuer(env.SUPABASE_URL),
    audience: "authenticated", // Supabase access tokens always carry aud = "authenticated"
  };

  let payload: jose.JWTPayload;
  if (env.SUPABASE_JWT_SECRET && env.SUPABASE_JWT_SECRET.length > 0) {
    // Mode 2: legacy HS256 symmetric secret.
    const secret = new TextEncoder().encode(env.SUPABASE_JWT_SECRET);
    ({ payload } = await jose.jwtVerify(token, secret, verifyOptions));
  } else {
    // Mode 1 (recommended): ES256 asymmetric via the JWKS endpoint.
    ({ payload } = await jose.jwtVerify(token, getJwks(env.SUPABASE_URL), verifyOptions));
  }

  const userId = payload.sub;
  if (!userId) throw new Error("token missing sub claim");
  return {
    userId,
    email: typeof payload.email === "string" ? payload.email : undefined,
    // is_anonymous is written by Supabase into the anonymous-sign-in JWT; default false.
    isAnonymous: payload.is_anonymous === true,
  };
}

/** Extract the token from `Authorization: Bearer <token>`; null if absent. */
function extractBearer(c: { req: { header: (k: string) => string | undefined } }): string | null {
  const h = c.req.header("authorization");
  if (!h || !h.startsWith("Bearer ")) return null;
  const token = h.slice(7).trim();
  return token.length > 0 ? token : null;
}

/**
 * Level 1: identity middleware — accepts ANY valid Supabase JWT (anonymous users included).
 * Use for endpoints where an anonymous user should already be able to read AND write their own
 * data (isolation is enforced by RLS via userClient). Injects `authUser` and the raw
 * `accessToken` (so routes can build a user-JWT client).
 */
export const identityMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const token = extractBearer(c);
  if (!token) return c.json({ error: "Missing or invalid Authorization header" }, 401);
  try {
    const authUser = await verifySupabaseToken(c.env, token);
    c.set("authUser", authUser);
    c.set("accessToken", token);
    return next();
  } catch (err) {
    if (err instanceof jose.errors.JWTExpired) return c.json({ error: "Token expired" }, 401);
    return c.json({ error: "Invalid token" }, 401);
  }
});

/**
 * Level 2: auth middleware — additionally requires a GRADUATED (non-anonymous) identity.
 * Use for "linked-account-only" operations. An anonymous user hitting this gets 403 and should
 * be guided to Sign in with Apple.
 */
export const authMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const token = extractBearer(c);
  if (!token) return c.json({ error: "Missing or invalid Authorization header" }, 401);
  try {
    const authUser = await verifySupabaseToken(c.env, token);
    if (authUser.isAnonymous) return c.json({ error: "Please link your Apple account first" }, 403);
    c.set("authUser", authUser);
    c.set("accessToken", token);
    return next();
  } catch (err) {
    if (err instanceof jose.errors.JWTExpired) return c.json({ error: "Token expired" }, 401);
    return c.json({ error: "Invalid token" }, 401);
  }
});
```

> **Note**: the middleware is `async` because JWKS verification is async (Hono awaits it
> automatically). The `authUser` output shape (`{ userId, email, isAnonymous }`) is a deliberate
> cross-stack contract: it mirrors the Cognito recipe's `authUser` so your business routes read
> `c.get("authUser")` without caring which backend issued the token. See
> [auth-cognito-anonymous](recipe://auth-cognito-anonymous). The only difference is the optional
> `isAnonymous` field, which Cognito's Identity-Pool model does not have.

#### 3. src/routes/auth.ts — anonymous sign-in, refresh, SIWA link (dual-path), delete

```typescript
import { Hono } from "hono";
import { z } from "zod";
import { serviceClient, anonClient } from "../lib/supabase";
import { identityMiddleware } from "../middleware/auth";
import type { AppEnv } from "../types";

export const authRoute = new Hono<AppEnv>();

// ── POST /v1/auth/anon — anonymous sign-in (zero-friction first launch) ──
// Uses the service_role client to call signInAnonymously(), returns a real user + JWT.
// The iOS client stores access/refresh tokens in the Keychain and sends Bearer afterwards.
authRoute.post("/anon", async (c) => {
  const supabase = serviceClient(c.env);
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error || !data.session || !data.user) {
    return c.json({ error: "Anonymous sign-in failed", detail: error?.message }, 500);
  }
  // Create the profile row (service_role bypasses RLS). profiles.id reuses auth.users.id.
  // Idempotent upsert so a repeat never errors.
  const { error: profileErr } = await supabase
    .from("profiles")
    .upsert({ id: data.user.id }, { onConflict: "id", ignoreDuplicates: true });
  if (profileErr) return c.json({ error: "Profile init failed", detail: profileErr.message }, 500);

  return c.json({
    userId: data.user.id,
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token,
    isAnonymous: true,
  });
});

// ── POST /v1/auth/refresh — rotate the session (public) ──
// The access token expires in ~1h; the refresh_token IS the credential, so this route is NOT
// behind identityMiddleware (an expired access token would always fail verification). Keeping
// "iOS talks only to Hono" means the backend proxies the refresh with the anon client.
const refreshSchema = z.object({ refreshToken: z.string().min(1) });

authRoute.post("/refresh", async (c) => {
  const parsed = refreshSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Refresh failed" }, 401);

  const supabase = anonClient(c.env);
  const { data, error } = await supabase.auth.refreshSession({
    refresh_token: parsed.data.refreshToken,
  });
  if (error || !data.session || !data.user) return c.json({ error: "Refresh failed" }, 401);

  return c.json({
    userId: data.user.id,
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token,
    isAnonymous: data.user.is_anonymous ?? false,
  });
});

// ── POST /v1/auth/link — link Apple to the CURRENT user via GoTrue linkIdentity (id_token flow) ──
//
// Path A (linked): with the current user's token + link_identity=true, GoTrue links Apple to the
//   current (anonymous) user — SAME user id, data preserved, ZERO migration.
// Path B (signed_in): if that Apple id is already bound to another user (GoTrue returns
//   `identity_already_exists`), fall back to signInWithIdToken to log back INTO that user and
//   return its tokens (new-device / reinstall recovery).
//
// Requires (Supabase console): (1) Authentication → enable "Manual Linking";
//   (2) Auth → Providers → Apple → add your bundle id to Client IDs (native-only: no OAuth
//   secret / signing key needed). GoTrue validates the id_token audience against those Client
//   IDs, so no APPLE_BUNDLE_ID env var is needed on the backend.
const linkSchema = z.object({
  appleIdToken: z.string().min(1),
  nonce: z.string().optional(),          // RAW SIWA nonce (client sent SHA256(nonce) to Apple)
  fullName: z.string().max(120).optional(), // Apple returns this only on first authorization
});

authRoute.post("/link", identityMiddleware, async (c) => {
  const parsed = linkSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Invalid parameters", issues: parsed.error.issues }, 400);
  const { appleIdToken, nonce, fullName } = parsed.data;
  const { userId } = c.get("authUser");
  const accessToken = c.get("accessToken");

  const idTokenEndpoint = `${c.env.SUPABASE_URL}/auth/v1/token?grant_type=id_token`;

  // ── Path A: linkIdentity — bind Apple to the CURRENT user, keep its data (first bind) ──
  const linkRes = await fetch(idTokenEndpoint, {
    method: "POST",
    headers: {
      apikey: c.env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ provider: "apple", id_token: appleIdToken, nonce, link_identity: true }),
  });

  if (linkRes.ok) {
    // First bind succeeded → persist Apple name/email (returned only once).
    const linked = (await linkRes.json().catch(() => ({}))) as { user?: { email?: string | null } };
    const appleEmail = linked.user?.email ?? undefined;
    const supabase = serviceClient(c.env);
    const patch: Record<string, unknown> = { has_linked_apple_id: true };
    if (appleEmail) patch.email = appleEmail;
    if (fullName && fullName.trim()) patch.display_name = fullName.trim();
    const { error } = await supabase.from("profiles").update(patch).eq("id", userId);
    if (error) return c.json({ error: "Profile update failed", detail: error.message }, 500);
    return c.json({ mode: "linked", userId, email: appleEmail ?? null, isAnonymous: false });
  }

  // ── link failed: is it because this Apple id is already bound to another user? ──
  const linkErr = (await linkRes.json().catch(() => ({}))) as { error_code?: string };
  if (linkErr.error_code !== "identity_already_exists") {
    const status = linkRes.status === 401 || linkRes.status === 403 ? 401 : 502;
    return c.json({ error: "Apple link failed", detail: JSON.stringify(linkErr) }, status);
  }

  // ── Path B: sign back INTO the already-bound user (no Authorization, no link_identity) ──
  const signinRes = await fetch(idTokenEndpoint, {
    method: "POST",
    headers: { apikey: c.env.SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "apple", id_token: appleIdToken, nonce }),
  });
  if (!signinRes.ok) return c.json({ error: "Apple sign-in failed", detail: await signinRes.text() }, 502);

  const session = (await signinRes.json().catch(() => ({}))) as {
    access_token?: string; refresh_token?: string; user?: { id?: string; email?: string | null };
  };
  if (!session.access_token || !session.refresh_token || !session.user?.id) {
    return c.json({ error: "Unexpected Apple sign-in response" }, 502);
  }
  return c.json({
    mode: "signed_in",
    userId: session.user.id,
    email: session.user.email ?? null,
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    isAnonymous: false,
  });
});

// ── DELETE /v1/auth/account — permanent, irreversible ──
// admin.deleteUser removes auth.users → ON DELETE CASCADE clears the whole tree
// (profiles → business tables). Deletes the CURRENT token's user; does not accept a client id.
authRoute.delete("/account", identityMiddleware, async (c) => {
  const { userId } = c.get("authUser");
  const supabase = serviceClient(c.env);
  const { error } = await supabase.auth.admin.deleteUser(userId);
  if (error) return c.json({ error: "Delete account failed", detail: error.message }, 500);
  return c.json({ deleted: userId });
});
```

#### 4. src/index.ts — Route registration (Cloudflare Workers entry)

```typescript
import { Hono } from "hono";
import { authRoute } from "./routes/auth";
import { identityMiddleware, authMiddleware } from "./middleware/auth";
import type { AppEnv } from "./types";

const app = new Hono<AppEnv>();

// Level 0 — public
app.get("/health", (c) => c.json({ status: "ok" }));

// Auth routes (/anon & /refresh are public; /link & /account set identityMiddleware themselves)
app.route("/v1/auth", authRoute);

// Level 1 — any valid Supabase JWT (anonymous included). Anonymous users read AND write their
// OWN data here; RLS isolates rows by auth.uid().
// app.use("/v1/items/*", identityMiddleware);

// Level 2 — non-anonymous (linked) identity only.
// app.use("/v1/billing/*", authMiddleware);

export default app; // Workers entry (NOT @hono/node-server)
```

#### 5. src/types.ts — Env + AuthUser + AppEnv

```typescript
/** Cloudflare Workers bindings (the shape of c.env). Mirror this in wrangler.jsonc / .dev.vars. */
export interface Env {
  SUPABASE_URL: string;               // https://<project-ref>.supabase.co
  SUPABASE_SERVICE_ROLE_KEY: string;  // bypasses RLS; server-side secret, never shipped to client
  SUPABASE_ANON_KEY: string;          // apikey for the user-JWT / anon clients
  SUPABASE_JWT_SECRET?: string;       // optional: HS256 legacy secret; ES256 projects use JWKS
}

/**
 * Verified user attached to the Hono context (cross-stack contract; see auth-cognito-anonymous).
 * Upper routes read c.get("authUser") and stay agnostic to the identity provider.
 */
export interface AuthUser {
  userId: string;       // Supabase auth.users.id (== profiles.id), stable across linkIdentity
  email?: string;       // undefined while anonymous
  isAnonymous: boolean; // true after anonymous sign-in, false after linking Apple
}

export type AppEnv = {
  Bindings: Env;
  Variables: {
    authUser: AuthUser;   // set by identity/auth middleware
    accessToken: string;  // raw token, for building a user-JWT client (RLS enforcement)
  };
};
```

### Infrastructure

Where the Cognito recipe uses AWS CDK to provision an Identity Pool + User Pool, the Supabase stack is configured through the Supabase console + a SQL migration + a Cloudflare `wrangler.jsonc`. (For the full RLS patterns and tests, see [infra-supabase-rls](recipe://infra-supabase-rls); for the Supabase CLI / Workers deployment workflow, see [infra-supabase](recipe://infra-supabase).)

#### 1. Supabase project setup (console + config.toml)

```toml
# supabase/config.toml — used by the Supabase CLI (local `supabase start`, `supabase db push`).
# region is NOT set here: it is chosen in the console at "New Project" and is IMMUTABLE.

[auth]
enabled = true
jwt_expiry = 3600
enable_refresh_token_rotation = true
refresh_token_reuse_interval = 10

# ★ Anonymous sign-in (zero-friction first launch) — MUST be enabled.
enable_anonymous_sign_ins = true

[auth.rate_limit]
anonymous_users = 30   # per-IP anonymous sign-ins per hour (anti-abuse)

# ★ Sign in with Apple (iOS-only native id_token flow).
# Native flow needs NO Services ID / .p8; the console / here only needs the bundle id as client_id.
[auth.external.apple]
enabled = false                       # local placeholder; enable + fill bundle id in the console
client_id = "com.yourcompany.app"
secret = ""                           # not needed for the native id_token flow
```

Console checklist (hosted project — several of these are mandatory or `linkIdentity` fails):

- **Create the project in the correct region — it is IMMUTABLE after creation** (pick your users' region on step 1).
- **Authentication → enable Anonymous sign-ins.**
- **Authentication → enable Manual Linking** (required for `linkIdentity`).
- **Auth → Providers → Apple → add your bundle id to Client IDs** (native-only: no OAuth secret / signing key).
- Recommended: migrate the project to **ES256 asymmetric JWT signing keys**, then leave `SUPABASE_JWT_SECRET` empty so the backend verifies via JWKS.

#### 2. Database: profiles table + RLS (SQL migration)

This is the Supabase equivalent of the Cognito recipe's `users` table. The difference: isolation is enforced by **RLS in the database**, not by application-layer `WHERE` clauses.

```sql
-- profiles — 1:1 with auth.users, id reuses the auth user id.
create table if not exists profiles (
  id                  uuid primary key references auth.users(id) on delete cascade,
  display_name        text not null default '',
  email               text,
  has_linked_apple_id boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Example business table — one-to-many under a profile. Key business tables by owner_id
-- (a stable UUID), never by anything client-supplied.
create table if not exists items (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references profiles(id) on delete cascade,
  title      text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_items_owner_id on items (owner_id);

-- ── RLS ──
-- Note: a Supabase anonymous user gets a REAL JWT with role=authenticated and is_anonymous=true,
-- so it HITS these `to authenticated` policies and can read/write its own rows. That is what
-- makes "anonymous can write its own data" safe (see the three-levels table above).
alter table profiles enable row level security;

-- The profile row is created by the backend via service_role (which bypasses RLS), so there is
-- deliberately NO insert/delete policy for authenticated users.
drop policy if exists "profiles_select_own" on profiles;
create policy "profiles_select_own" on profiles
  for select to authenticated
  using ( (select auth.uid()) = id );      -- wrap auth.uid() in (select ...) → init-plan cached

drop policy if exists "profiles_update_own" on profiles;
create policy "profiles_update_own" on profiles
  for update to authenticated
  using ( (select auth.uid()) = id )
  with check ( (select auth.uid()) = id );

alter table items enable row level security;

drop policy if exists "items_all_own" on items;
create policy "items_all_own" on items
  for all to authenticated
  using ( (select auth.uid()) = owner_id )
  with check ( (select auth.uid()) = owner_id );
```

> For child tables (grandchildren of `profiles`), use the forward-set subquery pattern
> `parent_id in (select id from items where owner_id = (select auth.uid()))`, and index every
> column a policy touches. Full patterns + isolation tests: [infra-supabase-rls](recipe://infra-supabase-rls).

#### 3. Cloudflare Workers configuration (wrangler.jsonc + secrets)

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "your-app-server",
  "main": "src/index.ts",
  "compatibility_date": "2025-05-01",
  // supabase-js relies on some Node built-ins on Workers → nodejs_compat is required.
  "compatibility_flags": ["nodejs_compat"],
  "observability": { "enabled": true }

  // Secrets (NEVER in this file, NEVER in git) — set via one of:
  //   A. local dev: .dev.vars (gitignored)
  //   B. production: Cloudflare console → Settings → Variables and Secrets (Secret type),
  //      or `npx wrangler secret put <NAME>`:
  //        SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY,
  //        SUPABASE_JWT_SECRET (only if the project still uses HS256)
}
```

## Integration Checklist

### Phase 1: Supabase Setup

- [ ] Create the Supabase project in the **correct (immutable) region**
- [ ] Enable **Anonymous sign-ins**
- [ ] Enable **Manual Linking** (Authentication settings)
- [ ] Add your bundle id to **Auth → Providers → Apple → Client IDs**
- [ ] (Recommended) migrate to **ES256** signing keys; leave `SUPABASE_JWT_SECRET` empty
- [ ] Apply the `profiles` + business-table migration with RLS enabled

### Phase 2: iOS Setup

- [ ] Add the **Sign in with Apple** capability in Xcode
- [ ] Add `SWUserManager.swift`, `SWSignInWithApple.swift` (no SPM packages, no config file)
- [ ] Set `SWAPIClient.baseURL` to your Workers URL
- [ ] Wire `sessionState` to control navigation in `App.swift`; call `bootstrap()` in `.task`

### Phase 3: Backend Setup (Cloudflare Workers)

- [ ] Add `lib/supabase.ts` (serviceClient / userClient / anonClient)
- [ ] Add `middleware/auth.ts` (identityMiddleware + authMiddleware, dual-mode JWT)
- [ ] Add `routes/auth.ts` (/anon, /refresh, /link, DELETE /account) and register in `index.ts`
- [ ] Set secrets in Cloudflare (never in `wrangler.jsonc` / git)
- [ ] Use `userClient` for per-user data (RLS); use `serviceClient` only for system ops

### Phase 4: Sign in with Apple (link — zero migration)

- [ ] Sign-in sheet generates a raw nonce, sends `SHA256(nonce)` to Apple, raw nonce to the backend
- [ ] `POST /v1/auth/link` first tries `linkIdentity` (Path A: same user id, no migration)
- [ ] On `identity_already_exists`, falls back to `signInWithIdToken` (Path B: recovery)
- [ ] "signed_in" mode swaps the client's tokens and reloads data for the recovered account
- [ ] First link persists Apple `display_name` / `email` (returned only once)

### Phase 5: Testing

- [ ] Fresh install → `.anonymous` with a valid user id; core features usable immediately
- [ ] Anonymous user can read AND write its own data (Level 1 routes, isolated by RLS)
- [ ] Sign in with Apple upgrades to `.authenticated` with the **same user id** (verify in DB)
- [ ] Reinstall + Sign in with Apple recovers the previous account (Path B)
- [ ] Kill + reopen: token reused from Keychain (NO new anonymous user created)
- [ ] Delete app + reopen: Keychain cleared → brand-new anonymous user
- [ ] Concurrent 401s trigger exactly one refresh (no refresh storm)
- [ ] Two different users' tokens cannot read each other's rows (RLS isolation test)

## Common Customizations

### 1. Rate limiting / WAF at the Cloudflare edge

Where the Cognito recipe adds API Gateway, on Cloudflare you add **Rate Limiting Rules** / **WAF** in front of the Worker (dashboard → Security). Supabase also rate-limits anonymous sign-ins per IP (`config.toml [auth.rate_limit] anonymous_users`).

### 2. Add email/password or magic-link sign-up

Supabase Auth supports email/password and magic links out of the box. Add a backend route that proxies `supabase.auth.signUp` / `signInWithOtp`, and keep the same `authUser` contract so upper routes are unaffected.

### 3. Storage scoped by user id (RLS on storage.objects)

Store per-user files under a `{userId}/...` object path and enforce it with RLS on `storage.objects`. Upload through a `service_role` backend endpoint that derives the path server-side (never accept a client-supplied path → prevents IDOR). Full pattern: [infra-supabase-storage](recipe://infra-supabase-storage).

### 4. Feature gating (some features require a linked account)

```swift
struct PremiumFeatureView: View {
    @Environment(SWUserManager.self) private var userManager
    @State private var showSignIn = false
    var body: some View {
        Button("Start") {
            if userManager.sessionState.isSignedIn { start() } else { showSignIn = true }
        }
        .sheet(isPresented: $showSignIn) { SWSignInSheet() }
    }
}
```

On the backend, mount such routes behind `authMiddleware` (Level 2) — anonymous users get 403 and are guided to link Apple.

### 5. Add phone OTP sign-in

Supabase Auth supports phone OTP (`signInWithOtp` + `verifyOtp`). Add backend routes for the two steps and, if you want to link it to the current anonymous user, use the same `linkIdentity` approach as Apple.

## Known Pitfalls

### 1. Do NOT create a new anonymous user on every launch

**Symptom**: anonymous users pile up; you approach the Supabase MAU cap; analytics show huge churn.

**Cause**: calling `POST /v1/auth/anon` unconditionally on every launch instead of reusing the stored session.

**Fix**: `bootstrap()` reads the Keychain first and reuses the existing token; it only signs in anonymously when there is no token. Consider a `pg_cron` job that periodically deletes *empty, expired* anonymous users (verify no data before deleting).

### 2. User id does NOT change when linking Apple → zero migration

**Symptom** (expected, positive): after Sign in with Apple, all the user's anonymous data is still there.

**Why**: `linkIdentity` attaches the Apple identity to the *same* `auth.users` row, so `auth.uid()` is unchanged and every `owner_id` FK still matches. This is the headline advantage over Cognito Identity Pool, where the Identity ID changes and you must run a `POST /v1/auth/sync` migration (see [auth-cognito-anonymous](recipe://auth-cognito-anonymous) pitfall #2). **Do not** build a migration step here — there is nothing to migrate.

### 3. Fresh install must clear the Keychain

**Symptom**: after deleting and reinstalling the app, the user unexpectedly resumes a previous (possibly wrong) account.

**Cause**: the Keychain **survives app uninstall**, while UserDefaults is cleared. A leftover token would be reused.

**Fix**: `bootstrap()` uses a UserDefaults "has installed" flag to detect a fresh install and clears the Keychain tokens, so "delete app == 100% new anonymous user". (Note: an Xcode overwrite-build does NOT delete the app, so it correctly keeps the same account.)

### 4. Transient refresh failures must NOT trigger re-anon

**Symptom**: a brief network blip on launch silently drops the user into a new empty account; their data appears lost.

**Cause**: treating *any* refresh failure as "refresh token dead" and re-anonymizing.

**Fix**: only a **definitive 401** on the refresh token (expired / revoked) falls back to a new anonymous user. Network errors / 5xx / decode failures must **rethrow** and keep the old Keychain token, so the next attempt can still succeed. `performRefresh()` implements exactly this distinction.

### 5. Sign in with Apple returns name/email only once

**Symptom**: after the first sign-in, `fullName` / `email` come back empty.

**Cause**: Apple returns the user's name (and, if hidden, the relay email) **only on the very first authorization** for your app.

**Fix**: capture `fullName` in the SIWA completion handler and upload it with the first `/v1/auth/link` call; the backend persists it to `profiles.display_name` / `email`. Afterwards, always read from your own DB.

### 6. Manual Linking / Apple Client IDs not configured → linkIdentity fails

**Symptom**: `/v1/auth/link` returns an error even though the id_token is valid.

**Fix**: enable **Manual Linking** in the Supabase console, and add your bundle id to **Auth → Providers → Apple → Client IDs**. GoTrue validates the id_token audience against those Client IDs — this is why the backend needs no `APPLE_BUNDLE_ID` env var.

### 7. Concurrent 401s must share one refresh

**Symptom**: several requests 401 at once, each refreshes, and rotated refresh tokens invalidate each other → cascading logouts.

**Fix**: `SWUserManager.refresh()` reuses an in-flight `Task`, so parallel 401s await the same single refresh.

### 8. The `is_anonymous` claim is baked into the JWT at issue time

**Symptom**: right after linking Apple, a Level-2 (`authMiddleware`) route still 403s.

**Cause**: the current access token was issued while anonymous, so its `is_anonymous` claim is still `true` until the next token rotation.

**Fix**: after a successful link, refresh the session (or let the next natural refresh happen) so the new token carries `is_anonymous: false`. Data access at Level 1 is unaffected in the meantime (the user id never changed).

### 9. Supabase project region is immutable

**Symptom**: latency is poor for your users, or a compliance requirement is unmet, and you cannot change it.

**Fix**: the region is chosen at project creation and **cannot be changed afterwards** — pick it correctly on step one. Moving regions later means creating a new project and migrating data.

## Security Rules (do not skip)

These four rules are the difference between a secure setup and a horizontal-privilege-escalation
+ PII-leak vulnerability.

### S1. The middleware must cryptographically verify the JWT — never trust an unverified token

The `Authorization: Bearer` token is a **client-supplied string**. A client can hand-craft a
base64 `{"sub":"<victim-id>"}` and, if you only base64-decode it, the backend will treat them as
that victim. **Always** verify with `jose` against the Supabase **JWKS** (ES256) or the legacy
**secret** (HS256), checking `issuer` + `audience: "authenticated"` + signature, before trusting
`userId` / `email` / `isAnonymous`. The middleware in this recipe does exactly this.

### S2. Enforce data isolation with RLS + userClient — never hand-write `WHERE owner_id`

For per-user data, always use `userClient(env, accessToken)` so PostgREST runs as that user and
**RLS isolates rows automatically**. Never use the `service_role` client for per-user reads/writes.
Never accept `owner_id` from the client body — inject it server-side from `authUser.userId`.
This double-guards against IDOR: even a bug in a route cannot leak another user's rows, because
the database itself refuses them.

### S3. Never return another user's `userId` / `email` to other clients

Public/list responses (feeds, author cards, leaderboards) must **strip** identifying fields.
RLS protects tables accessed through `userClient`, but any endpoint that uses the `service_role`
client (which bypasses RLS) must filter the output manually. If a client needs to reference
"who created this", expose a non-impersonatable public proxy id, not the raw `auth.users.id`.

### S4. The `service_role` key bypasses ALL RLS — server-side secret only; and writes are allowed at Level 1

Two parts:

1. The `service_role` key bypasses every RLS policy → it must live **only** in a server-side
   secret (Cloudflare Secret / `.dev.vars`), **never** be shipped to the client, and **never** be
   committed to git. A leak = full-database compromise.
2. **Unlike the Cognito recipe, writes ARE permitted at Level 1** (anonymous included), because a
   Supabase anonymous user carries a real, signature-verified JWT and RLS isolates every write by
   `auth.uid()`. Reserve Level 2 (`authMiddleware`) for operations that genuinely require a
   *graduated* (non-anonymous) identity. Do not blanket-force all writes to Level 2 — that would
   break the "anonymous users can use core features immediately" promise this recipe exists to
   deliver.
