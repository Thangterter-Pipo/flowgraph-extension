from docx import Document
from docx.shared import Cm, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_CELL_VERTICAL_ALIGNMENT
from docx.enum.section import WD_SECTION
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.enum.style import WD_STYLE_TYPE
from docx.enum.text import WD_BREAK
import os, shutil

TEMPLATE=r'E:\Flow_veo\_ctl\SE_Capstone_Proposal_Template.docx'
OUT=r'E:\Flow_veo\flowgraph-extension\docs\FlowGraph_Extension_Capstone_Proposal_2026.docx'

# ---------- helpers ----------
def set_cell_shading(cell, fill):
    tcPr=cell._tc.get_or_add_tcPr()
    shd=tcPr.find(qn('w:shd'))
    if shd is None:
        shd=OxmlElement('w:shd'); tcPr.append(shd)
    shd.set(qn('w:fill'), fill)

def set_cell_margins(cell, top=90, start=90, bottom=90, end=90):
    tc = cell._tc
    tcPr = tc.get_or_add_tcPr()
    tcMar = tcPr.first_child_found_in('w:tcMar')
    if tcMar is None:
        tcMar = OxmlElement('w:tcMar'); tcPr.append(tcMar)
    for m, v in [('top',top),('start',start),('bottom',bottom),('end',end)]:
        node = tcMar.find(qn('w:'+m))
        if node is None:
            node = OxmlElement('w:'+m); tcMar.append(node)
        node.set(qn('w:w'), str(v)); node.set(qn('w:type'),'dxa')

def set_repeat_table_header(row):
    trPr = row._tr.get_or_add_trPr()
    tblHeader = OxmlElement('w:tblHeader'); tblHeader.set(qn('w:val'),'true'); trPr.append(tblHeader)

def set_run_font(run, size=13, bold=None, italic=None, color=None, font='Times New Roman'):
    run.font.name=font
    run._element.rPr.rFonts.set(qn('w:eastAsia'), font)
    run.font.size=Pt(size)
    if bold is not None: run.bold=bold
    if italic is not None: run.italic=italic
    if color: run.font.color.rgb=RGBColor(*color)

def add_text(doc, text='', bold=False, italic=False, align=None, space_after=4, keep=False):
    p=doc.add_paragraph()
    p.style=doc.styles['Normal']
    if align is not None: p.alignment=align
    p.paragraph_format.line_spacing=1.5
    p.paragraph_format.space_after=Pt(space_after)
    p.paragraph_format.keep_with_next=keep
    r=p.add_run(text); set_run_font(r,13,bold,italic)
    return p

def add_bullet(doc, text, level=0):
    p=doc.add_paragraph(style='List Bullet' if level==0 else 'List Bullet 2')
    p.paragraph_format.line_spacing=1.5; p.paragraph_format.space_after=Pt(2)
    for r in p.runs: set_run_font(r,13)
    if not p.runs:
        r=p.add_run(text); set_run_font(r,13)
    else:
        p.runs[0].text=text
    return p

def add_number(doc, text):
    p=doc.add_paragraph(style='List Number')
    p.paragraph_format.line_spacing=1.5; p.paragraph_format.space_after=Pt(2)
    if p.runs: p.runs[0].text=text
    else: p.add_run(text)
    for r in p.runs: set_run_font(r,13)
    return p

def add_heading(doc, text, level=1):
    p=doc.add_paragraph(style=f'Heading {level}')
    p.paragraph_format.space_before=Pt(10 if level==1 else 6)
    p.paragraph_format.space_after=Pt(4)
    p.paragraph_format.keep_with_next=True
    r=p.add_run(text); set_run_font(r,14 if level==1 else 13,bold=True)
    return p

def add_table(doc, headers, rows, widths=None, header_fill='D9EAF7'):
    t=doc.add_table(rows=1, cols=len(headers))
    t.style='Table Grid'; t.alignment=WD_TABLE_ALIGNMENT.CENTER
    hdr=t.rows[0]; set_repeat_table_header(hdr)
    for i,h in enumerate(headers):
        c=hdr.cells[i]; c.vertical_alignment=WD_CELL_VERTICAL_ALIGNMENT.CENTER; set_cell_shading(c,header_fill); set_cell_margins(c)
        p=c.paragraphs[0]; p.alignment=WD_ALIGN_PARAGRAPH.CENTER; p.paragraph_format.line_spacing=1.15; p.paragraph_format.space_after=Pt(0)
        r=p.add_run(h); set_run_font(r,12,bold=True)
    for row in rows:
        cells=t.add_row().cells
        for i,val in enumerate(row):
            c=cells[i]; c.vertical_alignment=WD_CELL_VERTICAL_ALIGNMENT.TOP; set_cell_margins(c)
            p=c.paragraphs[0]; p.paragraph_format.line_spacing=1.15; p.paragraph_format.space_after=Pt(0)
            r=p.add_run(str(val)); set_run_font(r,11.5)
    if widths:
        for row in t.rows:
            for i,w in enumerate(widths): row.cells[i].width=Cm(w)
    doc.add_paragraph().paragraph_format.space_after=Pt(0)
    return t

def add_architecture_box(doc):
    t=doc.add_table(rows=1, cols=1); t.style='Table Grid'; t.alignment=WD_TABLE_ALIGNMENT.CENTER
    c=t.cell(0,0); set_cell_shading(c,'F7F8FA'); set_cell_margins(c,160,180,160,180)
    p=c.paragraphs[0]; p.alignment=WD_ALIGN_PARAGRAPH.CENTER; p.paragraph_format.line_spacing=1.15
    lines=[
        'Content Creator',
        '↓',
        'Chrome Extension UI (Side Panel + Workflow Studio)',
        '↓',
        'Workflow Engine (Graph Validator → DAG Compiler → Scheduler → Node Executors)',
        '↓',
        'Provider Adapters',
        '↙                                      ↘',
        'Gemini Prompt Enhancer          Google Flow Adapter / Content Script',
        '                                         ↓',
        '                              Authorized Google Flow Tab',
        '                                         ↓',
        '                         Image / Video Media + Download Artifacts',
        '',
        'Persistence: chrome.storage.local stores workflow definitions, run state and settings; no Flow cookies, OAuth/reCAPTCHA tokens, or signed media URLs are persisted.'
    ]
    for idx,line in enumerate(lines):
        if idx>0: p.add_run('\n')
        r=p.add_run(line); set_run_font(r,11.5,bold=(idx in [0,2,4,6,8,10,12]))
    doc.add_paragraph()

# ---------- document ----------
doc=Document(TEMPLATE)
# remove all existing body elements except section properties
body=doc._element.body
for child in list(body):
    if child.tag != qn('w:sectPr'):
        body.remove(child)

# Page setup per guided template
sec=doc.sections[0]
sec.left_margin=Cm(3.5); sec.right_margin=Cm(2.0); sec.top_margin=Cm(2.0); sec.bottom_margin=Cm(2.0)

# Style defaults
normal=doc.styles['Normal']
normal.font.name='Times New Roman'; normal._element.rPr.rFonts.set(qn('w:eastAsia'),'Times New Roman'); normal.font.size=Pt(13)
normal.paragraph_format.line_spacing=1.5; normal.paragraph_format.space_after=Pt(4)
for nm,size,bold in [('Title',20,True),('Heading 1',14,True),('Heading 2',13,True)]:
    st=doc.styles[nm]; st.font.name='Times New Roman'; st._element.rPr.rFonts.set(qn('w:eastAsia'),'Times New Roman'); st.font.size=Pt(size); st.font.bold=bold

# title
p=doc.add_paragraph(style='Title'); p.alignment=WD_ALIGN_PARAGRAPH.CENTER
r=p.add_run('SOFTWARE ENGINEERING CAPSTONE PROJECT PROPOSAL'); set_run_font(r,20,bold=True)
p.paragraph_format.space_after=Pt(8)
p2=doc.add_paragraph(); p2.alignment=WD_ALIGN_PARAGRAPH.CENTER; p2.paragraph_format.space_after=Pt(14)
r=p2.add_run('FlowGraph Extension – Visual Workflow Builder for Google Flow'); set_run_font(r,15,bold=True,color=(78,42,132))

# 1
add_heading(doc,'1. Project Title')
add_text(doc,'FlowGraph Extension – Visual Workflow Builder for Google Flow',bold=True)
add_text(doc,'Project type: Chrome Extension / AI Content Creation / Visual Workflow Automation.')

# 2
add_heading(doc,'2. Team Members')
add_table(doc,['No.','Full Name','Student ID','Email','Primary Role'],[
    ['1','[Member 1]','[Student ID]','[Email]','Project Manager / Full-stack Developer'],
    ['2','[Member 2]','[Student ID]','[Email]','Frontend / Workflow UI Developer'],
    ['3','[Member 3]','[Student ID]','[Email]','Google Flow Integration Developer'],
    ['4','[Member 4]','[Student ID]','[Email]','AI / Testing / Documentation'],
], widths=[1.0,4.0,3.0,5.0,5.0])
add_text(doc,'Note: Replace placeholders with the official team information before submission.',italic=True)

# 3
add_heading(doc,'3. Supervisor(s)')
add_table(doc,['Full Name','Department / Organization','Email','Role'],[
    ['[Supervisor Name]','[Department / Faculty]','[Email]','Academic Supervisor'],
    ['[Co-supervisor, if any]','[Organization]','[Email]','Co-supervisor / Industry Mentor'],
], widths=[5,5,5,4])

# 4
add_heading(doc,'4. Problem Statement')
add_text(doc,'Google Flow provides strong AI image and video generation capabilities, but repeatable multi-step content production still requires many manual actions. A creator may need to refine a prompt, generate an image, select that image as a video input, wait for an asynchronous video job, extend or edit the video, and finally download the result. The same sequence has to be repeated for every project.')
add_text(doc,'This causes four main problems:')
for x in [
    'High manual effort when executing multi-step image/video pipelines.',
    'Intermediate media must be selected and passed between steps manually, increasing mistakes and repeated work.',
    'Long-running generation jobs require monitoring, while failures often force users to repeat completed steps.',
    'There is no user-defined reusable visual workflow that captures and shares the production process as a graph.'
]: add_bullet(doc,x)
add_text(doc,'FlowGraph Extension addresses these problems by adding a visual workflow layer directly beside Google Flow. Users create a reusable node graph, connect typed inputs/outputs, run the graph as a dependency-aware workflow, monitor node states, and automatically propagate Google Flow media references to downstream nodes.')

# 5
add_heading(doc,'5. Survey / Existing Solutions')
add_table(doc,['Solution','Strengths','Limitations for This Problem','How FlowGraph Differs'],[
    ['Google Flow','High-quality Google image/video generation; project and media workspace.','Primarily operation-by-operation interaction; no user-defined visual DAG for reusable multi-step automation.','Keeps Google Flow as the generation runtime but adds a reusable node-based orchestration layer.'],
    ['ComfyUI','Visual node/graph workflow, reusable pipelines, workflow JSON concept.','Focused on its own model/node ecosystem rather than controlling Google Flow sessions and media workflows.','Adopts the visual workflow idea, but defines Google-Flow-specific nodes, MediaRef passing, session handling, monitoring, and download behavior.'],
    ['Manual prompt + browser workflow','Simple and requires no additional tool.','Slow, repetitive, difficult to reproduce and share; no execution history or automatic retry/resume.','Automates repeatable steps while preserving the authorized Google Flow browser session.'],
], widths=[3.3,5.0,6.3,6.0])
add_text(doc,'The project is not intended to clone ComfyUI or replace Google Flow. Its contribution is a Chrome Extension workflow/orchestration layer specialized for Google Flow.')

# 6
add_heading(doc,'6. Objectives and Scope')
add_heading(doc,'6.1 General Objective',2)
add_text(doc,'Develop a Chrome Extension that enables content creators to visually design, validate, execute, save, reuse, and monitor Google Flow media-generation workflows using a node-based interface.')
add_heading(doc,'6.2 Specific Objectives',2)
for x in [
    'Provide a drag-and-drop visual workflow editor with typed input/output ports.',
    'Compile the visual graph into an executable DAG and run nodes in dependency order.',
    'Integrate Gemini-based prompt enhancement and core Google Flow generation operations.',
    'Pass image/video media references automatically between compatible nodes.',
    'Persist workflow definitions and execution state so interrupted runs can resume after Chrome MV3 service-worker suspension.',
    'Provide visible node status, retry-from-failure behavior, execution history, preview, and automatic final download.',
    'Demonstrate at least one complete Prompt → Gemini Enhance → Text-to-Image → Image-to-Video → Extend Video → Download workflow.'
]: add_bullet(doc,x)
add_heading(doc,'6.3 MVP Scope',2)
add_table(doc,['In Scope (MVP)','Out of Scope / Later Phase'],[
    ['Google Account identity; Google Flow connection status; Side Panel control center; full-page Workflow Studio; Prompt/Gemini/T2I/T2V/I2V/Extend/Download nodes; workflow save/load; execution state/history; retry/resume; automatic download.','Native mobile app; social-media publishing; marketplace/payment; multi-provider video generation; distributed worker farm; storing/replaying Google Flow credentials.'],
    ['Experimental nodes are feature-flagged and not required for MVP acceptance.','Image Transform, Image Upsample, Video Upsample, Cancel ACTIVE and full Character/Likeness creation remain experimental because current API evidence is runtime-partial.'],
], widths=[9.2,9.2])

# 7
add_heading(doc,'7. Key Features & Requirements')
add_heading(doc,'7.1 Key Features',2)
for x in [
    'Visual Workflow Studio inspired by node-based workflow tools: drag, drop, connect, configure, save and reuse.',
    'Side Panel Control Center showing Google account, Google Flow connection, project, credits, last run and quick actions.',
    'Gemini Prompt Enhancer with styles such as Cinematic, Realistic, Artistic, Advertising, Anime and Custom.',
    'Google Flow media nodes for Text-to-Image, Text-to-Video, Image-to-Video, Extend/Edit Video and Download.',
    'Automatic MediaRef propagation so downstream nodes reuse mediaId instead of manual re-upload/re-selection.',
    'Execution monitoring with READY, QUEUED, RUNNING, WAITING_PROVIDER, SUCCESS, FAILED and SKIPPED states.',
    'Workflow persistence, run history, retry node, retry from here, and automatic artifact download.'
]: add_bullet(doc,x)
add_heading(doc,'7.2 Functional Requirements',2)
add_table(doc,['ID','Requirement'],[
    ['FR01','The system shall allow the user to sign in to the extension with a Google identity and sign out.'],
    ['FR02','The system shall detect and display Google Flow connection/project status before a Flow-dependent run starts.'],
    ['FR03','The system shall allow users to create, edit, connect, delete and configure workflow nodes on a visual canvas.'],
    ['FR04','The system shall validate required inputs, connection types, configuration errors and graph cycles before execution.'],
    ['FR05','The system shall compile a valid workflow into a dependency graph and execute nodes in dependency order.'],
    ['FR06','The system shall support Gemini prompt enhancement and core Google Flow nodes required by the MVP.'],
    ['FR07','The system shall normalize Google Flow image/video outputs into internal MediaRef objects for downstream nodes.'],
    ['FR08','The system shall monitor asynchronous media generation until a terminal success or failure state.'],
    ['FR09','The system shall persist workflow definitions and run states locally and restore an interrupted run.'],
    ['FR10','The system shall allow retry of a failed node without unnecessarily rerunning already successful predecessors.'],
    ['FR11','The system shall keep execution history and sanitized logs without storing sensitive authentication material.'],
    ['FR12','The system shall download the final media artifact through a Download node.'],
], widths=[2.0,16.2])
add_heading(doc,'7.3 Non-Functional Requirements',2)
add_table(doc,['ID','Quality Attribute','Target / Requirement'],[
    ['NFR01','Usability','A new user should be able to build and run a basic workflow within 5 minutes after connection setup.'],
    ['NFR02','Performance','Common canvas interactions should feel immediate; graph validation target < 500 ms for typical MVP graphs.'],
    ['NFR03','Reliability','Completed predecessor nodes must not be repeated after an unrelated downstream failure unless the user requests a full rerun.'],
    ['NFR04','Recoverability','WorkflowRun/NodeRun state must survive MV3 service-worker suspension and be resumable.'],
    ['NFR05','Security & Privacy','Do not persist Google passwords, Flow cookies, Flow OAuth tokens, reCAPTCHA tokens or signed media URLs in workflow storage.'],
    ['NFR06','Modifiability','New node/provider implementations should be added through NodeExecutor/Adapter contracts without changing the DAG core.'],
    ['NFR07','Compatibility','Google Flow DOM/API-specific logic must be centralized in GoogleFlowAdapter/Flow content-script modules.'],
    ['NFR08','Auditability','Each run shall record node status, duration, sanitized input/output references and errors.'],
], widths=[2.0,4.2,12.0])

# 8
add_heading(doc,'8. Constraints and Assumptions')
add_table(doc,['Type','Item'],[
    ['Constraint','Google Flow uses internal/changeable web and API surfaces; endpoints, model registry and DOM selectors may change.'],
    ['Constraint','Some Flow mutations are protected by browser-session and reCAPTCHA Enterprise behavior; the project must not bypass security controls.'],
    ['Constraint','Chrome Manifest V3 service workers can be suspended; long-running workflow state cannot exist only in memory.'],
    ['Constraint','Extension storage is intended for workflow/state metadata, not large media binaries or sensitive credentials.'],
    ['Constraint','The project must be demonstrable within the Capstone schedule; MVP therefore prioritizes runtime-verified Google Flow capabilities.'],
    ['Assumption','Users have a modern Chromium-based browser, internet access and a valid Google account with access to Google Flow.'],
    ['Assumption','Users remain responsible for Google Flow usage terms, generated content review and credit consumption.'],
    ['Assumption','Official team information and supervisor details will be inserted before final submission.'],
], widths=[3.0,15.2])

# 9
add_heading(doc,'9. Target Users / Stakeholders')
add_table(doc,['Stakeholder','Needs / Expected Benefits'],[
    ['AI Content Creator','Build repeatable image/video pipelines with fewer manual actions; reuse prompts/media flows; obtain final outputs faster.'],
    ['Prompt Engineer','Create reusable prompt-enhancement steps and standardize prompt styles across workflows.'],
    ['Video / Marketing Team','Reuse approved workflows, view execution history and share a consistent production process.'],
    ['Development Team','Maintain modular node/provider integrations and test Google Flow compatibility independently from the workflow core.'],
    ['Supervisor / Evaluator','Review a clear, demonstrable software-engineering problem involving extension architecture, workflow orchestration, persistence and external-system integration.'],
], widths=[4.5,13.7])

# 10
add_heading(doc,'10. Technology Stack')
add_table(doc,['Layer','Proposed Technology','Purpose'],[
    ['Chrome Extension','Manifest V3, Chrome Side Panel, Identity, Storage, Downloads, Runtime Messaging','Extension lifecycle, identity, persistence, downloads and communication.'],
    ['Frontend / Studio','React, TypeScript, @xyflow/react, CSS/Tailwind (optional)','Side Panel UI and full-page node workflow editor.'],
    ['Workflow Core','TypeScript, Graph Validator, DAG Compiler, NodeExecutor registry, state machine','Validation, dependency scheduling, retry/resume and execution state.'],
    ['Google Flow Integration','Content Script + GoogleFlowAdapter','Centralizes Google Flow UI/API/session behavior and normalizes results into MediaRef.'],
    ['AI','Gemini Adapter / Gemini API or secure proxy','Prompt enhancement and style transformation.'],
    ['Persistence','chrome.storage.local; IndexedDB if larger structured cache is needed','Workflow JSON, settings, run state, history and cache metadata.'],
    ['Testing','Vitest/Jest, React Testing Library, Playwright/Chrome extension E2E','Unit, integration and browser-extension workflow tests.'],
    ['Optional Cloud Phase','FastAPI or Node/NestJS + PostgreSQL','Workflow sharing, cloud sync, teams and secure Gemini proxy.'],
], widths=[3.3,5.5,9.4])

# 11
add_heading(doc,'11. Methodology & Development Plan')
add_text(doc,'The project will use Agile/Scrum with short iterative sprints. The plan below is a proposed 12-week implementation schedule and should be adjusted to the official Capstone calendar.')
add_table(doc,['Phase','Weeks','Main Activities','Main Output'],[
    ['Sprint 0 – Foundation','1–2','Finalize requirements, architecture, extension skeleton, authentication/Flow connection prototype.','Proposal, Architecture Driver, running MV3 skeleton.'],
    ['Sprint 1 – Visual Studio','3–4','Build Side Panel, full-page Workflow Studio, node library, typed ports, save/load graph.','Usable drag-and-drop editor.'],
    ['Sprint 2 – Workflow Engine','5–6','Graph validation, DAG compilation, execution state, persistence, retry/resume.','Executable local node graph.'],
    ['Sprint 3 – Google Flow Integration','7–8','Implement GoogleFlowAdapter and core T2I/T2V/I2V/Extend/Download nodes.','End-to-end Flow generation path.'],
    ['Sprint 4 – Gemini & UX','9–10','Gemini enhancement node, previews, logs, run history, error UX, compatibility handling.','Integrated MVP workflow.'],
    ['Sprint 5 – Stabilization','11–12','E2E testing, performance/robustness fixes, documentation, demo script and final report.','Submission-ready product and evidence.'],
], widths=[3.5,2.0,8.0,5.0])

# 12
add_heading(doc,'12. System Architecture Overview')
add_text(doc,'The proposed architecture follows a layered Chrome Extension design. The visual graph is separated from the execution graph, and all provider-specific Google Flow behavior is isolated behind an adapter/content-script boundary. This reduces the impact of future Google Flow UI/API changes on the workflow engine.')
add_architecture_box(doc)
add_text(doc,'Key architecture decisions:')
for x in [
    'Side Panel acts as the connection/control center; the full-page Extension Studio provides enough space for the node canvas.',
    'UI Workflow Graph and Execution DAG are separate representations. The visual graph is validated and compiled before execution.',
    'The workflow engine is provider-agnostic; GoogleFlowAdapter and GeminiAdapter implement external-system behavior.',
    'Google Flow runtime uses the authorized browser session. Extension identity and Flow runtime session are treated as separate states.',
    'Workflow and run state are persisted locally so long-running jobs can resume after service-worker suspension.',
    'Sensitive Flow credentials are not stored in workflow JSON or extension persistent storage.'
]: add_bullet(doc,x)

# 13
add_heading(doc,'13. Potential Risks and Mitigation Strategies')
add_table(doc,['Risk','Likelihood','Impact','Mitigation'],[
    ['Google Flow internal API/DOM changes','High','High','Centralize provider logic in GoogleFlowAdapter; maintain runtime compatibility checks; avoid hard-coded provider logic in nodes.'],
    ['reCAPTCHA / authorized interaction restrictions','Medium','High','Do not bypass controls; use legitimate authorized browser interaction; keep unsupported behaviors feature-flagged.'],
    ['MV3 worker suspension during long jobs','High','High','Persist WorkflowRun/NodeRun state and implement idempotent resume/poll logic.'],
    ['Long/failed video generation','Medium','Medium','Asynchronous status monitoring, timeout/error mapping, Retry Node and Retry From Here.'],
    ['Gemini/API secret exposure','Medium','High','Never hard-code production secrets; use approved OAuth/client configuration or a secure backend proxy.'],
    ['Schedule overrun from too many features','Medium','High','Keep MVP limited to verified core nodes; move experimental APIs, cloud sync and team sharing to later phases.'],
    ['Generated content quality varies','Medium','Medium','Use prompt enhancement presets, preview, retry and user review; do not claim deterministic media quality.'],
], widths=[5.0,2.4,2.4,8.5])

# 14
add_heading(doc,'14. Expected Outcomes / Deliverables')
for x in [
    'A working Chrome Extension (Manifest V3) with Side Panel Control Center and full-page Workflow Studio.',
    'Visual node editor with typed connections, graph validation and workflow save/load.',
    'Workflow execution engine with DAG compilation, persisted run state, retry/resume and execution history.',
    'GoogleFlowAdapter and core Google Flow generation nodes for the MVP.',
    'Gemini Prompt Enhance node and configurable prompt styles.',
    'End-to-end demo workflow: Prompt → Gemini Enhance → Text-to-Image → Image-to-Video → Extend Video → Download.',
    'Automatic media output preview/download and sanitized execution logs.',
    'Source code, automated tests and technical evidence.',
    'Software Engineering documents: Proposal, SRS/Product Requirements, Architecture Driver, architecture diagrams, testing report, user guide and final Capstone report/demo video.'
]: add_bullet(doc,x)

# 15
add_heading(doc,'15. References')
refs=[
    '[1] Comfy-Org, “ComfyUI – A powerful and modular visual AI engine,” GitHub repository. Available: https://github.com/Comfy-Org/ComfyUI',
    '[2] Google Chrome Developers, “Chrome Extensions – Manifest V3.” Available: https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3',
    '[3] Google Chrome Developers, “chrome.sidePanel API.” Available: https://developer.chrome.com/docs/extensions/reference/api/sidePanel',
    '[4] Google Chrome Developers, “The extension service worker lifecycle.” Available: https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle',
    '[5] Google Chrome Developers, “chrome.storage API.” Available: https://developer.chrome.com/docs/extensions/reference/api/storage',
    '[6] Project technical evidence, “Google Flow API Reference 2.0.0,” E:\\Flow_veo\\GOOGLE_FLOW_API_REFERENCE.md, runtime-verified/partial evidence collected in 2026.',
    '[7] Project document, “FlowGraph Extension Architecture Driver,” flowgraph-extension/docs/FLOWGRAPH_EXTENSION_ARCHITECTURE_DRIVER.md, 2026.'
]
for ref in refs: add_text(doc,ref,space_after=2)

# Footer
for section in doc.sections:
    footer=section.footer.paragraphs[0]
    footer.alignment=WD_ALIGN_PARAGRAPH.CENTER
    r=footer.add_run('FlowGraph Extension – Software Engineering Capstone Proposal 2026')
    set_run_font(r,9,color=(100,100,100))

# enforce font on table/paragraph runs
for p in doc.paragraphs:
    if p.style.name not in ['Title','Heading 1','Heading 2']:
        p.paragraph_format.line_spacing=1.5
    for r in p.runs:
        if r.font.name is None: set_run_font(r,13)

os.makedirs(os.path.dirname(OUT),exist_ok=True)
doc.save(OUT)
print(OUT)
print(os.path.getsize(OUT))
