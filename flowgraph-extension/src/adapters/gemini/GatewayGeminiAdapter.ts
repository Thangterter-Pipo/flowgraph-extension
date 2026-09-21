import type { GeminiAdapter, GeminiEnhanceOptions } from './GeminiAdapter';

export interface GatewayClientOptions {
  baseUrl?: string;
  apiKey?: string;
  defaultModel?: string;
}

function isLocalGatewayUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname.endsWith('.localhost');
  } catch {
    return false;
  }
}

export class GatewayGeminiAdapter implements GeminiAdapter {
  private baseUrl: string;
  private apiKey: string;
  private defaultModel: string;

  constructor(options: GatewayClientOptions = {}) {
    const defaultModel = options.defaultModel || (typeof window !== 'undefined' ? (() => {
      try {
        const raw = localStorage.getItem('flowgraph.settings.v1');
        return raw ? JSON.parse(raw).aiModel : undefined;
      } catch { return undefined; }
    })() : undefined) || 'cx/gpt-5.6-luna';

    const baseUrl = options.baseUrl || (typeof window !== 'undefined' ? (() => {
      try {
        const raw = localStorage.getItem('flowgraph.settings.v1');
        return raw ? JSON.parse(raw).aiGatewayUrl : undefined;
      } catch { return undefined; }
    })() : undefined) || 'http://localhost:20128/v1';

    const configuredKey = options.apiKey !== undefined ? options.apiKey : (typeof window !== 'undefined' ? (() => {
      try {
        const raw = localStorage.getItem('flowgraph.settings.v1');
        return raw ? JSON.parse(raw).aiApiKey : undefined;
      } catch { return undefined; }
    })() : undefined);
    // The bundled fallback key is only for the user's own local gateway. Remote
    // gateways must bring their own key from Studio settings — never share a
    // shipped credential with an arbitrary host.
    const apiKey = configuredKey || (isLocalGatewayUrl(baseUrl) ? 'Thangterter' : '');

    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.apiKey = apiKey;
    this.defaultModel = defaultModel;
  }

  updateConfig(options: GatewayClientOptions): void {
    if (options.baseUrl) this.baseUrl = options.baseUrl.replace(/\/$/, '');
    if (options.apiKey !== undefined) this.apiKey = options.apiKey;
    if (options.defaultModel) this.defaultModel = options.defaultModel;
  }

  async enhancePrompt(prompt: string, options?: GeminiEnhanceOptions): Promise<string> {
    const style = options?.style || 'AUTO';
    const custom = options?.customInstruction ? ` Additional instructions: ${options.customInstruction}` : '';
    const styleClause = style === 'AUTO' 
      ? 'Style requested: Automatically analyze the intent and topic of the user prompt to apply the most optimal visual aesthetic and cinematic grade.'
      : `Style requested: ${style}.`;

    const systemPrompt = `You are a world-class prompt engineer for cinematic AI image and video generation (Google Flow / Veo / Imagen).
Your task is to take the user's base idea/prompt and expand it into a visually stunning, highly descriptive, photorealistic, cinematic prompt with lighting, atmosphere, camera lens, depth of field, and compositional details.
${styleClause}${custom}
OUTPUT RULE: Return ONLY the final enhanced English prompt. Do not write any preamble, explanation, notes, or markdown backticks.`;

    const payload = {
      model: this.defaultModel,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt }
      ],
      temperature: 0.7,
      max_tokens: 300
    };

    const url = `${this.baseUrl}/chat/completions`;
    if (!this.apiKey) {
      throw new Error('AI Gateway API key is missing. Set "aiApiKey" in Studio settings for this gateway URL.');
    }
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`
    };
    const bodyStr = JSON.stringify(payload);

    let resData: any = null;

    // Use chrome.runtime.sendMessage to execute fetch in the background service worker (bypassing page CORS/Mixed-Content)
    if (typeof chrome !== 'undefined' && chrome?.runtime?.sendMessage) {
      const bridgeRes: any = await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          {
            type: 'FLOWGRAPH_PROXY_FETCH',
            payload: { url, method: 'POST', headers, body: bodyStr },
          },
          (reply) => resolve(reply)
        );
      });

      const response = bridgeRes?.data || bridgeRes?.payload;
      if (!response?.ok) {
        throw new Error(`AI Gateway error HTTP ${response?.status}: ${response?.text || response?.statusText || 'Fetch failed'}`);
      }
      try {
        resData = JSON.parse(response.text);
      } catch {
        throw new Error(`AI Gateway response is not JSON: ${response.text}`);
      }
    } else {
      const res = await fetch(url, { method: 'POST', headers, body: bodyStr });
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`AI Gateway error HTTP ${res.status}: ${errText || res.statusText}`);
      }
      resData = await res.json();
    }

    const content = resData.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new Error('AI Gateway returned empty response content.');
    }

    return content;
  }
}
