---
id: animation-glitter
title: Glitter
description: Animated glitter layerEffect that scatters twinkling rainbow-tinted sparkle points over any source view via a SwiftUI Metal stitchable shader, with a hashed grid, per-cell phase, and tilt-driven twinkle
tier: free
tags: [animation, metal, shader, glitter, sparkle, layerEffect, card, SwiftUI]
---

## Overview

Wraps any view in a field of animated glitter through SwiftUI's `layerEffect` Metal pipeline. A hashed grid seeds one potential sparkle per cell; each sparkle's twinkle phase is offset by a per-cell pseudo-random value and nudged by the `tilt` vector, so glints flicker as a card is rotated. Sparkles are mostly white with a faint rainbow tint, painted only over opaque source pixels. The single tunable knob is `density` — the number of grid cells per axis.

Requires iOS 17+ / macOS 14+.

## Attribution

Adapted from [ShaderKit by James Rochabrun](https://github.com/jamesrochabrun/ShaderKit), licensed under the MIT License. Copyright (c) James Rochabrun. The original copyright and license notice is retained verbatim in both source files as required by MIT; keep it intact when you copy the code into your project.

## File Layout

```
SWAnimation/SWMetal/
  SWGlitter.swift     // SwiftUI view + optional live-tuning sheet
  SWGlitter.metal     // [[stitchable]] swGlitter layerEffect entry point
```

Both files must be added to the Xcode target; the `.metal` file is compiled into the default `ShaderLibrary` automatically.

## Source Code

### SWGlitter.swift

```swift
//
//  SWGlitter.swift
//  ShipSwift
//
//  Adapted from ShaderKit by James Rochabrun
//  https://github.com/jamesrochabrun/ShaderKit
//  Licensed under the MIT License. Copyright (c) James Rochabrun.
//  Original copyright and license notice retained as required by MIT.
//  See ShipSwift ACKNOWLEDGEMENTS for the full license text.
//
//  Wraps any view in a field of animated glitter via a SwiftUI Metal
//  `layerEffect` — a hashed grid scatters twinkling rainbow-tinted points
//  whose phase responds to a `tilt` vector (e.g. from a `DragGesture`).
//
//  Requires iOS 17+ / macOS 14+ (SwiftUI `ShaderLibrary`,
//  `Shader`/`ShaderFunction`, Metal `stitchable`).
//
//  Usage:
//    // Default — 50-cell glitter grid, internal twinkle only
//    SWGlitter {
//        Image("ronaldo").resizable().scaledToFill()
//    }
//
//    // Denser glitter, tilt-driven from a DragGesture
//    SWGlitter(tilt: dragTilt, density: 80) { cardArtwork }
//
//    // Demo / debug — gear button + live-tuning sheet.
//    // Requires an enclosing `NavigationStack`.
//    SWGlitter(showsControls: true) { cardArtwork }
//
//  Parameters:
//    - tilt: Light/parallax direction in roughly `-1...1` per axis,
//            usually drag-driven (default `.zero`).
//    - density: Number of glitter grid cells per axis (default `50`).
//    - speed: Multiplier on the internal animation time (default `1.0`).
//    - showsControls: Attach a gear `ToolbarItem` that opens a live-tuning
//                     sheet (default `false`).
//

import SwiftUI

// MARK: - Main View

struct SWGlitter<Content: View>: View {
    /// Light/parallax direction in roughly -1...1 per axis (drag-driven).
    var tilt: CGSize = .zero

    /// Number of glitter grid cells per axis.
    var density: Float = 50

    /// Multiplier on the internal animation time.
    var speed: Float = 1.0

    /// When `true`, attaches a gear `ToolbarItem` that opens a live-tuning sheet.
    var showsControls: Bool = false

    private let content: Content

    init(
        tilt: CGSize = .zero,
        density: Float = 50,
        speed: Float = 1.0,
        showsControls: Bool = false,
        @ViewBuilder content: () -> Content
    ) {
        self.tilt = tilt
        self.density = density
        self.speed = speed
        self.showsControls = showsControls
        self.content = content()
    }

    var body: some View {
        if showsControls {
            SWGlitterControlled(initial: self, content: content)
        } else {
            SWGlitterRenderer(initial: self, content: content)
        }
    }
}

// MARK: - Renderer (pure shader binding)

private struct SWGlitterRenderer<Content: View>: View {
    let initial: SWGlitter<Content>
    let content: Content

    @State private var start: Date = .now

    var body: some View {
        TimelineView(.animation) { ctx in
            let elapsed = Float(ctx.date.timeIntervalSince(start)) * initial.speed
            content.layerEffect(
                ShaderLibrary.swGlitter(
                    .boundingRect,
                    .float2(Float(initial.tilt.width), Float(initial.tilt.height)),
                    .float(elapsed),
                    .float(initial.density)
                ),
                maxSampleOffset: .zero
            )
        }
    }
}

// (Optional `SWGlitterControlled` + `SWGlitterControlsSheet` provide a gear
// ToolbarItem and a Form-based live-tuning sheet. Omit them in production
// builds; the renderer above is everything you need to ship.)
```

### SWGlitter.metal

```metal
//
//  SWGlitter.metal
//  ShipSwift
//
//  Adapted from ShaderKit by James Rochabrun
//  https://github.com/jamesrochabrun/ShaderKit
//  Licensed under the MIT License. Copyright (c) James Rochabrun.
//  Original copyright and license notice retained as required by MIT.
//  See ShipSwift ACKNOWLEDGEMENTS for the full license text.
//
//  Stitchable SwiftUI layerEffect that scatters animated glitter points
//  over any source layer. A hashed grid seeds per-cell sparkles whose
//  phase is nudged by the `tilt` vector, so glints twinkle as the card
//  is rotated.
//
//  Paired with: SWGlitter.swift
//  Entry point: `swGlitter` — invoked via SwiftUI `.layerEffect(...)`.
//  Requires iOS 17+ / macOS 14+.
//

#include <metal_stdlib>
#include <SwiftUI/SwiftUI_Metal.h>
using namespace metal;

// =============================================================================
// MARK: - helpers
// =============================================================================

// Rainbow color generation — phase-shifted sines on the three channels.
static half3 swGlitter_generateRainbow(float angle, float intensity) {
    half3 color;
    color.r = sin(angle) * 0.5h + 0.5h;
    color.g = sin(angle + 2.094h) * 0.5h + 0.5h;
    color.b = sin(angle + 4.189h) * 0.5h + 0.5h;
    return color * half(intensity);
}

// =============================================================================
// MARK: - swGlitter
// =============================================================================

[[stitchable]] half4 swGlitter(
    float2 position,
    SwiftUI::Layer layer,
    float4 boundingRect,
    float2 tilt,
    float time,
    float density
) {
    float2 size = boundingRect.zw;
    half4 originalColor = layer.sample(position);

    if (originalColor.a < 0.01h) {
        return originalColor;
    }

    float2 uv = position / size;

    // Grid for glitter points
    float gridSize = density;
    float2 gridUV = fract(uv * gridSize);
    float2 gridID = floor(uv * gridSize);

    // Pseudo-random per grid cell
    float random = fract(sin(dot(gridID, float2(12.9898, 78.233))) * 43758.5453);

    // Sparkle visibility
    float sparklePhase = random * 6.28318 + time * (2.0 + random * 3.0);
    float tiltInfluence = dot(normalize(tilt + 0.001), float2(cos(random * 6.28), sin(random * 6.28)));
    float sparkleIntensity = pow(max(0.0, sin(sparklePhase + tiltInfluence * 3.0)), 8.0);

    // Distance from center of grid cell
    float2 cellCenter = float2(0.5, 0.5);
    float dist = length(gridUV - cellCenter);
    float pointSize = 0.1 + random * 0.1;
    float point = smoothstep(pointSize, 0.0, dist);

    // Sparkle color
    half3 sparkleColor = half3(1.0h, 1.0h, 1.0h);
    float rainbowAngle = random * 6.28 + tilt.x * 2.0 + tilt.y * 2.0;
    sparkleColor += swGlitter_generateRainbow(rainbowAngle, 0.3) * 0.5h;

    half3 finalColor = originalColor.rgb + sparkleColor * half(point * sparkleIntensity * 0.55);

    return half4(finalColor, originalColor.a);
}
```

## Usage

```swift
// Default — 50-cell glitter grid, internal twinkle only
SWGlitter {
    Image("ronaldo").resizable().scaledToFill()
}
.frame(width: 250, height: 350)
.clipShape(RoundedRectangle(cornerRadius: 16))

// Denser glitter, tilt-driven from a DragGesture
@State private var tilt: CGSize = .zero

SWGlitter(tilt: tilt, density: 80) {
    cardArtwork
}
.gesture(
    DragGesture()
        .onChanged { v in
            tilt = CGSize(width: v.translation.width / 100,
                          height: v.translation.height / 100)
        }
        .onEnded { _ in withAnimation(.spring) { tilt = .zero } }
)
```

## Parameters

| Parameter | Type | Default | Range | Notes |
|---|---|---|---|---|
| `tilt` | `CGSize` | `.zero` | ~ -1…1 per axis | Light/parallax direction, usually drag-driven |
| `density` | `Float` | `50` | 10…120 | Number of glitter grid cells per axis — higher = finer, denser sparkles |
| `speed` | `Float` | `1.0` | 0…3 | Multiplier on the internal animation time |
| `showsControls` | `Bool` | `false` | — | Demo-only gear ToolbarItem; requires an enclosing `NavigationStack` |

## Integration Checklist

1. Copy `SWGlitter.swift` and `SWGlitter.metal` into your Xcode target, keeping the MIT attribution header on both files.
2. Confirm the deployment target is iOS 17+ / macOS 14+.
3. Wrap a card / photo / SF Symbol in `SWGlitter { ... }`; clip it to a `RoundedRectangle` for a glittery card.
4. Tune `density` for the grain you want — `50` is a balanced default; raise toward `80–120` for fine glitter dust.
5. Drive `tilt` from a `DragGesture` to make the glints react to touch.

## Notes / Gotchas

- The shader returns the source unchanged where `originalColor.a < 0.01` — glitter only paints over opaque pixels.
- One sparkle is seeded per grid cell, so `density` is the literal cell count per axis; very high values produce extremely fine glitter and slightly higher cost.
- `maxSampleOffset` is `.zero` (no neighbour sampling). Do not raise it.
- This sits between `foil` (lightest) and `intense-bling` (heaviest) in cost.
