---
id: animation-shimmer
title: Shimmer Effect
description: Shimmer highlight wrapper that sweeps a translucent light band across content in a continuous loop
tier: free
tags: [animation, shimmer, loading, SwiftUI]
---

## Overview

Shimmer highlight wrapper that sweeps a translucent light band across content in a continuous loop. Commonly used on buttons, skeleton loaders, or cards to draw attention or indicate a loading state.

## Source Code

```swift
import SwiftUI

// MARK: - SWShimmer

struct SWShimmer<Content: View>: View {
    @State private var animate = false

    var duration: Double = 2.0
    var delay: Double = 1.0

    @ViewBuilder let content: () -> Content

    init(
        duration: Double = 2.0,
        delay: Double = 1.0,
        @ViewBuilder content: @escaping () -> Content
    ) {
        self.duration = duration
        self.delay = delay
        self.content = content
    }

    // White light band gradient
    private var gradient: LinearGradient {
        LinearGradient(
            colors: [
                .clear,
                .clear,
                .white.opacity(0.2),
                .clear,
                .clear
            ],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }

    var body: some View {
        content()
            .overlay {
                GeometryReader { geo in
                    let bandWidth = geo.size.width * 0.5
                    gradient
                        .frame(width: bandWidth)
                        // Start fully off-screen left, end fully off-screen right
                        .offset(x: animate ? geo.size.width + bandWidth : -bandWidth * 1.5)
                        .animation(
                            .linear(duration: duration)
                            .delay(delay)
                            .repeatForever(autoreverses: false),
                            value: animate
                        )
                }
                .clipped()
            }
            .task {
                // Delay one frame to ensure the view is fully loaded
                try? await Task.sleep(nanoseconds: 100_000_000)
                animate = true
            }
    }
}
```

## Usage

```swift
// Apply with default timing (2s sweep, 1s pause)
SWShimmer {
    Text("Upgrade Now")
        .padding()
        .background(.blue)
        .clipShape(.capsule)
}

// Custom duration and delay
SWShimmer(duration: 1.5, delay: 2.0) {
    RoundedRectangle(cornerRadius: 12)
        .fill(.gray.opacity(0.3))
        .frame(width: 280, height: 120)
}
```
