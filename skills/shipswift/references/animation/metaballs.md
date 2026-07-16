---
id: animation-metaballs
title: Metaballs
description: Gooey metaball blobs background with two styles — cluster (soft blobs meandering on independent noise drifts with shape-weighted color blending across a 1–8 color palette) and fountain (a big central ball with small balls streaming vertically, dissolving in / out and blending colors like mixing liquids). Programmatic, no source view needed
tier: free
tags: [animation, metal, shader, SwiftUI]
---

## Overview

Gooey procedural background of soft blobs rendered through SwiftUI's `colorEffect` Metal pipeline. No source view is required — `SWMetaballs()` renders standalone over its background color.

A `style` system selects between two looks:

- **`.cluster`** (the original) — blobs meander on independent noise drifts; each blob picks its color by index from a 1–8 entry palette and the shape-weighted average produces the merged, gooey look.
- **`.fountain`** — a big central ball with small balls streaming vertically. Roughly half the small balls rise from the bottom and converge into the big ball, the other half leave the big ball and spread upward out of frame. Because all shapes are summed before the threshold, a small ball melts into a teardrop bridge as it nears the big ball (the metaball "merge"), then separates again as it travels. A small ball's color is blended toward the big ball's the nearer it is to the centre, so it dissolves in like two liquids mixing rather than staying a distinct dot.

Requires iOS 17+ / macOS 14+ (SwiftUI `ShaderLibrary` / `Shader` / Metal `stitchable`).

## File Layout

```
SWAnimation/SWMetal/
  SWMetaballs.swift
  SWMetaballs.metal
```

## Parameters

- **`style`** — `.cluster` (independent noise drift, the original look) or `.fountain` (big central ball with small balls streaming in / out). Default `.cluster`. The renderer dispatches to a different Metal `stitchable` function per style (`swMetaballs` / `swMetaballsFountain`), and `.fountain` passes one extra argument (`bigSize`).
- **`colors`** — Per-ball palette, 1–8 entries. In `.cluster`, ball `i` picks `colors[i % colors.count]`. In `.fountain`, `colors[0]` paints the big central ball and the rest cycle over the small balls.
- **`background`** — Color rendered behind the blobs (default `.black`).
- **`speed`** — Multiplier on the internal drift / stream time (default `1.0`).
- **`count`** — Number of blobs. Clamped to `1...8` in `.cluster`; in `.fountain` this is the number of small balls (the big ball is always present) and supports up to `99`.
- **`size`** — Per-ball size factor in `0...1` (default `0.8`). Larger = fatter blobs. In `.fountain` this controls the small balls only.
- **`bigSize`** — Big central ball size for the `.fountain` style, in `0...1` (default `0.85`), independent of `size`. Ignored by `.cluster`.
- **`showsControls`** — When `true`, attaches a gear `ToolbarItem` to the enclosing `NavigationStack` that opens a live-tuning sheet (Style picker, palette, Count / Size / Big Ball Size / Speed). Default `false`.

### Fountain motion & color mixing

In `.fountain`, each small ball is assigned a fixed phase offset and a coin flip (`rising` vs leaving) from a per-ball hash. Rising balls travel from below the frame (`y = 1.12`) up to the centre (`y = 0.5`) while their horizontal offset converges toward the centre, so they appear to fall *in* and merge with the big ball. Leaving balls travel from the centre (`y = 0.5`) up out the top (`y = -0.12`) while their horizontal offset spreads outward, so they fly off. A distance-to-centre term (`blend = 1 - smoothstep(0, 0.6, distToBig)`) mixes each small ball's RGB toward the big ball's RGB the closer it gets — the visible "two liquids mixing" dissolve.

## Source Code

### SWMetaballs.swift

```swift
//
//  SWMetaballs.swift
//  ShipSwift
//
//  Renders a cluster of soft blobs whose colors blend smoothly where they
//  overlap, over a flat background, via a SwiftUI Metal stitchable shader.
//  No spherical lighting / rim / specular — straight 2D shape blending.
//
//  Requires iOS 17+ / macOS 14+ (SwiftUI `ShaderLibrary`,
//  `Shader`/`ShaderFunction`, Metal `stitchable`).
//
//  Usage:
//    // Default — 5-color rainbow on black
//    ZStack {
//        SWMetaballs()
//            .ignoresSafeArea()
//        // Your content here
//    }
//
//    // Recolor — sunset palette
//    SWMetaballs(
//        colors: [.yellow, .orange, .red, .purple],
//        background: .black,
//        count: 6,
//        size: 0.7
//    )
//
//    // As a section background
//    myContent
//        .background { SWMetaballs() }
//
//    // Demo / debug — adds a gear button that opens a live-tuning sheet.
//    // Disabled by default; requires an enclosing `NavigationStack`.
//    SWMetaballs(showsControls: true)
//
//  Parameters:
//    - colors: Per-ball palette, 1–8 entries. Ball `i` picks
//              `colors[i % colors.count]`, so adding more balls than
//              colors cycles through the palette. Default is a 5-color
//              rainbow (`#CC3333`, `#CC9933`, `#99CC33`, `#33CC33`,
//              `#33CC99`).
//    - background: Color rendered behind the blobs (default `.black`).
//    - speed: Multiplier on the internal drift time (default `1.0`).
//    - count: Number of blobs, clamped to `1...8` by the shader
//              (default `5`).
//    - size: Per-ball size factor in `0...1` (default `0.83`). Larger =
//              fatter blobs.
//    - showsControls: When `true`, attaches a gear `ToolbarItem` to the
//              enclosing `NavigationStack` that opens a live-tuning
//              sheet. Default `false`.
//
//  Notes:
//    - SwiftUI shader parameters can't be arrays, so internally the
//      palette is packed into eight independent `Color` slots plus a
//      `colorsCount` scalar. Extra slots are filled with `.clear`.
//    - Loops capped at 8 balls to fit SwiftUI's stitchable shader
//      instruction budget.
//
//  Created by Wei Zhong on 5/24/26.
//

import SwiftUI

// MARK: - Style

enum SWMetaballsStyle: String, CaseIterable, Identifiable {
    /// Balls meander on independent noise drifts (the original look).
    case cluster
    /// A big central ball with small balls streaming in from the bottom and
    /// out the top.
    case fountain

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .cluster:  "Cluster"
        case .fountain: "Fountain"
        }
    }

    /// Metal `stitchable` function name in the default `ShaderLibrary`.
    var shaderName: String {
        switch self {
        case .cluster:  "swMetaballs"
        case .fountain: "swMetaballsFountain"
        }
    }
}

// MARK: - Main View

struct SWMetaballs: View {
    /// Rendering style — `.cluster` (independent noise drift) or `.fountain`
    /// (big central ball with small balls streaming in / out).
    var style: SWMetaballsStyle = .cluster

    /// Per-ball palette (1–8 entries). Ball `i` picks `colors[i % colors.count]`.
    var colors: [Color] = [Color.red,
                           Color.green,
                           Color.white,
                           Color.yellow,
                           Color.blue,
                           Color.teal,
                           Color.purple]

    /// Color rendered behind the blobs.
    var background: Color = .black

    /// Multiplier on the internal drift time.
    var speed: Float = 1.0

    /// Number of blobs (clamped to 1...8 by the shader).
    var count: Int = 8

    /// Per-ball size factor in 0...1. Larger = fatter blobs.
    var size: Float = 0.8

    /// Big central ball size for the `.fountain` style (0...1, independent of
    /// `size`). Ignored by `.cluster`.
    var bigSize: Float = 0.85

    /// When `true`, attaches a gear `ToolbarItem` that opens a live-tuning sheet.
    var showsControls: Bool = false

    var body: some View {
        if showsControls {
            SWMetaballsControlled(initial: self)
        } else {
            SWMetaballsRenderer(
                style: style,
                colors: colors,
                background: background,
                speed: speed,
                count: count,
                size: size,
                bigSize: bigSize
            )
        }
    }
}

// MARK: - Renderer (pure shader binding)

private struct SWMetaballsRenderer: View {
    let style: SWMetaballsStyle
    let colors: [Color]
    let background: Color
    let speed: Float
    let count: Int
    let size: Float
    let bigSize: Float

    @State private var start: Date = .now

    var body: some View {
        TimelineView(.animation) { ctx in
            let elapsed = Float(ctx.date.timeIntervalSince(start))
            // Pack colors into 8 fixed slots; pad with `.clear` so unused
            // slots don't contribute (they're never indexed when
            // colorsCount is correct, but premultiplied alpha keeps
            // them harmless if they ever were).
            let slots = paddedSlots(colors)
            let colorsCount = Float(max(min(colors.count, 8), 1))

            // Fountain takes one extra arg (big ball size); build the list in a
            // closure so the ViewBuilder body stays a single view expression.
            let arguments: [Shader.Argument] = {
                var a: [Shader.Argument] = [
                    .boundingRect,
                    .float(elapsed),
                    .float(speed),
                    .float(Float(count)),
                    .float(size),
                    .float(colorsCount),
                    .color(slots[0]),
                    .color(slots[1]),
                    .color(slots[2]),
                    .color(slots[3]),
                    .color(slots[4]),
                    .color(slots[5]),
                    .color(slots[6]),
                    .color(slots[7]),
                    .color(background)
                ]
                if style == .fountain {
                    a.append(.float(bigSize))
                }
                return a
            }()

            background
                .colorEffect(
                    Shader(
                        function: ShaderFunction(library: .default, name: style.shaderName),
                        arguments: arguments
                    )
                )
        }
    }

    private func paddedSlots(_ src: [Color]) -> [Color] {
        var out = Array(src.prefix(8))
        while out.count < 8 {
            out.append(.clear)
        }
        return out
    }
}

// MARK: - Controlled Wrapper (gear toolbar item + live sheet)

private struct SWMetaballsControlled: View {
    @State private var style: SWMetaballsStyle
    @State private var colors: [Color]
    @State private var background: Color
    @State private var speed: Float
    /// Float-backed so it can drive a Slider; rendered as `Int(.rounded())`.
    @State private var count: Float
    @State private var size: Float
    @State private var bigSize: Float

    @State private var showSheet = false

    init(initial: SWMetaballs) {
        // Pad up to a stable 5-slot working set for the picker UI so the
        // sliders don't shuffle when the palette length changes.
        var palette = initial.colors
        while palette.count < 5 { palette.append(.white) }
        _style      = State(initialValue: initial.style)
        _colors     = State(initialValue: palette)
        _background = State(initialValue: initial.background)
        _speed      = State(initialValue: initial.speed)
        _count      = State(initialValue: Float(initial.count))
        _size       = State(initialValue: initial.size)
        _bigSize    = State(initialValue: initial.bigSize)
    }

    var body: some View {
        SWMetaballsRenderer(
            style: style,
            colors: colors,
            background: background,
            speed: speed,
            count: Int(count.rounded()),
            size: size,
            bigSize: bigSize
        )
        .ignoresSafeArea()
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    showSheet = true
                } label: {
                    Image(systemName: "slider.horizontal.3")
                }
                .accessibilityLabel("Metaballs Controls")
            }
        }
        .sheet(isPresented: $showSheet) {
            SWMetaballsControlsSheet(
                style: $style,
                colors: $colors,
                background: $background,
                speed: $speed,
                count: $count,
                size: $size,
                bigSize: $bigSize
            )
            .presentationDetents([.medium])
            .presentationDragIndicator(.visible)
        }
    }
}

// MARK: - Controls Sheet

private struct SWMetaballsControlsSheet: View {
    @Binding var style: SWMetaballsStyle
    @Binding var colors: [Color]
    @Binding var background: Color
    @Binding var speed: Float
    @Binding var count: Float
    @Binding var size: Float
    @Binding var bigSize: Float

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section("Style") {
                    Picker("Style", selection: $style) {
                        ForEach(SWMetaballsStyle.allCases) { s in
                            Text(s.displayName).tag(s)
                        }
                    }
                }

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
                    ColorPicker("Background", selection: $background, supportsOpacity: false)
                }

                Section("Field") {
                    SliderRow(label: "Count", value: $count, range: style == .fountain ? 1...99 : 1...8, step: 1)
                    SliderRow(label: "Size",  value: $size,  range: 0...1, step: 0.01)
                    if style == .fountain {
                        SliderRow(label: "Big Ball Size", value: $bigSize, range: 0...1, step: 0.01)
                    }
                }

                Section("Motion") {
                    SliderRow(label: "Speed", value: $speed, range: 0...3, step: 0.05)
                }
            }
            .navigationTitle("Metaballs")
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

    /// Integer-stepped sliders display as whole numbers.
    private var formattedValue: String {
        step >= 1
            ? "\(Int(value.rounded()))"
            : String(format: "%.2f", value)
    }
}

// MARK: - Preview

#Preview {
    // ToolbarItem requires an enclosing NavigationStack to render.
    NavigationStack {
        SWMetaballs(showsControls: true)
    }
}
```

### SWMetaballs.metal

```metal
//
//  SWMetaballs.metal
//  ShipSwift
//
//  Stitchable SwiftUI color effect that renders a cluster of metaballs.
//  Each blob is a radial power-of-distance shape; per-ball shapes are
//  summed and a smoothstep threshold carves the final silhouette. Color
//  is the shape-weighted average of the per-ball colors, composited over
//  `background`.
//
//  Paired with: SWMetaballs.swift
//  Entry point: `swMetaballs` — invoked via SwiftUI `.colorEffect(...)`.
//
//  Requires iOS 17+ / macOS 14+.
//

#include <metal_stdlib>
#include <SwiftUI/SwiftUI_Metal.h>
using namespace metal;

// 1D hash + smoothstep noise — avoids binding an auxiliary noise texture.
// Produces a smooth pseudo-random scalar in [0, 1] so the per-ball drift
// is continuous in time.
static float swMetaballsHash1(float x) {
    return fract(sin(x * 12.9898) * 43758.5453);
}

static float swMetaballsNoise1(float x) {
    float i = floor(x);
    float f = fract(x);
    float u = f * f * (3.0 - 2.0 * f);
    return mix(swMetaballsHash1(i), swMetaballsHash1(i + 1.0), u);
}

// Radial power-of-distance shape, 0..1.
// `aspectScale` rescales the (uv - c) difference so 1 unit on each axis
// corresponds to the same on-screen distance: keeps the blob round on
// portrait / landscape viewports instead of stretching with the frame.
static float swMetaballsBallShape(float2 uv, float2 c, float p, float2 aspectScale) {
    float2 diff = (uv - c) * aspectScale;
    float s = 0.5 * length(diff);
    s = 1.0 - saturate(s);
    return pow(s, p);
}

[[ stitchable ]] half4 swMetaballs(float2 position,
                                   half4  inColor,
                                   float4 boundingRect,
                                   float  time,
                                   float  speed,
                                   float  count,
                                   float  size,
                                   float  colorsCount,
                                   half4  color1,
                                   half4  color2,
                                   half4  color3,
                                   half4  color4,
                                   half4  color5,
                                   half4  color6,
                                   half4  color7,
                                   half4  color8,
                                   half4  background) {
    float2 sz = boundingRect.zw;
    // Map the bounding rect to 0..1 in pixel space — divide the position
    // by the bounding rect.
    float2 shape_uv = position / max(sz, float2(1.0));
    // `aspectScale` lets `length()` measure visually equal distances on
    // both axes — divide pixels by the short side, so the short axis
    // scales to 1 and the long axis scales above 1.
    float minDim = max(min(sz.x, sz.y), 1.0);
    float2 aspectScale = sz / minDim;

    // Offset time by 2503.4 in the first frame so the cluster doesn't
    // start in a "uniform initial state". `speed` is exposed here as a
    // wrapper-side multiplier on top of the internal 0.2 factor.
    const float firstFrameOffset = 2503.4;
    float t = 0.2 * (time * speed + firstFrameOffset);

    // Pack the 8 color slots so the loop can index by ball.
    half4 colors[8] = { color1, color2, color3, color4,
                        color5, color6, color7, color8 };
    int colorsCountInt = max(int(colorsCount + 0.5), 1);

    // Unrolled to 8 iterations to fit SwiftUI's stitchable color shaders'
    // instruction budget. `count` is exposed as a float so the wrapper can
    // fractional-fade the last ball in / out via `fract(count)`.
    float countClamped = min(max(count, 1.0), 8.0);
    int countCeil = int(ceil(countClamped));

    float3 totalColor = float3(0.0);
    float  totalShape = 0.0;

    for (int i = 0; i < 8; i++) {
        if (i >= countCeil) break;

        // Per-ball drift — two 1D noise samples placed on a circle so
        // each ball gets an independent, slowly meandering position.
        float idxFract = float(i) / 20.0;
        float angle = 6.2831853 * idxFract;
        float spd = 1.0 - 0.2 * idxFract;
        float noiseX = swMetaballsNoise1(angle * 10.0 + float(i) + t * spd);
        float noiseY = swMetaballsNoise1(angle * 20.0 + float(i) - t * spd);
        float2 pos = float2(0.5) + 1e-4 + 0.9 * (float2(noiseX, noiseY) - 0.5);

        // Pick color by `i % colorsCount` so adding balls beyond the
        // color count cycles through the palette.
        int safeIdx = i % colorsCountInt;
        half4 ballColor = colors[safeIdx];
        // Premultiply alpha — the summation assumes premultiplied color
        // contributions.
        float3 rgb = float3(ballColor.rgb) * float(ballColor.a);

        // Fractional last-ball fade: when `count` isn't a whole number,
        // shrink the last ball by `fract(count)` so it grows in.
        float sizeFrac = 1.0;
        if (float(i) > floor(countClamped - 1.0)) {
            sizeFrac *= fract(countClamped);
        }

        float p = 45.0 - 30.0 * size * sizeFrac;
        float shape = swMetaballsBallShape(shape_uv, pos, p, aspectScale);
        shape *= pow(size, 0.2);
        shape = smoothstep(0.0, 1.0, shape);

        totalColor += rgb * shape;
        totalShape += shape;
    }

    // Shape-weighted average — gives each blob its own hue while the
    // overlaps blend smoothly.
    totalColor /= max(totalShape, 1e-4);

    // Use `fwidth(totalShape)` for an anti-aliased edge. Metal's `fwidth`
    // works inside fragment-shader-style stitchables — fall back to a
    // small constant if the compile target rejects it.
    float edge_width = fwidth(totalShape);
    float finalShape = smoothstep(0.4, 0.4 + edge_width, totalShape);

    float3 color = totalColor * finalShape +
                   float3(background.rgb) * (1.0 - finalShape);

    return half4(half3(color), 1.0);
}

// MARK: - Fountain

// A large central ball with small balls streaming vertically: roughly half
// rise from the bottom and converge into the big ball, the other half leave
// the big ball and spread upward out of frame. Because all shapes are summed
// before the threshold, a small ball melts into a teardrop bridge as it nears
// the big ball (the metaball "merge"), then separates again as it travels.
// Reuses the same parameter signature as `swMetaballs`:
//   count = number of small balls (1...7, big ball is always present)
//   size  = ball fatness, speed = stream speed, colors = palette
//           (colors[0] paints the big ball, the rest cycle over small balls).
[[ stitchable ]] half4 swMetaballsFountain(float2 position,
                                           half4  inColor,
                                           float4 boundingRect,
                                           float  time,
                                           float  speed,
                                           float  count,
                                           float  size,
                                           float  colorsCount,
                                           half4  color1,
                                           half4  color2,
                                           half4  color3,
                                           half4  color4,
                                           half4  color5,
                                           half4  color6,
                                           half4  color7,
                                           half4  color8,
                                           half4  background,
                                           float  bigSize) {
    float2 sz = boundingRect.zw;
    float2 shape_uv = position / max(sz, float2(1.0));
    float minDim = max(min(sz.x, sz.y), 1.0);
    float2 aspectScale = sz / minDim;

    float t = time * speed;

    half4 colors[8] = { color1, color2, color3, color4,
                        color5, color6, color7, color8 };
    int colorsCountInt = max(int(colorsCount + 0.5), 1);

    float3 totalColor = float3(0.0);
    float  totalShape = 0.0;

    // --- Big central ball (always present, painted with colors[0]) ---
    // Small power = large, soft ball. `bigSize` is independent of `size`.
    // Wide range so `bigSize` can grow the big ball much larger.
    float bigP = 18.0 - 15.0 * bigSize;
    float bigShape = swMetaballsBallShape(shape_uv, float2(0.5, 0.5), bigP, aspectScale);
    bigShape = smoothstep(0.0, 1.0, bigShape);
    half4  bigColor = colors[0];
    float3 bigRGB   = float3(bigColor.rgb) * float(bigColor.a);
    totalColor += bigRGB * bigShape;
    totalShape += bigShape;

    // --- Small balls streaming in / out ---
    // Large power = small, crisp balls. Wide range so `size` can go very tiny.
    float smallP = 100.0 - 70.0 * size;
    int n = max(min(int(count + 0.5), 99), 1);
    for (int i = 0; i < 99; i++) {
        if (i >= n) break;
        float fi = float(i);

        float h1 = swMetaballsHash1(fi + 1.0);    // per-ball phase offset
        float h2 = swMetaballsHash1(fi + 7.3);    // horizontal spread
        bool  rising = (int(h1 * 17.0) % 2 == 0); // ~half rise, half leave
        float xj = (h2 - 0.5) * 0.55;             // lateral offset at the far end

        float phase = fract(t * 0.22 + h1);       // 0..1 travel loop

        float2 pos;
        float fade;
        if (rising) {
            // bottom (y = 1.12) -> centre (y = 0.5), x converges to centre.
            float y = mix(1.12, 0.5, phase);
            float x = 0.5 + xj * (1.0 - phase);
            pos = float2(x, y);
            fade = smoothstep(0.0, 0.18, phase);  // fade in from bottom, stay as it merges
        } else {
            // centre (y = 0.5) -> top (y = -0.12), x spreads outward.
            float y = mix(0.5, -0.12, phase);
            float x = 0.5 + xj * phase;
            pos = float2(x, y);
            fade = smoothstep(0.0, 0.12, phase) * (1.0 - smoothstep(0.72, 1.0, phase));
        }

        float shape = swMetaballsBallShape(shape_uv, pos, smallP, aspectScale);
        shape = smoothstep(0.0, 1.0, shape) * fade;

        int safeIdx = (i + 1) % colorsCountInt;
        half4 bc = colors[safeIdx];
        float3 rgb = float3(bc.rgb) * float(bc.a);
        // Dissolve into the big ball: the nearer a small ball is to the centre,
        // the more its color is blended toward the big ball's, so it mixes in
        // like two liquids instead of staying a distinct dot.
        float distToBig = length((pos - float2(0.5)) * aspectScale);
        float blend = 1.0 - smoothstep(0.0, 0.6, distToBig);
        rgb = mix(rgb, bigRGB, blend);
        totalColor += rgb * shape;
        totalShape += shape;
    }

    totalColor /= max(totalShape, 1e-4);

    float edge_width = fwidth(totalShape);
    float finalShape = smoothstep(0.4, 0.4 + edge_width, totalShape);

    float3 color = totalColor * finalShape +
                   float3(background.rgb) * (1.0 - finalShape);

    return half4(half3(color), 1.0);
}
```
