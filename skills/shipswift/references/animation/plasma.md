---
id: animation-plasma
title: Plasma
description: Full-color plasma background family with five hand-tuned styles (Solar / Prism / Spectrum / Ember / Lilac), each shipping its own 5-stop palette — switch style with a single enum
tier: free
tags: [animation, metal, shader, plasma, background, palette, SwiftUI]
---

## Overview

Family of full-color plasma backgrounds rendered through SwiftUI's `colorEffect` Metal pipeline. Five hand-tuned styles share the same parameter surface (5-stop palette + scale / intensity / distortion); switching style swaps both the shader and the palette so the call site sees the intended look in one line.

Also usable as a button-border ring by clipping the renderer to a `Circle()` or `Capsule()` and inset-ing a darker pill on top.

All five entry points live in a single `SWPlasma.metal` because they share the same hash / value-noise / FBM / palette helpers and only differ in the final color-mixing step. Requires iOS 18+ / macOS 15+.

## File Layout

```
SWAnimation/SWMetal/
  SWPlasma.swift      // SwiftUI view + SWPlasmaStyle enum (5 styles)
  SWPlasma.metal      // 5 [[ stitchable ]] entry points: swPlasmaSolar /
                      // swPlasmaPrism / swPlasmaSpectrum / swPlasmaEmber /
                      // swPlasmaLilac, plus shared helpers
```

## Source Code

### SWPlasma.swift

```swift
import SwiftUI

// MARK: - Style

enum SWPlasmaStyle: String, CaseIterable, Identifiable {
    case solar
    case prism
    case spectrum
    case ember
    case lilac

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .solar:    "Solar"
        case .prism:    "Prism"
        case .spectrum: "Spectrum"
        case .ember:    "Ember"
        case .lilac:    "Lilac"
        }
    }

    /// Metal `stitchable` function name in the default `ShaderLibrary`.
    var shaderName: String {
        switch self {
        case .solar:    "swPlasmaSolar"
        case .prism:    "swPlasmaPrism"
        case .spectrum: "swPlasmaSpectrum"
        case .ember:    "swPlasmaEmber"
        case .lilac:    "swPlasmaLilac"
        }
    }

    /// Five-stop palette hand-tuned for this style.
    var defaultPalette: [Color] {
        switch self {
        case .solar:
            return [
                Color(red: 0.102, green: 0.020, blue: 0.0),     // #1A0500
                Color(red: 0.353, green: 0.071, blue: 0.031),   // #5A1208
                Color(red: 0.769, green: 0.290, blue: 0.125),   // #C44A20
                Color(red: 0.941, green: 0.541, blue: 0.227),   // #F08A3A
                Color(red: 1.0,   green: 0.773, blue: 0.478),   // #FFC57A
            ]
        case .prism:
            return [
                Color(red: 0.102, green: 0.0,   blue: 0.2),     // #1A0033
                Color(red: 0.478, green: 0.122, blue: 0.722),   // #7A1FB8
                Color(red: 1.0,   green: 0.078, blue: 0.576),   // #FF1493
                Color(red: 1.0,   green: 0.839, blue: 0.0),     // #FFD600
                Color(red: 0.0,   green: 0.898, blue: 1.0),     // #00E5FF
            ]
        case .spectrum:
            return [
                Color(red: 0.0,   green: 0.102, blue: 0.4),     // #001A66
                Color(red: 0.231, green: 0.0,   blue: 0.510),   // #3B0082
                Color(red: 0.416, green: 0.051, blue: 0.678),   // #6A0DAD
                Color(red: 0.780, green: 0.082, blue: 0.522),   // #C71585
                Color(red: 1.0,   green: 0.549, blue: 0.180),   // #FF8C2E
            ]
        case .ember:
            return [
                Color(red: 0.020, green: 0.0,   blue: 0.0),     // #050000
                Color(red: 0.290, green: 0.055, blue: 0.0),     // #4A0E00
                Color(red: 0.769, green: 0.290, blue: 0.039),   // #C44A0A
                Color(red: 1.0,   green: 0.659, blue: 0.180),   // #FFA82E
                Color(red: 1.0,   green: 0.878, blue: 0.541),   // #FFE08A
            ]
        case .lilac:
            return [
                Color(red: 0.165, green: 0.039, blue: 0.290),   // #2A0A4A
                Color(red: 0.420, green: 0.310, blue: 0.627),   // #6B4FA0
                Color(red: 0.769, green: 0.600, blue: 0.851),   // #C499D9
                Color(red: 0.961, green: 0.776, blue: 0.878),   // #F5C6E0
                Color(red: 1.0,   green: 0.933, blue: 0.933),   // #FFEEEE
            ]
        }
    }
}

// MARK: - Main View

struct SWPlasma: View {
    var style: SWPlasmaStyle
    var c1: Color
    var c2: Color
    var c3: Color
    var c4: Color
    var c5: Color
    var scale: Float
    var intensity: Float
    var distortion: Float
    var showsControls: Bool

    /// Designated initializer. Any nil palette stop falls back to the
    /// `style`'s `defaultPalette`, so `SWPlasma(style: .prism)` renders
    /// the intended Prism look without the caller spelling out colors.
    init(
        style: SWPlasmaStyle = .solar,
        c1: Color? = nil,
        c2: Color? = nil,
        c3: Color? = nil,
        c4: Color? = nil,
        c5: Color? = nil,
        scale: Float = 1.0,
        intensity: Float = 1.0,
        distortion: Float = 1.0,
        showsControls: Bool = false
    ) {
        self.style = style
        let palette = style.defaultPalette
        self.c1 = c1 ?? palette[0]
        self.c2 = c2 ?? palette[1]
        self.c3 = c3 ?? palette[2]
        self.c4 = c4 ?? palette[3]
        self.c5 = c5 ?? palette[4]
        self.scale = scale
        self.intensity = intensity
        self.distortion = distortion
        self.showsControls = showsControls
    }

    var body: some View {
        if showsControls {
            SWPlasmaControlled(initial: self)
        } else {
            SWPlasmaRenderer(
                style: style,
                c1: c1, c2: c2, c3: c3, c4: c4, c5: c5,
                scale: scale,
                intensity: intensity,
                distortion: distortion
            )
        }
    }
}

// MARK: - Renderer (pure shader binding)

private struct SWPlasmaRenderer: View {
    let style: SWPlasmaStyle
    let c1: Color
    let c2: Color
    let c3: Color
    let c4: Color
    let c5: Color
    let scale: Float
    let intensity: Float
    let distortion: Float

    @State private var start: Date = .now

    var body: some View {
        TimelineView(.animation) { ctx in
            let elapsed = Float(ctx.date.timeIntervalSince(start))
            // First-frame base color before the shader runs — c3 is the
            // mid-tone of every style's palette, gives a sensible look.
            c3
                .colorEffect(
                    Shader(
                        function: ShaderFunction(library: .default, name: style.shaderName),
                        arguments: [
                            .boundingRect,
                            .float(elapsed),
                            .color(c1),
                            .color(c2),
                            .color(c3),
                            .color(c4),
                            .color(c5),
                            .float(scale),
                            .float(intensity),
                            .float(distortion)
                        ]
                    )
                )
        }
    }
}

// MARK: - Controlled Wrapper (gear toolbar item + live sheet)

private struct SWPlasmaControlled: View {
    @State private var style: SWPlasmaStyle
    @State private var c1: Color
    @State private var c2: Color
    @State private var c3: Color
    @State private var c4: Color
    @State private var c5: Color
    @State private var scale: Float
    @State private var intensity: Float
    @State private var distortion: Float

    @State private var showSheet = false

    init(initial: SWPlasma) {
        _style      = State(initialValue: initial.style)
        _c1         = State(initialValue: initial.c1)
        _c2         = State(initialValue: initial.c2)
        _c3         = State(initialValue: initial.c3)
        _c4         = State(initialValue: initial.c4)
        _c5         = State(initialValue: initial.c5)
        _scale      = State(initialValue: initial.scale)
        _intensity  = State(initialValue: initial.intensity)
        _distortion = State(initialValue: initial.distortion)
    }

    /// Builder that produces a fresh `SWPlasma` view with the currently
    /// tweaked parameters — used by both the full-screen background and
    /// the button-ring demo so all three plasma instances animate in sync.
    private func makePlasma() -> SWPlasma {
        SWPlasma(
            style: style,
            c1: c1, c2: c2, c3: c3, c4: c4, c5: c5,
            scale: scale,
            intensity: intensity,
            distortion: distortion
        )
    }

    var body: some View {
        ZStack {
            // Full-screen plasma — shows the "use as background" case.
            SWPlasmaRenderer(
                style: style,
                c1: c1, c2: c2, c3: c3, c4: c4, c5: c5,
                scale: scale,
                intensity: intensity,
                distortion: distortion
            )
            .ignoresSafeArea()

            // Button-ring demo — shows the "use as ring border" case
            // documented in the original plasma sources. Wrapped in a
            // dark card so the rings read against the plasma background.
            VStack {
                Spacer()
                VStack(spacing: 14) {
                    Text("Plasma as button border")
                        .font(.footnote.weight(.medium))
                        .foregroundStyle(.white.opacity(0.7))
                    HStack(spacing: 22) {
                        SWPlasmaRingCircleButton(icon: "arrow.up") { makePlasma() }
                        SWPlasmaRingPillButton(title: "Upgrade to Pro") { makePlasma() }
                    }
                }
                .padding(.vertical, 22)
                .padding(.horizontal, 28)
                .background(Color.black.opacity(0.75), in: RoundedRectangle(cornerRadius: 24, style: .continuous))
                .padding(.bottom, 60)
            }
        }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    showSheet = true
                } label: {
                    Image(systemName: "slider.horizontal.3")
                }
                .accessibilityLabel("Plasma Controls")
            }
        }
        .sheet(isPresented: $showSheet) {
            SWPlasmaControlsSheet(
                style: $style,
                c1: $c1, c2: $c2, c3: $c3, c4: $c4, c5: $c5,
                scale: $scale,
                intensity: $intensity,
                distortion: $distortion
            )
            .presentationDetents([.medium])
            .presentationDragIndicator(.visible)
        }
    }
}

// MARK: - Controls Sheet

private struct SWPlasmaControlsSheet: View {
    @Binding var style: SWPlasmaStyle
    @Binding var c1: Color
    @Binding var c2: Color
    @Binding var c3: Color
    @Binding var c4: Color
    @Binding var c5: Color
    @Binding var scale: Float
    @Binding var intensity: Float
    @Binding var distortion: Float

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section("Style") {
                    Picker("Style", selection: $style) {
                        ForEach(SWPlasmaStyle.allCases) { s in
                            Text(s.displayName).tag(s)
                        }
                    }
                }

                Section("Palette") {
                    ColorPicker("Color 1", selection: $c1, supportsOpacity: false)
                    ColorPicker("Color 2", selection: $c2, supportsOpacity: false)
                    ColorPicker("Color 3", selection: $c3, supportsOpacity: false)
                    ColorPicker("Color 4", selection: $c4, supportsOpacity: false)
                    ColorPicker("Color 5", selection: $c5, supportsOpacity: false)
                }

                Section("Field") {
                    SWPlasmaSliderRow(label: "Scale",      value: $scale,      range: 0.2...3, step: 0.05)
                    SWPlasmaSliderRow(label: "Intensity",  value: $intensity,  range: 0...2.5, step: 0.05)
                    SWPlasmaSliderRow(label: "Distortion", value: $distortion, range: 0...3,   step: 0.05)
                }
            }
            .navigationTitle("Plasma")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
            // When the style changes, reset the palette to the new style's
            // hand-tuned defaults so the caller sees the designer's intent.
            // Any previously customized colors are overwritten — intentional.
            .onChange(of: style) { _, newStyle in
                let palette = newStyle.defaultPalette
                c1 = palette[0]
                c2 = palette[1]
                c3 = palette[2]
                c4 = palette[3]
                c5 = palette[4]
            }
        }
    }
}

private struct SWPlasmaSliderRow: View {
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

// MARK: - Button-Ring Demo Helpers

/// Inset colors / sizes for the button-ring demo.
private let swPlasmaButtonInk  = Color(red: 0.07, green: 0.07, blue: 0.08)
private let swPlasmaRingWidth: CGFloat = 2.5

private struct SWPlasmaRingCircleButton<Plasma: View>: View {
    let icon: String
    @ViewBuilder let plasma: () -> Plasma

    var body: some View {
        ZStack {
            plasma()
                .clipShape(Circle())
            Circle()
                .fill(swPlasmaButtonInk)
                .padding(swPlasmaRingWidth)
            Image(systemName: icon)
                .font(.system(size: 22, weight: .semibold))
                .foregroundStyle(.white)
        }
        .frame(width: 64, height: 64)
    }
}

private struct SWPlasmaRingPillButton<Plasma: View>: View {
    let title: String
    @ViewBuilder let plasma: () -> Plasma

    var body: some View {
        ZStack {
            plasma()
                .clipShape(Capsule())
            Text(title)
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(.black)
                .padding(.horizontal, 28)
        }
        .frame(height: 56)
        .fixedSize(horizontal: true, vertical: false)
    }
}
```

### SWPlasma.metal

```metal
#include <metal_stdlib>
#include <SwiftUI/SwiftUI_Metal.h>
using namespace metal;

// MARK: - Shared helpers

static float swPlasmaHash(float2 p) {
    p = float2(dot(p, float2(91.31, 47.79)),
               dot(p, float2(31.07, 73.13)));
    return fract(sin(p.x + p.y) * 19357.713);
}

static float swPlasmaVNoise(float2 p) {
    float2 i = floor(p);
    float2 f = fract(p);
    float2 u = f * f * (3.0 - 2.0 * f);
    float a = swPlasmaHash(i);
    float b = swPlasmaHash(i + float2(1.0, 0.0));
    float c = swPlasmaHash(i + float2(0.0, 1.0));
    float d = swPlasmaHash(i + float2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// 2-octave FBM (Prism only).
static float swPlasmaFBM2(float2 p) {
    float v = swPlasmaVNoise(p) * 0.6;
    v += swPlasmaVNoise(p * 2.0) * 0.4;
    return v - 0.5;
}

// 3-octave FBM (everyone else).
static float swPlasmaFBM3(float2 p) {
    float v = swPlasmaVNoise(p) * 0.5;
    v += swPlasmaVNoise(p * 2.0) * 0.3;
    v += swPlasmaVNoise(p * 4.0) * 0.2;
    return v - 0.5;
}

// 5-stop palette mixer, smoothstep-interpolated between each adjacent pair.
static float3 swPlasmaPal5(float t,
                           float3 c1, float3 c2, float3 c3, float3 c4, float3 c5) {
    t = clamp(t, 0.0, 1.0);
    if (t < 0.25) return mix(c1, c2, smoothstep(0.0,  0.25, t));
    if (t < 0.5)  return mix(c2, c3, smoothstep(0.25, 0.5,  t));
    if (t < 0.75) return mix(c3, c4, smoothstep(0.5,  0.75, t));
    return mix(c4, c5, smoothstep(0.75, 1.0, t));
}

// MARK: - Solar

[[ stitchable ]] half4 swPlasmaSolar(float2 position,
                                     half4  color,
                                     float4 boundingRect,
                                     float  time,
                                     half4  c1,
                                     half4  c2,
                                     half4  c3,
                                     half4  c4,
                                     half4  c5,
                                     float  scale,
                                     float  intensity,
                                     float  distortion) {
    float2 size   = boundingRect.zw;
    float2 uv     = position / size;
    float  aspect = size.x / size.y;
    float2 p      = uv - 0.5;
    p.x *= aspect;
    p   *= scale;

    float v = 0.0;
    v += sin(p.x * 2.1 + time * 0.7);
    v += sin(p.y * 2.5 + time * 0.9);
    v += sin((p.x + p.y) * 1.4 + time * 0.5);
    v += swPlasmaFBM3(p * 2.0 + time * 0.18) * distortion * 2.0;
    v  = (v + 4.0) * 0.125;
    v  = clamp(v * intensity, 0.0, 1.0);

    float3 col = swPlasmaPal5(v,
                              float3(c1.rgb), float3(c2.rgb),
                              float3(c3.rgb), float3(c4.rgb), float3(c5.rgb));
    col += pow(v, 4.0) * 0.4;
    return half4(half3(col), 1.0h);
}

// MARK: - Prism

[[ stitchable ]] half4 swPlasmaPrism(float2 position,
                                     half4  color,
                                     float4 boundingRect,
                                     float  time,
                                     half4  c1,
                                     half4  c2,
                                     half4  c3,
                                     half4  c4,
                                     half4  c5,
                                     float  scale,
                                     float  intensity,
                                     float  distortion) {
    float2 size   = boundingRect.zw;
    float2 uv     = position / size;
    float  aspect = size.x / size.y;
    float2 p      = uv - 0.5;
    p.x *= aspect;
    p   *= scale;

    float a  = time * 0.3;
    float2 d = float2(cos(a), sin(a));

    // Inlined field — Prism-specific factor (3.0) and FBM2.
    float v1 = sin(dot(p + float2( 0.025, 0.0), d) * 3.0 + swPlasmaFBM2((p + float2( 0.025, 0.0)) * 1.5) * distortion * 3.0 + time * 0.4);
    float v2 = sin(dot(p,                       d) * 3.0 + swPlasmaFBM2( p                       * 1.5) * distortion * 3.0 + time * 0.4);
    float v3 = sin(dot(p + float2(-0.025, 0.0), d) * 3.0 + swPlasmaFBM2((p + float2(-0.025, 0.0)) * 1.5) * distortion * 3.0 + time * 0.4);

    float3 cc1 = float3(c1.rgb), cc2 = float3(c2.rgb), cc3 = float3(c3.rgb),
           cc4 = float3(c4.rgb), cc5 = float3(c5.rgb);
    float3 ca = swPlasmaPal5(v1 * 0.5 + 0.5, cc1, cc2, cc3, cc4, cc5);
    float3 cb = swPlasmaPal5(v2 * 0.5 + 0.5, cc1, cc2, cc3, cc4, cc5);
    float3 cc = swPlasmaPal5(v3 * 0.5 + 0.5, cc1, cc2, cc3, cc4, cc5);
    float3 col = float3(ca.r, cb.g, cc.b) * intensity;
    return half4(half3(clamp(col, 0.0, 1.5)), 1.0h);
}

// MARK: - Spectrum

[[ stitchable ]] half4 swPlasmaSpectrum(float2 position,
                                        half4  color,
                                        float4 boundingRect,
                                        float  time,
                                        half4  c1,
                                        half4  c2,
                                        half4  c3,
                                        half4  c4,
                                        half4  c5,
                                        float  scale,
                                        float  intensity,
                                        float  distortion) {
    float2 size   = boundingRect.zw;
    float2 uv     = position / size;
    float  aspect = size.x / size.y;
    float2 p      = uv - 0.5;
    p.x *= aspect;
    p   *= scale;

    float a  = time * 0.22 + 1.57;          // ~90° biases d toward vertical
    float2 d = float2(cos(a), sin(a));

    // Inlined field — Spectrum-specific factor (2.4) and FBM3 with time-shift.
    float v1 = sin(dot(p + float2(0.0,  0.045), d) * 2.4 + swPlasmaFBM3((p + float2(0.0,  0.045)) * 1.3 + time * 0.07) * distortion * 4.0 + time * 0.45);
    float v2 = sin(dot(p,                       d) * 2.4 + swPlasmaFBM3( p                       * 1.3 + time * 0.07) * distortion * 4.0 + time * 0.45);
    float v3 = sin(dot(p + float2(0.0, -0.045), d) * 2.4 + swPlasmaFBM3((p + float2(0.0, -0.045)) * 1.3 + time * 0.07) * distortion * 4.0 + time * 0.45);

    float3 cc1 = float3(c1.rgb), cc2 = float3(c2.rgb), cc3 = float3(c3.rgb),
           cc4 = float3(c4.rgb), cc5 = float3(c5.rgb);
    float3 ca = swPlasmaPal5(v1 * 0.5 + 0.5, cc1, cc2, cc3, cc4, cc5);
    float3 cb = swPlasmaPal5(v2 * 0.5 + 0.5, cc1, cc2, cc3, cc4, cc5);
    float3 cc = swPlasmaPal5(v3 * 0.5 + 0.5, cc1, cc2, cc3, cc4, cc5);
    float3 col = float3(ca.r, cb.g, cc.b) * intensity * 1.15;
    return half4(half3(clamp(col, 0.0, 1.6)), 1.0h);
}

// MARK: - Ember

[[ stitchable ]] half4 swPlasmaEmber(float2 position,
                                     half4  color,
                                     float4 boundingRect,
                                     float  time,
                                     half4  c1,
                                     half4  c2,
                                     half4  c3,
                                     half4  c4,
                                     half4  c5,
                                     float  scale,
                                     float  intensity,
                                     float  distortion) {
    float2 size   = boundingRect.zw;
    float2 uv     = position / size;
    float  aspect = size.x / size.y;
    float2 p      = uv - 0.5;
    p.x *= aspect;
    p   *= scale * 1.3;                     // tighter pre-scale for ember detail

    float v = 0.0;
    v += sin(p.x * 2.5 + time * 0.6);
    v += sin(p.y * 3.0 + time * 0.8);
    v += sin(length(p) * 2.0 - time * 0.5);
    v += swPlasmaFBM3(p * 2.0 + time * 0.18) * distortion * 3.0;
    v  = (v + 4.0) * 0.125;
    v  = pow(clamp(v, 0.0, 1.0), 1.6) * intensity;

    float3 col = swPlasmaPal5(v,
                              float3(c1.rgb), float3(c2.rgb),
                              float3(c3.rgb), float3(c4.rgb), float3(c5.rgb));
    col += pow(v, 6.0) * 0.55;
    return half4(half3(col), 1.0h);
}

// MARK: - Lilac

[[ stitchable ]] half4 swPlasmaLilac(float2 position,
                                     half4  color,
                                     float4 boundingRect,
                                     float  time,
                                     half4  c1,
                                     half4  c2,
                                     half4  c3,
                                     half4  c4,
                                     half4  c5,
                                     float  scale,
                                     float  intensity,
                                     float  distortion) {
    float2 size   = boundingRect.zw;
    float2 uv     = position / size;
    float  aspect = size.x / size.y;
    float2 p      = uv - 0.5;
    p.x *= aspect;
    p   *= scale;

    float t      = time * 0.7;
    float breath = 0.5 + 0.5 * sin(time * 0.5);

    float v = 0.0;
    v += sin(p.x * 1.8 + t);
    v += sin(p.y * 2.2 + t * 1.1);
    v += sin((p.x + p.y) * 1.0 + t * 0.8);
    v += swPlasmaFBM3(p * 1.5 + t * 0.15) * distortion * 2.0;
    v  = (v + 3.5) * 0.143;
    v  = clamp(v * intensity * (0.7 + 0.6 * breath), 0.0, 1.0);

    float3 col = swPlasmaPal5(v,
                              float3(c1.rgb), float3(c2.rgb),
                              float3(c3.rgb), float3(c4.rgb), float3(c5.rgb));
    col += pow(v, 4.0) * 0.35 * breath;
    return half4(half3(col), 1.0h);
}
```

## Usage

```swift
// Default — solar warm-orange plasma
ZStack {
    SWPlasma()
        .ignoresSafeArea()
}

// Pick a style — palette auto-defaults to the style's hand-tuned set
SWPlasma(style: .prism)
SWPlasma(style: .ember, intensity: 1.4)

// Override individual palette stops (others fall back to the style default)
SWPlasma(style: .lilac, c5: .white)

// As a section background
myContent
    .background { SWPlasma(style: .spectrum) }

// As a button border ring — clip the plasma to a Circle, then inset a dark fill
ZStack {
    SWPlasma(style: .prism)
        .clipShape(Circle())
    Circle()
        .fill(Color(red: 0.07, green: 0.07, blue: 0.08))
        .padding(2.5)
    Image(systemName: "arrow.up")
        .font(.system(size: 22, weight: .semibold))
        .foregroundStyle(.white)
}
.frame(width: 64, height: 64)
```

## Parameters

| Parameter | Type | Default | Notes |
|---|---|---|---|
| `style` | `SWPlasmaStyle` | `.solar` | `solar` / `prism` / `spectrum` / `ember` / `lilac` |
| `c1` … `c5` | `Color?` | `nil` → `style.defaultPalette[i]` | **Style-specific** — 5-stop palette hand-tuned per style; pass `nil` to keep the default |
| `scale` | `Float` | `1.0` | Spatial scale multiplier (0.2…3 in sheet) |
| `intensity` | `Float` | `1.0` | Multiplier on the field value before palette mapping (0…2.5 in sheet) |
| `distortion` | `Float` | `1.0` | Strength of the noise distortion added to the sin field (0…3 in sheet) |
| `showsControls` | `Bool` | `false` | Demo-only gear ToolbarItem; requires `NavigationStack` |

**Style-by-style notes:**
- `solar` — warm orange / amber / red, 3-octave FBM, single field, `pow(v, 4)` highlight boost.
- `prism` — rotating direction vector + RGB channel split on X (±0.025), 2-octave FBM, ultraviolet purple → pink → yellow → cyan.
- `spectrum` — like Prism but biased vertical (`time * 0.22 + 1.57`), RGB split on Y, 3-octave FBM with time-shift.
- `ember` — radial term + tighter pre-scale (`scale * 1.3`), `pow(v, 1.6)` gamma boost, `pow(v, 6) * 0.55` high-power hotspots.
- `lilac` — slow phase (`time * 0.7`) + global breath envelope `0.5 + 0.5 * sin(time * 0.5)`, soft purple-pink pastel palette.

## Integration Checklist

1. Copy `SWPlasma.swift` and `SWPlasma.metal` into your Xcode target.
2. Confirm the deployment target is iOS 18+ / macOS 15+.
3. Pick a style and let the palette default (`SWPlasma(style: .prism)` is enough).
4. For button-ring usage, clip the renderer to a `Circle()` / `Capsule()` and inset a darker fill of the same shape on top.
5. Keep to one instance per visible screen — Spectrum is the heaviest variant.

## Notes / Gotchas

- Cost is per-pixel and varies by style — **Solar / Ember / Lilac** each run a single FBM3 (3 noise samples); **Prism** runs three FBM2s (6 noise samples); **Spectrum** runs three FBM3s (9 noise samples). Spectrum is the heaviest.
- When `showsControls` is `true`, the sheet's Style picker resets the five palette stops to the new style's defaults — already-tuned colors will be lost on style change. This is intentional so the caller can shop styles by name and see the designer's intent.
- The renderer's first-frame base color is `c3` (palette mid-tone) to avoid a black flash before `TimelineView` ticks in.
- The five styles intentionally live in a single `SWPlasma.metal` because they share the same hash / value-noise / FBM / 5-stop palette helpers and only differ in the final color mixing step. The 5-stop palette mixer `swPlasmaPal5` is smoothstep-interpolated between each adjacent pair.
- The gear button is a native `ToolbarItem` — the call site must be inside a `NavigationStack`.
