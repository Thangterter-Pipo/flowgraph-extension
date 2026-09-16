# Stitch blocker investigation — Papi → Pipo

## Outcome

Browser check and signal check PASS with an isolated-headless fixture fix. Production engine unchanged; its 0.25-second source drift guard remains intact. Typecheck and all 13 scoped unit tests PASS. This is not a claim of independent review approval or live-production acceptance.

## Root cause evidence

The native headless audio output path on this Windows host can report AudioContext state `running` while the render clock barely advances. The first unmodified run passed all three transitions and signal checks, so this is intermittent/environment-sensitive, not a deterministic timeline calculation failure.

After adding a real AudioContext diagnostic (no mocked APIs), the native run reproduced the reported production failure verbatim: source 1 expected 0.260s, decoded 0.000s, ready 4, audio 0.000s, paused false. Its diagnostic context advanced only 0.032s during 0.5055s wall time. A later explicit native A/B run advanced 0.040s during 0.5107000000001862s and failed the new clock assertion.

Changing only the isolated Chrome launch to include `--disable-audio-output` made browser and decoded-signal checks pass. Two runs with that flag passed all three transitions. The final clock probe advanced 0.4106666666666667s during 0.5075s wall time, at 48000Hz, HeadlessChrome/152.0.0.0. The recorded MediaStream retained real source tones, so disabling physical output did not substitute silent or invented output.

This isolates the dependency to the headless native output/render-clock path. It does NOT identify a particular Windows driver, physical device, or Chrome internal defect; no host audio settings were changed. An external source lookup was unavailable because web search is not configured, so these conclusions rely on actual local A/B execution rather than an unverified Chromium documentation claim.

## Changes

- `flowgraph-extension/tests/stitch-browser-entry.ts:9`: add `audioClock()`, using a real oscillator, zero-gain graph, hardware destination and MediaStream destination. Return actual audio/wall elapsed time, state, sample rate and user agent; clean up nodes, stream tracks and context. The oscillator is diagnostic only and never enters stitch artifacts.
- `flowgraph-extension/tests/stitch_browser_check.py:40`: default isolated test Chrome to `--disable-audio-output`. `STITCH_NATIVE_AUDIO=1` opts out for controlled diagnosis; no live Chrome profiles or tabs are attached.
- `flowgraph-extension/tests/stitch_browser_check.py:81`: persist and print clock evidence, including flags. Reject an audio/wall mismatch of 0.25s or more, rather than trusting `state == running` or a tiny nonzero increment.
- No production code or integration contract changed. No tolerance in existing engine, browser duration, signal color or signal tone assertions was loosened.

## Production engine analysis

`BrowserStitchEngine.ts:99-115` resumes AudioContext and connects per-video audio through recording destination plus silent monitor to the native output. `state == running` alone is not sufficient evidence of rendering, as demonstrated above. The current source guard at lines 175-176 correctly rejects stalled decoded media instead of emitting a successful artifact. It uses a wall-clock timeline and validates decoded source progress; switching to a stalled audio clock would hide the problem and was deliberately not done. Existing cancellation and cleanup remain unchanged.

The fixture adjustment fixes isolated-headless validation, not arbitrary production audio-device failures. Production remains fail-closed when media/audio stalls. Live source tabs and production extension execution were explicitly out of scope and were not touched.

## Commands and results

Working directory: `E:/Flow_veo/flowgraph-extension`.

1. `npx esbuild tests/stitch-browser-entry.ts --bundle --outfile=.stitch-test/bundle.js` — PASS; final bundle 21.6kb.
2. `STITCH_NATIVE_AUDIO=1 python tests/stitch_browser_check.py` — expected diagnostic FAIL, real audio 0.040s / wall 0.5107000000001862s, state running. This validates that the new assertion detects the observed stall; not a mock.
3. `python tests/stitch_browser_check.py` — PASS with fixture flag. Fail-closed codes: MEDIA_FAILED, MEDIA_FAILED, MEDIA_FAILED, CANCELLED. All outputs contain audio and video, finite duration, and advance on playback. IndexedDB reload bytes identical.
4. `python tests/stitch_signal_check.py` — PASS for cut, crossfade and crossfade_1s. Ordered decoded colors: [253,0,0], [1,128,2], [0,0,253], [254,255,0]. All four original tone checks and all crossfade two-tone/blend checks passed.
5. `npm run typecheck` — PASS (`tsc -b --pretty false`).
6. `npx vitest run tests/unit/StitchTimeline.test.ts tests/unit/StitchIntegration.test.ts tests/unit/VideoConcatExecutor.test.ts` — PASS: 3 files, 13 tests.

Final artifacts:

| Transition | Declared duration | Packet-derived duration | Bytes |
|---|---:|---:|---:|
| cut | 13.032s | 13.050s | 339704 |
| crossfade | 11.532s | 11.535s | 336006 |
| crossfade_1s | 10.032s | 10.044s | 323651 |

Evidence/artifacts: `E:/Flow_veo/flowgraph-extension/.stitch-test/audio-clock-evidence.json`, `evidence.json`, `signal-evidence.json`, and the three transition `.webm` files. Files are local generated color/tone fixtures, not production media receipts. Evidence JSON describes the latest passing run; native failure values above were captured from actual terminal output.

## Remaining risks / limits

- FFprobe and FFmpeg emit `Error parsing Opus packet header.` for each recorded artifact. This was already present in the first unmodified passing run. The existing signal check records decoder stderr but does not fail on it. All tone, blend, duration, playback and persistence assertions passed, but this is NOT a warning-free mux/codec result. The warning's cause remains uninvestigated; no claim of full packet integrity or absence of audible artifacts is made.
- Constant-color fixtures validate order and blend, not detailed moving-frame fidelity. Signal checks sample tones, not every audio sample.
- Native-device behavior remains intermittent; no physical-device repair or live-tab verification attempted.
- No full repository test suite or production build run; only requested checks and scoped unit tests. Build would touch unrelated distribution outputs.
- Repo already contained many unrelated modifications/untracked files. No git mutation, commit, push, reset or cleanup performed. Auth/secret files were not read. Source edits confined to the two stitch test files above; test-generated bundle/media/evidence and ordinary tool caches may update as a consequence of running the requested commands.

## Handoff

Headless blocker is addressed at the fixture boundary with a reproducible native opt-out and real clock diagnostic. Recommend independent review of this narrow change, and tracking the existing Opus parser warning separately before claiming artifact-level codec cleanliness.
