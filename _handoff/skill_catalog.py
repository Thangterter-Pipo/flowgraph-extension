from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import Any

LAYERS = {
    "flow": 0,
    "foundation": 1,
    "story": 2,
    "craft": 3,
    "continuity": 4,
    "prompt": 5,
    "strategy": 6,
    "genre": 7,
    "qc": 8,
    "failure": 9,
    "orchestration": 10,
}

@dataclass(frozen=True)
class SkillDef:
    id: str
    responsibility: str
    dependencies: tuple[str, ...] = ()
    optional_dependencies: tuple[str, ...] = ()
    consumes: tuple[str, ...] = ()
    produces: tuple[str, ...] = ()
    evidence_level: str = "n/a"
    determinism: str = "heuristic"
    side_effects: str = "none"
    reference: str = ""
    endpoint: str = ""
    runtime_note: str = ""

    @property
    def category(self) -> str:
        return self.id.split("/", 1)[0]

    @property
    def slug(self) -> str:
        return self.id.split("/", 1)[1]

    @property
    def layer(self) -> int:
        return LAYERS[self.category]

    @property
    def name(self) -> str:
        return " ".join(word.upper() if word in {"qc", "ugc", "veo"} else word.capitalize() for word in self.slug.split("-"))

    def as_plan(self) -> dict[str, Any]:
        d = asdict(self)
        d.update({"version": "1.0.0", "name": self.name, "category": self.category, "layer": self.layer})
        d["dependencies"] = list(self.dependencies)
        d["optional_dependencies"] = list(self.optional_dependencies)
        d["consumes"] = list(self.consumes)
        d["produces"] = list(self.produces)
        return d

S: list[SkillDef] = []
def add(id: str, responsibility: str, **kwargs: Any) -> None:
    S.append(SkillDef(id=id, responsibility=responsibility, **kwargs))

# L0 Flow runtime
add("flow/browser-session", "Attach to the authorized user's Chrome over loopback CDP and expose a controlled page session.", consumes=("project_bible",), produces=("generation_record",), evidence_level="RUNTIME_VERIFIED", determinism="deterministic", side_effects="network", reference="§18.1", endpoint="local CDP 127.0.0.1:9222", runtime_note="Local browser helper; no standalone Google backend endpoint.")
add("flow/overlay-handler", "Dismiss allowlisted product overlays while refusing security, identity, payment, and verification surfaces.", dependencies=("flow/browser-session",), consumes=("generation_record",), produces=("generation_record",), evidence_level="RUNTIME_VERIFIED", determinism="deterministic", side_effects="network", reference="§18.1", endpoint="local browser DOM only", runtime_note="The helper is explicitly denylisted from reCAPTCHA/security/payment UI.")
add("flow/auth-session", "Retrieve the authorized BFF session and expose bearer metadata without persisting secret material.", dependencies=("flow/browser-session",), produces=("generation_record",), evidence_level="RUNTIME_VERIFIED", determinism="deterministic", side_effects="network", reference="§3.1", endpoint="GET https://labs.google/fx/api/auth/session")
add("flow/project-create", "Create a Google Flow project and return the verified project identifier.", dependencies=("flow/auth-session",), consumes=("project_bible",), produces=("project_manifest",), evidence_level="RUNTIME_VERIFIED", determinism="deterministic", side_effects="network", reference="§4.1", endpoint="POST https://labs.google/fx/api/trpc/project.createProject")
add("flow/model-resolver", "Resolve an abstract media capability to an evidence-labelled current model key without guessing missing registry entries.", consumes=("generation_plan",), produces=("generation_plan",), evidence_level="RUNTIME_VERIFIED", determinism="deterministic", reference="§11", endpoint="local model_registry/registry.json resolver", runtime_note="Local registry resolver; full 82-key normalized registry is referenced by source documentation but not present in this repo.")
add("flow/credit-check", "Read live credit balance and account tier before a credit-bearing operation is committed.", dependencies=("flow/auth-session",), produces=("generation_record",), evidence_level="RUNTIME_VERIFIED", determinism="deterministic", side_effects="network", reference="§18.2", endpoint="GET https://aisandbox-pa.googleapis.com/v1/credits")
add("flow/media-upload-image", "Upload raw Base64 image bytes through the verified imageBytes field and return mediaId.", dependencies=("flow/browser-session", "flow/auth-session"), produces=("generation_record",), evidence_level="RUNTIME_VERIFIED", determinism="deterministic", side_effects="network", reference="§6.1", endpoint="POST https://aisandbox-pa.googleapis.com/v1/flow/uploadImage")
add("flow/image-text-to-image", "Generate a still image from text for controlled references, start frames, and design exploration.", dependencies=("flow/browser-session", "flow/model-resolver"), consumes=("generation_plan",), produces=("generation_record",), evidence_level="RUNTIME_VERIFIED", determinism="generative", side_effects="credits", reference="§7.1", endpoint="POST https://aisandbox-pa.googleapis.com/v1/projects/{projectId}/flowMedia:batchGenerateImages")
add("flow/image-transform", "Transform or re-aspect an existing image media using the recognized root mediaId payload shape.", dependencies=("flow/browser-session",), consumes=("generation_record",), produces=("generation_record",), evidence_level="RUNTIME_PARTIAL", determinism="deterministic", side_effects="network", reference="§7.2", endpoint="POST https://aisandbox-pa.googleapis.com/v1/flow:transformImage")
add("flow/image-upsample", "Request 2K or 4K still upsampling with the verified targetResolution enums while preserving partial-runtime warnings.", dependencies=("flow/browser-session",), consumes=("generation_record",), produces=("generation_record",), evidence_level="RUNTIME_PARTIAL", determinism="deterministic", side_effects="credits", reference="§7.3", endpoint="POST https://aisandbox-pa.googleapis.com/v1/flow/upsampleImage")
add("flow/video-text-to-video", "Submit a text-only video generation using a resolver-selected model and authorized browser security context.", dependencies=("flow/browser-session", "flow/model-resolver", "flow/credit-check"), consumes=("generation_plan",), produces=("generation_record",), evidence_level="RUNTIME_VERIFIED", determinism="generative", side_effects="credits", reference="§8.1", endpoint="POST https://aisandbox-pa.googleapis.com/v1/video:batchAsyncGenerateVideoText")
add("flow/video-image-to-video", "Submit an image-anchored video generation using startImage.mediaId as the verified reference shape.", dependencies=("flow/browser-session", "flow/model-resolver", "flow/credit-check"), consumes=("generation_plan", "generation_record"), produces=("generation_record",), evidence_level="RUNTIME_VERIFIED", determinism="generative", side_effects="credits", reference="§8.2", endpoint="POST https://aisandbox-pa.googleapis.com/v1/video:batchAsyncGenerateVideoStartImage")
add("flow/video-start-end-interpolation", "Submit video generation constrained by verified startImage.mediaId and endImage.mediaId anchors.", dependencies=("flow/browser-session", "flow/model-resolver", "flow/credit-check"), consumes=("generation_plan", "generation_record"), produces=("generation_record",), evidence_level="RUNTIME_VERIFIED", determinism="generative", side_effects="credits", reference="§8.3", endpoint="POST https://aisandbox-pa.googleapis.com/v1/video:batchAsyncGenerateVideoStartAndEndImage")
add("flow/video-reference-images", "Submit reference-guided video generation using mediaId plus IMAGE_USAGE_TYPE_ASSET for every reference image.", dependencies=("flow/browser-session", "flow/model-resolver", "flow/credit-check"), consumes=("generation_plan", "generation_record"), produces=("generation_record",), evidence_level="RUNTIME_VERIFIED", determinism="generative", side_effects="credits", reference="§8.4", endpoint="POST https://aisandbox-pa.googleapis.com/v1/video:batchAsyncGenerateVideoReferenceImages")
add("flow/video-edit-extend", "Submit an edit or extension request against videoInput.mediaId without replacing the source-media identity contract.", dependencies=("flow/browser-session", "flow/model-resolver", "flow/credit-check"), consumes=("generation_plan", "generation_record"), produces=("generation_record",), evidence_level="RUNTIME_VERIFIED", determinism="generative", side_effects="credits", reference="§8.5", endpoint="POST https://aisandbox-pa.googleapis.com/v1/video:batchAsyncGenerateVideoEditVideo")
add("flow/video-upsample", "Request video upsampling through videoInput.mediaId while exposing the capability as runtime-partial rather than guaranteed delivery.", dependencies=("flow/browser-session", "flow/model-resolver", "flow/credit-check"), consumes=("generation_record",), produces=("generation_record",), evidence_level="RUNTIME_PARTIAL", determinism="deterministic", side_effects="credits", reference="§8.6", endpoint="POST https://aisandbox-pa.googleapis.com/v1/video:batchAsyncGenerateVideoUpsampleVideo")
add("flow/generation-poller", "Poll asynchronous video generation state and map backend media status into typed runtime state.", dependencies=("flow/auth-session",), consumes=("generation_record",), produces=("generation_record",), evidence_level="RUNTIME_VERIFIED", determinism="deterministic", side_effects="network", reference="§13", endpoint="POST https://aisandbox-pa.googleapis.com/v1/video:batchCheckAsyncVideoGenerationStatus")
add("flow/media-download", "Resolve the verified media redirect and persist the returned MP4 artifact with integrity metadata.", dependencies=("flow/auth-session",), consumes=("generation_record",), produces=("generation_record",), evidence_level="RUNTIME_VERIFIED", determinism="deterministic", side_effects="filesystem", reference="§15", endpoint="GET https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name={mediaId}")
add("flow/generation-cancel", "Request generation cancellation by mediaId while treating FAILED_PRECONDITION behavior as a runtime-partial outcome.", dependencies=("flow/browser-session",), consumes=("generation_record",), produces=("generation_record",), evidence_level="RUNTIME_PARTIAL", determinism="deterministic", side_effects="network", reference="§14", endpoint="POST https://aisandbox-pa.googleapis.com/v1/flowMedia:cancelGeneration")
add("flow/character-slot-assignment", "Check likeness eligibility, inspect existing likenesses, and assign a mediaId to a character image slot.", dependencies=("flow/browser-session", "flow/media-upload-image"), consumes=("character_bible", "generation_record"), produces=("character_bible",), evidence_level="RUNTIME_VERIFIED", determinism="deterministic", side_effects="network", reference="§10.1–§10.4", endpoint="GET /v1/flow/likeness:checkEligibility + GET /v1/flow/likeness:listUserLikenesses + POST /v1/flow:copyProjectMedia")
add("flow/error-classifier", "Classify HTTP, public-error, schema, security, precondition, generation, and CDP transport failures into retry-safe categories.", consumes=("generation_record",), produces=("generation_record",), evidence_level="RUNTIME_VERIFIED", determinism="deterministic", reference="§16 and §18.2", endpoint="local classifier over observed runtime responses", runtime_note="Local classifier; it must preserve the distinction between transport failure and generation failure.")

# L1 Foundation
add("foundation/project-intake", "Convert a natural-language brief into a validated project bible while inferring and declaring safe defaults.", produces=("project_bible",))
add("foundation/creative-director", "Set the single controlling creative idea and tonal boundaries that every downstream department must serve.", dependencies=("foundation/project-intake",), consumes=("project_bible",), produces=("project_bible",))
add("foundation/visual-bible-builder", "Fix project-wide camera, lighting, color, texture, and motion policy as a persistent visual bible.", dependencies=("foundation/creative-director",), consumes=("project_bible",), produces=("visual_bible",))
add("foundation/brand-bible-builder", "Encode brand codes, forbidden codes, product-hero rules, and client-supplied claims without inventing claims.", dependencies=("foundation/project-intake",), consumes=("project_bible",), produces=("brand_bible",))
add("foundation/character-bible-builder", "Persist each character identity contract with observable attributes, continuity anchors, and reference media identifiers.", dependencies=("foundation/project-intake",), consumes=("project_bible",), produces=("character_bible",))

# L2 Story
add("story/concept-developer", "Generate and select the concept that best delivers the controlling idea within duration, platform, and production constraints.", dependencies=("foundation/creative-director",), consumes=("project_bible",), produces=("project_bible",))
add("story/story-architect", "Structure the piece into ordered beats with an explicit dramatic or persuasive function for each beat.", dependencies=("story/concept-developer",), consumes=("project_bible",), produces=("project_bible",))
add("story/screenwriter", "Write scene action, dialogue, and voiceover timing that fits the target duration and controlling idea.", dependencies=("story/story-architect",), consumes=("project_bible",), produces=("project_bible",))
add("story/hook-designer", "Design the opening attention contract for short-form and paid placements without sacrificing message clarity.", dependencies=("foundation/creative-director",), consumes=("project_bible",), produces=("project_bible",))
add("story/scene-designer", "Turn a story beat into staged dramatic geography with location, time, participants, and action relationships.", dependencies=("story/story-architect",), consumes=("project_bible",), produces=("project_bible",))
add("story/shot-list-designer", "Break staged scenes into a coverage plan with narrative function, transition logic, and target duration per shot.", dependencies=("story/scene-designer",), consumes=("project_bible",), produces=("shot_spec",))
add("story/shot-spec-builder", "Assemble the canonical shot specification skeleton that craft departments populate without embedding taste decisions.", dependencies=("story/shot-list-designer",), consumes=("shot_spec",), produces=("shot_spec",), determinism="deterministic")

# L3 Craft
add("craft/cinematography-director", "Choose shot size, camera angle, height, and camera-to-subject distance from coverage intent and spatial psychology.", dependencies=("story/shot-spec-builder",), consumes=("shot_spec", "visual_bible"), produces=("shot_spec",))
add("craft/lens-director", "Select focal length, format character, aperture behavior, and focus strategy from subject distance and narrative intent.", dependencies=("craft/cinematography-director",), consumes=("shot_spec", "visual_bible"), produces=("shot_spec",))
add("craft/camera-movement-director", "Design motivated camera path, velocity profile, rig character, and stabilization policy for each shot.", dependencies=("craft/cinematography-director",), consumes=("shot_spec", "visual_bible"), produces=("shot_spec",))
add("craft/composition-director", "Design frame architecture and aspect-ratio adaptation so hierarchy, balance, and safe areas serve the story.", dependencies=("craft/cinematography-director",), consumes=("shot_spec", "visual_bible"), produces=("shot_spec",))
add("craft/blocking-director", "Stage subject placement, movement, eyelines, and screen direction so action remains legible across coverage.", dependencies=("story/scene-designer",), consumes=("shot_spec",), produces=("shot_spec",))
add("craft/lighting-director", "Design the complete motivated lighting system including source roles, ratios, quality, direction, practicals, and exposure intent.", dependencies=("story/shot-spec-builder", "foundation/visual-bible-builder"), consumes=("shot_spec", "visual_bible"), produces=("shot_spec",))
add("craft/color-director", "Define production palette, camera rendering, grade intent, skin-tone policy, texture, grain, and highlight behavior.", dependencies=("foundation/visual-bible-builder", "craft/lighting-director"), consumes=("shot_spec", "visual_bible"), produces=("shot_spec",))
add("craft/production-designer", "Design environment, set, architecture, props, materials, surface wear, era cues, and world detail for the scene.", dependencies=("story/scene-designer", "foundation/visual-bible-builder"), consumes=("shot_spec", "visual_bible"), produces=("shot_spec",))
add("craft/costume-stylist", "Design wardrobe silhouette, fabric behavior, accessories, and palette relationships for character and brand intent.", dependencies=("foundation/character-bible-builder",), consumes=("shot_spec", "character_bible", "brand_bible"), produces=("shot_spec",))
add("craft/hair-makeup-director", "Design hair and makeup with explicit continuity anchors and interaction with beauty, key, and practical lighting.", dependencies=("foundation/character-bible-builder", "craft/lighting-director"), consumes=("shot_spec", "character_bible"), produces=("shot_spec",))
add("craft/character-designer", "Design a character's observable physical identity, movement signature, and emotional baseline for generatable consistency.", dependencies=("foundation/project-intake",), consumes=("project_bible",), produces=("character_bible",))
add("craft/performance-director", "Translate emotional intent into observable facial, body, gesture, eyeline, and interaction behavior that can be generated.", dependencies=("story/screenwriter", "story/shot-spec-builder"), consumes=("shot_spec", "character_bible"), produces=("shot_spec",))
add("craft/motion-director", "Specify physically plausible motion for subjects, cloth, hair, particles, vehicles, liquids, and crowds at shot scale.", dependencies=("story/shot-spec-builder", "craft/camera-movement-director"), consumes=("shot_spec",), produces=("shot_spec",))
add("craft/temporal-designer", "Design shot duration, internal tempo, slow-motion intent, speed changes, and transition rhythm across a sequence.", dependencies=("story/shot-list-designer",), consumes=("shot_spec", "project_bible"), produces=("shot_spec",))
add("craft/sound-design-director", "Specify sound effects, ambience, music, and dialogue intent as creative metadata without asserting an unverified audio runtime.", dependencies=("story/screenwriter", "craft/temporal-designer"), consumes=("shot_spec", "project_bible"), produces=("shot_spec",))

# L4 Continuity
add("continuity/continuity-supervisor", "Validate each shot against prior continuity state across identity, wardrobe, props, space, light, camera, motion, time, color, and environment.", dependencies=("story/shot-spec-builder", "foundation/character-bible-builder", "foundation/visual-bible-builder"), consumes=("shot_spec", "continuity_state", "character_bible", "visual_bible"), produces=("continuity_state",))
add("continuity/continuity-state-manager", "Persist, version, and query immutable continuity-state snapshots across the project timeline.", dependencies=("continuity/continuity-supervisor",), consumes=("continuity_state",), produces=("continuity_state",), determinism="deterministic", side_effects="filesystem")

# L5 Prompt
add("prompt/veo-prompt-architect", "Compose a structured shot specification into a natural-language Veo prompt appropriate to the selected generation method.", dependencies=("continuity/continuity-supervisor",), consumes=("shot_spec", "continuity_state", "generation_plan"), produces=("generation_plan",), determinism="generative")
add("prompt/negative-constraint-designer", "Emit only avoidance constraints justified by named generation risks while avoiding generic negative-prompt spam.", dependencies=("continuity/continuity-supervisor",), consumes=("shot_spec", "continuity_state"), produces=("generation_plan",))
add("prompt/prompt-conflict-detector", "Detect self-contradictory camera, lens, lighting, motion, subject, and temporal instructions before generation spend.", dependencies=("prompt/veo-prompt-architect",), consumes=("generation_plan",), produces=("generation_plan",), determinism="deterministic")
add("prompt/veo-prompt-validator", "Verify prompt completeness, grounding, continuity anchors, and absence of unmotivated cinematic vocabulary before spend.", dependencies=("prompt/prompt-conflict-detector", "prompt/negative-constraint-designer"), consumes=("generation_plan", "shot_spec"), produces=("generation_plan",), determinism="deterministic")
add("prompt/prompt-compressor", "Reduce a validated prompt to load-bearing visual instructions without removing identity, continuity, or motion constraints.", dependencies=("prompt/veo-prompt-validator",), consumes=("generation_plan",), produces=("generation_plan",))

# L6 Strategy
add("strategy/generation-method-router", "Choose text-to-video, image-to-video, start-end interpolation, reference images, or edit for a shot from control requirements.", dependencies=("flow/model-resolver",), consumes=("shot_spec", "project_bible", "character_bible"), produces=("generation_plan",))
add("strategy/reference-asset-director", "Select the minimum reference assets needed for identity, product, wardrobe, location, style, start-frame, or end-frame control.", dependencies=("foundation/character-bible-builder", "foundation/brand-bible-builder"), consumes=("shot_spec", "character_bible", "brand_bible"), produces=("generation_plan",))
add("strategy/budget-optimizer", "Allocate available credits across shots, variants, edits, and retries using live balance plus evidence-labelled model pricing.", dependencies=("flow/model-resolver", "flow/credit-check"), consumes=("generation_plan", "project_bible"), produces=("generation_plan",), determinism="deterministic")
add("strategy/variant-strategy", "Choose variant count and controlled variation axes for a shot within uncertainty and budget limits.", dependencies=("strategy/budget-optimizer",), consumes=("generation_plan", "shot_spec"), produces=("generation_plan",))
add("strategy/generation-strategy-planner", "Produce project-level generation order, shot dependencies, batching, reference prerequisites, and budget checkpoints.", dependencies=("strategy/generation-method-router", "strategy/reference-asset-director", "strategy/variant-strategy"), consumes=("project_bible", "generation_plan"), produces=("generation_plan",))
add("strategy/edit-vs-regenerate-selector", "Choose targeted edit or full regeneration for a rejected shot from defect locality, source quality, and expected credit efficiency.", dependencies=("flow/video-edit-extend",), consumes=("qc_report", "generation_record"), produces=("generation_plan",))
add("strategy/retry-strategy", "Convert a diagnosed failure into a bounded retry plan that changes only causally implicated parameters.", consumes=("qc_report", "generation_record", "generation_plan"), produces=("generation_plan",))

# L7 Genres
GENRES = {
    "cinematic-film": "Define cinematic-film grammar for authored narrative images, motivated camera language, and sequence-level visual coherence.",
    "luxury-commercial": "Define luxury-commercial grammar built on restraint, tactile material rendering, controlled reveal, and premium brand distance.",
    "product-commercial": "Define product-commercial grammar that preserves product geometry, finish, label integrity, and benefit-led hero coverage.",
    "beauty-commercial": "Define beauty-commercial grammar for flattering facial rendering, cosmetic texture, controlled highlights, and precise beauty motion.",
    "fashion-film": "Define fashion-film grammar where silhouette, garment movement, editorial attitude, and location rhythm carry the concept.",
    "automotive-commercial": "Define automotive-commercial grammar for vehicle form, dynamic tracking, road geography, reflections, and credible speed.",
    "food-commercial": "Define food-commercial grammar for appetite appeal, macro texture, steam, gloss, cutting action, and ingredient freshness.",
    "beverage-commercial": "Define beverage-commercial grammar for condensation, liquid dynamics, glass highlights, pour behavior, bubbles, and refreshment cues.",
    "travel-film": "Define travel-film grammar balancing place identity, human scale, movement through geography, atmosphere, and experiential discovery.",
    "real-estate-film": "Define real-estate-film grammar for accurate space perception, architectural verticals, material quality, circulation, and amenity hierarchy.",
    "hospitality-film": "Define hospitality-film grammar that sells an emotional stay through guest journey, service detail, architecture, food, and atmosphere.",
    "corporate-brand-film": "Define corporate brand-film grammar for credible people, purposeful work, brand proof, human warmth, and polished restraint.",
    "documentary": "Define documentary grammar for observational credibility, truthful geography, restrained intervention, and evidence-led visual storytelling.",
    "interview-film": "Define interview-film grammar for eyeline, facial rendering, conversational trust, B-roll support, and editorial continuity.",
    "music-video": "Define music-video grammar where visual motif, performance energy, rhythmic escalation, and stylized transitions serve the track.",
    "social-vertical-ad": "Define 9:16 paid-social grammar for immediate hook clarity, thumb-stop composition, safe areas, and retention-driven pacing.",
    "ugc-ad": "Define UGC-ad grammar for credible phone-native behavior, direct address, product proof, social authenticity, and conversion clarity.",
    "film-trailer": "Define film-trailer grammar for controlled information release, escalation, contrast, title-card space, and climactic rhythm.",
    "tech-commercial": "Define technology-commercial grammar for precise industrial design, interface readability, clean material light, and benefit visualization.",
    "horror": "Define horror grammar using threat geography, negative space, withheld information, low-key light, and tension-driven temporal control.",
}
for slug, resp in GENRES.items():
    add(f"genre/{slug}", resp, dependencies=("foundation/creative-director",), consumes=("project_bible", "visual_bible"), produces=("project_bible",))

# L8 QC
QC = {
    "prompt-quality-critic": "Score a generation prompt before spend for specificity, coherence, controllability, continuity, and unnecessary language.",
    "cinematography-critic": "Score shot scale, perspective, lens rendering, camera angle, and camera behavior against the approved shot specification.",
    "lighting-critic": "Score lighting direction, source motivation, ratio, facial or product rendering, exposure intent, and continuity.",
    "composition-critic": "Score hierarchy, balance, eyeline, negative space, edge safety, and aspect-ratio compliance against the shot specification.",
    "motion-critic": "Score subject and camera motion for requested path, tempo, stability, continuity, and absence of unintended acceleration.",
    "physics-critic": "Score physical plausibility of contact, gravity, fluids, cloth, hair, particles, reflections, and rigid objects.",
    "anatomy-critic": "Score human structural integrity including hands, faces, limb count, joint articulation, and temporal deformation.",
    "character-consistency-critic": "Score character identity against the character bible and approved reference media across face, body, hair, and wardrobe.",
    "product-consistency-critic": "Score product geometry, proportions, finish, label, logo, typography, and reference match across the shot.",
    "brand-consistency-critic": "Score compliance with brand codes, forbidden codes, client claims, product-hero rules, and tone boundaries.",
    "artifact-detector": "Detect temporal and spatial generation artifacts including morphing, flicker, warping, ghosting, duplicated anatomy, and text corruption.",
    "generation-result-scorer": "Aggregate critic outputs into a weighted genre-aware score without hiding any failing critical dimension.",
    "shot-acceptance-gate": "Apply configurable pass, edit, and regenerate thresholds plus hard-fail rules to a scored shot.",
}
qc_deps = {
    "prompt-quality-critic": ("prompt/veo-prompt-validator",),
    "cinematography-critic": ("craft/cinematography-director", "craft/lens-director", "craft/camera-movement-director"),
    "lighting-critic": ("craft/lighting-director",),
    "composition-critic": ("craft/composition-director",),
    "motion-critic": ("craft/motion-director", "craft/camera-movement-director"),
    "physics-critic": ("craft/motion-director",),
    "anatomy-critic": ("craft/character-designer",),
    "character-consistency-critic": ("foundation/character-bible-builder",),
    "product-consistency-critic": ("foundation/brand-bible-builder",),
    "brand-consistency-critic": ("foundation/brand-bible-builder",),
    "artifact-detector": (),
    "generation-result-scorer": tuple(f"qc/{k}" for k in QC if k not in {"generation-result-scorer", "shot-acceptance-gate"}),
    "shot-acceptance-gate": ("qc/generation-result-scorer",),
}
for slug, resp in QC.items():
    add(f"qc/{slug}", resp, dependencies=qc_deps[slug], consumes=("shot_spec", "generation_record", "qc_report"), produces=("qc_report",), determinism="deterministic")

# L9 Failure
FAIL = {
    "generation-failure-analyzer": "Classify a rejected generation into a failure signature and attribute it to the skill that owns the implicated decision.",
    "identity-drift-analyzer": "Diagnose character or product identity drift and identify the reference, framing, prompt, or motion factor most likely responsible.",
    "camera-motion-failure-analyzer": "Diagnose ignored, exaggerated, wrong-axis, unstable, or physically implausible camera movement from result evidence.",
    "physics-anatomy-failure-analyzer": "Diagnose broken anatomy or matter behavior and isolate prompt, motion, contact, or reference conditions that contributed.",
    "prompt-conflict-analyzer": "Attribute a post-generation failure to prompt contradictions that escaped preflight validation and produce a new conflict rule.",
    "artifact-repair-planner": "Select the minimum edit, prompt, reference, or regeneration intervention that removes a detected artifact.",
}
FAIL_DEPS = {
    "generation-failure-analyzer": ("qc/shot-acceptance-gate",),
    "identity-drift-analyzer": ("qc/character-consistency-critic", "qc/product-consistency-critic"),
    "camera-motion-failure-analyzer": ("qc/motion-critic", "qc/cinematography-critic"),
    "physics-anatomy-failure-analyzer": ("qc/physics-critic", "qc/anatomy-critic"),
    "prompt-conflict-analyzer": ("prompt/prompt-conflict-detector", "qc/generation-result-scorer"),
    "artifact-repair-planner": ("qc/artifact-detector", "strategy/edit-vs-regenerate-selector"),
}
for slug, resp in FAIL.items():
    add(f"failure/{slug}", resp, dependencies=FAIL_DEPS[slug], consumes=("qc_report", "generation_record", "generation_plan"), produces=("generation_plan", "qc_report"))

# L10 Orchestration
add("orchestration/skill-router", "Select the minimum skill set for a request using registry triggers, exclusions, category, evidence, and data availability.", consumes=("project_bible",), produces=("project_manifest",), determinism="deterministic")
add("orchestration/asset-manager", "Own the project asset ledger and the canonical mapping between logical assets and Flow mediaId values.", dependencies=("flow/media-upload-image", "flow/media-download"), consumes=("generation_record", "project_manifest"), produces=("project_manifest",), determinism="deterministic", side_effects="filesystem")
add("orchestration/generation-state-manager", "Own project-level shot generation state and map it to runtime statuses without conflating transport and media outcomes.", dependencies=("flow/generation-poller", "flow/error-classifier"), consumes=("generation_record", "project_manifest"), produces=("project_manifest",), determinism="deterministic", side_effects="filesystem")
add("orchestration/project-manifest-builder", "Assemble the final typed project manifest from creative bibles, accepted shots, assets, credits, runtime records, and warnings.", dependencies=("orchestration/asset-manager", "orchestration/generation-state-manager"), consumes=("project_bible", "visual_bible", "brand_bible", "character_bible", "generation_record", "qc_report"), produces=("project_manifest",), determinism="deterministic")
add("orchestration/shot-pipeline-orchestrator", "Run one shot from specification through craft, continuity, routing, prompt, Flow generation, QC, diagnosis, and bounded repair.", dependencies=("story/shot-spec-builder", "continuity/continuity-supervisor", "strategy/generation-method-router", "prompt/veo-prompt-validator", "qc/shot-acceptance-gate", "failure/generation-failure-analyzer"), consumes=("shot_spec", "project_bible", "continuity_state"), produces=("generation_record", "qc_report", "continuity_state"), determinism="deterministic")
add("orchestration/video-production-orchestrator", "Run the end-to-end project pipeline by delegating every domain decision to registered skills and owning only execution order.", dependencies=("orchestration/skill-router", "orchestration/shot-pipeline-orchestrator", "orchestration/project-manifest-builder"), consumes=("project_bible",), produces=("project_manifest",), determinism="deterministic")

assert len(S) == 107, len(S)
SKILLS = {s.id: s for s in S}
IDS = sorted(SKILLS)
