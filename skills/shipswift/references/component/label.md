---
id: component-label
title: Label with Icon and Image
description: Reusable label components pairing a leading visual (SF Symbol or image resource) with localized text
tier: free
tags: [component, display, label, icon, image, list, SwiftUI]
---

## Overview

Reusable label components that pair a leading visual (SF Symbol or image resource) with a localized text name. Commonly used in List rows, settings screens, or menu items. Includes two variants: `SWLabelWithIcon` and `SWLabelWithImage`.

## Source Code

```swift
import SwiftUI

struct SWLabelWithIcon: View {
    var icon: String = "pencil"
    var bg: Color = .blue
    var name: LocalizedStringResource = "Name"

    var body: some View {
        HStack {
            ZStack {
                Circle()
                    .frame(width: 32, height: 32)
                    .foregroundStyle(bg.gradient.opacity(0.9))
                Image(systemName: icon)
                    .fontWeight(.light)
                    .foregroundStyle(.ultraThickMaterial)
            }
            .padding(5)
            Text(name)
        }
    }
}

struct SWLabelWithImage: View {
    var image: ImageResource
    var name: LocalizedStringResource = "Name"
    var body: some View {
        HStack {
            Image(image)
                .resizable()
                .scaledToFit()
                .frame(width: 32, height: 32)
                .clipShape(RoundedRectangle(cornerRadius: 6))
                .padding(5)
            Text(name)
        }
    }
}
```

## Usage

```swift
// Label with an SF Symbol icon on a colored circle
SWLabelWithIcon(
    icon: "gearshape",
    bg: .orange,
    name: "Settings"
)

// Label with a custom image resource
SWLabelWithImage(
    image: .appIcon,
    name: "My App"
)
```
