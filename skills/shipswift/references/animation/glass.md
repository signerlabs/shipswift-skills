---
id: animation-glass
title: Glass
description: SDF-shaped glass lens layerEffect — magnifies and refracts a source view inside a circle or rounded-rect with frosted blur, a Fresnel rim, chromatic aberration, a directional highlight and tint, all driven by an analytic signed-distance field
tier: free
tags: [animation, metal, shader, glass, refraction, lens, SDF, layerEffect, SwiftUI]
---

## Overview

A refractive glass sheet laid over any content. `SWGlass` wraps a piece of background content and applies a Metal `layerEffect` that bends, frosts, tints and lights that background inside an analytic SDF region — a circle or a rounded rectangle. Outside the shape the background passes through, or is cut away when `cutout` is on.

The look is driven entirely by the shape's signed-distance field and its gradient: the rim refracts hardest while the centre stays calm, a single in-shader golden-angle disk frosts the content, the same taps split chromatically for dispersion, and tint, a directional edge light, a 3D specular glint and a Fresnel rim are layered on top before being cross-faded into the background by an edge mask. The light angle is converted to a `(cos, sin)` direction on the CPU so the shader avoids per-pixel trig, and `Color`s are resolved to RGB triples on the Swift side.

This is a sibling of `glass-orb` (which renders a *sphere* with its own gradient fill); `SWGlass` instead glasses over *arbitrary* content with a flat sheet and a far larger control surface.

Requires iOS 17+ / macOS 14+ (SwiftUI `ShaderLibrary`, Metal `stitchable`).

## File Layout

```
SWAnimation/SWMetal/
  SWGlass.swift     // SwiftUI view + convenience init + optional live-tuning sheet
  SWGlass.metal     // [[ stitchable ]] swGlass layerEffect entry point
```

Both files must be added to the Xcode target; the `.metal` file is compiled into the default `ShaderLibrary` automatically.

## Source Code

### SWGlass.swift

```swift
//
//  SWGlass.swift
//  ShipSwift
//
//  A refractive glass sheet laid over any content. `SWGlass` wraps a piece of
//  background content and applies a Metal `layerEffect` that bends, frosts,
//  tints and lights that background inside an analytic SDF region (a circle or
//  a rounded rectangle). Outside the shape the background passes through, or is
//  cut away when `cutout` is on.
//
//  The look is driven entirely by the shape's signed-distance field and its
//  gradient: the rim refracts hardest, a golden-angle disk frosts the content,
//  the same taps split chromatically for dispersion, and tint, directional edge
//  light, a specular glint and a Fresnel rim are layered on top. It is a
//  from-scratch Metal recipe.
//
//  This is a sibling of `SWGlassOrb` (which renders a *sphere* with its own
//  gradient fill); `SWGlass` instead glasses over *arbitrary* content with a
//  flat sheet and a far larger control surface.
//
//  Requires iOS 17+ / macOS 14+ (SwiftUI `ShaderLibrary`, Metal `stitchable`).
//
//  Usage:
//    // Glass a circle over your own content.
//    SWGlass { MyHeroImage() }
//
//    // Rounded-rectangle glass card, isolated on transparency.
//    SWGlass(shape: .roundedRect, cutout: true) { MyHeroImage() }
//
//    // Demo — built-in sample background + gear toolbar item + live-tuning
//    // sheet. Requires an enclosing `NavigationStack`.
//    SWGlass(showsControls: true)
//

import SwiftUI

// MARK: - SWGlassShape

/// The analytic SDF region the glass covers.
enum SWGlassShape: Int, CaseIterable, Identifiable {
    case circle = 0
    case roundedRect = 1

    var id: Int { rawValue }

    var label: String {
        switch self {
        case .circle: return "Circle"
        case .roundedRect: return "Rounded Rect"
        }
    }
}

// MARK: - SWGlass

struct SWGlass<Content: View>: View {
    // --- Shape ---------------------------------------------------------------
    /// The SDF region the glass covers.
    var shape: SWGlassShape = .circle
    /// Shape centre in normalised view space (0...1).
    var center: CGPoint = CGPoint(x: 0.5, y: 0.5)
    /// Shape scale; >1 shrinks the glass, <1 grows it.
    var scale: CGFloat = 1
    /// Corner radius for the rounded-rectangle shape.
    var cornerRadius: CGFloat = 0.12
    /// When `true`, the exterior is transparent and only the glass remains.
    var cutout: Bool = false

    // --- Glass ---------------------------------------------------------------
    /// Master strength of the refractive bend.
    var refraction: CGFloat = 1
    /// Width of the soft edge fill band.
    var edgeSoftness: CGFloat = 0.1
    /// Frosted-glass blur radius (0 = sharp; 0...20).
    var blur: CGFloat = 0
    /// Apparent glass thickness; widens the refractive band.
    var thickness: CGFloat = 0.2
    /// Chromatic split strength along the refraction vector.
    var aberration: CGFloat = 0.5
    /// Magnifies the refracted content (>1 zooms in).
    var innerZoom: CGFloat = 1

    // --- Highlight -----------------------------------------------------------
    /// Light direction in degrees (0 = +x, counter-clockwise).
    var lightAngle: CGFloat = 300
    /// Master strength of edge light + specular glint.
    var highlight: CGFloat = 0.05
    /// Highlight / specular color.
    var highlightColor: Color = .white
    /// Specular tightness (higher = broader glint).
    var highlightSoftness: CGFloat = 0.5

    // --- Fresnel -------------------------------------------------------------
    /// Strength of the Fresnel rim.
    var fresnel: CGFloat = 0.1
    /// Width of the Fresnel rim band.
    var fresnelSoftness: CGFloat = 0.1
    /// Fresnel rim color.
    var fresnelColor: Color = .white

    // --- Tint ----------------------------------------------------------------
    /// The color the glass tints the refracted content toward.
    var tintColor: Color = .white
    /// How strongly the tint is mixed in (0 = none).
    var tintIntensity: CGFloat = 0
    /// When `true`, the tint keeps the original luminance (hue/chroma only).
    var tintPreserveLuminosity: Bool = true

    // --- Demo ----------------------------------------------------------------
    /// Wrap in a dark demo canvas with a gear toolbar item + live-tuning sheet.
    var showsControls: Bool = false

    /// The background content the glass refracts.
    @ViewBuilder var content: () -> Content

    var body: some View {
        if showsControls {
            SWGlassControlled(initial: self, content: content)
        } else {
            SWGlassBody(config: config, content: content)
        }
    }

    /// Snapshot of every tunable parameter, passed down to the body / sheet.
    fileprivate var config: SWGlassConfig {
        SWGlassConfig(
            shape: shape,
            center: center,
            scale: scale,
            cornerRadius: cornerRadius,
            cutout: cutout,
            refraction: refraction,
            edgeSoftness: edgeSoftness,
            blur: blur,
            thickness: thickness,
            aberration: aberration,
            innerZoom: innerZoom,
            lightAngle: lightAngle,
            highlight: highlight,
            highlightColor: highlightColor,
            highlightSoftness: highlightSoftness,
            fresnel: fresnel,
            fresnelSoftness: fresnelSoftness,
            fresnelColor: fresnelColor,
            tintColor: tintColor,
            tintIntensity: tintIntensity,
            tintPreserveLuminosity: tintPreserveLuminosity
        )
    }
}

// MARK: - Convenience init (built-in sample background)

extension SWGlass where Content == SWGlassSampleBackground {
    /// Convenience initialiser that supplies a built-in colorful sample
    /// background, so `SWGlass(showsControls: true)` shows the effect with no
    /// extra wiring.
    init(
        shape: SWGlassShape = .circle,
        center: CGPoint = CGPoint(x: 0.5, y: 0.5),
        scale: CGFloat = 1,
        cornerRadius: CGFloat = 0.12,
        cutout: Bool = false,
        refraction: CGFloat = 1,
        edgeSoftness: CGFloat = 0.1,
        blur: CGFloat = 0,
        thickness: CGFloat = 0.2,
        aberration: CGFloat = 0.5,
        innerZoom: CGFloat = 1,
        lightAngle: CGFloat = 300,
        highlight: CGFloat = 0.05,
        highlightColor: Color = .white,
        highlightSoftness: CGFloat = 0.5,
        fresnel: CGFloat = 0.1,
        fresnelSoftness: CGFloat = 0.1,
        fresnelColor: Color = .white,
        tintColor: Color = .white,
        tintIntensity: CGFloat = 0,
        tintPreserveLuminosity: Bool = true,
        showsControls: Bool = false
    ) {
        self.shape = shape
        self.center = center
        self.scale = scale
        self.cornerRadius = cornerRadius
        self.cutout = cutout
        self.refraction = refraction
        self.edgeSoftness = edgeSoftness
        self.blur = blur
        self.thickness = thickness
        self.aberration = aberration
        self.innerZoom = innerZoom
        self.lightAngle = lightAngle
        self.highlight = highlight
        self.highlightColor = highlightColor
        self.highlightSoftness = highlightSoftness
        self.fresnel = fresnel
        self.fresnelSoftness = fresnelSoftness
        self.fresnelColor = fresnelColor
        self.tintColor = tintColor
        self.tintIntensity = tintIntensity
        self.tintPreserveLuminosity = tintPreserveLuminosity
        self.showsControls = showsControls
        self.content = { SWGlassSampleBackground() }
    }
}

// MARK: - Config snapshot

/// A plain value bag of every tunable parameter. Keeps the body and the live
/// sheet in sync without threading two dozen arguments through each layer.
private struct SWGlassConfig {
    var shape: SWGlassShape
    var center: CGPoint
    var scale: CGFloat
    var cornerRadius: CGFloat
    var cutout: Bool
    var refraction: CGFloat
    var edgeSoftness: CGFloat
    var blur: CGFloat
    var thickness: CGFloat
    var aberration: CGFloat
    var innerZoom: CGFloat
    var lightAngle: CGFloat
    var highlight: CGFloat
    var highlightColor: Color
    var highlightSoftness: CGFloat
    var fresnel: CGFloat
    var fresnelSoftness: CGFloat
    var fresnelColor: Color
    var tintColor: Color
    var tintIntensity: CGFloat
    var tintPreserveLuminosity: Bool
}

// MARK: - Glass Body (content + layerEffect)

/// The glass itself: the supplied background content with the `swGlass`
/// `layerEffect` applied. The light angle is converted to a `(cos, sin)`
/// direction on the CPU so the shader avoids per-pixel trig, and `Color`s are
/// resolved to RGB triples here too.
private struct SWGlassBody<Content: View>: View {
    let config: SWGlassConfig
    @ViewBuilder var content: () -> Content

    var body: some View {
        let lightRad = Float(config.lightAngle) * .pi / 180
        let lightDir = (cos(lightRad), sin(lightRad))
        let hi = config.highlightColor.swGlassRGB
        let fr = config.fresnelColor.swGlassRGB
        let ti = config.tintColor.swGlassRGB

        // Sample budget: frosted disk reach (blur * 2) plus the refractive bend
        // (≈ refraction * 0.15 of the view) and the aberration split, in points.
        // A generous constant cap keeps the tile budget sane on large views.
        let budget = max(config.blur * 2, 1) + config.refraction * 40 + 24

        content()
            .layerEffect(
                ShaderLibrary.swGlass(
                    // `position` and `layer` are auto-injected by SwiftUI; the
                    // first explicit argument is the bounding rect.
                    .boundingRect,
                    // SwiftUI's Shader.Argument has no integer case, so the
                    // shape enum travels as a float and is compared with > 0.5.
                    .float(Float(config.shape.rawValue)),
                    .float2(Float(config.center.x), Float(config.center.y)),
                    .float(Float(config.scale)),
                    .float(Float(config.cornerRadius)),
                    .float(config.cutout ? 1 : 0),
                    .float(Float(config.refraction)),
                    .float(Float(config.edgeSoftness)),
                    .float(Float(config.blur)),
                    .float(Float(config.thickness)),
                    .float(Float(config.aberration)),
                    .float(Float(config.innerZoom)),
                    .float2(lightDir.0, lightDir.1),
                    .float(Float(config.highlight)),
                    .float3(hi.0, hi.1, hi.2),
                    .float(Float(config.highlightSoftness)),
                    .float(Float(config.fresnel)),
                    .float(Float(config.fresnelSoftness)),
                    .float3(fr.0, fr.1, fr.2),
                    .float3(ti.0, ti.1, ti.2),
                    .float(Float(config.tintIntensity)),
                    .float(config.tintPreserveLuminosity ? 1 : 0)
                ),
                maxSampleOffset: CGSize(width: budget, height: budget)
            )
    }
}

// MARK: - Sample Background

/// A colorful built-in background used by the convenience initialiser so the
/// glass effect is visible out of the box. A diagonal multi-stop gradient plus
/// a few soft blobs give the refraction something rich to bend.
struct SWGlassSampleBackground: View {
    var body: some View {
        ZStack {
            LinearGradient(
                colors: [.orange, .pink, .purple, .blue, .teal],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )

            // Soft accent blobs to give the refraction structure to distort.
            Circle()
                .fill(.yellow.opacity(0.9))
                .frame(width: 160)
                .blur(radius: 30)
                .offset(x: -90, y: -160)

            Circle()
                .fill(.cyan.opacity(0.9))
                .frame(width: 200)
                .blur(radius: 40)
                .offset(x: 110, y: 180)
        }
        .ignoresSafeArea()
    }
}

// MARK: - Controlled Wrapper (dark demo canvas + gear toolbar item + live sheet)

private struct SWGlassControlled<Content: View>: View {
    @State private var config: SWGlassConfig
    @State private var showSheet = false
    @ViewBuilder private let content: () -> Content

    init(initial: SWGlass<Content>, @ViewBuilder content: @escaping () -> Content) {
        _config = State(initialValue: initial.config)
        self.content = content
    }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            SWGlassBody(config: config, content: content)
        }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    showSheet = true
                } label: {
                    Image(systemName: "slider.horizontal.3")
                }
                .accessibilityLabel("Glass Controls")
            }
        }
        .sheet(isPresented: $showSheet) {
            SWGlassControlsSheet(config: $config)
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
    }
}

// MARK: - Controls Sheet (grouped: Shape / Glass / Highlight / Fresnel / Tint)

private struct SWGlassControlsSheet: View {
    @Binding var config: SWGlassConfig
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section("Shape") {
                    Picker("Shape", selection: $config.shape) {
                        ForEach(SWGlassShape.allCases) { s in
                            Text(s.label).tag(s)
                        }
                    }
                    SWGlassSliderRow(label: "Scale",         value: $config.scale,        range: 0.5...2,   step: 0.01)
                    SWGlassSliderRow(label: "Corner Radius", value: $config.cornerRadius, range: 0...0.34,  step: 0.005)
                    Toggle("Cutout", isOn: $config.cutout)
                }
                Section("Glass") {
                    SWGlassSliderRow(label: "Refraction",   value: $config.refraction,   range: 0...3,     step: 0.01)
                    SWGlassSliderRow(label: "Edge Softness",value: $config.edgeSoftness, range: 0.01...0.5,step: 0.005)
                    SWGlassSliderRow(label: "Blur",         value: $config.blur,         range: 0...20,    step: 0.1)
                    SWGlassSliderRow(label: "Thickness",    value: $config.thickness,    range: 0.02...1,  step: 0.01)
                    SWGlassSliderRow(label: "Aberration",   value: $config.aberration,   range: 0...2,     step: 0.01)
                    SWGlassSliderRow(label: "Inner Zoom",   value: $config.innerZoom,    range: 0.5...2,   step: 0.01)
                }
                Section("Highlight") {
                    SWGlassSliderRow(label: "Light Angle",       value: $config.lightAngle,        range: 0...360, step: 1)
                    SWGlassSliderRow(label: "Highlight",         value: $config.highlight,         range: 0...1,   step: 0.01)
                    SWGlassSliderRow(label: "Highlight Softness",value: $config.highlightSoftness, range: 0...1,   step: 0.01)
                    ColorPicker("Highlight Color", selection: $config.highlightColor, supportsOpacity: false)
                }
                Section("Fresnel") {
                    SWGlassSliderRow(label: "Fresnel",         value: $config.fresnel,         range: 0...1, step: 0.01)
                    SWGlassSliderRow(label: "Fresnel Softness",value: $config.fresnelSoftness, range: 0.01...1, step: 0.01)
                    ColorPicker("Fresnel Color", selection: $config.fresnelColor, supportsOpacity: false)
                }
                Section("Tint") {
                    SWGlassSliderRow(label: "Tint Intensity", value: $config.tintIntensity, range: 0...1, step: 0.01)
                    ColorPicker("Tint Color", selection: $config.tintColor, supportsOpacity: false)
                    Toggle("Preserve Luminosity", isOn: $config.tintPreserveLuminosity)
                }
            }
            .navigationTitle("Glass")
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

private struct SWGlassSliderRow: View {
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

// MARK: - Color → RGB (cross-platform, self-contained)

private extension Color {
    /// Resolve this color to a linear-ish sRGB `(r, g, b)` triple for the
    /// shader. Self-contained on purpose — no dependency on other SWPackage
    /// files. Falls back to white if the platform color cannot be resolved.
    var swGlassRGB: (Float, Float, Float) {
        #if canImport(UIKit)
        var r: CGFloat = 1, g: CGFloat = 1, b: CGFloat = 1, a: CGFloat = 1
        if UIColor(self).getRed(&r, green: &g, blue: &b, alpha: &a) {
            return (Float(r), Float(g), Float(b))
        }
        return (1, 1, 1)
        #elseif canImport(AppKit)
        let ns = NSColor(self).usingColorSpace(.sRGB) ?? .white
        return (Float(ns.redComponent), Float(ns.greenComponent), Float(ns.blueComponent))
        #else
        return (1, 1, 1)
        #endif
    }
}

// MARK: - Preview

#Preview("Default") {
    NavigationStack {
        SWGlass(showsControls: true)
    }
}
```

### SWGlass.metal

```metal
//
//  SWGlass.metal
//  ShipSwift
//
//  A stitchable SwiftUI `layerEffect` that turns any content into a sheet of
//  refractive glass laid over a region defined by an analytic signed-distance
//  field (SDF). The layer the effect is applied to is the *background* being
//  refracted; inside the SDF shape the background is bent, frosted, tinted and
//  lit, while outside the shape it passes through untouched (or is cut away
//  when `cutout` is on).
//
//  The glass is built entirely from the SDF and its gradient:
//    - The surface normal comes from a finite-difference gradient of the SDF.
//    - Thickness near the edge drives a squared refraction falloff so the rim
//      bends hard and the centre stays calm.
//    - A single in-shader golden-angle disk does the frosted blur, and the
//      same taps are reused with a chromatic split for dispersion.
//    - Tint, directional edge light, a 3D specular glint and a Fresnel rim are
//      layered on top, then cross-faded into the background by an edge mask.
//
//  This is a from-scratch Metal implementation of a well-known glass-refraction
//  recipe, reorganised into a single linear kernel with local helpers.
//
//  Paired with: SWGlass.swift
//  Entry point: `swGlass` — invoked via SwiftUI `.layerEffect(...)`.
//  Requires iOS 17+ / macOS 14+.
//

#include <metal_stdlib>
#include <SwiftUI/SwiftUI_Metal.h>
using namespace metal;

// =============================================================================
// MARK: - Local helpers
// =============================================================================

namespace sw_glass {

    // Luminance weights (Rec. 601) used by the luminosity-preserving tint.
    constant float3 kLumWeights = float3(0.299, 0.587, 0.114);

    /// Signed distance to a circle of radius `r` centred at the origin.
    /// Negative inside, positive outside.
    inline float sdfCircle(float2 p, float r) {
        return length(p) - r;
    }

    /// Signed distance to a rounded box with half-extents `b` and corner
    /// radius `r`, centred at the origin. Negative inside, positive outside.
    inline float sdfRoundedBox(float2 p, float2 b, float r) {
        float2 q = abs(p) - b + r;
        return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
    }

    /// Evaluate the active shape's SDF at a *centred, aspect-corrected* point.
    /// `shape` 0 = circle, 1 = rounded rectangle (passed as a float since
    /// SwiftUI's `Shader.Argument` has no integer case). The shape is
    /// normalised to a nominal half-size of ~0.4 so the default 1.0 `scale`
    /// fills the view comfortably with margin for the rim.
    inline float sdfShape(float2 p, float shape, float cornerRadius) {
        if (shape > 0.5) {
            // Rounded rectangle: slightly landscape half-extents read as a
            // "card / pill" of glass.
            return sdfRoundedBox(p, float2(0.34, 0.26), cornerRadius);
        }
        // Default: circle.
        return sdfCircle(p, 0.4);
    }

    /// Map view UV (0...1) into the centred, aspect-corrected, scaled space the
    /// SDF lives in. Matches the inverse used when undoing the offset later.
    inline float2 toShapeSpace(float2 uv, float2 center, float2 aspect, float scale) {
        return (uv - center) * aspect / scale;
    }

    /// Sample the SDF for a given view UV, returning the distance already
    /// divided by `scale` so thresholds stay scale-independent.
    inline float sampleSDF(float2 uv, float2 center, float2 aspect, float scale,
                           float shape, float cornerRadius) {
        float2 p = toShapeSpace(uv, center, aspect, scale);
        return sdfShape(p, shape, cornerRadius) / scale;
    }
}

// =============================================================================
// MARK: - swGlass
// =============================================================================

/// A glass-refraction `layerEffect` over an analytic SDF region.
///
/// All geometry is computed in a normalised UV space (the view's bounding rect
/// maps to 0...1), aspect-corrected so circles stay round. The layer is the
/// background being refracted.
///
/// - Parameter position: User-space pixel coordinate (auto-injected).
/// - Parameter layer: The SwiftUI layer being sampled — the background.
/// - Parameter boundingRect: The view's bounding rect; `.zw` is its size.
/// - Parameter shape: 0 = circle, 1 = rounded rectangle.
/// - Parameter center: Shape centre in UV space (default 0.5, 0.5).
/// - Parameter scale: Shape scale; >1 shrinks the glass, <1 grows it.
/// - Parameter cornerRadius: Corner radius for the rounded-rectangle shape.
/// - Parameter cutout: When > 0.5, output alpha = the edge mask (glass is
///   isolated on transparency rather than composited over the background).
/// - Parameter refraction: Master strength of the refractive bend.
/// - Parameter edgeSoftness: Width of the soft edge fill band.
/// - Parameter blur: Frosted-glass disk radius in pixels-ish (0 = sharp).
/// - Parameter thickness: Apparent glass thickness; widens the refractive band.
/// - Parameter aberration: Chromatic split strength along the refraction vector.
/// - Parameter innerZoom: Magnifies the refracted content (>1 zooms in).
/// - Parameter lightDir: Pre-computed (cos, sin) of the light angle.
/// - Parameter highlight: Master strength of edge light + specular glint.
/// - Parameter highlightColor: RGB of the highlight / specular.
/// - Parameter highlightSoftness: Specular tightness (higher = broader glint).
/// - Parameter fresnel: Strength of the Fresnel rim.
/// - Parameter fresnelSoftness: Width of the Fresnel rim band.
/// - Parameter fresnelColor: RGB of the Fresnel rim.
/// - Parameter tintColor: RGB the glass tints the refracted content toward.
/// - Parameter tintIntensity: How strongly the tint is mixed in (0 = none).
/// - Parameter tintPreserveLuminosity: When > 0.5, the tint keeps original luma.
/// - Returns: The new pixel color.
[[stitchable]] half4 swGlass(
    float2 position,
    SwiftUI::Layer layer,
    float4 boundingRect,
    float shape,
    float2 center,
    float scale,
    float cornerRadius,
    float cutout,
    float refraction,
    float edgeSoftness,
    float blur,
    float thickness,
    float aberration,
    float innerZoom,
    float2 lightDir,
    float highlight,
    float3 highlightColor,
    float highlightSoftness,
    float fresnel,
    float fresnelSoftness,
    float3 fresnelColor,
    float3 tintColor,
    float tintIntensity,
    float tintPreserveLuminosity
) {
    using namespace sw_glass;

    float2 size = boundingRect.zw;
    float2 uv   = position / size;

    // Aspect correction: stretch the shorter axis so the SDF stays isotropic
    // (a circle reads as a circle on any view shape).
    float  ar     = size.x / max(size.y, 1.0);
    float2 aspect = float2(max(ar, 1.0), max(1.0 / ar, 1.0));

    // --- SDF at this pixel ----------------------------------------------------
    float sdf = sampleSDF(uv, center, aspect, scale, shape, cornerRadius);

    // Outside the shape: background passes straight through. With `cutout` the
    // exterior is fully transparent so only the glass remains.
    half4 background = layer.sample(position);
    if (sdf > 0.0) {
        if (cutout > 0.5) return half4(0.0h);
        return background;
    }

    // --- Surface normal via finite-difference SDF gradient --------------------
    // Sampling the SDF a small step away on each axis approximates ∂sdf/∂uv,
    // which points "outward" from the shape — our 2D surface normal.
    const float EPS = 0.01;
    float sdfX = sampleSDF(uv + float2(EPS, 0.0), center, aspect, scale, shape, cornerRadius);
    float sdfY = sampleSDF(uv + float2(0.0, EPS), center, aspect, scale, shape, cornerRadius);
    float gradX = (sdfX - sdf) / EPS;
    float gradY = (sdfY - sdf) / EPS;
    float2 grad = float2(gradX, gradY);

    // --- Edge fill mask (rb1) -------------------------------------------------
    // A 0...1 band that fills in from the silhouette over `sharp` units, used
    // both as the composite cross-fade and to gate the Fresnel rim.
    float sharp = max(edgeSoftness * 0.5, 0.001);
    float rb1   = clamp(-sdf / sharp * 32.0, 0.0, 1.0);

    // --- Thickness → refraction falloff --------------------------------------
    // Near the rim the glass is "thin" and bends hard; toward the centre it is
    // "thick" and calm. depthNorm is 0 at the rim → 1 once we pass the band,
    // and the squared inverse makes the bend concentrate at the edge.
    float thicknessRange = max(thickness * 0.3, 0.001);
    float depthNorm      = clamp(-sdf / thicknessRange, 0.0, 1.0);
    float refrStrength   = (1.0 - depthNorm) * (1.0 - depthNorm);

    // --- Refraction offset ----------------------------------------------------
    // Bend along the (negated) gradient, scaled by master refraction and the
    // edge-weighted strength. The x component is divided by aspect so the bend
    // is symmetric in screen space after the aspect stretch.
    float2 offset = -grad * (refraction * 0.15) * refrStrength;
    offset.x /= aspect.x;

    // Magnify the refracted content about the centre, then add the bend.
    float2 lensUV = center + (uv - center) / max(innerZoom, 0.0001) + offset;

    // --- Frosted blur + chromatic dispersion (single in-shader disk) ----------
    // One golden-angle disk does the frosting; the same disk is reused at three
    // chromatically-shifted centres for dispersion, so heavy taps only happen
    // when actually needed.
    float2 pixelSize = 1.0 / size;
    float  diskRadius = blur * 2.0;                 // in pixels-ish
    bool   doBlur     = diskRadius > 0.001;
    float2 chrOff     = offset * (aberration * 0.06);
    bool   doChroma   = aberration > 0.0001;

    const int   TAPS  = 9;
    const float GOLD  = 2.39996323; // golden angle (radians)

    float3 rgb;
    if (!doBlur && !doChroma) {
        // Cheapest path: a single sharp tap at the bent UV.
        rgb = float3(layer.sample(lensUV * size).rgb);
    } else {
        // Accumulate r / g / b separately so we can offset the red and blue
        // sample centres for chromatic aberration while green stays put.
        float accR = 0.0, accG = 0.0, accB = 0.0;
        float wsum = 0.0;

        // When blur is off we still want a single tap per channel, so collapse
        // the disk to its centre by zeroing the radius.
        float effRadius = doBlur ? diskRadius : 0.0;
        int   effTaps   = doBlur ? TAPS : 1;

        float2 cR = doChroma ? (lensUV + chrOff) : lensUV;
        float2 cG = lensUV;
        float2 cB = doChroma ? (lensUV - chrOff) : lensUV;

        for (int i = 0; i < effTaps; i++) {
            // Golden-angle spiral: uniform-ish disk coverage with few taps.
            float ang = float(i) * GOLD;
            float rad = sqrt(float(i) / float(TAPS));
            float2 diskPt = float2(cos(ang), sin(ang)) * rad;
            float2 d = diskPt * pixelSize * effRadius;

            accR += layer.sample((cR + d) * size).r;
            accG += layer.sample((cG + d) * size).g;
            accB += layer.sample((cB + d) * size).b;
            wsum += 1.0;
        }
        rgb = float3(accR, accG, accB) / max(wsum, 1.0);
    }

    // --- Tint -----------------------------------------------------------------
    // Mix the refracted color toward the tint, optionally rescaling so the
    // tinted result keeps the original luminance (tint only shifts hue/chroma).
    float3 tinted = mix(rgb, tintColor, tintIntensity);
    if (tintPreserveLuminosity > 0.5) {
        float origLum   = dot(rgb,    kLumWeights);
        float tintedLum = dot(tinted, kLumWeights);
        tinted *= origLum / max(tintedLum, 0.0001);
    }
    float3 tintedGlass = tinted;

    // --- Directional edge light (rb2) ----------------------------------------
    // A bright ring just inside the silhouette, modulated by how much the
    // surface faces the light. `lightFacing` is the gradient dotted with the
    // light direction (the rim that points at the light glows).
    float rb2base    = clamp(-sdf / sharp, 0.0, 1.0);
    rb2base          = rb2base * (1.0 - rb2base) * 4.0; // ring: peaks mid-band
    float lightFacing = clamp(dot(normalize(grad + 1e-5), lightDir) * 0.5 + 0.5, 0.0, 1.0);
    float rb2          = rb2base * lightFacing * highlight;

    // --- Specular glint (3D half-vector) -------------------------------------
    // Treat the surface as a 3D normal tilted by the gradient, with the eye
    // straight on. The half-vector between light and eye drives a Blinn-Phong
    // lobe; the exponent comes from highlightSoftness (softer = lower power).
    float3 N      = normalize(float3(gradX, gradY, 2.0));
    float3 L      = normalize(float3(lightDir, 1.0));
    float3 V      = float3(0.0, 0.0, 1.0);
    float3 H      = normalize(L + V);
    float  nDotH  = clamp(dot(N, H), 0.0, 1.0);
    float  specExp = exp2(8.0 - highlightSoftness * 7.0);
    float  specGlint = pow(nDotH, specExp) * highlight * refrStrength;

    // --- Fresnel rim ----------------------------------------------------------
    // A thin bright lip exactly at the silhouette, squared for a fast falloff
    // and gated by the edge fill mask so it never bleeds outside the glass.
    float fw         = max(fresnelSoftness * 0.06, 0.0001);
    float fEdge      = 1.0 - clamp(-sdf / fw, 0.0, 1.0);
    float fresnelRim = fEdge * fEdge * fresnel * rb1;

    // --- Composite ------------------------------------------------------------
    float3 lighting = tintedGlass
                    + highlightColor * rb2
                    + highlightColor * specGlint
                    + fresnelColor   * fresnelRim;

    float transition = smoothstep(0.0, 1.0, rb1);
    float3 outRGB    = mix(float3(background.rgb), lighting, transition);

    half outA = (cutout > 0.5) ? half(transition) : background.a;
    return half4(half3(outRGB), outA);
}
```

## Usage

```swift
// Glass a circle over your own content.
SWGlass { MyHeroImage() }

// Rounded-rectangle glass card, isolated on transparency (only the glass remains).
SWGlass(shape: .roundedRect, cutout: true) { MyHeroImage() }

// Frosted, magnifying, slightly tinted lens.
SWGlass(blur: 6, innerZoom: 1.3, tintColor: .cyan, tintIntensity: 0.25) {
    MyHeroImage()
}

// Demo — built-in sample background + gear toolbar item + live-tuning sheet.
// Requires an enclosing NavigationStack.
NavigationStack {
    SWGlass(showsControls: true)
}
```

## Parameters

| Parameter | Type | Default | Range | Notes |
|---|---|---|---|---|
| `shape` | `SWGlassShape` | `.circle` | circle / roundedRect | The analytic SDF region the glass covers |
| `center` | `CGPoint` | `(0.5, 0.5)` | 0…1 | Shape centre in normalised view space |
| `scale` | `CGFloat` | `1` | 0.5…2 | Shape scale — >1 shrinks the glass, <1 grows it |
| `cornerRadius` | `CGFloat` | `0.12` | 0…0.34 | Corner radius for the rounded-rectangle shape |
| `cutout` | `Bool` | `false` | — | When `true`, the exterior is transparent and only the glass remains |
| `refraction` | `CGFloat` | `1` | 0…3 | Master strength of the refractive bend |
| `edgeSoftness` | `CGFloat` | `0.1` | 0.01…0.5 | Width of the soft edge fill band |
| `blur` | `CGFloat` | `0` | 0…20 | Frosted-glass disk radius (0 = sharp) |
| `thickness` | `CGFloat` | `0.2` | 0.02…1 | Apparent glass thickness; widens the refractive band |
| `aberration` | `CGFloat` | `0.5` | 0…2 | Chromatic split strength along the refraction vector |
| `innerZoom` | `CGFloat` | `1` | 0.5…2 | Magnifies the refracted content (>1 zooms in) |
| `lightAngle` | `CGFloat` | `300` | 0…360 | Light direction in degrees (0 = +x, counter-clockwise) |
| `highlight` | `CGFloat` | `0.05` | 0…1 | Master strength of edge light + specular glint |
| `highlightColor` | `Color` | `.white` | — | Highlight / specular color |
| `highlightSoftness` | `CGFloat` | `0.5` | 0…1 | Specular tightness (higher = broader glint) |
| `fresnel` | `CGFloat` | `0.1` | 0…1 | Strength of the Fresnel rim |
| `fresnelSoftness` | `CGFloat` | `0.1` | 0.01…1 | Width of the Fresnel rim band |
| `fresnelColor` | `Color` | `.white` | — | Fresnel rim color |
| `tintColor` | `Color` | `.white` | — | The color the glass tints the refracted content toward |
| `tintIntensity` | `CGFloat` | `0` | 0…1 | How strongly the tint is mixed in (0 = none) |
| `tintPreserveLuminosity` | `Bool` | `true` | — | When `true`, the tint keeps the original luminance (hue/chroma only) |
| `showsControls` | `Bool` | `false` | — | Demo-only gear ToolbarItem; requires an enclosing `NavigationStack` |

## Integration Checklist

1. Copy `SWGlass.swift` and `SWGlass.metal` into your Xcode target; the `.metal` file is compiled into the default `ShaderLibrary` automatically.
2. Confirm the deployment target is iOS 17+ / macOS 14+.
3. Pass the content you want glassed in the trailing closure, or use the convenience initialiser (no closure) for the built-in sample background.
4. The `maxSampleOffset` budget is computed for you from `blur` + `refraction` + the aberration split — heavier frost / refraction automatically reserves a larger tile budget.
5. Use `cutout: true` when you want the glass isolated on transparency (e.g. a glass badge over your own layout) rather than composited over the supplied background.

## Notes / Gotchas

- **Everything is driven by the SDF and its gradient.** The surface normal is a finite-difference gradient of the signed-distance field; thickness near the edge drives a squared refraction falloff so the rim bends hardest and the centre stays calm.
- **The shape enum travels as a float.** SwiftUI's `Shader.Argument` has no integer case, so `SWGlassShape.rawValue` is sent as a `.float` and compared with `> 0.5` in the shader. Keep the enum raw values 0 / 1.
- **One golden-angle disk does both frost and dispersion.** The same tap set is reused at three chromatically-shifted centres, so the heavy taps only run when `blur` or `aberration` is non-zero (the sharp single-tap path is taken otherwise).
- **Light angle is precomputed on the CPU.** The Swift side converts `lightAngle` to a `(cos, sin)` direction so the shader avoids per-pixel trig; `Color`s are likewise resolved to RGB triples on the Swift side.
- The argument order in the `.layerEffect` call **must** match the Metal `swGlass` signature exactly: `boundingRect, shape, center, scale, cornerRadius, cutout, refraction, edgeSoftness, blur, thickness, aberration, innerZoom, lightDir, highlight, highlightColor, highlightSoftness, fresnel, fresnelSoftness, fresnelColor, tintColor, tintIntensity, tintPreserveLuminosity`.
```
