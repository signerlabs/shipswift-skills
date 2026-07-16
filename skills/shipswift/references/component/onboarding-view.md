---
id: component-onboarding-view
title: Onboarding View
description: Multi-page onboarding view with swipe navigation, Continue/Get Started button, Skip option, and best-practice patterns for prefetching iOS system permissions.
tier: free
tags: [component, display, onboarding, tabview, paging, SwiftUI, permission, prefetch]
---

## Overview

Multi-page onboarding view with swipe-to-navigate support, a "Continue / Get Started" button and a "Skip" button at the bottom. Page content is defined by the `OnboardingPage` enum (icon / title / description) -- add or remove cases freely.

> **Note:** This component uses `.buttonStyle(.borderedProminent)` as a default. Replace it with `.buttonStyle(.swPrimary)` if using ShipSwift button styles.

## Source Code

```swift
import SwiftUI

// MARK: - Onboarding Main View
struct SWOnboardingView: View {
    let onComplete: () -> Void

    private let pages = OnboardingPage.allCases
    @State private var currentPage = 0

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
            .tabViewStyle(.page(indexDisplayMode: .always))
            .indexViewStyle(.page(backgroundDisplayMode: .always))

            // Bottom confirm button
            Button {
                if currentPage < pages.count - 1 {
                    withAnimation {
                        currentPage += 1
                    }
                } else {
                    onComplete()
                }
            } label: {
                Text(currentPage < pages.count - 1 ? "Continue" : "Get Started")
            }
            .buttonStyle(.borderedProminent) // Replace with .swPrimary if using ShipSwift button styles
            .padding(.bottom)

            // Bottom skip button
            Button {
                onComplete()
            } label: {
                Text("Skip")
                    .foregroundStyle(.secondary)
            }
            .opacity(currentPage < pages.count - 1 ? 0 : 1)
        }
        .safeAreaPadding(.horizontal)
    }
}

// MARK: - Onboarding Page Model
enum OnboardingPage: CaseIterable {
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
        case .components: "Production-Ready Recipes"
        case .modular: "One Command Setup"
        case .launch: "Ship 10x Faster"
        }
    }

    var description: String {
        switch self {
        case .shipFast: "Recipes structured for AI models — Claude, Cursor, Windsurf get production-grade context instantly."
        case .components: "Auth, subscriptions, camera, AI chat, paywall — every recipe battle-tested in real App Store apps."
        case .modular: "Connect via MCP with one command. No downloads, no setup, no dependencies to manage."
        case .launch: "Stop rebuilding auth and payments from scratch. Focus on what makes your app unique."
        }
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
| **Onboarding prefetch (fire-and-forget)** | The permission is needed for ambient features (background updates, push, gallery save) that have no obvious "tap me" entry point. Request early, never block on the answer. | Location, local network, notifications, photo library |
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

> **Reference**: FoodieMap incident — bug introduced in commit `ae4e99e` (2026-03-25) which refactored a 10s-timeout polling into an unbounded `while .notDetermined` loop. Latent for ~7 weeks until surfacing on 2026-05-12 after a simulator wipe: on the first cold launch with location status `.notDetermined`, the dialog was suppressed by the LaunchScreen overlay and the loop spun forever, starving `await store.load()` and hanging the splash screen indefinitely. Fix shipped in `90e5e87`.

### Recommended: fire-and-forget in OnboardingView's .task

Kick off all background-prefetchable permissions in parallel inside the onboarding view's `.task`. Do not await any of them. Each prefetch function uses `guard authorizationStatus == .notDetermined` so the prompt only ever shows once across launches.

```swift
import SwiftUI
import CoreLocation
import UserNotifications
import Photos
import Network

struct SWOnboardingView: View {
    let onComplete: () -> Void

    var body: some View {
        // ... existing onboarding UI ...
        Color.clear
            .task {
                // ✓ Fire-and-forget: kick all prompts off in parallel,
                //   never block onboarding or downstream work on the answer.
                await prefetchNetworkPermission()  // only this one needs await
                prefetchLocationPermission()
                prefetchNotificationPermission()
                prefetchPhotoLibraryPermission()
            }
    }

    /// Local network permission (iOS 14+). Triggered by *any* outbound connection
    /// to a local host; using `apple.com` is a harmless way to surface the prompt
    /// during onboarding instead of mid-feature.
    private func prefetchNetworkPermission() async {
        guard let url = URL(string: "https://www.apple.com") else { return }
        _ = try? await URLSession.shared.data(from: url)
    }

    /// Location (when-in-use). The request is non-blocking; the response arrives
    /// later via `locationManagerDidChangeAuthorization(_:)`. Never poll for it.
    private func prefetchLocationPermission() {
        let manager = CLLocationManager()
        guard manager.authorizationStatus == .notDetermined else { return }
        manager.requestWhenInUseAuthorization()
    }

    /// Notifications. The closure is the *only* sanctioned way to learn the
    /// outcome — wrap it in a detached Task so onboarding never waits on it.
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
