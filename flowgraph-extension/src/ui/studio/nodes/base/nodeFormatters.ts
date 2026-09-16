export function compactModel(value?: string) {
  if (!value) return undefined;
  return value
    .replace('🍌 ', '')
    .replace('SERVICE_TIER_', '')
    .replace(' (NARWHAL)', '')
    .replace(' (Landscape)', '')
    .replace(' (Portrait)', '')
    .replace('Veo 3.1 - Lite', 'Veo Lite')
    .replace('Veo 3.1 – Lite', 'Veo Lite')
    .replace('Veo 3.1 - Fast', 'Veo Fast')
    .replace('Veo 3.1 – Fast', 'Veo Fast')
    .replace('Veo 3.1 - Quality', 'Veo Quality')
    .replace('Veo 3.1 – Quality', 'Veo Quality')
    .replace('Veo 3.1 - ', 'Veo ')
    .replace('Veo 3.1 – ', 'Veo ')
    .replace('Omni 1.1 Flash', 'Omni')
    .replace('Omni Flash', 'Omni')
    .replace('Nano Banana 2 Lite', 'Banana Lite')
    .replace('Nano Banana Pro', 'Banana Pro')
    .replace('Nano Banana 2', 'Banana 2');
}

export function shortAspect(value?: string) {
  if (!value) return undefined;
  return value.match(/\d+:\d+/)?.[0] ?? value;
}

export function shortTitle(title: string): string {
  if (!title) return '';
  return title
    .replace(/^Text to Image.*$/i, 'T2I')
    .replace(/^Text to Video.*$/i, 'T2V')
    .replace(/^Image to Video.*$/i, 'I2V')
    .replace(/^Gemini Enhance.*$/i, 'Gemini')
    .replace(/^Upload Image.*$/i, 'Upload')
    .replace(/^Video Upscale.*$/i, 'Upscale')
    .replace(/^Image Upscale.*$/i, 'Upscale')
    .replace(/^Interpolation.*$/i, 'Smooth')
    .replace(/^Extend Video.*$/i, 'Extend')
    .replace(/^Reference Video.*$/i, 'Ref Motion')
    .replace(/^Character Create.*$/i, 'Character')
    .replace(/^Character Assign.*$/i, 'Assign')
    .replace(/^Mô Tả Cảnh.*$/i, 'Scene Prompt')
    .replace(/^Tạo Cảnh.*$/i, 'Start-End Frame')
    .replace(/^Prompt Gốc.*$/i, 'Source Prompt')
    .replace(/^Ref · Bối Cảnh.*$/i, 'Scene Reference')
    .replace(/^Ref · Nhân Vật A.*$/i, 'Character Reference A')
    .replace(/^Ref · Nhân Vật B.*$/i, 'Character Reference B');
}
