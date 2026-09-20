# AXIOM Reader Native Companion Development Plan

**Date:** 2026-09-19  
**Status:** Proposed; planning only  
**Scope:** Background audio, Android Auto, iOS background playback, and eventual CarPlay support while preserving the existing browser reader.

## Recommendation

Use a hybrid native application rather than rewriting AXIOM twice from scratch:

- Keep the existing HTML/CSS/JavaScript reader, document parser, IndexedDB data, notes, highlights, pronunciation settings, review tools, and accessibility behavior.
- Add Android and iOS projects with [Capacitor](https://capacitorjs.com/docs), using native plugins where browser APIs cannot provide reliable background playback.
- Move playback into platform-native services. The web reader remains the primary document and reading interface; native playback becomes the durable audio layer.
- Build Android first because Android Auto and screen-off playback are the immediate goals. Add iOS background playback next, then evaluate CarPlay.
- Do not begin a full native UI rewrite unless the hybrid shell creates a demonstrated limitation that matters to AXIOM users.

This plan addresses the annotated recommendation to preserve the working reader while gaining native playback, Android Auto, and later CarPlay support. :codex-annotation{index="1"}

## Baseline and constraints

The current repository contains the working browser application and no Android or iOS project. Existing behavior to preserve includes document import and PDF text extraction, local library data, notes, highlights, search, review status, pronunciation settings, synchronized reading, caching, and accessibility.

The current web media layer in [js/tts.js](js/tts.js) already exposes browser media-session actions, but browser `AudioContext`, Web Speech, and service-worker behavior are not a sufficient guarantee of screen-off playback on mobile devices. Native playback must therefore be additive and independently testable.

Original documents, user data, browser storage, and the current web deployment remain protected. No migration should clear or silently rewrite existing IndexedDB data.

## Phases and acceptance criteria

### Phase 0 — Architecture and preservation baseline

**Goal:** Define the seam between the web reader and native playback before adding a mobile framework.

Work:

- Inventory the current playback engines, document/section identifiers, reading-position persistence, speed settings, and cache formats.
- Define a platform-neutral playback contract: load queue, play, pause, stop, next, previous, seek, speed, metadata, progress, error, and resume position.
- Define a versioned bridge protocol between the web UI and native code.
- Capture browser regression evidence using the existing synthetic reader checks.

Exit criteria:

- Existing browser behavior still passes its relevant checks.
- The bridge contract can represent local TTS, cloud audio, and a document with no audio cached.
- No user-data migration or destructive cleanup is required.

### Phase 1 — Android shell spike

**Goal:** Prove that the existing reader can run in a native Android package while retaining its web UI.

Work:

- Add a Capacitor Android target in a separate, reviewable change.
- Load the existing reader locally and expose only the minimum bridge calls.
- Verify file import, IndexedDB persistence, notes, highlights, and reader navigation on a physical Android device or emulator.

Exit criteria:

- A synthetic document can be opened, annotated, closed, and reopened without data loss.
- The web build remains usable independently.
- No native playback is claimed yet; this phase is shell and data compatibility only.

Reference: [Capacitor documentation](https://capacitorjs.com/docs).

### Phase 2 — Android native background playback

**Goal:** Make narration continue with the screen off and expose standard Android controls.

Work:

- Implement a `MediaLibraryService`/Media3 playback service containing the player and `MediaSession`.
- Declare the media foreground-service permissions and `mediaPlayback` service type.
- Queue audio as passage/section media items with title, document, position, speed, and completion metadata.
- Route cloud-generated audio through the native queue and cache it for offline/repeat playback.
- For local voices, use Android text-to-speech synthesis in a service-safe way; prefer synthesizing short chunks to files and playing those chunks through the same native queue so both voice paths share pause, resume, seek, and interruption behavior.
- Handle audio focus, Bluetooth/headset buttons, phone calls, network loss, and service restart/resumption.

Exit criteria:

- Playback continues after screen lock and while another app is foregrounded.
- Lock-screen and notification controls accurately reflect play/pause and current passage.
- Playback resumes from the last confirmed passage after an interruption or service restart.
- Browser playback remains available when the user is not using the native shell.

References:

- [Media3 background playback](https://developer.android.com/media/media3/session/background-playback)
- [Media3 player/background architecture](https://developer.android.com/media/media3/session/player)
- [Android text-to-speech synthesis](https://developer.android.com/reference/android/speech/tts/TextToSpeech)

### Phase 3 — Android Auto integration

**Goal:** Make AXIOM discoverable as a driver-safe media app with usable playback controls.

Work:

- Declare Android Auto media support in the manifest.
- Expose a compact content hierarchy such as Recent Documents → Sections/Passages.
- Map Android Auto commands to the native queue, including play, pause, stop, previous, next, and any supported seek behavior.
- Keep the car UI focused on safe selection and playback; do not mirror the full reader or expose editing tools while driving.
- Test with the Android Auto Desktop Head Unit and a connected physical device.

Exit criteria:

- AXIOM appears as a media source in Android Auto.
- The current title and playback state are correct.
- Commands from the car control native playback without reopening the web activity.
- The app meets the applicable car-quality and driver-distraction requirements.

References:

- [Android media apps for cars](https://developer.android.com/training/cars/media)
- [Enable playback controls](https://developer.android.com/training/cars/media/enable-playback)
- [Add Android Auto support](https://developer.android.com/training/cars/media/auto)
- [Android car-app quality guidelines](https://developer.android.com/docs/quality-guidelines/car-app-quality)

### Phase 4 — iOS background playback

**Goal:** Provide equivalent screen-off playback on iPhone/iPad without duplicating the reader UI.

Work:

- Add the Capacitor iOS target and native playback plugin.
- Use AVFoundation with an audio playback session and the Audio background mode.
- Publish Now Playing metadata and remote commands.
- Reuse the same bridge contract, queue identifiers, cached audio policy, and reading-position model as Android where practical.
- Define how local iOS voices and cloud audio are converted into queueable audio chunks.

Exit criteria:

- Playback continues after locking the device or switching applications.
- Lock-screen and headset controls work.
- Audio interruptions and route changes are handled without losing the reading position.

References:

- [Apple: configure an app for media playback](https://developer.apple.com/documentation/avfoundation/configuring-your-app-for-media-playback)
- [Apple: background execution modes](https://developer.apple.com/documentation/xcode/configuring-background-execution-modes)
- [Apple: playback audio session category](https://developer.apple.com/documentation/avfaudio/avaudiosession/category-swift.struct/playback)

### Phase 5 — CarPlay evaluation and implementation

**Goal:** Decide whether a CarPlay experience is worth the additional entitlement and review work.

Work:

- First validate iOS background playback and Now Playing behavior.
- Request and confirm the Apple audio CarPlay entitlement before building a vehicle UI.
- Implement a minimal CarPlay hierarchy—recent documents, sections, and Now Playing—not the full reader/editor.
- Test with the CarPlay Simulator and, if available, a compatible vehicle.

Exit criteria:

- A clear go/no-go decision is recorded based on entitlement availability, testing access, and user value.
- If proceeding, CarPlay controls remain limited to safe audio browsing and playback.

References:

- [Apple CarPlay framework](https://developer.apple.com/documentation/carplay)
- [CarPlay audio entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.carplay-audio)
- [CarPlay list template](https://developer.apple.com/documentation/carplay/cplisttemplate)

### Phase 6 — Release hardening

**Goal:** Publish only after mobile behavior and data preservation are evidenced.

Work:

- Add automated bridge and playback-contract tests where feasible.
- Test airplane mode, network loss, long documents, repeated pause/resume, speed changes, voice changes, interruptions, device reboot, and low-storage conditions.
- Verify that web, Android, and iOS builds use compatible document and position identifiers.
- Document exactly which results were static, emulator, physical-device, Desktop Head Unit, CarPlay Simulator, preview, or production checks.
- Prepare store listings and platform privacy disclosures only after the product behavior is stable.

Release gate:

- No known regression in the browser reader or user data.
- Background playback and car controls pass on the target devices used for release.
- Publication receives explicit approval before any store submission or production deployment.

## Risks and decisions to resolve

- **Local TTS portability:** Android and iOS voices differ. The queue contract must not assume identical voice names or timing marks.
- **Cloud audio format:** Native players need a supported, seekable or chunkable format. The current browser PCM/AudioContext path may need a native conversion or server response format.
- **Storage ownership:** The shell must define whether native caches are copies of browser data or a new canonical store; it must never erase the existing store silently.
- **Car policy:** Android Auto and CarPlay require car-safe interfaces and platform review; the full AXIOM reader should remain a phone interface.
- **Framework boundary:** Capacitor is a delivery mechanism, not a reason to rewrite the reader. Native code should be introduced only where OS services are required.

## Immediate next action

Approve Phase 0 as a read-only design task. The first implementation should be a narrow Android shell/playback spike with synthetic documents, leaving the current browser deployment and user data untouched.
