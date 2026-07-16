---
id: animation-dot-orbit
title: Dot Orbit
description: Animated dots orbiting around Voronoi-cell centers — 3×3 Voronoi-cell scan, each dot rotates individually, mapped onto a 1–10 step-discretized color ramp
tier: free
tags: [animation, metal, shader, SwiftUI]
---

## Overview

Programmatic background of animated dots — each dot lives in its own Voronoi cell and orbits around the cell center, rotating individually. 3×3 cell scan finds the closest dot, and a 1–10 color palette is sampled with optional step quantization. Randomizers use hash functions so no noise texture is bound.

Requires iOS 17+ / macOS 14+ (SwiftUI `ShaderLibrary` / `Shader` / Metal `stitchable`).

## File Layout

```
SWAnimation/SWMetal/
  SWDotOrbit.swift
  SWDotOrbit.metal
```

## Source Code

### SWDotOrbit.swift

```swift
//
//  SWDotOrbit.swift
//  ShipSwift
//
//  A SwiftUI Metal `colorEffect`. Animated multi-color dots, each
//  orbiting around its own Voronoi-cell center, mapped onto a 1–10
//  color step-discretized gradient.
//
//  Requires iOS 17+ / macOS 14+ (SwiftUI `ShaderLibrary`,
//  `Shader`/`ShaderFunction`, Metal `stitchable`).
//
//  Usage:
//    // Default — 5-stop rainbow orbiting on white, full-screen
//    SWDotOrbit()
//        .ignoresSafeArea()
//
//    // Custom palette + bigger spread
//    SWDotOrbit(
//        colors: [.indigo, .purple, .pink, .orange, .yellow],
//        spreading: 0.8
//    )
//
//    // As a section background
//    myContent.background { SWDotOrbit() }
//
//    // Demo / debug — adds a gear button that opens a live-tuning sheet.
//    // Requires an enclosing `NavigationStack`.
//    SWDotOrbit(showsControls: true)
//
//  Parameters:
//    - colors: 1–10 dot palette colors (default cyan / blue / purple /
//              pink / yellow 5-stop rainbow).
//    - colorBack: Background color (default `.white`).
//    - speed: Multiplier on the internal animation time (default `1.0`).
//    - scale: Grid density — small = sparse / few dots, large = dense /
//             many dots; controls how many dot cells fit in the view
//             (default `1.5`).
//    - size: Dot radius relative to cell in `0...1` (default `0.5`).
//    - sizeRange: Random per-dot size variation in `0...1` (default `0.5`).
//    - spreading: Maximum orbit distance around cell center in `0...1`
//                 (default `0.5`).
//    - stepsPerColor: Palette quantization steps in `1...4` — `1` gives
//                     hard color stops, higher values blend (default `1`).
//    - showsControls: Attach a gear `ToolbarItem` that opens a
//                     live-tuning sheet (default `false`).
//
//  Created by Wei Zhong on 5/25/26.
//

import SwiftUI

// MARK: - Main View

struct SWDotOrbit: View {
    /// 1–10 dot palette colors.
    var colors: [Color] = [
        Color(red: 0.20, green: 0.85, blue: 0.95),  // cyan
        Color(red: 0.10, green: 0.40, blue: 0.95),  // blue
        Color(red: 0.55, green: 0.20, blue: 0.95),  // purple
        Color(red: 0.95, green: 0.30, blue: 0.65),  // pink
        Color(red: 1.00, green: 0.85, blue: 0.20),  // yellow
    ]

    /// Background color.
    var colorBack: Color = .white

    /// Multiplier on the internal animation time.
    var speed: Float = 1.0

    /// Grid density — small = sparse / few dots, large = dense / many dots.
    /// `scale = 0.5` ≈ very few large dots, `5` ≈ many small dots (default `1.5`).
    var scale: Float = 10

    /// Dot radius relative to cell in 0...1.
    var size: Float = 1

    /// Random per-dot size variation in 0...1.
    var sizeRange: Float = 0.5

    /// Maximum orbit distance around cell center in 0...1.
    var spreading: Float = 1

    /// Palette quantization steps in 1...4 (1 = hard stops).
    var stepsPerColor: Float = 1

    /// When `true`, attaches a gear `ToolbarItem` that opens a live-tuning sheet.
    var showsControls: Bool = false

    var body: some View {
        if showsControls {
            SWDotOrbitControlled(initial: self)
        } else {
            SWDotOrbitRenderer(initial: self)
        }
    }
}

// MARK: - Renderer

private struct SWDotOrbitRenderer: View {
    let initial: SWDotOrbit

    @State private var start: Date = .now

    var body: some View {
        TimelineView(.animation) { ctx in
            let elapsed = Float(ctx.date.timeIntervalSince(start))
            let slots = paddedSlots(initial.colors)
            let colorsCount = Float(max(min(initial.colors.count, 10), 1))

            initial.colorBack
                .colorEffect(
                    ShaderLibrary.swDotOrbit(
                        .boundingRect,
                        .float(elapsed),
                        .float(initial.speed),
                        .float(initial.scale),
                        .float(initial.size),
                        .float(initial.sizeRange),
                        .float(initial.spreading),
                        .float(initial.stepsPerColor),
                        .float(colorsCount),
                        .color(slots[0]),
                        .color(slots[1]),
                        .color(slots[2]),
                        .color(slots[3]),
                        .color(slots[4]),
                        .color(slots[5]),
                        .color(slots[6]),
                        .color(slots[7]),
                        .color(slots[8]),
                        .color(slots[9]),
                        .color(initial.colorBack)
                    )
                )
        }
    }

    private func paddedSlots(_ src: [Color]) -> [Color] {
        var out = Array(src.prefix(10))
        let tail = out.last ?? .black
        while out.count < 10 { out.append(tail) }
        return out
    }
}

// MARK: - Controlled Wrapper (gear toolbar item + live sheet)

private struct SWDotOrbitControlled: View {
    @State private var colors: [Color]
    @State private var colorBack: Color
    @State private var speed: Float
    @State private var scale: Float
    @State private var size: Float
    @State private var sizeRange: Float
    @State private var spreading: Float
    @State private var stepsPerColor: Float

    @State private var showSheet = false

    init(initial: SWDotOrbit) {
        var palette = initial.colors
        while palette.count < 5 { palette.append(.white) }
        _colors        = State(initialValue: palette)
        _colorBack     = State(initialValue: initial.colorBack)
        _speed         = State(initialValue: initial.speed)
        _scale         = State(initialValue: initial.scale)
        _size          = State(initialValue: initial.size)
        _sizeRange     = State(initialValue: initial.sizeRange)
        _spreading     = State(initialValue: initial.spreading)
        _stepsPerColor = State(initialValue: initial.stepsPerColor)
    }

    var body: some View {
        SWDotOrbitRenderer(
            initial: SWDotOrbit(
                colors: colors,
                colorBack: colorBack,
                speed: speed,
                scale: scale,
                size: size,
                sizeRange: sizeRange,
                spreading: spreading,
                stepsPerColor: stepsPerColor
            )
        )
        .ignoresSafeArea()
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    showSheet = true
                } label: {
                    Image(systemName: "slider.horizontal.3")
                }
                .accessibilityLabel("Dot Orbit Controls")
            }
        }
        .sheet(isPresented: $showSheet) {
            SWDotOrbitControlsSheet(
                colors: $colors,
                colorBack: $colorBack,
                speed: $speed,
                scale: $scale,
                size: $size,
                sizeRange: $sizeRange,
                spreading: $spreading,
                stepsPerColor: $stepsPerColor
            )
            .presentationDetents([.medium, .large])
            .presentationDragIndicator(.visible)
        }
    }
}

// MARK: - Controls Sheet

private struct SWDotOrbitControlsSheet: View {
    @Binding var colors: [Color]
    @Binding var colorBack: Color
    @Binding var speed: Float
    @Binding var scale: Float
    @Binding var size: Float
    @Binding var sizeRange: Float
    @Binding var spreading: Float
    @Binding var stepsPerColor: Float

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section("Palette") {
                    ForEach(colors.indices, id: \.self) { i in
                        ColorPicker(
                            "Color \(i + 1)",
                            selection: Binding(
                                get: { colors[i] },
                                set: { colors[i] = $0 }
                            ),
                            supportsOpacity: false
                        )
                    }
                    ColorPicker("Background", selection: $colorBack, supportsOpacity: false)
                }

                Section("Dots") {
                    SliderRow(label: "Density",    value: $scale,         range: 0.5...10, step: 0.1)
                    SliderRow(label: "Size",       value: $size,          range: 0...1,    step: 0.01)
                    SliderRow(label: "Size Range", value: $sizeRange,     range: 0...1,    step: 0.01)
                    SliderRow(label: "Spreading",  value: $spreading,     range: 0...1,    step: 0.01)
                    SliderRow(label: "Steps",      value: $stepsPerColor, range: 1...4,    step: 1)
                }

                Section("Motion") {
                    SliderRow(label: "Speed", value: $speed, range: 0...3, step: 0.05)
                }
            }
            .navigationTitle("Dot Orbit")
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
                Text(formattedValue)
                    .font(.callout.monospacedDigit())
                    .foregroundStyle(.secondary)
            }
            Slider(value: $value, in: range, step: step)
        }
    }

    private var formattedValue: String {
        step >= 1
            ? "\(Int(value.rounded()))"
            : String(format: "%.2f", value)
    }
}

// MARK: - Preview

#Preview("Default rainbow") {
    NavigationStack {
        SWDotOrbit(showsControls: true)
    }
}

#Preview("Indigo set") {
    SWDotOrbit(
        colors: [.indigo, .purple, .pink, .orange],
        spreading: 0.8
    )
    .ignoresSafeArea()
}
```

### SWDotOrbit.metal

```metal
//
//  SWDotOrbit.metal
//  ShipSwift
//
//  Stitchable SwiftUI colorEffect. Animated multi-color dots, each
//  orbiting around its own Voronoi-cell center, mapped onto a 1–10
//  color step-discretized gradient.
//
//  The per-cell randomizers (`randomR` / `randomGB`) use pure hash
//  functions so no auxiliary texture has to be bound through SwiftUI's
//  `ShaderLibrary`.
//
//  Paired with: SWDotOrbit.swift
//  Entry point: `swDotOrbit` — invoked via SwiftUI `.colorEffect(...)`.
//  Requires iOS 17+ / macOS 14+.
//

#include <metal_stdlib>
#include <SwiftUI/SwiftUI_Metal.h>
using namespace metal;

// =============================================================================
// MARK: - hash helpers (texture-free randomizers)
// =============================================================================

// Single-channel hash for the orbit-rotation seed (`randomR`).
static float swDO_hash11(float2 p) {
    float3 p3 = fract(float3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

// 2-channel hash for the orbit-phase + palette mixer (`randomGB`).
static float2 swDO_hash22(float2 p) {
    float3 p3 = fract(float3(p.xyx) * float3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.xx + p3.yz) * p3.zy);
}

// 2D rotation by `theta` radians.
static float2 swDO_rotate(float2 uv, float th) {
    float c = cos(th), s = sin(th);
    return float2(c * uv.x - s * uv.y, s * uv.x + c * uv.y);
}

// `voronoiShape` — 3×3 neighbour scan to find the closest
// orbiting cell-center. Returns `(minDist, randomizer.x, randomizer.y)`.
static float3 swDO_voronoi(float2 uv, float time, float spreading) {
    const float TWO_PI = 6.28318530718;
    float2 iuv = floor(uv);
    float2 fuv = fract(uv);

    float s = 0.25 * saturate(spreading);

    float minDist = 1.0;
    float2 randomizer = float2(0.0);
    for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
            float2 tileOffset = float2(float(x), float(y));
            float2 rnd = swDO_hash22(iuv + tileOffset);
            float2 center = float2(0.5 + 1e-4);
            center += s * cos(time + TWO_PI * rnd);
            center -= 0.5;
            center = swDO_rotate(center,
                                 swDO_hash11(float2(rnd.x, rnd.y)) + 0.1 * time);
            center += 0.5;
            float d = length(tileOffset + center - fuv);
            if (d < minDist) {
                minDist = d;
                randomizer = rnd;
            }
        }
    }
    return float3(minDist, randomizer);
}

// =============================================================================
// MARK: - swDotOrbit
// =============================================================================

[[ stitchable ]] half4 swDotOrbit(float2 position,
                                  half4  inColor,
                                  float4 boundingRect,
                                  float  time,
                                  float  speed,
                                  float  scale,         // 0.1..5, default 1.5
                                  float  size,          // 0..1 dot radius
                                  float  sizeRange,     // 0..1 random size variation
                                  float  spreading,     // 0..1 orbit radius
                                  float  stepsPerColor, // 1..4 palette quantization
                                  float  colorsCount,
                                  half4  c1, half4 c2, half4 c3, half4 c4, half4 c5,
                                  half4  c6, half4 c7, half4 c8, half4 c9, half4 c10,
                                  half4  colorBack) {
    float2 sz = boundingRect.zw;
    float minDim = max(min(sz.x, sz.y), 1.0);
    float2 uv = (position - 0.5 * sz) / minDim;
    uv *= max(scale, 1e-4);

    const float firstFrameOffset = -10.0;
    float t = time * speed + firstFrameOffset;

    float3 voro = swDO_voronoi(uv, t, spreading) + 1e-4;

    float radius = 0.25 * saturate(size) - 0.5 * saturate(sizeRange) * voro.z;
    float dist = voro.x;
    float edgeWidth = fwidth(dist);
    float dots = 1.0 - smoothstep(radius - edgeWidth, radius + edgeWidth, dist);

    float shape = voro.y;
    int countI = clamp(int(colorsCount + 0.5), 1, 10);
    float countF = float(countI);
    float steps = max(1.0, stepsPerColor);

    // Two-step mixer — the second assignment is the one that actually
    // drives the gradient; the first is kept intentionally so the form
    // stays explicit.
    float mixerA = shape * (countF - 1.0);
    (void)mixerA;
    float mixer = (shape - 0.5 / countF) * countF;

    half4 colors[10] = { c1, c2, c3, c4, c5, c6, c7, c8, c9, c10 };

    half4 gradient = colors[0];
    half3 g_rgb = half3(gradient.rgb) * gradient.a;
    gradient = half4(g_rgb, gradient.a);

    for (int i = 1; i < 10; i++) {
        if (i >= countI) break;
        float localT = clamp(mixer - float(i - 1), 0.0, 1.0);
        localT = round(localT * steps) / steps;
        half4 cc = colors[i];
        cc = half4(half3(cc.rgb) * cc.a, cc.a);
        gradient = mix(gradient, cc, half(localT));
    }

    // Wrap-around mix — handle the edge case where mixer is outside
    // [0, count-1] by interpolating between last and first.
    if (mixer < 0.0 || mixer > (countF - 1.0)) {
        float localT = mixer + 1.0;
        if (mixer > (countF - 1.0)) {
            localT = mixer - (countF - 1.0);
        }
        localT = round(localT * steps) / steps;
        half4 cFst = colors[0];
        cFst = half4(half3(cFst.rgb) * cFst.a, cFst.a);
        half4 cLast = colors[countI - 1];
        cLast = half4(half3(cLast.rgb) * cLast.a, cLast.a);
        gradient = mix(cLast, cFst, half(localT));
    }

    float3 col = float3(gradient.rgb) * dots;
    float opacity = float(gradient.a) * dots;

    float3 bgRGB = float3(colorBack.rgb) * float(colorBack.a);
    col = col + bgRGB * (1.0 - opacity);

    return half4(half3(col), 1.0);
}
```
