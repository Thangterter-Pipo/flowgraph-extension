# FlowGraph Extension

Chrome Extension (Manifest V3) cung cấp visual node workflow cho Google Flow.

## Product shape

- **Side Panel / Control Center**: account, Google Flow connection, project, credits, quick actions, run history.
- **Workflow Studio**: full-page node editor for drag/drop workflows.
- **Workflow Engine**: validate graph, compile DAG, schedule node execution, retry/resume.
- **Google Flow Bridge**: content script + adapter operating against the authorized Google Flow tab.
- **Storage**: workflow definitions, run state, templates and settings; never persist Google cookies, OAuth access tokens or reCAPTCHA tokens.

## MVP pipeline

`Prompt -> Gemini Enhance -> Text-to-Image -> Image-to-Video -> Extend Video -> Download`

## Documentation

See `docs/FLOWGRAPH_EXTENSION_PROPOSAL.md`, `docs/FLOWGRAPH_EXTENSION_ARCHITECTURE_DRIVER.md` and `docs/PROJECT_STRUCTURE.md`.
