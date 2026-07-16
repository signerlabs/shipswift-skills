---
id: animation-animated-loop
title: Animated Loop
description: Pulsing concentric rings in one of four hand-tuned styles (Shape / Diamond / Neon / Warp) with three RGB-channel colors and per-channel phase offset — Shape style adds a geometric sub-picker (circle / square / diamond / hexagon / star)
tier: free
tags: [animation, metal, shader, rings, loop, splash, background, SwiftUI]
---

## Overview

Family of full-screen pulsing concentric-ring animations rendered through SwiftUI's `colorEffect` Metal pipeline. Four hand-tuned styles share the same per-line phase ramp, RGB-channel split, and additive composite logic; they only differ in the distance metric `d` and the pattern term `m`. The `Shape` style additionally exposes a 5-way geometric selector (circle / square / diamond pip / hexagon / star with petal count); the `Neon` style adds three angular-wobble parameters.

Requires iOS 17+ / macOS 14+.

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

// (Optional `SWAnimatedLoopControlled` + `SWAnimatedLoopControlsSheet`
// provide a gear ToolbarItem and a Form-based live-tuning sheet. The sheet
// hides Shape selector / Star petals / Angular section based on the current
// style. Style change reloads the numeric defaults — intentional. Omit in
// production builds.)
```

### SWAnimatedLoop.metal

```metal
#include <metal_stdlib>
#include <SwiftUI/SwiftUI_Metal.h>
using namespace metal;

// MARK: - Shape — user-pickable shape (circle / square / diamond pip /
//                                       hexagon / star)

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

// MARK: - Diamond — L1 distance rings + multiplicative pattern

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

// MARK: - Neon — circle rings + per-channel angular wobble + baked-in RGB boost

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

// MARK: - Warp — stretched-ellipse rings + 1D pattern

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
2. Confirm the deployment target is iOS 17+ / macOS 14+.
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
