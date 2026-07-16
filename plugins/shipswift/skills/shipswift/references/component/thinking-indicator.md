---
id: component-thinking-indicator
title: Thinking Indicator
description: Animated three-dot bouncing indicator for chat typing/thinking states
tier: free
tags: [component, feedback, thinking, typing, indicator, chat, SwiftUI]
---

## Overview

Animated thinking/typing indicator with three bouncing dots. Commonly used in chat interfaces to show that the AI or remote user is typing.

## Source Code

```swift
import SwiftUI

// MARK: - SWThinkingIndicator

struct SWThinkingIndicator: View {

    // MARK: - Configurable Parameters

    var dotSize: CGFloat = 5
    var dotColor: Color = .secondary
    var spacing: CGFloat = 3

    // MARK: - Body

    var body: some View {
        TimelineView(.periodic(from: .now, by: 0.3)) { timeline in
            let phase = Int(timeline.date.timeIntervalSinceReferenceDate / 0.3) % 3
            HStack(spacing: spacing) {
                ForEach(0..<3) { index in
                    Circle()
                        .fill(dotColor)
                        .frame(width: dotSize, height: dotSize)
                        .offset(y: phase == index ? -(dotSize * 0.6) : 0)
                        .animation(.easeInOut(duration: 0.2), value: phase)
                }
            }
        }
    }
}
```

## Usage

```swift
// Default style
SWThinkingIndicator()

// Custom dot size, color, and spacing
SWThinkingIndicator(dotSize: 8, dotColor: .blue, spacing: 5)

// Show "typing" state in a chat bubble
if isThinking {
    SWThinkingIndicator()
}

// Place in an HStack alongside text
HStack {
    Text("AI is thinking")
    SWThinkingIndicator()
}
```
