---
id: animation-fractal-clouds
title: Fractal Clouds
description: Drifting fractal cumulus clouds rendered via a SwiftUI Metal stitchable shader, using two-pass 5-octave FBM with domain warping for soft cumulus-like swirls
tier: free
tags: [animation, metal, shader, clouds, background, fbm, SwiftUI]
---

## Overview

Full-screen drifting fractal clouds rendered through SwiftUI's `colorEffect` Metal pipeline. Two-pass FBM (5-octave value noise): the first pass perturbs the sample position for the second, producing soft cumulus-like swirls. Sky and cloud colors are mixed by the warped FBM, with an optional warm tint layered on top of the unwarped pass for ambient lift.

Requires iOS 17+ / macOS 14+.

## File Layout

```
SWAnimation/SWMetal/
  SWFractalClouds.swift     // SwiftUI view + optional live-tuning sheet
  SWFractalClouds.metal     // [[ stitchable ]] swFractalClouds entry point
```

## Source Code

### SWFractalClouds.swift

```swift
import SwiftUI

// MARK: - Main View

struct SWFractalClouds: View {
    /// Sky color behind the clouds.
    var skyColor: Color = Color(red: 0.102, green: 0.149, blue: 0.349)   // #1A2659

    /// Cloud body color.
    var cloudColor: Color = Color(red: 0.902, green: 0.902, blue: 1.0)   // #E6E6FF

    /// Warm tint added on top of the unwarped FBM for ambient lift.
    var warmTint: Color = Color(red: 0.102, green: 0.051, blue: 0.0)     // #1A0D00

    /// Multiplier applied to the warm tint additive layer.
    var warmth: Float = 0.5

    /// Time multiplier driving drift and warp evolution.
    var speed: Float = 1.0

    /// FBM sampling scale — higher = larger features.
    var zoom: Float = 3.0

    /// Horizontal drift velocity.
    var driftX: Float = 0.08

    /// Vertical drift velocity.
    var driftY: Float = 0.04

    /// Strength of the first FBM warping the second's sample position.
    var warp: Float = 2.0

    /// Added to the warped FBM before clamping — positive widens coverage.
    var coverage: Float = 0.0

    /// When `true`, attaches a gear `ToolbarItem` that opens a live-tuning sheet.
    var showsControls: Bool = false

    var body: some View {
        if showsControls {
            SWFractalCloudsControlled(initial: self)
        } else {
            SWFractalCloudsRenderer(
                skyColor: skyColor,
                cloudColor: cloudColor,
                warmTint: warmTint,
                warmth: warmth,
                speed: speed,
                zoom: zoom,
                driftX: driftX,
                driftY: driftY,
                warp: warp,
                coverage: coverage
            )
        }
    }
}

// MARK: - Renderer (pure shader binding)

private struct SWFractalCloudsRenderer: View {
    let skyColor: Color
    let cloudColor: Color
    let warmTint: Color
    let warmth: Float
    let speed: Float
    let zoom: Float
    let driftX: Float
    let driftY: Float
    let warp: Float
    let coverage: Float

    @State private var start: Date = .now

    var body: some View {
        TimelineView(.animation) { ctx in
            let elapsed = Float(ctx.date.timeIntervalSince(start))
            // The base layer is the cloud color — the shader fully overwrites
            // every pixel, so the choice is cosmetic, but using cloudColor
            // gives a sensible look during the first frame before TimelineView
            // ticks in.
            cloudColor
                .colorEffect(
                    ShaderLibrary.swFractalClouds(
                        .boundingRect,
                        .float(elapsed),
                        .float(speed),
                        .float(zoom),
                        .float(driftX),
                        .float(driftY),
                        .float(warp),
                        .float(coverage),
                        .color(skyColor),
                        .color(cloudColor),
                        .color(warmTint),
                        .float(warmth)
                    )
                )
        }
    }
}

// (Optional `SWFractalCloudsControlled` + `SWFractalCloudsControlsSheet`
// provide a gear ToolbarItem and a Form-based live-tuning sheet. Omit them
// in production builds.)
```

### SWFractalClouds.metal

```metal
#include <metal_stdlib>
#include <SwiftUI/SwiftUI_Metal.h>
using namespace metal;

static float swFractalCloudsHash(float2 p) {
    p = fract(p * float2(123.34, 345.45));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
}

static float swFractalCloudsNoise(float2 p) {
    float2 i = floor(p);
    float2 f = fract(p);
    float2 u = f * f * (3.0 - 2.0 * f);
    float a = swFractalCloudsHash(i);
    float b = swFractalCloudsHash(i + float2(1.0, 0.0));
    float c = swFractalCloudsHash(i + float2(0.0, 1.0));
    float d = swFractalCloudsHash(i + float2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// 5-octave fractional Brownian motion. Loop bound is static so the compiler
// can fully unroll; do not turn the octave count into a uniform.
static float swFractalCloudsFBM(float2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
        v += a * swFractalCloudsNoise(p);
        p *= 2.0;
        a *= 0.5;
    }
    return v;
}

[[ stitchable ]] half4 swFractalClouds(float2 position,
                                       half4  color,
                                       float4 boundingRect,
                                       float  time,
                                       float  speed,
                                       float  zoom,
                                       float  driftX,
                                       float  driftY,
                                       float  warp,
                                       float  coverage,
                                       half4  skyColor,
                                       half4  cloudColor,
                                       half4  warmTint,
                                       float  warmth) {
    float2 size = boundingRect.zw;
    float2 uv   = position / size;

    float t = time * speed;

    uv *= max(zoom, 0.0001);
    uv += float2(t * driftX, t * driftY);

    float f1 = swFractalCloudsFBM(uv);
    float f2 = swFractalCloudsFBM(uv + f1 * warp + float2(t * 0.02, t * 0.03));

    float3 sky   = float3(skyColor.rgb);
    float3 cloud = float3(cloudColor.rgb);
    float3 tint  = float3(warmTint.rgb);

    float3 col = mix(sky, cloud, clamp(f2 + coverage, 0.0, 1.0));
    col += tint * f1 * warmth;

    return half4(half3(col), 1.0);
}
```

## Usage

```swift
// Default — twilight cumulus, full-screen
ZStack {
    SWFractalClouds()
        .ignoresSafeArea()
    // Your content here
}

// Recolor — daylight sky
SWFractalClouds(
    skyColor: .blue.opacity(0.5),
    cloudColor: .white,
    warmth: 0.0
)

// As a section background
myContent
    .background { SWFractalClouds() }

// Heavier coverage, slower drift
SWFractalClouds(speed: 0.5, coverage: 0.2)
```

## Parameters

| Parameter | Type | Default | Range | Notes |
|---|---|---|---|---|
| `skyColor` | `Color` | `#1A2659` (deep twilight blue) | — | Color of the open sky behind clouds |
| `cloudColor` | `Color` | `#E6E6FF` (soft lilac white) | — | Color of the cloud body |
| `warmTint` | `Color` | `#1A0D00` (deep amber) | — | Color added on top of the unwarped FBM for ambient lift |
| `warmth` | `Float` | `0.5` | 0…2 | Multiplier on the warm tint additive layer |
| `speed` | `Float` | `1.0` | 0…3 | Time multiplier driving drift and warp evolution |
| `zoom` | `Float` | `3.0` | 0.5…10 | FBM sampling scale — higher = larger features |
| `driftX` | `Float` | `0.08` | -0.5…0.5 | Horizontal drift velocity |
| `driftY` | `Float` | `0.04` | -0.5…0.5 | Vertical drift velocity |
| `warp` | `Float` | `2.0` | 0…5 | Strength of the first FBM warping the second's sample position; `0` = pure FBM |
| `coverage` | `Float` | `0.0` | -1…1 | Added to warped FBM before clamping — positive widens coverage, negative opens the sky |
| `showsControls` | `Bool` | `false` | — | Demo-only gear ToolbarItem; requires an enclosing `NavigationStack` |

## Integration Checklist

1. Copy `SWFractalClouds.swift` and `SWFractalClouds.metal` into your Xcode target.
2. Confirm the deployment target is iOS 17+ / macOS 14+.
3. Use it as a `ZStack` background with `.ignoresSafeArea()` for full-bleed.
4. Pick a sky / cloud / warm tint palette that matches your brand — defaults are a twilight palette; for daylight set `warmth: 0` and pick a brighter sky/cloud pair.
5. Keep to one full-screen instance per visible screen.

## Notes / Gotchas

- The shader runs two 5-octave FBM evaluations per pixel — cost is higher than the `SWDots` family. Keep to one full-screen instance.
- `zoom` is clamped internally to `>= 0.0001` to avoid division-style blowups in the noise lookup; setting it to `0` still renders cleanly.
- The 5-octave FBM loop bound is static so the compiler can fully unroll it. Do not turn the octave count into a uniform.
- When `showsControls` is `true`, the gear button is a native `ToolbarItem` — the call site must be inside a `NavigationStack`.
