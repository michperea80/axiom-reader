# Reader UI and synchronized narration

The supplied Claude artifact was opened and visually inspected, including its reader, library, and settings screens. The local changes adopt its document-focused layout while preserving AXIOM Reader’s existing cloud voices and review tools.

## What caused the reported lag

The browser reader groups several spoken units into one cloud audio recording (currently targeting 450 characters, with a 550-character limit between units). `speakAdvanced()` highlights only the first unit’s block. It advances `idx`, the saved reading position, after the whole recording finishes. No code updates the active passage during that recording.

Separately, the old mobile styles made the document grow with the page instead of using its intended scrollable reading area. The visibility check then compared text against the whole expanded document. A large paragraph or a group of paragraphs can extend far beyond the visible screen.

The sibling `axiom-tts-proxy/api/tts.js` now has a local Neural2 path. Chirp and Gemini keep their existing request behavior; Neural2 uses the same Google key and adds sentence timepoints to the response and cache.

## Established options

| Approach | Accuracy and fit | Tradeoff |
| --- | --- | --- |
| Local speech start/boundary events | The browser reports when a sentence starts, and some voices also report word boundaries. Sentence following works with the existing local voices. | Word events vary by browser and voice. [Browser speech documentation](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesisUtterance/boundary_event). |
| Timing supplied with generated speech | Best direct route: keep audio plus the provider’s character/word timestamps together. ElevenLabs, for example, documents speech output with character alignment. | Requires another supported provider/voice path and a separate cost comparison. [Provider documentation](https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps). |
| Align the existing recording to its known transcript | **Forced alignment** means matching the known text to the actual sound and producing timestamps. This can preserve Chirp/Gemini voices and long, natural recordings. | Adds processing time and hosting or service cost. Must validate names, pronunciation substitutions, numbers, and missing words. [WhisperX](https://github.com/m-bain/whisperX) and [aeneas](https://github.com/readbeyond/aeneas) are existing implementations to evaluate, not newly invented scrolling algorithms. Neither was installed or benchmarked here. |
| Generate one sentence per recording | Sentence starts are known exactly because each recording contains one sentence. | More requests and potentially audible gaps. Under the current client caps of 3 new Chirp requests/minute and 1 Gemini request/minute, ordinary sentences may finish long before another request is allowed. Not a good default for continuous uncached reading. |
| Divide audio duration proportionally between words or sentences | Can advance the screen without changing the service. | This is an estimate. Pauses, emphasis, numbers, and rewritten pronunciation can cause drift. It should be labeled approximate, not represented as synchronized speech. No such estimate was added. |

**WebVTT** is a standard format that pairs text with start/end times. It provides a suitable timed-text representation once real timestamps exist; it does not discover the timestamps itself. [W3C specification](https://www.w3.org/TR/webvtt1/).

Google documents timing marks for supported speech models, but Chirp 3 HD’s current supported markup list does not include `mark`, and unsupported elements are ignored. Adding timing tags to the current request is therefore not a verified fix. [Chirp documentation](https://docs.cloud.google.com/text-to-speech/docs/chirp3-hd), [Google timing marks](https://docs.cloud.google.com/text-to-speech/docs/ssml).

## Implemented Google Neural2 direction

The Reader and its existing Google proxy now support Neural2 as a separate choice. The proxy inserts an SSML `<mark>` before each spoken sentence and asks Google for `SSML_MARK` timepoints through the v1beta1 synthesis method. Google defines each returned timepoint as a named position and an offset in seconds from the beginning of the generated audio. [Google v1beta1 synthesis reference](https://docs.cloud.google.com/text-to-speech/docs/reference/rest/v1beta1/text/synthesize), [Google SSML mark documentation](https://docs.cloud.google.com/text-to-speech/docs/ssml#mark).

The service returns and caches audio plus sentence timings and the exact spoken segments used to produce them. The Reader selects the active sentence from the **audio playback clock**, which is the browser's position inside the recording. This keeps timing tied to the actual sound through pauses and tab suspension. It validates sentence numbers, order, and recording duration, ignoring invalid marks rather than showing a false position. Audio-only Chirp, Gemini, and old cache entries retain their previous chunk-level fallback.

The production proxy was deployed at revision `70be97a`. Live US Neural2 D, UK Neural2 B, and Default/Lively versions of US Neural2 F and J each returned playable audio and all 8 requested sentence marks. Their marks were ordered and fell within the recording duration. Google documents Lively as a preview style available only on Neural2 F and J, so the Reader exposes it only for those supported voices. The installed Reader still needs its own publication followed by a long-passage listening check for paragraph transitions, pauses, pronunciation substitutions, speed changes, stopping, jumping, and resuming.

## Local changes

- More reading space; a collapsible side panel; persistent bottom playback controls on desktop and mobile.
- Header search and review shortcuts, review counts/status, and bottom-bar note/highlight shortcuts connect to existing actions.
- Sentence-level local-voice highlighting uses standard browser text ranges, preserving inline formatting, search markup, and block-based note anchors. [Browser highlighting documentation](https://developer.mozilla.org/en-US/docs/Web/API/CSS_Custom_Highlight_API).
- A consistent document scrolling area; Follow audio / Resume following; manual scrolling suspends following; reduced-motion preferences suppress smooth scrolling.
- Working text-size, classification-header skip, and hold-to-annotate settings. The header setting applies on the next file opening.
- Library drag-and-drop for supported files, keyboard access to recent files, and a corrected recent-file count.
- Existing folder/file opening, PDF extraction, review status, notes, highlights and their original labels, search, export filters, pronunciation import/export, backup/restore, cloud settings/login, audio downloads, and sentence jumps retained. The reference’s system-only voice simplification did not replace the existing cloud functionality.
- Fixed an undefined Gemini playback speed value and prevented late cloud errors from starting narration after cancellation.
- Replaced visual-frame-only sentence tracking with a 50-millisecond check against the audio clock. This prevents embedded or backgrounded readers from falling behind when the browser pauses screen repaint callbacks.

The existing saved work in `js/tts.js`, icon, manifest, and service worker was preserved. The sibling voice-service project was published through its existing GitHub-to-Vercel connection without copying provider credentials onto this computer.

## Verification

The local test page at `tests/reader-check.html` uses synthetic text and a silent generated-audio fixture. Eighteen browser checks passed. The added checks validate Neural2 timing data, keep the Default and Lively selections and saved recordings distinct, confirm Google-generated speed is not applied a second time in the browser, show the highlight moving to later sentences during one recording, and confirm that a timed below-screen sentence scrolls into view. The original checks for sentence mapping, manual-follow suspension, scrolling, cancellation, search, saved positions, complete cloud grouping, Gemini speed, and stop cleanup still pass.

Those checks exercise the actual browser audio setup with a synthetic recording and simulated Google timepoints. Production generation was separately verified for each of the four F/J profiles; it does not replace an end-to-end listening judgment about synchronization or voice quality. The settings panel was visually inspected with F and J Default/Lively choices, the other US and UK Neural2 choices, and its timed-following explanation visible. Actual listening remains the release check.

Desktop screenshots were inspected. A phone-width screenshot exposed overlapping playback labels; the correction was verified using browser element measurements at 390 and 320 pixels. At 320 pixels the document width equals the page width and the position, follow, previous, play, and next controls occupy separate in-bounds rectangles. Further mobile screenshot capture timed out, so full final mobile visual approval is not claimed. JavaScript syntax checks and the check for duplicate or missing control IDs passed.

The new reading preferences were exercised in the browser: Large rendered document text at 23px; turning header skipping off made the classification block readable and changed the sample from 32 to 33 spoken units. Defaults were restored after verification. Saved passages now include text/block anchors so this setting does not shift future saved positions.
