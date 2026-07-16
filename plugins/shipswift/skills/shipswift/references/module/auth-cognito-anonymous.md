---
id: auth-cognito-anonymous
title: Anonymous-First Authentication with Cognito Identity Pool
description: Anonymous-first authentication for iOS and macOS apps — users access core features immediately without signing in, with optional sign-up/sign-in (Apple, Google, email) and seamless data migration from anonymous to authenticated accounts. Uses Cognito Identity Pool for unique identity tracking and Hono middleware for three-level access control.
tier: free
tags: [authentication, Cognito, AWS, Identity Pool, anonymous, guest, Apple Sign In, Google Sign In, data migration, middleware, Hono]
---

## What This Solves

Provides anonymous-first authentication for iOS and macOS apps where users can start using core features immediately without creating an account. Every user (anonymous or signed in) gets a unique Identity ID from Cognito Identity Pool, enabling data persistence and optional sign-up later with seamless data migration. The backend uses Hono middleware with three access levels: public, identity-required (anonymous + authenticated), and auth-required (authenticated only).

> **Choosing between auth recipes**: This recipe is for apps that let users try core features
> without signing in first (e.g., utility apps, content apps, freemium tools). If your app
> requires users to sign in before accessing any features, use [auth-cognito](recipe://auth-cognito) instead.

## Architecture

```
iOS App
  SWUserManager (@Observable)
    |--- SWAuthService (actor, Amplify SDK)
    |       |--- fetchIdentityId (Identity Pool, anonymous + authenticated)
    |       |--- signInWithApple / signInWithGoogle (login upgrade)
    |       |--- fetchTokens / refreshSession
    |       |--- fetchUserProfile
    |       |--- signOut / deleteUser
    |
    v
Cognito Identity Pool (core)
    |--- Unauthenticated role --> anonymous Identity ID
    |--- Authenticated role --> linked Identity ID
    |
    v
Cognito User Pool (optional sign-in)
    |--- Apple / Google / Email
    |
    v
App Runner (Hono backend, direct)
    |--- Level 0: Public (no auth)
    |--- Level 1: identityMiddleware (X-Identity-Id)
    |--- Level 2: authMiddleware (Bearer JWT + X-Identity-Id)
    |--- POST /v1/auth/sync (data migration)
```

### Why Anonymous-First?

| Criteria | Anonymous-First | Login-Required |
|----------|----------------|----------------|
| User friction | Zero — instant access | High — must create account first |
| Conversion funnel | Try before committing | Must commit upfront |
| Data persistence | Identity ID tracks anonymous data | Only after account creation |
| Best for | Utility apps, content apps, freemium | Social apps, enterprise tools |
| Complexity | Higher (data migration needed) | Lower (no migration logic) |

## Dependencies

### iOS (Swift Package Manager)

| Package | URL | Products |
|---------|-----|----------|
| Amplify Swift | `https://github.com/aws-amplify/amplify-swift` | `Amplify`, `AWSCognitoAuthPlugin`, `AWSPluginsCore` |

### Backend (npm)

| Package | Purpose |
|---------|---------|
| `hono` | Web framework with middleware support |
| `@hono/zod-validator` | Request validation |
| `jose` | **Required** — verifies the Cognito JWT signature against the JWKS (never trust an unverified token) |
| `aws-cdk-lib` | CDK constructs for Cognito, IAM |

## Implementation

### iOS

The iOS implementation uses `SWUserManager` as the central state manager with `SWAuthService` handling all Amplify SDK interactions.

#### 1. SWUserManager.swift — Session state, auth orchestration, and API request builder

```swift
import Foundation
import SwiftUI
import StoreKit
import Amplify
import AWSCognitoAuthPlugin
import AWSPluginsCore

// MARK: - Session State

/// User session state for anonymous-first authentication
enum SWSessionState: Equatable {
    case loading
    case anonymous(identityId: String)
    case authenticated(identityId: String, tokens: SWAuthTokens, profile: SWUserProfile)
    case error(message: String)

    var isSignedIn: Bool {
        if case .authenticated = self { return true }
        return false
    }

    var isAnonymous: Bool {
        if case .anonymous = self { return true }
        return false
    }

    var isLoading: Bool {
        if case .loading = self { return true }
        return false
    }

    var identityId: String? {
        switch self {
        case .anonymous(let id): return id
        case .authenticated(let id, _, _): return id
        default: return nil
        }
    }

    var tokens: SWAuthTokens? {
        if case .authenticated(_, let tokens, _) = self { return tokens }
        return nil
    }

    var profile: SWUserProfile? {
        if case .authenticated(_, _, let profile) = self { return profile }
        return nil
    }

    /// Display name: prefer user name > email > Identity ID
    var displayName: String? {
        if case .authenticated(let identityId, _, let profile) = self {
            return profile.displayName ?? identityId
        }
        return identityId
    }

    var errorMessage: String? {
        if case .error(let message) = self { return message }
        return nil
    }
}

// MARK: - Auth Tokens

/// Authentication tokens from Cognito
struct SWAuthTokens: Equatable {
    let idToken: String
    let accessToken: String
    let refreshToken: String
}

// MARK: - User Profile

/// User profile from Cognito user attributes
struct SWUserProfile: Equatable {
    let name: String?
    let email: String?

    /// Display name: prefer user name > email > nil
    var displayName: String? {
        if let name = name, !name.isEmpty { return name }
        if let email = email, !email.isEmpty { return email }
        return nil
    }
}

// MARK: - Service Error

/// Service error types
enum SWServiceError: LocalizedError {
    case notSignedIn
    case tokenMissing
    case invalidURL
    case networkError
    case unauthorized
    case serverError(Int)
    case timeout
    case userProfileNotFound
    case userAlreadyExists
    case validationError(String)
    case decodingError
    case encodingError
    case invalidResponse
    case invalidState
    case unknown(String)

    var errorDescription: String? {
        switch self {
        case .notSignedIn: return "Not signed in"
        case .tokenMissing: return "Session expired, please sign in again"
        case .invalidURL: return "Invalid URL"
        case .networkError: return "Network connection failed"
        case .unauthorized: return "Session expired, please sign in again"
        case .serverError(let code): return "Server error (\(code))"
        case .timeout: return "Request timed out, please try again"
        case .userProfileNotFound: return "User profile not found"
        case .userAlreadyExists: return "User already exists"
        case .validationError(let message): return "Validation failed: \(message)"
        case .decodingError: return "Data parsing error"
        case .encodingError: return "Data encoding error"
        case .invalidResponse: return "Invalid response"
        case .invalidState: return "Invalid state"
        case .unknown(let message): return message
        }
    }
}

// MARK: - User Manager

@MainActor
@Observable
final class SWUserManager {

    // MARK: - Storage Keys

    private enum StorageKey: String {
        case isFirstLaunch
        case appLaunchCount
        case actionCompletedCount
        case lastReviewRequestDate
        case hasRequestedReview
        case previousIdentityId   // Saved before login for data migration
    }

    // MARK: - Review Request Configuration

    private enum ReviewConfig {
        static let minActions = 2
        static let minLaunches = 3
        static let daysBetweenRequests = 30
        static let delayBeforeRequest: Duration = .seconds(1)
    }

    // MARK: - Properties

    /// User session state
    var sessionState: SWSessionState = .loading

    /// Whether an authentication operation is in progress
    var isAuthenticating = false

    /// Whether this is the first launch (stored property, trackable by @Observable)
    var isFirstLaunch: Bool = false {
        didSet {
            UserDefaults.standard.set(!isFirstLaunch, forKey: StorageKey.isFirstLaunch.rawValue)
        }
    }

    private let authService = SWAuthService.shared

    // Review request related properties
    private var actionCompletedCount: Int {
        get { UserDefaults.standard.integer(forKey: StorageKey.actionCompletedCount.rawValue) }
        set { UserDefaults.standard.set(newValue, forKey: StorageKey.actionCompletedCount.rawValue) }
    }

    private var appLaunchCount: Int {
        get { UserDefaults.standard.integer(forKey: StorageKey.appLaunchCount.rawValue) }
        set { UserDefaults.standard.set(newValue, forKey: StorageKey.appLaunchCount.rawValue) }
    }

    private var hasRequestedReview: Bool {
        get { UserDefaults.standard.bool(forKey: StorageKey.hasRequestedReview.rawValue) }
        set { UserDefaults.standard.set(newValue, forKey: StorageKey.hasRequestedReview.rawValue) }
    }

    private var lastReviewRequestDate: Date? {
        get { UserDefaults.standard.object(forKey: StorageKey.lastReviewRequestDate.rawValue) as? Date }
        set { UserDefaults.standard.set(newValue, forKey: StorageKey.lastReviewRequestDate.rawValue) }
    }

    // MARK: - Initialization

    init() {
        self.isFirstLaunch = !UserDefaults.standard.bool(forKey: StorageKey.isFirstLaunch.rawValue)
        appLaunchCount += 1

        Task {
            await initializeAuth()
        }
    }

    /// Preview-only initializer (skips auto-auth)
    private init(previewState: SWSessionState) {
        self.isFirstLaunch = false
        self.sessionState = previewState
    }

    /// Create a preview instance with a specific state
    static func preview(state: SWSessionState) -> SWUserManager {
        SWUserManager(previewState: state)
    }

    // MARK: - Public Methods

    func completeFirstLaunch() {
        isFirstLaunch = false
    }

    // MARK: - Auth Initialization (Anonymous-First)

    /// Initialize authentication — automatically fetch Identity ID.
    /// On first install, Cognito Identity Pool may fail due to network timing,
    /// so we retry up to 3 times with exponential backoff (1s / 2s / 4s).
    func initializeAuth() async {
        sessionState = .loading

        let maxRetries = 3
        let baseDelay: UInt64 = 1_000_000_000 // 1 second in nanoseconds

        for attempt in 1...maxRetries {
            do {
                // Check if user is already signed in
                let isSignedIn = await authService.isSignedIn()

                if isSignedIn {
                    // Authenticated user — fetch tokens, identity, and profile
                    let tokens = try await authService.fetchTokens()
                    let identityId = try await authService.fetchIdentityId()
                    let profile = await authService.fetchUserProfile()
                    sessionState = .authenticated(
                        identityId: identityId, tokens: tokens, profile: profile
                    )
                } else {
                    // Anonymous user — fetch Identity ID from Identity Pool
                    let identityId = try await authService.fetchIdentityId()
                    sessionState = .anonymous(identityId: identityId)
                }
                return // Success, no more retries

            } catch {
                if attempt == maxRetries {
                    sessionState = .error(message: "Initialization failed")
                } else {
                    // Exponential backoff: 1s, 2s, 4s
                    let delay = baseDelay * UInt64(1 << (attempt - 1))
                    try? await Task.sleep(nanoseconds: delay)
                }
            }
        }
    }

    // MARK: - Social Sign In

    /// Apple Sign In — saves previousIdentityId for data migration
    func signInWithApple() async throws {
        guard let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
              let window = windowScene.windows.first else {
            throw SWServiceError.unknown("Cannot get window")
        }

        // Save current anonymous Identity ID before login
        let previousIdentityId = sessionState.identityId
        if let prevId = previousIdentityId {
            UserDefaults.standard.set(prevId, forKey: StorageKey.previousIdentityId.rawValue)
        }

        isAuthenticating = true
        defer { isAuthenticating = false }

        let tokens = try await authService.signInWithApple(presentationAnchor: window)
        let identityId = try await authService.fetchIdentityId()
        let profile = await authService.fetchUserProfile()

        sessionState = .authenticated(
            identityId: identityId, tokens: tokens, profile: profile
        )
    }

    /// Google Sign In — saves previousIdentityId for data migration
    func signInWithGoogle() async throws {
        guard let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
              let window = windowScene.windows.first else {
            throw SWServiceError.unknown("Cannot get window")
        }

        let previousIdentityId = sessionState.identityId
        if let prevId = previousIdentityId {
            UserDefaults.standard.set(prevId, forKey: StorageKey.previousIdentityId.rawValue)
        }

        isAuthenticating = true
        defer { isAuthenticating = false }

        let tokens = try await authService.signInWithGoogle(presentationAnchor: window)
        let identityId = try await authService.fetchIdentityId()
        let profile = await authService.fetchUserProfile()

        sessionState = .authenticated(
            identityId: identityId, tokens: tokens, profile: profile
        )
    }

    /// Consume the saved previous Identity ID (one-time use for data migration).
    /// Call this after sign-in when sending the sync request to the backend.
    func consumePreviousIdentityId() -> String? {
        let key = StorageKey.previousIdentityId.rawValue
        let previousId = UserDefaults.standard.string(forKey: key)
        UserDefaults.standard.removeObject(forKey: key)
        return previousId
    }

    // MARK: - Sign Out / Delete Account

    /// Sign out — returns to anonymous state with a new Identity ID
    func signOut() async {
        await authService.signOut()

        // Re-fetch anonymous Identity ID
        do {
            let identityId = try await authService.fetchIdentityId()
            sessionState = .anonymous(identityId: identityId)
        } catch {
            sessionState = .error(message: "Failed to restore anonymous session")
        }
    }

    /// Delete account — removes Cognito user and returns to anonymous state
    func deleteAccount() async throws {
        try await authService.deleteUser()

        do {
            let identityId = try await authService.fetchIdentityId()
            sessionState = .anonymous(identityId: identityId)
        } catch {
            sessionState = .error(message: "Failed to restore anonymous session")
        }
    }

    // MARK: - Token Management

    /// Get the latest ID Token (automatically refreshes expired tokens).
    ///
    /// Important: Use this method to get token before each API call,
    /// instead of directly using the cached `sessionState.tokens?.idToken`.
    ///
    /// How it works:
    /// 1. Calls `authService.fetchTokens()` -> `Amplify.Auth.fetchAuthSession()`
    /// 2. SDK automatically checks if ID Token is expired (default 1 hour)
    /// 3. If expired, SDK uses Refresh Token to obtain a new ID Token
    /// 4. Also updates the cached tokens in sessionState
    ///
    /// Returns nil when:
    /// - User is not signed in (anonymous users should not call this)
    /// - Refresh Token expired (30 days of inactivity), requires re-sign-in
    func getFreshIdToken() async -> String? {
        guard sessionState.isSignedIn else { return nil }

        do {
            let tokens = try await authService.fetchTokens()

            // Update cached tokens
            if let identityId = sessionState.identityId,
               let profile = sessionState.profile {
                sessionState = .authenticated(
                    identityId: identityId, tokens: tokens, profile: profile
                )
            }

            return tokens.idToken
        } catch {
            return nil
        }
    }

    // MARK: - Review Request

    /// Record completed action count
    func incrementActionCompletedCount() {
        actionCompletedCount += 1
        requestReviewIfAppropriate()
    }

    /// Call after user completes a positive action
    func recordPositiveUserAction() {
        requestReviewIfAppropriate()
    }

    private func requestReviewIfAppropriate() {
        guard shouldRequestReview() else { return }

        Task {
            try? await Task.sleep(for: ReviewConfig.delayBeforeRequest)
            await requestReview()
        }
    }

    private func shouldRequestReview() -> Bool {
        if hasRequestedReview, let lastDate = lastReviewRequestDate {
            let daysSinceLastRequest = Calendar.current.dateComponents(
                [.day], from: lastDate, to: .now
            ).day ?? 0

            guard daysSinceLastRequest >= ReviewConfig.daysBetweenRequests else {
                return false
            }
        }

        return actionCompletedCount >= ReviewConfig.minActions
            && appLaunchCount >= ReviewConfig.minLaunches
    }

    private func requestReview() async {
        guard let scene = UIApplication.shared.connectedScenes
            .first(where: { $0.activationState == .foregroundActive }) as? UIWindowScene
        else { return }

        AppStore.requestReview(in: scene)
        hasRequestedReview = true
        lastReviewRequestDate = .now
    }
}

// MARK: - Auth Service

/// Authentication service — wraps Amplify SDK for Identity Pool + User Pool
actor SWAuthService {
    static let shared = SWAuthService()

    private init() {}

    // MARK: - Identity Pool (Anonymous Identity)

    /// Fetch Identity ID from Cognito Identity Pool.
    /// Works for both anonymous and authenticated users.
    func fetchIdentityId() async throws -> String {
        let session = try await Amplify.Auth.fetchAuthSession()

        guard let cognitoSession = session as? AWSAuthCognitoSession else {
            throw SWServiceError.invalidState
        }

        switch cognitoSession.getIdentityId() {
        case .success(let identityId):
            return identityId
        case .failure(let error):
            throw error
        }
    }

    // MARK: - Social Sign In

    /// Apple Sign In via Hosted UI
    func signInWithApple(presentationAnchor: AuthUIPresentationAnchor) async throws -> SWAuthTokens {
        // If already signed in, sign out first to avoid stale session
        if await isSignedIn() {
            await signOut()
        }

        // preferPrivateSession: true skips the "wants to use amazoncognito.com" browser prompt
        let pluginOptions = AWSAuthWebUISignInOptions(preferPrivateSession: true)
        let options = AuthWebUISignInRequest.Options(pluginOptions: pluginOptions)

        let result = try await Amplify.Auth.signInWithWebUI(
            for: .apple,
            presentationAnchor: presentationAnchor,
            options: options
        )

        guard result.isSignedIn else {
            throw SWServiceError.notSignedIn
        }

        return try await fetchTokens()
    }

    /// Google Sign In via Hosted UI
    func signInWithGoogle(presentationAnchor: AuthUIPresentationAnchor) async throws -> SWAuthTokens {
        if await isSignedIn() {
            await signOut()
        }

        let pluginOptions = AWSAuthWebUISignInOptions(preferPrivateSession: true)
        let options = AuthWebUISignInRequest.Options(pluginOptions: pluginOptions)

        let result = try await Amplify.Auth.signInWithWebUI(
            for: .google,
            presentationAnchor: presentationAnchor,
            options: options
        )

        guard result.isSignedIn else {
            throw SWServiceError.notSignedIn
        }

        return try await fetchTokens()
    }

    // MARK: - Token Management

    /// Fetch current tokens (auto-refreshes if expired)
    func fetchTokens() async throws -> SWAuthTokens {
        let session = try await Amplify.Auth.fetchAuthSession()

        guard let cognitoSession = session as? AWSAuthCognitoSession else {
            throw SWServiceError.tokenMissing
        }

        switch cognitoSession.getCognitoTokens() {
        case .success(let tokens):
            return SWAuthTokens(
                idToken: tokens.idToken,
                accessToken: tokens.accessToken,
                refreshToken: tokens.refreshToken
            )
        case .failure:
            throw SWServiceError.tokenMissing
        }
    }

    /// Force-refresh tokens
    func refreshSession() async throws -> SWAuthTokens {
        let session = try await Amplify.Auth.fetchAuthSession(options: .forceRefresh())

        guard let cognitoSession = session as? AWSAuthCognitoSession else {
            throw SWServiceError.tokenMissing
        }

        switch cognitoSession.getCognitoTokens() {
        case .success(let tokens):
            return SWAuthTokens(
                idToken: tokens.idToken,
                accessToken: tokens.accessToken,
                refreshToken: tokens.refreshToken
            )
        case .failure:
            throw SWServiceError.tokenMissing
        }
    }

    // MARK: - User Attributes

    /// Fetch user profile (name, email) from Cognito user attributes
    func fetchUserProfile() async -> SWUserProfile {
        do {
            let attributes = try await Amplify.Auth.fetchUserAttributes()
            var name: String?
            var email: String?

            for attribute in attributes {
                switch attribute.key {
                case .name, .givenName, .familyName:
                    if name == nil || name?.isEmpty == true {
                        name = attribute.value
                    }
                case .email:
                    email = attribute.value
                default:
                    break
                }
            }

            return SWUserProfile(name: name, email: email)
        } catch {
            return SWUserProfile(name: nil, email: nil)
        }
    }

    // MARK: - Sign Out / Delete Account

    /// Sign out
    func signOut() async {
        _ = await Amplify.Auth.signOut()
    }

    /// Delete user account
    func deleteUser() async throws {
        try await Amplify.Auth.deleteUser()
    }

    /// Check sign-in status
    func isSignedIn() async -> Bool {
        do {
            let session = try await Amplify.Auth.fetchAuthSession()
            return session.isSignedIn
        } catch {
            return false
        }
    }
}

// MARK: - API Request Builder

/// Builds URLRequests with the appropriate auth headers based on session state.
///
/// - Anonymous users: sends `X-Identity-Id` header (Level 1 access)
/// - Authenticated users: sends `Authorization: Bearer` + `X-Identity-Id` (Level 2 access)
struct SWAPIRequestBuilder {

    private let baseURL: String
    private let userManager: SWUserManager

    init(baseURL: String, userManager: SWUserManager) {
        self.baseURL = baseURL
        self.userManager = userManager
    }

    /// Build a request for identity-level access (anonymous + authenticated).
    /// Returns nil if Identity ID is not available.
    ///
    /// Uses cached token for simplicity. For guaranteed-fresh tokens,
    /// use `buildAuthRequest()` instead.
    func buildIdentityRequest(path: String, method: String = "GET") -> URLRequest? {
        guard let identityId = userManager.sessionState.identityId,
              !identityId.isEmpty,
              let url = URL(string: "\(baseURL)\(path)") else {
            return nil
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue(identityId, forHTTPHeaderField: "X-Identity-Id")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        // If authenticated, also include cached Bearer token
        if let idToken = userManager.sessionState.tokens?.idToken {
            request.setValue("Bearer \(idToken)", forHTTPHeaderField: "Authorization")
        }

        return request
    }

    /// Build a request for auth-level access (authenticated only).
    /// Returns nil if user is not signed in.
    func buildAuthRequest(path: String, method: String = "GET") async -> URLRequest? {
        guard let identityId = userManager.sessionState.identityId,
              !identityId.isEmpty,
              let idToken = await userManager.getFreshIdToken(),
              let url = URL(string: "\(baseURL)\(path)") else {
            return nil
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue(identityId, forHTTPHeaderField: "X-Identity-Id")
        request.setValue("Bearer \(idToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        return request
    }
}

// MARK: - Debug Log

nonisolated func swDebugLog(_ items: Any...) {
    #if DEBUG
    print(items.map { String(describing: $0) }.joined(separator: " "))
    #endif
}
```

#### 2. App.swift — Amplify initialization and auth-driven navigation

```swift
import SwiftUI
import Amplify
import AWSCognitoAuthPlugin

@main
struct MyApp: App {
    @State private var userManager = SWUserManager()

    init() {
        do {
            try Amplify.add(plugin: AWSCognitoAuthPlugin())
            try Amplify.configure()
        } catch {
            fatalError("Amplify configuration failed: \(error)")
        }
    }

    var body: some Scene {
        WindowGroup {
            Group {
                switch userManager.sessionState {
                case .loading:
                    ProgressView("Initializing...")

                case .anonymous:
                    // Anonymous users can use core features immediately
                    MainView()

                case .authenticated:
                    // Authenticated users get full features
                    MainView()

                case .error(let message):
                    SWAuthErrorView(message: message) {
                        Task { await userManager.initializeAuth() }
                    }
                }
            }
            .environment(userManager)
            .onChange(of: userManager.sessionState) { oldState, newState in
                // Clear caches when signing out
                if oldState.isSignedIn, !newState.isSignedIn {
                    clearAllCaches()
                }
                // Sync user data after sign-in
                if !oldState.isSignedIn, newState.isSignedIn {
                    Task { await syncAfterSignIn() }
                }
            }
        }
    }

    /// Call POST /v1/auth/sync after sign-in to migrate anonymous data
    private func syncAfterSignIn() async {
        guard let identityId = userManager.sessionState.identityId,
              let idToken = await userManager.getFreshIdToken() else { return }

        let previousIdentityId = userManager.consumePreviousIdentityId()

        // TODO: Uncomment and implement your sync service to migrate anonymous data
        // await authSyncService.sync(
        //     idToken: idToken,
        //     identityId: identityId,
        //     previousIdentityId: previousIdentityId
        // )
    }

    private func clearAllCaches() {
        // Reset your data managers here
    }
}

/// Error view with retry button, shown when auth initialization fails
struct SWAuthErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "wifi.exclamationmark")
                .font(.system(size: 48))
                .foregroundStyle(.secondary)

            Text("Connection Issue")
                .font(.title2)
                .fontWeight(.semibold)

            Text(message)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)

            Button("Try Again", action: onRetry)
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
        }
        .padding()
    }
}
```

#### 3. amplifyconfiguration.json — Must include CredentialsProvider

Place this file in your Xcode project (add to target). The `CredentialsProvider` section is **required** for Identity Pool to work.

```json
{
  "auth": {
    "plugins": {
      "awsCognitoAuthPlugin": {
        "CognitoUserPool": {
          "Default": {
            "PoolId": "us-east-1_XXXXXXXX",
            "AppClientId": "xxxxxxxxxxxxxxxxxxxxxxxxxx",
            "Region": "us-east-1"
          }
        },
        "CredentialsProvider": {
          "CognitoIdentity": {
            "Default": {
              "PoolId": "us-east-1:xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
              "Region": "us-east-1"
            }
          }
        },
        "Auth": {
          "Default": {
            "OAuth": {
              "WebDomain": "myapp-auth.auth.us-east-1.amazoncognito.com",
              "AppClientId": "xxxxxxxxxxxxxxxxxxxxxxxxxx",
              "SignInRedirectURI": "myapp://callback",
              "SignOutRedirectURI": "myapp://signout",
              "Scopes": [
                "email",
                "openid",
                "profile",
                "aws.cognito.signin.user.admin"
              ]
            },
            "authenticationFlowType": "USER_SRP_AUTH"
          }
        }
      }
    }
  }
}
```

> **Critical**: Without the `CredentialsProvider` section, `fetchIdentityId()` will fail silently. This is the #1 cause of "Identity Pool not working" issues.

### Backend

#### 1. src/middleware/auth.ts — Three-level access control

> **SECURITY — read this first**: The `Authorization: Bearer <jwt>` token **must** be
> cryptographically verified (signature + issuer + audience) before you trust any claim
> inside it. Never `base64`-decode a JWT and trust its `sub`/`email` — a client can forge
> `{"sub":"<someone-else's-id>"}` trivially and impersonate other users (horizontal
> privilege escalation + PII leak). The middleware below uses `jose` +
> `createRemoteJWKSet` + `jwtVerify` to do real verification against the Cognito JWKS.

```typescript
/**
 * Authentication middleware — three access levels:
 *
 * Level 0: Public routes (no middleware)
 * Level 1: identityMiddleware — requires X-Identity-Id header (anonymous + authenticated)
 * Level 2: authMiddleware — requires a CRYPTOGRAPHICALLY VERIFIED Bearer JWT
 *          (authenticated only). All write operations must go through Level 2.
 *
 * Why real verification (jose) instead of base64-decoding the JWT:
 *   X-Identity-Id and an unverified JWT payload are both client-supplied strings.
 *   Trusting them lets any client claim any cognitoSub/identityId. We therefore
 *   verify the JWT signature against the Cognito JWKS and only trust cognitoSub
 *   AFTER verification succeeds.
 */

import type { Context, MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import * as jose from "jose";

/**
 * Identity context — available after identityMiddleware
 */
export interface IdentityContext {
  identityId: string;   // Cognito Identity ID (all users)
  cognitoSub?: string;  // Cognito sub — ONLY set after the JWT signature is verified
  email?: string;       // User email (from the verified JWT only)
}

/**
 * Extend Hono context with identity
 */
declare module "hono" {
  interface ContextVariableMap {
    identity: IdentityContext;
  }
}

// ---------------------------------------------------------------------------
// Cognito JWT verification (jose + remote JWKS)
// ---------------------------------------------------------------------------

// Remote JWKS — jose caches the keys and refreshes them automatically.
let jwks: ReturnType<typeof jose.createRemoteJWKSet> | null = null;

function getJwks(): ReturnType<typeof jose.createRemoteJWKSet> {
  if (!jwks) {
    const userPoolId = process.env.COGNITO_USER_POOL_ID;
    if (!userPoolId) throw new Error("COGNITO_USER_POOL_ID is not set");
    const region = process.env.AWS_REGION || "us-east-1";
    const jwksUrl = `https://cognito-idp.${region}.amazonaws.com/${userPoolId}/.well-known/jwks.json`;
    jwks = jose.createRemoteJWKSet(new URL(jwksUrl));
  }
  return jwks;
}

/**
 * Verify a Cognito ID Token: signature (via JWKS) + issuer + audience.
 * Returns the verified { cognitoSub, email } or null if the token is invalid.
 * NEVER trust the JWT payload without going through this function.
 */
async function verifyCognitoJwt(
  token: string
): Promise<{ cognitoSub: string; email?: string } | null> {
  const userPoolId = process.env.COGNITO_USER_POOL_ID;
  const clientId = process.env.COGNITO_CLIENT_ID;
  if (!userPoolId || !clientId) {
    // Fail closed: if the server is misconfigured, do not trust any token.
    throw new HTTPException(500, { message: "Server authentication not configured" });
  }

  try {
    const region = process.env.AWS_REGION || "us-east-1";
    const issuer = `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`;
    const { payload } = await jose.jwtVerify(token, getJwks(), {
      issuer,
      audience: clientId, // ID Token aud == App Client ID
    });
    const sub = payload.sub;
    if (!sub || typeof sub !== "string") return null;
    return {
      cognitoSub: sub,
      email: typeof payload.email === "string" ? payload.email : undefined,
    };
  } catch {
    // Expired / wrong issuer / wrong audience / bad signature → not authenticated.
    return null;
  }
}

/**
 * Extract identity from request headers.
 * The JWT (if present) is cryptographically verified before cognitoSub is trusted.
 */
async function extractIdentity(c: Context): Promise<IdentityContext | null> {
  const identityId = c.req.header("x-identity-id");
  if (!identityId) return null;

  // Verify the JWT from the Authorization header (authenticated users)
  const authHeader = c.req.header("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    const verified = await verifyCognitoJwt(token);
    if (verified) {
      return {
        identityId,
        cognitoSub: verified.cognitoSub,
        email: verified.email,
      };
    }
    // Token present but invalid → treat as anonymous (identity only).
    // A Level-2 route will then reject it because cognitoSub is missing.
  }

  // Anonymous user (identity only, no valid JWT)
  return { identityId };
}

/**
 * Level 1: Identity middleware — anonymous + authenticated users.
 * Requires X-Identity-Id header. Use for read-only routes accessible to all users.
 */
export const identityMiddleware: MiddlewareHandler = async (c, next) => {
  const identity = await extractIdentity(c);
  if (!identity) {
    throw new HTTPException(401, { message: "Identity ID required" });
  }
  c.set("identity", identity);
  await next();
};

/**
 * Level 2: Auth middleware — authenticated users only.
 * Requires a verified Bearer JWT. ALL write operations (POST/PUT/PATCH/DELETE)
 * should be protected by this middleware; the anonymous (Level 1) layer is read-only.
 */
export const authMiddleware: MiddlewareHandler = async (c, next) => {
  const identity = await extractIdentity(c);
  if (!identity) {
    throw new HTTPException(401, { message: "Identity ID required" });
  }
  if (!identity.cognitoSub) {
    throw new HTTPException(401, { message: "Authentication required" });
  }
  c.set("identity", identity);
  await next();
};

/**
 * Get current identity (guaranteed non-null after identityMiddleware or authMiddleware)
 */
export function getIdentity(c: Context): IdentityContext {
  const identity = c.get("identity");
  if (!identity) {
    throw new HTTPException(401, { message: "Identity ID required" });
  }
  return identity;
}

/**
 * Require authenticated identity (throws if user is anonymous or JWT was not verified)
 */
export function requireAuth(c: Context): IdentityContext & { cognitoSub: string } {
  const identity = getIdentity(c);
  if (!identity.cognitoSub) {
    throw new HTTPException(401, { message: "Authentication required" });
  }
  return identity as IdentityContext & { cognitoSub: string };
}
```

> **Note**: `extractIdentity` / `identityMiddleware` / `authMiddleware` are now `async`
> because JWKS verification is async. The route registration in `server.ts` is unchanged
> (Hono awaits async middleware automatically). Set `COGNITO_USER_POOL_ID`,
> `COGNITO_CLIENT_ID` and `AWS_REGION` in your backend environment.

#### 2. src/routes/auth.ts — POST /sync (data migration)

```typescript
import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { authMiddleware, getIdentity } from "../middleware/auth";
import { db } from "../db";
import { users } from "../db/schema";
import { eq, and } from "drizzle-orm";

const auth = new Hono();

const syncSchema = z.object({
  identityId: z.string().min(1),
  previousIdentityId: z.string().optional(),
});

/**
 * POST /v1/auth/sync — Called after sign-in to sync/migrate user data.
 *
 * 1. Finds or creates a user record by cognitoSub
 * 2. Updates the Identity ID (changes after anonymous -> authenticated)
 * 3. If previousIdentityId is provided, migrates anonymous user data
 */
auth.post(
  "/sync",
  authMiddleware,
  zValidator("json", syncSchema),
  async (c) => {
    const { cognitoSub, email } = getIdentity(c) as { cognitoSub: string; email?: string };
    const { identityId, previousIdentityId } = c.req.valid("json");

    // Find existing user by Cognito sub
    const existingUser = await db
      .select()
      .from(users)
      .where(eq(users.cognitoSub, cognitoSub))
      .limit(1);

    if (existingUser.length > 0) {
      // Update identity ID and email
      await db
        .update(users)
        .set({ identityId, email: email ?? undefined, updatedAt: new Date() })
        .where(eq(users.id, existingUser[0]!.id));

      // Migrate anonymous data if applicable
      if (previousIdentityId && previousIdentityId !== identityId) {
        await migrateAnonymousData(previousIdentityId, existingUser[0]!.id);
      }

      return c.json({ userId: existingUser[0]!.id });
    }

    // Create new user
    const [newUser] = await db
      .insert(users)
      .values({
        cognitoSub,
        identityId,
        isGuest: false,
        email: email ?? null,
      })
      .returning();

    // Migrate anonymous data if applicable
    if (previousIdentityId && previousIdentityId !== identityId) {
      await migrateAnonymousData(previousIdentityId, newUser!.id);
    }

    return c.json({ userId: newUser!.id });
  }
);

/**
 * Migrate data from anonymous user to authenticated user.
 * Customize this function to migrate your app-specific tables.
 */
async function migrateAnonymousData(previousIdentityId: string, targetUserId: string) {
  const guestUser = await db
    .select()
    .from(users)
    .where(and(eq(users.identityId, previousIdentityId), eq(users.isGuest, true)))
    .limit(1);

  if (guestUser.length === 0) return;

  const guestUserId = guestUser[0]!.id;

  // TODO: Migrate your app-specific tables here
  // Example:
  // await db.update(reports).set({ userId: targetUserId }).where(eq(reports.userId, guestUserId));
  // await db.update(favorites).set({ userId: targetUserId }).where(eq(favorites.userId, guestUserId));

  // Delete the anonymous user record
  await db.delete(users).where(eq(users.id, guestUserId));
}

export default auth;
```

#### 3. src/db/schema.ts — Users table

```typescript
import { pgTable, uuid, varchar, boolean, timestamp } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  cognitoSub: varchar("cognito_sub", { length: 255 }).unique(), // Only authenticated users
  identityId: varchar("identity_id", { length: 255 }).notNull().unique(),
  isGuest: boolean("is_guest").notNull().default(true),
  email: varchar("email", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Other tables should reference users.id as foreign key, NOT identityId.
// identityId changes when a user transitions from anonymous to authenticated.
//
// Example:
// export const reports = pgTable("reports", {
//   id: uuid("id").primaryKey().defaultRandom(),
//   userId: uuid("user_id").notNull().references(() => users.id),
//   ...
// });
```

#### 4. src/server.ts — Route registration example

```typescript
import { Hono } from "hono";
import { identityMiddleware } from "./middleware/auth";
import authRoutes from "./routes/auth";

const app = new Hono();

// Health check (Level 0: public)
app.get("/health", (c) => c.json({ status: "ok" }));

// Auth routes
app.route("/v1/auth", authRoutes);

// Example: routes accessible to all users including anonymous (Level 1)
// app.use("/v1/scans/*", identityMiddleware);

// Example: routes requiring authentication (Level 2)
// app.use("/v1/chat/*", authMiddleware);

export default app;
```

### CDK Infrastructure

#### CognitoConstruct — Identity Pool (core) + User Pool

```typescript
import * as cdk from "aws-cdk-lib";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as iam from "aws-cdk-lib/aws-iam";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";

export interface CognitoConstructProps {
  /** Cognito domain prefix (must be globally unique) */
  domainPrefix: string;
  /** iOS app URL scheme for OAuth callbacks */
  iosCallbackScheme: string;
  /** Enable Apple Sign In */
  enableSocialLogin?: boolean;
  /** Apple private key Secret */
  applePrivateKeySecret?: secretsmanager.ISecret;
  /** Apple configuration */
  appleClientId?: string;
  appleTeamId?: string;
  appleKeyId?: string;
  /** Google configuration */
  googleClientId?: string;
  googleClientSecretKey?: string;
  appSecret?: secretsmanager.Secret;
}

export class CognitoConstruct extends Construct {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly userPoolDomain: cognito.UserPoolDomain;
  public readonly identityPool: cognito.CfnIdentityPool;
  public readonly identityPoolAuthRole: iam.Role;
  public readonly identityPoolUnauthRole: iam.Role;

  constructor(scope: Construct, id: string, props: CognitoConstructProps) {
    super(scope, id);

    // ========================================
    // User Pool (for optional sign-in)
    // ========================================
    this.userPool = new cognito.UserPool(this, "UserPool", {
      userPoolName: "my-app-user-pool",
      selfSignUpEnabled: true,

      // IMPORTANT: signInAliases cannot be changed after creation!
      signInAliases: {
        email: true,
        phone: false,
        username: false,
      },

      autoVerify: { email: true },

      standardAttributes: {
        email: { required: true, mutable: true },
        fullname: { required: false, mutable: true },
      },

      passwordPolicy: {
        minLength: 8,
        requireLowercase: false,
        requireUppercase: false,
        requireDigits: false,
        requireSymbols: false,
      },

      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      deletionProtection: false,
    });

    // ========================================
    // Cognito Domain (required for OAuth)
    // ========================================
    this.userPoolDomain = this.userPool.addDomain("Domain", {
      cognitoDomain: {
        domainPrefix: props.domainPrefix,
      },
    });

    // ========================================
    // Identity Providers (optional)
    // ========================================
    const identityProviders: cognito.UserPoolClientIdentityProvider[] = [];
    let appleProvider: cognito.UserPoolIdentityProviderApple | undefined;
    let googleProvider: cognito.UserPoolIdentityProviderGoogle | undefined;

    if (
      props.enableSocialLogin &&
      props.applePrivateKeySecret &&
      props.appleClientId &&
      props.appleTeamId &&
      props.appleKeyId
    ) {
      appleProvider = new cognito.UserPoolIdentityProviderApple(this, "AppleIdp", {
        userPool: this.userPool,
        clientId: props.appleClientId,
        teamId: props.appleTeamId,
        keyId: props.appleKeyId,
        privateKeyValue: props.applePrivateKeySecret.secretValue,
        scopes: ["email", "name"],
        attributeMapping: {
          email: cognito.ProviderAttribute.APPLE_EMAIL,
          fullname: cognito.ProviderAttribute.APPLE_NAME,
        },
      });
      identityProviders.push(
        cognito.UserPoolClientIdentityProvider.custom("SignInWithApple")
      );
    }

    if (
      props.enableSocialLogin &&
      props.googleClientId &&
      props.appSecret &&
      props.googleClientSecretKey
    ) {
      googleProvider = new cognito.UserPoolIdentityProviderGoogle(this, "GoogleIdp", {
        userPool: this.userPool,
        clientId: props.googleClientId,
        clientSecretValue: props.appSecret.secretValueFromJson(props.googleClientSecretKey),
        scopes: ["email", "profile", "openid"],
        attributeMapping: {
          email: cognito.ProviderAttribute.GOOGLE_EMAIL,
          fullname: cognito.ProviderAttribute.GOOGLE_NAME,
        },
      });
      identityProviders.push(
        cognito.UserPoolClientIdentityProvider.custom("Google")
      );
    }

    // ========================================
    // App Client (iOS)
    // ========================================
    this.userPoolClient = this.userPool.addClient("IOSClient", {
      userPoolClientName: "my-app-ios-client",
      generateSecret: false,

      accessTokenValidity: cdk.Duration.hours(1),
      idTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(30),

      enableTokenRevocation: true,
      preventUserExistenceErrors: true,

      supportedIdentityProviders:
        identityProviders.length > 0 ? identityProviders : undefined,

      authFlows: {
        userPassword: true,
        userSrp: true,
      },

      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.PROFILE,
          cognito.OAuthScope.COGNITO_ADMIN, // Required for account deletion
        ],
        callbackUrls: [`${props.iosCallbackScheme}://callback`],
        logoutUrls: [`${props.iosCallbackScheme}://signout`],
      },
    });

    // Ensure App Client is created after Identity Providers
    if (appleProvider) this.userPoolClient.node.addDependency(appleProvider);
    if (googleProvider) this.userPoolClient.node.addDependency(googleProvider);

    // ========================================
    // Identity Pool (core — anonymous access)
    // ========================================
    this.identityPool = new cognito.CfnIdentityPool(this, "IdentityPool", {
      identityPoolName: "my-app-identity-pool",
      allowUnauthenticatedIdentities: true, // Enable anonymous users

      cognitoIdentityProviders: [
        {
          clientId: this.userPoolClient.userPoolClientId,
          providerName: this.userPool.userPoolProviderName,
        },
      ],
    });

    // Anonymous user IAM role (minimal permissions)
    this.identityPoolUnauthRole = new iam.Role(this, "CognitoUnauthRole", {
      assumedBy: new iam.FederatedPrincipal(
        "cognito-identity.amazonaws.com",
        {
          StringEquals: {
            "cognito-identity.amazonaws.com:aud": this.identityPool.ref,
          },
          "ForAnyValue:StringLike": {
            "cognito-identity.amazonaws.com:amr": "unauthenticated",
          },
        },
        "sts:AssumeRoleWithWebIdentity"
      ),
    });

    // Authenticated user IAM role
    this.identityPoolAuthRole = new iam.Role(this, "CognitoAuthRole", {
      assumedBy: new iam.FederatedPrincipal(
        "cognito-identity.amazonaws.com",
        {
          StringEquals: {
            "cognito-identity.amazonaws.com:aud": this.identityPool.ref,
          },
          "ForAnyValue:StringLike": {
            "cognito-identity.amazonaws.com:amr": "authenticated",
          },
        },
        "sts:AssumeRoleWithWebIdentity"
      ),
    });

    // Bind roles to Identity Pool
    new cognito.CfnIdentityPoolRoleAttachment(this, "IdentityPoolRoleAttachment", {
      identityPoolId: this.identityPool.ref,
      roles: {
        unauthenticated: this.identityPoolUnauthRole.roleArn,
        authenticated: this.identityPoolAuthRole.roleArn,
      },
    });

    // ========================================
    // Outputs
    // ========================================
    new cdk.CfnOutput(this, "IdentityPoolId", {
      value: this.identityPool.ref,
      description: "Cognito Identity Pool ID",
    });

    new cdk.CfnOutput(this, "UserPoolId", {
      value: this.userPool.userPoolId,
      description: "Cognito User Pool ID",
    });

    new cdk.CfnOutput(this, "UserPoolClientId", {
      value: this.userPoolClient.userPoolClientId,
      description: "Cognito User Pool Client ID",
    });

    new cdk.CfnOutput(this, "CognitoDomainUrl", {
      value: `https://${this.userPoolDomain.domainName}.auth.${cdk.Stack.of(this).region}.amazoncognito.com`,
      description: "Cognito Hosted UI URL",
    });
  }
}
```

#### Stack assembly example

```typescript
import * as cdk from "aws-cdk-lib";
import { CognitoConstruct } from "./constructs/cognito-construct";
// import { AppRunnerConstruct } from "./constructs/apprunner-construct";

export class MyAppStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Cognito (Identity Pool + User Pool)
    const cognito = new CognitoConstruct(this, "Cognito", {
      domainPrefix: "my-app-auth",
      iosCallbackScheme: "myapp",
      enableSocialLogin: true,
      // Apple config
      appleClientId: "com.yourcompany.app.serviceid",
      appleTeamId: "YOUR_TEAM_ID",
      appleKeyId: "YOUR_KEY_ID",
      // applePrivateKeySecret: ...
      // Google config
      // googleClientId: "xxx.apps.googleusercontent.com",
      // googleClientSecretKey: "AUTH_GOOGLE_CLIENT_SECRET",
      // appSecret: ...
    });

    // App Runner — pass Cognito outputs as environment variables
    // const appRunner = new AppRunnerConstruct(this, "AppRunner", {
    //   environment: {
    //     COGNITO_USER_POOL_ID: cognito.userPool.userPoolId,
    //     COGNITO_CLIENT_ID: cognito.userPoolClient.userPoolClientId,
    //     COGNITO_IDENTITY_POOL_ID: cognito.identityPool.ref,
    //   },
    // });
  }
}
```

## Integration Checklist

### Phase 1: AWS Setup

- [ ] Deploy CDK stack (creates Identity Pool, User Pool, Domain)
- [ ] Record from CDK outputs: User Pool ID, Client ID, Identity Pool ID, Cognito Domain
- [ ] `amplifyconfiguration.json` must include `CredentialsProvider` section
- [ ] `Amplify.configure()` must be called in `App.init()` before any auth operations

### Phase 2: iOS Setup

- [ ] Add Amplify Swift SPM package (Amplify, AWSCognitoAuthPlugin, AWSPluginsCore)
- [ ] Add URL Scheme in Info > URL Types (e.g., `myapp`)
- [ ] Add `amplifyconfiguration.json` to the project (fill in values from Phase 1)
- [ ] Add SWUserManager.swift to the project
- [ ] Wire up session state to control navigation in App.swift

### Phase 3: Backend Setup

- [ ] Add auth middleware (identityMiddleware + authMiddleware)
- [ ] Create users table with `identityId` and `cognitoSub` columns
- [ ] Implement POST /v1/auth/sync endpoint
- [ ] Use `userId` (not `identityId`) as foreign key in all business tables

### Phase 4: Data Migration

- [ ] Sign-in flow saves `previousIdentityId` before login
- [ ] After sign-in, call POST /v1/auth/sync with `previousIdentityId`
- [ ] `consumePreviousIdentityId()` is one-time use (cleared after consumption)
- [ ] Customize `migrateAnonymousData()` for your app-specific tables

### Phase 5: Testing

- [ ] Fresh install: app starts in `.anonymous` state with valid Identity ID
- [ ] Anonymous user can use core features (Level 1 routes work)
- [ ] Apple Sign In upgrades to `.authenticated` state
- [ ] Anonymous data migrated to authenticated account after sync
- [ ] Sign out returns to `.anonymous` with new Identity ID
- [ ] Account deletion returns to `.anonymous`
- [ ] Kill + reopen app: session state correctly restored
- [ ] Network failure on first launch: retry mechanism works (3 attempts)

## Common Customizations

### 1. Add API Gateway (optional security layer)

If you need rate limiting, WAF, or gateway-level JWT validation, add API Gateway in front of App Runner:

```typescript
import * as apigatewayv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as apigatewayv2Authorizers from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import * as apigatewayv2Integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";

const httpApi = new apigatewayv2.HttpApi(this, "HttpApi", {
  apiName: "my-app-http-api",
  corsPreflight: {
    allowOrigins: ["*"],
    allowMethods: [apigatewayv2.CorsHttpMethod.ANY],
    allowHeaders: ["Content-Type", "Authorization", "X-Identity-Id"],
  },
});

const jwtAuthorizer = new apigatewayv2Authorizers.HttpJwtAuthorizer(
  "CognitoJwtAuthorizer",
  `https://cognito-idp.${this.region}.amazonaws.com/${userPool.userPoolId}`,
  {
    jwtAudience: [userPoolClient.userPoolClientId],
    identitySource: ["$request.header.Authorization"],
  }
);

// Public routes (no auth — anonymous users access these)
httpApi.addRoutes({
  path: "/v1/scans/{proxy+}",
  methods: [apigatewayv2.HttpMethod.ANY],
  integration: new apigatewayv2Integrations.HttpUrlIntegration(
    "ScansInt",
    `${appRunnerUrl}/v1/scans/{proxy}`
  ),
  // No authorizer — Hono identityMiddleware validates X-Identity-Id
});

// Protected routes (JWT required — authenticated users only)
httpApi.addRoutes({
  path: "/v1/chat/{proxy+}",
  methods: [apigatewayv2.HttpMethod.ANY],
  integration: new apigatewayv2Integrations.HttpUrlIntegration(
    "ChatInt",
    `${appRunnerUrl}/v1/chat/{proxy}`
  ),
  authorizer: jwtAuthorizer,
});
```

### 2. Add email/password sign-up

Add email auth methods to `SWUserManager` and `SWAuthService` (see the [auth-cognito](recipe://auth-cognito) recipe for the complete email/password implementation).

### 3. S3 permissions scoped by Identity ID

```typescript
// In CDK: scope S3 access to the user's own folder
unauthenticatedRole.addToPolicy(
  new iam.PolicyStatement({
    actions: ["s3:PutObject", "s3:GetObject"],
    resources: [
      `arn:aws:s3:::${bucket.bucketName}/\${cognito-identity.amazonaws.com:sub}/*`,
    ],
  })
);
```

### 4. Feature gating (some features require sign-in)

```swift
// In your view
struct PremiumFeatureView: View {
    @Environment(SWUserManager.self) private var userManager
    @State private var showSignInPrompt = false

    var body: some View {
        Button("Start Chat") {
            if userManager.sessionState.isSignedIn {
                startChat()
            } else {
                showSignInPrompt = true
            }
        }
        .sheet(isPresented: $showSignInPrompt) {
            SignInPromptView()
        }
    }
}
```

### 5. Add phone OTP login

Add phone authentication methods following the pattern in [auth-cognito](recipe://auth-cognito).

## Known Pitfalls

### 1. First install: fetchIdentityId() may fail

**Symptom**: `fetchIdentityId()` throws an error on the very first launch after install.

**Cause**: On first install, Cognito Identity Pool may fail due to network timing (especially on cellular). The Amplify SDK needs to make a network call to provision the Identity ID.

**Fix**: The `initializeAuth()` method includes a 3-retry mechanism with exponential backoff (1s, 2s, 4s). Never skip this retry logic.

### 2. Identity ID changes when anonymous user signs in

**Symptom**: Anonymous user loses all their data after signing in.

**Cause**: Cognito Identity Pool assigns different Identity IDs for anonymous vs. authenticated sessions:
- Anonymous: `us-east-1:abc123-xxx`
- Authenticated: `us-east-1:def456-xxx` (different!)

**Fix**: Save `previousIdentityId` before sign-in, pass it to `POST /v1/auth/sync`, and migrate all associated data in the database. This is already built into the `signInWithApple()` / `signInWithGoogle()` methods above.

### 3. Identity ID lost after app reinstall

**Symptom**: Previously anonymous user has no data after reinstalling the app.

**Cause**: The Identity ID is cached locally by the Amplify SDK. Uninstalling the app deletes the cache, and reinstalling generates a new Identity ID.

**Accepted behavior**: This is by design. Anonymous data is inherently device-local. Encourage users to sign up to protect their data. Display a notice like "Sign in to keep your data safe across devices."

### 4. Empty string identityId causes 401 errors

**Symptom**: API calls fail with 401 even though the user seems to have an Identity ID.

**Cause**: Edge case where `identityId` is an empty string, which passes the `!= nil` check but fails the backend middleware.

**Fix**: `SWAPIRequestBuilder.buildIdentityRequest()` includes `!identityId.isEmpty` guard. Always validate before sending.

### 5. Amplify.configure() must complete before fetchAuthSession()

**Symptom**: `fetchIdentityId()` throws a configuration error.

**Fix**: Call `Amplify.configure()` synchronously in `App.init()`. The `SWUserManager` initialization runs in a `Task`, which naturally starts after `init()` completes.

### 6. CredentialsProvider missing from amplifyconfiguration.json

**Symptom**: `fetchIdentityId()` returns an error — "Identity Pool not configured."

**Fix**: The `CredentialsProvider.CognitoIdentity` section is **required** in `amplifyconfiguration.json`. Without it, the SDK does not know about the Identity Pool. This section is optional in the [auth-cognito](recipe://auth-cognito) recipe but **mandatory** here.

### 7. signOut must re-fetch anonymous Identity ID

**Symptom**: After sign-out, the app shows an error state instead of returning to anonymous mode.

**Fix**: After `authService.signOut()`, call `authService.fetchIdentityId()` to get a new anonymous Identity ID. The `signOut()` method in `SWUserManager` already handles this.

## Security Rules (do not skip)

These four rules are the difference between a secure setup and a horizontal-privilege-escalation
+ PII-leak vulnerability. They were added after a real incident where an unverified JWT and a
leaked Identity ID let any client read other users' data and impersonate them.

### S1. `authMiddleware` must cryptographically verify the JWT — never trust an unverified token

The `Authorization: Bearer` token and the `X-Identity-Id` header are **both client-supplied
strings**. A client can send `X-Identity-Id: <victim-id>` and a hand-crafted, base64-encoded
`{"sub":"<victim-sub>"}` and — if you only base64-decode the JWT — the backend will happily
treat them as that victim. **Always** verify the JWT with `jose` (`createRemoteJWKSet` +
`jwtVerify`, checking `issuer` + `audience` + signature) before trusting `cognitoSub`/`email`.
The middleware in this recipe does exactly this.

### S2. Business tables must be keyed by a stable `userId` (UUID), never by `identityId`

`identityId` changes when an anonymous user signs in (see Pitfall #2), and exposing it is a
privacy leak. Use `users.id` (a server-generated UUID) as the foreign key in every business
table. Map `cognitoSub` (verified) → `userId` on the server. Never use `identityId` as a primary
or foreign key, and never use it as the partition key of a record that another user can query.

### S3. Never return another user's `identityId` (or `cognitoSub`) to other clients

Public/list responses (posts, items, leaderboards, author cards, etc.) must **strip** any
author-identifying `identityId`/`cognitoSub` field on the way out. If a client needs to
reference "who created this", expose a **non-impersonatable proxy id** (e.g. a separate public
`authorId` UUID stored on the user record) — not the raw Identity ID, which doubles as an auth
credential surface. Leaking it lets attackers batch-harvest valid identity IDs.

### S4. All write operations must go through Level 2 (verified JWT); the anonymous layer is read-only

Scope: every `POST` / `PUT` / `PATCH` / `DELETE` route should be mounted behind `authMiddleware`
(verified JWT required). The Level-1 `identityMiddleware` layer is for **read-only** access by
anonymous + authenticated users. This guarantees that every write is attributable to a verified,
non-forgeable `cognitoSub`. (If you have a large installed base of older clients that write
without a JWT, roll this out behind a remote-config flag — verify-but-don't-enforce first, then
flip enforcement on once the new client penetration is high enough — rather than rejecting them
on day one.)
