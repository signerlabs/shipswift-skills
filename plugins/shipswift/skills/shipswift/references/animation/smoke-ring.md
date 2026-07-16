---
id: animation-smoke-ring
title: Smoke Ring
description: Polar-coordinate smoke ring procedural background — radial multi-colored gradient distorted by two phase-shifted FBM noise layers that cross-fade so the smoke never visibly loops, with tunable radius / thickness / inner fill / noise iterations
tier: free
tags: [animation, metal, shader, SwiftUI]
---

## Overview

Programmatic background of a radial multi-colored ring distorted by layered noise. Ring shape is built in polar coordinates from `length` and `atan2`; two phase-shifted FBM noise layers (1...8 octaves of procedural value noise) cross-fade over a 3-second cycle so the smoke perpetually re-rolls without visible looping; the noise warps the polar UV so the ring's silhouette billows. A procedural `hash21` keeps the shader fully self-contained (no sampler / no resource binding).

Requires iOS 17+ / macOS 14+ (SwiftUI `ShaderLibrary` / `Shader` / Metal `stitchable`).

## File Layout

```
SWAnimation/SWMetal/
  SWSmokeRing.swift
  SWSmokeRing.metal
```

## Source Code

### SWSmokeRing.swift

```swift
//
//  SWSmokeRing.swift
//  ShipSwift
//
//  A SwiftUI Metal `colorEffect`. A radial multi-colored gradient
//  distorted by layered noise into a soft smoky ring.
//
//  Algorithm: ring shape is built in polar coordinates from `length` +
//  `atan2`; two phase-shifted FBM noise layers (1...8 octaves of
//  procedural value noise) cross-fade over a 3-second cycle so the
//  smoke perpetually re-rolls without visible looping; the noise
//  warps the polar UV so the ring's silhouette billows.
//
//  Requires iOS 17+ / macOS 14+ (SwiftUI `ShaderLibrary`, `colorEffect`,
//  Metal `stitchable`).
//
//  Usage:
//    // Default — warm 4-color smoke on a near-black background
//    SWSmokeRing()
//        .ignoresSafeArea()
//
//    // Recolor — cool palette on white
//    SWSmokeRing(
//        colors: [.cyan, .indigo, .purple, .white],
//        colorBack: .white
//    )
//
//    // As a section background
//    myContent.background { SWSmokeRing() }
//
//    // Demo / debug — adds a gear button that opens a live-tuning sheet.
//    SWSmokeRing(showsControls: true)
//
//  Parameters:
//    - colors:           1–10 ring gradient colors (default warm
//                        red / orange / yellow / white).
//    - colorBack:        Background color (default near-black `#0A0612`).
//    - thickness:        Ring thickness in 0.01...1 (default 0.4).
//    - radius:           Ring radius in 0...1 (default 0.4).
//    - innerShape:       Inner-fill amount in 0...4 (default 2.0;
//                        cubed before use).
//    - noiseScale:       Noise frequency in 0.01...5 (default 1.4).
//    - noiseIterations:  FBM octave count in 1...8 (default 6).
//    - scale:            Overall zoom in 0.05...4 (default 1.0).
//    - speed:            Multiplier on the internal animation time
//                        (default 1.0).
//    - showsControls:    Attach a gear `ToolbarItem` that opens a
//                        live-tuning sheet (default `false`).
//

import SwiftUI

// MARK: - Main View

struct SWSmokeRing: View {
    /// 1–10 ring gradient colors. Extra entries beyond 10 are dropped.
    var colors: [Color] = [
        .white,
        .white
    ]

    /// Background color.
    var colorBack: Color = Color(red: 0.04, green: 0.025, blue: 0.07)  // #0A0612

    /// Ring thickness in 0.01...1.
    var thickness: Float = 0.4

    /// Ring radius in 0...1.
    var radius: Float = 0.4

    /// Inner-fill amount in 0...4 (cubed before use). 1.0 ≈ centered hole
    /// (default), 0 = solid disc, 2+ = the ring overflows inward and the
    /// hole disappears.
    var innerShape: Float = 1.0

    /// Noise frequency in 0.01...5. Higher = finer grain, more chaotic
    /// silhouette.
    var noiseScale: Float = 2.8

    /// FBM octave count in 1...8. Higher = more layered detail.
    var noiseIterations: Float = 8

    /// Overall zoom in 0.05...4.
    var scale: Float = 0.8

    /// Multiplier on the internal animation time.
    var speed: Float = 1.0

    /// When `true`, attaches a gear `ToolbarItem` that opens a
    /// live-tuning sheet.
    var showsControls: Bool = false

    var body: some View {
        if showsControls {
            SWSmokeRingControlled(initial: self)
        } else {
            SWSmokeRingRenderer(
                colors: colors,
                colorBack: colorBack,
                thickness: thickness,
                radius: radius,
                innerShape: innerShape,
                noiseScale: noiseScale,
                noiseIterations: noiseIterations,
                scale: scale,
                speed: speed
            )
        }
    }
}

// MARK: - Renderer

private struct SWSmokeRingRenderer: View {
    let colors: [Color]
    let colorBack: Color
    let thickness: Float
    let radius: Float
    let innerShape: Float
    let noiseScale: Float
    let noiseIterations: Float
    let scale: Float
    let speed: Float

    @State private var start: Date = .now

    var body: some View {
        let slots = paddedSlots(colors)
        let colorsCount = Float(max(min(colors.count, 10), 1))

        TimelineView(.animation) { ctx in
            let elapsed = Float(ctx.date.timeIntervalSince(start)) * speed
            // Base layer must be opaque — `colorBack` doubles as the
            // first-frame fallback before the shader is invoked.
            colorBack
                .colorEffect(
                    ShaderLibrary.swSmokeRing(
                        .boundingRect,
                        .float(elapsed),
                        .float(scale),
                        .float(colorsCount),
                        .float(thickness),
                        .float(radius),
                        .float(innerShape),
                        .float(noiseScale),
                        .float(noiseIterations),
                        .color(colorBack),
                        .color(slots[0]),
                        .color(slots[1]),
                        .color(slots[2]),
                        .color(slots[3]),
                        .color(slots[4]),
                        .color(slots[5]),
                        .color(slots[6]),
                        .color(slots[7]),
                        .color(slots[8]),
                        .color(slots[9])
                    )
                )
        }
    }

    /// Pad palette to exactly 10 entries by repeating the tail color.
    /// Slots beyond `colorsCount` are not used by the shader; padding
    /// just keeps the parameter list well-formed.
    private func paddedSlots(_ src: [Color]) -> [Color] {
        var out = Array(src.prefix(10))
        let tail = out.last ?? .black
        while out.count < 10 { out.append(tail) }
        return out
    }
}

// MARK: - Controlled Wrapper (gear toolbar item + live sheet)

private struct SWSmokeRingControlled: View {
    @State private var colors: [Color]
    @State private var colorBack: Color
    @State private var thickness: Float
    @State private var radius: Float
    @State private var innerShape: Float
    @State private var noiseScale: Float
    @State private var noiseIterations: Float
    @State private var scale: Float
    @State private var speed: Float

    @State private var showSheet = false

    init(initial: SWSmokeRing) {
        let trimmed = Array(initial.colors.prefix(10))
        _colors          = State(initialValue: trimmed.isEmpty ? [.white] : trimmed)
        _colorBack       = State(initialValue: initial.colorBack)
        _thickness       = State(initialValue: initial.thickness)
        _radius          = State(initialValue: initial.radius)
        _innerShape      = State(initialValue: initial.innerShape)
        _noiseScale      = State(initialValue: initial.noiseScale)
        _noiseIterations = State(initialValue: initial.noiseIterations)
        _scale           = State(initialValue: initial.scale)
        _speed           = State(initialValue: initial.speed)
    }

    var body: some View {
        SWSmokeRingRenderer(
            colors: colors,
            colorBack: colorBack,
            thickness: thickness,
            radius: radius,
            innerShape: innerShape,
            noiseScale: noiseScale,
            noiseIterations: noiseIterations,
            scale: scale,
            speed: speed
        )
        .ignoresSafeArea()
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    showSheet = true
                } label: {
                    Image(systemName: "slider.horizontal.3")
                }
                .accessibilityLabel("Smoke Ring Controls")
            }
        }
        .sheet(isPresented: $showSheet) {
            SWSmokeRingControlsSheet(
                colors: $colors,
                colorBack: $colorBack,
                thickness: $thickness,
                radius: $radius,
                innerShape: $innerShape,
                noiseScale: $noiseScale,
                noiseIterations: $noiseIterations,
                scale: $scale,
                speed: $speed
            )
            .presentationDetents([.medium, .large])
            .presentationDragIndicator(.visible)
        }
    }
}

// MARK: - Controls Sheet

private struct SWSmokeRingControlsSheet: View {
    @Binding var colors: [Color]
    @Binding var colorBack: Color
    @Binding var thickness: Float
    @Binding var radius: Float
    @Binding var innerShape: Float
    @Binding var noiseScale: Float
    @Binding var noiseIterations: Float
    @Binding var scale: Float
    @Binding var speed: Float

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    ForEach(colors.indices, id: \.self) { i in
                        ColorPicker("Color \(i + 1)",
                                    selection: $colors[i],
                                    supportsOpacity: true)
                    }
                    ColorPicker("Background",
                                selection: $colorBack,
                                supportsOpacity: false)
                } header: {
                    HStack {
                        Text("Palette (\(colors.count) / 10)")
                        Spacer()
                        Button {
                            if colors.count > 1 { colors.removeLast() }
                        } label: {
                            Image(systemName: "minus.circle")
                        }
                        .disabled(colors.count <= 1)
                        Button {
                            if colors.count < 10 {
                                colors.append(colors.last ?? .white)
                            }
                        } label: {
                            Image(systemName: "plus.circle")
                        }
                        .disabled(colors.count >= 10)
                    }
                }

                Section("Ring") {
                    SliderRow(label: "Radius",     value: $radius,     range: 0...1,     step: 0.01)
                    SliderRow(label: "Thickness",  value: $thickness,  range: 0.01...1,  step: 0.01)
                    SliderRow(label: "Inner Fill", value: $innerShape, range: 0...4,     step: 0.05)
                    SliderRow(label: "Scale",      value: $scale,      range: 0.05...4,  step: 0.05)
                }

                Section("Noise") {
                    SliderRow(label: "Noise Scale", value: $noiseScale,      range: 0.01...5, step: 0.01)
                    SliderRow(label: "Iterations",  value: $noiseIterations, range: 1...8,    step: 1)
                }

                Section("Motion") {
                    SliderRow(label: "Speed", value: $speed, range: 0...3, step: 0.05)
                }
            }
            .navigationTitle("Smoke Ring")
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
        SWSmokeRing(showsControls: true)
    }
}

#Preview("Cool palette on white") {
    SWSmokeRing(
        colors: [.cyan, .indigo, .purple, .white],
        colorBack: .white
    )
    .ignoresSafeArea()
}
```

### SWSmokeRing.metal

```metal
//
//  SWSmokeRing.metal
//  ShipSwift
//
//  Smoke-ring procedural background as a SwiftUI Metal `colorEffect`.
//
//  Algorithm: a polar-coordinate ring shape (`length(uv)` + `atan2`)
//  is distorted by two layers of value-noise FBM. The two layers are
//  phase-shifted in time and cross-faded so the smoke perpetually
//  re-rolls instead of looping visibly. The ring's radius, thickness
//  and inner-fill are user controls; the distorted shape mask drives
//  the alpha and a 1...10 color gradient.
//
//  A procedural `hash21` keeps the shader fully self-contained
//  (no sampler / no resource binding).
//

#include <metal_stdlib>
using namespace metal;

namespace SWSmokeRingImpl {
    constant float TWO_PI = 6.28318530718;
    constant float PI     = 3.14159265358979;

    inline float hash21(float2 p) {
        p = fract(p * float2(0.3183099, 0.3678794)) + 0.1;
        p += dot(p, p.yx + 19.19);
        return fract(p.x * p.y);
    }

    // `randomR` quantizes the input by /100 and wraps to keep
    // the noise tileable.
    inline float randomR(float2 p) {
        float2 uv = floor(p) / 100.0 + 0.5;
        return hash21(fract(uv));
    }

    inline float valueNoise(float2 st) {
        float2 i = floor(st);
        float2 f = fract(st);
        float a = randomR(i);
        float b = randomR(i + float2(1.0, 0.0));
        float c = randomR(i + float2(0.0, 1.0));
        float d = randomR(i + float2(1.0, 1.0));
        float2 u = f * f * (3.0 - 2.0 * f);
        float x1 = mix(a, b, u.x);
        float x2 = mix(c, d, u.x);
        return mix(x1, x2, u.y);
    }

    inline float2 fbm(float2 n0, float2 n1, int iterations) {
        float2 total = float2(0.0);
        float  amplitude = 0.4;
        for (int i = 0; i < 8; i++) {
            if (i >= iterations) break;
            total.x += valueNoise(n0) * amplitude;
            total.y += valueNoise(n1) * amplitude;
            n0 *= 1.99;
            n1 *= 1.99;
            amplitude *= 0.65;
        }
        return total;
    }

    inline float getNoise(float2 uv,
                          float2 pUv,
                          float  t,
                          float  noiseScale,
                          int    iterations)
    {
        float2 pUvLeft  = pUv + 0.03 * t;
        float  period   = max(abs(noiseScale * TWO_PI), 1e-6);
        float2 pUvRight = float2(fract(pUv.x / period) * period, pUv.y) + 0.03 * t;
        float2 n = fbm(pUvLeft, pUvRight, iterations);
        return mix(n.y, n.x, smoothstep(-0.25, 0.25, uv.x));
    }

    inline float getRingShape(float2 uv,
                              float radius,
                              float thickness,
                              float innerShape)
    {
        float d = length(uv);
        float ring = 1.0 - smoothstep(radius, radius + thickness, d);
        float inner = pow(innerShape, 3.0) * thickness;
        ring *= smoothstep(radius - inner, radius, d);
        return ring;
    }

    inline half4 pickColor(int i,
                           half4 c0, half4 c1, half4 c2, half4 c3, half4 c4,
                           half4 c5, half4 c6, half4 c7, half4 c8, half4 c9) {
        switch (i) {
            case 0: return c0;
            case 1: return c1;
            case 2: return c2;
            case 3: return c3;
            case 4: return c4;
            case 5: return c5;
            case 6: return c6;
            case 7: return c7;
            case 8: return c8;
            default: return c9;
        }
    }
}

// Smoke-Ring procedural background.
//
// Parameters:
//   - position         : pixel position (`SwiftUI::Layer`-relative).
//   - currentColor     : source color from `.colorEffect` (unused).
//   - boundingRect     : `(x, y, w, h)` of the view's bounding rect.
//   - time             : seconds since the renderer started.
//   - scale            : overall zoom (smaller = ring fills more).
//   - colorsCountF     : number of active palette entries, 1...10.
//   - thickness        : ring thickness, 0.01...1.
//   - radius           : ring radius, 0...1.
//   - innerShape       : inner-fill amount, 0...4 (cubed before use).
//   - noiseScale       : noise frequency, 0.01...5.
//   - noiseIterationsF : FBM layer count, 1...8.
//   - colorBack        : background color.
//   - c0...c9          : up to 10 ring gradient colors.
[[ stitchable ]] half4 swSmokeRing(
    float2 position,
    half4  currentColor,
    float4 boundingRect,
    float  time,
    float  scale,
    float  colorsCountF,
    float  thickness,
    float  radius,
    float  innerShape,
    float  noiseScale,
    float  noiseIterationsF,
    half4  colorBack,
    half4  c0, half4 c1, half4 c2, half4 c3, half4 c4,
    half4  c5, half4 c6, half4 c7, half4 c8, half4 c9
) {
    using namespace SWSmokeRingImpl;

    float2 size   = boundingRect.zw;
    float  maxDim = max(max(size.x, size.y), 1.0);

    // Centered, normalized so the ring fits the longest edge.
    float2 uv = (position - 0.5 * size) / (0.5 * maxDim);
    uv /= max(scale, 0.001);

    float t = time;

    // Two phase-shifted time loops + cross-fade weight so the smoke
    // never visibly repeats.
    float cycleDuration = 3.0;
    float timeBlend     = 0.5 + 0.5 * sin(0.1 * t * PI / cycleDuration - 0.5 * PI);

    float period2    = 2.0 * cycleDuration;
    float localTime1 = fract((0.1 * t + cycleDuration) / period2) * period2;
    float localTime2 = fract((0.1 * t) / period2) * period2;

    float atg = atan2(uv.y, uv.x) + 0.001;
    float l   = length(uv);
    float radialOffset = 0.5 * l - rsqrt(max(1e-4, l));

    float2 polar1 = float2(atg, localTime1 - radialOffset) * noiseScale;
    float2 polar2 = float2(atg, localTime2 - radialOffset) * noiseScale;

    int   iter   = clamp(int(noiseIterationsF), 1, 8);
    float noise1 = getNoise(uv, polar1, t, noiseScale, iter);
    float noise2 = getNoise(uv, polar2, t, noiseScale, iter);
    float noise  = mix(noise1, noise2, timeBlend);

    // Noise warps the polar UV so the ring's silhouette billows.
    float2 shapeUV = uv * (0.8 + 1.2 * noise);

    float ringShape = getRingShape(shapeUV, radius, thickness, innerShape);

    int colorsCount = clamp(int(colorsCountF), 1, 10);
    int idxLast = colorsCount - 1;

    float mixer = ringShape * ringShape * float(colorsCount - 1);

    half4 gradient = pickColor(idxLast,
                                c0, c1, c2, c3, c4, c5, c6, c7, c8, c9);
    gradient.rgb *= gradient.a;
    for (int i = 8; i >= 0; i--) {
        if (i >= idxLast) continue;
        float localT = clamp(mixer - float(idxLast - i - 1), 0.0, 1.0);
        half4 c = pickColor(i, c0, c1, c2, c3, c4, c5, c6, c7, c8, c9);
        c.rgb *= c.a;
        gradient = mix(gradient, c, half(localT));
    }

    float3 color   = float3(gradient.rgb) * ringShape;
    float  opacity = float(gradient.a) * ringShape;

    float3 bgRGB = float3(colorBack.rgb) * float(colorBack.a);
    color   = color + bgRGB * (1.0 - opacity);
    opacity = opacity + float(colorBack.a) * (1.0 - opacity);

    // Sub-pixel dither against banding.
    float dither = fract(sin(dot(0.014 * position,
                                 float2(12.9898, 78.233))) * 43758.5453123) - 0.5;
    color += float3(dither / 256.0);

    return half4(half3(color), half(opacity));
}
```
