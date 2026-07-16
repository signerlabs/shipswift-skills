---
id: animation-swirl
title: Swirl
description: Polar-coordinate twisted-bands procedural background — angle bands twisted into spirals via `pow(length, -twist)`, folded to a triangular wave, mapped onto a 1–10 color anti-aliased gradient with optional simplex-noise distortion
tier: free
tags: [animation, metal, shader, SwiftUI]
---

## Overview

Programmatic background of animated bands of color twisting and bending into spirals, arcs, and flowing circular patterns. Polar-coordinate angle is multiplied by `bandCount` and spun by time; a `pow(length, -twist)` radial term bends straight sectoral bands into spirals; folded to a triangular wave so each band gets two symmetric edges; optionally distorted with 2D simplex noise; finally mapped across 1...10 palette colors with `fwidth()`-based anti-aliased band edges. 2D simplex noise by Ashima Arts (public domain).

Requires iOS 17+ / macOS 14+ (SwiftUI `ShaderLibrary` / `Shader` / Metal `stitchable`).

## File Layout

```
SWAnimation/SWMetal/
  SWSwirl.swift
  SWSwirl.metal
```

## Source Code

### SWSwirl.swift

```swift
//
//  SWSwirl.swift
//  ShipSwift
//
//  A SwiftUI Metal `colorEffect`. Animated bands of color twisting
//  and bending into spirals, arcs, and flowing circular patterns.
//
//  Algorithm: polar-coordinate angle multiplied by `bandCount` and
//  spun by time; a `pow(length, -twist)` radial term bends straight
//  sectoral bands into spirals; folded to a triangular wave so each
//  band gets two symmetric edges; optionally distorted with simplex
//  noise; finally mapped across 1...10 palette colors with
//  `fwidth()`-based anti-aliased band edges.
//
//  Requires iOS 17+ / macOS 14+ (SwiftUI `ShaderLibrary`, `colorEffect`,
//  Metal `stitchable`).
//
//  Usage:
//    // Default — magenta/blue/cyan swirl on a deep navy back, full-screen
//    SWSwirl()
//        .ignoresSafeArea()
//
//    // Recolor — sunset on white
//    SWSwirl(
//        colors: [.orange, .pink, .purple],
//        colorBack: .white
//    )
//
//    // As a section background
//    myContent.background { SWSwirl() }
//
//    // Demo / debug — adds a gear button that opens a live-tuning sheet.
//    SWSwirl(showsControls: true)
//
//  Parameters:
//    - colors:         1–10 swirl band colors (default magenta /
//                      blue / cyan / white).
//    - colorBack:      Background color (default near-black `#0A0F1A`).
//    - bandCount:      Number of color bands in 0...15 (default 4;
//                      0 = concentric ripples).
//    - twist:          Vortex power in 0...1 (default 0.5;
//                      0 = straight sectoral shapes).
//    - center:         How far from the center the colors begin
//                      in 0...1 (default 0.5).
//    - proportion:     Blend point between colors in 0...1
//                      (default 0.5; 0.5 = equal distribution).
//    - softness:       Color transition sharpness in 0...1
//                      (default 0.5; 0 = hard, 1 = smooth).
//    - noise:          Strength of noise distortion in 0...1
//                      (default 0; no effect if `noiseFrequency` is 0).
//    - noiseFrequency: Noise frequency in 0...1 (default 0.3).
//    - scale:          Overall zoom in 0.05...4 (default 1.0).
//    - speed:          Multiplier on the internal animation time
//                      (default 1.0).
//    - showsControls:  Attach a gear `ToolbarItem` that opens a
//                      live-tuning sheet (default `false`).
//

import SwiftUI

// MARK: - Main View

struct SWSwirl: View {
    /// 1–10 swirl band colors. Extra entries beyond 10 are dropped.
    var colors: [Color] = [
        Color(red: 0.95, green: 0.30, blue: 0.70),  // magenta
        Color(red: 0.30, green: 0.40, blue: 0.95),  // blue
        Color(red: 0.30, green: 0.85, blue: 0.95),  // cyan
        Color.white
    ]

    /// Background color.
    var colorBack: Color = Color(red: 0.04, green: 0.06, blue: 0.10)  // #0A0F1A

    /// Number of color bands in 0...15.
    /// 0 = concentric ripples (no angular bands).
    var bandCount: Float = 6

    /// Vortex power in 0...1. 0 = straight sectoral shapes, 1 = tight spiral.
    /// Larger values also enlarge the empty hole at the center.
    var twist: Float = 0.2

    /// How far from the center the colors begin to appear, 0...1.
    var center: Float = 0.2

    /// Blend point between colors in 0...1. 0.5 = equal distribution.
    var proportion: Float = 0.5

    /// Color transition sharpness in 0...1. 0 = hard edges (default,
    /// `fwidth()` still applies pixel-level AA), 1 = soft blur.
    var softness: Float = 0.0

    /// Strength of noise distortion in 0...1 (no effect if `noiseFrequency` is 0).
    /// Default 0.5 gives the bands a hand-warped silhouette while they spin.
    var noise: Float = 0.2

    /// Noise frequency in 0...1.
    var noiseFrequency: Float = 0.4

    /// Overall zoom in 0.05...4.
    var scale: Float = 1.0

    /// Multiplier on the internal animation time.
    var speed: Float = 1.0

    /// When `true`, attaches a gear `ToolbarItem` that opens a
    /// live-tuning sheet.
    var showsControls: Bool = false

    var body: some View {
        if showsControls {
            SWSwirlControlled(initial: self)
        } else {
            SWSwirlRenderer(
                colors: colors,
                colorBack: colorBack,
                bandCount: bandCount,
                twist: twist,
                center: center,
                proportion: proportion,
                softness: softness,
                noise: noise,
                noiseFrequency: noiseFrequency,
                scale: scale,
                speed: speed
            )
        }
    }
}

// MARK: - Renderer

private struct SWSwirlRenderer: View {
    let colors: [Color]
    let colorBack: Color
    let bandCount: Float
    let twist: Float
    let center: Float
    let proportion: Float
    let softness: Float
    let noise: Float
    let noiseFrequency: Float
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
                    ShaderLibrary.swSwirl(
                        .boundingRect,
                        .float(elapsed),
                        .float(scale),
                        .float(colorsCount),
                        .float(bandCount),
                        .float(twist),
                        .float(center),
                        .float(proportion),
                        .float(softness),
                        .float(noise),
                        .float(noiseFrequency),
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

private struct SWSwirlControlled: View {
    @State private var colors: [Color]
    @State private var colorBack: Color
    @State private var bandCount: Float
    @State private var twist: Float
    @State private var center: Float
    @State private var proportion: Float
    @State private var softness: Float
    @State private var noise: Float
    @State private var noiseFrequency: Float
    @State private var scale: Float
    @State private var speed: Float

    @State private var showSheet = false

    init(initial: SWSwirl) {
        let trimmed = Array(initial.colors.prefix(10))
        _colors         = State(initialValue: trimmed.isEmpty ? [.white] : trimmed)
        _colorBack      = State(initialValue: initial.colorBack)
        _bandCount      = State(initialValue: initial.bandCount)
        _twist          = State(initialValue: initial.twist)
        _center         = State(initialValue: initial.center)
        _proportion     = State(initialValue: initial.proportion)
        _softness       = State(initialValue: initial.softness)
        _noise          = State(initialValue: initial.noise)
        _noiseFrequency = State(initialValue: initial.noiseFrequency)
        _scale          = State(initialValue: initial.scale)
        _speed          = State(initialValue: initial.speed)
    }

    var body: some View {
        SWSwirlRenderer(
            colors: colors,
            colorBack: colorBack,
            bandCount: bandCount,
            twist: twist,
            center: center,
            proportion: proportion,
            softness: softness,
            noise: noise,
            noiseFrequency: noiseFrequency,
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
                .accessibilityLabel("Swirl Controls")
            }
        }
        .sheet(isPresented: $showSheet) {
            SWSwirlControlsSheet(
                colors: $colors,
                colorBack: $colorBack,
                bandCount: $bandCount,
                twist: $twist,
                center: $center,
                proportion: $proportion,
                softness: $softness,
                noise: $noise,
                noiseFrequency: $noiseFrequency,
                scale: $scale,
                speed: $speed
            )
            .presentationDetents([.medium, .large])
            .presentationDragIndicator(.visible)
        }
    }
}

// MARK: - Controls Sheet

private struct SWSwirlControlsSheet: View {
    @Binding var colors: [Color]
    @Binding var colorBack: Color
    @Binding var bandCount: Float
    @Binding var twist: Float
    @Binding var center: Float
    @Binding var proportion: Float
    @Binding var softness: Float
    @Binding var noise: Float
    @Binding var noiseFrequency: Float
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

                Section("Shape") {
                    SliderRow(label: "Bands",       value: $bandCount,  range: 0...15,    step: 1)
                    SliderRow(label: "Twist",       value: $twist,      range: 0...1,     step: 0.01)
                    SliderRow(label: "Center",      value: $center,     range: 0...1,     step: 0.01)
                    SliderRow(label: "Proportion",  value: $proportion, range: 0...1,     step: 0.01)
                    SliderRow(label: "Softness",    value: $softness,   range: 0...1,     step: 0.01)
                    SliderRow(label: "Scale",       value: $scale,      range: 0.05...4,  step: 0.05)
                }

                Section("Noise") {
                    SliderRow(label: "Strength",    value: $noise,          range: 0...1, step: 0.01)
                    SliderRow(label: "Frequency",   value: $noiseFrequency, range: 0...1, step: 0.01)
                }

                Section("Motion") {
                    SliderRow(label: "Speed", value: $speed, range: 0...3, step: 0.05)
                }
            }
            .navigationTitle("Swirl")
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
        SWSwirl(showsControls: true)
    }
}

#Preview("Sunset on white") {
    SWSwirl(
        colors: [.orange, .pink, .purple],
        colorBack: .white
    )
    .ignoresSafeArea()
}
```

### SWSwirl.metal

```metal
//
//  SWSwirl.metal
//  ShipSwift
//
//  Swirl procedural background as a SwiftUI Metal `colorEffect`.
//
//  Algorithm: convert pixel position to polar coordinates, multiply
//  angle by `bandCount` and add time to spin; apply a radial twist via
//  `pow(length, -twist)` which bends straight sectoral bands into
//  spirals; fold to a triangular wave so each band has two edges;
//  optionally distort with simplex noise; mask out the very center;
//  finally map the resulting 0..1 shape value across 1...10 colors
//  with `fwidth()`-based anti-aliasing on each band boundary.
//

#include <metal_stdlib>
using namespace metal;

namespace SWSwirlImpl {
    constant float TWO_PI = 6.28318530718;

    inline float2 mod289_2(float2 x) {
        return x - floor(x * (1.0 / 289.0)) * 289.0;
    }
    inline float3 mod289_3(float3 x) {
        return x - floor(x * (1.0 / 289.0)) * 289.0;
    }
    inline float3 permute289(float3 x) {
        return mod289_3((x * 34.0 + 1.0) * x);
    }

    // 2D simplex noise (Ashima Arts, public domain).
    inline float snoise(float2 v) {
        const float4 C = float4( 0.211324865405187,
                                  0.366025403784439,
                                 -0.577350269189626,
                                  0.024390243902439);
        float2 i  = floor(v + dot(v, C.yy));
        float2 x0 = v - i + dot(i, C.xx);
        float2 i1 = (x0.x > x0.y) ? float2(1.0, 0.0) : float2(0.0, 1.0);
        float4 x12 = x0.xyxy + C.xxzz;
        x12.xy -= i1;
        i = mod289_2(i);
        float3 p = permute289(permute289(i.y + float3(0.0, i1.y, 1.0))
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

// Swirl procedural background.
//
// Parameters:
//   - position       : pixel position (`SwiftUI::Layer`-relative).
//   - currentColor   : source color from `.colorEffect` (unused).
//   - boundingRect   : `(x, y, w, h)` of the view's bounding rect.
//   - time           : seconds since the renderer started.
//   - scale          : overall zoom (smaller = swirl fills more).
//   - colorsCountF   : number of active palette entries, 1...10.
//   - bandCount      : number of color bands, 0 = concentric ripples, 0...15.
//   - twist          : vortex power, 0 = straight sectoral shapes, 0...1.
//   - center         : how far from the center the colors begin, 0...1.
//   - proportion     : blend point between colors, 0.5 = equal, 0...1.
//   - softness       : color transition sharpness, 0 = hard, 1 = smooth.
//   - noise          : strength of noise distortion, 0...1.
//   - noiseFrequency : noise frequency, 0...1.
//   - colorBack      : background color.
//   - c0...c9        : up to 10 swirl band colors.
[[ stitchable ]] half4 swSwirl(
    float2 position,
    half4  currentColor,
    float4 boundingRect,
    float  time,
    float  scale,
    float  colorsCountF,
    float  bandCount,
    float  twistRaw,
    float  center,
    float  proportion,
    float  softness,
    float  noiseStrength,
    float  noiseFrequency,
    half4  colorBack,
    half4  c0, half4 c1, half4 c2, half4 c3, half4 c4,
    half4  c5, half4 c6, half4 c7, half4 c8, half4 c9
) {
    using namespace SWSwirlImpl;

    float2 size   = boundingRect.zw;
    float  maxDim = max(max(size.x, size.y), 1.0);

    // Object UV: centered, normalized so the swirl fills the longest edge.
    float2 uv = (position - 0.5 * size) / (0.5 * maxDim);
    uv /= max(scale, 0.001);

    float t = time;

    float l = max(1e-4, length(uv));

    float angle = ceil(bandCount) * atan2(uv.y, uv.x) + t;
    float angleNorm = angle / TWO_PI;

    float twist  = 3.0 * clamp(twistRaw, 0.0, 1.0);
    float offset = pow(l, -twist) + angleNorm;

    // Triangular wave so each band has two symmetric edges.
    float shape = fract(offset);
    shape = 1.0 - abs(2.0 * shape - 1.0);

    // Optional simplex distortion.
    shape += noiseStrength *
             snoise(15.0 * pow(noiseFrequency, 2.0) * uv);

    // Mask out a tiny disc at the origin (the `atan2(0,0)` singularity).
    // A 0.2 cutoff would leave a visible black hole; we shrink it to
    // 0.005 so the swirl fills every visible pixel.
    float lPosTwist = pow(l, twist);
    float holeCutoff = 0.005;
    float mid = smoothstep(holeCutoff, holeCutoff + 0.8 * center, lPosTwist);
    shape = mix(0.0, shape, mid);

    // `proportion` warps the gradient distribution between colors.
    float p = clamp(proportion, 0.0, 1.0);
    float exponent = mix(0.25, 1.0, p * 2.0);
    exponent = mix(exponent, 10.0, max(0.0, p * 2.0 - 1.0));
    shape = pow(max(shape, 0.0), exponent);

    // Map `shape` across the palette.
    int colorsCount = clamp(int(colorsCountF), 1, 10);
    float mixer = shape * float(colorsCount);

    half4 gradient = c0;
    gradient.rgb *= gradient.a;

    float outerShape = 0.0;
    for (int i = 1; i <= 10; i++) {
        if (i > colorsCount) break;
        float m = clamp(mixer - float(i - 1), 0.0, 1.0);
        float aa = fwidth(m);
        m = smoothstep(0.5 - 0.5 * softness - aa,
                       0.5 + 0.5 * softness + aa, m);
        if (i == 1) outerShape = m;

        half4 c = pickColor(i - 1, c0, c1, c2, c3, c4, c5, c6, c7, c8, c9);
        c.rgb *= c.a;
        gradient = mix(gradient, c, half(m));
    }

    // Smoothly fade out the outermost band against the tiny center disc.
    float midAA    = 0.1 * fwidth(pow(l, -twist));
    float outerMid = smoothstep(holeCutoff, holeCutoff + midAA, lPosTwist);
    outerShape    *= outerMid;

    float3 color   = float3(gradient.rgb) * outerShape;
    float  opacity = float(gradient.a)    * outerShape;

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
