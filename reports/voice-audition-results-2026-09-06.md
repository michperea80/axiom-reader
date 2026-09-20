# Voice audition session record

Status: Stage 1 underway. Ava remains acceptable, Andrew was rejected, and Google Neural2 is now the active implementation candidate for synchronized reading. No finalist has been selected.

## Confirmed listener preference

The listener usually uses male Charon in both US and UK English. Baselines are en-US-Chirp3-HD-Charon and en-GB-Chirp3-HD-Charon.

## Current session

| Voice | Material | Status | Listener feedback |
| --- | --- | --- | --- |
| Charon US | Shared Sample 1, 335 characters | Prepared in Google's public demo; generation paused for a human verification check | Not rated |
| Charon UK | Shared passages | Pending | Not rated |
| Azure Andrew Multilingual | Shared Sample 1, default style, English (United States) | Listener confirmed hearing the replay | "Yes—but I don’t like the voice." Do not advance Andrew unless the listener changes this preference. No numeric score supplied. |
| Azure Ava Multilingual | Shared Sample 1, default style, English (United States) | Listener confirmed preference after preview | "Keep Ava in the audition." Continue with explanatory and pronunciation passages. No numeric score supplied. |
| Azure Ava Multilingual | Shared Sample 2, 364 characters, default style, English (United States) | Deferred while the existing Google connection is tested | Listener says Ava sounds fine. Azure remains in the audition, but no Azure signup or key is needed now. |
| Google Neural2-D (US male) | Shared Sample 1 | Generated through the production proxy: 20.76 seconds with 8 ordered sentence marks | Listener said the Neural2 samples sound okay. |
| Google Neural2-B (UK male) | Shared Sample 1 | Generated through the production proxy: 20.88 seconds with 8 ordered sentence marks | Listener said the Neural2 samples sound okay. |
| Google Neural2-F (US female), Default | Shared Sample 1 | Generated through the production proxy: 22.43 seconds with 8 ordered sentence marks | Ready to audition |
| Google Neural2-F (US female), Lively | Shared Sample 1 | Generated through the production proxy: 22.47 seconds with 8 ordered sentence marks | Ready to audition |
| Google Neural2-J (US male), Default | Shared Sample 1 | Generated through the production proxy: 21.60 seconds with 8 ordered sentence marks | Ready to audition |
| Google Neural2-J (US male), Lively | Shared Sample 1 | Generated through the production proxy: 21.88 seconds with 8 ordered sentence marks | Ready to audition |

## Access findings

- Google's current public product demo exposes Gemini and Chirp models, with no Neural2 model selector. Neural2's official samples are available in the [voice catalog](https://docs.cloud.google.com/text-to-speech/docs/list-voices-and-types). Different-text samples count only as a provisional impression, not an equal reading comparison.
- Google's Charon demo presented an "I'm not a robot" check. It has not been completed by the assistant.
- Azure Andrew's custom-text preview is available without an Azure account. Clicking Play and seeing its active-playback state is not evidence that the listener heard the audio; that requires listener confirmation.
- No Azure account has been created. The Reader now offers Neural2 through the same protected Google proxy used by Chirp, so it requires no new voice-provider key.
- Neural2 uses Google SSML sentence marks and returned timepoints. A local browser fixture verified that these marks move the highlighted sentence while a single multi-sentence recording is still playing.
- Google's current SSML documentation lists Lively as a preview speaking style supported by `en-US-Neural2-F` and `en-US-Neural2-J`. The Reader therefore offers Default and Lively profiles for those two voices without showing an unsupported Lively choice on other voices.
- Vercel deployed proxy revision `70be97a` successfully. All four F/J Default and Lively requests returned playable audio and all 8 requested timing marks. Production measurements are stored in `reports/audio/neural2-style-live-results.json`.

## Next actions

Compare Neural2 F Default with F Lively, then J Default with J Lively. Choose which profiles should remain visible in the finished Reader. Then publish the Reader changes and run the long-passage test in the installed app, checking that the highlight reaches each sentence when the voice does and that below-screen sentences scroll into view. Keep Ava available as the Azure comparison, but defer Azure signup unless its remaining audition materially outperforms Neural2.
