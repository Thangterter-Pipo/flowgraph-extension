# FlowGraph Real Runtime — Capability Matrix (FG-1603)

> Status as of 2026-09-05. Classifications follow evidence in
> `GOOGLE_FLOW_API_REFERENCE.md` + `evidence/`, and the runtime build in
> `flowgraph-extension/src/runtime/`.

| Kind | Runtime class | Executor | Adapter | Realtime sync | Notes |
|---|---|---|---|---|---|
| `prompt` | RUNTIME_VERIFIED | ✅ | – | TWO_WAY_VERIFIED | Prompt equality verified in both directions; Google Flow reverse path requires a trusted user `beforeinput`/`input` event |
| `t2i` | RUNTIME_VERIFIED | ✅ | ✅ | TWO_WAY_VERIFIED | IMAGE mode, prompt, model, aspect and result lifecycle verified against the real project; 7 live runs, latest image mediaId `fb3650ad...` (Run 7, 2026-09-05) |
| `i2v` | RUNTIME_VERIFIED | ✅ | ✅ | TWO_WAY_VERIFIED | Exact upstream IMAGE mediaId binding, VIDEO settings, lifecycle and result relay verified live; Run 5/6/7 upstream→video pairs `c8253b91→7f06b147`, `54207841→b47ecddd`, `fb3650ad→b8db27b9` |
| `download` | RUNTIME_VERIFIED | ✅ | ✅ | NO_REALTIME_COUNTERPART | Chrome download bridge is live verified (trusted tile click + Fetch-intercepted signed URL + `chrome.downloads` polling); Run 5/6/7 artifacts 8,380,117 / 8,089,921 / 7,933,254 bytes with real `ftypisom` headers. Google Flow exposes no reverse "download state" counterpart to mirror into a Download node |
| `t2v` | RUNTIME_VERIFIED | ✅ | ✅ | TWO_WAY_VERIFIED | Prompt/settings/preflight/lifecycle verified live; stale Start/End were cleared before latest successful video `cebda58e...` |
| `extend` | RUNTIME_PARTIAL | – | ✅ | TWO_WAY_PARTIAL | Shared prompt/settings can sync, but no explicit Extend tile action was present in the inspected Google Flow media menu; executor remains pending |
| `interpolation` | RUNTIME_VERIFIED | ✅ | ✅ | TWO_WAY_VERIFIED | Start Frame and End Frame semantic slots are two-way live verified; interpolation executor and live generation verified (Run 1 `fb3650ad+12bd87d1→e2fe5146`, Run 2 `c7c1750a+54207841→720fea1e`) |
| `reference` | RUNTIME_PARTIAL | – | ✅ | TWO_WAY_VERIFIED | Ordered Reference Media configuration is live verified in both directions; the standalone Reference generation executor remains pending |
| `upscale` | RUNTIME_PARTIAL | – | ✅ | NO_UI_COUNTERPART | No explicit Upscale tile action was present in the inspected Google Flow media menu; no success is inferred from generic resolution controls |
| `uploadImage` | UI_ONLY | – | ✅ | NONE | Upload adapter exists; no standalone realtime node mapping was live verified |
| `imageTransform` | RUNTIME_PARTIAL | – | – | NONE | Shape partially verified |
| `imageUpscale` | RUNTIME_PARTIAL | – | – | NO_UI_COUNTERPART | Payload/enums documented; no current exact UI action counterpart was observed |
| `cancelGeneration` | RUNTIME_PARTIAL | – | ✅ | TWO_WAY_PARTIAL | Local abort/provider best-effort path exists; no live reverse provider-cancellation event was claimed |
| `gemini` | UI_ONLY | – | – | NONE | Gemini enhance UI; adapter interface only |
| `likenessCheck` | UI_ONLY | – | – | NONE | Eligibility API verified; no executor in V1 |
| `likenessList` | UI_ONLY | – | – | NONE | List API verified; no executor in V1 |
| `characterAssign` | UI_ONLY | – | – | NONE | `copyProjectMedia` verified; no executor in V1 |
| `characterCreate` | RUNTIME_PARTIAL | – | – | NONE | Character surface partial |
| `creationAgent` | UI_ONLY | – | – | NONE | SSE documented; not in V1 path |
| `condition` | UI_ONLY | – | – | NONE | Local branch (Phase 13) |
| `delay` | UI_ONLY | – | – | NONE | Local utility (Phase 13) |
| `note` | UI_ONLY | – | – | NONE | Local annotation |

**Definition:**
- `RUNTIME_VERIFIED` — capability has real runtime evidence, not just mocked/contract tests.
- `CONTRACT_VERIFIED` — executor + real adapter/request path implemented and automated tests pass, but live provider E2E evidence is still pending.
- `RUNTIME_PARTIAL` — API/payload is only partially verified, executor is incomplete, or provider constraints block success.
- `UI_ONLY` — palette node exists; no runtime path. Never simulated on Run.
- `COMING_SOON` — not implemented.

Realtime sync labels are independent from runtime/executor maturity:

- `TWO_WAY_VERIFIED` — the real Google Flow UI counterpart was changed and read back in both directions.
- `TWO_WAY_PARTIAL` — only a subset of that capability's controls/lifecycle has a verified two-way mapping.
- `ONE_WAY` — only one direction has been verified.
- `NO_REALTIME_COUNTERPART` — the capability is real, but there is no meaningful reverse state to mirror.
- `NO_UI_COUNTERPART` — the inspected Google Flow build exposes no exact control/action; FlowGraph does not fabricate one.
- `NONE` — no realtime mapping is implemented or claimed.

The realtime column is backed by sanitized live evidence in
`flowgraph-extension/evidence/flowgraph_sync/`. Verification used exact project
`00000000-0000-4000-8000-000000000000`. A verified Reference Media configuration mirror does
not upgrade the still-pending Reference generation executor, whereas Start/End slot mirroring
and the Interpolation executor have now been verified live together (2026-09-05).

**Honesty rule:** No kind in the matrix shows fake success. Run validation reports
`UNSUPPORTED_NODE` for anything without an executor, before any provider call.

**Live project gate (fail-closed):** The Studio canvas gate is driven by the live Flow tab URL and
relayed `FLOWGRAPH_EVENT`. Navigating to home locks the canvas (`gate=True`, `runDisabled=True`,
pill `warn`) within ~1s; navigating back to the project unlocks it (`gate=False`,
`runDisabled=False`, pill `online`) within ~1s — no reload, no 120s poll, no forced unlock.
Evidence: `flowgraph-extension/evidence/flowgraph_v1/projects/project_gate_live_reactivity_2026-09-02T21-35-38-062Z.json`
and `...21-36-13-566Z.json` (plus a fresh re-probe `...21-52-54-889Z.json`). The service worker derives real project state from `projectIdFromUrl`
when the content-script relay is still warming up; the Studio `FLOWGRAPH_EVENT` listener re-reads
account state so a stale `ERROR` pill clears.
