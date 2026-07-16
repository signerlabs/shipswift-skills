---
id: auth-cognito
title: Authentication with AWS Cognito
description: Login-required iOS and macOS authentication system with AWS Cognito — email/password sign-up, Apple Sign In, Google Sign In, phone OTP, automatic token refresh, onboarding flow, and CDK infrastructure setup. Choose this when your app requires users to sign in before accessing any features.
tier: free
tags: [authentication, Cognito, AWS, Apple Sign In, Google Sign In, Amplify, login, sign-up, token, phone, OTP, login-required]
---

## What This Solves

Provides a login-required authentication system for iOS and macOS apps backed by AWS Cognito, covering the full lifecycle: email/password registration, social sign-in (Apple, Google), phone OTP, token management with automatic refresh, onboarding flow, account deletion, and password reset — with the complete CDK infrastructure to deploy it all.

> **Choosing between auth recipes**: This recipe requires users to sign in before accessing
> any features (e.g., social apps, enterprise tools). If your app should let users try
> core features without signing in first, use [auth-cognito-anonymous](recipe://auth-cognito-anonymous) instead.

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
| Identity Pool (guest mode) | Built-in (see [auth-cognito-anonymous](recipe://auth-cognito-anonymous)) | Not available | Not available |
| Social login config | CDK as code | Console-only | Dashboard-only |
| Pricing at scale | Free up to 50K MAU | Free up to 50K | Free up to 50K |
| Token refresh | SDK handles automatically | SDK handles automatically | SDK handles automatically |
| Infrastructure as Code | Full CDK support | Partial (Firebase Extensions) | Limited |
| Vendor lock-in risk | Moderate (JWT standard) | High (Firebase SDK) | Low (PostgreSQL) |

**Bottom line**: If your backend is on AWS, Cognito is the natural choice. Hono middleware validates JWTs directly, keeping auth logic minimal. For apps that need anonymous/guest access, see [auth-cognito-anonymous](recipe://auth-cognito-anonymous).

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

The iOS implementation consists of 4 files that work together to provide a complete authentication experience.

#### 1. SWUserManager.swift — Session state and auth orchestration

This is the central auth manager that the rest of your app observes. It manages session state transitions and delegates actual auth operations to `SWAuthService`.

```swift
import Foundation
import SwiftUI
import StoreKit
import Amplify
import AWSCognitoAuthPlugin
import AWSPluginsCore

// MARK: - Session State

/// User session state
enum SWSessionState: Equatable {
    case loading
    case signedOut(errorMessage: String? = nil)
    case onboarding(tokens: SWAuthTokens)   // Signed in, onboarding not completed
    case ready(tokens: SWAuthTokens)        // Signed in, onboarding completed

    var isSignedIn: Bool {
        switch self {
        case .onboarding, .ready: return true
        case .signedOut, .loading: return false
        }
    }

    var isLoading: Bool {
        if case .loading = self { return true }
        return false
    }

    var tokens: SWAuthTokens? {
        switch self {
        case .onboarding(let tokens), .ready(let tokens): return tokens
        case .signedOut, .loading: return nil
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
        static let delayBeforeRequest: Duration = .seconds(1)
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
            Task {
                await checkAuthStatus()
            }
        } else {
            sessionState = .signedOut()
        }
    }

    // MARK: - Public Methods

    func completeFirstLaunch() {
        isFirstLaunch = false
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
            } catch {
                sessionState = .signedOut(errorMessage: "Failed to fetch auth info")
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
        guard let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
              let window = windowScene.windows.first else {
            throw SWServiceError.unknown("Cannot get window")
        }

        isAuthenticating = true
        defer { isAuthenticating = false }

        let tokens = try await authService.signInWithApple(presentationAnchor: window)
        sessionState = .ready(tokens: tokens)
    }

    /// Google Sign In
    func signInWithGoogle() async throws {
        guard let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
              let window = windowScene.windows.first else {
            throw SWServiceError.unknown("Cannot get window")
        }

        isAuthenticating = true
        defer { isAuthenticating = false }

        let tokens = try await authService.signInWithGoogle(presentationAnchor: window)
        sessionState = .ready(tokens: tokens)
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
        } catch {
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
        guard let scene = UIApplication.shared.connectedScenes
            .first(where: { $0.activationState == .foregroundActive }) as? UIWindowScene
        else { return }

        AppStore.requestReview(in: scene)

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
        case .failure:
            throw SWServiceError.tokenMissing
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
        case .failure:
            throw SWServiceError.tokenMissing
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

        let result = try await Amplify.Auth.signIn(username: phoneNumber)
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
```

#### 2. SWAuthView+iOS.swift / SWAuthView+macOS.swift — Complete authentication UI

A single view that handles all authentication flows: email sign-in/up, phone sign-in with country picker, social buttons, verification code, forgot/reset password. Reads `SWUserManager` from the SwiftUI environment.

```swift
import SwiftUI
import Amplify
import AWSCognitoAuthPlugin

struct SWAuthView: View {

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

    // Sign-in method for the top-bar Email / Phone toggle
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
    @State private var countryCode = "+1"
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

    private var isValidPassword: Bool { password.count >= 8 }
    private var isValidConfirmPassword: Bool { password == confirmPassword && isValidPassword }
    private var isValidCode: Bool { verificationCode.count == 6 }

    private var isValidPhone: Bool {
        let expectedLength = SWCountryData.phoneLength(for: countryCode)
        return expectedLength.contains(phoneNumber.count)
    }

    private var fullPhoneNumber: String { "\(countryCode)\(phoneNumber)" }
    private var isValidResetCode: Bool { resetCode.count == 6 }
    private var isValidNewPassword: Bool { newPassword.count >= 8 }
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

                    // Sign-in method toggle (only in signIn / phoneSignIn)
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
                // Pre-trigger network permission request to avoid the permission
                // dialog appearing during OAuth sign-in which causes sign-in failure
                await prefetchNetworkPermission()
            }
        }
    }

    // MARK: - Network Permission Prefetch

    private func prefetchNetworkPermission() async {
        guard let url = URL(string: "https://www.apple.com") else { return }
        _ = try? await URLSession.shared.data(from: url)
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
            emailSignInSection
            if viewMode == .signIn {
                socialSignInSection
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
                    .textContentType(.emailAddress)
                    .textInputAutocapitalization(.never)
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
                if viewMode == .signUp { signUpWithEmail() }
                else { signInWithEmail() }
            } label: {
                HStack {
                    if loadingState == .signingIn {
                        ProgressView().tint(.white)
                    }
                    Text(viewMode == .signUp
                        ? (loadingState == .signingIn ? "Creating Account..." : "Create Account")
                        : (loadingState == .signingIn ? "Signing In..." : "Sign In"))
                }
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(!isEmailFormValid || loadingState == .signingIn)

            // Forgot password (sign-in mode)
            if viewMode == .signIn {
                Button { withAnimation { viewMode = .forgotPassword } } label: {
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
                Text(viewMode == .signUp
                    ? "Already have an account? Sign In"
                    : "Don't have an account? Sign Up")
                    .font(.subheadline)
                    .foregroundStyle(Color.accentColor)
            }
        }
        .padding(.vertical)
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

            Button { confirmSignUp() } label: {
                HStack {
                    if loadingState == .verifying { ProgressView().tint(.white) }
                    Text(loadingState == .verifying ? "Verifying..." : "Verify Email")
                }
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(!isValidCode || loadingState == .verifying)

            Button { resendEmailCode() } label: {
                Text("Resend Code")
                    .font(.subheadline)
                    .foregroundStyle(Color.accentColor)
            }
            .disabled(loadingState == .sendingCode)

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

    // MARK: - Forgot / Reset Password Sections

    @ViewBuilder
    private var forgotPasswordSection: some View {
        VStack(spacing: 16) {
            HStack {
                Image(systemName: "envelope").foregroundStyle(.secondary)
                TextField("Email", text: $email)
                    .keyboardType(.emailAddress)
                    .textContentType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .background(.accent.opacity(0.1))
            .clipShape(RoundedRectangle(cornerRadius: 12))

            Button { sendResetCode() } label: {
                HStack {
                    if loadingState == .sendingCode { ProgressView().tint(.white) }
                    Text(loadingState == .sendingCode ? "Sending..." : "Send Reset Code")
                }
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(!isValidEmail || loadingState == .sendingCode)

            Button {
                withAnimation { signInMethod = .email; viewMode = .signIn }
            } label: {
                Text("Back to Sign In").font(.subheadline).foregroundStyle(.secondary)
            }
        }
        .padding(.vertical)
    }

    @ViewBuilder
    private var resetPasswordSection: some View {
        VStack(spacing: 16) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Verification Code").font(.caption).foregroundStyle(.secondary)
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

            VStack(alignment: .leading, spacing: 4) {
                Text("New Password").font(.caption).foregroundStyle(.secondary)
                HStack {
                    Image(systemName: "lock").foregroundStyle(.secondary)
                    SecureField("New Password", text: $newPassword)
                        .textContentType(.newPassword)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 14)
                .background(.accent.opacity(0.1))
                .clipShape(RoundedRectangle(cornerRadius: 12))
            }

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

            VStack(alignment: .leading, spacing: 4) {
                Text("Confirm New Password").font(.caption).foregroundStyle(.secondary)
                HStack {
                    Image(systemName: "lock.fill").foregroundStyle(.secondary)
                    SecureField("Confirm New Password", text: $confirmNewPassword)
                        .textContentType(.newPassword)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 14)
                .background(.accent.opacity(0.1))
                .clipShape(RoundedRectangle(cornerRadius: 12))

                if !confirmNewPassword.isEmpty && newPassword != confirmNewPassword {
                    Text("Passwords do not match").font(.caption).foregroundStyle(.red)
                }
            }

            Button { confirmResetPassword() } label: {
                HStack {
                    if loadingState == .verifying { ProgressView().tint(.white) }
                    Text(loadingState == .verifying ? "Resetting..." : "Reset Password")
                }
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(!isValidResetCode || !isValidConfirmNewPassword || loadingState == .verifying)

            Button {
                withAnimation {
                    signInMethod = .email; viewMode = .signIn
                    resetCode = ""; newPassword = ""; confirmNewPassword = ""; password = ""
                }
            } label: {
                Text("Back to Sign In").font(.subheadline).foregroundStyle(.secondary)
            }
        }
        .padding(.vertical)
    }

    // MARK: - Phone Sign-In Section

    @ViewBuilder
    private var phoneSignInSection: some View {
        VStack(spacing: 16) {
            HStack(spacing: 8) {
                // Country code selector
                Button { showingCountryPicker = true } label: {
                    HStack(spacing: 4) {
                        Text(SWCountryData.flag(for: countryCode))
                        Text(countryCode)
                        Image(systemName: "chevron.down").font(.caption2).foregroundStyle(.secondary)
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 14)
                    .background(.accent.opacity(0.1))
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                }

                TextField("Phone Number", text: $phoneNumber)
                    .keyboardType(.phonePad)
                    .textContentType(.telephoneNumber)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 14)
                    .background(.accent.opacity(0.1))
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .onChange(of: phoneNumber) { _, newValue in
                        let cleaned = newValue.replacingOccurrences(of: " ", with: "")
                        if cleaned != newValue { phoneNumber = cleaned }
                    }
            }

            Button { sendPhoneCode() } label: {
                HStack {
                    if loadingState == .sendingCode { ProgressView().tint(.white) }
                    Text(loadingState == .sendingCode ? "Sending..." : "Send Verification Code")
                }
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(!isValidPhone || loadingState == .sendingCode)

            socialSignInSection
        }
        .padding(.vertical)
    }

    // MARK: - Phone Verify Section

    @ViewBuilder
    private var phoneVerifySection: some View {
        VStack(spacing: 16) {
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

            Button { verifyPhoneCode() } label: {
                HStack {
                    if loadingState == .verifying { ProgressView().tint(.white) }
                    Text(loadingState == .verifying ? "Verifying..." : "Verify Phone")
                }
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(!isValidCode || loadingState == .verifying)

            Button { resendPhoneCode() } label: {
                HStack {
                    if isResending { ProgressView() }
                    Text("Resend Code")
                }
                .font(.subheadline)
                .foregroundStyle(Color.accentColor)
            }
            .disabled(isResending)

            Button {
                withAnimation { viewMode = .phoneSignIn; verificationCode = "" }
            } label: {
                Text("Back").font(.subheadline).foregroundStyle(.secondary)
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
                                countryCode = country.code
                                countrySearchText = ""
                                showingCountryPicker = false
                            } label: {
                                HStack {
                                    Text(country.flag).font(.title2)
                                    HStack(spacing: 8) {
                                        Text(country.name).foregroundStyle(.primary)
                                        Text(country.code).foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    if countryCode == country.code {
                                        Image(systemName: "checkmark").foregroundStyle(Color.accentColor)
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
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Done") { countrySearchText = ""; showingCountryPicker = false }
                }
            }
        }
    }

    // MARK: - Social Sign-In Section

    @ViewBuilder
    private var socialSignInSection: some View {
        VStack(spacing: 16) {
            HStack {
                Rectangle().fill(.tertiary).frame(height: 1)
                Text("or continue with").font(.subheadline).foregroundStyle(.secondary)
                Rectangle().fill(.tertiary).frame(height: 1)
            }
            .padding(.top, 16)

            HStack(spacing: 12) {
                Button { signInWithApple() } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "apple.logo").font(.system(size: 18))
                        Text("Apple")
                    }
                }
                .buttonStyle(.bordered)
                .controlSize(.large)

                Button { signInWithGoogle() } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "g.circle.fill").font(.system(size: 18))
                        Text("Google")
                    }
                }
                .buttonStyle(.bordered)
                .controlSize(.large)
            }

            SWAgreementChecker(agreementChecked: $agreementChecked)
        }
    }

    // MARK: - Helper

    private func signInMethodButton(_ method: SignInMethod, icon: String, label: String) -> some View {
        Button { withAnimation { signInMethod = method } } label: {
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

    // MARK: - Actions

    private func signInWithEmail() {
        guard agreementChecked else { return }
        loadingState = .signingIn
        Task {
            defer { loadingState = .idle }
            do { try await userManager.signIn(email: email, password: password) }
            catch { /* show error via your alert system */ }
        }
    }

    private func signUpWithEmail() {
        guard agreementChecked else { return }
        loadingState = .signingIn
        Task {
            defer { loadingState = .idle }
            do {
                try await userManager.signUp(email: email, password: password)
                withAnimation { viewMode = .confirmSignUp }
            } catch { /* show error */ }
        }
    }

    private func confirmSignUp() {
        loadingState = .verifying
        Task {
            defer { loadingState = .idle }
            do {
                try await userManager.confirmSignUp(email: email, code: verificationCode)
                try await userManager.signIn(email: email, password: password)
            } catch { /* show error */ }
        }
    }

    private func resendEmailCode() {
        loadingState = .sendingCode
        Task {
            defer { loadingState = .idle }
            do { try await userManager.resendSignUpCode(email: email) }
            catch { /* show error */ }
        }
    }

    private func sendResetCode() {
        loadingState = .sendingCode
        Task {
            defer { loadingState = .idle }
            do {
                try await userManager.forgotPassword(email: email)
                withAnimation { viewMode = .resetPassword }
            } catch { /* show error */ }
        }
    }

    private func confirmResetPassword() {
        loadingState = .verifying
        Task {
            defer { loadingState = .idle }
            do {
                try await userManager.confirmResetPassword(
                    email: email, newPassword: newPassword, code: resetCode)
                withAnimation {
                    signInMethod = .email; viewMode = .signIn
                    resetCode = ""; newPassword = ""; confirmNewPassword = ""; password = ""
                }
            } catch { /* show error */ }
        }
    }

    private func sendPhoneCode() {
        guard agreementChecked else { return }
        loadingState = .sendingCode
        Task {
            defer { loadingState = .idle }
            do {
                try await userManager.sendPhoneVerificationCode(phoneNumber: fullPhoneNumber)
                withAnimation { viewMode = .phoneVerify }
            } catch { /* show error */ }
        }
    }

    private func verifyPhoneCode() {
        loadingState = .verifying
        Task {
            defer { loadingState = .idle }
            do {
                try await userManager.confirmPhoneSignIn(
                    phoneNumber: fullPhoneNumber, code: verificationCode)
            } catch { /* show error */ }
        }
    }

    private func resendPhoneCode() {
        isResending = true
        Task {
            defer { isResending = false }
            do {
                try await userManager.sendPhoneVerificationCode(phoneNumber: fullPhoneNumber)
            } catch { /* show error */ }
        }
    }

    private func signInWithApple() {
        guard agreementChecked else { return }
        Task {
            do { try await userManager.signInWithApple() }
            catch { /* show error */ }
        }
    }

    private func signInWithGoogle() {
        guard agreementChecked else { return }
        Task {
            do { try await userManager.signInWithGoogle() }
            catch { /* show error */ }
        }
    }
}
```

#### 3. SWAgreementChecker.swift — Terms of Service checkbox

```swift
import SwiftUI

struct SWAgreementChecker: View {
    @Binding var agreementChecked: Bool

    var termsURL: URL = URL(string: "https://yourapp.com/terms")!
    var privacyURL: URL = URL(string: "https://yourapp.com/privacy")!

    var body: some View {
        HStack {
            Button {
                agreementChecked.toggle()
            } label: {
                Image(systemName: agreementChecked ? "checkmark.circle.fill" : "circle")
                    .imageScale(.small)
            }

            HStack {
                Text("By signing in, you agree to")
                    .foregroundStyle(.secondary)
                Link(destination: termsURL) { Text("Terms of Service") }
                Text("and").foregroundStyle(.secondary)
                Link(destination: privacyURL) { Text("Privacy Policy") }
            }
            .font(.caption2)
        }
        .padding(.top)
    }
}
```

#### 4. SWCountryData.swift — Phone country codes (excerpt)

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
        allCountries.first { $0.code == code }?.flag ?? "globe"
    }

    /// Get phone number length range by country code
    static func phoneLength(for code: String) -> ClosedRange<Int> {
        allCountries.first { $0.code == code }?.phoneLength ?? 8...12
    }

    static let allCountries: [SWCountry] = [
        SWCountry(code: "+1", flag: "US", name: "United States", phoneLength: 10...10),
        SWCountry(code: "+1", flag: "CA", name: "Canada", phoneLength: 10...10),
        SWCountry(code: "+44", flag: "GB", name: "United Kingdom", phoneLength: 10...10),
        SWCountry(code: "+86", flag: "CN", name: "China", phoneLength: 11...11),
        SWCountry(code: "+81", flag: "JP", name: "Japan", phoneLength: 10...10),
        SWCountry(code: "+82", flag: "KR", name: "South Korea", phoneLength: 10...11),
        SWCountry(code: "+91", flag: "IN", name: "India", phoneLength: 10...10),
        SWCountry(code: "+49", flag: "DE", name: "Germany", phoneLength: 10...11),
        SWCountry(code: "+33", flag: "FR", name: "France", phoneLength: 9...9),
        SWCountry(code: "+61", flag: "AU", name: "Australia", phoneLength: 9...9),
        SWCountry(code: "+55", flag: "BR", name: "Brazil", phoneLength: 10...11),
        SWCountry(code: "+52", flag: "MX", name: "Mexico", phoneLength: 10...10),
        // ... 200+ countries in the full file
    ]
}
```

#### 5. App.swift — Amplify initialization and auth-driven navigation

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
                case .onboarding:
                    OnboardingView()
                case .ready:
                    MainView()
                }
            }
            .environment(userManager)
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

#### 6. amplifyconfiguration.json — Amplify SDK configuration

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

> Note: This config does not include `CredentialsProvider` because login-required apps don't need Identity Pool. If you need anonymous guest access, see [auth-cognito-anonymous](recipe://auth-cognito-anonymous) for the full config with `CredentialsProvider`. The `aws.cognito.signin.user.admin` scope is required for the account deletion feature.

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

- [ ] Step 1: Set `enableSocialLogin: false` in cdk.json, deploy to create Secrets
- [ ] Step 2: Upload real secrets to AWS Secrets Manager (Apple private key, Google client secret)
- [ ] Step 3: Set `enableSocialLogin: true`, redeploy
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
- [ ] Add SWUserManager, SWAuthView, SWAgreementChecker, SWCountryData files
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

For apps that want users to try features before signing up, see [auth-cognito-anonymous](recipe://auth-cognito-anonymous). It provides Identity Pool setup, anonymous Identity IDs, three-level middleware, and data migration from anonymous to authenticated accounts.

### Add API Gateway (optional security layer)

If you need rate limiting, WAF, or gateway-level JWT validation in addition to Hono middleware, add API Gateway in front of App Runner. See [auth-cognito-anonymous](recipe://auth-cognito-anonymous) Common Customizations for the CDK code.

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

The Amplify SDK automatically uses the Refresh Token to obtain new ID/Access tokens when they expire. Only after 30 days of inactivity (Refresh Token expires) will the user need to re-sign-in.

### 6. ID Token vs Access Token confusion

The Hono `authMiddleware` extracts user info from the JWT `sub` claim. Always send the **ID Token** in `Authorization: Bearer` headers for your business API. If you later add API Gateway with JWT Authorizer, note that it validates the `aud` claim: ID Token has `aud` = Client ID (passes), while Access Token has `aud` = "access" (fails with 401).

### 7. iOS network permission dialog blocks OAuth sign-in

**Symptom**: First-time Apple/Google sign-in fails silently because the network permission prompt appears during the OAuth redirect.

**Fix**: Fire a dummy network request when `SWAuthView` appears (`.task` modifier). This triggers the permission dialog before the user taps any sign-in button. Already included in the `SWAuthView` code above.

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
