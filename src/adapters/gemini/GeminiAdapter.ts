export interface GeminiEnhanceOptions {
  style?: "CINEMATIC" | "REALISTIC" | "ARTISTIC" | "ADVERTISING" | "ANIME" | "CUSTOM";
  customInstruction?: string;
}

export interface GeminiAdapter {
  enhancePrompt(prompt: string, options?: GeminiEnhanceOptions): Promise<string>;
}
