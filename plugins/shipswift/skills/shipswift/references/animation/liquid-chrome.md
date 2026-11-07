---
id: animation-liquid-chrome
title: Liquid Chrome
description: Animated liquid chrome surface rendered via a SwiftUI Metal stitchable shader, with three sequentially domain-warped value-noise samples, a gamma-shaped chrome curve, and high-power specular glints
tier: free
tags: [animation, metal, shader, chrome, metal, background, SwiftUI]
---

## Overview

Full-screen animated polished-metal surface rendered through SwiftUI's `colorEffect` Metal pipeline. Three sequentially domain-warped value-noise samples produce a fluid metallic flow; the third sample drives a gamma-shaped chrome curve plus a high-power specular glint. Four user-tunable colors define the shadow / silver / highlight / accent ramp, and a baked-in cool spec tint always reads as polished metal.

Requires iOS 18+ / macOS 15+.

## File Layout

```
SWAnimation/SWMetal/
  SWLiquidChrome.swift     // SwiftUI view + optional live-tuning sheet
  SWLiquidChrome.metal     // [[ stitchable ]] swLiquidChrome entry point
```

## Source Code

### SWLiquidChrome.swift

```swift
import SwiftUI

// MARK: - Main View

struct SWLiquidChrome: View {
    /// Color of the chrome shadow valleys.
    var shadow: Color = Color(red: 0.020, green: 0.012, blue: 0.051)   // #05030D

    /// Mid-tone metallic color.
    var silver: Color = Color(red: 0.2,   green: 0.2,   blue: 0.251)   // #333340

    /// Color of the brightest reflections.
    var highlight: Color = Color(red: 0.502, green: 0.502, blue: 0.6)  // #808099

    /// Subtle accent layered in via the first warp sample.
    var tint: Color = Color(red: 0.149, green: 0.2,   blue: 0.4)       // #263366

    /// Multiplier on the internal time evolution.
    var speed: Float = 0.3

    /// Spatial scale of the noise field.
    var scale: Float = 2.0

    /// Strength of the inter-sample domain warp.
    var warp: Float = 1.5

    /// Gamma exponent on the chrome curve.
    var contrast: Float = 0.6

    /// Exponent of the specular power-curve — higher = tighter glints.
    var specPower: Float = 12

    /// Multiplier on the specular additive layer.
    var specStrength: Float = 0.3

    /// Multiplier on the tint additive layer.
    var tintStrength: Float = 0.15

    /// When `true`, attaches a gear `ToolbarItem` that opens a live-tuning sheet.
    var showsControls: Bool = false

    var body: some View {
        if showsControls {
            SWLiquidChromeControlled(initial: self)
        } else {
            SWLiquidChromeRenderer(
                shadow: shadow,
                silver: silver,
                highlight: highlight,
                tint: tint,
                speed: speed,
                scale: scale,
                warp: warp,
                contrast: contrast,
                specPower: specPower,
                specStrength: specStrength,
                tintStrength: tintStrength
            )
        }
    }
}

// MARK: - Renderer (pure shader binding)

private struct SWLiquidChromeRenderer: View {
    let shadow: Color
    let silver: Color
    let highlight: Color
    let tint: Color
    let speed: Float
    let scale: Float
    let warp: Float
    let contrast: Float
    let specPower: Float
    let specStrength: Float
    let tintStrength: Float

    @State private var start: Date = .now

    var body: some View {
        TimelineView(.animation) { ctx in
            let elapsed = Float(ctx.date.timeIntervalSince(start))
            // First-frame base color before the shader runs — using `silver`
            // (mid-tone metallic) avoids a black flash on initial layout.
            silver
                .colorEffect(
                    ShaderLibrary.swLiquidChrome(
                        .boundingRect,
                        .float(elapsed),
                        .float(speed),
                        .float(scale),
                        .float(warp),
                        .float(contrast),
                        .float(specPower),
                        .float(specStrength),
                        .float(tintStrength),
                        .color(shadow),
                        .color(silver),
                        .color(highlight),
                        .color(tint)
                    )
                )
        }
    }
}

// MARK: - Controlled Wrapper (gear toolbar item + live sheet)

private struct SWLiquidChromeControlled: View {
    @State private var shadow: Color
    @State private var silver: Color
    @State private var highlight: Color
    @State private var tint: Color
    @State private var speed: Float
    @State private var scale: Float
    @State private var warp: Float
    @State private var contrast: Float
    @State private var specPower: Float
    @State private var specStrength: Float
    @State private var tintStrength: Float

    @State private var showSheet = false

    init(initial: SWLiquidChrome) {
        _shadow       = State(initialValue: initial.shadow)
        _silver       = State(initialValue: initial.silver)
        _highlight    = State(initialValue: initial.highlight)
        _tint         = State(initialValue: initial.tint)
        _speed        = State(initialValue: initial.speed)
        _scale        = State(initialValue: initial.scale)
        _warp         = State(initialValue: initial.warp)
        _contrast     = State(initialValue: initial.contrast)
        _specPower    = State(initialValue: initial.specPower)
        _specStrength = State(initialValue: initial.specStrength)
        _tintStrength = State(initialValue: initial.tintStrength)
    }

    var body: some View {
        SWLiquidChromeRenderer(
            shadow: shadow,
            silver: silver,
            highlight: highlight,
            tint: tint,
            speed: speed,
            scale: scale,
            warp: warp,
            contrast: contrast,
            specPower: specPower,
            specStrength: specStrength,
            tintStrength: tintStrength
        )
        .ignoresSafeArea()
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    showSheet = true
                } label: {
                    Image(systemName: "slider.horizontal.3")
                }
                .accessibilityLabel("Liquid Chrome Controls")
            }
        }
        .sheet(isPresented: $showSheet) {
            SWLiquidChromeControlsSheet(
                shadow: $shadow,
                silver: $silver,
                highlight: $highlight,
                tint: $tint,
                speed: $speed,
                scale: $scale,
                warp: $warp,
                contrast: $contrast,
                specPower: $specPower,
                specStrength: $specStrength,
                tintStrength: $tintStrength
            )
            .presentationDetents([.medium])
            .presentationDragIndicator(.visible)
        }
    }
}

// MARK: - Controls Sheet

private struct SWLiquidChromeControlsSheet: View {
    @Binding var shadow: Color
    @Binding var silver: Color
    @Binding var highlight: Color
    @Binding var tint: Color
    @Binding var speed: Float
    @Binding var scale: Float
    @Binding var warp: Float
    @Binding var contrast: Float
    @Binding var specPower: Float
    @Binding var specStrength: Float
    @Binding var tintStrength: Float

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section("Colors") {
                    ColorPicker("Shadow",    selection: $shadow,    supportsOpacity: false)
                    ColorPicker("Silver",    selection: $silver,    supportsOpacity: false)
                    ColorPicker("Highlight", selection: $highlight, supportsOpacity: false)
                    ColorPicker("Tint",      selection: $tint,      supportsOpacity: false)
                }

                Section("Surface") {
                    SWLiquidChromeSliderRow(label: "Scale",    value: $scale,    range: 0.2...5, step: 0.05)
                    SWLiquidChromeSliderRow(label: "Warp",     value: $warp,     range: 0...5,   step: 0.05)
                    SWLiquidChromeSliderRow(label: "Contrast", value: $contrast, range: 0.1...3, step: 0.05)
                }

                Section("Lighting") {
                    SWLiquidChromeSliderRow(label: "Spec Power",    value: $specPower,    range: 1...50, step: 0.5)
                    SWLiquidChromeSliderRow(label: "Spec Strength", value: $specStrength, range: 0...2,  step: 0.05)
                    SWLiquidChromeSliderRow(label: "Tint Strength", value: $tintStrength, range: 0...2,  step: 0.05)
                }

                Section("Motion") {
                    SWLiquidChromeSliderRow(label: "Speed", value: $speed, range: 0...3, step: 0.05)
                }
            }
            .navigationTitle("Liquid Chrome")
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

private struct SWLiquidChromeSliderRow: View {
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
```

### SWLiquidChrome.metal

```metal
#include <metal_stdlib>
#include <SwiftUI/SwiftUI_Metal.h>
using namespace metal;

// Cheap 2D scalar hash. Standard fract/dot trick — biased but visually
// fine for value-noise interpolation.
static float swLiquidChromeHash(float2 p) {
    p = fract(p * float2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

// Bilinear value noise with smoothstep interpolation.
static float swLiquidChromeNoise(float2 p) {
    float2 i = floor(p);
    float2 f = fract(p);
    float2 u = f * f * (3.0 - 2.0 * f);
    float a = swLiquidChromeHash(i);
    float b = swLiquidChromeHash(i + float2(1.0, 0.0));
    float c = swLiquidChromeHash(i + float2(0.0, 1.0));
    float d = swLiquidChromeHash(i + float2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

[[ stitchable ]] half4 swLiquidChrome(float2 position,
                                      half4  color,
                                      float4 boundingRect,
                                      float  time,
                                      float  speed,
                                      float  scale,
                                      float  warp,
                                      float  contrast,
                                      float  specPower,
                                      float  specStrength,
                                      float  tintStrength,
                                      half4  shadow,
                                      half4  silver,
                                      half4  highlight,
                                      half4  tint) {
    float2 size = boundingRect.zw;
    // Centered, aspect-corrected coords (-1..1 along the short axis).
    float2 uv = (position * 2.0 - size) / max(min(size.x, size.y), 1.0);

    float t = time * speed;

    // Domain warping: each sample displaces the next by a scaled previous
    // noise value plus a per-axis time shift.
    float2 p  = uv * max(scale, 0.0001);
    float  n1 = swLiquidChromeNoise(p + float2(t, t * 0.6));
    float  n2 = swLiquidChromeNoise(p + n1 * warp + float2(-t * 0.4, t * 0.3));
    float  n3 = swLiquidChromeNoise(p * 1.5 + n2 * warp + float2(t * 0.2, -t * 0.5));

    // Chrome curve: remap to 0..1, then gamma-shape it. Higher contrast
    // exponent → steeper falloff into shadows; lower → flatter mid-tones.
    float chrome = clamp(n3 * 0.5 + 0.5, 0.0, 1.0);
    chrome = pow(chrome, max(contrast, 0.001));

    float3 sh = float3(shadow.rgb);
    float3 sv = float3(silver.rgb);
    float3 hl = float3(highlight.rgb);
    float3 tn = float3(tint.rgb);

    float3 col = mix(sh, sv, chrome);
    col = mix(col, hl, smoothstep(0.8, 0.98, chrome));
    col += tn * smoothstep(0.3, 0.6, n1) * tintStrength;

    // Specular glint — high-power curve on the chrome value picks out crests.
    // The baked-in cool tint (0.6, 0.6, 0.8) is intentional and part of the
    // chrome style identity; it gives glints a slightly blue cast that reads
    // as polished metal even when the four user colors are warm.
    float spec = pow(max(chrome, 0.0), max(specPower, 0.001));
    col += float3(0.6, 0.6, 0.8) * spec * specStrength;

    return half4(half3(col), 1.0);
}
```

## Usage

```swift
// Default — cool blue chrome, full-screen
ZStack {
    SWLiquidChrome()
        .ignoresSafeArea()
    // Your content here
}

// Recolor — warm gold chrome
SWLiquidChrome(
    shadow: .brown,
    silver: .yellow.opacity(0.4),
    highlight: .white,
    tint: .orange
)

// As a section background
myContent
    .background { SWLiquidChrome() }

// Tighter, sharper glints
SWLiquidChrome(specPower: 24, specStrength: 0.5)
```

## Parameters

| Parameter | Type | Default | Range | Notes |
|---|---|---|---|---|
| `shadow` | `Color` | `#05030D` (near-black) | — | Color of the chrome shadow valleys |
| `silver` | `Color` | `#333340` (cool grey) | — | Mid-tone metallic color |
| `highlight` | `Color` | `#808099` (lit silver) | — | Color of the brightest reflections |
| `tint` | `Color` | `#263366` (deep blue) | — | Subtle accent layered in via the first warp sample |
| `speed` | `Float` | `0.3` | 0…3 | Multiplier on the internal time evolution |
| `scale` | `Float` | `2.0` | 0.2…5 | Spatial scale of the noise field — higher = finer detail |
| `warp` | `Float` | `1.5` | 0…5 | Strength of the inter-sample domain warp |
| `contrast` | `Float` | `0.6` | 0.1…3 | Gamma exponent on the chrome curve — higher = steeper shadow falloff |
| `specPower` | `Float` | `12` | 1…50 | Exponent of the specular power-curve — higher = tighter, sharper glints |
| `specStrength` | `Float` | `0.3` | 0…2 | Multiplier on the specular additive layer |
| `tintStrength` | `Float` | `0.15` | 0…2 | Multiplier on the tint additive layer |
| `showsControls` | `Bool` | `false` | — | Demo-only gear ToolbarItem; requires an enclosing `NavigationStack` |

## Integration Checklist

1. Copy `SWLiquidChrome.swift` and `SWLiquidChrome.metal` into your Xcode target.
2. Confirm the deployment target is iOS 18+ / macOS 15+.
3. Use it as a `ZStack` background with `.ignoresSafeArea()` for full-bleed, or behind a card / hero element.
4. Pick a shadow / silver / highlight / tint palette per the desired metal — cool blue (default), warm gold (`.brown` / `.yellow.opacity(0.4)` / `.white` / `.orange`), bronze, etc.
5. Use higher `specPower` for sharper, more "mirror-like" reflections; lower for a softer brushed-metal look.

## Notes / Gotchas

- The specular highlight is biased with a baked-in cool tint `(0.6, 0.6, 0.8)` so glints always read as polished metal even when the user colors are warm. Hard-coded by design — do not parameterize it.
- The shader runs three sequential value-noise samples per pixel — cheaper than the FBM-based clouds (no octave loop) but the chain dependency limits parallelism. Keep to one full-screen instance.
- `scale` and `contrast` are both clamped internally to `>= 0.0001` so zero / negative input is safe.
- When `showsControls` is `true`, the gear button is a native `ToolbarItem` — the call site must be inside a `NavigationStack`.
