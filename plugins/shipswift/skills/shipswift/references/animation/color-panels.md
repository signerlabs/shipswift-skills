---
id: animation-color-panels
title: Color Panels
description: Pseudo-3D rotating panels procedural background — 1–7 semi-transparent color panels rotating around a central vertical axis with edge highlight, skew, side blur, fade-in/out, and per-panel gradient mixing
tier: free
tags: [animation, metal, shader, SwiftUI]
---

## Overview

Programmatic background of pseudo-3D semi-transparent panels rotating around a central vertical axis. Analytic perspective projection — for each pixel the shader walks 12–20 candidate panels (count is colors-count-dependent so the wheel reads coherently), checks z-depth and lateral position, and composites the surviving fragment. Two interleaved sets (forward / reverse rotation) keep the wheel continuous.

Requires iOS 17+ / macOS 14+ (SwiftUI `ShaderLibrary` / `Shader` / Metal `stitchable`).

## File Layout

```
SWAnimation/SWMetal/
  SWColorPanels.swift
  SWColorPanels.metal
```

## Source Code

### SWColorPanels.swift

```swift
//
//  SWColorPanels.swift
//  ShipSwift
//
//  A SwiftUI Metal `colorEffect`. Pseudo-3D semi-transparent panels
//  rotating around a central vertical axis.
//
//  Algorithm: analytic perspective projection — for each pixel the
//  shader walks 12–20 candidate panels (count depends on `colors.count`
//  so the wheel reads coherently), checks z-depth & lateral position,
//  and composites the surviving fragment. Two interleaved sets
//  (forward / reverse rotation) keep the wheel continuous.
//
//  Requires iOS 17+ / macOS 14+ (SwiftUI `ShaderLibrary`, `colorEffect`,
//  Metal `stitchable`).
//
//  Usage:
//    // Default — red / yellow / cyan / pink on a deep blue back, full-screen
//    SWColorPanels()
//        .ignoresSafeArea()
//
//    // Recolor — pastels on white
//    SWColorPanels(
//        colors: [.pink, .yellow, .mint, .indigo],
//        colorBack: .white
//    )
//
//    // As a section background
//    myContent.background { SWColorPanels() }
//
//    // Demo / debug — adds a gear button that opens a live-tuning sheet.
//    SWColorPanels(showsControls: true)
//
//  Parameters:
//    - colors:       1–7 panel palette colors (default red / yellow /
//                    cyan / pink).
//    - colorBack:    Background color behind the panels
//                    (default deep indigo `#0E0E14`).
//    - density:      Angle between consecutive panels, 0.25...7
//                    (default 2.0; smaller = denser fan).
//    - angle1:       Top-edge skew, -1...1 (default 0).
//    - angle2:       Bottom-edge skew, -1...1 (default 0).
//    - panelLength:  Panel length relative to height, 0.05...3
//                    (default 1.0).
//    - edges:        Edge highlight on/off (default `true`).
//    - blur:         Side blur in 0...0.5 (default 0.1, 0 = sharp).
//    - fadeIn:       Transparency near the central axis in 0...1
//                    (default 0.5).
//    - fadeOut:      Transparency near the viewer in 0...1
//                    (default 0.5).
//    - gradient:     Intra-panel color mixing in 0...1
//                    (default 0; 0 = solid, 1 = gradient).
//    - scale:        Overall zoom in 0.05...4 (default 1.0).
//    - speed:        Multiplier on the internal animation time
//                    (default 1.0).
//    - showsControls: Attach a gear `ToolbarItem` that opens a
//                     live-tuning sheet (default `false`).
//

import SwiftUI

// MARK: - Main View

struct SWColorPanels: View {
    /// 1–7 panel palette colors. Extra entries beyond 7 are dropped.
    var colors: [Color] = [
        Color(red: 0.95, green: 0.20, blue: 0.30),  // red
        Color(red: 0.98, green: 0.85, blue: 0.20),  // yellow
        Color(red: 0.25, green: 0.85, blue: 0.95),  // cyan
        Color(red: 0.95, green: 0.40, blue: 0.75)   // pink
    ]

    /// Background color.
    var colorBack: Color = Color(red: 0.055, green: 0.055, blue: 0.08)  // #0E0E14

    /// Angle between consecutive panels, 0.25...7.
    var density: Float = 2.0

    /// Top-edge skew, -1...1.
    var angle1: Float = 0.0

    /// Bottom-edge skew, -1...1.
    var angle2: Float = 0.0

    /// Panel length relative to height, 0.05...3.
    var panelLength: Float = 1.0

    /// Edge highlight on/off.
    var edges: Bool = true

    /// Side blur in 0...0.5.
    var blur: Float = 0.1

    /// Transparency near the central axis in 0...1.
    var fadeIn: Float = 0.5

    /// Transparency near the viewer in 0...1.
    var fadeOut: Float = 0.5

    /// Intra-panel color mixing in 0...1 (0 = solid, 1 = gradient).
    var gradient: Float = 0.0

    /// Overall zoom in 0.05...4.
    var scale: Float = 1.0

    /// Multiplier on the internal animation time.
    var speed: Float = 1.0

    /// When `true`, attaches a gear `ToolbarItem` that opens a
    /// live-tuning sheet.
    var showsControls: Bool = false

    var body: some View {
        if showsControls {
            SWColorPanelsControlled(initial: self)
        } else {
            SWColorPanelsRenderer(
                colors: colors,
                colorBack: colorBack,
                density: density,
                angle1: angle1,
                angle2: angle2,
                panelLength: panelLength,
                edges: edges,
                blur: blur,
                fadeIn: fadeIn,
                fadeOut: fadeOut,
                gradient: gradient,
                scale: scale,
                speed: speed
            )
        }
    }
}

// MARK: - Renderer

private struct SWColorPanelsRenderer: View {
    let colors: [Color]
    let colorBack: Color
    let density: Float
    let angle1: Float
    let angle2: Float
    let panelLength: Float
    let edges: Bool
    let blur: Float
    let fadeIn: Float
    let fadeOut: Float
    let gradient: Float
    let scale: Float
    let speed: Float

    @State private var start: Date = .now

    var body: some View {
        let slots = paddedSlots(colors)
        let colorsCount = Float(max(min(colors.count, 7), 1))

        TimelineView(.animation) { ctx in
            let elapsed = Float(ctx.date.timeIntervalSince(start)) * speed
            // Base layer must be opaque — `colorBack` doubles as the
            // first-frame fallback before the shader is invoked.
            colorBack
                .colorEffect(
                    ShaderLibrary.swColorPanels(
                        .boundingRect,
                        .float(elapsed),
                        .float(scale),
                        .float(colorsCount),
                        .float(density),
                        .float(angle1),
                        .float(angle2),
                        .float(panelLength),
                        .float(edges ? 1.0 : 0.0),
                        .float(blur),
                        .float(fadeIn),
                        .float(fadeOut),
                        .float(gradient),
                        .color(colorBack),
                        .color(slots[0]),
                        .color(slots[1]),
                        .color(slots[2]),
                        .color(slots[3]),
                        .color(slots[4]),
                        .color(slots[5]),
                        .color(slots[6])
                    )
                )
        }
    }

    /// Pad palette to exactly 7 entries by repeating the tail color.
    /// Slots beyond `colorsCount` are not used by the shader; padding
    /// just keeps the parameter list well-formed.
    private func paddedSlots(_ src: [Color]) -> [Color] {
        var out = Array(src.prefix(7))
        let tail = out.last ?? .black
        while out.count < 7 { out.append(tail) }
        return out
    }
}

// MARK: - Controlled Wrapper (gear toolbar item + live sheet)

private struct SWColorPanelsControlled: View {
    @State private var colors: [Color]
    @State private var colorBack: Color
    @State private var density: Float
    @State private var angle1: Float
    @State private var angle2: Float
    @State private var panelLength: Float
    @State private var edges: Bool
    @State private var blur: Float
    @State private var fadeIn: Float
    @State private var fadeOut: Float
    @State private var gradient: Float
    @State private var scale: Float
    @State private var speed: Float

    @State private var showSheet = false

    init(initial: SWColorPanels) {
        let trimmed = Array(initial.colors.prefix(7))
        _colors      = State(initialValue: trimmed.isEmpty ? [.white] : trimmed)
        _colorBack   = State(initialValue: initial.colorBack)
        _density     = State(initialValue: initial.density)
        _angle1      = State(initialValue: initial.angle1)
        _angle2      = State(initialValue: initial.angle2)
        _panelLength = State(initialValue: initial.panelLength)
        _edges       = State(initialValue: initial.edges)
        _blur        = State(initialValue: initial.blur)
        _fadeIn      = State(initialValue: initial.fadeIn)
        _fadeOut     = State(initialValue: initial.fadeOut)
        _gradient    = State(initialValue: initial.gradient)
        _scale       = State(initialValue: initial.scale)
        _speed       = State(initialValue: initial.speed)
    }

    var body: some View {
        SWColorPanelsRenderer(
            colors: colors,
            colorBack: colorBack,
            density: density,
            angle1: angle1,
            angle2: angle2,
            panelLength: panelLength,
            edges: edges,
            blur: blur,
            fadeIn: fadeIn,
            fadeOut: fadeOut,
            gradient: gradient,
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
                .accessibilityLabel("Color Panels Controls")
            }
        }
        .sheet(isPresented: $showSheet) {
            SWColorPanelsControlsSheet(
                colors: $colors,
                colorBack: $colorBack,
                density: $density,
                angle1: $angle1,
                angle2: $angle2,
                panelLength: $panelLength,
                edges: $edges,
                blur: $blur,
                fadeIn: $fadeIn,
                fadeOut: $fadeOut,
                gradient: $gradient,
                scale: $scale,
                speed: $speed
            )
            .presentationDetents([.medium, .large])
            .presentationDragIndicator(.visible)
        }
    }
}

// MARK: - Controls Sheet

private struct SWColorPanelsControlsSheet: View {
    @Binding var colors: [Color]
    @Binding var colorBack: Color
    @Binding var density: Float
    @Binding var angle1: Float
    @Binding var angle2: Float
    @Binding var panelLength: Float
    @Binding var edges: Bool
    @Binding var blur: Float
    @Binding var fadeIn: Float
    @Binding var fadeOut: Float
    @Binding var gradient: Float
    @Binding var scale: Float
    @Binding var speed: Float

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    ForEach(colors.indices, id: \.self) { i in
                        ColorPicker("Panel \(i + 1)",
                                    selection: $colors[i],
                                    supportsOpacity: true)
                    }
                    ColorPicker("Background",
                                selection: $colorBack,
                                supportsOpacity: false)
                } header: {
                    HStack {
                        Text("Palette (\(colors.count) / 7)")
                        Spacer()
                        Button {
                            if colors.count > 1 { colors.removeLast() }
                        } label: {
                            Image(systemName: "minus.circle")
                        }
                        .disabled(colors.count <= 1)
                        Button {
                            if colors.count < 7 {
                                colors.append(colors.last ?? .white)
                            }
                        } label: {
                            Image(systemName: "plus.circle")
                        }
                        .disabled(colors.count >= 7)
                    }
                }

                Section("Wheel") {
                    SliderRow(label: "Density",  value: $density,     range: 0.25...7,  step: 0.05)
                    SliderRow(label: "Length",   value: $panelLength, range: 0.05...3,  step: 0.05)
                    SliderRow(label: "Scale",    value: $scale,       range: 0.05...4,  step: 0.05)
                }

                Section("Skew") {
                    SliderRow(label: "Angle 1",  value: $angle1, range: -1...1, step: 0.01)
                    SliderRow(label: "Angle 2",  value: $angle2, range: -1...1, step: 0.01)
                }

                Section("Material") {
                    Toggle("Edge Highlight", isOn: $edges)
                    SliderRow(label: "Side Blur", value: $blur,     range: 0...0.5, step: 0.01)
                    SliderRow(label: "Fade In",   value: $fadeIn,   range: 0...1,   step: 0.01)
                    SliderRow(label: "Fade Out",  value: $fadeOut,  range: 0...1,   step: 0.01)
                    SliderRow(label: "Gradient",  value: $gradient, range: 0...1,   step: 0.01)
                }

                Section("Motion") {
                    SliderRow(label: "Speed", value: $speed, range: 0...3, step: 0.05)
                }
            }
            .navigationTitle("Color Panels")
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
        SWColorPanels(showsControls: true)
    }
}

#Preview("Pastel on white") {
    SWColorPanels(
        colors: [.pink, .yellow, .mint, .indigo],
        colorBack: .white
    )
    .ignoresSafeArea()
}
```

### SWColorPanels.metal

```metal
//
//  SWColorPanels.metal
//  ShipSwift
//
//  Color-panels procedural background as a SwiftUI Metal `colorEffect`.
//
//  Algorithm: pseudo-3D semi-transparent panels rotating around a
//  central vertical axis. Each panel is rendered analytically via a
//  perspective-projection trick: given a panel angle, derive z-depth
//  per pixel and decide which side of the panel we're on. Panels
//  spawn in two interleaved sets (forward / reverse) so the wheel
//  appears continuous. Panel count is colors-count-dependent (12 / 16 /
//  20 / 14) so the cycle stays visually coherent.
//

#include <metal_stdlib>
using namespace metal;

namespace SWColorPanelsImpl {
    constant float zLimit = 0.5;
    constant float TWO_PI = 6.28318530718;
    constant float PI     = 3.14159265358979;

    // Analytic perspective projection of one panel.
    // Returns (panelMask, panelMap) where:
    //   panelMask : how strongly this pixel belongs to the panel
    //   panelMap  : 0 at the far edge, 1 at the near edge
    inline float2 getPanel(float angle,
                           float2 uv,
                           float invLength,
                           float aa,
                           float a1,
                           float a2,
                           float blur,
                           float scale,
                           bool  edges)
    {
        float sinA = sin(angle);
        float cosA = cos(angle);

        float denom = sinA - uv.y * cosA;
        if (abs(denom) < 0.01) return float2(0.0);

        float z = uv.y / denom;
        if (z <= 0.0 || z > zLimit) return float2(0.0);

        float zRatio   = z / zLimit;
        float panelMap = 1.0 - zRatio;
        float x        = uv.x * (cosA * z + 1.0) * invLength;

        float zOffset = zRatio - 0.5;
        float left    = -0.5 + zOffset * a1;
        float right   =  0.5 - zOffset * a2;
        float blurX   = aa + 2.0 * panelMap * blur;

        float leftEdge1  = left  - blurX;
        float leftEdge2  = left  + 0.25 * blurX;
        float rightEdge1 = right - 0.25 * blurX;
        float rightEdge2 = right + blurX;

        float panel = smoothstep(leftEdge1, leftEdge2, x) *
                      (1.0 - smoothstep(rightEdge1, rightEdge2, x));
        panel *= mix(0.0, panel,
                     smoothstep(0.0, 0.01 / max(scale, 1e-6), panelMap));

        float midScreen = abs(sinA);
        if (edges) {
            panelMap = mix(0.99, panelMap,
                           panel * clamp(panelMap / (0.15 * (1.0 - pow(midScreen, 0.1))),
                                         0.0, 1.0));
        } else if (midScreen < 0.07) {
            panel *= (midScreen * 15.0);
        }

        return float2(panel, panelMap);
    }

    // Composite one panel's color onto the running buffer.
    inline float4 blendColor(float4 colorA,
                             float  panelMask,
                             float  panelMap,
                             float  fadeIn,
                             float  fadeOut)
    {
        float fade = 1.0 - smoothstep(0.97 - 0.97 * fadeIn, 1.0, panelMap);
        fade *= smoothstep(-0.2 * (1.0 - fadeOut), fadeOut, panelMap);

        float3 blendedRGB = mix(float3(0.0), colorA.rgb, fade);
        float  blendedA   = mix(0.0, colorA.a, fade);
        return float4(blendedRGB, blendedA) * panelMask;
    }
}

// Pseudo-3D rotating Color-Panels background.
//
// Parameters:
//   - position       : pixel position (`SwiftUI::Layer`-relative).
//   - currentColor   : source color from `.colorEffect` (unused).
//   - boundingRect   : `(x, y, w, h)` of the view's bounding rect.
//   - time           : seconds since the renderer started.
//   - scale          : overall zoom (used for anti-aliasing scaling).
//   - colorsCountF   : number of active palette entries, 1...7.
//   - density        : angle between consecutive panels, 0.25...7.
//   - angle1         : top-edge skew, -1...1.
//   - angle2         : bottom-edge skew, -1...1.
//   - panelLength    : panel length relative to height, 0.05...3.
//   - edgesF         : 0 or 1 — edge highlight on/off.
//   - blur           : side blur (0 = sharp), 0...0.5.
//   - fadeIn         : transparency near the central axis, 0...1.
//   - fadeOut        : transparency near the viewer, 0...1.
//   - gradient       : intra-panel color mixing (0 = solid, 1 = gradient), 0...1.
//   - colorBack      : background color (premultiplied alpha respected).
//   - c0...c6        : up to 7 panel palette colors.
[[ stitchable ]] half4 swColorPanels(
    float2 position,
    half4  currentColor,
    float4 boundingRect,
    float  time,
    float  scale,
    float  colorsCountF,
    float  density,
    float  angle1,
    float  angle2,
    float  panelLength,
    float  edgesF,
    float  blur,
    float  fadeIn,
    float  fadeOut,
    float  gradient,
    half4  colorBack,
    half4  c0, half4 c1, half4 c2, half4 c3, half4 c4, half4 c5, half4 c6
) {
    using namespace SWColorPanelsImpl;

    float2 size   = boundingRect.zw;
    float  maxDim = max(max(size.x, size.y), 1.0);

    // Object UV: centered, normalized so the wheel fills the longest
    // edge of the view (so a tall iPhone shows a full-screen fan, not
    // a strip in the middle).
    float2 uv = (position - 0.5 * size) / (0.5 * maxDim);
    uv /= max(scale, 0.001);
    uv *= 1.25;

    float t = 0.02 * time;
    t = fract(t);
    bool reverseTime = (t < 0.5);

    float3 color   = float3(0.0);
    float  opacity = 0.0;

    float aa = 0.005 / max(scale, 0.001);
    int colorsCount = clamp(int(colorsCountF), 1, 7);

    // Local premultiplied palette.
    half4 cs[7];
    cs[0] = c0; cs[1] = c1; cs[2] = c2; cs[3] = c3;
    cs[4] = c4; cs[5] = c5; cs[6] = c6;
    for (int i = 0; i < 7; i++) {
        if (i >= colorsCount) break;
        half4 c = cs[i];
        c.rgb *= c.a;
        cs[i] = c;
    }

    float invLength = 1.5 / max(panelLength, 0.001);

    int   panelsNumber      = 12;
    float densityNormalizer = 1.0;
    if      (colorsCount == 4) { panelsNumber = 16; densityNormalizer = 1.34; }
    else if (colorsCount == 5) { panelsNumber = 20; densityNormalizer = 1.67; }
    else if (colorsCount == 7) { panelsNumber = 14; densityNormalizer = 1.17; }

    float fPanelsNumber = float(panelsNumber);
    float panelGrad     = 1.0 - clamp(gradient, 0.0, 1.0);
    bool  edges         = (edgesF > 0.5);

    for (int set = 0; set < 2; set++) {
        bool isForward = (set == 0 && !reverseTime) || (set == 1 && reverseTime);
        if (!isForward) continue;

        // Forward-rotating panels.
        for (int i = 0; i <= 20; i++) {
            if (i >= panelsNumber) break;
            int   idx    = panelsNumber - 1 - i;
            float offset = float(idx) / fPanelsNumber;
            if (set == 1) offset += 0.5;

            float densityFract = densityNormalizer * fract(t + offset);
            float angleNorm    = densityFract / max(density, 0.001);
            if (densityFract >= 0.5 || angleNorm >= 0.3) continue;

            float smoothDensity = clamp((0.5 - densityFract) / 0.1, 0.0, 1.0) *
                                  clamp(densityFract / 0.01, 0.0, 1.0);
            float smoothAngle   = clamp((0.3 - angleNorm) / 0.05, 0.0, 1.0);
            if (smoothDensity * smoothAngle < 0.001) continue;

            if (angleNorm > 0.5) angleNorm = 0.5;

            float2 panel = getPanel(angleNorm * TWO_PI + PI, uv,
                                    invLength, aa, angle1, angle2,
                                    blur, scale, edges);
            if (panel.x <= 0.001) continue;

            float panelMask = panel.x * smoothDensity * smoothAngle;
            float panelMap  = panel.y;

            int colorIdx     = idx % colorsCount;
            int nextColorIdx = (idx + 1) % colorsCount;
            float4 colorA = float4(cs[colorIdx]);
            float4 colorB = float4(cs[nextColorIdx]);

            colorA = mix(colorA, colorB,
                         max(0.0, smoothstep(0.0, 0.45, panelMap) - panelGrad));
            float4 blended = blendColor(colorA, panelMask, panelMap, fadeIn, fadeOut);
            color   = blended.rgb + color * (1.0 - blended.a);
            opacity = blended.a   + opacity * (1.0 - blended.a);
        }

        // Reverse-rotating panels (mirrored across the axis).
        for (int i = 0; i <= 20; i++) {
            if (i >= panelsNumber) break;
            int   idx    = panelsNumber - 1 - i;
            float offset = float(idx) / fPanelsNumber;
            if (set == 0) offset += 0.5;

            float densityFract = densityNormalizer * fract(-t + offset);
            float angleNorm    = -densityFract / max(density, 0.001);
            if (densityFract >= 0.5 || angleNorm < -0.3) continue;

            float smoothDensity = clamp((0.5 - densityFract) / 0.1, 0.0, 1.0) *
                                  clamp(densityFract / 0.01, 0.0, 1.0);
            float smoothAngle   = clamp((angleNorm + 0.3) / 0.05, 0.0, 1.0);
            if (smoothDensity * smoothAngle < 0.001) continue;

            float2 panel = getPanel(angleNorm * TWO_PI + PI, uv,
                                    invLength, aa, angle1, angle2,
                                    blur, scale, edges);
            float panelMask = panel.x * smoothDensity * smoothAngle;
            if (panelMask <= 0.001) continue;
            float panelMap = panel.y;

            int colorIdx     = (colorsCount - (idx % colorsCount)) % colorsCount;
            if (colorIdx < 0) colorIdx += colorsCount;
            int nextColorIdx = (colorIdx + 1) % colorsCount;

            float4 colorA = float4(cs[colorIdx]);
            float4 colorB = float4(cs[nextColorIdx]);
            colorA = mix(colorA, colorB,
                         max(0.0, smoothstep(0.0, 0.45, panelMap) - panelGrad));
            float4 blended = blendColor(colorA, panelMask, panelMap, fadeIn, fadeOut);
            color   = blended.rgb + color * (1.0 - blended.a);
            opacity = blended.a   + opacity * (1.0 - blended.a);
        }
    }

    // Composite onto background.
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
