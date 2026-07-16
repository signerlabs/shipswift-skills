---
id: component-add-sheet
title: Add Sheet
description: Bottom sheet with text input field, Cancel and Continue buttons, presented as a medium detent sheet
tier: free
tags: [component, input, sheet, textfield, form, SwiftUI]
---

## Overview

Bottom sheet with a text input field, Cancel and Continue buttons. Presented as a `.medium` detent sheet for collecting user input (e.g. purpose, wish, notes).

> **Note:** This component uses `.buttonStyle(.borderedProminent)` and `.buttonStyle(.bordered)` as defaults. Replace them with `.buttonStyle(.swPrimary)` and `.buttonStyle(.swSecondary)` if using ShipSwift button styles.

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
                .buttonStyle(.bordered) // Replace with .swSecondary if using ShipSwift button styles

                Button {
                    onConfirm?(inputText)
                    isPresented = false
                } label: {
                    Text("Continue")
                }
                .buttonStyle(.borderedProminent) // Replace with .swPrimary if using ShipSwift button styles
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
                .lineLimit(minLines...5)
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
