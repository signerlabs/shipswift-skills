---
id: animation-water
title: Water
description: Rippling water-caustic image filter — simplex-noise wave drift + 6-octave rotated caustic distortion warps source UVs and adds a sunlight-on-pool highlight tint
tier: free
tags: [animation, metal, shader, SwiftUI]
---

## Overview

Image filter that wraps any source view in a rippling caustic distortion. Slow simplex-noise wave pushes UVs around while a 6-octave rotated caustic field paints sunlight-on-pool highlights across the surface. Applied with `.layerEffect`, so the source view is treated as the input.

Requires iOS 17+ / macOS 14+ (SwiftUI `ShaderLibrary` / `Shader` / Metal `stitchable`).

## File Layout

```
SWAnimation/SWMetal/
  SWWater.swift
  SWWater.metal
```

## Source Code

### SWWater.swift

```swift
//
//  SWWater.swift
//  ShipSwift
//
//  A SwiftUI Metal `layerEffect`. Wraps any view in a rippling caustic
//  distortion — a slow simplex-noise wave pushes UVs around while a
//  6-octave rotated caustic field paints sunlight-on-pool highlights
//  across the surface.
//
//  Requires iOS 17+ / macOS 14+ (SwiftUI `ShaderLibrary`,
//  `Shader`/`ShaderFunction`, Metal `stitchable`).
//
//  Usage:
//    // Default — gentle ripple with white highlights on black backing
//    SWWater {
//        Image(.facePicture)
//            .resizable()
//            .scaledToFill()
//    }
//
//    // Recolor — pool blue highlights, no wave drift
//    SWWater(
//        waves: 0,
//        highlights: 0.8,
//        colorBack: .black,
//        colorHighlight: Color(red: 0.4, green: 0.85, blue: 1.0)
//    ) {
//        Image(.facePicture)
//    }
//
//    // Demo / debug — adds a gear button that opens a live-tuning sheet.
//    // Requires an enclosing `NavigationStack`.
//    SWWater(showsControls: true) {
//        Image(.facePicture)
//    }
//
//  Parameters:
//    - speed: Multiplier on the internal animation time (default `1.0`).
//    - size: Pattern scale in `0.01...7` — small = tight pattern, large
//            = sparse waves (default `1.0`).
//    - caustic: Strength of the caustic UV distortion in `0...1`
//               (default `0.5`).
//    - waves: Strength of the simplex-noise wave distortion in `0...1`
//             (default `0.5`).
//    - layering: Weight of the 2nd caustic octave layered on top, in
//                `0...1` (default `0.5`).
//    - edges: How much the edge mask is flattened to 1.0 — `0` keeps the
//             distortion centered, `1` distorts the whole surface
//             (default `0.3`).
//    - highlights: Caustic highlight blend in `0...1` — drives both the
//                  tint mix and the additive sparkle (default `0.5`).
//    - colorBack: Backing color shown where the source layer is
//                 transparent (default `.black`).
//    - colorHighlight: Caustic highlight color (default `.white`).
//    - showsControls: Attach a gear `ToolbarItem` that opens a
//                     live-tuning sheet (default `false`).
//
//  Created by Wei Zhong on 5/25/26.
//

import SwiftUI

// MARK: - Main View

struct SWWater<Content: View>: View {
    /// Multiplier on the internal animation time.
    var speed: Float = 1.0

    /// Pattern scale in 0.01...7 — small = tight, large = sparse.
    var size: Float = 1.0

    /// Strength of the caustic UV distortion in 0...1.
    var caustic: Float = 0.1

    /// Strength of the simplex-noise wave distortion in 0...1.
    var waves: Float = 0.08

    /// Weight of the 2nd caustic octave layered on top.
    var layering: Float = 0.15

    /// Edge mask flatness — 0 = distortion centered, 1 = distort everywhere.
    var edges: Float = 0.3

    /// Caustic highlight blend in 0...1 — drives tint + sparkle.
    var highlights: Float = 0.35

    /// Backing color shown where the source layer is transparent.
    var colorBack: Color = .black

    /// Caustic highlight color.
    var colorHighlight: Color = .white

    /// When `true`, attaches a gear `ToolbarItem` that opens a live-tuning sheet.
    var showsControls: Bool = false

    private let content: Content

    init(
        speed: Float = 1.0,
        size: Float = 1.0,
        caustic: Float = 0.1,
        waves: Float = 0.08,
        layering: Float = 0.15,
        edges: Float = 0.3,
        highlights: Float = 0.35,
        colorBack: Color = .black,
        colorHighlight: Color = .white,
        showsControls: Bool = false,
        @ViewBuilder content: () -> Content
    ) {
        self.speed = speed
        self.size = size
        self.caustic = caustic
        self.waves = waves
        self.layering = layering
        self.edges = edges
        self.highlights = highlights
        self.colorBack = colorBack
        self.colorHighlight = colorHighlight
        self.showsControls = showsControls
        self.content = content()
    }

    var body: some View {
        if showsControls {
            SWWaterControlled(initial: self, content: content)
        } else {
            SWWaterRenderer(initial: self, content: content)
        }
    }
}

// MARK: - Renderer (pure shader binding)

private struct SWWaterRenderer<Content: View>: View {
    let initial: SWWater<Content>
    let content: Content

    @State private var start: Date = .now

    var body: some View {
        TimelineView(.animation) { ctx in
            let elapsed = Float(ctx.date.timeIntervalSince(start))
            // `maxSampleOffset` covers the largest UV shift our distortion
            // can produce — caustic max ~0.02 of the layer + waves up to
            // 0.1 — well under 200pt for any reasonable layer.
            content.layerEffect(
                ShaderLibrary.swWater(
                    .boundingRect,
                    .float(elapsed),
                    .float(initial.speed),
                    .float(initial.size),
                    .float(initial.caustic),
                    .float(initial.waves),
                    .float(initial.layering),
                    .float(initial.edges),
                    .float(initial.highlights),
                    .color(initial.colorBack),
                    .color(initial.colorHighlight)
                ),
                maxSampleOffset: CGSize(width: 200, height: 200)
            )
        }
    }
}

// MARK: - Controlled Wrapper (gear toolbar item + live sheet)

private struct SWWaterControlled<Content: View>: View {
    @State private var speed: Float
    @State private var size: Float
    @State private var caustic: Float
    @State private var waves: Float
    @State private var layering: Float
    @State private var edges: Float
    @State private var highlights: Float
    @State private var colorBack: Color
    @State private var colorHighlight: Color

    @State private var showSheet = false

    private let content: Content

    init(initial: SWWater<Content>, content: Content) {
        _speed          = State(initialValue: initial.speed)
        _size           = State(initialValue: initial.size)
        _caustic        = State(initialValue: initial.caustic)
        _waves          = State(initialValue: initial.waves)
        _layering       = State(initialValue: initial.layering)
        _edges          = State(initialValue: initial.edges)
        _highlights     = State(initialValue: initial.highlights)
        _colorBack      = State(initialValue: initial.colorBack)
        _colorHighlight = State(initialValue: initial.colorHighlight)
        self.content = content
    }

    var body: some View {
        SWWaterRenderer(
            initial: SWWater(
                speed: speed,
                size: size,
                caustic: caustic,
                waves: waves,
                layering: layering,
                edges: edges,
                highlights: highlights,
                colorBack: colorBack,
                colorHighlight: colorHighlight
            ) { content },
            content: content
        )
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    showSheet = true
                } label: {
                    Image(systemName: "slider.horizontal.3")
                }
                .accessibilityLabel("Water Controls")
            }
        }
        .sheet(isPresented: $showSheet) {
            SWWaterControlsSheet(
                speed: $speed,
                size: $size,
                caustic: $caustic,
                waves: $waves,
                layering: $layering,
                edges: $edges,
                highlights: $highlights,
                colorBack: $colorBack,
                colorHighlight: $colorHighlight
            )
            .presentationDetents([.medium, .large])
            .presentationDragIndicator(.visible)
        }
    }
}

// MARK: - Controls Sheet

private struct SWWaterControlsSheet: View {
    @Binding var speed: Float
    @Binding var size: Float
    @Binding var caustic: Float
    @Binding var waves: Float
    @Binding var layering: Float
    @Binding var edges: Float
    @Binding var highlights: Float
    @Binding var colorBack: Color
    @Binding var colorHighlight: Color

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section("Colors") {
                    ColorPicker("Back",      selection: $colorBack,      supportsOpacity: false)
                    ColorPicker("Highlight", selection: $colorHighlight, supportsOpacity: false)
                }

                Section("Pattern") {
                    SliderRow(label: "Size",       value: $size,       range: 0.01...7, step: 0.01)
                    SliderRow(label: "Caustic",    value: $caustic,    range: 0...1,    step: 0.01)
                    SliderRow(label: "Waves",      value: $waves,      range: 0...1,    step: 0.01)
                    SliderRow(label: "Layering",   value: $layering,   range: 0...1,    step: 0.01)
                    SliderRow(label: "Edges",      value: $edges,      range: 0...1,    step: 0.01)
                    SliderRow(label: "Highlights", value: $highlights, range: 0...1,    step: 0.01)
                }

                Section("Motion") {
                    SliderRow(label: "Speed", value: $speed, range: 0...3, step: 0.05)
                }
            }
            .navigationTitle("Water")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }
}

private struct SliderRow: View {
    let label: String
    @Binding var value: Float
    let range: ClosedRange<Float>
    let step: Float

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(label)
                Spacer()
                Text(String(format: "%.2f", value))
                    .font(.callout.monospacedDigit())
                    .foregroundStyle(.secondary)
            }
            Slider(value: $value, in: range, step: step)
        }
    }
}

// MARK: - Preview

#Preview("Default") {
    NavigationStack {
        SWWater(showsControls: true) {
            Image(.facePicture)
                .resizable()
                .scaledToFill()
        }
    }
}

#Preview("Pool blue") {
    SWWater(
        highlights: 0.8,
        colorBack: .black,
        colorHighlight: Color(red: 0.4, green: 0.85, blue: 1.0)
    ) {
        Image(.facePicture)
            .resizable()
            .scaledToFill()
    }
}
```

### SWWater.metal

```metal
//
//  SWWater.metal
//  ShipSwift
//
//  Stitchable SwiftUI layerEffect. Wraps a source layer in a
//  rippling caustic distortion: a slow simplex-noise wave gently pushes
//  UVs around while a 6-octave rotated caustic field pinches highlights
//  into the surface, like sunlight on a pool bottom.
//
//  Paired with: SWWater.swift
//  Entry point: `swWater` — invoked via SwiftUI `.layerEffect(...)`.
//  Requires iOS 17+ / macOS 14+.
//

#include <metal_stdlib>
#include <SwiftUI/SwiftUI_Metal.h>
using namespace metal;

// =============================================================================
// MARK: - 2D simplex noise (Ashima Arts / Stefan Gustavson, public domain)
// =============================================================================

static float3 swW_mod289v3(float3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
static float2 swW_mod289v2(float2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
static float3 swW_permute(float3 x)  { return swW_mod289v3(((x * 34.0) + 1.0) * x); }

static float swW_snoise(float2 v) {
    const float4 C = float4(0.211324865405187,
                             0.366025403784439,
                            -0.577350269189626,
                             0.024390243902439);
    float2 i  = floor(v + dot(v, C.yy));
    float2 x0 = v -   i + dot(i, C.xx);

    float2 i1 = (x0.x > x0.y) ? float2(1.0, 0.0) : float2(0.0, 1.0);
    float4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;

    i = swW_mod289v2(i);
    float3 p = swW_permute(swW_permute(i.y + float3(0.0, i1.y, 1.0))
                                     + i.x + float3(0.0, i1.x, 1.0));

    float3 m = max(0.5 - float3(dot(x0, x0),
                                 dot(x12.xy, x12.xy),
                                 dot(x12.zw, x12.zw)), 0.0);
    m = m * m;
    m = m * m;

    float3 x  = 2.0 * fract(p * C.www) - 1.0;
    float3 h  = abs(x) - 0.5;
    float3 ox = floor(x + 0.5);
    float3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);

    float3 g;
    g.x  = a0.x  * x0.x  + h.x  * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
}

// =============================================================================
// MARK: - helpers
// =============================================================================

// 2D rotation matrix.
static float2x2 swW_rot2(float r) {
    float c = cos(r), s = sin(r);
    return float2x2(c, s, -s, c);
}

// Smooth box that fades a `uv ∈ [0, 1]` rectangle's edges (per-axis fwidth).
// Used to mask out samples that wander past the layer's bounds.
static float swW_uvFrame(float2 uv) {
    float aax = 2.0 * fwidth(uv.x);
    float aay = 2.0 * fwidth(uv.y);
    float left   = smoothstep(0.0, aax, uv.x);
    float right  = 1.0 - smoothstep(1.0 - aax, 1.0, uv.x);
    float bottom = smoothstep(0.0, aay, uv.y);
    float top    = 1.0 - smoothstep(1.0 - aay, 1.0, uv.y);
    return left * right * bottom * top;
}

// Caustic noise — six rotated octaves whose phase advances with `t`.
// The vec2 accumulator `n` carries phase forward into the next octave,
// while `N` accumulates the visible caustic field.
static float swW_caustic(float2 uv, float t, float scale) {
    float2 n = float2(0.1);
    float2 N = float2(0.1);
    float2x2 m = swW_rot2(0.5);
    for (int j = 0; j < 6; j++) {
        uv = m * uv;
        n  = m * n;
        float fj = float(j);
        float2 q = uv * scale + fj + n + (0.5 + 0.5 * fj) * (fmod(fj, 2.0) - 1.0) * t;
        n += sin(q);
        N += cos(q) / scale;
        scale *= 1.1;
    }
    return (N.x + N.y + 1.0);
}

// =============================================================================
// MARK: - swWater
// =============================================================================

[[ stitchable ]] half4 swWater(float2 position,
                               SwiftUI::Layer layer,
                               float4 boundingRect,
                               float  time,
                               float  speed,
                               float  size,        // 0.01..7
                               float  caustic,     // 0..1
                               float  waves,       // 0..1
                               float  layering,    // 0..1
                               float  edges,       // 0..1
                               float  highlights,  // 0..1
                               half4  colorBack,
                               half4  colorHighlight) {
    float2 sz = boundingRect.zw;
    float aspect = sz.x / max(sz.y, 1.0);

    // Normalized image UV in 0..1.
    float2 imageUV = position / max(sz, float2(1.0));
    // Pattern UV centred at 0 and aspect-stretched so the caustic cells
    // stay roughly square no matter the layer shape.
    float2 patternUV = (imageUV - 0.5) * float2(aspect, 1.0);
    patternUV /= max(0.01 + 0.09 * size, 1e-4);

    float t = time * speed;

    // Slow simplex-noise wave breathes over the surface.
    float wavesNoise = swW_snoise((0.3 + 0.1 * sin(t)) * 0.1 * patternUV
                                  + float2(0.0, 0.4 * t));

    // Two layered caustic samples — adds detail without doubling the
    // inner loop count.
    float causticN = swW_caustic(patternUV + waves * float2(1.0, -1.0) * wavesNoise,
                                 2.0 * t, 1.5);
    causticN += saturate(layering) * swW_caustic(patternUV + 2.0 * waves * float2(1.0, -1.0) * wavesNoise,
                                                 1.5 * t, 2.0);
    causticN = causticN * causticN;

    // Edges distortion mask — pumps distortion harder near the layer
    // borders so the centre stays legible. `edges` blends it toward 1.0
    // (full distortion everywhere).
    float edgeMask = smoothstep(0.0, 0.1, imageUV.x);
    edgeMask *= smoothstep(0.0, 0.1, imageUV.y);
    edgeMask *= (smoothstep(1.0, 1.1, imageUV.x) + (1.0 - smoothstep(0.8, 0.95, imageUV.x)));
    edgeMask *= (1.0 - smoothstep(0.9, 1.0, imageUV.y));
    edgeMask = mix(edgeMask, 1.0, saturate(edges));

    float causticDistort = 0.02 * causticN * edgeMask;
    float wavesDistort   = 0.1 * saturate(waves) * wavesNoise;

    // Shift the sampling UV by the combined distortion.
    imageUV += float2(wavesDistort, -wavesDistort);
    imageUV += saturate(caustic) * causticDistort;

    float frame = swW_uvFrame(imageUV);

    // Sample the layer at the (now distorted) UV. layer.sample takes
    // view-space pixels, so multiply UV back up by the layer size.
    half4 image = layer.sample(imageUV * sz);

    float3 backRGB = float3(colorBack.rgb) * float(colorBack.a);
    float3 col = mix(backRGB, float3(image.rgb), float(image.a) * frame);

    // Caustic highlight tint — clamps the negative tail so the lowlights
    // don't darken the picture, then mixes the highlight color in
    // proportional to the caustic intensity and the user's `highlights`
    // slider.
    causticN = max(-0.2, causticN);
    float hi = 0.05 * saturate(highlights) * causticN;
    col = mix(col, float3(colorHighlight.rgb), hi);
    // A second, slightly brighter highlight pulse mixes the highlight
    // color in additively, weighted by the wave noise so the sparkle
    // travels with the surface.
    float sparkle = 0.025 * saturate(highlights) * causticN * float(colorHighlight.a)
                     * (0.5 + 0.5 * wavesNoise);
    col += float3(colorHighlight.rgb) * sparkle;

    return half4(half3(col), 1.0);
}
```
