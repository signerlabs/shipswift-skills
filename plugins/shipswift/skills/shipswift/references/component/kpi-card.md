---
id: component-kpi-card
title: KPI Card
description: Dashboard metric card with icon, title, value (numericText animation), tint color, and customizable trailing slot. Includes SWKPIDeltaTag for period-over-period comparison
tier: free
tags: [component, display, kpi, dashboard, metric, card, SwiftUI]
---

## Overview

`SWKPICard` is a dashboard KPI tile designed for revenue dashboards, analytics summaries, and admin panels where multiple metrics are arranged in a 2×N grid. It has three layout layers:

1. **Header row** -- SF Symbol icon (tinted) + title in `caption.secondary`.
2. **Hero value** -- `title2.bold` in the tint color, animated via `.contentTransition(.numericText())` so updating the value smoothly morphs the digits.
3. **Trailing slot** -- a `@ViewBuilder` closure for delta tags, unit labels, date ranges, or any caption-level metadata. The caller has full control over what sits in this slot.

Card chrome: 14pt padding, 16pt corner radius `systemBackground` fill (with macOS `windowBackgroundColor` equivalent), a faint black 0.04 shadow, and a tint × 0.15 stroke. Designed to sit on a soft-colored page background (cream, ivory, gray.opacity(0.06)) rather than pure white.

Ships with a companion `SWKPIDeltaTag` view -- a stock period-over-period indicator (green up-arrow / red down-arrow + signed percentage + comparison label). It gracefully degrades to a "No data" placeholder when `delta` is `nil`, so card chrome stays consistent across populated and empty states.

**On `value` formatting:** the caller is responsible for formatting the value string. This keeps the component locale-agnostic and lets you control currency symbols, thousand separators, and unit suffixes (`"$1.2K"`, `"¥1,234"`, `"42 cups"`, `"98%"`, etc.).

A convenience initializer (`extension where Trailing == EmptyView`) lets you omit the trailing closure entirely when no metadata is needed.

## Source Code

```swift
//
//  SWKPICard.swift
//  ShipSwift
//
//  Dashboard KPI card with icon, title, value, and a customizable trailing slot.
//  Designed for revenue dashboards, analytics summaries, and admin panels where
//  multiple metrics are arranged in a 2-column grid.
//
//  The card has three layout layers:
//    1. Header row -- SF Symbol icon (tinted) + title in caption.secondary
//    2. Hero value -- `title2.bold` in the tint color, animated via
//       `.contentTransition(.numericText())` so updating the value smoothly
//       morphs the digits.
//    3. Trailing slot -- a `@ViewBuilder` closure for delta tags, unit labels,
//       date ranges, or any caption-level metadata. Pair with `SWKPIDeltaTag`
//       for a stock period-over-period indicator.
//
//  Card chrome: 14pt padding, 16pt corner radius `systemBackground` fill, a
//  faint black 0.04 shadow, and a tint × 0.15 stroke. Designed to sit on a
//  soft-colored page background (e.g. cream / ivory) rather than pure white.
//
//  Usage:
//    // With delta tag trailing
//    SWKPICard(
//        title: "Today's Revenue",
//        value: "$1,234",
//        icon: "dollarsign.circle.fill",
//        tint: .brown
//    ) {
//        SWKPIDeltaTag(delta: 12.5)
//    }
//
//    // With a custom caption trailing
//    SWKPICard(
//        title: "Cups Sold",
//        value: "128",
//        icon: "cup.and.saucer.fill",
//        tint: .orange
//    ) {
//        Text("Unit: cups")
//            .font(.caption2)
//            .foregroundStyle(.secondary)
//    }
//
//    // Convenience initializer -- no trailing slot
//    SWKPICard(
//        title: "Total Members",
//        value: "1,024",
//        icon: "person.2.fill",
//        tint: .pink
//    )
//
//    // 2-column grid layout
//    LazyVGrid(columns: [.init(.flexible()), .init(.flexible())], spacing: 12) {
//        SWKPICard(title: "Revenue", value: "$1,234", icon: "dollarsign.circle.fill", tint: .brown) {
//            SWKPIDeltaTag(delta: 12.5)
//        }
//        SWKPICard(title: "Orders", value: "42", icon: "bag.fill", tint: .blue) {
//            SWKPIDeltaTag(delta: -3.2)
//        }
//    }
//
//  Note on `value` formatting:
//    The caller is responsible for formatting the value string. This keeps the
//    component locale-agnostic and lets you control currency symbols, thousand
//    separators, and unit suffixes ("$1.2K", "¥1,234", "42 cups", "98%", etc.).
//
//  Created by Wei Zhong on 5/11/26.
//

import SwiftUI

// MARK: - SWKPICard

struct SWKPICard<Trailing: View>: View {
    // MARK: - Properties

    /// Card title, rendered in caption.secondary above the value.
    let title: LocalizedStringKey

    /// Pre-formatted metric value (e.g. "$1,234", "1.2K", "42 cups").
    /// Caller controls locale, currency symbols, and unit suffixes.
    let value: String

    /// SF Symbol name displayed alongside the title.
    let icon: String

    /// Tint color used for the icon, value text, and outer stroke.
    let tint: Color

    /// Trailing slot rendered below the value (delta tags, unit labels, etc.).
    @ViewBuilder let trailing: () -> Trailing

    // MARK: - Initializer

    /// Create a KPI card with a custom trailing slot.
    /// - Parameters:
    ///   - title: Card title (LocalizedStringKey)
    ///   - value: Pre-formatted metric value
    ///   - icon: SF Symbol name
    ///   - tint: Tint color for icon, value, and stroke
    ///   - trailing: ViewBuilder closure for caption-level metadata
    init(
        title: LocalizedStringKey,
        value: String,
        icon: String,
        tint: Color,
        @ViewBuilder trailing: @escaping () -> Trailing
    ) {
        self.title = title
        self.value = value
        self.icon = icon
        self.tint = tint
        self.trailing = trailing
    }

    // MARK: - Body

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) {
                Image(systemName: icon)
                    .font(.caption)
                    .foregroundStyle(tint)
                Text(title)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
            }

            Text(value)
                .font(.title2)
                .fontWeight(.bold)
                .foregroundStyle(tint)
                .contentTransition(.numericText())

            trailing()
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 16)
                .fill(Color.swSystemBackground)
        )
        .shadow(color: .black.opacity(0.04), radius: 6, x: 0, y: 2)
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .stroke(tint.opacity(0.15), lineWidth: 1)
        )
    }
}

// MARK: - Convenience Initializer (No Trailing)

extension SWKPICard where Trailing == EmptyView {
    /// Create a KPI card without a trailing slot.
    /// - Parameters:
    ///   - title: Card title (LocalizedStringKey)
    ///   - value: Pre-formatted metric value
    ///   - icon: SF Symbol name
    ///   - tint: Tint color for icon, value, and stroke
    init(
        title: LocalizedStringKey,
        value: String,
        icon: String,
        tint: Color
    ) {
        self.init(title: title, value: value, icon: icon, tint: tint) {
            EmptyView()
        }
    }
}

// MARK: - SWKPIDeltaTag

/// Period-over-period delta indicator designed to drop into a `SWKPICard`
/// trailing slot. Renders an up/down arrow plus the signed percentage and a
/// configurable comparison label (defaults to "vs yesterday"). When `delta`
/// is `nil`, it gracefully degrades to a "No data" placeholder so the card
/// chrome stays consistent across populated and empty states.
struct SWKPIDeltaTag: View {
    // MARK: - Properties

    /// Signed percentage change. `nil` triggers the "No data" placeholder.
    let delta: Double?

    /// Label appended after the formatted percentage (e.g. "vs yesterday").
    var comparisonLabel: LocalizedStringKey = "vs yesterday"

    /// Foreground color when `delta >= 0`.
    var upColor: Color = .green

    /// Foreground color when `delta < 0`.
    var downColor: Color = .red

    /// Placeholder text shown when `delta` is `nil`.
    var emptyLabel: LocalizedStringKey = "No data"

    // MARK: - Body

    var body: some View {
        if let delta {
            let isUp = delta >= 0
            HStack(spacing: 4) {
                Image(systemName: isUp ? "arrow.up.right" : "arrow.down.right")
                Text("\(isUp ? "+" : "")\(delta, specifier: "%.1f")% \(Text(comparisonLabel))")
            }
            .font(.caption2)
            .foregroundStyle(isUp ? upColor : downColor)
        } else {
            Text(emptyLabel)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }
}

// MARK: - Cross-platform System Background

private extension Color {
    /// `systemBackground` on iOS, `windowBackgroundColor` on macOS.
    /// Kept private to preserve the file's self-containment.
    static var swSystemBackground: Color {
        #if os(iOS)
        Color(.systemBackground)
        #else
        Color(.windowBackgroundColor)
        #endif
    }
}

// MARK: - Preview

#Preview {
    ScrollView {
        VStack(spacing: 20) {
            // Grid layout
            LazyVGrid(
                columns: [
                    GridItem(.flexible(), spacing: 12),
                    GridItem(.flexible(), spacing: 12)
                ],
                spacing: 12
            ) {
                SWKPICard(
                    title: "Today's Revenue",
                    value: "$1,234",
                    icon: "dollarsign.circle.fill",
                    tint: .brown
                ) {
                    SWKPIDeltaTag(delta: 12.5)
                }

                SWKPICard(
                    title: "Cups Sold",
                    value: "128",
                    icon: "cup.and.saucer.fill",
                    tint: .orange
                ) {
                    Text("Unit: cups")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }

                SWKPICard(
                    title: "Monthly Revenue",
                    value: "$24,560",
                    icon: "calendar",
                    tint: .green
                ) {
                    SWKPIDeltaTag(delta: -3.2)
                }

                SWKPICard(
                    title: "New Members",
                    value: "42",
                    icon: "person.2.fill",
                    tint: .pink
                ) {
                    SWKPIDeltaTag(delta: nil)
                }
            }

            Divider()

            // Standalone -- no trailing slot
            SWKPICard(
                title: "Total Members",
                value: "1,024",
                icon: "person.3.fill",
                tint: .blue
            )
        }
        .padding()
    }
    .background(Color.gray.opacity(0.06))
}
```

## Usage

```swift
// 1. Single card with SWKPIDeltaTag trailing (most common dashboard pattern)
SWKPICard(
    title: "Today's Revenue",
    value: "$1,234",
    icon: "dollarsign.circle.fill",
    tint: .brown
) {
    SWKPIDeltaTag(delta: 12.5)
}

// 2. No trailing slot (convenience initializer where Trailing == EmptyView)
SWKPICard(
    title: "Total Members",
    value: "1,024",
    icon: "person.3.fill",
    tint: .blue
)

// 3. Custom trailing -- unit label, date range, or any caption-level metadata
SWKPICard(
    title: "Cups Sold",
    value: "128",
    icon: "cup.and.saucer.fill",
    tint: .orange
) {
    Text("Unit: cups")
        .font(.caption2)
        .foregroundStyle(.secondary)
}

// 4. 2-column grid layout (typical dashboard)
LazyVGrid(
    columns: [
        GridItem(.flexible(), spacing: 12),
        GridItem(.flexible(), spacing: 12)
    ],
    spacing: 12
) {
    SWKPICard(title: "Revenue", value: "$1,234", icon: "dollarsign.circle.fill", tint: .brown) {
        SWKPIDeltaTag(delta: 12.5)
    }
    SWKPICard(title: "Orders", value: "42", icon: "bag.fill", tint: .blue) {
        SWKPIDeltaTag(delta: -3.2)
    }
    SWKPICard(title: "New Members", value: "8", icon: "person.2.fill", tint: .pink) {
        SWKPIDeltaTag(delta: nil)   // graceful "No data" fallback
    }
    SWKPICard(title: "Conversion", value: "4.2%", icon: "chart.line.uptrend.xyaxis", tint: .green) {
        SWKPIDeltaTag(delta: 0.8, comparisonLabel: "vs last week")
    }
}

// 5. Animated value updates (the .numericText() content transition is built-in)
struct DashboardView: View {
    @State private var revenue: Int = 1234
    var body: some View {
        SWKPICard(
            title: "Revenue",
            value: "$\(revenue)",
            icon: "dollarsign.circle.fill",
            tint: .brown
        ) {
            SWKPIDeltaTag(delta: 12.5)
        }
        .onReceive(timer) { _ in
            withAnimation { revenue += Int.random(in: 1...100) }
            // digits smoothly morph via .contentTransition(.numericText())
        }
    }
}
```
