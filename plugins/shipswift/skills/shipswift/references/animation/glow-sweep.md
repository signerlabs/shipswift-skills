---
id: animation-glow-sweep
title: Glow Sweep Effect
description: View wrapper that sweeps a glowing highlight band across content, using the original shape as a mask
tier: free
tags: [animation, glow, sweep, SwiftUI]
---

## Overview

View wrapper that replaces the content's appearance with a base color and sweeps a glowing highlight band across it. The original content shape is used as a mask, making it ideal for text, icons, and SF Symbols.

## Source Code

```swift
import SwiftUI

// MARK: - SWGlowSweep

struct SWGlowSweep<Content: View>: View {
    @State private var animate = false

    var baseColor: Color = .gray
    var glowColor: Color = .white
    var duration: Double = 2.0
    var bandWidth: CGFloat = 150

    @ViewBuilder let content: () -> Content

    init(
        baseColor: Color = .gray,
        glowColor: Color = .white,
        duration: Double = 2.0,
        bandWidth: CGFloat = 150,
        @ViewBuilder content: @escaping () -> Content
    ) {
        self.baseColor = baseColor
        self.glowColor = glowColor
        self.duration = duration
        self.bandWidth = bandWidth
        self.content = content
    }

    var body: some View {
        let inner = content()
        inner
            .hidden()
            .overlay {
                GeometryReader { geo in
                    let totalWidth = geo.size.width

                    Rectangle()
                        .fill(baseColor)
                        .overlay {
                            LinearGradient(
                                colors: [.clear, glowColor, .clear],
                                startPoint: .leading,
                                endPoint: .trailing
                            )
                            .frame(width: bandWidth)
                            .offset(x: animate ? totalWidth / 2 + bandWidth : -totalWidth / 2 - bandWidth)
                        }
                        .animation(
                            .linear(duration: duration)
                            .repeatForever(autoreverses: false),
                            value: animate
                        )
                        .mask { inner }
                }
            }
            .onAppear {
                animate = true
            }
    }
}
```

## Usage

```swift
// Default gray base with white glow sweep effect
SWGlowSweep {
    Text("Start Scan Today")
        .font(.largeTitle.bold())
}

// Custom colors and speed
SWGlowSweep(baseColor: .blue.opacity(0.6), glowColor: .cyan) {
    Image(systemName: "waveform.circle.fill")
        .font(.system(size: 80))
}

// Fully custom parameters
SWGlowSweep(
    baseColor: .accentColor,
    glowColor: .white,
    duration: 1.5,
    bandWidth: 200
) {
    Text("Analyzing...")
        .font(.title2.bold())
}
```
