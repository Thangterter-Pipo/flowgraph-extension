/**
 * Generic Standard Character DNA Template for FlowGraph Studio
 * Provides clean placeholders so ANY character can use this DNA schema.
 * Explicit 3-tier architecture:
 *  - TIER 1 — IDENTITY DNA (IMMUTABLE / LOCKED)
 *  - TIER 2 — STYLE DNA (SIGNATURE WARDROBE & ATTRIBUTES)
 *  - TIER 3 — SCENE VARIABLES (DYNAMIC EXECUTION)
 */

export const CHARACTER_DNA_SCHEMA_TEMPLATE = `CHARACTER DNA

Character ID:
[CHARACTER_ID]

Name:
[CHARACTER_NAME]

TIER 1 — IDENTITY DNA (LOCKED — IMMUTABLE)
Core Identity:
- Gender: [GENDER]
- Age: [AGE]
- Ethnicity / visual heritage: [ETHNICITY]
- Height: [HEIGHT]
- Body type: [BODY_TYPE]
- Body proportions: [BODY_PROPORTIONS]

Face DNA:
- Face shape: [FACE_SHAPE]
- Forehead: [FOREHEAD]
- Jawline: [JAWLINE]
- Chin: [CHIN]
- Cheekbones: [CHEEKBONES]
- Skin tone: [SKIN_TONE]
- Skin texture: [SKIN_TEXTURE]

Eye DNA:
- Eye shape: [EYE_SHAPE]
- Eye size: [EYE_SIZE]
- Eye color: [EYE_COLOR]
- Eye spacing: [EYE_SPACING]
- Eyelids: [EYELIDS]
- Eyebrows: [EYEBROWS]

Nose DNA:
- Nose shape: [NOSE_SHAPE]
- Nose bridge: [NOSE_BRIDGE]
- Nose tip: [NOSE_TIP]
- Nostril shape: [NOSTRILS]

Mouth DNA:
- Lip shape: [LIP_SHAPE]
- Lip volume: [LIP_VOLUME]
- Mouth width: [MOUTH_WIDTH]
- Natural expression: [NATURAL_EXPRESSION]

Hair DNA:
- Hair color: [HAIR_COLOR]
- Hairstyle: [HAIRSTYLE]
- Hair length: [HAIR_LENGTH]
- Hair texture: [HAIR_TEXTURE]
- Hairline: [HAIRLINE]

Unique Identity Markers:
- [MOLE / SCAR / FRECKLES / TATTOO / BIRTHMARK]
- [OTHER UNIQUE FEATURE]

Body DNA:
- Shoulder width: [SHOULDERS]
- Torso proportion: [TORSO]
- Arm proportion: [ARMS]
- Leg proportion: [LEGS]
- Hand shape: [HANDS]
- Posture: [POSTURE]

TIER 2 — STYLE DNA (SIGNATURE WARDROBE & ATTRIBUTES)
Voice / Personality DNA:
- Personality: [PERSONALITY]
- Typical facial expression: [EXPRESSION]
- Typical body language: [BODY_LANGUAGE]
- Energy / presence: [PRESENCE]

Signature Wardrobe DNA:
- Main clothing style: [STYLE]
- Core colors: [COLOR_PALETTE]
- Signature accessories: [ACCESSORIES]
- Footwear: [FOOTWEAR]

VISUAL CONSISTENCY LOCK
The following attributes are immutable:
face structure,
eye shape,
eye color,
nose shape,
jawline,
skin tone,
hairstyle,
hair color,
body proportions,
age appearance,
unique identity markers.

Never redesign or reinterpret these features.

TIER 3 — SCENE VARIABLES (DYNAMIC EXECUTION)
Variable attributes allowed:
pose,
facial expression,
camera angle,
lighting,
background,
environment,
action,
temporary wardrobe,
scene context.

Always preserve the same person identity across every image and video generation.`;

export const DEFAULT_CHARACTER_DNA = CHARACTER_DNA_SCHEMA_TEMPLATE;

export function populateCharacterDna(config: Record<string, any>): string {
  let template = CHARACTER_DNA_SCHEMA_TEMPLATE;
  const characterId = config.characterId || 'CHAR_001';
  const characterName = config.displayName || config.name || 'Character';

  template = template.replace('[CHARACTER_ID]', characterId);
  template = template.replace('[CHARACTER_NAME]', characterName);

  if (config.gender) template = template.replace('[GENDER]', config.gender);
  if (config.age) template = template.replace('[AGE]', String(config.age));
  if (config.ethnicity) template = template.replace('[ETHNICITY]', config.ethnicity);
  if (config.height) template = template.replace('[HEIGHT]', config.height);

  return template;
}

export function buildCharacterScenePrompt(dnaText: string, scenePrompt: string): string {
  const cleanDna = dnaText.trim();
  const cleanScene = scenePrompt.trim();

  if (!cleanDna) return cleanScene;
  if (!cleanScene) return cleanDna;

  return `[CHARACTER DNA (TIER 1 LOCKED + TIER 2 STYLE)]\n${cleanDna}\n\n[TIER 3 — SCENE VARIABLES DYNAMIC]\n${cleanScene}`;
}
