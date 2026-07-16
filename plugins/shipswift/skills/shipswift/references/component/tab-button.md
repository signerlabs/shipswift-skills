---
id: component-tab-button
title: Tab Button
description: Capsule-shaped tab button toggling between selected and unselected states for segmented controls
tier: free
tags: [component, input, tab, button, segmented, filter, SwiftUI]
---

## Overview

Capsule-shaped tab button that toggles between selected (accent color) and unselected (gray) states. Suitable for building custom segmented controls or horizontal filter bars.

## Source Code

```swift
import SwiftUI

struct SWTabButton: View {
    let title: LocalizedStringKey
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.subheadline)
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
                .background(isSelected ? Color.accentColor : Color.secondary.opacity(0.2))
                .foregroundStyle(isSelected ? .white : .primary)
                .clipShape(Capsule())
        }
        .buttonStyle(.plain)
    }
}
```

## Usage

```swift
@State private var selectedTab = 0

HStack {
    SWTabButton(title: "All", isSelected: selectedTab == 0) {
        selectedTab = 0
    }
    SWTabButton(title: "Favorites", isSelected: selectedTab == 1) {
        selectedTab = 1
    }
    SWTabButton(title: "Recent", isSelected: selectedTab == 2) {
        selectedTab = 2
    }
}
```
