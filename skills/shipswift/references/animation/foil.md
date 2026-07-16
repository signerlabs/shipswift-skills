---
id: animation-foil
title: Foil
description: Holographic rainbow foil layerEffect that wraps any source view via a SwiftUI Metal stitchable shader, with crossing sine-wave rainbow ramp, high-power sparkle glints, and a tilt-driven fresnel flare for a trading-card foil feel
tier: free
tags: [animation, metal, shader, foil, holographic, layerEffect, card, SwiftUI]
---

## Overview

Wraps any view in a holographic rainbow foil through SwiftUI's `layerEffect` Metal pipeline. Three crossing sine waves drive a rainbow ramp, a high-power sparkle term adds glints, and a `tilt` vector — typically fed from a `DragGesture` — rotates a fresnel-like highlight so the foil flares as a card is rotated. The effect samples the source layer and only paints where the source is opaque, so it reads as a foil finish laid over card art, a photo, or a bold SF Symbol.

Requires iOS 17+ / macOS 14+.

## Attribution

Adapted from [ShaderKit by James Rochabrun](https://github.com/jamesrochabrun/ShaderKit), licensed under the MIT License. Copyright (c) James Rochabrun. The original copyright and license notice is retained verbatim in both source files as required by MIT; keep it intact when you copy the code into your project.

## File Layout

```
SWAnimation/SWMetal/
  SWFoil.swift     // SwiftUI view + optional live-tuning sheet
  SWFoil.metal     // [[stitchable]] swFoil layerEffect entry point
```

Both files must be added to the Xcode target; the `.metal` file is compiled into the default `ShaderLibrary` automatically.

## Source Code

### SWFoil.swift

```swift
//
//  SWFoil.swift
//  ShipSwift
//
//  Adapted from ShaderKit by James Rochabrun
//  https://github.com/jamesrochabrun/ShaderKit
//  Licensed under the MIT License. Copyright (c) James Rochabrun.
//  Original copyright and license notice retained as required by MIT.
//  See ShipSwift ACKNOWLEDGEMENTS for the full license text.
//
//  Wraps any view in a holographic rainbow foil via a SwiftUI Metal
//  `layerEffect` — crossing sine waves drive a rainbow ramp, a sparkle
//  term adds glints, and a `tilt` vector lets the caller rotate the
//  highlight (e.g. from a `DragGesture`) for a "trading-card foil" feel.
//
//  Requires iOS 17+ / macOS 14+ (SwiftUI `ShaderLibrary`,
//  `Shader`/`ShaderFunction`, Metal `stitchable`).
//
//  Usage:
//    // Default — foil tracks the internal animation only
//    SWFoil {
//        Image("messi").resizable().scaledToFill()
//    }
//
//    // Tilt-driven — feed a normalized (-1...1) tilt from a DragGesture
//    SWFoil(tilt: dragTilt, intensity: 1.0) {
//        cardArtwork
//    }
//
//    // Demo / debug — adds a gear button that opens a live-tuning sheet.
//    // Requires an enclosing `NavigationStack`.
//    SWFoil(showsControls: true) { cardArtwork }
//
//  Parameters:
//    - tilt: Light/parallax direction in roughly `-1...1` per axis,
//            usually driven by a drag gesture (default `.zero`).
//    - intensity: Blend of the foil over the source in `0...1`
//                 (default `1.0`).
//    - speed: Multiplier on the internal animation time (default `1.0`).
//    - showsControls: Attach a gear `ToolbarItem` that opens a live-tuning
//                     sheet (default `false`).
//

import SwiftUI

// MARK: - Main View

struct SWFoil<Content: View>: View {
    /// Light/parallax direction in roughly -1...1 per axis (drag-driven).
    var tilt: CGSize = .zero

    /// Blend of the foil over the source in 0...1.
    var intensity: Float = 1.0

    /// Multiplier on the internal animation time.
    var speed: Float = 1.0

    /// When `true`, attaches a gear `ToolbarItem` that opens a live-tuning sheet.
    var showsControls: Bool = false

    private let content: Content

    init(
        tilt: CGSize = .zero,
        intensity: Float = 1.0,
        speed: Float = 1.0,
        showsControls: Bool = false,
        @ViewBuilder content: () -> Content
    ) {
        self.tilt = tilt
        self.intensity = intensity
        self.speed = speed
        self.showsControls = showsControls
        self.content = content()
    }

    var body: some View {
        if showsControls {
            SWFoilControlled(initial: self, content: content)
        } else {
            SWFoilRenderer(initial: self, content: content)
        }
    }
}

// MARK: - Renderer (pure shader binding)

private struct SWFoilRenderer<Content: View>: View {
    let initial: SWFoil<Content>
    let content: Content

    @State private var start: Date = .now

    var body: some View {
        TimelineView(.animation) { ctx in
            let elapsed = Float(ctx.date.timeIntervalSince(start)) * initial.speed
            content.layerEffect(
                ShaderLibrary.swFoil(
                    .boundingRect,
                    .float2(Float(initial.tilt.width), Float(initial.tilt.height)),
                    .float(elapsed),
                    .float(initial.intensity)
                ),
                maxSampleOffset: .zero
            )
        }
    }
}

// (Optional `SWFoilControlled` + `SWFoilControlsSheet` provide a gear
// ToolbarItem and a Form-based live-tuning sheet. Omit them in production
// builds; the renderer above is everything you need to ship.)
```

### SWFoil.metal

```metal
//
//  SWFoil.metal
//  ShipSwift
//
//  Adapted from ShaderKit by James Rochabrun
//  https://github.com/jamesrochabrun/ShaderKit
//  Licensed under the MIT License. Copyright (c) James Rochabrun.
//  Original copyright and license notice retained as required by MIT.
//  See ShipSwift ACKNOWLEDGEMENTS for the full license text.
//
//  Stitchable SwiftUI layerEffect that paints a holographic rainbow foil
//  over any source layer. Three crossing sine waves drive a rainbow ramp,
//  a high-power sparkle term adds glints, and a tilt-driven fresnel rim
//  makes the foil flare as the card is rotated.
//
//  Paired with: SWFoil.swift
//  Entry point: `swFoil` — invoked via SwiftUI `.layerEffect(...)`.
//  Requires iOS 17+ / macOS 14+.
//

#include <metal_stdlib>
#include <SwiftUI/SwiftUI_Metal.h>
using namespace metal;

// =============================================================================
// MARK: - helpers
// =============================================================================

// Rainbow color generation — phase-shifted sines on the three channels.
static half3 swFoil_generateRainbow(float angle, float intensity) {
    half3 color;
    color.r = sin(angle) * 0.5h + 0.5h;
    color.g = sin(angle + 2.094h) * 0.5h + 0.5h;
    color.b = sin(angle + 4.189h) * 0.5h + 0.5h;
    return color * half(intensity);
}

// =============================================================================
// MARK: - swFoil
// =============================================================================

[[stitchable]] half4 swFoil(
    float2 position,
    SwiftUI::Layer layer,
    float4 boundingRect,
    float2 tilt,
    float time,
    float intensity
) {
    float2 size = boundingRect.zw;
    half4 originalColor = layer.sample(position);

    if (originalColor.a < 0.01h) {
        return originalColor;
    }

    float2 uv = position / size;

    // Holographic angle based on position and tilt
    float angle = (uv.x + uv.y) * 6.0 + tilt.x * 3.0 + tilt.y * 2.0 + time * 0.5;

    // Wave patterns
    float wave1 = sin(uv.x * 20.0 + time * 2.0 + tilt.x * 5.0) * 0.5 + 0.5;
    float wave2 = sin(uv.y * 15.0 + time * 1.5 + tilt.y * 4.0) * 0.5 + 0.5;
    float wave3 = sin((uv.x + uv.y) * 25.0 + time * 3.0) * 0.5 + 0.5;

    float pattern = (wave1 + wave2 + wave3) / 3.0;

    half3 rainbow = swFoil_generateRainbow(angle + pattern * 2.0, 1.0);

    // Sparkle effect
    float sparkleAngle = (uv.x * 50.0 + uv.y * 50.0 + time * 10.0);
    float sparkle = pow(max(0.0, sin(sparkleAngle)), 20.0) * 0.5;

    // Fresnel-like effect
    float2 center = float2(0.5, 0.5);
    float2 toCenter = uv - center;
    float tiltDot = dot(normalize(toCenter + 0.001), normalize(tilt + 0.001));
    float fresnel = pow(1.0 - abs(tiltDot), 2.0) * 0.3 + 0.7;

    // Combine effects
    half3 holoColor = rainbow * half(pattern * fresnel + sparkle);
    half3 finalColor = mix(originalColor.rgb, originalColor.rgb + holoColor * 0.6h, half(intensity));
    finalColor += rainbow * 0.15h * half(intensity);

    return half4(finalColor, originalColor.a);
}
```

## Usage

```swift
// Default — foil tracks the internal animation only
SWFoil {
    Image("messi").resizable().scaledToFill()
}
.frame(width: 250, height: 350)
.clipShape(RoundedRectangle(cornerRadius: 16))

// Tilt-driven — feed a normalized (-1...1) tilt from a DragGesture
@State private var tilt: CGSize = .zero

SWFoil(tilt: tilt, intensity: 1.0) {
    cardArtwork
}
.gesture(
    DragGesture()
        .onChanged { v in
            tilt = CGSize(width: v.translation.width / 100,
                          height: v.translation.height / 100)
        }
        .onEnded { _ in
            withAnimation(.spring) { tilt = .zero }
        }
)
```

## Parameters

| Parameter | Type | Default | Range | Notes |
|---|---|---|---|---|
| `tilt` | `CGSize` | `.zero` | ~ -1…1 per axis | Light/parallax direction, usually drag-driven |
| `intensity` | `Float` | `1.0` | 0…1 | Blend of the foil over the source |
| `speed` | `Float` | `1.0` | 0…3 | Multiplier on the internal animation time |
| `showsControls` | `Bool` | `false` | — | Demo-only gear ToolbarItem; requires an enclosing `NavigationStack` |

## Integration Checklist

1. Copy `SWFoil.swift` and `SWFoil.metal` into your Xcode target, keeping the MIT attribution header on both files.
2. Confirm the deployment target is iOS 17+ / macOS 14+.
3. Wrap a card / photo / SF Symbol in `SWFoil { ... }`; clip it to a `RoundedRectangle` for the trading-card look.
4. To make it react to touch, hold a `@State var tilt: CGSize` and update it from a `DragGesture`, springing back to `.zero` on release.
5. Lower `intensity` if the foil overpowers the underlying artwork.

## Notes / Gotchas

- The shader returns the source unchanged where `originalColor.a < 0.01` — transparent pixels are never tinted, so the foil only paints over the opaque card body.
- `maxSampleOffset` is `.zero` because the effect only reads the pixel under the current position (no neighbour sampling). Do not raise it.
- `tilt` is expected in roughly `-1...1` per axis. Normalize a `DragGesture` translation (e.g. divide by ~100) before passing it in; larger values exaggerate the fresnel flare.
- This is the lightest member of the foil family (foil → glitter → intense-bling in ascending cost). Use it freely on multiple cards.
