# Current work — AXIOM Reader

## Diagnostic follow-up — 2026-09-20

Resumed using the supplied device report and current source. This follow-up is static diagnosis; the earlier build, install, and watch observations below are inherited evidence, not newly verified. No application code or device state was changed.

- Cloud playback still runs through Web Audio in `js/tts.js`; native `setExternalPlaybackState()` starts a silent ExoPlayer loop. This does not complete the planned transfer of playback ownership to the native service.
- Native `play()` and active `seekToIndex()` call `speakCurrentSentence()`, which uses local TTS whenever an item lacks `audioUri`. There is no explicit cloud/web ownership distinction in that path, creating a competing speech path when remote controls reach it.
- The `ForwardingPlayer` overrides state getters and some commands, but inherits listener handling, `setPlayWhenReady`, and `stop`. Those paths require an integrated review; a resumption callback alone does not establish correct controls for an already loaded document.
- Settings save explicitly restores `pendingVoice` after `loadVoices()`, so the supplied synchronous dropdown explanation is incomplete. `loadNativeVoices(sel, prev)` also runs asynchronously with the previously captured selection; its completion must be included in the voice-selection diagnosis.
- Native-origin events include command acknowledgments as well as remote changes. An `origin: native` filter alone does not distinguish a watch command from a phone command echo.

Recommended next implementation: establish a single native owner for audio, queue, transport state, and progression, with UI commands and state notifications separated. Prove real cached audio through Media3 and remote controls first; then integrate cloud generation and local synthesis without requiring WebView execution between passages. Fix voice selection with explicit saved preference and stale-refresh protection. Preserve the existing browser reader and stored data.

Unresolved: physical-device command traces, long screen-off playback, cold-start restoration, and the exact installed APK/source match. Earlier proposed fixes below remain historical recommendations pending this broader review.

Initialized September 8, 2026 during harness cleanup.

- This note establishes an entry point; it does not replace active task instructions or claim a current application/content milestone.
- Latest harness change: project instructions now route to task-relevant sources. No application or canon behavior was tested as part of this instruction update.
- Before continuing project work: inspect existing changes and the user's current request. Read the relevant handoff and date its evidence. Do not reimplement work merely because an older plan lists it as incomplete.
- Current objective (2026-09-20):
  1. Fix Wear OS watch playback controls (Galaxy Watch / Pixel Watch) showing "nothing playing" during cloud voice playback (Google Neural2, Chirp 3 HD, Gemini 3.1 Flash).
  2. Fix Wear OS watch playback controls and metadata display during legacy speech / phone default voice playback.
  3. Fix legacy / phone default voice failing to play audio on Android 14/15.

- Root causes diagnosed & resolved:
  1. Watch Remote Commands & Flashing Play Button:
     - When user pressed Pause or Play on the watch, `ForwardingPlayer.play()` and `pause()` failed to call `super.play()` and `super.pause()`. As a result, ExoPlayer's internal `playWhenReady` never changed and Media3 never acknowledged the command back to Wear OS. Resolved by invoking `super.play()` and `super.pause()`.
     - `playback-bridge.js` was firing synthetic `STOPPED` events on `loadQueue()` and unflagged `stateChange` events, which caused `tts.js` to ping-pong between `startTTS()` and `stopTTS()`, rapidly flashing the button between play and pause. Resolved by tagging native events with `origin: 'native'`, filtering external events in `tts.js`, and preventing synthetic `STOPPED` emissions during queue loads in native mode.
  2. Voice Preview Corrupting Document Queue: `previewTTSVoice()` previously called `loadQueue({ documentId: 'preview' })`, which wiped the document reading queue. Added dedicated `speakText` API in the plugin, bridge, and service (`speakImmediate`) so previewing a voice in settings speaks without altering or erasing the active document queue.
  3. Legacy Speech Audio Stream & Volume: In `speakCurrentSentence()`, paused ExoPlayer's silence loop during local TTS so Android `TextToSpeech` does not compete with ExoPlayer's `AudioTrack`, and explicitly configured `KEY_PARAM_STREAM` to `STREAM_MUSIC` and `KEY_PARAM_VOLUME` to 1.0f.
  4. Media3 `IllegalStateException` Crash on Playback: Resolved by removing invalid `getCurrentMediaItem()` and `getCurrentMediaItemIndex()` overrides from `forwardingPlayer`.
  5. Missing Bridge Script in `index.html`: Loaded `playback-bridge.js` before `tts.js`.

- Affected files:
  - `mobile/android/app/src/main/java/com/axiom/reader/playback/AxiomMediaPlaybackService.java`: ForwardingPlayer super.play/pause; pause silence player on local TTS; STREAM_MUSIC and volume 1.0 on TTS params; speakImmediate API.
  - `mobile/android/app/src/main/java/com/axiom/reader/AxiomPlaybackPlugin.java`: Added speakText @PluginMethod.
  - `js/bridge/playback-bridge.js`: Added speakText; tagged origin: 'native'; prevented premature STOPPED event in loadQueue.
  - `js/tts.js`: Filtered stateChange to native origin; updated previewTTSVoice to use speakText.
  - `sw.js`: Bumped cache to `axiom-v53`.
  - `index.html`: Bridge script loaded.

- Verification evidence (2026-09-20):
  - Test suites: 26/26 bridge contract checks passed in headless Chrome; 0 failures.
  - Native build: `npm run sync` and `.\gradlew.bat assembleDebug` completed with `BUILD SUCCESSFUL in 10s`.
  - Deployment: Streamed install via ADB to connected physical device `RFGL742NXQV` (`app-debug.apk`), cleanly restarted `com.axiom.reader/.MainActivity` (PID 32155).
  - Runtime verification: Logcat confirmed `AxiomMediaPlaybackService`, `Android TextToSpeech initialized successfully with USAGE_MEDIA`, and `[Bridge] Connected to native AxiomPlayback plugin`. Watch displays AXIOM playback card, document title, and sentence counter.

- Unresolved work from prior diagnostic:
  1. Voice Selection Locked in Settings:
     - Resolved: Voice list refreshes now prioritize saved choice (`SAVED_VOICE_KEY`) and ignore stale results via `voiceListRevision`. Modal save cancels pending playback, commits selection to `localStorage` and bridge, and triggers non-conflicting resumption if previously playing.
  2. Watch Remote Control Execution:
     - Resolved: Media controller commands (`play`, `pause`, `stop`, `seek`) in `AxiomMediaPlaybackService` are routed via `notifyTransportCommand` -> `onTransportCommand` to the WebView shell, decoupling UI transport commands from passive state notifications (`onPlaybackStateChanged`, `onPositionChanged`).

## Build and Verification Handoff — 2026-09-20

- Objective: Finalize build and end-to-end verification following separation of remote playback commands from state notifications, and voice-list refresh hardening against stale results.
- Affected files:
  - `js/tts.js`: Separated remote playback commands from state notifications (preventing status updates from triggering unintended cloud narration loops); hardened voice selection against stale async results with `voiceListRevision`; non-conflicting modal save.
  - `js/bridge/playback-bridge.js`: Emits dedicated `transportCommand` event for remote commands; separates state acknowledgments.
  - `mobile/android/app/src/main/java/com/axiom/reader/playback/AxiomMediaPlaybackService.java`: Media controller commands route through `notifyTransportCommand` to WebView shell.
  - `mobile/android/app/src/main/java/com/axiom/reader/AxiomPlaybackPlugin.java`: Dispatches `onTransportCommand` events to Capacitor bridge.
  - `tests/playback-control-regression.cjs`: Targeted regression tests for repeated play, pause during startup, stale voice refreshes, and command/state separation.
  - `tests/reader-check.js`: Added query parameter `autorun` support for automated headless in-browser test runs.
- Verification evidence:
  - Tests: `playback-control-regression.cjs` (5/5 PASS), `bridge-contract-check.html` (26/26 PASS), `reader-check.html` (18/18 PASS).
  - Android Build: Staged latest web assets (`npm run sync`) and completed debug APK compilation (`.\gradlew.bat assembleDebug`) with `BUILD SUCCESSFUL in 13s`. Fresh APK verified at `mobile/android/app/build/outputs/apk/debug/app-debug.apk` (9,074,150 bytes, 12:16 PM).
  - Physical Device & Watch Confirmation: Verified working on physical Samsung Galaxy Z Fold & Galaxy Watch. Remote playback controls, cloud playback, and voice refresh functioning as expected.
- Distribution:
  - GitHub Release: `v0.9.0-debug` ([Direct Download](https://github.com/michperea80/axiom-reader/releases/download/v0.9.0-debug/app-debug.apk))
  - Google Drive: `G:\My Drive\axiom-reader-debug.apk`

## Milestone Checkpoint — 2026-09-20 (Working State Saved)

- User confirmation: Physical device and watch playback working cleanly.
- Saved checkpoint tag: `v0.9.0-working-checkpoint`.
- Scope of progress locked:
  1. Decoupled remote playback commands from state notifications over `onTransportCommand`.
  2. Guarded voice-list refresh against stale asynchronous resolutions via `voiceListRevision`.
  3. ExoPlayer silence loop management for unobstructed phone default TTS.
  4. Media3 `ForwardingPlayer` transport command routing to WebView shell.
  5. Isolated voice preview via non-destructive `speakText` API.
- Next action: Address remaining issues to fix as specified by the user.

