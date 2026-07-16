---
id: animation-chromatic-glass
title: Chromatic Glass
description: Subtle chromatic-aberration glass layerEffect over any source view via a SwiftUI Metal stitchable shader — red/blue channels split toward the edges along the tilt direction, with a soft centre glow, for a premium glass-over-card feel
tier: free
tags: [animation, metal, shader, glass, chromatic-aberration, layerEffect, card, SwiftUI]
---

## Overview

A subtle chromatic-aberration "glass" pass applied to any view through SwiftUI's `layerEffect` Metal pipeline. The red and blue channels are sampled at opposing offsets that grow toward the edges (non-linear falloff) and follow the `tilt` vector; a soft centre brightness glow finishes the look. Unlike the foil family, this effect **samples neighbouring pixels**, so the renderer gives the `layerEffect` a `maxSampleOffset` budget — without it, edge pixels would clamp and the RGB fringing would be cut off.

Requires iOS 17+ / macOS 14+.

## Attribution

Adapted from [ShaderKit by James Rochabrun](https://github.com/jamesrochabrun/ShaderKit), licensed under the MIT License. Copyright (c) James Rochabrun. Extracted from ShaderKit's `GlassShaders.metal` `chromaticGlass` function. The original copyright and license notice is retained verbatim in both source files as required by MIT; keep it intact when you copy the code into your project.

## File Layout

```
SWAnimation/SWMetal/
  SWChromaticGlass.swift     // SwiftUI view + optional live-tuning sheet
  SWChromaticGlass.metal     // [[stitchable]] swChromaticGlass layerEffect entry point
```

Both files must be added to the Xcode target; the `.metal` file is compiled into the default `ShaderLibrary` automatically.

## Source Code

### SWChromaticGlass.swift

```swift
//
//  SWChromaticGlass.swift
//  ShipSwift
//
//  Adapted from ShaderKit by James Rochabrun
//  https://github.com/jamesrochabrun/ShaderKit
//  Licensed under the MIT License. Copyright (c) James Rochabrun.
//  Original copyright and license notice retained as required by MIT.
//  See ShipSwift ACKNOWLEDGEMENTS for the full license text.
//
//  Wraps any view in a subtle chromatic-aberration "glass" pass via a
//  SwiftUI Metal `layerEffect` — red/blue channels split toward the edges
//  along the `tilt` direction (e.g. from a `DragGesture`), with a soft
//  centre glow, for a premium glass-over-card feel.
//
//  Requires iOS 17+ / macOS 14+ (SwiftUI `ShaderLibrary`,
//  `Shader`/`ShaderFunction`, Metal `stitchable`).
//
//  Usage:
//    // Default — gentle RGB split, internal only
//    SWChromaticGlass {
//        Image("ronaldo").resizable().scaledToFill()
//    }
//
//    // Tilt-driven, stronger separation
//    SWChromaticGlass(tilt: dragTilt, separation: 0.6) { cardArtwork }
//
//    // Demo / debug — gear button + live-tuning sheet.
//    // Requires an enclosing `NavigationStack`.
//    SWChromaticGlass(showsControls: true) { cardArtwork }
//
//  Parameters:
//    - tilt: Light/parallax direction in roughly `-1...1` per axis,
//            usually drag-driven (default `.zero`).
//    - intensity: Blend of the split over the source in `0...1`
//                 (default `0.6`).
//    - separation: How far the R/B channels separate in `0...1`
//                  (default `0.4`).
//    - showsControls: Attach a gear `ToolbarItem` that opens a live-tuning
//                     sheet (default `false`).
//

import SwiftUI

// MARK: - Main View

struct SWChromaticGlass<Content: View>: View {
    /// Light/parallax direction in roughly -1...1 per axis (drag-driven).
    var tilt: CGSize = .zero

    /// Blend of the split over the source in 0...1.
    var intensity: Float = 0.6

    /// How far the R/B channels separate in 0...1.
    var separation: Float = 0.4

    /// When `true`, attaches a gear `ToolbarItem` that opens a live-tuning sheet.
    var showsControls: Bool = false

    private let content: Content

    init(
        tilt: CGSize = .zero,
        intensity: Float = 0.6,
        separation: Float = 0.4,
        showsControls: Bool = false,
        @ViewBuilder content: () -> Content
    ) {
        self.tilt = tilt
        self.intensity = intensity
        self.separation = separation
        self.showsControls = showsControls
        self.content = content()
    }

    var body: some View {
        if showsControls {
            SWChromaticGlassControlled(initial: self, content: content)
        } else {
            SWChromaticGlassRenderer(initial: self, content: content)
        }
    }
}

// MARK: - Renderer (pure shader binding)

private struct SWChromaticGlassRenderer<Content: View>: View {
    let initial: SWChromaticGlass<Content>
    let content: Content

    @State private var start: Date = .now

    var body: some View {
        TimelineView(.animation) { ctx in
            let elapsed = Float(ctx.date.timeIntervalSince(start))
            // RGB split offsets the sample point — give the layerEffect a
            // small offset budget so edge pixels can pull in neighbours.
            content.layerEffect(
                ShaderLibrary.swChromaticGlass(
                    .boundingRect,
                    .float2(Float(initial.tilt.width), Float(initial.tilt.height)),
                    .float(elapsed),
                    .float(initial.intensity),
                    .float(initial.separation)
                ),
                maxSampleOffset: CGSize(width: 28, height: 28)
            )
        }
    }
}

// (Optional `SWChromaticGlassControlled` + `SWChromaticGlassControlsSheet`
// provide a gear ToolbarItem and a Form-based live-tuning sheet. Omit them
// in production builds; the renderer above is everything you need to ship.)
```

### SWChromaticGlass.metal

```metal
//
//  SWChromaticGlass.metal
//  ShipSwift
//
//  Adapted from ShaderKit by James Rochabrun
//  https://github.com/jamesrochabrun/ShaderKit
//  Licensed under the MIT License. Copyright (c) James Rochabrun.
//  Original copyright and license notice retained as required by MIT.
//  See ShipSwift ACKNOWLEDGEMENTS for the full license text.
//
//  Stitchable SwiftUI layerEffect — a subtle chromatic-aberration "glass"
//  pass. The red and blue channels are sampled at opposing offsets that
//  grow toward the edges and follow the `tilt` vector, plus a soft centre
//  glow, for a premium glass-over-card feel.
//
//  Extracted from ShaderKit's GlassShaders.metal `chromaticGlass` function.
//
//  Paired with: SWChromaticGlass.swift
//  Entry point: `swChromaticGlass` — invoked via SwiftUI `.layerEffect(...)`.
//  Requires iOS 17+ / macOS 14+.
//

#include <metal_stdlib>
#include <SwiftUI/SwiftUI_Metal.h>
using namespace metal;

// =============================================================================
// MARK: - swChromaticGlass
// =============================================================================

[[stitchable]] half4 swChromaticGlass(
    float2 position,
    SwiftUI::Layer layer,
    float4 boundingRect,
    float2 tilt,
    float time,
    float intensity,
    float separation   // How much RGB channels separate (0.0 - 1.0)
) {
    float2 size = boundingRect.zw;
    float2 uv = position / size;

    // Chromatic offset based on tilt and position
    // Stronger at edges, follows tilt direction
    float2 center = float2(0.5, 0.5);
    float2 fromCenter = uv - center;
    float edgeFactor = length(fromCenter) * 2.0; // 0 at center, 1 at corners
    edgeFactor = pow(edgeFactor, 1.5); // Non-linear falloff

    // Offset direction influenced by tilt
    float2 offsetDir = normalize(fromCenter + tilt * 0.3 + 0.001);
    // Keep a baseline split even at the centre (the 0.15 floor) so the RGB
    // fringing reads clearly across the whole photo, then ramp up at edges.
    float offsetAmount = separation * (edgeFactor * 0.85 + 0.15) * 14.0; // pixels

    // Sample each channel at slightly different positions
    float2 redOffset = offsetDir * offsetAmount;
    float2 blueOffset = -offsetDir * offsetAmount;

    half4 redSample = layer.sample(position + redOffset);
    half4 greenSample = layer.sample(position);
    half4 blueSample = layer.sample(position + blueOffset);

    half4 result;
    half h_intensity = half(intensity);
    result.r = mix(greenSample.r, redSample.r, h_intensity);
    result.g = greenSample.g;
    result.b = mix(greenSample.b, blueSample.b, h_intensity);
    result.a = greenSample.a;

    // Add subtle brightness boost at center
    float centerGlow = smoothstep(0.7, 0.0, length(fromCenter)) * 0.03 * intensity;
    result.rgb += centerGlow;

    return result;
}
```

## Usage

```swift
// Default — gentle RGB split, internal only
SWChromaticGlass {
    Image("ronaldo").resizable().scaledToFill()
}
.frame(width: 250, height: 350)
.clipShape(RoundedRectangle(cornerRadius: 16))

// Tilt-driven, stronger separation
@State private var tilt: CGSize = .zero

SWChromaticGlass(tilt: tilt, separation: 0.6) { cardArtwork }
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
| `intensity` | `Float` | `0.6` | 0…1 | Blend of the R/B split over the source |
| `separation` | `Float` | `0.4` | 0…1 | How far the R/B channels separate (max ≈ 14 px at the edges) |
| `showsControls` | `Bool` | `false` | — | Demo-only gear ToolbarItem; requires an enclosing `NavigationStack` |

## Integration Checklist

1. Copy `SWChromaticGlass.swift` and `SWChromaticGlass.metal` into your Xcode target, keeping the MIT attribution header on both files.
2. Confirm the deployment target is iOS 17+ / macOS 14+.
3. Wrap a card / photo in `SWChromaticGlass { ... }`; clip it to a `RoundedRectangle`.
4. Keep the `maxSampleOffset` of `CGSize(width: 28, height: 28)` in the renderer — it must comfortably exceed the maximum pixel offset the shader reaches (≈ 14 px). See Gotchas.
5. Drive `tilt` from a `DragGesture` so the fringing follows the card's rotation.

## Notes / Gotchas

- **`maxSampleOffset` is load-bearing.** This is the only effect in the new Metal set that samples neighbouring pixels (R/B channels at `position ± offset`). The maximum offset the shader reaches is `separation(max 1.0) × (1×0.85 + 0.15) × 14 ≈ 14 px`; the renderer requests `28 px` of headroom. If you drop it to `.zero` (as the foil family uses), the layer pre-clips its content and the RGB fringing is truncated at the edges. Do not copy `.zero` from the other recipes here.
- The `0.15` floor inside `offsetAmount` keeps a baseline split even at the centre, so the fringing reads across the whole photo rather than only at the corners.
- The effect is deliberately subtle — it reads as glass-over-card, not a glitch. Raise `separation` and `intensity` together for a stronger split.
