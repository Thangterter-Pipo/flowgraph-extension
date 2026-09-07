# FLOWGRAPH EXTENSION
## Proposal – Visual Node-Based Workflow Builder for Google Flow

**Project type:** Chrome Extension / AI Content Creation / Workflow Automation  
**Working title:** **FlowGraph Extension – Visual Workflow Builder for Google Flow**  
**Reference implementation idea:** ComfyUI-style node/graph workflow  
**Primary runtime:** Google Flow (`labs.google`)  
**Technical evidence base:** `GOOGLE_FLOW_API_REFERENCE.md` and runtime evidence under `evidence/`  
**Document status:** Proposal Draft v1.0

---

## 1. Project Overview

### 1.1 Background

AI content creators often need to perform a sequence of separate operations when working with Google Flow: write a prompt, improve the prompt, generate an image, use that image as a video input, extend or edit the generated video, wait for asynchronous jobs, and finally download the result.

Although Google Flow provides powerful image and video generation capabilities, the current interaction model is primarily operation-by-operation. Complex pipelines must be repeated manually, and intermediate media has to be managed carefully between steps.

FlowGraph Extension proposes a visual workflow layer directly on top of Google Flow. The project takes inspiration from ComfyUI's node/graph interaction model, where users build complex AI pipelines by connecting reusable nodes and save/load workflows as graph definitions. ComfyUI officially describes its core interface as a nodes/graph/flowchart system for designing complex AI workflows and supports saving/loading workflow JSON. This proposal applies that interaction concept to Google Flow rather than reproducing ComfyUI itself.

### 1.2 Proposed Solution

FlowGraph Extension is a Chrome Extension that runs alongside an authorized Google Flow tab. It provides a visual node editor in a Chrome Side Panel. Users create workflows by dragging nodes onto a canvas, configuring parameters, connecting typed inputs/outputs, validating the graph, and running the workflow.

Example:

```text
[Prompt]
    |
    v
[Gemini Prompt Enhance]
    |
    v
[Text-to-Image]
    |
    v
[Image-to-Video]
    |
    v
[Extend Video]
    |
    v
[Download]
```

The extension is responsible for workflow orchestration, dependency management, execution state, reusable workflow storage, media passing, retry, and result presentation. Google Flow remains the underlying media-generation runtime.

---

## 2. Problem Statement

Current Google Flow usage has several practical limitations for repeatable production workflows:

1. Multi-step image/video creation requires many manual actions.
2. Intermediate outputs must be selected and passed to later generation steps manually.
3. Prompts often need repeated refinement before generation.
4. Users cannot visually define a reusable end-to-end pipeline.
5. There is no reusable user-defined DAG for executing several Flow operations as one workflow.
6. Long-running video jobs require waiting and checking generation status.
7. Repeating the same production process across multiple projects wastes time.
8. Sharing a production process with another creator is difficult when the process exists only as manual steps.

The project addresses these problems by representing content-generation logic as a persistent visual workflow.

---

## 3. Project Goal

### 3.1 Main Goal

Build a Chrome Extension that allows content creators to visually design, save, validate, execute, reuse, and share Google Flow media-generation workflows using a node-based interface.

A successful workflow must be able to pass prompts and media references between dependent nodes, execute Google Flow generation steps in the correct order, monitor asynchronous video generation, retain execution state, and automatically download final media artifacts.

### 3.2 Measurable Success Criteria

The MVP is considered successful when the extension can demonstrate this end-to-end workflow using a real authorized Google Flow session:

```text
Prompt
  -> Gemini Enhance
  -> Text-to-Image
  -> Image-to-Video
  -> Extend Video
  -> Download
```

Acceptance criteria:

- The user can create the graph using drag-and-drop nodes.
- The graph rejects incompatible connections and missing required inputs.
- The workflow can be saved and loaded without losing node configuration.
- The engine compiles the visual graph into an executable dependency graph.
- Text-to-Image returns a real Google Flow image result.
- The generated image media reference can be passed to Image-to-Video without requiring the user to manually upload the image again.
- Video generation can be monitored until terminal success/failure.
- Extend Video can consume a previous video output.
- Download can save the final media artifact.
- Node execution states are visible in the UI.
- Failed nodes can be retried without rerunning completed predecessor nodes unnecessarily.
- Workflow execution state survives extension service-worker suspension/restart through persistent state.

---

## 4. Target Users

### 4.1 Primary Users

**AI Content Creators** producing:

- YouTube Shorts;
- TikTok/Reels content;
- cinematic AI videos;
- advertising creatives;
- social-media images/videos;
- AI-generated concept content.

Primary users should not need to understand Google Flow's internal APIs.

### 4.2 Secondary Users

- Prompt Engineers;
- Video Editors;
- Marketing/Content Teams;
- Small creative teams that want to reuse a consistent content pipeline.

### 4.3 Future Administrative User

An optional cloud version may introduce an Admin/Workspace Owner responsible for team membership, shared workflows, quotas, templates, and audit history. This role is outside the first MVP.

---

## 5. Scope

### 5.1 In Scope – MVP

#### A. Google Account Login for Extension Identity

The extension should provide a user-visible **Continue with Google** action using Chrome's identity/OAuth capability for user identity. This identity is used for the extension user profile and future cloud synchronization.

The Google account identity of the extension is logically separate from the Google Flow runtime session. The extension must not persist Google passwords, Flow cookies, Flow OAuth access tokens, reCAPTCHA tokens, or signed media URLs as workflow data.

#### B. Google Flow Connection State

The extension detects whether a Google Flow tab/project is available and whether the current Flow session can execute required operations. If the Flow session is not usable, the workflow is paused and the user is asked to reconnect/open Google Flow.

#### C. Visual Node Workflow Editor

The extension provides:

- node drag/drop;
- canvas pan and zoom;
- connect/disconnect edges;
- delete and duplicate node;
- node configuration panel;
- typed input/output ports;
- visual node status;
- workflow save/load;
- undo/redo where feasible.

#### D. Workflow Validation

Before execution the system checks:

- required inputs;
- type compatibility;
- graph cycles;
- unavailable provider/session;
- disconnected required nodes;
- invalid node configuration.

#### E. Workflow Execution Engine

The engine must:

- compile the visual workflow into an execution DAG;
- determine dependency order;
- execute nodes when dependencies succeed;
- persist execution state;
- pause/resume long-running runs;
- support retry from a failed node;
- avoid re-executing successful predecessor nodes unless explicitly requested.

#### F. Gemini Prompt Enhancement

A Prompt Enhance node receives a base prompt and an enhancement style, for example:

- Cinematic;
- Realistic;
- Artistic;
- Advertising;
- Anime;
- Custom.

The output becomes the prompt input for downstream Google Flow nodes.

#### G. Google Flow Nodes for MVP

The MVP should prioritize Flow functions backed by runtime evidence in the existing API reference:

1. Prompt
2. Gemini Prompt Enhance
3. Upload Image
4. Text-to-Image
5. Text-to-Video
6. Image-to-Video
7. Extend/Edit Video
8. Download

The existing Google Flow research provides runtime evidence for image upload, Text-to-Image, Text-to-Video, Image-to-Video, interpolation, reference-image video, video extend/edit, media polling, and download. These verified capabilities demonstrate technical feasibility for the MVP execution engine.

#### H. Media Passing

The workflow engine uses an internal media-reference abstraction rather than passing raw files between every node.

Example:

```typescript
interface MediaRef {
  mediaId: string;
  projectId?: string;
  workflowId?: string;
  type: "IMAGE" | "VIDEO";
  mimeType?: string;
  localArtifact?: string;
}
```

This allows an image-generation node to pass its output media identifier directly to a downstream video node.

#### I. Job Monitoring

Node states:

```text
IDLE
READY
QUEUED
RUNNING
WAITING_PROVIDER
SUCCESS
FAILED
SKIPPED
```

Google Flow video generation is asynchronous, so the extension must retain the returned media/job reference and continue monitoring until success or failure.

#### J. Workflow Persistence

The workflow is stored as a versioned graph definition containing:

- nodes;
- edges;
- node configuration;
- viewport information;
- workflow metadata;
- workflow schema version.

The design is inspired by the reusable JSON workflow approach used by ComfyUI, but FlowGraph defines its own schema.

#### K. Automatic Download

A Download node can consume a successful media output and save the final artifact using Chrome's download capability.

#### L. Execution History

The extension stores recent workflow runs with:

- run ID;
- workflow ID/version;
- start/end time;
- node execution status;
- output media IDs;
- sanitized error information.

### 5.2 In Scope – Phase 2

- Start + End Frame interpolation node;
- Reference Image Video node;
- Character media assignment;
- workflow templates;
- workflow version history;
- workflow export/import JSON;
- cloud synchronization;
- share-by-link;
- team workspace;
- advanced retry/resume;
- parallel branches.

### 5.3 Experimental / Feature-Flagged

The existing API evidence explicitly keeps the following surfaces at `[RUNTIME_PARTIAL]` and therefore they must not be treated as stable MVP dependencies:

- Video Upsample;
- Cancel ACTIVE generation;
- full Character/Likeness creation surface;
- Image Transform;
- Image Upsample 2K/4K.

They may be exposed as experimental nodes only after runtime compatibility checks.

### 5.4 Out of Scope – Initial MVP

- native mobile application;
- full social-network posting/management;
- billing/payment marketplace;
- multi-provider video generation;
- large-scale distributed worker infrastructure;
- Google account password handling;
- CAPTCHA/reCAPTCHA bypass;
- storing/replaying Flow authentication secrets.

---

## 6. Main Functional Modules

### 6.1 Extension Authentication Module

Responsibilities:

- Google identity sign-in/sign-out;
- extension profile state;
- Flow session connection indicator;
- active Flow project detection.

### 6.2 Visual Workflow Editor

Responsibilities:

- canvas rendering;
- node library;
- edge creation;
- node settings;
- validation feedback;
- visual run state.

### 6.3 Workflow Engine

Responsibilities:

- graph validation;
- DAG compilation;
- dependency resolution;
- node scheduling;
- persisted run state;
- failure/retry handling.

### 6.4 Google Flow Adapter

Responsibilities:

- isolate all Google Flow-specific logic;
- resolve media/project information;
- trigger supported generation behavior;
- poll generation state;
- normalize provider results into internal `MediaRef` values;
- map provider failures to stable internal error codes.

### 6.5 Gemini Adapter

Responsibilities:

- prompt enhancement;
- style-specific prompt generation;
- provider error normalization;
- future support for additional prompt models.

### 6.6 Storage Module

MVP local persistence:

- workflow definitions;
- workflow settings;
- execution states;
- execution history;
- extension preferences.

Media binaries and sensitive Google credentials must not be stored as workflow JSON.

---

## 7. Proposed MVP User Flow

```text
1. Install FlowGraph Extension
2. Open extension side panel
3. Continue with Google
4. Connect/Open Google Flow
5. Select/create Flow project
6. Create workflow on node canvas
7. Configure Prompt/Gemini/Flow nodes
8. Validate workflow
9. Press RUN
10. Observe node-by-node execution
11. Preview generated image/video
12. Automatically download final artifact
13. Save workflow for reuse
```

---

## 8. Example MVP Workflow

### Workflow: Idea to Cinematic Video

```text
[Prompt]
"A robot walking through rainy Tokyo"
        |
        v
[Gemini Enhance]
Style = Cinematic
        |
        v
[Text-to-Image]
Google Flow / Nano Banana 2
        |
        v
[Image-to-Video]
        |
        v
[Extend Video]
        |
        v
[Download]
```

Expected demonstration:

- enhanced prompt visible;
- image generated successfully;
- returned image reference passed automatically to video generation;
- asynchronous video job monitored;
- extend node consumes previous video;
- MP4 downloaded without manual media re-selection.

---

## 9. Product Differentiation

FlowGraph Extension is not intended to clone ComfyUI or replace Google Flow. Its differentiation is the combination of:

1. **ComfyUI-style visual workflow composition**;
2. **Google Flow-specific media orchestration**;
3. **Chrome Extension integration directly beside the Flow workspace**;
4. **Gemini-assisted prompt enhancement**;
5. **automatic passing of media references between generation steps**;
6. **persistent resumable execution state**;
7. **reusable workflows instead of repeated manual operations**.

---

## 10. Feasibility Based on Existing Google Flow API Research

The repository's existing runtime research provides concrete evidence that the core technical path is feasible.

### Runtime-verified foundations used by the proposal

- authorized session retrieval/auth boundary;
- project lifecycle;
- image upload via `imageBytes`;
- Text-to-Image;
- Text-to-Video;
- Image-to-Video using `mediaId`;
- Start + End interpolation using media IDs;
- Reference Image Video using media IDs;
- Extend/Edit Video using `videoInput.mediaId`;
- polling asynchronous media generation;
- CDN/media download;
- likeness eligibility/list;
- character media assignment through `copyProjectMedia`.

### Known limitations

The API reference also proves that not every internal Google Flow surface can currently be treated as a stable direct API. reCAPTCHA Enterprise, authorized browser interaction, unstable internal endpoints, and partial capabilities require the extension to use a provider-adapter boundary and feature flags.

This evidence significantly reduces the technical uncertainty of the core MVP while preserving an honest boundary around experimental functions.

---

## 11. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Google Flow is an internal/unstable surface | High | Isolate all provider code behind `GoogleFlowAdapter`; version selectors/contracts; runtime compatibility checks |
| reCAPTCHA/authorized UI requirements | High | Do not bypass; run through legitimate authorized Flow session/interaction path |
| Chrome MV3 service worker suspension | High | Persist `WorkflowRun` and `NodeRun` state; make runner resumable |
| DOM changes in Google Flow | High | Centralize selectors/behavior in adapter rather than individual nodes |
| Long video jobs | Medium | asynchronous polling + persisted waiting state |
| Extension storage limits | Medium | store metadata/graph only; avoid binary media storage |
| Gemini/API secret exposure | High | do not hard-code production API secrets; use secure backend proxy in deployed version |
| Partial Google Flow features | Medium | feature flags; verified capabilities are default MVP nodes |

---

## 12. Proposed Technology Stack

### Chrome Extension

- Manifest V3
- TypeScript
- React
- `@xyflow/react` for visual graph editor
- Chrome Side Panel
- Chrome Storage API
- Chrome Downloads API
- Chrome Identity API

### Workflow Core

- TypeScript DAG compiler
- typed node/port system
- persistent workflow-run state machine

### AI/Provider Integration

- Google Flow Adapter
- Gemini Adapter

### Optional Cloud Phase

- FastAPI or Node/Nest backend
- PostgreSQL
- secure Gemini proxy
- workflow cloud sync/share/team management

---

## 13. Expected Deliverables

1. Chrome Extension source code.
2. Visual Node Workflow Editor.
3. Workflow execution/DAG engine.
4. Google Flow Adapter.
5. Gemini Prompt Enhancement node.
6. At least one complete end-to-end generation workflow.
7. Workflow save/load.
8. Run state/history.
9. Automatic media download.
10. Proposal, SRS/Product Requirements, Architecture Driver, architecture diagrams, and test evidence.

---

## 14. Final Proposal Statement

**FlowGraph Extension** is a Chrome Extension that adds a reusable visual automation layer to Google Flow. Inspired by the node/graph workflow concept used by ComfyUI, the extension enables creators to build media-generation pipelines through drag-and-drop nodes, enhance prompts with Gemini, automatically propagate image/video outputs through subsequent Flow operations, monitor asynchronous generation, recover from failures, save workflows, and download final artifacts.

The project's core MVP is technically supported by existing runtime evidence already collected in `E:\Flow_veo`. The architecture intentionally separates stable workflow logic from Google Flow-specific implementation because Google Flow uses internal, changeable APIs and browser-session/reCAPTCHA boundaries. This makes the project both demonstrable as a Capstone and extensible into a broader AI content workflow platform.
