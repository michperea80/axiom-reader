# Current work — AXIOM Reader

## Icon Refresh — 2026-09-20

- **Requested Objective**:
  Update all app icons, notification icons, launcher icons, adaptive foregrounds, and PWA icons using refreshed assets from `New Icons` (`Notification.png`, `icon_192x192.png`, `icon_512x512.png`).
- **Implementation**:
  - Executed `mobile/scripts/update-icons.ps1` using high-quality bicubic resampling.
  - Updated PWA web icons: `icons/icon-192.png`, `icons/icon-512.png`.
  - Updated Android Auto / MediaSession artwork: `res/drawable/app_icon.png` (512x512).
  - Updated notification icons: `res/drawable/ic_notification.png` and density buckets `mdpi` (24x24), `hdpi` (36x36), `xhdpi` (48x48), `xxhdpi` (72x72), `xxxhdpi` (96x96).
  - Updated launcher and round icons across all densities (`mdpi` 48px to `xxxhdpi` 192px).
  - Updated adaptive launcher foregrounds with centered safe zone across all densities (`mdpi` 108px to `xxxhdpi` 432px).
- **Affected Files**:
  - `icons/icon-192.png`, `icons/icon-512.png`
  - `mobile/android/app/src/main/res/drawable/app_icon.png`
  - `mobile/android/app/src/main/res/drawable*/ic_notification.png`
  - `mobile/android/app/src/main/res/mipmap*/*`
- **Verification & Deployment**:
  - Synced web assets (`npm run sync`) and compiled APK (`assembleDebug`) with `BUILD SUCCESSFUL in 10s`.
  - Installed via ADB to connected Samsung Galaxy Z Fold (`RFGL742NXQV`).
  - Copied to Google Drive: `G:\My Drive\axiom-reader-debug.apk`.
- **Next Action**:
  - Real-world in-car verification with Android Auto vehicle system.

## Android Auto & Wear OS Remote Wakeup & Resumption Resolution — 2026-09-20

- **Requested Objective**:
  Ensure pressing the **Play** button on the Android Auto Desktop Head Unit (DHU) emulator, car screen, or Wear OS watch reliably wakes up AXIOM Reader and resumes audio playback, even after being paused, put to sleep, or closed in the foreground.
- **Root Causes Diagnosed & Resolved**:
  1. **Cold-Start TTS Initialization Deadlock**:
     - When woken up by remote Play without an existing service process, `initTextToSpeech` was initializing asynchronously while `play()` set `isPlaying = true`. When TTS finished initializing 300ms later, its callback re-invoked `play()`, which immediately aborted on `if (isPlaying) return;`. The current sentence was never spoken.
     - Resolved in `AxiomMediaPlaybackService.java`: `initTextToSpeech` callback now directly invokes `speakCurrentSentence()` when `isPlaying` is true. Additionally, `play()` verifies whether TTS is ready and immediately speaks if active utterance is pending.
  2. **Remote Play Enforced Native Audio Ownership**:
     - Remote Play commands (`dispatchTransportPlay(true)`) previously checked `if ("native".equals(playbackOwner) || eventListener == null)`. When a cloud voice had recorded `"playbackOwner": "web"` in `active_queue.json`, remote play only looped silence and sent an event to the sleeping/locked WebView, which could not play Web Audio.
     - Resolved: Remote transport commands from Android Auto, Wear OS, lock screen, and Bluetooth headsets now unconditionally assign `playbackOwner = "native"` and call `play()`, ensuring robust native speech through car/watch speakers without WebView dependency.
  3. **Media3 State Synchronization via `ForwardingPlayer`**:
     - `ForwardingPlayer.play()`, `pause()`, and `setPlayWhenReady()` now invoke `super.play()`, `super.pause()`, and `super.setPlayWhenReady()` so ExoPlayer's `playWhenReady` updates immediately, ensuring Media3 controllers on Android Auto and Wear OS receive prompt state confirmations.
  4. **Decoupled Web Shell Remote Transport Handling**:
     - `tts.js` `transportCommand` listener now updates UI state (`setBtn`, `playing`, `updateMediaSession`, and sentence highlighting) without re-invoking `startTTS()`, eliminating competing synthesis loops and queue wipes.
  5. **Notification Channel & TTS Stream Warning Fixes**:
     - Reordered `onCreate()` so `initNotificationProvider()` runs before `initMediaSession()`, binding notifications to `axiom_playback_channel` instead of falling back to default.
     - Changed `KEY_PARAM_STREAM` in `Bundle params` to Integer `AudioManager.STREAM_MUSIC`, removing Android system warnings.
     - Added `startPauseGracePeriod()` to `restoreQueueFromDisk()` to preserve foreground eligibility on disk restoration.
- **Affected Files**:
  - `mobile/android/app/src/main/java/com/axiom/reader/playback/AxiomMediaPlaybackService.java`
  - `mobile/android/app/src/main/AndroidManifest.xml`
  - `js/tts.js`
  - `sw.js`
- **Verification Evidence**:
  - Automated Tests: `node tests/playback-control-regression.cjs` PASS (5/5).
  - Native Compilation: `npm run sync` and `.\gradlew.bat assembleDebug` succeeded with `BUILD SUCCESSFUL in 11s`.
  - Device Installation: Streamed install to Samsung Galaxy Z Fold (`RFGL742NXQV`) succeeded.
  - Runtime Wakeup Verification:
    - Force-stopped app (`am force-stop com.axiom.reader`).
    - Dispatched `cmd media_session dispatch play` to cold-started service.
    - Verified logcat: service started, restored queue from disk (985 items), acquired `PARTIAL_WAKE_LOCK`, requested `USAGE_MEDIA` focus, initialized TTS, and spoke sentence 9 immediately (`tts.speak sentence 9 (length 138), result: 0`, `TTS utterance onStart: utt_1_9`).
    - Verified progression: sentence 9 finished (`onDone`) and sentence 10 spoke automatically.
    - Verified pause: `dumpsys activity services` confirmed service remains `isForeground=true` on `channel=axiom_playback_channel` with `flags=ONLY_ALERT_ONCE|NO_CLEAR|FOREGROUND_SERVICE actions=3 vis=PUBLIC`.
    - Verified resume: Dispatched `cmd media_session dispatch play` while paused; resumed sentence 10 immediately without hesitation.
    - Verified track navigation: Dispatched `cmd media_session dispatch next` -> `play`; advanced to sentence 11 and spoke immediately.
  - Distribution: Copied updated APK to `G:\My Drive\axiom-reader-debug.apk`.
- **Next Action**:
  - Verify physical car / Desktop Head Unit (`mobile/run-dhu.bat`) and Wear OS watch playback resumption.

- **Requested Objective**:
  Enable tapping the **Play** button on the Android Auto Desktop Head Unit (DHU) emulator, car screen, or Wear OS watch to wake up AXIOM Reader and resume playback even after the app has been closed or put to sleep by Android OS in the foreground/background.
- **Root Cause & Technical Implementation**:
  1. **Manifest Wakeup**: Added `<action android:name="android.intent.action.MEDIA_BUTTON" />` to `AxiomMediaPlaybackService` in `AndroidManifest.xml` so Android OS routes hardware and controller media events to the service when stopped.
  2. **Native Queue Disk Persistence**: Added asynchronous disk persistence (`active_queue.json` in internal files) whenever `loadQueue()` is called, along with microsecond `SharedPreferences` sentence index tracking (`current_index`) updated on every sentence completion and seek.
  3. **Headless Native Resumption (`onPlaybackResumption` & `onMediaButtonEvent`)**:
     - Implemented `onPlaybackResumption` and `onMediaButtonEvent` in `MediaLibrarySession.Callback`.
     - When invoked without an active WebView (`eventListener == null`), the service automatically restores `queueItems` from disk, falls back to `playbackOwner = "native"`, requests audio focus (`USAGE_MEDIA` / `CONTENT_TYPE_SPEECH`), and begins speaking immediately via Android native `TextToSpeech` (or streaming cloud audio via ExoPlayer) through car/HUD speakers.
  4. **State Synchronization**: Added `@PluginMethod getPlaybackState` to `AxiomPlaybackPlugin.java` and `getNativePlaybackState()` to `playback-bridge.js` so when the phone app is reopened, the UI seamlessly syncs to the active sentence position.
- **Affected Files**:
  - `mobile/android/app/src/main/AndroidManifest.xml`
  - `mobile/android/app/src/main/java/com/axiom/reader/playback/AxiomMediaPlaybackService.java`
  - `mobile/android/app/src/main/java/com/axiom/reader/AxiomPlaybackPlugin.java`
  - `js/bridge/playback-bridge.js`
- **Verification Evidence**:
  - Automated tests: `node tests/playback-control-regression.cjs` PASS.
  - Native build: `npm run sync` and `.\gradlew.bat assembleDebug` completed with `BUILD SUCCESSFUL in 8s`.
  - Deployment: Streamed install via ADB to physical device `RFGL742NXQV` (`app-debug.apk`), successfully updated `G:\My Drive\axiom-reader-debug.apk`.
  - Runtime verification: Logcat confirms `AxiomMediaPlaybackService` creation, disk queue restore check, and native `TextToSpeech` initialization with `USAGE_MEDIA`.
- **Next Action**:
  - Test tapping Play on the Desktop Head Unit (`mobile/run-dhu.bat`) or watch after pausing and putting phone to sleep or closing the app.

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

## Android Auto & New Icons Update — 2026-09-20

- Objective:
  1. Fix Android Auto closing when pausing playback (prevent `ForwardingPlayer` from dropping to `STATE_IDLE`).
  2. Fix missing app icon and artwork in Android Auto (`app_icon.png` raster artwork on MediaItems and service attributes).
  3. Fix audio routing through car speakers on initial launch (acquire `AUDIOFOCUS_GAIN` on `USAGE_MEDIA` / `CONTENT_TYPE_SPEECH`).
  4. Integrate correct application and notification icons from `New Icons` across all density buckets and web assets.
  5. Note low-priority backlog bug: Legacy phone default voice cannot be controlled from watch ("nothing playing").
- Affected files:
  - `mobile/android/app/src/main/res/drawable/ic_notification.png` & densities: White monochrome notification icon generated from `Notification.png`. Old `ic_notification.xml` removed.
  - `mobile/android/app/src/main/res/drawable/app_icon.png`: 512x512 raster PNG for MediaSession / Android Auto artwork.
  - `mobile/android/app/src/main/res/mipmap-*/`: Generated launcher, round, and adaptive foreground icons from `icon_512x512.png`.
  - `mobile/android/app/src/main/res/values/ic_launcher_background.xml`: Set background to `#000000`.
  - `mobile/android/app/src/main/AndroidManifest.xml`: Added `icon`, `roundIcon`, and `label` to `AxiomMediaPlaybackService`.
  - `mobile/android/app/src/main/java/com/axiom/reader/playback/AxiomMediaPlaybackService.java`:
    - `ForwardingPlayer.getPlaybackState()` returns `STATE_READY` on pause (when queue is loaded).
    - `getAppIconUri()` sets raster `app_icon.png` artwork on root, categories, passages, and active track metadata.
    - Explicit AudioFocus management via `AudioManager` and `AudioFocusRequest` with `USAGE_MEDIA` / `CONTENT_TYPE_SPEECH` to route vehicle audio directly to car speakers on launch.
  - `icons/icon-192.png`, `icons/icon-512.png`: Updated PWA web icons.

## Audio Focus Regression Fix & Wear OS Legacy Voice Resolution — 2026-09-20

- Objective:
  1. Fix rapid play/pause button flashing and audio failure on phone and Android Auto (Desktop Head Unit & vehicle).
  2. Resolve audio focus conflict between ExoPlayer internal focus handler and service `AudioManager.requestAudioFocus()`.
  3. Ensure Android Auto and Wear OS (Pixel Watch) stay active and responsive during both Cloud and Legacy Phone Default TTS playback.
- Root Cause & Resolution:
  1. **Audio Focus Conflict Loop**: In commit `eb17efd`, ExoPlayer was configured with `setAudioAttributes(..., true)` while the service simultaneously registered a manual `AudioFocusRequest` with an `OnAudioFocusChangeListener`. When `player.play()` was called, ExoPlayer requested focus from `AudioManager`, causing Android's `AudioService` to send `AUDIOFOCUS_LOSS (-1)` to the service's listener. The listener immediately called `dispatchTransportPlay(false)`, pausing playback within 8ms and causing a rapid flashing loop between play and pause. Resolved by reverting ExoPlayer's `handleAudioFocus` to `false` so the service manages the single unified `AudioFocusRequest`, and guarding the focus loss listener with `if (isPlaying)`.
  2. **Active Silence Keepalive for Local TTS**: In `speakCurrentSentence()`, previously ExoPlayer was paused during local TTS, leaving MediaSession with no active playing track and causing Wear OS to report "nothing playing" and Android Auto to drop the active car audio channel. Resolved by calling `ensureSilencePlaying()` during local TTS so ExoPlayer's silent AudioTrack loops seamlessly while Android TTS speaks over `STREAM_MUSIC`, keeping MediaSession, Wear OS, and Android Auto in the `playing` state.
- Affected files:
  - `mobile/android/app/src/main/java/com/axiom/reader/playback/AxiomMediaPlaybackService.java`:
    - `initPlayer()`: Set `handleAudioFocus = false` to prevent self-preemption.
    - `audioFocusChangeListener`: Added `if (isPlaying)` guard to prevent spurious pauses.
    - `speakCurrentSentence()`: Maintained `ensureSilencePlaying()` during local TTS for MediaSession/Watch/Auto continuity.
## Pause Sleep & Lock Screen/Notification Persistence Resolution — 2026-09-20

- Objective:
  1. Prevent the app from being put to sleep after being paused for a few minutes.
  2. Prevent phone playback controls from closing out in the notification bar and lock screen on pause.
  3. Ensure pressing play on the Wear OS watch or Android Auto HUD reliably resumes playback even after minutes of screen-off pause.
- Root Cause & Resolution:
  1. **Foreground Service Dropped on Pause**: Media3's default `MediaSessionService.onUpdateNotification` called `stopForeground(false)` when `playWhenReady == false`. On modern Android (especially Samsung One UI), dropping out of foreground causes the app to transition to cached/frozen state within 2 minutes of screen-off, and SystemUI drops the media notification from the lock screen and notification bar. Resolved by overriding `onUpdateNotification` to keep the service in the FOREGROUND (`shouldBeForeground = true`) during an active 20-minute **pause grace period** whenever a document is loaded.
  2. **Samsung App Freezer & CPU Sleep**: `releaseWakeLock()` was being called immediately on pause, allowing the CPU to suspend and Chromium's background WebView JavaScript to freeze. When the watch or HUD sent a play command, `dispatchTransportPlay` routed to a suspended WebView, failing to resume. Resolved by keeping `dispatchTransportPlay` self-sufficient: acquiring a wake lock immediately, directly calling `play()` in native TTS mode, and looping silence in web mode to wake up the audio pipeline and WebView.
  3. **Premature Termination on `onTaskRemoved`**: Media3's default `onTaskRemoved` called `stopSelf()` if playback was not ongoing. Overrode `onTaskRemoved` to ensure the service is never terminated while a document queue is loaded.
  4. **Lock Screen Visibility**: Configured `channel.setLockscreenVisibility(VISIBILITY_PUBLIC)` on `axiom_playback_channel` so notification controls remain accessible on the lock screen.
- Affected files:
  - `mobile/android/app/src/main/java/com/axiom/reader/playback/AxiomMediaPlaybackService.java`:
    - Added `startPauseGracePeriod()`, `cancelPauseGracePeriod()`, and 20-minute timeout runnable.
    - Overrode `onUpdateNotification` to retain foreground status while paused with a loaded document.
    - Overrode `onTaskRemoved` to prevent service termination when recent tasks are swiped or trimmed.
    - Updated `dispatchTransportPlay` to acquire wake lock, cancel pause timeout, and execute native `play()` directly.
    - Set `channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC)`.
- Verification evidence:
  - Automated tests: `tests/playback-control-regression.cjs` passed (5/5 PASS).
  - Native build: `npm run sync` and `.\gradlew.bat assembleDebug` succeeded (`BUILD SUCCESSFUL in 11s`).
  - Device install: Streamed install via ADB to Samsung Galaxy Z Fold (`RFGL742NXQV`).
  - Dumpsys verification: `dumpsys notification` confirmed notification `id=1001` remains in `flags=ONLY_ALERT_ONCE|NO_CLEAR|FOREGROUND_SERVICE` and `vis=PUBLIC` while paused.
  - MediaSession resume verification: Dispatched `play` -> `pause` -> waited -> dispatched `play` via `adb shell cmd media_session dispatch`. Logcat confirmed immediate CPU wakeup, `dispatchTransportPlay`, and audio playback resumption.
  - Distribution: Copied updated APK to `G:\My Drive\axiom-reader-debug.apk` and uploaded to GitHub release `v0.9.0-debug`.




