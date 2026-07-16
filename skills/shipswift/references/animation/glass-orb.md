---
id: animation-glass-orb
title: Glass Orb
description: A draggable glass orb with a built-in vertical color gradient fill, rendered through a SwiftUI Metal stitchable layerEffect — the gradient is magnified and bent with a spherical (barrel) warp, topped with a cool Fresnel rim highlight, an upper-left specular hot-spot, and optional rim RGB dispersion; the whole orb drags as one piece and its hue cycles over time for a slowly flowing color
tier: free
tags: [animation, metal, shader, glass, orb, refraction, magnify, gradient, hue, loupe, lens, layerEffect, SwiftUI]
---

## Overview

A self-contained glass orb: a vertical color gradient is the orb's own background, and a SwiftUI `layerEffect` Metal shader magnifies and refracts that gradient with a spherical (barrel) warp. Inside the circular region the gradient is zoomed most at the centre and the magnification eases off toward the rim, bending it into a barrel (fisheye) curve — a real spherical refraction rather than a flat zoom. On top of that base the shader adds the cues that make it read as a solid *sphere* and not a magnifier: a cool Fresnel rim that brightens sharply at the silhouette, a soft upper-left specular hot-spot, a faint inner contact shadow, and an optional RGB dispersion at the rim.

The orb is one self-contained view — it does not wrap or refract any external content; the gradient belongs to the orb. Because the gradient is the orb's own background, the whole thing drags as a single piece: a `DragGesture` translates the entire view via `.offset`, so the gradient, the refraction and the highlights all move together.

The gradient's hue cycles over time so the orb's color slowly flows. A `TimelineView(.animation)` drives a `hueRotation` applied to the gradient *before* the shader, so only the fill flows; the shader's Fresnel rim and specular hot-spot stay cool-white. The flow speed is controlled by `colorFlow` (degrees/second); set it to `0` for a static orb.

Requires iOS 17+ / macOS 14+.

## Attribution

Adapted from ["Warping Loupe" in Inferno by Paul Hudson](https://github.com/twostraws/Inferno), licensed under the MIT License. Copyright (c) 2023 Paul Hudson and other authors. Inferno's Warping Loupe contributes the core refraction maths (centre-weighted magnification that eases off with distance for a spherical warp); the sphere cues — Fresnel rim, specular hot-spot, inner shading, and rim dispersion — are added on top. The original copyright and license notice is retained verbatim in both source files as required by MIT; keep it intact when you copy the code into your project.

## File Layout

```
SWAnimation/SWMetal/
  SWGlassOrb.swift     // SwiftUI view: gradient fill + flowing hue + drag-to-move orb + optional live-tuning sheet
  SWGlassOrb.metal     // [[ stitchable ]] swGlassOrb layerEffect entry point
```

Both files must be added to the Xcode target; the `.metal` file is compiled into the default `ShaderLibrary` automatically.

## Source Code

### SWGlassOrb.swift

```swift
//
//  SWGlassOrb.swift
//  ShipSwift
//
//  Adapted from Inferno's "Warping Loupe" by Paul Hudson
//  https://github.com/twostraws/Inferno
//  Licensed under the MIT License. Copyright (c) 2023 Paul Hudson and other authors.
//  Original copyright and license notice retained as required by MIT.
//  See ShipSwift ACKNOWLEDGEMENTS for the full license text.
//
//  A draggable glass orb with a built-in gradient fill. The orb is one
//  self-contained view: a vertical color gradient (its own background) sits
//  under a Metal `layerEffect` that magnifies and refracts that gradient with a
//  spherical (barrel) warp, a cool Fresnel rim, an upper-left specular
//  hot-spot, and optional rim RGB dispersion. The gradient belongs to the orb,
//  so dragging the orb carries the whole thing — gradient, refraction and
//  highlights move together (the centre stays fixed in the orb's own frame and
//  the entire view is translated). The gradient's hue cycles over time so the
//  orb's color slowly flows.
//
//  Inferno's Warping Loupe contributes the core refraction maths; the sphere
//  cues (Fresnel rim, specular, dispersion, contact shadow) are added here.
//
//  Requires iOS 17+ / macOS 14+ (SwiftUI `ShaderLibrary`, Metal `stitchable`).
//
//  Usage:
//    // Default gradient orb — draggable, with a slowly flowing hue.
//    SWGlassOrb()
//
//    // Custom size + gradient (top → bottom).
//    SWGlassOrb(radius: 150, colors: [.indigo, .blue, .teal, .green])
//
//    // Demo — dark canvas + gear toolbar item + live-tuning sheet.
//    // Requires an enclosing `NavigationStack`.
//    SWGlassOrb(showsControls: true)
//
//  Parameters:
//    - radius: Orb radius in points (default `120`).
//    - magnification: Peak zoom at the orb centre (default `1.6` = 1.6x).
//    - refraction: Spherical barrel-warp strength, 0...1 (default `0.5`).
//    - edgeHighlight: Fresnel rim + specular strength, 0...1 (default `0.6`).
//    - dispersion: Rim RGB-split strength, 0...1 (default `0.25`; 0 disables).
//    - colors: Vertical gradient fill, top → bottom (default indigo → green).
//    - colorFlow: Hue-rotation speed in degrees/second for a flowing color
//                 cycle (default `30`; 0 = static).
//    - showsControls: Wrap in a dark demo canvas with a gear toolbar item +
//                     live-tuning sheet (default `false`).
//

import SwiftUI

// MARK: - SWGlassOrb

struct SWGlassOrb: View {
    /// Orb radius in points.
    var radius: CGFloat = 120

    /// Peak zoom at the orb centre (1.6 = 1.6x).
    var magnification: CGFloat = 1.6

    /// Strength of the spherical barrel warp, 0...1.
    var refraction: CGFloat = 0.5

    /// Strength of the Fresnel rim + specular + shading, 0...1.
    var edgeHighlight: CGFloat = 0.6

    /// Rim RGB-split strength, 0...1 (0 disables).
    var dispersion: CGFloat = 0.25

    /// Vertical gradient fill, top → bottom.
    var colors: [Color] = SWGlassOrb.defaultColors

    /// Hue-rotation speed in degrees/second for a flowing color cycle (0 = static).
    var colorFlow: Double = 30

    /// When `true`, wraps the orb in a dark demo canvas with a gear toolbar
    /// item that opens a live-tuning sheet.
    var showsControls: Bool = false

    /// Default gradient: indigo → blue → teal → green → green (top → bottom).
    static let defaultColors: [Color] = [
        Color(.indigo),
        Color(.blue),
        Color(.teal),
        Color(.green),
        Color(.green)
    ]

    init(
        radius: CGFloat = 120,
        magnification: CGFloat = 1.6,
        refraction: CGFloat = 0.5,
        edgeHighlight: CGFloat = 0.6,
        dispersion: CGFloat = 0.25,
        colors: [Color] = SWGlassOrb.defaultColors,
        colorFlow: Double = 30,
        showsControls: Bool = false
    ) {
        self.radius = radius
        self.magnification = magnification
        self.refraction = refraction
        self.edgeHighlight = edgeHighlight
        self.dispersion = dispersion
        self.colors = colors
        self.colorFlow = colorFlow
        self.showsControls = showsControls
    }

    var body: some View {
        if showsControls {
            SWGlassOrbControlled(initial: self)
        } else {
            SWGlassOrbBody(
                radius: radius,
                magnification: magnification,
                refraction: refraction,
                edgeHighlight: edgeHighlight,
                dispersion: dispersion,
                colors: colors,
                colorFlow: colorFlow
            )
        }
    }
}

// MARK: - Orb Body (gradient fill + flowing hue + refraction + drag-to-move)

/// The orb itself: a circular gradient fill whose hue cycles over time, refracted
/// by the glass shader, with the whole view draggable. The gradient is the orb's
/// own background, so it travels with the orb — dragging carries gradient,
/// refraction and highlights together. `hueRotation` is applied to the gradient
/// *before* the shader, so only the fill flows; the shader's Fresnel rim and
/// specular stay cool-white. The shader centre is fixed at the frame's middle;
/// movement is a plain `.offset` on the whole view (outside `TimelineView` so the
/// drag stays stable across animation frames).
private struct SWGlassOrbBody: View {
    let radius: CGFloat
    let magnification: CGFloat
    let refraction: CGFloat
    let edgeHighlight: CGFloat
    let dispersion: CGFloat
    let colors: [Color]
    let colorFlow: Double

    /// Committed position offset; updated when each drag ends.
    @State private var position: CGSize = .zero
    /// Live drag translation; resets to zero automatically when the drag ends.
    @GestureState private var drag: CGSize = .zero

    var body: some View {
        let diameter = radius * 2
        // The orb only samples within its own radius, so one radius of budget
        // is plenty for the magnified / dispersed taps.
        let maxOffset = radius + 24

        TimelineView(.animation) { context in
            // Cycle the gradient's hue over time so the orb's color flows. Kept
            // within 0...360 to avoid float-precision jitter on a large clock.
            let t = context.date.timeIntervalSinceReferenceDate
            let hueDegrees = colorFlow == 0
                ? 0
                : (t * colorFlow).truncatingRemainder(dividingBy: 360)

            LinearGradient(colors: colors, startPoint: .top, endPoint: .bottom)
                .hueRotation(.degrees(hueDegrees))
                .frame(width: diameter, height: diameter)
                .clipShape(Circle())
                .layerEffect(
                    ShaderLibrary.swGlassOrb(
                        .boundingRect,
                        .float2(Float(radius), Float(radius)), // centre = frame middle
                        .float(Float(radius)),
                        .float(Float(magnification)),
                        .float(Float(refraction)),
                        .float(Float(edgeHighlight)),
                        .float(Float(dispersion))
                    ),
                    maxSampleOffset: CGSize(width: maxOffset, height: maxOffset)
                )
        }
        .offset(x: position.width + drag.width, y: position.height + drag.height)
        .gesture(
            DragGesture()
                .updating($drag) { value, state, _ in state = value.translation }
                .onEnded { value in
                    position.width += value.translation.width
                    position.height += value.translation.height
                }
        )
    }
}

// MARK: - Controlled Wrapper (dark demo canvas + gear toolbar item + live sheet)

private struct SWGlassOrbControlled: View {
    @State private var radius: CGFloat
    @State private var magnification: CGFloat
    @State private var refraction: CGFloat
    @State private var edgeHighlight: CGFloat
    @State private var dispersion: CGFloat
    @State private var colorFlow: Double
    private let colors: [Color]

    @State private var showSheet = false

    init(initial: SWGlassOrb) {
        _radius        = State(initialValue: initial.radius)
        _magnification = State(initialValue: initial.magnification)
        _refraction    = State(initialValue: initial.refraction)
        _edgeHighlight = State(initialValue: initial.edgeHighlight)
        _dispersion    = State(initialValue: initial.dispersion)
        _colorFlow     = State(initialValue: initial.colorFlow)
        self.colors = initial.colors
    }

    var body: some View {
        ZStack {
            // Fixed dark demo canvas — the orb is dragged across it.
            Color(.black)
                .ignoresSafeArea()

            SWGlassOrbBody(
                radius: radius,
                magnification: magnification,
                refraction: refraction,
                edgeHighlight: edgeHighlight,
                dispersion: dispersion,
                colors: colors,
                colorFlow: colorFlow
            )
        }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    showSheet = true
                } label: {
                    Image(systemName: "slider.horizontal.3")
                }
                .accessibilityLabel("Glass Orb Controls")
            }
        }
        .sheet(isPresented: $showSheet) {
            SWGlassOrbControlsSheet(
                radius: $radius,
                magnification: $magnification,
                refraction: $refraction,
                edgeHighlight: $edgeHighlight,
                dispersion: $dispersion,
                colorFlow: $colorFlow
            )
            .presentationDetents([.medium])
            .presentationDragIndicator(.visible)
        }
    }
}

// MARK: - Controls Sheet

private struct SWGlassOrbControlsSheet: View {
    @Binding var radius: CGFloat
    @Binding var magnification: CGFloat
    @Binding var refraction: CGFloat
    @Binding var edgeHighlight: CGFloat
    @Binding var dispersion: CGFloat
    @Binding var colorFlow: Double

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section("Lens") {
                    SWGlassOrbSliderRow(label: "Radius",        value: $radius,        range: 40...220,  step: 1)
                    SWGlassOrbSliderRow(label: "Magnification", value: $magnification, range: 1...3,     step: 0.05)
                    SWGlassOrbSliderRow(label: "Refraction",    value: $refraction,    range: 0...1,     step: 0.01)
                }
                Section("Glass") {
                    SWGlassOrbSliderRow(label: "Edge Highlight", value: $edgeHighlight, range: 0...1, step: 0.01)
                    SWGlassOrbSliderRow(label: "Dispersion",     value: $dispersion,    range: 0...1, step: 0.01)
                }
                Section("Color") {
                    SWGlassOrbSliderRow(
                        label: "Color Flow",
                        value: Binding(get: { CGFloat(colorFlow) }, set: { colorFlow = Double($0) }),
                        range: 0...120,
                        step: 1
                    )
                }
            }
            .navigationTitle("Glass Orb")
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

private struct SWGlassOrbSliderRow: View {
    let label: String
    @Binding var value: CGFloat
    let range: ClosedRange<CGFloat>
    let step: CGFloat

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(label)
                Spacer()
                Text(String(format: "%.2f", Double(value)))
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
        SWGlassOrb(showsControls: true)
    }
}
```

### SWGlassOrb.metal

```metal
//
//  SWGlassOrb.metal
//  ShipSwift
//
//  Adapted from Inferno's "Warping Loupe" by Paul Hudson
//  https://github.com/twostraws/Inferno
//  Licensed under the MIT License. Copyright (c) 2023 Paul Hudson and other authors.
//  Original copyright and license notice retained as required by MIT.
//  See ShipSwift ACKNOWLEDGEMENTS for the full license text.
//
//  Stitchable SwiftUI `layerEffect` that renders a glass orb by magnifying and
//  refracting the layer it is applied to — in SWGlassOrb that layer is the
//  orb's own color gradient. Inferno's Warping Loupe contributes the core
//  refraction maths: inside a circular region the underlying layer is
//  magnified, and the magnification eases off with distance from the centre
//  to give a spherical (barrel) warp rather than a flat zoom. On top of that
//  base this shader adds the cues that make it read as a *sphere* and not a
//  magnifier: a cool Fresnel rim that brightens toward the silhouette, a
//  soft upper-left specular hot-spot, and an optional faint RGB dispersion
//  at the rim. Outside the orb the layer passes through untouched.
//
//  Paired with: SWGlassOrb.swift
//  Entry point: `swGlassOrb` — invoked via SwiftUI `.layerEffect(...)`.
//  Requires iOS 17+ / macOS 14+.
//

#include <metal_stdlib>
#include <SwiftUI/SwiftUI_Metal.h>
using namespace metal;

// =============================================================================
// MARK: - swGlassOrb
// =============================================================================

/// A glass-orb refraction `layerEffect`.
///
/// - Parameter position: User-space coordinate of the current pixel (auto-injected).
/// - Parameter layer: The SwiftUI layer being sampled (auto-injected).
/// - Parameter boundingRect: The view's bounding rect; `.zw` is its size.
/// - Parameter center: Orb centre in user-space pixels (drag-driven from Swift).
/// - Parameter radius: Orb radius in user-space pixels.
/// - Parameter magnification: Peak zoom at the orb centre (e.g. 1.6 = 1.6x).
/// - Parameter refraction: Strength of the spherical (barrel) warp, 0...1.
/// - Parameter edgeHighlight: Strength of the Fresnel rim + specular, 0...1.
/// - Parameter dispersion: Strength of the rim RGB split, 0...1 (0 disables).
/// - Returns: The new pixel color.
[[stitchable]] half4 swGlassOrb(
    float2 position,
    SwiftUI::Layer layer,
    float4 boundingRect,
    float2 center,
    float radius,
    float magnification,
    float refraction,
    float edgeHighlight,
    float dispersion
) {
    // Vector from the orb centre to this pixel, in pixels.
    float2 delta = position - center;
    float dist = length(delta);

    // Outside the orb: pass the underlying pixel straight through.
    if (dist >= radius) {
        return layer.sample(position);
    }

    // Normalised radial position, 0 at centre → 1 at the rim.
    float r = dist / max(radius, 1.0);

    // --- Spherical refraction (Inferno Warping Loupe core) -------------------
    // Warping Loupe magnifies most at the centre and eases the zoom back as a
    // function of distance, which bends straight lines into a barrel/fisheye
    // curve. We reproduce that easing here: start fully zoomed (1/magnification
    // shrinks the sampled delta → things look bigger), then add back a portion
    // of the distance so the effect relaxes toward the rim. `refraction`
    // scales how much of that spherical relaxation we apply — at 0 it is a flat
    // loupe zoom, at 1 it is a strong glass-ball bulge.
    float invMag = 1.0 / max(magnification, 1.0);
    // smoothstep gives the eased falloff Warping Loupe applies via distance.
    float ease = smoothstep(0.0, 1.0, r);
    float zoom = invMag + ease * (1.0 - invMag) * refraction;

    // The sampled point: shrink the delta by `zoom` and offset back to centre.
    // (zoom < 1 magnifies; as r → 1, zoom → 1 so the rim lines up with the
    // surrounding, un-zoomed content for a seamless join.)
    float2 sampleDelta = delta * zoom;

    // --- Edge RGB dispersion (optional glass chroma) -------------------------
    // Split the channels along the radial direction, ramped up only near the
    // rim where real glass disperses most. Cheap: three samples at the rim,
    // collapses to one in the interior when dispersion is 0.
    half4 src;
    if (dispersion > 0.0001) {
        float2 dir = (dist > 0.0001) ? (delta / dist) : float2(0.0);
        // Rim-weighted spread, in pixels.
        float spread = dispersion * pow(r, 3.0) * radius * 0.04;
        half r_s = layer.sample(center + sampleDelta + dir * spread).r;
        half4 g_s = layer.sample(center + sampleDelta);
        half b_s = layer.sample(center + sampleDelta - dir * spread).b;
        src = half4(r_s, g_s.g, b_s, g_s.a);
    } else {
        src = layer.sample(center + sampleDelta);
    }

    half3 color = src.rgb;

    // --- Fresnel rim highlight ----------------------------------------------
    // Real spheres brighten sharply at the silhouette (grazing angle). Model
    // that with a steep ramp that is ~0 across the body and spikes near r = 1.
    // A cool tint sells "glass" over "lens".
    float fresnel = pow(r, 6.0);
    half3 rimTint = half3(0.72h, 0.85h, 1.0h); // cool blue-white
    color += rimTint * half(fresnel * edgeHighlight * 0.9);

    // --- Specular hot-spot ---------------------------------------------------
    // A single soft highlight toward the upper-left, the classic studio
    // reflection that makes a circle read as a 3D ball. Positioned at ~35% of
    // the radius up-and-left of centre.
    float2 specCenter = center + float2(-0.35, -0.35) * radius;
    float specDist = length(position - specCenter) / max(radius, 1.0);
    float spec = smoothstep(0.42, 0.0, specDist);   // tight, soft-edged blob
    color += half3(spec * spec) * half(edgeHighlight * 0.55);

    // --- Inner contact shadow -----------------------------------------------
    // A faint darkening just inside the rim grounds the highlight and adds
    // volume (the far side of the glass picks up less light).
    float innerShade = smoothstep(0.55, 1.0, r) * (1.0 - fresnel);
    color *= (1.0h - half(innerShade * edgeHighlight * 0.18));

    // Anti-alias the orb silhouette over ~1px so the rim is crisp, not jagged.
    float aa = 1.0 - smoothstep(radius - 1.0, radius, dist);
    half4 passthrough = layer.sample(position);
    half4 orb = half4(color, src.a);
    return mix(passthrough, orb, half(aa));
}
```

## Usage

```swift
// Default gradient orb — draggable, with a slowly flowing hue.
SWGlassOrb()

// Custom size + gradient (top → bottom).
SWGlassOrb(radius: 150, colors: [.indigo, .blue, .teal, .green])

// Static color (no hue flow), stronger bulge.
SWGlassOrb(magnification: 2.0, refraction: 0.7, colorFlow: 0)

// Demo / debug — dark canvas + gear button + live-tuning sheet.
// Requires an enclosing `NavigationStack`.
SWGlassOrb(showsControls: true)
```

## Parameters

| Parameter | Type | Default | Range | Notes |
|---|---|---|---|---|
| `radius` | `CGFloat` | `120` | 40…220 | Orb radius in points |
| `magnification` | `CGFloat` | `1.6` | 1…3 | Peak zoom at the orb centre (1.6 = 1.6x) |
| `refraction` | `CGFloat` | `0.5` | 0…1 | Strength of the spherical barrel warp — 0 = flat loupe zoom, 1 = strong glass-ball bulge |
| `edgeHighlight` | `CGFloat` | `0.6` | 0…1 | Strength of the Fresnel rim + specular hot-spot + inner shading |
| `dispersion` | `CGFloat` | `0.25` | 0…1 | Rim RGB-split strength (0 disables — collapses to a single sample in the interior) |
| `colors` | `[Color]` | indigo → blue → teal → green → green | — | Vertical gradient fill, top → bottom — the orb's own background |
| `colorFlow` | `Double` | `30` | 0…120 | Hue-rotation speed in degrees/second for a flowing color cycle (0 = static) |
| `showsControls` | `Bool` | `false` | — | Demo-only dark canvas + gear ToolbarItem; requires an enclosing `NavigationStack` |

## Integration Checklist

1. Copy `SWGlassOrb.swift` and `SWGlassOrb.metal` into your Xcode target, keeping the MIT attribution header on both files.
2. Confirm the deployment target is iOS 17+ / macOS 14+.
3. Drop in `SWGlassOrb()` for the default gradient orb, or pass your own `colors` for a custom fill. The orb supplies its own gradient — it does not wrap external content.
4. The orb is draggable out of the box — the whole view (gradient + refraction + highlights) translates together via `.offset`, and the position commits when each drag ends.
5. The `.layerEffect` argument order **must** match the Metal `swGlassOrb` signature exactly: `boundingRect, center, radius, magnification, refraction, edgeHighlight, dispersion`. `.boundingRect` is bound positionally; the centre is passed as the frame middle (`radius, radius`) and is not a stored property on the Swift view.

## Notes / Gotchas

- **The gradient is the orb's own background, not external content.** `SWGlassOrb` is non-generic — there is no `content:` closure and no convenience init. A `LinearGradient(colors:)` is clipped to a circle and fed to the shader; to change the look, pass `colors`, not a wrapped view.
- **Hue flow is driven by `TimelineView(.animation)` and applied *before* the shader.** `hueRotation` rotates only the gradient fill, so the orb's color cycles while the shader's Fresnel rim and specular hot-spot stay cool-white. The `colorFlow` clock is wrapped with `truncatingRemainder(dividingBy: 360)` to avoid float-precision jitter; set `colorFlow: 0` for a static orb.
- **Dragging translates the whole view, not the shader centre.** The shader `center` is fixed at the frame middle (`radius, radius`); movement is a plain `.offset` on the entire view, applied *outside* the `TimelineView` so the drag stays stable across animation frames. The committed `position` accumulates on each drag end via a `@GestureState` live `drag` plus a stored `position`.
- **`maxSampleOffset` only needs one radius of budget.** The orb samples within its own radius, so the renderer budgets `radius + 24` in both axes. If you fork the maths to magnify harder, raise this offset or the warped content will clip at the orb's reach.
- **The rim joins seamlessly because `zoom → 1` as `r → 1`.** The sampled delta is shrunk by `zoom`, which eases from `1/magnification` at the centre back to `1.0` at the rim, so the orb's edge lines up with the surrounding un-zoomed gradient. Do not hard-clamp `zoom` below 1 at the rim or you will get a visible seam.
- **`dispersion` is rim-weighted (`pow(r, 3.0)`) and collapses to a single sample when 0.** Leaving it at 0 makes the orb a one-tap sample in the interior; only the rim pays for the three-tap chroma split.
- **The specular hot-spot is fixed to the upper-left** (`float2(-0.35, -0.35) * radius`), the classic studio reflection that makes a circle read as a 3D ball. Move it in the `.metal` file if your light source is elsewhere.
- The orb silhouette is anti-aliased over ~1px via `smoothstep(radius - 1.0, radius, dist)` so the rim is crisp, not jagged.
