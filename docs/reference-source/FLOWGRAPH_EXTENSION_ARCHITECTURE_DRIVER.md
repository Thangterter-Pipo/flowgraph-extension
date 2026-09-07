# FLOWGRAPH EXTENSION
## Architecture Driver Document

**System:** FlowGraph Extension – Visual Workflow Builder for Google Flow  
**Architecture style:** Chrome Extension + Visual DAG Workflow Engine + Provider Adapter  
**Primary provider:** Google Flow  
**Secondary AI provider:** Gemini  
**Document status:** Architecture Driver Draft v1.0

---

## 1. Purpose

This document defines the architecture drivers for FlowGraph Extension. Architecture drivers are the requirements, quality attributes, technical constraints, risks, and architectural decisions that have the strongest influence on the structure of the system.

The design is derived from two main sources:

1. the FlowGraph product idea: a ComfyUI-inspired visual node workflow builder implemented as a Chrome Extension; and
2. the runtime evidence already documented in `GOOGLE_FLOW_API_REFERENCE.md` and `evidence/`, which establishes which Google Flow capabilities are verified, partial, or unstable.

---

## 2. System Context

FlowGraph Extension runs in Chrome beside Google Flow and provides a Side Panel where the user builds and executes workflows.

```text
+-----------------------------------------------------------+
|                     CHROME BROWSER                        |
|                                                           |
|  +-------------------------+   +------------------------+  |
|  | Google Flow Tab         |   | FlowGraph Side Panel   |  |
|  |                         |   |                        |  |
|  | Authorized Flow session |<->| Visual Node Editor     |  |
|  | Flow UI/runtime         |   | Workflow Runner        |  |
|  | Media generation       |   | Run/Media Status       |  |
|  +------------+------------+   +-----------+------------+  |
|               ^                            |               |
|               |                            v               |
|        Content/Main-world Bridge    MV3 Service Worker     |
|                                            |               |
|                                            v               |
|                                     chrome.storage         |
+-----------------------------------------------------------+
                         |
                         | optional external call
                         v
                  +-------------+
                  | Gemini/API  |
                  +-------------+
```

The extension does not replace Google Flow. It orchestrates Flow operations and provides workflow capabilities that are not natively expressed as a reusable visual DAG.

---

## 3. Architecture Drivers Summary

The highest-priority architecture drivers are:

| ID | Driver | Priority |
|---|---|---|
| AD-01 | Visual node graph must compile into a deterministic executable workflow | Critical |
| AD-02 | Google Flow is an internal/changeable provider surface | Critical |
| AD-03 | Video/media jobs are asynchronous and can run longer than an extension service-worker lifetime | Critical |
| AD-04 | Google auth/reCAPTCHA/session secrets must not become persistent workflow data | Critical |
| AD-05 | Completed nodes should not be unnecessarily re-executed after failure/retry | High |
| AD-06 | New nodes/providers must be addable without rewriting the workflow engine | High |
| AD-07 | Workflows must be reusable and persist across browser sessions | High |
| AD-08 | The system must make partial/unsupported Google Flow capabilities explicit | High |
| AD-09 | User interaction must remain simple enough for non-programmers | High |
| AD-10 | Extension execution state must be recoverable after MV3 suspension/restart | Critical |

---

## 4. Business Drivers

### BD-01 – Reduce Manual Production Steps

The system should reduce repeated manual Google Flow interactions by converting a repeated sequence into one reusable workflow.

### BD-02 – Enable Non-Programmers

Content creators should be able to configure a pipeline through nodes and ports without understanding HTTP endpoints, `mediaId`, asynchronous polling, or provider-specific request schemas.

### BD-03 – Reuse Production Knowledge

A good content-generation process should be reusable as a workflow definition rather than existing only as human memory.

### BD-04 – Speed Up Content Creation

Prompt enhancement, media chaining, status monitoring, and download should be automated where technically possible.

### BD-05 – Enable Future Collaboration

The graph definition should be designed so it can later be exported, synchronized, versioned, or shared without changing the execution model.

### BD-06 – Preserve Provider Flexibility

Google Flow is the first provider, but core workflow concepts should not prevent adding other providers later.

---

## 5. Functional Requirements Affecting Architecture

### FR-01 – Extension Google Identity

The extension shall allow the user to sign in with Google for extension identity/profile purposes.

**Architecture impact:**

- requires Authentication/Identity module;
- Google identity state must be separated from Flow runtime session state;
- production design should use Chrome identity/OAuth rather than storing passwords.

### FR-02 – Google Flow Session Detection

The extension shall detect whether a compatible authorized Google Flow tab/project is available.

**Architecture impact:** requires a Flow Session Manager and browser-tab/content-script bridge.

### FR-03 – Visual Workflow Editing

The extension shall provide a node-based editor supporting:

- nodes;
- typed ports;
- edges;
- node parameters;
- drag/drop;
- pan/zoom;
- save/load.

**Architecture impact:** graph definition must be independent from the Google Flow provider.

### FR-04 – Typed Connections

Each node port shall define a data type.

Suggested core types:

```text
TEXT
PROMPT
IMAGE
VIDEO
MEDIA
NUMBER
BOOLEAN
```

The editor shall reject incompatible connections.

### FR-05 – Graph Validation

The system shall validate before execution:

- missing required inputs;
- incompatible edge types;
- cycles where not explicitly supported;
- unavailable provider/session;
- invalid node configuration.

### FR-06 – DAG Compilation

The visual graph shall compile into a provider-independent execution graph.

Example:

```text
UI graph:
position, color, group, selected state

          |
          v

Execution graph:
node type, inputs, dependencies, executor config
```

This separation prevents UI concerns from contaminating execution logic.

### FR-07 – Node Scheduling

A node becomes executable only when its required dependencies are successful and required inputs are resolvable.

### FR-08 – Google Flow Media Generation

MVP shall support verified Google Flow paths required for the demonstration:

- image upload;
- Text-to-Image;
- Text-to-Video;
- Image-to-Video;
- Extend/Edit Video;
- polling;
- download.

Phase 2 may include verified interpolation/reference capabilities.

### FR-09 – Media Reference Passing

The system shall normalize provider media output into an internal `MediaRef` rather than exposing raw Google Flow response structures to downstream nodes.

```typescript
interface MediaRef {
  provider: "GOOGLE_FLOW";
  mediaId: string;
  type: "IMAGE" | "VIDEO";
  projectId?: string;
  workflowId?: string;
  mimeType?: string;
  localArtifact?: string;
}
```

### FR-10 – Prompt Enhancement

The system shall support a Gemini Prompt Enhance node with style presets and custom instructions.

### FR-11 – Asynchronous Job Monitoring

For long-running Google Flow generation, the system shall support:

```text
SUBMITTED
-> WAITING_PROVIDER
-> SUCCESS | FAILED
```

The run must not rely on one JavaScript promise remaining alive indefinitely.

### FR-12 – Persistent Workflow Run

Workflow execution state shall be persisted after meaningful state transitions.

Suggested data:

```typescript
interface WorkflowRun {
  id: string;
  workflowId: string;
  workflowVersion: number;
  status: RunStatus;
  currentNodeIds: string[];
  nodeRuns: Record<string, NodeRun>;
  startedAt: string;
  updatedAt: string;
}
```

### FR-13 – Retry

The user shall be able to retry a failed node. Previously successful upstream nodes should be reused if their outputs are still valid.

### FR-14 – Workflow Save/Load

The extension shall persist reusable workflow definitions independent of execution state.

### FR-15 – Automatic Download

A Download node shall save the final media artifact using the extension/browser download mechanism.

### FR-16 – Execution History

The system shall retain recent run history with sanitized provider status and media metadata.

### FR-17 – Experimental Capability Flags

Functions marked `[RUNTIME_PARTIAL]` in the current Google Flow evidence shall not be silently exposed as stable nodes.

Examples:

- Video Upsample;
- Cancel ACTIVE;
- full Character/Likeness creation;
- Image Transform;
- Image Upsample.

---

## 6. Quality Attribute Drivers

## QA-01 – Modifiability

**Priority:** Critical

### Scenario

A developer needs to add a new Google Flow node or a new AI provider.

**Stimulus:** new provider capability becomes available.  
**Environment:** normal development.  
**Artifact:** node library and provider integrations.  
**Response:** new executor/adapter is added without changing DAG compilation/scheduling core.  
**Measure:** no modification to the graph scheduler for a standard new node type.

### Architectural consequence

Use a Node Executor contract:

```typescript
interface NodeExecutor<I, O> {
  validate(node: RuntimeNode, input: I): ValidationResult;
  execute(ctx: ExecutionContext, input: I): Promise<NodeExecutionResult<O>>;
}
```

Provider-specific executors depend on adapter interfaces, not directly on DOM selectors or endpoint URLs.

---

## QA-02 – Recoverability

**Priority:** Critical

### Scenario

Chrome terminates the Manifest V3 service worker while a Google Flow video is generating.

**Response:** after the worker is restarted by a browser event, it restores the `WorkflowRun`, recognizes that a node is in `WAITING_PROVIDER`, rechecks provider status, and resumes the run.

**Measure:** workflow does not require restart from node 1 solely because the service worker was suspended.

### Architectural consequence

Execution state is event-driven and persisted. Long-running operations are represented as state, not as a continuously alive call stack.

---

## QA-03 – Reliability

**Priority:** High

### Scenario

Node N fails because of a temporary provider error after Nodes 1..N-1 succeeded.

**Response:** the system records the error and provides retry. Completed predecessor outputs remain available.

**Measure:** no unnecessary regeneration of successful predecessor media for ordinary retry.

---

## QA-04 – Security & Privacy

**Priority:** Critical

### Scenario

The extension manages workflows while the user is authenticated to Google Flow.

**Required response:** secrets are not serialized into workflow definitions, logs, share payloads, or execution history.

Never persist as workflow data:

- Google password;
- Flow cookies;
- Flow OAuth access token;
- refresh token;
- reCAPTCHA token;
- signed media URL signatures.

### Architectural consequence

Authentication/session material stays inside the authorized browser/provider boundary. The workflow engine uses normalized capabilities and media IDs.

---

## QA-05 – Usability

**Priority:** High

### Scenario

A creator with no API knowledge wants to build a basic prompt -> image -> video workflow.

**Measure:** user should be able to create and run a basic workflow within approximately five minutes after login/Flow connection, without editing JSON or API payloads.

### Architectural consequence

- typed ports;
- meaningful node names;
- presets;
- inline validation;
- simple Run button;
- visible status badges.

---

## QA-06 – Performance

**Priority:** Medium/High

The editor should remain responsive with typical creator workflows.

Target MVP measures:

- normal canvas interactions: perceived response under 100 ms;
- graph validation for <=100 nodes: target under 500 ms on a normal desktop;
- workflow state updates should not block the UI thread with long provider polling.

Provider generation time is excluded from UI performance targets.

---

## QA-07 – Compatibility / Change Tolerance

**Priority:** Critical

### Scenario

Google Flow changes a DOM selector, endpoint detail, request field, or model registry.

**Response:** provider-specific code is updated without rewriting saved workflow definitions or DAG core.

### Architectural consequence

Introduce:

```text
GoogleFlowAdapter
FlowSessionManager
FlowCapabilityResolver
FlowSelectors / FlowBridge
```

Nodes depend on stable internal operations such as:

```text
generateImage()
generateVideo()
generateVideoFromImage()
extendVideo()
pollMedia()
downloadMedia()
```

rather than embedding selectors/API payloads in node components.

---

## QA-08 – Auditability

**Priority:** High

Each NodeRun should record sanitized execution evidence:

```text
nodeId
nodeType
status
startedAt
finishedAt
provider
mediaId/output summary
sanitized error
retryCount
```

No secret values are included.

---

## QA-09 – Scalability

**Priority:** Medium for MVP, High for future cloud version

MVP runs locally in the extension and may support limited parallel independent branches.

Future design should permit moving orchestration/storage to a backend/worker architecture without replacing workflow definitions.

---

## QA-10 – Testability

**Priority:** High

Workflow engine logic must be testable without requiring a live Google Flow session.

### Architectural consequence

Separate:

- pure graph validation/compiler tests;
- executor unit tests;
- mocked provider adapter tests;
- opt-in live browser tests.

This matches the existing `E:\Flow_veo` evidence philosophy where offline regression and live/paid browser validation are separated.

---

## 7. Technical Constraints

### C-01 – Chrome Extension / Manifest V3

The primary application shall be a Chrome Extension using Manifest V3.

Consequence: background logic is implemented as a service worker with a non-permanent lifecycle.

### C-02 – Google Flow Internal API

Google Flow integration is based on an internal/changeable surface, not a guaranteed stable public contract.

Consequence:

- provider adapter boundary is mandatory;
- runtime compatibility checks are needed;
- partial capabilities remain feature flagged;
- architecture must tolerate changes.

### C-03 – Authorized Browser Interaction / reCAPTCHA

Existing runtime evidence shows mutation flows can depend on authorized session and reCAPTCHA Enterprise behavior.

The system shall not bypass or replay security controls.

### C-04 – Dynamic Model Registry

Provider/model selection should not be globally hard-coded. Google Flow model keys/tier behavior may change.

### C-05 – No Persistent Flow Secrets

Workflow storage cannot be used as credential storage.

### C-06 – Local-First MVP

The initial MVP should work without requiring a large backend. Cloud sharing/team features are deferred.

### C-07 – Storage Capacity

Workflow definitions and state are metadata. Image/video binaries should not be stored in extension storage.

### C-08 – Gemini Secret Management

A prototype may use developer configuration, but a production release must not ship a reusable Gemini secret hard-coded into client-side extension code. A backend proxy or safe user-managed credential model is required.

---

## 8. Existing Google Flow Evidence and Architectural Impact

The current API research is not merely documentation; it directly influences architecture.

### Verified capabilities suitable for stable adapters

- project creation/lifecycle;
- image upload (`imageBytes`);
- Text-to-Image;
- Text-to-Video;
- Image-to-Video (`startImage.mediaId`);
- Start + End interpolation (`startImage.mediaId`, `endImage.mediaId`);
- Reference Image Video (`referenceImages[].mediaId`);
- Extend/Edit Video (`videoInput.mediaId`);
- asynchronous media polling;
- download/media redirect;
- likeness eligibility/list;
- character media assignment with `copyProjectMedia`.

### Partial capabilities requiring feature flags

- Image Transform;
- Image Upsample 2K/4K;
- Video Upsample;
- Cancel ACTIVE;
- complete Character/Likeness creation.

### Architectural implication

The node catalog must expose capability maturity. For example:

```typescript
type CapabilityStability =
  | "STABLE_RUNTIME_VERIFIED"
  | "EXPERIMENTAL_RUNTIME_PARTIAL"
  | "DISABLED_UNAVAILABLE";
```

A partial endpoint should not silently appear as equivalent to a verified generation node.

---

## 9. Key Architectural Decisions

## ADR-01 – Chrome Side Panel as Primary UI

**Decision:** use Chrome Side Panel instead of a separate web application for the MVP.

**Reason:** users can keep Google Flow visible while constructing and monitoring the workflow.

---

## ADR-02 – Separate Extension Identity from Flow Session

**Decision:** maintain two conceptual states:

```text
Extension Google Identity
!=
Google Flow Runtime Session
```

**Reason:** extension identity is for user/profile/workflow ownership, whereas Flow execution depends on the authorized Flow browser context.

---

## ADR-03 – Provider-Independent Workflow Definition

**Decision:** saved workflows use internal node types/ports and do not store raw provider request payloads as the primary format.

**Reason:** provider APIs and schemas can change.

---

## ADR-04 – Separate UI Graph from Execution Graph

**Decision:** compile the editable canvas into a runtime DAG.

UI graph contains visual properties; execution graph contains dependencies and executor configuration.

**Reason:** improves maintainability, validation, testability, and future UI changes.

---

## ADR-05 – Persist Run State

**Decision:** every meaningful run transition is persisted.

**Reason:** MV3 service worker can be suspended and Flow video jobs are long-running.

---

## ADR-06 – MediaRef as Provider Boundary

**Decision:** downstream nodes consume `MediaRef`, not arbitrary Google Flow JSON.

**Reason:** reduces coupling and makes provider replacement/addition possible.

---

## ADR-07 – Adapter-Based Google Flow Integration

**Decision:** all Flow-specific session, DOM, API, polling, and media logic goes behind an adapter.

**Reason:** Google Flow is internal and can change independently of the product.

---

## ADR-08 – Stable vs Experimental Nodes

**Decision:** nodes based on `[RUNTIME_PARTIAL]` APIs must be flagged experimental or excluded from the default MVP.

**Reason:** preserves transparent behavior and avoids promising an unsupported success path.

---

## ADR-09 – Local-First Workflow Storage

**Decision:** MVP stores graph/run metadata locally; cloud sharing is a later service.

**Reason:** minimizes MVP scope and backend dependencies.

---

## ADR-10 – Do Not Persist Authentication Secrets

**Decision:** no Flow cookie/OAuth/reCAPTCHA/signed URL material is written into saved workflows/history.

**Reason:** security, privacy, and provider-boundary integrity.

---

## 10. Proposed Logical Architecture

```text
+----------------------------------------------------------------+
|                        Side Panel UI                           |
|                                                                |
|  WorkflowCanvas   NodeLibrary   Inspector   RunMonitor         |
+---------------------------+------------------------------------+
                            |
                            v
+----------------------------------------------------------------+
|                    Workflow Application Core                   |
|                                                                |
| GraphValidator -> DAGCompiler -> WorkflowRunner -> RetryPolicy  |
|                       |                    |                    |
|                       v                    v                    |
|                  NodeRegistry         RunRepository             |
+-----------------------+----------------------------------------+
                        |
             +----------+----------+
             |                     |
             v                     v
+----------------------+  +----------------------+
| Gemini Adapter       |  | Google Flow Adapter  |
| enhancePrompt()      |  | generateImage()      |
|                      |  | generateVideo()      |
|                      |  | pollMedia()          |
|                      |  | downloadMedia()      |
+----------------------+  +----------+-----------+
                                    |
                                    v
                         +-------------------------+
                         | Browser/Flow Bridge     |
                         | Content Script          |
                         | Main-world bridge when  |
                         | strictly necessary      |
                         +-------------------------+
```

---

## 11. Runtime Components

### 11.1 Side Panel React Application

Contains:

- `WorkflowCanvas`;
- node components;
- node inspector;
- run status;
- media previews;
- login/connect status.

### 11.2 MV3 Service Worker

Responsibilities:

- extension messaging;
- workflow repository orchestration;
- download requests;
- run resume triggers;
- tab/session coordination.

It must not be treated as an always-running process.

### 11.3 Content Script / Flow Bridge

Responsibilities:

- interact with the matching Flow tab;
- observe provider UI/runtime state;
- perform legitimate user-authorized interactions needed by the adapter;
- return sanitized results.

### 11.4 Workflow Engine

Responsibilities:

- validation;
- DAG compilation;
- scheduling;
- state machine transitions;
- retry/resume.

### 11.5 Storage

Logical repositories:

```text
WorkflowRepository
WorkflowRunRepository
SettingsRepository
TemplateRepository (Phase 2)
```

---

## 12. Core Domain Model

### WorkflowDefinition

```typescript
interface WorkflowDefinition {
  id: string;
  name: string;
  schemaVersion: number;
  version: number;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  viewport?: Viewport;
  createdAt: string;
  updatedAt: string;
}
```

### WorkflowNode

```typescript
interface WorkflowNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  config: Record<string, unknown>;
}
```

### ExecutionNode

```typescript
interface ExecutionNode {
  id: string;
  type: string;
  dependencies: string[];
  resolvedInputs: Record<string, unknown>;
  config: Record<string, unknown>;
}
```

### NodeRun

```typescript
interface NodeRun {
  nodeId: string;
  status:
    | "IDLE"
    | "READY"
    | "QUEUED"
    | "RUNNING"
    | "WAITING_PROVIDER"
    | "SUCCESS"
    | "FAILED"
    | "SKIPPED";
  output?: unknown;
  error?: SanitizedError;
  startedAt?: string;
  finishedAt?: string;
  retryCount: number;
}
```

---

## 13. Critical Execution Sequence

Example MVP sequence:

```text
User presses RUN
      |
      v
GraphValidator
      |
      v
DAGCompiler
      |
      v
Prompt Node SUCCESS
      |
      v
Gemini Enhance SUCCESS
      |
      v
T2I executor
      |
      +--> GoogleFlowAdapter
      |       |
      |       +--> Flow Bridge
      |       |
      |       +<-- mediaId / image result
      |
      v
Image-to-Video executor
      |
      +--> submit video
      |
      v
WAITING_PROVIDER
      |
      +--> persist run state
      |
      +--> poll/recheck
      |
      v
SUCCESS MediaRef(video)
      |
      v
Extend
      |
      v
Download
      |
      v
WORKFLOW SUCCESS
```

---

## 14. Error Handling Strategy

Provider errors are normalized into internal categories:

```text
AUTH_REQUIRED
FLOW_SESSION_UNAVAILABLE
FLOW_UI_CHANGED
PROVIDER_REJECTED
PROVIDER_TIMEOUT
GENERATION_FAILED
MEDIA_NOT_FOUND
UNSUPPORTED_CAPABILITY
RATE_LIMITED
UNKNOWN_PROVIDER_ERROR
```

Example behavior:

```text
AUTH_REQUIRED
-> Pause run
-> Ask user to reconnect Flow
-> Resume from waiting node
```

```text
GENERATION_FAILED
-> Mark current node FAILED
-> Preserve prior outputs
-> Offer Retry Node / Retry From Here
```

---

## 15. Security Architecture

### Trust boundaries

```text
Extension workflow metadata
        |
        | trusted app state
        v
Flow Bridge
        |
        | provider/browser security boundary
        v
Google Flow authorized session
```

### Rules

1. Do not store Flow secrets in workflow JSON.
2. Do not log complete auth headers/cookies.
3. Do not attempt reCAPTCHA bypass.
4. Redact sensitive URLs/tokens from execution history.
5. Request the minimum Chrome permissions required.
6. Keep provider interaction scope restricted to Google Flow host patterns where practical.
7. Production Gemini secrets must not be hard-coded into distributed extension JavaScript.

---

## 16. Architecture Validation Scenarios

### AV-01 – End-to-End Generation

Given a valid Flow session and graph:

```text
Prompt -> Gemini -> T2I -> I2V -> Extend -> Download
```

When the user presses Run, all nodes should execute in dependency order and produce a downloaded MP4.

### AV-02 – Missing Input

Given I2V without an image input, validation must fail before provider execution.

### AV-03 – Wrong Port Type

Connecting Video output to Prompt-only input must be rejected by the editor/validator.

### AV-04 – Provider Session Expiration

If Flow authentication becomes unavailable while waiting for a node, the workflow must pause rather than lose all previous state.

### AV-05 – Service Worker Suspension

After persisted `WAITING_PROVIDER`, service-worker restart must restore and continue the workflow.

### AV-06 – Node Retry

When Extend fails after T2I/I2V succeeded, retrying Extend must reuse the successful previous video output.

### AV-07 – Flow UI Change

If a provider selector/bridge action breaks, the failure should be classified as provider compatibility failure without corrupting saved workflow definitions.

### AV-08 – Experimental Node

A `[RUNTIME_PARTIAL]` capability must be visibly marked experimental/unsupported according to current compatibility status.

---

## 17. MVP Architecture Scope

### Required for MVP

```text
Chrome MV3
Side Panel React UI
@xyflow/react node graph
Google Identity login
Flow connection/session detection
Graph validator
DAG compiler
Persistent workflow runner
Prompt node
Gemini Enhance node
T2I node
T2V node
I2V node
Extend node
Download node
Workflow save/load
Run state/history
GoogleFlowAdapter
```

### Deferred

```text
Cloud backend
Team collaboration
Share-by-link
Workflow marketplace
Full character creation
Video/Image upsample stable nodes
Social media publishing
Distributed workers
```

---

## 18. Proposed Technology Choices

| Layer | Technology |
|---|---|
| Extension platform | Chrome Manifest V3 |
| UI | React + TypeScript |
| Graph editor | `@xyflow/react` |
| Local state | React state/store + repository abstraction |
| Persistence | Chrome Storage API |
| Background | MV3 Service Worker |
| Page integration | Content Script + controlled bridge |
| Downloads | Chrome Downloads API |
| Extension identity | Chrome Identity/OAuth |
| Prompt AI | Gemini |
| Provider | Google Flow Adapter |
| Testing | Vitest/Jest + browser integration tests + opt-in live Flow tests |

---

## 19. Architecture Risks and Responses

| Risk | Probability | Impact | Architectural Response |
|---|---:|---:|---|
| Google Flow changes internal UI/API | High | High | Adapter boundary + compatibility tests |
| reCAPTCHA blocks direct automation | High | High | Authorized user/Flow interaction path; no bypass |
| MV3 worker suspension | High | High | Persisted state-machine workflow runner |
| Saved graph coupled to provider payload | Medium | High | Provider-independent workflow schema |
| Media binaries exceed storage | High | Medium | Store only metadata/IDs; use downloads/provider media |
| Gemini key leaks from extension | Medium | High | production backend proxy or safe user config |
| Experimental node presented as stable | Medium | High | capability registry + feature flags |
| Flow session expires during long job | Medium | High | pause/reconnect/resume flow |

---

## 20. Architecture Completion Criteria

Architecture is considered validated for the MVP when:

1. visual graph and execution graph are separate;
2. node types are registered through an extensible executor model;
3. Google Flow is accessed only through a provider adapter/bridge;
4. workflow state can be persisted and restored;
5. a real Prompt -> Gemini -> T2I -> I2V -> Extend -> Download workflow succeeds;
6. failure of a downstream node does not destroy upstream successful outputs;
7. no Flow auth/reCAPTCHA/cookie secrets appear in saved workflow/run files;
8. partial provider capabilities remain experimental and do not falsely claim stable success;
9. offline graph/engine tests can run without Google Flow;
10. live integration tests are separated and opt-in.

---

## 21. Final Architectural Direction

FlowGraph Extension should be treated as a **visual workflow orchestration layer**, not an automation script collection.

The core architecture is:

```text
ComfyUI-inspired Visual Graph
          |
          v
Provider-independent DAG Engine
          |
          v
Node Executor Registry
          |
      +---+---+
      |       |
      v       v
   Gemini   GoogleFlowAdapter
                |
                v
        Authorized Flow Browser Context
```

This architecture directly addresses the strongest project constraints: Google Flow's internal/changeable integration surface, long-running asynchronous media generation, Chrome MV3 lifecycle behavior, reusable node workflows, security boundaries around Google authentication, and the requirement to add new nodes without redesigning the system.
