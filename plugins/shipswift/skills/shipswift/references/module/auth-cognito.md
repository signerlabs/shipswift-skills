---
id: auth-cognito
title: Authentication with AWS Cognito
description: Login-required iOS and macOS authentication system with AWS Cognito — email/password sign-up, Apple Sign In, Google Sign In, phone OTP, automatic token refresh, onboarding flow, and CDK infrastructure setup. Choose this when your app requires users to sign in before accessing any features.
tier: free
tags: [authentication, Cognito, AWS, Apple Sign In, Google Sign In, Amplify, login, sign-up, token, phone, OTP, login-required]
---

## What This Solves

Provides a login-required authentication system for iOS and macOS apps backed by AWS Cognito, covering the full lifecycle: email/password registration, social sign-in (Apple, Google), phone OTP, token management with automatic refresh, onboarding flow, account deletion, and password reset — with the complete CDK infrastructure to deploy it all.

> **Choosing between auth skills**: This skill requires users to sign in before accessing
> any features (e.g., social apps, enterprise tools). If your app should let users try
> core features without signing in first, use [auth-cognito-anonymous](skill://auth-cognito-anonymous) instead.

## Architecture

```
iOS App
  SWUserManager (@Observable)
    |
    |--- SWAuthService (actor, Amplify SDK)
    |       |--- signUp / confirmSignUp / signIn (email)
    |       |--- signInWithApple / signInWithGoogle (social)
    |       |--- sendPhoneVerificationCode / confirmPhoneSignIn (phone OTP)
    |       |--- fetchTokens / refreshSession (token management)
    |       |--- signOut / deleteUser
    |       |--- isSignedIn
    |
    |--- SWAuthView (complete UI with all auth flows)
    |       |--- Email sign-in / sign-up with verification
    |       |--- Phone sign-in with country code picker
    |       |--- Apple + Google social buttons
    |       |--- Forgot password / reset flow
    |       |--- Terms of Service agreement
    |
    |--- SWAgreementChecker (ToS + Privacy checkbox)
    |--- SWCountryData (200+ countries with dial codes)
    |
    v
Cognito User Pool (AWS)
    |--- Email/Password (USER_SRP_AUTH)
    |--- Apple Identity Provider (OAuth)
    |--- Google Identity Provider (OAuth)
    |--- Hosted UI Domain (for OAuth redirects)
    |
    v
App Runner (Hono backend, direct)
    |--- authMiddleware (validates JWT, extracts user info)
    |--- Public routes (no auth required)
    |--- Protected routes (Bearer token)
```

### Why Cognito over Firebase Auth or Supabase Auth?

| Criteria | Cognito | Firebase Auth | Supabase Auth |
|----------|---------|---------------|---------------|
| AWS-native integration | First-class (API Gateway JWT, IAM, S3) | Requires bridge | Requires bridge |
| Identity Pool (guest mode) | Built-in (see [auth-cognito-anonymous](skill://auth-cognito-anonymous)) | Not available | Not available |
| Social login config | CDK as code | Console-only | Dashboard-only |
| Pricing at scale | Free up to 50K MAU | Free up to 50K | Free up to 50K |
| Token refresh | SDK handles automatically | SDK handles automatically | SDK handles automatically |
| Infrastructure as Code | Full CDK support | Partial (Firebase Extensions) | Limited |
| Vendor lock-in risk | Moderate (JWT standard) | High (Firebase SDK) | Low (PostgreSQL) |

**Bottom line**: If your backend is on AWS, Cognito is the natural choice. Hono middleware validates JWTs directly, keeping auth logic minimal. For apps that need anonymous/guest access, see [auth-cognito-anonymous](skill://auth-cognito-anonymous).

## Dependencies

### iOS (Swift Package Manager)

| Package | URL | Products |
|---------|-----|----------|
| Amplify Swift | `https://github.com/aws-amplify/amplify-swift` | `Amplify`, `AWSCognitoAuthPlugin`, `AWSPluginsCore` |

### Backend (npm)

| Package | Purpose |
|---------|---------|
| `aws-cdk-lib` | CDK constructs for Cognito, IAM |

## Implementation

### iOS

Copy these files into your app:

| File | Platform | Purpose |
|------|----------|---------|
| `SWUserManager.swift` | iOS + macOS | Session state (`SWSessionState`), the Amplify-backed `SWAuthService` actor, token refresh, guest mode, App Store review prompt |
| `SWAuthView+iOS.swift` | iOS only | Complete auth UI: email sign-in/up, phone sign-in with country picker, Apple + Google, verification code, forgot/reset password |
| `SWAuthView+macOS.swift` | macOS only | Centered auth panel: email sign-in/up, Apple + Google, verification code, forgot/reset password (no phone sign-in) |
| `SWAgreementChecker.swift` | iOS + macOS | Terms of Service / Privacy Policy checkbox |
| `SWCountryData.swift` | iOS + macOS | 200+ countries with dial codes, flags and phone number lengths (used by the iOS phone sign-in) |
| `SWDebugLog.swift` | iOS + macOS | `swDebugLog(...)` debug-only logging used by `SWUserManager` (skip it if your project already has ShipSwift's `SWUtil`) |
| `SWButtonStyle` (from `SWUtil/SWViewExtension.swift`) | iOS + macOS | `.swPrimary` / `.swSecondary` button styles used by the iOS view (skip it if your project already has ShipSwift's `SWUtil`) |

Both `SWAuthView` files declare the same type. In a multiplatform target, limit each to its platform in **Build Phases → Compile Sources** (platform filter); an iOS-only app needs just `SWAuthView+iOS.swift`.

> **Requires:** the **component-alert** skill (`SWAlertManager`). Both auth views report errors with `SWAlertManager.shared.show(...)`, so attach `.swAlert()` to your root view.

#### 1. SWUserManager.swift — Session state and auth orchestration

This is the central auth manager that the rest of your app observes. It manages session state transitions and delegates actual auth operations to `SWAuthService`. Token failures are classified: an offline device keeps its session (`getFreshIdToken()` returns `nil`), while an expired or revoked session signs the user out.

```swift
import Foundation
import SwiftUI
import StoreKit
import Amplify
import AWSCognitoAuthPlugin
import AWSPluginsCore

#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

// MARK: - Session State

/// User session state
enum SWSessionState: Equatable {
    case loading
    case signedOut(errorMessage: String? = nil)
    case guest                              // Guest mode, skip sign in
    case onboarding(tokens: SWAuthTokens)   // Signed in, onboarding not completed
    case ready(tokens: SWAuthTokens)        // Signed in, onboarding completed

    var isSignedIn: Bool {
        switch self {
        case .onboarding, .ready: return true
        case .signedOut, .loading, .guest: return false
        }
    }

    var isGuest: Bool {
        if case .guest = self { return true }
        return false
    }

    var isLoading: Bool {
        if case .loading = self { return true }
        return false
    }

    var tokens: SWAuthTokens? {
        switch self {
        case .onboarding(let tokens), .ready(let tokens): return tokens
        case .signedOut, .loading, .guest: return nil
        }
    }

    var errorMessage: String? {
        if case .signedOut(let message) = self { return message }
        return nil
    }
}

// MARK: - Auth Tokens

/// Authentication Tokens
struct SWAuthTokens: Equatable {
    let idToken: String
    let accessToken: String
    let refreshToken: String
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
        case .timeout: return "Request timeout, please retry"
        case .userProfileNotFound: return "User profile not found"
        case .userAlreadyExists: return "User profile already exists"
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
    }

    // MARK: - Review Request Configuration

    private enum ReviewConfig {
        static let minActions = 2             // At least 2 completed actions
        static let minLaunches = 3            // At least 3 app launches
        static let daysBetweenRequests = 30   // Days between review requests
        static let delayBeforeRequest: Duration = .seconds(1)  // Delay before request
    }

    // MARK: - Properties

    /// Whether to skip the Amplify auth check (used in Preview environments)
    private let skipAuthCheck: Bool

    /// User session state
    var sessionState: SWSessionState = .loading

    /// Whether an authentication operation is in progress
    var isAuthenticating = false

    /// Whether this is the first launch (stored property, trackable by @Observable)
    var isFirstLaunch: Bool = false {
        didSet {
            // Note: stores whether first launch has been completed, so invert the value
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

    init(skipAuthCheck: Bool = false) {
        self.skipAuthCheck = skipAuthCheck
        self.isFirstLaunch = !UserDefaults.standard.bool(forKey: StorageKey.isFirstLaunch.rawValue)
        appLaunchCount += 1

        if !skipAuthCheck {
            // Check authentication status
            Task {
                await checkAuthStatus()
            }
        } else {
            sessionState = .signedOut()
        }
    }

    // MARK: - Public Methods

    func completeFirstLaunch() {
        isFirstLaunch = false  // didSet automatically syncs to UserDefaults
    }

    // MARK: - Auth Status Check

    /// Check authentication status and update session state
    func checkAuthStatus() async {
        sessionState = .loading

        let isSignedIn = await authService.isSignedIn()

        if isSignedIn {
            do {
                let tokens = try await authService.fetchTokens()
                // Default to ready state directly
                // If there is an onboarding flow, query backend status here
                sessionState = .ready(tokens: tokens)
            } catch SWServiceError.networkError {
                // Offline with an expired ID token: keep the stored session so the next launch can restore it
                swDebugLog("⚠️ [SWUserManager] Cannot refresh session while offline")
                sessionState = .signedOut(errorMessage: SWServiceError.networkError.errorDescription)
            } catch {
                // Session expired or token invalid, sign out to clean up local Amplify cache
                swDebugLog("⚠️ [SWUserManager] Session expired, signing out:", error)
                await authService.signOut()
                sessionState = .signedOut()
            }
        } else {
            sessionState = .signedOut()
        }
    }

    // MARK: - Email/Password Authentication

    /// Sign up
    func signUp(email: String, password: String) async throws {
        isAuthenticating = true
        defer { isAuthenticating = false }
        try await authService.signUp(email: email, password: password)
    }

    /// Confirm email verification code
    func confirmSignUp(email: String, code: String) async throws {
        isAuthenticating = true
        defer { isAuthenticating = false }
        try await authService.confirmSignUp(email: email, code: code)
    }

    /// Resend verification code
    func resendSignUpCode(email: String) async throws {
        try await authService.resendSignUpCode(email: email)
    }

    /// Sign in with email and password
    func signIn(email: String, password: String) async throws {
        isAuthenticating = true
        defer { isAuthenticating = false }

        let tokens = try await authService.signIn(email: email, password: password)
        sessionState = .ready(tokens: tokens)
    }

    // MARK: - Social Sign In

    /// Apple Sign In
    func signInWithApple() async throws {
        swDebugLog("🍎 [Auth] Starting Apple Sign In...")

        guard let window = SWWindowHelper.keyWindow else {
            swDebugLog("🍎 [Auth] ❌ Cannot get window")
            throw SWServiceError.unknown("Cannot get window")
        }

        isAuthenticating = true
        defer { isAuthenticating = false }

        do {
            swDebugLog("🍎 [Auth] Calling authService.signInWithApple...")
            let tokens = try await authService.signInWithApple(presentationAnchor: window)
            swDebugLog("🍎 [Auth] ✅ Apple Sign In successful, got tokens")
            sessionState = .ready(tokens: tokens)
        } catch {
            swDebugLog("🍎 [Auth] ❌ Apple Sign In failed:", error)
            throw error
        }
    }

    /// Google Sign In
    func signInWithGoogle() async throws {
        guard let window = SWWindowHelper.keyWindow else {
            throw SWServiceError.unknown("Cannot get window")
        }

        isAuthenticating = true
        defer { isAuthenticating = false }

        let tokens = try await authService.signInWithGoogle(presentationAnchor: window)
        sessionState = .ready(tokens: tokens)
    }

    // MARK: - Guest Mode

    /// Skip sign in and enter guest mode
    func skipSignIn() {
        sessionState = .guest
    }

    /// Require sign in (switch from guest mode to sign in page)
    func requireSignIn() {
        sessionState = .signedOut()
    }

    // MARK: - Sign Out / Delete Account

    /// Sign out
    func signOut() async {
        await authService.signOut()
        sessionState = .signedOut()
    }

    /// Delete account
    func deleteAccount() async throws {
        try await authService.deleteUser()
        sessionState = .signedOut()
    }

    // MARK: - Phone Authentication

    /// Send phone verification code
    func sendPhoneVerificationCode(phoneNumber: String) async throws {
        isAuthenticating = true
        defer { isAuthenticating = false }
        try await authService.sendPhoneVerificationCode(phoneNumber: phoneNumber)
    }

    /// Confirm phone sign-in with verification code
    func confirmPhoneSignIn(phoneNumber: String, code: String) async throws {
        isAuthenticating = true
        defer { isAuthenticating = false }
        let tokens = try await authService.confirmPhoneSignIn(phoneNumber: phoneNumber, code: code)
        sessionState = .ready(tokens: tokens)
    }

    // MARK: - Password Reset

    /// Forgot password
    func forgotPassword(email: String) async throws {
        try await authService.forgotPassword(email: email)
    }

    /// Reset password
    func confirmResetPassword(email: String, newPassword: String, code: String) async throws {
        try await authService.confirmResetPassword(email: email, newPassword: newPassword, code: code)
    }

    // MARK: - Onboarding

    /// Complete onboarding questionnaire, transition to ready state
    func completeOnboarding() {
        guard let tokens = sessionState.tokens else { return }
        sessionState = .ready(tokens: tokens)
    }

    // MARK: - Token Management

    /// Get the latest ID Token (automatically refreshes expired tokens)
    ///
    /// Important: Use this method to get token before each API call,
    /// instead of directly using the cached `sessionState.tokens?.idToken`
    ///
    /// How it works:
    /// 1. Calls `authService.fetchTokens()` -> `Amplify.Auth.fetchAuthSession()`
    /// 2. SDK automatically checks if ID Token is expired (default 1 hour)
    /// 3. If expired, SDK uses Refresh Token to obtain a new ID Token
    /// 4. Also updates the cached tokens
    ///
    /// Returns nil when:
    /// - User is not signed in
    /// - Refresh Token expired (30 days of inactivity), requires re-sign-in
    /// - The device is offline and the ID Token has expired (the session is kept)
    ///
    /// Usage example:
    /// ```swift
    /// guard let idToken = await userManager.getFreshIdToken() else { return }
    /// await apiService.fetchData(idToken: idToken)
    /// ```
    func getFreshIdToken() async -> String? {
        guard sessionState.isSignedIn else {
            return nil
        }

        do {
            let tokens = try await authService.fetchTokens()

            // Also update the cached tokens
            switch sessionState {
            case .onboarding:
                sessionState = .onboarding(tokens: tokens)
            case .ready:
                sessionState = .ready(tokens: tokens)
            default:
                break
            }

            return tokens.idToken
        } catch SWServiceError.networkError {
            // Offline: keep the session, the next call refreshes once the network is back
            swDebugLog("⚠️ [SWUserManager] Token refresh failed while offline, keeping session")
            return nil
        } catch {
            // Refresh token expired, sign out to avoid "fake logged-in" state
            swDebugLog("⚠️ [SWUserManager] Token refresh failed, signing out:", error)
            await authService.signOut()
            sessionState = .signedOut()
            return nil
        }
    }

    /// Refresh session
    func refreshSession() async throws {
        guard sessionState.tokens != nil else {
            throw SWServiceError.tokenMissing
        }

        let newTokens = try await authService.refreshSession()

        switch sessionState {
        case .onboarding:
            sessionState = .onboarding(tokens: newTokens)
        case .ready:
            sessionState = .ready(tokens: newTokens)
        default:
            break
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
                [.day],
                from: lastDate,
                to: .now
            ).day ?? 0

            guard daysSinceLastRequest >= ReviewConfig.daysBetweenRequests else {
                return false
            }
        }

        return actionCompletedCount >= ReviewConfig.minActions
            && appLaunchCount >= ReviewConfig.minLaunches
    }

    private func requestReview() async {
        #if os(iOS)
        guard let scene = UIApplication.shared.connectedScenes
            .first(where: { $0.activationState == .foregroundActive }) as? UIWindowScene
        else { return }

        AppStore.requestReview(in: scene)
        #elseif os(macOS)
        guard let controller = NSApplication.shared.keyWindow?.contentViewController else { return }

        AppStore.requestReview(in: controller)
        #endif

        hasRequestedReview = true
        lastReviewRequestDate = .now
    }
}

// MARK: - Auth Service

/// Authentication Service - uses Amplify SDK directly
actor SWAuthService {
    static let shared = SWAuthService()

    private init() {}

    // MARK: - Email/Password Authentication

    /// Sign up a new user
    func signUp(email: String, password: String) async throws {
        _ = try await Amplify.Auth.signUp(
            username: email,
            password: password,
            options: AuthSignUpRequest.Options(
                userAttributes: [AuthUserAttribute(.email, value: email)]
            )
        )
    }

    /// Confirm email verification code
    func confirmSignUp(email: String, code: String) async throws {
        let result = try await Amplify.Auth.confirmSignUp(
            for: email,
            confirmationCode: code
        )

        guard result.isSignUpComplete else {
            throw SWServiceError.invalidState
        }
    }

    /// Resend verification code
    func resendSignUpCode(email: String) async throws {
        _ = try await Amplify.Auth.resendSignUpCode(for: email)
    }

    /// Sign in with email and password
    func signIn(email: String, password: String) async throws -> SWAuthTokens {
        // A session kept while offline is still stored; Amplify rejects a new sign-in on top of it
        if await isSignedIn() {
            await signOut()
        }

        let result = try await Amplify.Auth.signIn(
            username: email,
            password: password
        )

        guard result.isSignedIn else {
            throw SWServiceError.notSignedIn
        }

        return try await fetchTokens()
    }

    // MARK: - Social Sign In

    /// Apple Sign In
    func signInWithApple(presentationAnchor: AuthUIPresentationAnchor) async throws -> SWAuthTokens {
        swDebugLog("🍎 [SWAuthService] signInWithApple started")

        // If already signed in, sign out first
        if await isSignedIn() {
            swDebugLog("🍎 [SWAuthService] Already signed in, signing out first...")
            await signOut()
        }

        let pluginOptions = AWSAuthWebUISignInOptions(preferPrivateSession: true)
        let options = AuthWebUISignInRequest.Options(pluginOptions: pluginOptions)

        do {
            let result = try await Amplify.Auth.signInWithWebUI(
                for: .apple,
                presentationAnchor: presentationAnchor,
                options: options
            )

            guard result.isSignedIn else {
                throw SWServiceError.notSignedIn
            }

            return try await fetchTokens()
        } catch let error as AuthError {
            swDebugLog("🍎 [SWAuthService] ❌ AuthError:", error.errorDescription)
            throw error
        } catch {
            swDebugLog("🍎 [SWAuthService] ❌ Unknown Error:", String(describing: error))
            throw error
        }
    }

    /// Google Sign In
    func signInWithGoogle(presentationAnchor: AuthUIPresentationAnchor) async throws -> SWAuthTokens {
        // If already signed in, sign out first
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

    /// Fetch current tokens
    func fetchTokens() async throws -> SWAuthTokens {
        let session = try await Amplify.Auth.fetchAuthSession()

        guard let cognitoSession = session as? AWSAuthCognitoSession else {
            throw SWServiceError.tokenMissing
        }

        let tokensResult = cognitoSession.getCognitoTokens()

        switch tokensResult {
        case .success(let tokens):
            return SWAuthTokens(
                idToken: tokens.idToken,
                accessToken: tokens.accessToken,
                refreshToken: tokens.refreshToken
            )
        case .failure(let error):
            throw Self.tokenError(from: error)
        }
    }

    /// Refresh tokens
    func refreshSession() async throws -> SWAuthTokens {
        let session = try await Amplify.Auth.fetchAuthSession(options: .forceRefresh())

        guard let cognitoSession = session as? AWSAuthCognitoSession else {
            throw SWServiceError.tokenMissing
        }

        let tokensResult = cognitoSession.getCognitoTokens()

        switch tokensResult {
        case .success(let tokens):
            return SWAuthTokens(
                idToken: tokens.idToken,
                accessToken: tokens.accessToken,
                refreshToken: tokens.refreshToken
            )
        case .failure(let error):
            throw Self.tokenError(from: error)
        }
    }

    /// Offline is transient (`.networkError`, keep the session); any other failure means the session is gone (`.tokenMissing`)
    private static func tokenError(from error: AuthError) -> SWServiceError {
        if case .service(_, _, let underlyingError) = error,
           case .network? = underlyingError as? AWSCognitoAuthError {
            return .networkError
        }
        return .tokenMissing
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

    /// Check sign in status
    func isSignedIn() async -> Bool {
        do {
            let session = try await Amplify.Auth.fetchAuthSession()
            return session.isSignedIn
        } catch {
            return false
        }
    }

    // MARK: - Phone Authentication

    /// Send verification code to phone number via custom auth flow
    func sendPhoneVerificationCode(phoneNumber: String) async throws {
        // Sign out any existing session first to start fresh
        if await isSignedIn() {
            await signOut()
        }

        // Passwordless custom auth flow, independent of the default flow in amplifyconfiguration.json
        let options = AuthSignInRequest.Options(
            pluginOptions: AWSAuthSignInOptions(authFlowType: .customWithoutSRP)
        )
        let result = try await Amplify.Auth.signIn(username: phoneNumber, options: options)
        // Cognito custom auth flow sends verification code automatically
        guard case .confirmSignInWithCustomChallenge = result.nextStep else {
            if result.isSignedIn {
                return // Already signed in
            }
            throw SWServiceError.invalidState
        }
    }

    /// Confirm phone sign-in with verification code
    func confirmPhoneSignIn(phoneNumber: String, code: String) async throws -> SWAuthTokens {
        let result = try await Amplify.Auth.confirmSignIn(challengeResponse: code)
        guard result.isSignedIn else {
            throw SWServiceError.notSignedIn
        }
        return try await fetchTokens()
    }

    // MARK: - Password Reset

    /// Forgot password - send verification code
    func forgotPassword(email: String) async throws {
        _ = try await Amplify.Auth.resetPassword(for: email)
    }

    /// Reset password - set new password using verification code
    func confirmResetPassword(email: String, newPassword: String, code: String) async throws {
        try await Amplify.Auth.confirmResetPassword(
            for: email,
            with: newPassword,
            confirmationCode: code
        )
    }
}

// MARK: - Window Helper

/// Cross-platform helper to retrieve the key window for auth presentation anchors
private enum SWWindowHelper {
    #if os(iOS)
    static var keyWindow: UIWindow? {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap { $0.windows }
            .first { $0.isKeyWindow }
    }
    #elseif os(macOS)
    static var keyWindow: NSWindow? {
        NSApplication.shared.keyWindow ?? NSApplication.shared.windows.first
    }
    #endif
}
```

#### 2. SWAuthView+iOS.swift — Complete authentication UI (iOS)

A single view that handles all authentication flows: email sign-in/up, phone sign-in with country picker, social buttons, verification code, forgot/reset password. Reads `SWUserManager` from the SwiftUI environment. `isDemo: true` renders the UI without running any auth action (for showcases and screenshots).

```swift
import SwiftUI
import Amplify
import AWSCognitoAuthPlugin

struct SWAuthView: View {

    var isDemo: Bool = false

    // MARK: - Environment

    @Environment(SWUserManager.self) private var userManager

    // MARK: - View Mode

    private enum ViewMode {
        case signIn                    // Email sign in
        case signUp                    // Email sign up
        case confirmSignUp             // Confirm email verification code
        case forgotPassword            // Forgot password (enter email)
        case resetPassword             // Reset password (enter code and new password)
        case phoneSignIn               // Phone number sign in
        case phoneVerify               // Phone verification code
    }

    // MARK: - Loading State

    private enum LoadingState {
        case idle
        case sendingCode
        case verifying
        case signingIn
    }

    // Sign-in method enum for the top-bar Email / Phone toggle
    private enum SignInMethod: String, CaseIterable {
        case email = "Email"
        case phone = "Phone"
    }

    // MARK: - State

    @State private var viewMode: ViewMode = .signIn
    @State private var signInMethod: SignInMethod = .email
    @State private var loadingState: LoadingState = .idle
    @State private var agreementChecked = false

    // Email sign-in state
    @State private var email = ""
    @State private var password = ""
    @State private var confirmPassword = ""
    @State private var verificationCode = ""
    @FocusState private var isPasswordFocused: Bool
    @FocusState private var isCodeFocused: Bool

    // Phone sign-in state
    @State private var phoneNumber = ""
    // Dial codes are shared (+1 covers the US, Canada and the Caribbean), so the selection is tracked by name
    @State private var countryName = "United States"
    @State private var showingCountryPicker = false
    @State private var countrySearchText = ""
    @State private var isResending = false

    // Reset password state
    @State private var newPassword = ""
    @State private var confirmNewPassword = ""
    @State private var resetCode = ""

    // MARK: - Computed Properties

    private var isValidEmail: Bool {
        let emailRegex = #"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$"#
        return email.range(of: emailRegex, options: .regularExpression) != nil
    }

    private var isValidPassword: Bool {
        password.count >= 8
    }

    private var isValidConfirmPassword: Bool { password == confirmPassword && isValidPassword }

    private var isValidCode: Bool { verificationCode.count == 6 }

    private var selectedCountry: SWCountry? {
        SWCountryData.allCountries.first { $0.name == countryName }
    }

    private var countryCode: String { selectedCountry?.code ?? "+1" }

    private var isValidPhone: Bool {
        let expectedLength = SWCountryData.phoneLength(for: countryCode)
        return expectedLength.contains(phoneNumber.count)
    }

    private var fullPhoneNumber: String { "\(countryCode)\(phoneNumber)" }

    private var isValidResetCode: Bool { resetCode.count == 6 }

    private var isValidNewPassword: Bool {
        newPassword.count >= 8
    }

    private var isValidConfirmNewPassword: Bool { newPassword == confirmNewPassword && isValidNewPassword }

    // MARK: - Body

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 24) {
                    Spacer(minLength: 40)

                    // Icon
                    Image(systemName: "person.circle.fill")
                        .resizable()
                        .scaledToFit()
                        .frame(width: 80, height: 80)
                        .foregroundStyle(Color.accentColor)
                        .padding()

                    // Title
                    VStack(spacing: 8) {
                        Text(headerTitle)
                            .font(.title)
                            .fontWeight(.bold)
                            .multilineTextAlignment(.center)

                        Text(headerSubtitle)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                    }

                    // Sign-in method toggle buttons, shown only in signIn / phoneSignIn modes
                    if viewMode == .signIn || viewMode == .phoneSignIn {
                        HStack(spacing: 12) {
                            signInMethodButton(.email, icon: "envelope.fill", label: "Email")
                            signInMethodButton(.phone, icon: "phone.fill", label: "Phone")
                        }
                    }

                    Spacer(minLength: 20)

                    // Display different content based on mode
                    switch viewMode {
                    case .signIn, .signUp:
                        mainAuthSection
                    case .confirmSignUp:
                        confirmSignUpSection
                    case .forgotPassword:
                        forgotPasswordSection
                    case .resetPassword:
                        resetPasswordSection
                    case .phoneSignIn:
                        phoneSignInSection
                    case .phoneVerify:
                        phoneVerifySection
                    }
                }
                .padding()
            }
            .scrollDismissesKeyboard(.interactively)
            .onChange(of: signInMethod) { _, newMethod in
                withAnimation {
                    switch newMethod {
                    case .email: viewMode = .signIn
                    case .phone: viewMode = .phoneSignIn
                    }
                }
            }
            .sheet(isPresented: $showingCountryPicker) {
                countryCodePicker
            }
            .task {
                // Make one request up front so the cellular data ("Wireless Data") prompt on
                // China-region devices shows now, not in the middle of OAuth sign-in where it breaks the flow
                await prefetchNetworkPermission()
            }
        }
    }

    // MARK: - Network Permission Prefetch

    private func prefetchNetworkPermission() async {
        guard let url = URL(string: "https://www.apple.com") else { return }
        let session = URLSession(configuration: .ephemeral)
        defer { session.finishTasksAndInvalidate() }
        var request = URLRequest(url: url)
        request.httpMethod = "HEAD"
        _ = try? await session.data(for: request)
    }

    private var headerTitle: String {
        switch viewMode {
        case .signIn: return "Welcome"
        case .signUp: return "Create Account"
        case .confirmSignUp: return "Verify Email"
        case .forgotPassword: return "Forgot Password"
        case .resetPassword: return "Reset Password"
        case .phoneSignIn: return "Phone Sign In"
        case .phoneVerify: return "Verify Phone"
        }
    }

    private var headerSubtitle: String {
        switch viewMode {
        case .signIn: return "Sign in to continue"
        case .signUp: return "Sign up with your email"
        case .confirmSignUp: return "Enter the 6-digit code sent to \(email)"
        case .forgotPassword: return "Enter your email to receive a reset code"
        case .resetPassword: return "Enter the code and your new password"
        case .phoneSignIn: return "Sign in with your phone number"
        case .phoneVerify: return "Enter the 6-digit code sent to \(fullPhoneNumber)"
        }
    }

    // MARK: - Main Auth Section (SignIn/SignUp)

    @ViewBuilder
    private var mainAuthSection: some View {
        VStack(spacing: 16) {
            // Email sign-in area
            emailSignInSection

            // Social sign-in area (includes the agreement checkbox)
            if viewMode == .signIn {
                socialSignInSection
            } else {
                // Sign-up also requires the agreement, so the checkbox must be visible here
                SWAgreementChecker(agreementChecked: $agreementChecked)
            }
        }
    }

    // MARK: - Email Sign-In Section

    @ViewBuilder
    private var emailSignInSection: some View {
        VStack(spacing: 12) {
            // Email input
            HStack {
                Image(systemName: "envelope")
                    .foregroundStyle(.secondary)
                TextField("Email", text: $email)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .textContentType(.emailAddress)
                    .autocorrectionDisabled()
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .background(.accent.opacity(0.1))
            .clipShape(RoundedRectangle(cornerRadius: 12))

            // Password input
            HStack {
                Image(systemName: "lock")
                    .foregroundStyle(.secondary)
                SecureField("Password", text: $password)
                    .textContentType(viewMode == .signUp ? .newPassword : .password)
                    .focused($isPasswordFocused)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .background(.accent.opacity(0.1))
            .clipShape(RoundedRectangle(cornerRadius: 12))

            // Password requirements hint (sign-up mode only)
            if viewMode == .signUp && !password.isEmpty {
                passwordRequirements
            }

            // Confirm password (sign-up mode only)
            if viewMode == .signUp {
                HStack {
                    Image(systemName: "lock.fill")
                        .foregroundStyle(.secondary)
                    SecureField("Confirm Password", text: $confirmPassword)
                        .textContentType(.newPassword)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 14)
                .background(.accent.opacity(0.1))
                .clipShape(RoundedRectangle(cornerRadius: 12))

                if !confirmPassword.isEmpty && password != confirmPassword {
                    Text("Passwords do not match")
                        .font(.caption)
                        .foregroundStyle(.red)
                }
            }

            // Sign-in / Sign-up button
            Button {
                if viewMode == .signUp {
                    signUpWithEmail()
                } else {
                    signInWithEmail()
                }
            } label: {
                HStack {
                    if loadingState == .signingIn {
                        ProgressView()
                            .tint(.white)
                    }
                    Text(emailButtonText)
                }
            }
            .buttonStyle(.swPrimary)
            .disabled(!isEmailFormValid || loadingState == .signingIn)

            // Forgot password (sign-in mode only)
            if viewMode == .signIn {
                Button {
                    withAnimation {
                        viewMode = .forgotPassword
                    }
                } label: {
                    Text("Forgot Password?")
                        .font(.subheadline)
                        .foregroundStyle(Color.accentColor)
                }
            }

            // Toggle sign-in / sign-up
            Button {
                withAnimation {
                    viewMode = viewMode == .signIn ? .signUp : .signIn
                    confirmPassword = ""
                }
            } label: {
                Text(viewMode == .signUp ? "Already have an account? Sign In" : "Don't have an account? Sign Up")
                    .font(.subheadline)
                    .foregroundStyle(Color.accentColor)
            }
        }
        .padding(.vertical)
    }

    // MARK: - Password Requirements

    @ViewBuilder
    private var passwordRequirements: some View {
        HStack(spacing: 4) {
            Image(systemName: password.count >= 8 ? "checkmark.circle.fill" : "circle")
                .foregroundStyle(password.count >= 8 ? .green : .secondary)
            Text("At least 8 characters")
                .foregroundStyle(password.count >= 8 ? .primary : .secondary)
        }
        .font(.caption)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 4)
    }

    private var emailButtonText: String {
        if loadingState == .signingIn {
            return viewMode == .signUp ? "Creating Account..." : "Signing In..."
        }
        return viewMode == .signUp ? "Create Account" : "Sign In"
    }

    private var isEmailFormValid: Bool {
        if viewMode == .signUp {
            return isValidEmail && isValidConfirmPassword
        }
        return isValidEmail && password.count >= 8
    }

    // MARK: - Confirm SignUp Section

    @ViewBuilder
    private var confirmSignUpSection: some View {
        VStack(spacing: 16) {
            // Verification code input
            TextField("000000", text: $verificationCode)
                .keyboardType(.numberPad)
                .textContentType(.oneTimeCode)
                .focused($isCodeFocused)
                .multilineTextAlignment(.center)
                .font(.title2.monospacedDigit())
                .padding(.vertical, 16)
                .background(.accent.opacity(0.1))
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .onChange(of: verificationCode) { _, newValue in
                    verificationCode = String(newValue.filter(\.isNumber).prefix(6))
                }

            // Confirm button
            Button {
                confirmSignUp()
            } label: {
                HStack {
                    if loadingState == .verifying {
                        ProgressView()
                            .tint(.white)
                    }
                    Text(loadingState == .verifying ? "Verifying..." : "Verify Email")
                }
            }
            .buttonStyle(.swPrimary)
            .disabled(!isValidCode || loadingState == .verifying)

            // Resend verification code
            Button {
                resendEmailCode()
            } label: {
                Text("Resend Code")
                    .font(.subheadline)
                    .foregroundStyle(Color.accentColor)
            }
            .disabled(loadingState == .sendingCode)

            // Back to sign in
            Button {
                withAnimation {
                    signInMethod = .email
                    viewMode = .signIn
                    verificationCode = ""
                }
            } label: {
                Text("Back to Sign In")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical)
        .task {
            try? await Task.sleep(for: .milliseconds(300))
            isCodeFocused = true
        }
    }

    // MARK: - Forgot Password Section

    @ViewBuilder
    private var forgotPasswordSection: some View {
        VStack(spacing: 16) {
            // Email input
            HStack {
                Image(systemName: "envelope")
                    .foregroundStyle(.secondary)
                TextField("Email", text: $email)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .textContentType(.emailAddress)
                    .autocorrectionDisabled()
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .background(.accent.opacity(0.1))
            .clipShape(RoundedRectangle(cornerRadius: 12))

            // Send verification code button
            Button {
                sendResetCode()
            } label: {
                HStack {
                    if loadingState == .sendingCode {
                        ProgressView()
                            .tint(.white)
                    }
                    Text(loadingState == .sendingCode ? "Sending..." : "Send Reset Code")
                }
            }
            .buttonStyle(.swPrimary)
            .disabled(!isValidEmail || loadingState == .sendingCode)

            // Back to sign in
            Button {
                withAnimation {
                    signInMethod = .email
                    viewMode = .signIn
                }
            } label: {
                Text("Back to Sign In")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical)
    }

    // MARK: - Reset Password Section

    @ViewBuilder
    private var resetPasswordSection: some View {
        VStack(spacing: 16) {
            // Verification code input
            VStack(alignment: .leading, spacing: 4) {
                Text("Verification Code")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                TextField("000000", text: $resetCode)
                    .keyboardType(.numberPad)
                    .textContentType(.oneTimeCode)
                    .multilineTextAlignment(.center)
                    .font(.title2.monospacedDigit())
                    .padding(.vertical, 16)
                    .background(.accent.opacity(0.1))
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .onChange(of: resetCode) { _, newValue in
                        resetCode = String(newValue.filter(\.isNumber).prefix(6))
                    }
            }

            // New password
            VStack(alignment: .leading, spacing: 4) {
                Text("New Password")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                HStack {
                    Image(systemName: "lock")
                        .foregroundStyle(.secondary)
                    SecureField("New Password", text: $newPassword)
                        .textContentType(.newPassword)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 14)
                .background(.accent.opacity(0.1))
                .clipShape(RoundedRectangle(cornerRadius: 12))
            }

            // Password requirements hint
            if !newPassword.isEmpty {
                HStack(spacing: 4) {
                    Image(systemName: newPassword.count >= 8 ? "checkmark.circle.fill" : "circle")
                        .foregroundStyle(newPassword.count >= 8 ? .green : .secondary)
                    Text("At least 8 characters")
                        .foregroundStyle(newPassword.count >= 8 ? .primary : .secondary)
                }
                .font(.caption)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 4)
            }

            // Confirm new password
            VStack(alignment: .leading, spacing: 4) {
                Text("Confirm New Password")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                HStack {
                    Image(systemName: "lock.fill")
                        .foregroundStyle(.secondary)
                    SecureField("Confirm New Password", text: $confirmNewPassword)
                        .textContentType(.newPassword)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 14)
                .background(.accent.opacity(0.1))
                .clipShape(RoundedRectangle(cornerRadius: 12))

                if !confirmNewPassword.isEmpty && newPassword != confirmNewPassword {
                    Text("Passwords do not match")
                        .font(.caption)
                        .foregroundStyle(.red)
                }
            }

            // Reset password button
            Button {
                confirmResetPassword()
            } label: {
                HStack {
                    if loadingState == .verifying {
                        ProgressView()
                            .tint(.white)
                    }
                    Text(loadingState == .verifying ? "Resetting..." : "Reset Password")
                }
            }
            .buttonStyle(.swPrimary)
            .disabled(!isValidResetCode || !isValidConfirmNewPassword || loadingState == .verifying)

            // Back to sign in
            Button {
                withAnimation {
                    signInMethod = .email
                    viewMode = .signIn
                    resetCode = ""
                    newPassword = ""
                    confirmNewPassword = ""
                }
            } label: {
                Text("Back to Sign In")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical)
    }

    // MARK: - Phone Sign-In Section

    @ViewBuilder
    private var phoneSignInSection: some View {
        VStack(spacing: 16) {
            // Country code + phone number input
            HStack(spacing: 8) {
                // Country code selector button
                Button {
                    showingCountryPicker = true
                } label: {
                    HStack(spacing: 4) {
                        Text(selectedCountry?.flag ?? "🌍")
                        Text(countryCode)
                        Image(systemName: "chevron.down")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 14)
                    .background(.accent.opacity(0.1))
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                }

                // Phone number input
                TextField("Phone Number", text: $phoneNumber)
                    .keyboardType(.phonePad)
                    .textContentType(.telephoneNumber)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 14)
                    .background(.accent.opacity(0.1))
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .onChange(of: phoneNumber) { _, newValue in
                        // Remove spaces from auto-filled phone numbers
                        let cleaned = newValue.replacingOccurrences(of: " ", with: "")
                        if cleaned != newValue {
                            phoneNumber = cleaned
                        }
                    }
            }

            // Send verification code button
            Button {
                sendPhoneCode()
            } label: {
                HStack {
                    if loadingState == .sendingCode {
                        ProgressView()
                            .tint(.white)
                    }
                    Text(loadingState == .sendingCode ? "Sending..." : "Send Verification Code")
                }
            }
            .buttonStyle(.swPrimary)
            .disabled(!isValidPhone || loadingState == .sendingCode)

            // Social sign-in area
            socialSignInSection
        }
        .padding(.vertical)
    }

    // MARK: - Phone Verify Section

    @ViewBuilder
    private var phoneVerifySection: some View {
        VStack(spacing: 16) {
            // 6-digit verification code input
            TextField("000000", text: $verificationCode)
                .keyboardType(.numberPad)
                .textContentType(.oneTimeCode)
                .focused($isCodeFocused)
                .multilineTextAlignment(.center)
                .font(.title2.monospacedDigit())
                .padding(.vertical, 16)
                .background(.accent.opacity(0.1))
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .onChange(of: verificationCode) { _, newValue in
                    verificationCode = String(newValue.filter(\.isNumber).prefix(6))
                }

            // Verify button
            Button {
                verifyPhoneCode()
            } label: {
                HStack {
                    if loadingState == .verifying {
                        ProgressView()
                            .tint(.white)
                    }
                    Text(loadingState == .verifying ? "Verifying..." : "Verify Phone")
                }
            }
            .buttonStyle(.swPrimary)
            .disabled(!isValidCode || loadingState == .verifying)

            // Resend verification code
            Button {
                resendPhoneCode()
            } label: {
                HStack {
                    if isResending {
                        ProgressView()
                    }
                    Text("Resend Code")
                }
                .font(.subheadline)
                .foregroundStyle(Color.accentColor)
            }
            .disabled(isResending)

            // Back to phone sign-in
            Button {
                withAnimation {
                    viewMode = .phoneSignIn
                    verificationCode = ""
                }
            } label: {
                Text("Back")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical)
        .task {
            try? await Task.sleep(for: .milliseconds(300))
            isCodeFocused = true
        }
    }

    // MARK: - Country Code Picker

    private var countryCodePicker: some View {
        // Filter countries by search text
        let filteredCountries: [SWCountry] = countrySearchText.isEmpty
            ? SWCountryData.allCountries
            : SWCountryData.allCountries.filter {
                $0.name.localizedCaseInsensitiveContains(countrySearchText) ||
                $0.code.contains(countrySearchText)
            }
        let groupedCountries = Dictionary(grouping: filteredCountries) { country in
            String(country.name.prefix(1)).uppercased()
        }.sorted { $0.key < $1.key }

        return NavigationStack {
            List {
                ForEach(groupedCountries, id: \.key) { letter, countries in
                    Section(header: Text(letter)) {
                        ForEach(countries, id: \.name) { country in
                            Button {
                                countryName = country.name
                                countrySearchText = ""
                                showingCountryPicker = false
                            } label: {
                                HStack {
                                    Text(country.flag)
                                        .font(.title2)
                                    HStack(spacing: 8) {
                                        Text(country.name)
                                            .foregroundStyle(.primary)
                                        Text(country.code)
                                            .foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    if countryName == country.name {
                                        Image(systemName: "checkmark")
                                            .foregroundStyle(Color.accentColor)
                                    }
                                }
                            }
                        }
                    }
                }
            }
            .searchable(text: $countrySearchText, prompt: "Search")
            .tint(.primary)
            .navigationTitle("Select Country")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        countrySearchText = ""
                        showingCountryPicker = false
                    }
                }
            }
        }
    }

    // MARK: - Social Sign-In Section

    @ViewBuilder
    private var socialSignInSection: some View {
        VStack(spacing: 16) {
            // Divider
            HStack {
                Rectangle()
                    .fill(.tertiary)
                    .frame(height: 1)
                Text("or continue with")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Rectangle()
                    .fill(.tertiary)
                    .frame(height: 1)
            }
            .padding(.top, 16)

            // Social sign-in buttons
            HStack(spacing: 12) {
                // Apple sign-in
                Button {
                    signInWithApple()
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "apple.logo")
                            .font(.system(size: 18))
                        Text("Apple")
                    }
                }
                .buttonStyle(.swSecondary)

                // Google sign-in
                Button {
                    signInWithGoogle()
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "g.circle.fill")
                            .font(.system(size: 18))
                        Text("Google")
                    }
                }
                .buttonStyle(.swSecondary)
            }

            // User agreement
            SWAgreementChecker(agreementChecked: $agreementChecked)
        }
    }

    // MARK: - Actions

    private func demoGuard() -> Bool {
        guard isDemo else { return false }
        SWAlertManager.shared.show(.info, message: "UI Demo — auth actions are not functional")
        return true
    }

    private func signInWithEmail() {
        guard !demoGuard() else { return }
        guard agreementChecked else {
            SWAlertManager.shared.show(.error, message: "Please agree to the Terms of Service and Privacy Policy")
            return
        }
        loadingState = .signingIn
        Task {
            defer { loadingState = .idle }
            do {
                try await userManager.signIn(email: email, password: password)
            } catch {
                SWAlertManager.shared.show(.error, message: SWAuthErrorHelper.displayMessage(for: error))
            }
        }
    }

    private func signUpWithEmail() {
        guard !demoGuard() else { return }
        guard agreementChecked else {
            SWAlertManager.shared.show(.error, message: "Please agree to the Terms of Service and Privacy Policy")
            return
        }
        loadingState = .signingIn
        Task {
            defer { loadingState = .idle }
            do {
                try await userManager.signUp(email: email, password: password)
                withAnimation {
                    viewMode = .confirmSignUp
                }
            } catch {
                SWAlertManager.shared.show(.error, message: SWAuthErrorHelper.displayMessage(for: error))
            }
        }
    }

    private func confirmSignUp() {
        guard !demoGuard() else { return }
        loadingState = .verifying
        Task {
            defer { loadingState = .idle }
            do {
                try await userManager.confirmSignUp(email: email, code: verificationCode)
                try await userManager.signIn(email: email, password: password)
            } catch {
                SWAlertManager.shared.show(.error, message: SWAuthErrorHelper.displayMessage(for: error))
            }
        }
    }

    private func resendEmailCode() {
        guard !demoGuard() else { return }
        loadingState = .sendingCode
        Task {
            defer { loadingState = .idle }
            do {
                try await userManager.resendSignUpCode(email: email)
                SWAlertManager.shared.show(.success, message: "Code sent to \(email)")
            } catch {
                SWAlertManager.shared.show(.error, message: SWAuthErrorHelper.displayMessage(for: error))
            }
        }
    }

    private func sendResetCode() {
        guard !demoGuard() else { return }
        loadingState = .sendingCode
        Task {
            defer { loadingState = .idle }
            do {
                try await userManager.forgotPassword(email: email)
                withAnimation {
                    viewMode = .resetPassword
                }
            } catch {
                SWAlertManager.shared.show(.error, message: SWAuthErrorHelper.displayMessage(for: error))
            }
        }
    }

    private func confirmResetPassword() {
        guard !demoGuard() else { return }
        loadingState = .verifying
        Task {
            defer { loadingState = .idle }
            do {
                try await userManager.confirmResetPassword(email: email, newPassword: newPassword, code: resetCode)
                SWAlertManager.shared.show(.success, message: "Password reset successfully")
                withAnimation {
                    signInMethod = .email
                    viewMode = .signIn
                    resetCode = ""
                    newPassword = ""
                    confirmNewPassword = ""
                    password = ""
                }
            } catch {
                SWAlertManager.shared.show(.error, message: SWAuthErrorHelper.displayMessage(for: error))
            }
        }
    }

    // MARK: - Phone Actions

    private func sendPhoneCode() {
        guard !demoGuard() else { return }
        guard agreementChecked else {
            SWAlertManager.shared.show(.error, message: "Please agree to the Terms of Service and Privacy Policy")
            return
        }
        loadingState = .sendingCode
        Task {
            defer { loadingState = .idle }
            do {
                try await userManager.sendPhoneVerificationCode(phoneNumber: fullPhoneNumber)
                withAnimation { viewMode = .phoneVerify }
                SWAlertManager.shared.show(.success, message: "Code sent to \(fullPhoneNumber)")
            } catch {
                SWAlertManager.shared.show(.error, message: SWAuthErrorHelper.displayMessage(for: error))
            }
        }
    }

    private func verifyPhoneCode() {
        guard !demoGuard() else { return }
        loadingState = .verifying
        Task {
            defer { loadingState = .idle }
            do {
                try await userManager.confirmPhoneSignIn(phoneNumber: fullPhoneNumber, code: verificationCode)
            } catch {
                SWAlertManager.shared.show(.error, message: SWAuthErrorHelper.displayMessage(for: error))
            }
        }
    }

    private func resendPhoneCode() {
        guard !demoGuard() else { return }
        isResending = true
        Task {
            defer { isResending = false }
            do {
                try await userManager.sendPhoneVerificationCode(phoneNumber: fullPhoneNumber)
                SWAlertManager.shared.show(.success, message: "Code sent to \(fullPhoneNumber)")
            } catch {
                SWAlertManager.shared.show(.error, message: SWAuthErrorHelper.displayMessage(for: error))
            }
        }
    }

    private func signInWithApple() {
        guard !demoGuard() else { return }
        guard agreementChecked else {
            SWAlertManager.shared.show(.error, message: "Please agree to the Terms of Service and Privacy Policy")
            return
        }
        Task {
            do {
                try await userManager.signInWithApple()
            } catch {
                SWAlertManager.shared.show(.error, message: SWAuthErrorHelper.displayMessage(for: error))
            }
        }
    }

    private func signInWithGoogle() {
        guard !demoGuard() else { return }
        guard agreementChecked else {
            SWAlertManager.shared.show(.error, message: "Please agree to the Terms of Service and Privacy Policy")
            return
        }
        Task {
            do {
                try await userManager.signInWithGoogle()
            } catch {
                SWAlertManager.shared.show(.error, message: SWAuthErrorHelper.displayMessage(for: error))
            }
        }
    }
    // MARK: - Helpers

    /// Sign-in method toggle button: selected state uses accentColor + capsule background; unselected uses secondary
    private func signInMethodButton(_ method: SignInMethod, icon: String, label: String) -> some View {
        Button {
            withAnimation { signInMethod = method }
        } label: {
            HStack(spacing: 6) {
                Image(systemName: icon)
                Text(label)
            }
            .font(.subheadline)
            .fontWeight(signInMethod == method ? .medium : .regular)
            .foregroundStyle(signInMethod == method ? Color.accentColor : .secondary)
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .background(
                signInMethod == method ? Color.accentColor.opacity(0.1) : Color.clear,
                in: Capsule()
            )
        }
    }
}

#Preview {
    SWAuthView()
        .environment(SWUserManager(skipAuthCheck: true))
}

// MARK: - Auth Error Localization

/// Converts auth errors to user-friendly messages.
/// Scoped to this file to avoid polluting the global Error namespace in consuming apps.
private enum SWAuthErrorHelper {

    /// Returns a user-friendly message for any error thrown by Amplify Auth operations
    static func displayMessage(for error: Error) -> String {
        if let authError = error as? AuthError {
            if let cognitoError = authError.underlyingError as? AWSCognitoAuthError {
                return cognitoMessage(for: cognitoError)
            }
            return authMessage(for: authError)
        }
        return error.localizedDescription
    }

    // MARK: - AuthError Messages

    private static func authMessage(for error: AuthError) -> String {
        switch error {
        case .notAuthorized:
            return "Incorrect email or password"
        case .signedOut:
            return "Please sign in first"
        case .validation:
            return "Invalid input"
        case .configuration:
            return "App configuration error"
        case .service, .unknown, .invalidState:
            let desc = error.errorDescription.lowercased()
            if desc.contains("incorrect username or password") {
                return "Incorrect email or password"
            }
            if desc.contains("user does not exist") || desc.contains("user not found") {
                return "This email is not registered"
            }
            if desc.contains("user is not confirmed") {
                return "Please verify your email first"
            }
            return "Service error, please try again"
        default:
            return "Operation failed, please try again"
        }
    }

    // MARK: - AWSCognitoAuthError Messages

    private static func cognitoMessage(for error: AWSCognitoAuthError) -> String {
        switch error {
        case .userNotFound:
            return "This email is not registered"
        case .userNotConfirmed:
            return "Please verify your email first"
        case .usernameExists:
            return "This email is already registered"
        case .codeDelivery:
            return "Failed to send verification code"
        case .codeMismatch:
            return "Incorrect verification code"
        case .codeExpired:
            return "Verification code expired"
        case .invalidPassword:
            return "Password must be at least 8 characters"
        case .limitExceeded, .failedAttemptsLimitExceeded, .requestLimitExceeded, .limitExceededException:
            return "Too many attempts, please try again later"
        case .network, .lambda, .externalServiceException:
            return "Network error, please try again"
        default:
            return "An error occurred, please try again"
        }
    }
}
```

#### 3. SWAuthView+macOS.swift — Authentication panel (macOS)

The macOS counterpart: a centered 380pt panel with native control styles and the same flows minus phone sign-in.

```swift
import SwiftUI
import Amplify
import AWSCognitoAuthPlugin

struct SWAuthView: View {

    var isDemo: Bool = false

    // MARK: - Environment

    @Environment(SWUserManager.self) private var userManager

    // MARK: - View Mode

    private enum ViewMode {
        case signIn
        case signUp
        case confirmSignUp
        case forgotPassword
        case resetPassword
    }

    private enum LoadingState {
        case idle
        case sendingCode
        case verifying
        case signingIn
    }

    // MARK: - State

    @State private var viewMode: ViewMode = .signIn
    @State private var loadingState: LoadingState = .idle
    @State private var agreementChecked = false

    @State private var email = ""
    @State private var password = ""
    @State private var confirmPassword = ""
    @State private var verificationCode = ""
    @FocusState private var isCodeFocused: Bool

    @State private var newPassword = ""
    @State private var confirmNewPassword = ""
    @State private var resetCode = ""

    // MARK: - Validation

    private var isValidEmail: Bool {
        email.range(of: #"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$"#,
                    options: .regularExpression) != nil
    }
    private var isValidPassword: Bool { password.count >= 8 }
    private var passwordsMatch: Bool { password == confirmPassword }
    private var isValidCode: Bool { verificationCode.count == 6 }
    private var isValidResetCode: Bool { resetCode.count == 6 }
    private var isValidNewPassword: Bool { newPassword.count >= 8 }
    private var newPasswordsMatch: Bool { newPassword == confirmNewPassword }

    private var isEmailFormValid: Bool {
        viewMode == .signUp
            ? isValidEmail && isValidPassword && passwordsMatch
            : isValidEmail && isValidPassword
    }

    // MARK: - Body

    var body: some View {
        ZStack {
            Color(NSColor.windowBackgroundColor).ignoresSafeArea()

            ScrollView {
                VStack(spacing: 0) {
                    Spacer(minLength: 40)
                    panel
                    Spacer(minLength: 40)
                }
                .frame(maxWidth: .infinity)
            }
        }
    }

    // MARK: - Panel

    private var panel: some View {
        VStack(spacing: 28) {
            header

            switch viewMode {
            case .signIn:         signInSection
            case .signUp:         signUpSection
            case .confirmSignUp:  confirmSignUpSection
            case .forgotPassword: forgotPasswordSection
            case .resetPassword:  resetPasswordSection
            }
        }
        .padding(36)
        .frame(maxWidth: 380)
        .background(Color(NSColor.controlBackgroundColor))
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .shadow(color: .black.opacity(0.08), radius: 16, x: 0, y: 4)
    }

    // MARK: - Header

    private var header: some View {
        VStack(spacing: 8) {
            Image(systemName: "person.circle.fill")
                .resizable()
                .scaledToFit()
                .frame(width: 56, height: 56)
                .foregroundStyle(Color.accentColor)

            Text(headerTitle)
                .font(.title2)
                .fontWeight(.semibold)

            Text(headerSubtitle)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
    }

    private var headerTitle: String {
        switch viewMode {
        case .signIn:         "Welcome Back"
        case .signUp:         "Create Account"
        case .confirmSignUp:  "Verify Email"
        case .forgotPassword: "Forgot Password"
        case .resetPassword:  "Reset Password"
        }
    }

    private var headerSubtitle: String {
        switch viewMode {
        case .signIn:         "Sign in to continue"
        case .signUp:         "Sign up with your email"
        case .confirmSignUp:  "Enter the 6-digit code sent to \(email)"
        case .forgotPassword: "Enter your email to receive a reset code"
        case .resetPassword:  "Enter the code and your new password"
        }
    }

    // MARK: - Sign In

    private var signInSection: some View {
        VStack(spacing: 16) {
            emailField
            passwordField(text: $password, placeholder: "Password", newPassword: false)

            SWAgreementChecker(agreementChecked: $agreementChecked)

            primaryButton(
                title: "Sign In",
                loadingTitle: "Signing In…",
                isLoading: loadingState == .signingIn,
                disabled: !isEmailFormValid || !agreementChecked
            ) { signInWithEmail() }

            HStack(spacing: 20) {
                linkButton("Forgot Password?") {
                    withAnimation { viewMode = .forgotPassword }
                }
                linkButton("Create Account") {
                    withAnimation { viewMode = .signUp; confirmPassword = "" }
                }
            }

            socialDivider

            socialButtons
        }
    }

    // MARK: - Sign Up

    private var signUpSection: some View {
        VStack(spacing: 12) {
            emailField
            passwordField(text: $password, placeholder: "Password", newPassword: true)

            if !password.isEmpty {
                passwordHint(valid: isValidPassword)
            }

            passwordField(text: $confirmPassword, placeholder: "Confirm Password", newPassword: true)

            if !confirmPassword.isEmpty && !passwordsMatch {
                Text("Passwords do not match")
                    .font(.caption)
                    .foregroundStyle(.red)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }

            SWAgreementChecker(agreementChecked: $agreementChecked)

            primaryButton(
                title: "Create Account",
                loadingTitle: "Creating…",
                isLoading: loadingState == .signingIn,
                disabled: !isEmailFormValid || !agreementChecked
            ) { signUpWithEmail() }

            linkButton("Already have an account? Sign In") {
                withAnimation { viewMode = .signIn }
            }
        }
    }

    // MARK: - Confirm Sign Up

    private var confirmSignUpSection: some View {
        VStack(spacing: 16) {
            codeField(text: $verificationCode)

            primaryButton(
                title: "Verify Email",
                loadingTitle: "Verifying…",
                isLoading: loadingState == .verifying,
                disabled: !isValidCode
            ) { confirmSignUp() }

            HStack(spacing: 20) {
                linkButton("Resend Code") { resendEmailCode() }
                linkButton("Back to Sign In") {
                    withAnimation { viewMode = .signIn; verificationCode = "" }
                }
            }
        }
        .task {
            try? await Task.sleep(for: .milliseconds(300))
            isCodeFocused = true
        }
    }

    // MARK: - Forgot Password

    private var forgotPasswordSection: some View {
        VStack(spacing: 16) {
            emailField

            primaryButton(
                title: "Send Reset Code",
                loadingTitle: "Sending…",
                isLoading: loadingState == .sendingCode,
                disabled: !isValidEmail
            ) { sendResetCode() }

            backToSignIn
        }
    }

    // MARK: - Reset Password

    private var resetPasswordSection: some View {
        VStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Verification Code").font(.caption).foregroundStyle(.secondary)
                codeField(text: $resetCode)
            }

            VStack(alignment: .leading, spacing: 4) {
                Text("New Password").font(.caption).foregroundStyle(.secondary)
                passwordField(text: $newPassword, placeholder: "New Password", newPassword: true)
            }

            if !newPassword.isEmpty {
                passwordHint(valid: isValidNewPassword)
            }

            VStack(alignment: .leading, spacing: 4) {
                Text("Confirm New Password").font(.caption).foregroundStyle(.secondary)
                passwordField(text: $confirmNewPassword, placeholder: "Confirm New Password", newPassword: true)
                if !confirmNewPassword.isEmpty && !newPasswordsMatch {
                    Text("Passwords do not match")
                        .font(.caption)
                        .foregroundStyle(.red)
                }
            }

            primaryButton(
                title: "Reset Password",
                loadingTitle: "Resetting…",
                isLoading: loadingState == .verifying,
                disabled: !isValidResetCode || !isValidNewPassword || !newPasswordsMatch
            ) { confirmResetPassword() }

            backToSignIn
        }
    }

    // MARK: - Reusable Controls

    private var emailField: some View {
        TextField("Email", text: $email)
            .textContentType(.emailAddress)
            .autocorrectionDisabled()
            .textFieldStyle(.roundedBorder)
    }

    private func passwordField(text: Binding<String>, placeholder: String, newPassword: Bool) -> some View {
        SecureField(placeholder, text: text)
            .textContentType(newPassword ? .newPassword : .password)
            .textFieldStyle(.roundedBorder)
    }

    private func codeField(text: Binding<String>) -> some View {
        TextField("000000", text: text)
            .textContentType(.oneTimeCode)
            .focused($isCodeFocused)
            .multilineTextAlignment(.center)
            .font(.title2.monospacedDigit())
            .textFieldStyle(.roundedBorder)
            .onChange(of: text.wrappedValue) { _, newValue in
                text.wrappedValue = String(newValue.filter(\.isNumber).prefix(6))
            }
    }

    private func passwordHint(valid: Bool) -> some View {
        HStack(spacing: 4) {
            Image(systemName: valid ? "checkmark.circle.fill" : "circle")
                .foregroundStyle(valid ? .green : .secondary)
            Text("At least 8 characters")
                .foregroundStyle(valid ? .primary : .secondary)
        }
        .font(.caption)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func primaryButton(
        title: String,
        loadingTitle: String,
        isLoading: Bool,
        disabled: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if isLoading { ProgressView().controlSize(.small) }
                Text(isLoading ? loadingTitle : title)
                    .frame(maxWidth: .infinity)
            }
        }
        .buttonStyle(.borderedProminent)
        .controlSize(.large)
        .disabled(disabled || isLoading)
    }

    private func linkButton(_ title: String, action: @escaping () -> Void) -> some View {
        Button(title, action: action)
            .buttonStyle(.plain)
            .font(.subheadline)
            .foregroundStyle(Color.accentColor)
    }

    private var backToSignIn: some View {
        linkButton("Back to Sign In") {
            withAnimation {
                viewMode = .signIn
                verificationCode = ""
                resetCode = ""
                newPassword = ""
                confirmNewPassword = ""
            }
        }
    }

    private var socialDivider: some View {
        HStack {
            Rectangle().fill(.tertiary).frame(height: 1)
            Text("or continue with")
                .font(.caption)
                .foregroundStyle(.secondary)
            Rectangle().fill(.tertiary).frame(height: 1)
        }
    }

    private var socialButtons: some View {
        HStack(spacing: 12) {
            Button {
                signInWithApple()
            } label: {
                Label("Apple", systemImage: "apple.logo")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .controlSize(.large)

            Button {
                signInWithGoogle()
            } label: {
                Label("Google", systemImage: "g.circle.fill")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .controlSize(.large)
        }
    }

    // MARK: - Actions

    private func demoGuard() -> Bool {
        guard isDemo else { return false }
        SWAlertManager.shared.show(.info, message: "UI Demo — auth actions are not functional")
        return true
    }

    private func signInWithEmail() {
        guard !demoGuard() else { return }
        guard agreementChecked else {
            SWAlertManager.shared.show(.error, message: "Please agree to the Terms of Service and Privacy Policy")
            return
        }
        loadingState = .signingIn
        Task {
            defer { loadingState = .idle }
            do {
                try await userManager.signIn(email: email, password: password)
            } catch {
                SWAlertManager.shared.show(.error, message: SWMacAuthErrorHelper.displayMessage(for: error))
            }
        }
    }

    private func signUpWithEmail() {
        guard !demoGuard() else { return }
        guard agreementChecked else {
            SWAlertManager.shared.show(.error, message: "Please agree to the Terms of Service and Privacy Policy")
            return
        }
        loadingState = .signingIn
        Task {
            defer { loadingState = .idle }
            do {
                try await userManager.signUp(email: email, password: password)
                withAnimation { viewMode = .confirmSignUp }
            } catch {
                SWAlertManager.shared.show(.error, message: SWMacAuthErrorHelper.displayMessage(for: error))
            }
        }
    }

    private func confirmSignUp() {
        guard !demoGuard() else { return }
        loadingState = .verifying
        Task {
            defer { loadingState = .idle }
            do {
                try await userManager.confirmSignUp(email: email, code: verificationCode)
                try await userManager.signIn(email: email, password: password)
            } catch {
                SWAlertManager.shared.show(.error, message: SWMacAuthErrorHelper.displayMessage(for: error))
            }
        }
    }

    private func resendEmailCode() {
        guard !demoGuard() else { return }
        Task {
            do {
                try await userManager.resendSignUpCode(email: email)
                SWAlertManager.shared.show(.success, message: "Code sent to \(email)")
            } catch {
                SWAlertManager.shared.show(.error, message: SWMacAuthErrorHelper.displayMessage(for: error))
            }
        }
    }

    private func sendResetCode() {
        guard !demoGuard() else { return }
        loadingState = .sendingCode
        Task {
            defer { loadingState = .idle }
            do {
                try await userManager.forgotPassword(email: email)
                withAnimation { viewMode = .resetPassword }
            } catch {
                SWAlertManager.shared.show(.error, message: SWMacAuthErrorHelper.displayMessage(for: error))
            }
        }
    }

    private func confirmResetPassword() {
        guard !demoGuard() else { return }
        loadingState = .verifying
        Task {
            defer { loadingState = .idle }
            do {
                try await userManager.confirmResetPassword(email: email, newPassword: newPassword, code: resetCode)
                SWAlertManager.shared.show(.success, message: "Password reset successfully")
                withAnimation {
                    viewMode = .signIn
                    resetCode = ""
                    newPassword = ""
                    confirmNewPassword = ""
                    password = ""
                }
            } catch {
                SWAlertManager.shared.show(.error, message: SWMacAuthErrorHelper.displayMessage(for: error))
            }
        }
    }

    private func signInWithApple() {
        guard !demoGuard() else { return }
        guard agreementChecked else {
            SWAlertManager.shared.show(.error, message: "Please agree to the Terms of Service and Privacy Policy")
            return
        }
        Task {
            do {
                try await userManager.signInWithApple()
            } catch {
                SWAlertManager.shared.show(.error, message: SWMacAuthErrorHelper.displayMessage(for: error))
            }
        }
    }

    private func signInWithGoogle() {
        guard !demoGuard() else { return }
        guard agreementChecked else {
            SWAlertManager.shared.show(.error, message: "Please agree to the Terms of Service and Privacy Policy")
            return
        }
        Task {
            do {
                try await userManager.signInWithGoogle()
            } catch {
                SWAlertManager.shared.show(.error, message: SWMacAuthErrorHelper.displayMessage(for: error))
            }
        }
    }
}

#Preview {
    SWAuthView()
        .environment(SWUserManager(skipAuthCheck: true))
        .frame(width: 600, height: 700)
}

// MARK: - Auth Error Localization

private enum SWMacAuthErrorHelper {

    static func displayMessage(for error: Error) -> String {
        if let authError = error as? AuthError {
            if let cognitoError = authError.underlyingError as? AWSCognitoAuthError {
                return cognitoMessage(for: cognitoError)
            }
            return authMessage(for: authError)
        }
        return error.localizedDescription
    }

    private static func authMessage(for error: AuthError) -> String {
        switch error {
        case .notAuthorized:   return "Incorrect email or password"
        case .signedOut:       return "Please sign in first"
        case .validation:      return "Invalid input"
        case .configuration:   return "App configuration error"
        default:
            let desc = error.errorDescription.lowercased()
            if desc.contains("incorrect username or password") { return "Incorrect email or password" }
            if desc.contains("user does not exist")            { return "This email is not registered" }
            if desc.contains("user is not confirmed")          { return "Please verify your email first" }
            return "Service error, please try again"
        }
    }

    private static func cognitoMessage(for error: AWSCognitoAuthError) -> String {
        switch error {
        case .userNotFound:        return "This email is not registered"
        case .userNotConfirmed:    return "Please verify your email first"
        case .usernameExists:      return "This email is already registered"
        case .codeDelivery:        return "Failed to send verification code"
        case .codeMismatch:        return "Incorrect verification code"
        case .codeExpired:         return "Verification code expired"
        case .invalidPassword:     return "Password must be at least 8 characters"
        case .limitExceeded, .failedAttemptsLimitExceeded, .requestLimitExceeded, .limitExceededException:
            return "Too many attempts, please try again later"
        case .network, .lambda, .externalServiceException:
            return "Network error, please try again"
        default:                   return "An error occurred, please try again"
        }
    }
}
```

#### 4. SWAgreementChecker.swift — Terms of Service checkbox

`termsURL` and `privacyURL` default to ShipSwift's pages; pass your own.

```swift
import SwiftUI

struct SWAgreementChecker: View {
    @Binding var agreementChecked: Bool

    var termsURL: URL = URL(string: "https://shipswift.app/terms")!
    var privacyURL: URL = URL(string: "https://shipswift.app/privacy")!

    var body: some View {
        HStack(spacing: 6) {
            Button {
                agreementChecked.toggle()
            } label: {
                Image(systemName: agreementChecked ? "checkmark.circle.fill" : "circle")
                    .imageScale(.small)
            }
            .buttonStyle(.plain)

            HStack(spacing: 4) {
                Text("I agree to")
                    .foregroundStyle(.secondary)
                Link("Terms of Service", destination: termsURL)
                Text("and")
                    .foregroundStyle(.secondary)
                Link("Privacy Policy", destination: privacyURL)
            }
            .font(.caption2)
            .lineLimit(1)
        }
        .padding(.top, 4)
    }
}
```

#### 5. SWCountryData.swift — Phone country codes

Several countries share a dial code (`+1`, `+7`), so `flag(for:)` and `phoneLength(for:)` return the first match for that code; `SWAuthView+iOS.swift` therefore tracks the selected country by name.

```swift
import Foundation

struct SWCountry {
    let code: String
    let flag: String
    let name: String
    let phoneLength: ClosedRange<Int>
}

struct SWCountryData {
    /// Look up country flag by phone code
    static func flag(for code: String) -> String {
        allCountries.first { $0.code == code }?.flag ?? "🌍"
    }

    /// Get phone number length range by country code
    static func phoneLength(for code: String) -> ClosedRange<Int> {
        allCountries.first { $0.code == code }?.phoneLength ?? 8...12
    }

    static let allCountries: [SWCountry] = [
        // A
        SWCountry(code: "+93", flag: "🇦🇫", name: "Afghanistan", phoneLength: 9...9),
        SWCountry(code: "+355", flag: "🇦🇱", name: "Albania", phoneLength: 9...9),
        SWCountry(code: "+213", flag: "🇩🇿", name: "Algeria", phoneLength: 9...9),
        SWCountry(code: "+1", flag: "🇦🇸", name: "American Samoa", phoneLength: 10...10),
        SWCountry(code: "+376", flag: "🇦🇩", name: "Andorra", phoneLength: 6...9),
        SWCountry(code: "+244", flag: "🇦🇴", name: "Angola", phoneLength: 9...9),
        SWCountry(code: "+1", flag: "🇦🇮", name: "Anguilla", phoneLength: 10...10),
        SWCountry(code: "+1", flag: "🇦🇬", name: "Antigua and Barbuda", phoneLength: 10...10),
        SWCountry(code: "+54", flag: "🇦🇷", name: "Argentina", phoneLength: 10...10),
        SWCountry(code: "+374", flag: "🇦🇲", name: "Armenia", phoneLength: 8...8),
        SWCountry(code: "+297", flag: "🇦🇼", name: "Aruba", phoneLength: 7...7),
        SWCountry(code: "+61", flag: "🇦🇺", name: "Australia", phoneLength: 9...9),
        SWCountry(code: "+43", flag: "🇦🇹", name: "Austria", phoneLength: 10...11),
        SWCountry(code: "+994", flag: "🇦🇿", name: "Azerbaijan", phoneLength: 9...9),

        // B
        SWCountry(code: "+1", flag: "🇧🇸", name: "Bahamas", phoneLength: 10...10),
        SWCountry(code: "+973", flag: "🇧🇭", name: "Bahrain", phoneLength: 8...8),
        SWCountry(code: "+880", flag: "🇧🇩", name: "Bangladesh", phoneLength: 10...10),
        SWCountry(code: "+1", flag: "🇧🇧", name: "Barbados", phoneLength: 10...10),
        SWCountry(code: "+375", flag: "🇧🇾", name: "Belarus", phoneLength: 9...9),
        SWCountry(code: "+32", flag: "🇧🇪", name: "Belgium", phoneLength: 9...9),
        SWCountry(code: "+501", flag: "🇧🇿", name: "Belize", phoneLength: 7...7),
        SWCountry(code: "+229", flag: "🇧🇯", name: "Benin", phoneLength: 8...8),
        SWCountry(code: "+1", flag: "🇧🇲", name: "Bermuda", phoneLength: 10...10),
        SWCountry(code: "+975", flag: "🇧🇹", name: "Bhutan", phoneLength: 8...8),
        SWCountry(code: "+591", flag: "🇧🇴", name: "Bolivia", phoneLength: 8...8),
        SWCountry(code: "+387", flag: "🇧🇦", name: "Bosnia and Herzegovina", phoneLength: 8...9),
        SWCountry(code: "+267", flag: "🇧🇼", name: "Botswana", phoneLength: 8...8),
        SWCountry(code: "+55", flag: "🇧🇷", name: "Brazil", phoneLength: 10...11),
        SWCountry(code: "+1", flag: "🇻🇬", name: "British Virgin Islands", phoneLength: 10...10),
        SWCountry(code: "+673", flag: "🇧🇳", name: "Brunei", phoneLength: 7...7),
        SWCountry(code: "+359", flag: "🇧🇬", name: "Bulgaria", phoneLength: 9...9),
        SWCountry(code: "+226", flag: "🇧🇫", name: "Burkina Faso", phoneLength: 8...8),
        SWCountry(code: "+257", flag: "🇧🇮", name: "Burundi", phoneLength: 8...8),

        // C
        SWCountry(code: "+855", flag: "🇰🇭", name: "Cambodia", phoneLength: 8...9),
        SWCountry(code: "+237", flag: "🇨🇲", name: "Cameroon", phoneLength: 9...9),
        SWCountry(code: "+1", flag: "🇨🇦", name: "Canada", phoneLength: 10...10),
        SWCountry(code: "+238", flag: "🇨🇻", name: "Cape Verde", phoneLength: 7...7),
        SWCountry(code: "+1", flag: "🇰🇾", name: "Cayman Islands", phoneLength: 10...10),
        SWCountry(code: "+236", flag: "🇨🇫", name: "Central African Republic", phoneLength: 8...8),
        SWCountry(code: "+235", flag: "🇹🇩", name: "Chad", phoneLength: 8...8),
        SWCountry(code: "+56", flag: "🇨🇱", name: "Chile", phoneLength: 9...9),
        SWCountry(code: "+86", flag: "🇨🇳", name: "China", phoneLength: 11...11),
        SWCountry(code: "+57", flag: "🇨🇴", name: "Colombia", phoneLength: 10...10),
        SWCountry(code: "+269", flag: "🇰🇲", name: "Comoros", phoneLength: 7...7),
        SWCountry(code: "+242", flag: "🇨🇬", name: "Congo", phoneLength: 9...9),
        SWCountry(code: "+243", flag: "🇨🇩", name: "Congo (DRC)", phoneLength: 9...9),
        SWCountry(code: "+682", flag: "🇨🇰", name: "Cook Islands", phoneLength: 5...5),
        SWCountry(code: "+506", flag: "🇨🇷", name: "Costa Rica", phoneLength: 8...8),
        SWCountry(code: "+225", flag: "🇨🇮", name: "Côte d'Ivoire", phoneLength: 10...10),
        SWCountry(code: "+385", flag: "🇭🇷", name: "Croatia", phoneLength: 9...9),
        SWCountry(code: "+53", flag: "🇨🇺", name: "Cuba", phoneLength: 8...8),
        SWCountry(code: "+357", flag: "🇨🇾", name: "Cyprus", phoneLength: 8...8),
        SWCountry(code: "+420", flag: "🇨🇿", name: "Czech Republic", phoneLength: 9...9),

        // D
        SWCountry(code: "+45", flag: "🇩🇰", name: "Denmark", phoneLength: 8...8),
        SWCountry(code: "+253", flag: "🇩🇯", name: "Djibouti", phoneLength: 8...8),
        SWCountry(code: "+1", flag: "🇩🇲", name: "Dominica", phoneLength: 10...10),
        SWCountry(code: "+1", flag: "🇩🇴", name: "Dominican Republic", phoneLength: 10...10),

        // E
        SWCountry(code: "+593", flag: "🇪🇨", name: "Ecuador", phoneLength: 9...9),
        SWCountry(code: "+20", flag: "🇪🇬", name: "Egypt", phoneLength: 10...10),
        SWCountry(code: "+503", flag: "🇸🇻", name: "El Salvador", phoneLength: 8...8),
        SWCountry(code: "+240", flag: "🇬🇶", name: "Equatorial Guinea", phoneLength: 9...9),
        SWCountry(code: "+291", flag: "🇪🇷", name: "Eritrea", phoneLength: 7...7),
        SWCountry(code: "+372", flag: "🇪🇪", name: "Estonia", phoneLength: 7...8),
        SWCountry(code: "+251", flag: "🇪🇹", name: "Ethiopia", phoneLength: 9...9),

        // F
        SWCountry(code: "+500", flag: "🇫🇰", name: "Falkland Islands", phoneLength: 5...5),
        SWCountry(code: "+298", flag: "🇫🇴", name: "Faroe Islands", phoneLength: 6...6),
        SWCountry(code: "+679", flag: "🇫🇯", name: "Fiji", phoneLength: 7...7),
        SWCountry(code: "+358", flag: "🇫🇮", name: "Finland", phoneLength: 9...10),
        SWCountry(code: "+33", flag: "🇫🇷", name: "France", phoneLength: 9...9),
        SWCountry(code: "+594", flag: "🇬🇫", name: "French Guiana", phoneLength: 9...9),
        SWCountry(code: "+689", flag: "🇵🇫", name: "French Polynesia", phoneLength: 8...8),

        // G
        SWCountry(code: "+241", flag: "🇬🇦", name: "Gabon", phoneLength: 7...8),
        SWCountry(code: "+220", flag: "🇬🇲", name: "Gambia", phoneLength: 7...7),
        SWCountry(code: "+995", flag: "🇬🇪", name: "Georgia", phoneLength: 9...9),
        SWCountry(code: "+49", flag: "🇩🇪", name: "Germany", phoneLength: 10...11),
        SWCountry(code: "+233", flag: "🇬🇭", name: "Ghana", phoneLength: 9...9),
        SWCountry(code: "+350", flag: "🇬🇮", name: "Gibraltar", phoneLength: 8...8),
        SWCountry(code: "+30", flag: "🇬🇷", name: "Greece", phoneLength: 10...10),
        SWCountry(code: "+299", flag: "🇬🇱", name: "Greenland", phoneLength: 6...6),
        SWCountry(code: "+1", flag: "🇬🇩", name: "Grenada", phoneLength: 10...10),
        SWCountry(code: "+590", flag: "🇬🇵", name: "Guadeloupe", phoneLength: 9...9),
        SWCountry(code: "+1", flag: "🇬🇺", name: "Guam", phoneLength: 10...10),
        SWCountry(code: "+502", flag: "🇬🇹", name: "Guatemala", phoneLength: 8...8),
        SWCountry(code: "+224", flag: "🇬🇳", name: "Guinea", phoneLength: 9...9),
        SWCountry(code: "+245", flag: "🇬🇼", name: "Guinea-Bissau", phoneLength: 7...7),
        SWCountry(code: "+592", flag: "🇬🇾", name: "Guyana", phoneLength: 7...7),

        // H
        SWCountry(code: "+509", flag: "🇭🇹", name: "Haiti", phoneLength: 8...8),
        SWCountry(code: "+504", flag: "🇭🇳", name: "Honduras", phoneLength: 8...8),
        SWCountry(code: "+852", flag: "🇭🇰", name: "Hong Kong", phoneLength: 8...8),
        SWCountry(code: "+36", flag: "🇭🇺", name: "Hungary", phoneLength: 9...9),

        // I
        SWCountry(code: "+354", flag: "🇮🇸", name: "Iceland", phoneLength: 7...7),
        SWCountry(code: "+91", flag: "🇮🇳", name: "India", phoneLength: 10...10),
        SWCountry(code: "+62", flag: "🇮🇩", name: "Indonesia", phoneLength: 10...12),
        SWCountry(code: "+98", flag: "🇮🇷", name: "Iran", phoneLength: 10...10),
        SWCountry(code: "+964", flag: "🇮🇶", name: "Iraq", phoneLength: 10...10),
        SWCountry(code: "+353", flag: "🇮🇪", name: "Ireland", phoneLength: 9...9),
        SWCountry(code: "+972", flag: "🇮🇱", name: "Israel", phoneLength: 9...9),
        SWCountry(code: "+39", flag: "🇮🇹", name: "Italy", phoneLength: 10...10),

        // J
        SWCountry(code: "+1", flag: "🇯🇲", name: "Jamaica", phoneLength: 10...10),
        SWCountry(code: "+81", flag: "🇯🇵", name: "Japan", phoneLength: 10...10),
        SWCountry(code: "+962", flag: "🇯🇴", name: "Jordan", phoneLength: 9...9),

        // K
        SWCountry(code: "+7", flag: "🇰🇿", name: "Kazakhstan", phoneLength: 10...10),
        SWCountry(code: "+254", flag: "🇰🇪", name: "Kenya", phoneLength: 9...9),
        SWCountry(code: "+686", flag: "🇰🇮", name: "Kiribati", phoneLength: 8...8),
        SWCountry(code: "+383", flag: "🇽🇰", name: "Kosovo", phoneLength: 8...9),
        SWCountry(code: "+965", flag: "🇰🇼", name: "Kuwait", phoneLength: 8...8),
        SWCountry(code: "+996", flag: "🇰🇬", name: "Kyrgyzstan", phoneLength: 9...9),

        // L
        SWCountry(code: "+856", flag: "🇱🇦", name: "Laos", phoneLength: 10...10),
        SWCountry(code: "+371", flag: "🇱🇻", name: "Latvia", phoneLength: 8...8),
        SWCountry(code: "+961", flag: "🇱🇧", name: "Lebanon", phoneLength: 7...8),
        SWCountry(code: "+266", flag: "🇱🇸", name: "Lesotho", phoneLength: 8...8),
        SWCountry(code: "+231", flag: "🇱🇷", name: "Liberia", phoneLength: 7...8),
        SWCountry(code: "+218", flag: "🇱🇾", name: "Libya", phoneLength: 9...9),
        SWCountry(code: "+423", flag: "🇱🇮", name: "Liechtenstein", phoneLength: 7...7),
        SWCountry(code: "+370", flag: "🇱🇹", name: "Lithuania", phoneLength: 8...8),
        SWCountry(code: "+352", flag: "🇱🇺", name: "Luxembourg", phoneLength: 9...9),

        // M
        SWCountry(code: "+853", flag: "🇲🇴", name: "Macau", phoneLength: 8...8),
        SWCountry(code: "+389", flag: "🇲🇰", name: "Macedonia", phoneLength: 8...8),
        SWCountry(code: "+261", flag: "🇲🇬", name: "Madagascar", phoneLength: 9...9),
        SWCountry(code: "+265", flag: "🇲🇼", name: "Malawi", phoneLength: 9...9),
        SWCountry(code: "+60", flag: "🇲🇾", name: "Malaysia", phoneLength: 9...10),
        SWCountry(code: "+960", flag: "🇲🇻", name: "Maldives", phoneLength: 7...7),
        SWCountry(code: "+223", flag: "🇲🇱", name: "Mali", phoneLength: 8...8),
        SWCountry(code: "+356", flag: "🇲🇹", name: "Malta", phoneLength: 8...8),
        SWCountry(code: "+692", flag: "🇲🇭", name: "Marshall Islands", phoneLength: 7...7),
        SWCountry(code: "+596", flag: "🇲🇶", name: "Martinique", phoneLength: 9...9),
        SWCountry(code: "+222", flag: "🇲🇷", name: "Mauritania", phoneLength: 8...8),
        SWCountry(code: "+230", flag: "🇲🇺", name: "Mauritius", phoneLength: 8...8),
        SWCountry(code: "+52", flag: "🇲🇽", name: "Mexico", phoneLength: 10...10),
        SWCountry(code: "+691", flag: "🇫🇲", name: "Micronesia", phoneLength: 7...7),
        SWCountry(code: "+373", flag: "🇲🇩", name: "Moldova", phoneLength: 8...8),
        SWCountry(code: "+377", flag: "🇲🇨", name: "Monaco", phoneLength: 8...9),
        SWCountry(code: "+976", flag: "🇲🇳", name: "Mongolia", phoneLength: 8...8),
        SWCountry(code: "+382", flag: "🇲🇪", name: "Montenegro", phoneLength: 8...8),
        SWCountry(code: "+212", flag: "🇲🇦", name: "Morocco", phoneLength: 9...9),
        SWCountry(code: "+258", flag: "🇲🇿", name: "Mozambique", phoneLength: 9...9),
        SWCountry(code: "+95", flag: "🇲🇲", name: "Myanmar", phoneLength: 8...10),

        // N
        SWCountry(code: "+264", flag: "🇳🇦", name: "Namibia", phoneLength: 9...9),
        SWCountry(code: "+674", flag: "🇳🇷", name: "Nauru", phoneLength: 7...7),
        SWCountry(code: "+977", flag: "🇳🇵", name: "Nepal", phoneLength: 10...10),
        SWCountry(code: "+31", flag: "🇳🇱", name: "Netherlands", phoneLength: 9...9),
        SWCountry(code: "+687", flag: "🇳🇨", name: "New Caledonia", phoneLength: 6...6),
        SWCountry(code: "+64", flag: "🇳🇿", name: "New Zealand", phoneLength: 9...10),
        SWCountry(code: "+505", flag: "🇳🇮", name: "Nicaragua", phoneLength: 8...8),
        SWCountry(code: "+227", flag: "🇳🇪", name: "Niger", phoneLength: 8...8),
        SWCountry(code: "+234", flag: "🇳🇬", name: "Nigeria", phoneLength: 10...10),
        SWCountry(code: "+850", flag: "🇰🇵", name: "North Korea", phoneLength: 10...10),
        SWCountry(code: "+47", flag: "🇳🇴", name: "Norway", phoneLength: 8...8),

        // O
        SWCountry(code: "+968", flag: "🇴🇲", name: "Oman", phoneLength: 8...8),

        // P
        SWCountry(code: "+92", flag: "🇵🇰", name: "Pakistan", phoneLength: 10...10),
        SWCountry(code: "+680", flag: "🇵🇼", name: "Palau", phoneLength: 7...7),
        SWCountry(code: "+507", flag: "🇵🇦", name: "Panama", phoneLength: 8...8),
        SWCountry(code: "+675", flag: "🇵🇬", name: "Papua New Guinea", phoneLength: 8...8),
        SWCountry(code: "+595", flag: "🇵🇾", name: "Paraguay", phoneLength: 9...9),
        SWCountry(code: "+51", flag: "🇵🇪", name: "Peru", phoneLength: 9...9),
        SWCountry(code: "+63", flag: "🇵🇭", name: "Philippines", phoneLength: 10...10),
        SWCountry(code: "+48", flag: "🇵🇱", name: "Poland", phoneLength: 9...9),
        SWCountry(code: "+351", flag: "🇵🇹", name: "Portugal", phoneLength: 9...9),
        SWCountry(code: "+1", flag: "🇵🇷", name: "Puerto Rico", phoneLength: 10...10),

        // Q
        SWCountry(code: "+974", flag: "🇶🇦", name: "Qatar", phoneLength: 8...8),

        // R
        SWCountry(code: "+262", flag: "🇷🇪", name: "Reunion", phoneLength: 9...9),
        SWCountry(code: "+40", flag: "🇷🇴", name: "Romania", phoneLength: 9...9),
        SWCountry(code: "+7", flag: "🇷🇺", name: "Russia", phoneLength: 10...10),
        SWCountry(code: "+250", flag: "🇷🇼", name: "Rwanda", phoneLength: 9...9),

        // S
        SWCountry(code: "+1", flag: "🇰🇳", name: "Saint Kitts and Nevis", phoneLength: 10...10),
        SWCountry(code: "+1", flag: "🇱🇨", name: "Saint Lucia", phoneLength: 10...10),
        SWCountry(code: "+1", flag: "🇻🇨", name: "Saint Vincent and the Grenadines", phoneLength: 10...10),
        SWCountry(code: "+685", flag: "🇼🇸", name: "Samoa", phoneLength: 7...7),
        SWCountry(code: "+378", flag: "🇸🇲", name: "San Marino", phoneLength: 8...10),
        SWCountry(code: "+239", flag: "🇸🇹", name: "São Tomé and Príncipe", phoneLength: 7...7),
        SWCountry(code: "+966", flag: "🇸🇦", name: "Saudi Arabia", phoneLength: 9...9),
        SWCountry(code: "+221", flag: "🇸🇳", name: "Senegal", phoneLength: 9...9),
        SWCountry(code: "+381", flag: "🇷🇸", name: "Serbia", phoneLength: 9...9),
        SWCountry(code: "+248", flag: "🇸🇨", name: "Seychelles", phoneLength: 7...7),
        SWCountry(code: "+232", flag: "🇸🇱", name: "Sierra Leone", phoneLength: 8...8),
        SWCountry(code: "+65", flag: "🇸🇬", name: "Singapore", phoneLength: 8...8),
        SWCountry(code: "+421", flag: "🇸🇰", name: "Slovakia", phoneLength: 9...9),
        SWCountry(code: "+386", flag: "🇸🇮", name: "Slovenia", phoneLength: 8...8),
        SWCountry(code: "+677", flag: "🇸🇧", name: "Solomon Islands", phoneLength: 7...7),
        SWCountry(code: "+252", flag: "🇸🇴", name: "Somalia", phoneLength: 8...9),
        SWCountry(code: "+27", flag: "🇿🇦", name: "South Africa", phoneLength: 9...9),
        SWCountry(code: "+82", flag: "🇰🇷", name: "South Korea", phoneLength: 10...11),
        SWCountry(code: "+211", flag: "🇸🇸", name: "South Sudan", phoneLength: 9...9),
        SWCountry(code: "+34", flag: "🇪🇸", name: "Spain", phoneLength: 9...9),
        SWCountry(code: "+94", flag: "🇱🇰", name: "Sri Lanka", phoneLength: 9...9),
        SWCountry(code: "+249", flag: "🇸🇩", name: "Sudan", phoneLength: 9...9),
        SWCountry(code: "+597", flag: "🇸🇷", name: "Suriname", phoneLength: 7...7),
        SWCountry(code: "+268", flag: "🇸🇿", name: "Swaziland", phoneLength: 8...8),
        SWCountry(code: "+46", flag: "🇸🇪", name: "Sweden", phoneLength: 9...9),
        SWCountry(code: "+41", flag: "🇨🇭", name: "Switzerland", phoneLength: 9...9),
        SWCountry(code: "+963", flag: "🇸🇾", name: "Syria", phoneLength: 9...9),

        // T
        SWCountry(code: "+886", flag: "🇹🇼", name: "Taiwan", phoneLength: 9...9),
        SWCountry(code: "+992", flag: "🇹🇯", name: "Tajikistan", phoneLength: 9...9),
        SWCountry(code: "+255", flag: "🇹🇿", name: "Tanzania", phoneLength: 9...9),
        SWCountry(code: "+66", flag: "🇹🇭", name: "Thailand", phoneLength: 9...9),
        SWCountry(code: "+228", flag: "🇹🇬", name: "Togo", phoneLength: 8...8),
        SWCountry(code: "+676", flag: "🇹🇴", name: "Tonga", phoneLength: 7...7),
        SWCountry(code: "+1", flag: "🇹🇹", name: "Trinidad and Tobago", phoneLength: 10...10),
        SWCountry(code: "+216", flag: "🇹🇳", name: "Tunisia", phoneLength: 8...8),
        SWCountry(code: "+90", flag: "🇹🇷", name: "Turkey", phoneLength: 10...10),
        SWCountry(code: "+993", flag: "🇹🇲", name: "Turkmenistan", phoneLength: 8...8),
        SWCountry(code: "+1", flag: "🇹🇨", name: "Turks and Caicos Islands", phoneLength: 10...10),
        SWCountry(code: "+688", flag: "🇹🇻", name: "Tuvalu", phoneLength: 6...6),

        // U
        SWCountry(code: "+256", flag: "🇺🇬", name: "Uganda", phoneLength: 9...9),
        SWCountry(code: "+380", flag: "🇺🇦", name: "Ukraine", phoneLength: 9...9),
        SWCountry(code: "+971", flag: "🇦🇪", name: "United Arab Emirates", phoneLength: 9...9),
        SWCountry(code: "+44", flag: "🇬🇧", name: "United Kingdom", phoneLength: 10...10),
        SWCountry(code: "+1", flag: "🇺🇸", name: "United States", phoneLength: 10...10),
        SWCountry(code: "+598", flag: "🇺🇾", name: "Uruguay", phoneLength: 8...9),
        SWCountry(code: "+998", flag: "🇺🇿", name: "Uzbekistan", phoneLength: 9...9),

        // V
        SWCountry(code: "+678", flag: "🇻🇺", name: "Vanuatu", phoneLength: 7...7),
        SWCountry(code: "+379", flag: "🇻🇦", name: "Vatican City", phoneLength: 10...10),
        SWCountry(code: "+58", flag: "🇻🇪", name: "Venezuela", phoneLength: 10...10),
        SWCountry(code: "+84", flag: "🇻🇳", name: "Vietnam", phoneLength: 9...10),
        SWCountry(code: "+1", flag: "🇻🇮", name: "Virgin Islands (US)", phoneLength: 10...10),

        // Y
        SWCountry(code: "+967", flag: "🇾🇪", name: "Yemen", phoneLength: 9...9),

        // Z
        SWCountry(code: "+260", flag: "🇿🇲", name: "Zambia", phoneLength: 9...9),
        SWCountry(code: "+263", flag: "🇿🇼", name: "Zimbabwe", phoneLength: 9...9)
    ]
}
```

#### 6. SWDebugLog.swift — Debug-only logging (from SWUtil)

Skip this file if your project already has ShipSwift's `SWUtil`.

```swift
//
//  SWDebugLog.swift
//  ShipSwift
//
//  Debug logging utility functions that only print in DEBUG mode, with zero overhead
//  in Release builds (#if DEBUG + @inline(__always)). Provides two overloads:
//  simple print and print with file name/line number.
//
//  Usage:
//    // Overload 1 — multi-argument print (similar to print, supports custom separator and terminator):
//    swDebugLog("UserID:", userId, "Status:", status)
//    swDebugLog("A", "B", "C", separator: "-")
//    // Output: A-B-C
//
//    // Overload 2 — print with file name and line number (automatically captures call site):
//    swDebugLog("Network request failed")
//    // Output: [ViewModel.swift:42] Network request failed
//
//    // In Release mode, all swDebugLog calls are completely removed by the compiler with no performance impact.
//
//  Created by Wei Zhong on 3/1/26.
//

import Foundation

// MARK: - Debug Logging

/// Prints log messages in Debug mode, completely removed in Release (zero overhead)
@inline(__always)
nonisolated func swDebugLog(_ items: Any..., separator: String = " ", terminator: String = "\n") {
    #if DEBUG
    let output = items.map { "\($0)" }.joined(separator: separator)
    print(output, terminator: terminator)
    #endif
}

/// Prints log messages with file and line info in Debug mode
@inline(__always)
nonisolated func swDebugLog(_ message: @autoclosure () -> String, file: String = #file, line: Int = #line) {
    #if DEBUG
    let filename = (file as NSString).lastPathComponent
    print("[\(filename):\(line)] \(message())")
    #endif
}
```

#### 7. SWButtonStyle (from SWUtil)

The iOS view's buttons use ShipSwift's `.swPrimary` / `.swSecondary` styles, defined in `SWUtil/SWViewExtension.swift` and reproduced here. Skip this block if your project already has ShipSwift's `SWUtil`. `.accent` (also used by `SWAuthView+iOS.swift`) is the color Xcode generates from the `AccentColor` color set in your asset catalog (the default app template includes one).

```swift
import SwiftUI

// MARK: - Button Style

struct SWButtonStyle: ButtonStyle {
    enum Variant {
        case primary
        case secondary
    }

    @Environment(\.isEnabled) private var isEnabled

    let variant: Variant
    var showBorder: Bool = false
    var cornerRadius: CGFloat = 16

    private var backgroundColor: Color {
        switch variant {
        case .primary: .accent
        case .secondary: .accent.opacity(0.1)
        }
    }

    private var foregroundColor: Color {
        switch variant {
        case .primary: .white
        case .secondary: .primary.opacity(0.8)
        }
    }

    private var borderColor: Color {
        switch variant {
        case .primary: .primary
        case .secondary: .secondary.opacity(0.8)
        }
    }

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .frame(maxWidth: .infinity)
            .padding()
            .background(
                RoundedRectangle(cornerRadius: cornerRadius)
                    .fill(backgroundColor)
            )
            .foregroundStyle(foregroundColor)
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius)
                    .strokeBorder(
                        showBorder ? borderColor : .clear,
                        lineWidth: 1.5
                    )
            )
            .contentShape(RoundedRectangle(cornerRadius: cornerRadius))
            .opacity(isEnabled ? (configuration.isPressed ? 0.7 : 1) : 0.5)
    }
}

extension ButtonStyle where Self == SWButtonStyle {
    /// Primary button style (confirm / save, etc.)
    static var swPrimary: SWButtonStyle { .init(variant: .primary) }
    /// Secondary button style (cancel / close, etc.)
    static var swSecondary: SWButtonStyle { .init(variant: .secondary) }

    static func swPrimary(showBorder: Bool = true, cornerRadius: CGFloat = 12) -> SWButtonStyle {
        .init(variant: .primary, showBorder: showBorder, cornerRadius: cornerRadius)
    }

    static func swSecondary(showBorder: Bool = true, cornerRadius: CGFloat = 12) -> SWButtonStyle {
        .init(variant: .secondary, showBorder: showBorder, cornerRadius: cornerRadius)
    }
}
```

#### 8. App.swift — Amplify initialization and auth-driven navigation

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
                    ProgressView()
                case .signedOut:
                    SWAuthView()
                case .guest:
                    MainView()   // entered via userManager.skipSignIn()
                case .onboarding:
                    OnboardingView()
                case .ready:
                    MainView()
                }
            }
            .environment(userManager)
            .swAlert()   // from the component-alert skill: shows the auth views' error messages
            .onChange(of: userManager.sessionState) { oldState, newState in
                // Clear caches when signing out
                if oldState.isSignedIn, !newState.isSignedIn {
                    clearAllCaches()
                }
                // Reload data when signing in
                if !oldState.isSignedIn, newState.isSignedIn {
                    Task { await reloadAllData() }
                }
            }
        }
    }

    private func clearAllCaches() {
        // Reset your data managers here
    }

    private func reloadAllData() async {
        // Reload data from backend
    }
}
```

#### 9. amplifyconfiguration.json — Amplify SDK configuration

Place this file in your Xcode project (add to target):

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

> Note: This config does not include `CredentialsProvider` because login-required apps don't need Identity Pool. If you need anonymous guest access, see [auth-cognito-anonymous](skill://auth-cognito-anonymous) for the full config with `CredentialsProvider`. The `aws.cognito.signin.user.admin` scope is required for the account deletion feature.

### Backend (CDK)

The CDK infrastructure defines the Cognito User Pool, OAuth domain, identity providers, and the App Client.

#### Cognito User Pool

```typescript
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as cdk from 'aws-cdk-lib';

const userPool = new cognito.UserPool(this, 'UserPool', {
  userPoolName: 'my-app-user-pool',
  selfSignUpEnabled: true,

  // IMPORTANT: signInAliases cannot be changed after creation!
  // Include all login methods you might ever need.
  signInAliases: {
    email: true,
    phone: true,
    username: false,
  },

  autoVerify: { email: true, phone: true },

  standardAttributes: {
    email: { required: true, mutable: true },
    phoneNumber: { required: false, mutable: true },
    fullname: { required: false, mutable: true },
  },

  // Simplified password policy (8 chars, no complexity requirements)
  // IMPORTANT: Password policy cannot be changed after creation!
  passwordPolicy: {
    minLength: 8,
    requireLowercase: false,
    requireUppercase: false,
    requireDigits: false,
    requireSymbols: false,
  },

  accountRecovery: cognito.AccountRecovery.EMAIL_AND_PHONE_WITHOUT_MFA,
  removalPolicy: cdk.RemovalPolicy.DESTROY,  // Change to RETAIN for production
  deletionProtection: false,                  // Change to true for production
});

// Enable advanced security (audit mode for threat detection)
const cfnUserPool = userPool.node.defaultChild as cognito.CfnUserPool;
cfnUserPool.addPropertyOverride('UserPoolAddOns', {
  AdvancedSecurityMode: 'AUDIT',
});
```

#### Cognito Domain (required for OAuth/social login)

```typescript
const userPoolDomain = userPool.addDomain('Domain', {
  cognitoDomain: {
    domainPrefix: 'my-app-auth',  // Must be globally unique
  },
});
```

#### Apple Identity Provider

```typescript
// Apple Sign In requires a private key stored in Secrets Manager
const appSecret = new secretsmanager.Secret(this, 'AppSecret', {
  secretName: 'my-app/secrets',
  secretObjectValue: {
    AUTH_APPLE_PRIVATE_KEY: cdk.SecretValue.unsafePlainText('PLACEHOLDER'),
    AUTH_GOOGLE_CLIENT_SECRET: cdk.SecretValue.unsafePlainText('PLACEHOLDER'),
  },
});

const appleProvider = new cognito.UserPoolIdentityProviderApple(this, 'AppleIdp', {
  userPool,
  clientId: 'com.yourcompany.app.serviceid',  // Apple Services ID (not Bundle ID)
  teamId: 'YOUR_TEAM_ID',                      // From Apple Developer Membership
  keyId: 'YOUR_KEY_ID',                        // From the .p8 key you downloaded
  privateKeyValue: appSecret.secretValueFromJson('AUTH_APPLE_PRIVATE_KEY'),
  scopes: ['email', 'name'],
  attributeMapping: {
    email: cognito.ProviderAttribute.APPLE_EMAIL,
    fullname: cognito.ProviderAttribute.APPLE_NAME,
  },
});
```

#### Google Identity Provider

```typescript
const googleProvider = new cognito.UserPoolIdentityProviderGoogle(this, 'GoogleIdp', {
  userPool,
  // IMPORTANT: Use a "Web application" OAuth client, NOT iOS type
  clientId: 'YOUR_CLIENT_ID.apps.googleusercontent.com',
  clientSecretValue: appSecret.secretValueFromJson('AUTH_GOOGLE_CLIENT_SECRET'),
  scopes: ['email', 'profile', 'openid'],
  attributeMapping: {
    email: cognito.ProviderAttribute.GOOGLE_EMAIL,
    fullname: cognito.ProviderAttribute.GOOGLE_NAME,
  },
});
```

#### App Client

```typescript
const userPoolClient = userPool.addClient('IOSClient', {
  userPoolClientName: 'my-app-ios-client',
  generateSecret: false,  // iOS apps do not use client secrets

  accessTokenValidity: cdk.Duration.hours(1),
  idTokenValidity: cdk.Duration.hours(1),
  refreshTokenValidity: cdk.Duration.days(30),

  enableTokenRevocation: true,
  preventUserExistenceErrors: true,

  // IMPORTANT: Must include COGNITO, otherwise Hosted UI shows
  // a provider selection page before redirecting to Apple/Google
  supportedIdentityProviders: [
    cognito.UserPoolClientIdentityProvider.COGNITO,
    cognito.UserPoolClientIdentityProvider.custom('SignInWithApple'),
    cognito.UserPoolClientIdentityProvider.custom('Google'),
  ],

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
      cognito.OAuthScope.COGNITO_ADMIN,  // Required for account deletion
    ],
    callbackUrls: ['myapp://callback'],
    logoutUrls: ['myapp://signout'],
  },
});

// Ensure App Client is created after Identity Providers
userPoolClient.node.addDependency(appleProvider);
userPoolClient.node.addDependency(googleProvider);
```

#### Hono Auth Middleware (JWT validation)

The backend validates JWTs directly using Hono middleware. No API Gateway is needed for basic setups.

> **SECURITY — read this first**: The Bearer token **must** be cryptographically verified
> (signature + issuer + audience) before you trust any claim inside it. A client can forge
> a base64 JWT payload `{"sub":"<someone-else's-sub>"}` and impersonate other users if you
> only base64-decode it. The middleware below uses `jose` + `createRemoteJWKSet` +
> `jwtVerify` against the Cognito JWKS to verify the token properly. Add the `jose` package
> (`npm i jose`) and set `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID`, `AWS_REGION`.

```typescript
import type { Context, MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import * as jose from "jose";

// Remote JWKS — jose caches and auto-refreshes the keys.
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
 * Auth middleware — requires a CRYPTOGRAPHICALLY VERIFIED Bearer JWT.
 * Verifies signature (via JWKS) + issuer + audience, then extracts cognitoSub/email.
 * NEVER trust JWT claims without verification — the token is client-supplied.
 */
export const authMiddleware: MiddlewareHandler = async (c, next) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new HTTPException(401, { message: "Authorization required" });
  }

  const userPoolId = process.env.COGNITO_USER_POOL_ID;
  const clientId = process.env.COGNITO_CLIENT_ID;
  if (!userPoolId || !clientId) {
    // Fail closed: a misconfigured server must not accept unverified tokens.
    throw new HTTPException(500, { message: "Server authentication not configured" });
  }

  const token = authHeader.slice(7);
  try {
    const region = process.env.AWS_REGION || "us-east-1";
    const issuer = `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`;
    const { payload } = await jose.jwtVerify(token, getJwks(), {
      issuer,
      audience: clientId, // ID Token aud == App Client ID
    });

    const sub = payload.sub;
    if (!sub || typeof sub !== "string") {
      throw new HTTPException(401, { message: "Invalid token claims" });
    }

    c.set("cognitoSub", sub);
    c.set("email", typeof payload.email === "string" ? payload.email : undefined);
    await next();
  } catch (err) {
    if (err instanceof HTTPException) throw err;
    if (err instanceof jose.errors.JWTExpired) {
      throw new HTTPException(401, { message: "Token expired" });
    }
    // Bad signature / wrong issuer / wrong audience → reject.
    throw new HTTPException(401, { message: "Invalid token" });
  }
};

export function getCognitoSub(c: Context): string {
  const sub = c.get("cognitoSub");
  if (!sub) throw new HTTPException(401, { message: "Authorization required" });
  return sub;
}
```

> **Security rules**:
> 1. **Always verify the JWT** (signature + issuer + audience) before trusting any claim —
>    never base64-decode a token and trust its `sub`/`email`. Doing so allows trivial
>    impersonation (horizontal privilege escalation + PII leak).
> 2. **Key business tables by a stable `userId` (UUID)**, mapped from the verified
>    `cognitoSub` on the server — not by client-supplied identifiers.
> 3. **Never return another user's `cognitoSub`** in public/list responses; if you need to
>    reference an author, expose a non-impersonatable public proxy id instead.
> 4. **All write operations** (`POST`/`PUT`/`PATCH`/`DELETE`) must sit behind this verified
>    `authMiddleware`. For a large installed base of older clients, gate enforcement behind a
>    remote-config flag (verify-but-don't-enforce first, then flip on) rather than rejecting
>    them on day one.

Usage in routes:

```typescript
import { Hono } from "hono";
import { authMiddleware, getCognitoSub } from "./middleware/auth";

const app = new Hono();

// Public route (no auth)
app.get("/health", (c) => c.json({ status: "ok" }));

// Protected routes (JWT required)
app.use("/api/*", authMiddleware);

app.get("/api/profile", (c) => {
  const sub = getCognitoSub(c);
  // ... fetch user profile by cognitoSub
});
```

## Integration Checklist

### Phase 1: Apple Developer Setup

- [ ] Create App ID with "Sign in with Apple" capability enabled
- [ ] Create Services ID (e.g., `com.yourcompany.app.serviceid`)
- [ ] Create Key (.p8 file) for Sign in with Apple -- download immediately, you can only download once
- [ ] Record: Team ID, Key ID, Services ID, .p8 file content

### Phase 2: Google Cloud Setup

- [ ] Create Google Cloud project
- [ ] Configure OAuth consent screen (External, add email/profile/openid scopes)
- [ ] Create OAuth 2.0 client -- choose **Web application** type (not iOS)
- [ ] Add Authorized redirect URI: `https://YOUR-DOMAIN.auth.us-east-1.amazoncognito.com/oauth2/idpresponse`
- [ ] Record: Client ID, Client Secret

### Phase 3: AWS CDK Deployment (two-step for social login)

- [ ] Step 1: Deploy without the Apple / Google identity providers (leave out `appleProvider`, `googleProvider`, their `custom(...)` entries in `supportedIdentityProviders` and the `addDependency` lines — e.g. behind a context flag of your own) to create the Secrets Manager secret
- [ ] Step 2: Upload real secrets to AWS Secrets Manager (Apple private key, Google client secret)
- [ ] Step 3: Add the providers back and redeploy
- [ ] Record from CDK outputs: User Pool ID, Client ID, Cognito Domain

### Phase 4: Apple Developer (post-deploy)

- [ ] Go back to Services ID, enable "Sign in with Apple"
- [ ] Add Domain: `YOUR-DOMAIN.auth.us-east-1.amazoncognito.com` (no `https://`)
- [ ] Add Return URL: `https://YOUR-DOMAIN.auth.us-east-1.amazoncognito.com/oauth2/idpresponse`

### Phase 5: iOS Xcode Setup

- [ ] Add Amplify Swift SPM package (Amplify, AWSCognitoAuthPlugin, AWSPluginsCore)
- [ ] Add "Sign in with Apple" capability in Signing & Capabilities
- [ ] Add URL Scheme in Info > URL Types (e.g., `myapp`)
- [ ] Add `amplifyconfiguration.json` to the project (fill in values from Phase 3)
- [ ] Initialize Amplify in App.swift `init()`
- [ ] Add `SWUserManager.swift`, `SWAuthView+iOS.swift` (and `SWAuthView+macOS.swift` for a Mac target), `SWAgreementChecker.swift`, `SWCountryData.swift`, plus `SWDebugLog.swift` and `SWButtonStyle` unless you already have ShipSwift's `SWUtil`
- [ ] Install the **component-alert** skill and attach `.swAlert()` to the root view
- [ ] Wire up session state to control navigation

### Phase 6: Testing

- [ ] Email sign-up with verification code
- [ ] Email sign-in
- [ ] Apple Sign In
- [ ] Google Sign In
- [ ] Sign out
- [ ] Account deletion
- [ ] Password reset flow
- [ ] Token refresh (wait > 1 hour, make API call)

## Common Customizations

### Remove phone login

Delete the `SignInMethod` toggle, `phoneSignIn`/`phoneVerify` modes from `SWAuthView`, and the phone methods from `SWAuthService`. In CDK, you can keep `phone: true` in `signInAliases` (cannot be changed after creation) but simply not expose it in the UI.

### Add onboarding flow after first sign-in

In `SWUserManager.checkAuthStatus()`, query your backend for onboarding status before setting the session state:

```swift
if isSignedIn {
    let tokens = try await authService.fetchTokens()
    let profile = try await profileService.getProfile(idToken: tokens.idToken)
    if profile.onboardingCompleted {
        sessionState = .ready(tokens: tokens)
    } else {
        sessionState = .onboarding(tokens: tokens)
    }
}
```

### Add anonymous/guest mode with Identity Pool

For apps that want users to try features before signing up, see [auth-cognito-anonymous](skill://auth-cognito-anonymous). It provides Identity Pool setup, anonymous Identity IDs, three-level middleware, and data migration from anonymous to authenticated accounts.

### Add API Gateway (optional security layer)

If you need rate limiting, WAF, or gateway-level JWT validation in addition to Hono middleware, add API Gateway in front of App Runner. See [auth-cognito-anonymous](skill://auth-cognito-anonymous) Common Customizations for the CDK code.

### Require strong passwords

Update both CDK and iOS to match:

```typescript
// CDK
passwordPolicy: {
  minLength: 8,
  requireLowercase: true,
  requireUppercase: true,
  requireDigits: true,
  requireSymbols: false,
},
```

```swift
// iOS - update password validation
private var isValidPassword: Bool {
    let hasLowercase = password.rangeOfCharacter(from: .lowercaseLetters) != nil
    let hasUppercase = password.rangeOfCharacter(from: .uppercaseLetters) != nil
    let hasDigit = password.rangeOfCharacter(from: .decimalDigits) != nil
    return password.count >= 8 && hasLowercase && hasUppercase && hasDigit
}
```

### Present auth as a sheet instead of full-screen

```swift
@State private var showAuthSheet = false
@State private var shouldOpenAfterAuth = false

.sheet(isPresented: $showAuthSheet, onDismiss: {
    // Wait for sheet dismissal animation to complete
    if shouldOpenAfterAuth {
        shouldOpenAfterAuth = false
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
            // Navigate to next screen
        }
    }
}) {
    SWAuthView()
        .environment(userManager)
}
```

## Known Pitfalls

### 1. Apple Sign In shows browser permission dialog every time

**Symptom**: "xxx wants to use amazoncognito.com to sign in" appears on every login.

**Fix**: Use `preferPrivateSession: true` in `AWSAuthWebUISignInOptions`. This is already included in the `SWAuthService` code above.

### 2. Account deletion fails with "Access Token does not have required scopes"

**Symptom**: `Amplify.Auth.deleteUser()` throws an error.

**Fix**: Three things must align:
1. CDK: Include `cognito.OAuthScope.COGNITO_ADMIN` in OAuth scopes
2. iOS `amplifyconfiguration.json`: Include `"aws.cognito.signin.user.admin"` in Scopes
3. User must **re-sign-in** after updating scopes (existing tokens do not include the new scope)

### 3. Apple Sign In shows Hosted UI selection page first

**Symptom**: After tapping Apple, a Cognito page appears with login options before redirecting to Apple.

**Fix**: `supportedIdentityProviders` in the App Client **must** include `COGNITO`. Without it, the Hosted UI defaults to showing a provider selection page.

### 4. Cannot change User Pool sign-in aliases after creation

**Symptom**: `Updates are not allowed for property - UsernameAttributes`

**Reality**: Cognito User Pool `signInAliases` and `passwordPolicy` are immutable after creation. Plan ahead and include all methods you might need (email + phone). If you must change, create a new User Pool and migrate users.

### 5. Token expiration causes 401 errors

**Token lifecycle**:

| Token | Lifetime | Purpose |
|-------|----------|---------|
| ID Token | 1 hour | API authentication (use this one) |
| Access Token | 1 hour | Cognito API calls |
| Refresh Token | 30 days | Auto-refresh ID/Access tokens |

**Critical rule**: Never cache tokens manually. Always use `getFreshIdToken()` before API calls:

```swift
// WRONG: cached token may be expired
guard let idToken = userManager.sessionState.tokens?.idToken else { return }

// RIGHT: auto-refreshes if expired
guard let idToken = await userManager.getFreshIdToken() else { return }
```

The Amplify SDK automatically uses the Refresh Token to obtain new ID/Access tokens when they expire. Only after 30 days of inactivity (Refresh Token expires) will the user need to re-sign-in. `getFreshIdToken()` also returns `nil` while the device is offline with an expired ID Token; in that case the session is kept, so treat `nil` as "cannot call the API right now", not as "signed out" (observe `sessionState` for that).

### 6. ID Token vs Access Token confusion

The Hono `authMiddleware` extracts user info from the JWT `sub` claim. Always send the **ID Token** in `Authorization: Bearer` headers for your business API. If you later add API Gateway with JWT Authorizer, note that it validates the `aud` claim: ID Token has `aud` = Client ID (passes), while Access Token has `aud` = "access" (fails with 401).

### 7. Cellular data ("Wireless Data") prompt blocks OAuth sign-in on China-region iPhones

**Symptom**: On iPhones sold in mainland China, the first Apple/Google sign-in fails silently because the system's "Allow <App> to use wireless data?" prompt appears in the middle of the OAuth redirect. (This is not the local-network permission; an HTTPS request never triggers that one.)

**Fix**: Make one lightweight request (a `HEAD` on a throwaway ephemeral `URLSession`) when `SWAuthView` appears (`.task` modifier), so the prompt shows before the user taps any sign-in button. Already included in `SWAuthView+iOS.swift` above. The prompt exists only on iPhone and iPad, so the macOS view does not make this request.

### 8. `fullScreenCover` renders incorrectly after auth sheet dismissal

**Symptom**: Opening a `fullScreenCover` immediately after dismissing the auth sheet shows a transparent background.

**Fix**: Use the sheet's `onDismiss` callback instead of `DispatchQueue.main.asyncAfter`. Set a flag in the auth completion, then check it in `onDismiss` with a minimal 0.1s delay.

### 9. `@Observable` computed properties backed by UserDefaults do not trigger UI updates

**Symptom**: Changing a `UserDefaults`-backed computed property does not update the UI.

**Fix**: Use a stored property with `didSet` to sync to `UserDefaults`. The `@Observable` macro only tracks stored properties, not computed ones. `@AppStorage` only works inside `View`, not `@Observable` classes.

```swift
// WRONG: computed property, not tracked
var flag: Bool {
    get { UserDefaults.standard.bool(forKey: "flag") }
    set { UserDefaults.standard.set(newValue, forKey: "flag") }
}

// RIGHT: stored property with didSet
var flag: Bool = UserDefaults.standard.bool(forKey: "flag") {
    didSet { UserDefaults.standard.set(flag, forKey: "flag") }
}
```

### 10. First deployment fails when social login secrets are placeholders

**Symptom**: CDK deploy fails because Apple/Google providers cannot validate placeholder secrets.

**Fix**: Use a two-step deployment. First deploy with social login disabled to create the Secrets Manager entry, then update the secrets with real values, then redeploy with social login enabled. See the Integration Checklist Phase 3 above.

### 11. Google Sign In requires Web application OAuth client (not iOS type)

**Symptom**: User selects Google account but nothing happens, or `invalid_client` error.

**Fix**: In Google Cloud Console, create an OAuth 2.0 client of type **Web application** (not iOS). Cognito uses the web OAuth flow even for mobile apps. Add the Cognito `/oauth2/idpresponse` URL as an authorized redirect URI.

### 12. Phone sign-in needs a custom-auth backend this skill does not include

**Symptom**: "Send Verification Code" fails (user not found, or the auth flow is rejected by the App Client).

**Reality**: `sendPhoneVerificationCode` starts Cognito's passwordless custom auth flow (`authFlowType: .customWithoutSRP`), which only works when the User Pool has the three custom-challenge Lambda triggers (Define / Create / Verify Auth Challenge, the Create trigger sending the SMS code), the App Client allows it (`authFlows: { custom: true }`), and the phone number already exists as a user (or a sign-up step creates it). The CDK above deploys none of this, so either add those triggers or hide the Phone tab (see "Remove phone login").
