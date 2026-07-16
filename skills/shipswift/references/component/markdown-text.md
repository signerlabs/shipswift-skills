---
id: component-markdown-text
title: Markdown Text
description: Lightweight Markdown renderer for LLM output — supports headings, fenced code blocks, lists, dividers, and inline formatting (bold, italic, inline code)
tier: free
tags: [component, display, markdown, text, code-block, SwiftUI]
---

## Overview

A self-contained Markdown rendering view designed for common LLM output formats. Parses raw Markdown strings into native SwiftUI views — no WebView or third-party dependencies required. Works on both iOS and macOS.

Supported syntax:
- **Headings** — `#` through `####` (h1–h4)
- **Fenced code blocks** — triple backticks with optional language label
- **Unordered lists** — `-`, `*`, or `+` prefix
- **Ordered lists** — `1.`, `2.`, etc.
- **Horizontal dividers** — `---`, `***`, or `___`
- **Inline formatting** — `**bold**`, `*italic*`, `` `inline code` ``

## Source Code

```swift
import SwiftUI

// MARK: - SWMarkdownText

public struct SWMarkdownText: View {
    public let text: String
    public var codeBackground: Color
    public var codeBorderColor: Color
    public var codeCornerRadius: CGFloat
    public var blockSpacing: CGFloat

    public init(
        _ text: String,
        codeBackground: Color = .gray.opacity(0.12),
        codeBorderColor: Color = .secondary,
        codeCornerRadius: CGFloat = 8,
        blockSpacing: CGFloat = 6
    ) {
        self.text = text
        self.codeBackground = codeBackground
        self.codeBorderColor = codeBorderColor
        self.codeCornerRadius = codeCornerRadius
        self.blockSpacing = blockSpacing
    }

    public var body: some View {
        if text.isEmpty {
            EmptyView()
        } else {
            VStack(alignment: .leading, spacing: blockSpacing) {
                ForEach(Array(parseBlocks().enumerated()), id: \.offset) { _, block in
                    blockView(for: block)
                }
            }
        }
    }

    // MARK: - Block Rendering

    @ViewBuilder
    private func blockView(for block: SWMarkdownBlock) -> some View {
        switch block {
        case .heading(let level, let content):
            headingView(level: level, content: content)

        case .codeBlock(let language, let code):
            codeBlockView(language: language, code: code)

        case .divider:
            Divider()
                .padding(.vertical, 4)

        case .listItem(let content):
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text("\u{2022}")
                    .foregroundStyle(.secondary)
                inlineMarkdownText(content)
            }
            .padding(.leading, 12)

        case .paragraph(let content):
            inlineMarkdownText(content)
        }
    }

    // MARK: - Heading

    private func headingView(level: Int, content: String) -> some View {
        let font: Font = switch level {
        case 1: .title.bold()
        case 2: .title2.bold()
        case 3: .title3.bold()
        default: .headline.bold()
        }
        return inlineMarkdownText(content)
            .font(font)
            .padding(.top, level <= 2 ? 6 : 2)
    }

    // MARK: - Fenced Code Block

    private func codeBlockView(language: String, code: String) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            // Language label
            if !language.isEmpty {
                Text(language)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 10)
                    .padding(.top, 6)
                    .padding(.bottom, 2)
            }
            // Code content
            ScrollView(.horizontal, showsIndicators: false) {
                Text(code)
                    .font(.system(.body, design: .monospaced))
                    .textSelection(.enabled)
                    .padding(10)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(codeBackground.opacity(0.6))
        .clipShape(RoundedRectangle(cornerRadius: codeCornerRadius))
        .overlay(
            RoundedRectangle(cornerRadius: codeCornerRadius)
                .strokeBorder(codeBorderColor.opacity(0.5), lineWidth: 0.5)
        )
    }

    // MARK: - Inline Markdown (bold, italic, inline code)

    private func inlineMarkdownText(_ text: String) -> Text {
        if let attributed = try? AttributedString(
            markdown: text,
            options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        ) {
            return Text(attributed)
        }
        return Text(text)
    }

    // MARK: - Block Parser

    private func parseBlocks() -> [SWMarkdownBlock] {
        var blocks: [SWMarkdownBlock] = []
        let lines = text.components(separatedBy: "\n")
        var i = 0

        while i < lines.count {
            let line = lines[i]
            let trimmed = line.trimmingCharacters(in: .whitespaces)

            // Fenced code block: starts with ```
            if trimmed.hasPrefix("```") {
                let language = String(trimmed.dropFirst(3)).trimmingCharacters(in: .whitespaces)
                var codeLines: [String] = []
                i += 1
                while i < lines.count {
                    let codeLine = lines[i]
                    if codeLine.trimmingCharacters(in: .whitespaces).hasPrefix("```") {
                        i += 1
                        break
                    }
                    codeLines.append(codeLine)
                    i += 1
                }
                blocks.append(.codeBlock(language: language, code: codeLines.joined(separator: "\n")))
                continue
            }

            // Horizontal divider: ---, ***, ___ (at least 3 identical characters)
            if isDivider(trimmed) {
                blocks.append(.divider)
                i += 1
                continue
            }

            // Heading: # through ####
            if let (level, content) = parseHeading(trimmed) {
                blocks.append(.heading(level: level, content: content))
                i += 1
                continue
            }

            // Unordered list item: -, *, or + followed by a space
            if let content = parseUnorderedListItem(trimmed) {
                blocks.append(.listItem(content: content))
                i += 1
                continue
            }

            // Ordered list item: 1. 2. etc.
            if let content = parseOrderedListItem(trimmed) {
                blocks.append(.listItem(content: content))
                i += 1
                continue
            }

            // Empty line — skip
            if trimmed.isEmpty {
                i += 1
                continue
            }

            // Paragraph: merge consecutive non-empty lines
            var paragraphLines: [String] = [line]
            i += 1
            while i < lines.count {
                let nextLine = lines[i]
                let nextTrimmed = nextLine.trimmingCharacters(in: .whitespaces)
                if nextTrimmed.isEmpty ||
                    parseHeading(nextTrimmed) != nil ||
                    nextTrimmed.hasPrefix("```") ||
                    parseUnorderedListItem(nextTrimmed) != nil ||
                    parseOrderedListItem(nextTrimmed) != nil ||
                    isDivider(nextTrimmed) {
                    break
                }
                paragraphLines.append(nextLine)
                i += 1
            }
            blocks.append(.paragraph(content: paragraphLines.joined(separator: "\n")))
        }

        return blocks
    }

    // MARK: - Parsing Helpers

    private func parseHeading(_ line: String) -> (Int, String)? {
        var level = 0
        var idx = line.startIndex
        while idx < line.endIndex && line[idx] == "#" && level < 4 {
            level += 1
            idx = line.index(after: idx)
        }
        guard level > 0, idx < line.endIndex, line[idx] == " " else { return nil }
        let content = String(line[line.index(after: idx)...]).trimmingCharacters(in: .whitespaces)
        guard !content.isEmpty else { return nil }
        return (level, content)
    }

    private func parseUnorderedListItem(_ line: String) -> String? {
        guard let first = line.first, "-*+".contains(first),
              line.count >= 2,
              line[line.index(after: line.startIndex)] == " " else { return nil }
        let content = String(line.dropFirst(2)).trimmingCharacters(in: .whitespaces)
        return content.isEmpty ? nil : content
    }

    private func parseOrderedListItem(_ line: String) -> String? {
        guard let dotIndex = line.firstIndex(of: ".") else { return nil }
        let prefix = line[line.startIndex..<dotIndex]
        guard !prefix.isEmpty, prefix.allSatisfy(\.isNumber) else { return nil }
        let afterDot = line.index(after: dotIndex)
        guard afterDot < line.endIndex, line[afterDot] == " " else { return nil }
        let content = String(line[line.index(after: afterDot)...]).trimmingCharacters(in: .whitespaces)
        return content.isEmpty ? nil : content
    }

    private func isDivider(_ line: String) -> Bool {
        guard line.count >= 3 else { return false }
        return line.allSatisfy({ $0 == "-" }) ||
               line.allSatisfy({ $0 == "*" }) ||
               line.allSatisfy({ $0 == "_" })
    }
}

// MARK: - Block Type (internal)

private enum SWMarkdownBlock {
    case heading(level: Int, content: String)
    case codeBlock(language: String, code: String)
    case divider
    case listItem(content: String)
    case paragraph(content: String)
}
```

## Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `text` | `String` | (required) | Raw Markdown string to render |
| `codeBackground` | `Color` | `.gray.opacity(0.12)` | Background color for fenced code blocks |
| `codeBorderColor` | `Color` | `.secondary` | Border color for fenced code blocks |
| `codeCornerRadius` | `CGFloat` | `8` | Corner radius for code blocks |
| `blockSpacing` | `CGFloat` | `6` | Vertical spacing between blocks |

## Usage

```swift
// Basic usage — pass any Markdown string
SWMarkdownText("# Hello\n\nThis is **bold** and *italic* text.")

// Display LLM streaming output
SWMarkdownText(viewModel.streamingResponse)

// Code block with language label
SWMarkdownText("""
```swift
func greet() {
    print("Hello, world!")
}
\```
""")

// Custom styling for code blocks
SWMarkdownText(
    markdownString,
    codeBackground: .black.opacity(0.8),
    codeBorderColor: .green,
    codeCornerRadius: 12,
    blockSpacing: 10
)

// Inside a ScrollView for long content
ScrollView {
    SWMarkdownText(longMarkdownString)
        .padding()
}
```

## Integration Checklist

- [ ] Add `SWMarkdownText.swift` to your project (single file, no dependencies)
- [ ] Verify deployment target is iOS 17+ / macOS 14+ (uses `AttributedString` with `inlineOnlyPreservingWhitespace`)
- [ ] For LLM chat UIs, wrap in `ScrollView` and feed the streaming response string directly
- [ ] Customize `codeBackground` and `codeBorderColor` to match your app's theme
