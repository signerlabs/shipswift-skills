---
id: chat
title: AI Chat Interface with Voice Input
description: Complete chat module with message list, streaming-ready input bar, voice-to-text via VolcEngine ASR, and AI conversation UI patterns (iOS only)
tier: free
tags: [chat, AI, voice input, ASR, streaming, conversation, SwiftUI]
---

## What This Solves

Provides a production-ready AI chat interface with an auto-scrolling message list (no CPU spikes during streaming), a text input bar with optional voice-to-text via VolcEngine ASR, and composable bubble styling — ready to connect to any AI backend.

> **Permission timing strategy**: the ASR module uses the **use-site request** pattern — microphone authorization is requested when `startRecording()` is called. For an overview of all three permission patterns (use-site / onboarding prefetch / deferred), see [Permission Prefetch Pattern](../component/onboarding-view.md#permission-prefetch-pattern).

## Architecture

```
iOS App
  SWChatView (all-in-one chat component)
    |
    |--- SWMessageList (auto-scrolling message list)
    |       |--- SWMessageBubble (alignment wrapper)
    |       |--- ScrollViewReader + throttleScroll (anchors scroll to bottom)
    |
    |--- SWChatInputView (text + voice input bar)
    |       |--- TextField (expandable, 1-5 lines)
    |       |--- Microphone button (hidden when asrConfig is nil)
    |       |--- SWAudioWaveformView (animated bars during recording)
    |       |--- Send button
    |       |
    |       |--- SWVolcEngineASRService (speech-to-text)
    |               |--- AVAudioEngine (microphone capture)
    |               |--- NWConnection (WebSocket to VolcEngine)
    |               |--- Binary protocol (gzip compressed)
    |               |--- Callbacks: onTranscriptionUpdate / onTranscriptionComplete / onError
    |
    |--- SWChatMessage (Identifiable message model)
    |
    v
  Your AI Backend (OpenAI, Claude, custom, etc.)
```

**Data flow:**
1. User types or speaks a message
2. `SWChatView` appends the user message to the binding automatically
3. `onSend` callback fires with the text — you forward it to your AI backend
4. You append the AI response to the same messages array
5. The auto-scrolling list keeps the newest message visible with no layout issues

## Dependencies

### System Frameworks
- `SwiftUI` — UI components
- `AVFoundation` — Microphone access and audio engine (voice input only)
- `Network` — NWConnection for WebSocket (voice input only)
- `Compression` — Gzip for VolcEngine binary protocol (voice input only)

### Third-Party
- None. The entire module uses only Apple system frameworks.

### Minimum Deployment Target
- iOS 17.0 (uses `@Observable`, `onChange(of:)` new signature)

## Implementation

### File 1: SWChatView+iOS.swift

The all-in-one chat component. Combines `SWMessageList`, `SWMessageBubble`, and `SWChatInputView` into a single view. Manages input state internally and appends user messages automatically.

```swift
//
//  SWChatView.swift
//  ShipSwift
//
//  All-in-one chat view that combines SWMessageList, SWMessageBubble,
//  and SWChatInputView into a single, ready-to-use component.
//  Manages input state internally and appends user messages automatically.
//
//  Usage:
//    // 1. Minimal setup — just provide messages and an onSend callback
//    @State private var messages: [SWChatMessage] = []
//
//    SWChatView(messages: $messages) { text in
//        // Called after the user message is already appended.
//        // Use this to send the text to your AI backend and append the response.
//        Task {
//            let reply = await myAI.send(text)
//            messages.append(SWChatMessage(content: reply, isUser: false))
//        }
//    }
//
//    // 2. Enable voice input by providing an ASR config
//    let asrConfig = SWASRConfig(appId: "YourAppID", accessToken: "YourToken")
//
//    SWChatView(messages: $messages, asrConfig: asrConfig) { text in
//        // ...
//    }
//
//    // 3. Disable input while waiting for AI response
//    @State private var isWaiting = false
//
//    SWChatView(
//        messages: $messages,
//        asrConfig: asrConfig,
//        isDisabled: isWaiting,
//        placeholderText: "Ask anything..."
//    ) { text in
//        isWaiting = true
//        Task {
//            let reply = await myAI.send(text)
//            messages.append(SWChatMessage(content: reply, isUser: false))
//            isWaiting = false
//        }
//    }
//
//    // 4. Custom bubble styling via the optional bubbleContent parameter
//    SWChatView(
//        messages: $messages,
//        asrConfig: asrConfig,
//        onSend: { _ in }
//    ) { message in
//        // Return any View to replace the default bubble
//        Text(message.content)
//            .padding(12)
//            .background(.green)
//            .clipShape(Capsule())
//    }
//

import SwiftUI

// MARK: - Chat Message Model

/// A single chat message.
///
/// Conforms to `Identifiable` so it works with `ForEach` / `SWMessageList`.
/// Create user messages with `isUser: true` and AI/system messages with `isUser: false`.
public struct SWChatMessage: Identifiable {
    public let id: UUID
    public let content: String
    public let isUser: Bool
    public let timestamp: Date

    public init(
        id: UUID = UUID(),
        content: String,
        isUser: Bool,
        timestamp: Date = Date()
    ) {
        self.id = id
        self.content = content
        self.isUser = isUser
        self.timestamp = timestamp
    }
}

// MARK: - Chat View

/// All-in-one chat view.
///
/// Integrates `SWMessageList`, `SWMessageBubble`, and `SWChatInputView`
/// into a single component. The view:
/// - Maintains input text state internally
/// - Appends user messages to the binding automatically on send
/// - Displays messages using `SWMessageList` with throttled auto-scroll
/// - Provides default bubble styling (accent for user, gray for AI)
/// - Optionally supports ASR voice input when `asrConfig` is provided
///
/// Minimal usage (text only, no voice):
/// ```swift
/// @State private var messages: [SWChatMessage] = []
///
/// SWChatView(messages: $messages) { text in
///     // Handle AI response
/// }
/// ```
///
/// With voice input:
/// ```swift
/// SWChatView(
///     messages: $messages,
///     asrConfig: SWASRConfig(appId: "id", accessToken: "token")
/// ) { text in
///     // Handle AI response
/// }
/// ```
public struct SWChatView<BubbleContent: View>: View {
    @Binding public var messages: [SWChatMessage]
    public let asrConfig: SWASRConfig?
    public let isDisabled: Bool
    public let placeholderText: LocalizedStringKey
    public let onSend: (String) -> Void
    public let bubbleContent: ((SWChatMessage) -> BubbleContent)?

    @State private var inputText = ""

    /// Initialize with default bubble styling.
    /// - Parameters:
    ///   - messages: Binding to the message array (chronological order, oldest first)
    ///   - asrConfig: ASR configuration for voice input. Pass nil to hide the microphone button.
    ///   - isDisabled: Disable input (e.g. while waiting for AI response)
    ///   - placeholderText: Placeholder text for the input field
    ///   - onSend: Callback fired after the user message is appended.
    ///             Receives the sent text so you can forward it to your backend.
    public init(
        messages: Binding<[SWChatMessage]>,
        asrConfig: SWASRConfig? = nil,
        isDisabled: Bool = false,
        placeholderText: LocalizedStringKey = "Type a message...",
        onSend: @escaping (String) -> Void
    ) where BubbleContent == EmptyView {
        self._messages = messages
        self.asrConfig = asrConfig
        self.isDisabled = isDisabled
        self.placeholderText = placeholderText
        self.onSend = onSend
        self.bubbleContent = nil
    }

    /// Initialize with custom bubble content.
    /// - Parameters:
    ///   - messages: Binding to the message array (chronological order, oldest first)
    ///   - asrConfig: ASR configuration for voice input. Pass nil to hide the microphone button.
    ///   - isDisabled: Disable input (e.g. while waiting for AI response)
    ///   - placeholderText: Placeholder text for the input field
    ///   - onSend: Callback fired after the user message is appended
    ///   - bubbleContent: Custom view builder for each message bubble
    public init(
        messages: Binding<[SWChatMessage]>,
        asrConfig: SWASRConfig? = nil,
        isDisabled: Bool = false,
        placeholderText: LocalizedStringKey = "Type a message...",
        onSend: @escaping (String) -> Void,
        @ViewBuilder bubbleContent: @escaping (SWChatMessage) -> BubbleContent
    ) {
        self._messages = messages
        self.asrConfig = asrConfig
        self.isDisabled = isDisabled
        self.placeholderText = placeholderText
        self.onSend = onSend
        self.bubbleContent = bubbleContent
    }

    public var body: some View {
        VStack(spacing: 0) {
            // Message list
            SWMessageList(messages: messages) { message in
                SWMessageBubble(isFromUser: message.isUser) {
                    if let bubbleContent {
                        bubbleContent(message)
                    } else {
                        defaultBubble(for: message)
                    }
                }
            }

            // Input bar
            SWChatInputView(
                text: $inputText,
                asrConfig: asrConfig,
                isDisabled: isDisabled,
                placeHolderText: placeholderText
            ) {
                send()
            }
        }
    }

    // MARK: - Default Bubble

    /// Default bubble styling: accent background for user, gray for AI.
    @ViewBuilder
    private func defaultBubble(for message: SWChatMessage) -> some View {
        Text(message.content)
            .padding(12)
            .background(message.isUser ? Color.accentColor : Color(UIColor.systemGray6))
            .foregroundStyle(message.isUser ? .white : .primary)
            .clipShape(RoundedRectangle(cornerRadius: 16))
    }

    // MARK: - Send Action

    private func send() {
        let text = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }

        // Append user message
        let userMessage = SWChatMessage(content: text, isUser: true)
        messages.append(userMessage)

        // Clear input
        inputText = ""

        // Notify caller
        onSend(text)
    }
}

// MARK: - Previews

#Preview("Chat View") {
    SWChatPreview()
}

private struct SWChatPreview: View {
    @State private var messages: [SWChatMessage] = [
        SWChatMessage(content: "Hello!", isUser: true),
        SWChatMessage(content: "Hi there! How can I help you today?", isUser: false),
        SWChatMessage(content: "Show me how SWChatView works.", isUser: true),
        SWChatMessage(
            content: "SWChatView combines SWMessageList, SWMessageBubble, and SWChatInputView into one component. Just provide a messages binding, ASR config, and an onSend callback.",
            isUser: false
        ),
    ]

    var body: some View {
        SWChatView(messages: $messages) { text in
            // Simulate AI response
            Task {
                try? await Task.sleep(for: .seconds(1))
                messages.append(
                    SWChatMessage(
                        content: "This is a demo response. Connect ShipSwift MCP to enable full AI chat functionality.",
                        isUser: false
                    )
                )
            }
        }
    }
}
```

### File 2: SWChatInputView+iOS.swift

Chat text input bar with optional voice recognition (ASR). Provides a text field, optional microphone button for speech-to-text, audio waveform animation during recording, and a send button. When `asrConfig` is nil the microphone button is hidden and the view works as a pure text input bar.

```swift
//
//  SWChatInputView.swift
//  ShipSwift
//
//  Chat text input bar with optional voice recognition (ASR).
//  Provides a text field, optional microphone button for speech-to-text,
//  audio waveform animation during recording, and a send button.
//
//  When asrConfig is nil the microphone button is hidden and the view
//  works as a pure text input bar.
//
//  Usage:
//    // 1. Text-only input (no voice)
//    @State private var text = ""
//
//    SWChatInputView(text: $text) {
//        sendMessage(text)
//        text = ""
//    }
//
//    // 2. With voice input — provide an ASR config
//    let asrConfig = SWASRConfig(
//        appId: "YourVolcEngineAppID",
//        accessToken: "YourAccessToken"
//    )
//
//    SWChatInputView(text: $text, asrConfig: asrConfig) {
//        sendMessage(text)
//        text = ""
//    }
//
//    // 3. Full chat interface with SWMessageList
//    VStack(spacing: 0) {
//        SWMessageList(messages: messages) { message in
//            SWMessageBubble(isFromUser: message.isUser) {
//                Text(message.content)
//            }
//        }
//        SWChatInputView(text: $text, asrConfig: asrConfig) {
//            sendMessage(text)
//            text = ""
//        }
//    }
//
//    // 4. Customization options
//    SWChatInputView(
//        text: $text,
//        asrConfig: asrConfig,
//        isDisabled: isLoading,                    // disable during AI response
//        placeHolderText: "Ask anything...",        // custom placeholder
//        minLines: 2                                // minimum text field height
//    ) {
//        onSend()
//    }
//
//    // 5. Voice flow: tap mic -> recording + waveform -> tap stop ->
//    //    transcribing -> text appears in field -> tap send
//

import SwiftUI

// MARK: - Chat Input View

/// Chat input view with optional voice recognition.
///
/// Features:
/// - Text input field
/// - Microphone button for speech-to-text (hidden when `asrConfig` is nil)
/// - Audio waveform animation while recording
/// - Loading state during transcription
/// - Send button
///
/// Text-only usage (no voice):
/// ```swift
/// SWChatInputView(text: $text) {
///     sendMessage()
/// }
/// ```
///
/// With voice input:
/// ```swift
/// SWChatInputView(text: $text, asrConfig: asrConfig) {
///     sendMessage()
/// }
/// ```
public struct SWChatInputView: View {
    @Binding public var text: String
    public var onSend: () -> Void
    public var isDisabled: Bool
    public var placeHolderText: LocalizedStringKey
    public var minLines: Int
    public let asrConfig: SWASRConfig?

    @FocusState private var isFocused: Bool
    @State private var asrState: SWASRState = .idle
    @State private var asrService: SWVolcEngineASRService?

    public init(
        text: Binding<String>,
        asrConfig: SWASRConfig? = nil,
        isDisabled: Bool = false,
        placeHolderText: LocalizedStringKey = "Type a message...",
        minLines: Int = 1,
        onSend: @escaping () -> Void
    ) {
        self._text = text
        self.asrConfig = asrConfig
        self.isDisabled = isDisabled
        self.placeHolderText = placeHolderText
        self.minLines = minLines
        self.onSend = onSend
    }

    /// Whether the input field has valid text
    private var hasText: Bool {
        !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    /// Whether ASR is active (recording or transcribing)
    private var isASRActive: Bool {
        asrState == .recording || asrState == .transcribing
    }

    public var body: some View {
        VStack(spacing: 8) {
            // Input area
            inputArea

            // Voice / send buttons
            HStack(spacing: 16) {
                Spacer()

                // Microphone / stop button
                microphoneButton

                // Send button
                sendButton
            }
            .padding(.bottom, -2)
            .padding(.trailing, -2)
        }
        .padding(10)
        .contentShape(Rectangle()) // Make the entire area tappable
        .onTapGesture {
            if !isDisabled && asrState == .idle {
                isFocused = true
            }
        }
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .stroke(.accent, lineWidth: 1)
        )
        .padding(.horizontal)
        .padding(.vertical, 8)
    }

    // MARK: - Input Area

    @ViewBuilder
    private var inputArea: some View {
        switch asrState {
        case .idle:
            // Normal text input
            TextField(placeHolderText, text: $text, axis: .vertical)
                .lineLimit(minLines...5)
                .focused($isFocused)
                .disabled(isDisabled)
                .onChange(of: isDisabled) { oldValue, newValue in
                    // When recovering from disabled state, keep the input unfocused to avoid keyboard auto-popup
                    if oldValue && !newValue {
                        isFocused = false
                    }
                }

        case .recording:
            // Show waveform while recording
            SWAudioWaveformView()

        case .transcribing:
            // Show loading during transcription
            HStack {
                ProgressView()
                    .scaleEffect(0.8)
                Text("Transcribing...")
                    .foregroundStyle(.secondary)
                    .font(.subheadline)
                Spacer()
            }
            .frame(minHeight: 24)
        }
    }

    // MARK: - Microphone Button

    @ViewBuilder
    private var microphoneButton: some View {
        if asrConfig != nil {
            switch asrState {
            case .idle:
                // Only show microphone when there is no text
                if !hasText {
                    Button {
                        startRecording()
                    } label: {
                        Image(systemName: "microphone")
                            .imageScale(.large)
                            .foregroundStyle(.blue, .secondary)
                    }
                }

            case .recording:
                // Show stop button while recording
                Button {
                    stopRecording()
                } label: {
                    Image(systemName: "stop.circle.fill")
                        .font(.system(size: 30))
                        .foregroundColor(.red)
                }

            case .transcribing:
                // Show grayed-out microphone during transcription
                Image(systemName: "microphone")
                    .imageScale(.large)
                    .foregroundStyle(.gray)
            }
        }
    }

    // MARK: - Send Button

    @ViewBuilder
    private var sendButton: some View {
        Button {
            guard hasText else { return }
            // Dismiss focus first to avoid keyboard popup
            isFocused = false
            onSend()
        } label: {
            Image(systemName: "arrow.up.circle.fill")
                .font(.system(size: 30))
                .foregroundColor(hasText && !isDisabled && !isASRActive ? .blue : .gray)
        }
        .disabled(!hasText || isDisabled || isASRActive)
    }

    // MARK: - ASR Actions

    private func startRecording() {
        guard let asrConfig else { return }

        text = "" // Clear previous text
        asrState = .recording

        let service = SWVolcEngineASRService(config: asrConfig)
        asrService = service

        // Set callbacks
        service.onTranscriptionUpdate = { transcribedText in
            self.text = transcribedText
        }

        service.onTranscriptionComplete = { finalText in
            self.text = finalText
            self.asrState = .idle
        }

        service.onError = { error in
            swDebugLog("[SWChatInput] ASR error: \(error.localizedDescription)")
            self.asrState = .idle
        }

        // Start recording
        Task {
            do {
                try await service.startRecording()
            } catch {
                swDebugLog("[SWChatInput] Failed to start recording: \(error.localizedDescription)")
                asrState = .idle
            }
        }
    }

    private func stopRecording() {
        asrState = .transcribing

        Task {
            await asrService?.stopRecording()
        }
    }
}

// MARK: - ASR State

/// ASR recording state
fileprivate enum SWASRState: Equatable {
    case idle           // Idle state
    case recording      // Recording
    case transcribing   // Transcribing
}

// MARK: - Audio Waveform View

/// Audio waveform animation view - automatically fills the entire width
fileprivate struct SWAudioWaveformView: View {
    var barWidth: CGFloat = 3
    var spacing: CGFloat = 4
    var minHeight: CGFloat = 4
    var maxHeight: CGFloat = 24
    var color: Color = .accentColor

    @State private var phases: [Double] = []
    @State private var timer: Timer?

    var body: some View {
        GeometryReader { geometry in
            let barCount = Int(geometry.size.width / (barWidth + spacing))
            HStack(spacing: spacing) {
                ForEach(0..<barCount, id: \.self) { index in
                    Capsule()
                        .fill(color)
                        .frame(width: barWidth, height: barHeight(for: index, total: barCount))
                }
            }
            .frame(maxWidth: .infinity)
            .onAppear {
                phases = (0..<barCount).map { Double($0) }
                startAnimation(barCount: barCount)
            }
            .onDisappear {
                timer?.invalidate()
                timer = nil
            }
        }
        .frame(height: maxHeight)
    }

    private func barHeight(for index: Int, total: Int) -> CGFloat {
        guard phases.indices.contains(index) else { return minHeight }
        let phase = phases[index]
        let normalizedHeight = (sin(phase) + 1) / 2 // 0 to 1
        return minHeight + (maxHeight - minHeight) * normalizedHeight
    }

    private func startAnimation(barCount: Int) {
        timer = Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { _ in
            withAnimation(.linear(duration: 0.05)) {
                for i in 0..<barCount {
                    if phases.indices.contains(i) {
                        // Each bar has a different phase offset to create a wave effect
                        phases[i] += 0.15 + Double(i % 3) * 0.05
                    }
                }
            }
        }
    }
}

// MARK: - Previews

#Preview("Text Only (No ASR)") {
    SWChatInputView(
        text: .constant("")
    ) {}
}

#Preview("With ASR - Empty") {
    SWChatInputView(
        text: .constant(""),
        asrConfig: SWASRConfig(appId: "test", accessToken: "test")
    ) {}
}

#Preview("With ASR - With Text") {
    SWChatInputView(
        text: .constant("Hello"),
        asrConfig: SWASRConfig(appId: "test", accessToken: "test")
    ) {}
}

#Preview("Interactive") {
    SWChatInputPreview()
}

private struct SWChatInputPreview: View {
    @State private var text = ""

    var body: some View {
        VStack {
            Spacer()
            SWChatInputView(text: $text) {
                swDebugLog("Send: \(text)")
                text = ""
            }
        }
    }
}
```

### File 3: SWMessageList+iOS.swift

Scrollable chat message list with bubble styling. Uses `List` + `ScrollViewReader` with throttled auto-scroll to keep the latest message visible. Avoids `ScrollView` + `LazyVStack` which causes 100% CPU from infinite layout loops during streaming updates.

Advantages over the old flip technique:
- Text is selectable (no coordinate system inversion)
- Smooth, throttled scrolling during streaming (no jank)
- Standard coordinate system — no mental overhead for consumers

```swift
//
//  SWMessageList+iOS.swift
//  ShipSwift
//
//  Scrollable chat message list with bubble styling.
//  Uses List + ScrollViewReader with throttled auto-scroll to keep
//  the latest message visible. Avoids ScrollView + LazyVStack which
//  causes 100% CPU from infinite layout loops during streaming updates.
//
//  Advantages over the old flip technique:
//  - Text is selectable (no coordinate system inversion)
//  - Smooth, throttled scrolling during streaming (no jank)
//  - Standard coordinate system — no mental overhead for consumers
//
//  Usage:
//    // 1. Basic message list (messages in chronological order, oldest first)
//    SWMessageList(messages: messages) { message in
//        SWMessageBubble(isFromUser: message.isUser) {
//            Text(message.content)
//                .padding(12)
//                .background(message.isUser ? Color.accentColor : Color(.systemGray6))
//                .foregroundStyle(message.isUser ? .white : .primary)
//                .clipShape(RoundedRectangle(cornerRadius: 16))
//        }
//    }
//
//    // 2. Message model must conform to Identifiable
//    struct ChatMessage: Identifiable {
//        let id = UUID()
//        let content: String
//        let isUser: Bool
//    }
//
//    // 3. SWMessageBubble aligns user messages to trailing, others to leading
//    SWMessageBubble(isFromUser: true) {
//        Text("Hello!")  // right-aligned bubble
//    }
//    SWMessageBubble(isFromUser: false) {
//        Text("Hi!")     // left-aligned bubble
//    }
//

import SwiftUI

private let swMessageBubbleBackground = Color(UIColor.systemGray6)

// MARK: - Message List View

/// Scrollable chat message list with automatic bottom-anchoring.
///
/// ## Best Practices
///
/// ### 1. Use List instead of ScrollView + LazyVStack
/// LazyVStack causes infinite layout calculation loops during frequent updates, CPU 100%.
///
/// ### 2. Throttled auto-scroll keeps the latest message visible
/// When `messages.count` changes, the list scrolls to the bottom anchor.
/// Scrolling is throttled (max once per 400ms) with a 450ms trailing
/// guarantee, preventing jank during fast streaming updates.
///
/// ## Bad Example (causes CPU 100%)
/// ```swift
/// ScrollView {
///     LazyVStack {
///         ForEach(messages) { message in
///             MessageBubble(message: message)
///         }
///     }
/// }
/// ```
///
/// ## Correct Example
/// ```swift
/// SWMessageList(messages: messages) { message in
///     MessageBubble(message: message)
/// }
/// ```
public struct SWMessageList<Message: Identifiable, Content: View>: View {
    let messages: [Message]
    let content: (Message) -> Content

    // Throttle state for auto-scroll
    @State private var lastScrollTime: Date = .distantPast
    @State private var trailingScrollTask: Task<Void, Never>?

    /// Initialize the message list
    /// - Parameters:
    ///   - messages: Array of messages (in chronological order, oldest first, newest last)
    ///   - content: Message view builder
    public init(
        messages: [Message],
        @ViewBuilder content: @escaping (Message) -> Content
    ) {
        self.messages = messages
        self.content = content
    }

    public var body: some View {
        ScrollViewReader { proxy in
            List {
                ForEach(messages) { message in
                    content(message)
                        .id(message.id)
                        .listRowSeparator(.hidden)
                        .listRowBackground(Color.clear)
                        .selectionDisabled()
                        #if os(iOS)
                        .listRowInsets(EdgeInsets(top: 4, leading: 12, bottom: 4, trailing: 12))
                        #else
                        .listRowInsets(EdgeInsets(top: 4, leading: 160, bottom: 4, trailing: 160))
                        #endif
                }

                // Bottom anchor — invisible spacer for scroll targeting
                Color.clear
                    .frame(height: 1)
                    .listRowSeparator(.hidden)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
                    .id("sw-chat-bottom")
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            #if os(iOS)
            .scrollDismissesKeyboard(.immediately)
            #endif
            .onChange(of: messages.count) {
                throttleScroll(proxy: proxy)
            }
        }
    }

    /// Throttled scroll to bottom anchor.
    ///
    /// - Fires immediately if >= 400ms since last scroll (leading edge).
    /// - Always schedules a 450ms trailing task to guarantee the final
    ///   position is correct after a burst of rapid updates.
    private func throttleScroll(proxy: ScrollViewProxy) {
        let now = Date()
        if now.timeIntervalSince(lastScrollTime) >= 0.4 {
            lastScrollTime = now
            proxy.scrollTo("sw-chat-bottom", anchor: .bottom)
        }

        // Cancel any pending trailing scroll and schedule a new one
        trailingScrollTask?.cancel()
        trailingScrollTask = Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(450))
            guard !Task.isCancelled else { return }
            lastScrollTime = .now
            proxy.scrollTo("sw-chat-bottom", anchor: .bottom)
        }
    }
}

// MARK: - Message Bubble Base

/// Message bubble base view
///
/// Best practices:
/// - Use `.frame(maxWidth: .infinity)` to fix width, avoiding layout calculation loops
/// - Use `.fixedSize(horizontal: false, vertical: true)` to let content adapt vertically
public struct SWMessageBubble<Content: View>: View {
    let isFromUser: Bool
    let content: Content

    public init(isFromUser: Bool, @ViewBuilder content: () -> Content) {
        self.isFromUser = isFromUser
        self.content = content()
    }

    public var body: some View {
        HStack {
            if isFromUser {
                Spacer(minLength: 60)
            }

            content
                .fixedSize(horizontal: false, vertical: true)

            if !isFromUser {
                Spacer(minLength: 60)
            }
        }
        .frame(maxWidth: .infinity, alignment: isFromUser ? .trailing : .leading)
    }
}

// MARK: - Preview

private struct PreviewMessage: Identifiable {
    let id = UUID()
    let content: String
    let isUser: Bool
}

#Preview("Message List") {
    SWMessageList(messages: [
        PreviewMessage(content: "Hello!", isUser: true),
        PreviewMessage(content: "Hi there! How can I help you today?", isUser: false),
        PreviewMessage(content: "I have a question about SwiftUI performance.", isUser: true),
        PreviewMessage(content: "Sure, I'd be happy to help! What would you like to know about SwiftUI performance optimization?", isUser: false),
        PreviewMessage(content: "Why does my chat view freeze with 100% CPU?", isUser: true),
        PreviewMessage(content: "That's likely caused by using ScrollView + LazyVStack. When messages update frequently during streaming, LazyVStack can enter an infinite layout calculation loop. The solution is to use List instead, which has more stable layout behavior.", isUser: false),
    ]) { message in
        SWMessageBubble(isFromUser: message.isUser) {
            Text(message.content)
                .padding(12)
                .background(message.isUser ? Color.accentColor : Color(UIColor.systemGray6))
                .foregroundStyle(message.isUser ? .white : .primary)
                .clipShape(RoundedRectangle(cornerRadius: 16))
        }
    }
}
```

### File 4: SWVolcEngineASRService.swift

VolcEngine automatic speech recognition service client. Streams audio over WebSocket to ByteDance's VolcEngine ASR API, providing real-time and final transcription callbacks.

```swift
//
//  SWVolcEngineASRService.swift
//  ShipSwift
//
//  VolcEngine automatic speech recognition service client.
//  Streams audio over WebSocket to ByteDance's VolcEngine ASR API,
//  providing real-time and final transcription callbacks.
//
//  Usage:
//    // 1. Create config with VolcEngine credentials
//    let config = SWASRConfig(
//        appId: "your-app-id",
//        accessToken: "your-access-token",
//        cluster: "volcengine_streaming_common",  // default
//        language: "zh-CN"                         // default, or "en-US"
//    )
//
//    // 2. Create service and set callbacks
//    let asr = SWVolcEngineASRService(config: config)
//
//    asr.onTranscriptionUpdate = { text in
//        print("Real-time: \(text)")  // partial results while speaking
//    }
//    asr.onTranscriptionComplete = { text in
//        print("Final: \(text)")      // final result after stop
//    }
//    asr.onError = { error in
//        print("Error: \(error.localizedDescription)")
//    }
//
//    // 3. Start/stop recording
//    try await asr.startRecording()   // requests mic permission, connects WebSocket
//    // ... user speaks ...
//    await asr.stopRecording()        // sends end-of-audio, triggers completion
//
//    // 4. Cancel recording (discards results)
//    asr.cancelRecording()
//
//    // 5. Observable state properties
//    asr.isRecording      // Bool
//    asr.transcribedText  // current transcription text
//    asr.error            // last error, if any
//

import AVFoundation
import Compression
import Foundation
import Network

// MARK: - Configuration

/// VolcEngine ASR configuration
public struct SWASRConfig {
    public let appId: String
    public let accessToken: String
    public let cluster: String
    public let language: String

    public init(
        appId: String,
        accessToken: String,
        cluster: String = "volcengine_streaming_common",
        language: String = "zh-CN"
    ) {
        self.appId = appId
        self.accessToken = accessToken
        self.cluster = cluster
        self.language = language
    }
}

// MARK: - ASR Service

/// VolcEngine streaming speech recognition service
///
/// Usage:
/// ```swift
/// let config = SWASRConfig(appId: "xxx", accessToken: "xxx")
/// let asr = SWVolcEngineASRService(config: config)
///
/// asr.onTranscriptionUpdate = { text in print("Realtime: \(text)") }
/// asr.onTranscriptionComplete = { text in print("Complete: \(text)") }
///
/// try await asr.startRecording()
/// // ... user speaks ...
/// await asr.stopRecording()
/// ```
@Observable
public final class SWVolcEngineASRService: @unchecked Sendable {

    // MARK: - Configuration

    private let host = "openspeech.bytedance.com"
    private let port: UInt16 = 443
    private let path = "/api/v2/asr"
    private let config: SWASRConfig

    // MARK: - State

    public private(set) var isRecording = false
    public private(set) var transcribedText = ""
    public private(set) var error: Error?

    // MARK: - Callbacks

    /// Realtime transcription update callback
    public var onTranscriptionUpdate: ((String) -> Void)?
    /// Transcription complete callback
    public var onTranscriptionComplete: ((String) -> Void)?
    /// Error callback
    public var onError: ((Error) -> Void)?

    // MARK: - Private Properties

    private var connection: NWConnection?
    private var audioEngine: AVAudioEngine?
    private var isConnected = false
    private var connectionContinuation: CheckedContinuation<Void, Error>?
    private var receiveBuffer = Data()
    private let queue = DispatchQueue(label: "com.shipswift.asr.websocket")
    private var audioConverter: AVAudioConverter?
    private let targetFormat = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16000, channels: 1, interleaved: true)!

    // MARK: - Initialization

    public init(config: SWASRConfig) {
        self.config = config
    }

    // MARK: - Public Methods

    /// Start recording and perform speech recognition
    public func startRecording() async throws {
        guard !isRecording else { return }

        let granted = await requestMicrophonePermission()
        guard granted else {
            throw SWASRError.microphonePermissionDenied
        }

        transcribedText = ""
        error = nil

        try await connectWebSocket()
        try sendFullClientRequest()
        try startAudioEngine()

        isRecording = true
    }

    /// Stop recording
    public func stopRecording() async {
        guard isRecording else { return }

        isRecording = false
        stopAudioEngine()
        sendEndOfAudio()
    }

    /// Cancel recording
    public func cancelRecording() {
        isRecording = false
        stopAudioEngine()
        disconnectWebSocket()
        transcribedText = ""
    }

    // MARK: - Microphone Permission

    private func requestMicrophonePermission() async -> Bool {
        await withCheckedContinuation { continuation in
            AVAudioApplication.requestRecordPermission { granted in
                continuation.resume(returning: granted)
            }
        }
    }

    // MARK: - WebSocket Connection

    private func connectWebSocket() async throws {
        let tlsOptions = NWProtocolTLS.Options()
        let tcpOptions = NWProtocolTCP.Options()
        let params = NWParameters(tls: tlsOptions, tcp: tcpOptions)

        connection = NWConnection(host: NWEndpoint.Host(host), port: NWEndpoint.Port(rawValue: port)!, using: params)

        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            connectionContinuation = continuation

            connection?.stateUpdateHandler = { [weak self] state in
                guard let self else { return }
                Task { @MainActor in
                    switch state {
                    case .ready:
                        self.performWebSocketHandshake()
                    case .failed(let error):
                        self.connectionContinuation?.resume(throwing: error)
                        self.connectionContinuation = nil
                    default:
                        break
                    }
                }
            }

            connection?.start(queue: queue)
        }
    }

    private func performWebSocketHandshake() {
        var keyBytes = [UInt8](repeating: 0, count: 16)
        _ = SecRandomCopyBytes(kSecRandomDefault, 16, &keyBytes)
        let wsKey = Data(keyBytes).base64EncodedString()

        let request = """
        GET \(path) HTTP/1.1\r
        Host: \(host)\r
        Upgrade: websocket\r
        Connection: Upgrade\r
        Sec-WebSocket-Key: \(wsKey)\r
        Sec-WebSocket-Version: 13\r
        Authorization: Bearer;\(config.accessToken)\r
        \r

        """

        connection?.send(content: request.data(using: .utf8), completion: .contentProcessed { [weak self] error in
            if let error = error {
                self?.connectionContinuation?.resume(throwing: error)
                self?.connectionContinuation = nil
            } else {
                self?.receiveHandshakeResponse()
            }
        })
    }

    private func receiveHandshakeResponse() {
        connection?.receive(minimumIncompleteLength: 1, maximumLength: 4096) { [weak self] content, _, _, error in
            guard let self else { return }

            if let error = error {
                self.connectionContinuation?.resume(throwing: error)
                self.connectionContinuation = nil
                return
            }

            if let data = content, let response = String(data: data, encoding: .utf8) {
                if response.contains("101") && response.lowercased().contains("upgrade") {
                    self.isConnected = true
                    self.connectionContinuation?.resume()
                    self.connectionContinuation = nil
                    self.startReceivingFrames()
                } else {
                    self.connectionContinuation?.resume(throwing: SWASRError.connectionFailed)
                    self.connectionContinuation = nil
                }
            }
        }
    }

    private func startReceivingFrames() {
        guard isConnected else { return }

        connection?.receive(minimumIncompleteLength: 2, maximumLength: 65536) { [weak self] content, _, isComplete, error in
            guard let self else { return }

            if error != nil {
                DispatchQueue.main.async {
                    if !self.transcribedText.isEmpty {
                        self.onTranscriptionComplete?(self.transcribedText)
                    }
                }
                return
            }

            if let data = content {
                self.receiveBuffer.append(data)
                self.processWebSocketFrames()
            }

            if isComplete {
                self.isConnected = false
                DispatchQueue.main.async {
                    if !self.transcribedText.isEmpty {
                        self.onTranscriptionComplete?(self.transcribedText)
                    }
                }
            } else {
                self.startReceivingFrames()
            }
        }
    }

    private func processWebSocketFrames() {
        let bufferCopy = Array(receiveBuffer)
        guard bufferCopy.count >= 2 else { return }

        var offset = 0
        while bufferCopy.count - offset >= 2 {
            let firstByte = bufferCopy[offset]
            let secondByte = bufferCopy[offset + 1]

            let isMasked = (secondByte & 0x80) != 0
            var payloadLength = UInt64(secondByte & 0x7F)
            var headerSize = 2

            if payloadLength == 126 {
                guard bufferCopy.count - offset >= 4 else { break }
                payloadLength = UInt64(bufferCopy[offset + 2]) << 8 | UInt64(bufferCopy[offset + 3])
                headerSize = 4
            } else if payloadLength == 127 {
                guard bufferCopy.count - offset >= 10 else { break }
                payloadLength = 0
                for i in 0..<8 {
                    payloadLength = payloadLength << 8 | UInt64(bufferCopy[offset + 2 + i])
                }
                headerSize = 10
            }

            if isMasked { headerSize += 4 }

            let totalLength = headerSize + Int(payloadLength)
            guard bufferCopy.count - offset >= totalLength else { break }

            var payload = Data(bufferCopy[(offset + headerSize)..<(offset + totalLength)])

            if isMasked {
                let maskStart = offset + headerSize - 4
                let maskKey = Array(bufferCopy[maskStart..<(maskStart + 4)])
                for i in 0..<payload.count {
                    payload[i] ^= maskKey[i % 4]
                }
            }

            offset += totalLength

            let opcode = firstByte & 0x0F
            switch opcode {
            case 0x01, 0x02:
                handleServerResponse(payload)
            case 0x08:
                isConnected = false
                DispatchQueue.main.async {
                    if !self.transcribedText.isEmpty {
                        self.onTranscriptionComplete?(self.transcribedText)
                    }
                }
            case 0x09:
                sendPong(payload)
            default:
                break
            }
        }

        if offset > 0 {
            receiveBuffer.removeFirst(offset)
        }
    }

    private func sendPong(_ data: Data) {
        sendWebSocketFrame(opcode: 0x0A, payload: data)
    }

    private func disconnectWebSocket() {
        if isConnected {
            sendWebSocketFrame(opcode: 0x08, payload: Data())
        }
        connection?.cancel()
        connection = nil
        isConnected = false
        receiveBuffer.removeAll()
    }

    private func sendWebSocketFrame(opcode: UInt8, payload: Data) {
        var frame = Data()
        frame.append(0x80 | opcode)

        let length = payload.count
        if length < 126 {
            frame.append(UInt8(0x80 | length))
        } else if length < 65536 {
            frame.append(0xFE)
            frame.append(UInt8((length >> 8) & 0xFF))
            frame.append(UInt8(length & 0xFF))
        } else {
            frame.append(0xFF)
            for i in (0..<8).reversed() {
                frame.append(UInt8((length >> (i * 8)) & 0xFF))
            }
        }

        var maskKey = [UInt8](repeating: 0, count: 4)
        _ = SecRandomCopyBytes(kSecRandomDefault, 4, &maskKey)
        frame.append(contentsOf: maskKey)

        var maskedPayload = payload
        for i in 0..<maskedPayload.count {
            maskedPayload[i] ^= maskKey[i % 4]
        }
        frame.append(maskedPayload)

        connection?.send(content: frame, completion: .contentProcessed { _ in })
    }

    // MARK: - Binary Protocol

    private func sendFullClientRequest() throws {
        let payload: [String: Any] = [
            "app": [
                "appid": config.appId,
                "token": config.accessToken,
                "cluster": config.cluster
            ],
            "user": ["uid": UUID().uuidString],
            "audio": [
                "format": "pcm",
                "rate": 16000,
                "bits": 16,
                "channel": 1,
                "language": config.language
            ],
            "request": [
                "reqid": UUID().uuidString,
                "workflow": "audio_in,resample,partition,vad,fe,decode,itn,nlu_punctuate",
                "result_type": "full",
                "show_utterances": true
            ]
        ]

        let message = try buildFullClientRequest(payload: payload)
        sendWebSocketMessage(message)
    }

    private func sendAudioData(_ audioData: Data) {
        guard isConnected else { return }
        let message = buildAudioOnlyRequest(audioData: audioData)
        sendWebSocketMessage(message)
    }

    private func sendEndOfAudio() {
        let message = buildAudioOnlyRequest(audioData: Data(), isLast: true)
        sendWebSocketMessage(message)
    }

    private func sendWebSocketMessage(_ data: Data) {
        sendWebSocketFrame(opcode: 0x02, payload: data)
    }

    private func buildFullClientRequest(payload: [String: Any]) throws -> Data {
        let jsonData = try JSONSerialization.data(withJSONObject: payload)
        let compressedPayload = try gzipCompress(jsonData)

        var header = Data()
        header.append(0x11)
        header.append(0x10)
        header.append(0x11)
        header.append(0x00)

        var payloadSize = UInt32(compressedPayload.count).bigEndian
        header.append(Data(bytes: &payloadSize, count: 4))

        return header + compressedPayload
    }

    private func buildAudioOnlyRequest(audioData: Data, isLast: Bool = false) -> Data {
        var header = Data()
        header.append(0x11)
        header.append(isLast ? 0x22 : 0x20)
        header.append(0x00)
        header.append(0x00)

        var payloadSize = UInt32(audioData.count).bigEndian
        header.append(Data(bytes: &payloadSize, count: 4))

        return header + audioData
    }

    private func handleServerResponse(_ data: Data) {
        guard data.count >= 4 else { return }

        let messageType = (data[1] >> 4) & 0x0F
        let compression = data[2] & 0x0F

        if messageType == 0x0B { return }

        if messageType == 0x0F {
            guard data.count >= 8 else { return }
            let payloadSize = data.subdata(in: 4..<8).withUnsafeBytes { $0.load(as: UInt32.self).bigEndian }
            let actualSize = min(Int(payloadSize), data.count - 8)
            guard actualSize > 0 else { return }

            let payloadData = data.subdata(in: 8..<(8 + actualSize))
            var jsonData = payloadData
            if compression == 0x01 {
                jsonData = (try? gzipDecompress(payloadData)) ?? payloadData
            }

            if let json = try? JSONSerialization.jsonObject(with: jsonData) as? [String: Any],
               let message = json["message"] as? String {
                DispatchQueue.main.async {
                    self.onError?(SWASRError.serverError(message))
                }
            }
            return
        }

        guard data.count >= 8 else { return }
        let payloadSize = Int(data.subdata(in: 4..<8).withUnsafeBytes { $0.load(as: UInt32.self).bigEndian })
        let actualPayloadSize = min(payloadSize, data.count - 8)
        guard actualPayloadSize > 0 else { return }

        let payloadData = data.subdata(in: 8..<(8 + actualPayloadSize))
        var jsonData = payloadData

        if compression == 0x01 {
            guard let decompressed = try? gzipDecompress(payloadData) else { return }
            jsonData = decompressed
        }

        if let response = try? JSONSerialization.jsonObject(with: jsonData) as? [String: Any] {
            handleASRResponse(response)
        }
    }

    private func handleASRResponse(_ response: [String: Any]) {
        if let code = response["code"] as? Int, code != 1000 {
            let message = response["message"] as? String ?? "Unknown error"
            DispatchQueue.main.async {
                self.onError?(SWASRError.serverError(message))
            }
            return
        }

        var text: String?
        var isEnd = false

        if let resultArray = response["result"] as? [[String: Any]], let firstResult = resultArray.first {
            text = firstResult["text"] as? String

            if let utterances = firstResult["utterances"] as? [[String: Any]], !utterances.isEmpty {
                if let lastUtterance = utterances.last {
                    text = lastUtterance["text"] as? String
                    isEnd = (lastUtterance["definite"] as? Int ?? 0) == 1
                }
            }
        }

        if text == nil, let directText = response["text"] as? String {
            text = directText
            isEnd = response["is_end"] as? Bool ?? false
        }

        if let text = text, !text.isEmpty {
            DispatchQueue.main.async {
                self.transcribedText = text
                self.onTranscriptionUpdate?(text)
            }
        }

        if isEnd {
            DispatchQueue.main.async {
                self.onTranscriptionComplete?(self.transcribedText)
            }
        }
    }

    // MARK: - Audio Engine

    private func startAudioEngine() throws {
        #if os(iOS)
        let audioSession = AVAudioSession.sharedInstance()
        try audioSession.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .allowBluetoothA2DP])
        try audioSession.setActive(true)
        #endif

        let audioEngine = AVAudioEngine()
        let inputNode = audioEngine.inputNode
        let inputFormat = inputNode.outputFormat(forBus: 0)

        guard let converter = AVAudioConverter(from: inputFormat, to: targetFormat) else {
            throw SWASRError.audioConverterFailed
        }
        audioConverter = converter

        inputNode.installTap(onBus: 0, bufferSize: 4096, format: inputFormat) { [weak self] buffer, _ in
            guard let self, self.isRecording else { return }
            if let data = self.convertBuffer(buffer) {
                self.sendAudioData(data)
            }
        }

        try audioEngine.start()
        self.audioEngine = audioEngine
    }

    private func stopAudioEngine() {
        audioEngine?.inputNode.removeTap(onBus: 0)
        audioEngine?.stop()
        audioEngine = nil
        audioConverter = nil
    }

    private func convertBuffer(_ buffer: AVAudioPCMBuffer) -> Data? {
        guard let converter = audioConverter else { return nil }

        let ratio = targetFormat.sampleRate / buffer.format.sampleRate
        let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio)

        guard let output = AVAudioPCMBuffer(pcmFormat: targetFormat, frameCapacity: capacity) else { return nil }

        var error: NSError?
        var hasData = false

        converter.convert(to: output, error: &error) { _, outStatus in
            if hasData {
                outStatus.pointee = .noDataNow
                return nil
            }
            hasData = true
            outStatus.pointee = .haveData
            return buffer
        }

        if error != nil { return nil }

        let audioBuffer = output.audioBufferList.pointee.mBuffers
        guard let mData = audioBuffer.mData, audioBuffer.mDataByteSize > 0 else { return nil }
        return Data(bytes: mData, count: Int(audioBuffer.mDataByteSize))
    }

    // MARK: - Compression

    private func gzipCompress(_ data: Data) throws -> Data {
        let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: data.count)
        defer { buffer.deallocate() }

        let size = data.withUnsafeBytes { src -> Int in
            compression_encode_buffer(buffer, data.count, src.bindMemory(to: UInt8.self).baseAddress!, data.count, nil, COMPRESSION_ZLIB)
        }

        guard size > 0 else { throw SWASRError.compressionFailed }

        var result = Data([0x1F, 0x8B, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x03])
        result.append(Data(bytes: buffer, count: size))

        var crc = crc32(data).littleEndian
        result.append(Data(bytes: &crc, count: 4))
        var len = UInt32(data.count).littleEndian
        result.append(Data(bytes: &len, count: 4))

        return result
    }

    private func gzipDecompress(_ data: Data) throws -> Data {
        guard data.count > 18 else { throw SWASRError.decompressionFailed }

        var offset = 10
        if data[3] & 0x04 != 0 { offset += 2 + Int(data[10]) + Int(data[11]) << 8 }
        if data[3] & 0x08 != 0 { while offset < data.count && data[offset] != 0 { offset += 1 }; offset += 1 }
        if data[3] & 0x10 != 0 { while offset < data.count && data[offset] != 0 { offset += 1 }; offset += 1 }
        if data[3] & 0x02 != 0 { offset += 2 }

        let compressed = data.subdata(in: offset..<(data.count - 8))
        let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: compressed.count * 10)
        defer { buffer.deallocate() }

        let size = compressed.withUnsafeBytes { src -> Int in
            compression_decode_buffer(buffer, compressed.count * 10, src.bindMemory(to: UInt8.self).baseAddress!, compressed.count, nil, COMPRESSION_ZLIB)
        }

        guard size > 0 else { throw SWASRError.decompressionFailed }
        return Data(bytes: buffer, count: size)
    }

    private func crc32(_ data: Data) -> UInt32 {
        var crc: UInt32 = 0xFFFFFFFF
        for byte in data {
            crc ^= UInt32(byte)
            for _ in 0..<8 { crc = crc & 1 != 0 ? (crc >> 1) ^ 0xEDB88320 : crc >> 1 }
        }
        return ~crc
    }
}

// MARK: - Error Types

public enum SWASRError: LocalizedError {
    case microphonePermissionDenied
    case connectionFailed
    case audioConverterFailed
    case compressionFailed
    case decompressionFailed
    case serverError(String)

    public var errorDescription: String? {
        switch self {
        case .microphonePermissionDenied: return "Microphone permission denied"
        case .connectionFailed: return "Connection failed"
        case .audioConverterFailed: return "Failed to create audio converter"
        case .compressionFailed: return "Data compression failed"
        case .decompressionFailed: return "Data decompression failed"
        case .serverError(let msg): return "Server error: \(msg)"
        }
    }
}
```

## Integration Checklist

- [ ] **Add microphone permission** to `Info.plist`:
  ```xml
  <key>NSMicrophoneUsageDescription</key>
  <string>Microphone access is needed for voice input</string>
  ```
  Required only if you use the voice input feature (`asrConfig` is non-nil).

- [ ] **Obtain VolcEngine ASR credentials** (voice input only):
  1. Sign up at [VolcEngine Console](https://console.volcengine.com/)
  2. Enable the Streaming ASR service
  3. Create an application to get `appId` and `accessToken`
  4. Choose the correct `cluster` for your region (default: `volcengine_streaming_common`)

- [ ] **Add all 4 files** to your Xcode project:
  - `SWChatView+iOS.swift`
  - `SWChatInputView+iOS.swift`
  - `SWMessageList+iOS.swift`
  - `SWVolcEngineASRService.swift`

- [ ] **Add the `swDebugLog` utility** (used by `SWChatInputView` for debug logging):
  ```swift
  func swDebugLog(_ message: String) {
      #if DEBUG
      print(message)
      #endif
  }
  ```

- [ ] **Connect to your AI backend** in the `onSend` callback:
  ```swift
  SWChatView(messages: $messages) { text in
      Task {
          let response = await yourAIService.chat(text)
          messages.append(SWChatMessage(content: response, isUser: false))
      }
  }
  ```

- [ ] **Set deployment target** to iOS 17.0 or later (required for `@Observable`).

## Common Customizations

### Use without voice input (text-only chat)

Simply omit the `asrConfig` parameter. The microphone button will be hidden automatically:

```swift
SWChatView(messages: $messages) { text in
    // Handle send
}
```

### Switch ASR provider

Replace `SWVolcEngineASRService` with your preferred provider. The `SWChatInputView` communicates with ASR via three callbacks:

```swift
// In SWChatInputView, replace the ASR service creation:
let service = YourCustomASRService(config: yourConfig)
asrService = service

service.onTranscriptionUpdate = { text in /* partial result */ }
service.onTranscriptionComplete = { text in /* final result */ }
service.onError = { error in /* handle error */ }

try await service.startRecording()
await service.stopRecording()
```

To use Apple's built-in Speech framework instead:

```swift
import Speech

// Create a wrapper that conforms to the same callback pattern
class AppleSpeechASR {
    var onTranscriptionUpdate: ((String) -> Void)?
    var onTranscriptionComplete: ((String) -> Void)?
    var onError: ((Error) -> Void)?

    private let recognizer = SFSpeechRecognizer()
    private var recognitionTask: SFSpeechRecognitionTask?
    private let audioEngine = AVAudioEngine()

    func startRecording() async throws {
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true

        recognitionTask = recognizer?.recognitionTask(with: request) { result, error in
            if let result {
                let text = result.bestTranscription.formattedString
                if result.isFinal {
                    self.onTranscriptionComplete?(text)
                } else {
                    self.onTranscriptionUpdate?(text)
                }
            }
            if let error {
                self.onError?(error)
            }
        }

        let inputNode = audioEngine.inputNode
        let format = inputNode.outputFormat(forBus: 0)
        inputNode.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
            request.append(buffer)
        }

        audioEngine.prepare()
        try audioEngine.start()
    }

    func stopRecording() {
        audioEngine.stop()
        audioEngine.inputNode.removeTap(onBus: 0)
        recognitionTask?.finish()
    }
}
```

### Custom message bubble styling

Use the `bubbleContent` parameter to replace the default bubble:

```swift
SWChatView(
    messages: $messages,
    onSend: { text in /* ... */ }
) { message in
    // Markdown-rendered bubble
    VStack(alignment: .leading, spacing: 4) {
        Text(message.content)
            .padding(12)
        Text(message.timestamp, style: .time)
            .font(.caption2)
            .foregroundStyle(.secondary)
            .padding(.horizontal, 12)
            .padding(.bottom, 8)
    }
    .background(message.isUser ? Color.blue : Color(.systemGray6))
    .clipShape(RoundedRectangle(cornerRadius: 16))
}
```

### Disable input during AI response

```swift
@State private var isWaiting = false

SWChatView(
    messages: $messages,
    isDisabled: isWaiting,
    placeholderText: "Ask anything..."
) { text in
    isWaiting = true
    Task {
        let reply = await aiService.send(text)
        messages.append(SWChatMessage(content: reply, isUser: false))
        isWaiting = false
    }
}
```

### Support streaming AI responses

For token-by-token streaming, update the last message's content as tokens arrive:

```swift
SWChatView(messages: $messages) { text in
    Task {
        // Add a placeholder AI message
        let placeholderId = UUID()
        messages.append(SWChatMessage(id: placeholderId, content: "", isUser: false))

        // Stream tokens
        for await token in aiService.streamChat(text) {
            if let index = messages.firstIndex(where: { $0.id == placeholderId }) {
                let current = messages[index]
                messages[index] = SWChatMessage(
                    id: placeholderId,
                    content: current.content + token,
                    isUser: false,
                    timestamp: current.timestamp
                )
            }
        }
    }
}
```

> **Note:** `SWChatMessage` uses `let` properties for immutability. To support streaming updates, replace the entire message in the array as shown above. `SWMessageList` uses throttled auto-scroll to handle frequent updates without CPU spikes (unlike `ScrollView` + `LazyVStack`).

### Change ASR language

```swift
let asrConfig = SWASRConfig(
    appId: "your-app-id",
    accessToken: "your-token",
    cluster: "volcengine_streaming_common",
    language: "en-US"  // or "zh-CN", "ja-JP", etc.
)
```

### Adjust input field height

```swift
SWChatInputView(
    text: $text,
    minLines: 3  // Minimum 3 lines tall (default is 1)
) {
    onSend()
}
```

## Known Pitfalls

### 1. Microphone permission must be requested at runtime

iOS requires runtime permission for microphone access. `SWVolcEngineASRService.startRecording()` handles this automatically, but if the user denies permission, it throws `SWASRError.microphonePermissionDenied`. Always handle this error gracefully (e.g., show an alert directing the user to Settings).

### 2. Do NOT use ScrollView + LazyVStack for chat

`ScrollView` + `LazyVStack` causes 100% CPU usage during streaming updates due to infinite layout calculation loops. `SWMessageList` uses `List` with `ScrollViewReader` and throttled auto-scroll instead, providing smooth bottom-anchoring without coordinate system inversion. See the doc comments in `SWMessageList+iOS.swift` for details.

### 3. Audio session configuration on iOS

The ASR service sets the audio session to `.playAndRecord` with `.defaultToSpeaker` and `.allowBluetoothA2DP`. If your app uses other audio (e.g., media playback), you may need to restore the audio session category after recording stops:

```swift
// After stopRecording()
try AVAudioSession.sharedInstance().setCategory(.playback)
```

### 4. VolcEngine WebSocket uses a custom binary protocol

The VolcEngine ASR API does not use standard WebSocket text frames. It uses a custom binary protocol with gzip compression. The `SWVolcEngineASRService` handles all binary encoding/decoding internally. If you need to debug, look at the `buildFullClientRequest` and `handleServerResponse` methods.

### 5. Throttled scroll timing

The auto-scroll uses a 400ms leading throttle with a 450ms trailing guarantee. During very fast streaming (many tokens per second), the scroll fires at most once per 400ms to prevent jank, then a final trailing scroll ensures the list ends at the correct position. These values work well for typical AI streaming speeds — adjust only if you have unusual update patterns.

### 6. SWChatMessage is immutable by design

`SWChatMessage` uses `let` properties for thread safety. For streaming responses, replace the entire message object in the array rather than mutating properties. See the "Support streaming AI responses" section above.

### 7. Keyboard dismissal behavior

`SWMessageList` uses `.scrollDismissesKeyboard(.immediately)` to dismiss the keyboard when scrolling. The send button also dismisses focus before calling `onSend()` to prevent the keyboard from popping back up after sending.

### 8. ASR service lifecycle

Each recording session creates a new `SWVolcEngineASRService` instance and a new WebSocket connection. The service is not designed to be reused across multiple recording sessions. This is by design -- each session needs a fresh connection with a unique request ID.
