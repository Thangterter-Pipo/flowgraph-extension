from __future__ import annotations

from skill_catalog import SkillDef, S as BASE, LAYERS

S = list(BASE)
_seen = {s.id for s in S}


def add(id: str, responsibility: str, **kwargs):
    if id in _seen:
        return
    skill = SkillDef(id=id, responsibility=responsibility, **kwargs)
    S.append(skill)
    _seen.add(id)

# Flow operations that were previously aggregated.
add("flow/likeness-eligibility", "Check whether the authorized account is eligible for the documented likeness surface without creating or modifying likeness data.", dependencies=("flow/auth-session",), produces=("generation_record",), evidence_level="RUNTIME_VERIFIED", determinism="deterministic", side_effects="network", reference="§10.1", endpoint="GET https://aisandbox-pa.googleapis.com/v1/flow/likeness:checkEligibility")
add("flow/likeness-list", "List the authorized user's existing likeness records with populated image metadata for reference planning.", dependencies=("flow/auth-session",), produces=("character_bible",), evidence_level="RUNTIME_VERIFIED", determinism="deterministic", side_effects="network", reference="§10.2", endpoint="GET https://aisandbox-pa.googleapis.com/v1/flow/likeness:listUserLikenesses?populateImage=true")
add("flow/character-reference-image", "Prepare or select a character reference mediaId using verified image generation or upload paths without asserting unverified likeness creation.", dependencies=("flow/image-text-to-image", "flow/media-upload-image"), consumes=("character_bible",), produces=("character_bible", "generation_record"), evidence_level="RUNTIME_VERIFIED", determinism="heuristic", side_effects="credits", reference="§7.1, §6.1, §10.4", endpoint="verified image generation/upload surfaces; no dedicated likeness-create endpoint", runtime_note="Uses verified image media paths only; likeness creation remains runtime-partial.")

# Project/directing specialists.
add("foundation/film-director", "Translate the controlling idea into project-wide dramatic staging, shot intent, performance priority, and editorial emphasis without replacing specialist craft decisions.", dependencies=("foundation/creative-director",), consumes=("project_bible",), produces=("project_bible",))
add("foundation/visual-director", "Coordinate project-wide visual language across cinematography, production design, color, and motion while leaving parameter choices to their owning craft skills.", dependencies=("foundation/creative-director", "foundation/visual-bible-builder"), consumes=("project_bible", "visual_bible"), produces=("visual_bible",))
add("foundation/commercial-director", "Translate a commercial brief into persuasion hierarchy, product-hero moments, proof beats, and brand-safe directing priorities.", dependencies=("foundation/creative-director", "foundation/brand-bible-builder"), consumes=("project_bible", "brand_bible"), produces=("project_bible",))
add("foundation/narrative-director", "Define dramatic intention, character point of view, scene tension, and coverage priorities for narrative work.", dependencies=("foundation/creative-director",), consumes=("project_bible",), produces=("project_bible",))
add("foundation/documentary-director", "Define evidentiary priorities, observational boundaries, intervention limits, and truthful visual treatment for documentary work.", dependencies=("foundation/creative-director",), consumes=("project_bible",), produces=("project_bible",))

# Story development specialists.
add("story/creative-brief-analyzer", "Extract objective, audience, message hierarchy, deliverables, constraints, claims, risks, and unresolved assumptions from the project brief.", dependencies=("foundation/project-intake",), consumes=("project_bible",), produces=("project_bible",), determinism="deterministic")
add("story/story-beat-designer", "Design the ordered beat sequence and assign one narrative or persuasive job plus target duration to each beat.", dependencies=("story/story-architect",), consumes=("project_bible",), produces=("project_bible",))
add("story/micro-story-writer", "Write complete miniature cause-change-payoff stories for short-form videos where only a few seconds are available.", dependencies=("story/story-beat-designer",), consumes=("project_bible",), produces=("project_bible",))
add("story/sequence-designer", "Design multi-shot sequence escalation, visual information order, and transition logic across related scenes or beats.", dependencies=("story/story-beat-designer",), consumes=("project_bible", "shot_spec"), produces=("shot_spec",))
add("story/storyboard-planner", "Convert approved shot-list intentions into storyboard-frame requirements including action phase, composition purpose, and transition continuity.", dependencies=("story/shot-list-designer",), consumes=("shot_spec",), produces=("shot_spec",))
add("story/first-three-seconds-director", "Design the first three seconds as a specific visual-information sequence that establishes subject, tension, benefit, or curiosity immediately.", dependencies=("story/hook-designer",), consumes=("project_bible", "shot_spec"), produces=("shot_spec",))
add("story/retention-director", "Plan information resets, pattern changes, proof beats, and payoff spacing to sustain attention through short-form runtime.", dependencies=("story/hook-designer", "story/sequence-designer"), consumes=("project_bible", "shot_spec"), produces=("shot_spec",))
add("story/short-form-shot-planner", "Build a compact short-form coverage plan that preserves hook, proof, emotional turn, and CTA space under strict duration limits.", dependencies=("story/shot-list-designer", "story/hook-designer"), consumes=("project_bible",), produces=("shot_spec",))

# Cinematography specialists.
CINE = {
"shot-size-designer": "Choose shot scale from extreme wide through extreme close-up according to narrative information density and emotional distance.",
"camera-angle-designer": "Choose horizontal and vertical viewing angle to control power, vulnerability, information concealment, and spatial legibility.",
"camera-height-designer": "Set camera height relative to eye line, subject body, product plane, or architecture to control viewpoint psychology and geometry.",
"camera-distance-designer": "Set physical camera-to-subject distance so perspective, intimacy, staging room, and lens behavior remain coherent.",
"focal-length-designer": "Choose focal-length family from ultra-wide through telephoto or macro according to perspective, subject distance, and compression intent.",
"depth-of-field-designer": "Set depth-of-field behavior and focus tolerance according to hierarchy, subject motion, identity stability, and environment readability.",
"focus-pull-designer": "Design focus target, transition timing, rack direction, and end-state when focus change carries story information.",
"camera-speed-designer": "Set camera velocity, acceleration, deceleration, and dwell behavior for the chosen movement path.",
"camera-stability-designer": "Choose locked, dolly-stable, gimbal, steadicam, shoulder, handheld, drone, or FPV stability character from viewpoint intent.",
"framing-designer": "Set subject bounds, headroom, lead room, edge relationships, and crop tolerance for the delivery aspect ratio.",
"perspective-designer": "Design spatial expansion or compression by coordinating camera distance, focal family, foreground scale, and background relationship.",
"screen-direction-supervisor": "Protect left-right movement, eyeline, and action-axis continuity across coverage before generation.",
}
for slug, resp in CINE.items():
    dep = "craft/cinematography-director"
    if slug in {"focal-length-designer", "depth-of-field-designer", "focus-pull-designer", "perspective-designer"}:
        dep = "craft/lens-director"
    if slug in {"camera-speed-designer", "camera-stability-designer"}:
        dep = "craft/camera-movement-director"
    if slug == "framing-designer": dep = "craft/composition-director"
    if slug == "screen-direction-supervisor": dep = "craft/blocking-director"
    add(f"craft/{slug}", resp, dependencies=(dep,), consumes=("shot_spec", "visual_bible"), produces=("shot_spec",))

# Lighting specialists.
LIGHT = {
"key-light-designer": "Design the dominant modeled source direction, size, quality, motivation, color, and subject incidence.",
"fill-light-designer": "Design fill level, direction, softness, and negative-fill strategy to control contrast without flattening the key design.",
"backlight-designer": "Design back, rim, or edge light placement and width to separate subject shape without creating unmotivated halos.",
"practical-light-designer": "Choose visible practical sources and their motivated influence on exposure, color, and local contrast.",
"natural-light-designer": "Design sunlight, skylight, window light, overcast, golden-hour, blue-hour, and bounce behavior from believable geography.",
"studio-lighting-designer": "Design controlled studio source geometry for portrait, beauty, tabletop, reflective product, or chroma-neutral work.",
"contrast-designer": "Set scene contrast through key-fill relationship, negative fill, background level, and local value separation.",
"exposure-designer": "Set exposure priorities, highlight protection, shadow retention, and face or product brightness hierarchy.",
"lighting-continuity-supervisor": "Validate source direction, source color, apparent ratios, practical state, and time-of-day lighting across linked shots.",
"time-of-day-lighting": "Translate dawn, morning, midday, golden hour, dusk, blue hour, night, and interior day/night into specific light behavior.",
}
for slug, resp in LIGHT.items():
    add(f"craft/{slug}", resp, dependencies=("craft/lighting-director",), consumes=("shot_spec", "visual_bible", "continuity_state"), produces=("shot_spec",))

# Color/image aesthetics specialists.
COLOR = {
"palette-designer": "Design dominant, supporting, and accent color relationships across production, wardrobe, lighting, and hero subject.",
"contrast-curve-designer": "Design toe, midtone separation, shoulder, black depth, and highlight contrast behavior for the intended image response.",
"film-look-designer": "Design a coherent photochemical-inspired or digital image character from contrast, color separation, halation intent, and texture rather than preset labels.",
"texture-designer": "Design image and surface texture hierarchy including microcontrast, diffusion, atmosphere, and material detail retention.",
"grain-designer": "Specify grain scale, density, uniformity, and shot-to-shot consistency when film-like texture is intentionally required.",
"highlight-rolloff-designer": "Design highlight shoulder behavior for skin, practicals, windows, chrome, glass, and specular products.",
"skin-tone-supervisor": "Protect believable and consistent skin hue, luminance, undertone, and local contrast across lighting and grade changes.",
"color-continuity-supervisor": "Validate palette, white-balance intent, skin axis, saturation, and grade continuity across linked shots.",
}
for slug, resp in COLOR.items():
    add(f"craft/{slug}", resp, dependencies=("craft/color-director",), consumes=("shot_spec", "visual_bible", "continuity_state"), produces=("shot_spec",))

# Production-design specialists.
PROD = {
"set-designer": "Design the physical set layout, surfaces, openings, hero zones, and dressed areas that support blocking and camera coverage.",
"location-designer": "Choose or define location characteristics from story, brand, light, access, geography, and continuity requirements.",
"architecture-designer": "Design architectural style, proportions, verticals, circulation, apertures, materials, and spatial rhythm for generated environments.",
"prop-designer": "Design hero and supporting props with stable geometry, material, placement, ownership, and continuity significance.",
"environment-designer": "Design the broader environment including terrain, weather, vegetation, urban density, horizon, and atmospheric depth.",
"background-detail-designer": "Control secondary signage, dressing, crowd density, texture, and depth detail so the background supports rather than competes.",
"material-designer": "Specify material identity through roughness, reflectance, translucency, wear, anisotropy, and scale cues.",
"surface-texture-designer": "Specify fine surface condition such as polish, scratches, weave, pores, condensation, dust, patina, or machining without random detail spam.",
"era-period-designer": "Enforce period-accurate architecture, props, wardrobe interfaces, signage, technology, and wear for a defined era.",
"worldbuilding-designer": "Define coherent social, technological, environmental, architectural, and material rules for fictional worlds.",
}
for slug, resp in PROD.items():
    add(f"craft/{slug}", resp, dependencies=("craft/production-designer",), consumes=("shot_spec", "visual_bible", "continuity_state"), produces=("shot_spec",))

# Character system specialists.
CHAR = {
"character-reference-director": "Select and rank character reference views that best preserve facial geometry, hair, body, wardrobe, and lighting-neutral identity.",
"face-consistency-supervisor": "Validate facial geometry, feature spacing, age appearance, skin marks, and identity-critical face anchors across shots.",
"wardrobe-consistency-supervisor": "Validate garment identity, silhouette, color, material, accessories, and layering across character shots.",
"hair-consistency-supervisor": "Validate hair color, length, part, silhouette, tied state, fringe, and motion-compatible topology across shots.",
"makeup-consistency-supervisor": "Validate makeup palette, application zones, finish, and continuity-critical details across coverage.",
"body-consistency-supervisor": "Validate body proportions, stature, build, limb appearance, and silhouette continuity across shots.",
"character-continuity-supervisor": "Integrate face, body, hair, makeup, wardrobe, accessories, and reference-media checks for a recurring character.",
"character-shot-planner": "Choose which character views and coverage types are safe or risky given identity references, motion, lens, and continuity needs.",
}
for slug, resp in CHAR.items():
    add(f"craft/{slug}", resp, dependencies=("craft/character-designer", "foundation/character-bible-builder"), consumes=("shot_spec", "character_bible", "continuity_state"), produces=("shot_spec", "character_bible"))

# Wardrobe, beauty, hair and makeup specialists.
add("craft/costume-designer", "Design garment construction, silhouette, period or brand logic, material, closure, layering, and character-specific costume details.", dependencies=("craft/costume-stylist",), consumes=("shot_spec", "character_bible", "brand_bible"), produces=("shot_spec",))
add("craft/fashion-stylist", "Curate wardrobe combinations, accessories, proportion, color relationships, styling attitude, and brand alignment for each look.", dependencies=("craft/costume-stylist",), consumes=("shot_spec", "character_bible", "brand_bible"), produces=("shot_spec",))
add("craft/hair-director", "Design hairstyle geometry, part, volume, strand behavior, grooming level, and motion response for the shot sequence.", dependencies=("craft/hair-makeup-director",), consumes=("shot_spec", "character_bible"), produces=("shot_spec",))
add("craft/makeup-director", "Design makeup application, finish, color, coverage, feature emphasis, and lighting interaction for the sequence.", dependencies=("craft/hair-makeup-director",), consumes=("shot_spec", "character_bible"), produces=("shot_spec",))
add("craft/beauty-commercial-director", "Coordinate face, hair, makeup, cosmetic texture, lens, light, and micro-performance requirements for beauty advertising shots.", dependencies=("craft/hair-makeup-director", "craft/lighting-director", "craft/lens-director"), consumes=("shot_spec", "brand_bible", "character_bible"), produces=("shot_spec",))

# Performance specialists.
PERF = {
"actor-performance-director": "Design a performer's shot-specific behavioral arc from objective, obstacle, relationship, and observable action.",
"facial-expression-director": "Specify subtle facial actions, gaze changes, blinks, mouth tension, brow behavior, and expression transitions that are visually observable.",
"body-language-director": "Specify posture, weight distribution, shoulder state, torso orientation, gait, and physical openness or closure.",
"gesture-director": "Specify hand and arm gestures with start pose, path, target, contact, and completion so movement remains legible.",
"eye-line-director": "Specify gaze target, eye-line height, direction, timing, and shifts between people, objects, camera, and off-screen space.",
"emotion-director": "Translate emotional intent into a bounded sequence of observable physiological and behavioral cues rather than abstract adjectives.",
"crowd-performance-director": "Design crowd behavior using headcount bands, zones, dominant collective action, variation limits, and interaction rules.",
}
for slug, resp in PERF.items():
    add(f"craft/{slug}", resp, dependencies=("craft/performance-director",), consumes=("shot_spec", "character_bible"), produces=("shot_spec",))

# Motion specialists.
MOTION = {
"subject-motion-director": "Design primary subject motion with path, timing, speed, acceleration, contact, and end state.",
"environment-motion-director": "Design wind, foliage, curtains, signage, rain, smoke, water, and environmental movement from shared physical causes.",
"cloth-motion-director": "Design cloth deformation and secondary motion from fabric mass, stiffness, drape, wind, body movement, and damping.",
"hair-motion-director": "Design hair secondary motion from style topology, wind, inertia, head movement, and damping without identity drift.",
"particle-motion-director": "Design dust, mist, sparks, snow, embers, droplets, or particles with density, force field, depth, and persistence.",
"vehicle-motion-director": "Design vehicle path, steering, wheel rotation, suspension, body roll, tire contact, speed cues, and relationship to camera motion.",
"crowd-motion-director": "Design multi-person movement using zones, flows, collision avoidance, density, speed bands, and one dominant collective behavior.",
"physics-consistency-supervisor": "Validate gravity, inertia, contact, collision, fluid containment, rigid-body behavior, cloth, hair, and particle causality across the shot.",
"motion-tempo-director": "Set the relative speed hierarchy among subject, camera, environment, particles, and secondary motion so the shot reads clearly.",
}
for slug, resp in MOTION.items():
    add(f"craft/{slug}", resp, dependencies=("craft/motion-director",), consumes=("shot_spec",), produces=("shot_spec",))

# Composition specialists.
COMP = {
"rule-of-thirds-director": "Apply or reject rule-of-thirds placement according to hierarchy, eyeline, movement, negative space, and genre rather than by habit.",
"center-framing-director": "Design centered and axial framing for iconography, product precision, confrontation, ritual, symmetry, or deliberate deadpan effect.",
"symmetry-director": "Design reflective, rotational, architectural, or near-symmetry and decide when controlled asymmetry should break it.",
"negative-space-director": "Design purposeful empty area for isolation, eyeline, motion lead, title space, tension, or brand restraint.",
"leading-lines-director": "Use architecture, roads, shadows, perspective edges, or set dressing to route attention without producing artificial geometry.",
"foreground-layering-director": "Design foreground occlusion, scale, and movement to create depth, reveal, voyeurism, or environmental immersion.",
"depth-layering-director": "Organize foreground, subject plane, midground, and background hierarchy using scale, overlap, focus, value, and atmospheric depth.",
"visual-balance-director": "Balance visual mass, brightness, color, motion, faces, text, and negative space across the frame.",
"headroom-eyeline-supervisor": "Validate headroom, look room, eye-line height, facial crop, and adjacent-shot matching for human coverage.",
"platform-safe-composition": "Adapt framing so critical subject, product, logo, and text-safe areas survive platform UI and alternate crops.",
"caption-safe-area-planner": "Reserve and validate caption, subtitle, CTA, and interface-safe zones for horizontal, square, and vertical delivery.",
"vertical-video-director": "Coordinate composition, action path, subject scale, and depth specifically for 9:16 visual storytelling.",
}
for slug, resp in COMP.items():
    add(f"craft/{slug}", resp, dependencies=("craft/composition-director",), consumes=("shot_spec", "project_bible"), produces=("shot_spec",))

# Temporal specialists.
TEMP = {
"shot-duration-designer": "Set target duration for each shot from information density, action complexity, genre, edit rhythm, and generation controllability.",
"pacing-director": "Design perceived speed across a scene or piece by controlling shot length, action density, holds, and contrast between fast and slow units.",
"rhythm-director": "Design recurring and changing temporal patterns across action, camera, cuts, music intent, and visual motif.",
"sequence-tempo-director": "Shape acceleration, deceleration, pauses, crescendos, and resets across a multi-shot sequence.",
"slow-motion-director": "Choose the exact subject event, motion character, and editorial purpose that justify slow-motion treatment.",
"time-ramping-director": "Design speed-ramp start, transition, target speed, event anchor, and return state so time changes remain motivated.",
"transition-designer": "Design cut, match, wipe-by-object, motion bridge, dissolve, interpolation, or graphic transition from outgoing and incoming visual information.",
"social-pacing-director": "Design short-form pace from hook density, proof duration, visual resets, product readability, and CTA timing.",
}
for slug, resp in TEMP.items():
    add(f"craft/{slug}", resp, dependencies=("craft/temporal-designer",), consumes=("shot_spec", "project_bible"), produces=("shot_spec",))

# Audio creative metadata specialists.
add("craft/music-direction", "Define music function, energy curve, instrumentation character, section changes, and edit relationship as creative metadata only.", dependencies=("craft/sound-design-director",), consumes=("project_bible", "shot_spec"), produces=("shot_spec",))
add("craft/audio-intent-designer", "Structure dialogue, Foley, ambience, music, and transition intent into a timed audio specification without calling an unverified audio runtime.", dependencies=("craft/sound-design-director",), consumes=("project_bible", "shot_spec"), produces=("shot_spec",), determinism="deterministic")
add("craft/dialogue-intent-designer", "Define dialogue delivery, sync intent, pauses, emphasis, room perspective, and intelligibility priority from the approved script.", dependencies=("craft/sound-design-director", "story/screenwriter"), consumes=("project_bible", "shot_spec"), produces=("shot_spec",))

# Product-shot specialists.
PRODUCT = {
"product-hero-shot": "Design the definitive product hero view with geometry, label orientation, hierarchy, surface light, background separation, and resolved hold.",
"product-macro-shot": "Design macro product coverage that reveals a specific material, mechanism, edge, engraving, ingredient, or finish without losing identity.",
"product-orbit-shot": "Design a controlled product orbit with angular range, axis, speed, lighting continuity, and label visibility constraints.",
"product-reveal": "Design product emergence from occlusion, light, motion, environment, container, or start-end transformation with a clear resolved endpoint.",
"product-material-rendering": "Specify how metal, glass, ceramic, plastic, leather, fabric, liquid, stone, or coated surfaces must respond to light and motion.",
"product-liquid-shot": "Design product-associated liquid behavior including pour, swirl, splash, condensation, viscosity, contact, and containment.",
"product-particle-shot": "Design product-associated particles such as powder, droplets, mist, sparks, dust, or ingredients with controlled density and causality.",
"product-tabletop-lighting": "Design tabletop source geometry, flags, gradients, reflections, background value, and edge separation for product shots.",
"product-reflection-control": "Design intentional reflected shapes, gradients, environment cards, and unwanted-reflection suppression for glossy or transparent products.",
"product-logo-integrity": "Protect logo shape, typography, placement, orientation, contrast, legibility, and temporal stability throughout generated product footage.",
"product-reference-consistency": "Validate product geometry, color, material, label, logo, proportions, and distinctive details against approved reference media.",
}
for slug, resp in PRODUCT.items():
    deps=("genre/product-commercial",)
    if slug in {"product-tabletop-lighting", "product-reflection-control"}: deps=("craft/lighting-director", "genre/product-commercial")
    add(f"craft/{slug}", resp, dependencies=deps, consumes=("shot_spec", "brand_bible", "generation_plan"), produces=("shot_spec",))

# Continuity domain specialists.
CONT = {
"character-continuity": "Compare recurring character identity and state against the previous shot and emit exact carried or intentionally changed values.",
"wardrobe-continuity": "Compare wardrobe garments, layers, colors, materials, accessories, closures, and damage or wetness state across linked shots.",
"prop-continuity": "Compare prop identity, ownership, hand, position, orientation, fill level, damage, and interaction state across shots.",
"location-continuity": "Compare location geometry, set dressing, weather, time, access points, background landmarks, and spatial orientation across shots.",
"lighting-continuity": "Compare source direction, practical state, color temperature, contrast, exposure hierarchy, and time-of-day light across shots.",
"camera-continuity": "Compare camera side, height, angle, lens family, scale, motion state, and coverage relationship across editorially linked shots.",
"screen-direction-continuity": "Compare left-right subject movement, gaze direction, line of action, entrances, exits, and directional flow across cuts.",
"movement-continuity": "Compare action phase, body position, object contact, velocity, and secondary motion at cut points across shots.",
"temporal-continuity": "Compare story time, action phase, environmental progression, wetness, damage, light, and elapsed-time cues across shots.",
"color-continuity": "Compare palette, white-balance intent, skin axis, product color, saturation, contrast, and grade character across shots.",
"environment-continuity": "Compare weather, atmosphere, wind, particles, foliage, water, crowd density, traffic, and background motion across shots.",
}
for slug, resp in CONT.items():
    add(f"continuity/{slug}", resp, dependencies=("continuity/continuity-supervisor",), consumes=("shot_spec", "continuity_state"), produces=("continuity_state",), determinism="deterministic")

# Prompt specialists by generation method.
PROMPT = {
"veo-shot-prompt-writer": "Write the final shot-level natural-language Veo prompt from the structured specification while preserving hierarchy and continuity anchors.",
"veo-i2v-prompt-writer": "Write image-to-video prompts that describe only desired evolution from the supplied start image instead of redundantly repainting the frame.",
"veo-reference-prompt-writer": "Write reference-image video prompts that state motion, relationship, and preservation requirements without conflicting with reference identity.",
"veo-interpolation-prompt-writer": "Write start-end interpolation prompts that specify the physically and narratively plausible transformation path between fixed endpoints.",
"veo-edit-prompt-writer": "Write edit or extend prompts that isolate the requested change and explicitly preserve successful source-shot regions.",
}
for slug, resp in PROMPT.items():
    add(f"prompt/{slug}", resp, dependencies=("prompt/veo-prompt-architect",), consumes=("shot_spec", "generation_plan", "continuity_state"), produces=("generation_plan",), determinism="generative")

# Generation strategy specialists.
add("strategy/shot-generation-router", "Dispatch a prepared shot to the correct Flow runtime skill from the approved generation plan without changing the chosen method.", dependencies=("strategy/generation-method-router", "flow/model-resolver"), consumes=("generation_plan", "shot_spec"), produces=("generation_record",), determinism="deterministic")
add("strategy/t2v-vs-i2v-selector", "Decide specifically between text-to-video and image-to-video from composition, identity, product, start-frame, and reference-control needs.", dependencies=("flow/model-resolver",), consumes=("shot_spec", "character_bible", "brand_bible"), produces=("generation_plan",))
add("strategy/reference-image-selector", "Rank candidate reference images by identity coverage, angle usefulness, neutrality, conflict risk, and relevance to the current shot.", dependencies=("strategy/reference-asset-director",), consumes=("shot_spec", "character_bible", "brand_bible"), produces=("generation_plan",))
add("strategy/interpolation-selector", "Decide whether explicit start and end frames justify interpolation based on endpoint importance, motion path, transformation, and continuity control.", dependencies=("strategy/generation-method-router",), consumes=("shot_spec", "generation_plan"), produces=("generation_plan",))
add("strategy/seed-reference-consistency-planner", "Plan reference-based consistency across variants while explicitly reporting that no verified seed-control API is available in the current Flow evidence.", dependencies=("strategy/reference-asset-director",), consumes=("generation_plan", "character_bible", "brand_bible"), produces=("generation_plan",))
add("strategy/generation-budget-optimizer", "Optimize total generation spend across shot importance, uncertainty, variants, edits, retries, and partial-capability risk using live credits and registry observations.", dependencies=("strategy/budget-optimizer", "strategy/variant-strategy"), consumes=("generation_plan", "project_bible"), produces=("generation_plan",), determinism="deterministic")

# Missing genre and format skills from the master specification.
GENRE_EXTRA = {
"hotel-resort-film": "Define hotel and resort film grammar for arrival, room experience, service, food, wellness, landscape, and aspirational guest journey.",
"corporate-film": "Define corporate-film grammar for people, operations, expertise, proof, culture, leadership, and credible workplace imagery.",
"brand-film": "Define brand-film grammar that communicates belief, world view, emotional territory, and long-term brand meaning beyond a single product claim.",
"social-ad": "Define paid-social advertising grammar for immediate proposition, proof, retention, product readability, CTA, and platform adaptation.",
"tiktok": "Define TikTok-native grammar for vertical framing, rapid context, creator-like behavior, visual resets, comments-aware composition, and concise payoff.",
"instagram-reel": "Define Instagram Reels grammar for polished vertical discovery, aesthetic coherence, hook clarity, save/share value, and caption-safe framing.",
"youtube-short": "Define YouTube Shorts grammar for vertical hook, rapid explanatory progression, recurring visual resets, and clear terminal payoff.",
"youtube-cinematic": "Define cinematic YouTube grammar for strong opening promise, authored visuals, explanatory/narrative structure, and long-form retention rhythm.",
"teaser": "Define teaser grammar for minimal disclosure, strong motif, curiosity, atmosphere, and one memorable unresolved promise.",
"short-film": "Define short-film grammar for compressed character, setup, development, turn, and resolution under limited runtime.",
"romance": "Define romance grammar for relational proximity, eyeline, touch, hesitation, warmth, vulnerability, and emotional progression.",
"comedy": "Define comedy grammar for setup, visual clarity, timing, reaction, escalation, contrast, and readable payoff.",
"thriller": "Define thriller grammar for information control, surveillance, pursuit, uncertainty, temporal pressure, and escalating threat geography.",
"action": "Define action grammar for readable geography, cause-and-effect, directional continuity, impact, speed, staging, and escalating physical stakes.",
"scifi": "Define science-fiction grammar for coherent technology, scale, world rules, speculative materials, interfaces, and human relationship to the invented system.",
"fantasy": "Define fantasy grammar for coherent mythic world rules, material culture, magic behavior, costume, environment, and scale.",
"period-film": "Define period-film grammar for era-consistent architecture, wardrobe, props, behavior, lighting sources, lens character, and social detail.",
"sports-commercial": "Define sports-commercial grammar for athletic performance, effort, impact, body mechanics, product integration, speed, and motivational progression.",
"fitness-commercial": "Define fitness-commercial grammar for exercise form, exertion, body mechanics, environment, product/service proof, and attainable aspiration.",
"app-commercial": "Define app-commercial grammar for user problem, device context, interface readability, interaction steps, benefit proof, and CTA.",
"architecture-film": "Define architecture-film grammar for form, circulation, light, material, structure, context, human scale, and spatial sequence.",
"interior-film": "Define interior-film grammar for room hierarchy, furniture, material, lighting, circulation, detail, and human use without distorting scale.",
"event-promo": "Define event-promo grammar for atmosphere, crowd energy, hero moments, speakers or performers, venue identity, social proof, and date/CTA space.",
"educational-video": "Define educational-video grammar for concept sequencing, visual explanation, examples, demonstrations, cognitive load, and recap.",
"explainer-video": "Define explainer-video grammar for problem, mechanism, benefit, process visualization, proof, and concise next action.",
"editorial-film": "Define editorial-film grammar for authored point of view, visual argument, cultural texture, portraiture, and magazine-like image sequencing.",
"art-film": "Define art-film grammar for formal concept, visual motif, ambiguity, repetition, duration, materiality, and non-commercial image logic.",
}
for slug, resp in GENRE_EXTRA.items():
    add(f"genre/{slug}", resp, dependencies=("foundation/creative-director",), consumes=("project_bible", "visual_bible"), produces=("project_bible",))

SPECIAL_COMMERCIAL = {
"luxury-brand-director": "Define luxury-brand commercial grammar across scarcity, restraint, material detail, status signaling, service, and controlled reveal.",
"beauty-ad-director": "Define beauty-ad grammar across face, cosmetic effect, skin texture, hair, product application, claim-safe proof, and beauty lighting.",
"perfume-ad-director": "Define perfume-film grammar through sensory metaphor, bottle iconography, skin, atmosphere, memory, desire, material light, and restrained narrative abstraction.",
"watch-commercial-director": "Define watch-commercial grammar for dial, case, crystal, crown, bracelet, wrist presence, machining, reflection, precision, and time motif.",
"jewelry-commercial-director": "Define jewelry-commercial grammar for facets, metal, stone fire, skin contact, scale, luxury restraint, edge light, and identity of the piece.",
"fashion-commercial-director": "Define fashion-commercial grammar for collection story, silhouette, styling, garment motion, model attitude, location, and brand codes.",
"car-commercial-director": "Define car-commercial grammar for exact vehicle identity, stance, body lines, driving dynamics, road relationship, cabin, and performance cues.",
"food-ad-director": "Define food-ad grammar for appetite, freshness, preparation, ingredient transformation, texture, steam, gloss, serving, and final bite appeal.",
"drink-ad-director": "Define drink-ad grammar for container identity, pour, bubbles, condensation, ice, glass, liquid color, refreshment, and social consumption.",
"technology-ad-director": "Define technology-ad grammar for industrial design, mechanism, interface, feature proof, human benefit, material precision, and clean motion.",
"smartphone-ad-director": "Define smartphone-ad grammar for exact device geometry, camera module, display, hand interaction, interface, feature demo, and lifestyle use.",
"hospitality-commercial-director": "Define hospitality-commercial grammar for arrival, staff interaction, room, dining, wellness, amenities, destination, and emotional service promise.",
"real-estate-commercial-director": "Define real-estate-commercial grammar for property identity, space accuracy, amenities, materials, views, circulation, neighborhood value, and lifestyle proof.",
}
for slug, resp in SPECIAL_COMMERCIAL.items():
    add(f"genre/{slug}", resp, dependencies=("foundation/commercial-director",), consumes=("project_bible", "visual_bible", "brand_bible"), produces=("project_bible",))

# QC/failure specialists.
add("qc/video-quality-critic", "Perform holistic video review across prompt alignment, temporal coherence, identity, composition, lighting, motion, physics, artifacts, and delivery suitability.", dependencies=("qc/generation-result-scorer",), consumes=("shot_spec", "generation_record", "qc_report"), produces=("qc_report",), determinism="deterministic")
add("qc/continuity-critic", "Score rendered-shot continuity against authoritative prior and next continuity states without creating an independent competing continuity truth.", dependencies=("continuity/continuity-supervisor",), consumes=("continuity_state", "generation_record", "qc_report"), produces=("qc_report",), determinism="deterministic")
add("failure/anatomy-failure-analyzer", "Diagnose face, hand, finger, limb, joint, body-proportion, contact, and temporal anatomy failures and identify the most likely owning parameters.", dependencies=("qc/anatomy-critic",), consumes=("qc_report", "generation_record", "shot_spec"), produces=("generation_plan",))
add("failure/physics-failure-analyzer", "Diagnose gravity, contact, collision, cloth, fluid, vehicle, reflection, and particle physics failures and identify the implicated motion or staging parameters.", dependencies=("qc/physics-critic",), consumes=("qc_report", "generation_record", "shot_spec"), produces=("generation_plan",))
add("failure/continuity-failure-analyzer", "Diagnose rendered continuity mismatches by domain and trace each mismatch to the state transition or owning craft decision that changed unexpectedly.", dependencies=("qc/continuity-critic",), consumes=("qc_report", "continuity_state", "generation_record"), produces=("generation_plan",))

# Orchestration specialists.
add("orchestration/video-project-planner", "Build the executable project plan from brief through bibles, scenes, shots, references, generation order, QC, and delivery milestones.", dependencies=("foundation/project-intake", "story/shot-list-designer", "strategy/generation-strategy-planner"), consumes=("project_bible",), produces=("project_manifest",), determinism="deterministic")
add("orchestration/media-id-manager", "Maintain the canonical mapping between logical asset identity, backend media.name responses, mediaId request references, shot ownership, and replacement lineage.", dependencies=("orchestration/asset-manager",), consumes=("generation_record", "project_manifest"), produces=("project_manifest",), determinism="deterministic", side_effects="filesystem")
add("orchestration/continuity-state-manager", "Coordinate project-level continuity snapshot creation, retrieval, shot ordering, and handoff to the authoritative continuity state store.", dependencies=("continuity/continuity-state-manager",), consumes=("continuity_state", "project_manifest"), produces=("project_manifest",), determinism="deterministic", side_effects="filesystem")
add("orchestration/budget-manager", "Track live credits, planned allocations, observed deltas, retry reserves, and budget checkpoints across the project without hardcoding pricing as guaranteed.", dependencies=("strategy/generation-budget-optimizer", "flow/credit-check"), consumes=("generation_plan", "project_manifest"), produces=("project_manifest",), determinism="deterministic")
add("orchestration/project-qc-manager", "Coordinate prompt preflight, per-shot critics, acceptance gates, continuity review, project-wide consistency review, and escalation status.", dependencies=("qc/video-quality-critic", "qc/shot-acceptance-gate", "qc/continuity-critic"), consumes=("qc_report", "project_manifest"), produces=("project_manifest",), determinism="deterministic")

SKILLS = {s.id: s for s in S}
IDS = sorted(SKILLS)
assert len(SKILLS) == len(S)
