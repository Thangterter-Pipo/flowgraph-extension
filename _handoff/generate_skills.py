from __future__ import annotations

import json
from pathlib import Path
from textwrap import dedent
from typing import Any

import yaml

from skill_catalog import S, SkillDef

ROOT = Path(r"E:\Google-flow-skills")

REQUIRED_CASE_KINDS = {
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

CRAFT = {
"cinematography-director": {
"decisions": [
("The shot must establish geography before character detail", "wide or medium-wide at eye to chest height", "Spatial comprehension is the narrative job; close coverage would hide relationships."),
("The shot carries intimate recognition or emotional reading", "medium close-up or close-up near eye level", "Facial micro-behavior becomes legible without imposing a power angle."),
("The subject must feel dominant or structurally imposing", "lower camera height with controlled upward angle", "Perspective communicates power while avoiding exaggerated wide-lens distortion."),
("The subject must feel exposed or diminished", "higher camera height with visible surrounding space", "The environment gains visual weight around the subject."),
("Coverage must cut cleanly with an adjacent dialogue shot", "match eyeline, camera side, and relative shot scale", "Editorial continuity is more important than novelty in coverage."),
],
"standards": ["Treat shot size, camera height, angle, and distance as one coupled geometry decision.", "For close facial work, keep perspective changes between adjacent identity-critical shots modest; avoid jumping from extreme wide proximity to long-lens compression without motivation.", "Use the 180° rule as the default continuity constraint; cross the line only when the scene explicitly re-establishes geography.", "A 9:16 crop needs more vertical head/hand awareness than 16:9 or 2.39:1 framing."],
"failure": [("face appears distorted", "camera is too close for the chosen wide perspective", "craft/cinematography-director"), ("space feels unreadable", "coverage began too tight", "craft/cinematography-director"), ("cut reverses perceived screen direction", "camera side changed without re-establishing", "craft/blocking-director")],
},
"lens-director": {
"decisions": [
("Environmental context is load-bearing", "24–35 mm equivalent perspective", "Moderate wide perspective keeps subject and setting relationally present."),
("Natural human perspective with flexible staging is desired", "40–50 mm equivalent perspective", "Normal-range perspective avoids strong expansion or compression."),
("Portrait identity and flattering facial geometry are critical", "65–100 mm equivalent perspective", "Longer camera distance reduces near-feature exaggeration."),
("Product texture or tiny physical detail is the hero", "85–100 mm macro language", "Macro rendering isolates material detail and controls background scale."),
("Background compression or surveillance distance is intentional", "100–135 mm telephoto language", "Compressed depth makes layers appear closer and visually denser."),
("Dreamlike horizontal flare and oval-bokeh character is required", "anamorphic rendering intent", "Optical character is part of the visual bible rather than a generic cinematic adjective."),
],
"standards": ["Choose focal length together with camera-to-subject distance; focal length alone does not define perspective.", "Use shallow depth of field only when focus isolation serves hierarchy; identity-critical motion may require more depth tolerance than an f/1.4-style look.", "For face consistency, prefer stable perspective families across a sequence, e.g. 65/85/100 mm rather than 24/100/18 mm jumps.", "Macro prompts should specify plane of focus and material detail, not only the word macro."],
"failure": [("facial proportions drift", "perspective family changes sharply between identity shots", "craft/lens-director"), ("focus pumps or ignores subject", "focus target is unspecified during motion", "craft/lens-director"), ("wide shot looks telephoto-flat", "focal language conflicts with requested spatial expansion", "prompt/prompt-conflict-detector")],
},
"camera-movement-director": {
"decisions": [
("The story reveals information by approaching a subject", "slow dolly or push-in with eased start/stop", "Forward movement adds attention only when the reveal motivates it."),
("The scene must describe lateral geography", "truck or tracking move parallel to subject", "Parallax exposes spatial relationships more clearly than a pan from one point."),
("A product needs dimensional form reveal", "10–30° controlled orbit", "A limited arc reveals surfaces without turning the shot into gratuitous rotation."),
("Urgency or instability belongs to the point of view", "restrained handheld with bounded amplitude", "Instability becomes expressive rather than accidental."),
("Stillness is the dramatic pressure", "locked-off frame", "Removing camera motion can make subject motion and silence more consequential."),
("Large-scale geography is the subject", "crane, drone, or elevated reveal", "Vertical displacement is justified by spatial information unavailable from eye level."),
],
"standards": ["Every move needs a motivation: reveal, follow, reframe, geography, energy, or point-of-view change.", "Describe path + direction + velocity profile + stabilization character; 'smooth cinematic movement' is insufficient.", "Keep product or face orbits modest unless full rotation is itself the concept; 10–30° is often enough for dimensional parallax.", "Avoid combining locked-off, rapid handheld, orbit, and dolly in one 4–8 s shot."],
"failure": [("camera move is ignored", "movement instruction is weak or buried behind competing actions", "craft/camera-movement-director"), ("camera overshoots subject", "path lacks destination and stop condition", "craft/camera-movement-director"), ("motion feels floaty", "rig/stabilization character is unspecified", "craft/camera-movement-director")],
},
"composition-director": {
"decisions": [
("Brand or product hero demands iconic certainty", "centered or near-symmetrical composition", "Central geometry reads as deliberate and premium when the object itself is the hierarchy."),
("The subject looks into or moves toward one side", "reserve lead room in that direction", "Negative space supports eyeline and motion rather than feeling accidental."),
("A 9:16 placement needs captions or interface overlays", "keep critical face/product detail inside central safe band", "Platform chrome and captions often occupy top and bottom zones."),
("The scene communicates isolation", "increase negative space and reduce competing foreground detail", "Visual emptiness carries the emotional meaning."),
("Depth and immersion are priorities", "foreground-midground-background layering", "Occlusion and scale layers create spatial depth without relying on shallow focus alone."),
],
"standards": ["Rule of thirds is an option, not a default.", "For 9:16, inspect top/bottom caption and UI risk explicitly; do not simply crop a 16:9 composition.", "Keep important logos, eyes, and product edges away from unstable frame boundaries.", "Use symmetry when architecture, ritual, luxury, or product precision supports it; break symmetry intentionally for tension."],
"failure": [("subject feels accidentally off-center", "no declared hierarchy or lead room", "craft/composition-director"), ("captions cover product", "vertical safe area was not reserved", "craft/composition-director"), ("frame becomes visually flat", "foreground/background separation was omitted", "craft/composition-director")],
},
"blocking-director": {
"decisions": [
("Two speakers exchange dialogue", "lock eyelines and preserve 180° screen side", "Stable left/right relationships reduce editorial confusion."),
("A character must cross frame", "declare entrance edge, path, and exit or stop point", "Generative motion is more stable when start and destination are explicit."),
("A reveal occurs behind foreground architecture", "stage occluder and subject on separate depth planes", "The reveal can be motivated by movement instead of arbitrary appearance."),
("Several people share the shot", "assign each person a stable zone and one dominant action", "Crowd ambiguity increases duplication and identity drift."),
("A prop changes hands", "specify hand, giver, receiver, and transfer moment", "Contact continuity is a known generative failure risk."),
],
"standards": ["Keep screen direction stable across adjacent coverage unless a neutral or re-establishing shot resets it.", "For handoffs, specify right/left hand and object ownership before and after contact.", "Use 2–3 depth zones for multi-subject scenes rather than undefined crowd milling.", "Eyeline targets must be spatial: camera-left partner, mirror, doorway, product — not only 'looks thoughtful'."],
"failure": [("actors swap sides", "screen geography was not anchored", "craft/blocking-director"), ("prop teleports between hands", "handoff states were incomplete", "continuity/continuity-supervisor"), ("extra person appears", "crowd zones and headcount were vague", "craft/blocking-director")],
},
"lighting-director": {
"decisions": [
("Beauty or skin texture must remain flattering", "large soft source near frontal 30–45° with controlled fill", "Broad source size smooths transitions while preserving facial structure."),
("Drama needs shaped contrast", "key-to-fill around 4:1 with negative fill", "Contrast adds modeling without losing all shadow information."),
("Severe low-key tension is intentional", "8:1 or stronger apparent contrast with motivated practicals", "Deep shadow serves genre while practicals preserve believable source logic."),
("Product glass or metal needs edge definition", "strip or rim sources positioned for controlled specular gradients", "Reflective objects are defined by what they reflect, not by frontal brightness."),
("Day interior must feel natural", "window-motivated key near 5600 K with interior practicals around 2700–3200 K", "Mixed color temperature can feel motivated when source origins remain clear."),
("Night neon environment drives color", "motivated colored practicals plus neutral or complementary face key", "Color separation prevents skin from becoming an undifferentiated neon wash."),
],
"standards": ["Describe source role, direction, size/quality, color temperature, intensity relationship, and motivation.", "Beauty often lives around 2:1 to 3:1 apparent key/fill; dramatic commercial work may use 4:1 to 8:1 depending on subject and surface.", "Daylight language is commonly around 5600 K; tungsten practical language around 2700–3200 K.", "For reflective products, build gradients and edge strips instead of asking for 'bright studio lighting'."],
"failure": [("face key flips sides", "key direction is absent from continuity state", "continuity/continuity-supervisor"), ("metal product looks flat", "specular source geometry is undefined", "craft/lighting-director"), ("neon skin becomes muddy", "colored sources have no neutral skin strategy", "craft/color-director")],
},
"color-director": {
"decisions": [
("Luxury wants restrained chroma", "narrow palette with controlled saturation and deep neutral blacks", "Material and highlight quality carry value better than many competing hues."),
("Naturalistic documentary skin is primary", "neutral skin axis with restrained contrast curve", "Credibility requires skin to survive location color contamination."),
("Period or memory sequence needs texture", "controlled grain and softened highlight shoulder", "Texture should support time/place rather than imitate a filter preset."),
("Neon night needs separation", "assign dominant and accent hues with neutral skin escape", "Color contrast stays readable instead of becoming monochromatic contamination."),
("Bright tech product needs clarity", "clean neutrals, accurate product color, crisp highlight rolloff", "Industrial design accuracy outranks stylized grade drift."),
],
"standards": ["Separate production palette, lighting color, camera rendering intent, and grading intent.", "Keep skin tone policy explicit whenever a human face is present; do not let a 100% saturated environment overwrite identity.", "Use grain as texture scale, not as a generic 'film' adjective; keep it coherent across shots.", "Protect product and brand colors from creative grade drift when the brand bible marks them critical."],
"failure": [("skin hue changes between shots", "grade policy is not continuity-anchored", "continuity/continuity-supervisor"), ("product brand color drifts", "creative grade overrides brand constraint", "qc/brand-consistency-critic"), ("look feels like random filter", "production, lighting, and grade palettes are conflated", "craft/color-director")],
},
"production-designer": {
"decisions": [
("Luxury product needs controlled environment", "few high-quality materials with deliberate negative space", "Material specificity signals value better than decorative clutter."),
("Documentary credibility is required", "retain plausible wear, signage, utility objects, and lived-in irregularity", "Over-cleaning destroys evidentiary texture."),
("Period setting is load-bearing", "encode architecture, fixtures, props, fabrics, and wear appropriate to one era", "A single modern prop can break the entire world contract."),
("Tech commercial needs clean geometry", "precise industrial surfaces and restrained prop count", "Visual noise competes with interface and product form."),
("Horror scene needs threat geography", "design occlusion, depth corridors, practical sources, and off-screen access points", "The environment should create possibilities for threat rather than rely on darkness alone."),
],
"standards": ["Specify at least material, surface condition, scale, era, and spatial relationship for hero set elements.", "Use 3–5 dominant material families rather than an unbounded list.", "Props with continuity significance must receive stable identity and position anchors.", "Architecture prompts should mention verticals, apertures, circulation, and depth rather than only style labels."],
"failure": [("set details mutate", "too many unprioritized decorative elements", "craft/production-designer"), ("era breaks", "modern prop or surface entered period frame", "continuity/continuity-supervisor"), ("product loses hierarchy", "background material contrast competes with hero", "craft/composition-director")],
},
"costume-stylist": {
"decisions": [
("Character must remain identifiable across shots", "one locked silhouette, palette, fabric, and accessory set", "Wardrobe is a major identity anchor for generative consistency."),
("Fashion film centers garment motion", "choose fabric with explicit weight, stiffness, drape, and wind response", "Motion character comes from material behavior, not from the word 'flowing'."),
("Luxury brand requires restraint", "reduce competing logos and use controlled material finish", "Quiet hierarchy protects the hero brand."),
("Action requires broad movement", "avoid fragile details that would produce unstable cloth topology", "Simpler garment construction reduces temporal deformation."),
("Wardrobe must separate from background", "select value/color contrast deliberately", "Silhouette readability prevents body and clothing from merging."),
],
"standards": ["Lock silhouette, primary color, material, neckline, sleeve length, footwear, and accessories for continuity-critical characters.", "Describe cloth weight and response: heavy wool, crisp poplin, bias-cut silk, structured leather.", "For rapid motion, reduce small dangling accessories that can multiply or morph frame to frame.", "Keep product-category dress codes subordinate to brand-bible forbidden codes."],
"failure": [("outfit changes between shots", "wardrobe anchors were not persisted", "continuity/continuity-supervisor"), ("fabric moves like smoke", "material weight is unspecified", "craft/costume-stylist"), ("accessories duplicate", "too many small repeated details", "qc/artifact-detector")],
},
"hair-makeup-director": {
"decisions": [
("Beauty close-up is primary", "lock hairline, part, eyebrow shape, lip finish, and skin finish", "Small identity anchors carry strongly in close facial coverage."),
("Wind or motion affects hair", "define tied/loose state and strand behavior", "Hair topology otherwise changes unpredictably across frames."),
("Low-key light is used", "preserve eye and lip separation with controlled makeup reflectance", "Very matte or very glossy finishes can collapse under deep contrast."),
("Period styling is required", "bind hair shape and makeup palette to the production era", "Modern beauty conventions can break period credibility."),
("Product is cosmetics", "prioritize exact application zone and finish over generalized glamour", "The product effect must be inspectable."),
],
"standards": ["Persist 5–8 facial styling anchors for identity-critical talent.", "State skin finish as matte, satin, dewy, or controlled specular rather than 'perfect skin'.", "Coordinate highlight placement with the lighting design so forehead, nose, cheeks, and lips do not all clip simultaneously.", "Avoid adding/removing bangs, beard, part direction, or major color between continuity-linked shots."],
"failure": [("hair part flips", "part direction not continuity-locked", "continuity/continuity-supervisor"), ("face becomes plastic", "skin finish and light softness are over-specified toward gloss", "craft/hair-makeup-director"), ("makeup color drifts", "palette not tied to visual bible", "craft/color-director")],
},
"character-designer": {
"decisions": [
("Identity must survive many shots", "prioritize stable observable geometry and a limited set of distinctive anchors", "Too many ornamental descriptors are less reliable than a few strong identity traits."),
("Character is an ordinary documentary subject", "avoid stylized perfection and preserve plausible asymmetry", "Credibility depends on human specificity rather than idealization."),
("Character is a luxury spokesperson", "controlled grooming, posture, and movement signature", "Premium presence comes from behavioral restraint as much as appearance."),
("Character performs action", "choose body proportions and wardrobe compatible with clear limb articulation", "Generative anatomy suffers when silhouettes are overly complex."),
("Two characters share similar demographics", "differentiate silhouette, hair geometry, wardrobe value, and movement signature", "Distinct anchors reduce identity swapping."),
],
"standards": ["A character bible should lock estimated age range, facial geometry, hair, skin, body proportions, wardrobe family, accessories, movement style, and emotional baseline.", "Use observable geometry: oval jaw, high cheekbones, straight brows — not personality labels as physical traits.", "Keep 3–6 high-salience identity anchors stable across the project.", "Never store unnecessary PII in the identity contract."],
"failure": [("two characters merge", "identity anchors overlap too strongly", "craft/character-designer"), ("face drifts with angle", "geometry anchors are vague", "foundation/character-bible-builder"), ("body proportions mutate", "full-body silhouette not consistently specified", "qc/character-consistency-critic")],
},
"performance-director": {
"decisions": [
("Emotion is subtle", "one facial cue plus one small body cue", "Generatable behavior works better than stacked abstract emotions."),
("Confidence is required", "steady eyeline, relaxed shoulders, economical gesture", "Observable physical choices communicate confidence without adjective spam."),
("Anxiety is required", "delayed eye contact, shallow breath, small self-contact gesture", "Micro-actions create tension while remaining visually specific."),
("Product interaction is central", "specify gaze shift, hand path, contact point, and reaction beat", "Precise behavior protects product handling continuity."),
("Crowd reaction is needed", "assign one dominant collective behavior and a small variation band", "Independent actions for many extras create chaotic artifacts."),
],
"standards": ["Prefer 1–3 observable actions per 4–8 s shot.", "Write 'she exhales and her shoulders release' instead of 'she feels relieved'.", "Eyeline must name a target or direction.", "Avoid asking face, hands, body, and camera to execute several unrelated beats in a short shot."],
"failure": [("expression becomes exaggerated", "too many emotion adjectives compete", "craft/performance-director"), ("hands perform random gestures", "gesture path has no object or destination", "craft/performance-director"), ("eyeline jumps", "target is not spatially specified", "craft/blocking-director")],
},
"motion-director": {
"decisions": [
("Cloth motion is hero detail", "specify fabric weight, force direction, amplitude, and damping", "Material motion should follow a physical cause."),
("Hair moves in wind", "set wind direction and moderate strand response", "Unbounded hair motion is prone to topology drift."),
("Liquid pour is featured", "define source, destination, stream continuity, splash scale, and gravity", "Fluid shots fail when contact and container geometry are vague."),
("Vehicle speed is featured", "separate vehicle path, wheel rotation, suspension response, and camera motion", "Physical cues must agree or speed feels synthetic."),
("Particles or mist are atmospheric", "use low-density directional drift unless particles are the subject", "Dense random particles create flicker and occlusion artifacts."),
],
"standards": ["Every motion has a cause, direction, approximate speed, and stop/continuation condition.", "For 4–8 s generation, reduce simultaneous independent motion systems; prioritize 1 hero motion plus 1–2 secondary responses.", "Keep gravity and contact explicit for liquid, dropped objects, and footsteps.", "Do not combine slow-motion subject behavior with rapid real-time environmental physics unless the contrast is intentional."],
"failure": [("cloth behaves like fluid", "material stiffness and damping are absent", "craft/motion-director"), ("liquid breaks container boundary", "contact geometry is underspecified", "failure/physics-anatomy-failure-analyzer"), ("car appears to slide", "wheel/suspension/path cues disagree", "craft/motion-director")],
},
"temporal-designer": {
"decisions": [
("A single visual idea needs emphasis", "4–8 s shot with one clear internal beat", "Generation remains controllable while the audience has time to read the idea."),
("Short-form hook needs compression", "0.8–2.0 s opening units before longer proof shot", "Fast initial information density can stop scroll without making every shot frantic."),
("Luxury reveal needs anticipation", "hold before reveal, slow action, then brief resolved hero hold", "Temporal restraint communicates confidence and lets materials read."),
("Action montage needs acceleration", "progressively shorten shot duration while preserving readable geography", "Rhythm escalates without sacrificing orientation."),
("Slow motion is requested", "identify the exact action benefiting from temporal expansion", "Slow motion without a hero event is decorative and wastes temporal bandwidth."),
],
"standards": ["Target shot durations must sum to project duration within roughly ±5% before generation.", "A 30 s commercial normally cannot support 20 unrelated 4–8 s generated shots; plan editorial reuse, trims, or shorter beats consciously.", "Describe speed ramps with start state, transition, and destination speed feel.", "Use transitions to connect motivated visual information, not as random effects."],
"failure": [("shot contains too many beats", "duration and action density conflict", "craft/temporal-designer"), ("luxury piece feels rushed", "shot holds were shortened below material-read time", "craft/temporal-designer"), ("speed ramp looks arbitrary", "ramp has no event anchor", "craft/temporal-designer")],
},
"sound-design-director": {
"decisions": [
("The shot has a tactile product action", "specify close Foley event and material character", "Sound intent should reinforce the visible physical event."),
("Dialogue carries information", "prioritize intelligibility and room tone continuity", "Music and effects must not mask the message."),
("Luxury atmosphere is desired", "sparse sound field with detailed hero transients and controlled music density", "Restraint mirrors premium visual language."),
("Documentary credibility is required", "retain believable location ambience and sync-relevant cues", "Over-designed audio intent can undermine realism."),
("Runtime audio generation is requested", "emit creative audio specification only and warn runtime support is unverified", "The source reference does not verify a production audio generation endpoint."),
],
"standards": ["Separate dialogue, Foley, ambience, music, and transition intent into distinct layers.", "Describe sync events at shot-relative moments such as 0.0–1.5 s rather than pretending an audio runtime exists.", "Keep dialogue wording and claims sourced from the approved script/brand bible.", "runtime_support must remain unverified_or_partial until evidence changes."],
"failure": [("system attempts audio endpoint", "creative metadata was mistaken for runtime capability", "flow/model-resolver"), ("music masks dialogue intent", "priority hierarchy is undefined", "craft/sound-design-director"), ("sound cue has no visible cause", "Foley is detached from blocking", "craft/sound-design-director")],
},
}

GENRE = {
"cinematic-film": ("authored narrative realism; selective spectacle; coherent motif repetition", "24–65 mm core with 85 mm for intimate portraits", "motivated dolly, tracking, crane; locked frames when tension benefits", "source-motivated contrast, often 3:1–8:1 depending scene", "controlled palette with scene-to-scene evolution", "2.39:1 or 16:9 depending delivery", "T2V for geography; I2V/reference for recurring characters", "cliché: every shot shallow-focus, orange/teal, constant gimbal"),
"luxury-commercial": ("restraint, tactile materials, negative space, precise reveal", "65–100 mm portrait/product plus 85–100 mm macro", "slow 10–30° arcs, micro push-ins, locked hero frames", "large shaped sources, specular gradients, deep controlled blacks", "narrow premium palette; black, ivory, metallic or brand-led accents", "16:9, 2.39:1, or disciplined 9:16 adaptation", "I2V/reference for hero product; interpolation for controlled reveal", "cliché: generic gold particles, excessive lens flare, constant slow motion"),
"product-commercial": ("geometry-first hero coverage, material truth, benefit demonstration", "50–100 mm with macro language for details", "controlled orbit, push, pedestal, locked tabletop", "strip gradients, back/rim control, reflection design", "accurate product color before stylized environment color", "16:9 or 9:16 with label-safe framing", "reference or I2V strongly preferred for product identity", "cliché: impossible floating product with unreadable label"),
"beauty-commercial": ("skin, hair, cosmetic finish, catchlight and micro-expression precision", "65–100 mm facial perspective", "slow push, beauty orbit, restrained head-follow", "large soft key, 2:1–3:1 fill, clean eye lights", "skin-protective palette with controlled cosmetic accent", "16:9 or 9:16 close framing", "I2V/reference for face continuity", "cliché: plastic skin, excessive diffusion, uncontrolled gloss"),
"fashion-film": ("silhouette, attitude, garment motion, editorial contrast", "35–85 mm with occasional 24–28 mm attitude wide", "tracking, lateral moves, handheld or locked editorial punctuation", "hard directional sun, studio hard source, or deliberate soft editorial key", "wardrobe-led palette with strong separation", "9:16, 16:9, 4:5-adjacent planning", "reference images for model/wardrobe; I2V for exact styling", "cliché: random runway walking without concept"),
"automotive-commercial": ("vehicle form, credible speed, road geography, reflections", "24–70 mm dynamic range; longer lens for compression passes", "tracking rig feel, low chase, parallel truck, drone geography", "time-of-day reflections and long controlled edge highlights", "paint-accurate grade with environment separation", "16:9 or 2.39:1; 9:16 requires tighter safe path", "I2V/reference for exact vehicle; edit for localized artifact", "cliché: wheels sliding, impossible steering, random speed ramps"),
"food-commercial": ("appetite, texture, steam, gloss, freshness, tactile preparation", "85–100 mm macro plus 50–65 mm tabletop", "micro push, overhead lock, ingredient-follow", "backlight or 3/4 backlight to reveal steam and translucency", "warm appetizing but ingredient-accurate color", "16:9 or 9:16 with plate-safe framing", "I2V/reference for hero dish; T2V for generic ingredient atmosphere", "cliché: impossible steam, waxy food, gravity-defying sauce"),
"beverage-commercial": ("condensation, bubbles, pour dynamics, glass edge, refreshment", "85–100 mm macro and 50–85 mm product portrait", "slow orbit, pour-follow, locked splash hero", "hard back/rim plus controlled strip reflections", "brand-accurate liquid and packaging color", "16:9 or 9:16 label-safe", "reference/I2V for package; interpolation for start/end reveal", "cliché: generic exploding ice, malformed glass, label drift"),
"travel-film": ("sense of place, human-scale discovery, atmosphere and transition through geography", "24–50 mm core; 65–85 mm human detail", "walking gimbal, tracking, drone only for real geography value", "natural golden/blue-hour or believable available light", "location-authentic palette", "16:9 primary; 9:16 destination fragments", "T2V for non-specific atmosphere; references when landmark identity matters", "cliché: nonstop drone shots and generic sunsets"),
"real-estate-film": ("accurate spatial volume, architecture, materials, circulation, amenities", "16–28 mm controlled wide; avoid extreme distortion", "slow gimbal/dolly, doorway reveal, measured vertical move", "window-motivated natural light with practical balance", "material-accurate neutral grade", "16:9 primary; vertical cutdowns planned separately", "I2V from approved stills for exact property control", "cliché: ultra-wide distortion, bent verticals, rooms changing size"),
"hospitality-film": ("guest journey, service touch, architecture, food, rest, atmosphere", "24–50 mm place; 65–100 mm service/detail", "guest-follow, doorway reveal, slow environmental drift", "warm motivated practicals plus soft daylight", "welcoming brand-led palette", "16:9 plus 9:16 service/details", "I2V/reference for property and recurring guest", "cliché: empty lobby montage with no human experience"),
"corporate-brand-film": ("credible people, real work, proof, human warmth, disciplined polish", "35–85 mm natural perspective", "subtle slider/gimbal or observational handheld", "soft motivated office/window light, restrained ratios", "brand-safe natural grade", "16:9 primary", "T2V for generic atmosphere; I2V/reference for specific people/assets", "cliché: fake smiling meetings and random handshakes"),
"documentary": ("observational truth, evidence, context, restrained intervention", "28–50 mm observational; 65–85 mm portrait when appropriate", "handheld/shoulder or locked observation; movement follows events", "available light first; augment only when plausible", "naturalistic, skin-faithful color", "16:9 common", "T2V is risky for factual specific events; references required for concrete identity/location claims", "cliché: beautification that fabricates evidentiary reality"),
"interview-film": ("trustworthy face, eyeline, conversational rhythm, contextual B-roll", "50–85 mm primary; second angle 65–100 mm", "locked or near-locked interview; B-roll movement motivated", "soft key 30–45°, controlled fill, background separation", "skin-faithful and stable shot-match", "16:9 or 9:16 with eyeline safe area", "I2V/reference for exact interviewee identity", "cliché: constant push-in on every sentence"),
"music-video": ("motif, performance energy, rhythm, contrast, visual escalation", "wide 18–35 mm for energy plus 50–85 mm performance portrait", "handheld, orbit, tracking, whip only when rhythmic purpose exists", "expressive hard/color sources with consistent motif", "bold palette tied to song section", "16:9, 2.39:1, or 9:16 depending release", "reference for artist identity; interpolation for designed transitions", "cliché: unrelated effects on every beat"),
"social-vertical-ad": ("thumb-stop first frame, rapid value proof, readable product/face, CTA space", "28–65 mm equivalent; avoid excessive wide face distortion", "direct movement toward camera, short push, simple handheld-native motion", "bright legible subject separation; not necessarily flat high-key", "high contrast and brand-safe color", "9:16 mandatory logic", "I2V/reference when product/person is exact; T2V for generic hook inserts", "cliché: cropping a horizontal TVC into vertical"),
"ugc-ad": ("credible phone-native direct address, problem-proof-result, conversion clarity", "phone-like 24–35 mm equivalent at plausible arm distance", "handheld micro-jitter or simple lock; no polished crane language", "window/room practical realism", "natural color with mild phone rendering", "9:16", "I2V/reference for exact spokesperson/product", "cliché: over-produced 'UGC' that no longer feels user-generated"),
"film-trailer": ("withhold, reveal, escalate, contrast quiet/loud, reserve title-card space", "varies by source genre; continuity beats spectacle", "movement intensity increases across acts rather than every shot", "contrast grows with escalation", "source-film palette preserved", "16:9 or 2.39:1", "use existing shot references/edit where possible; regenerate only missing beats", "cliché: nonstop impact shots with no information architecture"),
"tech-commercial": ("industrial precision, interface clarity, material finish, benefit visualization", "50–100 mm product; 24–50 mm contextual use", "controlled orbit, macro push, exploded-view-like motion only when conceptually grounded", "clean strips, gradients, crisp edges, limited spill", "neutral/brand accent palette with accurate device color", "16:9 and 9:16 product-safe", "reference/I2V for exact device geometry", "cliché: generic blue holograms unrelated to product benefit"),
"horror": ("threat geography, withheld information, negative space, dread before reveal", "24–50 mm spatial unease; 65–100 mm isolation", "locked, creeping push, reluctant pan; handheld only at escalation", "low-key motivated practicals, 8:1+ apparent contrast when readable", "muted or sickly controlled palette", "2.39:1 or 16:9; 9:16 uses vertical depth/doorways", "I2V/reference for recurring entity/character; T2V for abstract atmosphere", "cliché: constant flicker, random jump scares, pure darkness"),
}

CATEGORY_DECISIONS = {
"foundation": [
("A supplied fact is explicit and material", "preserve it verbatim in the project contract", "Downstream invention would create brand or factual risk."),
("An optional preference is missing", "infer a conservative default and record an assumption", "The system should proceed without interrogating the user unnecessarily."),
("Two brief requirements conflict", "prioritize the declared business/narrative objective and emit a warning", "Conflicts must be surfaced rather than silently blended."),
("The request names a visual cliché rather than an objective", "translate it into observable visual rules", "Downstream craft needs controllable instructions."),
("A claim, identity, or brand fact is unsupported", "leave it unset", "The system must not manufacture client claims or PII."),
],
"story": [
("Target duration is short", "reduce beats before shortening every beat", "Fewer complete beats preserve comprehension better than many rushed fragments."),
("A beat has no dramatic or persuasive function", "remove or merge it", "Every scene/shot must earn duration."),
("The concept requires exposition", "convert exposition into visible cause-and-effect where possible", "Video communicates most efficiently through observable action."),
("A scene introduces a new place", "establish geography before micro coverage unless confusion is intentional", "Orientation supports later cuts."),
("Coverage duplicates the same information", "keep the strongest angle and free duration", "Redundant shots increase generation cost without increasing meaning."),
],
"continuity": [
("A previous state field is unchanged by story", "carry it forward exactly", "Continuity state is authoritative, not advisory."),
("The script explicitly changes a state field", "record before/after values at the transition shot", "Intentional changes need traceable timing."),
("Current shot contradicts previous identity or prop state", "block generation and emit continuity conflict", "Regeneration is cheaper than propagating a contradiction."),
("Screen direction changes", "require a neutral/re-establishing shot or explicit line-crossing plan", "Spatial continuity must remain comprehensible."),
("Lighting time or source direction changes", "verify story time/location transition", "Unmotivated light flips read as generation error."),
],
"prompt": [
("A detail does not affect visible output", "remove it from the generation prompt", "Prompt bandwidth should serve load-bearing visual instructions."),
("Two instructions cannot simultaneously be true", "block prompt and report conflict", "Contradictions reduce model controllability."),
("Identity or product geometry is critical", "surface anchors early and keep them unambiguous", "Critical constraints should not be buried after decorative language."),
("A negative constraint has no named risk", "omit it", "Generic negatives create noise and can introduce unwanted concepts."),
("Prompt is long but structurally sound", "compress redundant modifiers before removing continuity anchors", "Compression must preserve control, not merely token count."),
],
"strategy": [
("Identity/product exactness is high", "use image/reference control rather than text-only when assets exist", "Reference anchors reduce rediscovery risk."),
("Both first and last frames are controlled", "prefer start-end interpolation", "Endpoint control is stronger than asking a free generation to land precisely."),
("Existing shot is strong with one localized defect", "prefer edit over full regenerate", "Preserves sunk quality and may reduce credit spend."),
("Budget is tight", "reduce speculative variants before reducing required coverage", "Coverage completeness is more valuable than redundant lottery attempts."),
("Capability evidence is partial or unavailable", "degrade explicitly and attach warning", "The system must not present unverified delivery as guaranteed."),
],
"qc": [
("Overall score is at least 8.5 and no critical hard fail exists", "PASS", "The default acceptance threshold is production-oriented."),
("Overall score is 7.0–8.49 with localized defects", "EDIT", "Targeted repair preserves good work."),
("Overall score is below 7.0", "REGENERATE", "Too much of the shot is wrong for surgical repair."),
("A critical dimension drops below 5.5", "REGENERATE regardless of average", "High averages must not hide broken identity, product, or anatomy."),
("Critics disagree strongly", "retain per-dimension scores and inspect the critical metric", "Aggregation must not erase specialist evidence."),
],
"failure": [
("The same defect repeats after one unchanged retry", "stop blind retry and change the owning parameter", "Repeated identical inputs are not a diagnosis."),
("A defect is local and source quality is high", "route to targeted repair", "Minimal intervention protects successful regions."),
("Identity drift begins after a specific shot", "compare reference set, perspective, and continuity anchors at that transition", "Drift usually has an identifiable change point."),
("CDP/WebSocket failed but media status is unknown", "classify transport failure separately", "Transport failure is not proof of media generation failure."),
("Three bounded retries show no score improvement", "escalate instead of burning more credits", "A stalled loop requires a strategy change or operator decision."),
],
"orchestration": [
("A domain decision is required", "delegate to the owning registered skill", "The orchestrator must not accumulate hidden creative expertise."),
("A dependency output is missing", "schedule the producer skill before the consumer", "Typed data dependencies determine execution order."),
("Runtime capability is partial", "carry evidence warning into manifest", "Delivery status must remain evidence-aware."),
("QC rejects a shot", "invoke diagnosis then minimal repair strategy", "Blind regeneration violates cost and traceability goals."),
("Project reaches final state", "emit manifest with assets, scores, warnings, and runtime records", "Final delivery must be auditable."),
],
}

FLOW_RULES = [
("Authorized browser context is absent", "do not perform mutation", "Generation security requires a valid user browser context; bypass is forbidden."),
("Evidence level is RUNTIME_PARTIAL", "require explicit partial-capability allowance and emit warning", "Partial evidence cannot be upgraded by code."),
("A payload field was disproved by backend", "reject it before transport", "Known invalid shapes must never regress into requests."),
("A security token would need persistence or replay", "abort", "reCAPTCHA tokens are browser-generated and must not be fabricated, stored, or replayed."),
("A response contains secrets or signed URLs", "sanitize before logging or fixtures", "Observability must not leak authorization material."),
]


def genre_profile(slug: str) -> dict[str, Any]:
    visual, lens, camera, lighting, color, aspect, strategy, cliche = GENRE[slug]
    return {
        "decisions": [
            ("The hero subject must read immediately", f"use {visual}", "The genre grammar must be visible in hierarchy, not added as adjectives."),
            ("Lens language is unconstrained", lens, "The lens tendency supports the genre's preferred spatial relationship."),
            ("Camera movement is unconstrained", camera, "Movement should express the genre rather than default to gimbal motion."),
            ("Lighting is unconstrained", lighting, "Source strategy creates recognizable material and emotional behavior."),
            ("Delivery format is unresolved", aspect, "Composition must be planned for the actual frame rather than cropped afterward."),
            ("Generation method is unresolved", strategy, "The method bias follows identity and control requirements."),
        ],
        "standards": [
            f"Visual grammar: {visual}.",
            f"Lens tendency: {lens}.",
            f"Camera tendency: {camera}.",
            f"Lighting tendency: {lighting}.",
            f"Color strategy: {color}.",
            f"Aspect-ratio policy: {aspect}.",
            f"Flow/Veo strategy bias: {strategy}.",
            f"Avoid {cliche}.",
            "Genre profile changes craft priorities and QC weights; it never hardcodes a Flow endpoint or model key.",
        ],
        "failure": [
            ("genre reads as generic AI cinematic", "visual grammar was reduced to adjectives", f"genre/{slug}"),
            ("camera language contradicts genre", "movement was selected without genre motivation", "craft/camera-movement-director"),
            ("reference strategy is too weak for hero identity", "generation method ignored identity/product exactness", "strategy/reference-asset-director"),
        ],
    }


def profile(skill: SkillDef) -> dict[str, Any]:
    if skill.category == "craft" and skill.slug in CRAFT:
        return CRAFT[skill.slug]
    if skill.category == "genre":
        return genre_profile(skill.slug)
    if skill.category == "flow":
        return {
            "decisions": FLOW_RULES,
            "standards": [
                f"Evidence is {skill.evidence_level}; source {skill.reference}.",
                f"Operation surface: {skill.endpoint}.",
                "Never persist OAuth bearer tokens, cookies, reCAPTCHA tokens, PII, or signed CDN query secrets.",
                "Treat HTTP 400 schema errors, HTTP 403 security rejection, FAILED_PRECONDITION, and CDP/WebSocket transport failure as different classes.",
                "Do not hardcode an observed 10 s completion time; poll until a terminal state or policy timeout.",
            ],
            "failure": [
                ("schema rejected", "payload differs from verified shape or enum", "flow/error-classifier"),
                ("reCAPTCHA evaluation failed", "browser security context was invalid or token replayed", "flow/browser-session"),
                ("CDP/WebSocket timeout", "browser transport failed independently of media generation", "flow/browser-session"),
            ],
        }
    rows = CATEGORY_DECISIONS.get(skill.category, CATEGORY_DECISIONS["foundation"])
    standards = {
        "foundation": ["Keep one controlling project objective per decision layer.", "Infer optional defaults with explicit confidence instead of asking a long questionnaire.", "Never invent brand claims, identities, API facts, or user PII.", "For duration planning, keep the first project estimate within ±5% of target before shot expansion."],
        "story": ["Every beat and shot needs one primary narrative or persuasive function.", "Target durations should sum within ±5% of the project runtime before generation.", "Prefer visible cause-and-effect over abstract exposition.", "Short-form openings should communicate a clear attention contract within roughly the first 1–3 s."],
        "continuity": ["Track continuity across 12 domains: character, wardrobe, hair/makeup, prop, location, lighting, camera, screen direction, movement, temporal, color, environment.", "State snapshots are versioned and immutable after acceptance.", "Carry unchanged fields forward exactly.", "A line-of-action change requires explicit re-establishment, not accidental screen reversal."],
        "prompt": ["Compose from subject/action/environment through cinematography, movement, composition, lighting, color, performance, motion, continuity, and justified avoidance constraints.", "Prefer 1 strong instruction per control dimension over adjective stacks.", "Keep 0–5 avoidance constraints unless a documented failure risk justifies more.", "Reject mutually exclusive instructions before spending credits."],
        "strategy": ["Default retry ceiling is 3 bounded attempts without measurable improvement before escalation.", "Variant count should usually stay in the 1–4 range and be tied to uncertainty.", "Use live credit balance and registry pricing; do not treat observed prices as guaranteed.", "RUNTIME_PARTIAL capabilities always carry an explicit warning."],
        "qc": ["Score dimensions on a 0–10 scale.", "Default gate: >=8.5 PASS, 7.0–8.49 EDIT, <7.0 REGENERATE.", "Critical dimensions may hard-fail below 5.5 even when average is high.", "Retain per-critic evidence; do not hide weak identity behind a strong composition average."],
        "failure": ["Diagnosis precedes retry.", "Change only causally implicated parameters on each bounded attempt.", "After 3 attempts with no score improvement, escalate rather than burn credits.", "Transport failure and generation failure are distinct root-cause classes."],
        "orchestration": ["The registry contains 107 committed skills; routing should select the minimum necessary subset.", "Orchestration owns order and state, not lens/light/genre taste.", "Every accepted shot must have mediaId, QC verdict, continuity state, and runtime record.", "Final manifest preserves evidence warnings and credit observations."],
    }.get(skill.category, ["Use explicit typed inputs and outputs.", "Keep decisions traceable and reversible."])
    return {
        "decisions": rows,
        "standards": standards,
        "failure": [
            ("output violates owning contract", "required input or decision rule was skipped", skill.id),
            ("downstream skill receives ambiguous state", "handoff omitted a load-bearing field", skill.id),
            ("system begins inventing missing facts", "assumption was not bounded by source evidence", "foundation/project-intake"),
        ],
    }


def triggers_for(skill: SkillDef) -> list[str]:
    if skill.category == "flow":
        return [
            f"the pipeline needs the {skill.name.lower()} operation inside an authorized Google Flow session",
            f"a runtime plan explicitly routes to {skill.id} with its evidence level already checked",
        ]
    if skill.category == "genre":
        return [
            f"the brief is best described by the {skill.slug.replace('-', ' ')} genre grammar",
            f"the project needs the visual and editorial conventions owned by {skill.id}",
        ]
    return [
        f"the current project or shot requires the decision owned by {skill.id}",
        f"a downstream handoff is missing the specification produced by {skill.id}",
    ]


def not_for_for(skill: SkillDef) -> list[str]:
    mapping = {
        "flow": "creative taste decisions such as lens, lighting, blocking, performance, or genre grammar",
        "foundation": "executing Google Flow media mutations; use strategy and flow runtime skills instead",
        "story": "choosing technical camera or lighting parameters; use the craft department skills",
        "craft": "calling Google Flow endpoints or choosing model keys; use strategy and flow runtime skills",
        "continuity": "inventing a new look merely to repair inconsistency; send the owning craft decision back for revision",
        "prompt": "selecting model keys or bypassing capability evidence; use strategy/generation-method-router and flow/model-resolver",
        "strategy": "making cinematography or art-direction taste choices; consume those specifications from lower layers",
        "genre": "hardcoding Flow endpoints, payload fields, or model keys; genre emits grammar only",
        "qc": "rewriting the shot itself; score first and hand failure evidence to the owning skill",
        "failure": "blindly resubmitting the identical prompt without causal parameter change",
        "orchestration": "making hidden domain decisions that belong to registered specialist skills",
    }
    return [mapping[skill.category]]


def md_list(items: list[str] | tuple[str, ...]) -> str:
    return "\n".join(f"- {x}" for x in items) if items else "- None."


def frontmatter(skill: SkillDef) -> str:
    data = {
        "id": skill.id,
        "version": "1.0.0",
        "name": skill.name,
        "category": skill.category,
        "layer": skill.layer,
        "responsibility": skill.responsibility,
        "evidence_level": skill.evidence_level,
        "dependencies": list(skill.dependencies),
        "optional_dependencies": list(skill.optional_dependencies),
        "consumes": list(skill.consumes),
        "produces": list(skill.produces),
        "triggers": triggers_for(skill),
        "not_for": not_for_for(skill),
        "determinism": skill.determinism,
        "side_effects": skill.side_effects,
    }
    return "---\n" + yaml.safe_dump(data, sort_keys=False, allow_unicode=True, width=120).strip() + "\n---\n"


def integration_text(skill: SkillDef) -> str:
    if skill.category == "flow":
        extra = f" {skill.runtime_note}" if skill.runtime_note else ""
        return f"This runtime skill implements the documented surface `{skill.endpoint}` from `GOOGLE_FLOW_API_REFERENCE.md {skill.reference}`.{extra} It receives already-approved specifications; it does not choose creative taste."
    downstream = "strategy/generation-method-router"
    if skill.category in {"prompt", "strategy"}:
        downstream = "flow/model-resolver"
    if skill.category in {"qc", "failure"}:
        downstream = "strategy/edit-vs-regenerate-selector"
    if skill.category == "orchestration":
        downstream = "the registered flow runtime skill selected by the generation plan"
    return f"This skill emits specification only. It never names or calls a Google Flow endpoint or model key. Its output is handed to `{downstream}` or another explicitly registered downstream owner."


def runtime_evidence(skill: SkillDef) -> str:
    if skill.category != "flow":
        return "Not applicable — this skill performs no runtime call."
    return f"`GOOGLE_FLOW_API_REFERENCE.md {skill.reference}` — `[{skill.evidence_level}]`. The evidence label is copied without upgrade."


def body(skill: SkillDef) -> str:
    p = profile(skill)
    decision_rows = "\n".join(f"| {c} | {ch} | {r} |" for c, ch, r in p["decisions"])
    failure_rows = "\n".join(f"| {sig} | {cause} | {fix} |" for sig, cause, fix in p["failure"])
    deps = md_list(skill.dependencies)
    consumes = md_list([f"`{x}`" for x in skill.consumes])
    produces = md_list([f"`{x}`" for x in skill.produces])
    standards = md_list(p["standards"])
    category_note = ""
    if skill.category == "genre":
        category_note = "\nThis genre profile must also define story grammar, shot vocabulary, performance style, edit rhythm, production-design tendency, motion behavior, reference bias, common failure modes, clichés to avoid, and QC weighting. The profile changes priorities; it never overrides a locked brand or continuity constraint.\n"
    if skill.slug == "sound-design-director":
        category_note += "\nAudio runtime is intentionally absent: the source does not verify a production audio-generation endpoint. `runtime_support` remains `unverified_or_partial`.\n"
    if skill.evidence_level == "RUNTIME_PARTIAL":
        category_note += "\nThis capability is runtime-partial. A caller must surface the limitation in `warnings[]`; successful delivery must never be promised in advance.\n"
    return dedent(f'''
# {skill.name}

## Purpose

{skill.responsibility} The skill exists so this responsibility can be reasoned about, tested, rejected, and repaired independently instead of disappearing inside a monolithic video prompt.

## Responsibility

Own exactly this decision: **{skill.responsibility}** It must not absorb neighboring craft, genre, orchestration, or runtime responsibilities.

## When To Use

{md_list(triggers_for(skill))}

## When NOT To Use

{md_list(not_for_for(skill))}

## Inputs

This skill consumes the following shared typed documents or slices. Missing optional values are inferred only when doing so is low-risk and the assumption is emitted in the standard output envelope.

{consumes}

## Outputs

The skill writes only its owned decision back into the following shared document types and wraps the result with `skill_id`, `skill_version`, `produced_at`, `rationale`, `assumptions`, `warnings`, and `handoff`.

{produces}

## Dependencies

Hard dependencies:

{deps}

Optional dependencies:

{md_list(skill.optional_dependencies)}

Dependencies provide data or prior decisions; they do not transfer ownership of this skill's judgment.

## Decision Framework

| condition | choice | reason |
|---|---|---|
{decision_rows}

A decision that does not match any row must be explained in `rationale` and may not be justified with generic phrases such as “more cinematic”, “epic”, “beautiful”, or “professional”.

## Workflow

1. Validate the required shared-schema inputs and identify missing optional fields.
2. Read project-wide locked constraints before making a shot-local decision.
3. Apply the decision framework from highest-risk constraints to lowest-risk preferences.
4. Record the chosen value plus at least one rejected alternative when `determinism` is heuristic or generative.
5. Check continuity, brand, safety, runtime-evidence, and budget constraints relevant to this responsibility.
6. Emit the standard envelope and name the next owning skill in `handoff`.
7. If a downstream QC or failure skill rejects the result, revise only the implicated parameters rather than rewriting unrelated departments.

## Professional Standards

{standards}
{category_note}
## Google Flow Integration

{integration_text(skill)}

## Runtime Evidence

{runtime_evidence(skill)}

## Constraints

- Never invent an endpoint, payload field, enum, model key, credit cost, authentication mechanism, audio capability, or likeness capability.
- Never store or log OAuth bearer tokens, cookies, reCAPTCHA tokens, PII, or signed CDN secrets.
- Preserve `mediaId` as the canonical media reference; do not regress to disproved `.name` request fields for video inputs.
- Do not use a creative preference to override a locked brand, identity, factual, continuity, or security constraint.
- Do not retry an unchanged failed generation simply to “see if it works this time”; diagnosis must precede retry.

## Failure Modes

| signature | cause | owning fix |
|---|---|---|
{failure_rows}

## Recovery Strategy

Route the failure to `{skill.id}` when its owned decision is wrong. If the symptom is a post-generation media defect rather than a specification defect, first call `failure/generation-failure-analyzer`, then `strategy/edit-vs-regenerate-selector`, and change the minimum causally implicated parameter set.

## Quality Checklist

- [ ] The output changes only the responsibility owned by `{skill.id}`.
- [ ] Every heuristic or generative choice has a concrete rationale and at least one considered alternative.
- [ ] No generic cinematic adjective is standing in for an observable visual, temporal, or runtime instruction.
- [ ] Locked project, brand, character, and continuity constraints remain intact.
- [ ] Runtime claims, if any, match the exact evidence label from the source reference.
- [ ] No secret, cookie, reCAPTCHA token, signed URL secret, or unnecessary PII appears in output or logs.
- [ ] The handoff names the next owner rather than silently taking over another department.

## Examples

See `examples/example.md` for two worked cases: a standard decision and a harder conflict/constraint case. The examples use fictional subjects and sanitized media identifiers only.
''').strip() + "\n"


def example_file(skill: SkillDef) -> str:
    handoff = "strategy/generation-method-router" if skill.category not in {"flow", "qc", "failure", "orchestration"} else (
        "flow/generation-poller" if skill.category == "flow" else "strategy/edit-vs-regenerate-selector"
    )
    return dedent(f'''
# {skill.name} — Worked Examples

## Example 1 — Standard professional decision

### Input slice

```yaml
project:
  title: Fictional Atelier Film
  duration_seconds: 30
  aspect_ratio: "16:9"
shot:
  shot_id: S03
  narrative_function: hero_reveal
  subject: fictional premium object
constraints:
  continuity_locked: true
```

### Reasoning

The skill applies only its owned responsibility: {skill.responsibility} It preserves the locked project state, selects one motivated option, and records why a plausible alternative was rejected.

### Output envelope

```json
{{
  "skill_id": "{skill.id}",
  "skill_version": "1.0.0",
  "produced_at": "2026-08-29T08:30:00Z",
  "result": {{"status": "ok", "decision_owner": "{skill.id}"}},
  "rationale": [{{"decision": "apply owned professional rule", "because": "it best serves the shot function under the locked constraints", "rejected": ["generic cinematic treatment — not specific enough"]}}],
  "assumptions": [],
  "warnings": [],
  "handoff": ["{handoff}"]
}}
```

## Example 2 — Conflict or evidence-limited case

### Input slice

```yaml
project:
  title: Fictional Conflict Test
shot:
  shot_id: S07
requirements:
  primary: preserve exact identity and continuity
  conflicting_request: add unrelated visual behavior that would break the locked state
runtime:
  evidence_policy: never_upgrade_partial
```

### Reasoning

The locked identity/continuity requirement wins over an ornamental request. The rejected choice is surfaced rather than blended silently. If this is a runtime-partial skill, the output also carries an evidence warning instead of promising success.

### Output envelope

```json
{{
  "skill_id": "{skill.id}",
  "skill_version": "1.0.0",
  "produced_at": "2026-08-29T08:31:00Z",
  "result": {{"status": "conflict_resolved", "decision_owner": "{skill.id}"}},
  "rationale": [{{"decision": "preserve locked constraint", "because": "continuity and evidence constraints outrank decoration", "rejected": ["conflicting ornamental request"]}}],
  "assumptions": [],
  "warnings": ["conflicting requirement was not silently merged"],
  "handoff": ["{handoff}"]
}}
```
''').lstrip()


def cases_file(skill: SkillDef) -> str:
    cases = []
    for i, kind in enumerate(REQUIRED_CASE_KINDS[skill.category], 1):
        expected_status = "ok" if kind == "happy_path" else "handled"
        cases.append({
            "id": f"{kind.replace('_','-')}-{i}",
            "kind": kind,
            "input": {
                "brief": f"Fictional {skill.name} case for {kind}",
                "shot_id": f"S{i:02d}",
                "constraints": {"no_secret_logging": True, "preserve_evidence_level": True},
            },
            "expect": {
                "result.status": expected_status,
                "rationale": "non_empty" if skill.determinism != "deterministic" or kind != "bad_input" else "non_empty",
            },
        })
    return json.dumps({"skill": skill.id, "cases": cases}, ensure_ascii=False, indent=2) + "\n"


def write_skill(skill: SkillDef) -> None:
    base = ROOT / "skills" / skill.category / skill.slug
    (base / "examples").mkdir(parents=True, exist_ok=True)
    (base / "tests").mkdir(parents=True, exist_ok=True)
    (base / "SKILL.md").write_text(frontmatter(skill) + body(skill), encoding="utf-8")
    (base / "examples" / "example.md").write_text(example_file(skill), encoding="utf-8")
    (base / "tests" / "cases.yaml").write_text(cases_file(skill), encoding="utf-8")


for skill in S:
    write_skill(skill)

print(f"Generated {len(S)} professional skill packages")
