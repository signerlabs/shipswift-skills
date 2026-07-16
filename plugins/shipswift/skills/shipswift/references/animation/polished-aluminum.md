---
id: animation-polished-aluminum
title: Polished Aluminum
description: Polished-aluminum finish layerEffect over any source view via a SwiftUI Metal stitchable shader — a tilt-shifted cyan/silver/purple brushed-metal gradient, a diagonal 45-degree rainbow iridescence band, and a tilt-tracking specular hotspot
tier: free
tags: [animation, metal, shader, metal-finish, aluminum, iridescent, layerEffect, card, SwiftUI]
---

## Overview

Wraps any view in a polished-aluminum finish through SwiftUI's `layerEffect` Metal pipeline, in three layered steps: (1) a tilt-shifted cyan → silver → purple vertical gradient with brushed-metal value noise forms the metal base; (2) a diagonal 45-degree rainbow band sweeps across via screen blending for iridescence; (3) a tilt-tracking specular hotspot finishes the lit-metal look. Feed `tilt` from a `DragGesture` to rotate the metal — the finish reads as a still, reflective surface that comes alive on drag.

Requires iOS 17+ / macOS 14+.

## Attribution

Adapted from [ShaderKit by James Rochabrun](https://github.com/jamesrochabrun/ShaderKit), licensed under the MIT License. Copyright (c) James Rochabrun. The four utility helpers (`swAlu_hash21`, `swAlu_valueNoise`, `swAlu_rainbowGradient`, `swAlu_blendScreen`) are vendored verbatim from ShaderKit's `ShaderUtilities.metal` and namespaced with a `swAlu_` prefix so the file stays self-contained and free of duplicate-symbol collisions. The original copyright and license notice is retained verbatim in both source files as required by MIT; keep it intact when you copy the code into your project.

## File Layout

```
SWAnimation/SWMetal/
  SWPolishedAluminum.swift     // SwiftUI view + optional live-tuning sheet
  SWPolishedAluminum.metal     // [[stitchable]] swPolishedAluminum layerEffect entry point
```

Both files must be added to the Xcode target; the `.metal` file is compiled into the default `ShaderLibrary` automatically.

## Source Code

### SWPolishedAluminum.swift

```swift
//
//  SWPolishedAluminum.swift
//  ShipSwift
//
//  Adapted from ShaderKit by James Rochabrun
//  https://github.com/jamesrochabrun/ShaderKit
//  Licensed under the MIT License. Copyright (c) James Rochabrun.
//  Original copyright and license notice retained as required by MIT.
//  See ShipSwift ACKNOWLEDGEMENTS for the full license text.
//
//  Wraps any view in a polished-aluminum finish via a SwiftUI Metal
//  `layerEffect` — a tilt-shifted cyan/silver/purple brushed-metal
//  gradient, a diagonal rainbow iridescence band, and a tilt-tracking
//  specular hotspot. Feed `tilt` from a `DragGesture` to rotate the metal.
//
//  Requires iOS 17+ / macOS 14+ (SwiftUI `ShaderLibrary`,
//  `Shader`/`ShaderFunction`, Metal `stitchable`).
//
//  Usage:
//    // Default — polished metal, internal animation only
//    SWPolishedAluminum {
//        Image("messi").resizable().scaledToFill()
//    }
//
//    // Tilt-driven from a DragGesture
//    SWPolishedAluminum(tilt: dragTilt, intensity: 0.85) { cardArtwork }
//
//    // Demo / debug — gear button + live-tuning sheet.
//    // Requires an enclosing `NavigationStack`.
//    SWPolishedAluminum(showsControls: true) { cardArtwork }
//
//  Parameters:
//    - tilt: Light/parallax direction in roughly `-1...1` per axis,
//            usually drag-driven (default `.zero`).
//    - intensity: Blend of the metal finish over the source in `0...1`
//                 (default `0.85`).
//    - speed: Multiplier on the internal animation time (default `1.0`).
//    - showsControls: Attach a gear `ToolbarItem` that opens a live-tuning
//                     sheet (default `false`).
//
//  Note: `time` is wired through for API symmetry with the foil family;
//  the metal finish is driven mainly by `tilt`, so it reads as a still,
//  reflective surface that comes alive on drag.
//

import SwiftUI

// MARK: - Main View

struct SWPolishedAluminum<Content: View>: View {
    /// Light/parallax direction in roughly -1...1 per axis (drag-driven).
    var tilt: CGSize = .zero

    /// Blend of the metal finish over the source in 0...1.
    var intensity: Float = 0.85

    /// Multiplier on the internal animation time.
    var speed: Float = 1.0

    /// When `true`, attaches a gear `ToolbarItem` that opens a live-tuning sheet.
    var showsControls: Bool = false

    private let content: Content

    init(
        tilt: CGSize = .zero,
        intensity: Float = 0.85,
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
            SWPolishedAluminumControlled(initial: self, content: content)
        } else {
            SWPolishedAluminumRenderer(initial: self, content: content)
        }
    }
}

// MARK: - Renderer (pure shader binding)

private struct SWPolishedAluminumRenderer<Content: View>: View {
    let initial: SWPolishedAluminum<Content>
    let content: Content

    @State private var start: Date = .now

    var body: some View {
        TimelineView(.animation) { ctx in
            let elapsed = Float(ctx.date.timeIntervalSince(start)) * initial.speed
            content.layerEffect(
                ShaderLibrary.swPolishedAluminum(
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

// (Optional `SWPolishedAluminumControlled` + `SWPolishedAluminumControlsSheet`
// provide a gear ToolbarItem and a Form-based live-tuning sheet. Omit them in
// production builds; the renderer above is everything you need to ship.)
```

### SWPolishedAluminum.metal

```metal
//
//  SWPolishedAluminum.metal
//  ShipSwift
//
//  Adapted from ShaderKit by James Rochabrun
//  https://github.com/jamesrochabrun/ShaderKit
//  Licensed under the MIT License. Copyright (c) James Rochabrun.
//  Original copyright and license notice retained as required by MIT.
//  See ShipSwift ACKNOWLEDGEMENTS for the full license text.
//
//  Stitchable SwiftUI layerEffect — polished aluminum. A tilt-shifted
//  cyan/silver/purple vertical gradient forms the brushed-metal base, a
//  diagonal 45-degree rainbow band sweeps across for iridescence, and a
//  tilt-tracking specular hotspot finishes the lit-metal look.
//
//  The three utility helpers below (hash, value noise, rainbow ramp and
//  screen blend) are vendored verbatim from ShaderKit's
//  ShaderUtilities.metal and namespaced with a `swAlu_` prefix so every
//  SW Metal file stays self-contained and free of duplicate-symbol
//  collisions across the app's single shader library.
//
//  Paired with: SWPolishedAluminum.swift
//  Entry point: `swPolishedAluminum` — invoked via SwiftUI `.layerEffect(...)`.
//  Requires iOS 17+ / macOS 14+.
//

#include <metal_stdlib>
#include <SwiftUI/SwiftUI_Metal.h>
using namespace metal;

// =============================================================================
// MARK: - helpers (vendored from ShaderKit ShaderUtilities.metal)
// =============================================================================

/// 2D hash for pseudo-random values.
static float swAlu_hash21(float2 p) {
    float3 p3 = fract(float3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

/// 2D value noise.
static float swAlu_valueNoise(float2 p) {
    float2 i = floor(p);
    float2 f = fract(p);

    float a = swAlu_hash21(i);
    float b = swAlu_hash21(i + float2(1.0, 0.0));
    float c = swAlu_hash21(i + float2(0.0, 1.0));
    float d = swAlu_hash21(i + float2(1.0, 1.0));

    float2 u = f * f * (3.0 - 2.0 * f);

    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

/// Multi-stop rainbow gradient (7 colors).
static half3 swAlu_rainbowGradient(float t) {
    half3 colors[7] = {
        half3(1.0h, 0.0h, 0.0h),   // Red
        half3(1.0h, 0.5h, 0.0h),   // Orange
        half3(1.0h, 1.0h, 0.0h),   // Yellow
        half3(0.0h, 1.0h, 0.0h),   // Green
        half3(0.0h, 0.5h, 1.0h),   // Blue
        half3(0.3h, 0.0h, 1.0h),   // Indigo
        half3(0.5h, 0.0h, 0.5h)    // Violet
    };

    float scaledT = fract(t) * 6.0;
    int index = int(scaledT);
    float blend = fract(scaledT);

    int nextIndex = (index + 1) % 7;
    return mix(colors[index], colors[nextIndex], half(blend));
}

/// Screen: Lightens by inverting, multiplying, and inverting again.
static half3 swAlu_blendScreen(half3 base, half3 blend) {
    return 1.0h - (1.0h - base) * (1.0h - blend);
}

// =============================================================================
// MARK: - swPolishedAluminum
// =============================================================================

[[stitchable]] half4 swPolishedAluminum(
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

    // =========================================================================
    // STEP 1: Linear Gradient Base (Polished Metal Look)
    // =========================================================================

    // Define polished metal colors
    half3 silver = half3(0.92h, 0.93h, 0.95h);       // Bright silver
    half3 darkSilver = half3(0.70h, 0.72h, 0.75h);   // Darker silver
    half3 cyan = half3(0.5h, 0.85h, 0.92h);          // Cyan/turquoise
    half3 purple = half3(0.78h, 0.65h, 0.88h);       // Lavender/purple

    // Linear gradient that shifts with tilt
    // Gradient runs vertically but shifts horizontally with tilt
    float gradientT = uv.y + tilt.x * 0.4 + tilt.y * 0.3;
    gradientT = fract(gradientT); // Keep in 0-1 range

    // Create smooth color bands: cyan -> silver -> purple -> silver -> cyan
    half3 metalBase;
    if (gradientT < 0.2) {
        // Cyan to silver
        float t = gradientT / 0.2;
        metalBase = mix(cyan, silver, half(smoothstep(0.0, 1.0, t)));
    } else if (gradientT < 0.4) {
        // Silver to bright silver
        float t = (gradientT - 0.2) / 0.2;
        metalBase = mix(silver, half3(0.98h), half(smoothstep(0.0, 1.0, t) * 0.5));
    } else if (gradientT < 0.6) {
        // Silver to purple
        float t = (gradientT - 0.4) / 0.2;
        metalBase = mix(silver, purple, half(smoothstep(0.0, 1.0, t)));
    } else if (gradientT < 0.8) {
        // Purple to silver
        float t = (gradientT - 0.6) / 0.2;
        metalBase = mix(purple, darkSilver, half(smoothstep(0.0, 1.0, t)));
    } else {
        // Dark silver to cyan
        float t = (gradientT - 0.8) / 0.2;
        metalBase = mix(darkSilver, cyan, half(smoothstep(0.0, 1.0, t)));
    }

    // Add horizontal variation for more dimension
    float horizVar = sin(uv.x * 3.14159 + tilt.x * 2.0) * 0.5 + 0.5;
    metalBase = mix(metalBase, metalBase * 1.1h, half(horizVar * 0.15));

    // Add subtle noise for brushed texture
    float noise = swAlu_valueNoise(uv * 80.0 + tilt * 2.0);
    metalBase += half3((noise - 0.5) * 0.08h);

    // =========================================================================
    // STEP 2: Diagonal Rainbow Reflection Band
    // =========================================================================

    // Diagonal direction (45 degrees - bottom-left to top-right)
    float rainbowAngle = 45.0 * 3.14159 / 180.0;
    float2 rainbowDir = float2(cos(rainbowAngle), sin(rainbowAngle));

    // Rainbow position shifts with tilt for parallax
    float2 tiltOffset = tilt * 0.5;
    float rainbowT = dot(uv + tiltOffset, rainbowDir);

    // Create a focused band of rainbow
    float bandCenter = 0.5 + (tilt.x + tilt.y) * 0.25;
    float bandWidth = 0.3;
    float bandFalloff = smoothstep(bandCenter - bandWidth, bandCenter, rainbowT) *
                        smoothstep(bandCenter + bandWidth, bandCenter, rainbowT);

    // Rainbow colors along the band
    float rainbowPhase = rainbowT * 2.5 + (tilt.x - tilt.y) * 1.5;
    half3 rainbow = swAlu_rainbowGradient(rainbowPhase);

    // =========================================================================
    // STEP 3: Combine Layers
    // =========================================================================

    half3 result = metalBase;

    // Blend rainbow using screen mode for bright overlay
    half3 rainbowContrib = rainbow * half(bandFalloff * intensity * 0.5);
    result = swAlu_blendScreen(result, rainbowContrib);

    // Add subtle specular highlight that follows tilt
    float2 lightPos = float2(0.5 + tilt.x * 0.3, 0.5 + tilt.y * 0.3);
    float lightDist = length(uv - lightPos);
    float specular = smoothstep(0.5, 0.0, lightDist);
    specular = pow(specular, 3.0) * 0.2;
    result += half3(half(specular));

    // Mix with original based on intensity
    result = mix(originalColor.rgb, result, half(intensity));

    return half4(clamp(result, half3(0.0h), half3(1.0h)), originalColor.a);
}
```

## Usage

```swift
// Default — polished metal, internal animation only
SWPolishedAluminum {
    Image("messi").resizable().scaledToFill()
}
.frame(width: 250, height: 350)
.clipShape(RoundedRectangle(cornerRadius: 16))

// Let the underlying art show through more — lower intensity
SWPolishedAluminum(intensity: 0.6) { cardArtwork }

// Tilt-driven from a DragGesture
@State private var tilt: CGSize = .zero

SWPolishedAluminum(tilt: tilt, intensity: 0.85) { cardArtwork }
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
| `intensity` | `Float` | `0.85` | 0…1 | Blend of the metal finish over the source — at 1 the metal nearly replaces the art |
| `speed` | `Float` | `1.0` | 0…3 | Multiplier on the internal animation time |
| `showsControls` | `Bool` | `false` | — | Demo-only gear ToolbarItem; requires an enclosing `NavigationStack` |

## Integration Checklist

1. Copy `SWPolishedAluminum.swift` and `SWPolishedAluminum.metal` into your Xcode target, keeping the MIT attribution header on both files.
2. Confirm the deployment target is iOS 17+ / macOS 14+.
3. Wrap a card / photo / SF Symbol in `SWPolishedAluminum { ... }`; clip it to a `RoundedRectangle`.
4. The default `intensity` of `0.85` makes a strongly metallic surface; drop toward `0.5–0.6` if you want the underlying artwork to remain visible through the finish.
5. Drive `tilt` from a `DragGesture` so the gradient, rainbow band, and specular hotspot all rotate together.

## Notes / Gotchas

- `time` is plumbed through for API symmetry with the rest of the foil family, but the look is driven almost entirely by `tilt` — with `tilt == .zero` the finish is essentially static. Provide a tilt source if you want motion.
- The metal color ramp (cyan / silver / purple) is baked into the shader, not parameterized. Edit the `silver` / `darkSilver` / `cyan` / `purple` constants in the `.metal` file to recolor the finish.
- The four helpers (`swAlu_*`) are vendored from ShaderKit and prefixed to avoid duplicate-symbol collisions when several SW Metal files coexist in one shader library. Keep the prefix if you adapt them.
- `maxSampleOffset` is `.zero` (the shader reads only the pixel under `position`). Do not raise it.
