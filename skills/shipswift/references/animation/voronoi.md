---
id: animation-voronoi
title: Voronoi
description: Animated Voronoi cell background — double-pass Voronoi with anti-aliased edges, 1–5 color cell ramp, optional gap border between cells, and radial inner glow shadow
tier: free
tags: [animation, metal, shader, SwiftUI]
---

## Overview

Programmatic background of animated Voronoi cells with anti-aliased smooth edges. Double-pass algorithm: first pass finds the closest cell center, second pass scans a 5×5 neighborhood to compute the minimum half-plane distance to all neighbours (the cell edge). 1–5 color step-discretized palette ramp, optional gap border between cells, optional radial inner-shadow glow.

Requires iOS 17+ / macOS 14+ (SwiftUI `ShaderLibrary` / `Shader` / Metal `stitchable`).

## File Layout

```
SWAnimation/SWMetal/
  SWVoronoi.swift
  SWVoronoi.metal
```

## Source Code

### SWVoronoi.swift

```swift
//
//  SWVoronoi.swift
//  ShipSwift
//
//  A SwiftUI Metal `colorEffect`. Anti-aliased animated Voronoi pattern
//  with smooth customizable edges, up to 5 cell colors in a
//  step-discretized ramp, optional radial inner glow, and explicit gap
//  border between cells.
//
//  Requires iOS 17+ / macOS 14+ (SwiftUI `ShaderLibrary`,
//  `Shader`/`ShaderFunction`, Metal `stitchable`).
//
//  Usage:
//    // Default — 4-stop palette on white with subtle gap + glow
//    SWVoronoi()
//        .ignoresSafeArea()
//
//    // Custom palette + tighter gaps + stronger glow
//    SWVoronoi(
//        colors: [.indigo, .purple, .pink, .orange],
//        gap: 0.02,
//        glow: 0.6
//    )
//
//    // Demo / debug — adds a gear button that opens a live-tuning sheet.
//    // Requires an enclosing `NavigationStack`.
//    SWVoronoi(showsControls: true)
//
//  Parameters:
//    - colors: 1–5 cell palette colors (default cyan / blue / purple /
//              pink 4-stop rainbow).
//    - colorBack: Background color (default `.white`).
//    - colorGap: Color of the border / gap between cells
//                (default `.black`).
//    - colorGlow: Color of the radial inner shadow inside cells
//                 (default `.black`).
//    - speed: Multiplier on the internal animation time (default `1.0`).
//    - scale: Pattern zoom + AA control in `0.3...5` — small = sparse
//             large cells, large = dense small cells (default `1.25`).
//    - distortion: Cell-center sin distortion in `0...0.5` (default `0.3`).
//    - gap: Border width between cells in `0...0.1` (default `0.01`).
//    - glow: Radial inner shadow strength in `0...1` (default `0`).
//    - stepsPerColor: Palette quantization steps in `1...3` (default `1`).
//    - showsControls: Attach a gear `ToolbarItem` that opens a
//                     live-tuning sheet (default `false`).
//
//  Created by Wei Zhong on 5/25/26.
//

import SwiftUI

// MARK: - Main View

struct SWVoronoi: View {
    /// 1–5 cell palette colors.
    var colors: [Color] = [
        Color(red: 0.20, green: 0.85, blue: 0.95),  // cyan
        Color(red: 0.10, green: 0.40, blue: 0.95),  // blue
        Color(red: 0.55, green: 0.20, blue: 0.95),  // purple
        Color(red: 0.95, green: 0.30, blue: 0.65),  // pink
    ]

    var colorBack: Color = .white
    var colorGap:  Color = .black
    var colorGlow: Color = .black

    var speed: Float = 1.0

    /// Grid density — small = few large cells, large = many small cells.
    var scale: Float = 6

    /// Cell-center sin distortion in 0...0.5.
    var distortion: Float = 0.3

    /// Border width between cells in 0...0.1.
    var gap: Float = 0.01

    /// Radial inner shadow strength in 0...1.
    var glow: Float = 0

    /// Palette quantization steps in 1...3.
    var stepsPerColor: Float = 1

    var showsControls: Bool = false

    var body: some View {
        if showsControls {
            SWVoronoiControlled(initial: self)
        } else {
            SWVoronoiRenderer(initial: self)
        }
    }
}

// MARK: - Renderer

private struct SWVoronoiRenderer: View {
    let initial: SWVoronoi

    @State private var start: Date = .now

    var body: some View {
        TimelineView(.animation) { ctx in
            let elapsed = Float(ctx.date.timeIntervalSince(start))
            let slots = paddedSlots(initial.colors)
            let colorsCount = Float(max(min(initial.colors.count, 5), 1))

            initial.colorBack
                .colorEffect(
                    ShaderLibrary.swVoronoi(
                        .boundingRect,
                        .float(elapsed),
                        .float(initial.speed),
                        .float(initial.scale),
                        .float(initial.distortion),
                        .float(initial.gap),
                        .float(initial.glow),
                        .float(initial.stepsPerColor),
                        .float(colorsCount),
                        .color(slots[0]),
                        .color(slots[1]),
                        .color(slots[2]),
                        .color(slots[3]),
                        .color(slots[4]),
                        .color(initial.colorGap),
                        .color(initial.colorGlow),
                        .color(initial.colorBack)
                    )
                )
        }
    }

    private func paddedSlots(_ src: [Color]) -> [Color] {
        var out = Array(src.prefix(5))
        let tail = out.last ?? .black
        while out.count < 5 { out.append(tail) }
        return out
    }
}

// MARK: - Controlled Wrapper

private struct SWVoronoiControlled: View {
    @State private var colors: [Color]
    @State private var colorBack: Color
    @State private var colorGap: Color
    @State private var colorGlow: Color
    @State private var speed: Float
    @State private var scale: Float
    @State private var distortion: Float
    @State private var gap: Float
    @State private var glow: Float
    @State private var stepsPerColor: Float

    @State private var showSheet = false

    init(initial: SWVoronoi) {
        var palette = initial.colors
        while palette.count < 5 { palette.append(.white) }
        _colors        = State(initialValue: palette)
        _colorBack     = State(initialValue: initial.colorBack)
        _colorGap      = State(initialValue: initial.colorGap)
        _colorGlow     = State(initialValue: initial.colorGlow)
        _speed         = State(initialValue: initial.speed)
        _scale         = State(initialValue: initial.scale)
        _distortion    = State(initialValue: initial.distortion)
        _gap           = State(initialValue: initial.gap)
        _glow          = State(initialValue: initial.glow)
        _stepsPerColor = State(initialValue: initial.stepsPerColor)
    }

    var body: some View {
        SWVoronoiRenderer(
            initial: SWVoronoi(
                colors: colors,
                colorBack: colorBack,
                colorGap: colorGap,
                colorGlow: colorGlow,
                speed: speed,
                scale: scale,
                distortion: distortion,
                gap: gap,
                glow: glow,
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
                .accessibilityLabel("Voronoi Controls")
            }
        }
        .sheet(isPresented: $showSheet) {
            SWVoronoiControlsSheet(
                colors: $colors,
                colorBack: $colorBack,
                colorGap: $colorGap,
                colorGlow: $colorGlow,
                speed: $speed,
                scale: $scale,
                distortion: $distortion,
                gap: $gap,
                glow: $glow,
                stepsPerColor: $stepsPerColor
            )
            .presentationDetents([.medium, .large])
            .presentationDragIndicator(.visible)
        }
    }
}

// MARK: - Controls Sheet

private struct SWVoronoiControlsSheet: View {
    @Binding var colors: [Color]
    @Binding var colorBack: Color
    @Binding var colorGap: Color
    @Binding var colorGlow: Color
    @Binding var speed: Float
    @Binding var scale: Float
    @Binding var distortion: Float
    @Binding var gap: Float
    @Binding var glow: Float
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
                    ColorPicker("Gap",        selection: $colorGap,  supportsOpacity: false)
                    ColorPicker("Glow",       selection: $colorGlow, supportsOpacity: false)
                }

                Section("Cells") {
                    SliderRow(label: "Density",    value: $scale,         range: 0.3...5,  step: 0.05)
                    SliderRow(label: "Distortion", value: $distortion,    range: 0...0.5,  step: 0.01)
                    SliderRow(label: "Gap",        value: $gap,           range: 0...0.1,  step: 0.001)
                    SliderRow(label: "Glow",       value: $glow,          range: 0...1,    step: 0.01)
                    SliderRow(label: "Steps",      value: $stepsPerColor, range: 1...3,    step: 1)
                }

                Section("Motion") {
                    SliderRow(label: "Speed", value: $speed, range: 0...3, step: 0.05)
                }
            }
            .navigationTitle("Voronoi")
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
        if step >= 1   { return "\(Int(value.rounded()))" }
        if step < 0.01 { return String(format: "%.3f", value) }
        return String(format: "%.2f", value)
    }
}

// MARK: - Preview

#Preview("Default rainbow") {
    NavigationStack {
        SWVoronoi(showsControls: true)
    }
}

#Preview("Heavy glow") {
    SWVoronoi(
        colors: [.indigo, .purple, .pink, .orange],
        gap: 0.02,
        glow: 0.6
    )
    .ignoresSafeArea()
}
```

### SWVoronoi.metal

```metal
//
//  SWVoronoi.metal
//  ShipSwift
//
//  Stitchable SwiftUI colorEffect. Anti-aliased animated Voronoi
//  pattern with smooth, customizable edges; up to 5 cell colors in a
//  step-discretized ramp, plus radial inner glow and explicit gap
//  border between cells.
//
//  A pure 2-channel hash function drives the per-cell randomizer so no
//  auxiliary texture binding is needed.
//
//  Paired with: SWVoronoi.swift
//  Entry point: `swVoronoi` — invoked via SwiftUI `.colorEffect(...)`.
//  Requires iOS 17+ / macOS 14+.
//

#include <metal_stdlib>
#include <SwiftUI/SwiftUI_Metal.h>
using namespace metal;

// =============================================================================
// MARK: - helpers
// =============================================================================

// 2-channel hash for the per-cell offset randomizer.
static float2 swV_hash22(float2 p) {
    float3 p3 = fract(float3(p.xyx) * float3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.xx + p3.yz) * p3.zy);
}

// Double-pass Voronoi. First pass finds the closest
// cell center; second pass scans a 5×5 neighbourhood to compute the
// minimum half-plane distance to all neighbour cells — that's the cell
// edge distance.
//
// Returns `(edgeDist, mr.x, mr.y, randomHash)`.
//   - `edgeDist`     : signed-distance to the nearest cell border
//   - `mr.xy`        : vector from current point to closest center
//   - `randomHash`   : the raw 0..1 hash of the closest cell (palette mixer)
static float4 swV_voronoi(float2 x, float time, float distortion) {
    const float TWO_PI = 6.28318530718;

    float2 ip = floor(x);
    float2 fp = fract(x);

    float2 mg = float2(0.0);
    float2 mr = float2(0.0);
    float  md = 8.0;
    float  rndHash = 0.0;

    for (int j = -1; j <= 1; j++) {
        for (int i = -1; i <= 1; i++) {
            float2 g = float2(float(i), float(j));
            float2 o = swV_hash22(ip + g);
            float rawHash = o.x;
            o = 0.5 + distortion * sin(time + TWO_PI * o);
            float2 r = g + o - fp;
            float d = dot(r, r);

            if (d < md) {
                md = d;
                mr = r;
                mg = g;
                rndHash = rawHash;
            }
        }
    }

    md = 8.0;
    for (int j = -2; j <= 2; j++) {
        for (int i = -2; i <= 2; i++) {
            float2 g = mg + float2(float(i), float(j));
            float2 o = swV_hash22(ip + g);
            o = 0.5 + distortion * sin(time + TWO_PI * o);
            float2 r = g + o - fp;
            if (dot(mr - r, mr - r) > 0.00001) {
                md = min(md, dot(0.5 * (mr + r), normalize(r - mr)));
            }
        }
    }

    return float4(md, mr, rndHash);
}

// =============================================================================
// MARK: - swVoronoi
// =============================================================================

[[ stitchable ]] half4 swVoronoi(float2 position,
                                 half4  inColor,
                                 float4 boundingRect,
                                 float  time,
                                 float  speed,
                                 float  scale,         // 0.3..5  pattern zoom + AA
                                 float  distortion,    // 0..0.5  cell-center sin distortion
                                 float  gap,           // 0..0.1  border width
                                 float  glow,          // 0..1    radial inner shadow strength
                                 float  stepsPerColor, // 1..3    palette quantization
                                 float  colorsCount,
                                 half4  c1, half4 c2, half4 c3, half4 c4, half4 c5,
                                 half4  colorGap,
                                 half4  colorGlow,
                                 half4  colorBack) {
    float2 sz = boundingRect.zw;
    float  minDim = max(min(sz.x, sz.y), 1.0);
    float2 uv = (position - 0.5 * sz) / minDim;
    uv *= max(scale, 1e-4);

    float t = time * speed;
    float4 v = swV_voronoi(uv, t, saturate(distortion));

    // Palette mixer — the first assignment is overwritten; kept
    // intentionally so the two-line form stays explicit.
    float shape = saturate(v.w);
    int countI = clamp(int(colorsCount + 0.5), 1, 5);
    float countF = float(countI);

    float mixerA = shape * (countF - 1.0);
    (void)mixerA;
    float mixer = (shape - 0.5 / countF) * countF;
    float steps = max(1.0, stepsPerColor);

    half4 colors[5] = { c1, c2, c3, c4, c5 };

    half4 gradient = colors[0];
    gradient = half4(half3(gradient.rgb) * gradient.a, gradient.a);
    for (int i = 1; i < 5; i++) {
        if (i >= countI) break;
        float localT = clamp(mixer - float(i - 1), 0.0, 1.0);
        localT = round(localT * steps) / steps;
        half4 cc = colors[i];
        cc = half4(half3(cc.rgb) * cc.a, cc.a);
        gradient = mix(gradient, cc, half(localT));
    }

    // Wrap-around mix for mixer outside [0, count-1].
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

    float3 cellColor = float3(gradient.rgb);
    float cellOpacity = float(gradient.a);

    // Radial inner glow shadow — uses `mr` (vector to cell center).
    float glows = length(v.yz * saturate(glow));
    glows = pow(glows, 1.5);
    float3 glowRGB = float3(colorGlow.rgb) * float(colorGlow.a);
    float3 col = mix(cellColor, glowRGB, float(colorGlow.a) * glows);
    float opacity = cellOpacity + float(colorGlow.a) * glows;

    // Cell border (gap) — AA width scales with viewport scale.
    float edge = v.x;
    float smoothEdge = 0.02 / (2.0 * max(scale, 1e-4)) * (1.0 + 0.5 * saturate(gap));
    edge = smoothstep(saturate(gap) - smoothEdge, saturate(gap) + smoothEdge, edge);

    float3 gapRGB = float3(colorGap.rgb) * float(colorGap.a);
    col = mix(gapRGB, col, edge);
    opacity = mix(float(colorGap.a), opacity, edge);

    // Composite over background.
    float3 backRGB = float3(colorBack.rgb) * float(colorBack.a);
    col = col + backRGB * (1.0 - saturate(opacity));

    return half4(half3(col), 1.0);
}
```
