---
id: animation-starfield
title: Starfield
description: Multi-layer twinkling starfield rendered via a SwiftUI Metal stitchable shader, with parallax-scrolling layers, hashed star placement, and a per-star sin-driven twinkle
tier: free
tags: [animation, metal, shader, starfield, background, parallax, SwiftUI]
---

## Overview

Full-screen twinkling starfield rendered through SwiftUI's `colorEffect` Metal pipeline. Each parallax layer is a hashed grid: a per-cell scalar hash decides which cells light up (`h > 1 - density`), a per-cell 2D hash places the star inside the cell, and a sin-driven term twinkles its brightness. Back layers are finer-grained and dimmer, sliding downward faster for a parallax effect.

Requires iOS 17+ / macOS 14+ (uses SwiftUI `ShaderLibrary`, `Shader` / `ShaderFunction`, and Metal `stitchable` color effects).

## File Layout

```
SWAnimation/SWMetal/
  SWStarfield.swift     // SwiftUI view + optional live-tuning sheet
  SWStarfield.metal     // [[ stitchable ]] swStarfield entry point
```

Both files must be added to the Xcode target; the `.metal` file is compiled into the default `ShaderLibrary` automatically.

## Source Code

### SWStarfield.swift

```swift
import SwiftUI

// MARK: - Main View

struct SWStarfield: View {
    /// Color of stars.
    var starColor: Color = .white

    /// Color rendered behind the stars.
    var background: Color = .black

    /// Multiplier applied to the per-layer parallax scroll.
    var speed: Float = 1.0

    /// Number of parallax layers (clamped to 1–8 by the shader).
    var layers: Int = 4

    /// Cell grid resolution of the front layer.
    var baseScale: Float = 60

    /// Cell grid increment per layer behind the front.
    var scaleStep: Float = 30

    /// Fraction of cells that contain a star (0–1).
    var density: Float = 0.3

    /// Star radius in cell-space (0–1).
    var starSize: Float = 0.4

    /// Angular frequency of the per-star twinkle.
    var twinkleSpeed: Float = 3.0

    /// Twinkle amplitude — 0 = steady, 1 = full blink.
    var twinkleAmount: Float = 0.3

    /// When `true`, attaches a gear `ToolbarItem` that opens a live-tuning sheet.
    var showsControls: Bool = false

    var body: some View {
        if showsControls {
            SWStarfieldControlled(initial: self)
        } else {
            SWStarfieldRenderer(
                starColor: starColor,
                background: background,
                speed: speed,
                layers: layers,
                baseScale: baseScale,
                scaleStep: scaleStep,
                density: density,
                starSize: starSize,
                twinkleSpeed: twinkleSpeed,
                twinkleAmount: twinkleAmount
            )
        }
    }
}

// MARK: - Renderer (pure shader binding)

private struct SWStarfieldRenderer: View {
    let starColor: Color
    let background: Color
    let speed: Float
    let layers: Int
    let baseScale: Float
    let scaleStep: Float
    let density: Float
    let starSize: Float
    let twinkleSpeed: Float
    let twinkleAmount: Float

    @State private var start: Date = .now

    var body: some View {
        TimelineView(.animation) { ctx in
            let elapsed = Float(ctx.date.timeIntervalSince(start))
            background
                .colorEffect(
                    ShaderLibrary.swStarfield(
                        .boundingRect,
                        .float(elapsed),
                        .float(speed),
                        .float(Float(layers)),
                        .float(baseScale),
                        .float(scaleStep),
                        .float(density),
                        .float(starSize),
                        .float(twinkleSpeed),
                        .float(twinkleAmount),
                        .color(starColor),
                        .color(background)
                    )
                )
        }
    }
}

// (Optional `SWStarfieldControlled` + `SWStarfieldControlsSheet` provide a
// gear ToolbarItem and a Form-based live-tuning sheet. Omit them in production
// builds; the renderer above is everything you need to ship.)
```

### SWStarfield.metal

```metal
#include <metal_stdlib>
#include <SwiftUI/SwiftUI_Metal.h>
using namespace metal;

// Cheap per-cell scalar hash. Standard "sin(dot) * 43758" trick — not great
// statistically but cheap and visually fine for a starfield.
static float swStarfieldHash1(float2 p) {
    return fract(sin(dot(p, float2(127.1, 311.7))) * 43758.5453);
}

// Two independent hashes packed into a vec2 — used to place the star inside
// the cell. Different magic numbers per channel so x and y aren't correlated.
static float2 swStarfieldHash2(float2 p) {
    float a = fract(sin(dot(p, float2(127.1, 311.7))) * 43758.5453);
    float b = fract(sin(dot(p, float2(269.5, 183.3))) * 43758.5453);
    return float2(a, b);
}

[[ stitchable ]] half4 swStarfield(float2 position,
                                   half4  color,
                                   float4 boundingRect,
                                   float  time,
                                   float  speed,
                                   float  layers,
                                   float  baseScale,
                                   float  scaleStep,
                                   float  density,
                                   float  starSize,
                                   float  twinkleSpeed,
                                   float  twinkleAmount,
                                   half4  starColor,
                                   half4  background) {
    float2 size = boundingRect.zw;
    float2 uv   = position / max(size, float2(1.0));

    // Cap the layer count so the loop bound is bounded for the compiler.
    int   count  = max(1, min(int(layers), 8));
    float thresh = clamp(1.0 - density, 0.0, 1.0);
    float ssz    = max(starSize, 0.001);
    float amt    = clamp(twinkleAmount, 0.0, 1.0);

    float3 starRGB = float3(starColor.rgb);
    float3 col     = float3(0.0);

    for (int layer = 0; layer < count; layer++) {
        float fl    = float(layer);
        float scale = max(baseScale + fl * scaleStep, 1.0);
        float lspd  = (0.03 + fl * 0.02) * speed;
        float bri   = max(0.0, 1.0 - fl * 0.25);

        float2 st   = uv * scale;
        st.y       += time * lspd * scale;
        float2 cell = floor(st);
        float2 f    = fract(st);

        float h = swStarfieldHash1(cell);
        if (h > thresh) {
            float2 center = swStarfieldHash2(cell);
            float  d      = length(f - center);
            // Re-expressed as (mean = 1 - amt, amplitude = amt) so amt=0
            // gives steady stars and amt=0.3 reproduces the original look.
            float twink = sin(time * twinkleSpeed + h * 100.0) * amt + (1.0 - amt);
            // Inverse smoothstep — bright at d=0, fades to 0 at d=ssz. Using
            // (1 - smoothstep) instead of edge-flipped smoothstep so behavior
            // matches the WGSL preview, where edge0 > edge1 is undefined.
            float falloff = 1.0 - smoothstep(0.0, ssz, d);
            col += starRGB * (falloff * twink * bri);
        }
    }

    float3 bg = float3(background.rgb);
    return half4(half3(bg + col), 1.0);
}
```

## Usage

```swift
// Default — white stars on black, full-screen
ZStack {
    SWStarfield()
        .ignoresSafeArea()
    // Your content here
}

// Custom color and denser field
SWStarfield(starColor: .yellow, density: 0.5, layers: 6)

// As a section background
myContent
    .background { SWStarfield() }

// Slower, calmer field for a sleep / focus screen
SWStarfield(speed: 0.4, twinkleAmount: 0.15)
```

## Parameters

| Parameter | Type | Default | Range | Notes |
|---|---|---|---|---|
| `starColor` | `Color` | `.white` | — | Color of stars |
| `background` | `Color` | `.black` | — | Color rendered behind the stars |
| `speed` | `Float` | `1.0` | 0…3 | Multiplier on per-layer parallax scroll |
| `layers` | `Int` | `4` | 1…8 | Number of parallax layers (clamped by shader) |
| `baseScale` | `Float` | `60` | 5…200 | Cell grid resolution of the front layer (higher = smaller, more numerous stars) |
| `scaleStep` | `Float` | `30` | 0…100 | Cell grid increment per layer behind the front |
| `density` | `Float` | `0.3` | 0…1 | Fraction of cells containing a star |
| `starSize` | `Float` | `0.4` | 0.05…2 | Star radius in cell-space |
| `twinkleSpeed` | `Float` | `3.0` | 0…10 | Angular frequency of the per-star twinkle |
| `twinkleAmount` | `Float` | `0.3` | 0…1 | Twinkle amplitude — 0 = steady, 1 = full blink |
| `showsControls` | `Bool` | `false` | — | Demo-only gear ToolbarItem; requires an enclosing `NavigationStack` |

## Integration Checklist

1. Copy `SWStarfield.swift` and `SWStarfield.metal` into your Xcode target (e.g. under `SWAnimation/SWMetal/`).
2. Confirm the deployment target is iOS 17+ / macOS 14+.
3. Use it as a `ZStack` background and apply `.ignoresSafeArea()` if you want full-bleed.
4. Use the parameter defaults first — they are tuned for full-screen on iPhone-class GPUs. Only raise `baseScale` × `layers` after measuring.
5. If you adopt the optional `showsControls` demo flag, the gear button is registered as a native `ToolbarItem` and requires the call site to be inside a `NavigationStack`.

## Notes / Gotchas

- The shader caps `layers` at 8 so the per-pixel loop bound stays static; values above 8 are silently truncated.
- Cost is per-pixel × layers. Defaults are tuned for full-screen on iPhone-class GPUs; raise `baseScale` and `layers` cautiously on lower-end devices.
- The `twinkleAmount` parameter is re-expressed as `mean = 1 - amt, amplitude = amt`, so `amt = 0` gives perfectly steady stars and `amt = 0.3` reproduces the default look.
- The cell-fall-off uses `1 - smoothstep(0, ssz, d)` rather than an edge-flipped smoothstep, so behavior matches the WGSL preview where `edge0 > edge1` is undefined.
