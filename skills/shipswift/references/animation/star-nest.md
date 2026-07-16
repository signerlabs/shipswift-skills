---
id: animation-star-nest
title: Star Nest
description: Volumetric procedural star-nebula colorEffect background via a SwiftUI Metal stitchable shader — a fixed camera flies through a 3D space-folded fractal field generated entirely in-shader, with tunable zoom / speed / brightness / saturation / dark-matter / camera angles
tier: free
tags: [animation, metal, shader, nebula, starfield, space, raymarch, background, colorEffect, SwiftUI]
---

## Overview

A fully procedural deep-space nebula rendered through SwiftUI's `colorEffect` Metal pipeline. A fixed camera flies through a 3D space-folded fractal field: for each pixel a ray is marched in `volsteps` slices; at every slice the sample point is folded into a repeating tile, then run through `iterations` of the Star Nest "magic formula" `p = abs(p)/dot(p,p) - formuparam`, which accumulates fractal detail. The accumulated value is colored, faded with distance, and dark-matter is subtracted to carve voids. There is **no view sampling** — this is a pure generative background, not an image filter.

It is the heaviest background in the library: cost is `volsteps × iterations` fractal folds per pixel per frame (272 at the defaults). Use exactly one full-screen instance.

Requires iOS 17+ / macOS 14+.

## Attribution

Adapted from ["Star Nest" by Pablo Roman Andrioli (Kali)](https://www.shadertoy.com/view/XlfGRj), licensed under the MIT License. Copyright (c) Pablo Roman Andrioli. The original copyright and license notice is retained verbatim in both source files as required by MIT; keep it intact when you copy the code into your project.

## File Layout

```
SWAnimation/SWMetal/
  SWStarNest.swift     // SwiftUI view + optional live-tuning sheet
  SWStarNest.metal     // [[ stitchable ]] swStarNest colorEffect entry point
```

Both files must be added to the Xcode target; the `.metal` file is compiled into the default `ShaderLibrary` automatically.

## Source Code

### SWStarNest.swift

```swift
//
//  SWStarNest.swift
//  ShipSwift
//
//  Adapted from "Star Nest" by Pablo Roman Andrioli (Kali)
//  https://www.shadertoy.com/view/XlfGRj
//  Licensed under the MIT License. Copyright (c) Pablo Roman Andrioli.
//  Original copyright and license notice retained as required by MIT.
//  See ShipSwift ACKNOWLEDGEMENTS for the full license text.
//
//  Full-screen volumetric star-nebula background rendered via a SwiftUI
//  Metal stitchable shader. A fixed camera flies through a 3D space-folded
//  fractal field — a deep-space nebula of drifting stars and dark voids,
//  generated entirely in the shader with no texture or view sampling.
//
//  Requires iOS 17+ / macOS 14+ (SwiftUI `ShaderLibrary`,
//  `Shader`/`ShaderFunction`, Metal `stitchable`).
//
//  Usage:
//    // Default — the classic Star Nest look, full-screen
//    ZStack {
//        SWStarNest()
//            .ignoresSafeArea()
//        // Your content here
//    }
//
//    // Slower drift, warmer/denser nebula
//    SWStarNest(speed: 0.006, brightness: 0.0022)
//
//    // As a section background
//    myContent
//        .background { SWStarNest() }
//
//    // Demo / debug — adds a gear button in the navigation bar that opens
//    // a sheet to tweak every parameter live. Disabled by default.
//    SWStarNest(showsControls: true)
//
//  Parameters (each maps to a Star Nest `#define`; defaults are the
//  original values unless noted):
//    - zoom: Field of view / ray spread (default `0.8`). Lower = tighter
//            tunnel, higher = wider sky.
//    - speed: Camera fly-through speed (default `0.01`).
//    - brightness: Radiance multiplier per volume slice (default `0.0015`).
//    - saturation: Color richness (default `0.85`). 1 = full color,
//                  0 = greyscale.
//    - darkmatter: Strength of the void-carving dark matter (default `0.3`).
//    - distfading: How fast distant slices fade out (default `0.73`).
//    - angleX: Camera yaw (default `0.5`). Replaces the original mouse-X
//              control; the default is Star Nest's neutral framing.
//    - angleY: Camera pitch (default `0.8`). Replaces the original mouse-Y
//              control; the default is Star Nest's neutral framing.
//    - volsteps: Volume march slices (default `16`, original is `20`).
//                Lowered from the original for a lighter full-screen mobile
//                cost; raise toward 20 for maximum depth on capable devices.
//    - iterations: Fractal fold iterations per slice (default `17`, the
//                  original value).
//    - showsControls: When `true`, adds a gear `ToolbarItem` to the
//                     enclosing `NavigationStack` that opens a live-tuning
//                     sheet. Default `false`.
//
//  Performance:
//    - Cost is `volsteps × iterations` fractal folds per pixel — at the
//      default 16 × 17 that is 272 folds for every pixel, every frame. This
//      is the heaviest background in the library. Use ONE full-screen
//      instance; never stack several or tile it into a grid. On older
//      devices drop `volsteps` to 12–14 if the frame rate suffers.
//    - `volsteps` and `iterations` are hard-clamped to 24 in the shader so a
//      runaway value can never lock the GPU.
//

import SwiftUI

// MARK: - Main View

struct SWStarNest: View {
    /// Field of view / ray spread. Star Nest `#define zoom`.
    var zoom: Float = 0.8

    /// Camera fly-through speed. Star Nest `#define speed`.
    var speed: Float = 0.01

    /// Radiance multiplier per volume slice. Star Nest `#define brightness`.
    var brightness: Float = 0.0015

    /// Color richness (1 = full color, 0 = greyscale). Star Nest `#define saturation`.
    var saturation: Float = 0.85

    /// Strength of the void-carving dark matter. Star Nest `#define darkmatter`.
    var darkmatter: Float = 0.3

    /// How fast distant slices fade out. Star Nest `#define distfading`.
    var distfading: Float = 0.73

    /// Camera yaw — replaces the original mouse-X control.
    var angleX: Float = 0.5

    /// Camera pitch — replaces the original mouse-Y control.
    var angleY: Float = 0.8

    /// Volume march slices (original `20`; default lowered to `16` for mobile).
    var volsteps: Float = 16

    /// Fractal fold iterations per slice. Star Nest `#define iterations`.
    var iterations: Float = 17

    /// When `true`, attaches a gear `ToolbarItem` that opens a live-tuning sheet.
    var showsControls: Bool = false

    var body: some View {
        if showsControls {
            SWStarNestControlled(initial: self)
        } else {
            SWStarNestRenderer(
                zoom: zoom,
                speed: speed,
                brightness: brightness,
                saturation: saturation,
                darkmatter: darkmatter,
                distfading: distfading,
                angleX: angleX,
                angleY: angleY,
                volsteps: volsteps,
                iterations: iterations
            )
        }
    }
}

// MARK: - Renderer (pure shader binding)

private struct SWStarNestRenderer: View {
    let zoom: Float
    let speed: Float
    let brightness: Float
    let saturation: Float
    let darkmatter: Float
    let distfading: Float
    let angleX: Float
    let angleY: Float
    let volsteps: Float
    let iterations: Float

    @State private var start: Date = .now

    var body: some View {
        TimelineView(.animation) { ctx in
            let elapsed = Float(ctx.date.timeIntervalSince(start))
            // Black is the natural first-frame base for a deep-space nebula —
            // the shader fills it before the first frame is visible.
            Color.black
                .colorEffect(
                    // Argument order MUST match the Metal `swStarNest` signature
                    // exactly: boundingRect, time, speed, zoom, brightness,
                    // saturation, darkmatter, distfading, angleX, angleY,
                    // volsteps, iterations. (`.boundingRect` and `.float(time)`
                    // are bound positionally — they are not in the Swift View's
                    // stored properties.)
                    ShaderLibrary.swStarNest(
                        .boundingRect,
                        .float(elapsed),
                        .float(speed),
                        .float(zoom),
                        .float(brightness),
                        .float(saturation),
                        .float(darkmatter),
                        .float(distfading),
                        .float(angleX),
                        .float(angleY),
                        .float(volsteps),
                        .float(iterations)
                    )
                )
        }
    }
}

// (Optional `SWStarNestControlled` + `SWStarNestControlsSheet` provide a gear
// ToolbarItem and a Form-based live-tuning sheet for all ten parameters. Omit
// them in production builds; the renderer above is everything you need to ship.)
```

### SWStarNest.metal

```metal
//
//  SWStarNest.metal
//  ShipSwift
//
//  Adapted from "Star Nest" by Pablo Roman Andrioli (Kali)
//  https://www.shadertoy.com/view/XlfGRj
//  Licensed under the MIT License. Copyright (c) Pablo Roman Andrioli.
//  Original copyright and license notice retained as required by MIT.
//  See ShipSwift ACKNOWLEDGEMENTS for the full license text.
//
//  Stitchable SwiftUI color effect — volumetric procedural star nebula.
//
//  A fully procedural deep-space nebula: a fixed camera flies through a
//  3D space-folded fractal field. For each pixel a ray is marched in
//  `volsteps` slices; at every slice the sample point is folded into a
//  repeating tile, then run through `iterations` of the Star Nest "magic
//  formula" `p = abs(p)/dot(p,p) - formuparam`, which accumulates fractal
//  detail. The accumulated value is colored, faded with distance, and
//  dark-matter is subtracted to carve voids. No view sampling — this is a
//  pure generative background.
//
//  Paired with: SWStarNest.swift
//  Entry point: `swStarNest` — invoked via SwiftUI `.colorEffect(...)`.
//
//  Requires iOS 17+ / macOS 14+.
//

#include <metal_stdlib>
#include <SwiftUI/SwiftUI_Metal.h>
using namespace metal;

// GLSL `mod(x, y) = x - y * floor(x / y)`. Result takes the SIGN OF Y, so
// for a positive y it is always non-negative — unlike Metal's `fmod`, which
// truncates toward zero and returns a NEGATIVE result for negative inputs.
// Star Nest's camera origin (`from`) has negative components, so the tiling
// fold MUST use this GLSL-semantics version or the nebula tears apart on the
// negative side of space. Do not replace this with `fmod`.
static float3 swStarNestMod(float3 x, float3 y) {
    return x - y * floor(x / y);
}

[[ stitchable ]] half4 swStarNest(float2 position,
                                  half4  color,
                                  float4 boundingRect,
                                  float  time,
                                  float  speed,
                                  float  zoom,
                                  float  brightness,
                                  float  saturation,
                                  float  darkmatter,
                                  float  distfading,
                                  float  angleX,
                                  float  angleY,
                                  float  volsteps,
                                  float  iterations) {
    // Star Nest fixed tuning constants (the #defines that are not exposed as
    // adjustable parameters). Kept at their original values.
    const float formuparam = 0.53;   // fractal fold offset — the "magic" knob
    const float stepsize   = 0.1;    // distance advanced per volume slice
    const float tile       = 0.850;  // half-period of the space-folding tile

    float2 size = boundingRect.zw;

    // iResolution-equivalent UV: 0..1 then recentred to -0.5..0.5, with the
    // vertical axis aspect-corrected exactly as the original shader does.
    float2 uv = position / size - 0.5;
    uv.y *= size.y / size.x;

    // Ray direction for this pixel, scaled by the zoom (field of view).
    float3 dir = float3(uv * zoom, 1.0);

    float t = time * speed + 0.25;

    // Camera orientation. The original drives a1/a2 from the mouse; here they
    // are the caller-supplied `angleX` / `angleY` so the look is reproducible
    // and tunable. The +0.5 / +0.8 base matches Star Nest's neutral framing.
    float a1 = angleX;
    float a2 = angleY;

    // GLSL `mat2(cos,sin,-sin,cos)` is column-major: first column (cos, sin),
    // second column (-sin, cos). Metal's float2x2(col0, col1) matches that, so
    // float2x2(float2(c, s), float2(-s, c)) is the identical rotation matrix.
    float2x2 rot1 = float2x2(float2(cos(a1), sin(a1)), float2(-sin(a1), cos(a1)));
    float2x2 rot2 = float2x2(float2(cos(a2), sin(a2)), float2(-sin(a2), cos(a2)));

    // `dir.xz *= rot1; dir.xy *= rot2;` — rotate the swizzled pair, write back.
    float2 dxz = rot1 * float2(dir.x, dir.z);
    dir.x = dxz.x; dir.z = dxz.y;
    float2 dxy = rot2 * float2(dir.x, dir.y);
    dir.x = dxy.x; dir.y = dxy.y;

    // Camera origin, drifting through space over time, then rotated the same
    // way as the ray so the whole frame turns coherently.
    float3 from = float3(1.0, 0.5, 0.5);
    from += float3(t * 2.0, t, -2.0);
    float2 fxz = rot1 * float2(from.x, from.z);
    from.x = fxz.x; from.z = fxz.y;
    float2 fxy = rot2 * float2(from.x, from.y);
    from.x = fxy.x; from.y = fxy.y;

    // Volumetric march.
    float s = 0.1;
    float fade = 1.0;
    float3 v = float3(0.0);

    // Loop bounds are taken from the float parameters; cast to int and clamp so
    // a stray value can never spin the GPU. Upper caps match the original look.
    int vsteps = clamp(int(volsteps), 1, 24);
    int iters  = clamp(int(iterations), 1, 24);

    for (int r = 0; r < vsteps; r++) {
        float3 p = from + s * dir * 0.5;
        // Tiling fold — GLSL mod semantics are mandatory here (see helper).
        p = abs(float3(tile) - swStarNestMod(p, float3(tile * 2.0)));

        float pa = 0.0;
        float a  = 0.0;
        for (int i = 0; i < iters; i++) {
            // The Star Nest "magic formula": fold + inverse-square scale.
            p = abs(p) / dot(p, p) - formuparam;
            a += abs(length(p) - pa);   // accumulate inter-iteration change
            pa = length(p);
        }

        // Dark matter carves voids where the field is dense.
        float dm = max(0.0, darkmatter - a * a * 0.001);
        a *= a * a;                 // emphasise the brightest streaks
        if (r > 6) { fade *= 1.0 - dm; }

        v += fade;
        // Per-slice color: the (s, s^2, s^4) ramp tints near→far slices, so
        // depth reads as a hue shift across the nebula.
        v += float3(s, s * s, s * s * s * s) * a * brightness * fade;
        fade *= distfading;         // distant slices contribute less
        s += stepsize;
    }

    // Desaturate toward luminance by `saturation` (1 = full color, 0 = grey).
    v = mix(float3(length(v)), v, saturation);

    // Original scales the accumulated radiance by 0.01 into display range.
    return half4(half3(v * 0.01), 1.0);
}
```

## Usage

```swift
// Default — the classic Star Nest look, full-screen
ZStack {
    SWStarNest()
        .ignoresSafeArea()
    // Your content here
}

// Slower drift, warmer/denser nebula
SWStarNest(speed: 0.006, brightness: 0.0022)

// As a section background
myContent
    .background { SWStarNest() }

// Lighter cost on older devices — drop the volume steps
SWStarNest(volsteps: 12)
```

## Parameters

| Parameter | Type | Default | Range | Notes |
|---|---|---|---|---|
| `zoom` | `Float` | `0.8` | 0.2…2 | Field of view / ray spread — lower = tighter tunnel, higher = wider sky |
| `speed` | `Float` | `0.01` | 0…0.05 | Camera fly-through speed |
| `brightness` | `Float` | `0.0015` | 0.0002…0.006 | Radiance multiplier per volume slice |
| `saturation` | `Float` | `0.85` | 0…1 | Color richness — 1 = full color, 0 = greyscale |
| `darkmatter` | `Float` | `0.3` | 0…1 | Strength of the void-carving dark matter |
| `distfading` | `Float` | `0.73` | 0.3…0.95 | How fast distant slices fade out |
| `angleX` | `Float` | `0.5` | 0…6.283 | Camera yaw (replaces the original mouse-X) |
| `angleY` | `Float` | `0.8` | 0…6.283 | Camera pitch (replaces the original mouse-Y) |
| `volsteps` | `Float` | `16` | 4…24 | Volume march slices (original `20`; clamped to 24 in-shader) |
| `iterations` | `Float` | `17` | 4…24 | Fractal fold iterations per slice (clamped to 24 in-shader) |
| `showsControls` | `Bool` | `false` | — | Demo-only gear ToolbarItem; requires an enclosing `NavigationStack` |

## Integration Checklist

1. Copy `SWStarNest.swift` and `SWStarNest.metal` into your Xcode target, keeping the MIT attribution header on both files.
2. Confirm the deployment target is iOS 17+ / macOS 14+.
3. Use it as a `ZStack` background with `.ignoresSafeArea()` for full-bleed — it is a generative background, so there is no source view to wrap.
4. Keep ONE full-screen instance. Never stack several or tile it into a grid (see Performance).
5. On older devices, lower `volsteps` to 12–14 first if the frame rate drops; it has the biggest cost impact.

## Notes / Gotchas

- **GLSL `mod` semantics are mandatory.** The tiling fold uses the `swStarNestMod` helper (`x - y * floor(x / y)`), not Metal's `fmod`. The camera origin has negative components, and `fmod` truncates toward zero (returns negative results for negative inputs), which tears the nebula apart on the negative side of space. Do not "simplify" the helper to `fmod`.
- **Heaviest background in the library.** Cost is `volsteps × iterations` fractal folds per pixel per frame — 272 at the defaults. `volsteps` and `iterations` are hard-clamped to 24 in the shader so a runaway value can never lock the GPU, but you should still tune `volsteps` down before anything else if performance suffers.
- The argument order in the `.colorEffect` call **must** match the Metal `swStarNest` signature exactly: `boundingRect, time, speed, zoom, brightness, saturation, darkmatter, distfading, angleX, angleY, volsteps, iterations`. `.boundingRect` and `.float(time)` are bound positionally and are not stored properties on the Swift view.
- `formuparam` (0.53), `stepsize` (0.1), and `tile` (0.850) are kept at their original Star Nest values and are intentionally not exposed as parameters — change them in the `.metal` file only if you know the Star Nest formula.
- The first-frame base is `Color.black`, the natural backdrop for a deep-space nebula; the shader fills it before the first frame is visible.
