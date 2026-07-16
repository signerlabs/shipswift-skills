---
id: component-status-badge
title: Status Badge
description: Capsule-shaped colored status badge with preset styles (info, success, warning, error, neutral) for workflow states like orders, tickets, contracts, and tasks
tier: free
tags: [component, display, badge, status, capsule, workflow, SwiftUI]
---

## Overview

`SWStatusBadge` is a compact, capsule-shaped status label designed to pop visually in list rows, headers, and detail screens without dominating the layout. It ships with five semantic preset styles -- `info` (blue), `success` (green), `warning` (orange), `error` (red), and `neutral` (gray) -- each mapping a single tint color to the background fill (color × 0.18, slightly higher for `success`), the foreground text, and a faint matching stroke (color × 0.35). The result is legible in both light and dark mode with zero per-style overrides.

Designed for any workflow-driven application: order pipelines (pending / making / ready / completed), support tickets (open / in-progress / resolved / escalated), contracts (draft / signed / expired), task lists, inventory states, and more. Accepts both `LocalizedStringKey` (for static, localized labels) and `String` (for server-driven or runtime-formatted text).

## Source Code

```swift
//
//  SWStatusBadge.swift
//  ShipSwift
//
//  Capsule-shaped status badge with five preset semantic styles. Designed for
//  list rows, headers, and detail screens where a short status label needs to
//  pop visually without dominating the layout.
//
//  Each style renders as a translucent background (color × 0.18 / .20 for the
//  brighter `success` case), the same color used for the foreground text, and
//  a faint matching stroke (color × 0.35) on the capsule border. The result is
//  legible in both light and dark mode without per-style overrides.
//
//  Usage:
//    // Preset style with LocalizedStringKey (recommended for static text)
//    SWStatusBadge(text: "In Stock", style: .success)
//    SWStatusBadge(text: "Pending Review", style: .warning)
//
//    // Dynamic String (e.g. server-driven label)
//    SWStatusBadge(text: order.statusName, style: .info)
//
//    // Combine with your own enum by mapping to SWStatusBadgeStyle
//    SWStatusBadge(text: order.status.displayName, style: order.status.badgeStyle)
//
//  Style cases:
//    .info     -- blue
//    .success  -- green
//    .warning  -- orange
//    .error    -- red
//    .neutral  -- gray / secondary
//
//  Created by Wei Zhong on 5/11/26.
//

import SwiftUI

// MARK: - SWStatusBadgeStyle

/// Semantic style preset for `SWStatusBadge`.
///
/// Each case maps to a single tint color that drives the background fill,
/// the foreground text color, and the capsule stroke.
enum SWStatusBadgeStyle: CaseIterable {
    case info
    case success
    case warning
    case error
    case neutral

    /// Foreground color (text + stroke base).
    var tint: Color {
        switch self {
        case .info:    .blue
        case .success: .green
        case .warning: .orange
        case .error:   .red
        case .neutral: .secondary
        }
    }

    /// Background tint opacity. `success` is bumped slightly to compensate
    /// for green appearing visually lighter at the same alpha.
    var backgroundOpacity: Double {
        switch self {
        case .success: 0.20
        default:       0.18
        }
    }
}

// MARK: - SWStatusBadge

struct SWStatusBadge: View {
    // MARK: - Properties

    let text: LocalizedStringKey
    let style: SWStatusBadgeStyle

    // MARK: - Initializers

    /// Create a status badge with a `LocalizedStringKey` label.
    /// Recommended for static text that should be localized via `Localizable.xcstrings`.
    init(text: LocalizedStringKey, style: SWStatusBadgeStyle) {
        self.text = text
        self.style = style
    }

    /// Create a status badge with a dynamic `String` label.
    /// Use this for server-driven or runtime-formatted text where localization
    /// keys are not available.
    init(text: String, style: SWStatusBadgeStyle) {
        self.text = LocalizedStringKey(text)
        self.style = style
    }

    // MARK: - Body

    var body: some View {
        Text(text)
            .font(.caption)
            .fontWeight(.semibold)
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .foregroundStyle(style.tint)
            .background(
                Capsule().fill(style.tint.opacity(style.backgroundOpacity))
            )
            .overlay(
                Capsule().stroke(style.tint.opacity(0.35), lineWidth: 0.5)
            )
    }
}

// MARK: - Preview

#Preview {
    VStack(spacing: 12) {
        HStack(spacing: 8) {
            SWStatusBadge(text: "Info", style: .info)
            SWStatusBadge(text: "Success", style: .success)
            SWStatusBadge(text: "Warning", style: .warning)
            SWStatusBadge(text: "Error", style: .error)
            SWStatusBadge(text: "Neutral", style: .neutral)
        }

        Divider()

        // Real-world examples mapped from a domain enum
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Order #1024")
                Spacer()
                SWStatusBadge(text: "Pending", style: .warning)
            }
            HStack {
                Text("Order #1025")
                Spacer()
                SWStatusBadge(text: "Making", style: .info)
            }
            HStack {
                Text("Order #1026")
                Spacer()
                SWStatusBadge(text: "Ready", style: .success)
            }
            HStack {
                Text("Order #1027")
                Spacer()
                SWStatusBadge(text: "Cancelled", style: .error)
            }
            HStack {
                Text("Order #1028")
                Spacer()
                SWStatusBadge(text: "Completed", style: .neutral)
            }
        }
        .padding(.horizontal)
    }
    .padding()
}
```

## Usage

```swift
// 1. Preset styles with LocalizedStringKey (recommended for static, localized labels)
SWStatusBadge(text: "Pending", style: .warning)
SWStatusBadge(text: "Making", style: .info)
SWStatusBadge(text: "Ready", style: .success)
SWStatusBadge(text: "Cancelled", style: .error)
SWStatusBadge(text: "Completed", style: .neutral)

// 2. Dynamic String (e.g. server-driven status name)
SWStatusBadge(text: order.statusName, style: .info)

// 3. Drive style from your domain enum
enum OrderStatus {
    case pending, making, ready, completed, cancelled

    var badgeStyle: SWStatusBadgeStyle {
        switch self {
        case .pending:   .warning
        case .making:    .info
        case .ready:     .success
        case .completed: .neutral
        case .cancelled: .error
        }
    }

    var displayName: String {
        switch self {
        case .pending:   "Pending"
        case .making:    "Making"
        case .ready:     "Ready"
        case .completed: "Completed"
        case .cancelled: "Cancelled"
        }
    }
}

SWStatusBadge(text: order.status.displayName, style: order.status.badgeStyle)

// 4. Inside a list row
HStack {
    Text(order.title)
    Spacer()
    SWStatusBadge(text: order.status.displayName, style: order.status.badgeStyle)
}

// 5. Inside a detail header (multiple badges side-by-side)
HStack(spacing: 8) {
    SWStatusBadge(text: "Verified", style: .success)
    SWStatusBadge(text: "Premium", style: .info)
}
```
