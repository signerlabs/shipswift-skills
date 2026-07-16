---
id: camera
title: Camera & Face Detection
description: Complete camera module with photo capture, live preview, face detection using Vision framework, and face landmark overlay (iOS only)
tier: free
tags: [camera, face detection, Vision, AVFoundation, photo capture, SwiftUI]
---

## What This Solves

**Platform: iOS only** — this module uses AVFoundation and Vision framework APIs not available on macOS.

Provides a production-ready camera module for iOS apps with live preview, photo capture, pinch-to-zoom, front/back camera switching, photo library picker, and optional real-time face landmark detection using the Vision framework — all wrapped in SwiftUI views ready to drop into any app.

> **Permission timing strategy**: this recipe uses the **use-site request** pattern — camera authorization is requested when `SWCameraManager` is initialized. For an overview of all three permission patterns (use-site / onboarding prefetch / deferred), see [Permission Prefetch Pattern](../component/onboarding-view.md#permission-prefetch-pattern).

## Architecture

```
iOS App
  SWCameraManager (@Observable, NSObject)
    |
    |--- AVCaptureSession (session lifecycle, photo capture, zoom)
    |       |--- AVCaptureDeviceInput (front/back camera)
    |       |--- AVCapturePhotoOutput (photo capture delegate)
    |       |--- AVCaptureVideoDataOutput (frame-by-frame for Vision)
    |
    |--- Vision Framework (opt-in face tracking)
    |       |--- VNSequenceRequestHandler
    |       |--- VNDetectFaceLandmarksRequest
    |       |--- Normalized landmark coordinates -> SWFaceLandmarkGroup[]
    |
    v
  SWCameraView (photo capture UI)               SWFaceCameraView (face detection UI)
    |--- SWCameraPreview (AVCaptureSession)        |--- SWFaceCameraPreview (AVCaptureSession)
    |--- PhotosPicker (photo library)              |--- SWFaceTrackingOverlay (Canvas rendering)
    |--- Pinch-to-zoom + zoom slider               |--- Landmark toggle button
    |--- Shutter button + camera switch            |--- Shutter button + camera switch
    |--- Close button                              |--- Close button

Data Models
  SWFaceLandmarkRegion (enum) — 11 face region types
  SWFaceLandmarkGroup (struct) — region + normalized points
  SWFaceLandmarkColors (struct) — configurable color schemes
```

## Dependencies

This module uses only Apple system frameworks. No third-party packages required.

| Framework | Purpose |
|-----------|---------|
| `AVFoundation` | Camera session, device input/output, photo capture |
| `Vision` | Face landmark detection (`VNDetectFaceLandmarksRequest`) |
| `SwiftUI` | UI views, Canvas rendering, gestures |
| `PhotosUI` | `PhotosPicker` for selecting images from the photo library |

## Implementation

### File 1: SWFaceLandmark.swift

Face landmark data models for Vision framework regions.

```swift
//
//  SWFaceLandmark.swift
//  ShipSwift
//
//  Face landmark data models for Vision framework regions.
//  Defines the enum of face landmark region types and a group model
//  that holds normalized coordinate points for each detected region.
//
//  Usage:
//    // 1. SWFaceLandmarkRegion enum cases:
//    //    .faceContour, .leftEye, .rightEye,
//    //    .leftEyebrow, .rightEyebrow,
//    //    .nose, .noseCrest,
//    //    .outerLips, .innerLips,
//    //    .leftPupil, .rightPupil
//
//    // 2. SWFaceLandmarkGroup model
//    let group = SWFaceLandmarkGroup(
//        region: .leftEye,
//        points: [CGPoint(x: 0.3, y: 0.4), CGPoint(x: 0.35, y: 0.42), ...]
//    )
//    group.region    // .leftEye
//    group.points    // [CGPoint] in normalized coordinates (0...1)
//    group.isClosed  // true if points.count > 2 (pupils are not closed)
//
//    // 3. Typically consumed from SWCameraManager.faceLandmarks
//    for group in cameraManager.faceLandmarks {
//        switch group.region {
//        case .outerLips: drawLips(group.points)
//        case .leftEye:   drawEye(group.points)
//        default: break
//        }
//    }
//

import Foundation

/// Face landmark region type
enum SWFaceLandmarkRegion: String, Sendable {
    case faceContour
    case leftEye, rightEye
    case leftEyebrow, rightEyebrow
    case nose, noseCrest
    case outerLips, innerLips
    case leftPupil, rightPupil
}

/// Single face landmark group
struct SWFaceLandmarkGroup: Sendable {
    let region: SWFaceLandmarkRegion
    let points: [CGPoint]
    /// Whether the path is closed (single-point regions like pupils are not closed)
    var isClosed: Bool { points.count > 2 }
}
```

### File 2: SWCameraManager.swift

Unified AVCaptureSession manager with photo capture, zoom control, and optional real-time Vision face landmark tracking.

```swift
//
//  SWCameraManager.swift
//  ShipSwift
//
//  Unified AVCaptureSession manager with photo capture, zoom control,
//  and optional real-time Vision face landmark tracking.
//
//  Base camera features: permission handling, session lifecycle,
//  front/back switching, pinch-to-zoom, and photo capture.
//
//  Face tracking features (opt-in via faceTrackingEnabled):
//  real-time Vision face landmark detection with normalized coordinates,
//  suitable for overlay rendering in SWFaceCameraView.
//
//  Usage:
//    // 1. Create manager (automatically checks camera permission)
//    @State private var cameraManager = SWCameraManager()
//
//    // 2. Wire up error callback for UI alerts
//    cameraManager.onError = { message in
//        SWAlertManager.shared.show(.error, message: message)
//    }
//
//    // 3. Start/stop session (call in onAppear/onDisappear)
//    cameraManager.startSession()
//    cameraManager.stopSession()
//
//    // 4. Capture a photo
//    cameraManager.capturePhoto { image in
//        guard let image else { return }
//        // use captured UIImage
//    }
//
//    // 5. Zoom control
//    cameraManager.setZoom(2.0)               // set absolute zoom
//    cameraManager.zoom(by: 1.5)              // multiply current zoom
//    let current = cameraManager.currentZoom  // read current zoom level
//    // zoom range: cameraManager.minZoom ... cameraManager.maxZoom
//
//    // 6. Check authorization
//    if cameraManager.isAuthorized { /* show camera preview */ }
//
//    // 7. Access the AVCaptureSession for preview
//    SWCameraPreview(session: cameraManager.session)
//
//    // 8. Enable face tracking (for SWFaceCameraView)
//    cameraManager.faceTrackingEnabled = true
//    // Access real-time landmarks:
//    for group in cameraManager.faceLandmarks {
//        // group.region: SWFaceLandmarkRegion
//        // group.points: [CGPoint] in normalized coordinates (0...1)
//    }
//
//    // 9. Initialize with specific camera position
//    @State private var cameraManager = SWCameraManager(position: .front)
//

import SwiftUI
import AVFoundation
import Vision

@Observable
final class SWCameraManager: NSObject, @unchecked Sendable {

    // MARK: - Public Properties (Base Camera)

    let session = AVCaptureSession()
    var isAuthorized = false
    var cameraPosition: AVCaptureDevice.Position = .back

    /// Zoom
    var currentZoom: CGFloat = 1.0
    var minZoom: CGFloat = 1.0
    var maxZoom: CGFloat = 5.0

    /// Error callback - wire this up in the view layer
    var onError: ((String) -> Void)?

    // MARK: - Public Properties (Face Tracking, opt-in)

    /// Whether real-time face detection is enabled (default off; SWFaceCameraView turns it on)
    @ObservationIgnored
    nonisolated(unsafe) var faceTrackingEnabled = false

    /// Real-time detected face landmarks (capture device normalized coordinates, top-left origin)
    var faceLandmarks: [SWFaceLandmarkGroup] = []

    // MARK: - Private Properties (Session)

    private let photoOutput = AVCapturePhotoOutput()
    private var captureCompletion: ((UIImage?) -> Void)?
    private var currentDevice: AVCaptureDevice?

    /// Dedicated queue for thread-safe session operations
    private let sessionQueue = DispatchQueue(label: "com.shipswift.camera.session")
    private var isConfigured = false
    private var isConfiguring = false
    private var pendingStartSession = false

    // MARK: - Private Properties (Face Tracking)

    private let videoDataOutput = AVCaptureVideoDataOutput()
    private let videoDataQueue = DispatchQueue(label: "com.shipswift.camera.videodata", qos: .userInitiated)
    @ObservationIgnored
    private nonisolated(unsafe) let sequenceHandler = VNSequenceRequestHandler()
    /// Background-thread-safe copy of camera position (for Vision orientation)
    @ObservationIgnored
    private nonisolated(unsafe) var _bgCameraPosition: AVCaptureDevice.Position = .back

    // MARK: - Initialization

    /// Default initializer (rear camera)
    override init() {
        super.init()
        checkCameraPermission()
    }

    /// Initialize with specific camera position
    init(position: AVCaptureDevice.Position) {
        self.cameraPosition = position
        self._bgCameraPosition = position
        super.init()
        checkCameraPermission()
    }

    // MARK: - Permission Check

    private func checkCameraPermission() {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            DispatchQueue.main.async {
                self.isAuthorized = true
            }
            setupCamera()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { granted in
                DispatchQueue.main.async {
                    self.isAuthorized = granted
                    if granted {
                        self.setupCamera()
                    } else {
                        self.onError?(String(localized: "Camera permission denied"))
                    }
                }
            }
        case .denied, .restricted:
            DispatchQueue.main.async {
                self.onError?(String(localized: "Camera permission denied. Please enable in Settings"))
            }
        @unknown default:
            DispatchQueue.main.async {
                self.onError?(String(localized: "Unknown permission status"))
            }
        }
    }

    // MARK: - Camera Configuration

    private func setupCamera() {
        sessionQueue.async { [weak self] in
            guard let self else { return }
            guard !self.isConfigured, !self.isConfiguring else { return }

            self.isConfiguring = true
            self.session.beginConfiguration()

            // Clear existing inputs and outputs
            for input in self.session.inputs {
                self.session.removeInput(input)
            }
            for output in self.session.outputs {
                self.session.removeOutput(output)
            }

            guard let camera = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: self.cameraPosition) else {
                DispatchQueue.main.async {
                    self.onError?(String(localized: "Unable to access camera"))
                }
                self.session.commitConfiguration()
                self.isConfiguring = false
                return
            }

            self.currentDevice = camera

            // Update zoom range
            DispatchQueue.main.async {
                self.minZoom = 1.0
                self.maxZoom = min(camera.activeFormat.videoMaxZoomFactor, 5.0)
                self.currentZoom = 1.0
            }

            do {
                let input = try AVCaptureDeviceInput(device: camera)

                if self.session.canAddInput(input) {
                    self.session.addInput(input)
                } else {
                    DispatchQueue.main.async {
                        self.onError?(String(localized: "Unable to add camera input"))
                    }
                    self.session.commitConfiguration()
                    self.isConfiguring = false
                    return
                }

                self.session.sessionPreset = .photo

                // Photo output
                if self.photoOutput.availablePhotoCodecTypes.contains(AVVideoCodecType.hevc) {
                    self.photoOutput.maxPhotoQualityPrioritization = .balanced
                }

                if self.session.canAddOutput(self.photoOutput) {
                    self.session.addOutput(self.photoOutput)
                } else {
                    DispatchQueue.main.async {
                        self.onError?(String(localized: "Unable to add photo output"))
                    }
                    self.session.commitConfiguration()
                    self.isConfiguring = false
                    return
                }

                // Video data output (for face tracking; always added so tracking can be toggled at runtime)
                self.videoDataOutput.setSampleBufferDelegate(self, queue: self.videoDataQueue)
                self.videoDataOutput.alwaysDiscardsLateVideoFrames = true
                if self.session.canAddOutput(self.videoDataOutput) {
                    self.session.addOutput(self.videoDataOutput)
                }

                // Auto focus / exposure / white balance configuration
                self.configureAutoFocus(camera)

                self.session.commitConfiguration()
                self.isConfigured = true
                self.isConfiguring = false

                // If there's a pending start request, start immediately
                if self.pendingStartSession {
                    self.pendingStartSession = false
                    if !self.session.isRunning {
                        self.session.startRunning()
                    }
                }

            } catch {
                self.session.commitConfiguration()
                self.isConfiguring = false
                DispatchQueue.main.async {
                    self.onError?(String(localized: "Camera setup failed"))
                }
            }
        }
    }

    // MARK: - Session Control

    func startSession() {
        sessionQueue.async { [weak self] in
            guard let self else { return }

            if self.isConfiguring {
                self.pendingStartSession = true
                return
            }

            guard self.isConfigured else {
                self.pendingStartSession = true
                return
            }

            if !self.session.isRunning {
                self.session.startRunning()
            }
        }
    }

    func stopSession() {
        sessionQueue.async { [weak self] in
            guard let self else { return }
            if self.session.isRunning {
                self.session.stopRunning()
            }
        }
    }

    // MARK: - Photo Capture

    func capturePhoto(completion: @escaping (UIImage?) -> Void) {
        self.captureCompletion = completion

        let settings: AVCapturePhotoSettings
        if photoOutput.availablePhotoCodecTypes.contains(AVVideoCodecType.jpeg) {
            settings = AVCapturePhotoSettings(format: [AVVideoCodecKey: AVVideoCodecType.jpeg])
        } else {
            settings = AVCapturePhotoSettings()
        }

        photoOutput.capturePhoto(with: settings, delegate: self)
    }

    // MARK: - Zoom Control

    func setZoom(_ factor: CGFloat) {
        guard let device = currentDevice else { return }

        let zoomFactor = max(minZoom, min(factor, maxZoom))

        do {
            try device.lockForConfiguration()
            device.videoZoomFactor = zoomFactor
            device.unlockForConfiguration()

            DispatchQueue.main.async {
                self.currentZoom = zoomFactor
            }
        } catch {
            // Zoom failed, silently ignore
        }
    }

    func zoom(by delta: CGFloat) {
        setZoom(currentZoom * delta)
    }

    // MARK: - Switch Camera

    func switchCamera() {
        sessionQueue.async { [weak self] in
            guard let self else { return }

            let newPosition: AVCaptureDevice.Position = self.cameraPosition == .front ? .back : .front

            guard let newCamera = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: newPosition) else {
                return
            }

            self.session.beginConfiguration()

            // Remove existing inputs
            for input in self.session.inputs {
                self.session.removeInput(input)
            }

            do {
                let newInput = try AVCaptureDeviceInput(device: newCamera)
                if self.session.canAddInput(newInput) {
                    self.session.addInput(newInput)
                    self.currentDevice = newCamera

                    // Update background-thread-safe camera position (for Vision orientation)
                    self._bgCameraPosition = newPosition

                    // Configure auto focus for the new camera
                    self.configureAutoFocus(newCamera)

                    // Reset zoom
                    self.applyZoom(1.0, to: newCamera)

                    // Update main-thread properties
                    DispatchQueue.main.async {
                        self.cameraPosition = newPosition
                        self.minZoom = 1.0
                        self.maxZoom = min(newCamera.activeFormat.videoMaxZoomFactor, 5.0)
                        self.currentZoom = 1.0
                    }
                }
            } catch {
                // Switch failed, silently ignore
            }

            self.session.commitConfiguration()
        }
    }

    // MARK: - Private Helpers

    private func applyZoom(_ factor: CGFloat, to device: AVCaptureDevice) {
        do {
            try device.lockForConfiguration()
            device.videoZoomFactor = max(1.0, min(factor, device.activeFormat.videoMaxZoomFactor))
            device.unlockForConfiguration()
        } catch {
            // Zoom failed, silently ignore
        }
    }

    /// Configure auto focus, exposure, and white balance for optimal camera performance
    private func configureAutoFocus(_ device: AVCaptureDevice) {
        do {
            try device.lockForConfiguration()

            if device.isFocusModeSupported(.continuousAutoFocus) {
                device.focusMode = .continuousAutoFocus
            } else if device.isFocusModeSupported(.autoFocus) {
                device.focusMode = .autoFocus
            }

            if device.isExposureModeSupported(.continuousAutoExposure) {
                device.exposureMode = .continuousAutoExposure
            }

            if device.isWhiteBalanceModeSupported(.continuousAutoWhiteBalance) {
                device.whiteBalanceMode = .continuousAutoWhiteBalance
            }

            device.unlockForConfiguration()
        } catch {
            // Configuration failed, silently ignore
        }
    }
}

// MARK: - AVCapturePhotoCaptureDelegate

extension SWCameraManager: AVCapturePhotoCaptureDelegate {
    func photoOutput(_ output: AVCapturePhotoOutput, didFinishProcessingPhoto photo: AVCapturePhoto, error: Error?) {
        if error != nil {
            DispatchQueue.main.async {
                self.onError?(String(localized: "Photo capture failed"))
            }
            captureCompletion?(nil)
            return
        }

        guard let imageData = photo.fileDataRepresentation(),
              let image = UIImage(data: imageData) else {
            DispatchQueue.main.async {
                self.onError?(String(localized: "Unable to process photo data"))
            }
            captureCompletion?(nil)
            return
        }

        captureCompletion?(image)
    }
}

// MARK: - Real-time Face Landmark Detection (Vision)

extension SWCameraManager: AVCaptureVideoDataOutputSampleBufferDelegate {
    nonisolated func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        // Skip processing when face tracking is disabled
        guard faceTrackingEnabled else { return }
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }

        // Front camera is mirrored, rear camera is normal
        let orientation: CGImagePropertyOrientation = _bgCameraPosition == .front ? .leftMirrored : .right

        let request = VNDetectFaceLandmarksRequest()
        try? sequenceHandler.perform([request], on: pixelBuffer, orientation: orientation)

        guard let face = request.results?.first,
              let landmarks = face.landmarks else {
            Task { @MainActor in
                self.faceLandmarks = []
            }
            return
        }

        let bbox = face.boundingBox
        var groups: [SWFaceLandmarkGroup] = []

        /// Convert Vision landmark points to capture device normalized coordinates
        func convert(_ region: VNFaceLandmarkRegion2D?, type: SWFaceLandmarkRegion) {
            guard let region else { return }
            let pts = region.normalizedPoints.map { p in
                let x = bbox.origin.x + p.x * bbox.width
                let y = bbox.origin.y + p.y * bbox.height
                return CGPoint(x: x, y: 1.0 - y)
            }
            groups.append(SWFaceLandmarkGroup(region: type, points: pts))
        }

        // Extract all supported face landmarks
        convert(landmarks.faceContour, type: .faceContour)
        convert(landmarks.leftEyebrow, type: .leftEyebrow)
        convert(landmarks.rightEyebrow, type: .rightEyebrow)
        convert(landmarks.leftEye, type: .leftEye)
        convert(landmarks.rightEye, type: .rightEye)
        convert(landmarks.leftPupil, type: .leftPupil)
        convert(landmarks.rightPupil, type: .rightPupil)
        convert(landmarks.nose, type: .nose)
        convert(landmarks.noseCrest, type: .noseCrest)
        convert(landmarks.outerLips, type: .outerLips)
        convert(landmarks.innerLips, type: .innerLips)

        let result = groups
        Task { @MainActor in
            self.faceLandmarks = result
        }
    }
}
```

### File 3: SWCameraView.swift

Camera capture view with photo picker, pinch-to-zoom, and zoom slider.

```swift
//
//  SWCameraView.swift
//  ShipSwift
//
//  Camera capture view with photo picker and zoom control.
//  Full-screen camera UI with shutter button, photo library picker,
//  pinch-to-zoom gesture, and zoom slider.
//
//  Usage:
//    // 1. Present as a sheet with a @Binding UIImage
//    @State private var capturedImage: UIImage?
//    @State private var showCamera = false
//
//    Button("Take Photo") { showCamera = true }
//    .fullScreenCover(isPresented: $showCamera) {
//        SWCameraView(image: $capturedImage)
//    }
//
//    // 2. The view auto-dismisses after capture or photo selection.
//    //    The captured/selected image is written to the binding.
//
//    // 3. Features included:
//    //    - Live camera preview
//    //    - Shutter button for photo capture
//    //    - PhotosPicker for selecting from photo library
//    //    - Pinch-to-zoom gesture and zoom slider
//    //    - Front/back camera switching
//    //    - Close button (top-left corner)
//    //    - Unauthorized state with "Open Settings" button
//
//    // 4. Errors are shown via SWAlertManager.shared
//    //    Attach .swAlert() in your root view.
//

import SwiftUI
import PhotosUI
import AVFoundation

struct SWCameraView: View {
    @Binding var image: UIImage?
    @Environment(\.dismiss) private var dismiss
    @State private var selectedPhotoItem: PhotosPickerItem?
    @State private var cameraManager = SWCameraManager()
    @State private var isCapturing = false
    @State private var lastScale: CGFloat = 1.0

    var body: some View {
        Group {
            if cameraManager.isAuthorized {
                ZStack {
                    Color.black.ignoresSafeArea()

                    // Camera preview (vertically centered)
                    GeometryReader { geometry in
                        let previewWidth = geometry.size.width
                        let previewHeight = previewWidth * 4 / 3

                        SWCameraPreview(session: cameraManager.session)
                            .frame(width: previewWidth, height: previewHeight)
                            .clipped()
                            .overlay(alignment: .bottom) {
                                zoomControl
                            }
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                    }
                    .gesture(pinchGesture)
                    .onAppear {
                        cameraManager.onError = { SWAlertManager.shared.show(.error, message: $0) }
                        cameraManager.startSession()
                    }
                    .onDisappear { cameraManager.stopSession() }

                    // Bottom control bar
                    VStack {
                        Spacer()
                        controlBar
                    }

                    // Top-left close button
                    VStack {
                        HStack {
                            Button { dismiss() } label: {
                                Image(systemName: "xmark")
                                    .font(.title3)
                                    .foregroundStyle(.white)
                                    .frame(width: 44, height: 44)
                                    .background(.black.opacity(0.4), in: Circle())
                            }
                            Spacer()
                        }
                        .padding(.leading, 16)
                        .padding(.top, 8)
                        Spacer()
                    }
                }
            } else {
                unauthorizedView
            }
        }
        .background(.black)
        .onChange(of: selectedPhotoItem) {
            Task {
                await loadSelectedPhoto()
            }
        }
    }

    // MARK: - Pinch-to-Zoom Gesture

    private var pinchGesture: some Gesture {
        MagnifyGesture()
            .onChanged { value in
                let delta = value.magnification / lastScale
                lastScale = value.magnification
                cameraManager.zoom(by: delta)
            }
            .onEnded { _ in
                lastScale = 1.0
            }
    }

    // MARK: - Unauthorized View

    private var unauthorizedView: some View {
        VStack(spacing: 20) {
            Label("Camera permission required", systemImage: "camera.fill")
                .foregroundStyle(.regularMaterial)

            Button("Open Settings") {
                if let url = URL(string: UIApplication.openSettingsURLString) {
                    UIApplication.shared.open(url)
                }
            }
            .buttonStyle(.borderedProminent)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Zoom Control

    private var zoomControl: some View {
        VStack(spacing: 8) {
            // Current zoom level
            Text(String(format: "%.1fx", cameraManager.currentZoom))
                .font(.system(size: 14, weight: .medium, design: .monospaced))

            // Zoom slider
            HStack(spacing: 12) {
                Text("1x")
                    .font(.caption)

                Slider(
                    value: Binding(
                        get: { cameraManager.currentZoom },
                        set: { cameraManager.setZoom($0) }
                    ),
                    in: cameraManager.minZoom...cameraManager.maxZoom
                )
                .tint(.accent)

                Text(String(format: "%.0fx", cameraManager.maxZoom))
                    .font(.caption)
            }
            .padding(.horizontal, 60)
        }
        .foregroundStyle(.white.opacity(0.7))
        .padding()
    }

    // MARK: - Bottom Control Bar

    private var controlBar: some View {
        HStack(spacing: 50) {
            // Photo library picker
            PhotosPicker(selection: $selectedPhotoItem, matching: .images) {
                controlButton(icon: "photo.on.rectangle")
            }

            // Capture button
            Button {
                capturePhoto()
            } label: {
                shutterButton
            }
            .disabled(!cameraManager.isAuthorized || isCapturing)

            // Switch camera
            Button { cameraManager.switchCamera() } label: {
                controlButton(icon: "camera.rotate.fill")
            }
        }
        .padding(.bottom, 50)
        .padding(.top, 20)
    }

    // MARK: - Control Button Style

    private func controlButton(icon: String) -> some View {
        Image(systemName: icon)
            .font(.title2)
            .foregroundStyle(.white)
            .frame(width: 50, height: 50)
            .background(.black.opacity(0.6), in: RoundedRectangle(cornerRadius: 12))
    }

    // MARK: - Shutter Button

    private var shutterButton: some View {
        Circle()
            .fill(cameraManager.isAuthorized && !isCapturing ? .white : .gray)
            .frame(width: 70, height: 70)
            .overlay {
                Circle()
                    .strokeBorder(.black.opacity(0.2), lineWidth: 2)
                    .frame(width: 60, height: 60)
            }
            .scaleEffect(isCapturing ? 0.9 : 1.0)
            .animation(.easeInOut(duration: 0.1), value: isCapturing)
    }

    // MARK: - Actions

    private func capturePhoto() {
        guard cameraManager.isAuthorized, !isCapturing else { return }

        isCapturing = true
        cameraManager.capturePhoto { photo in
            isCapturing = false
            if let photo {
                image = photo
                dismiss()
            }
        }
    }

    private func loadSelectedPhoto() async {
        guard let item = selectedPhotoItem,
              let data = try? await item.loadTransferable(type: Data.self),
              let selectedImage = UIImage(data: data) else { return }

        image = selectedImage
        dismiss()
    }
}

// MARK: - Camera Preview

struct SWCameraPreview: UIViewRepresentable {
    let session: AVCaptureSession

    func makeUIView(context: Context) -> SWPreviewView {
        let view = SWPreviewView()
        view.session = session
        return view
    }

    func updateUIView(_ uiView: SWPreviewView, context: Context) {
        if uiView.session != session {
            uiView.session = session
        }
    }
}

class SWPreviewView: UIView {
    var session: AVCaptureSession? {
        didSet {
            guard let session = session else { return }
            videoPreviewLayer.session = session
        }
    }

    override class var layerClass: AnyClass {
        return AVCaptureVideoPreviewLayer.self
    }

    var videoPreviewLayer: AVCaptureVideoPreviewLayer {
        return layer as! AVCaptureVideoPreviewLayer
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        videoPreviewLayer.frame = bounds
        videoPreviewLayer.videoGravity = .resizeAspectFill
    }
}
```

### File 4: SWFaceCameraView.swift

Face camera view with real-time landmark overlay, configurable color schemes, and photo capture.

```swift
//
//  SWFaceCameraView.swift
//  ShipSwift
//
//  Face camera view with real-time landmark overlay.
//  Full camera UI with face landmark visualization, photo capture,
//  camera switching, and landmark display toggle.
//
//  Usage:
//    // 1. Basic usage with onCapture callback
//    SWFaceCameraView { capturedImage in
//        // handle the captured UIImage
//        processPhoto(capturedImage)
//    }
//
//    // 2. Custom landmark color scheme
//    SWFaceCameraView(
//        onCapture: { image in handlePhoto(image) },
//        landmarkColors: .mono   // tech-feel cyan monochrome
//    )
//
//    // 3. Available color schemes
//    //    .default — multi-color (cyan lips, green eyes, purple brows, yellow nose)
//    //    .mono    — all cyan with varying opacity (tech feel)
//    //    .warm    — pink lips, orange eyes, red brows, yellow nose
//
//    // 4. Custom color scheme
//    let colors = SWFaceLandmarkColors(
//        lips: .pink.opacity(0.6),
//        eyes: .green.opacity(0.6),
//        eyebrows: .purple.opacity(0.6),
//        nose: .yellow.opacity(0.6),
//        faceContour: .white.opacity(0.2)
//    )
//    SWFaceCameraView(onCapture: { _ in }, landmarkColors: colors)
//
//    // 5. Controls provided:
//    //    - Camera switch button (front/back)
//    //    - Shutter button for photo capture
//    //    - Landmark overlay toggle button
//

import SwiftUI
import AVFoundation

// MARK: - Face Recognition Camera View

struct SWFaceCameraView: View {
    /// Photo capture callback
    var onCapture: ((UIImage) -> Void)?

    /// Landmark color scheme
    var landmarkColors: SWFaceLandmarkColors = .default

    @Environment(\.dismiss) private var dismiss
    @State private var cameraManager = SWCameraManager(position: .front)
    @State private var isCapturing = false
    @State private var showLandmarks = true

    var body: some View {
        Group {
            if cameraManager.isAuthorized {
                ZStack {
                    Color.black.ignoresSafeArea()

                    // Camera preview (vertically centered)
                    GeometryReader { geometry in
                        let previewWidth = geometry.size.width
                        let previewHeight = previewWidth * 4 / 3

                        SWFaceCameraPreview(session: cameraManager.session)
                            .frame(width: previewWidth, height: previewHeight)
                            .clipped()
                            .overlay {
                                if showLandmarks {
                                    SWFaceTrackingOverlay(
                                        landmarks: cameraManager.faceLandmarks,
                                        colors: landmarkColors
                                    )
                                }
                            }
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                    }
                    .onAppear {
                        cameraManager.faceTrackingEnabled = true
                        cameraManager.startSession()
                    }
                    .onDisappear {
                        cameraManager.faceTrackingEnabled = false
                        cameraManager.stopSession()
                    }

                    // Bottom control bar
                    VStack {
                        Spacer()
                        controlBar
                    }

                    // Top-left close button
                    VStack {
                        HStack {
                            Button { dismiss() } label: {
                                Image(systemName: "xmark")
                                    .font(.title3)
                                    .foregroundStyle(.white)
                                    .frame(width: 44, height: 44)
                                    .background(.black.opacity(0.4), in: Circle())
                            }
                            Spacer()
                        }
                        .padding(.leading, 16)
                        .padding(.top, 8)
                        Spacer()
                    }
                }
            } else {
                unauthorizedView
            }
        }
        .background(.black)
    }

    // MARK: - Unauthorized View

    private var unauthorizedView: some View {
        VStack(spacing: 20) {
            Label("Camera permission required", systemImage: "camera.fill")
                .foregroundStyle(.regularMaterial)

            Button("Open Settings") {
                if let url = URL(string: UIApplication.openSettingsURLString) {
                    UIApplication.shared.open(url)
                }
            }
            .buttonStyle(.borderedProminent)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Bottom Control Bar

    private var controlBar: some View {
        VStack {
            HStack(spacing: 50) {
                // Switch camera
                Button {
                    cameraManager.switchCamera()
                } label: {
                    controlButton(icon: "camera.rotate.fill")
                }

                // Shutter button (same style as SWCameraView)
                Button {
                    capturePhoto()
                } label: {
                    shutterButton
                }
                .disabled(!cameraManager.isAuthorized || isCapturing)

                // Face landmark toggle
                Button {
                    showLandmarks.toggle()
                } label: {
                    controlButton(icon: showLandmarks ? "face.dashed.fill" : "face.dashed")
                }
            }
        }
        .padding(.bottom, 50)
        .padding(.top, 20)
    }

    // MARK: - Control Button Style

    private func controlButton(icon: String) -> some View {
        Image(systemName: icon)
            .font(.title2)
            .foregroundStyle(.white)
            .frame(width: 50, height: 50)
            .background(.black.opacity(0.6), in: RoundedRectangle(cornerRadius: 12))
    }

    // MARK: - Shutter Button

    private var shutterButton: some View {
        Circle()
            .fill(cameraManager.isAuthorized && !isCapturing ? .white : .gray)
            .frame(width: 70, height: 70)
            .overlay {
                Circle()
                    .strokeBorder(.black.opacity(0.2), lineWidth: 2)
                    .frame(width: 60, height: 60)
            }
            .scaleEffect(isCapturing ? 0.9 : 1.0)
            .animation(.easeInOut(duration: 0.1), value: isCapturing)
    }

    // MARK: - Photo Capture

    private func capturePhoto() {
        guard cameraManager.isAuthorized, !isCapturing else { return }

        isCapturing = true
        cameraManager.capturePhoto { photo in
            isCapturing = false
            if let photo {
                onCapture?(photo)
            }
        }
    }
}

// MARK: - Camera Preview

struct SWFaceCameraPreview: UIViewRepresentable {
    let session: AVCaptureSession

    func makeUIView(context: Context) -> SWFacePreviewView {
        let view = SWFacePreviewView()
        view.session = session
        return view
    }

    func updateUIView(_ uiView: SWFacePreviewView, context: Context) {
        if uiView.session != session {
            uiView.session = session
        }
    }
}

final class SWFacePreviewView: UIView {
    var session: AVCaptureSession? {
        didSet {
            guard let session = session else { return }
            videoPreviewLayer.session = session
        }
    }

    override class var layerClass: AnyClass {
        return AVCaptureVideoPreviewLayer.self
    }

    var videoPreviewLayer: AVCaptureVideoPreviewLayer {
        return layer as! AVCaptureVideoPreviewLayer
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        videoPreviewLayer.frame = bounds
        videoPreviewLayer.videoGravity = .resizeAspectFill
    }
}

// MARK: - Face Landmark Real-time Rendering

struct SWFaceTrackingOverlay: View {
    let landmarks: [SWFaceLandmarkGroup]
    var colors: SWFaceLandmarkColors = .default

    var body: some View {
        Canvas { context, size in
            for group in landmarks {
                guard !group.points.isEmpty else { continue }

                let color = colors.color(for: group.region)
                let mapped = group.points.map {
                    CGPoint(x: $0.x * size.width, y: $0.y * size.height)
                }

                // Pupils and other few-point regions only draw dots, not paths
                if group.isClosed {
                    var path = Path()
                    path.addLines(mapped)
                    path.closeSubpath()

                    // Lip regions have semi-transparent fill
                    if group.region == .outerLips || group.region == .innerLips {
                        context.fill(path, with: .color(color.opacity(0.08)))
                    }
                    context.stroke(path, with: .color(color.opacity(0.8)), lineWidth: 1.5)
                }

                // Each point
                let dotSize: CGFloat = group.region == .leftPupil || group.region == .rightPupil ? 5 : 3
                for point in mapped {
                    let rect = CGRect(x: point.x - dotSize / 2, y: point.y - dotSize / 2,
                                      width: dotSize, height: dotSize)
                    context.fill(Circle().path(in: rect), with: .color(color))
                }
            }
        }
        .allowsHitTesting(false)
    }
}

// MARK: - Landmark Color Scheme

struct SWFaceLandmarkColors {
    var lips: Color
    var eyes: Color
    var eyebrows: Color
    var nose: Color
    var faceContour: Color

    func color(for region: SWFaceLandmarkRegion) -> Color {
        switch region {
        case .outerLips, .innerLips:         return lips
        case .leftEye, .rightEye:            return eyes
        case .leftPupil, .rightPupil:        return eyes
        case .leftEyebrow, .rightEyebrow:    return eyebrows
        case .nose, .noseCrest:              return nose
        case .faceContour:                   return faceContour
        }
    }

    /// Default color scheme
    static let `default` = SWFaceLandmarkColors(
        lips: .cyan.opacity(0.6),
        eyes: .green.opacity(0.6),
        eyebrows: .purple.opacity(0.6),
        nose: .yellow.opacity(0.6),
        faceContour: .white.opacity(0.2)
    )

    /// Monochrome scheme (tech feel)
    static let mono = SWFaceLandmarkColors(
        lips: .cyan.opacity(0.7),
        eyes: .cyan.opacity(0.5),
        eyebrows: .cyan.opacity(0.4),
        nose: .cyan.opacity(0.5),
        faceContour: .cyan.opacity(0.15)
    )

    /// Warm color scheme
    static let warm = SWFaceLandmarkColors(
        lips: .pink.opacity(0.6),
        eyes: .orange.opacity(0.6),
        eyebrows: .red.opacity(0.5),
        nose: .yellow.opacity(0.6),
        faceContour: .white.opacity(0.15)
    )
}
```

## Integration Checklist

### 1. Add Info.plist Camera Permission

Add the camera usage description to your `Info.plist` (or Xcode target > Info tab):

```xml
<key>NSCameraUsageDescription</key>
<string>This app needs camera access to take photos</string>
```

Without this key, the app will crash on first camera access attempt.

### 2. Add All Four Files to Your Project

Copy the files into your Xcode project in the following order (dependency order):

1. `SWFaceLandmark.swift` -- data models, no dependencies
2. `SWCameraManager.swift` -- depends on SWFaceLandmark
3. `SWCameraView.swift` -- depends on SWCameraManager
4. `SWFaceCameraView.swift` -- depends on SWCameraManager and SWFaceLandmark

### 3. Wire Up Error Handling

`SWCameraView` uses `SWAlertManager.shared.show(...)` for error display. Make sure your root view has the `.swAlert()` modifier attached. If you are not using the ShipSwift alert system, replace the `onError` callback in `onAppear`:

```swift
cameraManager.onError = { message in
    // Replace with your own error handling
    print("Camera error: \(message)")
}
```

### 4. Present SWCameraView

```swift
@State private var capturedImage: UIImage?
@State private var showCamera = false

Button("Take Photo") { showCamera = true }
.fullScreenCover(isPresented: $showCamera) {
    SWCameraView(image: $capturedImage)
}
```

### 5. Present SWFaceCameraView

```swift
@State private var showFaceCamera = false

Button("Face Camera") { showFaceCamera = true }
.fullScreenCover(isPresented: $showFaceCamera) {
    SWFaceCameraView { capturedImage in
        // handle the captured UIImage
        processPhoto(capturedImage)
    }
}
```

## Common Customizations

### Photo-Only Mode (No Face Detection)

Use `SWCameraView` directly. It does not enable face tracking. The `SWCameraManager` has `faceTrackingEnabled = false` by default, so the video data output delegate simply returns early without running Vision requests.

### Change Default Camera Direction

`SWCameraView` defaults to the rear camera. To start with the front camera, modify the `@State` initialization:

```swift
@State private var cameraManager = SWCameraManager(position: .front)
```

`SWFaceCameraView` already defaults to the front camera since face detection is most commonly used for selfie scenarios.

### Custom Landmark Colors

Pass a custom `SWFaceLandmarkColors` to `SWFaceCameraView`:

```swift
let customColors = SWFaceLandmarkColors(
    lips: .pink.opacity(0.6),
    eyes: .green.opacity(0.6),
    eyebrows: .purple.opacity(0.6),
    nose: .yellow.opacity(0.6),
    faceContour: .white.opacity(0.2)
)

SWFaceCameraView(
    onCapture: { image in handlePhoto(image) },
    landmarkColors: customColors
)
```

Three built-in presets are available: `.default`, `.mono` (tech-feel cyan), and `.warm` (pink/orange).

### Adjust Maximum Zoom

The default maximum zoom is capped at 5x. To change this, modify the `maxZoom` calculation in `SWCameraManager.setupCamera()`:

```swift
// Change 5.0 to your desired max (or remove the cap entirely)
self.maxZoom = min(camera.activeFormat.videoMaxZoomFactor, 10.0)
```

### Use SWCameraManager Standalone

You can use `SWCameraManager` without any of the provided views for a fully custom camera UI:

```swift
@State private var cameraManager = SWCameraManager()

var body: some View {
    VStack {
        SWCameraPreview(session: cameraManager.session)
            .onAppear { cameraManager.startSession() }
            .onDisappear { cameraManager.stopSession() }

        Button("Capture") {
            cameraManager.capturePhoto { image in
                guard let image else { return }
                // use the captured image
            }
        }
    }
}
```

### Hide the Zoom Slider

If you want the pinch-to-zoom gesture but not the on-screen slider, remove the `.overlay(alignment: .bottom) { zoomControl }` modifier from the camera preview in `SWCameraView`.

## Known Pitfalls

### Camera Permission Denied Has No Recovery

If the user denies camera permission, iOS does not allow the app to re-prompt. The only recovery path is directing the user to Settings. Both `SWCameraView` and `SWFaceCameraView` include an "Open Settings" button for this case.

### Simulator Does Not Support Camera

`AVCaptureDevice.default(...)` returns `nil` on the iOS Simulator. The manager will trigger `onError` with "Unable to access camera". Always test camera features on a physical device.

### Face Detection Performance

Vision's `VNDetectFaceLandmarksRequest` runs per-frame on the video data output queue. On older devices, this may cause frame drops. The implementation uses `alwaysDiscardsLateVideoFrames = true` and a `.userInitiated` QoS queue to mitigate this, but performance may vary.

### Front Camera Mirroring

The front camera preview is mirrored by `AVCaptureVideoPreviewLayer` by default. The Vision face detection code accounts for this by using `.leftMirrored` orientation for front-camera frames. If you modify the preview mirroring behavior, you must also update the orientation in `captureOutput(_:didOutput:from:)`.

### Session Start Timing

`SWCameraManager` handles the race condition where `startSession()` is called before `setupCamera()` completes by queuing a `pendingStartSession` flag. You do not need to add your own delay or retry logic.

### Photo Capture Format

The implementation prefers JPEG format for captured photos. If JPEG is not available on the device, it falls back to the default format. The captured `UIImage` is always returned via the completion handler regardless of the underlying codec.

### Video Data Output Always Attached

The `AVCaptureVideoDataOutput` is always added to the session even when face tracking is disabled. This is by design so that face tracking can be toggled at runtime without reconfiguring the session. When `faceTrackingEnabled` is `false`, the delegate method returns immediately with negligible overhead.
