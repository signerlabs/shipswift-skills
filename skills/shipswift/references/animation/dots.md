---
id: animation-dots
title: Dots
description: Family of perspective dot-grid backgrounds with seven styles (wavy / mountains / ocean / standing — 3D ground plane; flow / plasma / snake — flat grid). One enum, one 11-parameter knob set across all variants
tier: free
tags: [animation, metal, shader, dots, grid, background, perspective, SwiftUI]
---

## Overview

Family of perspective dot-grid backgrounds rendered through SwiftUI's `colorEffect` Metal pipeline. Switch between visual styles (wavy / mountains / ocean / standing / flow / plasma / snake) with a single enum and reuse the same 11-parameter knob set across all variants. Each style is implemented in its own `.metal` file exporting a stitchable function named `swDots<Style>` (e.g. `swDotsWavy`, `swDotsMountains`).

- **3D styles** (`wavy`, `mountains`, `ocean`, `standing`) sit dots on a wave-displaced ground plane below a configurable horizon line; they consume the `horizon`, `amplitude`, and `depthFade` parameters.
- **Flat-grid styles** (`flow`, `plasma`, `snake`) tile dots across the screen without perspective; the `horizon` / `amplitude` / `depthFade` parameters are accepted (so the shader signature is unified) but ignored.

Requires iOS 17+ / macOS 14+.

## File Layout

```
SWAnimation/SWMetal/
  SWDots.swift              // SwiftUI view + SWDotsStyle enum (7 styles)
  SWDotsWavy.metal          // 3D — sinusoid sum on ground plane
  SWDotsMountains.metal     // 3D — sharp ridges via abs/pow fold
  SWDotsOcean.metal         // 3D — long-wavelength rolling swells + water tint
  SWDotsStanding.metal      // 3D — standing-wave interference pattern
  SWDotsFlow.metal          // Flat — curl-like flow field
  SWDotsPlasma.metal        // Flat — sin-stack plasma intensity
  SWDotsSnake.metal         // Flat — flow-angle phase wavefronts
```

To add a new style: drop `SWDots<Style>.metal` next to the others, add a case to `SWDotsStyle`, and map the case to its shader name in `shaderName`.

## Source Code

### SWDots.swift

```swift
import SwiftUI

// MARK: - Style

enum SWDotsStyle: String, CaseIterable, Identifiable {
    // 3D perspective styles — dots sit on a wave-displaced ground plane.
    case wavy
    case mountains
    case ocean
    case standing

    // Flat-grid styles — dots tile the screen without perspective.
    case flow
    case plasma
    case snake

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .wavy:      "Wavy"
        case .mountains: "Mountains"
        case .ocean:     "Ocean"
        case .standing:  "Standing"
        case .flow:      "Flow"
        case .plasma:    "Plasma"
        case .snake:     "Snake"
        }
    }

    /// Metal `stitchable` function name in the default `ShaderLibrary`.
    var shaderName: String {
        switch self {
        case .wavy:      "swDotsWavy"
        case .mountains: "swDotsMountains"
        case .ocean:     "swDotsOcean"
        case .standing:  "swDotsStanding"
        case .flow:      "swDotsFlow"
        case .plasma:    "swDotsPlasma"
        case .snake:     "swDotsSnake"
        }
    }

    /// Whether this style projects dots in 3D perspective onto a ground
    /// plane. 3D styles consume the `horizon`, `amplitude`, and `depthFade`
    /// parameters; flat-grid styles ignore them (the shader signature still
    /// accepts them for a unified call site, but the values do nothing).
    var is3D: Bool {
        switch self {
        case .wavy, .mountains, .ocean, .standing: true
        case .flow, .plasma, .snake:               false
        }
    }
}

// MARK: - Main View

struct SWDots: View {
    /// Which dot-field style to render.
    var style: SWDotsStyle = .wavy

    /// Color of dots and their halos.
    var tint: Color = .white

    /// Color rendered below the horizon and behind the dots.
    var background: Color = .black

    /// Time multiplier driving wave motion.
    var speed: Float = 1.0

    /// Multiplier applied to the tint color before mixing.
    var brightness: Float = 1.0

    /// Per-dot pixel radius multiplier.
    var dotSize: Float = 1.0

    /// Grid density multiplier.
    var gridDensity: Float = 1.0

    /// Spatial frequency multiplier for the wave pattern.
    var patternScale: Float = 1.0

    /// Wave height multiplier.
    var amplitude: Float = 1.0

    /// Strength of the per-dot depth attenuation.
    var depthFade: Float = 1.0

    /// Strength of the screen-edge vignette darkening.
    var vignette: Float = 1.0

    /// Vertical horizon position in screen-aspect units.
    var horizon: Float = -0.45

    /// When `true`, overlays a gear button that opens a live-tuning sheet.
    var showsControls: Bool = false

    var body: some View {
        if showsControls {
            SWDotsControlled(initial: self)
        } else {
            SWDotsRenderer(
                style: style,
                tint: tint,
                background: background,
                speed: speed,
                brightness: brightness,
                dotSize: dotSize,
                gridDensity: gridDensity,
                patternScale: patternScale,
                amplitude: amplitude,
                depthFade: depthFade,
                vignette: vignette,
                horizon: horizon
            )
        }
    }
}

// MARK: - Renderer (pure shader binding)

private struct SWDotsRenderer: View {
    let style: SWDotsStyle
    let tint: Color
    let background: Color
    let speed: Float
    let brightness: Float
    let dotSize: Float
    let gridDensity: Float
    let patternScale: Float
    let amplitude: Float
    let depthFade: Float
    let vignette: Float
    let horizon: Float

    @State private var start: Date = .now

    var body: some View {
        TimelineView(.animation) { ctx in
            let elapsed = Float(ctx.date.timeIntervalSince(start))
            background
                .colorEffect(
                    Shader(
                        function: ShaderFunction(library: .default, name: style.shaderName),
                        arguments: [
                            .boundingRect,
                            .float(elapsed),
                            .float(speed),
                            .float(brightness),
                            .color(tint),
                            .color(background),
                            .float(dotSize),
                            .float(gridDensity),
                            .float(patternScale),
                            .float(vignette),
                            .float(horizon),
                            .float(amplitude),
                            .float(depthFade)
                        ]
                    )
                )
        }
    }
}

// (Optional `SWDotsControlled` + `SWDotsControlsSheet` provide a gear
// ToolbarItem and a Form-based live-tuning sheet. The sheet hides
// amplitude / depthFade / horizon when style is flat. Omit them in
// production builds.)
```

### SWDotsWavy.metal (3D style)

```metal
#include <metal_stdlib>
#include <SwiftUI/SwiftUI_Metal.h>
using namespace metal;

static float swDotsWavyHeight(float x, float z, float t,
                              float amplitude, float patternScale) {
    float base = (sin(x * 3.6 * patternScale + t * 0.85) * 0.45 +
                  sin(z * 2.2 * patternScale + t * 0.65) * 0.40 +
                  sin((x * 1.9 + z * 2.0) * patternScale + t * 1.10) * 0.30 +
                  sin((x * 2.8 - z * 1.3) * patternScale + t * 0.45) * 0.22) * 0.16;
    float damp = 1.0 - smoothstep(3.5, 9.0, z) * 0.85;
    return base * damp * amplitude;
}

[[ stitchable ]] half4 swDotsWavy(float2 position,
                                  half4  color,
                                  float4 boundingRect,
                                  float  time,
                                  float  speed,
                                  float  brightness,
                                  half4  tint,
                                  half4  background,
                                  float  dotSize,
                                  float  gridDensity,
                                  float  patternScale,
                                  float  vignette,
                                  float  horizon,
                                  float  amplitude,
                                  float  depthFade) {
    float2 size = boundingRect.zw;
    float2 uv   = (position - 0.5 * size) / size.y;
    float  t    = time * speed;

    float yFromHorizon = uv.y - horizon;
    if (yFromHorizon < 0.002) {
        return half4(half3(background.rgb), 1.0h);
    }

    float gridSize = 0.034 / max(gridDensity, 0.01);
    const float cellZmax = 9.1;
    float jMaxAbsolute = cellZmax / gridSize;

    // `dampEst` must be evaluated at the smallest possible cell Z in the
    // candidate range (cells lifted most by the wave), not at Z0 = 1/yFromHorizon.
    // `damp` decreases with Z, so damp(Zmin) is the upper bound on actual damp.
    // The old formula used Z0 * 0.85 as a fudge factor — that only covered
    // amplitudes up to ~0.68, so at amplitude=2 the bound was too tight and
    // crest cells fell outside [Zlo, Zhi], showing as an empty hole at the peak.
    float yampMax   = 0.22 * amplitude;
    float Zmin      = max(0.05, (1.0 - yampMax) / yFromHorizon);
    float dampEst   = 1.0 - smoothstep(3.5, 9.0, Zmin) * 0.85;
    float yampBound = max(0.22 * dampEst * amplitude, 0.03);
    float Zlo = max(0.05, (1.0 - yampBound) / yFromHorizon);
    float Zhi = (1.0 + yampBound) / yFromHorizon;
    int jMin = max(1, int(floor(Zlo / gridSize)));
    int jMax = min(int(jMaxAbsolute), int(ceil(Zhi / gridSize)));

    half3 accum = half3(0.0);
    float halfSizeX = 0.5 * size.x;
    float halfSizeY = 0.5 * size.y;
    for (int j = jMin; j <= jMax; j++) {
        float jf    = float(j);
        float cellZ = jf * gridSize;

        float rawR             = 4.4 / (1.0 + cellZ * 1.10);
        float pxR              = max(rawR, 0.85) * dotSize;
        float horizCullThresh  = pxR * 4.0 + 2.0;
        float baseHaloScale    = max(pxR * 1.7, 1.2);
        float subPxFade        = smoothstep(0.4, 1.0, rawR);
        float depth            = 1.0 / (1.0 + cellZ * 0.35 * depthFade);

        float iCenter         = round(uv.x * jf);
        float invCellZ        = 1.0 / cellZ;
        float pitchScreenX    = gridSize * invCellZ * size.y;
        // At high amplitude crests live at small cellZ where the X-pitch
        // grows past the halo's reach, so consecutive crest dots are
        // separated by black gaps that read as a "hole at the top of the
        // wave". Stretch the halo to span the pitch so the ridge stays
        // continuous. The max() keeps the halo unchanged for farther cells
        // where pitch is already smaller than the natural halo.
        float haloScale       = max(baseHaloScale, pitchScreenX * 0.5);
        float iCenterScreenX  = iCenter * pitchScreenX + halfSizeX;
        float iCenterCellX    = iCenter * gridSize;

        for (int di = -1; di <= 1; di++) {
            float dotScreenX = iCenterScreenX + float(di) * pitchScreenX;
            if (abs(position.x - dotScreenX) > horizCullThresh) continue;

            float cellX = iCenterCellX + float(di) * gridSize;
            float Y     = swDotsWavyHeight(cellX, cellZ, t, amplitude, patternScale);

            float dotYFromHorizon = (1.0 - Y) * invCellZ;
            if (dotYFromHorizon < 0.01) continue;
            float dotScreenY = (horizon + dotYFromHorizon) * size.y + halfSizeY;
            if (abs(position.y - dotScreenY) > horizCullThresh) continue;

            float horizonFade = smoothstep(0.0, 0.05, dotYFromHorizon);
            float distPx      = length(position - float2(dotScreenX, dotScreenY));
            float mask        = smoothstep(pxR + 1.0, pxR - 1.0, distPx);
            float halo        = exp(-distPx / haloScale) * 0.25;
            float crest       = clamp(Y / (0.22 * max(amplitude, 0.01)) * 0.5 + 0.5, 0.0, 1.0);
            float highlight   = 0.55 + 0.85 * crest;
            float intensity   = (mask + halo) * depth * highlight * horizonFade * subPxFade;
            accum = max(accum, half3(intensity));
        }
    }
    accum *= 1.25;
    accum  = min(accum, half3(1.0));

    float2 vUV    = (position - 0.5 * size) / size;
    float  vig    = clamp(1.0 - dot(vUV, vUV) * 0.6 * vignette, 0.0, 1.0);
    accum *= half(vig);

    float3 fg  = float3(tint.rgb) * brightness;
    float3 bg  = float3(background.rgb);
    float3 col = mix(bg, fg, float3(accum));
    return half4(half3(col), 1.0h);
}
```

### SWDotsMountains.metal (3D style)

```metal
#include <metal_stdlib>
#include <SwiftUI/SwiftUI_Metal.h>
using namespace metal;

static float swDotsMountainsHeight(float x, float z, float t,
                                   float amplitude, float patternScale) {
    float h = sin(x * 1.0 * patternScale + t * 0.20) * 0.50 +
              sin(z * 0.8 * patternScale + t * 0.15) * 0.50 +
              sin((x * 2.3 + z * 1.7) * patternScale + t * 0.30) * 0.30 +
              sin((x * 4.7 - z * 3.1) * patternScale + t * 0.40) * 0.18 +
              sin((x * 9.0 + z * 7.0) * patternScale + t * 0.55) * 0.10;
    h = 1.0 - abs(h * 0.5);
    h = pow(max(h, 0.0), 2.5) - 0.4;
    h *= 0.16;
    float damp = 1.0 - smoothstep(4.0, 10.0, z) * 0.85;
    return h * damp * amplitude;
}

[[ stitchable ]] half4 swDotsMountains(float2 position,
                                       half4  color,
                                       float4 boundingRect,
                                       float  time,
                                       float  speed,
                                       float  brightness,
                                       half4  tint,
                                       half4  background,
                                       float  dotSize,
                                       float  gridDensity,
                                       float  patternScale,
                                       float  vignette,
                                       float  horizon,
                                       float  amplitude,
                                       float  depthFade) {
    float2 size = boundingRect.zw;
    float2 uv   = (position - 0.5 * size) / size.y;
    float  t    = time * speed;

    float yFromHorizon = uv.y - horizon;
    if (yFromHorizon < 0.002) {
        return half4(half3(background.rgb), 1.0h);
    }

    // Wave-aware Z sweep — see SWDotsWavy.metal for the derivation.
    // `yampBound` here is the peak |Y| the mountain height function can
    // produce (~0.12 at amplitude=1). Replaces a fixed ±dj window that
    // dropped cells (black holes) once gridDensity or amplitude grew past
    // the hardcoded radius.
    float gridSize = 0.034 / max(gridDensity, 0.01);
    const float cellZmax = 9.1;
    float jMaxAbsolute = cellZmax / gridSize;

    float Z0        = 1.0 / yFromHorizon;
    float dampEst   = 1.0 - smoothstep(3.5, 9.0, Z0 * 0.85) * 0.85;
    float yampBound = max(0.12 * dampEst * amplitude, 0.03);
    float Zlo = max(0.05, (1.0 - yampBound) / yFromHorizon);
    float Zhi = (1.0 + yampBound) / yFromHorizon;
    int jMin = max(1, int(floor(Zlo / gridSize)));
    int jMax = min(int(jMaxAbsolute), int(ceil(Zhi / gridSize)));

    half3 accum = half3(0.0);
    float halfSizeX = 0.5 * size.x;
    float halfSizeY = 0.5 * size.y;
    for (int j = jMin; j <= jMax; j++) {
        float jf    = float(j);
        float cellZ = jf * gridSize;

        float rawR             = 4.4 / (1.0 + cellZ * 1.10);
        float pxR              = max(rawR, 0.85) * dotSize;
        float horizCullThresh  = pxR * 4.0 + 2.0;
        float haloScale        = max(pxR * 1.7, 1.2);
        float subPxFade        = smoothstep(0.4, 1.0, rawR);
        float depth            = 1.0 / (1.0 + cellZ * 0.32 * depthFade);
        float invCellZ         = 1.0 / cellZ;
        float pitchScreenX     = gridSize * invCellZ * size.y;
        float iCenter          = round(uv.x * jf);
        float iCenterScreenX   = iCenter * pitchScreenX + halfSizeX;
        float iCenterCellX     = iCenter * gridSize;

        for (int di = -1; di <= 1; di++) {
            float dotScreenX = iCenterScreenX + float(di) * pitchScreenX;
            if (abs(position.x - dotScreenX) > horizCullThresh) continue;

            float cellX = iCenterCellX + float(di) * gridSize;
            float Y     = swDotsMountainsHeight(cellX, cellZ, t, amplitude, patternScale);
            float dotYFromH = (1.0 - Y) * invCellZ;
            if (dotYFromH < 0.01) continue;
            float dotScreenY = (horizon + dotYFromH) * size.y + halfSizeY;

            float horizonFade = smoothstep(0.0, 0.05, dotYFromH);
            float d           = length(position - float2(dotScreenX, dotScreenY));
            float mask        = smoothstep(pxR + 1.0, pxR - 1.0, d);
            float halo        = exp(-d / haloScale) * 0.25;
            float crest       = clamp(Y / (0.16 * max(amplitude, 0.01)) * 0.5 + 0.5, 0.0, 1.0);
            float ridge       = pow(crest, 3.0);
            float highlight   = 0.35 + 0.55 * crest + 0.6 * ridge;
            float intensity   = (mask + halo) * depth * highlight * horizonFade * subPxFade;
            accum = max(accum, half3(intensity));
        }
    }
    accum = min(accum * 1.15, half3(1.0));

    float2 vUV  = (position - 0.5 * size) / size;
    float  vig  = clamp(1.0 - dot(vUV, vUV) * 0.5 * vignette, 0.0, 1.0);
    accum *= half(vig);

    float3 fg  = float3(tint.rgb) * brightness;
    float3 bg  = float3(background.rgb);
    float3 col = mix(bg, fg, float3(accum));
    return half4(half3(col), 1.0h);
}
```

### SWDotsOcean.metal (3D style)

```metal
#include <metal_stdlib>
#include <SwiftUI/SwiftUI_Metal.h>
using namespace metal;

static float swDotsOceanHeight(float x, float z, float t,
                               float amplitude, float patternScale) {
    float base = sin(x * 1.2 * patternScale + t * 0.55) * 0.55 +
                 sin(z * 0.9 * patternScale + t * 0.45) * 0.50 +
                 sin((x * 0.5 + z * 0.7) * patternScale + t * 0.70) * 0.40 +
                 sin((x * 1.5 - z * 0.6) * patternScale + t * 0.35) * 0.20;
    base *= 0.20;
    float damp = 1.0 - smoothstep(3.5, 9.0, z) * 0.85;
    return base * damp * amplitude;
}

[[ stitchable ]] half4 swDotsOcean(float2 position,
                                   half4  color,
                                   float4 boundingRect,
                                   float  time,
                                   float  speed,
                                   float  brightness,
                                   half4  tint,
                                   half4  background,
                                   float  dotSize,
                                   float  gridDensity,
                                   float  patternScale,
                                   float  vignette,
                                   float  horizon,
                                   float  amplitude,
                                   float  depthFade) {
    float2 size = boundingRect.zw;
    float2 uv   = (position - 0.5 * size) / size.y;
    float  t    = time * speed;

    float yFromHorizon = uv.y - horizon;
    if (yFromHorizon < 0.002) {
        return half4(half3(background.rgb), 1.0h);
    }

    // Wave-aware Z sweep: a cell at depth Z with displacement Y projects to
    // screen-Y = (1 - Y) / Z, so for the current pixel the contributing cells
    // span Z in [(1 - yampBound), (1 + yampBound)] / yFromHorizon. yampBound
    // tracks the peak |Y| at the current amplitude (0.33 = ocean's worst-case
    // displacement at amplitude=1). Replaces a fixed ±dj window that dropped
    // cells (black holes) once gridDensity or amplitude pushed displacement
    // past the hardcoded search radius.
    float gridSize = 0.034 / max(gridDensity, 0.01);
    const float cellZmax = 9.1;
    float jMaxAbsolute = cellZmax / gridSize;

    float Z0        = 1.0 / yFromHorizon;
    float dampEst   = 1.0 - smoothstep(3.5, 9.0, Z0 * 0.85) * 0.85;
    float yampBound = max(0.33 * dampEst * amplitude, 0.03);
    float Zlo = max(0.05, (1.0 - yampBound) / yFromHorizon);
    float Zhi = (1.0 + yampBound) / yFromHorizon;
    int jMin = max(1, int(floor(Zlo / gridSize)));
    int jMax = min(int(jMaxAbsolute), int(ceil(Zhi / gridSize)));

    half3 accum = half3(0.0);
    float halfSizeX = 0.5 * size.x;
    float halfSizeY = 0.5 * size.y;
    for (int j = jMin; j <= jMax; j++) {
        float jf    = float(j);
        float cellZ = jf * gridSize;

        float rawR             = 4.4 / (1.0 + cellZ * 1.10);
        float pxR              = max(rawR, 0.85) * dotSize;
        float horizCullThresh  = pxR * 4.0 + 2.0;
        float haloScale        = max(pxR * 1.7, 1.2);
        float subPxFade        = smoothstep(0.4, 1.0, rawR);
        float depth            = 1.0 / (1.0 + cellZ * 0.35 * depthFade);
        float invCellZ         = 1.0 / cellZ;
        float pitchScreenX     = gridSize * invCellZ * size.y;
        float iCenter          = round(uv.x * jf);
        float iCenterScreenX   = iCenter * pitchScreenX + halfSizeX;
        float iCenterCellX     = iCenter * gridSize;

        for (int di = -1; di <= 1; di++) {
            float dotScreenX = iCenterScreenX + float(di) * pitchScreenX;
            if (abs(position.x - dotScreenX) > horizCullThresh) continue;

            float cellX = iCenterCellX + float(di) * gridSize;
            float Y     = swDotsOceanHeight(cellX, cellZ, t, amplitude, patternScale);
            float dotYFromH = (1.0 - Y) * invCellZ;
            if (dotYFromH < 0.01) continue;
            float dotScreenY = (horizon + dotYFromH) * size.y + halfSizeY;

            float horizonFade = smoothstep(0.0, 0.05, dotYFromH);
            float d           = length(position - float2(dotScreenX, dotScreenY));
            float mask        = smoothstep(pxR + 1.0, pxR - 1.0, d);
            float halo        = exp(-d / haloScale) * 0.25;
            float crest       = clamp(Y / (0.28 * max(amplitude, 0.01)) * 0.5 + 0.5, 0.0, 1.0);
            float highlight   = 0.45 + 1.0 * crest;
            float intensity   = (mask + halo) * depth * highlight * horizonFade * subPxFade;
            accum = max(accum, half3(intensity));
        }
    }
    accum = min(accum * 1.25, half3(1.0));

    float2 vUV  = (position - 0.5 * size) / size;
    float  vig  = clamp(1.0 - dot(vUV, vUV) * 0.6 * vignette, 0.0, 1.0);
    accum *= half(vig);

    // Slight cool-water tint baked into the dots — combines with user `tint`
    // to keep the field reading as "sea" even when the caller picks neutral
    // colors. This is intentional and part of the ocean style's identity.
    float3 waterTint = float3(0.92, 0.97, 1.0);
    float3 fg  = float3(tint.rgb) * brightness * waterTint;
    float3 bg  = float3(background.rgb);
    float3 col = mix(bg, fg, float3(accum));
    return half4(half3(col), 1.0h);
}
```

### SWDotsStanding.metal (3D style)

```metal
#include <metal_stdlib>
#include <SwiftUI/SwiftUI_Metal.h>
using namespace metal;

static float swDotsStandingHeight(float x, float z, float t,
                                  float amplitude, float patternScale) {
    float a   = sin(x * 4.5 * patternScale) * sin(z * 4.5 * patternScale);
    float b   = sin(x * 7.0 * patternScale + 1.0) * sin(z * 7.0 * patternScale + 1.0);
    float env = sin(t * 1.4);
    float h   = (a * 0.7 + b * 0.3) * env;
    h *= 0.13;
    float damp = 1.0 - smoothstep(3.5, 9.0, z) * 0.85;
    return h * damp * amplitude;
}

[[ stitchable ]] half4 swDotsStanding(float2 position,
                                      half4  color,
                                      float4 boundingRect,
                                      float  time,
                                      float  speed,
                                      float  brightness,
                                      half4  tint,
                                      half4  background,
                                      float  dotSize,
                                      float  gridDensity,
                                      float  patternScale,
                                      float  vignette,
                                      float  horizon,
                                      float  amplitude,
                                      float  depthFade) {
    float2 size = boundingRect.zw;
    float2 uv   = (position - 0.5 * size) / size.y;
    float  t    = time * speed;

    float yFromHorizon = uv.y - horizon;
    if (yFromHorizon < 0.002) {
        return half4(half3(background.rgb), 1.0h);
    }

    // Wave-aware Z sweep — see SWDotsWavy.metal for the derivation.
    // `yampBound` here is the peak |Y| the standing-wave height function
    // can produce (~0.13 at amplitude=1).
    float gridSize = 0.034 / max(gridDensity, 0.01);
    const float cellZmax = 9.1;
    float jMaxAbsolute = cellZmax / gridSize;

    float Z0        = 1.0 / yFromHorizon;
    float dampEst   = 1.0 - smoothstep(3.5, 9.0, Z0 * 0.85) * 0.85;
    float yampBound = max(0.13 * dampEst * amplitude, 0.03);
    float Zlo = max(0.05, (1.0 - yampBound) / yFromHorizon);
    float Zhi = (1.0 + yampBound) / yFromHorizon;
    int jMin = max(1, int(floor(Zlo / gridSize)));
    int jMax = min(int(jMaxAbsolute), int(ceil(Zhi / gridSize)));

    half3 accum = half3(0.0);
    float halfSizeX = 0.5 * size.x;
    float halfSizeY = 0.5 * size.y;
    for (int j = jMin; j <= jMax; j++) {
        float jf    = float(j);
        float cellZ = jf * gridSize;

        float rawR             = 4.4 / (1.0 + cellZ * 1.10);
        float pxR              = max(rawR, 0.85) * dotSize;
        float horizCullThresh  = pxR * 4.0 + 2.0;
        float haloScale        = max(pxR * 1.7, 1.2);
        float subPxFade        = smoothstep(0.4, 1.0, rawR);
        float depth            = 1.0 / (1.0 + cellZ * 0.32 * depthFade);
        float invCellZ         = 1.0 / cellZ;
        float pitchScreenX     = gridSize * invCellZ * size.y;
        float iCenter          = round(uv.x * jf);
        float iCenterScreenX   = iCenter * pitchScreenX + halfSizeX;
        float iCenterCellX     = iCenter * gridSize;

        for (int di = -1; di <= 1; di++) {
            float dotScreenX = iCenterScreenX + float(di) * pitchScreenX;
            if (abs(position.x - dotScreenX) > horizCullThresh) continue;

            float cellX = iCenterCellX + float(di) * gridSize;
            float Y     = swDotsStandingHeight(cellX, cellZ, t, amplitude, patternScale);
            float dotYFromH = (1.0 - Y) * invCellZ;
            if (dotYFromH < 0.01) continue;
            float dotScreenY = (horizon + dotYFromH) * size.y + halfSizeY;

            float horizonFade = smoothstep(0.0, 0.05, dotYFromH);
            float d           = length(position - float2(dotScreenX, dotScreenY));
            float mask        = smoothstep(pxR + 1.0, pxR - 1.0, d);
            float halo        = exp(-d / haloScale) * 0.25;
            float crest       = clamp(Y / (0.13 * max(amplitude, 0.01)) * 0.5 + 0.5, 0.0, 1.0);
            float highlight   = 0.40 + 1.0 * crest;
            float intensity   = (mask + halo) * depth * highlight * horizonFade * subPxFade;
            accum = max(accum, half3(intensity));
        }
    }
    accum = min(accum * 1.2, half3(1.0));

    float2 vUV  = (position - 0.5 * size) / size;
    float  vig  = clamp(1.0 - dot(vUV, vUV) * 0.5 * vignette, 0.0, 1.0);
    accum *= half(vig);

    float3 fg  = float3(tint.rgb) * brightness;
    float3 bg  = float3(background.rgb);
    float3 col = mix(bg, fg, float3(accum));
    return half4(half3(col), 1.0h);
}
```

### SWDotsFlow.metal (flat style)

```metal
#include <metal_stdlib>
#include <SwiftUI/SwiftUI_Metal.h>
using namespace metal;

// Signature mirrors SWDotsWavy.metal so that `SWDotsRenderer` can call every
// style with the same argument list. The trailing `horizon` / `amplitude` /
// `depthFade` belong to the unified parameter set but are not consumed by
// this flat-grid style; they are touched with `(void)x;` to make the
// "unused on purpose" decision explicit.
[[ stitchable ]] half4 swDotsFlow(float2 position,
                                  half4  color,
                                  float4 boundingRect,
                                  float  time,
                                  float  speed,
                                  float  brightness,
                                  half4  tint,
                                  half4  background,
                                  float  dotSize,
                                  float  gridDensity,
                                  float  patternScale,
                                  float  vignette,
                                  float  horizon,
                                  float  amplitude,
                                  float  depthFade) {
    (void)horizon;
    (void)amplitude;
    (void)depthFade;

    float2 size = boundingRect.zw;
    float2 uv   = (position - 0.5 * size) / size.y;
    float  t    = time * speed;

    float  grid       = 0.020 / max(gridDensity, 0.01);
    float2 cell       = round(uv / grid) * grid;
    float  distToDot  = length(uv - cell);
    float  pxR        = (1.4 / size.y) * dotSize;
    float  mask       = smoothstep(pxR * 1.4, pxR * 0.6, distToDot);

    float n = sin(cell.x * 3.0 * patternScale + t * 0.4) *
              cos(cell.y * 3.0 * patternScale - t * 0.35) +
              0.5 * sin(cell.x * 7.0 * patternScale - t * 0.6) *
                    sin(cell.y * 7.0 * patternScale + t * 0.55);

    float fronts = sin(n * 6.0 + length(cell) * 8.0 * patternScale - t * 1.8);
    float bright = pow(max(fronts, 0.0), 1.8);

    float2 vUV   = (position - 0.5 * size) / size;
    float  vig   = clamp(1.0 - dot(vUV, vUV) * 0.85 * vignette, 0.0, 1.0);
    float  intensity = mask * (0.10 + 1.0 * bright) * vig;

    float3 bg  = float3(background.rgb);
    float3 fg  = float3(tint.rgb) * brightness;
    float3 col = mix(bg, fg, intensity);
    return half4(half3(col), 1.0h);
}
```

### SWDotsPlasma.metal (flat style)

```metal
#include <metal_stdlib>
#include <SwiftUI/SwiftUI_Metal.h>
using namespace metal;

// Trailing `horizon` / `amplitude` / `depthFade` belong to the unified
// SWDots parameter set; not used by this flat-grid style.
[[ stitchable ]] half4 swDotsPlasma(float2 position,
                                    half4  color,
                                    float4 boundingRect,
                                    float  time,
                                    float  speed,
                                    float  brightness,
                                    half4  tint,
                                    half4  background,
                                    float  dotSize,
                                    float  gridDensity,
                                    float  patternScale,
                                    float  vignette,
                                    float  horizon,
                                    float  amplitude,
                                    float  depthFade) {
    (void)horizon;
    (void)amplitude;
    (void)depthFade;

    float2 size = boundingRect.zw;
    float2 uv   = (position - 0.5 * size) / size.y;
    float  t    = time * speed;

    float  grid      = 0.018 / max(gridDensity, 0.01);
    float2 cell      = round(uv / grid) * grid;
    float  distToDot = length(uv - cell);
    float  pxR       = (1.6 / size.y) * dotSize;
    float  mask      = smoothstep(pxR * 1.4, pxR * 0.6, distToDot);

    float v = sin(cell.x * 8.0 * patternScale + t * 1.3) +
              sin(cell.y * 8.0 * patternScale + t * 1.1) +
              sin((cell.x + cell.y) * 6.0 * patternScale + t * 1.5) +
              sin(length(cell) * 10.0 * patternScale - t * 1.8);
    v = v * 0.25;
    float bright = clamp(0.5 + 0.5 * v, 0.0, 1.0);
    bright = pow(bright, 2.5);

    float2 vUV  = (position - 0.5 * size) / size;
    float  vig  = clamp(1.0 - dot(vUV, vUV) * 0.9 * vignette, 0.0, 1.0);
    float  intensity = mask * bright * vig;

    float3 bg  = float3(background.rgb);
    float3 fg  = float3(tint.rgb) * brightness;
    float3 col = mix(bg, fg, intensity);
    return half4(half3(col), 1.0h);
}
```

### SWDotsSnake.metal (flat style)

```metal
#include <metal_stdlib>
#include <SwiftUI/SwiftUI_Metal.h>
using namespace metal;

// Trailing `horizon` / `amplitude` / `depthFade` belong to the unified
// SWDots parameter set; not used by this flat-grid style.
[[ stitchable ]] half4 swDotsSnake(float2 position,
                                   half4  color,
                                   float4 boundingRect,
                                   float  time,
                                   float  speed,
                                   float  brightness,
                                   half4  tint,
                                   half4  background,
                                   float  dotSize,
                                   float  gridDensity,
                                   float  patternScale,
                                   float  vignette,
                                   float  horizon,
                                   float  amplitude,
                                   float  depthFade) {
    (void)horizon;
    (void)amplitude;
    (void)depthFade;

    float2 size = boundingRect.zw;
    float2 uv   = (position - 0.5 * size) / size.y;
    float  t    = time * speed;

    float  grid      = 0.018 / max(gridDensity, 0.01);
    float2 cell      = round(uv / grid) * grid;
    float  distToDot = length(uv - cell);
    float  pxR       = (1.5 / size.y) * dotSize;
    float  mask      = smoothstep(pxR * 1.4, pxR * 0.6, distToDot);

    float angle = sin(cell.x * 4.0 * patternScale + t * 0.6) * 1.2 +
                  cos(cell.y * 4.0 * patternScale - t * 0.5) * 1.2 +
                  sin((cell.x + cell.y) * 3.0 * patternScale + t * 0.9);
    float2 flow = float2(cos(angle), sin(angle));

    float phase  = dot(cell, flow) * 12.0 * patternScale - t * 4.0;
    float bright = 0.5 + 0.5 * sin(phase);
    bright = pow(bright, 4.0);

    float2 vUV   = (position - 0.5 * size) / size;
    float  vig   = clamp(1.0 - dot(vUV, vUV) * 0.7 * vignette, 0.0, 1.0);
    float  intensity = mask * (0.10 + 1.1 * bright) * vig;

    float3 bg  = float3(background.rgb);
    float3 fg  = float3(tint.rgb) * brightness;
    float3 col = mix(bg, fg, intensity);
    return half4(half3(col), 1.0h);
}
```

## Usage

```swift
// Default — wavy, white dots on black, full-screen
ZStack {
    SWDots()
        .ignoresSafeArea()
    // Your content here
}

// Pick a style and recolor
SWDots(style: .mountains, tint: .cyan, amplitude: 1.4)

// Flat-grid plasma style as a section background
myContent
    .background { SWDots(style: .plasma, tint: .pink) }

// Slow rolling ocean with a high horizon line
SWDots(style: .ocean, speed: 0.5, horizon: -0.2)

// Tighter star-like grid with dimmer dots
SWDots(style: .snake, gridDensity: 1.8, brightness: 0.7)
```

## Parameters

| Parameter | Type | Default | Range | Notes |
|---|---|---|---|---|
| `style` | `SWDotsStyle` | `.wavy` | — | `wavy` / `mountains` / `ocean` / `standing` / `flow` / `plasma` / `snake` |
| `tint` | `Color` | `.white` | — | Color of dots and their halos |
| `background` | `Color` | `.black` | — | Color rendered below the horizon and behind the dots |
| `speed` | `Float` | `1.0` | 0…3 | Time multiplier driving wave / flow motion |
| `brightness` | `Float` | `1.0` | 0…3 | Multiplier applied to the tint color before mixing |
| `dotSize` | `Float` | `1.0` | 0.2…3 | Per-dot pixel radius multiplier |
| `gridDensity` | `Float` | `1.0` | 0.3…3 | Grid density multiplier |
| `patternScale` | `Float` | `1.0` | 0.2…3 | Spatial frequency multiplier for the wave / flow pattern |
| `vignette` | `Float` | `1.0` | 0…3 | Strength of the screen-edge vignette darkening (`0.0` disables) |
| `amplitude` | `Float` | `1.0` | 0…3 | **3D-only** — wave height multiplier (ignored by flat styles) |
| `depthFade` | `Float` | `1.0` | 0…3 | **3D-only** — strength of the per-dot depth attenuation (ignored by flat styles) |
| `horizon` | `Float` | `-0.45` | -1.0…0.4 | **3D-only** — vertical horizon position in screen-aspect units, negative raises the horizon (ignored by flat styles) |
| `showsControls` | `Bool` | `false` | — | Demo-only gear ToolbarItem; requires an enclosing `NavigationStack` |

## Integration Checklist

1. Copy `SWDots.swift` and all 7 `SWDots*.metal` files into your Xcode target.
2. Confirm the deployment target is iOS 17+ / macOS 14+.
3. Use it as a `ZStack` background with `.ignoresSafeArea()` for full-bleed.
4. Pick a style and an accent color — for 3D styles also pick a `horizon` line that frames your foreground content.
5. The 3D dot field only renders below the horizon line — place legible foreground content above the horizon or use strong contrast for legibility.
6. To add a new style: drop `SWDots<Style>.metal` next to the others, add a case to `SWDotsStyle`, and map the case to its shader name in `shaderName`.

## Notes / Gotchas

- **The 3D dot field only renders below the horizon line.** Place legible foreground content above the horizon or use strong contrast.
- **Cost scales with view area and `gridDensity`.** Keep one instance per screen.
- **Ocean style ships a baked-in cool-water tint** `(0.92, 0.97, 1.0)` multiplied into the dot color so the field always reads as "sea" even with neutral user tints — intentional and part of the ocean style's identity.
- **`SWDotsWavy.metal` contains an important `dampEst` correction:** the damping factor must be evaluated at the smallest possible cell Z in the candidate range (cells lifted most by the wave), not at `Z0 = 1/yFromHorizon`. An older formula used `Z0 * 0.85` as a fudge factor — at high amplitude (≥ ~0.68) crest cells fell outside the candidate Z range and appeared as black holes at the peak. Preserve this correction if porting.
- **Wavy also stretches the halo to span `pitchScreenX * 0.5`:** at high amplitude crests live at small cellZ where the X-pitch grows past the halo's reach, so consecutive crest dots are separated by black gaps that read as a "hole at the top of the wave". The `max()` keeps the halo unchanged for farther cells.
- The 4 flat styles (`flow`, `plasma`, `snake` — and the unified-signature `horizon`/`amplitude`/`depthFade` trailing args) explicitly cast unused parameters with `(void)x;` to make the "unused on purpose" decision explicit. Do not remove these — they document the unified call site.
- When `showsControls` is `true`, the values passed via the initializer become the *initial* values of the live-tweakable state; subsequent changes from the parent are ignored.
- When `showsControls` is `true`, the gear button is a native `ToolbarItem` (placement `.primaryAction`). It requires the host view to be inside a `NavigationStack` — bare `#Preview` should wrap the call site with `NavigationStack { … }`.
