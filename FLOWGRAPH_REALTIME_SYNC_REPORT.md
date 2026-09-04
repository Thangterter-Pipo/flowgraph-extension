# FLOWGRAPH ↔ GOOGLE FLOW REALTIME SYNC REPORT

**Verification date:** 2026-09-04  
**Live Google Flow project:** `729eaa19-1c85-4cfc-89c3-5f86de2dffc5`  
**Scope:** FlowGraph Studio extension ↔ real Google Flow project UI  
**Verdict:** **FULL REALTIME SYNC VERIFIED FOR ALL CURRENTLY EXPOSED AND TESTED UI COUNTERPARTS**

This verdict is deliberately scoped. It does not claim that Google Flow exposes Seed, a standalone
generic media-binding control, an explicit Extend tile action, or an explicit Upscale tile action in
the UI build inspected during this verification. Those surfaces are marked `NO_UI_COUNTERPART`, not
silently simulated and not counted as failures.

## Architecture

```text
FlowGraph Studio active node
  └─ FlowSyncController + typed mutation envelope
       └─ Chrome extension message bridge
            └─ service worker
                 ├─ exact-project guard
                 ├─ sequence/conflict/echo guard
                 ├─ semantic Google Flow writers
                 └─ preflight + generation bridge
                      ⇅
              Google Flow project DOM
                      ⇅
                 content-script observer
                 ├─ trusted editable-event gate
                 ├─ semantic frame/reference reader
                 └─ generation lifecycle reader
            └─ service-worker event relay
       └─ FlowGraph active-node mapper/state store
```

Every mutation carries project and correlation metadata. Editable reverse mutations are accepted
only from trusted user events; lifecycle events may be automatic because they originate from actual
provider state. Exact project matching is enforced before a writer touches the Google Flow UI.

The MCP server and its public tunnel are development infrastructure only. Neither is in the
FlowGraph ↔ Google Flow production sync path, extension manifest dependency, or browser runtime
protocol.

## Supported Directions

| Surface | FlowGraph → Google Flow | Google Flow → FlowGraph | Status |
|---|---:|---:|---|
| Active node / compatible mode | ✅ | ✅ | VERIFIED |
| Prompt | ✅ | ✅ | VERIFIED |
| Mode | ✅ | ✅ | VERIFIED |
| Model | ✅ | ✅ | VERIFIED |
| Aspect ratio | ✅ | ✅ | VERIFIED |
| Duration | ✅ | ✅ | VERIFIED |
| Resolution | ✅ | ✅ | VERIFIED |
| Start Frame | ✅ | ✅ | VERIFIED |
| End Frame | ✅ | ✅ | VERIFIED |
| Ordered Reference Media | ✅ | ✅ | VERIFIED |
| Project binding/isolation | ✅ | ✅ | VERIFIED |
| Generation lifecycle/result | command | event | VERIFIED |
| Download | ✅ | no meaningful reverse state | `NO_REALTIME_COUNTERPART` |
| Seed | – | – | `NO_UI_COUNTERPART` |
| Explicit Extend tile action | – | – | `NO_UI_COUNTERPART` in observed UI |
| Explicit Upscale tile action | – | – | `NO_UI_COUNTERPART` in observed UI |

## Prompt

- FlowGraph → Google Flow writes only when the Slate editor value has drifted, reads the value back,
  and registers echo suppression before the reverse observer can relay it.
- Google Flow → FlowGraph listens to trusted `beforeinput` as well as `input`. This is required
  because the current Slate editor can perform a real physical user edit without emitting a useful
  subsequent `input` event.
- Untrusted/script-generated editable mutations are ignored in the reverse direction.
- Live latency: **379 ms forward**, **283 ms reverse**.

Evidence:
`flowgraph-extension/evidence/flowgraph_sync/flowgraph_to_flow_prompt.json` and
`flowgraph-extension/evidence/flowgraph_sync/flow_to_flowgraph_prompt.json`.

## Mode

IMAGE and VIDEO mode changes are mapped through stable semantic UI controls. Active-node changes
select a compatible Google Flow mode, and trusted mode changes in Google Flow are reflected into the
compatible active FlowGraph node. Source-instance sequence state resets when the active node changes,
preventing a valid first event on a new node from being rejected as stale.

Observed forward latency was **600–748 ms**; reverse latency was **256 ms**.

## Model

Model selection is verified in both directions through the real model menu. The writer verifies the
selected value after interaction and fails closed when the requested option cannot be resolved.

Live latency: **1,030 ms forward**, **225 ms reverse**.

## Aspect Ratio

Aspect ratio selection is verified through the real Google Flow settings surface, with exact value
read-back and active-node update.

Live latency: **816 ms forward**, **86 ms reverse**.

## Duration

Duration is mirrored through the real Video settings controls. The latest direct forward sample was
**833 ms**; the reverse sample was **87 ms**.

## Resolution

Resolution is mirrored independently from the unavailable Upscale tile action. A successful generic
resolution setting change is not reported as a completed Upscale operation.

Live latency: **570 ms forward**, **176 ms reverse**.

## Seed

No exact Seed control was present in the inspected Google Flow UI. Status is
`NO_UI_COUNTERPART`. FlowGraph does not invent a hidden value, force a provider request, or report
success for this field.

## Media Binding

Media is bound only through a known semantic counterpart:

- I2V upstream image → exact Start Frame media ID.
- Interpolation boundaries → exact Start Frame / End Frame slots.
- Reference inputs → ordered Google Flow Components chips.

The generic `FLOWGRAPH_SYNC_BIND_MEDIA` path remains fail-closed when no slot/reference mapping is
known. There is no fallback to the latest tile or any spatially nearby media.

## Start/End Frame

Both directions were verified with exact media ID
`a4303113-5fce-43d1-8c1d-f261bbb32ebf`.

| Slot | FlowGraph → Flow | Flow → FlowGraph |
|---|---:|---:|
| Start Frame | 2.7–3.1 s | 503 ms |
| End Frame | 2.3 s | 218 ms |

Slot detection is semantic. In particular, Reference chips are excluded from Start/End roots, and a
plain Video composer with no `swap_horiz` control is treated as a valid no-frame state rather than
guessing Start Frame from screen position.

Evidence: `flowgraph-extension/evidence/flowgraph_sync/media_frame_sync.json`.

## Reference Media

Ordered Reference Media is verified in both directions.

Forward test:

1. `02f79c21-b669-41a8-81a4-85d3224d722d`
2. `18f42f76-3b2e-4192-98b9-4e03427bea8e`

Both exact source media items were present and visible in the bound project. The production writer
opened Video → Components, selected each exact role=`option` by media ID, added them to the prompt,
and read back the same order. End-to-end latency for the two-item operation was **6,059 ms**.

For the reverse test, a physical user action removed the second item. FlowGraph persisted the exact
remaining ordered list `[02f79c21-b669-41a8-81a4-85d3224d722d]` in **119 ms**, with exactly one
reverse success event. The temporary Reference workflow and temporary Flow chips were removed after
verification; the original four-node workflow was restored.

Evidence: `flowgraph-extension/evidence/flowgraph_sync/reference_media_sync.json`.

## Project Sync

- All live tests targeted exact project `729eaa19-1c85-4cfc-89c3-5f86de2dffc5`.
- A mutation carrying a different project ID returned `PROJECT_MISMATCH`.
- The wrong-project test changed neither the Google Flow UI nor the FlowGraph node value.
- Media binding validates source media and project scope before applying it.
- The restored Studio workflow retains the same project binding.

Evidence: `flowgraph-extension/evidence/flowgraph_sync/project_isolation.json`.

## Generation Lifecycle

Two fresh production generation paths were verified during the realtime pass.

### T2V

- Run ID: `cb4dc2c1-82fe-4794-8c86-bd9e195b6c73`
- Started: `2026-09-03T19:48:35.684Z`
- Finished: `2026-09-03T19:49:14.690Z`
- Real result VIDEO: `cebda58e-f8eb-47b9-b6af-d303f35917ae`
- Lifecycle reverse latency: status **44 ms**, result **738 ms**
- Download: `flowgraph-output (7).mp4`, **840,997 bytes**

Before this run, both Start and End contained a deliberately stale binding. Production preflight
cleared both semantic slots, retained the exact project, then applied mode → media → settings →
prompt before clicking Generate. The run finished successfully without coordinate-based clearing or
page navigation.

### I2V exact-upstream path

- Action: `2026-09-03T20:12:34.424Z`
- Exact upstream IMAGE: `02f79c21-b669-41a8-81a4-85d3224d722d`
- Real result VIDEO: `257430d4-26b5-4645-9fd7-d6c6fa015ed5`
- Lifecycle reverse latency: status **13 ms**, result **6 ms**
- Download ID: `10`
- Download: `flowgraph-i2v-realtime-verified.mp4.mp4`, **1,565,300 bytes**

The upstream image was present in the same project and was verified in the semantic Start slot. No
"latest image" fallback was used.

Evidence:
`flowgraph-extension/evidence/flowgraph_sync/preflight_generate.json` and
`flowgraph-extension/evidence/flowgraph_sync/generation_lifecycle.json`.

## Loop Prevention

The loop test applied one FlowGraph edit to Google Flow. Result: **one forward apply, zero reverse
echoes**. Guards combine `originEventId`, normalized value comparison, per-source monotonic sequence,
and pending-write suppression.

Evidence: `flowgraph-extension/evidence/flowgraph_sync/sync_loop_guard.json`.

## Conflict Resolution

- Stale sequence numbers are rejected per source instance.
- A new active node/source instance can start a fresh sequence.
- Local provider side effects are tagged `userInitiated` so an automatic writer cannot be mistaken
  for a physical Google Flow edit.
- Editable Google Flow → FlowGraph updates require authoritative trusted events.
- Project mismatch always wins over mutation processing and fails closed.
- A failed writer produces a visible sync error; it does not commit a fake synchronized value.

## Latency

| Field/event | FlowGraph → Flow | Flow → FlowGraph |
|---|---:|---:|
| Prompt | 379 ms | 283 ms |
| Mode | 600–748 ms | 256 ms |
| Model | 1,030 ms | 225 ms |
| Aspect ratio | 816 ms | 86 ms |
| Duration | 833 ms | 87 ms |
| Resolution | 570 ms | 176 ms |
| Start Frame | 2.7–3.1 s | 503 ms |
| End Frame | 2.3 s | 218 ms |
| Reference Media (two items / one removal) | 6,059 ms | 119 ms |
| T2V lifecycle status/result | command path | 44 / 738 ms |
| I2V lifecycle status/result | command path | 13 / 6 ms |

Multi-step media-picker operations are intentionally slower than scalar settings because they clear,
open, select exact project media one at a time, commit, and read back the final semantic state.

## Tests

- Vitest: **84 / 84 tests passed**, **13 / 13 files passed**.
- TypeScript: **PASS**, zero type errors.
- Production build: **PASS**.
- Added coverage includes authoritative-event gating and ordered Reference Media reverse persistence.
- Existing runtime, project isolation, retry, cancel, cache, graph validation and adapter contract
  coverage remains passing.

## Live Evidence

Sanitized evidence is stored under `flowgraph-extension/evidence/flowgraph_sync/`:

- `flowgraph_to_flow_prompt.json`
- `flowgraph_to_flow_settings.json`
- `flow_to_flowgraph_prompt.json`
- `flow_to_flowgraph_settings.json`
- `node_switch_sync.json`
- `media_frame_sync.json`
- `reference_media_sync.json`
- `sync_loop_guard.json`
- `project_isolation.json`
- `preflight_generate.json`
- `generation_lifecycle.json`
- `realtime_sync_full.json`

The older prompt-writer smoke evidence remains as historical context; this report and the files above
describe the completed two-way pass.

## Security

- No CAPTCHA or reCAPTCHA bypass was attempted or implemented.
- No password automation was used.
- No cookie, bearer token, access token, reCAPTCHA token, or signed media credential is stored in the
  evidence files or workflow.
- Production code does not hard-code the test extension ID.
- Writers interact with ordinary visible Google Flow UI controls and fail when the required semantic
  counterpart cannot be resolved.
- No fake success path was added.

## Known Google Flow Limitations

- The DOM is provider-owned and can evolve. Writers therefore use semantic icons, roles, labels,
  exact media IDs and read-back verification, but future UI changes may require selector maintenance.
- Seed has no exact UI counterpart in the observed build.
- The inspected media action menu exposed Favorite, Reuse Prompt, Add to Scene, Add to Prompt,
  Download, Rename, Share, YouTube, Project Cover, Flag and Trash; it did not expose explicit Extend
  or Upscale tile actions.
- Generic media binding is unsupported unless it maps to Start Frame, End Frame or ordered Reference
  Media.
- Reference Media configuration sync is verified; this does not imply that the standalone Reference
  generation executor is complete.
- Start/End configuration sync is verified; this does not imply that the standalone interpolation
  executor is complete.
- Provider model menus can transiently re-render while being selected. The writer verifies the final
  value and reports failure rather than committing a false sync state; a new user action/retry can
  reapply the selection.
- Cancellation remains best-effort where the provider offers no usable terminal-state cancel action.

## Final Verdict

**FLOWGRAPH ↔ GOOGLE FLOW FULL REALTIME SYNC — VERIFIED.**

The verified scope is every currently exposed and tested Google Flow UI counterpart; it is not a
claim that the explicitly documented `NO_UI_COUNTERPART` controls exist.

Prompt, mode, model, aspect ratio, duration, resolution, exact Start/End Frame, ordered Reference
Media, project isolation, generation lifecycle, sync status, conflict handling and loop prevention all
have live two-way evidence on the exact project. T2V and exact-upstream I2V produced real videos and
real downloads. Missing provider UI controls remain explicitly classified and never become simulated
successes.
