---
id: animation-shaking-icon
title: Shaking Icon Animation
description: Animated icon that periodically zooms in and shakes side-to-side, mimicking the iOS home-screen jiggle effect
tier: free
tags: [animation, shake, icon, PhaseAnimator, SwiftUI]
---

## Overview

Animated icon that periodically zooms in and shakes side-to-side, mimicking the iOS home-screen jiggle/notification effect. Uses PhaseAnimator with a multi-step ShakePhase sequence: idle -> zoom in -> three shake pairs (left/right) -> zoom out, then repeats.

## Source Code

```swift
import SwiftUI

struct SWShakingIcon: View {
    /// Image to display (SF Symbol or asset image)
    let image: Image
    /// Icon height in points
    var height: CGFloat = 80
    /// Corner radius for asset images (0 = no rounding)
    var cornerRadius: CGFloat = 0
    /// Pause duration before each shake cycle (seconds)
    var idleDelay: Double = 1.5

    enum ShakePhase: CaseIterable {
        case idle
        case zoomIn
        case shake1L, shake1R
        case shake2L, shake2R
        case shake3L, shake3R
        case zoomOut

        var scale: Double {
            switch self {
            case .idle, .zoomOut: 1.0
            case .zoomIn, .shake1L, .shake1R, .shake2L, .shake2R, .shake3L, .shake3R: 1.1
            }
        }

        var rotation: Double {
            switch self {
            case .idle, .zoomIn, .zoomOut: 10
            case .shake1L: 12
            case .shake1R: 8
            case .shake2L: 15
            case .shake2R: 5
            case .shake3L: 12
            case .shake3R: 8
            }
        }
    }

    var body: some View {
        PhaseAnimator(ShakePhase.allCases) { phase in
            image
                .resizable()
                .scaledToFit()
                .frame(height: height)
                .clipShape(RoundedRectangle(cornerRadius: cornerRadius))
                .scaleEffect(phase.scale)
                .rotationEffect(.degrees(phase.rotation))
        } animation: { phase in
            switch phase {
            case .idle: .easeInOut(duration: 0.01)
            case .zoomIn: .easeInOut(duration: 0.2).delay(idleDelay)
            case .shake1L, .shake1R, .shake2L, .shake2R, .shake3L, .shake3R:
                    .easeInOut(duration: 0.08)
            case .zoomOut: .easeInOut(duration: 0.2)
            }
        }
    }
}
```

## Usage

```swift
// SF Symbol
SWShakingIcon(image: Image(systemName: "bell.fill"))

// Asset image (automatically gets corner radius)
SWShakingIcon(image: Image("myLogo"), height: 100, cornerRadius: 16)

// Custom timing
SWShakingIcon(
    image: Image(systemName: "heart.fill"),
    height: 120,
    idleDelay: 2.0
)
```
