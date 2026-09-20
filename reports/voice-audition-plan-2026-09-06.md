# AXIOM Reader voice audition

Prepared September 6, 2026. Status: audition design; no comparison results yet.

## Decision we are making

Can Azure Neural or Google Neural2 provide a voice you enjoy for long reading, with responsive playback and reliable sentence highlighting? Keep your current Chirp voice as the comparison. A possible earlier performance concern is a hypothesis to test, not an established reason for its selection.

The audition has two stages. First choose voices by listening, before opening an Azure account. Only voices you would actually use advance to an app test. A good demo is not proof of good performance in AXIOM Reader.

## Stage 1: choose by listening — about 15 minutes

### Candidates

| Service | Initial voices | Purpose |
| --- | --- | --- |
| Chirp 3 HD | Your currently preferred voice; record its exact name before starting | Familiar baseline |
| Azure Neural | Andrew Multilingual and Ava Multilingual | One male and one female candidate |
| Google Neural2 | en-US-Neural2-D and en-US-Neural2-F | One male and one female candidate |

These are a starting shortlist, not claims that they are each service's best voice. If neither candidate from a service appeals, allow one replacement from that service before rejecting it. Azure's initial choices must be the regular Multilingual Neural versions, without Dragon HD in their names. Record exact voice identifiers when generating the final test recordings.

### Where we listen

- Azure: [Speech Studio Voice Gallery](https://speech.microsoft.com/portal/voicegallery). Select the exact voice, open **Try it out**, and paste one sample at a time. We already opened this unsigned-in preview and entered a custom passage; its field allows 500 characters.
- Neural2: start with [Google's product demo](https://cloud.google.com/text-to-speech). Confirm that the exact Neural2 voice is selectable. If the demo does not expose it or requests account access, use the [official voice samples](https://cloud.google.com/text-to-speech/docs/voices) for an initial impression, then generate the shared passages through your existing Google account connection when available. Mark different-text samples as provisional; do not score them as an equal comparison.
- Chirp: use the same three passages with your usual voice. Existing recordings can be reused only if they contain that same text.

### Listening procedure

1. Use the same headphones or speakers in a quiet place. Start at normal speed, default speaking style, and a comfortable, similar perceived volume. A louder voice should not win simply because it is louder.
2. Use Samples 1, 2, and 3 in the companion passage file. Each fits Azure's 500-character preview field. All are invented test text, not source canon.
3. Rotate the listening order: Chirp/Azure/Google for Sample 1, Google/Chirp/Azure for Sample 2, Azure/Google/Chirp for Sample 3. Listen to both candidates within each alternative service. Take a brief break halfway through.
4. Give each voice the ratings below before discussing which company made it. Public demos expose names, so this first round is not a blind test.
5. Pick one Azure finalist and one Neural2 finalist. Compare these with Chirp once more at normal speed and at your usual faster reading speed. Use 1.5x as the faster test if you have no preference. When a demo lacks speed control, leave that comparison for Stage 2 rather than changing the sample text.

For every voice, answer: **Would I willingly listen to this for an hour?** A pleasant twenty-second sample is not enough by itself.

### Listening scorecard

Use 1 = poor, 3 = acceptable, 5 = excellent. Leave untested cells blank. Record exact mispronounced words and any missing, repeated, or invented content separately.

| Voice | Naturalness | Clear words and numbers | Pacing and pauses | Pleasant for long reading | Clear at faster speed | Would use for an hour? | Specific problems |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Current Chirp: ______ | | | | | | | |
| Andrew Multilingual | | | | | | | |
| Ava Multilingual | | | | | | | |
| Neural2-D | | | | | | | |
| Neural2-F | | | | | | | |

For the initial round, send exactly the same plain text to each service. Do not improve one voice with special instructions while leaving the others untouched. In a separate corrected round, use the same intended pronunciations and AXIOM Reader's pronunciation replacements for all finalists. Pronunciation mistakes can be fixable; dropped or invented words are a separate problem.

## Stage 2: test finalists in the reader — after account access is available

Azure needs an account connection for these app measurements. Neural2 needs to be added to the existing Google connection. These connections and the measurement controls are future implementation work, not completed by this plan. Preserve the existing Chirp option and saved reading work throughout.

### Separate provider delay from app delay

The reader currently groups text into recordings targeting 450 characters, with a 550-character limit between speech units. It also imposes its own limit of three new Chirp requests per minute. Those are app choices, not evidence of Google's current account limits. They can cause a pause even when the voice service is fast.

Measure these separately for each request:

| Measurement | Plain-English meaning |
| --- | --- |
| Press Play to first audible word | The delay you actually experience |
| App queue wait | Time waiting before the app is allowed to ask for more speech |
| Speech request to complete audio | Time spent asking for, generating, and receiving the recording; includes network travel |
| Audio ready to playback | Time the reader spends preparing and starting received sound |
| Audio duration | Length of the recording itself |
| Extra pause between recordings | Silence introduced by playback/generation, excluding a natural sentence pause already in the sound |
| Requests and characters generated | How much allowance the test actually used |

The current service's `durationMs` value measures request processing, not the duration of the speech. Do not use it as an audio timestamp or as the complete user waiting time.

### Fair performance procedure

1. Record date, voice identifier, device/browser version, network, provider region, account limits, text length, playback speed, and whether audio was generated now or reused. Use the same computer and connection for the direct comparison.
2. Test the same input chunks with all three finalists at normal speed, then the same audio at 1.5x. Begin with the existing 450/550-character grouping and the same number of recordings prepared ahead of playback.
3. For a small generation-speed check, use five distinct chunks from the long passage, in the same order for each service. Rotate provider order between rounds. Bypass only the audition's local saved-audio lookup to obtain fresh requests; never bypass provider limits. Record that remote provider caching, if any, is unknown.
4. Record the first request after the app's service has been idle separately from four immediate follow-up requests. Report the median (middle result), range, and each failure. This is a small practical sample, not a statistically precise service benchmark.
5. Read the complete long passage with new audio at normal speed, then perform a separate new-audio run at 1.5x. The faster run checks whether generation can keep up as the sound is consumed more quickly. Also replay saved audio at both speeds. **Saved audio** means the app reuses a recording rather than asking the provider to create it again. These saved replays should use no new speech allowance. Keep the speed-change method consistent and record whether speed changes alter the generated recording or only its playback.
6. Repeat the saved-audio playback on the actual phone. Generate one fresh phone run per finalist only if needed to resolve a phone-specific network or startup issue. Test at 320–390-pixel page widths, large text, and the phone's real screen size.
7. If one service struggles, allow one recorded adjustment to chunk size or how much sound is prepared ahead. Apply a comparable setup to the other services where supported, obey each account's limits, and show both before/after results. Do not confuse a tuned result with the original equal-settings test.

If delays are dominated by the app's request cap, label the result **app-limited**. If the account refuses requests, label it **account-limited**. Neither alone proves the voice model is slow. Test a restrained slower-connection condition only after ordinary Wi-Fi is satisfactory.

### Synchronization test

Use provider-supplied timestamps: positions within the recording where a sentence or word is spoken. Azure exposes word and sentence boundary information. For Neural2, request timing marks at sentence boundaries using SSML, Google's supported speech formatting instructions. Verify actual returned timestamps for the selected voice before relying on them. [Azure boundary events](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/how-to-speech-synthesis), [Google timing marks](https://docs.cloud.google.com/text-to-speech/docs/ssml#ssml_timepoints).

Compare sentence-level following for both alternatives. Azure's word-level data is an optional extra; Neural2 does not need word highlighting to pass. Chirp's current missing intermediate timings are the known baseline, not a newly measured voice-quality defect.

Follow the recording's playback position, not a timer that continues while audio is paused. Cache the timings with the exact audio and the mapping from spoken text back to displayed text. Replacements such as an acronym expanded into several spoken words must still highlight the correct original sentence.

Exercise all of these:

- Advance within one long paragraph that extends below the screen.
- Cross paragraph, heading, list, and table boundaries in the existing reader usability sample.
- Pause for five seconds, resume, change speed, jump forward and backward, then stop.
- Scroll away manually: following stays suspended. Press Resume following: return to the current sentence.
- Add a note while paused; search the document; confirm saved notes and highlights still refer to the same passages.
- Stop while new audio is being prepared: nothing should restart later.
- Disconnect the network during saved-audio playback, then during a request for new audio. Record the result and recovery message separately.

At twelve sentence starts spread across the long passage, compare audible onset to the highlight change using a screen recording with captured audio. Include the first, middle, and last sections and post-pause/post-speed-change points. If the recording cannot capture both, report a subjective listening check, not measured millisecond precision.

### Proposed acceptance targets

These are our starting usability targets, not vendor promises or published industry standards.

| Requirement | Target |
| --- | --- |
| Listening comfort | You would use it for an hour; comfort rating at least 4/5 |
| Text fidelity | No omitted, duplicated, or invented sentences in the test |
| Fresh playback start on ordinary Wi-Fi | Median at most 3 seconds; no unexplained start over 5 seconds in the small sample |
| Saved-audio playback start | At most 0.5 seconds on the tested device |
| Continuous reading | No extra wait over 0.5 seconds between recordings once playback is established |
| Sentence highlighting | At least 11 of 12 measured sentence starts within 0.3 seconds of speech; none more than 0.75 seconds off |
| Scrolling | Current spoken sentence stays visible while following is on, below/above fixed controls; no jumping during manual browsing or note entry |
| Control behavior | Pause, resume, speed changes, stop, and passage jumps remain correct |
| Existing review features | Notes, saved highlights, search, pronunciation replacements, and audio export still work |

Any failure gets a cause and a retest after a relevant fix. Do not average away missing text, broken controls, or an unusable voice with a high overall score. Background/screen-off playback remains a separate device capability test; a different cloud voice alone does not establish that it works.

### Performance record

| Finalist | Fresh start: median/range | Saved start | Extra gap count / longest | Highlight checks passed / 12 | Long-reading comfort | Errors and cause | Generated characters |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Chirp: ______ | | | | | | | |
| Azure: ______ | | | | | | | |
| Neural2: ______ | | | | | | | |

Keep the individual request measurements alongside this summary. A result without the device, voice, settings, and new-versus-saved status is incomplete.

## Allowance and final decision

Target fewer than 50,000 newly generated text characters across all services for the core audition. Track actual usage separately for each provider; retries and speech-formatting overhead can change the total. Reuse sound for repeat listening and faster playback. If resolving a failure would exceed the planned usage, report the remaining test and revised estimate first. A free monthly allowance may already be partly used; verify remaining account usage before generating connected tests.

If both alternatives pass, you choose between the voices you prefer. Use waiting time and long-reading comfort as tie-breakers. If Neural2 and Azure are otherwise equal, retaining the existing Google account is a practical simplification. If only one passes, keep Chirp available and use that alternative for synchronized reading. If neither sounds acceptable, preserve Chirp and investigate adding timing information to its existing recordings.

The next action is Stage 1: audition the five voices with the three short passages and fill in the listening scorecard. No account signup or application change is needed just to prepare this comparison.
