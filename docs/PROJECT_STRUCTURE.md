# FlowGraph Extension — Project Structure

```text
flowgraph-extension/
├─ README.md
├─ manifest.json
├─ docs/
│  ├─ FLOWGRAPH_EXTENSION_PROPOSAL.md
│  ├─ FLOWGRAPH_EXTENSION_ARCHITECTURE_DRIVER.md
│  ├─ PROJECT_STRUCTURE.md
│  └─ reference-source/
├─ public/
│  └─ icons/
├─ src/
│  ├─ ui/
│  │  ├─ sidepanel/             # Control Center: auth/Flow status/project/credits/history
│  │  ├─ studio/                # Full-page node editor
│  │  └─ components/            # Shared React UI components
│  ├─ background/               # Manifest V3 service worker
│  ├─ content/
│  │  └─ flow/                  # Google Flow content-script bridge, DOM adapter, observers
│  ├─ engine/
│  │  ├─ graph/                 # Graph model, port typing, validation, DAG compiler
│  │  └─ execution/             # Workflow runner, scheduler, retry/resume, node-run state
│  ├─ nodes/
│  │  ├─ core/                  # MVP / runtime-verified nodes
│  │  └─ experimental/          # Runtime-partial Google Flow capabilities
│  ├─ adapters/
│  │  ├─ google-flow/           # Provider boundary for Flow capabilities
│  │  └─ gemini/                # Prompt enhancer adapter
│  ├─ auth/                     # Extension identity + Flow session connection state
│  ├─ storage/                  # Workflow/run/settings repositories
│  ├─ services/                 # Messaging, download, notification, telemetry abstractions
│  ├─ shared/                   # Shared constants/helpers/message contracts
│  └─ types/                    # Workflow, Node, Edge, MediaRef, RunState types
├─ tests/
│  ├─ unit/
│  ├─ integration/
│  └─ e2e/
├─ scripts/
└─ config/
```

## Dependency direction

```text
UI
 ↓
Workflow Engine
 ↓
Node Executor Registry
 ↓
Provider Adapters
 ↓
Content Script / External Services

Storage/Auth/Services are cross-cutting infrastructure behind interfaces.
```

## Core architectural rules

1. UI nodes never call Google Flow DOM/API directly.
2. Every Google Flow operation passes through `GoogleFlowAdapter`.
3. Workflow canvas JSON and execution DAG are separate models.
4. Node ports are typed (`PROMPT`, `IMAGE`, `VIDEO`, `MEDIA`, etc.).
5. Google Flow outputs are normalized into `MediaRef`.
6. Workflow execution state must be persisted so MV3 service-worker suspension can recover.
7. Do not persist Google cookies, Flow OAuth access tokens, reCAPTCHA tokens, or signed media URLs.
8. `[RUNTIME_PARTIAL]` API capabilities belong in `nodes/experimental/` until success paths are proven.

## MVP core nodes

- Prompt
- Gemini Enhance
- Upload Image
- Text-to-Image
- Text-to-Video
- Image-to-Video
- Extend Video
- Download

## Experimental / Phase 2 nodes

- Start + End Frame
- Reference Images Video
- Image Transform
- Image Upsample 2K/4K
- Video Upsample
- Character/Likeness
- Condition
- Delay
- Batch / Merge
