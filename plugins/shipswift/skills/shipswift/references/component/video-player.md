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

- First-frame thumbnail auto-generated via `AVAssetImageGenerator`
- Fullscreen uses native `AVKit.VideoPlayer` (controls, AirPlay, PiP)
- Playback position preserved across open/close cycles
- Silent-switch-proof audio via `AVAudioSession(.playback)`
- `onEnterFullscreen` / `onExitFullscreen` callbacks for the host app to manage orientation locking (no UIKit AppDelegate dependency inside the component)

## Source Code

```swift
import SwiftUI
import AVKit

public struct SWVideoPlayer: View {

    public let videoURL: URL
    public var cornerRadius: CGFloat
    public var onEnterFullscreen: (() -> Void)?
    public var onExitFullscreen: (() -> Void)?

    @State private var player: AVPlayer
    @State private var showFullscreen = false

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
        self._player = State(initialValue: AVPlayer(url: url))
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
        self._player = State(initialValue: AVPlayer(url: url))
    }

    public var body: some View {
        ZStack {
            // AVPlayerLayer paused at time 0 shows the first frame as the poster
            InlineVideoLayerView(player: player)

            Color.black.opacity(0.25)

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
        .onTapGesture { showFullscreen = true }
        .fullScreenCover(isPresented: $showFullscreen) {
            SWVideoFullscreenPlayer(
                player: player,
                isPresented: $showFullscreen,
                onEnter: onEnterFullscreen,
                onExit: onExitFullscreen
            )
        }
    }
}

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
        uiView.playerLayer.player = player
    }

    final class PlayerUIView: UIView {
        override class var layerClass: AnyClass { AVPlayerLayer.self }
        var playerLayer: AVPlayerLayer { layer as! AVPlayerLayer }
    }
}

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

- **iOS only**: uses `UIImage` + `AVAudioSession`; file should be named `SWVideoPlayer+iOS.swift` in cross-platform codebases
- **Thumbnail loading is async**: user sees dark placeholder for ~50-100ms until `AVAssetImageGenerator` returns
- **Black frame at t=0**: many videos have a black frame at exactly 0s. Thumbnail samples at 0.5s to avoid this
- **Audio session is process-global**: calling `.playback` category here affects the whole app's audio behavior
