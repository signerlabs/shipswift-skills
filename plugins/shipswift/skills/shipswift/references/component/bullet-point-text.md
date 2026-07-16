---
id: component-bullet-point-text
title: Bullet Point Text
description: Text label with a colored capsule bullet point indicator that accepts any View content via @ViewBuilder
tier: free
tags: [component, display, bullet, text, label, SwiftUI]
---

## Overview

Text label with a colored capsule bullet point indicator. Accepts any View content via `@ViewBuilder`, displayed to the right of the bullet.

## Source Code

```swift
import SwiftUI

struct SWBulletPointText<Content: View>: View {
    var bulletColor: Color
    @ViewBuilder var content: Content

    var body: some View {
        HStack(spacing: 6) {
            Capsule()
                .fill(bulletColor)
                .frame(width: 4, height: 12)

            content
                .font(.subheadline)
        }
    }
}
```

## Usage

```swift
// Simple text
SWBulletPointText(bulletColor: .blue) {
    Text("Wealth")
}

// Custom content (HStack, Image, etc.)
SWBulletPointText(bulletColor: .green) {
    HStack {
        Text("Health")
        Image(systemName: "heart.fill")
    }
}
```
