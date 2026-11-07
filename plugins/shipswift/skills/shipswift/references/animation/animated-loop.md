---
id: animation-animated-loop
title: Animated Loop
description: Pulsing concentric rings in one of four hand-tuned styles (Shape / Diamond / Neon / Warp) with three RGB-channel colors and per-channel phase offset — Shape style adds a geometric sub-picker (circle / square / diamond / hexagon / star)
tier: free
tags: [animation, metal, shader, rings, loop, splash, background, SwiftUI]
---

## Overview

Family of full-screen pulsing concentric-ring animations rendered through SwiftUI's `colorEffect` Metal pipeline. Four hand-tuned styles share the same per-line phase ramp, RGB-channel split, and additive composite logic; they only differ in the distance metric `d` and the pattern term `m`. The `Shape` style additionally exposes a 5-way geometric selector (circle / square / diamond pip / hexagon / star with petal count); the `Neon` style adds three angular-wobble parameters.

Requires iOS 18+ / macOS 15+.

## File Layout

```
SWAnimation/SWMetal/
  SWAnimatedLoop.swift     // SwiftUI view + 2 enums (style + shape)
  SWAnimatedLoop.metal     // 4 [[ stitchable ]] entry points:
                           //   swAnimatedLoopShape / swAnimatedLoopDiamond /
                           //   swAnimatedLoopNeon  / swAnimatedLoopWarp
```

## Source Code

### SWAnimatedLoop.swift

```swift
import SwiftUI

// MARK: - Style

enum SWAnimatedLoopStyle: String, CaseIterable, Identifiable {
    case shape
    case diamond
    case neon
    case warp

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .shape:   "Shape"
        case .diamond: "Diamond"
        case .neon:    "Neon"
        case .warp:    "Warp"
        }
    }

    /// Metal `stitchable` function name in the default `ShaderLibrary`.
    var shaderName: String {
        switch self {
        case .shape:   "swAnimatedLoopShape"
        case .diamond: "swAnimatedLoopDiamond"
        case .neon:    "swAnimatedLoopNeon"
        case .warp:    "swAnimatedLoopWarp"
        }
    }

    /// Whether this style consumes the `shape` parameter (Shape style only).
    var supportsShape: Bool { self == .shape }

    /// Whether this style consumes the angular-wobble parameters (Neon only).
    var supportsAngular: Bool { self == .neon }

    /// Hand-tuned numeric defaults for this style. Loaded by `SWAnimatedLoop`'s
    /// initializer and reloaded by the controls sheet on style change.
    struct NumericDefaults {
        var speed: Float
        var lineWidth: Float
        var lines: Int
        var spacing: Float
        var channelOffset: Float
        var patternMod: Float
    }

    var numericDefaults: NumericDefaults {
        switch self {
        case .shape:
            return NumericDefaults(speed: 0.05, lineWidth: 0.002, lines: 5,
                                   spacing: 5.0, channelOffset: 0.01, patternMod: 0.2)
        case .diamond:
            return NumericDefaults(speed: 0.05, lineWidth: 0.002, lines: 6,
                                   spacing: 5.0, channelOffset: 0.01, patternMod: 0.15)
        case .neon:
            return NumericDefaults(speed: 0.06, lineWidth: 0.002, lines: 5,
                                   spacing: 5.0, channelOffset: 0.01, patternMod: 0.2)
        case .warp:
            return NumericDefaults(speed: 0.07, lineWidth: 0.002, lines: 6,
                                   spacing: 4.0, channelOffset: 0.008, patternMod: 0.3)
        }
    }
}

// MARK: - Shape

enum SWAnimatedLoopShape: Int, CaseIterable, Identifiable {
    case circle  = 0
    case square  = 1
    case diamond = 2
    case hexagon = 3
    case star    = 4

    var id: Int { rawValue }

    var displayName: String {
        switch self {
        case .circle:  "Circle"
        case .square:  "Square"
        case .diamond: "Diamond"
        case .hexagon: "Hexagon"
        case .star:    "Star"
        }
    }
}

// MARK: - Main View

struct SWAnimatedLoop: View {
    var style: SWAnimatedLoopStyle
    var shape: SWAnimatedLoopShape
    var petals: Int

    var color1: Color
    var color2: Color
    var color3: Color
    var background: Color

    var speed: Float
    var lineWidth: Float
    var lines: Int
    var spacing: Float
    var channelOffset: Float
    var patternMod: Float

    var rotation: Float
    var scale: Float
    var centerX: Float
    var centerY: Float

    var angularLobes: Float
    var angularAmount: Float
    var angularSpeed: Float

    var showsControls: Bool

    /// Designated initializer. Any numeric ring parameter passed as `nil`
    /// falls back to the `style`'s `numericDefaults`, so each style is one
    /// line to render: `SWAnimatedLoop(style: .warp)` is enough.
    init(
        style: SWAnimatedLoopStyle = .shape,
        shape: SWAnimatedLoopShape = .circle,
        petals: Int = 5,
        color1: Color = .red,
        color2: Color = .green,
        color3: Color = .blue,
        background: Color = .black,
        speed: Float? = nil,
        lineWidth: Float? = nil,
        lines: Int? = nil,
        spacing: Float? = nil,
        channelOffset: Float? = nil,
        patternMod: Float? = nil,
        rotation: Float = 0.0,
        scale: Float = 1.0,
        centerX: Float = 0.0,
        centerY: Float = 0.0,
        angularLobes: Float = 3.0,
        angularAmount: Float = 0.08,
        angularSpeed: Float = 0.5,
        showsControls: Bool = false
    ) {
        let d = style.numericDefaults
        self.style          = style
        self.shape          = shape
        self.petals         = petals
        self.color1         = color1
        self.color2         = color2
        self.color3         = color3
        self.background     = background
        self.speed          = speed         ?? d.speed
        self.lineWidth      = lineWidth     ?? d.lineWidth
        self.lines          = lines         ?? d.lines
        self.spacing        = spacing       ?? d.spacing
        self.channelOffset  = channelOffset ?? d.channelOffset
        self.patternMod     = patternMod    ?? d.patternMod
        self.rotation       = rotation
        self.scale          = scale
        self.centerX        = centerX
        self.centerY        = centerY
        self.angularLobes   = angularLobes
        self.angularAmount  = angularAmount
        self.angularSpeed   = angularSpeed
        self.showsControls  = showsControls
    }

    var body: some View {
        if showsControls {
            SWAnimatedLoopControlled(initial: self)
        } else {
            SWAnimatedLoopRenderer(
                style: style,
                shape: shape,
                petals: petals,
                color1: color1,
                color2: color2,
                color3: color3,
                background: background,
                speed: speed,
                lineWidth: lineWidth,
                lines: lines,
                spacing: spacing,
                channelOffset: channelOffset,
                patternMod: patternMod,
                rotation: rotation,
                scale: scale,
                centerX: centerX,
                centerY: centerY,
                angularLobes: angularLobes,
                angularAmount: angularAmount,
                angularSpeed: angularSpeed
            )
        }
    }
}

// MARK: - Renderer (pure shader binding)

private struct SWAnimatedLoopRenderer: View {
    let style: SWAnimatedLoopStyle
    let shape: SWAnimatedLoopShape
    let petals: Int
    let color1: Color
    let color2: Color
    let color3: Color
    let background: Color
    let speed: Float
    let lineWidth: Float
    let lines: Int
    let spacing: Float
    let channelOffset: Float
    let patternMod: Float
    let rotation: Float
    let scale: Float
    let centerX: Float
    let centerY: Float
    let angularLobes: Float
    let angularAmount: Float
    let angularSpeed: Float

    @State private var start: Date = .now

    var body: some View {
        TimelineView(.animation) { ctx in
            let elapsed = Float(ctx.date.timeIntervalSince(start))
            background
                .colorEffect(
                    Shader(
                        function: ShaderFunction(library: .default, name: style.shaderName),
                        arguments: [
                            .boundingRect,
                            .float(elapsed),
                            .float(speed),
                            .float(lineWidth),
                            .float(Float(lines)),
                            .float(spacing),
                            .float(channelOffset),
                            .float(patternMod),
                            .float(rotation),
                            .float(scale),
                            .float2(centerX, centerY),
                            .float(Float(shape.rawValue)),
                            .float(Float(petals)),
                            .float(angularLobes),
                            .float(angularAmount),
                            .float(angularSpeed),
                            .color(color1),
                            .color(color2),
                            .color(color3),
                            .color(background)
                        ]
                    )
                )
        }
    }
}

// MARK: - Controlled Wrapper (gear toolbar item + live sheet)

private struct SWAnimatedLoopControlled: View {
    @State private var style: SWAnimatedLoopStyle
    @State private var shape: SWAnimatedLoopShape
    @State private var petals: Float
    @State private var color1: Color
    @State private var color2: Color
    @State private var color3: Color
    @State private var background: Color
    @State private var speed: Float
    @State private var lineWidth: Float
    @State private var lines: Float
    @State private var spacing: Float
    @State private var channelOffset: Float
    @State private var patternMod: Float
    @State private var rotation: Float
    @State private var scale: Float
    @State private var centerX: Float
    @State private var centerY: Float
    @State private var angularLobes: Float
    @State private var angularAmount: Float
    @State private var angularSpeed: Float

    @State private var showSheet = false

    init(initial: SWAnimatedLoop) {
        _style         = State(initialValue: initial.style)
        _shape         = State(initialValue: initial.shape)
        _petals        = State(initialValue: Float(initial.petals))
        _color1        = State(initialValue: initial.color1)
        _color2        = State(initialValue: initial.color2)
        _color3        = State(initialValue: initial.color3)
        _background    = State(initialValue: initial.background)
        _speed         = State(initialValue: initial.speed)
        _lineWidth     = State(initialValue: initial.lineWidth)
        _lines         = State(initialValue: Float(initial.lines))
        _spacing       = State(initialValue: initial.spacing)
        _channelOffset = State(initialValue: initial.channelOffset)
        _patternMod    = State(initialValue: initial.patternMod)
        _rotation      = State(initialValue: initial.rotation)
        _scale         = State(initialValue: initial.scale)
        _centerX       = State(initialValue: initial.centerX)
        _centerY       = State(initialValue: initial.centerY)
        _angularLobes  = State(initialValue: initial.angularLobes)
        _angularAmount = State(initialValue: initial.angularAmount)
        _angularSpeed  = State(initialValue: initial.angularSpeed)
    }

    /// Builder that produces a fresh renderer using the current
    /// live-tweaked state. Wrapped in a helper so the `body` stays short
    /// despite the renderer's 20-parameter initializer.
    private func makeRenderer() -> SWAnimatedLoopRenderer {
        SWAnimatedLoopRenderer(
            style: style,
            shape: shape,
            petals: Int(petals.rounded()),
            color1: color1,
            color2: color2,
            color3: color3,
            background: background,
            speed: speed,
            lineWidth: lineWidth,
            lines: Int(lines.rounded()),
            spacing: spacing,
            channelOffset: channelOffset,
            patternMod: patternMod,
            rotation: rotation,
            scale: scale,
            centerX: centerX,
            centerY: centerY,
            angularLobes: angularLobes,
            angularAmount: angularAmount,
            angularSpeed: angularSpeed
        )
    }

    var body: some View {
        // Style switching, parameter tweaks, and color picking all live in
        // the sheet — the body itself is just the full-screen renderer of
        // whichever style is currently selected.
        makeRenderer()
            .ignoresSafeArea()
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        showSheet = true
                    } label: {
                        Image(systemName: "slider.horizontal.3")
                    }
                    .accessibilityLabel("Animated Loop Controls")
                }
            }
            .sheet(isPresented: $showSheet) {
            SWAnimatedLoopControlsSheet(
                style: $style,
                shape: $shape,
                petals: $petals,
                color1: $color1,
                color2: $color2,
                color3: $color3,
                background: $background,
                speed: $speed,
                lineWidth: $lineWidth,
                lines: $lines,
                spacing: $spacing,
                channelOffset: $channelOffset,
                patternMod: $patternMod,
                rotation: $rotation,
                scale: $scale,
                centerX: $centerX,
                centerY: $centerY,
                angularLobes: $angularLobes,
                angularAmount: $angularAmount,
                angularSpeed: $angularSpeed,
                applyDefaults: applyDefaults
            )
            .presentationDetents([.medium])
            .presentationDragIndicator(.visible)
        }
    }

    /// Loads `style`'s hand-tuned numeric defaults into the live state.
    /// Invoked by the sheet's `onChange(style)` so each style ships with
    /// the ring parameters its author designed.
    private func applyDefaults(for s: SWAnimatedLoopStyle) {
        let d = s.numericDefaults
        speed         = d.speed
        lineWidth     = d.lineWidth
        lines         = Float(d.lines)
        spacing       = d.spacing
        channelOffset = d.channelOffset
        patternMod    = d.patternMod
    }
}

// MARK: - Controls Sheet

private struct SWAnimatedLoopControlsSheet: View {
    @Binding var style: SWAnimatedLoopStyle
    @Binding var shape: SWAnimatedLoopShape
    @Binding var petals: Float
    @Binding var color1: Color
    @Binding var color2: Color
    @Binding var color3: Color
    @Binding var background: Color
    @Binding var speed: Float
    @Binding var lineWidth: Float
    @Binding var lines: Float
    @Binding var spacing: Float
    @Binding var channelOffset: Float
    @Binding var patternMod: Float
    @Binding var rotation: Float
    @Binding var scale: Float
    @Binding var centerX: Float
    @Binding var centerY: Float
    @Binding var angularLobes: Float
    @Binding var angularAmount: Float
    @Binding var angularSpeed: Float

    /// Called by the sheet when `style` changes, so the parent can replace
    /// the numeric ring defaults to the new style's hand-tuned values.
    let applyDefaults: (SWAnimatedLoopStyle) -> Void

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section("Style") {
                    Picker("Style", selection: $style) {
                        ForEach(SWAnimatedLoopStyle.allCases) { s in
                            Text(s.displayName).tag(s)
                        }
                    }
                }

                // Shape sub-picker is only meaningful for the Shape style.
                if style.supportsShape {
                    Section("Shape") {
                        Picker("Shape", selection: $shape) {
                            ForEach(SWAnimatedLoopShape.allCases) { s in
                                Text(s.displayName).tag(s)
                            }
                        }

                        if shape == .star {
                            SWAnimatedLoopSliderRow(label: "Petals", value: $petals, range: 3...12, step: 1)
                        }
                    }
                }

                Section("Colors") {
                    ColorPicker("Channel 1",  selection: $color1,     supportsOpacity: false)
                    ColorPicker("Channel 2",  selection: $color2,     supportsOpacity: false)
                    ColorPicker("Channel 3",  selection: $color3,     supportsOpacity: false)
                    ColorPicker("Background", selection: $background, supportsOpacity: false)
                }

                Section("Rings") {
                    SWAnimatedLoopSliderRow(label: "Lines",          value: $lines,         range: 1...20,        step: 1)
                    SWAnimatedLoopSliderRow(label: "Spacing",        value: $spacing,       range: 0.5...20,      step: 0.1)
                    SWAnimatedLoopSliderRow(label: "Line Width",     value: $lineWidth,     range: 0.0001...0.02, step: 0.0001)
                    SWAnimatedLoopSliderRow(label: "Channel Offset", value: $channelOffset, range: -0.5...0.5,    step: 0.005)
                    SWAnimatedLoopSliderRow(label: "Pattern Mod",    value: $patternMod,    range: 0.01...2,      step: 0.01)
                }

                Section("Transform") {
                    SWAnimatedLoopSliderRow(label: "Rotation", value: $rotation, range: -3.14...3.14, step: 0.05)
                    SWAnimatedLoopSliderRow(label: "Scale",    value: $scale,    range: 0.2...5,      step: 0.05)
                    SWAnimatedLoopSliderRow(label: "Center X", value: $centerX,  range: -1...1,       step: 0.05)
                    SWAnimatedLoopSliderRow(label: "Center Y", value: $centerY,  range: -1...1,       step: 0.05)
                }

                Section("Motion") {
                    SWAnimatedLoopSliderRow(label: "Speed", value: $speed, range: 0...1, step: 0.01)
                }

                // Angular controls only apply to the Neon style.
                if style.supportsAngular {
                    Section("Angular (Neon)") {
                        SWAnimatedLoopSliderRow(label: "Lobes",  value: $angularLobes,  range: 1...12, step: 1)
                        SWAnimatedLoopSliderRow(label: "Amount", value: $angularAmount, range: 0...0.5, step: 0.005)
                        SWAnimatedLoopSliderRow(label: "Speed",  value: $angularSpeed,  range: 0...3, step: 0.05)
                    }
                }
            }
            .navigationTitle("Animated Loop")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
            // Style change → reload that style's hand-tuned numeric defaults
            // so each style ships with the look its author designed.
            .onChange(of: style) { _, newStyle in
                applyDefaults(newStyle)
            }
        }
    }
}

private struct SWAnimatedLoopSliderRow: View {
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

    /// Integer-stepped sliders render as whole numbers; sub-thousandth
    /// steps render with four decimals; everything else gets two.
    private var formattedValue: String {
        if step >= 1 {
            return "\(Int(value.rounded()))"
        } else if step < 0.001 {
            return String(format: "%.4f", value)
        } else {
            return String(format: "%.2f", value)
        }
    }
}
```

### SWAnimatedLoop.metal

```metal
#include <metal_stdlib>
#include <SwiftUI/SwiftUI_Metal.h>
using namespace metal;

// MARK: - Shape

[[ stitchable ]] half4 swAnimatedLoopShape(float2 position,
                                           half4  color,
                                           float4 boundingRect,
                                           float  time,
                                           float  speed,
                                           float  lineWidth,
                                           float  lines,
                                           float  spacing,
                                           float  channelOffset,
                                           float  patternMod,
                                           float  rotation,
                                           float  scale,
                                           float2 center,
                                           float  shape,
                                           float  petals,
                                           float  angularLobes,
                                           float  angularAmount,
                                           float  angularSpeed,
                                           half4  color1,
                                           half4  color2,
                                           half4  color3,
                                           half4  background) {
    // Angular params unused by this style — see file header.
    (void)angularLobes;
    (void)angularAmount;
    (void)angularSpeed;

    float2 size = boundingRect.zw;
    float2 uv   = (position * 2.0 - size) / min(size.x, size.y);

    uv = uv / max(scale, 0.0001);
    uv -= center;
    float c = cos(rotation);
    float s = sin(rotation);
    uv = float2(uv.x * c - uv.y * s, uv.x * s + uv.y * c);

    float t     = time * speed;
    int   count = max(1, int(lines));

    int   shapeIdx = int(shape);
    float d;
    if (shapeIdx == 1) {
        d = max(abs(uv.x), abs(uv.y));                      // square
    } else if (shapeIdx == 2) {
        d = abs(uv.x) * 1.6 + abs(uv.y) * 0.85;             // diamond pip
    } else if (shapeIdx == 3) {
        float2 q = abs(uv);
        d = max(q.x * 0.866025 + q.y * 0.5, q.y);           // hexagon
    } else if (shapeIdx == 4) {
        float ang = atan2(uv.y, uv.x);
        float r   = length(uv);
        d = r * (1.0 + 0.35 * cos(petals * ang));           // star
    } else {
        d = length(uv);                                     // circle
    }

    float pmm = max(patternMod, 0.0001);
    float m   = fmod(uv.x + uv.y, pmm);

    float3 ch[3] = { float3(color1.rgb), float3(color2.rgb), float3(color3.rgb) };

    float3 col = float3(0.0);
    for (int j = 0; j < 3; j++) {
        float acc = 0.0;
        for (int i = 0; i < count; i++) {
            float f = fract(t - channelOffset * float(j) + 0.01 * float(i)) * spacing - d + m;
            acc += lineWidth * float(i * i) / max(abs(f), 0.00001);
        }
        col += ch[j] * acc;
    }

    float3 bg = float3(background.rgb);
    return half4(half3(bg + col), 1.0);
}

// MARK: - Diamond

[[ stitchable ]] half4 swAnimatedLoopDiamond(float2 position,
                                             half4  color,
                                             float4 boundingRect,
                                             float  time,
                                             float  speed,
                                             float  lineWidth,
                                             float  lines,
                                             float  spacing,
                                             float  channelOffset,
                                             float  patternMod,
                                             float  rotation,
                                             float  scale,
                                             float2 center,
                                             float  shape,
                                             float  petals,
                                             float  angularLobes,
                                             float  angularAmount,
                                             float  angularSpeed,
                                             half4  color1,
                                             half4  color2,
                                             half4  color3,
                                             half4  background) {
    (void)shape;
    (void)petals;
    (void)angularLobes;
    (void)angularAmount;
    (void)angularSpeed;

    float2 size = boundingRect.zw;
    float2 uv   = (position * 2.0 - size) / min(size.x, size.y);

    uv = uv / max(scale, 0.0001);
    uv -= center;
    float c = cos(rotation);
    float s = sin(rotation);
    uv = float2(uv.x * c - uv.y * s, uv.x * s + uv.y * c);

    float t     = time * speed;
    int   count = max(1, int(lines));

    float d   = abs(uv.x) + abs(uv.y);
    float pmm = max(patternMod, 0.0001);
    float m   = fmod(uv.x * uv.y, pmm);

    float3 ch[3] = { float3(color1.rgb), float3(color2.rgb), float3(color3.rgb) };

    float3 col = float3(0.0);
    for (int j = 0; j < 3; j++) {
        float acc = 0.0;
        for (int i = 0; i < count; i++) {
            float f = fract(t - channelOffset * float(j) + 0.012 * float(i)) * spacing - d + m;
            acc += lineWidth * float(i * i) / max(abs(f), 0.00001);
        }
        col += ch[j] * acc;
    }

    float3 bg = float3(background.rgb);
    return half4(half3(bg + col), 1.0);
}

// MARK: - Neon

[[ stitchable ]] half4 swAnimatedLoopNeon(float2 position,
                                          half4  color,
                                          float4 boundingRect,
                                          float  time,
                                          float  speed,
                                          float  lineWidth,
                                          float  lines,
                                          float  spacing,
                                          float  channelOffset,
                                          float  patternMod,
                                          float  rotation,
                                          float  scale,
                                          float2 center,
                                          float  shape,
                                          float  petals,
                                          float  angularLobes,
                                          float  angularAmount,
                                          float  angularSpeed,
                                          half4  color1,
                                          half4  color2,
                                          half4  color3,
                                          half4  background) {
    (void)shape;
    (void)petals;

    float2 size = boundingRect.zw;
    float2 uv   = (position * 2.0 - size) / min(size.x, size.y);

    uv = uv / max(scale, 0.0001);
    uv -= center;
    float c = cos(rotation);
    float s = sin(rotation);
    uv = float2(uv.x * c - uv.y * s, uv.x * s + uv.y * c);

    float t     = time * speed;
    int   count = max(1, int(lines));

    float d   = length(uv);
    float pmm = max(patternMod, 0.0001);
    float m   = fmod(uv.x + uv.y, pmm);
    float ang = atan2(uv.y, uv.x);

    float3 ch[3] = { float3(color1.rgb), float3(color2.rgb), float3(color3.rgb) };

    float3 col = float3(0.0);
    for (int j = 0; j < 3; j++) {
        float angularShift = sin(ang * angularLobes + time * angularSpeed + float(j)) * angularAmount;
        float acc = 0.0;
        for (int i = 0; i < count; i++) {
            float f = fract(t - channelOffset * float(j) + 0.01 * float(i)) * spacing - d + angularShift + m;
            acc += lineWidth * float(i * i) / max(abs(f), 0.00001);
        }
        col += ch[j] * acc;
    }
    // Baked-in cool/warm RGB boost — part of the Neon style identity.
    col *= float3(1.1, 0.8, 1.2);

    float3 bg = float3(background.rgb);
    return half4(half3(bg + col), 1.0);
}

// MARK: - Warp

[[ stitchable ]] half4 swAnimatedLoopWarp(float2 position,
                                          half4  color,
                                          float4 boundingRect,
                                          float  time,
                                          float  speed,
                                          float  lineWidth,
                                          float  lines,
                                          float  spacing,
                                          float  channelOffset,
                                          float  patternMod,
                                          float  rotation,
                                          float  scale,
                                          float2 center,
                                          float  shape,
                                          float  petals,
                                          float  angularLobes,
                                          float  angularAmount,
                                          float  angularSpeed,
                                          half4  color1,
                                          half4  color2,
                                          half4  color3,
                                          half4  background) {
    (void)shape;
    (void)petals;
    (void)angularLobes;
    (void)angularAmount;
    (void)angularSpeed;

    float2 size = boundingRect.zw;
    float2 uv   = (position * 2.0 - size) / min(size.x, size.y);

    uv = uv / max(scale, 0.0001);
    uv -= center;
    float c = cos(rotation);
    float s = sin(rotation);
    uv = float2(uv.x * c - uv.y * s, uv.x * s + uv.y * c);

    float t     = time * speed;
    int   count = max(1, int(lines));

    float d   = length(uv * float2(0.4, 1.0));
    float pmm = max(patternMod, 0.0001);
    float m   = fmod(uv.x, pmm);

    float3 ch[3] = { float3(color1.rgb), float3(color2.rgb), float3(color3.rgb) };

    float3 col = float3(0.0);
    for (int j = 0; j < 3; j++) {
        float acc = 0.0;
        for (int i = 0; i < count; i++) {
            float f = fract(t - channelOffset * float(j) + 0.015 * float(i)) * spacing - d + m;
            acc += lineWidth * float(i * i) / max(abs(f), 0.00001);
        }
        col += ch[j] * acc;
    }

    float3 bg = float3(background.rgb);
    return half4(half3(bg + col), 1.0);
}
```

## Usage

```swift
// Default — Shape style, circle, red/green/blue rings on black
ZStack {
    SWAnimatedLoop()
        .ignoresSafeArea()
}

// Switch styles — each style auto-loads its hand-tuned numeric defaults
SWAnimatedLoop(style: .diamond)
SWAnimatedLoop(style: .neon)
SWAnimatedLoop(style: .warp)

// Within Shape style, pick a geometric shape
SWAnimatedLoop(style: .shape, shape: .hexagon)
SWAnimatedLoop(style: .shape, shape: .star, petals: 7)

// As a section background
myContent
    .background { SWAnimatedLoop(style: .neon) }

// Brand-recolored — replace the RGB channels
SWAnimatedLoop(
    style: .warp,
    color1: .pink,
    color2: .cyan,
    color3: .yellow,
    background: .black
)
```

## Parameters

| Parameter | Type | Default | Notes |
|---|---|---|---|
| `style` | `SWAnimatedLoopStyle` | `.shape` | `shape` / `diamond` / `neon` / `warp` |
| `shape` | `SWAnimatedLoopShape` | `.circle` | **Style-specific** — only honored when `style == .shape`; one of `circle` / `square` / `diamond` / `hexagon` / `star` |
| `petals` | `Int` | `5` | **Style-specific** — only honored when `style == .shape && shape == .star`; range 3…12 |
| `color1`, `color2`, `color3` | `Color` | `.red`, `.green`, `.blue` | Three RGB channel colors, additively composited per-pixel |
| `background` | `Color` | `.black` | Color rendered behind the rings |
| `speed` | `Float?` | `nil` → `style.numericDefaults.speed` | Time multiplier on the ring sweep (style-specific default) |
| `lineWidth` | `Float?` | `nil` → 0.002 | Per-ring line thickness |
| `lines` | `Int?` | `nil` → `style.numericDefaults.lines` | Number of concentric rings (1…20) |
| `spacing` | `Float?` | `nil` → `style.numericDefaults.spacing` | Distance multiplier between rings (0.5…20) |
| `channelOffset` | `Float?` | `nil` → `style.numericDefaults.channelOffset` | Phase offset between RGB channels (-0.5…0.5) |
| `patternMod` | `Float?` | `nil` → `style.numericDefaults.patternMod` | Period of the pattern term overlaid on the rings (0.01…2) |
| `rotation` | `Float` | `0.0` | Rotation in radians (-π…π) |
| `scale` | `Float` | `1.0` | Spatial scale (0.2…5) |
| `centerX`, `centerY` | `Float` | `0.0`, `0.0` | Ring origin offset (-1…1 each) |
| `angularLobes` | `Float` | `3.0` | **Style-specific** — only used by Neon; integer lobe count for per-channel angular wobble (1…12) |
| `angularAmount` | `Float` | `0.08` | **Style-specific** — only used by Neon; wobble amplitude (0…0.5) |
| `angularSpeed` | `Float` | `0.5` | **Style-specific** — only used by Neon; wobble angular frequency (0…3) |
| `showsControls` | `Bool` | `false` | Demo-only gear ToolbarItem; requires `NavigationStack` |

**Style numeric defaults (loaded automatically):**

| Style | speed | lineWidth | lines | spacing | channelOffset | patternMod |
|---|---|---|---|---|---|---|
| `shape` | 0.05 | 0.002 | 5 | 5.0 | 0.01 | 0.20 |
| `diamond` | 0.05 | 0.002 | 6 | 5.0 | 0.01 | 0.15 |
| `neon` | 0.06 | 0.002 | 5 | 5.0 | 0.01 | 0.20 |
| `warp` | 0.07 | 0.002 | 6 | 4.0 | 0.008 | 0.30 |

## Integration Checklist

1. Copy `SWAnimatedLoop.swift` and `SWAnimatedLoop.metal` into your Xcode target.
2. Confirm the deployment target is iOS 18+ / macOS 15+.
3. Pick a style — `SWAnimatedLoop(style: .warp)` is a single line; each style ships with its author-tuned numeric defaults.
4. For the Shape style, additionally pick a geometric `shape:`; for `.star`, optionally set `petals:`.
5. For Neon, optionally tune `angularLobes` / `angularAmount` / `angularSpeed` to control the per-channel wobble.
6. Replace `color1` / `color2` / `color3` (and optionally `background`) for brand-aligned palettes.

## Notes / Gotchas

- All four entry points take the same 18-parameter signature so the Swift renderer can use a single argument list and dispatch by name. Parameters that don't apply to a given style are explicitly cast away with `(void)x;` to make "unused on purpose" decisions explicit in the shader source.
- When `showsControls` is `true`, the sheet's Style picker resets the numeric ring parameters (`speed`, `lines`, `spacing`, `channelOffset`, `patternMod`) to the new style's hand-tuned defaults — intentional, so each style ships with the look its author designed.
- The Shape selector and Star petals slider are hidden in the sheet unless `style == .shape`. The Angular section appears only for `style == .neon`. Parameters that don't apply to the current style are still passed to the shader but ignored there.
- The Neon style applies a **baked-in RGB boost** `(1.1, 0.8, 1.2)` after the additive composite — part of its style identity, do not parameterize.
- `scale` and `patternMod` are both clamped internally to `>= 0.0001` so zero / negative input is safe.
- The gear button is a native `ToolbarItem` — the call site must be inside a `NavigationStack`.
