---
id: component-stepper
title: Compact Stepper
description: Compact numeric stepper with chevron buttons, animated numeric text transitions, and haptic feedback
tier: free
tags: [component, input, stepper, quantity, numeric, SwiftUI]
---

## Overview

Compact numeric stepper with chevron-style increment/decrement buttons, animated numeric text transitions, and haptic feedback on value change. The decrement button is disabled when the value reaches 0.

## Source Code

```swift
import SwiftUI

struct SWStepper: View {
    @Binding var quantity: Int

    var body: some View {
        HStack {
            Button {
                quantity -= 1
            } label: {
                Image(systemName: "chevron.backward")
                    .imageScale(.large)
            }
            .disabled(quantity <= 0)
            .buttonStyle(.plain)

            Text("\(quantity)")
                .frame(minWidth: 26)
                .contentTransition(.numericText())

            Button {
                quantity += 1
            } label: {
                Image(systemName: "chevron.forward")
                    .imageScale(.large)
            }
            .buttonStyle(.plain)
        }
        .animation(.default, value: quantity)
        .sensoryFeedback(.increase, trigger: [quantity])
    }
}
```

## Usage

```swift
@State private var quantity = 1

// Standalone stepper
SWStepper(quantity: $quantity)

// Real-world usage with a label
HStack {
    Text("Quantity")
    Spacer()
    SWStepper(quantity: $quantity)
}
.padding(.horizontal)
```
