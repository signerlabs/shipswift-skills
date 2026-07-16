---
id: animation-glass-logo
title: Glass Logo
description: Multi-layer glass apple-logo showcase — a dark canvas plus a flowing color gradient refracted through an apple.logo-shaped frosted glass with a cool Fresnel edge and a soft breathing bloom, composited from four stacked SwiftUI passes
tier: free
tags: [animation, metal, shader, glass, logo, refraction, bloom, showcase, layerEffect, SwiftUI]
---

## Overview

`SWGlassLogo` is a **multi-layer composited showcase**: it is not one monolithic shader but four cheap SwiftUI primitives stacked in a `ZStack`, producing an SF Symbol (default `apple.logo`) rendered as a sheet of frosted, refractive glass that glows on a near-black canvas with flowing colored light trapped inside it.

The four passes are:

1. **Canvas** — a near-black background (#0a0a0a).
2. **Flowing light** — a slowly rotating tri-color `MeshGradient` (cool-blue / orange / deep-blue) with a few faint diagonal stripes drifting across it. This is the light the glass refracts.
3. **Glass logo** — pass 2 masked to the silhouette of the SF Symbol, then run through the `swGlassLogo` Metal `layerEffect`. Because there is no analytic shape, the surface normal is recovered directly from the layer's **alpha gradient** across the antialiased silhouette: that drives a subtle refraction + a small golden-angle frosted disk + a luminosity-preserving tint + a cool Fresnel rim, all clipped to the symbol shape (transparent outside).
4. **Bloom** — two stacked `.shadow` halos (one tight, one wide soft) that breathe slowly on the flow's own clock, giving the logo an outer cool glow.

This is a first-pass approximation that leans on frost + a cool rim + a soft bloom over flowing color, and intentionally leaves thin-film iridescence, twirl distortion and exact SDF shaping for later refinement.

Requires iOS 17+ / macOS 14+ (SwiftUI `ShaderLibrary` / `Shader` / `layerEffect`, Metal `stitchable`, `MeshGradient`, `TimelineView`).

## File Layout

```
SWAnimation/SWMetal/
  SWGlassLogo.swift     // four-pass ZStack composite + optional live-tuning sheet
  SWGlassLogo.metal     // [[ stitchable ]] swGlassLogo layerEffect entry point
```

Both files must be added to the Xcode target; the `.metal` file is compiled into the default `ShaderLibrary` automatically.

## Source Code

### SWGlassLogo.swift

```swift
//
//  SWGlassLogo.swift
//  ShipSwift
//
//  A multi-layer composited "frosted glass logo": an SF Symbol (default
//  `apple.logo`) rendered as a sheet of frosted, refractive glass that glows on
//  a near-black canvas with flowing colored light trapped inside it.
//
//  The look is built by stacking four passes in a `ZStack`, each a cheap
//  SwiftUI primitive rather than one monolithic shader:
//
//    1. Canvas      — a near-black background (#0a0a0a).
//    2. Flowing light — a slowly rotating tri-color `MeshGradient` (cool-blue /
//                       orange / blue) with a few faint diagonal stripes drifting
//                       across it. This is the light the glass will refract.
//    3. Glass logo  — pass 2, masked to the silhouette of the SF Symbol, then
//                     run through the `swGlassLogo` Metal `layerEffect`: an
//                     alpha-gradient surface normal drives a subtle refraction +
//                     frosted blur + a cool Fresnel rim, all clipped to the
//                     symbol shape (transparent outside).
//    4. Bloom       — two stacked `.shadow` halos (one wide soft, one tight)
//                     that breathe slowly, giving the logo an outer cool glow.
//
//  Requires iOS 17+ / macOS 14+ (SwiftUI `ShaderLibrary` / `Shader` /
//  `layerEffect`, Metal `stitchable`, `MeshGradient`, `TimelineView`).
//
//  Usage:
//    // Default — frosted-glass Apple logo on black
//    SWGlassLogo()
//
//    // A different symbol, larger
//    SWGlassLogo(symbolName: "swift", symbolSize: 360)
//
//    // Demo / debug — gear button opens a live-tuning sheet.
//    // Requires an enclosing `NavigationStack`.
//    SWGlassLogo(showsControls: true)
//
//  This is a first-pass approximation: it leans on frost + a cool rim + a soft
//  bloom over flowing color, and intentionally leaves thin-film iridescence,
//  twirl distortion and exact SDF shaping for later refinement.
//
//  Created by Wei Zhong on 6/2/26.
//

import SwiftUI

// MARK: - Main View

struct SWGlassLogo: View {
    /// SF Symbol name used as the glass silhouette.
    var symbolName: String = "apple.logo"

    /// Point size of the rendered symbol.
    var symbolSize: CGFloat = 300

    /// Master strength of the refractive bend at the glass edge (0...1).
    var refraction: Float = 0.35

    /// Frosted-blur disk radius in pixels-ish (0 = sharp).
    var frost: Float = 9

    /// Apparent glass thickness; widens the hard-bending edge band (0...2).
    var thickness: Float = 0.6

    /// Width of the soft alpha-contour band the rim rides on (0.2...1.5).
    var edgeSoftness: Float = 0.6

    /// Strength of the cool Fresnel rim hugging the contour (0...1).
    var fresnel: Float = 0.08

    /// How far in from the contour the rim reaches (0.1...1).
    var fresnelSoftness: Float = 0.57

    /// Base animation speed of the flowing light + bloom breath.
    var flowSpeed: Double = 0.18

    /// When `true`, attaches a gear `ToolbarItem` that opens a live-tuning sheet.
    var showsControls: Bool = false

    var body: some View {
        if showsControls {
            SWGlassLogoControlled(initial: self)
        } else {
            SWGlassLogoRenderer(initial: self)
        }
    }
}

// MARK: - Palette & Tuning
// Every magic color / number for the four passes lives here in one place so the
// look can be re-tuned without hunting through the view body.
private enum SWGlassLogoStyle {
    // --- Flowing-light palette (the color trapped inside the glass) ----------
    /// Cool blue highlight (#b3bcff).
    static let coolBlue = Color(red: 0.702, green: 0.737, blue: 1.0)
    /// Warm orange (#fc8323).
    static let orange   = Color(red: 0.988, green: 0.514, blue: 0.137)
    /// Deep blue (#0856ff).
    static let deepBlue = Color(red: 0.031, green: 0.337, blue: 1.0)
    /// Faint diagonal stripe color (#def1ff), kept low-opacity.
    static let stripe   = Color(red: 0.871, green: 0.945, blue: 1.0)

    // --- Glass tint + rim ----------------------------------------------------
    /// What the glass nudges the refracted light toward (a cool blue).
    static let tint: (r: Float, g: Float, b: Float) = (0.55, 0.70, 1.0)
    static let tintIntensity: Float = 0.18
    /// Cool Fresnel rim color (#b3e5ff).
    static let fresnelColor: (r: Float, g: Float, b: Float) = (0.702, 0.898, 1.0)

    // --- Canvas --------------------------------------------------------------
    /// Near-black background (#0a0a0a).
    static let canvas = Color(red: 0.04, green: 0.04, blue: 0.04)

    // --- Diagonal stripes ----------------------------------------------------
    /// Stripe sweep angle (degrees) — the brief's ~-139°.
    static let stripeAngle: Double = -139
    /// Number of stripes drawn across the flowing-light layer.
    static let stripeCount: Int = 3

    // --- Bloom (outer glow) --------------------------------------------------
    /// Cool-white bloom tint.
    static let bloom = Color(red: 0.80, green: 0.90, blue: 1.0)
    static let bloomInnerRadius: CGFloat = 14
    static let bloomOuterRadiusBase: CGFloat = 46
    static let bloomOuterRadiusRange: CGFloat = 16
    static let bloomInnerOpacityBase: Double = 0.45
    static let bloomInnerOpacityRange: Double = 0.18
    static let bloomOuterOpacityBase: Double = 0.22
    static let bloomOuterOpacityRange: Double = 0.14
}

// MARK: - Flowing Light Layer
// A slowly rotating tri-color MeshGradient with a few drifting diagonal
// stripes. This is the cool/warm clash of light the glass refracts.
private struct SWGlassLogoFlow: View {
    let phase: Double

    var body: some View {
        ZStack {
            meshGradient
            stripes
        }
    }

    // Tri-color mesh whose interior control points orbit slowly, so the
    // cool-blue / orange / deep-blue zones swirl into one another over time.
    private var meshGradient: some View {
        // Orbit the four interior points on slow circles of different phase so
        // the color field never reads as a static gradient.
        let a = phase
        func orbit(_ base: SIMD2<Float>, _ off: Double, _ amp: Float) -> SIMD2<Float> {
            SIMD2<Float>(
                base.x + amp * Float(cos(a + off)),
                base.y + amp * Float(sin(a * 0.8 + off))
            )
        }

        return MeshGradient(
            width: 3,
            height: 3,
            points: [
                .init(0, 0),                                  .init(0.5, 0),                                .init(1, 0),
                orbit(.init(0, 0.5), 0.0, 0.10), orbit(.init(0.5, 0.5), 2.1, 0.16), orbit(.init(1, 0.5), 4.2, 0.10),
                .init(0, 1),                                  .init(0.5, 1),                                .init(1, 1)
            ],
            colors: [
                SWGlassLogoStyle.deepBlue, SWGlassLogoStyle.coolBlue, SWGlassLogoStyle.deepBlue,
                SWGlassLogoStyle.coolBlue, SWGlassLogoStyle.orange,   SWGlassLogoStyle.coolBlue,
                SWGlassLogoStyle.deepBlue, SWGlassLogoStyle.coolBlue, SWGlassLogoStyle.deepBlue
            ]
        )
    }

    // A handful of faint, wide diagonal stripes drifting along the sweep angle.
    private var stripes: some View {
        GeometryReader { geo in
            let diag = hypot(geo.size.width, geo.size.height)
            let spacing = diag / CGFloat(SWGlassLogoStyle.stripeCount + 1)
            // Drift offset moves the stripes slowly along their own direction.
            let drift = CGFloat(phase.truncatingRemainder(dividingBy: .pi * 2)) / (.pi * 2) * spacing

            ZStack {
                ForEach(0..<SWGlassLogoStyle.stripeCount, id: \.self) { i in
                    let y = spacing * CGFloat(i) - diag / 2 + drift
                    Rectangle()
                        .fill(SWGlassLogoStyle.stripe.opacity(0.10))
                        .frame(width: diag * 1.6, height: spacing * 0.42)
                        .blur(radius: 12)
                        .position(x: geo.size.width / 2, y: geo.size.height / 2 + y)
                }
            }
            .rotationEffect(.degrees(SWGlassLogoStyle.stripeAngle))
            .frame(width: geo.size.width, height: geo.size.height)
        }
    }
}

// MARK: - Renderer (the four-pass composite)

private struct SWGlassLogoRenderer: View {
    let initial: SWGlassLogo

    @State private var start: Date = .now

    var body: some View {
        TimelineView(.animation) { ctx in
            let elapsed = ctx.date.timeIntervalSince(start)
            let phase = elapsed * initial.flowSpeed

            // Bloom breathes slowly (out of phase with nothing in particular —
            // just a gentle pulse so the halo is never a dead static ring).
            let breath = (sin(phase * 1.3) * 0.5 + 0.5) // 0...1
            let innerOpacity = SWGlassLogoStyle.bloomInnerOpacityBase
                + SWGlassLogoStyle.bloomInnerOpacityRange * breath
            let outerOpacity = SWGlassLogoStyle.bloomOuterOpacityBase
                + SWGlassLogoStyle.bloomOuterOpacityRange * breath
            let outerRadius = SWGlassLogoStyle.bloomOuterRadiusBase
                + SWGlassLogoStyle.bloomOuterRadiusRange * CGFloat(breath)

            ZStack {
                // Pass 1 — near-black canvas.
                SWGlassLogoStyle.canvas.ignoresSafeArea()

                // Passes 2+3 — the flowing light, masked to the logo silhouette,
                // then run through the glass shader. Masking BEFORE the shader is
                // what gives the layer its alpha-contour silhouette, which the
                // shader reads back as the surface normal. Pass 4 (bloom) is the
                // outer .shadow stack on the same glass node.
                glassLogo(phase: phase)
                    .shadow(color: SWGlassLogoStyle.bloom.opacity(innerOpacity),
                            radius: SWGlassLogoStyle.bloomInnerRadius)
                    .shadow(color: SWGlassLogoStyle.bloom.opacity(outerOpacity),
                            radius: outerRadius)
            }
        }
    }

    // Pass 2 (flow) masked to the symbol, then Pass 3 (glass shader).
    private func glassLogo(phase: Double) -> some View {
        SWGlassLogoFlow(phase: phase)
            // Clip the flowing light to the symbol silhouette: the layer the
            // shader samples now carries the logo's exact alpha contour.
            .mask {
                Image(systemName: initial.symbolName)
                    .font(.system(size: initial.symbolSize))
            }
            // Constrain the layer to the symbol's footprint so refraction /
            // frost taps stay near the shape, not the whole screen.
            .frame(width: initial.symbolSize * 1.2, height: initial.symbolSize * 1.2)
            .layerEffect(
                ShaderLibrary.swGlassLogo(
                    .boundingRect,
                    .float(initial.refraction),
                    .float(initial.frost),
                    .float(initial.thickness),
                    .float(initial.edgeSoftness),
                    .float(initial.fresnel),
                    .float(initial.fresnelSoftness),
                    .float3(SWGlassLogoStyle.fresnelColor.r,
                            SWGlassLogoStyle.fresnelColor.g,
                            SWGlassLogoStyle.fresnelColor.b),
                    .float3(SWGlassLogoStyle.tint.r,
                            SWGlassLogoStyle.tint.g,
                            SWGlassLogoStyle.tint.b),
                    .float(SWGlassLogoStyle.tintIntensity)
                ),
                // Frost + refraction sample a small neighbourhood; budget a
                // generous offset so taps near the edge are not clamped.
                maxSampleOffset: CGSize(width: 40, height: 40)
            )
    }
}

// MARK: - Controlled Wrapper (gear toolbar item + live sheet)

private struct SWGlassLogoControlled: View {
    @State private var refraction: Float
    @State private var frost: Float
    @State private var thickness: Float
    @State private var edgeSoftness: Float
    @State private var fresnel: Float
    @State private var fresnelSoftness: Float
    @State private var flowSpeed: Double

    @State private var showSheet = false

    private let symbolName: String
    private let symbolSize: CGFloat

    init(initial: SWGlassLogo) {
        _refraction      = State(initialValue: initial.refraction)
        _frost           = State(initialValue: initial.frost)
        _thickness       = State(initialValue: initial.thickness)
        _edgeSoftness    = State(initialValue: initial.edgeSoftness)
        _fresnel         = State(initialValue: initial.fresnel)
        _fresnelSoftness = State(initialValue: initial.fresnelSoftness)
        _flowSpeed       = State(initialValue: initial.flowSpeed)
        self.symbolName  = initial.symbolName
        self.symbolSize  = initial.symbolSize
    }

    var body: some View {
        // The glass sheen, the cool rim and especially the bloom only read
        // against black, so the demo mode pins a full-bleed dark canvas.
        ZStack {
            SWGlassLogoStyle.canvas.ignoresSafeArea()

            SWGlassLogoRenderer(
                initial: SWGlassLogo(
                    symbolName: symbolName,
                    symbolSize: symbolSize,
                    refraction: refraction,
                    frost: frost,
                    thickness: thickness,
                    edgeSoftness: edgeSoftness,
                    fresnel: fresnel,
                    fresnelSoftness: fresnelSoftness,
                    flowSpeed: flowSpeed
                )
            )
        }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    showSheet = true
                } label: {
                    Image(systemName: "slider.horizontal.3")
                }
                .accessibilityLabel("Glass Logo Controls")
            }
        }
        .sheet(isPresented: $showSheet) {
            SWGlassLogoControlsSheet(
                refraction: $refraction,
                frost: $frost,
                thickness: $thickness,
                edgeSoftness: $edgeSoftness,
                fresnel: $fresnel,
                fresnelSoftness: $fresnelSoftness,
                flowSpeed: $flowSpeed
            )
            .presentationDetents([.medium, .large])
            .presentationDragIndicator(.visible)
        }
    }
}

// MARK: - Controls Sheet

private struct SWGlassLogoControlsSheet: View {
    @Binding var refraction: Float
    @Binding var frost: Float
    @Binding var thickness: Float
    @Binding var edgeSoftness: Float
    @Binding var fresnel: Float
    @Binding var fresnelSoftness: Float
    @Binding var flowSpeed: Double

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section("Glass") {
                    SWGlassLogoSliderRow(label: "Refraction",      value: $refraction,      range: 0...1,    step: 0.01)
                    SWGlassLogoSliderRow(label: "Frost",           value: $frost,           range: 0...24,   step: 0.5)
                    SWGlassLogoSliderRow(label: "Thickness",       value: $thickness,       range: 0...2,    step: 0.05)
                    SWGlassLogoSliderRow(label: "Edge Softness",   value: $edgeSoftness,    range: 0.2...1.5, step: 0.01)
                }

                Section("Fresnel Rim") {
                    SWGlassLogoSliderRow(label: "Fresnel",         value: $fresnel,         range: 0...1,    step: 0.01)
                    SWGlassLogoSliderRow(label: "Rim Softness",    value: $fresnelSoftness, range: 0.1...1,  step: 0.01)
                }

                Section("Motion") {
                    SWGlassLogoSliderRowD(label: "Flow Speed",     value: $flowSpeed,       range: 0...0.6,  step: 0.01)
                }
            }
            .navigationTitle("Glass Logo")
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

// Float slider row.
private struct SWGlassLogoSliderRow: View {
    let label: String
    @Binding var value: Float
    let range: ClosedRange<Float>
    let step: Float

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(label)
                Spacer()
                Text(String(format: step < 0.1 ? "%.2f" : "%.1f", value))
                    .font(.callout.monospacedDigit())
                    .foregroundStyle(.secondary)
            }
            Slider(value: $value, in: range, step: step)
        }
    }
}

// Double slider row (for flow speed).
private struct SWGlassLogoSliderRowD: View {
    let label: String
    @Binding var value: Double
    let range: ClosedRange<Double>
    let step: Double

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

#Preview("Glass Apple logo") {
    NavigationStack {
        SWGlassLogo(showsControls: true)
    }
}

#Preview("Glass Swift logo") {
    SWGlassLogo(symbolName: "swift", symbolSize: 320)
}
```

### SWGlassLogo.metal

```metal
//
//  SWGlassLogo.metal
//  ShipSwift
//
//  A stitchable SwiftUI `layerEffect` that turns an opaque silhouette (an SF
//  Symbol such as `apple.logo`) into a sheet of frosted, refractive glass that
//  exists ONLY inside the symbol's shape. Everything outside the silhouette is
//  cut away to full transparency, so the effect drops cleanly onto any dark
//  canvas as a glass-shaped logo.
//
//  Unlike the SDF-based glass in the library, this kernel has no analytic shape
//  to differentiate. The "shape" is whatever silhouette the source layer draws,
//  so the surface normal is recovered directly from the layer's ALPHA channel:
//  a finite-difference gradient of alpha points outward across the antialiased
//  contour and acts as the 2D surface normal. That single idea drives the whole
//  look:
//    - alpha gradient            -> 2D surface normal (refraction direction)
//    - distance-into-the-shape   -> edge-weighted refraction + frost falloff
//    - a small golden-angle disk -> frosted blur of the refracted content
//    - alpha-contour band        -> a cool Fresnel rim hugging the silhouette
//
//  The layer being sampled is the flowing color content placed BEHIND the
//  silhouette mask in Swift, so the glass refracts and frosts that moving light.
//
//  Paired with: SWGlassLogo.swift
//  Entry point: `swGlassLogo` — invoked via SwiftUI `.layerEffect(...)`.
//  Requires iOS 17+ / macOS 14+.
//

#include <metal_stdlib>
#include <SwiftUI/SwiftUI_Metal.h>
using namespace metal;

// =============================================================================
// MARK: - Local helpers
// =============================================================================

namespace sw_glass_logo {

    // Rec. 601 luminance weights, used by the luminosity-preserving tint.
    constant float3 kLumWeights = float3(0.299, 0.587, 0.114);

    /// Read the silhouette coverage at a pixel. The Swift side renders the mask
    /// shape into the alpha channel, so alpha is the cleanest coverage signal;
    /// we fall back to red only if a source happens to be fully opaque.
    inline float coverageAt(SwiftUI::Layer layer, float2 pos) {
        half4 s = layer.sample(pos);
        return float(s.a);
    }
}

// =============================================================================
// MARK: - swGlassLogo
// =============================================================================

/// A glass-logo refraction `layerEffect`.
///
/// - Parameter position: User-space pixel coordinate (auto-injected).
/// - Parameter layer: The SwiftUI layer being sampled — the flowing light
///   content, masked to the silhouette shape on the Swift side.
/// - Parameter boundingRect: The view's bounding rect; `.zw` is its size.
/// - Parameter refraction: Master strength of the refractive bend (subtle by
///   default — the look leans on frost + rim rather than heavy warp).
/// - Parameter frost: Frosted-blur disk radius in pixels-ish (0 = sharp).
/// - Parameter thickness: Apparent glass thickness; widens the band over which
///   the rim bends hardest before the centre goes calm.
/// - Parameter edgeSoftness: Width of the soft alpha-contour band the rim and
///   the composite cross-fade ride on.
/// - Parameter fresnel: Strength of the cool Fresnel rim hugging the contour.
/// - Parameter fresnelSoftness: How far in from the contour the rim reaches.
/// - Parameter fresnelColor: RGB of the cool rim light.
/// - Parameter tintColor: RGB the glass tints the refracted light toward.
/// - Parameter tintIntensity: How strongly the tint is mixed in (0 = none).
/// - Returns: The new pixel color, transparent outside the silhouette.
[[stitchable]] half4 swGlassLogo(
    float2 position,
    SwiftUI::Layer layer,
    float4 boundingRect,
    float refraction,
    float frost,
    float thickness,
    float edgeSoftness,
    float fresnel,
    float fresnelSoftness,
    float3 fresnelColor,
    float3 tintColor,
    float tintIntensity
) {
    using namespace sw_glass_logo;

    float2 size = boundingRect.zw;

    // Coverage (silhouette alpha) at this pixel. Zero coverage = fully outside
    // the logo shape, so we cut straight to transparent and do no work.
    float cov = coverageAt(layer, position);
    if (cov <= 0.001) {
        return half4(0.0h);
    }

    // --- Surface normal from the ALPHA gradient -------------------------------
    // Sampling coverage one step away on each axis approximates ∂alpha/∂pos.
    // Across the antialiased silhouette edge alpha climbs from 0 (outside) to 1
    // (inside), so the gradient points INWARD; negating it gives an outward
    // surface normal just like an SDF gradient would, but recovered from the
    // rendered shape instead of an analytic formula.
    const float EPS = 1.5; // pixels — wide enough to span the AA edge
    float covX = coverageAt(layer, position + float2(EPS, 0.0));
    float covY = coverageAt(layer, position + float2(0.0, EPS));
    float2 alphaGrad = float2(covX - cov, covY - cov);
    float  gradLen   = length(alphaGrad);
    // Outward normal in screen space (zero in the flat interior where alpha is
    // constant, strong across the contour).
    float2 normal = (gradLen > 1e-4) ? (-alphaGrad / gradLen) : float2(0.0);

    // --- Edge band + thickness falloff ----------------------------------------
    // `edgeBand` is ~1 right on the antialiased contour and ~0 in the solid
    // interior — it is exactly where alpha is transitioning. We build it from
    // the gradient magnitude so it needs no distance field. The rim and the
    // refraction concentrate here; the calm interior is left mostly unbent,
    // matching how real glass bends light hardest at its curved edge.
    float band = saturate(gradLen * (32.0 / max(edgeSoftness, 0.001)));
    // Thickness widens the bend band a touch so thicker glass bends over a
    // broader lip; squared so the bend stays concentrated at the very edge.
    float thick = saturate(band * (0.5 + thickness));
    float bendStrength = thick * thick;

    // --- Refraction offset ----------------------------------------------------
    // Bend the sampled position along the outward normal, strongest at the edge.
    // Kept deliberately small: the brief calls for a subtle warp carried mostly
    // by frost and the cool rim, not a fisheye.
    float2 refrOffset = normal * (refraction * 14.0) * bendStrength;
    float2 lensPos = position + refrOffset;

    // --- Frosted blur (single golden-angle disk) ------------------------------
    // One small disk of taps frosts the refracted light. The disk grows a touch
    // toward the edge (more frost where the glass is "thicker" at the lip) and
    // stays calmer in the centre. All taps are weighted by their own coverage so
    // the blur never drags transparent exterior pixels into the silhouette.
    float diskRadius = frost * (0.6 + 0.8 * band);
    float3 acc = float3(0.0);
    float  wsum = 0.0;

    if (diskRadius > 0.25) {
        const int   TAPS = 9;
        const float GOLD = 2.39996323; // golden angle (radians)
        for (int i = 0; i < TAPS; i++) {
            float ang = float(i) * GOLD;
            float rad = sqrt(float(i) / float(TAPS));
            float2 d  = float2(cos(ang), sin(ang)) * rad * diskRadius;
            half4  s  = layer.sample(lensPos + d);
            float  wc = float(s.a);              // coverage weight: ignore exterior
            acc  += float3(s.rgb) * wc;
            wsum += wc;
        }
    }
    float3 refracted;
    if (wsum > 1e-4) {
        refracted = acc / wsum;
    } else {
        // No frost (or the disk fell entirely outside): single sharp tap.
        refracted = float3(layer.sample(lensPos).rgb);
    }

    // --- Tint -----------------------------------------------------------------
    // Nudge the refracted light toward the glass tint while preserving its
    // luminance, so the tint shifts hue/chroma without dimming the flow.
    float3 tinted = mix(refracted, tintColor, tintIntensity);
    float origLum   = dot(refracted, kLumWeights);
    float tintedLum = dot(tinted,    kLumWeights);
    tinted *= origLum / max(tintedLum, 0.0001);

    // --- Cool Fresnel rim -----------------------------------------------------
    // A thin cool-blue lip riding the alpha contour. `rim` peaks on the edge
    // band and fades into the interior over `fresnelSoftness`, gated by coverage
    // so it never leaks past the silhouette. Squared for a crisp grazing falloff.
    float rimReach = max(fresnelSoftness, 0.05);
    float rim = band * smoothstep(0.0, rimReach, band);
    rim = rim * rim * fresnel;
    float3 lit = tinted + fresnelColor * rim;

    // --- Composite ------------------------------------------------------------
    // Output alpha is the silhouette coverage, so the glass keeps the symbol's
    // exact shape with a soft antialiased edge and a fully transparent exterior.
    return half4(half3(lit * cov), half(cov));
}
```

## Usage

```swift
// Default — frosted-glass Apple logo on a near-black canvas with breathing bloom.
SWGlassLogo()

// A different symbol, larger.
SWGlassLogo(symbolName: "swift", symbolSize: 360)

// Slower flow, a touch more refraction.
SWGlassLogo(refraction: 0.5, flowSpeed: 0.1)

// Demo / debug — gear button opens a live-tuning sheet.
// Requires an enclosing NavigationStack.
NavigationStack {
    SWGlassLogo(showsControls: true)
}
```

## Parameters

| Parameter | Type | Default | Range | Notes |
|---|---|---|---|---|
| `symbolName` | `String` | `"apple.logo"` | any SF Symbol | The symbol used as the glass silhouette |
| `symbolSize` | `CGFloat` | `300` | — | Point size of the rendered symbol |
| `refraction` | `Float` | `0.35` | 0…1 | Master strength of the refractive bend at the glass edge |
| `frost` | `Float` | `9` | 0…24 | Frosted-blur disk radius in pixels-ish (0 = sharp) |
| `thickness` | `Float` | `0.6` | 0…2 | Apparent glass thickness; widens the hard-bending edge band |
| `edgeSoftness` | `Float` | `0.6` | 0.2…1.5 | Width of the soft alpha-contour band the rim rides on |
| `fresnel` | `Float` | `0.08` | 0…1 | Strength of the cool Fresnel rim hugging the contour |
| `fresnelSoftness` | `Float` | `0.57` | 0.1…1 | How far in from the contour the rim reaches |
| `flowSpeed` | `Double` | `0.18` | 0…0.6 | Base animation speed of the flowing light + bloom breath |
| `showsControls` | `Bool` | `false` | — | Demo-only gear ToolbarItem; requires an enclosing `NavigationStack` |

## Integration Checklist

1. Copy `SWGlassLogo.swift` and `SWGlassLogo.metal` into your Xcode target; the `.metal` file is compiled into the default `ShaderLibrary` automatically.
2. Confirm the deployment target is iOS 17+ / macOS 14+ — it relies on `MeshGradient`, `TimelineView`, and a Metal `layerEffect`.
3. Drop `SWGlassLogo()` straight in; it brings its own near-black canvas, flowing light, glass shader and bloom — no wiring needed.
4. Place it over a dark surface for the bloom to read; the showcase pins its own #0a0a0a canvas as pass 1.
5. Swap `symbolName` for any SF Symbol — the silhouette is whatever the symbol draws, recovered from the masked layer's alpha contour.

## Notes / Gotchas

- **This is a composite showcase, not a single shader.** The look is four stacked SwiftUI passes (canvas → flowing `MeshGradient` light → alpha-driven glass `layerEffect` → breathing `.shadow` bloom). The Metal kernel only handles pass 3; the canvas, the flowing color and the bloom are plain SwiftUI.
- **The shape comes from the mask, not an SDF.** Unlike the analytic-SDF `glass` recipe, this kernel recovers the surface normal from the masked layer's **alpha gradient** across the antialiased silhouette. Masking the flowing light to the symbol BEFORE the shader is what gives the layer the alpha contour the shader reads back.
- **Tap coverage-weighting is mandatory.** The frosted disk weights every tap by its own alpha so the blur never drags transparent exterior pixels into the silhouette; output alpha is the silhouette coverage so the exterior stays fully transparent.
- **Bloom breathes on the flow's clock.** The two stacked `.shadow` halos pulse their radius/opacity on a slow sine of the same `phase` that drives the flowing light, so the glow never reads as a dead static ring.
- The `.layerEffect` argument order **must** match the Metal `swGlassLogo` signature exactly: `boundingRect, refraction, frost, thickness, edgeSoftness, fresnel, fresnelSoftness, fresnelColor, tintColor, tintIntensity`.
- This is a first-pass approximation; thin-film iridescence, twirl distortion and exact SDF shaping are intentionally left for later refinement.
```
