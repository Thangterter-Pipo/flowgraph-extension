from __future__ import annotations

import json
from pathlib import Path
import yaml

ROOT = Path(r"E:\Google-flow-skills")
SCHEMAS = ROOT / "schemas"


def write_json(name: str, data: dict) -> None:
    (SCHEMAS / name).write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


BASE = "https://google-flow-skills/schemas/"
DRAFT = "https://json-schema.org/draft/2020-12/schema"

write_json("creative_plan.schema.json", {
    "$schema": DRAFT, "$id": BASE + "creative_plan.schema.json", "title": "Creative Plan",
    "description": "Mutable creative-development artifact downstream of immutable project_bible. Foundation directing and story skills own disjoint slices.",
    "type": "object", "properties": {
        "project_id": {"type": "string"},
        "creative_direction": {"type": "object", "properties": {
            "controlling_idea": {"type": "string"}, "tone_boundaries": {"type": "array", "items": {"type": "string"}},
            "emotional_promise": {"type": "string"}, "visual_thesis": {"type": "string"}
        }, "additionalProperties": False},
        "directing": {"type": "object", "properties": {
            "film": {"type": "string"}, "visual": {"type": "string"}, "commercial": {"type": "string"},
            "narrative": {"type": "string"}, "documentary": {"type": "string"}
        }, "additionalProperties": False},
        "brief_analysis": {"type": "object", "properties": {
            "objective": {"type": "string"}, "audience": {"type": "string"}, "message_hierarchy": {"type": "array", "items": {"type": "string"}},
            "deliverables": {"type": "array", "items": {"type": "string"}}, "constraints": {"type": "array", "items": {"type": "string"}},
            "claims": {"type": "array", "items": {"type": "string"}}, "risks": {"type": "array", "items": {"type": "string"}},
            "unresolved_assumptions": {"type": "array", "items": {"type": "string"}}
        }, "additionalProperties": False},
        "concept": {"type": "object", "properties": {"logline": {"type": "string"}, "central_metaphor": {"type": "string"}, "promise": {"type": "string"}, "selection_reason": {"type": "string"}}, "additionalProperties": False},
        "story_architecture": {"type": "object", "additionalProperties": True},
        "beats": {"type": "array", "items": {"type": "object", "additionalProperties": True}},
        "script": {"type": "object", "additionalProperties": True},
        "hook": {"type": "object", "additionalProperties": True},
        "scenes": {"type": "array", "items": {"type": "object", "additionalProperties": True}},
        "shot_list": {"type": "array", "items": {"type": "object", "additionalProperties": True}},
        "shot_spec_index": {"type": "array", "items": {"type": "string"}},
        "micro_story": {"type": "object", "additionalProperties": True},
        "sequences": {"type": "array", "items": {"type": "object", "additionalProperties": True}},
        "storyboard": {"type": "array", "items": {"type": "object", "additionalProperties": True}},
        "short_form": {"type": "object", "properties": {
            "first_three_seconds": {"type": "object", "additionalProperties": True},
            "retention": {"type": "object", "additionalProperties": True},
            "shot_plan": {"type": "array", "items": {"type": "object", "additionalProperties": True}}
        }, "additionalProperties": False}
    }, "additionalProperties": False
})

write_json("genre_profile.schema.json", {
    "$schema": DRAFT, "$id": BASE + "genre_profile.schema.json", "title": "Genre Profile",
    "description": "Genre grammar emitted by exactly one genre skill instance. It biases craft/QC but contains no Flow endpoint or model key.",
    "type": "object", "required": ["genre_skill_id", "visual_grammar", "story_grammar", "shot_vocabulary", "qa_weights"],
    "properties": {
        "genre_skill_id": {"type": "string"}, "visual_grammar": {"type": "string"}, "story_grammar": {"type": "string"},
        "shot_vocabulary": {"type": "array", "items": {"type": "string"}}, "lens_tendency": {"type": "string"},
        "camera_tendency": {"type": "string"}, "lighting_tendency": {"type": "string"}, "color_strategy": {"type": "string"},
        "performance_style": {"type": "string"}, "edit_rhythm": {"type": "string"}, "production_design_tendency": {"type": "string"},
        "motion_behavior": {"type": "string"}, "reference_strategy": {"type": "string"}, "flow_strategy_bias": {"type": "string"},
        "common_failure_modes": {"type": "array", "items": {"type": "string"}}, "cliches_to_avoid": {"type": "array", "items": {"type": "string"}},
        "qa_weights": {"type": "object", "additionalProperties": {"type": "number", "minimum": 0, "maximum": 1}}
    }, "additionalProperties": False
})

write_json("critic_result.schema.json", {
    "$schema": DRAFT, "$id": BASE + "critic_result.schema.json", "title": "Critic Result",
    "type": "object", "required": ["critic_skill_id", "criterion", "score"], "properties": {
        "critic_skill_id": {"type": "string"}, "criterion": {"type": "string"}, "score": {"type": "number", "minimum": 0, "maximum": 10},
        "weight": {"type": "number", "minimum": 0, "maximum": 1}, "observations": {"type": "array", "items": {"type": "string"}},
        "evidence": {"type": "array", "items": {"type": "string"}}, "hard_gate_failed": {"type": "boolean"},
        "recommendations": {"type": "array", "items": {"type": "string"}}
    }, "additionalProperties": False
})

write_json("failure_diagnosis.schema.json", {
    "$schema": DRAFT, "$id": BASE + "failure_diagnosis.schema.json", "title": "Failure Diagnosis",
    "type": "object", "required": ["analyzer_skill_id", "signature", "owning_skills", "retry_verdict"], "properties": {
        "analyzer_skill_id": {"type": "string"}, "signature": {"type": "string"},
        "likely_causes": {"type": "array", "items": {"type": "string"}}, "owning_skills": {"type": "array", "items": {"type": "string"}},
        "parameter_delta": {"type": "array", "items": {"type": "object", "additionalProperties": True}},
        "retry_verdict": {"enum": ["EDIT", "REGENERATE", "ESCALATE", "NO_RETRY"]}, "confidence": {"enum": ["low", "medium", "high"]}
    }, "additionalProperties": False
})

write_json("production_plan.schema.json", {
    "$schema": DRAFT, "$id": BASE + "production_plan.schema.json", "title": "Project Production Plan",
    "type": "object", "properties": {
        "project_id": {"type": "string"}, "selected_skills": {"type": "array", "items": {"type": "string"}},
        "execution_order": {"type": "array", "items": {"type": "string"}}, "shot_order": {"type": "array", "items": {"type": "string"}},
        "batches": {"type": "array", "items": {"type": "object", "additionalProperties": True}},
        "budget": {"type": "object", "additionalProperties": True}, "retry_policy": {"type": "object", "additionalProperties": True},
        "warnings": {"type": "array", "items": {"type": "string"}}
    }, "additionalProperties": False
})

write_json("asset_ledger.schema.json", {
    "$schema": DRAFT, "$id": BASE + "asset_ledger.schema.json", "title": "Asset Ledger", "type": "object",
    "properties": {"assets": {"type": "array", "items": {"type": "object", "required": ["logical_id", "kind"], "properties": {
        "logical_id": {"type": "string"}, "kind": {"enum": ["image", "video", "reference", "character", "product", "other"]},
        "mediaId": {"type": "string"}, "local_path": {"type": "string"}, "sha256": {"type": "string"}, "status": {"type": "string"},
        "provenance": {"type": "string"}
    }, "additionalProperties": False}}}, "additionalProperties": False
})

write_json("project_state.schema.json", {
    "$schema": DRAFT, "$id": BASE + "project_state.schema.json", "title": "Project Execution State", "type": "object",
    "properties": {
        "generation": {"type": "object", "additionalProperties": {"type": "string"}},
        "continuity_state_ids": {"type": "object", "additionalProperties": {"type": "string"}},
        "qc": {"type": "object", "additionalProperties": {"type": "string"}},
        "retry_counts": {"type": "object", "additionalProperties": {"type": "integer", "minimum": 0}},
        "budget": {"type": "object", "additionalProperties": True},
        "completed_skills": {"type": "array", "items": {"type": "string"}}, "deferred_runtime_skills": {"type": "array", "items": {"type": "string"}}
    }, "additionalProperties": False
})

write_json("runtime_context.schema.json", {
    "$schema": DRAFT, "$id": BASE + "runtime_context.schema.json", "title": "Sanitized Runtime Context",
    "description": "Contains only non-secret runtime state. It never stores bearer, cookie, reCAPTCHA token, or signed URL secrets.",
    "type": "object", "properties": {
        "browser": {"type": "object", "properties": {"attached": {"type": "boolean"}, "cdp_port": {"type": "integer"}}, "additionalProperties": False},
        "overlay": {"type": "object", "properties": {"status": {"type": "string"}, "last_safe_action": {"type": "string"}}, "additionalProperties": False},
        "session": {"type": "object", "properties": {"authorized": {"type": "boolean"}, "bearer_available": {"type": "boolean"}}, "additionalProperties": False},
        "credits": {"type": "object", "properties": {"balance": {"type": "number"}, "tier": {"type": "string"}, "checked_at": {"type": "string"}}, "additionalProperties": False},
        "last_error": {"type": "object", "properties": {"error_class": {"type": "string"}, "http_status": {"type": "integer"}, "retryable": {"type": "boolean"}, "message": {"type": "string"}}, "additionalProperties": False}
    }, "additionalProperties": False
})

write_json("continuity_check.schema.json", {
    "$schema": DRAFT, "$id": BASE + "continuity_check.schema.json", "title": "Continuity Domain Check", "type": "object",
    "required": ["skill_id", "domain", "passed"], "properties": {
        "skill_id": {"type": "string"}, "domain": {"type": "string"}, "passed": {"type": "boolean"},
        "expected": {"type": "array", "items": {"type": "string"}}, "observed": {"type": "array", "items": {"type": "string"}},
        "violations": {"type": "array", "items": {"type": "string"}}, "proposed_changes": {"type": "array", "items": {"type": "string"}}
    }, "additionalProperties": False
})

write_json("dispatch_plan.schema.json", {
    "$schema": DRAFT, "$id": BASE + "dispatch_plan.schema.json", "title": "Flow Dispatch Plan", "type": "object",
    "required": ["flow_skill_id", "method"], "properties": {
        "flow_skill_id": {"type": "string"}, "method": {"type": "string"}, "capability": {"type": "string"},
        "payload_fragment": {"type": "object", "additionalProperties": True}, "evidence_level": {"type": "string"},
        "warnings": {"type": "array", "items": {"type": "string"}}
    }, "additionalProperties": False
})

# Extend shot_spec with specialist-owned fields that were previously forced into overlapping parent objects.
shot_path = SCHEMAS / "shot_spec.schema.json"
shot = json.loads(shot_path.read_text(encoding="utf-8"))
sp = shot["properties"]
sp["cinematography"]["properties"].setdefault("perspective_intent", {"type": "string"})
light = sp["lighting"]["properties"]
light.setdefault("natural_light", {"type": "string"})
light.setdefault("studio_setup", {"type": "string"})
light.setdefault("time_of_day_behavior", {"type": "string"})
color = sp["color"]["properties"]
color.setdefault("film_look_intent", {"type": "string"})
color.setdefault("grain_intent", {"type": "string"})
color.setdefault("highlight_rolloff", {"type": "string"})
prod = sp["production_design"]["properties"]
prod.setdefault("architecture", {"type": "string"})
prod.setdefault("background_detail", {"type": "string"})
prod.setdefault("world_rules", {"type": "array", "items": {"type": "string"}})
chm = sp["costume_hair_makeup"]["properties"]
chm.setdefault("styling_notes", {"type": "string"})
perf = sp["performance"]["properties"]
perf.setdefault("objective", {"type": "string"})
perf.setdefault("body_language", {"type": "string"})
perf.setdefault("crowd_direction", {"type": "string"})
motion = sp["motion"]["properties"]
motion.setdefault("vehicle", {"type": "string"})
comp = sp["composition"]["properties"]
comp.setdefault("visual_balance", {"type": "string"})
temp = sp["temporal"]["properties"]
temp.setdefault("rhythm", {"type": "string"})
temp.setdefault("sequence_tempo", {"type": "string"})
sp.setdefault("product", {"type": "object", "properties": {
    "hero_view": {"type": "string"}, "macro_detail": {"type": "string"}, "orbit": {"type": "string"}, "reveal": {"type": "string"},
    "material_rendering": {"type": "string"}, "liquid": {"type": "string"}, "particles": {"type": "string"},
    "tabletop_lighting": {"type": "string"}, "reflection_control": {"type": "string"}, "logo_integrity": {"type": "string"},
    "reference_consistency": {"type": "string"}
}, "additionalProperties": False})
shot_path.write_text(json.dumps(shot, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

# Extend generation_plan with explicit retry metadata.
gp_path = SCHEMAS / "generation_plan.schema.json"
gp = json.loads(gp_path.read_text(encoding="utf-8"))
gp["properties"].setdefault("retry", {"type": "object", "properties": {
    "max_attempts": {"type": "integer", "minimum": 1, "maximum": 5}, "parameter_delta": {"type": "array", "items": {"type": "object", "additionalProperties": True}},
    "stop_rule": {"type": "string"}, "previous_attempt": {"type": "integer", "minimum": 1}
}, "additionalProperties": False})
gp_path.write_text(json.dumps(gp, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def R(doc: str, pointer: str = "") -> str:
    return f"{doc}#{pointer}"


def P(*parts: str) -> str:
    return "/" + "/".join("properties/" + p for p in parts)


# Exact write ownership for skills that mutate shared artifacts. Parent coordinators typically validate but do not own child fields.
OWNS: dict[str, list[str]] = {
    "foundation/project-intake": [R("project_bible")],
    "foundation/creative-director": [R("creative_plan", P("creative_direction"))],
    "foundation/visual-bible-builder": [R("visual_bible")],
    "foundation/brand-bible-builder": [R("brand_bible")],
    "foundation/character-bible-builder": [R("character_bible")],
    "foundation/film-director": [R("creative_plan", P("directing", "film"))],
    "foundation/visual-director": [R("creative_plan", P("directing", "visual"))],
    "foundation/commercial-director": [R("creative_plan", P("directing", "commercial"))],
    "foundation/narrative-director": [R("creative_plan", P("directing", "narrative"))],
    "foundation/documentary-director": [R("creative_plan", P("directing", "documentary"))],
    "story/creative-brief-analyzer": [R("creative_plan", P("brief_analysis"))],
    "story/concept-developer": [R("creative_plan", P("concept"))],
    "story/story-architect": [R("creative_plan", P("story_architecture"))],
    "story/story-beat-designer": [R("creative_plan", P("beats"))],
    "story/screenwriter": [R("creative_plan", P("script"))],
    "story/hook-designer": [R("creative_plan", P("hook"))],
    "story/scene-designer": [R("creative_plan", P("scenes"))],
    "story/shot-list-designer": [R("creative_plan", P("shot_list"))],
    "story/shot-spec-builder": [R("creative_plan", P("shot_spec_index"))],
    "story/micro-story-writer": [R("creative_plan", P("micro_story"))],
    "story/sequence-designer": [R("creative_plan", P("sequences"))],
    "story/storyboard-planner": [R("creative_plan", P("storyboard"))],
    "story/first-three-seconds-director": [R("creative_plan", P("short_form", "first_three_seconds"))],
    "story/retention-director": [R("creative_plan", P("short_form", "retention"))],
    "story/short-form-shot-planner": [R("creative_plan", P("short_form", "shot_plan"))],
    "craft/shot-size-designer": [R("shot_spec", P("cinematography", "shot_size"))],
    "craft/camera-angle-designer": [R("shot_spec", P("cinematography", "camera_angle"))],
    "craft/camera-height-designer": [R("shot_spec", P("cinematography", "camera_height"))],
    "craft/camera-distance-designer": [R("shot_spec", P("cinematography", "subject_distance_m"))],
    "craft/focal-length-designer": [R("shot_spec", P("cinematography", "lens", "focal_length_mm"))],
    "craft/depth-of-field-designer": [R("shot_spec", P("cinematography", "lens", "depth_of_field")), R("shot_spec", P("cinematography", "lens", "t_stop"))],
    "craft/focus-pull-designer": [R("shot_spec", P("cinematography", "lens", "focus_strategy")), R("shot_spec", P("cinematography", "lens", "focus_target"))],
    "craft/camera-speed-designer": [R("shot_spec", P("camera", "movement", "speed")), R("shot_spec", P("camera", "movement", "velocity_profile"))],
    "craft/camera-stability-designer": [R("shot_spec", P("camera", "movement", "stability")), R("shot_spec", P("camera", "movement", "rig"))],
    "craft/framing-designer": [R("shot_spec", P("composition", "subject_position")), R("shot_spec", P("composition", "headroom")), R("shot_spec", P("composition", "eyeline_height"))],
    "craft/perspective-designer": [R("shot_spec", P("cinematography", "perspective_intent"))],
    "craft/screen-direction-supervisor": [R("shot_spec", P("camera", "screen_direction"))],
    "craft/blocking-director": [R("shot_spec", P("blocking"))],
    "craft/key-light-designer": [R("shot_spec", P("lighting", "key"))],
    "craft/fill-light-designer": [R("shot_spec", P("lighting", "fill"))],
    "craft/backlight-designer": [R("shot_spec", P("lighting", "back"))],
    "craft/practical-light-designer": [R("shot_spec", P("lighting", "practicals"))],
    "craft/natural-light-designer": [R("shot_spec", P("lighting", "natural_light"))],
    "craft/studio-lighting-designer": [R("shot_spec", P("lighting", "studio_setup"))],
    "craft/contrast-designer": [R("shot_spec", P("lighting", "contrast"))],
    "craft/exposure-designer": [R("shot_spec", P("lighting", "exposure_intent"))],
    "craft/time-of-day-lighting": [R("shot_spec", P("lighting", "time_of_day_behavior"))],
    "craft/palette-designer": [R("shot_spec", P("color", "production_palette")), R("shot_spec", P("color", "lighting_color"))],
    "craft/contrast-curve-designer": [R("shot_spec", P("color", "contrast_curve"))],
    "craft/film-look-designer": [R("shot_spec", P("color", "film_look_intent"))],
    "craft/texture-designer": [R("shot_spec", P("color", "texture"))],
    "craft/grain-designer": [R("shot_spec", P("color", "grain_intent"))],
    "craft/highlight-rolloff-designer": [R("shot_spec", P("color", "highlight_rolloff"))],
    "craft/skin-tone-supervisor": [R("shot_spec", P("color", "skin_tone_policy"))],
    "craft/set-designer": [R("shot_spec", P("production_design", "set_description"))],
    "craft/location-designer": [R("shot_spec", P("environment", "location")), R("shot_spec", P("environment", "location_id"))],
    "craft/architecture-designer": [R("shot_spec", P("production_design", "architecture"))],
    "craft/prop-designer": [R("shot_spec", P("production_design", "key_props"))],
    "craft/environment-designer": [R("shot_spec", P("environment", "weather")), R("shot_spec", P("environment", "atmosphere"))],
    "craft/background-detail-designer": [R("shot_spec", P("production_design", "background_detail"))],
    "craft/material-designer": [R("shot_spec", P("production_design", "materials"))],
    "craft/surface-texture-designer": [R("shot_spec", P("production_design", "surface_finish"))],
    "craft/era-period-designer": [R("shot_spec", P("production_design", "era"))],
    "craft/worldbuilding-designer": [R("shot_spec", P("production_design", "world_rules"))],
    "craft/character-designer": [R("character_bible", P("facial_geometry")), R("character_bible", P("body")), R("character_bible", P("behaviour"))],
    "craft/character-reference-director": [R("character_bible", P("consistency", "reference_media"))],
    "craft/costume-designer": [R("shot_spec", P("costume_hair_makeup", "costume")), R("shot_spec", P("costume_hair_makeup", "silhouette")), R("shot_spec", P("costume_hair_makeup", "fabric_behaviour"))],
    "craft/fashion-stylist": [R("shot_spec", P("costume_hair_makeup", "styling_notes")), R("shot_spec", P("costume_hair_makeup", "accessories"))],
    "craft/hair-director": [R("shot_spec", P("costume_hair_makeup", "hair"))],
    "craft/makeup-director": [R("shot_spec", P("costume_hair_makeup", "makeup"))],
    "craft/actor-performance-director": [R("shot_spec", P("performance", "objective"))],
    "craft/facial-expression-director": [R("shot_spec", P("performance", "micro_expression"))],
    "craft/body-language-director": [R("shot_spec", P("performance", "body_language"))],
    "craft/gesture-director": [R("shot_spec", P("performance", "gesture"))],
    "craft/eye-line-director": [R("shot_spec", P("performance", "gaze"))],
    "craft/emotion-director": [R("shot_spec", P("performance", "emotional_intent"))],
    "craft/crowd-performance-director": [R("shot_spec", P("performance", "crowd_direction"))],
    "craft/subject-motion-director": [R("shot_spec", P("motion", "subject_motion"))],
    "craft/environment-motion-director": [R("shot_spec", P("motion", "environment_motion"))],
    "craft/cloth-motion-director": [R("shot_spec", P("motion", "cloth"))],
    "craft/hair-motion-director": [R("shot_spec", P("motion", "hair"))],
    "craft/particle-motion-director": [R("shot_spec", P("motion", "particles"))],
    "craft/vehicle-motion-director": [R("shot_spec", P("motion", "vehicle"))],
    "craft/crowd-motion-director": [R("shot_spec", P("motion", "crowd"))],
    "craft/physics-consistency-supervisor": [R("shot_spec", P("motion", "physics_notes"))],
    "craft/motion-tempo-director": [R("shot_spec", P("motion", "tempo"))],
    "craft/rule-of-thirds-director": [R("shot_spec", P("composition", "strategy"))],
    "craft/center-framing-director": [R("shot_spec", P("composition", "strategy"))],
    "craft/symmetry-director": [R("shot_spec", P("composition", "strategy"))],
    "craft/negative-space-director": [R("shot_spec", P("composition", "negative_space"))],
    "craft/leading-lines-director": [R("shot_spec", P("composition", "leading_lines"))],
    "craft/foreground-layering-director": [R("shot_spec", P("composition", "foreground_elements"))],
    "craft/depth-layering-director": [R("shot_spec", P("composition", "foreground_elements")), R("shot_spec", P("composition", "midground_elements")), R("shot_spec", P("composition", "background_elements"))],
    "craft/visual-balance-director": [R("shot_spec", P("composition", "visual_balance"))],
    "craft/headroom-eyeline-supervisor": [R("shot_spec", P("composition", "headroom")), R("shot_spec", P("composition", "eyeline_height"))],
    "craft/platform-safe-composition": [R("shot_spec", P("composition", "safe_areas"))],
    "craft/caption-safe-area-planner": [R("shot_spec", P("composition", "safe_areas"))],
    "craft/vertical-video-director": [R("shot_spec", P("composition", "aspect_ratio"))],
    "craft/shot-duration-designer": [R("shot_spec", P("duration", "target_seconds"))],
    "craft/pacing-director": [R("shot_spec", P("temporal", "internal_pacing"))],
    "craft/rhythm-director": [R("shot_spec", P("temporal", "rhythm"))],
    "craft/sequence-tempo-director": [R("shot_spec", P("temporal", "sequence_tempo"))],
    "craft/slow-motion-director": [R("shot_spec", P("temporal", "speed"))],
    "craft/time-ramping-director": [R("shot_spec", P("temporal", "ramp"))],
    "craft/transition-designer": [R("shot_spec", P("temporal", "transition_in")), R("shot_spec", P("temporal", "transition_out"))],
    "craft/social-pacing-director": [R("shot_spec", P("temporal", "internal_pacing"))],
    "craft/sound-design-director": [R("shot_spec", P("audio_intent"))],
    "craft/music-direction": [R("shot_spec", P("audio_intent", "music_intent"))],
    "craft/audio-intent-designer": [R("shot_spec", P("audio_intent"))],
    "craft/dialogue-intent-designer": [R("shot_spec", P("audio_intent", "dialogue"))],
}

# Product specialist fields.
for slug, field in {
    "product-hero-shot": "hero_view", "product-macro-shot": "macro_detail", "product-orbit-shot": "orbit", "product-reveal": "reveal",
    "product-material-rendering": "material_rendering", "product-liquid-shot": "liquid", "product-particle-shot": "particles",
    "product-tabletop-lighting": "tabletop_lighting", "product-reflection-control": "reflection_control", "product-logo-integrity": "logo_integrity",
    "product-reference-consistency": "reference_consistency",
}.items():
    OWNS[f"craft/{slug}"] = [R("shot_spec", P("product", field))]

# Direct parent craft directors coordinate/validate child-owned regions.
VALIDATES: dict[str, list[str]] = {
    "craft/cinematography-director": [R("shot_spec", P("cinematography"))],
    "craft/lens-director": [R("shot_spec", P("cinematography", "lens"))],
    "craft/camera-movement-director": [R("shot_spec", P("camera", "movement"))],
    "craft/composition-director": [R("shot_spec", P("composition"))],
    "craft/lighting-director": [R("shot_spec", P("lighting"))],
    "craft/color-director": [R("shot_spec", P("color"))],
    "craft/production-designer": [R("shot_spec", P("production_design"))],
    "craft/costume-stylist": [R("shot_spec", P("costume_hair_makeup"))],
    "craft/hair-makeup-director": [R("shot_spec", P("costume_hair_makeup"))],
    "craft/performance-director": [R("shot_spec", P("performance"))],
    "craft/motion-director": [R("shot_spec", P("motion"))],
    "craft/temporal-designer": [R("shot_spec", P("temporal"))],
    "craft/beauty-commercial-director": [R("shot_spec", P("cinematography", "lens")), R("shot_spec", P("lighting")), R("shot_spec", P("costume_hair_makeup")), R("shot_spec", P("performance"))],
    "craft/lighting-continuity-supervisor": [R("shot_spec", P("lighting")), R("continuity_state", P("domains", "lighting"))],
    "craft/color-continuity-supervisor": [R("shot_spec", P("color")), R("continuity_state", P("domains", "color"))],
    "craft/face-consistency-supervisor": [R("character_bible", P("facial_geometry"))],
    "craft/wardrobe-consistency-supervisor": [R("character_bible", P("wardrobe"))],
    "craft/hair-consistency-supervisor": [R("character_bible", P("hair"))],
    "craft/makeup-consistency-supervisor": [R("character_bible", P("makeup"))],
    "craft/body-consistency-supervisor": [R("character_bible", P("body"))],
    "craft/character-continuity-supervisor": [R("character_bible#" if False else "character_bible")],
    "craft/character-shot-planner": [R("character_bible", P("consistency")), R("shot_spec", P("cinematography"))],
}
# Fix root ref constructed above for character continuity supervisor.
VALIDATES["craft/character-continuity-supervisor"] = [R("character_bible")]

# Flow write/validation ownership.
FLOW_OWNS = {
    "flow/browser-session": [R("runtime_context", P("browser"))],
    "flow/overlay-handler": [R("runtime_context", P("overlay"))],
    "flow/auth-session": [R("runtime_context", P("session"))],
    "flow/project-create": [R("project_bible", P("flow_project_id"))],
    "flow/model-resolver": [R("generation_plan", P("capability_request", "resolved_model_key")), R("generation_plan", P("capability_request", "resolved_credit_cost"))],
    "flow/credit-check": [R("runtime_context", P("credits"))],
    "flow/media-upload-image": [R("generation_record", P("output", "media_id"))],
    "flow/image-text-to-image": [R("generation_record")], "flow/image-transform": [R("generation_record")], "flow/image-upsample": [R("generation_record")],
    "flow/video-text-to-video": [R("generation_record")], "flow/video-image-to-video": [R("generation_record")],
    "flow/video-start-end-interpolation": [R("generation_record")], "flow/video-reference-images": [R("generation_record")],
    "flow/video-edit-extend": [R("generation_record")], "flow/video-upsample": [R("generation_record")],
    "flow/generation-poller": [R("generation_record", P("runtime")), R("generation_record", P("production_state"))],
    "flow/media-download": [R("generation_record", P("output"))], "flow/generation-cancel": [R("generation_record", P("runtime"))],
    "flow/character-slot-assignment": [R("character_bible", P("consistency", "character_slots"))],
    "flow/error-classifier": [R("runtime_context", P("last_error"))],
    "flow/likeness-eligibility": [R("character_bible", P("consistency"))], "flow/likeness-list": [R("character_bible", P("consistency", "reference_media"))],
    "flow/character-reference-image": [R("character_bible", P("consistency", "reference_media"))],
}
OWNS.update(FLOW_OWNS)

# Continuity domain skills produce standalone checks; supervisor alone owns authoritative continuity state.
OWNS["continuity/continuity-supervisor"] = [R("continuity_state")]
OWNS["continuity/continuity-state-manager"] = [R("project_state", P("continuity_state_ids"))]
for sid, domain in {
    "continuity/character-continuity": "character", "continuity/wardrobe-continuity": "wardrobe", "continuity/prop-continuity": "prop",
    "continuity/location-continuity": "location", "continuity/lighting-continuity": "lighting", "continuity/camera-continuity": "camera",
    "continuity/screen-direction-continuity": "screen_direction", "continuity/movement-continuity": "movement", "continuity/temporal-continuity": "story_time",
    "continuity/color-continuity": "color", "continuity/environment-continuity": "environment"
}.items():
    VALIDATES[sid] = [R("continuity_state", P("domains", domain)) if domain != "story_time" else R("continuity_state", P("story_time"))]

# Prompt ownership.
for sid in ["prompt/veo-prompt-architect", "prompt/prompt-compressor", "prompt/veo-shot-prompt-writer", "prompt/veo-i2v-prompt-writer", "prompt/veo-reference-prompt-writer", "prompt/veo-interpolation-prompt-writer", "prompt/veo-edit-prompt-writer"]:
    OWNS[sid] = [R("generation_plan", P("prompt"))]
OWNS["prompt/negative-constraint-designer"] = [R("shot_spec", P("avoidance_constraints"))]
VALIDATES["prompt/prompt-conflict-detector"] = [R("generation_plan", P("prompt")), R("shot_spec")]
VALIDATES["prompt/veo-prompt-validator"] = [R("generation_plan", P("prompt")), R("shot_spec")]

# Strategy ownership.
OWNS.update({
    "strategy/generation-method-router": [R("generation_plan", P("method")), R("generation_plan", P("method_rationale"))],
    "strategy/reference-asset-director": [R("generation_plan", P("inputs", "reference_images"))],
    "strategy/budget-optimizer": [R("generation_plan", P("budget"))],
    "strategy/variant-strategy": [R("generation_plan", P("variants"))],
    "strategy/generation-strategy-planner": [R("production_plan", P("shot_order")), R("production_plan", P("batches"))],
    "strategy/edit-vs-regenerate-selector": [R("failure_diagnosis", P("retry_verdict"))],
    "strategy/retry-strategy": [R("generation_plan", P("retry"))],
    "strategy/shot-generation-router": [R("dispatch_plan")],
    "strategy/t2v-vs-i2v-selector": [R("generation_plan", P("method"))],
    "strategy/reference-image-selector": [R("generation_plan", P("inputs", "reference_images"))],
    "strategy/interpolation-selector": [R("generation_plan", P("method"))],
    "strategy/seed-reference-consistency-planner": [R("generation_plan", P("inputs", "reference_images"))],
    "strategy/generation-budget-optimizer": [R("generation_plan", P("budget"))],
})

# QC and failure outputs are standalone typed artifacts until aggregators write qc_report.
for sid in [
    "qc/prompt-quality-critic", "qc/cinematography-critic", "qc/lighting-critic", "qc/composition-critic", "qc/motion-critic", "qc/physics-critic",
    "qc/anatomy-critic", "qc/character-consistency-critic", "qc/product-consistency-critic", "qc/brand-consistency-critic", "qc/artifact-detector",
    "qc/video-quality-critic", "qc/continuity-critic"
]:
    VALIDATES[sid] = [R("generation_record"), R("shot_spec")]
OWNS["qc/generation-result-scorer"] = [R("qc_report", P("criteria")), R("qc_report", P("overall"))]
OWNS["qc/shot-acceptance-gate"] = [R("qc_report", P("thresholds")), R("qc_report", P("verdict")), R("qc_report", P("verdict_reason"))]
for sid in [
    "failure/generation-failure-analyzer", "failure/identity-drift-analyzer", "failure/camera-motion-failure-analyzer", "failure/physics-anatomy-failure-analyzer",
    "failure/prompt-conflict-analyzer", "failure/artifact-repair-planner", "failure/anatomy-failure-analyzer", "failure/physics-failure-analyzer", "failure/continuity-failure-analyzer"
]:
    VALIDATES[sid] = [R("generation_record"), R("qc_report")]

# Orchestration ownership.
OWNS.update({
    "orchestration/skill-router": [R("production_plan", P("selected_skills")), R("production_plan", P("execution_order"))],
    "orchestration/asset-manager": [R("asset_ledger")], "orchestration/media-id-manager": [R("asset_ledger")],
    "orchestration/generation-state-manager": [R("project_state", P("generation"))],
    "orchestration/continuity-state-manager": [R("project_state", P("continuity_state_ids"))],
    "orchestration/budget-manager": [R("project_state", P("budget"))],
    "orchestration/project-qc-manager": [R("project_state", P("qc"))],
    "orchestration/project-manifest-builder": [R("project_manifest")],
    "orchestration/shot-pipeline-orchestrator": [R("project_state", P("generation")), R("project_state", P("qc"))],
    "orchestration/video-production-orchestrator": [R("project_state", P("completed_skills")), R("project_state", P("deferred_runtime_skills"))],
    "orchestration/video-project-planner": [R("production_plan")],
})

# Output artifact selection. Every value is a schema-qualified JSON pointer, even when the exact output is a whole standalone artifact.
def output_for(skill: dict) -> list[str]:
    sid = skill["id"]
    cat = skill["category"]
    if cat == "genre": return [R("genre_profile")]
    if cat == "qc" and sid not in {"qc/generation-result-scorer", "qc/shot-acceptance-gate"}: return [R("critic_result")]
    if cat == "failure": return [R("failure_diagnosis")]
    if cat == "continuity" and sid not in {"continuity/continuity-supervisor", "continuity/continuity-state-manager"}: return [R("continuity_check")]
    if sid in OWNS: return OWNS[sid]
    # Coordinating/validating skills still emit an envelope over the domain artifact they coordinate.
    old = skill.get("produces") or []
    return [x if "#" in x else x + "#" for x in old]


def read_refs(skill: dict) -> list[str]:
    return [x if "#" in x else x + "#" for x in (skill.get("consumes") or [])]

# Apply metadata to plan and SKILL.md frontmatter.
plan_path = ROOT / "skills_plan" / "plan.json"
plan = json.loads(plan_path.read_text(encoding="utf-8"))
for skill in plan["skills"]:
    sid = skill["id"]
    skill["consumes"] = read_refs(skill)
    skill["produces"] = output_for(skill)
    skill["owns"] = OWNS.get(sid, [])
    skill["validates"] = VALIDATES.get(sid, [])
plan["plan_version"] = "3.0.0"
plan["ownership_contract"] = "json-pointer-v1"
plan_path.write_text(json.dumps(plan, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

for skill in plan["skills"]:
    sid = skill["id"]
    cat, slug = sid.split("/", 1)
    path = ROOT / "skills" / cat / slug / "SKILL.md"
    text = path.read_text(encoding="utf-8")
    _, raw, body = text.split("---", 2)
    meta = yaml.safe_load(raw) or {}
    meta["consumes"] = skill["consumes"]
    meta["produces"] = skill["produces"]
    meta["owns"] = skill["owns"]
    meta["validates"] = skill["validates"]
    # Stable contract key order.
    order = ["id","version","name","category","layer","responsibility","evidence_level","dependencies","optional_dependencies","consumes","produces","owns","validates","triggers","not_for","determinism","side_effects"]
    ordered = {k: meta.get(k) for k in order if k in meta}
    for k,v in meta.items():
        if k not in ordered: ordered[k] = v
    fm = yaml.safe_dump(ordered, sort_keys=False, allow_unicode=True, width=120).strip()
    path.write_text("---\n" + fm + "\n---\n" + body.lstrip(), encoding="utf-8")

print(f"Wrote shared execution schemas and applied JSON-pointer ownership to {len(plan['skills'])} skills")
