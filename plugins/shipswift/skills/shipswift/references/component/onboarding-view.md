---
id: component-onboarding-view
title: Onboarding View
description: Multi-page onboarding view with swipe navigation, Continue/Get Started button, Skip option, and best-practice patterns for prefetching iOS system permissions.
tier: free
tags: [component, display, onboarding, tabview, paging, SwiftUI, permission, prefetch]
---

## Overview

Multi-page onboarding view with swipe-to-navigate support, a "Continue / Get Started" button and a "Skip" button at the bottom. Page content is defined by the `SWOnboardingPage` enum (icon / title / description) -- add or remove cases freely.

> **Requires:** `SWButtonStyle` (`.swPrimary`) from ShipSwift's `SWUtil` — included below under [SWButtonStyle (from SWUtil)](#swbuttonstyle-from-swutil).

## Source Code

```swift
import SwiftUI

// MARK: - Onboarding Main View
struct SWOnboardingView: View {
    let onComplete: () -> Void

    private let pages = SWOnboardingPage.allCases
    @State private var currentPage = 0

    private var isLastPage: Bool { currentPage == pages.count - 1 }

    var body: some View {
        VStack {
            TabView(selection: $currentPage) {
                ForEach(Array(pages.enumerated()), id: \.element) { index, page in
                    VStack(spacing: 24) {
                        Spacer()

                        Image(systemName: page.icon)
                            .font(.system(size: 80))
                            .foregroundStyle(.tint)
                        Text(page.title)
                            .font(.title)
                            .fontWeight(.bold)
                        Text(page.description)
                            .foregroundStyle(.secondary)

                        Spacer()
                        Spacer()
                    }
                    .tag(index)
                    .padding(.horizontal)
                }
            }
            #if os(iOS)
            .tabViewStyle(.page(indexDisplayMode: .always))
            .indexViewStyle(.page(backgroundDisplayMode: .always))
            #endif

            // Bottom confirm button
            Button {
                if !isLastPage {
                    withAnimation {
                        currentPage += 1
                    }
                } else {
                    onComplete()
                }
            } label: {
                Text(isLastPage ? "Get Started" : "Continue")
            }
            .buttonStyle(.swPrimary)
            .padding(.horizontal)
            .padding(.bottom)

            // Bottom skip button (hidden on the last page, where the main button finishes)
            Button {
                onComplete()
            } label: {
                Text("Skip")
                    .foregroundStyle(.secondary)
            }
            .opacity(isLastPage ? 0 : 1)
            .disabled(isLastPage)
            .accessibilityHidden(isLastPage)
        }
    }
}

// MARK: - Onboarding Page Model
enum SWOnboardingPage: CaseIterable {
    case shipFast
    case components
    case modular
    case launch

    var icon: String {
        switch self {
        case .shipFast: "cpu.fill"
        case .components: "doc.text.fill"
        case .modular: "terminal.fill"
        case .launch: "paperplane.fill"
        }
    }

    var title: String {
        switch self {
        case .shipFast: "AI-First Development"
        case .components: "Production-Ready Skills"
        case .modular: "One Command Setup"
        case .launch: "Ship 10x Faster"
        }
    }

    var description: String {
        switch self {
        case .shipFast: "Skills structured for AI models — Claude, Cursor, Windsurf get production-grade context instantly."
        case .components: "Auth, camera, AI chat, in-app purchase — every skill battle-tested in real App Store apps."
        case .modular: "Connect via MCP with one command. No downloads, no setup, no dependencies to manage."
        case .launch: "Stop rebuilding auth and payments from scratch. Focus on what makes your app unique."
        }
    }
}

// MARK: - Preview
#Preview("Onboarding") {
    SWOnboardingView(onComplete: { print("Done") })
}
```

### SWButtonStyle (from SWUtil)

The buttons use ShipSwift's `.swPrimary` / `.swSecondary` styles, defined in `SWUtil/SWViewExtension.swift` and reproduced here. Skip this block if your project already has ShipSwift's `SWUtil`. `.accent` is the color Xcode generates from the `AccentColor` color set in your asset catalog (the default app template includes one).

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

## Usage

```swift
// Present the onboarding at app launch or first run
SWOnboardingView(onComplete: {
    hasSeenOnboarding = true
})

// Use with fullScreenCover
.fullScreenCover(isPresented: $showOnboarding) {
    SWOnboardingView(onComplete: { showOnboarding = false })
}
```

## Permission Prefetch Pattern

Onboarding is the natural moment to request iOS system permissions — the user is already engaged, hasn't yet hit any feature, and a denied permission has minimal blast radius. But the right pattern depends on the permission type: some should be requested at the use-site, some can be quietly prefetched in the background, and a few (ATT) must be deferred until after another system dialog has cleared.

### Three patterns (when to use which)

| Pattern | When to use | Example |
|---|---|---|
| **Use-site request** | The permission is only meaningful inside a specific feature that the user explicitly invokes. The SDK or framework handles the prompt the first time the API is touched. | Camera, microphone — see [Camera](../module/camera.md), [Chat](../module/chat.md) |
| **Onboarding prefetch (fire-and-forget)** | The permission is needed for ambient features (background updates, push, gallery save) that have no obvious "tap me" entry point. Request early, never block on the answer. | Location, cellular data (China mainland), notifications, photo library |
| **Deferred request + retry** | Apple's review rules require a different dialog (network, etc.) to be dismissed first, or the prompt is governed by App Store guidelines that dictate timing. | ATT — see [TikTok Tracking](../module/tiktok-tracking.md) |

### Anti-pattern (DO NOT DO THIS)

Polling for a permission response inside a `.task` is a footgun. The system dialog may be suppressed (LaunchScreen still up, another modal already showing, app backgrounding), and the loop will never see `authorizationStatus` change — blocking every subsequent `await` in the task.

```swift
// ❌ DO NOT DO THIS
.task {
    let manager = CLLocationManager()
    manager.requestWhenInUseAuthorization()

    // Wait for the user's response... forever, if the dialog never appeared.
    while manager.authorizationStatus == .notDetermined {
        try? await Task.sleep(for: .milliseconds(100))
    }

    // This line is never reached if the dialog was suppressed.
    await store.load()
}
```

Why it hangs:

- `requestWhenInUseAuthorization()` is a **non-blocking** call. It posts a request to the system and returns immediately. If iOS decides not to show the dialog right now (LaunchScreen overlay, competing modal, screen-locked launch), the status stays `.notDetermined` indefinitely.
- The `while` loop has no timeout and no escape condition other than a status change that may never come.
- The hang sits inside `.task`, so the SwiftUI runtime keeps the view alive but every downstream `await` (data load, navigation, telemetry) is starved.

> **Real-world incident**: a refactor turned a 10-second-timeout poll into an unbounded `while .notDetermined` loop. It stayed latent for weeks, until the first cold launch after a simulator wipe: location was `.notDetermined`, the launch screen suppressed the dialog, the loop spun forever, `await store.load()` never ran and the splash screen hung.

### Recommended: fire-and-forget in OnboardingView's .task

Kick off all background-prefetchable permissions inside the onboarding view's `.task`. Do not await any of them. Each prefetch function uses `guard authorizationStatus == .notDetermined` so the prompt only ever shows once across launches. Keep the `CLLocationManager` in a property: a manager created as a local is deallocated when the function returns, and the system takes the pending prompt down with it.

```swift
import SwiftUI
import CoreLocation
import UserNotifications
import Photos

struct SWOnboardingView: View {
    let onComplete: () -> Void

    // Must outlive the request — a local manager is deallocated and its prompt dismissed
    @State private var locationManager = CLLocationManager()

    var body: some View {
        // ... existing onboarding UI ...
        Color.clear
            .task {
                // ✓ Fire-and-forget: kick every prompt off without awaiting it,
                //   never block onboarding or downstream work on the answer.
                prefetchNetworkPermission()
                prefetchLocationPermission()
                prefetchNotificationPermission()
                prefetchPhotoLibraryPermission()
            }
    }

    /// Cellular data ("Wireless Data" prompt on China mainland devices). The first
    /// outbound request triggers it; a HEAD to `apple.com` surfaces it during
    /// onboarding instead of mid-feature. An ephemeral session keeps the probe out
    /// of the shared URL cache. (This does NOT trigger the local-network prompt —
    /// that one only fires on connections to devices on the LAN.)
    private func prefetchNetworkPermission() {
        guard let url = URL(string: "https://www.apple.com") else { return }
        Task {
            let session = URLSession(configuration: .ephemeral)
            defer { session.finishTasksAndInvalidate() }
            var request = URLRequest(url: url)
            request.httpMethod = "HEAD"
            _ = try? await session.data(for: request)
        }
    }

    /// Location (when-in-use). The request is non-blocking; the response arrives
    /// later via `locationManagerDidChangeAuthorization(_:)`. Never poll for it.
    private func prefetchLocationPermission() {
        guard locationManager.authorizationStatus == .notDetermined else { return }
        locationManager.requestWhenInUseAuthorization()
    }

    /// Notifications. The async result is the *only* sanctioned way to learn the
    /// outcome — wrap it in a Task so onboarding never waits on it.
    private func prefetchNotificationPermission() {
        Task {
            let center = UNUserNotificationCenter.current()
            let settings = await center.notificationSettings()
            guard settings.authorizationStatus == .notDetermined else { return }
            _ = try? await center.requestAuthorization(options: [.alert, .sound, .badge])
        }
    }

    /// Photo library (read + write). `.notDetermined` guard prevents re-prompting
    /// on every onboarding replay. Use `.readWrite` unless you only ever read.
    private func prefetchPhotoLibraryPermission() {
        guard PHPhotoLibrary.authorizationStatus(for: .readWrite) == .notDetermined else { return }
        PHPhotoLibrary.requestAuthorization(for: .readWrite) { _ in }
    }
}
```

### Apple's official principle

Apple's permission APIs are intentionally non-blocking: `requestWhenInUseAuthorization()`, `PHPhotoLibrary.requestAuthorization(for:)`, and `UNUserNotificationCenter.requestAuthorization(options:)` all return immediately and propagate the user's choice via a **delegate callback** or **completion handler** — `locationManagerDidChangeAuthorization(_:)` for `CLLocationManager`, the closure parameter for the others.

The framework contract is: you ask once, you get notified when the answer is ready. **Polling is never the right shape.** If your code path genuinely needs to react to the user's choice, do it inside the delegate callback or `onChange(of:)` of an observable status — not in a `while` loop.

### Downstream usage

After prefetch, every consumer of the permission checks `authorizationStatus` at the **use-site** and handles each case with a graceful fallback:

- `.authorized` / `.authorizedWhenInUse`: proceed normally
- `.notDetermined`: skip the feature for this session (the next onboarding pass or a use-site request will resolve it)
- `.denied` / `.restricted`: fall back to a default value, cached value, or a CTA that deep-links to `UIApplication.openSettingsURLString`

Never block app launch waiting for a permission to flip. The whole point of fire-and-forget is that the app remains fully usable regardless of what the user picks.
