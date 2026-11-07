---
id: component-video-player
title: Video Player
description: Showcase video player with first-frame thumbnail, tap-to-fullscreen AVKit playback, and orientation callbacks
tier: free
tags: [component, display, video, player, avkit, SwiftUI, fullscreen]
---

## Overview

Inline video component for showcase sections with a thumbnail poster and a glass play button. Tapping opens a fullscreen `AVKit.VideoPlayer` with native controls; closing it remembers the paused position so the next tap resumes from there.

## Features

- First-frame poster: an `AVPlayerLayer` paused at time 0 (no separate thumbnail generation)
- Fullscreen uses native `AVKit.VideoPlayer` (controls, AirPlay, PiP)
- Playback position preserved across open/close cycles
- Silent-switch-proof audio via `AVAudioSession(.playback)`
- `onEnterFullscreen` / `onExitFullscreen` callbacks for the host app to manage orientation locking (no UIKit AppDelegate dependency inside the component)

## Source Code

```swift
import SwiftUI
import AVKit

public struct SWVideoPlayer: View {

    // MARK: - Configuration

    public let videoURL: URL
    public var cornerRadius: CGFloat

    /// Invoked when the user taps the play button and fullscreen appears.
    public var onEnterFullscreen: (() -> Void)?

    /// Invoked when the fullscreen player is dismissed.
    public var onExitFullscreen: (() -> Void)?

    // MARK: - State

    /// Created on first appearance rather than in `init` (SwiftUI re-runs `init`
    /// on every parent update), and replaced when `videoURL` changes.
    @State private var player: AVPlayer?
    @State private var showFullscreen = false

    // MARK: - Init

    public init(
        resource: String,
        ext: String = "mp4",
        cornerRadius: CGFloat = 20,
        onEnterFullscreen: (() -> Void)? = nil,
        onExitFullscreen: (() -> Void)? = nil
    ) {
        guard let url = Bundle.main.url(forResource: resource, withExtension: ext) else {
            fatalError("SWVideoPlayer: resource \(resource).\(ext) not found in bundle")
        }
        self.videoURL = url
        self.cornerRadius = cornerRadius
        self.onEnterFullscreen = onEnterFullscreen
        self.onExitFullscreen = onExitFullscreen
    }

    public init(
        url: URL,
        cornerRadius: CGFloat = 20,
        onEnterFullscreen: (() -> Void)? = nil,
        onExitFullscreen: (() -> Void)? = nil
    ) {
        self.videoURL = url
        self.cornerRadius = cornerRadius
        self.onEnterFullscreen = onEnterFullscreen
        self.onExitFullscreen = onExitFullscreen
    }

    // MARK: - Body

    public var body: some View {
        ZStack {
            // AVPlayerLayer paused at time 0 displays the first frame as the poster
            if let player {
                InlineVideoLayerView(player: player)
            }

            // Dimming to make the play button stand out
            Color.black.opacity(0.25)

            // Center play button
            Image(systemName: "play.fill")
                .font(.system(size: 28, weight: .bold))
                .foregroundStyle(.white)
                .frame(width: 64, height: 64)
                .background(.ultraThinMaterial, in: Circle())
                .overlay {
                    Circle().strokeBorder(Color.white.opacity(0.25), lineWidth: 1)
                }
        }
        .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                .strokeBorder(Color.white.opacity(0.15), lineWidth: 1)
        }
        .contentShape(Rectangle())
        .onTapGesture {
            showFullscreen = true
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Play video")
        .accessibilityAddTraits(.isButton)
        .accessibilityAction { showFullscreen = true }
        .onAppear {
            if player == nil {
                player = AVPlayer(url: videoURL)
            }
        }
        .onChange(of: videoURL) { _, newURL in
            player = AVPlayer(url: newURL)
        }
        .fullScreenCover(isPresented: $showFullscreen) {
            if let player {
                SWVideoFullscreenPlayer(
                    player: player,
                    isPresented: $showFullscreen,
                    onEnter: onEnterFullscreen,
                    onExit: onExitFullscreen
                )
            }
        }
    }
}

// MARK: - Inline video layer (shows current paused frame as poster)

private struct InlineVideoLayerView: UIViewRepresentable {
    let player: AVPlayer

    func makeUIView(context: Context) -> PlayerUIView {
        let view = PlayerUIView()
        view.playerLayer.player = player
        view.playerLayer.videoGravity = .resizeAspectFill
        player.pause()
        // Seek to 0 forces first-frame decode so the layer shows it as poster
        player.seek(to: .zero, toleranceBefore: .zero, toleranceAfter: .zero)
        return view
    }

    func updateUIView(_ uiView: PlayerUIView, context: Context) {
        // A new player (the video URL changed) needs its own first-frame poster
        guard uiView.playerLayer.player !== player else { return }
        uiView.playerLayer.player = player
        player.pause()
        player.seek(to: .zero, toleranceBefore: .zero, toleranceAfter: .zero)
    }

    final class PlayerUIView: UIView {
        override class var layerClass: AnyClass { AVPlayerLayer.self }
        var playerLayer: AVPlayerLayer { layer as! AVPlayerLayer }
    }
}

// MARK: - Fullscreen player

private struct SWVideoFullscreenPlayer: View {
    let player: AVPlayer
    @Binding var isPresented: Bool
    let onEnter: (() -> Void)?
    let onExit: (() -> Void)?

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Color.black.ignoresSafeArea()

            VideoPlayer(player: player)
                .ignoresSafeArea()

            Button {
                isPresented = false
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 36, height: 36)
                    .background(.ultraThinMaterial, in: Circle())
            }
            .padding(.top, 8)
            .padding(.trailing, 16)
        }
        .preferredColorScheme(.dark)
        .onAppear {
            try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback)
            try? AVAudioSession.sharedInstance().setActive(true)
            onEnter?()
            player.play()
        }
        .onDisappear {
            player.pause()
            onExit?()
        }
    }
}
```

## Usage

```swift
// Basic usage: bundle resource
SWVideoPlayer(resource: "launch_clip")
    .aspectRatio(16 / 9, contentMode: .fit)

// Remote URL
SWVideoPlayer(url: URL(string: "https://example.com/clip.mp4")!)

// With orientation callbacks (host app unlocks landscape for fullscreen)
SWVideoPlayer(
    resource: "launch_clip",
    onEnterFullscreen: { AppDelegate.setOrientation(.allButUpsideDown) },
    onExitFullscreen:  { AppDelegate.setOrientation(.portrait) }
)
```

## Integration Checklist

- Add video file to app bundle (Xcode → drag into project → "Copy items if needed")
- Verify in **Target → Build Phases → Copy Bundle Resources**
- If your app is portrait-locked, implement `setOrientation` via `UIApplicationDelegateAdaptor` + the callbacks
- Add `landscapeLeft` / `landscapeRight` to Target's Supported Interface Orientations to allow fullscreen rotation

## Pitfalls

- **iOS only**: uses `UIViewRepresentable`, `AVAudioSession` and `fullScreenCover`; the file is named `SWVideoPlayer+iOS.swift` so cross-platform targets can exclude it from macOS
- **`init(resource:)` traps on a missing file**: it calls `fatalError` if the resource is not in the main bundle; use `init(url:)` when the file may be absent
- **Poster appears once the first frame decodes**: the player is created on first appearance, so the card shows only the dimmed background for a moment until the frame at time 0 is ready
- **Black frame at t=0**: the poster is the frame at exactly 0s; if your clip opens on black, re-export it with a non-black first frame
- **Audio session is process-global**: calling `.playback` category here affects the whole app's audio behavior
