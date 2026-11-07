---
id: animation-liquid-metal
title: Liquid Metal
description: Liquid-metal image filter — big light/dark metal blocks drifting one way like WWDC molten metal, with a cool-blue Fresnel rim, a breathing bloom glow that follows the metal, and a fully parameterised look over any opaque source view
tier: free
tags: [animation, metal, shader, SwiftUI]
---

## Overview

Image filter that wraps any view (best with bold SF Symbols / logos) in a flowing liquid-metal effect. Instead of thin repeating stripes, the look is governed by **big low-frequency light/dark metal blocks that drift one way like WWDC molten metal**: low-frequency simplex noise whose sample position slides continuously along a tilted axis produces a couple of large soft regions (one big bright block + one big shadow) that morph and creep across the silhouette with no seam. A cool-blue Fresnel rim hugs the contour, a slow global "breath" pulses whole-logo luminance dark→bright→dark, a cool ambient bounce tints the mid-tones, a touch of warm gold rides the hottest reflections, and a final dither breaks up banding.

The Swift side adds a **breathing bloom glow built from blurred copies of the metal itself** (a wide soft outer halo + a tight near bloom, both screen-blended under the crisp logo), so the halo's color, direction and motion follow the bright regions inside the metal automatically. The shader uses the source's red channel as its edge mask — bold opaque shapes work cleanest.

Requires iOS 18+ / macOS 15+ (SwiftUI `ShaderLibrary` / `Shader` / Metal `stitchable`).

## File Layout

```
SWAnimation/SWMetal/
  SWLiquidMetal.swift
  SWLiquidMetal.metal
```

## Source Code

### SWLiquidMetal.swift

```swift
//
//  SWLiquidMetal.swift
//  ShipSwift
//
//  Wraps any view in a flowing liquid-metal effect via a SwiftUI Metal
//  `layerEffect`: big low-frequency simplex-noise light/dark blocks drift
//  one way across the silhouette, with a cool-blue fresnel rim, a slow
//  brightness breath, and a bloom glow built from the metal itself.
//
//  Best paired with a bold, opaque silhouette (SF Symbol, logo) — the
//  effect uses the source's red channel as its edge mask, so vector
//  shapes against transparent background work cleanest.
//
//  Requires iOS 18+ / macOS 15+ (SwiftUI `ShaderLibrary`,
//  `Shader`/`ShaderFunction`, Metal `stitchable`).
//
//  Usage:
//    // Default — flowing chrome over the Apple logo
//    SWLiquidMetal {
//        Image(systemName: "apple.logo")
//            .font(.system(size: 300))
//    }
//
//    // Slower creep, softer rim
//    SWLiquidMetal(
//        timeScale: 0.05,
//        fresnel: 0.3
//    ) {
//        Image(systemName: "swift")
//            .font(.system(size: 300))
//    }
//
//    // Demo / debug — adds a gear button that opens a live-tuning sheet.
//    // Requires an enclosing `NavigationStack`.
//    SWLiquidMetal(showsControls: true) {
//        Image(systemName: "apple.logo")
//            .font(.system(size: 300))
//    }
//
//  The defaults are tuned to land close to the WWDC-style "liquid metal Apple
//  logo": a high-contrast cool-white-to-near-black polished-metal silhouette
//  with big drifting reflection blocks, a cool ambient bounce in the mid-tones,
//  a bright fresnel rim along the contour, and slow liquid creep. Every value
//  is still adjustable, and `showsControls: true` exposes them in a live sheet.
//
//  Parameters:
//    - speed: Multiplier on the internal animation time (default `1.0`).
//    - edge: Edge mask sharpness in `0...1` — higher = tighter edge
//            opacity falloff (default `0.8`).
//    - timeScale: Base animation speed multiplier in `0...2` — slow liquid
//                 creep (default `0.08`).
//    - coolTint: Cool blue/cyan ambient bounce strength in `0...1`, injected
//                into the highlight→shadow transition (default `0.5`).
//    - fresnel: Cool-white rim-highlight strength along the silhouette
//               contour in `0...1` (default `0.6`).
//    - showsControls: Attach a gear `ToolbarItem` that opens a
//                     live-tuning sheet (default `false`).
//
//  Created by Wei Zhong on 5/25/26.
//

import SwiftUI

// MARK: - Main View

struct SWLiquidMetal<Content: View>: View {
    /// Multiplier on the internal animation time.
    var speed: Float = 1.0

    /// Edge mask sharpness in 0...1.
    var edge: Float = 0.8

    /// Base animation speed multiplier in 0...2 (slow liquid creep).
    var timeScale: Float = 0.08

    /// Cool blue/cyan ambient bounce strength in 0...1.
    var coolTint: Float = 0.5

    /// Cool-white fresnel rim-highlight strength along the contour in 0...1.
    var fresnel: Float = 0.6

    /// When `true`, attaches a gear `ToolbarItem` that opens a live-tuning sheet.
    var showsControls: Bool = false

    private let content: Content

    init(
        speed: Float = 1.0,
        edge: Float = 0.8,
        timeScale: Float = 0.08,
        coolTint: Float = 0.5,
        fresnel: Float = 0.6,
        showsControls: Bool = false,
        @ViewBuilder content: () -> Content
    ) {
        self.speed = speed
        self.edge = edge
        self.timeScale = timeScale
        self.coolTint = coolTint
        self.fresnel = fresnel
        self.showsControls = showsControls
        self.content = content()
    }

    var body: some View {
        if showsControls {
            SWLiquidMetalControlled(initial: self, content: content)
        } else {
            SWLiquidMetalRenderer(initial: self, content: content)
        }
    }
}

// MARK: - Glow Tuning
// All dynamic-bloom magic numbers in one place — edit, recompile, observe.
// The halo breathes and shifts color on the metal's own slow clock; each value
// notes which way to nudge it.
private enum SWLMGlow {
    // The glow is built from BLURRED COPIES OF THE METAL ITSELF, layered under
    // the crisp logo with an additive blend. Because each copy is the SAME
    // shader output (just blurred), the halo's color, direction and motion
    // follow the bright regions inside the metal automatically — when an
    // internal reflection flows to one side, the outer glow flows with it; when
    // the body breathes dark/bright the glow breathes too. No separate halo
    // clock — it is literally the metal's own light spilling outward. Two
    // layers: a tight near bloom + a wide soft outer halo.
    static let nearRadius:  CGFloat = 26   // tight bloom blur radius (pt) — bigger = softer/wider near glow
    static let nearOpacity: Double  = 1.0  // tight bloom strength
    static let wideRadius:  CGFloat = 82   // wide halo blur radius (pt) — the far outer spill
    static let wideOpacity: Double  = 0.9  // wide halo strength
}

// MARK: - Renderer

private struct SWLiquidMetalRenderer<Content: View>: View {
    let initial: SWLiquidMetal<Content>
    let content: Content

    @State private var start: Date = .now

    var body: some View {
        TimelineView(.animation) { ctx in
            let elapsed = Float(ctx.date.timeIntervalSince(start))

            // The metal logo itself — one shader pass. The shader only samples
            // the layer at the current pixel (and reads layer.r for the edge
            // mask), so no sample-offset budget is needed.
            let metal = content.layerEffect(
                ShaderLibrary.swLiquidMetal(
                    .boundingRect,
                    .float(elapsed),
                    .float(initial.speed),
                    .float(initial.edge),
                    .float(initial.timeScale),
                    .float(initial.coolTint),
                    .float(initial.fresnel)
                ),
                maxSampleOffset: .zero
            )

            // Glow = blurred copies of the metal underneath, additively (screen)
            // blended. They are the SAME shader output, just blurred, so the
            // halo's color / direction / motion follow the bright regions inside
            // the metal — when an internal reflection flows to one side the
            // outer glow flows with it, and when the body breathes dark/bright
            // the glow breathes too. A wide soft outer halo + a tight near bloom
            // under the crisp logo.
            ZStack {
                metal
                    .blur(radius: SWLMGlow.wideRadius)
                    .blendMode(.screen)
                    .opacity(SWLMGlow.wideOpacity)
                metal
                    .blur(radius: SWLMGlow.nearRadius)
                    .blendMode(.screen)
                    .opacity(SWLMGlow.nearOpacity)
                metal
            }
        }
    }
}

// MARK: - Controlled Wrapper (gear toolbar item + live sheet)

private struct SWLiquidMetalControlled<Content: View>: View {
    @State private var speed: Float
    @State private var edge: Float
    @State private var timeScale: Float
    @State private var coolTint: Float
    @State private var fresnel: Float

    @State private var showSheet = false

    private let content: Content

    init(initial: SWLiquidMetal<Content>, content: Content) {
        _speed     = State(initialValue: initial.speed)
        _edge      = State(initialValue: initial.edge)
        _timeScale = State(initialValue: initial.timeScale)
        _coolTint  = State(initialValue: initial.coolTint)
        _fresnel   = State(initialValue: initial.fresnel)
        self.content = content
    }

    var body: some View {
        // Fixed dark demo canvas: the metal sheen, the cool tint and especially
        // the white bloom only read against black, so the controlled/demo mode
        // pins a full-bleed black background behind the rendered logo.
        ZStack {
            Color.black.ignoresSafeArea()

            SWLiquidMetalRenderer(
                initial: SWLiquidMetal(
                    speed: speed,
                    edge: edge,
                    timeScale: timeScale,
                    coolTint: coolTint,
                    fresnel: fresnel
                ) { content },
                content: content
            )
        }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    showSheet = true
                } label: {
                    Image(systemName: "slider.horizontal.3")
                }
                .accessibilityLabel("Liquid Metal Controls")
            }
        }
        .sheet(isPresented: $showSheet) {
            SWLiquidMetalControlsSheet(
                speed: $speed,
                edge: $edge,
                timeScale: $timeScale,
                coolTint: $coolTint,
                fresnel: $fresnel
            )
            .presentationDetents([.medium])
            .presentationDragIndicator(.visible)
        }
    }
}

// MARK: - Controls Sheet

private struct SWLiquidMetalControlsSheet: View {
    @Binding var speed: Float
    @Binding var edge: Float
    @Binding var timeScale: Float
    @Binding var coolTint: Float
    @Binding var fresnel: Float

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section("Metal") {
                    SWLiquidMetalSliderRow(label: "Edge",          value: $edge,         range: 0...1,      step: 0.01)
                    SWLiquidMetalSliderRow(label: "Cool Tint",     value: $coolTint,     range: 0...1,      step: 0.01)
                    SWLiquidMetalSliderRow(label: "Fresnel Rim",   value: $fresnel,      range: 0...1,      step: 0.01)
                }

                Section("Motion") {
                    SWLiquidMetalSliderRow(label: "Time Scale", value: $timeScale, range: 0...2, step: 0.01)
                    SWLiquidMetalSliderRow(label: "Speed",      value: $speed,     range: 0...3, step: 0.05)
                }
            }
            .navigationTitle("Liquid Metal")
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

private struct SWLiquidMetalSliderRow: View {
    let label: String
    @Binding var value: Float
    let range: ClosedRange<Float>
    let step: Float

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(label)
                Spacer()
                Text(String(format: step < 0.01 ? "%.3f" : "%.2f", value))
                    .font(.callout.monospacedDigit())
                    .foregroundStyle(.secondary)
            }
            Slider(value: $value, in: range, step: step)
        }
    }
}

// MARK: - Preview

#Preview("Apple logo") {
    NavigationStack {
        SWLiquidMetal(showsControls: true) {
            Image(systemName: "apple.logo")
                .font(.system(size: 300))
        }
    }
}

#Preview("Swift logo") {
    SWLiquidMetal {
        Image(systemName: "swift")
            .font(.system(size: 300))
    }
}
```

### SWLiquidMetal.metal

```metal
//
//  SWLiquidMetal.metal
//  ShipSwift
//
//  Stitchable SwiftUI layerEffect — a flowing liquid-metal effect.
//  Wraps any view (typically an SF Symbol) in animated metal: big
//  low-frequency simplex-noise light/dark blocks drift one way across
//  the silhouette, lit from above, with a cool ambient bounce, a warm
//  accent, a fresnel rim along the contour and a slow brightness breath.
//  Layer size is sourced from the `boundingRect` parameter for
//  portability across SwiftUI shader APIs.
//
//  Paired with: SWLiquidMetal.swift
//  Entry point: `swLiquidMetal` — invoked via SwiftUI `.layerEffect(...)`.
//  Requires iOS 18+ / macOS 15+.
//

#include <metal_stdlib>
#include <SwiftUI/SwiftUI_Metal.h>
using namespace metal;

// =============================================================================
// MARK: - Constants & shared helpers
// =============================================================================

constant float4 SWLM_C = float4(0.211324865405187,
                                 0.366025403784439,
                                -0.577350269189626,
                                 0.024390243902439);

// =============================================================================
// MARK: - Tunable Parameters  (edit values here, recompile, observe)
// =============================================================================
// All the visual magic numbers that were repeatedly hand-tuned live here in one
// place. Each is the CURRENT shipping value; the shader body below only
// references these names. Edit a value, recompile, and look — no hunting inside
// the algorithm. Each comment says what it controls and which way to nudge it.

// --- Endpoint colors ---------------------------------------------------------
// The two ends of the metal ramp. color1 = cool specular white, color2 = the
// near-black shadow. Push color1 toward 1.0 for a brighter sheen; lower color2
// (toward 0) for a darker, higher-contrast body.
constant float3 SWLM_COLOR1     = float3(0.97, 0.98, 1.0);   // cool highlight white
constant float3 SWLM_COLOR2     = float3(0.035, 0.035, 0.045);// near-black shadow base
constant float  SWLM_COLOR2_BLUE_BOOST = 0.05;  // extra blue added to shadow toward bottom-right (bigger = bluer shadow)

// --- Cool ambient bounce -----------------------------------------------------
// The blue/cyan tint mixed into the mid-tones. More blue / less red+green =
// cooler. Multiplied at runtime by the `coolTint` slider.
constant float3 SWLM_COOL_COLOR = float3(0.55, 0.72, 1.0);   // ambient cool-blue bounce

// --- Fresnel rim -------------------------------------------------------------
// Color and internal strength of the contour rim. RIM_GAIN scales how wide the
// rim ring reads before the `fresnel` slider applies (bigger = fatter rim).
constant float3 SWLM_RIM_COLOR  = float3(0.60, 0.80, 1.0);   // cool-BLUE grazing rim (WWDC blue edge)
constant float  SWLM_RIM_GAIN   = 4.0;   // rim ring width gain (bigger = wider rim band)
constant float  SWLM_RIM_GLOW   = 0.7;   // additive cool-blue edge glow — keeps the rim bright even on dark frames (bigger = brighter blue edge)

// --- Low-frequency block field (the big bright body) -------------------------
// FLOW_AXIS = the tilted direction the big blocks drift along. Rotate it to
//   change which way the light streaks.
// FIELD_SCALE = scale of the blocks — SMALLER = BIGGER blocks.
// FLOW_DRIFT = one-way drift speed (bigger = faster).
// BRIGHT_LO/BRIGHT_HI = how much of the value range counts as "lit silver".
//   Lower both to make the bright body claim MORE of the logo (less shadow);
//   bring them closer together for a harder light/dark edge.
// OUT_BASE = output floor of the field (bigger = shadows never as deep).
constant float2 SWLM_FLOW_AXIS   = float2(0.62, 0.78);  // direction the bright bar sweeps along (rotate to re-aim)
constant float  SWLM_FIELD_SCALE = 1.1;   // scale of the big light/dark blocks — SMALLER = BIGGER blocks (~1 = one big bright block + one big shadow across the logo)
constant float  SWLM_FLOW_DRIFT  = 0.6;   // one-way flow speed of the big blocks (bigger = faster continuous drift)
constant float  SWLM_BRIGHT_LO   = 0.34;   // bright-zone threshold low  (lower = more of logo is lit)
constant float  SWLM_BRIGHT_HI   = 0.66;   // bright-zone threshold high (closer to LO = harder edge)
constant float  SWLM_OUT_BASE    = 0.05;   // lowField output floor (bigger = shadows never as deep)

// --- Global brightness breath ------------------------------------------------
// Whole-logo luminance slowly pulses dark -> bright -> dark, matching the WWDC
// clip's overall rise & fall (runs on an independent slow clock).
constant float  SWLM_BREATH_MIN   = 0.82;  // dimmest point of the breath (smaller = deeper dips)
constant float  SWLM_BREATH_SPEED = 1.0;   // breath rate rad/s (~6.3s per cycle at 1.0)

// --- Local warm accent -------------------------------------------------------
// A drifting touch of warm gold in the hottest reflections — cool-silver
// dominant with a hint of warmth, not pure greyscale.
constant float3 SWLM_WARM_COLOR = float3(1.0, 0.66, 0.42);  // warm orange-gold accent
constant float  SWLM_WARM_AMT   = 0.18;   // warmth in hot reflections (0 = pure cool)

// --- Dither ------------------------------------------------------------------
// Tiny per-pixel noise added at the very end to break up 8-bit banding and the
// visible "block edges" where the smooth field crosses a smoothstep threshold.
constant float  SWLM_DITHER     = 2.2;   // dither strength in 1/255 units (bigger = noisier but smoother gradients)

// =============================================================================

static float3 swLM_mod289v3(float3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
static float2 swLM_mod289v2(float2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
static float3 swLM_permute(float3 x)  { return swLM_mod289v3(((x * 34.0) + 1.0) * x); }

// 2D simplex noise (Ashima Arts / Stefan Gustavson, public domain).
static float swLM_snoise(float2 v) {
    float2 i = floor(v + dot(v, SWLM_C.yy));
    float2 x0 = v - i + dot(i, SWLM_C.xx);
    float2 i1 = (x0.x > x0.y) ? float2(1.0, 0.0) : float2(0.0, 1.0);
    float4 x12 = x0.xyxy + SWLM_C.xxzz;
    x12.xy -= i1;
    i = swLM_mod289v2(i);
    float3 p = swLM_permute(swLM_permute(i.y + float3(0.0, i1.y, 1.0))
                                       + i.x + float3(0.0, i1.x, 1.0));
    float3 m = max(0.5 - float3(dot(x0, x0),
                                 dot(x12.xy, x12.xy),
                                 dot(x12.zw, x12.zw)), 0.0);
    m = m * m;
    m = m * m;
    float3 x = 2.0 * fract(p * SWLM_C.www) - 1.0;
    float3 h = abs(x) - 0.5;
    float3 ox = floor(x + 0.5);
    float3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
    float3 g;
    g.x  = a0.x  * x0.x   + h.x  * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
}

// Soft alpha falloff at the layer's outer 10%.
static float swLM_imgFrameAlpha(float2 uv, float frameWidth) {
    float f = smoothstep(0.0, frameWidth, uv.x)
            * smoothstep(1.0, 1.0 - frameWidth, uv.x);
    f *= smoothstep(0.0, frameWidth, uv.y)
       * smoothstep(1.0, 1.0 - frameWidth, uv.y);
    return f;
}

// Large-scale, NON-periodic, DIRECTIONAL light/dark field — the metal's body.
// Built purely from big simplex blobs that slide along a tilted axis, like
// polished metal reflecting one bright window drifting across a dark room.
// Returns a 0..1 brightness with no repetition and no concentric structure.
//
// `flow` (the animation time) slowly drifts the blobs so the big reflections
// creep diagonally like mercury.
static float swLM_lowField(float2 uv, float topDown, float flow) {
    // BIG soft light/dark blocks that FLOW one way, like WWDC's molten metal.
    // Sample LOW-frequency noise whose position slides continuously in a single
    // direction: low frequency => only a couple of LARGE soft regions span the
    // whole logo (one big bright block + one big shadow), never small dots or
    // thin strands; the continuous slide (no fract/wrap) flows endlessly one way
    // with NO jump; two octaves let the big shape morph slowly like liquid metal.
    float2 dir   = normalize(SWLM_FLOW_AXIS);
    float2 fuv   = uv - dir * (flow * SWLM_FLOW_DRIFT);            // one-way continuous flow, no seam
    float  n1    = swLM_snoise(fuv * SWLM_FIELD_SCALE);
    float  n2    = swLM_snoise(fuv * SWLM_FIELD_SCALE * 1.7 + float2(4.0, 9.0));
    float  field = 0.5 + 0.55 * n1 + 0.22 * n2;                   // big soft light/dark field
    float  s     = smoothstep(SWLM_BRIGHT_LO, SWLM_BRIGHT_HI, field);
    s = s * s * (3.0 - 2.0 * s);                                  // smootherstep: wide soft boundary, no line
    return saturate(SWLM_OUT_BASE + (1.0 - SWLM_OUT_BASE) * s);
}

// =============================================================================
// MARK: - swLiquidMetal
// =============================================================================

[[ stitchable ]] half4 swLiquidMetal(float2 position,
                                     SwiftUI::Layer layer,
                                     float4 boundingRect,
                                     float  time,
                                     float  speed,
                                     float  edge,          // 0..1 edge sharpness
                                     float  timeScale,     // 0..2 animation rate
                                     float  coolTint,      // 0..1 cool blue ambient bounce
                                     float  fresnel) {     // 0..1 rim highlight strength
    float2 sz = boundingRect.zw;
    float2 uvRaw = position / max(sz, float2(1.0));
    float2 uv = uvRaw;

    half4 img = layer.sample(position);
    if (img.a == 0.0) {
        return img;
    }

    float t = timeScale * speed * time;

    // High-contrast endpoints: a cool near-white specular highlight against a
    // near-black shadow. color2 is pushed much darker than before so the
    // light/dark split reads like polished metal rather than grey plastic.
    // A faint top-down luminance ramp keeps the top brighter and the bottom
    // darker (light comes from above) while never letting the bottom die to
    // pure black.
    float topDown = mix(0.06, 1.0, smoothstep(1.0, 0.0, uv.y));
    float3 color1 = SWLM_COLOR1 * mix(0.85, 1.0, topDown);
    float3 color2 = float3(SWLM_COLOR2.r, SWLM_COLOR2.g,
                           SWLM_COLOR2.b + SWLM_COLOR2_BLUE_BOOST * smoothstep(0.7, 1.3, uv.x + uv.y))
                    * mix(0.7, 1.0, topDown);

    // Cool ambient bounce injected into the highlight->shadow transition:
    // a soft blue/cyan tint that keeps the metal from looking like a flat
    // greyscale ramp. Sampled by how close a channel sits to the mid-tone.
    float3 coolColor = SWLM_COOL_COLOR;

    float pixelEdge = float(img.r);   // use red channel of the source as the edge mask

    float opacity = 1.0 - smoothstep(0.9 - 0.5 * saturate(edge),
                                     1.0 - 0.5 * saturate(edge), pixelEdge);
    opacity *= swLM_imgFrameAlpha(uvRaw, 0.1);

    // --- Large-scale block reflection ---------------------------------------
    // The metal body: a couple of big, smooth, non-periodic light/dark blocks
    // (bright body + dark zone) that drift one way across the logo.
    float lowF = swLM_lowField(uv, topDown, t);
    float3 metal = mix(color2, color1, lowF);

    // --- Global brightness breath -------------------------------------------
    // Whole-logo luminance pulse (dark -> bright -> dark) on a slow independent
    // clock, matching the WWDC clip's overall rise & fall.
    float breath = mix(SWLM_BREATH_MIN, 1.0, 0.5 + 0.5 * sin(time * SWLM_BREATH_SPEED));
    metal *= breath;

    // --- Cool ambient bounce -------------------------------------------------
    // Inject the blue/cyan tint strongest in the mid-tones (the highlight->
    // shadow transition), tapering off in both the brightest specular and the
    // deepest shadow so the rim stays clean white and the core stays dark.
    float luma = dot(metal, float3(0.299, 0.587, 0.114));
    float midBand = smoothstep(0.12, 0.45, luma) * smoothstep(0.95, 0.5, luma);
    metal = mix(metal, metal * coolColor, saturate(coolTint) * midBand);

    // --- Local warm accent --------------------------------------------------
    // A drifting hint of warm gold in the hottest reflections, so the metal is
    // cool-dominant with a touch of warmth rather than pure greyscale.
    float warmGate = smoothstep(0.6, 0.95, lowF) *
                     (0.5 + 0.5 * swLM_snoise(uv * 0.8 - float2(0.12 * t, 0.05 * t)));
    metal = mix(metal, metal * SWLM_WARM_COLOR, saturate(warmGate) * SWLM_WARM_AMT);

    // --- Fresnel rim highlight ----------------------------------------------
    // Grazing-angle reflection along the silhouette contour, computed WITHOUT
    // sampling neighbouring pixels so the shader honours `maxSampleOffset:
    // .zero`. The source red channel `pixelEdge` ramps 0 -> 1 across the soft
    // antialiased outline of the silhouette; the product `e * (1 - e)` peaks
    // exactly on that transition band (the contour) and is ~0 in both the
    // solid interior and the empty exterior. That gives a clean rim ring that
    // we brighten toward a cool white.
    float e = saturate(pixelEdge);
    float rim = saturate(SWLM_RIM_GAIN * e * (1.0 - e)) * saturate(fresnel);
    rim *= rim;   // tighten the ring so the rim hugs the very edge
    float3 rimColor = SWLM_RIM_COLOR;   // cool-blue grazing reflection
    metal = mix(metal, rimColor, rim);
    metal += rimColor * rim * SWLM_RIM_GLOW;   // additive glow keeps the blue edge bright on dark frames

    // Dither: break up 8-bit banding / visible block edges on the big smooth gradients.
    float dither = (fract(sin(dot(position, float2(12.9898, 78.233))) * 43758.5453) - 0.5) * (SWLM_DITHER / 255.0);
    metal += dither;

    return half4(half(metal.r * opacity),
                 half(metal.g * opacity),
                 half(metal.b * opacity),
                 half(opacity));
}
```

## Usage

```swift
// Default — molten-metal flowing chrome over the Apple logo, with bloom glow
SWLiquidMetal {
    Image(systemName: "apple.logo")
        .font(.system(size: 300))
}

// A different symbol
SWLiquidMetal {
    Image(systemName: "swift")
        .font(.system(size: 300))
}

// Slower creep, softer rim
SWLiquidMetal(timeScale: 0.05, fresnel: 0.3) {
    Image(systemName: "apple.logo")
        .font(.system(size: 300))
}

// Demo / debug — gear button opens a live-tuning sheet.
// Requires an enclosing NavigationStack.
NavigationStack {
    SWLiquidMetal(showsControls: true) {
        Image(systemName: "apple.logo")
            .font(.system(size: 300))
    }
}
```

## Parameters

| Parameter | Type | Default | Range | Notes |
|---|---|---|---|---|
| `speed` | `Float` | `1.0` | 0…3 | Multiplier on the internal animation time |
| `edge` | `Float` | `0.8` | 0…1 | Edge mask sharpness — higher = tighter edge opacity falloff |
| `timeScale` | `Float` | `0.08` | 0…2 | Base animation speed multiplier — slow liquid creep |
| `coolTint` | `Float` | `0.5` | 0…1 | Cool blue/cyan ambient bounce injected into the highlight→shadow transition |
| `fresnel` | `Float` | `0.6` | 0…1 | Cool-white/blue rim-highlight strength along the silhouette contour |
| `showsControls` | `Bool` | `false` | — | Demo-only gear ToolbarItem; requires an enclosing `NavigationStack` |

## Integration Checklist

1. Copy `SWLiquidMetal.swift` and `SWLiquidMetal.metal` into your Xcode target; the `.metal` file is compiled into the default `ShaderLibrary` automatically.
2. Confirm the deployment target is iOS 18+ / macOS 15+.
3. Wrap a bold, opaque silhouette (SF Symbol or logo) — the shader uses the source's red channel as its edge mask, so vector shapes against a transparent background work cleanest.
4. The bloom glow only reads against a dark background; place the view over black (the demo mode pins a full-bleed dark canvas for you).
5. Leave `maxSampleOffset: .zero` — the shader (including the Fresnel rim) is computed without sampling neighbouring pixels.

## Notes / Gotchas

- **The look is the block field.** The metal body comes from `swLM_lowField` — a few big low-frequency light/dark blocks that drift one way along `SWLM_FLOW_AXIS` with no seam or wrap. Block size, drift speed and the light/dark split are the `SWLM_FIELD_SCALE`, `SWLM_FLOW_DRIFT` and `SWLM_BRIGHT_LO` / `SWLM_BRIGHT_HI` constants.
- **Bloom is the metal's own light.** The glow is built from blurred copies of the same shader output (a wide soft halo + a tight near bloom, screen-blended under the crisp logo), so the halo's color / direction / motion follow the bright regions inside the metal automatically and breathe with it.
- **Tunable constants live at the top of the `.metal` file.** The `SWLM_*` constant block holds every hand-tuned magic number (endpoint colors, flow axis & drift, contrast thresholds, breath, dither, warm/cool accents). Edit there, recompile, observe — no hunting inside the algorithm.
- **Dither at the end is intentional.** A tiny per-pixel hash breaks up 8-bit banding and the visible block edges where the smooth field crosses a smoothstep threshold.
- The argument order in the `.layerEffect` call **must** match the Metal `swLiquidMetal` signature exactly: `boundingRect, time, speed, edge, timeScale, coolTint, fresnel`.
```
