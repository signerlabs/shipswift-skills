---
id: component-add-sheet
title: Add Sheet
description: Bottom sheet with text input field, Cancel and Continue buttons, presented as a medium detent sheet
tier: free
tags: [component, input, sheet, textfield, form, SwiftUI]
---

## Overview

Bottom sheet with a text input field, Cancel and Continue buttons. Presented as a `.medium` detent sheet for collecting user input (e.g. purpose, wish, notes).

> **Requires:** `SWButtonStyle` (`.swPrimary` / `.swSecondary`) from ShipSwift's `SWUtil` — included below under [SWButtonStyle (from SWUtil)](#swbuttonstyle-from-swutil).

## Source Code

```swift
import SwiftUI

struct SWAddSheet: View {
    @Binding var isPresented: Bool
    @State private var inputText = ""

    var title: LocalizedStringKey = "Your Generation Purpose"
    var placeHolderText: LocalizedStringKey = "Enter your purpose/wish/favorite things for this generation (optional)..."
    var minLines: Int = 5
    var onConfirm: ((String) -> Void)?

    var body: some View {
        VStack {
            Text(title)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding()
                .padding(.horizontal)

            InputField(
                text: $inputText,
                placeHolderText: placeHolderText,
                minLines: minLines
            )

            Spacer()
            Spacer()

            HStack {
                Button {
                    isPresented = false
                } label: {
                    Text("Cancel")
                }
                .buttonStyle(.swSecondary)

                Button {
                    onConfirm?(inputText)
                    isPresented = false
                } label: {
                    Text("Continue")
                }
                .buttonStyle(.swPrimary)
                .disabled(inputText.isEmpty)
            }
            .padding()
        }
        .presentationDetents([.medium])
        .presentationDragIndicator(.visible)
    }

    // MARK: - InputField (private)

    private struct InputField: View {
        @Binding var text: String
        var placeHolderText: LocalizedStringKey = "Enter message..."
        var minLines: Int = 1

        @FocusState private var isFocused: Bool

        var body: some View {
            TextField(placeHolderText, text: $text, axis: .vertical)
                .lineLimit(minLines...max(minLines, 5))
                .focused($isFocused)
                .padding()
                .overlay(
                    RoundedRectangle(cornerRadius: 16)
                        .stroke(.primary, lineWidth: 1)
                )
                .padding(.horizontal)
                .padding(.vertical, 8)
        }
    }
}
```

### SWButtonStyle (from SWUtil)

The buttons use ShipSwift's `.swPrimary` / `.swSecondary` styles, defined in `SWUtil/SWViewExtension.swift` and reproduced here. Skip this block if your project already has ShipSwift's `SWUtil`. `.accent` is the color Xcode generates from the `AccentColor` color set in your asset catalog (the default app template includes one).

```swift
import SwiftUI

// MARK: - Button Style

struct SWButtonStyle: ButtonStyle {
    enum Variant {
        case primary
        case secondary
    }

    @Environment(\.isEnabled) private var isEnabled

    let variant: Variant
    var showBorder: Bool = false
    var cornerRadius: CGFloat = 16

    private var backgroundColor: Color {
        switch variant {
        case .primary: .accent
        case .secondary: .accent.opacity(0.1)
        }
    }

    private var foregroundColor: Color {
        switch variant {
        case .primary: .white
        case .secondary: .primary.opacity(0.8)
        }
    }

    private var borderColor: Color {
        switch variant {
        case .primary: .primary
        case .secondary: .secondary.opacity(0.8)
        }
    }

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .frame(maxWidth: .infinity)
            .padding()
            .background(
                RoundedRectangle(cornerRadius: cornerRadius)
                    .fill(backgroundColor)
            )
            .foregroundStyle(foregroundColor)
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius)
                    .strokeBorder(
                        showBorder ? borderColor : .clear,
                        lineWidth: 1.5
                    )
            )
            .contentShape(RoundedRectangle(cornerRadius: cornerRadius))
            .opacity(isEnabled ? (configuration.isPressed ? 0.7 : 1) : 0.5)
    }
}

extension ButtonStyle where Self == SWButtonStyle {
    /// Primary button style (confirm / save, etc.)
    static var swPrimary: SWButtonStyle { .init(variant: .primary) }
    /// Secondary button style (cancel / close, etc.)
    static var swSecondary: SWButtonStyle { .init(variant: .secondary) }

    static func swPrimary(showBorder: Bool = true, cornerRadius: CGFloat = 12) -> SWButtonStyle {
        .init(variant: .primary, showBorder: showBorder, cornerRadius: cornerRadius)
    }

    static func swSecondary(showBorder: Bool = true, cornerRadius: CGFloat = 12) -> SWButtonStyle {
        .init(variant: .secondary, showBorder: showBorder, cornerRadius: cornerRadius)
    }
}
```

## Usage

```swift
@State private var showSheet = false

Button("Add Item") { showSheet = true }
.sheet(isPresented: $showSheet) {
    SWAddSheet(isPresented: $showSheet) { text in
        print("User entered: \(text)")
    }
}

// Custom title and placeholder text
SWAddSheet(
    isPresented: $showSheet,
    title: "Your Wish",
    placeHolderText: "Enter your wish...",
    minLines: 3
) { text in
    handleInput(text)
}
```
