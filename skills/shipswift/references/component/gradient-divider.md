---
id: component-gradient-divider
title: Gradient Divider
description: Horizontal divider with a center-fade gradient effect (clear to color to clear)
tier: free
tags: [component, display, divider, gradient, SwiftUI]
---

## Overview

Horizontal divider with a center-fade gradient (clear -> color -> clear).

## Source Code

```swift
import SwiftUI

struct SWGradientDivider: View {
    var color: Color = .cyan
    var opacity: Double = 0.3
    var height: CGFloat = 1

    var body: some View {
        Rectangle()
            .fill(
                LinearGradient(
                    colors: [.clear, color.opacity(opacity), .clear],
                    startPoint: .leading,
                    endPoint: .trailing
                )
            )
            .frame(height: height)
    }
}
```

## Usage

```swift
SWGradientDivider()                                  // cyan, 0.3 opacity, 1pt
SWGradientDivider(color: .purple, opacity: 0.5)      // purple variant
SWGradientDivider(color: .mint, height: 2)            // thicker mint line
```
