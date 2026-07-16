---
id: setting
title: Settings View
description: Pre-built settings page with app info section, account management, notification toggles, feedback/rating links, and legal links (iOS and macOS)
tier: free
tags: [settings, preferences, account, SwiftUI, configuration]
---

## What This Solves

Provides a drop-in, production-ready settings page for iOS and macOS apps — covering language switching, share app, legal links (Terms of Service, Privacy Policy), recommended apps showcase, account actions (sign out, delete account with confirmation dialogs), and version display — so you never have to build a settings screen from scratch.

## Architecture

```
SWSettingView (NavigationStack)
  |
  |--- General Settings Section
  |       |--- Language Picker (English / Chinese via @AppStorage)
  |       |--- Share App (ShareLink with App Store URL)
  |
  |--- Legal Section
  |       |--- Terms of Service (Link)
  |       |--- Privacy Policy (Link)
  |
  |--- Recommended Apps Section
  |       |--- App links with icon images (labelWithImage helper)
  |
  |--- Account Actions Section
  |       |--- Sign Out (Button + confirmation alert)
  |       |--- Delete Account (destructive Button + confirmation alert)
  |
  |--- Version Info Section
          |--- App version + build number from Bundle
```

Key design decisions:
- **Platform-specific views** — separate `SWSettingView+iOS.swift` and `SWSettingView+macOS.swift` files, sharing the same data model and configuration.
- **@AppStorage for language** — persists the user's language preference across launches without a dedicated settings store.
- **Confirmation dialogs** — both sign-out and delete-account require explicit user confirmation to prevent accidental actions.
- **Configurable constants** — URLs and app links are declared as private `let` properties at the top of the struct for easy customization.

## Implementation

### SWSettingView+iOS.swift / SWSettingView+macOS.swift

```swift
//
//  SWSettingView.swift
//  ShipSwift
//
//  Generic settings page template with language switching, share app, legal links,
//  recommended apps, and sign out / delete account sections.
//  Use directly as a NavigationStack page — no additional wrapping needed.
//
//  Usage:
//    // 1. Basic usage — embed directly in TabView or NavigationStack:
//    SWSettingView()
//
//    // 2. Customization points (modify the constants in this file):
//    //    - appStoreURL      → App Store URL for the share link
//    //    - termsURL         → Terms of Service URL
//    //    - privacyURL       → Privacy Policy URL
//    //    - appStoreFullpack / appStoreBrushmo / ...  → Recommended app links
//
//    // 3. Replace sign-out and delete-account logic:
//    //    Find the signOut() and deleteAccount() methods and replace the TODO comments with real implementations:
//    private func signOut() {
//        isSigningOut = true
//        Task {
//            await userManager.signOut()
//            isSigningOut = false
//        }
//    }
//
//    // 4. Language switching is based on @AppStorage("appLanguage"),
//    //    pair with SWDateExtension and similar utilities for global English/Chinese switching.
//

import SwiftUI

struct SWSettingView: View {

    // MARK: - State

    @AppStorage("appLanguage") private var appLanguage = "en"
    @State private var showDeleteConfirmation = false
    @State private var showSignOutConfirmation = false
    @State private var isDeleting = false
    @State private var isSigningOut = false

    // MARK: - Configuration (modify these values directly)

    private let appStoreURL = URL(string: "https://apps.apple.com/app/id123456789")!
    private let termsURL = URL(string: "https://shipswift.app/terms")!
    private let privacyURL = URL(string: "https://shipswift.app/privacy")!

    // App Store URLs (examples, replace with actual URLs)
    private let appStoreFullpack = "https://apps.apple.com/us/app/fullpack-packing-outfit/id6745692929"
    private let appStoreBrushmo = "https://apps.apple.com/us/app/brushmo/id6744569822"
    private let appStoreUtilityMax = "https://apps.apple.com/us/app/utilitymax%E6%95%88%E5%BA%A6%E5%AE%B6-%E7%BB%88%E8%BA%AB%E8%B4%A2%E5%8A%A1%E6%A8%A1%E6%8B%9F%E4%B8%8E%E9%80%80%E4%BC%91%E8%A7%84%E5%88%92%E5%99%A8/id6758595049"
    private let appStoreJourney = "https://apps.apple.com/us/app/journey-goal-tracker-diary/id6748666816"
    private let appStoreSmileMax = "https://apps.apple.com/us/app/smilemax/id6758947123"

    /// App version number
    private var appVersion: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0.0"
    }

    /// App build number
    private var buildNumber: String {
        Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "1"
    }

    // MARK: - Body

    var body: some View {
        NavigationStack {
            List {
                // MARK: - General Settings
                Section {
                    // Language switcher
                    Picker("Language", selection: $appLanguage) {
                        Text("English").tag("en")
                        Text("简体中文").tag("zh-Hans")
                    }

                    // Share App
                    ShareLink(item: appStoreURL) {
                        HStack {
                            Text("Share App")
                            Spacer()
                            Image(systemName: "square.and.arrow.up")
                                .foregroundStyle(.secondary)
                        }
                    }
                }

                // MARK: - Legal
                Section {
                    Link(destination: termsURL) {
                        HStack {
                            Text("Terms of Service")
                            Spacer()
                            Image(systemName: "chevron.right")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                    }

                    Link(destination: privacyURL) {
                        HStack {
                            Text("Privacy Policy")
                            Spacer()
                            Image(systemName: "chevron.right")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                    }
                }

                // MARK: - Recommended Apps
                Section("Apps Built with ShipSwift") {
                    Link(destination: URL(string: appStoreSmileMax)!) {
                        labelWithImage(.smileMaxLogo, name: "SmileMax - Glow Up Coach")
                    }
                    Link(destination: URL(string: appStoreFullpack)!) {
                        labelWithImage(.fullpackLogo, name: "Fullpack - Packing & Outfit")
                    }
                    Link(destination: URL(string: appStoreBrushmo)!) {
                        labelWithImage(.brushmoLogo, name: "Brushmo - Oral Health Companion")
                    }
                    Link(destination: URL(string: appStoreUtilityMax)!) {
                        labelWithImage(.utilityMaxLogo, name: "UtilityMax - Financial Simulator")
                    }
                    Link(destination: URL(string: appStoreJourney)!) {
                        labelWithImage(.journeyLogo, name: "Spark - Goal Tracker & Diary")
                    }
                }

                // MARK: - Account Actions
                Section {
                    Button {
                        showSignOutConfirmation = true
                    } label: {
                        HStack {
                            Text("Sign Out")
                            if isSigningOut {
                                Spacer()
                                ProgressView()
                            }
                        }
                    }
                    .disabled(isDeleting || isSigningOut)

                    Button(role: .destructive) {
                        showDeleteConfirmation = true
                    } label: {
                        HStack {
                            Text("Delete Account")
                            if isDeleting {
                                Spacer()
                                ProgressView()
                            }
                        }
                    }
                    .disabled(isDeleting || isSigningOut)
                }

                // MARK: - Version Info
                Section {
                    LabeledContent("Version") {
                        Text("v\(appVersion) (\(buildNumber))")
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .alert("Sign Out?", isPresented: $showSignOutConfirmation) {
                Button("Sign Out", role: .destructive) {
                    signOut()
                }
                Button("Cancel", role: .cancel) {}
            }
            .alert("Delete Account?", isPresented: $showDeleteConfirmation) {
                Button("Delete", role: .destructive) {
                    deleteAccount()
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("This action cannot be undone. All your data will be permanently deleted.")
            }
        }
    }

    // MARK: - Label With Image

    @ViewBuilder
    private func labelWithImage(_ image: ImageResource, name: LocalizedStringResource) -> some View {
        HStack {
            Image(image)
                .resizable()
                .scaledToFit()
                .frame(width: 32, height: 32)
                .clipShape(RoundedRectangle(cornerRadius: 6))
                .padding(5)
            Text(name)
        }
    }

    // MARK: - Actions (replace with actual logic)

    private func signOut() {
        isSigningOut = true
        Task {
            // TODO: Replace with actual sign-out logic
            // await userManager.signOut()
            try? await Task.sleep(for: .seconds(1))
            isSigningOut = false
        }
    }

    private func deleteAccount() {
        isDeleting = true
        Task {
            // TODO: Replace with actual account deletion logic
            // try await userManager.deleteAccount()
            try? await Task.sleep(for: .seconds(1))
            isDeleting = false
        }
    }
}

#Preview {
    SWSettingView()
}
```

## Integration Checklist

1. **Copy `SWSettingView+iOS.swift` and `SWSettingView+macOS.swift`** into your Xcode project (e.g., under a `Settings/` or `Module/` group).
2. **Update configuration URLs** — replace `appStoreURL`, `termsURL`, and `privacyURL` with your actual values.
3. **Add app icon images** — the recommended apps section references `ImageResource` assets (`.smileMaxLogo`, `.fullpackLogo`, etc.). Either add matching assets to your asset catalog or remove/replace the recommended apps section entirely.
4. **Wire up account actions** — replace the `signOut()` and `deleteAccount()` TODO stubs with your real authentication logic (e.g., calling `SWUserManager` if you use the Auth module).
5. **Embed in your app** — add `SWSettingView()` to your `TabView` or navigation hierarchy:
   ```swift
   TabView {
       Tab("Settings", systemImage: "gearshape") {
           SWSettingView()
       }
   }
   ```
6. **Language switching** — if your app supports multiple languages, ensure other views also read from `@AppStorage("appLanguage")` to stay in sync.

## Common Customizations

### Remove the Recommended Apps Section

Delete the entire `Section("Apps Built with ShipSwift") { ... }` block and the `labelWithImage` helper method if you do not want to showcase other apps.

### Add New Setting Rows

Insert new rows inside any existing `Section` or create a new one:

```swift
Section("Notifications") {
    Toggle("Daily Reminder", isOn: $dailyReminder)
    Toggle("Weekly Summary", isOn: $weeklySummary)
}
```

Back each toggle with `@AppStorage` for automatic persistence:

```swift
@AppStorage("dailyReminder") private var dailyReminder = true
@AppStorage("weeklySummary") private var weeklySummary = false
```

### Add a Feedback / Rate Button

```swift
Section {
    Link(destination: URL(string: "https://apps.apple.com/app/id123456789?action=write-review")!) {
        HStack {
            Text("Rate This App")
            Spacer()
            Image(systemName: "star")
                .foregroundStyle(.secondary)
        }
    }

    Button {
        let email = "support@yourapp.com"
        if let url = URL(string: "mailto:\(email)") {
            UIApplication.shared.open(url)
        }
    } label: {
        HStack {
            Text("Send Feedback")
            Spacer()
            Image(systemName: "envelope")
                .foregroundStyle(.secondary)
        }
    }
}
```

### Connect to SWUserManager (Auth Module)

If you use the Auth Cognito module, inject `SWUserManager` and wire up the actions:

```swift
@Environment(SWUserManager.self) private var userManager

private func signOut() {
    isSigningOut = true
    Task {
        await userManager.signOut()
        isSigningOut = false
    }
}

private func deleteAccount() {
    isDeleting = true
    Task {
        try await userManager.deleteAccount()
        isDeleting = false
    }
}
```

### Change the Language Options

Modify the `Picker` to add or remove languages:

```swift
Picker("Language", selection: $appLanguage) {
    Text("English").tag("en")
    Text("简体中文").tag("zh-Hans")
    Text("日本語").tag("ja")
    Text("한국어").tag("ko")
}
```

## Known Pitfalls

1. **Image assets required** — The recommended apps section uses `ImageResource` references (`.smileMaxLogo`, `.fullpackLogo`, etc.). If these assets are missing from your asset catalog, the build will fail. Either add placeholder images or remove the section.
2. **`@AppStorage("appLanguage")` does not change `Locale`** — This preference key is app-level only. It does not override the system locale. You need to read this value in your views and conditionally format dates, numbers, and strings accordingly.
3. **Delete account is client-side only by default** — The template stub does not call any backend API. If your app has server-side user data, you must implement proper backend cleanup (e.g., Cognito `deleteUser` + DynamoDB record removal) in the `deleteAccount()` method.
4. **Force-unwrapped URLs** — The recommended app URLs use `URL(string:)!`. If a URL string is malformed, the app will crash. Verify all URL strings are valid before shipping.
5. **Sign Out does not navigate** — After signing out, the view remains on the settings screen. You typically need to observe the auth state at a higher level (e.g., in your root view) and switch to the login screen when the user becomes unauthenticated.
