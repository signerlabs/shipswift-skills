---
id: animation-intense-bling
title: Intense Bling
description: Maximum-intensity holographic shimmer layerEffect over any source view via a SwiftUI Metal stitchable shader, with a dense diamond grid, multi-hue rainbow, three moving hotspots, and layered tilt-driven sparkles for a secret-rare card look
tier: free
tags: [animation, metal, shader, holographic, bling, layerEffect, card, SwiftUI]
---

## Overview

The most intense member of the foil family. Through SwiftUI's `layerEffect` Metal pipeline, it overlays a dense vertical diamond grid, a multi-hue rainbow built in HSV, three moving light hotspots, and two layers of sparkles (regular + extra-bright "mega" sparkles), all driven by a `tilt` vector for an aggressive "secret-rare card" shimmer. The `intensity` parameter scales every holographic overlay, so the same shader spans a light surface finish (≈ source image) up to the full secret-rare blast.

Requires iOS 17+ / macOS 14+.

## Attribution

Adapted from [ShaderKit by James Rochabrun](https://github.com/jamesrochabrun/ShaderKit), licensed under the MIT License. Copyright (c) James Rochabrun. The two utility helpers (`swBling_hash21`, `swBling_hsv2rgb`) are vendored verbatim from ShaderKit's `ShaderUtilities.metal` and namespaced with a `swBling_` prefix so the file stays self-contained and free of duplicate-symbol collisions. The original copyright and license notice is retained verbatim in both source files as required by MIT; keep it intact when you copy the code into your project.

## File Layout

```
SWAnimation/SWMetal/
  SWIntenseBling.swift     // SwiftUI view + optional live-tuning sheet
  SWIntenseBling.metal     // [[stitchable]] swIntenseBling layerEffect entry point
```

Both files must be added to the Xcode target; the `.metal` file is compiled into the default `ShaderLibrary` automatically.

## Source Code

### SWIntenseBling.swift

```swift
//
//  SWIntenseBling.swift
//  ShipSwift
//
//  Adapted from ShaderKit by James Rochabrun
//  https://github.com/jamesrochabrun/ShaderKit
//  Licensed under the MIT License. Copyright (c) James Rochabrun.
//  Original copyright and license notice retained as required by MIT.
//  See ShipSwift ACKNOWLEDGEMENTS for the full license text.
//
//  Wraps any view in a maximum-intensity holographic shimmer via a
//  SwiftUI Metal `layerEffect` — a dense diamond grid, multi-hue rainbow,
//  three moving hotspots and layered sparkles, all driven by a `tilt`
//  vector (e.g. from a `DragGesture`) for a "secret-rare card" look.
//
//  Requires iOS 17+ / macOS 14+ (SwiftUI `ShaderLibrary`,
//  `Shader`/`ShaderFunction`, Metal `stitchable`).
//
//  Usage:
//    // Default — internal animation only
//    SWIntenseBling {
//        Image("messi").resizable().scaledToFill()
//    }
//
//    // Tilt-driven from a DragGesture
//    SWIntenseBling(tilt: dragTilt) { cardArtwork }
//
//    // Demo / debug — gear button + live-tuning sheet.
//    // Requires an enclosing `NavigationStack`.
//    SWIntenseBling(showsControls: true) { cardArtwork }
//
//  Parameters:
//    - tilt: Light/parallax direction in roughly `-1...1` per axis,
//            usually drag-driven (default `.zero`).
//    - intensity: Strength of every holographic overlay in `0...1`
//                 (default `0.5`). At 0 the source artwork shows through
//                 almost untouched; at 1 it is the full secret-rare blast.
//    - speed: Multiplier on the internal animation time (default `1.0`).
//    - showsControls: Attach a gear `ToolbarItem` that opens a live-tuning
//                     sheet (default `false`).
//
//  Note: This is the most intense of the foil family. `intensity` controls
//  how much it covers the source artwork — keep it low to leave the photo
//  the clear subject and let the shader read as a surface finish only.
//

import SwiftUI

// MARK: - Main View

struct SWIntenseBling<Content: View>: View {
    /// Light/parallax direction in roughly -1...1 per axis (drag-driven).
    var tilt: CGSize = .zero

    /// Strength of every holographic overlay in 0...1. At 0 the source
    /// artwork shows through almost untouched; at 1 it is the full blast.
    var intensity: Float = 0.5

    /// Multiplier on the internal animation time.
    var speed: Float = 1.0

    /// When `true`, attaches a gear `ToolbarItem` that opens a live-tuning sheet.
    var showsControls: Bool = false

    private let content: Content

    init(
        tilt: CGSize = .zero,
        intensity: Float = 0.5,
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
            SWIntenseBlingControlled(initial: self, content: content)
        } else {
            SWIntenseBlingRenderer(initial: self, content: content)
        }
    }
}

// MARK: - Renderer (pure shader binding)

private struct SWIntenseBlingRenderer<Content: View>: View {
    let initial: SWIntenseBling<Content>
    let content: Content

    @State private var start: Date = .now

    var body: some View {
        TimelineView(.animation) { ctx in
            let elapsed = Float(ctx.date.timeIntervalSince(start)) * initial.speed
            content.layerEffect(
                ShaderLibrary.swIntenseBling(
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

// (Optional `SWIntenseBlingControlled` + `SWIntenseBlingControlsSheet` provide
// a gear ToolbarItem and a Form-based live-tuning sheet. Omit them in
// production builds; the renderer above is everything you need to ship.)
```

### SWIntenseBling.metal

```metal
//
//  SWIntenseBling.metal
//  ShipSwift
//
//  Adapted from ShaderKit by James Rochabrun
//  https://github.com/jamesrochabrun/ShaderKit
//  Licensed under the MIT License. Copyright (c) James Rochabrun.
//  Original copyright and license notice retained as required by MIT.
//  See ShipSwift ACKNOWLEDGEMENTS for the full license text.
//
//  Stitchable SwiftUI layerEffect — maximum-intensity holographic shader
//  with a dense vertical diamond grid, multi-hue rainbow, three moving
//  light hotspots and layered sparkles. All highlights track the `tilt`
//  vector for an aggressive "secret-rare card" shimmer.
//
//  The two utility helpers below (hash + HSV->RGB) are vendored verbatim
//  from ShaderKit's ShaderUtilities.metal and namespaced with a `swBling_`
//  prefix so every SW Metal file stays self-contained and free of
//  duplicate-symbol collisions across the app's single shader library.
//
//  Paired with: SWIntenseBling.swift
//  Entry point: `swIntenseBling` — invoked via SwiftUI `.layerEffect(...)`.
//  Requires iOS 17+ / macOS 14+.
//

#include <metal_stdlib>
#include <SwiftUI/SwiftUI_Metal.h>
using namespace metal;

// =============================================================================
// MARK: - helpers (vendored from ShaderKit ShaderUtilities.metal)
// =============================================================================

/// 2D hash for pseudo-random values.
static float swBling_hash21(float2 p) {
    float3 p3 = fract(float3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

/// Convert HSV to RGB color space.
static half3 swBling_hsv2rgb(half3 c) {
    half4 K = half4(1.0h, 2.0h / 3.0h, 1.0h / 3.0h, 3.0h);
    half3 p = abs(fract(c.xxx + K.xyz) * 6.0h - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0h, 1.0h), c.y);
}

// =============================================================================
// MARK: - swIntenseBling
// =============================================================================

[[stitchable]] half4 swIntenseBling(
    float2 position,
    SwiftUI::Layer layer,
    float4 boundingRect,
    float2 tilt,
    float time,
    float intensity
) {
    float2 size = boundingRect.zw;
    float2 uv = position / size;
    half4 originalColor = layer.sample(position);

    if (originalColor.a < 0.01h) {
        return originalColor;
    }

    // Dense vertical diamond grid
    float diamondWidth = 28.0;
    float diamondHeight = 48.0;

    float2 diamondUV = float2(
        uv.x * diamondWidth,
        uv.y * diamondHeight
    );

    float row = floor(diamondUV.y);
    if (fmod(row, 2.0) == 1.0) {
        diamondUV.x += 0.5;
    }

    float2 diamondCell = floor(diamondUV);
    float2 diamondLocal = fract(diamondUV) - 0.5;
    float diamondDist = abs(diamondLocal.x) * 2.0 + abs(diamondLocal.y);

    float diamondEdge = smoothstep(0.5, 0.25, diamondDist);
    float diamondRim = smoothstep(0.5, 0.4, diamondDist) - smoothstep(0.4, 0.3, diamondDist);

    // Multi-hue rainbow
    float2 tiltOffset = tilt * 4.0;
    float hue1 = fract((diamondCell.x + diamondCell.y) * 0.06 + tiltOffset.x * 0.12);
    float hue2 = fract((diamondCell.x - diamondCell.y) * 0.04 + tiltOffset.y * 0.1);
    float hue = fract((hue1 + hue2) * 0.5 + time * 0.01);

    half3 diamondColor = swBling_hsv2rgb(half3(hue, 0.9h, 1.0h));

    // Secondary color layer
    float hue3 = fract(hue + 0.33);
    half3 diamondColor2 = swBling_hsv2rgb(half3(hue3, 0.7h, 0.9h));

    // Multiple light sources
    float2 light1 = float2(0.5 + tilt.y * 0.9, 0.5 + tilt.x * 0.9);
    float2 light2 = float2(0.5 - tilt.y * 0.6, 0.5 - tilt.x * 0.6);
    float2 light3 = float2(0.5 + tilt.x * 0.5, 0.5 - tilt.y * 0.5);

    float hot1 = pow(smoothstep(0.5, 0.0, length(uv - light1)), 1.8);
    float hot2 = pow(smoothstep(0.4, 0.0, length(uv - light2)), 2.0) * 0.6;
    float hot3 = pow(smoothstep(0.35, 0.0, length(uv - light3)), 2.0) * 0.4;
    float totalHot = hot1 + hot2 + hot3;

    // Intense sparkles
    float sparkleRand = swBling_hash21(diamondCell);
    float sparklePhase = sparkleRand * 6.28 + (tilt.x + tilt.y) * 12.0 + time * 3.0;
    float sparkle = pow(max(0.0, sin(sparklePhase)), 6.0);
    sparkle *= step(0.5, sparkleRand);
    sparkle *= diamondEdge;

    // Extra bright sparkles
    float megaSparkle = pow(max(0.0, sin(sparklePhase * 0.5)), 12.0);
    megaSparkle *= step(0.85, sparkleRand);
    megaSparkle *= diamondEdge;

    // Combine all effects. `hi` scales every holographic overlay so the
    // shader can act as a light surface finish (intensity 0 ≈ source image)
    // up to the full secret-rare blast (intensity 1).
    half hi = half(intensity);

    half holoStrength = half(diamondEdge * (0.7 + totalHot * 0.3)) * hi;
    half3 result = mix(originalColor.rgb, diamondColor, holoStrength);

    result = mix(result, diamondColor2, half(totalHot * diamondEdge * 0.3) * hi);
    result += half(totalHot * diamondEdge * 0.5) * diamondColor * hi;
    result += half(diamondRim * 0.5 * (totalHot + 0.3)) * half3(1.0h, 1.0h, 1.0h) * hi;
    result += half(sparkle * 1.5) * half3(1.0h, 1.0h, 1.0h) * hi;
    result += half(megaSparkle * 2.5) * half3(1.0h, 0.95h, 0.9h) * hi;
    result *= half(1.0 + totalHot * 0.25 * intensity);

    return half4(result, originalColor.a);
}
```

## Usage

```swift
// Default — moderate intensity (0.5), internal animation only
SWIntenseBling {
    Image("messi").resizable().scaledToFill()
}
.frame(width: 250, height: 350)
.clipShape(RoundedRectangle(cornerRadius: 16))

// Keep the photo readable — low intensity reads as a surface finish only
SWIntenseBling(intensity: 0.25) { cardArtwork }

// Full secret-rare blast, tilt-driven from a DragGesture
@State private var tilt: CGSize = .zero

SWIntenseBling(tilt: tilt, intensity: 1.0) { cardArtwork }
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
| `intensity` | `Float` | `0.5` | 0…1 | Strength of every overlay — 0 ≈ source image, 1 = full secret-rare blast |
| `speed` | `Float` | `1.0` | 0…3 | Multiplier on the internal animation time |
| `showsControls` | `Bool` | `false` | — | Demo-only gear ToolbarItem; requires an enclosing `NavigationStack` |

## Integration Checklist

1. Copy `SWIntenseBling.swift` and `SWIntenseBling.metal` into your Xcode target, keeping the MIT attribution header on both files.
2. Confirm the deployment target is iOS 17+ / macOS 14+.
3. Wrap a card / photo / SF Symbol in `SWIntenseBling { ... }`; clip it to a `RoundedRectangle`.
4. Start with a **low** `intensity` (≈ 0.25) if the underlying photo must stay the clear subject; raise toward `1.0` only when you want the full holographic blast to dominate.
5. Drive `tilt` from a `DragGesture` to make the hotspots and sparkles sweep across the card.

## Notes / Gotchas

- The shader returns the source unchanged where `originalColor.a < 0.01` — the bling only paints over opaque pixels.
- The two helpers (`swBling_hash21`, `swBling_hsv2rgb`) are vendored from ShaderKit and prefixed with `swBling_` to avoid duplicate-symbol collisions when several SW Metal files coexist in one shader library. Keep the prefix if you adapt them.
- This is the heaviest of the foil family — two sparkle layers, three hotspots, and a per-pixel HSV conversion. Prefer it on a single hero card rather than a grid of thumbnails.
- `maxSampleOffset` is `.zero` (no neighbour sampling). Do not raise it.
