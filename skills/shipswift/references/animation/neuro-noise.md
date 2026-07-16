---
id: animation-neuro-noise
title: Neuro Noise
description: Glowing neural-web procedural background — 15-iteration sine/cosine accumulation with rotated UV creates an organic web of fluid lines and soft intersections, 3-color palette
tier: free
tags: [animation, metal, shader, SwiftUI]
---

## Overview

Programmatic background of glowing fluid lines and soft intersections, rendered through SwiftUI's `colorEffect`. 15 iterations of rotated UV + scale-doubling sine/cosine accumulation produce the organic web look. Front / mid / back 3-color palette + brightness, contrast, and pattern scale controls.

Requires iOS 17+ / macOS 14+ (SwiftUI `ShaderLibrary` / `Shader` / Metal `stitchable`).

## File Layout

```
SWAnimation/SWMetal/
  SWNeuroNoise.swift
  SWNeuroNoise.metal
```

## Source Code

### SWNeuroNoise.swift

```swift
//
//  SWNeuroNoise.swift
//  ShipSwift
//
//  A SwiftUI Metal `colorEffect`. Generates a glowing web-like
//  structure of fluid lines and soft intersections — atmospheric,
//  organic-yet-futuristic.
//
//  Algorithm: 15 iterations of rotated UV + scale-doubling sine/cosine
//  accumulation.
//
//  Requires iOS 17+ / macOS 14+ (SwiftUI `ShaderLibrary`,
//  `Shader`/`ShaderFunction`, Metal `stitchable`).
//
//  Usage:
//    // Default — cyan glow on near-black, full-screen
//    SWNeuroNoise()
//        .ignoresSafeArea()
//
//    // Recolor — magenta web
//    SWNeuroNoise(
//        colorFront: .white,
//        colorMid:   .purple,
//        colorBack:  .black
//    )
//
//    // As a section background
//    myContent.background { SWNeuroNoise() }
//
//    // Demo / debug — adds a gear button that opens a live-tuning sheet.
//    // Requires an enclosing `NavigationStack`.
//    SWNeuroNoise(showsControls: true)
//
//  Parameters:
//    - colorFront: Highlight color of the brightest crossings
//                  (default `.white`).
//    - colorMid: Main web color (default cyan `#56CDE3`).
//    - colorBack: Background color (default near-black `#050519`).
//    - speed: Multiplier on the internal animation time (default `1.0`).
//    - brightness: Luminosity of the crossing points in `0...1`
//                  (default `0.5`).
//    - contrast: Sharpness of the bright-dark transition in `0...1`
//                (default `0.5`).
//    - showsControls: Attach a gear `ToolbarItem` that opens a
//                     live-tuning sheet (default `false`).
//
//  Created by Wei Zhong on 5/25/26.
//

import SwiftUI

// MARK: - Main View

struct SWNeuroNoise: View {
    /// Highlight color of the brightest crossings.
    var colorFront: Color = .white

    /// Main web color.
    var colorMid: Color = Color(red: 0.337, green: 0.804, blue: 0.890) // #56CDE3 cyan

    /// Background color.
    var colorBack: Color = Color(red: 0.02, green: 0.02, blue: 0.10)   // #050519 near-black

    /// Multiplier on the internal animation time.
    var speed: Float = 1.0

    /// Luminosity of the crossing points in 0...1.
    var brightness: Float = 0.5

    /// Sharpness of the bright-dark transition in 0...1.
    var contrast: Float = 0.5

    /// Pattern zoom in 0.05...1 — small = features fill the screen
    /// (zoomed-in), large = more cycles per pixel (zoomed-out).
    var scale: Float = 0.8

    /// When `true`, attaches a gear `ToolbarItem` that opens a live-tuning sheet.
    var showsControls: Bool = false

    var body: some View {
        if showsControls {
            SWNeuroNoiseControlled(initial: self)
        } else {
            SWNeuroNoiseRenderer(
                colorFront: colorFront,
                colorMid: colorMid,
                colorBack: colorBack,
                speed: speed,
                brightness: brightness,
                contrast: contrast,
                scale: scale
            )
        }
    }
}

// MARK: - Renderer

private struct SWNeuroNoiseRenderer: View {
    let colorFront: Color
    let colorMid: Color
    let colorBack: Color
    let speed: Float
    let brightness: Float
    let contrast: Float
    let scale: Float

    @State private var start: Date = .now

    var body: some View {
        TimelineView(.animation) { ctx in
            let elapsed = Float(ctx.date.timeIntervalSince(start))
            // Base layer is `colorBack` so the first frame looks right
            // before TimelineView starts ticking.
            colorBack
                .colorEffect(
                    ShaderLibrary.swNeuroNoise(
                        .boundingRect,
                        .float(elapsed),
                        .float(speed),
                        .float(brightness),
                        .float(contrast),
                        .float(scale),
                        .color(colorFront),
                        .color(colorMid),
                        .color(colorBack)
                    )
                )
        }
    }
}

// MARK: - Controlled Wrapper (gear toolbar item + live sheet)

private struct SWNeuroNoiseControlled: View {
    @State private var colorFront: Color
    @State private var colorMid: Color
    @State private var colorBack: Color
    @State private var speed: Float
    @State private var brightness: Float
    @State private var contrast: Float
    @State private var scale: Float

    @State private var showSheet = false

    init(initial: SWNeuroNoise) {
        _colorFront = State(initialValue: initial.colorFront)
        _colorMid   = State(initialValue: initial.colorMid)
        _colorBack  = State(initialValue: initial.colorBack)
        _speed      = State(initialValue: initial.speed)
        _brightness = State(initialValue: initial.brightness)
        _contrast   = State(initialValue: initial.contrast)
        _scale      = State(initialValue: initial.scale)
    }

    var body: some View {
        SWNeuroNoiseRenderer(
            colorFront: colorFront,
            colorMid: colorMid,
            colorBack: colorBack,
            speed: speed,
            brightness: brightness,
            contrast: contrast,
            scale: scale
        )
        .ignoresSafeArea()
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    showSheet = true
                } label: {
                    Image(systemName: "slider.horizontal.3")
                }
                .accessibilityLabel("Neuro Noise Controls")
            }
        }
        .sheet(isPresented: $showSheet) {
            SWNeuroNoiseControlsSheet(
                colorFront: $colorFront,
                colorMid: $colorMid,
                colorBack: $colorBack,
                speed: $speed,
                brightness: $brightness,
                contrast: $contrast,
                scale: $scale
            )
            .presentationDetents([.medium, .large])
            .presentationDragIndicator(.visible)
        }
    }
}

// MARK: - Controls Sheet

private struct SWNeuroNoiseControlsSheet: View {
    @Binding var colorFront: Color
    @Binding var colorMid: Color
    @Binding var colorBack: Color
    @Binding var speed: Float
    @Binding var brightness: Float
    @Binding var contrast: Float
    @Binding var scale: Float

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section("Colors") {
                    ColorPicker("Front",     selection: $colorFront, supportsOpacity: false)
                    ColorPicker("Mid (web)", selection: $colorMid,   supportsOpacity: false)
                    ColorPicker("Back",      selection: $colorBack,  supportsOpacity: false)
                }

                Section("Field") {
                    SliderRow(label: "Scale",      value: $scale,      range: 0.05...1, step: 0.01)
                    SliderRow(label: "Brightness", value: $brightness, range: 0...1,    step: 0.01)
                    SliderRow(label: "Contrast",   value: $contrast,   range: 0...1,    step: 0.01)
                }

                Section("Motion") {
                    SliderRow(label: "Speed", value: $speed, range: 0...3, step: 0.05)
                }
            }
            .navigationTitle("Neuro Noise")
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
        SWNeuroNoise(showsControls: true)
    }
}

#Preview("Magenta web") {
    SWNeuroNoise(
        colorFront: .white,
        colorMid: .purple,
        colorBack: .black
    )
    .ignoresSafeArea()
}
```

### SWNeuroNoise.metal

```metal
//
//  SWNeuroNoise.metal
//  ShipSwift
//
//  Stitchable SwiftUI colorEffect. A glowing web-like structure of
//  fluid lines and soft intersections, generated by iteratively
//  rotating UV + scale and accumulating sine/cosine waves.
//
//  Paired with: SWNeuroNoise.swift
//  Entry point: `swNeuroNoise` — invoked via SwiftUI `.colorEffect(...)`.
//  Requires iOS 17+ / macOS 14+.
//

#include <metal_stdlib>
#include <SwiftUI/SwiftUI_Metal.h>
using namespace metal;

// 2D rotation by 1 radian (`rotate(uv, 1.0)` baked in for speed).
static float2 swNN_rotate1(float2 p) {
    const float c = 0.5403023058681398;  // cos(1)
    const float s = 0.8414709848078965;  // sin(1)
    return float2(c * p.x - s * p.y, s * p.x + c * p.y);
}

// `neuroShape` — 15 layers of iteratively rotated, scale-doubling
// sine/cosine accumulation. The sine accumulator threads "memory" of the
// previous layer into the next, producing the organic web look.
static float swNN_neuroShape(float2 uv, float t) {
    float2 sineAcc = float2(0.0);
    float2 res = float2(0.0);
    float scale = 8.0;

    for (int j = 0; j < 15; j++) {
        uv      = swNN_rotate1(uv);
        sineAcc = swNN_rotate1(sineAcc);
        float2 layer = uv * scale + float(j) + sineAcc - t;
        sineAcc += sin(layer);
        res += (0.5 + 0.5 * cos(layer)) / scale;
        scale *= 1.2;
    }
    return res.x + res.y;
}

[[ stitchable ]] half4 swNeuroNoise(float2 position,
                                    half4  color,
                                    float4 boundingRect,
                                    float  time,
                                    float  speed,
                                    float  brightness,   // 0..1
                                    float  contrast,     // 0..1
                                    float  scale,        // 0.05..1 — small = zoomed-in, large = zoomed-out
                                    half4  colorFront,
                                    half4  colorMid,
                                    half4  colorBack) {
    float2 sz = boundingRect.zw;
    float  minDim = max(min(sz.x, sz.y), 1.0);
    // Center-anchored, aspect-preserved pattern UV.
    float2 uv = (position - 0.5 * sz) / minDim;
    // Pattern zoom — small = features fill screen, large = zoom-out (more cycles per pixel).
    uv *= max(scale, 1e-4);

    float t = 0.5 * speed * time;
    float noise = swNN_neuroShape(uv, t);

    // Brightness / contrast curve.
    noise = (1.0 + saturate(brightness)) * noise * noise;
    noise = pow(noise, 0.7 + 6.0 * saturate(contrast));
    noise = min(1.4, noise);

    float blend = smoothstep(0.7, 1.4, noise);

    // Premultiply alpha for blending.
    float3 frontRGB = float3(colorFront.rgb) * float(colorFront.a);
    float3 midRGB   = float3(colorMid.rgb)   * float(colorMid.a);
    float  frontA   = float(colorFront.a);
    float  midA     = float(colorMid.a);

    float3 blendRGB = mix(midRGB,   frontRGB, blend);
    float  blendA   = mix(midA,     frontA,   blend);

    float safeNoise = max(noise, 0.0);
    float3 col = blendRGB * safeNoise;
    float  opacity = saturate(blendA * safeNoise);

    float3 backRGB = float3(colorBack.rgb) * float(colorBack.a);
    col = col + backRGB * (1.0 - opacity);

    return half4(half3(col), 1.0);
}
```
