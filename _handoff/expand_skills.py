from __future__ import annotations

import json
from dataclasses import replace
from pathlib import Path
from textwrap import dedent
from typing import Any

import yaml

from skill_catalog import IDS as BASE_IDS, LAYERS
from full_skill_catalog import S as FULL, SkillDef

ROOT = Path(r"E:\Google-flow-skills")
BASE = set(BASE_IDS)


def normalized(skill: SkillDef) -> SkillDef:
    # Craft/product recipes may consume a genre profile at execution time but static
    # dependency edges never point upward. Keep that relationship data-driven.
    if skill.id.startswith("craft/product-"):
        deps = [d for d in skill.dependencies if not d.startswith("genre/")]
        if "foundation/brand-bible-builder" not in deps:
            deps.append("foundation/brand-bible-builder")
        if skill.id in {"craft/product-tabletop-lighting", "craft/product-reflection-control"} and "craft/lighting-director" not in deps:
            deps.append("craft/lighting-director")
        return replace(skill, dependencies=tuple(deps))
    return skill

FULL = [normalized(s) for s in FULL]

# Regenerate full plan from the user-requested explicit specialist inventory.
plan = {
    "plan_version": "2.0.0",
    "source": "MASTER PROMPT + SKILLS_TAXONOMY.md + GOOGLE_FLOW_API_REFERENCE.md v2.0.0",
    "architecture": "explicit-specialists-with-director-coordination",
    "skill_count": len(FULL),
    "skills": [s.as_plan() for s in FULL],
}
(ROOT / "skills_plan" / "plan.json").write_text(json.dumps(plan, ensure_ascii=False, indent=2), encoding="utf-8")
(ROOT / "skills_plan" / "ids.json").write_text(json.dumps(sorted(s.id for s in FULL), ensure_ascii=False, indent=2), encoding="utf-8")

CASE_KINDS = {
    "flow": ["happy_path", "bad_input", "capability_unavailable", "runtime_partial", "security_constraint"],
    "foundation": ["happy_path", "bad_input", "ambiguous_brief", "conflicting_requirements", "missing_optional_data"],
    "story": ["happy_path", "bad_input", "ambiguous_brief", "conflicting_requirements", "missing_optional_data"],
    "craft": ["happy_path", "bad_input", "ambiguous_brief", "conflicting_requirements", "missing_optional_data"],
    "continuity": ["happy_path", "bad_input", "continuity_conflict"],
    "prompt": ["happy_path", "bad_input"],
    "strategy": ["happy_path", "bad_input", "budget_pressure", "capability_unavailable"],
    "genre": ["happy_path", "bad_input", "ambiguous_brief", "conflicting_requirements", "missing_optional_data", "genre_mismatch"],
    "qc": ["happy_path", "bad_input", "threshold_boundary"],
    "failure": ["happy_path", "bad_input", "threshold_boundary"],
    "orchestration": ["happy_path", "bad_input"],
}

CINE = {"shot-size-designer","camera-angle-designer","camera-height-designer","camera-distance-designer","focal-length-designer","depth-of-field-designer","focus-pull-designer","camera-speed-designer","camera-stability-designer","framing-designer","perspective-designer","screen-direction-supervisor"}
LIGHT = {"key-light-designer","fill-light-designer","backlight-designer","practical-light-designer","natural-light-designer","studio-lighting-designer","contrast-designer","exposure-designer","lighting-continuity-supervisor","time-of-day-lighting"}
COLOR = {"palette-designer","contrast-curve-designer","film-look-designer","texture-designer","grain-designer","highlight-rolloff-designer","skin-tone-supervisor","color-continuity-supervisor"}
PROD = {"set-designer","location-designer","architecture-designer","prop-designer","environment-designer","background-detail-designer","material-designer","surface-texture-designer","era-period-designer","worldbuilding-designer"}
CHAR = {"character-reference-director","face-consistency-supervisor","wardrobe-consistency-supervisor","hair-consistency-supervisor","makeup-consistency-supervisor","body-consistency-supervisor","character-continuity-supervisor","character-shot-planner","costume-designer","fashion-stylist","hair-director","makeup-director","beauty-commercial-director"}
PERF = {"actor-performance-director","facial-expression-director","body-language-director","gesture-director","eye-line-director","emotion-director","crowd-performance-director"}
MOTION = {"subject-motion-director","environment-motion-director","cloth-motion-director","hair-motion-director","particle-motion-director","vehicle-motion-director","crowd-motion-director","physics-consistency-supervisor","motion-tempo-director"}
COMP = {"rule-of-thirds-director","center-framing-director","symmetry-director","negative-space-director","leading-lines-director","foreground-layering-director","depth-layering-director","visual-balance-director","headroom-eyeline-supervisor","platform-safe-composition","caption-safe-area-planner","vertical-video-director"}
TEMP = {"shot-duration-designer","pacing-director","rhythm-director","sequence-tempo-director","slow-motion-director","time-ramping-director","transition-designer","social-pacing-director"}
AUDIO = {"music-direction","audio-intent-designer","dialogue-intent-designer"}
PRODUCT = {"product-hero-shot","product-macro-shot","product-orbit-shot","product-reveal","product-material-rendering","product-liquid-shot","product-particle-shot","product-tabletop-lighting","product-reflection-control","product-logo-integrity","product-reference-consistency"}

GROUPS = {
"cine": CINE, "light": LIGHT, "color": COLOR, "prod": PROD, "char": CHAR,
"perf": PERF, "motion": MOTION, "comp": COMP, "temp": TEMP, "audio": AUDIO, "product": PRODUCT,
}

GROUP_RULES = {
"cine": [
("Spatial information is primary", "favor geometry that reveals subject/environment relationship", "Camera placement must first answer what the audience needs to understand."),
("Face identity is primary", "avoid extreme near-wide perspective and unstable focus behavior", "Identity survives better under coherent distance and lens language."),
("Adjacent coverage must cut cleanly", "match screen side, eyeline, scale logic, and movement direction", "Editorial continuity outranks novelty."),
("The visual effect requires conflicting lens/angle instructions", "choose one controlling spatial intention and reject the other", "Mutually exclusive perspective instructions reduce generation control."),
("Aspect ratio changes", "re-evaluate framing bounds rather than applying a blind crop", "9:16, 16:9, 1:1, and 2.39:1 allocate space differently."),
],
"light": [
("Skin is the hero surface", "preserve facial modeling and controlled specular response", "Skin requires different source scale and contrast than chrome or glass."),
("Reflective product is the hero", "design reflected source geometry and edge gradients", "Reflective objects are shaped by what they reflect."),
("Natural source motivation is visible", "align key direction and color with window/sun/practical geography", "Motivated light is more believable than arbitrary beauty light."),
("Low-key mood is requested", "protect a readable hierarchy while increasing negative fill", "Darkness without information is not controlled low-key lighting."),
("Linked shots share time/place", "carry source direction, practical state, and apparent contrast", "Lighting continuity is a state constraint, not a style suggestion."),
],
"color": [
("Brand/product color is locked", "protect hue and luminance before stylized grade choices", "Creative grading cannot invalidate product identity."),
("Human skin is present", "define a stable skin axis and contamination tolerance", "Skin drift is highly visible across cuts."),
("Highlights dominate glass/chrome/practicals", "shape a controlled shoulder rather than clipping all specular detail", "Highlight behavior carries material realism."),
("Film texture is requested", "specify grain/diffusion/halation behavior separately", "A named film look is not a substitute for image behavior."),
("Sequence spans locations", "preserve project palette while allowing scene-local emphasis", "Coherence does not require identical color in every scene."),
],
"prod": [
("A hero prop or product must remain exact", "reduce background competition and lock geometry/material anchors", "World detail must not steal identity from the hero object."),
("Period is load-bearing", "validate architecture, technology, signage, props, fabrics, and wear against one era", "One anachronism can break the world contract."),
("Space must support a camera path", "design openings, depth layers, and clear circulation", "Production design and blocking must share geometry."),
("Environment is generic", "add a small set of causally coherent material and use details", "Specificity should come from world rules, not random clutter."),
("Background detail starts mutating", "reduce low-priority repeated micro-details", "Generative stability improves when hierarchy is explicit."),
],
"char": [
("Identity repeats across shots", "lock 3–8 high-salience anchors and approved references", "A limited stable identity contract outperforms decorative descriptor lists."),
("Hair/wardrobe/makeup changes intentionally", "record the exact transition shot and before/after state", "Intentional change must not look like drift."),
("Close beauty coverage is used", "increase face, hairline, makeup, and skin-finish precision", "Close shots expose small continuity failures."),
("Fast action is required", "simplify fragile accessories and complex silhouette details", "Temporal stability is harder under rapid motion."),
("Two characters risk merging", "differentiate silhouette, hair geometry, wardrobe value, and movement signature", "Distinct visual anchors reduce identity swapping."),
],
"perf": [
("Emotion is subtle", "use one facial cue plus one body or breath cue", "Observable micro-actions are more controllable than stacked emotion adjectives."),
("Hands interact with an object", "specify start hand, path, contact point, grip, and end state", "Hand-object ambiguity produces anatomy and continuity failures."),
("Eye line changes", "name target, direction, and transition moment", "Gaze is spatial behavior, not only emotion."),
("Crowd is present", "assign zones and one dominant collective action with bounded variation", "Independent random behavior multiplies artifacts."),
("Shot is only 4–8 s", "limit performance to a small number of readable beats", "Too many behavioral changes compete with generation stability."),
],
"motion": [
("Motion has no physical cause", "define force/contact/path before visual flourish", "Causality improves believable movement."),
("Several motion systems compete", "rank one hero motion and at most 1–2 secondary responses", "Too many independent systems create temporal instability."),
("Liquid or particles are present", "define source, direction, density/viscosity, contact, and containment", "Matter behavior needs boundary conditions."),
("Vehicle movement is present", "align steering, wheel rotation, suspension, path, and camera cues", "Conflicting speed cues make vehicles slide."),
("Slow motion is used", "ensure environment and secondary motion share compatible temporal behavior", "Mixed unmotivated time scales look synthetic."),
],
"comp": [
("The hero must read instantly", "establish a single dominant visual hierarchy", "Competing centers reduce comprehension."),
("Subject looks or moves laterally", "reserve lead room in that direction", "Space should support gaze and motion."),
("Vertical delivery is required", "protect center safe area and top/bottom UI/caption zones", "9:16 cannot be treated as a crop of 16:9."),
("Symmetry is chosen", "confirm architecture/product/ritual supports it", "Symmetry should carry meaning rather than become a default preset."),
("Frame feels flat", "introduce purposeful overlap, foreground scale, or value-depth separation", "Depth can be designed without arbitrary shallow focus."),
],
"temp": [
("Opening must stop scroll", "front-load subject/problem/benefit information within 1–3 s", "Short-form attention is won before later proof can matter."),
("Luxury reveal is primary", "use anticipation, controlled action, and a resolved hold", "Premium material needs read time."),
("Action sequence escalates", "shorten durations progressively while preserving geography", "Rhythm can accelerate without becoming unreadable."),
("One shot contains many beats", "split or remove beats before adding speed", "Compression is not the same as clarity."),
("Speed ramp is requested", "anchor start, transition, target speed, event, and exit", "Unanchored ramps are decorative and unstable."),
],
"audio": [
("Dialogue carries factual/brand information", "prioritize intelligibility and approved wording", "Audio intent must not invent or mask claims."),
("A visible tactile event occurs", "specify corresponding Foley material and sync intent", "Sound should reinforce visible causality."),
("Music is desired", "define function, energy curve, and section relationship", "Generic 'epic music' is not useful creative metadata."),
("User requests runtime audio generation", "emit specification-only warning", "No production audio-generation endpoint is verified in the source."),
("Shot timing changes", "retime audio intent rather than inventing a separate audio runtime", "Creative sync metadata must follow the final picture structure."),
],
"product": [
("Product identity is critical", "use approved references and protect geometry/logo first", "A beautiful but wrong product is a failed commercial shot."),
("Material finish is the selling point", "design source reflections and macro detail around that surface", "Material truth requires specific light behavior."),
("Orbit or reveal is requested", "keep path and final label/hero orientation explicit", "Motion must resolve to a commercially usable view."),
("Liquid/particle effect touches product", "preserve product boundary and logo legibility", "Effects are secondary to identity integrity."),
("Generated logo deforms", "hard-fail or route to repair rather than accepting average score", "Typography/logo errors are critical brand failures."),
],
}

GROUP_STANDARDS = {
"cine": ["Coordinate focal family, camera distance, framing, angle, and aspect ratio as one geometry system even when separate specialists own the parameters.", "Use 14–24 mm only when spatial expansion or deliberate distortion is justified; 35–50 mm for natural spatial relation; 65–100 mm for controlled portrait compression; 85–100 mm macro for close product detail.", "Preserve the 180° action axis by default and document any intentional crossing.", "For 9:16, protect facial and product geometry from edge distortion and unsafe crops."],
"light": ["Describe source role, direction, apparent size, quality, color, motivation, intensity relationship, and affected surface.", "Beauty work commonly tolerates roughly 2:1–3:1 apparent key/fill; dramatic work may reach 4:1–8:1 or more if hierarchy remains readable.", "Daylight language is commonly near 5600 K and warm practical/tungsten language around 2700–3200 K, but motivation outranks numeric fetishism.", "Never let a continuity-linked key direction flip without a location/time/blocking reason."],
"color": ["Separate production palette, lighting color, camera/image response, and grading intent.", "Protect skin and product-critical hues before saturation or stylization.", "Use grain, halation, diffusion, and highlight rolloff as separate controls; a 'film look' label is insufficient.", "Continuity review compares hue, luminance, saturation, contrast, and white-balance intent across cuts."],
"prod": ["Define 3–5 dominant material families before adding secondary dressing.", "Hero props require stable geometry, scale, material, location, orientation, and ownership.", "Architecture should specify verticals, openings, circulation, scale, and depth — not only style names.", "Period/world design must reject anachronistic technology, signage, hardware, or surface treatment."],
"char": ["A stable character contract includes estimated age range, facial geometry, hair, skin, body proportions, wardrobe, accessories, makeup, movement style, emotional baseline, and reference media IDs.", "Lock 3–8 high-salience anchors rather than dozens of ornamental descriptors.", "Do not persist unnecessary PII.", "Identity QC is a critical dimension and may hard-fail even when composition is strong."],
"perf": ["Prefer 1–3 observable behaviors in a 4–8 s generated shot.", "Write gaze, breath, shoulders, hands, weight shift, and object contact rather than abstract emotional adjectives.", "Every hand-object action has a start, path, contact, and end state.", "Crowd performance uses zones, density, and dominant behavior rather than independent scripts for every extra."],
"motion": ["Every motion system needs cause, direction, speed/tempo, amplitude, and stop/continuation state.", "Limit independent hero motion systems in a short generation; 1 hero plus 1–2 secondary responses is a useful default.", "Fluid, cloth, hair, particles, and rigid objects require different physical language.", "Camera motion and subject motion must not accidentally cancel or exaggerate one another."],
"comp": ["Rule of thirds is optional, not mandatory.", "9:16, 16:9, 1:1, and 2.39:1 require distinct framing decisions.", "Protect eyes, product edges, logos, subtitles, and CTA zones from unstable frame boundaries.", "Use symmetry, negative space, or layering only when it serves hierarchy or story."],
"temp": ["Shot durations should sum to project duration within roughly ±5% before generation.", "Use 1–3 s information resets in aggressive short-form only when they preserve comprehension.", "A 4–8 s generated shot should normally contain one dominant visual beat.", "Retries should not compensate for an impossible density of actions; revise temporal design first."],
"audio": ["Audio skills emit creative metadata only; runtime_support remains unverified_or_partial until evidence changes.", "Separate dialogue, Foley, ambience, music, and transition layers.", "Time cues are shot-relative and follow approved picture timing.", "Never invent dialogue or brand claims outside the approved script/brand bible."],
"product": ["Product geometry, logo, label, material, color, and distinctive features are critical constraints.", "For reflective products, design gradients and reflected source shapes instead of asking for generic bright light.", "Macro views need a declared focus plane and identity context.", "Hero motion must resolve to a stable commercially usable frame rather than endless rotation."],
}

GENRE_DETAIL = {
"hotel-resort-film": ("arrival→discovery→service→rest→destination payoff", "24–50 mm place, 65–100 mm service/detail", "guest-follow, doorway reveals, restrained drone geography", "warm practical + window/daylight motivation", "measured, experiential holds", "property refs + recurring guest refs", "empty-lobby montage; impossible room geometry"),
"corporate-film": ("problem/expertise/proof/people/result", "35–85 mm natural perspective", "subtle slider/gimbal or observational handheld", "soft office/window motivation", "clear, credible, moderately paced", "specific facilities/people when factual", "fake smiling meetings; generic handshake montage"),
"brand-film": ("belief→world→human proof→emotional resolution", "35–85 mm with motif-driven exceptions", "motif-consistent movement", "source-motivated image language tied to brand world", "slower than direct-response; motif repetition", "brand/character/location refs as needed", "turning brand belief into generic inspirational montage"),
"social-ad": ("hook→problem/benefit→proof→CTA", "28–65 mm; protect face/product in 9:16", "direct simple moves and fast reframes", "bright legible separation with brand color", "1–3 s resets with proof holds", "product/person refs when exact", "horizontal TVC crop; unreadable CTA"),
"tiktok": ("native hook→creator proof→pattern reset→payoff", "24–35 mm phone-like or 35–50 mm clean vertical", "handheld/native movement, direct-to-camera", "plausible room/window light", "fast but conversational", "spokesperson/product refs", "over-produced fake UGC; unsafe caption zones"),
"instagram-reel": ("aesthetic hook→value/experience→save/share payoff", "28–65 mm vertical-friendly", "controlled handheld/gimbal, visual transitions", "polished natural or stylized brand light", "rhythmic 1–4 s units", "brand/product/location refs", "trend effects with no concept; edge-cropped faces"),
"youtube-short": ("promise→rapid explanation/proof→payoff", "28–65 mm vertical", "simple camera with frequent content changes", "legible subject light", "tight 1–3 s information units", "host/product refs", "no payoff; visually repetitive middle"),
"youtube-cinematic": ("strong promise→chapters→visual proof→resolution", "24–85 mm narrative coverage", "motivated gimbal/dolly/handheld mix", "authored but credible source motivation", "longer breathing room than Shorts", "recurring host/location refs", "cinematic B-roll detached from narrative information"),
"teaser": ("motif→partial reveal→unresolved promise", "35–100 mm selective detail", "slow creep, lock, single reveal move", "contrast and concealment", "few shots, deliberate holds", "hero identity refs", "showing everything; trailer-style over-explanation"),
"short-film": ("setup→development→turn→resolution", "24–85 mm coherent lens family", "story-motivated only", "scene-motivated continuity", "sequence rhythm follows dramatic arc", "character/location refs", "coverage without dramatic function"),
"romance": ("distance→connection→hesitation/touch→emotional change", "50–100 mm intimacy with 35–50 mm shared-space context", "slow approach, paired tracking, still reaction holds", "soft motivated warmth or natural window light", "reaction-driven pacing", "recurring couple refs", "constant golden-hour cliché; generic smiling"),
"comedy": ("clear setup→timed escalation→reaction→payoff", "24–50 mm for readable geography; longer reaction lens as needed", "often locked or simple reframing to protect timing", "clear readable light", "timing precision over visual flourish", "character/prop refs when recurring", "camera stealing the joke; unreadable action geography"),
"thriller": ("information gap→pressure→misdirection→escalation", "28–85 mm; telephoto surveillance when motivated", "creeping push, tracking, restrained handheld escalation", "low-key motivated practicals", "controlled acceleration", "character/location refs", "constant shaky camera; darkness without information"),
"action": ("goal→geography→cause/effect→impact→escalation", "24–50 mm geography, 50–85 mm impact inserts", "tracking/chase/handheld only with clear axes", "readable contrast with practical motivation", "fast but geography-preserving", "character/vehicle/location refs", "teleporting positions; wheel/limb physics failure"),
"scifi": ("world rule→human interaction→system behavior→consequence", "24–65 mm with scale-driven wides", "controlled technical movement or human POV", "motivated practical/interface/emissive light", "measured discovery then escalation", "world/product/character refs", "generic blue holograms; inconsistent tech rules"),
"fantasy": ("mythic rule→quest/desire→magic consequence→world payoff", "24–85 mm; wides for scale, portraits for character", "crane/tracking with grounded physical geography", "motivated natural/fire/magic sources kept coherent", "lyrical or epic depending scene", "character/costume/world refs", "random magic effects; era/material inconsistency"),
"period-film": ("era-specific human conflict inside coherent material culture", "32–85 mm, period-appropriate restrained lens character", "dolly/lock/handheld according to period and tone", "window, candle, fire, daylight practical logic", "less hyperactive coverage", "wardrobe/prop/location refs", "anachronistic hardware/signage; modern beauty styling"),
"sports-commercial": ("challenge→effort→technique→impact→achievement/product proof", "24–85 mm plus long-lens compression for field action", "tracking, low chase, body-follow, occasional high-speed feel", "hard directional or stadium/practical motivation", "accelerating with readable technique", "athlete/product refs", "broken biomechanics; gratuitous speed ramps"),
"fitness-commercial": ("goal→form→effort→progress→benefit", "35–85 mm body/form coverage", "controlled follow and stable form-revealing angles", "directional gym/window light", "energetic but form-readable", "trainer/product refs", "unsafe/impossible exercise form; body distortion"),
"app-commercial": ("user problem→interaction→feature→benefit→CTA", "35–65 mm device/user plus readable UI inserts", "simple hand/device follow", "clean screen-safe light", "concise demo pacing", "device/interface refs", "unreadable UI; invented features"),
"architecture-film": ("context→approach→threshold→circulation→light/material→human scale", "16–35 mm controlled wide, 50–85 mm detail", "slow dolly/gimbal, measured vertical reveal", "available architecture light with window priority", "slow spatial comprehension", "exact property refs", "bent verticals; impossible circulation"),
"interior-film": ("room hierarchy→material detail→circulation→use case", "18–35 mm controlled wide, 50–85 mm detail", "slow doorway/parallel moves", "window/practical balance", "calm and readable", "exact interior refs", "ultra-wide stretching; furniture teleportation"),
"event-promo": ("anticipation→crowd energy→hero moments→social proof→CTA", "24–70 mm environment and people", "handheld/gimbal/drone only when scale helps", "venue practicals + stage light", "fast montage with hero holds", "venue/performer refs when specific", "random crowds; no event identity"),
"educational-video": ("question→concept→example→demonstration→recap", "35–65 mm presenter plus explanatory inserts", "simple stable camera", "clear legible light", "cognitive pacing with pauses", "presenter/object refs", "visual decoration unrelated to concept"),
"explainer-video": ("problem→mechanism→benefit→proof→next action", "clean medium coverage + object/detail inserts", "simple motivated reveals", "neutral/brand light", "dense but stepwise", "product/interface refs", "skipping mechanism; generic abstract visuals"),
"editorial-film": ("point of view→visual argument→portrait/detail contrast→open resolution", "28–100 mm expressive editorial mix", "deliberate authored movement or lock", "fashion/documentary hybrid lighting", "magazine-like contrast in rhythm", "subject/location refs", "style with no editorial thesis"),
"art-film": ("formal rule→repetition/variation→duration→conceptual shift", "any lens family if formally consistent", "rule-based movement or deliberate stillness", "light as material/concept", "may use long duration or discontinuity intentionally", "references only when identity is conceptually required", "random surrealism with no formal rule"),
"luxury-brand-director": ("desire→material evidence→controlled access→iconic resolution", "65–135 mm + macro detail", "slow arcs, micro pushes, locks", "shaped specular gradients and deep blacks", "slow, confident holds", "brand/product refs", "gold-particle cliché; excessive flare"),
"beauty-ad-director": ("face/problem/effect→application or result→confidence hero", "65–100 mm facial perspective", "slow push/orbit, stable close beauty", "large soft key 2:1–3:1 fill", "detail holds on effect", "face/product refs", "plastic skin; makeup drift"),
"perfume-ad-director": ("sensory motif→skin/space association→bottle icon→desire resolution", "65–100 mm portrait + 85–100 mm macro", "slow tactile drift, orbit, reveal", "low-key specular bottle light + soft skin key", "poetic holds, few beats", "bottle/character refs", "generic smoke/gold particles; unreadable bottle"),
"watch-commercial-director": ("precision→mechanism/material→wrist context→time icon", "85–100 mm macro + 65–100 mm wrist portrait", "micro orbit/push with exact dial orientation", "strip reflections across crystal/metal", "precise slow detail rhythm", "watch refs mandatory", "warped dial; changing indices; impossible hands"),
"jewelry-commercial-director": ("stone/metal detail→skin relationship→light event→iconic hero", "85–100 mm macro + 65–100 mm portrait", "micro orbit, controlled hand move", "hard pin accents + soft gradient base", "slow sparkle read time", "jewelry refs mandatory", "extra stones; changing setting; blown highlights"),
"fashion-commercial-director": ("look→movement→attitude→collection/world→brand resolve", "35–85 mm + selected 24–28 mm attitude wide", "tracking, lateral, editorial locks", "hard sun/studio or controlled soft editorial", "music-led but garment-readable", "model/wardrobe refs", "garment identity drift; random runway walk"),
"car-commercial-director": ("stance→design lines→driving proof→interior/feature→hero", "24–70 mm, longer compression pass", "low tracking, parallel truck, chase, drone geography", "time-of-day reflection control", "dynamic with stable hero holds", "exact car refs", "sliding wheels; morphing body panels"),
"food-ad-director": ("ingredient→preparation→texture transformation→serve→bite/hero", "50–65 mm table + 85–100 mm macro", "micro push, overhead, ingredient follow", "3/4 backlight for steam/translucency", "sensory detail holds", "dish/product refs", "waxy food; impossible steam/sauce"),
"drink-ad-director": ("cold cue→pour/bubbles→glass/package→refreshment payoff", "50–85 mm product + macro", "pour-follow, micro orbit, locked splash", "hard back/rim + strip gradients", "slow liquid detail + crisp payoff", "package refs", "malformed glass; label drift; impossible liquid"),
"technology-ad-director": ("problem→industrial detail→mechanism/feature→human benefit→hero", "50–100 mm product + contextual 35–50 mm", "controlled orbit/push", "clean edge/strip gradients", "precise and efficient", "product/interface refs", "generic holograms; invented function"),
"smartphone-ad-director": ("device icon→camera/display detail→hand interaction→feature proof→lifestyle", "50–100 mm device + 35–50 mm use", "controlled orbit, hand-follow", "clean reflection control, readable display", "quick feature beats with hero holds", "exact device refs", "camera-module morphing; unreadable display"),
"hospitality-commercial-director": ("arrival→service→room→food/wellness→destination payoff", "24–50 mm place + 65–100 mm service detail", "guest-follow, reveals, measured drone", "warm practical/window balance", "aspirational but unhurried", "property/guest refs", "generic luxury lobby; service with no story"),
"real-estate-commercial-director": ("exterior/context→arrival→key spaces→amenities→view/lifestyle→CTA", "16–35 mm controlled wide + detail lens", "slow gimbal/dolly, doorway reveals", "natural window + practical balance", "spatially readable holds", "exact property refs", "distorted rooms; fake views; changing finishes"),
}


def group_for(skill: SkillDef) -> str | None:
    for name, members in GROUPS.items():
        if skill.slug in members:
            return name
    return None


def profile(skill: SkillDef) -> tuple[list[tuple[str,str,str]], list[str], list[tuple[str,str,str]]]:
    g = group_for(skill)
    if g:
        rules = [(f"The shot specifically requires {skill.slug.replace('-', ' ')}", "make the narrow decision owned by this specialist before the parent director signs off", skill.responsibility)] + GROUP_RULES[g]
        standards = [f"Specialist scope: {skill.responsibility}"] + GROUP_STANDARDS[g]
        failures = [
            ("specialist output contradicts parent director", "narrow parameter was chosen in isolation", skill.id),
            ("continuity-linked value drifts", "specialist value was not carried into continuity state", "continuity/continuity-supervisor"),
            ("prompt contains conflicting instructions", "specialist output was merged without conflict preflight", "prompt/prompt-conflict-detector"),
        ]
        return rules, standards, failures
    if skill.category == "genre":
        story, lens, camera, light, pace, refs, avoid = GENRE_DETAIL.get(skill.slug, (
            "clear genre-specific setup, development, and payoff", "35–85 mm unless subject requires otherwise", "motivated movement only", "source-motivated lighting", "rhythm matched to genre", "references when identity or product exactness matters", "generic cinematic adjective stacks"
        ))
        rules = [
            ("Story grammar is unconstrained", story, "The genre should be recognizable in information structure before styling."),
            ("Lens tendency is unconstrained", lens, "Perspective should support the genre's preferred subject relationship."),
            ("Camera movement is unconstrained", camera, "Movement is a storytelling behavior, not a cinematic decoration."),
            ("Lighting is unconstrained", light, "Source behavior carries genre and material meaning."),
            ("Edit rhythm is unconstrained", pace, "Temporal grammar is part of genre identity."),
            ("Identity/product exactness is high", refs, "Reference strategy should follow control requirements."),
        ]
        standards = [
            f"Story grammar: {story}.", f"Lens tendency: {lens}.", f"Camera tendency: {camera}.", f"Lighting tendency: {light}.", f"Editing rhythm: {pace}.", f"Reference strategy: {refs}.", f"Avoid: {avoid}.",
            "The genre skill changes priorities and QC weights but never hardcodes endpoints, payload fields, or model keys.",
            "Record explicit tendencies for visual grammar, shot vocabulary, performance, production design, motion, reference use, common failures, and clichés.",
        ]
        failures = [
            ("genre reads as generic AI video", "genre grammar was reduced to adjectives", skill.id),
            ("camera/light style contradicts story grammar", "craft choices ignored genre priorities", "foundation/visual-director"),
            ("identity/product drifts", "reference strategy was too weak for exact subject requirements", "strategy/reference-asset-director"),
        ]
        return rules, standards, failures
    if skill.category == "flow":
        rules = [
            ("Authorized browser/session precondition is missing", "abort the mutation", "Security context may not be fabricated or bypassed."),
            ("Capability evidence is partial", "emit warning and require explicit partial allowance", "Partial evidence is not production verification."),
            ("A known disproved request field appears", "reject before transport", "Known-invalid shapes must not regress."),
            ("Logging would expose token/cookie/PII/signed secret", "sanitize before persistence", "Observability must not become a credential leak."),
            ("CDP transport fails", "classify transport separately from generation status", "Browser transport failure is not media failure."),
        ]
        standards = [f"Evidence: {skill.evidence_level}; reference {skill.reference}.", f"Runtime surface: {skill.endpoint}.", "Use only authorized browser/session context.", "Never fabricate, persist, or replay reCAPTCHA tokens.", "Preserve mediaId request shapes and sanitize secret material before logs/fixtures."]
        failures = [("security rejection", "browser-generated security context was not accepted", "flow/browser-session"), ("schema rejection", "payload differs from verified source", "flow/error-classifier"), ("transport timeout", "CDP/network transport failed without a media verdict", "flow/error-classifier")]
        return rules, standards, failures
    if skill.category == "continuity":
        domain = skill.slug.replace("-continuity", "").replace("-", " ")
        rules = [
            (f"Previous {domain} state is unchanged by story", "carry the exact state forward", "Continuity is authoritative unless the script creates a change."),
            (f"The script intentionally changes {domain}", "record before/after values at the transition shot", "Intentional change requires traceable timing."),
            (f"Rendered {domain} contradicts locked state", "hard-fail continuity and diagnose owner", "Accepting drift propagates errors into later shots."),
            ("Information is missing but low-risk", "infer minimally and mark assumption", "The pipeline should proceed without inventing major state changes."),
            ("Two state sources disagree", "prefer the latest accepted authoritative snapshot", "One continuity truth prevents contradictory handoffs."),
        ]
        standards = ["Continuity snapshots are immutable after acceptance and version monotonically.", "Compare only observable or production-relevant state, not private personal data.", "Track change timing at shot boundaries and preserve exact values when unchanged.", "Feed continuity score into QC without creating a competing parallel state store."]
        failures = [("state drifts", "previous accepted value was not carried", skill.id), ("intentional change looks accidental", "transition shot did not record before/after", skill.id), ("two continuity values conflict", "multiple authorities edited state", "continuity/continuity-state-manager")]
        return rules, standards, failures
    if skill.category == "prompt":
        rules = [
            ("Generation method has fixed visual anchors", "describe desired evolution rather than repainting locked reference content", "Method-specific prompts should not fight supplied images."),
            ("Prompt contains mutually exclusive camera/light/motion instructions", "block and return conflict", "Contradiction before spend is cheaper than failed generation."),
            ("Identity/product anchors are critical", "state preservation requirements early and concretely", "Critical constraints should not be buried."),
            ("A negative constraint has no named risk", "omit it", "Avoidance spam can introduce irrelevant concepts."),
            ("Prompt is long", "remove redundant modifiers before load-bearing anchors", "Compression preserves control hierarchy."),
        ]
        standards = ["Order prompt information by subject/action/environment, cinematography, camera, composition, lighting, color, performance, motion, temporal behavior, continuity anchors, then justified avoidance constraints.", "Use observable instructions rather than 'epic', 'masterpiece', or 'very cinematic'.", "Keep method-specific language consistent with t2v/i2v/reference/interpolation/edit semantics.", "Never place endpoint/model/payload claims in creative prompt skills."]
        failures = [("reference is repainted", "prompt redundantly overrides supplied image identity", skill.id), ("camera instructions conflict", "multiple method fragments were merged", "prompt/prompt-conflict-detector"), ("prompt loses continuity anchor", "compression removed a critical constraint", "prompt/prompt-compressor")]
        return rules, standards, failures
    if skill.category == "strategy":
        rules = [
            ("Exact identity/product or composition is load-bearing", "prefer reference/image control when available", "Text-only generation should not rediscover exact assets unnecessarily."),
            ("Both endpoints are important", "consider start-end interpolation", "Fixed endpoints provide stronger path control."),
            ("Existing shot is strong with one localized defect", "prefer edit/extend", "Preserve sunk quality and credit value."),
            ("Budget pressure rises", "cut speculative variants before required coverage", "Coverage completeness outranks lottery generation."),
            ("Capability is partial/unavailable", "degrade explicitly and warn", "Unverified runtime must not be presented as guaranteed."),
        ]
        standards = ["Use live credit balance and evidence-labelled registry observations; never hardcode observed prices as permanent.", "Variant count should normally remain in the 1–4 range and be tied to uncertainty.", "Retry plans change causally implicated parameters and stop after 3 non-improving attempts by default.", "No verified seed-control API exists; reference consistency must not be misrepresented as seed control."]
        failures = [("blind retry burns credits", "same input repeated without diagnosis", "strategy/retry-strategy"), ("unverified capability promised", "evidence warning was dropped", "flow/model-resolver"), ("exact subject drifts under t2v", "method ignored reference need", "strategy/generation-method-router")]
        return rules, standards, failures
    if skill.category in {"foundation", "story"}:
        rules = [
            ("A brief fact is explicit", "preserve it as a locked project fact", "Downstream creativity must not overwrite supplied facts."),
            ("Optional information is missing", "infer a conservative default and declare the assumption", "Proceed without unnecessary interrogation."),
            ("Two objectives conflict", "rank by project objective, audience, duration, and client constraints", "Silent blending hides trade-offs."),
            ("A beat or decision has no job", "remove or merge it", "Every element should earn runtime and generation cost."),
            ("A visual idea is abstract", "translate it into observable action or image behavior", "Downstream skills require generatable specificity."),
        ]
        standards = ["Use one controlling idea and an explicit hierarchy of objectives.", "Plan total beat/shot duration within roughly ±5% before generation.", "Short-form hooks communicate a clear promise within about 1–3 s.", "Never invent claims, PII, or runtime facts while filling a creative gap."]
        failures = [("brief contradiction disappears", "conflict was silently blended", skill.id), ("duration overruns", "too many beats survived planning", "craft/shot-duration-designer"), ("story is visually abstract", "action was not converted to observable behavior", "story/scene-designer")]
        return rules, standards, failures
    if skill.category == "qc":
        rules = [("Overall >=8.5 and critical dimensions pass", "PASS", "Default production gate."), ("Overall 7.0–8.49 with localized defects", "EDIT", "Targeted repair preserves good work."), ("Overall <7.0", "REGENERATE", "Shot is too broadly wrong."), ("Critical identity/product/anatomy/continuity <5.5", "hard-fail", "Average must not hide catastrophic failure."), ("Critics disagree", "retain per-dimension evidence and inspect critical owner", "Aggregation must stay explainable.")]
        standards = ["Score on a 0–10 scale with dimension evidence.", "Default thresholds: >=8.5 PASS, 7.0–8.49 EDIT, <7.0 REGENERATE.", "Critical hard-fail default is 5.5.", "QC never rewrites the shot; it returns evidence to the owning skill."]
        failures = [("high average hides fatal defect", "critical dimension not hard-gated", skill.id), ("critic gives only adjectives", "no observable evidence attached", skill.id), ("continuity score conflicts with state", "critic used non-authoritative state", "continuity/continuity-supervisor")]
        return rules, standards, failures
    if skill.category == "failure":
        rules = [("Defect repeats", "identify first change point and owning parameter", "Repeated symptom implies a stable cause."), ("Defect is local", "plan minimal repair", "Protect successful regions."), ("Transport status is unknown", "do not call it media failure", "Transport and generation outcomes differ."), ("Retry does not improve score", "change strategy rather than repeat", "Causal intervention is required."), ("Three attempts stall", "escalate", "Bounded retries protect credits.")]
        standards = ["Diagnosis must name signature, likely cause, owning skill, proposed delta, and expected measurable improvement.", "Change the minimum parameter set necessary.", "Default to no more than 3 non-improving retries before escalation.", "Keep anatomy, physics, identity, continuity, artifact, prompt, and camera failures separately attributable."]
        failures = [("analysis says 'AI glitch'", "failure signature is not classified", skill.id), ("retry changes unrelated departments", "causal ownership was lost", "strategy/retry-strategy"), ("credits loop without improvement", "stopping rule was ignored", "orchestration/budget-manager")]
        return rules, standards, failures
    # orchestration
    rules = [("A domain choice is required", "delegate to registered owner", "Orchestration owns order, not taste."), ("Producer output is missing", "schedule producer before consumer", "Typed data dependencies determine order."), ("QC rejects shot", "diagnose then minimally repair", "Blind regeneration is not orchestration."), ("Evidence is partial", "carry warning to manifest", "Auditability is mandatory."), ("Project finalizes", "emit assets, mediaIds, scores, continuity, credits, runtime warnings", "Delivery must be reproducible and inspectable.")]
    standards = ["Never hardcode hidden craft or genre decisions in orchestration.", "Every accepted shot carries mediaId, generation record, QC verdict, and continuity state.", "Track retry count, parameter delta, score delta, and observed credit delta.", "Final manifest retains all runtime-partial warnings."]
    failures = [("orchestrator chooses lens/light", "domain expertise leaked into coordinator", skill.id), ("mediaId mapping is ambiguous", "logical asset ledger was bypassed", "orchestration/media-id-manager"), ("failed shot finalizes", "QC gate state was ignored", "orchestration/project-qc-manager")]
    return rules, standards, failures


def triggers(skill: SkillDef) -> list[str]:
    if skill.category == "genre":
        return [f"the brief explicitly matches {skill.slug.replace('-', ' ')} grammar and needs its specialist conventions", f"the project router needs genre-specific lens, light, rhythm, performance, reference, and QC priorities from {skill.id}"]
    if skill.category == "flow":
        return [f"the approved runtime plan requires {skill.id} in an authorized Google Flow session", f"the evidence gate has resolved the capability needed by {skill.id} without guessing an unsupported endpoint"]
    return [f"the current shot or project needs the narrow responsibility explicitly owned by {skill.id}", f"a parent director or downstream skill is missing the specialist decision produced by {skill.id}"]


def not_for(skill: SkillDef) -> list[str]:
    return [
        "taking over neighboring specialist responsibilities or making unrelated taste decisions",
        "inventing Google Flow endpoints, model keys, payload fields, credits, security tokens, or unverified capabilities",
    ]


def integration(skill: SkillDef) -> str:
    if skill.category == "flow":
        note = f" {skill.runtime_note}" if skill.runtime_note else ""
        return f"Runtime surface: `{skill.endpoint}` from `GOOGLE_FLOW_API_REFERENCE.md {skill.reference}`.{note} This skill consumes approved creative/strategy data and makes no aesthetic decision."
    return "This skill emits specification only. It never hardcodes a Google Flow endpoint, payload field, model key, or credit price. Runtime execution is selected later by `strategy/shot-generation-router` and the evidence-aware `flow/*` layer."


def evidence(skill: SkillDef) -> str:
    if skill.category == "flow":
        return f"`GOOGLE_FLOW_API_REFERENCE.md {skill.reference}` — `[{skill.evidence_level}]`. The label is copied without upgrade."
    return "Not applicable — this skill performs no runtime call."


def fm(skill: SkillDef) -> str:
    data = {
        "id": skill.id, "version": "1.0.0", "name": skill.name, "category": skill.category, "layer": skill.layer,
        "responsibility": skill.responsibility, "evidence_level": skill.evidence_level,
        "dependencies": list(skill.dependencies), "optional_dependencies": list(skill.optional_dependencies),
        "consumes": list(skill.consumes), "produces": list(skill.produces),
        "triggers": triggers(skill), "not_for": not_for(skill), "determinism": skill.determinism, "side_effects": skill.side_effects,
    }
    return "---\n" + yaml.safe_dump(data, sort_keys=False, allow_unicode=True, width=120).strip() + "\n---\n"


def bullets(items):
    return "\n".join(f"- {x}" for x in items) if items else "- None."


def skill_body(skill: SkillDef) -> str:
    rules, standards, failures = profile(skill)
    rtab = "\n".join(f"| {a} | {b} | {c} |" for a,b,c in rules)
    ftab = "\n".join(f"| {a} | {b} | {c} |" for a,b,c in failures)
    dep = bullets(skill.dependencies)
    con = bullets([f"`{x}`" for x in skill.consumes])
    prod = bullets([f"`{x}`" for x in skill.produces])
    extra = ""
    if skill.category == "genre":
        extra = "\nA genre profile also publishes QA weights and reference bias to orchestration. It may influence craft priorities through data, but craft skills do not depend upward on genre skills; this keeps the dependency graph acyclic.\n"
    if skill.category == "flow" and skill.evidence_level == "RUNTIME_PARTIAL":
        extra += "\nThis operation is runtime-partial. The caller must expose a warning and may not promise successful delivery until runtime evidence advances.\n"
    if skill.id == "strategy/seed-reference-consistency-planner":
        extra += "\nThere is **no verified seed-control API** in the current source. The word `seed` in this skill name is a compatibility label from the requested taxonomy; implementation uses reference consistency only and must explicitly report seed control as unavailable.\n"
    return dedent(f'''
# {skill.name}

## Purpose

{skill.responsibility} This specialist exists because the decision has its own expertise, can fail independently, and must be testable rather than hidden inside a generic “cinematic” prompt.

## Responsibility

Own one narrow responsibility only: **{skill.responsibility}** Parent directors coordinate specialists; they do not erase specialist ownership.

## When To Use

{bullets(triggers(skill))}

## When NOT To Use

{bullets(not_for(skill))}

## Inputs

The skill reads only the typed shared documents needed for its decision:

{con}

Missing optional values may be inferred only when low-risk; every inference is written to `assumptions[]` with confidence.

## Outputs

The skill writes its owned decision to:

{prod}

All outputs use the standard envelope with `skill_id`, `skill_version`, `produced_at`, `result`, `rationale`, `assumptions`, `warnings`, and `handoff`.

## Dependencies

Hard dependencies:

{dep}

A dependency supplies context or a parent policy. It does not authorize this skill to take over the dependency's responsibility.

## Decision Framework

| condition | choice | reason |
|---|---|---|
{rtab}

When no row matches exactly, the skill may choose another option only if `rationale` records the condition, the chosen value, at least one rejected alternative, and the observable reason.

## Workflow

1. Validate the required input slices and locked project constraints.
2. Read parent-director policy and the latest accepted continuity state when applicable.
3. Identify the single decision dimension owned by this specialist.
4. Apply the decision table from hard constraints to soft preferences.
5. Compare at least one plausible alternative for heuristic or generative decisions.
6. Write the result without mutating neighboring specialist fields.
7. Run conflict checks against continuity, brand, identity, runtime evidence, and generation method.
8. Hand off to the parent director, prompt layer, strategy layer, QC owner, or runtime executor named by the pipeline.

## Professional Standards

{bullets(standards)}
{extra}
## Google Flow Integration

{integration(skill)}

## Runtime Evidence

{evidence(skill)}

## Constraints

- Creative specialists never call or name backend endpoints in their output.
- Runtime specialists never select lens, lighting, composition, performance, story, or genre taste.
- Request media references use `mediaId`; disproved `.name` shapes are not reintroduced for video inputs.
- Image upload uses raw Base64 `imageBytes`, never the disproved `encodedImage` field.
- reCAPTCHA is browser-generated; no fabrication, replay, persistence, or bypass is allowed.
- Client claims, identity facts, and PII are never invented to fill a creative gap.
- A failed generation is diagnosed before retry; identical blind retry is prohibited.

## Failure Modes

| signature | cause | owning fix |
|---|---|---|
{ftab}

## Recovery Strategy

If the specialist decision is wrong, revise `{skill.id}` only. For rendered-media failures call `failure/generation-failure-analyzer`, then a specialized analyzer when available, and finally `strategy/edit-vs-regenerate-selector` or `strategy/retry-strategy`. Preserve successful parameters and change the minimum causally implicated set.

## Quality Checklist

- [ ] The output changes only the specialist field owned by `{skill.id}`.
- [ ] The decision is motivated by an observable narrative, spatial, material, temporal, identity, brand, or runtime requirement.
- [ ] Heuristic/generative outputs include rationale and a rejected alternative.
- [ ] Locked continuity, brand, character, product, and factual constraints remain unchanged unless the script explicitly transitions them.
- [ ] No generic adjective stands in for a measurable or observable instruction.
- [ ] Runtime evidence claims match the source exactly and partial capability warnings are preserved.
- [ ] No OAuth token, cookie, reCAPTCHA token, PII, or signed CDN secret appears in logs/examples.
- [ ] The handoff names the next owner and does not silently expand this skill's scope.

## Examples

See `examples/example.md` for a standard specialist decision and a harder conflict/evidence-limited case using fictional subjects and sanitized identifiers.
''').strip() + "\n"


def examples(skill: SkillDef) -> str:
    handoff = "strategy/shot-generation-router" if skill.category not in {"flow","qc","failure","orchestration"} else ("flow/generation-poller" if skill.category == "flow" else "strategy/edit-vs-regenerate-selector")
    return dedent(f'''
# {skill.name} — Worked Examples

## Example 1 — Narrow specialist decision

### Input slice
```yaml
project:
  title: Fictional Meridian Campaign
  duration_seconds: 30
  aspect_ratio: "16:9"
shot:
  shot_id: S04
  narrative_function: controlled_reveal
locked:
  identity: true
  brand: true
  continuity: true
```

### Reasoning
The specialist evaluates only this responsibility: {skill.responsibility} It chooses one motivated value, records a rejected alternative, and leaves neighboring fields untouched.

### Output envelope
```json
{{
  "skill_id": "{skill.id}",
  "skill_version": "1.0.0",
  "produced_at": "2026-08-29T09:00:00Z",
  "result": {{"status": "ok", "owner": "{skill.id}", "locked_constraints_preserved": true}},
  "rationale": [{{"decision": "apply specialist rule", "because": "it serves the shot function without violating locked state", "rejected": ["generic cinematic treatment"]}}],
  "assumptions": [],
  "warnings": [],
  "handoff": ["{handoff}"]
}}
```

## Example 2 — Conflict and controlled degradation

### Input slice
```yaml
shot:
  shot_id: S09
requirements:
  primary: preserve exact approved identity and continuity
  conflicting: introduce a contradictory visual change
runtime_policy:
  allow_evidence_upgrade: false
```

### Reasoning
The locked requirement wins. The conflicting request is surfaced instead of blended. Runtime-partial skills add an explicit warning; creative skills never invent a runtime workaround.

### Output envelope
```json
{{
  "skill_id": "{skill.id}",
  "skill_version": "1.0.0",
  "produced_at": "2026-08-29T09:01:00Z",
  "result": {{"status": "conflict_resolved", "owner": "{skill.id}"}},
  "rationale": [{{"decision": "preserve locked requirement", "because": "identity/continuity/evidence constraints outrank decoration", "rejected": ["contradictory change"]}}],
  "assumptions": [],
  "warnings": ["conflicting request was not silently merged"],
  "handoff": ["{handoff}"]
}}
```
''').lstrip()


def cases(skill: SkillDef) -> str:
    rows=[]
    for i,kind in enumerate(CASE_KINDS[skill.category],1):
        rows.append({"id":f"{kind.replace('_','-')}-{i}","kind":kind,"input":{"brief":f"Fictional {skill.name} {kind} case","shot_id":f"S{i:02d}","constraints":{"preserve_locked_state":True,"no_secret_logging":True}},"expect":{"result.status":"ok" if kind=="happy_path" else "handled","rationale":"non_empty"}})
    return json.dumps({"skill":skill.id,"cases":rows},ensure_ascii=False,indent=2)+"\n"


for skill in FULL:
    if skill.id in BASE:
        continue
    base=ROOT/"skills"/skill.category/skill.slug
    (base/"examples").mkdir(parents=True,exist_ok=True)
    (base/"tests").mkdir(parents=True,exist_ok=True)
    (base/"SKILL.md").write_text(fm(skill)+skill_body(skill),encoding="utf-8")
    (base/"examples"/"example.md").write_text(examples(skill),encoding="utf-8")
    (base/"tests"/"cases.yaml").write_text(cases(skill),encoding="utf-8")

# Contract test follows the plan rather than a stale hard-coded count.
(ROOT/"tests"/"test_contract.py").write_text(dedent('''
import json
from gfs.registry_build import discover, validate


def test_all_planned_skills_exist_and_validate(repo_root):
    plan = json.loads((repo_root / "skills_plan" / "plan.json").read_text(encoding="utf-8"))
    specs = discover(repo_root)
    assert len(specs) == plan["skill_count"]
    errors = validate(repo_root, specs)
    assert errors == [], "\\n".join(errors)


def test_each_skill_has_example_and_cases(repo_root):
    for spec in discover(repo_root):
        skill_dir = spec.path.parent
        assert (skill_dir / "examples" / "example.md").is_file(), spec.id
        cases = skill_dir / "tests" / "cases.yaml"
        assert cases.is_file(), spec.id
        payload = json.loads(cases.read_text(encoding="utf-8"))
        assert payload["skill"] == spec.id
        kinds = {row["kind"] for row in payload["cases"]}
        assert {"happy_path", "bad_input"} <= kinds
''').lstrip(),encoding="utf-8")

(ROOT/"tests"/"test_plan.py").write_text(dedent('''
import json


def test_plan_count_and_ids_are_unique(repo_root):
    data = json.loads((repo_root / "skills_plan" / "plan.json").read_text(encoding="utf-8"))
    ids = [row["id"] for row in data["skills"]]
    assert data["skill_count"] >= 200
    assert len(ids) == len(set(ids)) == data["skill_count"]
''').lstrip(),encoding="utf-8")

print(f"Expanded explicit specialist inventory to {len(FULL)} skills; created {len(FULL)-len(BASE)} new packages")
