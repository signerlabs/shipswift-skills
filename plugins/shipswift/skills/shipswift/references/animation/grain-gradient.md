---
id: animation-grain-gradient
title: Grain Gradient
description: Soft tri-color noise gradient with film grain rendered via a SwiftUI Metal stitchable shader — two slowly drifting low-frequency value-noise samples blend three colors, and a per-frame high-frequency hash adds film grain
tier: free
tags: [animation, metal, shader, gradient, grain, background, SwiftUI]
---

## Overview

Full-screen soft gradient with film grain, rendered through SwiftUI's `colorEffect` Metal pipeline — the poster-style hero background that reads as designed rather than flat. Two low-frequency value-noise samples, offset and scaled differently so they drift independently, drive the two blend weights between three user colors; a contrast exponent shapes those weights from a smooth pastel field to sharper color zones. A high-frequency hash on the raw pixel position, shifted every frame, adds grain that shimmers like real film and stays the same size at any noise scale.

Requires iOS 18+ / macOS 15+.

## File Layout

```
SWAnimation/SWMetal/
  SWGrainGradient.swift     // SwiftUI view + optional live-tuning sheet
  SWGrainGradient.metal     // [[ stitchable ]] swGrainGradient entry point
```

## Source Code

### SWGrainGradient.swift

```swift
import SwiftUI

// MARK: - Main View

struct SWGrainGradient: View {
    /// First color, dominant in low-weight regions.
    var color1: Color = Color(red: 1.0,   green: 0.702, blue: 0.502) // #FFB380

    /// Second color, mixed in by the first noise sample.
    var color2: Color = Color(red: 0.702, green: 0.6,   blue: 1.0)   // #B399FF

    /// Third color, mixed in by the second noise sample.
    var color3: Color = Color(red: 1.0,   green: 0.502, blue: 0.6)   // #FF8099

    /// Multiplier on the internal drift time.
    var speed: Float = 1.0

    /// Spatial scale of the noise field.
    var scale: Float = 1.2

    /// Amplitude of the per-frame film grain.
    var grain: Float = 0.06

    /// Gamma exponent on the noise blend weights.
    var contrast: Float = 1.0

    /// When `true`, attaches a gear `ToolbarItem` that opens a live-tuning sheet.
    var showsControls: Bool = false

    var body: some View {
        if showsControls {
            SWGrainGradientControlled(initial: self)
        } else {
            SWGrainGradientRenderer(
                color1: color1,
                color2: color2,
                color3: color3,
                speed: speed,
                scale: scale,
                grain: grain,
                contrast: contrast
            )
        }
    }
}

// MARK: - Renderer (pure shader binding)

private struct SWGrainGradientRenderer: View {
    let color1: Color
    let color2: Color
    let color3: Color
    let speed: Float
    let scale: Float
    let grain: Float
    let contrast: Float

    @State private var start: Date = .now

    var body: some View {
        TimelineView(.animation) { ctx in
            let elapsed = Float(ctx.date.timeIntervalSince(start))
            // Base layer is `color1` so the first frame matches the gradient
            // tone before the shader runs — avoids any black flash.
            color1
                .colorEffect(
                    ShaderLibrary.swGrainGradient(
                        .boundingRect,
                        .float(elapsed),
                        .float(speed),
                        .float(scale),
                        .float(grain),
                        .float(contrast),
                        .color(color1),
                        .color(color2),
                        .color(color3)
                    )
                )
        }
    }
}

// MARK: - Controlled Wrapper (gear toolbar item + live sheet)

private struct SWGrainGradientControlled: View {
    @State private var color1: Color
    @State private var color2: Color
    @State private var color3: Color
    @State private var speed: Float
    @State private var scale: Float
    @State private var grain: Float
    @State private var contrast: Float

    @State private var showSheet = false

    init(initial: SWGrainGradient) {
        _color1   = State(initialValue: initial.color1)
        _color2   = State(initialValue: initial.color2)
        _color3   = State(initialValue: initial.color3)
        _speed    = State(initialValue: initial.speed)
        _scale    = State(initialValue: initial.scale)
        _grain    = State(initialValue: initial.grain)
        _contrast = State(initialValue: initial.contrast)
    }

    var body: some View {
        SWGrainGradientRenderer(
            color1: color1,
            color2: color2,
            color3: color3,
            speed: speed,
            scale: scale,
            grain: grain,
            contrast: contrast
        )
        .ignoresSafeArea()
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    showSheet = true
                } label: {
                    Image(systemName: "slider.horizontal.3")
                }
                .accessibilityLabel("Grain Gradient Controls")
            }
        }
        .sheet(isPresented: $showSheet) {
            SWGrainGradientControlsSheet(
                color1: $color1,
                color2: $color2,
                color3: $color3,
                speed: $speed,
                scale: $scale,
                grain: $grain,
                contrast: $contrast
            )
            .presentationDetents([.medium])
            .presentationDragIndicator(.visible)
        }
    }
}

// MARK: - Controls Sheet

private struct SWGrainGradientControlsSheet: View {
    @Binding var color1: Color
    @Binding var color2: Color
    @Binding var color3: Color
    @Binding var speed: Float
    @Binding var scale: Float
    @Binding var grain: Float
    @Binding var contrast: Float

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section("Colors") {
                    ColorPicker("Color 1", selection: $color1, supportsOpacity: false)
                    ColorPicker("Color 2", selection: $color2, supportsOpacity: false)
                    ColorPicker("Color 3", selection: $color3, supportsOpacity: false)
                }

                Section("Field") {
                    SWGrainGradientSliderRow(label: "Scale",    value: $scale,    range: 0.2...5,   step: 0.05)
                    SWGrainGradientSliderRow(label: "Grain",    value: $grain,    range: 0...0.3,   step: 0.005)
                    SWGrainGradientSliderRow(label: "Contrast", value: $contrast, range: 0.1...4,   step: 0.05)
                }

                Section("Motion") {
                    SWGrainGradientSliderRow(label: "Speed", value: $speed, range: 0...3, step: 0.05)
                }
            }
            .navigationTitle("Grain Gradient")
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

private struct SWGrainGradientSliderRow: View {
    let label: String
    @Binding var value: Float
    let range: ClosedRange<Float>
    let step: Float

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(label)
                Spacer()
                Text(String(format: "%.3f", value))
                    .font(.callout.monospacedDigit())
                    .foregroundStyle(.secondary)
            }
            Slider(value: $value, in: range, step: step)
        }
    }
}
```

### SWGrainGradient.metal

```metal
#include <metal_stdlib>
#include <SwiftUI/SwiftUI_Metal.h>
using namespace metal;

static float swGrainGradientHash21(float2 p) {
    p = fract(p * float2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

// Bilinear value noise with smoothstep interpolation.
static float swGrainGradientVNoise(float2 p) {
    float2 i = floor(p);
    float2 f = fract(p);
    float2 u = f * f * (3.0 - 2.0 * f);
    float a = swGrainGradientHash21(i);
    float b = swGrainGradientHash21(i + float2(1.0, 0.0));
    float c = swGrainGradientHash21(i + float2(0.0, 1.0));
    float d = swGrainGradientHash21(i + float2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

[[ stitchable ]] half4 swGrainGradient(float2 position,
                                       half4  color,
                                       float4 boundingRect,
                                       float  time,
                                       float  speed,
                                       float  scale,
                                       float  grain,
                                       float  contrast,
                                       half4  color1,
                                       half4  color2,
                                       half4  color3) {
    float2 size = boundingRect.zw;
    // Normalized coords (0..1), then scaled for the noise sampler.
    float2 uv = position / max(min(size.x, size.y), 1.0);
    float2 ap = uv * max(scale, 0.0001);

    // Time is slowed by 0.15 — grain gradients are meant to drift, not flow.
    float t = time * speed * 0.15;

    // Two low-frequency samples drive the two blend weights between the
    // three colors. Different offsets / scales decouple them so the field
    // doesn't collapse into a single direction of motion.
    float n1 = swGrainGradientVNoise(ap         + float2( t,         t * 0.6));
    float n2 = swGrainGradientVNoise(ap * 0.7   + float2(-t * 0.4,   t * 0.3) + 17.0);

    // Contrast-shape each weight before blending so the user can compress
    // colors toward one dominant tone or open them up.
    float w1 = clamp(pow(n1, max(contrast, 0.001)), 0.0, 1.0);
    float w2 = clamp(pow(n2, max(contrast, 0.001)), 0.0, 1.0);

    float3 c1 = float3(color1.rgb);
    float3 c2 = float3(color2.rgb);
    float3 c3 = float3(color3.rgb);

    float3 col = mix(c1, c2, w1);
    col        = mix(col, c3, w2);

    // Film grain — high-frequency hash on raw pixel position (independent
    // of `scale`) shifted per-frame so the grain shimmers like actual film.
    // Centered around 0 so it adds equally to highlights and shadows.
    // The per-frame shift is wrapped: an unbounded `time * 60` grows past
    // float precision inside the hash's `fract(p * 456.21)` within minutes,
    // and the grain collapses into flat / banded patterns.
    float g = swGrainGradientHash21(position * 0.5 + fmod(time * 60.0, 256.0)) - 0.5;
    col    += g * grain;

    return half4(half3(col), 1.0);
}
```

## Usage

```swift
// Default — warm peach / lilac / rose gradient, full-screen
ZStack {
    SWGrainGradient()
        .ignoresSafeArea()
    // Your content here
}

// Recolor — cool mint
SWGrainGradient(
    color1: .teal,
    color2: .green,
    color3: .mint
)

// As a hero background
heroContent
    .background { SWGrainGradient() }

// Clean gradient (no grain), sharper color zones
SWGrainGradient(grain: 0, contrast: 2.0)

// Demo / debug — gear button opens a live-tuning sheet.
// Requires an enclosing NavigationStack.
NavigationStack {
    SWGrainGradient(showsControls: true)
}
```

## Parameters

| Parameter | Type | Default | Range | Notes |
|---|---|---|---|---|
| `color1` | `Color` | `#FFB380` (warm peach) | — | Base color, dominant where both noise weights are low |
| `color2` | `Color` | `#B399FF` (soft lilac) | — | Mixed in by the first noise sample |
| `color3` | `Color` | `#FF8099` (rose) | — | Mixed in by the second noise sample |
| `speed` | `Float` | `1.0` | 0…3 | Multiplier on the drift time (internally slowed by 0.15) |
| `scale` | `Float` | `1.2` | 0.2…5 | Spatial scale of the noise field — higher = smaller, more numerous color cells |
| `grain` | `Float` | `0.06` | 0…0.3 | Film-grain amplitude — `0` = clean gradient, `0.1` ≈ noticeable, `0.2` = chunky photo grain |
| `contrast` | `Float` | `1.0` | 0.1…4 | Exponent on the blend weights — higher = sharper color transitions, lower = smoother pastel field |
| `showsControls` | `Bool` | `false` | — | Demo-only gear ToolbarItem; requires an enclosing `NavigationStack` |

## Integration Checklist

1. Copy `SWGrainGradient.swift` and `SWGrainGradient.metal` into your Xcode target; the `.metal` file is compiled into the default `ShaderLibrary` automatically.
2. Confirm the deployment target is iOS 18+ / macOS 15+.
3. Use it as a `ZStack` background with `.ignoresSafeArea()` for full-bleed, or inside `.background { }` behind a hero section.
4. Pick three colors close in lightness for the soft poster look; widely different colors read as blotches, so lower `contrast` if that happens.
5. Keep text legible on top: the field drifts, so test your foreground against every region of the gradient (or add a scrim).

## Notes / Gotchas

- **Grain is in pixel space.** The grain hash uses the raw pixel position, not the scaled noise coordinates, so the grain stays film-sized at any `scale` and on any screen size.
- **The per-frame grain shift is wrapped.** The hash input adds `fmod(time * 60.0, 256.0)`. An unbounded `time * 60` grows past float precision inside the hash within minutes and the grain collapses into flat or banded patterns; keep the wrap if you edit the shader.
- **Square cells on any aspect ratio.** Positions are normalized by the shorter side of the bounding rect, so color cells don't stretch on wide or tall views.
- **The output is opaque.** The shader returns alpha `1`, and the base layer is `color1`, so the first frame already matches the gradient tone — no black flash before the shader runs.
- **Cheap per pixel.** Two value-noise samples plus one hash per pixel — far lighter than the FBM-based backgrounds — so a full-screen instance is fine.
- The argument order in the `.colorEffect` call **must** match the Metal `swGrainGradient` signature exactly: `boundingRect, time, speed, scale, grain, contrast, color1, color2, color3`.
- When `showsControls` is `true`, the gear button is a native `ToolbarItem` — the call site must be inside a `NavigationStack`.
