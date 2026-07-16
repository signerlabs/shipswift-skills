---
id: animation-full-screen-button
title: Full-Screen Button
description: Tappable card with Apple's native zoom transition (App Store / Photos style) — the card geometry-matches into a true full-screen view via iOS 18 `.matchedTransitionSource` and `.navigationTransition(.zoom)`
tier: free
tags: [animation, fullscreen, button, zoom, matchedTransitionSource, navigationTransition, SwiftUI, iOS18]
---

## Overview

Tappable card that expands to fill the device display using Apple's native zoom transition — the same continuous, geometry-matched effect Apple uses for App Store / Photos / Music album-to-detail navigations. The compact card appears to spring into the entire screen rather than sliding up as a generic modal, **and** because the expanded view is pushed onto the host `NavigationStack`, it covers the screen edge-to-edge regardless of the surrounding ScrollView / VStack / nested layout.

**Requires:**
- iOS 18+ (uses `.matchedTransitionSource(id:in:)` and `.navigationTransition(.zoom(sourceID:in:))`)
- An enclosing `NavigationStack` — the component pushes its expanded view onto the host stack

**iOS only.** File is named `SWFullScreenButton+iOS.swift`; in Xcode → Build Phases → Compile Sources set the platform filter for this file to **iOS**.

## Source Code

```swift
//
//  SWFullScreenButton+iOS.swift
//  ShipSwift
//
//  Tappable card that expands to fill the device display using Apple's
//  native zoom transition — the same continuous, geometry-matched effect
//  Apple uses for App Store / Photos / Music album-to-detail navigations.
//  The compact card appears to spring into the entire screen rather than
//  sliding up as a generic modal.
//
//  Requires an enclosing `NavigationStack`:
//
//      NavigationStack {
//          SWFullScreenButton()
//      }
//
//  iOS 18+ only. Built on `.matchedTransitionSource(id:in:)` and
//  `.navigationTransition(.zoom(sourceID:in:))`, both introduced in iOS 18.
//

import SwiftUI

@available(iOS 18.0, *)
struct SWFullScreenButton: View {
    var title: String = "ShipSwift"
    var subtitle: String = "Fullstack AI toolkit"
    var footer: String = "FullScreenCard"
    var compactSize: CGSize = CGSize(width: 300, height: 300)
    var gradientColors: [Color] = [.brown, .white]
    var cornerRadius: CGFloat = 30

    @Namespace private var transitionNS
    @State private var shadowRadius: CGFloat = 30

    init(
        title: String = "ShipSwift",
        subtitle: String = "Fullstack AI toolkit",
        footer: String = "FullScreenCard",
        compactSize: CGSize = CGSize(width: 300, height: 300),
        gradientColors: [Color] = [.brown, .white],
        cornerRadius: CGFloat = 30
    ) {
        self.title = title
        self.subtitle = subtitle
        self.footer = footer
        self.compactSize = compactSize
        self.gradientColors = gradientColors
        self.cornerRadius = cornerRadius
    }

    var body: some View {
        NavigationLink {
            SWFullScreenButtonExpandedView(
                title: title,
                subtitle: subtitle,
                footer: footer,
                gradientColors: gradientColors
            )
            .navigationTransition(.zoom(sourceID: "swFullScreenButton", in: transitionNS))
            .onAppear {
                // Source is hidden during the push; drop the shadow so it
                // doesn't pop in after the reverse zoom completes.
                shadowRadius = 0
            }
            .onDisappear {
                // Reverse zoom has finished and the source is visible again
                // — fade the shadow back in to mask the system's snapshot
                // hand-off frame.
                withAnimation(.easeOut(duration: 0.25)) {
                    shadowRadius = 30
                }
            }
        } label: {
            cardContent(expanded: false)
                .frame(width: compactSize.width, height: compactSize.height)
                .background(
                    LinearGradient(colors: gradientColors, startPoint: .top, endPoint: .bottom)
                )
                .clipShape(RoundedRectangle(cornerRadius: cornerRadius))
                .shadow(radius: shadowRadius)
                .matchedTransitionSource(id: "swFullScreenButton", in: transitionNS)
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private func cardContent(expanded: Bool) -> some View {
        VStack {
            Text(title)
                .foregroundStyle(.white)
                .font(.largeTitle)
                .fontWeight(.bold)
                .padding(.top, expanded ? 100 : 20)

            Text(subtitle)
                .foregroundStyle(.white)
                .lineLimit(1)

            Spacer()

            Text(footer)
                .foregroundStyle(.accent)
                .brightness(0.1)
                .font(.title)
                .fontWeight(.bold)
                .padding(.bottom, expanded ? 100 : 20)
        }
        .padding()
    }
}

/// Pushed destination for the zoom transition. Tapping anywhere on the
/// expanded card calls `dismiss()`, which pops the navigation stack and
/// triggers the reverse zoom animation. The standard edge-swipe-back
/// gesture also still works as a system-provided dismiss path.
@available(iOS 18.0, *)
private struct SWFullScreenButtonExpandedView: View {
    let title: String
    let subtitle: String
    let footer: String
    let gradientColors: [Color]

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack {
            Text(title)
                .foregroundStyle(.white)
                .font(.largeTitle)
                .fontWeight(.bold)
                .padding(.top, 100)

            Text(subtitle)
                .foregroundStyle(.white)
                .lineLimit(1)

            Spacer()

            Text(footer)
                .foregroundStyle(.accent)
                .brightness(0.1)
                .font(.title)
                .fontWeight(.bold)
                .padding(.bottom, 100)
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(
            LinearGradient(colors: gradientColors, startPoint: .top, endPoint: .bottom)
        )
        .ignoresSafeArea()
        .contentShape(Rectangle())
        .onTapGesture {
            dismiss()
        }
    }
}

@available(iOS 18.0, *)
#Preview {
    NavigationStack {
        SWFullScreenButton()
    }
}
```

## Usage

```swift
// Must be hosted inside a NavigationStack
NavigationStack {
    SWFullScreenButton()
}

// Custom copy
NavigationStack {
    SWFullScreenButton(
        title: "SmileMax",
        subtitle: "Daily smile analytics",
        footer: "Open"
    )
}

// Custom palette and shape
NavigationStack {
    SWFullScreenButton(
        gradientColors: [.purple, .pink],
        cornerRadius: 24
    )
}
```

## Parameters

| Parameter        | Type      | Default                            | Description                                                                                       |
|------------------|-----------|------------------------------------|---------------------------------------------------------------------------------------------------|
| `title`          | `String`  | `"ShipSwift"`                      | Top headline shown in white                                                                       |
| `subtitle`       | `String`  | `"Fullstack AI toolkit"`           | Single-line tagline under the title                                                               |
| `footer`         | `String`  | `"FullScreenCard"`                 | Bottom accent label rendered with the accent color                                                |
| `compactSize`    | `CGSize`  | `CGSize(width: 300, height: 300)`  | Frame size in the collapsed state                                                                 |
| `gradientColors` | `[Color]` | `[.brown, .white]`                 | Background gradient stops, applied top to bottom                                                  |
| `cornerRadius`   | `CGFloat` | `30`                               | Card corner radius applied in the compact state                                                   |

## Notes

- **Why the zoom transition?** An earlier version of this component animated its own `.frame` from `compactSize` up to `UIScreen` bounds with `withAnimation(.bouncy)`. The bounce was the entire point of the component — but inside any `NavigationStack` or `ScrollView`, SwiftUI's layout system clamped the frame to the parent's content area, so the card grew toward the toolbar / scroll bounds and never reached the physical screen edges. A second iteration switched to `.fullScreenCover`, which fixed the "fills the screen" problem but threw away the original spring-into-fullscreen feel — `.fullScreenCover`'s generic slide-up modal is something any vanilla SwiftUI app gets for free, so the component became redundant. The iOS 18 zoom transition gives back the **best of both**: a continuous, geometry-matched spring from the compact card into a real edge-to-edge view, with no manual screen-size measurement and no container clamping.

- **Dismiss gestures.** The expanded view supports two dismiss paths: (1) **tap anywhere on the card** — the destination view holds `@Environment(\.dismiss)` and calls it on `onTapGesture`, which pops the `NavigationStack` and triggers the reverse zoom animation; (2) **edge-swipe-back** — the system-provided gesture for any pushed view, also reverse-zooms. The tap path matches the original "tap to toggle" intent of the component; the edge-swipe path is iOS-native muscle memory.

- **Why `NavigationStack` is required.** The zoom transition is implemented as a `NavigationLink` push with a `.navigationTransition(.zoom(...))` modifier on the destination. Without a host `NavigationStack`, the `NavigationLink` silently renders as a plain button and the transition never fires. The hosting requirement is what lets the zoom escape any `ScrollView` / nested `VStack` — the push goes through the stack, not through the layout tree.

- **iOS 18+ only.** Both `.matchedTransitionSource(id:in:)` and `.navigationTransition(.zoom(sourceID:in:))` were introduced in iOS 18. The struct is marked `@available(iOS 18.0, *)` and the file is named `SWFullScreenButton+iOS.swift` so Xcode's per-file platform filter can exclude it from macOS targets — do not wrap the body in `#if os(iOS)` as a substitute (per the ShipSwift convention, platform filtering is a build setting).

- **Tap target.** The whole compact card is the `NavigationLink` label; `.buttonStyle(.plain)` removes the default tint so the gradient renders cleanly.

- **Shadow flicker on reverse zoom — the real fix.** The iOS 18 zoom transition snapshots the source view's bounds raster. A `.shadow(_:)` is drawn *outside* those bounds, so the snapshot never carries it — regardless of whether the shadow is written as a trailing modifier (`.shadow(radius: 30)`) or embedded inside a `.background { RoundedRectangle().shadow(...) }`. The visible symptom: during the reverse zoom the shadow is absent, and one frame after the system hands off from the destination snapshot back to the live source view, the shadow "pops in." We solve this with an animated radius: a `@State private var shadowRadius: CGFloat = 30` drives the background's shadow, the destination's `.onAppear` sets it to `0`, and `.onDisappear` runs `withAnimation(.easeOut(duration: 0.25)) { shadowRadius = 30 }`. Reverse zoom completes with `shadowRadius == 0`, then the shadow fades back in smoothly — masking the snapshot hand-off frame. This is the only reliable fix on iOS 18; `.compositingGroup()`, `.drawingGroup()`, and reordering the modifiers do not extend the snapshot bounds.
