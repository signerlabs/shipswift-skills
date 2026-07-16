---
id: animation-ink-smoke
title: Ink Smoke
description: Domain-warped FBM "ink in water" smoke field rendered via a SwiftUI Metal stitchable shader, with four ink colors and a wispy highlight
tier: free
tags: [animation, metal, shader, ink, smoke, background, fbm, SwiftUI]
---

## Overview

Full-screen "ink in water" smoke field rendered through SwiftUI's `colorEffect` Metal pipeline. Three layers of value-noise FBM form the smoke body: `q` warps `p`, `r2` warps it again with `q` as the offset, and `f` is a final FBM sampled at the double-warped point. Four ink colors are mixed by `f`, `q.x`, and `r2.y`; a wispy highlight is added where `f` peaks, producing slow billowing blooms reminiscent of food coloring diffusing through water.

Requires iOS 17+ / macOS 14+.

## File Layout

```
SWAnimation/SWMetal/
  SWInkSmoke.swift     // SwiftUI view + optional live-tuning sheet
  SWInkSmoke.metal     // [[ stitchable ]] swInkSmoke entry point
```

## Source Code

### SWInkSmoke.swift

```swift
import SwiftUI

// MARK: - Main View

struct SWInkSmoke: View {
    /// First ink color, dominant where the final FBM is darkest.
    var ink1: Color = Color(red: 0.051, green: 0.0,   blue: 0.102)   // #0D001A

    /// Second ink color, mixed in by the final FBM.
    var ink2: Color = Color(red: 0.102, green: 0.2,   blue: 0.502)   // #1A3380

    /// Third ink color, mixed in by the first warp field.
    var ink3: Color = Color(red: 0.4,   green: 0.102, blue: 0.302)   // #661A4D

    /// Fourth ink color, mixed in by the second warp field.
    var ink4: Color = Color(red: 0.0,   green: 0.302, blue: 0.4)     // #004D66

    /// Wispy highlight color added where the field peaks.
    var glow: Color = Color(red: 0.302, green: 0.2,   blue: 0.4)     // #4D3366

    /// Multiplier on the internal time evolution.
    var speed: Float = 1.0

    /// Spatial scale of the FBM field — higher = finer ink filaments.
    var scale: Float = 1.8

    /// Strength of the first-pass domain warp on the second.
    var warp: Float = 4.0

    /// Multiplier on the wispy highlight additive layer.
    var highlight: Float = 1.0

    /// When `true`, attaches a gear `ToolbarItem` that opens a live-tuning sheet.
    var showsControls: Bool = false

    var body: some View {
        if showsControls {
            SWInkSmokeControlled(initial: self)
        } else {
            SWInkSmokeRenderer(
                ink1: ink1,
                ink2: ink2,
                ink3: ink3,
                ink4: ink4,
                glow: glow,
                speed: speed,
                scale: scale,
                warp: warp,
                highlight: highlight
            )
        }
    }
}

// MARK: - Renderer (pure shader binding)

private struct SWInkSmokeRenderer: View {
    let ink1: Color
    let ink2: Color
    let ink3: Color
    let ink4: Color
    let glow: Color
    let speed: Float
    let scale: Float
    let warp: Float
    let highlight: Float

    @State private var start: Date = .now

    var body: some View {
        TimelineView(.animation) { ctx in
            let elapsed = Float(ctx.date.timeIntervalSince(start))
            // The base layer is `ink1` — the shader overwrites every pixel,
            // so the choice is cosmetic, but `ink1` keeps the first frame
            // looking like dark ink instead of flashing black.
            ink1
                .colorEffect(
                    ShaderLibrary.swInkSmoke(
                        .boundingRect,
                        .float(elapsed),
                        .float(speed),
                        .float(scale),
                        .float(warp),
                        .float(highlight),
                        .color(ink1),
                        .color(ink2),
                        .color(ink3),
                        .color(ink4),
                        .color(glow)
                    )
                )
        }
    }
}

// (Optional `SWInkSmokeControlled` + `SWInkSmokeControlsSheet` provide a
// gear ToolbarItem and a Form-based live-tuning sheet. Omit them in
// production builds.)
```

### SWInkSmoke.metal

```metal
#include <metal_stdlib>
#include <SwiftUI/SwiftUI_Metal.h>
using namespace metal;

static float swInkSmokeHash21(float2 p) {
    p = fract(p * float2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

static float swInkSmokeVNoise(float2 p) {
    float2 i = floor(p);
    float2 f = fract(p);
    float2 u = f * f * (3.0 - 2.0 * f);
    float a = swInkSmokeHash21(i);
    float b = swInkSmokeHash21(i + float2(1.0, 0.0));
    float c = swInkSmokeHash21(i + float2(0.0, 1.0));
    float d = swInkSmokeHash21(i + float2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// 5-octave fractional Brownian motion. Loop bound is static so the compiler
// can fully unroll; do not turn the octave count into a uniform.
static float swInkSmokeFBM(float2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
        v += a * swInkSmokeVNoise(p);
        p *= 2.0;
        a *= 0.5;
    }
    return v;
}

[[ stitchable ]] half4 swInkSmoke(float2 position,
                                  half4  color,
                                  float4 boundingRect,
                                  float  time,
                                  float  speed,
                                  float  scale,
                                  float  warp,
                                  float  highlight,
                                  half4  ink1,
                                  half4  ink2,
                                  half4  ink3,
                                  half4  ink4,
                                  half4  glow) {
    float2 size = boundingRect.zw;
    float2 uv   = (position * 2.0 - size) / min(size.x, size.y);

    float  t = time * speed * 0.2;
    float2 p = uv * max(scale, 0.0001);

    // Two-stage domain warp — q warps p, then r2 warps it again with q as
    // the offset. f is the final fbm sampled at the double-warped point.
    float2 q  = float2(swInkSmokeFBM(p + float2(t * 0.4, t * 0.3)),
                       swInkSmokeFBM(p + float2(t * 0.2, -t * 0.4)));
    float2 r2 = float2(swInkSmokeFBM(p + q * warp + float2(1.7, 9.2) + t * 0.15),
                       swInkSmokeFBM(p + q * warp + float2(8.3, 2.8) - t * 0.1));
    float  f  = swInkSmokeFBM(p + r2 * 2.0);

    float3 c1 = float3(ink1.rgb);
    float3 c2 = float3(ink2.rgb);
    float3 c3 = float3(ink3.rgb);
    float3 c4 = float3(ink4.rgb);
    float3 g  = float3(glow.rgb);

    float3 col = mix(c1, c2, clamp(f * 2.0, 0.0, 1.0));
    col        = mix(col, c3, clamp(q.x * 1.5, 0.0, 1.0));
    col        = mix(col, c4, clamp(r2.y * 0.8, 0.0, 1.0));

    // Wispy highlights where the double-warped field peaks.
    float wisp = pow(clamp(f * 1.5, 0.0, 1.0), 3.0);
    col       += g * wisp * highlight;

    return half4(half3(col), 1.0);
}
```

## Usage

```swift
// Default — twilight-purple ink, full-screen
ZStack {
    SWInkSmoke()
        .ignoresSafeArea()
    // Your content here
}

// Recolor — emerald / teal ink
SWInkSmoke(
    ink1: .black,
    ink2: .teal,
    ink3: .green,
    ink4: .mint,
    glow: .white
)

// As a section background
myContent
    .background { SWInkSmoke() }

// Finer filaments, brighter highlights
SWInkSmoke(scale: 3.0, highlight: 1.8)
```

## Parameters

| Parameter | Type | Default | Range | Notes |
|---|---|---|---|---|
| `ink1` | `Color` | `#0D001A` (deep aubergine) | — | Dominant where the final FBM is darkest |
| `ink2` | `Color` | `#1A3380` (ultramarine) | — | Mixed in by the final FBM |
| `ink3` | `Color` | `#661A4D` (plum) | — | Mixed in by the first warp field |
| `ink4` | `Color` | `#004D66` (deep teal) | — | Mixed in by the second warp field |
| `glow` | `Color` | `#4D3366` (violet-grey) | — | Wispy highlight color added where the field peaks |
| `speed` | `Float` | `1.0` | 0…3 | Multiplier on the internal time evolution |
| `scale` | `Float` | `1.8` | 0.2…5 | Spatial scale of the FBM field — higher = finer filaments |
| `warp` | `Float` | `4.0` | 0…10 | Strength of the first-pass domain warp on the second |
| `highlight` | `Float` | `1.0` | 0…3 | Multiplier on the wispy highlight additive layer |
| `showsControls` | `Bool` | `false` | — | Demo-only gear ToolbarItem; requires an enclosing `NavigationStack` |

## Integration Checklist

1. Copy `SWInkSmoke.swift` and `SWInkSmoke.metal` into your Xcode target.
2. Confirm the deployment target is iOS 17+ / macOS 14+.
3. Use it as a `ZStack` background with `.ignoresSafeArea()` for full-bleed.
4. Pick an ink palette that suits your brand mood — defaults are a twilight-purple "ink in water" look; for other moods recolor all five stops (`ink1` … `ink4` + `glow`) together.
5. Keep to one full-screen instance per visible screen — this shader is the heaviest of the noise-field family.

## Notes / Gotchas

- The shader makes 5 FBM evaluations per pixel (`q.x`, `q.y`, `r2.x`, `r2.y`, `f`), each of which is a 5-octave value noise = **25 noise lookups per pixel**. This is heavier than `SWFractalClouds` (2 FBMs = 10 lookups). Keep to one full-screen instance; budget accordingly on lower-end devices.
- `scale` is clamped internally to `>= 0.0001` so zero / negative input is safe.
- The 5-octave FBM loop bound is static so the compiler can fully unroll; do not turn the octave count into a uniform.
- When `showsControls` is `true`, the gear button is a native `ToolbarItem` — the call site must be inside a `NavigationStack`.
